import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaneOpenArgs, parseContextJson } from '../src/pane.mjs';

// Herdr rejects --workspace for popup panes: "overlay and popup plugin panes target the active pane".
test('buildPaneOpenArgs forwards workspace and context via env, never --workspace', () => {
  const args = buildPaneOpenArgs({ pluginId: 'repo-worktrees', workspaceId: 'w1', contextJson: '{"a":1}' });
  assert.equal(args.includes('--workspace'), false);
  assert.deepEqual(args, [
    'plugin', 'pane', 'open', '--plugin', 'repo-worktrees', '--entrypoint', 'prompt', '--focus',
    '--env', 'REPO_WORKTREES_WORKSPACE_ID=w1',
    '--env', 'REPO_WORKTREES_CONTEXT_JSON={"a":1}',
  ]);
});
test('buildPaneOpenArgs omits what is unknown', () => {
  assert.deepEqual(buildPaneOpenArgs({ pluginId: 'p' }), ['plugin', 'pane', 'open', '--plugin', 'p', '--entrypoint', 'prompt', '--focus']);
});
test('parseContextJson tolerates missing and invalid input', () => {
  assert.deepEqual(parseContextJson('{"x":1}'), { x: 1 });
  assert.equal(parseContextJson(undefined), null);
  assert.equal(parseContextJson('{bad'), null);
});
