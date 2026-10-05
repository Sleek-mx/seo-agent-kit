import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkSite, commitDraft, ensureDraftWorktree, nairobiDay } from '../.claude/skills/seo-engine/scripts/draft-core.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const expected = 'https://github.com/Sleek-mx/sleekacademia.git';
const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture() {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'seo-draft-test-'));
  const site = path.join(parent, 'sleekacademia');
  const drafts = path.join(parent, 'sleekacademia-content-drafts');
  git(parent, 'init', '-b', 'main', site);
  git(site, 'config', 'user.name', 'Draft Test');
  git(site, 'config', 'user.email', 'draft-test@example.invalid');
  git(site, 'remote', 'add', 'origin', expected);
  writeFileSync(path.join(site, 'README.md'), 'site fixture\n');
  mkdirSync(path.join(site, 'public/blog'), { recursive: true });
  mkdirSync(path.join(site, 'templates'), { recursive: true });
  writeFileSync(path.join(site, 'public/blog/index.html'), '<!-- BLOG_POSTS_START -->Empty sa-blog-empty<!-- BLOG_POSTS_END -->');
  writeFileSync(path.join(site, 'templates/blog-article.html'), '<title>{{TITLE}}</title><meta name="description" content="{{DESCRIPTION}}"><meta name="robots" content="noindex,nofollow"><a href="/blog/{{SLUG}}.html">{{DATE}}</a><article>{{BODY}}</article>');
  git(site, 'add', 'README.md');
  git(site, 'add', 'public/blog/index.html', 'templates/blog-article.html');
  git(site, 'commit', '-m', 'Initial site');
  return { parent, site, drafts };
}

test('commits only one marked draft per Nairobi day on content-drafts', () => {
  const f = fixture();
  try {
    assert.equal(nairobiDay(new Date('2026-10-04T22:30:00Z')), '2026-10-05');
    checkSite(f.site, f.drafts);
    ensureDraftWorktree(f.site, f.drafts);
    const body = '---\nstatus: draft\nhuman_review_required: true\npublication_approved: false\n---\n\n# Example\n';
    const draft = { title: 'Example <script>', excerpt: 'Learn with AI & plan $&.', body: '## A practical plan\n\nUse **notes** and [the guide](https://sleekacademia.com/).\n\n<script>alert(1)</script>' };
    const result = commitDraft(f.site, f.drafts, '2026-10-05', 'example', draft, body);
    assert.equal(readFileSync(result.file, 'utf8'), body);
    const article = readFileSync(result.article, 'utf8');
    assert.match(article, /Example &lt;script&gt;/);
    assert.match(article, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(article, /noindex,nofollow/);
    const archive = readFileSync(path.join(f.drafts, 'public/blog/index.html'), 'utf8');
    assert.match(archive, /\/blog\/2026-10-05-example\.html/);
    assert.match(archive, /plan \$&/);
    const notify = JSON.parse(readFileSync(result.notify, 'utf8'));
    assert.equal(notify.title, draft.title);
    assert.equal(notify.status, 'review_ready_local');
    assert.equal(notify.site_live, false);
    assert.equal(git(f.site, 'branch', '--show-current'), 'main');
    assert.equal(git(f.drafts, 'branch', '--show-current'), 'content-drafts');
    assert.deepEqual(git(f.drafts, 'show', '--format=', '--name-only', 'HEAD').split('\n').sort(), [
      'NOTIFY_LATEST.json', 'drafts/2026-10-05-example.md', 'public/blog/2026-10-05-example.html', 'public/blog/index.html',
    ]);
    assert.throws(() => commitDraft(f.site, f.drafts, '2026-10-05', 'second', draft, body), /daily maximum/);
    const next = commitDraft(f.site, f.drafts, '2026-10-06', 'example', draft, body);
    assert.match(next.article, /2026-10-06-example\.html$/);
    assert.match(readFileSync(path.join(f.drafts, 'public/blog/index.html'), 'utf8'), /2026-10-05-example\.html/);
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('fails closed on wrong fetch or push remote; tolerates unrelated dirty main', () => {
  const f = fixture();
  try {
    git(f.site, 'remote', 'set-url', 'origin', 'https://github.com/other/sleekacademia.git');
    assert.throws(() => checkSite(f.site, f.drafts), /Unsafe fetch remote/);
    git(f.site, 'remote', 'set-url', 'origin', expected);
    git(f.site, 'remote', 'set-url', '--push', 'origin', 'https://github.com/other/sleekacademia.git');
    assert.throws(() => checkSite(f.site, f.drafts), /Unsafe push remote/);
    git(f.site, 'remote', 'set-url', '--push', 'origin', expected);
    writeFileSync(path.join(f.site, 'dirty.txt'), 'dirty');
    assert.doesNotThrow(() => checkSite(f.site, f.drafts));
    ensureDraftWorktree(f.site, f.drafts);
    writeFileSync(path.join(f.drafts, 'dirty.txt'), 'dirty');
    assert.throws(() => ensureDraftWorktree(f.site, f.drafts), /uncommitted changes/);
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('seo:publish generates the complete review bundle through the local Ollama path', () => {
  const f = fixture();
  try {
    const mockPath = path.join(f.parent, 'mock-ollama.mjs');
    const body = '# Plan a working student week\n\n## A weekly routine\n\n' + Array(38).fill('Read the syllabus, group deadlines, review notes, ask a question, and practice the concept yourself.').join(' ') + '\n\n## FAQ\n\nWhat helps most? A short plan you can repeat.';
    const article = { title: 'Plan a working student week', excerpt: 'Build a practical class routine around work and study.', body };
    const payload = JSON.stringify({ choices: [{ message: { content: JSON.stringify(article) } }] });
    writeFileSync(mockPath, `globalThis.fetch = async (url) => { if (url !== 'http://localhost:11434/v1/chat/completions') throw new Error('Unexpected model URL'); return new Response(${JSON.stringify(payload)}, { status: 200, headers: { 'content-type': 'application/json' } }); };\n`);
    const output = execFileSync(process.execPath, [
      '--import', mockPath, path.join(kitRoot, '.claude/skills/seo-engine/scripts/publish.mjs'),
      '--topic', 'How to plan an online class around work',
    ], {
      cwd: kitRoot,
      env: {
        ...process.env,
        SEO_SITE_REPO: f.site,
        SEO_DRAFT_WORKTREE: f.drafts,
        SEO_PUBLISH_AS_DRAFT: '1',
        SEO_DAILY_MAX: '1',
        LLM_BASE_URL: 'http://localhost:11434/v1',
        LLM_MODEL: 'local-test',
      },
      encoding: 'utf8',
    });
    assert.match(output, /Draft and blog HTML committed locally/);
    const notify = JSON.parse(readFileSync(path.join(f.drafts, 'NOTIFY_LATEST.json'), 'utf8'));
    assert.equal(notify.title, article.title);
    assert.match(notify.path, /^public\/blog\/\d{4}-\d{2}-\d{2}-plan-a-working-student-week\.html$/);
    assert.match(readFileSync(path.join(f.drafts, notify.path), 'utf8'), /<h2>A weekly routine<\/h2>/);
    assert.doesNotMatch(readFileSync(path.join(f.drafts, notify.path), 'utf8'), /<p># Plan a working student week<\/p>/);
    assert.match(readFileSync(path.join(f.drafts, notify.markdown_path), 'utf8'), /publication_approved: false/);
    assert.equal(git(f.drafts, 'status', '--porcelain'), '');
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});
