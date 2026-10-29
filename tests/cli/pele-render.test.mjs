// ADR-2154: pele-render and the mmdc compatibility shim. Pele is the only
// Mermaid renderer in the image; these tests pin the behaviour the skills and
// validators depend on: static SVG, file:line errors, --check, the shim's
// accepted and refused flags, and the sha256 pin on the vendored build.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PELE = path.join(ROOT, 'scripts', 'pele-render.cjs');
const MMDC = path.join(ROOT, 'scripts', 'mmdc-pele.cjs');
const GEN_DIR = path.join(ROOT, 'skills', 'diagrams-as-code', 'scripts');

const FLOWCHART = 'flowchart LR\n  A[Start] --> B{Choice}\n  B -->|yes| C[Done]\n  B -->|no| A\n';
const SEQUENCE = 'sequenceDiagram\n  participant U as User\n  participant S as Server\n  U->>S: request\n  S-->>U: response\n';
const BAD = 'sequenceDiagram\n  A->>B: hello; world\n';

const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pele-render-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const run = (script, args, opts = {}) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', ...opts });

test('renders a flowchart and a sequence diagram to static SVG with no CSS variables', (t) => {
  const dir = tmp(t);
  for (const [name, src, klass] of [['flow', FLOWCHART, 'pele-flowchart'], ['seq', SEQUENCE, 'pele-sequence']]) {
    fs.writeFileSync(path.join(dir, `${name}.mmd`), src);
    const r = run(PELE, ['-q', path.join(dir, `${name}.mmd`), '-o', path.join(dir, `${name}.svg`)]);
    assert.equal(r.status, 0, r.stderr);
    const svg = fs.readFileSync(path.join(dir, `${name}.svg`), 'utf8');
    assert.match(svg, /^<svg\b/);
    assert.ok(svg.includes(klass), `${name}: ${klass}`);
    assert.ok(!svg.includes('var(--'), `${name}: CSS variable left in output`);
  }
});

test('dark theme bakes the dark palette and a background; -w scales', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'd.mmd'), FLOWCHART);
  const r = run(PELE, ['-q', '-t', 'dark', '-w', '640', path.join(dir, 'd.mmd'), '-o', path.join(dir, 'd.svg')]);
  assert.equal(r.status, 0, r.stderr);
  const svg = fs.readFileSync(path.join(dir, 'd.svg'), 'utf8');
  assert.ok(!svg.includes('var(--'));
  assert.ok(svg.includes('#100f0f'), 'dark background');
  assert.match(svg, /<svg\b[^>]*\swidth="640"/);
});

test('a bad diagram exits 4 with file:line and the Mermaid line', (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'bad.mmd');
  fs.writeFileSync(file, BAD);
  const r = run(PELE, [file]);
  assert.equal(r.status, 4);
  assert.match(r.stderr, new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:2:`));
  assert.match(r.stderr, /mermaid line 2/);
  assert.ok(!fs.existsSync(path.join(dir, 'bad.svg')), 'no output for a rejected diagram');
});

test('--check parses without writing; a .md input reports the file line of the bad block', (t) => {
  const dir = tmp(t);
  const ok = path.join(dir, 'ok.mmd');
  fs.writeFileSync(ok, FLOWCHART);
  const good = run(PELE, ['--check', ok]);
  assert.equal(good.status, 0, good.stderr);
  assert.deepEqual(fs.readdirSync(dir), ['ok.mmd']);

  const md = path.join(dir, 'notes.md');
  fs.writeFileSync(md, `# Notes\n\n\`\`\`mermaid\n${FLOWCHART}\`\`\`\n\ntext\n\n\`\`\`mermaid\n${BAD}\`\`\`\n`);
  const r = run(PELE, ['--check', md]);
  assert.equal(r.status, 4);
  // second fence is on line 12; the bad statement is line 2 of the block.
  assert.match(r.stderr, /notes\.md:14:/);
  assert.equal(fs.readdirSync(dir).length, 2);

  const stdin = run(PELE, ['--check', '-q', '-'], { input: FLOWCHART });
  assert.equal(stdin.status, 0, stdin.stderr);
});

test('a .md input renders every block into the output directory', (t) => {
  const dir = tmp(t);
  const md = path.join(dir, 'two.md');
  fs.writeFileSync(md, `\`\`\`mermaid\n${FLOWCHART}\`\`\`\n\n~~~mermaid\n${SEQUENCE}~~~\n`);
  const r = run(PELE, ['-q', md, '-o', path.join(dir, 'out')]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'out')).sort(), ['two-1.svg', 'two-2.svg']);
});

test('the mmdc shim honours -i/-o and -q, and renders the same SVG as pele-render', (t) => {
  const dir = tmp(t);
  const input = path.join(dir, 'in.mmd');
  fs.writeFileSync(input, FLOWCHART);
  const r = run(MMDC, ['-i', input, '-o', path.join(dir, 'shim.svg'), '-q']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  const direct = run(PELE, ['-q', '-b', 'white', input, '-o', path.join(dir, 'direct.svg')]);
  assert.equal(direct.status, 0, direct.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'shim.svg'), 'utf8'), fs.readFileSync(path.join(dir, 'direct.svg'), 'utf8'));
});

test('the mmdc shim fails explicitly on options Pele cannot honour, and on a bad diagram', (t) => {
  const dir = tmp(t);
  const input = path.join(dir, 'in.mmd');
  fs.writeFileSync(input, FLOWCHART);
  const out = path.join(dir, 'x.svg');
  for (const extra of [['-H', '600'], ['-s', '2'], ['-c', 'cfg.json'], ['-t', 'forest'], ['-t', 'neutral'], ['-p', 'pp.json']]) {
    const r = run(MMDC, ['-i', input, '-o', out, ...extra]);
    assert.equal(r.status, 1, `${extra.join(' ')} should be refused`);
    assert.match(r.stderr, /Pele|no Pele equivalent/);
  }
  const pdf = run(MMDC, ['-i', input, '-o', path.join(dir, 'x.pdf'), '-e', 'pdf', '-q']);
  assert.equal(pdf.status, 5);
  assert.ok(!fs.existsSync(path.join(dir, 'x.pdf')));
  fs.writeFileSync(input, BAD);
  assert.equal(run(MMDC, ['-i', input, '-o', out]).status, 4);
  assert.equal(run(MMDC, ['-o', out]).status, 1);
  assert.equal(run(MMDC, ['-i', path.join(dir, 'missing.mmd'), '-o', out]).status, 3);
});

test('--version and --help succeed', () => {
  assert.match(run(PELE, ['--version']).stdout, /pele-render .*pele 1\.12\.0/);
  assert.match(run(PELE, ['--help']).stdout, /--check/);
  assert.match(run(MMDC, ['--help']).stdout, /[Cc]ompatibility shim/);
});

test('the sha256 pin is enforced: a tampered vendored build fails, a PELE_VENDOR_DIR copy of the original passes', (t) => {
  const dir = tmp(t);
  const vendor = path.join(GEN_DIR, 'vendor', 'pele');
  const copy = path.join(dir, 'vendor');
  fs.cpSync(vendor, copy, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.mmd'), FLOWCHART);

  const ok = run(PELE, ['--check', '-q', path.join(dir, 'a.mmd')], { env: { ...process.env, PELE_VENDOR_DIR: copy } });
  assert.equal(ok.status, 0, ok.stderr);

  fs.appendFileSync(path.join(copy, 'pele.js'), '\n// tampered\n');
  const bad = run(PELE, ['--check', '-q', path.join(dir, 'a.mmd')], { env: { ...process.env, PELE_VENDOR_DIR: copy } });
  assert.equal(bad.status, 5);
  assert.match(bad.stderr, /does not match VERSION/);

  // the pinned hash in VERSION is also the one the Nix derivation pins
  const nix = fs.readFileSync(path.join(ROOT, 'lib', 'pele.nix'), 'utf8');
  const version = fs.readFileSync(path.join(vendor, 'VERSION'), 'utf8');
  const sha = /^sha256\s+([0-9a-f]{64})$/m.exec(version)[1];
  const integrity = /^integrity\s+(\S+)$/m.exec(version)[1];
  assert.ok(nix.includes(`fileSha256 = "${sha}"`), 'lib/pele.nix fileSha256 matches the vendored VERSION');
  assert.ok(nix.includes(`hash = "${integrity}"`), 'lib/pele.nix integrity matches the vendored VERSION');
});
