import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { On } from 'claude-code'

import { LINES } from '../hooks/text'
import { choice, HOME, KEY, prompt, ROOT, run, score, SESSION, START, turn, world } from './fixtures/world'
import type { World } from './fixtures/world'

tier('user')

/** The default `shadowLog`, as the manifest projects it. */
const SHADOW = '/home/devuser/.claude/jev-checkpoints/shadow.jsonl'
const PLAN_PROMPT = 'add a tenant_id column to the users table and thread it through the REST API'

/** The world, the key and a store; the prompt's context is captured beneath the plugin. */
function setup(on: On, opts: { env?: Record<string, string>; files?: Record<string, string>; model?: string; store?: Record<string, unknown> } = {}) {
  const w = world(on, { files: opts.files, model: opts.model })
  const clock = mock.clock(on, { now: 1_790_000_000_000 })
  mock.store(on, opts.store)
  mock.env(on, opts.env ?? KEY)
  const contexts: (readonly string[] | undefined)[] = []
  on('prompt.submit', ($, e) => (contexts.push(e.context), { text: e.text }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  return { w, contexts, clock }
}

/** Answer every tool call beneath the plugin: Bash by script, the rest ok. */
function tools(on: On, bash: (command: string) => { ok: true; text: string } | { ok: false; text: string }) {
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash') {
      const r = bash(String((e as { command?: unknown }).command ?? ''))
      return r.ok ? { result: { stdout: r.text, stderr: '', interrupted: false }, text: r.text } : { isError: true, result: r.text, text: r.text }
    }
    return { result: 'ok', text: 'ok' }
  })
}

const failure = (line: number, ms: number) =>
  `test parser::tests::nested ... FAILED\nthread 'main' panicked at src/parser.rs:${line}:9:\nassertion failed\nfinished in ${ms}ms\nExit code 101`

describe('plan checkpoint', () => {
  test('a high score attaches the plan line; the request carries the prompt and the key', async ($, on) => {
    const { w, contexts } = setup(on)
    w.reply = [score('plan', 0.93)]
    await $.session.start(START)
    await $.prompt.submit(prompt(PLAN_PROMPT))

    expect(contexts[0]).toEqual([LINES.plan])
    expect(w.requests).toHaveLength(1)
    const req = w.requests[0]!
    expect(req.url).toBe('https://api.typesafe.ai/v1/systemone')
    expect(req.init?.headers?.['Authorization']).toBe('Bearer test-key')
    expect(req.body).toMatchObject({ model: 'jev-latest', state: { user_request: PLAN_PROMPT }, questions: { plan: { type: 'score' } } })
  })

  test('below the threshold nothing is attached; slash commands and short prompts are never sent', async ($, on) => {
    const { w, contexts } = setup(on)
    w.reply = [score('plan', 0.5)]
    await $.session.start(START)
    await $.prompt.submit(prompt(PLAN_PROMPT))
    await $.prompt.submit(prompt('/compact keep the plan'))
    await $.prompt.submit(prompt('ok, go on'))

    expect(contexts).toEqual([undefined, undefined, undefined])
    expect(w.requests).toHaveLength(1)
  })

  test('the plan line is not repeated on the very next prompt', async ($, on) => {
    const { w, contexts } = setup(on)
    w.reply = [score('plan', 0.95)]
    await $.session.start(START)
    for (let i = 0; i < 3; i++) await $.prompt.submit(prompt(`${PLAN_PROMPT} (${i})`))

    expect(contexts.map(c => c?.length ?? 0)).toEqual([1, 0, 1])
    expect(w.requests).toHaveLength(2)
  })

  test('a configured endpoint and model are honoured', { options: { api: 'http://127.0.0.1:8090/v1/systemone', model: 'openjev' } }, async ($, on) => {
    const { w, contexts } = setup(on, { env: { HOME } })
    w.reply = [score('plan', 0.99)]
    await $.session.start(START)
    await $.prompt.submit(prompt(PLAN_PROMPT))

    expect(w.requests[0]?.url).toBe('http://127.0.0.1:8090/v1/systemone')
    expect(w.requests[0]?.body['model']).toBe('openjev')
    expect(w.requests[0]?.init?.headers?.['Authorization']).toBeUndefined()
    expect(contexts[0]).toEqual([LINES.plan])
  })
})

describe('fail-open', () => {
  const failing: [string, World['reply'][number]][] = [
    ['429', { status: 429, body: { error: 'rate limited' } }],
    ['500', { status: 500, body: 'oops' }],
    ['bad JSON', { status: 200, body: '{ torn' }],
    ['no answers', { status: 200, body: { model: 'jev', usage: {} } }],
    ['wrong answer shape', { status: 200, body: { answers: { plan: { type: 'choice', choice: 'x' } } } }],
  ]
  for (const [name, reply] of failing) {
    test(`${name}: the prompt goes through untouched, with one log line`, async ($, on) => {
      const { w, contexts } = setup(on)
      w.reply = [reply]
      await $.session.start(START)
      const r = await $.prompt.submit(prompt(PLAN_PROMPT))

      expect(r).toMatchObject({ text: PLAN_PROMPT })
      expect(contexts).toEqual([undefined])
      expect(w.logs.filter(l => l.startsWith('jev-checkpoints: plan skipped'))).toHaveLength(1)
    })
  }

  test('a judge that never answers is abandoned at the deadline', { options: { timeoutMs: 4000 } }, async ($, on) => {
    const { w, contexts, clock } = setup(on)
    w.reply = ['hang']
    await $.session.start(START)
    const pending = $.prompt.submit(prompt(PLAN_PROMPT))
    await clock.settle()
    await clock.advance(4000)
    expect(await pending).toMatchObject({ text: PLAN_PROMPT })

    expect(contexts).toEqual([undefined])
    expect(w.logs).toContain('jev-checkpoints: plan skipped (timeout)')
  })

  test('no key: nothing is sent, one line says so once, repeat still runs', async ($, on) => {
    const { w, contexts } = setup(on, { env: { HOME } })
    tools(on, () => ({ ok: false, text: failure(10, 5) }))
    await $.session.start(START)
    await $.prompt.submit(prompt(PLAN_PROMPT))
    await $.prompt.submit(prompt(`${PLAN_PROMPT} again`))
    await $.tool.call({ tool: 'Bash', command: 'cargo test' })
    const second = await $.tool.call({ tool: 'Bash', command: 'cargo test' })

    expect(w.requests).toHaveLength(0)
    expect(contexts).toEqual([undefined, undefined])
    expect(w.logs.filter(l => l.includes('TYPESAFE_API_KEY is unset'))).toHaveLength(1)
    expect('context' in second ? second.context : undefined).toEqual([LINES.repeat(2)])
  })
})

describe('email fence', () => {
  test('one email-gateway call taints the session for good: no cloud request afterwards', async ($, on) => {
    const { w, contexts } = setup(on)
    tools(on, () => ({ ok: true, text: '' }))
    w.reply = [score('plan', 0.99)]
    await $.session.start(START)
    await $.prompt.submit(prompt(PLAN_PROMPT))
    await $.tool.call({ tool: 'mcp__email-gateway__ask_email', question: 'invoices?' } as never)
    await $.prompt.submit(prompt(`${PLAN_PROMPT} — second`))
    await $.prompt.submit(prompt(`${PLAN_PROMPT} — third`))
    await $.turn.complete(turn('Done — all fixed.'))

    expect(w.requests).toHaveLength(1)
    expect(contexts.map(c => c?.length ?? 0)).toEqual([1, 0, 0])
    expect((await $.command.run(run('jev-checkpoints', 'status'))).text).toContain('email-tainted (tool:mcp__email-gateway__ask_email)')
  })

  test('the taint survives a reload: it is read back from the store', async ($, on) => {
    const { w } = setup(on, { store: { [`session:${SESSION}`]: { at: 1_790_000_000_000, tainted: 'skill:email-search' } } })
    w.reply = [score('plan', 0.99)]
    await $.session.start(START)
    await $.prompt.submit(prompt(PLAN_PROMPT))
    expect(w.requests).toHaveLength(0)
  })

  test('loading the email-search skill taints, by Skill call or by skill prompt', async ($, on) => {
    const { w } = setup(on)
    tools(on, () => ({ ok: true, text: '' }))
    on('skill.prompt', ($, e) => ({ text: e.text }))
    w.reply = [score('plan', 0.99)]
    await $.session.start(START)
    await $.skill.prompt({ skill: 'email-search', text: 'search mail' })
    await $.prompt.submit(prompt(PLAN_PROMPT))
    expect(w.requests).toHaveLength(0)
  })

  test("factrail's taint of this session is honoured", async ($, on) => {
    const store = `${HOME}/.claude/plugins/store/factrail_agentbox-bc2c3fba5695.json`
    const { w } = setup(on, { files: { [store]: JSON.stringify({ [`taint:${SESSION}`]: { tainted: true, count: 2 } }) } })
    w.reply = [score('plan', 0.99)]
    await $.session.start(START)
    await $.prompt.submit(prompt(PLAN_PROMPT))
    expect(w.requests).toHaveLength(0)
  })

  test('a local endpoint may still judge a tainted session', { options: { api: 'http://192.168.2.132:8084/v1/systemone' } }, async ($, on) => {
    const { w, contexts } = setup(on)
    tools(on, () => ({ ok: true, text: '' }))
    w.reply = [score('plan', 0.99)]
    await $.session.start(START)
    await $.tool.call({ tool: 'mcp__email-gateway__ask_email', question: 'x' } as never)
    await $.prompt.submit(prompt(PLAN_PROMPT))
    expect(w.requests).toHaveLength(1)
    expect(contexts[0]).toEqual([LINES.plan])
  })
})

describe('done checkpoint', () => {
  test('a completion claim without a verifying run puts the done line on the next prompt, once', async ($, on) => {
    const { w, contexts } = setup(on)
    tools(on, () => ({ ok: true, text: 'SECRET-TOOL-OUTPUT token=abc123' }))
    w.reply = [score('done', 0.96)]
    await $.session.start(START)
    await $.turn.start({ text: 'fix the parser', turnId: 't1' })
    await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/parser.rs`, old_string: 'a', new_string: 'b' } as never)
    await $.tool.call({ tool: 'Bash', command: 'git diff --stat\necho second line' })
    await $.turn.complete(turn('Fixed — the parser handles nested blocks now.'))
    await $.prompt.submit(prompt('thanks'))
    await $.prompt.submit(prompt('and now?'))

    expect(w.requests).toHaveLength(1)
    const body = JSON.stringify(w.requests[0]!.body)
    expect(body).not.toContain('SECRET-TOOL-OUTPUT')
    expect(body).not.toContain('second line')
    expect(w.requests[0]!.body['state']).toEqual({
      assistant_final_text: 'Fixed — the parser handles nested blocks now.',
      tool_calls_this_turn: 'Edit ok\nBash ok: git diff --stat',
    })
    expect(contexts).toEqual([[LINES.done], undefined])
  })

  test('no completion wording, a low score, or a subagent turn: no line', async ($, on) => {
    const { w, contexts } = setup(on)
    w.reply = [score('done', 0.4)]
    await $.session.start(START)
    await $.turn.complete(turn('I could not reproduce it; can you share the log?'))
    await $.turn.complete({ ...turn('Done.'), agentId: 'a1' })
    expect(w.requests).toHaveLength(0)
    await $.turn.complete(turn('All tests pass.'))
    await $.prompt.submit(prompt('ok'))

    expect(w.requests).toHaveLength(1)
    expect(contexts).toEqual([undefined])
  })
})

describe('repeat checkpoint', () => {
  test('the same failure, its line numbers and durations moved, advises once at the count; Jev is never asked', async ($, on) => {
    const { w } = setup(on)
    let n = 0
    tools(on, () => ({ ok: false, text: failure(100 + n++, 10 * n) }))
    await $.session.start(START)
    await $.prompt.submit(prompt('hi'))
    const results = []
    for (let i = 0; i < 4; i++) results.push(await $.tool.call({ tool: 'Bash', command: 'cargo test' }))

    const ctx = results.map(r => ('context' in r ? r.context : undefined))
    expect(ctx).toEqual([undefined, [LINES.repeat(2)], undefined, undefined])
    expect(w.requests).toHaveLength(0)
  })

  test('a different failure is counted apart; repeatCount is honoured; successes never count', { options: { repeatCount: 3 } }, async ($, on) => {
    setup(on)
    const outputs = [failure(1, 1), failure(2, 2).replace('nested', 'flat'), 'ok', failure(3, 3), failure(4, 4)]
    let i = 0
    tools(on, () => {
      const t = outputs[i++]!
      return t === 'ok' ? { ok: true, text: t } : { ok: false, text: t }
    })
    await $.session.start(START)
    const results = []
    for (let k = 0; k < outputs.length; k++) results.push(await $.tool.call({ tool: 'Bash', command: 'cargo test' }))
    expect(results.map(r => ('context' in r ? r.context : undefined))).toEqual([undefined, undefined, undefined, undefined, [LINES.repeat(3)]])
  })

  test('/jev-checkpoints off stops it for the session', async ($, on) => {
    setup(on)
    tools(on, () => ({ ok: false, text: failure(1, 1) }))
    await $.session.start(START)
    expect((await $.command.run(run('jev-checkpoints', 'off'))).text).toBe('jev-checkpoints: off for this session')
    await $.tool.call({ tool: 'Bash', command: 'x' })
    const r = await $.tool.call({ tool: 'Bash', command: 'x' })
    expect('context' in r ? r.context : undefined).toBeUndefined()
  })
})

describe('spawn checkpoint', () => {
  const spawnArgs = (extra: Record<string, unknown> = {}) =>
    ({ prompt: 'Find where the parser handles nested blocks. TOP-SECRET-PROMPT', description: 'find parser code', subagentType: 'Explore', ...extra }) as never

  test('shadow: asks, never alters the spawn, logs one record without the prompt', async ($, on) => {
    const { w } = setup(on)
    const seen: (string | undefined)[] = []
    on('agent.spawn', ($, e) => (seen.push(e.model), { model: e.model ?? 'claude-sonnet-4-6', agentId: 'a1' }))
    w.reply = [choice('haiku', 0.97)]
    await $.session.start(START)
    const r = await $.agent.spawn(spawnArgs())

    expect(r).toMatchObject({ agentId: 'a1' })
    expect(seen).toEqual([undefined])
    expect(w.requests[0]!.body).toMatchObject({ questions: { tier: { type: 'choice' } }, state: { subagent_type: 'Explore', description: 'find parser code' } })
    const lines = (w.files.get(SHADOW) ?? '').split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('TOP-SECRET-PROMPT')
    expect(JSON.parse(lines[0]!)).toMatchObject({ session: SESSION, subagent_type: 'Explore', caller_model: 'inherit', jev_choice: 'haiku', confidence: 0.97, enforced: false })
    expect((await $.command.run(run('jev-checkpoints'))).text).toContain('spawn agreement with the caller: 0/1 (0%)')
  })

  test('off: no request, no log', { options: { spawnMode: 'off' } }, async ($, on) => {
    const { w } = setup(on)
    on('agent.spawn', ($, e) => ({ model: e.model ?? 'x' }))
    await $.session.start(START)
    await $.agent.spawn(spawnArgs())
    expect(w.requests).toHaveLength(0)
    expect(w.files.has(SHADOW)).toBe(false)
  })

  test('enforce: a confident downgrade on an unpinned agent is applied and logged as enforced', { options: { spawnMode: 'enforce' } }, async ($, on) => {
    const { w } = setup(on, { files: { [`${ROOT}/.claude/agents/scout.md`]: '---\nname: scout\n---\nFind things.' } })
    const seen: (string | undefined)[] = []
    on('agent.spawn', ($, e) => (seen.push(e.model), { model: e.model ?? 'claude-sonnet-4-6' }))
    w.reply = [choice('haiku', 0.9)]
    await $.session.start(START)
    await $.agent.spawn(spawnArgs({ subagentType: 'scout' }))

    expect(seen).toEqual(['haiku'])
    expect(JSON.parse((w.files.get(SHADOW) ?? '').trim())).toMatchObject({ jev_choice: 'haiku', enforced: true })
  })

  const untouched: [string, Record<string, unknown>, ReturnType<typeof choice>, string?][] = [
    ['the caller named a model', { subagentType: 'general-purpose', model: 'sonnet' }, choice('haiku', 0.99)],
    ['the definition pins one', { subagentType: 'Explore' }, choice('sonnet', 0.99)],
    ['an unknown built-in counts as pinned', { subagentType: 'Plan' }, choice('haiku', 0.99)],
    ['confidence is under the bar', { subagentType: 'general-purpose' }, choice('haiku', 0.6)],
    ['it would upgrade beyond the main model', { subagentType: 'general-purpose' }, choice('opus', 0.99)],
    ['Jev says inherit', { subagentType: 'general-purpose' }, choice('inherit', 0.99)],
  ]
  for (const [why, extra, reply] of untouched) {
    test(`enforce leaves the spawn alone when ${why}`, { options: { spawnMode: 'enforce' } }, async ($, on) => {
      const { w } = setup(on, { files: { [`${HOME}/.claude/agents/Explore.md`]: '---\nname: Explore\nmodel: haiku\n---\n' } })
      const seen: (string | undefined)[] = []
      on('agent.spawn', ($, e) => (seen.push(e.model), { model: e.model ?? 'claude-sonnet-4-6' }))
      w.reply = [reply]
      await $.session.start(START)
      await $.agent.spawn(spawnArgs(extra))

      expect(seen).toEqual([extra['model'] as string | undefined])
      expect(JSON.parse((w.files.get(SHADOW) ?? '').trim())).toMatchObject({ enforced: false })
    })
  }

  test('enforce fails open: a timeout or error spawns as asked', { options: { spawnMode: 'enforce' } }, async ($, on) => {
    const { w } = setup(on)
    const seen: (string | undefined)[] = []
    on('agent.spawn', ($, e) => (seen.push(e.model), { model: e.model ?? 'claude-sonnet-4-6' }))
    w.reply = [{ status: 429, body: {} }]
    await $.session.start(START)
    await $.agent.spawn(spawnArgs({ subagentType: 'general-purpose' }))
    expect(seen).toEqual([undefined])
    expect(w.files.has(SHADOW)).toBe(false)
  })
})

describe('/jev-checkpoints', () => {
  test('registers, reports status, and switches per session', async ($, on) => {
    const { w, contexts } = setup(on)
    w.reply = [score('plan', 0.99)]
    await $.session.start(START)
    expect(w.commands).toEqual(['jev-checkpoints'])

    const status = (await $.command.run(run('jev-checkpoints', 'status'))).text ?? ''
    expect(status).toContain('jev-checkpoints: on for this session')
    expect(status).toContain('endpoint https://api.typesafe.ai/v1/systemone (cloud, key set)')
    expect(status).toContain('not email-tainted')

    await $.command.run(run('jev-checkpoints', 'off'))
    await $.prompt.submit(prompt(PLAN_PROMPT))
    expect(w.requests).toHaveLength(0)
    expect((await $.command.run(run('jev-checkpoints'))).text).toContain('jev-checkpoints: off for this session')

    await $.command.run(run('jev-checkpoints', 'on'))
    await $.prompt.submit(prompt(PLAN_PROMPT))
    expect(w.requests).toHaveLength(1)
    expect(contexts).toEqual([undefined, [LINES.plan]])
    expect((await $.command.run(run('jev-checkpoints'))).text).toMatch(/plan\s+on\s+1 requests, \$0\.00004, 1 injections/)

    expect((await $.command.run(run('jev-checkpoints', 'bogus'))).text).toBe('jev-checkpoints: usage: /jev-checkpoints [status|on|off]')
  })
})
