---
id: ADR-2093
title: Compact context by Jev judgement, verbatim, with email fenced out and a switch
date: 2026-09-18
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 0950527d349d53b9824432af1bd8f2031e32c849
verified_paths: [config/claude-plugins/jev-compaction/hooks/jev-compaction.ts, config/claude-plugins/jev-compaction/hooks/policy.mjs, config/entrypoint-unified.sh, lib/claude-code-binary.nix, tests/config/jev-compaction-policy.test.mjs]
owner: jjohare
review_trigger: the first measured residency bill that exceeds the summary path's re-read savings, a Claude Code function-hook API change, or a request to fence a class other than email
repo: agentbox
---

# ADR-2093 — Compact context by Jev judgement, verbatim, with email fenced out and a switch

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

1. **Claude Code is pinned at 2.1.276** (`lib/claude-code-binary.nix`), the first pin with
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
   plugin cache under the host-mounted `~/.claude` is content-compared to the baked tree and
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
