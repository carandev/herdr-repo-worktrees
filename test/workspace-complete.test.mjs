import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  applyDirectorySuggestion,
  createSubdirLister,
  rankDirectoryNames,
  splitDirectoryInput,
} from '../src/workspace.mjs';

const win = { pathApi: path.win32, home: 'C:\\Users\\me', baseDir: 'C:\\Users\\me' };
const posix = { pathApi: path.posix, home: '/home/me', baseDir: '/work/repo' };

test('split: win32 absolute path with a partial last segment', () => {
  assert.deepEqual(splitDirectoryInput({ ...win, input: 'C:\\Users\\me\\dev\\Bc' }), {
    parentDir: 'C:\\Users\\me\\dev',
    prefix: 'Bc',
  });
});
test('split: trailing separator means empty prefix', () => {
  assert.deepEqual(splitDirectoryInput({ ...win, input: 'C:\\Users\\me\\dev\\' }), {
    parentDir: 'C:\\Users\\me\\dev',
    prefix: '',
  });
});
test('split: win32 accepts forward slashes and drive roots', () => {
  assert.deepEqual(splitDirectoryInput({ ...win, input: 'C:/Users/me/de' }), { parentDir: 'C:\\Users\\me', prefix: 'de' });
  assert.deepEqual(splitDirectoryInput({ ...win, input: 'C:\\Us' }), { parentDir: 'C:\\', prefix: 'Us' });
});
test('split: ~ expands to home', () => {
  assert.deepEqual(splitDirectoryInput({ ...win, input: '~\\dev\\B' }), { parentDir: 'C:\\Users\\me\\dev', prefix: 'B' });
  assert.deepEqual(splitDirectoryInput({ ...posix, input: '~/dev/B' }), { parentDir: '/home/me/dev', prefix: 'B' });
  assert.deepEqual(splitDirectoryInput({ ...posix, input: '~/' }), { parentDir: '/home/me', prefix: '' });
});
test('split: relative text resolves against baseDir', () => {
  assert.deepEqual(splitDirectoryInput({ ...posix, input: 'sr' }), { parentDir: '/work/repo', prefix: 'sr' });
  assert.deepEqual(splitDirectoryInput({ ...posix, input: '../ot' }), { parentDir: '/work', prefix: 'ot' });
});
test('split: posix does not treat backslash as a separator', () => {
  assert.deepEqual(splitDirectoryInput({ ...posix, input: '/srv/a\\b' }), { parentDir: '/srv', prefix: 'a\\b' });
});
test('split: empty input or bare ~ has no parent', () => {
  assert.equal(splitDirectoryInput({ ...posix, input: '' }).parentDir, null);
  assert.equal(splitDirectoryInput({ ...posix, input: '~' }).parentDir, null);
});
test('split: strips a verbatim prefix', () => {
  assert.deepEqual(splitDirectoryInput({ ...win, input: '\\\\?\\C:\\Users\\me\\d' }), { parentDir: 'C:\\Users\\me', prefix: 'd' });
});

test('rank: prefix matches before substring matches, alphabetical in each group', () => {
  const names = ['abc-bc', 'Bcd', 'xbc', 'Bca', 'zzz'];
  assert.deepEqual(rankDirectoryNames(names, 'bc', { pathApi: path.win32 }), ['Bca', 'Bcd', 'abc-bc', 'xbc']);
});
test('rank: case-sensitive on posix', () => {
  assert.deepEqual(rankDirectoryNames(['Bc', 'bc'], 'bc', { pathApi: path.posix }), ['bc']);
});
test('rank: hides dot dirs unless the prefix starts with a dot', () => {
  const names = ['.git', '.config', 'src'];
  assert.deepEqual(rankDirectoryNames(names, '', { pathApi: path.posix }), ['src']);
  assert.deepEqual(rankDirectoryNames(names, '.', { pathApi: path.posix }), ['.config', '.git']);
});
test('rank: caps at five suggestions', () => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.deepEqual(rankDirectoryNames(names, '', { pathApi: path.posix }), ['a', 'b', 'c', 'd', 'e']);
});

test('apply: replaces the last segment and appends the separator', () => {
  assert.equal(applyDirectorySuggestion({ input: 'C:\\Users\\me\\dev\\Bc', name: 'BcApp', pathApi: path.win32 }), 'C:\\Users\\me\\dev\\BcApp\\');
  assert.equal(applyDirectorySuggestion({ input: '~\\dev\\B', name: 'Bar', pathApi: path.win32 }), '~\\dev\\Bar\\');
  assert.equal(applyDirectorySuggestion({ input: 'C:/Users/me/d', name: 'dev', pathApi: path.win32 }), 'C:/Users/me/dev\\');
  assert.equal(applyDirectorySuggestion({ input: 'sr', name: 'src', pathApi: path.posix }), 'src/');
  assert.equal(applyDirectorySuggestion({ input: '/srv/', name: 'app', pathApi: path.posix }), '/srv/app/');
});

test('lister: caches per directory and turns errors into []', async () => {
  const calls = [];
  const list = createSubdirLister(async (dir) => {
    calls.push(dir);
    if (dir === '/bad') throw new Error('EACCES');
    return ['a', 'b'];
  });
  assert.deepEqual(await list('/x'), ['a', 'b']);
  assert.deepEqual(await list('/x'), ['a', 'b']);
  assert.deepEqual(await list('/bad'), []);
  assert.deepEqual(calls, ['/x', '/bad']);
});
