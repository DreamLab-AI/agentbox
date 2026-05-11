'use strict';

/**
 * Linked-Data encoder — DDD-004 §EncodingPipeline.
 *
 * Wraps adapter dispatch as the third middleware after observability
 * (ADR-005 §Observability) and the privacy filter (ADR-008). The
 * privacy-handoff order is fixed in code; the manifest's
 * `[linked_data].privacy_handoff.order` is documentation only.
 *
 * Public API:
 *
 *   const encoder = new LinkedDataEncoder({
 *     manifest, resolver, surfaces, jcs, logger,
 *   });
 *   await encoder.boot();
 *
 *   // Wrap an adapter call:
 *   const result = await encoder.dispatch({
 *     slot: 'pods', operation: 'write', payload: { … },
 *     context: { agent: 'did:nostr:<pubkey>' },
 *     adapterCall: () => adapter.write(encoded),
 *   });
 *
 * The `surfaces` map keys are slot names (`pods`, `events`, …) and values
 * are surface modules (s01-pods, s02-nostr, …). When a slot has no
 * registered surface or the manifest disables the surface, `dispatch` is a
 * pass-through.
 */

const crypto = require('crypto');
const { canonicalise: jcsCanonicalise } = require('./jcs');
const { roundTrip, RoundTripViolation } = require('./round-trip');
const { validatePayload, InputValidationError, PayloadTooLargeError } = require('./input-validator');
const { assertPrivacyFilterApplied } = require('../privacy-filter');

class EncodingDisabledError extends Error {
  constructor(slot) {
    super(`EncodingDisabledError: linked-data middleware called for slot '${slot}' but [linked_data].enabled = false`);
    this.name = 'EncodingDisabledError';
    this.slot = slot;
  }
}

class LinkedDataEncoder {
  /**
   * @param {object} opts
   * @param {object} opts.manifest — parsed agentbox.toml
   * @param {object} opts.resolver — ContextResolver instance (booted)
   * @param {Map<string, object>} opts.surfaces — slot → surface module
   * @param {object} [opts.logger]
   * @param {string} [opts.agentDid] — `did:nostr:<pubkey-hex>` of this container's agent
   */
  constructor({ manifest, resolver, surfaces, logger, agentDid } = {}) {
    if (!manifest) throw new Error('LinkedDataEncoder requires manifest');
    if (!resolver) throw new Error('LinkedDataEncoder requires resolver');
    if (!surfaces) throw new Error('LinkedDataEncoder requires surfaces');

    this.manifest = manifest;
    this.resolver = resolver;
    this.surfaces = surfaces;
    this.logger = logger || console;
    this.agentDid = agentDid || null;

    const ld = (manifest.linked_data || {});
    this.enabled = !!ld.enabled;
    this.gates = {
      pods:                  ld.pods                  || 'off',
      events:                ld.events                || 'off',
      credentials:           ld.credentials           || 'off',
      did_documents:         ld.did_documents         || 'off',
      provenance:            ld.provenance            || 'off',
      capability_descriptors: ld.capability_descriptors || 'off',
      skill_metadata:        ld.skill_metadata        || 'off',
      payments:              ld.payments              || 'off',
      memory_catalogue:      ld.memory_catalogue      || 'off',
      architecture_docs:     ld.architecture_docs     || 'off',
      http_meta:             ld.http_meta             || 'off',
    };
    this.canonicalisation = ld.canonicalisation || 'jcs';
    this._booted = false;
  }

  async boot() {
    if (this._booted) return;
    // Resolver is expected to already be booted; we just emit a
    // surface-enabled event for each gate that's on.
    if (this.enabled) {
      for (const [surfaceId, surface] of this.surfaces.entries()) {
        if (this._surfaceEnabled(surface.gateKey)) {
          this.logger.info?.({
            event: 'linked-data.surface-enabled',
            surface: surfaceId,
            form: surface.form,
            vocabularyBinding: surface.vocabularyBinding,
            manifestGate: `linked_data.${surface.gateKey}`,
            prerequisiteAdapter: surface.prerequisiteAdapter || null,
          }) ?? this.logger.log?.(`linked-data.surface-enabled: ${surfaceId}`);
        }
      }
    }
    this._booted = true;
  }

  _surfaceEnabled(gateKey) {
    if (!this.enabled) return false;
    const v = this.gates[gateKey];
    return v && v !== 'off';
  }

  /**
   * Encode the payload for the given slot+operation if a surface is
   * enabled, then call the adapter.
   *
   * @returns {Promise<*>} the adapter's return value
   */
  async dispatch({ slot, operation, payload, context, adapterCall }) {
    if (!this._booted) {
      throw new Error('LinkedDataEncoder.dispatch called before boot()');
    }

    // DDD-004 §L08 invariant: privacy redaction must precede encoding.
    // assertPrivacyFilterApplied() is a no-op when OPF_MODE=off.
    assertPrivacyFilterApplied(slot, this.logger);

    // Find a surface module for this slot. The first match whose gate is
    // enabled wins; surfaces are indexed by surfaceId (S01..S11), each
    // of which declares its slot association.
    const surface = this._findSurfaceForSlot(slot, operation);
    if (!surface) {
      // Pass-through: no surface registered or its gate is off.
      return adapterCall(payload);
    }

    // P2-10: validate input before passing to surface encoder.
    const validationLimits = (this.manifest.linked_data || {}).input_validation || {};
    try {
      validatePayload(payload, {
        surfaceId: surface.id,
        resolver: this.resolver,
        maxPayloadBytes: validationLimits.max_payload_bytes,
        maxStringLength: validationLimits.max_string_length,
        maxDepth: validationLimits.max_depth,
        maxKeys: validationLimits.max_keys,
      });
    } catch (err) {
      if (err instanceof InputValidationError) {
        this.logger.warn?.({
          event: 'linked-data.input-validation-rejected',
          surface: surface.id,
          code: err.code,
          errorMessage: err.message,
          agent: this.agentDid,
        }) ?? this.logger.warn(`linked-data.input-validation-rejected: ${err.code} — ${err.message}`);
      }
      throw err;
    }

    const startedAt = Date.now();
    let encoded;
    try {
      encoded = await surface.encode(payload, {
        resolver: this.resolver,
        manifest: this.manifest,
        agentDid: this.agentDid,
        operation,
        slot,
        context,
      });
    } catch (err) {
      this.logger.error?.({
        event: 'linked-data.encode-failed',
        surface: surface.id,
        errorClass: err.name,
        errorMessage: err.message,
        agent: this.agentDid,
      }) ?? this.logger.error(`linked-data.encode-failed: ${err.message}`);
      throw err;
    }

    // Round-trip verification per L12. Cheap to skip in production via
    // [linked_data].round_trip_in_dispatch = false; default on for new
    // surfaces and for canary writes in CI.
    if ((this.manifest.linked_data || {}).round_trip_in_dispatch !== false) {
      try {
        await roundTrip({
          resolver: this.resolver,
          payload: encoded.document,
          context: encoded.contextIri || surface.contextIri,
          surface: surface.id,
        });
      } catch (err) {
        if (err instanceof RoundTripViolation) {
          this.logger.error?.({
            event: 'linked-data.round-trip-violation',
            surface: surface.id,
            errorMessage: err.message,
          }) ?? this.logger.error(`linked-data.round-trip-violation: ${err.message}`);
          throw err;
        }
        throw err;
      }
    }

    // Optional canonicalisation for signed surfaces.
    if (surface.canonicalisation === 'jcs' && this.canonicalisation === 'jcs') {
      const canonicalBytes = jcsCanonicalise(encoded.document);
      const canonicalHash = crypto.createHash('sha256')
        .update(canonicalBytes, 'utf8').digest('hex');
      encoded.canonicalBytes = canonicalBytes;
      encoded.canonicalHash = canonicalHash;
      this.logger.debug?.({
        event: 'linked-data.canonicalisation-completed',
        surface: surface.id,
        canonicalHash,
        payloadSize: canonicalBytes.length,
        agent: this.agentDid,
      });
    }

    const result = await adapterCall(encoded);
    this.logger.debug?.({
      event: 'linked-data.encode-completed',
      surface: surface.id,
      form: surface.form,
      bytesLength: JSON.stringify(encoded.document).length,
      contextIRI: encoded.contextIri || surface.contextIri,
      durationMs: Date.now() - startedAt,
      agent: this.agentDid,
    });
    return result;
  }

  /**
   * Encode a payload without dispatching to an adapter. Used by surfaces
   * that emit at non-adapter call sites (S4 well-known DID Document, S6
   * /v1/things, S10 doc-frame build step).
   */
  async encodeStandalone({ surfaceId, payload, context }) {
    if (!this._booted) {
      throw new Error('LinkedDataEncoder.encodeStandalone called before boot()');
    }
    const surface = this.surfaces.get(surfaceId);
    if (!surface) throw new Error(`Unknown surface ${surfaceId}`);
    if (!this._surfaceEnabled(surface.gateKey)) {
      throw new EncodingDisabledError(surface.gateKey);
    }

    // P2-10: validate input before passing to surface encoder.
    const standaloneValidationLimits = (this.manifest.linked_data || {}).input_validation || {};
    try {
      validatePayload(payload, {
        surfaceId: surface.id,
        resolver: this.resolver,
        maxPayloadBytes: standaloneValidationLimits.max_payload_bytes,
        maxStringLength: standaloneValidationLimits.max_string_length,
        maxDepth: standaloneValidationLimits.max_depth,
        maxKeys: standaloneValidationLimits.max_keys,
      });
    } catch (err) {
      if (err instanceof InputValidationError) {
        this.logger.warn?.({
          event: 'linked-data.input-validation-rejected',
          surface: surfaceId,
          code: err.code,
          errorMessage: err.message,
          agent: this.agentDid,
        }) ?? this.logger.warn(`linked-data.input-validation-rejected: ${err.code} — ${err.message}`);
      }
      throw err;
    }

    const encoded = await surface.encode(payload, {
      resolver: this.resolver,
      manifest: this.manifest,
      agentDid: this.agentDid,
      operation: 'standalone',
      context,
    });
    if (surface.canonicalisation === 'jcs' && this.canonicalisation === 'jcs') {
      const canonicalBytes = jcsCanonicalise(encoded.document);
      encoded.canonicalBytes = canonicalBytes;
      encoded.canonicalHash = crypto.createHash('sha256')
        .update(canonicalBytes, 'utf8').digest('hex');
    }
    return encoded;
  }

  _findSurfaceForSlot(slot, operation) {
    // Several surfaces may be associated with the same slot (e.g. S5
    // PROV-O is a parallel emit alongside the regular events JSONL
    // adapter); we match by slot+operation+direction, preferring more
    // specific matches.
    for (const surface of this.surfaces.values()) {
      if (surface.slot !== slot) continue;
      if (!this._surfaceEnabled(surface.gateKey)) continue;
      if (surface.operations && !surface.operations.includes(operation)) continue;
      return surface;
    }
    return null;
  }
}

module.exports = {
  LinkedDataEncoder,
  EncodingDisabledError,
  InputValidationError,
  PayloadTooLargeError,
};
