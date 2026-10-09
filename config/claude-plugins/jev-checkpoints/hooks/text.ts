/**
 * Pure text helpers: the egress clamp, the done checkpoint's local pre-gate,
 * the compact tool-call evidence and the injected lines.
 */

/** Jev's shared state+questions budget is ~32k tokens; these match skill-route.cjs. */
export const HEAD_CHARS = 9000
export const TAIL_CHARS = 3000
/** Every injected line is paid for in the primary model's input. */
export const MAX_LINE_CHARS = 300

/** Head 9000 + tail 3000 of a long text, the elision said in between; short text unchanged. */
export function clamp(text: string, head = HEAD_CHARS, tail = TAIL_CHARS): string {
  if (text.length <= head + tail) return text
  return `${text.slice(0, head)}\n[… ${text.length - head - tail} chars elided …]\n${text.slice(-tail)}`
}

/** The last `n` characters, for a text whose end carries the claim (the done checkpoint). */
export function tail(text: string, n = HEAD_CHARS + TAIL_CHARS): string {
  return text.length <= n ? text : `[… ${text.length - n} chars elided …]\n${text.slice(-n)}`
}

/**
 * Wording that claims the work is finished. The pre-gate is deliberately broad:
 * a false positive costs one cheap request, a false negative a missed checkpoint.
 */
const COMPLETION = new RegExp(
  [
    String.raw`\b(?:done|finished|complete[sd]?|completed)\b`,
    String.raw`\b(?:fixed|resolved|implemented|shipped|landed|works(?: now)?|working now)\b`,
    String.raw`\b(?:all|tests?|checks?|builds?|gates?)\b[^.\n]{0,40}\b(?:pass(?:es|ed|ing)?|green|succeed(?:s|ed)?)\b`,
    String.raw`\bpass(?:es|ed|ing)\b`,
    String.raw`\b(?:ready (?:to|for) (?:merge|review|ship))\b`,
    String.raw`\bshould (?:now )?(?:work|pass|be fixed)\b`,
  ].join('|'),
  'i',
)

/** True when the assistant's final text claims completion; no claim, no request. */
export function claimsCompletion(answer: string): boolean {
  return COMPLETION.test(answer)
}

/** The first non-empty line, trimmed and cut to `max` characters. */
export function firstLine(text: string, max = 160): string {
  const line = text.split('\n').map(l => l.trim()).find(l => l !== '') ?? ''
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`
}

/** One tool call of the turn as evidence: name, outcome and, for Bash, the command's first line. */
export type ToolEvidence = { readonly tool: string; readonly ok: boolean; readonly command?: string }

/** The compact evidence list: `Bash ok: cargo test`, one per line, never a result's contents. */
export function evidenceList(calls: readonly ToolEvidence[], max = 40): string {
  if (calls.length === 0) return '(no tool calls this turn)'
  const shown = calls.slice(-max)
  const lines = shown.map(c => `${c.tool} ${c.ok ? 'ok' : 'error'}${c.command ? `: ${c.command}` : ''}`)
  return calls.length > max ? [`(${calls.length - max} earlier calls omitted)`, ...lines].join('\n') : lines.join('\n')
}

/** True for a prompt the plan checkpoint never sends: a slash command or one under `minChars`. */
export function planSkip(text: string, minChars: number): 'slash-command' | 'short-prompt' | null {
  const t = text.trim()
  if (t.startsWith('/')) return 'slash-command'
  if (t.length < minChars) return 'short-prompt'
  return null
}

export const LINES = {
  done: 'jev-checkpoints: the last turn claimed done without a verifying run — consult the advisor over the full diff or run the checks before declaring done (ADR-2134 checkpoint 3).',
  plan: 'jev-checkpoints: consult the advisor before locking the plan (ADR-2134 checkpoint 1).',
  repeat: (n: number) =>
    `jev-checkpoints: the same failure has now occurred ${n} times — consult the advisor on the root cause before another fix attempt (ADR-2134 checkpoint 2).`,
} as const

/** An injected line, held to the ceiling. */
export function line(text: string): string {
  return text.length <= MAX_LINE_CHARS ? text : `${text.slice(0, MAX_LINE_CHARS - 1)}…`
}
