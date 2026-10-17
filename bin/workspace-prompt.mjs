#!/usr/bin/env node
// Popup pane: asks for a directory (and optional label), then runs `herdr workspace create --cwd`.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseContextJson } from '../src/pane.mjs';
import { extractContext, focusedPaneCwd } from '../src/context.mjs';
import { decodeKeys } from '../src/keys.mjs';
import { createWorkspaceForm, render, setStatus, setSuggestions, update } from '../src/workspace-form.mjs';
import {
  createSubdirLister,
  executeWorkspaceCreate,
  rankDirectoryNames,
  splitDirectoryInput,
  workspaceSourceDir,
} from '../src/workspace.mjs';

const run = promisify(execFile);
const env = process.env;
const herdrBin = env.HERDR_BIN_PATH || 'herdr';
const herdr = (args) => run(herdrBin, args, { windowsHide: true });
const fs = {
  isDirectory: async (p) => {
    try {
      return (await fsp.stat(p)).isDirectory();
    } catch {
      return false;
    }
  },
};

/** Names of the subdirectories of `dir` (symlinks and junctions count when they point at a directory). */
async function readSubdirs(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const checked = await Promise.all(
    entries.map(async (e) => (e.isDirectory() || (e.isSymbolicLink() && (await fs.isDirectory(path.join(dir, e.name)))) ? e.name : null)),
  );
  return checked.filter(Boolean);
}
const listSubdirs = createSubdirLister(readSubdirs);

/**
 * Source workspace directory: context dirs, then `herdr workspace get`, then the focused pane cwd, then home.
 * Never process.cwd(): Herdr runs plugin commands from the plugin directory.
 */
async function sourceDir() {
  const raw = env.REPO_WORKTREES_CONTEXT_JSON || env.HERDR_PLUGIN_CONTEXT_JSON;
  const ctx = parseContextJson(raw);
  let dir = workspaceSourceDir(ctx);
  const workspaceId = env.REPO_WORKTREES_WORKSPACE_ID || extractContext(ctx, env).workspaceId;
  if (!dir && workspaceId) {
    try {
      const { stdout } = await herdr(['workspace', 'get', workspaceId]);
      dir = workspaceSourceDir({ workspace: JSON.parse(stdout)?.result?.workspace });
    } catch {
      // fall through to the pane cwd
    }
    if (!dir) {
      try {
        dir = focusedPaneCwd((await herdr(['pane', 'list', '--workspace', workspaceId])).stdout);
      } catch {
        // fall through to home
      }
    }
  }
  return dir ?? os.homedir();
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

const create = (baseDir, input, label) =>
  executeWorkspaceCreate({ input, label, baseDir, home: os.homedir(), fs, herdr, pathApi: path });

/** Interactive form on a TTY. Resolves with the create result, or null when cancelled. */
function runForm(initial, baseDir) {
  const out = process.stdout;
  const stdin = process.stdin;
  const color = !env.NO_COLOR;
  let state = initial;
  let busy = false;
  let closed = false;
  let requested = null;
  const draw = () => {
    const { text, cursor } = render(state, { columns: out.columns || 80, color });
    out.write(`\x1b[?25l\x1b[H\x1b[2J${text}\x1b[${cursor.row};${cursor.col}H\x1b[?25h`);
  };
  /** Lists subdirectories for the current Directory text; stale answers are dropped by the form. */
  const refreshSuggestions = () => {
    const value = state.values.directory;
    if (value === requested) return;
    requested = value;
    const { parentDir, prefix } = splitDirectoryInput({ input: value, baseDir, home: os.homedir(), pathApi: path });
    if (!parentDir) return;
    listSubdirs(parentDir).then((names) => {
      if (closed) return;
      const next = setSuggestions(state, value, rankDirectoryNames(names, prefix, { pathApi: path }));
      if (next === state) return;
      state = next;
      draw();
    });
  };
  return new Promise((resolve) => {
    const finish = (value) => {
      closed = true;
      stdin.off('data', onData);
      out.off('resize', draw);
      stdin.setRawMode(false);
      stdin.pause();
      out.write('\x1b[?25h\x1b[H\x1b[2J');
      resolve(value);
    };
    const submit = async () => {
      busy = true;
      state = setStatus(state, 'Creating workspace...');
      draw();
      try {
        finish(await create(baseDir, state.values.directory, state.values.label));
      } catch (e) {
        busy = false;
        state = setStatus(state, String(e.message).replace(/\s+/g, ' ').trim());
        draw();
      }
    };
    const onData = (chunk) => {
      if (busy) return;
      for (const key of decodeKeys(chunk.toString('utf8'))) {
        const r = update(state, key);
        state = r.state;
        if (r.effect === 'cancel') return finish(null);
        if (r.effect === 'submit') return void submit();
      }
      refreshSuggestions();
      draw();
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    out.on('resize', draw);
    refreshSuggestions();
    draw();
  });
}

function readLine(label) {
  process.stdout.write(label);
  const rl = readline.createInterface({ input: process.stdin });
  return rl.question('').then((v) => { rl.close(); return v; }, () => null);
}

async function mainForm() {
  const baseDir = await sourceDir();
  const result = await runForm(createWorkspaceForm({ directory: baseDir, pathApi: path }), baseDir);
  if (!result) return;
  console.log(`Created workspace in ${result.cwd}`);
  await new Promise((r) => setTimeout(r, 700));
}

/** Sequential prompts for non-TTY stdin. */
async function mainSequential() {
  const baseDir = await sourceDir();
  console.log('New workspace (empty Directory keeps the default)');
  const input = (await readLine(`Directory [${baseDir}]: `))?.trim();
  if (input === null || input === undefined) return;
  const label = await readLine('Label (optional): ');
  const result = await create(baseDir, input || baseDir, label);
  console.log(`Created workspace in ${result.cwd}`);
}

try {
  await (process.stdin.isTTY ? mainForm() : mainSequential());
} catch (e) {
  console.error(`\nError: ${e.message}`);
  await waitForKey();
  process.exitCode = 1;
}
