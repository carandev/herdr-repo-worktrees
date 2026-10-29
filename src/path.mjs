import nodePath from 'node:path';
import { slugifyBranch } from './slug.mjs';

export const looksAbsolute = (d) =>
  nodePath.posix.isAbsolute(d) || nodePath.win32.isAbsolute(d) || /^[a-zA-Z]:/.test(d) || d.startsWith('\\');

/**
 * Absolute worktree directory for `directory` under `repoRoot`.
 * Rejects absolute directories, the repository root and anything that resolves outside repoRoot.
 */
export function resolveWorktreeDirectory({ repoRoot, directory, pathApi = nodePath }) {
  if (typeof directory !== 'string' || !directory.trim()) {
    throw new Error('Worktree directory must be a non-empty string');
  }
  if (looksAbsolute(directory.trim())) {
    throw new Error(`Worktree directory must be relative to the repository, got absolute path: ${directory}`);
  }
  const root = pathApi.resolve(repoRoot);
  const dirAbs = pathApi.resolve(root, directory.trim());
  const rel = pathApi.relative(root, dirAbs);
  if (rel === '') {
    throw new Error('Worktree directory must be a subdirectory of the repository, not the repository root');
  }
  if (rel === '..' || rel.startsWith('..' + pathApi.sep) || pathApi.isAbsolute(rel)) {
    throw new Error(`Worktree directory escapes the repository: ${directory}`);
  }
  return dirAbs;
}

/**
 * Absolute worktree path: <repoRoot>/<directory>/<branch-slug>.
 * `pathApi` is injectable (path.posix / path.win32) for deterministic tests;
 * path.win32 comparisons are case-insensitive.
 */
export function resolveWorktreePath({ repoRoot, directory, branch, pathApi = nodePath }) {
  return pathApi.join(resolveWorktreeDirectory({ repoRoot, directory, pathApi }), slugifyBranch(branch));
}
