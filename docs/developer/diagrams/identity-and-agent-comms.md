# Identity, Session Mirror, and Agent-Communication Diagrams

Cartographic audit of identity plumbing and agent communication surfaces.
All diagrams are built from the actual source code at the file:line references
shown in each section. No material is invented or inferred from external
documentation.

Scope files examined:

- `scripts/sovereign-bootstrap.py`
- `management-api/lib/uris.js`
- `management-api/lib/junkiejarvis-agent.js`
- `management-api/lib/per-user-agent.js`
- `management-api/lib/bc20-provenance-bridge.js`
- `config/hooks/nostr-live-mirror.cjs`
- `config/entrypoint-unified.sh` (lines 581-604 for mirror-hook registration)
- `services/nostr-pod-bridge/src/main.rs` + `src/lib.rs`

---

## 1. Session Mirror: Claude Hook → Nostr Relay

Source: `config/hooks/nostr-live-mirror.cjs` lines 44-337.
Hook registration: `config/entrypoint-unified.sh` lines 581-604.

```mermaid
sequenceDiagram
    autonumber
    participant CC as Claude Code<br/>(hook runner)
    participant H as nostr-live-mirror.cjs<br/>(argv[2] = event name)
    participant DK as deriveChildKey()<br/>HMAC-SHA256(operatorSk, tag)
    participant NT as nostr-tools<br/>nip59.wrapEvent()
    participant R as Cloud Relay<br/>wss://dreamlab-nostr-relay…

    note over CC: Hook fired on one of:<br/>SessionStart / UserPromptSubmit<br/>Stop / SessionEnd

    CC->>H: exec with JSON on STDIN<br/>+ event name as argv[2]

    H->>H: Gate 1 – AGENTBOX_LIVE_MIRROR<br/>If == "0" → exit 0 (no-op)

    H->>DK: Attempt key derivation<br/>reads AGENTBOX_PRIVKEY_HEX or<br/>AGENTBOX_BRIDGE_SK or<br/>OPERATOR_NOSTR_PRIVKEY<br/>(line 132)

    alt AGENTBOX_MIRROR_CHILD == "0"
        DK-->>H: null (child mode off)
    else operator key present
        DK->>DK: HMAC-SHA256(hex_sk,<br/>AGENTBOX_MIRROR_KEY_TAG<br/>|| "agentbox-mirror-v1")<br/>(line 136)
        DK-->>H: childSk: Uint8Array[32]
    else no operator key
        DK-->>H: null
    end

    H->>H: Gate 2 – need childSk OR explicit<br/>recipientPubkey from one of:<br/>AGENTBOX_MIRROR_RECIPIENT_PUBKEY<br/>AGENTBOX_PUBKEY<br/>AGENTBOX_BRIDGE_RECIPIENT_PUBKEY<br/>AGENTBOX_ADMIN_PUBKEY<br/>(line 71-77)<br/>If both null → exit 0 (no-op)

    H->>H: bodyForEvent(event, payload)<br/>→ body string or null<br/>If null → exit 0

    H->>H: loadNostrTools() + loadWs()<br/>candidates: management-api/node_modules<br/>then mcp/node_modules<br/>(line 93-117)<br/>If either missing → exit 0

    H->>H: Build kind-14 DM rumor<br/>{ kind:14, content:body,<br/>  tags:[["p", recipient]],<br/>  created_at: now }<br/>(line 309-316)

    note over H: Default path (childSk present):<br/>sender = childSk<br/>recipient = getPublicKey(childSk)<br/>→ self-DM on derived child identity.<br/>Legacy path (no childSk):<br/>sender = operatorSk or throwaway key<br/>recipient = explicitRecipient

    H->>NT: nip59.wrapEvent(rumor, sk, recipient)<br/>→ kind-1059 gift wrap<br/>First ["p"] tag = recipient<br/>(line 316)

    NT-->>H: signed kind-1059 wrap

    H->>R: WebSocket connect<br/>deadline = 6000ms total<br/>(line 49, 234)

    H->>R: send ["EVENT", wrap]

    R-->>H: ["OK", wrap.id, accepted, reason]<br/>or timeout/close

    note over H: publishWrap resolves on<br/>OK/close/error/timeout.<br/>Any error swallowed — exit 0.<br/>Hard kill guard at DEADLINE+1500ms<br/>(line 332)

    H-->>CC: exit 0 (always, fail-open)
```

### Mirror relay policy (line 44-88)

- Default relay: `wss://dreamlab-nostr-relay.solitary-paper-764d.workers.dev` (hardcoded).
- Single override: `NOSTR_MIRROR_RELAY` (must match `wss?://`). Public relays (`NOSTR_RELAYS`) are deliberately ignored.
- The relay admits a kind-1059 gift wrap only when its first `["p"]` tag recipient is whitelisted; the child-key self-DM satisfies this because the child is pre-whitelisted.

---

## 2. JunkieJarvis Agent Loop

Source: `management-api/lib/junkiejarvis-agent.js`.
Startup gate: `startJunkieJarvis()` lines 684-733.

```mermaid
sequenceDiagram
    autonumber
    participant MA as management-api<br/>server.js
    participant JJ as JunkieJarvisAgent<br/>junkiejarvis-agent.js
    participant B as NostrBridge<br/>mcp/servers/nostr-bridge.js
    participant R as Sovereign Relay<br/>(zone-gated NIP-42)
    participant LLM as LLM Provider<br/>(callLlm)
    participant NT as nostr-tools<br/>nip59 / finalizeEvent

    MA->>JJ: startJunkieJarvis(deps)<br/>gate: JUNKIEJARVIS_ENABLED=true<br/>reads JUNKIEJARVIS_PRIVKEY_HEX<br/>or CONCIERGE_PRIVKEY_HEX (line 57)

    JJ->>B: bridge.setAuthSigner(signer)<br/>Registers signer BEFORE subscribe<br/>so NIP-42 AUTH answer is ready<br/>(line 715)

    B->>R: WebSocket connect

    R-->>B: ["AUTH", challenge]<br/>(NIP-42 relay session auth)

    B->>B: buildNip98Header / finalizeEvent<br/>Sign kind-22242 AUTH event<br/>with JJ signer<br/>(nostr-bridge.js line 557-589)

    B->>R: ["AUTH", kind-22242]

    note over JJ: agent.start() registers two subscriptions

    JJ->>B: subscribe({kinds:[1059], '#p':[jjPubkey]})<br/>gift-wrapped DMs (line 479)

    JJ->>B: subscribe({kinds:[42], '#p':[jjPubkey]})<br/>channel mentions (line 490)

    loop Event received

        B-->>JJ: event (relay broadcast)

        JJ->>JJ: _dedup(event.id)<br/>Capped LRU set, cap=2000 (line 459)

        alt kind == 1059 (gift-wrapped DM)
            JJ->>NT: nip59.unwrapEvent(wrap, signer.skBytes)<br/>(line 535)
            NT-->>JJ: rumor { pubkey, content }
            JJ->>JJ: _shouldIgnore(asker)?<br/>self + JUNKIEJARVIS_IGNORE_PUBKEYS<br/>or CONCIERGE_IGNORE_PUBKEYS (line 448)

            JJ->>LLM: callLlm(userText)<br/>Provider selection (line 294):<br/>1. ANTHROPIC_API_KEY → Anthropic messages API<br/>   model: JUNKIEJARVIS_MODEL or claude-haiku-4-5-20251001<br/>2. JUNKIEJARVIS_LLM_KEY or ZAI_API_KEY → OpenAI-compat<br/>   base: JUNKIEJARVIS_LLM_BASE or z.ai paas/v4<br/>   model glm-4.5-flash, thinking disabled<br/>3. OLLAMA_BASE_URL → Ollama /api/chat<br/>date-context injected: ISO UTC + Europe/London + epoch<br/>timeout: 25000ms (line 265)<br/>max_tokens: 300

            LLM-->>JJ: llmText (or CANNED_APOLOGY)

            JJ->>JJ: parseDirective(llmText)<br/>If first line is {"tool":"create_event",...}<br/>→ normaliseEventDirective() → _createEvent()<br/>(lines 139-165)

            opt directive valid
                JJ->>NT: finalizeEvent(kind-31923, skBytes)<br/>buildCalendarEvent(spec) (line 245)
                JJ->>B: bridge.publish(signed, identity)<br/>NIP-52 calendar event
            end

            JJ->>NT: nip59.wrapEvent(rumor14, skBytes, asker)<br/>(line 563)<br/>ephemeral outer key from nostr-tools

            JJ->>B: bridge.publish(wrapped, {sign:e=>e})<br/>raw publish (already signed by ephemeral key)

        else kind == 42 (channel message)
            JJ->>JJ: isChannelMention(event, jjPubkey)<br/>p-tag OR /@junkiejarvis/i in content<br/>(line 100-106)
            JJ->>LLM: callLlm(userText stripped @mention)
            LLM-->>JJ: llmText
            JJ->>JJ: _sendChannelReply()<br/>kind-42, preserves NIP-28 root e-tag<br/>(line 587-609)
            JJ->>B: bridge.publish(unsigned, signer)<br/>signer.sign() calls finalizeEvent
        end
    end
```

---

## 3. Per-User Agent Fabric (PUAF): Binding → Identity → Memory → Heartbeat

Source: `management-api/lib/per-user-agent.js`.
Startup gate: `startPerUserAgent()` line 770; gate env: `PER_USER_AGENTS_ENABLED=true` or `deps.force`.

```mermaid
sequenceDiagram
    autonumber
    participant MA as management-api
    participant PUA as PerUserAgent<br/>per-user-agent.js
    participant RB as resolveBinding()<br/>line 96
    participant B as NostrBridge
    participant Pod as Solid Pod<br/>solid-pod-rs
    participant Mem as management-api<br/>POST /v1/memory/search<br/>or GET /v1/memory
    participant LLM as callLlm()<br/>from junkiejarvis-agent.js

    MA->>RB: resolveBinding(bindings, message)<br/>Fields: channel, peer, accountId<br/>Most-specific match wins,<br/>default = main (line 96-116)

    RB-->>MA: agentId

    MA->>PUA: startPerUserAgent({userPubkey, agentPrivHex, podBase, bridge...})<br/>gate: PER_USER_AGENTS_ENABLED=true

    PUA->>B: bridge.setAuthSigner(agentSigner)<br/>BEFORE subscribe — NIP-42 lesson (line 800)

    PUA->>B: subscribe({kinds:[1059], '#p':[agentPubkey]})<br/>gift-wrapped DMs (line 424)

    opt watchChannels == true
        PUA->>B: subscribe({kinds:[42], '#p':[agentPubkey]})<br/>(line 429)
    end

    loop DM received

        B-->>PUA: kind-1059 event

        PUA->>PUA: _dedup(wrap.id)<br/>capped 2000 (line 390)

        PUA->>PUA: nip59.unwrapEvent(wrap, signer.skBytes)<br/>(line 521)<br/>Skip if asker == agentPubkey<br/>Skip if ageS > 600 (stale replay guard, line 538)

        note over PUA: _think(userText)

        PUA->>PUA: _identity() [cached, TTL 5 min]<br/>(line 453-471)

        PUA->>Pod: NIP-98 authed GET<br/>{podBase}/pods/{userPubkey}/private/agent/SOUL.md<br/>then /public/agent/SOUL.md<br/>then /private/agent/USER.md<br/>then /public/agent/USER.md<br/>nip98Token(signer, url, "GET") builds<br/>kind-27235 event (line 134-165)

        Pod-->>PUA: identity text or 404

        note over PUA: source: "private" | "public" | "default"<br/>Only cache if source != "default" (line 467)

        PUA->>Mem: POST /v1/memory/search<br/>{query, namespace:"user:<pubkey>:agent", limit:5}<br/>token: MANAGEMENT_API_KEY<br/>(line 254)

        Mem-->>PUA: {results:[{key,value}]}

        alt results empty
            PUA->>Mem: GET /v1/memory?namespace=user:<pubkey>:agent<br/>(line 275)<br/>then GET /v1/memory/<key>?namespace=… per key<br/>(line 287-292)
            Mem-->>PUA: items
        end

        PUA->>PUA: buildSystemPrompt({identity, memories, userPubkey})<br/>(line 313-339)

        PUA->>LLM: callLlm(userText, {system})<br/>(same provider cascade as JJ)

        LLM-->>PUA: replyText

        PUA->>PUA: nip59.wrapEvent(rumor14, signer.skBytes, askerPubkey)<br/>(line 561)

        PUA->>B: bridge.publish(wrapped, {sign:e=>e})
    end

    note over PUA: Heartbeat autonomy path

    loop heartbeat() called externally

        PUA->>Pod: NIP-98 authed GET<br/>{podBase}/pods/{userPubkey}/inbox/<br/>accept: application/ld+json<br/>(line 652)

        Pod-->>PUA: LDP container listing<br/>(array | {contains} | {items} | {ldp:contains})<br/>_parseInboxListing() (line 711)

        loop each new inbox item (dedup by URL, cap 2000)

            PUA->>LLM: callLlm(HEARTBEAT_PROMPT + itemText, {system})<br/>(line 691)

            LLM-->>PUA: text

            alt text == "HEARTBEAT_OK"
                PUA->>PUA: suppress (no action)
            else
                PUA->>PUA: nip59.wrapEvent(rumor14, signer.skBytes, userPubkey)
                PUA->>B: bridge.publish(summary DM to owner)
            end
        end
    end
```

---

## 4. URN Minting through uris.js and BC20 Federation Bridge

Source: `management-api/lib/uris.js` (mint, resolveCanonical, parse) and
`management-api/lib/bc20-provenance-bridge.js` (toVisionclaw, toAgentbox, crossOutbound).

```mermaid
flowchart TD
    subgraph Caller["Caller (any agentbox surface)"]
        C1["mint({ kind, pubkey, payload, localId })"]
    end

    subgraph URIs["management-api/lib/uris.js"]
        U1{"kind in KINDS?"}
        U2{"contentAddressed?"}
        U3["_contentAddress(payload)\nsha256-12-<first 12 hex chars>"]
        U4["_slug(localId)"]
        U5{"ownerScope?"}
        U6{"scopeRequired?"}
        U7["_normalisePubkey()\naccepts: 64-hex | did:nostr:hex | npub1 bech32"]
        U8["urn:agentbox:<kind>:<pubkey>:<local>"]
        U9["urn:agentbox:<kind>:<local>\n(unscoped form)"]
        U10["throw UnknownUriKind"]
        U11["throw MalformedUri"]
    end

    subgraph Resolve["resolveCanonical()"]
        R1{"did:nostr:?"}
        R2["{podBase}/.well-known/did.json"]
        R3["{managementApiBase}/v1/uri/<urn>?surface=<resolvableSurface>"]
    end

    subgraph BC20["management-api/lib/bc20-provenance-bridge.js\n(B05: only cross-namespace importer)"]
        B1["toVisionclaw(agentboxUrn)"]
        B2["uris.parse(agentboxUrn)\n(B02 — never ad-hoc)"]
        B3{"parsed.kind"}
        B4["activity → execution\nurn:visionclaw:execution:sha256-12-<sha12(urn)>\n(unscoped, owner in owner_did)"]
        B5["agent → did:nostr:<pubkey>\n(identity preserved structurally)"]
        B6["thing → kg\nurn:visionclaw:kg:<pubkey>:sha256-12-<sha12(urn)>"]
        B7["memory → concept\nurn:visionclaw:concept:<domain>:<slug>\n(requires opts.domain + opts.slug)"]
        B8["bead → bead\nurn:visionclaw:bead:<pubkey>:<sha256-12>\n(structural pass-through — local unchanged)"]
        B9["drop + log (B04)\n_countDrop(kind, reasonClass)"]
        B10["UrnMapping store\n{ agentbox_urn, visionclaw_urn, owner_did }"]
        B11["_bcCrossings counter\n(prom-client, soft-required)"]
        BC_BACK["toAgentbox(visionclawId)\nbead: structural reverse\ndid:nostr: pubkey reverse\nothers: store.getByVisionclaw()"]
    end

    subgraph VC["Host-project namespace\n(federation boundary)"]
        V1["urn:visionclaw:execution:<sha256-12>"]
        V2["did:nostr:<pubkey>"]
        V3["urn:visionclaw:kg:<pubkey>:<sha256-12>"]
        V4["urn:visionclaw:concept:<domain>:<slug>"]
        V5["urn:visionclaw:bead:<pubkey>:<sha256-12>"]
    end

    C1 --> U1
    U1 -->|no| U10
    U1 -->|yes| U2
    U2 -->|yes| U3
    U2 -->|no + localId| U4
    U2 -->|no, no localId| U11
    U3 --> U5
    U4 --> U5
    U5 -->|yes| U6
    U5 -->|no| U9
    U6 -->|scopeRequired + no pubkey| U11
    U6 -->|scopeRequired=false, no pubkey| U9
    U6 -->|pubkey supplied| U7
    U7 -->|valid| U8
    U7 -->|invalid| U11

    U8 --> Resolve
    U9 --> Resolve
    R1 -->|yes| R2
    R1 -->|no| R3

    U8 -->|"crossOutbound()"| B1
    B1 --> B2
    B2 --> B3
    B3 -->|activity| B4
    B3 -->|agent| B5
    B3 -->|thing| B6
    B3 -->|memory| B7
    B3 -->|bead| B8
    B3 -->|unmapped| B9
    B4 --> B10
    B5 --> B10
    B6 --> B10
    B7 --> B10
    B8 --> B10
    B10 --> B11

    B4 --> V1
    B5 --> V2
    B6 --> V3
    B7 --> V4
    B8 --> V5

    V1 --> BC_BACK
    V2 --> BC_BACK
    V3 --> BC_BACK
    V4 --> BC_BACK
    V5 --> BC_BACK
```

### Kind map (bc20-provenance-bridge.js lines 92-103)

| agentbox kind | Host-project kind | Local computation |
|---|---|---|
| `activity` | `execution` | `sha256-12(agentboxUrn)` — content-addressed, unscoped |
| `agent` | `did:nostr:<pubkey>` | structural (pubkey pass-through) |
| `thing` | `kg` | `sha256-12(agentboxUrn)`, scoped by pubkey |
| `memory` | `concept` | `<domain>:<slug>` (requires caller opts) |
| `bead` | `bead` | structural pass-through (local unchanged, both grammars `<pubkey>:<sha256-12>`) |
| all other kinds | dropped | `_countDrop(kind, "unmapped-kind")` |

Store: `BC20_URN_MAPPING_PATH` (default `/var/lib/agentbox/code-harness/bc20-urn-mappings.jsonl`).
Metrics: `agentbox_bc20_drops_total{kind, reason_class}` and `agentbox_bc20_crossings_total{kind, direction}`.

---

## 5. Audit Findings

Findings are numbered and classified. Severity: HIGH / MEDIUM / LOW.
Classification: DUPLICATION / ENV-GAP / STALE-REF / STRUCTURAL.

---

### F-01 — Duplicate NIP-59 gift-wrap signing across four JS surfaces

**Severity: MEDIUM. Classification: DUPLICATION.**

`nip59.wrapEvent` / `nip59.unwrapEvent` (via `nostr-tools`) is implemented
independently in four distinct JS surfaces:

| Surface | File | Lines |
|---|---|---|
| Session mirror (outbound only) | `config/hooks/nostr-live-mirror.cjs` | 303-317 |
| JunkieJarvis (unwrap + wrap) | `management-api/lib/junkiejarvis-agent.js` | 535, 563 |
| PUAF (unwrap + wrap) | `management-api/lib/per-user-agent.js` | 521, 561 |
| NostrBridge client library | `mcp/servers/nostr-bridge.js` | ~681 (finalizeEvent) |

Each surface separately calls `require('nostr-tools')` (or a lazy getter),
resolves the module path individually, and implements its own fallback search
order. The mirror hook searches `management-api/node_modules` then
`mcp/node_modules` (lines 93-117); the management-api modules call
`require('nostr-tools')` directly (they inherit the management-api module
resolution); the mcp bridge has its own getter. A version drift between
`management-api/package.json` and `mcp/package.json` would produce silently
different NIP-59 behaviour at each surface.

Rust (`services/nostr-pod-bridge/src/lib.rs`) is a fifth surface but it uses
`nostr_bbs_core` from the `nostr-rust-forum` crate — a deliberate, versioned
dependency, not a duplicate.

**Recommendation**: Extract a shared `agentbox-nostr-crypto` internal module
(or promote `nostr-bridge.js` to a proper import) so all four JS surfaces share
one `nostr-tools` resolution path and one version.

---

### F-02 — Duplicate NIP-98 HTTP-auth token builder (nip98Token)

**Severity: MEDIUM. Classification: DUPLICATION.**

NIP-98 kind-27235 HTTP-auth token construction appears in two independent
implementations:

| Surface | File | Lines |
|---|---|---|
| PUAF pod fetch | `management-api/lib/per-user-agent.js` | 134-165 (`nip98Token()`) |
| NostrBridge client library | `mcp/servers/nostr-bridge.js` | 417-448 (`buildNip98Header()`) |

Both build identical tag arrays `[["u", urlWithoutQuery], ["method", METHOD]]`
plus an optional `["payload", sha256hex(body)]` tag. The two functions differ
only in whether the signer is synchronous (`per-user-agent.js` uses
`await signer.sign(unsigned)`) or a bridge-provided Promise. A correctness
difference in the query-string stripping (e.g. future URL normalisation) would
need fixing in both.

---

### F-03 — NIP-42 AUTH signer pattern duplicated in JunkieJarvis and PUAF

**Severity: LOW. Classification: DUPLICATION.**

Both `startJunkieJarvis()` (line 715) and `startPerUserAgent()` (line 800)
independently apply the same NIP-42 lesson: `bridge.setAuthSigner(signer)`
must be called BEFORE the first `bridge.subscribe()` call so the bridge can
answer relay AUTH challenges. The lesson itself is commented in both files.
If a third agent surface is added, this ordering constraint is easily missed.

**Recommendation**: Codify the pattern in `NostrBridge.attachAgent(signer, subscriptions)` so the ordering is enforced by the API.

---

### F-04 — Env vars consumed by JS/Rust but absent from entrypoint and compose templates

**Severity: MEDIUM. Classification: ENV-GAP.**

The following env vars are read in code but have no `export` or default in
`config/entrypoint-unified.sh` and are not mentioned in the env file templates
visible in-repo:

| Env var | Read at | Notes |
|---|---|---|
| `JUNKIEJARVIS_ENABLED` | `junkiejarvis-agent.js:687` | Gate for the whole JJ agent; silently off if unset |
| `JUNKIEJARVIS_PRIVKEY_HEX` | `junkiejarvis-agent.js:57` | Required when JJ enabled |
| `CONCIERGE_PRIVKEY_HEX` | `junkiejarvis-agent.js:57` | Legacy alias — undocumented |
| `JUNKIEJARVIS_MODEL` | `junkiejarvis-agent.js:294` | LLM model override |
| `JUNKIEJARVIS_LLM_BASE` | `junkiejarvis-agent.js:330` | OpenAI-compat base URL |
| `JUNKIEJARVIS_LLM_KEY` | `junkiejarvis-agent.js:328` | OpenAI-compat key |
| `JUNKIEJARVIS_MAX_REPLY` | `junkiejarvis-agent.js:445` | Reply char cap |
| `JUNKIEJARVIS_IGNORE_PUBKEYS` | `junkiejarvis-agent.js:449` | Block-list |
| `CONCIERGE_IGNORE_PUBKEYS` | `junkiejarvis-agent.js:449` | Legacy alias |
| `PER_USER_AGENTS_ENABLED` | `per-user-agent.js:774` | Gate for PUAF |
| `AGENTBOX_LIVE_MIRROR` | `nostr-live-mirror.cjs:280` | Off-switch; default ON when pubkey present |
| `AGENTBOX_MIRROR_CHILD` | `nostr-live-mirror.cjs:131` | Child-key derivation switch |
| `AGENTBOX_MIRROR_KEY_TAG` | `nostr-live-mirror.cjs:134` | HMAC domain separator |
| `AGENTBOX_MIRROR_RECIPIENT_PUBKEY` | `nostr-live-mirror.cjs:71` | Explicit recipient override |
| `BC20_URN_MAPPING_PATH` | `bc20-provenance-bridge.js:358` | Durable store path |
| `AGENTBOX_ADMIN_PUBKEY` | `nostr-pod-bridge/src/main.rs:100` | Required by bridge daemon |
| `AGENTBOX_ALLOWED_PUBKEYS` | `nostr-pod-bridge/src/main.rs:89` | Allowlist for bridge |
| `AGENTBOX_RELAY_BIND` | `nostr-pod-bridge/src/main.rs:97` | Bridge bind addr (default 127.0.0.1:7777) |

`MANAGEMENT_API_URL` and `MANAGEMENT_API_KEY` are auto-generated or read by
the entrypoint but their propagation to the PUAF `recallMemory()` call
(per-user-agent.js:250-252) relies on process environment inheritance from
supervisord — which works at runtime but is not documented in any template.

---

### F-05 — Env var `AGENTBOX_PUBKEY` used by mirror hook but not set by sovereign-bootstrap

**Severity: MEDIUM. Classification: ENV-GAP.**

`nostr-live-mirror.cjs:72` reads `AGENTBOX_PUBKEY` as a recipient pubkey
fallback. `scripts/sovereign-bootstrap.py` (lines 262-279) writes
`AGENTBOX_PUBKEY_HEX` and `AGENTBOX_X_ONLY_PUBKEY_HEX` to
`/run/agentbox/identity.env`, but not `AGENTBOX_PUBKEY`. The mirror hook's
priority chain is:

1. `AGENTBOX_MIRROR_RECIPIENT_PUBKEY`
2. `AGENTBOX_PUBKEY`
3. `AGENTBOX_BRIDGE_RECIPIENT_PUBKEY`
4. `AGENTBOX_ADMIN_PUBKEY`

`AGENTBOX_BRIDGE_RECIPIENT_PUBKEY` is exported by the bootstrap script (line
277) and sourced in the entrypoint (line 359), so the mirror falls through to
slot 3 and works. However slot 2 (`AGENTBOX_PUBKEY`) is an undocumented alias
that will never match the bootstrap output, potentially confusing operators
who set it expecting it to activate the mirror.

---

### F-06 — `NOSTR_MIRROR_RELAY` override accepted but not validated for WSS scheme

**Severity: LOW. Classification: STRUCTURAL.**

`nostr-live-mirror.cjs:87` accepts `NOSTR_MIRROR_RELAY` if it matches
`/^wss?:\/\//i`. A plain `ws://` URL (unencrypted) is accepted here for
testing convenience but there is no warning emitted when a production operator
sets it to a `ws://` URL. The comment at line 24 states the relay is
exclusively the cloud relay; a plain-WS override leaks plaintext NIP-59
rumor content to any network observer.

---

### F-07 — Remaining Telegram/CTM references (comment-only, no live code)

**Severity: LOW. Classification: STALE-REF.**

The following files contain textual references to the retired Telegram/CTM
mirror. All are in comments, docstrings, or commit-history prose — no code
path re-enables the Telegram path:

| File | Line | Content |
|---|---|---|
| `config/entrypoint-unified.sh` | 582 | `# Replaces the retired Telegram/CTM mirror.` |
| `config/hooks/nostr-session-summary.py` | 5 | `retired Telegram/CTM mirror` |
| `services/nostr-pod-bridge/src/lib.rs` | 326 | `/// Layout mirrors the retired Telegram digest:` |
| `scripts/agentbox-config-validate.js` | 373-374 | E014 tombstone comment |
| `scripts/provision-agent-stacks.py` | 39 | Docstring reference |

No `CTM_BOT_TOKEN`, `CTM_TELEGRAM_CHAT_ID`, or `ctm` binary references remain
in executable paths. The tombstone in `agentbox-config-validate.js` lines
373-374 is the authoritative retirement notice; the others are informational.

**Recommendation**: No code change required. References may be pruned in a
future housekeeping pass for doc clarity.

---

### F-08 — `MANAGEMENT_API_URL` defaults and fallback chain undocumented for PUAF

**Severity: LOW. Classification: ENV-GAP.**

`per-user-agent.js:250` uses `process.env.MANAGEMENT_API_URL || 'http://127.0.0.1:9090'`
as the base URL for memory recall. The entrypoint sets `MANAGEMENT_API_PORT`
(default 9090, line 77) but does not construct or export `MANAGEMENT_API_URL`.
The PUAF therefore always uses the hardcoded localhost default unless the
operator explicitly sets `MANAGEMENT_API_URL`. This is correct in practice
(same process, same host) but the implicit coupling is not documented.

---

### F-09 — BC20 bridge Prometheus counters soft-require prom-client; silently no-op in tests

**Severity: LOW. Classification: STRUCTURAL.**

`bc20-provenance-bridge.js` lines 52-71 soft-require `prom-client` in an IIFE.
If the module is absent, `_bcDrops` and `_bcCrossings` remain `null` and
`_countDrop`/`_countCrossing` silently skip. The drop log to stderr (line 117)
still fires, but the Prometheus counters — the agent-readable signal surface —
are silently absent. In a deployment without prom-client (e.g. a minimal test
container) all BC20 drops are invisible to monitoring dashboards.

---

*End of audit. Diagrams are authoritative against source as of 2026-06-11.*
