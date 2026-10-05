# Sleek Academia SEO draft kit — result

Fork: https://github.com/Sleek-mx/seo-agent-kit  
Kit branch: `feat/sleek-academia-drafts` — pushed to the fork; initial adaptation commit `aeaab71`.

## Changed

- Replaced Creator OS/WordPress publishing with local Ollama draft generation. `seo:publish` now commits a marked Markdown draft under `drafts/` on the site's separate `content-drafts` worktree. It never pushes or publishes live.
- Added fail-closed checks for exact `Sleek-mx/sleekacademia` origin fetch and push URLs, clean site `main`, clean draft worktree, local-only model URL, and one draft per Africa/Nairobi day. The site checkout stays on `main`.
- Set `SEO_PUBLISH_AS_DRAFT=1` and `SEO_DAILY_MAX=1`; changed all New York day buckets to Africa/Nairobi.
- Filled `facts.json`, `seo.config.json`, and `seeds.json` from the public [home](https://sleekacademia.com/), [about](https://sleekacademia.com/about.html), [study plan](https://sleekacademia.com/study-plan.html), [AI guidance](https://sleekacademia.com/ai-in-school.html), and [pricing](https://sleekacademia.com/pricing.html) pages, plus social identifiers supplied by Mx. Unknowns are in `UNKNOWN.md`.
- Removed `llms.txt`, AI-citation promise, IndexNow trigger, Creator OS integration, and the live-capable legacy SEO loop. `SETUP.md` explains the local workflow.

## Verified

- `npm test`: draft commit, branch isolation, remote rejection, dirty-checkout rejection, and Nairobi daily cap passed in temporary git fixtures.
- `npm run seo:scout`: displayed the Sleek Academia seed topics.
- Direct `seo:publish -- --dry-run` reached localhost Ollama and failed closed with HTTP 404 because no model is installed. It created a clean `content-drafts` worktree, with no draft file or site commit. No live site push or Namecheap deployment occurred.
- Ollama installed through Homebrew. A free `qwen2.5:0.5b` pull was attempted, but slow transfer prevented completion. Real article quality and generation remain unverified.
- At final check, the site `main` checkout had uncommitted changes from concurrent work. The draft script will refuse to run until that checkout is clean. Those site files were not changed or pushed by this adaptation.

## Mx later

1. Finish `ollama pull qwen2.5:0.5b` and run a dry draft, then review every claim.
2. Add the PostHog snippet and API key if analytics are wanted.
3. Configure the Search Console service account if search metrics are wanted.
4. Do not schedule the daily job yet.
5. Resolve the site `main` checkout's uncommitted changes before running the draft command.
