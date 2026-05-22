'use strict';

/**
 * /pods/:npub/.git/* — Per-user pod git HTTP smart protocol
 *
 * Exposes the git HTTP smart protocol for each user's solid pod
 * repository. The pod directory is initialised as a git repo at
 * provisioning time (solid-pod-rs alpha.12 GitAutoInit hook;
 * agentbox.toml [sovereign_mesh.git] enabled = true).
 *
 * Routes (JSS git.js parity):
 *
 *   GET  /pods/:npub/.git/info/refs?service=git-upload-pack
 *        → read (anonymous if read_public=true, else NIP-98 required)
 *   POST /pods/:npub/.git/git-upload-pack
 *        → clone/fetch (NIP-98 required)
 *   POST /pods/:npub/.git/git-receive-pack
 *        → push (NIP-98 required, pod owner only)
 *   GET  /pods/:npub/.git/HEAD
 *        → symbolic-ref read (public)
 *
 * All write operations proxy through git-http-backend CGI. Read
 * operations from authenticated pod owners also go through CGI.
 *
 * Environment:
 *   SOLID_STORAGE_ROOT  — Pod storage root (default: /var/lib/solid)
 *   GIT_HTTP_BACKEND    — Path to git-http-backend CGI (default: git-http-backend)
 *   GIT_MAX_PUSH_MB     — Per-push body limit in MB (default: 100)
 *   GIT_READ_PUBLIC     — "true" to allow unauthenticated clone (default: false)
 *
 * Auth:
 *   NIP-98 bearer token validated against the pod owner's npub.
 *   Read operations are open when GIT_READ_PUBLIC=true.
 *   Write operations always require the pod owner's NIP-98 token.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STORAGE_ROOT = process.env.SOLID_STORAGE_ROOT || '/var/lib/solid';
const GIT_BACKEND = process.env.GIT_HTTP_BACKEND || 'git-http-backend';
const MAX_PUSH_BYTES = parseInt(process.env.GIT_MAX_PUSH_MB || '100', 10) * 1024 * 1024;
const READ_PUBLIC = process.env.GIT_READ_PUBLIC === 'true';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve and validate the pod filesystem root for a given hex pubkey.
 * Sovereign-bootstrap names dirs with bech32 npub, so if the hex-named
 * dir doesn't exist, scan for a matching npub dir via did-nostr.json.
 */
function podRoot(npub) {
  if (!/^[0-9a-f]{64}$/.test(npub)) return null;

  const hexDir = path.join(STORAGE_ROOT, 'pods', npub);
  if (fs.existsSync(hexDir)) return hexDir;

  const podsDir = path.join(STORAGE_ROOT, 'pods');
  if (!fs.existsSync(podsDir)) return null;

  for (const entry of fs.readdirSync(podsDir)) {
    if (!entry.startsWith('npub1')) continue;
    try {
      const did = JSON.parse(fs.readFileSync(path.join(podsDir, entry, 'did-nostr.json'), 'utf8'));
      const hex = (did.id || '').replace('did:nostr:', '');
      if (hex === npub) return path.join(podsDir, entry);
    } catch { /* skip unreadable entries */ }
  }
  return null;
}

/** Return true when the pod directory has been git-initted. */
function isPodGitRepo(root) {
  return fs.existsSync(path.join(root, '.git'));
}

/**
 * Proxy a request through git-http-backend CGI.
 *
 * CGI environment mirrors what Apache/nginx would set. We populate only
 * the variables that git-http-backend actually reads (see git docs).
 */
function spawnBackend(opts, request, reply) {
  const env = {
    ...process.env,
    GIT_PROJECT_ROOT: opts.projectRoot,
    GIT_HTTP_EXPORT_ALL: '1',
    PATH_INFO: opts.pathInfo,
    QUERY_STRING: opts.queryString || '',
    REQUEST_METHOD: request.method,
    CONTENT_TYPE: request.headers['content-type'] || '',
    CONTENT_LENGTH: request.headers['content-length'] || '',
    REMOTE_ADDR: request.ip || '127.0.0.1',
    SERVER_PROTOCOL: 'HTTP/1.1',
    SERVER_NAME: 'agentbox-pod-git',
    SERVER_PORT: '8080',
    HTTP_GIT_PROTOCOL: request.headers['git-protocol'] || '',
    GIT_HTTP_MAX_REQUEST_BUFFER: String(MAX_PUSH_BYTES),
  };

  const cgi = spawn(GIT_BACKEND, [], { env });

  let headersDone = false;
  let statusLine = '';
  let headers = {};
  let headerBuf = '';

  cgi.stdout.on('data', (chunk) => {
    if (headersDone) {
      reply.raw.write(chunk);
      return;
    }
    headerBuf += chunk.toString('binary');
    const sep = headerBuf.indexOf('\r\n\r\n');
    if (sep === -1) return;

    const headerSection = headerBuf.slice(0, sep);
    const bodyStart = Buffer.from(headerBuf.slice(sep + 4), 'binary');

    for (const line of headerSection.split('\r\n')) {
      if (line.startsWith('Status:')) {
        statusLine = line.replace('Status:', '').trim().split(' ')[0];
      } else {
        const colon = line.indexOf(':');
        if (colon > 0) {
          headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
        }
      }
    }

    const statusCode = parseInt(statusLine || '200', 10);
    reply.raw.writeHead(statusCode, headers);
    if (bodyStart.length > 0) reply.raw.write(bodyStart);
    headersDone = true;
  });

  cgi.stdout.on('end', () => reply.raw.end());

  cgi.stderr.on('data', (d) => {
    opts.log && opts.log.warn({ backend: 'git-http-backend' }, d.toString().trim());
  });

  // Pipe request body into CGI stdin.
  request.raw.pipe(cgi.stdin);
  request.raw.on('error', () => cgi.stdin.destroy());
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

/**
 * @param {import('fastify').FastifyInstance} app
 */
async function podGitRoutes(app, opts) {
  const log = opts.logger || app.log;

  // ── GET /pods/:npub/.git/info/refs ────────────────────────────────────────
  app.get('/pods/:npub/.git/info/refs', {
    config: { auth: READ_PUBLIC ? 'optional' : 'required' },
    schema: {
      tags: ['pod-git'],
      summary: 'Git smart HTTP advertisement',
      params: { type: 'object', properties: { npub: { type: 'string' } } },
      querystring: { type: 'object', properties: { service: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { npub } = request.params;
    const root = podRoot(npub);
    if (!root) return reply.code(400).send({ error: 'invalid npub' });
    if (!fs.existsSync(root)) return reply.code(404).send({ error: 'pod not found' });
    if (!isPodGitRepo(root)) return reply.code(404).send({ error: 'pod is not a git repository' });

    const service = request.query.service || '';
    if (service && service !== 'git-upload-pack' && service !== 'git-receive-pack') {
      return reply.code(400).send({ error: 'unsupported service' });
    }

    const dirName = path.basename(root);
    reply.hijack();
    spawnBackend({
      projectRoot: path.dirname(root),
      pathInfo: `/${dirName}/.git/info/refs`,
      queryString: `service=${service}`,
      log,
    }, request, reply);
  });

  // ── POST /pods/:npub/.git/git-upload-pack (fetch/clone) ───────────────────
  app.post('/pods/:npub/.git/git-upload-pack', {
    config: { auth: READ_PUBLIC ? 'optional' : 'required' },
    schema: {
      tags: ['pod-git'],
      summary: 'Git smart HTTP fetch / clone',
      params: { type: 'object', properties: { npub: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { npub } = request.params;
    const root = podRoot(npub);
    if (!root) return reply.code(400).send({ error: 'invalid npub' });
    if (!fs.existsSync(root)) return reply.code(404).send({ error: 'pod not found' });
    if (!isPodGitRepo(root)) return reply.code(404).send({ error: 'pod is not a git repository' });

    const dirName = path.basename(root);
    reply.hijack();
    spawnBackend({
      projectRoot: path.dirname(root),
      pathInfo: `/${dirName}/.git/git-upload-pack`,
      log,
    }, request, reply);
  });

  // ── POST /pods/:npub/.git/git-receive-pack (push) ─────────────────────────
  app.post('/pods/:npub/.git/git-receive-pack', {
    config: { auth: 'required' },
    schema: {
      tags: ['pod-git'],
      summary: 'Git smart HTTP push (owner only)',
      params: { type: 'object', properties: { npub: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { npub } = request.params;
    const root = podRoot(npub);
    if (!root) return reply.code(400).send({ error: 'invalid npub' });
    if (!fs.existsSync(root)) return reply.code(404).send({ error: 'pod not found' });
    if (!isPodGitRepo(root)) return reply.code(404).send({ error: 'pod is not a git repository' });

    // Enforce ownership: the NIP-98 pubkey must match the pod npub.
    const callerPubkey = request.nip98?.pubkey;
    if (callerPubkey && callerPubkey !== npub) {
      return reply.code(403).send({ error: 'push requires pod ownership' });
    }

    // Enforce size limit on push body.
    const contentLength = parseInt(request.headers['content-length'] || '0', 10);
    if (contentLength > MAX_PUSH_BYTES) {
      return reply.code(413).send({ error: `push body exceeds ${MAX_PUSH_BYTES / 1024 / 1024} MB limit` });
    }

    const dirName = path.basename(root);
    reply.hijack();
    spawnBackend({
      projectRoot: path.dirname(root),
      pathInfo: `/${dirName}/.git/git-receive-pack`,
      log,
    }, request, reply);
  });

  // ── GET /pods/:npub/.git/HEAD ──────────────────────────────────────────────
  app.get('/pods/:npub/.git/HEAD', {
    schema: {
      tags: ['pod-git'],
      summary: 'Read pod git HEAD ref (public)',
      params: { type: 'object', properties: { npub: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { npub } = request.params;
    const root = podRoot(npub);
    if (!root) return reply.code(400).send({ error: 'invalid npub' });
    const headPath = path.join(root, '.git', 'HEAD');
    if (!fs.existsSync(headPath)) return reply.code(404).send({ error: 'pod HEAD not found' });

    const head = fs.readFileSync(headPath, 'utf8');
    return reply
      .code(200)
      .header('content-type', 'text/plain')
      .send(head);
  });

  // ── GET /pods/:npub/clone-url ──────────────────────────────────────────────
  // Convenience: returns the clone URL for a pod's git repo.
  app.get('/pods/:npub/clone-url', {
    schema: {
      tags: ['pod-git'],
      summary: 'Returns the HTTP clone URL for a pod git repository',
      params: { type: 'object', properties: { npub: { type: 'string' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            npub: { type: 'string' },
            clone_url: { type: 'string' },
            is_git_repo: { type: 'boolean' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { npub } = request.params;
    const root = podRoot(npub);
    if (!root) return reply.code(400).send({ error: 'invalid npub' });

    const baseUrl = process.env.AGENTBOX_BASE_URL || 'http://localhost:8080';
    return {
      npub,
      clone_url: `${baseUrl}/pods/${npub}/.git`,
      is_git_repo: !!root && isPodGitRepo(root),
    };
  });
}

module.exports = podGitRoutes;
