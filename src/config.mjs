import nodePath from 'node:path';

export const DEFAULT_DIRECTORY = '.claude/worktrees';

async function readJson(fs, file) {
  const text = await fs.readFile(file);
  if (text == null) return undefined;
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON in ${file}: ${e.message}`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${file} must contain a JSON object`);
  }
  if (data.directory !== undefined && (typeof data.directory !== 'string' || !data.directory.trim())) {
    throw new Error(`"directory" in ${file} must be a non-empty string`);
  }
  return data;
}

/**
 * Precedence: <repo>/.herdr/worktrees.json > <configDir>/config.json > built-in default.
 * `fs.readFile(path)` must return the file text, or null when the file does not exist.
 */
export async function loadConfig({ repoRoot, configDir, fs, pathApi = nodePath }) {
  const candidates = [pathApi.join(repoRoot, '.herdr', 'worktrees.json')];
  if (configDir) candidates.push(pathApi.join(configDir, 'config.json'));
  for (const file of candidates) {
    const data = await readJson(fs, file);
    if (data?.directory !== undefined) return { directory: data.directory, source: file };
  }
  return { directory: DEFAULT_DIRECTORY, source: 'default' };
}
