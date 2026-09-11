# Diverged patches — codex-companion vs the baked plugin

Context: the live `/codex:*` commands run from the Claude Code plugin
`codex@openai-codex` (`~/.claude/plugins/installed_plugins.json`), whose
`installPath` is a Nix-store symlink resolving to the same flake bake as
`/opt/agentbox/plugins/codex-plugin-cc/plugins/codex` (verified 2026-09-09:
both `readlink -f` to the identical `/nix/store/8xw4fqway8...` path). This
skill's own `scripts/`, `commands/`, `agents/`, `hooks/`, `schemas/`,
`prompts/` and nested `skills/` tree were never executed — they looked
live but were dead weight, and 15 of the ~39 files shared with the baked
tree had silently diverged (md5-verified 2026-09-09) because someone
edited this copy believing it was load-bearing.

The dead, non-diverged files (identical to the baked plugin) were deleted
outright. The 15 files below carry real content differences and are kept
here, unmodified, so the queen can decide what (if anything) belongs
upstreamed into the flake overlay that builds
`/opt/agentbox/plugins/codex-plugin-cc`. **None of these files execute.**
Behavioural fixes must go through the flake overlay, not this skill.

## What actually differs

Most of the divergence is the mirror image of the same fact: this copy is
an **older lineage** that was never refreshed when the baked plugin grew
new features, plus a handful of specific hand-edits layered on top of that
older base.

### Baked-only features missing from this copy (not present here — nothing to upstream, these are just gaps from being stale)
- `externalAgentConfig/import` RPC + `commands/transfer.md` + `scripts/lib/claude-session-transfer.mjs` (whole `transfer` subcommand family)
- `requestAttestation` app-server option
- `reuseExistingBroker` / `loadBrokerSession` broker reuse path
- Session-scoped job cancellation (`filterJobsForCurrentSession`, `getCurrentSessionId`) in `job-control.mjs`
- `formatCommandFailure` import and inline-diff byte/file-count helpers in `git.mjs`
- `getCodexAuthStatus` / `importExternalAgentSession` in `codex.mjs` (renamed/refactored to `getCodexLoginStatus` in this copy)
- Top-level `try { main() } catch` error trap in `stop-review-gate-hook.mjs` (this copy lets `main()` throw uncaught)
- stderr capture on unexpected app-server exit in `app-server.mjs`

### Specific hand-edits in this copy, worth the queen's attention
- **`agents/codex-rescue.md`**: drops `model: sonnet` from frontmatter, and
  the spark-mapping line names `gpt-5.6-luna` instead of baked's
  `gpt-5.4-mini` as the "concrete model name" example — looks like a
  deliberate model-name update that raced ahead of the baked copy's own
  (older) example.
- **`commands/rescue.md`**: routes via `context: fork` and a plain
  "Route this request to the `codex:codex-rescue` subagent" instruction,
  dropping baked's explicit `Agent` tool invocation
  (`allowed-tools: Bash(node:*), AskUserQuestion, Agent`) and its warning
  about forked general-purpose subagents not exposing the `Agent` tool.
  This is commit `5b3a08b26` ("update Codex routing"). Given the baked
  plugin still uses the `Agent`-tool form, **this local routing change has
  had zero effect on the live behaviour** (the baked copy is what
  actually runs) — worth checking whether the routing problem it was
  meant to fix still exists upstream.
- **`commands/cancel.md`, `commands/result.md`, `commands/status.md`**:
  each drops the quotes around `$ARGUMENTS`
  (`"$ARGUMENTS"` → `$ARGUMENTS`). This looks like an accidental
  regression (unquoted expansion word-splits), not an intentional fix —
  flagging rather than recommending upstreaming.
- **`prompts/adversarial-review.md`**: drops the
  `{{REVIEW_COLLECTION_GUIDANCE}}` template placeholder that baked's
  version still substitutes — likely stale relative to a template
  variable baked gained later, not a deliberate removal.
- **`scripts/codex-companion.mjs`**, **`scripts/lib/app-server.mjs`**,
  **`scripts/lib/codex.mjs`**, **`scripts/lib/git.mjs`**,
  **`scripts/lib/job-control.mjs`**, **`scripts/lib/process.mjs`**,
  **`scripts/lib/app-server-protocol.d.ts`**,
  **`scripts/session-lifecycle-hook.mjs`**,
  **`scripts/stop-review-gate-hook.mjs`**: no deliberate improvement
  identified beyond the `getCodexAuthStatus` → `getCodexLoginStatus`
  rename threaded through `codex.mjs` / `stop-review-gate-hook.mjs`
  (arguably clearer naming, but paired with dropping the
  `requiresOpenaiAuth` gate baked still checks before suggesting
  `codex login`). Everything else here is the older-lineage gap list
  above.

## Verdict

Nothing here looks urgent enough to force into the flake overlay
unreviewed. The `getCodexLoginStatus` rename and the un-acted-on
`commands/rescue.md` routing change are the two most plausibly-intentional
candidates; the unquoted `$ARGUMENTS` in three command files looks like a
regression to fix in the baked source, not to import. The rest is this
copy simply predating features the baked plugin has since grown.
