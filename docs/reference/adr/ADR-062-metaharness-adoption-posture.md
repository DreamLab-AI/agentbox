# ADR-062: MetaHarness adoption posture — two-tier maturity, subprocess-only

- **Status:** Proposed (research mesh 2026-08-27, run wf_845cbc7e-4f2; 51-agent verified)
- **Date:** 2026-08-27
- **Relates to:** ADR-063..068 (this suite), [ADR-052](ADR-052-dream-machine-hp-annexe.md),
  upstream ruflo#ADR-150/#ADR-321, metaharness#ADR-070..075

## Context

MetaHarness (`github.com/ruvnet/metaharness`) is the standalone extraction of ruflo's
harness-scaffolding logic: a harness *factory* plus a package family (`metaharness`,
`@metaharness/darwin`, `@metaharness/kernel`, `@metaharness/router`,
`@metaharness/weight-eft`). Agentbox already has **two independent touchpoints** that
must not be conflated:

- **T1 — `ruflo-metaharness` plugin** (13 skills): present in the pinned ruflo closure
  and in the boot cache (`/var/cache/ruflo-plugins/plugins/`), **not installed**.
- **T2 — dream-engine darwin evaluators**: **already live** — target repos declare
  `@metaharness/darwin` evaluator entrypoints in `dream.config.json`, executed on the
  HP annexe (`agentbox.toml:1514` sandbox policy).

Package maturity (verified against npm + the ruvnet-kb corpus, 2026-08-27):
darwin 0.9.3 and router 0.4.0 are actively developed and production-consumed by ruflo;
kernel is 0.1.3 (4 lifetime versions); weight-eft is 0.1.1 and dormant since
2026-06-27. Upstream ruflo#ADR-321 (2026-07-27) made `metaharness` + `@metaharness/router`
hard deps of ruflo, superseding ruflo#ADR-150 removability rules #1/#2 — only the
graceful-degradation rule (#3) still binds upstream.

SWE-bench evidence (confirmed in the ruvnet-kb corpus, official-harness measured with
Wilson CIs): open-loop cheap-model baseline 7.7% [5.2–11.2] on full Lite-300
(metaharness#ADR-144); **conformant** interactive arc 34.0% single-trajectory / 39.7%
Best-of-3+judge at ~$0.005–0.015/instance (darwin 0.7.0); tiered cheap→frontier
cascade 58.3% (measured, non-conformant — gold-test oracle in-loop); Test-Driven
Repair 68.3% given an acceptance test (metaharness#ADR-177). The upstream culture is
conformance-attested and banks negative results openly. When planning, cite the number
matching the deployment shape (conformant vs oracle-assisted vs TDR) — do not use the
easy-skewed stratified-25 pilot figures (12–16%), which upstream itself discards.

## Decision

Adopt MetaHarness on a **two-tier maturity posture**:

**Tier 1 (adopt):** `@metaharness/darwin` and `@metaharness/router`, surfaced exactly
as ruflo does — pinned **subprocess or gated dynamic-import only**, never a static
library link. Graceful degradation (`{degraded:true}`, exit 0) is mandatory on every
call path, paired with the both-halves CI proof (degraded when absent, real data when
present — the ADR-150 "graceful degradation lies" lesson).

**Tier 2 (defer/reject):**
- `@metaharness/kernel` read-only surfaces: deferrable, needs a use case. Its
  in-process `ToolDispatcher` is a **non-goal** — see [ADR-068](ADR-068-kernel-tooldispatcher-deferral.md).
- `@metaharness/weight-eft`: rejected as an integration surface (dormant, aspiration-tier,
  not endorsed by any ruflo integration ADR).
- `from-repo <git-url>` (untrusted clone) is never agent-callable — human-in-the-loop
  permanently ([ADR-066](ADR-066-metaharness-governance-boundaries.md)).

**Shortfall attribution presumption.** When the live system underperforms upstream's
measured numbers, the default hypothesis is a fault in *our* integration (config,
sandbox args, version pins, annexe environment), not in MetaHarness. Precedent: the
one-week dreaming audit's 63%-INCONCLUSIVE nights traced to our annexe path-dependency
gap (ADR-060) and evaluator misconfiguration — upstream was fine. Debug our wiring
against the upstream reference invocation before filing upstream blame.

Agentbox does **not** assume the upstream removability contract: design only against
rule #3 (graceful degradation), since ruflo#ADR-321 already broke rules #1/#2 upstream.

## Consequences

- The adoption roadmap is [ADR-063](ADR-063-enable-ruflo-metaharness-plugin.md) (boot) →
  [ADR-064](ADR-064-bake-metaharness-runtime-binaries.md) (rebuild), with
  [ADR-065](ADR-065-dream-darwin-evaluator-liveness.md)/[ADR-066](ADR-066-metaharness-governance-boundaries.md)/[ADR-067](ADR-067-metaharness-pin-discipline.md)
  as standing invariants.
- Cross-repo ADR references are always namespaced (`ruflo#ADR-150`,
  `metaharness#ADR-155`) — bare numbers collide (ruflo and metaharness both have an
  ADR-155). Agentbox's own sequence (062+) is independent.
