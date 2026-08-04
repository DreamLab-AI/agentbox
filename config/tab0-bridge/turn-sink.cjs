#!/usr/bin/env node
// Claude Code hook sink → tab0-bridge. Fail-open by design: any error still
// exits 0, and Stop events always print {"ok":true} per local hook convention.
// UserPromptSubmit prints nothing (its stdout would be injected into context).

const fs = require('fs');
const http = require('http');

const BRIDGE = process.env.BRIDGE_URL || 'http://127.0.0.1:8971';
const event = process.argv[2] || 'Stop';

function finish() {
  if (event === 'Stop') process.stdout.write('{"ok":true}\n');
  process.exit(0);
}

function lastAssistantText(transcriptPath) {
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry;
      try { entry = JSON.parse(lines[i]); } catch { continue; }
      if (entry.type !== 'assistant' || !entry.message?.content) continue;
      const text = entry.message.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      if (text) return text;
    }
  } catch { /* fail open */ }
  return null;
}

let stdin = '';
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => {
  let text = null;
  try {
    const payload = JSON.parse(stdin || '{}');
    // Only mirror the tab-0 working plane (sessions rooted in the project).
    // Without this, the bridge's own headless `claude -p` sessions (cwd =
    // tab0-bridge/) would feed their replies back into the tab-0 feed.
    const cwd = payload.cwd || '';
    if (cwd && !cwd.startsWith('/home/devuser/workspace/project')) return finish();
    if (event === 'UserPromptSubmit') {
      text = payload.prompt || null;
    } else if (event === 'Stop') {
      text = payload.transcript_path ? lastAssistantText(payload.transcript_path) : null;
    }
  } catch { /* fail open */ }

  if (!text) return finish();

  const body = JSON.stringify({ event, text: text.slice(0, 20000) });
  const req = http.request(`${BRIDGE}/hook/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    timeout: 1500,
  }, (res) => { res.resume(); res.on('end', finish); });
  req.on('error', finish);
  req.on('timeout', () => { req.destroy(); finish(); });
  req.end(body);
});
setTimeout(finish, 3000).unref();
