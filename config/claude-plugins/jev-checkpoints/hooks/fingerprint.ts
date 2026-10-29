/**
 * The repeat checkpoint's failure fingerprint: local only, never sent anywhere.
 *
 * Two runs of the same failure differ in noise: the line a stack frame points
 * at moves as the fix attempt edits the file, a test runner reports a new
 * duration, a log line a new timestamp, a pointer a new address. The
 * fingerprint is a hash of the failure's error lines with that noise replaced
 * by placeholders, so the same failure hashes the same while a different
 * failure (another message, another file) does not.
 */

/** Tools whose failures count: the shell, and anything named like a test, build, lint or check runner. */
export function watchesTool(tool: string): boolean {
  return tool === 'Bash' || /(?:^|[_\-.])(?:test|tests|lint|build|check|typecheck|pytest|jest|vitest|cargo)(?:$|[_\-.])/i.test(tool)
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
/** Lines that carry the failure itself rather than the run's chatter. */
const ERROR_LINE = /\b(?:error|errors|err|fail(?:ed|ure|ures|s)?|panic(?:ked)?|exception|traceback|assert(?:ion)?|expected|cannot|can't|could not|not found|undefined|denied|refused|segmentation|abort(?:ed)?|fatal|exit code)\b|^E\s|✗|✘/i

/** The noise a re-run changes, replaced in order (a path's `:line:col` before bare numbers in durations). */
const NOISE: readonly (readonly [RegExp, string])[] = [
  // ISO-8601 and common log timestamps
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, '<ts>'],
  [/\b\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\b/g, '<ts>'],
  // file:line[:col] and "line N" / "(N:M)"
  [/([\w./\\-]+\.[A-Za-z0-9]{1,6}):\d+(?::\d+)?/g, '$1:<n>'],
  [/\bline \d+(?:, col(?:umn)? \d+)?/gi, 'line <n>'],
  [/\((\d+):(\d+)\)/g, '(<n>:<n>)'],
  // addresses and long hex ids (commit shas, object ids, temp-dir suffixes)
  [/\b0x[0-9a-f]+\b/gi, '<hex>'],
  [/\b[0-9a-f]{7,}\b/gi, '<hex>'],
  // durations: 12ms, 0.53s, 1.2 sec, 3 seconds, 2m 4s, "in 1.25s", "took 400 ms"
  [/\b\d+(?:\.\d+)?\s*(?:ns|µs|us|ms|s|sec|secs|seconds?|m|min|mins|minutes?|h|hrs?|hours?)\b/gi, '<dur>'],
  // process ids
  [/\bpid[ =:]?\d+\b/gi, 'pid <n>'],
]

/** One line with its noise replaced, whitespace collapsed and case folded. */
export function normaliseLine(line: string): string {
  let out = line.replace(ANSI, '')
  for (const [re, sub] of NOISE) out = out.replace(re, sub)
  return out.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * The failure's normalised error lines, in order, consecutive duplicates
 * dropped, at most 20; the first five non-empty lines when nothing reads as an
 * error line (a bare non-zero exit).
 */
export function errorLines(text: string): string[] {
  const all = text.replace(ANSI, '').split(/\r?\n/).map(l => l.trim()).filter(l => l !== '')
  const picked = all.filter(l => ERROR_LINE.test(l))
  const source = picked.length > 0 ? picked : all.slice(0, 5)
  const out: string[] = []
  for (const l of source) {
    const n = normaliseLine(l)
    if (n !== '' && out[out.length - 1] !== n) out.push(n)
    if (out.length === 20) break
  }
  return out
}

/** 64-bit FNV-1a as 16 hex digits: a stable, synchronous digest for a local map key. */
export function fnv1a64(text: string): string {
  let h = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (const byte of new TextEncoder().encode(text)) {
    h ^= BigInt(byte)
    h = (h * prime) & mask
  }
  return h.toString(16).padStart(16, '0')
}

/** A line that says only that the call failed (its exit status) or is harness chatter, not what failed. */
const STATUS_ONLY = /^(?:exit code \d+|shell cwd was reset to .*)$/

/**
 * The failure's fingerprint, or null when there is nothing to fingerprint.
 *
 * A silent failure (grep finding nothing, `test` false, a quiet non-zero exit)
 * carries no text of its own, so its exit status alone would make every such
 * failure look the same. It is identified by its command instead, and is not
 * fingerprinted at all when the command is unknown.
 */
export function fingerprint(tool: string, text: string, command?: string): string | null {
  const lines = errorLines(text)
  if (lines.length === 0) return null
  if (lines.every(l => STATUS_ONLY.test(l))) {
    const cmd = command === undefined ? '' : normaliseLine(command)
    if (cmd === '') return null
    return `${tool}:${fnv1a64([...lines.filter(l => !l.startsWith('shell cwd')), cmd].join('\n'))}`
  }
  return `${tool}:${fnv1a64(lines.join('\n'))}`
}
