// Boot migration must remove the retired native name without losing local files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
test('both harness manifests name only VisionCraft and the old payload is absent', () => {
  for (const name of ['registered-skills.txt', 'codex-registered-skills.txt']) {
    const lines = readFileSync(join(root, 'skills', name), 'utf8').split('\n').map(line => line.replace(/#.*$/, '').trim());
    assert.ok(lines.includes('visioncraft'));
    assert.ok(!lines.includes('build-with-quality'));
  }
  assert.ok(!existsSync(join(root, 'skills/build-with-quality')));
});

for (const oldKind of ['managed-link', 'local-copy']) test(`boot retires ${oldKind}, preserving local additions`, () => {
  const scratch = mkdtempSync(join(tmpdir(), 'visioncraft-cutover-'));
  try {
    const tree = join(scratch, 'baked'); const native = join(scratch, 'native');
    mkdirSync(join(tree, 'visioncraft'), { recursive: true }); mkdirSync(native);
    writeFileSync(join(tree, 'visioncraft/SKILL.md'), '# canonical\n');
    writeFileSync(join(tree, 'registered-skills.txt'), 'visioncraft\n');
    const old = join(native, 'build-with-quality');
    if (oldKind === 'managed-link') symlinkSync(join(tree, 'build-with-quality'), old);
    else { mkdirSync(old); writeFileSync(join(old, 'local-note'), 'preserve me'); }
    const run = () => spawnSync('bash', [resolve(root, 'scripts/reconcile-skills.sh')], {
      env: { ...process.env, SKILLS_TREE: tree, CLAUDE_SKILLS_DIR: native, REGISTERED_SKILLS_MANIFEST: join(tree, 'registered-skills.txt') }, encoding: 'utf8',
    });
    const first = run(); assert.equal(first.status, 0, first.stderr);
    assert.ok(!readdirSync(native).includes('build-with-quality'));
    assert.equal(readFileSync(join(native, 'visioncraft/SKILL.md'), 'utf8'), '# canonical\n');
    if (oldKind === 'local-copy') {
      const archives = readdirSync(join(native, '.superseded'));
      assert.equal(archives.length, 1);
      assert.equal(readFileSync(join(native, '.superseded', archives[0], 'skill/local-note'), 'utf8'), 'preserve me');
      assert.equal(run().status, 0);
      assert.equal(readdirSync(join(native, '.superseded')).length, 1);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
