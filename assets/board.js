// The hero's live Galton board: balls bounce left or right at each row of pegs and pile up into a bell curve.
// Labels track the live mean and how many balls land within one standard deviation of it.
import { reducedMotion } from "./util.js";

const ROWS = 14;
const STEP_MS = 72;      // time for a ball to fall one row
const SPAWN_MS = 55;     // a new ball this often
const MU = ROWS / 2;
const SIGMA = Math.sqrt(ROWS) / 2;
const pdf = (u) => Math.exp(-((u - MU) ** 2) / (2 * SIGMA * SIGMA)) / (SIGMA * Math.sqrt(2 * Math.PI));

export function startBoard(fig) {
  const stage = fig.querySelector("#board-stage");
  const canvas = fig.querySelector("#board-canvas");
  const pinLayer = fig.querySelector("#board-pins");
  const ctx = canvas.getContext("2d");
  const bins = new Array(ROWS + 1).fill(0);
  const balls = [];
  let g = null;
  let raf = 0;
  let last = 0;
  let spawnAcc = 0;
  let visible = true;
  let lastPins = 0;

  pinLayer.innerHTML = `
    <div class="pin" data-pin="count"><span class="pin-dot"></span><span class="pin-label"><b></b><span>dropped so far</span></span></div>
    <div class="pin" data-pin="mean"><span class="pin-dot"></span><span class="pin-label"><b>The mean (the middle)</b><span></span></span></div>
    <div class="pin" data-pin="sd"><span class="pin-dot"></span><span class="pin-label"><b>1 SD from the mean</b><span></span></span></div>`;
  const pins = Object.fromEntries([...pinLayer.children].map((p) => [p.dataset.pin, p]));

  // Start with a few hundred balls already landed, so the bell is there on the first frame.
  for (let n = 0; n < 320; n++) bins[binomialDraw()]++;

  function binomialDraw() {
    let k = 0;
    for (let i = 0; i < ROWS; i++) if (Math.random() < 0.5) k++;
    return k;
  }

  function layout() {
    const r = stage.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width;
    const H = r.height;
    const top = H * 0.13;
    const pegBottom = H * 0.5;
    const dy = (pegBottom - top) / ROWS;
    const dx = Math.min(dy * 2.2, (W * 0.6) / (ROWS + 1));
    g = { W, H, top, dy, dx, cx: W / 2, binTop: H * 0.54, binBottom: H * 0.9, ball: Math.max(2.2, Math.min(dx * 0.2, 4.5)) };
    draw();
    placePins(true);
  }

  const colX = (k, i) => g.cx + (k - i / 2) * g.dx;
  const rowY = (i) => g.top + i * g.dy;
  const binX = (u) => g.cx + (u - MU) * g.dx;

  function scaleMax() {
    const total = bins.reduce((a, b) => a + b, 0);
    return Math.max(...bins, total * pdf(MU) * 1.08, 1);
  }

  function stats() {
    const total = bins.reduce((a, b) => a + b, 0);
    const mean = bins.reduce((a, c, k) => a + c * k, 0) / total;
    const sd = Math.sqrt(bins.reduce((a, c, k) => a + c * (k - mean) ** 2, 0) / total);
    // Each bin covers [k - 0.5, k + 0.5]; count the part of it that falls within one SD of the mean.
    let within = 0;
    bins.forEach((c, k) => {
      const overlap = Math.max(0, Math.min(k + 0.5, mean + sd) - Math.max(k - 0.5, mean - sd));
      within += c * overlap;
    });
    return { total, mean, sd, share: within / total };
  }

  function placePins(force) {
    const now = performance.now();
    if (!force && now - lastPins < 300) return;
    lastPins = now;
    const s = stats();
    const max = scaleMax();
    const h = g.binBottom - g.binTop;
    const peakY = g.binBottom - (s.total * pdf(MU) / max) * h;
    const sdU = MU + SIGMA;
    const sdY = g.binBottom - (s.total * pdf(sdU) / max) * h;
    const narrow = g.W < 720;
    put(pins.count, g.cx + g.dx * 0.9, g.top - g.dy * 1.4, false);
    put(pins.mean, binX(MU), peakY - 10, true);
    put(pins.sd, binX(sdU) + 2, sdY - 6, false);
    pins.count.querySelector("b").textContent = `${(s.total + droppedOffset).toLocaleString()} balls`;
    pins.mean.querySelector(".pin-label span").textContent = "most balls land near it";
    pins.sd.querySelector(".pin-label span").textContent = `${Math.round(s.share * 100)}% land within 1 SD`;
    pins.sd.hidden = narrow && g.W < 420;
  }

  function put(pin, x, y, flip) {
    pin.style.left = `${x}px`;
    pin.style.top = `${y}px`;
    pin.classList.toggle("flip", flip);
  }

  // Halving the bins keeps the numbers readable on a long visit; this remembers the balls taken away.
  let droppedOffset = 0;

  function spawn() {
    const path = [];
    for (let i = 0; i < ROWS; i++) path.push(Math.random() < 0.5 ? 0 : 1);
    balls.push({ path, i: -1, k: 0, t: 0 });
  }

  function step(dt) {
    spawnAcc += dt;
    while (spawnAcc > SPAWN_MS) { spawn(); spawnAcc -= SPAWN_MS; }
    for (let b = balls.length - 1; b >= 0; b--) {
      const ball = balls[b];
      ball.t += dt / STEP_MS;
      while (ball.t >= 1) {
        ball.t -= 1;
        if (ball.i >= 0) ball.k += ball.path[ball.i];
        ball.i++;
        if (ball.i >= ROWS) { bins[ball.k]++; balls.splice(b, 1); break; }
      }
    }
    const total = bins.reduce((a, c) => a + c, 0);
    if (total > 4000) {
      for (let k = 0; k < bins.length; k++) { const half = Math.round(bins[k] / 2); droppedOffset += bins[k] - half; bins[k] = half; }
    }
  }

  function ballPos(ball) {
    const t = ball.t;
    if (ball.i < 0) {
      // Dropping out of the hopper onto the first peg.
      return [g.cx, rowY(0) - g.dy * 1.6 + t * g.dy * 1.6 - g.ball];
    }
    const k0 = ball.k;
    const x0 = colX(k0, ball.i);
    const y0 = rowY(ball.i) - g.ball;
    if (ball.i === ROWS - 1) {
      const k1 = k0 + ball.path[ball.i];
      const x1 = binX(k1);
      return [x0 + (x1 - x0) * Math.min(1, t * 2), y0 + (g.binTop - y0) * t * t - Math.sin(Math.PI * Math.min(1, t * 2)) * g.dy * 0.3];
    }
    const k1 = k0 + ball.path[ball.i];
    const x1 = colX(k1, ball.i + 1);
    const y1 = rowY(ball.i + 1) - g.ball;
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - Math.sin(Math.PI * t) * g.dy * 0.45];
  }

  function draw() {
    if (!g) return;
    const { W, H, dx } = g;
    ctx.clearRect(0, 0, W, H);

    // Faint guide lines across the whole band.
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, g.binBottom + 0.5);
    ctx.lineTo(W, g.binBottom + 0.5);
    ctx.stroke();

    // Hopper.
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.moveTo(g.cx - dx * 1.4, g.top - g.dy * 2.6);
    ctx.lineTo(g.cx - dx * 0.35, g.top - g.dy * 1.2);
    ctx.moveTo(g.cx + dx * 1.4, g.top - g.dy * 2.6);
    ctx.lineTo(g.cx + dx * 0.35, g.top - g.dy * 1.2);
    ctx.stroke();

    // Pegs.
    ctx.fillStyle = "rgba(236,236,241,0.28)";
    for (let i = 0; i < ROWS; i++) {
      for (let j = 0; j <= i; j++) {
        ctx.beginPath();
        ctx.arc(colX(j, i), rowY(i), 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Bars.
    const max = scaleMax();
    const h = g.binBottom - g.binTop;
    const grad = ctx.createLinearGradient(0, g.binTop, 0, g.binBottom);
    grad.addColorStop(0, "rgba(167,139,250,0.95)");
    grad.addColorStop(1, "rgba(124,77,235,0.25)");
    ctx.fillStyle = grad;
    const bw = dx * 0.78;
    bins.forEach((c, k) => {
      const bh = (c / max) * h;
      const x = binX(k) - bw / 2;
      const y = g.binBottom - bh;
      const r = Math.min(3, bw / 2, bh);
      ctx.beginPath();
      ctx.moveTo(x, g.binBottom);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.lineTo(x + bw - r, y);
      ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
      ctx.lineTo(x + bw, g.binBottom);
      ctx.fill();
    });

    // The normal curve the bars should follow, drawn across the whole band.
    const total = bins.reduce((a, b) => a + b, 0);
    const uMin = MU - g.cx / dx;
    const uMax = MU + (W - g.cx) / dx;
    ctx.beginPath();
    for (let px = 0; px <= W; px += 3) {
      const u = uMin + (px / W) * (uMax - uMin);
      const y = g.binBottom - (total * pdf(u) / max) * h;
      px ? ctx.lineTo(px, y) : ctx.moveTo(px, y);
    }
    ctx.strokeStyle = "rgba(236,236,241,0.6)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineTo(W, g.binBottom);
    ctx.lineTo(0, g.binBottom);
    ctx.closePath();
    ctx.fillStyle = "rgba(139,92,246,0.06)";
    ctx.fill();

    // Balls.
    for (const ball of balls) {
      const [x, y] = ballPos(ball);
      ctx.fillStyle = "rgba(167,139,250,0.22)";
      ctx.beginPath();
      ctx.arc(x, y, g.ball * 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#EDE7FF";
      ctx.beginPath();
      ctx.arc(x, y, g.ball, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame(now) {
    const dt = Math.min(64, now - (last || now));
    last = now;
    raf = requestAnimationFrame(frame);
    if (!g) return; // not laid out yet (the stage had no size)
    step(dt);
    draw();
    placePins(false);
  }

  function play() {
    if (raf || reducedMotion() || !visible || document.hidden) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function pause() { cancelAnimationFrame(raf); raf = 0; }

  new ResizeObserver(layout).observe(stage);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? play() : pause(); }).observe(stage);
  document.addEventListener("visibilitychange", () => (document.hidden ? pause() : play()));
  layout();
  play();
}
