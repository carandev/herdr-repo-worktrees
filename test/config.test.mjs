import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadConfig, DEFAULT_DIRECTORY } from '../src/config.mjs';

const fsOf = (files) => ({ readFile: async (p) => (p in files ? files[p] : null) });
const repoFile = path.join('/repo', '.herdr', 'worktrees.json');
const userFile = path.join('/cfg', 'config.json');

test('default when no files', async () => {
  const c = await loadConfig({ repoRoot: '/repo', configDir: '/cfg', fs: fsOf({}) });
  assert.deepEqual(c, { directory: DEFAULT_DIRECTORY, layout: [], source: 'default' });
  assert.equal(DEFAULT_DIRECTORY, '.claude/worktrees');
});
test('user config beats default', async () => {
  const c = await loadConfig({ repoRoot: '/repo', configDir: '/cfg', fs: fsOf({ [userFile]: '{"directory":"u"}' }) });
  assert.deepEqual(c, { directory: 'u', layout: [], source: userFile });
});
test('repo config beats user config', async () => {
  const c = await loadConfig({ repoRoot: '/repo', configDir: '/cfg', fs: fsOf({ [userFile]: '{"directory":"u"}', [repoFile]: '{"directory":"r"}' }) });
  assert.deepEqual(c, { directory: 'r', layout: [], source: repoFile });
});
test('missing configDir is fine', async () => {
  const c = await loadConfig({ repoRoot: '/repo', fs: fsOf({}) });
  assert.equal(c.directory, DEFAULT_DIRECTORY);
});
test('file without directory key falls through', async () => {
  const c = await loadConfig({ repoRoot: '/repo', configDir: '/cfg', fs: fsOf({ [repoFile]: '{}', [userFile]: '{"directory":"u"}' }) });
  assert.equal(c.directory, 'u');
});
test('invalid JSON gives a clear error naming the file', async () => {
  await assert.rejects(loadConfig({ repoRoot: '/repo', fs: fsOf({ [repoFile]: '{oops' }) }), (e) => e.message.includes(repoFile) && /invalid json/i.test(e.message));
});
test('non-string directory is an error', async () => {
  await assert.rejects(loadConfig({ repoRoot: '/repo', fs: fsOf({ [repoFile]: '{"directory":3}' }) }), /directory/);
});

// --- projects & layout ---
const pUser = '/cfg/config.json';
const pRepo = '/repo/.herdr/worktrees.json';
const cfg = (obj) => fsOf({ [pUser]: JSON.stringify(obj) });
const load = (obj) => loadConfig({ repoRoot: '/work/Univer.CRM', configDir: '/cfg', fs: cfg(obj), pathApi: path.posix });

test('layout is [] by default', async () => {
  const c = await loadConfig({ repoRoot: '/repo', configDir: '/cfg', fs: fsOf({}) });
  assert.deepEqual(c.layout, []);
});
test('project matched by basename supplies directory and layout', async () => {
  const c = await load({ directory: 'top', projects: { 'Univer.CRM': { directory: 'pd', layout: [{ command: 'claude' }, { split: 'right', command: 'x' }] } } });
  assert.equal(c.directory, 'pd');
  assert.equal(c.source, pUser);
  assert.deepEqual(c.layout, [{ command: 'claude' }, { split: 'right', command: 'x', from: 0 }]);
});
test('directory precedence: repo > project > user top-level', async () => {
  const files = {
    [pUser]: JSON.stringify({ directory: 'top', projects: { 'Univer.CRM': { directory: 'pd' } } }),
    '/work/Univer.CRM/.herdr/worktrees.json': '{"directory":"r"}',
  };
  const c = await loadConfig({ repoRoot: '/work/Univer.CRM', configDir: '/cfg', fs: fsOf(files), pathApi: path.posix });
  assert.equal(c.directory, 'r');
  const c2 = await load({ directory: 'top', projects: { 'Univer.CRM': {} } });
  assert.equal(c2.directory, 'top');
});
test('absolute path key wins over name key', async () => {
  const c = await load({ projects: { 'Univer.CRM': { layout: [{ command: 'name' }] }, '/work/Univer.CRM': { layout: [{ command: 'abs' }] } } });
  assert.equal(c.layout[0].command, 'abs');
});
test('win32 matching is case- and slash-insensitive', async () => {
  const fs = fsOf({ [path.win32.join('C:\\cfg', 'config.json')]: JSON.stringify({ projects: { 'c:/Users/Me/DEV/other': { layout: [{ command: 'a' }] }, univer: { layout: [{ command: 'b' }] } } }) });
  const a = await loadConfig({ repoRoot: 'C:\\users\\me\\dev\\OTHER', configDir: 'C:\\cfg', fs, pathApi: path.win32 });
  assert.equal(a.layout[0].command, 'a');
  const b = await loadConfig({ repoRoot: 'C:\\x\\UNIVER', configDir: 'C:\\cfg', fs, pathApi: path.win32 });
  assert.equal(b.layout[0].command, 'b');
});
test('name match is case-sensitive on posix', async () => {
  const c = await load({ projects: { 'univer.crm': { layout: [{ command: 'a' }] } } });
  assert.deepEqual(c.layout, []);
});
test('layout and projects in the repo file are ignored', async () => {
  const files = { [pRepo]: JSON.stringify({ directory: 'r', layout: [{ command: 'rm -rf' }], projects: { repo: { layout: [{ command: 'evil' }] } } }) };
  const c = await loadConfig({ repoRoot: '/repo', fs: fsOf(files), pathApi: path.posix });
  assert.deepEqual(c, { directory: 'r', layout: [], source: pRepo });
});
test('project directory is validated', async () => {
  await assert.rejects(load({ projects: { 'Univer.CRM': { directory: '' } } }), /projects\["Univer.CRM"\]\.directory/);
});

const bad = (layout, re) =>
  assert.rejects(load({ projects: { X: { layout } } }), (e) => re.test(e.message) && e.message.includes(pUser));
test('layout validation errors name the file and path', async () => {
  await bad('nope', /projects\["X"\]\.layout /);
  await bad([3], /projects\["X"\]\.layout\[0\] /);
  await bad([{ command: '' }], /layout\[0\]\.command/);
  await bad([{ cwd: '/abs' }], /layout\[0\]\.cwd/);
  await bad([{ cwd: 'C:\\abs' }], /layout\[0\]\.cwd/);
  await bad([{ cwd: '../out' }], /layout\[0\]\.cwd/);
  await bad([{ cwd: 'a/../../out' }], /layout\[0\]\.cwd/);
  await bad([{ split: 'right' }], /layout\[0\]\.split/);
  await bad([{ ratio: 0.5 }], /layout\[0\]\.ratio/);
  await bad([{ from: 0 }], /layout\[0\]\.from/);
  await bad([{}, { split: 'right' }, { split: 'left' }], /layout\[2\]\.split/);
  await bad([{}, { split: 'right', ratio: 1 }], /layout\[1\]\.ratio/);
  await bad([{}, { split: 'right', ratio: 0 }], /layout\[1\]\.ratio/);
  await bad([{}, { split: 'right', from: 1 }], /layout\[1\]\.from/);
  await bad([{}, { split: 'right', from: 0.5 }], /layout\[1\]\.from/);
  await bad([{}, { split: 'right', color: 'red' }], /layout\[1\]\.color/);
});
test('unknown project key is an error', async () => {
  await assert.rejects(load({ projects: { X: { foo: 1 } } }), /projects\["X"\]\.foo/);
});
test('valid cwd inside worktree and empty layout are accepted', async () => {
  const c = await load({ projects: { 'Univer.CRM': { layout: [{ cwd: 'src/../lib' }] } } });
  assert.equal(c.layout[0].cwd, 'src/../lib');
  assert.deepEqual((await load({ projects: { 'Univer.CRM': { layout: [] } } })).layout, []);
});

test('split is optional on entries 1..n (tab entry): no from default', async () => {
  const c = await load({ projects: { 'Univer.CRM': { layout: [{}, { command: 'htop' }, { split: 'down', from: 1 }] } } });
  assert.deepEqual(c.layout, [{}, { command: 'htop' }, { split: 'down', from: 1 }]);
});
test('tab entries reject ratio and from', async () => {
  await bad([{}, { command: 'x' }, { ratio: 0.5 }], /layout\[2\]\.ratio: requires "split"/);
  await bad([{}, { from: 0 }], /layout\[1\]\.from: requires "split"/);
});

test('"*" is used only when no specific key matches', async () => {
  const projects = { '*': { directory: 'g', layout: [{ command: 'global' }] } };
  const c = await load({ directory: 'top', projects });
  assert.equal(c.directory, 'g');
  assert.equal(c.source, pUser);
  assert.equal(c.layout[0].command, 'global');
  const c2 = await load({ projects: { ...projects, 'Univer.CRM': { layout: [{ command: 'mine' }] } } });
  assert.equal(c2.layout[0].command, 'mine');
});
test('a specific entry fully replaces "*" (no merging)', async () => {
  const star = { directory: 'g', layout: [{ command: 'global' }] };
  const optOut = await load({ projects: { '*': star, 'Univer.CRM': { layout: [] } } });
  assert.deepEqual(optOut.layout, []);
  const dirOnly = await load({ directory: 'top', projects: { '*': star, 'Univer.CRM': { directory: 'pd' } } });
  assert.deepEqual([dirOnly.directory, dirOnly.layout], ['pd', []]);
  const noDir = await load({ directory: 'top', projects: { '*': star, 'Univer.CRM': {} } });
  assert.equal(noDir.directory, 'top');
});
test('repo directory still beats "*"', async () => {
  const files = { [pUser]: JSON.stringify({ projects: { '*': { directory: 'g' } } }), '/work/Univer.CRM/.herdr/worktrees.json': '{"directory":"r"}' };
  const c = await loadConfig({ repoRoot: '/work/Univer.CRM', configDir: '/cfg', fs: fsOf(files), pathApi: path.posix });
  assert.equal(c.directory, 'r');
});
test('"*" is never a basename match', async () => {
  const c = await loadConfig({ repoRoot: '/work/*', configDir: '/cfg', fs: cfg({ projects: { '*': { layout: [{ command: 'g' }] } } }), pathApi: path.posix });
  assert.equal(c.layout[0].command, 'g');
});
test('"*" is validated like any project, with its path in errors', async () => {
  await assert.rejects(load({ projects: { '*': { layout: [{}, { split: 'left' }] } } }), (e) => e.message.includes('projects["*"].layout[1].split'));
});

test('label is allowed on entry 0 and tab entries, rejected with split', async () => {
  const c = await load({ projects: { 'Univer.CRM': { layout: [{ label: 'main' }, { label: 'logs', command: 'x' }, { split: 'right' }] } } });
  assert.equal(c.layout[0].label, 'main');
  assert.equal(c.layout[1].label, 'logs');
  await bad([{}, { split: 'right' }, { split: 'down', label: 'x' }], /layout\[2\]\.label: only allowed on tab entries \(no "split"\) \(in /);
  await bad([{ label: '' }], /layout\[0\]\.label/);
  await bad([{}, { label: 3 }], /layout\[1\]\.label/);
});
