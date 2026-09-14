#!/usr/bin/env node
'use strict';

/**
 * colloquy-reflect-candidates.cjs — surface evidence for `reflect`, never units.
 *
 * ADR-2085. cq's `reflect` verb mines a finished session for learnings worth
 * sharing. The extraction is the MODEL's job — it has the transcript and the
 * judgement — so this hook does not write knowledge units and does not call
 * `propose`. It does the one part a program can do honestly: find the places in
 * the session where something was worked out, and put them where the agent can
 * see them.
 *
 * WHAT COUNTS AS EVIDENCE
 *
 * A command that FAILED, where the next attempt at the same kind of command
 * worked. That transition is the signature of a learning: somebody did not know
 * a thing, then knew it. A step that only ever failed is an unsolved problem,
 * not a learning; a step that only ever succeeded taught nobody anything; and an
 * identical command that worked on the second run is a flake, since nobody
 * changed anything. None of the three is a candidate.
 *
 * Mechanically generating units from graded steps would flood the store with
 * noise — "this bash command exited 1" is not knowledge — and the store's whole
 * value is that a unit is worth reading. So the output is a prompt, not a write.
 *
 * HARD RULES, matching trajectory-recorder.cjs:
 *   - DEFAULT-OFF: silent exit 0 unless COLLOQUY_REFLECT_CANDIDATES is on.
 *   - FAIL-OPEN: any error exits 0 and never blocks Claude.
 *   - FAIL-CLOSED on privacy (I10): an excerpt that cannot be redacted is
 *     dropped, never written. Redaction is the trajectory recorder's, not a
 *     second implementation of it.
 *   - No database writes at all. This hook only reads a transcript and writes
 *     one file under the agent's own state directory.
 */

const fs = require('fs');
const path = require('path');

/** Keep an excerpt short enough to read and far under the embedding window. */
const EXCERPT_MAX = 400;
/** Above this, a session is producing noise rather than insight. */
const MAX_CANDIDATES = 12;
/**
 * How many steps after a failure still count as "the retry".
 *
 * This window is the whole heuristic, and both ends of it were measured rather
 * than guessed. `commandPattern` is built for low-cardinality aggregate stats —
 * it carries arg and flag counts, so a failure and its FIX never share one:
 * fixing a command is what changes its shape. Keyed on the bare verb instead,
 * the opposite happens — a session with 105 `cd` calls and one `cd` typo pairs
 * trivially and means nothing.
 *
 * What actually marks a learning is adjacency: something failed, and the next
 * thing tried worked. Three steps is enough room for a look-then-retry and tight
 * enough that an unrelated later success cannot masquerade as a fix.
 */
const RETRY_WINDOW = 3;

function enabled() {
  const v = String(process.env.COLLOQUY_REFLECT_CANDIDATES || '').toLowerCase();
  return v === '1' || v === 'true';
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function loadUtil() {
  // Same redaction and grading the recorder uses. Sharing it is the point: two
  // implementations of "is this safe to persist" is one too many.
  return require(path.join(__dirname, 'lib', 'trajectory-util.cjs'));
}

/** Bash tool calls from a Claude Code transcript, in order, with their results. */
function bashSteps(transcriptPath) {
  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
  const pending = new Map(); // tool_use_id -> command
  const steps = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const content = rec?.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block?.type === 'tool_use' && block?.name === 'Bash' && block?.input?.command) {
        pending.set(block.id, String(block.input.command));
      } else if (block?.type === 'tool_result' && pending.has(block.tool_use_id)) {
        const command = pending.get(block.tool_use_id);
        pending.delete(block.tool_use_id);
        steps.push({ command, isError: block.is_error });
      }
    }
  }
  return steps;
}

/** The command verb, and its subcommand where one is meaningful (`cargo test`). */
function verbOf(command, util) {
  const pattern = util.commandPattern(command);
  if (!pattern) return null;
  const bracket = pattern.indexOf(' [');
  return bracket > 0 ? pattern.slice(0, bracket) : pattern;
}

/**
 * Find failures that were immediately worked out.
 *
 * Order matters and is not symmetric: success-then-failure is a regression, not
 * a learning, and is deliberately not reported.
 */
function findCandidates(steps, util) {
  // Grade everything first. gradeResult returns null for an undetermined or
  // interrupted call — those carry no signal and must not be inferred either
  // way (I04), so they are dropped rather than defaulted.
  const graded = [];
  for (const step of steps) {
    const g = util.gradeResult(step.isError, '', false);
    if (!g) continue;
    graded.push({ ...step, quality: g.quality, verb: verbOf(step.command, util) });
  }

  const candidates = [];
  const seen = new Set();

  for (let i = 0; i < graded.length; i += 1) {
    const failure = graded[i];
    if (failure.quality !== 0 || !failure.verb) continue;

    // The retry: the next success of the same verb, within the window.
    const fix = graded
      .slice(i + 1, i + 1 + RETRY_WINDOW)
      .find((s) => s.verb === failure.verb && s.quality > 0);
    if (!fix) continue;

    // An identical command that simply worked the second time is a flake, not a
    // learning — nobody changed anything.
    if (fix.command === failure.command) continue;

    const failed = util.redact(failure.command);
    const worked = util.redact(fix.command);
    // FAIL-CLOSED: an excerpt that still carries a secret is dropped entirely.
    if (
      failed === null ||
      worked === null ||
      util.hasResidualSecret(failed) ||
      util.hasResidualSecret(worked)
    ) {
      continue;
    }

    const key = `${failed}\u0000${worked}`;
    if (seen.has(key)) continue;
    seen.add(key);

    candidates.push({
      verb: failure.verb,
      failed: failed.slice(0, EXCERPT_MAX),
      then_worked: worked.slice(0, EXCERPT_MAX),
    });
  }

  return candidates.slice(0, MAX_CANDIDATES);
}

function outputPath(sessionId) {
  const base =
    process.env.AGENTBOX_STATE ||
    path.join(process.env.HOME || '/home/devuser', '.agentbox');
  return path.join(base, 'colloquy', 'candidates', `${sessionId || 'session'}.json`);
}

function main() {
  if (!enabled()) return;

  let payload;
  try {
    payload = JSON.parse(readStdin() || '{}');
  } catch {
    return;
  }
  const transcript = payload.transcript_path;
  if (!transcript || !fs.existsSync(transcript)) return;

  const util = loadUtil();
  const candidates = findCandidates(bashSteps(transcript), util);
  if (candidates.length === 0) return;

  const out = outputPath(payload.session_id);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    `${JSON.stringify(
      {
        schema: 'agentbox/colloquy-reflect-candidates@1',
        session_id: payload.session_id || null,
        generated_at: new Date().toISOString(),
        note:
          'Evidence, not knowledge units. Each entry is something that failed and then worked ' +
          'on the next attempt in this session. Decide which are worth writing up, then call the ' +
          'colloquy `reflect` tool with the ones that are — it checks what the store already ' +
          'knows before filing anything.',
        candidates,
      },
      null,
      2,
    )}\n`,
  );

  process.stderr.write(
    `[colloquy] ${candidates.length} candidate learning(s) from this session → ${out}\n` +
      '           Worth writing up? Pass them to the colloquy `reflect` tool.\n',
  );
}

try {
  main();
} catch {
  // FAIL-OPEN, always.
}
process.exit(0);
