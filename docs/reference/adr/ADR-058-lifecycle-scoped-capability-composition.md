---
id: ADR-058
title: Lifecycle-scoped capability composition over the adapter spine
status: proposed
date: 2026-08-16
type: architecture
author: Dr John O'Hare
depends_on: [ADR-001, ADR-004, ADR-005, ADR-006, ADR-027, ADR-031, ADR-041]
related: [PRD-001, PRD-002, PRD-013, DDD-001, DDD-010]
review_trigger: Agentbox permits third-party in-process code; ruflo plugin lifecycle becomes the sole runtime composition mechanism; or a capability requires stateful hot reload in production
---

# ADR-058 — Lifecycle-scoped capability composition over the adapter spine

## Context

ADR-005 gives Agentbox five durable-state/orchestration adapter slots with versioned
contracts and boot-time selection. ADR-041 gives one policy with several generated
projections. The manifest also installs a large ruflo plugin set. These are strong
deployment mechanisms, but they do not provide one uniform lifecycle model for
in-process registrations such as prompt sections, tools, hooks, policy listeners,
model providers, and projections.

The resulting risk is residue: disabling or replacing a feature can leave a listener,
tool name, timer, environment projection, or provider registration alive until process
restart. Capability ownership is also easy to blur: a tool sometimes becomes both the
public contract and its only implementation, making provider substitution costly.

DeepSeek Harness offers two transferable ideas. First, a capability seam is explicitly
three roles: service definition, provider, and consumer. Second, every registration is
a reversible effect owned by a scoped plugin context; unloading the owner unwinds its
effects. Ordered profile/bundle patches compose an inspectable runtime tree.

Agentbox should graft those principles onto its existing Nix and manifest architecture.
It should not adopt unrestricted runtime plugin discovery, which ADR-005 already rejects
for reproducibility and in-process code-execution reasons.

## Decision

### D1 — Standardise a capability contract

Every new cross-cutting runtime capability declares:

1. a stable service contract and version;
2. one or more providers;
3. at least one consumer, or an explicit infrastructure-only justification;
4. required dependencies, scope, trust class, and apply class;
5. health, teardown, and contract tests.

The five ADR-005 adapter slots remain the durable-state spine. A capability is not a
new adapter slot merely because it is replaceable. Capabilities may consume adapters,
but must not bypass their middleware.

### D2 — Registrations are owned, scoped effects

Introduce a small in-process `CapabilityScope` library. Registration methods return a
disposer and are attached to an owner scope. Closing a scope disposes effects in reverse
registration order, awaits bounded asynchronous cleanup, and reports leaks.

The first supported effect types are tool definitions, prompt/context contributors,
event listeners, timers/jobs, health checks, and projections. Stable identity is
`capability-id + instance-id + registration-id`; duplicate identity fails loud.

Global, session, and agent-child scopes form a tree. Child scope closure cannot dispose
parent effects. A subagent therefore receives an explicit capability projection instead
of mutating the parent registry.

### D3 — Compose from immutable bundles and operator overlays

The Nix closure supplies trusted capability code. `agentbox.toml` supplies ordered
configuration layers: image defaults, selected profile, operator overrides, and an
ephemeral CLI/test overlay. A layer can replace a row by stable id or disable it; it
cannot introduce executable code outside the closure.

`agentbox.sh capabilities --dump` and `/v1/system` expose the effective tree, provider
bindings, origins, trust classes, dependency satisfaction, and active effect counts.
The resolved tree receives a canonical hash so two nominally identical boots can be
compared.

### D4 — Replacement is transactional

For reconfiguration, validate and initialise the candidate provider in an isolated
scope, run its health/contract probe, atomically switch the service binding, then close
the old scope. Failure leaves the old provider authoritative. Production defaults to
boot/restart application; live replacement is allowed only for a capability whose
contract declares and tests it.

### D5 — Keep the security boundary closed

No directory scanning, remote package fetch, `eval`, or arbitrary manifest module path
is permitted. Third-party capability code requires the existing Nix/vendor review path.
User-authored configuration may select and configure trusted packaged code but cannot
become code. A capability that handles secrets, subprocesses, writes, or network egress
declares the corresponding trust class and is visible in the dump.

## Consequences

- Provider swaps and per-agent capability sets become inspectable and testable.
- Teardown becomes a contract, reducing listener/timer leaks and cross-session bleed.
- ADR-005 remains authoritative for persistence and orchestration adapters; this ADR
  generalises lifecycle ownership around, not underneath, that boundary.
- A new registry and migration of existing registrations add complexity. Migration is
  incremental and starts with tools, prompt contributors, and event listeners.
- Agentbox gains some Cordis-like properties without coupling its runtime to Cordis.

## Alternatives considered

**Adopt Cordis as Agentbox's privileged core.** Rejected for now: it would replace too
much of the established Nix, Fastify, MCP, hook, and ruflo composition stack. The useful
invariants are implementable behind a small native contract.

**Use process restart as the only disposer.** Rejected: restart remains a valid apply
class, but it cannot prove session/child isolation and makes tests blind to leaked
registrations.

**Allow npm-style runtime plugin discovery.** Rejected consistently with ADR-005:
unreviewed in-process code breaks closure reproducibility and widens the trust boundary.

## Implementation and verification

1. Inventory tool, prompt, listener, timer, provider, and projection registrations;
   publish an ownership/teardown coverage matrix.
2. Implement `CapabilityScope` with deterministic reverse disposal, timeout reporting,
   child isolation, and duplicate-id tests.
3. Wrap one low-risk vertical slice (a prompt contributor plus tool consumer), then the
   MCP tool registry; do not mass-migrate before the slice proves the contract.
4. Add effective-tree dump and canonical hash to the runtime contract.
5. Run churn tests that mount/unmount a capability repeatedly and assert stable listener,
   timer, tool, file-descriptor, and memory counts.

## Provenance

Adapted from DeepSeek Harness commit
[`47f9438`](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a):
its [everything-is-a-plugin architecture](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.md),
[Cordis effect lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-primer.md),
and [generated capability graph](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/capability-seams.md).

