#!/usr/bin/env node
// Popup pane: one interactive form (branch, base ref with autocomplete, path), then creates the worktree.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { executeRepoWorktree, planFromRepo, planRepoWorktree, resolveRepoContext } from '../src/workflow.mjs';
import { loadContext } from './herdr-context.mjs';
import { decodeKeys } from '../src/keys.mjs';
import { createForm, parseRefs, render, setStatus, update } from '../src/form.mjs';

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
  writeFile: (p, d) => fsp.writeFile(p, d, 'utf8'),
  mkdir: (p) => fsp.mkdir(p, { recursive: true }),
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

/** Non-TTY fallback: reads one line from piped stdin. Resolves null on EOF. */
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

/** Local and remote branch names for Base ref autocomplete; empty on any failure. */
async function loadRefs(repoRoot) {
  try {
    return parseRefs(await git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'], repoRoot));
  } catch {
    return [];
  }
}

/** Interactive form on a TTY. Resolves with the create result, or null when cancelled. */
function runForm(initial, repo) {
  const out = process.stdout;
  const stdin = process.stdin;
  const color = !env.NO_COLOR;
  let state = initial;
  let busy = false;
  const draw = () => {
    const { text, cursor } = render(state, { columns: out.columns || 80, color });
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
      state = setStatus(state, 'Creating worktree...');
      draw();
      try {
        const plan = planFromRepo({ repo, branch: state.values.branch, base: state.values.base });
        finish(await executeRepoWorktree({ plan, path: state.values.path, fs, herdr }));
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

async function mainForm() {
  const ctx = await loadContext({ env, herdr });
  const repo = await resolveRepoContext({ ctx, env, fs, git });
  const form = createForm({
    repoName: path.basename(repo.repoRoot),
    repoRoot: repo.repoRoot,
    directory: repo.config.directory,
    layout: repo.config.layout,
    layoutKey: repo.config.layoutKey,
    refs: await loadRefs(repo.repoRoot),
    pathApi: path,
  });
  const result = await runForm(form, repo);
  if (!result) return;
  console.log(`Created ${result.worktreePath}`);
  if (result.layoutError) {
    console.error(`Layout failed: ${result.layoutError}`);
    await waitForKey();
  } else {
    await new Promise((r) => setTimeout(r, 700));
  }
}

/** Sequential prompts for non-TTY stdin (kept minimal so piped use keeps working). */
async function mainSequential() {
  console.log('New worktree (empty input cancels)');
  const branch = (await readLine('Branch: '))?.trim();
  if (!branch) return;
  const base = (await readLine('Base ref (optional): '))?.trim();
  if (base === null) return;
  const ctx = await loadContext({ env, herdr });
  const plan = await planRepoWorktree({ branch, base, ctx, env, fs, git });
  const shown = path.relative(plan.repoRoot, plan.defaultPath).split(path.sep).join('/');
  const pathInput = await readLine(`Path [${shown}]: `);
  if (pathInput === null) return;
  const result = await executeRepoWorktree({ plan, path: pathInput, fs, herdr });
  console.log(`Created ${result.worktreePath}`);
  if (result.layoutError) console.error(`Layout failed: ${result.layoutError}`);
}

try {
  await (process.stdin.isTTY ? mainForm() : mainSequential());
} catch (e) {
  console.error(`\nError: ${e.message}`);
  await waitForKey();
  process.exitCode = 1;
}
