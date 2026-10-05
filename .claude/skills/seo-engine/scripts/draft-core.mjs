import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
  if (git(siteRepo, 'status', '--porcelain')) throw new Error('Site checkout has uncommitted changes');
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

export function commitDraft(siteRepo, worktree, today, slug, content) {
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
    mkdirSync(dir, { recursive: true });
    const relative = `drafts/${today}-${slug}.md`;
    const full = path.join(worktree, relative);
    writeFileSync(full, content, { flag: 'wx' });
    git(worktree, 'add', '--', relative);
    execFileSync('git', ['-C', worktree, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--only', '-m', `Draft: ${slug} (${today} Nairobi)`, '--', relative], { stdio: ['ignore', 'pipe', 'pipe'] });
    return { file: full, commit: git(worktree, 'rev-parse', '--short', 'HEAD') };
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
