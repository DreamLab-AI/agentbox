---
id: ADR-2150
title: Video productions are directed through existing media sidecars under one evidence discipline, with a Rust toolkit for the deterministic halves
date: 2026-10-23
decision_status: proposed
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []   # arm on acceptance: [skills/video-production/**, skills/open-montage/SKILL.md, skills/clipcannon/SKILL.md, skills/codebase-video/SKILL.md, skills/SKILL-DIRECTORY.md]
owner: jjohare
review_trigger: any description change in a Media Processing or 3D neighbour; measured overlap >=0.60 with any neighbour, cross-section included; ADR-2149 Stage B; ADR-2148 control-plane change; any proposal to grow runtime/ into an orchestration engine
repo: agentbox
domain: GOVERNANCE-capabilities
---

# ADR-2150: Video productions are directed through existing media sidecars under one evidence discipline, with a Rust toolkit for the deterministic halves

## Context
A research programme produced complete films with Blender, ComfyUI, FFmpeg and speech, and showed that delivery
integrity, physical conformance and creative acceptance are separate claims: a complete 750-frame film passed
delivery checks yet failed fine grips. Its design proposed a Rust orchestration runtime that would re-specify job
state, cancellation and staleness, all of which the estate already owns (ADR-2148 receipts and history authority;
ADR-2149 idempotent submit, `lost`, per-job cancel; `blender-job.js`; `scripts/adr-index-gen.js` in CI).
`open-montage` already claims the literal trigger "video production", and its boundary with `clipcannon` was cleared
at 0.60 overlap. Blender and Isaac Sim sit in another directory section, which the overlap scan does not compare.
The research prototype binaries are useful for hashing, rational time and bake preparation, but they are hard-coded to one
production's clock, geometry and node IDs. Services and models behind `visionclaw_network` change faster than any skill text.

## Decision
1. **One skill, named `video-production`.** It directs a multi-tool production where continuity must hold across
   cuts and revisions. `open-montage` hands over the literal "video production" trigger in the same change. Its
   overlap neighbours are `open-montage`, `clipcannon` and `codebase-video`: it names each in its when-not clause
   and each names it back. `comfyui` and `ffmpeg-processing` are tools it directs, not overlap neighbours; the
   when-not clause may point a single clip or a transcode at them without a reciprocal clause. This is a trigger
   handover, not a rename. Activation is blocked while measured overlap with any neighbour, cross-section
   included, is 0.60 or more.
2. **Execution goes through the existing sidecars and their job clients only:** `blender-job.js` on
   `gui-tools-service`, `isaac-job.js` on `isaac-sim`, ComfyUI through its MCP adapter and native HTTP per ADR-2148,
   the speech plane (`speech-to-text`, `pocket-tts`, optional `ming-tts-*` profiles) and FFmpeg. The skill obeys
   each client's state model. It adds no job vocabulary, lease, fence or provider-global interrupt: after an
   observation timeout it reconciles and never resubmits blindly, and cancellation is job-scoped or reported unsupported.
3. **The Rust toolkit is `skills/video-production/runtime/`.** It is deterministic: content hashes, a rational
   delivery clock with half-open frame intervals, receipts, a gate ledger in which `NOT_RUN` never becomes `PASS`,
   and bake preparation. Binaries: `film-bake`, `contract-check`, `guide-check`, `review-cut`, `dialogue-bake`,
   `masked-composite`, `surface-masks`, `surface-graphs`, `planar-art`, `art-extract`, `performance-prompts`,
   `render-cache`, `scene-exchange`. A binary may prepare and upload inputs; it never submits, polls, cancels or retries a provider job.
   That belongs to the clients in 2. Clock, resolution, frame count and node IDs are arguments, never constants;
   receipts store share-relative paths, never absolute ones; an upload re-checks the declared digest of the bytes it sends.
4. **Physics binds to `isaac-motion-export/1`** (ADR-2149 §7) and inherits ADR-2149's staged status. Every physics
   gate is `BLOCKED`, not `NOT_APPLICABLE`, until an Isaac smoke job of that kind has succeeded.
5. **Native dependency closure** is `blender-job.js stage` into a per-job directory plus a content-hash check
   inside the sidecar at consumption time. A hash taken at staging time on the shared exchange volume is not a
   reproducibility claim.
6. **Capability is probed, not assumed.** At production start the skill probes `visionclaw_network` for `comfyui`,
   `gui-tools-service`, `isaac-sim`, `speech-to-text`, `pocket-tts` and any `ming-tts-*` profile, and snapshots
   versions, node schemas, model bundles, queue and GPU state into the production record. Unknown support is not support.
7. **Decision point: services and models are swappable.** The agent may change a ComfyUI workflow, a model bundle
   or a compose profile as the stacks evolve, but only when a measured comparison against the retained baseline on
   the actual brief shows the change is better. Each change is recorded in the production record. Image and
   sidecar builds run from the host shell only. Discovery never implies a download, an external upload or a paid call.
8. **Acceptance requires build-with-quality's cross-vendor evidence auditor.** A same-family audit is recorded as
   `degraded_same_family` and cannot back an acceptance decision. Without that auditor, a release is at most a
   labelled provisional review.
9. **Free disk:** Isaac jobs use ADR-2149's per-sidecar floor. The skill runs its own free-space preflight
   (temporary peaks, model downloads, retained failures) and declares no estate-wide floor.

## Consequences
- One continuity-film route exists without a second job runtime. A sidecar contract changes in one place.
- The skill inherits each client's limits. A Blender `cancelled` marker is written once SIGTERM is signalled, so
  Blender cancellation is request-level until `blender-job.js` confirms termination (a change under ADR-2142/2148).
  The ComfyUI adapter's running-job cancel posts `/interrupt` with `prompt_id`. The live build interrupts only if
  that prompt is running, but the adapter reports success when the request is accepted, so the skill confirms
  cancellation from history before recording it. An unpinned or older build that ignores `prompt_id` would make
  the same call global, so the skill re-checks the handler whenever the ComfyUI build changes.
- The toolkit was rewritten to meet 3 when it moved: the research prototype hard-coded one production's frame
  count, rate, resolution and node IDs, stored absolute paths in receipts, and did not re-check the digest of the
  bytes it uploaded. Each of those is now a test. Schemas were bumped (`film-bake/2`, `review-cut/2` and
  siblings) and `handoff-check` became `contract-check`, so research-repo receipts are not readable by this toolkit.
  The invariant this ADR adds forbids advertising a binary that is not in the tree.
- Research workpackages for a shared job vocabulary, a separate evidence auditor and speculative experiment
  selection are cut (research TASK-003, TASK-009, TASK-010). Provider discovery, dependency closure, physics,
  finishing checks and packaging are follow-ups on the owning skills.
- Every revision now needs a routing change in the neighbours as well as in this skill. A neighbour's description
  change triggers re-review here.
- Physics productions cannot claim contact or solve gates until ADR-2149 Stage A has a succeeded smoke job.
- Production records may name only anonymised lessons. Client material, private repositories and identity cases stay out of this public repository.

## Alternatives considered
| Alternative | Why it lost |
| --- | --- |
| A parallel Rust orchestration runtime with its own job state, durable operations, leases and interrupt fence (the research proposal) | It duplicates ADR-2148/2149 and `blender-job.js` and forks the estate into a fourth job vocabulary. A global interrupt cannot be made safe on a shared instance: another job can start between the ownership check and the interrupt. Typed time and invalidation do not need an engine; a toolkit carries them. |
| Guidance-only skill, no Rust | It loses the type-checked rational clock, hashes and gate ledger. Prose cannot stop a 750/25 constant from coming back. |
| Rename to a distinct name (for example `continuity-film`) and leave `open-montage`'s trigger alone | Two skills would compete for the phrase operators actually use, and the overlap problem would only move. A trigger handover with reciprocal when-not clauses settles routing in one place. |
| Fold into `open-montage` | Its route is a quick video from an idea through on-demand pipelines, with no shared-world, revision-scope or evidence contract. Merging would weaken that skill's boundary with `clipcannon`. |
| A fixed model/workflow recipe | Evidence already shows recipe failures as briefs change. A measured baseline is useful; a permanent selection is not (Decision 7). |

## Verification
Not verified; `verified_commit` is empty and `verified_paths: []` asserts nothing checkable yet. Observed on
2026-10-23 against an uncommitted working tree, so this is not evidence at any commit:
- `skills/video-production/` is untracked.
- `runtime/src/bin/` holds the twelve binaries named in Decision 3 plus `scene-exchange` from `main.rs`; from
  `runtime/`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (86 tests) and
  `cargo doc --no-deps` all exit 0. Three guards were broken one at a time and each matching test failed:
  `NOT_RUN` counted as passed, evidence hash skipped, absolute path in a receipt.
- `grep -rnE 'Command::new|python|comfy_client|/prompt|/history|/queue|/interrupt' runtime/src` finds only
  `ffmpeg`, `ffprobe`, `magick`, a configured lip-sync binary and one `curl` upload to `/upload/image` in
  `film-bake.rs`: no binary submits, polls or cancels a provider job.
- `skills/video-production/SKILL.md`'s description names all five tools in its when-not clause; the
  `open-montage`, `clipcannon` and `codebase-video` descriptions name it back; `open-montage`'s description no
  longer carries the literal "video production" trigger.
- `bash skills/lint-skills.sh` reports the estate clean at 131 skills; `gen-routing-table.mjs --check` and
  `scripts/skill-count-check.js` exit 0.
- The live ComfyUI (`/opt/ComfyUI`, commit `faa7e494f3a0c9e45e1c3db8d20ee48fd5fe1b52`): `server.py` `post_interrupt`
  calls `interrupt_processing()` only when `prompt_id` matches a running item, and interrupts globally when no `prompt_id` is sent.
- Not done: a measured route-eval across every neighbour, cross-section included.

Move to `implementation_status: complete` once the above is committed and a route-eval across every neighbour,
cross-section included, is recorded below 0.60.

Then set `verified_commit` and arm `verified_paths` from the comment above. `activation_status: live` additionally
needs one end-to-end production on the live sidecars, accepted through the cross-vendor auditor.
