# Skill Builder — Eval Suite Template

Use this template to document how a newly created skill should be validated
before it is registered or shared. Copy it into the new skill's
`references/` directory as `eval-suite.md` and fill in the sections.

No automation is required. This is a manual review checklist and
prompt-based test plan. For an automated with/without-skill benchmark, use
Anthropic's `skill-creator` workflow (see `SKILL.md` → Evals); for measuring
whether a skill's wording raises success on a scored task, use
`skill-tuning`.

---

## Skill Under Test

```
Name:         [skill name, lowercase-hyphen]
Directory:    skills/[skill-name]/   (master copy)
SKILL.md:     [path]
Created:      [date]
```

---

## Structural Checks

Run these before any prompt testing.

- [ ] `SKILL.md` opens with valid YAML frontmatter (`---` ... `---`)
- [ ] `name` matches the directory, lowercase-hyphen, <=64 chars
- [ ] `description` <=1024 chars, states what and when (and when-not)
- [ ] `SKILL.md` body <=250 lines, or `references/` holds a readable file
- [ ] Skill directory sits under the master copy (`skills/<name>/`), not a
      harness's own skills directory
- [ ] All linked sibling files exist (check every `[text](path)` reference)
- [ ] No host-project specifics leaking into shared prose (internal URLs,
      environment-specific paths) unless the skill is deliberately internal
- [ ] No placeholder text left in the final skill (`[Your instructions
      here]`, `TODO`, etc.)
- [ ] `bash skills/lint-skills.sh` exits 0

---

## Prompt-Based Tests

For each test case: open a fresh session with the skill available, run the
prompt, and record whether the skill was triggered correctly and whether the
output met the acceptance criterion.

### Test 1: Description Trigger

**Prompt**: `[Paste the core trigger phrase from the description]`

**Expected**: Skill is autonomously matched and activated.

**Pass criterion**: Claude/Codex invokes the skill without being explicitly
told to.

| Run | Result | Notes |
|-----|--------|-------|
| 1 | pass / fail | |
| 2 | pass / fail | |

---

### Test 2: Quick Start Path

**Prompt**: `[Describe the common use case in natural language]`

**Expected**: The skill follows its Quick Start section and produces
correct output.

| Run | Result | Notes |
|-----|--------|-------|
| 1 | pass / fail | |

---

### Test 3: Step-by-Step Path

**Prompt**: `[Describe a more complex use case requiring the step-by-step section]`

**Expected**: All steps executed in order, no hallucinated steps.

| Run | Result | Notes |
|-----|--------|-------|
| 1 | pass / fail | |

---

### Test 4: Negative Trigger (should NOT activate)

**Prompt**: `[A query that sounds adjacent but should not trigger this skill]`

**Expected**: Skill is not activated; a different skill is used, or the
agent answers without any skill.

**Pass criterion**: The when-not boundary in the description is respected.

| Run | Result | Notes |
|-----|--------|-------|
| 1 | pass / fail | |

---

### Test 5: Reference Navigation

**Prompt**: `[A query that requires information only available in references/]`

**Expected**: The agent navigates to the reference file and returns
accurate information.

| Run | Result | Notes |
|-----|--------|-------|
| 1 | pass / fail | |

---

## Issues Log

| # | Test | Description | Status |
|---|------|-------------|--------|
| 1 | | | open / fixed |

---

## Sign-Off

| Reviewer | Date | Verdict |
|----------|------|---------|
| | | pass / fail / conditional |

Conditional pass: list remaining issues that must be resolved before the
skill is registered or shared.
