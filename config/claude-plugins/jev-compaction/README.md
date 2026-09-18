# jev-compaction — agentbox Claude Code plugin

Replaces Claude Code's compaction *summary* with Jev decisions (ADR-2093): every
non-pinned tool call is scored twice by TypeSafe System One — keep the call? keep its
result verbatim? — and only what Jev lets go is dropped or truncated. User and assistant
text is never rewritten. Library and judgement design are
[tamaratran/fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction)
(MIT), vendored under `lib/` at upstream `e3f262a`; `lib/LICENSE` is theirs.

What agentbox adds, in `hooks/`:

| | |
|---|---|
| **Taint gate** | A transcript containing any tool whose name starts with a `taintTools` prefix (default: the private email gateway, Gmail) or a `Skill` load of a `taintSkills` skill (default: `email-search`) is **never sent to Jev**; the built-in summary runs and a toast says why. Decided from the messages being compacted, per compaction, so it cannot be stale. `hooks/policy.mjs` is the whole rule, tested in `tests/config/jev-compaction-policy.test.mjs`. |
| **Switch** | `/jev-compact on` · `/jev-compact off` · `/jev-compact status`. Persisted in the plugin store across sessions. Starting position is `enabledByDefault`, projected by the entrypoint from `[features.jev_compaction].enabled_by_default`. |
| **Fail-open** | Any throw, missing `TYPESAFE_API_KEY`, reduction under `minReductionRatio`, or a tainted session ⇒ the built-in compaction, with one `jev-compaction:` log line naming the reason. |

## Gate and registration

`[features.jev_compaction]` in `agentbox.toml`. When `enabled = true` the entrypoint sets
`env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = "1"` in `~/.claude/settings.json`, registers this
directory's parent as the `agentbox` marketplace and enables `jev-compaction@agentbox`;
when `false` it retracts all three (byte-identical-when-off). BOOT-class. Needs Claude Code
≥ 2.1.274 (`lib/claude-code-binary.nix`).

## Egress

Every compaction sends the conversation — user and assistant text, tool inputs (≤1,000
chars each), tool-result *sizes* (never their contents) — to TypeSafe. That is an operator
decision recorded in ADR-2093 with the email carve-out above; it widens ADR-2090, which
covered the routing prompt alone. To fence another must-not-leave class per project, add its
tool prefix to `taintTools` (plugin option) — no code change.

## Cost

Measured 2026-09-18 (`skills/system-one/references/estate-integration.md` §8): Jev ≈ $0.005
per compaction, ≈ $0.05/hour for a ten-agent swarm. The verbatim-kept context is the real
cost — ≈ $14–18 per busy agent-hour in cache reads against the built-in summary. Watch it via
`/jev-compact status` (last outcome) and the session cost line.

## Development

```sh
node --test tests/config/jev-compaction-policy.test.mjs         # the gate and the switch
claude plugin validate config/claude-plugins/jev-compaction/.claude-plugin/plugin.json
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir config/claude-plugins/jev-compaction
```
