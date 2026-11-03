# Build-with-quality revamp: VisionCraft handoff

Prepared 3 November 2026. **Stop point: no revamp implementation has started.**
The operator asked for this handoff instead of continuing into the extraction.
Resume only on a subsequent instruction. Sealmap's completed release is recorded
in [its integration receipt](sealmap-0.4-release.md).

## Requested outcome and agreed direction

The operator wants the same thorough treatment for build-with-quality that
Sealmap received: understand every surface, extract a standalone repository,
generalise the useful implementation into a Rust crate, improve documentation,
apply skill-builder's improvement pass, and consume the result throughout
Agentbox. Preserve its substantial engineering method, rather than merely
renaming its entry point or reducing it to one security command.

**VisionCraft** was the recommended and accepted working name. Repository,
crate, CLI and skill name availability has not been checked or reserved. Keep
`build-with-quality` as a compatibility entry during migration. `Forge` already
has concrete meanings in the estate, including Dream Engine's `Forge/GhForge`;
avoid creating another ambiguous Forge abstraction. No VisionCraft repository,
crate, registration or runtime has been created.

## Start with these two reports

1. [Complete inventory and migration roster](visioncraft-handoff/inventory-handoff.md):
   all **28 files**, **6,833 lines**, **292 literal references in 107 files**;
   126 references across 66 files after excluding internal/history/governing
   references. Counts describe static source, not activated runtime calls.
2. [Proposed library, CLI and adapter design](visioncraft-handoff/design-review.md):
   domain/state boundaries, a useful executable scope, process/evidence rules,
   Deepsec compatibility, **22 acceptance fixtures**, held-out evaluation and
   release/consumer criteria. Every API in that report is a proposal.

The reports link a file-by-file completeness matrix, caller inventories,
source blobs and hashes, relative-link results and an inventory receipt. These
are committed beside the reports; local originals also remain under
`~/workspace/evidence/visioncraft-20261103/`. They can be used after all task
worktrees have been removed. Recover exact source using the full Git revisions
in the reports, then assess only changes since those revisions.

## Facts that should prevent duplicated work

- The old npm/TypeScript API was real historical code, removed in commit
  `be85f94ac` on 9 September. Current README installation/import/class claims
  outlived that deletion. Do not describe it as an API that never existed,
  silently resurrect it, or advertise those names as current functionality.
- `config/skill.yaml` is 507 lines of descriptive policy with no discovered
  current runtime loader. Its version is 1.5.0 while the source skill is 1.5.3.
  A key or claimed percentage is not enforcement or benchmark evidence.
- The Deepsec wrapper is the present executable core. Other quality gates are
  methods/templates until a project supplies a real evaluator. Agent records
  and logical roles are not running workers; model/provider labels are not
  actual independent review provenance.
- Preserve EDD, debugging, static-oracle mode, diagram-driven diagnosis,
  DDD/ADR/TDD/BHIL, Rust steering/review/port guidance, worked examples and the
  accumulated review lessons as separately reachable resources.
- Preserve the full BeautifulRust MIT notice and pinned source. The mixed
  Agentbox-root/skill declarations and other method attributions need explicit
  file-level provenance decisions before redistribution. A new implementation
  can be written from the behavioural contract; do not copy the Agentbox
  wrapper mechanically under a different licence.
- The inventory found conflicts between cross-family requirements and degraded
  fallback, per-phase paid reviews and operator cadence, MCP-only memory and
  old CLI fallbacks, plus unsupported learning/consensus/performance claims.
  Resolve them under actual session and project policy, with explicit states.

## What Sealmap already supplies

Consume published `sealmap-corpus` **0.4.0** (and the facade where appropriate).
It owns finding dispositions, independent delivery attestations, structural
receipt validation, model-family declarations and conservative review packs.
Do not fork those contracts or create another findings store.

Artifact byte/root verification currently lives in the Sealmap CLI, while the
library exposes structural validation. Initial consumers can delegate to
`sealmap review check`; a later public resolver API belongs in Sealmap if needed.
Do not claim the existing library validator verifies bytes or reopen the
completed release merely to make the proposed design appear implemented.

The proposed VisionCraft core owns declared quality plans, bounded executions,
receipts, explicit gate outcomes and expectation coverage. Agent orchestration,
shared memory, semantic judgement, optimisation and deployment remain callers
or integrations. Its first real compatibility consumer should replace the
Deepsec wrapper; a generic Rust-check plan should also work without Agentbox.

## Changes made after the frozen inventory

The inventory pins Agentbox `4e1f4fff4`; the design observes `428da81e2`.
Both commits are retained in the integration history. Subsequent integration:

- CI's Deepsec pin is **2.3.10**, aligned with the inspected runtime protocol.
  The old Claude CI pin remains an inventory item, not a verified defect.
- The wrapper now rejects relative-manifest input failures, missing completion,
  stale report directories, export errors, malformed rows and unknown severity.
  Sixteen offline cases pass, plus a real bad-ref probe returning runtime 70.
- Sealmap 0.4 is published and source-pinned by Agentbox. Ordinary runtime PATH
  was still 0.3.0 at close-out; the baked skill was 1.5.0. No 0.4 image activation
  is claimed. Start any future runtime assessment with installed versions.
- The monthly audit-budget and shard-settlement repairs are complete and
  independently revalidated. Preserve their contract; do not rebuild a second
  ledger inside VisionCraft. See ADR-2131 and the release receipt.

## Suggested sequence when resumed

1. Reconcile this frozen roster with current main and check the working name's
   availability. Resolve provenance and choose a complete first release scope.
   Write expectations and policy decisions before locking the API.
2. Implement the deterministic core and process/Deepsec adapter with regression
   controls, full rustdoc and actual examples. Keep validation/report commands
   read-only; distinguish blocked, failed, incomplete, skipped and unavailable.
3. Package the complete portable method. Run skill-builder against both harness
   layouts. Keep ecosystem configuration in adapters and expand the Agentbox
   use case without making it a prerequisite for other users.
4. Run the measured skill-tuning pass with a frozen baseline, isolated held-out
   tasks, replicated runs and retained trajectories. Structural lint and public
   acceptance tests do not demonstrate improved task success. No such benchmark
   has run in this handoff task.
5. Migrate every listed caller, both skill registries, router sources/goldens,
   stack projection, preflight, CI and neighbour skills. Test legacy script
   flags, exits and direct resource paths. Keep one canonical payload and a
   thin compatibility route, not two independent full skills.
6. Review, publish, pin the actual release and exercise a registry consumer.
   Verify the rebuilt image separately; update relevant ADRs and remove task
   worktrees. Keep raw evidence and publication/adoption/deployment separate.

No permission question is pending. The unresolved design choices are work for
the resumed task, not reasons to repeat already granted routine authorisations.
Do not resume the separately blocked VisionClaw/Codescape audit or unrelated
estate work as part of this extraction. Preserve the operator's planning files
and other agents' worktrees.
