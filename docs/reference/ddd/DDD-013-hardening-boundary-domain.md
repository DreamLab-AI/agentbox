# DDD-013: Hardening Boundary Domain

**Date**: 2026-06-11
**Status**: Accepted
**Bounded Context**: Hardening Boundary
**Cross-references**: PRD-REMEDIATION-001 (product requirements), ADR-027 (decision record), ADR-007 (runtime contract — supplies SecurityProfile), ADR-008 (privacy filter routing), ADR-015 (MCP RuVector mandate), ADR-022 (runtime integrity), DDD-002 (runtime contract domain), DDD-003 (sovereign messaging domain — owns the bridge identity)

---

## TL;DR for newcomers
*Skip if you already know where agentbox's security boundary actually is.*

This DDD captures the Hardening Boundary bounded context: the part of the system that owns *where the real security boundary is and what counts as defence-in-depth behind it*. The pain point is that agentbox accumulated security-flavoured code (a seccomp profile, a Python `sandbox_check`, a task-input regex) that was easy to mistake for the boundary itself, while the actual boundary properties (loopback publish, auth-default-on, no runtime escalation, secrets off env) were partly unenforced and oversold in docs. The shape of the answer is a domain with explicit aggregates (NetworkEdgePolicy, PrivilegeModel, SecretMaterialisation, DefenceInDepthLayer) and a ubiquitous language that separates **boundary** from **defence-in-depth** from **telemetry**. You get the glossary, aggregates, invariants, domain events, and the anti-corruption layer that keeps this domain aligned with DDD-002 (runtime contract) and DDD-003 (sovereign messaging).

**If you remember only one thing:** the container runtime is the boundary; the network edge is loopback-published and auth-default-on; nothing escalates privilege at runtime; secrets live in tmpfs files, not env. Everything else (seccomp denylist, `sandbox_check`, task regex) is defence-in-depth or telemetry — necessary signal, insufficient containment.

For the deep version, keep reading.

## Domain Purpose

The Hardening Boundary domain ensures that agentbox's *enforced* posture matches its *advertised* posture, and that every security-flavoured component is correctly classified as **boundary**, **defence-in-depth**, or **telemetry**. It owns the invariants that prevent a future change from (a) re-exposing a port to the host network, (b) reintroducing a runtime privilege-escalation path, (c) leaking a secret into process env, or (d) re-labelling a defence-in-depth check as the boundary.

## Bounded Context Definition

**Boundary**: This domain owns the *truthful classification and enforcement* of the security posture — the gap between "we claim X is hardened" and "X is enforced and correctly described."

**Owns**: Network-edge publication policy, runtime privilege model, secret materialisation, and the classification of defence-in-depth layers.

**Does not own**: The privacy-redaction policy (DDD-002 / ADR-008 own the adapter middleware), the bridge's cryptographic identity (DDD-003 owns the `did:nostr` keypair lifecycle), feature business logic (respective domains), build-time packaging (DDD-001), or runtime-integrity wiring (DDD-007).

**Consumes from DDD-002**: `SecurityProfile.readOnlyRootFs`, `SecurityProfile.capDrop`, `SecurityProfile.noNewPrivileges`, `SecurityProfile.publishedPorts`.

**Consumes from DDD-003**: the bridge keypair (`AGENTBOX_BRIDGE_SK`) whose *materialisation at runtime* this domain governs (file-not-env), while DDD-003 owns its generation and signing semantics.

**Publishes to DDD-002**: `PostureRegression` events that should influence the readiness/hardening assertions.

## Ubiquitous Language

| Term | Definition |
|---|---|
| **Boundary** | The single mechanism that actually contains untrusted execution: the container runtime (read-only root, `cap_drop: ALL`, uid 1000, `no-new-privileges:true`, seccomp). A failure of the boundary is a security incident. |
| **Defence-in-Depth** | A layer that narrows the attack surface but cannot contain a determined adversary on its own (seccomp supplemental denylist, `sandbox_check.py` AST walk). A failure here degrades depth, not the boundary. |
| **Telemetry** | A signal that records or flags behaviour without blocking it (the task-input pattern set). It must never be relied upon as a control. |
| **Host-Loopback Publish** | A compose port binding of the form `127.0.0.1:<p>:<p>` — reachable only from the host's loopback interface, not the host's network interfaces. |
| **Process-Loopback** | A service binding `127.0.0.1` *inside* the container. Rejected as the publication model because it breaks cross-container dispatch. |
| **Auth-Default-On** | Authentication that is enabled unless explicitly disabled, and that fails closed when enabled with no token. |
| **Runtime Escalation Path** | Any mechanism by which a post-boot process can re-acquire privilege it was supposed to drop (setuid sudo, `SETUID`/`SETGID` caps, a privileged helper). |
| **Secret Materialisation** | The form a secret takes at runtime. A tmpfs file (`0400`, owner-scoped) is the narrow form; a process env var is the leaky form. |
| **Posture Overclaim** | Documentation that asserts a stronger guarantee than the code enforces (e.g. calling a supplemental denylist a "tightened profile"). |

## Aggregates

### NetworkEdgePolicy (Root Aggregate)

Owns the invariant that nothing reaches the host network and every cross-container call authenticates.

```
NetworkEdgePolicy
  +-- publishedPorts: PublishedPort[]
  |     +-- PublishedPort
  |           +-- service: string
  |           +-- hostBind: string        // MUST be "127.0.0.1"
  |           +-- hostPort: number
  |           +-- containerPort: number
  |
  +-- serviceBinds: ServiceBind[]
  |     +-- ServiceBind
  |           +-- service: string
  |           +-- bindHost: string         // "0.0.0.0" allowed (Docker publish needs it)
  |           +-- authGate: "ws-auth" | "mgmt-bearer" | "zai-bearer" | "none"
  |
  +-- authPolicy: AuthPolicy
        +-- wsAuthDefault: "on" | "off"     // MUST be "on"
        +-- failClosed: boolean             // MUST be true
        +-- comparison: "timing-safe" | "naive"  // MUST be "timing-safe"
```

**Invariants:**
- I01: Every `PublishedPort.hostBind` MUST equal `127.0.0.1`. A `0.0.0.0` host bind is a `PostureRegression`.
- I02: Every `ServiceBind` with `bindHost = "0.0.0.0"` MUST have a non-`none` `authGate`.
- I03: `authPolicy.wsAuthDefault = "on"`, `failClosed = true`, `comparison = "timing-safe"`.

### PrivilegeModel

Owns the invariant that no privilege is gained after boot.

```
PrivilegeModel
  +-- capAdd: string[]                 // MUST NOT contain "SETUID" or "SETGID"
  +-- noNewPrivileges: boolean         // MUST be true
  +-- rootWindows: RootWindow[]
  |     +-- RootWindow
  |           +-- phase: "boot" | "runtime"   // "runtime" is prohibited
  |           +-- actor: string               // e.g. "supervisord PID 1 bootstrap"
  +-- escalationPaths: EscalationPath[]   // MUST be empty
        +-- EscalationPath
              +-- mechanism: "setuid-sudo" | "setuid-cap" | "privileged-helper"
              +-- location: string
```

**Invariants:**
- I04: `capAdd` contains neither `SETUID` nor `SETGID`.
- I05: `noNewPrivileges` is `true`.
- I06: `escalationPaths` is empty. Every `RootWindow.phase` is `"boot"`; no runtime root window exists.

### SecretMaterialisation

Owns the invariant that secrets never live in long-running process env.

```
SecretMaterialisation
  +-- secrets: SecretEntry[]
        +-- SecretEntry
              +-- name: string                // e.g. "nostr.key"
              +-- envVar: string | null       // MUST be null in any long-running process
              +-- filePath: string            // e.g. "/run/secrets/nostr.key"
              +-- backing: "tmpfs" | "disk"    // MUST be "tmpfs"
              +-- mode: string                 // MUST be "0400"
              +-- owner: string                // MUST be "devuser"
              +-- zeroizedAfterParse: boolean
```

**Invariants:**
- I07: For every `SecretEntry`, `envVar` is `null` in every long-running process (the loader env may set it transiently and MUST unset it before `exec supervisord`).
- I08: `backing = "tmpfs"`, `mode = "0400"`, `owner = "devuser"`.
- I09: A secret read from a file MUST be `zeroizedAfterParse` where the reader holds the raw hex.

### DefenceInDepthLayer

Owns the classification of every security-flavoured component.

```
DefenceInDepthLayer
  +-- layers: SecurityComponent[]
        +-- SecurityComponent
              +-- name: string                // "seccomp", "sandbox_check", "task-regex"
              +-- classification: "boundary" | "defence-in-depth" | "telemetry"
              +-- docMatchesClassification: boolean   // MUST be true (no overclaim)
              +-- blocks: boolean             // telemetry MUST be false
```

**Invariants:**
- I10: The container runtime is the only component classified `"boundary"`. seccomp (supplemental denylist) and `sandbox_check.py` are `"defence-in-depth"`; the task-input pattern set is `"telemetry"`.
- I11: Every `SecurityComponent.docMatchesClassification` is `true` — no `PostureOverclaim`. (The seccomp file's own comment and the README must state "supplemental denylist", not "tightened/replacement allowlist".)
- I12: Any component classified `"telemetry"` has `blocks = false` — it records, it does not gate.

## Domain Events

| Event | Emitted when | Consumer |
|---|---|---|
| `PostureRegression` | A `PublishedPort` binds `0.0.0.0`, or a runtime escalation path appears, or a secret enters a long-running env | DDD-002 hardening assertions; CI lint; operator alert |
| `AuthDefaultFlipped` | WS auth default reverts to off, or fail-closed is disabled | Security scan; CI lint |
| `SecretEnvLeak` | A governed secret is found in `/proc/<pid>/environ` | Entrypoint audit; readiness probe |
| `PostureOverclaim` | A doc asserts a stronger guarantee than the code enforces | Doc-alignment lint (R-040) |
| `DefenceClassificationDrift` | A defence-in-depth or telemetry component is described or wired as the boundary | Security review; CI lint |
| `RuntimeEscalationDetected` | `SETUID`/`SETGID` reappears in `cap_add`, or a setuid sudo path is found | `nix build` validation; entrypoint audit |

## Anti-Corruption Layer

### Relationship to DDD-002 (Runtime Contract)

DDD-002 owns the operator-facing `SecurityProfile` (read-only root, caps, probes). DDD-013 owns the *enforcement and truthful description* of the edge, privilege, and secret properties behind it. The boundary:

- DDD-002's `SecurityProfile.publishedPorts` is an input to DDD-013's `NetworkEdgePolicy.publishedPorts`.
- DDD-013's `PostureRegression` event feeds DDD-002's hardening assertions.
- DDD-013 never modifies DDD-002 aggregates directly; it publishes events DDD-002 consumes.

### Relationship to DDD-003 (Sovereign Messaging)

DDD-003 owns the bridge's `did:nostr` keypair — generation, signing, NIP semantics. DDD-013 owns only *how that key is materialised at runtime* (file-not-env, tmfps, `0400`). DDD-013 does not generate, rotate, or sign with the key; it governs the leak surface.

### Relationship to ADR-008 (Privacy Filter)

ADR-008 / DDD-002 own the privacy-redaction middleware in the adapter dispatch path (strict/soft/off per slot). DDD-013 does not own redaction; it owns the statement of *scope* — that redaction is per-slot policy on durable adapter writes, not a universal "every agent action" interceptor. This keeps the README truthful (R-040).

### Relationship to ADR-022 / DDD-007 (Runtime Integrity)

DDD-007 owns whether declared features actually produce output (mounts, middleware wiring, ghost tools). DDD-013 owns whether the *security* posture is enforced and described truthfully. They are complementary: DDD-007 asks "does it work?"; DDD-013 asks "is it as contained as we say?"

## Validated Finding Inventory

The remediation that motivated this domain confirmed:

| # | Finding (ID) | Aggregate | Invariant |
|---|--------------|-----------|-----------|
| 1 | Ports bound `0.0.0.0` on host (R-003 host) | NetworkEdgePolicy | I01 |
| 2 | WS auth default-off, no fail-closed (R-003 auth) | NetworkEdgePolicy | I02, I03 |
| 3 | zai `--dangerously-skip-permissions`, no token (R-004) | NetworkEdgePolicy | I02 |
| 4 | SETUID/SETGID caps + runtime sudo (R-005 / SEC-001) | PrivilegeModel | I04, I06 |
| 5 | Bridge key in `AGENTBOX_BRIDGE_SK` env (SEC-003) | SecretMaterialisation | I07, I08, I09 |
| 6 | seccomp described as tightened/allowlist (R-001 / R-040) | DefenceInDepthLayer | I10, I11 |
| 7 | task-input regex treated as a control (R-010) | DefenceInDepthLayer | I12 |
| 8 | `sandbox_check.py` framed as a sandbox (SEC-002) | DefenceInDepthLayer | I10, I11 |
| 9 | "zero mutable npm install" overclaim (R-002 / R-040) | DefenceInDepthLayer | I11 |
