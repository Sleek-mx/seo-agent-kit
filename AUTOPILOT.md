# Sleek Academia SEO autopilot (Mac Mini)

Enabled on machine `Ephantuss-Mac-mini-2.local` (`05771f88-7ce2-450c-bf25-9702b26f4ec5`).

## What runs automatically

### A) Daily draft (local only)

| | |
|---|---|
| Agent | `com.sleekacademia.seo-daily` (LaunchAgent) |
| Plist | `~/Library/LaunchAgents/com.sleekacademia.seo-daily.plist` |
| Runner | `~/Automations/sleekacademia-seo/run-daily-nairobi.sh` (internal disk — launchd cannot *exec* scripts from `/Volumes/Macsie_SSD`) |
| Kit | `/Volumes/Macsie_SSD/Github/Sleek Academia/seo-agent-kit` (reads `.env` + `publish.mjs` via Node) |
| Gate | Runner exits unless hour is **09** in `Africa/Nairobi` (plist fires hourly at `:00` Mac local) |
| Cap | `SEO_DAILY_MAX=1` — one committed draft per Nairobi calendar day |
| Model | Local Ollama `qwen2.5:3b` (`brew services`: `sh.brew.ollama`) |
| Output | Markdown + noindex Blog HTML + archive card + `NOTIFY_LATEST.json` in `sleekacademia-content-drafts` on branch `content-drafts` |
| Logs | `~/Automations/sleekacademia-seo/logs/launchd.out` and `launchd.err` |
| Verified | Launchd probe dry-run succeeded (cwd + node + Ollama) on 2026-10-05 |
| Does **not** | Push to GitHub, merge to `main`, or deploy to Namecheap |

**Next fire:** 2026-10-06 09:00 EAT = 2026-10-06 01:00 CDT.

Note: 2026-10-05 Nairobi day already consumed by the QA preview fixture.

Kit copy of `scripts/daily-nairobi.sh` remains the documented recipe; the LaunchAgent uses the Automations runner so TCC does not block execution from the external volume.

### B) Live deploy path (existing Namecheap recipe)

There is no separate gitsync binary. Production sync is:

1. Land **approved** content on GitHub `origin/main`.
2. Either wait for the **existing cPanel cron** (`*/5` pulls `origin/main` + rsync with `.env` excludes), or run Mac wrapper `~/bin/gitsync` (SSH → `/home/sleenegb/repositories/sleekacademia/scripts/gitsync.sh`).
3. `gitsync.sh` fail-closes if live `.env` is missing; never wipe `.env`.

Mac wrapper (installed per `sleekacademia/docs/gitsync.md`):

```bash
~/bin/gitsync          # sync current origin/main → live app + public_html
~/bin/gitsync --help
```

SSH (non-interactive BatchMode OK): `sleenegb@198.54.115.224` port `21098`.

Last successful host GitSync log seen: deployed `14cb87f` (current `main`) at 2026-10-05 07:30 server time.

## Promote to live (manual gate — not auto)

Autopilot does **not** auto-merge drafts to `main`. Human review is required.

1. **Blog shell on main:** merge open PR [#18](https://github.com/Sleek-mx/sleekacademia/pull/18) (`feat/blog-seo-wire`) into `main` first — live `/blog/` does not exist on `main` yet. (Vercel check on the PR is FAILURE; Namecheap is the production path.)
2. **Approve a draft:** edit Markdown/HTML in `sleekacademia-content-drafts`; set robots from `noindex,nofollow` → `index,follow` only for the approved page; rebuild sitemap (`npm run build:sitemap`); keep `site_live: false` in NOTIFY until after production verify.
3. **Land on main:** bring that post + archive entry into a release branch → merge to `main` → `git push origin main`.
4. **Deploy:** wait ≤5 min for cPanel cron, or run `~/bin/gitsync`. Confirm on https://sleekacademia.com before calling it live.
5. **Do not** promote the QA preview (`2026-10-05-qa-preview-…`) without rewriting it as a real article.

## Pause / disable

```bash
# Stop daily drafting
launchctl bootout gui/$(id -u)/com.sleekacademia.seo-daily
# Or:
launchctl unload ~/Library/LaunchAgents/com.sleekacademia.seo-daily.plist

# Re-enable
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sleekacademia.seo-daily.plist

# Pause Ollama (drafts will fail until restarted)
brew services stop ollama

# Live deploy: do not push to origin/main; optional skip ~/bin/gitsync
# Server */5 cron still deploys whatever is already on origin/main.
```

Crontab was **not** used: `crontab -` hung on macOS permission; launchd is the enabled scheduler.

## Grok Bot NOTIFY poll path

Poll file:

`/Volumes/Macsie_SSD/Github/Sleek Academia/sleekacademia-content-drafts/NOTIFY_LATEST.json`

When `timestamp` changes and `status` is `review_ready_local`:

- Ping Mx in chat with `title`, `path`, `markdown_path`, branch `content-drafts`.
- Persist last notified `timestamp` in bot state (no repeat pings).
- Verify the HTML file exists under the drafts worktree before pinging.
- `site_live: false` means **local review only** — not that sleekacademia.com serves it.

Example shape: see SETUP.md.
