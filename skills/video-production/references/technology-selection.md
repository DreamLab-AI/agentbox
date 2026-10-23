# Capability-based technology selection

Supports PRD-VIDEO-001 REQ-004/005/009/011/014/015 and ADR-2150 (`docs/adr/ADR-2150-video-production-skill.md`). Policy reviewed 23 October 2026. The providers and model families below are examples backed by dated evidence, not fixed dependencies or a claim about the newest model.

## Distinguish capability from acceptance

Record advertised, installed/discovered, schema-valid, executed, fixture-accepted and production-accepted as separate evidence states. A successful loader does not establish an executable graph; a completed graph does not establish identity or contact. Bind every claim to environment, component hashes, inputs, profile and observation date.

Re-query live service schemas, model choices, current queue and allocated resources before a new batch, after a service/model change, or when a resumed job's environment differs. Re-read official model cards/workflows at selection or reselection. Preserve source URL, access time, publication date if exposed and immutable revision where available. Undated mutable documentation needs a content digest or saved reference in the experiment record; it must not inherit a release date from the access date.

An accepted recipe remains pinned during a production unless a demonstrated failure or material change justifies reselection. Candidate research can occur independently without silently changing in-flight graphs. A provider that does not expose its underlying model revision must record that limitation and requalify when outputs or advertised capability change.

## Portable provider contract

The [contract catalogue](contracts.json) records proposed requirement, expectation, task and gate links; [DDD](ddd.md) describes the runtime interfaces. Until the runtime implements them, capture the same fields in versioned project records and actual service receipts rather than inventing a working command.

Every adapter declares discovery, side-effect-free validation/estimation, submission, observation, collection and cancellation support. Its capability snapshot includes:

- Provider identity, local/external data boundary, adapter/software/node revisions and observation time.
- Explicit supported/unsupported/unknown controls: structural modalities, timed anchors, identity references, masks, audio/performance, native rendering or solver replay.
- Frame-count buckets, rational frame-rate support, canvas constraints, colour/alpha/audio formats, coordinates and mask semantics.
- Required model bundle, resource envelope, concurrency, cancellation scope, output-node binding and any missing telemetry.

Requests bind exact input hashes, graph and model-bundle identities, seeds, source world/action/edit/audio revisions, profile and source/model/delivery maps. Receipts bind provider job identity, submitted bytes, observed terminal state, actual downloaded bytes and decoded media facts. Timed reference semantics belong to the adapter; never infer an endpoint from a negative guide index.

Use durable HTTP history and retrieval for ComfyUI; WebSocket progress is observational. The existing ComfyUI skill owns its client and service operations. Do not copy endpoint hostnames, mount layouts or credentials into the portable package. A disconnected request can leave submission ambiguous; reconcile before retrying, and never claim exactly-once creation where the provider supplies no idempotency mechanism.

## Model and adapter qualification

The selection unit is a complete bundle: base model and architecture/version; quantisation; encoders, VAEs and upscalers; control and style adapters in order/strength; sampler/scheduler and stage topology; node/software revisions; preprocessing and coordinate/time mapping. Hash every component where available. Names are labels, not identity or compatibility evidence.

Check author-supported base/adapter pairing, tensor format and input buckets, then validate the graph and execute a small smoke case. An unlisted combination is experimental even when all its pieces run separately. Requalify on a base, quantisation, adapter, kernel or material software change. Do not presume identical output across hardware or that equal integer seeds create equivalent noise between model families.

Keep structural-guide strength, attention, noise and style weight separate. Preserve a no-style baseline. Texture style and authored cadence have different gates. Treat frame-accurate anchors and appearance sheets as different inputs. Masks may localise attention without bounding generated pixels; exact locality is a property to verify after lossless compositing.

## Execution profiles

| Profile | Use | What it can establish |
| --- | --- | --- |
| `contract-ci` | CPU synthetic manifests, frame arithmetic, fake providers and small media fixtures | Deterministic contracts and recovery; no visual generation or solver acceptance. |
| `native-rehearsal` | Complete low-resolution edit at full timing | Staging, cameras, action, native continuity and performance timing; physical claims only with verified solver/replay. |
| `local-preview` | Available local hardware and a small compatible inference bucket | Comparative evidence for a bounded recipe; disclose spatial/temporal adaptations. |
| `local-quality` | Qualified local bundle at the production's declared quality | Candidate delivery; full edit and all applicable gates still need review. |
| `external-explicit` | Named external service with authorised assets, spend and purpose | Same acceptance gates as local; also record transfer, retention and cost limits relevant to the request. |

Local means the approved execution/data boundary, not necessarily the current host. A graph with local diffusion and remote prompt encoding is not wholly local. Native rendering is a valid chosen production route. Missing generation or physics support must be reported rather than concealed by a weaker route. Storage reserve and maximum run time/cost come from project/environment configuration; plan downloads and intermediate outputs before dispatch.

## Benchmark, holdout and reselection policy

Freeze expectations, hard failures, metrics, review rubric, fixture versions, seeds, profiles and total budget before trials. Choose the incumbent and up to two challengers whose controls plausibly address the measured defect. The default screening budget is one smoke case and three declared seeds per candidate; it is a bounded screen, not statistical proof. Adjust this budget explicitly for the project.

Use identical scene, action, references and delivery intent where possible. Document unsupported controls and unavoidable topology differences. Change one meaningful factor for a causal claim; describe multivariable comparisons as workflow comparisons. Report rejected seeds and failure costs alongside selected footage. Compare no-style versus style adaptation before crediting a LoRA with improvement.

Apply hard gates before ranking visual quality or speed. Measure identity, geometry/action, temporal stability, dialogue/cadence, finish and total revision-to-reviewed-output cost separately. Whole-clip and cut review are necessary: isolated first/end frames, tracking success or a similarity score cannot establish continuity. Native controls calibrate measurement error.

Reserve independently generated fixture instances and seeds for a final holdout. The author should not tune on them. A failed holdout returns the recipe to development; a subsequent claim needs a fresh holdout. [Quality](quality.md) owns the detailed evidence and review policy. A useful small suite covers a two-actor handoff across a cut, an occluding head turn with replaceable dialogue, a protected local repair, exact artwork, non-integer timing/padding, conditional cable contact and ambiguous-job recovery.

Reselect after a demonstrated missing capability, repeated target failure, material component or resource change, loss of provider availability, or a documented new capability that addresses an existing failure. Two successive tuning changes without target improvement trigger a review of geometry/action/conditioning before more sampling. Record a deliberate budget extension rather than allowing an unbounded search. Preserve the incumbent and failed recipes.

## Dated primary-source evidence

Accessed 23 October 2026. These mutable pages require a fresh pinned check before implementation. The entries support candidate capabilities and constraints; none establishes local readiness or comparative superiority.

| Source | Evidence and decision |
| --- | --- |
| [ComfyUI models](https://docs.comfy.org/basic-concepts/models) and [server routes](https://docs.comfy.org/development/comfyui-server/comms_routes) | Matching loaders/workflows matter; custom nodes differ. Discovery, queueing, history and media retrieval are distinct. Persist exact schema/graph revisions and completion receipts. |
| [LTX Layout to Render](https://docs.ltx.io/open-source-model/vfx-post-production/layout-to-render) | Describes LTX 2.5 layout video plus corresponding art-directed image and optional keyframes, with canvas and `8k+1` frame constraints. Encode those constraints inside that adapter. |
| [LTX audio-to-video](https://docs.ltx.io/open-source-model/usage-guides/audio-to-video/) | Describes frozen input-audio latents across two stages and reattachment of the recording. Test PCM placement and delivery encoding separately from visible lip-sync. |
| [LTX IC-LoRA catalogue](https://docs.ltx.io/open-source-model/integration-tools/ic-lo-ra-adapters/) and [Ingredients 2.5 card](https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Ingredients) | The catalogue distinguishes model versions; reference-sheet control has its own input topology. Do not infer Layout/Ingredients or cross-version style compatibility from successful separate runs. |
| [Wan 2.2 official repository](https://github.com/Wan-Video/Wan2.2) | Lists base release 28 July 2025, speech-to-video 26 August 2025 and Animate 19 September 2025. Distinct routes may address different failures; this is not a current installed-model inventory. |
| [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html) | Explicit filters support timing, composition and audio work. Capture the installed binary/configuration and verify decoded results. |

Historical local findings are summarised in [research through-line](research-through-line.md). Their dated installed LTX/Klein/FIBO/H3 stack is neither a portable dependency list nor proof that those choices remain optimal.
