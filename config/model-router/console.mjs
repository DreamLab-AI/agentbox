#!/usr/bin/env node
// ============================================================================
// agentbox model-router console — ADR-2080 (Phase 0 of ADR-2079)
// ----------------------------------------------------------------------------
// A dedicated Agent-of-Empires session that turns the metaharness cost-optimal
// router (shipped inside the baked ruflo closure, ADR-148/149) into something an
// operator can use for PUBLIC, open-source day-to-day work:
//
//   task text ──embed (MiniLM, offline)──▶ ruflo ModelRouter.route(task, embedding)
//            ──▶ metaharness KRR predicts per-candidate quality, picks the cheapest
//                candidate above the quality bar (OpenRouter slug)
//            ──▶ execute via ruflo's own provider router (OpenRouter branch)
//            ──▶ labelled receipt (model, cost, latency, outcome) + bandit outcome
//                + DRACO-shaped trajectory row so ruflo's promotion gate applies.
//
// Why this exists as a console and not "just ruflo": the npm tarball ships no
// router artefacts (config/model-router/artefacts.json vendors them), and
// ruflo's task-embedder imports '@xenova/transformers', which the closure does
// not carry — so ruflo's neural path silently falls back to the bandit. This
// console embeds the task itself with the closure's @huggingface/transformers
// and calls the router directly. Nothing in the AoE or ruflo trees is patched.
//
// Privacy (ADR-2079 §4): this console dispatches to an EXTERNAL provider. It
// refuses to start unless the privacy tier is `public`, and refuses to execute
// (dry-run only) when the ADR-2026 egress switch is off. Personal or LAN-only
// content belongs in the Loom sessions, never here.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; };
if (flag('--help') || flag('-h')) {
  process.stdout.write(`agentbox model-router console (ADR-2080)

usage: console.mjs [--once "<task>"] [--dry-run] [--json] [--file <path>]
                   [--max-tokens N] [--system "<prompt>"] [--status]

  (no args)        interactive REPL — type a task, get a routed answer
  --once <task>    route (and execute) one task, print the receipt, exit
  --dry-run        route only; never call a provider
  --json           machine-readable receipts (one JSON object per line)
  --file <path>    attach a file's contents as context for --once
  --status         print router backend / artefact status and exit

REPL commands: /file <path>  /dry on|off  /verdict s|f|e  /escalate  /status  /help  /quit
env (set by the entrypoint from [model_routing.neural], all optional):
  AGENTBOX_MODEL_ROUTER_DIR           artefacts (default /opt/agentbox/model-router,
                                      fallback $WORKSPACE/.agentbox/model-router)
  AGENTBOX_MODEL_ROUTER_PROVIDER      openrouter (default) | anthropic
  AGENTBOX_MODEL_ROUTER_QUALITY_BAR   0.50 default (0.25 always-cheapest … 0.70 strict)
  AGENTBOX_MODEL_ROUTER_COST_CEILING_USD_PER_MTOK   0 = off
  AGENTBOX_MODEL_ROUTER_PRIVACY_TIER  must be "public"
  AGENTBOX_MODEL_ROUTER_STATE_DIR     bandit state + trajectories + ledger
  RUFLO_NODE_MODULES                  override the ruflo closure node_modules
`);
  process.exit(0);
}
const ONCE = opt('--once', null);
const JSON_OUT = flag('--json');
let DRY = flag('--dry-run');
const STATUS_ONLY = flag('--status');
const MAX_TOKENS = parseInt(opt('--max-tokens', '2048'), 10) || 2048;
const SYSTEM_PROMPT = opt('--system',
  'You are a senior software engineer helping with an open-source codebase. ' +
  'Answer directly, show code when useful, and state assumptions explicitly.');

const WORKSPACE = process.env.WORKSPACE || path.join(os.homedir(), 'workspace');
const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};
const say = (s) => { if (!JSON_OUT) process.stdout.write(s + '\n'); };
const die = (...lines) => {
  process.stderr.write('\n' + c.red('model-router console — FATAL') + '\n' + lines.map((l) => '  ' + l).join('\n') + '\n\n');
  process.exit(1);
};

// ---------------------------------------------------------------------------
// Privacy + egress guards (fail closed, before anything loads)
// ---------------------------------------------------------------------------
const TIER = (process.env.AGENTBOX_MODEL_ROUTER_PRIVACY_TIER || 'public').toLowerCase();
if (TIER !== 'public') {
  die(`privacy tier is "${TIER}" — this console dispatches to an external provider and only serves PUBLIC work.`,
    'Personal or LAN-only content goes through the Loom sessions (slug loom / loom-raw), never through OpenRouter.');
}
const EGRESS_OFF = String(process.env.AGENTBOX_EGRESS ?? '').trim() === '0';
if (EGRESS_OFF && !DRY) {
  say(c.yellow('AGENTBOX_EGRESS=0 (ADR-2026): provider calls are disabled — running in dry-run (route only).'));
  DRY = true;
}

// ---------------------------------------------------------------------------
// Locate the baked ruflo closure (never patched, only imported)
// ---------------------------------------------------------------------------
function resolveRufloNodeModules() {
  if (process.env.RUFLO_NODE_MODULES) return process.env.RUFLO_NODE_MODULES;
  let bin;
  try { bin = execFileSync('sh', ['-c', 'command -v ruflo'], { encoding: 'utf8' }).trim(); } catch { bin = ''; }
  if (!bin) return null;
  const real = fs.realpathSync(bin);
  // /nix/store/<hash>-ruflo-<ver>/bin/ruflo → …/lib/ruflo/node_modules
  const candidates = [
    path.resolve(path.dirname(real), '..', 'lib', 'ruflo', 'node_modules'),
    path.resolve(path.dirname(real), '..', 'node_modules'),
  ];
  return candidates.find((d) => fs.existsSync(path.join(d, '@claude-flow', 'cli', 'dist', 'src', 'ruvector', 'model-router.js'))) || null;
}
const NM = resolveRufloNodeModules();
if (!NM) die('cannot locate the ruflo closure (need @claude-flow/cli/dist/src/ruvector/model-router.js).',
  'Set RUFLO_NODE_MODULES=/nix/store/<hash>-ruflo-<ver>/lib/ruflo/node_modules or put `ruflo` on PATH.');
const CLI = path.join(NM, '@claude-flow', 'cli', 'dist', 'src');

// ---------------------------------------------------------------------------
// Locate the vendored artefacts (baked, else pre-rebuild fallback)
// ---------------------------------------------------------------------------
const REQUIRED = [
  'seed-rows.json', 'seed-router.krr.json', 'seed-router.calibrator.json', 'openrouter-alts.json',
  'models/Xenova/all-MiniLM-L6-v2/config.json', 'models/Xenova/all-MiniLM-L6-v2/tokenizer.json',
  'models/Xenova/all-MiniLM-L6-v2/tokenizer_config.json', 'models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx',
];
function resolveAssetsDir() {
  const explicit = process.env.AGENTBOX_MODEL_ROUTER_DIR;
  const candidates = [explicit, '/opt/agentbox/model-router', path.join(WORKSPACE, '.agentbox', 'model-router')].filter(Boolean);
  for (const d of candidates) if (REQUIRED.every((f) => fs.existsSync(path.join(d, f)))) return d;
  const tried = candidates.map((d) => `  - ${d}`).join('\n');
  die('router artefacts missing (seed corpus, KRR model, calibrator, OpenRouter alternates, MiniLM embedder). Tried:', tried,
    'Populate the fallback dir now:   ./agentbox.sh model-router fetch',
    'or rebuild with [model_routing.neural].enabled = true to bake /opt/agentbox/model-router.');
}
const ASSETS = resolveAssetsDir();
const STATE_DIR = process.env.AGENTBOX_MODEL_ROUTER_STATE_DIR || path.join(WORKSPACE, '.agentbox', 'model-router-state');
fs.mkdirSync(STATE_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Gate the ruflo router for THIS process only (never exported globally —
// ADR-2080: the router is scoped to the dedicated AoE session).
// ---------------------------------------------------------------------------
const setDefault = (k, v) => { if (process.env[k] === undefined || process.env[k] === '') process.env[k] = String(v); };
setDefault('CLAUDE_FLOW_ROUTER_NEURAL', '1');
setDefault('CLAUDE_FLOW_ROUTER_PROVIDER', process.env.AGENTBOX_MODEL_ROUTER_PROVIDER || 'openrouter');
setDefault('CLAUDE_FLOW_ROUTER_SEED_CORPUS', path.join(ASSETS, 'seed-rows.json'));
setDefault('CLAUDE_FLOW_ROUTER_MODEL_PATH', path.join(ASSETS, 'seed-router.krr.json'));
setDefault('CLAUDE_FLOW_ROUTER_CALIBRATOR_PATH', path.join(ASSETS, 'seed-router.calibrator.json'));
setDefault('CLAUDE_FLOW_ROUTER_OPENROUTER_ALTS', path.join(ASSETS, 'openrouter-alts.json'));
setDefault('CLAUDE_FLOW_ROUTER_QUALITY_BAR', process.env.AGENTBOX_MODEL_ROUTER_QUALITY_BAR || '0.50');
setDefault('CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK', process.env.AGENTBOX_MODEL_ROUTER_COST_CEILING_USD_PER_MTOK || '0');
setDefault('CLAUDE_FLOW_ROUTER_TRAJECTORY', process.env.AGENTBOX_MODEL_ROUTER_TRAJECTORY || '1');
setDefault('CLAUDE_FLOW_SWARM_DIR', STATE_DIR);
const PROVIDER = process.env.CLAUDE_FLOW_ROUTER_PROVIDER;
if (PROVIDER === 'openrouter' && !process.env.OPENROUTER_API_KEY && !DRY) {
  die('OPENROUTER_API_KEY is not set — the console cannot execute through OpenRouter.',
    'Set it in .env (AoE forwards it via config.toml environment=) or use --dry-run to route only.');
}

// ---------------------------------------------------------------------------
// Load ruflo router + provider caller, and the embedder (offline)
// ---------------------------------------------------------------------------
const imp = (rel) => import(pathToFileURL(path.join(CLI, rel)).href);
const [{ getModelRouter, recordModelOutcome, recordModelOutcomeByModelId }, { neuralRouterStatus }, { callAnthropicMessages }] =
  await Promise.all([imp('ruvector/model-router.js'), imp('ruvector/neural-router.js'), imp('mcp-tools/agent-execute-core.js')]);

async function loadEmbedder() {
  const tfDir = path.join(NM, '@huggingface', 'transformers', 'dist');
  const entry = ['transformers.node.mjs', 'transformers.mjs'].map((f) => path.join(tfDir, f)).find((f) => fs.existsSync(f));
  if (!entry) die(`@huggingface/transformers not found under ${tfDir}`);
  const tf = await import(pathToFileURL(entry).href);
  tf.env.cacheDir = path.join(ASSETS, 'models');
  tf.env.allowLocalModels = true;
  tf.env.allowRemoteModels = process.env.AGENTBOX_MODEL_ROUTER_ALLOW_REMOTE === '1'; // offline by default
  const pipe = await tf.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true, dtype: 'q8' });
  return async (text) => { const out = await pipe(text, { pooling: 'mean', normalize: true }); return Array.from(out.data); };
}
const t0 = Date.now();
const embed = await loadEmbedder();
const router = getModelRouter();
const status = await neuralRouterStatus();
const alts = JSON.parse(fs.readFileSync(path.join(ASSETS, 'openrouter-alts.json'), 'utf8'));
const provenance = fs.existsSync(path.join(ASSETS, 'seed-rows.provenance.json'))
  ? JSON.parse(fs.readFileSync(path.join(ASSETS, 'seed-rows.provenance.json'), 'utf8')) : {};
const CONSOLE_DIR = path.dirname(new URL(import.meta.url).pathname);
const RETORT_PATH = path.join(CONSOLE_DIR, 'retort-benchmarks.json');
const retort = fs.existsSync(RETORT_PATH)
  ? JSON.parse(fs.readFileSync(RETORT_PATH, 'utf8')) : null;

if (!status.available) die(`neural router unavailable: ${status.reason || 'unknown'}`, `artefacts: ${ASSETS}`);

function banner() {
  say(c.bold('agentbox model-router console') + c.dim(`  (ADR-2080 · metaharness ${status.routedBy} · ruflo closure)`));
  say(c.dim(`  artefacts ${ASSETS}`));
  say(c.dim(`  corpus    ${provenance.rows ?? '?'} rows, embedder ${provenance.embedder ?? 'MiniLM'}, measured ${String(provenance.measured_at ?? '').slice(0, 10)}`));
  say(c.dim(`  provider  ${PROVIDER} · quality bar ${process.env.CLAUDE_FLOW_ROUTER_QUALITY_BAR} · cost ceiling ${process.env.CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK} $/MTok · state ${STATE_DIR}`));
  say(c.yellow(`  PUBLIC WORK ONLY — every task leaves the LAN to ${PROVIDER}. ${DRY ? 'DRY-RUN: route only, no provider calls.' : ''}`));
  if (retort) say(c.dim(`  retort   ${retort._meta?.source ?? 'adrianco/retort'} ingested ${retort._meta?.ingested ?? '?'} — routine: cheapest wins; hard: Fable > Opus on cost/reliability`));
  say(c.dim(`  ready in ${Date.now() - t0} ms`));
}
if (STATUS_ONLY) {
  process.stdout.write(JSON.stringify({ ok: true, assets: ASSETS, stateDir: STATE_DIR, provider: PROVIDER, dryRun: DRY, router: status, provenance, retort: retort ? { ingested: retort._meta?.ingested, source: retort._meta?.source, heuristics: Object.keys(retort.routing_heuristics || {}) } : null }, null, 2) + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Routing + execution
// ---------------------------------------------------------------------------
const TIER_ORDER = ['haiku', 'sonnet', 'opus'];
// Tariff for the model ACTUALLY picked: the neural backend may choose a slug
// from a different tier than the bandit's tier label (e.g. label `opus`, pick
// gemini-flash-lite), so look the slug up across the alternates table first
// and only fall back to the tier row. Tariffs are the vendored file's dated
// estimates (ADR-2031 posture: dated estimate or null, never a stale constant).
function tierCost(tier, modelId) {
  const tiers = alts.tiers || {};
  const bySlug = Object.values(tiers).find((t) => t && (t.openrouter_alt === modelId || t.anthropic_default === modelId));
  const t = bySlug || tiers[tier];
  return t ? { inUsd: Number(t.cost_per_m_tok_in) || 0, outUsd: Number(t.cost_per_m_tok_out) || 0 } : { inUsd: 0, outUsd: 0 };
}
function slugForTier(tier) {
  const t = alts.tiers?.[tier];
  return PROVIDER === 'openrouter' ? (t?.openrouter_alt || t?.anthropic_default) : (t?.anthropic_default?.replace(/^anthropic\//, ''));
}
const taskHash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

// Retort complexity thresholds — below ROUTINE, all models pass (cheapest wins);
// above HARD, reliability premium applies (Fable > Opus on cost/reliability).
const RETORT_CX_ROUTINE = 0.3;
const RETORT_CX_HARD = 0.6;

async function route(task) {
  const embedding = await embed(task);
  const t1 = Date.now();
  const r = await router.route(task, embedding);
  let tier = TIER_ORDER.includes(r.model) ? r.model : 'sonnet';
  let modelId = r.modelId || r.openrouterModel || slugForTier(tier);
  let routedBy = r.routedBy;
  const cx = Number(r.complexity?.toFixed?.(3) ?? r.complexity);

  // Retort-driven tier adjustment: complexity-aware model selection.
  // h1: routine tasks pass on all models — force cheapest tier.
  // h2: hard tasks need reliability — never use the cheapest tier.
  if (retort) {
    if (cx < RETORT_CX_ROUTINE && tier !== 'haiku') {
      tier = 'haiku';
      modelId = slugForTier('haiku');
      routedBy += '+retort-h1';
    } else if (cx > RETORT_CX_HARD && tier === 'haiku') {
      tier = 'sonnet';
      modelId = slugForTier('sonnet');
      routedBy += '+retort-h2';
    }
  }

  const d = {
    task, task_hash: taskHash(task), tier, modelId,
    provider: r.provider || PROVIDER, routedBy,
    confidence: Number(r.confidence?.toFixed?.(3) ?? r.confidence), complexity: cx,
    predictedQuality: r.predictedQuality ?? null,
    alternatives: (r.alternatives || []).map((a) => ({ tier: a.model, modelId: a.modelId || slugForTier(a.model), score: Number((a.score ?? a.predictedQuality ?? 0).toFixed?.(3) ?? 0) })),
    routeMs: Date.now() - t1,
  };
  if (!isAvailable(d.modelId)) {
    const next = fallbackChain(d)[0];
    if (next) { d.unavailablePick = d.modelId; d.modelId = next.modelId; d.routedBy = `${d.routedBy}+availability`; }
  }
  return d;
}

// ---------------------------------------------------------------------------
// Availability preflight — the vendored alternates are DATED (measured
// 2026-06-15); slugs get retired or re-tiered on OpenRouter. Fetch the live
// model list once (cached 24 h in the state dir), fail-open to "unknown".
// ---------------------------------------------------------------------------
const AVAIL_CACHE = path.join(STATE_DIR, 'openrouter-models.json');
async function loadAvailability() {
  if (PROVIDER !== 'openrouter' || DRY) return null;
  try {
    const st = fs.existsSync(AVAIL_CACHE) ? fs.statSync(AVAIL_CACHE) : null;
    if (st && Date.now() - st.mtimeMs < 24 * 3600 * 1000) return new Map(Object.entries(JSON.parse(fs.readFileSync(AVAIL_CACHE, 'utf8'))));
    const res = await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const data = (await res.json()).data || [];
    const m = {};
    for (const x of data) m[x.id] = { inUsd: Number(x.pricing?.prompt || 0) * 1e6, outUsd: Number(x.pricing?.completion || 0) * 1e6 };
    fs.writeFileSync(AVAIL_CACHE, JSON.stringify(m));
    return new Map(Object.entries(m));
  } catch { return null; }
}
const AVAIL = await loadAvailability();
const isAvailable = (id) => !AVAIL || !id || AVAIL.has(id);
// Live tariff when known (beats the dated file), else the vendored estimate.
function costFor(tier, modelId) {
  const live = AVAIL?.get(modelId);
  return live && (live.inUsd || live.outUsd) ? live : tierCost(tier, modelId);
}
// Ordered fallback candidates for a decision: same-tier ranked alternates from
// the vendored file (cheapest-adequate first), then the router's own
// alternatives by predicted score, then the tier defaults up the ladder.
function fallbackChain(d) {
  const seen = new Set([d.modelId]);
  const out = [];
  const push = (tier, id) => { if (id && !seen.has(id) && id !== 'inherit' && isAvailable(id)) { seen.add(id); out.push({ tier, modelId: id }); } };
  const tierRow = alts.tiers?.[d.tier] || {};
  for (const [k, arr] of Object.entries(tierRow)) if (Array.isArray(arr)) for (const a of arr) push(d.tier, a?.id);
  for (const a of [...d.alternatives].sort((x, y) => y.score - x.score)) push(TIER_ORDER.includes(a.tier) ? a.tier : d.tier, a.modelId);
  for (const t of TIER_ORDER) push(t, slugForTier(t));
  return out;
}
const UNAVAILABLE_RE = /\b(404|402|400)\b|no longer available|not available|not found|does not exist|invalid model|not a valid model/i;

async function execute(decision, prompt) {
  const t1 = Date.now();
  const res = await callAnthropicMessages({
    provider: decision.provider, model: decision.modelId, prompt, systemPrompt: SYSTEM_PROMPT,
    maxTokens: MAX_TOKENS, timeoutMs: 180000,
  });
  const cost = costFor(decision.tier, decision.modelId);
  const usage = res.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const costUsd = (usage.inputTokens * cost.inUsd + usage.outputTokens * cost.outUsd) / 1e6;
  return { ok: !!res.success, model: res.model || decision.modelId, output: res.output || '', error: res.error || null, usage, costUsd, durationMs: res.durationMs ?? (Date.now() - t1), stopReason: res.stopReason };
}

function ledger(row) {
  try { fs.appendFileSync(path.join(STATE_DIR, 'console-ledger.jsonl'), JSON.stringify({ v: 1, ts: new Date().toISOString(), ...row }) + '\n'); } catch { /* fail-open */ }
}
function recordOutcome(decision, outcome) {
  try { recordModelOutcome(decision.task, decision.tier, outcome); } catch { /* fail-open */ }
  try { recordModelOutcomeByModelId(decision.task, decision.modelId, outcome); } catch { /* fail-open */ }
  ledger({ type: 'outcome', task_hash: decision.task_hash, tier: decision.tier, modelId: decision.modelId, outcome });
}

function printDecision(d) {
  if (JSON_OUT) { process.stdout.write(JSON.stringify({ type: 'decision', ...d, retort_hint: retort ? (d.complexity < 0.3 ? 'routine-cheapest-wins' : d.complexity > 0.6 ? 'hard-reliability-premium' : null) : null }) + '\n'); return; }
  const cost = costFor(d.tier, d.modelId);
  say(c.cyan('→ route') + `  ${c.bold(d.modelId)}  ${c.dim(`[bandit tier ${d.tier} · ${d.provider} · ${d.routedBy} · conf ${d.confidence} · cx ${d.complexity} · ${d.routeMs} ms · $${cost.inUsd}/$${cost.outUsd} per MTok in/out]`)}`);
  if (d.unavailablePick) say(c.yellow(`  router picked ${d.unavailablePick} but the live model list does not offer it — using ${d.modelId}`));
  if (d.alternatives.length) say(c.dim('  alternatives: ' + d.alternatives.map((a) => `${a.tier}=${a.modelId} (${a.score})`).join(' · ')));
  if (retort) {
    const cx = d.complexity ?? 0;
    if (cx < 0.3) say(c.dim('  retort: routine-complexity task — all models pass, cheapest wins (h1)'));
    else if (cx > 0.6) say(c.dim('  retort: high-complexity task — reliability premium applies; Fable > Opus on cost/reliability (h2)'));
  }
}
function printResult(d, r) {
  if (JSON_OUT) { process.stdout.write(JSON.stringify({ type: 'result', task_hash: d.task_hash, ...r, output: undefined, outputChars: r.output.length }) + '\n'); process.stdout.write(r.output + '\n'); return; }
  if (!r.ok) { say(c.red('✗ provider error: ') + r.error); return; }
  say('');
  say(r.output.trimEnd());
  say('');
  say(c.dim(`  ${r.model} · ${r.usage.inputTokens}→${r.usage.outputTokens} tokens · ~$${r.costUsd.toFixed(5)} · ${r.durationMs} ms · stop ${r.stopReason ?? '?'}`));
}

async function runTask(task, { autoVerdict } = {}) {
  const d = await route(task);
  printDecision(d);
  ledger({ type: 'decision', ...d, task: undefined });
  if (DRY) return { d, r: null };
  let r = await execute(d, task);
  ledger({ type: 'result', task_hash: d.task_hash, tier: d.tier, modelId: r.model, ok: r.ok, usage: r.usage, costUsd: r.costUsd, durationMs: r.durationMs, error: r.error });
  if (!r.ok && UNAVAILABLE_RE.test(r.error || '')) {
    // The pick is dead on the provider (retired / re-tiered slug): record it as
    // escalated, then walk the fallback chain — never silently succeed on a
    // different model without a receipt saying so.
    recordOutcome(d, 'escalated');
    for (const fb of fallbackChain(d).slice(0, 3)) {
      say(c.yellow(`  ↳ ${d.modelId} unavailable (${(r.error || '').slice(0, 80)}…) — falling back to ${fb.modelId}`));
      d.modelId = fb.modelId; d.tier = fb.tier; d.routedBy = `${d.routedBy.split('+')[0]}+fallback`;
      r = await execute(d, task);
      ledger({ type: 'result', task_hash: d.task_hash, tier: d.tier, modelId: r.model, ok: r.ok, usage: r.usage, costUsd: r.costUsd, durationMs: r.durationMs, error: r.error, fallback: true });
      if (r.ok || !UNAVAILABLE_RE.test(r.error || '')) break;
    }
  }
  printResult(d, r);
  if (autoVerdict) recordOutcome(d, r.ok ? 'success' : 'failure');
  return { d, r };
}
async function escalate(last, prompt) {
  const idx = TIER_ORDER.indexOf(last.d.tier);
  if (idx < 0 || idx === TIER_ORDER.length - 1) { say(c.yellow('already at the top tier — nothing to escalate to')); return last; }
  recordOutcome(last.d, 'escalated');
  const tier = TIER_ORDER[idx + 1];
  const d = { ...last.d, tier, modelId: slugForTier(tier), routedBy: 'escalated', alternatives: [] };
  printDecision(d);
  const r = DRY ? null : await execute(d, prompt);
  if (r) { printResult(d, r); ledger({ type: 'result', task_hash: d.task_hash, tier, modelId: r.model, ok: r.ok, usage: r.usage, costUsd: r.costUsd, durationMs: r.durationMs, escalated: true }); }
  return { d, r };
}

// ---------------------------------------------------------------------------
// --once
// ---------------------------------------------------------------------------
if (ONCE !== null) {
  banner();
  let prompt = ONCE;
  const f = opt('--file', null);
  if (f) prompt += `\n\n--- ${path.basename(f)} ---\n` + fs.readFileSync(f, 'utf8');
  const { r } = await runTask(prompt, { autoVerdict: true });
  process.exit(r && !r.ok ? 2 : 0);
}

// ---------------------------------------------------------------------------
// REPL
// ---------------------------------------------------------------------------
banner();
say(c.dim('  type a task and press enter · /help for commands'));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
let last = null; let attached = null; let pendingVerdict = false;
const prompt = () => rl.setPrompt(c.bold(DRY ? 'router(dry)> ' : 'router> ')) || rl.prompt();
prompt();
rl.on('line', async (line) => {
  const s = line.trim();
  try {
    if (!s) return;
    if (s === '/quit' || s === '/exit') { rl.close(); return; }
    if (s === '/help') {
      say('  /file <path>   attach a file as context for the next task\n  /dry on|off    route only / route + execute\n  /verdict s|f|e record success / failure / escalate for the last answer (default: success)\n  /escalate      re-run the last task one tier up\n  /retort        show Retort price-performance heuristics\n  /status        router backend + artefact status\n  /quit');
      return;
    }
    if (s.startsWith('/file ')) { const p = s.slice(6).trim(); attached = fs.readFileSync(p, 'utf8'); say(c.dim(`  attached ${p} (${attached.length} chars)`)); return; }
    if (s.startsWith('/dry')) { const v = s.split(/\s+/)[1]; if (v === 'off' && EGRESS_OFF) { say(c.yellow('  AGENTBOX_EGRESS=0 — cannot leave dry-run')); return; } DRY = v !== 'off'; say(c.dim(`  dry-run ${DRY ? 'on' : 'off'}`)); return; }
    if (s === '/status') { say(JSON.stringify({ router: status, assets: ASSETS, stateDir: STATE_DIR, provider: PROVIDER, dryRun: DRY, retort: retort ? { ingested: retort._meta?.ingested, source: retort._meta?.source } : null }, null, 2)); return; }
    if (s === '/retort') {
      if (!retort) { say(c.yellow('  retort-benchmarks.json not found')); return; }
      say(c.bold('Retort price-performance heuristics') + c.dim(`  (${retort._meta?.source}, ingested ${retort._meta?.ingested})`));
      say(c.dim('  routine cost: ' + (retort.routine_task_ranking?.cost_ranking || '(no data)')));
      for (const [k, v] of Object.entries(retort.routing_heuristics || {})) say(`  ${c.cyan(k)}: ${v}`);
      return;
    }
    if (s.startsWith('/verdict')) {
      if (!last || !last.r) { say(c.yellow('  nothing to record')); return; }
      const v = (s.split(/\s+/)[1] || 's')[0];
      const outcome = v === 'f' ? 'failure' : v === 'e' ? 'escalated' : 'success';
      recordOutcome(last.d, outcome); pendingVerdict = false; say(c.dim(`  recorded ${outcome} for ${last.d.modelId}`)); return;
    }
    if (s === '/escalate') { if (!last) { say(c.yellow('  nothing to escalate')); return; } last = await escalate(last, last.prompt); if (last) last.prompt = last.prompt || last.d.task; return; }
    if (s.startsWith('/')) { say(c.yellow(`  unknown command ${s.split(/\s+/)[0]} — /help`)); return; }
    // A plain line is a task. An unrecorded previous answer counts as success
    // (the operator moved on), matching --once's auto-verdict.
    if (pendingVerdict && last?.r) { recordOutcome(last.d, last.r.ok ? 'success' : 'failure'); pendingVerdict = false; }
    let full = s;
    if (attached) { full += `\n\n--- attached ---\n${attached}`; attached = null; }
    const res = await runTask(full);
    last = { ...res, prompt: full };
    pendingVerdict = !!res.r;
    if (res.r) say(c.dim('  /verdict s|f|e to grade this answer (enter a new task = success)'));
  } catch (e) {
    say(c.red('  error: ') + (e?.message || String(e)));
  } finally {
    prompt();
  }
});
rl.on('close', () => {
  if (pendingVerdict && last?.r) recordOutcome(last.d, last.r.ok ? 'success' : 'failure');
  say(c.dim('\nbye'));
  process.exit(0);
});
