# Eval Suite Template — Skill Validation

Use this template to document how a newly created skill should be validated before it is published or shared. Copy this file into your skill directory as `eval-suite-template.md` (or rename to `EVAL.md`) and fill in the sections.

No automation is required. This is a manual review checklist and prompt-based test plan. Automated eval runners are future work.

---

## Skill Under Test

```
Name:         [skill name]
Directory:    ~/.claude/skills/[skill-name]/
SKILL.md:     [path]
Created:      [date]
```

---

## Structural Checks

Run these before any prompt testing.

- [ ] `SKILL.md` opens with valid YAML frontmatter (`---` ... `---`)
- [ ] `name` ≤ 64 characters
- [ ] `description` ≤ 1024 characters and answers both _what_ and _when_
- [ ] `SKILL.md` body ≤ 5 KB (measure with `wc -c SKILL.md`)
- [ ] Skill directory is directly under `~/.claude/skills/` — no extra nesting
- [ ] All linked sibling files exist (check every `[text](path)` reference)
- [ ] No host-project specifics (product names, internal URLs, environment-specific paths)
- [ ] No placeholder text left in templates (`[Your instructions here]`, `TODO`, etc.)

---

## Prompt-Based Tests

For each test case below: open a fresh Claude session, install the skill, and run the prompt. Record whether the skill was triggered correctly and whether the output met the acceptance criterion.

### Test 1: Description Trigger

**Prompt**: `[Paste the core trigger phrase from the description]`

**Expected**: Skill is autonomously matched and activated.

**Pass criterion**: Claude invokes the skill without being explicitly told to do so.

| Run | Result | Notes |
|-----|--------|-------|
| 1 | pass / fail | |
| 2 | pass / fail | |

---

### Test 2: Quick Start Path

**Prompt**: `[Describe the 80% use case in natural language]`

**Expected**: Claude follows the Quick Start section and produces correct output.

**Pass criterion**: Output matches the documented expected output or structure.

| Run | Result | Notes |
|-----|--------|-------|
| 1 | pass / fail | |

---

### Test 3: Step-by-Step Path

**Prompt**: `[Describe a slightly more complex use case that requires the Step-by-Step section]`

**Expected**: Claude follows the step-by-step guide to completion.

**Pass criterion**: All steps executed in order, no hallucinated steps.

| Run | Result | Notes |
|-----|--------|-------|
| 1 | pass / fail | |

---

### Test 4: Negative Trigger (Should NOT activate)

**Prompt**: `[A query that sounds adjacent but should not trigger this skill]`

**Expected**: Skill is NOT activated; Claude either uses a different skill or answers without it.

**Pass criterion**: Skill boundary is respected.

| Run | Result | Notes |
|-----|--------|-------|
| 1 | pass / fail | |

---

### Test 5: Sibling File Navigation

**Prompt**: `[A query that requires information only available in REFERENCE.md or EXAMPLES.md]`

**Expected**: Claude navigates to the sibling file and returns accurate information.

**Pass criterion**: Answer cites or accurately reflects sibling file content.

| Run | Result | Notes |
|-----|--------|-------|
| 1 | pass / fail | |

---

## Issues Log

Record problems found during eval here. Each entry should include the test that surfaced it, a description, and the fix applied (or a link to an issue if deferred).

| # | Test | Description | Status |
|---|------|-------------|--------|
| 1 | | | open / fixed |

---

## Sign-Off

| Reviewer | Date | Verdict |
|----------|------|---------|
| | | pass / fail / conditional |

Conditional pass: list remaining issues that must be resolved before the skill is shared.
