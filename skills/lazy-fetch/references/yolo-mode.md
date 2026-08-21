# Yolo Mode

Yolo mode parses a PRD (Product Requirements Document) markdown file into
sprints and generates a master prompt for fully autonomous execution.

## Flow

1. **Start**: `lazy_yolo_start(prd_file)` -- parse PRD, create sprint plan,
   take pre-yolo snapshot, return master prompt with full instructions.
2. **Execute**: for each sprint, gather context, implement tasks (using
   blueprints where appropriate), validate with `lazy_check`.
3. **Advance**: `lazy_yolo_advance(notes)` -- run validation + security gate.
   If passed, mark sprint done and advance. If failed, fix and retry (max 3
   attempts per sprint).
4. **Report**: `lazy_yolo_report()` -- generate scorecard with first-pass
   rate, total retries, per-sprint timing and attempt counts.

## PRD Format

PRDs should use `##` headings as sprint/phase boundaries and bullet points
(`-` or `*`) as tasks within each section. If the PRD is unstructured (no
sections with bullet points), tasks are auto-divided into three sprints:
Foundation, Core Features, and Polish.

## Dry Run

`lazy yolo <prd> --dry-run` previews the sprint plan without writing any
state, so you can review the breakdown before committing.

## Event Log

Every yolo run logs structured events to `.lazy/runs/<run-id>/events.jsonl`:
start, validation attempts, sprint completions, failures, and overall
completion. The report command reads these events for the scorecard.
