// SEO engine, stages 02-05: BRIEF + WRITE + VERIFY + PUBLISH, one post per run.
// Picks the best queued topic, drafts it against facts.json, runs the fact gate
// (deterministic checks + an LLM claims audit, up to 2 rewrites), and publishes it to
// your WordPress blog through the Creator OS blog API. Auto-publish is the default;
// set SEO_PUBLISH_AS_DRAFT=1 to land posts as drafts, --dry-run to write and verify only.
//
//   node --env-file=.env .claude/skills/seo-engine/scripts/publish.mjs [--dry-run] [--topic <id>]
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { q, ensureSchema, logRun, closeDb, listArticles, cosApi, llm, FACTS, CLI, CLI_NAME, CONFIG, BRAND, SITE, BLOG, SIGNUP_URL, similarity, slugify, deDash, etDay, indexNow } from "./lib.mjs";

const DRY = process.argv.includes("--dry-run");
const AS_DRAFT = process.env.SEO_PUBLISH_AS_DRAFT === "1";
const TOPIC_ARG = (() => { const i = process.argv.indexOf("--topic"); return i > 0 ? Number(process.argv[i + 1]) : null; })();
const DAILY_MAX = Number(process.env.SEO_DAILY_MAX || CONFIG.daily_max || 10);
const SPINOFF_DAILY_MAX = Number(process.env.SEO_SPINOFF_DAILY_MAX || CONFIG.spinoff_daily_max || 6);
const MAX_REWRITES = 2;
const API_PREFIXES = CONFIG.api_prefixes || [];
const EXT_OK = CONFIG.external_allow || [];
const YT = CONFIG.youtube_channel;
const host = new URL(SITE).host.replace(/^www\./, "");

const factsText = JSON.stringify({ ...FACTS, _note: undefined });
const cliText = CLI ? Object.values(CLI).map((c) => `${CLI_NAME} ${c.usage}`).join("\n") : "";

async function main() {
  await ensureSchema();
  const today = etDay();
  const done = await q(`select count(*)::int n, count(*) filter (where source='spinoff')::int s from seo_posts where (published_at at time zone 'America/New_York')::date = $1`, [today]);
  if (!TOPIC_ARG && done[0].n >= DAILY_MAX) { console.log(`daily cap reached (${done[0].n}/${DAILY_MAX})`); return; }

  // Claim one topic atomically so overlapping runs never write the same post.
  const claim = await q(`update seo_topics set status='writing', updated_at=now() where id = (
      select id from seo_topics where status='queued' ${TOPIC_ARG ? "and id=$1" : ""}
        ${done[0].s >= SPINOFF_DAILY_MAX ? "and source <> 'spinoff'" : ""}
      order by score desc, created_at asc limit 1 for update skip locked) returning *`, TOPIC_ARG ? [TOPIC_ARG] : []);
  const topic = claim[0];
  if (!topic) { console.log("no queued topics; run scout"); await logRun("seo-publish", true, { skipped: "empty queue" }); return; }
  console.log(`topic #${topic.id} [${topic.source}/${topic.cluster}] ${topic.title}`);

  try {
    const articles = (await listArticles()).filter((a) => a.status === "publish" || a.status === "published" || !a.status);
    const known = new Set();
    for (const sm of CONFIG.sitemaps || [`${SITE}/sitemap.xml`]) {
      try {
        const xml = await (await fetch(sm)).text();
        for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) known.add(normUrl(m[1]));
      } catch { /* a missing sitemap only means fewer allowed internal links */ }
    }
    for (const a of articles) if (a.slug) known.add(normUrl(`${BLOG}/${a.slug}/`));
    known.add(normUrl(SIGNUP_URL));

    // Pick internal links: the most related existing posts.
    const related = articles.map((a) => ({ a, s: similarity(`${topic.title} ${topic.keyword}`, a.title) }))
      .sort((x, y) => y.s - x.s).slice(0, 8).map(({ a }) => `${a.title} -> ${BLOG}/${a.slug}/`);

    // BRIEF
    const brief = await llm.createJson({ max_tokens: 1200, messages: [{ role: "user", content: briefPrompt(topic, related) }],
      output_config: { format: { type: "json_schema", schema: { type: "object", properties: { title: { type: "string" }, slug: { type: "string" }, excerpt: { type: "string" }, tags: { type: "array" }, outline: { type: "array" } }, required: ["title", "slug", "excerpt", "outline"] } } } });
    brief.slug = slugify(brief.slug || brief.title);
    if (articles.some((a) => a.slug === brief.slug)) brief.slug = slugify(`${brief.slug}-${today.slice(5)}`);
    const dupOf = articles.find((a) => similarity(brief.title, a.title) >= 0.8);
    if (dupOf) throw new Gate(`duplicate intent of existing post: ${dupOf.title}`);

    // WRITE + VERIFY loop
    let html = await write(topic, brief, related, null);
    let report;
    for (let attempt = 0; ; attempt++) {
      report = await verify(html, topic, known);
      html = report.html;
      if (!report.problems.length) break;
      if (attempt >= MAX_REWRITES) throw new Gate(`failed fact gate after ${MAX_REWRITES} rewrites: ${report.problems.slice(0, 5).join(" | ")}`);
      console.log(`  gate: ${report.problems.length} problem(s), rewriting (${attempt + 1}/${MAX_REWRITES})`);
      html = await write(topic, brief, related, { html, problems: report.problems });
    }

    const words = html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    console.log(`  passed gate: ${words} words, ${report.links.internal} internal / ${report.links.external} external links, ${report.fixed.length} auto-fixes`);
    if (DRY) {
      const out = path.join(tmpdir(), `seo-dry-${brief.slug}.html`);
      writeFileSync(out, `<h1>${brief.title}</h1>\n<p><i>${brief.excerpt}</i></p>\n${html}`);
      console.log(`  dry run: ${out}`);
      await q(`update seo_topics set status='queued', updated_at=now() where id=$1`, [topic.id]);
      return;
    }

    // PUBLISH
    const res = await cosApi("POST", "/v1/blog/articles", {
      title: deDash(brief.title), bodyHtml: html, handle: brief.slug, excerpt: deDash(brief.excerpt).slice(0, 165),
      tags: (brief.tags || []).slice(0, 5).map(String), isPublished: !AS_DRAFT,
    });
    const art = res.article ?? res;
    const slug = art.handle || brief.slug;
    await q(`insert into seo_posts (slug, article_id, title, keyword, cluster, source, parent_slug, topic_id, verify)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (slug) do nothing`,
      [slug, String(art.id ?? ""), brief.title, topic.keyword, topic.cluster, topic.source, topic.parent_slug, topic.id, JSON.stringify({ words, fixed: report.fixed })]);
    await q(`update seo_topics set status='published', slug=$2, updated_at=now() where id=$1`, [topic.id, slug]);
    console.log(`  ${AS_DRAFT ? "DRAFT" : "LIVE"}: ${BLOG}/${slug}/`);
    // Tell Bing (ChatGPT search, Copilot) right away instead of waiting for a crawl.
    let ping = null;
    if (!AS_DRAFT) {
      ping = await indexNow([`${BLOG}/${slug}/`, `${BLOG}/`, `${SITE}/llms.txt`, `${SITE}/llms-full.txt`]);
      console.log(`  IndexNow: ${ping.ok ? "accepted" : "skipped/failed"} (${ping.status ?? ping.error})`);
    }
    await logRun("seo-publish", true, { slug, topic: topic.id, source: topic.source, cluster: topic.cluster, words, draft: AS_DRAFT, indexnow: ping?.status ?? ping?.error ?? null });
  } catch (e) {
    const gate = e instanceof Gate;
    await q(`update seo_topics set status=$2, reason=$3, updated_at=now() where id=$1`, [topic.id, gate ? "rejected" : "queued", e.message.slice(0, 500)]);
    console.error(`  ${gate ? "REJECTED" : "ERROR"}: ${e.message}`);
    await logRun("seo-publish", gate, { topic: topic.id, [gate ? "rejected" : "error"]: e.message.slice(0, 300) });
    if (!gate) process.exitCode = 1;
  }
}

class Gate extends Error {}
const normUrl = (u) => u.replace(new RegExp(`^https?://(www\\.)?${host.replace(/\./g, "\\.")}`), "").replace(/[#?].*$/, "").replace(/\/+$/, "") || "/";

function briefPrompt(topic, related) {
  return `You plan one blog post for ${BLOG}. Goal: rank on Google for a real search and turn readers into ${BRAND} signups.
Topic: ${topic.title}
Target search: ${topic.keyword}
Source: ${topic.source}${topic.angle ? `\nAngle / context: ${topic.angle}` : ""}${topic.parent_slug ? `\nThis is a spin-off of our converting post ${BLOG}/${topic.parent_slug}/ : it must answer a DIFFERENT search intent and link back to it.` : ""}
Existing posts (do not duplicate; you may link): \n${related.join("\n")}
Return JSON: {"title":"keyword near the start, under 70 chars, no em dashes","slug":"kebab-case with the keyword","excerpt":"150-160 chars meta description","tags":["3-5 lowercase tags"],"outline":["6-9 H2 section headings in order, with a 'Frequently asked questions' section of 3-5 <h3> questions near the end, ending with a Get started section"]}`;
}

async function write(topic, brief, related, fix) {
  const rules = `You write for the ${BRAND} blog. Output ONLY the article body as HTML (no <html>, no <h1>, no markdown, no code fences).
FORMAT: <p>, <h2>, <h3>, <ul>/<ol>/<li>, <strong>, <a href>, <pre><code>, <table>. 1100 to 1700 words. Put the target search phrase in the first paragraph and in one <h2>.
Right after the intro add ONE ASCII diagram: <figure class="diagram"><pre><code>...</code></pre><figcaption>one line</figcaption></figure>. HTML-escape < > & inside it (&lt; &gt; &amp;), lines under 72 chars.
FAQ: include an <h2>Frequently asked questions</h2> with 3 to 5 <h3> questions, each answered in 1 to 3 sentences. AI answer engines and Google lift these directly.
VOICE: plain, direct, specific, second person. Short sentences. No hype words, no "in today's fast-paced world", no "game-changer", no "unlock", no em dashes or en dashes anywhere.
TRUTH (most important): every statement about ${BRAND} (features, prices, limits, commands, tool names, URLs, API fields) MUST come from the FACTS${CLI ? " or the CLI list" : ""} below. If something is not there, do not claim it. Never invent statistics, customer numbers, testimonials, case studies, or quotes. Never invent URLs.
FOCUS: this post is about ONE topic. Use only the 3 to 8 facts that matter for it, explained in your own words with a worked example (a prompt, a command, a workflow). Never paste lists of FACTS. A reader should learn something specific they could not get from our other posts.
COMPETITORS: ${FACTS.competitor_policy || `Only state facts about ${BRAND}. Describe competitors neutrally and never state their prices, limits or flaws.`}
${topic.source === "news" ? "NEWS: only use what the angle/context line says about the news item, link to its source URL, and do not add details you are not given.\n" : ""}LINKS: link 3-6 of these existing pages where natural: ${related.map((r) => r.split(" -> ")[1]).join(", ")}${FACTS.urls ? ", plus pages from FACTS.urls" : ""}. Every link must be one of those exact URLs. Include ${SIGNUP_URL} in the final Get started section.
${YT ? `YOUTUBE: include 1 or 2 natural links to ${YT}${(CONFIG.youtube_videos || []).length ? `, and when relevant one of these videos: ${CONFIG.youtube_videos.join(", ")}` : ""}. Never invent other video URLs.\n` : ""}${CLI ? `CODE: only use ${CLI_NAME} CLI commands and flags exactly as listed below.\n` : ""}
FACTS: ${factsText}
${CLI ? `\nCLI (exact usage):\n${cliText}` : ""}`;
  const task = fix
    ? `Rewrite this article so it fixes EVERY problem listed. Keep everything else.\nPROBLEMS:\n- ${fix.problems.join("\n- ")}\n\nARTICLE:\n${fix.html}`
    : `Write the article.\nTitle: ${brief.title}\nTarget search: ${topic.keyword}\nOutline (H2s): ${brief.outline.join(" | ")}${topic.angle ? `\nAngle / context: ${topic.angle}` : ""}${topic.parent_slug ? `\nLink back to ${BLOG}/${topic.parent_slug}/ once.` : ""}`;
  const res = await llm.createMessage({ max_tokens: 6000, system: rules, messages: [{ role: "user", content: task }] });
  return res.content[0].text.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "").replace(/<\/?(html|body|h1)[^>]*>/gi, "").trim();
}

async function verify(html0, topic, known) {
  const problems = [], fixed = [];
  let html = deDash(html0);
  if (html !== html0) fixed.push("em/en dashes replaced");
  const text = html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 700) problems.push(`too short (${words} words); write at least 1100 words`);
  if ((html.match(/<h2/gi) || []).length < 4) problems.push("needs at least 4 <h2> sections");
  for (const b of FACTS.banned || []) if (html.toLowerCase().includes(b.toLowerCase())) problems.push(`remove "${b}" (not true / not allowed)`);

  // Links: unknown internal links are unwrapped; external links must be allow-listed or resolve.
  const newsUrl = topic.source === "news" ? (topic.angle || "").match(/https?:\/\/\S+/)?.[0] : null;
  let internal = 0, external = 0;
  for (const [whole, href, label] of [...html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]) {
    if (href.includes(host) && new URL(href, SITE).host.replace(/^www\./, "") === host) {
      if (known.has(normUrl(href)) || (FACTS.urls && Object.values(FACTS.urls).some((u) => normUrl(String(u)) === normUrl(href)))) { internal++; continue; }
      html = html.replace(whole, label); fixed.push(`unlinked unknown page ${href}`); continue;
    }
    if (href.startsWith("/")) { html = html.replace(whole, label); fixed.push(`unlinked relative ${href}`); continue; }
    if (EXT_OK.some((d) => href.includes(d)) || (newsUrl && href.startsWith(newsUrl.replace(/[).,]+$/, "")))) { external++; continue; }
    const ok = await fetch(href, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(10_000) }).then((r) => r.ok).catch(() => false);
    if (ok) external++; else { html = html.replace(whole, label); fixed.push(`unlinked dead ${href}`); }
  }
  if (YT && !html.includes(YT.replace(/^https?:\/\/(www\.)?/, ""))) {
    const block = `<p>Prefer to watch? The <a href="${YT}">YouTube channel</a> walks through builds like this one, start to finish.</p>\n`;
    const at = html.search(/<h2[^>]*>\s*Get started/i);
    html = at >= 0 ? html.slice(0, at) + block + html.slice(at) : html + "\n" + block;
    fixed.push("added YouTube channel link");
  }
  if (!html.includes(SIGNUP_URL.replace(/^https?:\/\/(www\.)?/, ""))) {
    html += `\n<h2>Get started</h2>\n${FACTS.cta_html || `<p><a href="${SIGNUP_URL}">Create your ${BRAND} account</a> and try it on your own setup.</p>`}`;
    fixed.push("added signup CTA");
  }

  // Prices: any recurring price must be one of yours.
  if (FACTS.allowed_prices?.length) {
    for (const m of text.matchAll(/\$\s?(\d+(?:\.\d{2})?)\s*(?:\/\s?(?:mo|month|yr|year)|a month|per month|a year|per year)/gi)) {
      if (!FACTS.allowed_prices.includes(`$${m[1]}`)) problems.push(`price "$${m[1]}" with a billing period is not a ${BRAND} price; use only ${FACTS.allowed_prices.join(", ")}`);
    }
  }
  const codeText = [...html.matchAll(/<code>([\s\S]*?)<\/code>/gi)].map((m) => m[1]).join("\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  // CLI commands and flags (only when you ship cli.json). Invented flags are removed, unknown commands rejected.
  if (CLI && CLI_NAME) {
    for (const m of codeText.matchAll(new RegExp(`(?:^|[\\s$\`(])${CLI_NAME}\\s+([a-z]+:[a-z-]+)([^\\n]*(?:\\\\\\n[^\\n]*)*)`, "gm"))) {
      const cmd = m[1], spec = CLI[cmd];
      if (!spec) { problems.push(`CLI command "${CLI_NAME} ${cmd}" does not exist`); continue; }
      for (const f of m[2].match(/--[a-zA-Z][a-zA-Z-]*/g) || []) {
        if (spec.flags.includes(f) || ["--help", "--pretty"].includes(f)) continue;
        const re = new RegExp(`\\s${f}(?:[ =](?:"[^"]*"|'[^']*'|[^\\s-][^\\s]*))?(?=\\s|$|<)`, "g");
        const before = html;
        html = html.replace(re, "");
        if (html !== before) fixed.push(`removed invented flag ${f} from ${CLI_NAME} ${cmd}`);
        else problems.push(`flag ${f} does not exist on "${CLI_NAME} ${cmd}" (usage: ${spec.usage})`);
      }
    }
  }
  if (API_PREFIXES.length) {
    for (const m of codeText.matchAll(/\/v1\/[a-z0-9/_{}:-]+/gi)) {
      if (!API_PREFIXES.some((p) => m[0].startsWith(p))) problems.push(`API path ${m[0]} is not a documented ${BRAND} endpoint`);
    }
  }

  // LLM claims audit against FACTS.
  if (!problems.length) {
    const audit = await llm.createJson({ max_tokens: 3000, messages: [{ role: "user", content:
`You are a strict fact checker for a ${BRAND} blog post. Compare the ARTICLE against FACTS.
List ONLY real problems:
1. a claim about ${BRAND} (feature, platform support, price, limit, command, tool, URL) that FACTS does not support or contradicts;
2. a factual claim about a competitor product (its price, features, limits, flaws);
3. an invented statistic, customer count, testimonial, quote, or case study presented as real.
Generic advice and example prompts in quotes are fine.${CLI ? ` CLI commands are already validated against the list below, so never flag a ${CLI_NAME} command that appears in it.` : ""} If there are no problems return {"problems":[]}.
FACTS: ${factsText}
${CLI ? `CLI (all real commands):\n${cliText}\n` : ""}ARTICLE: ${text.slice(0, 14000)}
A statement that matches FACTS (even reworded) is NOT a problem. Report at most 6 problems, each "why" under 25 words.
Return {"problems":[{"quote":"exact words, under 20 words","why":"what is wrong"}]}` }],
      output_config: { format: { type: "json_schema", schema: { type: "object", properties: { problems: { type: "array" } }, required: ["problems"] } } } });
    for (const p of audit.problems || []) problems.push(`"${String(p.quote).slice(0, 160)}": ${p.why}`);
  }
  return { html, problems, fixed, links: { internal, external } };
}

main().then(closeDb, async (e) => { console.error(e); await logRun("seo-publish", false, { error: e.message }); await closeDb(); process.exit(1); });
