'use strict';

/**
 * ADR-2144 — the activity-sink hook (config/hooks/activity-sink.cjs) and its
 * root-session registration block (config/entrypoint-unified.sh, <<'ASJS').
 *
 *   • PostToolUse / UserPromptSubmit / Stop produce the wire body
 *     {actor, kind, event, tool, paths, text, ts_ms, session_id} with a bearer header;
 *   • text is redacted BEFORE it is truncated to 2 KiB (UTF-8 safe);
 *   • untracked tools (Bash) and an empty URL send nothing;
 *   • a sink that never answers cannot hold the turn: exit 0 within 1.5 s;
 *   • nothing is ever written to stdout (UserPromptSubmit stdout reaches the model);
 *   • AGENTBOX_EGRESS=0 and AGENTBOX_EGRESS_REDACTION=0 stop the route;
 *   • the registration block self-heals a stale entry, never inlines the token
 *     value, and retracts everything when the gate is off.
 *
 * The per-profile projection is covered by `cargo test` in
 * services/agentbox-manifest (stacks::tests::activity_sink_*).
 *
 * Children are spawned ASYNC: spawnSync would block this process's event loop,
 * so the in-process stub server could never answer and every case would look
 * like a timeout.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const HOOK = path.join(ROOT, 'config/hooks/activity-sink.cjs');
const ENTRY = fs.readFileSync(path.join(ROOT, 'config/entrypoint-unified.sh'), 'utf8');
const TOKEN = 'test-token-0123456789abcdef';

function scratch(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `actsink-${name}-`));
}

/** Run the hook with `payload` on stdin. Resolves {code, stdout, stderr, ms}. */
function runHook(payload, env, argv = []) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('node', [HOOK, ...argv], {
      env: { PATH: process.env.PATH, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr, ms: Date.now() - t0 }));
    child.stdin.on('error', () => {});
    child.stdin.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  });
}

/** A stub sink recording every request. `respond=false` accepts and never answers. */
function startSink({ respond = true } = {}) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (respond) { res.writeHead(202); res.end(); }
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/ingest/v1/activity`;
      resolve({
        url,
        requests,
        close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
      });
    });
  });
}

describe('activity-sink hook — wire contract', () => {
  let sink;
  let dir;
  let tokenFile;
  beforeAll(async () => {
    sink = await startSink();
    dir = scratch('wire');
    tokenFile = path.join(dir, 'token');
    fs.writeFileSync(tokenFile, `${TOKEN}\n`);
  });
  afterAll(async () => { await sink.close(); });
  beforeEach(() => { sink.requests.length = 0; });

  const env = () => ({ ACTIVITY_SINK_URL: sink.url, ACTIVITY_SINK_TOKEN_FILE: tokenFile });

  test('PostToolUse on Edit posts the absolute file path with the bearer token', async () => {
    const r = await runHook({
      hook_event_name: 'PostToolUse',
      session_id: 'abcdef12-3456-7890-abcd-ef1234567890',
      cwd: '/home/devuser/workspace/project',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/main.rs', old_string: 'a', new_string: 'b' },
    }, env());
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(sink.requests).toHaveLength(1);
    const req = sink.requests[0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/ingest/v1/activity');
    expect(req.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(req.headers['content-type']).toBe('application/json');
    const body = JSON.parse(req.body);
    expect(Object.keys(body).sort()).toEqual(
      ['actor', 'event', 'kind', 'paths', 'session_id', 'text', 'tool', 'ts_ms'],
    );
    expect(body).toMatchObject({
      actor: 'claude:abcdef12',
      kind: 'agent',
      event: 'post_tool_use',
      tool: 'Edit',
      paths: ['/home/devuser/workspace/project/src/main.rs'],
      text: null,
      session_id: 'abcdef12-3456-7890-abcd-ef1234567890',
    });
    expect(typeof body.ts_ms).toBe('number');
    expect(Math.abs(Date.now() - body.ts_ms)).toBeLessThan(10000);
  });

  test('NotebookEdit, Grep (path) and Glob (cwd fallback) resolve their paths; the actor honours the override', async () => {
    const base = { hook_event_name: 'PostToolUse', session_id: 's1', cwd: '/w' };
    await runHook({ ...base, tool_name: 'NotebookEdit', tool_input: { notebook_path: '/w/n.ipynb' } },
      { ...env(), ACTIVITY_SINK_ACTOR: 'rust-builder' });
    await runHook({ ...base, tool_name: 'Grep', tool_input: { pattern: 'x', path: 'crates' } }, env());
    await runHook({ ...base, tool_name: 'Glob', tool_input: { pattern: '**/*.rs' } }, env());
    const bodies = sink.requests.map((q) => JSON.parse(q.body));
    expect(bodies.map((b) => [b.tool, b.paths])).toEqual([
      ['NotebookEdit', ['/w/n.ipynb']],
      ['Grep', ['/w/crates']],
      ['Glob', ['/w']],
    ]);
    expect(bodies[0].actor).toBe('rust-builder:s1');
  });

  test('Bash and other untracked tools post nothing', async () => {
    const r = await runHook({
      hook_event_name: 'PostToolUse', session_id: 's', cwd: '/w',
      tool_name: 'Bash', tool_input: { command: 'cat /etc/passwd' },
    }, env());
    expect(r.code).toBe(0);
    expect(sink.requests).toHaveLength(0);
  });

  test('UserPromptSubmit redacts, then truncates to 2 KiB without splitting a character', async () => {
    const prompt = 'please use password=hunter2 and Bearer sk-live-abc123 ' + 'é'.repeat(3000);
    const r = await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt }, env());
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    const body = JSON.parse(sink.requests[0].body);
    expect(body.event).toBe('user_prompt');
    expect(body.tool).toBeNull();
    expect(body.paths).toEqual([]);
    expect(body.text).not.toContain('hunter2');
    expect(body.text).not.toContain('sk-live-abc123');
    expect(body.text).toContain('<redacted>');
    expect(Buffer.byteLength(body.text, 'utf8')).toBeLessThanOrEqual(2048);
    expect(Buffer.byteLength(body.text, 'utf8')).toBeGreaterThan(2040);
    expect(body.text).not.toContain('�'); // no half character at the cut
  });

  test('a secret straddling the 2 KiB boundary is redacted, not half-kept (redact BEFORE truncate)', async () => {
    // The quoted-JSON rule needs the closing quote, which lies past byte 2048: if
    // the hook truncated first, the rule would not match and the head of the
    // secret would leave. Only redact-then-truncate keeps this green.
    const prompt = 'x'.repeat(2000) + ' {"password": "' + 'S3cr3tV4lue'.repeat(10) + '"}';
    await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt }, env());
    const body = JSON.parse(sink.requests[0].body);
    expect(body.text).not.toContain('S3cr3t');
  });

  test('Stop posts the last assistant text from the transcript, redacted', async () => {
    const tp = path.join(dir, 'transcript.jsonl');
    fs.writeFileSync(tp, [
      JSON.stringify({ message: { role: 'user', content: 'hi' } }),
      JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] } }),
      JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read' }] } }),
      JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'Done. Set API_KEY=sk-123456 in .env' }] } }),
      '',
    ].join('\n'));
    const r = await runHook({ hook_event_name: 'Stop', session_id: 'sess-9', transcript_path: tp }, env());
    expect(r.code).toBe(0);
    const body = JSON.parse(sink.requests[0].body);
    expect(body).toMatchObject({ event: 'stop', tool: null, paths: [], session_id: 'sess-9' });
    expect(body.text).toBe('Done. Set API_KEY=<redacted> in .env');
  });

  test('the event name falls back to argv when the payload lacks hook_event_name', async () => {
    await runHook({ session_id: 's', prompt: 'hello' }, env(), ['UserPromptSubmit']);
    expect(JSON.parse(sink.requests[0].body).event).toBe('user_prompt');
  });

  test('ACTIVITY_SINK_EVENTS narrows what is posted', async () => {
    await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'hello' },
      { ...env(), ACTIVITY_SINK_EVENTS: 'post_tool_use,stop' });
    expect(sink.requests).toHaveLength(0);
  });

  test('the token may come from a named env var instead of a file', async () => {
    await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'hello' },
      { ACTIVITY_SINK_URL: sink.url, ACTIVITY_SINK_TOKEN_ENV: 'MY_SINK_TOKEN', MY_SINK_TOKEN: 'from-env' });
    expect(sink.requests[0].headers.authorization).toBe('Bearer from-env');
  });

  test('no token → nothing sent (never an unauthenticated post)', async () => {
    const r = await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'hello' },
      { ACTIVITY_SINK_URL: sink.url, ACTIVITY_SINK_TOKEN_FILE: path.join(dir, 'absent') });
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/no bearer token/);
    expect(sink.requests).toHaveLength(0);
  });

  test('empty URL → no request and no stdin dependency', async () => {
    const r = await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'hello' },
      { ACTIVITY_SINK_URL: '', ACTIVITY_SINK_TOKEN_FILE: tokenFile });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(sink.requests).toHaveLength(0);
  });

  test('AGENTBOX_EGRESS=0 and AGENTBOX_EGRESS_REDACTION=0 stop the route', async () => {
    const p = { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'hello' };
    const a = await runHook(p, { ...env(), AGENTBOX_EGRESS: '0' });
    const b = await runHook(p, { ...env(), AGENTBOX_EGRESS_REDACTION: '0' });
    expect(a.stderr).toMatch(/egress-globally-disabled/);
    expect(b.stderr).toMatch(/redaction-disabled/);
    expect(sink.requests).toHaveLength(0);
  });

  test('garbage on stdin exits 0 quietly', async () => {
    const r = await runHook('not json{', env());
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(sink.requests).toHaveLength(0);
  });
});

describe('activity-sink hook — transport guard (no bearer token over public plaintext)', () => {
  const { transportAllowed } = require(HOOK);

  test.each([
    ['http://codescape:4101/ingest/v1/activity', true],      // compose service name
    ['http://visionclaw_container:4101/ingest/v1/activity', true],
    ['http://localhost:4101/x', true],
    ['http://127.0.0.1:4101/x', true],
    ['http://[::1]:4101/x', true],
    ['http://10.0.0.5/x', true],
    ['http://172.16.0.1/x', true],
    ['http://192.168.2.132:4101/x', true],
    ['https://sink.example.com/ingest/v1/activity', true],   // https public
    ['https://8.8.8.8/x', true],
    ['http://sink.example.com/ingest/v1/activity', false],   // http public FQDN
    ['http://8.8.8.8/x', false],
    ['http://172.32.0.1/x', false],
    ['http://localhost.evil.example/x', false],
    ['http://[2001:db8::1]/x', false],
    ['ftp://codescape/x', false],
    ['not a url', false],
  ])('%s → allowed=%s', (url, ok) => {
    expect(transportAllowed(url).ok).toBe(ok);
  });

  test('http to a public host sends nothing, logs one line, and never names the token or credentials', async () => {
    const dir = scratch('public');
    const tokenFile = path.join(dir, 'token');
    fs.writeFileSync(tokenFile, `${TOKEN}\n`);
    const r = await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'hello' },
      { ACTIVITY_SINK_URL: 'http://user:hunter2@sink.example.com/ingest/v1/activity', ACTIVITY_SINK_TOKEN_FILE: tokenFile });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.ms).toBeLessThan(1500);
    const lines = r.stderr.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/refused: plaintext-http-to-public-host \(sink\.example\.com\)/);
    expect(r.stderr).not.toContain(TOKEN);
    expect(r.stderr).not.toContain('hunter2');
  });
});

describe('activity-sink hook — the token is never logged', () => {
  test('across timeout, refusal, error-status and unreadable-file paths', async () => {
    const dir = scratch('nolog');
    const tokenFile = path.join(dir, 'token');
    fs.writeFileSync(tokenFile, `${TOKEN}\r\n`); // trailing CRLF tolerated
    const sink = await startSink({ respond: false });
    const reject = http.createServer((req, res) => { req.resume(); res.writeHead(401); res.end(TOKEN); });
    await new Promise((r) => reject.listen(0, '127.0.0.1', r));
    const p = { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: `my token is ${TOKEN}` };
    try {
      const runs = await Promise.all([
        runHook(p, { ACTIVITY_SINK_URL: sink.url, ACTIVITY_SINK_TOKEN_FILE: tokenFile }),
        runHook(p, { ACTIVITY_SINK_URL: `http://127.0.0.1:${reject.address().port}/x`, ACTIVITY_SINK_TOKEN_FILE: tokenFile }),
        runHook(p, { ACTIVITY_SINK_URL: 'http://127.0.0.1:1/x', ACTIVITY_SINK_TOKEN_FILE: tokenFile }),
        runHook(p, { ACTIVITY_SINK_URL: sink.url, ACTIVITY_SINK_TOKEN_FILE: path.join(dir, 'absent'), ACTIVITY_SINK_TOKEN_ENV: 'NOPE' }),
      ]);
      for (const r of runs) {
        expect(r.code).toBe(0);
        expect(r.stdout).toBe('');
        expect(r.stderr).not.toContain(TOKEN);
      }
      expect(runs[0].stderr).toMatch(/timeout/);
      expect(runs[1].stderr).toMatch(/→ 401/);
      // The CRLF-terminated file still yields the exact token on the wire.
      expect(sink.requests[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    } finally {
      await sink.close();
      await new Promise((r) => reject.close(r));
    }
  });
});

describe('activity-sink hook — never holds the turn', () => {
  test('a sink that accepts and never answers: exit 0 within 1.5 s', async () => {
    const hang = await startSink({ respond: false });
    const dir = scratch('hang');
    const tokenFile = path.join(dir, 'token');
    fs.writeFileSync(tokenFile, TOKEN);
    try {
      const r = await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'hello' },
        { ACTIVITY_SINK_URL: hang.url, ACTIVITY_SINK_TOKEN_FILE: tokenFile });
      expect(r.code).toBe(0);
      expect(r.stdout).toBe('');
      expect(r.ms).toBeLessThan(1500);
      expect(r.stderr).toMatch(/timeout/);
      expect(hang.requests.length).toBeLessThanOrEqual(1);
    } finally {
      await hang.close();
    }
  });

  test('an unreachable sink fails open', async () => {
    const dir = scratch('refused');
    const tokenFile = path.join(dir, 'token');
    fs.writeFileSync(tokenFile, TOKEN);
    const r = await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'hello' },
      { ACTIVITY_SINK_URL: 'http://127.0.0.1:1/x', ACTIVITY_SINK_TOKEN_FILE: tokenFile });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.ms).toBeLessThan(1500);
  });
});

describe('root-session registration block (<<\'ASJS\')', () => {
  const start = ENTRY.indexOf("node <<'ASJS'");
  const js = ENTRY.slice(ENTRY.indexOf('\n', start) + 1, ENTRY.indexOf('\nASJS\n', start));

  function project(settingsPath, vars) {
    return new Promise((resolve) => {
      const child = spawn('node', ['-e', js], {
        env: { PATH: process.env.PATH, SETTINGS: settingsPath, AS_HOOK: '/opt/agentbox/config/hooks/activity-sink.cjs', ...vars },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', (code) => resolve({ code, out }));
    });
  }
  const sinkCmds = (s) => Object.entries(s.hooks || {}).flatMap(([evt, groups]) =>
    groups.flatMap((g) => (g.hooks || []).filter((h) => String(h.command).includes('activity-sink.cjs'))
      .map((h) => ({ evt, matcher: g.matcher, command: h.command, timeout: h.timeout }))));

  test('the block exists and runs before the governed reconcile', () => {
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(ENTRY.indexOf('agentbox-manifest hooks-reconcile'));
  });

  test('on: registers the selected events, inlines only the token PATH, and self-heals a stale url', async () => {
    const dir = scratch('reg');
    const f = path.join(dir, 'settings.json');
    // A stale registration from an earlier boot (old url, wrong event) plus a foreign hook.
    fs.writeFileSync(f, JSON.stringify({ hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'node other.cjs' }] }],
      PreToolUse: [{ hooks: [{ type: 'command', command: "ACTIVITY_SINK_URL='http://old' node activity-sink.cjs PreToolUse" }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: "ACTIVITY_SINK_URL='http://old' node /x/activity-sink.cjs UserPromptSubmit || true", timeout: 3 }] }],
    } }, null, 2));
    const vars = {
      AS_ON: '1', AS_URL: 'http://sink:4101/ingest/v1/activity',
      AS_TOKEN_FILE: '/home/devuser/.config/activity-sink/token', AS_EVENTS: '[post_tool_use, stop]',
    };
    const r = await project(f, vars);
    expect(r.code).toBe(0);
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    const cmds = sinkCmds(s);
    // The UserPromptSubmit entry is gone (not selected); PreToolUse is not an event this block owns,
    // so the stale PreToolUse entry is left for hooks-reconcile (no own row lists PreToolUse).
    expect(cmds.filter((c) => c.evt !== 'PreToolUse').map((c) => c.evt).sort()).toEqual(['PostToolUse', 'Stop']);
    const post = cmds.find((c) => c.evt === 'PostToolUse');
    expect(post.matcher).toBe('Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Glob');
    expect(post.timeout).toBe(3);
    expect(post.command).toBe(
      "ACTIVITY_SINK_URL='http://sink:4101/ingest/v1/activity' ACTIVITY_SINK_EVENTS=post_tool_use,stop " +
      "ACTIVITY_SINK_TOKEN_FILE='/home/devuser/.config/activity-sink/token' " +
      'node /opt/agentbox/config/hooks/activity-sink.cjs PostToolUse || true',
    );
    expect(JSON.stringify(s)).not.toContain('http://old\' node /x');
    expect(s.hooks.Stop[0].hooks[0].command).toBe('node other.cjs');
    // Idempotent: a second boot changes nothing.
    const before = fs.readFileSync(f, 'utf8');
    const again = await project(f, vars);
    expect(again.out).toMatch(/already registered/);
    expect(fs.readFileSync(f, 'utf8')).toBe(before);
  });

  test('enabled with an unusable url registers nothing', async () => {
    const dir = scratch('badurl');
    const f = path.join(dir, 'settings.json');
    fs.writeFileSync(f, '{}');
    const r = await project(f, { AS_ON: '1', AS_URL: "http://x/'; rm -rf ~; '" });
    expect(r.out).toMatch(/not registered/);
    expect(sinkCmds(JSON.parse(fs.readFileSync(f, 'utf8')))).toHaveLength(0);
    const ml = await project(f, { AS_ON: '1', AS_URL: 'http://sink/a', AS_TOKEN_FILE: '/t', AS_EVENTS: '[' });
    expect(ml.out).toMatch(/events must be a single-line array/);
    expect(sinkCmds(JSON.parse(fs.readFileSync(f, 'utf8')))).toHaveLength(0);
  });

  test('off: retracts every registration and leaves a clean file untouched', async () => {
    const dir = scratch('off');
    const f = path.join(dir, 'settings.json');
    await project(f, { AS_ON: '1', AS_URL: 'http://sink/a', AS_TOKEN_FILE: '/t' });
    expect(sinkCmds(JSON.parse(fs.readFileSync(f, 'utf8')))).toHaveLength(3);
    await project(f, { AS_ON: '0' });
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    expect(sinkCmds(s)).toHaveLength(0);
    expect(s.hooks).toEqual({});
    const clean = '{\n  "model": "x"\n}';
    fs.writeFileSync(f, clean);
    await project(f, { AS_ON: '0' });
    expect(fs.readFileSync(f, 'utf8')).toBe(clean);
  });
});
