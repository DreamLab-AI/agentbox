/**
 * The one Jev (TypeSafe System One) client of the plugin: request bodies,
 * response readers, the egress decision and a fail-open call.
 *
 * Wire shape as `config/hooks/lib/skill-route.cjs` and the System One wire
 * (`crates/system-one/system-one-core/src/wire.rs`) speak it:
 *   POST {state, model, questions: {name: {type, instructions, criteria}}}
 *   → {model, answers: {name: answer}, usage: {input_tokens, output_tokens}}
 * A `choice` answer is `{choice, probabilities, confidence}`; a `score` answer
 * is `{score, legend, probabilities}` with `score` in [0, levels − 1].
 */

import type { HttpInit, HttpResponse } from 'claude-code'

export type ScoreQuestion = { type: 'score'; instructions: string; criteria: string[] }
export type ChoiceQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> }
export type NoulQuestion = { type: 'noul'; instructions: string }
export type Question = ScoreQuestion | ChoiceQuestion | NoulQuestion

export type JevRequest = {
  state: Record<string, string>
  model: string
  questions: Record<string, Question>
}

/** A score question with two bands, lowest first: its normalised score is P(the second). */
export function scoreQuestion(instructions: string, no: string, yes: string): ScoreQuestion {
  return { type: 'score', instructions, criteria: [no, yes] }
}

/** A yes/no question: its answer is the probability of yes. The instructions carry the whole meaning. */
export function noulQuestion(instructions: string): NoulQuestion {
  return { type: 'noul', instructions }
}

/** What one request came to. Never thrown: every failure is an outcome. */
export type JevOutcome =
  | { ok: true; answers: Record<string, unknown>; model: string; inputTokens: number; usd: number; ms: number }
  | { ok: false; reason: string; ms: number }

/**
 * A score answer as a number in [0, 1]: `score / (levels − 1)`, from `legend`
 * (or `probabilities`) for the level count; the expected level from
 * `probabilities` when `score` is absent. Null for any other shape.
 */
export function readScore(answer: unknown): number | null {
  if (!answer || typeof answer !== 'object') return null
  const a = answer as Record<string, unknown>
  const probs = a['probabilities'] && typeof a['probabilities'] === 'object' ? (a['probabilities'] as Record<string, unknown>) : null
  const legend = a['legend'] && typeof a['legend'] === 'object' ? (a['legend'] as Record<string, unknown>) : null
  const levels = Object.keys(legend ?? probs ?? {}).length
  if (levels < 2) return null
  let raw: number | null = typeof a['score'] === 'number' && Number.isFinite(a['score']) ? (a['score'] as number) : null
  if (raw === null && probs) {
    let sum = 0
    let mass = 0
    for (const [k, v] of Object.entries(probs)) {
      const i = Number(k)
      if (!Number.isInteger(i) || typeof v !== 'number' || !Number.isFinite(v)) return null
      sum += i * v
      mass += v
    }
    if (mass <= 0) return null
    raw = sum / mass
  }
  if (raw === null) return null
  return Math.min(1, Math.max(0, raw / (levels - 1)))
}

/** A noul answer as the probability of yes in [0, 1]; null for any other shape. */
export function readNoul(answer: unknown): number | null {
  if (!answer || typeof answer !== 'object') return null
  const p = (answer as Record<string, unknown>)['noul']
  return typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1 ? p : null
}

/**
 * Whether the done checkpoint injects. Without the claim check this is exactly the original
 * rule: a readable score at or above `threshold`. With it (AB-08-S1-01, off by default) a
 * readable score still gates, and a turn the score left under the bar also injects when the
 * claim-specific Noul reads at or above `claimThreshold`. A missing or malformed Noul changes
 * nothing, and the claim check can only ever ADD the advisory line, never remove it.
 */
export function doneInjects(args: {
  score: number | null
  threshold: number
  claimCheck: boolean
  claimUnverified: number | null
  claimThreshold: number
}): boolean {
  if (args.score === null) return false
  if (args.score >= args.threshold) return true
  return args.claimCheck && args.claimUnverified !== null && args.claimUnverified >= args.claimThreshold
}

/** A choice answer as `{choice, confidence}`, the choice one of `allowed`; null for any other shape. */
export function readChoice(answer: unknown, allowed: readonly string[]): { choice: string; confidence: number | null } | null {
  if (!answer || typeof answer !== 'object') return null
  const a = answer as Record<string, unknown>
  const choice = a['choice']
  if (typeof choice !== 'string' || !allowed.includes(choice)) return null
  let confidence: number | null = typeof a['confidence'] === 'number' && Number.isFinite(a['confidence']) ? (a['confidence'] as number) : null
  if (confidence === null && a['probabilities'] && typeof a['probabilities'] === 'object') {
    const p = (a['probabilities'] as Record<string, unknown>)[choice]
    if (typeof p === 'number' && Number.isFinite(p)) confidence = p
  }
  return { choice, confidence: confidence === null ? null : Math.min(1, Math.max(0, confidence)) }
}

// ── egress ────────────────────────────────────────────────────────────────

/**
 * True when `api` is TypeSafe's own cloud: https on `typesafe.ai` or a
 * subdomain of it. The only host `TYPESAFE_API_KEY` is ever sent to.
 */
export function isTypeSafeApi(api: string): boolean {
  try {
    const u = new URL(api)
    const host = u.hostname.toLowerCase()
    return u.protocol === 'https:' && (host === 'typesafe.ai' || host.endsWith('.typesafe.ai'))
  } catch {
    return false
  }
}

export type Egress = { go: true; sendKey: boolean } | { go: false; reason: 'switched-off' | 'tainted' | 'no-key' }

/**
 * Whether a Jev request may be made, and with the key or without.
 *
 * Locality is declared (`backendLocal`), never guessed from the URL
 * (ADR-2094 §5). In order: the per-session switch; the email fence, which
 * only a declared-local backend passes; then the key, which is sent to
 * TypeSafe's host alone. A declared-local backend never receives it, and
 * neither does any other endpoint: a request there goes without one.
 */
export function egress(args: { enabled: boolean; tainted: boolean; hasKey: boolean; api: string; backendLocal: boolean }): Egress {
  if (!args.enabled) return { go: false, reason: 'switched-off' }
  if (args.tainted && args.backendLocal !== true) return { go: false, reason: 'tainted' }
  const sendKey = args.backendLocal !== true && isTypeSafeApi(args.api)
  if (sendKey && !args.hasKey) return { go: false, reason: 'no-key' }
  return { go: true, sendKey }
}

// ── the call ──────────────────────────────────────────────────────────────

export type JevDeps = {
  fetch: (url: string, init: HttpInit) => Promise<HttpResponse>
  /** `$.clock.after`: the deadline's timer. */
  after: (ms: number, fn: () => void) => { cancel: () => void }
  now: () => Promise<number>
}

export type JevConfig = { api: string; key: string | undefined; timeoutMs: number; usdPerMTokIn: number }

/**
 * One request, no retry (a hook must not wait on a 429), raced against the
 * deadline. Resolves an outcome; never rejects.
 */
export async function askJev(deps: JevDeps, cfg: JevConfig, body: JevRequest): Promise<JevOutcome> {
  let t0 = 0
  try {
    t0 = await deps.now()
  } catch {
    /* timing is reporting only */
  }
  const elapsed = async () => {
    try {
      return Math.max(0, (await deps.now()) - t0)
    } catch {
      return 0
    }
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.key) headers['Authorization'] = `Bearer ${cfg.key}`

  let timer: { cancel: () => void } | undefined
  const deadline = new Promise<'timeout'>(resolve => {
    try {
      timer = deps.after(cfg.timeoutMs, () => resolve('timeout'))
    } catch {
      /* no timer: the host's own fetch limit is the deadline */
    }
  })
  let res: HttpResponse | 'timeout'
  try {
    res = await Promise.race([deps.fetch(cfg.api, { method: 'POST', headers, body: JSON.stringify(body) }), deadline])
  } catch (error) {
    timer?.cancel()
    return { ok: false, reason: `network: ${error instanceof Error ? error.message : String(error)}`.slice(0, 160), ms: await elapsed() }
  }
  timer?.cancel()
  const ms = await elapsed()
  if (res === 'timeout') return { ok: false, reason: 'timeout', ms }
  if (!res.ok) return { ok: false, reason: `http-${res.status}`, ms }
  let j: unknown
  try {
    j = JSON.parse(res.text)
  } catch {
    return { ok: false, reason: 'bad-json', ms }
  }
  if (!j || typeof j !== 'object') return { ok: false, reason: 'bad-shape', ms }
  const o = j as Record<string, unknown>
  const answers = o['answers']
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return { ok: false, reason: 'bad-shape', ms }
  const usage = o['usage'] && typeof o['usage'] === 'object' ? (o['usage'] as Record<string, unknown>) : {}
  const inputTokens = typeof usage['input_tokens'] === 'number' && usage['input_tokens'] >= 0 ? usage['input_tokens'] : 0
  return {
    ok: true,
    answers: answers as Record<string, unknown>,
    model: typeof o['model'] === 'string' ? o['model'] : '',
    inputTokens,
    usd: (inputTokens * cfg.usdPerMTokIn) / 1e6,
    ms,
  }
}
