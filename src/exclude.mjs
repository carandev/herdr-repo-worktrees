import nodePath from 'node:path';

/** Anchored gitignore line for a repo-relative directory, e.g. "/.claude/worktrees/". */
export function excludeEntry(directory) {
  const clean = directory
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '');
  return `/${clean}/`;
}

/**
 * Idempotently adds the directory to <commonDir>/info/exclude (local-only ignore,
 * shared by all worktrees). Returns true when the file was modified.
 */
export async function ensureExcluded({ commonDir, directory, fs, pathApi = nodePath }) {
  const file = pathApi.join(commonDir, 'info', 'exclude');
  const entry = excludeEntry(directory);
  const existing = (await fs.readFile(file)) ?? '';
  const lines = existing.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes(entry) || lines.includes(entry.slice(0, -1))) return false;
  await fs.mkdir(pathApi.dirname(file));
  const sep = existing && !existing.endsWith('\n') ? '\n' : '';
  await fs.writeFile(file, `${existing}${sep}${entry}\n`);
  return true;
}
