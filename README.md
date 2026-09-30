# PostHog Analytics Kit

The PostHog web analytics setup from **Creator OS** (the marketing dashboard behind KevBuildsApps), pulled out so you can drop it into your own project.

It gives you:

- **A twice-daily snapshot job** that pulls from PostHog (HogQL Query API) into Postgres:
  - visitors, pageviews and sessions per day
  - your signup / onboarding / activation funnel events
  - where each session came from (referrer or UTM)
- **A live "today" top-up** that keeps today's numbers current between snapshots.
- **Traffic-source grouping** of raw referrers into families: YouTube, Google, Threads, Instagram, X, LinkedIn, TikTok, ChatGPT, Claude, Perplexity, Gemini, Copilot, other search, internal and direct.
- **Dashboard cards (React + Tailwind):**
  - Web chart: visitors with signups and subscribers layered on top, same bar width, so the height shows conversion
  - Web funnel
  - Traffic sources, with Today / Yesterday / 7 days / 30 days tabs

Every day is an **America/New_York** day, never UTC. That stops evening visits from landing on tomorrow's date. Change `America/New_York` everywhere if you want another zone.

## Why snapshots?

Charts read from your own Postgres, not from PostHog on every page load. That makes pages fast and costs no PostHog query credits. You also keep history even if you change PostHog projects.

## Setup (5 minutes)

1. **Install PostHog on your site.** Also capture your funnel events. Rename them in the queries if yours differ.
   ```js
   posthog.capture("user_signed_up")
   posthog.capture("onboarding_completed")
   posthog.capture("api_key_copied")   // your "activated" moment
   ```
2. **Create a personal API key** in PostHog (Settings > Personal API keys) with **Query: Read**.
3. **Configure and run:**
   ```bash
   cp .env.example .env     # fill DATABASE_URL, POSTHOG_API_KEY, POSTHOG_PROJECT_ID
   npm install
   npm run backfill         # last 90 days
   npm run snapshot         # then schedule this at 9 AM + 9 PM
   ```
   You can schedule it with any cron: Railway cron, GitHub Actions, crontab, or Vercel cron hitting a route that runs it.

   The tables are created on first run. `sql/schema.sql` has them if you'd rather create them yourself.

## Using the dashboard pieces (Next.js App Router)

Copy `lib/` and `components/` into your app. You need `pg`, `recharts` and Tailwind.

```tsx
// app/dashboard/page.tsx  (server component)
import { getWebVisitorsDaily } from "@/lib/posthog-client";
import { getWebSourcePeriods } from "@/lib/posthog-sources";
import { WebTrafficChart } from "@/components/WebTrafficChart";
import { WebFunnel } from "@/components/WebFunnel";
import { TrafficSources } from "@/components/TrafficSources";

export default async function Page() {
  const days = await getWebVisitorsDaily("default", process.env.POSTHOG_PROJECT_ID!, process.env.POSTHOG_HOST ?? "https://us.posthog.com", 30);
  const periods = await getWebSourcePeriods("default");
  const sum = (k: keyof (typeof days)[number]) => days.reduce((a, d) => a + Number(d[k]), 0);

  return (
    <>
      <WebTrafficChart
        variant="web"
        data={days.map((d) => ({ date: d.date, count: d.signups }))}
        traffic={days.map((d) => ({ date: d.date, count: d.visitors }))}
        signups={days.map((d) => ({ date: d.date, count: d.signups }))}
        subscribers={[] /* paid subs per day from Stripe / RevenueCat, if you have them */}
      />
      <WebFunnel steps={[
        { label: "Visitors", value: sum("visitors"), color: "#64748b" },
        { label: "Signed up", value: sum("signups"), color: "#8b5cf6" },
        { label: "Onboarded", value: sum("onboarded"), color: "#06b6d4" },
        { label: "Activated", value: sum("apiKeys"), color: "#10b981" },
      ]} />
      <TrafficSources periods={periods} />
    </>
  );
}
```

The components use a few utility classes from the original design system: `card`, `card-title`, `num` and `eyebrow`. Define them in your global CSS, or swap them for your own.

## Tracked links (bonus pattern)

To see which **post** drove a visit, send links through UTM-tagged URLs, e.g. `https://yoursite.com/?utm_source=threads&utm_campaign=post-123`. UTM sources win over the referrer in the source grouping. ChatGPT, for example, sends `utm_source=chatgpt.com` with no referrer.

## Use it with Claude Code

`.claude/skills/posthog-analytics/SKILL.md` is a skill. Copy the folder into your project's `.claude/skills/` and Claude will know how to set up, backfill, debug and extend the kit.

## Files

| Path | What |
|---|---|
| `scripts/posthog-snapshot.mjs` | The snapshot job: visitors/funnel per ET day + traffic sources, upserted |
| `lib/posthog-client.ts` | `getWebVisitorsDaily()`: reads snapshots + live top-up for today |
| `lib/posthog-sources.ts` | `sourceFamily()` grouping rules, `getWebSources()`, `getWebSourcePeriods()` |
| `lib/db.ts`, `lib/format.ts` | Tiny pg + number-format helpers |
| `components/WebTrafficChart.tsx` | Visitors / signups / subscribers layered bar chart (recharts) |
| `components/WebFunnel.tsx` | Funnel bars with step-to-step conversion |
| `components/TrafficSources.tsx` | Traffic-source table with period tabs |
| `sql/schema.sql` | Table definitions |

MIT licensed.
