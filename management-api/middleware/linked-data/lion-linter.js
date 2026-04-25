'use strict';

/**
 * Linked Object Notation (LION) linter — PRD-006 §6.1, DDD-004 §LIONDocument.
 *
 * Enforces the five LION rules on hand-authored JSON-LD documents:
 *
 *   1. `@id` is a URL — every node object has an absolute IRI or a
 *      base-relative IRI under the document's base.
 *   2. `@type` is optional but, if present, is a URL or a term defined
 *      in the inherited @context.
 *   3. `@context` defaults are inherited — documents inheriting from a
 *      surface (S7, S10) need not declare `@context`.
 *   4. Properties are URLs or terms — no bare unprefixed strings unless
 *      the inherited @context defines them.
 *   5. No `@protected` overrides — LION may not redefine terms that the
 *      surface's published @context marks `@protected`.
 *
 * Public API:
 *
 *   const linter = new LIONLinter({ resolver, surface, baseIRI });
 *   const result = linter.lint(parsed);
 *   if (!result.ok) {
 *     for (const err of result.errors) console.error(err.code, err.message);
 *   }
 *
 * The linter is intentionally synchronous and free of network I/O.
 */

const path = require('path');
const fs = require('fs');

class LIONError {
  constructor(code, message, ptr = '') {
    this.code = code;
    this.message = message;
    this.pointer = ptr;
  }
}

const ABSOLUTE_IRI_RE = /^[a-zA-Z][a-zA-Z0-9+.\-]*:/;
const KEYWORD_RE = /^@[a-zA-Z]+$/;

class LIONLinter {
  /**
   * @param {object} opts
   * @param {object} opts.resolver — ContextResolver instance
   * @param {string} [opts.surface] — surfaceId (e.g. "S7", "S10") used to
   *   look up the inherited context. If omitted, the document MUST
   *   declare its own `@context`.
   * @param {string} [opts.baseIRI] — base IRI for resolving relative @id
   *   references. Defaults to the surface's known base.
   * @param {string[]} [opts.inheritedContextIRIs] — explicit @context IRI
   *   list to inherit from (e.g. for S10 architecture-doc frames).
   */
  constructor({ resolver, surface, baseIRI, inheritedContextIRIs } = {}) {
    if (!resolver) throw new Error('LIONLinter requires a ContextResolver');
    this.resolver = resolver;
    this.surface = surface;
    this.baseIRI = baseIRI;
    this.inheritedContextIRIs = inheritedContextIRIs || [];
    this._termCache = null;
    this._protectedCache = null;
  }

  /**
   * Lint a parsed JSON-LD document. Returns
   *
   *   { ok: boolean, errors: LIONError[], warnings: LIONError[] }
   */
  lint(doc) {
    const errors = [];
    const warnings = [];

    if (doc === null || typeof doc !== 'object') {
      errors.push(new LIONError('LION001', 'Document root must be a JSON object or array'));
      return { ok: false, errors, warnings };
    }

    // Build the term/protected-term set once per lint pass.
    this._buildTermTable(doc, errors);

    // Recursively walk the doc.
    if (Array.isArray(doc)) {
      doc.forEach((node, i) => this._walk(node, errors, warnings, `[${i}]`));
    } else {
      this._walk(doc, errors, warnings, '');
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
    };
  }

  _buildTermTable(doc, errors) {
    this._termCache = new Set([
      '@id', '@type', '@context', '@graph', '@list', '@set', '@value',
      '@language', '@direction', '@index', '@reverse', '@included',
      '@nest', '@version', '@vocab', '@base', '@import', '@propagate',
      '@protected', '@none', '@prefix', '@json',
    ]);
    this._protectedCache = new Set();

    const inheritedIRIs = [...this.inheritedContextIRIs];
    if (this.surface && inheritedIRIs.length === 0) {
      // Default per-surface inheritance — operators add more as needed.
      inheritedIRIs.push('https://agentbox.dreamlab-ai.systems/ns/v1#');
    }
    for (const iri of inheritedIRIs) {
      const ctx = this.resolver.tryResolve(iri);
      if (!ctx) {
        errors.push(new LIONError(
          'LION002',
          `inherited context ${iri} is not pinned in the catalogue`,
        ));
        continue;
      }
      this._collectTerms(ctx, this._termCache, this._protectedCache);
    }

    // Allow document-supplied @context to extend the term table; rule 5
    // forbids overriding inherited protected terms but not extending.
    const docCtx = doc && !Array.isArray(doc) && doc['@context'];
    if (docCtx) {
      const docContexts = Array.isArray(docCtx) ? docCtx : [docCtx];
      for (const c of docContexts) {
        if (typeof c === 'string') {
          const resolved = this.resolver.tryResolve(c);
          if (resolved) this._collectTerms(resolved, this._termCache, this._protectedCache);
          // unresolved string contexts are caught by the encoder later;
          // the LION linter does not duplicate that fail-closed semantics.
        } else if (c && typeof c === 'object') {
          // LION rule 5: catch overrides of inherited protected terms.
          const localCtx = c['@context'] || c;
          if (localCtx && typeof localCtx === 'object') {
            for (const k of Object.keys(localCtx)) {
              if (this._protectedCache.has(k)) {
                errors.push(new LIONError(
                  'LION005',
                  `LION rule 5: term '${k}' is @protected by an inherited context and may not be redefined`,
                  '@context'
                ));
              }
              this._termCache.add(k);
            }
          }
        }
      }
    }
  }

  _collectTerms(ctxDocument, termSet, protectedSet) {
    // The catalogue stores each context document as { "@context": { … } }.
    // Some W3C contexts also carry top-level helpers; we descend into the
    // explicit @context map only.
    const inner = ctxDocument['@context'] || ctxDocument;
    if (!inner || typeof inner !== 'object') return;
    const contexts = Array.isArray(inner) ? inner : [inner];
    for (const ctx of contexts) {
      if (typeof ctx === 'string') {
        const resolved = this.resolver.tryResolve(ctx);
        if (resolved) this._collectTerms(resolved, termSet, protectedSet);
        continue;
      }
      if (!ctx || typeof ctx !== 'object') continue;
      const isCtxProtected = ctx['@protected'] === true;
      for (const [k, v] of Object.entries(ctx)) {
        if (k.startsWith('@')) continue;
        termSet.add(k);
        if (isCtxProtected || (v && typeof v === 'object' && v['@protected'] === true)) {
          protectedSet.add(k);
        }
      }
    }
  }

  _walk(node, errors, warnings, ptr) {
    if (Array.isArray(node)) {
      node.forEach((child, i) => this._walk(child, errors, warnings, `${ptr}[${i}]`));
      return;
    }
    if (node === null || typeof node !== 'object') return;

    // Rule 1: @id must be a URL or base-relative.
    if ('@id' in node || 'id' in node) {
      const idValue = node['@id'] ?? node.id;
      if (typeof idValue !== 'string' || idValue === '') {
        errors.push(new LIONError(
          'LION001',
          `LION rule 1: @id must be a non-empty string, got ${typeof idValue}`,
          ptr,
        ));
      } else if (!ABSOLUTE_IRI_RE.test(idValue) && !idValue.startsWith('_:')) {
        // Base-relative is allowed iff a baseIRI is configured.
        if (!this.baseIRI) {
          errors.push(new LIONError(
            'LION001',
            `LION rule 1: relative @id '${idValue}' but no baseIRI is configured`,
            ptr,
          ));
        }
      }
    }

    // Rule 2: @type if present is a URL or a known term.
    if ('@type' in node || 'type' in node) {
      const tValue = node['@type'] ?? node.type;
      const types = Array.isArray(tValue) ? tValue : [tValue];
      for (const t of types) {
        if (typeof t !== 'string') {
          errors.push(new LIONError('LION002', `LION rule 2: @type values must be strings`, ptr));
          continue;
        }
        if (KEYWORD_RE.test(t)) continue;        // keyword form is allowed
        if (ABSOLUTE_IRI_RE.test(t)) continue;   // absolute IRI is allowed
        if (this._termCache.has(t)) continue;    // known term in inherited context
        // Compact IRI with prefix — accept if prefix is in the term cache.
        const colonIdx = t.indexOf(':');
        if (colonIdx > 0 && this._termCache.has(t.slice(0, colonIdx))) continue;
        errors.push(new LIONError(
          'LION002',
          `LION rule 2: @type '${t}' is not a URL and not defined in the inherited @context`,
          ptr,
        ));
      }
    }

    // Rule 4: every property is a known term, a URL, a compact IRI, or a keyword.
    for (const key of Object.keys(node)) {
      if (key.startsWith('@')) continue;
      if (key === 'id' || key === 'type') continue;     // common LION aliases
      if (this._termCache.has(key)) continue;
      if (ABSOLUTE_IRI_RE.test(key)) continue;
      const colonIdx = key.indexOf(':');
      if (colonIdx > 0 && this._termCache.has(key.slice(0, colonIdx))) continue;
      errors.push(new LIONError(
        'LION004',
        `LION rule 4: property '${key}' is not a URL, compact IRI, or known term`,
        `${ptr}/${key}`,
      ));
    }

    // Rule 3: @context inheritance (informational). LION authors usually
    // omit @context. If present, ensure every IRI is in the catalogue.
    if (node['@context']) {
      const ctxs = Array.isArray(node['@context']) ? node['@context'] : [node['@context']];
      for (const c of ctxs) {
        if (typeof c === 'string' && !this.resolver.tryResolve(c)) {
          errors.push(new LIONError(
            'LION003',
            `LION rule 3: @context IRI ${c} is not in the pinned catalogue`,
            `${ptr}/@context`,
          ));
        }
      }
    }

    // Recurse.
    for (const v of Object.values(node)) {
      this._walk(v, errors, warnings, ptr);
    }
  }

  /**
   * Lint a markdown file's JSON-LD frontmatter or first <script
   * type="application/ld+json"> block. Returns the same shape as `lint`.
   */
  lintMarkdown(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const fence = extractFrontmatterJsonld(raw);
    if (!fence) {
      return { ok: true, errors: [], warnings: [] };  // no JSON-LD == no opinion
    }
    let parsed;
    try {
      parsed = JSON.parse(fence);
    } catch (err) {
      return {
        ok: false,
        errors: [new LIONError('LION000', `JSON parse error in ${filePath}: ${err.message}`)],
        warnings: [],
      };
    }
    return this.lint(parsed);
  }
}

function extractFrontmatterJsonld(markdown) {
  // Look for a <script type="application/ld+json"> ... </script> block.
  const scriptRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i;
  const m = markdown.match(scriptRe);
  if (m) return m[1].trim();
  // Look for a fenced ```jsonld block.
  const fenceRe = /```jsonld\s*\n([\s\S]*?)\n```/;
  const f = markdown.match(fenceRe);
  if (f) return f[1].trim();
  return null;
}

module.exports = {
  LIONLinter,
  LIONError,
  extractFrontmatterJsonld,
};
