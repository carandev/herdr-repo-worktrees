// Shared by the popup panes: reads the Herdr context the action forwarded, completing it from herdr when needed.
import { parseContextJson } from '../src/pane.mjs';
import { extractContext, focusedPaneCwd } from '../src/context.mjs';

/** Parsed Herdr context for the active workspace. `herdr(args)` resolves `{ stdout }`. */
export async function loadContext({ env, herdr }) {
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
      // fall through to the pane cwd
    }
    if (extractContext(ctx, env).startDirs.length === 0) {
      // Workspaces opened in a plain directory carry no worktree info; their panes still report a cwd.
      // Never fall back to process.cwd(): Herdr runs plugin commands from the plugin directory.
      try {
        const cwd = focusedPaneCwd((await herdr(['pane', 'list', '--workspace', workspaceId])).stdout);
        if (cwd) ctx = { workspace: { ...(ctx?.workspace ?? {}), cwd } };
      } catch {
        // resolveRepoContext reports the missing repository
      }
    }
  }
  return ctx;
}
