#!/usr/bin/env node
// Run inside the OLD container immediately before host activation. No key output.
// Closes declarative AoE bindings; retains records, worktrees and foreign sessions.
import { execFileSync } from 'node:child_process';
const managed = new Set(['tab0', 'codex', 'antigravity', 'openrouter', 'zai', 'deepseek', 'loom', 'loom-raw', 'router']);
const rows = JSON.parse(execFileSync('aoe', ['list', '--json'], { encoding: 'utf8' }));
const selected = rows.filter(s => managed.has(s.title) && !s.group);
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ close: selected.map(s => ({ id: s.id, slug: s.title })), retained: rows.length - selected.length }));
} else {
  if (!process.env.MANAGEMENT_API_KEY) throw new Error('MANAGEMENT_API_KEY unavailable; old bindings not closed');
  for (const s of selected) {
    const res = await fetch(new URL('/v1/sessions/boundary', process.env.MANAGEMENT_API_URL || 'http://127.0.0.1:9090'), {
      method: 'POST', headers: { authorization: `Bearer ${process.env.MANAGEMENT_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ phase: 'close', session_id: s.id, slug: s.title, outcome: 'replaced-by-session-plane' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`close ${s.title}: HTTP ${res.status}`);
    console.log(`closed AoE binding ${s.title} (${s.id})`);
  }
}
