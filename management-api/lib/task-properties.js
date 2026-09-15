'use strict';

/**
 * lib/task-properties — the ADR-2011 task-property triple, agentbox's half.
 *
 * ADR-2011: the escalation boundary between agent and human derives from three
 * OPERATOR-declared properties of the TASK — verifiability, reversibility,
 * stakes — never from the requesting agent's self-declared `risk_tier`. The
 * party with the strongest incentive to under-tier must not be the only party
 * that tiers.
 *
 * The schema and the `effective_tier()` function are owned by `nostr-bbs-core`
 * (the forum). agentbox owns exactly one thing here: DERIVING a default triple
 * for the requests it publishes, and stamping it on its own kind-31402 events
 * as the three tags the forum reads.
 *
 * The seed is already in the manifest. `authority_class`
 * (`agentbox.toml [skills.authority.classes]`) is operator-declared per action
 * class and encodes reversibility exactly:
 *
 *     zero-tolerance      ⇒ irreversible
 *     recoverable         ⇒ compensable
 *     escalation-required ⇒ irreversible   (unclassified is fail-closed, as in
 *                                           lib/authority.js — the cost of
 *                                           forgetting to classify is a tighter
 *                                           boundary, never a looser one)
 *
 * The other two axes have no prior home, so they get one shaped like the
 * classification table operators already know:
 *
 *     [skills.authority.task_properties]           # estate-wide defaults
 *     verifiability = "partial"
 *     stakes        = "significant"
 *
 *     [skills.authority.task_properties.classes]   # per-action-class overrides
 *     pod_delete = { verifiability = "opaque", stakes = "critical" }
 *
 * WHO MAY LOOSEN. Exactly one surface: `agentbox.toml`. The operator's manifest
 * SETS verifiability and stakes freely, because the operator is the party the
 * escalation boundary belongs to. EVERY OTHER SURFACE IS TIGHTENING-ONLY:
 *
 *   - a request-supplied triple (an agent calling `governance_request_action`
 *     with `task_properties`) — the same rule the forum applies to
 *     `ActionRequest` against `PanelDefinition`;
 *   - a SKILL.md `task_properties` block — a SKILL.md ships with the skill, so
 *     treating it as an operator surface would let shipped content declare
 *     itself inspectable and bounded on an action the operator declared opaque
 *     and critical;
 *   - a SKILL.md `authority_class` — resolved against the manifest class on the
 *     tightening lattice in lib/authority.js `classifyAction`, so it can raise
 *     `recoverable` to `zero-tolerance` but never the reverse. A refused
 *     loosening is logged and journalled, never silent.
 *
 * So "zero-tolerance ⇒ irreversible" is an invariant, not a default: no surface
 * below the operator's manifest can turn that seed into `compensable`
 * (EXP-AC-003 auditor counter-example, commit 887679ff3).
 *
 * Pure and total: no I/O, no clock, every input tolerated.
 *
 * @see docs/adr/ADR-2087-task-properties-receipts-and-manual-continuation.md
 * @see ADR-2011 (VisionFlow canon), PRD-augmentation-conditions FR3.4
 * @see lib/authority.js       (the authority_class axis this seeds from)
 * @see mcp/servers/governance-bridge.js (the 31402 producer that stamps the tags)
 */

/** The three axes, each LOOSEST-FIRST. Index in the array is the tightness rank. */
const VERIFIABILITY = Object.freeze(['inspectable', 'partial', 'opaque']);
const REVERSIBILITY = Object.freeze(['reversible', 'compensable', 'irreversible']);
const STAKES = Object.freeze(['bounded', 'significant', 'critical']);

const AXES = Object.freeze({ verifiability: VERIFIABILITY, reversibility: REVERSIBILITY, stakes: STAKES });

/** Tag names on kind-31400 / kind-31402 events (the forum's wire contract). */
const TAG_NAMES = Object.freeze({
  verifiability: 'tp-verifiability',
  reversibility: 'tp-reversibility',
  stakes: 'tp-stakes',
});

/** ADR-2011 §4: defaults for the two axes `authority_class` does not encode. */
const DEFAULT_VERIFIABILITY = 'partial';
const DEFAULT_STAKES = 'significant';

/** Tightness rank of a value on an axis; -1 when the value is not on that axis. */
function rank(axis, value) {
  const values = AXES[axis];
  if (!values) return -1;
  return values.indexOf(value);
}

function isValid(axis, value) {
  return rank(axis, value) >= 0;
}

/** True only for a COMPLETE, valid triple. A partial triple is not a triple. */
function isTaskProperties(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && isValid('verifiability', value.verifiability)
    && isValid('reversibility', value.reversibility)
    && isValid('stakes', value.stakes);
}

/**
 * The reversibility an `authority_class` implies. Anything that is not the
 * explicit `recoverable` class — including an unclassified action — is
 * irreversible, mirroring lib/authority.js's escalation-by-default posture.
 *
 * @param {string} authorityClass - 'recoverable' | 'zero-tolerance' | 'escalation-required'
 * @returns {'compensable'|'irreversible'}
 */
function reversibilityFor(authorityClass) {
  return authorityClass === 'recoverable' ? 'compensable' : 'irreversible';
}

/**
 * Normalise `[skills.authority.task_properties]` into `{ defaults, classes }`.
 * Malformed values are dropped (the schema's enum already rejects them at
 * validate time, so they never reach a live manifest); the defaults are never
 * absent, so `derive` is total.
 *
 * @param {object} manifest - parsed agentbox.toml
 * @returns {{ defaults: {verifiability: string, stakes: string},
 *             classes: Record<string, {verifiability?: string, stakes?: string}> }}
 */
function loadTaskPropertyTable(manifest) {
  const raw = (manifest && manifest.skills && manifest.skills.authority
    && manifest.skills.authority.task_properties) || {};
  const defaults = {
    verifiability: isValid('verifiability', raw.verifiability) ? raw.verifiability : DEFAULT_VERIFIABILITY,
    stakes: isValid('stakes', raw.stakes) ? raw.stakes : DEFAULT_STAKES,
  };
  const classes = {};
  const rawClasses = (raw.classes && typeof raw.classes === 'object' && !Array.isArray(raw.classes))
    ? raw.classes : {};
  for (const [name, entry] of Object.entries(rawClasses)) {
    const cleaned = {};
    if (entry && typeof entry === 'object') {
      if (isValid('verifiability', entry.verifiability)) cleaned.verifiability = entry.verifiability;
      if (isValid('stakes', entry.stakes)) cleaned.stakes = entry.stakes;
    }
    classes[name] = cleaned;
  }
  return { defaults, classes };
}

/**
 * Merge two triples on the tightening lattice: per axis, the TIGHTER value
 * wins. Commutative, associative and idempotent, so the order in which operator
 * and agent declarations arrive cannot change the outcome. Invalid or missing
 * values on `other` are ignored rather than fatal.
 *
 * @param {object} base  - a complete, valid triple
 * @param {object} other - any partial/invalid object
 * @returns {{verifiability: string, reversibility: string, stakes: string}}
 */
function merge(base, other) {
  const out = { ...base };
  if (!other || typeof other !== 'object' || Array.isArray(other)) return out;
  for (const axis of Object.keys(AXES)) {
    const candidate = other[axis];
    if (!isValid(axis, candidate)) continue;
    if (rank(axis, candidate) > rank(axis, out[axis])) out[axis] = candidate;
  }
  return out;
}

/**
 * Apply a TRUE OPERATOR override — a `[skills.authority.task_properties.classes]`
 * entry in agentbox.toml: verifiability and stakes are SET, reversibility may
 * only tighten.
 *
 * NOT for SKILL.md frontmatter. A SKILL.md is shipped content, not the
 * operator's manifest; `derive` puts frontmatter through `merge` so it can only
 * tighten every axis (EXP-AC-003). Retained for manifest-shaped callers and for
 * the `derive` internals that read a class entry directly.
 */
function applyOperatorOverride(base, override) {
  const out = { ...base };
  if (!override || typeof override !== 'object' || Array.isArray(override)) return out;
  if (isValid('verifiability', override.verifiability)) out.verifiability = override.verifiability;
  if (isValid('stakes', override.stakes)) out.stakes = override.stakes;
  if (isValid('reversibility', override.reversibility)
      && rank('reversibility', override.reversibility) > rank('reversibility', out.reversibility)) {
    out.reversibility = override.reversibility;
  }
  return out;
}

/**
 * Derive the task-property triple for one action class.
 *
 * @param {string} actionClass - the action-class key (same key as [skills.authority.classes])
 * @param {object} [opts]
 * @param {object} [opts.manifest]        - parsed agentbox.toml
 * @param {object} [opts.table]           - a pre-loaded loadTaskPropertyTable() result
 * @param {string} [opts.authorityClass]  - a pre-resolved authority class (skips classification)
 * @param {object} [opts.frontmatter]     - SKILL.md frontmatter (authority_class / task_properties) — TIGHTENING ONLY
 * @param {object} [opts.requested]       - an agent-supplied triple — TIGHTENING ONLY
 * @param {object} [opts.logger]          - structured logger for a refused frontmatter loosening
 * @param {Function} [opts.onLoosening]   - reporter for a refused frontmatter authority_class loosening
 * @returns {{verifiability: string, reversibility: string, stakes: string}}
 */
function derive(actionClass, opts = {}) {
  const table = opts.table || loadTaskPropertyTable(opts.manifest);
  const frontmatter = (opts.frontmatter && typeof opts.frontmatter === 'object') ? opts.frontmatter : {};

  // Reversibility seed: an explicitly supplied class, else classifyAction — which
  // resolves the manifest table against the frontmatter ON THE TIGHTENING
  // LATTICE, so a frontmatter `authority_class: recoverable` on a zero-tolerance
  // action cannot reach `reversibilityFor` as `recoverable` (EXP-AC-003).
  let authorityClass = opts.authorityClass;
  if (!authorityClass) {
    const { classifyAction, loadClassificationTable } = require('./authority');
    authorityClass = classifyAction(actionClass, {
      table: loadClassificationTable(opts.manifest),
      frontmatter,
      logger: opts.logger,
      onLoosening: opts.onLoosening,
    });
  }

  const classEntry = table.classes[actionClass] || {};
  let props = {
    verifiability: classEntry.verifiability || table.defaults.verifiability,
    reversibility: reversibilityFor(authorityClass),
    stakes: classEntry.stakes || table.defaults.stakes,
  };

  // A SKILL.md ships WITH THE SKILL — it is not the operator's agentbox.toml, so
  // it goes through the same tightening lattice as an agent-supplied request
  // triple rather than the operator SET path (EXP-AC-003 counter-example).
  props = merge(props, frontmatter.task_properties);
  // An agent's own declaration may only tighten what the operator declared.
  props = merge(props, opts.requested);
  return props;
}

/**
 * The three tags to stamp on a kind-31402 (or 31400). ALWAYS all three — a
 * missing tag would be read by the forum as "legacy, fold to the panel default",
 * which is exactly the silent-loosening this ADR exists to remove.
 *
 * @param {object} props - a complete triple
 * @returns {string[][]}
 */
function toTags(props) {
  if (!isTaskProperties(props)) throw new TypeError('toTags requires a complete task-property triple');
  return [
    [TAG_NAMES.verifiability, props.verifiability],
    [TAG_NAMES.reversibility, props.reversibility],
    [TAG_NAMES.stakes, props.stakes],
  ];
}

/**
 * Read a triple back off an event's tags. Returns null for a legacy event with
 * no triple, or one carrying only part of one — absence renders as absence, and
 * a partial triple is never completed with a guess.
 *
 * @param {string[][]} tags
 * @returns {object|null}
 */
function fromTags(tags) {
  if (!Array.isArray(tags)) return null;
  const read = (name) => {
    const found = tags.find((t) => Array.isArray(t) && t[0] === name);
    return found ? found[1] : undefined;
  };
  const props = {
    verifiability: read(TAG_NAMES.verifiability),
    reversibility: read(TAG_NAMES.reversibility),
    stakes: read(TAG_NAMES.stakes),
  };
  return isTaskProperties(props) ? props : null;
}

module.exports = {
  VERIFIABILITY,
  REVERSIBILITY,
  STAKES,
  AXES,
  TAG_NAMES,
  DEFAULT_VERIFIABILITY,
  DEFAULT_STAKES,
  rank,
  isValid,
  isTaskProperties,
  reversibilityFor,
  loadTaskPropertyTable,
  merge,
  applyOperatorOverride,
  derive,
  toTags,
  fromTags,
};
