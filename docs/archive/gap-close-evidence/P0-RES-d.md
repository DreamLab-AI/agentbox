# P0-RES-d — Script-queryable skill-count source of truth

**Item:** RES-d (PRD-019, ADR-037 D8, DDD-017 §8 `SkillCountCheck`)
**Wave:** P1 in the register (CI-gated, no liveness canary); actioned in the P0 wave alongside COM-14
**Target tier:** `integrated` (agentbox source side); `released` when the canon pins it
**Canary:** none — RES-d registers a **CI gate**, not a liveness canary (ADR-037 D8; it wires no live loop)
**Captured against SHA:** `4c5418b5399f9dc5285677b1d4916e7edff8c333` (branch `gap-close/2026-07`)
**Timestamp (UTC):** 2026-07-08T10:24:44Z

## Falsification statement (from PRD-019)

> RES-d is falsified if a second skill count can appear in the tree without CI failing, or if the
> count is not queryable non-interactively by the canon counter.

## What changed

| File | Change |
|---|---|
| `scripts/skill-count-check.js` | **New.** Counts one `SKILL.md` per skill directory as the single source of truth; scans `README.md` and `skills/SKILL-DIRECTORY.md` for headline count claims (floor `N+ skills`, exact `N active skills`, router `for [all] N skills`) and fails on divergence. Prints machine-readable JSON to stdout (the `count` field is what the canon `DriftCounter` reads); exit 1 on drift, 0 clean. Exposes `checkSkillCount()` for reuse. |
| `scripts/agentbox-config-validate.js` | The check runs **in the same validator pass** (ADR-037 D8). A divergence is a blocking `E-SKILL1` error; an infrastructure failure of the check itself degrades to advisory `W067` rather than crashing the manifest validator. |
| `skills/SKILL-DIRECTORY.md` | Reconciled the three drifted headline counts (`109`/`105`/`104`) to the filesystem truth `115` so the tree carries one consistent number and the gate is green. |

Claim matching is deliberately narrow so per-skill sub-counts (`AEC studio: 36 skills`,
`AgentDB family (4 skills)`, `19 skills provide MCP servers`) are not mistaken for headline totals —
verified below.

## Receipts

### 1. Gate fires on the pre-existing drift (before reconciliation)

```
$ node scripts/skill-count-check.js
...
E-SKILL1 skill-count drift: skills/SKILL-DIRECTORY.md:3 states 109 skills but skills/*/SKILL.md counts 115
E-SKILL1 skill-count drift: skills/SKILL-DIRECTORY.md:33 states 105 skills but skills/*/SKILL.md counts 115
E-SKILL1 skill-count drift: skills/SKILL-DIRECTORY.md:39 states 104 skills but skills/*/SKILL.md counts 115
E-SKILL1 skill-count drift: skills/SKILL-DIRECTORY.md:292 states 104 skills but skills/*/SKILL.md counts 115
--- exit: 1 ---
```

The two `90+ skills` floor claims in `README.md` correctly pass (`115 >= 90`); no false positives on
sub-counts.

### 2. Count matches the manual filesystem count, queryable non-interactively (JSON)

```
$ ls -d skills/*/SKILL.md | wc -l
115
$ node -e "console.log(require('./scripts/skill-count-check').checkSkillCount().count)"
115
$ node scripts/skill-count-check.js   # stdout JSON, DriftCounter reads .count
{ "count": 115, "source": "skills/*/SKILL.md", ..., "divergences": [], "ok": true }
```

Falsification clause 2 refuted: the count is queryable non-interactively via stdout JSON.

### 3. Gate green after reconciliation; runs in the validator pass

```
$ node scripts/skill-count-check.js ; echo exit=$?
{... "ok": true}
exit=0

$ node scripts/agentbox-config-validate.js agentbox.toml 2>&1 | grep -E "E-SKILL1|W067" \
    || echo "neither present -> skill-count check ran clean, no divergence"
neither present -> skill-count check ran clean, no divergence
```

The validator's remaining `E016`/`W017`/`W039`/`W045`/`W063` output is **pre-existing manifest-schema
drift** explicitly listed Out of Scope in PRD-019 (`ruvnet_brain`, `mcp_startup_timeout_ms`,
`mcp_tool_timeout_ms`) — not introduced by this change and not part of the nine owned items.

### 4. A second divergent count cannot pass CI (falsification clause 1)

Controlled fixture (2 real `SKILL.md` files; docs claim `5`/`7`), through the validator's exact
`E-SKILL1` error path:

```
count: 2 ok: false divergences: 2
E-SKILL1: skill-count drift — README.md:1 states 5 skills but skills/*/SKILL.md counts 2 (...)
E-SKILL1: skill-count drift — skills/SKILL-DIRECTORY.md:1 states 7 skills but skills/*/SKILL.md counts 2 (...)
--- exit: 1 (validator would fail CI on drift) ---
```

Falsification clause 1 refuted: introducing a divergent count makes the validator pass emit `E-SKILL1`
and exit non-zero.

## Maturity & honesty

- **Tier claimed:** `integrated` (source side). `released` is the canon's to award when it pins the
  count in a release manifest and its `DriftCounter` consumes this script — not claimed here.
- **No canary:** RES-d wires no live loop, so per ADR-004 Decision 3 / ADR-037 D8 it registers a CI
  gate, not a liveness canary. No `CANARY-AB-*` is registered for it.
