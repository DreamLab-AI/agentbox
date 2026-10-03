#!/usr/bin/env node
// ruflo-console-project.mjs — boot projection for [toolchains].ruflo_console.
//
//   node ruflo-console-project.mjs --on 1|0 --settings <settings.json>
//        --installed <installed_plugins.json> --market <marketplace dir>
//
// Gate on (and the three plugins baked under --market):
//   * installed_plugins.json holds ruflo-console@agentbox, ruflo-mods@agentbox
//     and ruflo-swarm@agentbox, each at its stable /opt/agentbox path (the
//     codex-plugin-cc pattern: no copy into ~/.claude/plugins/cache, so a
//     rebuilt image is never served a stale cached plugin). An entry whose
//     installPath or version differs from the baked one is rewritten, not
//     skipped.
//   * settings.json enabledPlugins has exactly those three set to true.
//   * pluginConfigs["<id>"].options.cli is "ruflo" for the console and the
//     swarm, the channel Claude Code hands to the plugin. Upstream's own default,
//     npx-offline, fails ENOTCACHED without a warm npm cache; an unset value
//     also falls back to it, so the baked manifest default alone is not enough.
//     An operator's other valid choice (npx, claude-flow) is kept.
//   * The same plugins installed from the network `ruflo` marketplace are
//     disabled (not uninstalled), or `/ruflo` would be hooked twice.
// Gate off: the three ids leave installed_plugins.json, enabledPlugins and
// pluginConfigs, and nothing else changes; a file with none of them is not
// rewritten (byte-identical when off, ADR-2020).
//
// Never writes a /nix/store path. Fail-open: an unreadable file is left alone,
// and the script always exits 0 unless called with bad arguments.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PLUGINS = ['ruflo-console', 'ruflo-mods', 'ruflo-swarm']
export const MARKETPLACE = 'agentbox'
export const CLI = 'ruflo'
const CLI_CHOICES = new Set(['npx-offline', 'npx', 'ruflo', 'claude-flow'])
const idOf = name => `${name}@${MARKETPLACE}`

function readJson(file, fallback) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return { value: fallback, text: null }
  }
  try {
    return { value: JSON.parse(text), text }
  } catch {
    return { value: null, text }
  }
}

/** The baked plugins: name → { installPath, version, declaresCli }. Missing ones are left out. */
export function bakedPlugins(market) {
  const out = {}
  for (const name of PLUGINS) {
    const dir = path.join(market, name)
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))
      out[name] = { installPath: dir, version: String(manifest.version ?? '0.0.0'), declaresCli: Boolean(manifest.userConfig?.cli) }
    } catch {
      // not baked
    }
  }
  return out
}

/** Pure: the installed_plugins.json document after projection. */
export function projectInstalled(doc, on, baked, now) {
  const next = structuredClone(doc ?? {})
  next.plugins = next.plugins && typeof next.plugins === 'object' ? next.plugins : {}
  const log = []
  for (const name of PLUGINS) {
    const id = idOf(name)
    const want = on ? baked[name] : undefined
    if (!want) {
      if (id in next.plugins) {
        delete next.plugins[id]
        log.push(`unregistered ${id}`)
      }
      continue
    }
    const held = Array.isArray(next.plugins[id]) ? next.plugins[id][0] : undefined
    if (held && held.installPath === want.installPath && held.version === want.version && held.scope === 'user') continue
    next.plugins[id] = [{
      scope: 'user',
      installPath: want.installPath,
      version: want.version,
      installedAt: held?.installedAt ?? now,
      lastUpdated: now,
    }]
    log.push(`${held ? 'corrected' : 'registered'} ${id} ${want.version} at ${want.installPath}`)
  }
  return { doc: next, log }
}

/** Pure: the settings.json document after projection. */
export function projectSettings(doc, on, baked) {
  const next = structuredClone(doc ?? {})
  const log = []
  const ids = PLUGINS.map(idOf)
  if (on) {
    next.enabledPlugins = next.enabledPlugins && typeof next.enabledPlugins === 'object' ? next.enabledPlugins : {}
    for (const name of PLUGINS) {
      if (!baked[name]) continue
      const id = idOf(name)
      if (next.enabledPlugins[id] !== true) {
        next.enabledPlugins[id] = true
        log.push(`enabled ${id}`)
      }
      // The network-marketplace copy of the same mod would hook /ruflo a second time.
      const shadow = `${name}@ruflo`
      if (next.enabledPlugins[shadow] === true) {
        next.enabledPlugins[shadow] = false
        log.push(`disabled ${shadow} (the baked ${id} replaces it)`)
      }
      if (!baked[name].declaresCli) continue
      next.pluginConfigs = next.pluginConfigs && typeof next.pluginConfigs === 'object' ? next.pluginConfigs : {}
      const entry = next.pluginConfigs[id] && typeof next.pluginConfigs[id] === 'object' ? next.pluginConfigs[id] : {}
      const options = entry.options && typeof entry.options === 'object' ? entry.options : {}
      const held = options.cli
      if (typeof held !== 'string' || !CLI_CHOICES.has(held) || held === 'npx-offline') {
        next.pluginConfigs[id] = { ...entry, options: { ...options, cli: CLI } }
        log.push(`set ${id} cli=${CLI}${held === undefined ? '' : ` (was ${JSON.stringify(held)})`}`)
      }
    }
  } else {
    // Only what this gate wrote is removed; a map it emptied goes with it.
    for (const key of ['enabledPlugins', 'pluginConfigs']) {
      const map = next[key]
      if (!map || typeof map !== 'object') continue
      const held = ids.filter(id => id in map)
      for (const id of held) {
        delete map[id]
        log.push(`removed ${id} from ${key}`)
      }
      if (held.length && Object.keys(map).length === 0) delete next[key]
    }
  }
  return { doc: next, log }
}

function arg(argv, name) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

function main(argv) {
  const on = arg(argv, 'on') === '1'
  const settingsFile = arg(argv, 'settings')
  const installedFile = arg(argv, 'installed')
  const market = arg(argv, 'market')
  if (!settingsFile || !installedFile || !market) {
    console.error('usage: ruflo-console-project.mjs --on 1|0 --settings F --installed F --market DIR')
    return 2
  }
  const baked = on ? bakedPlugins(market) : {}
  if (on && Object.keys(baked).length === 0) {
    console.log(`  [ruflo-console] enabled but not baked (${market}/ruflo-console missing) — rebuild the image`)
  }
  const now = arg(argv, 'now') ?? new Date().toISOString()

  const installed = readJson(installedFile, { version: 2, plugins: {} })
  if (installed.value !== null) {
    const { doc, log } = projectInstalled(installed.value, on, baked, now)
    if (log.length) {
      fs.mkdirSync(path.dirname(installedFile), { recursive: true })
      fs.writeFileSync(installedFile, JSON.stringify(doc, null, 2))
      for (const line of log) console.log(`  [ruflo-console] ${line}`)
    }
  } else {
    console.log(`  [ruflo-console] ${installedFile} is not JSON — left alone`)
  }

  const settings = readJson(settingsFile, {})
  if (settings.value !== null) {
    const { doc, log } = projectSettings(settings.value, on, baked)
    if (log.length) {
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
      fs.writeFileSync(settingsFile, JSON.stringify(doc, null, 2))
      for (const line of log) console.log(`  [ruflo-console] ${line}`)
    }
  } else {
    console.log(`  [ruflo-console] ${settingsFile} is not JSON — left alone`)
  }
  return 0
}

let invokedDirectly = false
try {
  invokedDirectly = Boolean(process.argv[1])
    && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1])
} catch {}
if (invokedDirectly) {
  let code = 0
  try {
    code = main(process.argv.slice(2))
  } catch (err) {
    console.log(`  [ruflo-console] projection failed (continuing): ${err?.message ?? err}`)
  }
  process.exit(code)
}
