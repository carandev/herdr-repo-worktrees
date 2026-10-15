import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { excludeEntry, ensureExcluded } from '../src/exclude.mjs';

test('excludeEntry anchors and normalizes', () => {
  assert.equal(excludeEntry('.claude/worktrees'), '/.claude/worktrees/');
  assert.equal(excludeEntry('.\\a\\b\\'), '/a/b/');
  assert.equal(excludeEntry('./x//'), '/x/');
});

function memfs(initial) {
  const files = { ...initial };
  return {
    files,
    readFile: async (p) => (p in files ? files[p] : null),
    writeFile: async (p, d) => { files[p] = d; },
    mkdir: async () => {},
  };
}
const file = path.join('/g', 'info', 'exclude');

test('appends when missing and is idempotent', async () => {
  const fs = memfs({});
  assert.equal(await ensureExcluded({ commonDir: '/g', directory: 'wt', fs }), true);
  assert.equal(fs.files[file], '/wt/\n');
  assert.equal(await ensureExcluded({ commonDir: '/g', directory: 'wt', fs }), false);
  assert.equal(fs.files[file], '/wt/\n');
});
test('preserves existing content and adds newline separator', async () => {
  const fs = memfs({ [file]: '# c\nfoo' });
  await ensureExcluded({ commonDir: '/g', directory: 'wt', fs });
  assert.equal(fs.files[file], '# c\nfoo\n/wt/\n');
});
test('recognises equivalent existing entries', async () => {
  const fs = memfs({ [file]: '/wt\r\n' });
  assert.equal(await ensureExcluded({ commonDir: '/g', directory: 'wt', fs }), false);
});
