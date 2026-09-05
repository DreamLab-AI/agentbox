#!/usr/bin/env node
'use strict';

/**
 * check-manifest-catalogue.js — Invariant (ADR-039): every gate path declared
 * in the system-manifest CATALOGUE must resolve against the repo's
 * agentbox.toml to a boolean or a mode string. An unresolvable path means the
 * catalogue entry can never report a real state — /v1/system silently shows
 * 'available' for a feature that is actually on (the 'data_science.jupyter'
 * bug this check was born from).
 *
 * Also FAILS (ADR-2069) on an agentbox.toml boolean gate that has neither a
 * catalogue entry nor a place in the BASELINE below, so a new gate cannot be
 * added without either cataloguing it or classifying it. The BASELINE is a
 * ratchet: a stale entry fails too, so the list can only shrink.
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
process.env.AGENTBOX_MANIFEST_PATH = path.join(ROOT, 'agentbox.toml');

const { loadManifest } = require(path.join(ROOT, 'management-api', 'adapters', 'manifest-loader'));
const { CATALOGUE, resolveGate } = require(path.join(ROOT, 'management-api', 'lib', 'system-manifest'));

const manifest = loadManifest();

// ── 1. FAIL: catalogue gate paths that do not resolve ─────────────────────────
const broken = [];
for (const entry of CATALOGUE) {
  const gates = Array.isArray(entry.gates) ? entry.gates : entry.gate ? [entry.gate] : [];
  for (const g of gates) {
    const v = resolveGate(manifest, g);
    if (v === undefined) broken.push(`${entry.id}: gate '${g}' resolves to undefined`);
    else if (typeof v !== 'boolean' && typeof v !== 'string') {
      broken.push(`${entry.id}: gate '${g}' resolves to ${typeof v} (want boolean or mode string)`);
    }
  }
}

// ── 2. FAIL: toml boolean gates with no catalogue entry (ADR-2069) ────────────
// Was a WARN, which meant 130 uncatalogued keys accumulated silently and a new
// gate could be added with no catalogue entry forever. It is now a hard failure,
// with an explicit BASELINE of the keys that existed when the gate was tightened.
//
// The baseline is a RATCHET, not an escape hatch:
//   - a key that is uncatalogued and NOT in the baseline fails the build;
//   - a baseline key that has since been catalogued, or removed from
//     agentbox.toml, ALSO fails, so the list can only ever shrink.
// Adding a key here requires a reason that is true. The last group is the honest
// deficit: real capability gates that still need a CATALOGUE entry in
// management-api/lib/system-manifest.js.
const BASELINE = [
  {
    reason: 'sub-option of a catalogued capability — /v1/system reports the parent gate',
    keys: [
      'sovereign_mesh.solid_pod', 'sovereign_mesh.nostr_bridge', 'sovereign_mesh.https_bridge',
      'sovereign_mesh.publish_agent_events', 'sovereign_mesh.voice_intent', 'sovereign_mesh.kg_elevation',
      'sovereign_mesh.junkiejarvis', 'sovereign_mesh.per_user_agents', 'sovereign_mesh.mobile_bridge.enabled',
      'sovereign_mesh.relay.enabled', 'sovereign_mesh.relay.expose', 'sovereign_mesh.relay.pod_bridge',
      'sovereign_mesh.relay.allow_nip04', 'sovereign_mesh.git.enabled', 'sovereign_mesh.git.auto_init',
      'sovereign_mesh.git.read_public', 'sovereign_mesh.multi_user.enabled',
      'llm_marketplace.auto_advertise', 'desktop.webgpu',
      'skills.ruvnet_brain.auto_ingest', 'skills.ruvnet_brain.grounding_hook',
      'skills.ontology.direct_axiom_load', 'skills.ontology.local_authoring',
      'skills.ontology.condense.enabled', 'skills.ontology.condense.schedule_enabled',
      'skills.browser.playwright', 'skills.browser.qe_browser',
      'skills.code_interpreter.allow_pip_install',
      'integrations.ruvector_external.manage_sidecar', 'integrations.ruvector_external.hybrid_search',
      'integrations.ruvector_external.typed_metadata', 'integrations.ruvector_external.metadata_gin',
      'integrations.ruvector_external.health_tool', 'integrations.ruvector_external.episodic_ttl_sweep',
      'integrations.ruvector_external.memory_orient', 'integrations.ruvector_external.embedding_dual_write',
      'integrations.ruvector_external.graph_backbone',
      'memory_learning.record_trajectories', 'memory_learning.feed_retrieval', 'memory_learning.feed_routing',
      'memory_learning.sona_enabled', 'memory_learning.relevance_feedback', 'memory_learning.aggregate_sweep',
      'memory_learning.pattern_distillation', 'memory_learning.attention_rerank',
      'memory_learning.sona_learn_enabled', 'memory_learning.sona_apply_enabled',
      'memory_learning.param_tuning_enabled',
      'consultants.intelligence_signal', 'consultants.codex.enabled', 'consultants.antigravity.enabled',
      'consultants.zai.enabled', 'consultants.perplexity.enabled', 'consultants.deepseek.enabled',
      'privacy_filter.trust_remote_code', 'privacy_filter.openmed.enabled',
      'privacy_filter.openmed.license_acknowledged', 'privacy_filter.openmed.onnx_runtime_present',
      'privacy_filter.openmed.governance_acknowledged',
      'linked_data.round_trip_in_dispatch', 'linked_data.did.publish_to_well_known',
      'linked_data.viewer.expose_port', 'linked_data.viewer.upstream_panes_visible',
      'payments.consumer.enabled', 'payments.broadcast.enabled', 'payments.broadcast.well_known',
      'payments.broadcast.accepts_block', 'payments.broadcast.health_signals',
      'project_tracking.github_enrichment', 'project_tracking.primer_on_scan',
      'project_tracking.nostr_publish', 'project_tracking.metrics',
      'interaction_plane.proxy.strip', 'interaction_plane.proxy.worktree',
      'interaction_plane.proxy.eager_mandate', 'interaction_plane.coordinator.eager_mandate',
      'model_routing.aqe_agent_overrides', 'model_routing.dual_run',
      'resources.session_hygiene.reap',
      'compression.slots.memory', 'compression.slots.pods', 'compression.slots.events',
      'compression.slots.beads', 'compression.slots.orchestrator',
      'compression.algorithms.smart_crusher', 'compression.algorithms.log_compressor',
      'compression.algorithms.diff_compressor',
    ],
  },
  {
    reason: 'provider account/credential toggle — gates a key, not a runtime capability',
    keys: [
      'providers.anthropic.enabled', 'providers.openai.enabled', 'providers.gemini.enabled',
      'providers.deepseek.enabled', 'providers.perplexity.enabled', 'providers.openrouter.enabled',
      'providers.context7.enabled', 'providers.brave.enabled', 'providers.github.enabled',
      'providers.zai.enabled', 'providers.ollama.enabled', 'providers.ollama.sidecar',
    ],
  },
  {
    reason: 'upstream crate build feature (solid-pod-rs cargo features), not an agentbox gate',
    keys: [
      'integrations.solid_pod_rs.enable_oidc', 'integrations.solid_pod_rs.enable_schnorr_verify',
      'integrations.solid_pod_rs.enable_dpop_cache', 'integrations.solid_pod_rs.enable_mcp',
      'integrations.solid_pod_rs.sign_requests', 'integrations.solid_pod_rs.enable_did_nostr',
      'integrations.solid_pod_rs.enable_webhook_signing', 'integrations.solid_pod_rs.enable_rate_limit',
      'integrations.solid_pod_rs.enable_quota',
    ],
  },
  {
    reason: 'operator policy, attestation or host-topology knob — no package or supervised process behind it',
    keys: [
      'security.audit_acknowledged', 'mesh.honor_remote_moderation', 'networking.host_gateway',
      'resources.gpu_reservation', 'plugins.auto_update',
    ],
  },
  {
    reason: 'UNCATALOGUED CAPABILITY — a real gate still owed a CATALOGUE entry (ADR-2069 follow-up; entries live in management-api/lib/system-manifest.js)',
    keys: [
      'ontology_monitor.enabled',
      'skills.codeact.enabled', 'skills.voyager_skill_library.enabled', 'skills.email_search.enabled',
      'skills.authority.enabled', 'skills.payment_router.enabled',
      'skills.docs.report_builder', 'skills.design.open_design',
      'integrations.comfyui_external.enabled', 'features.expel_lesson_extraction.enabled',
      'memory_hygiene.allow_embedding_m3_backfill', 'memory_hygiene.allow_legacy_mining_import',
      'memory_hygiene.allow_pattern_graduation',
      'toolchains.claude', 'toolchains.claude_code',
      'plugins.memory.enabled', 'plugins.memory.enable_hnsw',
    ],
  },
];
const PENDING_REASON_PREFIX = 'UNCATALOGUED CAPABILITY';

const baselineKeys = new Map();
for (const group of BASELINE) {
  for (const k of group.keys) {
    if (baselineKeys.has(k)) broken.push(`baseline: '${k}' listed twice`);
    baselineKeys.set(k, group.reason);
  }
}

const catalogued = new Set(
  CATALOGUE.flatMap((e) => (Array.isArray(e.gates) ? e.gates : e.gate ? [e.gate] : []))
);
const uncatalogued = [];
const allBooleanKeys = new Set();
(function walk(obj, prefix) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'boolean') {
      allBooleanKeys.add(p);
      // Both spellings count as covered: the leaf path and the section path
      // (a section gate 'foo' resolves via foo.enabled).
      const sectionForm = k === 'enabled' ? prefix : null;
      if (!catalogued.has(p) && !(sectionForm && catalogued.has(sectionForm))) uncatalogued.push(p);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      walk(v, p);
    }
  }
})(manifest, '');

// 2a. new drift — an uncatalogued key nobody has classified.
const undeclared = uncatalogued.filter((p) => !baselineKeys.has(p));

// 2b. the ratchet — a baseline entry that is no longer earning its place.
const uncataloguedSet = new Set(uncatalogued);
const staleBaseline = [];
for (const [k] of baselineKeys) {
  if (!allBooleanKeys.has(k)) staleBaseline.push(`${k}: no longer a boolean key in agentbox.toml — drop it from BASELINE`);
  else if (!uncataloguedSet.has(k)) staleBaseline.push(`${k}: now has a CATALOGUE entry — drop it from BASELINE`);
}

// Keep the named capability deficit visible on every run.
const pending = [...baselineKeys].filter(([, r]) => r.startsWith(PENDING_REASON_PREFIX)).map(([k]) => k);
if (pending.length) {
  console.warn(`WARN (check-manifest-catalogue): ${pending.length} baselined key(s) are real capabilities still owed a CATALOGUE entry (ADR-2069):`);
  for (const p of pending) console.warn(`    ${p}`);
}

if (undeclared.length) {
  console.error(`FAIL (check-manifest-catalogue): ${undeclared.length} toml boolean key(s) with no catalogue entry`);
  console.error('  (not all booleans are feature gates — review, and catalogue real gates per ADR-039):');
  for (const p of undeclared) console.error(`    ${p}`);
  console.error('  Add a CATALOGUE entry in management-api/lib/system-manifest.js, or, if the key is');
  console.error('  deliberately not a capability, add it to BASELINE in this script with a true reason.');
  process.exit(1);
}

if (staleBaseline.length) {
  console.error(`FAIL (check-manifest-catalogue): ${staleBaseline.length} stale BASELINE entr(y|ies) — the baseline may only shrink:`);
  for (const b of staleBaseline) console.error(`    ${b}`);
  process.exit(1);
}

if (broken.length) {
  console.error('FAIL (check-manifest-catalogue): catalogue gate path(s) do not resolve against agentbox.toml:');
  for (const b of broken) console.error(`  ${b}`);
  console.error('  Fix the gate path in management-api/lib/system-manifest.js (or the toml key).');
  process.exit(1);
}

console.log(`PASS (check-manifest-catalogue): all ${catalogued.size} catalogue gate paths resolve against agentbox.toml`);
