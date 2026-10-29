// register.ts — jev-checkpoints (ADR-2135): Jev as a cheap timing judge for
// when the Opus advisor (ADR-2134, `advisorModel`) is worth consulting.
//
// Four checkpoints, each switchable, none ever forcing a tool call:
//   • done   — turn.complete: a completion claim without a verifying run →
//              one advisory line on the next prompt;
//   • repeat — tool.call: the same failure fingerprint N times → one line on
//              that tool result; local only, never calls Jev;
//   • plan   — prompt.submit: a request that needs a multi-file plan or
//              touches a contract → one line beside the prompt;
//   • spawn  — agent.spawn: Jev picks a model tier; shadow (logged only) by
//              default, enforce rewrites a subagent's model under strict rules.
//
// Fail-open everywhere: any error, timeout, 429, malformed answer or missing
// key means no injection, no block and one log line. A session that touched
// email is judged only by a backend declared local (`backendLocal`, never
// guessed from the URL). The key goes to TypeSafe's host alone. Tool-result
// contents never leave the process.

import type { EngineInterface, On, Register } from 'claude-code'

import { fingerprint, watchesTool } from './fingerprint'
import { askJev, doneInjects, egress, isTypeSafeApi, noulQuestion, readChoice, readNoul, readScore, scoreQuestion } from './jev'
import type { JevOutcome, JevRequest } from './jev'
import { readOptions } from './options'
import type { Options } from './options'
import { agrees, enforceDecision, joinLine, pinned, PICKS, SHADOW_MAX_SEGMENTS, SHADOW_SEGMENT_BYTES, shadowPath, shadowRecord, SPAWN_QUESTION, spawnState } from './spawn'
import type { Pick, ShadowRecord } from './spawn'
import { countFailure, loadShared, markAdvised, mayInject, prunePlan, readRecord, sessionKey, statusText, switchKey } from './state'
import type { Checkpoint, SessionCache, SessionRecord } from './state'
import { factrailTainted, isTaintSkill, sha256_12, storeFileName, taintOf } from './taint'
import type { TaintRules } from './taint'
import { claimsCompletion, clamp, evidenceList, firstLine, line, LINES, planSkip, tail } from './text'
import type { ToolEvidence } from './text'

const COMMAND = 'jev-checkpoints'
const NAME = 'jev-checkpoints'

/** Prompt origins a person stands behind; notifications and plugin prompts are neither planned nor advised. */
const PERSON_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk'])

const DONE_QUESTIONS: JevRequest['questions'] = {
  done: scoreQuestion(
    'Does `assistant_final_text` claim the task is done, fixed or passing although no test, build, lint or type-check ' +
      'ran successfully this turn? `tool_calls_this_turn` lists every tool call of the turn (name, ok or error, and a ' +
      'shell command’s first line).',
    'no — no completion is claimed, or a test, build, lint or type-check ran successfully this turn',
    'yes — completion is claimed without any successful verifying run this turn',
  ),
}

/**
 * AB-08-S1-01 (opt-in `claimCheck`, off by default): asked in the SAME request as the done score, over
 * the same state, so it adds no call and no content class. It names the specific claim and asks
 * whether any successful call listed this turn plausibly verifies it.
 */
const CLAIM_QUESTIONS: JevRequest['questions'] = {
  claim_unverified: noulQuestion(
    'Does `assistant_final_text` claim a specific deliverable (a fix, a feature, or passing checks) that no successful call in ' +
      '`tool_calls_this_turn` plausibly verifies? A test, build, lint or type-check that ran successfully and exercises that ' +
      'change verifies it; an unrelated command, an edit alone, or a failed run does not.',
  ),
}

const PLAN_QUESTIONS: JevRequest['questions'] = {
  plan: scoreQuestion(
    'Does `user_request` need a multi-file implementation plan, or does it touch an authentication, authorisation, ' +
      'database schema, public API or data contract?',
    'no — a question, a conversational reply, or a small change confined to one place',
    'yes — a multi-file implementation, or a change to an auth, schema, API or data contract',
  ),
}

type Engine = EngineInterface

/** What the hooks share: the options and the module's live state. */
type Ctx = {
  readonly opts: Options
  readonly taint: TaintRules
  /** Live session records and first loads under way; `$.store` is written through on every change. */
  readonly cache: SessionCache
  /** The shadow-log segment each session is writing (`shadowPath`). */
  readonly segments: Map<string, number>
  /** This main-loop turn's tool calls, as done-checkpoint evidence. */
  turnCalls: ToolEvidence[]
  /**
   * Spawn records and their shadow-log writes, one at a time (there is no
   * append on `$.fs`); never rejects.
   */
  logChain: Promise<void>
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function sessionId($: Engine): Promise<string> {
  try {
    return (await $.session.id()) || 'unknown'
  } catch {
    return 'unknown'
  }
}

/** The stored record, or a fresh one; never rejects. */
async function readStored($: Engine, id: string): Promise<SessionRecord> {
  let now = 0
  try {
    now = await $.clock.now()
  } catch {
    /* a fresh record dated 0 is pruned at the next start, taint excepted */
  }
  let stored: unknown
  try {
    stored = await $.store.get(sessionKey(id))
  } catch {
    stored = undefined
  }
  return readRecord(stored, now)
}

/** The session's one live record (`loadShared`): concurrent first loads share one read. */
function load($: Engine, ctx: Ctx, id: string): Promise<SessionRecord> {
  return loadShared(ctx.cache, id, () => readStored($, id))
}

async function save($: Engine, id: string, rec: SessionRecord): Promise<void> {
  try {
    rec.at = await $.clock.now()
    await $.store.set(sessionKey(id), rec)
  } catch {
    /* bookkeeping only: the live copy still holds */
  }
}

/** The per-session switch; on unless `/jev-checkpoints off` set it. */
async function isOn($: Engine, id: string): Promise<boolean> {
  try {
    return (await $.store.get(switchKey(id))) !== false
  } catch {
    return true
  }
}

function log($: Engine, text: string): void {
  try {
    $.ui.log(`${NAME}: ${text}`)
  } catch {
    /* logging only */
  }
}

/** Taints the session for good. */
async function taint($: Engine, ctx: Ctx, id: string, why: string | null): Promise<void> {
  if (!why) return
  const rec = await load($, ctx, id)
  if (rec.tainted) return
  rec.tainted = why
  await save($, id, rec)
}

/** The sticky taint, widened by factrail's own record of this session when that store can be read. */
async function isTainted($: Engine, id: string, rec: SessionRecord): Promise<boolean> {
  if (rec.tainted) return true
  try {
    const home = await $.env.get('HOME')
    if (home) {
      const file = `${home}/.claude/plugins/store/${await storeFileName('factrail', 'agentbox')}`
      if ((await $.fs.exists(file)) && factrailTainted(await $.fs.read(file), id)) {
        rec.tainted = 'factrail'
        await save($, id, rec)
        return true
      }
    }
  } catch {
    /* factrail's store is a widening, not a dependency */
  }
  return false
}

/** One Jev request for one checkpoint, behind the switch, the fence and the key. Null: nothing was asked. */
async function ask($: Engine, ctx: Ctx, id: string, rec: SessionRecord, c: Checkpoint, body: JevRequest): Promise<JevOutcome | null> {
  const key = await $.env.get('TYPESAFE_API_KEY')
  const gate = egress({
    enabled: await isOn($, id),
    tainted: await isTainted($, id, rec),
    hasKey: !!key,
    api: ctx.opts.api,
    backendLocal: ctx.opts.backendLocal,
  })
  if (!gate.go) {
    if (gate.reason === 'no-key' && !rec.saidNoKey) {
      rec.saidNoKey = true
      log($, 'TYPESAFE_API_KEY is unset — the Jev checkpoints are idle (repeat still runs)')
      await save($, id, rec)
    }
    return null
  }
  const stats = rec.stats[c]
  stats.requests += 1
  const out = await askJev(
    {
      fetch: (url, init) => $.http.fetch(url, init),
      after: (ms, fn) => $.clock.after(ms, fn),
      now: () => $.clock.now(),
    },
    { api: ctx.opts.api, key: gate.sendKey ? key || undefined : undefined, timeoutMs: ctx.opts.timeoutMs, usdPerMTokIn: ctx.opts.usdPerMTokIn },
    body,
  )
  if (out.ok) stats.usd += out.usd
  else {
    stats.lastError = out.reason
    log($, `${c} skipped (${out.reason})`)
  }
  await save($, id, rec)
  return out
}

async function mainModel($: Engine): Promise<string | undefined> {
  try {
    return await $.session.model()
  } catch {
    return undefined
  }
}

/** The agent's definition file text, project first then user; undefined when none is found. */
async function agentDefinition($: Engine, type: string): Promise<string | undefined> {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(type)) return undefined // a plugin's `<plugin>:<name>` or anything odd: unknown
  const dirs: string[] = []
  try {
    dirs.push(`${await $.session.root()}/.claude/agents`)
  } catch {
    /* no project root */
  }
  const home = await $.env.get('HOME')
  if (home) dirs.push(`${home}/.claude/agents`)
  for (const dir of dirs) {
    try {
      const file = `${dir}/${type}.md`
      if (await $.fs.exists(file)) return await $.fs.read(file)
    } catch {
      /* unreadable: try the next */
    }
  }
  return undefined
}

/**
 * Adds one line to this session's shadow log. `$.fs` has no append, so each
 * session owns its files (`shadowPath`) and only this process's chain writes
 * them. A segment that is full, not a file, or unreadable is never
 * rewritten: the line goes to the next segment, so existing data is never
 * truncated.
 */
async function appendShadow($: Engine, ctx: Ctx, session: string, record: ShadowRecord): Promise<void> {
  let base = ctx.opts.shadowLog
  if (base.startsWith('~/')) base = `${(await $.env.get('HOME')) ?? ''}${base.slice(1)}`
  const bytes = new TextEncoder().encode(`${JSON.stringify(record)}\n`).length
  let n = ctx.segments.get(session) ?? 0
  for (let tries = 0; tries < SHADOW_MAX_SEGMENTS; tries++, n++) {
    const path = shadowPath(base, session, n)
    let existing = ''
    try {
      if (await $.fs.exists(path)) {
        const st = await $.fs.stat(path)
        if (st.kind !== 'file' || st.size + bytes > SHADOW_SEGMENT_BYTES) continue
        existing = await $.fs.read(path)
      }
    } catch {
      continue // unreadable: left as it is; the next segment takes the line
    }
    await $.fs.write(path, joinLine(existing, record))
    ctx.segments.set(session, n)
    return
  }
  throw new Error(`no writable shadow-log segment after ${SHADOW_MAX_SEGMENTS}`)
}

/** Runs one task after those already queued; the returned promise is the task's own. */
function enqueue(ctx: Ctx, task: () => Promise<void>): Promise<void> {
  const run = ctx.logChain.then(task)
  ctx.logChain = run.catch(() => undefined)
  return run
}

async function commandText($: Engine, ctx: Ctx, args: string): Promise<string> {
  const id = await sessionId($)
  const arg = args.trim().toLowerCase()
  if (arg === 'on' || arg === 'off') {
    await $.store.set(switchKey(id), arg === 'on')
    return `${NAME}: ${arg} for this session`
  }
  if (arg !== '' && arg !== 'status') return `${NAME}: usage: /${COMMAND} [status|on|off]`
  const rec = await load($, ctx, id)
  await isTainted($, id, rec)
  const { opts } = ctx
  return statusText({
    enabled: await isOn($, id),
    rec,
    enabledChecks: { done: opts.doneCheck, repeat: opts.repeatCheck, plan: opts.planCheck, spawn: opts.spawnMode !== 'off' },
    spawnMode: opts.spawnMode,
    api: opts.api,
    backendLocal: opts.backendLocal,
    typeSafe: isTypeSafeApi(opts.api),
    hasKey: !!(await $.env.get('TYPESAFE_API_KEY')),
  })
}

/** Taint, done evidence and the repeat checkpoint for one finished tool call; the result, possibly with one line added. */
async function afterTool<R extends { context?: readonly string[] }>(
  $: Engine,
  ctx: Ctx,
  id: string,
  tool: string,
  input: Record<string, unknown>,
  agentId: string | undefined,
  result: R,
  isError: boolean,
  denied: boolean,
  text: string,
): Promise<R> {
  const { opts } = ctx
  if (!agentId) {
    const command = tool === 'Bash' && typeof input['command'] === 'string' ? firstLine(input['command']) : undefined
    ctx.turnCalls.push({ tool, ok: !isError && !denied, ...(command ? { command } : {}) })
    if (ctx.turnCalls.length > 200) ctx.turnCalls = ctx.turnCalls.slice(-200)
  }
  if (!opts.repeatCheck || !isError || !watchesTool(tool)) return result
  if (!(await isOn($, id))) return result
  const fp = fingerprint(tool, text, typeof input['command'] === 'string' ? input['command'] : undefined)
  if (!fp) return result
  // One fingerprint, one line, for the whole session: the main loop and every
  // subagent count the same failure together, and share the one-per-prompt cap.
  const rec = await load($, ctx, id)
  const n = countFailure(rec, fp, opts.repeatCount)
  if (n === null || !mayInject(rec, 'repeat')) {
    await save($, id, rec)
    return result
  }
  markAdvised(rec, fp)
  rec.lastInjected.repeat = rec.prompt
  rec.stats.repeat.injections += 1
  await save($, id, rec)
  return { ...result, context: [...(result.context ?? []), line(LINES.repeat(n))] }
}

/** The pending done line and the plan checkpoint for one prompt: the lines to attach. */
async function promptLines($: Engine, ctx: Ctx, id: string, text: string): Promise<string[]> {
  const { opts } = ctx
  const rec = await load($, ctx, id)
  rec.prompt += 1
  const lines: string[] = []
  if (rec.pendingDone) {
    rec.pendingDone = false
    if (mayInject(rec, 'done')) {
      lines.push(line(LINES.done))
      rec.lastInjected.done = rec.prompt
      rec.stats.done.injections += 1
    }
  }
  if (opts.planCheck && planSkip(text, opts.minChars) === null && mayInject(rec, 'plan')) {
    const out = await ask($, ctx, id, rec, 'plan', { state: { user_request: clamp(text) }, model: opts.model, questions: PLAN_QUESTIONS })
    if (out?.ok) {
      const score = readScore(out.answers['plan'])
      if (score === null) {
        rec.stats.plan.lastError = 'bad-shape'
        log($, 'plan skipped (bad-shape)')
      } else if (score >= opts.planThreshold) {
        lines.push(line(LINES.plan))
        rec.lastInjected.plan = rec.prompt
        rec.stats.plan.injections += 1
      }
    }
  }
  await save($, id, rec)
  return lines
}

/** The done checkpoint for one finished main-loop turn. */
async function doneCheck($: Engine, ctx: Ctx, answer: string): Promise<void> {
  if (!claimsCompletion(answer)) return
  const id = await sessionId($)
  const rec = await load($, ctx, id)
  const out = await ask($, ctx, id, rec, 'done', {
    state: { assistant_final_text: tail(answer), tool_calls_this_turn: evidenceList(ctx.turnCalls) },
    model: ctx.opts.model,
    questions: ctx.opts.claimCheck ? { ...DONE_QUESTIONS, ...CLAIM_QUESTIONS } : DONE_QUESTIONS,
  })
  if (!out?.ok) return
  const score = readScore(out.answers['done'])
  if (score === null) {
    rec.stats.done.lastError = 'bad-shape'
    log($, 'done skipped (bad-shape)')
  } else if (
    doneInjects({
      score,
      threshold: ctx.opts.doneThreshold,
      claimCheck: ctx.opts.claimCheck,
      claimUnverified: ctx.opts.claimCheck ? readNoul(out.answers['claim_unverified']) : null,
      claimThreshold: ctx.opts.claimThreshold,
    })
  ) {
    rec.pendingDone = true
  }
  await save($, id, rec)
}

type SpawnFacts = {
  subagentType: string
  description: string
  prompt: string
  model: string | undefined
  fork: boolean
  workflow: boolean
}

/** Enforce mode's verdict: the tier to rewrite to, or null; and the outcome it was judged on. */
async function enforcePick($: Engine, ctx: Ctx, id: string, rec: SessionRecord, e: SpawnFacts, body: JevRequest): Promise<{ out: JevOutcome | null; rewrite: string | null }> {
  const out = await ask($, ctx, id, rec, 'spawn', body)
  const pick = out?.ok ? readChoice(out.answers['tier'], PICKS) : null
  if (!pick) return { out, rewrite: null }
  // The definition is only read when it could matter: a caller-chosen model is never touched.
  const definition = e.model ? undefined : await agentDefinition($, e.subagentType)
  const decision = enforceDecision({
    pick: pick.choice as Pick,
    confidence: pick.confidence,
    minConfidence: ctx.opts.spawnMinConfidence,
    callerModel: e.model,
    mainModel: await mainModel($),
    fork: e.fork,
    workflow: e.workflow,
    pinned: e.model ? true : pinned(e.subagentType, definition),
  })
  return { out, rewrite: decision.rewrite }
}

/** Records one spawn decision: counts, agreement and the shadow-log line. */
async function recordSpawn($: Engine, ctx: Ctx, id: string, rec: SessionRecord, e: SpawnFacts, out: JevOutcome | null, enforced: boolean): Promise<void> {
  if (!out?.ok) return
  const pick = readChoice(out.answers['tier'], PICKS)
  if (!pick) {
    rec.stats.spawn.lastError = 'bad-shape'
    log($, 'spawn skipped (bad-shape)')
    await save($, id, rec)
    return
  }
  rec.spawn.decisions += 1
  if (agrees(pick.choice as Pick, e.model)) rec.spawn.agreements += 1
  if (enforced) {
    rec.spawn.enforced += 1
    rec.stats.spawn.injections += 1
  }
  await save($, id, rec)
  if (!ctx.opts.shadowLog) return
  await appendShadow(
    $,
    ctx,
    id,
    shadowRecord({
      now: await $.clock.now(),
      session: id,
      subagentType: e.subagentType,
      callerModel: e.model,
      pick: pick.choice as Pick,
      confidence: pick.confidence,
      enforced,
      ms: out.ms,
      usd: out.usd,
      promptDigest: await sha256_12(e.prompt),
    }),
  )
}

/**
 * Shadow mode's judge, run after the spawn has already gone ahead: ask, then
 * record on the chain. Never rejects; a failure is one log line.
 */
async function shadowSpawn($: Engine, ctx: Ctx, e: SpawnFacts, body: JevRequest): Promise<void> {
  try {
    const id = await sessionId($)
    const rec = await load($, ctx, id)
    const out = await ask($, ctx, id, rec, 'spawn', body)
    await enqueue(ctx, () => recordSpawn($, ctx, id, rec, e, out, false))
  } catch (error) {
    log($, `spawn record skipped (${message(error)})`)
  }
}

export const register: Register = (on: On, options) => {
  const opts = readOptions(options)
  const ctx: Ctx = {
    opts,
    taint: { tools: opts.taintTools, skills: opts.taintSkills },
    cache: { live: new Map(), loading: new Map() },
    segments: new Map(),
    turnCalls: [],
    logChain: Promise.resolve(),
  }

  // ── session.start: the command and housekeeping ─────────────────────────
  on('session.start', async ($, event, next) => {
    try {
      await $.command.register({
        name: 'jev-checkpoints',
        description: 'Jev advisor checkpoints: status | on | off (this session).',
        argumentHint: 'status|on|off',
      })
    } catch {
      /* an engine without command.register still runs the checkpoints */
    }
    try {
      const now = await $.clock.now()
      const keys = (await $.store.keys()).filter(k => /^(session|switch):/.test(k))
      const entries: [string, unknown][] = []
      for (const k of keys) entries.push([k, await $.store.get(k)])
      const plan = prunePlan(entries, now)
      for (const k of plan.remove) await $.store.delete(k)
      // A tainted session is never forgotten: it shrinks to its taint.
      for (const [k, v] of plan.shrink) await $.store.set(k, v)
    } catch {
      /* pruning never blocks a session */
    }
    return next(event)
  })

  // ── /jev-checkpoints status|on|off ──────────────────────────────────────
  on('command.run', { command: 'jev-checkpoints' }, async ($, event) => {
    try {
      return { text: await commandText($, ctx, event.args) }
    } catch (error) {
      return { text: `${NAME}: status failed (${message(error)})` }
    }
  })

  // ── taint at the source ────────────────────────────────────────────────
  on('skill.prompt', async ($, event, next) => {
    try {
      if (isTaintSkill(event.skill, ctx.taint)) await taint($, ctx, await sessionId($), `skill:${event.skill}`)
    } catch {
      /* never blocks a skill */
    }
    return next(event)
  })

  // ── tool.call: taint, done evidence, repeat ─────────────────────────────
  on('tool.call', async ($, event, next) => {
    const tool = String(event.tool)
    const input = event as unknown as Record<string, unknown>
    let id = 'unknown'
    try {
      id = await sessionId($)
      await taint($, ctx, id, taintOf(tool, input, ctx.taint))
    } catch {
      /* the fence is also checked at every request */
    }
    const result = await next(event)
    try {
      const isError = 'isError' in result && result.isError === true
      const denied = 'deny' in result && typeof result.deny === 'string'
      const text = typeof result.text === 'string' ? result.text : ''
      return await afterTool($, ctx, id, tool, input, event.agentId, result, isError, denied, text)
    } catch (error) {
      log($, `repeat skipped (${message(error)})`)
      return result
    }
  }).catch(($, e, next) => next(e)) // never blocks or alters a tool call on our failure

  // ── turn.start: a fresh evidence list for each main-loop turn ───────────
  on('turn.start', async ($, event, next) => {
    ctx.turnCalls = []
    return next(event)
  })

  // ── prompt.submit: the pending done line and the plan checkpoint ────────
  on('prompt.submit', async ($, event, next) => {
    if (!PERSON_ORIGINS.has(event.origin.kind)) return next(event)
    const id = await sessionId($)
    if (!(await isOn($, id))) return next(event)
    const lines = await promptLines($, ctx, id, typeof event.text === 'string' ? event.text : '')
    const existing = event.context ?? []
    const fresh = lines.filter(l => !existing.includes(l))
    return next(fresh.length ? { ...event, context: [...existing, ...fresh] } : event)
  }).catch(($, e, next) => next(e)) // a failure never blocks a prompt

  // ── turn.complete: the done checkpoint ─────────────────────────────────
  on('turn.complete', async ($, event, next) => {
    const result = await next(event)
    if (event.agentId || event.reason !== 'answer' || !opts.doneCheck) return result
    try {
      await doneCheck($, ctx, event.answer ?? '')
    } catch (error) {
      log($, `done skipped (${message(error)})`)
    }
    return result
  })

  // ── agent.spawn: shadow by default, enforce under strict rules ─────────
  on('agent.spawn', async ($, event, next) => {
    if (opts.spawnMode === 'off' || event.fork) return next(event)
    const facts: SpawnFacts = {
      subagentType: event.subagentType,
      description: event.description,
      prompt: event.prompt,
      model: event.model,
      fork: event.fork,
      workflow: event.workflow !== undefined,
    }
    const body: JevRequest = {
      state: spawnState(event.subagentType, event.description, event.prompt),
      model: opts.model,
      questions: { tier: SPAWN_QUESTION },
    }
    if (opts.spawnMode !== 'enforce') {
      // Shadow: the spawn goes ahead untouched and unwaited; the judge is asked
      // and recorded afterwards, detached, and changes nothing.
      void shadowSpawn($, ctx, facts, body)
      return next(event)
    }
    // Enforce waits for the verdict, within the judge's deadline.
    const id = await sessionId($)
    const rec = await load($, ctx, id)
    const verdict = await enforcePick($, ctx, id, rec, facts, body)
    const result = await next(verdict.rewrite ? { ...event, model: verdict.rewrite } : event)
    enqueue(ctx, () => recordSpawn($, ctx, id, rec, facts, verdict.out, verdict.rewrite !== null)).catch((error: unknown) =>
      log($, `spawn record skipped (${message(error)})`),
    )
    return result
  }).catch(($, e, next) => next(e)) // a failure never refuses a spawn
}
