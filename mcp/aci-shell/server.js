#!/usr/bin/env node
'use strict';

/**
 * ACI Shell MCP — SWE-agent-style Agent-Computer Interface.
 *
 * Five tools: aci.view_file / aci.edit_file / aci.search_repo /
 *             aci.run_tests / aci.submit
 *
 * ADR-020 §Surface 1 | PRD-008 §3.2 | DDD-005
 * Phase 2 / build-next. Manifest gate: [skills.aci_shell] enabled = false
 *
 * Identity scheme per ADR-013:
 *   - WHO:  did:nostr:<hex> (AGENTBOX_AGENT_DID or AGENTBOX_AGENT_PUBKEY)
 *   - WHAT: urn:agentbox:<kind>:<scope>:<local>
 *   - ACI session  → urn:agentbox:thing:<scope>:aci-<short-id>
 *   - Activity     → urn:agentbox:activity:<scope>:aci-<verb>-<short-id>
 *   - Receipt      → urn:agentbox:receipt:<scope>:aci-<session-id>
 *
 * Dev-mode fallback: when AGENTBOX_AGENT_DID / AGENTBOX_AGENT_PUBKEY are
 * not set, owner_did resolves to "did:nostr:local" and scope to "local".
 * This is intentional for local development only; production deployments
 * must set AGENTBOX_AGENT_DID.
 */

const { Server }              = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } =
  require('@modelcontextprotocol/sdk/types.js');

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// ── Identity resolution (ADR-013) ───────────────────────────────────────────
const _rawDid    = process.env.AGENTBOX_AGENT_DID || null;
const _rawPubkey = process.env.AGENTBOX_AGENT_PUBKEY || null;
const OWNER_DID  = _rawDid
  || (_rawPubkey ? `did:nostr:${_rawPubkey}` : 'did:nostr:local');
const SCOPE      = _rawPubkey || (_rawDid && _rawDid.startsWith('did:nostr:')
  ? _rawDid.slice('did:nostr:'.length) : 'local');

// ── Session bootstrap ────────────────────────────────────────────────────────
const SESSION_ID   = crypto.randomBytes(6).toString('hex');
const SESSION_URN  = `urn:agentbox:thing:${SCOPE}:aci-${SESSION_ID}`;
let   _sessionOpen = true;

// ── Configuration from env ───────────────────────────────────────────────────
const WORKSPACE_ROOT    = process.env.ACI_WORKSPACE_ROOT
  || '/home/devuser/workspace/project';
const MAX_VIEW_LINES    = Math.min(
  parseInt(process.env.ACI_MAX_VIEW_LINES || '150', 10), 150);
const MAX_EDIT_CONTEXT  = parseInt(process.env.ACI_MAX_EDIT_CONTEXT || '10', 10);
const ALLOWLIST_RAW     = process.env.ACI_TEST_COMMAND_ALLOWLIST
  || 'pytest,cargo test,npm test,go test';
const ALLOWED_CMDS      = ALLOWLIST_RAW.split(',').map(s => s.trim()).filter(Boolean);

// ── Audit JSONL ──────────────────────────────────────────────────────────────
const AUDIT_ROOT = process.env.ACI_AUDIT_DIR
  || '/var/lib/agentbox/code-harness';

function _ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* best-effort */ }
}

function _auditLog(record) {
  const ymd  = new Date().toISOString().slice(0, 10);
  const file = path.join(AUDIT_ROOT, `aci-${SESSION_ID}-${ymd}.jsonl`);
  _ensureDir(AUDIT_ROOT);
  try {
    fs.appendFileSync(file,
      JSON.stringify({ id: crypto.randomUUID(), ts: new Date().toISOString(), ...record }) + '\n',
      { encoding: 'utf8', mode: 0o600, flag: 'a' });
  } catch (err) {
    process.stderr.write(`[aci-shell] audit append failed: ${err.message}\n`);
  }
}

// ── Privacy filter stub (ADR-008 / ADR-019 D04) ─────────────────────────────
// Applied to test stdout/stderr before any RuVector write.
// Redacts strings that look like secrets (tokens, passwords, DSNs).
function _privacyFilter(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/(?:password|token|secret|key|dsn|conninfo)\s*[:=]\s*\S+/gi, '[REDACTED]')
    .replace(/postgresql:\/\/[^\s]+/gi, 'postgresql://[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}

// ── URN mint helpers (ADR-013) ───────────────────────────────────────────────
function _activityUrn(verb) {
  const id = crypto.randomBytes(6).toString('hex');
  return `urn:agentbox:activity:${SCOPE}:aci-${verb}-${id}`;
}

function _receiptUrn() {
  return `urn:agentbox:receipt:${SCOPE}:aci-${SESSION_ID}`;
}

// ── Activity record builder (mandatory fields per spec) ──────────────────────
function _activityRecord(verb, objectUrn, outcome, extraFields) {
  const now = new Date().toISOString();
  return {
    owner_did:    OWNER_DID,
    action_urn:   _activityUrn(verb),
    action_verb:  verb,
    subject_did:  OWNER_DID,
    object_urn:   objectUrn,
    started_at:   extraFields.started_at || now,
    ended_at:     now,
    outcome,
    session_urn:  SESSION_URN,
    ...extraFields,
  };
}

// ── Path safety check ────────────────────────────────────────────────────────
function _safeResolvePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('path must be a non-empty string');
  }
  const segments = inputPath.split(/[\\/]/);
  if (segments.includes('..')) {
    throw new Error('path traversal rejected: ".." segment detected');
  }
  // If absolute, must be under workspace root
  const resolved = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(WORKSPACE_ROOT, inputPath);
  const workspaceResolved = path.resolve(WORKSPACE_ROOT);
  if (!resolved.startsWith(workspaceResolved + path.sep)
      && resolved !== workspaceResolved) {
    throw new Error(
      `path outside workspace root (${workspaceResolved}): ${resolved}`);
  }
  return resolved;
}

// ── Observability helpers (ADR-020 §Observability) ───────────────────────────
function _logDispatch(tool, fields) {
  const line = JSON.stringify({
    ts: new Date().toISOString(), level: 'info',
    span: `agentbox.mcp.aci_shell.${tool}`,
    tool, session_urn: SESSION_URN, owner_did: OWNER_DID,
    ...fields,
  });
  process.stderr.write(line + '\n');
}

// ── Tool implementations ─────────────────────────────────────────────────────

async function _viewFile(args) {
  const started_at = new Date().toISOString();
  const t0 = Date.now();

  const { path: inputPath, start_line = 1, max_lines = 150 } = args;
  if (typeof max_lines === 'number' && max_lines > 150) {
    throw new Error(`max_lines must not exceed 150 (requested ${max_lines})`);
  }
  const effectiveMaxLines = Math.min(max_lines || 150, 150);

  const absPath = _safeResolvePath(inputPath);
  const raw     = fs.readFileSync(absPath, 'utf8');
  const lines   = raw.split('\n');
  const total   = lines.length;

  const fromLine   = Math.max(1, start_line);
  const toLine     = Math.min(fromLine + effectiveMaxLines - 1, total);
  const slice      = lines.slice(fromLine - 1, toLine);
  const truncated  = toLine < total;
  const content    = slice.join('\n');
  const duration_ms = Date.now() - t0;

  const objectUrn = `urn:agentbox:thing:${SCOPE}:aci-${SESSION_ID}`;
  const activity  = _activityRecord('view', objectUrn, 'ok', {
    started_at, path: inputPath, start_line: fromLine, lines_returned: slice.length,
    // File content is NOT written to audit JSONL by default (ADR-008 exemption:
    // view_file bodies are metadata-only in the audit trail, never RuVector).
    total_lines: total, truncated,
  });
  _auditLog({ tool: 'aci.view_file', ...activity });

  _logDispatch('view_file', {
    path: inputPath, start_line: fromLine, lines_returned: slice.length,
    truncated, total_lines: total, duration_ms, action_urn: activity.action_urn,
  });

  // Prometheus counters — emitted as structured log lines for scraping
  process.stderr.write(JSON.stringify({
    __metric: true,
    name: 'agentbox_aci_calls_total', type: 'counter',
    labels: { tool: 'view_file', outcome: 'ok' }, value: 1,
  }) + '\n');
  process.stderr.write(JSON.stringify({
    __metric: true,
    name: 'agentbox_aci_duration_ms', type: 'histogram',
    labels: { tool: 'view_file' }, value: duration_ms,
  }) + '\n');

  return { content, total_lines: total, truncated };
}

async function _editFile(args) {
  const started_at = new Date().toISOString();
  const t0 = Date.now();

  const { path: inputPath, start_line, end_line, replacement } = args;
  if (typeof start_line !== 'number' || typeof end_line !== 'number') {
    throw new Error('start_line and end_line must be integers');
  }
  if (typeof replacement !== 'string') {
    throw new Error('replacement must be a string');
  }

  const absPath  = _safeResolvePath(inputPath);

  // Atomic write: tmp → fsync → rename
  let raw;
  try { raw = fs.readFileSync(absPath, 'utf8'); }
  catch (_) { raw = ''; }

  const lines = raw === '' ? [] : raw.split('\n');
  const total = lines.length;

  if (start_line > total + 1) {
    return { diff: '', exit_kind: 'oob' };
  }

  const replLines  = replacement.split('\n');
  const before     = lines.slice(0, start_line - 1);
  const after      = lines.slice(end_line);
  const newLines   = [...before, ...replLines, ...after];
  const newContent = newLines.join('\n');

  // Build compact unified diff (≤ MAX_EDIT_CONTEXT context lines)
  const diff = _buildUnifiedDiff(
    lines, newLines, inputPath, MAX_EDIT_CONTEXT);

  // Atomic write
  const tmpPath = absPath + '.aci-tmp-' + crypto.randomBytes(4).toString('hex');
  try {
    fs.writeFileSync(tmpPath, newContent, { encoding: 'utf8', mode: 0o644 });
    const fd = fs.openSync(tmpPath, 'r+');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmpPath, absPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ }
    throw new Error(`atomic write failed: ${err.message}`);
  }

  const duration_ms = Date.now() - t0;
  const objectUrn   = `urn:agentbox:thing:${SCOPE}:aci-${SESSION_ID}`;
  const activity    = _activityRecord('edit', objectUrn, 'ok', {
    started_at, path: inputPath, start_line, end_line,
    lines_changed: Math.abs(newLines.length - total),
  });
  _auditLog({ tool: 'aci.edit_file', diff, ...activity });

  _logDispatch('edit_file', {
    path: inputPath, start_line, end_line, exit_kind: 'ok',
    duration_ms, action_urn: activity.action_urn,
  });

  _emitMetrics('edit_file', 'ok', duration_ms);
  return { diff, exit_kind: 'ok' };
}

async function _searchRepo(args) {
  const started_at = new Date().toISOString();
  const t0 = Date.now();

  const { query, path_glob = '**', max_results = 20 } = args;
  if (!query || typeof query !== 'string') {
    throw new Error('query must be a non-empty string');
  }
  const limit = typeof max_results === 'number' ? max_results : 20;

  // Prefer rg (ripgrep) for speed; fall back to grep
  const { spawn } = require('child_process');
  const hasRg = await _commandExists('rg');
  const [cmd, cmdArgs] = hasRg
    ? ['rg', ['--json', '--max-count', '1', query, WORKSPACE_ROOT]]
    : ['grep', ['-rn', '--include', _globToGrepInclude(path_glob),
        query, WORKSPACE_ROOT]];

  const { stdout, exitCode } = await _spawnCapture(cmd, cmdArgs, {
    cwd: WORKSPACE_ROOT, timeout_ms: 30_000,
  });

  let hits = [];
  let total_found = 0;

  if (hasRg) {
    // rg --json produces one JSON obj per line
    const jsonLines = stdout.split('\n').filter(l => l.trim());
    for (const line of jsonLines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'match') {
          total_found++;
          if (hits.length < limit) {
            hits.push({
              path:    path.relative(WORKSPACE_ROOT, obj.data.path.text),
              line:    obj.data.line_number,
              snippet: (obj.data.lines.text || '').trim().slice(0, 200),
            });
          }
        }
      } catch (_) { /* skip malformed line */ }
    }
  } else {
    // grep -n output: path:line:text
    const grepLines = stdout.split('\n').filter(l => l.trim());
    total_found = grepLines.length;
    for (const gl of grepLines.slice(0, limit)) {
      const m = gl.match(/^([^:]+):(\d+):(.*)/);
      if (m) {
        hits.push({
          path:    path.relative(WORKSPACE_ROOT, m[1]),
          line:    parseInt(m[2], 10),
          snippet: m[3].trim().slice(0, 200),
        });
      }
    }
  }

  const truncated   = hits.length < total_found;
  const duration_ms = Date.now() - t0;
  const objectUrn   = `urn:agentbox:thing:${SCOPE}:aci-${SESSION_ID}`;
  const activity    = _activityRecord('search', objectUrn, 'ok', {
    started_at, query, path_glob, hits_returned: hits.length, total_found, truncated,
  });
  _auditLog({ tool: 'aci.search_repo', ...activity });

  _logDispatch('search_repo', {
    query, path_glob, hits_returned: hits.length, total_found, truncated,
    duration_ms, action_urn: activity.action_urn,
  });

  _emitMetrics('search_repo', 'ok', duration_ms);
  return { hits, total_found, truncated };
}

async function _runTests(args) {
  const started_at = new Date().toISOString();
  const t0 = Date.now();

  const { command, timeout_s = 300 } = args;
  if (!command || typeof command !== 'string') {
    throw new Error('command must be a non-empty string');
  }

  // Allowlist validation
  const allowed = ALLOWED_CMDS.some(pat => {
    const regex = new RegExp('^' + pat.replace(/[.*+?^${}()|[\]\\]/g, m => m === '*' ? '.*' : '\\' + m) + '( .*)?$');
    return regex.test(command);
  });
  if (!allowed) {
    throw new Error(
      `command not in allowlist. Allowed: ${ALLOWED_CMDS.join(', ')}. Got: ${command}`);
  }

  const timeout_ms = Math.min(timeout_s * 1000, 600_000);

  // Parse command into argv
  const parts = _parseCommandLine(command);
  const traceId = crypto.randomBytes(6).toString('hex');
  const traceUrn = `urn:agentbox:activity:${SCOPE}:aci-test-${traceId}`;

  // Minimal env (no secrets leakage)
  const safeEnv = {
    PATH: process.env.PATH || '/usr/bin:/bin:/usr/local/bin',
    HOME: process.env.HOME || '/home/devuser',
    LANG: process.env.LANG || 'en_US.UTF-8',
  };

  let exitCode, stdout, stderr, duration_ms;
  try {
    const result = await _spawnCapture(parts[0], parts.slice(1), {
      cwd: WORKSPACE_ROOT,
      env: safeEnv,
      timeout_ms,
    });
    exitCode    = result.exitCode;
    stdout      = _privacyFilter(result.stdout);
    stderr      = _privacyFilter(result.stderr);
    duration_ms = Date.now() - t0;
  } catch (err) {
    exitCode    = -1;
    stdout      = '';
    stderr      = _privacyFilter(err.message || String(err));
    duration_ms = Date.now() - t0;
  }

  const outcome = exitCode === 0 ? 'ok' : 'error';
  const activity = _activityRecord('test', traceUrn, outcome, {
    started_at, command, exit_code: exitCode, duration_ms, trace_urn: traceUrn,
  });
  _auditLog({ tool: 'aci.run_tests', stdout_len: stdout.length, stderr_len: stderr.length, ...activity });

  _logDispatch('run_tests', {
    command, exit_code: exitCode, duration_ms, trace_urn: traceUrn,
    action_urn: activity.action_urn, exit_kind: outcome,
  });

  _emitMetrics('run_tests', outcome, duration_ms);
  return { stdout, stderr, exit_code: exitCode, duration_ms, trace_urn: traceUrn };
}

async function _submit(args) {
  const started_at = new Date().toISOString();
  const t0 = Date.now();

  const { summary } = args;
  if (!summary || typeof summary !== 'string') {
    throw new Error('summary must be a non-empty string');
  }
  if (!_sessionOpen) {
    throw new Error('ACI session already submitted');
  }
  _sessionOpen = false;

  const receiptUrn    = _receiptUrn();
  const submissionId  = `aci-${SESSION_ID}`;
  const duration_ms   = Date.now() - t0;

  // Sentinel file for ExpeL consumption (ADR-019)
  const sentinelDir  = '/var/lib/agentbox/code-harness/aci-submissions';
  const sentinelPath = path.join(sentinelDir, `${submissionId}.json`);
  _ensureDir(sentinelDir);
  try {
    fs.writeFileSync(sentinelPath, JSON.stringify({
      submission_id: submissionId,
      session_urn:   SESSION_URN,
      receipt_urn:   receiptUrn,
      owner_did:     OWNER_DID,
      summary,
      terminal:      true,
      submitted_at:  new Date().toISOString(),
    }, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    process.stderr.write(`[aci-shell] sentinel write failed: ${err.message}\n`);
  }

  const activity = _activityRecord('submit', receiptUrn, 'ok', {
    started_at, summary, receipt_urn: receiptUrn,
  });
  _auditLog({ tool: 'aci.submit', ...activity });

  _logDispatch('submit', {
    submission_id: submissionId, receipt_urn: receiptUrn,
    duration_ms, action_urn: activity.action_urn,
  });

  _emitMetrics('submit', 'ok', duration_ms);
  return { submission_id: submissionId, status: 'closed', receipt_urn: receiptUrn };
}

// ── Tool list ────────────────────────────────────────────────────────────────
const TOOL_LIST = [
  {
    name: 'aci.view_file',
    description: 'Read a bounded window of a file (hard cap: 150 lines per call). Returns content, total line count, and truncation flag. File paths must be under ACI_WORKSPACE_ROOT.',
    inputSchema: {
      type: 'object',
      properties: {
        path:       { type: 'string', description: 'File path (absolute under workspace root, or relative to it).' },
        start_line: { type: 'integer', minimum: 1, default: 1, description: 'First line to return (1-indexed).' },
        max_lines:  { type: 'integer', minimum: 1, maximum: 150, default: 150, description: 'Max lines to return. Must not exceed 150.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'aci.edit_file',
    description: 'Replace lines [start_line, end_line] with replacement text. Atomic write (tmp/fsync/rename). Returns compact unified diff (≤10 context lines) and exit_kind.',
    inputSchema: {
      type: 'object',
      properties: {
        path:        { type: 'string', description: 'File path to edit.' },
        start_line:  { type: 'integer', minimum: 1, description: 'First line of the region to replace (1-indexed, inclusive).' },
        end_line:    { type: 'integer', minimum: 1, description: 'Last line of the region to replace (1-indexed, inclusive).' },
        replacement: { type: 'string', description: 'Text to substitute in place of [start_line, end_line].' },
      },
      required: ['path', 'start_line', 'end_line', 'replacement'],
    },
  },
  {
    name: 'aci.search_repo',
    description: 'Search the repo for a pattern (rg preferred, grep fallback). Returns up to max_results hits with path, line number, and snippet. Reports total_found so agent can detect budget truncation.',
    inputSchema: {
      type: 'object',
      properties: {
        query:       { type: 'string', description: 'Search pattern (regex).' },
        path_glob:   { type: 'string', default: '**', description: 'File glob filter (e.g. "**/*.py").' },
        max_results: { type: 'integer', minimum: 1, maximum: 500, default: 20, description: 'Max hits to return.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'aci.run_tests',
    description: 'Run an allowlisted test command in a fresh subprocess (cwd=ACI_WORKSPACE_ROOT, stripped env). Allowlist: pytest, cargo test, npm test, go test. Returns stdout/stderr (privacy-filtered), exit_code, duration, and trace_urn.',
    inputSchema: {
      type: 'object',
      properties: {
        command:   { type: 'string', description: 'Test command to run. Must match allowlist regex.' },
        timeout_s: { type: 'integer', minimum: 1, maximum: 600, default: 300, description: 'Max execution time in seconds.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'aci.submit',
    description: 'Close the ACI session and emit a receipt URN. Writes an ExpeL sentinel file marking the trajectory terminal. Call once per session when the task is complete.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Human-readable summary of what was done.' },
      },
      required: ['summary'],
    },
  },
];

// ── MCP server wiring ────────────────────────────────────────────────────────
const server = new Server(
  { name: 'aci-shell', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_LIST }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    let result;
    if      (name === 'aci.view_file')   result = await _viewFile(args);
    else if (name === 'aci.edit_file')   result = await _editFile(args);
    else if (name === 'aci.search_repo') result = await _searchRepo(args);
    else if (name === 'aci.run_tests')   result = await _runTests(args);
    else if (name === 'aci.submit')      result = await _submit(args);
    else throw new Error(`unknown tool: ${name}`);

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const outcome = 'error';
    _logDispatch(name.replace('aci.', ''), {
      error: err.message, exit_kind: outcome,
    });
    _emitMetrics(name.replace('aci.', ''), outcome, 0);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        ok: false, tool: name,
        error: err.message || String(err),
        session_urn: SESSION_URN,
        owner_did: OWNER_DID,
      }, null, 2) }],
      isError: true,
    };
  }
});

// ── Utility functions ────────────────────────────────────────────────────────

function _emitMetrics(tool, outcome, duration_ms) {
  process.stderr.write(JSON.stringify({
    __metric: true, name: 'agentbox_aci_calls_total', type: 'counter',
    labels: { tool, outcome }, value: 1,
  }) + '\n');
  if (duration_ms > 0) {
    process.stderr.write(JSON.stringify({
      __metric: true, name: 'agentbox_aci_duration_ms', type: 'histogram',
      labels: { tool }, value: duration_ms,
    }) + '\n');
  }
}

function _globToGrepInclude(glob) {
  // Very simple: "**/*.py" -> "*.py"; fall back to "*"
  const m = glob.match(/\*\*\/(.+)/);
  return m ? m[1] : '*';
}

function _commandExists(cmd) {
  const { execFileSync } = require('child_process');
  try { execFileSync('which', [cmd], { stdio: 'pipe' }); return true; }
  catch (_) { return false; }
}

function _parseCommandLine(cmd) {
  // Naive tokeniser: split on spaces, respecting quoted strings
  const tokens = [];
  let current  = '';
  let inQuote  = false;
  let quoteChar = '';
  for (const ch of cmd) {
    if (inQuote) {
      if (ch === quoteChar) { inQuote = false; }
      else { current += ch; }
    } else if (ch === '"' || ch === "'") {
      inQuote = true; quoteChar = ch;
    } else if (ch === ' ') {
      if (current) { tokens.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function _spawnCapture(cmd, cmdArgs, opts) {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const timeout_ms = opts.timeout_ms || 30_000;
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn(cmd, cmdArgs, {
      cwd:   opts.cwd || WORKSPACE_ROOT,
      env:   opts.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
    }, timeout_ms);

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: killed ? stderr + '\n[TIMEOUT]' : stderr,
        exitCode: killed ? -1 : (code || 0),
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout: '', stderr: err.message, exitCode: -1 });
    });
  });
}

function _buildUnifiedDiff(oldLines, newLines, filePath, ctxLines) {
  // Minimal Myers-diff-like unified diff. Simplified for correctness, not perf.
  // Context window capped at ctxLines per ADR-020 §Decision.
  const ctx    = Math.min(ctxLines, MAX_EDIT_CONTEXT);
  const header = `--- a/${filePath}\n+++ b/${filePath}\n`;
  const chunks  = [];

  // Find changed ranges
  let i = 0;
  const ranges = [];
  while (i < Math.max(oldLines.length, newLines.length)) {
    if (oldLines[i] !== newLines[i]) {
      const start = i;
      while (i < Math.max(oldLines.length, newLines.length)
             && oldLines[i] !== newLines[i]) i++;
      ranges.push([start, i]);
    } else {
      i++;
    }
  }

  for (const [rStart, rEnd] of ranges) {
    const ctxStart  = Math.max(0, rStart - ctx);
    const oldCtxEnd = Math.min(oldLines.length, rEnd + ctx);
    const newCtxEnd = Math.min(newLines.length, rEnd + ctx);

    const oldCount = oldCtxEnd - ctxStart;
    const newCount = newCtxEnd - ctxStart;

    let hunk = `@@ -${ctxStart + 1},${oldCount} +${ctxStart + 1},${newCount} @@\n`;
    for (let j = ctxStart; j < Math.max(oldCtxEnd, newCtxEnd); j++) {
      if (j < rStart || j >= rEnd) {
        const line = j < oldLines.length ? oldLines[j] : newLines[j];
        hunk += ` ${line}\n`;
      } else {
        if (j < oldLines.length) hunk += `-${oldLines[j]}\n`;
        if (j < newLines.length) hunk += `+${newLines[j]}\n`;
      }
    }
    chunks.push(hunk);
  }

  return chunks.length > 0 ? header + chunks.join('') : '';
}

// ── Entry point ──────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[aci-shell] ready | session=${SESSION_ID} | workspace=${WORKSPACE_ROOT} | owner_did=${OWNER_DID}\n`);
}

main().catch(err => {
  process.stderr.write(`[aci-shell] fatal: ${err.message}\n`);
  process.exit(1);
});
