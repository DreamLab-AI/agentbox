#!/usr/bin/env node
// ============================================================================
// aoe-seed-sessions.mjs — interaction-plane boot reconciler (PRD-021 WS2)
// ----------------------------------------------------------------------------
// Reads [interaction_plane].session_seeds from agentbox.toml and reconciles the
// Agent-of-Empires (AoE) interaction plane in three passes, all fail-open:
//
//   1. Provision OpenRouter/ZAI profile settings and OpenCode's native provider
//      connectors for the LAN Gemma and hosted DeepSeek sessions.
//   2. Materialise AoE's config.toml (custom_agents + agent_command_override +
//      agent_detect_as for the seven consoles, the AGENTBOX_PROFILE-per-session
//      env binding, status_hooks → scripts/aoe-session-boundary.cjs, sandbox
//      OFF) into ~/.config/agent-of-empires/config.toml, merging non-managed
//      keys so a running daemon's own settings survive.
//   3. Idempotently ensure the seeded sessions exist on the daemon
//      (127.0.0.1:<port>, --auth none loopback, token-free): match by title,
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
if (ip.enabled !== true) {
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
  { slug: 'antigravity', tool: 'antigravity', worktree: true },
  { slug: 'openrouter', tool: 'claude', worktree: false, env_allowlist: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'] },
  { slug: 'zai', tool: 'claude', worktree: false, env_allowlist: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'] },
  { slug: 'deepseek', tool: 'opencode', model: 'deepseek-agent/deepseek-chat', worktree: true },
  { slug: 'gemma', tool: 'opencode', model: 'gemma-lan/gemma-4-31B-it-qat', worktree: true },
];
const seeds = Array.isArray(ip.session_seeds) && ip.session_seeds.length ? ip.session_seeds : DEFAULT_SEEDS;
const coordinator = ip.coordinator || { slug: 'tab0', tool: 'claude', view: 'terminal' };

// Slugs that are the redirected-Claude harnesses handled by the wrapper scripts.
const WRAPPER_SLUGS = { openrouter: 'openrouter.sh', zai: 'zai.sh' };

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
  const endpoint = process.env.ZAI_URL || 'https://api.z.ai/api/anthropic';
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

// OpenCode is a first-class AoE agent, so provider selection stays in its
// supported configuration surface instead of inventing custom wrapper agents.
function provisionOpenCode() {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const configPath = path.join(configHome, 'opencode', 'opencode.json');
  const gemmaBase = normalizedV1Url(process.env.GEMMA_BASE_URL, 'http://192.168.2.48:8084/v1');
  const deepseekBase = normalizedV1Url(process.env.DEEPSEEK_BASE_URL, 'https://api.deepseek.com/v1');
  const gemmaModel = process.env.GEMMA_MODEL || 'gemma-4-31B-it-qat';
  writeJsonIfContent(configPath, {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      'gemma-lan': {
        npm: '@ai-sdk/openai-compatible',
        name: 'Gemma 4 31B LAN',
        options: { baseURL: gemmaBase, apiKey: 'not-needed' },
        models: {
          [gemmaModel]: {
            name: 'Gemma 4 31B LAN',
            limit: { context: 262144, output: 65536 },
          },
        },
      },
      'deepseek-agent': {
        npm: '@ai-sdk/openai-compatible',
        name: 'DeepSeek',
        options: { baseURL: deepseekBase, apiKey: '{env:DEEPSEEK_API_KEY}' },
        models: {
          'deepseek-chat': {
            name: 'DeepSeek V4 Flash',
          },
        },
      },
    },
  }, 0o644); // Provider config contains references, not secrets; AoE runs OpenCode as devuser.
  log(`provisioned OpenCode providers (Gemma: ${gemmaBase}; DeepSeek: ${deepseekBase}).`);
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
      const wrapper = path.join(WRAPPER_DIR, WRAPPER_SLUGS[slug]);
      customAgents[slug] = wrapper; // wrapper self-exports AGENTBOX_PROFILE
      detectAs[slug] = 'claude';
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
      overrides[tool] = `env AGENTBOX_PROFILE=${slug} ${bin}`;
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

function fetchWithTimeout(url, opts = {}, ms = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
}

async function daemonReady(retries = 10, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetchWithTimeout(`${BASE}/api/sessions?state=all`, {}, 2000);
      if (r.ok) return true;
    } catch { /* not up yet */ }
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
  log(`interaction plane enabled — reconciling (port ${PORT}, project ${PROJECT}).`);

  // Pass 0 — loud early warning for the repo state that kills worktree creates.
  preflightOrphanGitlinks();

  // Pass 1
  try { provisionOpenRouter(); } catch (e) { warn(`openrouter provisioning failed: ${e.message}`); }
  try { provisionZai(); } catch (e) { warn(`zai provisioning failed: ${e.message}`); }
  try { provisionOpenCode(); } catch (e) { warn(`OpenCode provisioning failed: ${e.message}`); }

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

main().catch((e) => {
  warn(`unexpected error: ${e && e.stack ? e.stack : e} — fail-open.`);
  process.exit(0);
});
