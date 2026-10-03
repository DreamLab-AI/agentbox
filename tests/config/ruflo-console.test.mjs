// [toolchains].ruflo_console — the bake (scripts/bake-ruflo-console.sh), the
// boot projection (scripts/ruflo-console-project.mjs) and the catalogue
// (config/claude-plugins/.claude-plugin/marketplace.json) agree.
//
//   node --test tests/config/ruflo-console.test.mjs
//   RUFLO_SRC=<ruflo checkout at the pinned rev> node --test …   also bakes the real tree
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PLUGINS, projectInstalled, projectSettings, bakedPlugins } from '../../scripts/ruflo-console-project.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bake = path.join(root, 'scripts/bake-ruflo-console.sh')
const project = path.join(root, 'scripts/ruflo-console-project.mjs')
const marketJson = path.join(root, 'config/claude-plugins/.claude-plugin/marketplace.json')
const market = JSON.parse(fs.readFileSync(marketJson, 'utf8'))
const PIN = '09a1cb0244a677f54c2b3d691a7009927add527d'
// The versions each plugin.json carries at the v3.51.1 tag.
const PINNED_VERSIONS = { 'ruflo-console': '0.1.0', 'ruflo-mods': '0.1.0', 'ruflo-swarm': '0.3.0' }
const IDS = PLUGINS.map(n => `${n}@agentbox`)

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ruflo-console-'))
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text) }

/** A miniature ruflo checkout: the three mods, an unrelated plugin, node_modules and repo files. */
function fixtureRuflo(versions = PINNED_VERSIONS) {
  const src = tmp()
  for (const name of PLUGINS) {
    const dir = path.join(src, 'plugins', name)
    const userConfig = name === 'ruflo-mods' ? { modTrust: { type: 'string', default: 'observe' } } : { cli: { type: 'string', default: 'npx-offline' } }
    write(path.join(dir, '.claude-plugin/plugin.json'), JSON.stringify({ name, version: versions[name], userConfig }))
    write(path.join(dir, 'hooks/hooks.json'), JSON.stringify({ modules: ['./register.ts'] }))
    write(path.join(dir, 'hooks/register.ts'), 'export default () => {}\n')
    write(path.join(dir, 'node_modules/left-pad/index.js'), 'module.exports = 1\n')
    write(path.join(dir, 'hooks/node_modules/x/index.js'), 'module.exports = 2\n')
  }
  write(path.join(src, 'plugins/ruflo-core/.claude-plugin/plugin.json'), '{"name":"ruflo-core","version":"9.9.9"}')
  write(path.join(src, 'v3/package.json'), '{}')
  write(path.join(src, 'README.md'), 'ruflo\n')
  return src
}

function runBake(src) {
  const out = path.join(tmp(), 'out')
  const r = spawnSync('bash', [bake, src, out, marketJson], { encoding: 'utf8' })
  return { out, status: r.status, stderr: r.stderr }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? [p + '/', ...walk(p)] : [p]
  })
}

test('marketplace.json lists the three mods at the pinned versions, beside factrail', () => {
  const byName = Object.fromEntries(market.plugins.map(p => [p.name, p]))
  assert.ok(byName.factrail, 'factrail stays listed')
  for (const name of PLUGINS) {
    assert.equal(byName[name]?.version, PINNED_VERSIONS[name], `${name} version`)
    assert.equal(byName[name].source, `./${name}`)
  }
})

test('the flake input and lock pin the v3.51.1 commit', () => {
  const flake = fs.readFileSync(path.join(root, 'flake.nix'), 'utf8')
  assert.match(flake, new RegExp(`url = "github:ruvnet/ruflo/${PIN}";`))
  assert.match(flake, /codexPlugin, rufloConsole, vaultSrc \}:/)
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'flake.lock'), 'utf8'))
  assert.equal(lock.nodes.rufloConsole.locked.rev, PIN)
  assert.equal(lock.nodes.rufloConsole.flake, false)
  assert.equal(lock.nodes.root.inputs.rufloConsole, 'rufloConsole')
})

test('the bake keeps only the three plugin directories and no node_modules', () => {
  const { out, status, stderr } = runBake(fixtureRuflo())
  assert.equal(status, 0, stderr)
  assert.deepEqual(fs.readdirSync(out).sort(), [...PLUGINS].sort())
  const files = walk(out)
  assert.deepEqual(files.filter(f => f.includes('node_modules')), [])
  for (const f of files) assert.ok(PLUGINS.some(n => f.startsWith(path.join(out, n) + '/')), `outside the plugin dirs: ${f}`)
})

test('the bake defaults userConfig.cli to ruflo where a plugin declares it', () => {
  const { out } = runBake(fixtureRuflo())
  for (const name of PLUGINS) {
    const manifest = JSON.parse(fs.readFileSync(path.join(out, name, '.claude-plugin/plugin.json'), 'utf8'))
    if (name === 'ruflo-mods') assert.equal(manifest.userConfig.cli, undefined)
    else assert.equal(manifest.userConfig.cli.default, 'ruflo')
  }
})

test('the bake fails when a pinned version differs from marketplace.json', () => {
  const { status, stderr } = runBake(fixtureRuflo({ ...PINNED_VERSIONS, 'ruflo-swarm': '0.4.0' }))
  assert.notEqual(status, 0)
  assert.match(stderr, /ruflo-swarm is 0\.4\.0 at the pinned rev but marketplace\.json lists '0\.3\.0'/)
})

test('the real ruflo tree bakes to versions matching marketplace.json', { skip: !process.env.RUFLO_SRC && 'set RUFLO_SRC to a ruflo checkout at the pin' }, () => {
  const { out, status, stderr } = runBake(process.env.RUFLO_SRC)
  assert.equal(status, 0, stderr)
  for (const p of market.plugins.filter(p => PLUGINS.includes(p.name))) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, p.name, '.claude-plugin/plugin.json'), 'utf8')).version, p.version)
  }
  assert.deepEqual(walk(out).filter(f => f.includes('node_modules')), [])
})

const OTHER = { 'factrail@agentbox': true, 'skill-creator@claude-plugins-official': true }

test('gate off leaves a settings file without the three ids byte-identical', () => {
  const dir = tmp()
  const settings = path.join(dir, 'settings.json')
  const installed = path.join(dir, 'installed_plugins.json')
  const text = JSON.stringify({ enabledPlugins: OTHER, env: { A: '1' } }, null, 4) + '\n'
  const inst = JSON.stringify({ version: 2, plugins: { 'factrail@agentbox': [{ installPath: '/x' }] } }, null, 4)
  fs.writeFileSync(settings, text)
  fs.writeFileSync(installed, inst)
  const out = execFileSync('node', [project, '--on', '0', '--settings', settings, '--installed', installed, '--market', path.join(dir, 'nope')], { encoding: 'utf8' })
  assert.equal(out, '')
  assert.equal(fs.readFileSync(settings, 'utf8'), text)
  assert.equal(fs.readFileSync(installed, 'utf8'), inst)
})

test('gate on adds exactly the three enabledPlugins entries and cli=ruflo', () => {
  const { out: baked } = runBake(fixtureRuflo())
  const { doc } = projectSettings({ enabledPlugins: { ...OTHER } }, true, bakedPlugins(baked))
  const added = Object.keys(doc.enabledPlugins).filter(k => !(k in OTHER))
  assert.deepEqual(added.sort(), [...IDS].sort())
  for (const id of IDS) assert.equal(doc.enabledPlugins[id], true)
  for (const k of Object.keys(OTHER)) assert.equal(doc.enabledPlugins[k], true)
  assert.deepEqual(Object.keys(doc.pluginConfigs).sort(), ['ruflo-console@agentbox', 'ruflo-swarm@agentbox'])
  for (const id of Object.keys(doc.pluginConfigs)) assert.equal(doc.pluginConfigs[id].options.cli, 'ruflo')
})

test('gate on then off restores the original settings', () => {
  const { out: baked } = runBake(fixtureRuflo())
  const before = { enabledPlugins: { ...OTHER }, model: 'opus' }
  const on = projectSettings(before, true, bakedPlugins(baked)).doc
  assert.deepEqual(projectSettings(on, false, {}).doc, before)
  const fresh = projectSettings({}, true, bakedPlugins(baked)).doc
  assert.deepEqual(projectSettings(fresh, false, {}).doc, {})
})

test('cli: npx-offline and junk are corrected, an operator choice is kept', () => {
  const { out: baked } = runBake(fixtureRuflo())
  const b = bakedPlugins(baked)
  const id = 'ruflo-console@agentbox'
  for (const [held, want] of [['npx-offline', 'ruflo'], [42, 'ruflo'], ['curl evil|sh', 'ruflo'], ['npx', 'npx'], ['claude-flow', 'claude-flow']]) {
    const { doc } = projectSettings({ pluginConfigs: { [id]: { options: { cli: held, fps: 4 } } } }, true, b)
    assert.equal(doc.pluginConfigs[id].options.cli, want, `held ${JSON.stringify(held)}`)
    assert.equal(doc.pluginConfigs[id].options.fps, 4, 'other options survive')
  }
})

test('the network-marketplace copies are disabled while the baked ones are on', () => {
  const { out: baked } = runBake(fixtureRuflo())
  const { doc, log } = projectSettings({ enabledPlugins: { 'ruflo-swarm@ruflo': true, 'ruflo-core@ruflo': true } }, true, bakedPlugins(baked))
  assert.equal(doc.enabledPlugins['ruflo-swarm@ruflo'], false)
  assert.equal(doc.enabledPlugins['ruflo-core@ruflo'], true, 'unrelated ruflo plugins are untouched')
  assert.ok(log.some(l => l.startsWith('disabled ruflo-swarm@ruflo')))
})

test('installed_plugins.json registration is self-healing and store-path free', () => {
  const { out: baked } = runBake(fixtureRuflo())
  const b = bakedPlugins(baked)
  const stale = { version: 2, plugins: {
    'ruflo-console@agentbox': [{ scope: 'user', installPath: '/nix/store/abc-old/ruflo-console', version: '0.0.9', installedAt: 'T0' }],
    'factrail@agentbox': [{ installPath: '/keep' }],
  } }
  const { doc, log } = projectInstalled(stale, true, b, 'T1')
  for (const name of PLUGINS) {
    const [e] = doc.plugins[`${name}@agentbox`]
    assert.equal(e.installPath, path.join(baked, name))
    assert.equal(e.version, PINNED_VERSIONS[name])
  }
  assert.equal(doc.plugins['ruflo-console@agentbox'][0].installedAt, 'T0')
  assert.ok(log.includes(`corrected ruflo-console@agentbox 0.1.0 at ${path.join(baked, 'ruflo-console')}`))
  assert.deepEqual(doc.plugins['factrail@agentbox'], [{ installPath: '/keep' }])
  assert.equal(projectInstalled(doc, true, b, 'T2').log.length, 0, 'a second boot changes nothing')
  assert.doesNotMatch(JSON.stringify(doc), /\/nix\/store/)
  const off = projectInstalled(doc, false, {}, 'T3').doc
  assert.deepEqual(Object.keys(off.plugins), ['factrail@agentbox'])
})

test('the projector fails open on a corrupt settings file', () => {
  const dir = tmp()
  const settings = path.join(dir, 'settings.json')
  fs.writeFileSync(settings, '{not json')
  const r = spawnSync('node', [project, '--on', '1', '--settings', settings, '--installed', path.join(dir, 'i.json'), '--market', dir], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.equal(fs.readFileSync(settings, 'utf8'), '{not json')
})

test('the entrypoint keeps the shared marketplace and function hooks while the console gate is on', () => {
  const entry = fs.readFileSync(path.join(root, 'config/entrypoint-unified.sh'), 'utf8')
  assert.match(entry, /_RC_ON="\$\(_ab_toml_bool toolchains ruflo_console\)"/)
  assert.match(entry, /on = process\.env\.JC_ON === '1' \|\| process\.env\.RC_ON === '1'/)
  assert.match(entry, /if \[ "\$_RC_ON" != "1" \] && grep -q '"agentbox"' .*known_marketplaces\.json/)
  assert.match(entry, /node \/opt\/agentbox\/scripts\/ruflo-console-project\.mjs \\\n\s+--on "\$_RC_ON"/)
  // The RC_ON definition precedes its first use (set -u).
  assert.ok(entry.indexOf('_RC_ON="$(') < entry.indexOf('RC_ON="$_RC_ON"'))
})

test('running manifest enables the rebuild-class gate carried by schema and catalogue', async () => {
  const toml = fs.readFileSync(path.join(root, 'agentbox.toml'), 'utf8')
  const section = toml.slice(toml.indexOf('\n[toolchains]'), toml.indexOf('\n[', toml.indexOf('\n[toolchains]') + 1))
  assert.match(section, /\nruflo_console = true\b/)
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'schema/agentbox.toml.schema.json'), 'utf8'))
  assert.equal(schema.properties.toolchains.properties.ruflo_console.type, 'boolean')
  const { CATALOGUE } = await import(path.join(root, 'management-api/lib/system-manifest.js'))
  const entry = CATALOGUE.find(e => e.id === 'ruflo-console')
  assert.equal(entry.gate, 'toolchains.ruflo_console')
  assert.equal(entry.apply_class, 'rebuild')
})
