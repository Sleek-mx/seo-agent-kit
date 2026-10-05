import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderArticle, updateArchive } from './blog-render.mjs';

const EXPECTED_REMOTE = 'https://github.com/Sleek-mx/sleekacademia.git';
const BRANCH = 'content-drafts';
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export const nairobiDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const slugify = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '');

function checkRemote(repo) {
  for (const kind of ['fetch', 'push']) {
    const remote = kind === 'push' ? git(repo, 'remote', 'get-url', '--push', 'origin') : git(repo, 'remote', 'get-url', 'origin');
    if (remote !== EXPECTED_REMOTE) throw new Error(`Unsafe ${kind} remote: expected ${EXPECTED_REMOTE}`);
  }
}

export function checkSite(siteRepo, worktree) {
  if (!existsSync(siteRepo)) throw new Error('Sleek Academia checkout missing');
  if (path.dirname(path.resolve(siteRepo)) !== path.dirname(path.resolve(worktree)) || path.resolve(siteRepo) === path.resolve(worktree)) {
    throw new Error('Draft worktree must be a separate sibling of the site checkout');
  }
  if (realpathSync(git(siteRepo, 'rev-parse', '--show-toplevel')) !== realpathSync(siteRepo)) throw new Error('SEO_SITE_REPO must be the checkout root');
  checkRemote(siteRepo);
  if (git(siteRepo, 'branch', '--show-current') !== 'main') throw new Error('Site checkout must remain on main');
  // Mx may have uncommitted work on main. This command writes only to the
  // separate, clean content-drafts worktree.
}

export function ensureDraftWorktree(siteRepo, worktree) {
  if (!existsSync(worktree)) {
    let branchExists = true;
    try { git(siteRepo, 'show-ref', '--verify', `refs/heads/${BRANCH}`); } catch { branchExists = false; }
    if (branchExists) git(siteRepo, 'worktree', 'add', worktree, BRANCH);
    else git(siteRepo, 'worktree', 'add', '-b', BRANCH, worktree, 'main');
  }
  if (realpathSync(git(worktree, 'rev-parse', '--show-toplevel')) !== realpathSync(worktree)) throw new Error('Invalid draft worktree');
  checkRemote(worktree);
  if (git(worktree, 'branch', '--show-current') !== BRANCH) throw new Error('Draft worktree must use content-drafts branch');
  if (git(worktree, 'status', '--porcelain')) throw new Error('Draft worktree has uncommitted changes');
}

export function commitDraft(siteRepo, worktree, today, slug, draft, content) {
  checkSite(siteRepo, worktree);
  ensureDraftWorktree(siteRepo, worktree);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Invalid draft date or slug');
  const commonDir = path.resolve(worktree, git(worktree, 'rev-parse', '--git-common-dir'));
  const lock = path.join(commonDir, 'seo-draft.lock');
  mkdirSync(lock); // Atomic cross-process lock; existing lock fails closed.
  try {
    const dir = path.join(worktree, 'drafts');
    const existing = existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith(`${today}-`) && name.endsWith('.md')) : [];
    if (existing.length) throw new Error(`Nairobi daily maximum reached: ${existing[0]}`);
    if (![draft.title, draft.excerpt, draft.body].every((value) => typeof value === 'string' && value.trim())) throw new Error('Incomplete blog draft');
    const indexPath = path.join(worktree, 'public/blog/index.html');
    const notifyPath = path.join(worktree, 'NOTIFY_LATEST.json');
    const articleSlug = `${today}-${slug}`;
    const articleRelative = `public/blog/${articleSlug}.html`;
    const articlePath = path.join(worktree, articleRelative);
    if (existsSync(articlePath)) throw new Error(`Blog slug already exists: ${slug}`);
    const previousIndex = readFileSync(indexPath, 'utf8');
    const previousNotify = existsSync(notifyPath) ? readFileSync(notifyPath, 'utf8') : null;
    const article = renderArticle(worktree, articleSlug, today, draft);
    const archive = updateArchive(previousIndex, articleSlug, today, draft);
    const notify = JSON.stringify({
      title: draft.title.trim(),
      path: articleRelative,
      review_url_path: `/blog/${articleSlug}.html`,
      markdown_path: `drafts/${today}-${slug}.md`,
      branch: BRANCH,
      status: 'review_ready_local',
      site_live: false,
      timestamp: new Date().toISOString(),
    }, null, 2) + '\n';
    mkdirSync(dir, { recursive: true });
    const relative = `drafts/${today}-${slug}.md`;
    const full = path.join(worktree, relative);
    try {
      writeFileSync(full, content, { flag: 'wx' });
      writeFileSync(articlePath, article, { flag: 'wx' });
      writeFileSync(indexPath, archive);
      writeFileSync(notifyPath, notify);
      const changed = [relative, articleRelative, 'public/blog/index.html', 'NOTIFY_LATEST.json'];
      git(worktree, 'add', '--', ...changed);
      git(worktree, 'diff', '--cached', '--check');
      execFileSync('git', ['-C', worktree, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', `Draft blog: ${slug} (${today} Nairobi)`], { stdio: ['ignore', 'pipe', 'pipe'] });
      return { file: full, article: articlePath, notify: notifyPath, commit: git(worktree, 'rev-parse', '--short', 'HEAD') };
    } catch (error) {
      git(worktree, 'reset', '-q', '--', relative, articleRelative, 'public/blog/index.html', 'NOTIFY_LATEST.json');
      rmSync(full, { force: true });
      rmSync(articlePath, { force: true });
      writeFileSync(indexPath, previousIndex);
      if (previousNotify === null) rmSync(notifyPath, { force: true });
      else writeFileSync(notifyPath, previousNotify);
      throw error;
    }
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
