#!/usr/bin/env node
/**
 * agentbox config validate
 * Validates agentbox.toml against the JSON Schema and 18 semantic rules (E001-E018).
 * Exit 0 = clean. Non-zero = errors. Errors on stderr, one per line: "E### message"
 */

'use strict';

const fs = require('fs');
const path = require('path');
const TOML = require('@iarna/toml');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

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

// ─── semantic rules E001-E016 ─────────────────────────────────────────────────
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

// E016 is handled by AJV schema validation above (additionalProperties: false at every section).
// E017 and E018 are handled in the providers loop above.

// ─── output ───────────────────────────────────────────────────────────────────
if (errors.length === 0) {
  process.stdout.write(`agentbox manifest valid: ${manifestPath}\n`);
  process.exit(0);
} else {
  for (const { code, message } of errors) {
    emit(code, message);
  }
  process.exit(1);
}
