---
name: video-production
description: "Directs a multi-tool film production where continuity must hold across cuts and revisions: one versioned brief or world drives Blender, ComfyUI, Isaac Sim, speech and FFmpeg jobs over the docker network, with recorded sources, rational-clock timing, scoped re-renders and evidence-backed acceptance. Use for 'video production', stop-motion or animated films, source-faithful characters or products and acceptance gates. Not for a montage from an idea (open-montage), cutting footage you hold (clipcannon), a repo explainer (codebase-video), one clip (comfyui) or transcoding (ffmpeg-processing)."
status: live
compatibility: Portable orchestration guidance for agents with filesystem and media tools. Specialist services are discovered at runtime on the docker network; equivalent tools can substitute for named skills. The Rust runtime in runtime/ is built with cargo and handles hashes, clocks, receipts and gates; GPU work uses the existing job clients.
---

# Video production

Produce an editable film and evidence sufficient to assess it. This skill orchestrates existing specialist skills and adds the deterministic bookkeeping (hashes, rational clocks, receipts, gate ledger) that keeps a multi-tool production honest. The design is recorded in [ADR-2150](../../docs/adr/ADR-2150-video-production-skill.md).

## Choose the scope

Read [the product contract](references/prd.md) for requirements and deliverables. Start from the user's brief and existing assets. Record duration, rational frame rate, aspect, resolution, audience, dialogue, exact graphics, continuity, style, resources and any delivery destination. Resolve essential missing constraints; infer reversible creative details and record assumptions. A source page or storyboard panel is a beat, not necessarily a shot.

Use a native render, generated film, source-footage edit or combination according to the brief. Shared-world action needs a versioned world and continuous action timeline. A documentary montage does not need an invented 3D scene. Physics, stop-motion cadence, style adapters, endpoint anchors and speech are conditional capabilities, not features of every film.

Design references: [DDD](references/ddd.md) for domain authority (read when deciding who owns world, action, audio or evidence), [contracts.json](references/contracts.json) (informational catalogue only; nothing enforces it) and ADR-2150 above.

## Operating procedure

1. **Establish sources and expectations.** Version the brief, script/takes and supplied assets. Record which sources own identity, geometry, timing and exact graphics. Map required beats to delivery intervals and define measurable hard gates plus visual expectations before expensive generation. Read [quality and evidence](references/quality.md).
2. **Discover actual capabilities.** Run the discovery in "Service discovery" below, then read the relevant neighbour skills: `blender`, `comfyui`, `isaac-sim`, `ffmpeg-processing`, `build-with-quality`. Query actual versions, schemas, model bundles, queues, device allocation and storage; never use a service merely because a recipe mentions it. Apply [technology selection](references/technology-selection.md).
3. **Rehearse the whole edit.** For world-based action, build one saved world with stable actor, prop, camera and attachment IDs. Author action across cuts and declare montage, omitted time or transformations. Keep native asset files authoritative for their geometry. Inspect the complete low-resolution edit at full timing with scratch audio; correct staging, contact, occlusion and camera readability before generation, because errors found after generation cost a render per shot.
4. **Prepare conditioning and appearance.** Derive spatial anchors from the actual camera and frame; keep untimed identity references distinct. Record source, native, model and delivery maps and padding. Native ownership, projected bounds, sampling masks, generated tracks and final alpha are different artefacts. Keep source graphics in a controllable layer when their exact form matters.
5. **Qualify and generate.** Compare a small, declared set of compatible workflows against the actual failure being solved, keeping no-style and native baselines. Persist request, workflow and input hashes and job IDs before monitoring. Reconcile ambiguous submissions; a timeout or quiet sampler is not permission to resubmit or restart a service. Verify collected output bytes and output-node identity before review.
6. **Review motion and finish.** Inspect intermediate action and cut neighbours, not just anchors. Check identity, contact, geography, dialogue, cadence and artwork independently. Correct the shared geometry or action when it causes the defect, then regenerate affected neighbouring views. Apply bounded repairs with saved lossless locality checks and separate visual review. Never replace body parts or move props between shots to conceal a continuity failure. A complete 750-frame film once passed every delivery check yet failed fine grips, so decode checks never replace looking at pixels.
7. **Demonstrate a revision.** When dialogue or iterative editing is in scope, replace one versioned input, compute the affected work, rebuild it and review the entire edit. Distinguish narrow native changes from whole generated-clip invalidation. Keep approved audio editable with exact sample/frame maps.
8. **Deliver with scope.** Decode-check the complete delivery, inspect its pixels and audio and retain the reviewed artefact hash. Hand over the master, native/project sources, timing/edit data, asset/model/workflow provenance, revision instructions and the acceptance decision, stating remaining limitations. A successful job or an upscale is not production acceptance or recovered detail.

Keep the user's existing authorisation and execution policy. Local execution is the default. External transfer or spend needs explicit authorisation; publication is a separate requested action. Stop a dependent phase when a required capability or hard gate is missing; continue independent useful work.

## Runtime tools

The skill ships a Rust crate at `runtime/`. Build it with `cargo build --release` from `runtime/`. Binaries: `film-bake`, `contract-check`, `guide-check`, `review-cut`, `dialogue-bake`, `masked-composite`, `surface-masks`, `surface-graphs`, `planar-art`, `art-extract`, `performance-prompts`, `render-cache`, `scene-exchange`. Read `runtime/README.md` for each binary's config schema and run each with `--help` first; flags are the binary's own, not those in the design documents. Every tool takes `--root DIR`, else `$BLENDER_SHARE`, else the current directory.

Use them for the deterministic halves: content hashes, rational-clock arithmetic, receipts and the gate ledger. They do not talk to GPUs on their own authority. Anything needing a GPU goes through the existing job clients below, so state, queueing and cancellation stay with the service that owns them. Read [implementation](references/implementation.md) when extending the runtime (TASK-003, 009 and 010 are cut; 002/004/006/008 extend the neighbouring skills instead).

## Adapters are the existing job clients

This skill obeys their state models and adds none of its own:

- **Blender:** `skills/blender/tools/blender-job.js` against gui-tools-service (`:9876`, MCP on `:9881`).
- **ComfyUI:** `http://comfyui:8188` per ADR-2148. History is the terminal authority; after a timeout reconcile against history and never blindly resubmit. On a shared instance never issue a provider-global interrupt; cancel only an owned job or report cancellation unsupported.
- **Isaac Sim:** `skills/isaac-sim` `isaac-job.js` and the `isaac-motion-export/1` contract (ADR-2149). Physics gates are BLOCKED until a smoke job has succeeded.
- **FFmpeg:** the `ffmpeg-processing` skill.
- **Speech:** the shared speech plane, `speech-to-text:8000` (Nemotron ASR) and `pocket-tts:8000`.

## Service discovery and stack evolution

Every model and service is swappable, so a recipe is never evidence that something is installed. At the start of a production probe the docker network (`visionclaw_network`) and record what answered:

| Probe | Meaning |
| --- | --- |
| `comfyui:8188/system_stats` | generation, devices, queue |
| `gui-tools-service:9881` | Blender GPU sidecar |
| Isaac Sim health | physics sidecar |
| `speech-to-text:8000/health` | ASR |
| `pocket-tts:8000/health` | default TTS |
| `ming-tts:8000/health` | OPTIONAL Ming-3.0 profile (`docker-compose.speech-ming.yml`, one GPU); promote only if it measures faster |

This table is a starting point, not the inventory. Enumerate what is actually attached (`docker ps` works through the read-only proxy; `docker-compose.*.yml` in the agentbox root lists every profile) so a service added last week is found and a retired one is not assumed. Store the answers in the production's capability snapshot. A missing service means the dependent gate is BLOCKED, not assumed.

You are expected to improve the workflows as stacks evolve. Propose and apply changes to ComfyUI workflows, model choices, compose profiles and skill tools when a measured comparison shows improvement, and record the evidence. Container builds and compose changes are launched from the host shell (tmux tab 6), never from inside the agent container. Requalify after any bundle, model, service or kernel change, because a passing earlier qualification does not transfer.

## Evidence and acceptance

Every gate verdict is PASS, FAIL, BLOCKED, NOT_RUN or NOT_APPLICABLE. NOT_RUN never becomes PASS. Acceptance requires `build-with-quality`'s cross-vendor evidence auditor; a same-family audit is recorded as degraded and cannot back acceptance. The producer never signs the auditor field. Read [quality](references/quality.md) for the gate list and counterexamples.

## References and when to read them

- [prd.md](references/prd.md): requirements and acceptance wording; read when scoping or disputing a deliverable.
- [ddd.md](references/ddd.md): authority and invalidation rules; read before changing who owns an input.
- [quality.md](references/quality.md): gates, expectations, adversarial cases; read before review or acceptance.
- [implementation.md](references/implementation.md): runtime shape and workpackage status; read when extending `runtime/`.
- [technology-selection.md](references/technology-selection.md): dated model and tool evidence; read when choosing or replacing a model.
- [research-through-line.md](references/research-through-line.md): anonymised lessons and their limits; read to justify a design choice.
- [contracts.json](references/contracts.json): informational catalogue of requirements, tasks and gates.
