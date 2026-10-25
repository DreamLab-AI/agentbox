'use strict';

/**
 * ontology-proposal-jev.cjs — the opt-in Jev option for AB-25-S1-01
 * ("verify SessionEnd ontology-change proposals").
 *
 * WHERE. config/hooks/ontology-monitor.cjs (AB-25.8): at SessionEnd a Z.AI worker proposes
 * changes to ontology classes; each fresh proposal is either staged locally (dryrun) or
 * signed and published as an ACSP ActionRequest (kind 31402) for a human to approve.
 *
 * WHAT IT ADDS. After the existing idempotency filter and BEFORE the emit step, ONE request
 * carries every fresh proposal (≤ 5) with the session evidence the monitor already holds
 * and the definitions of the classes the proposals cite. Per proposal:
 *
 *   supported   Noul   does the session evidence actually support this change?
 *   contradicts Noul   does the change contradict the cited class's current definition,
 *                      rather than extending or correcting it on evidence?
 *   novelty     Score  0 restates the definition · 1 trivial wording · 2 adds a fact ·
 *                      3 corrects a materially wrong or stale statement
 *
 * AUTHORITY. The verdict is an ANNOTATION. It is never placed in the signed 31402 (the
 * request is built from named fields only and this module returns verdicts in a SEPARATE
 * list), it never signs, approves or applies, and it cannot add or edit a proposal. The
 * only action it can take is to HOLD a proposal back from the forum into the local review
 * queue, and only when `AGENTBOX_JEV_PROPOSAL_HOLD_BELOW` is set to a value in [0, 0.5] (unset ⇒ never hold) and
 * the `supported` probability is below it. A held proposal is staged locally, not discarded.
 *
 * FLAG. `AGENTBOX_JEV_ONTOLOGY_PROPOSALS=1`, off by default. Off ⇒ `verify` returns
 * `{ proposals: <the same array>, held: [], verdicts: [] }` without building a request.
 *
 * DATA CLASS. The transcript tail is session text. A session that touched the email gateway
 * (tool prefixes from `AGENTBOX_TAINT_TOOLS`, skills from `AGENTBOX_TAINT_SKILLS`; defaults as in `[features.jev_compaction]`)
 * makes this consumer local-only: a non-local endpoint is refused and the proposals pass
 * through unchanged. A skill load counts too (`[features.jev_compaction].taint_skills`).
 */

const fs = require('fs');
const jev = require('./jev-option.cjs');

const ITEM = 'AB-25-S1-01';
const FLAG = 'AGENTBOX_JEV_ONTOLOGY_PROPOSALS';
const QUESTION_SET_VERSION = 'ab25-ontology-proposal/1';
/** A detached SessionEnd child, not an interactive turn: still a hard deadline, still no retry. */
const TIMEOUT_MS = 15000;
const MAX_PROPOSALS = 5;
const NOVELTY_LEVELS = Object.freeze([
  'Restates the existing definition or relation with no new information.',
  'Trivial: rewording, formatting or a synonym.',
  'Adds a fact, relation or qualification the definition lacks.',
  'Corrects a materially wrong or stale statement in the current definition.',
]);
// The same fence as jev-checkpoints/hooks/taint.ts and `[features.jev_compaction].taint_tools|taint_skills` (agentbox.toml:782-783)
// (agentbox.toml): a session that called the email gateway or Gmail, or loaded email-search.
const DEFAULT_TAINT_PREFIXES = ['mcp__email-gateway__', 'mcp__claude_ai_Gmail__', 'mcp__gmail__'];
const DEFAULT_TAINT_SKILLS = ['email-search'];

function clamp(s, n) { const t = typeof s === 'string' ? s : ''; return t.length > n ? t.slice(0, n) : t; }

function csv(v) { return String(v || '').split(',').map((x) => x.trim()).filter(Boolean); }

/** Is this tool call a taint source? Mirrors jev-checkpoints/hooks/taint.ts `taintOf`. */
function taintedCall(tool, input, env = process.env) {
  const prefixes = csv(env.AGENTBOX_TAINT_TOOLS);
  const toolHit = prefixes.length
    ? prefixes.some((p) => tool.startsWith(p))
    : DEFAULT_TAINT_PREFIXES.some((p) => tool.startsWith(p)) || /^mcp__[^_]*gmail/i.test(tool);
  if (toolHit) return true;
  if (tool !== 'Skill' || !input || typeof input !== 'object') return false;
  const raw = input.skill !== undefined && input.skill !== null ? input.skill : input.name;
  if (typeof raw !== 'string') return false;
  const bare = (raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw).trim().replace(/^\//, '');
  const skills = csv(env.AGENTBOX_TAINT_SKILLS);
  return (skills.length ? skills : DEFAULT_TAINT_SKILLS).includes(bare);
}

/** True when the transcript at `file` called a taint tool or loaded a taint skill. Never throws. */
function transcriptTainted(file, env = process.env) {
  try {
    if (!file || !fs.existsSync(file)) return false;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      const c = e && e.message && e.message.content;
      if (!Array.isArray(c)) continue;
      for (const b of c) if (b && b.type === 'tool_use' && typeof b.name === 'string' && taintedCall(b.name, b.input, env)) return true;
    }
    return false;
  } catch { return false; }
}

/** Build the request parts. Pure; exported for the wire-shape test. */
function buildRequest(proposals, concepts, work) {
  const byIri = new Map((concepts || []).map((c) => [c.iri, c]));
  const cited = [];
  const seen = new Set();
  for (const p of proposals) {
    const c = byIri.get(p.iri);
    if (c && !seen.has(c.iri)) { seen.add(c.iri); cited.push({ iri: c.iri, label: c.label, definition: clamp(c.definition, 400) }); }
  }
  const state = {
    session_evidence: {
      changed_files: ((work && work.changed) || []).slice(0, 30),
      transcript_tail: clamp(((work && work.transcript) || '').slice(-3000), 3000),
    },
    proposals: proposals.map((p) => ({
      iri: p.iri, label: clamp(p.label, 120), kind: clamp(p.kind, 40),
      title: clamp(p.title, 160), summary: clamp(p.summary, 600), rationale: clamp(p.rationale, 600),
    })),
    cited_classes: cited,
  };
  const questions = {};
  proposals.forEach((p, i) => {
    questions[`p${i}_supported`] = {
      type: 'noul',
      instructions:
        `Does \`session_evidence\` give concrete evidence for the change described by the proposal at index ${i} of \`proposals\`? ` +
        'Answer yes only when the changed files or transcript tail actually show it; a plausible-sounding change with no evidence is no.',
    };
    questions[`p${i}_contradicts`] = {
      type: 'noul',
      instructions:
        `Does the proposal at index ${i} of \`proposals\` contradict the current definition of the class it cites in \`cited_classes\` ` +
        '(rather than extending or correcting it on the evidence)? If the cited class is not listed, answer no.',
    };
    questions[`p${i}_novelty`] = {
      type: 'score',
      instructions:
        `How much new, correct information does the proposal at index ${i} of \`proposals\` add to the class it cites in \`cited_classes\`?`,
      criteria: [...NOVELTY_LEVELS],
    };
  });
  return { state, questions };
}

/**
 * Verify fresh proposals. Never throws.
 *
 * @param {object[]} proposals the fresh proposals (already past the idempotency filter)
 * @param {object} ctx { concepts, work, transcriptPath }
 * @param {object} [opts] { env, fetchImpl, sink }
 * @returns {Promise<{proposals: object[], held: object[], verdicts: object[]}>}
 *   `proposals` is the very same array when nothing is held or Jev is unavailable.
 */
async function verify(proposals, ctx = {}, opts = {}) {
  const env = opts.env || process.env;
  const passthrough = { proposals, held: [], verdicts: [] };
  if (!jev.enabled(env, FLAG) || !Array.isArray(proposals) || !proposals.length) return passthrough;
  const fail = (reason) => { jev.logFallback(ITEM, reason, opts.sink); return passthrough; };

  const batch = proposals.slice(0, MAX_PROPOSALS);
  const tainted = transcriptTainted(ctx.transcriptPath, env);
  const ep = jev.resolveEndpoint(env, { localOnly: tainted || jev.enabled(env, 'AGENTBOX_JEV_ONTOLOGY_PROPOSALS_LOCAL_ONLY') });
  if (!ep.ok) return fail(ep.reason);

  const req = buildRequest(batch, ctx.concepts, ctx.work);
  const res = await jev.ask(ep, req.state, req.questions, { fetchImpl: opts.fetchImpl, timeoutMs: TIMEOUT_MS, retries: 0 });
  if (!res.ok) return fail(res.reason);

  const verdicts = [];
  for (let i = 0; i < batch.length; i++) {
    const supported = jev.readNoul(res.answers[`p${i}_supported`]);
    const contradicts = jev.readNoul(res.answers[`p${i}_contradicts`]);
    const novelty = jev.readScore(res.answers[`p${i}_novelty`], NOVELTY_LEVELS.length);
    if (supported === null || contradicts === null || novelty === null) return fail('malformed');
    verdicts.push({
      iri: batch[i].iri, kind: batch[i].kind,
      supported, contradicts, novelty: Math.round(novelty * 1000) / 1000,
      question_set_version: QUESTION_SET_VERSION, model: res.model,
    });
  }

  // A Noul near 0.5 means "uncertain": a threshold above 0.5 would hold a proposal on an uncertain
  // answer, so it is refused (treated as unset) rather than honoured.
  const holdBelow = Number.parseFloat(env.AGENTBOX_JEV_PROPOSAL_HOLD_BELOW);
  if (!Number.isFinite(holdBelow) || holdBelow < 0 || holdBelow > 0.5) return { proposals, held: [], verdicts };
  // Below the configured support probability a proposal goes to the local review queue instead of the forum.
  const held = [];
  const kept = [];
  proposals.forEach((p, i) => {
    const v = i < verdicts.length ? verdicts[i] : null;
    if (v && v.supported < holdBelow) held.push(p); else kept.push(p);
  });
  if (!held.length) return { proposals, held: [], verdicts };
  jev.logFallback(ITEM, 'low-confidence', opts.sink);
  return { proposals: kept, held, verdicts };
}

module.exports = {
  ITEM, FLAG, QUESTION_SET_VERSION, NOVELTY_LEVELS, MAX_PROPOSALS,
  buildRequest, transcriptTainted, taintedCall, verify,
};
