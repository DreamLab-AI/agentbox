---
id: ADR-2031
title: Consultant model selection is projected from the manifest at boot; environment wins, TUI preserves the operator's choice, and tariffs are dated
date: 2026-09-04
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: a5d9ff5a93fa63862fb63a0424adaa4598fb4e41
verified_paths: [config/entrypoint-unified.sh, services/agentbox-manifest/src/tui_write.rs, mcp/consultants/antigravity/server.js, skills/mcp.json]
owner: jjohare
review_trigger: any change to a consultant's default model, a Gemini model retirement, the 2027-01-01 Gemini tariff step, or a wizard that starts exposing the consultant model field
repo: agentbox
---

# ADR-2031 — Consultant model selection is projected from the manifest at boot; environment wins, TUI preserves the operator's choice, and tariffs are dated

## Context
`[consultants.antigravity].model` in `agentbox.toml` was declarative only: the
MCP registry (`skills/mcp.json:409`) and the consultant server each carried
their own hard-coded fallback, and the TUI writer rendered a fixed literal, so a
`tui-write` save silently reset an operator's model. The consultant's price
constants were a single undated pair applied to whatever model was configured.
Google released `gemini-3.8-flash` on 2026-09-02 with an introductory tariff
that doubles on 2027-01-01, making both problems visible.

## Decision
The manifest is the source of the consultant model. At boot the entrypoint
projects `consultants.antigravity.model` into `AGENTBOX_ANTIGRAVITY_MODEL`
through `agentbox-manifest toml-string` (`config/entrypoint-unified.sh:2223`),
a fail-open subcommand that prints an empty string for a missing, non-string or
unparseable value. Precedence is fixed: a non-empty environment variable set
before boot wins, then the manifest, then the registry default. The TUI writer
carries an existing manifest model forward unless the flat state names one
explicitly (`services/agentbox-manifest/src/tui_write.rs:37`). Consultant cost
figures are API-equivalent estimates selected by call time against a published,
dated tariff; a model with no configured tariff reports `cost_usd: null` and
`cost_estimate` says so rather than inventing a number. The general-purpose
Gemini default across manifest, setup template, schema, consultant, URL-context
MCP and the AoE session seed is `gemini-3.8-flash`.

## Consequences
Operators change a consultant model in one place and it survives TUI saves and
rebuilds. No boot-path Python is reintroduced (the projection rides the Rust
manifest binary). Anyone overriding to a model without a tariff loses the cost
figure rather than receiving a wrong one. The tariff table needs refreshing at
the 2027-01-01 step and whenever a new default lands. Already-running AoE
sessions keep their old model argument until recreated.

## Verification
Working tree of 2026-09-04, before the rebuild: `cargo test --locked` in
`services/agentbox-manifest` (108 passed; `tests/consultant_model.rs` covers
`toml-string` fail-open, TUI precedence state → existing → default, and the
entrypoint block under env-set / env-empty / env-unset / manifest-missing);
`node --test mcp/consultants/antigravity/server.test.cjs` (2 passed: argv
carries the model, tariff steps at the UTC year boundary); the model id and
tariff were checked against Google's model reference and release post. Nix
evaluation of the staged fixture in `lib/agentbox-manifest.nix` and boot in the
rebuilt image remain to be confirmed on the host (see
`docs/archive/upgrades-2026-09/upgrades-2026-09.md`).

## Closeout extension — 2026-09-04

CP-01/08. Owner remains jjohare with consultant/runtime maintainers. Source reinspection confirms environment-over-manifest boot projection. Existing tests and pricing references retain their original scope/date; this pass does not re-verify external model availability or tariffs. Staged activation remains unchanged.

**Acceptance condition:** retain the staged Nix/boot receipt, effective projected model and actual process argument across absent/empty/explicit overrides and TUI saves. Distinguish old sessions from newly created sessions. Report unknown tariff without an invented cost and date any future tariff verification. Reopen on model precedence, registry defaults, TUI write or boot changes. See the [configuration review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/configuration-projection.md).

## Landing re-verification — 2026-09-05 (ddd1f1ec8)

Governed paths changed in the landing commit: config/entrypoint-unified.sh: the ADR-2063 hub start/restart nudge and `.git/worktrees` chown, and the ADR-2057 harness/precedent gate reads and HARNESS_TEMPLATE_DIR export; the consultant model projection block is unchanged and `cargo test --test consultant_model` (agentbox-manifest) passes 3/3 against it. Range ec257a256..08e817f39 was re-read as well: 204 lines landed by the ADR-2034 hub projection and sprint blocks, none touching the projection. Decision unaffected; `verified_commit` moved to the landing commit.

## Landing re-verification — 2026-09-06 (796d85fcf)

Governed paths changed in the Wave 3 landing commit: config/entrypoint-unified.sh. The changes are the ones recorded by the Wave 3 records landed in that commit (ADR-2061, 2064, 2065, 2066, 2068, 2069, 2070, 2072, the proposed 2071/2073–2078) and the ADR-2018 recall diagnosis; none alters this record's decision. Gates at the landing commit: management-api 81 suites / 1290 tests, exposure gate PASS, catalogue 60 paths, config validation clean. `verified_commit` moved to the landing commit.


## Bounded source re-verification — 2026-09-07

The entrypoint delta replaces only the agent identity block; consultants.antigravity.model projection and operator-override precedence are unchanged. A failed identity now aborts boot rather than allowing downstream consumers to start with a placeholder. The complete intervening change to the governed source was reviewed at `a0ee1fe5740baa38e14c4ff3fe512dd557bcbb6e`; prior runtime/approval limitations remain.

**2026-09-07 re-verified at `ee742ade5`.** Governed paths changed by `ee742ade5` (ADR-2082 orchestration proxy): config/entrypoint-unified.sh. The changes are additive — two new `[integrations.ruvector_external]` keys, their entrypoint env projection, one catalogue entry and two schema properties — and touch none of the sections this record governs; the decision and its invariant hold unchanged. Re-verified by `git diff a0ee1fe57..ee742ade5 -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-09-21 (`b680a7aeef604276af73e00e1eb5156f379530ae`)

Tripped by `config/entrypoint-unified.sh` (six unrelated blocks added) and `skills/mcp.json` (skill paths moved to `/opt/agentbox`, ComfyUI moved to the sidecar, Codex default → `gpt-6-astra`); neither touched the antigravity projection. Re-established at `HEAD`: the environment-wins precedence is still `if [ -z "${AGENTBOX_ANTIGRAVITY_MODEL:-}" ] … export AGENTBOX_ANTIGRAVITY_MODEL="$(agentbox-manifest toml-string …)"` — **now at `config/entrypoint-unified.sh:2165-2169`, not `:1585` as the Decision cites**; the TUI carry-forward is at `services/agentbox-manifest/src/tui_write.rs:37` as cited; and `gemini-3.8-flash` is still the single default across `agentbox.toml:1156`/`:1555`, `schema/agentbox.toml.schema.json:1111`/`:1119`, `mcp/consultants/antigravity/server.js:20`/`:25` and `skills/mcp.json:194`/`:408`. Claim STILL TRUE; the `:1585` citation in the Decision is stale line-drift and should be read as `:2165`.

### Finding — `file:line` citations are ungated

The `:1585` → `:2165` drift above is worth naming as a class problem rather than a typo.
The pack's own lookup order (`PREAMBLE.md`) is "governing doc → its `file:line` citations
into code → the ledger records", which makes those citations part of the compliance
surface. Nothing checks them. The staleness gate watches *whether a governed file changed*,
not whether the line a record points into still holds what the record says it holds — so a
citation degrades silently under ordinary insertions above it, and does so most
aggressively in exactly the files that attract the most additive change
(`config/entrypoint-unified.sh` has taken six unrelated blocks since this record's previous
anchor, moving this citation by ~580 lines).

The failure is quiet and asymmetric: a *stale* citation sends a reader to unrelated code,
which they will usually notice; a citation that has drifted onto *plausible but different*
code is the dangerous one, because it reads as confirmation. Both are worse than a citation
that names a symbol.

No gate is proposed here — building one is separate work, and the cheap mitigation is
cheaper: cite a stable anchor (a function or shell variable name, e.g.
`entrypoint-unified.sh` `_SR_ROUTER`) and let the line number be advisory, so a reader can
`grep` their way back when it drifts. Recorded so the next person re-verifying this pack
knows line numbers carry no guarantee.

## Re-verification — 2026-09-21 (`e57156a8ff72a4b84145b7de1d67d8d0c79fd41d`)

Tripped by `config/entrypoint-unified.sh` alone (`b680a7ae`, ADR-2094); `services/agentbox-manifest/src/tui_write.rs`, `mcp/consultants/antigravity/server.js` and `skills/mcp.json` are unchanged since the previous anchor. ADR-2094's edits to the entrypoint are three insertions for the Sovereign System One projection and touch no consultant surface.

Re-read at HEAD in a detached worktree: the projection is intact and unchanged in behaviour — `if [ -z "${AGENTBOX_ANTIGRAVITY_MODEL:-}" ]` guards `export AGENTBOX_ANTIGRAVITY_MODEL="$(agentbox-manifest toml-string --path consultants.antigravity.model …)"`, so the fixed precedence this record claims (pre-set env wins, then the manifest, then the registry default) still holds structurally. `bash -n config/entrypoint-unified.sh` → clean.

**Record correction made by this pass:** the Decision cited `config/entrypoint-unified.sh:1585` for that projection. It is at `:2223` at HEAD, and was already at `:2165` at the previous anchor `b680a7ae` (`git show b680a7ae:config/entrypoint-unified.sh | grep -n AGENTBOX_ANTIGRAVITY_MODEL`), so the citation was long-standing drift rather than anything ADR-2094 caused. It has been corrected in place. The claim itself was never affected — only the pointer to it. Claim STILL TRUE.

### Re-verified 2026-09-21 at 6669e9f3b22af1e2b651037cf39a4a551a346d3f

One governed path moved, `config/entrypoint-unified.sh`, in a COMMENT-ONLY hunk: `git diff 1639f86ab..6669e9f3b -- config/entrypoint-unified.sh` is 6 insertions and 1 deletion, all of them `#` lines. The ShellCheck directive above the jev-compaction plugin install carried its rationale inside the directive, which SC1125 rejects and which made ShellCheck ignore the whole directive; the rationale is now a separate comment above a bare `# shellcheck disable=SC2086`. No executable line changed anywhere in the file, and the shell ignores comments, so runtime behaviour is byte-identical. The consultant projection block (model selection read from the manifest at boot, environment winning, dated tariffs) is untouched: the hunk is in the jev-compaction plugin phase, hundreds of lines away, and none of its lines execute. Claim STILL TRUE.

## Re-verification — 2026-09-22 at d6b976271 (Sovereign Corpus landing)

**Governed changes:** `config/entrypoint-unified.sh`: exports `VAULT_REPO` (from `[vault].repo`, else derived from `VAULT_ROOT`; empty when unresolvable so the management API fails closed) and adds it to the vault-disabled `unset` list. Nothing else in boot order, gating or service start changed. **Decision unaffected** — none of these touches what this record decides. `verified_commit` moved to the landing commit. Gates at that commit: routing table current; forum e2e real mode 101/101 and stub 30/30 against this tree; management-api jest 88/88.

## Re-verification — 2026-09-26 at 6ea592ee0 (ADR-2111/2116 landing)

**Governed changes:** `config/entrypoint-unified.sh` only (`b25903ec8`, `2bf05d775`, `6ea592ee0`): permission-posture projection, session-default seeding, hook-timeout units, hook registry reconcile, AGENTS.md embed, Codex AGENTS.md/skills ownership, jev-compaction config fingerprint. None touches the consultant surface. The projection is intact: `if [ -z "${AGENTBOX_ANTIGRAVITY_MODEL:-}" ]` guarding `export AGENTBOX_ANTIGRAVITY_MODEL="$(agentbox-manifest toml-string …)"`, so pre-set env still wins, then the manifest, then the registry default. **Citation drift, not corrected in the Decision:** that block is now at `config/entrypoint-unified.sh:2411-2412`, not `:2223`; per the finding above, grep for `AGENTBOX_ANTIGRAVITY_MODEL`. `tui_write.rs`, `antigravity/server.js` and `skills/mcp.json` did not move. `bash -n` → clean. Claim STILL TRUE.
