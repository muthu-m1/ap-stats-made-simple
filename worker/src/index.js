// The shared tutor: a Cloudflare Worker that lets students talk to Stat Buddy without their own API key.
// It holds the site's Claude API key as a secret, accepts requests only from the site, limits how often
// each visitor can ask, checks the conversation, and builds the Claude request itself, so it can only
// ever be used as Stat Buddy. Answers stream straight back to the browser.
import Anthropic from "@anthropic-ai/sdk";
import { LEVEL_NOTES, buildRequest } from "../../assets/tutor-prompt.js";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_MESSAGES = 60;
const MAX_QUESTION_CHARS = 4000;
const ASSISTANT_BLOCKS = new Set(["text", "thinking", "redacted_thinking"]);
const NOTES = new Set(Object.values(LEVEL_NOTES));

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(origin)) return error(403, "permission_error", "This tutor only answers questions from the AP Stats, Made Simple site.");
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Expose-Headers": "x-should-retry, request-id",
      Vary: "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "content-type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/messages") {
      return error(404, "not_found_error", "Not found.", cors);
    }

    // Students on one school network share an IP address, so the per-visitor limit uses the page's random
    // visitor id. The global limit caps everyone together.
    const visitor = /^[\w-]{8,64}$/.test(request.headers.get("x-visitor-id") || "")
      ? request.headers.get("x-visitor-id")
      : request.headers.get("cf-connecting-ip") || "unknown";
    for (const [limiter, key] of [[env.PER_VISITOR, `v:${visitor}`], [env.GLOBAL, "all"]]) {
      if (limiter && !(await limiter.limit({ key })).success) {
        return error(429, "rate_limit_error", "Too many questions right now. Wait a minute and try again.", cors);
      }
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return error(413, "request_too_large", "This conversation is too long. Start a new chat.", cors);
    let messages;
    try {
      messages = checkMessages(JSON.parse(raw).messages);
    } catch (e) {
      return error(400, "invalid_request_error", e instanceof SyntaxError ? "That request wasn't valid JSON." : e.message, cors);
    }

    if (!env.ANTHROPIC_API_KEY) return error(500, "api_error", "The tutor's API key isn't set up.", cors);
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.UPSTREAM_URL || undefined, maxRetries: 1 });
    try {
      const upstream = await client.beta.messages.create({ ...buildRequest(messages), stream: true }).asResponse();
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { ...cors, "content-type": upstream.headers.get("content-type") || "text/event-stream", "cache-control": "no-store" },
      });
    } catch (err) {
      if (err instanceof Anthropic.APIError && err.status) {
        const detail = err.error?.error;
        // Never pass the account's own details along: keep the type, and a short message.
        return error(err.status, detail?.type || "api_error", detail?.message || "Claude returned an error.", cors);
      }
      return error(502, "api_error", "The tutor couldn't reach Claude.", cors);
    }
  },
};

// The conversation must look exactly like one the site builds: questions as plain text, Stat Buddy's
// own earlier answers, and only the site's own level notes as system messages.
function checkMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) throw new Error("There's no question to answer.");
  if (messages.length > MAX_MESSAGES) throw new Error("This conversation is too long. Start a new chat.");
  let prev = null;
  for (const m of messages) {
    const ok =
      (m?.role === "user" && prev !== "user" && typeof m.content === "string" && m.content.trim() && m.content.length <= MAX_QUESTION_CHARS) ||
      (m?.role === "assistant" && prev && prev !== "assistant" && Array.isArray(m.content) && m.content.every((b) => ASSISTANT_BLOCKS.has(b?.type))) ||
      (m?.role === "system" && prev === "user" && NOTES.has(m.content));
    if (!ok) throw new Error(m?.role === "user" && m.content?.length > MAX_QUESTION_CHARS ? "That question is too long. Try a shorter one." : "That conversation doesn't look right. Start a new chat.");
    prev = m.role;
  }
  if (prev === "assistant") throw new Error("There's no question to answer.");
  return messages.map(({ role, content }) => ({ role, content }));
}

function error(status, type, message, headers = {}) {
  return new Response(JSON.stringify({ type: "error", error: { type, message } }), {
    status,
    // The site's SDK would otherwise retry these on its own; the student should decide instead.
    headers: { ...headers, "content-type": "application/json", "x-should-retry": "false" },
  });
}
