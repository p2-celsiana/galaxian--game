// ==========================================
// 1. ELEMEN DOM & KONFIGURASI CANVAS
// ==========================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const GAME_WIDTH = canvas.width;   // 500
const GAME_HEIGHT = canvas.height; // 600

const scoreDisplay = document.getElementById('score-display');
const waveDisplay = document.getElementById('wave-display');
const hiDisplay = document.getElementById('hi-display');
const livesDisplay = document.getElementById('lives-display');

const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');

// ==========================================
// 2. WEB AUDIO API (SYNTHESIZER EFEK SUARA)
// ==========================================
let audioCtx;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

/**
 * Memainkan efek suara sintesis
 * @param {number} frequency - Frekuensi nada (Hz)
 * @param {string} type - 'square' (retro/shoot), 'sawtooth' (explosion/hit), 'sine' (powerup/heal), 'triangle' (UI)
 * @param {number} duration - Durasi suara dalam detik
 * @param {number} volume - Tingkat volume (0.0 - 1.0)
 */
function playSound(frequency, type, duration, volume = 0.1) {
    if (!audioCtx) return;

    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);

        gain.gain.setValueAtTime(volume, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
        console.log('Audio error:', e);
    }
}

// ==========================================
// 3. DEFINISI STATE & HIGH SCORE STORAGE
// ==========================================
const ALIEN_STATES = {
    FORMATION: 'FORMATION',     // Bergerak kiri-kanan bersama barisan
    DIVE_OUT: 'DIVE_OUT',       // Keluar dari barisan
    DIVE_ATTACK: 'DIVE_ATTACK', // Menukik menyerang & menembak
    RETURNING: 'RETURNING'      // Kembali ke posisi barisan awal
};

let gameState = 'START';
let player;
let aliens = [];
let playerBullets = [];
let alienBullets = [];
let score = 0;
let lives = 3;
let wave = 1;

// Membaca High Score dari LocalStorage
let highScore = parseInt(localStorage.getItem('galaxian_hi')) || 0;

let diveTimer = 120;
let formationDirection = 1;
let formationSpeed = 1;

const inputState = {
    left: false,
    right: false,
    fire: false
};

function saveHighScore() {
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('galaxian_hi', highScore.toString());
    }
}

// ==========================================
// 4. CLASS PLAYER & BULLET
// ==========================================
class Player {
    constructor() {
        this.width = 40;
        this.height = 20;
        this.x = GAME_WIDTH / 2 - this.width / 2;
        this.y = 540;
        this.speed = 5;
        this.cooldown = 0;
        this.invincible = 0;
    }

    update(inputState) {
        if (inputState.left && this.x > 0) {
            this.x -= this.speed;
        }
        if (inputState.right && this.x < GAME_WIDTH - this.width) {
            this.x += this.speed;
        }

        if (this.cooldown > 0) this.cooldown--;
        if (this.invincible > 0) this.invincible--;
    }

    draw(ctx) {
        // Efek kedip saat invincible
        if (this.invincible > 0 && Math.floor(this.invincible / 6) % 2 === 0) {
            return;
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(this.x, this.y + 10, this.width, 10);
        ctx.fillRect(this.x + 15, this.y, 10, 10);
        ctx.fillRect(this.x + 18, this.y - 5, 4, 5);

        ctx.fillStyle = '#00ffff';
        ctx.fillRect(this.x - 3, this.y + 15, 6, 5);
        ctx.fillRect(this.x + this.width - 3, this.y + 15, 6, 5);
    }

    shoot(bulletsArray) {
        if (this.cooldown <= 0) {
            bulletsArray.push(new Bullet(this.x + this.width / 2 - 2, this.y, -8, '#ffff00'));
            this.cooldown = 15;
            
            // Suara tembakan retro 8-bit (Square wave)
            playSound(880, 'square', 0.08, 0.05);
        }
    }
}

class Bullet {
    constructor(x, y, speed, color) {
        this.x = x;
        this.y = y;
        this.width = 4;
        this.height = 10;
        this.speed = speed;
        this.color = color;
        this.alive = true;
    }

    update() {
        this.y += this.speed;
        if (this.y < 0 || this.y > GAME_HEIGHT) {
            this.alive = false;
        }
    }

    draw(ctx) {
        if (!this.alive) return;
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.width, this.height);
    }
}

// ==========================================
// 5. CLASS ALIEN (FINITE STATE MACHINE)
// ==========================================
class Alien {
    constructor(homeX, homeY, type, row, col) {
        this.homeX = homeX;
        this.homeY = homeY;
        this.x = homeX;
        this.y = homeY;
        this.width = 30;
        this.height = 22;
        this.type = type;
        this.row = row;
        this.col = col;
        this.alive = true;
        this.points = (3 - type) * 100;

        this.state = ALIEN_STATES.FORMATION;
        this.diveProgress = 0;
        this.startX = homeX;
        this.startY = homeY;
        this.hasShot = false;
    }

    update(formationDirection, formationSpeed) {
        if (!this.alive) return;

        this.homeX += formationSpeed * formationDirection;

        if (this.state === ALIEN_STATES.FORMATION) {
            this.x = this.homeX;
            this.y = this.homeY;
        } else if (this.state === ALIEN_STATES.DIVE_OUT || this.state === ALIEN_STATES.DIVE_ATTACK) {
            this.updateDive();
        } else if (this.state === ALIEN_STATES.RETURNING) {
            this.updateReturn();
        }
    }

    updateDive() {
        this.diveProgress += 0.012;

        if (this.state === ALIEN_STATES.DIVE_OUT) {
            if (this.diveProgress < 0.15) {
                this.y = this.startY - this.diveProgress * 100;
            } else {
                this.state = ALIEN_STATES.DIVE_ATTACK;
                this.diveProgress = 0;
                this.startX = this.x;
                this.startY = this.y;
            }
        } 
        else if (this.state === ALIEN_STATES.DIVE_ATTACK) {
            const t = this.diveProgress;
            const amplitude = 80;
            this.x = this.startX + Math.sin(t * Math.PI * 2) * amplitude * (1 - t);
            this.y = this.startY + (GAME_HEIGHT + 50 - this.startY) * (t * t);

            // Alien menembak saat menukik
            if (!this.hasShot && t > 0.4 && t < 0.6) {
                alienBullets.push(new Bullet(this.x + this.width / 2 - 2, this.y + this.height, 5, '#ff0055'));
                this.hasShot = true;
                // Suara tembakan alien (Triangle wave)
                playSound(400, 'triangle', 0.1, 0.05);
            }

            if (this.y > GAME_HEIGHT + 30) {
                this.state = ALIEN_STATES.RETURNING;
                this.diveProgress = 0;
                this.y = -30;
            }
        }
    }

    updateReturn() {
        this.y += 3;
        if (this.x < this.homeX) {
            this.x = Math.min(this.homeX, this.x + 2);
        } else if (this.x > this.homeX) {
            this.x = Math.max(this.homeX, this.x - 2);
        }

        if (this.y >= this.homeY) {
            this.y = this.homeY;
            this.x = this.homeX;
            this.state = ALIEN_STATES.FORMATION;
        }
    }

    draw(ctx) {
        if (!this.alive) return;
        const colors = ['#ff0055', '#00ffff', '#00ff00'];
        ctx.fillStyle = colors[this.type];
        ctx.fillRect(this.x, this.y, this.width, this.height);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(this.x + 4, this.y + 4, this.width - 8, 4);
    }
}

// ==========================================
// 6. MANAJEMEN FORMASI & TRIGGER ATTACK
// ==========================================
function updateFormation() {
    let reachEdge = false;
    for (let a of aliens) {
        if (a.alive) {
            if ((formationDirection === 1 && a.homeX + a.width >= GAME_WIDTH - 15) ||
                (formationDirection === -1 && a.homeX <= 15)) {
                reachEdge = true;
                break;
            }
        }
    }
    if (reachEdge) {
        formationDirection *= -1;
    }
}

function triggerAlienDive() {
    diveTimer--;
    if (diveTimer <= 0) {
        const candidates = aliens.filter(a => a.alive && a.state === ALIEN_STATES.FORMATION);

        if (candidates.length > 0) {
            const randomAlien = candidates[Math.floor(Math.random() * candidates.length)];
            randomAlien.state = ALIEN_STATES.DIVE_OUT;
            randomAlien.diveProgress = 0;
            randomAlien.startX = randomAlien.x;
            randomAlien.startY = randomAlien.y;
            randomAlien.hasShot = false;

            diveTimer = Math.max(30, 120 - (wave * 10));
        }
    }
}

// ==========================================
// 7. BACKGROUND BINTANG
// ==========================================
const NUM_STARS = 200;
const stars = [];

function initStars() {
    stars.length = 0;
    for (let i = 0; i < NUM_STARS; i++) {
        stars.push({
            x: Math.random() * GAME_WIDTH,
            y: Math.random() * GAME_HEIGHT,
            speed: (Math.random() * 0.8 + 0.2) * 2,
            size: Math.random() < 0.3 ? 2 : 1
        });
    }
}

function updateStars() {
    for (let star of stars) {
        star.y += star.speed;
        if (star.y > GAME_HEIGHT) {
            star.y = 0;
            star.x = Math.random() * GAME_WIDTH;
        }
    }
}

function drawStars() {
    ctx.fillStyle = '#ffffff';
    for (let star of stars) {
        ctx.globalAlpha = 0.5 + (star.speed / 2) * 0.3;
        ctx.fillRect(star.x, star.y, star.size, star.size);
    }
    ctx.globalAlpha = 1.0;
}

// ==========================================
// 8. INPUT LISTENERS (KEYBOARD & TOUCH)
// ==========================================
window.addEventListener('keydown', function(e) {
    initAudio();
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') inputState.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') inputState.right = true;
    if (e.key === ' ' || e.key === 'Spacebar') inputState.fire = true;

    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
    }
});

window.addEventListener('keyup', function(e) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') inputState.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') inputState.right = false;
    if (e.key === ' ' || e.key === 'Spacebar') inputState.fire = false;
});

function setupTouchButton(buttonId, stateKey) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;

    const startAction = (e) => { 
        e.preventDefault(); 
        initAudio();
        // Suara klik UI (Triangle wave)
        playSound(500, 'triangle', 0.05, 0.03);
        inputState[stateKey] = true; 
        btn.classList.add('active'); 
    };
    const endAction = (e) => { 
        e.preventDefault(); 
        inputState[stateKey] = false; 
        btn.classList.remove('active'); 
    };

    btn.addEventListener('touchstart', startAction);
    btn.addEventListener('touchend', endAction);
    btn.addEventListener('touchcancel', endAction);
    btn.addEventListener('mousedown', startAction);
    btn.addEventListener('mouseup', endAction);
    btn.addEventListener('mouseleave', endAction);
}

setupTouchButton('btn-left', 'left');
setupTouchButton('btn-right', 'right');
setupTouchButton('btn-fire', 'fire');

// ==========================================
// 9. DETEKSI TABRAKAN, HUD & GAME OVER
// ==========================================
function isColliding(rect1, rect2) {
    return (
        rect1.x < rect2.x + rect2.width &&
        rect1.x + rect1.width > rect2.x &&
        rect1.y < rect2.y + rect2.height &&
        rect1.y + rect1.height > rect2.y
    );
}

function playerHit() {
    lives--;
    updateHUD();

    if (lives <= 0) {
        gameOver();
    } else {
        player.invincible = 120;
        // Suara benturan/hit (Sawtooth wave)
        playSound(150, 'sawtooth', 0.2, 0.1);
    }
}

function gameOver() {
    gameState = 'GAMEOVER';
    saveHighScore();
    
    // Suara game over panjang
    playSound(80, 'square', 0.5, 0.15);

    if (overlay) {
        overlay.classList.remove('hidden');
        if (startBtn) startBtn.textContent = 'MAIN LAGI';
    }
}

function checkCollisions() {
    // Peluru Player vs Alien
    for (let i = playerBullets.length - 1; i >= 0; i--) {
        let bullet = playerBullets[i];
        if (!bullet.alive) continue;

        for (let j = aliens.length - 1; j >= 0; j--) {
            let alien = aliens[j];
            if (alien.alive && isColliding(bullet, alien)) {
                alien.alive = false;
                bullet.alive = false;
                score += alien.points;
                
                // Suara ledakan kasar (Sawtooth wave)
                playSound(150, 'sawtooth', 0.2, 0.1);
                
                saveHighScore();
                updateHUD();
                checkWaveClear();
                break;
            }
        }
    }

    // Player vs Peluru/Alien
    if (player.invincible <= 0) {
        for (let i = alienBullets.length - 1; i >= 0; i--) {
            let bullet = alienBullets[i];
            if (bullet.alive && isColliding(bullet, player)) {
                bullet.alive = false;
                playerHit();
                break;
            }
        }

        for (let alien of aliens) {
            if (alien.alive && isColliding(alien, player)) {
                alien.alive = false;
                playerHit();
                break;
            }
        }
    }
}

function checkWaveClear() {
    const activeAliens = aliens.filter(a => a.alive);
    if (activeAliens.length === 0) {
        wave++;
        // Suara bonus/level up mulus (Sine wave)
        playSound(587, 'sine', 0.3, 0.1);
        setTimeout(() => {
            initAliens();
            updateHUD();
        }, 1000);
    }
}

function updateHUD() {
    if (scoreDisplay) scoreDisplay.textContent = 'SCORE: ' + String(score).padStart(4, '0');
    if (waveDisplay) waveDisplay.textContent = 'WAVE: ' + wave;
    if (hiDisplay) hiDisplay.textContent = 'HI: ' + String(highScore).padStart(4, '0');
    if (livesDisplay) livesDisplay.textContent = '♥ ' + Math.max(0, lives);
}

function updateAndDrawBullets(bulletArray) {
    for (let i = bulletArray.length - 1; i >= 0; i--) {
        let b = bulletArray[i];
        b.update();
        b.draw(ctx);
        if (!b.alive) {
            bulletArray.splice(i, 1);
        }
    }
}

function drawStartOrGameOverScreen() {
    ctx.fillStyle = 'white';
    ctx.font = '18px Courier New';
    ctx.textAlign = 'center';

    if (gameState === 'START') {
        ctx.fillText('TEKAN START UNTUK MAIN', GAME_WIDTH / 2, GAME_HEIGHT / 2);
    } else if (gameState === 'GAMEOVER') {
        ctx.fillStyle = '#ff0055';
        ctx.fillText('GAME OVER', GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20);
        ctx.fillStyle = 'white';
        ctx.fillText('SKOR AKHIR: ' + score, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 20);
    }
}

// ==========================================
// 10. GAME LOOP & INISIALISASI
// ==========================================
function initAliens() {
    aliens = [];
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 8; c++) {
            let type = r === 0 ? 0 : (r < 3 ? 1 : 2);
            let x = 70 + c * 45;
            let y = 60 + r * 40;
            aliens.push(new Alien(x, y, type, r, c));
        }
    }
}

function initGame() {
    player = new Player();
    playerBullets = [];
    alienBullets = [];
    score = 0;
    lives = 3;
    wave = 1;
    diveTimer = 120;
    formationDirection = 1;

    initAliens();
    updateHUD();
}

function gameLoop() {
    ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    updateStars();
    drawStars();

    if (gameState === 'PLAYING') {
        player.update(inputState);
        if (inputState.fire) {
            player.shoot(playerBullets);
        }

        updateFormation();
        triggerAlienDive();

        aliens.forEach(a => {
            a.update(formationDirection, formationSpeed);
            a.draw(ctx);
        });

        checkCollisions();

        player.draw(ctx);
        updateAndDrawBullets(playerBullets);
        updateAndDrawBullets(alienBullets);
    } else {
        drawStartOrGameOverScreen();
    }

    requestAnimationFrame(gameLoop);
}

// ==========================================
// 11. EVENT TOMBOL START
// ==========================================
if (startBtn) {
    startBtn.addEventListener('click', function() {
        initAudio();
        // Suara tombol UI (Sine wave)
        playSound(523.25, 'sine', 0.2, 0.1);
        initGame();
        gameState = 'PLAYING';
        if (overlay) overlay.classList.add('hidden');
    });
}

initStars();
initGame();
requestAnimationFrame(gameLoop);