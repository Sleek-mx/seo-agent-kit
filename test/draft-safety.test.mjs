import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkSite, commitDraft, ensureDraftWorktree, nairobiDay } from '../.claude/skills/seo-engine/scripts/draft-core.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const expected = 'https://github.com/Sleek-mx/sleekacademia.git';

function fixture() {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'seo-draft-test-'));
  const site = path.join(parent, 'sleekacademia');
  const drafts = path.join(parent, 'sleekacademia-content-drafts');
  git(parent, 'init', '-b', 'main', site);
  git(site, 'config', 'user.name', 'Draft Test');
  git(site, 'config', 'user.email', 'draft-test@example.invalid');
  git(site, 'remote', 'add', 'origin', expected);
  writeFileSync(path.join(site, 'README.md'), 'site fixture\n');
  git(site, 'add', 'README.md');
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
    const result = commitDraft(f.site, f.drafts, '2026-10-05', 'example', body);
    assert.equal(readFileSync(result.file, 'utf8'), body);
    assert.equal(git(f.site, 'branch', '--show-current'), 'main');
    assert.equal(git(f.drafts, 'branch', '--show-current'), 'content-drafts');
    assert.equal(git(f.drafts, 'show', '--format=', '--name-only', 'HEAD'), 'drafts/2026-10-05-example.md');
    assert.throws(() => commitDraft(f.site, f.drafts, '2026-10-05', 'second', body), /daily maximum/);
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('fails closed on wrong fetch or push remote and dirty main', () => {
  const f = fixture();
  try {
    git(f.site, 'remote', 'set-url', 'origin', 'https://github.com/other/sleekacademia.git');
    assert.throws(() => checkSite(f.site, f.drafts), /Unsafe fetch remote/);
    git(f.site, 'remote', 'set-url', 'origin', expected);
    git(f.site, 'remote', 'set-url', '--push', 'origin', 'https://github.com/other/sleekacademia.git');
    assert.throws(() => checkSite(f.site, f.drafts), /Unsafe push remote/);
    git(f.site, 'remote', 'set-url', '--push', 'origin', expected);
    writeFileSync(path.join(f.site, 'dirty.txt'), 'dirty');
    assert.throws(() => checkSite(f.site, f.drafts), /uncommitted changes/);
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});
