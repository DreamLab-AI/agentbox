# ADR-022: Runtime Integrity Hardening

**Status:** Accepted
**Date:** 2026-05-22
**Deciders:** John O'Hare
**Related:** PRD-010 (Runtime integrity hardening), DDD-007 (Runtime integrity domain), DDD-002 (Runtime contract), ADR-007 (Security profile), ADR-005 (Pluggable adapters), PRD-008 (Code-as-harness)

## Context

A systematic audit of agentbox identified five structural failure classes that collectively undermine the reliability contract of the read-only Nix container. The failures share a common root cause: the codebase grew features faster than the mount whitelist, middleware wiring, and error-handling discipline kept pace. The result is a container that reports healthy while multiple subsystems silently produce no output.

The audit confirmed 10 specific findings (all verified against source code) and a broader inventory of 207 silent error suppression patterns (36 critical, 87 moderate, 84 low).

### Failure Classes

1. **Mount whitelist gaps** — runtime code writes to paths not covered by named volumes or tmpfs. In a `read_only: true` container (ADR-007), these writes fail with EROFS and are silently suppressed.

2. **Dead middleware** — `payment-gate.js` and `cost-gate.js` are defined but never imported or registered on any Fastify route. GPU-metered endpoints execute without cost enforcement. A misleading comment in `server.js:13` claims per-route import.

3. **Fail-open authentication** — the git-bridge webhook HMAC check is conditional on env var presence. If `WEBHOOK_HMAC_SECRET` is unset, verification is skipped entirely. The global Bearer/NIP-98 auth layer provides secondary defense but does not close the route-level gap.

4. **Volatile orchestration state** — swarm tools store state in a JavaScript `Map()` that vanishes on process restart. A durable write path (`podMemoryStore()`) exists but swarm tools bypass it.

5. **Configuration data loss** — the TUI wizard rebuilds `agentbox.toml` from a hardcoded incomplete field whitelist, silently wiping ~20+ advanced sections. The Nix `activeExceptions` filter uses a hardcoded name whitelist that silently drops unrecognised exception names.

## Decision

### D1: Mount whitelist reconciliation

Add the following to `agentboxBaselineMounts` in `flake.nix`:

```nix
"code-harness-data:/var/lib/agentbox/code-harness"
```

Add `"consultants"` to the `activeExceptions` hardcoded whitelist in `flake.nix`.

For the code-interpreter pip target, add `--target /var/lib/agentbox/code-harness/pip-packages` to the pip install command and prepend that path to `sys.path` at interpreter startup.

### D2: Fail-closed enforcement

**Webhook HMAC**: Replace the `if (WEBHOOK_SECRET)` guard with a fail-closed pattern:

```javascript
if (!WEBHOOK_SECRET) {
  return reply.code(500).send({
    error: 'webhook-secret-missing',
    message: 'WEBHOOK_HMAC_SECRET not configured; callback rejected'
  });
}
```

**Payment gate**: Register `paymentGate` as a `preHandler` on all GPU-metered routes (`/v1/comfyui/workflow`, `/v1/tasks` when `gpu: true`). Register `costGate` as a global hook on `/v1/tasks`.

### D3: Swarm state dual-write

Route `swarm_init`, `agent_spawn`, and `task_orchestrate` through the existing `podMemoryStore()` function after the volatile `Map()` write. The volatile layer remains for low-latency reads; the durable layer provides cross-session continuity.

```javascript
await this.memoryStore.store(`swarm:${swarmId}`, JSON.stringify(swarmData), opts);
await podMemoryStore(`swarm:${swarmId}`, JSON.stringify(swarmData), 'swarms');
```

The `persisted` flag in the response must reflect whether the durable write succeeded, not the existence of a `databaseManager` that is never initialised.

### D4: NIP-17 inbound decryption

Add a kind-specific handler in `relay-consumer.js` for kind 1059 events:

1. Load the agent's nsec via the existing `loadSigner()` (currently only used in outbound path)
2. Unwrap the NIP-44 gift-wrap envelope to extract the inner rumor
3. Pass the decrypted content to `_formatAsLdn()` instead of the raw ciphertext
4. Store the decrypted event with a `x:decryptedFrom` field referencing the original event ID

If nsec is unavailable, persist the encrypted event with a `x:encrypted: true` flag and emit a warning log. Do not drop the event.

### D5: TUI wizard section preservation

Replace the write-from-scratch approach in `tui-write-manifest.py` with a merge strategy:

1. Read existing `agentbox.toml` into a dict
2. Update only the fields the wizard controls
3. Preserve all sections the wizard does not know about
4. Write the merged result

Use the `tomlkit` library (preserves comments and formatting) instead of raw string emission.

### D6: Dynamic exception filter

Replace the hardcoded `activeExceptions` whitelist with a dynamic filter that accepts any exception name present in the manifest's `[security.exceptions]` table, gated only by the exception's own `enabled` field (defaulting to `true`). Add a validator warning (W060) for exception names that do not match any known feature gate.

### D7: TCP proxy PATH resolution

Replace the hardcoded `/app/node_modules/.bin/claude-flow` with:

```javascript
const cfBin = process.env.CLAUDE_FLOW_BIN || 'claude-flow';
const cfProcess = spawn(cfBin, ['mcp', 'start'], { ... });
```

This uses PATH resolution, which works in both Nix containers (where the binary is in the Nix store) and development environments (where it may be in `node_modules/.bin/`).

### D8: Error suppression triage

Adopt a three-tier error handling policy for all `|| true` and empty `catch` patterns:

| Tier | Criteria | Action |
|------|----------|--------|
| **Fail-fast** | Operation is a prerequisite for the feature (volume restore, directory creation for audit logs) | Remove suppression; let the error propagate; log clearly; set container unhealthy if in entrypoint |
| **Warn-and-continue** | Operation is best-effort but degradation should be visible (git pull, npm install, model probe) | Log a warning with the error code; set a degraded status flag; continue |
| **Suppress** | Operation is cosmetic or cleanup (process termination, temp file deletion) | Keep `|| true` or empty catch; no change needed |

The 36 critical findings move to fail-fast. The 87 moderate findings move to warn-and-continue. The 84 low findings remain suppressed.

## Consequences

### Positive

- Code-as-Harness audit trail becomes functional (currently 100% data loss)
- Payment enforcement restored on GPU-metered endpoints
- Operators can safely use the TUI wizard without losing advanced configuration
- Swarm state survives MCP restart
- NIP-17 DMs become readable in pod inbox
- New `[security.exceptions.*]` sections work without Nix code changes
- TCP proxy becomes functional in Nix containers

### Negative

- Fail-fast error handling in the entrypoint will surface previously hidden failures. Operators who were unaware of silent degradation may see containers fail to start until they fix their mount configuration. This is the correct behaviour but may be perceived as a regression.
- Dual-write in swarm tools adds latency (~5-20ms per operation for the management API round-trip). Acceptable for orchestration operations that are not in the hot path.
- NIP-17 decryption requires nsec access in the inbound path, expanding the trust boundary of the relay consumer process. The nsec is already stored in the pod's identity volume; this change reads it, not creates it.

### Risks

- `tomlkit` is a new dependency for the wizard. If it is unavailable in the Nix build, fall back to the merge-dict approach with `tomllib` (read) + manual emission (write), preserving unknown sections as raw strings.
- The dynamic exception filter accepts any exception name, which could lead to operator typos creating silently inert exceptions. The W060 validator warning mitigates this.

## Finding Manifest

| # | Finding | File(s) | Lines | Severity | Fix (Decision) |
|---|---------|---------|-------|----------|----------------|
| 1 | pip install targets immutable Nix store | `mcp/code-interpreter/server.py` | 626-630 | P1 | D1 |
| 2 | Payment/cost gate middleware unwired | `management-api/middleware/payment-gate.js`, `cost-gate.js`, `server.js` | — | P0 | D2 |
| 3 | Webhook HMAC fail-open | `management-api/routes/git-bridge.js` | 678-684 | P1 | D2 |
| 4 | NIP-17 DMs stored encrypted | `mcp/nostr-bridge/relay-consumer.js` | 485-506 | P2 | D4 |
| 5 | Admin suspend/archive 501 stubs | `management-api/routes/admin-users.js` | 229-259 | P2 | Out of scope (deferred to post-alpha.15) |
| 6 | TUI wizard wipes advanced TOML | `scripts/tui-write-manifest.py` | — | P1 | D5 |
| 7 | Code-as-Harness EROFS | `mcp/code-interpreter/server.py`, `mcp/aci-shell/server.js` | 85-88, 60 | P1 | D1 |
| 8 | Consultant volume never mounted | `flake.nix` | 1533-1547 | P1 | D1, D6 |
| 9 | Swarm state volatile | `mcp/servers/mcp-server.js`, `mcp/memory/fallback-store.js` | 1257-1264, 8-10 | P1 | D3 |
| 10 | TCP proxy ENOENT | `mcp/scripts/claude-flow-tcp-proxy.js` | 76 | P2 | D7 |
| 11 | 36 critical silent error suppressions | Multiple (see audit) | — | P1 | D8 |
| 12 | 87 moderate silent error suppressions | Multiple (see audit) | — | P2 | D8 |
