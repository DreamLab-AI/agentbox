'use strict';
/**
 * orchestration-proxy.js — forward the orchestration tools of the governed
 * `claude-flow` MCP server to the real ruflo MCP server (ADR-2082).
 *
 * Background. `ruvector-mcp.cjs` replaced `claude-flow mcp start` so that every
 * memory_* call rides ruvector-postgres + Xinference (ADR-2014). The swarm /
 * agent / task / coordination tools it advertises have had NO implementation
 * since the 2026-06-11 audit removed the legacy server: they return an honest
 * `{ ok:false, error:'unimplemented' }`. Meanwhile the Nix closure bakes ruflo
 * v3, whose `ruflo mcp start` carries the real implementations and honours a
 * category filter (`CLAUDE_FLOW_MCP_TOOLS`, ruflo #2726).
 *
 * This module bridges the two WITHOUT reopening the memory path:
 *
 *   - A single ruflo child is spawned per governed-server process, lazily, with
 *     `CLAUDE_FLOW_MCP_TOOLS` set to the operator's category list (default
 *     `swarm,agent,task,coordination`). One child per Claude session, not one
 *     per tool call.
 *   - Its tools/list is merged into the governed server's catalogue, so the
 *     `mcp__claude-flow__swarm_init` names that 41 agent templates bind resolve
 *     to a real implementation with the upstream schema.
 *   - `DENIED_PREFIXES` is enforced on the proxy side regardless of the filter:
 *     no memory_*, agentdb_*, embeddings_* or hooks_* tool is ever forwarded, so
 *     ruflo's SQLite memory can never be reached through this server (ADR-2014
 *     access invariant).
 *   - Legacy v2 names the stubs advertise (task_orchestrate, load_balance,
 *     bottleneck_analyze) are aliased to their v3 equivalents with a thin
 *     argument shim; a legacy name whose target is not in the enabled
 *     categories stays an honest stub.
 *   - FAIL-OPEN for orchestration only: if ruflo is absent, fails to start, or
 *     dies, the stubs are advertised/answered exactly as before and memory is
 *     unaffected. The failure is logged, never fabricated as success.
 *
 * Everything that does not need a process is exported as a pure function so it
 * is testable with plain `node` (see orchestration-proxy.test.js).
 */

const { spawn } = require('child_process');
const readline = require('readline');

/** Tool-name prefixes that must never leave the governed server (ADR-2014). */
const DENIED_PREFIXES = ['memory_', 'agentdb_', 'embeddings_', 'hooks_', 'agentic_flow_', 'ruvllm_', 'agenticow_'];

/** ruflo category filter applied when the manifest does not name one. */
const DEFAULT_CATEGORIES = 'swarm,agent,task,coordination';

/**
 * Legacy (v2-era) tool names the governed server has always advertised, mapped
 * to the ruflo v3 tool that implements the same intent. `shim` rewrites the
 * legacy argument shape into the v3 one; anything it does not know it passes
 * through untouched so an already-v3-shaped call is not damaged.
 */
const LEGACY_ALIASES = {
  task_orchestrate: {
    target: 'coordination_orchestrate',
    shim(a) {
      const out = { ...a };
      // v2 strategies (adaptive, balanced) have no v3 enum member; the closest
      // honest default is parallel. Valid v3 values pass through.
      const v3 = new Set(['parallel', 'sequential', 'pipeline', 'broadcast']);
      if (out.strategy !== undefined && !v3.has(out.strategy)) out.strategy = 'parallel';
      delete out.priority; // v3 coordination_orchestrate has no priority field
      return out;
    },
  },
  load_balance: {
    target: 'coordination_load_balance',
    shim(a) {
      const out = { ...a };
      if (!out.action) out.action = 'distribute';
      if (Array.isArray(out.tasks) && out.task === undefined) out.task = out.tasks.map(String).join('; ');
      delete out.tasks;
      delete out.swarmId;
      return out;
    },
  },
  bottleneck_analyze: {
    target: 'performance_bottleneck',
    shim: (a) => ({ ...a }),
  },
  agent_spawn: {
    target: 'agent_spawn',
    shim(a) {
      // v2 callers pass `type`; v3 wants `agentType`. Prefer an explicit v3 field.
      const out = { ...a };
      if (out.agentType === undefined && out.type !== undefined) out.agentType = out.type;
      delete out.type;
      if (out.name !== undefined && out.agentId === undefined) out.agentId = out.name;
      delete out.name;
      return out;
    },
  },
};

function parseCategories(raw) {
  const s = String(raw == null ? '' : raw).trim();
  const list = (s || DEFAULT_CATEGORIES).split(',').map((x) => x.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_CATEGORIES.split(',');
}

function isDeniedTool(name) {
  const n = String(name || '');
  return DENIED_PREFIXES.some((p) => n.startsWith(p));
}

/**
 * Merge the child's advertised tools into the governed server's list.
 *
 * - A child tool with the same name as a local STUB replaces the stub (the
 *   upstream schema wins — that is the implementation callers now reach).
 * - A child tool with the same name as a local IMPLEMENTED tool (memory_*) is
 *   dropped; denied prefixes are dropped even if the filter let them through.
 * - A legacy alias whose target the child advertises keeps its legacy schema
 *   (that is the shape the agent templates use) but its description now says
 *   where the call goes.
 * - Every other stub is left exactly as it was: still honest, still unimplemented.
 *
 * @returns {{tools: object[], forwarded: Set<string>, aliased: Map<string,string>}}
 */
function mergeToolLists(localTools, childTools) {
  const child = new Map();
  for (const t of childTools || []) {
    if (!t || typeof t.name !== 'string') continue;
    if (isDeniedTool(t.name)) continue;
    child.set(t.name, t);
  }
  const isStub = (t) => typeof t.description === 'string' && t.description.startsWith('[unimplemented in ruvector-mcp]');
  const localImplemented = new Set(localTools.filter((t) => !isStub(t)).map((t) => t.name));

  const forwarded = new Set();
  const aliased = new Map();
  const tools = [];
  for (const t of localTools) {
    if (isStub(t) && child.has(t.name) && !LEGACY_ALIASES[t.name]) {
      tools.push({ ...child.get(t.name), name: t.name });
      forwarded.add(t.name);
      continue;
    }
    const alias = LEGACY_ALIASES[t.name];
    if (isStub(t) && alias && child.has(alias.target)) {
      const target = child.get(alias.target);
      // agent_spawn is both a stub name and a real v3 tool: advertise the
      // upstream schema so the v3 fields are discoverable, keep the shim so v2
      // callers still work.
      const schema = alias.target === t.name ? target.inputSchema : t.inputSchema;
      const desc = alias.target === t.name
        ? target.description
        : `Alias → ruflo ${alias.target} (v2 name kept for agent templates; arguments are shimmed). ${target.description || ''}`.trim();
      tools.push({ ...t, description: desc, inputSchema: schema });
      forwarded.add(t.name);
      aliased.set(t.name, alias.target);
      continue;
    }
    tools.push(t);
  }
  for (const [name, t] of child) {
    if (localImplemented.has(name) || forwarded.has(name)) continue;
    tools.push(t);
    forwarded.add(name);
  }
  return { tools, forwarded, aliased };
}

/** Resolve a call: returns { target, args } or null when the proxy does not handle it. */
function resolveCall(name, args, forwarded, aliased) {
  if (!forwarded.has(name)) return null;
  const alias = aliased.get(name);
  if (alias) {
    const shim = LEGACY_ALIASES[name] && LEGACY_ALIASES[name].shim;
    return { target: alias, args: shim ? shim(args || {}) : (args || {}) };
  }
  if (LEGACY_ALIASES[name] && LEGACY_ALIASES[name].target === name) {
    return { target: name, args: LEGACY_ALIASES[name].shim(args || {}) };
  }
  return { target: name, args: args || {} };
}

/**
 * ruflo answers tools/call with MCP content blocks whose text is (usually)
 * JSON. The governed server re-serialises whatever executeTool returns, so
 * unwrap to an object where possible and never lose an upstream error flag.
 */
function unwrapChildResult(result) {
  if (!result || typeof result !== 'object') return { ok: false, error: 'empty_result' };
  const blocks = Array.isArray(result.content) ? result.content : [];
  const texts = blocks.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
  let payload;
  if (texts.length === 1) {
    try { payload = JSON.parse(texts[0]); } catch { payload = { text: texts[0] }; }
  } else if (texts.length > 1) {
    payload = { text: texts.join('\n') };
  } else {
    payload = { ...result };
    delete payload.content;
  }
  if (result.isError) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return { ok: false, error: payload.error || 'upstream_error', ...payload };
    }
    return { ok: false, error: 'upstream_error', detail: payload };
  }
  return payload;
}

/**
 * Create the proxy. Nothing is spawned until `advertise()` or `call()` runs.
 *
 * @param {object} opts
 * @param {(level:string,msg:string)=>void} opts.log
 * @param {NodeJS.ProcessEnv} [opts.env]           defaults to process.env
 * @param {typeof spawn} [opts.spawnImpl]           test seam
 * @param {string} [opts.command]                    default env RUVECTOR_ORCHESTRATION_CMD || 'ruflo'
 * @param {string[]} [opts.args]                     default ['mcp','start']
 */
function createOrchestrationProxy(opts = {}) {
  const log = opts.log || (() => {});
  const env = opts.env || process.env;
  const spawnImpl = opts.spawnImpl || spawn;
  const command = opts.command || env.RUVECTOR_ORCHESTRATION_CMD || 'ruflo';
  const args = opts.args || (env.RUVECTOR_ORCHESTRATION_ARGS
    ? env.RUVECTOR_ORCHESTRATION_ARGS.split(/\s+/).filter(Boolean)
    : ['mcp', 'start']);
  const categories = parseCategories(env.RUVECTOR_ORCHESTRATION_TOOLS);
  const cwd = env.RUVECTOR_ORCHESTRATION_CWD || process.cwd();
  const startupMs = Math.max(1000, parseInt(env.RUVECTOR_ORCHESTRATION_STARTUP_MS || '20000', 10) || 20000);
  const callMs = Math.max(1000, parseInt(env.RUVECTOR_ORCHESTRATION_TIMEOUT_MS || '60000', 10) || 60000);
  const maxRespawns = 3;

  let child = null;
  let ready = null;           // Promise<void> for the current child's handshake
  let respawns = 0;
  let seq = 0;
  const pending = new Map();  // id -> {resolve, reject, timer}
  let forwarded = new Set();
  let aliased = new Map();
  let childTools = null;      // cached tools/list from the child
  let lastError = null;

  function failPending(reason) {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      pending.delete(id);
    }
  }

  function send(msg) {
    if (!child || !child.stdin || child.stdin.destroyed) throw new Error('orchestration child not running');
    child.stdin.write(JSON.stringify(msg) + '\n');
  }

  function request(method, params, timeoutMs) {
    const id = `op-${++seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { send({ jsonrpc: '2.0', id, method, params }); }
      catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
    });
  }

  function onLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try { msg = JSON.parse(trimmed); } catch { return; } // ruflo may print non-JSON on stdout; ignore
    if (msg.id === undefined || !pending.has(msg.id)) return; // notification or foreign id
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  }

  function start() {
    if (ready) return ready;
    if (respawns > maxRespawns) {
      return Promise.reject(new Error(`orchestration child exceeded ${maxRespawns} respawns (last: ${lastError})`));
    }
    ready = new Promise((resolve, reject) => {
      let proc;
      try {
        proc = spawnImpl(command, args, {
          cwd,
          env: { ...env, CLAUDE_FLOW_MCP_TRANSPORT: 'stdio', CLAUDE_FLOW_MCP_TOOLS: categories.join(',') },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (e) {
        ready = null; lastError = e.message; respawns++;
        reject(e); return;
      }
      child = proc;
      let settled = false;
      const settle = (fn, v) => { if (!settled) { settled = true; fn(v); } };

      proc.on('error', (e) => {
        lastError = e.message;
        log('WARN', `orchestration child failed to start (${command} ${args.join(' ')}): ${e.message}`);
        failPending(`orchestration child error: ${e.message}`);
        child = null; ready = null; childTools = null; respawns++;
        settle(reject, e);
      });
      proc.on('exit', (code, signal) => {
        lastError = `exit code=${code} signal=${signal}`;
        log('WARN', `orchestration child exited (${lastError}); pending calls fail, next call respawns`);
        failPending(`orchestration child exited (${lastError})`);
        child = null; ready = null; childTools = null; respawns++;
        settle(reject, new Error(lastError));
      });
      readline.createInterface({ input: proc.stdout, crlfDelay: Infinity }).on('line', onLine);
      readline.createInterface({ input: proc.stderr, crlfDelay: Infinity }).on('line', (l) => {
        if (l.trim()) log('DEBUG', `[ruflo] ${l.slice(0, 300)}`);
      });

      request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'ruvector-mcp-orchestration-proxy', version: '1.0.0' },
      }, startupMs).then((info) => {
        try { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); } catch {}
        const v = info && info.serverInfo ? `${info.serverInfo.name}@${info.serverInfo.version}` : 'unknown';
        log('INFO', `orchestration child ready: ${v} pid=${proc.pid} categories=${categories.join(',')} cwd=${cwd}`);
        settle(resolve);
      }).catch((e) => {
        lastError = e.message;
        log('WARN', `orchestration child handshake failed: ${e.message}`);
        try { proc.kill('SIGTERM'); } catch {}
        settle(reject, e);
      });
    });
    return ready;
  }

  async function listChildTools() {
    if (childTools) return childTools;
    await start();
    const res = await request('tools/list', {}, startupMs);
    const tools = res && Array.isArray(res.tools) ? res.tools : [];
    const denied = tools.filter((t) => isDeniedTool(t.name)).map((t) => t.name);
    if (denied.length) log('WARN', `orchestration child advertised ${denied.length} denied tool(s) despite the filter; dropped: ${denied.slice(0, 8).join(',')}${denied.length > 8 ? ',…' : ''}`);
    childTools = tools.filter((t) => !isDeniedTool(t.name));
    return childTools;
  }

  return {
    categories,
    command,
    args,
    /** Merge the child's tools into `localTools`; on any failure returns `localTools` unchanged (fail-open). */
    async advertise(localTools) {
      try {
        const ct = await listChildTools();
        const merged = mergeToolLists(localTools, ct);
        forwarded = merged.forwarded;
        aliased = merged.aliased;
        log('INFO', `orchestration proxy: forwarding ${forwarded.size} tool(s) (${aliased.size} legacy alias(es)) to ruflo`);
        return merged.tools;
      } catch (e) {
        log('WARN', `orchestration proxy unavailable — advertising honest stubs (${e.message})`);
        forwarded = new Set(); aliased = new Map();
        return localTools;
      }
    },
    /** True when a tools/call for `name` should be forwarded. */
    handles(name) { return forwarded.has(name); },
    /** Forward a call. Returns the unwrapped upstream payload or an honest error object. */
    async call(name, args) {
      const r = resolveCall(name, args, forwarded, aliased);
      if (!r) return { ok: false, success: false, error: 'unimplemented', tool: name, message: `${name} is not forwarded by the orchestration proxy`, timestamp: new Date().toISOString() };
      try {
        await start();
        const result = await request('tools/call', { name: r.target, arguments: r.args }, callMs);
        const out = unwrapChildResult(result);
        if (out && typeof out === 'object' && !Array.isArray(out) && r.target !== name) out._proxied_as = r.target;
        return out;
      } catch (e) {
        log('WARN', `orchestration call ${name} → ${r.target} failed: ${e.message}`);
        return { ok: false, success: false, error: 'orchestration_unavailable', tool: name, target: r.target, message: e.message, timestamp: new Date().toISOString() };
      }
    },
    /** Diagnostic snapshot (surfaced by memory_health when the gate is on). */
    status() {
      return {
        enabled: true,
        command, args, categories, cwd,
        child_pid: child ? child.pid : null,
        child_running: !!child,
        forwarded: forwarded.size,
        aliases: Object.fromEntries(aliased),
        respawns,
        last_error: lastError,
      };
    },
    shutdown() {
      failPending('orchestration proxy shutting down');
      if (child) { try { child.kill('SIGTERM'); } catch {} }
      child = null; ready = null; childTools = null;
    },
  };
}

module.exports = {
  DENIED_PREFIXES,
  DEFAULT_CATEGORIES,
  LEGACY_ALIASES,
  parseCategories,
  isDeniedTool,
  mergeToolLists,
  resolveCall,
  unwrapChildResult,
  createOrchestrationProxy,
};
