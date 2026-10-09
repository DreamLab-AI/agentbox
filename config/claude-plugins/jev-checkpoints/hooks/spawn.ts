/**
 * The spawn checkpoint's pure half: the question, the tiers, the enforce
 * rule and the shadow-log record.
 *
 * Shadow by default because suenot/codex-jev-router measured Jev-picked
 * subagent models at 70% dearer than one strong agent: a router that is
 * right per call can still be wrong per task. The log is the evidence that
 * would justify enforcing here (ADR-2110 teacher labels).
 */

import { clamp } from './text'
import type { ChoiceQuestion } from './jev'
import type { JevCheckpointsPick, JevCheckpointsShadowRecord } from '../types'

export type Tier = Exclude<JevCheckpointsPick, 'inherit'>
export type Pick = JevCheckpointsPick
export const PICKS: readonly Pick[] = ['haiku', 'sonnet', 'opus', 'inherit']

const RANK: Record<Tier, number> = { haiku: 1, sonnet: 2, opus: 3 }

/** The tier a model alias or id belongs to, or null when it names none of the three. */
export function tierOf(model: string | undefined | null): Tier | null {
  if (!model) return null
  const m = model.toLowerCase()
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('opus')) return 'opus'
  return null
}

export const SPAWN_QUESTION: ChoiceQuestion = {
  type: 'choice',
  instructions:
    'Which model tier should run this subagent task? Choose the cheapest tier that will do it well; ' +
    'choose `inherit` when the task needs the parent session’s own judgement or context.',
  criteria: {
    haiku: 'Read-only search, file location, listing, grepping, summarising known files, or a mechanical edit with an unambiguous spec.',
    sonnet: 'Ordinary implementation, tests, refactors, debugging with a clear reproduction, reviews of a bounded diff.',
    opus: 'Architecture, security or cryptography review, a subtle multi-file bug without a reproduction, a design trade-off, or a plan others will build on.',
    inherit: 'The task depends on the parent conversation’s judgement or is a continuation of its own reasoning; keep the parent’s model.',
  },
}

/** The spawn's state as Jev sees it: type, description and the prompt's clamped head and tail. */
export function spawnState(subagentType: string, description: string, prompt: string): { subagent_type: string; description: string; prompt_head: string } {
  return { subagent_type: subagentType, description: clamp(description), prompt_head: clamp(prompt) }
}

/**
 * The `model:` of an agent definition's frontmatter: undefined when the file
 * has no frontmatter or no `model:`, the value otherwise.
 */
export function frontmatterModel(md: string): string | undefined {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return undefined
  const line = m[1]!.match(/^model:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/m)
  return line ? line[1] : undefined
}

/** Built-in agent types that carry no model of their own and so follow the caller. */
export const UNPINNED_BUILTINS: ReadonlySet<string> = new Set(['general-purpose'])

/**
 * Whether the agent's definition pins a model: `true` (pinned, never touch),
 * `false` (follows the caller), from the definition file's text when one was
 * found, else from the built-in list; an unknown type counts as pinned.
 */
export function pinned(subagentType: string, definition: string | undefined): boolean {
  if (definition !== undefined) {
    const model = frontmatterModel(definition)
    return model !== undefined && model.toLowerCase() !== 'inherit'
  }
  return !UNPINNED_BUILTINS.has(subagentType)
}

export type EnforceInput = {
  pick: Pick
  confidence: number | null
  minConfidence: number
  callerModel: string | undefined
  mainModel: string | undefined
  fork: boolean
  workflow: boolean
  pinned: boolean
}

/** Why enforce left the spawn alone, or the tier it rewrites to. */
export type EnforceDecision = { rewrite: Tier } | { rewrite: null; why: string }

/**
 * Enforce rewrites only when every condition holds: the caller named no
 * model, the spawn is not a fork or a workflow agent (neither takes one), the
 * definition pins none, Jev picked a tier with enough confidence, and that
 * tier is no larger than the main model's. It never upgrades.
 */
export function enforceDecision(i: EnforceInput): EnforceDecision {
  if (i.callerModel) return { rewrite: null, why: 'caller-chose' }
  if (i.fork) return { rewrite: null, why: 'fork' }
  if (i.workflow) return { rewrite: null, why: 'workflow' }
  if (i.pinned) return { rewrite: null, why: 'definition-pins' }
  if (i.pick === 'inherit') return { rewrite: null, why: 'inherit' }
  if (i.confidence === null || i.confidence < i.minConfidence) return { rewrite: null, why: 'low-confidence' }
  const main = tierOf(i.mainModel)
  if (main === null) return { rewrite: null, why: 'main-model-unknown' }
  if (RANK[i.pick] > RANK[main]) return { rewrite: null, why: 'would-upgrade' }
  return { rewrite: i.pick }
}

/** One shadow-log line (ADR-2110): no prompt text, only its digest. The contract's record (types/index.d.ts). */
export type ShadowRecord = JevCheckpointsShadowRecord

export function shadowRecord(args: {
  now: number
  session: string
  subagentType: string
  callerModel: string | undefined
  pick: Pick
  confidence: number | null
  enforced: boolean
  ms: number
  usd: number
  promptDigest: string
}): ShadowRecord {
  return {
    ts: new Date(args.now).toISOString(),
    session: args.session,
    subagent_type: args.subagentType,
    caller_model: args.callerModel ?? 'inherit',
    jev_choice: args.pick,
    confidence: args.confidence === null ? null : Number(args.confidence.toFixed(4)),
    enforced: args.enforced,
    ms: Math.round(args.ms),
    usd: Number(args.usd.toFixed(8)),
    prompt_digest: args.promptDigest,
  }
}

/** Whether Jev agreed with the caller: the same tier, or both `inherit`. */
export function agrees(pick: Pick, callerModel: string | undefined): boolean {
  if (!callerModel || callerModel.toLowerCase() === 'inherit') return pick === 'inherit'
  return tierOf(callerModel) === pick
}

/** The shadow log with one line appended, keeping it under `maxBytes` by dropping its oldest half. */
export function appendLine(existing: string, record: ShadowRecord, maxChars = 3_000_000): string {
  let base = existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`
  if (base.length > maxChars) {
    const cut = base.indexOf('\n', Math.floor(base.length / 2))
    base = cut === -1 ? '' : base.slice(cut + 1)
  }
  return `${base}${JSON.stringify(record)}\n`
}
