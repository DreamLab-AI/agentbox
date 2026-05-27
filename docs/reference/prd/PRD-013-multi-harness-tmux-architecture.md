# PRD-013: Multi-Harness tmux Architecture and Documentation Revamp

**Status:** Draft v1
**Date:** 2026-05-27
**Author:** DreamLab AI
**Related:** ADR-005 (Pluggable Adapters), ADR-011 (Consultation MCPs), PRD-001 (Capabilities and Adapters), PRD-005 (Meta-Router Consultants), ADR-024 (Setup Dashboard)

## TL;DR for newcomers

This PRD replaces the consultant-mediated model (where all LLM interactions route through Claude Code as a data relay) with a **direct-access multi-harness architecture** where each AI coding agent runs in its own tmux tab with direct filesystem access. It also addresses a comprehensive documentation debt audit that found 33 issues across 89 docs, including 6 critical errors that break new users.

**If you remember only one thing:** each AI harness gets its own tmux window, its own git worktree, and direct workspace access — Claude Code (tab 0) coordinates but no longer relays data blobs to other models.

---

## 1. Goals

| ID | Goal | Success Metric |
|----|------|----------------|
| G1 | Eliminate the consultant data-relay bottleneck | Zero `mcp__consultant__*` calls required for multi-model workflows |
| G2 | Each AI harness operates directly on shared workspace | All harness tabs can read/write project files without Claude intermediation |
| G3 | Prevent file conflicts between concurrent harnesses | Git worktree isolation per active harness; zero index lock collisions |
| G4 | Session persistence across container restarts | tmux-resurrect + continuum restore all agent tabs automatically |
| G5 | Documentation accuracy ≥95% | All P0/P1 documentation issues from the 2026-05-27 audit resolved |
| G6 | Integrate official Perplexity MCP server | `@perplexity-ai/mcp-server` available as native Claude Code tool |
| G7 | Add Google Antigravity CLI as a first-class tmux tab | Window 10 with profile isolation and OAuth flow |

---

## 2. Background: The Harness Problem

The current consultant pattern routes all multi-model interactions through Claude Code: Claude reads files, serialises content into a data blob, calls a consultant MCP, receives the response, and applies changes. This re-serialisation layer:

- Inflates token cost (content is quoted twice — once for Claude's context, once for the consultant's)
- Introduces reproduction errors (exact whitespace matching breaks on relay)
- Creates a single point of failure (Claude's context window is the bottleneck)
- Prevents harnesses from using their native tool capabilities (file editing, bash execution)

The direct-access model gives each harness its own terminal with direct filesystem access, eliminating the relay. Coordination happens through git (worktrees, branches, merges) rather than through in-process tool calls.

Reference: ["The Harness Problem"](https://blog.can.ac/2026/02/12/the-harness-problem/) — validates content-hash-based edit verification and direct-access over intermediary routing.

---

## 3. Current State

### 3.1 Existing tmux Layout (10 windows)

| Tab | Name | Purpose |
|-----|------|---------|
| 0 | Claude | Primary Claude Code session |
| 1 | Agent | Generic agent execution |
| 2 | Services | `supervisorctl status` |
| 3 | Build | Build/compile shell |
| 4 | Logs | Management API log tail |
| 5 | System | `btm` / `htop` |
| 6 | VNC | VNC status |
| 7 | Git | `git status` |
| 8 | OpenRouter | Claude Code via OpenRouter API (profile-isolated) |
| 9 | ZAI | Claude Code via Z.AI GLM-5.2 endpoint (profile-isolated) |

### 3.2 Consultant MCPs (retained — dual-path model)

Consultants remain a first-class path. The MCP relay pattern is cost-effective for small queries where spinning up a full harness session is overkill. The new tmux tabs provide a **second path** for sustained, multi-turn work where direct filesystem access eliminates the relay overhead.

| Consultant | Model | MCP Relay (kept) | Direct Tab (new) |
|------------|-------|-------------------|------------------|
| `antigravity` | gemini-3.5-flash | Quick queries via Claude | Window 10: sustained Gemini coding sessions |
| `deepseek` | deepseek-v4-0324 | Quick queries via Claude | Window 11: sustained DeepSeek coding sessions |
| `zai` | glm-5.2 | Quick queries via Claude | Window 9: already exists |
| `perplexity` | sonar-pro | Quick queries via Claude | Window 12: sustained research sessions |
| `codex` | gpt-5.5 | Quick queries via Claude | Window 8: Codex CLI (upgrade to v0.134.0) |

### 3.3 Provisioning Gap

`provision-agent-stacks.py` only creates profiles for `zai` and `openrouter`. Missing: `gemini`, `deepseek`, `perplexity`, `ollama`, `codex`.

---

## 4. Functional Requirements

### 4.1 Multi-Harness tmux Tabs

| ID | Requirement | Priority |
|----|-------------|----------|
| F01 | Add Window 10: **Antigravity** — Google Gemini 3.5 Flash coding agent via `antigravity` CLI or `@google/gemini-cli`. Profile at `profiles/antigravity/`. Auth: OAuth browser flow (print URL for local completion) or `GOOGLE_GEMINI_API_KEY` | P0 |
| F02 | Add Window 11: **DeepSeek** — DeepSeek v4 (deepseek-v4-0324) via CodeWhale CLI (`npm i -g codewhale`, 35k stars). Profile at `profiles/deepseek/`. Auth: `DEEPSEEK_API_KEY` | P0 |
| F03 | Add Window 12: **Perplexity** — Research agent via `perplexity` CLI or interactive shell with official MCP. Profile at `profiles/perplexity/`. Auth: `PERPLEXITY_API_KEY` | P1 |
| F04 | Add Window 13: **Ollama** — Local LLM agent via Nanocoder (`npm i -g @nanocollective/nanocoder --provider ollama`). Profile at `profiles/ollama/`. Auth: none (network-local) | P1 |
| F05 | Upgrade Window 8 **Codex CLI** from v0.128.0 to v0.134.0. Already profile-isolated | P1 |
| F06 | Each new window follows the existing pattern: profile home at `profiles/<name>/`, symlinks to `workspace/` and `/projects`, env var injection at window creation | P0 |

### 4.2 Git Worktree Isolation

| ID | Requirement | Priority |
|----|-------------|----------|
| F07 | Each harness tab that performs file edits MUST operate in a named git worktree (`git worktree add /home/devuser/workspace/worktrees/<harness-name> -b harness/<harness-name>`) | P0 |
| F08 | Worktree creation is automated at window startup in `tmux-autostart.sh` | P0 |
| F09 | Claude Code (tab 0) retains the primary working tree and serves as merge coordinator | P0 |
| F10 | Add `harness-merge` alias: `git merge --no-ff harness/<name>` for pulling harness work into main worktree | P1 |
| F11 | File watcher (`inotifywait`) per worktree to surface cross-worktree conflicts via tmux alerts | P2 |

### 4.3 Perplexity MCP Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| F12 | Add official `@perplexity-ai/mcp-server` (2.2k stars, MIT, Perplexity-maintained) to `.mcp.json` as stdio transport: `npx -y @perplexity-ai/mcp-server` with `PERPLEXITY_API_KEY` env passthrough | P0 |
| F13 | Four tools available: `perplexity_search`, `perplexity_ask` (sonar-pro), `perplexity_research` (sonar-deep-research), `perplexity_reason` (sonar-reasoning-pro) | P0 |
| F14 | Retain existing `perplexity-research` skill for structured search and Agent API workflows (complementary, not replacement) | P0 |

### 4.4 Open Design Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| F25 | Integrate **open-design** ([nexu-io/open-design](https://github.com/nexu-io/open-design), 53k stars, Apache-2.0) as an agentic design generation tool within the progressive discovery system. Open-design generates web/mobile/desktop prototypes, slides, and design artefacts via AI coding agents with 150 bundled design systems and 132 composable skills | P1 |
| F26 | Installation: add as a Nix-packaged tool or Docker sidecar (`pnpm install` + Next.js 16 App Router). Mount at a dedicated port or integrate with the setup wizard's existing HTTP tier | P1 |
| F27 | Wire open-design's 16 CLI agent adapters to the agentbox harness ecosystem — it natively supports Claude Code, Gemini CLI, Codex, and Cursor as agent backends | P1 |
| F28 | Add `[skills.design].open_design = true` gate to `agentbox.toml` under optional toolchains. Default off — activated via setup wizard's progressive disclosure | P1 |
| F29 | Create `skills/open-design/SKILL.md` skill entry with routing guidance: use for UI mockups, visual documentation, design system generation, and slide decks. Not a replacement for the setup wizard SPA itself | P2 |

### 4.5 tmux Tooling Upgrades

| ID | Requirement | Priority |
|----|-------------|----------|
| F15 | Add **tmux-resurrect** (`tmuxPlugins.resurrect` in nixpkgs) for session persistence across container restarts | P0 |
| F16 | Add **tmux-continuum** (`tmuxPlugins.continuum`) for automatic save every 15 minutes with auto-restore on tmux server start | P0 |
| F17 | Add **tmux-cpu** (`tmuxPlugins.cpu`) for CPU/GPU load in status bar — surface RTX 6000 inference load | P1 |
| F18 | Add **tmux-logging** (`tmuxPlugins.logging`) for per-pane output capture — agent audit trail | P1 |
| F19 | Add **tmux-thumbs** (`tmuxPlugins.tmux-thumbs`) for keyboard-hint copying of URNs, paths, UUIDs between agent tabs | P2 |
| F20 | Add **tmux-xpanes** for broadcasting commands to multiple agent panes simultaneously | P2 |

### 4.5 Provisioning System Updates

| ID | Requirement | Priority |
|----|-------------|----------|
| F21 | Add `antigravity`, `deepseek`, `perplexity`, `ollama`, `codex` to `STACKS` in `provision-agent-stacks.py` | P0 |
| F22 | Each new stack gets: profile directory, workspace symlink, projects symlink, `.claude/settings.json` (where applicable), harness-specific config | P0 |
| F23 | Retain all consultant MCPs as a cost-effective path for small queries. Update model versions to latest (see §7.1) | P0 |
| F24 | Skill router offers both paths: consultant MCP for quick queries, direct tab for sustained multi-turn work | P1 |

---

## 5. Documentation Revamp

### 5.1 P0 Fixes (Critical — breaks operators)

| ID | Fix | Files |
|----|-----|-------|
| D01 | Fix port table: 9090, 9091, 5901, 8080 (not 9190, 9191, 5902, 8180). Remove SSH port 22/2223 | `quickstart.md:306-401`, `README.md:103` |
| D02 | Fix `docker load < result` → `nix run .#runtime.copyToDockerDaemon` | `platforms.md:47,55`, `glossary.md:255`, `consuming-image.md:71` |
| D03 | Rename `[federation]` → `[mesh]` in all docs | `configuration.md:39-45`, `quickstart.md:117-149`, `mesh-deployment.md:12-16`, `adapters.md:288`, `architecture.md:173` |
| D04 | Update all stale configuration.md sample TOML blocks to match current agentbox.toml defaults | `configuration.md` (~15 values) |
| D05 | Fix pseudo-user references: `openai-user` → `devuser`, `zai-user` → `devuser` | `providers.md:78-82`, `consultants.md:49` |
| D06 | Create `docs/user/tailscale.md` (README links to it) | New file |

### 5.2 P1 Fixes (High — misleading or undiscoverable)

| ID | Fix | Files |
|----|-----|-------|
| D07 | Update `docs/README.md` index: add ADR-016 through ADR-024, PRD-007 through PRD-013, DDD-005 through DDD-009, QE reviews, vocab registry | `docs/README.md` |
| D08 | Document 9 undocumented subsystems in `configuration.md`: LLM marketplace, payments, telegram (16 keys), git pods, multi-user pods, plugins (30+), memory admin, consultant keys, XINFERENCE/EMBEDDING vars | `configuration.md` |
| D09 | Remove phantom `[integrations.ragflow]` section | `configuration.md:284-288` |
| D10 | Remove deleted Playwright security exception | `configuration.md:575-577` |
| D11 | Add 6 missing skills to SKILL-DIRECTORY.md: `book-publishing`, `cost-estimation`, `godot-development`, `latex-book`, `prose-sanitiser`, `security-testing` | `SKILL-DIRECTORY.md` |
| D12 | Fix skill count: update to ~104 (not 87 or 92) | `SKILL-DIRECTORY.md:1,33,39,279` |
| D13 | Remove `browsercontainer` from skill inventory (it is infrastructure) | `SKILL-DIRECTORY.md` |
| D14 | Fix bare `/workspace` paths → `/home/devuser/workspace` | `solid-pod.md:135`, `nostr-relay.md:119`, `troubleshooting.md:39` |
| D15 | Promote ADR-018, ADR-019 from Draft to Accepted (fully implemented) | `ADR-018`, `ADR-019` |
| D16 | Fix PRD-007 phantom ADR-073 reference and PRD-010 mislabel | `PRD-007:7` |
| D17 | Fix `platforms.md` `docker load` → `copyToDockerDaemon` | `platforms.md:47,55` |
| D18 | Remove deprecated `perplexity` from MCP Server Summary | `SKILL-DIRECTORY.md:829` |

### 5.3 P2 Fixes (Medium — housekeeping)

| ID | Fix |
|----|-----|
| D19 | Consolidate compose generation docs (flake.nix → docker-compose.yml → don't hand-edit) |
| D20 | Add `.env.example` variable walkthrough to quickstart |
| D21 | Add Nix installation instructions for Linux |
| D22 | Standardise validator command (pick one canonical form) |
| D23 | Create `agentbox.sh` subcommand reference |
| D24 | Create setup dashboard user guide |
| D25 | Add missing glossary terms: Profile, Stack, Management API, Code-as-Harness, LION |
| D26 | Deduplicate `github-code-review` in SKILL-DIRECTORY.md |
| D27 | Document tmpfs mounts (17 mounts, ~2.2GB) for operators |
| D28 | Document solid-pods compose overlay |
| D29 | Create DDD for multi-tenant federation (PRD-007 + ADR-017 have no DDD) |
| D30 | Promote PRD-001 from Draft v1 |
| D31 | Standardise DDD frontmatter format |
| D32 | Resolve ADR-014 orphan status |

---

## 6. Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| N01 | Harness tabs must not increase container startup time by more than 5 seconds | P0 |
| N02 | Git worktree creation/cleanup must be idempotent (safe to re-run on restart) | P0 |
| N03 | tmux session restore must complete within 10 seconds | P1 |
| N04 | Per-harness tmux logging must not exceed 100MB per day | P1 |
| N05 | All new tmux plugins must be Nix-packaged (no runtime TPM fetches in read-only container) | P0 |
| N06 | Consultant MCPs must remain functional during transition (no breaking change) | P0 |

---

## 7. Architecture Overview

```
tmux session "agentbox"
├── Tab 0:  Claude Code ──────── primary worktree (main)
├── Tab 1:  Agent ────────────── ad-hoc execution
├── Tab 2:  Services
├── Tab 3:  Build
├── Tab 4:  Logs
├── Tab 5:  System (btm + tmux-cpu GPU overlay)
├── Tab 6:  VNC
├── Tab 7:  Git ──────────────── merge coordinator view
├── Tab 8:  OpenRouter ───────── worktree: harness/openrouter
├── Tab 9:  ZAI ──────────────── worktree: harness/zai
├── Tab 10: Antigravity ──────── worktree: harness/antigravity
├── Tab 11: DeepSeek ─────────── worktree: harness/deepseek
├── Tab 12: Perplexity ───────── worktree: harness/perplexity
└── Tab 13: Ollama ───────────── worktree: harness/ollama

Shared resources:
  /home/devuser/workspace/          ← bind mount (primary worktree)
  /home/devuser/workspace/worktrees/<name>  ← per-harness worktrees
  /home/devuser/workspace/profiles/<name>/  ← per-harness HOME
  /projects                         ← shared projects mount
  ruvector-postgres:5432             ← shared memory (PostgreSQL handles concurrency)
```

### 7.1 Harness CLI Matrix

| Tab | Harness CLI | Package | Auth |
|-----|-------------|---------|------|
| 10 | `antigravity` or `gemini` | `@google/gemini-cli` (104k stars), gemini-3.5-flash | OAuth or `GOOGLE_GEMINI_API_KEY` |
| 11 | `codewhale` | `codewhale` npm (35k stars), deepseek-v4-0324 | `DEEPSEEK_API_KEY` |
| 12 | `perplexity` shell + MCP | `@perplexity-ai/mcp-server` (2.2k stars) | `PERPLEXITY_API_KEY` |
| 13 | `nanocoder` | `@nanocollective/nanocoder` (2k stars) | None (Ollama network-local) |

### 7.2 xAI/Grok Status

No viable terminal agent harness exists for xAI/Grok. The Z.AI integration (tab 9) proxies Claude Code through Z.AI's GLM-5 endpoint. A dedicated Grok tab is deferred until an official or credible community CLI ships.

---

## 8. Implementation Phases

### Phase 1: Documentation Fixes (D01-D06) + Perplexity MCP (F12-F14)
- Fix all P0 documentation errors
- Add official Perplexity MCP to `.mcp.json`
- Estimated effort: 4 hours

### Phase 2: tmux Tooling + Session Persistence (F15-F20)
- Add Nix-packaged tmux plugins to `flake.nix`
- Update `tmux.conf` with plugin configuration
- Test resurrect/continuum across container restart cycle
- Estimated effort: 3 hours

### Phase 3: Provisioning + Harness Tabs (F01-F06, F21-F24)
- Add 5 new profiles to `provision-agent-stacks.py`
- Extend `tmux-autostart.sh` with windows 10-13
- Add CLI packages to `flake.nix` Nix derivation
- Update consultant MCP model versions to latest
- Estimated effort: 6 hours

### Phase 4: Git Worktree Isolation (F07-F11)
- Implement automated worktree creation per harness tab
- Add merge aliases and conflict detection
- Update ruflo coordination to use harness worktrees
- Estimated effort: 4 hours

### Phase 5: Documentation Completion (D07-D32)
- P1 and P2 documentation fixes
- New docs: tailscale.md, setup dashboard guide, agentbox.sh reference
- ADR/PRD/DDD index update, status promotions
- Estimated effort: 8 hours

---

## 9. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Git worktree proliferation exhausts disk | Medium | Auto-cleanup worktrees older than 24h; tmpfs for ephemeral worktrees |
| Harness CLI versions drift from Nix pins | Low | Renovate bot tracks npm package updates; `agentbox.toml` version pins |
| OAuth flow for Gemini fails in headless container | Medium | Print auth URL to tmux pane; user completes in local browser; credential persists in profile volume |
| Consultant MCPs disabled before tabs are stable | High | Consultants remain functional (N06); deprecation is a routing preference, not removal |
| tmux-resurrect restores stale agent state | Low | Continuum saves frequently; resurrect hooks clear stale locks on restore |

---

## 10. Success Criteria

| Criterion | Measurement |
|-----------|-------------|
| All 6 P0 doc issues resolved | Manual review against audit checklist |
| Perplexity MCP tools callable from Claude Code | `perplexity_search` returns results |
| 4 new harness tabs operational | Each tab can read a file, execute a command, and write output |
| Session survives container restart | `docker restart agentbox` → all 14 tabs restore within 10s |
| Zero git index lock errors | 1 hour of concurrent multi-harness editing produces no `.git/index.lock` failures |
| docs/README.md indexes all reference docs | Count matches filesystem (`find docs/reference -name '*.md' | wc -l`) |

---

## Appendix A: Perplexity MCP `.mcp.json` Entry

```json
{
  "perplexity": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@perplexity-ai/mcp-server"],
    "env": {
      "PERPLEXITY_API_KEY": "${PERPLEXITY_API_KEY}"
    }
  }
}
```

## Appendix B: tmux Plugin Nix Configuration

```nix
# In flake.nix tmux plugin list
tmuxPlugins = with pkgs.tmuxPlugins; [
  resurrect
  continuum
  cpu
  logging
  tmux-thumbs
];
```

## Appendix C: Documentation Audit Source

Full audit conducted 2026-05-27 using a 5-agent mesh review covering:
- Docker design vs compose files (20 findings)
- Feature gates vs agentbox.toml (15 findings)
- User flow docs accuracy (15 findings)
- ADR/PRD/DDD cross-references (10 findings)
- Skills directory accuracy (10 findings)

Total: 33 unique issues across 89 documentation files.
