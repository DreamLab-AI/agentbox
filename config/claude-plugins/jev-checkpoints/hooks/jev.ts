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
export type Question = ScoreQuestion | ChoiceQuestion

export type JevRequest = {
  state: Record<string, string>
  model: string
  questions: Record<string, Question>
}

/** A score question with two bands, lowest first: its normalised score is P(the second). */
export function scoreQuestion(instructions: string, no: string, yes: string): ScoreQuestion {
  return { type: 'score', instructions, criteria: [no, yes] }
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

/** True for a loopback, link-local, private-range, `.local`/`.internal` or single-label (container network) host. */
export function isLocalApi(api: string): boolean {
  let host: string
  try {
    host = new URL(api).hostname.toLowerCase()
  } catch {
    return false
  }
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)
  }
  if (host.includes(':')) return host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)
  return !host.includes('.')
}

export type Egress = { go: true; local: boolean } | { go: false; reason: 'switched-off' | 'tainted' | 'no-key' }

/**
 * Whether a cloud-or-local Jev request may be made. The per-session switch
 * first; then the email fence, which a local endpoint passes because nothing
 * leaves the network; then the key, which a local endpoint does not need.
 */
export function egress(args: { enabled: boolean; tainted: boolean; hasKey: boolean; api: string }): Egress {
  if (!args.enabled) return { go: false, reason: 'switched-off' }
  const local = isLocalApi(args.api)
  if (args.tainted && !local) return { go: false, reason: 'tainted' }
  if (!args.hasKey && !local) return { go: false, reason: 'no-key' }
  return { go: true, local }
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
