#!/usr/bin/env node
/**
 * agentbox config validate
 * Validates agentbox.toml against the JSON Schema and the active semantic rules.
 * Exit 0 = clean (warnings allowed). Non-zero = errors. Each E/W code on its
 * own stderr line: "E### message".
 *
 * Active rule families:
 *   E001-E010, E013-E014, E016
 *                           adapter + federation coherence (ADR-005)
 *   E017-E018, W040         provider credentials + OAuth deferral
 *   W012                    federation-mode advisory (was E012; recategorised)
 *   E019                    CUDA toolchain gate (ADR-007)
 *   E020, E021              security.exceptions coherence (E021 was W021)
 *   E022-E025, W041         privacy filter middleware (ADR-008)
 *   E026-E030, W030, W031, W039
 *                           embedded Nostr relay + pod-inbox bridge (ADR-009)
 *   E033                    solid-pod-rs first-class pod server (ADR-010)
 *   E035-E037, W038         consultant tier (ADR-011 / PRD-005)
 *
 * Reserved / retired codes (do not reuse):
 *   E009                    superseded by E017
 *   E011                    retired 2026-04-25 — duplicated by AJV
 *                           additionalProperties:false; replacement idea is
 *                           to consume nix build .#skills artefact
 *   E015, W034              retired 2026-04-25 with the local-jss legacy stub
 *   E032, E034              reserved
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Three runtime deps from the repo's top-level package.json. When the
// validator is invoked bare (`node scripts/agentbox-config-validate.js`)
// without `npm ci` having run first, these requires throw MODULE_NOT_FOUND
// and the user gets a confusing stack trace. Print an actionable bootstrap
// hint and exit 2 (distinct from validation-failure exit 1 and clean
// exit 0). The wrapper at scripts/agentbox-config-validate.sh handles the
// bootstrap automatically.
let TOML, Ajv, addFormats;
try {
  TOML       = require('@iarna/toml');
  Ajv        = require('ajv/dist/2020');
  addFormats = require('ajv-formats');
} catch (err) {
  if (err.code === 'MODULE_NOT_FOUND') {
    const repoRoot = path.resolve(__dirname, '..');
    const args = process.argv.slice(2).join(' ');
    process.stderr.write(`
agentbox-config-validate: missing Node deps (@iarna/toml, ajv, ajv-formats).

  Quick fix — use the wrapper (auto-bootstraps on first run):
    ./scripts/agentbox-config-validate.sh ${args}

  Or install deps manually from the repo root:
    cd ${repoRoot} && npm ci

  Original error: ${err.message}
`);
    process.exit(2);
  }
  throw err;
}

// ─── paths ────────────────────────────────────────────────────────────────────
const manifestPath = process.argv[2] || path.join(process.cwd(), 'agentbox.toml');
const schemaPath = path.join(__dirname, '..', 'schema', 'agentbox.toml.schema.json');

// ─── helpers ──────────────────────────────────────────────────────────────────
function emit(code, message) {
  process.stderr.write(`${code} ${message}\n`);
}

function allAdapterValues(adapters) {
  if (!adapters || typeof adapters !== 'object') return [];
  return Object.values(adapters);
}

function isOff(val) {
  return val === 'off' || val === undefined || val === null;
}

// ─── load manifest ────────────────────────────────────────────────────────────
let raw;
try {
  raw = fs.readFileSync(manifestPath, 'utf8');
} catch (err) {
  emit('E000', `Cannot read manifest at ${manifestPath}: ${err.message}`);
  process.exit(1);
}

let manifest;
try {
  manifest = TOML.parse(raw);
} catch (err) {
  emit('E000', `TOML parse error in ${manifestPath}: ${err.message}`);
  process.exit(1);
}

// ─── load schema ──────────────────────────────────────────────────────────────
let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
} catch (err) {
  emit('E000', `Cannot load schema at ${schemaPath}: ${err.message}`);
  process.exit(1);
}

// ─── JSON Schema validation (enforces E016 UnknownManifestKey) ────────────────
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const schemaValid = validate(manifest);

let errors = [];
// Advisory warnings — emitted to stderr but DO NOT cause a non-zero exit.
// Used for direction signals (e.g. W030 open-policy nudge) that
// document operator intent without blocking validation. Renamed E-codes
// (W021→E021, E012→W012, E031→W031, E038→W038) reflect blocking vs
// advisory semantics matching the validator's actual exit-code behaviour.
let warnings = [];

if (!schemaValid) {
  for (const err of validate.errors) {
    const loc = err.instancePath || '/';
    if (err.keyword === 'additionalProperties') {
      errors.push({ code: 'E016', message: `UnknownManifestKey: unknown key "${err.params.additionalProperty}" at ${loc}` });
    } else {
      errors.push({ code: 'E016', message: `UnknownManifestKey: schema violation at ${loc}: ${err.message}` });
    }
  }
}

// ─── semantic rules (see header docstring for the active code surface) ───────
const adapters = manifest.adapters || {};
const federation = manifest.federation || {};
const integrations = manifest.integrations || {};
const skills = manifest.skills || {};
const gpu = manifest.gpu || {};
const desktop = manifest.desktop || {};
const observability = manifest.observability || {};
const sovereignMesh = manifest.sovereign_mesh || {};
const providers = manifest.providers || {};

// E001: any adapter set to "external" requires federation.mode="client" and
//       federation.external_url (or the relevant integrations section) populated.
{
  const externalAdapters = Object.entries(adapters).filter(([, v]) => v === 'external').map(([k]) => k);
  for (const slot of externalAdapters) {
    if (federation.mode !== 'client' || !federation.external_url) {
      errors.push({
        code: 'E001',
        message: `E001: adapter "${slot}" is "external" but federation.mode is not "client" or federation.external_url is empty`
      });
    }
  }
}

// E002: adapters.memory="external-pg" requires integrations.ruvector_external.conninfo to be non-empty.
if (adapters.memory === 'external-pg') {
  const conninfo = integrations.ruvector_external && integrations.ruvector_external.conninfo;
  if (!conninfo || conninfo.trim() === '') {
    errors.push({
      code: 'E002',
      message: 'E002: adapters.memory is "external-pg" but integrations.ruvector_external.conninfo is missing or empty'
    });
  }
}

// E003: adapters.orchestrator="stdio-bridge" — compose MUST NOT also bind a port for the orchestrator adapter.
// Validated here as a static manifest check: if orchestrator=stdio-bridge AND
// integrations.external_orchestrator.protocol is "http", that is a port-bind conflict.
if (adapters.orchestrator === 'stdio-bridge') {
  const extOrch = integrations.external_orchestrator || {};
  if (extOrch.enabled === true && extOrch.protocol === 'http') {
    errors.push({
      code: 'E003',
      message: 'E003: adapters.orchestrator is "stdio-bridge" but integrations.external_orchestrator.protocol is "http"; compose MUST NOT bind a port for the orchestrator adapter when using stdio-bridge'
    });
  }
}

// E004: all-"off" is legal only if federation.mode="standalone" (warning printed on startup here as an error hint).
{
  const adapterValues = Object.values(adapters);
  const allOff = adapterValues.length > 0 && adapterValues.every(v => v === 'off');
  if (allOff && federation.mode !== 'standalone') {
    errors.push({
      code: 'E004',
      message: 'E004: all adapters are "off" but federation.mode is not "standalone"; all-off profile MUST declare federation.mode="standalone"'
    });
  }
}

// E005: adapters.events="external" requires integrations.external_events with at least one of url, relay_urls, mcp_endpoint.
if (adapters.events === 'external') {
  const extEv = integrations.external_events || {};
  const hasEndpoint = !!(extEv.url || (Array.isArray(extEv.relay_urls) && extEv.relay_urls.length > 0) || extEv.mcp_endpoint);
  if (!hasEndpoint) {
    errors.push({
      code: 'E005',
      message: 'E005: adapters.events is "external" but integrations.external_events is missing or has no url, relay_urls, or mcp_endpoint'
    });
  }
}

// E006: skills.spatial_and_3d.gaussian_splatting=true requires gpu.backend="local-cuda".
if (skills.spatial_and_3d && skills.spatial_and_3d.gaussian_splatting === true) {
  if (gpu.backend !== 'local-cuda') {
    errors.push({
      code: 'E006',
      message: `E006: skills.spatial_and_3d.gaussian_splatting is true but gpu.backend is "${gpu.backend || 'unset'}" (must be "local-cuda")`
    });
  }
}

// E007: skills.media.comfyui_builtin and integrations.comfyui_external.enabled MUST NOT both be true.
{
  const builtinOn = skills.media && skills.media.comfyui_builtin === true;
  const externalOn = integrations.comfyui_external && integrations.comfyui_external.enabled === true;
  if (builtinOn && externalOn) {
    errors.push({
      code: 'E007',
      message: 'E007: skills.media.comfyui_builtin and integrations.comfyui_external.enabled are mutually exclusive — enable only one'
    });
  }
}

// E008: gpu.backend="local-cuda" on aarch64 raises an error.
// Detect arch from process.arch ('arm64' maps to aarch64).
if (gpu.backend === 'local-cuda') {
  const arch = process.arch;
  if (arch === 'arm64' || arch === 'aarch64') {
    errors.push({
      code: 'E008',
      message: `E008: gpu.backend is "local-cuda" but host arch is ${arch}; local-cuda is x86_64 only`
    });
  }
}

// E009: reserved — previously used for provider env-var check; superseded by E017.

// E017: every enabled providers.<name> section MUST have its env_var present in the environment.
// E018: an enabled provider's env_var value must not be a placeholder literal.
// W040: auth_mode = "oauth" is only honoured for providers whose CLI ships an OAuth flow.
const PLACEHOLDER_RE = /^(change[-_]?this|your[-_]?key[-_]?here|sk[-_]?xxx+|AKIA[A-Z0-9]{12}EXAMPLE|<[^>]+>|PLACEHOLDER|TODO)$/i;
const OAUTH_CAPABLE_PROVIDERS = new Set(['anthropic', 'openai', 'zai']);

for (const [name, provConf] of Object.entries(providers)) {
  if (!provConf || provConf.enabled !== true) continue;

  // env_var is `required: true` in the schema, so AJV E016 already rejects
  // any provider block without one. The old `${NAME}_API_KEY` fallback was
  // unreachable in practice and silently wrong for gemini (GOOGLE_GEMINI_API_KEY)
  // and github (GITHUB_TOKEN), so it's been removed.
  const envVar = provConf.env_var;
  const envValue = process.env[envVar];
  const authMode = provConf.auth_mode || 'api_key';

  // W040 — oauth requested on a provider whose CLI has no in-container OAuth
  // flow. The setting is silently ignored at runtime (the CLI will still need
  // the env var) and E017 will still fire below if env_var is unset, so this
  // is purely an advisory that the auth_mode value is dead config.
  if (authMode === 'oauth' && !OAUTH_CAPABLE_PROVIDERS.has(name)) {
    warnings.push({
      code: 'W040',
      message: `W040: provider "${name}" has auth_mode="oauth" but no in-container OAuth CLI is wired up; the setting is ignored and ${envVar} still needs to be set (E017 will fire if it isn't). Supported oauth providers: ${[...OAUTH_CAPABLE_PROVIDERS].sort().join(', ')}.`
    });
  }

  const honourOAuth = authMode === 'oauth' && OAUTH_CAPABLE_PROVIDERS.has(name);

  // E017 — must be set (non-empty), unless oauth defers credentials to runtime CLI login.
  if (!envValue) {
    if (!honourOAuth) {
      errors.push({
        code: 'E017',
        message: `E017: provider "${name}" is enabled but env var "${envVar}" is not set (set auth_mode="oauth" if this provider's CLI handles login itself)`
      });
    }
  } else if (PLACEHOLDER_RE.test(envValue.trim())) {
    // E018 — value looks like a placeholder. The previous `.env.example`
    // carve-out tested the manifest filename (which is always agentbox.toml,
    // not .env.example) and never matched, so it's been dropped — placeholder
    // env vars always trip E018 now.
    errors.push({
      code: 'E018',
      message: `E018: provider "${name}" env var "${envVar}" contains a placeholder value — replace it with a real credential`
    });
  }
}

// E010: desktop.enabled=true forbids any profile marked headless_only=true.
// Profile files are read from /workspace/profiles/*/profile.toml when desktop is enabled.
if (desktop.enabled === true) {
  const profilesRoot = '/workspace/profiles';
  if (fs.existsSync(profilesRoot)) {
    let profileDirs = [];
    try {
      profileDirs = fs.readdirSync(profilesRoot);
    } catch (_) {}
    for (const pd of profileDirs) {
      const pfile = path.join(profilesRoot, pd, 'profile.toml');
      if (fs.existsSync(pfile)) {
        try {
          const pconf = TOML.parse(fs.readFileSync(pfile, 'utf8'));
          if (pconf.headless_only === true) {
            errors.push({
              code: 'E010',
              message: `E010: desktop.enabled is true but profile "${pd}" is marked headless_only=true`
            });
          }
        } catch (_) {}
      }
    }
  }
}

// E011 retired 2026-04-25.
// Was: every enabled skill must resolve to a known skill in the corpus.
// Unreachable in practice: the schema already declares every skill key
// under skills.* with `additionalProperties: false`, so AJV E016 catches
// unknown skill keys before this semantic block runs. The hardcoded
// KNOWN_SKILLS snapshot also drifted from the actual skills corpus over
// time, producing false positives for newly-added skills. Replacement
// idea: have the rule consume `nix build .#skills` artefact at validate
// time. Until that lands, retire the rule rather than ship a dead check.

// W012: federation.mode="client" with any local-* adapter is legitimate for
// graceful-degrade testing but worth flagging. Recategorised from E012 to
// W012 in 2026-04-25 — the docstring always called this a warning, but the
// rule was pushing to errors[] and forcing a non-zero exit which made every
// federated negative test cascade noise.
if (federation.mode === 'client') {
  const localAdapters = Object.entries(adapters).filter(([, v]) => typeof v === 'string' && v.startsWith('local-')).map(([k]) => k);
  if (localAdapters.length > 0) {
    warnings.push({
      code: 'W012',
      message: `W012: federation.mode is "client" but adapter(s) [${localAdapters.join(', ')}] use local-* implementation; allowed for graceful-degrade testing but flagged`
    });
  }
}

// E013: observability.metrics_port MUST NOT collide with other known ports.
// Labels match what supervisorctl status / docker ps would print, so the
// collision message names what the operator will actually find listening.
const RESERVED_PORTS = {
  5901: 'desktop VNC (x11vnc)',
  8080: 'code-server',
  8484: 'solid-pod-rs',
  9090: 'management-api'
};
if (observability.metrics_port !== undefined) {
  const mp = observability.metrics_port;
  if (RESERVED_PORTS[mp]) {
    errors.push({
      code: 'E013',
      message: `E013: observability.metrics_port ${mp} collides with ${RESERVED_PORTS[mp]}`
    });
  }
}

// E014: sovereign_mesh.telegram_mirror=true requires CTM_BOT_TOKEN and CTM_TELEGRAM_CHAT_ID.
if (sovereignMesh.telegram_mirror === true) {
  if (!process.env.CTM_BOT_TOKEN) {
    errors.push({
      code: 'E014',
      message: 'E014: sovereign_mesh.telegram_mirror is true but CTM_BOT_TOKEN env var is not set'
    });
  }
  if (!process.env.CTM_TELEGRAM_CHAT_ID) {
    errors.push({
      code: 'E014',
      message: 'E014: sovereign_mesh.telegram_mirror is true but CTM_TELEGRAM_CHAT_ID env var is not set'
    });
  }
}

// E015 retired — `sovereign_mesh.jss_rust_backend` was a placeholder for a
// `jss-rust` Nix flake input that was never declared. The Rust pod adoption
// landed as solid-pod-rs (ADR-010) instead, wired through lib/solid-pod-rs.nix.
// The schema property is gone; the field is silently ignored if old manifests
// still contain it (caught by E016 at the schema layer).

// ─── E035-E038: consultant-tier coherence (ADR-011 / PRD-005) ─────────────────
//
// E035 — every consultants.<name>.enabled=true requires the matching
//        providers.<provider>.enabled=true (so the credential env var is
//        present at boot per E017).
// E036 — any consultants.<name>.enabled=true requires consultants.enabled=true
//        (master gate); avoids accidentally shipping a consultant in the
//        image while the dispatcher is off.
// E037 — consultants.codex requires toolchains.codex;
//        consultants.gemini requires toolchains.gemini_cli;
//        consultants.zai requires toolchains.claude (the claude-zai wrapper
//        is bundled with that toolchain — without it `claude-zai` isn't on
//        PATH inside the container).
//        consultants.{perplexity,deepseek} talk over raw HTTP and have no
//        toolchain gate.
// W038 — intelligence_signal needs a writable target dir at runtime.
{
  const consultants = manifest.consultants || {};
  const consultantToProvider = {
    codex:      'openai',
    gemini:     'gemini',
    zai:        'zai',
    perplexity: 'perplexity',
    deepseek:   'deepseek',
  };
  const consultantToToolchain = {
    codex:  'codex',
    gemini: 'gemini_cli',
    // zai uses the `claude-zai` wrapper, which is a fork of claude-code
    // bundled with toolchains.claude. perplexity and deepseek consultants
    // talk over raw HTTP and have no toolchain gate.
    zai:    'claude',
  };
  const tcCfg = manifest.toolchains || {};

  const subConsultants = ['codex', 'gemini', 'zai', 'perplexity', 'deepseek'];
  let anySubEnabled = false;

  for (const sub of subConsultants) {
    const c = consultants[sub] || {};
    if (c.enabled !== true) continue;
    anySubEnabled = true;

    // E035 — provider gate
    const providerName = consultantToProvider[sub];
    const provCfg = (providers[providerName] || {});
    if (provCfg.enabled !== true) {
      errors.push({
        code: 'E035',
        message: `E035: consultants.${sub}.enabled=true requires providers.${providerName}.enabled=true (so the env var is present at boot — see E017)`
      });
    }

    // E037 — toolchain gate (only for the CLI-spawning consultants)
    const tcName = consultantToToolchain[sub];
    if (tcName && tcCfg[tcName] !== true) {
      errors.push({
        code: 'E037',
        message: `E037: consultants.${sub}.enabled=true requires toolchains.${tcName}=true (the binary that consultants.${sub} spawns)`
      });
    }
  }

  // E036 — master-gate coherence
  if (anySubEnabled && consultants.enabled !== true) {
    errors.push({
      code: 'E036',
      message: 'E036: at least one consultants.<name>.enabled=true but consultants.enabled=false (set the master gate first)'
    });
  }

  // W038 — intelligence_signal needs a writable target dir. Degraded-runtime
  // condition rather than a config error: the image still builds, the
  // consultants still answer, only the SONA-feedback signals get dropped.
  // Recategorised from E038 to W038 in 2026-04-25.
  if (consultants.intelligence_signal === true && consultants.enabled === true) {
    if (!process.env.AGENTBOX_INTELLIGENCE_DIR && !process.env.WORKSPACE) {
      warnings.push({
        code: 'W038',
        message: 'W038: consultants.intelligence_signal=true but neither AGENTBOX_INTELLIGENCE_DIR (preferred) nor WORKSPACE is set; signal files will be silently dropped at runtime'
      });
    }
  }
}

// ─── E032-E033: solid-pod-rs first-class pod server (ADR-010) ─────────────────
//
// E032 — adapters.pods="local-solid-rs" requires the filesystem backend to
//        have a writable path. Emitted as E021-style exception-missing error
//        when [security.exceptions.solid-pod-rs] is absent.
// E033 — integrations.solid_pod_rs.enable_dpop_cache=true requires
//        enable_oidc=true (DPoP is OIDC-only).
// (W034, the local-jss deprecation warning, was retired 2026-04-25 along
//  with the legacy stub; the schema enum no longer accepts local-jss.)
{
  const pods = (manifest.adapters || {}).pods;
  const sp   = (manifest.integrations || {}).solid_pod_rs || {};

  if (pods === 'local-solid-rs') {
    // E032 is handled structurally by the E021 exception-coherence check
    // (isFeatureActive('solid-pod-rs') returns true when pods=local-solid-rs,
    // so the validator will emit E021 if the exception block is missing).
    if (sp.enable_dpop_cache === true && sp.enable_oidc !== true) {
      errors.push({
        code: 'E033',
        message: 'E033: integrations.solid_pod_rs.enable_dpop_cache=true requires enable_oidc=true (DPoP is OIDC-only)'
      });
    }
  }

  // local-jss was removed 2026-04-25; the schema enum no longer accepts it,
  // so the AJV schema check raises E016 on any legacy manifest before this
  // semantic block runs. Nothing to do here.
}

// ─── E026-E031 / W030: embedded Nostr relay coherence (ADR-009) ───────────────
//
// E026 — sovereign_mesh.relay.enabled=true requires sovereign_mesh.enabled=true
//        OR sovereign_mesh.solid_pod=true (pod bridging needs one of them).
// E027 — implementation="external" requires federation.mode="client" and
//        federation.external_url populated.
// E028 — port must not collide with RESERVED_PORTS, observability.metrics_port,
//        or privacy_filter.port.
// E029 — bind="0.0.0.0" without expose=true is a wiring error (bound inside
//        container, unreachable from host — silent hole).
// W030 — ingress_policy="open" raises a warning (always correctable, never
//        silent) — exits non-zero per project convention for all W-codes.
// E031 — allow_nip04=true raises a warning (prefer NIP-17 sealed DMs).
{
  const relay = (sovereignMesh.relay) || {};
  if (relay.enabled === true) {
    if (sovereignMesh.enabled !== true && sovereignMesh.solid_pod !== true) {
      errors.push({
        code: 'E026',
        message: 'E026: sovereign_mesh.relay.enabled=true requires sovereign_mesh.enabled=true or sovereign_mesh.solid_pod=true'
      });
    }

    const impl = relay.implementation || 'nostr-rs-relay';
    if (impl === 'external') {
      if (federation.mode !== 'client' || !federation.external_url) {
        errors.push({
          code: 'E027',
          message: 'E027: sovereign_mesh.relay.implementation="external" requires federation.mode="client" and federation.external_url'
        });
      }
    }

    const relayPort = relay.port;
    const pfPort = (manifest.privacy_filter || {}).port;
    const spPort = ((manifest.integrations || {}).solid_pod_rs || {}).port;
    if (relayPort !== undefined) {
      if (RESERVED_PORTS[relayPort]) {
        errors.push({
          code: 'E028',
          message: `E028: sovereign_mesh.relay.port ${relayPort} collides with ${RESERVED_PORTS[relayPort]}`
        });
      }
      if (observability.metrics_port !== undefined && relayPort === observability.metrics_port) {
        errors.push({
          code: 'E028',
          message: `E028: sovereign_mesh.relay.port ${relayPort} collides with observability.metrics_port`
        });
      }
      if (pfPort !== undefined && relayPort === pfPort) {
        errors.push({
          code: 'E028',
          message: `E028: sovereign_mesh.relay.port ${relayPort} collides with privacy_filter.port`
        });
      }
      if (spPort !== undefined && relayPort === spPort) {
        errors.push({
          code: 'E028',
          message: `E028: sovereign_mesh.relay.port ${relayPort} collides with integrations.solid_pod_rs.port`
        });
      }
    }

    if (relay.bind === '0.0.0.0' && relay.expose !== true) {
      errors.push({
        code: 'E029',
        message: 'E029: sovereign_mesh.relay.bind="0.0.0.0" without expose=true — bound inside container but unreachable from host'
      });
    }

    // W030 escalates to E030 when the relay is wide-open AND federation is
    // bidirectional — the combination is an unbounded ingress path that the
    // operator probably didn't intend (added 2026-04-25; closes a gap noted
    // by the QE audit).
    const fanout = relay.external_fanout;
    if (relay.ingress_policy === 'open' && fanout === 'bidirectional') {
      errors.push({
        code: 'E030',
        message: 'E030: sovereign_mesh.relay.ingress_policy="open" combined with external_fanout="bidirectional" creates an unbounded ingress path; tighten ingress_policy to "allowlist" or "signed-only"'
      });
    } else if (relay.ingress_policy === 'open') {
      warnings.push({
        code: 'W030',
        message: 'W030: sovereign_mesh.relay.ingress_policy="open" — relay will accept writes from any client; prefer "allowlist" or "signed-only"'
      });
    }

    // W039: allowlist with empty allowed_pubkeys means the relay only accepts
    // its own npub — operators rarely want this. Often a copy-paste error
    // where they switched to allowlist but forgot to populate the list.
    if (relay.ingress_policy === 'allowlist'
        && (!Array.isArray(relay.allowed_pubkeys) || relay.allowed_pubkeys.length === 0)) {
      warnings.push({
        code: 'W039',
        message: 'W039: sovereign_mesh.relay.ingress_policy="allowlist" but allowed_pubkeys is empty — only the local npub will be accepted; populate allowed_pubkeys or switch to ingress_policy="signed-only"'
      });
    }

    if (relay.allow_nip04 === true) {
      warnings.push({
        code: 'W031',
        message: 'W031: sovereign_mesh.relay.allow_nip04=true — NIP-04 legacy DMs leak metadata; prefer NIP-17 sealed gift-wrap (kind 1059) where possible'
      });
    }
  }
}

// ─── E022-E025: privacy filter coherence (ADR-008) ────────────────────────────
//
// E022 — privacy_filter.enabled=true requires mode != "off".
// E023 — privacy_filter.mode="local-gpu" requires gpu.backend != "none".
// E024 — privacy_filter.dtype="q4" requires mode="local-cpu".
// E025 — privacy_filter.port must not collide with RESERVED_PORTS or
//        observability.metrics_port.
{
  const pf = manifest.privacy_filter || {};
  if (pf.enabled === true) {
    const explicitMode = pf.mode;
    const mode = explicitMode || "off";
    if (mode === "off") {
      const cause = explicitMode === undefined
        ? 'mode is unset (defaults to "off")'
        : 'mode="off"';
      errors.push({
        code: 'E022',
        message: `E022: privacy_filter.enabled=true but ${cause} — set privacy_filter.mode to "local-gpu" or "local-cpu"`
      });
    }
    if (mode === 'local-gpu' && (gpu.backend === undefined || gpu.backend === 'none')) {
      errors.push({
        code: 'E023',
        message: `E023: privacy_filter.mode="local-gpu" requires gpu.backend != "none" (got "${gpu.backend || 'unset'}")`
      });
    }
    if ((pf.dtype || 'bf16') === 'q4' && mode !== 'local-cpu') {
      errors.push({
        code: 'E024',
        message: `E024: privacy_filter.dtype="q4" requires mode="local-cpu" (got "${mode}")`
      });
    }
    const pfPort = pf.port;
    const spPortPf = ((manifest.integrations || {}).solid_pod_rs || {}).port;
    if (pfPort !== undefined) {
      if (RESERVED_PORTS[pfPort]) {
        errors.push({
          code: 'E025',
          message: `E025: privacy_filter.port ${pfPort} collides with ${RESERVED_PORTS[pfPort]}`
        });
      }
      if (observability.metrics_port !== undefined && pfPort === observability.metrics_port) {
        errors.push({
          code: 'E025',
          message: `E025: privacy_filter.port ${pfPort} collides with observability.metrics_port`
        });
      }
      if (spPortPf !== undefined && pfPort === spPortPf) {
        errors.push({
          code: 'E025',
          message: `E025: privacy_filter.port ${pfPort} collides with integrations.solid_pod_rs.port`
        });
      }
    }
  }

  // W041 — dead-config check. privacy_filter.policy.<slot> declares fail-open
  // / fail-closed semantics that only matter when the filter is actually
  // running. If enabled=false but any policy slot carries a non-default value,
  // the operator probably forgot the master gate.
  if (pf.enabled !== true && pf.policy && typeof pf.policy === 'object') {
    const nonDefault = Object.entries(pf.policy)
      .filter(([_, v]) => typeof v === 'string' && v !== 'off')
      .map(([slot]) => slot);
    if (nonDefault.length > 0) {
      warnings.push({
        code: 'W041',
        message: `W041: privacy_filter.enabled is false but policy slot(s) [${nonDefault.join(', ')}] declare non-default values; the policy is dead config until you set privacy_filter.enabled=true`
      });
    }
  }
}

// E019: [toolchains].cuda=true requires [gpu].backend="local-cuda"
// Having a CUDA toolchain without a CUDA-capable GPU backend is a misconfiguration
// that would produce a broken image (CUDA libraries present but no GPU access path).
{
  const toolchains = manifest.toolchains || {};
  if (toolchains.cuda === true) {
    if (gpu.backend !== 'local-cuda') {
      errors.push({
        code: 'E019',
        message: `E019 [toolchains.cuda]=true requires [gpu.backend]="local-cuda"`
      });
    }
  }
}

// ─── E020 / E021: security exception coherence ────────────────────────────────
//
// Each [security.exceptions.<name>] key must correspond to an enabled feature
// gate (E020 error when the feature is OFF but an exception block is present).
//
// E021 is the inverse: a feature that has a known exception mapping is enabled
// but no exception block is declared — the hardened baseline may be inadequate.
// Renamed from W021 in 2026-04-25 to match the blocking semantic; W021 was
// always pushed to errors[] but the W-prefix mislabelled it as advisory.
//
// Authoritative feature→exception mapping table:
//   exception name        │ feature is active when
//   ──────────────────────┼────────────────────────────────────────────────────
//   desktop               │ desktop.enabled === true
//   gpu-rocm              │ gpu.backend === "ollama-rocm"
//   gpu-cuda              │ gpu.backend === "ollama-cuda" OR "local-cuda"
//   gaussian-splatting    │ skills.spatial_and_3d.gaussian_splatting === true
//   playwright            │ skills.browser.playwright === true
//   code-server           │ toolchains.code_server === true
//   telegram-mirror       │ sovereign_mesh.telegram_mirror === true

const toolchains = manifest.toolchains || {};

function isFeatureActive(exceptionName) {
  switch (exceptionName) {
    case 'desktop':
      return desktop.enabled === true;
    case 'gpu-rocm':
      return gpu.backend === 'ollama-rocm';
    case 'gpu-cuda':
      return gpu.backend === 'ollama-cuda' || gpu.backend === 'local-cuda';
    case 'gaussian-splatting':
      return !!(skills.spatial_and_3d && skills.spatial_and_3d.gaussian_splatting === true);
    case 'playwright':
      return !!(skills.browser && skills.browser.playwright === true);
    case 'code-server':
      return toolchains.code_server === true;
    case 'telegram-mirror':
      return sovereignMesh.telegram_mirror === true;
    case 'nostr-relay':
      return !!(sovereignMesh.relay && sovereignMesh.relay.enabled === true);
    case 'solid-pod-rs':
      return (manifest.adapters || {}).pods === 'local-solid-rs';
    default:
      return false;
  }
}

// Known exception names with documented feature gates (for W021).
const KNOWN_EXCEPTION_FEATURE_GATES = new Set([
  'desktop',
  'gpu-rocm',
  'gpu-cuda',
  'gaussian-splatting',
  'playwright',
  'code-server',
  'telegram-mirror',
  'nostr-relay',
  'solid-pod-rs'
]);

const security = manifest.security || {};
const securityExceptions = (security.exceptions && typeof security.exceptions === 'object')
  ? security.exceptions
  : {};

// E020: declared exception block but corresponding feature not enabled.
for (const exceptionName of Object.keys(securityExceptions)) {
  if (!isFeatureActive(exceptionName)) {
    errors.push({
      code: 'E020',
      message: `E020: [security.exceptions.${exceptionName}] is declared but the corresponding feature gate is not enabled — remove the block or enable the feature`
    });
  }
}

// E021: feature enabled but documented exception block is missing.
// Emitted as an error (non-zero exit) because the hardened baseline may be
// silently broken at runtime without the exception delta applied.
for (const exceptionName of KNOWN_EXCEPTION_FEATURE_GATES) {
  if (isFeatureActive(exceptionName) && !securityExceptions[exceptionName]) {
    errors.push({
      code: 'E021',
      message: `E021: feature corresponding to [security.exceptions.${exceptionName}] is enabled but no exception block is declared — the hardened baseline may be inadequate for this feature`
    });
  }
}

// E016 is handled by AJV schema validation above (additionalProperties: false at every section).
// E017 and E018 are handled in the providers loop above.

// ─── output ───────────────────────────────────────────────────────────────────
// Warnings (W-codes) are always printed to stderr — they are direction
// signals and do not affect the exit code. Errors (E-codes) cause exit 1.
for (const { code, message } of warnings) {
  emit(code, message);
}

if (errors.length === 0) {
  const suffix = warnings.length > 0 ? ` (${warnings.length} advisory warning${warnings.length === 1 ? '' : 's'})` : '';
  process.stdout.write(`agentbox manifest valid: ${manifestPath}${suffix}\n`);
  process.exit(0);
} else {
  for (const { code, message } of errors) {
    emit(code, message);
  }
  process.exit(1);
}
