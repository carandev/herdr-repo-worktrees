import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  applyLayout,
  buildPaneListArgs,
  buildRunArgs,
  buildSplitArgs,
  parseRootPaneId,
  parseSplitPaneId,
  parseWorkspaceId,
  resolveLayoutCwds,
} from '../src/layout.mjs';
import * as tabApi from '../src/layout.mjs';

test('argv builders', () => {
  assert.deepEqual(buildPaneListArgs('w1'), ['pane', 'list', '--workspace', 'w1']);
  assert.deepEqual(buildRunArgs('w1:p1', 'npm run dev'), ['pane', 'run', 'w1:p1', 'npm run dev']);
  assert.deepEqual(buildSplitArgs({ paneId: 'w1:p1', direction: 'right', cwd: '/wt' }),
    ['pane', 'split', 'w1:p1', '--direction', 'right', '--cwd', '/wt', '--no-focus']);
  assert.deepEqual(buildSplitArgs({ paneId: 'w1:p1', direction: 'down', cwd: '/wt', ratio: 0.3 }),
    ['pane', 'split', 'w1:p1', '--direction', 'down', '--cwd', '/wt', '--ratio', '0.3', '--no-focus']);
});

test('parseWorkspaceId', () => {
  assert.equal(parseWorkspaceId('{"result":{"workspace":{"workspace_id":"w9"}}}'), 'w9');
  assert.throws(() => parseWorkspaceId('ok'), /JSON/);
  assert.throws(() => parseWorkspaceId('{"result":{}}'), /workspace id/);
});

test('parseRootPaneId prefers the focused pane, else the first', () => {
  const list = (panes) => JSON.stringify({ result: { panes } });
  assert.equal(parseRootPaneId(list([{ pane_id: 'a' }, { pane_id: 'b', focused: true }])), 'b');
  assert.equal(parseRootPaneId(list([{ pane_id: 'a' }, { pane_id: 'b' }])), 'a');
  assert.throws(() => parseRootPaneId(list([])), /no panes/);
});

test('parseSplitPaneId', () => {
  assert.equal(parseSplitPaneId('{"result":{"pane":{"pane_id":"w1:p3"}}}'), 'w1:p3');
  assert.throws(() => parseSplitPaneId('{}'), /pane id/);
});

test('resolveLayoutCwds defaults to the worktree root', () => {
  assert.deepEqual(
    resolveLayoutCwds({ layout: [{}, { cwd: 'src/api' }], worktreePath: '/wt', pathApi: path.posix }),
    ['/wt', '/wt/src/api'],
  );
});

const CREATE = JSON.stringify({ result: { workspace: { workspace_id: 'w1' } } });

function harness({ dirs = ['/wt', '/wt/src/api'], panes } = {}) {
  const calls = [];
  let n = 1;
  return {
    calls,
    fs: { isDirectory: async (p) => dirs.includes(p) },
    herdr: async (args) => {
      calls.push(args);
      if (args[1] === 'list') return { stdout: JSON.stringify({ result: { panes: panes ?? [{ pane_id: 'w1:p1', focused: true }] } }) };
      if (args[1] === 'split') { n += 1; return { stdout: JSON.stringify({ result: { pane: { pane_id: `w1:p${n}` } } }) }; }
      return { stdout: '' };
    },
  };
}

test('applyLayout runs the full sequence', async () => {
  const h = harness();
  const layout = [
    { command: 'claude' },
    { split: 'right', cwd: 'src/api', command: 'npm run dev', from: 0 },
    { split: 'down', ratio: 0.3, from: 0, command: 'lazygit' },
    { split: 'down', from: 1 },
  ];
  const r = await applyLayout({ layout, worktreePath: '/wt', createOutput: CREATE, herdr: h.herdr, fs: h.fs, pathApi: path.posix });
  assert.deepEqual(r.paneIds, ['w1:p1', 'w1:p2', 'w1:p3', 'w1:p4']);
  assert.deepEqual(h.calls, [
    ['pane', 'list', '--workspace', 'w1'],
    ['pane', 'run', 'w1:p1', 'claude'],
    ['pane', 'split', 'w1:p1', '--direction', 'right', '--cwd', '/wt/src/api', '--no-focus'],
    ['pane', 'run', 'w1:p2', 'npm run dev'],
    ['pane', 'split', 'w1:p1', '--direction', 'down', '--cwd', '/wt', '--ratio', '0.3', '--no-focus'],
    ['pane', 'run', 'w1:p3', 'lazygit'],
    ['pane', 'split', 'w1:p2', '--direction', 'down', '--cwd', '/wt', '--no-focus'],
  ]);
});

test('applyLayout cds the root pane when entry 0 has a different cwd', async () => {
  const h = harness();
  await applyLayout({ layout: [{ cwd: 'src/api', command: 'x' }], worktreePath: '/wt', createOutput: CREATE, herdr: h.herdr, fs: h.fs, pathApi: path.posix });
  assert.deepEqual(h.calls.slice(1), [
    ['pane', 'run', 'w1:p1', 'cd "/wt/src/api"'],
    ['pane', 'run', 'w1:p1', 'x'],
  ]);
});

test('applyLayout fails before touching panes when a cwd is missing', async () => {
  const h = harness({ dirs: ['/wt'] });
  await assert.rejects(
    applyLayout({ layout: [{}, { split: 'right', cwd: 'src/api', from: 0 }], worktreePath: '/wt', createOutput: CREATE, herdr: h.herdr, fs: h.fs, pathApi: path.posix }),
    /does not exist/,
  );
  assert.equal(h.calls.length, 0);
});

test('applyLayout throws on missing workspace id before any herdr call', async () => {
  const h = harness();
  await assert.rejects(applyLayout({ layout: [{}], worktreePath: '/wt', createOutput: 'ok', herdr: h.herdr, fs: h.fs, pathApi: path.posix }), /JSON/);
  assert.equal(h.calls.length, 0);
});

test('tab argv builder and root pane parser', () => {
  const { buildTabCreateArgs, parseTabRootPaneId } = tabApi;
  assert.deepEqual(buildTabCreateArgs({ workspaceId: 'w1', cwd: '/wt' }), ['tab', 'create', '--workspace', 'w1', '--cwd', '/wt']);
  assert.equal(parseTabRootPaneId('{"result":{"root_pane":{"pane_id":"w1:p5"}}}'), 'w1:p5');
  assert.throws(() => parseTabRootPaneId('{"result":{}}'), /root pane/);
});

test('applyLayout opens a tab for entries without split and can split inside it', async () => {
  const h = harness();
  const herdr = async (args) => {
    if (args[0] === 'tab') { h.calls.push(args); return { stdout: '{"result":{"root_pane":{"pane_id":"w1:p9"}}}' }; }
    return h.herdr(args);
  };
  const layout = [{}, { cwd: 'src/api', command: 'htop' }, { split: 'right', from: 1, command: 'x' }];
  const r = await applyLayout({ layout, worktreePath: '/wt', createOutput: CREATE, herdr, fs: h.fs, pathApi: path.posix });
  assert.deepEqual(r.paneIds, ['w1:p1', 'w1:p9', 'w1:p2']);
  assert.deepEqual(h.calls, [
    ['pane', 'list', '--workspace', 'w1'],
    ['tab', 'create', '--workspace', 'w1', '--cwd', '/wt/src/api'],
    ['pane', 'run', 'w1:p9', 'htop'],
    ['pane', 'split', 'w1:p9', '--direction', 'right', '--cwd', '/wt', '--no-focus'],
    ['pane', 'run', 'w1:p2', 'x'],
  ]);
});

test('label builders and root pane parser with tab id', () => {
  assert.deepEqual(tabApi.buildTabCreateArgs({ workspaceId: 'w1', cwd: '/wt', label: 'my logs' }),
    ['tab', 'create', '--workspace', 'w1', '--cwd', '/wt', '--label', 'my logs']);
  assert.deepEqual(tabApi.buildTabRenameArgs('w1:t1', 'my tab'), ['tab', 'rename', 'w1:t1', 'my tab']);
  const out = JSON.stringify({ result: { panes: [{ pane_id: 'a', tab_id: 't' }, { pane_id: 'b', tab_id: 'u', focused: true }] } });
  assert.deepEqual(tabApi.parseRootPane(out), { paneId: 'b', tabId: 'u' });
});

test('applyLayout renames the root tab before its command and labels new tabs', async () => {
  const h = harness({ panes: [{ pane_id: 'w1:p1', tab_id: 'w1:t1', focused: true }] });
  const herdr = async (args) => {
    if (args[0] === 'tab' && args[1] === 'create') { h.calls.push(args); return { stdout: '{"result":{"root_pane":{"pane_id":"w1:p9"}}}' }; }
    return h.herdr(args);
  };
  await applyLayout({ layout: [{ label: 'main', command: 'claude' }, { label: 'logs' }], worktreePath: '/wt', createOutput: CREATE, herdr, fs: h.fs, pathApi: path.posix });
  assert.deepEqual(h.calls, [
    ['pane', 'list', '--workspace', 'w1'],
    ['tab', 'rename', 'w1:t1', 'main'],
    ['pane', 'run', 'w1:p1', 'claude'],
    ['tab', 'create', '--workspace', 'w1', '--cwd', '/wt', '--label', 'logs'],
  ]);
});

test('applyLayout errors clearly when a root label has no tab id', async () => {
  const h = harness();
  await assert.rejects(
    applyLayout({ layout: [{ label: 'main' }], worktreePath: '/wt', createOutput: CREATE, herdr: h.herdr, fs: h.fs, pathApi: path.posix }),
    /tab_id/,
  );
});
