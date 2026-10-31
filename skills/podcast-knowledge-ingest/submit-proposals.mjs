#!/usr/bin/env node
'use strict';

/**
 * submit-proposals.mjs — the promotion adapter: survivor dossiers → governed
 * `vault propose` (contract C2), one proposal per topic.
 *
 * ADR-2107/ADR-2108 rewrote this stage. It used to require the ontology-bridge's
 * request builder from /opt/agentbox/mcp/servers/ontology-propose.js and POST to
 * VisionClaw's /api/ontology-agent/propose. Both are gone: there is no MCP server
 * for the corpus, and the governed door is the `vault` binary, which runs Whelk
 * and the conflict detector as BLOCKERS before it posts a forum 31402 for a
 * human signature.
 *
 * What changed in substance, not just transport:
 *
 *   - The proposal carries a real unified DIFF of the target page, not a
 *     `custom_fields` map of JSON-encoded strings. `vault` builds the
 *     PatchProposal (C4); this script's job is to hand it the diff and the
 *     hypothesis, then report honestly.
 *   - `blockers` is now a first-class outcome. A non-empty array means NOTHING
 *     was posted. That is not a failure to retry — a subclass cycle or a Whelk
 *     inconsistency is a fact about the model, and rewording the hypothesis
 *     cannot fix it. It is reported and banked as blocked, never re-attempted.
 *   - No token, no bearer, no VisionClaw. Local binary, local corpus.
 *
 * Unchanged: addressing is exact-slug-match only, a page with no matching class
 * is reported and skipped (never guessed — a fuzzy hit must not receive someone
 * else's amendment), and the run is idempotent per assertion-fingerprint set via
 * promotions/.submitted.json.
 *
 * Class lookup is `ontomark find` (`vault` keeps only `propose` and `panel publish`). A lookup
 * that FAILS to run is reported as a failure and retried next week; only a
 * lookup that ran and found no exact class is "unresolved". Conflating the two
 * once reported a missing subcommand as "no exact class" for every topic.
 *
 * Both CLIs run against the repository named by VAULT_REPO (else the parent of
 * VAULT_ROOT when that is a `knowledge/` or `working/` vault), not whatever
 * directory this script happened to be started from.
 *
 * Usage:  node submit-proposals.mjs [--dry-run]
 * Env:    VAULT_BIN (default: `vault` on PATH, else /opt/agentbox/bin/vault)
 *         ONTOMARK_BIN (default: `ontomark` on PATH, else /opt/agentbox/bin/ontomark)
 *         VAULT_REPO, VAULT_ROOT (the repository, see above)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SKILL_DIR = path.dirname(new URL(import.meta.url).pathname);
const PROPOSALS = path.join(SKILL_DIR, 'promotions', 'proposals');
const STATE = path.join(SKILL_DIR, 'promotions', '.submitted.json');
const DRY = process.argv.includes('--dry-run');

// VAULT_BIN, ONTOMARK_BIN and the repository path are the only environment
// values this script reads, and each is an executable or directory path, never
// interpolated into a diff, a page body or frontmatter. Page content comes
// exclusively from the dossier JSON.
function resolveBin(envName, name) {
  if (process.env[envName]) return process.env[envName];
  try {
    const hit = execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim();
    if (hit) return hit;
  } catch { /* not on PATH */ }
  const baked = `/opt/agentbox/bin/${name}`;
  return fs.existsSync(baked) ? baked : null;
}

/** The repository the corpus CLIs operate on, or null when it cannot be named. */
export function resolveRepo(env = process.env) {
  if (env.VAULT_REPO) return env.VAULT_REPO;
  if (env.VAULT_ROOT && ['knowledge', 'working'].includes(path.basename(env.VAULT_ROOT))) {
    return path.dirname(env.VAULT_ROOT);
  }
  return null;
}

const VAULT = resolveBin('VAULT_BIN', 'vault');
const ONTOMARK = resolveBin('ONTOMARK_BIN', 'ontomark');
const REPO = resolveRepo();

const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};

function fpKey(dossier) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([...dossier.assertion_fingerprints].sort()))
    .digest('hex').slice(0, 16);
}

/** Run a corpus CLI inside the repository; stdout parsed as JSON. */
function cli(bin, args) {
  // Capture stdout; let stderr through so a degraded corpus stays visible.
  const out = execFileSync(bin, ['--repo', REPO, ...args], {
    encoding: 'utf8',
    cwd: REPO,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return out.trim() ? JSON.parse(out) : {};
}

function vault(args) {
  return cli(VAULT, args);
}

export function slugFromPage(page) {
  return page.replace(/\.md$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * The hits in an `ontomark find --json` reply. The reply is a bare array; an
 * object with `results` is accepted too, for the older shape.
 */
export function findHits(reply) {
  if (Array.isArray(reply)) return reply;
  return Array.isArray(reply?.results) ? reply.results : [];
}

/**
 * Exact-slug resolution against the corpus. The class IRI is the namespaced slug
 * of the page title. Demand an exact match on the slug: a fuzzy hit must never
 * receive someone else's amendment.
 *
 * Three outcomes, kept apart on purpose: `{ ok: true, iri, page }`,
 * `{ ok: false, reason: 'no-match' }` when the lookup ran and found no exact
 * class, and `{ ok: false, reason: 'error', detail }` when the lookup itself
 * failed to run. Only the first two say anything about the corpus.
 */
export function resolveIri(targetPage, find = (q) => cli(ONTOMARK, ['find', '--query', q, '--type', 'Class', '--limit', '10', '--json'])) {
  const slug = slugFromPage(targetPage);
  let reply;
  try {
    reply = find(targetPage.replace(/\.md$/, ''));
  } catch (e) {
    return { ok: false, reason: 'error', detail: String(e.message).slice(0, 160) };
  }
  const hit = findHits(reply).find((r) => slugFromPage(r.id) === slug);
  return hit ? { ok: true, iri: `urn:ngm:class:${slug}`, page: hit.id } : { ok: false, reason: 'no-match' };
}

/**
 * The target page with the dossier's splice applied, in full: `vault propose
 * --diff` takes the proposed page itself, not a diff (VisionClaw
 * `crates/vault/src/main.rs`, the `diff` argument). `edit.mode` is
 * insert_after/insert_before against `edit.anchor`, prose lines taken from the
 * page when the dossier was built. They must still appear as one contiguous
 * run of lines; if the anchor has moved or is ambiguous the splice is refused
 * (`null`), never placed by guess.
 */
export function spliceProposal(pageText, edit) {
  const anchor = String(edit.anchor || '').split('\n').filter((l) => l.trim());
  if (!anchor.length) return null;
  const lines = pageText.split('\n');
  const starts = [];
  for (let i = 0; i + anchor.length <= lines.length; i++) {
    if (anchor.every((a, k) => lines[i + k].trim() === a.trim())) starts.push(i);
  }
  if (starts.length !== 1) return null;
  const at = edit.mode === 'insert_before' ? starts[0] : starts[0] + anchor.length;
  const added = String(edit.content || '').replace(/\n+$/, '').split('\n');
  return [...lines.slice(0, at), ...added, ...lines.slice(at)].join('\n');
}

/** Write the proposed page for `vault propose --diff`, or return null. */
function writeProposedPage(dossier, page) {
  const source = path.join(REPO, 'knowledge', `${page}.md`);
  const proposed = spliceProposal(fs.readFileSync(source, 'utf8'), dossier.ontology_propose_payload.edit);
  if (proposed === null) return null;
  const file = path.join(os.tmpdir(), `podcast-propose-${dossier.topic_slug}-${process.pid}.md`);
  fs.writeFileSync(file, proposed);
  return file;
}

function hypothesisFor(dossier, dossierFile) {
  const s = dossier.ontology_propose_payload.scores || {};
  const prov = dossier.ontology_propose_payload.provenance || {};
  const eps = (prov.source_episodes || []).length;
  const fps = (prov.assertion_fingerprints || []).length;
  return [
    `Evidence splice from podcast-knowledge-ingest: ${fps} verified assertion(s) across ${eps} episode(s).`,
    `Pre-filter scores — rubric A ${s.rubric_a_improvement ?? '?'}, rubric B ${s.rubric_b_improvement ?? '?'},`,
    `completeness ${s.completeness ?? '?'}.`,
    `Dossier: skills/podcast-knowledge-ingest/promotions/proposals/${dossierFile}`,
  ].join(' ');
}

function main() {
  if (!VAULT) {
    console.error('submit-proposals: no `vault` binary. It is baked by Nix under [vault].cli');
    console.error('                  (ADR-2108); rebuild the image, or set VAULT_BIN.');
    process.exit(1);
  }
  if (!ONTOMARK) {
    console.error('submit-proposals: no `ontomark` binary, which class lookup needs. Rebuild the');
    console.error('                  image, or set ONTOMARK_BIN.');
    process.exit(1);
  }
  if (!REPO) {
    console.error('submit-proposals: cannot tell which repository to use. Set VAULT_REPO, or');
    console.error('                  VAULT_ROOT to its knowledge/ or working/ vault.');
    process.exit(1);
  }

  const files = fs.existsSync(PROPOSALS)
    ? fs.readdirSync(PROPOSALS).filter((f) => f.endsWith('.json')).sort()
    : [];
  let proposed = 0, skipped = 0, unresolved = 0, blocked = 0, failed = 0;

  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(PROPOSALS, f), 'utf8'));
    if (d.status !== 'candidate_survivor' || !d.ontology_propose_payload) continue;

    const key = fpKey(d);
    if (state[d.topic_slug]?.fp === key) { skipped++; continue; }

    const target = resolveIri(d.target_page);
    if (!target.ok && target.reason === 'error') {
      // The lookup did not run. Say nothing about the corpus and bank nothing:
      // next week's run tries again.
      console.error(`FAILED [${d.topic_slug}]: class lookup for '${d.target_page}' failed: ${target.detail}`);
      failed++;
      continue;
    }
    if (!target.ok) {
      console.log(`UNRESOLVED [${d.topic_slug}]: no exact class for '${d.target_page}' — skipping (never guess).`);
      console.log('            A page with no class needs a class *create* proposal, which stays human-initiated.');
      unresolved++;
      continue;
    }

    const diffFile = writeProposedPage(d, target.page);
    if (!diffFile) {
      // The anchor is gone or ambiguous: the page moved on since the dossier
      // was built. Bank it as blocked; a new dossier gets a new fingerprint.
      console.log(`BLOCKED [${d.topic_slug}] -> ${target.iri}`);
      console.log('         anchor-moved: the splice anchor is not one contiguous run of the page\'s lines');
      state[d.topic_slug] = { fp: key, blocked: ['anchor-moved'], at: new Date().toISOString() };
      fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
      blocked++;
      continue;
    }
    const args = ['propose', target.iri,
      '--level', 'content',
      '--hypothesis', hypothesisFor(d, f),
      '--diff', diffFile,
      '--json'];
    if (DRY) args.push('--dry-run');

    try {
      const out = vault(args);
      const blockers = out.blockers || [];
      if (blockers.length) {
        // Automatic refusal. Nothing was posted; bank it so next week's run does
        // not re-submit the same impossible proposal for ever.
        console.log(`BLOCKED [${d.topic_slug}] -> ${target.iri}`);
        for (const b of blockers) console.log(`         ${b.kind || 'blocker'}: ${b.detail || JSON.stringify(b)}`);
        state[d.topic_slug] = { fp: key, blocked: blockers.map((b) => b.kind || 'blocker'), at: new Date().toISOString() };
        fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
        blocked++;
      } else if (DRY) {
        console.log(`DRY [${d.topic_slug}] -> content proposal on ${target.iri} (digest ${out.digest || '?'})`);
        proposed++;
      } else {
        state[d.topic_slug] = { fp: key, digest: out.digest || null, generation: out.generation || null, at: new Date().toISOString() };
        fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
        console.log(`PROPOSED [${d.topic_slug}] -> ${target.iri} (digest ${out.digest || '?'}, expires ${out.stale_after || '?'})`);
        proposed++;
      }
    } catch (e) {
      console.error(`FAILED [${d.topic_slug}]: ${String(e.message).slice(0, 200)}`);
      failed++;
    } finally {
      fs.rmSync(diffFile, { force: true });
    }
  }

  console.log(`\nproposed=${proposed} skipped(unchanged)=${skipped} unresolved=${unresolved} blocked=${blocked} failed=${failed}`);
  if (proposed && !DRY) {
    console.log('None of these have landed: a proposal is a request for a signature, not a write.');
    console.log('They need a human 31403 Approve on the forum, and they expire at stale_after.');
  }
}

// Run only when invoked as a script, so the helpers above can be imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
