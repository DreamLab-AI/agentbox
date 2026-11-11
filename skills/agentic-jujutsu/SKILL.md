---
name: agentic-jujutsu
description: "Restructures a branch's commit history with the baked Jujutsu CLI (`jj`), colocated with a Git repo: split, squash, reorder and rewrite commits, and recover from a bad rebase through its operation log. Use when someone asks for jj or wants a messy commit history tidied before review. Not for undoing a single file edit or a plain git commit or push, nor for PRs, CI or releases (github-workflow-automation)."
---

# Jujutsu (`jj`) for agents

`jj` is baked into the image (present after the next image build; check `command -v jj`). It stores commits in Git, so a colocated repo stays a normal Git repo for everyone else.

## Why an agent would use it

- The working copy is always a commit; there is no staging area and no "dirty tree" state to lose.
- Every command is recorded in an operation log, so `jj undo` reverses a mistaken rebase, squash or abandon.
- Rebasing a commit rewrites its descendants automatically; conflicts are stored in commits and resolved later, not blocking.
- Change IDs stay stable while commit hashes change, so a rewritten commit is still the same change.

## Set up (colocated with Git)

```bash
cd <repo>
jj git init --colocate     # adds .jj/ beside .git/; Git commands keep working
jj status
```
In a colocated repo `.jj/` is ignored by Git. Plain `git` still works, but after a Git command run `jj status` to re-import.

## Commands an agent needs

| Task | Command |
|---|---|
| Working-copy changes | `jj status`, `jj diff` |
| History | `jj log`, `jj log -r 'mine() & ~empty()'`, `jj show <rev>` |
| Describe current change | `jj describe -m "message"` |
| Start the next change | `jj new` (or `jj new <rev>` to branch from one) |
| Fold into parent | `jj squash` (or `jj squash --from X --into Y`) |
| Split a change | `jj split <paths>` (non-interactive: name the paths; the diff editor is interactive) |
| Reorder or move | `jj rebase -r <rev> -d <dest>`, `-s` for a subtree, `-b` for a branch |
| Abandon | `jj abandon <rev>` |
| Undo and inspect | `jj undo`, `jj op log`, `jj op restore <op-id>` |
| Bookmarks (Git branches) | `jj bookmark create <name> -r <rev>`, `jj bookmark set <name> -r <rev>`, `jj bookmark list` |
| Git remotes | `jj git fetch`, `jj git push --bookmark <name>` |
| Resolve conflicts | `jj resolve --list`, edit the markers, then `jj squash` or `jj describe` |

Run `jj <cmd> --help` for the installed version's exact flags; jj is pre-1.0 and has renamed commands (for example branches became bookmarks).

Avoid interactive commands: `jj split` and `jj squash -i` without paths open a diff editor, and `jj describe` without `-m` opens `$EDITOR`. Always pass `-m` and paths.

## Typical agent loop

```bash
jj git init --colocate          # once
jj describe -m "feat: add parser"   # name what you are about to do
# ...edit files; they are already part of the working-copy commit...
jj new -m "test: parser cases"      # finish that change, start the next
jj log -r '::@' --limit 5
jj bookmark create feat/parser -r @-
jj git push --bookmark feat/parser
```
Mistake: `jj op log` to find the operation before it, then `jj op restore <id>` (or `jj undo` for the last one).

## Coexisting with this estate's Git rules

- One checkout per worker still applies. jj does not make a shared tree safe. Each parallel agent uses its own `git worktree` under `~/workspace/wt/<repo>-<task>`; run `jj git init --colocate` inside that worktree only if you need jj there, and remove the worktree when done.
- jj's own workspaces (`jj workspace add`) are not the estate's worktree convention; use `git worktree` so the teardown rules hold.
- Never rewrite history that is pushed or belongs to the operator: `jj rebase`, `squash` and `abandon` on immutable or already-pushed commits is refused by default for the trunk; do not override with `--ignore-immutable`. Rewrite only your own unpushed changes, or a branch you created.
- Do not force-push. `jj git push` refuses to move a bookmark sideways unless you opt in; do not.
- Commit messages and attribution follow the repository's rules; `jj describe` is only the editor.
- Park the operator's dirty primary checkout as the workspace rules say before using jj in it; do not run `jj` in a primary checkout you did not create.

## Not covered

jj does not replace PR, review or CI tooling; hand that to `github-workflow-automation` or `gh`. It does not provide lock-free multi-agent commits: concurrent jj commands in one repo are serialised by its own repo lock, so isolate with worktrees.
