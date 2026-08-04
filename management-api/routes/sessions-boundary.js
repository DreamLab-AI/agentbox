'use strict';

/**
 * POST /v1/sessions/boundary — the AoE session-lifecycle → sovereign-identity
 * anti-corruption seam (ADR-043 D4.1/D4.2/D4.3/D4.4/D4.5, PRD-021 WS3,
 * DDD-019 §ManagedSession + §Anti-Corruption Layer).
 *
 * Agent of Empires owns the raw session lifecycle; it has no notion of a user,
 * did, pubkey, or namespace. This route is the shim AoE's `[status_hooks]`
 * invoke on a status transition (via scripts/aoe-session-boundary.cjs). It
 * turns an AoE session into a `ManagedSession` by binding, at the boundary, the
 * mechanisms agentbox already owns — inventing nothing (mesh-identityGap §5):
 *
 *   phase=create →  loadOrMint a per-session did:nostr keyed on the session
 *                   profile (agent-identity.js), mint a session URN
 *                   (urn:agentbox:activity:<pubkey>:… via lib/uris.js),
 *                   open one beads epic (createEpic), derive the project-scoped
 *                   memory namespace user:<pubkey>:proj:<repo-slug>, and — when
 *                   the seed carries eager_mandate — mint a scoped WAC mandate.
 *   phase=turn   →  createChild + claim a work unit under the session epic.
 *   phase=close  →  close the session epic with an outcome.
 *
 * Idempotent on the AoE session id (DDD-019 I07): re-materialising a create
 * returns the same ManagedSession and does not open a duplicate epic. Every
 * durable identifier is minted through lib/uris.js (I02, ADR-013); ad-hoc URN
 * construction is prohibited. Fail-open: a missing/off beads slot or an
 * unavailable mandate signer degrades to a note, never a 5xx that would stall
 * the AoE hook.
 *
 * Auth is the global NIP-98/bearer onRequest hook — the shim presents the
 * MANAGEMENT_API_KEY bearer.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const uris = require('../lib/uris');
const agentIdentity = require('../lib/agent-identity');
const { ensureMandate } = require('./mandate');

// ── Session registry (durable, keyed by AoE session id) ──────────────────────

function _stateDir() {
  return process.env.AGENTBOX_STATE_DIR || '/var/lib/agentbox';
}

function _sessionsDir() {
  return path.join(_stateDir(), 'sessions');
}

// Finding 5: the record filename is the SHA-256 hex of the AoE session id, not a
// character-sanitised form of it. The old _safeId() collapsed every character
// outside [A-Za-z0-9._-] to '_' and truncated to 128 chars, so distinct ids
// (e.g. "a/b" and "a_b", or two long ids sharing a 128-char prefix) mapped to
// ONE file — one session silently overwriting another's identity record. A hash
// is injective for our purposes and yields a fixed-length, path-safe name. The
// ORIGINAL id is preserved inside the record (`record.session_id`).
function _hashId(id) {
  return crypto.createHash('sha256').update(String(id == null ? '' : id)).digest('hex');
}

// Legacy (pre-Finding-5) filename, retained ONLY so records written by an
// earlier build remain readable across the upgrade. Never written any more.
function _legacyId(id) {
  return String(id || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128) || 'unknown';
}

function _recordPath(sessionId) {
  return path.join(_sessionsDir(), `${_hashId(sessionId)}.json`);
}

function _legacyRecordPath(sessionId) {
  return path.join(_sessionsDir(), `${_legacyId(sessionId)}.json`);
}

function _readRecord(sessionId) {
  // Prefer the canonical hashed path; fall back to a legacy file so existing
  // sessions keep resolving until their next write migrates them.
  try {
    return JSON.parse(fs.readFileSync(_recordPath(sessionId), 'utf8'));
  } catch (_) { /* fall through to legacy */ }
  try {
    return JSON.parse(fs.readFileSync(_legacyRecordPath(sessionId), 'utf8'));
  } catch (_) {
    return null;
  }
}

function _writeRecord(sessionId, record) {
  // Atomic + private: write to a unique temp file with mode 0600, then rename
  // into place (rename is atomic within a directory, so a concurrent reader
  // never sees a half-written record). Migrate off any legacy-named file.
  const dir = _sessionsDir();
  const finalPath = _recordPath(sessionId);
  const tmpPath = path.join(dir, `.${_hashId(sessionId)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, finalPath);
    // writeFileSync honours `mode` only when creating the file; enforce 0600 in
    // case the temp file pre-existed with a looser umask-derived mode.
    try { fs.chmodSync(finalPath, 0o600); } catch (_) { /* best-effort */ }
    const legacyPath = _legacyRecordPath(sessionId);
    if (legacyPath !== finalPath) {
      try { fs.unlinkSync(legacyPath); } catch (_) { /* no legacy file — fine */ }
    }
    return true;
  } catch (_) {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* temp may not exist */ }
    return false;
  }
}

/** Slugify a repo/project identifier for the memory namespace project axis. */
function _repoSlug(body) {
  const raw = body.repo_slug
    || (body.project_path ? path.basename(String(body.project_path).replace(/\/+$/, '')) : '')
    || body.slug
    || 'workspace';
  return String(raw).toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'workspace';
}

/** The session profile → AGENTBOX_PROFILE for did derivation (falls back to id). */
function _profile(body) {
  return String(body.slug || body.profile || body.session_id || 'default');
}

function _operatorPubkey() {
  return process.env.AGENTBOX_X_ONLY_PUBKEY_HEX || process.env.AGENTBOX_PUBKEY || '';
}

async function sessionsBoundaryRoutes(fastify, options) {
  const { logger } = options;
  const manifest = options.manifest || {};

  function beadsSlot() {
    const b = fastify.adapters && fastify.adapters.beads;
    if (!b || b._implName === 'off' || b.enabled === false) return null;
    return b;
  }

  const bundleSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {
      phase: { type: 'string' },
      session_id: { type: 'string' },
      slug: { type: 'string' },
      did: { type: ['string', 'null'] },
      pubkey: { type: ['string', 'null'] },
      multikey: { type: ['string', 'null'] },
      session_urn: { type: ['string', 'null'] },
      epic_urn: { type: ['string', 'null'] },
      memory_namespace: { type: ['string', 'null'] },
      repo_slug: { type: ['string', 'null'] },
      mandate_urn: { type: ['string', 'null'] },
      child_urn: { type: ['string', 'null'] },
      persisted: { type: 'boolean' },
      minted: { type: 'boolean' },
      reused: { type: 'boolean' },
      notes: { type: 'array', items: { type: 'string' } },
    },
  };

  fastify.post('/v1/sessions/boundary', {
    schema: {
      description: 'AoE session-lifecycle callback: bind did:nostr + URN + beads epic + memory namespace (+ eager mandate) at the session boundary',
      tags: ['interaction-plane'],
      body: {
        type: 'object',
        required: ['phase', 'session_id'],
        properties: {
          phase:         { type: 'string', enum: ['create', 'turn', 'close'] },
          session_id:    { type: 'string' },
          slug:          { type: 'string' },
          profile:       { type: 'string' },
          tool:          { type: 'string' },
          worktree:      {},
          project_path:  { type: 'string' },
          repo_slug:     { type: 'string' },
          eager_mandate: { type: 'boolean' },
          mandate_container: { type: 'string' },
          outcome:       { type: 'string' },
          turn_title:    { type: 'string' },
          old_status:    { type: 'string' },
          new_status:    { type: 'string' },
          changed_at:    { type: 'string' },
        },
      },
      response: {
        200: bundleSchema,
        201: bundleSchema,
        500: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const body = request.body || {};
    const { phase, session_id: sessionId } = body;
    const notes = [];

    // ── phase=create ─────────────────────────────────────────────────────
    if (phase === 'create') {
      // Idempotent on the AoE session id (DDD-019 I07): return the existing
      // ManagedSession without opening a duplicate epic.
      const existing = _readRecord(sessionId);
      if (existing && existing.did) {
        return reply.send({ ...existing, phase, reused: true, notes: ['session already materialised'] });
      }

      const profile = _profile(body);
      // I01: derive the session's persisted did:nostr from AGENTBOX_PROFILE.
      const identity = agentIdentity.loadOrMint({ profile });
      if (!identity || !identity.pubkey) {
        logger.error({ session_id: sessionId, profile }, 'sessions-boundary: could not derive a did:nostr for the session');
        return reply.code(500).send({ error: 'identity_mint_failed', message: 'could not derive a did:nostr for the session' });
      }
      if (!identity.persisted) notes.push('did:nostr not persisted (run-scoped) — keyfile write failed');

      const startedAt = body.changed_at || new Date().toISOString();

      // I02: mint the session URN through lib/uris.js against the content-
      // addressed, owner-scoped `activity` kind. The scope is the SESSION did
      // pubkey; the content address is derived over the session-create inputs.
      // (The DDD's `session-<sha256-12>` local reads as the content address the
      // minter produces for this kind — ad-hoc construction stays prohibited.)
      let sessionUrn = null;
      try {
        sessionUrn = uris.mint({
          kind: 'activity',
          pubkey: identity.pubkey,
          payload: { type: 'aoe-session', session_id: sessionId, tool: body.tool || null, profile, worktree: body.worktree ?? null, started_at: startedAt },
        });
      } catch (err) {
        notes.push(`session URN mint failed: ${err.message}`);
        logger.warn({ err: err.message, session_id: sessionId }, 'sessions-boundary: session URN mint failed');
      }

      // Beads epic (one per session, DDD-019 I07). Fail-open when the slot is
      // off (the running default until the WS3 rebuild-class flip).
      let epicUrn = null;
      const beads = beadsSlot();
      if (beads) {
        try {
          const epic = await beads.createEpic({
            title: `session:${profile}`,
            actor: identity.pubkey,
            tags: ['aoe-session', sessionId],
          });
          epicUrn = epic.id;
        } catch (err) {
          notes.push(`beads epic create failed: ${err.message}`);
          logger.warn({ err: err.message, session_id: sessionId }, 'sessions-boundary: beads epic create failed');
        }
      } else {
        notes.push('beads slot off — no epic opened');
      }

      // Project-scoped memory namespace prefix (D4.4). The per-request `:ns`
      // suffix is appended by routes/memory.js _effectiveNamespace; this is the
      // session's namespace root that isolates it from other sessions.
      const repoSlug = _repoSlug(body);
      const memoryNamespace = `user:${identity.pubkey}:proj:${repoSlug}`;

      // Eager mandate (D4.5): only for seeds flagged eager_mandate=true. Lazy
      // (first-pod-write) minting is the default and lives on the pods path via
      // routes/mandate.js ensureMandate.
      let mandateUrn = null;
      if (body.eager_mandate === true) {
        const issuer = _operatorPubkey();
        const container = body.mandate_container || `/proj/${repoSlug}/`;
        if (!issuer) {
          notes.push('eager_mandate requested but no operator pubkey — mandate skipped');
        } else {
          try {
            const m = await ensureMandate({ issuer, agent: identity.pubkey, container, manifest, logger });
            mandateUrn = m.urn;
            if (!m.signed) notes.push('eager mandate minted but unsigned (no operator signer)');
          } catch (err) {
            notes.push(`eager mandate mint failed: ${err.message}`);
            logger.warn({ err: err.message, session_id: sessionId }, 'sessions-boundary: eager mandate mint failed');
          }
        }
      }

      const record = {
        phase: 'create',
        session_id: sessionId,
        slug: profile,
        tool: body.tool || null,
        did: identity.did,
        pubkey: identity.pubkey,
        multikey: identity.multikey,
        session_urn: sessionUrn,
        epic_urn: epicUrn,
        memory_namespace: memoryNamespace,
        repo_slug: repoSlug,
        mandate_urn: mandateUrn,
        minted: identity.minted,
        persisted: identity.persisted,
        created_at: startedAt,
        closed: false,
      };
      const persisted = _writeRecord(sessionId, record);
      if (!persisted) notes.push('session record not persisted (state dir unwritable)');

      logger.info(
        { event: 'sessions-boundary.create', session_id: sessionId, did: identity.did, session_urn: sessionUrn, epic_urn: epicUrn },
        'sessions-boundary: ManagedSession created',
      );
      return reply.code(201).send({ ...record, reused: false, notes });
    }

    // ── phase=turn ───────────────────────────────────────────────────────
    if (phase === 'turn') {
      const record = _readRecord(sessionId);
      if (!record || !record.did) {
        return reply.code(500).send({ error: 'no_session', message: 'no ManagedSession for this id — send phase=create first' });
      }
      let childUrn = null;
      const beads = beadsSlot();
      if (beads && record.epic_urn) {
        try {
          const child = await beads.createChild({
            title: body.turn_title || `turn ${new Date().toISOString()}`,
            parent_id: record.epic_urn,
            actor: record.pubkey,
            tags: ['aoe-turn', sessionId],
          });
          await beads.claim(child.id, record.pubkey);
          childUrn = child.id;
        } catch (err) {
          notes.push(`beads turn create/claim failed: ${err.message}`);
          logger.warn({ err: err.message, session_id: sessionId }, 'sessions-boundary: beads turn failed');
        }
      } else {
        notes.push(beads ? 'no epic on record — turn not recorded' : 'beads slot off — turn not recorded');
      }
      return reply.send({
        phase, session_id: sessionId, slug: record.slug, did: record.did, pubkey: record.pubkey,
        session_urn: record.session_urn, epic_urn: record.epic_urn, child_urn: childUrn,
        memory_namespace: record.memory_namespace, repo_slug: record.repo_slug, notes,
      });
    }

    // ── phase=close ──────────────────────────────────────────────────────
    if (phase === 'close') {
      const record = _readRecord(sessionId);
      if (!record || !record.did) {
        // Nothing to close — accept idempotently (the create may have been lost).
        return reply.send({ phase, session_id: sessionId, notes: ['no ManagedSession for this id — nothing to close'] });
      }
      const beads = beadsSlot();
      if (beads && record.epic_urn) {
        try {
          await beads.close(record.epic_urn, body.outcome || 'done');
        } catch (err) {
          notes.push(`beads epic close failed: ${err.message}`);
          logger.warn({ err: err.message, session_id: sessionId }, 'sessions-boundary: beads epic close failed');
        }
      } else if (!beads) {
        notes.push('beads slot off — epic not closed');
      }
      record.phase = 'close';
      record.closed = true;
      record.closed_at = new Date().toISOString();
      record.outcome = body.outcome || 'done';
      _writeRecord(sessionId, record);

      logger.info({ event: 'sessions-boundary.close', session_id: sessionId, epic_urn: record.epic_urn, outcome: record.outcome },
        'sessions-boundary: ManagedSession closed');
      return reply.send({
        phase, session_id: sessionId, slug: record.slug, did: record.did, pubkey: record.pubkey,
        session_urn: record.session_urn, epic_urn: record.epic_urn, memory_namespace: record.memory_namespace,
        repo_slug: record.repo_slug, notes,
      });
    }

    return reply.code(400).send({ error: 'bad_phase', message: `unknown phase "${phase}"` });
  });

  logger.debug({ event: 'sessions-boundary.route-mounted' }, 'Session-boundary route ready at /v1/sessions/boundary');
}

module.exports = sessionsBoundaryRoutes;
