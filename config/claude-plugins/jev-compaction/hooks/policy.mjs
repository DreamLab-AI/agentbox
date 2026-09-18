// policy.mjs — the decisions the jev-compaction plugin makes BEFORE anything
// leaves the network (ADR-2093). Pure functions, no engine, no I/O, so they are
// testable with `node --test` and assertable in the sense data-boundary.md
// demands: a session is either mechanically clean or it is not compacted by Jev.
//
// Shared by hooks/jev-compaction.ts (the engine adapter) and
// tests/config/jev-compaction-policy.test.mjs.

/**
 * Tool-name prefixes and Skill names whose PRESENCE in a transcript makes the
 * whole session must-not-leave. Email is the operator's standing rule
 * (2026-09-18: "always skipping email"); the rest of the must-not-leave classes
 * in skills/system-one/references/data-boundary.md can be added per project
 * through the plugin's `taintTools` option without a code change.
 */
export const DEFAULT_TAINT_TOOLS = Object.freeze([
  'mcp__email-gateway__',   // every tool of the private email gateway
  'mcp__claude_ai_Gmail__', // hosted Gmail connector, same class
]);
export const DEFAULT_TAINT_SKILLS = Object.freeze(['email-search']);

/** Normalise a user-supplied list option (plugin userConfig gives a readonly string[] or a comma string). */
export function listOption(value, fallback) {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [...fallback];
}

/**
 * Does one tool use taint the session? A prefix match on the tool name, or a
 * `Skill` load of a named skill. Prefix rather than glob: an MCP server's every
 * tool shares its `mcp__<server>__` prefix, and a prefix cannot be
 * mis-anchored the way a pattern can.
 */
export function taintsSession(toolUse, taintTools, taintSkills) {
  const name = String(toolUse?.tool || '');
  if (taintTools.some((p) => p && name.startsWith(p))) return true;
  if (name === 'Skill') {
    const skill = String(toolUse?.input?.skill ?? toolUse?.input?.name ?? '');
    return taintSkills.includes(skill);
  }
  return false;
}

/**
 * Scan a transcript for taint. Returns the first offending tool names (for the
 * log line) and the count; empty = clean. Looks at every message, pinned or
 * not: a pinned email call is still an email call in a transcript that would
 * otherwise leave.
 */
export function scanTaint(messages, taintTools = DEFAULT_TAINT_TOOLS, taintSkills = DEFAULT_TAINT_SKILLS) {
  const hits = [];
  for (const m of messages || []) {
    for (const t of m?.toolUses || []) {
      if (taintsSession(t, taintTools, taintSkills)) hits.push(String(t.tool));
    }
  }
  return { tainted: hits.length > 0, count: hits.length, sample: [...new Set(hits)].slice(0, 3) };
}

/**
 * The switch. Resolution order: the session store (what `/jev-compact on|off`
 * wrote) beats the manifest default (`enabledByDefault` in userConfig, which
 * the entrypoint projects from [features.jev_compaction]). Nothing set anywhere
 * ⇒ on, because the plugin is only registered at all when the manifest gate is.
 */
export function resolveEnabled(storeValue, optionValue) {
  if (typeof storeValue === 'boolean') return storeValue;
  if (typeof optionValue === 'boolean') return optionValue;
  if (typeof optionValue === 'string') return !['0', 'false', 'off', 'no'].includes(optionValue.toLowerCase());
  return true;
}

/** Parse `/jev-compact <args>`. */
export function parseSwitchArgs(args) {
  const a = String(args || '').trim().toLowerCase();
  if (['on', 'enable', '1', 'true'].includes(a)) return 'on';
  if (['off', 'disable', '0', 'false'].includes(a)) return 'off';
  if (a === '' || a === 'status') return 'status';
  return 'help';
}

/**
 * The one decision the compact hook makes: run Jev, or hand the event to the
 * built-in summary with a stated reason. Reasons are the log vocabulary.
 */
export function decide({ enabled, apiKey, taint }) {
  if (!enabled) return { run: false, reason: 'switched-off' };
  if (!apiKey) return { run: false, reason: 'no-key' };
  if (taint?.tainted) return { run: false, reason: 'tainted', detail: `${taint.count} call(s): ${taint.sample.join(', ')}` };
  return { run: true, reason: 'ok' };
}
