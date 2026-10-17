/** Helpers shared by the action (open-prompt) and the popup pane (prompt). */

export function parseContextJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * argv for `herdr plugin pane open`; the prompt pane may not inherit the action's env.
 * Popup panes always target the active pane, so Herdr rejects --workspace; forward it via env only.
 */
export function buildPaneOpenArgs({ pluginId, workspaceId, contextJson, entrypoint = 'prompt' }) {
  const args = ['plugin', 'pane', 'open', '--plugin', pluginId, '--entrypoint', entrypoint, '--focus'];
  if (workspaceId) args.push('--env', `REPO_WORKTREES_WORKSPACE_ID=${workspaceId}`);
  if (contextJson) args.push('--env', `REPO_WORKTREES_CONTEXT_JSON=${contextJson}`);
  return args;
}
