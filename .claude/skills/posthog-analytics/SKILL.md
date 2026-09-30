---
name: posthog-analytics
description: Set up, backfill, debug or extend the PostHog analytics kit (daily visitor/funnel/traffic-source snapshots from PostHog HogQL into Postgres, plus the Web chart, Web funnel and Traffic sources dashboard cards). Use when the user asks about website visitors, signups, conversion, traffic sources, or PostHog numbers looking wrong.
---

# PostHog analytics kit

## How it works
- `scripts/posthog-snapshot.mjs` runs two HogQL queries against `POST {host}/api/projects/{id}/query/`:
  1. Visitors, pageviews, sessions and funnel events grouped by **ET day**. The results go to `web_analytics_snapshots`, keyed on (day, channel).
  2. The session entry source by ET day, which goes to `web_referrer_snapshots`. The source is `utm:<source>` when a UTM exists, else the referring domain, else `$direct`.
- It upserts, so re-running is always safe. `--days N` backfills (max 400).
- It always writes a heartbeat row for today, so a monitor can tell the job ran even on a zero-traffic day.
- `lib/posthog-client.ts` `getWebVisitorsDaily()` reads the table and first runs a live HogQL top-up for today. The top-up has a 90 s cooldown and a 3 s time box and fails open.
- `lib/posthog-sources.ts` groups raw sources into families with the ordered regex `RULES`. The first match wins. Unknown domains show as themselves with a favicon.

## Rules that matter
- **Days are America/New_York.**
  - In HogQL, bucket with `toDate(toTimeZone(timestamp, 'America/New_York'))`.
  - For "today", compare against `toDate(toTimeZone(now(), 'America/New_York'))`, never `today()`, which is UTC. `today()` makes the evening count read 0.
  - In JS, use `Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })`, never `toISOString()`.
- **HogQL defaults to LIMIT 100.** Always set an explicit LIMIT on grouped queries. The sources query uses 20000.
- Visitors = `count(DISTINCT person_id)` on `$pageview`. Sessions = distinct `properties.$session_id`.
- Attribute sources by **session entry** (`session.$entry_referring_domain`, `session.$entry_utm_source`), not the per-pageview referrer. The per-pageview referrer is mostly your own domain after the first click.
- The API key must be a **personal** key (`phx_`) with Query: Read. A project key (`phc_`) returns 401/403.
- In the Web chart, signups and subscribers share the **visitors** y-axis with the **same bar width**. Height shows the conversion. Never give them their own axis, or 1 sale renders as a full-height bar.

## Common tasks
- **Add a funnel event:** add `countIf(event = 'x') AS x` to both HogQL queries (the snapshot and the live top-up). Add the column with `alter table ... add column if not exists`, add it to the upserts, then map it in `getWebVisitorsDaily`.
- **Add a traffic family:** add a rule to `RULES` above the generic `search` / `direct` rules.
- **Numbers look low or zero tonight:** check the ET vs UTC "today" comparison. Then run `npm run snapshot` and read the per-project log line.
- **Missing days:** run `npm run backfill`.
- **Tracking a new site:** set `POSTHOG_PROJECT_ID` (single-site mode), or add a row to the `channels` table (multi-site mode).
