# Use the current Loom model as an agent

Agentbox provides an OpenCode agent profile at `loom-agent/current`. It discovers
the model advertised by Loom and sends ordinary OpenAI-compatible chat requests
with tools and, when advertised, image input. The model executes the agent loop
through OpenCode: it selects tools, receives their results and continues.

## Two uses of one endpoint

Loom remains the model-agnostic endpoint. Its default ontology retrieval,
scaffolding and verbatim answers are unchanged. The agent profile sends
`loom_options: {"scaffold": false}` on every request because an arbitrary repository
is not necessarily an ontology subject. This is an explicit request mode; it does
not disable Loom for other consumers or select different model weights.

The facade forwards agent SSE streams, including tool-call arguments, usage and
finish reasons. Its `x-loom-served-mode: passthrough` response header identifies
that path. Non-streaming responses retain the existing Loom JSON metadata.
The model's raw port remains an internal deployment detail.

## Refresh and run

After rebuilding Agentbox, the session seeder provisions this profile at startup.
Refresh providers without creating, deleting or restarting sessions:

```sh
node /opt/agentbox/scripts/aoe-seed-sessions.mjs --providers-only
opencode run --model loom-agent/current 'Explain this repository using the relevant installed skills.'
```

Before a rebuild, run the same script from the Agentbox source checkout.
`LOOM_BASE_URL` overrides the facade address. Discovery accepts a single advertised
model automatically. If the endpoint lists several models, set `LOOM_MODEL` to an
advertised ID. An unknown explicit ID, ambiguous listing or failed discovery
leaves the previous provider file intact and makes `--providers-only` exit nonzero.
The discovery request has a five-second timeout.

The legacy `GEMMA_MODEL` variable does not select this agent's model. The legacy
`loom-raw/qwen3.8-27B` profile remains an alias for saved sessions, but uses the
facade and the discovered wire ID. New seeded agent sessions use
`loom-agent/current`. Existing running sessions are not forcibly changed.

## Skills and images

The provider configuration adds the curated `~/.codex/skills` directory to
OpenCode's skill discovery paths. Existing skill paths are preserved. The agent
can load a skill and read its linked references using native tools; additional
specialists remain discoverable through the estate's skill directory and router.
The explainer skill supplies the task procedure, while OpenCode owns execution,
tool results, session persistence and context handling.

Attach a screenshot with `opencode run --model loom-agent/current --file /absolute/page.png -- 'Assess this page'`
or let the agent read an image through its tools. Advertised image capability
enables that input; it is not proof of correct interpretation. Servers lacking
capability metadata can use the explicit `LOOM_IMAGE_INPUT=true|false` override
after qualification. Video review can use ordered, timestamped frame images;
this profile does not advertise native video or audio understanding.

Qwen-specific generation options are applied in the Agentbox profile only when
the discovered model ID identifies Qwen. Its matching projector, Jinja template
and inference configuration belong to the HP model deployment. No Qwen-specific
logic is added to Loom's ontology or streaming implementation.

## Model swaps and qualification

After swapping the backend, refresh providers and start a new agent process to
load the new configuration. The logical `loom-agent/current` name stays the same;
its wire model ID, image input and context budget are rediscovered. This is
provisioning-time discovery, not automatic retargeting of a running session.
Context uses advertised metadata, capped at 131,072 tokens; unknown metadata
falls back to 8,192. Output reserves input room and is capped at 16,384 tokens.

Before using a replacement for a skill evaluation, qualify tool calls and returned
results, skill discovery, image-only facts, a visual defect and recovery from a
tool error. Record the served identity and deployment revision with the outputs.
Freeze that identity for each baseline/candidate comparison. A swap, template
change or projector change invalidates the prior qualification; finish or stop
the affected run and requalify. The harness does not yet enforce a deployment
fingerprint lock on every request.

## HP vision profile

The Loom repository's `deploy/compose.model-vision.yml` runs the shared HP model
with its matching projector and template. It uses the existing model image and
mounts the launcher from source. The pinned serving build requires DFlash to be
disabled for image turns; the profile sets `VISION=1` and `SPEC=off`. This affects
model throughput for all delegated consumers, while corpus-served Loom answers
continue to avoid inference. Measure throughput on the workload being assessed.

Pocket TTS remains a separate CPU speech service. Image understanding does not
establish pronunciation, intelligibility or audio timing.
