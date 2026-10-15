import nodePath from 'node:path';
import { validateBranch } from './slug.mjs';
import { resolveWorktreePath } from './path.mjs';
import { loadConfig } from './config.mjs';
import { extractContext, resolveMainRepoRoot } from './context.mjs';
import { ensureExcluded } from './exclude.mjs';

export function buildCreateArgs({ repoRoot, branch, worktreePath, base }) {
  const args = ['worktree', 'create', '--cwd', repoRoot, '--branch', branch, '--path', worktreePath, '--focus'];
  if (base) args.push('--base', base);
  return args;
}

/** Repo-relative path of `target`, or null when it is outside `root` (or is `root`). */
function relativeInside(root, target, pathApi) {
  const rel = pathApi.relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith('..' + pathApi.sep) || pathApi.isAbsolute(rel)) return null;
  return rel;
}

/**
 * Resolves everything needed to create the worktree, without side effects.
 * Ports: fs {readFile}, git(args, cwd) -> stdout.
 */
export async function planRepoWorktree({ branch, base, ctx, env = {}, fs, git, pathApi = nodePath, extraStartDirs = [] }) {
  const name = validateBranch(branch);
  const baseRef = base?.trim() ? validateBranch(base) : undefined;
  const { startDirs } = extractContext(ctx, env);
  const { repoRoot, commonDir } = await resolveMainRepoRoot({
    startDirs: [...startDirs, ...extraStartDirs],
    git,
  });
  const config = await loadConfig({ repoRoot, configDir: env.HERDR_PLUGIN_CONFIG_DIR, fs, pathApi });
  const defaultPath = resolveWorktreePath({ repoRoot, directory: config.directory, branch: name, pathApi });
  return { branch: name, baseRef, repoRoot, commonDir, directory: config.directory, defaultPath };
}

/**
 * Final checkout path from the user's answer: empty keeps the default,
 * relative resolves against the repo root, absolute is used as-is.
 */
export function resolveTargetPath({ plan, input, pathApi = nodePath }) {
  const answer = input?.trim();
  if (!answer) return plan.defaultPath;
  const target = pathApi.resolve(plan.repoRoot, answer);
  if (pathApi.relative(pathApi.resolve(plan.repoRoot), target) === '') {
    throw new Error('Worktree path cannot be the repository root');
  }
  return target;
}

/**
 * Creates the worktree from a plan. Paths inside the repo are added to
 * info/exclude; paths outside it are left alone.
 * Ports: fs {readFile, writeFile, mkdir}, herdr(args) -> {stdout}.
 */
export async function executeRepoWorktree({ plan, path: pathInput, fs, herdr, pathApi = nodePath }) {
  const worktreePath = resolveTargetPath({ plan, input: pathInput, pathApi });
  const root = pathApi.resolve(plan.repoRoot);
  const configuredDir = pathApi.resolve(root, plan.directory);
  const underConfigured = relativeInside(configuredDir, worktreePath, pathApi) !== null;
  const excludeDir = underConfigured ? plan.directory : relativeInside(root, worktreePath, pathApi);
  if (excludeDir) await ensureExcluded({ commonDir: plan.commonDir, directory: excludeDir, fs, pathApi });
  try {
    const { stdout } = await herdr(
      buildCreateArgs({ repoRoot: plan.repoRoot, branch: plan.branch, worktreePath, base: plan.baseRef }),
    );
    return { worktreePath, repoRoot: plan.repoRoot, directory: plan.directory, output: stdout };
  } catch (e) {
    const detail = [e.stderr, e.stdout].map((s) => String(s ?? '').trim()).find(Boolean) ?? e.message;
    throw new Error(`herdr worktree create failed: ${detail}`);
  }
}

/** Plan + execute in one call. All validation happens before any side effect. */
export async function createRepoWorktree({ path: pathInput, fs, herdr, pathApi = nodePath, ...rest }) {
  const plan = await planRepoWorktree({ ...rest, fs, pathApi });
  return executeRepoWorktree({ plan, path: pathInput, fs, herdr, pathApi });
}
