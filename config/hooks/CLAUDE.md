# config/hooks — binding constraints

- **Not every file here is a hook.** Some are CLIs (`project-tracking-publish.cjs`, spawned by the management API) or helpers (`fleet-tab-name.sh`). Inventory: [`README.md`](README.md) (ADR-2068).
- **Two registration sites.** ROOT-session hooks are seeded into `~/.claude/settings.json` by `config/entrypoint-unified.sh`; PER-PROFILE hooks are projected into `workspace/profiles/<stack>/.claude/` by `services/agentbox-manifest/src/stacks.rs`. A new hook needs the right site (often both) plus a README row. Registration is reconcile-not-append: compare the recorded command against the canonical one so a stale entry self-heals.
- **Stdout reaches the model.** For `SessionStart` and `UserPromptSubmit`, anything a hook prints on stdout with exit 0 is injected into the model's context. Log to a file or stderr, never stdout.
- **Context injection uses the structured shape:** `{"hookSpecificOutput":{"hookEventName":"<Event>","additionalContext":"…"}}` (see `lib/hook-output.cjs`). Do not print bare prose.
- **`timeout` is in seconds**, not milliseconds. `8000` means over two hours.
- Hooks fail open: exit 0 on any internal error, keep the `|| true` suffix on registered commands, and never block a turn on a network call without a short bound.
- Registered paths use `/opt/agentbox/...`, never `/nix/store/...`.
