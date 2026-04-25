'use strict';

/**
 * Linked-Data context resolver — DDD-004 §ContextCatalogue.
 *
 * Loads /opt/agentbox/contexts/index.json once at boot, verifies each
 * ContextDocument's SHA-256 (DDD-004 §L01), populates an in-memory IRI →
 * document map (§L03), and refuses to perform network I/O at runtime
 * (§L09). The encoder calls `resolve(iri)` to obtain a context document
 * by its PinnedContextIRI; unknown IRIs are handled per the manifest's
 * `[linked_data].unknown_context_policy`.
 *
 * Wire into a JSON-LD processor's documentLoader hook so jsonld.js never
 * tries `fetch()` itself:
 *
 *   const resolver = new ContextResolver(opts);
 *   await resolver.boot();
 *   jsonld.documentLoader = resolver.documentLoader();
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CATALOGUE_DIR = '/opt/agentbox/contexts';

class CatalogueIntegrityFailure extends Error {
  constructor(iri, expected, actual) {
    super(
      `CatalogueIntegrityFailure: SHA-256 mismatch for ${iri} ` +
      `(expected ${expected}, got ${actual})`
    );
    this.name = 'CatalogueIntegrityFailure';
    this.iri = iri;
    this.expected = expected;
    this.actual = actual;
  }
}

class UnknownContextError extends Error {
  constructor(iri, surface) {
    super(`UnknownContextError: @context ${iri} not in pinned catalogue` +
          (surface ? ` (surface ${surface})` : ''));
    this.name = 'UnknownContextError';
    this.iri = iri;
    this.surface = surface;
  }
}

class ContextResolver {
  /**
   * @param {object} opts
   * @param {string} [opts.catalogueDir]
   *   Filesystem root holding index.json and the per-context .jsonld files.
   *   Defaults to /opt/agentbox/contexts.
   * @param {"fail-closed"|"fail-open"} [opts.unknownContextPolicy]
   *   What to do when an UnpinnedContextIRI appears in input. Default
   *   "fail-closed".
   * @param {Map<string,string>} [opts.aliases]
   *   Operator-supplied prefix → IRI overrides from
   *   [linked_data.contexts] in the manifest. Each alias must resolve to
   *   a PinnedContextIRI; otherwise boot fails.
   * @param {object} [opts.logger]
   *   Pino-style logger; receives `linked-data.unknown-context` entries.
   */
  constructor(opts = {}) {
    this.catalogueDir = opts.catalogueDir || DEFAULT_CATALOGUE_DIR;
    this.unknownContextPolicy = opts.unknownContextPolicy || 'fail-closed';
    this.aliases = opts.aliases instanceof Map
      ? opts.aliases
      : new Map(Object.entries(opts.aliases || {}));
    this.logger = opts.logger || console;
    this._index = null;
    this._documents = new Map();          // IRI → parsed JSON @context body
    this._byteCache = new Map();          // IRI → raw Buffer (for SHA-256 verification)
    this._booted = false;
  }

  /**
   * Materialise the in-memory catalogue. Idempotent. Throws if the
   * catalogue dir is missing, the index is malformed, or any
   * ContextDocument's SHA-256 mismatches its file bytes.
   */
  async boot() {
    if (this._booted) return;

    const indexPath = path.join(this.catalogueDir, 'index.json');
    let index;
    try {
      const raw = fs.readFileSync(indexPath, 'utf8');
      index = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `ContextResolver.boot: cannot load index at ${indexPath} — ${err.message}`
      );
    }

    if (!index || !Array.isArray(index.entries)) {
      throw new Error(`ContextResolver.boot: malformed index at ${indexPath}`);
    }

    const seenIris = new Set();
    for (const entry of index.entries) {
      if (!entry || typeof entry.iri !== 'string' || typeof entry.name !== 'string') {
        throw new Error('ContextResolver.boot: malformed index entry — requires iri+name');
      }
      // L03: bijective IRI → document mapping; duplicates abort startup.
      if (seenIris.has(entry.iri)) {
        throw new Error(
          `ContextResolver.boot: duplicate IRI in catalogue — ${entry.iri}`
        );
      }
      seenIris.add(entry.iri);

      const docPath = path.join(this.catalogueDir, entry.name);
      let bytes;
      try {
        bytes = fs.readFileSync(docPath);
      } catch (err) {
        throw new Error(
          `ContextResolver.boot: cannot read ${docPath} — ${err.message}`
        );
      }

      // L01: SHA-256 verification when the index carries a sha256 field.
      // The Nix derivation may include the SRI hash for first-party docs;
      // entries materialised via fetchurl carry the SRI in the build closure
      // and we don't re-verify here (the FOD already verified at fetch time).
      // Re-verification only applies when the index explicitly declares a
      // sha256 we should re-check at boot.
      if (entry.sha256) {
        const actual = 'sha256-' +
          crypto.createHash('sha256').update(bytes).digest('base64');
        if (actual !== entry.sha256) {
          throw new CatalogueIntegrityFailure(entry.iri, entry.sha256, actual);
        }
      }

      let parsed;
      try {
        parsed = JSON.parse(bytes.toString('utf8'));
      } catch (err) {
        throw new Error(
          `ContextResolver.boot: ${entry.iri} is not valid JSON — ${err.message}`
        );
      }

      this._documents.set(entry.iri, parsed);
      this._byteCache.set(entry.iri, bytes);
    }

    // Validate operator aliases — every alias must resolve into the catalogue.
    for (const [prefix, iri] of this.aliases.entries()) {
      if (!this._documents.has(iri)) {
        throw new Error(
          `ContextResolver.boot: alias '${prefix}' → ${iri} not in pinned catalogue ` +
          `(define it in lib/linked-data-contexts.nix or pick a pinned IRI)`
        );
      }
    }

    this._index = index;
    this._booted = true;
  }

  /**
   * Synchronously resolve an IRI to its pinned context document.
   * Unknown IRIs are handled per `unknownContextPolicy`.
   *
   * @returns {object} parsed @context document
   * @throws {UnknownContextError} when policy is fail-closed
   */
  resolve(iri, { surface } = {}) {
    if (!this._booted) {
      throw new Error('ContextResolver.resolve called before boot()');
    }
    if (this._documents.has(iri)) {
      return this._documents.get(iri);
    }
    // §5.3 of PRD-006: operator aliases let one prefix resolve to a different
    // pinned IRI. The catalogue still has to know about the destination IRI;
    // this is enforced at boot.
    if (this.aliases.has(iri)) {
      const aliased = this.aliases.get(iri);
      if (this._documents.has(aliased)) return this._documents.get(aliased);
    }
    return this._handleUnknown(iri, surface);
  }

  _handleUnknown(iri, surface) {
    if (this.unknownContextPolicy === 'fail-open') {
      this.logger.warn?.({
        event: 'linked-data.unknown-context',
        iri, surface, policy: 'fail-open', action: 'stub-substituted',
      }) ?? this.logger.log(`linked-data.unknown-context (fail-open): ${iri}`);
      // Stub: every term is xsd:string, no shortening, no coercion.
      return {
        '@context': {
          '@version': 1.1,
          '@vocab': 'urn:agentbox:unknown-context:',
        },
      };
    }
    // fail-closed (default): raise.
    this.logger.warn?.({
      event: 'linked-data.unknown-context',
      iri, surface, policy: 'fail-closed', action: 'rejected',
    }) ?? this.logger.error(`linked-data.unknown-context (fail-closed): ${iri}`);
    throw new UnknownContextError(iri, surface);
  }

  /**
   * Document loader compatible with jsonld.js. Returns a
   * RemoteDocument-shaped object so the JSON-LD processor doesn't try
   * to fetch. L09: this loader never reaches the network.
   */
  documentLoader() {
    const self = this;
    return async function pinnedDocumentLoader(url) {
      const ctx = self.resolve(url);
      return {
        contextUrl: null,
        document: ctx,
        documentUrl: url,
      };
    };
  }

  /** Iterate every PinnedContextIRI. */
  iris() {
    return Array.from(this._documents.keys());
  }

  /** Inspect a parsed context body without loader semantics. Used by tests. */
  raw(iri) {
    return this._documents.get(iri);
  }

  /** Diagnostic accessor — surface set known to the boot index. */
  surfaces() {
    if (!this._index) return [];
    const set = new Set();
    for (const e of this._index.entries) {
      for (const s of e.surfaces || []) set.add(s);
    }
    return Array.from(set).sort();
  }

  /**
   * Synchronous resolver for embedded use. Unlike `resolve`, this never
   * throws — fail-closed becomes `null`. Internal code paths that want to
   * branch on presence (e.g. the round-trip tester checking whether a
   * surface's expected context is loaded) use this.
   */
  tryResolve(iri) {
    if (!this._booted) return null;
    if (this._documents.has(iri)) return this._documents.get(iri);
    if (this.aliases.has(iri)) {
      const aliased = this.aliases.get(iri);
      return this._documents.get(aliased) || null;
    }
    return null;
  }
}

module.exports = {
  ContextResolver,
  CatalogueIntegrityFailure,
  UnknownContextError,
  DEFAULT_CATALOGUE_DIR,
};
