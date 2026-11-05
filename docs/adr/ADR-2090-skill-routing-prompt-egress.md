---
id: ADR-2090
title: Skill-routing prompts may egress to the judge; per-project gates are deferred, not waived
date: 2026-09-16
decision_status: accepted
implementation_status: complete
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: 3beca506c1d44122bf2e14ed935d590b9d020233
verified_paths: [agentbox.toml, schema/agentbox.toml.schema.json, scripts/agentbox-config-validate.js, config/entrypoint-unified.sh, config/hooks/skill-route.cjs, config/hooks/lib/skill-route.cjs, skills/skill-router/scripts/route.mjs, config/egress-policy.json, tests/config/skill-route.test.js]
owner: jjohare
review_trigger: the first project whose content must not reach the judge, or any proposal to widen this beyond skill routing
repo: agentbox
evidence_class: source+test
acceptance_boundary: jest skill-route 70 passed, semantic-rules and routing-labels green, egress register in sync, manifest validates. The bypass gates the skill router only, not factrail compaction or jev-checkpoints; the shipped list is empty so no project is gated until the operator lists one and boots. Tests ran at 97f298db5 (adr-sprint/w7, code f8b02b93d); verified_commit 2f15c531b is a diff-only re-stamp after the w78 integration
---

# ADR-2090 — Skill-routing prompts may egress to the judge; per-project gates are deferred, not waived

## Scoped source re-verification — 2026-11-03

Shared-file changes add pinned VisionCraft and direct AQE registration, retire
the unused precedent-bridge default, and extend governance custody/config
scrubbing. This record's own mechanism is retained; existing partial/staged
limitations and historical receipts are not promoted to new runtime acceptance.

Evidence: [rebuild verification receipt](../estate-closeout/adr-reverification-2026-11-03.md).
This verifies the scoped source amendment, not new whole-record runtime
acceptance. Decision, implementation and activation statuses are unchanged.

## Context

ADR-2089 established measured skill discovery using a third-party judgement API (TypeSafe
System One / Jev) offline, against this repo's own public skill descriptions. Routing *live*
was blocked on one thing: the state of a routing call is the user's own turn text, and it
cannot be redacted and still routed on. Measured economics (2026-09-16): a full-fleet route
costs **$0.000662** (15.8k input tokens at $0.042/MTok, output free) against **$0.001446 per
turn** for the 20 always-loaded descriptions in Opus cache reads, and **$0.0823** for one
`/route`. Cost argues for the router; only egress argued against it.

## Decision

**Operator decision: for skill routing, the routing prompt may leave the network.** The
selection of which skill handles a request is not treated as sensitive content, and a live
router may send the user's turn text to the judge.

**Scope is exactly skill routing.** This decision does not widen the boundary for any other
use case. The must-not-leave classes in
`skills/system-one/references/data-boundary.md` — the owner's personal mail, the private
context portfolio, private knowledge-graph instance data, credentials and key material,
client content under confidentiality — remain closed for every purpose other than choosing a
skill, and closed to every consumer other than the router.

**Per-project gates are deferred, not waived.** Tightening is expected to arrive
project-by-project as projects with content that must not reach the judge appear. Until then
there is no per-project gate, and this ADR is the record that its absence is a known, accepted
state rather than an oversight.

## Consequences

- A live skill router is unblocked. It is cheaper than the status quo, covers all 127 skills
  rather than a curated 20, and returns ~2,900 tokens per turn to the context window.
- **A routing call carries whatever the user typed**, including, on some turns, content from a
  must-not-leave class. That is the accepted cost of this decision, not an edge case: the turns
  where routing matters most are the ones most likely to carry real content.
- The first project that cannot accept this needs a gate before it runs, and the router needs a
  bypass path for it. Neither exists yet. That is the debt this ADR records.
- Nothing about the offline measurement rig changes; it never sent a user turn and still does
  not.
- Two engineering consequences carry over from ADR-2089 and are unaffected by this decision:
  a sole-dispatch router must fail **open** to existing description matching on 429/529 (the
  fallback is the normal path when the service is slow, not an error branch), and **confidence
  is not a safety net** — a wrong pick was measured at 0.94, so no low-confidence-escalates
  rule may be relied on without local threshold measurement.

## Verification

Not implemented. `implementation_status: none` is the honest state: this ADR records a
decision that unblocks work, not work that has been done. No live router exists; skill
selection is still the always-loaded manifest plus `/route`. When a router is built, it gets
its own record and this one gains a `superseded_by` or an amendment.

## Amendment — 2026-09-16

The router was built the same day: **ADR-2091** (`[skills.routing]`, `config/hooks/skill-route.cjs`,
`/route` over the shared library). This record is unchanged in force — it is the egress
decision ADR-2091 relies on — and its `implementation_status` stays `none` because it never
described work of its own. The two carried-over consequences are now tested rather than
stated: fail-open on 429/529/timeout and the no-retry rule are contract cases in
`tests/config/skill-route.test.js`. The per-project bypass remains the open debt.

## Cross-reference — 2026-10-03 (prompt egress register, N-7)

This record is the `skill-router` row's accepted-egress record in the
[prompt egress register](../SECURITY-profiles.md#prompt-egress-register--2026-10-03)
(`config/egress-policy.json` `.register`), which catalogues every route by which a prompt,
code, a secret-adjacent string or a key leaves the box, beside the routes this record does
**not** widen to. Re-verified at `0919dc39a`: the router still sends the user's turn, clamped
head+tail (`config/hooks/lib/skill-route.cjs:408-414`), to `api.typesafe.ai`
(`config/hooks/lib/skill-route.cjs:33`); `[skills.routing].router` (`agentbox.toml:962`) is
still the switch; and no per-project gate or bypass exists yet, so the debt in Consequences
stands. Decision and status axes unchanged.

## Close-out 2026-10-31 (per-project bypass built)

The debt this record carried is paid at `f8b02b93d` (multi-line-array fix `97f298db5`); the decision itself is unchanged (skill routing may egress by default). `implementation_status` moves `none` → `complete`. `activation_status` stays `inactive`: the manifest list ships empty, so no project is gated until the operator lists one, and applying it needs a boot (BOOT-class, no rebuild).

- **Key**: `[skills.routing].bypass_projects`, an array of absolute project roots, default `[]` (schema, `agentbox.toml`, validator **E083**: absolute, no whitespace, quote, comma, colon, `#`, `[` or `]`; brackets are refused because the shell and JS array readers end a multi-line array at the first `]`, so `/srv/p[1]` would have projected as `/srv/p1` and dropped every later entry, a gate that fails open; schema pattern and tests/config/skill-route.test.js cover it).
- **Gate**: `config/hooks/lib/skill-route.cjs` `route()`, immediately before the single `fetch` site. The hook and `/route` share the library, and the Choice plus every verify/intent/facet extra ride that one request, so one gate covers all of them. A bypassed turn returns `skipped: project-bypass`, is logged without prompt text, and never builds a request.
- **Identity**: the hook passes `hook.cwd`; `route.mjs` passes `process.cwd()`. Match is realpath on both sides plus a path-boundary test (`/x/proj` covers `/x/proj/sub` and a symlink to it, never `/x/proj2`).
- **Fails closed**: with a non-empty list and an unknown or non-absolute cwd, nothing is sent. The list is a privacy control, so uncertainty must not egress.
- **Scope of the claim**: the bypass stops the *skill router* (the hook and `/route`) only. `jev_compaction` (factrail, ADR-2121) and `jev_checkpoints` (ADR-2135) are both enabled in the shipped manifest and call the same System One judge; a listed project's turns still reach it by those routes. The key's description, `agentbox.toml`, the schema, `system-manifest.js` and the register's `skill-router` row now say "skill-routing turns", not "turns". Bypassed projects that must not reach the judge at all need those two consumers gated separately.
- **Cascade choice**: a local BM25 cascade answer involves no egress and still applies to a bypassed project; only an escalation to the judge is stopped.
- **Projection**: the entrypoint (`_ab_toml_array`, single- or multi-line, comments tolerated) turns the array into a PATH-style value and inlines `AGENTBOX_SKILL_ROUTE_BYPASS_PROJECTS` into the registered hook command and `runtime-env.sh` **only when the list is non-empty**, so the default hook command and env are byte-identical to before. `config()` also reads the manifest as the `/route` fallback in an unbooted shell.
- **Register**: `config/egress-policy.json` `.register` (`skill-router` row) and `docs/SECURITY-profiles.md` no longer say no bypass exists; the Cross-reference above is superseded on that point.
- **Silent-open guard**: a key that is set but projects no path (a malformed array, say) prints a boot WARNING instead of leaving the gate quietly off; the `/route` fallback parser joins multi-line arrays too.
- **Known limits**: `route.mjs` prefers the baked `/opt/agentbox/config/hooks/lib` copy of the library, so the CLI honours the key only after a rebuild; the hook, run from the registered path, is covered by the same bake. The gate bounds the judge call only: the optional label-log embedding (ADR-2110, LAN, off in default use) is a separate route and is not gated by this key.

Evidence (worktree branch `adr-sprint/w7`):

```
jest tests/config/skill-route.test.js       → 70 passed, 0 failed (14 new: bypassed cwd/subdir/symlink → 0 judge requests;
                                              sibling prefix still routes; list is PATH-delimited; no cwd → nothing sent;
                                              default/empty list unchanged; verify+intent request bypassed; cascade escalation
                                              stopped; route() direct; boundary helper; manifest fallback incl. multi-line array; _ab_toml_array single/multi-line/empty/absent; E083; entrypoint source)
jest tests/config/semantic-rules.test.js tests/config/routing-labels.test.js tests/config/exp-b8-label-log.test.js → green
node scripts/ci/render-egress-register.js --check → 46 routes in sync
node scripts/agentbox-config-validate.js agentbox.toml → valid
```

**Owner question (open):** should `bypass_projects` also gate factrail compaction and the jev-checkpoints plugin, or is a project that must not reach the judge to be handled by disabling `jev_compaction` and `jev_checkpoints` for it? Until the owner answers, listing a project protects it from skill routing alone.

Re-verified 2026-10-31 at `2f15c531b02b8f8393d68d29ce3491712bdd862c` (W7 and W8 integration, `adr-sprint/w78`). Governed-path delta since `97f298db5`: `agentbox.toml`: the four `[model_routing.routes]` diagram routes with their comment block (ADR-2130), and a wording fix on the `bypass_projects` comment (brackets forbidden, scoped to skill routing; ADR-2090); `config/egress-policy.json`: the `skill-router` row's `notes` only, now saying the bypass stops the skill router and not factrail or jev-checkpoints (ADR-2090); `config/entrypoint-unified.sh`: one line, the `system-one-project --format json` call no longer discards stderr, so a refused slot's reason reaches the boot log (zero bytes on the shipped manifest, checked; the call is still `|| true`, so boot behaviour is unchanged); `schema/agentbox.toml.schema.json`: the `model_routing.routes` host pattern widened to `claude|codex|loom|zai` with four route keys (ADR-2130), and the `bypass_projects` item pattern forbidding `[` and `]` with its description scoped to skill routing (ADR-2090); `scripts/agentbox-config-validate.js`: the E010 profiles root follows `$WORKSPACE` (ADR-2066), E083 forbids brackets and E082 rejects a TOML float (ADR-2090, ADR-2139); `tests/config/skill-route.test.js`: a bracket E083 test (ADR-2090). Read from the diff and checked against the merged tree's gates (cargo, jest, validator); the changes to this record's own surface are the ones its close-out above already records (and the status axes there stand), and nothing else it changes touches what it decides. Re-run: `git diff 97f298db5..2f15c531b -- agentbox.toml config/egress-policy.json config/entrypoint-unified.sh schema/agentbox.toml.schema.json scripts/agentbox-config-validate.js tests/config/skill-route.test.js`.

## Re-verification — 2026-11-01 (ADR-2164 amendment)

Governed path `config/entrypoint-unified.sh` changed since `2f15c531b`: two hunks (`git diff 2f15c531b..e1893e236 -- config/entrypoint-unified.sh`), both inside the trajectory-recorder hook registration block (its comment, the removed `TRAJ_CONNINFO` input, the `pfx` prefix and the command join), which stops inlining the database conninfo and the learning gates into the registered command. Nothing else in the file changed in that range. This record's claims do not concern that block (matches for trajectory/TRAJ_/RUVECTOR_PG_CONNINFO in it: 0, none about the registration). Decision unchanged; `verified_commit` bumped.

## Re-verification — 2026-11-01 (`cc949bb79`)

Governed-path delta since `e1893e236` is the RuVector Postgres credential custody change (ADR-2164 amendment 2), nothing else:

- `agentbox.toml`: the two `conninfo` URLs drop the `@@RUVECTOR_PG_PASSWORD@@` placeholder password, with their comments.
- `config/entrypoint-unified.sh`: adds `_ab_pg_credential_prepare` and the credential-scrub block, replaces every `RUVECTOR_PG_CONNINFO` site (`.mcp.json`, Codex, ingest command line, runtime-env export, routing-label hook command) with the parts and the password-file path, and removes the claude-flow template copy.

Nothing this record decides is changed; its status axes are unchanged. Re-run: `git diff e1893e236..cc949bb79 -- agentbox.toml config/entrypoint-unified.sh`.

Re-stamped again at `09067b095`: the one further change to `config/entrypoint-unified.sh` since `cc949bb79` extends the credential-scrub block so it also walks every `mcpServers` object in Claude Code's per-user state (`~/.claude/.claude.json`, `~/.claude.json`), where the resolved MCP config is cached. Nothing this record decides is changed. Re-run: `git diff cc949bb79..09067b095 -- config/entrypoint-unified.sh`.

## Re-verification — 2026-11-01 (`4f3bd5325`)

Governed-path delta since `09067b095`: `config/entrypoint-unified.sh`: the credential-scrub block (`PGSCRUB_MARKER`) now also rewrites Claude Code's backups and the `*.pre-*`/`*.bak*` snapshots of the projected config, writes atomically (sibling temp file, fsync, rename) keeping owner and mode, and scopes its text rules to RuVector's own values (ADR-2164 amendment 4). This record's decision does not concern these changes. Decision unchanged; `verified_commit` bumped. Re-run: `git diff 09067b095..4f3bd5325 -- config/entrypoint-unified.sh`.

Re-verified 2026-11-05 at `3beca506c` for ADR-2177: the only change to this record's governed paths since its last stamp is ADR-2177's additive SuperSplat hunk (a gated package set and supervisor block, one toml/schema key, a skill registration); this record's decision is unaffected.
