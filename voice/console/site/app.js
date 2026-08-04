// agentbox · interaction plane — operator cockpit behaviour.
//
// One self-signed TLS origin (:8444), one credential. Same-origin routes
// (Caddyfile): /embed + /api/* → Unmute; /feed + /bridge/* → tab0-bridge;
// /aoe/* → AoE sessions via the NIP-98 sole-ingress proxy (:9096); /approvals/*
// → management-api governance (:9090).
//
// AUTH MODEL
//   /bridge/* + /feed  — tab0-bridge bearer (BRIDGE_TOKEN). Header for fetch,
//                        ?token= for the WebSocket upgrade (browsers can't set
//                        headers on a WS handshake).
//   /aoe/* + /approvals/* — governed. Preferred: a NIP-98 (kind-27235) header
//                        signed via window.nostr (NIP-07). The proxy/auth layer
//                        now runs a replay cache (Part A finding 4), so a signed
//                        token can't be reused → we sign per request. Reads
//                        (session polling) therefore prefer the break-glass
//                        bearer to avoid a signer prompt on every poll;
//                        authoritative writes (approve/deny, inject) sign fresh.
//
//   NIP-98 `u` tag: the verifier reconstructs the upstream URL AFTER Caddy's
//   handle_path strips the /aoe and /approvals prefix, and matches with
//   `u === url || u.endsWith(url)`. So we MUST sign the prefix-stripped path
//   (location.origin + strippedPath), not the browser-visible path. See
//   stripPrefix() below.

'use strict';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };

// ── auth store ──────────────────────────────────────────────────────────────

const BEARER_KEY = 'agentbox-bearer';
const getBearer = () => sessionStorage.getItem(BEARER_KEY) || '';
const setBearer = (v) => { if (v) sessionStorage.setItem(BEARER_KEY, v); else sessionStorage.removeItem(BEARER_KEY); refreshAuthBadge(); };
const hasNostr = () => typeof window.nostr === 'object' && window.nostr && typeof window.nostr.signEvent === 'function';

let operatorPubkey = null; // cached x-only hex once the signer reveals it

function refreshAuthBadge() {
  const badge = $('auth-state');
  badge.className = '';
  if (operatorPubkey) {
    badge.classList.add('signed');
    badge.textContent = 'nostr ' + operatorPubkey.slice(0, 8) + '…';
    badge.title = 'signed NIP-98 as ' + operatorPubkey;
  } else if (hasNostr()) {
    badge.classList.add('signed');
    badge.textContent = 'nip-07 ready';
    badge.title = 'a browser Nostr signer is available';
  } else if (getBearer()) {
    badge.classList.add('bearer');
    badge.textContent = 'bearer';
    badge.title = 'break-glass bearer set for this tab';
  } else {
    badge.textContent = 'no key';
    badge.title = 'no operator credential — /aoe and /approvals will be unauthorised';
  }
}

// hex(sha256(str)) via SubtleCrypto (available in this secure context)
async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Map a browser path to the upstream-visible path Caddy forwards after
// handle_path strips the route prefix.
function stripPrefix(path) {
  if (path.startsWith('/aoe/')) return path.slice(4) || '/';        // /aoe/api/x → /api/x
  if (path.startsWith('/approvals/')) return path.slice(10) || '/'; // /approvals/v1/x → /v1/x
  return path;
}

// Build a NIP-98 Authorization header for a governed request. Signs the
// prefix-stripped URL so the server-side `u`-tag match succeeds.
async function signNip98(method, path, bodyString) {
  const url = location.origin + stripPrefix(path.split('?')[0]);
  const tags = [['u', url], ['method', method.toUpperCase()]];
  if (bodyString) tags.push(['payload', await sha256hex(bodyString)]);
  const event = { kind: 27235, created_at: Math.floor(Date.now() / 1000), tags, content: '' };
  const signed = await window.nostr.signEvent(event);
  if (signed && signed.pubkey && signed.pubkey !== operatorPubkey) {
    operatorPubkey = signed.pubkey; refreshAuthBadge();
  }
  return 'Nostr ' + btoa(JSON.stringify(signed));
}

// Resolve the Authorization header for a request.
//   preferBearer=true  → reads: use bearer if present (no signer prompt),
//                        else NIP-98, else nothing.
//   preferBearer=false → writes: prefer NIP-98 (required for approvals), else
//                        bearer (works for /aoe via break-glass), else nothing.
async function authHeader(path, method, bodyString, preferBearer) {
  const governed = path.startsWith('/aoe/') || path.startsWith('/approvals/');
  const bearer = getBearer();
  if (!governed) return bearer ? { Authorization: 'Bearer ' + bearer } : {};
  if (preferBearer && bearer) return { Authorization: 'Bearer ' + bearer };
  if (hasNostr()) {
    try { return { Authorization: await signNip98(method, path, bodyString) }; }
    catch (err) { if (bearer) return { Authorization: 'Bearer ' + bearer }; throw err; }
  }
  if (bearer) return { Authorization: 'Bearer ' + bearer };
  return {};
}

async function authFetch(path, { method = 'GET', json: jsonBody, preferBearer = (method === 'GET') } = {}) {
  const bodyString = jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined;
  const headers = await authHeader(path, method, bodyString, preferBearer);
  if (bodyString) headers['content-type'] = 'application/json';
  return fetch(path, { method, headers, body: bodyString });
}

// ── toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;
function toast(msg, kind = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 4200);
}

// ── health chips ──────────────────────────────────────────────────────────────

function setChip(id, ok, title) { const c = $(id); c.className = 'chip ' + (ok ? 'ok' : 'bad'); if (title) c.title = title; }

async function pollHealth() {
  try {
    const h = await (await authFetch('/bridge/health')).json();
    setChip('chip-bridge', h.ok, `backend ${h.backend} · model ${h.model} · turns ${h.turns}`);
  } catch { setChip('chip-bridge', false); }
  try {
    const v = await (await fetch('/api/v1/health')).json();
    setChip('chip-voice', !!v.ok);
  } catch { setChip('chip-voice', false); }
  try {
    const n = await (await authFetch('/bridge/nostr/status')).json();
    setChip('chip-nostr', n.gateway === 'armed', `gateway ${n.gateway} · mirror ${n.mirrorKey ? 'present' : 'missing'}`);
    $('nostr-state').textContent = n.gateway;
  } catch { setChip('chip-nostr', false); $('nostr-state').textContent = 'unreachable'; }
}

// ── voice presence state (derived from the live feed) ─────────────────────────
// The Unmute /embed iframe is cross-origin so we can't read its audio state
// directly; instead we infer listening/speaking from the bridge's turn stream:
// a fresh `voice-user` turn = the operator was just heard (listening), a
// `voice-reply` = the meta-controller is speaking. Decays to idle.

let voiceDecay = null;
function setVoiceState(state) {
  document.body.className = 'voice-' + state;
  const labels = { idle: 'Idle', listening: 'Listening', speaking: 'Speaking' };
  $('voice-state-label').textContent = labels[state] || 'Idle';
  clearTimeout(voiceDecay);
  if (state !== 'idle') voiceDecay = setTimeout(() => setVoiceState('idle'), state === 'speaking' ? 6000 : 3500);
}

// ── transcript feed (websocket) ───────────────────────────────────────────────

const KINDS = {
  user: 'you → coordinator', assistant: 'coordinator',
  'voice-user': 'heard (STT)', 'voice-inject': 'voice → session', 'voice-reply': 'voice',
  'nostr-inject': 'nostr → session', 'nostr-out': 'console → nostr',
};
const feed = () => $('feed');
const seenTurns = new Map();
const atBottom = (n) => n.scrollHeight - n.scrollTop - n.clientHeight < 60;

function renderTurn(turn) {
  if (turn.kind === 'voice-user') setVoiceState('listening');
  else if (turn.kind === 'voice-reply') setVoiceState('speaking');

  const box = feed();
  const pinned = atBottom(box);
  let node = seenTurns.get(turn.id);
  if (!node) { node = el('div'); seenTurns.set(turn.id, node); box.appendChild(node); }
  const brief = turn.summary || (turn.text.length > 300 ? turn.text.slice(0, 300) + ' …' : turn.text);
  const hasMore = Boolean(turn.summary) || turn.text.length > 300;
  node.className = 'turn ' + turn.kind + (hasMore ? ' has-more' : '');
  node.innerHTML = '<div class="meta"></div><pre class="brief"></pre><pre class="full"></pre>';
  node.querySelector('.meta').textContent = `${KINDS[turn.kind] || turn.kind} · ${String(turn.ts).slice(11, 19)}`;
  node.querySelector('.brief').textContent = brief;
  node.querySelector('.full').textContent = turn.text;
  if (hasMore) node.onclick = () => node.classList.toggle('expanded');
  if (pinned) box.scrollTop = box.scrollHeight;
}

let feedWs = null;
let feedManualClose = false;
function connectFeed() {
  const bearer = getBearer();
  const url = `wss://${location.host}/feed` + (bearer ? `?token=${encodeURIComponent(bearer)}` : '');
  feedManualClose = false;
  try { feedWs = new WebSocket(url); } catch { $('feed-state').textContent = 'error'; return; }
  const ws = feedWs;
  ws.onopen = () => { $('feed-state').textContent = 'live'; };
  ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'snapshot') msg.turns.forEach(renderTurn);
    else if (msg.type === 'turn' || msg.type === 'turn-update') renderTurn(msg.turn);
  };
  ws.onclose = () => {
    if (feedManualClose) return;               // deliberate reconnect handles itself
    $('feed-state').textContent = 'reconnecting';
    setTimeout(connectFeed, 2500);
  };
  ws.onerror = () => { try { ws.close(); } catch { /* already closing */ } };
}
// Re-open the feed with the new credential when the bearer changes.
function reconnectFeed() {
  if (feedWs && (feedWs.readyState === 0 || feedWs.readyState === 1)) {
    feedManualClose = true;
    try { feedWs.close(); } catch { /* ignore */ }
  }
  connectFeed();
}

// ── AoE session board ─────────────────────────────────────────────────────────

let sessions = [];
let coordinatorId = null;
let aimedId = 'coordinator';    // 'coordinator' | AoE session id
let openId = null;              // opened session detail id (null = board)

const sid = (s) => String(s.id ?? s.session_id ?? s.uuid ?? '');
const stitle = (s) => s.title || s.slug || s.name || sid(s).slice(0, 8) || 'session';
const sstate = (s) => String(s.state || s.status || s.run_state || 'unknown');
const sagent = (s) => s.agent || s.agent_name || s.harness || s.kind || '';
const sbranch = (s) => s.branch || s.worktree_branch || (s.worktree && (s.worktree.branch || s.worktree.name)) || '';
const slastAt = (s) => s.last_activity || s.updated_at || s.last_activity_at || s.lastActivity || s.mtime || null;

function stateClass(state) {
  const s = state.toLowerCase();
  if (s.startsWith('run')) return 'state-running';
  if (s.startsWith('wait')) return 'state-waiting';
  if (s.startsWith('idle') || s.startsWith('ready')) return 'state-idle';
  if (s.startsWith('err') || s.startsWith('fail')) return 'state-error';
  return 'state-stopped';
}
function ageStr(ts) {
  if (!ts) return '';
  const ms = typeof ts === 'number' ? (ts < 1e12 ? ts * 1000 : ts) : Date.parse(ts);
  if (!ms || Number.isNaN(ms)) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return Math.floor(s) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
function agentGlyph(agent, state) {
  if (stateClass(state) === 'state-error') return '!';
  const a = (agent || '').toLowerCase();
  if (a.includes('claude')) return 'C';
  if (a.includes('codex')) return 'X';
  if (a.includes('gemini') || a.includes('antigrav')) return 'G';
  if (a.includes('qwen')) return 'Q';
  if (a.includes('kimi')) return 'K';
  return '●';
}

function aimedName() {
  if (aimedId === 'coordinator') return 'tab0 coordinator';
  const s = sessions.find((x) => sid(x) === aimedId);
  return s ? stitle(s) : aimedId.slice(0, 8) + '…';
}
function setAim(id) {
  aimedId = id;
  $('voice-aim-name').textContent = aimedName();
  renderBoard();
  if (openId) syncDetailTo();
}

function renderBoard() {
  const board = $('board');
  $('board-count').textContent = String(sessions.length);
  // reconcile children by id to avoid full re-render flicker
  board.innerHTML = '';
  if (!sessions.length) { $('board-empty').hidden = false; return; }
  $('board-empty').hidden = true;

  for (const s of sessions) {
    const id = sid(s);
    const state = sstate(s);
    const isCoord = id === coordinatorId;
    const aimed = aimedId === id || (isCoord && aimedId === 'coordinator');
    const card = el('div', 'card ' + stateClass(state) + (aimed ? ' aimed' : ''));
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `open session ${stitle(s)} (${state})`);

    if (aimed) card.appendChild(el('span', 'voice-tag', 'voice'));

    const top = el('div', 'card-top');
    const ring = el('div', 'ring', agentGlyph(sagent(s), state));
    top.appendChild(ring);
    const idbox = el('div', 'card-id');
    idbox.appendChild(el('div', 'card-title', stitle(s)));
    const agentTxt = sagent(s) || 'session';
    idbox.appendChild(el('div', 'card-agent', isCoord ? agentTxt + ' · coordinator' : agentTxt));
    top.appendChild(idbox);
    card.appendChild(top);

    const meta = el('div', 'card-meta');
    meta.appendChild(el('span', 'pill state', state));
    const br = sbranch(s); if (br) meta.appendChild(el('span', 'pill branch', br));
    const age = ageStr(slastAt(s)); if (age) meta.appendChild(el('span', 'pill age', age + ' ago'));
    if (isCoord) meta.appendChild(el('span', 'pill coord', 'coordinator'));
    card.appendChild(meta);

    const actions = el('div', 'card-actions');
    const openBtn = el('button', 'mini', 'Open'); openBtn.type = 'button';
    const aimBtn = el('button', 'mini aim' + (aimed ? ' on' : ''), aimed ? '◎ Aimed' : 'Aim voice'); aimBtn.type = 'button';
    actions.appendChild(openBtn); actions.appendChild(aimBtn);
    card.appendChild(actions);

    openBtn.onclick = (e) => { e.stopPropagation(); openSession(id); };
    aimBtn.onclick = (e) => { e.stopPropagation(); setAim(isCoord ? 'coordinator' : id); };
    card.onclick = () => openSession(id);
    card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSession(id); } };
    board.appendChild(card);
  }
}

async function pollSessions() {
  try {
    const res = await authFetch('/aoe/api/sessions?state=live');
    if (res.status === 401 || res.status === 403) { setChip('chip-aoe', false, 'unauthorised — set an operator credential'); return; }
    if (!res.ok) { setChip('chip-aoe', false, 'aoe ' + res.status); return; }
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.sessions || data.data || []);
    sessions = list;
    // best-effort coordinator resolution (matches the bridge's title heuristic)
    if (data.coordinator) coordinatorId = String(data.coordinator);
    else if (!coordinatorId) {
      const c = list.find((s) => ['tab0', 'coordinator'].some((w) => stitle(s).toLowerCase().includes(w)));
      if (c) coordinatorId = sid(c);
    }
    setChip('chip-aoe', true, `${list.length} live session(s)`);
    renderBoard();
    if (openId) refreshDetailHead();
  } catch (err) { setChip('chip-aoe', false, 'aoe unreachable'); }
}

// ── session detail: terminal (poll /output) + diff ────────────────────────────

let detailTimer = null;
let detailView = 'term'; // 'term' | 'diff'

function currentDetailSession() { return sessions.find((s) => sid(s) === openId) || null; }

function refreshDetailHead() {
  const s = currentDetailSession();
  const state = s ? sstate(s) : 'unknown';
  const ring = $('detail-ring');
  ring.textContent = s ? agentGlyph(sagent(s), state) : '•';
  // The state-* class on the head lets the existing `.state-* .ring` CSS colour
  // the ring (the ring is a descendant of #detail-head).
  $('detail-head').className = stateClass(state);
  $('detail-title').textContent = s ? stitle(s) : openId;
  const sub = $('detail-sub'); sub.innerHTML = '';
  sub.appendChild(el('span', '', sagent(s || {}) || 'session'));
  sub.appendChild(el('span', '', state));
  const br = sbranch(s || {}); if (br) sub.appendChild(el('span', 'br', '⑂ ' + br));
}

function syncDetailTo() {
  const isAimed = openId === aimedId || (openId === coordinatorId && aimedId === 'coordinator');
  $('detail-to').textContent = (isAimed ? '◎ ' : '→ ') + 'this session';
}

// minimal ANSI SGR → HTML (16-colour + bold/dim), everything else stripped
function ansiToHtml(text) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = '';
  let open = 0;
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0, m;
  const apply = (codes) => {
    for (const raw of codes.split(';')) {
      const c = Number(raw || '0');
      if (c === 0) { out += '</span>'.repeat(open); open = 0; }
      else if (c === 1) { out += '<span class="a-bold">'; open++; }
      else if (c === 2) { out += '<span class="a-dim">'; open++; }
      else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) { out += `<span class="a-${c}">`; open++; }
    }
  };
  while ((m = re.exec(text)) !== null) {
    out += esc(text.slice(last, m.index));
    apply(m[1]);
    last = re.lastIndex;
  }
  out += esc(text.slice(last));
  out += '</span>'.repeat(open);
  // strip any residual non-SGR escape sequences (cursor moves, clears)
  return out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

function colourDiff(text) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.split('\n').map((line) => {
    let cls = '';
    if (/^\+\+\+|^---|^diff /.test(line)) cls = 'd-hdr';
    else if (/^@@/.test(line)) cls = 'd-hunk';
    else if (/^\+/.test(line)) cls = 'd-add';
    else if (/^-/.test(line)) cls = 'd-del';
    return cls ? `<span class="${cls}">${esc(line)}</span>` : esc(line);
  }).join('\n');
}

async function pollDetail() {
  if (!openId) return;
  if (detailView === 'term') {
    try {
      const res = await authFetch(`/aoe/api/sessions/${encodeURIComponent(openId)}/output?lines=200&format=text`);
      const term = $('term');
      const pinned = atBottom(term);
      if (res.status === 401 || res.status === 403) { term.textContent = '(unauthorised — set an operator credential)'; return; }
      if (!res.ok) { if (!term.textContent) term.textContent = `(no output — ${res.status})`; return; }
      const txt = await res.text();
      term.innerHTML = ansiToHtml(txt) || '(empty pane)';
      if (pinned) term.scrollTop = term.scrollHeight;
    } catch { /* keep last capture on transient error */ }
  }
}

async function loadDiff() {
  const diff = $('diff');
  diff.textContent = 'loading diff…';
  // try the documented shapes in order; render whatever text comes back
  for (const p of [`/aoe/api/sessions/${encodeURIComponent(openId)}/diff`,
                   `/aoe/api/sessions/${encodeURIComponent(openId)}/diff/file`]) {
    try {
      const res = await authFetch(p);
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      let text;
      if (ct.includes('json')) {
        const j = await res.json();
        text = typeof j === 'string' ? j : (j.diff || j.patch || j.content || JSON.stringify(j, null, 2));
      } else { text = await res.text(); }
      diff.innerHTML = text && text.trim() ? colourDiff(text) : '(no changes in this worktree)';
      return;
    } catch { /* try next shape */ }
  }
  diff.textContent = '(diff unavailable for this session)';
}

function setDetailView(v) {
  detailView = v;
  $('tab-term').classList.toggle('on', v === 'term');
  $('tab-diff').classList.toggle('on', v === 'diff');
  $('term').hidden = v !== 'term';
  $('diff').hidden = v !== 'diff';
  if (v === 'diff') loadDiff();
  else pollDetail();
}

function openSession(id) {
  openId = id;
  $('board-wrap').hidden = true;
  $('detail').hidden = false;
  $('term').textContent = 'attaching…';
  refreshDetailHead();
  syncDetailTo();
  setDetailView('term');
  clearInterval(detailTimer);
  detailTimer = setInterval(pollDetail, 1600);
}

function closeSession() {
  openId = null;
  clearInterval(detailTimer);
  $('detail').hidden = true;
  $('board-wrap').hidden = false;
}

// ── injection: type into the aimed / opened session ───────────────────────────
// Coordinator writes go through the bridge (records the shared transcript +
// fail-open tmux fallback, ADR-044); any other session is written directly on
// the AoE injection path (POST /api/sessions/{id}/send).

async function inject(text, targetId) {
  const clean = text.trim();
  if (!clean) return;
  const isCoord = targetId === 'coordinator' || targetId === coordinatorId;
  if (isCoord) {
    const res = await authFetch('/bridge/tab0/send', { method: 'POST', json: { text: clean, source: 'console' } });
    if (!res.ok) throw new Error('bridge ' + res.status);
  } else {
    const res = await authFetch(`/aoe/api/sessions/${encodeURIComponent(targetId)}/send`,
      { method: 'POST', json: { message: clean }, preferBearer: false });
    if (!res.ok) throw new Error('aoe send ' + res.status + ': ' + (await res.text()).slice(0, 120));
  }
}

// ── approvals ─────────────────────────────────────────────────────────────────

let approvals = [];
function apprTitle(a) { return a.title || a.summary || a.action || a.case_id || (a.request_event_id || '').slice(0, 12) || 'request'; }
function apprId(a) { return a.request_event_id || a.id || a.event_id; }

function renderApprovals() {
  const box = $('approvals');
  $('appr-count').textContent = String(approvals.length);
  box.innerHTML = '';
  if (!approvals.length) { const e = el('div', '', 'No governance requests pending.'); e.id = 'appr-empty'; box.appendChild(e); return; }
  for (const a of approvals) {
    const id = apprId(a);
    const card = el('div', 'appr');
    card.appendChild(el('div', 'a-title', apprTitle(a)));
    const meta = el('div', 'a-meta');
    if (a.priority) meta.appendChild(el('span', 'prio', a.priority));
    if (a.requester_pubkey) meta.appendChild(el('span', 'mono', 'by ' + String(a.requester_pubkey).slice(0, 10) + '…'));
    if (a.created_at) meta.appendChild(el('span', '', ageStr(a.created_at) + ' ago'));
    card.appendChild(meta);
    const note = el('div', 'a-note');
    const actions = el('div', 'a-actions');
    const approve = el('button', 'approve', 'Approve');
    const deny = el('button', 'deny', 'Deny');
    approve.type = deny.type = 'button';
    approve.onclick = () => decide(id, 'approve', card, note, [approve, deny]);
    deny.onclick = () => decide(id, 'deny', card, note, [approve, deny]);
    actions.appendChild(approve); actions.appendChild(deny);
    card.appendChild(actions);
    card.appendChild(note);
    box.appendChild(card);
  }
}

async function decide(id, decision, card, note, btns) {
  if (!hasNostr()) {
    note.className = 'a-note err';
    note.textContent = 'A NIP-98 signature is required — approvals cannot be released with a bearer alone. Connect a NIP-07 signer.';
    return;
  }
  btns.forEach((b) => (b.disabled = true));
  note.className = 'a-note';
  note.textContent = 'signing decision…';
  try {
    const res = await authFetch(`/approvals/v1/approvals/${encodeURIComponent(id)}/decide`,
      { method: 'POST', json: { decision }, preferBearer: false });
    if (res.ok) {
      toast(`Decision published: ${decision}`, 'ok');
      approvals = approvals.filter((a) => apprId(a) !== id);
      renderApprovals();
      return;
    }
    let msg = 'decide ' + res.status;
    try { const j = await res.json(); msg = j.message || j.error || msg; } catch { /* text body */ }
    note.className = 'a-note err';
    note.textContent = msg;
    btns.forEach((b) => (b.disabled = false));
  } catch (err) {
    note.className = 'a-note err';
    note.textContent = 'signing failed: ' + err.message;
    btns.forEach((b) => (b.disabled = false));
  }
}

async function pollApprovals() {
  try {
    const res = await authFetch('/approvals/v1/approvals');
    if (!res.ok) return;
    const data = await res.json();
    approvals = data.approvals || data.pending || [];
    renderApprovals();
  } catch { /* rail header already reflects reachability via chips */ }
}

// ── nostr mini panel ──────────────────────────────────────────────────────────

async function pollNostrEvents() {
  try {
    const d = await (await authFetch('/bridge/nostr/events?n=12')).json();
    const box = $('nostr-events');
    box.innerHTML = '';
    (d.events || []).slice().reverse().forEach((e) => {
      const div = el('div', 'evt');
      const ts = new Date((e.ts || 0) * 1000).toISOString().slice(5, 16).replace('T', ' ');
      div.appendChild(el('span', 'ts', ts));
      div.appendChild(el('span', 'cmd', e.cmd || JSON.stringify(e)));
      box.appendChild(div);
    });
  } catch { /* panel is best-effort */ }
}

// ── composers ─────────────────────────────────────────────────────────────────

function wireForm(formId, inputId, handler) {
  $(formId).addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $(inputId);
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    try { await handler(text); input.value = ''; }
    catch (err) { toast(err.message || 'send failed', 'err'); }
    finally { input.disabled = false; input.focus(); }
  });
}

// ── auth dialog ────────────────────────────────────────────────────────────────

function openAuthDialog() {
  $('bearer-in').value = getBearer();
  $('nip07-state').textContent = hasNostr() ? 'NIP-07 detected' : 'NIP-07 not detected';
  $('nip07-state').className = hasNostr() ? 'tag-ok' : 'tag-no';
  $('auth-dialog').showModal();
}
$('auth-dialog').addEventListener('close', () => {
  const dlg = $('auth-dialog');
  if (dlg.returnValue === 'save') {
    const prev = getBearer();
    setBearer($('bearer-in').value.trim());
    if (getBearer() !== prev) reconnectFeed();
    toast('Credential updated', 'ok');
    pollSessions(); pollApprovals();
  } else if (dlg.returnValue === 'clear') {
    setBearer('');
    reconnectFeed();
    toast('Bearer cleared', '');
  }
});

// ── boot ───────────────────────────────────────────────────────────────────────

$('auth-open').onclick = openAuthDialog;
$('board-refresh').onclick = () => pollSessions();
$('detail-close').onclick = closeSession;
$('tab-term').onclick = () => setDetailView('term');
$('tab-diff').onclick = () => setDetailView('diff');

wireForm('detail-send', 'detail-text', (text) => {
  const target = openId === coordinatorId ? 'coordinator' : openId;
  return inject(text, target);
});
wireForm('nostr-send', 'nostr-text', async (text) => {
  const res = await authFetch('/bridge/nostr/send', { method: 'POST', json: { text } });
  if (!res.ok) throw new Error('nostr ' + res.status);
});

refreshAuthBadge();
setVoiceState('idle');
connectFeed();
pollHealth();
pollSessions();
pollApprovals();
pollNostrEvents();
setInterval(pollHealth, 12000);
setInterval(pollSessions, 4000);
setInterval(pollApprovals, 8000);
setInterval(pollNostrEvents, 20000);

// If the signer becomes available late (extension injects after load), reflect it.
window.addEventListener('nostr:ready', refreshAuthBadge);
setTimeout(refreshAuthBadge, 1500);
