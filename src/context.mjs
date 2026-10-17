/** Herdr context parsing and repository-root resolution. Parsing is deliberately defensive. */

/** Herdr reports Windows paths with a `\\?\` verbatim prefix; git and node dislike it. */
export function stripVerbatimPrefix(p) {
  return typeof p === 'string' ? p.replace(/^\\\\\?\\/, '') : p;
}

const isObj = (v) => v !== null && typeof v === 'object';
const str = (v) => (typeof v === 'string' && v ? v : undefined);

export function extractContext(ctx, env = {}) {
  const root = isObj(ctx) ? ctx : {};
  const ws = isObj(root.workspace) ? root.workspace : {};
  const wt = isObj(ws.worktree) ? ws.worktree : isObj(root.worktree) ? root.worktree : {};
  const workspaceId =
    str(ws.workspace_id) ??
    str(ws.id) ??
    str(root.workspace_id) ??
    str(root.workspace) ??
    str(env.HERDR_WORKSPACE_ID);
  const startDirs = [wt.repo_root, wt.checkout_path, ws.cwd, root.cwd]
    .map((d) => stripVerbatimPrefix(str(d)))
    .filter(Boolean)
    .filter((d, i, a) => a.indexOf(d) === i);
  return { workspaceId, startDirs };
}

/**
 * Cwd of the focused pane (else the first pane with a cwd) from `herdr pane list` stdout.
 * Herdr only attaches worktree info to some workspaces; pane cwds are always reported.
 */
export function focusedPaneCwd(stdout) {
  let panes;
  try {
    panes = JSON.parse(stdout)?.result?.panes;
  } catch {
    return undefined;
  }
  const withCwd = Array.isArray(panes) ? panes.filter((p) => isObj(p) && str(p.cwd)) : [];
  const pane = withCwd.find((p) => p.focused) ?? withCwd[0];
  return pane ? stripVerbatimPrefix(pane.cwd) : undefined;
}

/**
 * Finds the MAIN repository root (never a linked worktree's checkout) from the
 * parent of `git rev-parse --git-common-dir`. `git(args, cwd)` returns stdout.
 */
export async function resolveMainRepoRoot({ startDirs, git }) {
  for (const dir of startDirs) {
    try {
      const commonDir = (await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], dir)).trim();
      if (!commonDir) continue;
      const m = /^(.+)[\\/]\.git$/.exec(commonDir);
      if (m) return { repoRoot: m[1], commonDir };
      const top = (await git(['rev-parse', '--show-toplevel'], dir)).trim();
      if (top) return { repoRoot: top, commonDir };
    } catch {
      // try the next candidate directory
    }
  }
  throw new Error('Could not locate a git repository for this workspace');
}
