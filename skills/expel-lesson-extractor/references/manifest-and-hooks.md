# Manifest Gates, Hook Registration, and Implementation Notes

## Manifest Gates

```toml
[features.expel_lesson_extraction]
enabled              = false  # set true to activate post-task lesson extraction
max_lessons_per_task = 5      # cap on lessons extracted per trajectory; prevents noise flood
min_confidence       = 0.6    # minimum confidence to store a lesson
confidence_floor     = 0.3    # lessons below this floor are auto-demoted to archive namespace
archive_after_days   = 30     # demote suppressed lessons to archive after this many days
```

Validator rules:
- `W043`: `features.expel_lesson_extraction.enabled = true` without
  `skills.code_interpreter.enabled = true` is accepted (lesson distillation
  does not require a KernelSession) but noted — lesson quality for code tasks
  is lower without ExecutionTrace grounding.
- `E044`: if `skills.voyager_skill_library.enabled = true`, then
  `skills.code_interpreter.enabled = true` is also required (Voyager's
  VerificationGate needs a KernelSession).

## Hook Registration

The lesson extractor is invoked via the post-task hook mechanism defined in
`/home/devuser/.claude/CLAUDE.md` §Auto-Learning Protocol. The hook calls
`python3 mcp/expel/distil.py` with the following arguments:

```bash
python3 /opt/agentbox/mcp/expel/distil.py \
  --trajectory-id "$TASK_ID" \
  --outcome "$TASK_SUCCESS" \
  --trace-urns "$TRACE_URNS_COMMA_SEPARATED"
```

The hook fires only when `[features.expel_lesson_extraction].enabled = true`.
The `distil.py` script exits 0 on success (lessons written or cleanly skipped),
exits 1 on unrecoverable error (LessonRedactionFailed, write failure).

## Implementation Notes

- The implementation lives at `mcp/expel/distil.py`. See that file for the
  full handler including privacy-filter integration, LLM call, and RuVector
  write logic.
- Lessons are written to RuVector using `mcp__claude-flow__memory_store` only.
  Never use raw SQL. Never use `claude-flow memory *` CLI commands. Both
  bypass the bge-small-en-v1.5 (384-dim, via Xinference) embedding pipeline and
  produce entries invisible to HNSW semantic search (ADR-015 mandate).
- The `value` field passed to `memory_store` must be plain-text with the
  `rule` field appearing first (it is the primary semantic signal for
  embedding). The full JSON record is appended after a ` | ` separator so
  that the structured fields are retrievable on exact key lookup.
- URNs are minted via `management-api/lib/uris.js`. Never construct URNs with
  ad-hoc string formatting in application code.
