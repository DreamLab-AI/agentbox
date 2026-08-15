#!/usr/bin/env node
/**
 * Agentic Flow Management API Server
 * Provides HTTP endpoints for task management and system monitoring
 */

const fs = require('fs');
const fastify = require('fastify');
const cors = require('@fastify/cors');
const rateLimit = require('@fastify/rate-limit');
const websocket = require('@fastify/websocket');
const { createAuthMiddleware, registerRawBody } = require('./middleware/auth');
// payment-gate: registered as preHandler on GPU-metered routes (comfyui, tasks)
const contractVersions = require('./adapters/contract-versions');
const { resolveAdapters, SLOTS } = require('./adapters/index');
const { loadManifest, ManifestNotFound } = require('./adapters/manifest-loader');
const logger = require('./observability/logger');
const ProcessManager = require('./utils/process-manager');
const SystemMonitor = require('./utils/system-monitor');
const ComfyUIManager = require('./utils/comfyui-manager');
// R-011: single Prometheus registry — observability/metrics.js owns the
// registry, collectDefaultMetrics, adapter spans, and HTTP instrumentation.
// utils/metrics.js is a thin re-export of this same module for any stragglers.
const observabilityMetrics = require('./observability/metrics');
const metrics = observabilityMetrics;
const { startMetricsServer, shutdownMetricsServer } = require('./observability/metrics-server');
const { initTracing, shutdown: shutdownTracing } = require('./observability/tracing');
// Project tracking (PRD-017 / ADR-035 / DDD-015) — helm-grade project tracking
// expressed on the sovereign substrate: thing URNs, port-bound /metrics gauges,
// and kind-30841 nostr digests. Self-gates from [project_tracking] in the manifest.
const projectMetrics = require('./observability/project-metrics');
const { ProjectTracker } = require('./lib/project-tracker');
const { PrimerGenerator } = require('./lib/project-primer');
// Interaction plane (PRD-021 / ADR-043) — session identity binding + the
// authority approval loop. The authority consumer (D4.7) is the canonical
// awaitDecision seam wired into buildAuthorityGate at boot.
const { buildAuthorityGate } = require('./lib/authority');
const { buildAuthorityConsumer } = require('./lib/authority-consumer');
const governanceWaiter = require('./lib/governance-decision-waiter');

// Configuration
const PORT = process.env.MANAGEMENT_API_PORT || 9090;
// R-003: bind defaults to 0.0.0.0 because Docker port publishing requires the
// in-container listener to accept the bridge interface. It is exposed only on
// host-loopback via the compose `127.0.0.1:` publish mapping; cross-container
// access on the docker network is gated by MANAGEMENT_API_KEY (see authMiddleware).
const HOST = process.env.MANAGEMENT_API_HOST || '0.0.0.0';
const API_KEY = process.env.MANAGEMENT_API_KEY;
if (!API_KEY) {
  console.error('MANAGEMENT_API_KEY environment variable is required');
  process.exit(1);
}

// Bootstrap sentinel state — updated asynchronously when the sentinel file appears.
const BOOTSTRAP_SENTINEL = '/run/agentbox/bootstrap.done';
const bootstrapState = { completed: false, since: null };
let _sentinelTimer = null;

function _checkSentinel() {
  fs.access(BOOTSTRAP_SENTINEL, fs.constants.F_OK, (err) => {
    if (!err && !bootstrapState.completed) {
      bootstrapState.completed = true;
      bootstrapState.since = new Date().toISOString();
      logger.info({ sentinel: BOOTSTRAP_SENTINEL }, 'Bootstrap sentinel observed — container ready');
      // QE P2-8: clear the poll once the one-shot detection has fired.
      if (_sentinelTimer) {
        clearInterval(_sentinelTimer);
        _sentinelTimer = null;
      }
    }
  });
}

// Poll every 2 s for the sentinel (fs.watch is unreliable on some container
// overlay filesystems; polling is deterministic and cheap). Timer is cleared
// after first detection in _checkSentinel above.
_checkSentinel();
_sentinelTimer = setInterval(_checkSentinel, 2000);

// Initialize Fastify with logger
const app = fastify({
  logger,
  requestIdLogLabel: 'reqId',
  disableRequestLogging: false,
  trustProxy: true,
  // Canonical agentbox URNs carried as path params (/v1/uri/:urn,
  // /v1/beads/:id, …) are scope-bearing and content-addressed — e.g.
  // `urn:agentbox:bead:<64-hex>:sha256-12-<12>` is ~105 chars, over
  // find-my-way's 100-char default, which would 404 a valid id. Raise the
  // param ceiling so every ADR-013 identifier round-trips as a path segment.
  maxParamLength: 512
});

// Finding 1 (NIP-98 body binding): register a content-type parser that
// preserves the EXACT received bytes on `request.rawBody` (a Buffer) while
// still delivering parsed JSON to route handlers. verifyNip98Header consumes
// `request.rawBody` to enforce the payload-tag == sha256(rawBody) binding.
// Must run before routes register their own parsers; harmless for bodyless
// GET/HEAD. Paired with moving the auth hook to `preValidation` (below) so it
// runs AFTER Fastify has parsed the body and populated `request.rawBody`.
registerRawBody(app);

// Initialize managers
const processManager = new ProcessManager(logger);
const systemMonitor = new SystemMonitor(logger);
const comfyuiManager = new ComfyUIManager(logger, metrics);

// Adapter health state — populated during startup
// Values: "healthy" | "degraded" | "off"
const adapterHealth = { beads: 'off', pods: 'off', memory: 'off', events: 'off', orchestrator: 'off' };
let resolvedAdapters = null;

// ADR-010 — /health/pods probes the solid-pod-rs server and the did:nostr
// resolver. Delegates to the adapter's impl for non-intrusive checks.
async function probePodHealth() {
  const podsAdapter = resolvedAdapters && resolvedAdapters.pods;
  if (!podsAdapter) {
    return { status: 'unknown', reason: 'adapter not resolved' };
  }
  const impl = podsAdapter._implName || 'unknown';
  if (impl === 'off') return { status: 'off', impl };

  const baseUrl = (podsAdapter._base || process.env.SOLID_POD_BASE_URL || 'http://127.0.0.1:8484').replace(/\/$/, '');
  const result = {
    impl,
    base_url: baseUrl,
    solid_pod_rs_health: 'unknown',
    did_nostr_resolves:  'unknown',
    writable_storage:    'unknown',
  };

  try {
    const res = await fetch(`${baseUrl}/health`, { method: 'GET' });
    result.solid_pod_rs_health = res.ok ? 'ok' : `http_${res.status}`;
  } catch (err) {
    result.solid_pod_rs_health = `unreachable: ${err.code || err.message}`;
  }

  // ADR-013: the canonical agentbox DID grammar carries a BIP-340 x-only
  // pubkey hex (AGENTBOX_PUBKEY). solid-pod-rs's did-nostr feature
  // accepts both pubkey hex and bech32 npub at the resolver, so this
  // probe prefers the canonical pubkey form when set and falls back to
  // the legacy npub for deployments that haven't surfaced AGENTBOX_PUBKEY
  // from sovereign-bootstrap yet.
  const didIdentifier = process.env.AGENTBOX_PUBKEY || process.env.AGENTBOX_NPUB;
  if (impl === 'local-solid-rs' && didIdentifier) {
    try {
      const res = await fetch(`${baseUrl}/did:nostr:${didIdentifier}`, {
        headers: { Accept: 'application/did+ld+json, application/ld+json, */*' },
      });
      result.did_nostr_resolves = res.ok ? 'ok' : `http_${res.status}`;
    } catch (err) {
      result.did_nostr_resolves = `unreachable: ${err.code || err.message}`;
    }
  } else if (impl !== 'local-solid-rs') {
    result.did_nostr_resolves = 'n/a (requires local-solid-rs)';
  }

  try {
    const root = process.env.AGENTBOX_RELAY_POD_BRIDGE === 'false'
      ? null
      : (process.env.SOLID_POD_ROOT || '/var/lib/solid');
    if (root) {
      fs.accessSync(root, fs.constants.W_OK);
      result.writable_storage = 'ok';
    } else {
      result.writable_storage = 'bridge-disabled';
    }
  } catch (err) {
    result.writable_storage = `denied: ${err.code || err.message}`;
  }

  const allGreen =
    result.solid_pod_rs_health === 'ok' &&
    (result.did_nostr_resolves === 'ok' || result.did_nostr_resolves === 'n/a (requires local-solid-rs)') &&
    (result.writable_storage === 'ok' || result.writable_storage === 'bridge-disabled');
  result.status = allGreen ? 'ready' : 'degraded';
  return result;
}

// Middleware: CORS — restrict to known origins (FIX 3).
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:8080,http://localhost:5901').split(',').map(s => s.trim());
app.register(cors, {
  origin: allowedOrigins,
  credentials: true
});

// Middleware: WebSocket support
app.register(websocket);

// Middleware: Rate limiting
app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  cache: 10000,
  allowList: ['127.0.0.1'],
  continueExceeding: true,
  skipOnError: false
});

// Metrics tracking middleware
app.addHook('onRequest', async (request, reply) => {
  request.startTime = Date.now();
});

app.addHook('onResponse', async (request, reply) => {
  const duration = (Date.now() - request.startTime) / 1000;
  metrics.recordHttpRequest(
    request.method,
    request.routerPath || request.url,
    reply.statusCode,
    duration
  );
});

// Authentication middleware (applies to all routes except health checks)
const authMiddleware = createAuthMiddleware(API_KEY, {
  authMode: process.env.MANAGEMENT_API_AUTH_MODE || 'hybrid'
});

// Finding 1: run auth at `preValidation`, NOT `onRequest`. Fastify parses the
// body (and populates `request.rawBody` via registerRawBody's parser) between
// onRequest and preValidation, so only here does verifyNip98Header receive the
// exact signed bytes and the NIP-98 payload-tag == sha256(rawBody) binding
// engage for POST/PUT/PATCH. Auth-exempt paths, 404s, and bodyless GETs are
// unchanged — the phase moved, the decision logic did not.
app.addHook('preValidation', async (request, reply) => {
  // Skip auth for probe and observability endpoints (public, no key required)
  if (
    request.url === '/livez' ||
    request.url === '/health' ||
    request.url === '/ready' ||
    request.url === '/metrics' ||
    request.url === '/v1/meta'
  ) {
    return;
  }

  // Skip auth for the linked-object viewer bundle (/lo/*).
  // Static assets (HTML, JS, CSS, panes) must load before window.nostr is
  // available to sign a NIP-98 request. The bundle contains no private data.
  // Data endpoints the viewer calls (/v1/*) remain fully gated.
  if (request.url.startsWith('/lo/') || request.url === '/lo') {
    return;
  }

  // The OpenAPI description and Swagger UI shell are public documentation.
  // Individual API requests issued from the UI remain authenticated and the
  // Authorize control supports bearer and NIP-98 credentials.
  if (request.url.startsWith('/docs/') || request.url === '/docs') {
    return;
  }

  // DID documents must be publicly resolvable per the DID-Core spec.
  // The document contains only the public key and service endpoints — no
  // private data. Gate removal is intentional, not an oversight.
  if (request.url === '/.well-known/did.json') {
    return;
  }

  // x402 payment-surface discovery manifest must be publicly readable
  // so HTTP clients can negotiate payment schemes without prior auth.
  if (request.url === '/.well-known/x402.json') {
    return;
  }

  await authMiddleware(request, reply);
});

// OpenAPI/Swagger
app.register(require('@fastify/swagger'), {
  openapi: {
    openapi: '3.0.0',
    info: {
      title: 'Agentbox Management API',
      description: 'Sovereign control-plane API for Agentbox sessions, projects, memory, pods, approvals, events, and tools.',
      version: '2.1.0',
      contact: {
        name: 'DreamLab AI',
        url: 'https://github.com/DreamLab-AI/agentbox'
      }
    },
    servers: [
      {
        url: 'http://localhost:9090',
        description: 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Break-glass or local operator bearer token. NIP-98 is preferred when the sovereign mesh is enabled.'
        },
        nip98: {
          type: 'apiKey',
          name: 'Authorization',
          in: 'header',
          description: 'NIP-98 kind-27235 event encoded as: Nostr <base64-event>. The u, method, payload, timestamp, signer, and replay constraints are verified.'
        }
      }
    },
    security: [{ nip98: [] }, { bearerAuth: [] }],
    tags: [
      { name: 'tasks', description: 'Task management endpoints' },
      { name: 'monitoring', description: 'System monitoring and health' },
      { name: 'metrics', description: 'Prometheus metrics' },
      { name: 'comfyui', description: 'ComfyUI workflow management' },
      { name: 'agent-events', description: 'Real-time agent action event streaming' },
      { name: 'projects', description: 'Project tracking — scan, status, commit activity, primers, kind-30841 nostr digests (PRD-017)' },
      { name: 'git-bridge', description: 'BC20 Git Bridge — clone, enrichment submission, broker polling (PRD-013 G5)' },
      { name: 'pod-git', description: 'Per-user pod git HTTP smart protocol (JSS #466/#469/#471, alpha.12)' },
      { name: 'beads', description: 'Beads work-ledger — epics, children, claim, close (ADR-043 D4.3)' },
      { name: 'mandate', description: 'Scoped WAC agent-delegation mandates (ADR-043 D4.5)' },
      { name: 'approvals', description: 'Pending authority-gate approvals — signed 31403 decisions (ADR-043 D4.7)' },
      { name: 'interaction-plane', description: 'AoE session-boundary identity binding (PRD-021 / ADR-043)' }
    ]
  }
});

app.register(require('@fastify/swagger-ui'), {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: true,
    defaultModelsExpandDepth: 3
  },
  staticCSP: true
});

// Register routes
app.register(require('./routes/tasks'), {
  prefix: '',
  processManager,
  logger,
  metrics
});

app.register(require('./routes/status'), {
  prefix: '',
  systemMonitor,
  processManager,
  logger,
  metrics
});

app.register(require('./routes/comfyui'), {
  prefix: '',
  comfyuiManager,
  logger,
  metrics
});

app.register(require('./routes/agent-events'), {
  prefix: '',
  logger,
  metrics
});

// Memory routes — write/read agent memory entries to the operator's Solid pod.
// Requires adapters.pods = "local-solid-rs"; gracefully returns 503 when off.
app.register(require('./routes/memory'), { prefix: '', logger });

// Broker Bridge — G6, PRD-013 §Broker Review Surface.
// Bridges VisionClaw BrokerActor REST/WS into the management API so the
// enrichment-review-pane (S12) can operate without cross-origin calls.
app.register(require('./routes/broker-bridge'), { prefix: '', logger });

// Git Bridge — G5, PRD-013 §Agentbox Pod Bridge.
// BC20 adapter bridging agentbox agents to VisionClaw's git ingest surface
// and judgment broker. Agents clone remotes, submit enrichments, and poll
// for broker decisions through these local endpoints.
app.register(require('./routes/git-bridge'), { prefix: '', logger });

// Pod git HTTP smart protocol (JSS #466/#469/#471, solid-pod-rs alpha.12).
// Serves git-upload-pack / git-receive-pack / info/refs for each user's
// solid pod git repository at /pods/:npub/.git/*.
// Gated by agentbox.toml [sovereign_mesh.git].enabled; wired unconditionally
// here since the routes return 404 when the pod is not a git repo.
app.register(require('./routes/pod-git'), { prefix: '', logger });

// Payment routes — HTTP 402 Web Ledger integration.
// Proxies to solid-pod-rs payment module; local cost estimation.
app.register(require('./routes/payments'), { prefix: '', logger, metrics });

// LLM Resource Marketplace — Nostr kinds 38300-38305.
// Mesh-wide negotiation of LLM compute resources between did:nostr identities.
app.register(require('./routes/llm-marketplace'), { prefix: '', logger });

// Liveness probe — registered early, no sentinel check, event-loop-alive only.
// Must respond in <100 ms unconditionally.
app.get('/livez', {
  schema: {
    description: 'Liveness probe — returns 200 as long as the event loop is responsive',
    tags: ['monitoring'],
    response: {
      200: {
        type: 'object',
        properties: {
          live:   { type: 'boolean' },
          uptime: { type: 'number' }
        }
      }
    }
  }
}, async (request, reply) => {
  return { live: true, uptime: process.uptime() };
});

// Readiness probe — returns 503 until ALL requirements are satisfied.
app.get('/ready', {
  schema: {
    description: 'Readiness probe — 200 when all requirements met, 503 otherwise',
    tags: ['monitoring'],
    response: {
      200: {
        type: 'object',
        properties: {
          ready:        { type: 'boolean' },
          since:        { type: 'string' },
          requirements: { type: 'array', items: { type: 'string' } }
        }
      },
      503: {
        type: 'object',
        properties: {
          ready:   { type: 'boolean' },
          reason:  { type: 'string' },
          missing: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }
}, async (request, reply) => {
  const missing = [];

  // 1. Bootstrap sentinel
  if (!bootstrapState.completed) {
    missing.push('bootstrap.done sentinel');
  }

  // 2. Adapter health — every non-off slot must be healthy
  let manifest;
  try {
    manifest = require('./adapters/manifest-loader').loadManifest();
  } catch (_) {
    manifest = {};
  }
  const manifestAdapters = (manifest && manifest.adapters) ? manifest.adapters : {};
  for (const [slot, impl] of Object.entries(manifestAdapters)) {
    if (impl === 'off') continue;
    if (adapterHealth[slot] !== 'healthy') {
      missing.push(`adapter:${slot} not healthy (status=${adapterHealth[slot] || 'unknown'})`);
    }
  }

  // 3. Required filesystem paths.
  // Any pod impl backed by the local filesystem needs its storage root
  // accessible before /ready goes green. local-solid-rs is the only
  // local pod impl post-2026-04-25 (legacy local-jss stub retired);
  // respect an operator override from [integrations.solid_pod_rs].storage_root.
  const requiredPaths = ['/home/devuser/workspace', '/var/lib/ruvector'];
  const pods = manifestAdapters.pods;
  if (pods === 'local-solid-rs') {
    const sp = (manifest && manifest.integrations && manifest.integrations.solid_pod_rs) || {};
    const solidRoot = sp.storage_root || '/var/lib/solid';
    if (!requiredPaths.includes(solidRoot)) requiredPaths.push(solidRoot);
  }
  await Promise.all(requiredPaths.map(async (p) => {
    try {
      await fs.promises.access(p, fs.constants.F_OK);
    } catch (_) {
      missing.push(`path not accessible: ${p}`);
    }
  }));

  // 4. Sovereign mesh: if publish_agent_events=true, at least one Nostr relay must be reachable.
  // Relay reachability is best-effort (TCP connect) to avoid blocking the probe beyond a short
  // window. We skip the check if the env var is unset (no relays configured).
  const sovereignCfg = (manifest && manifest.sovereign_mesh) ? manifest.sovereign_mesh : {};
  if (sovereignCfg.publish_agent_events === true) {
    const relaysRaw = process.env.NOSTR_RELAYS || '';
    const relays = relaysRaw.split(',').map(r => r.trim()).filter(Boolean);
    if (relays.length === 0) {
      missing.push('sovereign_mesh.publish_agent_events=true but NOSTR_RELAYS is empty');
    }
    // Note: TCP reachability check of relay URLs is deferred to a dedicated health worker
    // to keep /ready response time bounded. Declaration of relay list is sufficient here.
  }

  if (missing.length > 0) {
    reply.code(503).send({
      ready: false,
      reason: `${missing.length} requirement(s) not met`,
      missing
    });
    return;
  }

  return {
    ready: true,
    since: bootstrapState.since,
    requirements: ['bootstrap.done', 'adapters:healthy', 'paths:accessible']
  };
});

// Health endpoint (public — no auth required).
// Returns aggregate per-adapter health for human consumption.
// NOTE: This is NOT the readiness signal — use /ready for orchestrator probes.
app.get('/health', {
  schema: {
    description: 'Liveness health check',
    tags: ['monitoring'],
    response: {
      200: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          uptime: { type: 'number' },
          image_hash: { type: ['string', 'null'] },
          manifest_checksum: { type: ['string', 'null'] },
          // fast-json-stringify strips undeclared properties; without
          // additionalProperties the adapter map serializes as {}
          adapters: { type: 'object', additionalProperties: { type: 'string' } },
          degraded_count: { type: 'number' },
          note: { type: 'string' }
        }
      }
    }
  }
}, async (request, reply) => {
  const degradedCount = Object.values(adapterHealth).filter(s => s === 'degraded').length;
  return {
    status: degradedCount > 0 ? 'degraded' : 'ok',
    uptime: process.uptime(),
    image_hash: process.env.AGENTBOX_IMAGE_HASH || null,
    manifest_checksum: process.env.AGENTBOX_MANIFEST_CHECKSUM || null,
    adapters: { ...adapterHealth },
    degraded_count: degradedCount,
    note: 'This endpoint is for human inspection only. Use /ready for orchestrator readiness probes.'
  };
});

// Pod health endpoint (public — no auth required, ADR-010 §Observability).
// Probes the solid-pod-rs server's /health, the did:nostr resolver, and the
// writable mount. Degraded on any failure.
app.get('/health/pods', {
  schema: {
    description: 'Solid pod (solid-pod-rs) health + did:nostr probe',
    tags: ['monitoring'],
    response: {
      200: {
        type: 'object',
        properties: {
          status:               { type: 'string' },
          impl:                 { type: 'string' },
          base_url:             { type: 'string' },
          solid_pod_rs_health:  { type: 'string' },
          did_nostr_resolves:   { type: 'string' },
          writable_storage:     { type: 'string' },
        }
      }
    }
  }
}, async (request, reply) => probePodHealth());

// Meta endpoint (public — no auth required, ADR-005 §Contract versioning)
app.get('/v1/meta', {
  schema: {
    description: 'Image and adapter contract metadata',
    tags: ['monitoring'],
    response: {
      200: {
        type: 'object',
        properties: {
          image_hash: { type: ['string', 'null'] },
          manifest_checksum: { type: ['string', 'null'] },
          federation_mode: { type: ['string', 'null'] },
          adapter_contract_versions: {
            type: 'object',
            properties: {
              beads: { type: 'string' },
              pods: { type: 'string' },
              memory: { type: 'string' },
              events: { type: 'string' },
              orchestrator: { type: 'string' }
            }
          },
          adapter_impls: { type: 'object' }
        }
      }
    }
  }
}, async (request, reply) => {
  const adapterImpls = {};
  for (const slot of SLOTS) {
    adapterImpls[slot] = resolvedAdapters ? resolvedAdapters[slot]._implName : 'unknown';
  }
  const metricsPort = process.env.AGENTBOX_METRICS_PORT || 9091;
  return {
    image_hash: process.env.AGENTBOX_IMAGE_HASH || null,
    manifest_checksum: process.env.AGENTBOX_MANIFEST_CHECKSUM || null,
    federation_mode: process.env.AGENTBOX_FEDERATION_MODE || null,
    adapter_contract_versions: contractVersions,
    adapter_impls: adapterImpls,
    observability: {
      metrics_endpoint: `http://0.0.0.0:${metricsPort}/metrics`,
      otlp_endpoint: process.env.AGENTBOX_OTLP_ENDPOINT || null
    }
  };
});

// Metrics endpoint
app.get('/metrics', {
  schema: {
    description: 'Prometheus metrics endpoint',
    tags: ['metrics'],
    response: {
      200: {
        type: 'string',
        description: 'Prometheus metrics in text format'
      }
    }
  }
}, async (request, reply) => {
  reply.type('text/plain');
  return metrics.register.metrics();
});

// Root endpoint
app.get('/', {
  schema: {
    description: 'API information and available endpoints',
    tags: ['monitoring'],
    response: {
      200: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
          endpoints: { type: 'object' },
          documentation: { type: 'string' },
          authentication: { type: 'string' }
        }
      }
    }
  }
}, async (request, reply) => {
  reply.send({
    name: 'Agentic Flow Management API',
    version: '2.1.0',
    endpoints: {
      tasks: {
        create: 'POST /v1/tasks',
        get: 'GET /v1/tasks/:taskId',
        list: 'GET /v1/tasks',
        stop: 'DELETE /v1/tasks/:taskId'
      },
      comfyui: {
        submit: 'POST /v1/comfyui/workflow',
        status: 'GET /v1/comfyui/workflow/:workflowId',
        cancel: 'DELETE /v1/comfyui/workflow/:workflowId',
        models: 'GET /v1/comfyui/models',
        outputs: 'GET /v1/comfyui/outputs',
        stream: 'WS /v1/comfyui/stream'
      },
      agentEvents: {
        stream: 'WS /v1/agent-events/stream',
        recent: 'GET /v1/agent-events',
        emit: 'POST /v1/agent-events/emit',
        batch: 'POST /v1/agent-events/batch',
        types: 'GET /v1/agent-events/types',
        status: 'GET /v1/agent-events/status'
      },
      projects: {
        list: 'GET /v1/projects',
        get: 'GET /v1/projects/:id',
        activity: 'GET /v1/projects/:id/activity',
        scan: 'POST /v1/projects/scan',
        primer: 'POST /v1/projects/:id/primer',
        publish: 'POST /v1/projects/:id/publish'
      },
      brokerBridge: {
        inbox: 'GET /api/broker/bridge/inbox',
        case: 'GET /api/broker/bridge/cases/:id',
        decide: 'POST /api/broker/bridge/cases/:id/decide',
        history: 'GET /api/broker/bridge/cases/:id/history',
        events: 'GET /api/broker/bridge/events (SSE)'
      },
      gitBridge: {
        clone: 'POST /v1/git/clone',
        submitEnrichment: 'POST /v1/git/submit-enrichment',
        caseStatus: 'GET /v1/git/case-status/:caseId',
        approveCallback: 'POST /v1/git/approve-callback'
      },
      payments: {
        info: 'GET /v1/pay/info',
        balance: 'GET /v1/pay/balance',
        deposit: 'POST /v1/pay/deposit',
        estimate: 'POST /v1/pay/estimate',
        buy: 'POST /v1/pay/buy',
        withdraw: 'POST /v1/pay/withdraw'
      },
      monitoring: {
        status: 'GET /v1/status',
        health: 'GET /health',
        ready: 'GET /ready',
        metrics: 'GET /metrics'
      }
    },
    documentation: '/docs',
    authentication: 'Authorization: Bearer <token> or Authorization: Nostr <base64-event> (except /health, /ready, /metrics)'
  });
});

// Error handler — scrub internal details from 5xx responses (FIX 6).
app.setErrorHandler((error, request, reply) => {
  const statusCode = error.statusCode || 500;

  // Record error in metrics
  metrics.recordError(
    error.name || 'UnknownError',
    request.routerPath || request.url
  );

  if (statusCode >= 500) {
    logger.error({ err: error, reqId: request.id }, 'Internal server error');
    reply.code(statusCode).send({
      error: 'Internal Server Error',
      statusCode,
    });
  } else {
    logger.warn({ err: error, reqId: request.id }, 'Request error');
    reply.code(statusCode).send({
      error: error.name || 'Error',
      message: error.message,
      statusCode,
    });
  }
});

// Graceful shutdown
async function closeGracefully(signal) {
  logger.info(`Received signal ${signal}, closing server gracefully`);

  // Cleanup old tasks
  processManager.cleanup();

  // Shutdown observability
  await shutdownMetricsServer();
  await shutdownTracing();

  // Disconnect all adapters with a 5s total timeout
  if (resolvedAdapters) {
    const disconnectOps = SLOTS.map(async (slot) => {
      const adapter = resolvedAdapters[slot];
      if (typeof adapter.disconnect !== 'function') return;
      try {
        await adapter.disconnect();
        logger.info({ slot }, 'Adapter disconnected');
      } catch (err) {
        logger.error({ slot, err: err.message }, 'Adapter disconnect error (ignored)');
      }
    });

    try {
      await Promise.race([
        Promise.allSettled(disconnectOps),
        new Promise((_, reject) => setTimeout(() => reject(new Error('disconnect timeout')), 5000))
      ]);
    } catch {
      logger.warn('Adapter disconnect did not complete within 5 s, continuing shutdown');
    }
  }

  await app.close();
  process.exit(0);
}

process.on('SIGINT', closeGracefully);
process.on('SIGTERM', closeGracefully);

// Periodic cleanup of old tasks (every 10 minutes)
setInterval(() => {
  processManager.cleanup(3600000); // 1 hour
}, 600000);

/**
 * COM-15 producer wiring. Build the signed-31402 dispatcher the voice-intent
 * route uses to dispatch a governed intent toward the scene-selected actor_did.
 * Returns null (route then declines 503, fail-closed) when the sovereign bridge,
 * relays, or a signer stack are unavailable — no dead code, no silent success.
 *
 * The bridge + signer are connected/loaded LAZILY on the first dispatch, not at
 * boot, so mounting the route never opens a relay connection. Mirrors the
 * junkiejarvis vendoring: prefer the flake-vendored lib/, fall back to the mcp/
 * source tree for a dev checkout.
 */
function buildVoiceIntentDispatcher(manifest, logger) {
  const sm = (manifest && manifest.sovereign_mesh) || {};
  const bridgeEnabled = sm.nostr_bridge === true;
  const relays = String(process.env.NOSTR_RELAYS || '')
    .split(',').map((r) => r.trim()).filter(Boolean);
  const integ = (manifest && manifest.integrations && manifest.integrations.solid_pod_rs) || {};
  const stack = process.env.AGENTBOX_STACK || process.env.AGENTBOX_PROFILE || integ.sign_stack || null;

  if (!bridgeEnabled || relays.length === 0 || !stack) {
    logger.debug({
      event: 'voice-intent.dispatch-unwired',
      nostr_bridge: bridgeEnabled, relays: relays.length, stack: !!stack,
    }, 'Voice-intent signed-31402 dispatcher not wired (declines otherwise-valid requests 503)');
    return null;
  }

  const acs = require('./lib/agent-control-surface');
  let ready = null; // cached { bridge, signer } after the first successful connect

  async function ensureReady() {
    if (ready) return ready;
    let NostrBridge, loadSigner;
    try { ({ NostrBridge, loadSigner } = require('./lib/nostr-bridge')); }
    catch { ({ NostrBridge, loadSigner } = require('../mcp/servers/nostr-bridge')); }
    const bridge = new NostrBridge({ relays });
    await bridge.connect();
    const signer = loadSigner(stack, {});
    app.addHook('onClose', async () => { try { await bridge.disconnect(); } catch (_) { /* ignore */ } });
    ready = { bridge, signer };
    return ready;
  }

  return async function dispatchActionRequest(unsigned) {
    const { bridge, signer } = await ensureReady();
    return acs.publishPanelEvent(bridge, signer, unsigned);
  };
}

// Start server
async function start() {
  try {
    // ── Adapter resolution ──────────────────────────────────────────────
    let manifest;
    try {
      manifest = loadManifest();
      logger.info({ path: process.env.AGENTBOX_MANIFEST_PATH || '/etc/agentbox.toml' }, 'Manifest loaded');
    } catch (err) {
      if (err.name === 'ManifestNotFound') {
        logger.warn({ err: err.message }, 'Manifest not found — using all-off adapter defaults');
        manifest = {};
      } else {
        throw err;
      }
    }

    // ── Provider env-var visibility check ──────────────────────────────
    // Warn for every enabled provider whose primary env var is not set.
    // Does not abort boot — env vars may arrive via secret manager after start.
    const manifestProviders = manifest.providers || {};
    for (const [providerName, provConf] of Object.entries(manifestProviders)) {
      if (!provConf || provConf.enabled !== true) continue;
      const envVar = provConf.env_var || `${providerName.toUpperCase()}_API_KEY`;
      if (!process.env[envVar]) {
        logger.warn(
          { provider: providerName, env_var: envVar },
          `Provider "${providerName}" is enabled but env var "${envVar}" is not set — provider will be non-functional`
        );
      }
    }

    resolvedAdapters = resolveAdapters(manifest);
    app.decorate('adapters', resolvedAdapters);

    // ── Linked-Data middleware (PRD-006 / ADR-012 / DDD-004) ────────────────
    // Boot the encoder when [linked_data].enabled = true. The encoder runs
    // strictly after the privacy filter (ADR-008) in the dispatch path; the
    // ordering is enforced in code, not in config (DDD-004 §L08).
    {
      try {
        const ld = require('./middleware/linked-data');
        const ldEncoder = await ld.createEncoder({
          manifest,
          logger,
          agentDid: process.env.AGENTBOX_AGENT_DID || null,
        });
        app.decorate('linkedData', ldEncoder);
        if ((manifest.linked_data || {}).enabled === true) {
          logger.info({
            event: 'linked-data.middleware-booted',
            surfaces: ldEncoder.surfaces ? Array.from(ldEncoder.surfaces.keys()) : [],
          }, 'Linked-Data encoder ready');
        }
      } catch (err) {
        if ((manifest.linked_data || {}).enabled === true) {
          logger.error({ err: err.message }, 'Linked-Data middleware failed to boot — surfaces will be unavailable');
        } else {
          logger.debug({ err: err.message }, 'Linked-Data middleware not booted (master gate off)');
        }
      }
    }

    // ── Canonical URI resolver (ADR-013 / DDD-004 §URICanonicaliser) ────────
    // /v1/uri/<urn> dereferences agentbox URIs. Always available — the
    // resolver does not depend on [linked_data].enabled because URI
    // uniqueness is unconditional; only resolvability depends on which
    // surfaces are enabled.
    {
      try {
        await app.register(require('./routes/uri-resolver'), { logger, manifest });
        logger.debug({ event: 'uri.resolver-mounted' }, 'URI resolver ready at /v1/uri');
      } catch (err) {
        logger.error({ err: err.message }, 'URI resolver failed to mount');
      }
    }

    // ── System surface (ADR-039 — docBox back-port) ─────────────────────────
    // /v1/system renders the live gate map (surfaces + modules with state and
    // apply-class) over the parsed manifest and resolved adapters;
    // /v1/system/audit-chain verifies the hash-chained events JSONL log.
    // Always mounted (core observability, like /v1/uri); authed, read-only.
    {
      try {
        await app.register(require('./routes/system'), { logger, manifest, adapters: resolvedAdapters });
        logger.debug({ event: 'system.mounted' }, 'System surface ready at /v1/system');
      } catch (err) {
        logger.error({ err: err.message }, 'System surface failed to mount');
      }
    }

    // ── WS7 voice→actor binding (PRD-014 Seam B / B3; COM-15 producer) ──────
    // /v1/voice-intent maps a plain-text transcript to an agent intent, un-gates
    // behind a MANDATE (ADR-037 D7, no longer the blanket voice_intent flag), and
    // DISPATCHES a signed kind-31402 toward the scene-selected actor_did. The
    // signed-31402 dispatcher is a thin, lazily-connected closure over a
    // NostrBridge + the agentbox signer (same vendoring pattern as junkiejarvis);
    // when the sovereign bridge or its key is unavailable the dispatcher is
    // undefined and an otherwise-valid request is declined 503 (fail-closed).
    {
      try {
        const dispatchActionRequest = buildVoiceIntentDispatcher(manifest, logger);
        await app.register(require('./routes/voice-intent'), { logger, manifest, dispatchActionRequest });
        logger.debug({ event: 'voice-intent.mounted', dispatch: !!dispatchActionRequest },
          'Voice→actor binding route ready at /v1/voice-intent (mandate-gated)');
      } catch (err) {
        logger.error({ err: err.message }, 'Voice→actor binding route failed to mount');
      }
    }

    // ── WS6 personal-KG → proposal extractor (PRD-014 Seam D / D2) ───────────
    // /v1/kg-elevation/scan reads the personal KG via the memory adapter slot,
    // emits agent_action LINK beams, and returns governed ontology-propose
    // descriptors. Gated by [sovereign_mesh].kg_elevation (route self-gates).
    {
      try {
        await app.register(require('./routes/kg-elevation'), { logger, manifest });
        const on = (manifest.sovereign_mesh || {}).kg_elevation === true;
        logger.debug({ event: 'kg-elevation.mounted', enabled: on }, 'Personal-KG elevation route ready at /v1/kg-elevation/scan');
      } catch (err) {
        logger.error({ err: err.message }, 'Personal-KG elevation route failed to mount');
      }
    }

    // ── Project tracking (PRD-017 / ADR-035 / DDD-015) ──────────────────────
    // Scans workspace/host-mount git repos, mints `thing` URNs, emits the
    // agentbox_project_* gauges on the port-bound /metrics, and (when enabled)
    // publishes per-project kind-30841 digests to the operator's did:nostr.
    // Mounted unconditionally; the route self-gates 503 when
    // [project_tracking].enabled is not true. The scheduler only arms when on.
    {
      const ptCfg = (manifest.project_tracking) || {};
      try {
        const primer = new PrimerGenerator({
          logger,
          manifest,
          memoryAdapter: resolvedAdapters ? resolvedAdapters.memory : null,
        });
        const tracker = new ProjectTracker({
          logger,
          manifest,
          adapters: resolvedAdapters,
          primer,
          metrics: projectMetrics,
        });
        app.decorate('projectTracker', tracker);
        await app.register(require('./routes/projects'), { logger, manifest, tracker });

        if (ptCfg.enabled === true) {
          // Best-effort initial scan + scheduler arm. Never blocks boot.
          tracker
            .scan({ githubEnrichment: ptCfg.github_enrichment === true })
            .then((r) => logger.info({ event: 'project-tracking.initial-scan', scanned: r.projects.length, scanUrn: r.scanUrn }, 'Project tracking initial scan complete'))
            .catch((err) => logger.warn({ err: err.message }, 'Project tracking initial scan failed (non-fatal)'));
          tracker.startScheduler();
          app.addHook('onClose', async () => { try { tracker.stopScheduler(); } catch (_) { /* ignore */ } });
          logger.info({
            event: 'project-tracking.mounted',
            enabled: true,
            scan_interval_hours: ptCfg.scan_interval_hours,
            nostr_publish: ptCfg.nostr_publish === true,
            metrics: ptCfg.metrics !== false,
          }, 'Project tracking active at /v1/projects');
        } else {
          logger.debug({ event: 'project-tracking.disabled' }, 'Project tracking disabled (default); /v1/projects returns 503');
        }
      } catch (err) {
        logger.error({ err: err.message }, 'Project tracking failed to mount');
      }
    }

    // ── Multi-tenant did:nostr admin surface (ADR-017 / PRD-007) ────────────
    // Mount /admin/users/* only when [sovereign_mesh.multi_user].enabled = true.
    // Endpoints are 501 Not Implemented stubs in this scaffold pass; bodies
    // land in the follow-on after solid-pod-rs alpha.12 ships.
    {
      const muCfg = (manifest.sovereign_mesh || {}).multi_user || {};
      if (muCfg.enabled === true) {
        try {
          await app.register(require('./routes/admin-users'), { logger });
          logger.info({
            event: 'multi-user.admin-routes-mounted',
            provisioning_policy: muCfg.provisioning_policy || 'closed',
            max_users: muCfg.max_users,
          }, 'Multi-tenant admin routes mounted (stubs return 501; see PRD-007)');
        } catch (err) {
          logger.error({ err: err.message }, 'Multi-tenant admin routes failed to mount');
        }
      } else {
        logger.debug({ event: 'multi-user.disabled' }, 'Multi-tenant pod mode disabled (default); /admin/users/* not mounted');
      }
    }

    // ── Viewer slot (S12, PRD-006 §15) ──────────────────────────────────────
    // Resolves [linked_data.viewer] to a descriptor, mounts /lo/* with a
    // pane manifest endpoint and the bundled linkedobjects/browser bundle.
    // Disabled by default; the route returns 404 in the off case.
    {
      try {
        const { resolveViewerImpl } = require('./middleware/linked-data/viewer');
        const viewer = resolveViewerImpl({ manifest, logger });
        app.decorate('linkedObjectsViewer', viewer);
        await app.register(require('./routes/linked-objects'), { logger, viewer });
        if (viewer.enabled) {
          logger.info({
            event: 'linked-data.viewer-mounted',
            impl: viewer.impl,
            mountPath: viewer.mountPath,
            buildInfo: viewer.buildInfo,
          }, 'Linked-Object Viewer ready');
        }
      } catch (err) {
        logger.error({ err: err.message }, 'Linked-Object Viewer failed to boot');
      }
    }

    // ── x402 well-known discovery route (B1, PRD-015) ──────────────────────
    // Serves /.well-known/x402.json for payment-scheme negotiation.
    // No-ops (404) when payments.broadcast.well_known is false.
    // Auth-skip for this URL is wired in the onRequest hook above.
    {
      try {
        await app.register(require('./routes/well-known'), { manifest, logger });
        const enabled = !!(manifest && manifest.payments && manifest.payments.broadcast && manifest.payments.broadcast.well_known);
        logger.debug({ event: 'well-known.x402-mounted', enabled }, 'x402 well-known route mounted at /.well-known/x402.json');
      } catch (err) {
        logger.error({ err: err.message }, 'x402 well-known route failed to mount');
      }
    }

    // ── Interaction plane: identity binding + approval loop (PRD-021 WS3) ───
    // The authority consumer (ADR-043 D4.7) is the canonical awaitDecision
    // seam: it publishes the gate's kind-31402 to the embedded relay and awaits
    // a Schnorr-verified, allowlisted kind-31403. It is null when the sovereign
    // bridge/relays/signer are unavailable — the shared gate then falls back to
    // the governance-decision waiter (fed by the relay consumer) so behaviour is
    // unchanged where the consumer cannot be wired. Both are decorated so the
    // approvals route (the dashboard signing front door) and broker-bridge pick
    // them up.
    {
      try {
        const authorityConsumer = buildAuthorityConsumer({ manifest, logger });
        const authorityGate = buildAuthorityGate(manifest, {
          logger,
          publishActionRequest: authorityConsumer ? authorityConsumer.publishActionRequest : undefined,
          awaitDecision: authorityConsumer
            ? authorityConsumer.awaitDecision
            : ((signedRequest, opts) => governanceWaiter.awaitDecision(signedRequest, opts)),
          verifyEvent: authorityConsumer ? authorityConsumer.verifyEvent : undefined,
        });
        app.decorate('authorityConsumer', authorityConsumer);
        app.decorate('authorityGate', authorityGate);
        logger.info({ event: 'authority-consumer.boot', wired: !!authorityConsumer },
          `Authority approval loop ${authorityConsumer ? 'wired to the embedded relay' : 'falling back to the governance waiter'}`);
      } catch (err) {
        logger.error({ err: err.message }, 'Authority consumer/gate failed to build (approvals will be inert)');
        app.decorate('authorityConsumer', null);
      }
    }

    // ── Beads work-ledger REST surface (ADR-043 D4.3, PRD-021 F3-3) ─────────
    // Mounts /v1/beads over the beads adapter slot; self-gates 503 when the
    // slot resolves "off" (the running default until the WS3 rebuild flip).
    {
      try {
        await app.register(require('./routes/beads'), { logger });
        const impl = resolvedAdapters && resolvedAdapters.beads ? resolvedAdapters.beads._implName : 'off';
        logger.debug({ event: 'beads.mounted', impl }, 'Beads route ready at /v1/beads');
      } catch (err) {
        logger.error({ err: err.message }, 'Beads route failed to mount');
      }
    }

    // ── Scoped WAC mandate surface (ADR-043 D4.5, PRD-021 F3-5) ─────────────
    {
      try {
        await app.register(require('./routes/mandate'), { logger, manifest });
        logger.debug({ event: 'mandate.mounted' }, 'Mandate route ready at /v1/mandate');
      } catch (err) {
        logger.error({ err: err.message }, 'Mandate route failed to mount');
      }
    }

    // ── AoE session-boundary shim endpoint (ADR-043 D4.1-D4.5, PRD-021 WS3) ─
    {
      try {
        await app.register(require('./routes/sessions-boundary'), { logger, manifest });
        logger.debug({ event: 'sessions-boundary.mounted' }, 'Session-boundary route ready at /v1/sessions/boundary');
      } catch (err) {
        logger.error({ err: err.message }, 'Session-boundary route failed to mount');
      }
    }

    // ── Pending-approvals dashboard surface (ADR-043 D4.7, PRD-021 F3-6) ────
    {
      try {
        await app.register(require('./routes/approvals'), { logger });
        logger.debug({ event: 'approvals.mounted' }, 'Approvals route ready at /v1/approvals');
      } catch (err) {
        logger.error({ err: err.message }, 'Approvals route failed to mount');
      }
    }

    // ── SecurityProfileApplied event (PRD-003 §5.4a) ───────────────────────
    // Emit a structured log describing the resolved security posture so that
    // operators can verify hardening is in effect at startup time.
    {
      const securityCfg = manifest.security || {};
      const securityExceptions = securityCfg.exceptions || {};
      const gpuBackend = manifest.gpu ? (manifest.gpu.backend || 'none') : 'none';
      const desktopEnabled = manifest.desktop ? (manifest.desktop.enabled === true) : false;
      const browserPlaywright = manifest.skills && manifest.skills.browser
        ? (manifest.skills.browser.playwright === true) : false;
      const codeServer = manifest.toolchains
        ? (manifest.toolchains.code_server === true) : false;
      const gaussianSplatting = manifest.skills && manifest.skills.spatial_and_3d
        ? (manifest.skills.spatial_and_3d.gaussian_splatting === true) : false;

      function isExceptionActive(name) {
        switch (name) {
          case 'desktop':            return desktopEnabled;
          case 'gpu-rocm':           return gpuBackend === 'ollama-rocm';
          case 'gpu-cuda':           return gpuBackend === 'ollama-cuda' || gpuBackend === 'local-cuda';
          case 'gaussian-splatting': return gaussianSplatting;
          case 'playwright':         return browserPlaywright;
          case 'code-server':        return codeServer;
          default:                   return false;
        }
      }

      const exceptionsApplied = Object.entries(securityExceptions)
        .filter(([name]) => isExceptionActive(name))
        .map(([feature, delta]) => ({ feature, delta }));

      const baselineTmpfs = ['/tmp', '/run', '/var/run'];
      const exceptionTmpfs    = exceptionsApplied.flatMap(e => e.delta.tmpfs || []);
      const exceptionCapAdd   = exceptionsApplied.flatMap(e => e.delta.cap_add || []);
      const exceptionDevices  = exceptionsApplied.flatMap(e => e.delta.devices || []);
      const exceptionRuntime  = exceptionsApplied.map(e => e.delta.runtime).filter(Boolean).pop() || null;
      const exceptionWritableVolumes = exceptionsApplied.flatMap(e => e.delta.writable_volumes || []);

      const effectiveProfile = {
        user: '1000:1000',
        readOnlyRootFs: true,
        capDrop: ['ALL'],
        capAdd: exceptionCapAdd,
        tmpfs: [...new Set([...baselineTmpfs, ...exceptionTmpfs])],
        devices: exceptionDevices,
        runtime: exceptionRuntime,
        writableVolumes: [
          '/home/devuser/workspace', '/var/lib/ruvector', '/var/lib/solid',
          '/var/lib/agentbox/identities', ...exceptionWritableVolumes
        ]
      };

      logger.info({
        event: 'SecurityProfileApplied',
        baseline: { user: '1000:1000', readOnlyRootFs: true, capDrop: ['ALL'] },
        exceptionsApplied,
        effectiveProfile,
        timestamp: new Date().toISOString()
      }, 'Security profile resolved');
    }

    // ── Connect adapters (10 s total timeout) ───────────────────────────
    const connectOps = SLOTS.map(async (slot) => {
      const adapter = resolvedAdapters[slot];
      if (typeof adapter.connect !== 'function') {
        adapterHealth[slot] = adapter.enabled === false ? 'off' : 'healthy';
        return;
      }
      try {
        await adapter.connect();
        adapterHealth[slot] = 'healthy';
        logger.info({ slot, impl: adapter._implName }, 'Adapter connected');
      } catch (err) {
        if (slot === 'orchestrator') {
          logger.error({ slot, impl: adapter._implName, err: err.message }, 'Orchestrator adapter failed to connect — FATAL');
          process.exit(1);
        }
        logger.warn({ slot, impl: adapter._implName, err: err.message }, 'Adapter connect failed — falling back to off');
        adapterHealth[slot] = 'degraded';
        // Replace with off impl so callers get AdapterDisabled rather than broken state
        try {
          const { resolveAdapters: re } = require('./adapters/index');
          const offManifest = { adapters: { [slot]: 'off' } };
          const offSlot = re(offManifest)[slot];
          offSlot._implName = 'off';
          offSlot._slot = slot;
          resolvedAdapters[slot] = offSlot;
          app.adapters[slot] = offSlot;
        } catch (_) {
          // If even off fails, leave degraded adapter in place
        }
      }
    });

    try {
      await Promise.race([
        Promise.all(connectOps),
        new Promise((_, reject) => setTimeout(() => reject(new Error('connect timeout')), 10000))
      ]);
    } catch (err) {
      if (err.message === 'connect timeout') {
        logger.warn('Adapter connect phase exceeded 10 s — continuing with partially connected adapters');
      } else {
        throw err;
      }
    }

    // ── Nostr relay consumer (PRD-010 F16) ──────────────────────────────
    // Wire the pod-bridge relay consumer after adapters are connected.
    // Only starts when the relay and nostr_bridge are both enabled in the
    // manifest. Env vars are set by flake.nix from [sovereign_mesh.relay].
    if (process.env.AGENTBOX_RELAY_ENABLED === 'true'
        && process.env.AGENTBOX_RELAY_POD_BRIDGE === 'true') {
      try {
        // Vendored into the package lib/ (flake.nix buildPhaseExtra) so the
        // primary require resolves inside the packaged
        // node_modules/agentic-flow-management-api boundary; the bare
        // ../mcp/nostr-bridge/* fallback is for the dev/source tree only.
        // Same escape-the-boundary bug already solved for nostr-bridge /
        // ontology-propose above.
        let RelayConsumer, buildDefaultIntentSpec;
        try { ({ RelayConsumer } = require('./lib/relay-consumer')); }
        catch { ({ RelayConsumer } = require('../mcp/nostr-bridge/relay-consumer')); }
        try { ({ buildDefaultIntentSpec } = require('./lib/default-intent-spec')); }
        catch { ({ buildDefaultIntentSpec } = require('../mcp/nostr-bridge/default-intent-spec')); }
        const npubs = (process.env.AGENTBOX_NPUB || '').split(',').filter(Boolean);
        if (npubs.length > 0) {
          // B3: deterministic responder dispatch for voice-origin agent-intent
          // events. Null when AGENTBOX_INTENT_COMMAND is unset → marker-only
          // (prior behaviour), so wiring is a no-op until the operator opts in.
          const intentSpec = buildDefaultIntentSpec();
          const consumer = new RelayConsumer({
            npubs,
            allowedPubkeys: (process.env.AGENTBOX_RELAY_ALLOWED_PUBKEYS || '').split(',').filter(Boolean),
            ingressPolicy: process.env.AGENTBOX_RELAY_POLICY || 'allowlist',
            fanout: process.env.AGENTBOX_RELAY_FANOUT || 'off',
            ...(intentSpec ? { intentSpec } : {}),
            adapters: {
              events: resolvedAdapters.events || null,
              orchestrator: resolvedAdapters.orchestrator || null,
            },
            // ADR-037 D2: the shared governance-decision waiter so an authority
            // gate (broker-bridge decide route) awaiting a signed 31403 releases
            // off this ONE relay subscription. Same singleton the gated route
            // requires — no second relay client.
            governanceDecisionSink: require('./lib/governance-decision-waiter'),
            logger,
          });
          await consumer.start();
          app.addHook('onClose', async () => { await consumer.stop(); });
          logger.info('RelayConsumer started — pod-bridge active');
        } else {
          logger.warn('RelayConsumer skipped — AGENTBOX_NPUB is empty (sovereign-bootstrap may not have run)');
        }
      } catch (err) {
        logger.warn({ err }, 'RelayConsumer failed to start — pod-bridge inactive');
      }
    }

    // ── JunkieJarvis forum agent (manifest + env gated, fail-open) ──────
    // Rides this always-on process — no supervisor program. Gated by
    // agentbox.toml [sovereign_mesh].junkiejarvis (default false) ANDed with
    // the env var: when JUNKIEJARVIS_ENABLED is explicitly set it remains the
    // runtime override (so existing env-driven deployments keep working);
    // when it is unset the manifest value decides. Reuses NostrBridge for the
    // relay pool; never crashes management-api on any failure.
    const jjEnvRaw = process.env.JUNKIEJARVIS_ENABLED;
    const jjManifestEnabled = !!(manifest
      && manifest.sovereign_mesh
      && manifest.sovereign_mesh.junkiejarvis === true);
    const jjEnabled = (jjEnvRaw !== undefined && jjEnvRaw !== '')
      ? String(jjEnvRaw).toLowerCase() === 'true'
      : jjManifestEnabled;
    if (jjEnabled) {
      try {
        // The bridge is vendored into lib/ at build time (flake buildPhaseExtra
        // copies mcp/servers/nostr-bridge.js → lib/) so it resolves nostr-tools
        // and ws from this package's own node_modules. Fall back to the sibling
        // mcp/ tree when running from the source checkout (dev / standalone).
        let NostrBridge;
        try { ({ NostrBridge } = require('./lib/nostr-bridge')); }
        catch { ({ NostrBridge } = require('../mcp/servers/nostr-bridge')); }
        const { startJunkieJarvis } = require('./lib/junkiejarvis-agent');
        const jjRelays = (process.env.NOSTR_RELAYS || '')
          .split(',').map((r) => r.trim()).filter(Boolean);
        if (jjRelays.length === 0) {
          logger.warn('junkiejarvis: NOSTR_RELAYS is empty — not starting');
        } else {
          const jjBridge = new NostrBridge({ relays: jjRelays });
          await jjBridge.connect();
          const junkiejarvis = startJunkieJarvis({ bridge: jjBridge, logger });
          if (junkiejarvis) {
            app.addHook('onClose', async () => {
              try { junkiejarvis.stop(); } catch (_) { /* ignore */ }
              try { await jjBridge.disconnect(); } catch (_) { /* ignore */ }
            });
          } else {
            try { await jjBridge.disconnect(); } catch (_) { /* ignore */ }
          }
        }
      } catch (err) {
        logger.warn({ err }, 'junkiejarvis failed to start — forum agent inactive (fail-open)');
      }
    }

    // ── Context compression (PRD-016 / ADR-034) ─────────────────────────
    {
      const headroom = require('./lib/headroom');
      const initResult = headroom.init({ logger });
      if (initResult.ok) {
        app.decorate('headroom', headroom);
        logger.info({ event: 'headroom.boot' }, 'Headroom compression active');
      } else {
        app.decorate('headroom', null);
        logger.info({ event: 'headroom.skip', reason: initResult.reason }, 'Headroom compression inactive');
      }
    }

    // ── Observability ───────────────────────────────────────────────────
    initTracing();
    observabilityMetrics.setBuildInfo();
    await startMetricsServer();

    // ── HTTP server ─────────────────────────────────────────────────────
    await app.listen({ port: PORT, host: HOST });
    logger.info(`Management API server listening on http://${HOST}:${PORT}`);
    logger.info('API Key authentication enabled');
    logger.info(`Set MANAGEMENT_API_KEY environment variable to change the API key`);
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

start();
