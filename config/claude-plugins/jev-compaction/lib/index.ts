// Vendored from tamaratran/fast-jev-compaction e3f262a (MIT, see LICENSE).
// The upstream HTTP client (client.ts, messages.ts) is deliberately not vendored:
// inside the engine there is no global fetch or process; the adapter in
// ../hooks supplies transport through `$.http.fetch`.
export * from './types.js';
export * from './request.js';
export * from './state.js';
export * from './compact.js';
