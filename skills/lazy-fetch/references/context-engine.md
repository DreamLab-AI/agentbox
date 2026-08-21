# Context Engine and Progressive Discovery

Internals of the symbol-aware context engine (`lazy_context`, `lazy_gather`,
`lazy_watch`, `lazy_claudemd`) and how relevance builds over time.

## Context Engine

### Symbol Extraction

The context engine extracts symbols from source files using lightweight regex
patterns. No language server required. Supported languages:

| Language | Extracted Symbols |
|----------|------------------|
| TypeScript (.ts) | functions, classes, interfaces, types, consts, exports |
| JavaScript (.js) | functions, classes, consts, exports, module.exports |
| Python (.py) | functions, classes, async functions |
| Rust (.rs) | pub functions, structs, enums, traits |
| Go (.go) | functions, methods, struct types, interface types |
| Ruby (.rb) | methods, classes, modules |

Symbols are cached in `.lazy/context/symbols.json` and rebuilt on each
`gather` or `context` call.

### File Search

Three search strategies run in parallel when `lazy_gather` is called:

1. **Name match** -- file names containing any keyword from the task
2. **Content match** -- files containing keywords (via grep, respects .gitignore)
3. **Symbol match** -- symbols whose names contain keywords

Keywords are extracted by splitting camelCase, snake_case, and kebab-case,
then removing stop words and common verbs.

Results are merged, deduplicated, sorted, and presented as `@`-mentions for
Claude Code to read directly.

## Progressive Discovery

Context builds up over time through four signals:

1. **Watch** (`lazy_watch`) -- tracks file change frequency from the last 20
   git commits. Files with more recent changes score higher. Counts decay by
   50% each time watch runs, so stale files fade out naturally.

2. **Access log** -- stored in `.lazy/context/access.json`. Aggregates change
   counts across multiple watch invocations, giving a cumulative view of
   which files matter.

3. **Gather** -- each `lazy_gather` call rebuilds the full symbol index and
   records which files were relevant to which task descriptions.

4. **Session hooks** -- `session-start.sh` runs both `watch` and `claudemd`
   automatically at session start, ensuring fresh context before any work
   begins.

The net effect: files that matter to the current work surface first. Files
that have not been touched recently fade into the background. No manual
curation required.
