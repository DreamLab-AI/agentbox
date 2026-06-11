// Live Agent Control Surface test: publish a PanelDefinition + PanelState +
// ActionRequest (kinds 31400/31401/31402) from the registered agentbox operator
// agent to the production DreamLab relay, exercising the full ACSP pipeline:
// builders -> sign -> NIP-42 AUTH -> relay agent_registry gate -> governance UI.
// Run from dreamlab-ai-website so nostr-tools resolves:
//   cd /home/devuser/workspace/dreamlab-ai-website && node /home/devuser/workspace/project/agentbox/scripts/acs-live-test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';

const require = createRequire('/home/devuser/workspace/project/agentbox/management-api/lib/');
const acs = require('/home/devuser/workspace/project/agentbox/management-api/lib/agent-control-surface.js');

const RELAY = 'wss://dreamlab-nostr-relay.solitary-paper-764d.workers.dev';
const envText = readFileSync('/home/devuser/workspace/project/agentbox/.env', 'utf8');
const sk = Uint8Array.from(Buffer.from(envText.match(/^AGENTBOX_PRIVKEY_HEX=["']?([0-9a-f]{64})/m)[1], 'hex'));
const pk = getPublicKey(sk);
console.log('agent pubkey:', pk.slice(0, 8) + '…');

const PANEL_ID = 'agentbox-release-ops';

const def = acs.buildPanelDefinition({
  panelId: PANEL_ID,
  title: 'Release Operations',
  description: 'AgentBox release pipeline decisions requiring operator approval',
  schema: 'action-inbox',
  layout: 'inbox-table',
  fields: [
    { name: 'package', fieldType: 'string', label: 'Package' },
    { name: 'from_version', fieldType: 'string', label: 'Current' },
    { name: 'to_version', fieldType: 'string', label: 'Proposed' },
  ],
  actions: [
    { id: 'approve', label: 'Approve', style: 'primary' },
    { id: 'reject', label: 'Reject', style: 'destructive' },
  ],
  capabilities: ['filter', 'sort'],
});

const state = acs.buildPanelState({
  panelId: PANEL_ID,
  state: {
    pending_decisions: 1,
    pipeline: 'crates.io publish',
    last_updated_by: 'agentbox-operator',
  },
});

const action = acs.buildActionRequest({
  panelId: PANEL_ID,
  title: 'Publish solid-pod-rs 1.0.0-beta.1 and yank legacy alphas',
  reasoning:
    'All 7 crates are production-proven at 0.4.0-alpha.17 (live forum pod tier, NIP-98 auth, economy loop). Proposal: cargo yank <=0.4.0-alpha.16 across the family (alpha.15 line carries the cost-accounting bug) and publish 1.0.0-beta.1, then converge all ecosystem consumers onto it.',
  priority: 'high',
  category: 'release',
  subjectKind: 'crate-family',
  subjectId: 'solid-pod-rs',
  fields: {
    package: 'solid-pod-rs (7 crates)',
    from_version: '0.4.0-alpha.17',
    to_version: '1.0.0-beta.1',
    yank: '<=0.4.0-alpha.16',
  },
});

const now = () => Math.floor(Date.now() / 1000);
const signed = [def, state, action].map((ev) =>
  finalizeEvent({ kind: ev.kind, created_at: ev.created_at ?? now(), tags: ev.tags, content: ev.content }, sk)
);
for (const ev of signed) console.log(`built kind=${ev.kind} id=${ev.id.slice(0, 8)} d=${(ev.tags.find(t => t[0] === 'd') || [])[1] || '-'}`);

const ws = new WebSocket(RELAY);
const acks = new Map();
setTimeout(() => { console.log('TIMEOUT; acks:', JSON.stringify([...acks])); process.exit(1); }, 20000);
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d[0] === 'AUTH') {
    const ev = finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', RELAY], ['challenge', d[1]]], content: '' }, sk);
    ws.send(JSON.stringify(['AUTH', ev]));
    setTimeout(() => { for (const s of signed) ws.send(JSON.stringify(['EVENT', s])); }, 700);
  } else if (d[0] === 'OK') {
    acks.set(d[1].slice(0, 8), { ok: d[2], msg: d[3] || '' });
    if (acks.size === signed.length) {
      console.log('PUBLISH RESULTS:');
      for (const [id, v] of acks) console.log(`  ${id}: ${v.ok ? 'ACCEPTED' : 'REJECTED'} ${v.msg}`);
      process.exit([...acks.values()].every(v => v.ok) ? 0 : 1);
    }
  } else if (d[0] === 'NOTICE') console.log('NOTICE:', d[1]);
};
