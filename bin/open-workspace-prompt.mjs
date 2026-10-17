#!/usr/bin/env node
// Action entrypoint: opens the popup pane that asks which directory the new workspace should open in.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildPaneOpenArgs, parseContextJson } from '../src/pane.mjs';
import { extractContext } from '../src/context.mjs';

const run = promisify(execFile);
const env = process.env;
const contextJson = env.HERDR_PLUGIN_CONTEXT_JSON;
const { workspaceId } = extractContext(parseContextJson(contextJson), env);

try {
  await run(
    env.HERDR_BIN_PATH || 'herdr',
    buildPaneOpenArgs({
      pluginId: env.HERDR_PLUGIN_ID || 'repo-worktrees',
      workspaceId,
      contextJson,
      entrypoint: 'workspace-prompt',
    }),
    { windowsHide: true },
  );
} catch (e) {
  console.error(`repo-worktrees: could not open workspace prompt pane: ${e.stderr || e.message}`);
  process.exit(1);
}
