// The shared tutor: a Cloudflare Worker that answers Stat Buddy questions for free, using an open model on
// Workers AI and the free daily allowance of the Cloudflare account it runs on (when that runs out, it stops
// until the next day; it is never charged). It accepts requests only from the site, limits how often each
// visitor can ask, checks the conversation, and sets the instructions itself, so it can only be used as
// Stat Buddy. Answers stream back to the browser as `data: {"text": "..."}` events.
import { LEVEL_NOTES, SYSTEM } from "../../assets/tutor-prompt.js";

// Qwen3 30B-A3B: strong at step-by-step math, and cheap enough for a few hundred questions a day for free.
export const FREE_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
const MAX_ANSWER_TOKENS = 2000; // includes the model's thinking
const KEEP_MESSAGES = 16; // the model sees the most recent part of a long chat
const MAX_BODY_BYTES = 128 * 1024;
const MAX_MESSAGES = 60;
const MAX_QUESTION_CHARS = 4000;
const MAX_ANSWER_CHARS = 12000;
const NOTES = new Set(Object.values(LEVEL_NOTES));

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(origin)) return error(403, "forbidden", "This tutor only answers questions from the AP Stats, Made Simple site.");
    const cors = { "Access-Control-Allow-Origin": origin, Vary: "Origin" };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "content-type, x-visitor-id",
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/chat") {
      return error(404, "not_found", "Not found.", cors);
    }

    // Students on one school network share an IP address, so the per-visitor limit uses the page's random
    // visitor id. The global limit caps everyone together.
    const visitor = /^[\w-]{8,64}$/.test(request.headers.get("x-visitor-id") || "")
      ? request.headers.get("x-visitor-id")
      : request.headers.get("cf-connecting-ip") || "unknown";
    for (const [limiter, key] of [[env.PER_VISITOR, `v:${visitor}`], [env.GLOBAL, "all"]]) {
      if (limiter && !(await limiter.limit({ key })).success) {
        return error(429, "busy", "Too many questions right now. Wait a minute and try again.", cors);
      }
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return error(413, "too_long", "This conversation is too long. Start a new chat.", cors);
    let chat;
    try {
      chat = checkMessages(JSON.parse(raw).messages);
    } catch (e) {
      return error(400, "bad_request", e instanceof SyntaxError ? "That request wasn't valid JSON." : e.message, cors);
    }

    let upstream;
    try {
      upstream = await env.AI.run(FREE_MODEL, { messages: chat, stream: true, max_tokens: MAX_ANSWER_TOKENS });
    } catch (e) {
      if (/4006|daily free allocation|neurons/i.test(String(e?.message || e))) {
        return error(503, "daily_limit", "Stat Buddy has used up today's free answers. It will be back tomorrow.", cors);
      }
      return error(502, "ai_error", "The tutor couldn't get an answer right now. Please try again.", cors);
    }
    return new Response(upstream.pipeThrough(answerOnly()), {
      headers: { ...cors, "content-type": "text/event-stream", "cache-control": "no-store" },
    });
  },
};

// The conversation must look like one the site builds: questions and Stat Buddy's earlier answers as
// plain text, and only the site's own level notes as system messages. Returns what the model should see.
export function checkMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) throw new Error("There's no question to answer.");
  if (messages.length > MAX_MESSAGES) throw new Error("This conversation is too long. Start a new chat.");
  let prev = null;
  let level = null;
  const turns = [];
  for (const m of messages) {
    const text = typeof m?.content === "string" ? m.content : null;
    if (m?.role === "user" && text?.length > MAX_QUESTION_CHARS) throw new Error("That question is too long. Try a shorter one.");
    const ok =
      (m?.role === "user" && prev !== "user" && text?.trim()) ||
      (m?.role === "assistant" && prev && prev !== "assistant" && text !== null && text.length <= MAX_ANSWER_CHARS) ||
      (m?.role === "system" && prev === "user" && NOTES.has(text));
    if (!ok) throw new Error("That conversation doesn't look right. Start a new chat.");
    if (m.role === "system") level = text;
    else turns.push({ role: m.role, content: text });
    prev = m.role;
  }
  if (prev === "assistant") throw new Error("There's no question to answer.");
  // Keep the latest turns, starting on a question. The chosen explanation level goes in the instructions.
  let recent = turns.slice(-KEEP_MESSAGES);
  while (recent[0]?.role !== "user") recent = recent.slice(1);
  return [{ role: "system", content: level ? `${SYSTEM}\n\n${level}` : SYSTEM }, ...recent];
}

// Workers AI streams OpenAI-style chunks, with the model's thinking in `reasoning_content` and the answer in
// `content`. Pass on only the answer, and end with a `done` event.
export function answerOnly() {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let finish = null;
  const send = (controller, obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
  const handle = (controller, line) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk;
    try { chunk = JSON.parse(data); } catch { return; }
    const choice = chunk.choices?.[0];
    const text = choice?.delta?.content ?? (choice ? "" : chunk.response ?? "");
    if (text) send(controller, { text });
    if (choice?.finish_reason) finish = choice.finish_reason;
  };
  return new TransformStream({
    transform(bytes, controller) {
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) handle(controller, line.trim());
    },
    flush(controller) {
      handle(controller, buffer.trim());
      send(controller, { done: true, finish });
    },
  });
}

function error(status, type, message, headers = {}) {
  return new Response(JSON.stringify({ error: { type, message } }), {
    status,
    headers: { ...headers, "content-type": "application/json" },
  });
}
