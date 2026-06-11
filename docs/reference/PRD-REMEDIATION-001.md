# PRD-REMEDIATION-001: Default-Secure Posture Remediation

**Status:** Shipped (Phase 0–4, 2026-06-11)
**Date:** 2026-06-11
**Repo:** [github.com/DreamLab-AI/agentbox](https://github.com/DreamLab-AI/agentbox)
**Commits:** `3eee9b37` (infra), `971d06eb` (net), `0bfa856c` (boot), `4ea1c9ee` (cleanup), `2d9f130c` (mcp)
**Related:** ADR-027 (Default-secure posture and runtime-isolation roadmap), DDD-013 (Hardening boundary domain), ADR-007 (Runtime contract and container hardening), ADR-022 (Runtime integrity hardening), ADR-008 (Privacy filter routing), ADR-015 (MCP RuVector mandate), PRD-003 (Runtime contract), PRD-010 (Runtime integrity)

## TL;DR

A second-pass security audit of agentbox found that several hardening claims were aspirational rather than enforced: published ports reached the host network, WS auth defaulted off, the zai wrapper ran with `--dangerously-skip-permissions`, a runtime privilege-escalation path survived in the entrypoint, and the Nostr bridge private key lived in process env. This remediation closes those gaps and **trues up the documentation to match the enforced reality**. Every finding here is shipped as of `2026-06-11`; the deferred items are explicitly scoped at the end with their owning IDs.

The product requirement is a *default-secure posture*: a freshly booted agentbox, with no operator tuning, must publish nothing to the network, authenticate every cross-container call, escalate no privileges at runtime, and keep secrets out of long-running process environments.

---

## 1. Scope

This remediation covers five surfaces and one documentation surface:

1. **Network edge** — host port publication, WS/management/zai authentication defaults.
2. **Boot/runtime shell** — privilege model, secret materialisation, workspace authority, npm-at-boot removal.
3. **MCP memory** — shared memory-tools extraction without backend behaviour change (ADR-015 store is load-bearing).
4. **Telemetry vs. control** — task-input regex demoted from a control to telemetry; one metrics registry.
5. **Defence-in-depth** — `sandbox_check.py` hardened while the container runtime remains the real boundary.
6. **Truth-up (R-040)** — README and developer docs corrected where they oversold the posture.

Out of scope: new adapter slots, new Nostr kinds, ComfyUI integration (applied separately under `docs/integration/comfyui/`), and the runtime-isolation migration for the code interpreter (proposed in ADR-027, deferred below).

---

## 2. Findings addressed

Findings are grouped by severity. IDs carry their audit-track prefix: `R-` (remediation), `SEC-` (security), `ARC-` (architecture), `BLD-` (build), `OPS-` (operations).

### S1 — Default-insecure runtime (highest)

| ID | Finding | Resolution | Commit |
|----|---------|------------|--------|
| **R-003** (host) | All published ports bound `0.0.0.0` → reachable on the host network. | All 7 published ports now bind `127.0.0.1:<p>:<p>` (host-loopback only). Access is via SSH tunnel (`agentbox.sh api`/`vnc`/`code`). In-container service `HOST`s stay `0.0.0.0` because Docker publish requires it; cross-container reach is token-gated. | `3eee9b37` |
| **R-003** (auth) | WS auth defaulted **off**; enabled-but-no-token passed through. | WS auth flips to **default-ON** (`WS_AUTH_ENABLED !== 'false'`) and is **fail-closed** when enabled with no token. All three token checks (WS auth-middleware, management bearer, zai wrapper) use `crypto.timingSafeEqual` over equal-length buffers. Fixed a latent broken `require` in `mcp-ws-relay` so the gate is actually honoured. | `971d06eb` |
| **R-004** | zai wrapper ran `--dangerously-skip-permissions` and required no token. | zai wrapper now **requires a bearer token** (401 when unset/mismatched) and runs an `--allowedTools` allowlist (`ZAI_ALLOWED_TOOLS`). A `ZAI_DANGEROUS=true` escape hatch exists, default off and loud. | `971d06eb` |
| **R-005 / SEC-001** | Runtime privilege-escalation path: setuid sudo wrapper + redundant runtime `chown`. | **No runtime privilege escalation.** The setuid sudo wrapper (`sudoNoPam` + `chmod 4755`) is removed from the flake; redundant runtime `sudo chown` calls removed. `no-new-privileges:true` kept. `SETUID`/`SETGID` **remain** in `cap_add` — supervisord (root PID 1) needs them to *drop* `user=devuser` children; gaining privilege is still blocked by `no-new-privileges` + the absence of any setuid binary (AC-4 amendment 2026-06-11). Root only at boot. | `3eee9b37`, `0bfa856c`, `b251f440` |
| **SEC-003** | Nostr bridge private key lived in `AGENTBOX_BRIDGE_SK` process env. | Decrypted key is written to `/run/secrets/nostr.key` (tmpfs, `0400 devuser`); `AGENTBOX_BRIDGE_SK` is unset before `exec supervisord`. `nostr-pod-bridge` reads `AGENTBOX_BRIDGE_SK_FILE` first (default `/run/secrets/nostr.key`), env fallback only, hex zeroized after parse. | `0bfa856c` |

### S2 — Reproducibility and integrity

| ID | Finding | Resolution | Commit |
|----|---------|------------|--------|
| **R-002** (pg) | Entrypoint ran `npm install pg` at boot — a mutable network step. | `AGENTBOX_PG_NODE_PATH=/opt/agentbox/management-api/node_modules` is baked; the entrypoint sets `NODE_PATH` from it instead of installing. Install path remains only as an explicit, documented fallback. | `3eee9b37`, `0bfa856c` |
| **R-024** | Literal `ruvector` DB-password default. | Removed. Compose now uses `${RUVECTOR_PG_PASSWORD:?...}` — **fails loudly** if unset. | `3eee9b37` |
| **R-011** | Two Prometheus registries; double `collectDefaultMetrics`. | Consolidated to one registry (`observability/metrics.js`); `utils/metrics.js` re-exports it; exactly one `collectDefaultMetrics`. | `971d06eb` |
| **ARC-001** | `ruvector-mcp.cjs` and `mcp-server.js` duplicated the four memory-tool names with divergent backends. | Extracted `mcp/servers/lib/memory-tools.js` (`createMemoryTools({backend, deps})`). This is an **extraction, not a merge**: ruvector behaviour is byte-identical (10/10 shape test, verbatim SQL, same fail-closed-on-no-pg). | `2d9f130c` |
| **ARC-002** | GPU UUID hardcoded in overlays. | `${NVIDIA_VISIBLE_DEVICES:-all}` in both overlays. | `3eee9b37` |
| **R-013, R-020, R-027, R-030** | Dead code, duplicate test tree, orphan registry, placeholder governance hash. | Legacy agent-event-bridge import retired (route repointed to ws-subscriber; bridge file retained as an out-of-scope conformance fixture); self-nested duplicate test tree deleted; orphan `mcp-full-registry.json` deleted; `mcp.json` marked canonical; placeholder governance hash flagged `"_fixture":true`. | `4ea1c9ee` |

### S3 — Telemetry, defence-in-depth, build hygiene

| ID | Finding | Resolution | Commit |
|----|---------|------------|--------|
| **R-010** | `SUSPICIOUS_TASK_PATTERNS` regex treated as a security control. | Renamed `TASK_TELEMETRY_PATTERNS`; `validateTaskInput` now blocks only on length + control-char sanity. Shell-pattern matching is **telemetry, not a control** — the real boundary is the argv array (no `shell:true`) plus the tool allowlist. | `4ea1c9ee` |
| **SEC-002 / R-044** | `sandbox_check.py` framed as a sandbox. | Indirection escapes (`getattr`/`__import__`/`eval`/`exec`/`sys.modules`) promoted to hard errors; strict-network default `0 → 1`; docstring states it is **defence-in-depth** — the container runtime is the real boundary. | `971d06eb` |
| **R-025** | claude-flow/zai provider baked a non-existent sidecar host. | Requires `ZAI_CONTAINER_URL`/`ZAI_ENABLED`; fails with a clear message instead. | `4ea1c9ee` |
| **R-012** | `WORKSPACE` re-defaulted in multiple places. | Set authoritatively to `/home/devuser/workspace` in Phase 1 with a tmpfs/overlay boot assertion; downstream re-defaults removed. | `0bfa856c` |
| **R-028** | Indirect `eval val=\$$var`. | Replaced with `${!var}`; remaining evals audited (fixed-literal inputs, commented). | `0bfa856c` |
| **R-015, R-043** | `gum` bootstrap download path unpinned; banner misaligned. | `_bootstrap_gum` prefers `nix run nixpkgs#gum`; download fallback verifies a pinned SHA-256 (digests are placeholders pending the download path being used — nix path is taken first). Banner realigned to 40 cols. | `0bfa856c` |
| **BLD-002** | Stale `fakeHash` comment implied unfinished SRI hashes. | Comment corrected — hashes are already real SRI. | `3eee9b37` |

---

## 3. What was done vs. deferred

### Done (this remediation)

All S1, S2, and S3 findings above are shipped across the five commits.

### Deferred (with owning ID and reason)

| ID | Deferred item | Reason | Unblocks when |
|----|---------------|--------|---------------|
| **R-016** | `flake.lock` update | Requires a networked Nix host. | A build host with network access runs `nix flake update`. |
| **R-002** (remainder) | `npx -y` CLI SRI pinning in `lib/npm-cli.nix` | The `pg` module is baked, but several CLI aliases still resolve via `npx -y` at first use. This is the one remaining mutable-fetch path. | The `npx -y` aliases are replaced with SRI-pinned Nix derivations. TODO in `lib/npm-cli.nix`. |
| **R-021** | Flake split (modularising the monolithic `flake.nix`) | Structural refactor; orthogonal to security posture. | Scheduled as a standalone refactor PR. |
| **SEC-002** (full) | Full gVisor/WASI runtime isolation for the code interpreter | `sandbox_check.py` is defence-in-depth only; true isolation needs a runtime swap. Proposed in **ADR-027**. | The runtime-isolation migration in ADR-027 is accepted and a runtime (gVisor `runsc` or a WASI sandbox) is wired into the code-interpreter MCP. |

The `npx -y` remainder is a **documented reproducibility caveat**, not a hidden gap: the README's "zero mutable `npm install`" claim is corrected to name it (R-040).

---

## 4. Acceptance criteria

1. **No host-network port.** `docker inspect` shows every entry in `HostConfig.PortBindings` bound to `127.0.0.1`. **Test:** `RM-001-01` — assert no `0.0.0.0` host binding in compose `config` output.
2. **WS auth fails closed.** With `WS_AUTH_ENABLED` unset and no token configured, a WS connect attempt is rejected; with a valid token it succeeds. **Test:** `RM-001-02`.
3. **zai wrapper requires a token and runs an allowlist.** Unset/mismatched bearer → 401; a tool outside `ZAI_ALLOWED_TOOLS` is refused; `--dangerously-skip-permissions` does not appear in the spawned argv unless `ZAI_DANGEROUS=true`. **Test:** `RM-001-03`.
4. **No runtime privilege escalation.** `docker inspect` shows `SecurityOpt` contains `no-new-privileges:true`; no setuid binary on `PATH` for `devuser`. `HostConfig.CapAdd` contains both `SETUID` and `SETGID` — required by supervisord (root PID 1) to *drop* children to `devuser`; privilege *gaining* stays blocked by `no-new-privileges` + absence of setuid binaries (ADR-027 D3 amendment, 2026-06-11). **Test:** `RM-001-04`.
5. **Secret not in env.** `docker exec agentbox cat /proc/<bridge-pid>/environ` contains no `AGENTBOX_BRIDGE_SK`; `/run/secrets/nostr.key` exists, mode `0400`, owner `devuser`, on a tmpfs mount. **Test:** `RM-001-05`.
6. **DB password fails loud.** `docker compose config` with `RUVECTOR_PG_PASSWORD` unset errors before any container starts. **Test:** `RM-001-06`.
7. **No `npm install` at boot for pg.** Boot logs contain no `npm install pg`; `NODE_PATH` resolves to `$AGENTBOX_PG_NODE_PATH`. **Test:** `RM-001-07`.
8. **One metrics registry.** Exactly one `collectDefaultMetrics` invocation across the management API; `/metrics` exposes a single coherent registry. **Test:** `RM-001-08`.
9. **MCP memory behaviour unchanged.** The ruvector memory-tools shape test passes 10/10 after the extraction. **Test:** `mcp/servers/lib/memory-tools.test.js`.
10. **Docs match enforced reality.** README claims for seccomp posture, "zero mutable npm install", and the privacy-filter scope match the committed code (R-040). **Test:** manual doc review against `config/seccomp-agentbox.json`, `lib/npm-cli.nix`, and `docs/reference/adr/ADR-008-privacy-filter-routing.md`.

---

## 5. Phasing (as shipped)

| Phase | Surface | Commit |
|-------|---------|--------|
| 0/1 | Infra: loopback publish, seccomp truth-up, drop setuid caps (later restored — see AC-4 amendment / `b251f440`), fail-loud DB password, bake pg path | `3eee9b37` |
| 0/1 | Net: auth default-on, fail-closed, timing-safe, zai allowlist, one metrics registry | `971d06eb` |
| 0/1/4 | Boot: key→tmpfs file, single WORKSPACE, drop runtime sudo, pinned gum | `0bfa856c` |
| 2 | Cleanup: dead code, duplicate test tree, orphan registry, demote task regex | `4ea1c9ee` |
| 3 | MCP: extract shared memory-tools module (byte-identical ruvector) | `2d9f130c` |
