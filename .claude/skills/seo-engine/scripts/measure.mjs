// SEO engine, stages 07-08: MEASURE + LEARN. Run nightly.
//  - PostHog: per blog post, per ET day: visitors whose session ENTERED on the post,
//    pageviews, how many reached your signup page, signups in those sessions, and
//    visitors who arrived from an AI answer engine (ChatGPT, Claude, Perplexity...).
//  - Search Console: clicks / impressions / position per post per day.
//  - Learn: re-weights topic clusters by signups per post (Bayesian-smoothed), which
//    scout multiplies into every new topic's score; winners get spin-offs at the next
//    scout run. Pings IndexNow for fresh posts and resubmits your sitemaps.
//
//   node --env-file=.env .claude/skills/seo-engine/scripts/measure.mjs [--days 3]
import { q, ensureSchema, logRun, closeDb, hogql, gsc, GSC_SITE, SITE, BLOG, CONFIG, etDay, indexNow, listArticles, AI_SOURCES } from "./lib.mjs";

const DAYS = (() => { const i = process.argv.indexOf("--days"); return i > 0 ? Number(process.argv[i + 1]) : 3; })();
const BLOG_PATH = (CONFIG.blog_path || "/blog").replace(/\/$/, "");
const SIGNUP_PATH = CONFIG.signup_path || "/sign-up";
const SIGNUP_EVENT = CONFIG.signup_event || "user_signed_up";
const slugOf = (p) => (String(p).match(new RegExp(`^${BLOG_PATH}/([a-z0-9-]+)/?$`)) || [])[1] || null;
const esc = (s) => String(s).replace(/'/g, "\\'");

async function main() {
  await ensureSchema();
  const rows = new Map(); // `${day}|${slug}` -> metrics
  const row = (day, slug) => {
    const k = `${day}|${slug}`;
    if (!rows.has(k)) rows.set(k, { day, slug, ai_visitors: 0, entry_visitors: 0, pageviews: 0, signup_visits: 0, signups: 0, gsc_clicks: 0, gsc_impressions: 0, gsc_position: null });
    return rows.get(k);
  };

  // PostHog: attribute each session to the blog post it entered on.
  const D = "toDate(toTimeZone(timestamp, 'America/New_York'))";
  const ph = await hogql(`SELECT ${D} d, session.$entry_pathname p,
      count(DISTINCT if(event = '$pageview', person_id, NULL)) v,
      countIf(event = '$pageview') pv,
      count(DISTINCT if(event = '$pageview' AND properties.$pathname = '${esc(SIGNUP_PATH)}', person_id, NULL)) su_visits,
      countIf(event = '${esc(SIGNUP_EVENT)}') su
    FROM events
    WHERE timestamp > now() - INTERVAL ${DAYS + 1} DAY AND session.$entry_pathname LIKE '${esc(BLOG_PATH)}/%'
    GROUP BY d, p LIMIT 20000`);
  for (const [d, p, v, pv, sv, su] of ph) {
    const slug = slugOf(p); if (!slug) continue;
    const r = row(String(d).slice(0, 10), slug);
    r.entry_visitors += Number(v); r.pageviews += Number(pv); r.signup_visits += Number(sv); r.signups += Number(su);
  }

  // AI answer engines: sessions that entered on a post from ChatGPT, Claude, Perplexity, Gemini, Copilot...
  const SRC = "lower(concat(coalesce(session.$entry_utm_source, ''), ' ', coalesce(session.$entry_referring_domain, '')))";
  const aiCond = AI_SOURCES.map((a) => `${SRC} LIKE '%${a}%'`).join(" OR ");
  const ai = await hogql(`SELECT ${D} d, session.$entry_pathname p, count(DISTINCT person_id) v
    FROM events WHERE event = '$pageview' AND timestamp > now() - INTERVAL ${DAYS + 1} DAY
      AND session.$entry_pathname LIKE '${esc(BLOG_PATH)}/%' AND (${aiCond})
    GROUP BY d, p LIMIT 20000`);
  for (const [d, p, v] of ai) {
    const slug = slugOf(p); if (!slug) continue;
    row(String(d).slice(0, 10), slug).ai_visitors += Number(v);
  }
  // Site-wide AI referrals (any landing page), for the run log.
  const aiSite = await hogql(`SELECT ${SRC} s, count(DISTINCT if(event = '$pageview', person_id, NULL)) v, countIf(event = '${esc(SIGNUP_EVENT)}') su
    FROM events WHERE timestamp > now() - INTERVAL 7 DAY AND (${aiCond}) GROUP BY s ORDER BY v DESC LIMIT 10`);

  // Search Console (lags ~2-3 days; harmless when empty or not configured).
  try {
    const end = etDay(), start = etDay(new Date(Date.now() - (DAYS + 4) * 864e5));
    const j = await gsc("POST", "/searchAnalytics/query", { startDate: start, endDate: end, dimensions: ["date", "page"], rowLimit: 5000 });
    for (const g of j?.rows || []) {
      const slug = slugOf(new URL(g.keys[1]).pathname); if (!slug) continue;
      const r = row(g.keys[0], slug);
      r.gsc_clicks = g.clicks; r.gsc_impressions = g.impressions; r.gsc_position = g.position;
    }
  } catch (e) { console.error("gsc metrics failed:", e.message); }

  for (const r of rows.values()) {
    await q(`insert into seo_metrics_daily (day, slug, entry_visitors, pageviews, signup_visits, signups, gsc_clicks, gsc_impressions, gsc_position, ai_visitors)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      on conflict (day, slug) do update set entry_visitors=excluded.entry_visitors, pageviews=excluded.pageviews,
        signup_visits=excluded.signup_visits, signups=excluded.signups,
        gsc_clicks=greatest(seo_metrics_daily.gsc_clicks, excluded.gsc_clicks),
        gsc_impressions=greatest(seo_metrics_daily.gsc_impressions, excluded.gsc_impressions),
        gsc_position=coalesce(excluded.gsc_position, seo_metrics_daily.gsc_position), ai_visitors=excluded.ai_visitors`,
      [r.day, r.slug, r.entry_visitors, r.pageviews, r.signup_visits, r.signups, r.gsc_clicks, r.gsc_impressions, r.gsc_position, r.ai_visitors]);
  }

  // LEARN: cluster weight = smoothed signups-per-post vs the blog average, 0.5x to 3x.
  const stats = await q(`select p.cluster, count(distinct p.slug)::int posts,
        coalesce(sum(m.signups),0)::int signups, coalesce(sum(m.entry_visitors),0)::int visitors, coalesce(sum(m.ai_visitors),0)::int ai
      from seo_posts p left join seo_metrics_daily m on m.slug = p.slug and m.day > current_date - 28
      group by p.cluster`);
  const tot = stats.reduce((a, s) => ({ posts: a.posts + s.posts, signups: a.signups + s.signups, visitors: a.visitors + s.visitors, ai: a.ai + s.ai }), { posts: 0, signups: 0, visitors: 0, ai: 0 });
  const globalApp = tot.posts ? tot.ai / tot.posts : 0;
  const globalSpp = tot.posts ? tot.signups / tot.posts : 0;
  const globalVpp = tot.posts ? tot.visitors / tot.posts : 0;
  const PRIOR = 5;
  for (const s of stats) {
    const spp = (s.signups + PRIOR * globalSpp) / (s.posts + PRIOR);
    const vpp = (s.visitors + PRIOR * globalVpp) / (s.posts + PRIOR);
    const app = (s.ai + PRIOR * globalApp) / (s.posts + PRIOR);
    // Signups dominate; visitors and AI-engine citations break ties while signup counts are tiny.
    const raw = (spp + 0.05) / (globalSpp + 0.05) * 0.7 + (vpp + 1) / (globalVpp + 1) * 0.15 + (app + 0.2) / (globalApp + 0.2) * 0.15;
    const weight = Math.max(0.5, Math.min(3, raw));
    await q(`insert into seo_clusters (cluster, posts, signups, entry_visitors, weight, updated_at) values ($1,$2,$3,$4,$5,now())
      on conflict (cluster) do update set posts=$2, signups=$3, entry_visitors=$4, weight=$5, updated_at=now()`,
      [s.cluster, s.posts, s.signups, s.visitors, +weight.toFixed(3)]);
  }
  // Re-score what's still queued with the new weights (score = base x weight, never compounding).
  await q(`update seo_topics t set score = t.base * c.weight, updated_at = now()
      from seo_clusters c where t.cluster = c.cluster and t.status = 'queued'`);

  // IndexNow catch-up: every post created or edited in the last 2 days (engine, MCP or by hand).
  let ping = null;
  try {
    const fresh = (await listArticles()).filter((a) => /publish/.test(a.status || "") && a.modified && Date.now() - Date.parse(a.modified) < 2 * 864e5);
    ping = await indexNow([...fresh.map((a) => `${BLOG}/${a.slug}/`), `${BLOG}/`, `${SITE}/llms.txt`, `${SITE}/llms-full.txt`, `${SITE}/sitemap.xml`]);
    console.log(`IndexNow: ${fresh.length} fresh posts, ${ping.ok ? "accepted" : "skipped/failed"} (${ping.status ?? ping.error})`);
  } catch (e) { console.error("indexnow catch-up failed:", e.message); }

  // Keep Google pointed at fresh sitemaps.
  for (const sm of CONFIG.sitemaps || [`${SITE}/sitemap.xml`]) {
    try { await gsc("PUT", `/sitemaps/${encodeURIComponent(sm)}`); } catch (e) { console.error("sitemap submit failed:", e.message); }
  }

  const top = await q(`select slug, sum(entry_visitors)::int v, sum(signups)::int s, sum(gsc_clicks)::int c
      from seo_metrics_daily where day > current_date - 7 group by slug order by s desc, v desc limit 8`);
  console.log(`measure: ${rows.size} post-days upserted; clusters:`, stats.map((s) => `${s.cluster}=${s.signups}/${s.posts}`).join(" "));
  for (const t of top) console.log(`  ${String(t.s).padStart(2)} signups  ${String(t.v).padStart(4)} visitors  ${t.c} gsc clicks  ${BLOG_PATH}/${t.slug}/`);
  console.log("AI referrals (7d):", aiSite.map(([src, v, su]) => `${src.trim()}=${v}/${su}`).join(" ") || "none yet");
  await logRun("seo-measure", true, { rows: rows.size, top, clusters: stats, site: GSC_SITE, ai7d: aiSite, indexnow: ping?.status ?? ping?.error ?? null });
}

main().then(closeDb, async (e) => { console.error(e); await logRun("seo-measure", false, { error: e.message }); await closeDb(); process.exit(1); });
