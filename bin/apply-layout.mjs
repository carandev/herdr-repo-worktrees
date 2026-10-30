#!/usr/bin/env node
// Action entrypoint: applies the project layout to the current workspace (no popup).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { resolveRepoContext } from '../src/workflow.mjs';
import { executeApplyLayout } from '../src/open-worktree.mjs';
import { extractContext } from '../src/context.mjs';
import { workspaceSourceDir } from '../src/workspace.mjs';
import { loadContext } from './herdr-context.mjs';

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

try {
  const ctx = await loadContext({ env, herdr });
  const { workspaceId } = extractContext(ctx, env);
  const repo = await resolveRepoContext({ ctx, env, fs, git });
  // Layout cwds are relative to this workspace's own checkout, not the main repository.
  const dir = workspaceSourceDir(ctx) ?? repo.repoRoot;
  const worktreePath = (await git(['rev-parse', '--show-toplevel'], dir)).trim();
  await executeApplyLayout({ layout: repo.config.layout, worktreePath, workspaceId, herdr, fs, pathApi: path });
} catch (e) {
  console.error(`repo-worktrees: apply-layout failed: ${e.message}`);
  process.exit(1);
}
