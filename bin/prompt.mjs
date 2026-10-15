#!/usr/bin/env node
// Popup pane: asks for branch, optional base and path (default shown), then creates the worktree.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { executeRepoWorktree, planRepoWorktree } from '../src/workflow.mjs';
import { parseContextJson } from '../src/pane.mjs';
import { extractContext } from '../src/context.mjs';

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

/** Reads one line in raw mode so Esc cancels. Resolves null on Esc / Ctrl-C / EOF. */
function readLine(label) {
  process.stdout.write(label);
  if (!process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin });
    return rl.question('').then((v) => { rl.close(); return v; }, () => null);
  }
  return new Promise((resolve) => {
    let buf = '';
    const done = (v) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', onData);
      process.stdout.write('\n');
      resolve(v);
    };
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\u001b' || ch === '\u0003' || ch === '\u0004') return done(null);
        if (ch === '\r' || ch === '\n') return done(buf);
        if (ch === '\u007f' || ch === '\b') {
          if (buf) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); }
        } else if (ch >= ' ') {
          buf += ch;
          process.stdout.write(ch);
        }
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
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

async function loadContext() {
  const raw = env.REPO_WORKTREES_CONTEXT_JSON || env.HERDR_PLUGIN_CONTEXT_JSON;
  let ctx = parseContextJson(raw);
  const parsed = extractContext(ctx, env);
  const workspaceId = env.REPO_WORKTREES_WORKSPACE_ID || parsed.workspaceId;
  if (parsed.startDirs.length === 0 && workspaceId) {
    // Context had no worktree info: ask herdr for the workspace.
    try {
      const { stdout } = await herdr(['workspace', 'get', workspaceId]);
      ctx = { workspace: JSON.parse(stdout)?.result?.workspace };
    } catch {
      // fall through to the process cwd
    }
  }
  return ctx;
}

async function main() {
  console.log('New worktree (Esc or empty input cancels)');
  const branch = (await readLine('Branch: '))?.trim();
  if (!branch) return;
  const base = (await readLine('Base ref (optional): '))?.trim();
  if (base === null) return;
  const ctx = await loadContext();
  const plan = await planRepoWorktree({ branch, base, ctx, env, fs, git, extraStartDirs: [process.cwd()] });
  const shown = path.relative(plan.repoRoot, plan.defaultPath).split(path.sep).join('/');
  const pathInput = await readLine(`Path [${shown}]: `);
  if (pathInput === null) return;
  const result = await executeRepoWorktree({ plan, path: pathInput, fs, herdr });
  console.log(`Created ${result.worktreePath}`);
  if (result.layoutError) {
    console.error(`Layout failed: ${result.layoutError}`);
    await waitForKey();
  }
}

try {
  await main();
} catch (e) {
  console.error(`\nError: ${e.message}`);
  await waitForKey();
  process.exitCode = 1;
}
