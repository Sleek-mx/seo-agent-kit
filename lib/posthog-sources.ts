import { dbConfigured, query } from "./db";

// Your own site: visits referred by it count as "Internal / sign-in".
const SITE = (process.env.SITE_DOMAIN || "example.com").toLowerCase();

// Where web-app visitors come from. The posthog-snapshot job
// stores RAW session entry sources per Nairobi day (referring domain, or `utm:<src>`
// when a UTM source is present) in web_referrer_snapshots; this groups them
// into families for the Overview "Traffic sources" card.

export type SourceFamily = {
  key: string;
  label: string;
  /** PlatformDot glyph key when we have a brand mark, else null (favicon). */
  platform: string | null;
  /** Domain for the favicon fallback. */
  domain: string | null;
  visitors: number;
  signups: number;
};

type Rule = { key: string; label: string; platform?: string; domain?: string; test: RegExp };

const RULES: Rule[] = [
  { key: "youtube", label: "YouTube", platform: "youtube", test: /(^|\.)youtube\.com$|^youtu\.be$|^utm:(youtube|yt)$/ },
  { key: "google", label: "Google", domain: "google.com", test: /(^|\.)google\.[a-z.]+$|^utm:google$/ },
  { key: "github", label: "GitHub", domain: "github.com", test: /(^|\.)github\.com$|^utm:github$/ },
  { key: "threads", label: "Threads", platform: "threads", test: /(^|\.)threads\.(net|com)$|^utm:threads$/ },
  { key: "instagram", label: "Instagram", platform: "instagram", test: /(^|\.)instagram\.com$|^utm:(ig|instagram)$/ },
  { key: "facebook", label: "Facebook", platform: "facebook", test: /(^|\.)facebook\.com$|^utm:(fb|facebook)$/ },
  { key: "x", label: "X", platform: "twitter", test: /^t\.co$|(^|\.)(x|twitter)\.com$|^utm:(x|twitter)$/ },
  { key: "linkedin", label: "LinkedIn", platform: "linkedin", test: /(^|\.)linkedin\.com$|^lnkd\.in$|^utm:linkedin$/ },
  { key: "tiktok", label: "TikTok", platform: "tiktok", test: /(^|\.)tiktok\.com$|^utm:tiktok$/ },
  { key: "chatgpt", label: "ChatGPT", domain: "chatgpt.com", test: /(^|\.)chatgpt\.com$|(^|\.)openai\.com$|^utm:chatgpt(\.com)?$/ },
  { key: "claude", label: "Claude", domain: "claude.ai", test: /(^|\.)claude\.ai$|^utm:claude(\.ai)?$/ },
  { key: "perplexity", label: "Perplexity", domain: "perplexity.ai", test: /(^|\.)perplexity\.ai$|^utm:perplexity(\.ai)?$/ },
  { key: "gemini", label: "Gemini", domain: "gemini.google.com", test: /^gemini\.google\.com$|^utm:gemini$/ },
  { key: "copilot", label: "Copilot", domain: "copilot.microsoft.com", test: /copilot|^utm:copilot(\.com)?$/ },
  {
    key: "search",
    label: "Other search",
    domain: "duckduckgo.com",
    test: /(^|\.)(bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.com|baidu\.com|yandex\.[a-z]+|ecosia\.org|search\.brave\.com)$/,
  },
  { key: "internal", label: "Internal / sign-in", domain: SITE, test: new RegExp(`(^|\\.)${SITE.replace(/\./g, "\\.")}$|^appleid\\.apple\\.com$|^accounts\\.google\\.com$`) },
  { key: "direct", label: "Direct", test: /^\$direct$|^$/ },
];

export function sourceFamily(raw: string): Omit<SourceFamily, "visitors" | "signups"> {
  const s = (raw || "$direct").trim().toLowerCase();
  for (const r of RULES) {
    if (r.test.test(s)) return { key: r.key, label: r.label, platform: r.platform ?? null, domain: r.domain ?? null };
  }
  const dom = s.replace(/^utm:/, "").replace(/^www\./, "");
  return { key: `d:${dom}`, label: dom, platform: null, domain: dom.includes(".") ? dom : null };
}

/** Sources for the last `days` Nairobi days, grouped into families, visitors desc. */
export async function getWebSources(channelId: string, days = 30): Promise<SourceFamily[]> {
  if (!dbConfigured) return [];
  const rows = await query<{ source: string; visitors: number; signups: number }>(
    `select source, sum(visitors)::int as visitors, sum(signups)::int as signups
       from web_referrer_snapshots
      where channel_id = $1
        and snapshot_date >= ((now() at time zone 'Africa/Nairobi')::date - ($2::int - 1))
      group by source`,
    [channelId, days],
  ).catch(() => []);
  const by = new Map<string, SourceFamily>();
  for (const r of rows) {
    const f = sourceFamily(r.source);
    const cur = by.get(f.key) ?? { ...f, visitors: 0, signups: 0 };
    cur.visitors += Number(r.visitors) || 0;
    cur.signups += Number(r.signups) || 0;
    by.set(f.key, cur);
  }
  return [...by.values()].sort((a, b) => b.visitors - a.visitors || b.signups - a.signups);
}


export type SourcePeriodKey = "today" | "yesterday" | "7d" | "30d";
export type SourcePeriod = { key: SourcePeriodKey; label: string; sources: SourceFamily[] };

/** The card's period tabs: Today / Yesterday / 7 days / 30
 *  days, all grouped from one read of the last 30 Nairobi days so tabs switch
 *  client-side without refetching. */
export async function getWebSourcePeriods(channelId: string): Promise<SourcePeriod[]> {
  if (!dbConfigured) return [];
  const rows = await query<{ d: string; source: string; visitors: number; signups: number }>(
    `select snapshot_date::text as d, source, visitors, signups
       from web_referrer_snapshots
      where channel_id = $1
        and snapshot_date >= ((now() at time zone 'Africa/Nairobi')::date - 29)`,
    [channelId],
  ).catch(() => []);
  const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
  const age = (d: string) =>
    Math.round((Date.parse(`${todayEt}T12:00:00Z`) - Date.parse(`${d.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
  const group = (keep: (a: number) => boolean): SourceFamily[] => {
    const by = new Map<string, SourceFamily>();
    for (const r of rows) {
      if (!keep(age(r.d))) continue;
      const f = sourceFamily(r.source);
      const cur = by.get(f.key) ?? { ...f, visitors: 0, signups: 0 };
      cur.visitors += Number(r.visitors) || 0;
      cur.signups += Number(r.signups) || 0;
      by.set(f.key, cur);
    }
    return [...by.values()]
      .filter((x) => x.visitors > 0 || x.signups > 0)
      .sort((a, b) => b.visitors - a.visitors || b.signups - a.signups);
  };
  return [
    { key: "today", label: "Today", sources: group((a) => a === 0) },
    { key: "yesterday", label: "Yesterday", sources: group((a) => a === 1) },
    { key: "7d", label: "7 days", sources: group((a) => a >= 0 && a < 7) },
    { key: "30d", label: "30 days", sources: group((a) => a >= 0 && a < 30) },
  ];
}
