// Stat Buddy, the AI tutor. With the visitor's own Claude API key it calls Claude straight from the browser,
// through the official Anthropic SDK (bundled in assets/vendor). Otherwise it asks the site's free shared
// tutor Worker (worker/) when SHARED_TUTOR_URL is set. With neither, it answers from this guide's key terms
// and lessons.
import { $, esc, store, setPressed } from "./util.js";
import { MODEL, LEVEL_NOTES, buildRequest } from "./tutor-prompt.js";
import { SHARED_TUTOR_URL } from "./config.js";

const GREETING = "Hi! I'm **Stat Buddy**. Ask me anything about AP Statistics and I'll explain it in simple words. Not sure where to start? Tap a question below.";

const SUGGESTIONS = [
  "What is a p-value, in simple words?",
  "Explain standard deviation using pizza",
  "How do I pick the right test?",
  "Why isn't correlation the same as causation?",
  "What goes in the Conclude step?",
  "Help me understand z-scores",
];

// Extra ways people ask about a term, for the no-key study-guide answers.
const ALIASES = {
  sd: ["sd", "standard deviation", "spread", "variability", "deviation"],
  lsrl: ["regression", "regression line", "line of best fit", "best fit", "lsrl", "least squares"],
  pvalue: ["p value", "pvalue", "p val"],
  ci: ["confidence interval", "interval", "confidence intervals"],
  clt: ["central limit", "clt"],
  hypothesis: ["hypothesis", "hypotheses", "null", "alternative", "h0", "ha"],
  chisquare: ["chi square", "chi squared", "chi"],
  tdist: ["t distribution", "t test", "t score", "student t"],
  zscore: ["z score", "z scores", "zscore", "standardize", "standardized"],
  empirical: ["68 95 99 7", "empirical rule", "68 95"],
  correlation: ["correlation", "correlated", "r value", "causation"],
  mean: ["mean", "average", "averages"],
  normal: ["normal", "bell curve", "bell shaped", "normal curve"],
  iqr: ["iqr", "interquartile"],
  srs: ["srs", "simple random"],
  randomassign: ["random assignment", "randomly assigned", "randomly assign"],
  type1: ["type i", "type 1", "false positive"],
  type2: ["type ii", "type 2", "false negative"],
  df: ["degrees of freedom", "df"],
  expected: ["expected value", "ev"],
  marginoferror: ["margin of error", "moe"],
  conditions: ["conditions", "condition", "10 percent", "large counts", "assumptions"],
  r2: ["r squared", "r2", "r²", "coefficient of determination"],
  standarderror: ["standard error", "se"],
};

const norm = (s) => s.toLowerCase().replace(/[‐-―−-]/g, " ").replace(/[^a-z0-9²\s]/g, " ").replace(/\s+/g, " ").trim();

export function startTutor({ terms, units }) {
  const log = $("#chat-log");
  const form = $("#chat-form");
  const input = $("#chat-in");
  const sendBtn = $("#chat-send");
  const suggest = $("#chat-suggest");
  const levelChips = $(".chat-level");
  const keybox = $("#keybox");

  let key = store.get("key", null, "session") || store.get("key", null);
  let history = [];         // messages exactly as sent to the API, append-only
  let level = "simple";     // what the student picked
  let appliedLevel = "simple"; // what the conversation has been told so far
  let stop = null;          // cancels the answer in progress
  let busy = false;
  let sdk = null;
  let toldAboutKey = false;
  const shared = Boolean(SHARED_TUTOR_URL);
  // A random id for this page visit, so the Worker can share its rate limit fairly between students on
  // one school network. It isn't stored anywhere.
  const visitor = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);

  /* ---------- rendering ---------- */
  function bubble(role, html, extraClass = "") {
    const el = document.createElement("div");
    el.className = `msg msg-${role} ${extraClass}`.trim();
    el.innerHTML = html;
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  // A tiny, safe Markdown subset: escape first, then paragraphs, lists, **bold**, *italic* and `code`.
  function md(text) {
    const inline = (s) => esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    const out = [];
    let list = null;
    let para = [];
    const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; };
    const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; };
    for (const raw of text.split("\n")) {
      const line = raw.trimEnd();
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
      const head = line.match(/^#{1,6}\s+(.*)$/);
      if (bullet || num) {
        flushPara();
        const tag = bullet ? "ul" : "ol";
        if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
        list.items.push((bullet || num)[1]);
      } else if (!line.trim()) {
        flushPara(); flushList();
      } else if (head) {
        flushPara(); flushList();
        out.push(`<p><strong>${inline(head[1])}</strong></p>`);
      } else {
        flushList();
        para.push(line);
      }
    }
    flushPara(); flushList();
    return out.join("");
  }

  function greet() {
    log.innerHTML = "";
    bubble("bot", md(GREETING));
    suggest.innerHTML = SUGGESTIONS.map((s) => `<button class="chip" type="button">${esc(s)}</button>`).join("");
    suggest.hidden = false;
  }

  function setBusy(on) {
    busy = on;
    sendBtn.classList.toggle("stop", on);
    sendBtn.setAttribute("aria-label", on ? "Stop" : "Send");
    sendBtn.querySelector("use").setAttribute("href", on ? "#i-stop" : "#i-send");
  }

  function showKeyState(note, tone) {
    const on = Boolean(key);
    keybox.classList.toggle("on", on);
    $("#chat-mode").textContent = on ? "AI tutor · Claude, with your key" : shared ? "Free AI tutor · ask anything" : "Study-guide mode · connect Claude for full answers";
    $("#chat-mode").classList.toggle("on", on || shared);
    $("#key-sum").textContent = on ? "Using your own Claude API key" : shared ? "Optional: use your own Claude API key" : "Connect Claude for full AI answers";
    $("#key-forget").hidden = !on;
    const status = $("#key-status");
    status.textContent = note || "";
    status.className = `key-status ${tone || ""}`.trim();
  }

  /* ---------- study-guide answers (no key) ---------- */
  function guideAnswer(question) {
    const q = ` ${norm(question)} `;
    const scored = [];
    for (const t of terms) {
      const names = [norm(t.term.replace(/\(.*?\)/g, "")), ...(t.term.match(/\((.*?)\)/) ? [norm(t.term.match(/\((.*?)\)/)[1])] : []), ...(ALIASES[t.id] || []).map(norm)];
      let best = 0;
      for (const name of names) {
        if (!name) continue;
        const re = new RegExp(`\\s${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\s`);
        if (re.test(q)) best = Math.max(best, name.length + (name === names[0] ? 2 : 0));
      }
      if (best) scored.push([best, t]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const picks = scored.slice(0, 2).map(([, t]) => t);
    if (!picks.length) {
      return "I couldn't find that in my study guide. Try a stats word like **mean**, **p-value** or **confidence interval**. " +
        "For any question at all, connect Claude below and I can give you a full answer.";
    }
    return picks.map((t) => {
      const unit = units.find((u) => u.n === t.unit);
      const example = unit && JSON.stringify(unit.example).includes(`[[${t.id}`) ? `\n\n*Example:* ${unit.example.replace(/\[\[[a-z0-9]+\|([^\]]+)\]\]/g, "$1").replace(/\[\[([a-z0-9]+)\]\]/g, "$1")}` : "";
      return `**${t.term}:** ${t.def}${example}\n\nThis is part of Unit ${t.unit}${unit ? `, “${unit.kid}”` : ""}.`;
    }).join("\n\n");
  }

  /* ---------- Claude ---------- */
  async function client() {
    if (!sdk) sdk = (await import("./vendor/anthropic.js")).default;
    return new sdk({ apiKey: key, dangerouslyAllowBrowser: true });
  }

  // Adds the question, plus a level note if the level changed, and returns a function that takes them back
  // out (for when no answer comes).
  function addTurn(text) {
    const before = history.length;
    const prevLevel = appliedLevel;
    history.push({ role: "user", content: text });
    if (level !== appliedLevel) {
      history.push({ role: "system", content: LEVEL_NOTES[level] });
      appliedLevel = level;
    }
    return () => { history.length = before; appliedLevel = prevLevel; };
  }

  // After a mid-answer fallback to another model, only the text before the switch is echoed back,
  // plus everything after it (the audit-marker block itself is dropped).
  function forHistory(content) {
    const cut = content.map((b) => b.type).lastIndexOf("fallback");
    if (cut < 0) return content;
    return [...content.slice(0, cut).filter((b) => b.type === "text"), ...content.slice(cut + 1)];
  }

  function friendlyError(err) {
    if (!sdk) return "I couldn't load the AI part of the page. Check your internet and try again.";
    if (err instanceof sdk.AuthenticationError) return "That API key didn't work. Check that you copied the whole key, or connect a different one below.";
    if (err instanceof sdk.PermissionDeniedError) return "This API key isn't allowed to use Claude. Try a different key.";
    if (err instanceof sdk.RateLimitError) return "Lots of questions at once! Wait a few seconds and try again.";
    if (err instanceof sdk.APIConnectionError) return "I couldn't reach Claude. Check your internet connection and try again.";
    if (err instanceof sdk.BadRequestError && /credit/i.test(err.message)) return "This API key's account is out of credits. Add credits in the Claude Console, or use a different key.";
    if (err instanceof sdk.InternalServerError) return "Claude is having a hiccup right now. Please try again in a minute.";
    if (err instanceof sdk.APIError) return `Something went wrong (${err.status ?? "error"}). Please try again.`;
    return "Something went wrong. Please try again.";
  }

  async function askClaude(text, el) {
    const undo = addTurn(text);
    let shown = "";
    try {
      const anthropic = await client();
      const stream = anthropic.beta.messages.stream(buildRequest(history));
      stop = () => stream.abort();
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          shown += event.delta.text;
          el.innerHTML = md(shown);
          log.scrollTop = log.scrollHeight;
        }
      }
      const msg = await stream.finalMessage();
      if (msg.stop_reason === "refusal") {
        undo();
        el.innerHTML = md("I can't help with that one. Let's get back to statistics. What would you like to learn?");
        return;
      }
      history.push({ role: "assistant", content: forHistory(msg.content) });
      if (!shown.trim()) el.innerHTML = md("Hmm, I didn't come up with an answer. Could you ask that another way?");
      if (msg.stop_reason === "max_tokens") el.insertAdjacentHTML("beforeend", `<p class="msg-note">That answer got cut off. Ask me to keep going.</p>`);
    } catch (err) {
      undo();
      if (sdk && err instanceof sdk.APIUserAbortError) {
        el.innerHTML = shown ? md(shown) : "";
        el.insertAdjacentHTML("beforeend", `<p class="msg-note">Stopped.</p>`);
        return;
      }
      console.error(err);
      el.classList.add("msg-err");
      el.innerHTML = md(friendlyError(err));
      if (err instanceof sdk.AuthenticationError) { keybox.open = true; showKeyState("That key didn't work.", "bad"); }
    } finally {
      stop = null;
    }
  }

  /* ---------- the free shared tutor ---------- */
  // It takes and returns plain text; Claude's answers (from a visitor's own key) are reduced to their text.
  const plain = (m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : m.content.filter((b) => b.type === "text").map((b) => b.text).join(""),
  });

  async function askFree(text, el) {
    const undo = addTurn(text);
    const controller = new AbortController();
    stop = () => controller.abort();
    let shown = "";
    let cutOff = false;
    try {
      const res = await fetch(`${SHARED_TUTOR_URL}/v1/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-visitor-id": visitor },
        body: JSON.stringify({ messages: history.map(plain) }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const problem = (await res.json().catch(() => null))?.error;
        undo();
        if (problem?.type === "daily_limit") {
          el.innerHTML = `<p class="msg-note">Stat Buddy has used up today's free AI answers, so here's what the study guide says. Full answers are back tomorrow.</p>${md(guideAnswer(text))}`;
          return;
        }
        el.classList.add("msg-err");
        el.innerHTML = md(problem?.type === "busy" ? "Lots of questions at once! Wait a minute, then try again."
          : ["too_long", "bad_request"].includes(problem?.type) ? problem.message
          : "The free tutor isn't answering right now. Please try again in a minute.");
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const events = buffer.split("\n\n");
        buffer = events.pop();
        for (const event of events) {
          if (!event.startsWith("data: ")) continue;
          const data = JSON.parse(event.slice(6));
          if (data.text) {
            shown += data.text;
            el.innerHTML = md(shown);
            log.scrollTop = log.scrollHeight;
          }
          if (data.done && data.finish === "length") cutOff = true;
        }
      }
      if (!shown.trim()) {
        undo();
        el.innerHTML = md("Hmm, I didn't come up with an answer. Could you ask that another way?");
        return;
      }
      history.push({ role: "assistant", content: [{ type: "text", text: shown }] });
      if (cutOff) el.insertAdjacentHTML("beforeend", `<p class="msg-note">That answer got cut off. Ask me to keep going.</p>`);
    } catch (err) {
      undo();
      if (err.name === "AbortError") {
        el.innerHTML = shown ? md(shown) : "";
        el.insertAdjacentHTML("beforeend", `<p class="msg-note">Stopped.</p>`);
        return;
      }
      console.error(err);
      el.classList.add("msg-err");
      el.innerHTML = md("I couldn't reach the tutor. Check your internet connection and try again.");
    } finally {
      stop = null;
    }
  }

  async function send(raw) {
    const text = raw.trim();
    if (!text || busy) return;
    suggest.hidden = true;
    bubble("user", md(text));
    input.value = "";
    autosize();
    const el = bubble("bot", `<span class="typing" aria-label="Stat Buddy is typing"><i></i><i></i><i></i></span>`);
    setBusy(true);
    try {
      if (key) {
        await askClaude(text, el);
      } else if (shared) {
        await askFree(text, el);
      } else {
        await new Promise((r) => setTimeout(r, 350));
        el.innerHTML = `<p class="msg-tag"><svg class="ico" aria-hidden="true"><use href="#i-book"/></svg>From the study guide</p>${md(guideAnswer(text))}`;
        if (!toldAboutKey) {
          toldAboutKey = true;
          el.insertAdjacentHTML("beforeend", `<p class="msg-note">I'm in study-guide mode, so I can only look up words. <button class="link-btn" type="button" data-open-key>Connect Claude</button> for full answers to any question.</p>`);
        }
      }
    } finally {
      setBusy(false);
      log.scrollTop = log.scrollHeight;
    }
  }

  /* ---------- wiring ---------- */
  function autosize() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) { stop?.(); return; }
    send(input.value);
  });
  suggest.addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (c) send(c.textContent); });
  log.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-key]")) { keybox.open = true; $("#key-in").focus(); }
  });

  levelChips.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip || chip.dataset.level === level) return;
    setPressed(levelChips, chip);
    level = chip.dataset.level;
    store.set("level", level);
    bubble("bot", `<p class="msg-note">${level === "exam" ? "Okay! I'll add the AP exam words too." : "Okay! Back to super simple."}</p>`);
  });
  const savedLevel = store.get("level", "simple");
  if (savedLevel === "exam") $('[data-level="exam"]', levelChips).click();

  $("#chat-new").addEventListener("click", () => {
    stop?.();
    history = [];
    appliedLevel = "simple";
    toldAboutKey = false;
    greet();
    input.focus();
  });

  $("#key-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = $("#key-in").value.trim();
    if (!/^sk-ant-[\w-]{10,}$/.test(value)) { showKeyState("That doesn't look like a Claude API key. It should start with sk-ant-.", "bad"); return; }
    showKeyState("Checking the key…");
    key = value;
    try {
      // Looking up the model is free, and proves the key works before the first question.
      await (await client()).models.retrieve(MODEL);
    } catch (err) {
      if (sdk && (err instanceof sdk.AuthenticationError || err instanceof sdk.PermissionDeniedError || err instanceof sdk.NotFoundError)) {
        key = null;
        showKeyState(err instanceof sdk.NotFoundError ? "This key can't use the Claude model the tutor needs." : "That key didn't work. Check that you copied all of it.", "bad");
        return;
      }
      // A network hiccup isn't the key's fault: keep it and let the first question show any problem.
    }
    const keep = $("#key-keep").checked;
    store.del("key"); store.del("key", "session");
    store.set("key", key, keep ? undefined : "session");
    $("#key-in").value = "";
    showKeyState(keep ? "Connected, and remembered on this device. Ask away!" : "Connected for this visit. Ask away!", "ok");
    keybox.open = false;
    input.focus();
  });

  const forgetKey = () => {
    key = null;
    store.del("key"); store.del("key", "session");
    showKeyState("Disconnected. The key is forgotten.", "ok");
  };
  $("#key-forget").addEventListener("click", forgetKey);

  greet();
  showKeyState();

  return {
    ask(text) {
      $("#ask").scrollIntoView({ behavior: "smooth" });
      send(text);
    },
    forgetKey() {
      forgetKey();
      showKeyState();
    },
  };
}
