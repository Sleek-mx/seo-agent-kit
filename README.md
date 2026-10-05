# Sleek Academia SEO draft kit

This fork generates private article drafts for [sleekacademia.com](https://sleekacademia.com). It uses local Ollama and commits Markdown under `drafts/` in a separate `content-drafts` worktree of `Sleek-mx/sleekacademia`. A human must check every draft. No script publishes live content or pushes the site repo.

Read [SETUP.md](SETUP.md) for installation and local commands. [UNKNOWN.md](UNKNOWN.md) records missing business and analytics facts. [RESULT.md](RESULT.md) records this adaptation.

The old `seo:publish` command remains a compatibility alias for draft creation. `seo:scout` displays the verified-topic seed list. No cron or daily job is installed.

Optional PostHog snapshot and dashboard components remain in `scripts/`, `lib/`, and `components/`. They are not part of the draft path and require Mx to configure PostHog and a database later. Their day buckets use Africa/Nairobi.

Original project by Kevin Badi, MIT licensed. See [LICENSE](LICENSE).
