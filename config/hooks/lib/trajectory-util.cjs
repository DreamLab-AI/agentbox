'use strict';

/**
 * trajectory-util.cjs — pure, dependency-free helpers for the learning-loop
 * hook (config/hooks/trajectory-recorder.cjs). PRD-018 / ADR-036 D1 /
 * DDD-016 Trajectory aggregate.
 *
 * Everything here is a pure function so it can be exercised in isolation
 * (no pg, no fs, no env). The hook owns all I/O; this owns the honesty:
 *   - conservative secret redaction (I10, fail-closed → returns null on failure)
 *   - low-cardinality command-pattern derivation (the `action` value)
 *   - real, graded OutcomeLabel derivation (I04 → returns null when undetermined)
 */

const crypto = require('crypto');

/** First 12 hex chars of a SHA-256 — the content-address convention (uris.js R1). */
function sha12(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 12);
}

// Verbs whose meaning lives in their first sub-command (git commit, docker build…).
// Keeping the sub-command makes the action pattern useful without leaking args.
const SUBCOMMAND_VERBS = new Set([
  'git', 'docker', 'docker-compose', 'npm', 'npx', 'yarn', 'pnpm', 'cargo',
  'kubectl', 'systemctl', 'supervisorctl', 'apt', 'apt-get', 'pip', 'pip3',
  'go', 'gh', 'aws', 'gcloud', 'tmux', 'claude-flow', 'psql', 'make', 'terraform',
]);

/**
 * Derive a low-cardinality command pattern: `<verb>[ <subcommand>] [shape]`.
 * The pattern is the durable `action` value — it must NOT carry raw args or
 * secrets (those live only in the redacted `result`, I10). Never throws.
 *
 * @param {string} command
 * @returns {string|null} pattern, or null if no command
 */
function commandPattern(command) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const cmd = command.trim();

  // Tokenise on whitespace (best-effort; we only need the shape, not a shell parse).
  const tokens = cmd.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  // First token → bare verb (strip any leading path, e.g. /usr/bin/git → git,
  // and leading env assignments like FOO=bar cmd → skip to the real verb).
  let idx = 0;
  while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx])) idx++;
  if (idx >= tokens.length) return null;
  const verbRaw = tokens[idx];
  const verb = verbRaw.replace(/^.*\//, '');

  const rest = tokens.slice(idx + 1);

  let label = verb;
  if (SUBCOMMAND_VERBS.has(verb) && rest.length && !rest[0].startsWith('-')) {
    // Only keep the sub-command when it is a plain, low-cardinality identifier
    // (e.g. `git commit`, `docker build`). NEVER append a raw arg — a conninfo
    // like `postgres://user:secret@host` must not enter the durable `action`.
    const sub = rest[0];
    if (/^[a-z][a-z0-9:_-]{0,30}$/.test(sub) && !/:\/\/|[@=]/.test(sub)) {
      label = `${verb} ${sub}`;
    }
  }

  // Belt-and-braces: run the label through the redactor before it becomes the
  // durable action; if redaction fails, fall back to the bare verb.
  const safeLabel = redact(label);
  label = (safeLabel == null) ? verb : safeLabel;

  // Normalised shape: counts + structural markers, no arg values.
  const flags = rest.filter((t) => t.startsWith('-')).length;
  const positionals = rest.filter((t) => !t.startsWith('-')).length;
  const markers = [];
  if (/\|/.test(cmd)) markers.push('pipe');
  if (/(^|[^&])&&|;|\|\|/.test(cmd)) markers.push('chain');
  if (/[<>]/.test(cmd)) markers.push('redirect');
  if (/\$\(|`/.test(cmd)) markers.push('subshell');

  const shape = `[args:${positionals} flags:${flags}${markers.length ? ' ' + markers.join(',') : ''}]`;
  return `${label} ${shape}`;
}

// ── Redaction (ADR-2015 closeout, 2026-09-05) ────────────────────────────────
//
// COMMAND RETENTION POLICY. A step retains a REDACTED command string, and only
// commands that survive both phases below are retained at all:
//
//   Phase 1 — structural redaction. Every recognised secret-bearing FORM is
//   rewritten to `<redacted>`. The forms are enumerated: URI-embedded
//   credentials, env-style assignments, bare `key=value`, `--flag value` and
//   `--flag=value` (quoted or unquoted), concatenated `-p` flags, JSON/YAML
//   `key: value` (quoted or unquoted), Bearer/Authorization headers, and long
//   base64/hex runs.
//
//   Phase 2 — residual verification. The redacted string is re-inspected for a
//   secret-introducing keyword still sitting in an ASSIGNMENT or FLAG position
//   with a live value after it. If one survives, the command is UNSUPPORTED:
//   redact() returns null and the recorder skips the step entirely (I10
//   fail-closed). We reject what we cannot prove safe rather than widening the
//   regular expressions until they look convincing.
//
// The estate review reproduced two escapes from the pre-closeout pattern set:
// a quoted, space-containing `--password "a b c"` lost only its first token,
// and a short JSON `"password":"x"` was untouched because the patterns keyed on
// `=`. Both are covered below, and phase 2 is the backstop for the forms nobody
// has thought of yet.
//
// A keyword in ordinary prose (`git commit -m "add password reset"`) is NOT in
// assignment or flag position and is deliberately left alone — the policy
// rejects unsafe VALUE positions, not the English word.

// The secret-introducing keyword set, shared by the redactors and the residual
// check so the two can never drift apart.
const SECRET_WORD = 'password|passwd|pwd|token|secret|api[-_]?key|apikey|auth|authorization|credential|credentials';

// A quoted run: "…" or '…', honouring backslash escapes.
const QUOTED = '(?:"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\')';

// Ordering matters: URI-embedded creds run BEFORE bare-assignment so the scheme
// host is preserved; QUOTED forms run before their unquoted siblings so a
// space-containing value is consumed whole; specific patterns run before the
// greedy base64/hex sweeps.
const REDACTORS = [
  // URI-embedded credentials: scheme://user:secret@host → scheme://user:<redacted>@host
  [/([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+):[^/\s@]+@/gi, '$1:<redacted>@'],

  // --flag "quoted value with spaces" / --flag='quoted' — consumed WHOLE.
  [new RegExp(`(--?(?:${SECRET_WORD})(?:[=\\s]))${QUOTED}`, 'gi'), '$1<redacted>'],
  // KEY="quoted value" / password='quoted value'
  [new RegExp(`\\b([A-Za-z0-9_-]*(?:${SECRET_WORD})[A-Za-z0-9_-]*\\s*=\\s*)${QUOTED}`, 'gi'), '$1<redacted>'],
  // Bearer / Authorization header tokens. These run BEFORE the generic
  // `key: value` patterns: `Authorization: Bearer abc` has TWO tokens after the
  // colon, and a single-token rule would redact `Bearer` and leave `abc`
  // standing. The Authorization rule therefore consumes the whole header value
  // up to the closing quote or end of line.
  [/\b([Bb]earer)\s+[^\s"']+/g, '$1 <redacted>'],
  [/\b(Authorization)\s*:?\s*[^"'\n]*/gi, '$1: <redacted>'],

  // JSON / YAML: "password": "x"  |  token: 'y'  — quoted value consumed whole.
  [new RegExp(`(["']?\\b(?:${SECRET_WORD})\\b["']?\\s*:\\s*)${QUOTED}`, 'gi'), '$1"<redacted>"'],
  // JSON / YAML unquoted value: password: x  |  "token":abc. The lookahead
  // keeps this from re-mangling a value the quoted rule above already redacted.
  [new RegExp(`(["']?\\b(?:${SECRET_WORD})\\b["']?\\s*:\\s*)(?!["']?<redacted)([^\\s,}\\]"']+)`, 'gi'), '$1<redacted>'],

  // KEY/TOKEN/PASSWORD/SECRET env-style assignments (FOO_API_KEY=xxx, TOKEN=xxx…)
  [/\b([A-Z0-9_]*(?:KEY|TOKEN|PASSWORD|PASSWD|PWD|SECRET)[A-Z0-9_]*)=([^\s"']+)/g, '$1=<redacted>'],
  // Bare secret assignments (case-insensitive): password=…, token=…, api-key=…, auth=…
  [new RegExp(`(${SECRET_WORD})\\s*=\\s*[^\\s"']+`, 'gi'), '$1=<redacted>'],
  // --password=... / --token ... / --api-key=... style flags (unquoted)
  [new RegExp(`(--?(?:${SECRET_WORD})(?:[=\\s]))([^\\s"']+)`, 'gi'), '$1<redacted>'],
  // Concatenated -p/-P secret flags for common CLIs (mysql/psql/curl: -pMyP4ss)
  [/(^|\s)(-[pP])([^\s-][^\s"']*)/g, '$1$2<redacted>'],
  // Long base64 runs (jwt/keys) — 40+ chars (before hex so it wins on overlaps)
  [/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '<redacted-b64>'],
  // Long hex runs (32+ chars: nsec/hex keys/digests other than the pubkey scope)
  [/\b[0-9a-fA-F]{32,}\b/g, '<redacted-hex>'],
];

// Phase 2. A secret keyword in ASSIGNMENT position (`key=`, `key:`) or FLAG
// position (`--key `, `-key `) whose value is not already redacted.
// `<redacted…>` and an immediately-following quote-then-redaction both count as
// redacted; anything else is a live value we failed to remove.
const RESIDUAL_ASSIGNMENT = new RegExp(
  `(?:^|[\\s"'{,\\[(])(?:--?)?(?:${SECRET_WORD})\\b["']?\\s*[=:]\\s*["']?(?!<redacted)(?!\\s*$)[^\\s"',}\\])]`,
  'i',
);
const RESIDUAL_FLAG = new RegExp(
  `(?:^|\\s)--?(?:${SECRET_WORD})\\s+["']?(?!<redacted)[^\\s"']`,
  'i',
);

/**
 * True when the (already redacted) text still carries a secret keyword in a
 * value-bearing position — i.e. redaction did not cover this form.
 * @param {string} text
 * @returns {boolean}
 */
function hasResidualSecret(text) {
  if (typeof text !== 'string' || !text) return false;
  return RESIDUAL_ASSIGNMENT.test(text) || RESIDUAL_FLAG.test(text);
}

/**
 * Conservatively strip obvious secrets from command text BEFORE persist, then
 * VERIFY that nothing secret-shaped survived.
 *
 * Fail-closed (I10): returns null when the input is not a string, redaction
 * throws, OR a residual secret-bearing form survives phase 1 (ADR-2015). The
 * caller MUST skip the write on null.
 *
 * @param {string} command
 * @returns {string|null} the redacted command, or null when it must not be retained
 */
function redact(command) {
  if (typeof command !== 'string') return null;
  try {
    let out = command;
    for (const [re, repl] of REDACTORS) out = out.replace(re, repl);
    // Phase 2: reject rather than retain an unsupported secret-bearing form.
    if (hasResidualSecret(out)) return null;
    // Cap length — a step result is a receipt, not a log dump.
    if (out.length > 4000) out = out.slice(0, 4000) + '…';
    return out;
  } catch {
    return null; // fail-closed
  }
}

/**
 * Derive a real, graded OutcomeLabel from a Bash tool_response (I04).
 *
 * Priority of determinable signals:
 *   1. explicit numeric exit code (exitCode / exit_code / returncode / code)
 *   2. explicit error flag (is_error / isError / error present)
 * If NEITHER is present the outcome is UNDETERMINED → returns null and the
 * caller writes NOTHING (never defaulted to success — the refuted feedback(true)).
 * `interrupted` is a user abort, not a command-quality signal → undetermined.
 *
 * quality ∈ [0,1], graded: clean success 1.0; success with stderr noise 0.85;
 * failure 0.0.
 *
 * @param {*} toolResponse
 * @returns {{ success: boolean, quality: number, signal: string, exit: (number|null) }|null}
 */
function deriveOutcome(toolResponse) {
  if (toolResponse == null) return null;
  const r = typeof toolResponse === 'object' ? toolResponse : null;
  if (!r) return null; // a bare string response carries no determinable signal

  // User abort → not a quality signal.
  if (r.interrupted === true) return null;

  const stderr = typeof r.stderr === 'string' ? r.stderr : '';
  const stderrNoise = stderr.trim().length > 0;

  // 1. explicit numeric exit code
  const exitRaw = [r.exitCode, r.exit_code, r.returncode, r.code, r.status]
    .find((v) => typeof v === 'number' && Number.isFinite(v));
  if (typeof exitRaw === 'number') {
    const success = exitRaw === 0;
    return {
      success,
      quality: success ? (stderrNoise ? 0.85 : 1.0) : 0.0,
      signal: 'exit-code',
      exit: exitRaw,
    };
  }

  // 2. explicit error flag
  const errFlag = r.is_error === true || r.isError === true ||
    (r.error != null && r.error !== false && String(r.error).length > 0);
  const errFlagPresent = ('is_error' in r) || ('isError' in r) || ('error' in r);
  if (errFlagPresent) {
    const success = !errFlag;
    return {
      success,
      quality: success ? (stderrNoise ? 0.85 : 1.0) : 0.0,
      signal: 'error-flag',
      exit: null,
    };
  }

  // Undetermined — honesty invariant: write nothing.
  return null;
}

/**
 * Grade a Bash outcome from a session-transcript tool_result (PRD-018 redesign).
 *
 * Unlike deriveOutcome (which reads a live PostToolUse tool_response), this reads
 * the authoritative `is_error` flag the transcript records for BOTH successful and
 * failed tool calls. It exists because this Claude Code build (a) omits any exit
 * code from a successful Bash tool_response and (b) does NOT fire PostToolUse at
 * all for non-zero-exit commands — so the transcript is the only source that sees
 * failures. `is_error` is a real graded signal; absence of it → undetermined → null
 * (never defaulted to success — the same honesty invariant I04).
 *
 * @param {boolean|undefined} isError  the tool_result.is_error flag
 * @param {string} [stderr]            toolUseResult.stderr (noise → slightly lower quality)
 * @param {boolean} [interrupted]      toolUseResult.interrupted (user abort → undetermined)
 * @returns {{ success: boolean, quality: number, signal: string }|null}
 */
function gradeResult(isError, stderr, interrupted) {
  if (interrupted === true) return null; // user abort, not a command-quality signal
  if (isError === true) {
    return { success: false, quality: 0.0, signal: 'transcript-is_error' };
  }
  if (isError === false) {
    const noise = typeof stderr === 'string' && stderr.trim().length > 0;
    return { success: true, quality: noise ? 0.85 : 1.0, signal: 'transcript-is_error' };
  }
  return null; // is_error absent → undetermined → write nothing
}

/**
 * REC-3 (CTC — contextual transaction cost, emitter side). Sum an assistant
 * turn's token burden from a Claude Code transcript `message.usage` block into a
 * single integer, so a step can carry the `token_count` the CTC dashboard reads
 * (PRD-019 REC-3 AC1). The burden is the WHOLE turn cost — prompt + completion +
 * cache-creation + cache-read — because that is what the turn actually spent to
 * produce the tool call. Returns null when no usage block is present or the sum
 * is zero (byte-compatible: a step without a usage source carries no field).
 *
 * @param {*} usage  a transcript record's `message.usage` object
 * @returns {number|null} total tokens, or null when undeterminable
 */
function tokenCountOf(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const n = (x) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);
  const total = n(usage.input_tokens) + n(usage.output_tokens)
    + n(usage.cache_creation_input_tokens) + n(usage.cache_read_input_tokens);
  return total > 0 ? total : null;
}

/**
 * ADR-2015 accounting closeout (2026-09-05) — USAGE IDENTITY.
 *
 * `tokenCountOf` returns a WHOLE-TURN token burden. When one assistant turn
 * issues several tracked Bash calls, every one of those steps carries the SAME
 * number, so a consumer that naively sums `token_count` across steps multiplies
 * the turn's real cost by the number of tools it used (the review reproduced
 * 150 + 150 = 300 for a single 150-token turn).
 *
 * The fix is not to divide the cost — attributing a share of a turn to a tool
 * is a guess. The fix is to make the ALLOCATION VISIBLE so the consumer can
 * deduplicate correctly: every step carries the identity of the turn its token
 * count came from. Summing `token_count` over DISTINCT `usage_id`s gives the
 * true turn cost; summing it over steps does not, and now cannot be done by
 * accident because `token_count_shared` says so explicitly.
 *
 * The identity prefers the transcript's own record identifier (stable across
 * re-scans of the same transcript) and falls back to a content address over the
 * turn's timestamp and usage block.
 *
 * @param {object} rec  a transcript record ({ uuid?, timestamp?, message:{ id?, usage? } })
 * @returns {string|null} a stable per-turn usage identity, or null when the
 *                        record carries no usage block to identify
 */
function usageIdentityOf(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const msg = (rec.message && typeof rec.message === 'object') ? rec.message : null;
  const usage = msg && msg.usage;
  if (!usage || typeof usage !== 'object') return null;
  const explicit = rec.uuid || (msg && msg.id) || rec.id;
  if (typeof explicit === 'string' && explicit.trim()) return `usage:${sha12(explicit)}`;
  // No stable record id — content-address the turn instead.
  let usageJson;
  try { usageJson = JSON.stringify(usage); } catch { usageJson = String(usage); }
  return `usage:${sha12(`${rec.timestamp || ''}|${usageJson}`)}`;
}

/**
 * REC-3 (CTC). Resolve the chain-correlation id that stitches a step to the
 * multi-agent task chain it belongs to (PRD-019 REC-3 AC2/AC4). Precedence:
 *   1. an explicit orchestrator-set chain id (AGENTBOX_HANDOFF_ID / CLAUDE_DAG_ID)
 *      — set once when a chain of agents is spawned, so every agent's steps share it;
 *   2. otherwise the trajectory's own id — a single-agent session is a chain of
 *      one, correlating its own steps and reconstructable on its own.
 * Never returns empty: a step always carries a resolvable handoff id.
 *
 * @param {object} env         process.env (or an override for testing)
 * @param {string} fallbackId  the trajectory's own id (urn or deterministic id)
 * @returns {string} the chain-correlation id
 */
function handoffIdFrom(env, fallbackId) {
  const e = env || {};
  const explicit = String(e.AGENTBOX_HANDOFF_ID || e.CLAUDE_DAG_ID || '').trim();
  return explicit || String(fallbackId || '');
}

/**
 * REC-3 (CTC emitter WIRE, PRD-019 REC-3 / ADR-037). Map a graded trajectory step
 * into the request body the agent-events emit endpoint accepts, forwarding the
 * captured CTC fields — the per-step `token_count` and the chain-correlation
 * `handoff_id` — so they REACH the agent-events envelope the publisher emits.
 * Before this, the recorder captured the fields but nothing forwarded them into a
 * real emitAgentAction call, so `CANARY-AB-CTC` could never fire; this pure mapper
 * is the deterministic core of the forwarding path (the hook owns the HTTP POST).
 *
 * Returns null when the step carries NO CTC signal (no token burden and no chain
 * id) — the wire only carries steps the CTC dashboard can actually correlate,
 * keeping the emit byte-compatible with the pre-REC-3 posture (emit nothing extra).
 *
 * @param {object} step  a scanned step: { action, outcome, durationMs, tokenCount }
 * @param {object} opts
 * @param {string} [opts.handoffId]  the chain-correlation id (from handoffIdFrom)
 * @param {string} [opts.sessionId]  the session id (source-agent label)
 * @returns {object|null} an emit body carrying token_count / handoff_id, or null
 */
function ctcEmitBodyFromStep(step, opts = {}) {
  if (!step || typeof step !== 'object') return null;
  const tokenCount = (typeof step.tokenCount === 'number' && Number.isFinite(step.tokenCount) && step.tokenCount > 0)
    ? step.tokenCount
    : null;
  const handoffId = opts.handoffId != null && String(opts.handoffId).trim() !== ''
    ? String(opts.handoffId)
    : null;
  // No CTC signal → no emit (byte-compatible: the wire gains nothing to correlate).
  if (tokenCount == null && handoffId == null) return null;

  const session = String(opts.sessionId || 'unknown');
  const success = !!(step.outcome && step.outcome.success);
  const body = {
    // String ids are hashed to u32 by the emit route; stable per session/action.
    source_agent_id: `traj:${sha12(session)}`,
    target_node_id: `action:${sha12(String(step.action || 'bash'))}`,
    // TRANSFORM (AgentActionType.TRANSFORM = 5): a bash step transforms state.
    action_type: 5,
    duration_ms: (typeof step.durationMs === 'number' && step.durationMs >= 0) ? step.durationMs : 0,
    metadata: {
      kind: 'trajectory-step',
      action: step.action || null,
      outcome: success ? 'success' : 'failure',
      // ADR-2015: a step identity a receiver can deduplicate on. Two deliveries
      // of the same step (a retried emit, a re-scan) carry the same value.
      step_id: step.toolUseId ? `step:${sha12(String(step.toolUseId))}` : null,
    },
  };
  if (tokenCount != null) {
    body.token_count = tokenCount;
    // ADR-2015 accounting: SAY WHAT THIS NUMBER IS. It is the whole assistant
    // turn's burden, not this command's measured cost, and it may be repeated
    // across sibling steps of the same turn.
    body.metadata.token_count_scope = 'assistant-turn';
    if (step.usageId) body.metadata.usage_id = step.usageId;
    if (typeof step.turnToolUses === 'number' && step.turnToolUses > 0) {
      body.metadata.turn_tool_uses = step.turnToolUses;
      body.metadata.token_count_shared = step.turnToolUses > 1;
    }
  }
  if (handoffId != null) body.handoff_id = handoffId;
  // A graded FAILURE carries its MAST tag. ADR-2015: the TOP-LEVEL field is the
  // canonical one the publisher and every downstream consumer read; the
  // metadata copy is kept as a mirror for producers that already read it.
  if (!success && step.failure_mode) {
    body.failure_mode = step.failure_mode;
    body.metadata.failure_mode = step.failure_mode;
  }
  return body;
}

module.exports = {
  sha12, commandPattern, redact, hasResidualSecret, deriveOutcome, gradeResult,
  tokenCountOf, usageIdentityOf, handoffIdFrom, ctcEmitBodyFromStep,
  SUBCOMMAND_VERBS, REDACTORS, SECRET_WORD,
};
