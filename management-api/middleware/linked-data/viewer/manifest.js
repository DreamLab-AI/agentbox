'use strict';

/**
 * Pane manifest builder — the public extension API for the viewer slot
 * (PRD-006 §15, ADR-012 §Viewer, DDD-004 §ViewerSurface).
 *
 * The browser fetches `/lo/manifest.json` at boot. This module produces
 * that JSON. Each pane maps a JSON-LD `@type` (or a predicate-based
 * matcher) to a pane URL plus a label and icon. The match-by-type
 * dispatch is exactly what LOSOS expects, so any pane that satisfies
 * the upstream contract — `default export { label, icon, canHandle,
 * render }` — is registerable.
 *
 * Three pane sources are merged, in this priority order (matches LOSOS
 * shell.js's resolve order):
 *
 *   1. Built-in panes shipped under viewer/panes/. These are the
 *      agentbox-specific viewers for surfaces S2/S3/S5/S6/S9/S11/S12
 *      that the upstream browser does not ship.
 *   2. Operator-supplied panes pointed to by the `[linked_data.viewer]
 *      .extra_panes` array. Each entry is a URL or a path under
 *      $WORKSPACE/profiles/<stack>/viewer/panes/ (the agent workspace,
 *      normally /home/devuser/workspace).
 *   3. Upstream linkedobjects/browser panes shipped at the bundle root
 *      (folder, profile, markdown, playlist, todo, sharing, source).
 *
 * Adding a pane:
 *
 *   echo "module.exports = require('./vc-pane.js')" > custom-pane.js
 *
 *   # in agentbox.toml:
 *   [linked_data.viewer]
 *   extra_panes = [
 *     "/home/devuser/workspace/profiles/default/viewer/panes/custom-pane.js",
 *     "https://my.example.com/panes/billing.js"
 *   ]
 *
 * No code changes; the manifest endpoint picks the new entries up on
 * the next request.
 *
 * Public schema of a pane manifest entry:
 *
 *   {
 *     "id":     "vc",                    // unique per-pane id
 *     "label":  "Credentials",
 *     "icon":   "🪪",                    // optional emoji or unicode
 *     "url":    "/lo/panes/vc-pane.js",  // ES module URL
 *     "matches": [                        // any-of; empty = pane decides
 *       { "@type": "VerifiableCredential" },
 *       { "@type": "https://www.w3.org/ns/credentials/v2#VerifiableCredential" }
 *     ],
 *     "agentbox-surface": "S3"            // optional cross-reference
 *   }
 *
 * Public schema of the manifest:
 *
 *   {
 *     "agentbox":    "<image-version>",
 *     "agentDid":    "did:nostr:<pubkey>",   // when known
 *     "viewer":      { name, version, source, license },
 *     "panes":       PaneEntry[],
 *     "registry":    { "<@type>": "<pane-url>" },  // legacy LOSOS shape
 *     "deeplinks":   { name → IRI },         // navigation shortcuts
 *     "buildInfo":   { name, version, rev, … }
 *   }
 */

const fs = require('fs');
const path = require('path');

/**
 * Merge the three pane sources into a single manifest.
 *
 * @param {object} opts
 * @param {object} opts.manifest — parsed agentbox.toml
 * @param {object} [opts.viewerInfo] — passthru of the bundle's build-info
 * @param {string} [opts.imageVersion]
 * @param {string} [opts.agentDid]
 * @param {string[]} [opts.builtInPaneFiles] — absolute paths under
 *   viewer/panes/ that should be exposed at /lo/panes/<basename>.
 * @param {string} [opts.mountPath] — default "/lo"
 * @returns {object} pane manifest ready to JSON.stringify
 */
function buildManifest(opts) {
  const {
    manifest,
    viewerInfo,
    imageVersion,
    agentDid,
    builtInPaneFiles = [],
    mountPath = '/lo',
  } = opts;

  const ld = manifest.linked_data || {};
  const viewerCfg = ld.viewer || {};

  const builtInPanes = builtInPaneFiles.map((file) => {
    const meta = _readPaneMetadata(file);
    return {
      id: meta.id || path.basename(file, '.js'),
      label: meta.label || path.basename(file, '.js'),
      icon: meta.icon || null,
      url: `${mountPath}/panes/${path.basename(file)}`,
      matches: meta.matches || [],
      'agentbox-surface': meta.surface || null,
      source: 'built-in',
    };
  });

  const extraPanes = (viewerCfg.extra_panes || []).map((entry) => {
    if (typeof entry === 'string') {
      return {
        id: _idFromUrl(entry),
        label: _idFromUrl(entry),
        icon: null,
        url: entry,
        matches: [],
        source: 'operator',
      };
    }
    if (entry && typeof entry === 'object' && typeof entry.url === 'string') {
      return Object.assign({ source: 'operator', matches: [] }, entry);
    }
    return null;
  }).filter(Boolean);

  // Upstream panes shipped by the bundle. We don't enumerate them here
  // because LOSOS auto-loads them; we simply declare them by reference
  // so the manifest is complete from a tooling standpoint.
  const upstreamPanes = (viewerCfg.upstream_panes_visible !== false) ? [
    { id: 'home',     label: 'Home',     icon: '🏠',  url: `${mountPath}/panes/home-pane.js`,     matches: [],                                                                                                  source: 'upstream' },
    { id: 'folder',   label: 'Folder',   icon: '📁',  url: `${mountPath}/panes/folder-pane.js`,   matches: [{ '@type': 'http://www.w3.org/ns/ldp#BasicContainer' }],                                              source: 'upstream' },
    { id: 'profile',  label: 'Profile',  icon: '👤',  url: `${mountPath}/panes/profile-pane.js`,  matches: [{ '@type': 'http://xmlns.com/foaf/0.1/Person' }, { '@type': 'http://schema.org/Person' }],            source: 'upstream' },
    { id: 'markdown', label: 'Notes',    icon: '📝',  url: `${mountPath}/panes/markdown-pane.js`, matches: [{ '@type': 'http://www.w3.org/ns/iana/media-types/text/markdown#Resource' }],                          source: 'upstream' },
    { id: 'playlist', label: 'Playlist', icon: '🎵',  url: `${mountPath}/panes/playlist-pane.js`, matches: [{ '@type': 'http://schema.org/MusicPlaylist' }],                                                       source: 'upstream' },
    { id: 'todo',     label: 'Tasks',    icon: '✅',  url: `${mountPath}/panes/todo-pane.js`,     matches: [{ '@type': 'http://www.w3.org/2005/01/wf/flow#Tracker' }, { '@type': 'http://www.w3.org/2002/12/cal/ical#Vtodo' }], source: 'upstream' },
    { id: 'source',   label: 'Source',   icon: '🔍',  url: `${mountPath}/panes/source-pane.js`,   matches: [],                                                                                                  source: 'upstream' },
  ] : [];

  // Built-ins win over upstream when an `id` collides (same shape,
  // local override). Operator panes win over both.
  const merged = _dedup([...upstreamPanes, ...builtInPanes, ...extraPanes]);

  // Legacy LOSOS @type → URL registry. Convenient for panes that
  // bypass `canHandle` and look up by type directly.
  const registry = {};
  for (const p of merged) {
    for (const m of (p.matches || [])) {
      const t = m['@type'];
      if (t && !(t in registry)) registry[t] = p.url;
    }
  }

  return {
    agentbox: imageVersion || (process.env.AGENTBOX_VERSION || 'unknown'),
    agentDid: agentDid || null,
    viewer: viewerInfo ? {
      name: viewerInfo.name,
      version: viewerInfo.version,
      source: viewerInfo.source,
      license: viewerInfo.license,
    } : null,
    panes: merged,
    registry,
    deeplinks: _deeplinks(manifest, mountPath, agentDid),
    buildInfo: viewerInfo || null,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Read pane metadata from an ES module source file by static parsing.
 *
 * Panes are ES modules — the browser loads them, agentbox does not.
 * For the manifest we only need a handful of fields (id, label, icon,
 * surface, matches), so we parse the `export default { ... }` block
 * with regexes rather than executing the module. This keeps panes
 * loadable without a working `import { html, render } from '../losos/html.js'`
 * resolution at the agentbox process; LOSOS is loaded by the browser.
 */
function _readPaneMetadata(file) {
  try {
    const src = fs.readFileSync(file, 'utf8');
    const block = src.match(/export\s+default\s*\{([\s\S]*?)\n\}/);
    const body = block ? block[1] : '';
    return {
      id:      _parseStringField(body, 'id'),
      label:   _parseStringField(body, 'label'),
      icon:    _parseStringField(body, 'icon'),
      surface: _parseStringField(body, 'surface'),
      // Pane sources commonly build `matches` from a const-then-map
      // (e.g. `matches: VC_TYPES.map(t => ({ '@type': t }))`), so
      // looking only inside an inline array misses the values. Scan
      // the whole source — type strings appear literally either way.
      matches: _parseTypeStrings(src),
    };
  } catch (err) {
    process.stderr.write(`viewer.manifest: ${file}: ${err.message}\n`);
    return {};
  }
}

function _parseStringField(body, name) {
  const re = new RegExp(`\\b${name}\\s*:\\s*(?:'([^']*)'|"([^"]*)"|\`([^\`]*)\`)`);
  const m = body.match(re);
  return m ? (m[1] || m[2] || m[3] || null) : null;
}

function _parseTypeStrings(src) {
  // Match either an explicit `'@type': 'X'` map entry or a loose const
  // like `'VerifiableCredential',` inside a TYPES = [...] block. We
  // collect both and de-duplicate, biasing toward strings that look
  // like JSON-LD types (CamelCase, IRI prefix, or vocab-prefix).
  const types = new Set();
  const explicit = [...src.matchAll(/['"`]@type['"`]\s*:\s*['"`]([^'"`]+)['"`]/g)];
  for (const m of explicit) types.add(m[1]);

  // Heuristic: look for a top-level const TYPES array (common pane shape).
  const constArr = src.match(/(?:const|let|var)\s+\w*TYPES\s*=\s*\[([\s\S]*?)\]/);
  if (constArr) {
    const inner = constArr[1];
    for (const m of inner.matchAll(/['"`]([^'"`]+)['"`]/g)) {
      const v = m[1];
      // Keep only plausible @type tokens (skip whitespace-only, paths).
      if (v.length > 0 && !v.includes('\n')) types.add(v);
    }
  }
  return Array.from(types).map((t) => ({ '@type': t }));
}

function _idFromUrl(u) {
  try {
    const url = new URL(u, 'http://_');
    const base = path.basename(url.pathname, '.js');
    return base || 'pane';
  } catch { return 'pane'; }
}

function _dedup(panes) {
  const byId = new Map();
  for (const p of panes) {
    if (!p || !p.id) continue;
    byId.set(p.id, p);   // last writer wins (operator > built-in > upstream)
  }
  return Array.from(byId.values());
}

function _deeplinks(manifest, mountPath, agentDid) {
  const sp = (manifest.integrations || {}).solid_pod_rs || {};
  const podBase = sp.base_url || `http://${sp.bind || '127.0.0.1'}:${sp.port || 8484}`;
  const links = {
    'meta': '/v1/meta',
    'agent-events': '/v1/agent-events',
    'memory-catalogue': '/v1/memory/catalogue',
    'pod-root': podBase + '/',
    'browser': mountPath + '/',
  };
  if (agentDid) {
    const ld = manifest.linked_data || {};
    if ((ld.did_documents || 'off') !== 'off') {
      links['did-document'] = `${podBase}/.well-known/did.json`;
    }
  }
  return links;
}

module.exports = {
  buildManifest,
};
