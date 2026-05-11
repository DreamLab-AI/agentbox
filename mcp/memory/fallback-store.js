/**
 * In-memory fallback store — satisfies the memoryStore interface used by
 * mcp-server.js.  Actual durable storage happens via podMemoryStore() in
 * mcp-server.js (management API → ruvector-postgres).
 */

class FallbackStore {
  constructor() {
    this._store = new Map();
    this._fallback = true;
  }

  async initialize() {}

  _nsKey(key, namespace = 'default') {
    return `${namespace}::${key}`;
  }

  async store(key, value, options = {}) {
    const ns = options.namespace || 'default';
    const nk = this._nsKey(key, ns);
    this._store.set(nk, { key, value, namespace: ns, metadata: options.metadata || {}, stored_at: new Date().toISOString() });
    return { size: typeof value === 'string' ? value.length : JSON.stringify(value).length };
  }

  async retrieve(key, options = {}) {
    const ns = options.namespace || 'default';
    const entry = this._store.get(this._nsKey(key, ns));
    return entry ? entry.value : null;
  }

  async list(options = {}) {
    const ns = options.namespace || 'default';
    const limit = options.limit || 100;
    const prefix = `${ns}::`;
    const results = [];
    for (const [nk, entry] of this._store) {
      if (nk.startsWith(prefix)) results.push({ key: entry.key, value: entry.value });
      if (results.length >= limit) break;
    }
    return results;
  }

  async delete(key, options = {}) {
    const ns = options.namespace || 'default';
    return this._store.delete(this._nsKey(key, ns));
  }

  async search(pattern, options = {}) {
    const ns = options.namespace || 'default';
    const limit = options.limit || 50;
    const prefix = `${ns}::`;
    const lower = pattern.toLowerCase();
    const results = [];
    for (const [nk, entry] of this._store) {
      if (!nk.startsWith(prefix)) continue;
      const val = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
      if (entry.key.toLowerCase().includes(lower) || val.toLowerCase().includes(lower)) {
        results.push({ key: entry.key, value: entry.value });
      }
      if (results.length >= limit) break;
    }
    return results;
  }

  isUsingFallback() {
    return this._fallback;
  }
}

export const memoryStore = new FallbackStore();
