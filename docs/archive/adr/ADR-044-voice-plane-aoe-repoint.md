---
id: ADR-044
title: "Voice-plane repoint: tab0-bridge injection seam onto the Agent of Empires API"
status: proposed
date: 2026-08-04
type: architecture
author: Dr John O'Hare
depends_on: [ADR-042, ADR-043, ADR-025]
related: [PRD-021, DDD-019, ADR-029, ADR-013, ADR-041, PRD-014, PRD-004]
review_trigger: >-
  AoE changes the `POST /api/sessions/{id}/send` contract or the `acp_mode_unsupported`
  semantics; AoE ships an ACP prompt channel that voice could target directly (promotes the
  roadmap item to a decision); the tab-0 coordinator session moves off terminal view; the
  NIP-98 reverse proxy in front of :9095 is replaced or its X-Forwarded-For contract changes;
  the Unmute↔bridge `/v1/chat/completions` contract or the `/v1/voice-intent` semantic seam is
  refactored; or the nostr-gateway's `/spawn`/`/instruct` fleet-control protocol changes.
"@context": https://schema.org
"@type": TechArticle
---

# ADR-044 — Voice-plane repoint: tab0-bridge injection seam onto the Agent of Empires API

**Status:** Proposed 2026-08-04
**Date:** 2026-08-04
**Repo:** DreamLab-AI/agentbox
**Related:** ADR-042 (Agent of Empires as the interaction plane — this repoints voice onto it), ADR-043 (session identity binding — the sessions voice now drives carry a `did:nostr` + URN), ADR-025 (MAD tmux architecture — superseded; window-0 hardcoding retired), PRD-021 (interaction-surface consolidation — WS5 is this ADR), DDD-019 (Interaction Plane bounded context — the InjectionPath seam), ADR-029 (session-mirror live egress — untouched), ADR-013 (canonical URI grammar), PRD-014 (voice-intent Seam B — untouched)

## TL;DR for newcomers
*Skip if you already know why the voice loop keeps working when we stop typing into `agentbox:0` and start POSTing to an AoE session id.*

The voice meta-controller (`config/tab0-bridge/server.mjs`) currently drives a running Claude Code session by literally typing into **tmux window 0** — `sendToTab0()` runs `tmux send-keys -t agentbox:0 -l <text>` then `Enter` (`server.mjs:92-99`), with the target hardcoded as `${TMUX_SESSION}:0` (`server.mjs:33-34`). Under ADR-042, sessions are no longer raw tmux windows the operator mutates by hand; they are Agent of Empires (AoE) managed sessions with opaque ids, per-agent paste-burst delay, and server-side serialisation. This ADR repoints the **one injection seam** from raw `send-keys` onto AoE's `POST /api/sessions/{id}/send` (`agentbox-of-empires/docs/api.md:113-158`), which does the identical primitive (`src/tmux/session.rs:1002-1006` `send_keys`/`send_keys_with_delay`) but honours the delay and serialises concurrent callers. Everything conversational and semantic — the Unmute↔bridge `/v1/chat/completions` LLM contract, the `/v1/voice-intent` KG seam, the NIP-59 mirror, the kind-30840/30841 digests — is **untouched**.

**If you remember only one thing:** we move the *keystroke-delivery* path (and only that path) from `tmux send-keys -t agentbox:0` to a token-authenticated `POST` against an AoE session id resolved at bridge start; the tab-0 coordinator session must run in **terminal view** because AoE's structured/ACP view has no pane to type into; and the send-keys path stays as a fail-open fallback so a down AoE never mutes the voice loop.

For the deep version, keep reading.

## Context

The agentbox voice plane is two orthogonal subsystems that share the Nostr identity (mesh-voiceTab0.md §A/§B). This ADR touches exactly one of them:

- **Plane A — the live conversational plane** (tab0-bridge + Unmute + console). It relays spoken/remote intents into a running session and reads state back. It is entirely `tmux send-keys`/`capture-pane` based today. The single write path is the **injection seam**: `POST /tab0/send` (`server.mjs:424-428`) → `sendToTab0()` (`server.mjs:92-99`), plus the meta-controller LLM's own Bash allowlist `META_ALLOWED_TOOLS` = `tmux send-keys -t agentbox:0*`, `tmux list-windows*`, `tmux capture-pane*`, `curl -s http://127.0.0.1:8971/*` (`server.mjs:218-223`). By construction window 0 is the only write target.
- **Plane B — the governed semantic plane** (`POST /v1/voice-intent`, `management-api/routes/voice-intent.js`, PRD-014 Seam B/B3). It maps an STT transcript through a deterministic verb grammar (`lib/voice-intent.js:52-95`) and dispatches a **signed kind-31402 ActionRequest** toward a scene-selected `actor_did` (`voice-intent.js:224-263`). It does not send-keys anywhere and is not a terminal path.

ADR-042 adopts AoE as the interaction plane and retires the operator-mutated window-0 model. That pulls the rug from under Plane A's single assumption — that there is a stable tmux window `agentbox:0` to type into. AoE keys everything by opaque session **id**, not "window 0", and its *default* rendering for Claude Code is the ACP structured view, which has **no tmux pane**: a `send` against it returns `400 acp_mode_unsupported` (`api.md:136-137`; `agentbox-of-empires/docs/structured-view.md:3-5`). So the repoint is not a cosmetic URL swap; it forces one architectural decision (terminal view vs ACP channel) and one identity decision (which token opens :9095).

The upside is real and measured, not speculative. AoE's `send` is a strict superset of `sendToTab0()`: it honours the per-agent paste-burst delay (Codex needs ~150 ms between text and Enter so its burst-detection window expires before Enter arrives — `api.md:118-121`, `session.rs:1006-1007`), and it **serialises concurrent POSTs to the same session id** so the two orchestrators that share this seam today — the voice path and the nostr-gateway chat path (`gateway.cjs:321-340`) — can no longer interleave keystrokes inside a pane (`api.md:152-155`). The bridge currently has neither guarantee; two intents landing together corrupt the input line.

## Decision

### D1: The injection seam repoints to `POST /api/sessions/{id}/send`

`sendToTab0()` (`server.mjs:92-99`) stops calling `tmux send-keys -t agentbox:0` and instead issues `POST /api/sessions/{TAB0_SESSION_ID}/send` with `{"message": <clean>}` against the AoE daemon (loopback `:9095`, ADR-042 D3). The literal-text semantics are preserved: AoE sends `message` literally, maps embedded newlines to shift-Enter, and submits with a final Enter (`api.md:122-124`) — the exact behaviour `sendToTab0()` reproduces by hand. The `pushTurn('voice-inject'|'nostr-inject', clean)` transcript write (`server.mjs:96`) stays: the bridge still owns its shared transcript.

*Rationale:* this is a 1:1 replacement that gains the paste-burst delay and per-session serialisation the raw path cannot offer (mesh-voiceTab0.md §"aoe_replaceability": *yes — direct 1:1*). The underlying primitive is unchanged — AoE drives the same `send-keys -l`/`-H`/paste-buffer tmux calls (`session.rs:952-1006`) — so nothing about *how* keystrokes reach the agent changes; only *who* accounts for them.

### D2: Session-id pinning via `GET /api/sessions`, replacing the `agentbox:0` constant

The bridge no longer hardcodes `${TMUX_SESSION}:0` (`server.mjs:33-34`). At bridge start (`deploy.sh` reconcile / `fleet-session-start.sh` job 3 fire-and-forget, mesh-voiceTab0.md §A) it resolves the tab-0 coordinator session id by calling `GET /api/sessions?state=live` (`api.md:23-63`) and matching the declaratively-named coordinator seed (ADR-042 `session_seeds`), then **pins that id in config** for the process lifetime. `GET /api/sessions` also supplies a real status FSM (`Running`/`Waiting`/`Idle`/`Error`/`Stopped`, PascalCase on the wire, `api.md:51-63`) that the bridge previously had to infer from pane text.

*Rationale:* AoE ids are opaque and stable; window indices are not (they drift as the operator opens/closes windows, D8 in the brief). Pinning at start with a live re-resolve on reconnect is the minimal robust binding. This closes the biggest migration gap named in mesh-voiceTab0.md §"Gaps" item 1.

### D3: Fail-open `send-keys` fallback when AoE is unreachable

If the `POST /send` fails (connection refused, `404 not_found`, `409 session_not_running`/`session_transient`), the bridge falls back to the legacy `tmux send-keys -t <coordinator-window>` path for that turn and logs the degradation — it does not drop the intent. This mirrors the existing gateway precedent exactly: `chatTab0()` already falls back to `doSend()`/`sendKeys()` "to keep the control plane useful during a bridge restart" (`gateway.cjs:335-340`).

*Rationale:* the voice loop is operator-facing observability-and-control; a daemon restart must degrade to "typed the old way, unaccounted" rather than "voice went silent". Fail-open is the house posture for every egress and control hook (ADR-029 D4; the bridge's own `|| true` hook discipline). The fallback is explicitly the *degraded* path — it races AoE's input accounting (D-ALT1) and is logged as such, never the steady state.

### D4: The tab-0 coordinator session runs in **terminal view** (ACP prompt channel deferred to roadmap)

The tab-0 coordinator — the special session the voice plane and nostr chat both drive — is created by AoE in **terminal view**, not the default Claude Code ACP structured view. This is a hard requirement, not a preference: a `send` against an ACP/structured session returns `400 acp_mode_unsupported` because it has no tmux pane to type into (`api.md:136-137`; `structured-view.md:3-5`). Teaching the voice path AoE's ACP prompt channel so it could drive a structured session directly is **explicitly roadmap, not this sprint** (mesh-voiceTab0.md §"Gaps" item 2 — "the one architectural decision the sprint must make explicitly").

*Rationale:* the whole Plane-A model is keystroke injection into a pane; a paneless session breaks it at the first `send`. Terminal view keeps the entire migration a one-line target change with zero new protocol. The ACP channel is a genuinely better long-horizon design (structured turns, no pane scraping) but it is a new integration surface with its own auth and framing — out of scope for a repoint whose whole value is "same behaviour, better accounting". The `session_seeds` entry for the coordinator therefore pins `view = terminal` (ADR-042 D3).

### D5: nostr-gateway fleet control repoints too — `/spawn` → `POST /api/sessions`, `/instruct` → `/send`

The inbound nostr-gateway (`config/nostr-gateway/gateway.cjs`, the whitelist+replay-gated C2 surface) has two dispatch paths and both move onto the AoE API:

- Its plain-chat path already rides the shared seam (`chatTab0()` → `/tab0/send`, `gateway.cjs:321-340`), so it inherits D1–D3 for free.
- Its slash-command protocol — `/spawn` → `tmux new-window` + `send-keys` (`doSpawn()`, `gateway.cjs:403-431`) and `/instruct` → direct `send-keys` to an arbitrary tab — repoints to `POST /api/sessions` (create; `api.md:64`) and `POST /api/sessions/{id}/send` respectively. `doSpawn()`'s bespoke "poll the pane until the agent boots, then send the follow-up" loop (`gateway.cjs:418-430`) is replaced by AoE session creation with `?wait=ready` and the FSM `Idle` signal (`api.md:46-63`) — the same completion signal AoE gives every dispatcher.

*Rationale:* the gateway is the same injection seam wearing a relay hat (mesh-voiceTab0.md §C). Repointing it in the same pass keeps a single write contract for the whole voice/relay plane and lets the gateway drop its hand-rolled boot-detection heuristic in favour of AoE's status FSM. The whitelist + replay gate (`executed.json`, `gateway.cjs:24,95-96`) is unchanged — it sits *in front of* dispatch and is orthogonal to where dispatch lands.

### D6: The meta-controller Bash allowlist migrates from tmux commands to curl-against-the-AoE-API

`META_ALLOWED_TOOLS` (`server.mjs:218-223`) — the allowlist the headless `claude -p` meta-controller itself uses to act — changes from `Bash(tmux send-keys -t agentbox:0*)`, `Bash(tmux list-windows*)`, `Bash(tmux capture-pane*)` to `Bash(curl … POST /api/sessions/{id}/send …)`, `Bash(curl … GET /api/sessions …)`, `Bash(curl … GET /api/sessions/{id}/output …)` (plus the existing self-loopback `curl -s http://127.0.0.1:8971/*`). The read paths `capturePane()`/`GET /tabs/:n` (`server.mjs:87-90,445-452`) become `GET /api/sessions/{id}/output?lines=&format=text` (`api.md:158-190`), and `listTabs` becomes `GET /api/sessions`.

*Rationale:* the allowlist is the meta-controller's *capability surface*; if the seam moves and the allowlist does not, the LLM either still races AoE via raw tmux (the exact anti-pattern D-ALT1 rejects) or loses its hands entirely. Migrating it to a curl allowlist against the AoE API keeps the meta-controller inside the same serialised, accounted path as the rest of the plane, and narrows its blast radius to one daemon's HTTP surface instead of arbitrary tmux.

### D7: The turn-sink hook is demoted to transcript-only; AoE's status FSM owns status

`turn-sink.cjs` → `POST /hook/turn` (`server.mjs:408-419`) feeds tab-0 Claude Code Stop/UserPromptSubmit turns into the bridge transcript, cwd-filtered to `/home/devuser/workspace/project` so the bridge's own `claude -p` sessions don't loop back (`turn-sink.cjs:44-45`). It **stays** — the bridge still owns the shared transcript the console renders (`/feed` WS + `/turns`, `server.mjs:463-470`). But it is **no longer load-bearing for status**: AoE tracks session status natively via its FSM (`api.md:51-63`) and pushes transitions through `callback_url` fire-and-forget POSTs and `[status_hooks]` env (`api.md:47-49,91-94`). The bridge's status inference from pane text is retired in favour of subscribing to AoE's transitions.

*Rationale:* the hook only ever existed because raw tmux has no turn signal (mesh-voiceTab0.md surfaces §turn-sink: *"this hook exists only because raw tmux has no turn signal"*). AoE supplies an authoritative FSM, so keeping the hook for status would mean two competing status sources. Demoting it to transcript-only keeps the console feed intact while letting the FSM be the single source of truth. AoE push notifications *complement* the `/feed` transcript; they do not replace it.

### D8: Auth wiring — the bridge presents a NIP-98 signer or the AoE token via the proxy

Today `/tab0/send` is gated by `BRIDGE_TOKEN`, which is **empty by default → open** (`server.mjs:35,388-391`), and it injects into an unauthenticated tmux window. AoE's `send` is not open: every write endpoint requires a token unless `--no-auth` (`api.md:8-21`), and ADR-042 D3/D4 puts the daemon on loopback `--auth none --behind-proxy` behind a **NIP-98-verifying reverse proxy that is the sole ingress to :9095** (ADR-043 D6). The bridge therefore reaches AoE by **one** of two routes, decided at deploy:

1. **Through the proxy (default):** the bridge holds a **NIP-98 signer** — the coordinator session's derived agent key (ADR-043 D1, `management-api/lib/agent-identity.js` `loadOrMint()`) — and signs each request; the proxy verifies (reusing `middleware/auth.js`) and forwards to loopback with `X-Forwarded-For`. This keeps the invariant that *nothing unauthenticated ever reaches :9095* and binds every injected keystroke to a signed `did:nostr`.
2. **Direct on loopback (break-glass):** the bridge holds the raw `AOE_TOKEN` and POSTs straight to `127.0.0.1:9095`. Simpler, but it bypasses the NIP-98 attribution the sprint's identity payload (ADR-043) exists to establish, so it is documented as the fallback, not the default.

*Rationale:* the repoint is the moment the voice plane crosses from "open localhost tmux" to "authenticated API", so it is where the identity fabric (ADR-043) must actually bite. Routing the bridge through the NIP-98 proxy makes voice/relay injection a first-class signed actor rather than an anonymous keystroke source; the token path exists only so a proxy outage cannot mute the operator.

### D9: What stays untouched (the non-goals, stated so nobody "helpfully" migrates them)

- **The Unmute↔bridge `/v1/chat/completions` + `/v1/models` contract** (`server.mjs:401-407,252-328`). AoE does not speak OpenAI chat-completions; this is the LLM turn Unmute consumes, backed by the headless `claude -p` meta-controller (`claudeTurn` `server.mjs:107-155`) with `ANTHROPIC_API_KEY` deleted from the child env (`server.mjs:39-42`) and the silence-marker `"..."` short-circuit (`server.mjs:262-276`). Repointing injection does not touch it.
- **The `/v1/voice-intent` semantic seam** (Plane B, PRD-014). Orthogonal — it targets the KG/VisionClaw substrate via signed kind-31402, not a terminal (mesh-voiceTab0.md §B). Its inbound relay sibling (`intent_command` for kinds 38000-38099, `agentbox.toml:139-143`) *may optionally* be pointed at the AoE API later, but that is not this ADR.
- **The NIP-59 live mirror** (`config/hooks/nostr-live-mirror.cjs`, ADR-029) and the **kind-30840/30841 digests** (`nostr-session-summary.py`, `project-tracking-publish.cjs`). Pure nostr egress of session text; independent of the interactive surface. AoE's push notifications are a *different* channel and do not replace the NIP-59 mobile path.

## Alternatives considered

### A1: Raw `send-keys` into the AoE-managed session — *rejected*
Leave `sendToTab0()` calling `tmux send-keys` and just aim it at the AoE session's window. tmux is tmux, and AoE creates ordinary tmux sessions (`session.rs:1500-1597`), so this "works" mechanically. **Rejected** because raw injection into an AoE pane bypasses AoE's input accounting, its per-agent paste-burst delay, and its **server-side serialisation** (`api.md:152-155`), and races AoE's own status watcher — exactly the fragility mesh-voiceTab0.md §"Can tab0-bridge still send-keys" flags. Two orchestrators (voice + nostr) sharing this seam would interleave keystrokes inside the pane with no serialisation guard. The whole value of the repoint is the accounting the raw path throws away.

### A2: Adopt AoE's ACP prompt channel for voice now — *deferred (roadmap)*
Drive the Claude Code coordinator in its native ACP structured view and send prompts through AoE's structured channel rather than typing into a pane. Architecturally cleaner (structured turns, no pane scraping, no `acp_mode_unsupported` constraint). **Deferred** because it is a new protocol surface with its own framing and auth, out of scope for a repoint whose entire premise is behaviour-preserving. Recorded as the follow-up in the review trigger; D4's terminal-view mandate is the interim.

### A3: Keep the `agentbox:0` window-0 hardcoding — *rejected*
Retain `TAB0 = ${TMUX_SESSION}:0` and let AoE manage everything else. **Rejected** because ADR-042 retires the operator-mutated window-0 region and the MAD layout (ADR-025); once the coordinator is an AoE-seeded session with an opaque id, "window 0" is no longer a stable handle (D8-brief). Session-id pinning (D2) is the direct replacement.

## Consequences

### Positive
- Every voice/relay keystroke is delivered through AoE's serialised, paste-burst-aware `send`, so the two orchestrators sharing the seam can no longer corrupt each other's input line.
- Injection becomes a signed `did:nostr` actor through the NIP-98 proxy (D8) instead of an anonymous open-localhost tmux write — the identity payload of the sprint (ADR-043) reaches the last uninstrumented control path.
- The bridge and gateway both shed hand-rolled pane-scraping and boot-detection heuristics in favour of AoE's authoritative status FSM (D2, D5, D7).
- The change is surgical: one seam (`sendToTab0`), one target constant (`TAB0`), one allowlist (`META_ALLOWED_TOOLS`), one gateway pair (`chatTab0`/`doSpawn`). The conversational and semantic planes are provably untouched (D9).

### Negative
- The coordinator is pinned to terminal view (D4), forgoing the richer ACP structured view until the roadmap item lands; voice cannot yet drive a structured session.
- Two status sources coexist during transition — the demoted turn-sink transcript and the AoE FSM — until the bridge fully subscribes to AoE transitions (D7). They must not be compared directly (the FSM is PascalCase on the wire, the CLI/`status_hooks` form is lowercase, `api.md:44-49`).
- The bridge now depends on a running AoE daemon for the *accounted* path; the fail-open fallback (D3) keeps it working but unaccounted, so a long AoE outage silently degrades input quality (no paste-burst delay, no serialisation).

### Risks
- **Terminal-view drift:** if the coordinator seed is ever created in ACP mode, every `send` returns `400 acp_mode_unsupported` and voice injection dies with a clear error but no fallback (the fallback in D3 covers transport failure, not a paneless target). The `session_seeds` pin and the review trigger guard this.
- **Proxy-as-sole-ingress:** D8 route 1 depends on the NIP-98 proxy being the only path to :9095 (ADR-043 D6). If the loopback `AOE_TOKEN` leaks or a second ingress opens, injection is no longer attributable. This is the same behind-proxy trust risk carried in PRD-021 §Risks.
- **Fallback races accounting:** the D3 send-keys fallback is, by construction, the A1 anti-pattern used deliberately for one degraded turn. Sustained fallback (a wedged daemon) reproduces the interleave hazard the repoint exists to remove — it must be alarmed, not silently tolerated.

## Relationship to the untouched planes (explicit)

| Path | Plane | This ADR |
|---|---|---|
| `POST /tab0/send` → `sendToTab0()` (`server.mjs:92-99,424-428`) | A — injection | **repointed** to `POST /api/sessions/{id}/send` (D1) |
| meta-controller `META_ALLOWED_TOOLS` (`server.mjs:218-223`) | A — LLM capability | **repointed** to curl-against-AoE-API (D6) |
| nostr-gateway `chatTab0`/`doSpawn`/`/instruct` (`gateway.cjs:321-340,403-431`) | C — relay control | **repointed** to `/send` + `POST /api/sessions` (D5) |
| turn-sink `POST /hook/turn` (`server.mjs:408-419`) | A/telemetry | **demoted** to transcript-only; FSM owns status (D7) |
| `/v1/chat/completions` + `/v1/models` (`server.mjs:401-407`) | A — Unmute LLM | untouched (D9) |
| `/v1/voice-intent` (`voice-intent.js:224-263`) | B — semantic | untouched (D9) |
| NIP-59 mirror (`nostr-live-mirror.cjs`, ADR-029) | egress | untouched (D9) |
| kind-30840/30841 digests | egress | untouched (D9) |

This ADR is WS5 of PRD-021; the interaction plane it repoints onto is ADR-042; the per-session `did:nostr`/URN the injected keystrokes are attributed to is ADR-043; the InjectionPath seam it formalises is the DDD-019 bounded context. The MAD window-0 model it retires is ADR-025.
