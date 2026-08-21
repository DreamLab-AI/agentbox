# Write Gate and Retrieval

## Write Gate

Before any lesson is written, the following checks must pass in order:

1. **Trajectory length gate**: `len(trace_urns) >= 3`. Fewer than 3 traces
   → no lesson stored (PRD-008 C4). Exit cleanly.
2. **Privacy filter gate**: Pass the trajectory evidence through
   `PrivacyFilterPort` (ADR-008). If the filter is unavailable, **drop the
   lesson** and emit `LessonRedactionFailed` event. Never write unfiltered
   evidence to RuVector.
3. **LLM extraction gate**: Call the extraction prompt. If the LLM returns
   an empty list `[]`, no lesson is stored. This is a normal outcome for
   trajectories with no generalisable signal.
4. **Evidence grounding gate**: Each extracted lesson must have a non-empty
   `evidence_traces` list containing at least one real trace URN. Lessons
   without grounded evidence are discarded (not stored).
5. **Confidence gate**: Discard lessons where initial confidence would be
   below `[features.expel_lesson_extraction].min_confidence` (default 0.6).
6. **Volume cap**: At most `[features.expel_lesson_extraction].max_lessons_per_task`
   (default 5) lessons are written per trajectory invocation. Excess lessons
   are discarded by rank (lowest-confidence first).

All checks run before any write to RuVector. There is no partial write.

## Retrieval at Task Start

The skill-router and `codeact` SKILL.md both include a pre-task step. Agents
implementing this skill must run the following search at task start before
the main task prompt:

```python
results = mcp__claude-flow__memory_search(
    query=task_keywords,  # Derived from task description
    namespace="code-harness-lessons",
    limit=5,
)
# Filter to active=True lessons only (inactive lessons have confidence < floor)
active = [r for r in results if '"active": true' in r.get("value", "")]
```

Inject retrieved lessons into the agent context as a **"Prior experience:"
block** before the main task prompt. Budget: ≤ 400 tokens total for this
block. If retrieved content exceeds the budget, truncate at natural lesson
record boundaries (never mid-record).

```
Prior experience (from code-harness-lessons):
1. [scope: cf-d1-pagination, confidence: 0.8]
   IF Cloudflare D1 paginated query THEN cursor on rowid not LIMIT/OFFSET
2. [scope: kernel-timeout, confidence: 0.7]
   IF data load >25 min THEN chunk into kernel.exec calls every 10 min
...
```
