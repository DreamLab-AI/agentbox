// ADR-2135 — [features.jev_checkpoints] wiring: manifest ↔ schema ↔ catalogue ↔
// marketplace ↔ flake gate ↔ entrypoint projection stay one consistent surface.
//
//   node --test tests/config/jev-checkpoints.test.mjs
//
// The plugin source (config/claude-plugins/jev-checkpoints) is authored apart
// from this wiring; the checks that need it run only once it is present.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const require = createRequire(import.meta.url)

/** Contract table: manifest key → userConfig key (ADR-2135). `enabled` is the gate, not a userConfig. */
const KEYS = {
  api: 'api', model: 'model', timeout_ms: 'timeoutMs', done_check: 'doneCheck',
  done_threshold: 'doneThreshold', claim_check: 'claimCheck', claim_threshold: 'claimThreshold', repeat_check: 'repeatCheck', repeat_count: 'repeatCount',
  plan_check: 'planCheck', plan_threshold: 'planThreshold', min_chars: 'minChars',
  spawn_mode: 'spawnMode', spawn_min_confidence: 'spawnMinConfidence', shadow_log: 'shadowLog',
  usd_per_mtok_in: 'usdPerMTokIn',
}
/** Projected from elsewhere: the fence from [features.jev_compaction], backendLocal from the resolved façade. */
const EXTRA = ['backendLocal', 'taintTools', 'taintSkills']
const DEFAULTS = {
  enabled: true, api: '', model: 'jev-latest', timeout_ms: 4000, done_check: true, done_threshold: 0.9,
  claim_check: true, claim_threshold: 0.9, repeat_check: true, repeat_count: 2, plan_check: true, plan_threshold: 0.8, min_chars: 24,
  spawn_mode: 'shadow', spawn_min_confidence: 0.8,
  shadow_log: '/home/devuser/.claude/jev-checkpoints/shadow.jsonl', usd_per_mtok_in: 0.042,
}

/** Parse the one TOML section by hand (key = value # comment): no parser dependency. */
function section(name) {
  const out = {}
  let on = false
  for (const line of read('agentbox.toml').split('\n')) {
    if (/^\[/.test(line)) { on = line.trim() === `[${name}]`; continue }
    const m = on && line.match(/^([a-z_]+)\s*=\s*(.*?)\s*(#.*)?$/)
    if (m) out[m[1]] = JSON.parse(m[2].replace(/\s+#.*$/, ''))
  }
  return out
}

test('manifest section is enabled and carries every contract key at its default', () => {
  assert.deepEqual(section('features.jev_checkpoints'), DEFAULTS)
})

test('schema declares exactly the manifest keys, closed, with ranges and the spawn enum', () => {
  const s = JSON.parse(read('schema/agentbox.toml.schema.json')).properties.features.properties.jev_checkpoints
  assert.equal(s.additionalProperties, false)
  assert.deepEqual(Object.keys(s.properties).sort(), Object.keys(DEFAULTS).sort())
  for (const k of ['done_threshold', 'plan_threshold', 'spawn_min_confidence']) {
    assert.equal(s.properties[k].minimum, 0); assert.equal(s.properties[k].maximum, 1)
  }
  assert.equal(s.properties.repeat_count.minimum, 2)
  assert.equal(s.properties.timeout_ms.maximum, 8000, 'hook budget is 10 s')
  assert.deepEqual(s.properties.spawn_mode.enum, ['off', 'shadow', 'enforce'])
})

test('the validator accepts the manifest and rejects out-of-range values', (t) => {
  try { require.resolve('@iarna/toml') } catch { return t.skip('node_modules not installed in this checkout') }
  const run = (file) => spawnSync('node', ['scripts/agentbox-config-validate.js', file], { cwd: root, encoding: 'utf8' })
  assert.equal(run('agentbox.toml').status, 0)
  const tmp = fs.mkdtempSync(path.join(root, '.jevck-'))
  try {
    for (const [from, to] of [['spawn_mode = "shadow"', 'spawn_mode = "bogus"'], ['done_threshold = 0.9', 'done_threshold = 1.5'], ['repeat_count = 2 ', 'repeat_count = 1 ']]) {
      const bad = path.join(tmp, 'bad.toml')
      const src = read('agentbox.toml')
      assert.ok(src.includes(from), `fixture anchor ${from}`)
      fs.writeFileSync(bad, src.replace(from, to))
      const r = run(bad)
      assert.notEqual(r.status, 0, `${to} must be rejected`)
      assert.match(r.stdout + r.stderr, /jev_checkpoints/)
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
})

test('catalogue entry is rebuild-class and gated on the section', () => {
  const { CATALOGUE } = require(path.join(root, 'management-api/lib/system-manifest.js'))
  const e = CATALOGUE.find((x) => x.id === 'jev-checkpoints')
  assert.ok(e, 'catalogue entry present')
  assert.equal(e.gate, 'features.jev_checkpoints')
  assert.equal(e.apply_class, 'rebuild')
  assert.match(e.summary, /ADR-2135/)
  assert.match(e.summary, /email/i)
})

test('marketplace lists the plugin at 0.1.0 under MIT OR Apache-2.0, beside factrail', () => {
  const byName = Object.fromEntries(JSON.parse(read('config/claude-plugins/.claude-plugin/marketplace.json')).plugins.map((p) => [p.name, p]))
  assert.ok(byName.factrail)
  assert.deepEqual([byName['jev-checkpoints'].source, byName['jev-checkpoints'].version, byName['jev-checkpoints'].license],
    ['./jev-checkpoints', '0.1.0', 'MIT OR Apache-2.0'])
})

test('flake gates the plugin tree on the manifest flag and strips its tests', () => {
  const flake = read('flake.nix')
  assert.match(flake, /jevCheckpointsOn = \(\(agentboxConfig\.features or \{\}\)\.jev_checkpoints or \{\}\)\.enabled or false;/)
  assert.match(flake, /jevCheckpointsOn \|\| !\(lib\.hasSuffix "\/config\/claude-plugins\/jev-checkpoints"/)
  assert.match(flake, /claude-plugins\/jev-checkpoints\/tests"/)
  assert.match(flake, /lib\.hasSuffix "\/tests"/)
  assert.ok(!/\.test\.ts"/.test(flake), 'the whole tests/ directory is stripped, not just *.test.ts')
})

const entry = read('config/entrypoint-unified.sh')
const jkBlock = entry.slice(entry.indexOf('# ── ADR-2135: Jev checkpoints'), entry.indexOf('# ── [toolchains].ruflo_console: ruflo-console'))

test('entrypoint projects exactly the contract userConfig keys', () => {
  const projected = [...jkBlock.matchAll(/"([a-zA-Z]+)=\$(?:\(|_JK_)/g)].map((m) => m[1]).sort()
  assert.deepEqual(projected, [...Object.values(KEYS), ...EXTRA].sort())
  assert.match(jkBlock, /"taintTools=\$\(_ab_toml_val features\.jev_compaction taint_tools\)"/)
  assert.match(jkBlock, /"taintSkills=\$\(_ab_toml_val features\.jev_compaction taint_skills\)"/)
  assert.ok(!jkBlock.includes('/nix/store'), 'no store path in the block')
  assert.ok(!/--config apiKey|TYPESAFE_API_KEY=/.test(jkBlock), 'the key is never projected')
})

test('entrypoint keeps the shared switch and marketplace while any sharing gate is on', () => {
  assert.match(entry, /_JK_ON="\$\(_ab_toml_bool features\.jev_checkpoints enabled\)"/)
  assert.match(entry, /process\.env\.JC_ON === '1' \|\| process\.env\.RC_ON === '1' \|\| process\.env\.JK_ON === '1'/)
  assert.match(entry, /\[ "\$_RC_ON" != "1" \] && \[ "\$_JK_ON" != "1" \]/)
  assert.match(jkBlock, /\[ "\$_JC_ON" != "1" \] && \[ "\$_RC_ON" != "1" \] && \[ "\$_JK_ON" != "1" \]/)
  assert.match(jkBlock, /claude plugin uninstall jev-checkpoints@agentbox/)
  assert.match(jkBlock, /claude plugin install jev-checkpoints@agentbox \$_JK_ARGS/)
})

test('_jk_project skips empty and undeclared keys, passes declared pairs whole', () => {
  const fn = entry.match(/^ {2}_jk_project\(\) \{[\s\S]*?^ {2}\}$/m)
  assert.ok(fn, '_jk_project found')
  const script = `${fn[0]}
_JK_DECLARED="api model doneThreshold"
_JK_ARGS=""; _jk_project "doneThreshold=0.9"; _jk_project "api="; _jk_project "bogus=1" >/dev/null; _jk_project "doneThresholdX=1" >/dev/null; _jk_project "api=http://systemone:8097/v1/systemone"
printf '%s' "$_JK_ARGS"`
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' })
  assert.equal(r.stdout, ' --config doneThreshold=0.9 --config api=http://systemone:8097/v1/systemone')
})

test('backendLocal is explicit: true only for the façade with no manifest api, never from a URL', () => {
  const m = jkBlock.match(/^ {2}_JK_API="[\s\S]*?^ {2}fi$/m)
  assert.ok(m, 'resolution snippet found')
  const run = (api, sso) => spawnSync('bash', ['-c', `_ab_toml_val() { case "$2" in api) printf '%s' "\$JK_T_API";; model) printf jev-latest;; esac; }
_SSO_PLUGIN_CONFIG="\$JK_T_SSO"
${m[0]}
printf '%s|%s|%s' "$_JK_API" "$_JK_MODEL" "$_JK_LOCAL"`], { encoding: 'utf8', env: { ...process.env, JK_T_API: api, JK_T_SSO: sso } }).stdout
  const sso = 'baseUrl=http://systemone:8097/v1/systemone\nmodel=laya\nbackendLocal=true'
  assert.equal(run('', sso), 'http://systemone:8097/v1/systemone|laya|true')
  assert.equal(run('http://10.0.0.5:8097/v1', sso), 'http://10.0.0.5:8097/v1|jev-latest|false', 'explicit api beside the façade stays non-local')
  assert.equal(run('http://127.0.0.1:8097/v1', ''), 'http://127.0.0.1:8097/v1|jev-latest|false', 'a loopback URL alone never makes it local')
  assert.equal(run('', ''), '|jev-latest|false')
})

test('the bash syntax of the entrypoint holds', () => {
  assert.equal(spawnSync('bash', ['-n', path.join(root, 'config/entrypoint-unified.sh')]).status, 0)
})

test('once the plugin source lands, it declares every projected userConfig key and the pinned identity', (t) => {
  const pj = path.join(root, 'config/claude-plugins/jev-checkpoints/.claude-plugin/plugin.json')
  if (!fs.existsSync(pj)) return t.skip('plugin source not merged into this tree yet')
  const m = JSON.parse(fs.readFileSync(pj, 'utf8'))
  assert.equal(m.name, 'jev-checkpoints'); assert.equal(m.version, '0.1.0')
  for (const k of [...Object.values(KEYS), ...EXTRA]) assert.ok(k in (m.userConfig || {}), `userConfig.${k}`)
  assert.ok(!('apiKey' in (m.userConfig || {})), 'the key is environment-only')
})
