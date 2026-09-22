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
 * Usage:  node submit-proposals.mjs [--dry-run]
 * Env:    VAULT_BIN (default: `vault` on PATH, else /opt/agentbox/bin/vault)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const SKILL_DIR = path.dirname(new URL(import.meta.url).pathname);
const PROPOSALS = path.join(SKILL_DIR, 'promotions', 'proposals');
const STATE = path.join(SKILL_DIR, 'promotions', '.submitted.json');
const DRY = process.argv.includes('--dry-run');

// VAULT_BIN is the ONLY environment value this script reads, and it is an
// executable path — never interpolated into a diff, a page body or
// frontmatter. Page content comes exclusively from the dossier JSON.
function resolveVault() {
  if (process.env.VAULT_BIN) return process.env.VAULT_BIN;
  try {
    const hit = execFileSync('sh', ['-c', 'command -v vault'], { encoding: 'utf8' }).trim();
    if (hit) return hit;
  } catch { /* not on PATH */ }
  const baked = '/opt/agentbox/bin/vault';
  return fs.existsSync(baked) ? baked : null;
}

const VAULT = resolveVault();
if (!VAULT) {
  console.error('submit-proposals: no `vault` binary. It is baked by Nix under [vault].cli');
  console.error('                  (ADR-2108); rebuild the image, or set VAULT_BIN.');
  process.exit(1);
}

const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};

function fpKey(dossier) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([...dossier.assertion_fingerprints].sort()))
    .digest('hex').slice(0, 16);
}

function vault(args) {
  // Capture stdout; let stderr through so a degraded corpus stays visible.
  const out = execFileSync(VAULT, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  return out.trim() ? JSON.parse(out) : {};
}

function slugFromPage(page) {
  return page.replace(/\.md$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Exact-slug resolution against the corpus. `vault find` returns page ids; the
 * class IRI is the namespaced slug of the page title. Demand an exact match on
 * the slug — a fuzzy hit must never receive someone else's amendment.
 */
function resolveIri(targetPage) {
  const slug = slugFromPage(targetPage);
  let res;
  try {
    res = vault(['find', '--query', targetPage.replace(/\.md$/, ''), '--type', 'Class', '--limit', '10', '--json']);
  } catch (e) {
    console.error(`  find failed for '${targetPage}': ${String(e.message).slice(0, 160)}`);
    return null;
  }
  const hit = (res.results || []).find((r) => slugFromPage(r.id) === slug);
  return hit ? { iri: `urn:ngm:class:${slug}`, page: hit.id } : null;
}

/**
 * The dossier's splice edit, rendered as the unified diff `vault propose`
 * consumes. `edit.mode` is insert_after/insert_before against `edit.anchor`;
 * the anchor is prose from the target page, so it is emitted as diff CONTEXT.
 * That is deliberate: if the anchor has moved since the dossier was built, the
 * diff no longer applies and `vault` refuses it, which is the correct outcome.
 */
function writeDiff(dossier) {
  const p = dossier.ontology_propose_payload;
  const file = path.join(os.tmpdir(), `podcast-propose-${dossier.topic_slug}-${process.pid}.diff`);
  const anchor = String(p.edit.anchor || '').split('\n').filter(Boolean);
  const added = String(p.edit.content || '').split('\n');
  const before = p.edit.mode === 'insert_before';
  const body = [
    `--- a/pages/${p.target_page}`,
    `+++ b/pages/${p.target_page}`,
    '@@ anchored splice @@',
    ...(before ? [] : anchor.map((l) => ` ${l}`)),
    ...added.map((l) => `+${l}`),
    ...(before ? anchor.map((l) => ` ${l}`) : []),
    '',
  ].join('\n');
  fs.writeFileSync(file, body);
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
  const files = fs.readdirSync(PROPOSALS).filter((f) => f.endsWith('.json')).sort();
  let proposed = 0, skipped = 0, unresolved = 0, blocked = 0, failed = 0;

  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(PROPOSALS, f), 'utf8'));
    if (d.status !== 'candidate_survivor' || !d.ontology_propose_payload) continue;

    const key = fpKey(d);
    if (state[d.topic_slug]?.fp === key) { skipped++; continue; }

    const target = resolveIri(d.target_page);
    if (!target) {
      console.log(`UNRESOLVED [${d.topic_slug}]: no exact class for '${d.target_page}' — skipping (never guess).`);
      console.log('            A page with no class needs a class *create* proposal, which stays human-initiated.');
      unresolved++;
      continue;
    }

    const diffFile = writeDiff(d);
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

main();
