'use strict';

/**
 * lib/kg-proposal-extractor — WS6, personal-KG → proposal extractor
 * (PRD-014 Seam D / D2, producer side).
 *
 * Reads personal knowledge-graph entries (supplied by the route from the
 * configured `memory` adapter slot — never a hardcoded backend), scores each
 * for elevation candidacy, and for every high-value candidate produces:
 *
 *   1. a GOVERNED propose descriptor — built with mcp/servers/ontology-propose
 *      `buildProposeRequest`, the ONLY sanctioned route into the shared
 *      ontology (Whelk consistency → human approval → PR). This module does
 *      NOT touch the ungoverned /api/ontology/load backdoor.
 *   2. an agent-action emit payload (action_type LINK) — the visible "beam"
 *      from the personal node to its shared-ontology target, emitted through
 *      the canonical agentEventPublisher by the route.
 *
 * URN discipline (CLAUDE.md):
 *   - the personal proposal node URN is minted through lib/uris.js as
 *     `urn:agentbox:thing:<pubkey>:proposal-<sha256-12>` (B02 — never an ad-hoc
 *     template literal).
 *   - the FOREIGN target URN (the host substrate's identifier) is produced by
 *     lib/bc20-provenance-bridge `toVisionclaw`, the only sanctioned
 *     cross-namespace minter (B05). We never hand-roll a `urn:visionclaw:*`
 *     string here. The proposal node crosses to `urn:visionclaw:kg:…`; the
 *     elevation TARGET crosses to `urn:visionclaw:concept:<domain>:<slug>`.
 *
 * Identity (B4): the proposing agent's `source_urn` is its own `did:nostr`
 * (AGENTBOX_DID / AGENTBOX_URN). When absent the emit still validates with null
 * attribution (Phase-1 optional). The owner pubkey scopes both the agentbox
 * proposal URN and the foreign kg/owner scope.
 *
 * Pure + synchronous: returns descriptors. The route performs the adapter read,
 * the publish, and (optionally) the governed POST.
 *
 * @see mcp/servers/ontology-propose.js (buildProposeRequest — the governed path)
 * @see lib/bc20-provenance-bridge.js (toVisionclaw — the only cross-namespace minter)
 * @see lib/uris.js (mint — the only agentbox URN minter)
 */

const uris = require('./uris');
const bc20 = require('./bc20-provenance-bridge');
const { buildProposeRequest } = require('../../mcp/servers/ontology-propose');
const { AgentActionType } = require('../utils/agent-event-publisher');

class ExtractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExtractError';
  }
}

const DEFAULT_MIN_SCORE = 0.6;

// Stop words ignored when measuring concept salience. Deliberately small and
// honest — this is a deterministic heuristic, not a learned model.
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is',
  'are', 'was', 'were', 'be', 'this', 'that', 'it', 'as', 'at', 'by', 'from',
]);

/**
 * Code-as-harness lesson records (mcp/expel/distil.py) are written to the
 * `code-harness-lessons` namespace as `"<rule> | <json>"` where the JSON is an
 * `ex:DistilledLesson` aggregate (DDD-005). Distil already mints the lesson's
 * own canonical `urn:agentbox:memory:<scope>:lesson-<sha256-12>` (per the
 * CLAUDE.md Code-as-Harness URN allocation). This recogniser maps that record
 * onto the term/definition shape the elevation scorer expects, so experiential
 * learning FEEDS the SAME governed memory→concept elevation pipeline as the
 * personal KG — no separate path, no new MCP server. The distil writer leads
 * the value with the rule text (the semantic-embedding hook), so a plain-text
 * fallback still degrades to a usable term.
 */
function normaliseLesson(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.ontology_type !== 'ex:DistilledLesson' && !value.lesson_urn) return null;
  const rule = value.rule ? String(value.rule).trim() : null;
  if (!rule) return null;
  // The rule IS the elevation candidate term; the evidence claim (when present)
  // backs it as the definition so the scorer can judge substance. We keep the
  // lesson's confidence/scope as metadata for downstream governance display.
  return {
    term: rule,
    definition: (value.evidence_claim ? String(value.evidence_claim).trim() : null) || rule,
    domain: value.domain ? String(value.domain).trim() : 'experiential',
    physicality: 'abstract',
    role: 'lesson',
    lesson_urn: typeof value.lesson_urn === 'string' ? value.lesson_urn : null,
    confidence: typeof value.confidence === 'number' ? value.confidence : null,
  };
}

/**
 * Normalise a raw memory-adapter entry into the fields the extractor needs.
 * The memory adapters return `{ key, value, ... }` where value may be a JSON
 * string, an object, or plain text. We coalesce to a term + definition pair.
 *
 * The distil writer stores lesson values as `"<rule> | <json>"`; we split on
 * the first ` | ` and parse the JSON tail so `ex:DistilledLesson` records are
 * recognised even when the adapter returns the raw stored string.
 */
function normaliseEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const key = entry.key || entry.id || null;
  let value = entry.value;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      // distil format: "<rule text> | <json>" — recover the JSON tail.
      const bar = value.indexOf(' | ');
      if (bar !== -1) {
        try { value = JSON.parse(value.slice(bar + 3)); } catch { /* plain text */ }
      }
    }
  }

  // Code-as-harness experiential lesson → elevation candidate (feeds the same
  // governed pipeline). Detected before the generic shape so the lesson's own
  // canonical URN and confidence survive into the descriptor metadata.
  const lesson = normaliseLesson(value);
  if (lesson) {
    if (!lesson.term) return null;
    return {
      key,
      term: lesson.term,
      definition: lesson.definition,
      domain: lesson.domain,
      physicality: lesson.physicality,
      role: lesson.role,
      source: 'distilled-lesson',
      lesson_urn: lesson.lesson_urn,
      confidence: lesson.confidence,
      raw: value,
    };
  }

  let term = null;
  let definition = null;
  let domain = null;
  let physicality = null;
  let role = null;

  if (value && typeof value === 'object') {
    term = value.preferred_term || value.term || value.title || value.name || key;
    definition = value.definition || value.description || value.summary || value.text || null;
    domain = value.domain || value.namespace || null;
    physicality = value.physicality || null;
    role = value.role || null;
  } else if (typeof value === 'string') {
    term = key;
    definition = value;
  } else {
    term = key;
  }

  if (!term) return null;
  return {
    key,
    term: String(term).trim(),
    definition: definition ? String(definition).trim() : null,
    domain: domain ? String(domain).trim() : null,
    physicality: physicality ? String(physicality).trim() : null,
    role: role ? String(role).trim() : null,
    raw: value,
  };
}

/**
 * Deterministic elevation-candidacy score in [0, 1]. A concept is a good
 * elevation candidate when it is well-formed (named + defined), substantive
 * (carries distinct content words), and not trivially short. This is a
 * transparent heuristic — every term in the formula is inspectable.
 *
 * @returns {{ score:number, reasons:string[] }}
 */
function scoreCandidate(norm) {
  const reasons = [];
  let score = 0;

  if (norm.term && norm.term.length >= 3) { score += 0.25; reasons.push('named'); }
  if (norm.definition && norm.definition.length >= 20) { score += 0.35; reasons.push('defined'); }

  const words = (norm.definition || norm.term || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((w) => w && !STOP.has(w));
  const distinct = new Set(words).size;
  if (distinct >= 5) { score += 0.2; reasons.push('substantive'); }

  if (norm.domain) { score += 0.1; reasons.push('domain-tagged'); }
  if (norm.physicality && norm.role) { score += 0.1; reasons.push('ontology-shaped'); }

  return { score: Math.min(1, score), reasons };
}

/**
 * Build a full proposal descriptor for one normalised, scored KG entry.
 *
 * Returns:
 *   {
 *     candidate,                // the normalised entry + score
 *     proposal_urn,             // urn:agentbox:thing:<pubkey>:proposal-<sha256-12>
 *     target_urn,               // FOREIGN urn:visionclaw:concept:<domain>:<slug> (the elevation target)
 *     propose_request,          // GOVERNED { path, method, body } for /api/ontology-agent/propose
 *     emit,                     // agent-action LINK emit payload
 *   }
 *
 * @param {object} norm    - output of normaliseEntry
 * @param {object} score   - output of scoreCandidate
 * @param {object} opts
 * @param {string} opts.ownerPubkey  - 64-hex BIP-340 pubkey scoping the proposal
 * @param {object} [opts.env]        - env for agent-context defaults
 */
function buildProposalDescriptor(norm, score, opts = {}) {
  const env = opts.env || process.env;
  const ownerPubkey = opts.ownerPubkey
    || env.AGENTBOX_X_ONLY_PUBKEY_HEX
    || env.AGENTBOX_PUBKEY
    || null;
  if (!ownerPubkey || !/^[0-9a-f]{64}$/.test(ownerPubkey)) {
    throw new ExtractError('a 64-hex owner pubkey is required to mint the proposal URN (set AGENTBOX_X_ONLY_PUBKEY_HEX)');
  }

  const domain = norm.domain || env.AGENTBOX_ELEVATION_DOMAIN || 'personal';
  const slug = bc20.slugify(norm.term);

  // 1. Mint the agentbox-side proposal node URN through uris.js (B02). The
  //    payload content-addresses it so the same concept yields the same URN.
  const proposalPayload = { term: norm.term, definition: norm.definition, domain };
  const proposalLocalId = `proposal-${bc20.sha12(JSON.stringify(proposalPayload))}`;
  const proposal_urn = uris.mint({ kind: 'thing', pubkey: ownerPubkey, localId: proposalLocalId });

  // 2. Cross the proposal node to the FOREIGN kg URN (B05) — never hand-rolled.
  const kgCross = bc20.toVisionclaw(proposal_urn);
  const proposal_foreign_urn = kgCross ? kgCross.visionclaw_id : null;

  // 3. The elevation TARGET in the shared ontology is a concept URN. We mint a
  //    local agentbox `memory` URN for the lesson/concept, then cross it to the
  //    domain-scoped concept identifier — the only place a concept URN is born.
  const conceptLocalId = `concept-${slug}`;
  const conceptUrn = uris.mint({ kind: 'memory', localId: conceptLocalId });
  const conceptCross = bc20.toVisionclaw(conceptUrn, { domain, slug });
  const target_urn = conceptCross ? conceptCross.visionclaw_id : null;

  // 4. Build the GOVERNED propose request (create). Ontology fields fall back to
  //    honest defaults; the governance gate (Whelk + human approval) refines.
  const propose_request = buildProposeRequest({
    action: 'create',
    preferred_term: norm.term,
    definition: norm.definition || `Personal-KG concept '${norm.term}' proposed for elevation.`,
    owl_class: _owlClass(norm.term),
    physicality: norm.physicality || 'abstract',
    role: norm.role || 'concept',
    domain,
    alt_terms: [],
  }, env);

  // 5. The visible beam: LINK from the personal node to its shared-ontology
  //    target. source/target ids are seeded from the URNs; the route hashes
  //    them to u32 exactly as the agent-events surface does.
  const emit = {
    source_agent_id: proposal_urn,
    target_node_id: target_urn || proposal_foreign_urn || proposal_urn,
    action_type: AgentActionType.LINK,
    duration_ms: opts.duration_ms || 250,
    metadata: {
      // 'distilled-lesson' when the candidate is a code-as-harness lesson fed
      // into the governed pipeline; 'kg-elevation' for personal-KG entries.
      origin: norm.source === 'distilled-lesson' ? 'distilled-lesson' : 'kg-elevation',
      proposal_urn,
      proposal_foreign_urn,
      term: norm.term,
      domain,
      score: score.score,
      reasons: score.reasons,
      governed_path: propose_request.path,
      // The originating experiential lesson URN (already minted by distil.py
      // through the memory kind), preserving the experiential→governed link.
      ...(norm.lesson_urn ? { source_lesson_urn: norm.lesson_urn } : {}),
      ...(typeof norm.confidence === 'number' ? { lesson_confidence: norm.confidence } : {}),
    },
  };
  if (target_urn) emit.target_urn = target_urn;

  return {
    candidate: { ...norm, score: score.score, reasons: score.reasons },
    proposal_urn,
    proposal_foreign_urn,
    target_urn,
    propose_request,
    emit,
    // Provenance: the experiential lesson this proposal was distilled from
    // (null for personal-KG candidates). Links the code-as-harness 5th identity
    // participant into the governed elevation record.
    source_lesson_urn: norm.lesson_urn || null,
  };
}

function _owlClass(term) {
  // PascalCase the term into an OWL-class slug; honest, deterministic.
  return String(term)
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('') || 'Concept';
}

/**
 * Extract elevation-candidate proposals from a list of raw KG entries.
 *
 * @param {object[]} entries  - raw entries from the memory adapter (search/list)
 * @param {object} [opts]
 * @param {string}  [opts.ownerPubkey]
 * @param {number}  [opts.minScore=DEFAULT_MIN_SCORE]
 * @param {number}  [opts.limit]      - cap on number of proposals returned
 * @param {object}  [opts.env]
 * @returns {{ proposals:object[], scanned:number, accepted:number }}
 */
function extractProposals(entries, opts = {}) {
  if (!Array.isArray(entries)) {
    throw new ExtractError('entries must be an array of KG records');
  }
  const minScore = typeof opts.minScore === 'number' ? opts.minScore : DEFAULT_MIN_SCORE;
  const limit = typeof opts.limit === 'number' ? opts.limit : Infinity;

  const proposals = [];
  for (const entry of entries) {
    const norm = normaliseEntry(entry);
    if (!norm) continue;
    const score = scoreCandidate(norm);
    if (score.score < minScore) continue;
    proposals.push(buildProposalDescriptor(norm, score, opts));
    if (proposals.length >= limit) break;
  }

  return { proposals, scanned: entries.length, accepted: proposals.length };
}

module.exports = {
  ExtractError,
  DEFAULT_MIN_SCORE,
  normaliseEntry,
  normaliseLesson,
  scoreCandidate,
  buildProposalDescriptor,
  extractProposals,
};
