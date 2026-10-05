---
name: seo-engine
description: Generate private Sleek Academia article drafts with local Ollama and commit them to the content-drafts site worktree for human review.
---

# Sleek Academia SEO drafts

Read `SETUP.md` in this kit before running. `seo:publish` is retained as a compatibility alias, but it only commits a Markdown draft under `drafts/` on the `content-drafts` branch. It never calls a publishing API or pushes.

Use `facts.json` as the sole source for product claims. Verify every generated claim against the live site before approving it. Human editorial review is mandatory. Maximum one local draft commit per Africa/Nairobi day.

```bash
npm run seo:scout
npm run seo:publish -- --dry-run
npm run seo:publish -- --topic "How to plan an online class around a work shift"
```
