var chess = document.getElementById('chess');
var context = chess.getContext('2d');
context.strokeStyle = '#bfbfbf';
var isBlack = true;//设置起手是黑（true）还是白（false）
var over = false;//棋局是否结束

//初始化界面（可以做个初始化函数，但是太麻烦了，所以游戏结束后直接重载页面）
var icon = new Image();
icon.src = '/assets/posts/2016-05-17-gobang/img/icon.png';
icon.onload = function() {
    context.drawImage(icon, 0, 0, 450, 450);
    drawChessBoard();
}
var drawChessBoard = function() {
    for (i = 0; i < 15; i++) {
        //画竖线
        context.moveTo(15, 15 + 30 * i);
        context.lineTo(435, 15 + 30 * i);
        context.stroke();
        //画横线
        context.moveTo(15 + 30 * i, 15);
        context.lineTo(15 + 30 * i, 435);
        context.stroke();
    }
}

//落子
var oneStep = function(i, j, black) {
    context.beginPath();
    context.arc(15 + i * 30, 15 + j * 30, 13, 0, 2 * Math.PI)
    context.closePath();
    var gradient = context.createRadialGradient(15 + i * 30 + 2, 15 + j * 30 + 2, 13, 15 + i * 30 + 2, 15 + j * 30 + 2, 0);
    if (black) {
        gradient.addColorStop(0, '#0a0a0a');
        gradient.addColorStop(1, '#636766');
    } else {
        gradient.addColorStop(0, '#d1d1d1');
        gradient.addColorStop(1, '#f9f9f9');
    }
    context.fillStyle = gradient;
    context.fill();
    isBlack = !isBlack;
}

//棋盘存放的棋子，0为无落子，1为玩家，2为电脑
var chessBoard = [];
for (var i = 0; i < 15; i++) {
    chessBoard[i] = [];
    for (var j = 0; j < 15; j++) {
        chessBoard[i][j] = 0;
    }
}
//三维数组，用来存放：横坐标，纵坐标，属于能连成五子的第几种方式
var wins = [];
for (var i = 0; i < 15; i++) {
    wins[i] = [];
    for (var j = 0; j < 15; j++) {
        wins[i][j] = [];
    }
}
var count = 0;
//纵向所有能连成五子线
for (var i = 0; i < 15; i++) {
    for (var j = 0; j < 11; j++) {
        for (var k = 0; k < 5; k++) {
            wins[i][j + k][count] = true;
        }
        count++;
    }
}
//横向所有能连成五子线
for (var i = 0; i < 11; i++) {
    for (var j = 0; j < 15; j++) {
        for (var k = 0; k < 5; k++) {
            wins[i + k][j][count] = true;
        }
        count++;
    }
}
//斜向所有能连成五子线
for (var i = 0; i < 11; i++) {
    for (var j = 0; j < 11; j++) {
        for (var k = 0; k < 5; k++) {
            wins[i + k][j + k][count] = true;
        }
        count++;
    }
}
//反斜向所有能连成五子线
for (var i = 0; i < 11; i++) {
    for (var j = 14; j > 3; j--) {
        for (var k = 0; k < 5; k++) {
            wins[i + k][j - k][count] = true;
        }
        count++;
    }
}

// console.log(count);打印一共有好多种连成五子的方式，或者说是获胜方式有好多种

var MyWin = [];//玩家的获胜数组，记录每一种获胜方式已落下的棋子数，任意一方式（数组元素）满五即获胜
var PCWin = [];//电脑的获胜数组
for (var i = 0; i < count; i++) {
    MyWin[i] = 0;
    PCWin[i] = 0;
}

chess.onclick = function(e) {
  if (over) {
    document.location.reload();
    return;
  }
    var x = e.offsetX;
    var y = e.offsetY;
    var i = Math.floor(x / 30);
    var j = Math.floor(y / 30);

    if (chessBoard[i][j] == 0) {
        oneStep(i, j, isBlack);
        chessBoard[i][j] = 1;
        for (var k = 0; k < count; k++) {
            if (wins[i][j][k]) {
                MyWin[k]++;
                PCWin[k] = 6;
                if (MyWin[k] == 5) {
                    window.alert('你赢了');
                    over = true;
                    return;
                }
            }
        }
    }
    AIstep();
}

//电脑的AI函数，通过计算最佳落子点，然后落子，统计获胜数组，判断是否结束游戏
var AIstep = function() {
    var MyScore = [];
    var PCScore = [];
    for (var i = 0; i < 15; i++) {
        MyScore[i] = [];
        PCScore[i] = [];
        for (var j = 0; j < 15; j++) {
            MyScore[i][j] = 0;
            PCScore[i][j] = 0;
        }
    }

    var max = 0;
    var u = 0,
        v = 0;
    for (var i = 0; i < 15; i++) {
        for (var j = 0; j < 15; j++) {
            for (var k = 0; k < count; k++) {
                if (wins[i][j][k]&&chessBoard[i][j]==0) {
                    //计算玩家在该点落子的分数
                    if (MyWin[k] == 1) {
                        MyScore[i][j] += 200;
                    }
                    if (MyWin[k] == 2) {
                        MyScore[i][j] += 400;
                    }
                    if (MyWin[k] == 3) {
                        MyScore[i][j] += 2000;
                    }
                    if (MyWin[k] == 4) {
                        MyScore[i][j] += 10000;
                    }
                    //计算电脑在该点落子的分数
                    if (PCWin[k] == 1) {
                        PCScore[i][j] += 220;
                    }
                    if (PCWin[k] == 2) {
                        PCScore[i][j] += 420;
                    }
                    if (PCWin[k] == 3) {
                        PCScore[i][j] += 2200;
                    }
                    if (PCWin[k] == 4) {
                        PCScore[i][j] += 12000;
                    }
                }
            }
            //获取玩家得分最高的落子坐标（最可能胜利的落子点）
            if (MyScore[i][j] > max) {
                max = MyScore[i][j];
                u = i;
                v = j;
            } else if (MyScore[i][j] == max) {
                if (PCScore[i][j] > PCScore[u][v]) {
                    u = i;
                    v = j;
                }
            }
            //获取电脑得分最高的落子坐标
            if (PCScore[i][j] > max) {
                max = PCScore[i][j];
                u = i;
                v = j;
            } else if (PCScore[i][j] == max) {
                if (MyScore[i][j] > MyScore[u][v]) {
                    u = i;
                    v = j;
                }
            }
            //无论u,v最后得到的是玩家的最高得分点（最容易获胜的一步棋），还是电脑最容易的最高得分点。电脑都会去u,v落子，因为在次落子可以阻挡玩家获胜，或者加快电脑获胜。
            //在同样的点上面，通过设置电脑获取的分数大一些，会导致电脑更愿意去将自己的棋子连成线，这样的话偏攻击；如果设置玩家获取的分数大一些，就会导致电脑更愿意去阻断玩家的棋子连成线，这样的话偏防守。
        }
    }
    //落子
    oneStep(u, v, isBlack);
    chessBoard[u][v] = 2;
    //统计
    for (var k = 0; k < count; k++) {
        if (wins[u][v][k]) {
            PCWin[k]++;
            MyWin[k] = 6;
            if (PCWin[k] == 5) {
                window.alert('电脑赢了');
                over = true;
                return;
            }
        }
    }
}
