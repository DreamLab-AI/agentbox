# Agentbox Repo Notes

This file documents the current repo architecture. It is not a generic Claude Code prompt file.

## Current State

Agentbox is in a 2.0 migration state:

- build composition is driven by `agentbox.toml`
- the runtime is sovereign/profile-based
- Zellij replaces tmux
- profile isolation replaces Linux pseudo-user isolation
- Solid-style pod storage plus RuVector replace the old memory/storage model

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
