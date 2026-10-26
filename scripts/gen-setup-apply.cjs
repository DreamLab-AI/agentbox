#!/usr/bin/env node
'use strict';
/**
 * Generate schema/agentbox.toml.apply.json — the per-key "when does this take
 * effect" table the setup wizard shows — from the system-manifest CATALOGUE
 * (management-api/lib/system-manifest.js), which stays the single source.
 *
 *   node scripts/gen-setup-apply.cjs           write the file
 *   node scripts/gen-setup-apply.cjs --check   exit 1 if the file is stale
 */
const fs = require('fs');
const path = require('path');
const { APPLY_CLASSES, CATALOGUE } = require('../management-api/lib/system-manifest.js');

function build() {
  const gates = {};
  for (const e of CATALOGUE) {
    const paths = [e.gate, ...(e.gates || [])].filter(Boolean);
    for (const p of paths) {
      if (gates[p]) continue; // first entry wins
      gates[p] = { class: e.apply_class, name: e.name, summary: e.summary };
    }
  }
  const sorted = Object.fromEntries(Object.keys(gates).sort().map(k => [k, gates[k]]));
  return JSON.stringify({
    _generated: 'by scripts/gen-setup-apply.cjs from management-api/lib/system-manifest.js — do not edit',
    classes: APPLY_CLASSES,
    gates: sorted,
  }, null, 2) + '\n';
}

if (require.main === module) {
  const out = path.join(__dirname, '..', 'schema', 'agentbox.toml.apply.json');
  const next = build();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (cur !== next) { console.error('agentbox.toml.apply.json is stale: run node scripts/gen-setup-apply.cjs'); process.exit(1); }
  } else {
    fs.writeFileSync(out, next);
    console.log(`wrote ${out}`);
  }
}
module.exports = { build };
