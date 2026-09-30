#!/usr/bin/env node
/**
 * posthog-snapshot — daily website-visitor capture from PostHog into Postgres.
 *
 * For every channel with a posthog_project_id, runs one HogQL query over the
 * PostHog Query API for a per-ET-day series of unique visitors, pageviews, and
 * sessions (last ~35 days; `--days N` to backfill), plus the web-app funnel
 * events (user_signed_up / onboarding_completed / api_key_copied), and upserts one row per (day, channel) into
 * `web_analytics_snapshots`. The Overview header reads THIS table for the
 * Visitors KPI + its month-over-month trend (with a live top-up for today).
 *
 * Auth: POSTHOG_API_KEY is a project-scoped PERSONAL key (phx_…) with Query
 * Read. Host + project id come from the channel row (posthog_host defaults to
 * US cloud). Region-agnostic — set posthog_host to eu.posthog.com for EU.
 *
 * Run it twice a day (9 AM + 9 PM ET) from any cron. Safe to re-run any time;
 * upserts by (day, channel).
 *
 * Env: DATABASE_URL, POSTHOG_API_KEY, and POSTHOG_PROJECT_ID (single site) or a
 * channels table (multi site). Run: npm run snapshot  (or --days 90 to backfill)
 */
import { Pool } from "pg";

const KEY = process.env.POSTHOG_API_KEY;
if (!KEY || !process.env.DATABASE_URL) {
  console.error("✗ POSTHOG_API_KEY / DATABASE_URL required");
  process.exit(1);
}

const SCHEMA = `create table if not exists web_analytics_snapshots (
  snapshot_date date not null,
  channel_id text not null,
  project_id text not null,
  visitors int not null default 0,
  pageviews int not null default 0,
  sessions int not null default 0,
  captured_at timestamptz not null default now(),
  primary key (snapshot_date, channel_id)
);
alter table web_analytics_snapshots
  add column if not exists signups int not null default 0,
  add column if not exists onboarded int not null default 0,
  add column if not exists api_keys int not null default 0;
create table if not exists web_referrer_snapshots (
  snapshot_date date not null,
  channel_id text not null,
  source text not null,
  visitors int not null default 0,
  signups int not null default 0,
  captured_at timestamptz not null default now(),
  primary key (snapshot_date, channel_id, source)
)`;

const DAYS = (() => {
  const i = process.argv.indexOf("--days");
  const n = i > 0 ? Number(process.argv[i + 1]) : 35;
  return Number.isFinite(n) && n > 0 ? Math.min(400, Math.floor(n)) : 35;
})();

// Per-ET-day pageviews, unique visitors, unique sessions + funnel events over
// the window. toTimeZone keeps the day buckets aligned to ET (matches the rest
// of the dashboard); $session_id groups pageviews into sessions.
const HOGQL = `
  SELECT
    toDate(toTimeZone(timestamp, 'America/New_York')) AS day,
    countIf(event = '$pageview') AS pageviews,
    count(DISTINCT if(event = '$pageview', person_id, NULL)) AS visitors,
    count(DISTINCT if(event = '$pageview', properties.$session_id, NULL)) AS sessions,
    countIf(event = 'user_signed_up') AS signups,
    countIf(event = 'onboarding_completed') AS onboarded,
    countIf(event = 'api_key_copied') AS api_keys
  FROM events
  WHERE event IN ('$pageview', 'user_signed_up', 'onboarding_completed', 'api_key_copied')
    AND timestamp >= now() - INTERVAL ${DAYS} DAY
  GROUP BY day
  ORDER BY day
  LIMIT 1000`;

// Where visitors come from: the SESSION's entry source, not
// each pageview's referrer (that is mostly our own domain once people click
// around). UTM source wins when present (ChatGPT sends utm_source=chatgpt.com
// with no referrer). Raw sources are stored; the dashboard groups families.
const SOURCES_HOGQL = `
  SELECT
    toDate(toTimeZone(timestamp, 'America/New_York')) AS day,
    if(notEmpty(coalesce(session.$entry_utm_source, '')), concat('utm:', session.$entry_utm_source),
       coalesce(session.$entry_referring_domain, '$direct')) AS src,
    count(DISTINCT if(event = '$pageview', person_id, NULL)) AS visitors,
    countIf(event = 'user_signed_up') AS signups
  FROM events
  WHERE event IN ('$pageview', 'user_signed_up')
    AND timestamp >= now() - INTERVAL ${DAYS} DAY
  GROUP BY day, src
  LIMIT 20000`; // HogQL defaults to LIMIT 100: 70 days x ~15 sources blew past it

async function phQuery(host, projectId, key, hogql = HOGQL) {
  const res = await fetch(`${host}/api/projects/${projectId}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: hogql } }),
  });
  if (!res.ok) {
    throw new Error(`PostHog ${projectId} → ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  const json = await res.json();
  // results: [[day, pageviews, visitors, sessions], …]
  return json.results ?? [];
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === "0" ? false : { rejectUnauthorized: false }, max: 2 });
  await pool.query(SCHEMA);

  // Single-site mode: POSTHOG_PROJECT_ID (+ optional POSTHOG_HOST / CHANNEL_ID).
  // Multi-site mode: a `channels` table with posthog_project_id / posthog_host.
  let channels;
  if (process.env.POSTHOG_PROJECT_ID) {
    channels = [{
      id: process.env.CHANNEL_ID || "default",
      name: process.env.CHANNEL_ID || "default",
      pid: process.env.POSTHOG_PROJECT_ID,
      host: process.env.POSTHOG_HOST || "https://us.posthog.com",
    }];
  } else {
    ({ rows: channels } = await pool.query(
      `select id, name, posthog_project_id as pid,
              coalesce(posthog_host, 'https://us.posthog.com') as host
         from channels where posthog_project_id is not null`,
    ));
  }
  if (channels.length === 0) {
    console.log("no channels with a posthog_project_id — nothing to do");
    await pool.end();
    return;
  }

  let total = 0;
  for (const ch of channels) {
    console.log(`\n=== ${ch.name} (project ${ch.pid}) ===`);
    let rows;
    try {
      rows = await phQuery(ch.host, ch.pid, KEY);
    } catch (e) {
      console.warn(`  ! ${e.message}`);
      continue;
    }
    for (const [day, pageviews, visitors, sessions, signups, onboarded, apiKeys] of rows) {
      const d = String(day).slice(0, 10);
      await pool.query(
        `insert into web_analytics_snapshots
           (snapshot_date, channel_id, project_id, visitors, pageviews, sessions, signups, onboarded, api_keys, captured_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         on conflict (snapshot_date, channel_id) do update set
           visitors = excluded.visitors,
           pageviews = excluded.pageviews,
           sessions = excluded.sessions,
           signups = excluded.signups,
           onboarded = excluded.onboarded,
           api_keys = excluded.api_keys,
           captured_at = now()`,
        [d, String(ch.id), String(ch.pid), Number(visitors) || 0, Number(pageviews) || 0, Number(sessions) || 0,
         Number(signups) || 0, Number(onboarded) || 0, Number(apiKeys) || 0],
      );
      total++;
    }
    try {
      const src = await phQuery(ch.host, ch.pid, KEY, SOURCES_HOGQL);
      for (const [day, source, visitors, signups] of src) {
        await pool.query(
          `insert into web_referrer_snapshots (snapshot_date, channel_id, source, visitors, signups, captured_at)
           values ($1,$2,$3,$4,$5, now())
           on conflict (snapshot_date, channel_id, source) do update set
             visitors = excluded.visitors, signups = excluded.signups, captured_at = now()`,
          [String(day).slice(0, 10), String(ch.id), String(source || "$direct"), Number(visitors) || 0, Number(signups) || 0],
        );
      }
      console.log(`  ✓ ${src.length} day x source rows`);
    } catch (e) {
      console.warn(`  ! sources: ${e.message}`);
    }
    // Always heartbeat TODAY's row (ET) even at zero traffic — gives the
    // watchdog a captured_at to verify and the header a "today" number
    // instead of a stale last-nonzero day.
    const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    const has = rows.some((r) => String(r[0]).slice(0, 10) === todayEt);
    if (!has) {
      await pool.query(
        `insert into web_analytics_snapshots
           (snapshot_date, channel_id, project_id, visitors, pageviews, sessions, captured_at)
         values ($1,$2,$3,0,0,0, now())
         on conflict (snapshot_date, channel_id) do update set captured_at = now()`,
        [todayEt, String(ch.id), String(ch.pid)],
      );
      total++;
    }
    const today = rows.at(-1);
    console.log(`  ✓ ${rows.length} day-rows upserted${today ? ` (latest ${String(today[0]).slice(0, 10)}: ${today[2]} visitors, ${today[1]} views)` : " — no pageview events yet, today heartbeat written"}`);
  }

  await pool.end();
  console.log(`\n✓ done — ${total} day-rows across ${channels.length} channel(s)`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
