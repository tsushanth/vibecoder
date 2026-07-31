const COLS = 10;
const ROWS = 20;
const BLOCK_SIZE = 20;
const COLORS = [
    '#00f0f0',
    '#f0f000',
    '#a000f0',
    '#00f000',
    '#f00000',
    '#0000f0',
    '#f0a000'
];

const SHAPES = [
    [[1,1,1,1]],
    [[1,1],[1,1]],
    [[0,1,0],[1,1,1]],
    [[1,0,0],[1,1,1]],
    [[0,0,1],[1,1,1]],
    [[0,1,1],[1,1,0]],
    [[1,1,0],[0,1,1]]
];

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.nextCanvas = document.getElementById('nextCanvas');
        this.nextCtx = this.nextCanvas.getContext('2d');

        this.canvas.width = COLS * BLOCK_SIZE;
        this.canvas.height = ROWS * BLOCK_SIZE;
        this.nextCanvas.width = 4 * BLOCK_SIZE;
        this.nextCanvas.height = 4 * BLOCK_SIZE;

        this.board = this.createBoard();
        this.score = 0;
        this.lines = 0;
        this.level = 1;
        this.gameOver = false;
        this.paused = false;
        this.highScore = this.loadHighScore();

        this.currentPiece = null;
        this.nextPiece = null;
        this.dropCounter = 0;
        this.dropInterval = 1000;
        this.lastTime = 0;

        this.setupControls();
        this.setupKeyboard();
        this.updateDisplay();
        this.start();
    }

    createBoard() {
        return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    }

    loadHighScore() {
        const saved = localStorage.getItem('uzbloxHighScore');
        return saved ? parseInt(saved, 10) : 0;
    }

    saveHighScore() {
        if (this.score > this.highScore) {
            this.highScore = this.score;
            localStorage.setItem('uzbloxHighScore', this.highScore);
        }
    }

    createPiece() {
        const shapeIndex = Math.floor(Math.random() * SHAPES.length);
        return {
            shape: SHAPES[shapeIndex],
            color: COLORS[shapeIndex],
            x: Math.floor(COLS / 2) - Math.floor(SHAPES[shapeIndex][0].length / 2),
            y: 0
        };
    }

    start() {
        this.currentPiece = this.createPiece();
        this.nextPiece = this.createPiece();
        this.drawNext();
        this.update();
    }

    update(time = 0) {
        if (this.gameOver || this.paused) return;

        const deltaTime = time - this.lastTime;
        this.lastTime = time;
        this.dropCounter += deltaTime;

        if (this.dropCounter > this.dropInterval) {
            this.moveDown();
        }

        this.draw();
        requestAnimationFrame((t) => this.update(t));
    }

    draw() {
        this.ctx.fillStyle = '#1a1a2e';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.drawBoard();
        this.drawPiece(this.currentPiece);
        this.drawGhost();
    }

    drawBoard() {
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                if (this.board[y][x]) {
                    this.drawBlock(x, y, this.board[y][x]);
                }
            }
        }
    }

    drawBlock(x, y, color) {
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);

        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        this.ctx.fillRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE / 2, BLOCK_SIZE / 2);
    }

    drawPiece(piece) {
        piece.shape.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value) {
                    this.drawBlock(piece.x + x, piece.y + y, piece.color);
                }
            });
        });
    }

    drawGhost() {
        const ghost = { ...this.currentPiece };
        while (!this.collides(ghost)) {
            ghost.y++;
        }
        ghost.y--;

        ghost.shape.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value) {
                    this.ctx.strokeStyle = ghost.color;
                    this.ctx.lineWidth = 2;
                    this.ctx.strokeRect(
                        (ghost.x + x) * BLOCK_SIZE,
                        (ghost.y + y) * BLOCK_SIZE,
                        BLOCK_SIZE,
                        BLOCK_SIZE
                    );
                }
            });
        });
    }

    drawNext() {
        this.nextCtx.fillStyle = '#1a1a2e';
        this.nextCtx.fillRect(0, 0, this.nextCanvas.width, this.nextCanvas.height);

        const offsetX = Math.floor((4 - this.nextPiece.shape[0].length) / 2);
        const offsetY = Math.floor((4 - this.nextPiece.shape.length) / 2);

        this.nextPiece.shape.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value) {
                    this.nextCtx.fillStyle = this.nextPiece.color;
                    this.nextCtx.fillRect(
                        (offsetX + x) * BLOCK_SIZE,
                        (offsetY + y) * BLOCK_SIZE,
                        BLOCK_SIZE,
                        BLOCK_SIZE
                    );
                    this.nextCtx.strokeStyle = '#000';
                    this.nextCtx.lineWidth = 2;
                    this.nextCtx.strokeRect(
                        (offsetX + x) * BLOCK_SIZE,
                        (offsetY + y) * BLOCK_SIZE,
                        BLOCK_SIZE,
                        BLOCK_SIZE
                    );
                }
            });
        });
    }

    collides(piece) {
        return piece.shape.some((row, y) => {
            return row.some((value, x) => {
                if (!value) return false;
                const newX = piece.x + x;
                const newY = piece.y + y;
                return newX < 0 || newX >= COLS || newY >= ROWS ||
                       (newY >= 0 && this.board[newY][newX]);
            });
        });
    }

    merge() {
        this.currentPiece.shape.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value) {
                    const boardY = this.currentPiece.y + y;
                    const boardX = this.currentPiece.x + x;
                    if (boardY >= 0) {
                        this.board[boardY][boardX] = this.currentPiece.color;
                    }
                }
            });
        });
    }

    clearLines() {
        let linesCleared = 0;

        for (let y = ROWS - 1; y >= 0; y--) {
            if (this.board[y].every(cell => cell !== 0)) {
                this.board.splice(y, 1);
                this.board.unshift(Array(COLS).fill(0));
                linesCleared++;
                y++;
            }
        }

        if (linesCleared > 0) {
            this.lines += linesCleared;
            const points = [0, 100, 300, 500, 800];
            this.score += points[linesCleared] * this.level;
            this.level = Math.floor(this.lines / 10) + 1;
            this.dropInterval = Math.max(100, 1000 - (this.level - 1) * 100);
            this.updateDisplay();
        }
    }

    moveDown() {
        this.currentPiece.y++;
        if (this.collides(this.currentPiece)) {
            this.currentPiece.y--;
            this.merge();
            this.clearLines();
            this.currentPiece = this.nextPiece;
            this.nextPiece = this.createPiece();
            this.drawNext();

            if (this.collides(this.currentPiece)) {
                this.endGame();
            }
        }
        this.dropCounter = 0;
    }

    moveLeft() {
        if (this.gameOver || this.paused) return;
        this.currentPiece.x--;
        if (this.collides(this.currentPiece)) {
            this.currentPiece.x++;
        }
        this.draw();
    }

    moveRight() {
        if (this.gameOver || this.paused) return;
        this.currentPiece.x++;
        if (this.collides(this.currentPiece)) {
            this.currentPiece.x--;
        }
        this.draw();
    }

    rotate() {
        if (this.gameOver || this.paused) return;
        const rotated = this.currentPiece.shape[0].map((_, i) =>
            this.currentPiece.shape.map(row => row[i]).reverse()
        );
        const previous = this.currentPiece.shape;
        this.currentPiece.shape = rotated;

        let offset = 0;
        while (this.collides(this.currentPiece)) {
            this.currentPiece.x += offset;
            offset = -(offset + (offset > 0 ? 1 : -1));
            if (offset > this.currentPiece.shape[0].length) {
                this.currentPiece.shape = previous;
                return;
            }
        }
        this.draw();
    }

    hardDrop() {
        if (this.gameOver || this.paused) return;
        while (!this.collides(this.currentPiece)) {
            this.currentPiece.y++;
            this.score += 2;
        }
        this.currentPiece.y--;
        this.moveDown();
        this.updateDisplay();
    }

    togglePause() {
        if (this.gameOver) return;
        this.paused = !this.paused;
        document.getElementById('paused').classList.toggle('hidden', !this.paused);
        document.getElementById('pauseBtn').textContent = this.paused ? '▶ Resume' : '⏸ Pause';
        if (!this.paused) {
            this.lastTime = performance.now();
            this.update();
        }
    }

    endGame() {
        this.gameOver = true;
        this.saveHighScore();
        document.getElementById('finalScore').textContent = this.score;
        document.getElementById('gameOver').classList.remove('hidden');
        this.updateDisplay();
    }

    restart() {
        this.board = this.createBoard();
        this.score = 0;
        this.lines = 0;
        this.level = 1;
        this.gameOver = false;
        this.paused = false;
        this.dropCounter = 0;
        this.dropInterval = 1000;
        this.lastTime = 0;

        document.getElementById('gameOver').classList.add('hidden');
        document.getElementById('paused').classList.add('hidden');
        document.getElementById('pauseBtn').textContent = '⏸ Pause';

        this.updateDisplay();
        this.start();
    }

    updateDisplay() {
        document.getElementById('score').textContent = this.score;
        document.getElementById('level').textContent = this.level;
        document.getElementById('lines').textContent = this.lines;
        document.getElementById('highScore').textContent = this.highScore;
    }

    setupControls() {
        document.getElementById('leftBtn').addEventListener('click', () => this.moveLeft());
        document.getElementById('rightBtn').addEventListener('click', () => this.moveRight());
        document.getElementById('downBtn').addEventListener('click', () => this.moveDown());
        document.getElementById('rotateBtn').addEventListener('click', () => this.rotate());
        document.getElementById('dropBtn').addEventListener('click', () => this.hardDrop());
        document.getElementById('pauseBtn').addEventListener('click', () => this.togglePause());
        document.getElementById('newGameBtn').addEventListener('click', () => this.restart());
        document.getElementById('restartBtn').addEventListener('click', () => this.restart());

        let touchStartX = 0;
        let touchStartY = 0;

        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
        }, { passive: false });

        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            const deltaX = touchEndX - touchStartX;
            const deltaY = touchEndY - touchStartY;

            if (Math.abs(deltaX) > Math.abs(deltaY)) {
                if (Math.abs(deltaX) > 30) {
                    if (deltaX > 0) {
                        this.moveRight();
                    } else {
                        this.moveLeft();
                    }
                }
            } else {
                if (deltaY > 30) {
                    this.moveDown();
                } else if (Math.abs(deltaX) < 20 && Math.abs(deltaY) < 20) {
                    this.rotate();
                }
            }
        }, { passive: false });
    }

    setupKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (this.gameOver && e.key !== 'Enter') return;

            switch(e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    this.moveLeft();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.moveRight();
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.moveDown();
                    break;
                case 'ArrowUp':
                case ' ':
                    e.preventDefault();
                    this.rotate();
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (this.gameOver) {
                        this.restart();
                    } else {
                        this.hardDrop();
                    }
                    break;
                case 'p':
                case 'P':
                case 'Escape':
                    e.preventDefault();
                    this.togglePause();
                    break;
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new Game();
});
