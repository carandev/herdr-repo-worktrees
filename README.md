# herdr-repo-worktrees

A [Herdr](https://herdr.dev) plugin that creates git worktrees at a path **relative to the repository**, configurable per project. The default is `.claude/worktrees/<branch-slug>`.

The worktree is created directly at the final path (via `herdr worktree create --path`), so nothing is moved afterwards. Worktrees always land under the **main** repository, even when the action is triggered from inside a linked worktree.

## Install

```sh
herdr plugin install carandev/herdr-repo-worktrees
```

Requires Herdr >= 0.9.5 and Node.js >= 22 on `PATH`. No npm dependencies.

## Usage

Run the `new-worktree` action from a workspace. A popup shows one form with every field visible and editable at any time:

```
╭─ New worktree · my-repo ───────────────────────╮
│ Branch     feat/vouchers                       │
│ Base ref   ma                                  │
│            ▸ main  origin/main                 │
│ Path       .claude/worktrees/feat-vouchers     │
│                                                │
│ → /abs/path/my-repo/.claude/worktrees/feat-... │
│ Layout: * · 2 tabs, 3 panes                    │
│                                                │
╰────────────────────────────────────────────────╯
```

- **Branch** is validated as you type. **Path** is optional: when empty, the dim placeholder is the default (e.g. `.claude/worktrees/feat-x`) and it follows the Branch text. A relative path resolves against the repository root and an absolute path is used as-is. Paths inside the repository are added to `.git/info/exclude`.
- **Base ref** is optional and autocompletes from local and remote branches while it is focused (prefix matches first, then substring matches).
- A validation error or a failed `herdr worktree create` keeps you in the form with the message in red, so you can fix it and retry. If only the layout fails, the worktree is kept and the error is shown until you press a key.
- Set `NO_COLOR` to disable colors. Without a TTY (piped stdin) the plugin falls back to plain sequential prompts.

| Key | Action |
| --- | --- |
| Type, Backspace, Delete, Left/Right, Home/End (Ctrl+A/Ctrl+E) | Edit the focused field. |
| Ctrl+U | Clear the focused field. |
| Tab, Down / Shift+Tab, Up | Next / previous field. |
| Down / Up on Base ref | Move through suggestions (Up from the first clears the highlight). |
| Tab or Right (at end of text) on Base ref | Accept the highlighted, or first, suggestion. |
| Enter | Accept the highlighted suggestion; otherwise next field; on Path, create. |
| Ctrl+S | Create from any field. |
| Esc / Ctrl+C | Esc clears a highlighted suggestion first, otherwise cancels. Ctrl+C always cancels. |

Example keybinding in your Herdr config:

```toml
[[keys.command]]
key = "prefix+alt+w"
type = "plugin_action"
command = "repo-worktrees.new-worktree"
```

Plugins cannot register keybindings themselves; add this to your Herdr `config.toml` and run `herdr server reload-config`.

## Configuration

Two files are read:

- `<repo>/.herdr/worktrees.json`: repository-level, may set only `directory`.
- `$HERDR_PLUGIN_CONFIG_DIR/config.json`: your user config (`herdr plugin config-dir repo-worktrees` prints the directory). It may set a top-level `directory` and a `projects` map with per-project `directory` and `layout` (see below).

```json
{ "directory": ".worktrees" }
```

`directory` must be relative and must stay inside the repository. Absolute paths and `..` escapes are rejected. Invalid JSON produces an error naming the file. Unknown top-level keys are ignored; unknown keys inside a project or a layout entry are errors. The full `directory` precedence is listed under [Per-project settings](#per-project-settings-and-pane-layout).

### Per-project settings and pane layout

The user config (`$HERDR_PLUGIN_CONFIG_DIR/config.json`) may define a `projects` map. After the worktree is created, the project's `layout` is applied to the new workspace.

```json
{
  "directory": ".claude/worktrees",
  "projects": {
    "Univer.CRM": {
      "directory": ".worktrees",
      "layout": [
        { "command": "claude" },
        { "split": "right", "cwd": "src/api", "command": "npm run dev" },
        { "split": "down", "ratio": 0.3, "from": 0, "command": "lazygit" }
      ]
    },
    "C:/Users/me/dev/other": { "layout": [{ "command": "claude" }] }
  }
}
```

**Matching.** A key matches the main repository when it is an absolute path equal to the repo root, or equals the repo root's folder name. Precedence: absolute-path key, then name key, then the `"*"` wildcard. `"*"` applies only when no specific key matches, and it is never treated as a path or a name. On Windows both comparisons ignore case and slash style.

**Directory precedence**, highest first: `<repo>/.herdr/worktrees.json`, the matched project's `directory` (or `"*"`'s, when `"*"` is the selected entry), the top-level `directory`, the built-in default.

**Wildcard and no merging.** `"*"` is a default entry for every repository without a specific entry. The selected entry replaces `"*"` completely; fields are never merged. To opt a project out of the global layout, give it an empty one:

```json
{
  "projects": {
    "*": { "layout": [{ "command": "claude" }, { "split": "right" }] },
    "Scratch": { "layout": [] }
  }
}
```

Caveat: a project entry that has only `directory` gets no layout, because it does not inherit the `"*"` layout.

**Layout entries.** `layout` is an array applied in order. Entry 0 is the pane Herdr opens for the new workspace; every later entry is either a split (has `split`) or a new tab (no `split`).

| Field | Entries | Meaning |
| --- | --- | --- |
| `command` | any | Typed into the pane's shell, then Enter. Omit it for a plain shell. |
| `label` | 0 and tab entries | Non-empty tab name. On entry 0 it renames the existing root tab; on a tab entry it names the new tab. Rejected on entries with `split`. |
| `cwd` | any | Relative to the worktree (default: the worktree root); absolute paths and `..` escapes are rejected. The directory must exist. On entry 0 the pane already exists, so the plugin types `cd "<path>"` into its shell; this does not switch drives in `cmd.exe`. |
| `split` | 1..n, optional | `right` or `down`. Omit it to open a new tab instead (see below). Not allowed on entry 0. |
| `ratio` | 1..n, needs `split` | Number with 0 < ratio < 1. Omit it to use Herdr's default. |
| `from` | 1..n, needs `split` | Index of an earlier entry (including a tab entry's pane) to split. Defaults to the previous entry. |

**Tabs.** An entry without `split` opens a new tab in the worktree's workspace, with its `command` and `cwd` applied to the tab's first pane. Focus stays on the root pane. Because omitting `split` silently turns an entry into a tab, a typo that drops it will not raise an error (`ratio` and `from` are rejected without `split`). A later entry can split inside a tab by pointing `from` at the tab entry:

```json
"layout": [
  { "label": "main", "command": "claude" },
  { "label": "api", "cwd": "src/api", "command": "npm run dev" },
  { "split": "right", "from": 1, "command": "npm test -- --watch" }
]
```

**Full example.** A default layout for every repository, and a project with named tabs where one tab is split top/bottom:

```json
{
  "projects": {
    "*": {
      "layout": [
        { "label": "claude", "command": "claude" },
        { "label": "lazygit", "command": "lazygit" },
        { "label": "shell" }
      ]
    },
    "Univer.CRM": {
      "layout": [
        { "label": "claude", "command": "claude" },
        { "label": "api/web", "cwd": "CRM.API" },
        { "split": "down", "ratio": 0.5, "cwd": "CRM.Backoffice.Web" },
        { "label": "lazygit", "command": "lazygit" }
      ]
    }
  }
}
```

`Univer.CRM` gets three tabs: `claude`, `api/web` (`CRM.API` on top, `CRM.Backoffice.Web` below; `from` defaults to the previous entry, the `api/web` tab) and `lazygit`. Any other repository gets `claude`, `lazygit` and an empty `shell` tab.

Unknown keys in a project or a layout entry are errors. If the layout cannot be applied (for example a `cwd` that does not exist) the worktree is kept and the popup shows `Layout failed: ...` until you press a key.

**Security.** Layouts run commands, so they are read only from your own user config. `layout` and `projects` in `<repo>/.herdr/worktrees.json` are ignored, so a cloned repository can never make the plugin run commands.

## Git ignore

On each run the plugin idempotently appends `/<directory>/` to `<git-common-dir>/info/exclude`. This is a local-only ignore shared by all worktrees, so your tracked `.gitignore` is never modified.

## Security notes

- The plugin's own `git` and `herdr` calls run through `execFile` with argv arrays, never a shell.
- Layout `command` values are the exception by design: Herdr types them into the pane's interactive shell, so they get full shell semantics. That is why layouts are read only from your user config.
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
