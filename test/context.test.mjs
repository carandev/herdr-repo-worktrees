import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVerbatimPrefix, extractContext, resolveMainRepoRoot } from '../src/context.mjs';

test('stripVerbatimPrefix removes the Windows verbatim prefix only', () => {
  assert.equal(stripVerbatimPrefix('\\\\?\\C:\\a\\b'), 'C:\\a\\b');
  assert.equal(stripVerbatimPrefix('C:/a'), 'C:/a');
  assert.equal(stripVerbatimPrefix(undefined), undefined);
});
test('extractContext reads nested workspace/worktree defensively', () => {
  const c = extractContext({ workspace: { workspace_id: 'w1', worktree: { repo_root: '\\\\?\\C:\\r', checkout_path: 'C:/r/wt' } } }, {});
  assert.deepEqual(c, { workspaceId: 'w1', startDirs: ['C:\\r', 'C:/r/wt'] });
});
test('extractContext falls back to env and top-level fields', () => {
  const c = extractContext({ cwd: '/x', worktree: { repo_root: '/r' } }, { HERDR_WORKSPACE_ID: 'w9' });
  assert.equal(c.workspaceId, 'w9');
  assert.deepEqual(c.startDirs, ['/r', '/x']);
});
test('extractContext survives garbage', () => {
  assert.deepEqual(extractContext(null, {}), { workspaceId: undefined, startDirs: [] });
  assert.deepEqual(extractContext('x', {}), { workspaceId: undefined, startDirs: [] });
});
test('resolveMainRepoRoot uses parent of git common dir (linked worktree lands on main repo)', async () => {
  const calls = [];
  const git = async (args, cwd) => { calls.push([args, cwd]); return '/main/.git\n'; };
  const r = await resolveMainRepoRoot({ startDirs: ['/main/.claude/worktrees/x'], git });
  assert.deepEqual(r, { repoRoot: '/main', commonDir: '/main/.git' });
  assert.deepEqual(calls[0][0], ['rev-parse', '--path-format=absolute', '--git-common-dir']);
});
test('resolveMainRepoRoot tries next dir when git fails', async () => {
  const git = async (args, cwd) => { if (cwd === '/bad') throw new Error('nope'); return '/ok/.git'; };
  const r = await resolveMainRepoRoot({ startDirs: ['/bad', '/ok'], git });
  assert.equal(r.repoRoot, '/ok');
});
test('resolveMainRepoRoot falls back to toplevel for non-.git common dir', async () => {
  const git = async (args) => (args.includes('--git-common-dir') ? '/srv/repo.git\n' : '/srv/work\n');
  const r = await resolveMainRepoRoot({ startDirs: ['/srv/work'], git });
  assert.deepEqual(r, { repoRoot: '/srv/work', commonDir: '/srv/repo.git' });
});
test('resolveMainRepoRoot errors when nothing works', async () => {
  await assert.rejects(resolveMainRepoRoot({ startDirs: [], git: async () => '' }), /repository/i);
});
