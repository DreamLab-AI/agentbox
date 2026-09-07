# Backlog / Next Steps

> **Combined register (2026-07-22, reconciled 2026-09-06):** this backlog and the
> host project's remediation ladder share a single unified TODO with a six-state
> unblock taxonomy, the host repo's `docs/TODO-unified.md` (governed by PRD-024 /
> ADR-133). Entries below remain authoritative for agentbox detail; the unified
> register is the cross-repo view the final-mile sprint works from. The
> 2026-09-01..06 sprint closed M-1, M-6, G-3 and G-9 there; the agentbox-owned
> residue is recorded below.

Living document for known gaps and deferred decisions. Each entry carries the
date it was identified and what unblocks it. Remove entries when done; move
decisions into an ADR when they become architectural.

## Open TODOs

_The two 2026-08-31 entries are resolved and reviewed into the unified register;
they are kept here struck-through for agentbox-local history. The entries below
them were opened by the 2026-09-01..06 sprint reconciliation._

### ~~tree-search-coder implementation missing~~ **DONE 2026-08-31** (register C-4)

Authored per ADR-020 Surface 2: `skills/tree-search-coder/SKILL.md` + 4 references
(execution-gated best-of-N, `spend_cap_usd` halt, audit JSONL); registered in
SKILL-DIRECTORY, schema, `agentbox.toml`, `system-manifest.js`. Validators green.

### ~~memory_learning consumers, corpus-gated~~ **PARTIAL** (register D-1)

Floor cleared (78 aggregates >=20); `feed_retrieval = true` applied 2026-08-31.
Recall gate re-measured 2026-09-06: **PASS, exit 0**, median self-recall
**189/200** (band >=175), true-recall **115/120** (band >=102), 3 runs at k=10
against corpus `corpus-9992e88f6165` (196,949/196,949 embedded), receipt
`sha256-12-cbccf57f8d35`, artifact
`backups/ruvector-sidecar/recall-runs/2026-09-06T08-55-47-514Z.json`. This
confirms `fa024cc08` and supersedes the closeout addendum's 164/200 + 96/120
FAIL, which measured the index before the serial HNSW rebuild landed. Remaining:
the observation-window length is still undefined at `docs/LEARNING-memory.md:169`;
define it, then flip `feed_routing` (`agentbox.toml:418`, still `false`).
Tracked as D-1 in `../../../docs/TODO-unified.md`.

### Publisher-key split not performed (register G-5)

Identified 2026-09-06. `agentbox.toml:117` `[sovereign_mesh.operator].pubkey_hex`
still carries the shared visionclaw-server key. `services/secret-backup`
(ADR-2027, commit `7905d2a64`) supplies age-encrypted custody and rotation
tooling, so what is missing is the split itself, not the tool. Unblocks when the
M-3 rebuild bakes a distinct operator key.

### `services/secret-backup` is outside the reproducible build (register G-17)

Identified 2026-09-06. The crate is built and tested but `grep -c secret-backup
flake.nix` returns 0, so a real custody capability is not part of `nix build
.#runtime`. Unblocks when the service is wired into `flake.nix` alongside the
other sovereign-mesh services.

### Agent-DID mint still fail-open at the entrypoint (register G-6)

Identified 2026-09-06, half resolved. `management-api/lib/agent-identity.js`
`mint` now fails closed with a non-zero exit (ADR-2044). But
`config/entrypoint-unified.sh:902,922` still preserves
`AGENTBOX_AGENT_DID="${AGENTBOX_AGENT_DID:-did:nostr:local}"` on a failed or
invalid mint, so boot continues with a placeholder DID. Unblocks when the
entrypoint aborts instead of defaulting.

### ~~solid-pod-rs pin skew between Nix and the bridge~~ **DONE 2026-09-06** (register G-20)

Resolved with the solid-pod-rs `v0.5.0-alpha.9` release (`1d9da527`, all eight
crates published to crates.io at that version). `lib/solid-pod-rs.nix` and
`lib/nostr-pod-bridge.nix` now pin the same tag commit and SRI hash, the vendored
`lib/solid-pod-rs.cargo-lock` is the tag's own lockfile, and
`services/nostr-pod-bridge/Cargo.lock` resolves `solid-pod-rs-nostr 0.5.0-alpha.9`;
the path dependency and the Nix build therefore compile one snapshot. Superseded
registry versions (`alpha.8` root, `alpha.7` siblings) yanked once this pin landed.

### ADR record status lags shipped code (register G-4, DOC-4)

Identified 2026-09-06, both governance-only. ADR-2026: the session-mirror
redaction it governs is live (`config/hooks/nostr-live-mirror.cjs` runs
`redactForEgress(body)` and fails closed on null, commit `11804ba4b`), but the
record is still `proposed`/`inactive` and a stale "fail-open everywhere"
doc-comment survives nearby. ADR-2002 (AoE token auth boundary): picked up a
fresh `verified_commit` (`796d85fcf`) this sprint but is still
`activation_status: staged` while AoE actually runs `--auth token`; flip to
active and reconcile with AB-2009.

## Deferred operator decisions (held 2026-07-05)

Deliberately not enabled during the capability-matrix session; each is a
posture/exposure choice, not a technical gap. All 8 re-confirmed unchanged
2026-09-06 (register T-4). Solid OIDC gained context but not a decision:
solid-pod-rs `40f160c` adds an OIDC compat matrix and its own ADR-2003
"defer LWS-1.0", which documents why the issuer stays deferred rather than
un-deferring it.

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
| KG elevation / ontology axioms | `sovereign_mesh.kg_elevation`, `skills.ontology.direct_axiom_load` | `visionclaw-server:4000` unreachable. **Register gap closed 2026-09-06:** carried in this table since 2026-07 with no counterpart in the unified register; now tracked there as **E-5** |
| Ollama sidecar | `providers.ollama.sidecar` | Confirm whether host ollama on :11434 exists; sidecar off is correct while it does |
| Nagual QE | `toolchains.nagual_qe` | Upstream sqlx 0.9 `SqlSafeStr` compilation error |

## Minor follow-ups

_None currently; see below for the two items closed on 2026-07-22._

## Done

- ~~`scripts/ruvector-sidecar-update.sh` backfill-embeddings curls Xinference
  from the host, where the compose DNS name `xinference:9997` does not
  resolve~~ (fixed 2026-07-22): `XINFERENCE_ENDPOINT` now defaults to
  `http://localhost:9997` when `getent hosts xinference` fails (host-side
  invocation), `http://xinference:9997` otherwise; an explicit
  `XINFERENCE_ENDPOINT` env var always wins.
- ~~GitHub enrichment blocked on `GITHUB_TOKEN` unset~~ (cleared 2026-07-22):
  a valid token (validated HTTP 200 against api.github.com) is present in the
  runtime env and `.env` (0600); `[project_tracking].github_enrichment = true`,
  applies at next boot. Note: the token is a broad-scope classic PAT
  (admin:org/repo/workflow); consider swapping for a fine-grained read-only
  PAT scoped to issues+metadata.
- ~~`docs/user/browser.md` names a linked-data viewer doc, not browser
  automation~~ (fixed 2026-07-22): content moved to
  `docs/user/linked-object-viewer.md`; `browser.md` is now a short redirect
  stub (kept because existing links point at it); `docs/README.md` and
  `README.md` updated to link the new filename.


## Supported profile decision — 2026-09-07 closeout

T-1/T-4 and the M-2 exposure prerequisite are resolved as **retain the existing
closed profile**: relay publication, mobile bridge, multi-user/per-user agents,
public git pods/host gateway, payments, Solid OIDC, pod MCP and kernel pip remain
disabled. No new rail or LAN listener, counterparty, issuer or phone workflow is
selected. Reopening any of these is a new reviewed profile change after publisher
custody and explicit admission/deployment evidence; it is not unfinished work for
this profile. Selected booleans were checked from the tracked manifest on this date.

M-5 reconciliation: existing commit2c521c5bb already materialises
`annexeInclude` repositories through `engine::clone_repo_and_siblings` at their
canonical workspace depth. The symlink/depth/fallback regression passes. Each
archive is its repository HEAD, excluding uncommitted files. This closes the
original standalone clone-layout gap; a completed live sovereign-mesh nightly
receipt remains separate. The HP baseline b5bfc03db includes the layout fix,
but an image rebuild alone is not a completed nightly evaluation.

G-4 recipient enumeration is now enforced before turn text is composed, including
dry-run: absent/empty/malformed lists and unlisted recipients refuse. Twenty-five
isolated tests pass. Activation requires a reviewed explicit recipient set; no
private configuration was read or message sent. External retention/key custody
remain separate from source enforcement.
G-5 still needs a concretely reviewed replacement publisher identity/custody and
allowlist migration; no private key was rotated by this closeout.

G-6 now rejects failed/invalid mint output before consumers start, without eval;
G-17 now packages secret-backup in the flake. These are tested source changes,
not evidence that this running container loaded them. D-1's seven-day evidence
window is defined in LEARNING-memory; routing remains disabled until it passes.
