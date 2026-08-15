#!/usr/bin/env node
// dream-machine-nightly.mjs — HP annexe orchestrator (ADR-052)
//
// Control-plane nightly loop: discovers nominated repos by marker file
// (dream.config.json), compiles each night's prompt, dispatches to HP for
// execution against the self-hosted Loom/Qwen model, pulls artefacts back,
// and persists results (ledger row, RuVector memory if significant).
//
// Supervisord: [program:dream-machine-nightly] --once | --loop | --dry-run
// Gate: [dream_machine] enabled = true in agentbox.toml

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { join, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import http from 'node:http';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const AGENTBOX_ROOT = process.env.AGENTBOX_ROOT || '/home/devuser/workspace/project/agentbox';
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/home/devuser/workspace';
const DREAM_MACHINE_ROOT = process.env.DREAM_MACHINE_ROOT || join(WORKSPACE_ROOT, 'dream-machine');
const HP_HOST = process.env.HP_HOST || 'john@10.10.10.1';
const HP_ANNEXE_DIR = process.env.HP_ANNEXE_DIR || '/home/john/dream-annexe';
const LLM_PROVIDER = process.env.DREAM_LLM_PROVIDER || 'zai';
const LOOM_URL = process.env.LOOM_URL || 'http://192.168.2.132:8084/v1';
const LOOM_MODEL = process.env.LOOM_MODEL || 'qwen3.8-27B';
const LOOM_MAX_TOKENS = parseInt(process.env.LOOM_MAX_TOKENS || '16384', 10);
const ZAI_URL = process.env.ZAI_URL || 'https://api.z.ai/api/anthropic';
const ZAI_API_KEY = process.env.ZAI_ANTHROPIC_API_KEY || process.env.ZAI_API_KEY || '';
const ZAI_MODEL = process.env.ZAI_MODEL || 'glm-5.3';
const ZAI_MAX_TOKENS = parseInt(process.env.ZAI_MAX_TOKENS || '16384', 10);
const ARTEFACT_DIR = join(WORKSPACE_ROOT, '.tmp/dream-annexe-artefacts');
const LOG_PREFIX = '[dream-nightly]';

const SCAN_DIRS = [
  join(WORKSPACE_ROOT, 'dream-machine'),
  join(WORKSPACE_ROOT, 'solid-pod-rs'),
  join(WORKSPACE_ROOT, 'nostr-rust-forum'),
  // Role-based third entry: all workspace repos with a marker file
  WORKSPACE_ROOT,
];

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(level, msg) {
  const ts = new Date().toISOString();
  process.stdout.write(`${ts} ${LOG_PREFIX} [${level}] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Discovery: find nominated repos by dream.config.json marker
// ---------------------------------------------------------------------------

function discoverNominated() {
  const found = new Map();

  for (const dir of SCAN_DIRS) {
    if (!existsSync(dir)) continue;

    if (dir === WORKSPACE_ROOT) {
      // Scan one level deep for marker files
      try {
        for (const entry of readdirSync(dir)) {
          const candidate = join(dir, entry);
          const marker = join(candidate, 'dream.config.json');
          if (existsSync(marker) && !found.has(candidate)) {
            try {
              const config = JSON.parse(readFileSync(marker, 'utf8'));
              found.set(candidate, { path: candidate, config, marker });
            } catch (e) {
              log('WARN', `invalid dream.config.json at ${marker}: ${e.message}`);
            }
          }
        }
      } catch { /* unreadable dir */ }
    } else {
      const marker = join(dir, 'dream.config.json');
      if (existsSync(marker) && !found.has(dir)) {
        try {
          const config = JSON.parse(readFileSync(marker, 'utf8'));
          found.set(dir, { path: dir, config, marker });
        } catch (e) {
          log('WARN', `invalid dream.config.json at ${marker}: ${e.message}`);
        }
      }
    }
  }

  return [...found.values()];
}

// ---------------------------------------------------------------------------
// Compile: use dream-machine compile to produce the nightly prompt
// ---------------------------------------------------------------------------

function compilePrompt(configPath) {
  const cli = join(DREAM_MACHINE_ROOT, 'packages/cli/dist/bin.js');
  if (!existsSync(cli)) {
    throw new Error(`dream-machine CLI not built: ${cli}`);
  }
  const result = execSync(`node ${cli} compile ${configPath}`, {
    cwd: DREAM_MACHINE_ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return result;
}

// ---------------------------------------------------------------------------
// SSH helpers
// ---------------------------------------------------------------------------

function ssh(cmd, opts = {}) {
  const timeout = opts.timeout || 300_000;
  // Source cargo env for Rust builds; fish is john's login shell so we
  // explicitly use bash -lc with the cargo env sourced.
  const wrappedCmd = `source ~/.cargo/env 2>/dev/null; ${cmd}`;
  const sshCmd = `ssh -o BatchMode=yes -o ConnectTimeout=10 ${HP_HOST} 'bash -lc ${JSON.stringify(wrappedCmd)}'`;
  return execSync(sshCmd, { encoding: 'utf8', timeout, maxBuffer: 10 * 1024 * 1024 });
}

function scp(localPath, remotePath) {
  execSync(`scp -o BatchMode=yes ${localPath} ${HP_HOST}:${remotePath}`, { timeout: 60_000 });
}

function scpFrom(remotePath, localPath) {
  execSync(`scp -o BatchMode=yes ${HP_HOST}:${remotePath} ${localPath}`, { timeout: 120_000 });
}

// ---------------------------------------------------------------------------
// HP dispatch: clone repo, run build, send prompt to Loom
// ---------------------------------------------------------------------------

function dispatchToHP(nominated, prompt, nightId) {
  const repoName = basename(nominated.path);
  const remoteDir = `${HP_ANNEXE_DIR}/${nightId}`;
  const remoteRepo = `${remoteDir}/${repoName}`;
  const config = nominated.config;

  log('INFO', `dispatch: ${repoName} → HP:${remoteDir}`);

  // 1. Create annexe directory on HP
  ssh(`mkdir -p ${remoteDir}`);

  // 2. Clone the repo fresh on HP (from the local checkout via archive)
  log('INFO', `cloning ${repoName} to HP`);
  const archivePath = `/tmp/dream-${nightId}-${repoName}.tar.gz`;
  execSync(`git -C ${nominated.path} archive --format=tar.gz HEAD > ${archivePath}`, {
    timeout: 60_000,
  });
  scp(archivePath, `${remoteDir}/`);
  ssh(`mkdir -p ${remoteRepo} && tar xzf ${remoteDir}/${basename(archivePath)} -C ${remoteRepo}`);

  // 3. Run build step if configured
  let buildOutput = '';
  if (config.buildStep?.cmd) {
    log('INFO', `building: ${config.buildStep.cmd}`);
    try {
      buildOutput = ssh(`cd ${remoteRepo} && ${config.buildStep.cmd}`, { timeout: 600_000 });
      log('INFO', 'build: OK');
    } catch (e) {
      buildOutput = e.stderr || e.message || 'build failed';
      if (config.buildStep.degradeOnWasmFailure) {
        log('WARN', 'build degraded (non-fatal)');
      } else {
        log('ERROR', 'build failed (fatal)');
        return { verdict: 'INCONCLUSIVE', reason: 'build-failed', report: buildOutput };
      }
    }
  }

  // 4. Run evaluator entrypoints
  let evalOutput = '';
  const entrypoints = config.evaluatorEntrypoints || {};
  for (const [name, cmd] of Object.entries(entrypoints)) {
    if (!cmd) continue;
    log('INFO', `evaluator: ${name} → ${cmd}`);
    try {
      const out = ssh(`cd ${remoteRepo} && ${cmd}`, { timeout: 300_000 });
      evalOutput += `\n### Evaluator: ${name}\n\`\`\`\n${out.slice(0, 5000)}\n\`\`\`\n`;
    } catch (e) {
      evalOutput += `\n### Evaluator: ${name} (FAILED)\n\`\`\`\n${(e.stderr || e.message || '').slice(0, 2000)}\n\`\`\`\n`;
    }
  }

  // 5. Send prompt + context to the Loom
  log('INFO', `calling ${LLM_PROVIDER} (${activeModel()})`);
  const fullPrompt = [
    prompt,
    '\n\n---\n\n## Build output\n\n```\n' + (buildOutput.slice(0, 3000) || '(no build step)') + '\n```\n',
    evalOutput ? '\n\n## Evaluator results\n' + evalOutput : '',
    '\n\nProduce your nightly report now. End with a clear VERDICT line: ACCEPT, REJECT, or INCONCLUSIVE.',
  ].join('');

  const loomResponse = callLLM(fullPrompt);

  // 6. Write artefacts on HP (SCP is quoting-safe; heredoc through SSH is not)
  const tmpReport = join(ARTEFACT_DIR, '.tmp-report.md');
  mkdirSync(dirname(tmpReport), { recursive: true });
  writeFileSync(tmpReport, loomResponse.slice(0, 50000));
  try { scp(tmpReport, `${remoteDir}/report.md`); } catch { /* HP pull-back has a local fallback */ }

  // 7. Parse verdict — prefer the structured "Done." line or "verdict=" field, fall back to last occurrence
  const doneMatch = loomResponse.match(/verdict[=:]\s*(ACCEPT|REJECT|INCONCLUSIVE)/i);
  const verdictSectionMatch = loomResponse.match(/##\s*VERDICT\s*\n+```(?:text)?\n\s*(ACCEPT|REJECT|INCONCLUSIVE)\b/i);
  const lastMatch = [...loomResponse.matchAll(/\b(ACCEPT|REJECT|INCONCLUSIVE)\b/g)].pop();
  const verdict = (verdictSectionMatch?.[1] || doneMatch?.[1] || lastMatch?.[1] || 'INCONCLUSIVE').toUpperCase();

  return { verdict, report: loomResponse, buildOutput, evalOutput, remoteDir };
}

// ---------------------------------------------------------------------------
// LLM call (provider-aware: loom = OpenAI format, zai = Anthropic Messages)
// ---------------------------------------------------------------------------

function activeModel() { return LLM_PROVIDER === 'zai' ? ZAI_MODEL : LOOM_MODEL; }

function callLLM(prompt) {
  if (LLM_PROVIDER === 'zai') return callZai(prompt);
  return callLoom(prompt);
}

function callLoom(prompt) {
  const body = JSON.stringify({
    model: LOOM_MODEL,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: LOOM_MAX_TOKENS,
    temperature: 1.0,
    top_p: 0.95,
    top_k: 20,
    chat_template_kwargs: { reasoning_effort: 'medium' },
  });

  try {
    const result = execSync(
      `curl -sS --max-time 300 -H "Content-Type: application/json" -d @- "${LOOM_URL}/chat/completions"`,
      { input: body, encoding: 'utf8', timeout: 320_000 }
    );
    const parsed = JSON.parse(result);
    const reasoning = parsed.choices?.[0]?.message?.reasoning_content;
    if (reasoning) log('INFO', `LLM reasoning: ${reasoning.length} chars`);
    return parsed.choices?.[0]?.message?.content || '(empty response)';
  } catch (e) {
    log('ERROR', `Loom call failed: ${e.message}`);
    return `INCONCLUSIVE — Loom unreachable: ${e.message}`;
  }
}

function callZai(prompt) {
  if (!ZAI_API_KEY) {
    log('ERROR', 'ZAI_ANTHROPIC_API_KEY not set');
    return 'INCONCLUSIVE — ZAI credentials missing';
  }
  const body = JSON.stringify({
    model: ZAI_MODEL,
    max_tokens: ZAI_MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  const tmpBody = join(ARTEFACT_DIR, 'zai-request.json');
  mkdirSync(dirname(tmpBody), { recursive: true });
  writeFileSync(tmpBody, body);

  try {
    const raw = execSync(
      `curl -sS --max-time 600 -w '\\n__HTTP_STATUS__%{http_code}' -H "Content-Type: application/json" -H "x-api-key: ${ZAI_API_KEY}" -H "anthropic-version: 2023-06-01" -d @${tmpBody} "${ZAI_URL}/v1/messages"`,
      { encoding: 'utf8', timeout: 620_000 }
    );
    const statusMatch = raw.match(/__HTTP_STATUS__(\d+)$/);
    const httpCode = statusMatch ? parseInt(statusMatch[1]) : 0;
    const jsonBody = statusMatch ? raw.slice(0, statusMatch.index).trim() : raw.trim();
    log('INFO', `ZAI response: ${jsonBody.length} bytes, HTTP ${httpCode}`);

    if (httpCode >= 400 || !jsonBody) {
      log('ERROR', `ZAI HTTP ${httpCode}: ${jsonBody.slice(0, 500)}`);
      return `INCONCLUSIVE — ZAI HTTP ${httpCode}`;
    }

    let parsed;
    try { parsed = JSON.parse(jsonBody); } catch (parseErr) {
      log('ERROR', `ZAI JSON truncated (${jsonBody.length} bytes); tail: ${jsonBody.slice(-200)}`);
      writeFileSync(join(ARTEFACT_DIR, 'zai-truncated-response.txt'), jsonBody);
      return `INCONCLUSIVE — ZAI response truncated (${jsonBody.length} bytes)`;
    }
    if (parsed.error) {
      log('ERROR', `ZAI API error: ${JSON.stringify(parsed.error)}`);
      return `INCONCLUSIVE — ZAI error: ${parsed.error.message || JSON.stringify(parsed.error)}`;
    }
    const thinking = parsed.content?.find(c => c.type === 'thinking');
    if (thinking) log('INFO', `LLM reasoning: ${thinking.thinking.length} chars`);
    const text = parsed.content?.filter(c => c.type === 'text').map(c => c.text).join('\n');
    return text || '(empty response)';
  } catch (e) {
    log('ERROR', `ZAI call failed: ${e.message}`);
    return `INCONCLUSIVE — ZAI unreachable: ${e.message}`;
  } finally {
    try { unlinkSync(tmpBody); } catch { /* best-effort cleanup */ }
  }
}

// ---------------------------------------------------------------------------
// Pull artefacts back and persist
// ---------------------------------------------------------------------------

function pullAndPersist(nominated, result, nightId) {
  const repoName = basename(nominated.path);
  const localNight = join(ARTEFACT_DIR, nightId);
  mkdirSync(localNight, { recursive: true });

  // Pull report
  const reportPath = join(localNight, 'report.md');
  try {
    scpFrom(`${result.remoteDir}/report.md`, reportPath);
  } catch {
    writeFileSync(reportPath, result.report || '(no report)');
  }

  // Compute witness
  const reportBytes = readFileSync(reportPath, 'utf8');
  const reportHash = createHash('sha256').update(reportBytes).digest('hex');
  let sessionCommit = 'unknown';
  try {
    sessionCommit = execSync(`git -C ${nominated.path} rev-parse HEAD`, { encoding: 'utf8' }).trim();
  } catch { /* no git */ }
  const witness = createHash('sha256').update(reportHash + sessionCommit).digest('hex');

  // Determine slot
  const today = new Date();
  const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
  const slots = nominated.config.slots || [];
  const slotIdx = slots.length > 0 ? dayOfYear % slots.length : 0;
  const slot = slots[slotIdx] || { deep: 'general', scan: [] };

  // Build ledger row
  const row = {
    date: today.toISOString().slice(0, 10),
    deep: slot.deep,
    finding: sanitiseFinding(result.report, result.verdict),
    issue: 'NONE',
    pr: 'NONE',
    evaluated: result.evalOutput ? 'yes' : 'no',
    verdict: result.verdict,
    effect: '',
    witness: witness.slice(0, 8),
    priorFates: '',
  };

  // Append to per-repo ledger
  const ledgerPath = join(nominated.path, nominated.config.ledgerPath || 'docs/dream-cycle/LEDGER.md');
  appendLedgerRow(ledgerPath, row);

  // Write night metadata
  writeFileSync(join(localNight, 'meta.json'), JSON.stringify({
    nightId,
    repo: repoName,
    repoPath: nominated.path,
    date: row.date,
    deep: slot.deep,
    scan: slot.scan,
    verdict: result.verdict,
    witness,
    reportHash,
    sessionCommit,
    loomModel: activeModel(),
    source: `hp-annexe-${activeModel()}`,
  }, null, 2));

  log('INFO', `${repoName}: verdict=${result.verdict} witness=${witness.slice(0, 12)}… ledger=${ledgerPath}`);

  return { row, witness, reportHash, sessionCommit, slot, localNight };
}

// ---------------------------------------------------------------------------
// Sanitise finding for ledger (keep it short and pipe-safe)
// ---------------------------------------------------------------------------

function sanitiseFinding(report, verdict) {
  if (!report) return 'see report';
  if (verdict === 'INCONCLUSIVE' && report.startsWith('INCONCLUSIVE')) {
    if (report.includes('unreachable')) return 'Loom timeout (degraded night)';
    return 'INCONCLUSIVE — see report';
  }
  const givenMatch = report.match(/Given\s+(?:a\s+)?(.{10,200}?)(?:,\s*when|,\s*$|\n\s*when)/im);
  if (givenMatch) {
    const g = givenMatch[0].replace(/[\n\r]+/g, ' ').trim();
    if (g.length > 10) return g.slice(0, 120);
  }
  const mainLesson = report.match(/\*\*Main lesson\*\*\s*\|\s*(.{10,})/);
  if (mainLesson) return mainLesson[1].replace(/[|\n\r]/g, ' ').trim().slice(0, 120);
  const findingMatch = report.match(/Finding:\s*(.{10,80})/);
  if (findingMatch) return findingMatch[1].replace(/[|\n\r]/g, ' ').trim();
  return report.slice(0, 80).replace(/[|\n\r]/g, ' ').trim() || 'see report';
}

// ---------------------------------------------------------------------------
// Ledger append
// ---------------------------------------------------------------------------

const LEDGER_HEADER = '| Date | Deep | Finding | Issue | PR | Evaluated? | Verdict | Effect | Witness | Prior-night fates |';
const LEDGER_DIVIDER = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';

function appendLedgerRow(ledgerPath, row) {
  const dir = dirname(ledgerPath);
  mkdirSync(dir, { recursive: true });

  let content = '';
  if (existsSync(ledgerPath)) {
    content = readFileSync(ledgerPath, 'utf8');
  }
  if (!content.includes('| Date |')) {
    content = LEDGER_HEADER + '\n' + LEDGER_DIVIDER + '\n';
  }

  const cells = [
    row.date, row.deep, row.finding, row.issue, row.pr,
    row.evaluated, row.verdict, row.effect, row.witness, row.priorFates,
  ].map(c => String(c || '').replace(/\|/g, '\\|').replace(/\n/g, ' '));

  content = content.trimEnd() + '\n| ' + cells.join(' | ') + ' |\n';
  writeFileSync(ledgerPath, content);
  log('INFO', `ledger row appended: ${ledgerPath}`);
}

// ---------------------------------------------------------------------------
// RuVector memory store (governed embedding transport via xinference)
// ---------------------------------------------------------------------------

const XINFERENCE_URL = process.env.XINFERENCE_ENDPOINT || 'http://xinference:9997';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'bge-small-en-v1.5';
const MEMORY_NAMESPACE = 'dream-cycle';

function getEmbedding(text) {
  const body = JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, 2000) });
  return new Promise((resolve, reject) => {
    const url = new URL(XINFERENCE_URL + '/v1/embeddings');
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.data?.[0]?.embedding) resolve(j.data[0].embedding);
          else reject(new Error(`unexpected: ${data.slice(0, 200)}`));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('embedding timeout')); });
    req.write(body);
    req.end();
  });
}

async function storeToRuVector(persisted, result, nightId) {
  if (result.verdict !== 'ACCEPT' && result.verdict !== 'REJECT') {
    log('INFO', 'RuVector: skipping (INCONCLUSIVE — significance bar)');
    return;
  }
  const require_ = createRequire(import.meta.url);
  const PG_PATHS = [
    '/home/devuser/workspace/.claude-pg/node_modules/pg',
    '/opt/agentbox/management-api/node_modules/pg',
    'pg',
  ];
  let Pool;
  for (const p of PG_PATHS) { try { Pool = require_(p).Pool; break; } catch { /* next */ } }
  if (!Pool) { log('WARN', 'RuVector: pg module not found — skipping'); return; }

  const conninfo = process.env.RUVECTOR_PG_CONNINFO ||
    'host=ruvector-postgres port=5432 dbname=ruvector user=ruvector password=ruvector';
  const parsed = Object.fromEntries(conninfo.split(/\s+/).map(p => p.split('=')));
  const pool = new Pool({
    host: parsed.host || 'ruvector-postgres', port: parseInt(parsed.port || '5432'),
    database: parsed.dbname || 'ruvector', user: parsed.user || 'ruvector', password: parsed.password || 'ruvector',
    max: 1, idleTimeoutMillis: 5000,
  });

  try {
    let projRes = await pool.query(`SELECT id FROM projects WHERE name='dream-cycle'`);
    if (!projRes.rows.length) {
      projRes = await pool.query(
        `INSERT INTO projects (name, path, description, total_entries, total_patterns, created_at, updated_at)
         VALUES ('dream-cycle', '/dream-cycle', 'Nightly dream-machine findings', 0, 0, NOW(), NOW())
         RETURNING id`
      );
    }
    const projectId = projRes.rows[0].id;

    const key = `dream-${nightId}`;
    const value = {
      repo: persisted.row?.deep ? basename(nightId.replace(/^\d{4}-\d{2}-\d{2}-/, '')) : nightId,
      date: persisted.row?.date,
      deep: persisted.row?.deep,
      finding: persisted.row?.finding,
      verdict: result.verdict,
      witness: persisted.witness,
      source: `hp-annexe-${activeModel()}`,
    };
    const metadata = {
      importance: result.verdict === 'ACCEPT' ? 0.9 : 0.7,
      tags: ['dream-cycle', persisted.row?.deep, result.verdict.toLowerCase()],
      memory_type: 'semantic',
      source: `hp-annexe-${activeModel()}`,
    };
    const embedding = await getEmbedding(`${persisted.row?.deep}: ${persisted.row?.finding}`);
    const vecStr = '[' + embedding.join(',') + ']';
    const embeddingJson = JSON.stringify(embedding);
    await pool.query(
      `INSERT INTO memory_entries (id, project_id, namespace, key, value, embedding, embedding_json, metadata, source_type, access_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::ruvector, $7::jsonb, $8::jsonb, $9, 0, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET value=$5::jsonb, embedding=$6::ruvector, embedding_json=$7::jsonb, metadata=$8::jsonb, updated_at=NOW()`,
      [
        key, projectId, MEMORY_NAMESPACE, key,
        JSON.stringify(value), vecStr, embeddingJson, JSON.stringify(metadata),
        'dream-cycle',
      ]
    );
    log('INFO', `RuVector: stored ${key} in ${MEMORY_NAMESPACE} (project ${projectId})`);
  } catch (e) {
    log('WARN', `RuVector: store failed — ${e.message}`);
  } finally {
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Cleanup HP annexe (disk hygiene)
// ---------------------------------------------------------------------------

function cleanupHP(remoteDir) {
  try {
    ssh(`rm -rf ${remoteDir}`, { timeout: 30_000 });
    log('INFO', `HP cleanup: ${remoteDir}`);
  } catch {
    log('WARN', `HP cleanup failed: ${remoteDir}`);
  }
}

// ---------------------------------------------------------------------------
// Nightly gate: only run during the configured window
// ---------------------------------------------------------------------------

function isNightlyWindow() {
  const hour = new Date().getUTCHours();
  // Default: 01:00-05:00 UTC (overnight UK)
  const start = parseInt(process.env.DREAM_WINDOW_START || '1', 10);
  const end = parseInt(process.env.DREAM_WINDOW_END || '5', 10);
  return hour >= start && hour < end;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runOnce(opts = {}) {
  log('INFO', 'cycle start');

  // HP reachability probe
  try {
    ssh('echo ok', { timeout: 15_000 });
  } catch (e) {
    log('ERROR', `HP unreachable: ${e.message}`);
    return;
  }

  // LLM health probe
  if (LLM_PROVIDER === 'zai') {
    if (!ZAI_API_KEY) { log('ERROR', 'ZAI_ANTHROPIC_API_KEY not set'); return; }
    log('INFO', `LLM provider: zai (${ZAI_MODEL}) at ${ZAI_URL}`);
  } else {
    try {
      const health = execSync(`curl -sS --max-time 10 "${LOOM_URL.replace('/v1', '')}/health"`, { encoding: 'utf8' });
      log('INFO', `Loom health: ${health.slice(0, 100)}`);
    } catch (e) {
      log('ERROR', `Loom unreachable: ${e.message}`);
      return;
    }
  }

  const nominated = discoverNominated();
  if (nominated.length === 0) {
    log('INFO', 'no nominated repos found');
    return;
  }
  log('INFO', `discovered ${nominated.length} nominated repo(s): ${nominated.map(n => basename(n.path)).join(', ')}`);

  // Sequential: one repo per cycle (ADR-052 §2.6), overridable with --target
  const today = new Date().toISOString().slice(0, 10);
  let target;
  if (opts.target) {
    target = nominated.find(n => basename(n.path) === opts.target);
    if (!target) {
      log('ERROR', `--target ${opts.target} not found in nominated repos`);
      return;
    }
    log('INFO', `forced target: ${opts.target}`);
  } else {
    const cycleIdx = nominated.length > 1
      ? Math.floor((Date.now() / 86400000)) % nominated.length
      : 0;
    target = nominated[cycleIdx];
    log('INFO', `tonight's target: ${basename(target.path)} (cycle index ${cycleIdx}/${nominated.length})`);
  }
  const repoName = basename(target.path);
  const nightId = `${today}-${repoName}`;

  if (opts.dryRun) {
    log('INFO', '[dry-run] would compile and dispatch — stopping');
    const prompt = compilePrompt(target.marker);
    log('INFO', `compiled prompt: ${prompt.length} chars, ${prompt.split('\n').length} lines`);
    return;
  }

  // Compile
  let prompt;
  try {
    prompt = compilePrompt(target.marker);
    log('INFO', `compiled: ${prompt.length} chars`);
  } catch (e) {
    log('ERROR', `compile failed: ${e.message}`);
    return;
  }

  // Dispatch
  let result;
  try {
    result = dispatchToHP(target, prompt, nightId);
  } catch (e) {
    log('ERROR', `dispatch failed: ${e.message}`);
    result = { verdict: 'INCONCLUSIVE', reason: 'dispatch-failed', report: e.message, remoteDir: `${HP_ANNEXE_DIR}/${nightId}` };
  }

  // Persist
  let persisted;
  try {
    persisted = pullAndPersist(target, result, nightId);
    log('INFO', `persisted: ${JSON.stringify({ verdict: result.verdict, witness: persisted.witness.slice(0, 12) })}`);
  } catch (e) {
    log('ERROR', `persist failed: ${e.message}`);
  }

  // RuVector memory (significance bar: ACCEPT/REJECT only)
  if (persisted) {
    try { await storeToRuVector(persisted, result, nightId); } catch (e) { log('WARN', `RuVector: ${e.message}`); }
  }

  // Cleanup HP (keep last 7 nights)
  try {
    const nights = ssh(`ls -1 ${HP_ANNEXE_DIR} 2>/dev/null || true`).trim().split('\n').filter(Boolean);
    if (nights.length > 7) {
      const toRemove = nights.sort().slice(0, nights.length - 7);
      for (const old of toRemove) {
        cleanupHP(`${HP_ANNEXE_DIR}/${old}`);
      }
    }
  } catch { /* best effort */ }

  log('INFO', 'cycle complete');
}

// ---------------------------------------------------------------------------
// Entry: --once | --loop | --dry-run
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const once = args.includes('--once') || dryRun;
const loopMode = args.includes('--loop');
const targetIdx = args.indexOf('--target');
const targetRepo = targetIdx !== -1 ? args[targetIdx + 1] : null;

if (!once && !loopMode) {
  console.log('usage: dream-machine-nightly.mjs --once | --loop | --dry-run [--target <repo-name>]');
  process.exit(0);
}

if (once) {
  runOnce({ dryRun, target: targetRepo }).catch(e => { log('FATAL', e.message); process.exit(1); });
} else {
  // Loop: check once per hour, only run in the nightly window
  const LOOP_INTERVAL = 3600_000; // 1 hour
  let lastNight = '';

  async function tick() {
    const today = new Date().toISOString().slice(0, 10);
    if (!isNightlyWindow()) {
      log('INFO', `outside nightly window (UTC hour ${new Date().getUTCHours()})`);
      return;
    }
    if (lastNight === today) {
      log('INFO', 'already ran tonight');
      return;
    }
    lastNight = today;
    await runOnce();
  }

  log('INFO', 'loop mode — checking hourly');
  tick();
  setInterval(tick, LOOP_INTERVAL);
}
