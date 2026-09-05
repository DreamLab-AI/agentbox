'use strict';
// ontology-authoring-authority.js — the NAMED, ENFORCED authority gate that
// separates LOCAL AUTHORING from SHARED-ONTOLOGY PROMOTION (ADR-2022).
//
// The defect this closes (estate review 2026-09-04): the ontology bridge
// dispatched `AGENTBOX_ONTOLOGY_LOCAL=1` (FORCE_LOCAL) BEFORE the remote axiom
// descriptor, so a probe edited a Markdown corpus with no Whelk validation, no
// human gate and no record — while the manifest's `direct_axiom_load = false`
// was still nominally in force. A policy table only constrains callers that
// actually invoke the gate; nothing invoked one.
//
// The rule this module enforces:
//
//   * Writing to the LOCAL AUTHORED CORPUS is an authoring act. It is allowed
//     only under an explicit, named authority, and it is NEVER the same thing
//     as contributing to the shared ontology.
//   * Reaching the SHARED ONTOLOGY is a promotion. It is allowed only in
//     `governed-proposal` mode, and only through the proposal/PR route.
//   * Everything else is DENIED — loudly, with a typed error naming the exact
//     authority that was missing. Never a silent no-op, never a silent write.
//
// Pure + dependency-injected (`env`, `manifest`, `fs`-backed corpus writer are
// all parameters), so it is exercisable with a temp corpus and no live network.
//
// @see docs/adr/ADR-2022-governed-ontology-writes.md
// @see docs/GOVERNANCE-capabilities.md (governed shared-ontology promotion)

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { ensureFrontmatter } = require('./vault-frontmatter');

// ── vocabulary ───────────────────────────────────────────────────────────────

/**
 * The four authority modes. Each names WHY a write is being attempted; the
 * mode alone never authorises anything — it selects which authorities must be
 * present.
 */
const AUTHORING_MODES = Object.freeze({
  /** `AGENTBOX_ONTOLOGY_LOCAL=1` forced the local backend. Local corpus only. */
  FORCED_LOCAL: 'forced-local',
  /** The remote store answered with a network-family error and the local
   *  backend took over. An OUTAGE IS NOT AN AUTHORITY: same opt-in required. */
  REMOTE_DISABLED: 'remote-disabled',
  /** Admin/bootstrap bulk load. Zero-tolerance: manifest flag + explicit
   *  bootstrap env + a recorded authorisation reference. */
  BOOTSTRAP: 'bootstrap',
  /** The only mode that may target the shared ontology, and only via the
   *  proposal → Whelk → PR → human review route. Never a local file write. */
  GOVERNED_PROPOSAL: 'governed-proposal',
});

/** What the write is aimed at. */
const AUTHORING_TARGETS = Object.freeze({
  LOCAL_AUTHORED_CORPUS: 'local-authored-corpus',
  SHARED_ONTOLOGY: 'shared-ontology',
});

/** What kind of write is being attempted. */
const AUTHORING_OPERATIONS = Object.freeze({
  /** Edit a page of the authored corpus (relation/parent add). */
  LOCAL_AUTHORING_WRITE: 'local-authoring-write',
  /** The ungoverned axiom backdoor — `POST /api/ontology/load` and its local
   *  equivalent. Gated by `skills.ontology.direct_axiom_load`. */
  DIRECT_AXIOM_LOAD: 'direct-axiom-load',
  /** A governed contribution: proposal body for Whelk + PR. */
  PROPOSAL: 'proposal',
});

/**
 * The correlation chain a local authoring act must remain traceable through.
 * The gate mints the id at `validation` (the first stage); every later stage
 * carries the same id so validation → proposal → approval → merge → served
 * corpus is one linked record rather than five unrelated events.
 */
const AUTHORING_CHAIN_STAGES = Object.freeze([
  'validation', 'proposal', 'approval', 'merge', 'served-corpus',
]);

/** Environment variables that can carry authority. Named, never inferred. */
const ENV_KEYS = Object.freeze({
  FORCE_LOCAL: 'AGENTBOX_ONTOLOGY_LOCAL',
  LOCAL_AUTHORING: 'ONTOLOGY_LOCAL_AUTHORING',
  BOOTSTRAP: 'AGENTBOX_ONTOLOGY_BOOTSTRAP',
  BOOTSTRAP_AUTHORISATION: 'AGENTBOX_ONTOLOGY_BOOTSTRAP_AUTHORISATION',
});

/** Manifest keys that can carry authority (`agentbox.toml`, `[skills.ontology]`). */
const MANIFEST_KEYS = Object.freeze({
  LOCAL_AUTHORING: 'skills.ontology.local_authoring',
  DIRECT_AXIOM_LOAD: 'skills.ontology.direct_axiom_load',
});

/** Frontmatter keys stamped onto every authored artefact this gate admits. */
const CORRELATION_FRONTMATTER_KEYS = Object.freeze({
  ID: 'ontology-authoring-correlation',
  MODE: 'ontology-authoring-mode',
  STAGE: 'ontology-authoring-stage',
});

// ── typed denial ─────────────────────────────────────────────────────────────

/**
 * A denial is an ERROR, not a return value: a caller that forgets to check a
 * boolean must not end up writing anyway.
 */
class OntologyAuthorityError extends Error {
  constructor({ code, message, mode, target, operation, missing_authority }) {
    super(message);
    this.name = 'OntologyAuthorityError';
    this.code = code;
    this.mode = mode || null;
    this.target = target || null;
    this.operation = operation || null;
    /** @type {string[]} the exact authorities that were absent */
    this.missing_authority = missing_authority || [];
    this.authorised = false;
  }

  /** Wire shape for an MCP tool result — explicit, never an empty success. */
  toResult() {
    return {
      error: this.code,
      message: this.message,
      mode: this.mode,
      target: this.target,
      operation: this.operation,
      missing_authority: this.missing_authority,
      authorised: false,
      written: false,
    };
  }
}

const DENIAL_CODES = Object.freeze({
  UNKNOWN_MODE: 'ontology_authoring_unknown_mode',
  LOCAL_AUTHORING_NOT_AUTHORISED: 'ontology_local_authoring_not_authorised',
  SHARED_STORE_FORBIDDEN: 'ontology_shared_store_forbidden_in_local_mode',
  DIRECT_AXIOM_LOAD_DISABLED: 'ontology_direct_axiom_load_disabled',
  BOOTSTRAP_NOT_AUTHORISED: 'ontology_bootstrap_not_authorised',
  GOVERNED_ROUTE_REQUIRED: 'ontology_governed_route_required',
});

// ── inputs ───────────────────────────────────────────────────────────────────

function truthy(v) {
  return /^(1|true|yes|on)$/i.test(String(v == null ? '' : v).trim());
}

/**
 * Read the ontology policy out of a manifest object. Accepts either the nested
 * `{ skills: { ontology: {…} } }` shape or a flat `{ local_authoring,
 * direct_axiom_load }` view, so callers may pass a parsed `agentbox.toml` or a
 * hand-built policy in tests.
 *
 * DENY BY DEFAULT: an absent key is `false`, never "unset therefore allowed".
 */
function readOntologyPolicy(manifest) {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  const nested = (m.skills && m.skills.ontology) || {};
  const pick = (k) => (Object.prototype.hasOwnProperty.call(nested, k) ? nested[k] : m[k]);
  return {
    local_authoring: pick('local_authoring') === true || truthy(pick('local_authoring')),
    direct_axiom_load: pick('direct_axiom_load') === true || truthy(pick('direct_axiom_load')),
  };
}

/**
 * Minimal `[skills.ontology]` reader for `agentbox.toml`. Deliberately not a
 * TOML library: the gate must load in any agentbox context with core modules
 * only, and it needs exactly two booleans out of one named table. Anything it
 * cannot read is absent, and absent is denied.
 *
 * @param {string} tomlPath
 * @returns {{local_authoring:boolean, direct_axiom_load:boolean, source:string}}
 */
function readManifestFile(tomlPath) {
  const out = { local_authoring: false, direct_axiom_load: false, source: tomlPath };
  let text;
  try {
    text = fs.readFileSync(tomlPath, 'utf8');
  } catch {
    return { ...out, source: null };
  }
  // Isolate the [skills.ontology] table (up to the next table header) so a key
  // of the same name under another table can never leak authority in.
  // Lazy to the next table header, or to true end-of-input (`$` under /m would
  // otherwise stop at the first line break).
  const m = /^\[skills\.ontology\][^\n]*\n([\s\S]*?)(?=\n\[|$(?![\s\S]))/m.exec(text);
  if (!m) return out;
  const body = m[1];
  for (const key of ['local_authoring', 'direct_axiom_load']) {
    const kv = new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\s*(?:#.*)?$`, 'm').exec(body);
    if (kv) out[key] = kv[1] === 'true';
  }
  return out;
}

/** Locate `agentbox.toml` (env override, then walk up from this file). */
function findManifestPath(env = process.env) {
  if (env.AGENTBOX_MANIFEST && fs.existsSync(env.AGENTBOX_MANIFEST)) return env.AGENTBOX_MANIFEST;
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'agentbox.toml');
    if (fs.existsSync(candidate)) return candidate;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** The manifest policy for the running process (cached; refresh with force). */
let _manifestCache = null;
function loadManifestPolicy(env = process.env, force = false) {
  if (_manifestCache && !force) return _manifestCache;
  const p = findManifestPath(env);
  _manifestCache = p
    ? readManifestFile(p)
    : { local_authoring: false, direct_axiom_load: false, source: null };
  return _manifestCache;
}

// ── correlation ──────────────────────────────────────────────────────────────

/**
 * Mint a correlation id for one authoring act. Random 96-bit suffix from the
 * platform CSPRNG (`node:crypto`) — no bespoke randomness, no bespoke hashing.
 */
function mintCorrelationId(clock = () => Date.now()) {
  const ts = new Date(clock()).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `ont-auth-${ts}-${crypto.randomBytes(6).toString('hex')}`;
}

// ── the gate ─────────────────────────────────────────────────────────────────

/**
 * THE authority gate. Every local-authoring caller passes through here; a
 * caller that bypasses it is the defect ADR-2022 exists to close.
 *
 * @param {object}  opts
 * @param {string}  opts.mode        one of AUTHORING_MODES
 * @param {object} [opts.manifest]   parsed manifest / policy view; omitted →
 *                                   read from agentbox.toml (deny by default)
 * @param {object} [opts.env]        environment (default process.env)
 * @param {string} [opts.target]     AUTHORING_TARGETS (default local corpus)
 * @param {string} [opts.operation]  AUTHORING_OPERATIONS (default local write)
 * @param {string} [opts.tool]       originating MCP tool name, for the record
 * @param {string} [opts.correlation_id] reuse an id from an earlier chain stage
 * @param {function} [opts.clock]
 * @returns {object} the grant
 * @throws {OntologyAuthorityError} naming the missing authority
 */
function assertAuthoringAuthority(opts = {}) {
  const env = opts.env || process.env;
  const mode = opts.mode;
  const target = opts.target || AUTHORING_TARGETS.LOCAL_AUTHORED_CORPUS;
  const operation = opts.operation || AUTHORING_OPERATIONS.LOCAL_AUTHORING_WRITE;
  const policy = opts.manifest !== undefined
    ? readOntologyPolicy(opts.manifest)
    : readOntologyPolicy(loadManifestPolicy(env));
  const deny = (code, message, missing) => {
    throw new OntologyAuthorityError({
      code, message, mode, target, operation, missing_authority: missing || [],
    });
  };

  if (!Object.values(AUTHORING_MODES).includes(mode)) {
    // Deny by default: an unrecognised mode is not a permissive one.
    deny(DENIAL_CODES.UNKNOWN_MODE,
      `Unknown ontology authoring mode '${String(mode)}'. Authorised modes: ${Object.values(AUTHORING_MODES).join(', ')}.`,
      ['mode']);
  }

  // --- shared ontology: governed-proposal ONLY ------------------------------
  if (target === AUTHORING_TARGETS.SHARED_ONTOLOGY && mode !== AUTHORING_MODES.GOVERNED_PROPOSAL) {
    deny(DENIAL_CODES.SHARED_STORE_FORBIDDEN,
      `Mode '${mode}' may write only the local authored corpus. The shared ontology is reachable ` +
      `solely through '${AUTHORING_MODES.GOVERNED_PROPOSAL}' (ontology_propose → Whelk → PR → human review).`,
      [`mode:${AUTHORING_MODES.GOVERNED_PROPOSAL}`]);
  }

  // --- direct axiom load: blocked everywhere except governed-proposal -------
  if (operation === AUTHORING_OPERATIONS.DIRECT_AXIOM_LOAD
    && mode !== AUTHORING_MODES.GOVERNED_PROPOSAL
    && policy.direct_axiom_load !== true) {
    deny(DENIAL_CODES.DIRECT_AXIOM_LOAD_DISABLED,
      `Direct axiom load bypasses the Whelk-consistency + human-approval + PR governance path and ` +
      `is disabled (${MANIFEST_KEYS.DIRECT_AXIOM_LOAD} = false). Use ontology_propose. This block ` +
      `applies in mode '${mode}' exactly as it does remotely — a local backend is not an exemption.`,
      [`manifest:${MANIFEST_KEYS.DIRECT_AXIOM_LOAD}`]);
  }

  const authority = [];

  switch (mode) {
    case AUTHORING_MODES.FORCED_LOCAL: {
      // FORCE_LOCAL selects a BACKEND. It is not, and never was, an authority
      // to author. Require it AND an explicit opt-in AND a manifest key.
      const missing = [];
      if (!truthy(env[ENV_KEYS.FORCE_LOCAL])) missing.push(`env:${ENV_KEYS.FORCE_LOCAL}`);
      if (!truthy(env[ENV_KEYS.LOCAL_AUTHORING])) missing.push(`env:${ENV_KEYS.LOCAL_AUTHORING}`);
      if (policy.local_authoring !== true) missing.push(`manifest:${MANIFEST_KEYS.LOCAL_AUTHORING}`);
      if (missing.length) {
        deny(DENIAL_CODES.LOCAL_AUTHORING_NOT_AUTHORISED,
          `Local ontology authoring is not authorised in mode '${mode}'. ` +
          `${ENV_KEYS.FORCE_LOCAL} selects the local backend for READS; authoring additionally requires ` +
          `${ENV_KEYS.LOCAL_AUTHORING}=1 and ${MANIFEST_KEYS.LOCAL_AUTHORING} = true. Missing: ${missing.join(', ')}.`,
          missing);
      }
      authority.push(`env:${ENV_KEYS.FORCE_LOCAL}`, `env:${ENV_KEYS.LOCAL_AUTHORING}`, `manifest:${MANIFEST_KEYS.LOCAL_AUTHORING}`);
      break;
    }

    case AUTHORING_MODES.REMOTE_DISABLED: {
      // A network outage is not an authority either. Same opt-in, minus the
      // FORCE_LOCAL selector (the backend was chosen by the failure, not by us).
      const missing = [];
      if (!truthy(env[ENV_KEYS.LOCAL_AUTHORING])) missing.push(`env:${ENV_KEYS.LOCAL_AUTHORING}`);
      if (policy.local_authoring !== true) missing.push(`manifest:${MANIFEST_KEYS.LOCAL_AUTHORING}`);
      if (missing.length) {
        deny(DENIAL_CODES.LOCAL_AUTHORING_NOT_AUTHORISED,
          `The shared ontology is unreachable, which withdraws the governed write path — it does not ` +
          `grant a local one. Authoring in mode '${mode}' requires ${ENV_KEYS.LOCAL_AUTHORING}=1 and ` +
          `${MANIFEST_KEYS.LOCAL_AUTHORING} = true. Missing: ${missing.join(', ')}.`,
          missing);
      }
      authority.push(`env:${ENV_KEYS.LOCAL_AUTHORING}`, `manifest:${MANIFEST_KEYS.LOCAL_AUTHORING}`);
      break;
    }

    case AUTHORING_MODES.BOOTSTRAP: {
      // Zero-tolerance class: deliberately slow and auditable. The
      // authorisation reference is RECORDED here, not verified here —
      // signature verification is the management-api authority consumer's job.
      const missing = [];
      if (!truthy(env[ENV_KEYS.BOOTSTRAP])) missing.push(`env:${ENV_KEYS.BOOTSTRAP}`);
      if (!String(env[ENV_KEYS.BOOTSTRAP_AUTHORISATION] || '').trim()) {
        missing.push(`env:${ENV_KEYS.BOOTSTRAP_AUTHORISATION}`);
      }
      if (policy.direct_axiom_load !== true) missing.push(`manifest:${MANIFEST_KEYS.DIRECT_AXIOM_LOAD}`);
      if (missing.length) {
        deny(DENIAL_CODES.BOOTSTRAP_NOT_AUTHORISED,
          `Bootstrap ontology load is a zero-tolerance action: it requires ${ENV_KEYS.BOOTSTRAP}=1, a ` +
          `recorded authorisation reference in ${ENV_KEYS.BOOTSTRAP_AUTHORISATION}, and ` +
          `${MANIFEST_KEYS.DIRECT_AXIOM_LOAD} = true. Missing: ${missing.join(', ')}.`,
          missing);
      }
      authority.push(`env:${ENV_KEYS.BOOTSTRAP}`, `env:${ENV_KEYS.BOOTSTRAP_AUTHORISATION}`, `manifest:${MANIFEST_KEYS.DIRECT_AXIOM_LOAD}`);
      break;
    }

    case AUTHORING_MODES.GOVERNED_PROPOSAL: {
      // The only promotion route. It never writes a local file: the artefact
      // of this mode is a proposal that Whelk checks and a human merges.
      if (operation === AUTHORING_OPERATIONS.LOCAL_AUTHORING_WRITE) {
        deny(DENIAL_CODES.GOVERNED_ROUTE_REQUIRED,
          `Mode '${mode}' produces a proposal, not a direct corpus edit. Use operation ` +
          `'${AUTHORING_OPERATIONS.PROPOSAL}' (or '${AUTHORING_OPERATIONS.DIRECT_AXIOM_LOAD}', which is ` +
          `converted into one).`,
          [`operation:${AUTHORING_OPERATIONS.PROPOSAL}`]);
      }
      authority.push('route:proposal-pr');
      break;
    }

    /* c8 ignore next */
    default:
      deny(DENIAL_CODES.UNKNOWN_MODE, `Unhandled mode '${mode}'.`, ['mode']);
  }

  const governed = mode === AUTHORING_MODES.GOVERNED_PROPOSAL;
  return Object.freeze({
    authorised: true,
    mode,
    target: governed ? AUTHORING_TARGETS.SHARED_ONTOLOGY : AUTHORING_TARGETS.LOCAL_AUTHORED_CORPUS,
    operation,
    // The caller MUST honour this: governed proposals never touch a file here.
    local_write_permitted: !governed,
    route: governed ? 'proposal-pr' : 'local-authored-corpus',
    // Local authoring is authoring, not governance. Say so in the result so an
    // agent or human can recognise the authority change before acting on it.
    governed,
    converted_from: governed && operation === AUTHORING_OPERATIONS.DIRECT_AXIOM_LOAD
      ? AUTHORING_OPERATIONS.DIRECT_AXIOM_LOAD : null,
    correlation_id: opts.correlation_id || mintCorrelationId(opts.clock),
    chain_stages: AUTHORING_CHAIN_STAGES,
    stage: AUTHORING_CHAIN_STAGES[0],
    authority,
    tool: opts.tool || null,
    manifest_policy: policy,
    bootstrap_authorisation: mode === AUTHORING_MODES.BOOTSTRAP
      ? String(env[ENV_KEYS.BOOTSTRAP_AUTHORISATION] || '').trim() : null,
  });
}

// ── correlation stamping ─────────────────────────────────────────────────────

/**
 * Stamp the correlation id into the authored artefact's frontmatter so the
 * chain validation → proposal → approval → merge → served corpus is traceable
 * from the file itself, not just from a log line.
 *
 * Uses the vault frontmatter writer, so the page stays in V2 format
 * (VAULT-corpus-format §V5 / ADR-2028 Invariant 1).
 *
 * @returns {{file:string, correlation_id:string, stamped:boolean}}
 */
function recordAuthoringCorrelation({ file, grant, fsImpl = fs }) {
  if (!file || !grant || !grant.correlation_id) {
    return { file: file || null, correlation_id: (grant && grant.correlation_id) || null, stamped: false };
  }
  let text;
  try {
    text = fsImpl.readFileSync(file, 'utf8');
  } catch {
    return { file, correlation_id: grant.correlation_id, stamped: false };
  }
  const next = ensureFrontmatter(text, {
    [CORRELATION_FRONTMATTER_KEYS.ID]: grant.correlation_id,
    [CORRELATION_FRONTMATTER_KEYS.MODE]: grant.mode,
    [CORRELATION_FRONTMATTER_KEYS.STAGE]: grant.stage,
  });
  fsImpl.writeFileSync(file, next.text, 'utf8');
  return { file, correlation_id: grant.correlation_id, stamped: true };
}

// ── the sanctioned entry points to the Markdown-writing helper ──────────────

/**
 * The ONLY sanctioned way to reach the local Markdown-writing helper
 * (`ontology-local.js` → `axiomAdd` / `propose`). Every caller routes through
 * these two functions, and both call the gate first.
 *
 * The gate is injected (`gate`) so a test can spy on it and prove that every
 * entry point really does invoke it.
 *
 * @param {object} opts
 * @param {object} opts.backend    a createLocalOntology() instance
 * @param {function} [opts.gate]   defaults to assertAuthoringAuthority
 * @param {object} [opts.env]
 * @param {object} [opts.manifest]
 * @param {object} [opts.fsImpl]
 */
function createAuthoredCorpusWriter(opts = {}) {
  const backend = opts.backend;
  const gate = opts.gate || assertAuthoringAuthority;
  const env = opts.env || process.env;
  const manifest = opts.manifest;
  const fsImpl = opts.fsImpl || fs;

  function authorise({ mode, operation, target, tool, correlation_id }) {
    return gate({ mode, operation, target, tool, env, manifest, correlation_id });
  }

  /** Apply a granted write, then stamp + return the correlation id. */
  function applyLocal(grant, result) {
    const out = { ...result, authorised: true, mode: grant.mode, governed: grant.governed, route: grant.route, correlation_id: grant.correlation_id, chain_stages: grant.chain_stages, stage: grant.stage };
    if (result && result.changed && (result.path || result.file)) {
      // ontology-local returns `file` as a basename; `corpusDir` is on the
      // backend instance. An absolute value is used as-is.
      const corpusDir = backend && backend.corpusDir;
      const named = result.path || result.file;
      const file = (path.isAbsolute(named) || !corpusDir) ? named : path.join(corpusDir, named);
      const stamp = recordAuthoringCorrelation({ file, grant, fsImpl });
      out.correlation_stamped = stamp.stamped;
    } else {
      out.correlation_stamped = false;
    }
    return out;
  }

  return {
    /**
     * `ontology_axiom_add` against the local corpus. This IS the direct axiom
     * load, so `direct_axiom_load = false` blocks it in every mode except
     * governed-proposal (where it is converted into a proposal instead).
     */
    axiomAdd(args = {}, ctx = {}) {
      const grant = authorise({
        mode: ctx.mode,
        operation: AUTHORING_OPERATIONS.DIRECT_AXIOM_LOAD,
        target: ctx.target,
        tool: 'ontology_axiom_add',
        correlation_id: ctx.correlation_id,
      });
      if (!grant.local_write_permitted) {
        // governed-proposal: hand the caller the governed route, write nothing.
        return {
          authorised: true, written: false, governed: true, route: grant.route,
          mode: grant.mode, converted_from: grant.converted_from,
          correlation_id: grant.correlation_id, chain_stages: grant.chain_stages,
          message: 'Direct axiom load converted to a governed proposal; submit via ontology_propose.',
        };
      }
      return applyLocal(grant, backend.axiomAdd(args));
    },

    /**
     * `ontology_propose` routed at the local corpus. Local propose is a direct,
     * provenance-tagged corpus edit — authoring, NOT governed promotion — so it
     * needs the local-authoring authority and says `governed: false`.
     */
    propose(args = {}, ctx = {}) {
      const grant = authorise({
        mode: ctx.mode,
        operation: ctx.mode === AUTHORING_MODES.GOVERNED_PROPOSAL
          ? AUTHORING_OPERATIONS.PROPOSAL : AUTHORING_OPERATIONS.LOCAL_AUTHORING_WRITE,
        target: ctx.target,
        tool: 'ontology_propose',
        correlation_id: ctx.correlation_id,
      });
      if (!grant.local_write_permitted) {
        return {
          authorised: true, written: false, governed: true, route: grant.route,
          mode: grant.mode, correlation_id: grant.correlation_id,
          chain_stages: grant.chain_stages,
          message: 'Governed proposal: submit to the shared ontology via the propose → Whelk → PR route.',
        };
      }
      return applyLocal(grant, backend.propose(args));
    },
  };
}

/**
 * Resolve the authoring mode for a dispatch. Named rather than inferred at the
 * call site so the four modes stay a closed set.
 * @param {{forceLocal:boolean, remoteFailed:boolean, env:object}} ctx
 */
function resolveAuthoringMode({ forceLocal = false, remoteFailed = false, env = process.env } = {}) {
  if (truthy(env[ENV_KEYS.BOOTSTRAP])) return AUTHORING_MODES.BOOTSTRAP;
  if (forceLocal) return AUTHORING_MODES.FORCED_LOCAL;
  if (remoteFailed) return AUTHORING_MODES.REMOTE_DISABLED;
  return AUTHORING_MODES.GOVERNED_PROPOSAL;
}

module.exports = {
  AUTHORING_MODES,
  AUTHORING_TARGETS,
  AUTHORING_OPERATIONS,
  AUTHORING_CHAIN_STAGES,
  ENV_KEYS,
  MANIFEST_KEYS,
  CORRELATION_FRONTMATTER_KEYS,
  DENIAL_CODES,
  OntologyAuthorityError,
  assertAuthoringAuthority,
  createAuthoredCorpusWriter,
  recordAuthoringCorrelation,
  resolveAuthoringMode,
  readOntologyPolicy,
  readManifestFile,
  loadManifestPolicy,
  mintCorrelationId,
};
