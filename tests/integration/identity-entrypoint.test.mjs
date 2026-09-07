import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const source = readFileSync(new URL('../../config/entrypoint-unified.sh', import.meta.url), 'utf8');
const start = source.indexOf('if [ -z "${AGENTBOX_AGENT_DID:-}" ]');
const block = source.slice(start, source.indexOf('\n# ---------------------------------------------------------------------------', start));
const pk = 'a'.repeat(64);
const valid = `export AGENTBOX_AGENT_DID=did:nostr:${pk}\nexport AGENTBOX_AGENT_PUBKEY=${pk}\nexport AGENTBOX_AGENT_DID_MULTIKEY=fe70102${pk}\n`;
function run(output, exit = 0, did = '') {
  const dir = mkdtempSync(join(tmpdir(), 'identity-entrypoint-'));
  try {
    const script = join(dir, 'mint.cjs');
    writeFileSync(script, `process.stdout.write(${JSON.stringify(output)});process.exit(${exit});`);
    return spawnSync('bash', ['-c', block.replace('/opt/agentbox/management-api/lib/agent-identity.js', script) + '\nprintf "READY:%s" "$AGENTBOX_AGENT_DID"'], { encoding: 'utf8', env: { PATH: process.env.PATH, AGENTBOX_AGENT_DID: did } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('valid persisted mint proceeds', () => { const r=run(valid); assert.equal(r.status,0); assert.match(r.stdout,/READY:did:nostr:/); });
test('failed mint aborts even with valid-looking output', () => { assert.equal(run(valid,1).status,1); });
test('extra executable output is refused, not evaluated', () => { const r=run(valid+'echo INJECTED\n'); assert.equal(r.status,1); assert.doesNotMatch(r.stdout,/INJECTED/); });
test('mismatched public components abort', () => { assert.equal(run(valid.replace(`PUBKEY=${pk}`,`PUBKEY=${'b'.repeat(64)}`)).status,1); });
test('empty mint and configured malformed identity abort', () => { assert.equal(run('').status,1); assert.equal(run('',0,'did:nostr:bad').status,1); });
test('canonical operator identity remains usable without mint', () => { assert.equal(run('',1,`did:nostr:${pk}`).status,0); });
