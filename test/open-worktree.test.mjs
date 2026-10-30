import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  buildWorktreeListArgs,
  buildWorktreeOpenArgs,
  executeApplyLayout,
  executeOpenWorktree,
  filterWorktrees,
  parseWorktreeList,
} from '../src/open-worktree.mjs';

const pathApi = path.posix;
const listOutput = (worktrees) => JSON.stringify({ result: { type: 'worktree_list', worktrees } });
const openOutput = ({ id = 'w7', alreadyOpen = false } = {}) =>
  JSON.stringify({ result: { already_open: alreadyOpen, workspace: { workspace_id: id } } });
const paneList = JSON.stringify({ result: { panes: [{ pane_id: 'w7:p1', tab_id: 'w7:t1', focused: true }] } });
const wsGet = (tabCount) => JSON.stringify({ result: { workspace: { workspace_id: 'w7', tab_count: tabCount } } });
const fs = { isDirectory: async () => true };

/** Fake herdr port: records argv and answers by subcommand. */
function fakeHerdr(answers) {
  const calls = [];
  const herdr = async (args) => {
    calls.push(args);
    const key = `${args[0]} ${args[1]}`;
    const answer = answers[key];
    if (answer instanceof Error) throw answer;
    return { stdout: answer ?? '{}' };
  };
  return { herdr, calls };
}

test('argv builders', () => {
  assert.deepEqual(buildWorktreeListArgs('/repo'), ['worktree', 'list', '--cwd', '/repo']);
  assert.deepEqual(buildWorktreeOpenArgs({ repoRoot: '/repo', worktreePath: '/repo/.wt/a' }),
    ['worktree', 'open', '--cwd', '/repo', '--path', '/repo/.wt/a', '--focus']);
});

test('parseWorktreeList keeps usable worktrees, normalises paths and flags open ones', () => {
  const items = parseWorktreeList(listOutput([
    { path: '/repo/.', branch: 'main', is_linked_worktree: false, open_workspace_id: 'w1' },
    { path: '/repo/.wt/feat-a', branch: 'feat/a', is_linked_worktree: true },
    { path: '/repo/.wt/detached', is_detached: true, is_linked_worktree: true },
    { path: '/repo/.wt/gone', branch: 'gone', is_prunable: true },
    { path: '/bare', is_bare: true },
  ]), { pathApi });
  assert.deepEqual(items, [
    { path: '/repo', branch: 'main', linked: false, openWorkspaceId: 'w1' },
    { path: '/repo/.wt/feat-a', branch: 'feat/a', linked: true, openWorkspaceId: undefined },
    { path: '/repo/.wt/detached', branch: undefined, linked: true, openWorkspaceId: undefined },
  ]);
  assert.throws(() => parseWorktreeList('nope'), /JSON/);
  assert.deepEqual(parseWorktreeList('{"result":{}}'), []);
});

test('filterWorktrees matches branch or path, case-insensitively, keeping order', () => {
  const items = [
    { path: '/repo', branch: 'main' },
    { path: '/repo/.wt/feat-API', branch: 'feat/api' },
    { path: '/repo/.wt/fix-x', branch: 'fix/x' },
  ];
  assert.deepEqual(filterWorktrees(items, ''), items);
  assert.deepEqual(filterWorktrees(items, 'API').map((i) => i.branch), ['feat/api']);
  assert.deepEqual(filterWorktrees(items, 'fix-').map((i) => i.branch), ['fix/x']);
  assert.deepEqual(filterWorktrees(items, 'zzz'), []);
});

test('executeOpenWorktree opens the worktree and applies the layout to a newly opened workspace', async () => {
  const { herdr, calls } = fakeHerdr({ 'worktree open': openOutput(), 'pane list': paneList });
  const result = await executeOpenWorktree({
    repoRoot: '/repo', worktreePath: '/repo/.wt/a', layout: [{ command: 'claude' }], herdr, fs, pathApi,
  });
  assert.deepEqual(calls, [
    ['worktree', 'open', '--cwd', '/repo', '--path', '/repo/.wt/a', '--focus'],
    ['pane', 'list', '--workspace', 'w7'],
    ['pane', 'run', 'w7:p1', 'claude'],
  ]);
  assert.deepEqual(result, { worktreePath: '/repo/.wt/a', workspaceId: 'w7', alreadyOpen: false, layoutPaneIds: ['w7:p1'] });
});

test('executeOpenWorktree only focuses an already open workspace (no layout)', async () => {
  const { herdr, calls } = fakeHerdr({ 'worktree open': openOutput({ alreadyOpen: true }) });
  const result = await executeOpenWorktree({
    repoRoot: '/repo', worktreePath: '/repo/.wt/a', layout: [{ command: 'claude' }], herdr, fs, pathApi,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(result, { worktreePath: '/repo/.wt/a', workspaceId: 'w7', alreadyOpen: true });
});

test('executeOpenWorktree without a layout just opens', async () => {
  const { herdr, calls } = fakeHerdr({ 'worktree open': openOutput() });
  const result = await executeOpenWorktree({ repoRoot: '/repo', worktreePath: '/repo/.wt/a', layout: [], herdr, fs, pathApi });
  assert.equal(calls.length, 1);
  assert.equal(result.layoutPaneIds, undefined);
  assert.equal(result.layoutError, undefined);
});

test('executeOpenWorktree reports herdr failures and keeps layout failures as layoutError', async () => {
  const failure = Object.assign(new Error('exit 1'), { stderr: 'not a worktree\n' });
  await assert.rejects(
    executeOpenWorktree({ repoRoot: '/repo', worktreePath: '/x', layout: [], herdr: fakeHerdr({ 'worktree open': failure }).herdr, fs, pathApi }),
    /herdr worktree open failed: not a worktree/,
  );
  const { herdr } = fakeHerdr({ 'worktree open': openOutput(), 'pane list': '{"result":{"panes":[]}}' });
  const result = await executeOpenWorktree({ repoRoot: '/repo', worktreePath: '/repo/.wt/a', layout: [{ command: 'claude' }], herdr, fs, pathApi });
  assert.match(result.layoutError, /no panes/);
});

test('executeApplyLayout applies the layout to the given workspace', async () => {
  const { herdr, calls } = fakeHerdr({
    'workspace get': wsGet(1), 'pane list': paneList, 'pane split': '{"result":{"pane":{"pane_id":"w7:p2"}}}',
  });
  const result = await executeApplyLayout({
    layout: [{ command: 'claude' }, { split: 'right', from: 0 }], worktreePath: '/repo/.wt/a', workspaceId: 'w7', herdr, fs, pathApi,
  });
  assert.deepEqual(calls, [
    ['workspace', 'get', 'w7'],
    ['pane', 'list', '--workspace', 'w7'],
    ['pane', 'run', 'w7:p1', 'claude'],
    ['pane', 'split', 'w7:p1', '--direction', 'right', '--cwd', '/repo/.wt/a', '--no-focus'],
  ]);
  assert.deepEqual(result, { paneIds: ['w7:p1', 'w7:p2'] });
});

test('executeApplyLayout rejects a missing layout or workspace before any herdr call', async () => {
  const { herdr, calls } = fakeHerdr({});
  await assert.rejects(
    executeApplyLayout({ layout: [], worktreePath: '/wt', workspaceId: 'w7', herdr, fs, pathApi }),
    /No layout configured for this repository/,
  );
  await assert.rejects(
    executeApplyLayout({ layout: [{ command: 'x' }], worktreePath: '/wt', workspaceId: undefined, herdr, fs, pathApi }),
    /Could not determine the current workspace/,
  );
  assert.equal(calls.length, 0);
});

test('executeApplyLayout skips a workspace with more than one tab', async () => {
  const { herdr, calls } = fakeHerdr({ 'workspace get': wsGet(2) });
  await assert.rejects(
    executeApplyLayout({ layout: [{ command: 'claude' }], worktreePath: '/wt', workspaceId: 'w7', herdr, fs, pathApi }),
    /Workspace already has 2 tabs; layout not applied/,
  );
  assert.deepEqual(calls, [['workspace', 'get', 'w7']]);
});

test('executeApplyLayout refuses when the tab count cannot be read', async () => {
  const { herdr, calls } = fakeHerdr({ 'workspace get': '{"result":{"workspace":{}}}' });
  await assert.rejects(
    executeApplyLayout({ layout: [{ command: 'claude' }], worktreePath: '/wt', workspaceId: 'w7', herdr, fs, pathApi }),
    /Could not read the tab count of workspace w7/,
  );
  assert.equal(calls.length, 1);
});
