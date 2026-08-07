#!/usr/bin/env node
'use strict';
/**
 * ontology-monitor.cjs — SessionEnd hook (ADR-011 + PRD-014 governed elevation).
 *
 * A Z.AI/GLM "worker" that reviews the session's concept-bearing work against the
 * ontology and, where the corpus looks stale / wrong / missing, submits a
 * modification proposal to the FORUM BROKER GATE as an ACSP ActionRequest
 * (kind 31402). A human then approves via the forum (31403); nothing here signs
 * the decision. Read-pervasive, write-governed.
 *
 * Pipeline: gather work → match ontology concepts (local route, VisionClaw-free)
 *   → one Z.AI review call → build 31402 per proposal → publish to the forum relay.
 *
 * GATING (fail-open, silent no-op on any miss):
 *   - AGENTBOX_ONTOLOGY_MONITOR=1                      master switch
 *   - ZAI_ANTHROPIC_API_KEY | ZAI_API_KEY             the GLM worker
 *   - MANAGEMENT_API_KEY + NOSTR_RELAYS               to sign+publish 31402
 *   - AGENTBOX_ONTOLOGY_MONITOR_MODE = publish|dryrun (default dryrun)
 *       dryrun → proposals written to $AGENTBOX_STATE/ontology-proposals.jsonl, no relay egress
 *       publish → signed 31402 published live to the forum broker gate
 *
 * Never throws, never blocks the session: a hard wall-clock budget aborts cleanly.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const BUDGET_MS = parseInt(process.env.AGENTBOX_ONTOLOGY_MONITOR_BUDGET_MS || '180000', 10);
const MAX_CONCEPTS = 8;
const MAX_PROPOSALS = 5;
const DEADLINE = Date.now() + BUDGET_MS;
const MODE = (process.env.AGENTBOX_ONTOLOGY_MONITOR_MODE || 'dryrun').toLowerCase();
const ROOT = path.resolve(__dirname, '../..');

function log(m) { try { process.stderr.write(`[ontology-monitor] ${m}\n`); } catch { /* noop */ } }
function timeLeft() { return DEADLINE - Date.now(); }

// ── idempotency ledger ─────────────────────────────────────────────────────────
// A proposal is fingerprinted by (class IRI + kind + normalised summary) so the
// same finding is never re-emitted across sessions. Panels are keyed by IRI+kind
// (NIP-33 d-tag) so a repeat of the SAME kind for a class REPLACES its prior panel
// rather than piling up. Ledger lives beside the staged proposals.
function stateDir() {
  return process.env.AGENTBOX_STATE || process.env.AGENTBOX_STATE_DIR || '/home/devuser/.agentbox';
}
function ledgerPath() { return path.join(stateDir(), 'ontology-proposals-seen.json'); }
function fingerprint(p) {
  const norm = String(p.summary || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(`${p.iri}|${p.kind}|${norm}`).digest('hex').slice(0, 24);
}
function loadSeen() {
  try { return new Set(JSON.parse(fs.readFileSync(ledgerPath(), 'utf8'))); } catch { return new Set(); }
}
function saveSeen(set) {
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(ledgerPath(), JSON.stringify([...set].slice(-5000)));
  } catch { /* noop */ }
}
function panelIdFor(p) {
  const slug = String(p.iri || '').split(':').pop();
  const kind = String(p.kind || 'update').replace(/[^a-z0-9-]/gi, '').toLowerCase();
  return `ontology-${slug}-${kind}`;
}

// ── gating ───────────────────────────────────────────────────────────────────
function gatedOff() {
  if (!/^(1|true|yes)$/i.test(process.env.AGENTBOX_ONTOLOGY_MONITOR || '')) return 'master switch off';
  if (!process.env.ZAI_ANTHROPIC_API_KEY && !process.env.ZAI_API_KEY) return 'no Z.AI key';
  if (MODE === 'publish' && (!process.env.MANAGEMENT_API_KEY || !process.env.NOSTR_RELAYS)) return 'publish mode needs MANAGEMENT_API_KEY + NOSTR_RELAYS';
  return null;
}

// ── read the SessionEnd payload (harness passes JSON on stdin) ─────────────────
function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}
function parsePayload(raw) {
  try { return JSON.parse(raw); } catch { return {}; }
}

// ── gather concept-bearing work: changed files + a bounded transcript tail ─────
function gatherWork(payload) {
  const cwd = payload.cwd || process.cwd();
  let changed = [];
  try {
    changed = execSync('git -C "' + cwd + '" status --porcelain 2>/dev/null | head -200', { encoding: 'utf8' })
      .split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
  } catch { /* not a repo */ }
  let transcript = '';
  const tp = payload.transcript_path;
  if (tp && fs.existsSync(tp)) {
    try {
      const lines = fs.readFileSync(tp, 'utf8').split('\n').filter(Boolean);
      // pull assistant/user text content, keep the last ~12k chars (recent work)
      const texts = [];
      for (const ln of lines) {
        try {
          const e = JSON.parse(ln);
          const c = e.message && e.message.content;
          if (typeof c === 'string') texts.push(c);
          else if (Array.isArray(c)) for (const b of c) if (b && b.type === 'text' && b.text) texts.push(b.text);
        } catch { /* skip */ }
      }
      transcript = texts.join('\n').slice(-12000);
    } catch { /* skip */ }
  }
  return { cwd, changed, transcript };
}

// ── match ontology concepts against the work (deterministic, local route) ──────
function matchConcepts(work) {
  let onto;
  try {
    const { createLocalOntology } = require('../../mcp/servers/lib/ontology-local.js');
    onto = createLocalOntology();
  } catch (e) { log('local ontology route unavailable: ' + e.message); return []; }
  // Full label index off the local corpus (in-memory, ~8k classes).
  const all = onto.classList({ limit: 100000 }).classes || [];
  const byLabel = new Map();
  for (const c of all) {
    const l = (c.label || '').toLowerCase();
    if (l.length >= 4) byLabel.set(l, c);
  }
  const hay = (work.transcript + '\n' + work.changed.join('\n')).toLowerCase();
  const hits = [];
  for (const [label, c] of byLabel) {
    // word-boundary-ish match, skip ultra-generic single words
    const re = new RegExp('(^|[^a-z0-9])' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)');
    if (re.test(hay)) {
      const full = onto.classGet({ iri: c.iri });
      hits.push({ iri: c.iri, slug: c.slug, label: c.label,
        definition: (full.definition || '').slice(0, 400), domain: c.domain,
        url: 'https://narrativegoldmine.com/class/' + c.slug });
      if (hits.length >= MAX_CONCEPTS * 3) break;
    }
  }
  // Prefer longer, more specific labels (less likely to be incidental)
  hits.sort((a, b) => b.label.length - a.label.length);
  return hits.slice(0, MAX_CONCEPTS);
}

// ── the Z.AI worker: one review call, returns structured proposals ─────────────
async function zaiReview(work, concepts) {
  const { spawnCli } = require('../../mcp/consultants/shared/spawn-cli');
  const ZAI_BIN = process.env.AGENTBOX_ZAI_BIN || 'claude-zai';
  const prompt = [
    'You are an ontology-maintenance reviewer. Below is a digest of recent engineering work,',
    'and the CURRENT ontology classes that work appears to touch (with their definitions).',
    'Decide whether the work reveals any class is now STALE, WRONG, or MISSING a relation/fact.',
    'Only propose a change when the work gives concrete evidence for it — be conservative.',
    '',
    'Return STRICT JSON only: {"proposals":[{"iri","label","kind","title","summary","rationale"}]}',
    'kind ∈ definition-update | new-relation | correction | new-class. Empty array if nothing warranted.',
    '',
    '### Changed files',
    work.changed.slice(0, 60).join('\n') || '(none)',
    '',
    '### Work transcript (recent tail)',
    work.transcript.slice(-6000) || '(none)',
    '',
    '### Candidate ontology classes',
    concepts.map((c) => `- ${c.label} <${c.iri}> [${c.domain}]: ${c.definition}`).join('\n') || '(none matched)',
  ].join('\n');

  const res = await spawnCli({
    cmd: ZAI_BIN, args: ['-p', prompt],
    env: {
      HOME: process.env.AGENTBOX_ZAI_HOME || '/home/zai-user',
      ANTHROPIC_BASE_URL: process.env.ZAI_URL || 'https://api.z.ai/api/anthropic',
      ANTHROPIC_API_KEY: process.env.ZAI_ANTHROPIC_API_KEY || process.env.ZAI_API_KEY || '',
      ZAI_API_KEY: process.env.ZAI_API_KEY || '',
    },
    timeout_ms: Math.max(20000, timeLeft() - 20000),
  });
  const m = res.stdout && res.stdout.match(/\{[\s\S]*\}/);
  if (!m) { log('Z.AI returned no JSON (exit ' + res.code + ')'); return []; }
  try {
    const parsed = JSON.parse(m[0]);
    const byIri = new Map(concepts.map((c) => [c.iri, c]));
    return (parsed.proposals || []).slice(0, MAX_PROPOSALS).map((p) => ({
      ...p, url: (byIri.get(p.iri) || {}).url || null,
    }));
  } catch (e) { log('proposal JSON parse failed: ' + e.message); return []; }
}

// ── emit: 31402 to the forum broker gate (publish) or local queue (dryrun) ─────
function stageLocally(proposals, sessionId) {
  const dir = stateDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* noop */ }
  const f = path.join(dir, 'ontology-proposals.jsonl');
  const stamp = sessionId || 'session';
  for (const p of proposals) {
    try { fs.appendFileSync(f, JSON.stringify({ session: stamp, ...p }) + '\n'); } catch { /* noop */ }
  }
  return f;
}
async function publishProposals(proposals, sessionId) {
  const { NostrBridge, loadSigner } = require('../../mcp/servers/nostr-bridge');
  const acs = require('../../management-api/lib/agent-control-surface');
  const signer = loadSigner('management-api');
  const bridge = new NostrBridge({ relays: (process.env.NOSTR_RELAYS || '').split(',').filter(Boolean) });
  await bridge.connect();
  let sent = 0;
  try {
    for (const p of proposals) {
      if (timeLeft() < 8000) { log('budget exhausted mid-publish'); break; }
      const evt = acs.buildActionRequest({
        panelId: panelIdFor(p),
        category: 'ontology',
        subjectKind: 'ontology-class',
        subjectId: p.iri,
        title: (p.title || `Ontology update: ${p.label}`).slice(0, 120),
        priority: 'low',
        fields: { kind: p.kind, summary: p.summary, label: p.label },
        reasoning: p.rationale || null,
        contextUrl: p.url || null,
      });
      await acs.publishPanelEvent(bridge, signer, evt);
      sent++;
    }
  } finally {
    try { await bridge.disconnect(); } catch { /* noop */ }
  }
  return sent;
}

// ── main ───────────────────────────────────────────────────────────────────────
(async () => {
  const off = gatedOff();
  if (off) { log('no-op: ' + off); process.exit(0); }
  const payload = parsePayload(readStdin());
  try {
    const work = gatherWork(payload);
    if (!work.transcript && !work.changed.length) { log('no work to review'); process.exit(0); }
    const concepts = matchConcepts(work);
    if (!concepts.length) { log('no ontology concepts touched'); process.exit(0); }
    log(`matched ${concepts.length} concept(s); reviewing via Z.AI`);
    const raw = await zaiReview(work, concepts);
    if (!raw.length) { log('Z.AI proposed no changes'); process.exit(0); }
    // Idempotency: drop proposals already emitted in a prior session.
    const seen = loadSeen();
    const fresh = raw.filter((p) => p.iri && !seen.has(fingerprint(p)));
    if (!fresh.length) { log(`all ${raw.length} proposal(s) already seen — nothing new`); process.exit(0); }
    if (MODE === 'publish') {
      const n = await publishProposals(fresh, payload.session_id);
      log(`published ${n} ActionRequest(s) (31402) to the forum broker gate`);
    } else {
      const f = stageLocally(fresh, payload.session_id);
      log(`dryrun: staged ${fresh.length} proposal(s) → ${f}`);
    }
    fresh.forEach((p) => seen.add(fingerprint(p)));
    saveSeen(seen);
  } catch (e) {
    log('fail-open: ' + (e && e.message));
  }
  process.exit(0);
})();
