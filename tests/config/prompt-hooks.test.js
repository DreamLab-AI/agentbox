'use strict';

/**
 * UserPromptSubmit context hooks — the output contract and the hook that is
 * not the skill router (that one has tests/config/skill-route.test.js).
 *
 *   • lib/hook-output.cjs emits ONLY {hookSpecificOutput:{hookEventName,
 *     additionalContext}} — the shape Claude Code honours — and nothing at all
 *     when there is nothing to inject;
 *   • ruvnet-brain-ground fires for prompts about the upstream RuvNet ecosystem
 *     and stays silent on estate-typical operational prompts, capped at 1,200 chars.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { PassThrough, Writable } = require('stream');

const HOOKS = path.resolve(__dirname, '../../config/hooks');
const out = require(path.join(HOOKS, 'lib', 'hook-output.cjs'));
const brain = require(path.join(HOOKS, 'ruvnet-brain-ground.cjs'));

function runHook(file, prompt, env = {}) {
  const r = spawnSync('node', [path.join(HOOKS, file)], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt }),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: os.tmpdir(), ...env },
  });
  expect(r.status).toBe(0);
  return r.stdout;
}

/** Parse stdout, asserting it is exactly the honoured shape. */
function contextOf(stdout) {
  if (!stdout.trim()) return null;
  const j = JSON.parse(stdout.trim());
  expect(j).toEqual({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: expect.any(String) } });
  return j.hookSpecificOutput.additionalContext;
}

describe('lib/hook-output.cjs', () => {
  test('payload is the honoured shape, with no top-level additionalContext or result', () => {
    const j = JSON.parse(out.contextPayload('hello'));
    expect(j).toEqual({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'hello' } });
  });

  test('empty or whitespace context writes nothing and resolves false', async () => {
    expect(out.contextPayload('')).toBeNull();
    expect(out.contextPayload('   ')).toBeNull();
    const s = new PassThrough();
    let written = '';
    s.on('data', (c) => { written += c; });
    expect(await out.emitContext('', { stream: s })).toBe(false);
    expect(written).toBe('');
  });

  test('resolves true after the write flushes, false when the write fails', async () => {
    const s = new PassThrough();
    let written = '';
    s.on('data', (c) => { written += c; });
    expect(await out.emitContext('ctx', { stream: s })).toBe(true);
    expect(JSON.parse(written).hookSpecificOutput.additionalContext).toBe('ctx');
    const broken = new Writable({ write(_c, _e, cb) { cb(new Error('EPIPE')); } });
    broken.on('error', () => {});
    expect(await out.emitContext('ctx', { stream: broken })).toBe(false);
  });
});

describe('ruvnet-brain-ground', () => {
  const MUST_NOT_FIRE = [
    'fix the ruvector recall gate',
    'check the claude-flow memory tools',
    'run the agentic-qe fleet and report failures',
    'the ruflo mcp child is crashing on boot, look at the supervisor logs',
    'store this fact in memory: the build takes 15 minutes',
    'use sparc mode to plan the refactor',
    'rebuild the HNSW index on ruvector-postgres serially',
    'what does the agentdb adapter in management-api do',
    'we already dropped pgvector last month',
    'summarise the DAA section of the doc',
    'Search memory before starting: memory_search namespace patterns for claude-flow hooks',
  ];
  const MUST_FIRE = [
    'how does ruvector implement HNSW under the hood?',
    'does claude-flow support custom embedding providers upstream?',
    'what changed in the latest version of agentdb on npm',
    'look at github.com/ruvnet/ruflo and tell me how swarm consensus works',
    'what is qudag?',
    'is @ruvector/sona usable at 384 dimensions',
    'explain how ruv-fann trains networks',
  ];

  test.each(MUST_NOT_FIRE)('silent on estate-typical prompt: %s', (p) => {
    expect(brain.analyse(p)).toBe('');
    expect(runHook('ruvnet-brain-ground.cjs', p)).toBe('');
  });

  test.each(MUST_FIRE)('grounds a prompt about upstream: %s', (p) => {
    expect(brain.analyse(p)).toMatch(/^\[GROUNDING\]/);
  });

  test('the hook emits the honoured shape when it fires', () => {
    const ctx = contextOf(runHook('ruvnet-brain-ground.cjs', MUST_FIRE[0]));
    expect(ctx).toMatch(/search_ruvnet/);
  });

  test('a substitute fires only with selection intent, in the same sentence', () => {
    expect(brain.analyse('should we use pinecone for the vector store')).toMatch(/^\[REDIRECT\] "pinecone"/);
    expect(brain.analyse('switch from langchain to something lighter')).toMatch(/ruflo\/agentic-flow/);
    expect(brain.analyse('pinecone was mentioned in the meeting. Use the other doc.')).toBe('');
  });

  test('an estate name and a cue in different sentences do not pair', () => {
    expect(brain.analyse('fix the ruvector recall gate.\nThen publish the crate to crates.io.')).toBe('');
  });

  test('injected context is capped at 1,200 chars', () => {
    const p = 'how does ruvector work upstream? should we use pinecone, pgvector, weaviate, chromadb, langchain, llamaindex or hnswlib instead';
    const ctx = brain.analyse(p);
    expect(ctx.length).toBeLessThanOrEqual(brain.MAX_CONTEXT_CHARS);
    expect(brain.MAX_CONTEXT_CHARS).toBe(1200);
    expect(ctx.split('\n').filter((l) => l.startsWith('[REDIRECT]'))).toHaveLength(2);
    expect(brain.analyse(`qudag ${'x '.repeat(5000)}`).length).toBeLessThanOrEqual(1200);
  });

  test('malformed stdin and empty prompt write nothing', () => {
    const r = spawnSync('node', [path.join(HOOKS, 'ruvnet-brain-ground.cjs')], { input: '{not json', encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(runHook('ruvnet-brain-ground.cjs', '')).toBe('');
  });
});
