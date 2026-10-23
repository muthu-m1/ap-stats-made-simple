// AP Stats, Made Simple: loads the guide's data and builds every section.
// The lab, the Galton board and the tutor live in their own modules.
import { esc, rich, store, $, $$, setPressed, wireTabs } from "./util.js";
import { startBoard } from "./board.js";
import { startLab } from "./lab.js";
import { startTutor } from "./tutor.js";

const load = (name) => fetch(`data/${name}.json`).then((r) => {
  if (!r.ok) throw new Error(`${name}.json: ${r.status}`);
  return r.json();
});

let terms = [];
let termById = new Map();
let tutor = null;

main().catch((err) => {
  console.error(err);
  $("#status").innerHTML = `<span>Something went wrong loading the lessons. Try reloading the page.</span>`;
});

async function main() {
  wireChrome();
  startBoard($("#board"));
  startLab();

  const [unitData, termList, tests, quiz, formulas] = await Promise.all(
    ["units", "terms", "tests", "quiz", "formulas"].map(load),
  );
  terms = termList;
  termById = new Map(terms.map((t) => [t.id, t]));

  tutor = startTutor({ terms, units: unitData.units });
  renderStats(unitData.units, terms, tests, quiz);
  renderUnits(unitData);
  renderTests(tests);
  renderQuiz(quiz);
  renderFormulas(formulas);
  renderTerms();
  wireSearch(unitData.units);
  wireTermPop();
  wireReveal();
}

/* ---------- Top bar, menu, floating Ask button ---------- */
function wireChrome() {
  const nav = $("#nav");
  const menu = $("#menu-btn");
  const closeMenu = () => { nav.classList.remove("open"); menu.setAttribute("aria-expanded", "false"); };
  menu.addEventListener("click", () => {
    const open = !nav.classList.contains("open");
    nav.classList.toggle("open", open);
    menu.setAttribute("aria-expanded", String(open));
  });
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

  $("#open-search").addEventListener("click", () => {
    $("#units").scrollIntoView({ behavior: "smooth" });
    setTimeout(() => $("#q").focus({ preventScroll: true }), 350);
  });

  // The floating button shows once the hero is gone, and hides again while the chat itself is on screen.
  const fab = $("#fab");
  const seen = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) seen.set(e.target.id, e.isIntersecting);
    fab.hidden = Boolean(seen.get("top") || seen.get("ask"));
  }, { threshold: 0.05 });
  io.observe($("#top"));
  io.observe($("#ask"));
  fab.addEventListener("click", (e) => {
    e.preventDefault();
    $("#ask").scrollIntoView({ behavior: "smooth" });
    setTimeout(() => $("#chat-in").focus({ preventScroll: true }), 450);
  });

  $("#clear").addEventListener("click", () => {
    store.clearAll();
    tutor?.forgetKey();
    quizReset?.();
    $("#cleared").textContent = "Done. Everything this site saved in your browser is gone.";
  });
}

function wireReveal() {
  const els = $$(".sec-head, .toolbar, .exp, .pick, .test, .chat, .qcard, .formula-list, .term-grid, .block");
  if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -8% 0px" });
  for (const el of els) {
    if (el.getBoundingClientRect().top > innerHeight) { el.classList.add("rv"); io.observe(el); }
  }
}

/* ---------- Stats strip ---------- */
function renderStats(units, terms, tests, quiz) {
  const items = [
    [units.length, "Units, the whole course"],
    [terms.length, "Key terms in plain words"],
    [tests.length, "Tests, step by step"],
    [quiz.length, "Practice questions"],
  ];
  $("#stats").innerHTML = items.map(([n, label]) => `<div><dt>${esc(label)}</dt><dd>${n}</dd></div>`).join("");
}

/* ---------- Units ---------- */
let unitFilter = { group: "all", q: "" };

function renderUnits({ groups, units }) {
  const list = $("#unit-list");
  const groupLabel = Object.fromEntries(groups.map((g) => [g.id, g.label]));
  list.innerHTML = units.map((u) => `
    <li class="row" id="unit-${u.n}" data-group="${u.group}">
      <button class="row-head" type="button" aria-expanded="false" aria-controls="unit-${u.n}-body">
        <span class="u-num"><b>Unit <span>${u.n}</span></b><small>${esc(u.weight)} of the exam</small></span>
        <span class="u-title"><strong>${esc(u.kid)}</strong><span>${esc(u.title)}</span></span>
        <span class="u-group">${esc(groupLabel[u.group])}</span>
        <svg class="ico" aria-hidden="true"><use href="#i-chev"/></svg>
      </button>
      <div class="row-body" id="unit-${u.n}-body" hidden>
        <p class="u-sum">${rich(u.summary, termById)}</p>
        <div class="callout"><p class="callout-k"><svg class="ico" aria-hidden="true"><use href="#i-spark"/></svg>Like this</p><p>${rich(u.example, termById)}</p></div>
        <p class="ideas-h">The big ideas</p>
        <ol class="ideas">${u.ideas.map((i) => `<li>${rich(i, termById)}</li>`).join("")}</ol>
        <div class="callout warn"><p class="callout-k"><svg class="ico" aria-hidden="true"><use href="#i-warn"/></svg>Watch out</p><p>${rich(u.watch, termById)}</p></div>
        <div class="u-actions">
          <button class="btn" type="button" data-ask="${esc(u.ask)}"><svg class="ico" aria-hidden="true"><use href="#i-chat"/></svg>Ask: “${esc(u.ask)}”</button>
          <a class="btn btn-ghost" href="#practice" data-practice="${u.n}">Practice Unit ${u.n}</a>
        </div>
      </div>
    </li>`).join("");

  list.addEventListener("click", (e) => {
    const head = e.target.closest(".row-head");
    if (head) { toggleRow(head); return; }
    const ask = e.target.closest("[data-ask]");
    if (ask) { tutor.ask(ask.dataset.ask); return; }
    const prac = e.target.closest("[data-practice]");
    if (prac) { e.preventDefault(); showPractice(prac.dataset.practice); }
  });
  toggleRow($(".row-head", list), true);

  const counts = { all: units.length };
  for (const u of units) counts[u.group] = (counts[u.group] || 0) + 1;
  const chips = [["all", "All units"], ...groups.map((g) => [g.id, g.label])];
  const bar = $("#f-group");
  bar.innerHTML = chips.map(([id, label]) =>
    `<button class="chip" type="button" data-group="${id}" aria-pressed="${id === "all"}">${esc(label)} <span class="count">${counts[id]}</span></button>`).join("");
  bar.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    unitFilter.group = chip.dataset.group;
    setPressed(bar, chip);
    filterUnits(units);
  });

  const q = $("#q");
  const clear = $("#clear-q");
  q.addEventListener("input", () => { unitFilter.q = q.value; clear.hidden = !q.value; filterUnits(units); });
  clear.addEventListener("click", () => { q.value = ""; unitFilter.q = ""; clear.hidden = true; filterUnits(units); q.focus(); });
  filterUnits(units);
}

function toggleRow(head, open) {
  const body = document.getElementById(head.getAttribute("aria-controls"));
  const show = open ?? head.getAttribute("aria-expanded") !== "true";
  head.setAttribute("aria-expanded", String(show));
  body.hidden = !show;
}

// A unit matches a search when its own text, or the definition of a key term it uses, contains the words.
function unitText(u) {
  const ids = [...JSON.stringify(u).matchAll(/\[\[([a-z0-9]+)/g)].map((m) => m[1]);
  const defs = ids.map((id) => termById.get(id)).filter(Boolean).map((t) => `${t.term} ${t.def}`);
  return [u.title, u.kid, u.summary, u.example, u.watch, ...u.ideas, ...defs].join(" ")
    .replace(/\[\[[a-z0-9]+\|([^\]]+)\]\]/g, "$1").replace(/\[\[([a-z0-9]+)\]\]/g, "$1");
}

function filterUnits(units) {
  const words = norm(unitFilter.q).split(" ").filter(Boolean);
  let shown = 0;
  for (const u of units) {
    const row = document.getElementById(`unit-${u.n}`);
    const text = norm(unitText(u));
    const ok = (unitFilter.group === "all" || u.group === unitFilter.group) && words.every((w) => text.includes(w));
    row.hidden = !ok;
    if (ok) shown++;
    if (ok && words.length) toggleRow($(".row-head", row), true);
  }
  const status = $("#status");
  if (!words.length && unitFilter.group === "all") { status.innerHTML = `<span><strong>${units.length}</strong> units. Open one to see its big ideas.</span>`; return; }
  status.innerHTML = shown
    ? `<span><strong>${shown}</strong> of ${units.length} units${words.length ? ` mention “${esc(unitFilter.q.trim())}”` : ""}.</span>`
    : `<span>No unit mentions “${esc(unitFilter.q.trim())}”. Try another word, or <button class="link-btn" type="button" id="ask-instead">ask Stat Buddy</button>.</span>`;
  $("#ask-instead")?.addEventListener("click", () => tutor.ask(`What is ${unitFilter.q.trim()} in statistics?`));
}

const norm = (s) => s.toLowerCase().replace(/[‐-―-]/g, " ").replace(/[^a-z0-9²χσμ\s]/g, " ").replace(/\s+/g, " ").trim();

/* ---------- Hero search ---------- */
function wireSearch(units) {
  $("#topics").innerHTML = [...terms.map((t) => t.term), ...units.map((u) => u.kid)]
    .map((s) => `<option value="${esc(s)}"></option>`).join("");

  const go = (raw) => {
    const q = raw.trim();
    if (!q) return;
    const n = norm(q);
    const term = terms.find((t) => norm(t.term) === n) ||
      terms.find((t) => norm(t.term).startsWith(n)) ||
      terms.find((t) => norm(t.term).includes(n));
    if (term) { showTerm(term.id); return; }
    const unit = units.find((u) => norm(u.kid) === n);
    $("#q").value = unit ? "" : q;
    unitFilter = { group: "all", q: unit ? "" : q };
    setPressed($("#f-group"), $('#f-group [data-group="all"]'));
    $("#clear-q").hidden = !$("#q").value;
    filterUnits(units);
    if (unit) toggleRow($(`#unit-${unit.n} .row-head`), true);
    (unit ? $(`#unit-${unit.n}`) : $("#units")).scrollIntoView({ behavior: "smooth" });
  };
  $("#hero-search").addEventListener("submit", (e) => { e.preventDefault(); go($("#hero-q").value); });
  $("#hint").addEventListener("click", (e) => {
    const b = e.target.closest("[data-try]");
    if (b) { $("#hero-q").value = b.dataset.try; go(b.dataset.try); }
  });
}

function showTerm(id) {
  const tq = $("#term-q");
  if (tq.value) { tq.value = ""; tq.dispatchEvent(new Event("input")); }
  const cell = document.getElementById(`term-${id}`);
  if (!cell) return;
  cell.scrollIntoView({ behavior: "smooth", block: "center" });
  cell.classList.remove("flash");
  void cell.offsetWidth;
  cell.classList.add("flash");
  setTimeout(() => cell.classList.remove("flash"), 2600);
}

/* ---------- Key-term popover ---------- */
function wireTermPop() {
  const pop = $("#term-pop");
  let current = null;
  const close = () => {
    if (!current) return;
    current.setAttribute("aria-expanded", "false");
    pop.hidden = true;
    current = null;
  };
  const open = (btn) => {
    const t = termById.get(btn.dataset.term);
    if (!t) return;
    if (current) current.setAttribute("aria-expanded", "false");
    current = btn;
    btn.setAttribute("aria-expanded", "true");
    $("#term-pop-title").textContent = t.term;
    $("#term-pop-def").textContent = t.def;
    $("#term-pop-link").dataset.term = t.id;
    $("#term-pop-ask").dataset.term = t.id;
    pop.hidden = false;
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth;
    const left = Math.max(16, Math.min(scrollX + r.left, scrollX + innerWidth - w - 16));
    const below = r.bottom + pop.offsetHeight + 12 < innerHeight;
    pop.style.left = `${left}px`;
    pop.style.top = `${scrollY + (below ? r.bottom + 10 : r.top - pop.offsetHeight - 10)}px`;
  };
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".term");
    if (btn) { e.preventDefault(); btn === current ? close() : open(btn); return; }
    if (!e.target.closest("#term-pop")) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && current) { const b = current; close(); b.focus(); }
  });
  $("#term-pop-link").addEventListener("click", (e) => { e.preventDefault(); const id = e.currentTarget.dataset.term; close(); showTerm(id); });
  $("#term-pop-ask").addEventListener("click", (e) => {
    const t = termById.get(e.currentTarget.dataset.term);
    close();
    tutor.ask(`What does "${t.term}" mean? Explain it simply, with an example.`);
  });
}

/* ---------- Tests ---------- */
function renderTests(tests) {
  $("#test-tabs").innerHTML = tests.map((t, i) =>
    `<button class="tab" role="tab" id="tt-${t.id}" aria-controls="tp-${t.id}" aria-selected="${i === 0}" ${i ? 'tabindex="-1"' : ""}>${esc(t.short)}</button>`).join("");
  $("#test-panels").innerHTML = tests.map((t, i) => `
    <div class="test" role="tabpanel" id="tp-${t.id}" aria-labelledby="tt-${t.id}" ${i ? "hidden" : ""}>
      <div class="test-intro">
        <p class="exp-k">Unit ${t.unit}</p>
        <h3>${esc(t.name)}</h3>
        <p class="test-when">${esc(t.when)}</p>
        <div class="test-q"><p class="exp-k">Example question</p><p>${esc(t.question)}</p></div>
        <button class="btn btn-ghost" type="button" data-ask-test="${t.id}"><svg class="ico" aria-hidden="true"><use href="#i-chat"/></svg>Ask Stat Buddy about this test</button>
      </div>
      <div class="test-body">
        <ol class="tl">${t.steps.map((s) => `<li><b>${esc(s.k)}</b><p>${esc(s.t)}</p></li>`).join("")}</ol>
      </div>
    </div>`).join("");
  wireTabs($("#test-tabs"));
  $("#test-panels").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ask-test]");
    if (!b) return;
    const t = tests.find((x) => x.id === b.dataset.askTest);
    tutor.ask(`When should I use a ${t.name}, and what are the conditions I have to check? Keep it simple.`);
  });
}

/* ---------- Practice ---------- */
let quizReset = null;
let showPractice = () => {};

function renderQuiz(quiz) {
  const saved = store.get("quiz", {});
  const list = $("#quiz");
  const letters = "ABCD";
  let unit = "all";

  list.innerHTML = quiz.map((q, i) => `
    <li class="qcard" id="q-${i}" data-unit="${q.unit}">
      <p class="q-meta"><span>Unit ${q.unit}</span><span>Question ${i + 1}</span></p>
      <p class="q-text">${esc(q.q)}</p>
      <ul class="choices">${q.choices.map((c, j) =>
        `<li><button class="choice" type="button" data-q="${i}" data-c="${j}"><span class="letter" aria-hidden="true">${letters[j]}</span><span>${esc(c)}</span></button></li>`).join("")}</ul>
      <div class="why" hidden></div>
    </li>`).join("");

  const mark = (i, pick) => {
    const q = quiz[i];
    const card = document.getElementById(`q-${i}`);
    const right = pick === q.a;
    card.classList.toggle("is-right", right);
    card.classList.toggle("is-wrong", !right);
    $$(".choice", card).forEach((b, j) => {
      b.disabled = true;
      b.classList.toggle("right", j === q.a);
      b.classList.toggle("wrong", j === pick && !right);
      if (j === pick) b.setAttribute("aria-label", `${q.choices[j]}: your answer, ${right ? "correct" : "not correct"}`);
    });
    const why = $(".why", card);
    why.hidden = false;
    why.innerHTML = `<p class="why-k ${right ? "right" : "wrong"}">${right ? "Yes! That's right." : `Not quite. The answer is ${letters[q.a]}.`}</p>
      <p>${esc(q.why)}</p>
      <button class="link-btn" type="button" data-explain="${i}">Ask Stat Buddy to explain more</button>`;
  };

  const score = () => {
    const visible = quiz.map((q, i) => i).filter((i) => unit === "all" || String(quiz[i].unit) === unit);
    const done = visible.filter((i) => i in saved);
    const right = done.filter((i) => saved[i] === quiz[i].a).length;
    $("#score").innerHTML = done.length
      ? `<b>${right}</b>right out of ${done.length} answered${done.length < visible.length ? ` · ${visible.length - done.length} to go` : ""} · <button class="link-btn" type="button" id="quiz-reset">Start over</button>`
      : `<b>${visible.length}</b>questions to try`;
  };

  for (const [i, pick] of Object.entries(saved)) if (quiz[i]) mark(Number(i), pick);

  list.addEventListener("click", (e) => {
    const b = e.target.closest(".choice");
    if (b && !b.disabled) {
      const i = Number(b.dataset.q);
      saved[i] = Number(b.dataset.c);
      store.set("quiz", saved);
      mark(i, saved[i]);
      score();
      return;
    }
    const ex = e.target.closest("[data-explain]");
    if (ex) {
      const q = quiz[Number(ex.dataset.explain)];
      tutor.ask(`Can you explain this practice question? "${q.q}" The right answer is "${q.choices[q.a]}". Why is that right, and why are the others wrong?`);
    }
  });

  quizReset = () => {
    for (const k of Object.keys(saved)) delete saved[k];
    store.del("quiz");
    $$(".qcard", list).forEach((card) => {
      card.classList.remove("is-right", "is-wrong");
      $(".why", card).hidden = true;
      $$(".choice", card).forEach((b) => { b.disabled = false; b.classList.remove("right", "wrong"); b.removeAttribute("aria-label"); });
    });
    score();
  };
  $("#score").addEventListener("click", (e) => { if (e.target.id === "quiz-reset") quizReset(); });

  const units = [...new Set(quiz.map((q) => q.unit))];
  const bar = $("#f-quiz");
  bar.innerHTML = [`<button class="chip" type="button" data-unit="all" aria-pressed="true">All <span class="count">${quiz.length}</span></button>`,
    ...units.map((u) => `<button class="chip" type="button" data-unit="${u}" aria-pressed="false">Unit ${u} <span class="count">${quiz.filter((q) => q.unit === u).length}</span></button>`)].join("");
  const setUnit = (u) => {
    unit = String(u);
    setPressed(bar, $(`[data-unit="${unit}"]`, bar));
    $$(".qcard", list).forEach((c) => { c.hidden = unit !== "all" && c.dataset.unit !== unit; });
    score();
  };
  bar.addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (c) setUnit(c.dataset.unit); });
  showPractice = (u) => { setUnit(u); $("#practice").scrollIntoView({ behavior: "smooth" }); };
  score();
}

/* ---------- Cheat sheet ---------- */
function renderFormulas(formulas) {
  $("#formula-list").innerHTML = formulas.map((f) =>
    `<li class="formula"><b>${esc(f.name)}</b><code>${esc(f.f)}</code><span>${esc(f.plain)}</span></li>`).join("");
}

/* ---------- Key terms ---------- */
function renderTerms() {
  const grid = $("#terms");
  grid.innerHTML = terms.map((t) =>
    `<div id="term-${t.id}"><dt>${esc(t.term)}</dt><dd>${esc(t.def)}</dd><dd class="t-unit">Unit ${t.unit}</dd></div>`).join("");
  const input = $("#term-q");
  input.addEventListener("input", () => {
    const n = norm(input.value);
    let shown = 0;
    for (const t of terms) {
      const ok = !n || norm(`${t.term} ${t.def}`).includes(n);
      document.getElementById(`term-${t.id}`).hidden = !ok;
      if (ok) shown++;
    }
    $("#terms-empty").hidden = shown > 0;
  });
}
