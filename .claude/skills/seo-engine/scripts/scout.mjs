// SEO engine, stage 01: SCOUT. Fills seo_topics with scored, de-duplicated topics from
// five feeds: winner spin-offs (posts PostHog says bring signups), Search Console queries
// you have no page for, today's news (RSS), your own releases (GitHub / npm), and the
// evergreen seed backlog. Run daily before the publish slots.
//
//   node --env-file=.env .claude/skills/seo-engine/scripts/scout.mjs [--dry-run]
import { q, ensureSchema, logRun, closeDb, listArticles, llm, FACTS, SEEDS, CONFIG, BRAND, SITE, similarity, slugify, gsc, etDay } from "./lib.mjs";

const DRY = process.argv.includes("--dry-run");
const DUP = 0.75; // token overlap that counts as "same search intent"
const COMPETITORS = CONFIG.competitors || [];
const NICHES = CONFIG.niches || [];
const MODELS = CONFIG.models || [];
const brandRe = new RegExp(BRAND.replace(/[^a-z0-9]+/gi, " ?"), "i");
const JSON_TOPICS = { format: { type: "json_schema", schema: { type: "object", properties: { topics: { type: "array" } }, required: ["topics"] } } };

async function main() {
  await ensureSchema();
  const articles = await listArticles();
  const queued = await q(`select title, keyword from seo_topics where status in ('queued','writing','published')`);
  const taken = [...articles.map((a) => a.title), ...queued.flatMap((t) => [t.title, t.keyword])];
  const weights = Object.fromEntries((await q(`select cluster, weight from seo_clusters`)).map((r) => [r.cluster, r.weight]));
  const accepted = [];
  const isDup = (s) => taken.some((t) => similarity(s, t) >= DUP) || accepted.some((a) => similarity(s, a.title) >= DUP);
  const add = (t) => {
    if (!t?.title || !t.keyword) return false;
    if (isDup(t.title) || isDup(t.keyword)) return false;
    t.score = +(t.base * (weights[t.cluster] ?? 1)).toFixed(3);
    accepted.push(t);
    return true;
  };

  // 1. Winner spin-offs: posts with signups or real entry traffic in the last 14 days
  //    get distinct-intent siblings. This is how one viral post becomes a cluster.
  const winners = await q(`select slug, sum(signups)::int s, sum(entry_visitors)::int v
      from seo_metrics_daily where day > current_date - 14 group by slug
      having sum(signups) >= 1 or sum(entry_visitors) >= 15 or sum(ai_visitors) >= 3
      order by sum(signups) desc, sum(entry_visitors) desc limit 3`);
  for (const w of winners) {
    const art = articles.find((a) => a.slug === w.slug);
    if (!art) continue;
    const prompt = `A blog post on ${SITE} is converting: "${art.title}" (${w.v} visitors who entered on it, ${w.s} signups in 14 days).
Propose 6 NEW blog posts that ride the same demand but each answer a DIFFERENT search intent, so none of them duplicates the original or each other.
Use these angle types (at least 4 different ones): comparison (vs one of ${COMPETITORS.join(", ") || "a well-known alternative"}), model (paired with one of ${MODELS.join(", ") || "a popular AI tool"}), niche (for one of ${NICHES.join(", ") || "a specific audience"}), use-case, how-to.
Rules: titles under 70 characters, keyword-first, a phrase someone would really type into Google. Comparison posts state what ${BRAND} does; never claim facts about competitors. No em dashes.
${BRAND} facts you can lean on: ${FACTS.product}
Return {"topics":[{"title":"","keyword":"","angle":"comparison|model|niche|use-case|how-to","pitch":"one sentence: what this post shows that page one lacks"}]}`;
    try {
      const j = await llm.createJson({ max_tokens: 1500, messages: [{ role: "user", content: prompt }], output_config: JSON_TOPICS });
      for (const t of (j.topics || []).slice(0, 6)) {
        add({ title: t.title, keyword: t.keyword || t.title, cluster: clusterOf(t.title, t.angle), source: "spinoff", parent_slug: w.slug, angle: `${t.angle}: ${t.pitch || ""}`, base: 1.3 + Math.min(1, w.s * 0.25) });
      }
    } catch (e) { console.error("spinoff gen failed:", e.message); }
  }

  // 2. Search Console: queries with impressions where no page targets them yet.
  try {
    const end = etDay(), start = etDay(new Date(Date.now() - 28 * 864e5));
    const j = await gsc("POST", "/searchAnalytics/query", { startDate: start, endDate: end, dimensions: ["query"], rowLimit: 200 });
    for (const r of (j?.rows || []).filter((r) => r.impressions >= 5).slice(0, 30)) {
      const kw = r.keys[0];
      if (brandRe.test(kw)) continue; // brand searches already land on the homepage
      add({ title: titleCase(kw), keyword: kw, cluster: clusterOf(kw), source: "gsc", angle: `GSC: ${r.impressions} impressions at position ${r.position.toFixed(1)}`, base: 1.5 });
    }
  } catch (e) { console.error("gsc feed failed:", e.message); }

  // 3. Today's news from your RSS feeds: only stories with a genuine link to the product.
  try {
    const news = (await Promise.all((CONFIG.news_feeds || []).map(rss))).flat()
      .filter((n) => !n.date || Date.now() - n.date < 36 * 3600e3).slice(0, 25);
    if (news.length) {
      const prompt = `Today's news items:\n${news.map((n, i) => `${i + 1}. ${n.title} :: ${n.summary.slice(0, 160)} (${n.url})`).join("\n")}
Pick AT MOST 3 items where a blog post on ${SITE} could honestly connect the news to what ${BRAND} does (${FACTS.product}). Skip anything without a real link. For each, write a title under 70 chars that people would search this week.
Return {"topics":[{"n":1,"title":"","keyword":"","angle":"how the news connects to ${BRAND}"}]}`;
      const j = await llm.createJson({ max_tokens: 900, messages: [{ role: "user", content: prompt }], output_config: JSON_TOPICS });
      for (const t of (j.topics || []).slice(0, 3)) {
        const n = news[(t.n || 0) - 1];
        add({ title: t.title, keyword: t.keyword || t.title, cluster: "news", source: "news", angle: `${t.angle}${n ? ` | source: ${n.title} ${n.url}` : ""}`, base: 1.4 });
      }
    }
  } catch (e) { console.error("news feed failed:", e.message); }

  // 4. Your releases: a fresh npm version, or a busy day of commits on a public repo.
  try {
    if (CONFIG.npm_package) {
      const npm = await (await fetch(`https://registry.npmjs.org/${CONFIG.npm_package.replace("/", "%2F")}`)).json();
      const latest = npm["dist-tags"]?.latest, when = npm.time?.[latest];
      if (latest && when && Date.now() - Date.parse(when) < 3 * 864e5) {
        add({ title: `What's new in ${CONFIG.npm_package} ${latest}`, keyword: `${CONFIG.npm_package} ${latest}`, cluster: "release", source: "release", angle: `npm ${CONFIG.npm_package} ${latest} published ${when}`, base: 1.6 });
      }
    }
    for (const repo of CONFIG.release_repos || []) {
      const commits = await (await fetch(`https://api.github.com/repos/${repo}/commits?since=${new Date(Date.now() - 864e5).toISOString()}`, { headers: { "user-agent": "seo-engine" } })).json();
      if (Array.isArray(commits) && commits.length >= 3) {
        const name = repo.split("/")[1];
        const msgs = commits.slice(0, 8).map((c) => c.commit?.message?.split("\n")[0]).join("; ");
        add({ title: `${titleCase(name.replace(/-/g, " "))} update: ${etDay()}`, keyword: `${name} update`, cluster: "release", source: "release", angle: `recent commits on github.com/${repo}: ${msgs}`, base: 1.5 });
      }
    }
  } catch (e) { console.error("release feed failed:", e.message); }

  // 5. Evergreen seeds (seeds.json: { cluster: [titles] }), a few per day so the queue never runs dry.
  const seedPool = Object.entries(SEEDS).filter(([k]) => !k.startsWith("_")).flatMap(([cluster, titles]) => titles.map((t) => ({ cluster, t })));
  let seedAdds = 0;
  for (const s of seedPool.sort(() => Math.random() - 0.5)) {
    if (seedAdds >= 8) break;
    if (add({ title: s.t, keyword: s.t.toLowerCase(), cluster: s.cluster, source: "seed", angle: null, base: 1.0 })) seedAdds++;
  }

  // Semantic duplicate pass: token overlap misses rephrasings of an existing post.
  if (accepted.length && articles.length) {
    try {
      const prompt = `EXISTING blog posts:\n${articles.map((a) => `- ${a.title}`).join("\n")}\n\nCANDIDATES:\n${accepted.map((t, i) => `${i + 1}. ${t.title}`).join("\n")}
A candidate is a DUPLICATE if a searcher typing its target query would be fully satisfied by an existing post, or if two candidates target the same query. Different platform, niche, competitor or model = NOT a duplicate.
Return {"duplicates":[candidate numbers]}`;
      const j = await llm.createJson({ max_tokens: 400, messages: [{ role: "user", content: prompt }],
        output_config: { format: { type: "json_schema", schema: { type: "object", properties: { duplicates: { type: "array" } }, required: ["duplicates"] } } } });
      const drop = new Set((j.duplicates || []).map(Number));
      const before = accepted.length;
      for (let i = accepted.length - 1; i >= 0; i--) if (drop.has(i + 1)) accepted.splice(i, 1);
      if (before !== accepted.length) console.log(`semantic dedupe dropped ${before - accepted.length}`);
    } catch (e) { console.error("semantic dedupe failed:", e.message); }
  }

  if (!DRY) {
    for (const t of accepted) {
      await q(`insert into seo_topics (title, keyword, cluster, source, parent_slug, angle, score, base, slug) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [t.title, t.keyword, t.cluster, t.source, t.parent_slug ?? null, t.angle, t.score, t.base, slugify(t.keyword || t.title)]);
    }
  }
  const bySource = accepted.reduce((m, t) => ((m[t.source] = (m[t.source] || 0) + 1), m), {});
  console.log(`scout: ${accepted.length} new topics`, bySource, DRY ? "(dry run)" : "");
  for (const t of accepted) console.log(`  ${t.score.toFixed(2)}  [${t.source}/${t.cluster}] ${t.title}`);
  if (!DRY) await logRun("seo-scout", true, { added: accepted.length, bySource, winners: winners.map((w) => w.slug) });
}

async function rss(url) {
  const xml = await (await fetch(url, { signal: AbortSignal.timeout(15_000) })).text();
  const tag = (s, t) => (s.match(new RegExp(`<${t}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`, "i")) || [])[1]?.trim() || "";
  return [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].slice(0, 15).map(([s]) => ({
    title: tag(s, "title").replace(/<[^>]+>/g, ""),
    url: tag(s, "link") || (s.match(/<link[^>]*href="([^"]+)"/) || [])[1] || "",
    summary: (tag(s, "description") || tag(s, "summary")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
    date: Date.parse(tag(s, "pubDate") || tag(s, "published") || tag(s, "updated")) || 0,
  }));
}
function titleCase(s) { return s.replace(/\b\w/g, (c) => c.toUpperCase()); }
// Topic clusters are what the learning loop re-weights. Tune these regexes for your niche.
function clusterOf(s, angle) {
  const t = `${s} ${angle || ""}`.toLowerCase();
  if (/ vs |alternative|comparison/.test(t)) return "comparison";
  if (/\bads?\b|boost|campaign/.test(t)) return "ads";
  if (/mcp|connector|cursor|claude code|codex|windsurf/.test(t)) return "mcp";
  if (/agent/.test(t)) return "agents";
  if (/video|edit|shorts|reels|caption/.test(t)) return "video";
  if (/schedul|calendar|best time/.test(t)) return "scheduling";
  if (/api|developer|webhook/.test(t)) return "platform";
  if (NICHES.some((n) => t.includes(`for ${n.toLowerCase()}`))) return "niche";
  return "general";
}

main().then(closeDb, async (e) => { console.error(e); await logRun("seo-scout", false, { error: e.message }); await closeDb(); process.exit(1); });
