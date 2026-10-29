import test from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { decodeKeys } from '../src/keys.mjs';
import { serializeConfig } from '../src/config-edit.mjs';
import { createEditor, isDirty, markSaved, pendingWrites, render, rowsFor, selectedIndex, update } from '../src/config-editor.mjs';

const files = { userFile: '/cfg/config.json', repoFile: '/r/app/.herdr/worktrees.json' };
function editor(user = {}, repo = null) {
  const saved = { user: serializeConfig(user), repo: repo === null ? null : serializeConfig(repo) };
  return createEditor({ draft: { user, repo }, files, repoRoot: '/r/app', saved, pathApi: posix });
}
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
const ENTER = '\r';
const DOWN = '\x1b[B';
const ESC = '\x1b';
const CTRL_S = '\x13';

test('main view lists directories, projects and the add row; headings are skipped', () => {
  const s = editor({ projects: { A: { directory: '.wt' } } }, {});
  assert.deepEqual(rowsFor(s).map((r) => r.id ?? r.label), ['directory', 'repoDirectory', 'Projects', 'project', 'addProject']);
  const { state } = type(s, DOWN + DOWN);
  assert.equal(rowsFor(state)[selectedIndex(state)].id, 'project');
  assert.equal(rowsFor(editor()).some((r) => r.id === 'repoDirectory'), false);
});

test('editing the default directory and saving writes only the user file', () => {
  let { state, effects } = type(editor({}, {}), `${ENTER}.wt${ENTER}`);
  assert.deepEqual(effects, []);
  assert.equal(state.draft.user.directory, '.wt');
  assert.equal(isDirty(state), true);
  ({ state, effects } = type(state, CTRL_S));
  assert.deepEqual(effects, ['save']);
  const writes = pendingWrites(state);
  assert.deepEqual(writes, [{ which: 'user', file: '/cfg/config.json', text: '{\n  "directory": ".wt"\n}\n' }]);
  state = markSaved(state, writes);
  assert.equal(isDirty(state), false);
  assert.equal(state.status, 'Saved');
});

test('repo directory is written to the repo file; a missing repo file stays unwritten while empty', () => {
  const s = editor({}, {});
  s.saved.repo = null;
  assert.deepEqual(pendingWrites(s), []);
  const { state } = type(s, `${DOWN}${ENTER}.worktrees${ENTER}`);
  assert.deepEqual(pendingWrites(state), [{ which: 'repo', file: files.repoFile, text: '{\n  "directory": ".worktrees"\n}\n' }]);
});

test('Esc cancels a text edit without changing the draft', () => {
  const { state } = type(editor({ directory: '.a' }), `${ENTER}xyz${ESC}`);
  assert.equal(state.draft.user.directory, '.a');
  assert.equal(state.edit, null);
});

test('invalid values show an error and block saving', () => {
  const { state, effects } = type(editor(), `${ENTER}/abs${ENTER}${CTRL_S}`);
  assert.deepEqual(effects, []);
  assert.match(state.error, /absolute/);
  assert.equal(state.status, 'Fix the error before saving');
});

test('add a project, give it a layout entry with a command, then go back to main', () => {
  let { state } = type(editor(), `a*${ENTER}`);
  assert.deepEqual(state.draft.user.projects, { '*': {} });
  assert.equal(state.stack.at(-1).view, 'project');
  ({ state } = type(state, `a${ENTER}claude${ENTER}`));
  assert.deepEqual(state.draft.user.projects['*'].layout, [{ command: 'claude' }]);
  assert.equal(state.stack.at(-1).view, 'entry');
  ({ state } = type(state, ESC));
  ({ state } = type(state, ESC));
  assert.equal(state.stack.length, 1);
  assert.equal(rowsFor(state)[selectedIndex(state)].key, '*');
});

test('duplicate project names keep the name editor open with an error', () => {
  const { state } = type(editor({ projects: { A: {} } }), `aA${ENTER}`);
  assert.equal(state.edit.id, 'newProject');
  assert.equal(state.status, 'Project "A" already exists');
});

test('renaming a project in its view keeps the view on the renamed key', () => {
  const { state } = type(editor({ projects: { A: { layout: [{}] } } }), `${DOWN}${ENTER}${ENTER}\x15B${ENTER}`);
  assert.deepEqual(Object.keys(state.draft.user.projects), ['B']);
  assert.equal(state.stack.at(-1).key, 'B');
  assert.equal(rowsFor(state).filter((r) => r.id === 'entry').length, 1);
});

test('Opens as is the first row and stays selected while the rows below it change', () => {
  const user = { projects: { P: { layout: [{}, { split: 'right' }] } } };
  // main: directory, P, add → open P; project: name, dir, entry0, entry1 → open entry 1.
  let { state } = type(editor(user), `${DOWN}${ENTER}${DOWN}${DOWN}${DOWN}${ENTER}`);
  assert.equal(state.stack.at(-1).index, 1);
  assert.deepEqual(rowsFor(state).map((r) => r.id), ['split', 'command', 'cwd', 'ratio', 'from']);
  const selected = (s) => rowsFor(s)[selectedIndex(s)].id;
  ({ state } = type(state, '\x1b[C'));
  assert.deepEqual(state.draft.user.projects.P.layout[1], { split: 'down' });
  assert.equal(selected(state), 'split');
  ({ state } = type(state, ENTER));
  assert.deepEqual(state.draft.user.projects.P.layout[1], {});
  assert.deepEqual(rowsFor(state).map((r) => r.id), ['split', 'command', 'label', 'cwd']);
  assert.equal(selected(state), 'split');
  ({ state } = type(state, `${ENTER}${ENTER}`));
  assert.deepEqual(state.draft.user.projects.P.layout[1], { split: 'down' });
  assert.equal(selected(state), 'split');
});

test('Split from lists earlier entries by name; Enter opens the list, Enter applies, Esc cancels', () => {
  const layout = [{ label: 'claude', command: 'claude' }, { label: 'api' }, { split: 'down', command: 'npm test' }, { split: 'right' }];
  // Open entry 3, then go to its last row (Split from).
  let { state } = type(editor({ projects: { P: { layout } } }), `${DOWN}${ENTER}${DOWN}${DOWN}${DOWN}${DOWN}${DOWN}${ENTER}\x1b[F`);
  const from = rowsFor(state)[selectedIndex(state)];
  assert.equal(from.id, 'from');
  assert.deepEqual(from.options.map((o) => o.label), ['0 · claude', '1 · api', '2 · api › npm test']);
  assert.equal(from.value, 2);
  ({ state } = type(state, ENTER));
  assert.equal(state.pick.index, 2);
  const plain = strip(render(state, { columns: 80, rows: 24, color: false }).text);
  assert.match(plain, /Split from +2 · api › npm test ▾/);
  assert.match(plain, /│ {23}0 · claude +│/);
  assert.match(plain, /▸ 2 · api › npm test {2}\(current\)/);
  ({ state } = type(state, `${'\x1b[A'}${ESC}`));
  assert.equal(state.pick, null);
  assert.equal(state.draft.user.projects.P.layout[3].from, undefined);
  ({ state } = type(state, `${ENTER}${'\x1b[A'}${'\x1b[A'}${ENTER}`));
  assert.equal(state.draft.user.projects.P.layout[3].from, 0);
  assert.equal(rowsFor(state)[selectedIndex(state)].id, 'from');
  ({ state } = type(state, '\x1b[D'));
  assert.equal(state.draft.user.projects.P.layout[3].from, undefined, 'wraps to the previous entry, the default');
});

test('d asks before deleting; moving away cancels the confirmation', () => {
  const s = editor({ projects: { A: {}, B: {} } });
  let { state } = type(s, `${DOWN}d`);
  assert.equal(state.status, 'Press d again to delete project "A"');
  ({ state } = type(state, `${DOWN}${'\x1b[A'}d`));
  assert.deepEqual(Object.keys(state.draft.user.projects), ['A', 'B']);
  ({ state } = type(state, 'd'));
  assert.deepEqual(Object.keys(state.draft.user.projects), ['B']);
});

test('J/K reorder layout entries and the selection follows', () => {
  const user = { projects: { P: { layout: [{ command: 'a' }, { command: 'b' }, { command: 'c' }] } } };
  let { state } = type(editor(user), `${DOWN}${ENTER}${DOWN}${DOWN}${DOWN}J`);
  assert.deepEqual(state.draft.user.projects.P.layout.map((e) => e.command), ['a', 'c', 'b']);
  assert.equal(rowsFor(state)[selectedIndex(state)].index, 2);
  ({ state } = type(state, 'KK'));
  assert.deepEqual(state.draft.user.projects.P.layout.map((e) => e.command), ['b', 'a', 'c']);
});

test('quitting with unsaved changes needs a second press; a clean editor quits at once', () => {
  assert.deepEqual(type(editor(), ESC).effects, ['quit']);
  assert.deepEqual(type(editor(), 'q').effects, ['quit']);
  let r = type(editor(), `${ENTER}.wt${ENTER}${ESC}`);
  assert.deepEqual(r.effects, []);
  assert.match(r.state.status, /Unsaved changes/);
  r = type(r.state, '\x03');
  assert.deepEqual(r.effects, ['quit']);
});

test('render shows the breadcrumb, rows, placeholders and a cursor only while editing', () => {
  const s = editor({ projects: { '*': { layout: [{ command: 'claude' }] } } }, {});
  let { text, cursor } = render(s, { columns: 80, rows: 20, color: false });
  assert.equal(text.includes('\x1b'), false);
  const plain = strip(text);
  assert.match(plain, /Worktree config/);
  assert.match(plain, /▸ Default directory +\.claude\/worktrees/);
  assert.match(plain, /\* \(every other repository\) +1 entry/);
  assert.equal(cursor, null);
  const { state } = type(s, `${ENTER}ab`);
  ({ text, cursor } = render(state, { columns: 80, rows: 20, color: false }));
  assert.match(strip(text), /▸ Default directory +ab/);
  assert.equal(cursor.row, 4);
  assert.equal(cursor.col, 5 + 18 + 2);
});
