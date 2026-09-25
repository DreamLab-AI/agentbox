'use strict';

/**
 * routing-labels.cjs — pure logic for the routing label recorder (ADR-2110, proposed).
 *
 * The recorder turns a session transcript into teacher labels for the skill router:
 * for each real user turn, WHICH skill the main model actually loaded before the next
 * turn began. The main model is the teacher; the router's own pick (joined from its log)
 * is kept beside the label so its accuracy can be measured against the teacher.
 *
 * Deliberately NOT here: the prompt text never leaves this module in any returned value
 * that is persisted. `extractTurns` hands the text to the caller only so it can be
 * embedded; the persisted row carries the vector, never the words (ADR-2090).
 *
 * Everything in this file is synchronous and side-effect free, so every rule is unit
 * tested in tests/config/routing-labels.test.js without a database or an embedder.
 */

const crypto = require('crypto');

/** Turns shorter than this are never routed (skill-route min_prompt_chars), so never labelled. */
const DEFAULT_MIN_CHARS = 24;
/** bge-small embeds only the first ~512 tokens; the estate's embed-cap note says ~2,000 chars. */
const EMBED_CHARS = 2000;
/** A route log line is joined to a turn when their timestamps are this close. */
const ROUTE_JOIN_MS = 30000;
/** Tool-name prefixes whose presence in a turn taints it: never embedded, never stored. */
const DEFAULT_TAINT = ['mcp__email-gateway__'];

/** Harness-injected user records that are not a person typing a request. */
const NOT_A_PROMPT = [/^<task-notification/, /^<command-/, /^<local-command/, /^\[Request interrupted/, /^<system-reminder/];

function sha(s, n = 64) {
  return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, n);
}

/** The user-typed text of a transcript record, or null when it is not a real prompt. */
function promptText(rec) {
  if (!rec || rec.type !== 'user' || rec.isSidechain || rec.isMeta) return null;
  const c = rec.message && rec.message.content;
  let text = null;
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) {
    if (c.some((b) => b && b.type === 'tool_result')) return null;
    text = c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
  }
  if (!text) return null;
  text = text.trim();
  if (NOT_A_PROMPT.some((re) => re.test(text))) return null;
  return text;
}

/**
 * How a skill was loaded, strongest evidence first. Only `skill` and `read` count as the
 * teacher USING a skill; a `shell` read (head/sed/grep of a SKILL.md) is overwhelmingly
 * the model INSPECTING one — the live self-test's only two non-`none` labels were exactly
 * that — so it is recorded beside the label but never sets it.
 */
const LABELLING_VIA = new Set(['skill', 'read']);

/**
 * The skill a tool call loads, as `{ name, via }`, or null. The Skill tool (`plugin:name`
 * keeps only `name`), a Read of a SKILL.md (the route hook's path hint says Read), or a
 * shell command that names one.
 */
function loadedSkill(use) {
  if (!use || use.type !== 'tool_use') return null;
  const input = use.input || {};
  if (use.name === 'Skill' && typeof input.skill === 'string') {
    const parts = input.skill.split(':');
    const name = parts[parts.length - 1];
    return name ? { name, via: 'skill' } : null;
  }
  const re = /\/skills\/([A-Za-z0-9._-]+)\/SKILL\.md\b/;
  if (use.name === 'Read' && typeof input.file_path === 'string') {
    const m = input.file_path.match(re);
    return m ? { name: m[1], via: 'read' } : null;
  }
  if (use.name === 'Bash' && typeof input.command === 'string') {
    const m = input.command.match(re);
    return m ? { name: m[1], via: 'shell' } : null;
  }
  return null;
}

/**
 * Split transcript lines into turns. A turn is one real user prompt plus every main-thread
 * tool call up to the next real prompt. Only turns whose prompt sits at or after `fromLine`
 * are returned (the watermark), but tool calls are attributed across it, because a turn's
 * loads always follow its prompt.
 *
 * Returns `{ turns, lineCount }`; each turn is
 * `{ uuid, ts, line, text, loads: [skill…], via: [skill|read|shell…], tainted }`.
 */
function extractTurns(lines, fromLine = 0, opts = {}) {
  const minChars = opts.minChars || DEFAULT_MIN_CHARS;
  const taint = opts.taint || DEFAULT_TAINT;
  const turns = [];
  let cur = null;
  lines.forEach((line, i) => {
    if (!line) return;
    let rec;
    try { rec = JSON.parse(line); } catch { return; }
    const text = promptText(rec);
    if (text !== null) {
      cur = { uuid: rec.uuid || `line-${i}`, ts: rec.timestamp || null, line: i, text, loads: [], via: [], tainted: false };
      turns.push(cur);
      return;
    }
    if (!cur || rec.type !== 'assistant' || rec.isSidechain) return;
    const c = rec.message && rec.message.content;
    if (!Array.isArray(c)) return;
    for (const b of c) {
      if (!b || b.type !== 'tool_use') continue;
      if (taint.some((p) => String(b.name || '').startsWith(p))) cur.tainted = true;
      const s = loadedSkill(b);
      if (!s) continue;
      const at = cur.loads.indexOf(s.name);
      if (at === -1) { cur.loads.push(s.name); cur.via.push(s.via); }
      else if (!LABELLING_VIA.has(cur.via[at]) && LABELLING_VIA.has(s.via)) cur.via[at] = s.via; // upgrade inspection → use
    }
  });
  return {
    turns: turns.filter((t) => t.line >= fromLine && t.text.length >= minChars),
    lineCount: lines.length,
  };
}

/**
 * The teacher label: the first skill the model USED (Skill tool or Read — see
 * LABELLING_VIA) that is a routable candidate; `other` when it used something but none of
 * it is routable (a plugin skill, a superseded one); `none` when it used nothing. `via`
 * defaults to all-`skill` so a bare list of names is treated as used.
 */
function labelOf(loads, candidates, via = loads.map(() => 'skill')) {
  const used = loads.filter((_, i) => LABELLING_VIA.has(via[i]));
  const hit = used.find((s) => Object.prototype.hasOwnProperty.call(candidates, s));
  if (hit) return hit;
  return used.length ? 'other' : 'none';
}

/** The route-log line for this turn: same session, nearest timestamp within the window. */
function matchRoute(routeLines, session, ts) {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return null;
  let best = null, bestGap = Infinity;
  for (const r of routeLines) {
    if (!r || r.session !== session || r.consumer !== 'hook') continue;
    const gap = Math.abs(Date.parse(r.ts) - t);
    if (gap <= ROUTE_JOIN_MS && gap < bestGap) { best = r; bestGap = gap; }
  }
  return best;
}

/** The persisted row. The prompt text is absent by construction; only its length is kept. */
function rowFor(turn, session, vector, embedModel, candidates, route) {
  return {
    id: sha(`${session}|${turn.uuid}`),
    session_hash: sha(session, 12),
    turn_ts: turn.ts,
    embed_model: embedModel,
    embedding: vector,
    loaded: turn.loads,
    load_via: turn.via || turn.loads.map(() => 'skill'),
    label: labelOf(turn.loads, candidates, turn.via),
    router_pick: route ? (route.choice || null) : null,
    router_model: route ? (route.model || null) : null,
    router_cascade: route ? (route.cascade || null) : null,
    router_margin: route && typeof route.margin === 'number' ? route.margin : null,
    prompt_chars: turn.text.length,
  };
}

module.exports = {
  DEFAULT_MIN_CHARS, EMBED_CHARS, ROUTE_JOIN_MS, DEFAULT_TAINT, LABELLING_VIA,
  promptText, loadedSkill, extractTurns, labelOf, matchRoute, rowFor, sha,
};
