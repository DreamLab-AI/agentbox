# Backlog / Next Steps

Living document for known gaps and deferred decisions. Each entry carries the
date it was identified and what unblocks it. Remove entries when done; move
decisions into an ADR when they become architectural.

## Open TODOs

### tree-search-coder implementation missing (identified 2026-07-05)

`[skills.tree_search_coder].enabled = true` in the manifest and the flake bakes
`ENABLE_TREE_SEARCH_CODER=true` into the supervisor environment, but nothing
consumes it: `skills/tree-search-coder/` (SKILL.md + implementation) has never
been authored. The gate is armed but inert.

Next steps:
1. Author the skill per ADR-020 §tree-search / PRD-008 §3.3: N candidates,
   each executed in a fresh code-interpreter kernel, scored by assertion pass;
   respect the existing manifest tunables (`max_candidates = 5`,
   `per_branch_timeout_s = 60`, `spend_cap_usd = 0.50`).
2. Add a phase-6 closure probe (or entrypoint check) if the implementation
   ships as an npm/python closure — follow the `mcp/aci-shell` makeNpmService
   pattern (pinned deps, lockfile, `npmDepsHash`, appRoot overlay).
3. Until then the gate may stay on (harmless) — or flip it off if manifest
   honesty is preferred over readiness.

### memory_learning consumers — corpus-gated (expected, not a defect)

`feed_retrieval` / `feed_routing` stay `false` until the trajectory corpus
clears the Wilson floor (`aggregate_min_samples = 20` per action pattern).
Recording started 2026-07-05. Next steps once samples accumulate:
1. `./agentbox.sh ruvector aggregate-effectiveness` (dry-run first).
2. Flip `feed_retrieval = true`, restart, observe re-ranking quality.
3. Then `feed_routing = true` for advisory [INTELLIGENCE] hints.

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
| GitHub enrichment | `project_tracking.github_enrichment` | `GITHUB_TOKEN` unset |
| Ollama sidecar | `providers.ollama.sidecar` | Confirm whether host ollama on :11434 exists; sidecar off is correct while it does |
| Nagual QE | `toolchains.nagual_qe` | Upstream sqlx 0.9 `SqlSafeStr` compilation error |

## Minor follow-ups

- `scripts/ruvector-sidecar-update.sh` backfill-embeddings curls Xinference from
  the host, where the compose DNS name `xinference:9997` does not resolve —
  the 2026-07-05 run needed `XINFERENCE_ENDPOINT=http://localhost:9997`.
  Default the endpoint to localhost when running host-side (or docker-exec the
  curl) so quarantining doesn't trigger spuriously.
- `docs/user/browser.md` names a linked-data viewer doc, not browser
  automation (banner added 2026-07-05); consider renaming to
  `linked-object-viewer.md` with a redirect stub to kill the collision.
