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
  { id: 'setup-dashboard', name: 'Setup dashboard', layer: 'surface', gate: null,
    service: 'setup', apply_class: 'boot',
    summary: 'Pre-boot manifest editor with schema validation; post-boot ops dashboard (PRD-012/ADR-024).' },
  { id: 'code-server', name: 'Web VS Code (code-server)', layer: 'surface',
    gate: 'toolchains.code_server', service: 'code-server', apply_class: 'rebuild',
    summary: 'Browser IDE served from the image; Nix-gated package + supervisor block.' },
  { id: 'linked-data-viewer', name: 'Linked-object viewer (/lo/*)', layer: 'surface',
    gate: 'linked_data.viewer', apply_class: 'boot',
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
  { id: 'codebase-memory', name: 'codebase-memory MCP', layer: 'module',
    gate: 'toolchains.codebase_memory', apply_class: 'rebuild',
    summary: 'Structural code-graph index MCP (callers, architecture, snippets).' },
  { id: 'codex', name: 'OpenAI Codex CLI + MCP', layer: 'module',
    gate: 'toolchains.codex', apply_class: 'rebuild',
    summary: 'Rust-native codex binary (musl) + openai-codex MCP server; consultant + QE-court provider.' },
  { id: 'model-routing', name: 'Model routing (Claude/Codex per activity)', layer: 'module',
    gate: 'model_routing.enabled', apply_class: 'boot',
    summary: 'ADR-041: [model_routing.routes] projected every boot into .agentic-qe/llm-config.json agentOverrides (aqe >= 3.13.1, #568) + AQE_LLM_PROVIDER on the aqe MCP env; dual_run stays experimental (ruflo #2766).' },
  { id: 'antigravity', name: 'Antigravity CLI', layer: 'module',
    gate: 'toolchains.antigravity_cli', apply_class: 'rebuild',
    summary: 'Gemini consultant harness CLI.' },
  { id: 'aoe-serve-binary', name: 'AoE serve binary (flake input)', layer: 'module',
    gate: 'interaction_plane', apply_class: 'rebuild',
    summary: 'inputs.aoe.packages.aoe-with-web (--features serve = axum + rust-embed dashboard), pinned commit, baked into the image package set — flipping [interaction_plane].enabled changes the Nix composition. Pin discipline: a bump past web/package-lock.json must recompute npmDepsHash (PRD-021 N-08).' },
  { id: 'rust-toolchain', name: 'Rust toolchain', layer: 'module',
    gate: 'toolchains.rust', apply_class: 'rebuild',
    summary: 'cargo/rustc in the image.' },
  { id: 'cuda', name: 'CUDA toolchain', layer: 'module', heavy: true,
    gate: 'toolchains.cuda', apply_class: 'rebuild',
    summary: 'CUDA userspace for GPU workloads.' },
  { id: 'browser-sidecar', name: 'Browser container (GPU Chrome)', layer: 'module', heavy: true,
    gate: 'skills.browser.agent_browser', service: 'browsercontainer', apply_class: 'live',
    summary: 'External compose sidecar (chrome-devtools-mcp at :8931/sse); managed at runtime via ./agentbox.sh browsercontainer.' },
  { id: 'gui-tools-sidecar', name: 'GUI tools sidecar (Blender/QGIS)', layer: 'module', heavy: true,
    gate: null, service: 'gui-tools-service', apply_class: 'live',
    summary: 'FHS GPU sidecar for BlenderMCP (:9876) and QGIS (:9877); ./agentbox.sh gui-tools.' },
  { id: 'sovereign-mesh', name: 'Sovereign mesh (relay + pod bridge)', layer: 'module',
    gate: 'sovereign_mesh', service: 'nostr-pod-bridge', apply_class: 'boot',
    summary: 'nostr relay, pod-inbox bridge, kind-30840/30841 publishing (ADR-009).' },
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
  { id: 'ruvnet-brain', name: 'RuvNet brain corpus', layer: 'module',
    gate: 'skills.ruvnet_brain', apply_class: 'boot',
    summary: 'ruvnet-kb namespace in ruvector-postgres, boot-reconciled ingest, search_ruvnet MCP.' },
  { id: 'ontology', name: 'Ontology bridge', layer: 'module',
    gate: 'skills.ontology', apply_class: 'boot',
    summary: 'ontology_ask / governed writeback MCP bridge (PRD-020 binding).' },
  { id: 'aci-shell', name: 'ACI shell', layer: 'module',
    gate: 'skills.aci_shell', apply_class: 'rebuild',
    summary: 'Code-as-harness ACI sessions; npm closure baked via makeNpmService.' },
  { id: 'gaussian-splatting', name: '3DGS stack', layer: 'module', heavy: true,
    gate: 'skills.spatial_and_3d.gaussian_splatting', apply_class: 'rebuild',
    summary: 'Gaussian-splatting toolchain (E006), CUDA-gated.' },
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
      summary: 'Durable-state slot; every dispatch wrapped by observability → privacy → JSON-LD middleware (ADR-005/008/012).',
    });
  }

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
