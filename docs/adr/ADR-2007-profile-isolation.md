---
id: ADR-2007
title: Runtime isolation is profile-based (per-profile HOME + CLAUDE_CONFIG_DIR), not Linux pseudo-users
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 08e817f394a908264c378745193bf7a0bbf6ec0e
verified_paths: [config/harness-wrappers/zai.sh, config/harness-wrappers/openrouter.sh, config/harness-wrappers/_provider-url.sh, tests/security/provider-url-validation.test.sh]
owner: jjohare
review_trigger: A proposal to reintroduce Linux pseudo-user isolation as the primary model, or a harness wrapper omitting the redirect assertion
repo: agentbox
domain: BASELINE-container
lineage: legacy ADR-025 (multi-harness tmux architecture), supersedes ADR-028 (per-user agent fabric); PRD-021 N-01
---

# ADR-2007 — Runtime isolation is profile-based (per-profile HOME + CLAUDE_CONFIG_DIR), not Linux pseudo-users

## Context
Multiple harnesses (different providers/subscriptions) share one container and must not read each
other's settings or, worse, bill the wrong provider by inheriting the global `~/.claude`
`ANTHROPIC_BASE_URL`. Linux pseudo-users (`gemini-user`, `openai-user`, …) were the old isolation
model but added user-management complexity for no matching benefit under a single supervisord/tmux
runtime. A wrapper that silently launches against the wrong redirect is a mis-billing hazard, not
merely a config error. Prior state: ADR-025 (multi-harness tmux) superseding ADR-028 (per-user
fabric), with PRD-021 N-01 mandating the anti-mis-billing assertion.

## Decision
Session/harness isolation pins both `HOME` and `CLAUDE_CONFIG_DIR` to `$WORKSPACE/profiles/<slug>`
in each harness wrapper, so each harness reads its own `settings.local.json` (its own
`ANTHROPIC_BASE_URL` + token) and never the global `~/.claude`. Linux pseudo-user isolation is a dead
path and must not be reintroduced as the primary model. Each wrapper must hard-fail loudly (`_die`) if
the profile directory/settings are missing or the provider redirect is absent or off-target.
The redirect check parses and validates scheme, host and port rather than substring-matching the
hostname (`config/harness-wrappers/_provider-url.sh`). This
forecloses pseudo-user isolation and any wrapper that launches without asserting its redirect.

## Consequences
- Harnesses are isolated by directory, not by OS user — simpler under one supervisord/tmux runtime.
- Missing, off-target and spoofed redirects all fail at launch: suffix-domain, user-info, path-only,
  non-`https` and off-allow-list-port forms are each rejected by the shared parser.
- Cost: every harness needs a provisioned profile dir with a valid redirect; a missing/misconfigured
  profile is a hard launch failure by design, not a fallback to global config.

## Verification
Historical verification recorded implementation_status = complete at cbe7335b9.
The 2026-09-04 probe below narrows that claim and changes the status to partial.
`config/harness-wrappers/zai.sh` pins `HOME`/`CLAUDE_CONFIG_DIR` to `$WORKSPACE/profiles/zai`
(header :10-14), defines `_die` (:35), extracts and validates the `ANTHROPIC_BASE_URL` redirect
(:75-85) and fails on a missing dir/settings/redirect. `config/harness-wrappers/openrouter.sh`
mirrors this: profile pin at :10, `_die` at :34, redirect extraction/validation at :74-97.

**2026-09-05 re-verified at 08e817f39.** Governed paths changed by the ADR-2007 acceptance work recorded below: `config/harness-wrappers/_provider-url.sh` is new (+253) and both wrappers were rewritten to call it (+46/-15 each). The decision still holds and is now more strongly enforced than when it was written. Re-checked at HEAD: `config/harness-wrappers/openrouter.sh:130-131` and `config/harness-wrappers/zai.sh` pin `HOME` and `CLAUDE_CONFIG_DIR` to the profile dir; `_die` at `openrouter.sh:36` / `zai.sh:37`; the shared lib is sourced relative to `${BASH_SOURCE[0]}` with a readable-file precondition at `openrouter.sh:57-67` / `zai.sh:58-67`; the redirect gate is `provider_url_validate "$BASE_URL" "$EXPECT_HOST" "$PROVIDER_URL_ALLOWED_PORTS"` at `openrouter.sh:119-120`; `PROVIDER_URL_ALLOWED_PORTS` defaults to `443` at `_provider-url.sh:61` and `provider_url_validate` is defined at `:72`. The launch banner at `openrouter.sh:141` prints `scheme://host:port` and `auth=present`, never the token. Live run: `bash tests/security/provider-url-validation.test.sh` → **52 passed, 0 failed**. **Record correction made by this pass:** the Decision and Consequences text still asserted "the current off-target check is only substring matching" and "hostname-substring collisions can still pass". That is no longer true — `zai.sh:115` retains only a comment naming the *old* `case "$BASE_URL" in *"$EXPECT_HOST"*)` form as removed — so those two sentences have been corrected in place to match the code. `implementation_status` stays `complete`, consistent with the acceptance section's own status note. Commands: `git diff --stat 960394b145fc2f9ab1c3191b682f87079c712e9e..HEAD -- config/harness-wrappers/`, `grep -n 'provider_url_validate\|HOME=\|_die' config/harness-wrappers/*.sh`, `bash tests/security/provider-url-validation.test.sh`.

## Closeout extension — 2026-09-04

CP-01/04/08. Owner remains jjohare with runtime maintainers. Actual wrapper probes using temporary profiles and a stub claude accept wrong hosts containing the expected hostname as a substring. Directory/profile routing is implemented; exact provider validation is not.

**Acceptance condition:** parse and validate scheme, hostname and allowed port before launching; test suffix, user-info, path/query and malformed URLs. Verify effective settings without exposing credentials. Reopen on wrapper, provider or profile-provisioning changes. See the [profile/egress review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/runtime-egress-and-profiles.md) and [isolated receipt](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/runtime-egress-probes.json). No live provider was called.

## Acceptance progress — 2026-09-05

- **Implemented** — the substring check is gone from both wrappers. New shared
  parser `config/harness-wrappers/_provider-url.sh` exposes
  `provider_url_validate <url> <expected-host> [allowed-ports]` in pure bash (no
  jq/python/node, so it works in any boot context) and enforces: scheme MUST be
  `https`; the authority host — taken after stripping user-info, IPv6 brackets
  and the port — must equal the expected host exactly or be a dot-suffixed
  subdomain of it; user-info is refused outright (the diagnostic names the REAL
  host); the port defaults to 443 when absent and otherwise must be numeric, in
  range, and a member of the named allow-list constant `PROVIDER_URL_ALLOWED_PORTS`
  (= `443`); and malformed input (no scheme, empty/dot-edge/empty-label host,
  `https://`, `://x`, whitespace, control characters, `:` with no port, IP
  literals) is rejected. Both wrappers source the lib relative to
  `${BASH_SOURCE[0]}` (pure-bash dirname, so it needs no PATH) and keep the
  existing loud `_die` banner and `exit 1`. The launch banner now prints
  `scheme://host:port` plus whether the port was explicit — the auth token is
  never printed, not even a prefix or a length.
- **Tests and results** — new `tests/security/provider-url-validation.test.sh`
  (26 parser unit cases + 24 end-to-end wrapper cases across both wrappers,
  temporary WORKSPACE profiles and a stub `claude` on PATH exactly as
  `runtime-egress-probes.py` does, plus an explicit credential-leak assertion).
  `bash tests/security/provider-url-validation.test.sh` → **52 passed, 0 failed,
  exit 0**. Accepted: `https://openrouter.ai/api`, `https://sub.openrouter.ai/x`,
  explicit `:443`, `https://api.z.ai/api/paas/v4`, `https://z.ai/api`,
  `https://sub.z.ai/x`. Rejected with the banner on stderr and the stub never
  launched: suffix host (`openrouter.ai.example.invalid`,
  `api.z.ai.example.invalid`), user-info (`https://openrouter.ai@evil.invalid/`),
  path-only (`https://evil.invalid/openrouter.ai`), `http://`, `:8443`, no
  scheme, `https://`, empty, unrelated host. `bash -n` clean on all four shell
  files.
- **Receipts** — `docs/estate-closeout/2026-09-05/adr-2007-provider-url.json`
  (full stdout, exit codes, syntax-check results, source SHA-256s). No live
  provider was called; the fixture token is an invented literal.
- **Remaining** — the parser is DNS-name based by design: an IP-literal endpoint
  can never satisfy it, and no certificate/pinning check is attempted (TLS trust
  remains the client's). Widening `PROVIDER_URL_ALLOWED_PORTS` beyond 443, or
  adding a third provider wrapper, both re-open this record. Not exercised: a
  real launch against a live provider endpoint.
- **Status** — `implementation_status` returns to `complete`: the 2026-09-04
  narrowing to `partial` cited exactly one gap — substring-only host matching —
  and that gap is now closed and covered by an executable test. `verified_commit`
  is left as recorded; `activation_status` remains `live`.
- **Governed paths changed** — `config/harness-wrappers/_provider-url.sh` (new),
  `config/harness-wrappers/openrouter.sh`, `config/harness-wrappers/zai.sh`,
  `tests/security/provider-url-validation.test.sh` (new).
