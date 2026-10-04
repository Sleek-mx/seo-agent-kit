// One model gateway for the SEO engine, in the Anthropic Messages shape on both ends
// (request: { system, messages, max_tokens }, response: { content: [{ type: "text", text }] }).
//
// Provider, picked from env:
//   ANTHROPIC_API_KEY                 -> Anthropic (LLM_MODEL, default claude-sonnet-5)
//   LLM_BASE_URL + LLM_API_KEY        -> any OpenAI-compatible chat API: OpenAI, OpenRouter,
//                                        DeepSeek, Ollama cloud (https://ollama.com/v1), local Ollama
//
// Optional AI observability: set POSTHOG_AI_KEY (your project's phc_ key) and every call is
// captured as a PostHog $ai_generation event (model, latency, tokens, errors). That is how you
// spot a retired model or a silent outage before it costs you a week of posts.

const MODEL = process.env.LLM_MODEL || (process.env.ANTHROPIC_API_KEY ? "claude-sonnet-5" : "deepseek-v4.1-flash");
const TIMEOUT = Number(process.env.LLM_TIMEOUT_MS || 300_000);
const AI_KEY = process.env.POSTHOG_AI_KEY || "";
const AI_HOST = (process.env.POSTHOG_AI_HOST || "https://us.i.posthog.com").replace(/\/$/, "");

function capture(props) {
  if (!AI_KEY) return;
  fetch(`${AI_HOST}/i/v0/e/`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: AI_KEY, event: "$ai_generation", distinct_id: "seo-engine", properties: { $ai_model: MODEL, $ai_span_name: process.argv[1]?.split("/").pop(), ...props } }),
  }).catch(() => {});
}

export async function createMessage({ system, messages, max_tokens = 4000 }) {
  const t0 = Date.now();
  try {
    let text, usage = {};
    if (process.env.ANTHROPIC_API_KEY && !process.env.LLM_BASE_URL) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: AbortSignal.timeout(TIMEOUT),
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens, system, messages }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(`anthropic ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
      text = j.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      usage = { in: j.usage?.input_tokens, out: j.usage?.output_tokens };
    } else {
      const base = (process.env.LLM_BASE_URL || "https://ollama.com/v1").replace(/\/$/, "");
      const r = await fetch(`${base}/chat/completions`, {
        method: "POST", signal: AbortSignal.timeout(TIMEOUT),
        headers: { Authorization: `Bearer ${process.env.LLM_API_KEY || ""}`, "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens, messages: [...(system ? [{ role: "system", content: system }] : []), ...messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content.map((b) => b.text || "").join("\n") }))] }),
      });
      const j = await r.json();
      // HTTP 404/410 on a model usually means it was retired: pick a successor and set LLM_MODEL.
      if (!r.ok) throw new Error(`llm ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
      text = j.choices?.[0]?.message?.content ?? "";
      usage = { in: j.usage?.prompt_tokens, out: j.usage?.completion_tokens };
    }
    capture({ $ai_latency: (Date.now() - t0) / 1000, $ai_input_tokens: usage.in, $ai_output_tokens: usage.out, $ai_http_status: 200 });
    return { content: [{ type: "text", text }] };
  } catch (e) {
    capture({ $ai_latency: (Date.now() - t0) / 1000, $ai_is_error: true, $ai_error: e.message });
    throw e;
  }
}

/** Like createMessage, but returns parsed JSON. Many models ignore schema hints, so we instruct
 *  JSON hard and brace-match the first JSON value out of the reply. */
export async function createJson({ messages, max_tokens = 2000, output_config }) {
  const schema = output_config?.format?.schema;
  const system = `Reply with ONE JSON value only, no prose, no markdown fences.${schema ? ` It must match this JSON schema: ${JSON.stringify(schema)}` : ""}`;
  const res = await createMessage({ system, messages, max_tokens });
  return extractJson(res.content[0].text);
}

export function extractJson(s) {
  const t = String(s).replace(/```(?:json)?/gi, "");
  const start = t.search(/[{[]/);
  if (start < 0) throw new Error(`no JSON in reply: ${t.slice(0, 200)}`);
  const open = t[start], close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error(`unterminated JSON in reply: ${t.slice(0, 200)}`);
}

export default { createMessage, createJson };
