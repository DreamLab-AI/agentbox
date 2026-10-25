import type { PluginOptions } from 'claude-code'

/** What the spawn checkpoint does with Jev's pick. */
export type SpawnMode = 'off' | 'shadow' | 'enforce'

/** The plugin's `userConfig`, validated: a missing or bad value is the default. */
export type Options = {
  /** The endpoint actually dialled: `api`, or TypeSafe's cloud when empty. */
  readonly api: string
  /**
   * Declared, never inferred from `api` (ADR-2094 §5): true says the endpoint
   * is on this network, so an email-tainted session may be judged by it and
   * no key is sent to it. Only `true` (or the string `"true"` a projected
   * `--config` may carry) declares it.
   */
  readonly backendLocal: boolean
  /** Tool-name prefixes whose call taints the session; null means the built-in email list. */
  readonly taintTools: readonly string[] | null
  /** Skill names whose load taints the session; null means the built-in list (email-search). */
  readonly taintSkills: readonly string[] | null
  readonly model: string
  readonly timeoutMs: number
  readonly doneCheck: boolean
  readonly doneThreshold: number
  /** AB-08-S1-01: also ask whether the specific claim is covered by a successful verifying call. Off by default. */
  readonly claimCheck: boolean
  /** Probability at or above which an uncovered claim injects the done line. */
  readonly claimThreshold: number
  readonly repeatCheck: boolean
  readonly repeatCount: number
  readonly planCheck: boolean
  readonly planThreshold: number
  readonly minChars: number
  readonly spawnMode: SpawnMode
  readonly spawnMinConfidence: number
  /** Empty means no shadow log. */
  readonly shadowLog: string
  readonly usdPerMTokIn: number
}

/** Mirrors `config/hooks/lib/skill-route.cjs`, so both consumers dial the same judge by default. */
export const DEFAULT_API = 'https://api.typesafe.ai/v1/systemone'
export const DEFAULT_MODEL = 'jev-latest'
export const DEFAULT_SHADOW_LOG = '/home/devuser/.claude/jev-checkpoints/shadow.jsonl'
/** A hook's budget is 10 s; the judge's deadline leaves room for the rest of the hook. */
export const MAX_TIMEOUT_MS = 8000

/** ADR-2089's measured price of Jev input; output is free. */
export const JEV_USD_PER_MTOK_IN = 0.042

const SPAWN_MODES: readonly SpawnMode[] = ['off', 'shadow', 'enforce']

const bool = (v: unknown, dflt: boolean): boolean =>
  v === true || v === 'true' ? true : v === false || v === 'false' ? false : dflt

/** A finite number from a number or numeric string, else undefined. */
function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}

/** A probability-like bar: outside [0, 1] is the default, never clamped into range silently. */
const unit = (v: unknown, dflt: number): number => {
  const n = num(v)
  return n !== undefined && n >= 0 && n <= 1 ? n : dflt
}

const str = (v: unknown, dflt: string): string => (typeof v === 'string' ? v.trim() : dflt)

/**
 * A comma-separated list, as factrail's `taintTools`/`taintSkills` take it.
 * Unset, blank or all-empty means the default (null): an empty value never
 * switches the fence off.
 */
export function list(v: unknown): readonly string[] | null {
  if (typeof v !== 'string') return null
  const items = v.split(',').map(x => x.trim()).filter(Boolean)
  return items.length ? items : null
}

export function readOptions(options: PluginOptions | undefined): Options {
  const o = options ?? {}
  const timeout = num(o.timeoutMs)
  const repeat = num(o.repeatCount)
  const minChars = num(o.minChars)
  const usd = num(o.usdPerMTokIn)
  const api = str(o.api, '')
  return {
    api: api === '' ? DEFAULT_API : api,
    backendLocal: o.backendLocal === true || o.backendLocal === 'true',
    taintTools: list(o.taintTools),
    taintSkills: list(o.taintSkills),
    model: str(o.model, DEFAULT_MODEL) || DEFAULT_MODEL,
    timeoutMs: timeout === undefined ? 4000 : Math.min(MAX_TIMEOUT_MS, Math.max(250, Math.round(timeout))),
    doneCheck: bool(o.doneCheck, true),
    doneThreshold: unit(o.doneThreshold, 0.9),
    claimCheck: bool(o.claimCheck, false),
    claimThreshold: unit(o.claimThreshold, 0.9),
    repeatCheck: bool(o.repeatCheck, true),
    repeatCount: repeat === undefined ? 2 : Math.max(2, Math.floor(repeat)),
    planCheck: bool(o.planCheck, true),
    planThreshold: unit(o.planThreshold, 0.8),
    minChars: minChars === undefined || minChars < 0 ? 24 : Math.floor(minChars),
    spawnMode: SPAWN_MODES.includes(o.spawnMode as SpawnMode) ? (o.spawnMode as SpawnMode) : 'shadow',
    spawnMinConfidence: unit(o.spawnMinConfidence, 0.8),
    shadowLog: str(o.shadowLog, DEFAULT_SHADOW_LOG),
    usdPerMTokIn: usd !== undefined && usd >= 0 ? usd : JEV_USD_PER_MTOK_IN,
  }
}
