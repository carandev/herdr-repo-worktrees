#!/usr/bin/env node
// Interactive config editor. Runs as the `configure` popup pane, or directly from a terminal:
//   node bin/config.mjs            (repository = current directory, when it is inside one)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { loadContext } from './herdr-context.mjs';
import { extractContext, resolveMainRepoRoot } from '../src/context.mjs';
import { decodeKeys } from '../src/keys.mjs';
import { parseConfigText } from '../src/config-edit.mjs';
import { createEditor, markSaved, pendingWrites, render, setStatus, update } from '../src/config-editor.mjs';

const run = promisify(execFile);
const env = process.env;
const herdr = (args) => run(env.HERDR_BIN_PATH || 'herdr', args, { windowsHide: true });
const git = async (args, cwd) => (await run('git', args, { cwd, windowsHide: true })).stdout;
const insidePane = Boolean(env.REPO_WORKTREES_CONTEXT_JSON || env.REPO_WORKTREES_WORKSPACE_ID || env.HERDR_PLUGIN_CONTEXT_JSON);

async function readText(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/** Writes through a temporary file so an interrupted save never leaves half a config. */
async function writeText(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, text, 'utf8');
  await fsp.rename(tmp, file);
}

async function configDir() {
  if (env.HERDR_PLUGIN_CONFIG_DIR) return env.HERDR_PLUGIN_CONFIG_DIR;
  try {
    const dir = (await herdr(['plugin', 'config-dir', env.HERDR_PLUGIN_ID || 'repo-worktrees'])).stdout.trim();
    if (dir) return dir;
  } catch (e) {
    throw new Error(`Could not find the plugin config directory (herdr plugin config-dir): ${e.stderr || e.message}`);
  }
  throw new Error('herdr plugin config-dir printed nothing');
}

/** Main repository root of the active workspace (pane) or the current directory (terminal); null outside one. */
async function repoRoot() {
  // Herdr starts plugin panes in the plugin directory, so only a terminal run may use process.cwd().
  const startDirs = insidePane ? extractContext(await loadContext({ env, herdr }), env).startDirs : [process.cwd()];
  try {
    return (await resolveMainRepoRoot({ startDirs, git })).repoRoot;
  } catch {
    return null;
  }
}

async function loadEditor() {
  const userFile = path.join(await configDir(), 'config.json');
  const root = await repoRoot();
  const repoFile = root ? path.join(root, '.herdr', 'worktrees.json') : undefined;
  const userText = await readText(userFile);
  const repoText = repoFile ? await readText(repoFile) : null;
  const draft = {
    user: parseConfigText(userText, userFile),
    repo: repoFile ? parseConfigText(repoText, repoFile) : null,
  };
  return createEditor({ draft, files: { userFile, repoFile }, repoRoot: root ?? undefined, saved: { user: userText, repo: repoText }, pathApi: path });
}

function runEditor(initial) {
  const out = process.stdout;
  const stdin = process.stdin;
  const color = !env.NO_COLOR;
  let state = initial;
  let busy = false;
  const draw = () => {
    const { text, cursor } = render(state, { columns: out.columns || 80, rows: out.rows || 24, color });
    const place = cursor ? `\x1b[${cursor.row};${cursor.col}H\x1b[?25h` : '';
    out.write(`\x1b[?25l\x1b[H\x1b[2J${text}${place}`);
  };
  return new Promise((resolve) => {
    const finish = () => {
      stdin.off('data', onData);
      out.off('resize', draw);
      stdin.setRawMode(false);
      stdin.pause();
      out.write('\x1b[?25h\x1b[H\x1b[2J');
      resolve();
    };
    const save = async () => {
      busy = true;
      const writes = pendingWrites(state);
      try {
        for (const w of writes) await writeText(w.file, w.text);
        state = markSaved(state, writes);
      } catch (e) {
        state = setStatus(state, `Save failed: ${String(e.message).replace(/\s+/g, ' ').trim()}`);
      }
      busy = false;
      draw();
    };
    const onData = (chunk) => {
      if (busy) return;
      for (const key of decodeKeys(chunk.toString('utf8'))) {
        const r = update(state, key);
        state = r.state;
        if (r.effect === 'quit') return finish();
        if (r.effect === 'save') return void save();
      }
      draw();
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    out.on('resize', draw);
    draw();
  });
}

function waitForKey() {
  if (!process.stdin.isTTY) return Promise.resolve();
  process.stdout.write('\nPress any key to close...');
  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', () => { process.stdin.setRawMode(false); process.stdin.pause(); resolve(); });
  });
}

try {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('The config editor needs an interactive terminal');
  await runEditor(await loadEditor());
} catch (e) {
  console.error(`\nError: ${e.message}`);
  if (insidePane) await waitForKey();
  process.exitCode = 1;
}
