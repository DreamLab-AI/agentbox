#!/usr/bin/env node
// Check whether a citation's cited lines actually carry what the citation says they do.
//
// This is the check that matters and the one usually skipped, because "does this range support
// this sentence" reads as a job only a person can do. For a large class of citations it is not.
// A developer-facing pack cites by naming the thing: the link text is `routeLane` or
// `validatePatch` or `AUTONOMY_SIGNALS`, and the claim is simply that the cited lines are where
// that is. Whether the identifier appears in the cited range is a fact, and a pack with a
// thousand citations needs that fact decided by a script so that the reading can be spent on the
// citations where the link text is prose and judgement is unavoidable.
//
// What it reports, per citation:
//   NAMED-OK    the link text names an identifier and the cited range contains it
//   NAMED-MISS  the link text names an identifier and the cited range does NOT contain it
//   ELSEWHERE   the identifier is not in the range but IS in the file, with the line it is on,
//               which is the useful form of a miss: the range is off, not the file
//   PROSE       the link text is not an identifier; this needs a reader
//   plus the mechanical faults: MISSING-FILE, RANGE-OUTSIDE-FILE
//
//   citation-support.mjs --chapters <dir> --repo <dir> [--json] [--show named-miss,elsewhere]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = (() => { const a = {}; const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) { if (!v[i].startsWith('--')) continue;
    const k = v[i].slice(2), n = v[i + 1]; a[k] = n === undefined || n.startsWith('--') ? true : (i++, n); }
  return a; })();
if (!args.chapters || !args.repo) {
  console.error('usage: citation-support.mjs --chapters <dir> --repo <dir> [--json] [--show ...]');
  process.exit(2);
}

// An identifier worth checking for: a camelCase or PascalCase name, a SCREAMING_CASE constant, a
// route path, or a dotted/parenthesised call. Deliberately narrow — a false "named" reading turns
// a judgement call into a machine verdict, which is the failure this is meant to avoid.
const IDENT = /^`?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:\(\))?`?$/;
const ROUTE = /^`?(GET|POST|PUT|PATCH|DELETE)\s+(\/[\w/:.\-[\]*]*)`?$/i;
// Three things read as identifiers and are not, each of which turns a sound citation into a
// false failure. They were all found by running this over a real pack of a thousand citations.
const looksLikeCode = (s, citedPath) => {
  const t = s.trim();
  const bare = t.replace(/^`|`$/g, '');

  // 1. The link text is the cited file's own name. "[store.ts](src:.../store.ts)" is a correct
  //    citation of a file; asking whether the file contains its own name is meaningless.
  const base = citedPath.split('/').pop();
  if (bare === base || bare === citedPath) return { kind: 'filename', name: bare };

  // 2. A route is written in prose as "GET /api/world" and in code as app.get('/api/world').
  //    Look for the path, which is the part that is actually in the source.
  const r = t.match(ROUTE);
  if (r) return { kind: 'route', name: r[2], method: r[1].toLowerCase() };

  const m = bare.match(IDENT);
  if (!m) return null;
  const name = m[1];
  if (name.length < 3) return null;

  // 3. A single English word, capitalised or not, is prose: "Decision", "Context", "the gate".
  //    An identifier claim is either backticked or shaped like code — a case change inside it,
  //    an underscore, a dot, or a trailing call.
  const shapedLikeCode = /[a-z][A-Z]|_|\.|\(\)$/.test(name);
  if (!t.startsWith('`') && !shapedLikeCode) return null;

  return { kind: 'ident', name };
};


// Where the thing a citation names begins and ends in its file, approximately. Brace matching is
// enough here and a parser would be a dependency: find the line that declares the name, then read
// forward until the braces opened on that line close again.
function spanOf(body, name) {
  const decl = body.findIndex((l) =>
    new RegExp(`(?:function|class|interface|type|const|let|var|async|export|\\bdef\\b)[^\\n]*\\b${
      name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(l)
    || new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[(:<]`).test(l));
  if (decl < 0) return null;
  let depth = 0, seen = false;
  for (let i = decl; i < body.length; i++) {
    for (const ch of body[i]) {
      if (ch === '{') { depth++; seen = true; }
      else if (ch === '}') depth--;
    }
    if (seen && depth <= 0) return { from: decl + 1, to: i + 1 };
  }
  return { from: decl + 1, to: body.length };
}

const rows = [];
for (const file of readdirSync(args.chapters).filter((f) => f.endsWith('.md')).sort()) {
  const text = readFileSync(join(args.chapters, file), 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\[([^\]]*)\]\(src:([^)]+)\)/g)) {
      const [linkText, target] = [m[1], m[2]];
      const row = { file, line: i + 1, linkText, target, verdict: 'PROSE' };
      const at = target.match(/^(.+?)#L(\d+)(?:-L(\d+))?$/);
      const path = at ? at[1] : target;
      const src = join(args.repo, path);
      if (!existsSync(src)) { row.verdict = 'MISSING-FILE'; rows.push(row); continue; }
      const body = readFileSync(src, 'utf8').split('\n');
      let a = 1, b = body.length;
      if (at) { a = Number(at[2]); b = Number(at[3] ?? at[2]); }
      if (b > body.length || a < 1) { row.verdict = 'RANGE-OUTSIDE-FILE'; row.detail = `file has ${body.length} lines`; rows.push(row); continue; }
      row.lines = `${a}-${b}`;
      const code = looksLikeCode(linkText, path);
      if (!code) { rows.push(row); continue; }
      // A citation of a file BY ITS NAME is supported by the file existing, which is already known.
      if (code.kind === 'filename') { row.verdict = 'NAMED-OK'; row.name = code.name; rows.push(row); continue; }
      const inRange = body.slice(a - 1, b).join('\n');
      if (inRange.includes(code.name)) { row.verdict = 'NAMED-OK'; row.name = code.name; rows.push(row); continue; }
      // Not in the range. Is it in the file at all? That distinguishes a wrong range from a
      // wrong file, and only the first is a one-line repair.
      row.name = code.name;

      // A citation often points at the BODY of the thing it names rather than the line that
      // declares it, which is the right place to point: that is where the behaviour is. If the
      // cited range sits inside the named thing's span, the citation is supported.
      const span = spanOf(body, code.name);
      if (span && a >= span.from && b <= span.to) {
        row.verdict = 'WITHIN';
        row.detail = `inside ${code.name} (${path}:${span.from}-${span.to})`;
        rows.push(row); continue;
      }

      // A dotted name is often a type and one of its members, declared apart. The member alone
      // being in range is the claim: `RegressionVerdict.newlyFailing` is about newlyFailing.
      if (code.name.includes('.')) {
        const member = code.name.split('.').pop();
        if (member.length >= 3 && body.slice(a - 1, b).join('\n').includes(member)) {
          row.verdict = 'NAMED-OK';
          row.detail = `the member ${member} is in range`;
          rows.push(row); continue;
        }
      }

      const found = body.findIndex((l) => l.includes(code.name));
      if (found >= 0) { row.verdict = 'ELSEWHERE'; row.detail = `${code.name} is at ${path}:${found + 1}, outside L${a}-L${b}`; }
      else { row.verdict = 'NAMED-MISS'; row.detail = `${code.name} does not appear in ${path}`; }
      rows.push(row);
    }
  });
}

const tally = rows.reduce((t, r) => (t[r.verdict] = (t[r.verdict] ?? 0) + 1, t), {});
if (args.json) { console.log(JSON.stringify({ total: rows.length, tally, rows }, null, 2)); process.exit(0); }

console.log(`${rows.length} citations across ${new Set(rows.map((r) => r.file)).size} chapters\n`);
const order = ['NAMED-OK', 'WITHIN', 'PROSE', 'ELSEWHERE', 'NAMED-MISS', 'RANGE-OUTSIDE-FILE', 'MISSING-FILE'];
const meaning = {
  'NAMED-OK': 'the link names something and the cited lines contain it',
  WITHIN: 'the cited lines sit inside the body of the thing the link names',
  PROSE: 'the link text is prose; a reader has to judge these',
  ELSEWHERE: 'named thing is in the file but outside the cited range — the range is wrong',
  'NAMED-MISS': 'named thing is nowhere in the cited file — the file is wrong',
  'RANGE-OUTSIDE-FILE': 'the cited range runs past the end of the file',
  'MISSING-FILE': 'the cited file does not exist',
};
for (const k of order) if (tally[k]) console.log(`  ${String(tally[k]).padStart(4)}  ${k.padEnd(20)} ${meaning[k]}`);

const show = String(args.show ?? 'elsewhere,named-miss,range-outside-file,missing-file')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const listed = rows.filter((r) => show.includes(r.verdict));
if (listed.length) {
  console.log(`\nthe ${listed.length} that need attention:`);
  for (const r of listed) console.log(`  ${r.file}:${r.line}  [${r.linkText}]  ${r.verdict}  ${r.detail ?? r.target}`);
}
const broken = rows.filter((r) => ['ELSEWHERE', 'NAMED-MISS', 'RANGE-OUTSIDE-FILE', 'MISSING-FILE'].includes(r.verdict));
console.log(`\n${broken.length === 0 ? 'no citation names something its own range does not carry' : `${broken.length} citation(s) do not carry what they name`}`);
process.exitCode = broken.length ? 1 : 0;
