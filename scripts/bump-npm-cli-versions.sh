#!/usr/bin/env bash
# scripts/bump-npm-cli-versions.sh
#
# Bumps every `mkNpmCli { … }` call site in flake.nix to the newest npm
# release that has cleared the freshness cool-off (default 72 h, matching
# renovate.json minimumReleaseAge "3 days").
#
# The package set is read from flake.nix itself — there is no hand-kept list
# to drift. Prereleases are never candidates. Packages in HOLDS below are
# capped below a version with a recorded reason (supply-chain or CLI break).
#
# Patch mode, per bumped package:
#   1. version = "<new>"
#   2. sha256  = SRI sha256 of the registry .tgz (verified against the
#      registry's dist.integrity sha512)
#   3. packageLock = ./config/npm-locks/<slug>-<new>.package-lock.json,
#      regenerated the way config/npm-locks/README.md describes: the FOD's
#      manifest edits (stripDevDeps, runtimeDependencies.*), then
#      `npm install --package-lock-only --ignore-scripts --before=<cut-off>`
#      (+ --legacy-peer-deps unless legacyPeerDeps = false)
#   4. nodeModulesHash = lib.fakeHash — needs a Nix build; resolved by
#      `agentbox.sh` Phase 4 / scripts/prefetch-hashes.sh --cli.
# Supply-chain review of the new version and its lock is still the operator's
# job (publisher, install scripts, provenance, `npm audit`) before landing.
#
# Usage:
#   ./scripts/bump-npm-cli-versions.sh             # patch flake.nix in place
#   ./scripts/bump-npm-cli-versions.sh --dry-run   # report only
# Env:
#   NPM_CLI_MIN_AGE_HOURS   cool-off in hours (default 72)
#
# Exit status: 0 on success, "nothing to do", or a package skipped because the
# registry was unreachable (reported as SKIP; agentbox.sh's update flow keeps
# going); 1 only if a patch step failed (tarball, integrity or lock).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
FLAKE="${REPO_ROOT}/flake.nix"
LOCK_DIR="${REPO_ROOT}/config/npm-locks"

dry_run=0
case "${1:-}" in
  --dry-run) dry_run=1 ;;
  "") ;;
  -h|--help) sed -n '2,35p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "unknown argument: $1 (use --dry-run)" >&2; exit 1 ;;
esac

for tool in node npm curl tar; do
  command -v "$tool" >/dev/null || { echo "missing dependency: $tool" >&2; exit 1; }
done

export FLAKE LOCK_DIR DRY_RUN="$dry_run" MIN_AGE_HOURS="${NPM_CLI_MIN_AGE_HOURS:-72}"
[ -t 1 ] && export COLOUR=1 || export COLOUR=0

exec node - <<'NODE'
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const FLAKE = process.env.FLAKE;
const LOCK_DIR = process.env.LOCK_DIR;
const DRY = process.env.DRY_RUN === '1';
const MIN_AGE_MS = Number(process.env.MIN_AGE_HOURS) * 3600e3;
const NOW = Date.now();
const CUTOFF = new Date(NOW - MIN_AGE_MS);
const c = (code, s) => (process.env.COLOUR === '1' ? `\x1b[${code}m${s}\x1b[0m` : s);
const [RED, GREEN, YELLOW] = [31, 32, 33];

// Versions at or above `below` are never proposed. Record why.
const HOLDS = {
  '@mermaid-js/mermaid-cli': {
    below: '12.0.0',
    reason: 'mermaid 12 pins chevrotain ~11.1.2 -> lodash-es 4.17.23 (GHSA-r5fr-rjxr-66jc, high); ' +
            'v12 drops -w/-H/--pdfFit used by skills/mermaid-diagrams/scripts/render.sh',
  },
};

// ---- semver (release versions only) --------------------------------------
const parse = (v) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);
const cmp = (a, b) => {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

// ---- flake.nix: locate mkNpmCli blocks ------------------------------------
function blocks(src) {
  const out = [];
  const re = /mkNpmCli\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 0, i = m.index + m[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) break;
    }
    const body = src.slice(m.index, i + 1);
    const field = (k) => (body.match(new RegExp(`\\b${k}\\s*=\\s*"([^"]*)"`)) || [])[1];
    const pkgName = field('pkgName');
    if (!pkgName) continue; // the `mkNpmCli = npmCliLib.makeNpmCli;` alias has no body
    const runtimeDeps = {};
    for (const r of body.matchAll(/runtimeDependencies\.("?)([@\w./-]+)\1\s*=\s*"([^"]+)"/g)) runtimeDeps[r[2]] = r[3];
    if (/runtimeDependencies\s*=\s*\{/.test(body)) {
      throw new Error(`${pkgName}: attrset-form runtimeDependencies is not parsed; use runtimeDependencies.<name> = "<ver>";`);
    }
    out.push({
      start: m.index, end: i + 1, body, pkgName,
      version: field('version'),
      line: src.slice(0, m.index).split('\n').length,
      legacyPeerDeps: !/legacyPeerDeps\s*=\s*false/.test(body),
      stripDevDeps: /stripDevDeps\s*=\s*true/.test(body),
      runtimeDeps,
    });
  }
  return out;
}

// ---- registry ---------------------------------------------------------------
const npmEnv = () => {
  // npm needs a writable HOME/cache; fall back to a temp dir when HOME is read-only.
  const env = { ...process.env };
  try { fs.accessSync(env.HOME || '/nonexistent', fs.constants.W_OK); }
  catch { env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-home-')); }
  return env;
};
const ENV = npmEnv();
const npm = (args, opts = {}) => execFileSync('npm', args, { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

function candidate(pkg, pinned) {
  const meta = JSON.parse(npm(['view', pkg, 'time', 'versions', '--json']));
  const time = meta.time || {};
  const published = new Set(meta.versions || []);
  const hold = HOLDS[pkg];
  let best = null, newestAny = null, held = null;
  const cooling = [];
  for (const v of published) {
    if (!parse(v) || !time[v] || cmp(v, pinned) <= 0) continue;
    if (!newestAny || cmp(v, newestAny) > 0) newestAny = v;
    if (hold && cmp(v, hold.below) >= 0) { if (!held || cmp(v, held) > 0) held = v; continue; }
    if (NOW - Date.parse(time[v]) < MIN_AGE_MS) { cooling.push(v); continue; }
    if (!best || cmp(v, best) > 0) best = v;
  }
  cooling.sort(cmp);
  return { best, newestAny, held, cooling, time };
}

// ---- patch helpers ----------------------------------------------------------
const slugOf = (pkg) => pkg.replace(/^@/, '').replace(/\//g, '-');
const tarUrl = (pkg, v) => `https://registry.npmjs.org/${pkg.replace(/^@/, '%40')}/-/${pkg.split('/').pop()}-${v}.tgz`;

function prepare(b, v) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `bump-${slugOf(b.pkgName)}-`));
  const tgz = path.join(work, 'pkg.tgz');
  execFileSync('curl', ['-fsSL', tarUrl(b.pkgName, v), '-o', tgz]);
  const bytes = fs.readFileSync(tgz);
  const integrity = JSON.parse(npm(['view', `${b.pkgName}@${v}`, 'dist.integrity', '--json']));
  const sha512 = 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64');
  if (sha512 !== integrity) throw new Error(`${b.pkgName}@${v}: tarball sha512 ${sha512} != registry ${integrity}`);
  const sha256 = 'sha256-' + crypto.createHash('sha256').update(bytes).digest('base64');

  execFileSync('tar', ['-xzf', tgz, '-C', work]);
  const dir = path.join(work, 'package');
  const pj = path.join(dir, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(pj, 'utf8'));
  // Mirror lib/npm-cli.nix stage 2 exactly, or `npm ci` rejects the lock.
  if (b.stripDevDeps) delete manifest.devDependencies;
  if (Object.keys(b.runtimeDeps).length) {
    manifest.dependencies = Object.assign(manifest.dependencies || {}, b.runtimeDeps);
    for (const n of Object.keys(b.runtimeDeps)) if (manifest.devDependencies) delete manifest.devDependencies[n];
  }
  fs.writeFileSync(pj, JSON.stringify(manifest, null, 2));
  for (const f of ['package-lock.json', 'npm-shrinkwrap.json']) fs.rmSync(path.join(dir, f), { force: true });
  const flags = ['install', '--package-lock-only', '--ignore-scripts', '--no-fund', '--no-audit',
                 `--before=${CUTOFF.toISOString()}`];
  if (b.legacyPeerDeps) flags.push('--legacy-peer-deps');
  npm(flags, { cwd: dir });
  const lockName = `${slugOf(b.pkgName)}-${v}.package-lock.json`;
  fs.copyFileSync(path.join(dir, 'package-lock.json'), path.join(LOCK_DIR, lockName));
  fs.rmSync(work, { recursive: true, force: true });
  return { sha256, lockName };
}

function patchBody(body, b, v, sha256, lockName) {
  const sub = (re, rep, what) => {
    if (!re.test(body)) throw new Error(`${b.pkgName}: no ${what} field to patch`);
    body = body.replace(re, rep);
  };
  sub(/(\bversion\s*=\s*)"[^"]*"/, `$1"${v}"`, 'version');
  sub(/(\bsha256\s*=\s*)(?:"[^"]*"|lib\.fakeHash)/, `$1"${sha256}"`, 'sha256');
  sub(/(\bnodeModulesHash\s*=\s*)(?:"[^"]*"|lib\.fakeHash)/, '$1lib.fakeHash', 'nodeModulesHash');
  sub(/(\bpackageLock\s*=\s*)\.\/config\/npm-locks\/[^;\s]+/, `$1./config/npm-locks/${lockName}`, 'packageLock');
  return body;
}

// ---- main ---------------------------------------------------------------------
let src = fs.readFileSync(FLAKE, 'utf8');
const found = blocks(src);
console.log(`\nChecking ${found.length} mkNpmCli packages (cool-off ${process.env.MIN_AGE_HOURS} h, cut-off ${CUTOFF.toISOString()})...\n`);

let failed = 0;
const bumps = [];
for (const b of found) {
  const label = b.pkgName.padEnd(28);
  let r;
  try { r = candidate(b.pkgName, b.version); }
  catch (e) { console.log(`  ${c(YELLOW, label)} SKIP (registry read failed: ${String(e.message).split('\n')[0]})`); continue; }
  const notes = [];
  if (r.cooling.length) notes.push(`cooling off: ${r.cooling.join(', ')}`);
  if (r.held) notes.push(`held ${r.held} (${HOLDS[b.pkgName].reason})`);
  const tail = notes.length ? `  [${notes.join('; ')}]` : '';
  if (!r.best) {
    console.log(`  ${c(r.newestAny ? YELLOW : GREEN, label)} ${b.version} = newest eligible${tail}`);
    continue;
  }
  const age = ((NOW - Date.parse(r.time[r.best])) / 86400e3).toFixed(1);
  console.log(`  ${c(RED, label)} ${b.version} -> ${r.best} (${age} d old)${tail}`);
  bumps.push({ b, v: r.best });
}

if (DRY) {
  console.log(`\n${c(YELLOW, `[--dry-run] ${bumps.length} bump(s) available; no changes written.`)}\n`);
  process.exit(0);
}

// Patch from the end of the file backwards so earlier offsets stay valid.
let done = 0;
for (const { b, v } of bumps.sort((x, y) => y.b.start - x.b.start)) {
  try {
    const { sha256, lockName } = prepare(b, v);
    src = src.slice(0, b.start) + patchBody(b.body, b, v, sha256, lockName) + src.slice(b.end);
    done++;
    console.log(`  patched ${b.pkgName} -> ${v} (lock ${lockName})`);
  } catch (e) {
    failed++;
    console.log(`  ${c(YELLOW, 'FAILED')} ${b.pkgName} -> ${v}: ${String(e.message).split('\n')[0]}`);
  }
}
fs.writeFileSync(FLAKE, src);

console.log('');
if (done) {
  console.log(c(GREEN, `Bumped ${done} package(s). nodeModulesHash is lib.fakeHash for each — resolve with scripts/prefetch-hashes.sh --cli.`));
  console.log('Review each new lock (npm audit --package-lock-only) and the release\'s publisher/install scripts before landing.');
} else if (!failed && !bumps.length) {
  console.log(c(GREEN, 'All npm CLI packages are at the newest eligible version.'));
}
console.log('');
process.exit(failed ? 1 : 0);
NODE
