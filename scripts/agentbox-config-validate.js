#!/usr/bin/env node
/**
 * agentbox config validate
 * Validates agentbox.toml against the JSON Schema and 33 semantic rules
 * (E001-E008, E010-E020, E022-E029, E031, E033 + W021, W030, W034;
 * E009, E030, E032 reserved).
 * Exit 0 = clean. Non-zero = errors. Errors on stderr, one per line: "E### message"
 *
 * Rule families:
 *   E001-E016  adapter + federation + provider coherence (ADR-005)
 *   E017-E018  provider env-var presence
 *   E019       CUDA toolchain gate (ADR-007)
 *   E020/W021  security.exceptions coherence (ADR-007)
 *   E022-E025  privacy filter middleware (ADR-008)
 *   E026-E029/W030/E031  embedded Nostr relay + pod-inbox bridge (ADR-009)
 *   E033/W034  solid-pod-rs first-class pod server (ADR-010)
 *   E035-E038  consultant tier (ADR-011 / PRD-005)
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
// Used for direction signals (W034 deprecation, W030 open-policy nudge) that
// document operator intent without blocking validation. W021 stays in errors
// because the hardened baseline may be silently broken without the
// corresponding security exception delta.
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

// ─── semantic rules (E001-E031, W021, W030; E009 reserved) ───────────────────
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
const PLACEHOLDER_RE = /^(change[-_]?this|your[-_]?key[-_]?here|sk[-_]?xxx+|AKIA[A-Z0-9]{12}EXAMPLE|<[^>]+>|PLACEHOLDER|TODO)$/i;

for (const [name, provConf] of Object.entries(providers)) {
  if (!provConf || provConf.enabled !== true) continue;

  const envVar = provConf.env_var || `${name.toUpperCase()}_API_KEY`;
  const envValue = process.env[envVar];

  // E017 — must be set (non-empty)
  if (!envValue) {
    errors.push({
      code: 'E017',
      message: `E017: provider "${name}" is enabled but env var "${envVar}" is not set`
    });
  } else if (PLACEHOLDER_RE.test(envValue.trim())) {
    // E018 — value looks like a placeholder; warn (still an error exit) unless this is .env.example
    const manifestFile = path.resolve(manifestPath);
    const isEnvExample = manifestFile.endsWith('.env.example');
    if (!isEnvExample) {
      errors.push({
        code: 'E018',
        message: `E018: provider "${name}" env var "${envVar}" contains a placeholder value — replace it with a real credential`
      });
    }
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

// E011: every enabled skill MUST resolve to a Nix package declared in the skills-corpus.
// At validate-time we check that any `true` skill flag exists as a known skill name.
// The authoritative skill list is provided by the skills-corpus Nix input; here we
// validate against the set of keys in the schema's skills sub-sections.
const KNOWN_SKILLS = new Set([
  'playwright', 'qe_browser', 'agent_browser',
  'ffmpeg', 'imagemagick', 'comfyui_builtin',
  'blender', 'qgis', 'gaussian_splatting',
  'pytorch', 'jupyter',
  'latex', 'mermaid', 'report_builder',
  'ontology'
]);
for (const [group, groupConf] of Object.entries(skills)) {
  if (typeof groupConf === 'object' && groupConf !== null) {
    for (const [skillName, flagValue] of Object.entries(groupConf)) {
      if (flagValue === true) {
        const key = group === 'ontology' ? 'ontology' : skillName;
        if (!KNOWN_SKILLS.has(key)) {
          errors.push({
            code: 'E011',
            message: `E011: skill "${group}.${skillName}" is enabled but is not declared in the skills-corpus`
          });
        }
      }
    }
  }
}

// E012: federation.mode="client" with any local-* adapter raises a warning.
if (federation.mode === 'client') {
  const localAdapters = Object.entries(adapters).filter(([, v]) => typeof v === 'string' && v.startsWith('local-')).map(([k]) => k);
  if (localAdapters.length > 0) {
    errors.push({
      code: 'E012',
      message: `E012: federation.mode is "client" but adapter(s) [${localAdapters.join(', ')}] use local-* implementation; this is allowed for graceful-degrade testing but is flagged`
    });
  }
}

// E013: observability.metrics_port MUST NOT collide with other known ports.
// Known ports from the manifest: desktop VNC=5901, code-server=8080, management-api=9090.
const RESERVED_PORTS = {
  5901: 'desktop VNC (wayvnc)',
  8080: 'code-server',
  8484: 'local JSS pods',
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

// E015: sovereign_mesh.jss_rust_backend=true requires the jss-rust Nix input pinned in flake.lock.
if (sovereignMesh.jss_rust_backend === true) {
  const flakeLockPath = path.join(path.dirname(manifestPath), 'flake.lock');
  let flakeLockFound = false;
  let jssRustPinned = false;
  if (fs.existsSync(flakeLockPath)) {
    flakeLockFound = true;
    try {
      const lockData = JSON.parse(fs.readFileSync(flakeLockPath, 'utf8'));
      jssRustPinned = !!(lockData.nodes && lockData.nodes['jss-rust']);
    } catch (_) {}
  }
  if (!flakeLockFound || !jssRustPinned) {
    errors.push({
      code: 'E015',
      message: 'E015: sovereign_mesh.jss_rust_backend is true but "jss-rust" input is not pinned in flake.lock'
    });
  }
}

// ─── E035-E038: consultant-tier coherence (ADR-011 / PRD-005) ─────────────────
//
// E035 — every consultants.<name>.enabled=true requires the matching
//        providers.<provider>.enabled=true (so the credential env var is
//        present at boot per E017).
// E036 — any consultants.<name>.enabled=true requires consultants.enabled=true
//        (master gate); avoids accidentally shipping a consultant in the
//        image while the dispatcher is off.
// E037 — consultants.codex requires toolchains.codex; consultants.gemini
//        requires toolchains.gemini_cli; consultants.zai requires
//        providers.zai (already covered by E035) AND the claude-zai wrapper
//        which is part of toolchains.claude.
// E038 — log_dir + intelligence_signal coherence: when intelligence_signal
//        is true, AGENTBOX_INTELLIGENCE_DIR must be set in the env at boot
//        OR a fallback dir must exist on the writable workspace mount.
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
    // zai depends on the claude-zai wrapper (currently bundled with the
    // claude toolchain); other consultants are HTTP-only.
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

  // E038 — intelligence_signal needs a writable target dir
  if (consultants.intelligence_signal === true && consultants.enabled === true) {
    if (!process.env.AGENTBOX_INTELLIGENCE_DIR && !process.env.WORKSPACE) {
      errors.push({
        code: 'E038',
        message: 'E038: consultants.intelligence_signal=true but neither AGENTBOX_INTELLIGENCE_DIR nor WORKSPACE is set; signal files will be silently dropped'
      });
    }
  }
}

// ─── E032-E034 / W034: solid-pod-rs first-class pod server (ADR-010) ──────────
//
// E032 — adapters.pods="local-solid-rs" requires the filesystem backend to
//        have a writable path. Emitted as W021-style exception-missing warning
//        when [security.exceptions.solid-pod-rs] is absent.
// E033 — integrations.solid_pod_rs.enable_dpop_cache=true requires
//        enable_oidc=true (DPoP is OIDC-only).
// W034 — adapters.pods="local-jss" emits a deprecation warning: the Python
//        stub at scripts/solid-pod-server.py is retained for backward
//        compatibility only; new deployments should pick local-solid-rs.
{
  const pods = (manifest.adapters || {}).pods;
  const sp   = (manifest.integrations || {}).solid_pod_rs || {};

  if (pods === 'local-solid-rs') {
    // E032 is handled structurally by the W021 exception-coherence check
    // (isFeatureActive('solid-pod-rs') returns true when pods=local-solid-rs,
    // so the validator will emit W021 if the exception block is missing).
    if (sp.enable_dpop_cache === true && sp.enable_oidc !== true) {
      errors.push({
        code: 'E033',
        message: 'E033: integrations.solid_pod_rs.enable_dpop_cache=true requires enable_oidc=true (DPoP is OIDC-only)'
      });
    }
  }

  if (pods === 'local-jss') {
    warnings.push({
      code: 'W034',
      message: 'W034: adapters.pods="local-jss" — deprecated. The Python scripts/solid-pod-server.py stub does not implement LDP containers, WAC enforcement, PATCH, or full Schnorr NIP-98. Switch to local-solid-rs (first-class Rust server, ADR-010). The stack still boots normally.'
    });
  }
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
    }

    if (relay.bind === '0.0.0.0' && relay.expose !== true) {
      errors.push({
        code: 'E029',
        message: 'E029: sovereign_mesh.relay.bind="0.0.0.0" without expose=true — bound inside container but unreachable from host'
      });
    }

    if (relay.ingress_policy === 'open') {
      warnings.push({
        code: 'W030',
        message: 'W030: sovereign_mesh.relay.ingress_policy="open" — relay will accept writes from any client; prefer "allowlist" or "signed-only"'
      });
    }

    if (relay.allow_nip04 === true) {
      errors.push({
        code: 'E031',
        message: 'E031: sovereign_mesh.relay.allow_nip04=true — NIP-04 legacy DMs leak metadata; prefer NIP-17 sealed gift-wrap (kind 1059)'
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
    const mode = pf.mode || "off";
    if (mode === "off") {
      errors.push({
        code: 'E022',
        message: 'E022: privacy_filter.enabled=true but mode="off" — set mode to "local-gpu" or "local-cpu"'
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

// ─── E020 / W021: security exception coherence ────────────────────────────────
//
// Each [security.exceptions.<name>] key must correspond to an enabled feature
// gate (E020 error when the feature is OFF but an exception block is present).
//
// W021 is the inverse: a feature that has a known exception mapping is enabled
// but no exception block is declared — the hardened baseline may be inadequate.
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

// W021: feature enabled but documented exception block is missing.
// Emitted as an error (non-zero exit) because the hardened baseline may be
// silently broken at runtime without the exception delta applied.
for (const exceptionName of KNOWN_EXCEPTION_FEATURE_GATES) {
  if (isFeatureActive(exceptionName) && !securityExceptions[exceptionName]) {
    errors.push({
      code: 'W021',
      message: `W021: feature corresponding to [security.exceptions.${exceptionName}] is enabled but no exception block is declared — the hardened baseline may be inadequate for this feature`
    });
  }
}

// E016 is handled by AJV schema validation above (additionalProperties: false at every section).
// E017 and E018 are handled in the providers loop above.

// ─── output ───────────────────────────────────────────────────────────────────
// Warnings (W030, W034) are always printed to stderr — they are direction
// signals. They do not affect the exit code. W021 remains in `errors`
// because the baseline is structurally unsafe without the exception.
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
