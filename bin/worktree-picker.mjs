#!/usr/bin/env node
// Popup pane: lists the repository worktrees, opens the chosen one and applies the project layout.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { resolveRepoContext } from '../src/workflow.mjs';
import { buildWorktreeListArgs, executeOpenWorktree, parseWorktreeList } from '../src/open-worktree.mjs';
import { loadContext } from './herdr-context.mjs';
import { decodeKeys } from '../src/keys.mjs';
import { createPicker, render, selected, setStatus, update } from '../src/worktree-picker.mjs';

const run = promisify(execFile);
const env = process.env;
const herdrBin = env.HERDR_BIN_PATH || 'herdr';

const fs = {
  readFile: async (p) => {
    try {
      return await fsp.readFile(p, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  },
  isDirectory: async (p) => {
    try {
      return (await fsp.stat(p)).isDirectory();
    } catch {
      return false;
    }
  },
};
const git = async (args, cwd) => (await run('git', args, { cwd, windowsHide: true })).stdout;
const herdr = (args) => run(herdrBin, args, { windowsHide: true });

function readLine(label) {
  process.stdout.write(label);
  const rl = readline.createInterface({ input: process.stdin });
  return rl.question('').then((v) => { rl.close(); return v; }, () => null);
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

async function loadRepo() {
  const ctx = await loadContext({ env, herdr });
  const repo = await resolveRepoContext({ ctx, env, fs, git });
  const items = parseWorktreeList((await herdr(buildWorktreeListArgs(repo.repoRoot))).stdout, { pathApi: path });
  return { repo, items };
}

const open = (repo, item) =>
  executeOpenWorktree({ repoRoot: repo.repoRoot, worktreePath: item.path, layout: repo.config.layout, herdr, fs, pathApi: path });

/** Interactive picker on a TTY. Resolves with the open result, or null when cancelled. */
function runPicker(initial, repo) {
  const out = process.stdout;
  const stdin = process.stdin;
  const color = !env.NO_COLOR;
  let state = initial;
  let busy = false;
  const draw = () => {
    const { text, cursor } = render(state, { columns: out.columns || 80, rows: out.rows || 24, color });
    out.write(`\x1b[?25l\x1b[H\x1b[2J${text}\x1b[${cursor.row};${cursor.col}H\x1b[?25h`);
  };
  return new Promise((resolve) => {
    const finish = (value) => {
      stdin.off('data', onData);
      out.off('resize', draw);
      stdin.setRawMode(false);
      stdin.pause();
      out.write('\x1b[?25h\x1b[H\x1b[2J');
      resolve(value);
    };
    const submit = async () => {
      busy = true;
      state = setStatus(state, 'Opening worktree...');
      draw();
      try {
        finish(await open(repo, selected(state)));
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
      draw();
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    out.on('resize', draw);
    draw();
  });
}

async function report(result) {
  console.log(`${result.alreadyOpen ? 'Focused' : 'Opened'} ${result.worktreePath}`);
  if (result.layoutError) {
    console.error(`Layout failed: ${result.layoutError}`);
    await waitForKey();
  }
}

async function mainPicker() {
  const { repo, items } = await loadRepo();
  const picker = createPicker({ items, repoRoot: repo.repoRoot, repoName: path.basename(repo.repoRoot), pathApi: path });
  const result = await runPicker(picker, repo);
  if (!result) return;
  await report(result);
  if (!result.layoutError) await new Promise((r) => setTimeout(r, 700));
}

/** Numbered list for non-TTY stdin. */
async function mainSequential() {
  const { repo, items } = await loadRepo();
  if (!items.length) return console.log('No worktrees');
  items.forEach((i, k) => console.log(`${k + 1}) ${i.branch ?? '(detached)'}  ${i.path}${i.openWorkspaceId ? '  [open]' : ''}`));
  const answer = (await readLine('Open which (empty cancels): '))?.trim();
  if (!answer) return;
  const item = items[Number(answer) - 1];
  if (!item) throw new Error(`Not a listed worktree: ${answer}`);
  await report(await open(repo, item));
}

try {
  await (process.stdin.isTTY ? mainPicker() : mainSequential());
} catch (e) {
  console.error(`\nError: ${e.message}`);
  await waitForKey();
  process.exitCode = 1;
}
