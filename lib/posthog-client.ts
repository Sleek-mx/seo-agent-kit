import { dbConfigured, query } from "./db";

export type DailyVisitors = {
  date: string; // YYYY-MM-DD (ET)
  visitors: number;
  pageviews: number;
  sessions: number;
  /** Web-app funnel events. */
  signups: number;
  onboarded: number;
  apiKeys: number;
};

const liveCheckedAt = new Map<string, number>();
const LIVE_COOLDOWN_MS = 90_000;

/** Live top-up for today's row (the header must be current
 *  between the 9 AM / 9 PM ET cron sweeps). One HogQL query for today's ET pageviews /
 *  visitors / sessions, upserted into web_analytics_snapshots. Best-effort +
 *  time-boxed by the caller; falls back to the cron-fed rows. */
async function liveTopUp(
  projectId: string,
  host: string,
  channelId: string,
  apiKey?: string | null,
): Promise<void> {
  const key = apiKey || process.env.POSTHOG_API_KEY;
  if (!key) return;
  const last = liveCheckedAt.get(projectId) ?? 0;
  if (Date.now() - last < LIVE_COOLDOWN_MS) return;

  // "Today" must be the ET day — both sides of the comparison in ET.
  // today() evaluates in UTC, so after ~8pm ET (past midnight UTC) it rolls
  // to tomorrow while visits are still bucketed under the ET date → the query
  // returned 0 every evening.
  const hogql = `
    SELECT
      countIf(event = '$pageview') AS pageviews,
      count(DISTINCT if(event = '$pageview', person_id, NULL)) AS visitors,
      count(DISTINCT if(event = '$pageview', properties.$session_id, NULL)) AS sessions,
      countIf(event = 'user_signed_up') AS signups,
      countIf(event = 'onboarding_completed') AS onboarded,
      countIf(event = 'api_key_copied') AS api_keys
    FROM events
    WHERE event IN ('$pageview', 'user_signed_up', 'onboarding_completed', 'api_key_copied')
      AND toDate(toTimeZone(timestamp, 'America/New_York')) = toDate(toTimeZone(now(), 'America/New_York'))`;
  const res = await fetch(`${host}/api/projects/${projectId}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: hogql } }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PostHog query → ${res.status}`);
  const json = (await res.json()) as { results?: number[][] };
  const row = json.results?.[0] ?? [0, 0, 0, 0, 0, 0];
  const [pageviews, visitors, sessions, signups, onboarded, apiKeys] = row.map((n) => Number(n) || 0);
  const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  await query(
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
    [todayEt, channelId, projectId, visitors, pageviews, sessions, signups ?? 0, onboarded ?? 0, apiKeys ?? 0],
  );
  // Today's traffic sources (same shape as the snapshot job's SOURCES_HOGQL).
  try {
    const srcQ = `
      SELECT
        if(notEmpty(coalesce(session.$entry_utm_source, '')), concat('utm:', session.$entry_utm_source),
           coalesce(session.$entry_referring_domain, '$direct')) AS src,
        count(DISTINCT if(event = '$pageview', person_id, NULL)) AS visitors,
        countIf(event = 'user_signed_up') AS signups
      FROM events
      WHERE event IN ('$pageview', 'user_signed_up')
        AND toDate(toTimeZone(timestamp, 'America/New_York')) = toDate(toTimeZone(now(), 'America/New_York'))
      GROUP BY src
      LIMIT 500`;
    const r2 = await fetch(`${host}/api/projects/${projectId}/query/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query: srcQ } }),
      cache: "no-store",
    });
    if (r2.ok) {
      const j2 = (await r2.json()) as { results?: [string, number, number][] };
      for (const [src, v, sg] of j2.results ?? []) {
        await query(
          `insert into web_referrer_snapshots (snapshot_date, channel_id, source, visitors, signups, captured_at)
           values ($1,$2,$3,$4,$5, now())
           on conflict (snapshot_date, channel_id, source) do update set
             visitors = excluded.visitors, signups = excluded.signups, captured_at = now()`,
          [todayEt, channelId, String(src || "$direct"), Number(v) || 0, Number(sg) || 0],
        );
      }
    }
  } catch {
    // sources are best-effort; the visitor row above already landed
  }
  liveCheckedAt.set(projectId, Date.now());
}

/** Daily website-visitor series for the last `days` ET days, read from the
 *  cron-fed `web_analytics_snapshots` table plus a live top-up for today.
 *  Empty until the PostHog snippet is live and traffic arrives. */
export async function getWebVisitorsDaily(
  channelId: string,
  projectId: string,
  host: string,
  days = 30,
  apiKey?: string | null,
): Promise<DailyVisitors[]> {
  if (!dbConfigured) return [];
  try {
    await Promise.race([
      liveTopUp(projectId, host, channelId, apiKey),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch {
    // best-effort — table still renders
  }

  const rows = await query<{
    snapshot_date: Date | string;
    visitors: number;
    pageviews: number;
    sessions: number;
    signups: number | null;
    onboarded: number | null;
    api_keys: number | null;
  }>(
    `select snapshot_date, visitors, pageviews, sessions, signups, onboarded, api_keys
       from web_analytics_snapshots
      where channel_id = $1
        and snapshot_date >= (current_date - ($2::int - 1))
      order by snapshot_date`,
    [channelId, days],
  ).catch(() => []);

  const key = (d: Date | string) =>
    typeof d === "string" ? d.slice(0, 10) : new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(d);
  return rows.map((r) => ({
    date: key(r.snapshot_date),
    visitors: r.visitors ?? 0,
    pageviews: r.pageviews ?? 0,
    sessions: r.sessions ?? 0,
    signups: r.signups ?? 0,
    onboarded: r.onboarded ?? 0,
    apiKeys: r.api_keys ?? 0,
  }));
}
