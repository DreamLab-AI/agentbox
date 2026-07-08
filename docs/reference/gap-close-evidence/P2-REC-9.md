# P2-REC-9 — Provenance to the pocket (signed-adjacent urn through the mirror)

**Item:** REC-9 (PRD-019 §REC-9, ADR-037 §D5, DDD-017)
**Wave:** P2
**Target tier:** `integrated`
**Canary:** `CANARY-AB-PROV` (correctness wire; fires when a mirrored per-turn DM carries a resolvable `urn:agentbox:activity` reference)
**Captured against SHA:** `ceb3401b915df070f193cc0ce6f54a18f96c9547` (branch `gap-close/2026-07`; receipts run on the working tree atop this base, pinned by the closure commit)
**Timestamp (UTC):** 2026-07-08T15:26Z

## Falsification statement (from PRD-019)

> REC-9 is falsified if a mirrored turn carries no resolvable urn reference, if
> the reference does not resolve to a real execution/action receipt, or if
> adding the reference makes the mirror hook block a turn on failure.

## What changed

The per-turn live mirror now carries a signed-adjacent `urn:agentbox:activity`
reference **inside** the already gift-wrap-sealed rumor (no second signature, no
second event — ADR-037 D5), within the body cap; the SessionEnd digest bridge
mirrors the **byte-identical** reference. Provenance = the recipient resolves the
urn back to the activity record via `/v1/uri/<urn>` → `307` → `/v1/agent-events`.

| File | Change |
|---|---|
| `config/hooks/nostr-live-mirror.cjs` | `loadUris()` lazily loads the canonical minter (`lib/uris.js`, ADR-013). `mintActivityUrn(uris,payload)` mints `urn:agentbox:activity:<scope>:sha256-12-…` deterministic on `session_id` (fail-open `''`). `composeBody(text,urn)` appends the reference within `MAX_BODY_CHARS` with the **urn never truncated** — the turn text yields to the cap, not the provenance. A `AGENTBOX_MIRROR_DRY_RUN=1` affordance prints the composed sealed body with no network egress. The CLI entrypoint is now `require.main`-guarded and the pure helpers are exported for tests. Fail-open unchanged: a missing urn degrades to text-only; every error still exits 0. |
| `config/hooks/nostr-session-summary.py` | `mint_activity_urn(session_id)` mints the **same** reference (byte-identical to `lib/uris.js`: SHA-256 over the sorted, minified JSON of `{surface,session_id}`, first 12 hex), added to the kind-30840 digest as `activity_urn`. Same scope-pubkey precedence as the live mirror, so the two egress paths converge. Best-effort: `""` on any error, never blocks the summary. |
| `services/nostr-pod-bridge/src/lib.rs` | `SessionSummary.activity_urn: Option<String>` (serde default); `render_summary_content` renders a `PROVENANCE / - activity: <urn>` block when present, mirroring the project digest's `- urn:` line. Absent → no block (fail-open). |
| `tests/sovereign/nostr-live-mirror-provenance.test.js` (new) | 9 cases: `composeBody` keeps the full urn under the cap even with huge text; text-only fail-open when no urn; `mintActivityUrn` mints a canonical activity urn that resolves to the agent-events surface; deterministic (both paths converge); `''` on missing session id / unavailable minter. |

## How each falsification clause is met

1. **No resolvable reference → falsified.** Every mirrored turn appends
   `mintActivityUrn(...)`; the dry-run receipt below shows the `⛓ urn:agentbox:activity:…`
   line present in the sealed body.
2. **Does not resolve to a real receipt → falsified.** `activity` resolves
   through the standing `/v1/uri/:urn` route (`uri-resolver.js`) which 307-redirects
   to `/v1/agent-events?id=<urn>`. Unit test asserts `resolveCanonical` yields
   `surface=agent-events`.
3. **Blocks on failure → falsified.** Induced-failure receipts: an unreachable
   relay and a throwing minter both exit 0; the reference embedding is wrapped
   fail-open (missing urn → text-only). The hook is `require.main`-guarded so a
   test require never spawns the publish path.

## Receipts

### 1. Syntax + unit tests (reference within the cap, resolvable, fail-open)

```
$ node -c config/hooks/nostr-live-mirror.cjs && echo OK
OK
$ python3 -m py_compile config/hooks/nostr-session-summary.py && echo OK
OK
$ cd management-api && npx jest tests/sovereign/nostr-live-mirror-provenance.test.js
PASS ../tests/sovereign/nostr-live-mirror-provenance.test.js
  nostr-live-mirror.composeBody — REC-9 reference within the cap
    ✓ a huge turn text + urn stays within MAX_BODY_CHARS AND keeps the full urn
    ✓ a short turn text + urn carries both, reference last
    ✓ FALSIFICATION 4: no urn → text-only, original cap behaviour (fail-open)
    ✓ no urn + over-cap text → truncates to the cap, still text-only
  nostr-live-mirror.mintActivityUrn — REC-9 resolvable reference
    ✓ mints a canonical urn:agentbox:activity from the session id
    ✓ FALSIFICATION 2: the reference resolves to the agent-events (activity) surface
    ✓ deterministic: same session id + scope → same urn (both egress paths converge)
    ✓ FALSIFICATION 4: no session id → "" (fail-open, text-only)
    ✓ uris minter unavailable → "" (fail-open, never throws)
Tests:       9 passed, 9 total
```

### 2. Dry-run of the mirror hook — reference PRESENT, exit 0

```
$ PK=$(printf 'a%.0s' {1..64})
$ printf '{"session_id":"dryrun-sess-01","prompt":"verify the closure of REC-8"}' \
  | env AGENTBOX_MIRROR_RECIPIENT_PUBKEY=$PK AGENTBOX_AGENT_PUBKEY=$PK \
        AGENTBOX_MIRROR_CHILD=0 AGENTBOX_MIRROR_DRY_RUN=1 \
    node config/hooks/nostr-live-mirror.cjs UserPromptSubmit ; echo "exit=$?"
[nostr-live-mirror] DRY-RUN (UserPromptSubmit) recipient=aaaa… urn=urn:agentbox:activity:aaaa…:sha256-12-a710b48603d2 body:
🧑 [dryrun-s] verify the closure of REC-8

⛓ urn:agentbox:activity:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:sha256-12-a710b48603d2
exit=0
```

### 3. Induced failure — hook exits 0, never blocks the turn

```
$ # (a) unreachable relay, NO dry-run → real publish path fails, exit 0
$ printf '{"session_id":"failtest-01","prompt":"induce a publish failure"}' \
  | env AGENTBOX_MIRROR_RECIPIENT_PUBKEY=$PK AGENTBOX_AGENT_PUBKEY=$PK \
        AGENTBOX_MIRROR_CHILD=0 NOSTR_MIRROR_RELAY=ws://127.0.0.1:1 \
    node config/hooks/nostr-live-mirror.cjs UserPromptSubmit ; echo "exit=$?"
exit=0
$ # (b) throwing minter → degrades to "" (text-only), exit 0
mint-on-throw => "" (fail-open)
exit=0
```

### 4. Digest bridge mirrors the SAME reference (byte-identical convergence)

```
$ PK=$(printf 'b%.0s' {1..64})
$ JS=<live-mirror mintActivityUrn 'conv-session-9'>   # config/hooks/nostr-live-mirror.cjs
$ PY=<digest producer mint_activity_urn 'conv-session-9'>  # config/hooks/nostr-session-summary.py
JS: urn:agentbox:activity:bbbb…bbbb:sha256-12-f0e5dbafcc37
PY: urn:agentbox:activity:bbbb…bbbb:sha256-12-f0e5dbafcc37
CONVERGENCE: IDENTICAL ✓
```

### 5. Digest bridge (Rust) carries + renders the reference

```
$ cd services/nostr-pod-bridge && cargo test --offline --lib summary
running 5 tests
test tests::render_summary_content_includes_present_sections_only ... ok
test tests::render_summary_content_includes_provenance_when_present ... ok
test tests::session_summary_deserializes_with_activity_urn ... ok
test tests::session_summary_deserializes_with_optional_fields_defaulted ... ok
test tests::signed_summary_converts_to_relay_event_and_verifies ... ok
test result: ok. 5 passed; 0 failed; 0 ignored; 11 filtered out
```

(The crate is a standalone `[workspace]` root, so cargo does not walk up to the
sibling VisionClaw workspace — the ADR-037 Risk footgun does not apply here.)

## Maturity label

`integrated`: both egress paths (per-turn live mirror, SessionEnd digest) carry
a resolvable, byte-identical `urn:agentbox:activity` reference; the mirror stays
fail-open. `CANARY-AB-PROV` fires when a live mirrored DM carries the reference.
