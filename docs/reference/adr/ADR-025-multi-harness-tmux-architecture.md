# ADR-025: Multi-Harness tmux Architecture

**Status:** Accepted
**Date:** 2026-05-27
**Author:** Agentbox team
**Supersedes:** n/a
**Related:** PRD-013, ADR-005 (Pluggable Adapter Architecture), ADR-011 (Session Persistence), ADR-024 (Setup Dashboard)

## TL;DR for newcomers
*Skip if you already know the multi-harness model.*

This ADR records the architecture decision to give each AI coding harness its own dedicated tmux window with direct filesystem access, replacing the prior pattern of routing all LLM interactions through Claude Code as a relay. Consultant MCPs are retained as a low-cost path for small queries. Git worktrees isolate each harness tab from index contention. Session persistence uses tmux-resurrect + continuum, both Nix-packaged.

**If you remember only one thing:** each harness owns a window and a worktree; Claude Code is not a relay.

---

## Context

The previous pattern used Claude Code as a data relay: every LLM interaction — regardless of which model generated it — was quoted through Claude Code before reaching the filesystem or the user. This created three compounding problems:

1. **Token inflation.** Content quoted twice doubles prompt cost on every round-trip. A 2 kB response from Gemini becomes a ~4 kB Claude Code input.
2. **Reproduction errors.** Code copied through a relay is subject to reformatting, elision, and hallucination on re-emission. The relay introduced a fidelity gap between what the model generated and what was written to disk.
3. **Single point of failure.** A Claude Code context-length limit or rate-limit stalled all other harnesses, even those with independent quotas.

The "Harness Problem" blog post (blog.can.ac, February 2026) independently validated direct-access over intermediary routing, citing a 37% token-cost reduction and a measurable drop in round-trip latency for agentic coding tasks.

Multiple CLI harnesses have matured to production quality: Gemini CLI (~104k stars), CodeWhale/DeepSeek (~35k), Nanocoder/Ollama (~2k), and Codex CLI. Each supports direct filesystem access via native tool calls, eliminating the relay requirement.

Git worktree isolation was identified as the remaining coordination risk — concurrent agents writing to the same index produce lock contention and unpredictable merges.

---

## Decisions

### D1: Dedicated tmux windows per harness (tabs 10–13)

Each AI coding harness occupies one tmux window in the existing MAD-style layout. Windows 0–9 are reserved for existing services (Claude Code on tab 0 retains the primary worktree). Windows 10–13 are assigned:

| Tab | Harness | Worktree path |
|-----|---------|---------------|
| 10 | Gemini CLI | `workspace/.worktrees/gemini` |
| 11 | CodeWhale / DeepSeek | `workspace/.worktrees/deepwhale` |
| 12 | Nanocoder / Ollama | `workspace/.worktrees/nano` |
| 13 | Codex CLI | `workspace/.worktrees/codex` |

Harness binary availability is checked at container boot; absent harnesses leave their tab window uncreated rather than spawning a placeholder.

### D2: Git worktree per harness tab

Each harness window runs inside a dedicated git worktree (`git worktree add`). Claude Code (tab 0) retains the primary worktree at the project root. Worktrees are created by `config/tmux-autostart.sh` on session start and pruned (`git worktree prune`) on container shutdown via a supervisor stop-event hook. Worktrees are ephemeral — they are never committed to the image and are excluded from the session-resurrect state.

### D3: Dual-path model — consultant MCPs retained

Consultant MCPs (the existing Claude-Code-mediated MCP tools) are not removed. They remain as a cost-effective path for queries that do not require full harness context: single-file lookups, documentation questions, and quick code explanations. The decision rule is:

- **Consultant MCP path**: query affects ≤2 files, no write operations, response fits in one tool call.
- **Direct harness path**: multi-file changes, iterative edits, long agentic runs.

### D4: Profile isolation follows existing pattern

Harness tabs follow the same profile isolation model established in the shared runtime (see `agentbox/CLAUDE.md`). Each harness profile lives at `profiles/<harness-name>/` with symlinks to the shared workspace and projects mounts. No new isolation primitive is introduced.

### D5: Session persistence via tmux-resurrect + continuum (Nix-packaged)

`tmux-resurrect` and `tmux-continuum` are added to the Nix package set and loaded in `config/tmux.conf`. No runtime TPM installation is performed at container start. Continuum auto-save interval is set to 5 minutes. Worktree paths are excluded from resurrect state (D2).

### D6: Official Perplexity MCP added as native Claude Code tool

`@perplexity-ai/mcp-server` is registered in `.mcp.json` as a first-class tool for Claude Code. This replaces the prior pattern of routing Perplexity queries through a consultant intermediary. Configuration: `PERPLEXITY_API_KEY` from the secrets mount; model pinned to `sonar-pro`.

### D7: open-design integrated as agentic design generation tool

`nexu-io/open-design` is added to the harness toolchain and exposed on tab 13 alongside Codex CLI. Design generation outputs are written to `workspace/design-outputs/` and are not tracked by the primary worktree.

---

## Consequences

### Positive

- Eliminates the relay bottleneck; each harness calls tools directly against its worktree.
- Native tool use per harness — Gemini CLI's function-calling, DeepSeek's tool protocol — requires no adapter shim.
- Token cost reduction for multi-turn agentic runs (no double-quoting through Claude Code).
- Consultant MCPs remain available for quick, cost-effective single-turn queries.
- Nix-packaged session persistence avoids runtime dependency drift.

### Negative

- Total tmux window count increases from ~9 to 14; operators managing sessions manually have more surface to navigate.
- Git worktree cleanup must run on every container restart; a crash without a clean shutdown can leave stale worktree lock files requiring manual `git worktree prune`.

### Risks

- **Gemini OAuth flow** requires interactive browser completion. In a headless container this must be completed once via the VNC desktop (`:5903`) or a pre-issued refresh token mounted as a secret. The harness window will block at the OAuth prompt until credentials are available; it does not error the container boot.
- **Worktree branch divergence.** Long-running harness sessions accumulate commits on their worktree branch. Operators must merge or rebase periodically. A rebase conflict on the shared project root is not automatically resolved.
