# Sleek Academia SEO draft kit

This fork generates review-ready article drafts for [sleekacademia.com](https://sleekacademia.com). It uses local Ollama and commits Markdown under `drafts/`, standalone Blog HTML under `public/blog/`, an archive card, and `NOTIFY_LATEST.json` in a separate `content-drafts` worktree of `Sleek-mx/sleekacademia`. A human must check every draft. No script publishes to the public site or pushes the site repo.

Read [SETUP.md](SETUP.md) for installation and local commands. [UNKNOWN.md](UNKNOWN.md) records missing business and analytics facts. [RESULT.md](RESULT.md) records this adaptation.

`seo:publish` creates the local draft bundle and commit. `seo:scout` displays topic seeds. Nairobi-morning drafting is enabled on the Mac Mini via LaunchAgent `com.sleekacademia.seo-daily` (see AUTOPILOT.md). The wrapper still drafts locally only; live promote stays manual.

Optional PostHog snapshot and dashboard components remain in `scripts/`, `lib/`, and `components/`. They are not part of the draft path and require Mx to configure PostHog and a database later. Their day buckets use Africa/Nairobi.

Original project by Kevin Badi, MIT licensed. See [LICENSE](LICENSE).
