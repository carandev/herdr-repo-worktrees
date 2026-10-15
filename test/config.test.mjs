import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadConfig, DEFAULT_DIRECTORY } from '../src/config.mjs';

const fsOf = (files) => ({ readFile: async (p) => (p in files ? files[p] : null) });
const repoFile = path.join('/repo', '.herdr', 'worktrees.json');
const userFile = path.join('/cfg', 'config.json');

test('default when no files', async () => {
  const c = await loadConfig({ repoRoot: '/repo', configDir: '/cfg', fs: fsOf({}) });
  assert.deepEqual(c, { directory: DEFAULT_DIRECTORY, source: 'default' });
  assert.equal(DEFAULT_DIRECTORY, '.claude/worktrees');
});
test('user config beats default', async () => {
  const c = await loadConfig({ repoRoot: '/repo', configDir: '/cfg', fs: fsOf({ [userFile]: '{"directory":"u"}' }) });
  assert.deepEqual(c, { directory: 'u', source: userFile });
});
test('repo config beats user config', async () => {
  const c = await loadConfig({ repoRoot: '/repo', configDir: '/cfg', fs: fsOf({ [userFile]: '{"directory":"u"}', [repoFile]: '{"directory":"r"}' }) });
  assert.deepEqual(c, { directory: 'r', source: repoFile });
});
test('missing configDir is fine', async () => {
  const c = await loadConfig({ repoRoot: '/repo', fs: fsOf({}) });
  assert.equal(c.directory, DEFAULT_DIRECTORY);
});
test('file without directory key falls through', async () => {
  const c = await loadConfig({ repoRoot: '/repo', configDir: '/cfg', fs: fsOf({ [repoFile]: '{}', [userFile]: '{"directory":"u"}' }) });
  assert.equal(c.directory, 'u');
});
test('invalid JSON gives a clear error naming the file', async () => {
  await assert.rejects(loadConfig({ repoRoot: '/repo', fs: fsOf({ [repoFile]: '{oops' }) }), (e) => e.message.includes(repoFile) && /invalid json/i.test(e.message));
});
test('non-string directory is an error', async () => {
  await assert.rejects(loadConfig({ repoRoot: '/repo', fs: fsOf({ [repoFile]: '{"directory":3}' }) }), /directory/);
});
