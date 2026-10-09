import { describe, expect, test, tier } from 'claude-code/testing'

import { errorLines, fingerprint, normaliseLine, watchesTool } from '../hooks/fingerprint'
import { egress, isLocalApi, readChoice, readScore } from '../hooks/jev'
import { DEFAULT_API, readOptions } from '../hooks/options'
import { agrees, appendLine, enforceDecision, frontmatterModel, pinned, shadowRecord, spawnState, tierOf } from '../hooks/spawn'
import type { EnforceInput } from '../hooks/spawn'
import { countFailure, expiredKeys, freshRecord, markAdvised, mayInject, readRecord, SESSION_TTL_MS, statusText } from '../hooks/state'
import { factrailTainted, isTaintSkill, sha256_12, storeFileName, taintOf } from '../hooks/taint'
import { claimsCompletion, clamp, evidenceList, line, LINES, MAX_LINE_CHARS, planSkip, tail } from '../hooks/text'

tier('user')

/** Equal within floating-point noise. */
const near = (got: number | null, want: number) => expect(got !== null && Math.abs(got - want) < 1e-9).toBe(true)

describe('options', () => {
  test('defaults match the contract', () => {
    expect(readOptions(undefined)).toEqual({
      api: DEFAULT_API,
      model: 'jev-latest',
      timeoutMs: 4000,
      doneCheck: true,
      doneThreshold: 0.9,
      repeatCheck: true,
      repeatCount: 2,
      planCheck: true,
      planThreshold: 0.8,
      minChars: 24,
      spawnMode: 'shadow',
      spawnMinConfidence: 0.8,
      shadowLog: '/home/devuser/.claude/jev-checkpoints/shadow.jsonl',
      usdPerMTokIn: 0.042,
    })
  })

  test('bad values fall back; ranges are held', () => {
    const o = readOptions({ doneThreshold: 1.5, planThreshold: -1, repeatCount: 1, timeoutMs: 10, spawnMode: 'route', usdPerMTokIn: -2, minChars: '30', api: '  ' })
    expect(o.doneThreshold).toBe(0.9)
    expect(o.planThreshold).toBe(0.8)
    expect(o.repeatCount).toBe(2)
    expect(o.timeoutMs).toBe(250)
    expect(o.spawnMode).toBe('shadow')
    expect(o.usdPerMTokIn).toBe(0.042)
    expect(o.minChars).toBe(30)
    expect(o.api).toBe(DEFAULT_API)
    expect(readOptions({ repeatCount: 3.7, spawnMode: 'enforce', shadowLog: '' })).toMatchObject({ repeatCount: 3, spawnMode: 'enforce', shadowLog: '' })
  })
})

describe('text', () => {
  test('clamp keeps head 9000 and tail 3000 of a long text', () => {
    const s = `${'h'.repeat(9000)}${'m'.repeat(5000)}${'t'.repeat(3000)}`
    const c = clamp(s)
    expect(c.startsWith('h'.repeat(9000))).toBe(true)
    expect(c.endsWith('t'.repeat(3000))).toBe(true)
    expect(c).toContain('[… 5000 chars elided …]')
    expect(c).not.toContain('m')
    expect(clamp('short')).toBe('short')
    expect(tail('x'.repeat(20000)).length).toBeLessThan(12100)
  })

  test('the completion pre-gate', () => {
    for (const s of ['Done — the parser handles it now.', 'Fixed the race in the loader.', 'All tests pass.', 'The build is green.', 'This should now work.', 'Implemented the endpoint.', 'Ready to merge.'])
      expect(claimsCompletion(s)).toBe(true)
    for (const s of ['I could not reproduce it; can you share the log?', 'Here is how the scheduler decides.', 'Which branch should I use?'])
      expect(claimsCompletion(s)).toBe(false)
  })

  test('plan skips slash commands and short prompts', () => {
    expect(planSkip('/compact', 24)).toBe('slash-command')
    expect(planSkip('  thanks  ', 24)).toBe('short-prompt')
    expect(planSkip('add a column to the users table and migrate it', 24)).toBeNull()
  })

  test('evidence names the tool, the outcome and a command line, nothing else', () => {
    expect(evidenceList([{ tool: 'Bash', ok: true, command: 'cargo test' }, { tool: 'Edit', ok: false }])).toBe('Bash ok: cargo test\nEdit error')
    expect(evidenceList([])).toBe('(no tool calls this turn)')
    const many = Array.from({ length: 45 }, (_, i) => ({ tool: `T${i}`, ok: true }))
    expect(evidenceList(many).split('\n')[0]).toBe('(5 earlier calls omitted)')
  })

  test('every injected line is within the ceiling', () => {
    for (const l of [LINES.done, LINES.plan, LINES.repeat(12)]) expect(l.length).toBeLessThanOrEqual(MAX_LINE_CHARS)
    expect(line('x'.repeat(400)).length).toBe(MAX_LINE_CHARS)
  })
})

describe('fingerprint', () => {
  const run1 = [
    'running 12 tests',
    'test parser::tests::nested ... FAILED',
    "thread 'parser::tests::nested' panicked at src/parser.rs:118:9:",
    'assertion `left == right` failed',
    '2026-10-09T10:11:12Z ERROR loader: timed out after 340ms (0x7ffd3a2b)',
    'test result: FAILED. 11 passed; 1 failed; finished in 0.53s',
    'Exit code 101',
  ].join('\n')
  const run2 = [
    'running 12 tests',
    'test parser::tests::nested ... FAILED',
    "thread 'parser::tests::nested' panicked at src/parser.rs:131:13:",
    'assertion `left == right` failed',
    '2026-10-09T10:15:59Z ERROR loader: timed out after 1.2s (0x7ffe00c4)',
    'test result: FAILED. 11 passed; 1 failed; finished in 1.07s',
    'Exit code 101',
  ].join('\n')

  test('the same failure differing only in line numbers, durations, timestamps and addresses has one fingerprint', () => {
    expect(fingerprint('Bash', run1)).not.toBeNull()
    expect(fingerprint('Bash', run1)).toBe(fingerprint('Bash', run2))
  })

  test('a different failure, or the same text from another tool, does not', () => {
    expect(fingerprint('Bash', run1.replace('nested', 'flat'))).not.toBe(fingerprint('Bash', run1))
    expect(fingerprint('Bash', run1.replace('src/parser.rs', 'src/lexer.rs'))).not.toBe(fingerprint('Bash', run1))
    expect(fingerprint('mcp__ci__run_tests', run1)).not.toBe(fingerprint('Bash', run1))
  })

  test('normalisation and error-line selection', () => {
    expect(normaliseLine('at foo (src/a.ts:12:4) took 15ms')).toBe('at foo (src/a.ts:<n>) took <dur>')
    expect(normaliseLine('error on line 42, col 7 at 12:01:02')).toBe('error on line <n> at <ts>')
    expect(errorLines('ok\nall good\nError: boom\nError: boom')).toEqual(['error: boom'])
    expect(errorLines('just output\nExit code 2')).toEqual(['exit code 2'])
    expect(fingerprint('Bash', '   \n')).toBeNull()
  })

  test('the shell and test-like runners are watched; other tools are not', () => {
    expect(watchesTool('Bash')).toBe(true)
    expect(watchesTool('mcp__ci__run_tests')).toBe(true)
    expect(watchesTool('mcp__x__lint')).toBe(true)
    expect(watchesTool('Edit')).toBe(false)
    expect(watchesTool('mcp__email-gateway__ask_email')).toBe(false)
  })
})

describe('jev wire', () => {
  test('readScore normalises a score by its level count, or reads the expectation', () => {
    near(readScore({ score: 0.95, legend: { '0': 'no', '1': 'yes' } }), 0.95)
    near(readScore({ score: 1.84, legend: { '0': 'a', '1': 'b', '2': 'c' } }), 0.92)
    near(readScore({ probabilities: { '0': 0.2, '1': 0.8 } }), 0.8)
    expect(readScore({ score: 7, legend: { '0': 'no', '1': 'yes' } })).toBe(1)
    expect(readScore({ choice: 'x' })).toBeNull()
    expect(readScore(null)).toBeNull()
    expect(readScore({ score: 'high', legend: { '0': 'no', '1': 'yes' } })).toBeNull()
  })

  test('readChoice accepts only an offered option', () => {
    expect(readChoice({ choice: 'haiku', confidence: 0.9 }, ['haiku', 'opus'])).toEqual({ choice: 'haiku', confidence: 0.9 })
    expect(readChoice({ choice: 'haiku', probabilities: { haiku: 0.7 } }, ['haiku'])).toEqual({ choice: 'haiku', confidence: 0.7 })
    expect(readChoice({ choice: 'gpt' }, ['haiku'])).toBeNull()
    expect(readChoice({ choice: 'haiku' }, ['haiku'])).toEqual({ choice: 'haiku', confidence: null })
  })

  test('loopback and LAN hosts are local; the cloud is not', () => {
    for (const u of ['http://127.0.0.1:8090/v1/systemone', 'http://localhost/x', 'http://192.168.2.132:8084/v1', 'http://10.10.10.1/x', 'http://172.20.0.5/x', 'http://[::1]:80/x', 'http://system-one:8080/v1', 'http://box.local/x'])
      expect(isLocalApi(u)).toBe(true)
    for (const u of [DEFAULT_API, 'https://8.8.8.8/x', 'not a url', 'http://172.32.0.1/x'])
      expect(isLocalApi(u)).toBe(false)
  })

  test('egress: the switch, then the fence (local passes), then the key (local needs none)', () => {
    expect(egress({ enabled: false, tainted: false, hasKey: true, api: DEFAULT_API })).toEqual({ go: false, reason: 'switched-off' })
    expect(egress({ enabled: true, tainted: true, hasKey: true, api: DEFAULT_API })).toEqual({ go: false, reason: 'tainted' })
    expect(egress({ enabled: true, tainted: false, hasKey: false, api: DEFAULT_API })).toEqual({ go: false, reason: 'no-key' })
    expect(egress({ enabled: true, tainted: false, hasKey: true, api: DEFAULT_API })).toEqual({ go: true, local: false })
    expect(egress({ enabled: true, tainted: true, hasKey: false, api: 'http://127.0.0.1:8090/v1/systemone' })).toEqual({ go: true, local: true })
  })
})

describe('spawn', () => {
  const base: EnforceInput = { pick: 'haiku', confidence: 0.9, minConfidence: 0.8, callerModel: undefined, mainModel: 'claude-sonnet-4-6', fork: false, workflow: false, pinned: false }

  test('enforce rewrites only when every condition holds', () => {
    expect(enforceDecision(base)).toEqual({ rewrite: 'haiku' })
    expect(enforceDecision({ ...base, pick: 'sonnet' })).toEqual({ rewrite: 'sonnet' })
    expect(enforceDecision({ ...base, callerModel: 'opus' })).toEqual({ rewrite: null, why: 'caller-chose' })
    expect(enforceDecision({ ...base, fork: true })).toEqual({ rewrite: null, why: 'fork' })
    expect(enforceDecision({ ...base, workflow: true })).toEqual({ rewrite: null, why: 'workflow' })
    expect(enforceDecision({ ...base, pinned: true })).toEqual({ rewrite: null, why: 'definition-pins' })
    expect(enforceDecision({ ...base, pick: 'inherit' })).toEqual({ rewrite: null, why: 'inherit' })
    expect(enforceDecision({ ...base, confidence: 0.79 })).toEqual({ rewrite: null, why: 'low-confidence' })
    expect(enforceDecision({ ...base, confidence: null })).toEqual({ rewrite: null, why: 'low-confidence' })
    expect(enforceDecision({ ...base, mainModel: 'some-other-model' })).toEqual({ rewrite: null, why: 'main-model-unknown' })
  })

  test('enforce never upgrades beyond the main model', () => {
    expect(enforceDecision({ ...base, pick: 'opus', mainModel: 'claude-sonnet-4-6' })).toEqual({ rewrite: null, why: 'would-upgrade' })
    expect(enforceDecision({ ...base, pick: 'sonnet', mainModel: 'haiku' })).toEqual({ rewrite: null, why: 'would-upgrade' })
    expect(enforceDecision({ ...base, pick: 'opus', mainModel: 'claude-opus-5-5[1m]' })).toEqual({ rewrite: 'opus' })
  })

  test('a definition pins a model only through its frontmatter', () => {
    expect(frontmatterModel('---\nname: x\nmodel: haiku\n---\nbody')).toBe('haiku')
    expect(frontmatterModel('---\nname: x\nmodel: "claude-opus-4"  # pinned\n---\n')).toBe('claude-opus-4')
    expect(frontmatterModel('---\nname: x\n---\nmodel: opus in prose')).toBeUndefined()
    expect(pinned('Explore', '---\nmodel: haiku\n---\n')).toBe(true)
    expect(pinned('coder', '---\nmodel: inherit\n---\n')).toBe(false)
    expect(pinned('coder', '---\nname: coder\n---\n')).toBe(false)
    expect(pinned('general-purpose', undefined)).toBe(false)
    expect(pinned('Plan', undefined)).toBe(true)
  })

  test('tiers, agreement and state', () => {
    expect(tierOf('claude-haiku-4-5')).toBe('haiku')
    expect(tierOf('opus')).toBe('opus')
    expect(tierOf(undefined)).toBeNull()
    expect(agrees('inherit', undefined)).toBe(true)
    expect(agrees('haiku', 'claude-haiku-4-5')).toBe(true)
    expect(agrees('opus', 'sonnet')).toBe(false)
    expect(spawnState('Explore', 'find it', 'p'.repeat(20000)).prompt_head.length).toBeLessThan(12100)
  })

  test('the shadow record carries a digest and no prompt text', async () => {
    const secret = 'please look at the private key file for me'
    const r = shadowRecord({ now: 0, session: 's', subagentType: 'Explore', callerModel: undefined, pick: 'haiku', confidence: 0.912345, enforced: false, ms: 12.4, usd: 0.0000336, promptDigest: await sha256_12(secret) })
    expect(r).toEqual({ ts: '1970-01-01T00:00:00.000Z', session: 's', subagent_type: 'Explore', caller_model: 'inherit', jev_choice: 'haiku', confidence: 0.9123, enforced: false, ms: 12, usd: 0.0000336, prompt_digest: expect.stringMatching(/^sha256-12-[0-9a-f]{12}$/) })
    expect(JSON.stringify(r)).not.toContain('private key')
  })

  test('the shadow log appends a line and sheds its oldest half past the cap', () => {
    const r = shadowRecord({ now: 0, session: 's', subagentType: 't', callerModel: 'haiku', pick: 'haiku', confidence: 1, enforced: false, ms: 1, usd: 0, promptDigest: 'sha256-12-000000000000' })
    expect(appendLine('', r).split('\n').filter(Boolean)).toHaveLength(1)
    expect(appendLine('{"a":1}', r).split('\n').filter(Boolean)).toHaveLength(2)
    const big = Array.from({ length: 100 }, (_, i) => `{"i":${i}}`).join('\n') + '\n'
    const out = appendLine(big, r, 500)
    expect(out.length).toBeLessThan(big.length)
    expect(out.endsWith(`${JSON.stringify(r)}\n`)).toBe(true)
  })
})

describe('state', () => {
  test('a fingerprint advises once it reaches the count, and only once', () => {
    const rec = freshRecord(0)
    expect(countFailure(rec, 'f', 2)).toBeNull()
    expect(countFailure(rec, 'f', 2)).toBe(2)
    markAdvised(rec, 'f')
    expect(countFailure(rec, 'f', 2)).toBeNull()
    expect(rec.fingerprints['f']).toBe(3)
    expect(countFailure(rec, 'g', 3)).toBeNull()
  })

  test('one line per checkpoint per prompt; the plan line not on the very next prompt', () => {
    const rec = freshRecord(0)
    rec.prompt = 5
    expect(mayInject(rec, 'plan')).toBe(true)
    rec.lastInjected.plan = 5
    expect(mayInject(rec, 'plan')).toBe(false)
    rec.prompt = 6
    expect(mayInject(rec, 'plan')).toBe(false)
    rec.prompt = 7
    expect(mayInject(rec, 'plan')).toBe(true)
    rec.lastInjected.done = 6
    rec.prompt = 7
    expect(mayInject(rec, 'done')).toBe(true)
  })

  test('stale sessions and their switches are pruned; malformed records start fresh', () => {
    const now = SESSION_TTL_MS * 2
    const entries: [string, unknown][] = [
      ['session:old', { at: 1 }],
      ['switch:old', false],
      ['session:new', { at: now - 1000 }],
      ['switch:new', true],
      ['session:bad', 'x'],
    ]
    expect(expiredKeys(entries, now).sort()).toEqual(['session:bad', 'session:old', 'switch:old'])
    expect(readRecord('garbage', 7)).toEqual(freshRecord(7))
    expect(readRecord({ tainted: 'tool:x', stats: { done: { requests: 2 } } }, 7)).toMatchObject({ tainted: 'tool:x', stats: { done: { requests: 2, injections: 0 } } })
  })

  test('status names every checkpoint and the agreement rate', () => {
    const rec = freshRecord(0)
    rec.stats.plan = { requests: 3, injections: 1, usd: 0.000126, lastError: 'timeout' }
    rec.spawn = { decisions: 4, agreements: 3, enforced: 0 }
    const text = statusText({ enabled: true, rec, enabledChecks: { done: true, repeat: true, plan: true, spawn: true }, spawnMode: 'shadow', api: DEFAULT_API, local: false, hasKey: true })
    expect(text).toContain('jev-checkpoints: on for this session')
    expect(text).toMatch(/plan\s+on\s+3 requests, \$0\.00013, 1 injections, last error timeout/)
    expect(text).toContain('repeat on      local only')
    expect(text).toContain('spawn agreement with the caller: 3/4 (75%)')
  })
})

describe('taint', () => {
  test('email tools and the email-search skill taint; others do not', () => {
    expect(taintOf('mcp__email-gateway__ask_email', {})).toBe('tool:mcp__email-gateway__ask_email')
    expect(taintOf('mcp__claude_ai_Gmail__search', {})).toBe('tool:mcp__claude_ai_Gmail__search')
    expect(taintOf('Skill', { skill: 'email-search' })).toBe('skill:email-search')
    expect(taintOf('Skill', { name: 'agentbox:email-search' })).toBe('skill:agentbox:email-search')
    expect(taintOf('Skill', { skill: 'browser' })).toBeNull()
    expect(taintOf('Bash', { command: 'echo email' })).toBeNull()
    expect(isTaintSkill('/email-search')).toBe(true)
  })

  test("factrail's store file and record are read as factrail writes them", async () => {
    expect(await storeFileName('factrail', 'agentbox')).toBe('factrail_agentbox-bc2c3fba5695.json')
    expect(factrailTainted(JSON.stringify({ 'taint:s1': { tainted: true, count: 1 } }), 's1')).toBe(true)
    expect(factrailTainted(JSON.stringify({ 'taint:s1': { tainted: false } }), 's1')).toBe(false)
    expect(factrailTainted('{ torn', 's1')).toBe(false)
  })
})
