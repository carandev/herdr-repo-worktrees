import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { decodeKeys } from '../src/keys.mjs';
import { createPicker, render, selected, setStatus, update, visibleItems } from '../src/worktree-picker.mjs';

const items = [
  { path: '/repo', branch: 'main', linked: false, openWorkspaceId: 'w1' },
  { path: '/repo/.wt/feat-a', branch: 'feat/a', linked: true },
  { path: '/elsewhere/fix-b', branch: 'fix/b', linked: true },
];
const picker = () => createPicker({ items, repoRoot: '/repo', repoName: 'repo', pathApi: path.posix });

function type(state, input) {
  const effects = [];
  for (const key of decodeKeys(input)) {
    const r = update(state, key);
    state = r.state;
    if (r.effect) effects.push(r.effect);
  }
  return { state, effects };
}
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

test('starts on the first linked worktree that is not open', () => {
  assert.equal(selected(picker()).branch, 'feat/a');
  const allMain = createPicker({ items: [items[0]], repoRoot: '/repo', pathApi: path.posix });
  assert.equal(selected(allMain).branch, 'main');
  assert.equal(selected(createPicker({ items: [], repoRoot: '/repo' })), undefined);
});

test('Up/Down move the selection within bounds', () => {
  let { state } = type(picker(), '\x1b[B\x1b[B\x1b[B');
  assert.equal(selected(state).branch, 'fix/b');
  ({ state } = type(state, '\x1b[A\x1b[A\x1b[A'));
  assert.equal(selected(state).branch, 'main');
});

test('typing filters and resets the selection; Backspace and Ctrl+U edit the filter', () => {
  let { state } = type(picker(), 'fix');
  assert.deepEqual(visibleItems(state).map((i) => i.branch), ['fix/b']);
  assert.equal(selected(state).branch, 'fix/b');
  ({ state } = type(state, '\x7f\x7f\x7f'));
  assert.equal(visibleItems(state).length, 3);
  ({ state } = type(state, 'zz\x15'));
  assert.equal(state.query, '');
});

test('Enter submits the selection; with no match it shows an error', () => {
  assert.deepEqual(type(picker(), '\r').effects, ['submit']);
  const r = type(picker(), 'zzz\r');
  assert.deepEqual(r.effects, []);
  assert.equal(r.state.status, 'No matching worktree');
});

test('Esc clears the filter first, then cancels; Ctrl+C always cancels', () => {
  let r = type(picker(), 'fe\x1b');
  assert.deepEqual(r.effects, []);
  assert.equal(r.state.query, '');
  assert.deepEqual(type(r.state, '\x1b').effects, ['cancel']);
  assert.deepEqual(type(picker(), 'fe\x03').effects, ['cancel']);
});

test('render lists branches, repo-relative paths and open markers', () => {
  const { text } = render(setStatus(picker(), 'boom'), { columns: 70, color: false });
  const plain = strip(text);
  assert.match(plain, /Open worktree · repo/);
  assert.match(plain, /main\s+\.\s+open/);
  assert.match(plain, /▸ feat\/a\s+\.wt\/feat-a/);
  assert.match(plain, /fix\/b\s+\/elsewhere\/fix-b/);
  assert.match(plain, /boom/);
  for (const line of plain.split('\r\n')) assert.ok(line.length <= 69, line);
});

test('render shows an empty-state line and a detached label', () => {
  const empty = strip(render(createPicker({ items: [], repoRoot: '/r' }), { color: false }).text);
  assert.match(empty, /No worktrees/);
  const detached = createPicker({ items: [{ path: '/r/.wt/x', linked: true }], repoRoot: '/r', pathApi: path.posix });
  assert.match(strip(render(detached, { color: false }).text), /\(detached\)/);
});
