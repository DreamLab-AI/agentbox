/**
 * jev-checkpoints' data contract: the records it writes outside its own
 * process, which other tools read (the ADR-2110 label recorder reads the
 * shadow log; `/jev-checkpoints status` and a resumed session read the store).
 *
 * The plugin adds no noun to `$` and keeps nothing in `$.state`; these are
 * the shapes of its JSONL lines and `$.store` values. Add fields, never
 * rename: the shadow log outlives any one version of the plugin.
 */

/** The four checkpoints. */
export type JevCheckpointsCheckpoint = 'done' | 'repeat' | 'plan' | 'spawn'

/** The spawn checkpoint's answer: a tier, or keep the parent's model. */
export type JevCheckpointsPick = 'haiku' | 'sonnet' | 'opus' | 'inherit'

/**
 * One line of the spawn shadow log, one per decision, shadow or enforced.
 * Each session writes its own JSONL files beside `shadowLog`
 * (`<stem>-<session>.jsonl`, then `.1.jsonl`, `.2.jsonl`, … as segments fill
 * or prove unreadable); readers glob `<stem>-*.jsonl`. It never holds prompt
 * text: only `prompt_digest`.
 */
export type JevCheckpointsShadowRecord = {
  /** ISO-8601 time of the decision. */
  ts: string
  /** The Claude Code session id. */
  session: string
  /** The resolved agent type (`general-purpose`, `Explore`, a plugin's agent). */
  subagent_type: string
  /** The Agent tool's `model` as the caller gave it, `inherit` when it gave none. */
  caller_model: string
  /** Jev's pick. */
  jev_choice: JevCheckpointsPick
  /** Jev's confidence in the pick, 0–1, or null when the answer carried none. */
  confidence: number | null
  /** True when enforce mode rewrote the subagent's model to the pick. */
  enforced: boolean
  /** Request latency in milliseconds. */
  ms: number
  /** What the request cost at the configured `usdPerMTokIn`. */
  usd: number
  /** `sha256-12-<12hex>` of the subagent prompt, for joining without the text. */
  prompt_digest: string
}

/** One checkpoint's counters for a session. */
export type JevCheckpointsStats = { requests: number; injections: number; usd: number; lastError: string | null }

/** The `$.store` value under `session:<id>`. */
export type JevCheckpointsSessionRecord = {
  /** Last write, ms since the epoch; idle past 30 days, pruned at session start. */
  at: number
  /** Why the session is email-tainted (`tool:…`, `skill:…`, `factrail`), or null. Sticky. */
  tainted: string | null
  stats: Record<JevCheckpointsCheckpoint, JevCheckpointsStats>
  /** `<loop>|<tool>:<fnv1a64>` → occurrences this session. */
  fingerprints: Record<string, number>
  /** Fingerprints already advised on. */
  advised: string[]
  /** A done line waits for the next prompt. */
  pendingDone: boolean
  /** Prompts seen, and the prompt each checkpoint last injected on. */
  prompt: number
  lastInjected: Partial<Record<JevCheckpointsCheckpoint, number>>
  spawn: { decisions: number; agreements: number; enforced: number }
  /** The missing-key log line has been said. */
  saidNoKey: boolean
}
