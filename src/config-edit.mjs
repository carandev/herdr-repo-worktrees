/**
 * Pure editing operations on the raw config objects used by the config editor. No I/O.
 * A draft is `{ user, repo }`: the parsed user `config.json` and `<repo>/.herdr/worktrees.json`
 * (`repo` is null outside a repository). Every operation returns a new draft; unknown
 * top-level keys are preserved so saving never drops data the editor does not show.
 */

import nodePath from 'node:path';
import { validateUserConfig } from './config.mjs';
import { resolveWorktreeDirectory } from './path.mjs';

export const WILDCARD = '*';
const PANE_KEYS = ['split', 'ratio', 'from'];

const clone = (v) => (v === undefined ? v : structuredClone(v));
const without = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

/** Parses a config file's text; missing (null) or blank text is an empty object. */
export function parseConfigText(text, file) {
  if (text == null || !text.trim()) return {};
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON in ${file}: ${e.message}`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${file} must contain a JSON object`);
  return data;
}

export const serializeConfig = (data) => `${JSON.stringify(data, null, 2)}\n`;

/** Sets or (for an empty value) removes `key` on an object. */
function withValue(obj, key, value) {
  const text = typeof value === 'string' ? value.trim() : value;
  if (text === '' || text === undefined) return without(obj, [key]);
  return { ...obj, [key]: text };
}

export const projectKeys = (draft) => Object.keys(draft.user.projects ?? {});
export const getProject = (draft, key) => draft.user.projects?.[key];
export const getLayout = (draft, key) => getProject(draft, key)?.layout ?? [];

export const setDirectory = (draft, value) => ({ ...draft, user: withValue(draft.user, 'directory', value) });

export function setRepoDirectory(draft, value) {
  if (draft.repo === null) throw new Error('Not inside a git repository');
  return { ...draft, repo: withValue(draft.repo, 'directory', value) };
}

function withProjects(draft, projects) {
  return { ...draft, user: { ...draft.user, projects } };
}

function requireProject(draft, key) {
  const project = getProject(draft, key);
  if (!project) throw new Error(`Unknown project: ${key}`);
  return project;
}

export function addProject(draft, key) {
  const name = key.trim();
  if (!name) throw new Error('Project name is required');
  if (getProject(draft, name)) throw new Error(`Project "${name}" already exists`);
  return withProjects(draft, { ...(draft.user.projects ?? {}), [name]: {} });
}

/** Renames a project key in place, keeping its position in the map. */
export function renameProject(draft, from, to) {
  const name = to.trim();
  requireProject(draft, from);
  if (name === from) return draft;
  if (!name) throw new Error('Project name is required');
  if (getProject(draft, name)) throw new Error(`Project "${name}" already exists`);
  const entries = Object.entries(draft.user.projects).map(([k, v]) => [k === from ? name : k, v]);
  return withProjects(draft, Object.fromEntries(entries));
}

export function removeProject(draft, key) {
  requireProject(draft, key);
  return withProjects(draft, without(draft.user.projects, [key]));
}

function updateProject(draft, key, fn) {
  const project = requireProject(draft, key);
  return withProjects(draft, { ...draft.user.projects, [key]: fn(project) });
}

export const setProjectDirectory = (draft, key, value) =>
  updateProject(draft, key, (p) => withValue(p, 'directory', value));

/** Entry 0 is the root pane: it can never carry pane-split options. */
const asRoot = (entry) => without(entry, PANE_KEYS);

/** Drops `from` references that no longer point at an earlier entry (they fall back to the previous entry). */
const fixFrom = (layout) =>
  layout.map((e, i) => (Number.isInteger(e.from) && (e.from >= i || e.from < 0) ? without(e, ['from']) : e));

function updateLayout(draft, key, fn) {
  return updateProject(draft, key, (p) => {
    const layout = fn(clone(p.layout ?? []));
    if (layout.length) layout[0] = asRoot(layout[0]);
    return { ...p, layout: fixFrom(layout) };
  });
}

/** Appends an entry: the root pane when the layout is empty, otherwise a split to the right. */
export const addEntry = (draft, key) =>
  updateLayout(draft, key, (layout) => [...layout, layout.length ? { split: 'right' } : {}]);

/** Removes entry `index`; `from` references to it are dropped and later ones are renumbered. */
export const removeEntry = (draft, key, index) =>
  updateLayout(draft, key, (layout) =>
    layout
      .filter((_, i) => i !== index)
      .map((e) => {
        if (!Number.isInteger(e.from)) return e;
        if (e.from === index) return without(e, ['from']);
        return e.from > index ? { ...e, from: e.from - 1 } : e;
      }),
  );

/** Swaps entry `index` with its neighbour `index + delta` (delta is -1 or 1), keeping `from` targets. */
export function moveEntry(draft, key, index, delta) {
  const other = index + delta;
  const length = getLayout(draft, key).length;
  if (other < 0 || other >= length) return draft;
  const swap = (n) => (n === index ? other : n === other ? index : n);
  return updateLayout(draft, key, (layout) => {
    [layout[index], layout[other]] = [layout[other], layout[index]];
    return layout.map((e) => (Number.isInteger(e.from) ? { ...e, from: swap(e.from) } : e));
  });
}

/** Parses a numeric field; text that is not a number is kept so validation can report it. */
function parseNumber(value) {
  const text = value.trim();
  if (!text) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : text;
}

/**
 * Sets one field of entry `index`. Text fields: command, label, cwd (empty removes them).
 * Numbers: ratio, from. `split` takes 'tab', 'right' or 'down'; 'tab' removes ratio/from,
 * and choosing a split removes `label` (only tab entries are named).
 */
export function setEntryField(draft, key, index, field, value) {
  return updateLayout(draft, key, (layout) => {
    const entry = layout[index];
    if (!entry) throw new Error(`Unknown layout entry: ${index}`);
    if (field === 'split') {
      layout[index] = value === 'tab' ? without(entry, PANE_KEYS) : { ...without(entry, ['label']), split: value };
    } else if (field === 'ratio' || field === 'from') {
      layout[index] = withValue(entry, field, parseNumber(value));
    } else {
      layout[index] = withValue(entry, field, value);
    }
    return layout;
  });
}

function checkDirectory(value, label, repoRoot, pathApi) {
  if (value === undefined) return;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  try {
    resolveWorktreeDirectory({ repoRoot, directory: value, pathApi });
  } catch (e) {
    throw new Error(`${label}: ${e.message}`);
  }
}

/**
 * Returns the first validation error of the draft as a message, or '' when it can be saved.
 * Uses the same rules as `loadConfig`, plus the directory checks applied when a worktree is created.
 */
export function validateDraft(draft, { userFile = 'config.json', repoFile = 'worktrees.json', repoRoot, pathApi = nodePath } = {}) {
  const root = repoRoot ?? pathApi.resolve(pathApi.sep, 'repo');
  try {
    const user = validateUserConfig(draft.user, userFile);
    checkDirectory(user.directory, '"directory"', root, pathApi);
    for (const [name, project] of Object.entries(user.projects)) {
      checkDirectory(project.directory, `projects["${name}"].directory`, root, pathApi);
    }
    if (draft.repo) checkDirectory(draft.repo.directory, `"directory" in ${repoFile}`, root, pathApi);
    return '';
  } catch (e) {
    return e.message;
  }
}

/** One-line description of a layout entry, e.g. `split down 0.3 from 0 · lazygit`. */
export function describeEntry(entry, index) {
  let kind = 'tab';
  if (index === 0) kind = 'root pane';
  else if (entry.split !== undefined) {
    kind = `split ${entry.split}`;
    if (entry.ratio !== undefined) kind += ` ${entry.ratio}`;
    kind += ` from ${entry.from ?? index - 1}`;
  }
  const parts = [kind];
  if (entry.label !== undefined) parts.push(`"${entry.label}"`);
  if (entry.command !== undefined) parts.push(entry.command);
  if (entry.cwd !== undefined) parts.push(`cwd ${entry.cwd}`);
  return parts.join(' · ');
}

const ownName = (e) => e.label ?? e.command ?? (e.cwd !== undefined ? `cwd ${e.cwd}` : undefined);

/**
 * Short name of layout entry `j` for pickers: a tab's label (else command or cwd), and for a
 * split `<tab> › <command>`, where <tab> is the tab it ends up in (following `from`).
 */
export function entryTitle(layout, j) {
  const e = layout[j] ?? {};
  if (j === 0 || e.split === undefined) return ownName(e) ?? (j === 0 ? 'root pane' : 'tab');
  let t = j;
  for (let guard = 0; t > 0 && layout[t]?.split !== undefined && guard < layout.length; guard += 1) {
    const from = layout[t].from;
    t = Number.isInteger(from) && from >= 0 && from < t ? from : t - 1;
  }
  const tab = layout[t] ?? {};
  const tabName = ownName(tab) ?? (t === 0 ? 'root pane' : 'tab');
  return `${tabName} › ${e.command ?? (e.cwd !== undefined ? `cwd ${e.cwd}` : 'shell')}`;
}

/** One-line description of a project, e.g. `dir .worktrees · 3 entries`. */
export function describeProject(project) {
  const parts = [];
  if (project.directory !== undefined) parts.push(`dir ${project.directory}`);
  const n = Array.isArray(project.layout) ? project.layout.length : 0;
  parts.push(n === 1 ? '1 entry' : `${n} entries`);
  return parts.join(' · ');
}
