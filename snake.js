/* =====================================================================================
        1. APPLICATION   — the game loop, input, snake/food state, collision, score.
                           (decides WHAT exists in the world this tick)
        2. GEOMETRY      — convert GRID coordinates (col,row) into pixel RECTANGLES on the
                           canvas, and handle the direction vectors + wall wrapping.
                           (decides WHERE on screen each cell lands)
        3. RASTERIZATION — fill those rectangles as actual pixels, the faint "ghost" LCD
                           grid behind them, and the segment dots — drawing the frame.
                           (decides WHICH pixels light up, and their colour)

   Two+ objects (assignment needs >= 2): the SNAKE (a chain of segments) and the FOOD,
   plus the LCD grid itself.

   Extras: gradual speed-up, a walls-wrap toggle, and a persistent high score.
   ===================================================================================== */

"use strict";

/* =====================================================================================
   SHARED SETUP
   ===================================================================================== */
const canvas = document.getElementById("lcd");
const ctx = canvas.getContext("2d");

// The playfield is a grid. Everything in the game thinks in (col,row) grid cells; only
// the GEOMETRY stage ever converts those to pixels.
const COLS = 20;
const ROWS = 16;
const CELL = canvas.width / COLS;          // pixel size of one cell (canvas is COLS*CELL wide)

// Authentic Nokia monochrome LCD palette: dark olive "on" pixels over a pale green panel.
const COLOR_LIT   = "#1f2d11";             // a lit pixel (snake / food / text)
const COLOR_GHOST = "rgba(31,45,17,0.08)"; // the faint unlit cell outline ("ghost" grid)

/* =====================================================================================
   STAGE 1 — APPLICATION
   -------------------------------------------------------------------------------------
   All game logic. Owns the snake, the food, the score, the input, and the fixed-timestep
   loop. It mutates the world in GRID space; the later stages only read it.
   ===================================================================================== */

// --- world state ---------------------------------------------------------------------
let snake;          // array of {x,y} grid cells; snake[0] is the head
let dir;            // current direction as a grid vector, e.g. {x:1,y:0} = moving right
let nextDir;        // buffered direction (applied at the next step; prevents 180° flips)
let food;           // {x,y} grid cell
let score;
let gameState;      // "ready" | "play" | "over"
let stepMs;         // milliseconds between snake steps (smaller = faster)

const BASE_STEP = 140;     // starting speed (ms per move)
const MIN_STEP  = 60;      // fastest the snake can get
const SPEEDUP   = 4;       // ms shaved off per food eaten (the "speed-up" extra)

// Options wired to the on-screen toggles.
const options = { wrap: false };   // wrap = pass through walls and reappear on the far side

// High score persists between sessions via localStorage. (Artifacts sandbox blocks
// localStorage, so we guard it in try/catch; on real GitHub Pages it works normally.)
function loadHighScore() {
  try { return parseInt(localStorage.getItem("nokiaSnakeHigh") || "0", 10) || 0; }
  catch (e) { return 0; }
}
function saveHighScore(v) {
  try { localStorage.setItem("nokiaSnakeHigh", String(v)); } catch (e) {/* sandbox: ignore */}
}
let highScore = loadHighScore();

// (Re)start a fresh game.
function reset() {
  snake = [ {x: 8, y: 8}, {x: 7, y: 8}, {x: 6, y: 8} ]; // 3-segment snake, facing right
  dir = {x: 1, y: 0};
  nextDir = {x: 1, y: 0};
  score = 0;
  stepMs = BASE_STEP;
  placeFood();
  gameState = "ready";
  syncHud();
}

// Drop food on a random EMPTY cell (never on top of the snake).
function placeFood() {
  let cell;
  do {
    cell = { x: (Math.random() * COLS) | 0, y: (Math.random() * ROWS) | 0 };
  } while (snake.some(s => s.x === cell.x && s.y === cell.y));
  food = cell;
}

// --- input: arrow keys / WASD, with a buffered turn so you can't reverse into yourself --
addEventListener("keydown", e => {
  const k = e.key.toLowerCase();
  const want =
    (k === "arrowup"    || k === "w") ? {x: 0, y: -1} :
    (k === "arrowdown"  || k === "s") ? {x: 0, y:  1} :
    (k === "arrowleft"  || k === "a") ? {x:-1, y:  0} :
    (k === "arrowright" || k === "d") ? {x: 1, y:  0} : null;

  if (want) {
    e.preventDefault();
    // Reject a 180° reversal (can't turn directly back onto your own neck).
    if (want.x !== -dir.x || want.y !== -dir.y) nextDir = want;
    if (gameState === "ready") gameState = "play";       // first arrow starts the game
  }
  if ((k === " " || k === "enter") && gameState === "over") reset();
});

// On-screen control buttons (mobile / mouse friendly).
function bindDir(id, vec) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("click", () => {
    if (vec.x !== -dir.x || vec.y !== -dir.y) nextDir = vec;
    if (gameState === "ready") gameState = "play";
    if (gameState === "over") reset();
  });
}
bindDir("up",    {x: 0, y: -1});
bindDir("down",  {x: 0, y:  1});
bindDir("left",  {x:-1, y:  0});
bindDir("right", {x: 1, y:  0});

document.getElementById("wrapToggle").addEventListener("change", e => {
  options.wrap = e.target.checked;
});
document.getElementById("restart").addEventListener("click", reset);

// Advance the simulation by exactly ONE step (called on the fixed timestep below).
function step() {
  if (gameState !== "play") return;

  dir = nextDir;                                   // commit the buffered turn

  // Compute the new head cell from the head + direction vector.
  let head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

  // Wall handling: wrap around, or die on impact.
  if (options.wrap) {
    head.x = (head.x + COLS) % COLS;
    head.y = (head.y + ROWS) % ROWS;
  } else if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) {
    return gameOver();
  }

  // Self-collision: hitting any existing segment ends the game.
  if (snake.some(s => s.x === head.x && s.y === head.y)) return gameOver();

  snake.unshift(head);                             // grow forward by adding the new head

  // Eat food? keep the tail (snake grows), spawn new food, bump score + speed.
  if (head.x === food.x && head.y === food.y) {
    score++;
    stepMs = Math.max(MIN_STEP, stepMs - SPEEDUP); // the "speed-up" extra
    placeFood();
  } else {
    snake.pop();                                   // otherwise drop the tail (move, not grow)
  }
  syncHud();
}

function gameOver() {
  gameState = "over";
  if (score > highScore) { highScore = score; saveHighScore(highScore); }
  syncHud();
}

// Mirror score/high-score into the HTML status bar.
function syncHud() {
  document.getElementById("score").textContent = String(score).padStart(3, "0");
  document.getElementById("high").textContent  = String(highScore).padStart(3, "0");
}

/* =====================================================================================
   STAGE 2 — GEOMETRY
   -------------------------------------------------------------------------------------
   The world lives in grid coordinates. This stage is the single place that maps a grid
   cell (col,row) to a pixel rectangle on the canvas. That mapping IS the geometry/
   transform stage — a scale (by CELL) plus a small inset so cells read as separate dots.
   ===================================================================================== */

const INSET = Math.max(1, Math.round(CELL * 0.12)); // gap between cells -> the LCD "dot" look

// Map one grid cell to a pixel rectangle {px,py,size}. Used by every draw call below.
function cellToRect(cx, cy) {
  return {
    px: cx * CELL + INSET,
    py: cy * CELL + INSET,
    size: CELL - INSET * 2,
  };
}

/* =====================================================================================
   STAGE 3 — RASTERIZATION
   -------------------------------------------------------------------------------------
   Turn the geometry into pixels on the LCD. Order each frame:
       1. clear the panel,
       2. draw the faint ghost grid (every unlit cell),
       3. draw the food,
       4. draw the snake segments,
       5. draw the "ready" / "game over" overlay text.
   Each cell is filled as a small rounded rectangle so it looks like a backlit LCD pixel.
   ===================================================================================== */

// Fill one grid cell as a rounded "pixel". This is the core rasterization primitive.
function rasterCell(cx, cy, color) {
  const r = cellToRect(cx, cy);                    // GEOMETRY: grid -> pixels
  ctx.fillStyle = color;
  const radius = r.size * 0.28;
  ctx.beginPath();
  ctx.roundRect(r.px, r.py, r.size, r.size, radius);
  ctx.fill();                                      // WRITE the pixels for this cell
}

function render() {
  // 1. clear to the bare LCD panel colour (CSS paints the panel; we clear to transparent).
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 2. ghost grid: every cell gets a faint outline so empty pixels are subtly visible,
  //    exactly like an unlit Nokia LCD segment.
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      rasterCell(x, y, COLOR_GHOST);
    }
  }

  // 3. food: a single lit cell, gently pulsing so it's easy to spot.
  const pulse = 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 300));
  ctx.globalAlpha = pulse;
  rasterCell(food.x, food.y, COLOR_LIT);
  ctx.globalAlpha = 1;

  // 4. snake: every segment is a lit cell; the head is drawn slightly darker/solid.
  for (let i = snake.length - 1; i >= 0; i--) {
    rasterCell(snake[i].x, snake[i].y, COLOR_LIT);
  }

  // 5. overlays for the non-playing states.
  if (gameState === "ready") lcdText("PRESS AN ARROW", "TO START");
  if (gameState === "over")  lcdText("GAME OVER", "SPACE / TAP = RETRY");
}

// Centered LCD-style text drawn straight onto the canvas (two lines).
function lcdText(line1, line2) {
  ctx.fillStyle = "rgba(31,45,17,0.14)";           // dim the field behind the text
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = COLOR_LIT;
  ctx.textAlign = "center";
  ctx.font = `700 ${Math.round(CELL * 1.1)}px "Press Start 2P", monospace`;
  ctx.fillText(line1, canvas.width / 2, canvas.height / 2 - CELL * 0.6);
  ctx.font = `400 ${Math.round(CELL * 0.7)}px "Press Start 2P", monospace`;
  ctx.fillText(line2, canvas.width / 2, canvas.height / 2 + CELL * 1.1);
  ctx.textAlign = "left";
}

/* =====================================================================================
   THE LOOP — fixed-timestep simulation, render every animation frame.
   -------------------------------------------------------------------------------------
   The snake STEPS on a fixed clock (stepMs), so its speed is independent of the monitor's
   refresh rate. Rendering happens every frame so the food pulse stays smooth. This is the
   pipeline in motion: APPLICATION (step) -> GEOMETRY + RASTERIZATION (render), repeat.
   ===================================================================================== */
let acc = 0, last = performance.now();
function loop(now) {
  const dt = now - last;
  last = now;

  acc += dt;
  while (acc >= stepMs) {        // [1] APPLICATION: advance one (or more) fixed steps
    step();
    acc -= stepMs;
  }

  render();                      // [2]+[3] GEOMETRY -> RASTERIZATION
  requestAnimationFrame(loop);
}

reset();
requestAnimationFrame(loop);