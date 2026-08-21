# Contradiction Detection and Archive Policy

## Contradiction Detection

Contradiction detection runs **sampled** (1 in 10 retrievals) to bound cost,
per ADR-019 §Contradiction detection.

When a `DistilledLesson` is retrieved at task start AND the sample check
fires AND the current trajectory completes:

1. Call the LLM judge with the lesson's `rule` and the trajectory's
   observable outcomes (privacy-filtered).
2. Judge answers: "Does this trajectory's outcome contradict the rule?
   Answer JSON: {\"contradicts\": bool, \"reason\": string}".
3. If `contradicts: true`: decrement `confidence -= 0.1`;
   increment `contradiction_count`. Update the lesson record via
   `mcp__claude-flow__memory_store` with `upsert=true`.
4. If `confidence < [features.expel_lesson_extraction].confidence_floor`
   (default 0.3): set `active = false`, move to `code-harness-lessons-archive`
   namespace via a compensating `memory_store` + note in the original record.

Conflict ranking at retrieval time: when multiple active lessons conflict,
rank by `confidence × recency_weight` where
`recency_weight = exp(-days_old / 30)`. Apply the top-ranked lesson; include
lower-ranked conflicting lessons as "alternative views" in the context block.

## Archive Policy

| Condition | Action |
|---|---|
| `active = false` AND older than `[features.expel_lesson_extraction].archive_after_days` (default 30) | Move to `code-harness-lessons-archive`; retain original for audit |
| `contradiction_count >= 5` AND `confidence >= floor` | Flag for manual review; do not auto-archive |
| Lesson references a `VerifiedSkill` URN that no longer resolves | Flag as stale; decrement confidence by 0.05 |

Archive is a compensating write (store to archive namespace, mark original
`active=false`). RuVector MCP does not support delete; the original record is
retained with `active=false` to preserve audit trail.
