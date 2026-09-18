// jev-compaction.ts — agentbox's function-hook adapter over the vendored
// fast-jev-compaction library (ADR-2093). Registered by the entrypoint when
// [features.jev_compaction].enabled = true; absent otherwise.
//
// What it adds to upstream's hook, and why:
//   • a TAINT GATE: a transcript that contains any email tool use (or any tool
//     in `taintTools` / skill in `taintSkills`) is never sent to Jev — the
//     built-in summary runs instead. Decided per compaction from the messages
//     being compacted, so it is stateless and cannot be out of date;
//   • a SWITCH: `/jev-compact on|off|status`, persisted in the plugin store
//     across sessions; `enabledByDefault` comes from the manifest;
//   • FAIL-OPEN everywhere: any throw, a missing key, a below-threshold
//     reduction, a tainted session ⇒ `next(event)`, the built-in compaction,
//     with one log line saying which.
// Nothing else is changed: the judgement, batching, fitting and rebuild are
// upstream's, under lib/ (MIT, tamaratran/fast-jev-compaction e3f262a).

import type { On, PluginOptions, Register, SessionMessage, TurnCompleteInput } from 'claude-code';

import { compact, reductionRatio } from '../lib/compact.js';
import { buildJevRequest, DEFAULT_MODEL, parseJevResponse } from '../lib/request.js';
import type { CompactOptions, CompactResult, JevAsker, Message, ToolResult, ToolUse } from '../lib/types.js';
import {
  DEFAULT_TAINT_SKILLS,
  DEFAULT_TAINT_TOOLS,
  decide,
  listOption,
  parseSwitchArgs,
  resolveEnabled,
  scanTaint,
} from './policy.mjs';

const STORE_ENABLED = 'enabled';
const STORE_LAST = 'last';
const COMMAND = 'jev-compact';

type Config = CompactOptions & {
  apiKey?: string;
  compactAtPercent: number;
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
    minReductionRatio: num(options, 'minReductionRatio', 0.25),
    model: str(options, 'model') ?? DEFAULT_MODEL,
    enabledByDefault: options['enabledByDefault'],
    taintTools: listOption(options['taintTools'], DEFAULT_TAINT_TOOLS),
    taintSkills: listOption(options['taintSkills'], DEFAULT_TAINT_SKILLS),
  };
  const apiKey = str(options, 'apiKey');
  if (apiKey) config.apiKey = apiKey;
  return config;
}

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ status: number; ok: boolean; text: string }>;

function asker(fetchFn: Fetch, apiKey: string, model: string): JevAsker {
  return {
    async ask(state, questions) {
      const r = buildJevRequest({ apiKey, model }, state, questions);
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

export const register: Register = (on: On, options: PluginOptions) => {
  const cfg = resolveConfig(options);
  let compacting = false;

  on('session.start', async ($, event, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Jev verbatim compaction: on | off | status (email-tainted sessions always use the built-in summary).',
        argumentHint: 'on|off|status',
      });
    } catch { /* an older engine without command.register still compacts; only the switch is lost */ }
    return next(event);
  });

  on('command.run', { command: COMMAND }, async ($, event) => {
    const mode = parseSwitchArgs(event.args);
    if (mode === 'on' || mode === 'off') await $.store.set(STORE_ENABLED, mode === 'on');
    const enabled = resolveEnabled(await $.store.get(STORE_ENABLED), cfg.enabledByDefault);
    const key = await apiKeyFor($, cfg);
    const taint = scanTaint(await $.session.messages(), cfg.taintTools, cfg.taintSkills);
    const d = decide({ enabled, apiKey: key, taint });
    const last = (await $.store.get(STORE_LAST)) as string | undefined;
    const lines = [
      `jev-compaction: ${enabled ? 'ON' : 'OFF'}${mode === 'on' || mode === 'off' ? ' (saved)' : ''} · model ${cfg.model} · trigger at ${cfg.compactAtPercent}% · keep ≥ ${cfg.keepThreshold ?? 0.5}`,
      `this session would ${d.run ? 'compact via Jev' : `use the built-in summary (${d.reason}${d.detail ? `: ${d.detail}` : ''})`}`,
      `taint rule: tools ${cfg.taintTools.join(', ')} · skills ${cfg.taintSkills.join(', ')}`,
      last ? `last outcome: ${last}` : 'no compaction yet this install',
      mode === 'help' ? 'usage: /jev-compact on | off | status' : '',
    ].filter(Boolean);
    return { text: lines.join('\n') };
  });

  on('session.compact', async ($, event, next) => {
    const enabled = resolveEnabled(await $.store.get(STORE_ENABLED), cfg.enabledByDefault);
    const key = await apiKeyFor($, cfg);
    const taint = scanTaint(event.messages, cfg.taintTools, cfg.taintSkills);
    const d = decide({ enabled, apiKey: key, taint });
    if (!d.run) {
      const note = `jev-compaction: built-in summary (${d.reason}${d.detail ? `: ${d.detail}` : ''})`;
      $.ui.log(note);
      if (d.reason === 'tainted') $.ui.toast(note, { timeoutMs: 8000 });
      await $.store.set(STORE_LAST, note);
      return next(event);
    }
    try {
      const result = await compact(
        event.messages,
        asker(async (url, init) => {
          const r = await $.http.fetch(url, init);
          return { status: r.status, ok: r.ok, text: r.text };
        }, key as string, cfg.model),
        cfg,
      );
      const summary = summarise(result);
      if (reductionRatio(result) < cfg.minReductionRatio) {
        const note = `jev-compaction: built-in summary (below ${pct(cfg.minReductionRatio)}: ${summary})`;
        $.ui.log(note); await $.store.set(STORE_LAST, note);
        return next(event);
      }
      const messages = toSessionMessages(event.messages, result.messages);
      const note = `jev-compaction: kept ${messages.length}/${event.messages.length} messages verbatim, no summary (${summary})`;
      $.ui.log(note); $.ui.toast(note, { timeoutMs: 12_000 }); await $.store.set(STORE_LAST, note);
      return { messages };
    } catch (error) {
      const note = `jev-compaction: built-in summary (${error instanceof Error ? error.message : String(error)})`;
      $.ui.log(note); await $.store.set(STORE_LAST, note);
      return next(event);
    }
  });

  on('turn.complete', async ($, event: TurnCompleteInput, next) => {
    if (compacting) return next(event);
    try {
      if (!resolveEnabled(await $.store.get(STORE_ENABLED), cfg.enabledByDefault)) return next(event);
      const { context } = await $.session.usage();
      if ((context.percent ?? 0) < cfg.compactAtPercent) return next(event);
      compacting = true;
      await $.session.compact();
    } catch (error) {
      $.ui.log(`jev-compaction: auto-compact skipped (${error instanceof Error ? error.message : String(error)})`);
    } finally {
      compacting = false;
    }
    return next(event);
  });
};
