// jev-compaction.ts — agentbox's function-hook adapter over the vendored
// fast-jev-compaction library (ADR-2093). Registered by the entrypoint when
// [features.jev_compaction].enabled = true; absent otherwise.
//
// What it adds to upstream's hook, and why:
//   • a TAINT GATE: a session that has EVER used an email tool (or any tool in
//     `taintTools` / skill in `taintSkills`) is never sent to Jev — the built-in
//     summary runs instead. Sticky per session in the plugin store (amendment
//     2026-09-25): marked at the tool call, the skill expansion, every
//     turn.complete scan and every compaction scan, because a built-in summary
//     absorbs email content and leaves no tool call behind for a later scan;
//   • a TRIGGER in tokens as well as percent, with HYSTERESIS after each
//     compaction, and a CACHE-WARM NUDGE that compacts an idle, large session
//     before its prompt cache expires (amendment 2026-09-25);
//   • a SWITCH: `/jev-compact on|off|status`, persisted in the plugin store
//     across sessions; `enabledByDefault` comes from the manifest;
//   • FAIL-OPEN everywhere: any throw, a missing key, a below-threshold
//     reduction, a tainted session ⇒ `next(event)`, the built-in compaction,
//     with one log line saying which.
// Nothing else is changed: the judgement, batching, fitting and rebuild are
// upstream's, under lib/ (MIT, tamaratran/fast-jev-compaction e3f262a).

import type { EngineInterface, On, PluginOptions, Register, SessionMessage, Timer, TurnCompleteInput } from 'claude-code';

import { compact, reductionRatio } from '../lib/compact.js';
import { buildJevRequest, DEFAULT_MODEL, parseJevResponse } from '../lib/request.js';
import type { CompactOptions, CompactResult, JevAsker, Message, ToolResult, ToolUse } from '../lib/types.js';
import {
  DEFAULT_TAINT_SKILLS,
  DEFAULT_TAINT_TOOLS,
  baselineKey,
  cacheTtlSeconds,
  cacheWarmMode,
  decide,
  expiredSessionKeys,
  listOption,
  mergeTaint,
  nudgeDelayMs,
  parseSwitchArgs,
  rearmGap,
  resolveEnabled,
  scanTaint,
  shouldArmNudge,
  shouldCompact,
  skillTaints,
  taintKey,
  taintRecord,
  taintsSession,
  triggerTokens,
} from './policy.mjs';

const STORE_ENABLED = 'enabled';
const STORE_LAST = 'last';
const COMMAND = 'jev-compact';

type Config = CompactOptions & {
  apiKey?: string;
  /** Endpoint override. Absent ⇒ the vendor cloud, which is the default posture. */
  baseUrl?: string;
  /**
   * Whether the endpoint above is on this network. DECLARED by the projector from the
   * manifest gate (ADR-2094 §7), never inferred from `baseUrl` — a hostname is not
   * evidence of where bytes come to rest, and this boolean is what decides whether an
   * email-tainted session may be judged at all. Absent ⇒ false ⇒ the fence stays shut.
   */
  backendLocal: boolean;
  compactAtPercent: number;
  /** Absolute trigger in tokens; the effective trigger is min(percent of window, this). */
  compactAtTokens: number;
  /** Growth past the post-compaction size required before re-triggering; 0 ⇒ 25% of the trigger. */
  rearmTokens: number;
  /** Idle-before-expiry action: compact | notify | off. */
  cacheWarm: 'compact' | 'notify' | 'off';
  cacheWarmFloorTokens: number;
  /** 0 ⇒ auto-detect (subscription 1 h, API key 5 min). */
  cacheTtlSeconds: number;
  cacheTtlMarginSeconds: number;
  minReductionRatio: number;
  model: string;
  enabledByDefault: unknown;
  taintTools: string[];
  taintSkills: string[];
};

function num(options: PluginOptions, key: string, fallback: number): number {
  const v = options[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function str(options: PluginOptions, key: string): string | undefined {
  const v = options[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function resolveConfig(options: PluginOptions): Config {
  const numbers: Partial<Omit<CompactOptions, 'goal'>> = {};
  for (const key of ['keepThreshold', 'preserveRecentMessages', 'maxStateTokens', 'maxRequestTokens', 'truncateHeadChars'] as const) {
    const v = options[key];
    if (typeof v === 'number' && Number.isFinite(v)) numbers[key] = v;
  }
  const config: Config = {
    ...numbers,
    compactAtPercent: num(options, 'compactAtPercent', 60),
    compactAtTokens: num(options, 'compactAtTokens', 180_000),
    rearmTokens: num(options, 'rearmTokens', 40_000),
    cacheWarm: cacheWarmMode(options['cacheWarm']),
    cacheWarmFloorTokens: num(options, 'cacheWarmFloorTokens', 100_000),
    cacheTtlSeconds: num(options, 'cacheTtlSeconds', 0),
    cacheTtlMarginSeconds: num(options, 'cacheTtlMarginSeconds', 300),
    minReductionRatio: num(options, 'minReductionRatio', 0.25),
    model: str(options, 'model') ?? DEFAULT_MODEL,
    enabledByDefault: options['enabledByDefault'],
    // `true` only from a real boolean, or the exact string a shell-projected config
    // carries. Any other shape — including a truthy string like "false" or a URL —
    // leaves the fence shut, because this is a data-boundary control, not a flag.
    backendLocal: options['backendLocal'] === true || options['backendLocal'] === 'true',
    taintTools: listOption(options['taintTools'], DEFAULT_TAINT_TOOLS),
    taintSkills: listOption(options['taintSkills'], DEFAULT_TAINT_SKILLS),
  };
  const baseUrl = str(options, 'baseUrl');
  if (baseUrl) config.baseUrl = baseUrl;
  const apiKey = str(options, 'apiKey');
  if (apiKey) config.apiKey = apiKey;
  return config;
}

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ status: number; ok: boolean; text: string }>;

function asker(fetchFn: Fetch, apiKey: string, model: string, baseUrl?: string): JevAsker {
  return {
    async ask(state, questions) {
      const r = buildJevRequest({ apiKey, model, baseUrl }, state, questions);
      const res = await fetchFn(r.url, { method: r.method, headers: r.headers, body: r.body });
      return parseJevResponse(res.status, res.ok, res.text);
    },
  };
}

/** Map the library's output back onto session messages; untouched ones keep their engine handle. */
export function toSessionMessages(input: readonly SessionMessage[], output: readonly Message[]): SessionMessage[] {
  const messages = new Map<Message, SessionMessage>();
  const uses = new Map<ToolUse, SessionMessage['toolUses'][number]>();
  const results = new Map<ToolResult, NonNullable<SessionMessage['toolResults']>[number]>();
  for (const m of input) {
    messages.set(m, m);
    for (const t of m.toolUses) uses.set(t, t);
    for (const r of m.toolResults ?? []) results.set(r, r);
  }
  return output.map((m) => {
    const own = messages.get(m);
    if (own) return own;
    const rebuilt: SessionMessage = {
      role: m.role,
      text: m.text,
      toolUses: m.toolUses.map((t) => uses.get(t) ?? { tool_use_id: t.tool_use_id, tool: t.tool, input: t.input, ...(t.text !== undefined ? { text: t.text } : {}), ...(t.isError ? { isError: true as const } : {}) }),
    };
    if (m.toolResults && m.toolResults.length > 0) {
      rebuilt.toolResults = m.toolResults.map((r) => results.get(r) ?? { tool_use_id: r.tool_use_id, text: r.text, isError: r.isError ?? false });
    }
    return rebuilt;
  });
}

function pct(x: number): string { return `${Math.round(x * 100)}%`; }

export function summarise(result: CompactResult): string {
  const s = result.stats;
  const parts = [
    s.kept > 0 ? `${s.kept} kept` : '',
    s.resultsDropped > 0 ? `${s.resultsDropped} results truncated` : '',
    s.callsDropped > 0 ? `${s.callsDropped} calls dropped` : '',
    s.pinned > 0 ? `${s.pinned} pinned` : '',
  ].filter(Boolean);
  return `${pct(reductionRatio(result))} reduction; ${parts.join(', ') || 'no tool calls'}; state ~${s.stateTokens} tok (${s.stateStage}) in ${s.requests} request(s), ${s.ms} ms`;
}

async function apiKeyFor($: { env: { get: (n: string) => Promise<string | undefined> } }, cfg: Config): Promise<string | undefined> {
  return cfg.apiKey ?? (await $.env.get('TYPESAFE_API_KEY'));
}

type Engine = EngineInterface;

/** The session's sticky taint merged with a fresh scan; persists the record the first time. */
async function sessionTaint($: Engine, sessionId: string | undefined, scan: ReturnType<typeof scanTaint>) {
  const sticky = sessionId ? await $.store.get(taintKey(sessionId)) : undefined;
  const merged = mergeTaint(sticky, scan);
  if (sessionId && scan.tainted && !(sticky && typeof sticky === 'object' && (sticky as { tainted?: unknown }).tainted === true)) {
    await $.store.set(taintKey(sessionId), taintRecord(scan, await $.clock.now()));
  }
  return merged;
}

async function markTainted($: Engine, tool: string): Promise<void> {
  const sessionId = await $.session.id();
  if (!sessionId) return;
  const key = taintKey(sessionId);
  const have = await $.store.get(key);
  if (have && typeof have === 'object' && (have as { tainted?: unknown }).tainted === true) return;
  await $.store.set(key, taintRecord({ tainted: true, count: 1, sample: [tool] }, await $.clock.now()));
}

/** Runs one compaction from inside the plugin; the session.compact hook decides Jev vs built-in. */
async function compactNow($: Engine, state: { compacting: boolean }, why: string): Promise<void> {
  if (state.compacting) return;
  state.compacting = true;
  try {
    const r = await $.session.compact();
    if (r && 'skip' in r && r.skip) {
      $.ui.log(`jev-compaction: ${why} compaction skipped (${r.skip})`);
      return;
    }
    // Hysteresis holds even when the session.compact hook itself was skipped: the
    // compaction stood, so the next turn's size is the new baseline.
    const sessionId = await $.session.id();
    if (sessionId) await $.store.set(baselineKey(sessionId), { pending: true, at: await $.clock.now() });
  } finally {
    state.compacting = false;
  }
}

type Baseline = { tokens?: number; pending?: boolean; at: number };
function readBaseline(v: unknown): Baseline | undefined {
  return v && typeof v === 'object' ? (v as Baseline) : undefined;
}

export const register: Register = (on: On, options: PluginOptions) => {
  const cfg = resolveConfig(options);
  const state = { compacting: false };
  // Cache-warm nudge: one pending timer, cancelled by any turn starting. `generation`
  // makes a timer that fires after a newer turn began a no-op even if cancel raced it.
  let nudge: Timer | undefined;
  let generation = 0;
  let turnRunning = false;
  const cancelNudge = () => { nudge?.cancel(); nudge = undefined; };

  on('session.start', async ($, event, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Jev verbatim compaction: on | off | status (email-tainted sessions always use the built-in summary).',
        argumentHint: 'on|off|status',
      });
    } catch { /* an older engine without command.register still compacts; only the switch is lost */ }
    try {
      // Per-session state is keyed by session id; prune what has not been touched in 30 days
      // so the 4 MiB store cannot fill with dead sessions.
      const now = await $.clock.now();
      const keys = (await $.store.keys()).filter((k) => /^(taint|baseline):/.test(k));
      const entries: [string, unknown][] = [];
      for (const k of keys) entries.push([k, await $.store.get(k)]);
      for (const k of expiredSessionKeys(entries, now)) await $.store.delete(k);
    } catch { /* pruning is housekeeping; never block a session on it */ }
    return next(event);
  });

  // Taint at the source: the moment an email tool is called or the email skill is
  // expanded, the session is marked, before any content reaches the transcript.
  on('tool.call', async ($, event, next) => {
    try {
      const input = event as unknown as Record<string, unknown>;
      if (taintsSession({ tool: event.tool, input }, cfg.taintTools, cfg.taintSkills)) await markTainted($, String(event.tool));
    } catch { /* marking must never block a tool call; the scans below are the backstop */ }
    return next(event);
  });

  on('skill.prompt', async ($, event, next) => {
    try {
      if (skillTaints(event.skill, cfg.taintSkills)) await markTainted($, `skill:${event.skill}`);
    } catch { /* as above */ }
    return next(event);
  });

  on('command.run', { command: COMMAND }, async ($, event) => {
    const mode = parseSwitchArgs(event.args);
    if (mode === 'on' || mode === 'off') await $.store.set(STORE_ENABLED, mode === 'on');
    const enabled = resolveEnabled(await $.store.get(STORE_ENABLED), cfg.enabledByDefault);
    const key = await apiKeyFor($, cfg);
    const sessionId = await $.session.id();
    const taint = await sessionTaint($, sessionId, scanTaint(await $.session.messages(), cfg.taintTools, cfg.taintSkills));
    const d = decide({ enabled, apiKey: key, taint, backendLocal: cfg.backendLocal });
    const last = (await $.store.get(STORE_LAST)) as string | undefined;
    const { context } = await $.session.usage();
    const threshold = triggerTokens({ window: context.window, compactAtPercent: cfg.compactAtPercent, compactAtTokens: cfg.compactAtTokens });
    const baseline = readBaseline(await $.store.get(baselineKey(sessionId)));
    const lines = [
      `jev-compaction: ${enabled ? 'ON' : 'OFF'}${mode === 'on' || mode === 'off' ? ' (saved)' : ''} · model ${cfg.model} · keep ≥ ${cfg.keepThreshold ?? 0.5}`,
      `trigger at ${Number.isFinite(threshold) ? `${Math.round(threshold / 1000)}k` : '?'} tokens (min of ${cfg.compactAtPercent}% of ${Math.round(context.window / 1000)}k and ${Math.round(cfg.compactAtTokens / 1000)}k) · context now ${context.tokens !== undefined ? `${Math.round(context.tokens / 1000)}k` : '?'}` +
        (baseline?.tokens ? ` · re-arms past ${Math.round((baseline.tokens + rearmGap(threshold, cfg.rearmTokens)) / 1000)}k` : ''),
      `cache-warm: ${cfg.cacheWarm}${cfg.cacheWarm === 'off' ? '' : ` above ${Math.round(cfg.cacheWarmFloorTokens / 1000)}k tokens, ${cfg.cacheTtlSeconds > 0 ? `TTL ${cfg.cacheTtlSeconds}s` : 'TTL auto'} − ${cfg.cacheTtlMarginSeconds}s margin`}`,
      `this session would ${d.run ? 'compact via Jev' : `use the built-in summary (${d.reason}${d.detail ? `: ${d.detail}` : ''})`}`,
      // Where a transcript would go is the fact an operator most needs before typing
      // `/jev-compact on`, and the one thing no other surface shows them.
      `endpoint: ${cfg.baseUrl ?? 'vendor cloud (default)'} · declared ${cfg.backendLocal ? 'LOCAL — tainted sessions may be judged' : 'NON-LOCAL — email-tainted sessions always use the built-in summary'}`,
      `taint rule: tools ${cfg.taintTools.join(', ')} · skills ${cfg.taintSkills.join(', ')} · sticky per session`,
      last ? `last outcome: ${last}` : 'no compaction yet this install',
      mode === 'help' ? 'usage: /jev-compact on | off | status' : '',
    ].filter(Boolean);
    return { text: lines.join('\n') };
  });

  on('session.compact', async ($, event, next) => {
    const sessionId = await $.session.id();
    // Any compaction that stands on the main conversation (ours, /compact, the engine's own)
    // resets the hysteresis baseline; its true size is read at the next turn.complete.
    const settle = async <T>(result: T): Promise<T> => {
      if (event.trigger !== 'precompute' && !event.agentId && sessionId && result && !(result as { skip?: unknown }).skip) {
        await $.store.set(baselineKey(sessionId), { pending: true, at: await $.clock.now() });
      }
      return result;
    };
    const enabled = resolveEnabled(await $.store.get(STORE_ENABLED), cfg.enabledByDefault);
    const key = await apiKeyFor($, cfg);
    const taint = await sessionTaint($, sessionId, scanTaint(event.messages, cfg.taintTools, cfg.taintSkills));
    const d = decide({ enabled, apiKey: key, taint, backendLocal: cfg.backendLocal });
    if (!d.run) {
      const note = `jev-compaction: built-in summary (${d.reason}${d.detail ? `: ${d.detail}` : ''})`;
      $.ui.log(note);
      if (d.reason === 'tainted') $.ui.toast(note, { timeoutMs: 8000 });
      await $.store.set(STORE_LAST, note);
      return settle(await next(event));
    }
    try {
      const result = await compact(
        event.messages,
        asker(async (url, init) => {
          const r = await $.http.fetch(url, init);
          return { status: r.status, ok: r.ok, text: r.text };
        }, key as string, cfg.model, cfg.baseUrl),
        cfg,
      );
      const summary = summarise(result);
      if (reductionRatio(result) < cfg.minReductionRatio) {
        const note = `jev-compaction: built-in summary (below ${pct(cfg.minReductionRatio)}: ${summary})`;
        $.ui.log(note); await $.store.set(STORE_LAST, note);
        return settle(await next(event));
      }
      const messages = toSessionMessages(event.messages, result.messages);
      const note = `jev-compaction: kept ${messages.length}/${event.messages.length} messages verbatim, no summary (${summary})`;
      $.ui.log(note); $.ui.toast(note, { timeoutMs: 12_000 }); await $.store.set(STORE_LAST, note);
      return settle({ messages });
    } catch (error) {
      const note = `jev-compaction: built-in summary (${error instanceof Error ? error.message : String(error)})`;
      $.ui.log(note); await $.store.set(STORE_LAST, note);
      return settle(await next(event));
    }
  });

  on('turn.start', async (_$, event, next) => {
    generation += 1; turnRunning = true; cancelNudge();
    return next(event);
  });

  on('turn.complete', async ($, event: TurnCompleteInput, next) => {
    // Subagent turns carry their own loop; the usage and the triggers are the main loop's.
    if (event.agentId) return next(event);
    turnRunning = false;
    cancelNudge();
    if (state.compacting) return next(event);
    try {
      const sessionId = await $.session.id();
      // Sticky taint: scan what the main conversation holds now, every turn, so a taint
      // is recorded before any compaction can summarise it away.
      await sessionTaint($, sessionId, scanTaint(await $.session.messages(), cfg.taintTools, cfg.taintSkills));
      if (!resolveEnabled(await $.store.get(STORE_ENABLED), cfg.enabledByDefault)) return next(event);
      const usage = await $.session.usage();
      const { context } = usage;
      const now = await $.clock.now();
      let baseline = readBaseline(await $.store.get(baselineKey(sessionId)));
      if (baseline?.pending && context.tokens !== undefined) {
        // First turn after a compaction: its context is the post-compaction size.
        baseline = { tokens: context.tokens, at: now };
        await $.store.set(baselineKey(sessionId), baseline);
      }
      const threshold = triggerTokens({ window: context.window, compactAtPercent: cfg.compactAtPercent, compactAtTokens: cfg.compactAtTokens });
      const gap = rearmGap(threshold, cfg.rearmTokens);
      const verdict = shouldCompact({
        tokens: context.tokens, percent: context.percent, window: context.window,
        compactAtPercent: cfg.compactAtPercent, compactAtTokens: cfg.compactAtTokens,
        rearmTokens: cfg.rearmTokens, baseline: baseline?.tokens,
      });
      if (verdict.run) {
        await compactNow($, state, 'threshold');
        return next(event);
      }
      if (verdict.reason === 'hysteresis') $.ui.log(`jev-compaction: at ${context.tokens} tokens, holding until ${verdict.need} (re-arm after last compaction)`);
      if (cfg.cacheWarm !== 'off' && shouldArmNudge({ tokens: context.tokens, floorTokens: cfg.cacheWarmFloorTokens, baseline: baseline?.tokens, gap })) {
        const ttl = cacheTtlSeconds({
          configured: cfg.cacheTtlSeconds,
          rateLimitsCount: usage.rateLimits.length,
          hasApiKey: Boolean(await $.env.get('ANTHROPIC_API_KEY')),
        });
        const delay = nudgeDelayMs(ttl, cfg.cacheTtlMarginSeconds);
        const armedAt = generation;
        const tokens = context.tokens as number;
        nudge = $.clock.after(delay, () => {
          nudge = undefined;
          if (armedAt !== generation || turnRunning || state.compacting) return;
          if (cfg.cacheWarm === 'notify') {
            $.ui.toast(`jev-compaction: ${Math.round(tokens / 1000)}k tokens in context and the prompt cache expires soon — /compact now while it is warm`, { timeoutMs: 60_000 });
            return;
          }
          $.ui.log(`jev-compaction: idle ${Math.round(delay / 1000)}s at ${tokens} tokens — compacting before the ${ttl}s prompt cache expires`);
          compactNow($, state, 'cache-warm').catch((error: unknown) => {
            $.ui.log(`jev-compaction: cache-warm compaction skipped (${error instanceof Error ? error.message : String(error)})`);
          });
        });
      }
    } catch (error) {
      $.ui.log(`jev-compaction: auto-compact skipped (${error instanceof Error ? error.message : String(error)})`);
    }
    return next(event);
  });
};
