'use strict';

/**
 * junkiejarvis-clarify — the clarify-before-acting gate (ADR-2088).
 *
 * JunkieJarvis ingests issues, suggestions and feedback from the community
 * forum's feature-suggestions thread (scripts/dream-forum-suggestions.mjs) and
 * turns them into dream-cycle handoffs. Acting on an under-specified item wastes
 * an engineering night and, worse, guesses at what the member meant. So before
 * ANY action is taken the item passes a deterministic clarity check; when it
 * fails, JunkieJarvis DMs the member 1–3 concrete questions and parks the item
 * as `awaiting-clarification` instead of triaging it.
 *
 * Everything in this module is PURE. No clock, no network, no key material:
 * `now` is always a parameter, state transitions return new objects, and the
 * NIP-59 envelope itself lives in junkiejarvis-agent.js (`sendGiftWrappedDm`) —
 * the single site in this repo that touches gift-wrap crypto.
 *
 * Invariants:
 *   - Fail-open on malformed input: a junk item is "unclear", never a throw.
 *   - Exactly ONE clarification DM per item, ever (rate limit).
 *   - A pending item expires to `stale` after 7 days and is never revived.
 *   - The check is total and deterministic: same text in, same verdict out.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/** Pending items expire to `stale` after this long with no reply. */
const CLARIFY_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/** Composite specificity floor, on the 0..1 scale of `specificityScore`. */
const MIN_SPECIFICITY = 0.45;

/** Never grill a member with more than this many questions at once. */
const MAX_QUESTIONS = 3;

/**
 * The closed set of clarity-failure codes, in QUESTION PRIORITY order: a member
 * gets at most MAX_QUESTIONS, so the order decides which gaps are worth a DM.
 * Reproduction first (nothing can be actioned without it), then the target,
 * then the surface, and only then the catch-all specificity prompt.
 */
const MISSING_CODES = Object.freeze(['repro', 'target', 'surface', 'specificity']);

/** Statuses a parked item can hold. */
const STATUS_AWAITING = 'awaiting-clarification';
const STATUS_CLARIFIED = 'clarified';
const STATUS_STALE = 'stale';

// ─── Text signals (pure) ────────────────────────────────────────────────────

function textOf(item) {
  if (typeof item === 'string') return '';
  if (!item || typeof item !== 'object') return '';
  return typeof item.content === 'string' ? item.content : '';
}

/**
 * Does this read as a defect report rather than a feature suggestion?
 * Only defect reports are required to carry reproduction steps.
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeBugReport(text) {
  const t = typeof text === 'string' ? text.toLowerCase() : '';
  if (!t) return false;
  return /\b(bug|broken|breaks|crash(?:es|ed|ing)?|error|errors|exception|traceback|stack ?trace|fail(?:s|ed|ing|ure)?|regression|hangs?|freezes?|stuck|times? out|500|404|blank page|not working)\b/.test(t)
    || /\b(does ?n[o']t|doesn't|don't|won't|can'?t|cannot)\s+(work|load|save|open|render|start)\b/.test(t);
}

/**
 * Are there reproduction steps — an explicit "steps" preamble, an enumerated
 * list of at least two items, or a "when I X, Y happens" causal sentence?
 * @param {string} text
 * @returns {boolean}
 */
function hasReproSteps(text) {
  const t = typeof text === 'string' ? text : '';
  if (!t.trim()) return false;
  if (/\bsteps?\b[^.\n]{0,24}:/i.test(t)) return true;
  if (/\bto reproduce\b|\brepro steps\b|\breproduction steps\b/i.test(t)) return true;
  const enumerated = t.match(/(?:^|[\s(])\d+[.)]\s/g);
  if (enumerated && enumerated.length >= 2) return true;
  if (/\b(?:when|after|if)\s+(?:i|you|we|they)\s+\w+/i.test(t)) return true;
  return false;
}

/** Surfaces/platforms a forum member might be on. */
const SURFACE_VOCAB = /\b(android|ios|iphone|ipad|phone|mobile|tablet|desktop|web|website|browser|chrome|chromium|firefox|safari|edge|cli|terminal|tmux|shell|forum|relay|api|amethyst|amber|vr|xr|headset|quest|windows|macos|linux)\b/i;

/**
 * Is a surface/platform named (web, mobile, CLI, the forum, …)?
 * @param {string} text
 * @returns {boolean}
 */
function hasSurface(text) {
  return SURFACE_VOCAB.test(typeof text === 'string' ? text : '');
}

/** UI/system nouns that make a target unambiguous without a link. */
const TARGET_NOUNS = /\b(page|pages|button|field|screen|endpoint|route|form|menu|tab|panel|dialog|modal|editor|upload|download|toggle|thread|calendar|inbox|profile|notification|notifications|search|login|log ?in|sign ?up|avatar|sidebar|header|footer|feed|zone|channel)\b/i;

/**
 * Is there a concrete, unambiguous target — a URL, a path, a quoted or
 * backticked name, a filename, or a named UI/system noun? A message whose only
 * subject is "it"/"this thing" fails.
 * @param {string} text
 * @returns {boolean}
 */
function hasConcreteTarget(text) {
  const t = typeof text === 'string' ? text : '';
  if (!t.trim()) return false;
  if (/https?:\/\/\S+/i.test(t)) return true; // URL
  if (/(?:^|\s)\/[A-Za-z][\w/-]{2,}/.test(t)) return true; // path or route
  if (/`[^`]{2,}`/.test(t)) return true; // backticked span
  if (/"[^"]{2,}"|“[^”]{2,}”|'[^']{3,}'/.test(t)) return true; // quoted name
  if (/\b[\w-]+\.(?:js|mjs|cjs|ts|rs|py|toml|json|md|html|css|sh)\b/i.test(t)) return true; // filename
  if (TARGET_NOUNS.test(t)) return true;
  return false;
}

/**
 * Composite specificity, 0..1. Deterministic and monotone in its two parts:
 * how much was written, and how many concrete anchors it contains.
 *
 * Anchors (max 4 counted): a number, a path/URL, a quoted or backticked name,
 * a named surface, enumerated steps, an expectation contrast.
 *
 * @param {string} text
 * @returns {number} 0..1
 */
function specificityScore(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return 0;

  const words = t.split(/\s+/).filter(Boolean).length;
  const lengthFactor = Math.min(1, words / 40);

  let anchors = 0;
  if (/\d/.test(t)) anchors += 1;
  if (/https?:\/\/\S+/i.test(t) || /(?:^|\s)\/[A-Za-z][\w/-]{2,}/.test(t)) anchors += 1;
  if (/`[^`]{2,}`/.test(t) || /"[^"]{2,}"|“[^”]{2,}”/.test(t)) anchors += 1;
  if (SURFACE_VOCAB.test(t)) anchors += 1;
  if (hasReproSteps(t)) anchors += 1;
  if (/\bexpect(?:ed|ing)?\b[^.\n]{0,60}\b(?:but|got|instead)\b/i.test(t)
    || /\binstead of\b/i.test(t)) anchors += 1;

  const anchorFactor = Math.min(1, anchors / 4);
  const score = 0.4 * lengthFactor + 0.6 * anchorFactor;
  return Math.max(0, Math.min(1, score));
}

// ─── The clarity check (pure) ───────────────────────────────────────────────

/** Fixed question text per missing code. One question, one gap. */
const QUESTION_BY_CODE = Object.freeze({
  repro: 'What are the exact steps to reproduce it, starting from a fresh page or session?',
  target: 'Which exact page, screen or component do you mean — can you name or link it?',
  surface: 'Where does this happen — web, mobile, the CLI, or somewhere else?',
  specificity: 'What did you expect to happen, and what happened instead?',
});

/**
 * Turn a set of missing codes into 1..MAX_QUESTIONS concrete questions, in the
 * fixed MISSING_CODES priority order, deduplicated.
 * @param {string[]} missing
 * @returns {string[]}
 */
function clarityQuestions(missing) {
  if (!Array.isArray(missing)) return [];
  const seen = new Set(missing.filter((c) => typeof c === 'string'));
  const out = [];
  for (const code of MISSING_CODES) {
    if (seen.has(code) && QUESTION_BY_CODE[code]) out.push(QUESTION_BY_CODE[code]);
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out;
}

/**
 * The gate. Deterministic, total, side-effect free.
 *
 * Rules:
 *   - A defect report MUST carry reproduction steps.
 *   - EVERY item must name a surface and an unambiguous target.
 *   - EVERY item must clear MIN_SPECIFICITY.
 *
 * @param {{ content?: string }} item  a forum post (or anything; junk is unclear)
 * @returns {{ clear: boolean, score: number, missing: string[], questions: string[], isBug: boolean }}
 */
function assessClarity(item) {
  const text = textOf(item);
  const isBug = looksLikeBugReport(text);
  const score = specificityScore(text);

  const missing = [];
  if (isBug && !hasReproSteps(text)) missing.push('repro');
  if (!hasSurface(text)) missing.push('surface');
  if (!hasConcreteTarget(text)) missing.push('target');
  if (score < MIN_SPECIFICITY) missing.push('specificity');

  const clear = missing.length === 0;
  return {
    clear,
    score,
    isBug,
    missing,
    questions: clear ? [] : clarityQuestions(missing),
  };
}

/**
 * Compose the DM body. Brisk, no preamble padding, no internals — the same
 * voice as the rest of JunkieJarvis. Empty string for a clear item, so a caller
 * that composes unconditionally still sends nothing.
 *
 * @param {object} item
 * @param {{ clear: boolean, questions: string[] }} assessment
 * @returns {string}
 */
function composeClarificationDm(item, assessment) {
  const questions = assessment && Array.isArray(assessment.questions) ? assessment.questions : [];
  if (!assessment || assessment.clear || questions.length === 0) return '';
  const quoted = textOf(item).replace(/\s+/g, ' ').trim().slice(0, 140);
  const lines = [
    'Thanks for the suggestion — I need a bit more before I queue it.',
    quoted ? `You wrote: "${quoted}${quoted.length >= 140 ? '…' : ''}"` : null,
    '',
    ...questions.slice(0, MAX_QUESTIONS).map((q, i) => `${i + 1}. ${q}`),
    '',
    'Reply to this DM and I\'ll pick it up on the next pass.',
  ].filter((l) => l !== null);
  return lines.join('\n').slice(0, 900);
}

// ─── awaiting-clarification state machine (pure) ────────────────────────────

/** A fresh, empty clarification ledger. */
function emptyClarifyState() {
  return { pending: {} };
}

function normalise(state) {
  const pending = state && state.pending && typeof state.pending === 'object' ? state.pending : {};
  return { pending };
}

/** Shallow-clone the ledger so transitions never mutate their input. */
function clone(state) {
  const { pending } = normalise(state);
  const out = {};
  for (const [k, v] of Object.entries(pending)) out[k] = { ...v, replies: Array.isArray(v.replies) ? [...v.replies] : [] };
  return { pending: out };
}

/**
 * Look up a parked item.
 * @returns {object|null}
 */
function findPending(state, itemId) {
  const { pending } = normalise(state);
  if (typeof itemId !== 'string' || !itemId) return null;
  return Object.prototype.hasOwnProperty.call(pending, itemId) ? pending[itemId] : null;
}

/**
 * The rate limit: exactly one clarification DM per item, forever. An item that
 * has ever been parked — awaiting, clarified or stale — is never asked again.
 * @returns {boolean}
 */
function shouldSendClarification(state, itemId) {
  return findPending(state, itemId) === null;
}

/**
 * Park an item as awaiting-clarification, recording the question set and the
 * gift-wrap event id of the DM that asked them. Idempotent: a second call for
 * the same item returns the state unchanged, so a retry cannot re-DM.
 *
 * @param {object} state
 * @param {{ itemId: string, pubkey: string, questions: string[], dmEventId: string, text?: string, now: number }} rec
 * @returns {object} new state
 */
function openClarification(state, rec) {
  const next = clone(state);
  const itemId = rec && typeof rec.itemId === 'string' ? rec.itemId : '';
  if (!itemId) return next;
  if (Object.prototype.hasOwnProperty.call(next.pending, itemId)) return next; // rate limit

  next.pending[itemId] = {
    status: STATUS_AWAITING,
    pubkey: typeof rec.pubkey === 'string' ? rec.pubkey : '',
    questions: Array.isArray(rec.questions) ? [...rec.questions] : [],
    dmEventId: typeof rec.dmEventId === 'string' ? rec.dmEventId : '',
    text: typeof rec.text === 'string' ? rec.text : '',
    askedAt: Number.isFinite(rec.now) ? rec.now : 0,
    dmCount: 1,
    replies: [],
  };
  return next;
}

/**
 * Attach a member's reply to a parked item and mark it resumable. Only an item
 * still `awaiting-clarification` can be resumed — an expired (`stale`) or
 * already-clarified item is left alone.
 *
 * @returns {{ state: object, resumed: boolean }}
 */
function applyReply(state, { itemId, replyText, replyEventId, now } = {}) {
  const next = clone(state);
  const entry = next.pending[itemId];
  if (!entry || entry.status !== STATUS_AWAITING) return { state: next, resumed: false };

  entry.replies.push({
    text: typeof replyText === 'string' ? replyText : '',
    eventId: typeof replyEventId === 'string' ? replyEventId : '',
    at: Number.isFinite(now) ? now : 0,
  });
  entry.status = STATUS_CLARIFIED;
  entry.repliedAt = Number.isFinite(now) ? now : 0;
  return { state: next, resumed: true };
}

/**
 * Expire every awaiting item whose 7-day window has elapsed.
 * @returns {{ state: object, expired: string[] }}
 */
function expireStale(state, now) {
  const next = clone(state);
  const at = Number.isFinite(now) ? now : 0;
  const expired = [];
  for (const [itemId, entry] of Object.entries(next.pending)) {
    if (entry.status !== STATUS_AWAITING) continue;
    const askedAt = Number.isFinite(entry.askedAt) ? entry.askedAt : 0;
    if (at - askedAt >= CLARIFY_EXPIRY_MS) {
      entry.status = STATUS_STALE;
      entry.staleAt = at;
      expired.push(itemId);
    }
  }
  return { state: next, expired };
}

/**
 * Which parked item, if any, does this inbound DM rumor answer?
 *
 * A reply matches when it comes from the parked item's author AND either
 * references the clarification DM by e-tag (an explicit thread match) or was
 * written after the DM went out. When an author has several parked items, the
 * OLDEST wins — they were asked first.
 *
 * @param {object} state
 * @param {object} rumor  the unwrapped NIP-17 DM rumor (kind 14)
 * @returns {string|null} the item id, or null
 */
function matchReplyToPending(state, rumor) {
  if (!rumor || typeof rumor !== 'object') return null;
  const pubkey = typeof rumor.pubkey === 'string' ? rumor.pubkey : '';
  const content = typeof rumor.content === 'string' ? rumor.content : '';
  if (!pubkey || !content.trim()) return null;

  const tags = Array.isArray(rumor.tags) ? rumor.tags : [];
  const eTags = new Set(
    tags.filter((t) => Array.isArray(t) && t[0] === 'e' && typeof t[1] === 'string').map((t) => t[1])
  );
  const atMs = Number.isFinite(rumor.created_at) ? rumor.created_at * 1000 : NaN;

  const { pending } = normalise(state);
  let best = null;
  for (const [itemId, entry] of Object.entries(pending)) {
    if (!entry || entry.status !== STATUS_AWAITING) continue;
    if (entry.pubkey !== pubkey) continue;
    const threadMatch = entry.dmEventId && eTags.has(entry.dmEventId);
    const timeMatch = Number.isFinite(atMs) && Number.isFinite(entry.askedAt) && atMs >= entry.askedAt;
    if (!threadMatch && !timeMatch) continue;
    if (!best || (entry.askedAt || 0) < (best.askedAt || 0)) best = { itemId, askedAt: entry.askedAt };
  }
  return best ? best.itemId : null;
}

/**
 * Build the text the clarity check is re-run against: the original item with
 * the member's replies appended, in order. Replying is not a free pass — a
 * waffly reply still fails the check.
 *
 * @param {string} originalText
 * @param {Array<{ text?: string }>} replies
 * @returns {string}
 */
function composeForRecheck(originalText, replies) {
  const head = typeof originalText === 'string' ? originalText.trim() : '';
  const tail = (Array.isArray(replies) ? replies : [])
    .map((r) => (r && typeof r.text === 'string' ? r.text.trim() : ''))
    .filter(Boolean);
  return [head, ...tail].filter(Boolean).join('\n\n');
}

// ─── Manifest gate ──────────────────────────────────────────────────────────

/**
 * Is clarify-before-acting on?
 *
 * Manifest key `[sovereign_mesh].junkiejarvis_clarify_before_acting` (flat, not
 * a table — agentbox.toml is read by a LINE-BASED parser with no inline tables,
 * see management-api/adapters/manifest-loader.js). Default TRUE: grilling first
 * is the safe behaviour, so an absent manifest still gets the gate.
 *
 * `JUNKIEJARVIS_CLARIFY_BEFORE_ACTING` is the runtime override, matching the
 * env-beats-manifest convention of the rest of the sovereign mesh (ADR-030).
 * An unparseable env value falls through to the manifest rather than failing.
 *
 * @param {object} manifest
 * @param {object} env
 * @returns {boolean}
 */
function clarifyBeforeActingEnabled(manifest, env) {
  const raw = env && typeof env === 'object' ? env.JUNKIEJARVIS_CLARIFY_BEFORE_ACTING : undefined;
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(v)) return true;
    if (['false', '0', 'no', 'off'].includes(v)) return false;
  }
  const sm = manifest && typeof manifest === 'object' && manifest.sovereign_mesh
    ? manifest.sovereign_mesh
    : {};
  const flag = sm.junkiejarvis_clarify_before_acting;
  if (typeof flag === 'boolean') return flag;
  return true;
}

module.exports = {
  // clarity check
  assessClarity,
  clarityQuestions,
  specificityScore,
  looksLikeBugReport,
  hasReproSteps,
  hasSurface,
  hasConcreteTarget,
  composeClarificationDm,
  // state machine
  emptyClarifyState,
  openClarification,
  findPending,
  shouldSendClarification,
  applyReply,
  expireStale,
  matchReplyToPending,
  composeForRecheck,
  // config
  clarifyBeforeActingEnabled,
  // constants
  CLARIFY_EXPIRY_MS,
  MIN_SPECIFICITY,
  MAX_QUESTIONS,
  MISSING_CODES,
  STATUS_AWAITING,
  STATUS_CLARIFIED,
  STATUS_STALE,
};
