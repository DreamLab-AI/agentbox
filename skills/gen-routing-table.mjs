#!/usr/bin/env node
// gen-routing-table.mjs — generate skill-router/references/routing-table.md from
// every skills/*/SKILL.md frontmatter (ADR-2021 progressive discovery; ADR-2056 facts
// must be checkable). The table was previously hand-maintained while claiming to be
// generated, and drifted 38 skills behind the tree (audit 2026-09-09).
//
//   node skills/gen-routing-table.mjs            # rewrite the table
//   node skills/gen-routing-table.mjs --check    # exit 1 if the table on disk is stale
//
// Inputs: frontmatter `name`, `description`, `deprecated`, `replacement`, `triggers`
// (parsed with the same parser lint-skills.mjs uses) and the section for each skill from
// skill-router/references/section-map.json. A skill directory absent from the map is a
// hard error (add it to the map when you add the skill).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from './lint-skills.mjs';

const SKILLS_DIR = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(SKILLS_DIR, 'skill-router', 'references', 'section-map.json');
const OUT_PATH = join(SKILLS_DIR, 'skill-router', 'references', 'routing-table.md');
const DESC_MAX = 160; // condensed, truncated verbatim from frontmatter — never hand-written

const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));

function skills() {
  const out = [];
  for (const e of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
    const md = join(SKILLS_DIR, e.name, 'SKILL.md');
    if (!existsSync(md)) continue;
    const fm = parseFrontmatter(readFileSync(md, 'utf8'));
    if (!fm.ok) throw new Error(`${e.name}/SKILL.md: ${fm.error}`);
    const get = (k) => (fm.keys.get(k) || {}).value || '';
    out.push({
      name: e.name,
      description: get('description').replace(/\s+/g, ' ').trim(),
      deprecated: /^(true|yes)$/i.test(get('deprecated')),
      replacement: get('replacement'),
      triggers: (fm.keys.get('triggers') || {}).kind === 'scalar' ? get('triggers') : '',
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function condense(d) {
  if (d.length <= DESC_MAX) return d;
  const cut = d.slice(0, DESC_MAX);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 80)).trim() + ' …';
}

function render(all) {
  const missing = all.filter((s) => !(s.name in map.skills)).map((s) => s.name);
  if (missing.length) throw new Error(`section-map.json has no section for: ${missing.join(', ')}`);
  const bySection = new Map();
  for (const s of all) {
    const sec = s.deprecated ? 'Deprecated and Archived' : map.skills[s.name];
    if (!bySection.has(sec)) bySection.set(sec, []);
    bySection.get(sec).push(s);
  }
  const sections = [...bySection.keys()].filter((s) => s !== 'Deprecated and Archived').sort();
  const lines = [];
  lines.push('# skill-router — Routing Table (generated)');
  lines.push('');
  lines.push('> **Generated artefact — do not hand-edit.** Produced by `skills/gen-routing-table.mjs`');
  lines.push('> from every skill\'s frontmatter `description` and `skill-router/references/section-map.json`.');
  lines.push('> Regenerate after any description change: `node skills/gen-routing-table.mjs`.');
  lines.push('> `bash skills/lint-skills.sh` fails when this file is stale (`--check`).');
  lines.push('>');
  lines.push('> This table covers the skills estate. Consultant MCP tools (consultant-codex,');
  lines.push('> consultant-deepseek, consultant-perplexity, consultant-zai, consultant-antigravity) are');
  lines.push('> not skills; route to them directly via their `consult` tool when a second model opinion is wanted.');
  lines.push('');
  lines.push(`Skills: ${all.filter((s) => !s.deprecated).length} active, ${all.filter((s) => s.deprecated).length} deprecated redirects. Sections mirror SKILL-DIRECTORY.md Artefact 1.`);
  lines.push('');
  lines.push('## How to route');
  lines.push('');
  lines.push('1. Classify the request against the section headings below.');
  lines.push('2. Within the section, match the request against each row\'s description (the same text the skill self-triggers on).');
  lines.push('3. Clear match → dispatch. Two plausible rows → ask one question. Multi-step → name the sequence and start the first.');
  lines.push('');
  for (const sec of sections) {
    lines.push(`## ${sec}`);
    lines.push('');
    lines.push('| Skill | Route when (from the skill\'s own description) |');
    lines.push('|---|---|');
    for (const s of bySection.get(sec)) {
      lines.push(`| \`${s.name}\` | ${condense(s.description).replace(/\|/g, '\\|')} |`);
    }
    lines.push('');
  }
  const dep = bySection.get('Deprecated and Archived') || [];
  if (dep.length) {
    lines.push('## Deprecated redirects');
    lines.push('');
    lines.push('| Skill | Use instead |');
    lines.push('|---|---|');
    for (const s of dep) lines.push(`| \`${s.name}\` | \`${s.replacement || '?'}\` |`);
    lines.push('');
  }
  return lines.join('\n');
}

const text = render(skills());
if (process.argv.includes('--check')) {
  const cur = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, 'utf8') : '';
  if (cur !== text) {
    console.error('routing-table.md is stale — run: node skills/gen-routing-table.mjs');
    process.exit(1);
  }
  console.log('routing-table.md is current');
} else {
  writeFileSync(OUT_PATH, text);
  console.log(`wrote ${OUT_PATH} (${text.split('\n').length} lines)`);
}
