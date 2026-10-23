// The stats lab: four small experiments drawn as SVG. Each keeps its own state and redraws from scratch.
import { $, setPressed, wireTabs } from "./util.js";

export function startLab() {
  wireTabs($("#lab-tabs"));
  for (const input of document.querySelectorAll('.lab input[type="range"]')) {
    const fill = () => input.style.setProperty("--fill", `${((input.value - input.min) / (input.max - input.min)) * 100}%`);
    input.addEventListener("input", fill);
    fill();
  }
  bellCurve();
  sampleMeans();
  confidence();
  bestFit();
}

/* ---------- shared bits ---------- */
const fmt = (x, d = 2) => (x < 0 ? "−" : "") + Math.abs(x).toFixed(d);
const plotLayer = (svg) => {
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  svg.append(g);
  return g;
};
function erf(x) {
  // Abramowitz and Stegun 7.1.26: accurate to about 1e-7, plenty for a picture.
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const phi = (z) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
function gauss() {
  let u = 0;
  while (!u) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

/* ---------- 1. Bell curve: area under the normal curve ---------- */
function bellCurve() {
  const svg = $("#bell-svg");
  const layer = plotLayer(svg);
  const input = $("#bell-z");
  const out = $("#bell-z-out");
  const modes = $("#bell-mode");
  let mode = "left";
  const X = (z) => 40 + ((z + 3.5) / 7) * 560;
  const BASE = 300;
  const Y = (z) => BASE - (phi(z) / phi(0)) * 230;

  const path = (from, to) => {
    let d = `M${X(from)},${BASE}`;
    for (let z = from; z <= to + 1e-9; z += 0.025) d += ` L${X(z).toFixed(1)},${Y(z).toFixed(1)}`;
    return `${d} L${X(to)},${Y(to).toFixed(1)} L${X(to)},${BASE} Z`;
  };

  function render() {
    const z = Number(input.value);
    out.textContent = fmt(z);
    const a = Math.abs(z);
    let from = -3.5, to = z, p = Phi(z);
    if (mode === "right") { from = z; to = 3.5; p = 1 - Phi(z); }
    if (mode === "between") { from = -a; to = a; p = Phi(a) - Phi(-a); }
    const pct = (p * 100).toFixed(1);
    const mid = Math.max(-3, Math.min(3, (from + to) / 2));
    const lines = mode === "between" ? [-a, a] : [z];

    layer.innerHTML = `
      ${[-3, -2, -1, 0, 1, 2, 3].map((t) => `<line class="grid" x1="${X(t)}" y1="${BASE}" x2="${X(t)}" y2="50"/>
        <text class="tick" x="${X(t)}" y="${BASE + 24}" text-anchor="middle">${t === 0 ? "0" : fmt(t, 0)}</text>`).join("")}
      ${to > from ? `<path class="shade" d="${path(from, to)}"/>` : ""}
      <path class="curve" d="${path(-3.5, 3.5).replace(/ L[\d.]+,300 Z$/, "")}"/>
      <line class="ax" x1="30" y1="${BASE}" x2="610" y2="${BASE}"/>
      ${lines.map((v) => `<line class="zline" x1="${X(v)}" y1="${BASE}" x2="${X(v)}" y2="${Y(v) - 14}"/>`).join("")}
      <text class="tick-hi" x="${X(z)}" y="${Y(z) - 22}" text-anchor="middle">z = ${fmt(z)}</text>
      <text x="${X(mid)}" y="${BASE - 40}" text-anchor="middle" style="fill:#fff;font:500 26px var(--serif)">${pct}%</text>
      <text class="lab-label" x="320" y="${BASE + 50}" text-anchor="middle">standard deviations from the mean</text>`;

    const zs = fmt(z);
    let msg;
    if (mode === "left") {
      msg = `About <b>${pct}%</b> of values are below z = ${zs}. If these were test scores, a z-score of ${zs} beats about ${Math.round(p * 100)}% of the class. That's its percentile.`;
    } else if (mode === "right") {
      msg = `About <b>${pct}%</b> of values are above z = ${zs}. ${z > 1.5 ? "Being out here is pretty unusual!" : "Slide right to see how fast the tail gets thin."}`;
    } else {
      const rule = { 1: "68", 2: "95", 3: "99.7" }[a.toFixed(2).replace(/\.00$/, "")];
      msg = `About <b>${pct}%</b> of values are within ${fmt(a)} standard deviations of the mean.${rule ? ` That's the “${rule}” in the 68–95–99.7 rule!` : " Try 1, 2 or 3 to see the 68–95–99.7 rule."}`;
    }
    $("#bell-read").innerHTML = msg;
  }

  input.addEventListener("input", render);
  modes.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    mode = chip.dataset.mode;
    setPressed(modes, chip);
    render();
  });
  render();
}

/* ---------- 2. Sample means: the central limit theorem ---------- */
function sampleMeans() {
  const svg = $("#clt-svg");
  const layer = plotLayer(svg);
  const nInput = $("#clt-n");
  const popChips = $("#clt-pop");
  const VALUES = Array.from({ length: 21 }, (_, i) => i);
  const SHAPES = {
    skew: (x) => Math.exp(-x / 4.5),
    flat: () => 1,
    two: (x) => Math.exp(-((x - 4) ** 2) / 4.5) + Math.exp(-((x - 16) ** 2) / 4.5),
  };
  let pop, cdf, mu, sigma;
  let means = [];
  let lastSample = [];
  const X = (v) => 40 + ((v + 0.5) / 21) * 560;

  function setPop(name) {
    const w = VALUES.map(SHAPES[name]);
    const total = w.reduce((a, b) => a + b, 0);
    pop = w.map((x) => x / total);
    let run = 0;
    cdf = pop.map((p) => (run += p));
    mu = VALUES.reduce((a, v, i) => a + v * pop[i], 0);
    sigma = Math.sqrt(VALUES.reduce((a, v, i) => a + (v - mu) ** 2 * pop[i], 0));
    means = [];
    lastSample = [];
  }
  const draw1 = () => {
    const u = Math.random();
    const i = cdf.findIndex((c) => u <= c);
    return VALUES[i < 0 ? VALUES.length - 1 : i];
  };
  const take = (count) => {
    const n = Number(nInput.value);
    for (let s = 0; s < count; s++) {
      const sample = Array.from({ length: n }, draw1);
      means.push(sample.reduce((a, b) => a + b, 0) / n);
      lastSample = sample;
    }
    render(count === 1);
  };

  function render(showSample) {
    const n = Number(nInput.value);
    $("#clt-n-out").textContent = n;
    const pmax = Math.max(...pop);
    const bw = 560 / 21;
    const top = [];
    VALUES.forEach((v, i) => {
      const h = (pop[i] / pmax) * 110;
      top.push(`<rect class="bar-pop" x="${X(v) - bw * 0.42}" y="${150 - h}" width="${bw * 0.84}" height="${h}" rx="2"/>`);
    });
    if (showSample) {
      const stack = {};
      for (const v of lastSample) {
        stack[v] = (stack[v] || 0) + 1;
        top.push(`<circle cx="${X(v)}" cy="${150 - stack[v] * 7}" r="3" style="fill:#fff"/>`);
      }
    }
    // Bottom: sample means in bins half a unit wide.
    const bins = new Array(41).fill(0);
    for (const m of means) bins[Math.round(m * 2)]++;
    const bmax = Math.max(5, ...bins);
    const lastBin = means.length ? Math.round(means[means.length - 1] * 2) : -1;
    const bw2 = 560 / 42;
    const bottom = bins.map((c, i) => {
      if (!c) return "";
      const h = (c / bmax) * 130;
      const x = X(i / 2) - bw2 * 0.45;
      return `<rect class="${i === lastBin && showSample ? "bar-new" : "bar-mean"}" x="${x}" y="${370 - h}" width="${bw2 * 0.9}" height="${h}" rx="1.5"/>`;
    }).join("");

    layer.innerHTML = `
      <text class="lab-label" x="40" y="24">The population${showSample ? ` · this sample's ${n} values in white` : ""}</text>
      ${top.join("")}
      <line class="ax" x1="30" y1="150" x2="610" y2="150"/>
      <line class="truth" x1="${X(mu)}" y1="34" x2="${X(mu)}" y2="150"/>
      <text class="lab-label-hi" x="${X(mu) + 6}" y="46">μ = ${mu.toFixed(2)}</text>
      <text class="lab-label" x="40" y="214">Sample means (n = ${n}) · ${means.length} so far</text>
      ${bottom}
      <line class="ax" x1="30" y1="370" x2="610" y2="370"/>
      <line class="truth" x1="${X(mu)}" y1="226" x2="${X(mu)}" y2="370"/>
      ${[0, 5, 10, 15, 20].map((v) => `<text class="tick" x="${X(v)}" y="392" text-anchor="middle">${v}</text>`).join("")}`;

    let msg;
    if (!means.length) {
      msg = `Press “Take 1 sample” to grab ${n} random value${n > 1 ? "s" : ""} from the population and find their mean.`;
    } else if (means.length < 2) {
      msg = `That sample's mean is <b>${means[0].toFixed(2)}</b>. One mean doesn't make a shape yet. Take 100 more!`;
    } else {
      const m = means.reduce((a, b) => a + b, 0) / means.length;
      const s = Math.sqrt(means.reduce((a, b) => a + (b - m) ** 2, 0) / (means.length - 1));
      msg = `The <b>${means.length}</b> sample means average <b>${m.toFixed(2)}</b>, close to the population mean μ = ${mu.toFixed(2)}. ` +
        `Their spread is <b>${s.toFixed(2)}</b>; the formula σ/√n predicts ${(sigma / Math.sqrt(n)).toFixed(2)}. ` +
        (n < 10 ? "Small samples still look a bit like the population. Slide n past 30 and start over to see the bell." : "Bigger samples give a skinnier, more bell-shaped pile.");
    }
    $("#clt-read").innerHTML = msg;
  }

  popChips.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    setPressed(popChips, chip);
    setPop(chip.dataset.pop);
    render(false);
  });
  nInput.addEventListener("input", () => { means = []; lastSample = []; render(false); });
  $("#clt-1").addEventListener("click", () => take(1));
  $("#clt-100").addEventListener("click", () => take(100));
  $("#clt-reset").addEventListener("click", () => { means = []; lastSample = []; render(false); });
  setPop("skew");
  render(false);
}

/* ---------- 3. Confidence intervals: how often the net catches the truth ---------- */
function confidence() {
  const svg = $("#ci-svg");
  const layer = plotLayer(svg);
  const nInput = $("#ci-n");
  const levels = $("#ci-level");
  const P = 0.6;
  const ZSTAR = { "0.80": 1.282, "0.90": 1.645, "0.95": 1.96, "0.99": 2.576 };
  let level = "0.95";
  let all = [];
  const X = (p) => 40 + ((p - 0.3) / 0.6) * 560;
  const clip = (p) => Math.max(0.3, Math.min(0.9, p));

  function make(count) {
    const n = Number(nInput.value);
    for (let i = 0; i < count; i++) {
      let yes = 0;
      for (let j = 0; j < n; j++) if (Math.random() < P) yes++;
      const ph = yes / n;
      const me = ZSTAR[level] * Math.sqrt((ph * (1 - ph)) / n);
      all.push({ ph, lo: ph - me, hi: ph + me });
    }
    render();
  }

  function render() {
    const n = Number(nInput.value);
    $("#ci-n-out").textContent = n;
    const shown = all.slice(-50);
    const gap = 330 / 50;
    const rows = shown.map((c, i) => {
      const y = 48 + i * gap;
      const hit = c.lo <= P && P <= c.hi;
      return `<line class="${hit ? "ci-hit" : "ci-miss"}" x1="${X(clip(c.lo))}" y1="${y}" x2="${X(clip(c.hi))}" y2="${y}"/>
        <circle class="ci-dot" cx="${X(clip(c.ph))}" cy="${y}" r="1.8"/>`;
    }).join("");
    layer.innerHTML = `
      ${[0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((t) => `<line class="grid" x1="${X(t)}" y1="40" x2="${X(t)}" y2="378"/>
        <text class="tick" x="${X(t)}" y="396" text-anchor="middle">${Math.round(t * 100)}%</text>`).join("")}
      ${rows}
      <line class="truth" x1="${X(P)}" y1="30" x2="${X(P)}" y2="380"/>
      <text class="tick-hi" x="${X(P)}" y="22" text-anchor="middle">True p = 60%</text>`;

    const hits = all.filter((c) => c.lo <= P && P <= c.hi).length;
    const want = Math.round(Number(level) * 100);
    $("#ci-read").innerHTML = all.length
      ? `<b>${hits}</b> of ${all.length} intervals caught the true 60% (<b>${Math.round((hits / all.length) * 100)}%</b>). At ${want}% confidence we expect about ${want}%. ` +
        `${all.length - hits ? `<span class="miss">${all.length - hits} missed.</span> ` : ""}Higher confidence makes wider nets; more students makes narrower ones.`
      : `Each sample asks ${n} random students. Its interval is p̂ ± z*·√(p̂(1 − p̂)/n). Press the button to make 25 of them.`;
  }

  levels.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    setPressed(levels, chip);
    level = chip.dataset.level;
    all = [];
    render();
  });
  nInput.addEventListener("input", () => { all = []; render(); });
  $("#ci-go").addEventListener("click", () => make(25));
  $("#ci-reset").addEventListener("click", () => { all = []; render(); });
  render();
}

/* ---------- 4. Line of best fit: least-squares regression ---------- */
function bestFit() {
  const svg = $("#line-svg");
  const layer = plotLayer(svg);
  const resToggle = $("#line-res");
  let pts = [];
  const X = (x) => 50 + (x / 10) * 560;
  const Y = (y) => 360 - (y / 10) * 340;

  const randomDots = () => {
    pts = Array.from({ length: 12 }, () => {
      const x = 0.6 + Math.random() * 8.8;
      return { x, y: Math.max(0.2, Math.min(9.8, 1.6 + 0.7 * x + gauss() * 1.1)) };
    });
  };

  function fit() {
    const n = pts.length;
    if (n < 2) return null;
    const mx = pts.reduce((a, p) => a + p.x, 0) / n;
    const my = pts.reduce((a, p) => a + p.y, 0) / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of pts) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); }
    if (sxx < 1e-9) return { vertical: true };
    const b = sxy / sxx;
    return { a: my - b * mx, b, r: syy > 1e-9 ? sxy / Math.sqrt(sxx * syy) : null };
  }

  function render() {
    const f = fit();
    const grid = [0, 2, 4, 6, 8, 10].map((t) => `
      <line class="grid" x1="${X(t)}" y1="20" x2="${X(t)}" y2="360"/><line class="grid" x1="50" y1="${Y(t)}" x2="610" y2="${Y(t)}"/>
      <text class="tick" x="${X(t)}" y="382" text-anchor="middle">${t}</text><text class="tick" x="40" y="${Y(t) + 4}" text-anchor="end">${t}</text>`).join("");
    let line = "";
    let res = "";
    if (f && !f.vertical) {
      line = `<line class="fit" x1="${X(0)}" y1="${Y(f.a)}" x2="${X(10)}" y2="${Y(f.a + f.b * 10)}" clip-path="url(#line-clip)"/>`;
      if (resToggle.checked) res = pts.map((p) => `<line class="res" x1="${X(p.x)}" y1="${Y(p.y)}" x2="${X(p.x)}" y2="${Y(f.a + f.b * p.x)}"/>`).join("");
    }
    layer.innerHTML = `<clipPath id="line-clip"><rect x="50" y="20" width="560" height="340"/></clipPath>
      ${grid}<line class="ax" x1="50" y1="360" x2="610" y2="360"/><line class="ax" x1="50" y1="20" x2="50" y2="360"/>
      ${res}${line}${pts.map((p) => `<circle class="pt" cx="${X(p.x)}" cy="${Y(p.y)}" r="6"/>`).join("")}`;

    let msg;
    if (!f) msg = `Click the graph to add at least 2 dots.`;
    else if (f.vertical) msg = `All the dots are stacked straight up and down, so there's no single best line. Spread them out left to right.`;
    else {
      const sign = f.b >= 0 ? "+" : "−";
      msg = `<b>${pts.length}</b> dots. Best line: <b>ŷ = ${f.a.toFixed(2)} ${sign} ${Math.abs(f.b).toFixed(2)}x</b>. ` +
        `For each 1 step to the right, the predicted y goes ${f.b >= 0 ? "up" : "down"} ${Math.abs(f.b).toFixed(2)}.`;
      if (f.r !== null) {
        const s = Math.abs(f.r);
        const strength = s >= 0.8 ? "strong" : s >= 0.5 ? "moderate" : s >= 0.3 ? "weak" : "very weak";
        msg += ` r = <b>${fmt(f.r)}</b> (${strength}, ${f.r >= 0 ? "positive" : "negative"}). r² = <b>${Math.round(f.r * f.r * 100)}%</b>: the line explains about that much of the ups and downs in y.`;
      }
    }
    $("#line-read").innerHTML = msg;
  }

  svg.addEventListener("click", (e) => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    if (p.x < 50 || p.x > 610 || p.y < 20 || p.y > 360) return;
    pts.push({ x: ((p.x - 50) / 560) * 10, y: ((360 - p.y) / 340) * 10 });
    render();
  });
  resToggle.addEventListener("change", render);
  $("#line-rand").addEventListener("click", () => { randomDots(); render(); });
  $("#line-undo").addEventListener("click", () => { pts.pop(); render(); });
  $("#line-clear").addEventListener("click", () => { pts = []; render(); });
  randomDots();
  render();
}
