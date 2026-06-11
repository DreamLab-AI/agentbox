# Rebuild Brief — Agentbox Hardening Sprint (PRD-REMEDIATION-001)

**For:** the external rebuild agent (host shell)
**Repo state:** `DreamLab-AI/agentbox` @ `17321ddf` (main)
**Date:** 2026-06-11

A 7-commit security-hardening sprint just landed (both remediation PRDs merged into
`PRD-REMEDIATION-001`). This brief is everything needed to rebuild the image and bring
it up safely.

---

## Read first
1. [`docs/reference/PRD-REMEDIATION-001.md`](docs/reference/PRD-REMEDIATION-001.md) — what changed, what's deferred, acceptance criteria (the one must-read).
2. [`docs/reference/adr/ADR-027-default-secure-posture.md`](docs/reference/adr/ADR-027-default-secure-posture.md) — *why* the defaults flipped (explains observed behaviour changes).
3. [`agentbox/CLAUDE.md`](CLAUDE.md) — canonical runtime-file map + commands.
4. The diff: `git log -p aea4704b..17321ddf` — the 7 sprint commits to validate against.

---

## Rebuild

```bash
./agentbox.sh rebuild      # then:
./agentbox.sh up
```

---

## ⛔ BUILD BLOCKER — set this FIRST or `up` aborts at compose interpolation

- **`RUVECTOR_PG_PASSWORD` must be set in `.env`.** R-024 made it `${RUVECTOR_PG_PASSWORD:?...}` —
  there is no longer a silent `ruvector` default; an unset value fails the compose `up` loudly.
- Confirm **`MANAGEMENT_API_KEY`** is set (required; also now backs the zai-wrapper token).
- Ensure the `.env` carries the previously-moved JunkieJarvis / xinference / relay vars
  (`JUNKIEJARVIS_ENABLED=true`, `NOSTR_RELAYS`, `ZAI_API_KEY`, etc.).

## ⚠ flake.nix not nix-validated in the authoring env

`flake.nix` was edited but **not** `nix-instantiate`-validated (no nix binary there) — it is
brace-balanced + content-checked only. If `nix build` / rebuild fails on flake **evaluation**,
that is the expected residual risk: **capture the exact error and report it; do not hand-patch
blindly.**

---

## Behaviour changes — defaults flipped secure (expect these; do NOT "fix" them)

- **Ports bind `127.0.0.1` only** → reach services via SSH tunnel (`agentbox.sh api|vnc|code`),
  not the host's external interface.
- **MCP WS auth defaults ON.** To restore the old open behaviour: `WS_AUTH_ENABLED=false`.
- **zai wrapper requires a bearer token** (`ZAI_WRAPPER_TOKEN`, falls back to `MANAGEMENT_API_KEY`)
  and runs an `--allowedTools` allowlist; `--dangerously-skip-permissions` is gated behind
  `ZAI_DANGEROUS=true` (default off).
- **No runtime sudo** (setuid wrapper removed, `no-new-privileges:true`). The Nostr bridge key
  is read from `/run/secrets/nostr.key` (tmpfs), not the process environment.

---

## Post-build verification — run the invariant checks (all must pass)

```bash
for c in scripts/ci/check-*.sh; do sh "$c" || echo "FAIL: $c"; done
node scripts/ci/check-single-metrics.js
```

Then confirm boot logs show:
- management-api up,
- `[junkiejarvis] watching …` + `[bridge] NIP-42 AUTH sent …`,
- `[xinference] Embedding verified …`.

---

## Deferred — do NOT attempt unless asked (need a networked Nix host)

| Item | ID |
|------|----|
| `flake.lock` update | R-016 |
| `npx -y` → SRI-pinned CLIs | R-002 (remainder) |
| `flake.nix` split into `lib/` | R-021 |
| Full gVisor/WASI sandbox for code-interpreter | SEC-002 (spec in ADR-027) |

The CI ratchet (`scripts/ci/check-no-npx-latest.sh`, baseline 27) enforces the `npx` count
only goes down over time.

## Other caveats

- **gum digests are placeholders** in `scripts/start-agentbox.sh` download-fallback; the
  `nix run nixpkgs#gum` path is taken first, so this only matters if that path fails.
- `sovereign-bootstrap.py` still writes the key to `/run/agentbox/identity.env` (which the
  entrypoint now scrubs before `exec supervisord`). A clean follow-up would have it write
  `/run/secrets/nostr.key` directly.

---

## The 7 commits

| Commit | Workstream |
|--------|-----------|
| `3eee9b37` | infra: loopback publish, seccomp truth-up, drop setuid caps, fail-loud DB password, bake pg path, GPU UUID param |
| `971d06eb` | network: auth default-on + timing-safe, zai allowlist, single metrics registry, sandbox hardening |
| `0bfa856c` | boot: key→tmpfs (SEC-003), single WORKSPACE, drop runtime sudo, pinned gum |
| `4ea1c9ee` | cleanup: dead code, duplicate test tree, orphan registry, task-regex→telemetry |
| `2d9f130c` | mcp: shared memory-tools module (ruvector behaviour byte-identical) |
| `d4ec42e4` | ci: 7 executable-invariant checks + workflow |
| `17321ddf` | docs: PRD-REMEDIATION-001 + ADR-027 + DDD-013 + README truth-up |
