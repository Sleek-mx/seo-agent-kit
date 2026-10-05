# Drafts-only local setup

1. From this kit checkout, run `cp .env.example .env`. The draft commands use Node built-ins, so no npm install is needed. Keep `SEO_PUBLISH_AS_DRAFT=1`, `SEO_DAILY_MAX=1`, and `LLM_BASE_URL=http://localhost:11434/v1`. No paid API key is used.
2. Install Ollama if needed: `brew install ollama`. Start it with `ollama serve` in a terminal, then run `ollama pull qwen2.5:0.5b`. This small free model is for local drafts and may need substantial human editing. This does not install a cron job.
3. Confirm the site checkout at `SEO_SITE_REPO` is clean, on `main`, and has exactly `https://github.com/Sleek-mx/sleekacademia.git` as both fetch and push URL for `origin`. The script creates a sibling `SEO_DRAFT_WORKTREE` on `content-drafts` if needed.
4. Preview topics with `npm run seo:scout`. Generate without a commit with `npm run seo:publish -- --dry-run`. Create a local draft commit with `npm run seo:publish -- --topic "your specific topic"`.
5. Review `drafts/YYYY-MM-DD-<slug>.md` in the draft worktree. Check every product statement, price, link, academic-integrity claim, and example against the live site. The file is marked `status: draft`, `human_review_required: true`, and `publication_approved: false`. No push or live publish occurs.

Each Nairobi calendar day allows at most one file under `drafts/`. This applies even when `--topic` is supplied. A git lock prevents two simultaneous local runs from committing two drafts. Safety checks stop on wrong remote, dirty checkout, wrong branch, missing Ollama, or nonlocal model URL. If a generation fails, no draft is committed. A dry run may create the worktree but does not write a draft.

`seo:publish` is a legacy command name only. Do not schedule it yet. This kit does not deploy to Namecheap.
