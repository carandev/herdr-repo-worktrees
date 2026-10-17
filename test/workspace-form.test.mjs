import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeKeys } from '../src/keys.mjs';
import { createWorkspaceForm, render, setStatus, update } from '../src/workspace-form.mjs';

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

test('directory is prefilled with cursor at the end', () => {
  const s = createWorkspaceForm({ directory: '/work/repo' });
  assert.equal(s.values.directory, '/work/repo');
  assert.equal(s.cursors.directory, 10);
  assert.equal(s.focus, 0);
});
test('typing edits the focused field; Tab moves to label', () => {
  let { state } = type(createWorkspaceForm({ directory: '/a' }), 'b\t');
  assert.equal(state.values.directory, '/ab');
  assert.equal(state.focus, 1);
  ({ state } = type(state, 'API'));
  assert.equal(state.values.label, 'API');
});
test('Enter on Directory moves to Label; Enter on Label submits', () => {
  let r = type(createWorkspaceForm({ directory: '/a' }), '\r');
  assert.deepEqual(r.effects, []);
  assert.equal(r.state.focus, 1);
  r = type(r.state, '\r');
  assert.deepEqual(r.effects, ['submit']);
});
test('Ctrl+S submits from any field; empty directory shows an error and refocuses', () => {
  assert.deepEqual(type(createWorkspaceForm({ directory: '/a' }), '\x13').effects, ['submit']);
  const r = type(createWorkspaceForm({ directory: '' }), '\t\x13');
  assert.deepEqual(r.effects, []);
  assert.equal(r.state.focus, 0);
  assert.equal(r.state.status, 'Directory is required');
});
test('Esc and Ctrl+C cancel; Ctrl+U clears; editing clears the status', () => {
  assert.deepEqual(type(createWorkspaceForm({ directory: '/a' }), '\x1b').effects, ['cancel']);
  assert.deepEqual(type(createWorkspaceForm({ directory: '/a' }), '\x03').effects, ['cancel']);
  let { state } = type(createWorkspaceForm({ directory: '/a' }), '\x15');
  assert.equal(state.values.directory, '');
  state = setStatus(state, 'oops');
  ({ state } = type(state, 'x'));
  assert.equal(state.status, '');
});
test('Backspace, Left/Home edit and move the cursor', () => {
  let { state } = type(createWorkspaceForm({ directory: '/abc' }), '\x7f');
  assert.equal(state.values.directory, '/ab');
  ({ state } = type(state, '\x1b[D\x1b[Dx'));
  assert.equal(state.values.directory, '/xab');
  ({ state } = type(state, '\x1b[H'));
  assert.equal(state.cursors.directory, 0);
});
test('render shows fields, status and a cursor inside the box; no SGR without color', () => {
  const s = setStatus(createWorkspaceForm({ directory: '/work/repo' }), 'does not exist');
  const { text, cursor } = render(s, { columns: 60, color: false });
  assert.equal(text.includes('\x1b'), false);
  const plain = strip(text);
  assert.match(plain, /New workspace/);
  assert.match(plain, /Directory +\/work\/repo/);
  assert.match(plain, /Label/);
  assert.match(plain, /does not exist/);
  assert.equal(cursor.row, 2);
  assert.equal(cursor.col, 3 + 11 + 10);
});
