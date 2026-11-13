// scripts/lib/memory-qa-protocol.mjs
//
// The registered protocol of the end-to-end memory fixture (ADR-2201 clause 5).
// Everything that decides an outcome lives here and is pure: the parameters,
// the prompts, the judge, the statistics, the floors and the verdict. The
// harness (scripts/memory-qa-harness.mjs) only moves data.
//
// The SHA-256 of THIS FILE is written into the registration record. A run is
// refused when the file no longer matches, so a prompt, a parameter or a floor
// cannot be changed after results have been seen. A change is a new protocol
// version with a new registration, never an edit to an old one.

import { createHash } from 'node:crypto';

export const PROTOCOL_VERSION = 1;

// ── parameters ───────────────────────────────────────────────────────────────
export const PARAMS = Object.freeze({
  namespace: 'project-state',
  questions_per_stratum: 40,       // 40 latest-state + 40 single-note (the answering model serves one request at a time)
  cluster_min_cosine: 0.85,        // leader clustering over stored embeddings
  cluster_min_members: 3,
  cluster_max_members: 6,          // the most recent six notes of a cluster
  gold_min_chars: 2,
  gold_max_chars: 60,
  topic_max_chars: 1800,           // inside the 2,000-char embedding prefix
  search_limit: 5,                 // memory_search defaults (ADR-2111)
  search_min_score: 0.55,
  search_snippet_chars: 300,
  max_tool_steps: 6,               // per question, iterative arms
  retrieve_max_chars: 4000,        // a retrieved value is cut here for the model's context
  note_max_chars: 2500,            // a note is cut here when shown to the question or topic writer
  note_min_chars: 150,             // shorter notes are not sampled
  temperature: 0,
  max_tokens: 2048,
  build_seed: 'adr-2201-v1',       // md5(seed + key) orders every sample
});

export const ARMS = Object.freeze(['closed_book', 'one_shot', 'iterative', 'consolidated']);
export const STRATA = Object.freeze(['latest_state', 'single_note']);

// ── floors (never moved after a result is seen) ──────────────────────────────
// Each comparison is paired over the same questions. A floor is cleared only
// when the difference reaches the point floor AND the exact McNemar test gives
// p <= alpha. A difference that reaches the point floor without significance
// is INCONCLUSIVE, which is not a pass.
export const FLOORS = Object.freeze({
  alpha: 0.05,
  // Positive control: the questions must need memory. If the model answers too
  // many with no memory at all, the fixture measures nothing and the run is void.
  control_closed_book_max_accuracy: 0.20,
  // ADR-2201 clause 6: iterative-read guidance is earned by this comparison.
  iterative_over_one_shot: { strata: ['latest_state', 'single_note'], min_points: 10 },
  // A consolidation step is earned by this comparison, on the stratum it is for…
  consolidated_over_iterative: { strata: ['latest_state'], min_points: 10 },
  // …and it must not cost more than this on single-note questions.
  consolidated_single_note_max_loss_points: 5,
});

// ── prompts ──────────────────────────────────────────────────────────────────
export const PROMPTS = Object.freeze({
  question_single: [
    'You write test questions about a private engineering notebook.',
    'Given one NOTE, write one question that can be answered only from this note.',
    'Rules: the question must name its specific subject so it is unambiguous to someone who has not seen the note;',
    'the answer must be a short string (a number with its unit, a date, an identifier, a name) copied VERBATIM from the note;',
    'the answer must not appear in the question. Reply with one JSON object only: {"question": "...", "answer": "..."}',
  ].join(' '),
  question_latest: [
    'You write test questions about a private engineering notebook.',
    'You are given the LATEST note on a subject and OLDER notes on the same subject.',
    'Write one question about the CURRENT state of that subject, answerable from the LATEST note.',
    'Rules: the question must name its specific subject so it is unambiguous to someone who has not seen the notes;',
    'the answer must be a short string (a number with its unit, a date, an identifier, a name) copied VERBATIM from the LATEST note;',
    'the answer must NOT appear anywhere in the OLDER notes; the answer must not appear in the question.',
    'Reply with one JSON object only: {"question": "...", "answer": "..."}',
  ].join(' '),
  topic: [
    'You maintain a private engineering notebook.',
    'You are given dated notes on one subject, oldest first.',
    'Write ONE consolidated topic entry: the current state first, stated as facts with exact values, then a short dated history.',
    'Where notes disagree, the later note wins. Copy identifiers, numbers and dates exactly. Do not invent anything.',
    `Plain text, at most ${1800} characters. Reply with the entry text only.`,
  ].join(' '),
  answer_closed_book: [
    'Answer the question in one short phrase. If you do not know, reply exactly: unknown.',
    'Reply with one JSON object only: {"answer": "..."}',
  ].join(' '),
  answer_one_shot: [
    'Answer the question using only the MEMORY SEARCH RESULTS provided. Results are snippets and may be cut short.',
    'Answer in one short phrase, copying exact values. If the results do not contain the answer, reply exactly: unknown.',
    'Reply with one JSON object only: {"answer": "..."}',
  ].join(' '),
  answer_iterative: [
    'Answer the question from a memory store. You act in steps. Each step reply with ONE JSON object and nothing else:',
    '{"action":"search","query":"..."} runs a semantic search and returns up to 5 snippets (cut short) with keys;',
    '{"action":"retrieve","key":"..."} returns the whole value of one entry;',
    '{"action":"answer","text":"..."} gives your final answer as one short phrase, copying exact values.',
    'Snippets are often truncated: retrieve an entry before trusting it. Notes are dated; when notes disagree prefer the most recent.',
    'If the memory does not contain the answer, answer exactly: unknown.',
  ].join(' '),
  // Returned instead of repeating an action the model has already taken.
  repeat_nudge: 'You have already taken exactly this action; the result is above. Retrieve one of the keys you were shown, search with different words, or answer.',
  // The consolidated arm adds exactly one sentence to the iterative prompt.
  answer_consolidated_extra:
    'Entries whose key starts with "topic:" are consolidated summaries; a retrieved topic lists the dated notes it was written from as evidence, which you may retrieve to check it.',
});

// ── judge (deterministic) ────────────────────────────────────────────────────
/** Lowercase, fold whitespace, drop surrounding punctuation and quote marks. */
export function normaliseAnswer(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:!?()[\]{}]+|[\s.,;:!?()[\]{}]+$/g, '')
    .trim();
}

/** Correct iff the normalised gold string occurs in the normalised answer. */
export function judge(answer, gold) {
  const g = normaliseAnswer(gold);
  if (!g) return false;
  return normaliseAnswer(answer).includes(g);
}

// ── fixture validation ───────────────────────────────────────────────────────
/** Reasons a generated question is unusable; empty when it is acceptable. */
export function questionDefects({ question, answer }, { source, older = [] }) {
  const defects = [];
  const q = typeof question === 'string' ? question.trim() : '';
  const a = typeof answer === 'string' ? answer.trim() : '';
  if (q.length < 12) defects.push('question too short');
  if (a.length < PARAMS.gold_min_chars || a.length > PARAMS.gold_max_chars) defects.push('answer length out of range');
  const na = normaliseAnswer(a);
  if (!na) defects.push('answer empty after normalisation');
  if (['yes', 'no', 'true', 'false', 'unknown', 'none'].includes(na)) defects.push('answer is not a specific value');
  if (na && !normaliseAnswer(source).includes(na)) defects.push('answer not verbatim in the source note');
  if (na && normaliseAnswer(q).includes(na)) defects.push('answer appears in the question');
  if (na && older.some((o) => normaliseAnswer(o).includes(na))) defects.push('answer appears in an older note');
  return defects;
}

/** Structural check of a whole fixture. Returns a list of problems. */
export function fixtureProblems(fx) {
  const problems = [];
  if (!fx || fx.protocol_version !== PROTOCOL_VERSION) problems.push('protocol_version mismatch');
  if (!fx || !Array.isArray(fx.questions) || !Array.isArray(fx.topics)) return [...problems, 'questions/topics missing'];
  const ids = new Set();
  for (const q of fx.questions) {
    if (!q.id || ids.has(q.id)) problems.push(`duplicate or missing id: ${q.id}`);
    ids.add(q.id);
    if (!STRATA.includes(q.stratum)) problems.push(`${q.id}: unknown stratum`);
    if (typeof q.question !== 'string' || typeof q.gold !== 'string' || typeof q.source_key !== 'string') problems.push(`${q.id}: incomplete`);
  }
  for (const s of STRATA) {
    const n = fx.questions.filter((q) => q.stratum === s).length;
    if (n !== PARAMS.questions_per_stratum) problems.push(`stratum ${s} has ${n} questions, expected ${PARAMS.questions_per_stratum}`);
  }
  const topicKeys = new Set(fx.topics.map((t) => t.key));
  for (const q of fx.questions.filter((x) => x.stratum === 'latest_state')) {
    if (!topicKeys.has(q.topic_key)) problems.push(`${q.id}: no topic for its cluster`);
  }
  for (const t of fx.topics) {
    if (!/^topic:/.test(t.key)) problems.push(`${t.key}: topic key must start with "topic:"`);
    if (typeof t.value !== 'string' || !t.value || t.value.length > PARAMS.topic_max_chars) problems.push(`${t.key}: value missing or too long`);
    if (!Array.isArray(t.evidence) || t.evidence.length < PARAMS.cluster_min_members) problems.push(`${t.key}: too few evidence references`);
  }
  return problems;
}

// ── canonical digest ─────────────────────────────────────────────────────────
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export function sha256Hex(text) { return createHash('sha256').update(text, 'utf8').digest('hex'); }
/** Digest of a fixture that does not depend on key order or file formatting. */
export function fixtureDigest(fx) { return sha256Hex(canonical(fx)); }

// ── model reply parsing ──────────────────────────────────────────────────────
/** First balanced JSON object in a model reply, or null. */
export function extractJson(text) {
  const s = String(text ?? '');
  for (let start = s.indexOf('{'); start !== -1; start = s.indexOf('{', start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return null;
}

/** Parse one step of the iterative protocol. Anything unparseable is an answer of "unknown". */
export function parseAction(text) {
  const o = extractJson(text);
  if (o && o.action === 'search' && typeof o.query === 'string' && o.query.trim()) return { action: 'search', query: o.query.trim() };
  if (o && o.action === 'retrieve' && typeof o.key === 'string' && o.key.trim()) return { action: 'retrieve', key: o.key.trim() };
  if (o && o.action === 'answer' && typeof o.text === 'string') return { action: 'answer', text: o.text };
  if (o && typeof o.answer === 'string') return { action: 'answer', text: o.answer };
  return { action: 'answer', text: 'unknown', malformed: true };
}

/** True when the model asks for an action it has already taken in this question. */
export function isRepeat(steps, act) {
  return steps.some((s) => s.action === act.action
    && (act.action === 'search' ? s.query === act.query : s.key === act.key));
}

// ── statistics ───────────────────────────────────────────────────────────────
function logChoose(n, k) {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}
/**
 * Exact two-sided McNemar test on the discordant pairs: b = A right and B
 * wrong, c = A wrong and B right. Returns 1 when there are no discordant pairs.
 */
export function mcnemarExact(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(logChoose(n, i) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}

/** Paired comparison of arm A over arm B on the given question ids. */
export function compareArms(correctA, correctB, ids) {
  let a = 0, b = 0, aOnly = 0, bOnly = 0;
  for (const id of ids) {
    const x = correctA[id] === true, y = correctB[id] === true;
    if (x) a++; if (y) b++;
    if (x && !y) aOnly++; if (!x && y) bOnly++;
  }
  const n = ids.length;
  return {
    n, a_correct: a, b_correct: b,
    diff_points: n ? Math.round(((a - b) / n) * 1000) / 10 : 0,
    a_only: aOnly, b_only: bOnly, p: mcnemarExact(aOnly, bOnly),
  };
}

function floorVerdict(cmp, minPoints, alpha) {
  if (cmp.diff_points < minPoints) return 'fails';
  return cmp.p <= alpha ? 'clears' : 'inconclusive';
}

/**
 * The registered verdict. `results[arm][questionId] = boolean`.
 * `questions` supplies each id's stratum.
 */
export function verdict(results, questions) {
  const idsOf = (strata) => questions.filter((q) => strata.includes(q.stratum)).map((q) => q.id);
  const all = idsOf(STRATA);
  const accuracy = {};
  for (const arm of ARMS) {
    accuracy[arm] = {};
    for (const s of [...STRATA, 'all']) {
      const ids = s === 'all' ? all : idsOf([s]);
      accuracy[arm][s] = ids.length ? ids.filter((id) => results[arm]?.[id] === true).length / ids.length : null;
    }
  }
  const controlOk = accuracy.closed_book.all <= FLOORS.control_closed_book_max_accuracy;

  const f1 = FLOORS.iterative_over_one_shot;
  const iterVsOne = compareArms(results.iterative, results.one_shot, idsOf(f1.strata));
  const f2 = FLOORS.consolidated_over_iterative;
  const consVsIter = compareArms(results.consolidated, results.iterative, idsOf(f2.strata));
  const consSingle = compareArms(results.consolidated, results.iterative, idsOf(['single_note']));
  const harm = -consSingle.diff_points > FLOORS.consolidated_single_note_max_loss_points;

  let consolidation = floorVerdict(consVsIter, f2.min_points, FLOORS.alpha);
  if (consolidation === 'clears' && harm) consolidation = 'fails';

  return {
    control: { closed_book_accuracy: accuracy.closed_book.all, max: FLOORS.control_closed_book_max_accuracy, valid: controlOk },
    accuracy,
    iterative_over_one_shot: { ...iterVsOne, min_points: f1.min_points, verdict: controlOk ? floorVerdict(iterVsOne, f1.min_points, FLOORS.alpha) : 'void' },
    consolidated_over_iterative: {
      ...consVsIter, min_points: f2.min_points,
      single_note: consSingle, single_note_harm: harm,
      verdict: controlOk ? consolidation : 'void',
    },
  };
}
