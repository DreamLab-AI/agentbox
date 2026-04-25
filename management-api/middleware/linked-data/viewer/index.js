'use strict';

/**
 * Viewer slot composition — DDD-004 §ViewerSurface.
 *
 * Bundles the pane manifest builder, the static-asset registry, and
 * the upstream linkedobjects/browser metadata into one entry point
 * the route handler imports.
 *
 * The viewer slot is intentionally one-implementation-among-many. To
 * add a second viewer, drop a sibling module under viewer/<name>/ and
 * extend `resolveViewerImpl` below. The pane-manifest contract is the
 * stable extension API; viewer implementations consume the same
 * manifest URL.
 *
 * Attribution
 * ===========
 * - linkedobjects/browser — Melvin Carvalho et al., AGPL-3.0
 *   https://github.com/linkedobjects/browser
 * - LION authoring subset — Melvin Carvalho et al., MIT
 *   https://linkedobjects.github.io/
 * - JSS / NosDav / Solid lineage — Sir Tim Berners-Lee, Sarven
 *   Capadisli, Ruben Verborgh, Kjetil Kjernsmo, and the Solid
 *   community (mashlib's `--mashlib-module` interface and the rdflib
 *   subset that LION reproduces)
 */

const fs = require('fs');
const path = require('path');
const { buildManifest } = require('./manifest');

const VIEWER_BUNDLE_DEFAULT = '/opt/agentbox/browser';
const PANES_DIR = path.join(__dirname, 'panes');

class UnknownViewerImplError extends Error {
  constructor(impl) {
    super(`UnknownViewerImpl: ${impl}. Valid: local-linkedobjects | external | off`);
    this.name = 'UnknownViewerImpl';
    this.impl = impl;
  }
}

function _readBuildInfo(bundlePath) {
  const file = path.join(bundlePath, '.agentbox-build-info.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Enumerate the agentbox-built-in pane files. Used by the manifest
 * builder; safe to call before the bundle is materialised.
 */
function builtInPaneFiles() {
  if (!fs.existsSync(PANES_DIR)) return [];
  return fs.readdirSync(PANES_DIR)
    .filter((f) => f.endsWith('.js') && f !== 'README.md')
    .map((f) => path.join(PANES_DIR, f));
}

/**
 * Resolve the viewer implementation to a small descriptor the route
 * handler uses to mount static assets and emit the manifest.
 *
 * Three implementations:
 *
 *   - "local-linkedobjects": serve the bundle from /opt/agentbox/browser
 *     (or operator-overridden bundlePath) plus agentbox-built-in panes
 *     under /lo/panes/.
 *
 *   - "external": redirect /lo/* to the operator-supplied URL. The
 *     manifest is still served by agentbox so panes referencing
 *     agentbox surfaces are reachable.
 *
 *   - "off": route handler returns 404 / 503 depending on auth.
 */
function resolveViewerImpl({ manifest, logger }) {
  const v = (manifest.linked_data && manifest.linked_data.viewer) || {};
  const impl = v.mode || 'off';

  switch (impl) {
    case 'local-linkedobjects':
      return _localLinkedObjects(v, manifest, logger);
    case 'external':
      return _external(v, manifest, logger);
    case 'off':
      return { impl: 'off', enabled: false };
    default:
      throw new UnknownViewerImplError(impl);
  }
}

function _localLinkedObjects(v, manifest, logger) {
  const bundlePath = v.bundle_path || VIEWER_BUNDLE_DEFAULT;
  const buildInfo = _readBuildInfo(bundlePath);
  return {
    impl: 'local-linkedobjects',
    enabled: true,
    mountPath: v.mount_path || '/lo',
    bundlePath,
    panesDir: PANES_DIR,
    buildInfo: buildInfo || {
      name: 'linkedobjects-browser',
      version: 'unknown',
      source: 'https://github.com/linkedobjects/browser',
      license: 'AGPL-3.0-only',
    },
    sourceCodeHeader: 'https://github.com/linkedobjects/browser',
    extraPaneSources: v.extra_panes || [],
    upstreamPanesVisible: v.upstream_panes_visible !== false,
    buildPaneManifest: ({ agentDid, imageVersion }) => buildManifest({
      manifest,
      viewerInfo: buildInfo,
      imageVersion,
      agentDid,
      builtInPaneFiles: builtInPaneFiles(),
      mountPath: v.mount_path || '/lo',
    }),
  };
}

function _external(v, manifest, logger) {
  if (!v.external_url) {
    throw new Error(
      '[linked_data.viewer].mode = "external" requires external_url (E051)',
    );
  }
  return {
    impl: 'external',
    enabled: true,
    mountPath: v.mount_path || '/lo',
    externalUrl: v.external_url,
    sriHash: v.sri_hash || null,
    sourceCodeHeader: v.source_code_header || v.external_url,
    panesDir: PANES_DIR,
    buildInfo: {
      name: 'external-viewer',
      version: 'external',
      source: v.external_url,
      license: 'unknown (operator-managed)',
    },
    buildPaneManifest: ({ agentDid, imageVersion }) => buildManifest({
      manifest,
      viewerInfo: null,
      imageVersion,
      agentDid,
      builtInPaneFiles: builtInPaneFiles(),
      mountPath: v.mount_path || '/lo',
    }),
  };
}

module.exports = {
  resolveViewerImpl,
  UnknownViewerImplError,
  builtInPaneFiles,
  buildManifest,
  PANES_DIR,
};
