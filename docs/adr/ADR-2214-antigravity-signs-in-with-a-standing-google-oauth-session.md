---
id: ADR-2214
title: Antigravity signs in with a standing Google OAuth session
date: 2026-11-22
decision_status: accepted
implementation_status: partial
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: [flake.nix, docker-compose.yml, agentbox.toml, scripts/provision-antigravity.cjs, mcp/consultants/antigravity/server.js, config/entrypoint-unified.sh, skills/mcp.json, tests/config/antigravity-provision.test.cjs, tests/config/antigravity-consultant-auth.test.cjs, tests/config/compose-persistence.test.cjs]
owner: jjohare
review_trigger: an agy upgrade that moves its token or changes refresh behaviour, a change to the ~/.gemini mount, or a return to API billing
repo: agentbox
domain: BASELINE-container
evidence_class: source+test
acceptance_boundary: Offline provisioning and consultant tests pass and agy 1.5.13 was exercised by hand with token-only homes. The rebuild, the post-rebuild sign-in, a restart that keeps it, and the host-only compose persistence gate are not yet run.
---

# ADR-2214 — Antigravity signs in with a standing Google OAuth session

## Context

`agy` (Antigravity CLI 1.5.13) keeps all of its state, including the Google
OAuth token (`antigravity-cli/antigravity-oauth-token`), in `~/.gemini`. It has
no environment override for that path. `~/.gemini` was a 256M tmpfs, so a sign-in
lasted only until the next boot, and `[providers.gemini].auth_mode = "api_key"` made
the session and the consultant bill the Gemini API. Measured on 2026-11-22: with
`modelProvider` unset, `agy` authenticates from the token file alone and ignores
`GEMINI_API_KEY`. A home with the key and no token fails with "authentication
failed". `--model gemini-4-hydrogen` resolves under OAuth with no custom model entry.

## Decision

- `~/.gemini` is the named volume `agentbox-antigravity-state`, following the
  ADR-2147 Codex pattern. It is not tmpfs.
- `[providers.gemini].auth_mode = "oauth"` is the standing method. `GEMINI_API_KEY`
  stays set for other Gemini clients.
- In oauth mode, boot (`provision-antigravity.cjs`) removes only the api_key
  projection, `modelProvider: "gemini"` and the `gemini-api://` Hydrogen entry, so
  a provider written by an earlier boot cannot persist on the volume and override
  the sign-in. It never reads or writes the token.
- Boot exports `AGENTBOX_ANTIGRAVITY_AUTH_MODE` before the MCP projector expands
  the consultant's env. Under `oauth` the consultant passes no key and no
  `--settings`. Before each call it **copies**, never links, the primary token into
  its own tmpfs home, and re-copies when the primary is newer. The consultant
  therefore never writes the only persisted token. A refresh it performs stays
  local, and the refresh token in the primary file stays authoritative.
- `gemini` joins the OAuth-capable providers in the validator (W040) and the setup TUI.

## Consequences

- The first boot after the rebuild starts with an empty volume, so one sign-in is
  needed: run `agy`, choose Google OAuth, and paste back the code. The redirect
  goes to `antigravity.google`, not localhost, so the browser sidecar can complete
  it. After that the sign-in survives restarts and rebuilds.
- Usage counts against the signed-in Google account's subscription, not API
  billing. The consultant's `cost_estimate` stays an API-equivalent figure, as its
  source comment already says.
- `~/.gemini` logs, crash reports and conversations now grow on disk without the
  256M cap. Retention is follow-on work if the volume grows.
- The token grants `cloud-platform` scope and sits unencrypted, mode 0600, on a
  devuser-readable volume. It has the same custody class as Codex's `auth.json`.
- Setting `auth_mode = "api_key"` restores API billing on the next boot.
- `scripts/activation/flake-update-rehearsal.host.sh` still mounts `~/.gemini` as
  tmpfs for its throwaway rehearsal container. That is intended.

## Verification

- `node --test tests/config/antigravity-provision.test.cjs tests/config/antigravity-consultant-auth.test.cjs`
  passes: oauth clears only the projection, keeps operator settings and the token,
  is idempotent, and the export precedes the projector. The consultant passes no
  key under oauth and copies the token without linking.
- Manual check on 2026-11-22, agy 1.5.13: a token-only home with the keys set
  answered (T1, T2); a key-only home failed (T3); a symlinked token was read and
  left the target unchanged.
- Pending: host `tests/config/compose-persistence.test.cjs`, the rebuild, one
  sign-in, then a container restart with no new login. Check the session `agy`,
  consultant `health`, and that the consultant's process has no `GEMINI_API_KEY`.
