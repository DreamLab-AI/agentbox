# VisionCraft / build-with-quality revamp: inventory handoff

Prepared 2026-11-03. **Handoff only. The operator explicitly deferred the revamp;
do not interpret this document as authorisation to start extraction.** No source,
registration, deployment or package publication changed during this inventory.
No VisionClaw/Codescape audit work was inspected or resumed.

## Source and coverage

Source snapshot: Agentbox `4e1f4fff4e0f7827e8588c33bbf031c8420f52ad`, read in
`/home/devuser/workspace/wt/agentbox-sealmap-delivery`. This worktree may be removed
after integration; recover any source with `git show <revision>:<path>`.

- **28 files, 6,833 lines, 324,453 bytes:** 23 Markdown files, two lint TOML
  assets, one descriptive YAML file, one executable gate and its test file.
- The [completeness matrix](completeness-matrix.csv) maps **all 28 files** to
  their capability, actual status, proposed destination, completion evidence and
  provenance. Its path set was checked equal to the pinned Git tree, not guessed
  from the entry point. [JSON form](completeness-matrix.json).
- [Source inventory](source-inventory.json) records SHA-256, Git blob ID, exact
  line counts, headings and outgoing URLs for every file.
- [Caller inventory](callers.tsv) / [JSON](callers.json) records **292 literal
  matches in 107 tracked files**, including internal references and history.
  Excluding internal/history/governing-record references leaves **126 matches
  across 66 files**. These are static references, not proof of runtime execution.
  [Unfiltered Git grep output](all-callers.txt) preserves the search evidence.
- [Relative-link check](relative-links.json): no absent relative file targets
  found outside fenced examples in the 28 files at that revision. This does not
  verify remote pages, anchors, command semantics or all prose claims.

The skill-builder and skill-tuning instructions, including the worked tuning
harness contract, were read. The documented `skillopt-lab` root, repository,
Rust task and virtual environment still exist; no model benchmark was run.

Parent integration subsequently repairs the Deepsec CI version from 2.3.9 to
2.3.10. That repair is outside this frozen inventory: use the final Agentbox
handoff commit for the current CI pin, and retain this snapshot for provenance.

## What exists and must survive

This is already a substantial engineering method. Its value is not exhausted by
the one executable gate. Preserve the following as separately reachable resources:

1. Full EDD loop: one-behaviour expectations, in/out of scope, counterexamples,
   risk levels, executable/partial/non-executable evidence, independent review,
   human judgement, ageing and stabilisation into regression tests.
2. Feedback-loop-first debugging: ten ways to obtain a signal, ranked falsifiable
   hypotheses, one-variable probes, performance bisection, minimised regression,
   cleanup, and a distinct static-oracle mode when execution is impossible by
   construction. Temporary environment failure must not become a static PASS.
3. Diagram-driven diagnosis: map every competing path and caller, compare
   contracts, retain intentional differences, obtain a failing control, then
   consolidate through the shared owner and its actual consumers.
4. DDD, ADR and TDD: bounded contexts, explicit tradeoffs, governed source paths,
   non-vacuous staleness checks, code-before-ADR commit sequencing and meaningful
   red/green tests. Keep optional BHIL lineage and prompt/eval templates.
5. Review intake and the estate lessons: wrong assertion versus reproduced bug,
   valid controls, consumed dependency version, effects after error, secondary
   stores, known-identifier reads, publication quarantine and old-data migration,
   model-review completion, honest thresholds, private evidence, exact bytes,
   release/publication/adoption/deployment separation and recoverable handoffs.
6. Full Rust guidance: steering's 13 sections, review and port rubrics, both
   lint assets, five source digests and the complete BeautifulRust notice.
7. Five worked project examples and their differing risk/quality profiles;
   detailed activation/reference material should remain available on demand.
8. The tested Deepsec process contract: configuration precedence, names-only
   credentials, bounded process, meaningful exits, fresh evidence, valid export
   schema, explicit threshold, incomplete/error results and no false PASS.

## Actual versus claimed behaviour

| Area | Source evidence | Finding and handoff action |
|---|---|---|
| Removed API | `README.md:101–173,259–308`; deletion commit `be85f94ac` | The TypeScript package, `package.json`, `tsconfig.json` and `src/` were removed on 2026-09-09. The README still advertises `@claude-flow/build-with-quality-skill`, `BuildWithQualitySkill`, `UnifiedMemory`, `TinyDancerRouter`, factories and evidence-gate helpers. Describe these as **removed implementation**, not inventions that never existed. No current implementation or caller was found. Do not resurrect it without reviewing why it was retired. |
| YAML config | `config/skill.yaml:1–507`; `SKILL.md:6` | No current runtime loader found. YAML version is 1.5.0, entry skill is 1.5.3. Hooks, learning algorithms, fleets and gate settings are descriptive data. Choose a tested schema/loader or explicitly label reference policy; do not advertise enforcement merely because a key exists. |
| Executable scope | `scripts/deepsec-gate.sh`; `.github/workflows/deepsec.yml:69`; `invariants.yml:149` | The security gate and its offline tests are real and wired. Other quality gates are methods/templates unless a project supplies an evaluator. Local parent tests report 16 gate cases after the malformed-export repair. |
| Agent topology | `SKILL.md:67–93`; `references/agents.md:3–24`; `BUILD-WITH-QUALITY-PROMPT.md:7,54–82,500–583` | Entry point correctly distinguishes role records from running harness workers; the older activation prompt still mandates Claude Flow/AQE and introduces a 17-role launch recipe. Preserve logical roles, make execution adapter-specific and optional, and distinguish a label from an actual invocation. |
| Learning claims | `README.md:40–45,241–249`; `references/architecture.md:7–26,40–49`; `config/skill.yaml:131–159` | SONA is documented off at 384 dimensions, while older prose still claims achieved speed/token/F1 improvements, dream cycles, Q-learning and automatic unified memory. No such engine exists inside this module. Preserve useful learning workflow; remove or qualify unsupported runtime/benchmark claims. |
| Independence | `EDD-PROTOCOL.md:77–86,218–231`; `quality-gates-and-workflow.md:116–126` | Hard cross-family requirements coexist with same-family fail-open fallback. Fixed “Claude producer → Codex auditor” instructions are wrong for Codex producers. Resolve through explicit independence policy and recorded participant/model provenance; an unavailable independent auditor is not a cross-family PASS. |
| Authority and gates | `config/skill.yaml:417–448`; `quality-gates-and-workflow.md:5–14` | BFT/weighted-voting claims have no local implementation and conflict with independent evidence verdicts. Coverage/accessibility/chaos percentages are generic defaults, not demonstrated universal acceptance thresholds. Configure applicability and evidence; retain human judgement for subjective criteria. |
| Memory | `BUILD-WITH-QUALITY-PROMPT.md:581–584`; `config/skill.yaml:470–476` | Raw `claude-flow memory store` fallback conflicts with the standing MCP-only memory instructions. Portable module should expose an optional memory capability; Agentbox adapter must use its governed MCP schema. Do not add another findings database. |
| Tool/model pins | `config/skill.yaml:163–178,338–351`; `EDD-PROTOCOL.md:79–82`; `.github/workflows/deepsec.yml:50`; `flake.nix:731–738` | Many hard-coded models/harness versions belong to an ecosystem profile. CI originally installed Deepsec2.3.9 and Claude2.1.257 while Nix pins Deepsec2.3.10. Parent is correcting the Deepsec pin now; the old Claude CI pin remains an inventory item, not a verified current compatibility defect. |
| Spend cadence | `quality-gates-and-workflow.md:107`; `agentbox.toml:2562` | Per-increment security review instructions conflict with the operator's once-per-project-before-push policy. Preserve policy precedence and avoid extra paid calls during migration. |
| Permission ceremony | `EDD-PROTOCOL.md`; `DEBUGGING-PROTOCOL.md:201–208` | Human acceptance and design questions are valuable intent records; they must not repeatedly ask for approval already given in the session. Separate optional design elicitation from required authorisation. |
| Frontmatter portability | `SKILL.md:5–10`; `skill-builder/SKILL.md` | Entry metadata contains arrays/booleans; the portable field contract described by skill-builder calls for flat string metadata. Keep estate extensions in an adapter or validate the actual target harness; do not assume estate lint proves all-harness portability. |

## Integration surfaces to carry into a migration plan

The complete literal list is in `callers.tsv`. The following adds the generic
runtime paths that do not themselves name build-with-quality:

| Boundary | Current source anchors | Compatibility obligation |
|---|---|---|
| Skill payload | `flake.nix:15–16,2062,2078` | Skills are a path input copied to `/opt/agentbox/skills`. Future external source must be immutable/pinned and contain the complete reference tree. |
| Native discovery | `skills/registered-skills.txt:48`, `codex-registered-skills.txt:15`; `flake.nix:2147–2149`; `config/entrypoint-unified.sh:3746–3768`; `scripts/reconcile-skills.sh:18–80` | Both harness registries and baked Codex fallback must point at the same released skill. Reconciler leaves removed names unmanaged; explicitly test old-name migration rather than assuming deleting a manifest line removes old copies. |
| Live routing | `skills/skill-router/references/section-map.json:52`, `routing-table.md:99`; `skills/gen-routing-table.mjs:36–43`; `config/hooks/lib/skill-route.cjs:181–209,393,517`; entrypoint `:2766–2829` | Regenerate routing from descriptions, preserve negative-routing distinctions, and test BM25/System One decisions. Avoid two independently routable full copies competing for one task. |
| Stack projection | `services/agentbox-manifest/src/stacks.json:9,14,19`; `stacks.rs:208,344`; `tests/golden/stacks.stack-manifest.json` | Ruflo-orchestrator, QE-fleet and Nagual-QE refer to the legacy skill. Decide canonical name plus compatibility alias and update source/golden fixtures together. |
| Operational presence | `services/agentbox-ops/src/bin/report-preflight.rs:269` | Preflight checks for the legacy skill; an extraction must still satisfy the intended capability check, not merely create a directory. |
| Agents and instructions | `agents/rust-engineer.md:17`; `agents/registered-agents.txt`; `config/instructions/workspace.claude.md:13` | Preserve direct Rust guide access, distinguish 34 logical roles from 13 registered native agents, retain same-family advisor versus independent auditor policy. |
| Codex review integration | `flake.nix:36–43,2151–2158`; `config/entrypoint-unified.sh:846–866` | Codex plugin boot registration is an Agentbox adapter, not a requirement for using the portable method. Never advertise the same model family as independent. |
| Security toolchain/policy | `flake.nix:717–738`; `agentbox.toml:2282,2553–2570`; schema `:884,2243`; `system-manifest.js:96`; validator `:1368` | Keep rebuild-class binary gate distinct from live policy, names-only credential fields and route validation. Regenerate `schema/agentbox.toml.apply.json`; preserve E070–E072/W070 semantics. |
| CI | `.github/workflows/deepsec.yml`; `.github/workflows/invariants.yml:142–149` | Keep controlled credential/comment jobs, exact CLI contract, immutable pins, gate test path, skill lint/count and routing freshness. Do not turn SKIPPED into required-security acceptance. |
| Router/eval fixtures | `tests/system-one/{routing-cases,cascade-bm25-parity}.json`; four `golden/*choice*.json`; `skills/system-one/scripts/items.json` | Alias changes affect both classification truth labels and ranking probabilities. Capture a frozen baseline before regenerating goldens; changing expected output is not a measured improvement. |
| Review ingestion | `skills/sealmap-review/{SKILL.md,references/*,evals/evals.json,scripts/review-cadence.cjs,scripts/merge-findings.cjs}`; `skills/diagrams-as-code/references/verification.md:199` | Preserve imported findings as hypotheses, adjacent Sealmap receipts and source/test/delivery distinctions. Do not create a second disposition validator. |
| Neighbour skills | 38 skill-reference files in `callers.json` | Includes BHIL/prd2build, security/defence, Rust, codebase-memory, code-review, documentation/explainer, report-builder, skill-tuning, video-production, tree-search, SPARC, hooks, swarm/hive, system-one, context7, codex-companion and verification-quality. Preserve redirects and handoff expectations, not just names. |
| Governing/history docs | `GOVERNANCE-capabilities.md:93,514`, `docs/user/configuration.md:825`, ADR2033/2131/2134/2092 and archived audits | Amend active authority. Keep historic claims tied to original revisions; do not mass-rewrite archived evidence to the new name. |

## Proposed separation, for the next authorised task

This is a boundary proposal, **not shipped API**. The separate
`design-review.md` from the design worker gives the detailed contract choices.

- **Portable skill/resources:** the full method, templates, examples and Rust
  references. No required Agentbox, Claude Flow, RuVector, Nix or particular model.
  Optional ecosystem sections describe actual integrations, starting with Agentbox.
- **Small independent Rust library:** deterministic expectation/policy/gate
  validation and typed outcomes. Reuse the released Sealmap receipt/hash/model
  family contracts where appropriate, rather than copying their implementation.
  Keep declaration validation separate from semantic truth and live attestation.
- **CLI:** useful inspection/scaffolding/check/report operations over ordinary
  repository artefacts, with stable machine output and honest failure states.
  Do not promise the deleted autonomous swarm/learning engine as an MVP.
- **Execution adapter:** bounded external-process security review and other
  explicitly configured evaluators. Capture actual commands, version, input scope,
  output and completion; do not infer success from exit zero alone.
- **Agentbox adapter:** existing policy/credential/egress rules, provider bindings,
  skills and agent registration, shared memory, package pin, boot projection and
  old script/name compatibility. Consumer integration is distinct from publication
  and running deployment.

A compatibility period should retain `build-with-quality` as a tested redirect or
thin wrapper to one canonical payload. Keep old direct resource paths used by
Rust agents and skills until migrated. Do not permanently maintain two full
copies. Compatibility names belong to the host; the independent module should
not adopt all historical estate assumptions as defaults.

## Licence and provenance inventory

These are observed declarations and gaps, not a legal clearance:

- Agentbox root `LICENSE` is AGPLv3. The skill's `SKILL.md` and `README.md`
  declare MIT, but there is no complete skill-root licence/provenance manifest.
  Establish which contributions that declaration covers before copying them into
  a permissively licensed standalone package.
- The Deepsec wrapper/tests originated in Agentbox commit `11804ba4b` and have
  no separate file-level SPDX notice. Keep Agentbox-owned integration in its
  existing licence boundary unless rights to relicense are explicitly established.
- BeautifulRust material is the clearest boundary: `references/rust/NOTICE.md`
  contains the full Morgan Linton MIT notice and pin
  `a9cdcfa94d1330c0d41c7f67764c5f7786fbb71d`, with the exact file set and marked
  estate overlays. Retain the notice, original links and source/overlay mapping.
  Do not assume every future upstream digest has the same provenance.
- Debugging credits Matt Pocock's `diagnose` method but gives no pinned upstream
  revision or licence. BHIL and KHIVE/RuvNet material similarly needs a concrete
  provenance record if copied or substantially adapted for a new distribution.
- Deepsec is referenced as a separately installed Apache-2.0 executable; it is
  not vendored here. Preserve dependency attribution and exact version handling.
- The removed TypeScript package is historical reference, not automatically a
  cleared or desirable source for a new Rust implementation.

## Acceptance and evaluation handoff

Keep a deterministic conformance suite and a separate measured skill benchmark.
The following inventory-derived cases must appear in the next task's acceptance
matrix, in addition to the detailed cases in `design-review.md`:

1. Every current file and substantive method maps to a shipped resource or an
   explicit reviewed retirement; no shallow rename loses static-oracle, diagram,
   traceability, Rust or review-evidence depth.
2. Removed API names are absent from advertised current features; every published
   command/example runs against the released binary, including registry consumers.
3. Unknown config keys, missing evaluator, invalid output, stale receipts and
   truncated responses never become PASS; legitimate no-finding and real-finding
   positive controls remain green/block as appropriate.
4. Different provider aliases of the same family do not satisfy independence;
   unknown family and unavailable reviewer are explicit unresolved/degraded states.
   A successful unrelated observation cannot validate the intended consumer.
5. Changed/dirty/untracked input bytes, narrow file lists, renamed paths and
   missing source prevent unsupported scope claims. Generated diagrams and hashes
   do not prove semantic correctness.
6. Wrong failing assertion, failed setup and absent runtime remain inconclusive;
   meaningful red-to-green evidence includes valid controls and observed effects.
7. Budget scope is independent of work selection; interrupted paid steps preserve
   reservations and successful receipts. No model call occurs from inspection,
   dry-run, missing credentials or disabled policy. Do not silently retry billing.
8. Compatibility tests exercise old CLI flags/exit codes/resource paths and both
   harness registries; migration preserves private logs and historical evidence.
9. Policy-selected coverage/security/accessibility/chaos gates have actual
   evaluators and applicability decisions; BFT votes cannot override a failed
   required gate or manufacture independent semantic verification.
10. Skill A/B evaluation freezes train/validation/test separation, retains each
    trajectory, avoids correct-solution Git diff leakage, calibrates difficulty
    away from 0%/100%, uses at least three repetitions and reports hard plus soft
    scores. Do not equate absent token counters with absent subscription calls.

The existing tuning harness is an optional consumer, not a dependency of the
portable library. Run a plumbing smoke before any paid evaluation. Keep test
fixtures synthetic and independent of the blocked VisionClaw/Codescape work.

## Decisions still needed before implementation

1. Canonical package/skill name and the duration/mechanism of the old-name alias.
2. Licence/ownership clearance per source group, particularly new Agentbox code
   and the unpinned method adaptations.
3. Minimum useful executable scope: expectation/evidence/gate contracts first;
   which external evaluators are supported in the first release.
4. One explicit policy for independence/degradation, subjective checks, human
   acceptance, ageing and project-specific gate thresholds.
5. Which existing Sealmap types/contracts to consume and their version boundary;
   do not fork its receipt validator or family registry.
6. Default-neutral artefact paths and import compatibility for existing
   `.claude/expectations`, `.claude/evidence` and `.deepsec-gate` histories.
7. Evaluation budget, harness/model availability and frozen baseline before any
   tuning. No empirical improvement is claimed by this inventory.

Historical scope note: the handoff-only instruction was later superseded by the operator’s request to implement and integrate VisionCraft. See [current status](../visioncraft-handoff.md).
