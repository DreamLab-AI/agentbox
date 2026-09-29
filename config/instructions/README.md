# Instruction tiers — source of truth (ADR-2118)

The tiers that sit above every repository are composed from this directory at
every boot by `agentbox-manifest instructions-project`. The directory is
mounted read-only at `/etc/agentbox/instructions`; it is never baked into the
image. Edit here, never the generated files.

| Layer file | Projected to | Holds |
|---|---|---|
| `global.md` + `local/global.md` | `~/.claude/CLAUDE.md`; appended to `~/.codex/AGENTS.md` | memory discipline, operator working style |
| `workspace.md` + `local/workspace.md` | `~/workspace/AGENTS.md`; appended to `~/.codex/AGENTS.md` | tool-neutral container facts, estate endpoints |
| `workspace.claude.md` + `local/workspace.claude.md` | `~/workspace/CLAUDE.md`, with the workspace tier embedded at its `@AGENTS.md` line | Claude Code-only affordances |

Tracked files are public: name hosts, repositories and people by role only.
Addresses, private repository names, relay URLs and personal preferences go in
`local/`, which is gitignored (`tests/config/instructions-layers.test.sh`
rejects estate specifics in the tracked layer).

Apply an edit without rebooting:

    agentbox-manifest instructions-project           # write
    agentbox-manifest instructions-project --check   # exit 1 on drift

Credential sync retries every poll, uses private atomic temporary files, and
`cred-sync --once` exits nonzero on an I/O error. It is eventual convergence,
not a shared lock with Claude Code: simultaneous refreshes or explicit logout
on one side are not coordinated. Remove credentials from both sides with the
sync stopped for a deliberate shared logout; deletion on one side is reseeded.
