# DDD-010: Multi-Harness Coordination Domain

**Date**: 2026-05-27
**Status**: Draft
**Bounded Context**: Harness Lifecycle Management
**Cross-references**: PRD-013, ADR-025, ADR-005, ADR-011, DDD-005

---

## TL;DR for newcomers

*Skip if you already know the multi-harness coordination bounded context.*

This DDD captures the domain model for running multiple AI coding agent harnesses concurrently in a shared workspace. The pain point is that multiple harnesses sharing one git repository and one tmux session will corrupt each other's work unless the domain enforces strict isolation at three levels: filesystem (worktrees), identity (profiles), and coordination (explicit merge gates). The shape of the answer is three aggregates — `HarnessProfile` (identity and auth per tab), `WorktreeCoordinator` (git worktree lifecycle), and `SessionPersistence` (tmux state durability) — with two complementary access paths: Consultant MCPs (Claude routes queries to another LLM over MCP) and Direct Access (a harness operates on the filesystem via its own tmux tab). Neither path is privileged; both are active simultaneously.

**If you remember only one thing:** each harness tab gets exactly one profile and one worktree — tab 0 is reserved for Claude Code on the primary worktree, and no harness ever merges its own work back.

---

## Domain Purpose

This domain owns the truth about three things:

1. **Who is running** — which harness occupies which tab, with which credentials and environment.
2. **What they may touch** — the mapping from harness identity to worktree branch, enforced at provision time.
3. **How work flows back** — the explicit coordinator-gated merge path from harness worktree to primary worktree.

The domain does not own the underlying git repository content, the management API, or the LLM routing logic for Consultant MCPs.

---

## Bounded Context Definition

**Boundary**: Container-side tmux session and git working tree. All coordination runs inside the container.

**Owns**:
- Profile provisioning and isolation (`HarnessProfile` aggregate).
- Git worktree creation, tracking, merge gating, and cleanup (`WorktreeCoordinator` aggregate).
- Tmux-resurrect save/restore state and continuum auto-save intervals (`SessionPersistence` aggregate).
- Conflict detection between concurrent harness edits.
- Mapping from tab number to profile directory and worktree branch.

**Does not own**:
- The git repository content or commit history (the host project owns these).
- LLM routing or Consultant MCP protocol (ADR-011 owns the MCP transport layer).
- Container lifecycle or image composition (DDD-001, flake.nix).
- Auth credential generation (bootstrap context, `scripts/sovereign-bootstrap.py`).
- The management API routes (management-api/ context).

---

## Aggregates

### HarnessProfile (root aggregate)

Owns the durable identity of a single harness tab. One profile per tab; profiles are never shared.

| Field | Type | Notes |
|---|---|---|
| `profile_id` | `urn:agentbox:thing:<scope>:profile-<tab>` | Minted via uris.js |
| `tab_number` | u8 | 0 = Claude Code primary; 1–N = harness tabs |
| `profile_path` | AbsPath | `$WORKSPACE/profiles/tab-<N>/` |
| `worktree_branch` | BranchName | `harness/<name>` convention |
| `harness_binary` | AbsPath | Path to the harness CLI executable |
| `env_vars` | Map<String,String> | Isolated per profile; never merged across profiles |
| `auth_credentials` | CredentialRef | Opaque ref; resolved at spawn time, never serialised to shared storage |

**Lifecycle**: Provisioned once at container start (I07 — idempotent). Torn down on explicit deprovision or container stop.

### WorktreeCoordinator

Manages the full lifecycle of git worktrees: create, track conflicts, gate merges, and clean up stale trees.

| Responsibility | Behaviour |
|---|---|
| `create_worktree(harness, branch)` | `git worktree add` — idempotent, safe on restart |
| `detect_conflict(file, a, b)` | Emits `ConflictDetected` before any merge attempt |
| `merge_worktree(harness, target)` | Requires explicit coordinator invocation; never self-triggered by the harness |
| `cleanup_worktree(harness)` | Runs after successful merge or on deprovision |

Tab 0 (Claude Code) always operates on `HEAD` of the primary worktree. No other tab may write to the primary worktree directly (I03).

### SessionPersistence

Manages tmux-resurrect snapshots and the continuum plugin auto-save interval. Survives container restart if the workspace volume is mounted.

| Field | Type | Notes |
|---|---|---|
| `session_name` | String | Canonical tmux session name |
| `save_interval_s` | u32 | Continuum auto-save cadence |
| `resurrect_dir` | AbsPath | Snapshot storage under workspace volume |
| `last_saved_at` | Timestamp | Updated on each `SessionSaved` event |

---

## Domain Events

| Event | Payload | Trigger |
|---|---|---|
| `HarnessProvisioned` | `profile_id`, `tab_number`, `worktree_branch` | Profile create completes |
| `WorktreeCreated` | `harness_name`, `branch`, `path` | `git worktree add` succeeds |
| `WorktreeMerged` | `harness_name`, `target_branch`, `commit_sha` | Coordinator merge completes |
| `WorktreeCleanedUp` | `harness_name` | Worktree removed post-merge or deprovision |
| `SessionSaved` | `session_name`, `saved_at` | Continuum auto-save or explicit save |
| `SessionRestored` | `session_name`, `restored_at` | Resurrect on container start |
| `ConflictDetected` | `file_path`, `harness_a`, `harness_b` | Overlapping edits detected pre-merge |

---

## Invariants

| ID | Statement |
|---|---|
| **I01** | Each harness tab MUST have its own profile directory. Shared profiles are prohibited. |
| **I02** | Each harness tab that edits files MUST operate in a named worktree (`harness/<name>`). |
| **I03** | Only Claude Code (tab 0) may operate on the primary worktree. |
| **I04** | Git merge from a harness worktree to the primary worktree requires explicit `WorktreeCoordinator` action; harnesses never self-merge. |
| **I05** | Consultant MCP paths and Direct Access tabs are complementary and simultaneously active; neither is deprecated or preferred. |
| **I06** | Auth credentials MUST NOT leak between profiles. Credential refs are resolved in process; never written to shared storage or environment variables visible to other profiles. |
| **I07** | Worktree creation MUST be idempotent. Re-running provisioning after a container restart MUST NOT produce duplicate worktrees or branch conflicts. |

---

## Access Path Model

Two paths co-exist; the domain coordinates both without privileging either.

```
Claude Code (tab 0)
  └── Primary worktree  ←─── read-only to all other tabs

Harness Tab N
  ├── Direct Access path
  │     └── HarnessProfile → named worktree (harness/<name>)
  └── Consultant MCP path
        └── Claude routes query → external LLM via MCP transport (ADR-011)
              └── response flows back; no filesystem writes by the MCP peer
```

The Consultant MCP path never writes to the filesystem directly. Only the Direct Access path mutates worktree state, and only through the harness's own profile-isolated environment.

---

## Relationship to Adjacent Contexts

| Context | Relationship |
|---|---|
| Bootstrap (DDD-001) | Upstream — generates auth credentials consumed by HarnessProfile |
| MCP Transport (ADR-011) | Upstream — provides Consultant Relay channel; this domain does not own the protocol |
| Adapter Layer (ADR-005) | Peer — WorktreeCoordinator emits events through the events adapter slot |
| Setup Dashboard (DDD-009) | Downstream observer — reads HarnessProvisioned events for display only |
| Code-as-Harness (DDD-005) | Peer — shares the `did:nostr` identity mesh; harness sessions emit URNs under the same scope |
