/**
 * Per-session state, kept in `$.store` under `session:<id>` so a hot reload
 * or a resumed session keeps its taint, counts and fingerprints. The module
 * holds the live copy; every change is written through.
 */

import type { JevCheckpointsCheckpoint, JevCheckpointsSessionRecord, JevCheckpointsStats } from '../types'

export type Checkpoint = JevCheckpointsCheckpoint
export const CHECKPOINTS: readonly Checkpoint[] = ['done', 'repeat', 'plan', 'spawn']

export type Stats = JevCheckpointsStats
/** The contract's record (types/index.d.ts). */
export type SessionRecord = JevCheckpointsSessionRecord

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const sessionKey = (id: string) => `session:${id}`
export const switchKey = (id: string) => `switch:${id}`

const zero = (): Stats => ({ requests: 0, injections: 0, usd: 0, lastError: null })

export function freshRecord(now: number): SessionRecord {
  return {
    at: now,
    tainted: null,
    stats: { done: zero(), repeat: zero(), plan: zero(), spawn: zero() },
    fingerprints: {},
    advised: [],
    pendingDone: false,
    prompt: 0,
    lastInjected: {},
    spawn: { decisions: 0, agreements: 0, enforced: 0 },
    saidNoKey: false,
  }
}

/** A stored value read back as a record; anything malformed starts fresh (taint kept when it can be read). */
export function readRecord(v: unknown, now: number): SessionRecord {
  const fresh = freshRecord(now)
  if (!v || typeof v !== 'object') return fresh
  const o = v as Partial<SessionRecord>
  const stats = { ...fresh.stats }
  for (const c of CHECKPOINTS) {
    const s = o.stats?.[c]
    if (s && typeof s === 'object') {
      stats[c] = {
        requests: Number(s.requests) || 0,
        injections: Number(s.injections) || 0,
        usd: Number(s.usd) || 0,
        lastError: typeof s.lastError === 'string' ? s.lastError : null,
      }
    }
  }
  const fps: Record<string, number> = {}
  if (o.fingerprints && typeof o.fingerprints === 'object') {
    for (const [k, n] of Object.entries(o.fingerprints)) if (typeof n === 'number' && n > 0) fps[k] = n
  }
  return {
    at: typeof o.at === 'number' ? o.at : now,
    tainted: typeof o.tainted === 'string' ? o.tainted : null,
    stats,
    fingerprints: fps,
    advised: Array.isArray(o.advised) ? o.advised.filter((x): x is string => typeof x === 'string') : [],
    pendingDone: o.pendingDone === true,
    prompt: typeof o.prompt === 'number' ? o.prompt : 0,
    lastInjected: o.lastInjected && typeof o.lastInjected === 'object' ? { ...o.lastInjected } : {},
    spawn: {
      decisions: Number(o.spawn?.decisions) || 0,
      agreements: Number(o.spawn?.agreements) || 0,
      enforced: Number(o.spawn?.enforced) || 0,
    },
    saidNoKey: o.saidNoKey === true,
  }
}

/** Keys of `session:`/`switch:` entries whose session record is older than the TTL. */
export function expiredKeys(entries: readonly (readonly [string, unknown])[], now: number, ttl = SESSION_TTL_MS): string[] {
  const stale = new Set<string>()
  for (const [key, v] of entries) {
    if (!key.startsWith('session:')) continue
    const at = v && typeof v === 'object' ? (v as { at?: unknown }).at : undefined
    if (typeof at !== 'number' || now - at > ttl) stale.add(key.slice('session:'.length))
  }
  return entries.map(([k]) => k).filter(k => {
    const id = k.startsWith('session:') ? k.slice(8) : k.startsWith('switch:') ? k.slice(7) : null
    return id !== null && stale.has(id)
  })
}

/**
 * The injection rule: at most one line per checkpoint per prompt; the plan
 * line is also not repeated on the prompt straight after one that carried it
 * (a follow-up to a planned request is the same plan).
 */
export function mayInject(rec: SessionRecord, c: Checkpoint): boolean {
  const last = rec.lastInjected[c]
  if (last === rec.prompt) return false
  if (c === 'plan' && last === rec.prompt - 1) return false
  return true
}

/**
 * Counts one occurrence of a failure; the count to advise on, or null (below
 * the bar, or advised already). The caller marks it advised only once the
 * line is actually injected, so a capped turn leaves it for the next one.
 */
export function countFailure(rec: SessionRecord, fp: string, repeatCount: number): number | null {
  const n = (rec.fingerprints[fp] ?? 0) + 1
  delete rec.fingerprints[fp] // re-inserted last: the map's order is recency
  rec.fingerprints[fp] = n
  // Bound the map: a pathological session keeps its 500 most recent fingerprints.
  const keys = Object.keys(rec.fingerprints)
  if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete rec.fingerprints[k]
  if (n < repeatCount || rec.advised.includes(fp)) return null
  return n
}

/** Records that a fingerprint's line was injected: it is never injected again this session. */
export function markAdvised(rec: SessionRecord, fp: string): void {
  if (!rec.advised.includes(fp)) rec.advised.push(fp)
  if (rec.advised.length > 500) rec.advised.splice(0, rec.advised.length - 500)
}

const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 5 : 4)}`

/** The `/jev-checkpoints status` text. */
export function statusText(args: {
  enabled: boolean
  rec: SessionRecord
  enabledChecks: Record<Checkpoint, boolean>
  spawnMode: string
  api: string
  local: boolean
  hasKey: boolean
}): string {
  const { rec } = args
  const head = [
    `jev-checkpoints: ${args.enabled ? 'on' : 'off'} for this session`,
    `endpoint ${args.api} (${args.local ? 'local' : 'cloud'}${args.local ? '' : args.hasKey ? ', key set' : ', NO KEY'})`,
    rec.tainted ? `email-tainted (${rec.tainted}): no cloud requests this session` : 'not email-tainted',
  ]
  const rows = CHECKPOINTS.map(c => {
    const s = rec.stats[c]
    const on = c === 'spawn' ? args.spawnMode : args.enabledChecks[c] ? 'on' : 'off'
    const err = s.lastError ? `, last error ${s.lastError}` : ''
    const req = c === 'repeat' ? 'local only' : `${s.requests} requests, ${usd(s.usd)}`
    return `  ${c.padEnd(6)} ${on.padEnd(7)} ${req}, ${s.injections} injections${err}`
  })
  const total = CHECKPOINTS.reduce((a, c) => a + rec.stats[c].usd, 0)
  const sp = rec.spawn
  const agreement = sp.decisions > 0 ? `${sp.agreements}/${sp.decisions} (${Math.round((100 * sp.agreements) / sp.decisions)}%)` : 'no decisions yet'
  return [
    ...head,
    ...rows,
    `  total ${usd(total)}`,
    `  spawn agreement with the caller: ${agreement}${sp.enforced ? `; ${sp.enforced} enforced` : ''}`,
  ].join('\n')
}
