import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildCreateArgs, createRepoWorktree, planRepoWorktree, resolveTargetPath } from '../src/workflow.mjs';

test('buildCreateArgs without base', () => {
  assert.deepEqual(buildCreateArgs({ repoRoot: '/r', branch: 'b', worktreePath: '/r/w/b' }),
    ['worktree', 'create', '--cwd', '/r', '--branch', 'b', '--path', '/r/w/b', '--focus']);
});
test('buildCreateArgs with base', () => {
  assert.deepEqual(buildCreateArgs({ repoRoot: '/r', branch: 'b', worktreePath: '/p', base: 'main' }).slice(-2), ['--base', 'main']);
});

function deps({ files = {}, herdrError } = {}) {
  const written = {};
  const calls = [];
  return {
    written, calls,
    ctx: { workspace: { worktree: { repo_root: '/main' } } },
    env: { HERDR_PLUGIN_CONFIG_DIR: '/cfg' },
    fs: {
      readFile: async (p) => (p in files ? files[p] : null),
      writeFile: async (p, d) => { written[p] = d; },
      mkdir: async () => {},
    },
    git: async () => '/main/.git\n',
    herdr: async (args) => { calls.push(args); if (herdrError) throw herdrError; return { stdout: 'ok' }; },
    pathApi: path.posix,
  };
}

test('createRepoWorktree wires config, exclude and herdr call', async () => {
  const d = deps({ files: { '/main/.herdr/worktrees.json': '{"directory":"wt"}' } });
  const r = await createRepoWorktree({ branch: 'feat/x', base: 'dev', ...d });
  assert.equal(r.worktreePath, '/main/wt/feat-x');
  assert.equal(d.written['/main/.git/info/exclude'], '/wt/\n');
  assert.deepEqual(d.calls[0], ['worktree', 'create', '--cwd', '/main', '--branch', 'feat/x', '--path', '/main/wt/feat-x', '--focus', '--base', 'dev']);
});
test('createRepoWorktree rejects bad config before touching anything', async () => {
  const d = deps({ files: { '/main/.herdr/worktrees.json': '{"directory":"../out"}' } });
  await assert.rejects(createRepoWorktree({ branch: 'b', ...d }), /escape|outside/i);
  assert.equal(d.calls.length, 0);
  assert.deepEqual(d.written, {});
});
test('createRepoWorktree rejects invalid branch before touching anything', async () => {
  const d = deps();
  await assert.rejects(createRepoWorktree({ branch: '-x', ...d }), /branch/i);
  assert.equal(d.calls.length, 0);
});
test('createRepoWorktree surfaces herdr failure output', async () => {
  const d = deps({ herdrError: Object.assign(new Error('boom'), { stderr: 'branch exists' }) });
  await assert.rejects(createRepoWorktree({ branch: 'b', ...d }), /branch exists/);
});

test('planRepoWorktree computes the default path without side effects', async () => {
  const d = deps({ files: { '/main/.herdr/worktrees.json': '{"directory":"wt"}' } });
  const plan = await planRepoWorktree({ branch: 'feat/x', ...d });
  assert.equal(plan.defaultPath, '/main/wt/feat-x');
  assert.equal(plan.repoRoot, '/main');
  assert.equal(d.calls.length, 0);
  assert.deepEqual(d.written, {});
});

test('resolveTargetPath: empty input keeps the default', () => {
  const plan = { repoRoot: '/main', defaultPath: '/main/wt/b' };
  assert.equal(resolveTargetPath({ plan, input: '', pathApi: path.posix }), '/main/wt/b');
  assert.equal(resolveTargetPath({ plan, input: '   ', pathApi: path.posix }), '/main/wt/b');
  assert.equal(resolveTargetPath({ plan, input: undefined, pathApi: path.posix }), '/main/wt/b');
});
test('resolveTargetPath: relative input resolves against the repo root', () => {
  const plan = { repoRoot: '/main', defaultPath: '/main/wt/b' };
  assert.equal(resolveTargetPath({ plan, input: 'other/place', pathApi: path.posix }), '/main/other/place');
  assert.equal(resolveTargetPath({ plan, input: '../sibling', pathApi: path.posix }), '/sibling');
});
test('resolveTargetPath: absolute input is used as-is', () => {
  const plan = { repoRoot: '/main', defaultPath: '/main/wt/b' };
  assert.equal(resolveTargetPath({ plan, input: '/tmp/wt-b', pathApi: path.posix }), '/tmp/wt-b');
});
test('resolveTargetPath: rejects the repository root itself', () => {
  const plan = { repoRoot: '/main', defaultPath: '/main/wt/b' };
  assert.throws(() => resolveTargetPath({ plan, input: '.', pathApi: path.posix }), /repository root/i);
});

test('createRepoWorktree with custom path inside the repo excludes that path', async () => {
  const d = deps();
  const r = await createRepoWorktree({ branch: 'b', path: 'scratch/b', ...d });
  assert.equal(r.worktreePath, '/main/scratch/b');
  assert.equal(d.written['/main/.git/info/exclude'], '/scratch/b/\n');
  assert.deepEqual(d.calls[0].slice(6, 8), ['--path', '/main/scratch/b']);
});
test('createRepoWorktree with custom path outside the repo does not touch exclude', async () => {
  const d = deps();
  const r = await createRepoWorktree({ branch: 'b', path: '/elsewhere/b', ...d });
  assert.equal(r.worktreePath, '/elsewhere/b');
  assert.deepEqual(d.written, {});
  assert.equal(d.calls.length, 1);
});
test('createRepoWorktree with default path still excludes the configured directory', async () => {
  const d = deps();
  await createRepoWorktree({ branch: 'b', path: '', ...d });
  assert.equal(d.written['/main/.git/info/exclude'], '/.claude/worktrees/\n');
});

// --- layout integration ---
const layoutCfg = (layout) => JSON.stringify({ projects: { main: { layout } } });
function layoutDeps(layout, isDirectory = async () => true) {
  const d = deps({ files: { '/cfg/config.json': layoutCfg(layout) } });
  d.fs.isDirectory = isDirectory;
  d.herdr = async (args) => {
    d.calls.push(args);
    if (args[0] === 'worktree') return { stdout: '{"result":{"workspace":{"workspace_id":"w1"}}}' };
    if (args[1] === 'list') return { stdout: '{"result":{"panes":[{"pane_id":"w1:p1","focused":true}]}}' };
    if (args[1] === 'split') return { stdout: '{"result":{"pane":{"pane_id":"w1:p2"}}}' };
    return { stdout: '' };
  };
  return d;
}
test('plan carries the layout', async () => {
  const plan = await planRepoWorktree({ branch: 'b', ...layoutDeps([{ command: 'claude' }, { split: 'right', command: 'dev' }]) });
  assert.equal(plan.layout.length, 2);
});
test('layout is applied after create', async () => {
  const d = layoutDeps([{ command: 'claude' }, { split: 'right', command: 'dev' }]);
  const r = await createRepoWorktree({ branch: 'b', ...d });
  assert.equal(r.layoutError, undefined);
  assert.deepEqual(r.layoutPaneIds, ['w1:p1', 'w1:p2']);
  assert.equal(d.calls[0][0], 'worktree');
  assert.deepEqual(d.calls.slice(1).map((c) => c[1]), ['list', 'run', 'split', 'run']);
});
test('layout failure does not throw and is reported', async () => {
  const d = layoutDeps([{}, { split: 'right', cwd: 'nope' }], async () => false);
  const r = await createRepoWorktree({ branch: 'b', ...d });
  assert.match(r.layoutError, /does not exist/);
  assert.equal(r.worktreePath, '/main/.claude/worktrees/b');
  assert.equal(d.calls.length, 1);
});
test('no layout means no extra herdr calls', async () => {
  const d = deps();
  const r = await createRepoWorktree({ branch: 'b', ...d });
  assert.equal(d.calls.length, 1);
  assert.equal(r.layoutError, undefined);
});
