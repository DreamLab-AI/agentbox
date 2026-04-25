'use strict';

/**
 * /lo/* — Linked-Object Viewer surface (S12).
 *
 * Routes:
 *
 *   GET /lo/                  → bundle index.html (or upstream redirect)
 *   GET /lo/manifest.json     → pane manifest the browser fetches at boot
 *   GET /lo/panes/<file>      → agentbox-built-in pane (read-only)
 *   GET /lo/<asset>           → pass-through to the linkedobjects/browser tree
 *
 * Every response carries:
 *
 *   Source-Code: <repo URL>            ← AGPL-3.0 §13 compliance
 *   X-Agentbox-Surface: S12
 *   X-Agentbox-Viewer: <impl-name>     ← "local-linkedobjects" | "external"
 *
 * Security
 * --------
 * - The bundle is served read-only; no upload, no execute, no eval-from-URL.
 * - The route is gated by linkedDataViewer.enabled; when off, every path
 *   under /lo/ returns 404.
 * - Pane files are restricted to the on-disk panesDir (no traversal).
 * - The manifest endpoint is unauthenticated by design — it is the
 *   discovery surface the browser needs before it can render anything.
 *   It does not include any private data.
 *
 * Attribution
 * -----------
 * The browser served from this route is
 * [linkedobjects/browser](https://github.com/linkedobjects/browser)
 * (Melvin Carvalho et al., AGPL-3.0). The agentbox-specific built-in
 * panes are documented in
 * `management-api/middleware/linked-data/viewer/panes/README.md`.
 */

const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonld': 'application/ld+json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
};

function _mime(file) {
  const ext = path.extname(file).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

async function linkedObjectsRoutes(fastify, options) {
  const { logger, viewer } = options;

  if (!viewer || viewer.enabled !== true) {
    fastify.get('/lo/*', async (req, reply) => {
      reply.code(404).send({ error: 'viewer-off', message: '[linked_data.viewer].mode = "off"' });
    });
    return;
  }

  // Common headers — applied to every /lo/* response.
  fastify.addHook('onSend', async (req, reply, payload) => {
    if (!req.url.startsWith(viewer.mountPath || '/lo')) return payload;
    reply.header('Source-Code', viewer.sourceCodeHeader);
    reply.header('X-Agentbox-Surface', 'S12');
    reply.header('X-Agentbox-Viewer', viewer.impl);
    if (viewer.impl === 'local-linkedobjects' && viewer.buildInfo) {
      reply.header('X-Viewer-Source', viewer.buildInfo.source || '');
      reply.header('X-Viewer-Version', viewer.buildInfo.version || '');
      reply.header('X-Viewer-License', viewer.buildInfo.license || 'AGPL-3.0-only');
    }
    return payload;
  });

  // ---- Manifest ------------------------------------------------------------
  fastify.get(`${viewer.mountPath}/manifest.json`, async (req, reply) => {
    try {
      const m = viewer.buildPaneManifest({
        agentDid: process.env.AGENTBOX_AGENT_DID || null,
        imageVersion: process.env.AGENTBOX_VERSION || null,
      });
      reply.type('application/ld+json').send(m);
    } catch (err) {
      logger.error({ err: err.message }, 'viewer.manifest build failed');
      reply.code(500).send({ error: 'manifest-failure', message: err.message });
    }
  });

  // ---- Built-in panes ------------------------------------------------------
  fastify.get(`${viewer.mountPath}/panes/:file`, async (req, reply) => {
    const file = req.params.file;
    // Reject path traversal attempts.
    if (file.includes('..') || file.includes('/') || file.includes('\\')) {
      reply.code(400).send({ error: 'bad-path' });
      return;
    }
    if (!file.endsWith('.js')) {
      reply.code(400).send({ error: 'panes-must-be-js' });
      return;
    }
    const full = path.join(viewer.panesDir, file);
    if (!full.startsWith(viewer.panesDir)) {
      reply.code(400).send({ error: 'bad-path' });
      return;
    }
    try {
      const bytes = await fs.promises.readFile(full);
      reply.type(_mime(file)).send(bytes);
    } catch (err) {
      reply.code(404).send({ error: 'pane-not-found', file });
    }
  });

  // ---- External viewer redirect -------------------------------------------
  if (viewer.impl === 'external') {
    fastify.get(`${viewer.mountPath}`, async (req, reply) => {
      reply.redirect(307, viewer.externalUrl);
    });
    fastify.get(`${viewer.mountPath}/*`, async (req, reply) => {
      const tail = req.url.slice((viewer.mountPath || '/lo').length);
      // panes/<file> already handled above; fall through to the manifest
      // for everything else by redirecting.
      reply.redirect(307, viewer.externalUrl + tail);
    });
    return;
  }

  // ---- Local bundle pass-through -------------------------------------------
  fastify.get(`${viewer.mountPath}`, async (req, reply) => {
    reply.redirect(302, `${viewer.mountPath}/index.html`);
  });

  fastify.get(`${viewer.mountPath}/*`, async (req, reply) => {
    const tail = req.url.slice((viewer.mountPath || '/lo').length);
    if (tail.startsWith('/manifest.json')) return; // already handled above
    if (tail.startsWith('/panes/')) return;        // already handled above

    // Strip any query string; the bundle does not consume them.
    const queryIdx = tail.indexOf('?');
    const cleanTail = queryIdx === -1 ? tail : tail.slice(0, queryIdx);
    const requested = cleanTail === '/' ? '/index.html' : cleanTail;
    const full = path.join(viewer.bundlePath, requested);

    if (!full.startsWith(path.resolve(viewer.bundlePath))) {
      reply.code(400).send({ error: 'bad-path' });
      return;
    }

    try {
      const bytes = await fs.promises.readFile(full);
      reply.type(_mime(requested)).send(bytes);
    } catch (err) {
      reply.code(404).send({ error: 'asset-not-found', requested });
    }
  });
}

module.exports = linkedObjectsRoutes;
