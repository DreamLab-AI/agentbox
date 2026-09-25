'use strict';

/**
 * system-manifest — the live system view served at GET /v1/system (ADR-039).
 *
 * Back-ported from DreamLab-AI/docBox ADR-009 (slim core / surfaces /
 * modules) and ADR-002 (apply-class), adapted to agentbox: the CATALOGUE
 * below is hand-authored documentation-as-data (docBox's convention), but —
 * unlike docBox, whose System tab renders a static array — the enabled
 * STATE of every entry is introspected from the parsed agentbox.toml at
 * request time, and the core layer is composed from the resolved adapter
 * registry. The catalogue can drift from agentbox.toml (a new gate needs a
 * new entry); the state cannot.
 *
 * Apply-class taxonomy (agentbox semantics, three classes not docBox's four
 * — there is no hot-reloadable UI layout here, and "session" collapses into
 * "boot" because the entrypoint reconciles every boot):
 *   live    — read at operation time; flipping the key affects the running box
 *   boot    — read once at container boot; takes effect on the next restart
 *   rebuild — changes the Nix image composition; needs ./agentbox.sh rebuild
 *             (gate both the package set and the supervisor block — CLAUDE.md)
 *
 * @see ADR-039 §D1/§D2
 * @see ADR-005 (adapter slots), PRD-001 (capabilities and adapters)
 */

const APPLY_CLASSES = {
  live: 'Read at operation time — flipping the key affects the running box with no restart.',
  boot: 'Read once at container boot — takes effect on the next restart (the entrypoint reconciles every boot).',
  rebuild: 'Changes the Nix image composition — requires ./agentbox.sh rebuild (gate both the package set and the supervisor block).',
};

/**
 * Hand-authored catalogue of surfaces and modules. `gate` is the
 * agentbox.toml path whose value decides the state; a path ending in a
 * section name is resolved via that section's `enabled` key. `service` names
 * the supervisor program or compose sidecar that embodies the entry.
 */
const CATALOGUE = [
  // ── Surfaces — how people and agents interact ─────────────────────────────
  { id: 'management-api', name: 'Management API', layer: 'surface', gate: null,
    service: 'management-api', apply_class: 'boot',
    summary: 'Fastify control plane: tasks, memory, events, payments, projects, URI resolver, /docs.' },
  { id: 'terminal', name: 'tmux terminal (MAD layout)', layer: 'surface', gate: null,
    service: 'tmux-autostart', apply_class: 'boot',
    summary: 'Multi-tab fish/tmux terminal — the primary operator surface inside the container.' },
  { id: 'setup-wizard', name: 'Pre-boot setup wizard', layer: 'surface', gate: null,
    service: 'setup', apply_class: 'boot',
    summary: 'Ephemeral localhost manifest editor with schema validation; exits after saving. Operations live in the Agentbox cockpit.' },
  { id: 'code-server', name: 'Web VS Code (code-server)', layer: 'surface',
    gate: 'toolchains.code_server', service: 'code-server', apply_class: 'rebuild',
    summary: 'Browser IDE at cockpit /code/ through the identity proxy; service login remains enabled.' },
  { id: 'jupyter', name: 'JupyterLab', layer: 'surface',
    gate: 'skills.data_science.jupyter', service: 'jupyter-lab', apply_class: 'rebuild',
    summary: 'Notebooks at cockpit /jupyter/ through the identity proxy; service login remains enabled.' },
  { id: 'desktop', name: 'VNC desktop', layer: 'surface',
    gate: 'desktop.enabled', service: 'xvnc', apply_class: 'rebuild',
    summary: 'Graphical desktop reached through the agentbox.sh vnc SSH tunnel.' },
  { id: 'comfyui', name: 'ComfyUI', layer: 'surface',
    gate: 'skills.media.comfyui_builtin', service: 'comfyui-builtin', apply_class: 'rebuild',
    summary: 'Optional image workflow interface on loopback :8188.' },
  { id: 'linked-data-viewer', name: 'Linked-object viewer (/lo/*)', layer: 'surface',
    gate: 'linked_data.viewer.mode', apply_class: 'boot',
    summary: 'S12 viewer slot rendering JSON-LD surfaces; AGPL bundle, Source-Code header on every response (PRD-006 §15).' },
  { id: 'uri-resolver', name: 'Canonical URI resolver (/v1/uri)', layer: 'surface', gate: null,
    apply_class: 'boot',
    summary: 'Dereferences urn:agentbox:* (307/404/410). Always mounted — uniqueness is unconditional (ADR-013).' },
  { id: 'agent-events-stream', name: 'Agent-events stream', layer: 'surface', gate: null,
    apply_class: 'boot',
    summary: 'WS /v1/agent-events/stream live feed + hash-chained JSONL durable log (ADR-039 §D3).' },
  { id: 'metrics', name: 'Prometheus metrics (:9090 /metrics, :9091)', layer: 'surface', gate: null,
    apply_class: 'boot',
    summary: 'Adapter dispatch spans/metrics plus agentbox_project_* gauges; exporters optional (ADR-005).' },
  { id: 'interaction-plane', name: 'Interaction plane (Agent of Empires)', layer: 'surface',
    gate: 'interaction_plane', service: 'aoe-serve', apply_class: 'boot',
    summary: 'AoE serve dashboard + session manager (loopback :9095) behind the NIP-98 proxy that is its sole ingress; declarative [[interaction_plane.session_seeds]] replace the MAD tmux harness, each binding a did:nostr/URN/beads-epic/scoped-namespace at create (PRD-021/ADR-042/ADR-043). Daemon + proxy + seeds are boot-class; the aoe-with-web binary is a rebuild-class flake input (see aoe-serve-binary).' },
  { id: 'tab0-bridge', name: 'tab0-bridge (voice/nostr meta-controller)', layer: 'surface',
    gate: 'sovereign_mesh', service: 'tab0-bridge', apply_class: 'rebuild',
    summary: 'Voice/nostr meta-controller for tmux window 0 (:8971, ADR-044): OpenAI-compatible /v1/chat/completions LLM surface for the Unmute backend, /feed console WebSocket, and the tab0 injection seam onto the interaction plane (fail-open to tmux send-keys). Supervisor is the canonical owner ([program:tab0-bridge] runs deploy.sh reconcile then execs the bridge); the fleet SessionStart hook Job 3 is belt-and-braces reconciliation. Authenticated by the shared BRIDGE_TOKEN — minted into .env by `agentbox.sh up`, inherited via compose env_file, and read by `voice up` for KYUTAI_LLM_API_KEY + NIP98_PROXY_ALLOW_BEARER (security audit Findings 2 & 3).' },

  // ── Modules — optional capabilities, manifest-gated ───────────────────────
  { id: 'ruflo', name: 'ruflo CLI (= claude-flow)', layer: 'module',
    gates: ['toolchains.ruflo', 'toolchains.claude_flow'], apply_class: 'rebuild',
    summary: 'Swarm orchestration CLI — one Nix closure shipping ruflo + claude-flow + claude-flow-mcp bins (upstream renamed claude-flow to ruflo; claude_flow is the legacy alias gate).' },
  { id: 'agentic-qe', name: 'Agentic QE fleet (aqe)', layer: 'module',
    gate: 'toolchains.agentic_qe', apply_class: 'rebuild',
    summary: 'QE fleet CLI + MCP (aqe mcp registered at boot when enabled).' },
  { id: 'nagual-qe', name: 'nagual-qe', layer: 'module',
    gate: 'toolchains.nagual_qe', apply_class: 'rebuild',
    summary: 'Rust QE harness built from source (lib/nagual-qe.nix).' },
  { id: 'deepsec', name: 'deepsec security gate', layer: 'module',
    gates: ['toolchains.deepsec', 'security.deepsec.enabled'], apply_class: 'rebuild',
    summary: 'ADR-2033: vercel-labs deepsec vulnerability reviewer baked as a CLI; build-with-quality drives it in PR mode via scripts/deepsec-gate.sh under the [security.deepsec] policy.' },
  { id: 'codebase-memory', name: 'codebase-memory MCP', layer: 'module',
    gate: 'toolchains.codebase_memory', apply_class: 'rebuild',
    summary: 'Structural code-graph index MCP (callers, architecture, snippets).' },
  { id: 'metaharness-binaries', name: 'MetaHarness runtime CLIs', layer: 'module',
    gate: 'toolchains.metaharness', apply_class: 'rebuild',
    summary: 'ADR-064: bakes metaharness + metaharness-darwin CLIs at the plugin-pinned versions; makes score/genome/evolve/security-bench offline-functional.' },
  { id: 'metaharness-plugin', name: 'ruflo-metaharness plugin', layer: 'module',
    gate: null, apply_class: 'boot',
    summary: 'ADR-063: boot-symlinked from the ruflo plugin cache via [[plugins.packages]]; 13 harness-intelligence skills, graceful-degrade without the baked CLIs.' },
  { id: 'codex', name: 'OpenAI Codex CLI + MCP', layer: 'module',
    gate: 'toolchains.codex', apply_class: 'rebuild',
    summary: 'Rust-native codex binary (musl) + openai-codex MCP server; consultant + QE-court provider.' },
  { id: 'model-routing', name: 'Model routing (Claude/Codex per activity)', layer: 'module',
    gate: 'model_routing.enabled', apply_class: 'boot',
    summary: 'ADR-041: [model_routing.routes] projected every boot into .agentic-qe/llm-config.json agentOverrides (aqe >= 3.13.1, #568) + AQE_LLM_PROVIDER on the aqe MCP env; dual_run stays experimental (ruflo #2766).' },
  { id: 'model-routing-neural', name: 'Metaharness cost-optimal router console (AoE `router` session)', layer: 'module',
    gate: 'model_routing.neural.enabled', apply_class: 'rebuild',
    summary: 'ADR-2080: bakes the pinned ruflo router artefacts + MiniLM embedder (config/model-router/artefacts.json) into /opt/agentbox/model-router and exports AGENTBOX_MODEL_ROUTER_* at boot for the dedicated AoE `router` seed; the console embeds offline, routes via @metaharness/router KRR inside the ruflo closure, executes through OpenRouter, public-tier work only. Pre-rebuild fallback: ./agentbox.sh model-router fetch.' },
  { id: 'antigravity', name: 'Antigravity CLI', layer: 'module',
    gate: 'toolchains.antigravity_cli', apply_class: 'rebuild',
    summary: 'Gemini consultant harness CLI.' },
  { id: 'aoe-serve-binary', name: 'AoE serve binary (flake input)', layer: 'module',
    gate: 'interaction_plane', apply_class: 'rebuild',
    summary: 'inputs.aoe.packages.aoe-with-web (--features serve = axum + rust-embed dashboard), pinned commit, baked into the image package set — flipping [interaction_plane].enabled changes the Nix composition. Pin discipline: a bump past web/package-lock.json must recompute npmDepsHash (PRD-021 N-08).' },
  { id: 'rust-toolchain', name: 'Rust toolchain', layer: 'module',
    gate: 'toolchains.rust', apply_class: 'rebuild',
    summary: 'cargo/rustc in the image.' },
  { id: 'opencode', name: 'OpenCode CLI', layer: 'module',
    gate: 'toolchains.opencode', apply_class: 'rebuild',
    summary: 'OpenCode harness CLI — Nix-gated package set (flake.nix opencodePackages).' },
  { id: 'qgis-mcp', name: 'QGIS MCP', layer: 'module',
    gate: 'skills.spatial_and_3d.qgis', service: 'qgis-mcp', apply_class: 'rebuild',
    summary: 'Geospatial MCP server (:9877 plugin protocol); gated package + supervisor block.' },
  { id: 'blender-mcp', name: 'Blender MCP', layer: 'module',
    gate: 'skills.spatial_and_3d.blender', service: 'blender-mcp', apply_class: 'rebuild',
    summary: '3D modelling MCP server; gated package + supervisor block.' },
  { id: 'imagemagick-mcp', name: 'ImageMagick MCP', layer: 'module',
    gate: 'skills.media.imagemagick', service: 'imagemagick-mcp', apply_class: 'rebuild',
    summary: '2D image-processing MCP server; gated package + supervisor block.' },
  { id: 'ffmpeg', name: 'FFmpeg', layer: 'module',
    gate: 'skills.media.ffmpeg', apply_class: 'rebuild',
    summary: 'Media transcode toolchain in the image package set.' },
  { id: 'pytorch', name: 'PyTorch stack', layer: 'module', heavy: true,
    gate: 'skills.data_science.pytorch', apply_class: 'rebuild',
    summary: 'Python ML runtime baked into the image (pairs with toolchains.cuda for GPU).' },
  { id: 'docs-toolchain', name: 'Docs toolchain (Mermaid + LaTeX)', layer: 'module',
    gates: ['skills.docs.mermaid', 'skills.docs.latex'], apply_class: 'rebuild',
    summary: 'Diagram and typesetting toolchains in the image package set.' },
  { id: 'code-interpreter', name: 'Code interpreter sandbox', layer: 'module',
    gate: 'skills.code_interpreter.enabled', apply_class: 'rebuild',
    summary: 'Sandboxed execution environment (full gVisor/WASI isolation deferred — SEC-002, ADR-027).' },
  { id: 'web-researcher', name: 'web-researcher MCP', layer: 'module',
    gate: 'skills.research.web_researcher', apply_class: 'rebuild',
    summary: 'Multi-source cited-research Go MCP server, baked binary.' },
  { id: 'compression', name: 'Context compression (headroom)', layer: 'module',
    gate: 'compression.enabled', apply_class: 'rebuild',
    summary: 'headroom-napi context-compression bindings baked into the image.' },
  { id: 'tailscale', name: 'Tailscale networking', layer: 'module',
    gate: 'networking.tailscale', service: 'tailscaled', apply_class: 'rebuild',
    summary: 'tailscaled + tailscale-up supervisor programs; gated package + supervisor blocks.' },
  { id: 'dream-machine', name: 'Dream machine (nightly repo evolution)', layer: 'module',
    gate: 'dream_machine.enabled', service: 'dream-engine', apply_class: 'boot',
    summary: 'ADR-052 nightly evidence-gated repo evolution. The dream-engine binary is always baked; it self-reads [dream_machine] from /etc/agentbox.toml at start, so the gate is boot-class (restart applies it).' },
  { id: 'cuda', name: 'CUDA toolchain', layer: 'module', heavy: true,
    gate: 'toolchains.cuda', apply_class: 'rebuild',
    summary: 'CUDA userspace for GPU workloads.' },
  { id: 'browser-sidecar', name: 'Browser container (GPU Chrome)', layer: 'module', heavy: true,
    gate: 'skills.browser.agent_browser', service: 'browsercontainer', apply_class: 'live',
    summary: 'External compose sidecar (chrome-devtools-mcp at :8931/sse); managed at runtime via ./agentbox.sh browsercontainer.' },
  { id: 'gui-tools-sidecar', name: 'GUI tools sidecar (Blender/QGIS)', layer: 'module', heavy: true,
    gate: null, service: 'gui-tools-service', apply_class: 'live',
    summary: 'FHS GPU sidecar for BlenderMCP (:9876) and QGIS (:9877); ./agentbox.sh gui-tools.' },
  { id: 'voice-console', name: 'Voice + AoE operator console', layer: 'module', heavy: true,
    gate: 'voice', service: 'voice-console', apply_class: 'live',
    summary: 'ADR-044: same-origin operator cockpit (Caddy :8444) unifying the web voice loop and AoE session board. The UI/backend sidecar uses ./agentbox.sh voice; shared Nemotron ASR + Pocket TTS follow the core AgentBox lifecycle through docker-compose.speech.yml.' },
  { id: 'sovereign-mesh', name: 'Sovereign mesh (relay + pod bridge)', layer: 'module',
    gate: 'sovereign_mesh', service: 'nostr-pod-bridge', apply_class: 'rebuild',
    summary: 'nostr relay, pod-inbox bridge, kind-30840/30841 publishing (ADR-009). Rebuild-class: the solid-pod/https-bridge/relay supervisor blocks are composed conditionally in flake.nix (optionalString sovereignCfg.enabled) — flipping the gate changes the image, a restart does not apply it.' },
  { id: 'solid-pod', name: 'Solid pod (solid-pod-rs)', layer: 'module',
    gate: null, service: 'solid-pod', apply_class: 'rebuild',
    summary: 'Sovereign pod storage with NIP-98 auth on :8484 — first-class substrate, configured (not gated) via [integrations.solid_pod_rs] (ADR-010).' },
  { id: 'ruvector-external', name: 'RuVector retrieval gates', layer: 'module',
    gate: 'integrations.ruvector_external', apply_class: 'boot',
    summary: 'Hybrid search, typed metadata, TTL sweep, memory_health/orient against ruvector-postgres (ADR-036).' },
  { id: 'memory-learning', name: 'Memory learning loop', layer: 'module',
    gate: 'memory_learning', apply_class: 'boot',
    summary: 'Trajectory recording + corpus-gated retrieval/routing feeds (PRD-018).' },
  { id: 'memory-hygiene', name: 'Memory hygiene ops', layer: 'module',
    gates: ['memory_hygiene.allow_namespace_repair', 'memory_hygiene.allow_embedding_backfill', 'memory_hygiene.allow_legacy_archival'],
    apply_class: 'live',
    summary: 'Namespace repair / embedding backfill / legacy archival — three op gates read at op time, fail-closed (re-sealed 2026-07-05), dry-run default.' },
  { id: 'linked-data', name: 'Linked-Data surfaces', layer: 'module',
    gate: 'linked_data', apply_class: 'boot',
    summary: 'Eleven JSON-LD federation surfaces wrapping the adapters; contexts pinned at build (ADR-012).' },
  { id: 'payments', name: 'Payments (x402 ledger)', layer: 'module',
    gate: 'payments', apply_class: 'boot',
    summary: 'HTTP-402 web ledger: deposit, estimate, buy, withdraw.' },
  { id: 'llm-marketplace', name: 'LLM marketplace', layer: 'module',
    gate: 'llm_marketplace', apply_class: 'boot',
    summary: 'LLM resource adverts/grants over nostr kinds 38300-38305.' },
  { id: 'project-tracking', name: 'Project tracking', layer: 'module',
    gate: 'project_tracking', apply_class: 'boot',
    summary: 'TrackedProject URNs, agentbox_project_* gauges, kind-30841 digests (PRD-017).' },
  { id: 'consultants', name: 'Consultant tier', layer: 'module',
    gate: 'consultants', apply_class: 'boot',
    summary: 'Named cross-vendor consultants (codex, antigravity, zai, perplexity, deepseek) — E036.' },
  { id: 'privacy-filter', name: 'Privacy filter', layer: 'module', heavy: true,
    gate: 'privacy_filter', apply_class: 'boot',
    summary: 'ADR-008 PII redaction middleware; openmed clinical sidecar is compose-managed and separately fail-closed gated.' },
  { id: 'plugins', name: 'ruflo/claude-flow plugins', layer: 'module',
    gate: null, apply_class: 'boot',
    summary: 'Installed into $HOME/.claude-flow/plugins/ at entrypoint phase 7; package list is [[plugins.packages]] (arrays-of-tables, outside the loader subset — not introspected).' },
  { id: 'orchestration-proxy', name: 'ruflo orchestration proxy (swarm/agent/task/coordination)', layer: 'module',
    gate: 'integrations.ruvector_external.orchestration_proxy', apply_class: 'boot',
    summary: 'ADR-2082: the governed claude-flow MCP server (memory_* on ruvector-postgres) forwards swarm_init/agent_spawn/task_*/coordination_* to ONE filtered `ruflo mcp start` child per session, so the mcp__claude-flow__* names the agent templates bind resolve to real implementations. Category filter = [integrations.ruvector_external].orchestration_tools (CLAUDE_FLOW_MCP_TOOLS). memory_*/agentdb_*/embeddings_*/hooks_* are denied on the proxy side (ADR-2014 access invariant holds). Fail-open for orchestration only: no ruflo ⇒ honest stubs. BOOT-class: the entrypoint projects RUVECTOR_ORCHESTRATION_PROXY/_TOOLS into the claude-flow env in .mcp.json; a new Claude session picks it up. Off ⇒ the stub list is advertised byte-identically.' },
  { id: 'ruvnet-brain', name: 'RuvNet brain corpus', layer: 'module',
    gate: 'skills.ruvnet_brain', apply_class: 'boot',
    summary: 'ruvnet-kb namespace in ruvector-postgres, boot-reconciled ingest, search_ruvnet MCP.' },
  { id: 'claude-code-permissions', name: 'Claude Code permission posture', layer: 'module',
    gate: 'claude_code.permission_mode', off_values: ['default'], apply_class: 'boot',
    summary: 'ADR-2116: [claude_code].permission_mode (default bypassPermissions) and permission_deny are projected by `agentbox-manifest permissions-project` into ~/.claude/settings.json AND every $WORKSPACE/profiles/*/.claude/settings.json every boot (authoritative, not seed-if-unset: Claude Code rewrites settings from memory). bypass pre-accepts its warning dialog (skipDangerousModePermissionPrompt). Deny rules are enforced in bypass (probed 2026-09-25) but are prefix matches — `sh -c` wrappers evade them; they stop accidents and plain injected commands. Default deny: docker run / docker compose (the mounted host Docker socket is host root) and ssh. Projector-owned deny rules are tracked in agentboxManagedDeny; hand-added rules are never removed. BOOT-class: applies on container restart; a running session keeps its mode.' },
  { id: 'jev-compaction', name: 'Verbatim context compaction (System One / Jev)', layer: 'module',
    gate: 'features.jev_compaction', apply_class: 'boot',
    summary: 'ADR-2093: Claude Code function-hook plugin config/claude-plugins/jev-compaction replaces the compaction SUMMARY with Jev decisions per tool call (keep / truncate / drop); user and assistant text is never rewritten. Email taint gate: a transcript containing any mcp__email-gateway__* / Gmail call or an email-search Skill load is never sent — the built-in summary runs. Switch: /jev-compact on|off|status (plugin store). Fails open to the built-in compaction on any error, missing TYPESAFE_API_KEY or reduction < min_reduction_ratio. BOOT-class: the entrypoint sets CLAUDE_CODE_ENABLE_FUNCTION_HOOKS, registers the `agentbox` directory marketplace and installs the plugin via `claude plugin`; false uninstalls and retracts. Needs Claude Code >= 2.1.274 (image pin 2.1.276). Egress widened from ADR-2090 by operator decision with the email carve-out. Amended 2026-09-25: the taint is STICKY per session (plugin store, marked at the email tool call / skill expansion / every turn scan) so a built-in summary that absorbed email is never later sent; trigger = min(compact_at_percent of the window, compact_at_tokens=180k) with rearm_tokens hysteresis after every compaction; cache_warm compacts (or notifies) an idle session above cache_warm_floor_tokens shortly before its prompt cache expires (TTL detected or cache_ttl_seconds).' },
  { id: 'sovereign-system-one', name: 'Sovereign System One (local typed decisions)', layer: 'module',
    gate: 'features.sovereign_system_one', apply_class: 'boot',
    summary: 'ADR-2094: repoints BOTH System One consumers (the live skill router, ADR-2091, and Jev verbatim compaction, ADR-2093) from api.typesafe.ai at a LAN sidecar — system-one-facade on systemone:8097 over a loopback-only laya engine (services/laya-engine, open weights, Apache-2.0). The façade absorbs the capacity gap the cloud never had: option shortlisting (embedding-ranked top shortlist_k, always retaining none/other) and state windowing (top window_k), then re-expands so the answer names one of the CALLER\'S original options with probability mass over ALL of them. BOOT-class HERE: the entrypoint runs `agentbox-manifest sso-project` and projects AGENTBOX_SKILL_ROUTE_API/_MODEL into runtime-env.sh and the router hook, plus baseUrl/model/backendLocal into the jev-compaction plugin userConfig — a flip applies on container restart and needs no image rebuild. The SIDECAR is a separate lifecycle (./agentbox.sh systemone up, docker-compose.system-one.yml, GPU, ~1.7 GB of weights on a named volume); enabling the gate without the sidecar running leaves the consumers failing open to their built-in paths. Disabled ⇒ NOTHING is projected and the cloud path is byte-identical (ADR-2020). An endpoint that is not LAN/loopback is REFUSED, not projected (E075), and the email taint fence keys off the explicit backendLocal boolean, never off the URL (ADR-2094 §5). Validator: E075/W073; W071/W072 stand down when this gate is on because TYPESAFE_API_KEY is no longer on the path.' },
  // The gate is the MODE STRING, not the section: [skills.routing] has no
  // `enabled` key — router = "jev" | "table" carries the state — so the section
  // path resolved to undefined and the capability was reported as unconfigured.
  // "table" is this capability's off value: it is the pre-2091 path with the
  // hook de-registered (ADR-2091), hence off_values rather than a global rule.
  { id: 'skill-router', name: 'Live skill router (System One / Jev)', layer: 'module',
    gate: 'skills.routing.router', off_values: ['table'], apply_class: 'boot',
    summary: 'ADR-2091: [skills.routing].router="jev" registers config/hooks/skill-route.cjs on UserPromptSubmit — one Choice over every routable skill description per turn, pick injected as advisory context — and /route (skills/skill-router/scripts/route.mjs) uses the same library. FAILS OPEN to router="table" (the pre-2091 path: always-loaded descriptions + routing-table.md) on any error, timeout, 429/529, missing TYPESAFE_API_KEY or a `none` pick. Egress of the routing prompt is accepted for skill routing only (ADR-2090). BOOT-class: the entrypoint inlines model/timeout/min-chars into the hook command and runtime-env.sh; router="table" or hook=false retracts the registration on the next boot (byte-identical-when-off). No image change on either value. cascade=true (ADR-2095 addendum, default off) answers turns whose local BM25 margin reaches cascade_cutoff in-process and escalates only the rest to the judge. label_log=true (ADR-2110, proposed, default off) registers config/hooks/routing-label-recorder.cjs on Stop to record per-turn teacher labels (prompt embedding, skills the main model used, router pick) into routing_labels — never prompt text, LAN-only embeddings, email turns excluded.' },
  { id: 'skill-router-cascade', name: 'Skill router local BM25 cascade', layer: 'module',
    gate: 'skills.routing.cascade', apply_class: 'boot',
    summary: 'ADR-2095 addendum: a BM25 ranker over the skill rubrics answers a routing turn in-process when its relative top-two margin reaches [skills.routing].cascade_cutoff (default 0.3718); only the rest escalate to the judge. Off by default; boot inlines the variables into the hook command and runtime-env.sh only when on, so off is byte-identical. The JS ranker is held to system-one-eval by tests/system-one/cascade-parity. Validator E076.' },
  { id: 'routing-teacher-labels', name: 'Routing teacher labels (PROPOSED)', layer: 'module',
    gate: 'skills.routing.label_log', apply_class: 'boot',
    summary: 'ADR-2110 (proposed): at Stop, config/hooks/routing-label-recorder.cjs writes one routing_labels row per real user turn — the prompt\'s LAN bge-small embedding (never its text), the skills the main model actually used, and the router\'s pick. Email-gateway turns are never embedded; an off-LAN embeddings URL is refused (E077). Off until the ADR is accepted: storing prompt embeddings changes the ADR-2090 retention contract. Boot registration is byte-identical when off.' },
  { id: 'ontology', name: 'Ontology bridge', layer: 'module',
    gate: 'skills.ontology', apply_class: 'boot',
    summary: 'ontology_ask / governed writeback MCP bridge (PRD-020 binding).' },
  // ADR-2057 — the three gates that existed (or should have existed) without a
  // catalogue entry. Apply classes differ by WHERE the gate is consumed, per the
  // ADR-039 honesty rule: harness/precedent are read by the entrypoint at boot,
  // podcast_ingest decides baked supervisor text and so needs a rebuild.
  { id: 'harness-bridge', name: 'Harness Engineering MCP bridge', layer: 'module',
    gate: 'skills.harness', apply_class: 'boot',
    summary: 'ADR-004 harness_list/inspect/validate/audit over the guide-sensor pairing templates. ADR-2057 gap 2: the entrypoint now reads this gate before registering harness-bridge in .mcp.json (it previously checked only that the server file existed, so enabled=false was ignored). BOOT-class — a flip applies on restart. [skills.harness].template_dir is projected into the server env as HARNESS_TEMPLATE_DIR (ADR-2057 gap 4), upserted every boot. Skipping registration does not retract an entry a previous boot already wrote.' },
  { id: 'colloquy', name: 'Colloquy shared-agent learning', layer: 'module',
    gate: 'skills.colloquy', apply_class: 'boot',
    summary: 'ADR-2085 query/propose/confirm/flag/reflect/status over cq knowledge units — the generalisation of precedent-bridge off governance decisions onto the four-level ladder. BOOT-class: the entrypoint reads this gate before registering `colloquy` in .mcp.json, and the binary is always baked (a flip never needs a rebuild). store_path is projected into the server env as COLLOQUY_STORE_PATH; namespace is for the SHARED tier, which the management API composes, not this stdio server. Registration is SKIPPED with a warning when AGENTBOX_PUBKEY or COLLOQUY_PRINCIPAL is absent — ADR-2086 counts confidence per authorising principal, so an unidentified member must not attest. Skipping registration does not retract an entry a previous boot already wrote.' },
  { id: 'podcast-ingest', name: 'Podcast ingestion schedule', layer: 'module',
    gate: 'skills.podcast_ingest', service: 'podcast-cron', apply_class: 'rebuild',
    summary: 'ADR-2057 gap 1: [program:podcast-cron] (supercronic over skills/podcast-knowledge-ingest/crontab) was the last unconditionally supervised program. Default true = the behaviour it shipped with, so enabling is never a migration step. REBUILD-class — flake.nix bakes the supervisor text, so false only removes the program after ./agentbox.sh rebuild. Gates the SCHEDULE only: the podcast-ingest binary and supercronic stay in the closure, both shared with always-baked surfaces (the podcast-{knowledge,bulk}-ingest skills and forum-backup-cron).' },
  // ADR-2020 review_trigger (a new optional block in agentbox.toml) — the
  // [vault] section is split across TWO catalogue entries because its keys have
  // genuinely different apply classes (ADR-039 honesty rule): root/pages/format
  // are read once by the entrypoint at container boot, whereas tui decides the
  // Nix package set and only takes effect after a rebuild. One entry claiming
  // 'boot' for both would tell an operator that flipping tui = "rune" and
  // restarting gets them the Rune TUI, which it does not.
  { id: 'vault', name: 'Authored corpus (vault)', layer: 'module',
    gate: 'vault.format', apply_class: 'boot',
    summary: 'ADR-2028: [vault].root/pages/format are the single path authority for the authored corpus. The entrypoint reads them at boot and exports VAULT_ROOT/VAULT_PAGES/VAULT_FORMAT to every supervised program and tmux window; resolved values are in the top-level `vault` block of this view.' },
  { id: 'vault-tui', name: 'Vault TUI (Rune, tmux window 9 "Notes")', layer: 'module',
    gate: 'vault.tui', apply_class: 'rebuild',
    summary: 'ADR-2029: [vault].tui = "rune" puts the Rune markdown TUI in the Nix package set and opens tmux window 9 "Notes" at the vault root. REBUILD-class — the package set is resolved at image composition, so "none" -> "rune" needs ./agentbox.sh rebuild, not a restart.' },
  { id: 'vault-cli', name: 'Vault corpus CLI (the one door to the corpus)', layer: 'module',
    gate: 'vault.cli', apply_class: 'rebuild',
    summary: 'ADR-2107/ADR-2108: [vault].cli = true bakes the `vault` corpus CLI (crates/vault) into the Nix package set at /opt/agentbox/bin/vault; agents reach the corpus through it and the Loom over HTTP since the ontology-bridge MCP server was retired, so false leaves agents with no door. REBUILD-class — the package set is resolved at image composition; boot Phase 5d runs `vault --version` as the liveness half of the gate.' },
  { id: 'aci-shell', name: 'ACI shell', layer: 'module',
    gate: 'skills.aci_shell', apply_class: 'rebuild',
    summary: 'Code-as-harness ACI sessions; npm closure baked via makeNpmService.' },
  { id: 'tree-search-coder', name: 'Tree-search coder', layer: 'module',
    gate: 'skills.tree_search_coder', apply_class: 'rebuild',
    summary: 'ADR-020 Surface 2: execution-gated best-of-N code search over the ADR-018 kernel; orchestration skill (SKILL.md only), explicit-invocation, spend-capped.' },
  { id: 'gaussian-splatting', name: '3DGS stack', layer: 'module', heavy: true,
    gate: 'skills.spatial_and_3d.gaussian_splatting', apply_class: 'rebuild',
    summary: 'Gaussian-splatting toolchain (E006), CUDA-gated.' },
  // ADR-2034 — resource topology. The envelope is BOOT-class (the generated
  // compose is re-read on `up`), the resident paths are REBUILD-class (they
  // add supervised programs and binaries to the image).
  { id: 'resources-envelope', name: 'Container envelope (cpus/cpuset/pids/shm/tmpfs)', layer: 'module',
    gate: 'resources.envelope', apply_class: 'boot',
    summary: 'ADR-2034 §3: [resources] projected by flake.nix into the generated docker-compose.yml deploy block; the override carries no limits. Takes effect on compose re-up.' },
  { id: 'mcp-hub', name: 'Shared MCP hub (loopback :9720)', layer: 'module',
    gate: 'resources.mcp_hub.enabled', apply_class: 'rebuild',
    summary: 'ADR-2034 §2: agentbox-mcp hub runs each stateless MCP server once and serves every session over streamable HTTP; the entrypoint projects listed .mcp.json entries to type: http.' },
  { id: 'hook-shim', name: 'Resident hook shim + drain', layer: 'module',
    gate: 'resources.hooks.shim', apply_class: 'rebuild',
    summary: 'ADR-2034 §1: agentbox-hook replaces per-tool-call ruflo CLI boots with a <10 ms spool write; [program:agentbox-hook-drain] folds spools into the events volume.' },
  { id: 'teammate-gc', name: 'Idle teammate reaper', layer: 'module',
    gate: 'resources.session_hygiene.enabled', apply_class: 'rebuild',
    summary: 'ADR-2034: teammate-gc SIGTERMs agent-team teammates whose CPU counter has not advanced for idle_secs (pid-reuse guarded, ADR-2032); reap=false reports only.' },
];

/** Resolve a dotted gate path against the parsed manifest. */
function resolveGate(manifest, gatePath) {
  let cursor = manifest;
  for (const key of gatePath.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = cursor[key];
  }
  // Section gates resolve through their `enabled` key.
  if (cursor != null && typeof cursor === 'object') {
    return cursor.enabled;
  }
  return cursor;
}

/** Map a gate value to a docBox-style module state word. */
function stateOf(manifest, entry) {
  // Multi-gate entries (e.g. memory_hygiene's three op gates): any-true = on,
  // all-false = off, none present = available.
  if (Array.isArray(entry.gates)) {
    const values = entry.gates.map((g) => resolveGate(manifest, g));
    if (values.some((v) => v === true)) return 'on';
    if (values.some((v) => v === false)) return 'off';
    return 'available';
  }
  if (!entry.gate) return 'on'; // ungated surface/service: present when the image is
  const value = resolveGate(manifest, entry.gate);
  if (value === true) return 'on';
  if (value === false) return 'off';
  // Mode-string gates (e.g. linked_data.viewer.mode, vault.tui): any mode other
  // than an explicit off-mode means the surface is active. Both spellings count
  // as off — "none" is the conventional disabled value for a mode string that
  // names a thing rather than a state (vault.tui = "rune" | "none").
  // A capability may name its own off modes (skill-router: "table"); 'off' and
  // 'none' are the conventional ones every mode gate gets for free.
  if (typeof value === 'string') {
    const offModes = new Set(['off', 'none', ...(Array.isArray(entry.off_values) ? entry.off_values : [])]);
    return offModes.has(value) ? 'off' : 'on';
  }
  return 'available'; // gate absent from the manifest — catalogued but unconfigured
}

/**
 * Compose the live system view.
 * @param {object} manifest - parsed agentbox.toml
 * @param {object} [adapters] - resolved adapter registry (slot -> BaseAdapter)
 */
function buildSystemView(manifest, adapters) {
  const core = [
    {
      id: 'manifest', name: 'agentbox.toml manifest', layer: 'core', state: 'core',
      summary: 'The running configuration — feature gates and toolchains; reconciled by the entrypoint every boot.',
    },
    {
      id: 'identity', name: 'Identity + URN minting', layer: 'core', state: 'core',
      summary: 'did:nostr identity and urn:agentbox:* grammar, minted only through lib/uris.js (ADR-013).',
    },
  ];
  const SLOTS = ['beads', 'pods', 'memory', 'events', 'orchestrator'];
  for (const slot of SLOTS) {
    const adapter = adapters ? adapters[slot] : null;
    core.push({
      id: `adapter-${slot}`, name: `Adapter slot: ${slot}`, layer: 'core', state: 'core',
      impl: adapter ? adapter.impl : 'unresolved',
      contract_version: adapter ? adapter.CONTRACT_VERSION : null,
      summary: 'Durable-state slot; every dispatch wrapped by observability → privacy redaction (ADR-2036). JSON-LD encoding is a per-surface gated stage invoked by the owning route, not a dispatch layer; its ordering is enforced by the privacy marker (ADR-012, DDD-004 §L08).',
    });
  }

  // ADR-2028 D5: report the RESOLVED vault so the management API and the doctor
  // can show drift between the manifest and what the running container is
  // actually indexing. `env_*` is what the entrypoint exported into this
  // process; a mismatch with `root`/`pages` means the manifest changed since
  // boot and the container needs a restart to pick it up.
  const vaultSection = manifest && typeof manifest.vault === 'object' ? manifest.vault : null;
  const vaultRoot = vaultSection && typeof vaultSection.root === 'string' ? vaultSection.root : null;
  const vaultPagesRel = vaultSection && typeof vaultSection.pages === 'string' ? vaultSection.pages : 'pages';
  const vault = {
    enabled: Boolean(vaultRoot),
    root: vaultRoot,
    pages: vaultRoot ? `${vaultRoot.replace(/\/+$/, '')}/${vaultPagesRel}` : null,
    format: (vaultSection && vaultSection.format) || (vaultRoot ? 'obsidian' : null),
    tui: (vaultSection && vaultSection.tui) || (vaultRoot ? 'none' : null),
    // ADR-2028 amendment (2026-09-02): sibling vault roots + transcript store.
    working_root: (vaultSection && typeof vaultSection.working === 'string') ? vaultSection.working : null,
    working_pages: (vaultSection && typeof vaultSection.working === 'string') ? `${vaultSection.working.replace(/\/+$/, '')}/pages` : null,
    transcripts: (vaultSection && typeof vaultSection.transcripts === 'string') ? vaultSection.transcripts : null,
    env_working_pages: process.env.VAULT_WORKING_PAGES || null,
    env_transcripts: process.env.VAULT_TRANSCRIPTS || null,
    env_root: process.env.VAULT_ROOT || null,
    env_pages: process.env.VAULT_PAGES || null,
    drift: Boolean(vaultRoot) && Boolean(process.env.VAULT_ROOT) && process.env.VAULT_ROOT !== vaultRoot,
  };

  const surfaces = [];
  const modules = [];
  for (const entry of CATALOGUE) {
    const view = {
      id: entry.id,
      name: entry.name,
      layer: entry.layer,
      state: stateOf(manifest, entry),
      gate: entry.gate || (Array.isArray(entry.gates) ? entry.gates : null),
      apply_class: entry.apply_class,
      summary: entry.summary,
    };
    if (entry.service) view.service = entry.service;
    if (entry.heavy) view.heavy = true;
    (entry.layer === 'surface' ? surfaces : modules).push(view);
  }

  return {
    apply_classes: APPLY_CLASSES,
    core,
    vault,
    surfaces,
    modules,
    counts: {
      core: core.length,
      surfaces_on: surfaces.filter((s) => s.state === 'on').length,
      surfaces: surfaces.length,
      modules_on: modules.filter((m) => m.state === 'on').length,
      modules: modules.length,
    },
  };
}

module.exports = { APPLY_CLASSES, CATALOGUE, buildSystemView, resolveGate };
