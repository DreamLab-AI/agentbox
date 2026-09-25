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
 *
 * `backendLocal` is the Sovereign System One relaxation (SSO contract §7). The
 * email-taint fence exists because the transcript leaves the LAN; when the
 * judge is the local SSO façade it does not, and a tainted session may be
 * compacted. Three properties of that input are load-bearing:
 *
 *   • it is EXPLICIT — the caller passes it from resolved configuration. It is
 *     never inferred from a URL string, because "looks like a LAN address" is
 *     a guess and a DNS name, a proxy or a redirect can make that guess wrong;
 *   • it defaults to FALSE — `backendLocal !== true`, so an absent, undefined,
 *     null, `"true"`-as-a-string or otherwise non-boolean value fences. The
 *     safe answer is the one you get by saying nothing;
 *   • when it opens the fence the outcome is reported as `ok-local`, never
 *     `ok`. A tainted session that was compacted must be distinguishable in
 *     the log from a clean one that was, or the relaxation is unauditable.
 *
 * Precedence is unchanged above it: `switched-off` beats `no-key` beats the
 * taint decision. A local backend does not resurrect a switched-off or
 * keyless session.
 */
export function decide({ enabled, apiKey, taint, backendLocal }) {
  if (!enabled) return { run: false, reason: 'switched-off' };
  if (!apiKey) return { run: false, reason: 'no-key' };
  if (taint?.tainted) {
    const detail = `${taint.count} call(s): ${taint.sample.join(', ')}`;
    if (backendLocal !== true) return { run: false, reason: 'tainted', detail };
    return { run: true, reason: 'ok-local', detail };
  }
  return { run: true, reason: 'ok' };
}

// ── ADR-2093 amendment 2026-09-25: sticky taint, token trigger, hysteresis, cache-warm nudge ──

/**
 * Does a skill expansion taint the session? The same `taintSkills` list the
 * Skill-tool check reads, matched on the bare name or a plugin-qualified one
 * (`some-plugin:email-search`), because `/email-search` typed as a command
 * expands the skill without any `Skill` tool call in the transcript.
 */
export function skillTaints(skill, taintSkills) {
  const name = String(skill || '');
  if (!name) return false;
  return taintSkills.some((s) => s && (name === s || name.endsWith(`:${s}`)));
}

/** The plugin-store key that makes one session's taint sticky. */
export const taintKey = (sessionId) => `taint:${sessionId}`;
/** The plugin-store key holding one session's post-compaction baseline (hysteresis). */
export const baselineKey = (sessionId) => `baseline:${sessionId}`;

/**
 * Merge what is known of a session's taint: the sticky record in the store
 * (set the first time an email call or skill was seen) and a fresh scan. Once
 * a session is tainted it stays tainted — a built-in summary can absorb email
 * content and leave no tool call behind to find, so a later scan of the
 * summarised transcript is not evidence of cleanliness.
 */
export function mergeTaint(sticky, scan) {
  if (scan?.tainted) return scan;
  if (sticky && typeof sticky === 'object' && sticky.tainted === true) {
    const sample = Array.isArray(sticky.sample) ? sticky.sample.map(String).slice(0, 3) : [];
    return { tainted: true, count: Number(sticky.count) || 1, sample: sample.length ? sample : ['(earlier in this session)'], sticky: true };
  }
  return scan ?? { tainted: false, count: 0, sample: [] };
}

/** The record written to the store when a session is first seen tainted. */
export function taintRecord(scan, now) {
  return { tainted: true, count: scan.count, sample: scan.sample.slice(0, 3), at: now };
}

/**
 * The trigger threshold in tokens: the smaller of the percentage of the
 * window (the ceiling) and the absolute figure. A 60% trigger on a 1M-token
 * window is 600k tokens of cache reads per turn before anything happens; the
 * absolute cap is what keeps a large window from delaying compaction that far.
 * A window the engine did not report leaves the absolute figure alone.
 */
export function triggerTokens({ window, compactAtPercent, compactAtTokens }) {
  const byPercent = Number.isFinite(window) && window > 0 && Number.isFinite(compactAtPercent) && compactAtPercent > 0
    ? Math.floor((window * compactAtPercent) / 100) : Infinity;
  const absolute = Number.isFinite(compactAtTokens) && compactAtTokens > 0 ? compactAtTokens : Infinity;
  return Math.min(byPercent, absolute);
}

/**
 * How far context must grow past the post-compaction size before the plugin
 * compacts again: `rearmTokens` when set, else a quarter of the threshold.
 */
export function rearmGap(threshold, rearmTokens) {
  if (Number.isFinite(rearmTokens) && rearmTokens > 0) return rearmTokens;
  return Number.isFinite(threshold) ? Math.ceil(threshold / 4) : 0;
}

/**
 * The turn.complete decision. `tokens` is the live context (input tokens the
 * last response was answered over); `baseline` the size a compaction left, or
 * undefined. Compacts when context reaches the threshold AND has grown by the
 * re-arm gap since the last compaction — without the second clause a
 * compaction that cannot get under the threshold re-runs every turn, each run
 * a Jev call plus a full prompt-cache rewrite.
 */
export function shouldCompact({ tokens, percent, window, compactAtPercent, compactAtTokens, rearmTokens, baseline }) {
  const threshold = triggerTokens({ window, compactAtPercent, compactAtTokens });
  const gap = rearmGap(threshold, rearmTokens);
  const hasBaseline = Number.isFinite(baseline) && baseline > 0;
  const need = hasBaseline ? Math.max(threshold, baseline + gap) : threshold;
  if (Number.isFinite(tokens)) {
    if (tokens < threshold) return { run: false, reason: 'below-threshold', threshold, need };
    if (tokens < need) return { run: false, reason: 'hysteresis', threshold, need };
    return { run: true, reason: 'threshold', threshold, need };
  }
  // No token figure: the percentage alone, as before the amendment, still under hysteresis's
  // spirit — nothing to compare a baseline with, so a missing figure never re-triggers on its own.
  if (Number.isFinite(percent) && percent >= compactAtPercent && !hasBaseline) return { run: true, reason: 'percent', threshold, need };
  return { run: false, reason: 'no-usage', threshold, need };
}

/**
 * The prompt-cache TTL in seconds. An explicit `cacheTtlSeconds` > 0 wins.
 * Otherwise (auto): a session that reports rate-limit windows is on a
 * subscription (1 h cache writes); one without, holding an ANTHROPIC_API_KEY,
 * is billed per token at the 5-minute default; anything else is assumed 1 h.
 */
export function cacheTtlSeconds({ configured, rateLimitsCount, hasApiKey }) {
  if (Number.isFinite(configured) && configured > 0) return configured;
  if (rateLimitsCount > 0) return 3600;
  if (hasApiKey) return 300;
  return 3600;
}

/**
 * How long a session must sit idle before the cache-warm nudge fires: TTL less
 * the margin, or — when the margin would eat most of a short TTL — half the
 * TTL, so a 5-minute cache still gets its compaction in while warm.
 */
export function nudgeDelayMs(ttlSeconds, marginSeconds) {
  const ttl = Math.max(0, Number(ttlSeconds) || 0);
  const margin = Math.max(0, Number(marginSeconds) || 0);
  const s = ttl > 2 * margin ? ttl - margin : ttl / 2;
  return Math.round(s * 1000);
}

/** The cache-warm action: `compact` (default), `notify` (toast only), `off`. */
export function cacheWarmMode(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (['off', 'false', '0', 'no', 'none'].includes(v)) return 'off';
  if (['notify', 'toast', 'nudge'].includes(v)) return 'notify';
  return 'compact';
}

/**
 * Should an idle session be armed for the cache-warm nudge? Only past the
 * floor (a small context re-prefills cheaply) and only when it has grown past
 * the last compaction by the re-arm gap (so a freshly compacted session is not
 * compacted again the moment it goes quiet).
 */
export function shouldArmNudge({ tokens, floorTokens, baseline, gap }) {
  if (!Number.isFinite(tokens) || tokens < floorTokens) return false;
  if (Number.isFinite(baseline) && baseline > 0 && tokens < baseline + gap) return false;
  return true;
}

/** Store entries older than this are pruned at session start. */
export const SESSION_STATE_TTL_MS = 30 * 24 * 3600 * 1000;

/** Which per-session store keys have expired (entries carry `at`, ms since epoch). */
export function expiredSessionKeys(entries, now, ttlMs = SESSION_STATE_TTL_MS) {
  const out = [];
  for (const [key, value] of entries) {
    if (!/^(taint|baseline):/.test(key)) continue;
    const at = value && typeof value === 'object' ? Number(value.at) : NaN;
    if (!Number.isFinite(at) || now - at > ttlMs) out.push(key);
  }
  return out;
}
