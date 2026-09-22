'use strict';

/**
 * ADR-2106 — a signed governance Promote/Demote applies through `vault edit`.
 *
 * The forum (nostr-rust-forum ADR-2013) turns a human's signed kind-31403 into
 * one of two ontology outcomes: `{"action":"promote","iri":"urn:ngm:class:…"}`
 * or `{"action":"demote","iri":"…"}`. This module is what that decision *does*:
 * it resolves the IRI to a vault page, runs a guarded `vault edit`, and then
 * records the application in Loom's attestation ledger.
 *
 * Three rules shape every choice here.
 *
 * 1. **The write is guarded.** `vault edit` refuses without `--expect`, and we
 *    always declare `docs=1,blocks=1`: a decision about one page must touch one
 *    page. If the vault disagrees the edit fails and nothing is written — which
 *    is the correct outcome for a decision whose subject moved underneath it.
 *
 * 2. **The ledger never blocks the decision.** Loom's `/loom/attest` is a
 *    record of what happened, not a precondition for it. A 404 (the route not
 *    deployed yet), a connection refusal or a timeout is logged and the apply
 *    still reports success, because the page HAS been written and reporting
 *    otherwise would be a lie the receipt ladder would then carry.
 *
 * 3. **The subject comes from the signed bytes.** The IRI is read off the
 *    human's own 31403 content, never from the 31402 the agent published. The
 *    31402 is the agent's claim about what it wants; the 31403 is the person's
 *    claim about what they approved, and only the latter was signed by the
 *    party whose authority the write rests on.
 *
 * The `vault` binary is WS-C's and does not exist yet. It is invoked through
 * `$VAULT_BIN` (default `vault`) so this module is testable today against a
 * stub on PATH that records its argv, and needs no change when the real binary
 * lands.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/** Default Loom façade. Deployment B (`visionclaw_network` sidecar). */
const DEFAULT_LOOM_BASE = 'http://loom:8080';

/** How long a `vault edit` may take before we give up on it. */
const VAULT_TIMEOUT_MS = 120_000;

/** How long the ledger call may take. Short: it is never load-bearing. */
const ATTEST_TIMEOUT_MS = 10_000;

/**
 * The environment a `vault` invocation gets. Explicitly allow-listed, matching
 * the house rule already applied to `git` in `routes/git-bridge.js`: a governed
 * corpus write inherits nothing it was not given.
 */
function vaultEnv() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    VAULT_ROOT: process.env.VAULT_ROOT || '',
    VAULT_BIN: process.env.VAULT_BIN || '',
  };
}

function vaultBin() {
  return process.env.VAULT_BIN || 'vault';
}

function loomBase() {
  return (process.env.LOOM_BASE_URL || DEFAULT_LOOM_BASE).replace(/\/+$/, '');
}

/**
 * The slug half of a `resource` IRI, per contract C1
 * (`resource = namespace + slug(title)`).
 *
 * Lowercase, every run of non-alphanumerics collapsed to one hyphen, no
 * leading or trailing hyphen. This is the ONE place the rule is written; the
 * resolver below re-derives it from candidate page ids rather than trusting
 * any mapping supplied over the wire.
 */
function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The slug of an IRI: everything after the last `:`. */
function iriSlug(iri) {
  const s = String(iri || '');
  const idx = s.lastIndexOf(':');
  return idx === -1 ? slugify(s) : slugify(s.slice(idx + 1));
}

/**
 * Resolve a `resource` IRI to the vault page id `vault edit` takes (C2: the
 * vault-relative path without `.md`).
 *
 * The IRI is not reversible to a title — `slug()` is lossy, and
 * `rgb-d-camera` could be "RGB-D Camera" or "RGB D camera". So we ask the
 * vault, and then **verify**: a candidate is only accepted when re-slugifying
 * its own id reproduces the IRI's slug exactly. That turns a fuzzy search into
 * an exact lookup, and a search that returns two exact matches is a corpus bug
 * (two pages claiming one IRI) which must stop the write rather than pick one.
 *
 * A `page` carried on the decision is a hint, not an authority: it is verified
 * against the IRI the same way, so a decision naming a page that does not
 * answer to its own IRI is refused.
 *
 * @returns {Promise<string>} the page id
 * @throws when zero or more than one page answers to the IRI
 */
async function resolveIriToPage(iri, { runVault = runVaultCommand, page = null } = {}) {
  const wanted = iriSlug(iri);
  if (!wanted) throw new Error(`ontology-apply: unusable IRI ${JSON.stringify(iri)}`);

  if (page) {
    if (slugify(basename(page)) !== wanted) {
      throw new Error(
        `ontology-apply: decision names page "${page}" which does not answer to ${iri}`,
      );
    }
    return page;
  }

  const found = await runVault(['find', '--query', wanted.replace(/-/g, ' '), '--limit', '25', '--json']);
  const rows = Array.isArray(found) ? found : (found && found.results) || [];
  const exact = rows.filter(r => r && r.id && slugify(basename(r.id)) === wanted);

  if (exact.length === 1) return exact[0].id;
  if (exact.length === 0) throw new Error(`ontology-apply: no vault page answers to ${iri}`);
  throw new Error(
    `ontology-apply: ${exact.length} vault pages claim ${iri} (${exact.map(r => r.id).join(', ')}) — ` +
      'a corpus conflict the vault gate must resolve before any write',
  );
}

/** The last path segment of a page id, which is what the IRI was slugged from. */
function basename(id) {
  const parts = String(id).split('/');
  return parts[parts.length - 1];
}

/**
 * Run `vault <args>` and parse its `--json` output.
 *
 * argv array, never a shell string — the house no-shell rule
 * (`lib/project-tracker.js:27`), and here it also means an IRI containing shell
 * metacharacters is data rather than code.
 */
async function runVaultCommand(args, { timeoutMs = VAULT_TIMEOUT_MS } = {}) {
  const { stdout } = await execFileAsync(vaultBin(), args, {
    env: vaultEnv(),
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  const text = String(stdout || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * The `--set` arguments for an outcome.
 *
 * `verified+=` is an APPEND, not an assignment: OKF trust is a list of
 * attestations and a human's signature adds to the machine's rather than
 * replacing it. A demotion does not append one — `status: deprecated` is a
 * statement that the page should not be trusted, and stamping a fresh
 * `verified` beside it would say the opposite.
 */
function setArgsFor(outcome, { npub, at }) {
  if (outcome === 'promote') {
    return [
      '--set', 'status=stable',
      '--set', `verified+=${JSON.stringify({ by: `human:${npub}`, at })}`,
    ];
  }
  return ['--set', 'status=deprecated'];
}

/**
 * Apply one signed ontology decision.
 *
 * @param {object} decision
 * @param {'promote'|'demote'} decision.outcome
 * @param {string} decision.iri           subject, from the signed 31403 content
 * @param {string} decision.signerNpub    the human who signed it
 * @param {string} decision.at            ISO-8601 of the 31403's `created_at`
 * @param {string} decision.caseId
 * @param {string} decision.digest
 * @param {string} [decision.page]        optional hint, verified against `iri`
 * @param {object} [deps]                 `runVault`, `fetchFn` — injected in tests
 * @returns {Promise<{applied: boolean, page: string, outcome: string, attested: boolean,
 *                    attestError: string|null}>}
 */
async function applyOntologyDecision(decision, deps = {}) {
  const { outcome, iri, signerNpub, at, caseId, digest, page: pageHint } = decision;
  if (outcome !== 'promote' && outcome !== 'demote') {
    throw new Error(`ontology-apply: ${outcome} is not an ontology outcome`);
  }
  if (!iri) throw new Error('ontology-apply: the signed decision carries no iri');

  const runVault = deps.runVault || runVaultCommand;
  const page = await resolveIriToPage(iri, { runVault, page: pageHint });

  // The guard is not optional and not configurable: one decision, one page.
  await runVault([
    'edit', page,
    ...setArgsFor(outcome, { npub: signerNpub, at }),
    '--expect', 'docs=1,blocks=1',
    '--json',
  ]);

  const ledger = await attest(
    {
      case_id: caseId,
      digest,
      outcome,
      signer: signerNpub,
      at,
    },
    deps,
  );

  return {
    applied: true,
    page,
    outcome,
    attested: ledger.ok,
    attestError: ledger.error,
  };
}

/**
 * Record the application in Loom's attestation ledger — fail-open.
 *
 * Every failure mode collapses to `{ok: false, error}`: a 404 because WS-H has
 * not deployed the route, a 502 because the façade is down, a timeout, a DNS
 * failure. None of them is allowed to throw, because the caller has already
 * written to the corpus and unwinding is not on offer. The error is returned
 * so the caller can log it and the receipt can say the ledger lagged.
 */
async function attest(body, { fetchFn } = {}) {
  const doFetch = fetchFn || ((...a) => fetch(...a));
  const url = `${loomBase()}/loom/attest`;
  try {
    const resp = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ATTEST_TIMEOUT_MS),
    });
    if (!resp.ok) {
      return { ok: false, error: `loom attest ${resp.status}` };
    }
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: `loom attest unreachable: ${err && err.message}` };
  }
}

module.exports = {
  applyOntologyDecision,
  resolveIriToPage,
  runVaultCommand,
  setArgsFor,
  slugify,
  iriSlug,
  attest,
  DEFAULT_LOOM_BASE,
};
