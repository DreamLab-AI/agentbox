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
// NET EFFECT on next boot: the projector ADDS only gated-ON, present, currently-
// ORPHANED servers — no server appears whose gate is off. See the run summary and
// the audit-2026-07-15 MCP-1 register for the enumerated set.
//
// Idempotent and FAIL-OPEN: always exits 0; never blocks boot.
//
// Usage: project-mcp-servers.mjs [--dry-run]
//   env MCP_REGISTRY  source registry (default $SKILLS_TREE/mcp.json)
//   env MCP_JSON      target .mcp.json (default $WORKSPACE/.mcp.json)
//   env SKILLS_TREE   default /opt/agentbox/skills
//   env WORKSPACE     default /home/devuser/workspace

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const DRY = process.argv.includes('--dry-run');
const SKILLS_TREE = process.env.SKILLS_TREE || '/opt/agentbox/skills';
const WORKSPACE = process.env.WORKSPACE || '/home/devuser/workspace';
const REGISTRY = process.env.MCP_REGISTRY || path.join(SKILLS_TREE, 'mcp.json');
const TARGET = process.env.MCP_JSON || path.join(WORKSPACE, '.mcp.json');

const log = (m) => console.log(`[project-mcp]${DRY ? ' DRY' : ''} ${m}`);

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

let _pathBins = null;
function binOnPath(name) {
  if (_pathBins === null) _pathBins = new Set();
  try { execSync(`command -v ${JSON.stringify(name)}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// Gate grammar (x-agentbox-gate):
//   "env:VAR"     true when env VAR in (true,1,yes,on)
//   "envset:VAR"  true when env VAR is non-empty
//   "requires"    gate rests entirely on x-agentbox-requires (package-gated: the
//                 nix build only bakes the binary when its manifest gate is on)
//   "never"       never register (documentation-only entry)
// Requires grammar (x-agentbox-requires): array of
//   {bin:"x"} | {bin:["a","b"]} (any-of) | {file:"/abs"} | {envset:"VAR"}
function gateOpen(gate) {
  if (!gate || gate === 'never') return gate === 'requires';
  if (gate === 'requires') return true;
  const [kind, name] = String(gate).split(':');
  const v = process.env[name];
  if (kind === 'envset') return !!(v && v !== '');
  if (kind === 'env') return ['true', '1', 'yes', 'on'].includes(String(v || '').toLowerCase());
  return false;
}
function requiresMet(reqs) {
  if (!Array.isArray(reqs)) return true;
  for (const r of reqs) {
    if (r.bin) {
      const bins = Array.isArray(r.bin) ? r.bin : [r.bin];
      if (!bins.some(binOnPath)) return { ok: false, why: `missing bin ${bins.join('|')}` };
    }
    if (r.file && !fs.existsSync(expand(r.file))) return { ok: false, why: `missing file ${r.file}` };
    if (r.envset && !(process.env[r.envset] && process.env[r.envset] !== '')) return { ok: false, why: `unset ${r.envset}` };
  }
  return { ok: true };
}

let registry, target;
try { registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); }
catch (e) { log(`registry unreadable (${REGISTRY}): ${e && e.message} — no-op`); process.exit(0); }
try { target = JSON.parse(fs.readFileSync(TARGET, 'utf8')); }
catch { log(`target ${TARGET} absent/unparseable — no-op (ruvector-mcp block writes it first)`); process.exit(0); }

const srcServers = (registry && registry.mcpServers) || {};
target.mcpServers = target.mcpServers || {};

let added = 0, updated = 0, removed = 0, skipped = 0, ok = 0;
const addedNames = [], removedNames = [], skippedNotes = [];

for (const [name, def] of Object.entries(srcServers)) {
  const managed = def['x-agentbox-managed-by'];
  if (managed !== 'projector') continue;                 // bespoke/reference/absent → untouched
  const gate = def['x-agentbox-gate'];
  const reqs = def['x-agentbox-requires'];

  const open = gateOpen(gate);
  const req = open ? requiresMet(reqs) : { ok: false, why: `gate ${gate} closed` };

  if (!open || !req.ok) {
    // Reconcile: if this managed server is present in target, remove it (gate/requires now fail).
    if (target.mcpServers[name]) {
      removedNames.push(`${name} (${req.why || 'gate closed'})`);
      if (!DRY) delete target.mcpServers[name];
      removed++;
    } else {
      skipped++; skippedNotes.push(`${name}: ${req.why || 'gate closed'}`);
    }
    continue;
  }

  // Build the projected entry: strip x-agentbox-* annotations, expand env refs.
  const clean = {};
  for (const [k, v] of Object.entries(def)) {
    if (k.startsWith('x-agentbox-')) continue;
    clean[k] = expandDeep(v);
  }
  const before = JSON.stringify(target.mcpServers[name]);
  const after = JSON.stringify(clean);
  if (before === after) { ok++; continue; }
  if (!DRY) target.mcpServers[name] = clean;
  if (before === undefined) { added++; addedNames.push(name); }
  else { updated++; addedNames.push(`${name} (updated)`); }
}

if (!DRY && (added || updated || removed)) {
  try {
    fs.writeFileSync(TARGET, JSON.stringify(target, null, 2));
    try { fs.chownSync(TARGET, 1000, 1000); } catch { /* not privileged / already owned */ }
  } catch (e) { log(`WARN write failed: ${e && e.message}`); }
}

log(`registry ${REGISTRY} -> ${TARGET}: added=${added} updated=${updated} removed=${removed} already-current=${ok} skipped=${skipped}`);
if (addedNames.length) log(`  registered: ${addedNames.join(', ')}`);
if (removedNames.length) log(`  reconciled-out: ${removedNames.join(', ')}`);
if (skippedNotes.length) log(`  skipped (gate/requires): ${skippedNotes.join('; ')}`);
process.exit(0);
