# Backlog / Next Steps

> **Combined register (2026-07-22):** this backlog and the VisionClaw remediation
> ladder now share a single unified TODO with a six-state unblock taxonomy:
> `../../../docs/TODO-unified.md` (governed by PRD-024 / ADR-133). Entries below
> remain authoritative for agentbox detail; the unified register is the
> cross-repo view the final-mile sprint works from.

Living document for known gaps and deferred decisions. Each entry carries the
date it was identified and what unblocks it. Remove entries when done; move
decisions into an ADR when they become architectural.

## Open TODOs

_Both prior entries resolved and reviewed into the unified register 2026-08-31 —
kept here struck-through for agentbox-local history._

### ~~tree-search-coder implementation missing~~ **DONE 2026-08-31** (register C-4)

Authored per ADR-020 Surface 2: `skills/tree-search-coder/SKILL.md` + 4 references
(execution-gated best-of-N, `spend_cap_usd` halt, audit JSONL); registered in
SKILL-DIRECTORY, schema, `agentbox.toml`, `system-manifest.js`. Validators green.

### ~~memory_learning consumers — corpus-gated~~ **PARTIAL** (register D-1)

Floor cleared (78 aggregates ≥20); `feed_retrieval = true` applied 2026-08-31,
recall gate re-run PASS. Remaining: observation window, then flip `feed_routing`.
Tracked as D-1 in `../../../docs/TODO-unified.md`.

## Deferred operator decisions (held 2026-07-05)

Deliberately not enabled during the capability-matrix session; each is a
posture/exposure choice, not a technical gap:

| Surface | Flags | Consideration |
|---|---|---|
| Relay exposure | `sovereign_mesh.relay.expose` | Opens nostr relay beyond loopback; populate `allowed_pubkeys` first (W039) |
| Mobile bridge | `sovereign_mesh.mobile_bridge.enabled` | Requires relay exposure + phone npub in allowlist |
| Multi-user | `sovereign_mesh.multi_user`, `per_user_agents` | Multiple DIDs on one box |
| Git pods / gateway | `sovereign_mesh.git.read_public`, `networking.host_gateway` | Unauthenticated clone; container→host network |
| Payments | `payments.consumer`, `payments.broadcast.*`, `skills.payment_router` | Enable when a concrete counterparty exists |
| Solid OIDC | `enable_oidc` (+ `enable_dpop_cache`, E033-coupled) | Needs an OIDC issuer decision |
| Pod MCP surface | `integrations.solid_pod_rs.enable_mcp` | Exposes the pod as 16 MCP tools |
| Kernel pip | `skills.code_interpreter.allow_pip_install` | Allowlist-bound installs vs. fully sealed kernel |

## External blockers

| Capability | Flag(s) | Blocked on |
|---|---|---|
| ComfyUI | `integrations.comfyui_external` / `skills.media.comfyui_builtin` | No ComfyUI service on `visionclaw_network` (builtin also needs a heavy image rebuild + source hash) |
| KG elevation / ontology axioms | `sovereign_mesh.kg_elevation`, `skills.ontology.direct_axiom_load` | `visionclaw-server:4000` unreachable |
| Ollama sidecar | `providers.ollama.sidecar` | Confirm whether host ollama on :11434 exists; sidecar off is correct while it does |
| Nagual QE | `toolchains.nagual_qe` | Upstream sqlx 0.9 `SqlSafeStr` compilation error |

## Minor follow-ups

_None currently — see below for the two items closed on 2026-07-22._

## Done

- ~~`scripts/ruvector-sidecar-update.sh` backfill-embeddings curls Xinference
  from the host, where the compose DNS name `xinference:9997` does not
  resolve~~ — fixed 2026-07-22: `XINFERENCE_ENDPOINT` now defaults to
  `http://localhost:9997` when `getent hosts xinference` fails (host-side
  invocation), `http://xinference:9997` otherwise; an explicit
  `XINFERENCE_ENDPOINT` env var always wins.
- ~~GitHub enrichment blocked on `GITHUB_TOKEN` unset~~ — cleared 2026-07-22:
  a valid token (validated HTTP 200 against api.github.com) is present in the
  runtime env and `.env` (0600); `[project_tracking].github_enrichment = true`,
  applies at next boot. Note: the token is a broad-scope classic PAT
  (admin:org/repo/workflow) — consider swapping for a fine-grained read-only
  PAT scoped to issues+metadata.
- ~~`docs/user/browser.md` names a linked-data viewer doc, not browser
  automation~~ — fixed 2026-07-22: content moved to
  `docs/user/linked-object-viewer.md`; `browser.md` is now a short redirect
  stub (kept because existing links point at it); `docs/README.md` and
  `README.md` updated to link the new filename.
