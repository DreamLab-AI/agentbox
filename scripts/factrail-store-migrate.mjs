#!/usr/bin/env node
// ============================================================================
// factrail-store-migrate.mjs — carry the jev-compaction plugin's sticky state
// into factrail's plugin store (ADR-2121)
// ----------------------------------------------------------------------------
// The email taint fence is sticky per session: once a session has touched
// email, a later built-in summary may hold email content with no email tool
// call left in it, so "tainted" must outlive the transcript evidence
// (ADR-2093, amendment 2026-09-25 a). That record lives in the plugin's own
// store, and replacing the plugin replaces the store. Without this step a
// resumed email session would look clean to factrail and its summary could
// reach the cloud judge.
//
// Claude Code keeps one flat JSON object per plugin at
// ~/.claude/plugins/store/<name>_<marketplace>-<sha256("<name>@<marketplace>")[0:12]>.json.
// Both plugins use the same keys and record shape (`taint:<session id>` →
// {tainted, count, sample, at}; `enabled` → boolean), so the migration is a
// merge:
//   • every `taint:*` record with tainted === true is copied unless factrail
//     already holds a tainted record for that session (taint only ever widens);
//   • `enabled` (the operator's switch position) is copied only when factrail
//     has none, so a choice made in factrail is never overwritten;
//   • `baseline:*` and `last` are not copied: they are per-plugin bookkeeping
//     that the next turn re-establishes.
// The old file is then renamed `<file>.migrated`, making the step one-shot.
//
// Fails closed on the data: an unreadable or non-object store on either side
// is left untouched and reported, never overwritten. Boot itself is never
// blocked (the entrypoint ignores the exit status after logging).
//
// Usage: factrail-store-migrate.mjs [store dir]   (default ~/.claude/plugins/store)
// ============================================================================

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Claude Code's store file name for a plugin installed from a marketplace. */
export function storeFile(name, marketplace) {
  const digest = createHash('sha256').update(`${name}@${marketplace}`).digest('hex').slice(0, 12);
  return `${name}_${marketplace}-${digest}.json`;
}

export const LEGACY = storeFile('jev-compaction', 'agentbox');
export const FACTRAIL = storeFile('factrail', 'agentbox');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTainted = (v) => isObject(v) && v.tainted === true;

/** Reads a store: {} when absent, the object when valid, or an error string. */
function readStore(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { store: {}, existed: false };
    return { error: `${path.basename(file)}: ${e.message}` };
  }
  try {
    const store = JSON.parse(text);
    if (!isObject(store)) return { error: `${path.basename(file)}: not a JSON object` };
    return { store, existed: true };
  } catch (e) {
    return { error: `${path.basename(file)}: ${e.message}` };
  }
}

/**
 * Merges the legacy store into factrail's within `dir`.
 * @returns {{ status: 'none'|'migrated'|'error', taints?: number, enabled?: boolean, error?: string }}
 */
export function migrate(dir) {
  const legacyPath = path.join(dir, LEGACY);
  const factrailPath = path.join(dir, FACTRAIL);
  const legacy = readStore(legacyPath);
  if (legacy.error) return { status: 'error', error: legacy.error };
  if (!legacy.existed) return { status: 'none' };
  const target = readStore(factrailPath);
  if (target.error) return { status: 'error', error: target.error };

  const next = { ...target.store };
  let taints = 0;
  for (const [key, value] of Object.entries(legacy.store)) {
    if (!key.startsWith('taint:') || !isTainted(value)) continue;
    if (isTainted(next[key])) continue;
    next[key] = value;
    taints++;
  }
  let enabled = false;
  if (typeof legacy.store.enabled === 'boolean' && !('enabled' in next)) {
    next.enabled = legacy.store.enabled;
    enabled = true;
  }

  if (taints > 0 || enabled) {
    const mode = fs.statSync(legacyPath).mode & 0o777;
    const tmp = `${factrailPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(next), { mode });
    fs.renameSync(tmp, factrailPath);
  }
  fs.renameSync(legacyPath, `${legacyPath}.migrated`);
  return { status: 'migrated', taints, enabled };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = process.argv[2] || path.join(os.homedir(), '.claude', 'plugins', 'store');
  const r = migrate(dir);
  if (r.status === 'migrated') {
    console.log(`  [factrail] carried ${r.taints} sticky email taint(s)${r.enabled ? ' and the switch position' : ''} over from jev-compaction's store`);
  } else if (r.status === 'error') {
    console.log(`  [factrail] store migration REFUSED (${r.error}); jev-compaction's taints were NOT carried over — do not resume email sessions until this is resolved`);
    process.exitCode = 1;
  }
}
