import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveWorktreePath } from '../src/path.mjs';

const posix = path.posix;
const win = path.win32;

test('resolves under repo root with slugged branch (posix)', () => {
  assert.equal(
    resolveWorktreePath({ repoRoot: '/r/app', directory: '.claude/worktrees', branch: 'feat/x', pathApi: posix }),
    '/r/app/.claude/worktrees/feat-x',
  );
});
test('resolves on windows paths', () => {
  assert.equal(
    resolveWorktreePath({ repoRoot: 'C:\\r\\app', directory: '.claude/worktrees', branch: 'feat/x', pathApi: win }),
    'C:\\r\\app\\.claude\\worktrees\\feat-x',
  );
});
test('rejects absolute directories (posix, windows, UNC)', () => {
  for (const d of ['/tmp/x', 'C:\\x', 'C:/x', '\\\\srv\\share']) {
    assert.throws(() => resolveWorktreePath({ repoRoot: '/r/app', directory: d, branch: 'b', pathApi: posix }), /absolute/i, d);
  }
});
test('rejects traversal out of the repo', () => {
  for (const d of ['..', '../x', 'a/../../x', '.']) {
    assert.throws(() => resolveWorktreePath({ repoRoot: '/r/app', directory: d, branch: 'b', pathApi: posix }), /(escape|outside|directory)/i, d);
  }
});
test('rejects empty or non-string directory', () => {
  for (const d of ['', '  ', undefined, 5]) {
    assert.throws(() => resolveWorktreePath({ repoRoot: '/r/app', directory: d, branch: 'b', pathApi: posix }), /directory/i);
  }
});
test('escape check is case-insensitive on win32 and still allows inside paths', () => {
  assert.equal(
    resolveWorktreePath({ repoRoot: 'C:\\Repo', directory: 'wt\\..\\wt2', branch: 'b', pathApi: win }),
    'C:\\Repo\\wt2\\b',
  );
  assert.throws(() => resolveWorktreePath({ repoRoot: 'C:\\Repo', directory: '..\\repo2', branch: 'b', pathApi: win }), /escape|outside/i);
});
