---
id: ADR-057
title: Replayable agent execution journal and derived projections
status: proposed
date: 2026-08-16
type: architecture
author: Dr John O'Hare
depends_on: [ADR-005, ADR-013, ADR-015, ADR-029, ADR-035, ADR-043, ADR-049]
related: [PRD-014, PRD-017, PRD-021, DDD-012, DDD-015, DDD-019]
review_trigger: the upstream DeepSeek Harness session envelope reaches a stable format; Agentbox adopts an external event store; or a supported harness cannot expose ordered turn, model, and tool lifecycle events
---

# ADR-057 — Replayable agent execution journal and derived projections

## Context

Agentbox has several useful but different records of agent activity: Claude hooks,
Codex notifications, ruflo session artefacts, the management API agent-event bridge,
per-turn NIP-59 mirroring (ADR-029), kind-30840 summaries, OpenTelemetry, and domain
receipts. They are outputs of particular integrations. None is the canonical,
harness-neutral record from which a turn can be reconstructed.

That distinction matters. A transcript is not an execution record: it omits rejected
inputs, partial streaming output, tool-call/result pairing, cancellation, approvals,
usage, and the exact context admitted to a model request. Telemetry is also not the
record: sampling and retention may discard it. Consequently, UI state, audit packets,
session recovery, cost attribution, and mobile projections can disagree without any
one source being authoritative.

DeepSeek Harness demonstrates a useful invariant: its append-only `SessionEvent` log
is the source for model history and other projections, and any model-visible input must
be reconstructable from that log. Durable session facts and live coordination events
are deliberately separate. Its turn/step lifecycle records input admission, streamed
chunks, assembled messages, tool calls and results, and terminal boundaries before
projecting a model transcript or UI.

Agentbox should adopt that invariant without importing Cordis or making DeepSeek
Harness the runtime. The source is a design precedent, not a dependency.

## Decision

### D1 — Add one canonical, append-only execution journal

Define a versioned `AgentExecutionEvent` envelope:

```text
{ schema, event_id, session_urn, seq, occurred_at, harness, agent_did,
  turn, step?, type, payload, correlation?, causation?, privacy_class }
```

`session_urn + seq` is unique and strictly increasing. Event bodies are losslessly
JSON-serialisable. Writes are append-only; corrections append a compensating event.
The journal routes through ADR-005's `events` adapter and therefore inherits its
privacy, linked-data, observability, and external-adapter boundaries. No sixth adapter
slot and no new database are introduced.

The minimum vocabulary is:

- `turn.started`, `input.claimed`, `input.rejected`, `step.started`;
- `model.requested`, `assistant.chunk`, `assistant.completed`, `model.failed`;
- `tool.called`, `tool.approval`, `tool.completed`;
- `step.completed`, `turn.stopping`, `turn.completed`, `turn.cancelled`.

Harness-specific payloads may be retained under a namespaced extension object, but a
consumer may depend only on the canonical fields.

### D2 — Model-visible means journalled

Before an adapter sends a model request, every message and injected context item in
that request must cite one or more journal sequence numbers. A runtime contract check
rejects an untraceable request in strict mode and emits an explicit degraded event in
compatibility mode. Secrets referenced by a request may be represented by a redacted,
hash-bound receipt; the invariant requires reconstructable provenance, not secret
disclosure.

`assistant.chunk` is retained for replay fidelity, while `assistant.completed` is the
authoritative assembled message and carries usage plus the source chunk sequences.
An interrupted stream therefore cannot accidentally become a successful assistant
message.

### D3 — Everything else is a projection

Transcript/history, live UI, NIP-59 mirror, kind-30840 digest input, cost ledger,
OpenTelemetry spans, and session search are idempotent projections keyed by their
source sequence watermark. Projection failure never rolls back the journal. Rebuilds
must produce the same semantic result from the same journal version.

The mobile mirror remains deliberately lossy and fail-open under ADR-029. This ADR
does not turn it into storage; it makes its source explicit.

### D4 — Separate durable facts from live control

Steering queues, process handles, cancellation signals, backpressure, and websocket
presence remain live control state. A durable event records their accepted outcome,
not the mutable mechanism. Consumers needing recovery or audit read the journal;
consumers coordinating in-flight work use the existing live bridge.

### D5 — Roll out by adapters, with an audited coverage matrix

Start with Claude and Codex turn/tool boundaries, then ruflo/subagents and MCP-hosted
actions. Each adapter publishes which canonical events it can prove and which it
cannot. `complete` coverage is a measured claim, never inferred from the existence of
a session transcript. Existing session files are not silently imported as canonical
history; an optional importer labels them `legacy-partial`.

## Consequences

- Session replay, audit, cost, and UI views gain one ordering and provenance model.
- Agentbox can recover projections after crashes without replaying side effects.
- Storage volume increases, especially for chunks; retention may compact chunks only
  after an assembled message is hash-bound and policy permits it.
- Cross-harness normalisation is real implementation work. Compatibility mode is
  necessary until every supported harness exposes adequate lifecycle events.
- This does not replace domain receipts, beads, RuVector memory, or PROV-O. Those
  records reference journal events when they claim an execution occurred.

## Alternatives considered

**Keep transcripts as the source of truth.** Rejected: they cannot prove tool and
approval behaviour or distinguish incomplete streams from completed messages.

**Use OpenTelemetry as the journal.** Rejected: telemetry is operationally valuable
but may be sampled, exported, or expired and is not a transactional session history.

**Adopt DeepSeek Harness persistence wholesale.** Rejected: Agentbox is multi-harness
and already has an adapter boundary. We adopt the invariant and event shape, not its
runtime or storage implementation.

## Implementation and verification

1. Specify the JSON Schema and event compatibility policy beside the events adapter.
2. Implement an append/read contract for local JSONL and external providers, including
   monotonic sequence, duplicate-id idempotency, and crash-tail recovery tests.
3. Add Claude and Codex mappers and a model-request provenance assertion.
4. Rebuild a transcript, cost ledger, and mirror feed from fixtures; compare outputs
   before and after restart.
5. Add runtime coverage to `/v1/system`: supported event types, last journal sequence,
   projection watermarks, and degraded gaps per harness.

Acceptance requires crash-injection tests proving that no projection can manufacture
a completed model response or tool result absent the corresponding journal event.

## Provenance

Adapted from DeepSeek Harness at commit
[`47f9438`](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a):
the [architecture's session-log invariant](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.md#session-log),
the [turn/step lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/agent-lifecycle.md),
and the [generated persistence catalogue](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/persistence-catalog.md).

