'use strict';

/**
 * Linked-Data Interchange middleware — DDD-004 root entry point.
 *
 * Composes the ContextResolver, LIONLinter, JCS module, round-trip
 * helper, and the eleven surface modules into a single LinkedDataEncoder
 * ready to be dropped into the adapter dispatch path.
 *
 * Wiring:
 *
 *   const ld = require('./middleware/linked-data');
 *   const encoder = await ld.createEncoder({ manifest, logger, agentDid });
 *   // pass `encoder` into the adapter dispatch wrapper.
 */

const { ContextResolver } = require('./context-resolver');
const { LinkedDataEncoder } = require('./encoder');
const { LIONLinter } = require('./lion-linter');
const jcs = require('./jcs');
const roundTrip = require('./round-trip');
const inputValidator = require('./input-validator');

const surfaceModules = [
  require('./surfaces/s01-pods'),
  require('./surfaces/s02-nostr'),
  require('./surfaces/s03-credentials'),
  require('./surfaces/s04-did'),
  require('./surfaces/s05-provenance'),
  require('./surfaces/s06-wot'),
  require('./surfaces/s07-skill'),
  require('./surfaces/s08-payments'),
  require('./surfaces/s09-dcat'),
  require('./surfaces/s10-arch-docs'),
  require('./surfaces/s11-http-meta'),
];

/**
 * Resolve the operator-supplied context aliases into a Map<string,string>.
 * Falls back to the default catalogue IRIs when an alias is not set.
 */
function _resolveAliases(manifest) {
  const aliases = new Map();
  const ctx = (manifest.linked_data && manifest.linked_data.contexts) || {};
  for (const [prefix, iri] of Object.entries(ctx)) {
    if (typeof iri === 'string' && iri.length > 0) aliases.set(prefix, iri);
  }
  return aliases;
}

/**
 * Build an in-memory surfaces map keyed by surface id. Each surface
 * module exports the metadata fields the encoder uses (id, slot, form,
 * gateKey, etc.) plus an `encode(payload, ctx)` function.
 */
function _buildSurfaceMap(modules) {
  const map = new Map();
  for (const m of modules) {
    if (!m.id || !m.gateKey) {
      throw new Error('linked-data surface module missing id/gateKey');
    }
    map.set(m.id, m);
  }
  return map;
}

async function createEncoder({ manifest, logger, agentDid, catalogueDir } = {}) {
  if (!manifest) throw new Error('createEncoder requires a manifest');

  const ld = manifest.linked_data || {};
  const resolver = new ContextResolver({
    catalogueDir: catalogueDir || ld.context_catalogue || undefined,
    unknownContextPolicy: ld.unknown_context_policy || 'fail-closed',
    aliases: _resolveAliases(manifest),
    logger,
  });

  // The catalogue may legitimately not exist yet (ephemeral test runs,
  // dev-shell mode where /opt/agentbox/contexts is not mounted). We let
  // boot() throw and surface that as a runtime configuration error;
  // [linked_data].enabled = false (the default) skips this whole path.
  if (ld.enabled) {
    await resolver.boot();
  }

  const surfaces = _buildSurfaceMap(surfaceModules);

  const encoder = new LinkedDataEncoder({
    manifest,
    resolver,
    surfaces,
    logger,
    agentDid,
  });
  await encoder.boot();

  return encoder;
}

function createLinter({ resolver, surface, baseIRI, inheritedContextIRIs } = {}) {
  return new LIONLinter({ resolver, surface, baseIRI, inheritedContextIRIs });
}

module.exports = {
  createEncoder,
  createLinter,
  ContextResolver,
  LinkedDataEncoder,
  LIONLinter,
  jcs,
  roundTrip,
  inputValidator,
  surfaceModules,
};
