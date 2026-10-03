#!/usr/bin/env node
'use strict';

/**
 * env-secret-inventory — every environment variable NAME the boot path and the
 * role-secret consumers read, classified against config/custody/env-classes.json
 * (custody X-1 step 1, W2, bypass 3).
 *
 * Three classes:
 *   ROLE           must leave PID 1's environment under [security].role_isolation
 *                  and reach its role by file (`<NAME>_FILE`).
 *   DEVUSER_CLASS  stays in the ambient environment this step; each one is an
 *                  accepted exception with a reason (queen's disposition Q8).
 *   NON_SECRET     paths, ports, switches, public keys.
 *
 * It reads CODE, never an env file and never a value: the scan sources are named
 * in the table, `.env*` paths are refused outright, and the only thing extracted
 * from a source is the identifier after `$`, `process.env.`, `%(ENV_…)s` or a
 * quoted literal handed to an env reader.
 *
 * Usage:
 *   node scripts/ci/env-secret-inventory.js            # table of names, by class
 *   node scripts/ci/env-secret-inventory.js --check    # exit 1 on any violation
 *   node scripts/ci/env-secret-inventory.js --json     # machine-readable report
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const TABLE = path.join(ROOT, 'config', 'custody', 'env-classes.json');
const ENTRYPOINT = path.join(ROOT, 'config', 'entrypoint-unified.sh');

const NAME = '[A-Z_][A-Z0-9_]*';
const CLASSES = ['ROLE', 'DEVUSER_CLASS', 'NON_SECRET'];

/**
 * A name shaped like a credential. Such a name may never be classified by a
 * NON_SECRET pattern: it needs an exact entry, so a new secret cannot slip in
 * under a prefix rule written for config switches.
 */
const SECRET_SHAPED = /(?:^|_)(?:KEY|KEYS|TOKEN|SECRET|NSEC|PRIVKEY|SK|PASSWORD|PASSWD|PASS|PWD|PW|CREDENTIALS?|COOKIE|AUTHKEY|BEARER|SEED|MNEMONIC|CONNINFO|DSN)(?:_|$)|PRIVKEY|AUTHKEY|APIKEY|SECRET|PASSWORD/;

/** Path / pointer suffixes: a `…_KEY_FILE` names a file, not a secret. */
const POINTER = /_(?:FILE|PATH|DIR|URL|PORT|HOST|ID|NAME|TAG|PUBKEY|PUBKEYS|PUBKEY_HEX)$/;

function isSecretShaped(name) {
  if (POINTER.test(name)) return false;
  return SECRET_SHAPED.test(name);
}

function loadTable(file = TABLE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function refuseEnvFile(rel) {
  const base = path.basename(rel);
  if (base === '.env' || base.startsWith('.env.') || base.startsWith('.env')) {
    throw new Error(`env-secret-inventory: refusing to read env file ${rel} (names come from code only)`);
  }
}

/** Expand the table's `sources` (exact files and simple `dir/**\/*.ext` globs). */
function resolveSources(table, root = ROOT) {
  const out = [];
  const exclude = (table.sources_exclude || []).map((e) => new RegExp(e));
  const walk = (dir, exts) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'target' || e.name === '.git') continue;
        walk(p, exts);
      } else if (exts.some((x) => e.name.endsWith(x))) {
        out.push(p);
      }
    }
  };
  for (const s of table.sources) {
    const m = /^(.*)\/\*\*\/\*(\.[a-z]+(?:\|\.[a-z]+)*)$/.exec(s);
    if (m) {
      walk(path.join(root, m[1]), m[2].split('|'));
    } else if (s.includes('*')) {
      const dir = path.join(root, path.dirname(s));
      const re = new RegExp(`^${path.basename(s).replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
      for (const f of fs.readdirSync(dir)) if (re.test(f)) out.push(path.join(dir, f));
    } else {
      out.push(path.join(root, s));
    }
  }
  return [...new Set(out)]
    .filter((p) => !exclude.some((re) => re.test(path.relative(root, p))))
    .sort();
}

/** Names read in one source text. `kind` picks the extraction rules. */
function extractNames(text, kind) {
  const names = new Set();
  const add = (n) => { if (n && /^[A-Z_][A-Z0-9_]*$/.test(n) && n.length > 1) names.add(n); };
  const each = (re, group = 1) => { for (const m of text.matchAll(re)) add(m[group]); };
  const literalsIn = (re) => {
    for (const m of text.matchAll(re)) {
      for (const lit of m[1].matchAll(new RegExp(`['"](${NAME})['"]`, 'g'))) add(lit[1]);
    }
  };
  switch (kind) {
    case 'shell':
      each(new RegExp(`\\$\\{?(${NAME})`, 'g'));
      break;
    case 'nix':
      each(new RegExp(`\\$\\{?(${NAME})`, 'g'));
      each(new RegExp(`%\\(ENV_(${NAME})\\)s`, 'g'));
      break;
    case 'compose':
      each(new RegExp(`\\$\\{(${NAME})`, 'g'));
      each(new RegExp(`^\\s*-\\s*(${NAME})=`, 'gm'));
      each(new RegExp(`^\\s*-\\s*(${NAME})\\s*$`, 'gm'));
      break;
    case 'js':
      each(new RegExp(`process\\.env\\.(${NAME})`, 'g'));
      each(new RegExp(`process\\.env\\[\\s*['"\`](${NAME})['"\`]`, 'g'));
      each(new RegExp(`\\benv\\.(${NAME})\\b`, 'g'));
      each(new RegExp(`\\benv\\[\\s*['"\`](${NAME})['"\`]`, 'g'));
      literalsIn(/\b(?:envFirst|readSetting|readRoleSecret|readRoleSecretFirst|roleSecret|envBool|envInt|envStr)\s*\(([^)]*)\)/g);
      // Name lists handed to a reader: `const OPERATOR_KEY_VARS = Object.freeze([...])`.
      literalsIn(/\bconst\s+[A-Z_]*VARS\s*=\s*(?:Object\.freeze\()?\[([^\]]*)\]/g);
      break;
    case 'rust':
      each(new RegExp(`\\b(?:var|var_os|get|non_empty|or|remove_var|set_var)\\(\\s*"(${NAME})"`, 'g'));
      literalsIn(/\bfirst\(\s*&\[([^\]]*)\]/g);
      literalsIn(/\brole_secret::(?:read|resolve|read_first)\s*\(([^)]*)\)/g);
      each(new RegExp(`const\\s+[A-Z_]*(?:VAR|ENV)[A-Z_]*\\s*:\\s*&str\\s*=\\s*"(${NAME})"`, 'g'));
      break;
    default:
      throw new Error(`unknown source kind ${kind}`);
  }
  return names;
}

function kindOf(file) {
  if (/\.nix$/.test(file)) return 'nix';
  if (/docker-compose[^/]*\.ya?ml$/.test(file)) return 'compose';
  if (/\.(c|m)?js$/.test(file)) return 'js';
  if (/\.rs$/.test(file)) return 'rust';
  return 'shell';
}

/** name → [relative files that read it] */
function scan(table, root = ROOT) {
  const found = new Map();
  for (const file of resolveSources(table, root)) {
    const rel = path.relative(root, file);
    refuseEnvFile(rel);
    const text = fs.readFileSync(file, 'utf8');
    for (const n of extractNames(text, kindOf(file))) {
      if (!found.has(n)) found.set(n, []);
      found.get(n).push(rel);
    }
  }
  return found;
}

/** Which class claims `name`: exact entries first, then NON_SECRET patterns. */
function classify(table, name) {
  const hits = [];
  if (table.classes.ROLE[name]) hits.push('ROLE');
  if (table.classes.DEVUSER_CLASS[name]) hits.push('DEVUSER_CLASS');
  if ((table.classes.NON_SECRET.names || []).includes(name)) hits.push('NON_SECRET');
  if (hits.length) return { classes: hits, via: 'exact' };
  for (const p of table.classes.NON_SECRET.patterns || []) {
    if (new RegExp(p.re).test(name)) {
      return { classes: ['NON_SECRET'], via: `pattern ${p.re}`, secretShaped: isSecretShaped(name) };
    }
  }
  return { classes: [], via: null };
}

/** The `_AB_ROLE_ENV_VARS` list the entrypoint scrubs, as NAME → role. */
function entrypointRoleList(file = ENTRYPOINT) {
  const text = fs.readFileSync(file, 'utf8');
  const m = /^_AB_ROLE_ENV_VARS="([^"]*)"/m.exec(text);
  if (!m) return null;
  const map = {};
  for (const tok of m[1].split(/\s+/).filter(Boolean)) {
    const [n, role] = tok.split(':');
    map[n] = role;
  }
  return map;
}

/** W1's delivery table (config/role-accounts.json): from_env VAR → role. */
function w1PlanEnv(table, root = ROOT) {
  if (!table.w1_plan || !table.w1_plan.file) return null;
  const file = path.join(root, table.w1_plan.file);
  if (!fs.existsSync(file)) return null;
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const map = {};
  for (const r of doc.roles || []) {
    for (const sec of r.secrets || []) if (sec.from_env) map[sec.from_env] = r.name;
  }
  return map;
}

/** Parity between the ROLE set and W1's plan. Returns violation strings. */
function checkW1Parity(table, plan) {
  const v = [];
  if (!table.w1_plan) return v;
  if (plan === null) return [`w1_plan file ${table.w1_plan.file} is missing`];
  const role = table.classes.ROLE;
  const only = table.w1_plan.w2_only || {};
  for (const [name, r] of Object.entries(plan)) {
    if (!role[name]) v.push(`W1-PARITY ${name} is delivered from the env by W1 (${r}) but is not ROLE here`);
    else if (role[name].role !== r) v.push(`W1-PARITY ${name}: role ${role[name].role} here, ${r} in W1's plan`);
    if (only[name]) v.push(`W1-PARITY ${name} is listed w2_only but W1's plan carries it`);
  }
  for (const name of Object.keys(role)) {
    if (!plan[name] && !only[name]) v.push(`W1-PARITY ROLE ${name} is in neither W1's plan nor w1_plan.w2_only`);
  }
  for (const name of Object.keys(only)) {
    if (name !== '$comment' && !role[name]) v.push(`W1-PARITY w2_only ${name} is not ROLE`);
  }
  return v;
}

/** Every rule the table and the code must satisfy. Returns violation strings. */
function check(table, found, epList, plan) {
  const v = [];
  for (const c of CLASSES) {
    if (!table.classes[c]) v.push(`table has no ${c} class`);
  }
  if (v.length) return v;
  for (const [name, files] of [...found.entries()].sort()) {
    const r = classify(table, name);
    if (r.classes.length === 0) v.push(`UNCLASSIFIED ${name} (read in ${files.join(', ')})`);
    else if (r.classes.length > 1) v.push(`AMBIGUOUS ${name} is in ${r.classes.join(' and ')}`);
    else if (r.secretShaped) v.push(`SECRET-SHAPED ${name} is NON_SECRET only by ${r.via}; give it an exact entry`);
  }
  const role = table.classes.ROLE;
  for (const [name, e] of Object.entries(role)) {
    if (!e.role) v.push(`ROLE ${name} names no role`);
    if (!e.file_var) v.push(`ROLE ${name} names no file_var`);
    else if (e.file_var !== `${name}_FILE`) v.push(`ROLE ${name}: file_var must be ${name}_FILE`);
    else {
      const fc = classify(table, e.file_var);
      if (fc.classes.join() !== 'NON_SECRET') v.push(`ROLE ${name}: its file var ${e.file_var} must be NON_SECRET`);
    }
    if (!e.reason) v.push(`ROLE ${name} has no reason`);
    if (!found.has(name)) v.push(`ROLE ${name} is not read by any scanned source (stale entry or missing source)`);
  }
  for (const [name, e] of Object.entries(table.classes.DEVUSER_CLASS)) {
    if (!e.reason) v.push(`DEVUSER_CLASS ${name} has no reason`);
    if (!e.exception) v.push(`DEVUSER_CLASS ${name} names no exception (Q8, ADR, …)`);
  }
  if (plan !== undefined) v.push(...checkW1Parity(table, plan));
  if (epList === null) {
    v.push('entrypoint defines no _AB_ROLE_ENV_VARS list');
  } else {
    const want = Object.entries(role).map(([n, e]) => `${n}:${e.role}`).sort();
    const have = Object.entries(epList).map(([n, r]) => `${n}:${r}`).sort();
    for (const w of want) if (!have.includes(w)) v.push(`entrypoint _AB_ROLE_ENV_VARS lacks ${w}`);
    for (const h of have) if (!want.includes(h)) v.push(`entrypoint _AB_ROLE_ENV_VARS has ${h}, which the table does not`);
  }
  return v;
}

function report(table, found) {
  const by = { ROLE: [], DEVUSER_CLASS: [], NON_SECRET: [], UNCLASSIFIED: [] };
  for (const name of [...found.keys()].sort()) {
    const r = classify(table, name);
    by[r.classes.length === 1 ? r.classes[0] : 'UNCLASSIFIED'].push(name);
  }
  return by;
}

function main(argv) {
  const table = loadTable();
  const found = scan(table);
  const ep = entrypointRoleList();
  const by = report(table, found);
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ counts: Object.fromEntries(Object.entries(by).map(([k, a]) => [k, a.length])), names: by }, null, 2)}\n`);
  } else if (!argv.includes('--check')) {
    for (const c of ['ROLE', 'DEVUSER_CLASS']) {
      process.stdout.write(`\n## ${c} (${by[c].length})\n`);
      for (const n of by[c]) {
        const e = table.classes[c][n];
        const extra = c === 'ROLE' ? `role=${e.role} file=${e.file_var}` : `exception=${e.exception}`;
        process.stdout.write(`  ${n.padEnd(34)} ${extra}\n`);
      }
    }
    process.stdout.write(`\n## NON_SECRET (${by.NON_SECRET.length} names read; listed with --json)\n`);
    if (by.UNCLASSIFIED.length) process.stdout.write(`\n## UNCLASSIFIED (${by.UNCLASSIFIED.length})\n  ${by.UNCLASSIFIED.join('\n  ')}\n`);
  }
  const v = check(table, found, ep, w1PlanEnv(table));
  if (argv.includes('--check')) {
    if (v.length) {
      process.stderr.write(`FAIL (env-secret-inventory): ${v.length} violation(s)\n  ${v.join('\n  ')}\n`);
      return 1;
    }
    process.stdout.write(`PASS (env-secret-inventory): ${found.size} names read; ROLE ${by.ROLE.length}, DEVUSER_CLASS ${by.DEVUSER_CLASS.length}, NON_SECRET ${by.NON_SECRET.length}\n`);
  }
  return 0;
}

module.exports = {
  extractNames, classify, check, scan, report, loadTable, resolveSources,
  entrypointRoleList, isSecretShaped, refuseEnvFile, w1PlanEnv, checkW1Parity, TABLE, ENTRYPOINT,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
