'use strict';

/**
 * /v1/git/* — BC20 Git Bridge adapter (PRD-013 G5).
 *
 * Bridges agentbox agents to VisionClaw's git ingest surface and judgment
 * broker. Agents call these local endpoints; the bridge handles cross-system
 * HTTP calls, provenance validation, and Nostr event emission.
 *
 * Routes:
 *
 *   POST /v1/git/clone            — Clone a registered remote into the agent workspace
 *   POST /v1/git/submit-enrichment — Submit committed enrichment to the Judgment Broker
 *   GET  /v1/git/case-status/:caseId — Poll for broker decision
 *   POST /v1/git/approve-callback — Webhook from VisionClaw on case decision
 *
 * Environment:
 *
 *   VISIONCLAW_API_URL — Base URL for VisionClaw REST API (shared with
 *                        broker-bridge.js; default: http://visionclaw_container:4000)
 *   NOSTR_RELAYS       — Comma-separated relay URLs for Nostr event emission
 *   AGENTBOX_PUBKEY    — BIP-340 x-only pubkey hex for the agentbox identity
 *   GIT_BRIDGE_WORKSPACE_ROOT — Agent workspace root (default: /home/devuser/workspace/repos)
 *
 * Auth: all routes are behind the global onRequest auth hook (bearer/NIP-98).
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const execFileAsync = promisify(execFile);
const fsMkdir = promisify(fs.mkdir);
const fsAccess = promisify(fs.access);
const fsReadFile = promisify(fs.readFile);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Shared host-project endpoint env (one source of truth with
// routes/broker-bridge.js); the fallback matches broker-bridge's default.
const VISIONCLAW_API_URL = (
  process.env.VISIONCLAW_API_URL || 'http://visionclaw_container:4000'
).replace(/\/$/, '');

const WORKSPACE_ROOT = process.env.GIT_BRIDGE_WORKSPACE_ROOT || '/home/devuser/workspace/repos';
const NOSTR_RELAYS = (process.env.NOSTR_RELAYS || '').split(',').map(r => r.trim()).filter(Boolean);
const AGENTBOX_PUBKEY = process.env.AGENTBOX_PUBKEY || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_HMAC_SECRET || '';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * HTTP fetch wrapper for VisionClaw API calls.
 * Uses the built-in Node 18+ fetch. Throws on non-2xx with structured error.
 */
async function vcFetch(method, urlPath, body, logger) {
  const url = `${VISIONCLAW_API_URL}${urlPath}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }

  logger.debug({ url, method }, 'git-bridge: VisionClaw API call');

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    // FIX 9: Log the URL internally but suppress it from the thrown error message.
    logger.error({ url, err: err.message }, 'vcFetch: upstream unreachable');
    const error = new Error(`VisionClaw unreachable: ${err.message}`);
    error.statusCode = 502;
    throw error;
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    logger.warn({ url, status: res.status, body: json }, 'git-bridge: VisionClaw error response');
    const error = new Error(json.error || json.message || `VisionClaw returned ${res.status}`);
    error.statusCode = res.status >= 500 ? 502 : res.status;
    error.upstream = json;
    throw error;
  }

  return json;
}

// Filtered environment for child git processes — prevents leaking secrets
// (API keys, tokens, etc.) from the management API process into git subprocesses.
const GIT_SAFE_ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '/bin/true',
  GIT_SSH_COMMAND: 'ssh -o StrictHostKeyChecking=accept-new',
};

/**
 * Run a git command in a given working directory.
 * Returns { stdout, stderr }. Throws on non-zero exit.
 */
async function git(args, cwd, logger) {
  logger.debug({ args, cwd }, 'git-bridge: exec git');
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
      timeout: 120_000,             // 2 min
      env: GIT_SAFE_ENV,
    });
    return result;
  } catch (err) {
    logger.error({ args, cwd, stderr: err.stderr, code: err.code }, 'git-bridge: git command failed');
    const wrapped = new Error(`git ${args[0]} failed: ${(err.stderr || err.message).slice(0, 500)}`);
    wrapped.statusCode = 500;
    throw wrapped;
  }
}

/**
 * Derive the local clone path for a given remote + agent.
 * Each (remoteId, agentDid) pair gets its own directory to prevent conflicts.
 */
function clonePath(remoteId, agentDid) {
  // Sanitise remoteId to prevent path traversal.
  const safeId = String(remoteId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const hash = crypto.createHash('sha256')
    .update(`${remoteId}:${agentDid}`)
    .digest('hex')
    .slice(0, 12);
  const result = path.resolve(WORKSPACE_ROOT, `${safeId}-${hash}`);
  if (!result.startsWith(path.resolve(WORKSPACE_ROOT))) {
    throw new Error('path-traversal: clonePath escaped workspace root');
  }
  return result;
}

/**
 * Validate that a commit contains the minimum required provenance trailers.
 * Returns { valid: true, trailers } or { valid: false, missing }.
 */
function parseProvenanceTrailers(commitMessage) {
  const required = ['Urn', 'Proposed-by'];
  const trailers = {};

  // Git trailers are key: value lines after the last blank line in the message
  const lines = commitMessage.split('\n');
  const trailerRe = /^([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.+)$/;

  for (const line of lines) {
    const match = trailerRe.exec(line.trim());
    if (match) {
      trailers[match[1]] = match[2].trim();
    }
  }

  const missing = required.filter(key => !trailers[key]);
  if (missing.length > 0) {
    return { valid: false, missing, trailers };
  }
  return { valid: true, trailers };
}

/**
 * Emit a Nostr kind 30300 event (enrichment decision) to configured relays.
 * Best-effort: failures are logged but do not block the response.
 */
async function emitNostrEvent(decision, logger) {
  if (NOSTR_RELAYS.length === 0) {
    logger.debug('git-bridge: no NOSTR_RELAYS configured, skipping event emission');
    return;
  }

  if (!AGENTBOX_PUBKEY) {
    logger.warn('git-bridge: AGENTBOX_PUBKEY not set, cannot sign Nostr events');
    return;
  }

  let nostrTools;
  try {
    nostrTools = require('nostr-tools');
  } catch {
    logger.warn('git-bridge: nostr-tools not available, skipping event emission');
    return;
  }

  const content = JSON.stringify({
    type: 'enrichment_decision',
    caseId: decision.caseId,
    action: decision.action,
    remoteId: decision.remoteId,
    commitSha: decision.commitSha,
    timestamp: new Date().toISOString(),
  });

  // kind 30300: parameterized replaceable event for enrichment decisions
  const event = {
    kind: 30300,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', decision.caseId],
      ['p', AGENTBOX_PUBKEY],
      ['t', 'enrichment-decision'],
    ],
    content,
    pubkey: AGENTBOX_PUBKEY,
  };

  // Signing requires a secret key — if not available, emit unsigned for relay
  // bridges that accept them (e.g. the embedded relay). In production, the
  // sovereign-bootstrap injects AGENTBOX_NSEC.
  const nsec = process.env.AGENTBOX_NSEC;
  if (nsec) {
    try {
      let sk;
      if (nsec.startsWith('nsec1')) {
        const decoded = nostrTools.nip19.decode(nsec);
        sk = decoded.data;
      } else {
        sk = nsec;
      }
      const signedEvent = nostrTools.finalizeEvent(event, sk);

      for (const relayUrl of NOSTR_RELAYS) {
        try {
          const relay = await nostrTools.Relay.connect(relayUrl);
          await relay.publish(signedEvent);
          relay.close();
          logger.info({ relay: relayUrl, eventId: signedEvent.id }, 'git-bridge: Nostr event published');
        } catch (err) {
          logger.warn({ relay: relayUrl, err: err.message }, 'git-bridge: Nostr relay publish failed');
        }
      }
    } catch (err) {
      logger.error({ err: err.message }, 'git-bridge: Nostr event signing failed');
    }
  } else {
    logger.debug('git-bridge: AGENTBOX_NSEC not set, skipping Nostr event signing');
  }
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

async function gitBridgeRoutes(fastify, options) {
  const { logger } = options;

  // Ensure workspace root exists
  try {
    await fsMkdir(WORKSPACE_ROOT, { recursive: true });
  } catch (err) {
    logger.warn({ path: WORKSPACE_ROOT, err: err.message }, 'git-bridge: could not create workspace root');
  }

  // -------------------------------------------------------------------
  // POST /v1/git/clone
  // -------------------------------------------------------------------
  fastify.post('/v1/git/clone', {
    schema: {
      tags: ['git-bridge'],
      description: 'Clone a registered VisionClaw remote into the agent workspace',
      body: {
        type: 'object',
        required: ['remoteId', 'agentDid'],
        properties: {
          remoteId: { type: 'string', description: 'ID of a registered git remote in VisionClaw' },
          agentDid: { type: 'string', description: 'did:nostr:<hex> of the requesting agent' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            workdir:  { type: 'string' },
            branch:   { type: 'string' },
            headSha:  { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
        502: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { remoteId, agentDid } = req.body;

    // Verify agent DID matches authenticated identity to prevent impersonation.
    if (req.auth && req.auth.pubkey && agentDid !== `did:nostr:${req.auth.pubkey}`) {
      return reply.code(403).send({
        error: 'identity-mismatch',
        message: 'agentDid does not match authenticated identity',
      });
    }

    logger.info({ remoteId, agentDid }, 'git-bridge: clone requested');

    // 1. Fetch remote config from VisionClaw
    let remote;
    try {
      remote = await vcFetch('GET', `/api/ingest/remotes/${encodeURIComponent(remoteId)}`, undefined, logger);
    } catch (err) {
      if (err.statusCode === 404) {
        return reply.code(404).send({
          error: 'remote-not-found',
          message: `Remote ${remoteId} not found in VisionClaw registry`,
        });
      }
      return reply.code(err.statusCode || 502).send({
        error: 'visionclaw-error',
        message: err.message,
      });
    }

    const workdir = clonePath(remoteId, agentDid);
    const branch = remote.branch || 'main';

    // Validate remote URL protocol to prevent ext::, file://, ssh:// RCE.
    if (remote.url && !remote.url.startsWith('https://') && !remote.url.startsWith('http://')) {
      return reply.code(400).send({
        error: 'invalid-remote-url',
        message: 'Only HTTP(S) git remotes are supported',
      });
    }

    // Validate branch name against safe pattern.
    if (!/^[a-zA-Z0-9/_.-]{1,256}$/.test(branch)) {
      return reply.code(400).send({
        error: 'invalid-branch',
        message: 'Branch name contains disallowed characters',
      });
    }

    // 2. Clone or fetch
    let alreadyCloned = false;
    try {
      await fsAccess(path.join(workdir, '.git'), fs.constants.F_OK);
      alreadyCloned = true;
    } catch {
      // Not yet cloned
    }

    if (alreadyCloned) {
      // Fetch + reset to latest
      logger.info({ workdir, branch }, 'git-bridge: repo exists, fetching latest');
      await git(['fetch', 'origin', branch], workdir, logger);
      await git(['checkout', branch], workdir, logger);
      await git(['reset', '--hard', `origin/${branch}`], workdir, logger);
    } else {
      // Fresh clone
      logger.info({ url: remote.url, workdir, branch }, 'git-bridge: cloning');
      await fsMkdir(workdir, { recursive: true });
      await git(['clone', '--branch', branch, '--single-branch', remote.url, workdir], WORKSPACE_ROOT, logger);
    }

    // 3. Read HEAD sha
    const { stdout: headSha } = await git(['rev-parse', 'HEAD'], workdir, logger);

    return {
      workdir,
      branch,
      headSha: headSha.trim(),
    };
  });

  // -------------------------------------------------------------------
  // POST /v1/git/submit-enrichment
  // -------------------------------------------------------------------
  fastify.post('/v1/git/submit-enrichment', {
    schema: {
      tags: ['git-bridge'],
      description: 'Submit a committed enrichment to the VisionClaw Judgment Broker',
      body: {
        type: 'object',
        required: ['remoteId', 'agentDid', 'commitSha', 'enrichmentType', 'targetPath', 'commitSubject'],
        properties: {
          remoteId:        { type: 'string', description: 'Registered remote ID' },
          agentDid:        { type: 'string', description: 'did:nostr:<hex> of the agent' },
          commitSha:       { type: 'string', description: 'SHA of the enrichment commit' },
          enrichmentType:  { type: 'string', enum: ['ontology_promotion', 'embedding_update', 'gap_detection', 'agent_annotation'] },
          targetPath:      { type: 'string', description: 'Path of the enriched file relative to repo root' },
          commitSubject:   { type: 'string', description: 'Commit subject line' },
          commitBody:      { type: 'string', default: '', description: 'Commit body text' },
          entityUrn:       { type: 'string', default: '', description: 'URN of the enriched entity' },
          reasoning:       { type: 'string', default: '', description: 'Reasoning for the enrichment' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            caseId: { type: 'string' },
            status: { type: 'string' },
          },
        },
        400: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
        502: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const {
      remoteId, agentDid, commitSha, enrichmentType,
      targetPath, commitSubject, commitBody, entityUrn, reasoning,
    } = req.body;

    // Verify agent DID matches authenticated identity to prevent impersonation.
    if (req.auth && req.auth.pubkey && agentDid !== `did:nostr:${req.auth.pubkey}`) {
      return reply.code(403).send({
        error: 'identity-mismatch',
        message: 'agentDid does not match authenticated identity',
      });
    }

    // FIX 8: Validate commitSha format to prevent argument injection.
    if (!/^[0-9a-f]{4,40}$/.test(commitSha)) {
      return reply.code(400).send({
        error: 'invalid-commit-sha',
        message: 'commitSha must be a hex string (4-40 chars)',
      });
    }

    // FIX 8: Validate targetPath to prevent argument injection and traversal.
    if (targetPath.startsWith('-') || targetPath.includes('..')) {
      return reply.code(400).send({
        error: 'invalid-target-path',
        message: 'targetPath must not start with - or contain ..',
      });
    }

    logger.info({ remoteId, agentDid, commitSha, enrichmentType }, 'git-bridge: submit-enrichment');

    const workdir = clonePath(remoteId, agentDid);

    // 1. Verify the commit exists in the local repo
    try {
      await fsAccess(path.join(workdir, '.git'), fs.constants.F_OK);
    } catch {
      return reply.code(400).send({
        error: 'no-local-clone',
        message: `No local clone found for remote ${remoteId} and agent ${agentDid}. Call POST /v1/git/clone first.`,
      });
    }

    // 2. Read the commit message and validate provenance trailers
    let commitMessage;
    try {
      const { stdout } = await git(['log', '-1', '--format=%B', '--', commitSha], workdir, logger);
      commitMessage = stdout;
    } catch (err) {
      return reply.code(400).send({
        error: 'commit-not-found',
        message: `Commit ${commitSha} not found in local clone: ${err.message}`,
      });
    }

    const trailerCheck = parseProvenanceTrailers(commitMessage);
    if (!trailerCheck.valid) {
      return reply.code(400).send({
        error: 'missing-provenance-trailers',
        message: `Commit ${commitSha} is missing required provenance trailers: ${trailerCheck.missing.join(', ')}`,
        hint: 'Commits must include at minimum: Urn: <entity-urn> and Proposed-by: <did:nostr:hex>',
      });
    }

    // 3. Read the diff content for the commit
    let diffContent;
    try {
      const { stdout } = await git(['diff', `${commitSha}~1..${commitSha}`, '--', targetPath], workdir, logger);
      diffContent = stdout;
    } catch {
      // If the commit is the first commit or diff fails, get the full file content
      try {
        const { stdout } = await git(['show', `${commitSha}:${targetPath}`], workdir, logger);
        diffContent = stdout;
      } catch (err) {
        return reply.code(400).send({
          error: 'diff-extraction-failed',
          message: `Could not extract diff for ${targetPath} at ${commitSha}: ${err.message}`,
        });
      }
    }

    // 4. Submit to VisionClaw Judgment Broker
    const caseTitle = commitSubject.slice(0, 200);
    const caseDescription = [
      `**Enrichment Type**: ${enrichmentType}`,
      `**Target Path**: ${targetPath}`,
      `**Commit**: ${commitSha}`,
      `**Agent DID**: ${agentDid}`,
      `**Remote ID**: ${remoteId}`,
      entityUrn ? `**Entity URN**: ${entityUrn}` : null,
      reasoning ? `\n**Reasoning**:\n${reasoning}` : null,
      `\n**Provenance Trailers**:\n${Object.entries(trailerCheck.trailers).map(([k, v]) => `  ${k}: ${v}`).join('\n')}`,
      `\n**Diff**:\n\`\`\`\n${diffContent.slice(0, 8000)}\n\`\`\``,
      commitBody ? `\n**Commit Body**:\n${commitBody}` : null,
    ].filter(Boolean).join('\n');

    // Read file content for write-back (the actual enrichment payload).
    let fileContent = '';
    try {
      const { stdout } = await git(['show', `${commitSha}:${targetPath}`], workdir, logger);
      fileContent = stdout;
    } catch {
      // Non-fatal — content may not be needed if write-back is disabled.
    }

    let brokerResponse;
    try {
      brokerResponse = await vcFetch('POST', '/api/enrichment-proposals', {
        agent_did: agentDid,
        entity_urn: entityUrn || trailerCheck.trailers['Urn'] || '',
        enrichment_type: enrichmentType,
        target_path: targetPath,
        reasoning_hash: trailerCheck.trailers['Reasoning-hash'] || '',
        title: caseTitle,
        summary: caseDescription.slice(0, 2000),
        priority: 50,
        content: fileContent,
        commit_subject: commitSubject,
        commit_body: commitBody || '',
        remote_id: remoteId,
      }, logger);
    } catch (err) {
      return reply.code(err.statusCode || 502).send({
        error: 'broker-submission-failed',
        message: err.message,
      });
    }

    logger.info({ caseId: brokerResponse.case_id, commitSha, enrichmentType }, 'git-bridge: enrichment submitted to broker');

    return reply.code(201).send({
      caseId: brokerResponse.case_id,
      status: brokerResponse.status || 'submitted',
    });
  });

  // -------------------------------------------------------------------
  // GET /v1/git/case-status/:caseId
  // -------------------------------------------------------------------
  fastify.get('/v1/git/case-status/:caseId', {
    schema: {
      tags: ['git-bridge'],
      description: 'Poll for a broker case decision status',
      params: {
        type: 'object',
        required: ['caseId'],
        properties: {
          caseId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
        },
        404: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
        502: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { caseId } = req.params;
    logger.info({ caseId }, 'git-bridge: case-status poll');

    try {
      const caseData = await vcFetch('GET', `/api/broker/cases/${encodeURIComponent(caseId)}`, undefined, logger);
      return caseData;
    } catch (err) {
      if (err.statusCode === 404) {
        return reply.code(404).send({
          error: 'case-not-found',
          message: `Case ${caseId} not found`,
        });
      }
      return reply.code(err.statusCode || 502).send({
        error: 'visionclaw-error',
        message: err.message,
      });
    }
  });

  // -------------------------------------------------------------------
  // POST /v1/git/approve-callback
  // -------------------------------------------------------------------
  fastify.post('/v1/git/approve-callback', {
    schema: {
      tags: ['git-bridge'],
      description: 'Webhook from VisionClaw when a broker case is decided. Triggers WriteBackSaga if approved.',
      body: {
        type: 'object',
        required: ['caseId', 'action', 'remoteId'],
        properties: {
          caseId:          { type: 'string', description: 'Broker case ID' },
          action:          { type: 'string', enum: ['approve', 'reject', 'amend', 'delegate'], description: 'Decision action' },
          remoteId:        { type: 'string', description: 'Registered remote ID for write-back' },
          enrichmentType:  { type: 'string', default: 'agent_annotation' },
          targetPath:      { type: 'string', default: '' },
          content:         { type: 'string', default: '' },
          commitSubject:   { type: 'string', default: '' },
          commitBody:      { type: 'string', default: '' },
          proposedBy:      { type: 'string', default: '' },
          approvedBy:      { type: 'string', default: '' },
          entityUrn:       { type: 'string', default: '' },
          reasoning:       { type: 'string', default: '' },
          serverDid:       { type: 'string', default: '' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            status:     { type: 'string' },
            caseId:     { type: 'string' },
            action:     { type: 'string' },
            writeback:  { type: 'object' },
            nostrEvent: { type: 'string' },
          },
        },
        502: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    // FIX 2: Webhook HMAC-SHA256 signature verification — fail-closed.
    if (!WEBHOOK_SECRET) {
      return reply.code(500).send({
        error: 'webhook-secret-missing',
        message: 'WEBHOOK_HMAC_SECRET not configured; callback rejected'
      });
    }
    const sig = req.headers['x-webhook-signature'] || '';
    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(req.body)).digest('hex');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return reply.code(403).send({ error: 'invalid-signature', message: 'Webhook signature verification failed' });
    }

    const {
      caseId, action, remoteId, enrichmentType, targetPath, content,
      commitSubject, commitBody, proposedBy, approvedBy, entityUrn,
      reasoning, serverDid,
    } = req.body;

    logger.info({ caseId, action, remoteId }, 'git-bridge: approve-callback received');

    const result = {
      status: 'processed',
      caseId,
      action,
      writeback: null,
      nostrEvent: 'skipped',
    };

    // Only trigger write-back for approve actions
    if (action === 'approve') {
      // Trigger VisionClaw WriteBackSaga via POST /api/ingest/writeback
      const writebackPayload = {
        remoteId,
        enrichment: {
          enrichmentType: enrichmentType || 'agent_annotation',
          targetPath: targetPath || '',
          content: content || '',
          commitSubject: commitSubject || `Enrichment approved: ${caseId}`,
          commitBody: commitBody || '',
        },
        decision: {
          caseId,
          decision: 'approve',
          proposedBy: proposedBy || '',
          approvedBy: approvedBy || '',
          reasoning: reasoning || '',
          serverDid: serverDid || '',
          entityUrn: entityUrn || '',
        },
      };

      try {
        const writebackResult = await vcFetch('POST', '/api/ingest/writeback', writebackPayload, logger);
        result.writeback = writebackResult;
        logger.info({ caseId, remoteId, writeback: writebackResult }, 'git-bridge: write-back saga completed');
      } catch (err) {
        logger.error({ caseId, remoteId, err: err.message }, 'git-bridge: write-back saga failed');
        // Write-back failure does not block the callback response — the decision
        // is recorded and the write-back can be retried.
        result.writeback = { error: err.message, status: 'failed' };
      }
    } else {
      logger.info({ caseId, action }, 'git-bridge: non-approve action, skipping write-back');
    }

    // Emit Nostr kind 30300 event (best-effort, async)
    emitNostrEvent({
      caseId,
      action,
      remoteId,
      commitSha: result.writeback && result.writeback.commitSha || null,
    }, logger).then(() => {
      result.nostrEvent = 'emitted';
    }).catch((err) => {
      logger.warn({ err: err.message }, 'git-bridge: Nostr event emission failed (non-blocking)');
    });

    return result;
  });
}

module.exports = gitBridgeRoutes;
