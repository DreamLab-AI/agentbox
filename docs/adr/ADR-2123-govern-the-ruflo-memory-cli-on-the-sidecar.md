---
id: ADR-2123
title: Govern the ruflo memory CLI on the ruvector-postgres sidecar
date: 2026-10-03
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit:
verified_paths: [mcp/servers/ruflo-memory-cli.cjs, tests/contract/ruflo-memory-cli.contract.spec.js, tests/config/ruflo-memory-governed.test.sh]
owner: jjohare
review_trigger: a ruflo release whose memory subsystem gains a Postgres backend or an external embedding provider, or a ruflo-console release whose memory pane stops shelling out to `ruflo memory stats|list --format json`
repo: agentbox
---

# ADR-2123 — Govern the ruflo memory CLI on the ruvector-postgres sidecar

## Context

Durable memory in this image is the ruvector-postgres sidecar, embedded by Xinference (bge-small-en-v1.5, 384-dim, GPU) and served by `mcp/servers/ruvector-mcp.cjs` under the `claude-flow` MCP name (ADR-015, ADR-2014, ADR-2019). ruflo 3.51.1 (ADR-2020 gate `ruflo_console`, baked 2026-10-03) ships its own memory subsystem, and it is local-only: `memory init` writes sql.js SQLite under `.swarm/`, an AgentDB mirror, the native engine's `./ruvector.db` in the working directory and a MiniLM ONNX embedder whose cache path is the read-only Nix store. Its `--backend` flag is a label written into a metadata table; no value reaches Postgres, no setting selects an embedding endpoint, and its MCP server given the sidecar's full `RUVECTOR_PG_*`/`PG*` env still searched an empty local store (tested 2026-10-03). Every `ruflo` invocation, `--help` included, also autostarted a worker daemon into the working directory. The ruflo-console memory pane reaches memory only by shelling out to `ruflo memory stats --format json` and `ruflo memory list --format json --limit 500`, so with the stock binary it shows an empty local store, never the governed corpus. One `memory init` run on 2026-10-03 left three local stores in a repository, one of them not gitignored.

## Decision

The `ruflo` and `claude-flow` bins the image puts on PATH are governed wrappers (`rufloGovernedPkg` in `flake.nix`), not the package's own.

1. `ruflo memory …` execs `mcp/servers/ruflo-memory-cli.cjs`. It reuses `lib/memory-tools.js` with the same pool, embedding transport and `agentbox:<ns>:<key>` entry ids as the MCP server, so a key written on either path is the same row. It serves `store`, `retrieve`, `search`, `list`, `delete` and `stats` from the sidecar and emits ruflo 3.51.1's `--format json` shapes, so the console's parsers are unchanged and its memory pane shows the sidecar corpus. It fails closed: no Postgres is exit 1, an unembeddable write is rejected (ADR-2014), and `init`, `configure`, `cleanup`, `compress`, `export`, `import`, `purge`, `distill`, `backup`, `classify`, `select-operator` and `migrate` are refused with exit 2 and no file written.
2. Every other subcommand runs the real CLI with three env defaults, each overridable by an operator export and also exported at boot: `RUFLO_DAEMON_AUTOSTART=0`, `CLAUDE_FLOW_DISABLE_BRIDGE=1` (no AgentDB mirror, no `./ruvector.db`, no MiniLM download) and `CLAUDE_FLOW_MEMORY_PATH=$HOME/.cache/ruflo/memory` (ruflo's sql.js bookkeeping outside any repository). `claude-flow-mcp`, the ADR-2082 proxy child, passes through unchanged.
3. The gate is unchanged: the wrapper ships only when ruflo does (`toolchains.ruflo`, `toolchains.claude_flow` or `toolchains.ruflo_console`), so a gate-off image is byte-identical (ADR-2020).

## Consequences

- The console's memory pane, `cf-memory`, `aisp/init-aisp.sh` and any agent that types `ruflo memory store` all write to and read from the sidecar through the GPU embedder; there is one memory system. The cost is that ruflo's local-only memory verbs are gone from this image, and anything that needs them (a ruflo memory export, its distillation operators) must be done against the sidecar's own tooling instead.
- Disabling the AgentDB bridge is a behaviour change for the real CLI's non-memory paths (hooks, the proxy's swarm child): they keep sql.js and lose the AgentDB vector mirror. Memory tools never cross the proxy (ADR-2082), so no governed consumer is affected; an operator can re-enable it with `CLAUDE_FLOW_DISABLE_BRIDGE=0` for one invocation.
- The CLI is a second consumer of `lib/memory-tools.js`. A change to that library's contract must keep `tests/contract/ruflo-memory-cli.contract.spec.js` green alongside the server's suites.
- The review trigger above is the exit: when upstream ruflo can target Postgres and an external embedder natively, the wrapper's `memory` branch becomes configuration and this record is superseded.

## Verification

Live, 2026-10-03, against the running sidecar (213,332 rows, 464 namespaces, ruvector-postgres 0.3.0, Xinference bge-small-en-v1.5): `stats --format json` and `list --format json --limit 3` returned the governed corpus in the ruflo shapes; `search -q … -n project-state` returned HNSW results at 0.795 and 0.776 via `hnsw-xinference`; a `store` in namespace `cli-probe` embedded, was found by `search` at 0.769, was returned by `retrieve` and removed by `delete`; `init`, `configure` exit 2 with no file created; `git status` clean apart from the new file. Static and stub-backed: `tests/config/ruflo-memory-governed.test.sh` (wrapper, gate, env defaults, refusal list, no shipped `memory init`) and `tests/contract/ruflo-memory-cli.contract.spec.js` (shapes against the captured ruflo 3.51.1 output, refusals, fail-closed, protected-namespace refusal through the governed `memStore`, flag parsing). The baked wrapper itself is verified at the host rebuild (`ruflo memory help` prints the governed usage; `ruflo --help` in an empty directory writes nothing).
