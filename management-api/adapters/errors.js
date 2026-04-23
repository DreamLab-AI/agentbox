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

module.exports = {
  AdapterDisabled,
  NotFound,
  AlreadyClaimed,
  ValidationError,
  PermissionDenied,
  EmbeddingError,
  SpawnError,
};
