#!/usr/bin/env node
// Dream harvest — the weekly value-extraction pass over the dreaming system.
//
// The nightly loop produces verdicts nobody is forced to look at; this script
// makes the accumulated value (and debt) visible in one report:
//   - per-repo verdict counts over the window, current streaks, standby state
//   - ACCEPT nights whose branches/findings await a human merge decision
//   - open + answered dream-inbox items
//   - environment-fault rate (BLOCKED-ENV / FAILED) — harness health
//
// Output: markdown to stdout AND
// workspace/.tmp/dream-annexe-artefacts/harvest-<date>.md. Anomalies queue an
// inbox item so the surfacing hook brings the harvest to the operator.
//
//   node dream-harvest.mjs [--days 7]

import fs from 'node:fs';
import path from 'node:path';

const WORKSPACE = '/home/devuser/workspace';
const ARTEFACTS = path.join(WORKSPACE, '.tmp/dream-annexe-artefacts');
const INBOX = path.join(WORKSPACE, '.agentbox/dream-inbox.json');
const days = Number(process.argv[process.argv.indexOf('--days') + 1]) || 7;
const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);

function ledgerRows(repoDir) {
  let ledgerPath = 'docs/dream-cycle/LEDGER.md';
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(repoDir, 'dream.config.json'), 'utf8'));
    if (cfg.ledgerPath) ledgerPath = cfg.ledgerPath;
  } catch { /* default */ }
  try {
    return fs.readFileSync(path.join(repoDir, ledgerPath), 'utf8')
      .split('\n')
      .filter((l) => l.trim().startsWith('|'))
      .map((l) => l.split('|').map((c) => c.trim()))
      .filter((c) => c[1] && /^\d{4}-\d{2}-\d{2}$/.test(c[1]))
      .map((c) => ({ date: c[1], deep: c[2], finding: c[3], verdict: c[7] || '' }));
  } catch { return []; }
}

function trailingStreak(rows) {
  let n = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i].verdict;
    if (v === 'INCONCLUSIVE') n++;
    else if (v === 'ACCEPT' || v === 'REJECT') break;
    // BLOCKED-ENV and anything else: neither counts nor resets.
  }
  return n;
}

const repos = fs.readdirSync(WORKSPACE, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => path.join(WORKSPACE, e.name))
  .filter((d) => fs.existsSync(path.join(d, 'dream.config.json')));

const lines = [`# Dream harvest — ${today} (last ${days} days)`, ''];
lines.push('| Repo | State | ACCEPT | REJECT | INCONCL | BLOCKED-ENV | Dry streak | Last night |');
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');

const pendingAccepts = [];
let envFaults = 0, totalNights = 0;

for (const dir of repos) {
  const name = path.basename(dir);
  const rows = ledgerRows(dir);
  const recent = rows.filter((r) => r.date >= since);
  const count = (v) => recent.filter((r) => r.verdict === v).length;
  const standby = fs.existsSync(path.join(dir, '.dream-standby')) ? 'standby' : 'active';
  const streak = trailingStreak(rows);
  const last = rows[rows.length - 1];
  envFaults += count('BLOCKED-ENV');
  totalNights += recent.length;
  for (const r of recent.filter((r) => r.verdict === 'ACCEPT')) {
    pendingAccepts.push({ repo: name, ...r });
  }
  lines.push(`| ${name} | ${standby} | ${count('ACCEPT')} | ${count('REJECT')} | ${count('INCONCLUSIVE')} | ${count('BLOCKED-ENV')} | ${streak} | ${last ? `${last.date} ${last.verdict}` : '—'} |`);
}

lines.push('');
if (pendingAccepts.length) {
  lines.push(`## ACCEPT nights awaiting human review (${pendingAccepts.length})`);
  lines.push('');
  lines.push('The machine never merges — each of these is a validated finding whose value is unrealised until a human reviews the branch/report:');
  lines.push('');
  for (const a of pendingAccepts) {
    lines.push(`- **${a.repo}** ${a.date} (${a.deep}): ${a.finding.slice(0, 140)}`);
  }
  lines.push('');
}

let inboxItems = [];
try { inboxItems = JSON.parse(fs.readFileSync(INBOX, 'utf8')); } catch { /* none */ }
const open = inboxItems.filter((i) => i.status === 'open');
const answered = inboxItems.filter((i) => i.status === 'answered');
lines.push(`## Operator inbox: ${open.length} open, ${answered.length} answered`);
lines.push('');
for (const i of open) lines.push(`- [${i.id}] (${i.repo}, ${i.date}) ${i.text.slice(0, 160)}`);
lines.push('');
lines.push(`## Harness health: ${envFaults} environment fault(s) across ${totalNights} night(s)`);
lines.push('');

const md = lines.join('\n');
fs.mkdirSync(ARTEFACTS, { recursive: true });
const outPath = path.join(ARTEFACTS, `harvest-${today}.md`);
fs.writeFileSync(outPath, md);
console.log(md);
console.error(`\nwritten: ${outPath}`);

// Queue a digest question when there is unharvested value.
if (pendingAccepts.length > 0) {
  try {
    const items = inboxItems;
    const text = `Dream harvest ${today}: ${pendingAccepts.length} ACCEPT night(s) await human review (${[...new Set(pendingAccepts.map((a) => a.repo))].join(', ')}). See ${outPath} and decide merge/discard.`;
    const id = 'hv' + today.replaceAll('-', '').slice(2);
    if (!items.some((i) => i.id === id && i.status === 'open')) {
      items.push({ id, kind: 'question', repo: 'harvest', night_id: `harvest-${today}`, date: today, text, status: 'open', answer: '', last_surfaced: 0 });
      fs.writeFileSync(INBOX, JSON.stringify(items, null, 2));
      console.error(`inbox: queued harvest review question ${id}`);
    }
  } catch (e) { console.error(`inbox queue failed (fail-open): ${e.message}`); }
}
