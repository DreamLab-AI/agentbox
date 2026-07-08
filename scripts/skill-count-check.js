#!/usr/bin/env node
'use strict';

/**
 * skill-count-check — single source of truth for the agentbox skill count.
 *
 * RES-d / ADR-037 D8. Before this script three divergent counts lived in one
 * tree on one day (README.md "90+ skills", SKILL-DIRECTORY.md "109 active
 * skills" / "104 skills", filesystem 115). This script makes the count of one
 * SKILL.md per skill directory the single source of truth, and fails when a
 * headline count claim in README.md or SKILL-DIRECTORY.md diverges from it.
 *
 * It is a CI counter, not a liveness canary (ADR-037 D8): a skill count is
 * static tree state, not a wired loop. The canon `DriftCounter` (VisionFlow
 * RES-d) consumes the machine-readable JSON this prints on stdout; the exit
 * code gates CI.
 *
 * Claim matching is deliberately narrow so per-skill sub-counts (e.g.
 * "AEC studio: 36 skills", "AgentDB family (4 skills)", "19 skills provide
 * MCP servers") are NOT mistaken for headline totals. Only three phrasings are
 * treated as repo-total claims:
 *   - floor form   "N+ skills"                → satisfied iff count >= N
 *   - active form  "N active skills"          → exact, must equal count
 *   - router form  "for [all] N skills"       → exact, must equal count
 *
 * Usage:
 *   node scripts/skill-count-check.js            # JSON to stdout; exit 1 on drift
 *   node scripts/skill-count-check.js --quiet    # exit code only, no stdout
 * Programmatic:
 *   require('./skill-count-check').checkSkillCount({ repoRoot })
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// Docs that carry a headline skill-count claim, relative to the repo root.
const CLAIM_DOCS = ['README.md', 'skills/SKILL-DIRECTORY.md'];

const CLAIM_PATTERNS = [
  { kind: 'floor', re: /(\d+)\+\s+skills/gi },
  { kind: 'active', re: /(\d+)\s+active\s+skills/gi },
  { kind: 'router', re: /for\s+(?:all\s+)?(\d+)\s+skills/gi },
];

/**
 * Count skills — the single source of truth: one `SKILL.md` per skill directory.
 * @param {string} repoRoot
 * @returns {{count:number, skills:string[]}}
 */
function countSkills(repoRoot) {
  const skillsDir = path.join(repoRoot, 'skills');
  let entries;
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`cannot read skills directory at ${skillsDir}: ${err.message}`);
  }
  const skills = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const manifest = path.join(skillsDir, ent.name, 'SKILL.md');
    if (fs.existsSync(manifest)) skills.push(ent.name);
  }
  skills.sort();
  return { count: skills.length, skills };
}

/**
 * Scan one doc for headline count claims and test each against the truth count.
 * @param {string} repoRoot
 * @param {string} rel
 * @param {number} count
 * @returns {Array<{doc:string, kind:string, stated:number, line:number, ok:boolean, text:string}>}
 */
function scanDoc(repoRoot, rel, count) {
  const abs = path.join(repoRoot, rel);
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch (_) {
    return []; // a missing claim doc is not itself a divergence
  }
  const lines = raw.split(/\r?\n/);
  const claims = [];
  lines.forEach((line, i) => {
    for (const { kind, re } of CLAIM_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const stated = Number(m[1]);
        const ok = kind === 'floor' ? count >= stated : count === stated;
        claims.push({
          doc: rel,
          kind,
          stated,
          line: i + 1,
          ok,
          text: line.trim().slice(0, 120),
        });
      }
    }
  });
  return claims;
}

/**
 * Run the full check.
 * @param {object} [opts]
 * @param {string} [opts.repoRoot]
 * @returns {{count:number, skills:string[], claims:Array, divergences:Array,
 *            ok:boolean, source:string}}
 */
function checkSkillCount(opts = {}) {
  const repoRoot = opts.repoRoot || REPO_ROOT;
  const { count, skills } = countSkills(repoRoot);
  const claims = [];
  for (const rel of CLAIM_DOCS) {
    claims.push(...scanDoc(repoRoot, rel, count));
  }
  const divergences = claims.filter((c) => !c.ok);
  return {
    count,
    source: 'skills/*/SKILL.md',
    skills,
    claims,
    divergences,
    ok: divergences.length === 0,
  };
}

module.exports = { checkSkillCount, countSkills, CLAIM_DOCS, CLAIM_PATTERNS };

// ─── CLI ────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const quiet = process.argv.includes('--quiet');
  let result;
  try {
    result = checkSkillCount();
  } catch (err) {
    if (!quiet) {
      process.stdout.write(JSON.stringify({ ok: false, error: err.message }, null, 2) + '\n');
    }
    process.exit(2);
  }
  if (!quiet) {
    // Machine-readable: the canon DriftCounter reads the `count` field; a
    // human reads `divergences`. Full skill list omitted from stdout to keep
    // the JSON compact; it stays available programmatically.
    const { skills, ...report } = result;
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  }
  if (!result.ok) {
    for (const d of result.divergences) {
      process.stderr.write(
        `E-SKILL1 skill-count drift: ${d.doc}:${d.line} states ${d.stated}`
        + `${d.kind === 'floor' ? '+' : ''} skills but skills/*/SKILL.md counts ${result.count}\n`
      );
    }
    process.exit(1);
  }
  process.exit(0);
}
