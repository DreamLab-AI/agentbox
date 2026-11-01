'use strict';

/**
 * spawnTask never resumes a session: no argv built from caller input can carry a
 * resume/continue flag. That is why a pre-deploy trajectory id is never revisited
 * after the ADR-2164 deploy. Proven on the argv handed to child_process.spawn.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const mockCalls = [];
jest.mock('child_process', () => ({
  spawn: (command, args, opts) => {
    mockCalls.push({ command, args, opts });
    const c = new (require('events').EventEmitter)();
    c.pid = 4242; c.unref = () => {};
    c.stdout = new (require('stream').PassThrough)();
    c.stderr = new (require('stream').PassThrough)();
    return c;
  },
}));

const ProcessManager = require('../../management-api/utils/process-manager');
const RESUME = /^--?(resume|continue|r|c|session-id|fork-session)(=|$)/i;
const logger = { info() {}, warn() {}, error() {} };
let pm; let root;

beforeEach(() => {
  mockCalls.length = 0;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-nr-'));
  process.env.WORKSPACE = root;
  process.env.ZAI_ENABLED = 'true';
  pm = new ProcessManager(logger, { taskTokens: { mint: () => 'tok', revokeTask() {} } });
});
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 50)); // let the task log streams open before the tree goes
  fs.rmSync(root, { recursive: true, force: true });
});

describe('spawnTask argv', () => {
  test('claude-flow: argv is exactly [--allowedTools, list, one prompt element]; the prompt cannot be a flag', () => {
    pm.spawnTask('coder', '--resume abc123', 'claude-flow');
    const { command, args } = mockCalls[0];
    expect(command).toBe('claude');
    expect(args).toHaveLength(3);
    expect(args[0]).toBe('--allowedTools');
    expect(args[2]).toMatch(/^Working directory: /);
    expect(args.some((a) => RESUME.test(a))).toBe(false);
  });

  test('agentic-flow: the argv is fixed flags plus three values', () => {
    pm.spawnTask('coder', 'write a haiku', 'gemini');
    const { command, args } = mockCalls[0];
    expect(command).toBe('agentic-flow');
    expect(args).toEqual(['--agent', 'coder', '--task', 'write a haiku', '--provider', 'gemini']);
  });

  test.each([
    ['agent', ['--resume', 'do it', 'gemini']],
    ['agent', ['-c', 'do it', 'gemini']],
    ['provider', ['coder', 'do it', '--continue']],
    ['provider', ['coder', 'do it', '--resume=abc']],
    ['task', ['coder', '--resume abc', 'gemini']],
    ['task', ['coder', '-c', 'gemini']],
  ])('a %s value that begins with "-" is refused before anything is spawned (%j)', (_what, [agent, task, provider]) => {
    expect(() => pm.spawnTask(agent, task, provider)).toThrow(/Invalid|must not begin/i);
    expect(mockCalls).toHaveLength(0);
  });

  test('a resume-looking token inside a value stays inside its single argv element', () => {
    pm.spawnTask('coder', 'please explain what --resume does', 'gemini');
    const { args } = mockCalls[0];
    expect(args).toHaveLength(6);
    expect(args.filter((a) => RESUME.test(a))).toEqual([]);
  });

  test('free-text role labels (the briefing route passes them as agent) stay valid', () => {
    pm.spawnTask('Product Manager', 'do it', 'gemini');
    expect(mockCalls[0].args.slice(0, 2)).toEqual(['--agent', 'Product Manager']);
  });

  test('empty values and control characters are refused', () => {
    for (const bad of ['', '   ', 'x\ny', 'a\u0000b']) {
      expect(() => pm.spawnTask(bad, 'do it', 'gemini')).toThrow(/Invalid/);
      expect(() => pm.spawnTask('coder', 'do it', bad)).toThrow(/Invalid/);
    }
    expect(mockCalls).toHaveLength(0);
  });

  test('no code path in the process manager adds a resume/continue flag of its own', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../management-api/utils/process-manager.js'), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/['"`]--?(resume|continue|session-id|fork-session)/i);
  });
});
