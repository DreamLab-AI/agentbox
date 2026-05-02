'use strict';

/**
 * /v1/uri/<urn> — canonical URI resolver (ADR-013, DDD-004 §URICanonicaliser).
 *
 * Resolves a `urn:agentbox:*` (or `did:nostr:*`) URI to its current
 * dereferenceable HTTPS IRI when the resolver knows how. Critical
 * design point: agentbox URIs are always **unique**, but they are not
 * always **resolvable** — a URN is a name, not an address. The
 * resolver advertises three states:
 *
 *   200 + 307 Location  → resolvable; redirect to the canonical IRI.
 *   404                 → unknown URI (or unknown kind); the name is
 *                         valid in form but the resolver cannot point
 *                         at a current representation.
 *   410 Gone            → URI was once resolvable but the resource has
 *                         been retracted (rare; only used when the
 *                         resolver has positive knowledge of deletion).
 *
 * Consumers can rely on:
 *   - URI uniqueness, always.
 *   - URI resolvability, only when the resolver answers 200/307.
 *
 * The viewer layer (S12) handles the unresolvable case by rendering
 * the URN literally with a "no representation available" badge — the
 * pane still loads, the browser doesn't crash.
 *
 * Attribution
 * -----------
 * Resolver pattern follows W3C DID Core 1.0's resolution semantics
 * and IETF [RFC 8141 (URN syntax)](https://www.rfc-editor.org/rfc/rfc8141).
 */

const uris = require('../lib/uris');

async function uriResolverRoutes(fastify, options) {
  const { logger, manifest } = options;

  const sp = (manifest.integrations || {}).solid_pod_rs || {};
  const podBase = sp.base_url || `http://${sp.bind || '127.0.0.1'}:${sp.port || 8484}`;

  fastify.get('/v1/uri/:urn', async (req, reply) => {
    const urn = decodeURIComponent(req.params.urn);
    const surface = req.query.surface || null;

    if (!uris.isCanonical(urn)) {
      reply.code(400).send({
        error: 'malformed-uri',
        message: `Not a canonical agentbox URI: ${urn}`,
        hint: 'Expected did:nostr:<pubkey> or urn:agentbox:<kind>:[<scope>:]<local>',
      });
      return;
    }

    const parsed = uris.parse(urn);

    // did:nostr: → /.well-known/did.json
    if (parsed.scheme === 'did' && parsed.method === 'nostr') {
      const ld = manifest.linked_data || {};
      if ((ld.did_documents || 'off') === 'off') {
        reply.code(404).send({
          error: 'not-resolvable',
          message: 'did:nostr resolution requires [linked_data].did_documents enabled',
          urn,
        });
        return;
      }
      reply.redirect(307, `${podBase}/.well-known/did.json`);
      return;
    }

    // urn:agentbox:<kind>:…
    const kind = parsed.kind;
    const spec = uris.KINDS[kind];
    if (!spec) {
      reply.code(404).send({ error: 'unknown-kind', kind, urn });
      return;
    }

    // Best-effort dispatch by kind. Most kinds resolve through the pod
    // or the management-api; some (skill, adr, prd, ddd) only resolve
    // when the corresponding emit surface is enabled.
    switch (kind) {
      case 'pod':
      case 'envelope':
      case 'credential':
      case 'mandate':
      case 'receipt':
        if (parsed.pubkey) {
          // solid-pod-rs's did-nostr feature (ADR-010) accepts both hex
          // pubkey and bech32 npub at /agents/* — agentbox URIs always
          // carry pubkey hex; the pod resolves the equivalence.
          reply.redirect(307, `${podBase}/agents/${parsed.pubkey}/${kind}/${parsed.local}`);
        } else {
          reply.code(404).send({ error: 'not-resolvable', reason: 'kind requires owner scope', urn });
        }
        return;

      case 'activity':
      case 'event':
        reply.redirect(307, `/v1/agent-events?id=${encodeURIComponent(urn)}`);
        return;

      case 'mcp':
      case 'thing':
        reply.redirect(307, `/v1/things/${parsed.local}`);
        return;

      case 'memory':
      case 'dataset': {
        // localId is encoded as namespace.key by uris.mint; split on first dot.
        const local = parsed.local || parsed.pubkey || '';
        const dot   = local.indexOf('.');
        if (dot !== -1) {
          const ns  = local.slice(0, dot);
          const key = local.slice(dot + 1);
          reply.redirect(307, `/v1/memory/${encodeURIComponent(key)}?namespace=${encodeURIComponent(ns)}`);
        } else {
          reply.redirect(307, `/v1/memory/${encodeURIComponent(local)}`);
        }
        return;
      }

      case 'skill':
        reply.redirect(307, `/v1/skills/${parsed.local}`);
        return;

      case 'adr':
      case 'prd':
      case 'ddd':
        reply.redirect(307, `/docs/reference/${kind}/${parsed.local}.md`);
        return;

      case 'meta':
        reply.redirect(307, `/v1/meta`);
        return;

      case 'bead':
        reply.redirect(307, `/v1/beads/${parsed.local || parsed.pubkey}`);
        return;

      default:
        // Form-valid URN but no resolver mapped. The URI still names
        // the resource uniquely; we just don't know how to fetch it.
        reply.code(404).send({
          error: 'not-resolvable',
          reason: `kind "${kind}" has no resolver mapping`,
          urn,
        });
    }
  });

  // Self-describing endpoint — exposes the URI grammar for tooling.
  fastify.get('/v1/uri', async (req, reply) => {
    reply.send({
      grammar: {
        identity: 'did:nostr:<pubkey>',
        urn: 'urn:agentbox:<kind>:[<scope>:]<local>',
        kinds: Object.fromEntries(
          Object.entries(uris.KINDS).map(([k, v]) => [
            k,
            { ownerScope: v.ownerScope, contentAddressed: v.contentAddressed, surface: v.resolvableSurface },
          ]),
        ),
      },
      contract: {
        uniqueness: 'always — every emit produces a stable, deterministic URI',
        resolvability: 'best-effort — resolver returns 307 when known, 404 when unknown, 410 when deliberately retracted',
      },
      docs: '/docs/reference/adr/ADR-013-canonical-uri-grammar.md',
    });
  });
}

module.exports = uriResolverRoutes;
