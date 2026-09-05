---
id: ADR-2057
title: Close the capability-gate gaps for podcast-cron, harness and precedent
date: 2026-09-05
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: any of the three gaps being closed, or a new supervised program landing without a manifest gate
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2020 (capability gating), legacy ADR-039 (apply classes in the system-manifest catalogue), ADR-2021 (skills lint)
---

# ADR-2057 — Close the capability-gate gaps for podcast-cron, harness and precedent

## Context

`docs/GOVERNANCE-capabilities.md` states the byte-identical-when-off invariant: a
disabled `[skills.*]` / `[dream_machine]` gate leaves no runtime trace. Three surfaces
do not satisfy it, found while diagramming the capability estate (AB-27.10, AB-22.13,
AB-28.8):

1. **`[program:podcast-cron]` is ungated.** Every other media/GPU program in `flake.nix`
   is wrapped in `lib.optionalString <gate>`; this one is not, and no
   `[skills.podcast*]` key exists in `agentbox.toml`. It is an unconditional,
   always-autostarted supercronic job, so the podcast ingest surface cannot be turned
   off from the manifest at all.
2. **`[skills.harness]` and `[skills.precedent]` are enforced by file presence, not by
   their gate.** Their registration blocks in `config/entrypoint-unified.sh` check only
   that the server file exists; they never read `.enabled`. Setting
   `[skills.harness] enabled = false` therefore does nothing — the MCP server is still
   registered. Every other `[skills.*]` gate is honoured at registration.
3. **Neither appears in the apply-class catalogue.** `management-api/lib/system-manifest.js`
   has no entry for `harness` or `precedent`, so neither carries an honest
   `live`/`boot`/`rebuild` apply class, which ADR-039 requires of every gate.

A related dead end: `[skills.harness].template_dir` is set in `agentbox.toml` but
`HARNESS_TEMPLATE_DIR` is never exported by the entrypoint, so `harness-bridge.js`
silently uses its hardcoded default. The manifest key is inert.

## Decision

**Proposed, not implemented** — every file that must change belongs to the runtime lane
(`flake.nix`, `agentbox.toml`, `config/entrypoint-unified.sh`,
`management-api/lib/system-manifest.js`). This ADR records the decision and the
acceptance test so the gaps are tracked rather than re-discovered; the edits are routed
to that owner.

The decision, when taken, is:

- `podcast-cron` gains a manifest gate (`[skills.podcast_ingest] enabled`, default
  matching today's shipped behaviour so the change is not a silent capability removal)
  and its supervisor block is wrapped in the corresponding `lib.optionalString`.
- The `harness` and `precedent` registration blocks read their manifest gate and skip
  registration when it is false, exactly as the other `[skills.*]` blocks do.
- All three gain `system-manifest.js` catalogue entries with honest apply classes.
- `template_dir` is either exported as `HARNESS_TEMPLATE_DIR` and read by
  `harness-bridge.js`, or removed from `agentbox.toml`. An inert manifest key is worse
  than no key: it advertises control that does not exist.

## Consequences

- Until this lands, `byte-identical-when-off` is **false** for three surfaces, and the
  governing doc's invariant overstates the estate. The invariant is not weakened to
  match; the gap is named in the doc's divergence list instead, because the invariant is
  the target and the code is what is wrong.
- Closing gap 2 is a behaviour change for anyone who set `enabled = false` and did not
  notice it was ignored: their harness/precedent MCP servers will stop registering. That
  is the correct outcome and should be called out in the change that lands it.
- Gap 1's gate must default to today's behaviour, or enabling the manifest key becomes a
  required migration step for existing deployments.

## Verification

Verification ran on the **uncommitted working tree** above
`89301ec7c911eab270c00a0cf81596d0d4f15535` and must be re-run at the landing commit;
`verified_paths` is therefore empty. `implementation_status: none` — this records
findings and a plan, not a change.

Evidence for each gap:

- `grep -n '^\[program:podcast-cron\]' flake.nix` → present with no enclosing
  `lib.optionalString`, unlike every other media/GPU program;
  `grep -n 'podcast' agentbox.toml` → no gate key.
- `grep -n 'harness-bridge\|precedent-bridge' config/entrypoint-unified.sh` → the two
  registration blocks, both conditioned on file presence only, with no read of
  `skills.harness.enabled` / `skills.precedent.enabled`.
- `grep -n 'harness\|precedent' management-api/lib/system-manifest.js` → no catalogue
  entry for either.
- `grep -n 'template_dir' agentbox.toml` → the key is set;
  `grep -c 'HARNESS_TEMPLATE_DIR' config/entrypoint-unified.sh` → **0**.

**Acceptance test for the landing change:** with `[skills.harness] enabled = false`, a
boot produces a workspace `.mcp.json` with no `harness-bridge` entry and no
`/opt/agentbox/mcp/servers/harness-bridge.js` process; the same for `precedent`; with
the podcast gate false, `supervisorctl status` lists no `podcast-cron`; and
`node scripts/agentbox-config-validate.js` exits 0 with the three new catalogue entries
present.
