#!/usr/bin/env node
'use strict';

/**
 * submit-proposals.mjs — the thin ontology_propose adapter fixed in
 * references/promotion.md ("Intended ontology_propose adapter contract").
 *
 * Reads every promotions/proposals/*.json with status candidate_survivor and a
 * non-null ontology_propose_payload, resolves target_page -> class IRI via the
 * bridge's search, and submits a governed AMEND proposal (Whelk gate -> ACSP
 * human approval -> PR). Reuses the bridge's own request builder so the body
 * shape can never drift from the MCP tool's.
 *
 * Idempotent: submitted proposal ids are banked per assertion-fingerprint set
 * in promotions/.submitted.json; unchanged dossiers are skipped. Unresolvable
 * target pages are reported and skipped (never guessed).
 *
 * Env: VISIONCLAW_API_URL (default http://visionclaw-server:4000),
 *      VISIONCLAW_DEV_TOKEN for auth (same env the MCP shim uses).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);
const proposeLib = requireCjs('/opt/agentbox/mcp/servers/ontology-propose.js');

const SKILL_DIR = path.dirname(new URL(import.meta.url).pathname);
const PROPOSALS = path.join(SKILL_DIR, 'promotions', 'proposals');
const STATE = path.join(SKILL_DIR, 'promotions', '.submitted.json');
const BASE = process.env.VISIONCLAW_API_URL || 'http://visionclaw-server:4000';
const TOKEN = process.env.VISIONCLAW_DEV_TOKEN || 'dev-session-token';
const DRY = process.argv.includes('--dry-run');

const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};

function fpKey(dossier) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([...dossier.assertion_fingerprints].sort()))
    .digest('hex').slice(0, 16);
}

async function api(reqPath, method, body) {
  const res = await fetch(`${BASE}${reqPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${reqPath} -> ${res.status} ${await res.text()}`);
  return res.json();
}

function slugFromPage(page) {
  return page.replace(/\.md$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function resolveIri(targetPage) {
  // The graph's class URNs are slugs of the page name; try the exact slug
  // first, then fall back to bridge search and demand an exact-slug match —
  // a fuzzy hit must never receive someone else's amendment.
  const slug = slugFromPage(targetPage);
  const want = `urn:ngm:class:${slug}`;
  const out = await api('/api/ontology-agent/discover', 'POST',
    { query: targetPage.replace(/\.md$/, ''), limit: 10 });
  const results = out?.data?.results || out?.results || [];
  const hit = results.find((r) => r.iri === want);
  return hit ? want : null;
}

async function main() {
  const files = fs.readdirSync(PROPOSALS).filter((f) => f.endsWith('.json')).sort();
  let submitted = 0, skipped = 0, unresolved = 0;
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(PROPOSALS, f), 'utf8'));
    if (d.status !== 'candidate_survivor' || !d.ontology_propose_payload) continue;
    const key = fpKey(d);
    if (state[d.topic_slug]?.fp === key) { skipped++; continue; }

    const iri = await resolveIri(d.target_page).catch((e) => { console.error(`  [${d.topic_slug}] search failed: ${e.message}`); return null; });
    if (!iri) {
      console.log(`UNRESOLVED [${d.topic_slug}]: no exact class for '${d.target_page}' — skipping (never guess)`);
      unresolved++;
      continue;
    }

    const p = d.ontology_propose_payload;
    const req = proposeLib.buildProposeRequest({
      action: 'amend',
      target_iri: iri,
      amendment: {
        // Server-side custom_fields is Map<String,String> — nested objects
        // must be JSON-encoded strings (400 "invalid type: map" otherwise).
        custom_fields: {
          kind: 'evidence_section_splice',
          target_page: p.target_page,
          edit: JSON.stringify(p.edit),
          scores: JSON.stringify(p.scores),
          provenance: JSON.stringify(p.provenance),
          dossier: `skills/podcast-knowledge-ingest/promotions/proposals/${f}`,
          pipeline: 'podcast-knowledge-ingest/podcast-promote',
        },
      },
      agent_context: { pipeline: 'podcast-knowledge-ingest', stage: 'candidate_survivor' },
    });

    if (DRY) { console.log(`DRY [${d.topic_slug}] -> amend ${iri}`); submitted++; continue; }
    try {
      const out = await api(req.path, req.method, req.body);
      const prop = out?.data?.proposal || out?.proposal || {};
      state[d.topic_slug] = { fp: key, proposal_id: prop.proposal_id || null, at: new Date().toISOString() };
      fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
      console.log(`SUBMITTED [${d.topic_slug}] -> ${prop.proposal_id || '?'} (${prop.status || '?'}, whelk=${prop.gates?.whelk || '?'})`);
      submitted++;
    } catch (e) {
      console.error(`FAILED [${d.topic_slug}]: ${e.message.slice(0, 200)}`);
    }
  }
  console.log(`\nsubmitted=${submitted} skipped(unchanged)=${skipped} unresolved=${unresolved}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
