# Sleek Academia local Blog draft setup

The kit uses local Ollama only. A successful `npm run seo:publish` commits one Markdown draft, one `public/blog/<Nairobi-date>-<slug>.html` page, an archive card, and `NOTIFY_LATEST.json` to the separate `content-drafts` worktree. Draft HTML carries `noindex,nofollow`; no command here pushes a branch or deploys to Namecheap.

## One-time setup

1. Keep the site checkout at `SEO_SITE_REPO` on `main` and the draft worktree at `SEO_DRAFT_WORKTREE` on `content-drafts`. Uncommitted work on site `main` is left untouched. The draft worktree must be clean, use the exact Sleek-mx origin, and contain `public/blog/index.html` plus `templates/blog-article.html` from the Blog site branch.
2. Copy `.env.example` to `.env` in this kit. Leave `SEO_PUBLISH_AS_DRAFT=1`, `SEO_DAILY_MAX=1`, and `LLM_BASE_URL=http://localhost:11434/v1`. No paid key is needed. `.env` is ignored by git.
3. Start Ollama locally and install a free model: `ollama serve` in one terminal, then `ollama pull qwen2.5:3b` in another. Check `ollama list`. The local model can produce weak or incorrect prose; edit every draft before promotion.
4. Run `npm test`, `npm run seo:scout`, then `npm run seo:publish -- --dry-run`. When the output is acceptable, run `npm run seo:publish` or add `--topic "specific topic"`. Dry run never writes or commits.

## Daily schedule (enabled on Mac Mini via launchd)

Unattended drafting is enabled with LaunchAgent `com.sleekacademia.seo-daily` (runner `~/Automations/sleekacademia-seo/run-daily-nairobi.sh`) (hourly at `:00` Mac local time). `scripts/daily-nairobi.sh` still exits unless the hour is **09** in **Africa/Nairobi**, so Chicago DST does not shift the morning window. Requires Ollama (`brew services start ollama`) and a clean draft worktree. See [AUTOPILOT.md](AUTOPILOT.md) for pause/re-enable and the live promote path.

Optional crontab equivalent (not used; `crontab` may hang without Full Disk Access):

```crontab
0 * * * * /Volumes/Macsie_SSD/Github/Sleek\ Academia/seo-agent-kit/scripts/daily-nairobi.sh >> /tmp/sleek-academia-seo-daily.log 2>&1
```

The wrapper uses `/opt/homebrew/bin/node` unless `SEO_NODE_BIN` is set. The one-draft-per-Nairobi-day lock still applies to manual and scheduled runs.

## Grok Bot notification hook

Grok Bot (Sleek Academia) can poll `/Volumes/Macsie_SSD/Github/Sleek Academia/sleekacademia-content-drafts/NOTIFY_LATEST.json`. When `timestamp` changes and `status` is `review_ready_local`, send Mx a chat ping with `title`, `path`, and branch `content-drafts`. Persist the last notified timestamp in bot state to prevent repeat pings. `site_live: false` means review-ready HTML exists locally; it does **not** mean sleekacademia.com serves it. The bot should verify the file exists before pinging.

Example notification shape:

```json
{
  "title": "How to plan a busy class week",
  "path": "public/blog/2026-10-05-how-to-plan-a-busy-class-week.html",
  "review_url_path": "/blog/2026-10-05-how-to-plan-a-busy-class-week.html",
  "markdown_path": "drafts/2026-10-05-how-to-plan-a-busy-class-week.md",
  "branch": "content-drafts",
  "status": "review_ready_local",
  "site_live": false,
  "timestamp": "2026-10-05T06:00:00.000Z"
}
```

## Review and promotion

Read the Markdown and HTML, verify every claim against current public pages, and edit the draft. The HTML remains `noindex` while on `content-drafts`. After Mx approves a post, Mx can bring that post and its archive entry into a site release branch, change only the approved page to `index,follow`, rebuild the sitemap with `npm run build:sitemap`, and run site tests. Mx controls the separate Namecheap sync. This kit has no production credentials, webhook, `seo:promote` command, or automatic push.
