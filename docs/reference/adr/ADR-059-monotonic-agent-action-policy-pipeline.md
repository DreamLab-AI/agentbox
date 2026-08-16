---
id: ADR-059
title: Monotonic policy pipeline for every agent-initiated action
status: proposed
date: 2026-08-16
type: security
author: Dr John O'Hare
depends_on: [ADR-005, ADR-008, ADR-018, ADR-020, ADR-027, ADR-031, ADR-057, ADR-058]
related: [PRD-003, PRD-008, PRD-010, DDD-002, DDD-005, DDD-007, DDD-013]
review_trigger: MCP standardises an equivalent end-to-end policy interceptor; a supported harness cannot route nested actions through the pipeline; or approval semantics move to an external policy decision point
---

# ADR-059 — Monotonic policy pipeline for every agent-initiated action

## Context

Agentbox already has strong controls, but they live at several boundaries: hook guards,
MCP servers, filesystem and shell wrappers, adapter middleware, privacy filtering,
spend policy, ACSP approvals, and harness-native permission systems. Their coverage and
ordering differ. A direct tool call may be governed while a code-mode sub-call, plugin
tool, consultant action, background job, or alternate harness path takes a different
route. A post-hook can also rewrite what an earlier policy thought it approved.

DeepSeek Harness treats guarded tool execution as one pipeline: pre-execution
transforms, approval, identity-protected monotonic guards, around-execution concerns,
post-processing, definition-owned finalisation, then an immutable outcome notification.
Serialized sub-calls pass through the same pipeline and carry a parent token.

The valuable idea is not its particular tool registry. It is the invariant that all
agent-initiated side effects cross one policy decision point and later stages cannot
weaken an earlier denial or change the approved action's identity.

## Decision

### D1 — Define the canonical `AgentAction`

Normalise every model-initiated tool, MCP, shell, filesystem mutation, code-dispatched
sub-call, consultant call, job submission, and spend-bearing request into:

```text
{ action_id, parent_action_id?, session_urn, agent_did, harness, capability,
  operation, canonical_args_hash, target, side_effect_class, privacy_class,
  estimated_cost?, deadline, provenance }
```

Human CLI commands are included only when they delegate to an agent capability; purely
local operator commands remain outside the model-action boundary and are labelled as
such. Adapter-internal operations remain governed by ADR-005 middleware, while the
initiating agent action receives one decision before dispatch.

### D2 — Use a fixed, observable stage order

The pipeline order is:

1. **normalise** schema and canonical action identity;
2. **enrich** trusted context without changing operation or target;
3. **classify** side effects, privacy, destination, and estimated cost;
4. **approve** when policy requires a one-use human/ACSP decision;
5. **guard** with monotonic owner policies;
6. **execute** through timeout, cancellation, retry, and metrics wrappers;
7. **post-process** untrusted output for redaction, size, and content policy;
8. **finalise** definition-owned synchronous invariants;
9. **record** one immutable outcome linked to ADR-057 journal events.

Pre-execution policy may narrow arguments or deny. After approval begins, the tuple
`capability + operation + target + canonical_args_hash + cost ceiling` is frozen. Any
change requires a new action id and a new approval evaluation.

### D3 — Guards are monotonic and fail closed

A guard returns `deny` or `abstain`; no later guard can turn a denial into permission.
An absent, timed-out, mismatched, replayed, or unavailable approval is a denial. The
approval receipt binds the frozen identity, actor DID, expiry, cost ceiling, and a
single-use nonce. Owner policies that must not be reordered are registered as guards,
not ordinary hooks.

Observability and optional output decoration may fail open only after the authoritative
action outcome is safe and recorded. Mutation, external egress, secret access, and
spend never fail open.

### D4 — Nested actions cannot bypass policy

Code mode, shell helpers, subagents, jobs, and composite tools receive a scoped parent
token. Each nested side effect creates a child `AgentAction`, preserves causation, and
crosses the pipeline. A composite tool cannot confer broader authority than its parent;
child policy is the intersection of delegated authority and current owner policy.

Direct invocation of a protected executor without a valid pipeline capability token is
rejected. This is enforced at executor seams, not only by convention in tool wrappers.

### D5 — One policy, harness-specific projections

The canonical rules live in one manifest-backed policy. Claude hooks, Codex policies,
MCP registration metadata, ruflo configuration, and management-api middleware are
generated projections and compatibility adapters. Their coverage is published per
action class. A native harness denial may be stricter than Agentbox policy; it may not
be weakened to obtain parity.

## Consequences

- Policy order, approval identity, and audit records become consistent across harnesses.
- Nested and alternative execution paths stop being implicit bypasses.
- Existing guards must be inventoried and classified; duplicate controls may remain
  temporarily but disagreement must resolve to the stricter result.
- Normalisation adds latency. Read-only, local, low-risk calls still cross the pipeline
  but can take an approval-free fast path.
- Output post-processing is explicitly separate from permission to execute, avoiding
  the mistake of treating a redacted result as permission for an unsafe side effect.

## Alternatives considered

**Keep policy inside each tool or MCP server.** Rejected: local checks remain useful
defence in depth but cannot prove cross-tool ordering or nested-call coverage.

**Use hooks as the universal enforcement point.** Rejected: supported harnesses expose
different hooks, and internal/nested calls may not re-enter them.

**Allow an approval to cover a mutable call.** Rejected: rewriting target, arguments,
or cost after approval invalidates the human decision and enables confused-deputy bugs.

## Implementation and verification

1. Build an action-path inventory across Claude, Codex, ruflo, MCP, code interpreter,
   consultants, jobs, filesystem, shell, and spend; mark enforcement and bypass seams.
2. Specify canonicalisation and one-use receipt schemas, including test vectors.
3. Implement the pipeline at the shared executor boundary and adapt one read, one write,
   one network action, and one nested code-mode action.
4. Add adversarial tests for mutation-after-approval, duplicate/replayed receipts,
   deny/allow ordering, missing approvers, parent-token forgery, nested bypass, timeout,
   cancellation, and result snapshot failure.
5. Expose coverage and per-stage decisions without logging secrets or raw sensitive args.

Acceptance requires every supported side-effect class either to prove traversal with a
journal-linked decision receipt or be disabled and reported as unsupported.

## Provenance

Adapted from DeepSeek Harness commit
[`47f9438`](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a):
the [tool execution pipeline](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/tool-execution-pipeline.md),
the [event producer/consumer map](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/event-producer-consumer.md),
and the underlying [`tools` service](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a/packages/core/tools).

