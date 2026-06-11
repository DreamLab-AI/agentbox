---
id: ADR-029
title: Session-mirror live egress (per-turn NIP-59 self-DM)
status: accepted
date: 2026-06-11
type: privacy
author: Dr John O'Hare
depends_on: [ADR-008, ADR-009, ADR-027]
related: [ADR-030, PRD-004]
review_trigger: the mirror relay changes; the child-key derivation tag or off-switch semantics change; the recipient-pubkey gating env vars change; or the live-mirror hook gains a new event registration
"@context": https://schema.org
"@type": TechArticle
---

# ADR-029 — Session-mirror live egress (per-turn NIP-59 self-DM)

**Related:** ADR-008 (Privacy filter routing), ADR-009 (Embedded Nostr relay), ADR-027 (Default-secure posture), ADR-030 (Sovereign-mesh manifest boundary), upstream ADR-094 (phone delegation) / ADR-095 (kind-30840 digest sibling), PRD-004 (External agent messaging)

## TL;DR for newcomers
*Skip if you already know why your phone shows the running session and the box never ships a root key.*

`config/hooks/nostr-live-mirror.cjs` mirrors a running Claude Code session to the operator's phone **turn by turn**, as NIP-59 gift-wrapped self-DMs readable in Amethyst (or any Nostr client). It is the **live** sibling of the SessionEnd **digest** mirror (the kind-30840 summary documented in upstream ADR-095 / gated by `[sovereign_mesh.mobile_bridge]`): same destination phone, different data shape and a different decision. The digest is one curated summary distilled by an external LLM at session end; the live mirror is the raw per-turn stream, sealed end-to-end with **no external LLM hop**. The egress signs under a **derived child key** so the operator's root key never reaches the device, and the hook is **fail-open** — any error exits 0 and never blocks Claude.

**If you remember only one thing:** the live mirror is a per-turn, end-to-end-sealed self-DM under a *derived* child identity; it is distinct from the curated digest egress; it leaks nothing unless an operator recipient pubkey is configured; and it can never block the session.

For the deep version, keep reading.

## Context

Telegram/CTM mirroring is retired. Two complementary phone-egress paths replaced it, and only one had a decision record:

1. **Digest (recorded).** On `SessionEnd`, a hook distils the transcript into a curated digest (summary + actions + actionable questions, not the full transcript) via the paid Z.AI/GLM consultant (ADR-011), then signs a **kind-30840** addressable session-summary and dual-writes it to the relay + pod. This is upstream **ADR-095**, gated by `[sovereign_mesh.mobile_bridge]`, and its one external hop (the LLM summarisation) is documented there. Upstream **ADR-094** covers the phone's NIP-26 delegation.

2. **Live (this ADR — previously undocumented).** A per-turn stream that mirrors the running task chat as it happens. It was implemented and documented in `CLAUDE.md` plus `docs/user`/`docs/developer`, but had **no ADR** — the only DreamLab egress path without a decision record. This ADR closes that gap. It is a distinct decision from the digest: different trigger cadence (per turn vs once at end), different data shape (raw turn text vs curated digest), and a different privacy posture (no external LLM hop vs one external summarisation hop).

The framing tension that drives the decision: a phone-readable live stream is the most useful observability surface for a long-horizon autonomous session, but it is also the path most likely to (a) put a private key on a phone or (b) block the session if the egress hangs. Both must be impossible by construction.

## Decision

### D1: Per-turn NIP-59 gift-wrapped self-DM to the operator

The hook registers on four Claude Code lifecycle events and emits one gift-wrapped DM per turn:

| Event | Mirrored payload |
|---|---|
| `SessionStart` | `▶ session started` lifecycle line |
| `UserPromptSubmit` | the operator's prompt text |
| `Stop` | the last assistant message text from the transcript |
| `SessionEnd` | `■ session ended (<reason>)` lifecycle line |

Each message is a **kind-1059 NIP-59 gift wrap** sealing a **kind-14 NIP-17/NIP-59 DM rumor**. The gift wrap stamps an **ephemeral author** (`nip59.wrapEvent`), so the mirror needs no standing key on the relay. Bodies are capped (`MAX_BODY_CHARS`) — this is a phone notification, not a log dump.

*Rationale:* NIP-59 gives end-to-end sealing with sender unlinkability; only the recipient decrypts. A per-turn cadence is what makes the stream useful as live observability rather than a post-hoc record (which the digest already provides).

### D2: Signed under a derived child key, not the operator root key

The mirror signs and self-DMs under a **derived child identity**, keeping the operator's root secret key **off the phone**:

```
child_sk = HMAC-SHA256(operator_sk, AGENTBOX_MIRROR_KEY_TAG | "agentbox-mirror-v1")
```

The child is re-derivable, deterministic, and scoped to mirroring. The device imports only the child nsec; it signs nothing of consequence with it; the mirror is a **self-DM on the child identity** (recipient = child pubkey). Rotation is a one-line operation — bump `AGENTBOX_MIRROR_KEY_TAG` and the whole child identity rolls. The off-switch `AGENTBOX_MIRROR_CHILD=0` disables derivation and falls back to a self-DM under the operator's own pubkey (the legacy path); when child mode is on, the root key never leaves the box.

*Rationale:* the operator's root key is the identity for the entire sovereign mesh (pod ACLs, NIP-98 auth, NIP-26 delegations). Putting it on a phone to read a chat would couple a high-value secret to a mobile device. An HMAC-derived child gives a throwaway, rotatable identity whose only capability is reading the mirror thread. This is the same "root never leaves the box" principle as the bridge key in tmpfs (ADR-027 D4), applied to the egress identity.

### D3: No external LLM hop; cloud relay only

Unlike the digest path, the live mirror has **no external LLM summarisation hop** — the raw turn text is end-to-end-sealed (NIP-59) straight to the recipient pubkey. The only network egress is the encrypted gift wrap to the **cloud relay**, which is hardcoded as the default (`wss://dreamlab-nostr-relay.solitary-paper-764d.workers.dev`) with a single env override (`NOSTR_MIRROR_RELAY`) for testing. The mirror does **not** read the `NOSTR_RELAYS` fan-out list and never touches `relay.damus.io` / `relay.primal.net`. The relay admits a kind-1059 gift wrap iff its first `["p"]` recipient is whitelisted; the operator pubkey is whitelisted in every cohort.

*Rationale:* the digest deliberately accepts one external LLM hop to produce a curated summary (ADR-095, and recorded again in ADR-030 as the mesh's single external data hop). The live stream deliberately accepts none — the content is sealed in the box and only the recipient ever sees plaintext. Restricting transport to the single cloud relay is an operator constraint: no inadvertent fan-out of session content to public relays.

### D4: Gated, fail-open, never blocking

The hook is a **silent no-op (exit 0)** unless an operator recipient pubkey is present in one of `AGENTBOX_PUBKEY` / `AGENTBOX_BRIDGE_RECIPIENT_PUBKEY` / `AGENTBOX_ADMIN_PUBKEY` / `AGENTBOX_MIRROR_RECIPIENT_PUBKEY` (or a derivable child key exists). It is toggled off explicitly with `AGENTBOX_LIVE_MIRROR=0`. The Claude Code hook contract is honoured strictly: read hook JSON on STDIN, **exit 0 fast**, never block. A hard wall-clock deadline (`DEADLINE_MS`, well under the Claude hook timeout) aborts the publish, and **every error is swallowed** — fail-open everywhere.

*Rationale:* an egress hook that can throw or hang is a denial-of-service on the agent itself. The mirror is observability, not control; it must degrade to "no mirror this turn" rather than "session stalls". Gating on a configured recipient means a default agentbox with no operator pubkey mirrors nothing — privacy-by-default, consistent with ADR-027's posture.

### D5: Privacy boundary vs the ADR-008 privacy filter

The privacy filter (ADR-008) is **adapter middleware** — it redacts PII on the durable-state adapter dispatch path (beads, pods, memory, events, orchestrator) before the JSON-LD encoder runs (DDD-004 §L08). The live mirror is **not** an adapter dispatch: it is an operator-only egress of the operator's *own* session to the operator's *own* phone, sealed end-to-end under a key only the operator holds. It therefore sits **outside** the adapter middleware chain by design — there is no third party and no federation boundary to redact at; the recipient is the operator.

The boundary statement: the privacy filter governs what leaves the box *to others*; the live mirror governs what the operator sees of *their own* session. The mirror still respects the mesh's transport constraint (single cloud relay, D3) and the identity constraint (derived child key, D2). If a future change routes the mirror to a non-operator recipient, that change crosses a federation boundary and **must** be re-evaluated against ADR-008 — at which point the mirror would become an adapter-class egress and inherit the privacy-filter middleware.

## Consequences

### Positive
- A long-horizon autonomous session is observable turn-by-turn on a phone with no app, no Telegram, and no standing relay key.
- The operator's root key never reaches the device; the mirror identity is throwaway and rotatable by one env var.
- No external LLM ever sees live session content; content is sealed in the box.
- The hook cannot block or crash the agent; worst case is a silently dropped mirror line.

### Negative
- The live stream is per-turn and unredacted to the operator — anyone who imports the child nsec onto a device sees raw turn text. The child key is therefore a real (if low-value) secret and is documented as import-then-delete (mode 600, re-derivable).
- Two phone-egress paths (live + digest) must be kept conceptually distinct; conflating them risks applying the digest's external-hop reasoning to the live path (which has none) or vice-versa.

### Risks
- If `AGENTBOX_MIRROR_KEY_TAG` is rotated without the device re-importing the new child nsec, the operator silently stops seeing the mirror (fail-open: no error, no stream). Documented as the rotation procedure, not a bug.
- The hardcoded cloud relay is a single point of egress; if it is unreachable the mirror fails open (no stream) — acceptable for observability, but it is not a durable record (the digest path is).

## Relationship to the digest egress (explicit)

| Axis | Live mirror (this ADR, ADR-029) | Digest mirror (upstream ADR-095) |
|---|---|---|
| Trigger | per turn (`SessionStart`/`UserPromptSubmit`/`Stop`/`SessionEnd`) | once, at `SessionEnd` |
| Data shape | raw turn text + lifecycle lines | curated digest (summary + actions + questions) |
| External hop | none (E2E sealed) | one (Z.AI/GLM summarisation) |
| Event kind | kind-1059 gift wrap (kind-14 rumor) | kind-30840 addressable session-summary |
| Durability | ephemeral relay note | dual-written to relay + pod (durable record) |
| Identity | derived child key (root stays off phone) | bridge key (ADR-027 D4) + NIP-26 phone delegation (ADR-094) |
| Manifest gate | recipient-pubkey env gating (D4) | `[sovereign_mesh.mobile_bridge]` (ADR-030) |

Both are facets of the `[sovereign_mesh]` subsystem; the manifest boundary, gate semantics, and the mesh's single external data hop are recorded in **ADR-030**.
