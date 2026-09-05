// skill-router-fixture.test.mjs — anti-rot assertions for the skill-router
// prompt fixture (ADR-2056).
//
// What the fixture is for: `tests/fixtures/skill-router-prompts.json` holds
// 10 `{prompt, expected_skill, rationale}` triples encoding real routing
// intent — e.g. "a prompt referencing kernel-persisted state should route to
// `codeact`, not `sparc:code`". Phase 1 found the fixture had ZERO code
// consumers (nothing in `scripts/` or `tests/` read it), so it was dead test
// data even though the routing intent it encodes is real and worth keeping.
//
// Why routing itself is NOT asserted here: skill routing is model-driven —
// skills self-trigger from their `description` frontmatter (see
// `skills/SKILL-DIRECTORY.md`), there is no deterministic dispatcher function
// to call. A test that fed each `prompt` through "the router" and asserted
// `expected_skill` came back would either not exist (no such function) or be
// a flaky LLM-in-the-loop test. Neither is acceptable here.
//
// What THIS test catches instead — the parts of the fixture that rot
// deterministically without anyone noticing:
//   1. schema drift in the fixture itself (missing/extra/blank fields);
//   2. an `expected_skill` pointing at a target that no longer exists, OR a
//      new skill directory silently shadowing a namespaced command name (the
//      actual bug class this file exists to catch — see the `sparc:code`
//      finding below);
//   3. an `expected_skill` that has fallen out of the routing catalogue
//      (`skills/SKILL-DIRECTORY.md`) even though its target still exists;
//   4. duplicate prompts silently accumulating in the fixture over time.
//
// Two target classes (ADR-2056 remediation finding, resolved): an
// `expected_skill` is either
//   - a LOCAL SKILL (no `:`)      — must be `skills/<name>/SKILL.md`, or
//   - a NAMESPACED COMMAND (has a `:`) — a claude-flow plugin command (e.g.
//     `sparc:code`, `sparc:coder`) that has NO directory anywhere under
//     `skills/` in this repo; its only footprint here is a mention in
//     `skills/SKILL-DIRECTORY.md`.
// The two classes are verified differently on purpose: a plugin command has
// no directory to check in this repo, so SKILL-DIRECTORY.md is the only
// place its existence can be confirmed here, while a local skill's directory
// IS the ground truth and SKILL-DIRECTORY.md is the (separately checked)
// catalogue entry pointing at it. Getting the class wrong is itself a rot
// mode: 5 of the 10 fixture rows originally said `expected_skill:
// "sparc-code"` (hyphen) — not a deleted skill, but a mis-spelling of the
// canonical namespaced command `sparc:code`. The hyphen leaked in because an
// unquoted colon is invalid YAML: `skills/codeact/SKILL.md`'s
// `related_skills:` frontmatter and `skills/tree-search-coder/SKILL.md`'s
// `related_skills:` frontmatter both had to hyphenate `sparc:code` /
// `sparc:coder` to stay parseable, and the hyphenated spelling then leaked
// into this fixture. `skills/SKILL-DIRECTORY.md` uses the colon form
// consistently throughout (its prose and decision tree, e.g. "use
// `sparc:code` or direct Edit", "generated via `sparc:coder`"). Fixed by:
// correcting the fixture to `sparc:code`, and quoting the frontmatter
// entries (`- "sparc:code"`, `- "sparc:coder"`) so the colon form is valid
// YAML and nothing needs to hyphenate it again.
//
// The structural check below (assertion 2) is therefore STRICTER than a
// plain "does the directory exist" check, not weaker: it also catches a
// future namespaced command whose name collides with (shadows) a real
// `skills/` directory.
//
// Run: node --test tests/integration/skill-router-fixture.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(new URL('../..', import.meta.url).pathname);
const FIXTURE_PATH = path.join(REPO, 'tests/fixtures/skill-router-prompts.json');
const SKILLS_DIR = path.join(REPO, 'skills');
const SKILL_DIRECTORY_PATH = path.join(REPO, 'skills/SKILL-DIRECTORY.md');

const EXPECTED_KEYS = ['prompt', 'expected_skill', 'rationale'].sort();

function loadFixture() {
  const raw = fs.readFileSync(FIXTURE_PATH, 'utf8');
  return JSON.parse(raw);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isNamespacedCommand(expectedSkill) {
  return expectedSkill.includes(':');
}

// ── 1. schema ────────────────────────────────────────────────────────────

test('fixture parses as a non-empty array of well-formed {prompt, expected_skill, rationale} entries', () => {
  const fixture = loadFixture();

  assert.ok(Array.isArray(fixture), 'fixture root must be a JSON array');
  assert.ok(fixture.length > 0, 'fixture must not be empty');

  const malformed = [];
  fixture.forEach((entry, i) => {
    const keys = Object.keys(entry).sort();
    const problems = [];
    if (JSON.stringify(keys) !== JSON.stringify(EXPECTED_KEYS)) {
      problems.push(`key set is [${keys.join(', ')}], expected exactly [${EXPECTED_KEYS.join(', ')}]`);
    }
    for (const field of EXPECTED_KEYS) {
      const v = entry[field];
      if (typeof v !== 'string' || v.trim().length === 0) {
        problems.push(`field "${field}" must be a non-empty string, got ${JSON.stringify(v)}`);
      }
    }
    if (problems.length) malformed.push({ index: i, prompt: entry.prompt, problems });
  });

  assert.deepEqual(malformed, [], `malformed fixture entries:\n${JSON.stringify(malformed, null, 2)}`);
});

// ── 2. every expected_skill resolves correctly for its target class ─────
//
// This is the anti-rot assertion that matters: a renamed or deleted local
// skill, or a namespaced command that starts shadowing a real skill
// directory, must fail this test. We check every entry (not just unique
// skill names) so the failure message can be traced back to the exact
// fixture row a human would need to fix.
//
// LOCAL SKILL (no `:`): must have `skills/<name>/SKILL.md`.
// NAMESPACED COMMAND (has `:`): must NOT have a `skills/<name>/` directory —
// commands live entirely outside this repo's skills tree, so any directory
// with that name is a naming collision, not a valid target. (Catalogue
// membership for both classes is checked separately in assertion 3, so it is
// not duplicated here.)

test('every expected_skill resolves in the right place for its target class (local skill vs. namespaced command)', () => {
  const fixture = loadFixture();

  const offenders = [];
  fixture.forEach((entry, i) => {
    const { expected_skill: skill, prompt } = entry;
    const skillDir = path.join(SKILLS_DIR, skill);
    const dirExists = fs.existsSync(skillDir) && fs.statSync(skillDir).isDirectory();

    if (isNamespacedCommand(skill)) {
      if (dirExists) {
        offenders.push({
          index: i, expected_skill: skill, prompt, class: 'namespaced-command',
          reason: 'a skills/ directory of this name exists — a namespaced command must not be shadowed by a skill',
        });
      }
    } else {
      const skillMdExists = dirExists && fs.existsSync(path.join(skillDir, 'SKILL.md'));
      if (!skillMdExists) {
        offenders.push({
          index: i, expected_skill: skill, prompt, class: 'local-skill',
          reason: dirExists ? 'directory exists but has no SKILL.md' : 'no such directory under skills/',
        });
      }
    }
  });

  assert.deepEqual(offenders, [], `fixture entries with a broken target for their class:\n${JSON.stringify(offenders, null, 2)}`);
});

// ── 3. every expected_skill is listed in SKILL-DIRECTORY.md ─────────────
//
// This is a plain text search, not a Markdown parse: SKILL-DIRECTORY.md is a
// hand-written catalogue (tables + prose routing trees), not structured
// data, so there is no schema to parse against. A word-boundary substring
// match against the raw file text is the correct level of rigour — it
// catches a target falling out of the catalogue without requiring this test
// to track the document's internal formatting. This check applies uniformly
// to BOTH target classes: a namespaced command's only footprint in this repo
// is its mention here, so for that class this IS the existence check.

test('every expected_skill is listed in skills/SKILL-DIRECTORY.md', () => {
  const fixture = loadFixture();
  const directoryText = fs.readFileSync(SKILL_DIRECTORY_PATH, 'utf8');

  const uniqueSkills = [...new Set(fixture.map((e) => e.expected_skill))].sort();
  const notListed = uniqueSkills.filter((skill) => {
    const re = new RegExp(`\\b${escapeRegExp(skill)}\\b`);
    return !re.test(directoryText);
  });

  assert.deepEqual(notListed, [], `expected_skill values absent from SKILL-DIRECTORY.md: ${JSON.stringify(notListed)}`);
});

// ── 4. prompts are unique ────────────────────────────────────────────────

test('fixture prompts are unique (no silently accumulated duplicates)', () => {
  const fixture = loadFixture();

  const seen = new Map();
  const duplicates = [];
  fixture.forEach((entry, i) => {
    if (seen.has(entry.prompt)) {
      duplicates.push({ prompt: entry.prompt, firstIndex: seen.get(entry.prompt), duplicateIndex: i });
    } else {
      seen.set(entry.prompt, i);
    }
  });

  assert.deepEqual(duplicates, [], `duplicate prompts found:\n${JSON.stringify(duplicates, null, 2)}`);
});
