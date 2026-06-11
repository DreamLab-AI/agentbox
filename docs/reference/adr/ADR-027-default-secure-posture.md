---
id: ADR-027
title: Default-secure posture and runtime-isolation roadmap
status: accepted (S1–S3 realised 2026-06-11; gVisor/WASI migration proposed)
date: 2026-06-11
type: security
author: Dr John O'Hare
depends_on: [ADR-005, ADR-007, ADR-008, ADR-015, ADR-022]
review_trigger: a new published port is added; the code-interpreter runtime changes; the privacy-filter default policy changes; or a runtime-isolation sandbox (gVisor/WASI) is wired in
---

# ADR-027 — Default-secure posture and runtime-isolation roadmap

**Related:** PRD-REMEDIATION-001 (product record), DDD-013 (Hardening boundary domain), ADR-007 (Runtime contract and container hardening), ADR-008 (Privacy filter routing), ADR-015 (MCP RuVector mandate), ADR-022 (Runtime integrity hardening)

## TL;DR for newcomers
*Skip if you already know why agentbox publishes nothing and escalates nothing.*

A second-pass audit found that agentbox's hardening was partly aspirational: ports reached the host network, WS auth defaulted off, the zai wrapper ran with permission-skipping on, a runtime privilege-escalation path survived, and the Nostr bridge key lived in process env. This ADR records the load-bearing decisions that close those gaps and sets the posture going forward: **publish to loopback only, authenticate by default, escalate no privileges at runtime, and keep secrets in tmpfs files, not env.** It also records the *proposed* next step — migrating the code interpreter from a Python `sandbox_check` (defence-in-depth only) to a real runtime sandbox (gVisor or WASI). The implementation lives in commits `3eee9b37`, `971d06eb`, `0bfa856c`, `4ea1c9ee`, `2d9f130c`.

**If you remember only one thing:** the container is the security boundary; everything inside it is defence-in-depth, the network edge is loopback-published and auth-default-on, and no runtime step gains privilege.

For the deep version, keep reading.

## Context

ADR-007 established the runtime contract (read-only root, `cap_drop: ALL`, uid 1000, `no-new-privileges:true`). ADR-022 closed integrity gaps where declared features silently produced no output. Neither fully closed the *network edge and privilege* surface, and the README oversold what was actually enforced.

The audit produced findings across three severity bands (S1 default-insecure runtime, S2 reproducibility/integrity, S3 telemetry/defence-in-depth). The full manifest is in PRD-REMEDIATION-001 §2. This ADR captures only the decisions that are load-bearing — the ones a future change could regress.

Two framing tensions drive the decisions:

1. **Docker publish vs. process loopback.** A service can be loopback-only at the *process* level (bind `127.0.0.1` inside the container) or at the *host-publish* level (`127.0.0.1:<p>:<p>` in compose). Process-loopback breaks cross-container reach (other compose services can't connect); host-loopback keeps in-container `0.0.0.0` binds working while removing the port from the host network.
2. **Sandbox vs. boundary.** A Python `sandbox_check` over AST/builtins can catch obvious indirection but cannot contain arbitrary native code. The container runtime is the only real boundary; calling the Python check a "sandbox" invited misplaced trust.

## Decision

### D1: Loopback host-publish + auth-default-on, over process-loopback

All 7 published ports bind `127.0.0.1:<p>:<p>` on the host. In-container service `HOST`s stay `0.0.0.0` (Docker publish requires it) but are now token-gated. We chose **host-loopback publish + per-service auth** over **process-loopback binds** because process-loopback would break legitimate cross-container dispatch (management-api → solid-pod-rs, MCP relays) while host-loopback removes the port from the host network without touching the container's internal mesh.

WS authentication flips to **default-ON** (`WS_AUTH_ENABLED !== 'false'`) and is **fail-closed** when enabled with no token. All three token comparisons (WS auth-middleware, management bearer, zai wrapper) use `crypto.timingSafeEqual` over equal-length buffers. Access from outside the host is the SSH-tunnel model (`agentbox.sh api`/`vnc`/`code`), consistent with ADR-007's hardening baseline.

*Rationale:* default-off auth on a loopback-published port is still reachable by any other container on the shared Docker network. Auth-default-on closes the cross-container gap that loopback publish alone does not.

### D2: Supplemental seccomp **denylist**, not a replacement allowlist

`config/seccomp-agentbox.json` is, and remains, an **allow-by-default supplemental denylist** (`defaultAction: SCMP_ACT_ALLOW`) layered *conceptually on top of* Docker's own default profile. It adds AF_ALG socket blocking (CVE-2026-31431, "Copy Fail") plus a set of high-risk syscalls — 47 denials total. It is **not** a replacement allowlist and is **not** a complete sandbox on its own.

A replacement allowlist was **rejected deliberately**: the workload surface (Chromium, CUDA, Godot) is too wide to enumerate safely without breakage. The denylist narrows the syscall surface while keeping the broad runtime working, and earns its security only in combination with `cap_drop: ALL`, read-only root, uid 1000, and `no-new-privileges:true`.

*Rationale:* the previous README framed this as a "tightened profile", implying allowlist-grade containment. That oversold the guarantee. The honest statement is: supplemental denylist, defence-in-depth, container is the boundary.

### D3: No runtime privilege escalation (amended 2026-06-11)

**As amended:** `SETUID`/`SETGID` **stay in `cap_add`** (flake `baselineCapAdd` and compose); `no-new-privileges:true` is kept; the setuid sudo wrapper and redundant runtime `sudo chown` calls are removed from the entrypoint. **Root exists only at boot** (supervisord PID 1 performs the one-shot bootstrap); every long-running supervised process drops to `devuser`, and there is no setuid path back to root.

*Rationale:* a runtime escalation path defeats `cap_drop: ALL` — if a process can re-acquire privilege after the boot phase, the dropped capabilities are theatre. The escalation path is closed by `no-new-privileges:true` plus the absence of any setuid binary, not by the capability bounding set.

**Amendment (2026-06-11):** the original decision also removed `CAP_SETUID`/`CAP_SETGID` from `cap_add`, on the reasoning that `no-new-privileges:true` made them dead weight. That reasoning conflated privilege *gaining* with privilege *dropping*: `no-new-privileges` neuters setuid file bits at execve, but supervisord (root PID 1) still needs `CAP_SETGID`/`CAP_SETUID` to call `setgroups()`/`setuid()` when demoting `user=devuser` children. With the caps dropped, every supervised program exited 127 (`couldn't setuid to 1000`) and the container never became healthy. The caps are restored; the no-escalation guarantee is unchanged because gaining privilege still requires a setuid binary (none exists) and `no-new-privileges` blocks that path categorically. `scripts/ci/check-nnp.sh` now enforces the *presence* of both caps alongside `no-new-privileges:true`.

### D4: Secret via tmpfs file, not env

The decrypted Nostr bridge private key is written to `/run/secrets/nostr.key` (tmpfs, `0400 devuser`). `AGENTBOX_BRIDGE_SK` is **unset before `exec supervisord`**, so the key never enters any long-running process environment. `nostr-pod-bridge` reads `AGENTBOX_BRIDGE_SK_FILE` first (default `/run/secrets/nostr.key`), with env as a fallback only; the hex is zeroized after parse.

*Rationale:* process env is readable via `/proc/<pid>/environ`, leaks into child processes, and is captured by crash dumps and observability. A `0400` tmpfs file scoped to `devuser` is the narrowest materialisation that the bridge can still read.

### D5: gVisor/WASI runtime isolation for the code interpreter (proposed)

`mcp/code-interpreter/sandbox_check.py` is hardened — indirection escapes (`getattr`/`__import__`/`eval`/`exec`/`sys.modules`) are now hard errors and strict-network defaults on — but it is **defence-in-depth, not a sandbox**. The real boundary remains the container.

**Proposed:** migrate the code-interpreter (and ACI shell) execution to a true runtime sandbox — gVisor (`runsc`) or a WASI runtime — so untrusted generated code is contained at the syscall layer, not by an AST walk. Status: **proposed**, deferred under PRD-REMEDIATION-001 §3 (SEC-002 full). Acceptance is gated on the runtime being wired into the code-interpreter MCP and the contract-test harness passing for all three adapter implementation classes.

*Rationale:* code-as-harness (PRD-008) executes model-generated code. An AST check is necessary signal but insufficient containment. The container boundary holds today; a per-execution sandbox would let a single compromised execution be contained without restarting the container.

## Consequences

### Positive
- A freshly booted agentbox publishes nothing to the host network and authenticates every cross-container call.
- The seccomp guarantee is now stated truthfully; future readers won't over-trust it.
- `cap_drop: ALL` is no longer undermined by a runtime escalation path.
- The bridge key is invisible to `/proc`, child processes, and observability.

### Negative
- Auth-default-on means an operator who forgets to provision a token gets a fail-closed 401/refused connect rather than silent passthrough. This is correct but will surface as "it stopped working" for setups that relied on the old default-off behaviour.
- The proposed gVisor/WASI migration (D5) adds a runtime dependency and per-execution overhead; it is deferred precisely because it is not free.

### Risks
- The `gum` download fallback and the `npx -y` CLI aliases remain mutable-fetch paths (R-015, R-002 remainder). Documented as caveats; the nix-first path is taken by default. Regression risk if the download/`npx` path becomes the primary path without SRI pinning.

## Executable invariants

These are the §6-style executable invariants this ADR commits to — each maps to an acceptance test in PRD-REMEDIATION-001 §4 and a DDD-013 invariant.

| # | Invariant | Enforced by | Test |
|---|-----------|-------------|------|
| EI-1 | No `HostConfig.PortBindings` entry binds anything but `127.0.0.1`. | compose host-publish | RM-001-01 |
| EI-2 | WS auth, when enabled with no token, rejects the connection (fail-closed). | `auth-middleware`, `mcp-ws-relay` | RM-001-02 |
| EI-3 | The zai wrapper spawns no `--dangerously-skip-permissions` argv unless `ZAI_DANGEROUS=true`, and 401s without a bearer token. | `claude-zai/wrapper/server.js` | RM-001-03 |
| EI-4 | `CapAdd` contains both `SETUID` and `SETGID` (supervisord privilege-drop path); `SecurityOpt` contains `no-new-privileges:true`; no setuid binary on `devuser` PATH (amended 2026-06-11). | flake `baselineCapAdd`, compose, `check-nnp.sh` | RM-001-04 |
| EI-5 | `AGENTBOX_BRIDGE_SK` is absent from every long-running process env; `/run/secrets/nostr.key` is `0400 devuser` on tmpfs. | entrypoint, `nostr-pod-bridge` | RM-001-05 |
| EI-6 | `docker compose config` fails when `RUVECTOR_PG_PASSWORD` is unset. | compose `${VAR:?}` | RM-001-06 |
| EI-7 | The seccomp profile's `defaultAction` is `SCMP_ACT_ALLOW` (denylist) and the file's own comment states it is supplemental, not a replacement allowlist. | `config/seccomp-agentbox.json` | doc/file review |

## Alternatives considered

- **Process-loopback binds (bind `127.0.0.1` inside the container).** Rejected: breaks cross-container dispatch. Host-loopback publish + auth achieves the same external-exposure goal without breaking the internal mesh.
- **Replacement seccomp allowlist.** Rejected: the Chromium/CUDA/Godot syscall surface is too wide to enumerate without breakage. (D2.)
- **Keep the key in env but redact it from observability.** Rejected: `/proc/<pid>/environ` and child-process inheritance still leak it. A tmpfs file is the narrower materialisation. (D4.)
- **Treat `sandbox_check.py` as the sandbox.** Rejected: an AST walk cannot contain native code. The container is the boundary; a real runtime sandbox is the proposed path. (D5.)
