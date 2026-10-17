import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { decodeKeys } from '../src/keys.mjs';
import { createWorkspaceForm, render, setSuggestions, suggestionsFor, update } from '../src/workspace-form.mjs';

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
const form = (directory, list = ['BcApp', 'BcLib', 'Other']) =>
  setSuggestions(createWorkspaceForm({ directory, pathApi: path.win32 }), directory, list);
const DIR = 'C:\\dev\\Bc';

test('suggestions show only for the current value and while Directory is focused', () => {
  assert.deepEqual(suggestionsFor(form(DIR)), ['BcApp', 'BcLib', 'Other']);
  const { state } = type(form(DIR), '\t');
  assert.deepEqual(suggestionsFor(state), []);
});
test('stale results (value changed since the request) are ignored', () => {
  const base = createWorkspaceForm({ directory: DIR, pathApi: path.win32 });
  const stale = setSuggestions(base, 'C:\\dev\\B', ['Bx']);
  assert.deepEqual(suggestionsFor(stale), []);
  assert.equal(stale, base);
});
test('editing invalidates the shown suggestions until a fresh result arrives', () => {
  const { state } = type(form(DIR), 'x');
  assert.deepEqual(suggestionsFor(state), []);
});
test('Tab accepts the first suggestion, adding the separator', () => {
  const { state, effects } = type(form(DIR), '\t');
  assert.deepEqual(effects, []);
  assert.equal(state.values.directory, 'C:\\dev\\BcApp\\');
  assert.equal(state.cursors.directory, 'C:\\dev\\BcApp\\'.length);
  assert.equal(state.focus, 0);
});
test('Right at the end accepts; Right mid-text just moves the cursor', () => {
  let { state } = type(form(DIR), '\x1b[C');
  assert.equal(state.values.directory, 'C:\\dev\\BcApp\\');
  ({ state } = type(form(DIR), '\x1b[D\x1b[C'));
  assert.equal(state.values.directory, DIR);
});
test('Down/Up move the highlight and Tab or Enter accept the highlighted one', () => {
  let { state } = type(form(DIR), '\x1b[B\x1b[B');
  assert.equal(state.highlight, 1);
  let r = type(state, '\t');
  assert.equal(r.state.values.directory, 'C:\\dev\\BcLib\\');
  ({ state } = type(form(DIR), '\x1b[B\x1b[B'));
  r = type(state, '\r');
  assert.equal(r.state.values.directory, 'C:\\dev\\BcLib\\');
  assert.deepEqual(r.effects, []);
  assert.equal(r.state.focus, 0);
  ({ state } = type(form(DIR), '\x1b[B\x1b[A'));
  assert.equal(state.highlight, -1);
});
test('Enter without a highlight still moves on; Esc clears highlight first, then cancels', () => {
  assert.equal(type(form(DIR), '\r').state.focus, 1);
  const { state } = type(form(DIR), '\x1b[B');
  assert.equal(state.highlight, 0);
  const r = type(state, '\x1b');
  assert.equal(r.state.highlight, -1);
  assert.deepEqual(r.effects, []);
  assert.deepEqual(type(r.state, '\x1b').effects, ['cancel']);
});
test('without suggestions Tab and Down move to Label as before', () => {
  assert.equal(type(form(DIR, []), '\t').state.focus, 1);
  assert.equal(type(form(DIR, []), '\x1b[B').state.focus, 1);
});
test('Tab moves on when the typed last segment already equals the first suggestion', () => {
  const s = form('C:\\dev\\BcApp', ['BcApp', 'BcApp2']);
  assert.equal(type(s, '\t').state.focus, 1);
  assert.equal(type(s, '\x1b[B\t').state.values.directory, 'C:\\dev\\BcApp\\');
});
test('a single suggestion equal to the typed segment is hidden', () => {
  assert.deepEqual(suggestionsFor(form('C:\\dev\\BcApp', ['BcApp'])), []);
});
test('render lists suggestions under Directory with the highlight marker and a hint', () => {
  const { state } = type(form(DIR), '\x1b[B');
  const { text, cursor } = render(state, { columns: 70, color: false });
  const plain = strip(text);
  assert.match(plain, /▸ BcApp {2}BcLib {2}Other/);
  assert.match(plain, /Tab\/→ accept/);
  assert.equal(cursor.row, 2);
  const lines = plain.split('\r\n');
  assert.match(lines[1], /^│ Directory/);
  assert.match(lines[2], /BcApp/);
  assert.match(lines[3], /^│ Label/);
});
test('render without suggestions keeps the original hint', () => {
  const { text } = render(form(DIR, []), { columns: 70, color: false });
  assert.match(strip(text), /↑↓\/Tab move/);
});
