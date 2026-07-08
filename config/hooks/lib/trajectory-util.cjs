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

// Redaction patterns for obvious secrets. Conservative: over-redact rather than leak.
// Ordering matters: URI-embedded creds run BEFORE bare-assignment so the scheme
// host is preserved; specific patterns run before the greedy base64/hex sweeps.
const REDACTORS = [
  // URI-embedded credentials: scheme://user:secret@host → scheme://user:<redacted>@host
  [/([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+):[^/\s@]+@/gi, '$1:<redacted>@'],
  // KEY/TOKEN/PASSWORD/SECRET env-style assignments (FOO_API_KEY=xxx, TOKEN=xxx…)
  [/\b([A-Z0-9_]*(?:KEY|TOKEN|PASSWORD|PASSWD|PWD|SECRET)[A-Z0-9_]*)=(\S+)/g, '$1=<redacted>'],
  // Bare secret assignments (case-insensitive): password=…, token=…, api-key=…, auth=…
  [/(password|passwd|pwd|token|secret|api[-_]?key|auth)\s*=\s*\S+/gi, '$1=<redacted>'],
  // --password=... / --token ... / --api-key=... style flags
  [/(--?(?:password|passwd|token|secret|api[-_]?key|auth)(?:[=\s]))(\S+)/gi, '$1<redacted>'],
  // Concatenated -p/-P secret flags for common CLIs (mysql/psql/curl: -pMyP4ss)
  [/(^|\s)(-[pP])([^\s-][^\s]*)/g, '$1$2<redacted>'],
  // Bearer / Authorization header tokens
  [/\b([Bb]earer)\s+\S+/g, '$1 <redacted>'],
  [/\b(Authorization:?)\s*\S+/gi, '$1 <redacted>'],
  // Long base64 runs (jwt/keys) — 40+ chars (before hex so it wins on overlaps)
  [/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '<redacted-b64>'],
  // Long hex runs (32+ chars: nsec/hex keys/digests other than the pubkey scope)
  [/\b[0-9a-fA-F]{32,}\b/g, '<redacted-hex>'],
];

/**
 * Conservatively strip obvious secrets from command text BEFORE persist.
 * Fail-closed (I10): returns null if the input is not a string or redaction
 * throws — the caller MUST skip the write on null.
 *
 * @param {string} command
 * @returns {string|null}
 */
function redact(command) {
  if (typeof command !== 'string') return null;
  try {
    let out = command;
    for (const [re, repl] of REDACTORS) out = out.replace(re, repl);
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

module.exports = {
  sha12, commandPattern, redact, deriveOutcome, gradeResult,
  tokenCountOf, handoffIdFrom,
  SUBCOMMAND_VERBS, REDACTORS,
};
