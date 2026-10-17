import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildWorkspaceCreateArgs, executeWorkspaceCreate, resolveWorkspaceDir, workspaceSourceDir } from '../src/workspace.mjs';

const dirs = (...list) => ({ isDirectory: async (p) => list.includes(p) });
const posix = { pathApi: path.posix, home: '/home/me', baseDir: '/work/repo' };
const win = { pathApi: path.win32, home: 'C:\\Users\\me', baseDir: 'C:\\work\\repo' };

test('empty input is an error', async () => {
  await assert.rejects(resolveWorkspaceDir({ ...posix, input: '   ', fs: dirs() }), /Directory is required/);
});
test('posix: absolute, trimmed', async () => {
  assert.equal(await resolveWorkspaceDir({ ...posix, input: '  /srv/app ', fs: dirs('/srv/app') }), '/srv/app');
});
test('posix: relative resolves against baseDir', async () => {
  assert.equal(await resolveWorkspaceDir({ ...posix, input: '../other', fs: dirs('/work/other') }), '/work/other');
});
test('posix: ~ and ~/x expand to home', async () => {
  assert.equal(await resolveWorkspaceDir({ ...posix, input: '~', fs: dirs('/home/me') }), '/home/me');
  assert.equal(await resolveWorkspaceDir({ ...posix, input: '~/dev/x', fs: dirs('/home/me/dev/x') }), '/home/me/dev/x');
});
test('win32: ~\\x and ~/x expand, verbatim prefix stripped', async () => {
  assert.equal(await resolveWorkspaceDir({ ...win, input: '~\\dev', fs: dirs('C:\\Users\\me\\dev') }), 'C:\\Users\\me\\dev');
  assert.equal(await resolveWorkspaceDir({ ...win, input: '~/dev', fs: dirs('C:\\Users\\me\\dev') }), 'C:\\Users\\me\\dev');
  assert.equal(await resolveWorkspaceDir({ ...win, input: '\\\\?\\C:\\x', fs: dirs('C:\\x') }), 'C:\\x');
});
test('win32: relative resolves against baseDir', async () => {
  assert.equal(await resolveWorkspaceDir({ ...win, input: 'sub', fs: dirs('C:\\work\\repo\\sub') }), 'C:\\work\\repo\\sub');
});
test('non-existent directory is a clear error', async () => {
  await assert.rejects(resolveWorkspaceDir({ ...posix, input: '/nope', fs: dirs() }), /Directory does not exist: \/nope/);
});
test('buildWorkspaceCreateArgs with and without label', () => {
  assert.deepEqual(buildWorkspaceCreateArgs({ cwd: '/a' }), ['workspace', 'create', '--cwd', '/a', '--focus']);
  assert.deepEqual(buildWorkspaceCreateArgs({ cwd: '/a', label: '   ' }), ['workspace', 'create', '--cwd', '/a', '--focus']);
  assert.deepEqual(buildWorkspaceCreateArgs({ cwd: '/a', label: ' API ' }),
    ['workspace', 'create', '--cwd', '/a', '--focus', '--label', 'API']);
});
test('executeWorkspaceCreate resolves, calls herdr and returns cwd', async () => {
  const calls = [];
  const herdr = async (args) => { calls.push(args); return { stdout: 'ok' }; };
  const r = await executeWorkspaceCreate({ ...posix, input: '~/x', label: 'L', fs: dirs('/home/me/x'), herdr });
  assert.equal(r.cwd, '/home/me/x');
  assert.deepEqual(calls[0], ['workspace', 'create', '--cwd', '/home/me/x', '--focus', '--label', 'L']);
});
test('executeWorkspaceCreate surfaces herdr stderr, falling back to stdout then message', async () => {
  const fail = (e) => async () => { throw Object.assign(new Error('boom'), e); };
  const base = { ...posix, input: '/a', fs: dirs('/a') };
  await assert.rejects(executeWorkspaceCreate({ ...base, herdr: fail({ stderr: ' bad cwd \n' }) }), /herdr workspace create failed: bad cwd/);
  await assert.rejects(executeWorkspaceCreate({ ...base, herdr: fail({ stdout: 'out' }) }), /failed: out/);
  await assert.rejects(executeWorkspaceCreate({ ...base, herdr: fail({}) }), /failed: boom/);
});

test('workspaceSourceDir prefers the workspace cwd over worktree roots', () => {
  const ctx = { workspace: { cwd: '\\\\?\\C:\\r\\wt\\src', worktree: { repo_root: 'C:\\r', checkout_path: 'C:\\r\\wt' } } };
  assert.equal(workspaceSourceDir(ctx), 'C:\\r\\wt\\src');
});
test('workspaceSourceDir falls back to top-level cwd, then checkout, then repo root', () => {
  assert.equal(workspaceSourceDir({ cwd: '/x', worktree: { repo_root: '/r', checkout_path: '/r/wt' } }), '/x');
  assert.equal(workspaceSourceDir({ workspace: { worktree: { repo_root: '/r', checkout_path: '/r/wt' } } }), '/r/wt');
  assert.equal(workspaceSourceDir({ worktree: { repo_root: '/r' } }), '/r');
});
test('workspaceSourceDir returns undefined for garbage', () => {
  assert.equal(workspaceSourceDir(null), undefined);
  assert.equal(workspaceSourceDir({ workspace: { cwd: '' } }), undefined);
});
