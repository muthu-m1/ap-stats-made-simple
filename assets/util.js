// Small helpers shared by every module.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Lesson text marks key terms as [[id]] or [[id|shown words]]; each becomes a button that opens the term's card.
export function rich(text, termById) {
  return esc(text).replace(/\[\[([a-z0-9]+)(?:\|([^\]]+))?\]\]/g, (_, id, label) =>
    termById.has(id)
      ? `<button class="term" type="button" data-term="${id}" aria-expanded="false" aria-controls="term-pop">${label ?? id}</button>`
      : (label ?? id));
}

export function setPressed(group, chip) {
  for (const c of group.querySelectorAll(".chip")) c.setAttribute("aria-pressed", String(c === chip));
}

// Tabs: click or arrow keys move between them; each tab shows the panel it controls.
export function wireTabs(list, onChange) {
  const tabs = () => [...list.querySelectorAll('[role="tab"]')];
  const select = (tab, focus) => {
    for (const t of tabs()) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    }
    if (focus) tab.focus();
    onChange?.(tab);
  };
  list.addEventListener("click", (e) => { const t = e.target.closest('[role="tab"]'); if (t) select(t); });
  list.addEventListener("keydown", (e) => {
    const all = tabs();
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select(all[(next + all.length) % all.length], true);
  });
}

// Browser storage can be missing or blocked (private windows, strict settings), so every call is guarded.
// Pass area "session" for values that should last only for this visit.
const PREFIX = "apstats.";
const pick = (area) => (area === "session" ? sessionStorage : localStorage);
export const store = {
  get(key, fallback, area) {
    try { const v = pick(area).getItem(PREFIX + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value, area) {
    try { pick(area).setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
  del(key, area) {
    try { pick(area).removeItem(PREFIX + key); } catch { /* storage unavailable */ }
  },
  clearAll() {
    for (const area of ["local", "session"]) {
      try {
        const s = pick(area);
        for (const k of Object.keys(s)) if (k.startsWith(PREFIX)) s.removeItem(k);
      } catch { /* storage unavailable */ }
    }
  },
};

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
