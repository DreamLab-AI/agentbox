#!/usr/bin/env node
// cad-wheels-lock.js - writes config/cad/wheels.lock.json, the hash lock of every wheel the CAD
// feature installs (ADR-2195). Run it to move to a new text-to-cad release:
//
//   node scripts/cad-wheels-lock.js 0.11.8            # resolve with uv, write the lock
//   node scripts/cad-wheels-lock.js --check           # the committed lock is well formed
//
// It asks uv for a universal resolution of the pinned requirements for CPython 3.13 on
// x86_64 Linux (pylock.toml: every file's URL and sha256, from the index), then keeps exactly one
// wheel per package: the best match for that interpreter and platform. A package with no usable
// wheel is an error, never an sdist: nothing is compiled in the image or at first use.
// lib/cad.nix turns each entry into a fetchurl, so the image build verifies every hash.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LOCK = path.resolve(__dirname, '..', 'config', 'cad', 'wheels.lock.json');
const PYTHON = '3.13';
const TAG = 'cp313';
const GLIBC = [2, 39];                       // the image's glibc; kicode needs manylinux_2_36
const EXTRAS = ['build123d', 'netgen', 'calculix', 'trimesh', 'mujoco', 'coacd', 'kicad', 'blender'];

/** Score a wheel file name for cp313 on x86_64 manylinux; null when it cannot be installed. */
function score(file) {
  const m = /^.+?-((?:cp|py)[^-]+)-([^-]+)-([^-]+)\.whl$/.exec(file);
  if (!m) return null;
  const [, pys, abi, plats] = m;
  const exact = pys.split('.').includes(TAG) && abi === TAG;      // not cp313t (free-threaded) or cp313d
  // abi3 is forward compatible only: cp39-abi3 installs on 3.13, cp314-abi3 does not.
  const generic = pys.split('.').some((p) => {
    const cp = /^cp3(\d+)$/.exec(p);
    if (cp) return +cp[1] <= 13 && (abi === 'abi3' || abi === 'none');
    return /^(py3|py2|py313)$/.test(p) && abi === 'none';
  });
  if (!exact && !generic) return null;
  let best = null;
  for (const p of plats.split('.')) {
    let s = null;
    const many = /^manylinux_(\d+)_(\d+)_x86_64$/.exec(p);
    if (p === 'any') s = 0;
    else if (p === 'linux_x86_64') s = 1;
    else if (/^manylinux(1|2010|2014)_x86_64$/.test(p)) s = 50;
    else if (many && (+many[1] < GLIBC[0] || (+many[1] === GLIBC[0] && +many[2] <= GLIBC[1]))) s = 100 + +many[2];
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best === null ? null : best + (exact ? 1000 : 0);
}

function wellFormed(lock) {
  const errors = [];
  const seen = new Set();
  for (const w of lock.wheels || []) {
    if (!/^[0-9a-f]{64}$/.test(w.sha256 || '')) errors.push(`${w.file}: sha256 is not 64 hex characters`);
    if (!/^https:\/\/files\.pythonhosted\.org\/packages\//.test(w.url || '')) errors.push(`${w.file}: url is not on files.pythonhosted.org`);
    if (!w.url.endsWith(`/${w.file}`)) errors.push(`${w.file}: url does not end with the file name`);
    if (score(w.file) === null) errors.push(`${w.file}: not installable on ${TAG} x86_64 manylinux`);
    if (seen.has(w.name)) errors.push(`${w.name}: listed twice`);
    seen.add(w.name);
  }
  for (const need of ['cad', 'cad-server', 'cad-mcp', 'build123d', 'cadquery-ocp-novtk']) {
    if (!seen.has(need)) errors.push(`${need}: missing from the lock`);
  }
  const versions = ['cad', 'cad-server', 'cad-mcp'].map((n) => (lock.wheels.find((w) => w.name === n) || {}).version);
  if (new Set(versions).size !== 1 || versions[0] !== lock.release) errors.push(`cad, cad-server and cad-mcp must all be release ${lock.release} (got ${versions.join(', ')})`);
  return errors;
}

function main() {
  const arg = process.argv[2];
  if (arg === '--check') {
    const errors = wellFormed(JSON.parse(fs.readFileSync(LOCK, 'utf8')));
    if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
    console.log('cad wheels lock: well formed');
    return;
  }
  if (!/^\d+\.\d+\.\d+$/.test(arg || '')) { console.error('usage: cad-wheels-lock.js <release, e.g. 0.11.8> | --check'); process.exit(2); }
  const toml = require('@iarna/toml');
  const requirements = [`cad-server==${arg}`, `cad[${EXTRAS.join(',')}]==${arg}`, `cad-mcp==${arg}`];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-lock-'));
  try {
    fs.writeFileSync(path.join(dir, 'in.txt'), requirements.join('\n') + '\n');
    execFileSync('uv', ['pip', 'compile', '--no-config', '--python-version', PYTHON,
      '--python-platform', `x86_64-manylinux_${GLIBC[0]}_${GLIBC[1]}`, '--prerelease=if-necessary-or-explicit',
      '--format', 'pylock.toml', '-o', 'pylock.toml', 'in.txt'], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
    const resolved = toml.parse(fs.readFileSync(path.join(dir, 'pylock.toml'), 'utf8'));
    const wheels = [];
    for (const p of resolved.packages) {
      const usable = (p.wheels || [])
        .map((w) => ({ w, file: w.name || w.url.split('/').pop() }))
        .map((x) => ({ ...x, s: score(x.file) }))
        .filter((x) => x.s !== null)
        .sort((a, b) => b.s - a.s || a.file.localeCompare(b.file));
      if (!usable.length) throw new Error(`${p.name} ${p.version}: no wheel for ${TAG} x86_64 manylinux (an sdist is never built)`);
      const { w, file } = usable[0];
      wheels.push({ name: p.name, version: String(p.version), file, url: w.url, sha256: w.hashes.sha256, size: w.size });
    }
    wheels.sort((a, b) => a.name.localeCompare(b.name));
    const lock = { release: arg, python: PYTHON, platform: `x86_64-manylinux_${GLIBC[0]}_${GLIBC[1]}`, requirements, wheels };
    const errors = wellFormed(lock);
    if (errors.length) throw new Error(errors.join('\n'));
    fs.writeFileSync(LOCK, JSON.stringify(lock, null, 1) + '\n');
    console.log(`wrote ${path.relative(process.cwd(), LOCK)}: ${wheels.length} wheels, ${Math.round(wheels.reduce((a, w) => a + (w.size || 0), 0) / 1e6)} MB`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
