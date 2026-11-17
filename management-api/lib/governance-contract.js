'use strict';

/**
 * lib/governance-contract — agentbox's single reading of the governance wire
 * contract (kinds 31400-31405).
 *
 * The contract is authored by the forum crate `nostr-bbs-core`
 * (governance.rs) and rendered as data in `contracts/governance/v1/`, which is
 * copied here verbatim (see contracts/governance/COPIED-FROM.txt). This module
 * loads that manifest and exports named constants, so no other file in
 * agentbox needs a bare 3140x literal, an enum string list or a rule number.
 *
 * Location-agnostic: this file is also vendored beside mcp/servers/nostr-bridge.js
 * at build time, so the manifest is looked up next to this file first
 * (`governance-contract-v1/`) and then in the source checkout.
 *
 * Fail-closed: if the manifest is missing or malformed the require throws. A
 * producer that cannot read the contract must not guess it.
 */

const fs = require('node:fs');
const path = require('node:path');

const CANDIDATES = [
  path.join(__dirname, 'governance-contract-v1', 'manifest.json'),
  path.join(__dirname, '..', '..', 'contracts', 'governance', 'v1', 'manifest.json'),
];

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function loadManifest() {
  const tried = [];
  for (const file of CANDIDATES) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (err) { tried.push(file); continue; }
    const manifest = JSON.parse(text);
    return { manifest, dir: path.dirname(file) };
  }
  throw new Error(`governance contract manifest not found; looked in: ${tried.join(', ')}`);
}

const { manifest, dir } = loadManifest();
if (manifest.contract !== 'governance' || manifest.version !== 1 || !Array.isArray(manifest.kinds)) {
  throw new Error('governance contract manifest is not governance v1');
}
deepFreeze(manifest);

/** `panel-definition` → `PANEL_DEFINITION`. */
const constName = (name) => name.toUpperCase().replace(/-/g, '_');

/** Named kind constants: `{ PANEL_DEFINITION: 31400, … ACTION_RESPONSE: 31403, … }`. */
const KINDS = Object.freeze(Object.fromEntries(manifest.kinds.map((k) => [constName(k.name), k.kind])));

/** Per-kind descriptors keyed by kind number. */
const BY_KIND = Object.freeze(Object.fromEntries(manifest.kinds.map((k) => [k.kind, k])));

const ENUMS = manifest.enums;
const RULES = manifest.rules;
const TAG_NAMES = manifest.tag_names;
const KIND_MIN = manifest.kind_range.min;
const KIND_MAX = manifest.kind_range.max;

/** Whether `kind` is one of the governance kinds. */
function isGovernanceKind(kind) {
  return Number.isInteger(kind) && kind >= KIND_MIN && kind <= KIND_MAX;
}

/** Read the golden example event for a kind (a parsed JSON object). */
function loadExample(kind) {
  const descriptor = BY_KIND[kind];
  if (!descriptor) throw new RangeError(`no governance kind ${kind}`);
  return JSON.parse(fs.readFileSync(path.join(dir, descriptor.file), 'utf8'));
}

module.exports = {
  manifest,
  KINDS,
  BY_KIND,
  ENUMS,
  RULES,
  TAG_NAMES,
  KIND_MIN,
  KIND_MAX,
  MIN_HUMAN_RATIONALE_CHARS: RULES.min_human_rationale_chars,
  PANEL_DEFINITION: KINDS.PANEL_DEFINITION,
  PANEL_STATE: KINDS.PANEL_STATE,
  ACTION_REQUEST: KINDS.ACTION_REQUEST,
  ACTION_RESPONSE: KINDS.ACTION_RESPONSE,
  PANEL_UPDATE: KINDS.PANEL_UPDATE,
  PANEL_RETIRED: KINDS.PANEL_RETIRED,
  isGovernanceKind,
  loadExample,
};
