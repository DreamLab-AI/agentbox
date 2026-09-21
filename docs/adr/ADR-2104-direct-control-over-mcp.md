---
id: ADR-2104
title: A crate is the control surface; an MCP server is a disposable adapter over it
date: 2026-09-21
decision_status: proposed
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit:
verified_paths: [services/agentbox-mcp/src/hub/mod.rs, services/agentbox-mcp/src/main.rs, config/seal-bootstrap.sh, config/entrypoint-unified.sh, flake.nix, tests/config/boot-projection-contract.test.sh]
owner: jjohare
review_trigger: the next hub-routed MCP server observed failing, a request to add a new MCP server to [resources.mcp_hub].servers, or the removal of the last hub-routed server
repo: agentbox
domain: BASELINE-container
lineage: ADR-2034 (resource topology, the shared MCP hub), ADR-2085/2086 (colloquy as crates), ADR-139 (loom-client as the one façade client)
---

# ADR-2104 — A crate is the control surface; an MCP server is a disposable adapter over it

## Context

MCP is a transport that hides failure. The first case, verified 2026-09-21: `[program:agentbox-mcp-hub]`
read `RUNNING` for three days while it had never bound `127.0.0.1:9720`, because it waited 600 s for
`/run/agentbox/mcp-hub.json` under `autorestart=true` and `startsecs=2`. The projection was never written:
the entrypoint died at line 2152 under `set -e` when `_jc_digest` returned 1 for a jev-compaction plugin
cache directory that does not exist on a first install, printing nothing. `bootstrap-seal` waits only for
programs tagged `AGENTBOX_REQUIRED_FOR_READINESS`, so it wrote `bootstrap.done` two minutes earlier and
`/ready` answered 200 over a boot that had skipped the MCP registry projection, the hub projection and the
xinference model load. Nine hub-routed servers refused connections throughout, and of those nine exactly
one has any call site in this repo. Three failures compounded: a program that lies, a sentinel that means
less than it claims, and a set of MCP servers nobody would have missed.

## Decision

**A capability is owned by a Rust crate with a library API and, where a human or a script needs it, a thin
CLI. An MCP server over that crate is a disposable adapter, added only for a harness that cannot call the
crate, and never the control surface.** New work calls the crate in process or spawns its binary. When an
MCP surface is found failing, it is ported to direct control rather than repaired; MCP plumbing gets no
investment beyond making it fail hard.

**Fail hard, not soft.** A supervised program that cannot do its job exits loudly, naming the projection or
the input it lacks, and is wired so supervisord parks it `FATAL` rather than restarting it forever. A boot
that stops says where it stopped. `bootstrap.done` is written only after every projection the manifest
promises exists; a missing one is `BootstrapProjectionMissing` with the gate and the path, no sentinel, and
`/ready` stays 503.

**Port when it fails.** No mass rewrite. Each hub-routed server is ported the first time it breaks or the
first time someone needs it. Until then it stays where it is, and if nothing needs it, it is deleted
instead of ported (dead code is deleted, not ported).

### Inventory: the nine hub-routed servers

`[resources.mcp_hub].servers` in `agentbox.toml`, as re-projected on 2026-09-21 (`converted=2 kept=7`).
"Used by" is `grep` over `skills/`, `config/hooks/`, `agents/` and `docs/` excluding `docs/archive/`, for
the server's `mcp__<name>__` tool prefix — the only form a model can actually call.

| Server | Call sites (`mcp__…__`) | Direct replacement | Order |
|---|---|---|---|
| `consultant-deepseek` | 10, all in `skills/deepseek-reasoning/references/workflows.md` | new thin crate `consultant-client` over the OpenAI-compatible wire, same shape as `loom-client`; the skill calls its CLI | 1 — the only one with call sites |
| `consultant-codex` | 0 | same crate, one more provider row | 2 |
| `consultant-perplexity` | 0 | same crate | 2 |
| `consultant-antigravity` | 0 | same crate | 2 |
| `perplexity` | 0 (vendor `@perplexity-ai/mcp-server`) | `consultant-client` provider row; retire the vendor server | 2 |
| `web-researcher` | 0 (`skills/web-researcher/` describes it in prose) | `web-researcher-mcp` is already our binary — expose its search path as a library crate + CLI and call that | 3 |
| `ruvnet-brain` | 0; the live consumer `config/hooks/ruvnet-brain-ground.cjs` is self-contained and calls no MCP | `ruvnet-kb` is a RuVector namespace: query it through the governed memory path, not a bespoke server | 3 |
| `ontology-bridge` | 0 | `loom-client` already owns façade traffic (ADR-139); the ontology surface follows it | 4 |
| `harness-bridge` | 0 | `agentbox-manifest` already owns config projection; template reads are a file read | 4 |

Eight of the nine have no call site. The honest first move for most of this table is deletion from
`[resources.mcp_hub].servers`, not a port.

### What stays MCP

`codebase-memory` and the RuVector memory server (`ruvector-mcp.cjs`, reached through `claude-flow`) stay.
Both are external, working daemons that a Claude Code session must reach as tools for the model itself to
use, and memory access is mandated MCP-only so the embedding pipeline is not bypassed. Neither is
hub-routed. `colloquy-mcp` is already the shape this ADR asks for: a binary over `colloquy-core`, deletable
without losing the capability.

## Consequences

- A hub with no config now exits after 120 s with an `ERROR` naming `agentbox-manifest mcp-hub-project` and
  `[resources.mcp_hub]`; `startsecs=130` with `startretries=2` makes that a failed *start*, so supervisord
  parks it `FATAL` instead of restarting it forever. `supervisorctl status` stops lying.
- `bootstrap.done` is stricter: a promised projection that never appears keeps `/ready` at 503 forever
  rather than declaring success. That is the intended trade — a visible dead container beats a healthy
  looking one with a third of its boot missing.
- The boot announces its own death: an `ERR` trap prints `[bootstrap] ABORTED rc=… at line … — command: …`
  to `/var/log/bootstrap.log`.
- Adding an MCP server now needs a reason that a crate plus CLI cannot meet, stated in the change.
- Follow-on: the `consultant-client` crate (order 1), then a manifest change deleting the servers with no
  call sites. Neither is done here.

## Verification

`implementation_status: partial` covers the fail-hard half only; no server has been ported yet.

- `cargo test` in `services/agentbox-mcp`: 77 passed, 0 failed. `cargo clippy --all-targets -- -D warnings`
  clean. `cargo fmt --check` reports one pre-existing diff in `src/web_summary/llm.rs`, untouched here.
- Fail-hard behaviour, freshly built binary against an absent config:
  `agentbox-mcp hub --config /run/agentbox/nope.json --wait-config-secs 3` →
  `ERROR … hub config MISSING: the boot never ran the mcp-hub projection …` then exit 1.
- `bash tests/config/boot-projection-contract.test.sh`: 13 passed, 0 failed — gate on + projection present
  writes the sentinel, gate on + projection missing writes no sentinel and names the gate and path, gate
  off writes the sentinel, the abort announcer names rc and command, and `_jc_digest` on an absent tree is
  empty rather than boot-ending.
- Live recovery, without a rebuild: `agentbox-manifest mcp-hub-project …` →
  `[mcp-hub] hub on: converted=2 kept=7 restored=0 skipped=0`, then
  `supervisorctl restart agentbox-mcp-hub` → `agentbox-mcp hub starting bind=127.0.0.1:9720 servers=9`
  and `curl 127.0.0.1:9720/health` → `{"ok":true,…}` with all nine listed.
- The supervisor wiring in `flake.nix` takes effect at the next image rebuild; `/etc/supervisord.conf` is a
  read-only `/nix/store` symlink, so it could not be demonstrated in place.
