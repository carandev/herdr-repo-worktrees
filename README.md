# herdr-repo-worktrees

A [Herdr](https://herdr.dev) plugin that creates git worktrees at a path **relative to the repository**, configurable per project. The default is `.claude/worktrees/<branch-slug>`.

The worktree is created directly at the final path (via `herdr worktree create --path`), so nothing is moved afterwards. Worktrees always land under the **main** repository, even when the action is triggered from inside a linked worktree.

## Install

```sh
herdr plugin install carandev/herdr-repo-worktrees
```

Requires Herdr >= 0.9.5 and Node.js >= 22 on `PATH`. No npm dependencies.

## Usage

Run the `new-worktree` action from a workspace. A popup asks for a branch name, an optional base ref, and the checkout path. The path prompt shows the configured default (e.g. `.claude/worktrees/feat-x`); press Enter to keep it. A relative path resolves against the repository root and an absolute path is used as-is. Paths inside the repository are added to `.git/info/exclude`. Esc or an empty branch cancels. Errors are shown in the popup until you press a key.

Example keybinding in your Herdr config:

```toml
[[keys.command]]
key = "prefix w"   # use your own key syntax
type = "plugin_action"
plugin = "repo-worktrees"
action = "new-worktree"
```

(Check the Herdr docs for the exact `plugin_action` field names in your version.)

## Configuration

Precedence, highest first:

1. `<repo>/.herdr/worktrees.json`
2. `$HERDR_PLUGIN_CONFIG_DIR/config.json` (your per-user default; `herdr plugin config-dir repo-worktrees` prints the directory)
3. Built-in default: `.claude/worktrees`

```json
{ "directory": ".worktrees" }
```

`directory` must be relative and must stay inside the repository. Absolute paths and `..` escapes are rejected. Invalid JSON produces an error naming the file.

## Git ignore

On each run the plugin idempotently appends `/<directory>/` to `<git-common-dir>/info/exclude`. This is a local-only ignore shared by all worktrees, so your tracked `.gitignore` is never modified.

## Security notes

- Commands run through `execFile` with argv arrays, never a shell.
- Branch names are validated (no leading `-`, whitespace, `..`, and other ref-unsafe characters).
- The resolved worktree path is checked to be inside the repository root (case-insensitive on Windows).
- Repo-level config is read from the repository you work in; the path checks above apply to it as well.

## Development

```sh
npm test   # node --test, no dependencies
```

The core in `src/` is pure and takes filesystem, git, and herdr access as injected ports. `bin/` holds the thin I/O adapters.

## Publishing

Push to a public GitHub repository and add the topic `herdr-plugin` so it appears in the Herdr marketplace.

## License

Apache-2.0
