/**
 * Sovereign Project Tracking Routes
 *
 * helm-grade project tracking re-expressed on agentbox's sovereign substrate:
 * canonical URNs (ADR-013), port-bound Prometheus telemetry (ADR-005), and the
 * custom-kind nostr mesh (kind-30841, ADR-035). Read-mostly observability over
 * tracked git repositories — list, detail, 30-day commit activity, on-demand
 * scan, AI primer/synopsis generation, and a signed kind-30841 digest publish.
 *
 * Refs: PRD-017 (sovereign project tracking), ADR-035 (telemetry + nostr kind),
 *       DDD-015 (project-tracking domain).
 *
 * Routes:
 *   GET  /v1/projects              list (JSON; JSON-LD when Accept ld+json & [linked_data] on)
 *   GET  /v1/projects/:id          detail
 *   GET  /v1/projects/:id/activity 30-day commit activity
 *   POST /v1/projects/scan         trigger a scan
 *   POST /v1/projects/:id/primer   generate/regenerate the AI primer (body {force})
 *   POST /v1/projects/:id/publish  publish a kind-30841 tracking digest (shell bridge)
 *
 * Self-gates: every handler returns 503 {error:'project_tracking disabled'}
 * unless manifest.project_tracking.enabled === true.
 */

const path = require('path');
const { spawn } = require('child_process');

const PUBLISH_HOOK = path.resolve(__dirname, '..', '..', 'config', 'hooks', 'project-tracking-publish.cjs');

/**
 * Build the ProjectTrackingDigest passed to the publish bridge on stdin.
 * Mirrors the kind-30841 content contract (ADR-035): slug-addressed, public
 * fields only, never absolute host paths.
 */
function projectDigest(project) {
  return {
    slug: project.name,
    name: project.name,
    synopsis: project.synopsis || null,
    language: project.language || null,
    remote: project.remote || null,
    branch: project.branch || null,
    lastCommitIso: project.lastCommitIso || null,
    commits30d: project.commits30d || 0,
    openIssues: project.openIssues ?? null,
    stars: project.stars ?? null,
    primerStatus: project.primerStatus || 'none',
    urn: project.urn,
    ownerDid: project.ownerDid
  };
}

async function projectsRoutes(fastify, options) {
  const { logger, manifest, tracker } = options;

  /**
   * Self-gate helper. Returns true and sends a 503 when project tracking is
   * disabled in the manifest; handlers bail out immediately on a true return.
   */
  function gated(reply) {
    if ((manifest.project_tracking || {}).enabled !== true) {
      reply.code(503).send({ error: 'project_tracking disabled' });
      return true;
    }
    return false;
  }

  const projectSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      urn: { type: 'string' },
      ownerDid: { type: 'string' },
      name: { type: 'string' },
      path: { type: 'string' },
      source: { type: 'string' },
      remote: { type: ['string', 'null'] },
      branch: { type: ['string', 'null'] },
      language: { type: ['string', 'null'] },
      lastCommitIso: { type: ['string', 'null'] },
      lastCommitAgeSec: { type: ['number', 'null'] },
      commits30d: { type: 'integer' },
      commitDays: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string' },
            count: { type: 'integer' }
          }
        }
      },
      openIssues: { type: ['integer', 'null'] },
      stars: { type: ['integer', 'null'] },
      primerStatus: { type: 'string' },
      primerUrn: { type: ['string', 'null'] },
      scannedAt: { type: ['string', 'null'] }
    }
  };

  /**
   * GET /v1/projects - List tracked projects.
   * Returns JSON-LD ({"@context", "@graph"}) when the client accepts
   * application/ld+json and [linked_data] is enabled; plain JSON otherwise.
   */
  fastify.get('/v1/projects', {
    schema: {
      description: 'List tracked projects',
      tags: ['projects'],
      response: {
        200: {
          type: 'object',
          properties: {
            projects: { type: 'array', items: projectSchema },
            count: { type: 'integer' },
            timestamp: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    if (gated(reply)) return;

    const projects = tracker.list();
    const wantsLd = (request.headers.accept || '').includes('application/ld+json');
    const ldOn = (manifest.linked_data || {}).enabled === true;

    if (wantsLd && ldOn) {
      reply.type('application/ld+json').send({
        '@context': 'https://schema.org',
        '@graph': projects.map((p) => tracker.toJsonLd(p))
      });
      return;
    }

    reply.send({
      projects,
      count: projects.length,
      timestamp: new Date().toISOString()
    });
  });

  /**
   * GET /v1/projects/:id - Tracked project detail.
   */
  fastify.get('/v1/projects/:id', {
    schema: {
      description: 'Get a tracked project by id',
      tags: ['projects'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
      },
      response: {
        200: projectSchema,
        404: {
          type: 'object',
          properties: { error: { type: 'string' } }
        }
      }
    }
  }, async (request, reply) => {
    if (gated(reply)) return;

    const project = tracker.get(request.params.id);
    if (!project) {
      reply.code(404).send({ error: 'project not found' });
      return;
    }

    const wantsLd = (request.headers.accept || '').includes('application/ld+json');
    const ldOn = (manifest.linked_data || {}).enabled === true;
    if (wantsLd && ldOn) {
      reply.type('application/ld+json').send(tracker.toJsonLd(project));
      return;
    }

    reply.send(project);
  });

  /**
   * GET /v1/projects/:id/activity - 30-day commit activity for a project.
   */
  fastify.get('/v1/projects/:id/activity', {
    schema: {
      description: 'Get 30-day commit activity for a tracked project',
      tags: ['projects'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            project: { type: 'string' },
            window: { type: 'string' },
            days: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  date: { type: 'string' },
                  count: { type: 'integer' }
                }
              }
            }
          }
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } }
        }
      }
    }
  }, async (request, reply) => {
    if (gated(reply)) return;

    const activity = tracker.activity(request.params.id);
    if (!activity) {
      reply.code(404).send({ error: 'project not found' });
      return;
    }

    reply.send(activity);
  });

  /**
   * POST /v1/projects/scan - Trigger a scan of the configured scan_dirs.
   */
  fastify.post('/v1/projects/scan', {
    schema: {
      description: 'Trigger a scan of tracked project directories',
      tags: ['projects'],
      body: {
        type: 'object',
        properties: {
          dirs: { type: 'array', items: { type: 'string' } },
          githubEnrichment: { type: 'boolean' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            scanned: { type: 'integer' },
            scanUrn: { type: 'string' },
            durationMs: { type: 'number' }
          }
        }
      }
    }
  }, async (request, reply) => {
    if (gated(reply)) return;

    const body = request.body || {};
    const result = await tracker.scan({
      dirs: body.dirs,
      githubEnrichment: body.githubEnrichment
    });

    reply.send({
      scanned: result.projects.length,
      scanUrn: result.scanUrn,
      durationMs: result.durationMs
    });
  });

  /**
   * POST /v1/projects/:id/primer - Generate (or regenerate) the AI primer.
   */
  fastify.post('/v1/projects/:id/primer', {
    schema: {
      description: 'Generate or regenerate the AI primer/synopsis for a project',
      tags: ['projects'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
      },
      body: {
        type: 'object',
        properties: { force: { type: 'boolean', default: false } }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            primer: { type: ['string', 'null'] },
            synopsis: { type: ['string', 'null'] },
            urn: { type: ['string', 'null'] }
          }
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } }
        }
      }
    }
  }, async (request, reply) => {
    if (gated(reply)) return;

    if (!tracker.get(request.params.id)) {
      reply.code(404).send({ error: 'project not found' });
      return;
    }

    const force = !!(request.body && request.body.force);
    const result = await tracker.generatePrimer(request.params.id, { force });

    reply.send({
      primer: result.primer,
      synopsis: result.synopsis,
      urn: result.urn
    });
  });

  /**
   * POST /v1/projects/:id/publish - Publish a kind-30841 tracking digest.
   * Spawns config/hooks/project-tracking-publish.cjs, passing the project
   * digest on stdin (mirrors the nostr-session-summary publish path). When
   * [project_tracking].nostr_publish is off, returns {published:false} with a
   * note rather than spawning — fail-open per the optional-egress rule.
   */
  fastify.post('/v1/projects/:id/publish', {
    schema: {
      description: 'Publish a kind-30841 project tracking digest to the nostr mesh',
      tags: ['projects'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            published: { type: 'boolean' },
            note: { type: 'string' },
            urn: { type: 'string' }
          }
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } }
        }
      }
    }
  }, async (request, reply) => {
    if (gated(reply)) return;

    const project = tracker.get(request.params.id);
    if (!project) {
      reply.code(404).send({ error: 'project not found' });
      return;
    }

    if ((manifest.project_tracking || {}).nostr_publish !== true) {
      reply.send({
        published: false,
        note: 'nostr_publish disabled in [project_tracking]',
        urn: project.urn
      });
      return;
    }

    const digest = projectDigest(project);
    const published = await new Promise((resolve) => {
      let child;
      try {
        child = spawn('node', [PUBLISH_HOOK], {
          stdio: ['pipe', 'ignore', 'pipe'],
          env: process.env
        });
      } catch (err) {
        logger.warn(`project publish spawn failed: ${err.message}`);
        resolve(false);
        return;
      }

      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (err) => {
        logger.warn(`project publish hook error: ${err.message}`);
        resolve(false);
      });
      child.on('close', (code) => {
        if (code !== 0) {
          logger.warn(`project publish hook exited ${code}: ${stderr.trim()}`);
        }
        resolve(code === 0);
      });

      try {
        child.stdin.write(JSON.stringify(digest));
        child.stdin.end();
      } catch (err) {
        logger.warn(`project publish stdin write failed: ${err.message}`);
        resolve(false);
      }
    });

    reply.send({ published, urn: project.urn });
  });
}

module.exports = projectsRoutes;
