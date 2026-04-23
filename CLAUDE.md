# Agentbox Repo Notes

This file documents the current repo architecture. It is not a generic Claude Code prompt file.

## Current State

Agentbox is in active development:

- build composition is driven by `agentbox.toml`
- the runtime is sovereign/profile-based
- Zellij replaces tmux
- profile isolation replaces Linux pseudo-user isolation
- **pluggable adapters** replace hardcoded durable-state services (see [ADR-005](docs/adr/ADR-005-pluggable-adapter-architecture.md)): beads, pods, memory, events, orchestrator — each resolves to `local-*`, `external`, or `off`
- standalone-or-federated: `federation.mode = "standalone"` ships a complete product with local fallbacks; `federation.mode = "client"` federates with a host container mesh through adapter endpoints
- embedded RuVector is a per-session retrieval cache, not a durable source of truth

Full product spec: [PRD-001](docs/prd/PRD-001-capabilities-and-adapters.md). Adapter contract + SLOs + observability: [ADR-005](docs/adr/ADR-005-pluggable-adapter-architecture.md).

## Canonical Runtime Files

- [`flake.nix`](flake.nix): image composition and generated supervisor text
- [`agentbox.toml`](agentbox.toml): feature gates and toolchains
- [`config/entrypoint-unified.sh`](config/entrypoint-unified.sh): runtime bootstrap
- [`scripts/skills-entrypoint.sh`](scripts/skills-entrypoint.sh): runtime dependency bootstrap
- [`scripts/sovereign-bootstrap.py`](scripts/sovereign-bootstrap.py): identity generation and pod scaffolding
- [`scripts/provision-agent-stacks.py`](scripts/provision-agent-stacks.py): stack/profile provisioning
- [`scripts/zellij-stack.sh`](scripts/zellij-stack.sh): stack-specific terminal workspace launcher

## Important Rules For Changes

- Do not reintroduce Linux pseudo-user isolation as the primary model.
- Optional features must remain manifest-gated through `agentbox.toml`.
- If a service is optional, gate both:
  - its Nix package set
  - its supervisor/service block
- Prefer shared mounts plus profile-local configuration over per-user home directory divergence.
- **Adapter contract is non-negotiable.** Every durable-state integration goes through one of the five adapter slots (beads, pods, memory, events, orchestrator). Never hardcode a backend. Never ship a feature that only works in `client` mode or only in `standalone` mode — the contract test harness in `tests/contract/` must pass for all three implementation classes per slot.
- **No host-project specifics in this repo.** Agentbox is its own standalone project at `github.com/DreamLab-AI/agentbox`. Integration with any specific host project lives in that project's docs, not here. Reference the host by role ("host project", "integrator", "external orchestrator") rather than by name.
- **Observability is built-in, not optional.** Every adapter dispatch emits a span, a log line, and metrics. Only the exporters are optional (OTLP endpoint can be empty).

## Shared Runtime Model

The intended runtime model is:

- all profiles see the same `/projects`
- all profiles see the same `/workspace`
- all profiles get the same `/opt/agentbox/skills` tree
- profile-local settings live under `/workspace/profiles/<stack>/`

## Legacy Files

These exist for historical context or partial compatibility and should not be treated as the primary runtime path:

- `config/supervisord.conf`
- older docs that describe `devuser`, `gemini-user`, `openai-user`, `zai-user`, `deepseek-user`
- old keepalive-only runtime assumptions

## Docs To Keep In Sync

When architecture changes, update these together:

- [`README.md`](README.md)
- [`docs/guides/quick-start.md`](docs/guides/quick-start.md)
- [`CLAUDE.md`](CLAUDE.md)
- relevant ADRs in `docs/adr/`
