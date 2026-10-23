# PRD-VIDEO-001 — Agentbox video production

Status: **design and staged skill specification**, 23 October 2026. Runtime extraction, adapter qualification, installation and acceptance of a new film are separate implementation work. This document does not certify those outcomes.

Traceability: [SPEC-VIDEO-001: quality and EDD](quality.md), ADR-2150: architecture (`docs/adr/ADR-2150-video-production-skill.md`), [DDD-VIDEO-001: domain model](ddd.md), [machine-readable design manifest](contracts.json). Requirement identifiers below are stable; subsequent revisions retain their history.

## Problem and intended outcome

An agent can produce convincing isolated frames while losing the source character, changing contact across a cut, silently retiming speech or reviewing the wrong output. Successful generation, valid scene mathematics and an attractive endpoint each establish only part of a production's requirements. Repeating such work without dependable provenance and invalidation makes a small editorial change expensive and difficult to review.

Provide one reusable skill that takes a versioned creative brief through source reconciliation, planning, editable native production, optional simulation and generation, deterministic finishing, whole-edit review and a documented handover. A director must be able to change a line, camera, asset or action and see which dependencies changed, which were reused, what was actually executed and what remains unaccepted.

The orchestration core owns contracts, clocks, dependencies, evidence and acceptance. Specialist tools own native scene authoring, simulation, image/video inference and media processing. A complete native film is a valid route. Generative finishing and physical simulation are selectable capabilities, not mandatory ingredients in every project.

## Users and production journey

The director supplies intent, source authority and review decisions. The production agent plans and coordinates work. Specialist operators or agents own backend deployment and resource allocation. An evidence producer gathers executable results; a distinct auditor challenges them. Perceptual reviewers assess identity, performance, continuity and the completed edit against the brief.

1. Ingest the brief and assets; resolve source precedence, missing material, delivery constraints and allowed execution boundaries.
2. Discover available adapters and compare suitable routes on representative synthetic or project fixtures. Estimate resource use before expensive work.
3. Plan beats, dialogue and the edit; build a versioned world and continuous action; rehearse the whole edit at low spatial resolution and full intended timing.
4. Validate required mechanics, native geometry and editable performance. Compile guides, references, masks and exact-graphics layers from their declared sources.
5. Execute bounded finishing/generation jobs; retain receipts and review outputs against native motion and source identity, including intermediate frames and neighbouring cuts.
6. Assemble the complete edit, run technical checks and perform full-speed picture/audio review. Accept, reject or record an authorised soft compromise with its scope.
7. Exercise at least one representative revision, verify true dependency invalidation, then hand over the editable project, evidence, unresolved findings and reproducible recipes.

This sequence allows independent work to proceed while an optional backend is unavailable. A missing required capability blocks its dependent acceptance claim; it must not be silently replaced by a weaker technique.

## Scope and requirements

Each requirement maps to the same-numbered `EXP` in SPEC-VIDEO-001. “Pass” below means the stated scope only. Project-specific thresholds are declared before execution. Historical measured values are examples, not defaults.

### REQ-001 — Brief and source authority

**Scope:** Version brief documents, transcript, images, supplied graphics and later instructions; record source hashes, page/crop provenance, asset precedence, unresolved ambiguity and beat coverage. Source pages are evidence units, not a mandatory shot list. Generated derivatives cannot silently become identity authority.

**Acceptance:** Every required beat, line and exact graphic maps to assets and retained delivery intervals; visible source inspection resolves contradictions with extracted text. Missing information remains explicit. **Counterexamples:** duplicate overlapping PDF text becomes duplicate speech; an invisible obsolete image becomes the character reference; a generated sheet overrides supplied artwork without a recorded decision.

**Configurable:** source precedence, required beats, transcript/take approval, allowed transformations, missing-asset handling and review authority. **Outside scope:** inventing approved content, legal approval of commercial claims or universal PDF reconstruction.

### REQ-002 — Shared world and continuous action

**Scope:** Stable actor/prop IDs, hierarchy, native asset versions, cameras and continuous action underpin adjoining views. Declare intentional montage, time jumps and transformations. Revisions propagate to affected neighbouring views.

**Acceptance:** Full-timing native rehearsal includes all cuts and action intervals; audits confirm unchanged identities and expected world/action continuity across views. Inspect entry, support, contact and release, not just endpoints. **Counterexamples:** disconnected replacement hands, unexplained actor scaling, a decoration moving to improve one composition, hidden reset of trajectory at a cut.

**Configurable:** world units, scene backend, topology/rig detail, shot boundaries, continuity groups and authorised discontinuities. **Outside scope:** a universal rig or geometry format, or mandatory 3D reconstruction for footage-only montage.

### REQ-003 — Character, prop and style identity

**Scope:** Source-backed identity packages describe recognisable shapes, proportions, costume/prop marks, set geography and material/light intent. Surface reinterpretation is explicit. References are scoped to actors and views.

**Acceptance:** Review changed views, entrances, occlusions, dialogue and cuts against authoritative references. Count actors and assess anatomy, marks, scale and temporal stability. **Counterexamples:** coherent but wrong adult/child identity; a dog feature transferred to a human; a valid endpoint with identity breakup immediately before it.

**Configurable:** identity landmarks, permitted stylisation, species/anatomy conventions, reference precedence, material freedom and review rubric. **Outside scope:** a claim that reference sheets, one seed or one similarity score lock identity.

### REQ-004 — Live discovery and adapter suitability

**Scope:** Discover exact service capabilities and constraints; select complete workflow bundles, including weights, quantisation, encoders, VAEs, adapters, graph/software revisions and preprocessing. Distinguish advertised, installed, validated, executed and accepted evidence.

**Acceptance:** Required inputs fit the live schema and model/frame buckets; exact bundle identity is recorded; bounded smoke execution verifies outputs before expensive batches. Requalify changed bundles. **Counterexamples:** a dropdown entry treated as successful loading; incompatible tensor formats; a 2.3 adapter presumed compatible with 2.5; unsupported stacking presented as established.

**Configurable:** adapter choice, local endpoints, model bundle, freshness policy, comparison budget and required capabilities. **Outside scope:** permanent model rankings, automatic provisioning authority or general quality claims from marketing names.

### REQ-005 — Conditioning, regions and masks

**Scope:** Compile scene observations into explicit guide roles: layout/depth/pose, appearance reference, indexed anchor, visible ownership, projected box, generated segmentation, sampling influence and final alpha. Preserve coordinate/time maps, semantics and hashes.

**Acceptance:** Masks match the intended source/camera/clock; discrete ownership remains distinct from soft influence; final lossless composites preserve promised outside-alpha pixels and guards. Review edited anatomy and temporal neighbours separately. **Counterexamples:** a box called visibility, generated coordinates substituted for native coordinates, feathering that crosses eye guards, negative reference index assumed to mean final frame.

**Configurable:** guide encodings, anchor positions/density, influence strengths, adapter mask conventions, tracking and repair envelopes. **Outside scope:** guaranteed identity/contact from a regional prompt or one mask path.

### REQ-006 — Optional physical solve and replay

**Scope:** Where the brief requires causal mechanics, bind authored action to a declared solver, units, collision proxies, parameters and stable IDs; replay the result into the same native world. Represent estimated material properties and untested contacts honestly.

**Acceptance:** Relevant length, slack, grip, support, collision, load/release and clock checks pass at declared scope; replay agrees with exported samples; final generated motion receives separate review. **Counterexamples:** zero endpoint error despite changing cable length; independently keyed branch response claimed as solved causality; a rescaled/retimed replay treated as validated dynamics; local contacts used to claim whole-scene clearance.

**Configurable:** whether physics is required, solver, collision coverage, parameters, resolution/timestep, tolerances, preroll and exposure mapping. **Outside scope:** mandatory Isaac Sim, material calibration from appearance or full-tree/scene certification from a sampled fixture.

### REQ-007 — Replaceable dialogue and scoped invalidation

**Scope:** Version waveform, transcript, speaker, take, cue alignment and editable performance. Distinguish performance scope, rendered interval, complete generated-clip dependency and cut-review interval. A duration change requires an explicit timing decision.

**Acceptance:** A fixed-clock replacement preserves unrelated native state and source PCM outside the declared replacement union; regenerates the actual containing clip when necessary; reviews adjacent cuts and the complete edit. Alignment, mouth shape, speaker routing and perceptual lip-sync receive separate checks. **Counterexamples:** unchanged pre-speech frames assumed for audio-conditioned generation; a render range mistaken for mouth-animation scope; strong AAC correlation concealing changed unrelated PCM.

**Configurable:** take placement, pronunciation/cues, rig mapping, A/V tolerance, overlap policy, mix, permitted pacing edits and regeneration scope. **Outside scope:** final casting by synthesis alone, universal phoneme recognition or cue-local invariance of generative video.

**Longer source-interview branch:** preserve the full original and replacement recordings and measure the replacement before locking the new edit. Distinguish replacement synchronous picture/audio from audio-only replacement. Where matching picture is unavailable, use explicitly selected B-roll/voice-over or obtain an editorial decision; do not display the old interview mouth as if it synchronised with new words. Reallocate permitted shot durations and transitions, recompute source-to-delivery, subtitle/caption and mix maps, then review the full edit. If required speech cannot fit the delivery contract, present a concrete excerpt or duration change for decision; never silently trim words or stretch approved audio. Invalidate every shifted/changed timeline consumer and only the generated clips that actually depend on the take. Preserve unchanged source bytes, graphics and disjoint media operations; no invented world or solver is needed for footage-only material. Fixed-clock PCM locality is tested at original positions; a timing-changing edit instead verifies the source samples at their newly declared positions and the full revised mix.

### REQ-008 — Rational delivery and exposure time

**Scope:** Maintain explicit source, simulation, model and delivery clocks with rational rates and half-open intervals. Frame maps, temporal buckets, padding, cropping, resampling and per-channel exposure schedules are versioned inputs.

**Acceptance:** Decode all retained frames and verify counts, timestamps, endpoints, declared duration and padding. One map controls coupled physical components; character holds may coexist with a moving camera. **Counterexamples:** labelling 24 fps as 25 fps while claiming unchanged duration; padding with the next shot; applying an editorial map twice; retiming curves but leaving camera markers stale.

**Configurable:** rational frame rate, duration/frame count, exposure schedule, model bucket policy, crop/overscan and allowed interpolation. **Outside scope:** a universal 30-second/25-fps target or claiming post-stepped frames recover sharpness already lost in generation.

**Duration precedence:** the delivery contract must distinguish `duration_intent` (`nominal` or `exact`), nominal requested duration, integer retained frame count, actual rational presentation duration, frame-count rounding/tie policy and permitted duration error. Record any interpretation of decimal rate shorthand: `29.97` must not silently alternate between `30000/1001` and `2997/100`. With CFR rate `p/q` and `N` whole exposures, actual duration is `N*q/p`. If exact requested duration times rate is non-integral, validation rejects the incompatible hard constraints until an explicit production decision changes one; it cannot invent a partial final exposure, VFR, altered rate or hidden audio trim. For nominal duration, use the declared rounding policy and tolerance and report actual duration separately. At `30000/1001`, exactly 18 seconds would require `540000/1001` frames; 539 frames last `539539/30000` seconds and 540 last `540540/30000`. Neither may be labelled exactly 18 seconds. Model padding is excluded from retained delivery and cannot override this policy.

### REQ-009 — Durable jobs, recovery and cancellation

**Scope:** Persist request identity, submission attempts, provider IDs, ownership, status, outputs and errors across agent/service restarts. Represent unknown outcomes and unsupported cancellation explicitly.

**Acceptance:** Reconcile history, queue and verified outputs after transport uncertainty before retrying; reuse completed results; cancel only owned work and confirm terminal status. **Counterexamples:** timeout triggers duplicate generation; an unrelated job is interrupted; progress events alone establish completion; an interrupted refinement is promoted because an intermediate movie exists.

**Configurable:** concurrency, polling/backoff, reconciliation deadline, retry policy and cancellation support. **Outside scope:** exactly-once guarantees for providers without a suitable idempotency mechanism.

**Cancellation boundary:** checking that the running job is owned does not make a later interrupt safe, because the owned job can finish and another owner's job can start between observation and action. Cancel only through an identity-scoped provider operation on the exact owned job. On a shared instance never issue a provider-global interrupt; if no scoped operation exists, report cancellation as unsupported, stop local scheduling and observe or reconcile the owned job without claiming the remote job stopped.

### REQ-010 — Content-addressed artefacts and cache

**Scope:** Immutable artefacts bind content hashes to role, producers, inputs, clocks, coordinate/colour/alpha interpretation and review state. Cache keys cover every result-affecting dependency, including geometry, materials, lens, software and complete exposure state where relevant.

**Acceptance:** Corrupt/stale/missing media fails verification; same verified dependency set can reuse results; changed inputs cannot inherit old acceptance. Select actual output node/type and fetched bytes. **Counterexamples:** transform-only cache despite material animation; filename equality treated as identity; unresolved remote symlink; input guide accidentally reviewed as generated output.

**Configurable:** storage roots, supported hash algorithms from trusted libraries, cache scope, retention and transfer strategy. **Outside scope:** treating lossy encodes as lossless pixel-equivalence evidence or promising byte-identical GPU inference across hardware.

**External native dependency closure:** a native file hash alone is insufficient when it reads linked scenes/libraries, textures, fonts, simulation caches, scripts or other external assets. Enumerate and bind the actual dependency closure by resolved content hash and role, with declared handling for dynamic or unresolved dependencies. Execute against immutable materialised inputs or an equivalent verified snapshot; checking mutable paths only before rendering permits a validation-to-use race. Changing external bytes invalidates affected results even if the native file, pathname, size and modification time remain unchanged. Unverifiable dependencies block a cache-equivalence claim. Record the content actually consumed, not merely an expected manifest.

### REQ-011 — Storage and compute budgets

**Scope:** Preflight filesystem capacity, reserved headroom, expected outputs/downloads, assigned GPUs, model memory, concurrency and runtime/cost budgets. Deduplicate shared model files and account for peak temporary storage.

**Acceptance:** Admission rejects work exceeding declared resources; rechecks before costly stages; preserves running ownership and recoverable state when capacity changes. **Counterexamples:** summing two paths on one filesystem as separate capacity; visible GPUs treated as allocated; a quiet downloader duplicated; reserve breached while producing redundant intermediates.

**Configurable:** minimum free space, budget ceilings, model staging, priority, device allocation and retention. **Outside scope:** a universal fixed free-space reserve (the per-sidecar floor in ADR-2149 governs the Isaac Sim sidecar), automatic deletion of accepted assets or unauthorised host deployment.

### REQ-012 — Deterministic finish, exact artwork and audio

**Scope:** Keep supplied graphics, captions/terms and authoritative audio outside uncontrolled generative interpretation. Use declared projection, occlusion, native geometry, compositing, mixing and encoding recipes. Record actual generation/refinement/delivery resolution separately.

**Acceptance:** Verify original art lineage and known coverage, layer registration, sample placement, decoded streams and lossless intermediate boundaries. Review final typography, support and readability. **Counterexamples:** invented missing print; logos regenerated as text; preview-coordinate crop applied to another raster size; upscaled export called native high-resolution generation.

**Configurable:** graphic fidelity, crop, resolution, colour/alpha pipeline, sample rate, loudness, codecs, captions and delivery packaging. **Outside scope:** exact pixel equality after geometric resampling/lossy encoding or independent legal approval of source wording.

### REQ-013 — Whole-edit technical and perceptual acceptance

**Scope:** Assess the entire deliverable at full timing, with audio, source/native comparisons, cut neighbours and full-resolution detail inspection. Keep technical gates separate from creative decisions and evidence scope.

**Acceptance:** All mandatory gates pass and an identified reviewer accepts the hashed final version or records an authorised soft compromise. Unresolved hard failures prohibit production acceptance. **Counterexamples:** frame count or synchronised inset presented as physical conformance; contact sheets claimed as playback; a technically complete advert described as finished despite identity/lip-sync defects.

**Configurable:** required review coverage, reviewers, perceptual rubric, tolerances and soft-compromise policy. **Outside scope:** autonomous aesthetic acceptance guaranteed across arbitrary films or mandatory human approval of every reversible intermediate operation.

### REQ-014 — Controlled experiments and research

**Scope:** Investigate current primary sources and run bounded comparisons driven by observed gaps. Record hypothesis, predictions, controlled variables, confounders, negative controls, measured results, costs and decisions; preserve failed recipes before retiring guidance.

**Acceptance:** Claims match their evidence; paired trials hold relevant inputs fixed; useful multivariable changes are labelled workflow comparisons. Promote only after representative holdout and cross-shot review. **Counterexamples:** cached/warm versus cold runtime called a speed improvement; sharpness treated as identity; a single failed prompt used to reject a model family; source documentation presented as local reproduction.

**Configurable:** hypothesis, representative/holdout shots, seeds, routes, metrics, stopping criteria and iteration budget. **Outside scope:** exhaustive model benchmarking or implementing speculative temporal research before establishing a measured need.

### REQ-015 — Local-default portable profiles and explicit external execution

**Scope:** Separate portable project contracts from environment configuration. Default to local native tools and available local inference; external execution requires an explicit recorded boundary and authorisation covering data, provider and spend. Existing authorisation persists within its scope.

**Acceptance:** A fresh synthetic project validates without client archives or producer-specific paths; offline/native operation remains available; unknown external boundaries fail closed for submission while read-only planning continues. **Counterexamples:** hidden cloud prompt encoding in a local profile; ignored client files required by a test; container bind paths assumed to be host paths.

**Configurable:** endpoint/path mappings, trust boundaries, credential references, approved providers, cost ceilings and optional dependencies. **Outside scope:** universal cloud prohibition, copying credentials into manifests or silently installing into generated harness directories.

### REQ-016 — Skill packaging, regression and quality

**Scope:** Stage one self-contained package with concise entry point, these design references, contracts, synthetic examples, implementation status and validation/installation instructions. Stabilise regression-critical expectations as tests and retain independent audit evidence.

**Acceptance:** Package/link/schema checks pass; documented implemented commands execute from a clean temporary project; proposed interfaces are visibly labelled; quality matrix identifies passed, failed, blocked and not-run gates. Installation is separately evidenced through agentbox source/registration workflows. **Counterexamples:** planned CLI presented as runnable, placeholder implementation presented as complete, same producer self-audits, same-family review labelled cross-family, staged files claimed installed.

**Configurable:** package/engine versions, schema compatibility, harness metadata, test tiers and release policy. **Outside scope:** shipping a new complete runtime in this design task or importing unrelated generic coverage/accessibility percentages as film-quality measures.

## Configuration and contract boundaries

Profiles must carry project/brief IDs; source authority; asset/look/world/action/edit revisions; rational clocks and frame maps; exposure schedules; delivery/colour/audio requirements; exact layers; backend capability requirements; bundle pins; conditioning/region roles; optional mechanics; resource/external boundaries; acceptance policy and reviewer authority. Missing required fields fail validation with an actionable field/path and requirement ID. Optional unsupported capabilities remain visible.

Keep source documents and native files in their own formats, referenced by hash. Exchange descriptions identify objects and observations; they do not duplicate Blender's mesh database or a solver's internal state. A proposed native edit names its expected source revision and requires reconciliation before downstream invalidation. Interface contracts belong to [DDD-VIDEO-001](ddd.md); requirement, task and gate links are recorded in the [machine-readable design manifest](contracts.json).

## Outcome measures and release boundary

Record accepted-shot yield, accepted seconds per cost, change-request-to-reviewed-edit time, failed attempts, manual interventions, preparation/queue/load/sample/decode/retrieval/finishing time and reused versus invalidated artefacts. Record “unknown” for unavailable measurements. Measure cost through review, not only sampler execution. The design does not set an unsupported universal performance target.

Release the staged design as design. A later executable release requires deterministic core and packaging gates, a complete synthetic native rehearsal, a fixed-clock dialogue replacement, recovery/failure controls and independent evidence review. Claim generated or simulated support only for separately qualified adapters/profiles. A production film additionally requires its own whole-edit acceptance; synthetic qualification cannot grant it.

## Historical evidence and limits

The lessons below come from archived experiments in the originating private research repository. They are anonymised evidence for design choices; no skill command or fixture may require that repository or its assets.

| Lesson | Design consequence |
| --- | --- |
| A zero attachment error concealed a changing cable length, and detached replacement hands failed cross-cut continuity. | Verify physical intent, solve, replay and delivered picture separately; keep one actor and action across cuts. |
| A resumed generation restored 75 exposures from 38 unique authored states, and bounded repair and service recovery worked. | Reusable scheduling and recovery contracts are justified; this is not production approval. |
| Selecting the wrong output node invalidated three reviews, and attention or blur variants did not repair sparse source massing. | Bind reviews to exact output-node identity and fix the shared geometry rather than the sampler. |
| Whole-clip invalidation and independent PCM checks corrected overly narrow rebake assumptions. | Audio replacement invalidates whole generated clips; local solve and replay have bounded collision scope. |
| Shared camera markers, shared actions and performance scope were all dependencies, and precise face alignment still left late speech. | Traverse shared animation ownership; alignment metrics do not replace visible lip-sync review. |
| Screen-space pacing improved a reveal while other inputs changed; the last complete film remained provisional. | Declare multivariable changes honestly and keep provisional status. |
| A complete 750-frame film passed delivery checks yet failed fine grips. | Delivery decode checks are necessary and never sufficient; inspect actual pixels. |
| Source identity correction changed geometry, bounded still repair passed locality while two videos still smeared, and a higher-resolution trial was interrupted. | Separate locality metrics from motion review; do not treat an interrupted trial as evidence. |
| Rational conversion, padding and resolution lineage mattered, and exact graphics needed controlled layers with valid receiving geometry. | Keep clocks rational and artwork on an authoritative source layer. |

No accepted commercial film or universal best model follows from these results.
