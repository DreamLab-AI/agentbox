'use strict';

/**
 * ADR-2015 / ADR-2016 closeout acceptance (2026-09-05).
 *
 * Locks the four defects the estate review reproduced:
 *   1. the redactor left a quoted `--password "a b c"` tail and a short JSON
 *      `"password":"x"` value intact (learning-evidence.md);
 *   2. a missing `pg` module advanced the persisted watermark, permanently
 *      skipping those transcript lines;
 *   3. a turn's token total was attached to every Bash step of that turn with
 *      no identity to deduplicate on (transaction-cost-accounting.md);
 *   4. the recorder's `metadata.failure_mode` and the publisher's top-level
 *      `failure_mode` disagreed about the same event (failure-telemetry.md);
 * plus ADR-2016's promotion-evidence conditions.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const util = require(path.resolve(__dirname, '../../config/hooks/lib/trajectory-util.cjs'));
const agg = require(path.resolve(__dirname, '../../mcp/servers/lib/aggregate-effectiveness.js'));
const { AgentEventPublisher } = require(path.resolve(__dirname, '../../management-api/utils/agent-event-publisher.js'));

// ── ADR-2015: privacy sentinels ─────────────────────────────────────────────
describe('ADR-2015 redaction — the reproduced escapes are closed', () => {
  test('a QUOTED, space-containing --password value is consumed whole', () => {
    const out = util.redact('mysql --password "correct horse battery staple" -h db');
    expect(out).not.toMatch(/horse|battery|staple/);
    expect(out).toBe('mysql --password <redacted> -h db');
  });

  test('single-quoted secret flag values too', () => {
    const out = util.redact("aws --secret 'a b c' s3 ls");
    expect(out).toBe('aws --secret <redacted> s3 ls');
    expect(out).not.toMatch(/\ba b c\b/);
  });

  test('a SHORT JSON password value is redacted (the `=`-only patterns missed it)', () => {
    const out = util.redact('curl -d \'{"password":"x"}\' http://h');
    expect(out).not.toMatch(/"x"/);
    expect(out).toMatch(/<redacted>/);
  });

  test('JSON with spaces and siblings keeps the non-secret fields', () => {
    const out = util.redact('echo {"password": "hunter2", "user":"bob"}');
    expect(out).not.toMatch(/hunter2/);
    expect(out).toMatch(/"user":"bob"/);
  });

  test('a Bearer token behind an Authorization header does not survive', () => {
    const out = util.redact('curl -H "Authorization: Bearer abc123xyz" http://x');
    expect(out).not.toMatch(/abc123xyz/);
    expect(out).toMatch(/http:\/\/x/);
  });

  test('URI-embedded credentials keep the host and lose the secret', () => {
    const out = util.redact('psql postgres://u:s3cr3t@h/db -c "select 1"');
    expect(out).not.toMatch(/s3cr3t/);
    expect(out).toMatch(/postgres:\/\/u:<redacted>@h\/db/);
  });

  test('concatenated -p flags are redacted', () => {
    expect(util.redact('mysql -pMyP4ss -h db')).toBe('mysql -p<redacted> -h db');
  });

  test('the ENGLISH WORD in prose is not a secret and the step is retained', () => {
    const cmd = 'git commit -m "add password reset flow"';
    expect(util.redact(cmd)).toBe(cmd);
  });

  test('retention policy: a residual secret in value position REJECTS the command', () => {
    // hasResidualSecret is the phase-2 backstop; a command that reaches it with
    // a live value must be refused, not retained.
    expect(util.hasResidualSecret('foo --password livevalue')).toBe(true);
    expect(util.hasResidualSecret('foo --password <redacted>')).toBe(false);
    expect(util.hasResidualSecret('git commit -m "add password reset"')).toBe(false);
  });

  test('non-string input is still fail-closed (I10)', () => {
    expect(util.redact(null)).toBeNull();
    expect(util.redact({ a: 1 })).toBeNull();
    expect(util.redact(12345)).toBeNull();
  });

  test('the 4000-character cap still applies after redaction', () => {
    // Deliberately not one long alphanumeric run — that would be swallowed by
    // the base64 sweep and never reach the cap.
    const out = util.redact('echo ' + 'ab '.repeat(2000));
    expect(out.length).toBeLessThanOrEqual(4002);
    expect(out.endsWith('…')).toBe(true);
  });
});

// ── ADR-2015: usage identity and CTC accounting ─────────────────────────────
describe('ADR-2015 accounting — a turn total is identified, not silently repeated', () => {
  const usageRec = {
    uuid: 'rec-uuid-1',
    timestamp: '2026-09-05T10:00:00Z',
    message: { usage: { input_tokens: 100, output_tokens: 50 } },
  };

  test('tokenCountOf still sums the whole turn', () => {
    expect(util.tokenCountOf(usageRec.message.usage)).toBe(150);
  });

  test('usageIdentityOf is stable for the same record and absent without usage', () => {
    const a = util.usageIdentityOf(usageRec);
    const b = util.usageIdentityOf(JSON.parse(JSON.stringify(usageRec)));
    expect(a).toBe(b);
    expect(a).toMatch(/^usage:[0-9a-f]{12}$/);
    expect(util.usageIdentityOf({ message: {} })).toBeNull();
    expect(util.usageIdentityOf(null)).toBeNull();
  });

  test('records without a stable id are content-addressed over timestamp + usage', () => {
    const noId = { timestamp: '2026-09-05T10:00:00Z', message: { usage: { input_tokens: 7 } } };
    const same = { timestamp: '2026-09-05T10:00:00Z', message: { usage: { input_tokens: 7 } } };
    const diff = { timestamp: '2026-09-05T10:00:01Z', message: { usage: { input_tokens: 7 } } };
    expect(util.usageIdentityOf(noId)).toBe(util.usageIdentityOf(same));
    expect(util.usageIdentityOf(noId)).not.toBe(util.usageIdentityOf(diff));
  });

  test('two steps of ONE turn carry the same usage_id and are marked shared', () => {
    const uid = util.usageIdentityOf(usageRec);
    const mk = (id) => util.ctcEmitBodyFromStep(
      { toolUseId: id, action: 'git commit [args:1 flags:0]', outcome: { success: true }, durationMs: 5, tokenCount: 150, usageId: uid, turnToolUses: 2 },
      { handoffId: 'chain-1', sessionId: 's1' },
    );
    const a = mk('tu-1');
    const b = mk('tu-2');
    expect(a.token_count).toBe(150);
    expect(b.token_count).toBe(150);
    // The naive sum is 300 for a 150-token turn — the identity is what lets a
    // consumer collapse them back to one.
    expect(a.metadata.usage_id).toBe(b.metadata.usage_id);
    expect(a.metadata.token_count_shared).toBe(true);
    expect(a.metadata.turn_tool_uses).toBe(2);
    expect(a.metadata.token_count_scope).toBe('assistant-turn');
    // Distinct step identities so a receiver can deduplicate deliveries.
    expect(a.metadata.step_id).not.toBe(b.metadata.step_id);
  });

  test('a single-tool turn is NOT marked shared', () => {
    const body = util.ctcEmitBodyFromStep(
      { toolUseId: 't', action: 'ls [args:0 flags:1]', outcome: { success: true }, tokenCount: 90, usageId: 'usage:abc', turnToolUses: 1 },
      { sessionId: 's' },
    );
    expect(body.metadata.token_count_shared).toBe(false);
  });

  test('a step with no CTC signal still emits nothing', () => {
    expect(util.ctcEmitBodyFromStep({ action: 'ls', outcome: { success: true } }, {})).toBeNull();
  });
});

// ── ADR-2015: one canonical failure field ───────────────────────────────────
describe('ADR-2015 failure telemetry — one canonical field, no disagreement', () => {
  test('the mapper puts the classified mode at the TOP LEVEL and mirrors it', () => {
    const body = util.ctcEmitBodyFromStep(
      { toolUseId: 't', action: 'git push [args:0 flags:0]', outcome: { success: false }, failure_mode: 'FM-1.2', tokenCount: 10 },
      { sessionId: 's' },
    );
    expect(body.failure_mode).toBe('FM-1.2');
    expect(body.metadata.failure_mode).toBe('FM-1.2');
  });

  test('the publisher PROMOTES a metadata-only mode instead of emitting `unmapped`', () => {
    const pub = new AgentEventPublisher({ debug() {}, info() {}, warn() {}, error() {} });
    const ev = pub.emitAgentAction({
      source_agent_id: 1, target_node_id: 2, action_type: 5, duration_ms: 1,
      metadata: { outcome: 'failure', failure_mode: 'FM-1.2' },
    });
    // The reproduced defect was top-level `unmapped` alongside metadata FM-1.2.
    expect(ev.failure_mode).toBe('FM-1.2');
    expect(ev.metadata.failure_mode).toBe('FM-1.2');
  });

  test('an explicit top-level tag still wins, and the mirror is made consistent', () => {
    const pub = new AgentEventPublisher({ debug() {}, info() {}, warn() {}, error() {} });
    const ev = pub.emitAgentAction({
      source_agent_id: 1, target_node_id: 2, action_type: 5,
      failure_mode: 'FM-1.2',
      metadata: { outcome: 'failure', failure_mode: 'FM-2.6' },
    });
    expect(ev.failure_mode).toBe('FM-1.2');
    expect(ev.metadata.failure_mode).toBe('FM-1.2');
  });

  test('a SUCCESS still carries no mode (byte-compatible for existing callers)', () => {
    const pub = new AgentEventPublisher({ debug() {}, info() {}, warn() {}, error() {} });
    const ev = pub.emitAgentAction({
      source_agent_id: 1, target_node_id: 2, action_type: 5,
      metadata: { outcome: 'success' },
    });
    expect(ev.failure_mode).toBeUndefined();
  });
});

// ── ADR-2015: the watermark follows durability ──────────────────────────────
describe('ADR-2015 persistence — a missing pg module must not advance the watermark', () => {
  const RECORDER = path.resolve(__dirname, '../../config/hooks/trajectory-recorder.cjs');
  const { spawnSync } = require('child_process');
  const crypto = require('crypto');

  function sha12(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 12); }

  function transcript(dir) {
    const p = path.join(dir, 'transcript.jsonl');
    const lines = [
      JSON.stringify({ timestamp: '2026-09-05T10:00:00Z', message: { usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: 'tool_use', name: 'Bash', id: 'tu-1', input: { command: 'git status' } }] } }),
      JSON.stringify({ timestamp: '2026-09-05T10:00:01Z', toolUseResult: { stderr: '' }, message: { content: [{ type: 'tool_result', tool_use_id: 'tu-1', is_error: false }] } }),
    ];
    fs.writeFileSync(p, lines.join('\n') + '\n');
    return p;
  }

  // The recorder's pg search paths are absolute, so "module absent" cannot be
  // produced with NODE_PATH. Rather than add a test-only backdoor to production
  // code, a preload intercepts require() for the pg module — the genuine
  // missing-module condition, from outside the recorder.
  function noPgPreload(dir) {
    const p = path.join(dir, 'no-pg.cjs');
    fs.writeFileSync(p, `
      const Module = require('module');
      const orig = Module._load;
      Module._load = function (request, parent, isMain) {
        if (request === 'pg' || /(^|\\/)pg$/.test(request)) {
          const e = new Error("Cannot find module '" + request + "'");
          e.code = 'MODULE_NOT_FOUND';
          throw e;
        }
        return orig.apply(this, arguments);
      };
    `);
    return p;
  }

  test('with the pg module ABSENT the watermark stays at zero (lines are retried)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr2015-'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adr2015-stash-'));
    try {
      const tpath = transcript(dir);
      const session = 'sess-watermark-absent-module';
      const r = spawnSync('node', ['--require', noPgPreload(dir), RECORDER, 'Stop'], {
        input: JSON.stringify({ session_id: session, transcript_path: tpath }),
        encoding: 'utf8',
        env: {
          ...process.env,
          TMPDIR: tmp,
          RUVECTOR_MEMORY_LEARNING_ENABLED: '1',
          RUVECTOR_RECORD_TRAJECTORIES: '1',
          AGENTBOX_CTC_EMIT: '0',
        },
      });
      expect(r.status).toBe(0); // fail-open: never blocks Claude
      expect(r.stderr).toMatch(/NOT advancing the watermark/);
      const stashPath = path.join(tmp, `agentbox-traj-${sha12(session)}.json`);
      // The pre-closeout behaviour wrote an ADVANCED watermark here; now the
      // stash is either absent or still at zero, so the lines are re-scanned.
      if (fs.existsSync(stashPath)) {
        const stash = JSON.parse(fs.readFileSync(stashPath, 'utf8'));
        expect(Number(stash.processedLines || 0)).toBe(0);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a CONNECTION failure likewise leaves the watermark for a retry', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr2015c-'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adr2015c-stash-'));
    try {
      const tpath = transcript(dir);
      const session = 'sess-watermark-conn-fail';
      const r = spawnSync('node', [RECORDER, 'Stop'], {
        input: JSON.stringify({ session_id: session, transcript_path: tpath }),
        encoding: 'utf8',
        env: {
          ...process.env,
          TMPDIR: tmp,
          RUVECTOR_MEMORY_LEARNING_ENABLED: '1',
          RUVECTOR_RECORD_TRAJECTORIES: '1',
          AGENTBOX_CTC_EMIT: '0',
          // An address that cannot connect — no live database is touched.
          RUVECTOR_PG_CONNINFO: 'host=127.0.0.1 port=1 dbname=nope user=nope password=nope',
        },
      });
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/persist failed .* watermark left at 0/);
      const stashPath = path.join(tmp, `agentbox-traj-${sha12(session)}.json`);
      if (fs.existsSync(stashPath)) {
        expect(Number(JSON.parse(fs.readFileSync(stashPath, 'utf8')).processedLines || 0)).toBe(0);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a transcript with no gradeable steps DOES advance (nothing was lost)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr2015b-'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adr2015b-stash-'));
    try {
      const p = path.join(dir, 't.jsonl');
      fs.writeFileSync(p, JSON.stringify({ message: { content: [{ type: 'text', text: 'hi' }] } }) + '\n');
      const session = 'sess-empty';
      const r = spawnSync('node', [RECORDER, 'Stop'], {
        input: JSON.stringify({ session_id: session, transcript_path: p }),
        encoding: 'utf8',
        env: { ...process.env, TMPDIR: tmp, RUVECTOR_MEMORY_LEARNING_ENABLED: '1', RUVECTOR_RECORD_TRAJECTORIES: '1', AGENTBOX_CTC_EMIT: '0' },
      });
      expect(r.status).toBe(0);
      const stash = JSON.parse(fs.readFileSync(path.join(tmp, `agentbox-traj-${sha12(session)}.json`), 'utf8'));
      expect(Number(stash.processedLines)).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── ADR-2016: promotion evidence ────────────────────────────────────────────
describe('ADR-2016 promotion — attributable, independent, unambiguous evidence', () => {
  const row = (o) => agg.computeRows([{
    pattern: 'git commit [args:1 flags:0]',
    n: '40', n_trajectories: '20', n_distinct_commands: '18', n_ambiguous: '0',
    w_total: '40', w_succ: '40', mean_quality: '1', last_seen: new Date(),
    ...o,
  }])[0];

  test('the RAW-count floor is retained unchanged (I06)', () => {
    const r = row({ n: '5', n_trajectories: '5' });
    expect(agg.promotionVerdict(r, { minSamples: 20, minTrajectories: 3 }).reason).toBe('below-raw-sample-floor');
  });

  test('40 CORRELATED observations from ONE trajectory are refused', () => {
    const r = row({ n: '40', n_trajectories: '1' });
    expect(agg.promotionVerdict(r, { minSamples: 20, minTrajectories: 3 }).eligible).toBe(false);
    expect(agg.promotionVerdict(r, { minSamples: 20, minTrajectories: 3 }).reason)
      .toBe('insufficient-independent-trajectories');
  });

  test('correlation WIDENS the interval instead of narrowing it', () => {
    const correlated = row({ n: '40', n_trajectories: '1' });
    const independent = row({ n: '40', n_trajectories: '40' });
    // Same successes, same proportion — only the independence differs.
    expect(correlated.wilson_uncorrected).toBeCloseTo(independent.wilson_uncorrected, 6);
    expect(correlated.wilson).toBeLessThan(independent.wilson);
    expect(correlated.independence).toBeCloseTo(0.025, 4);
    expect(independent.independence).toBe(1);
  });

  test('a MISLEADING zero-exit verb can never be promoted, however good its numbers', () => {
    for (const verb of ['echo', 'true', 'ls', 'cd', 'cat', 'pwd']) {
      const r = row({ pattern: `${verb} [args:1 flags:0]`, n: '999', n_trajectories: '999' });
      expect(agg.promotionVerdict(r, { minSamples: 20, minTrajectories: 3 }))
        .toEqual({ eligible: false, reason: 'non-attributable-action' });
    }
    expect(agg.isAttributableAction('git commit [args:1 flags:0]')).toBe(true);
    expect(agg.isAttributableAction('cargo test [args:0 flags:0]')).toBe(true);
    expect(agg.isAttributableAction('')).toBe(false);
  });

  test('genuinely independent, attributable evidence IS promoted', () => {
    const r = row({});
    expect(agg.promotionVerdict(r, { minSamples: 20, minTrajectories: 3 }))
      .toEqual({ eligible: true, reason: 'attributable-and-independent' });
  });

  test('AMBIGUOUS (stderr-noisy) successes stay out of the numerator', () => {
    // The SQL is the contract here: the success filter keys on the clean-success
    // threshold, and ambiguous observations are counted separately.
    expect(agg.AGG_SQL).toMatch(/quality >= \$2/);
    expect(agg.AGG_SQL).toMatch(/n_ambiguous/);
    expect(agg.successQualityMin()).toBe(0.9);
    // 0.85 — a zero-exit command that printed to stderr — is NOT a clean success.
    expect(0.85 < agg.successQualityMin()).toBe(true);
  });

  test('STALE evidence is excluded by an explicit window, not just decayed', () => {
    expect(agg.AGG_SQL).toMatch(/created_at >= now\(\) - \(\$3 \|\| ' days'\)::interval/);
    expect(agg.maxEvidenceAgeDays()).toBe(90);
  });

  test('REPLAYED persistence is idempotent: identical input gives identical output', () => {
    const input = [{
      pattern: 'cargo test [args:0 flags:0]', n: '30', n_trajectories: '10',
      n_distinct_commands: '9', n_ambiguous: '2', w_total: '30', w_succ: '27',
      mean_quality: '0.93', last_seen: '2026-09-01T00:00:00.000Z',
    }];
    expect(JSON.stringify(agg.computeRows(input))).toBe(JSON.stringify(agg.computeRows(input)));
  });

  test('summariseGates reports WHY patterns were withheld', () => {
    const rows = agg.computeRows([
      { pattern: 'echo [args:1 flags:0]', n: '50', n_trajectories: '50', n_distinct_commands: '5', n_ambiguous: '0', w_total: '50', w_succ: '50', mean_quality: '1', last_seen: new Date() },
      { pattern: 'git push [args:0 flags:0]', n: '50', n_trajectories: '1', n_distinct_commands: '1', n_ambiguous: '0', w_total: '50', w_succ: '50', mean_quality: '1', last_seen: new Date() },
      { pattern: 'npm test [args:0 flags:0]', n: '2', n_trajectories: '2', n_distinct_commands: '2', n_ambiguous: '0', w_total: '2', w_succ: '2', mean_quality: '1', last_seen: new Date() },
    ]);
    const s = agg.summariseGates(rows, { minSamples: 20, minTrajectories: 3, feedRetrieval: false, feedRouting: false });
    expect(s.patterns_cleared_floor).toBe(0);
    expect(s.patterns_withheld['non-attributable-action']).toBe(1);
    expect(s.patterns_withheld['insufficient-independent-trajectories']).toBe(1);
    expect(s.patterns_withheld['below-raw-sample-floor']).toBe(1);
    expect(s.floor_cleared).toBe(false);
  });
});
