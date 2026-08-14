---
id: ADR-052
title: Dream Machine HP annexe — isolated overnight evidence-gated evolution with a pull-model control plane
status: proposed
date: 2026-08-14
type: integration
adr_category: architecture
author: Dr John O'Hare
depends_on: [ADR-051]
references: [VisionClaw ADR-135, VisionClaw PRD-025, dream-machine ADR-0001, dream-machine ADR-0002]
investigation: docs/integration/dream-machine-capability-investigation.md
review_trigger: Qwen3.8 lands behind the Loom façade (model swap on HP :8085), or the first ten annexe nights complete (evaluate the significance-bar and verdict-quality assumptions against real ledger rows)
---

# ADR-052 — Dream Machine HP annexe

> **Numbering:** re-checked next-free at draft — ADR-045…051 all landed. ADR-052
> is free; this doc claims it. Renumber on merge conflict as per house rule.
>
> **Scope boundary.** This ADR owns the **agentbox-side control plane** and the
> **topology contract** with the HP execution plane. The Dream Machine engine
> itself (config compiler, ledger/witness/entrypoint toolkits) is upstream
> (`/home/devuser/workspace/dream-machine`, its ADR-0001/0002) and is consumed
> as-is via its documented seams. The Loom façade contract is VisionClaw
> ADR-135/PRD-025; this doc consumes it and does not redefine it. The full
> evidence base is the investigation report referenced in the frontmatter.

## 1. Context

The dream-machine investigation (2026-08-14, 12-agent swarm + 2 side
researchers; see `docs/integration/dream-machine-capability-investigation.md`)
established that the Dream Machine is a pure config-compiler plus toolkit, and
that making it a cross-project overnight capability is orchestration work, not
a rewrite. Its recommended Option B (container-local orchestrator driving
headless `claude -p`) was capability-complete but carried two structural
limits: the host-bind Docker trap makes container-side rebuild-dependent
evaluation impossible (VisionClaw-class repos get systematically shallow
verdicts), and overnight agentic runs share the day-job container's blast
radius and credential surface.

The operator resolved the scope question with a different shape: run the
nights on **HP-Desktop** (downstream of machinelearn over the 25 G rail,
`10.10.10.0/30`, no LAN IP), standing up an **experimental instance of each
prospective project there**, using **exclusively the Ontology Loom**
(`http://192.168.2.132:8084/v1`, the load-bearing model-swap façade) backed by
the **self-hosted Qwen3.8 model being installed on HP :8085** (Muse-Glimmer-30B
serves there today; the façade makes the swap a config change, ADR-135).

## 2. Decision

Adopt the **HP dream annexe** topology — agentbox is the control plane, HP is
the execution plane, and the boundary is **pull-model unidirectional**:

1. **Control plane (agentbox, supervisord house pattern).** A
   `[program:dream-machine-nightly]` self-loop (gated `[dream_machine]` in
   `agentbox.toml`, off by default, byte-identical-when-off; `flock`;
   `--once|--loop|--dry-run`; wall-clock nightly gate; priority ~235) that:
   discovers nominated repos by **marker-file** (each nominated repo commits
   its own `dream.config.json`; `scan_dirs` widened with the workspace root as
   a role-based third entry, discovery filtered to marker-carrying repos);
   compiles each night's prompt with `dream-machine compile`; dispatches the
   job to HP; and afterwards **pulls** the night's artefacts back.
2. **Execution plane (HP, zero estate credentials).** HP holds **no**
   credentials for ruvector-postgres, the management API, GitHub, or the
   relay. It receives the compiled prompt + a fresh clone instruction over
   ssh, runs the night in an experimental instance (its own checkouts, its
   own Docker — the host-bind trap does not exist there), calls **only the
   Loom** for model work (LAN-private; `max_tokens ≥ 1536` for reasoning
   models per the bench protocol note), and leaves artefacts (report, ledger
   row, witness, receipts, entrypoint classifications) in a per-night output
   directory for collection.
3. **All estate-touching actions happen on the agentbox side after pull**:
   ledger row appended to the nominated repo's own `LEDGER.md` (canonical,
   git-committed, per-repo — decision confirmed); governed RuVector write to
   the `dream-cycle` namespace via `createMemoryTools({backend:'external-pg'})`
   with metadata `{repo, date, deep, scan, verdict, evaluated, witness,
   source:"hp-annexe-<model>"}`; draft-PR publication via the agentbox-side
   `gh`; optional bead/git-mark mirrors (§4). `autoMerge` is forced off at the
   fleet layer regardless of per-repo config.
4. **Significance bar (decision confirmed).** Only evaluated verdicts or
   explicitly significant research findings cross into main RuVector memory;
   routine INCONCLUSIVE noise stays in the per-repo ledger. The RuVector
   recall gate band is re-frozen at the post-v4.0.36 measured baseline minus
   tolerance: **self ≥175/200, true ≥102/120** (measured 180/106, stable ×2;
   see the investigation report §3.1 band-discrepancy note).
5. **Initial roster (decision confirmed):** `solid-pod-rs` and
   `nostr-rust-forum` — both Rust, clean native `cargo test` evaluator
   entrypoints, both build fully in a fresh clone on HP. Each needs an
   authored `dream.config.json` before its first night.
6. **Sequencing:** one repo per cycle, sequential; per-cycle post-ingest HNSW
   rebuild only when the night actually wrote memory; recall gate against the
   §4 band.

## 3. Prerequisites (verified state, 2026-08-14)

- **ssh provisioning is DONE** (2026-08-14). A dedicated ed25519 orchestrator
  keypair (`~/.ssh/agentbox-hp/` on the host, distinct from any personal key)
  is authorised on `john@10.10.10.1` and bind-mounted read-only into the
  container at `/home/devuser/.ssh` via `docker-compose.override.yml` (the
  rootfs is `read_only`, so `.ssh` cannot be written at runtime). The
  writable-`UserKnownHostsFile` requirement is obviated by **pre-seeding**
  `known_hosts` with HP's host key (fingerprint cross-checked against a live
  authenticated connection) and setting `StrictHostKeyChecking yes` — no
  runtime write is needed. In-container agents reach HP non-interactively via
  `ssh john` / `ssh hp` (config aliases `john hp hp-desktop 10.10.10.1`,
  `BatchMode yes`). Trust is one-way: HP holds no estate credentials; the key
  is revocable independently by removing its line from
  `john@10.10.10.1:~/.ssh/authorized_keys`. **Caveat for the dispatch wrapper:**
  `john`'s login shell on HP is fish, so remote command strings must be run
  through `ssh john bash -lc '…'`, not passed as bare argv.
- **Loom verified healthy** (`/health`: scaffold mode, backend reachable,
  8,143 classes / 286k triples). **Model behind it is still
  muse-glimmer-30B** (llama.cpp, 262k ctx); Qwen3.8 not yet visible — the
  swap is pending install and requires no consumer change.
- **Qwen3.8 install on HP** (operator-led, in progress).
- **git-mark on-write hook liveness unverified** — the smoke test (one
  owner-signed NIP-98 PUT, script staged in the session scratchpad) is
  pending operator execution; the git-mark ledger mirror (§4) must not ship
  before it passes.

## 4. Optional sovereign mirrors (sequenced after v1)

Per the investigation report §10 (live-corrected): the witness
`sha256(sha256(report)‖commit)` embeds unmodified in all three substrates.
When v1 is stable: (a) verdict **bead** per night (copy the
`nostr_bead_publisher.rs` kind-30001 pattern under a new kind, signed by a
**newly minted dream-machine `did:nostr` key** — the capability currently has
no identity of its own); (b) **git-mark mirror** of each ledger row on the
dream pod (tier is compiled-in and running; blocked only on the §3 smoke
test and the npub-vs-hex naming review); (c) evidence bundle to the pod at
`/dream-cycle/<date>-<commit>.jsonld` per the ADR-096 template. The rewind
observatory (report §11) consumes the federated ledger later.

## 5. Alternatives considered

- **Option B as recommended by the swarm (container-local headless `claude`).**
  Capability-complete and proven, but shares the day-job container's blast
  radius, cannot evaluate rebuild-dependent candidates (host-bind trap), and
  spends Max-20x subscription capacity overnight. Retained as the control
  plane; rejected as the execution plane.
- **Option A/C cloud legs.** Cloud `/schedule` cannot reach LAN RuVector
  (structurally disqualified for shared memory); the `RemoteTrigger` body
  contract remains unverified. Dead for now; revisit only if the annexe
  proves insufficient.
- **HP writes memory / publishes PRs directly.** Rejected: breaks the
  unidirectional isolation that is the annexe's core property. HP must remain
  credential-free toward the estate.

## 6. Consequences and risks

- An 8B-class model produces weaker hypotheses and more honest INCONCLUSIVE
  nights than frontier models; acceptable because the pipeline's deterministic
  spine is library code, the Loom scaffold grounds the research stage
  (~3.5× recall), and the significance bar keeps noise out of shared memory.
  Slot rotations should favour small, well-scoped surfaces initially.
- The model is swappable behind the façade by design — verdict quality can be
  re-benchmarked per model without touching the orchestrator (this is the
  ADR-135 property the annexe leans on).
- New failure surface: ssh dispatch, HP-side experimental-instance lifecycle
  (clone/build/teardown, disk hygiene), and result collection. Every failure
  mode must degrade to a recorded `INCONCLUSIVE`/`HALT` ledger row, never a
  silent missing night (the engine's own invariant).
- The 25 G rail is single-rail (rail 2 decommissioned) with NAT + MSS clamp;
  rail outage = degraded night, recorded as such.

## 7. Test contract

This ADR is satisfied when: (1) a nominated repo's marker `dream.config.json`
is discovered by the widened role-based scan; (2) an unattended nightly cycle
dispatches to HP, runs research + evaluation in the experimental instance via
the Loom exclusively, and the pull returns artefacts with a valid witness;
(3) the repo's `LEDGER.md` gains exactly one row and `dream-cycle` RuVector
rows appear only for significant/evaluated findings, with correct `source`
metadata; (4) HP is verifiably credential-free toward the estate (no ruvector,
management-api, GitHub, or relay secrets present on HP); (5) a full cycle with
the Loom unreachable ends in a recorded degraded night, not a crash; (6) the
recall gate passes at the §2.4 re-frozen band after a memory-writing cycle.
