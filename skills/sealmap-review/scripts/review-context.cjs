'use strict';
// Transport provenance only. Findings and evidence dispositions remain separate.
const crypto = require('node:crypto');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
function modelFamily(model) {
  if (typeof model !== 'string') return null;
  for (const [prefix, family] of [['glm-', 'glm'], ['gemini-', 'gemini'], ['claude-', 'claude'], ['gpt-', 'gpt']]) {
    if (model.toLowerCase().startsWith(prefix)) return family;
  }
  return null;
}
function reviewContext({ pack, files, model, provider, revision, dirty, register = 'include', lens, prompt, runId, reviewedAt }) {
  return {
    schema: 1, run_id: runId, reviewed_at: reviewedAt, revision, dirty,
    pack_sha256: sha256(pack), scope_sha256: sha256(JSON.stringify([...files].sort())),
    topics: [...files].sort(), register, reviewer: { provider, model },
    lens, prompt_sha256: sha256(prompt), complete: true,
  };
}
function comparable(a, b) {
  const valid = (o) => o && o.schema === 1 && o.complete === true && typeof o.run_id === 'string' && o.run_id
    && /^[a-f0-9]{64}$/.test(o.pack_sha256) && /^[a-f0-9]{64}$/.test(o.scope_sha256)
    && ['include', 'strip'].includes(o.register) && modelFamily(o.reviewer?.model);
  return Boolean(valid(a) && valid(b) && a.pack_sha256 === b.pack_sha256 && a.scope_sha256 === b.scope_sha256
    && a.register === b.register && modelFamily(a.reviewer.model) !== modelFamily(b.reviewer.model));
}
module.exports = { sha256, modelFamily, reviewContext, comparable };
