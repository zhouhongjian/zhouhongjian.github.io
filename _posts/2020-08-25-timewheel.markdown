---
layout: post_bs
title: 时间轮算法——Netty的HashedWheelTimer为例
category: programming
author: 周红建
date:   2020-08-24
tags: 第三方源码分析
---
<!-- # 时间轮算法——Netty的HashedWheelTimer为例 -->

## 应用
解决调度相关的问题

## 常见的任务调度的工具
1. Timer定时器，一个任务一个线程非常浪费资源
2. ScheduledThreadPoolExecutor，Timer的在线程上的一个优化版本。但是任务的插入算法没变，都是根据小根堆来获取最近的一个执行任务。它判断是否为周期性任务，如果是周期性任务，给这个任务设置下一次的执行时间，再放入小根堆。因为堆的插入时间复杂度是O(logN)。对于一些高性能场景可能不适用。
3. 时间轮  优点：任务的插入时间复杂度是O(1)。缺点：任务的调度精度受限于时间轮每格的时间跨度。


## 算法逻辑：
假设有一个钟表盘，上面只有12格（0-11），每一格表示一个时间跨度X，每一格可以存放一些需要执行的任务。钟表开始启动的时间点为0，当钟表指针已经走动到第Y格的时候。  
假设有一个任务想要相比钟表开始运行的时间延迟Z时间段进行执行。
那么需要这个任务在指针走完第(Z/X-Y)/12轮之后，再走(Z/X-Y)%12格的时候执行这个任务。(可以先把这个任务放在第Y+(Z-X*Y)%12格)。  
这一格能放很多任务，可以在走到这一格的时候，遍历其中的所有任务，然后进行执行。


## 以netty的HashedWheelTimer作源码分析：

### 前置知识点：
1. System.nanoTime()  是一个单调时钟。它的绝对值是没有意义的，它保证的是后一次调用一定在前一次调用之前。  
比如说第一次调用获取的时间是5，第二次获取的时间是10，那么可以保证2次调用的时间差是5 (abs（10-5）)。  
因为是单调的，所以long可以会溢出。假设第一次调用没有溢出为Long.MAX_VALUE-5。第二次如果溢出了，那么溢出的时间可能为Long.MIN_VALUE。那么时间差还是可以保证的为Long.MIN_VALUE-Long.MAX_VALUE+5 = 6。  
如果是System.currentTimeMillis()的话，是没法保证的，因为它是取得系统时间，我在七点的时候进行第一次调用，然后把系统时间设置成五点，那么我这个时候调用获取的是五点的时间，它保证不了后一次调用的时间一定在前一次调用之前，也保证不了时间差。  
https://www.zhihu.com/question/312922076/answer/615027164

2. HashedWheelTimer的表盘是一个HashedWheelBucket[]数组。数组元素HashedWheelBucket是一个双向连表。双向链表中的元素为HashedWheelTimeout，它是一个具有延迟时间的任务包装类。
3. 时间轮中的时间除了System.nanoTime(),都是startTime的相对时间



### 构造器
```java 
public HashedWheelTimer(
            ThreadFactory threadFactory,
            long tickDuration, TimeUnit unit, int ticksPerWheel, boolean leakDetection,
            long maxPendingTimeouts) {

        if (threadFactory == null) {
            throw new NullPointerException("threadFactory");
        }
        if (unit == null) {
            throw new NullPointerException("unit");
        }
        if (tickDuration <= 0) {
            throw new IllegalArgumentException("tickDuration must be greater than 0: " + tickDuration);
        }
        if (ticksPerWheel <= 0) {
            throw new IllegalArgumentException("ticksPerWheel must be greater than 0: " + ticksPerWheel);
        }

        // Normalize ticksPerWheel to power of two and initialize the wheel.
        wheel = createWheel(ticksPerWheel);
        mask = wheel.length - 1;

        // Convert tickDuration to nanos.
        this.tickDuration = unit.toNanos(tickDuration);

        // Prevent overflow.
        if (this.tickDuration >= Long.MAX_VALUE / wheel.length) {
            throw new IllegalArgumentException(String.format(
                    "tickDuration: %d (expected: 0 < tickDuration in nanos < %d",
                    tickDuration, Long.MAX_VALUE / wheel.length));
        }
        workerThread = threadFactory.newThread(worker);

        leak = leakDetection || !workerThread.isDaemon() ? leakDetector.track(this) : null;

        this.maxPendingTimeouts = maxPendingTimeouts;

        if (INSTANCE_COUNTER.incrementAndGet() > INSTANCE_COUNT_LIMIT &&
            WARNED_TOO_MANY_INSTANCES.compareAndSet(false, true)) {
            reportTooManyInstances();
        }
    }

```
1. 创建时间轮
2. 创建工作线程
3. 设置最多可以挂起的任务数
4. 判断启动的时间轮实例是否大于阈值，大于则进行error日志打印

### 创建时间轮
```java 
private static HashedWheelBucket[] createWheel(int ticksPerWheel) {
        if (ticksPerWheel <= 0) {
            throw new IllegalArgumentException(
                    "ticksPerWheel must be greater than 0: " + ticksPerWheel);
        }
        if (ticksPerWheel > 1073741824) {
            throw new IllegalArgumentException(
                    "ticksPerWheel may not be greater than 2^30: " + ticksPerWheel);
        }

        ticksPerWheel = normalizeTicksPerWheel(ticksPerWheel);
        HashedWheelBucket[] wheel = new HashedWheelBucket[ticksPerWheel];
        for (int i = 0; i < wheel.length; i ++) {
            wheel[i] = new HashedWheelBucket();
        }
        return wheel;
    }

private static int normalizeTicksPerWheel(int ticksPerWheel) {
        int normalizedTicksPerWheel = 1;
        while (normalizedTicksPerWheel < ticksPerWheel) {
            normalizedTicksPerWheel <<= 1;
        }
        return normalizedTicksPerWheel;
    }

```
1. 获取时间轮的实际size，大于ticksPerWheel的最小2的N次方。
   与HashMap获取size的方式类似，用处也类似，方便获取index的时候做位操作
2. new一个实际size的HashedWheelBucket数组。HashedWheelBucket是一个双向链表，里面的元素为HashedWheelTimeout（一个执行任务的包装类）
3. 返回该数组

### 新增调度任务
```java
public Timeout newTimeout(TimerTask task, long delay, TimeUnit unit) {
        if (task == null) {
            throw new NullPointerException("task");
        }
        if (unit == null) {
            throw new NullPointerException("unit");
        }

        long pendingTimeoutsCount = pendingTimeouts.incrementAndGet();

        if (maxPendingTimeouts > 0 && pendingTimeoutsCount > maxPendingTimeouts) {
            pendingTimeouts.decrementAndGet();
            throw new RejectedExecutionException("Number of pending timeouts ("
                + pendingTimeoutsCount + ") is greater than or equal to maximum allowed pending "
                + "timeouts (" + maxPendingTimeouts + ")");
        }

        start();

        // Add the timeout to the timeout queue which will be processed on the next tick.
        // During processing all the queued HashedWheelTimeouts will be added to the correct HashedWheelBucket.
        long deadline = System.nanoTime() + unit.toNanos(delay) - startTime;
        HashedWheelTimeout timeout = new HashedWheelTimeout(this, task, deadline);
        timeouts.add(timeout);
        return timeout;
    }

```
1. 挂起的任务数自增，再做上限校验
2. 启动时间轮
3. 将任务包装成HashedWheelTimeout，延迟时间为对开始时间的一个相对值
4. 将包装类放到任务队列timeouts中

### 启动时间轮
```java
public void start() {
        switch (WORKER_STATE_UPDATER.get(this)) {
            case WORKER_STATE_INIT:
                if (WORKER_STATE_UPDATER.compareAndSet(this, WORKER_STATE_INIT, WORKER_STATE_STARTED)) {
                    workerThread.start();
                }
                break;
            case WORKER_STATE_STARTED:
                break;
            case WORKER_STATE_SHUTDOWN:
                throw new IllegalStateException("cannot be started once stopped");
            default:
                throw new Error("Invalid WorkerState");
        }

        // Wait until the startTime is initialized by the worker.
        while (startTime == 0) {
            try {
                startTimeInitialized.await();
            } catch (InterruptedException ignore) {
                // Ignore - it will be ready very soon.
            }
        }
    }
```
1. 假设有多个线程执行，获取当前时间轮的状态，如果为初始化状态，那么由CAS成功的线程设置为开始状态，然后启动工作线程；CAS失败的线程直接break。
2. 如果获取的时间轮为其他状态，再做一些处理，略
3. 如果发现开始时间为0，表示开始时间没有设置，那么说明对应的工作线程没有启动。这个时候通过一个CountDownLatch同步器startTimeInitialized进行等待。等到工作线程启动后，才会执行完成。

### 工作线程的执行逻辑,在Worker类的run方法中：
```java
@Override
        public void run() {
            // Initialize the startTime.
            startTime = System.nanoTime();
            if (startTime == 0) {
                // We use 0 as an indicator for the uninitialized value here, so make sure it's not 0 when initialized.
                startTime = 1;
            }

            // Notify the other threads waiting for the initialization at start().
            startTimeInitialized.countDown();

            do {
                final long deadline = waitForNextTick();
                if (deadline > 0) {
                    int idx = (int) (tick & mask);
                    processCancelledTasks();
                    HashedWheelBucket bucket =
                            wheel[idx];
                    transferTimeoutsToBuckets();
                    bucket.expireTimeouts(deadline);
                    tick++;
                }
            } while (WORKER_STATE_UPDATER.get(HashedWheelTimer.this) == WORKER_STATE_STARTED);

            // Fill the unprocessedTimeouts so we can return them from stop() method.
            for (HashedWheelBucket bucket: wheel) {
                bucket.clearTimeouts(unprocessedTimeouts);
            }
            for (;;) {
                HashedWheelTimeout timeout = timeouts.poll();
                if (timeout == null) {
                    break;
                }
                if (!timeout.isCancelled()) {
                    unprocessedTimeouts.add(timeout);
                }
            }
            processCancelledTasks();
        }
```
1. 获取一个单调钟的纳秒时作为开始时间，因为单调钟的纳秒时可能为0，会和开始时间的初始值相同，所以为0的时候要改为1。
2. count一下同步器，这个时候前面start函数中被await的线程即可执行完方法。
3. 在时间轮状态为已启动时，进行轮询：
   1. waitForNextTick() 获取指针指向下一格的时间，如果还没到就进行sleep。
   2. 下一格时间到了即为当前格，先确定当前格的在时间轮数组中的index
   3. processCancelledTasks()将取消队列中的任务删除掉（取消队列中的任务是通过任务包装类HashedWheelTimeout的cancel方法将其加入到取消队列中的）
   4. transferTimeoutsToBuckets()将挂起队列中的前10W个任务通过前面的时间轮算法，获取到对应的轮次和index，然后将其放置到对应桶HashedWheelBucket中。
   5. bucket.expireTimeouts(deadline) 遍历执行当前桶中的所有到时间的任务,如果时间没到的任务对应轮次减一，如果任务已取消，那么就进行删除
4. 如果时间轮被终止了，那么需要把所有桶中已经分派的任务收集到未执行队列中，然后把挂起队列中的任务也放入到未执行队列中。（这些未执行的任务可以通过时间轮实例让外界可以获取到）
5. processCancelledTasks()清空掉已取消的任务

ps: Kafka也有相关时间轮的实现，参考TimingWheel类