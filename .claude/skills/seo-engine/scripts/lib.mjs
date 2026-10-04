// Shared plumbing for the SEO engine (scout / publish / measure).
// DB = your Postgres (DATABASE_URL, same one the PostHog snapshots use).
// Blog = WordPress through the Creator OS blog API (/v1/blog, CREATOROS_API_KEY of the
// workspace that connected the WordPress site). Analytics = PostHog HogQL + Google Search
// Console (service account). Config = seo.config.json in the repo root.
import { Pool } from "pg";
import { createSign } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import llmGateway from "./llm.mjs";

export const llm = llmGateway;
export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(names, label) {
  for (const n of names) if (existsSync(n)) return JSON.parse(readFileSync(n, "utf8"));
  throw new Error(`${label} not found (looked for ${names.join(", ")})`);
}
const root = process.env.SEO_ROOT || process.cwd();
export const CONFIG = readJson([process.env.SEO_CONFIG, path.join(root, "seo.config.json")].filter(Boolean), "seo.config.json (copy seo.config.example.json)");
// Product truth for the fact gate. facts.json is yours; facts.example.json shows the shape.
export const FACTS = readJson([path.join(SKILL_DIR, "facts.json")], "facts.json (copy facts.example.json and fill it in)");
export const SEEDS = existsSync(path.join(SKILL_DIR, "seeds.json")) ? readJson([path.join(SKILL_DIR, "seeds.json")]) : {};
// Optional: { "cli": { "posts:create": { "usage": "...", "flags": ["--text"] } } } if your product has a CLI.
export const CLI = existsSync(path.join(SKILL_DIR, "cli.json")) ? readJson([path.join(SKILL_DIR, "cli.json")]).cli : null;
export const CLI_NAME = CONFIG.cli_name || null;

export const SITE = CONFIG.site.replace(/\/$/, "");
export const BLOG = `${SITE}${CONFIG.blog_path || "/blog"}`;
export const BRAND = CONFIG.brand;
export const SIGNUP_URL = `${SITE}${CONFIG.signup_path || "/sign-up"}`;
export const GSC_SITE = CONFIG.gsc_site || `${SITE}/`;

const PH_PROJECT = process.env.POSTHOG_PROJECT_ID;
const PH_HOST = (process.env.POSTHOG_HOST || "https://us.posthog.com").replace(/\/$/, "").replace(".i.posthog", ".posthog");
const COS_BASE = (process.env.CREATOROS_API_URL || "https://creatoros-production-5658.up.railway.app").replace(/\/$/, "");

// ET date helpers (never toISOString for a day stamp: UTC flips at 8 PM ET).
export const etDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);

let _pool;
export function db() {
  if (!_pool) {
    const u = new URL(process.env.DATABASE_URL);
    u.searchParams.delete("sslmode");
    _pool = new Pool({ connectionString: u.toString(), ssl: process.env.PGSSL === "0" ? false : { rejectUnauthorized: false }, max: 3 });
  }
  return _pool;
}
export const q = async (sql, params) => (await db().query(sql, params)).rows;
export async function closeDb() { if (_pool) await _pool.end(); }

export async function ensureSchema() {
  await q(readFileSync(path.join(SKILL_DIR, "schema.sql"), "utf8"));
}
export async function logRun(job, ok, detail) {
  try { await q(`insert into seo_runs (job, ok, detail) values ($1,$2,$3)`, [job, ok, JSON.stringify(detail ?? {})]); } catch (e) { console.error("seo_runs log failed:", e.message); }
}

// ── Blog API (WordPress via Creator OS) ───────────────────────────────────────
export async function cosApi(method, p, body) {
  if (!process.env.CREATOROS_API_KEY) throw new Error("CREATOROS_API_KEY missing (Creator OS > Settings > API keys)");
  const r = await fetch(COS_BASE + p, {
    method, headers: { Authorization: `Bearer ${process.env.CREATOROS_API_KEY}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90_000),
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status}: ${text.slice(0, 300)}`);
  return j;
}
/** Every article on the blog (published + drafts): [{id, slug, title, status}] */
export async function listArticles() {
  const out = []; let cursor;
  for (let i = 0; i < 20; i++) {
    const j = await cosApi("GET", `/v1/blog/articles?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    for (const a of j.articles ?? []) out.push({ id: String(a.id), slug: a.handle || a.slug, title: a.title, status: a.status, tags: a.tags || [], modified: a.updatedAt || a.publishedAt || null });
    cursor = j.nextCursor; if (!cursor) break;
  }
  return out;
}

// ── PostHog ───────────────────────────────────────────────────────────────────
export async function hogql(query) {
  const r = await fetch(`${PH_HOST}/api/projects/${PH_PROJECT}/query/`, {
    method: "POST", headers: { Authorization: `Bearer ${process.env.POSTHOG_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }), signal: AbortSignal.timeout(120_000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`posthog ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.results ?? [];
}

// ── Google Search Console (service account JWT, no SDK) ──────────────────────
// GSC_SA_JSON_B64 = base64 of the service-account JSON, or GSC_SA_JSON_PATH = path to it.
// Add the service-account email as an Owner of the property in Search Console.
function saKey() {
  if (process.env.GSC_SA_JSON_B64) return JSON.parse(Buffer.from(process.env.GSC_SA_JSON_B64, "base64").toString("utf8"));
  const p = process.env.GSC_SA_JSON_PATH;
  return p && existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}
let _gtok;
export async function gscToken() {
  if (_gtok && _gtok.exp > Date.now() + 60_000) return _gtok.token;
  const k = saKey(); if (!k) return null;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: k.client_email, scope: "https://www.googleapis.com/auth/webmasters", aud: k.token_uri, iat: now, exp: now + 3600 })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(k.private_key).toString("base64url");
  const r = await fetch(k.token_uri, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }) });
  const j = await r.json(); if (!j.access_token) throw new Error("gsc token: " + JSON.stringify(j).slice(0, 200));
  _gtok = { token: j.access_token, exp: Date.now() + 3500_000 };
  return j.access_token;
}
/** Returns null (and skips) when no service account is configured. */
export async function gsc(method, p, body) {
  const t = await gscToken(); if (!t) return null;
  const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE)}${p}`, {
    method, headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`gsc ${p} ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// ── text utils ────────────────────────────────────────────────────────────────
const STOP = new Set("a an the and or for to of in on with from your you how what why is are vs best my our it its by at as this that do does can".split(" "));
const brandWords = String(BRAND).toLowerCase().split(/\s+/);
export const tokens = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w) && !brandWords.includes(w)));
export function similarity(a, b) {
  const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}
export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/, "");
// Em and en dashes read as AI-written. Swapped out everywhere before publish.
export const deDash = (s) => String(s).replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",");

// ── IndexNow (Bing, which feeds ChatGPT search and Copilot; also Yandex, Seznam, Naver) ──────
// Host a file at {SITE}/{INDEXNOW_KEY}.txt containing the key to prove you own the site.
export async function indexNow(urls) {
  const key = process.env.INDEXNOW_KEY;
  const list = [...new Set(urls.filter(Boolean))].slice(0, 10000);
  if (!key || !list.length) return { ok: !key ? false : true, sent: 0, status: key ? "empty" : "no INDEXNOW_KEY" };
  try {
    const r = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST", headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: new URL(SITE).host, key, keyLocation: `${SITE}/${key}.txt`, urlList: list }),
      signal: AbortSignal.timeout(20_000),
    });
    return { ok: r.status === 200 || r.status === 202, status: r.status, sent: list.length };
  } catch (e) {
    return { ok: false, error: e.message, sent: 0 };
  }
}

// AI answer engines / assistants, matched against the session's entry referrer or utm_source.
export const AI_SOURCES = ["chatgpt", "openai", "perplexity", "claude.ai", "anthropic", "gemini", "copilot", "you.com", "phind", "meta.ai", "grok", "deepseek", "mistral"];
