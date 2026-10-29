import test from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import {
  addEntry,
  addProject,
  describeEntry,
  moveEntry,
  parseConfigText,
  removeEntry,
  removeProject,
  renameProject,
  serializeConfig,
  setDirectory,
  setEntryField,
  setProjectDirectory,
  setRepoDirectory,
  validateDraft,
} from '../src/config-edit.mjs';

const draftOf = (user, repo = null) => ({ user, repo });
const ctx = { userFile: 'config.json', repoFile: 'worktrees.json', repoRoot: '/r/app', pathApi: posix };
const layoutOf = (d, key = 'P') => d.user.projects[key].layout;

test('parseConfigText: missing or blank is empty; invalid JSON and non-objects name the file', () => {
  assert.deepEqual(parseConfigText(null, 'c.json'), {});
  assert.deepEqual(parseConfigText('  \n', 'c.json'), {});
  assert.throws(() => parseConfigText('{', 'c.json'), /Invalid JSON in c\.json/);
  assert.throws(() => parseConfigText('[]', 'c.json'), /c\.json must contain a JSON object/);
});

test('setDirectory sets, trims and removes on empty; unknown top-level keys survive', () => {
  let d = setDirectory(draftOf({ extra: 1 }), ' .wt ');
  assert.deepEqual(d.user, { extra: 1, directory: '.wt' });
  d = setDirectory(d, '');
  assert.deepEqual(d.user, { extra: 1 });
  assert.equal(serializeConfig({ a: 1 }), '{\n  "a": 1\n}\n');
});

test('setRepoDirectory edits the repo file and fails outside a repository', () => {
  assert.deepEqual(setRepoDirectory(draftOf({}, {}), '.worktrees').repo, { directory: '.worktrees' });
  assert.throws(() => setRepoDirectory(draftOf({}), 'x'), /Not inside a git repository/);
});

test('projects: add, rename in place, duplicate and empty names, remove', () => {
  let d = addProject(draftOf({}), ' A ');
  d = addProject(d, '*');
  d = addProject(d, 'B');
  d = setProjectDirectory(d, 'B', '.wt');
  assert.throws(() => addProject(d, 'A'), /Project "A" already exists/);
  assert.throws(() => addProject(d, '  '), /Project name is required/);
  d = renameProject(d, 'A', 'Z');
  assert.deepEqual(Object.keys(d.user.projects), ['Z', '*', 'B']);
  assert.throws(() => renameProject(d, 'Z', 'B'), /already exists/);
  d = removeProject(d, '*');
  assert.deepEqual(d.user.projects, { Z: {}, B: { directory: '.wt' } });
});

test('addEntry: first is the root pane, later entries split right', () => {
  let d = addProject(draftOf({}), 'P');
  d = addEntry(addEntry(d, 'P'), 'P');
  assert.deepEqual(layoutOf(d), [{}, { split: 'right' }]);
});

test('setEntryField: text, numbers, invalid numbers kept for validation, split switching', () => {
  let d = draftOf({ projects: { P: { layout: [{}, { split: 'right' }] } } });
  d = setEntryField(d, 'P', 1, 'command', 'npm run dev');
  d = setEntryField(d, 'P', 1, 'ratio', '0.3');
  d = setEntryField(d, 'P', 1, 'from', '0');
  assert.deepEqual(layoutOf(d)[1], { split: 'right', command: 'npm run dev', ratio: 0.3, from: 0 });
  assert.equal(setEntryField(d, 'P', 1, 'ratio', 'abc').user.projects.P.layout[1].ratio, 'abc');
  d = setEntryField(d, 'P', 1, 'split', 'tab');
  assert.deepEqual(layoutOf(d)[1], { command: 'npm run dev' });
  d = setEntryField(d, 'P', 1, 'label', 'api');
  d = setEntryField(d, 'P', 1, 'split', 'down');
  assert.deepEqual(layoutOf(d)[1], { command: 'npm run dev', split: 'down' });
  d = setEntryField(d, 'P', 1, 'command', '');
  assert.deepEqual(layoutOf(d)[1], { split: 'down' });
});

test('removeEntry renumbers later from references and drops ones to the removed entry', () => {
  const layout = [{}, { split: 'right' }, { split: 'down', from: 1 }, { split: 'down', from: 2 }, { split: 'down', from: 0 }];
  const d = removeEntry(draftOf({ projects: { P: { layout } } }), 'P', 1);
  assert.deepEqual(layoutOf(d), [{}, { split: 'down' }, { split: 'down', from: 1 }, { split: 'down', from: 0 }]);
});

test('removing or moving onto entry 0 strips pane-split options from the new root', () => {
  let d = draftOf({ projects: { P: { layout: [{ command: 'a' }, { split: 'right', ratio: 0.5, command: 'b' }] } } });
  assert.deepEqual(layoutOf(removeEntry(d, 'P', 0)), [{ command: 'b' }]);
  d = moveEntry(d, 'P', 1, -1);
  assert.deepEqual(layoutOf(d), [{ command: 'b' }, { command: 'a' }]);
});

test('moveEntry keeps from targets and drops references that are no longer earlier', () => {
  const layout = [{}, { label: 't' }, { split: 'down', from: 1 }, { split: 'right', from: 0 }];
  let d = moveEntry(draftOf({ projects: { P: { layout } } }), 'P', 2, 1);
  assert.deepEqual(layoutOf(d), [{}, { label: 't' }, { split: 'right', from: 0 }, { split: 'down', from: 1 }]);
  d = moveEntry(d, 'P', 1, 1);
  assert.deepEqual(layoutOf(d), [{}, { split: 'right', from: 0 }, { label: 't' }, { split: 'down', from: 2 }]);
  assert.equal(moveEntry(d, 'P', 3, 1), d);
});

test('validateDraft reports loadConfig errors and directory rules; empty when valid', () => {
  assert.equal(validateDraft(draftOf({ directory: '.wt', projects: { P: { layout: [{ command: 'x' }] } } }, {}), ctx), '');
  assert.match(validateDraft(draftOf({ projects: { P: { layout: [{}, { split: 'right', ratio: 'abc' }] } } }), ctx),
    /projects\["P"\]\.layout\[1\]\.ratio in config\.json must be a number/);
  assert.match(validateDraft(draftOf({ directory: '/abs' }), ctx), /"directory": .*absolute/);
  assert.match(validateDraft(draftOf({ projects: { P: { directory: '../x' } } }), ctx), /projects\["P"\]\.directory: .*escapes/);
  assert.match(validateDraft(draftOf({}, { directory: '.' }), ctx), /"directory" in worktrees\.json: .*repository root/);
  assert.equal(validateDraft(draftOf({ directory: '.wt' }), { pathApi: posix }), '');
});

test('describeEntry summarises the kind, label, command and cwd', () => {
  assert.equal(describeEntry({ label: 'claude', command: 'claude' }, 0), 'root pane · "claude" · claude');
  assert.equal(describeEntry({ split: 'down', ratio: 0.3, command: 'lazygit' }, 2), 'split down 0.3 from 1 · lazygit');
  assert.equal(describeEntry({ cwd: 'src' }, 1), 'tab · cwd src');
});
