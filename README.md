# PostHog Analytics Kit + SEO Agent

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

## The SEO agent (blog engine)

The same PostHog data drives a **self-improving SEO loop** for a WordPress blog. It writes posts that
rank, reads PostHog to see which posts bring signups, and writes more like the winners. It is three
Claude Code skills in `.claude/skills/`:

| Skill | What it does |
|---|---|
| `seo-engine` | The loop. **scout** queues topics from 5 feeds (spin-offs of posts that convert, Search Console queries you don't rank for, news RSS, your releases, a seed backlog). **publish** writes one post per run, runs a fact gate against your `facts.json` (up to 2 rewrites, else rejected), publishes to WordPress and pings IndexNow. **measure** (nightly) attributes PostHog sessions, signups and AI-engine visits to the post they entered on, adds Search Console clicks, and re-weights topic clusters by signups per post. |
| `wordpress-blog` | Connect a WordPress site through Creator OS and write, edit, publish or delete articles from Claude (MCP tools), the REST API or the CLI. Workflows for one-off articles, turning a winning social post into an article, and refreshing old posts. |
| `ai-search-files` | Next.js templates so the blog is readable by Google and AI answer engines: auto-generated `llms.txt` / `llms-full.txt`, sitemap, robots rules for AI crawlers, BlogPosting + FAQPage JSON-LD, IndexNow. |

```
 FEEDS                 PIPELINE (publish, 1 post per run)              LEARN (measure, nightly)
 spin-offs ─┐
 GSC gaps  ─┤  scout   brief -> write -> fact gate -> publish -> IndexNow   PostHog entry visitors,
 news RSS  ─┼──────>   (2 rewrites max, else rejected with a reason)        signups, AI referrals
 releases  ─┤  queue                                                      + Search Console clicks
 seeds     ─┘    ^                                                                  |
                 └──────── cluster weights (signups per post, 0.5x to 3x) <─────────┘
```

### Setup

1. Connect your WordPress site in [Creator OS](https://www.creatoros.ca) and put that workspace's
   API key in `.env` as `CREATOROS_API_KEY` (see `.claude/skills/wordpress-blog/SKILL.md`).
2. `cp seo.config.example.json seo.config.json` and fill in your site, brand, signup path and signup event.
3. In `.claude/skills/seo-engine/`: `cp facts.example.json facts.json` and `cp seeds.example.json seeds.json`.
   `facts.json` is the product truth the writer may use. Keep it accurate; it is what stops invented features.
4. Set a model: `ANTHROPIC_API_KEY`, or `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` for any
   OpenAI-compatible API. Optional: `POSTHOG_AI_KEY` logs every generation to PostHog LLM analytics.
5. Optional: Search Console service account (`GSC_SA_JSON_B64`) and `INDEXNOW_KEY`.

```bash
npm run seo:scout -- --dry-run     # what would it queue?
npm run seo:publish -- --dry-run   # write + fact-check one post to a temp file, publish nothing
npm run seo:scout && npm run seo:publish && npm run seo:measure
```

Schedule (ET): scout 7:30, publish hourly 8:00 to 17:00 (capped by `daily_max`), measure 22:00.
`SEO_PUBLISH_AS_DRAFT=1` lands posts as drafts if you want to review first.

Full details, guard rails and debugging queries: `.claude/skills/seo-engine/SKILL.md`.

## Use it with Claude Code

Everything in `.claude/skills/` is a Claude Code skill: `posthog-analytics`, `seo-engine`, `wordpress-blog` and `ai-search-files`. Copy the folders into your project's `.claude/skills/` and Claude will know how to set up, run, debug and extend each piece.

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
| `.claude/skills/seo-engine/` | SEO loop: `scripts/scout.mjs`, `publish.mjs`, `measure.mjs`, `llm.mjs`, `schema.sql`, fact/seed templates |
| `.claude/skills/wordpress-blog/` | WordPress via Creator OS: connect, write, publish |
| `.claude/skills/ai-search-files/` | `templates/` for llms.txt, sitemap, robots, JSON-LD (FAQPage) |
| `seo.config.example.json` | SEO engine config |

Built by Kevin ([KevBuildsApps on YouTube](https://www.youtube.com/@KevBuildsApps)). Learn to build systems like this in [Kev's No Code Academy](https://www.skool.com/kevs-no-code-academy/about).

MIT licensed.
