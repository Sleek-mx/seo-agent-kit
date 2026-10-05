// Local draft publishing only. This command never pushes or deploys.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSite, commitDraft, ensureDraftWorktree, nairobiDay, slugify } from './draft-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const skill = path.join(root, '.claude/skills/seo-engine');
const config = JSON.parse(readFileSync(path.join(root, 'seo.config.json'), 'utf8'));
const facts = JSON.parse(readFileSync(path.join(skill, 'facts.json'), 'utf8'));
const seeds = JSON.parse(readFileSync(path.join(skill, 'seeds.json'), 'utf8'));
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const topicIndex = args.indexOf('--topic');
if (args.some((a, i) => a !== '--dry-run' && a !== '--topic' && !(topicIndex >= 0 && i === topicIndex + 1)) || (topicIndex >= 0 && !args[topicIndex + 1])) {
  throw new Error('Usage: npm run seo:publish -- [--dry-run] [--topic "title"]');
}
if (process.env.SEO_PUBLISH_AS_DRAFT !== '1' || process.env.SEO_DAILY_MAX !== '1' || config.daily_max !== 1) {
  throw new Error('Draft safety requires SEO_PUBLISH_AS_DRAFT=1 and SEO_DAILY_MAX=1 in .env and config');
}
if (config.site !== 'https://sleekacademia.com' || config.time_zone !== 'Africa/Nairobi' || config.draft_branch !== 'content-drafts' || config.draft_directory !== 'drafts') {
  throw new Error('Unexpected site or draft config');
}

const siteRepo = path.resolve(process.env.SEO_SITE_REPO || path.join(root, '..', 'sleekacademia'));
const worktree = path.resolve(process.env.SEO_DRAFT_WORKTREE || path.join(root, '..', 'sleekacademia-content-drafts'));
const today = nairobiDay();
checkSite(siteRepo, worktree);
ensureDraftWorktree(siteRepo, worktree);

const allTopics = Object.values(seeds).flat().filter((s) => typeof s === 'string');
const dayNumber = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000);
const title = topicIndex >= 0 ? args[topicIndex + 1] : allTopics[dayNumber % allTopics.length];
if (!title) throw new Error('No seed topics configured; pass --topic');
if (title.length > 160) throw new Error('Topic too long');

const base = process.env.LLM_BASE_URL || 'http://localhost:11434/v1';
if (base.replace(/\/$/, '') !== 'http://localhost:11434/v1') throw new Error('Only local Ollama at http://localhost:11434/v1 is allowed');
const model = process.env.LLM_MODEL || 'qwen2.5:3b';
const prompt = `Write a useful SEO article draft for working online college students. Topic: ${title}.
Use ONLY these verified Sleek Academia facts: ${JSON.stringify(facts)}.
Do not invent outcomes, turnaround times, guarantees, testimonials, academic rules, citations, prices, notifications, or URLs. Avoid any claim that experts handle student work. Students own their coursework, submissions, and exams. Show how coaching and AI can support learning. Use plain English, practical examples, and a short FAQ. Return one JSON object with keys title, excerpt, body. body must be plain Markdown with at least two separate ## section headings, including ## FAQ, without a top-level heading or any HTML tags. Use line breaks between sections and - for bullets. Include relevant links only from facts.urls. This is a private human-review draft, never public content.`;

async function generate() {
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, response_format: { type: 'json_object' }, max_tokens: 3500, temperature: 0.4, messages: [{ role: 'system', content: 'Return valid JSON only. Never invent product claims.' }, { role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) throw new Error(`Local Ollama returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error('Local Ollama returned no draft');
  const draft = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim());
  if (![draft.title, draft.excerpt, draft.body].every((v) => typeof v === 'string' && v.trim())) throw new Error('Incomplete Ollama draft');
  // The article shell already owns the sole H1; local models may repeat it.
  draft.body = draft.body.trim().replace(/^#\s+[^\n]+\n+/, '');
  if (/<\/?[a-z][^>]*>/i.test(draft.body)) throw new Error('Draft body contains HTML; expected Markdown');
  if ((draft.body.match(/^##\s+\S/gm) || []).length < 2 || !/^##\s+FAQ\b/im.test(draft.body) || /^#\s+/m.test(draft.body)) {
    throw new Error(`Draft body needs Markdown sections and FAQ; headings: ${JSON.stringify(draft.body.match(/^#{1,3}\s+[^\n]+/gm) || [])}; start: ${JSON.stringify(draft.body.slice(0, 160))}`);
  }
  const text = `${draft.title}\n${draft.excerpt}\n${draft.body}`;
  if (text.length < 600 || draft.body.split(/\s+/).length < 150) throw new Error('Draft too short; nothing committed');
  for (const banned of facts.banned || []) if (text.toLowerCase().includes(banned.toLowerCase())) throw new Error(`Blocked claim: ${banned}`);
  for (const match of text.matchAll(/\$\s?\d+(?:\.\d{2})?/g)) {
    throw new Error(`Price needs human review: ${match[0]}`);
  }
  for (const match of text.matchAll(/https?:\/\/[^\s)\]>"']+/g)) {
    if (!Object.values(facts.urls).includes(match[0].replace(/[.,]+$/, ''))) throw new Error(`Unverified URL: ${match[0]}`);
  }
  return draft;
}

const draft = await generate();
const slug = slugify(draft.title);
if (!slug) throw new Error('Draft title has no usable slug');
const content = `---
status: draft
visibility: private
human_review_required: true
publication_approved: false
nairobi_date: ${today}
source: ${config.site}
---

<!-- DRAFT ONLY: human fact-check and editorial approval required. Never deploy this file. -->

# ${draft.title.trim()}

> Draft excerpt: ${draft.excerpt.trim()}

${draft.body.trim()}
`;
if (dry) {
  console.log(content);
  console.log('Dry run: no file or commit created.');
} else {
  const result = commitDraft(siteRepo, worktree, today, slug, draft, content);
  console.log(`Draft and blog HTML committed locally: ${result.article} (${result.commit}). Notification: ${result.notify}. No push or deployment performed.`);
}
