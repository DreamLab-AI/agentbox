---
id: ADR-2093
title: Compact context by Jev judgement, verbatim, with email fenced out and a switch
date: 2026-09-18
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: d39db513159bf386a97f5aedc2c86ea49d0e168f
verified_paths: [lib/factrail.nix, config/entrypoint-unified.sh, lib/claude-code-binary.nix]
owner: jjohare
review_trigger: the first measured residency bill that exceeds the summary path's re-read savings, a Claude Code function-hook API change, a request to fence a class other than email, or a change to ADR-2121 (its implementation)
repo: agentbox
---

# ADR-2093 — Compact context by Jev judgement, verbatim, with email fenced out and a switch

## Re-verification — 2026-10-02 at caab741c6 (factrail landing anchor)

Anchored to the landing of ADR-2121 (`b7fc2b0e5`, wording follow-up `caab741c6`). Every governed path above is as verified in ADR-2121's Verification section; nothing else changed. Image build, boot and the residency soak remain unverified (`activation_status: staged`).

## Implementation moved — 2026-10-02: see ADR-2121

The policy below (Jev judgement, verbatim, email fenced out, a switch, ADR-2094's local
relaxation and the 2026-09-25 / 2026-10-01 amendments' trigger, hysteresis and redaction
rules) stands. Its implementation is now factrail, baked at a pinned commit, recorded in
[ADR-2121](ADR-2121-factrail-implements-jev-compaction.md). ADR-2121 also retires
`min_reduction_ratio` and changes what an email-fenced session gets on a cloud judge (local
fact rails instead of the built-in summary). The vendored plugin, `hooks/policy.mjs`,
`hooks/redact.mjs` and their tests named in the sections below are deleted; read those
sections as the history of the rule.

## Re-verification — 2026-10-01 (dependency refresh)

Plugin 0.2.0 adds main-loop scope, a bounded deadline and request redaction; minimum estimated reduction is now 0.55. Claude 2.1.285 validates the manifest/hooks and passes all 15 engine tests. Pure policy/redaction tests also pass. Sticky email taint remains enforced; no real compaction or secret-bearing request was sent.
Source anchor: `bce906199`. Existing status axes and deferred
work remain unchanged; this source/test receipt is not a new activation claim.

## Re-verification — 2026-09-29 (instruction-home migration)

The plugin digest/config reconciliation, disabled path and stable /opt paths remain intact; the changed cache comment now correctly describes persistent container-owned state. The Jev policy fixtures pass, including sticky email taint, local-backend handling and cache-warm behavior. No live transcript was compacted. Verification anchor: `526b97dc6`. Status axes are unchanged by this source check.

## Context

Claude Code compaction summarises old turns; a summary loses file paths, exact errors and
constraints that matter later. `tamaratran/fast-jev-compaction` (MIT) replaces the summary
with Jev decisions — two Noul questions per old tool call, drop or truncate only what Jev
lets go, never rewrite text — and falls back to the summary on any error or <25% reduction.
Evaluated 2026-09-18 (`skills/system-one/references/estate-integration.md` §8): Jev cost
≈ $0.005 per compaction; the verbatim-kept context ≈ $14–18 per busy agent-hour in cache
reads against the summary. Two blockers: the image's Claude Code 2.1.257 has no function
hooks (2.1.274+), and the plugin sends the whole transcript, beyond ADR-2090's routing-only
egress. The operator's decision: proceed, with email always fenced out and a switch.

## Decision

1. **Claude Code is pinned at 2.1.291** (`lib/claude-code-binary.nix:35`), retaining
   the function-hook surface (`session.compact`, `command.register`, `$.http.fetch`).
2. **The plugin is ours, the library is theirs.** `config/claude-plugins/jev-compaction`
   vendors upstream `src/` at `e3f262a` under `lib/` (MIT, licence kept); `hooks/` is the
   agentbox adapter. Upstream's HTTP client is not vendored — the engine has no global
   `fetch`; transport is `$.http.fetch`.
3. **Email never leaves — the taint gate.** A transcript containing any tool whose name
   starts with a `taintTools` prefix (`mcp__email-gateway__`, `mcp__claude_ai_Gmail__`) or a
   `Skill` load of `email-search` is not sent to Jev; the built-in summary runs and a toast
   says so. Decided per compaction from the messages being compacted, so it is stateless.
   `hooks/policy.mjs` is the whole rule; validator **E074** refuses a manifest whose
   `taint_tools` drops the email prefix. Other must-not-leave classes are fenced per
   project by adding their MCP prefix — a manifest edit, not code.
4. **The switch.** `/jev-compact on|off|status`, served in-plugin via `command.run`,
   persisted in the plugin store across sessions; starting position
   `[features.jev_compaction].enabled_by_default`. `status` reports whether *this* session
   would compact via Jev and why not otherwise.
5. **Fail-open.** Any throw, missing `TYPESAFE_API_KEY` (W072), reduction under
   `min_reduction_ratio`, or a tainted session ⇒ `next(event)` — the built-in compaction —
   with one `jev-compaction:` log line naming the reason. Tool-result *contents* never leave
   on any path; only their sizes do.
6. **BOOT-class, byte-identical-when-off.** The entrypoint sets
   `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in `settings.json` `env`, registers
   `/opt/agentbox/config/claude-plugins` as the `agentbox` directory marketplace and
   installs `jev-compaction@agentbox` with the manifest's values as `--config`; the
   plugin cache under the container-owned `~/.claude` (ADR-2118) is content-compared to the baked tree and
   reinstalled on any difference (the cache is keyed by version, and a rebuild does not bump
   it). Off ⇒ uninstall, marketplace remove, env key deleted. No `/nix/store` path is written.
7. **Egress is widened, explicitly.** ADR-2090 covered the routing prompt; this covers the
   compaction transcript, with the email carve-out as the standing condition. Recorded as
   exception 2 in `data-boundary.md`.

## Consequences

- Compaction stops losing exact paths, errors and constraints; the model can still re-run
  any truncated tool. Cost moves from the judge (negligible) to context residency
  (≈ $14–18 per busy agent-hour vs the summary; ≈ $150/hour for ten busy agents). That
  bill is now observable per session (`/jev-compact status`, the cost line) and is the
  review trigger above.
- The image carries a newer Claude Code (2.1.257 → 2.1.276): a rebuild-class change whose
  first boot is the acceptance test for everything else in this record.
- `keepThreshold` 0.5 on a Noul is a calibration, not a proof (ADR-2089's rule holds here:
  a probability is not a safety net). Upstream's own limitation note is adopted verbatim.
- Sessions that touch email lose the feature entirely for that session rather than
  partially — the conservative reading of "always skipping email", chosen because a
  message-level redaction of what the *model wrote about* mail cannot be asserted.
- Per-project fencing for the other must-not-leave classes is a manifest edit, closing part
  of the ADR-2090 "gates deferred" debt for this consumer only; the router still has none.

## Verification

At `verified_commit`, before the rebuild:

- `node --test tests/config/jev-compaction-policy.test.mjs` → 14 passed: every
  email-gateway tool and Gmail taint by prefix; `email-search` Skill taints, other skills
  do not; prefix is anchored; one email call anywhere in a 50-message transcript, pinned
  tail included, taints; extra prefixes add rather than replace; store beats manifest
  default; `decide` orders switched-off > no-key > tainted > run.
- `tsc -p config/claude-plugins/jev-compaction/tsconfig.json` (TypeScript 5, upstream's
  2.1.274 type reference) → exit 0.
- `claude plugin validate` on the 2.1.276 binary → passed; it lists the hooks
  (`session.start`, `command.run{command=jev-compact}`, `session.compact`,
  `turn.complete`), the `$` calls and the one env read (`TYPESAFE_API_KEY`).
- The full `marketplace add → install --config → update → disable → enable → uninstall →
  marketplace remove` lifecycle was exercised against a scratch `HOME` with the 2.1.276
  binary; the entrypoint block uses exactly those commands. Directory marketplaces record
  `{"source":"directory","path":…}` and install to `~/.claude/plugins/cache/agentbox/…`.
- `node scripts/agentbox-config-validate.js agentbox.toml` → no new findings; a copy with
  `taint_tools = "x"` → E074; the same manifest without `TYPESAFE_API_KEY` → W072.
- Binaries: `sha256` of the 2.1.276 downloads computed here for both arches and pinned as
  SRI; the x86_64 binary runs in this container and contains the function-hook strings
  2.1.257 lacked.
- Not yet verified: the plugin loaded by a booted image. `activation_status: staged`
  until the rebuild boots and `/jev-compact status` answers in a fresh session.

## Amendment — 2026-09-21: ADR-2094 relaxes the taint fence on *declared* backend locality

**ADR-2094** (Sovereign System One) amends decision point 3 and, consequentially, point 5.
Point 3 states the taint rule without condition: a tainted transcript "is not sent to Jev;
the built-in summary runs". That is no longer the whole of the rule in `hooks/policy.mjs`,
and this record says so rather than leaving the prose to drift.

`decide()` now takes a fourth input, `backendLocal`. When a transcript is tainted:

- `backendLocal !== true` ⇒ `{ run: false, reason: 'tainted' }` — point 3 exactly as written;
- `backendLocal === true` ⇒ `{ run: true, reason: 'ok-local' }` — the transcript **is** judged,
  because the judge is the local SSO façade and the transcript does not leave the LAN. The
  fence exists to stop egress, not to stop compaction, so removing the egress removes the
  reason for the fence.

Four properties keep that relaxation from being a hole, and all four are verified at HEAD:

1. **It is declared, never inferred.** `backendLocal` is a boolean the caller passes from
   resolved configuration. Nothing derives it from `baseUrl` — a hostname is evidence of the
   host you dialled, not of where the bytes come to rest.
2. **It defaults shut.** `resolveConfig` sets it true only for a real `true` or the exact
   string `"true"`; absent, `undefined`, `null`, a URL or any other truthy string all leave
   it false. Saying nothing yields the safe answer.
3. **Precedence above it is unchanged.** `switched-off` still beats `no-key`, which still
   beats the taint decision. A local backend does not resurrect a switched-off or keyless
   session.
4. **It is auditable.** The outcome is reported as `ok-local`, never `ok`, so a tainted
   session that was compacted is distinguishable in the log from a clean one.

**In production the fence is still shut, by two independent mechanisms.**
`[features.sovereign_system_one].enabled = false` in the committed manifest, so nothing is
projected at all; and — verified at HEAD — the baked plugin's `.claude-plugin/plugin.json`
declares no `backendLocal` or `baseUrl` in its `userConfig` (its keys are `apiKey`,
`enabledByDefault`, `taintTools`, `taintSkills`, `keepThreshold`, `preserveRecentMessages`,
`compactAtPercent`, `minReductionRatio`, `maxStateTokens`, `maxRequestTokens`,
`truncateHeadChars`, `model`), while the projector emits exactly `baseUrl=…` and
`backendLocal=true` (`services/agentbox-manifest/src/sso.rs:145,147`). The entrypoint passes
only pairs the plugin declares and logs the rest as "plugin declares no userConfig key … —
not projecting it", so at HEAD even flipping the gate on would leave this consumer on the
vendor cloud with `backendLocal` false. The relaxation is specified and unit-tested, but not
yet reachable end-to-end — consistent with ADR-2094's own `implementation_status: partial`.

Points 1, 2, 4, 6 and 7 are unaffected. E074 still refuses a manifest that drops the email
prefix, and the default taint set is unchanged (`mcp__email-gateway__`,
`mcp__claude_ai_Gmail__`, skill `email-search`). Point 5's "missing `TYPESAFE_API_KEY`
(W072)" acquires the same stated exception as ADR-2091's W071: the validator suppresses W072
when the SSO gate is on, because the key is then not on the path.

## Re-verification — 2026-09-21 (`e57156a8ff72a4b84145b7de1d67d8d0c79fd41d`)

Tripped by four governed paths (`b680a7ae`, ADR-2094): `hooks/jev-compaction.ts`,
`hooks/policy.mjs`, `config/entrypoint-unified.sh` and
`tests/config/jev-compaction-policy.test.mjs`. `lib/claude-code-binary.nix` is unchanged, so
point 1's 2.1.276 pin stands untouched. Checked in a detached worktree at HEAD.

- `node --test tests/config/jev-compaction-policy.test.mjs` → **22 passed, 0 failed** (14 at
  the previous anchor; the 8 added cover the `backendLocal` input, including the assertion
  that the pre-2094 cloud contract is bit-identical when that input is absent).
- `bash -n config/entrypoint-unified.sh` → clean.
- `env -u TYPESAFE_API_KEY node scripts/agentbox-config-validate.js agentbox.toml` → **W072
  fires**, as this record's Verification section records; against a copy with the SSO gate
  flipped on, W072 stands down and W073 appears instead. The committed manifest has that gate
  off, so the reproduction command in Verification still behaves as written.
- `node scripts/agentbox-config-validate.js agentbox.toml` → `agentbox manifest valid (5
  advisory warnings)`, none new; a copy with a public `endpoint` under the enabled gate →
  `E075`, confirming the façade cannot be pointed off-LAN.

Point 3 is **narrowed, and amended above rather than silently bumped**; with that amendment
the record describes `hooks/policy.mjs` at HEAD correctly, and the email fence is described
truthfully — closed in production, conditionally openable only on an explicit,
default-false, audited locality declaration. `activation_status` stays `staged`: the plugin
still has not been loaded by a booted image.

### Re-verified 2026-09-21 at 6669e9f3b22af1e2b651037cf39a4a551a346d3f

One governed path moved, `config/entrypoint-unified.sh`, in a COMMENT-ONLY hunk: `git diff 1639f86ab..6669e9f3b -- config/entrypoint-unified.sh` is 6 insertions and 1 deletion, all of them `#` lines. The ShellCheck directive above the jev-compaction plugin install carried its rationale inside the directive, which SC1125 rejects and which made ShellCheck ignore the whole directive; the rationale is now a separate comment above a bare `# shellcheck disable=SC2086`. No executable line changed anywhere in the file, and the shell ignores comments, so runtime behaviour is byte-identical. The hunk IS in this decision's block, which is why it is re-verified most carefully: the executed line is still `run_as_devuser env HOME=/home/devuser timeout 120 claude plugin install jev-compaction@agentbox $_JC_ARGS`, with `$_JC_ARGS` still deliberately unquoted so each `--config KEY=VALUE` pair is a separate word, and the userConfig keys are still filtered against the plugin manifest before projection. Only the ShellCheck comment above it changed; the suppression it was written for is now actually in force, where before the directive was being discarded. Claim STILL TRUE.

## Re-verification — 2026-09-22 at d6b976271 (Sovereign Corpus landing)

**Governed changes:** `config/entrypoint-unified.sh`: exports `VAULT_REPO` (from `[vault].repo`, else derived from `VAULT_ROOT`; empty when unresolvable so the management API fails closed) and adds it to the vault-disabled `unset` list. Nothing else in boot order, gating or service start changed. **Decision unaffected** — none of these touches what this record decides. `verified_commit` moved to the landing commit. Gates at that commit: routing table current; forum e2e real mode 101/101 and stub 30/30 against this tree; management-api jest 88/88.

## Amendment — 2026-09-25: sticky taint, token trigger, hysteresis, cache-warm compaction

An audit found one data-boundary leak and three cost defects. Points 3 and 5 above are
amended; the rest stand.

**a. The taint is sticky per session (amends point 3).** "Decided per compaction from the
messages being compacted, so it is stateless" was the leak: a built-in summary absorbs email
content as text and drops the tool calls, so the *next* compaction scanned a transcript with
no email call in it and sent that summary to Jev. The plugin now records a taint in its own
store under `taint:<session id>` the first time it sees one — at the `tool.call` of any
`taintTools` prefix, at a `skill.prompt` expansion of a `taintSkills` skill (which also
catches `/email-search` typed as a command, where no `Skill` tool call exists), at every
main-loop `turn.complete` scan of `$.session.messages()`, and at every `session.compact`
scan. Once recorded, `mergeTaint` reports the session tainted for every later decision,
whatever the transcript then holds; `decide` is unchanged, so `ok-local` (the 2026-09-21
amendment) still applies to a declared-local backend. The taint is per session id and
therefore per transcript: `/clear` starts a new id with an empty transcript, which is correct.
Entries untouched for 30 days are pruned at `session.start`. **Residual:** a session resumed
under a *new* id whose history already holds an email-bearing summary, with no email call
left in it, is not recognised; the tool-call and skill hooks make that window narrow, and
the operator's rule of not resuming email sessions into Jev-compacted work closes it.

**b. Token trigger.** `compact_at_percent = 60` on a 1M-token window waited for ~600k tokens
of cache reads per turn. The trigger is now `min(compact_at_percent × window,
compact_at_tokens)`, with `compact_at_tokens = 180000` by default; the percentage is the
ceiling for small windows (120k on a 200k window).

**c. Hysteresis.** A compaction that leaves context above the trigger used to re-run every
turn (a Jev call plus a full prompt-cache rewrite each time). Every standing compaction of
the main conversation — the plugin's, `/compact`, the engine's own — now marks
`baseline:<session id>` pending; the next `turn.complete` records the real context size as
the baseline, and the plugin re-triggers only at `max(trigger, baseline + rearm_tokens)`
(`rearm_tokens = 40000`; 0 means a quarter of the trigger). The engine's own
near-full auto-compaction is untouched and remains the backstop.

**d. Cache-warm compaction.** After the prompt cache's TTL the whole history is re-prefilled
at full price, so compacting just before an idle break is cheap and compacting just after
it is not. At each main-loop `turn.complete` with context ≥ `cache_warm_floor_tokens`
(100000) and past the hysteresis gap, the plugin arms one `$.clock.after` timer for
`TTL − cache_ttl_margin_seconds` (half the TTL when the margin would exceed half of it); any
`turn.start` cancels it. On firing, `cache_warm = "compact"` (default) runs
`$.session.compact()` through the same Jev-or-built-in decision, taint gate included;
`"notify"` shows a toast suggesting `/compact`; `"off"` disables it. The TTL is
`cache_ttl_seconds` when set, else detected: a session whose usage reports subscription
rate-limit windows is 1 h, one without them holding `ANTHROPIC_API_KEY` is 5 min, anything
else is assumed 1 h. `$.session.compact` runs between turns and rejects while one runs; a
rejection is logged and nothing else happens.

**Configuration.** Six new `[features.jev_compaction]` keys (`compact_at_tokens`,
`rearm_tokens`, `cache_warm`, `cache_warm_floor_tokens`, `cache_ttl_seconds`,
`cache_ttl_margin_seconds`) in the manifest, schema and catalogue, mirrored as plugin
`userConfig` (`compactAtTokens`, `rearmTokens`, `cacheWarm`, `cacheWarmFloorTokens`,
`cacheTtlSeconds`, `cacheTtlMarginSeconds`) whose defaults equal the manifest's, so the
plugin behaves as specified even before the entrypoint projects the new keys.

**Verification.** `node --test tests/config/jev-compaction-policy.test.mjs` → 36 passed
(22 before; 14 added for the pure decisions). `claude plugin test
config/claude-plugins/jev-compaction` (Claude Code 2.1.280) → 8 passed: engine-level tests in
`config/claude-plugins/jev-compaction/tests/jev-compaction.test.ts` prove a summary that
absorbed email is not sent at the next compaction, that the taint is recorded at the tool
call and at the skill expansion, that a clean session still reaches Jev, that the token
trigger fires once and holds under hysteresis until re-armed, and that the cache-warm timer
compacts at exactly `TTL − margin`, is cancelled by a new turn and is not armed below the
floor. Disabling the sticky merge fails the three taint tests (mutation-checked).
`claude plugin validate` passes.

## Amendment — 2026-10-01: scope, deadline and request redaction (plugin 0.2.0)

Ported, adapted, from open upstream PRs #112 (issue #107), #117 and #98; no network
destination, telemetry, `eval` or dependency entered with them. **(e) Scope:** `precompute`
answers `{ skip }` and an `agentId` compaction goes to core, both before any Jev call (the
taint scan still runs); only a main-loop `turn.complete` with `reason: answer` triggers, under
a guard claimed before the first `await`. **(f) Deadline:** the Jev round races
`$.clock.sleep(compactionTimeoutMs = 15000)`; past it the built-in summary runs (upstream
skips a plugin-triggered compaction instead — rejected, because point 5 says any failure
falls open). **(g) Redaction:** state and questions are passed through `hooks/redact.mjs`
before `buildJevRequest`; the transcript is never touched, so "never rewrite text" holds.
Upstream's redactor was not adopted: its entropy rules (any 32+ char mixed string, any
slash-bearing base64) match tool ids and digests in the state, and it misses `nsec1`; ours
is shape- and slot-based only. Verification: `node --test` policy + redact → 70 passed;
`claude plugin test` → 15 passed, each new test mutation-checked.

## Re-verification — 2026-09-26 at 6ea592ee0 (ADR-2111/2116 landing)

**Confirms the 2026-09-25 amendment against the code, and records one fix and one stale literal.**

- **Amendment a–d holds.** `policy.mjs` exports `skillTaints`, `mergeTaint`, `taintRecord`, `triggerTokens`, `rearmGap`, `shouldCompact`, `cacheTtlSeconds`, `nudgeDelayMs`, `cacheWarmMode` and `shouldArmNudge`. `jev-compaction.ts` reads and writes `taint:<session>` through `mergeTaint`, arms `$.clock.after` and calls `$.session.compact()`. `plugin.json` `userConfig` defaults equal the manifest: `compactAtTokens` 180000, `rearmTokens` 40000, `cacheWarm` "compact", `cacheWarmFloorTokens` 100000, `cacheTtlSeconds` 0, `cacheTtlMarginSeconds` 300. `node --test tests/config/jev-compaction-policy.test.mjs` → 36 passed.
- **Point 6 fix (`6ea592ee0`).** "Reinstalled on any difference" compared only the plugin *code* digest. `claude plugin install --config …` is the only way options reach the plugin, so a change to `[features.jev_compaction]` alone never landed. After the 2026-09-26 rebuild, the six amendment keys were missing from the installed `userConfig`. Behaviour was right only because the plugin defaults above equal the manifest. The entrypoint now builds the projected `--config` list first and fingerprints it into `~/.claude/plugins/.jev-compaction-config.sha`. "Current" requires both the code and the config digest to match, and a successful install writes the stamp. Point 6 now holds as stated for options as well as code.
- **Point 1's literal is stale.** The pin is `2.1.280` (`lib/claude-code-binary.nix:28`, bumped in `fbcfa3f27` on 2026-09-22, before the previous anchor and missed by it), not `2.1.276`. 2.1.280 keeps the function-hook surface, so the substance of point 1 (a pin with `session.compact`, `command.register`, `$.http.fetch`) holds. Read the version as advisory.

Other entrypoint changes (hook timeouts in seconds, the hook registry, permission projection) do not touch the plugin install/uninstall or byte-identical-when-off path. `bash -n` clean. Claim STILL TRUE.

## Re-verification — 2026-10-02 (`a48ea407a24185f7a4f654a35e66805778acbec8`)

Tripped by ADR-2078 (pods signer signs as the sovereign identity). `config/entrypoint-unified.sh` changes only in Phase 3: an `AGENTBOX_IDENTITY_ROOT` default export before `nostr-pod-bridge bootstrap`, and a chown to devuser plus chmod 0600 of the bootstrap identity file after it (ADR-2078). It touches no section, key or phase this record governs, and the decision holds unchanged.
Re-verified by `git diff caab741c6..a48ea407a -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-03 (`055c06ff69b2f53bf38a67d254c048bb03599fc8`)

Tripped by custody X-1 step 1 (W0 `custody/w0-bypasses` and W1 `custody/w1-role-accounts`). `config/entrypoint-unified.sh` changed only as follows. W0: the root boot `PATH` is store-only, the workspace cargo bin is appended for devuser shells only, Stage B is one-shot and the Docker socket is gated. W1: the role-custody lib is sourced, and the `/run/secrets` and supervisor-config steps are gated on `[security].role_isolation`; flag-off statements are verbatim (ADR-2122). The Jev compaction projection is untouched. The decision holds.
Re-verified by `git diff 0919dc39a..055c06ff6 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`275e12356319a9630846656580d497d53de3d38c`)

Tripped by custody X-1 step 1, W2 (`custody/w2-env-scrub`: `0965a9c8c`, `042115499`, `275e12356`; bypass 3, ROLE secrets out of PID 1's environment). `config/entrypoint-unified.sh` gains the W2 role-env block (`_AB_ROLE_ENV_VARS`, `_ab_role_env_capture` before the identity bootstrap, `_ab_role_env_scrub` on the line before `exec supervisord`, `_ab_role_key_file_own` in Phase 5c). Every function returns at its first line unless `[security].role_isolation` is on, so the flag-off boot is unchanged (RC-X1-06 compares the environment handed to supervisord byte for byte). The decision holds.
Re-verified by `git diff 055c06ff6..275e12356 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`3b54129631067277f6363309b01cce485faa027a`, custody integration head)

Tripped by the custody integration (`custody/integration`: W0, W1, W5, W3, W7a, W8, W2, W9 and
the integration resolutions, ADR-2122). Since `275e12356` the governed paths changed as follows. `config/entrypoint-unified.sh` changed in a comment and a log line (the config's new name, `760ed01e4`). W2's role-env capture now runs `mkdir -p` on the secrets root and `mkdir -m 0700` on the role dir (`3b5412963`). That fixes shellcheck SC2174 and behaves the same. Both changes are reached only with the flag on.
Jev compaction's switch and email fence are untouched. The decision holds. Re-verified by `git log 275e12356..3b5412963 -- <verified_paths>`
and the integration gates. Nix was not evaluated in this container; the image is unverified
until the owner's rebuild.

## Re-verification — 2026-10-03 (`dc91e092ab646b4a825805b8229602ac8b15bad3`, custody W10)

Tripped by the W10 gap fixes on `custody/integration`. `config/entrypoint-unified.sh` (`dc91e092a`) gains `_ab_devuser_privilege_check` and its call after the docker-socket check; it reads files only and is a no-op with `[security].role_isolation` off. Nothing this record governs changes meaning. The decision holds. Re-verified by `git log 3b5412963..dc91e092a -- <verified_paths>`. Nix was not evaluated in this container.

## Re-verification — 2026-10-03 (`f93586b9e52fda0d0b367881e2d2ff3014509faf`, custody W2b/W4)

Tripped by `f93586b9e` (custody W2b and W4: the at-rest migrate/revert and the sidechain state move). `config/entrypoint-unified.sh` changes only in three custody blocks (ADR-2122, design 3.2). (1) A new at-rest step before Phase 3: `ab_custody_migrate` when `[security].role_isolation` is on, otherwise `ab_custody_revert`, which changes nothing on a volume that was never migrated (`tests/config/role-custody-migrate.test.sh` shows the stat set, ctime included, byte-identical). (2) Under the flag only, the volume-root chown loop skips `/var/lib/agentbox/secrets`. (3) After the identity bootstrap, the identity file goes to ab-identity 0400 under the flag; with the flag off, the devuser 0600 statements are unchanged. The Jev compaction projection is untouched. The decision holds. Re-verified by `git log dc91e092a..f93586b9e -- <verified_paths>`.

### Re-verification — 2026-10-03 (ruflo 3.51.1, Claude Code 2.1.288)

`f93586b9e..daba195e5`: `lib/claude-code-binary.nix` moves Claude Code 2.1.285 → 2.1.288 (`c23592687`); both per-arch hashes equal Anthropic's 2.1.288 manifest checksums. The factrail plugin baked at the pinned rev (`share/factrail/plugin`) passes `claude plugin validate --strict` under the 2.1.288 binary with the hook surface it reports under 2.1.285, unchanged: session.start, tool.call, skill.prompt, command.run, session.compact, turn.start, turn.complete; calls include `$.session.compact` and `$.command.register`. Nothing this record governs (ADR-2093 — Compact context by Jev judgement, verbatim, with email fenced out and a switch) changes meaning. The decision holds. Re-verified by `git log f93586b9e..daba195e5 -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.

### Re-verification — 2026-10-03 (ruflo-console gate, `451823ca8`)

`daba195e5..451823ca8`: `config/entrypoint-unified.sh` adds the ruflo-console boot block after factrail's, and factrail's function-hook switch and `agentbox` marketplace removal also respect the new gate; with it off both behave as before. Nothing this record governs (ADR-2093 — Compact context by Jev judgement, verbatim, with email fenced out and a switch) changes meaning. The compaction policy is untouched: CLAUDE_CODE_ENABLE_FUNCTION_HOOKS is still set whenever `[features.jev_compaction]` is on, and is now also kept on for the console. The decision holds. Re-verified by `git log daba195e5..451823ca8 -- <verified_paths>`.

### Re-verification — 2026-10-03 (ruflo memory governed, 1fc26c786)

`451823ca8..1fc26c786` (nothing in the governed paths moved before `09e6271e9`): `config/entrypoint-unified.sh` changes in one place (`012bf98f5`): three exports in the runtime-env block after `RUFLO_DAEMON_AI_WORKERS` — `RUFLO_DAEMON_AUTOSTART` (default `0`), `CLAUDE_FLOW_DISABLE_BRIDGE` (default `1`) and `CLAUDE_FLOW_MEMORY_PATH` (default `/home/devuser/.cache/ruflo/memory`), each `${X:-default}` so an operator export wins (ADR-2123). `lib/factrail.nix` and `lib/claude-code-binary.nix` did not move. Nothing this record decides (ADR-2093 — Compact context by Jev judgement, verbatim, with email fenced out and a switch) changed: the compaction block, its switch and the email fence are untouched. The decision holds. Re-verified by `git diff 451823ca8..1fc26c786 -- <verified_paths>`.

### Re-verification — 2026-10-03 (runtime-env path escape, 34f5e4254)

`1fc26c786..34f5e4254`: `config/entrypoint-unified.sh` changes one line in the runtime-env heredoc — `CLAUDE_FLOW_MEMORY_PATH` is escaped so it resolves in the sourcing shell (`$HOME/.cache/ruflo/memory`) instead of as a root-side `/home/devuser` literal (RC-X1-01, `34f5e4254`). No path, gate, projection or program this record governs changed. Nothing this record decides changed.

## Re-verification — 2026-10-07 at cca7ea3b151be3ea44907581d40271c714b07dd0

Since `34f5e4254`, only `lib/claude-code-binary.nix` has changed among the governed paths. `lib/factrail.nix` and `config/entrypoint-unified.sh` have no diff. `9415186f3` moves Claude Code from 2.1.288 to 2.1.291 (`lib/claude-code-binary.nix:35`). Both per-arch SRI hashes change to match Anthropic's 2.1.291 manifest checksums, and the old bump-review note is dropped.

At `cca7ea3b1` the header comment at `:24` still says "2.1.289". That comment is wrong. `d39db5131` corrects it and changes nothing else, so the stamp moves to that commit.

The baked factrail plugin (`/nix/store/…-factrail-0.1.0/share/factrail/plugin`) passes `claude plugin validate --strict` under the 2.1.291 binary. It reports the same hook surface as under 2.1.288 (session.start, tool.call, skill.prompt, command.run, session.compact, turn.start, turn.complete), and its calls include `$.session.compact` and `$.command.register`.

The substance of point 1 holds: Claude Code is pinned at a version with the function-hook surface. The point's version literal has said 2.1.285 since the 2.1.288 bump and is now three releases stale. Corrected to 2.1.291, with the line cited. The decision holds.
