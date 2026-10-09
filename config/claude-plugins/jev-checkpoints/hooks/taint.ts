/**
 * The email fence (ADR-2093, as factrail keeps it): a session that has called
 * the private email gateway or Gmail, or loaded the email-search skill, is
 * tainted for the rest of its life. A tainted session makes no Jev request
 * unless the backend is declared local (`backendLocal`); the local repeat
 * checkpoint still runs.
 */

/** Tool-name prefixes that taint by default, matching factrail's defaults. */
export const TAINT_TOOL_PREFIXES: readonly string[] = ['mcp__email-gateway__', 'mcp__claude_ai_Gmail__', 'mcp__gmail__']
/** Skills whose load taints by default. */
export const TAINT_SKILLS: readonly string[] = ['email-search']

/**
 * What taints: `taintTools`/`taintSkills` as configured, null meaning the
 * defaults. A configured tool list replaces the defaults, including the
 * catch-all Gmail pattern, as factrail's does.
 */
export type TaintRules = { readonly tools: readonly string[] | null; readonly skills: readonly string[] | null }

export const DEFAULT_TAINT: TaintRules = { tools: null, skills: null }

/** `input.skill ?? input.name` of a `Skill` call, else null (factrail's `skillOf`). */
export function skillOf(tool: string, input: Record<string, unknown> | undefined): string | null {
  if (tool !== 'Skill' || !input) return null
  const v = input['skill'] ?? input['name']
  return typeof v === 'string' ? v : null
}

/** A skill name, namespaced (`plugin:email-search`) or not, against the taint list. */
export function isTaintSkill(skill: string | null | undefined, rules: TaintRules = DEFAULT_TAINT): boolean {
  if (!skill) return false
  const bare = skill.includes(':') ? skill.slice(skill.lastIndexOf(':') + 1) : skill
  return (rules.skills ?? TAINT_SKILLS).includes(bare.trim().replace(/^\//, ''))
}

/** A tool name against the taint prefixes. */
export function isTaintTool(tool: string, rules: TaintRules = DEFAULT_TAINT): boolean {
  if (rules.tools) return rules.tools.some(p => tool.startsWith(p))
  return TAINT_TOOL_PREFIXES.some(p => tool.startsWith(p)) || /^mcp__[^_]*gmail/i.test(tool)
}

/** What taints, from a tool call: the tool by prefix, or a Skill call loading a taint skill. */
export function taintOf(tool: string, input: Record<string, unknown> | undefined, rules: TaintRules = DEFAULT_TAINT): string | null {
  if (isTaintTool(tool, rules)) return `tool:${tool}`
  const skill = skillOf(tool, input)
  return isTaintSkill(skill, rules) ? `skill:${skill}` : null
}

/**
 * Claude Code's store file for a marketplace plugin:
 * `<name>_<marketplace>-<sha256("<name>@<marketplace>")[0:12]>.json`
 * (as `scripts/factrail-store-migrate.mjs` documents it).
 */
export async function storeFileName(name: string, marketplace: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${name}@${marketplace}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const hex = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')
  return `${name}_${marketplace}-${hex.slice(0, 12)}.json`
}

/** True when factrail's store text marks this session tainted; anything unreadable is not a taint. */
export function factrailTainted(storeText: string, sessionId: string): boolean {
  try {
    const store = JSON.parse(storeText) as Record<string, unknown>
    const rec = store[`taint:${sessionId}`]
    return !!rec && typeof rec === 'object' && (rec as Record<string, unknown>)['tainted'] === true
  } catch {
    return false
  }
}

/** A `sha256-12-<12hex>` digest (the estate's content-address form) of a text. */
export async function sha256_12(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return `sha256-12-${Array.from(digest.slice(0, 6), b => b.toString(16).padStart(2, '0')).join('')}`
}
