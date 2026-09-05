'use strict';

/**
 * Shared adapter error types.
 *
 * @module management-api/adapters/errors
 * @see ADR-005 §Contract test harness — error shape
 * @see PRD-001 §Capabilities and adapters
 */

class AdapterDisabled extends Error {
  constructor(slot) {
    super(`Adapter '${slot}' is disabled`);
    this.name = 'AdapterDisabled';
    this.slot = slot;
    this.code = 'ADAPTER_DISABLED';
  }
}

class NotFound extends Error {
  constructor(resource, id) {
    super(`${resource} '${id}' not found`);
    this.name = 'NotFound';
    this.resource = resource;
    this.id = id;
    this.code = 'NOT_FOUND';
  }
}

class AlreadyClaimed extends Error {
  constructor(id, actor) {
    super(`Bead '${id}' is already claimed by '${actor}'`);
    this.name = 'AlreadyClaimed';
    this.id = id;
    this.actor = actor;
    this.code = 'ALREADY_CLAIMED';
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'VALIDATION_ERROR';
  }
}

class PermissionDenied extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermissionDenied';
    this.code = 'PERMISSION_DENIED';
  }
}

class EmbeddingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EmbeddingError';
    this.code = 'EMBEDDING_ERROR';
  }
}

class SpawnError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SpawnError';
    this.code = 'SPAWN_ERROR';
  }
}

/**
 * Request signing was REQUIRED but could not be produced (ADR-2064).
 *
 * Raised by the pods adapter when `[integrations.solid_pod_rs].sign_requests`
 * is on but no NIP-98 header could be originated — no signer resolvable, the
 * key failed to decrypt, or the originator declined. The adapter fails closed
 * (throws) rather than emitting an unsigned request, so the pods slot degrades
 * visibly instead of silently going out anonymous against a default-deny pod.
 *
 * @see ADR-2064, docs/INGRESS-identity.md §Invariants
 */
class SigningUnavailable extends Error {
  constructor(message, slot = 'pods') {
    super(`Signing unavailable for '${slot}' slot: ${message}`);
    this.name = 'SigningUnavailable';
    this.slot = slot;
    this.code = 'SIGNING_UNAVAILABLE';
  }
}

module.exports = {
  AdapterDisabled,
  NotFound,
  AlreadyClaimed,
  ValidationError,
  PermissionDenied,
  EmbeddingError,
  SpawnError,
  SigningUnavailable,
};
