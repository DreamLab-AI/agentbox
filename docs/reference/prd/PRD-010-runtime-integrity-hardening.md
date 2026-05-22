# PRD-010: Runtime Integrity Hardening

**Status:** Draft v1
**Date:** 2026-05-22
**Repo:** [github.com/DreamLab-AI/agentbox](https://github.com/DreamLab-AI/agentbox)
**Related:** ADR-022 (Runtime integrity decisions), DDD-007 (Runtime integrity domain), DDD-002 (Runtime contract), ADR-007 (Security profile), ADR-005 (Pluggable adapters), PRD-008 (Code-as-harness)

## TL;DR

A systematic audit of agentbox identified 10 confirmed runtime integrity failures across five failure classes: silent error suppression masking broken features, filesystem write paths missing from the mount whitelist, dead middleware never wired to routes, a hardcoded Nix exception filter that silently drops operator config, and volatile in-memory state posing as durable storage. This PRD specifies the hardening work to close all gaps, grouped into four workstreams with concrete acceptance criteria.

---

## 1. Problem

### 1.1 Silent failure in read-only containers

Agentbox enforces `read_only: true` (ADR-007) but multiple runtime components attempt writes to paths not covered by named volumes or tmpfs mounts. Errors are suppressed via `|| true`, `2>/dev/null`, or empty `catch` blocks, so the operator sees a healthy container while features silently produce no output.

Confirmed instances:
- Code-as-Harness audit logs, traces, and ACI submissions write to `/var/lib/agentbox/code-harness/` — no mount exists
- Consultant audit logs write to `/var/lib/agentbox/consultations/` — the `consultants` exception is filtered out by the Nix whitelist before the volume is ever generated
- pip install in the code-interpreter MCP targets the immutable Nix store because no `--target` or venv is configured

### 1.2 Unwired security and payment enforcement

Middleware files (`payment-gate.js`, `cost-gate.js`) define payment and cost enforcement but are never imported or registered on any Fastify route. GPU-metered endpoints (ComfyUI) execute without cost enforcement. Route handlers read `request.body.cost_sats` expecting middleware to have set it — they get `undefined`.

### 1.3 Fail-open authentication

The git-bridge webhook callback verifies HMAC signatures only when `WEBHOOK_HMAC_SECRET` is set. If the env var is absent, verification is silently skipped. The global Bearer/NIP-98 auth layer partially mitigates this, but the route-level contract is still fail-open.

### 1.4 Unprocessable encrypted messages

NIP-17 sealed DMs (kind 1059) are persisted to the pod inbox as raw encrypted ciphertext. The relay consumer has no decryption path — it never loads the agent's nsec for inbound events. Downstream tools cannot consume these messages.

### 1.5 Volatile orchestration state

Swarm coordination tools (`swarm_init`, `agent_spawn`, `task_orchestrate`) store state in a JavaScript `Map()` via `fallback-store.js`. A durable write path exists (`podMemoryStore()` → management API → RuVector PostgreSQL) but swarm tools bypass it. All orchestration state vanishes on process restart.

### 1.6 Configuration data loss

The TUI wizard (`tui-write-manifest.py`) rebuilds `agentbox.toml` from a hardcoded incomplete field whitelist. Running the wizard after manual advanced configuration silently wipes ~20+ sections including `[llm_marketplace]`, `[mesh]`, `[linked_data.*]`, `[payments]`, `[plugins]`, and `[networking]`.

### 1.7 Hardcoded exception filter drift

The `activeExceptions` filter in `flake.nix` uses a hardcoded name whitelist. Any `[security.exceptions.*]` section with a name not in the whitelist is silently dropped — no warning, no validation error. The `consultants` exception is the first confirmed casualty; any future exception names will hit the same wall.

### 1.8 Broken external connectivity

The TCP proxy (`claude-flow-tcp-proxy.js`) spawns `/app/node_modules/.bin/claude-flow` — a path that does not exist in a Nix container where CLIs are in the Nix store PATH. Every inbound TCP connection crashes with ENOENT.

---

## 2. Solution

Four workstreams, each independently shippable.

### WS-1: Mount Whitelist Reconciliation

Close the gap between runtime write paths and declared mounts.

| Action | Path | Mount type |
|--------|------|-----------|
| Add named volume | `/var/lib/agentbox/code-harness` | `code-harness-data` |
| Add `consultants` to `activeExceptions` whitelist | `/var/lib/agentbox/consultations` | `consultations-data` (via exception) |
| Add tmpfs or volume for pip target | `/var/lib/agentbox/pip-target` | tmpfs or named |
| Audit all remaining write paths | All MCP/management-api code | Per finding |

**Acceptance:** `nix build .#default && docker compose config` shows every runtime write path covered. No `EROFS` errors in 10-minute smoke test.

### WS-2: Middleware Wiring and Fail-Closed Enforcement

Wire dead middleware and close fail-open paths.

| Action | File | Change |
|--------|------|--------|
| Register `paymentGate` on ComfyUI and task routes | `routes/comfyui.js`, `server.js` | `preHandler` hook |
| Register `costGate` on resource-intensive routes | `routes/*.js` | `preHandler` hook |
| Fail-closed webhook HMAC | `routes/git-bridge.js` | Return 500 if `WEBHOOK_HMAC_SECRET` unset |
| Remove misleading "imported per-route" comment | `server.js:13` | Delete comment |

**Acceptance:** Payment gate returns 402 when balance insufficient. Webhook returns 500 when secret unset. No middleware file in `middleware/` is unreferenced.

### WS-3: State Durability and Encryption

Route volatile state through durable backends and add missing decryption.

| Action | File | Change |
|--------|------|--------|
| Route swarm tools through `podMemoryStore()` | `mcp-server.js` | Dual-write: volatile Map + management API |
| Add NIP-17 decryption in inbound path | `relay-consumer.js` | Load nsec, detect kind 1059, unwrap NIP-44 before `_formatAsLdn` |
| Fix `persisted` flag in swarm responses | `mcp-server.js` | Reflect actual durable write success |

**Acceptance:** Swarm state survives MCP process restart. NIP-17 DMs stored as plaintext in pod inbox. `persisted: true` only when write confirmed.

### WS-4: Configuration Safety

Prevent data loss in the TUI wizard and Nix exception filter.

| Action | File | Change |
|--------|------|--------|
| Preserve unknown TOML sections in wizard | `tui-write-manifest.py` | Read existing TOML, merge known fields, pass through unknown sections |
| Dynamic exception filter in flake | `flake.nix` | Replace hardcoded whitelist with `lib.filterAttrs (name: _: securityExceptions ? ${name})` or equivalent |
| Add validation warning for unrecognised exceptions | `agentbox-config-validate.js` | W060: declared exception not in known set |
| Fix TCP proxy binary path | `claude-flow-tcp-proxy.js` | Use `process.env.CLAUDE_FLOW_BIN \|\| 'claude-flow'` (PATH lookup) |

**Acceptance:** Wizard round-trip preserves all TOML sections. New exception names flow through to compose volumes. TCP proxy connects successfully in Nix container.

---

## 3. Scope Exclusions

- Admin suspend/archive stubs (finding #5): explicitly deferred to post-alpha.15 per existing plan. Document in release notes.
- Adapter contract changes: no new adapter slots. All fixes use existing adapter dispatch.
- New Nostr kinds: no protocol changes. NIP-17 decryption uses existing NIP-44 primitives.

---

## 4. Success Metrics

| Metric | Target |
|--------|--------|
| Silent EROFS failures in 30-min smoke test | 0 |
| Middleware files with zero importers | 0 |
| Fail-open auth paths | 0 |
| TOML sections lost on wizard round-trip | 0 |
| Swarm state surviving MCP restart | 100% |

---

## 5. Phasing

| Phase | Workstream | Risk | Ship target |
|-------|-----------|------|-------------|
| 1 | WS-1 (mounts) + WS-2 (middleware) | Low — additive changes | alpha.16 |
| 2 | WS-3 (durability + decryption) | Medium — behavioural change | alpha.17 |
| 3 | WS-4 (config safety) | Low — tooling changes | alpha.17 |

---

## 6. Appendix: Full Finding Inventory

See ADR-022 §Decision for the complete 10-finding manifest with file paths, line numbers, and verification evidence.
