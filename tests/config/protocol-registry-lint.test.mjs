// node --test tests/config/protocol-registry-lint.test.mjs
//
// The Nostr kind tables in docs/PROTOCOL-registry.md are a registry, so they are
// linted as data (scripts/ci/protocol-registry-lint.mjs). The real document must
// pass, the 2026-10-02 external rows (3500, 23503, 3700, 30333) must be present
// exactly once and owned, and each rule must catch the violation it names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint, tables, ownerOf } from '../../scripts/ci/protocol-registry-lint.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY = readFileSync(join(REPO, 'docs', 'PROTOCOL-registry.md'), 'utf8');

const BAND = `| Range | State | Record |
|---|---|---|
| \`38400\`-\`38409\` | free | — |
| \`38410\`-\`38415\` | **spent**, colloquy | ADR-2085 |
`;
const table = (rows) => `| Kind | Owner | Notes |\n|---|---|---|\n${rows.join('\n')}\n`;

test('the registry passes: every row owned, no collisions, band rule holds', () => {
  const { errors } = lint(REGISTRY);
  assert.deepEqual(errors, []);
});

test('3500, 3700, 23503 and 30333 each occupy exactly one row, owned externally', () => {
  const { kinds } = lint(REGISTRY);
  const rows = tables(REGISTRY).filter((t) => t.header[0] === 'kind').flatMap((t) => t.rows.map((r) => ({ r, t })));
  for (const [kind, who] of [[3500, 'sidestr'], [23503, 'sidestr'], [3700, 'solidpayorg teller'], [30333, 'solidpayorg teller']]) {
    assert.ok(kinds.has(kind), `${kind} is registered`);
    const hits = rows.filter(({ r }) => r.cells[0].replace(/\*/g, '') === `\`${kind}\``);
    assert.equal(hits.length, 1, `${kind} sits in one row`);
    const { r, t } = hits[0];
    assert.deepEqual(ownerOf(r.cells[t.header.indexOf('owner')]), { owner: 'external', who });
  }
});

test('33501 is marked pre-0.0.5 only and the 33333 tip records its e tag', () => {
  const row = (k) => REGISTRY.split('\n').find((l) => l.startsWith(`| \`${k}\` |`));
  assert.match(row(33501), /pre-0\.0\.5 chains only/);
  assert.match(row(33333), /`e` = the chain event's id/);
});

test('a kind in two rows is a collision', () => {
  const md = table(['| `3500` | external (sidestr) | chain |', '| `3500` | external (solidpayorg teller) | clash |']);
  assert.match(lint(md).errors.join('\n'), /kind 3500 collides/);
});

test('a range overlapping a single kind is a collision', () => {
  const md = table(['| `30330`-`30339` | external (x) | range |', '| `30333` | external (solidpayorg teller) | ledger |']);
  assert.match(lint(md).errors.join('\n'), /kind 30333 collides/);
});

test('a row without an owner fails', () => {
  const md = table(['| `3700` | someone | request |']);
  assert.match(lint(md).errors.join('\n'), /cites no owner/);
});

test('a kind table without an Owner column fails', () => {
  const md = '| Kind | Name |\n|---|---|\n| `3700` | request |\n';
  assert.match(lint(md).errors.join('\n'), /no Owner column/);
});

test('an external kind in the agentbox band fails', () => {
  const md = BAND + '\n' + table(['| `38412` | external (someone) | squatter |']);
  assert.match(lint(md).errors.join('\n'), /external kind 38412-38412 sits in the agentbox band/);
});

test('an agentbox kind in a free band row fails', () => {
  const md = BAND + '\n' + table(['| `38405` | agentbox | unallocated |']);
  assert.match(lint(md).errors.join('\n'), /marked free/);
});

test('the URN kind table is not read as a Nostr kind table', () => {
  const md = '| Kind | ownerScope |\n|---|---|\n| `chain` | `false` |\n\n' + table(['| `3500` | external (sidestr) | chain |']);
  assert.deepEqual(lint(md).errors, []);
});
