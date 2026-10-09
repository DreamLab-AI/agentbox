# Workspace — Claude Code notes

@AGENTS.md

## Model roles and the advisor

Sonnet leads on high effort, an Opus advisor is on call, and search fans out to the Haiku `Explore` agent (`[claude_code]` in `agentbox.toml`, ADR-2134). Consult the advisor at three points:

- before locking a plan that spans several files, a schema or wire contract, auth or identity;
- when the same test or compiler error fails twice, before a third attempt;
- before declaring a task done or staging a commit, over the full diff.

Skip it for routine reads, searches and single-file edits. When your own evidence contradicts the advice, say so instead of following it. The advisor is the same model family, not the independent audit: build-with-quality's evidence auditor stays cross-vendor. Pick each subagent's model per call (`model` on the Agent tool): Haiku for lookup, Sonnet for implementation, Opus only for design or review.

## Browser

Use the `browser` skill (browsercontainer sidecar, MCP `browser-gpu`). Never install local Playwright / `agent-browser` / `@claude-flow/browser`.

## Session mirror (Nostr)

Per-turn mirror to the configured relay via `config/hooks/nostr-live-mirror.cjs` (NIP-59 gift-wrapped self-DMs; read in Amethyst by importing the nsec from `~/.claude/nostr-mirror/mirror-key.txt`, then delete it). No-op without a recipient pubkey; off switch `AGENTBOX_LIVE_MIRROR=0`; fail-open.

## Instruction tiers

The tiers above every repository are generated at boot from the agentbox repo (`config/instructions/`, ADR-2118) and overwritten on the next boot, so edit the layer, not the output. Run `agentbox-manifest instructions-project` to apply an edit now. Tracked layers are public; addresses, private repository names and personal preferences go in the gitignored `config/instructions/local/`.

| Tier | Edit | Projected to | Owns | Never contains |
|------|------|--------------|------|----------------|
| global | `global.md` + `local/global.md` | `~/.claude/CLAUDE.md`; appended to `~/.codex/AGENTS.md` | Memory discipline, operator working style | Project or env specifics |
| workspace | `workspace.md` + `local/workspace.md` | `~/workspace/AGENTS.md` (embedded above; appended to Codex) | Container env facts, services, RuVector env rules, endpoints | Methodology or behavioural rules |
| workspace (Claude) | `workspace.claude.md` + `local/workspace.claude.md` | this file | Claude-only affordances | Tool-neutral facts |
| repository | the repo's `AGENTS.md`; its `CLAUDE.md` imports it (`@AGENTS.md`) | — | Repo-specific rules only | Anything already upstream |

A new tool-neutral fact goes in an `AGENTS.md`-side layer; never create a repo `CLAUDE.md` without the import, or Claude stops seeing the shared file. If a rule belongs upstream, move it there and delete it here. Detail lives in referenced docs loaded on demand.
