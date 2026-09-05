'use strict';

/**
 * /v1/briefs — the briefing workflow surface (ADR-2072; closes the server-side
 * gap recorded by VisionClaw ADR-2085).
 *
 * VisionClaw's `src/services/briefing_service.rs` orchestrates a
 * brief → execute → debrief cycle through `ManagementApiClient`
 * (`create_brief` / `execute_brief` / `create_debrief`). Those three calls
 * targeted `/v1/briefs`, `/v1/briefs/:id/execute` and `/v1/briefs/:id/debrief`,
 * none of which existed in agentbox — every `BriefingService` call 404'd. This
 * route is the missing server side. The wire contract below is derived verbatim
 * from the Rust client and is NOT open for redesign here (ADR-2085 §Acceptance
 * test): request bodies are snake_case as the client literally writes them,
 * response envelopes are camelCase (`#[serde(rename_all = "camelCase")]`), and
 * the `RoleTask` elements inside `roleTasks` are snake_case because
 * `crate::types::user_context::RoleTask` carries NO rename attribute.
 *
 *   POST /v1/briefs                    201 — author a brief, optionally open a beads epic
 *   POST /v1/briefs/:brief_id/execute  202 — spawn one role agent per role
 *   POST /v1/briefs/:brief_id/debrief  201 — consolidate role responses into a debrief
 *
 * Durability (ADR-005): every document write goes through the `pods` adapter
 * slot via `fastify.adapters.pods`, so the standard middleware chain
 * (observability → privacy filter → JSON-LD encoder, wired by
 * `adapters/index.js` instrumentAdapter) wraps each write exactly as it does
 * for every other slot consumer. This route opens no second write path and
 * holds no in-memory brief state: the brief record is itself a pod resource at
 * a path deterministically derived from the brief URN, so `execute` and
 * `debrief` recover it by read, and a management-api restart between the three
 * calls is survivable. Work-ledger linkage (epic on create, child per role,
 * close on debrief) goes through the `beads` slot and is best-effort — the
 * beads slot being "off" degrades `beadId` to null, it never fails the brief.
 *
 * Identifiers (ADR-013, N-07): the brief URN is minted through `lib/uris.js`
 * (`kind: 'thing'`, optional owner scope from `user_context.pubkey`). Bead ids
 * are minted inside the beads adapter. Nothing here formats an identifier by
 * hand.
 *
 * Gating (ADR-2041): the execute step spawns agent tasks, which is exactly the
 * side effect `POST /v1/tasks` gates, so it dispatches through the same
 * `lib/action-plane.js` `dispatchTaskSpawn()` seam — classify → guard →
 * protected-executor → journal — and fails CLOSED (503) when the plane has no
 * live events adapter, mirroring routes/tasks.js. `middleware/cost-gate.js` is
 * deliberately NOT attached: its own first guard scopes it to URLs starting
 * `/v1/tasks`, so on `/v1/briefs` it would be an inert decoration implying a
 * spend check that never runs. Per-role spawns still traverse the cost gate's
 * real chokepoint if a future ADR widens that guard.
 *
 * Auth is the global preValidation bearer/NIP-98 hook in server.js — the client
 * sends `Authorization: Bearer <MANAGEMENT_API_KEY>` and needs nothing extra
 * here.
 */

const crypto = require('crypto');
const uris = require('../lib/uris');
const { dispatchTaskSpawn } = require('../lib/action-plane');

/** Pod container under which every brief artefact lives. */
const BRIEFS_ROOT = '/briefs';
/** Container for the machine-readable brief records `execute`/`debrief` read back. */
const RECORDS_CONTAINER = `${BRIEFS_ROOT}/records`;
/** Default provider for spawned role agents (matches routes/tasks.js). */
const DEFAULT_PROVIDER = 'claude-flow';

/** The `user_context` block the Rust client sends on all three calls. */
const userContextSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    user_id: { type: 'string' },
    pubkey: { type: 'string' },
    display_name: { type: 'string' },
    session_id: { type: 'string' },
    is_power_user: { type: 'boolean' },
  },
};

/**
 * One `RoleTask` as the Rust type serialises it. `crate::types::user_context::RoleTask`
 * has no `#[serde(rename_all)]`, so these stay snake_case even though the
 * enclosing `ExecuteBriefResponse` is camelCase. Fastify strips any response
 * property absent from the schema, so this shape is load-bearing.
 */
const roleTaskSchema = {
  type: 'object',
  properties: {
    role: { type: 'string' },
    task_id: { type: 'string' },
    bead_id: { type: ['string', 'null'] },
    response_path: { type: 'string' },
  },
};

function slugify(value, fallback) {
  const s = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return s || fallback;
}

/** Short digest used to make two otherwise identical briefs distinct paths. */
function shortDigest(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex').slice(0, 8);
}

/** 64-char lowercase hex, or null — the only form `uris.mint` accepts as a scope. */
function normalisePubkey(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function utcDate(now) {
  return now.toISOString().slice(0, 10);
}

async function briefingRoutes(fastify, options) {
  const { logger, processManager } = options;

  /** The instrumented pods adapter, or undefined before boot decorates it. */
  function pods() {
    return fastify.adapters && fastify.adapters.pods;
  }

  /** The instrumented beads adapter, or undefined. */
  function beads() {
    return fastify.adapters && fastify.adapters.beads;
  }

  function slotLive(adapter) {
    return !!adapter && adapter._implName !== 'off' && adapter.enabled !== false;
  }

  /**
   * Self-gate on the pods slot: brief documents are the whole point of this
   * surface, so with no document store there is nothing honest to return.
   * Mirrors routes/beads.js's 503 self-gate. Returns true when a reply was sent.
   */
  function podsGated(reply) {
    if (slotLive(pods())) return false;
    reply.code(503).send({
      error: 'briefing disabled',
      message: 'adapters.pods is "off" — no document store is mounted for brief artefacts',
    });
    return true;
  }

  /** Typed adapter error → HTTP reply. Returns true when a reply was sent. */
  function sendAdapterError(reply, err) {
    if (err && (err.name === 'NotFound' || err.code === 'NOT_FOUND')) {
      reply.code(404).send({ error: 'not-found', message: err.message });
      return true;
    }
    if (err && (err.name === 'PermissionDenied' || err.code === 'PERMISSION_DENIED')) {
      reply.code(403).send({ error: 'forbidden', message: err.message });
      return true;
    }
    if (err && (err.name === 'ValidationError' || err.code === 'VALIDATION_ERROR')) {
      reply.code(400).send({ error: 'validation', message: err.message });
      return true;
    }
    if (err && err.name === 'AdapterDisabled') {
      reply.code(503).send({ error: 'briefing disabled', message: err.message });
      return true;
    }
    return false;
  }

  /** Pod path of the machine-readable record for a brief URN, or null if not ours. */
  function recordPathFor(briefId) {
    const parsed = uris.parse(briefId);
    if (!parsed || parsed.scheme !== 'urn' || parsed.kind !== 'thing') return null;
    if (!/^brief-/.test(parsed.local)) return null;
    return `${RECORDS_CONTAINER}/${parsed.local}.json`;
  }

  /**
   * Read a brief record back out of the pod. Returns the parsed record, or
   * null when the brief id is unknown/not a brief URN (→ the caller 404s).
   */
  async function loadRecord(briefId) {
    const path = recordPathFor(briefId);
    if (!path) return null;
    let res;
    try {
      res = await pods().read(path);
    } catch (err) {
      if (err && (err.name === 'NotFound' || err.code === 'NOT_FOUND')) return null;
      throw err;
    }
    try {
      return JSON.parse(typeof res === 'string' ? res : res.body);
    } catch (err) {
      const e = new Error(`brief record at ${path} is not valid JSON: ${err.message}`);
      e.name = 'ValidationError';
      throw e;
    }
  }

  async function saveRecord(record) {
    await pods().write(`${RECORDS_CONTAINER}/${record.localId}.json`, JSON.stringify(record, null, 2), 'application/json');
  }

  // ── POST /v1/briefs — author a brief ──────────────────────────────────────
  fastify.post('/v1/briefs', {
    schema: {
      description: 'Author a brief document and (when the beads slot is live) open a work-ledger epic for it',
      tags: ['briefing'],
      body: {
        type: 'object',
        required: ['content', 'roles', 'user_context'],
        additionalProperties: true,
        properties: {
          content: { type: 'string', minLength: 1 },
          roles: { type: 'array', items: { type: 'string' }, minItems: 1 },
          user_context: userContextSchema,
          version: { type: 'string' },
          brief_type: { type: 'string' },
          slug: { type: 'string' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            briefId: { type: 'string' },
            briefPath: { type: 'string' },
            beadId: { type: ['string', 'null'] },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (podsGated(reply)) return;

    const body = request.body;
    const userContext = body.user_context || {};
    const roles = body.roles;
    const now = new Date();
    const date = utcDate(now);
    const pubkey = normalisePubkey(userContext.pubkey);

    const slug = slugify(body.slug || body.content, 'brief');
    const digest = shortDigest({
      content: body.content,
      roles,
      user_id: userContext.user_id || null,
      session_id: userContext.session_id || null,
      at: now.toISOString(),
    });
    const folder = `${slug}-${digest}`;
    const localId = `brief-${date}-${folder}`;

    // ADR-013: minted, never formatted by hand. `thing` carries an optional
    // owner scope, so a brief authored by an identified user is scoped to their
    // pubkey and an anonymous one mints the unscoped form rather than a fake scope.
    const briefId = uris.mint({ kind: 'thing', pubkey: pubkey || undefined, localId });

    const dir = `${BRIEFS_ROOT}/${date}/${folder}`;
    const briefPath = `${dir}/brief.md`;

    const frontMatter = [
      '---',
      `brief_id: ${briefId}`,
      `created_at: ${now.toISOString()}`,
      `author: ${userContext.display_name || userContext.user_id || 'unknown'}`,
      `author_pubkey: ${pubkey || 'none'}`,
      `session_id: ${userContext.session_id || 'none'}`,
      `roles: [${roles.join(', ')}]`,
      `version: ${body.version || '1'}`,
      `brief_type: ${body.brief_type || 'general'}`,
      '---',
      '',
    ].join('\n');

    let beadId = null;
    try {
      await pods().write(briefPath, `${frontMatter}${body.content}\n`, 'text/markdown');
    } catch (err) {
      if (sendAdapterError(reply, err)) return;
      throw err;
    }

    // Work-ledger epic: best-effort by design. A brief is a durable document
    // first; the beads slot resolving "off" (or refusing the epic) must degrade
    // beadId to null, never fail an otherwise-written brief.
    if (slotLive(beads())) {
      try {
        const epic = await beads().createEpic({
          title: `brief: ${slug}`,
          actor: pubkey || undefined,
          tags: ['brief', ...roles],
        });
        beadId = (epic && epic.id) || null;
      } catch (err) {
        logger.warn({ event: 'briefing.epic-failed', briefId, err: err.message },
          'Beads epic could not be opened for this brief — continuing with beadId=null');
      }
    }

    const record = {
      localId,
      briefId,
      briefPath,
      dir,
      slug,
      roles,
      beadId,
      version: body.version || null,
      briefType: body.brief_type || null,
      createdAt: now.toISOString(),
      createdBy: {
        user_id: userContext.user_id || null,
        pubkey: pubkey,
        display_name: userContext.display_name || null,
        session_id: userContext.session_id || null,
      },
      roleTasks: [],
      debriefPath: null,
    };

    try {
      await saveRecord(record);
    } catch (err) {
      if (sendAdapterError(reply, err)) return;
      throw err;
    }

    logger.info({ event: 'briefing.created', briefId, briefPath, beadId, roles }, 'Brief created');
    reply.code(201).send({ briefId, briefPath, beadId });
  });

  // ── POST /v1/briefs/:brief_id/execute — spawn one agent per role ──────────
  fastify.post('/v1/briefs/:brief_id/execute', {
    schema: {
      description: 'Spawn one role agent per requested role, through the ADR-2041 action pipeline',
      tags: ['briefing'],
      params: {
        type: 'object',
        properties: { brief_id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['brief_path', 'roles', 'user_context'],
        additionalProperties: true,
        properties: {
          brief_path: { type: 'string' },
          roles: { type: 'array', items: { type: 'string' }, minItems: 1 },
          user_context: userContextSchema,
          epic_bead_id: { type: 'string' },
        },
      },
      response: {
        202: {
          type: 'object',
          properties: {
            briefId: { type: 'string' },
            roleTasks: { type: 'array', items: roleTaskSchema },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (podsGated(reply)) return;

    const briefId = request.params.brief_id;
    const body = request.body;
    const userContext = body.user_context || {};
    const pubkey = normalisePubkey(userContext.pubkey);

    let record;
    try {
      record = await loadRecord(briefId);
    } catch (err) {
      if (sendAdapterError(reply, err)) return;
      throw err;
    }
    if (!record) {
      return reply.code(404).send({ error: 'not-found', message: `Brief ${briefId} not found` });
    }

    // The client echoes back the brief_path it was handed at create. A mismatch
    // means client-side desync, not a server error: the record is authoritative
    // (it is what `debrief` will consolidate against), so proceed with it and
    // say so rather than silently trusting caller-supplied storage paths.
    if (body.brief_path && body.brief_path !== record.briefPath) {
      logger.warn({ event: 'briefing.path-mismatch', briefId, supplied: body.brief_path, authoritative: record.briefPath },
        'execute brief_path does not match the stored record — using the stored path');
    }

    const epicBeadId = body.epic_bead_id || record.beadId || null;
    const roleTasks = [];

    for (const role of body.roles) {
      const roleSlug = slugify(role, 'role');
      const responsePath = `${record.dir}/responses/${roleSlug}.md`;

      // ADR-2041: a role agent is a task spawn, so it goes through the same
      // classify → guard → protected-executor → journal pipeline as
      // POST /v1/tasks. The spawn happens inside the executor seam, never here.
      let result;
      try {
        result = await dispatchTaskSpawn(
          {
            agent: role,
            task:
              `Read the brief at ${record.briefPath} and respond as the "${role}" role. ` +
              `Write your response to ${responsePath}. ` +
              `Brief ${briefId} was raised by ${record.createdBy.display_name || record.createdBy.user_id || 'an unidentified user'}.`,
            provider: DEFAULT_PROVIDER,
            claude_flow_agent_id: null,
            request,
          },
          { processManager, logger },
        );
      } catch (err) {
        logger.error({ event: 'briefing.spawn-failed', briefId, role, err: err.message }, 'Failed to spawn role agent');
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: `Failed to spawn the "${role}" role agent`,
          details: err.message,
          spawned: roleTasks,
        });
      }

      if (!result.ready) {
        // Fail closed, identically to routes/tasks.js: no events adapter means
        // no ADR-057 journal, and an agent-initiated side effect must never
        // proceed unjournalled.
        logger.error({ event: 'briefing.action-plane-down', briefId, reason: result.reason },
          'Action plane unavailable — refusing to spawn role agents unjournalled');
        return reply.code(503).send({
          error: 'Service Unavailable',
          message: 'Brief execution is not available: the execution journal has no events adapter',
          details: result.reason,
        });
      }

      if (result.decision === 'denied') {
        return reply.code(403).send({
          error: 'Forbidden',
          message: `Spawning the "${role}" role agent was denied by the action pipeline`,
          reason: result.denyReason,
          spawned: roleTasks,
        });
      }

      let roleBeadId = null;
      if (epicBeadId && slotLive(beads())) {
        try {
          const child = await beads().createChild({
            parent_id: epicBeadId,
            title: `${role}: ${record.slug}`,
            actor: pubkey || undefined,
            tags: ['brief-role', role],
          });
          roleBeadId = (child && child.id) || null;
        } catch (err) {
          logger.warn({ event: 'briefing.child-bead-failed', briefId, role, err: err.message },
            'Child bead could not be opened for this role — continuing with bead_id=null');
        }
      }

      roleTasks.push({
        role,
        task_id: result.output.taskId,
        bead_id: roleBeadId,
        response_path: responsePath,
      });
    }

    record.roleTasks = roleTasks;
    record.executedAt = new Date().toISOString();
    try {
      await saveRecord(record);
    } catch (err) {
      // The agents are already running; losing the record update would strand
      // the debrief step, so this is a real failure, not a best-effort write.
      if (sendAdapterError(reply, err)) return;
      throw err;
    }

    logger.info({ event: 'briefing.executed', briefId, roles: body.roles, count: roleTasks.length },
      'Brief executed — role agents spawned');
    reply.code(202).send({ briefId, roleTasks });
  });

  // ── POST /v1/briefs/:brief_id/debrief — consolidate role responses ────────
  fastify.post('/v1/briefs/:brief_id/debrief', {
    schema: {
      description: 'Consolidate the role responses for a brief into a single debrief document',
      tags: ['briefing'],
      params: {
        type: 'object',
        properties: { brief_id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['role_responses', 'user_context'],
        additionalProperties: true,
        properties: {
          role_responses: {
            type: 'array',
            items: {
              type: 'object',
              required: ['role'],
              additionalProperties: true,
              properties: {
                role: { type: 'string' },
                responsePath: { type: 'string' },
                taskId: { type: 'string' },
                status: { type: 'string', enum: ['completed', 'pending'] },
              },
            },
          },
          user_context: userContextSchema,
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            debriefPath: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (podsGated(reply)) return;

    const briefId = request.params.brief_id;
    const body = request.body;
    const userContext = body.user_context || {};

    let record;
    try {
      record = await loadRecord(briefId);
    } catch (err) {
      if (sendAdapterError(reply, err)) return;
      throw err;
    }
    if (!record) {
      return reply.code(404).send({ error: 'not-found', message: `Brief ${briefId} not found` });
    }

    const now = new Date();
    const debriefPath = `${record.dir}/debrief.md`;
    const responses = body.role_responses || [];

    // The debrief is an index over the role responses, not a copy of them: it
    // records what each role was asked, where its answer lives, and whether the
    // role had actually completed at consolidation time. Reporting a "pending"
    // role as delivered would be the one dishonest thing this document could do.
    const lines = [
      '---',
      `brief_id: ${briefId}`,
      `brief_path: ${record.briefPath}`,
      `debriefed_at: ${now.toISOString()}`,
      `debriefed_by: ${userContext.display_name || userContext.user_id || 'unknown'}`,
      `roles_total: ${responses.length}`,
      `roles_completed: ${responses.filter((r) => r.status === 'completed').length}`,
      '---',
      '',
      `# Debrief — ${record.slug}`,
      '',
      `Consolidates ${responses.length} role response(s) for [brief](${record.briefPath}).`,
      '',
      '| Role | Status | Task | Response |',
      '| --- | --- | --- | --- |',
    ];
    for (const r of responses) {
      lines.push(`| ${r.role} | ${r.status || 'unknown'} | ${r.taskId || '—'} | ${r.responsePath || '—'} |`);
    }
    const pending = responses.filter((r) => r.status !== 'completed');
    if (pending.length > 0) {
      lines.push('', `> ${pending.length} role(s) had not completed when this debrief was consolidated: ` +
        `${pending.map((r) => r.role).join(', ')}.`);
    }
    lines.push('');

    try {
      await pods().write(debriefPath, lines.join('\n'), 'text/markdown');
    } catch (err) {
      if (sendAdapterError(reply, err)) return;
      throw err;
    }

    record.debriefPath = debriefPath;
    record.debriefedAt = now.toISOString();
    record.roleResponses = responses;
    try {
      await saveRecord(record);
    } catch (err) {
      if (sendAdapterError(reply, err)) return;
      throw err;
    }

    // Close the work-ledger epic — best-effort, same rule as opening it.
    if (record.beadId && slotLive(beads())) {
      try {
        await beads().close(record.beadId, pending.length === 0 ? 'debriefed' : 'debriefed-partial');
      } catch (err) {
        logger.warn({ event: 'briefing.epic-close-failed', briefId, err: err.message },
          'Beads epic could not be closed for this brief — debrief stands regardless');
      }
    }

    logger.info({ event: 'briefing.debriefed', briefId, debriefPath, roles: responses.length }, 'Debrief created');
    reply.code(201).send({ debriefPath });
  });
}

module.exports = briefingRoutes;
