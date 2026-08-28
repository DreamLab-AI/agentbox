# ADR-063: Enable the ruflo-metaharness plugin (boot-apply, read/audit tier)

- **Status:** Accepted — implemented and verified live (2026-08-27 rebuild)
- **Date:** 2026-08-27
- **Relates to:** [ADR-062](ADR-062-metaharness-adoption-posture.md) (posture),
  [ADR-064](ADR-064-bake-metaharness-runtime-binaries.md) (full-offline follow-up),
  ADR-039 (apply classes), upstream ruflo#ADR-150

## Context

The boot plugin pipeline (entrypoint Phase 7) sparse-clones the whole
`github.com/ruvnet/ruflo` `plugins/` tree into `/var/cache/ruflo-plugins` and
symlinks entries declared in `agentbox.toml [[plugins.packages]]` into
`~/.claude-flow/plugins/`. `plugins/ruflo-metaharness` is already in the cache
(tree at 3.38.20, 2026-08-24) — enabling it is a config-only, **boot-class** change.

Two constraints discovered by the research mesh:

1. The boot tomllib parser **silently skips** any `[[plugins.packages]]` entry
   without `enabled = true` — the flag is mandatory, not defaulted.
2. On this network-restricted container the plugin is **capability-limited**:
   the read/audit skills (`harness-score` static paths, `harness-genome`,
   `harness-mcp-scan`, `harness-threat-model`, `harness-similarity`,
   `harness-drift-from-history`) work, but `score/genome/evolve/security-bench`
   shell out to binaries the closure only partially bakes — the umbrella
   `metaharness@~0.3.0` factory is absent and the bundled `@metaharness/darwin@0.7.1`
   fails the skills' `~0.8.0` pin. Those paths hit the ruflo#ADR-150 graceful
   degradation (`{degraded:true}`, exit 0) until ADR-064 lands.

## Decision

Add to `agentbox.toml`:

```toml
[[plugins.packages]]
name    = "ruflo-metaharness"
enabled = true
# source defaults to "ruflo-git" → symlink from /var/cache/ruflo-plugins (offline-safe)
```

plus a `system-manifest.js` catalogue entry with apply class **`boot`**.

Explicitly forbidden: the `source = "registry"` (IPFS/IPNS) install route and
`ruflo plugins install` — both are networked, unpinned paths.

Step 1 is documented as **read/audit-only**. Full-offline `score/genome/evolve/
security-bench` function arrives with ADR-064's rebuild.

## Consequences

- Zero image rebuild; reversible by flipping `enabled = false` (boot-class rollback).
- Version skew risk: pinned ruflo CLI 3.32.x vs boot-cloned plugin tree at HEAD
  (3.38.x, re-pulled every boot). Accepted short-term as untrusted-drift; closed
  structurally by ADR-064. If reproducibility is needed before then, pin the cache
  clone to a tag.
- CI/manifest gate must assert both degradation halves: `degraded:true` when
  metaharness binaries are absent, real data when present.
