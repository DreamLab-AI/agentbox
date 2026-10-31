---
id: ADR-2139
title: Treat the System One judge as a vendor slot, measured per consumer, with SubQ Snap as the first alternative to Jev
date: 2026-10-12
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 75378856483d13f952569018421c4526da0aede2
verified_paths: [agentbox.toml, crates/system-one/system-one-proxy/src/server.rs, crates/system-one/system-one-proxy/src/key.rs, services/agentbox-manifest/src/system_one.rs, config/entrypoint-unified.sh, config/hooks/lib/skill-route.cjs, config/seal-bootstrap.sh, lib/system-one-proxy.nix, flake.nix, scripts/agentbox-config-validate.js, agentbox.sh]
owner: jjohare
review_trigger: SubQ Snap leaving public preview or changing its price, retention default or the Decisions request shape; a Kev, Clef or pplx-decider release that serves /v1/systemone on a 9B-class checkpoint; a system-one-eval run on the ADR-2089 corpus that moves any backend by more than 5 points; the first compaction replay whose keep-rate is above 5%
repo: agentbox
---

# ADR-2139 — Treat the System One judge as a vendor slot, measured per consumer, with SubQ Snap as the first alternative to Jev

## Scoped re-verification — 2026-10-31

Reviewed the governed-path delta since the previous verification: only the
operator user-cron gate, devuser supervisor block, rebuild-class catalogue entry
and its boolean schema registration changed. Existing capability, identity,
storage and network contracts are unchanged. Preflight, manifest validation,
25 role-isolation supervisor checks and the user-cron schema regression pass.
This does not promote any activation status or claim a live role-isolation rehearsal.

## Re-verification — 2026-10-29 at 3b498088e (ADR-2153 cutover)

Reviewed the governed-path diff from this record's previous verification to
`3b498088e5a35e78158a9eb8d6f0266996d31f82`. Shared manifest, schema, supervisor and bootstrap changes
are scoped to the owned session plane: AoE and its token consumers retire,
provider provisioning moves, and session status hooks are added. Other named
capability sections and their status axes retain their existing claims.
Validation: session-plane tests (44 unit, 15 integration), manifest projector
suite and Clippy for both crates, proxy selftest (zero failures/skips), hook
registration (12), role-supervisor isolation (25), boot projection (13), and
manifest catalogue/declared-state checks pass locally. This does not claim new
runtime acceptance of this record's unrelated capabilities.

## Re-verification — 2026-10-15

The only changed hunk in the governed agentbox.sh adds `security` to the subcommand allowlist (ER-14); its existing scanner dispatch is unchanged. CLI regression checks pass, and all 23 runtime-delivery tests pass. Instruction projection, executable volumes, image evidence and vendor routing are unchanged.
Source anchor: `df584b3fd`. Existing status axes and deferred work remain unchanged.


## Context

Three consumers put typed decisions to TypeSafe's Jev: the skill router (ADR-2091), factrail
compaction (ADR-2093/2121) and the advisor checkpoints (ADR-2135). ADR-2094 built a local façade
behind the same wire and measured laya at 53.5% on the 86-case routing corpus against Jev's 93.0%;
openjev reached 88.4% at p50 4.9 s (ADR-2095 addendum). Since then the wire has become a de-facto
standard: Hugging Face `transformers serve` ships `/v1/systemone`, Kev serves it natively on
Qwen3.5 adapters, and Subquadratic's SubQ Snap (`subq-snap-preview`, public preview) serves it
hosted with images and a claimed 384K context. The estate's HP model container runs
`llama-server` 0.3.0-dev, not `transformers serve`, and answers 404 on the route. Every
consumer but the checkpoints plugin sends the TypeSafe key to whatever endpoint it is given;
the checkpoints plugin sends it only to `*.typesafe.ai`.

## Decision

1. **The judge is a vendor slot behind one loopback proxy.** `[system_one]` names the active
   `backend` out of `[system_one.backends.*]` (shipped: `typesafe`, `subq`, `laya` = the ADR-2094
   façade, `kev` = a local Kev-9B server), each with `url`, `model`, `key_env`, declared `local`,
   `timeout_ms` and `usd_per_mtok_in`. `system-one-proxy` (`crates/system-one/system-one-proxy`,
   `[program:system-one-proxy]`, `127.0.0.1:8094`) is what all three consumers call; it forwards
   `POST /v1/systemone`, overwrites `model` with the backend's own, drops the consumer's
   Authorization and attaches the backend's key. The proxy's only configuration is
   `/run/agentbox/system-one.json`, written by `agentbox-manifest system-one-project` at boot and
   rewritten in place by `./agentbox.sh systemone backend <name>`; it re-reads on change, so a
   same-class switch is live without a restart. `[features.sovereign_system_one]` and
   `[system_one]` are mutually exclusive projectors (E081).
2. **Keys go only to their paired host.** A key is read from the env var the backend names
   (`<NAME>_FILE` first), sent only when the backend is not local, the URL is https and its host is
   in the proxy's hard-coded allowlist for that variable (`typesafe.ai`, `subq.ai`), with redirects
   off; a local backend is keyless by rule and must sit on a LAN/loopback host. Both keys stay
   devuser-class under custody Q8 (the proxy runs as devuser like its consumers). The
   checkpoints plugin's `isTypeSafeApi` guard stays: behind the proxy it simply sends nothing.
3. **Locality class is boot-class; vendor within a class is live.** `backendLocal` is projected to
   the consumers at boot from the selected backend's declared `local` and cannot change until the
   container restarts, so the projector refuses a live local→cloud switch and the proxy answers
   503 `backend_locality_changed` if the file ever says so; cloud→local only over-blocks and is
   allowed. The projector records `projected_local` in the file so a proxy restart cannot
   re-baseline it (the advisor's finding on the first draft).
4. **Running backend: subq, by measurement.** Measured 2026-10-12 (receipts below): SubQ Snap is
   at parity with Jev 1.13.0 on routing and on the recorded compaction judgements, 130 ms slower
   at p50, 11% fewer tokens, 5% dearer per route. The operator chose to run SubQ across the
   estate for a period and judge it on the proxy's request log and `/v1/backend`; `typesafe`
   stays configured one switch away. A vendor is adopted for a consumer only on a
   `system-one-eval` run or a decision-log replay against the incumbent on the same cases.
5. **SubQ is the only backend that accepts a compaction state whole.** factrail fits transcripts
   into 25,000 tokens through six shrink stages because Jev's budget is ~32K. SubQ accepted a
   73,612-token state in 1.5 s. The shrink stages stay (they are what makes the fallback honest)
   but the vendor slot carries a `state_budget_tokens` so factrail can stop shrinking early on a
   backend that does not need it. Whether that changes what compaction keeps is the first thing to
   measure after a switch, because the ADR-2094 threshold-drift consequence applies in reverse.
6. **Images are a new question class, not a new consumer.** SubQ's `images` field (≤ 4, raw
   base64) answered a colour Choice and a blankness Noul correctly on a generated PNG. The first
   consumer for it is the browser skill's screenshot checks, which today go to a frontier model;
   it is a candidate in `estate-integration.md`, not wired.
7. **Egress widens by one vendor and no further.** SubQ's default retention is *retain
   indefinitely*; zero-data-retention is per-organisation on request and leaves the Decisions
   endpoint unaffected. **ZDR is requested and confirmed before SubQ becomes a default for any
   consumer.** The email fence, the no-tool-result rule and the must-not-leave classes
   (`skills/system-one/references/data-boundary.md`) apply to SubQ exactly as to TypeSafe.
8. **The local engine candidates are re-ranked.** laya stays the measured floor. Kev-9B is the
   next engine to measure behind the ADR-2094 door because it serves the route natively, scores
   up to 255 options against a 65K state, and fits the free Ada card (~17 GB). `transformers
   serve` is not a routing candidate: its hard cap of 26 options per question cannot see the
   118-skill corpus without the façade shortlist, and it cannot serve the custom decision heads
   the strongest open checkpoints carry. Kev-9B measured 2026-10-12 (table below): 3.5 points
   under Jev on the same run and inside the ADR-2095 noise, with `none` precision of 100%, but
   7.6 s per route as served here (bf16, 117 options scored as independent rows, no
   flash-linear-attention), which is over the router's 4 s budget and inside factrail's 15 s. It is
   therefore a candidate local backend for **compaction**, not routing, until the serving path is
   tuned; it is configured as the `kev` backend and today runs interim from a session scratchpad,
   not a durable service. The strongest open-weights model on the independent
   Decision Index (pplx-decider v1.1, Qwen3.8-27B, Apache-2.0, 62.75 vs Jev 60.11) needs the HP
   card the Loom model already fills and speaks `/v1/decisions`, so it waits on an adapter and a
   second 27B slot.

### Review hardening (2026-10-12, Opus review of the staged diff)

- **URL grammar is strict, not parsed.** `strict_host` (proxy `config.rs`, manifest `sso.rs`) accepts only `scheme://host[:port]` with a DNS name, four plain decimal octets or a bracketed IPv6 literal. Userinfo, backslashes, octal/hex/short/dotless IPv4 spellings are refused outright, because a WHATWG parser (reqwest) reads `https://evil.com\@api.subq.ai/` as evil.com while a naive split reads api.subq.ai. The key pairing and the locality rule both sit on this grammar, so the host that is checked is the host that is dialled.
- **No blind switch.** `systemone backend <name>` refuses without a readable, enabled projection: the file carries `projected_local`, and deleting it must not re-baseline the ADR-2094 §5 fence.
- **An unusable slot writes a disabled stub.** Boot writes `{"enabled":false,"reason":…}` when the gate is on but the projection fails; the proxy prints one line and exits 0 (the serve-identity contract), the seal promise holds, the consumers fall back to `sso-project`.
- **Honest persistence.** A live switch edits the checkout's manifest; boot projects from the baked `/etc/agentbox.toml`, so a restart reverts until the next rebuild. The CLI now says so.

## Consequences

- One more cloud vendor holds routing prompts and compaction transcripts. Nothing private is sent
  that is not already sent to TypeSafe, but it is sent to two companies instead of one once the
  slot is switched, and SubQ's retention default is worse until ZDR is confirmed.
- The consumers' own key gates stand. The router is keyless behind the proxy
  (`AGENTBOX_SYSTEM_ONE_PROXY=1`, inlined in its hook command); factrail (pinned external) still
  requires `TYPESAFE_API_KEY` or `FACTRAIL_API_KEY` to be *present* for a non-local backend even
  though the proxy drops it, and the checkpoints plugin proceeds keyless to a non-TypeSafe host.
  `usdPerMTokIn` is projected at boot, so a consumer's cost line goes stale after a live switch;
  `/v1/backend` is the live figure.
- Staged for the next rebuild: `lib/system-one-proxy.nix`, the supervisor stanza and the seal
  promise are baked text. Until then the proxy runs interim under tmux from a cargo build at the
  path supervisor will use, and the plugins' userConfig was reinstalled once by hand with the
  projection the entrypoint will produce (one-off, recorded in the session log, not a script, to
  avoid a second copy of the entrypoint's install logic).
- `jev-latest` resolved to `jev-1.13.0` on 2026-10-12; TypeSafe's own model moved under the
  alias. Every number below is pinned to that version and to `subq-snap-preview` as served that
  day. A preview model can change without notice, which is why §2 makes re-measurement the switch
  condition rather than this table.
- The compaction parity figure is weaker than it reads. All 466 replayed nouls fell below the 0.5
  keep threshold on both judges (keep-rate 0.2%), so threshold agreement is total but says nothing
  about the positive class; Pearson r on the raw probabilities is 0.587 and SubQ is systematically
  lower (mean 0.075 vs 0.213). A replay with recorded keeps is the review trigger.
- Skill-routing is now a three-way tie within noise (Jev 93.0, SubQ 93.0, openjev 88.4 at p=0.39).
  The remaining differentiators are latency, locality and price, not accuracy, and the corpus is
  self-authored (ADR-2095). The next accuracy gain comes from a better corpus, not a better judge.

## Verification

Measured 2026-10-12 from this container, receipts in the session scratchpad and summarised here.
`implementation_status: partial`: the slot, proxy, projector, validator, router flag and docs are
in the tree with unit, contract and router tests; the baked program and seal promise apply on
the next rebuild. Not done: a SubQ fixture in `tests/system-one/consumer-compat.test.mjs`, the
a durable home for the Kev server (it runs from a session scratchpad under nohup), and ZDR confirmation from Subquadratic.

| Measurement | Jev 1.13.0 | SubQ Snap preview |
|---|---|---|
| `system-one-eval parity`, 86 cases, 118 options + none | 93.0% (80/86), soft 100% | 93.0% (80/86), soft 100% |
| `none` recall / precision | 100% / 94.1% | 100% / 94.1% |
| late-discriminator subgroup (n=32) | 93.8% | 96.9% |
| boundary subgroup (n=12) | 91.7% | 83.3% |
| latency p50 / p95 | 343 / 446 ms | 474 / 725 ms |
| input tokens per route (engine-reported) | 14,919 | 13,269 |
| cost per route | $0.00063 | $0.00066 |
| case agreement | 81/86 (94.2%); 2 right only for each | |
| factrail replay, 3 sessions, 7 requests, 466 nouls | recorded | agreement@0.5 466/466; r 0.587; p50 1.31 s; 171,605 tokens, $0.0086 |
| 73,612-token compaction-shaped state | not sent (over budget) | HTTP 200 in 1.53 s; planted fact noul 0.795, noise 0.041 |
| 64×64 solid-red PNG, Choice colour + Noul blank | unsupported | red 0.984, blank 0.979, 0.47 s |
| HP `loom-model` `POST /v1/systemone` | | `llama-server` 0.3.0-dev → 404 |
| Kev-9B (`jaredpalmer/kev-9b`, bf16, RTX 6000 Ada, no flash-linear-attention), same 86 cases, same run as a fresh Jev pass | Jev 91.9% (79/86), p50 333 ms | **88.4%** (76/86), soft 98.8%, `none` recall 93.8% / precision 100%, **p50 7,578 ms**, 13,003 tokens, $0; 77/86 agree, Jev-only 5, Kev-only 2 |

Commands: `crates/system-one/target/release/system-one-eval parity --a-url
https://api.typesafe.ai/v1/systemone --b-url https://api.subq.ai/v1/systemone --b-model
subq-snap-preview --b-usd-per-mtok-in 0.05`; the replay and image probes are the Python in the
session scratchpad (`factrail-replay-subq.json`, `img.json`, `long.json`).

Request metadata logs rotate at 10 MiB and retain three archives; daemon stdout and stderr use the bounded supervisor logs. Host operator commands delegate through the inspected project mount to container loopback.

## Amendment — 2026-10-13 at `044f1d689` (`state_budget_tokens` is planned, not implemented)

Decision 5 says the vendor slot "carries a `state_budget_tokens` so factrail can stop shrinking early". It does not. The string occurs nowhere in the code or manifest: not in `[system_one.backends.*]`, `agentbox-manifest system-one-project`, `system-one-proxy` or the validator, and factrail (a pinned external) is not told a per-backend state budget. The field is **planned and unimplemented**; `implementation_status: partial` already covers it. The measured fact stands (SubQ accepted a 73,612-token state in 1.5 s), and factrail's six shrink stages still run to their 25,000-token budget on every backend. Adding the field needs a `state_budget_tokens` key on each backend, a projection into the factrail userConfig, and a factrail release that reads it.

The other claims checked hold. Not re-checked: the vendor measurement figures, retention and ZDR status, and the Syft/Grype interoperability numbers (`syft` and `grype` are not on this container's path). Two unrelated drifts were noticed and left alone: `E080` is used in the validator for both the ADR-2138 relative-path check and the System One checks, and the `agentbox.toml:823-825` comment gives `E081` the wrong meaning (the validator and the ADR are right).

Checked at `218dc12c3` by reading each claim against the code, not by the staleness diff alone. Stamped at `044f1d689`, which adds only the gate fixes in `config/custody/env-classes.json`, the `check-manifest-catalogue` baseline, `services/agentbox-vex`'s README and licence notice, a stale `agentbox.toml` comment, a stale `paths` example in the ontology-augment docs, and the grounding test's stub.

**Re-verified 2026-10-16 at `efa293b8799b`.** The only change to a governed path is the sidecar-first Blender work (ADR-2142): `agentbox.toml` gains `[skills.spatial_and_3d].blender_local = false`; `flake.nix` narrows one `lib.optionals` condition (`wrapGpuBin pkgs.blender` now needs `blender && blender_local`), adds one `ENABLE_BLENDER_LOCAL` env line and reworks a comment; `schema/agentbox.toml.schema.json` gains the `blender_local` boolean; `management-api/lib/system-manifest.js` gains a `blender-local` catalogue entry and a corrected `blender-mcp` summary. `[system_one]` is untouched. The decision holds. Re-verified by `git diff <previous verified_commit>..efa293b8799b -- <verified_paths>`; no re-implementation was needed.

**Re-verified 2026-10-17 at `e8d59c23c`.** The only change on a governed path since the previous verification is the flat-vault pages default (agentbox `a2c6d5520`, ADR-2028 amendment; Ontomark ADR-OM-007): `[vault].pages = "."` in `agentbox.toml` and the default manifest, the schema default and description for that key, the entrypoint deriving `VAULT_PAGES`/`VAULT_WORKING_PAGES` from it, and the ontology skills' corpus-verb names (`ontomark find|retrieve|tree`). None of it touches this record's decision. Re-verified by `git diff efa293b87..e8d59c23c -- <verified_paths>`; no re-implementation was needed.

Re-verified 2026-10-17 against `f33c4fc030d199ce957f7ba274d428bc6475c159`: the governed-path delta from the flat-vault amendment is the DeepSeek model/default and MCP metadata refresh plus ownership reconciliation for the OpenCode state directory. The reviewed change preserves this record’s capability, identity, memory, vault and isolation invariants; status axes are unchanged.

Re-verified 2026-10-19 at `dfe78f0766e52ae6cfbae32c395e22c9590d6785`: Reviewed governed-path changes: the flake only repins the vault source; the entrypoint delta corrects the role-isolation class comment; the catalogue makes the baked privilege change rebuild-class. No ingress, retrieval geometry, capability gate, image-delivery or subsystem runtime configuration is changed by those deltas. Existing implementation and activation statuses are retained.

Re-verified 2026-10-19 at `52183d76fde866ab1f05aea524aeea33d8573c3f`: The reviewed flake delta adds the local-cuda-gated stable nvcc link, and the entrypoint/catalogue propagate and describe its scoped host compiler. Backend and wrapper gates pass (23 and 21 assertions); no ingress, role isolation, durable adapter, retrieval or subsystem gate is changed. Image evidence will be regenerated for the new layer closure. Existing status axes are retained.

Re-verified 2026-10-19 at `3acd4fa08f06e2c4543debd46f0ce51605033d3e`: the reviewed delta adds the collaboration and welfare floor (ADR-2144) — one new manifest key `[claude_code].floor`, a floor block and managed-path projection in the entrypoint's instructions and Codex-append sections, two `instructions-project` flags in `agentbox-manifest`, and `config/hooks/decline-recorder.cjs`. No ingress, role isolation, durable adapter, retrieval, skill-routing or compaction mechanism this record governs is changed; its gates pass unchanged. Existing status axes are retained.

Re-verified 2026-10-20 at `61f27d5b375f9838ef7b7334e3f984d0d4a9ea70`: reviewed the governed-path delta for the managed floor (ADR-2144) and alpha.17 forge/proxy launcher (ADR-2145). The schema and capability catalogue now register these settings, with boot-class floor projection and rebuild-class forge/proxy changes. Bridge path dependencies use the same alpha.17 source as the server; the independent core-only registry dependency retains its upstream pin. Claude Code 2.1.304 and Codex 0.163.0 retain the full upstream package resources. Manifest validation, all 94 catalogue gates, 37 targeted Node tests, 12 instruction-layer assertions and skill lint pass. No ingress publication, adapter dispatch, retrieval geometry, mount or role-isolation gate changes. Build and activation evidence is pending; existing status axes are retained.

Re-verified 2026-10-20 at `653b8b6387470eaa3be6c20e6dbd2208e538a985`: reviewed the merged activity-sink registration in the root entrypoint and profile projector, its default-off manifest gate, schema and boot-class catalogue entry. The hook remains inactive; no sink URL, token or new prompt egress is configured. The independent managed floor remains on. Claude Code 2.1.304 and Codex 0.163.0 change pinned CLI resources, not the Jev/factrail hook protocol; their existing replay mechanisms are unchanged. Activity-sink and hook-registration tests pass (50), the Rust projector suite passes (196), manifest validation and all 95 catalogue gates pass, and the generated egress register is in sync. No changed ingress binding, mount, role isolation, retrieval geometry or adapter dispatch. Build and activation checks remain pending. Existing status axes are retained.

Re-verified and deployed 2026-10-20 at `dd6ff7e065a9a2851f7cfa9fa8c71305ce2a8782`: the reviewed flake/Compose delta adds only a root-owned 1 MiB tmpfs at `/etc/claude-code` so boot can project the managed floor on the read-only rootfs. Live file is uid 0, mode 0644, agent-readable and agent-unwritable; the same floor is present in the 13,605-byte Codex instructions. Root and all eight Claude profiles each register the three decline events once. Native pod alpha.17 serves `/forge` (HTTP 200), with testnet policy and zero mirror follows/announce relays; activity sink remains off. Readiness has no degradation, 32 persistent mounts are unchanged, and the other 17 containers are unchanged (speech-to-text was separately rebuilt for its tested marker-ordering fix). The image SBOM/VEX evidence was regenerated for the shipped image; this does not claim an online vulnerability scan or cover the host and sidecars. Existing decision and status axes are retained unless the record explicitly states activation below.


## Re-verification — 2026-10-21

The manifest diff only selects minimal thinking and a 20-minute cap for the final deepsec sweep; feature gates, identity policy, corpus paths and memory geometry are unchanged. The composition diff refreshes locked package/source versions and the Go compiler for web-researcher. Supervisor blocks, ingress bindings, adapter dispatch and persistent mounts are unchanged. The generated Compose file is byte-identical. Manifest validation, the 95 catalogue gates, 45 agent-reconciliation checks and 25 role-supervisor checks pass. This is source verification; image activation and live checks remain separate deployment evidence.

Re-verified at `c8c20341c66feec751fe6234167c220c70fe2ffb`: the only governed code delta is the REUSE
Sphinx builder string correction. Both documentation outputs and all 872
enabled package tests pass; 23 runtime-delivery checks pass. Runtime
boundaries and activation status are unchanged.

Re-verified at `9173cdba6f0a84556bbd4c059db0a7e823aa7a2d`: the governed delta isolates Typepy 1.3.5
and fixes wrapper arguments for host-only sbomnix. Its dependency suites
pass (834 Typepy, 1682 SimpleSQLite), 23 delivery checks pass, and an actual
shipped-path smoke scan emits CycloneDX, SPDX and CSV. Runtime and activation
contracts remain unchanged.

## Re-verification — 2026-10-21 at 73bd631c0

Reviewed the committed change to the Codex home: the parent tmpfs becomes a
named volume; its package volume and credential bind remain independent. No
supervisor, ingress, toolchain, feature-gate, scanner or instruction-projector
code changes. Compose persistence and runtime-delivery checks pass (24 tests),
Compose refresh checks pass (3 tests), and role-supervisor checks pass (25 tests).
This mount migration is explicitly outside fast activation (ADR-2147).

## Re-verification — 2026-10-21 at 395380f71

Reviewed the committed remote-media change against this record. Nix changes
only the ComfyUI MCP dependency closure and its existing builtin/external gates;
`skills/mcp.json` changes only Blender's declared protocol. Blender's optional
local binary, proxy and background-job safety boundaries remain intact. No
identity, ingress, daemon role, instruction projection, persistent mount, scanner
or vendor-routing behavior changes. Media checks pass: 23 Node tests, 12 graph
client tests and 9 downloader tests. Runtime/Compose checks pass (27 tests),
role-supervisor checks pass (25), skills lint and loopback-port checks pass.
Sidecar image activation is tracked separately in the host deployment receipt.

Re-verified 2026-10-22 at `0382cc4b5e34f75a62184bf350f865533010dc52`: reviewed the delta adding an independent, opt-in Isaac Sim lifecycle and live-class service catalogue entry, the 130th routed skill, pinned regional ComfyUI nodes/model metadata, and Blender background Python failure propagation. Existing ingress, role isolation, instruction projection, durable adapters, retrieval geometry, System One selection and image evidence boundaries are unchanged. Isaac runner/contract (15), GPU picker, launcher selection, Blender bridge (19), role supervisor (25), skill lint and catalogue checks pass. Isaac vendor-image and fixture verification remains staged until executed.

Re-verified 2026-10-23 at `951ada931e235ad45b61b2bef90b7e5c76f8d76c`: flake.nix delta does not touch System One. Re-read at HEAD: `systemOneProxyPkg` import (flake.nix:1888), the `/opt/agentbox/bin/system-one-proxy` link (flake.nix:2129) and `[program:system-one-proxy]` (flake.nix:3054). The CA override and NODE_OPTIONS do not alter the proxy, which is a Rust binary. `bash tests/config/role-isolation-supervisor.test.sh` passes 25/25 in a detached worktree at HEAD. The vendor-slot runtime checks in the review trigger were not run.

### Re-verification — 2026-10-29 (ADR-2154 Pele renderer)

`21769a881..d1dd896f4`: `flake.nix` replaces the `mermaidSidecarCliPkg` shell wrapper with `lib/pele.nix` (`pele-render` and an `mmdc` shim, still gated by `[skills.docs].mermaid`) and puts the two commands in `npmCliGatedPackages` in its place; no other gate, pin or supervisor text changes. Nothing ADR-2139 governs changes meaning. The decision holds. Re-verified by reading `git diff 21769a881..d1dd896f4 -- flake.nix` (new hunks only). Nix was not evaluated here; the image is unverified until the host rebuild.


Re-verified 2026-10-29 at `00039efb1e4a70402df86ad19cf76894fe3b9a8f` for ADR-2155. The original router, factrail and checkpoint consumers retain the selected cloud proxy. New private consumers use the separately validated keyless LAN local_backend directly, never a cloud fallback. The owner explicitly authorised this staged research rollout on 2026-10-29 before accuracy-uplift measurements; this is an exception to the earlier adoption-after-evaluation prerequisite, not an assertion that those measurements passed. No image or service activation is claimed.


Security follow-up re-verified 2026-10-29 at `7d8c3b2dfe165f4ab3f8a5e4f62b8294ea7b155d`: the changed hunks drop privilege before workspace credential writes, replace credentials atomically, reject typed-decision redirects and retain the timeout through response parsing. The stalled-body, planted-symlink and HTTP307 regressions pass. These strengthen the existing boundaries; status axes and activation limits are unchanged. The original Deepsec report remains BLOCK with a separate remediation receipt, not a claimed clean rescan.

## Amendment — 2026-10-29: running backend returned to typesafe

Decision 4's "Running backend: subq" no longer holds. On 2026-10-29 the operator ended the
SubQ period that decision opened and selected `typesafe` (Jev) again, by the mechanism decision 4
names: `./agentbox.sh systemone backend typesafe` live, then `[system_one].backend = "typesafe"`
in `agentbox.toml` (2b5074658) so the next boot projects it. The vendor slot, the declared
backends, the locality fence and the adoption-after-evaluation rule are unchanged; `subq` stays
configured one switch away. Decision 5's whole-state compaction advantage is SubQ's, so on
`typesafe` factrail's shrink stages carry the load again.

Checked at `6ceb22489`: `agentbox-manifest system-one-project --manifest agentbox.toml` projects
`model=jev-latest` and the loopback proxy endpoint for the plugin consumers; a request through
the live proxy after the switch returned HTTP 200 from model `jev-1.14.0`. factrail `d270a0a1`
(pinned at this commit) records the backend and model that actually answered from the proxy's
`x-system-one-backend` / `x-system-one-model` headers, so a later switch is visible in the
decision log without a restart. Not checked: the per-consumer accuracy comparison decision 4
asks for before adoption; this is a return to the incumbent, not an adoption.

## Amendment (2026-10-30): one route for every consumer, served on the private docker network

Operator decision: every System One consumer, in this container and in the host
containers, takes the selected backend (`typesafe`) through this proxy. Local routing
stays wired as an explicit opt-in for private data. Decision 1's "loopback" is relaxed in
one declared case only:

- `[system_one].network = true` lets `bind` be the IPv4 wildcard or an RFC 1918 address
  (`system-one-proxy` `config.rs` `is_network_bind`, mirrored in `agentbox-manifest`
  `system_one.rs`). Without it the proxy and the projector still refuse any non-loopback
  bind. The port is never published (`check-ports-loopback` is unchanged), so the listener
  is reachable only from the docker networks agentbox joins; host containers on
  `visionclaw_network` dial `http://agentbox:8094/v1/systemone`. Consequence the operator
  accepted: any container on those networks can spend the vendor key. Consumers in this
  container still dial loopback (`Projection::endpoint`).
- `[system_one].local_only = []` names the consumers pinned to `local_backend` (the
  keyless LAN route). Empty by default. The projector emits `AGENTBOX_JEV_<X>_LOCAL_ONLY`
  for the twelve agentbox consumers from that list (they were six hard-coded `=1` flags
  plus six literal `localOnly: true` call sites), and for the five external consumers
  stops projecting the laya `_ENDPOINT/_MODEL/_LOCAL` and emits `_ALLOW_CLOUD=1`. A listed
  consumer with no usable local backend is switched off, never sent to the cloud.
  Data-level fences (email taint, private ontology seeds) are unchanged.

Those networks include `browsercontainer`, whose Chrome loads arbitrary pages, and a page
can POST to `agentbox:8094` without a CORS preflight. So `POST /v1/systemone` refuses with
403, before any upstream call, any request carrying `Origin` (every browser sends it on a
cross-origin POST, `null` included) or a content type other than `application/json`
(`server.rs` `browser_shaped`; test `browser_shaped_requests_are_refused_before_any_upstream_call`).
Consumers (reqwest, curl, Node fetch) send neither. Checked before the fix: a text/plain POST
and an Origin-bearing POST were both forwarded.

Because the proxy rewrites `model` to the active backend's (checked: a request naming a
bogus model returned `jev-1.14.0`), one backend switch now reroutes every consumer.

Re-verified 2026-10-30 at `29a4b4939`: the amendment of 2026-10-30 above is this change (network-declared bind, local_only list, projection of every consumer to the selected backend); proxy 16 tests, agentbox-manifest 205 tests.

Re-verified 2026-10-30 at `59589fb3f`: server.rs gains `browser_shaped` (403 for an Origin header or a non-JSON content type, before any upstream call; recorded in the amendment above) and replaces a manual checked division with `checked_div` in the metrics mean. 17 proxy tests, clippy -D warnings clean. `check-ports-loopback` records the proxy as a sanctioned docker-network listener.

Re-verified 2026-10-30 at `cd3a29899`: agentbox-config-validate.js E080 now admits a private bind only with network = true, mirroring the proxy and projector (ADR-2139 amendment 2026-10-30); the shipped manifest validates.

Re-verified 2026-10-30 at d0e9ca786: adds `[system_one].skill_list_at_least` (0..=1, shipped 0.6). The projector exports AGENTBOX_JEV_SKILL_LIST_AT_LEAST only with consumers.skill_verify on and warns on an out-of-range value; it tunes how many runner-up skills the router lists and changes no route, backend or locality claim here.

Re-verified 2026-10-31 at `b65c3d4ed`. Governed paths changed: `agentbox.toml`: comments only: corpus verbs named as `ontomark`, flat-layout wording (`f4beec643`, `7aa9365d4`); `config/entrypoint-unified.sh`: the `ONTOLOGY_PAGES_DIR` / `AGENTBOX_VAULT_LEGACY_PATHS` override tier is removed (ADR-2028 re-verification), `ONTO_PAGES` reads `VAULT_PAGES`, and the Phase 5d skip line says "[vault] liveness gate" (`7aa9365d4`); `flake.nix`: the ontomark comment now names the verbs it owns (`4a07fbfb3`). No section this record governs changed; the decision holds. Re-verified by `git diff d0e9ca786..b65c3d4ed -- <verified_paths>`; no re-implementation was needed. The image carries it at the next rebuild.
