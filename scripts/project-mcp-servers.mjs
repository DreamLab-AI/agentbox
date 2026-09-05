#!/usr/bin/env node
// project-mcp-servers.mjs — project .mcp.json server entries FROM skills/mcp.json (MCP-1/MCP-2).
//
// The audit (audit-2026-07-15.md MCP-1) found that skills/mcp.json — a 28-server
// registry — has NO runtime consumer: the entrypoint hand-maintains a divergent
// per-server allowlist, and ~19 documented+gated servers (codebase-memory,
// web-researcher, the five consultants, code-interpreter, aci-shell …) register
// nowhere the Claude Code harness reads. MCP-2: codebase-memory is manifest-ON
// and CLAUDE.md-mandated "USE FIRST" yet has zero registrant.
//
// This script makes skills/mcp.json the SOURCE and the entrypoint the PROJECTOR,
// exactly like registered-skills.txt + reconcile-skills.sh did for skills. For
// every server the registry marks `x-agentbox-managed-by: "projector"` it:
//   1. evaluates the server's gate (`x-agentbox-gate`) against the boot env,
//   2. checks the server's `x-agentbox-requires` (binary on PATH / file present /
//      env var non-empty) so a server whose binary was GC'd or whose key is unset
//      is never registered as a dead entry,
//   3. expands ${VAR} / ${VAR:-default} in its command/args/env/headers,
//   4. UPSERTS it into .mcp.json (reconcile, not append: a managed server whose
//      gate/requires now fail is REMOVED — closing the add-only rot of MCP-6).
//
// Servers marked `"bespoke"` (claude-flow, browser-gpu, perplexity, …) keep their
// existing hand-written entrypoint blocks (health probes, secret handling, warmup)
// and are NEVER touched here, so the currently-live set stays byte-identical for
// their gates. Servers marked `"reference"` (GPU-sidecar skill wrappers whose
// mcp-server lives under a skill dir, or npx/uvx network-installer servers that
// cannot run on the read-only rootfs) are documented but not auto-projected.
//
// ---------------------------------------------------------------------------
// ADR-2008 closeout (2026-09-05). The estate review reproduced four defects in
// the previous revision, each fixed here:
//
//   D1  DELETED DEFINITION LEAKED. The reconcile loop only ever iterated the
//       REGISTRY, so a managed entry whose definition was deleted (or renamed)
//       stayed in .mcp.json forever — the projector could add and update but
//       never notice a disappearance. Fixed by an OWNERSHIP LEDGER (see below):
//       projection records which names this projector owns, and any owned name
//       that is no longer a projector-managed registry definition is removed
//       from the target and recorded in the ledger's deletion history.
//
//   D2  NO SCHEMA VALIDATION. Any JSON shape was accepted; a mistyped `args`
//       string or a bogus gate expression silently projected a broken server.
//       Fixed by validateRegistry() — a total, explicit schema check whose
//       failures are enumerated before anything is written.
//
//   D3  MALFORMED INPUT EXITED ZERO. An unparseable registry logged a line and
//       exited 0, so a truncated file looked like a successful no-op run.
//       Fixed: malformed/invalid input now exits NON-ZERO (see EXIT CODES) and
//       the previous target is retained byte-for-byte.
//
//   D4  MISSING `x-agentbox-requires` REMOVED THE ENTRY. requiresMet() returned
//       the boolean `true` for a non-array, so `req.ok` was `undefined` →
//       falsy → the gated-ON server was reconciled OUT. Fixed: the function is
//       total and always returns {ok, why}; an absent requirements array is the
//       empty requirement set, reported explicitly in the run summary.
//
// OWNERSHIP LEDGER. Sidecar JSON beside the target (override: MCP_PROJECTION_STATE)
// holding the names this projector has written, their last projected definition
// hash, and a bounded deletion/rename history. It is deliberately NOT stored
// inside .mcp.json: that file is read by the Claude Code harness and must carry
// no agentbox-private keys. A target entry absent from the ledger is treated as
// bespoke and is never touched — so adopting this revision cannot delete a
// hand-written server, and names projected before the ledger existed are adopted
// on their next successful projection.
//
// ATOMICITY. The target is replaced by write-to-temp + fsync + rename(2) within
// the same directory, preserving the previous file mode. A crash or an error at
// any point leaves the previous .mcp.json intact; there is no window in which a
// reader observes a partial file.
//
// EXIT CODES
//   0  projection applied (or a clean no-op)
//   2  registry unreadable, unparseable or schema-invalid — target untouched
//   3  target unreadable/unparseable, or the atomic replacement failed
//
// BOOT IS STILL NOT BLOCKED: config/entrypoint-unified.sh pipes this script
// through sed and appends `|| true`, so a non-zero exit surfaces in the boot log
// as a loud [mcp] FAIL line without aborting the entrypoint. The non-zero status
// is what makes the failure visible to CI and to an operator running it by hand.
//
// Usage: project-mcp-servers.mjs [--dry-run]
//   env MCP_REGISTRY          source registry (default $SKILLS_TREE/mcp.json)
//   env MCP_JSON              target .mcp.json (default $WORKSPACE/.mcp.json)
//   env MCP_PROJECTION_STATE  ownership ledger (default <dir of target>/.mcp-projection-state.json)
//   env SKILLS_TREE           default /opt/agentbox/skills
//   env WORKSPACE             default /home/devuser/workspace

import fs from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry-run');
const SKILLS_TREE = process.env.SKILLS_TREE || '/opt/agentbox/skills';
const WORKSPACE = process.env.WORKSPACE || '/home/devuser/workspace';
const REGISTRY = process.env.MCP_REGISTRY || path.join(SKILLS_TREE, 'mcp.json');
const TARGET = process.env.MCP_JSON || path.join(WORKSPACE, '.mcp.json');
const STATE = process.env.MCP_PROJECTION_STATE
  || path.join(path.dirname(TARGET), '.mcp-projection-state.json');

const LEDGER_VERSION = 1;
const HISTORY_LIMIT = 200;
const MANAGED_BY_VALUES = new Set(['projector', 'bespoke', 'reference']);
const GATE_RE = /^(env|envset):[A-Za-z_][A-Za-z0-9_]*$/;

const log = (m) => console.log(`[project-mcp]${DRY ? ' DRY' : ''} ${m}`);
const fail = (code, m) => { console.error(`[project-mcp] FAIL ${m}`); process.exit(code); };

// ${VAR} and ${VAR:-default} expansion against process.env (no shell; safe).
function expand(str) {
  return String(str).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
    (_, name, def) => {
      const v = process.env[name];
      return (v === undefined || v === '') ? (def ?? '') : v;
    });
}
function expandDeep(v) {
  if (typeof v === 'string') return expand(v);
  if (Array.isArray(v)) return v.map(expandDeep);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = expandDeep(val);
    return o;
  }
  return v;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Memoised PATH lookup, resolved in-process. The previous revision shelled out
// to `command -v $name`, which put a registry-controlled string on a shell
// command line; this walks $PATH with fs.accessSync instead, so no registry
// value is ever interpreted by a shell.
const _binCache = new Map();
function binOnPath(name) {
  if (_binCache.has(name)) return _binCache.get(name);
  let present = false;
  if (typeof name === 'string' && name !== '') {
    if (name.includes('/')) {
      // An explicit path is checked directly rather than searched.
      try { fs.accessSync(name, fs.constants.X_OK); present = true; } catch { present = false; }
    } else {
      for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        if (!dir) continue;
        try { fs.accessSync(path.join(dir, name), fs.constants.X_OK); present = true; break; }
        catch { /* not here; keep looking */ }
      }
    }
  }
  _binCache.set(name, present);
  return present;
}

// ---------------------------------------------------------------------------
// D2 — registry schema validation
// ---------------------------------------------------------------------------
// Total check over the shapes this projector consumes. Every failure is
// collected (not thrown on the first) so one run reports the whole problem.
// Only projector-managed definitions are validated deeply: bespoke/reference
// entries are documentation this script never reads into the target, and
// holding them to the projector's contract would make the registry harder to
// use for its other purposes.
function validateRegistry(registry) {
  const errors = [];
  if (!isPlainObject(registry)) {
    return { ok: false, errors: ['registry root is not a JSON object'] };
  }
  if (registry.mcpServers !== undefined && !isPlainObject(registry.mcpServers)) {
    return { ok: false, errors: ['registry.mcpServers is present but is not an object'] };
  }
  const servers = registry.mcpServers || {};
  for (const [name, def] of Object.entries(servers)) {
    const at = (msg) => errors.push(`mcpServers[${JSON.stringify(name)}]: ${msg}`);
    if (!isPlainObject(def)) { at('definition is not an object'); continue; }

    const managed = def['x-agentbox-managed-by'];
    if (managed !== undefined && !MANAGED_BY_VALUES.has(managed)) {
      at(`x-agentbox-managed-by ${JSON.stringify(managed)} is not one of ${[...MANAGED_BY_VALUES].join('/')}`);
    }
    if (managed !== 'projector') continue;

    const gate = def['x-agentbox-gate'];
    if (gate !== undefined && gate !== 'requires' && gate !== 'never' && !GATE_RE.test(String(gate))) {
      at(`x-agentbox-gate ${JSON.stringify(gate)} is not "requires", "never" or "<env|envset>:VAR"`);
    }

    const reqs = def['x-agentbox-requires'];
    if (reqs !== undefined && reqs !== null && !Array.isArray(reqs)) {
      at('x-agentbox-requires must be an array when present');
    } else if (Array.isArray(reqs)) {
      reqs.forEach((r, i) => {
        if (!isPlainObject(r)) { at(`x-agentbox-requires[${i}] is not an object`); return; }
        const keys = Object.keys(r);
        if (keys.length === 0) at(`x-agentbox-requires[${i}] is empty`);
        for (const k of keys) {
          if (!['bin', 'file', 'envset'].includes(k)) at(`x-agentbox-requires[${i}] has unknown key ${JSON.stringify(k)}`);
        }
        if (r.bin !== undefined) {
          const bins = Array.isArray(r.bin) ? r.bin : [r.bin];
          if (!bins.length || !bins.every((b) => typeof b === 'string' && b !== '')) {
            at(`x-agentbox-requires[${i}].bin must be a non-empty string or array of them`);
          }
        }
        if (r.file !== undefined && (typeof r.file !== 'string' || r.file === '')) at(`x-agentbox-requires[${i}].file must be a non-empty string`);
        if (r.envset !== undefined && (typeof r.envset !== 'string' || r.envset === '')) at(`x-agentbox-requires[${i}].envset must be a non-empty string`);
      });
    }

    // Transport: either a local command, or a remote url with an http/sse type.
    const hasCommand = typeof def.command === 'string' && def.command !== '';
    const hasUrl = typeof def.url === 'string' && def.url !== '';
    if (!hasCommand && !hasUrl) at('needs a non-empty "command" (stdio) or "url" (http/sse)');
    if (def.args !== undefined) {
      if (!Array.isArray(def.args) || !def.args.every((a) => typeof a === 'string')) at('"args" must be an array of strings');
    }
    for (const mapKey of ['env', 'headers']) {
      const m = def[mapKey];
      if (m === undefined) continue;
      if (!isPlainObject(m) || !Object.values(m).every((v) => typeof v === 'string')) {
        at(`"${mapKey}" must be an object of string values`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Gate + requirements evaluation
// ---------------------------------------------------------------------------
// Gate grammar (x-agentbox-gate):
//   "env:VAR"     true when env VAR in (true,1,yes,on)
//   "envset:VAR"  true when env VAR is non-empty
//   "requires"    gate rests entirely on x-agentbox-requires (package-gated: the
//                 nix build only bakes the binary when its manifest gate is on)
//   "never"       never register (documentation-only entry)
function gateOpen(gate) {
  if (!gate || gate === 'never') return false;
  if (gate === 'requires') return true;
  const [kind, name] = String(gate).split(':');
  const v = process.env[name];
  if (kind === 'envset') return !!(v && v !== '');
  if (kind === 'env') return ['true', '1', 'yes', 'on'].includes(String(v || '').toLowerCase());
  return false;
}

// D4 — TOTAL: always returns {ok, why}. An absent/null requirements array is
// the EMPTY requirement set (nothing extra to satisfy), not a failure and not a
// bare boolean whose `.ok` is undefined. `explicit` lets the summary distinguish
// "declared no requirements" from "declared requirements, all met".
function requiresMet(reqs) {
  if (reqs === undefined || reqs === null) return { ok: true, explicit: false, why: null };
  if (!Array.isArray(reqs)) return { ok: false, explicit: true, why: 'x-agentbox-requires is not an array' };
  for (const r of reqs) {
    if (r.bin) {
      const bins = Array.isArray(r.bin) ? r.bin : [r.bin];
      if (!bins.some(binOnPath)) return { ok: false, explicit: true, why: `missing bin ${bins.join('|')}` };
    }
    if (r.file && !fs.existsSync(expand(r.file))) return { ok: false, explicit: true, why: `missing file ${r.file}` };
    if (r.envset && !(process.env[r.envset] && process.env[r.envset] !== '')) return { ok: false, explicit: true, why: `unset ${r.envset}` };
  }
  return { ok: true, explicit: true, why: null };
}

// ---------------------------------------------------------------------------
// Ownership ledger (D1)
// ---------------------------------------------------------------------------
function emptyLedger() {
  return { version: LEDGER_VERSION, updated: null, registry: REGISTRY, target: TARGET, owned: {}, history: [] };
}
function readLedger() {
  let raw;
  try { raw = fs.readFileSync(STATE, 'utf8'); }
  catch { return emptyLedger(); }               // first run, or ledger removed
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    // A corrupt ledger must not licence deleting live entries: fall back to an
    // empty ownership set, so this run adopts only what it actually projects.
    log(`WARN ownership ledger ${STATE} is unparseable — treating every target entry as bespoke this run`);
    return emptyLedger();
  }
  const led = emptyLedger();
  if (isPlainObject(parsed)) {
    if (isPlainObject(parsed.owned)) led.owned = parsed.owned;
    if (Array.isArray(parsed.history)) led.history = parsed.history;
  }
  return led;
}
function writeLedger(led) {
  led.version = LEDGER_VERSION;
  led.updated = new Date().toISOString();
  led.registry = REGISTRY;
  led.target = TARGET;
  if (led.history.length > HISTORY_LIMIT) led.history = led.history.slice(-HISTORY_LIMIT);
  atomicWriteJson(STATE, led, 0o600);
}

// ---------------------------------------------------------------------------
// Atomic replacement: temp file in the SAME directory, fsync, rename(2).
// ---------------------------------------------------------------------------
function atomicWriteJson(file, value, fallbackMode) {
  const dir = path.dirname(file);
  let mode = fallbackMode;
  try { mode = fs.statSync(file).mode & 0o7777; } catch { /* new file: keep fallback */ }
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'w', mode);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { if (fd !== undefined) fs.closeSync(fd); } catch { /* already closed */ }
    try { fs.unlinkSync(tmp); } catch { /* never created */ }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Load inputs. D3: malformed input is a NON-ZERO failure, target untouched.
// ---------------------------------------------------------------------------
let registryRaw;
try { registryRaw = fs.readFileSync(REGISTRY, 'utf8'); }
catch (e) { fail(2, `registry unreadable (${REGISTRY}): ${e && e.message} — target ${TARGET} left unchanged`); }

let registry;
try { registry = JSON.parse(registryRaw); }
catch (e) { fail(2, `registry ${REGISTRY} is not valid JSON: ${e && e.message} — target ${TARGET} left unchanged`); }

const schema = validateRegistry(registry);
if (!schema.ok) {
  for (const err of schema.errors) console.error(`[project-mcp]   ${err}`);
  fail(2, `registry ${REGISTRY} failed schema validation (${schema.errors.length} error(s)) — target ${TARGET} left unchanged`);
}

let target;
try { target = JSON.parse(fs.readFileSync(TARGET, 'utf8')); }
catch (e) { fail(3, `target ${TARGET} absent or unparseable: ${e && e.message} — nothing written (the ruvector-mcp block writes it first)`); }
if (!isPlainObject(target)) fail(3, `target ${TARGET} root is not a JSON object — nothing written`);

const srcServers = registry.mcpServers || {};
target.mcpServers = isPlainObject(target.mcpServers) ? target.mcpServers : {};

const ledger = readLedger();
const now = new Date().toISOString();

let added = 0, updated = 0, removed = 0, skipped = 0, ok = 0, orphaned = 0;
const addedNames = [], removedNames = [], skippedNotes = [], orphanNotes = [], implicitRequires = [];
const managedNames = new Set();

for (const [name, def] of Object.entries(srcServers)) {
  if (def['x-agentbox-managed-by'] !== 'projector') continue;   // bespoke/reference/absent → untouched
  managedNames.add(name);

  const gate = def['x-agentbox-gate'];
  const open = gateOpen(gate);
  const req = open ? requiresMet(def['x-agentbox-requires']) : { ok: false, explicit: true, why: `gate ${gate} closed` };
  if (open && req.ok && !req.explicit) implicitRequires.push(name);

  if (!req.ok) {
    // Reconcile: a managed server whose gate/requires now fail is removed.
    if (target.mcpServers[name]) {
      removedNames.push(`${name} (${req.why})`);
      if (!DRY) {
        delete target.mcpServers[name];
        delete ledger.owned[name];
        ledger.history.push({ name, event: 'gate-closed', reason: req.why, at: now });
      }
      removed++;
    } else {
      skipped++; skippedNotes.push(`${name}: ${req.why}`);
    }
    continue;
  }

  // Build the projected entry: strip x-agentbox-* annotations, expand env refs.
  const clean = {};
  for (const [k, v] of Object.entries(def)) {
    if (k.startsWith('x-agentbox-')) continue;
    clean[k] = expandDeep(v);
  }
  const before = target.mcpServers[name] === undefined ? undefined : JSON.stringify(target.mcpServers[name]);
  const after = JSON.stringify(clean);

  if (!DRY) {
    target.mcpServers[name] = JSON.parse(after);
    // Claim ownership even when the entry is already current, so a name written
    // by a pre-ledger revision is adopted and becomes deletable (D1).
    ledger.owned[name] = {
      firstProjected: (ledger.owned[name] && ledger.owned[name].firstProjected) || now,
      lastProjected: now,
    };
  }
  if (before === after) { ok++; continue; }
  if (before === undefined) { added++; addedNames.push(name); }
  else { updated++; addedNames.push(`${name} (updated)`); }
}

// D1 — definitions that VANISHED from the registry (deleted or renamed). Only
// names this projector owns per the ledger are eligible; a bespoke entry has no
// ledger record and is never considered.
for (const name of Object.keys(ledger.owned)) {
  if (managedNames.has(name)) continue;
  const reason = srcServers[name]
    ? `definition is no longer x-agentbox-managed-by=projector (now ${JSON.stringify(srcServers[name]['x-agentbox-managed-by'] ?? null)})`
    : 'definition deleted from the registry';
  orphanNotes.push(`${name} (${reason})`);
  orphaned++;
  if (!DRY) {
    if (target.mcpServers[name] !== undefined) { delete target.mcpServers[name]; removed++; }
    delete ledger.owned[name];
    ledger.history.push({ name, event: 'definition-removed', reason, at: now });
  }
}

// ---------------------------------------------------------------------------
// Persist. Any write failure is exit 3 with the previous target intact.
// ---------------------------------------------------------------------------
if (!DRY && (added || updated || removed || orphaned || Object.keys(ledger.owned).length)) {
  try { atomicWriteJson(TARGET, target, 0o600); }
  catch (e) { fail(3, `atomic write of ${TARGET} failed: ${e && e.message} — previous file retained`); }
  try { fs.chownSync(TARGET, 1000, 1000); } catch { /* not privileged / already owned */ }
  try { writeLedger(ledger); }
  catch (e) { log(`WARN ownership ledger ${STATE} not written: ${e && e.message}`); }
}

log(`registry ${REGISTRY} -> ${TARGET}: added=${added} updated=${updated} removed=${removed} orphaned=${orphaned} already-current=${ok} skipped=${skipped}`);
if (addedNames.length) log(`  registered: ${addedNames.join(', ')}`);
if (removedNames.length) log(`  reconciled-out (gate/requires): ${removedNames.join(', ')}`);
if (orphanNotes.length) log(`  reconciled-out (definition gone): ${orphanNotes.join(', ')}`);
if (skippedNotes.length) log(`  skipped (gate/requires): ${skippedNotes.join('; ')}`);
if (implicitRequires.length) log(`  no x-agentbox-requires declared (empty requirement set): ${implicitRequires.join(', ')}`);
process.exit(0);
