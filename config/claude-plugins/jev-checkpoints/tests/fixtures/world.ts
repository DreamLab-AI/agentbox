import type { HttpInit, On } from 'claude-code'

/**
 * The world beneath the plugin, answered from memory: a session, a file map,
 * the environment, a scripted Jev endpoint, and what the plugin logged. Each
 * noun answers `{ value }` as the engine's own ops do.
 */
export type World = {
  readonly files: Map<string, string>
  /** Paths that exist but whose read is refused (a permissions fault, say). */
  readonly unreadable: Set<string>
  readonly logs: string[]
  readonly commands: string[]
  /** Every request the plugin sent: the URL, the init and the parsed body. */
  readonly requests: { url: string; init: HttpInit | undefined; body: Record<string, unknown> }[]
  /** How the next requests are answered, in order; the last one repeats. */
  reply: Reply[]
}

/** A scripted answer: a response, or `hang` (never answers, for the deadline). */
export type Reply = { status: number; body: unknown } | 'hang'

export const ROOT = '/work'
export const HOME = '/home/tester'
export const SESSION = 'sess-1'
export const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const

export function world(on: On, opts: { files?: Record<string, string>; model?: string } = {}): World {
  const w: World = { files: new Map(Object.entries(opts.files ?? {})), unreadable: new Set(), logs: [], commands: [], requests: [], reply: [] }

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSION }))
  on('session.model', () => ({ value: opts.model ?? 'claude-sonnet-4-6' }))
  on('session.root', () => ({ value: ROOT }))
  on('fs.exists', ($, e) => ({ value: w.files.has(e.path) }))
  on('fs.stat', ($, e) => {
    const text = w.files.get(e.path)
    if (text === undefined) return { deny: `ENOENT: no such file or directory, '${e.path}'` }
    return { value: { kind: 'file' as const, size: new TextEncoder().encode(text).length, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', ($, e) => {
    if (w.unreadable.has(e.path)) return { deny: `EACCES: permission denied, '${e.path}'` }
    const text = w.files.get(e.path)
    if (text === undefined) return { deny: `ENOENT: no such file or directory, '${e.path}'` }
    return { value: text }
  })
  on('fs.write', ($, e) => {
    w.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('command.register', ($, e) => {
    w.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.log', ($, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('http.fetch', async ($, e) => {
    w.requests.push({ url: e.url, init: e.init, body: JSON.parse(e.init?.body ?? '{}') as Record<string, unknown> })
    const r = w.reply.length > 1 ? w.reply.shift()! : w.reply[0]
    if (r === undefined) return { value: { status: 500, ok: false, headers: {}, text: '' } }
    if (r === 'hang') return new Promise<never>(() => {})
    return { value: { status: r.status, ok: r.status >= 200 && r.status < 300, headers: {}, text: typeof r.body === 'string' ? r.body : JSON.stringify(r.body) } }
  })
  return w
}

/** A Jev answer holding one two-band score question. */
export const score = (name: string, value: number, inputTokens = 1000) => ({
  status: 200,
  body: {
    model: 'jev-1.13.0',
    answers: { [name]: { type: 'score', score: value, legend: { '0': 'no', '1': 'yes' }, probabilities: { '0': 1 - value, '1': value } } },
    usage: { input_tokens: inputTokens, output_tokens: 0 },
  },
})

/** A Jev answer holding the done score and the claim-specific Noul together (AB-08-S1-01). */
export const doneAndClaim = (doneValue: number, claimUnverified: number, inputTokens = 1000) => ({
  status: 200,
  body: {
    model: 'jev-latest',
    answers: {
      done: { type: 'score', score: doneValue, legend: { '0': 'no', '1': 'yes' }, probabilities: { '0': 1 - doneValue, '1': doneValue } },
      claim_unverified: { type: 'noul', noul: claimUnverified },
    },
    usage: { input_tokens: inputTokens, output_tokens: 1 },
  },
})

/** A Jev answer to the spawn checkpoint's choice. */
export const choice = (pick: string, confidence: number) => ({
  status: 200,
  body: {
    model: 'jev-1.13.0',
    answers: { tier: { type: 'choice', choice: pick, probabilities: { [pick]: confidence }, confidence } },
    usage: { input_tokens: 800, output_tokens: 0 },
  },
})

/** A prompt the person typed and sent. */
export const prompt = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const

const PRESENTATION = { isFullscreen: false, columns: 100 }
export const run = (command: string, args = '') => ({ command, args, origin: { kind: 'composer' as const }, presentation: PRESENTATION })

/** A finished main-loop turn. */
export const turn = (answer: string, turnId = 't1') => ({ answer, durationMs: 1, isAborted: false, turnId, reason: 'answer' as const })

export const KEY = { TYPESAFE_API_KEY: 'test-key', HOME }
