'use strict';

/**
 * ADR-2109 — a signed governance Promote/Demote applies through `vault edit`.
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
 *    always declare `docs=1` plus exactly the keys that change, planned
 *    against the page's current status (`blocks=2` promote from draft,
 *    `blocks=1` for a re-attestation of a stable page or a demote): a decision
 *    about one page must touch one page and nothing else on it. If the vault disagrees the edit fails and nothing is written — which
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
const fs = require('fs');
const path = require('path');
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
    VAULT_REPO: process.env.VAULT_REPO || '',
    VAULT_BIN: process.env.VAULT_BIN || '',
    // `vault propose` signs its 31402 even under --dry-run and refuses without
    // a key; these are the vault CLI's own documented variables. Only passed
    // when set, so an absent secret stays absent rather than becoming "".
    ...(process.env.VAULT_NOSTR_SECRET ? { VAULT_NOSTR_SECRET: process.env.VAULT_NOSTR_SECRET } : {}),
    ...(process.env.VAULT_RELAY_URL ? { VAULT_RELAY_URL: process.env.VAULT_RELAY_URL } : {}),
  };
}

/** The file whose presence marks a directory as a vault repository root. */
const REPO_MARKER = path.join('ontology', 'vocabulary.yaml');

/** Vault-root basenames whose PARENT is the repository (`knowledge/`, `working/`). */
const VAULT_SUBDIRS = new Set(['knowledge', 'working']);

class VaultRepoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultRepoError';
  }
}

function isRepoRoot(dir, exists) {
  return exists(path.join(dir, REPO_MARKER));
}

/**
 * Resolve the vault REPOSITORY root every `vault` invocation is pinned to with
 * `--repo`.
 *
 * Without `--repo` the CLI walks up from the process cwd, so a governed corpus
 * write would land in whichever repository the management API happened to be
 * started beneath — or fail, or worse, hit a different one. The rule:
 *
 *   1. `VAULT_REPO`, if set, is authoritative. It must hold
 *      `ontology/vocabulary.yaml`; a set-but-wrong value is an error, never a
 *      silent fall-through to rule 2.
 *   2. Else derive from `VAULT_ROOT` (the manifest's vault root, ADR-2028):
 *      when its basename is `knowledge` or `working` the repo is its parent,
 *      otherwise `VAULT_ROOT` itself. The candidate must hold the marker.
 *   3. Else fail closed.
 *
 * @param {object} [env]            defaults to `process.env`
 * @param {object} [opts]
 * @param {(p:string)=>boolean} [opts.exists]  injected in tests
 * @returns {string} absolute repository root
 * @throws {VaultRepoError} when no repository root resolves
 */
function resolveVaultRepo(env = process.env, { exists = fs.existsSync } = {}) {
  const explicit = String(env.VAULT_REPO || '').trim();
  if (explicit) {
    const root = path.resolve(explicit);
    if (!isRepoRoot(root, exists)) {
      throw new VaultRepoError(
        `ontology-apply: VAULT_REPO=${root} holds no ${REPO_MARKER}; refusing to run vault`,
      );
    }
    return root;
  }

  const vaultRoot = String(env.VAULT_ROOT || '').trim();
  if (!vaultRoot) {
    throw new VaultRepoError(
      'ontology-apply: neither VAULT_REPO nor VAULT_ROOT is set; refusing to run vault ' +
        'against whatever repository the process cwd happens to sit in',
    );
  }
  const abs = path.resolve(vaultRoot);
  const candidate = VAULT_SUBDIRS.has(path.basename(abs)) ? path.dirname(abs) : abs;
  if (!isRepoRoot(candidate, exists)) {
    throw new VaultRepoError(
      `ontology-apply: VAULT_ROOT=${abs} resolves to repo ${candidate}, which holds no ` +
        `${REPO_MARKER}; set VAULT_REPO explicitly`,
    );
  }
  return candidate;
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
 * Run `vault --repo <root> <args>` and parse its `--json` output.
 *
 * `--repo` is always prepended from {@link resolveVaultRepo}; callers build the
 * subcommand argv only, so descriptors stay independent of where they run.
 *
 * argv array, never a shell string — the house no-shell rule
 * (`lib/project-tracker.js:27`), and here it also means an IRI containing shell
 * metacharacters is data rather than code.
 */
async function runVaultCommand(args, { timeoutMs = VAULT_TIMEOUT_MS, repo = null, reportOnFailure = false } = {}) {
  // Resolved per call, before anything is spawned: an unresolvable repo throws
  // here, so no write is ever attempted against an implicit, cwd-derived repo.
  // An explicit `repo` is for READ-ONLY checks against a staging repository
  // (the elevation gate); governed writes always take the resolved one.
  const root = repo || resolveVaultRepo();
  let stdout;
  try {
    ({ stdout } = await execFileAsync(vaultBin(), ['--repo', root, ...args], {
      env: vaultEnv(),
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    }));
  } catch (err) {
    // `vault validate --strict` exits non-zero on any finding but still prints
    // its full report; a caller that asked for the report gets it.
    if (!reportOnFailure || !err || !String(err.stdout || '').trim()) throw err;
    stdout = err.stdout;
  }
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
function setArgsFor(outcome, { npub, at, currentStatus } = {}) {
  const target = outcome === 'promote' ? 'stable' : 'deprecated';
  // A key whose value would not change is not sent: `vault edit` counts only
  // keys that change, and the guard must say exactly that. So a promote of an
  // already-stable page is a RE-ATTESTATION (one `verified` appended, status
  // untouched, blocks=1), and a demote of an already-deprecated page sets
  // nothing at all.
  const sets = currentStatus === target ? [] : ['--set', `status=${target}`];
  if (outcome === 'promote') {
    sets.push('--set', `verified+=${JSON.stringify({ by: `human:${npub}`, at })}`);
  }
  return sets;
}

/** Where `vault edit` finds a knowledge page: `<repo>/knowledge/pages/<id>.md` (C2). */
const KNOWLEDGE_PAGES = path.join('knowledge', 'pages');

/**
 * Read a page's current `status` — READ ONLY, to plan the edit's key set.
 *
 * The vault stays the only writer. If the page changes between this read and
 * the edit, the edit's `--expect` no longer matches and `vault edit` refuses:
 * the race fails closed. A page id that escapes the pages directory, a missing
 * page, or a page with no frontmatter throws rather than guessing.
 *
 * @returns {string|null} the status scalar, or null when the key is absent
 */
function readPageStatus(pageId, { repo = resolveVaultRepo(), readFile = fs.readFileSync } = {}) {
  const pagesDir = path.resolve(repo, KNOWLEDGE_PAGES);
  const file = path.resolve(pagesDir, `${pageId}.md`);
  if (!file.startsWith(pagesDir + path.sep)) {
    throw new Error(`ontology-apply: page id ${JSON.stringify(pageId)} escapes ${pagesDir}`);
  }
  const text = String(readFile(file, 'utf8'));
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) throw new Error(`ontology-apply: ${pageId} has no YAML frontmatter`);
  const line = /^status:[ \t]*(.*?)[ \t]*$/m.exec(m[1]);
  if (!line) return null;
  return line[1].replace(/^(['"])(.*)\1$/, '$2') || null;
}

/** Contract C5: a proposal digest on the wire is `sha256:<64 hex>`. */
function canonicalDigest(digest) {
  if (digest == null) return digest;
  const d = String(digest).trim();
  return /^[0-9a-f]{64}$/i.test(d) ? `sha256:${d.toLowerCase()}` : d;
}

/**
 * The `--expect` blast radius for a list of `--set` arguments: one document,
 * and one block per DISTINCT frontmatter key set (`key=` and `key+=` both name
 * `key`). This is `vault edit`'s own counting rule (crates/vault/src/edit.rs:
 * blocks = the number of distinct keys whose value changed), so a decision
 * that would be a no-op on any key is refused rather than half-applied.
 */
function expectFor(setArgs) {
  const keys = new Set();
  for (let i = 0; i < setArgs.length; i += 2) {
    if (setArgs[i] !== '--set') throw new Error(`ontology-apply: malformed set args at ${i}`);
    keys.add(String(setArgs[i + 1]).split(/\+?=/, 1)[0]);
  }
  return `docs=1,blocks=${keys.size}`;
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
  const { outcome, iri, page: pageHint, proposal } = decision;
  if (outcome !== 'promote' && outcome !== 'demote') {
    throw new Error(`ontology-apply: ${outcome} is not an ontology outcome`);
  }
  if (!iri) throw new Error('ontology-apply: the signed decision carries no iri');

  const runVault = deps.runVault || runVaultCommand;

  // A `kind: create` proposal names a page the corpus does not hold yet: it is
  // materialised from the proposal's own diff by `vault create`, then promoted
  // through the same guarded edit as any other page.
  if (proposal && proposal.kind === CREATE_KIND) {
    return applyCreateProposal(decision, proposal, { ...deps, runVault });
  }

  const page = await resolveIriToPage(iri, { runVault, page: pageHint });
  return editAndAttest(page, decision, { ...deps, runVault });
}

/**
 * The guarded `vault edit` for one resolved page, then the ledger call.
 * Shared by the ordinary path and the create path (whose page exists by the
 * time this runs).
 */
async function editAndAttest(page, decision, deps) {
  const { outcome, signerNpub, at, caseId, digest } = decision;
  const { runVault } = deps;

  // The guard is not optional and not configurable: one decision, one page,
  // and exactly the frontmatter keys that CHANGE. `vault edit` counts a block
  // per distinct key whose value changes, so the key set is planned against
  // the page's current status and `--expect` is derived from the very argv
  // being sent: promote draft→stable is blocks=2, a re-attestation of a
  // stable page is blocks=1, a demote is blocks=1. Never a fixed number.
  const readStatus = deps.readPageStatus || readPageStatus;
  const currentStatus = readStatus(page);
  const sets = setArgsFor(outcome, { npub: signerNpub, at, currentStatus });
  const reattest = outcome === 'promote' && currentStatus === 'stable';
  if (sets.length > 0) {
    await runVault([
      'edit', page,
      ...sets,
      '--expect', expectFor(sets),
      '--json',
    ]);
  }

  // The decision is ledgered even when it changed nothing on the page (a
  // demote of an already-deprecated page): the ledger records what humans
  // decided, and the receipt below says honestly that nothing was written.
  const ledger = await attest(
    {
      case_id: caseId,
      // Canonical `sha256:<hex>` (C5). The 31403 carries the 31402's bare `d`
      // tag; Loom tolerates either, agentbox always sends the documented form.
      digest: canonicalDigest(digest),
      outcome,
      // Loom AttestRequest.signer is an actor URI, the same one `verified.by`
      // carries on the page, so ledger and corpus name the signer identically.
      signer: `human:${signerNpub}`,
      at,
    },
    deps,
  );

  return {
    applied: sets.length > 0,
    noop: sets.length === 0,
    reattest,
    page,
    outcome,
    blocks: sets.length / 2,
    attested: ledger.ok,
    attestError: ledger.error,
  };
}

// ── Create proposals (`kind: create`) ───────────────────────────────────────

/** The PatchProposal `kind` of a proposal whose page is not yet in the corpus. */
const CREATE_KIND = 'create';

/**
 * The `vault create` invocation for an approved create-proposal.
 *
 * The ONE place the create interface is written (VisionClaw vault, ws-vc-final
 * item 12): `vault --repo <root> create <staged-page-file> --expect docs=1
 * --json` writes `knowledge/pages/<Title>.md` only if it is absent, validates
 * it, and stamps `status: stable` plus the human `verified` entry IN THE SAME
 * WRITE; exit 2 means the page exists (a race). The signer and instant are
 * passed in `vault edit`'s own `--set` grammar, since the vault cannot know who
 * approved. Until the command ships, a real vault refuses it and the apply
 * fails closed with nothing written.
 */
function createArgsFor(file, { npub, at }) {
  return [
    'create', file,
    '--expect', 'docs=1',
    '--set', 'status=stable',
    // `vault edit`'s grammar exactly: `key+=value` appends, and the
    // attestation is a YAML flow mapping (crates/vault/src/edit.rs).
    '--set', `verified+={by: human:${npub}, at: ${at}}`,
    '--json',
  ];
}

/**
 * `vault create`'s exit status for EVERY refusal (nothing written); stdout
 * then carries `{created:false, code, message, blockers}`. `code: EXISTS` is
 * the race — the page appeared after the proposal was approved.
 */
const CREATE_REFUSED_EXIT = 2;

const sha256Hex = (buf) => require('crypto').createHash('sha256').update(buf).digest('hex');

/**
 * The page a create-proposal's diff adds. A create diff is against
 * /dev/null, so every body line is an addition; a context or removal line
 * means this is not a create diff and the page is refused rather than guessed.
 */
function pageFromCreateDiff(diff) {
  const out = [];
  let inHunk = false;
  let trailingNewline = true;
  for (const line of String(diff || '').split('\n')) {
    if (!inHunk) {
      if (line.startsWith('@@')) inHunk = true;
      else if (line && !line.startsWith('--- ') && !line.startsWith('+++ ') && !line.startsWith('diff ')) {
        throw new Error(`ontology-apply: unexpected create-diff header line ${JSON.stringify(line)}`);
      }
      continue;
    }
    if (line.startsWith('@@')) continue;
    if (line.startsWith('+')) { out.push(line.slice(1)); continue; }
    if (line.startsWith('\\')) { trailingNewline = false; continue; }
    if (line === '') continue; // the split's tail
    throw new Error('ontology-apply: a create diff may only ADD lines (is it against /dev/null?)');
  }
  if (!inHunk || out.length === 0) throw new Error('ontology-apply: the create diff adds no page');
  return out.join('\n') + (trailingNewline ? '\n' : '');
}

/**
 * Parse a stored 31402 (the relay consumer's governance record, or a raw
 * event) into its PatchProposal. `vault propose` puts the PatchProposal in the
 * event content; a `{proposal}` wrapper is tolerated.
 */
function proposalFromRequest(request) {
  if (!request) return null;
  let content = request.content;
  if (typeof content === 'string') {
    try { content = JSON.parse(content); } catch { return null; }
  }
  if (!content || typeof content !== 'object') return null;
  return content.proposal && typeof content.proposal === 'object' ? content.proposal : content;
}

/**
 * Apply a Promote of a `kind: create` proposal.
 *
 * One source of truth: the bytes the human's signature covers. The page is
 * reconstructed from the proposal's signed /dev/null diff — never re-derived
 * from the candidate, never read from a side store — written to a temp file,
 * and handed to ONE `vault create`, which writes, validates and stamps
 * `status: stable` + the human `verified` entry in the same write (so no
 * failure can leave a created-but-draft page). When the PatchProposal carries
 * `page_sha256`, the reconstructed bytes must hash to it. Every vault refusal
 * (exit 2) wrote nothing and is NOT ledgered: `code: EXISTS` (the page
 * appeared meanwhile) is `applied:false, reason:'exists'`; any other code
 * throws with that code and its blockers.
 */
async function applyCreateProposal(decision, proposal, deps) {
  const { outcome, iri, signerNpub, at, caseId, digest } = decision;
  const { runVault } = deps;
  if (outcome !== 'promote') {
    throw new Error('ontology-apply: a create proposal can only be promoted — there is no page to demote');
  }
  // The human signed an IRI; the proposal must be about that same IRI.
  if (proposal.iri !== iri) {
    throw new Error(`ontology-apply: the signed iri ${iri} is not the create proposal's ${proposal.iri}`);
  }
  const page = proposal.page;
  if (!page || slugify(basename(page)) !== iriSlug(iri)) {
    throw new Error(`ontology-apply: create proposal page ${JSON.stringify(page)} does not answer to ${iri}`);
  }
  if (Array.isArray(proposal.pages) && proposal.pages.length > 1) {
    throw new Error('ontology-apply: a grouped create proposal is not applied page-by-page; refusing');
  }

  const markdown = pageFromCreateDiff(proposal.diff);
  if (proposal.page_sha256) {
    const expected = String(proposal.page_sha256).replace(/^sha256:/, '').toLowerCase();
    const actual = sha256Hex(Buffer.from(markdown, 'utf8'));
    if (actual !== expected) {
      throw new Error(`ontology-apply: the signed diff's page hashes to ${actual}, not the proposal's page_sha256 ${expected}`);
    }
  }
  const resource = /^resource:[ \t]*["']?([^"'\s]+)["']?[ \t]*$/m.exec(markdown);
  if (!resource || resource[1] !== iri) {
    throw new Error(`ontology-apply: the created page's resource is not ${iri}`);
  }

  const stageDir = fs.mkdtempSync(path.join(deps.tmpRoot || require('os').tmpdir(), 'ontology-create-'));
  try {
    const file = path.join(stageDir, `${basename(page)}.md`);
    fs.writeFileSync(file, markdown);
    try {
      await runVault(createArgsFor(file, { npub: signerNpub, at }));
    } catch (err) {
      if (err && err.code === CREATE_REFUSED_EXIT) {
        // Every refusal wrote nothing. EXISTS is the race — the page appeared
        // after approval — and is an honest `applied:false`. Any other code
        // (BLOCKED, FRONTMATTER_INVALID, UNTITLED, UNDECLARED_BLAST_RADIUS,
        // GUARD_VIOLATED) means the approved proposal cannot be written as
        // signed: it throws, and nothing is ledgered.
        let refusal = {};
        try { refusal = JSON.parse(String(err.stdout || '').trim() || '{}'); } catch { /* prose */ }
        if (refusal.code === 'EXISTS') {
          return { applied: false, created: false, reason: 'exists', page, outcome, attested: false, attestError: null };
        }
        const blockers = Array.isArray(refusal.blockers) && refusal.blockers.length
          ? ` [${refusal.blockers.map(b => (b && (b.code || b.message)) || String(b)).join(', ')}]` : '';
        const refused = new Error(
          `ontology-apply: vault create refused ${page}: ${refusal.code || 'REFUSED'} — ` +
          `${refusal.message || String(err.stderr || err.message || '').trim()}${blockers}`,
        );
        refused.code = refusal.code || 'REFUSED';
        refused.blockers = Array.isArray(refusal.blockers) ? refusal.blockers : [];
        throw refused;
      }
      throw err;
    }
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  const ledger = await attest(
    { case_id: caseId, digest: canonicalDigest(digest), outcome, signer: `human:${signerNpub}`, at },
    deps,
  );
  return {
    applied: true,
    created: true,
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
  vaultEnv,
  resolveIriToPage,
  runVaultCommand,
  resolveVaultRepo,
  VaultRepoError,
  REPO_MARKER,
  setArgsFor,
  expectFor,
  readPageStatus,
  canonicalDigest,
  CREATE_KIND,
  CREATE_REFUSED_EXIT,
  createArgsFor,
  pageFromCreateDiff,
  proposalFromRequest,
  slugify,
  iriSlug,
  attest,
  DEFAULT_LOOM_BASE,
};
