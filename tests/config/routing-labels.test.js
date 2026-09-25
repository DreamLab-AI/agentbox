'use strict';

/**
 * ADR-2110 (proposed) — the routing label recorder.
 *
 * Pure rules are tested on the library; the hook is run as a subprocess against a
 * fake embeddings server on 127.0.0.1 and an unreachable database, so nothing here
 * touches the shared sidecar. The contract:
 *
 *   • off by default: no AGENTBOX_ROUTING_LABELS=1 ⇒ nothing read, nothing embedded;
 *   • a turn's label is the first ROUTABLE skill the main model loaded before the next
 *     real prompt (Skill tool or Read of a SKILL.md; a shell read is inspection), else
 *     `other` / `none`; harness-injected user records are not prompts;
 *   • an email-gateway turn is never embedded (taint fence);
 *   • a non-LAN embeddings endpoint is refused before any request (no prompt egress);
 *   • the persisted row carries no prompt text;
 *   • the watermark advances only after a durable write.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const L = require(path.resolve(__dirname, '../../config/hooks/lib/routing-labels.cjs'));
const { isLanUrl } = require(path.resolve(__dirname, '../../config/hooks/routing-label-recorder.cjs'));
const HOOK = path.resolve(__dirname, '../../config/hooks/routing-label-recorder.cjs');

const user = (text, extra = {}) => JSON.stringify({ type: 'user', uuid: `u-${text.length}-${Math.random()}`, timestamp: '2026-09-23T17:00:00.000Z', message: { content: text }, ...extra });
const tool = (name, input, extra = {}) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] }, ...extra });
const PROMPT_A = 'please write a deep fact-checked research report on heat pump grants';
const PROMPT_B = 'now render the result as a mermaid architecture diagram for the repo';

describe('library rules', () => {
  test('skills are recognised from the Skill tool, a Read of SKILL.md and a shell read', () => {
    expect(L.loadedSkill({ type: 'tool_use', name: 'Skill', input: { skill: 'anthropic-skills:docx' } })).toEqual({ name: 'docx', via: 'skill' });
    expect(L.loadedSkill({ type: 'tool_use', name: 'Read', input: { file_path: '/opt/agentbox/skills/deep-research/SKILL.md' } })).toEqual({ name: 'deep-research', via: 'read' });
    expect(L.loadedSkill({ type: 'tool_use', name: 'Bash', input: { command: 'cat /opt/agentbox/skills/blender/SKILL.md' } })).toEqual({ name: 'blender', via: 'shell' });
    expect(L.loadedSkill({ type: 'tool_use', name: 'Read', input: { file_path: '/opt/agentbox/skills/blender/README.md' } })).toBeNull();
  });

  test('turns split on real prompts; notifications, tool results and sidechains are not prompts', () => {
    const lines = [
      user(PROMPT_A),
      tool('Read', { file_path: '/opt/agentbox/skills/deep-research/SKILL.md' }),
      user('<task-notification> background task finished </task-notification>'),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }),
      tool('Skill', { skill: 'web-researcher' }),
      tool('Skill', { skill: 'blender' }, { isSidechain: true }),
      user(PROMPT_B),
      user('thanks'),
    ];
    const { turns, lineCount } = L.extractTurns(lines);
    expect(lineCount).toBe(8);
    expect(turns.map((t) => t.text)).toEqual([PROMPT_A, PROMPT_B]); // 'thanks' is under min chars
    expect(turns[0].loads).toEqual(['deep-research', 'web-researcher']);
    expect(turns[0].via).toEqual(['read', 'skill']);
    expect(turns[1].loads).toEqual([]);
  });

  test('the watermark excludes earlier turns but loads still attribute to their own turn', () => {
    const lines = [user(PROMPT_A), tool('Skill', { skill: 'x' }), user(PROMPT_B), tool('Skill', { skill: 'blender' })];
    const { turns } = L.extractTurns(lines, 2);
    expect(turns).toHaveLength(1);
    expect(turns[0].loads).toEqual(['blender']);
  });

  test('labels: first routable load, else other, else none', () => {
    const c = { 'deep-research': 'r', blender: 'b' };
    expect(L.labelOf(['docx', 'deep-research', 'blender'], c)).toBe('deep-research');
    expect(L.labelOf(['docx'], c)).toBe('other');
    expect(L.labelOf([], c)).toBe('none');
  });

  test('a shell read is inspection: recorded, never the label — unless the same skill is then used', () => {
    const c = { 'deep-research': 'r' };
    const inspect = L.extractTurns([user(PROMPT_A), tool('Bash', { command: 'head -20 /opt/agentbox/skills/deep-research/SKILL.md' })]).turns[0];
    expect(inspect.loads).toEqual(['deep-research']);
    expect(L.labelOf(inspect.loads, c, inspect.via)).toBe('none');
    const used = L.extractTurns([user(PROMPT_A), tool('Bash', { command: 'head /opt/agentbox/skills/deep-research/SKILL.md' }),
      tool('Read', { file_path: '/opt/agentbox/skills/deep-research/SKILL.md' })]).turns[0];
    expect(used.via).toEqual(['read']);
    expect(L.labelOf(used.loads, c, used.via)).toBe('deep-research');
  });

  test('an email-gateway tool call taints its turn', () => {
    const { turns } = L.extractTurns([user(PROMPT_A), tool('mcp__email-gateway__search', { q: 'x' })]);
    expect(turns[0].tainted).toBe(true);
  });

  test('route join: same session digest, nearest within 30 s, hook lines only', () => {
    const lines = [
      { consumer: 'hook', session: 'abc', ts: '2026-09-23T17:00:05.000Z', choice: 'far' },
      { consumer: 'hook', session: 'abc', ts: '2026-09-23T17:00:01.000Z', choice: 'near' },
      { consumer: 'cli', session: 'abc', ts: '2026-09-23T17:00:00.000Z', choice: 'cli' },
      { consumer: 'hook', session: 'zzz', ts: '2026-09-23T17:00:00.000Z', choice: 'other-session' },
    ];
    expect(L.matchRoute(lines, 'abc', '2026-09-23T17:00:00.000Z').choice).toBe('near');
    expect(L.matchRoute(lines, 'abc', '2026-09-23T18:00:00.000Z')).toBeNull();
  });

  test('the persisted row carries the vector and the length, never the text', () => {
    const turn = { uuid: 'u1', ts: '2026-09-23T17:00:00Z', text: PROMPT_A, loads: ['deep-research'], via: ['read'] };
    const row = L.rowFor(turn, 'session-1', [0.1, 0.2], 'bge-small-en-v1.5', { 'deep-research': 'r' }, { choice: 'web-researcher', model: 'jev-1.13.0' });
    expect(row).toMatchObject({ label: 'deep-research', router_pick: 'web-researcher', prompt_chars: PROMPT_A.length, session_hash: L.sha('session-1', 12) });
    expect(JSON.stringify(row)).not.toContain('heat pump');
  });

  test('only LAN embeddings endpoints are accepted', () => {
    for (const u of ['http://127.0.0.1:9997/v1/embeddings', 'http://192.168.2.132:9997/v1', 'http://xinference:9997/v1', 'http://10.1.2.3/v1', 'http://172.20.0.4/v1']) {
      expect(isLanUrl(u)).toBe(true);
    }
    expect(isLanUrl('http://100.101.2.3/v1')).toBe(true); // CGNAT / Tailscale, as the validator
    for (const u of ['https://api.openai.com/v1/embeddings', 'http://8.8.8.8/v1', 'http://172.32.0.1/v1', 'ftp://10.0.0.1/v1', 'not a url']) {
      expect(isLanUrl(u)).toBe(false);
    }
  });
});

describe('hook subprocess', () => {
  let tmp, server, port, embedCalls;

  beforeAll((done) => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-labels-'));
    fs.mkdirSync(path.join(tmp, 'skills', 'deep-research'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'skills', 'deep-research', 'SKILL.md'), '---\nname: deep-research\ndescription: "Research."\n---\n');
    server = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => { embedCalls.push(JSON.parse(b)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] })); });
    });
    server.listen(0, '127.0.0.1', () => { port = server.address().port; done(); });
  });
  afterAll((done) => { server.close(() => done()); fs.rmSync(tmp, { recursive: true, force: true }); });
  beforeEach(() => { embedCalls = []; });

  function transcript(lines) {
    const f = path.join(tmp, `t-${Math.random()}.jsonl`);
    fs.writeFileSync(f, lines.join('\n') + '\n');
    return f;
  }
  function run(env, payload) {
    return new Promise((resolve) => {
      const child = spawn('node', [HOOK], { env: { PATH: process.env.PATH, TMPDIR: tmp, ...env } });
      let err = '';
      child.stderr.on('data', (c) => { err += c; });
      child.on('close', (code) => resolve({ code, err }));
      child.stdin.end(JSON.stringify(payload));
    });
  }
  const on = (extra = {}) => ({
    AGENTBOX_ROUTING_LABELS: '1',
    AGENTBOX_ROUTING_LABELS_EMBED_URL: `http://127.0.0.1:${port}/v1/embeddings`,
    AGENTBOX_SKILL_ROUTE_SKILLS_DIR: path.join(tmp, 'skills'),
    AGENTBOX_SKILL_ROUTE_LOG: path.join(tmp, 'route.jsonl'),
    // Port 1 refuses: the write fails, which is what the watermark tests need.
    RUVECTOR_PG_CONNINFO: 'host=127.0.0.1 port=1 dbname=x user=x password=x',
    ...extra,
  });
  const stash = (session) => path.join(tmp, `agentbox-routing-labels-${L.sha(session, 12)}.json`);

  test('off by default: exit 0, nothing embedded', async () => {
    const t = transcript([user(PROMPT_A)]);
    const r = await run({ AGENTBOX_ROUTING_LABELS_EMBED_URL: `http://127.0.0.1:${port}/v1/embeddings` }, { session_id: 's-off', transcript_path: t });
    expect(r.code).toBe(0);
    expect(embedCalls).toHaveLength(0);
  });

  test('a non-LAN endpoint is refused before any request', async () => {
    const t = transcript([user(PROMPT_A)]);
    const r = await run(on({ AGENTBOX_ROUTING_LABELS_EMBED_URL: 'https://api.example.com/v1/embeddings' }), { session_id: 's-wan', transcript_path: t });
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/refusing non-LAN embeddings endpoint/);
    expect(embedCalls).toHaveLength(0);
  });

  test('a tainted turn is never embedded, and with nothing else to do the watermark advances', async () => {
    const t = transcript([user(PROMPT_A), tool('mcp__email-gateway__search', { q: 'x' })]);
    await run(on(), { session_id: 's-taint', transcript_path: t });
    expect(embedCalls).toHaveLength(0);
    expect(JSON.parse(fs.readFileSync(stash('s-taint'), 'utf8')).processedLines).toBe(3);
  });

  test('a failed write embeds one text per request and leaves the watermark alone', async () => {
    const t = transcript([user(PROMPT_A), tool('Skill', { skill: 'deep-research' }), user(PROMPT_B)]);
    const r = await run(on(), { session_id: 's-fail', transcript_path: t });
    expect(r.code).toBe(0);
    expect(embedCalls).toHaveLength(2);
    expect(embedCalls.every((b) => Array.isArray(b.input) && b.input.length === 1)).toBe(true);
    expect(r.err).toMatch(/persist failed — watermark NOT advanced/);
    expect(fs.existsSync(stash('s-fail'))).toBe(false);
  });
});

describe('manifest — E077 and the router session tag', () => {
  const { spawnSync } = require('child_process');
  const VALIDATOR = path.resolve(__dirname, '../../scripts/agentbox-config-validate.js');
  function validate(body) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'labels-validate-'));
    const file = path.join(dir, 'agentbox.toml');
    fs.writeFileSync(file, body);
    try {
      const r = spawnSync('node', [VALIDATOR, file], { encoding: 'utf8', env: { PATH: process.env.PATH } });
      return `${r.stdout || ''}${r.stderr || ''}`;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }

  test('a non-boolean label_log and a public embeddings URL are E077; the shipped values are clean', () => {
    expect(validate('[skills.routing]\nlabel_log = "on"\n')).toMatch(/E077: \[skills\.routing\]\.label_log must be/);
    expect(validate('[skills.routing]\nlabel_embeddings_url = "https://api.openai.com/v1/embeddings"\n')).toMatch(/E077: .*LAN or loopback/);
    expect(validate('[skills.routing]\nlabel_log = false\nlabel_embeddings_url = "http://192.168.2.132:9997/v1/embeddings"\n')).not.toMatch(/E077/);
  });

  test('the router tags its log with a 12-hex session digest only when label logging is on', async () => {
    const lib = require(path.resolve(__dirname, '../../config/hooks/lib/skill-route.cjs'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'labels-log-'));
    const logPath = path.join(dir, 'r.jsonl');
    const r = { outcome: 'skipped', reason: 'short-prompt' };
    lib.appendLog(lib.config({ AGENTBOX_SKILL_ROUTE_LOG: logPath }), { ...r, consumer: 'hook' });
    lib.appendLog(lib.config({ AGENTBOX_SKILL_ROUTE_LOG: logPath }), { ...r, consumer: 'hook', session: L.sha('s', 12) });
    const [off, on] = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(off.session).toBeUndefined();
    expect(on.session).toMatch(/^[0-9a-f]{12}$/);
    expect(lib.config({ AGENTBOX_SKILL_ROUTE_LABEL_LOG: '1' }).labelLog).toBe(true);
    expect(lib.config({}).labelLog).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
