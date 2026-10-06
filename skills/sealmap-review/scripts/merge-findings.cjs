#!/usr/bin/env node
/**
 * Multi-model agreement: merge findings from more than one external reviewer family
 * (GLM nightly review, Gemini audit) for the same pack, and rank first the findings that two
 * families raised independently.
 *
 * The match is deterministic and deliberately simple. Two findings from DIFFERENT families
 * agree when
 *   1. they share a topic id (`CP-03.2` and `CP-03` are the same topic) or a cited file, and
 *   2. their claim text (title + evidence + failure) shares at least MIN_SHARED content words
 *      and an overlap coefficient of at least MIN_OVERLAP.
 * Findings from one family never corroborate each other (critical and premortem lenses of one
 * model are not independent). Agreement ranks; it does not verify. Every finding stays an
 * unverified hypothesis for build-with-quality triage.
 *
 *   node merge-findings.cjs glm.json gemini.json [--out merged.json]
 *
 * The family of each file is its `reviewer`/`family` field per finding, else the file name
 * (a name containing "gemini" is `gemini`, "glm" is `glm`, otherwise the basename).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIN_SHARED = 3;
const MIN_OVERLAP = 0.3;
const STOP = new Set(('the and for that this with from into when then than are was were not but can has have had its '
  + 'any all one two per via out off use used uses will would should could may might which what where while their there '
  + 'they them these those only also each both more most other such over under same does did done being been it is of to in on at by as be or if an a').split(' '));

/** Topic ids of a finding, normalised to the topic (`CP-03.2` -> `cp-03`). */
function topicIds(f) {
  return new Set(String(f.topics ?? '').toLowerCase().match(/[a-z]{1,6}-\d+(?:\.\d+)*/g)?.map((t) => t.replace(/\.\d+.*$/, '')) ?? []);
}

/** Files cited in a finding's text (`path/to/file.ext:12`). */
function citedFiles(f) {
  const text = `${f.evidence ?? ''} ${f.failure ?? ''}`;
  return new Set([...text.matchAll(/([\w./-]+\.[A-Za-z]{1,5}):\d+/g)].map((m) => m[1].toLowerCase()));
}

/** Content words of a finding's claim. */
function words(f) {
  const text = `${f.title ?? ''} ${f.evidence ?? ''} ${f.failure ?? ''}`.toLowerCase();
  return new Set((text.match(/[a-z][a-z0-9_]{2,}/g) ?? []).filter((w) => !STOP.has(w)));
}

const intersects = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };

/** True when two findings (of different families) state the same problem. */
function agree(a, b) {
  const anchored = intersects(topicIds(a), topicIds(b)) || intersects(citedFiles(a), citedFiles(b));
  if (!anchored) return false;
  const wa = words(a), wb = words(b);
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  const smaller = Math.min(wa.size, wb.size);
  return shared >= MIN_SHARED && smaller > 0 && shared / smaller >= MIN_OVERLAP;
}

/** Family of a source file, from its name. */
function familyOf(file) {
  const base = path.basename(file).toLowerCase();
  if (base.includes('gemini')) return 'gemini';
  if (base.includes('glm')) return 'glm';
  return base.replace(/\.json$/, '');
}

/**
 * Merge `groups` ([{ family, findings }]) into one ranked list. Each finding gains
 * `families` (every family that raised it independently), `corroborated_by` (ids of the
 * matching findings from other families) and `agreement` (number of families). Findings raised
 * by two or more families come first; ties keep input order, so the output is deterministic.
 */
function mergeFindings(groups) {
  const all = [];
  for (const g of groups) for (const f of g.findings) all.push({ ...f, family: f.family ?? f.reviewer ?? g.family });
  const parent = all.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const links = all.map(() => new Set());
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (all[i].family === all[j].family || !agree(all[i], all[j])) continue;
      parent[find(i)] = find(j);
      links[i].add(all[j].id); links[j].add(all[i].id);
    }
  }
  const clusterFamilies = new Map();
  all.forEach((f, i) => { const r = find(i); (clusterFamilies.get(r) ?? clusterFamilies.set(r, new Set()).get(r)).add(f.family); });
  const out = all.map((f, i) => {
    const families = [...clusterFamilies.get(find(i))].sort();
    return { ...f, families, agreement: families.length, corroborated_by: [...links[i]] };
  });
  return out.map((f, i) => ({ f, i })).sort((x, y) => y.f.agreement - x.f.agreement || x.i - y.i).map((x) => x.f);
}

/** Render the merged list as Markdown: corroborated findings first, in their own section. */
function renderMarkdown(merged) {
  const both = merged.filter((f) => f.agreement >= 2);
  const rest = merged.filter((f) => f.agreement < 2);
  const line = (f) => `- **${f.id}** (${f.families.join(' + ')}) ${f.title}${f.topics ? ` [${f.topics}]` : ''}${f.corroborated_by.length ? ` — also ${f.corroborated_by.join(', ')}` : ''}`;
  return [
    `# Merged review: ${both.length} finding(s) raised independently by two or more model families, ${rest.length} by one`, '',
    'Agreement ranks findings; it does not verify them. Reproduce each (build-with-quality) before acting.', '',
    '## Raised by two or more families', '', ...(both.length ? both.map(line) : ['None.']), '',
    '## Raised by one family', '', ...(rest.length ? rest.map(line) : ['None.']), '',
  ].join('\n');
}

function main(argv) {
  const files = [];
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') { if (++i >= argv.length) throw new Error('--out needs a value'); out = argv[i]; } else files.push(argv[i]);
  }
  if (files.length < 2) throw new Error('usage: merge-findings.cjs <findings.json> <findings.json>... [--out merged.json]');
  const merged = mergeFindings(files.map((f) => ({ family: familyOf(f), findings: JSON.parse(fs.readFileSync(f, 'utf8')) })));
  const md = renderMarkdown(merged);
  if (out) {
    fs.writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`);
    fs.writeFileSync(out.replace(/\.json$/, '') + '.md', md);
  } else console.log(md);
  return merged;
}

module.exports = { mergeFindings, agree, familyOf, renderMarkdown, topicIds, citedFiles, words, MIN_SHARED, MIN_OVERLAP };

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (err) { console.error(`merge-findings: ${err.message}`); process.exit(2); }
}
