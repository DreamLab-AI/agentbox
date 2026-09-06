# P0-COM-14 — did:nostr minted at spawn (source side)

**Item:** COM-14 (PRD-019, ADR-037 D6, DDD-017 §8 `IdentityMinter`)
**Wave:** P0
**Target tier:** `integrated` (agentbox source side); `federation-verified` end-to-end is VisionClaw-led
**Canary:** `CANARY-AB-DID`
**Captured against SHA:** `4c5418b5399f9dc5285677b1d4916e7edff8c333` (branch `gap-close/2026-07`)
**Timestamp (UTC):** 2026-07-08T10:24:44Z

## Falsification statement (from PRD-019)

> COM-14 is falsified if any spawned agent still exports `did:nostr:local`, if the key is
> regenerated on every restart of the same profile, or if the spawn payload does not carry a
> Multikey-canonical did:nostr for a downstream to verify.

## What changed

| File | Change |
|---|---|
| `management-api/lib/agent-identity.js` | **New.** Mint/load a per-agent BIP-340 secp256k1 keypair; derive path mirrors `junkiejarvis-agent.js` `signerFromHex` (`getPublicKey(skBytes)`); fresh keys via nostr-tools `generateSecretKey()`. Persists the 64-hex private key per profile (0600); prints only the public `did:nostr:<hex>`, x-only pubkey, and ADR-033 Multikey (`fe70102<hex>`). Fail-open (returns null → caller keeps the placeholder). Private key never printed/logged/returned in a payload. |
| `config/entrypoint-unified.sh` (~line 515) | Spawn-time identity step: unless an operator set a non-placeholder `AGENTBOX_AGENT_DID`, mint/load via the helper and `eval` only output matching `^export AGENTBOX_AGENT_DID=did:nostr:[0-9a-f]{64}$`. The historic `${VAR:-did:nostr:local}` fallback is preserved for containers without node/nostr-tools. |
| `management-api/adapters/orchestrator/local-process-manager.js` | Spawn response additively carries `did_nostr` (the container agent's public DID a child inherits). |
| `management-api/adapters/orchestrator/stdio-bridge.js` | The `agent.spawn` JSON-RPC frame (`params`) and the return value the external VisionClaw BrokerActor consumes additively carry `did_nostr`. Public DID only, never the private key. |

The four consumers that read `AGENTBOX_AGENT_DID` at import (`mcp/aci-shell/server.js:44`,
`management-api/server.js:787`, `management-api/routes/memory.js:136`,
`management-api/routes/linked-objects.js:88`) now receive a real minted DID instead of the
placeholder.

## Receipts

### 1. Syntax checks (`node -c` / `bash -n`)

```
$ node -c management-api/lib/agent-identity.js && echo OK
OK: management-api/lib/agent-identity.js
$ node -c management-api/adapters/orchestrator/local-process-manager.js
OK
$ node -c management-api/adapters/orchestrator/stdio-bridge.js
OK
$ bash -n config/entrypoint-unified.sh
OK: entrypoint-unified.sh
```

### 2. Real did:nostr minted at spawn, stable across restart, per-profile distinct, 0600 perms

Run against a safe temp profile dir (`AGENTBOX_AGENT_IDENTITY_DIR` override), `AGENTBOX_AGENT_DID`
and `AGENTBOX_AGENT_PRIVKEY_HEX` unset:

```
=== FIRST spawn: mint a fresh per-agent did:nostr ===
export AGENTBOX_AGENT_DID=did:nostr:3689ab1012f239ef29085a18397d6677327c289b4da2b8dc4e796d64e5b7c743
export AGENTBOX_AGENT_PUBKEY=3689ab1012f239ef29085a18397d6677327c289b4da2b8dc4e796d64e5b7c743
export AGENTBOX_AGENT_DID_MULTIKEY=fe701023689ab1012f239ef29085a18397d6677327c289b4da2b8dc4e796d64e5b7c743
agent-identity: minted did:nostr:3689ab...c743 (persisted=true, keyfile=.../agent-did-canary-test.key)

=== key file perms ===
-rw------- 1 devuser devuser 65 ... agent-did-canary-test.key
600 .../agent-did-canary-test.key
key file matches ^[0-9a-f]{64}$ : YES

=== SECOND spawn (same profile) — DID must be STABLE (loaded, not re-minted) ===
agent-identity: loaded did:nostr:3689ab...c743 (persisted=true, ...)   # SAME DID

=== DIFFERENT profile — must derive a DISTINCT DID ===
export AGENTBOX_AGENT_DID=did:nostr:6637f77e6e32061536ab0ee8e1d61c310c3c31f5f1316b2ae95e6855937a6907
```

- No `did:nostr:local` on the mint path — falsification clause 1 refuted.
- Same profile → identical DID (loaded from the 0600 key file) — falsification clause 2 refuted.
- Private key present only in the 0600 key file, never in stdout.

### 3. Multikey-canonical DID (ADR-033 I2), spawn payload carries it

```
multikey: fe701023689ab1012f239ef29085a18397d6677327c289b4da2b8dc4e796d64e5b7c743
len: 71 (expect 71)
regex ^fe70102[0-9a-f]{64}$ : true
body==did-body: true
```

Spawn responses (with `AGENTBOX_AGENT_DID` set) carry `did_nostr`:

```
local-process-manager spawnAgent -> {"agentId":"urn:agentbox:agent:proc-...","status":"running","pid":776879,"did_nostr":"did:nostr:3689ab...c743"}
stdio-bridge spawnAgent return    -> {"agentId":"urn:agentbox:agent:stdio-...","status":"running","did_nostr":"did:nostr:3689ab...c743"}
stdio-bridge agent.spawn frame params -> {"command":"echo","args":["hi"],"did_nostr":"did:nostr:3689ab...c743"}
```

Falsification clause 3 refuted: the spawn payload carries a did:nostr, and the Multikey
(`fe70102...`, 71 chars, ADR-033-conformant) is exported alongside for downstream verification.

### 4. Entrypoint eval-guard rejects the placeholder, no regression on the spawn contract

```
GOOD output (real did:nostr): guard PASSES (would eval)
BAD output (did:nostr:local): guard REJECTS (keeps fallback) — correct
```

```
$ jest tests/contract/orchestrator.contract.spec.js
Test Suites: 1 passed, 1 total
Tests:       6 todo, 30 passed, 36 total
```

The additive `did_nostr` field is non-breaking: the `toMatchObject(spec)` frame assertion and all
return-shape assertions still pass across local-process-manager, stdio-bridge and off adapters.

## Maturity & canary honesty

- **Tier claimed:** `integrated` (source side). The cross-substrate proof — VisionClaw keying a node
  by the minted DID and verifying it — is `federation-verified`, VisionClaw-led, **not** claimed here.
- **`CANARY-AB-DID`:** registered as code/config that will fire in a live session when a spawned agent
  exports a real `did:nostr:<hex>`. The live VisionClaw harness (`POST /api/canary/register`, port
  4000) was not reachable from this build container, so registration is recorded as
  pending-live-session per the honesty rule. The mint path is exercised and green above.
- **In-container reality:** `nostr-tools ^2.23.3` is a management-api dependency, so the mint path is
  live in the real container; the `did:nostr:local` fallback only applies where node/nostr-tools are
  absent (fail-open).

---

> **Amendment (2026-07-22, K-2 registration sweep):** `CANARY-AB-DID` is now REGISTERED and armed on the live VisionClaw LivenessHarness (`POST /api/canary/register` → 200, `sha_at_registration: c889bdf6`, confirmed via `GET /api/canary/status`). `visionclaw-server:4000` became reachable 2026-07-22 (PRD-024 Tock 0). The **live fire** remains pending-live-session per the honesty rule — registration and observation are separate claims.
