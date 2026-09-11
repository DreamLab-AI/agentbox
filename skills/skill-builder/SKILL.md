---
name: skill-builder
description: >-
  Author a new Claude Code / Codex Agent Skill or audit an existing one
  against the estate's adopted authoring contract: correct frontmatter
  (name/description rules, which keys are portable vs harness-specific), the
  SKILL.md + references/ + scripts/ + assets/ progressive-disclosure layout,
  and the master-copy registration model. Use when scaffolding a new skill
  directory, writing or reviewing YAML frontmatter, deciding whether a field
  belongs in shared frontmatter or a Codex agents/openai.yaml sibling, or
  checking a skill will pass skills/lint-skills.sh. Not for cross-link/prose
  consistency across an existing corpus (docs-alignment), scaffolding from a
  PRD (prd2build), empirically tuning a skill's wording against a measured
  reward (skill-tuning), or general code generation without skill packaging.
compatibility: "Targets both harnesses: Claude Code and Codex both parse SKILL.md per the agentskills.io spec. Claude registration is registered-skills.txt -> the harness's personal skills directory (live). Codex registration is codex-registered-skills.txt -> ~/.codex/skills, reconciled at boot by the same reconciler (wired 2026-09-09); Codex caps its always-loaded skill index at about 8,000 characters, so that manifest stays short."
---

# Skill Builder

Authors and audits skills against the contract below, adopted 2026-09-09 from
a live-verified reading of agentskills.io, Claude Code's own docs, and the
vendored ruflo/Codex frontmatter validator. It supersedes this skill's own
prior guidance (Title Case names, flat `REFERENCE.md`/`EXAMPLES.md`, "no
other frontmatter fields recognised", mandatory placement under a harness's
own skills directory) -- all four were independently wrong; see
[references/field-spec.md](references/field-spec.md) for the falsification
evidence.

## When to use

- Creating a new skill from scratch.
- Auditing an existing skill for spec compliance before a rebuild.
- Generating a skill directory scaffold.
- Deciding which frontmatter key a piece of metadata belongs in.

**When NOT to use:** invoking an existing skill directly (this skill only
authors/audits); validating prose/cross-link consistency across the corpus
(`docs-alignment`); scaffolding from a PRD (`prd2build`); measuring whether a
skill's wording actually raises an agent's success rate on a bounded,
scoreable task (`skill-tuning` -- see Evals below); general code generation
with no skill packaging.

## `name`

`/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` -- lowercase letters, digits, hyphens only,
no leading/trailing/consecutive hyphens, max 64 chars. **Must equal the
parent directory name exactly** (agentskills.io `/specification`, verified
live 2026-09-09). The vendored ruflo/Codex validator hard-errors on the same
character class. `name: "My Skill"` in Title Case is invalid on both counts.

## `description`

Plain text, max 1024 chars. Third person ("Processes X...", never "I can
help..."). States WHAT it does and WHEN to use it; a WHEN-NOT clause is
strongly recommended once a skill has neighbours it could be confused with.
Front-load keywords -- this is the only text always loaded for matching, for
both the Claude-registered skills and everything skill-router indexes.

Anthropic's own `skill-creator` documents **under-triggering, not
over-triggering, as the default failure mode** and instructs authors to
write descriptions that are "a little bit pushy" (e.g. "make sure to use
this whenever the user mentions X, even if they don't explicitly ask").
Bias your WHEN clause accordingly -- undersold trigger conditions are a
worse failure than oversold ones.

Claude Code truncates the combined `description` + `when_to_use` text at
1,536 chars in its listing -- keep the highest-value trigger phrase in the
first sentence regardless of which field it lives in.

## Frontmatter vocabulary

**Portable core** (agentskills.io, works unmodified on Codex): `name`,
`description`, `license`, `compatibility` (<=500 chars -- use it to say
Claude-only vs Claude+Codex reach, not prose elsewhere), `metadata` (flat
string-to-string map, no nested objects), `allowed-tools` (space-separated,
marked Experimental by the spec).

**Claude-Code-honoured extras** (silently inert on Codex, not portable):
`when_to_use`, `argument-hint`, `arguments`, `user-invocable`,
`disable-model-invocation`, `model`, `effort`, `context`, `agent`, `hooks`,
`paths`, `shell`. Full semantics: code.claude.com/docs/en/skills.

**Estate conventions layered on top** (not spec, still legitimate -- check
SKILL-DIRECTORY.md before inventing a new one): `triggers`, `related_skills`,
`depends_on_mcps`, `env_vars`, `mcp_server`/`protocol`/`entry_point`,
`manifest_gate`, `version`, `author`, `tags`, `deprecated`/`replacement`. A
deprecated redirect stub carries exactly `name`, `description` (starting
"DEPRECATED -- merged into <x>."), `deprecated: true`, `replacement: <x>`.

**Codex-only UI/policy** (`display_name`, icon, `allow_implicit_invocation`,
declared MCP tool deps) goes in a sibling `agents/openai.yaml`, **never** in
shared frontmatter -- Claude Code's validator has been reported (community
bug report, not independently verified) to silently drop unrecognised keys.

Drop `estimated_time` and `difficulty` if found on an old skill -- neither
harness reads either.

## Layout

```
skills/<name>/
  SKILL.md        entry point, <=250 lines (this estate's lint hard cap),
                   <5,000 tokens (agentskills.io recommendation)
  references/     one level deep from SKILL.md -- topic files, loaded on demand
  scripts/        executables
  assets/         templates, static data
```

No `REFERENCE.md`/`EXAMPLES.md` as flat siblings at the skill root --
`skills/lint-skills.mjs`'s BUDGET check only recognises a `references/`
directory holding a readable file as satisfying progressive disclosure past
250 lines; a flat sibling does not count, however well organised.

## Location and registration

Author **only** at the master copy: the directory this file lives in (bakes
to `/opt/agentbox/skills` at image build). Never author directly under a
harness's own skills directory -- those are boot-time reconciliation
targets, not source.

- Claude's always-loaded set: `skills/registered-skills.txt`, reconciled
  into the harness's personal skills directory every boot.
- Codex's equivalent list, `skills/codex-registered-skills.txt`, is reconciled into
  `~/.codex/skills` by the same reconciler at boot (wired 2026-09-09). Codex caps its
  always-loaded skill index at about 8,000 characters, so keep that manifest short and
  prefer skills whose bodies carry Codex fallbacks; `~/.codex/AGENTS.md` points Codex at
  `SKILL-DIRECTORY.md` and the routing table for everything else.
- Everything else is reference-only, reached via SKILL-DIRECTORY.md ->
  `/route` -> `routing-table.md`. The routing table is generated
  (`node skills/gen-routing-table.mjs` from every skill's description and
  `skill-router/references/section-map.json`), so a new skill needs a
  section-map entry and a SKILL-DIRECTORY.md row; the lint fails on either
  being missing or on a stale table.

## Model-fit line (C7)

If a skill needs a Claude-Code-only affordance (Agent/fork/Task tool,
Artifact, Skill tool, `/route`, hooks, `claude mcp add`), add one sentence
via `compatibility:` or the body: what the affordance is, and what a Codex/
GPT-6-Astra session does instead (run phases sequentially in one session /
write the file and report its path / register the MCP server in
`~/.codex/config.toml`). Do not pad beyond that sentence.

## Quick scaffold

```bash
mkdir -p skills/my-skill/{references,scripts,assets}
cat > skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: "What it does. Use when [trigger]. Not for [adjacent case] -- use [other-skill] instead."
---

# My Skill

## When to use
...

## When NOT to use
...
EOF
```

## Validation

- [ ] `name` matches directory, lowercase-hyphen, <=64 chars
- [ ] `description` <=1024 chars, third person, what+when(+when-not)
- [ ] No key outside the three vocabulary tiers above without checking SKILL-DIRECTORY.md first
- [ ] SKILL.md <=250 lines, or a populated `references/` exists
- [ ] Every cited `references/`/`scripts/`/`assets/` path resolves
- [ ] `bash skills/lint-skills.sh` exits 0
- [ ] Skill appears in SKILL-DIRECTORY.md (ask the queen/router owner to add it)

## Depth on demand

- [references/field-spec.md](references/field-spec.md) -- full field-by-field
  rules, YAML formatting gotchas, and the falsified v1 claims with sources.
- [references/templates.md](references/templates.md) -- minimal /
  intermediate / full-featured starter templates and two worked examples,
  corrected to this contract.
- [references/eval-suite.md](references/eval-suite.md) -- manual structural
  and prompt-based validation checklist for a newly authored skill.
- [references/diagram-driven-diagnosis.md](references/diagram-driven-diagnosis.md)
  -- multi-agent Mermaid-cartography method for diagnosing a complex bug or
  suspected parallel implementation inside a skill under construction.

## Evals

For triggering-accuracy and quality measurement, follow Anthropic's own
`skill-creator` with/without-skill benchmark workflow (interview -> draft ->
parallel with/without-skill subagent runs -> assertion grading ->
`scripts.aggregate_benchmark` -> HTML eval-viewer). To measure whether a
skill's *wording* measurably raises an agent's success rate on a bounded,
scoreable task -- not just whether it triggers -- hand it to `skill-tuning`'s
SkillOpt loop instead; the two are complementary, not alternatives.
