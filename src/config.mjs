import nodePath from 'node:path';
import { looksAbsolute } from './path.mjs';

export const DEFAULT_DIRECTORY = '.claude/worktrees';

const ENTRY_KEYS = new Set(['command', 'cwd', 'split', 'ratio', 'from', 'label']);
const WILDCARD = '*';
const PROJECT_KEYS = new Set(['directory', 'layout']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

async function readRaw(fs, file) {
  const text = await fs.readFile(file);
  if (text == null) return undefined;
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON in ${file}: ${e.message}`);
  }
  if (!isObject(data)) throw new Error(`${file} must contain a JSON object`);
  return data;
}

function checkDirectory(value, label, file) {
  if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
    throw new Error(`${label} in ${file} must be a non-empty string`);
  }
}

/** True when a relative `cwd` would climb above its base directory. */
function escapesBase(cwd) {
  let depth = 0;
  for (const seg of cwd.split(/[\\/]+/)) {
    if (seg === '' || seg === '.') continue;
    depth += seg === '..' ? -1 : 1;
    if (depth < 0) return true;
  }
  return false;
}

/** Validates and normalizes one project's layout. `label` is e.g. `projects["X"].layout`. */
function normalizeLayout(layout, label, file) {
  if (!Array.isArray(layout)) throw new Error(`${label} in ${file} must be an array`);
  return layout.map((entry, i) => {
    const at = `${label}[${i}]`;
    const fail = (key, msg) => {
      throw new Error(`${key ? `${at}.${key}` : at} in ${file} ${msg}`);
    };
    if (!isObject(entry)) fail('', 'must be an object');
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.has(key)) fail(key, 'is not a recognized key');
    }
    const out = {};
    if (entry.command !== undefined) {
      if (typeof entry.command !== 'string' || !entry.command.trim()) fail('command', 'must be a non-empty string');
      out.command = entry.command;
    }
    if (entry.label !== undefined) {
      if (typeof entry.label !== 'string' || !entry.label.trim()) fail('label', 'must be a non-empty string');
      if (i > 0 && entry.split !== undefined) {
        throw new Error(`${at}.label: only allowed on tab entries (no "split") (in ${file})`);
      }
      out.label = entry.label;
    }
    if (entry.cwd !== undefined) {
      if (typeof entry.cwd !== 'string' || !entry.cwd.trim()) fail('cwd', 'must be a non-empty string');
      const cwd = entry.cwd.trim();
      if (looksAbsolute(cwd)) fail('cwd', 'must be relative to the worktree');
      if (escapesBase(cwd)) fail('cwd', 'must stay inside the worktree');
      out.cwd = cwd;
    }
    if (i === 0) {
      for (const key of ['split', 'ratio', 'from']) {
        if (entry[key] !== undefined) fail(key, 'is not allowed on the first entry (the root pane)');
      }
      return out;
    }
    if (entry.split === undefined) {
      // No split: the entry opens a new tab, so pane-relative options make no sense.
      for (const key of ['ratio', 'from']) {
        if (entry[key] !== undefined) throw new Error(`${at}.${key}: requires "split" (in ${file})`);
      }
      return out;
    }
    if (entry.split !== 'right' && entry.split !== 'down') fail('split', 'must be "right" or "down"');
    out.split = entry.split;
    if (entry.ratio !== undefined) {
      if (typeof entry.ratio !== 'number' || !(entry.ratio > 0 && entry.ratio < 1)) {
        fail('ratio', 'must be a number greater than 0 and less than 1');
      }
      out.ratio = entry.ratio;
    }
    if (entry.from !== undefined && (!Number.isInteger(entry.from) || entry.from < 0 || entry.from >= i)) {
      fail('from', 'must be the integer index of an earlier entry');
    }
    out.from = entry.from ?? i - 1;
    return out;
  });
}

const isWin = (pathApi) => pathApi.sep === '\\';

/**
 * Finds the project config for `repoRoot`: absolute-path key, then basename key, then `"*"`.
 * The selected entry is used whole; entries are never merged. `"*"` is not a path or a name.
 */
function matchProject(projects, repoRoot, pathApi) {
  const fold = (s) => (isWin(pathApi) ? s.toLowerCase() : s);
  const root = fold(pathApi.resolve(repoRoot));
  const keys = Object.keys(projects).filter((k) => k !== WILDCARD);
  const byPath = keys.find((k) => pathApi.isAbsolute(k) && fold(pathApi.resolve(k)) === root);
  if (byPath !== undefined) return { key: byPath, entry: projects[byPath] };
  const name = fold(pathApi.basename(root));
  const byName = keys.find((k) => !pathApi.isAbsolute(k) && fold(k) === name);
  if (byName !== undefined) return { key: byName, entry: projects[byName] };
  return projects[WILDCARD] ? { key: WILDCARD, entry: projects[WILDCARD] } : undefined;
}

function readUserConfig(data, file) {
  checkDirectory(data.directory, '"directory"', file);
  const projects = {};
  if (data.projects !== undefined) {
    if (!isObject(data.projects)) throw new Error(`"projects" in ${file} must be an object`);
    for (const [name, proj] of Object.entries(data.projects)) {
      const at = `projects["${name}"]`;
      if (!isObject(proj)) throw new Error(`${at} in ${file} must be an object`);
      for (const key of Object.keys(proj)) {
        if (!PROJECT_KEYS.has(key)) throw new Error(`${at}.${key} in ${file} is not a recognized key`);
      }
      checkDirectory(proj.directory, `${at}.directory`, file);
      projects[name] = {
        directory: proj.directory,
        layout: proj.layout === undefined ? [] : normalizeLayout(proj.layout, `${at}.layout`, file),
      };
    }
  }
  return { directory: data.directory, projects };
}

/**
 * Directory precedence: <repo>/.herdr/worktrees.json > matched project's (or selected "*") directory
 * > user top-level directory > built-in default.
 * Layout and projects are read ONLY from the user config, never from the repo file,
 * so a cloned repository cannot cause commands to run.
 * `fs.readFile(path)` must return the file text, or null when the file does not exist.
 */
export async function loadConfig({ repoRoot, configDir, fs, pathApi = nodePath }) {
  const repoFile = pathApi.join(repoRoot, '.herdr', 'worktrees.json');
  const repoData = await readRaw(fs, repoFile);
  if (repoData) checkDirectory(repoData.directory, '"directory"', repoFile);

  let userFile;
  let user = { directory: undefined, projects: {} };
  if (configDir) {
    userFile = pathApi.join(configDir, 'config.json');
    const userData = await readRaw(fs, userFile);
    if (userData) user = readUserConfig(userData, userFile);
  }
  const match = matchProject(user.projects, repoRoot, pathApi);
  const project = match?.entry;
  const layout = project?.layout ?? [];
  // layoutKey names the matched project entry (a key or "*"); absent when none matched.
  const keyed = match ? { layoutKey: match.key } : {};

  if (repoData?.directory !== undefined) return { directory: repoData.directory, layout, ...keyed, source: repoFile };
  if (project?.directory !== undefined) return { directory: project.directory, layout, ...keyed, source: userFile };
  if (user.directory !== undefined) return { directory: user.directory, layout, ...keyed, source: userFile };
  return { directory: DEFAULT_DIRECTORY, layout, ...keyed, source: 'default' };
}
