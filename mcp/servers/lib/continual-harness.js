'use strict';

/**
 * continual-harness — evidence-anchored, signed, git-rollbackable refinement of
 * the MUTABLE harness layer, over an IMMUTABLE base that must never change.
 *
 * Adapted from prime-agent's Continual Harness (PrimeIntellect-ai/prime-agent),
 * bound to our substrate. Where prime versions harness state with flat-file
 * snapshots, we version it with git (content-addressed immutable history +
 * rollback), attribute every refine to a DID/Nostr operator key, and require
 * each one to cite the evidence that justified it. RuVector stays the semantic
 * index; THIS is the durable, revertable, attributed source of truth that
 * RuVector's upsert-by-key store structurally lacks (a corrected memory there
 * silently loses its prior value — here every value change is a revertable
 * commit).
 *
 * TWO LAYERS, ONE HARD INVARIANT
 *   immutable base   — the CLAUDE.md tier files. A refine that resolves onto any
 *                      of them is REJECTED. This is the one rule prime insists on
 *                      ("never rewrite the base prompt") and we enforce it as a
 *                      path guard, not a convention.
 *   mutable harness  — a git-tracked dir ($AGENTBOX_HARNESS_DIR) holding four
 *                      refinable kinds: supplemental-prompt | memory | skill-spec
 *                      | subagent-spec. Every refine is one git commit carrying
 *                      Refine-Evidence / Refine-Operator / Refine-Signature.
 *
 * Signing is fail-open: with the management-api key present each refine is
 * Schnorr-signed by the operator DID; without it (dev shell) the commit is still
 * made and attributed, with the signature recorded as "deferred".
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const LAYERS = ['supplemental-prompt', 'memory', 'skill-spec', 'subagent-spec'];
// Local signing-event kind. NOT published to any relay — it exists only to
// produce a Schnorr signature over the refine payload via the standard signer.
const REFINE_KIND = 30841;

function stateDir() {
  return process.env.AGENTBOX_STATE || process.env.AGENTBOX_STATE_DIR || '/home/devuser/.agentbox';
}

function defaultHarnessDir() {
  return process.env.AGENTBOX_HARNESS_DIR || path.join(stateDir(), 'harness');
}

function defaultImmutableBase() {
  if (process.env.AGENTBOX_IMMUTABLE_BASE) {
    return process.env.AGENTBOX_IMMUTABLE_BASE.split(':').filter(Boolean).map((p) => path.resolve(p));
  }
  const home = process.env.HOME || '/home/devuser';
  const bases = [
    path.join(home, '.claude', 'CLAUDE.md'),
    path.join(home, 'workspace', 'CLAUDE.md'),
  ];
  // ADR-2028: the corpus tier of the immutable base is the vault's own
  // CLAUDE.md, located through the [vault] path authority rather than a
  // hard-coded corpus path. Same optional semantics as the other two entries —
  // an absent file (or an unconfigured vault) simply contributes no layer.
  if (process.env.VAULT_ROOT) bases.push(path.join(process.env.VAULT_ROOT, 'CLAUDE.md'));
  return bases.map((p) => path.resolve(p));
}

function defaultOperator() {
  return process.env.AGENTBOX_REFINE_OPERATOR || 'did:nostr:jjohare';
}

function git(dir, args, opts = {}) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', ...opts }).trim();
}

// key must be a safe slug: no slashes, no dots, so it can never traverse out of
// its layer dir onto (say) ../../.claude/CLAUDE.md.
function slugOk(s) {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(s);
}

/**
 * Default operator signer. Signs a canonical refine string with the
 * management-api Nostr key via the standard signer.sign(event) API. Returns
 * { sig, pubkey } or null when the key material is absent (dev) — the caller
 * records "deferred" and still commits (fail-open attribution).
 */
async function defaultSign(canonical, meta = {}) {
  try {
    const { loadSigner } = require('../nostr-bridge');
    const signer = loadSigner('management-api');
    if (!signer || typeof signer.sign !== 'function') return null;
    const event = {
      kind: REFINE_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['refine-key', meta.key || ''], ['evidence', meta.evidence || '']],
      content: crypto.createHash('sha256').update(canonical).digest('hex'),
    };
    const signed = await signer.sign(event);
    return signed && signed.sig ? { sig: signed.sig, pubkey: signed.pubkey || null } : null;
  } catch (_) {
    return null; // key material unavailable → deferred
  }
}

/**
 * @param {object} [opts]
 * @param {string}   [opts.harnessDir]    - mutable layer dir (git-backed)
 * @param {string[]} [opts.immutableBase] - absolute paths a refine must never touch
 * @param {string}   [opts.operatorDid]   - attribution DID (default did:nostr:jjohare)
 * @param {Function} [opts.sign]          - (canonical, {key,evidence}) => Promise<{sig,pubkey}|null>
 */
function createHarness(opts = {}) {
  const harnessDir = path.resolve(opts.harnessDir || defaultHarnessDir());
  const immutableBase = (opts.immutableBase || defaultImmutableBase()).map((p) => path.resolve(p));
  const operator = opts.operatorDid || defaultOperator();
  const sign = opts.sign || defaultSign;

  function ensureRepo() {
    fs.mkdirSync(harnessDir, { recursive: true });
    if (!fs.existsSync(path.join(harnessDir, '.git'))) {
      git(harnessDir, ['init', '-q']);
      const readme = path.join(harnessDir, 'README.md');
      fs.writeFileSync(
        readme,
        '# Continual Harness (mutable layer)\n\n' +
          'Git-tracked, evidence-anchored, operator-signed refines of supplemental\n' +
          'prompts, memories, and skill/subagent specs. The immutable base (the\n' +
          'CLAUDE.md tiers) is never written here — refines that resolve onto it are\n' +
          'rejected. Roll back any refine with `git revert`.\n',
      );
      git(harnessDir, ['add', 'README.md']);
      git(harnessDir, ['-c', 'user.name=agentbox', '-c', 'user.email=agentbox@local',
        'commit', '-q', '-m', 'chore(harness): initialise mutable layer']);
    }
  }

  // Resolve + guard a refine target. Throws on traversal or immutable-base hit.
  function targetPath(layer, key) {
    const p = path.resolve(harnessDir, layer, `${key}.md`);
    if (p !== harnessDir && !p.startsWith(harnessDir + path.sep)) {
      throw new Error(`refine target escapes the harness dir: ${p}`);
    }
    if (immutableBase.includes(p)) {
      throw new Error(`refuse to write an immutable base file: ${p}`);
    }
    return p;
  }

  /**
   * Apply one refine to the mutable layer as a signed, evidence-anchored commit.
   * @returns {Promise<{changed, commit, path, signature, signed}>}
   */
  async function refine({ layer, key, value, evidence, reason, actor } = {}) {
    if (!LAYERS.includes(layer)) throw new Error(`layer must be one of: ${LAYERS.join(', ')}`);
    if (!slugOk(key)) throw new Error('key must match [a-z0-9-] and be <=128 chars');
    if (typeof value !== 'string' || !value.trim()) throw new Error('value (the refined content) is required');
    if (typeof evidence !== 'string' || !evidence.trim()) {
      throw new Error('evidence is required — a refine must cite the transcript span / commit / test that justifies it');
    }
    ensureRepo();
    const p = targetPath(layer, key);
    fs.mkdirSync(path.dirname(p), { recursive: true });

    const now = new Date().toISOString();
    const doc = [
      '---',
      `layer: ${layer}`,
      `key: ${key}`,
      `operator: ${operator}`,
      `actor: ${actor || operator}`,
      `evidence: ${JSON.stringify(evidence)}`,
      `updated: ${now}`,
      '---',
      '',
      value.trim(),
      '',
    ].join('\n');
    fs.writeFileSync(p, doc);

    const rel = path.relative(harnessDir, p);
    git(harnessDir, ['add', rel]);
    // Idempotent: identical content stages nothing — return HEAD unchanged.
    if (!git(harnessDir, ['diff', '--cached', '--name-only'])) {
      return { changed: false, commit: git(harnessDir, ['rev-parse', 'HEAD']), path: p, signature: null, signed: false };
    }

    const canonical = `${layer}\n${key}\n${value.trim()}\n${evidence}`;
    const sig = await sign(canonical, { key, evidence });

    const msg = [
      `refine(${layer}): ${key}`,
      '',
      reason ? reason.trim() : '(no reason given)',
      '',
      `Refine-Layer: ${layer}`,
      `Refine-Key: ${key}`,
      `Refine-Evidence: ${evidence.replace(/\s+/g, ' ').trim()}`,
      `Refine-Operator: ${operator}`,
      `Refine-Signature: ${sig ? sig.sig : 'deferred'}`,
      `Refine-Pubkey: ${sig && sig.pubkey ? sig.pubkey : '(deferred)'}`,
    ].join('\n');
    git(harnessDir, ['-c', `user.name=${operator}`, '-c', 'user.email=refine@agentbox',
      'commit', '-q', '-m', msg]);
    return {
      changed: true,
      commit: git(harnessDir, ['rev-parse', 'HEAD']),
      path: p,
      signature: sig ? sig.sig : 'deferred',
      signed: !!sig,
    };
  }

  /**
   * Guard: does `ref` touch ONLY the mutable layer, and never the immutable base?
   * Usable as a pre-commit / post-hoc check. Returns { compliant, violations }.
   */
  function validate(ref = 'HEAD') {
    ensureRepo();
    const violations = [];
    let names;
    try {
      names = git(harnessDir, ['show', '--name-only', '--pretty=format:', ref]).split('\n').filter(Boolean);
    } catch (e) {
      return { compliant: false, violations: [`cannot read ref ${ref}: ${e.message}`], ref };
    }
    for (const n of names) {
      const abs = path.resolve(harnessDir, n);
      if (!abs.startsWith(harnessDir + path.sep)) violations.push(`escapes harness dir: ${n}`);
      if (immutableBase.includes(abs)) violations.push(`touches immutable base: ${n}`);
      const top = n.split('/')[0];
      if (top !== 'README.md' && !LAYERS.includes(top)) violations.push(`writes outside a known layer: ${n}`);
    }
    return { compliant: violations.length === 0, violations, ref };
  }

  /** Roll back a specific refine via git revert (history preserved). */
  function rollback(ref) {
    if (!ref) throw new Error('rollback requires a commit ref');
    ensureRepo();
    git(harnessDir, ['-c', `user.name=${operator}`, '-c', 'user.email=refine@agentbox',
      'revert', '--no-edit', ref]);
    return { reverted: ref, commit: git(harnessDir, ['rev-parse', 'HEAD']) };
  }

  /** Commit log for the harness, or a layer, or a single key. */
  function history({ layer, key, limit = 20 } = {}) {
    ensureRepo();
    const args = ['log', `-n${limit}`, '--pretty=format:%H%x09%s%x09%an'];
    if (layer && key) args.push('--', path.join(layer, `${key}.md`));
    else if (layer) args.push('--', layer);
    const out = git(harnessDir, args);
    return out
      ? out.split('\n').map((l) => {
          const [commit, subject, author] = l.split('\t');
          return { commit, subject, author };
        })
      : [];
  }

  /** Current contents of the mutable layer, by layer. */
  function list() {
    ensureRepo();
    const result = {};
    for (const layer of LAYERS) {
      const dir = path.join(harnessDir, layer);
      result[layer] = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
        : [];
    }
    return result;
  }

  return { harnessDir, immutableBase, operator, LAYERS, refine, validate, rollback, history, list, ensureRepo };
}

module.exports = { createHarness, LAYERS, defaultHarnessDir, defaultImmutableBase, defaultOperator };
