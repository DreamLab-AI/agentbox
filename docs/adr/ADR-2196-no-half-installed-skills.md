---
id: ADR-2196
title: No skill ships half-installed; its tool is baked or the skill is deleted
date: 2026-11-11
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: f8ab8d800f545ddfcacaa670641651a4d13f74c8
verified_paths: []
owner: jjohare
review_trigger: the next image build (confirm semgrep, gitleaks, trivy and jj are on PATH, and that the podcast cron finds flock and ontomark); any new skill whose tool is not in the image; a gated skill the router offers with its gate off
repo: agentbox
domain: GOVERNANCE-capabilities
relates: [ADR-2083, ADR-2091, ADR-2110, ADR-2192, ADR-2195]
evidence_class: test
acceptance_boundary: Router, lint, corpus, manifest and crate tests pass on this commit, and routing was re-measured through the runtime router path. The four baked tools, the podcast cron PATH and the openai-codex unwiring are Nix edits that have not been evaluated or built.
---

# ADR-2196: No skill ships half-installed; its tool is baked or the skill is deleted

## Context

The skill audit of 2026-11-11 found skills in a state the router could not act on honestly: nine
marked `not-installed` (their tool absent and installable only at run time, which the estate
forbids), two marked `superseded` but still wired into the build (`playwright`,
`openai-codex`), three promising MCP servers nothing registered (`cuda`,
`jupyter-notebooks`, `qe-browser`), a gated payment skill offered with its gate off, and a
`status: gated` skill whose gate was on. The operator ruled that none of these may remain.

## Decision

1. **Bake or delete.** A skill whose tool is not in the image is either given the tool through
   Nix or deleted. `not-installed` and `superseded` are no longer used in the tree.
   - Baked (`basePackages`, ungated): `semgrep`, `gitleaks`, `trivy` for
     `security-testing`; `jujutsu` (`jj`) for `agentic-jujutsu`, rewritten around the CLI.
   - Deleted, 13: `defense-security`, `scrapling`, `notebooklm`, `clipcannon`,
     `paperbanana`, `echoloop`, `open-montage`, the three `flow-nexus-*` (a hosted
     platform), `playwright` and `openai-codex` with all their build wiring (`codexMcpPkg`,
     its boot probe, prefetch entries, stacks, probes). The openai-codex MCP server was baked but
     never registered; this retires it, closing ADR-2083's open follow-up.
   - Adapted to what exists: `cuda` (nvcc and compute-sanitizer; Nsight on the host),
     `jupyter-notebooks` (NotebookEdit and the code-interpreter kernel), `qe-browser` (the live
     agentic-qe tools plus the browser sidecar). Their unregistered servers are deleted.
   - Restored after review: `podcast-bulk-ingest` documents a baked binary; only an optional
     OntoCast step needs a missing tool, and it is now marked optional.
2. **Gates are honoured by the router.** A skill naming `gate:` in its frontmatter is offered only
   while that key is literally `true` in the `agentbox.toml` beside the skills tree, failing
   closed (`loadCandidates`, `config/hooks/lib/skill-route.cjs`). `payment-router` is no
   longer offered; `voyager-skill-library` routes as live.
3. **Deletion is checked for value.** An independent audit of every deletion found no other skill
   to restore, and one passage worth keeping, folded into `bencium-creative`.
4. **The podcast pipeline's code and PATH faults are fixed; it runs again after the next rebuild.** Its cron PATH carries `flock` and `ontomark`;
   `run-promote.sh` passes `$LOOM_BASE_URL`; the finished EXP-B8 cron block is removed
   (verdict WITHDRAW, already recorded in ADR-2110). New transcripts still depend on YouTube lifting its current HTTP 429 rate limit on subtitle downloads; each run is capped at 15 episodes (`max_episodes_per_run`).

## Consequences

- 124 skills. `router-only` remains for index skills behind another (`skill-router`,
  `browser-automation`); `gate:` is the only way to ship a deliberately-off skill.
- The `skills.browser.playwright` switch is removed from the manifest, schema, validator, TUI,
  flake and goldens. `skills.browser.qe_browser` is now equally dead (it sets an environment
  variable nothing reads) and is left for a separate cleanup.
- semgrep's `--config auto` and trivy's vulnerability database fetch data at run time; the
  skill gives offline forms. YouTube currently rate-limits subtitle downloads (HTTP 429), which
  still stops new podcast transcripts; that is not a code fault.
- Monday's promote stage will resume its up-to-15 Gemini judge calls (`GOOGLE_API_KEY` is set).

## Verification

At `f8ab8d800f545ddfcacaa670641651a4d13f74c8` (an uncommitted tree's base until re-stamped):
- `bash skills/lint-skills.sh` clean, 124 skills; skill-count, routing-table and manifest
  validator pass; router jest suites pass, including a new gate test.
- Routing through `lib.route` with the shipped config: original 86 labelled cases 83 of 86 on two
  runs.
- `services/agentbox-manifest` and `services/podcast-ingest` cargo tests pass (163 in the latter).
- Podcast hand run against scratch copies: listing found 1,144 unseen episodes (then 429); one
  re-run episode gave 10 assertions, 1 ledger page, 8 draft pages; promote dry run 153 candidates;
  submit dry run 18 unchanged, 2 unresolved, 22 blocked, 0 failed.
- Not built: every Nix change above.
