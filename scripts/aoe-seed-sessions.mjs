#!/usr/bin/env node
// ============================================================================
// aoe-seed-sessions.mjs — interaction-plane boot reconciler (PRD-021 WS2)
// ----------------------------------------------------------------------------
// Reads [interaction_plane].session_seeds from agentbox.toml and reconciles the
// Agent-of-Empires (AoE) interaction plane in three passes, all fail-open:
//
//   1. Provision OpenRouter/ZAI profile settings and OpenCode's native provider
//      connectors for the Loom LAN and hosted DeepSeek sessions.
//   2. Materialise AoE's config.toml (custom_agents + agent_command_override +
//      agent_detect_as for the seven consoles, the AGENTBOX_PROFILE-per-session
//      env binding, status_hooks → scripts/aoe-session-boundary.cjs, sandbox
//      OFF) into ~/.config/agent-of-empires/config.toml, merging non-managed
//      keys so a running daemon's own settings survive.
//   3. Idempotently ensure the seeded sessions exist on the daemon
//      (127.0.0.1:<port>, --auth token loopback; token read from serve.url and
//      sent as Authorization: Bearer): match by title,
//      skip existing, create missing, NEVER kill.
//
// Overlay-only (ADR-042 N-06): zero AoE src/ patches — this is all config +
// REST. It fails open with clear logging when the daemon is absent (pre-rebuild
// boots) or when @iarna/toml is unavailable.
// ============================================================================

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..'); // dir containing scripts/ + config/
const WORKSPACE = process.env.WORKSPACE || '/home/devuser/workspace';
const PROJECT = fs.existsSync(path.join(WORKSPACE, 'project'))
  ? path.join(WORKSPACE, 'project')
  : WORKSPACE;

const WRAPPER_DIR = path.join(REPO_ROOT, 'config', 'harness-wrappers');
const BOUNDARY_HOOK = path.join(REPO_ROOT, 'scripts', 'aoe-session-boundary.cjs');

const TAG = '[aoe-seed]';
const log = (...a) => console.log(TAG, ...a);
const warn = (...a) => console.warn(TAG, ...a);

// --- soft dependency: @iarna/toml (parse + stringify) ----------------------
// The baked copy at /opt/agentbox/scripts has no node_modules chain above it,
// so resolution relative to import.meta.url fails there. Fall back through the
// workspace checkouts that do carry a node_modules tree.
const REQUIRE_BASES = [
  import.meta.url,
  path.join(WORKSPACE, 'project', 'agentbox', 'noop.js'),
  path.join(WORKSPACE, 'project', 'noop.js'),
  path.join(WORKSPACE, 'noop.js'),
];
let TOML = null;
for (const base of REQUIRE_BASES) {
  try {
    TOML = createRequire(base)('@iarna/toml');
    break;
  } catch {
    // try next base
  }
}
if (!TOML) {
  warn(`@iarna/toml unavailable (tried ${REQUIRE_BASES.length} require bases) — cannot parse agentbox.toml or write AoE config; skipping (fail-open).`);
  process.exit(0);
}

// --- read the interaction_plane manifest -----------------------------------
const AGENTBOX_TOML = path.join(REPO_ROOT, 'agentbox.toml');
let manifest = {};
try {
  manifest = TOML.parse(fs.readFileSync(AGENTBOX_TOML, 'utf8'));
} catch (e) {
  warn(`could not read/parse ${AGENTBOX_TOML}: ${e.message} — skipping (fail-open).`);
  process.exit(0);
}

const ip = manifest.interaction_plane || {};
if (ip.enabled !== true && !process.argv.includes('--providers-only')) {
  log('[interaction_plane].enabled is not true — no daemon, no seeds. Nothing to do.');
  process.exit(0);
}

const PORT = Number(ip.port) || 9095;

// Session seeds: prefer the manifest table (Builder A). Fall back to the
// Appendix-A default set so the reconciler is complete before that table lands.
const DEFAULT_SEEDS = [
  { slug: 'codex', tool: 'codex', worktree: true },
  // Native AoE `antigravity` agent (16-agent catalogue). @google/gemini-cli is
  // sunset (2026-06-18); the flake pins the Antigravity CLI (binary `agy`,
  // lib/antigravity-cli.nix — NOT nixpkgs `antigravity`, which is the IDE) —
  // verify AoE's expected binary name at the next image rebuild (ADR-045 note).
  { slug: 'antigravity', tool: 'antigravity', model: 'gemini-3.8-flash', worktree: true },
  { slug: 'openrouter', tool: 'claude', worktree: false, env_allowlist: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'] },
  { slug: 'zai', tool: 'claude', worktree: false, env_allowlist: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'] },
  { slug: 'deepseek', tool: 'opencode', model: 'deepseek-agent/deepseek-chat', worktree: true },
  { slug: 'loom', tool: 'opencode', model: 'loom-lan/qwen3.8-27B', worktree: true },
  { slug: 'loom-raw', tool: 'opencode', model: 'loom-agent/current', worktree: true },
];
const seeds = Array.isArray(ip.session_seeds) && ip.session_seeds.length ? ip.session_seeds : DEFAULT_SEEDS;
const coordinator = ip.coordinator || { slug: 'tab0', tool: 'claude', view: 'terminal' };

// Slugs whose session program is a hard-fail wrapper script under
// config/harness-wrappers. openrouter/zai are redirected-Claude harnesses
// (detect_as claude keeps AoE's status heuristics); `router` is the ADR-2080
// model-router console (its own program, no detection alias).
const WRAPPER_SLUGS = {
  openrouter: { file: 'openrouter.sh', detectAs: 'claude' },
  zai: { file: 'zai.sh', detectAs: 'claude' },
  router: { file: 'router.sh', detectAs: null },
};

// ===========================================================================
// Pass 1 — provision OpenRouter/ZAI settings.local.json (N-01 key injection)
// ===========================================================================
function writeJsonIfContent(file, obj, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', { mode });
  fs.chmodSync(file, mode);
}

function provisionOpenRouter() {
  const key = process.env.OPENROUTER_API_KEY;
  const profile = path.join(WORKSPACE, 'profiles', 'openrouter');
  const settings = path.join(profile, '.claude', 'settings.local.json');
  if (!key) {
    warn('OPENROUTER_API_KEY not set — leaving profiles/openrouter/.claude/settings.local.json as-is (wrapper will hard-fail if empty).');
    return;
  }
  const model = process.env.OR_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free';
  writeJsonIfContent(settings, {
    env: {
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
      ANTHROPIC_AUTH_TOKEN: key,
      ANTHROPIC_API_KEY: '',
    },
    model,
  });
  log(`provisioned openrouter settings.local.json (model: ${model}).`);
}

function provisionZai() {
  const key = process.env.ZAI_ANTHROPIC_API_KEY || process.env.ZAI_API_KEY;
  const profile = path.join(WORKSPACE, 'profiles', 'zai');
  const settings = path.join(profile, '.claude', 'settings.local.json');
  if (!key) {
    warn('ZAI_API_KEY / ZAI_ANTHROPIC_API_KEY not set — leaving profiles/zai/.claude/settings.local.json as-is (wrapper will hard-fail if empty).');
    return;
  }
  const endpoint = process.env.ZAI_URL || 'https://api.z.ai/api/paas/v4';
  writeJsonIfContent(settings, {
    env: {
      ANTHROPIC_BASE_URL: endpoint,
      ANTHROPIC_AUTH_TOKEN: key,
      ANTHROPIC_API_KEY: '',
    },
  });
  log(`provisioned zai settings.local.json (endpoint: ${endpoint}).`);
}

function normalizedV1Url(value, fallback) {
  return (value || fallback).replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1';
}

// Never inflate a smaller served context to the previous model's budget. Missing
// or malformed metadata gets a conservative fallback; output reserves input room.
function agentContext(value) {
  return Number.isSafeInteger(value) && value >= 4 ? Math.min(value, 131072) : 8192;
}

// Model listing is discovery metadata, not evidence of tool/vision qualification.
export function selectLoomModel(listing, env = {}) {
  const data = Array.isArray(listing?.data) ? listing.data : [];
  const ids = [...new Set(data.map(m => m.id).filter(id => typeof id === 'string' && id.trim()))];
  // GEMMA_MODEL is legacy ontology-profile state and may survive model swaps.
  // Only the agent's explicit LOOM_MODEL override constrains live discovery.
  const explicit = env.LOOM_MODEL;
  if (!ids.length) throw new Error('Loom /models advertised no model IDs; existing providers retained');
  if (explicit && !ids.includes(explicit)) throw new Error(`Requested Loom model ${explicit} is not advertised`);
  if (!explicit && ids.length !== 1) throw new Error('Loom advertises multiple models; set LOOM_MODEL explicitly');
  const id = explicit || ids[0];
  const row = data.find(m => m.id === id);
  // llama.cpp exposes capabilities in a parallel models array, keyed by model/name.
  const companion = (Array.isArray(listing.models) ? listing.models : [])
    .find(m => [m.id, m.model, m.name].includes(id));
  const capabilities = [...(Array.isArray(row.capabilities) ? row.capabilities : []),
    ...(Array.isArray(companion?.capabilities) ? companion.capabilities : [])];
  // llama.cpp's companion listing uses "multimodal" for its image projector.
  // A generic audio-capable provider may use the same word: require explicit
  // image metadata there rather than advertising image input by accident.
  let image = (row.owned_by === 'llamacpp' && capabilities.includes('multimodal')) || capabilities.includes('vision')
    || row.modalities?.input?.includes('image') === true;
  // Explicit operator override for servers without capability metadata. This
  // advertises input support only; vision qualification is a separate live gate.
  if (env.LOOM_IMAGE_INPUT !== undefined) {
    if (!['true', 'false'].includes(env.LOOM_IMAGE_INPUT)) throw new Error('LOOM_IMAGE_INPUT must be true or false');
    image = env.LOOM_IMAGE_INPUT === 'true';
  }
  const contextMetadata = [row.meta?.n_ctx, row.context_window, row.context_length,
    row.max_model_len, row.limit?.context, companion?.meta?.n_ctx,
    companion?.context_window, companion?.context_length]
    .find(value => Number.isSafeInteger(value) && value >= 4);
  return { id, image, context: agentContext(contextMetadata) };
}

// OpenCode is a first-class AoE agent, so provider selection stays in its
// supported configuration surface instead of inventing custom wrapper agents.
export function openCodeConfig(env = process.env, home = os.homedir(), existing = {}, selected) {
  if (!selected?.id) throw new Error("A discovered Loom model is required");
  const loomBase = normalizedV1Url(env.LOOM_BASE_URL || env.GEMMA_BASE_URL, 'http://192.168.2.132:8084/v1');
  const deepseekBase = normalizedV1Url(env.DEEPSEEK_BASE_URL, 'https://api.deepseek.com/v1');
  const loomModel = env.LOOM_MODEL || env.GEMMA_MODEL || 'qwen3.8-27B';
  // New agents use a stable logical ID; legacy sessions retain their alias.
  // Both use the facade with the same discovered wire model.
  const context = agentContext(selected.context);
  const agentModel = {
    id: selected.id,
    name: `${selected.id} (Loom passthrough)`,
    tool_call: true,
    attachment: selected.image === true,
    modalities: { input: selected.image ? ['text', 'image'] : ['text'], output: ['text'] },
    limit: { context, output: Math.min(16384, Math.floor(context / 4)) },
    options: {
      loom_options: { scaffold: false },
      ...(/qwen/i.test(selected.id) ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    },
  };
  return {
    ...existing,
    $schema: 'https://opencode.ai/config.json',
    skills: {
      ...existing.skills,
      paths: [...new Set([...(existing.skills?.paths || []), path.join(home, '.codex', 'skills')])],
    },
    provider: {
      ...existing.provider,
      'loom-lan': existing.provider?.['loom-lan'] || {
        npm: '@ai-sdk/openai-compatible', name: 'Loom LAN',
        options: { baseURL: loomBase, apiKey: 'not-needed' },
        models: { [loomModel]: { name: 'Qwen (ontology scaffold)', limit: { context: 131072, output: 16384 } } },
      },
      'loom-agent': {
        ...existing.provider?.['loom-agent'],
        npm: '@ai-sdk/openai-compatible', name: 'Loom agent',
        options: { ...existing.provider?.['loom-agent']?.options, baseURL: loomBase, apiKey: 'not-needed', timeout: 900000, headerTimeout: 900000 },
        models: { ...existing.provider?.['loom-agent']?.models, current: agentModel },
      },
      'loom-raw': {
        ...existing.provider?.['loom-raw'],
        npm: '@ai-sdk/openai-compatible', name: 'Loom agent (legacy alias)',
        options: { ...existing.provider?.['loom-raw']?.options, baseURL: loomBase, apiKey: 'not-needed', timeout: 900000, headerTimeout: 900000 },
        models: { ...existing.provider?.['loom-raw']?.models, 'qwen3.8-27B': agentModel },
      },
      'deepseek-agent': {
        npm: '@ai-sdk/openai-compatible', name: 'DeepSeek Agent',
        options: { baseURL: deepseekBase, apiKey: '{env:DEEPSEEK_API_KEY}' },
        models: { 'deepseek-chat': { name: 'DeepSeek V4 Flash' } },
      },
    },
  };
}

export async function provisionOpenCode({ env = process.env, home = os.homedir(), fetchImpl = globalThis.fetch } = {}) {
  const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config');
  const configPath = path.join(configHome, 'opencode', 'opencode.json');
  // Refuse unreadable settings and failed/ambiguous discovery before any write.
  const existing = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  const base = normalizedV1Url(env.LOOM_BASE_URL || env.GEMMA_BASE_URL, 'http://192.168.2.132:8084/v1');
  const response = await fetchImpl(`${base}/models`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Loom model discovery HTTP ${response.status}`);
  const selected = selectLoomModel(await response.json(), env);
  const config = openCodeConfig(env, home, existing, selected);
  writeJsonIfContent(configPath, config, 0o644);
  // Boot reconciliation runs as root with the user's home. Leave this user
  // configuration refreshable by its owner after a backend model swap.
  if (process.getuid?.() === 0) {
    // Nix can own the home directory as root while its account remains devuser.
    const account = fs.readFileSync('/etc/passwd', 'utf8').split('\n')
      .map(line => line.split(':')).find(fields => fields[5] === home);
    const owner = fs.statSync(configHome);
    const uid = account ? Number(account[2]) : owner.uid;
    const gid = account ? Number(account[3]) : owner.gid;
    fs.chownSync(path.dirname(configPath), uid, gid);
    fs.chownSync(configPath, uid, gid);
  }
  log(`provisioned Loom agent ${selected.id} via ${base} (image advertised: ${selected.image}; qualification required).`);
  return config;
}

// ===========================================================================
// Pass 2 — materialise AoE config.toml
// ===========================================================================
function aoeConfigPath() {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'agent-of-empires', 'config.toml');
}

// Build the per-console coverage from the seeds. Returns { customAgents,
// Resolve a native-agent binary name for use in a spawn override. AoE spawns
// via `bash -lc`, whose PATH matches ours closely enough; when the binary
// isn't on PATH yet (e.g. installed on the persistent workspace volume ahead
// of the image rebuild that bakes it), fall back to $WORKSPACE/.local/bin and
// emit the absolute path so the session still starts.
function resolveAgentBinary(bin) {
  try {
    execFileSync('/bin/sh', ['-c', `command -v ${bin}`], { stdio: 'pipe' });
    return bin;
  } catch {
    const fallback = path.join(WORKSPACE, '.local', 'bin', bin);
    try {
      fs.accessSync(fallback, fs.constants.X_OK);
      warn(`binary "${bin}" not on PATH — using workspace fallback ${fallback}.`);
      return fallback;
    } catch {
      warn(`binary "${bin}" not found on PATH or in ${fallback} — session will not start until it is installed.`);
      return bin;
    }
  }
}

// detectAs, overrides, sessionTools } where sessionTools[slug] is the AoE
// agent name each session is created with.
function buildCoverage() {
  const customAgents = {};
  const detectAs = {};
  const overrides = {};
  const sessionTools = {};

  // Coordinator: native claude, but bind its profile via an override. It is the
  // ONLY session that uses the native `claude` agent, so overriding `claude`
  // here cannot collide with anything else (openrouter/zai are custom_agents,
  // NOT claude — see note below).
  overrides.claude = `env AGENTBOX_PROFILE=${coordinator.slug || 'tab0'} claude`;
  sessionTools[coordinator.slug || 'tab0'] = 'claude';

  for (const seed of seeds) {
    const slug = seed.slug;
    if (WRAPPER_SLUGS[slug]) {
      // Redirected-Claude harness (OpenRouter/ZAI). ADR-042 D6 names
      // agent_command_override as the mechanism, but the coordinator ALSO uses
      // the `claude` agent, and AoE resolves overrides per agent-NAME — a
      // `claude` override would hit the coordinator too. Registering these as
      // distinct custom_agents (name == slug) pointing at the hard-fail wrapper
      // is the collision-free equivalent; agent_detect_as=claude keeps the
      // status heuristics. The wrapper is unchanged as the structural guard.
      const wrapper = path.join(WRAPPER_DIR, WRAPPER_SLUGS[slug].file);
      customAgents[slug] = wrapper; // wrapper self-exports AGENTBOX_PROFILE
      if (WRAPPER_SLUGS[slug].detectAs) detectAs[slug] = WRAPPER_SLUGS[slug].detectAs;
      sessionTools[slug] = slug;
      continue;
    }
    const tool = seed.tool || 'claude';
    if (tool.startsWith('custom:')) {
      const name = tool.slice('custom:'.length);
      customAgents[name] = `env AGENTBOX_PROFILE=${slug} ${name}`;
      if (seed.detect_as) detectAs[name] = seed.detect_as;
      sessionTools[slug] = name;
      continue;
    }
    if (tool === 'opencode') {
      // Multiple sessions intentionally share AoE's native OpenCode agent;
      // their provider/model is selected per session through extra_args.
      sessionTools[slug] = tool;
      continue;
    }
    if (tool === 'codex' || tool === 'gemini' || tool === 'antigravity') {
      // Native ACP agent, one session each → a per-agent override that binds
      // AGENTBOX_PROFILE is collision-free. AoE agent name ≠ binary name for
      // antigravity: the CLI installs as `agy` (nixpkgs `antigravity` is the
      // IDE — a different product; see lib/antigravity-cli.nix).
      const bin = resolveAgentBinary(tool === 'antigravity' ? 'agy' : tool);
      // AoE 1.13 does not persist `extra_args` from POST /api/sessions for
      // native agents (the 2026-09-05 rebuild created `antigravity` as
      // `env AGENTBOX_PROFILE=antigravity agy`, no model), so the seed's
      // model rides the override itself. One session per native tool keeps
      // this collision-free; all three CLIs accept `--model`.
      const modelArg = seed.model ? ` --model ${seed.model}` : '';
      overrides[tool] = `env AGENTBOX_PROFILE=${slug} ${bin}${modelArg}`;
      sessionTools[slug] = tool;
      continue;
    }
    // Bare native claude harness (not a wrapper slug, not the coordinator) —
    // rare; route it through the coordinator-style override is unsafe, so give
    // it its own custom_agent to avoid clobbering the coordinator.
    customAgents[slug] = `env AGENTBOX_PROFILE=${slug} claude`;
    detectAs[slug] = 'claude';
    sessionTools[slug] = slug;
  }

  return { customAgents, detectAs, overrides, sessionTools };
}

// The provider env forwarded into every host session so the custom agents and
// wrappers can reach their credentials. CRITICALLY excludes ANTHROPIC_BASE_URL
// / ANTHROPIC_AUTH_TOKEN — those live ONLY in the openrouter/zai profile
// settings.local.json + wrappers, so the native coordinator's claude is never
// redirected (N-01).
function providerEnvList() {
  return [
    'OPENROUTER_API_KEY=$OPENROUTER_API_KEY',
    'OR_MODEL=$OR_MODEL',
    'ZAI_API_KEY=$ZAI_API_KEY',
    'ZAI_ANTHROPIC_API_KEY=$ZAI_ANTHROPIC_API_KEY',
    'ZAI_URL=$ZAI_URL',
    'DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY',
    'DEEPSEEK_BASE_URL=$DEEPSEEK_BASE_URL',
    'GOOGLE_API_KEY=$GOOGLE_API_KEY',
    'GOOGLE_GEMINI_API_KEY=$GOOGLE_GEMINI_API_KEY',
    'OLLAMA_BASE_URL=$OLLAMA_BASE_URL',
    'OLLAMA_MODEL=$OLLAMA_MODEL',
    'LOOM_BASE_URL=$LOOM_BASE_URL',
    'LOOM_RAW_BASE_URL=$LOOM_RAW_BASE_URL',
    'LOOM_MODEL=$LOOM_MODEL',
    'GEMMA_BASE_URL=$GEMMA_BASE_URL',
    'GEMMA_MODEL=$GEMMA_MODEL',
    'CODEX_HOME=$CODEX_HOME',
  ];
}

function materialiseConfig(coverage) {
  const cfgPath = aoeConfigPath();
  let cfg = {};
  if (fs.existsSync(cfgPath)) {
    try {
      cfg = TOML.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (e) {
      const bak = `${cfgPath}.agentbox-bak-${Date.now()}`;
      try { fs.copyFileSync(cfgPath, bak); } catch { /* best effort */ }
      warn(`existing AoE config.toml unparseable (${e.message}); backed up to ${bak} and rewriting the managed keys.`);
      cfg = {};
    }
  }

  // Merge managed keys; preserve everything else the daemon may own.
  cfg.environment = providerEnvList();

  cfg.session = cfg.session && typeof cfg.session === 'object' ? cfg.session : {};
  cfg.session.default_tool = 'claude';
  // agentbox owns the interaction-plane agent maps wholesale (per AoE docs,
  // profile/repo maps fully replace rather than merge, so a partial map is a
  // footgun — we always write the complete computed set).
  cfg.session.custom_agents = coverage.customAgents;
  cfg.session.agent_detect_as = coverage.detectAs;
  cfg.session.agent_command_override = coverage.overrides;

  // Status hooks → Builder B's session-boundary shim (identity binding fires on
  // transitions). on_change runs on every transition after the status-specific
  // hook; the boundary script reads AOE_SESSION_ID/TITLE/PROFILE/OLD/NEW_STATUS.
  cfg.status_hooks = {
    enabled: true,
    on_change: `node ${BOUNDARY_HOOK}`,
  };

  // Sandbox stays OFF (operator decision 2026-08-04, F2-7): profile isolation +
  // the container boundary are the isolation model; AoE's docker exec sandbox
  // re-enters the DinD stale-mount footgun.
  cfg.sandbox = cfg.sandbox && typeof cfg.sandbox === 'object' ? cfg.sandbox : {};
  cfg.sandbox.enabled_by_default = false;

  // Daemon-side submodule init OFF (2026-08-05): the first init clones the
  // ~900MB agentbox submodule from GitHub INSIDE the create request (~26min
  // observed), blowing every client timeout and leaving stray worktrees. The
  // reconciler instead runs a local --reference --dissociate init right after
  // each worktree-session create (initWorktreeSubmodules) — same content, no
  // network. TUI-created worktree sessions inherit this and need a manual
  // `git submodule update --init` if they want submodule content.
  cfg.worktree = cfg.worktree && typeof cfg.worktree === 'object' ? cfg.worktree : {};
  cfg.worktree.init_submodules = false;

  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  const header =
    '# Managed in part by agentbox scripts/aoe-seed-sessions.mjs (PRD-021 WS2).\n' +
    '# The interaction-plane agent maps, provider env forwarding, status hooks,\n' +
    '# and sandbox default are reconciled at boot; other keys are preserved.\n';
  fs.writeFileSync(cfgPath, header + TOML.stringify(cfg));
  log(`materialised AoE config: ${cfgPath}`);
  return cfgPath;
}

// ===========================================================================
// Pass 3 — reconcile sessions against the daemon (fail-open)
// ===========================================================================
const BASE = `http://127.0.0.1:${PORT}`;

// N-05: the aoe daemon runs `--auth token`; loopback is no longer the boundary.
// Read the daemon's shared-secret token from its own state file (serve.url) and
// inject it as `Authorization: Bearer`. This script runs at BOOT, before the daemon
// has written serve.url — so daemonReady() polls for the token below, and
// fetchWithTimeout FAILS CLOSED (throws) rather than send an unauthenticated request.
//
// DUPLICATED VERBATIM (modulo the fs accessor) in 4 runtime consumers of :9095 —
// no shared-lib path spans all four deploy locations. KEEP IN SYNC:
//   config/nip98-proxy/proxy.mjs · config/nostr-gateway/gateway.cjs
//   config/tab0-bridge/server.mjs · scripts/aoe-seed-sessions.mjs
// Read-then-stat with a single retry on mtime skew (guards a torn read while the
// daemon rewrites the file on restart); a transient stat/read error keeps the
// last-good cache (NEVER caches null on error). Callers MUST fail closed on null.
const AOE_TOKEN_FILE = process.env.AGENTBOX_AOE_TOKEN_FILE
  || path.join(os.homedir(), '.config', 'agent-of-empires', 'serve.url');
let _aoeTokenCache = { mtimeMs: -1, token: null, valid: false };
function readAoeToken() {
  for (let attempt = 0; attempt < 2; attempt++) {
    let stBefore;
    try { stBefore = fs.statSync(AOE_TOKEN_FILE); }
    catch { return _aoeTokenCache.valid ? _aoeTokenCache.token : null; }
    if (_aoeTokenCache.valid && stBefore.mtimeMs === _aoeTokenCache.mtimeMs) return _aoeTokenCache.token;
    let raw, stAfter;
    try {
      raw = fs.readFileSync(AOE_TOKEN_FILE, 'utf-8');
      stAfter = fs.statSync(AOE_TOKEN_FILE);
    } catch { return _aoeTokenCache.valid ? _aoeTokenCache.token : null; }
    if (stBefore.mtimeMs !== stAfter.mtimeMs) continue; // file changed under us → retry once
    const m = /[?&]token=([0-9a-fA-F]{64})(?:[&#\s]|$)/.exec(raw); // aoe mints a 32-byte (64-hex) token
    const token = m ? m[1] : null;
    _aoeTokenCache = { mtimeMs: stAfter.mtimeMs, token, valid: true };
    return token;
  }
  return _aoeTokenCache.valid ? _aoeTokenCache.token : null;
}

function fetchWithTimeout(url, opts = {}, ms = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  const tok = readAoeToken();
  if (!tok) { // fail closed — never send an unauthenticated request to the daemon
    clearTimeout(t);
    return Promise.reject(new Error('AoE token unavailable (N-05 fail-closed)'));
  }
  const headers = { ...(opts.headers || {}), authorization: `Bearer ${tok}` };
  return fetch(url, { ...opts, headers, signal: ctl.signal }).finally(() => clearTimeout(t));
}

// Startup grace: at boot the daemon may not have written serve.url yet, so poll for
// BOTH the token file and a live daemon before reconciling. fetchWithTimeout throws
// while the token is absent; daemonReady() catches and retries across the window.
async function daemonReady(retries = 20, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetchWithTimeout(`${BASE}/api/sessions?state=all`, {}, 2000);
      if (r.ok) return true;
    } catch { /* daemon or token not up yet */ }
    await new Promise((res) => setTimeout(res, delayMs));
  }
  return false;
}

async function listSessions() {
  const r = await fetchWithTimeout(`${BASE}/api/sessions?state=all`, {}, 4000);
  if (!r.ok) throw new Error(`GET /api/sessions → ${r.status}`);
  const body = await r.json();
  // AoE returns an array (or an object with a sessions array on some builds).
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.sessions)) return body.sessions;
  return [];
}

async function createSession(title, tool, worktree, extraArgs = '') {
  const payload = {
    path: PROJECT,
    tool,
    title,
    worktree_enabled: !!worktree,
    idempotency_key: `agentbox-seed-${title}`,
  };
  if (extraArgs) payload.extra_args = extraArgs;
  if (worktree) payload.create_new_branch = true;
  const r = await fetchWithTimeout(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    // Worktree seeds run `git submodule update --init --recursive` after the
    // checkout; the first init clones the agentbox submodule, which can take
    // minutes — 15s aborted mid-create and left stray worktrees/branches.
  }, 180000);
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`POST /api/sessions (${title}) → ${r.status} ${text}`.trim());
  }
  return r.json().catch(() => ({}));
}

/**
 * Local, network-free submodule init for a freshly created worktree session
 * (pairs with worktree.init_submodules=false in materialiseConfig). Each
 * declared submodule is initialised with --reference into the superproject's
 * module store when one exists (--dissociate copies objects, so the worktree
 * owns its store and survives a main-repo gc). Fail-open: a missing worktree
 * or a git error is a warn, never a boot failure.
 */
function initWorktreeSubmodules(worktreePath, title) {
  try {
    if (!worktreePath || !fs.existsSync(path.join(worktreePath, '.gitmodules'))) return;
    const listing = execFileSync(
      'git',
      ['config', '-f', path.join(worktreePath, '.gitmodules'), '--get-regexp', String.raw`^submodule\..*\.path$`],
      { encoding: 'utf8' },
    );
    for (const line of listing.split('\n')) {
      const m = line.match(/^submodule\.(.+)\.path (.+)$/);
      if (!m) continue;
      const [, name, subPath] = m;
      const ref = path.join(PROJECT, '.git', 'modules', name);
      const args = ['-C', worktreePath, 'submodule', 'update', '--init'];
      if (fs.existsSync(ref)) args.push('--reference', ref, '--dissociate');
      args.push('--', subPath);
      execFileSync('git', args, { stdio: 'pipe' });
      log(`session "${title}": submodule ${name} initialised${fs.existsSync(ref) ? ' from local reference' : ''}.`);
    }
  } catch (e) {
    warn(`session "${title}": local submodule init failed: ${e.message} — worktree usable, submodule content absent (fail-open).`);
  }
}

/**
 * Preflight (2026-08-05 incident): a gitlink (mode 160000) with no .gitmodules
 * entry makes EVERY `git submodule update --init` in the repo fatal ("No url
 * found for submodule path"), which silently killed all worktree session
 * creates. Detect and warn loudly; the fix is `git rm --cached <path>` + commit
 * in the project repo.
 */
function preflightOrphanGitlinks() {
  try {
    const staged = execFileSync('git', ['-C', PROJECT, 'ls-files', '-s'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const gitlinks = staged.split('\n')
      .filter((l) => l.startsWith('160000 '))
      .map((l) => l.split('\t')[1])
      .filter(Boolean);
    if (!gitlinks.length) return;
    const gm = path.join(PROJECT, '.gitmodules');
    let declared = new Set();
    if (fs.existsSync(gm)) {
      const cfgOut = execFileSync('git', ['config', '-f', gm, '--get-regexp', String.raw`^submodule\..*\.path$`], { encoding: 'utf8' });
      declared = new Set(cfgOut.split('\n').map((l) => l.split(' ')[1]).filter(Boolean));
    }
    const orphans = gitlinks.filter((p) => !declared.has(p));
    if (orphans.length) {
      warn(`ORPHAN GITLINK(S) in ${PROJECT}: ${orphans.join(', ')} — every 'git submodule update --init' will fatal until fixed (git rm --cached <path> + commit).`);
    }
  } catch (e) {
    warn(`gitlink preflight failed: ${e.message} (fail-open).`);
  }
}

/**
 * Reap worktrees the seeder itself left behind. AoE derives a worktree at
 * `${PROJECT}-worktrees/<title>` (or `<title>-N` when that path is taken) for
 * every `worktree: true` seed. Until 2026-09-05 the session records lived on
 * a tmpfs and died with the container while the worktrees persisted, so each
 * boot re-created the seed at the next free suffix: 18 copies per slug. The
 * records are now on a volume, but this pass keeps the tree bounded either
 * way. Identity is exact, never fuzzy (the ADR-2032 principle): a directory is
 * a candidate only when its basename is `<slug>` or `<slug>-<digits>` for a
 * worktree seed AND no session in any state references its path. A registered
 * worktree is removed only when `git status` is clean (submodule state
 * ignored: the submodule's commits live in its own repository) and its branch
 * holds no commits beyond the main branch; anything else is left for a human.
 * A candidate that is NOT a registered worktree (a dead directory, which makes
 * AoE refuse the create with "Worktree already exists") is renamed aside, not
 * deleted.
 */
function reapOrphanWorktrees(existing) {
  const root = `${PROJECT}-worktrees`;
  if (!fs.existsSync(root)) return;
  // The daemon's GET /api/sessions objects carry `project_path` (the CLI's
  // `aoe list --json` calls the same thing `path`). Accept both, and refuse
  // to reap at all if any session that owns a managed worktree has no
  // resolvable path: a field mismatch must fail closed, never empty the tree.
  const sessionPath = (s) => s && (s.project_path || s.path);
  const unresolved = existing.filter((s) => s && s.has_managed_worktree === true && !sessionPath(s));
  if (unresolved.length) {
    warn(`orphan reaper: ${unresolved.length} session(s) own a worktree but expose no path — refusing to reap (fail-closed).`);
    return;
  }
  const live = new Set(existing.map(sessionPath).filter(Boolean).map((p) => path.resolve(p)));
  const slugs = seeds.filter((s) => s.worktree === true).map((s) => s.slug);
  if (slugs.length === 0) return;

  const registered = new Map(); // resolved path → branch name
  try {
    const porcelain = execFileSync('git', ['-C', PROJECT, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
    let current = null;
    for (const line of porcelain.split('\n')) {
      if (line.startsWith('worktree ')) current = path.resolve(line.slice('worktree '.length));
      else if (line.startsWith('branch ') && current) registered.set(current, line.slice('branch refs/heads/'.length));
      else if (line === '') current = null;
    }
  } catch (e) {
    warn(`orphan reaper: git worktree list failed: ${e.message} — skipping.`);
    return;
  }
  let mainBranch = 'main';
  try {
    mainBranch = execFileSync('git', ['-C', PROJECT, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim() || 'main';
  } catch { /* detached superproject: keep the default */ }

  let reaped = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const slug = slugs.find((sl) => name === sl || (name.startsWith(`${sl}-`) && /^\d+$/.test(name.slice(sl.length + 1))));
    if (!slug) continue;
    const dir = path.resolve(root, name);
    if (live.has(dir)) continue;

    const branch = registered.get(dir);
    if (!branch) {
      const aside = `${dir}.orphan-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try {
        fs.renameSync(dir, aside);
        warn(`orphan reaper: ${dir} is not a git worktree but blocked seed "${slug}" — moved aside to ${aside}; delete it by hand once checked.`);
      } catch (e) {
        warn(`orphan reaper: could not move ${dir} aside: ${e.message}`);
      }
      continue;
    }

    let dirty;
    let ahead;
    try {
      dirty = execFileSync('git', ['-C', dir, 'status', '--porcelain', '--ignore-submodules=all'], { encoding: 'utf8' }).trim();
      ahead = execFileSync('git', ['-C', dir, 'rev-list', '--count', `${mainBranch}..HEAD`], { encoding: 'utf8' }).trim();
    } catch (e) {
      warn(`orphan reaper: cannot inspect ${dir}: ${e.message} — leaving it.`);
      continue;
    }
    if (dirty) { warn(`orphan reaper: ${dir} has uncommitted changes — leaving it for a human.`); continue; }
    if (ahead !== '0') { warn(`orphan reaper: ${dir} holds ${ahead} commit(s) beyond ${mainBranch} — leaving it for a human.`); continue; }

    try { execFileSync('git', ['-C', PROJECT, 'worktree', 'unlock', dir], { stdio: 'pipe' }); } catch { /* not locked */ }
    try {
      // --force twice: git refuses to remove a worktree containing submodules otherwise.
      execFileSync('git', ['-C', PROJECT, 'worktree', 'remove', '--force', '--force', dir], { stdio: 'pipe' });
    } catch (e) {
      warn(`orphan reaper: could not remove ${dir}: ${String(e.stderr || e.message).trim()}`);
      continue;
    }
    if (branch === name) {
      try { execFileSync('git', ['-C', PROJECT, 'branch', '-D', branch], { stdio: 'pipe' }); } catch { /* already gone */ }
    }
    reaped += 1;
    log(`orphan reaper: removed ${dir} (branch ${branch}: clean, no commits beyond ${mainBranch}, no session).`);
  }
  if (reaped) log(`orphan reaper: ${reaped} worktree(s) reaped under ${root}.`);
}

async function reconcileSessions(sessionTools) {
  if (!(await daemonReady())) {
    warn(`daemon not reachable on ${BASE} — config + settings are in place; session reconciliation deferred to the next boot (fail-open).`);
    return;
  }

  let existing;
  try {
    existing = await listSessions();
  } catch (e) {
    warn(`could not list sessions: ${e.message} — skipping session reconciliation (fail-open).`);
    return;
  }
  try {
    reapOrphanWorktrees(existing);
  } catch (e) {
    warn(`orphan reaper failed: ${e.message} — continuing (fail-open).`);
  }
  const existingTitles = new Set(existing.map((s) => s && s.title).filter(Boolean));

  // The full desired set: coordinator (terminal view) + each seed.
  const desired = [];
  const coordSlug = coordinator.slug || 'tab0';
  desired.push({ title: coordSlug, tool: sessionTools[coordSlug] || 'claude', worktree: false });
  for (const seed of seeds) {
    desired.push({
      title: seed.slug,
      tool: sessionTools[seed.slug] || seed.slug,
      worktree: seed.worktree === true,
      extraArgs: seed.model ? `--model ${seed.model}` : '',
    });
  }

  for (const d of desired) {
    if (existingTitles.has(d.title)) {
      log(`session "${d.title}" already exists — skipping (never killed).`);
      continue;
    }
    try {
      const created = await createSession(d.title, d.tool, d.worktree, d.extraArgs);
      log(`created session "${d.title}" (tool=${d.tool}, worktree=${d.worktree}).`);
      if (d.worktree) {
        // Response shapes vary across builds; fall back to AoE's derived layout.
        const wtPath = (created && (created.path || (created.session && created.session.path)))
          || path.join(`${PROJECT}-worktrees`, d.title);
        initWorktreeSubmodules(wtPath, d.title);
      }
    } catch (e) {
      warn(`create "${d.title}" failed: ${e.message} — continuing (fail-open).`);
    }
  }
}

// ===========================================================================
// main
// ===========================================================================
async function main() {
  if (process.argv.includes('--providers-only')) {
    await provisionOpenCode();
    return;
  }
  log(`interaction plane enabled — reconciling (port ${PORT}, project ${PROJECT}).`);

  // Pass 0 — loud early warning for the repo state that kills worktree creates.
  preflightOrphanGitlinks();

  // Pass 1
  try { provisionOpenRouter(); } catch (e) { warn(`openrouter provisioning failed: ${e.message}`); }
  try { provisionZai(); } catch (e) { warn(`zai provisioning failed: ${e.message}`); }
  try { await provisionOpenCode(); } catch (e) { warn(`OpenCode provisioning failed: ${e.message}`); }

  // Pass 2
  const coverage = buildCoverage();
  try {
    materialiseConfig(coverage);
  } catch (e) {
    warn(`AoE config materialisation failed: ${e.message} — continuing to session reconciliation (fail-open).`);
  }

  // Pass 3
  try {
    if (typeof fetch !== 'function') {
      warn('global fetch unavailable (Node < 18) — skipping session reconciliation (fail-open).');
    } else {
      await reconcileSessions(coverage.sessionTools);
    }
  } catch (e) {
    warn(`session reconciliation error: ${e.message} — fail-open.`);
  }

  log('done.');
}

export { reapOrphanWorktrees };

// Run only when executed as a script (the entrypoint's `node <path>`), so the
// orphan reaper can be imported by tests/cli/aoe-seed-orphans.test.mjs.
// Compare REAL paths: in the baked image /opt/agentbox/scripts is a symlink
// into the Nix store and Node resolves import.meta.url through it, so a plain
// path.resolve(argv[1]) comparison is false there and the seeder silently
// exits 0 without provisioning anything (observed 2026-09-06).
const realpathOr = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
const invokedDirectly = Boolean(process.argv[1])
  && realpathOr(path.resolve(process.argv[1])) === realpathOr(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((e) => {
    warn(`unexpected error: ${e && e.stack ? e.stack : e} — fail-open.`);
    process.exit(process.argv.includes('--providers-only') ? 1 : 0);
  });
}
