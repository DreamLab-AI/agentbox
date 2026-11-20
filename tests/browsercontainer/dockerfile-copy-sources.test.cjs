'use strict';
// The sidecar image cannot be built in CI or in the agent container, so a COPY
// that names a path outside the build context only fails at the owner's rebuild.
// This test checks every COPY/ADD in the Dockerfile against the build context.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const context = path.join(__dirname, '..', '..', 'browsercontainer');
const dockerfile = fs.readFileSync(path.join(context, 'Dockerfile'), 'utf8');

// Fetched into the context by `agentbox.sh browsercontainer rebuild` (scripts/fetch-podkey.sh).
const FETCHED_AT_BUILD = new Set(['vendor/podkey-extension.zip']);

function copyInstructions(text) {
  const joined = text.replace(/\\\r?\n/g, ' ');
  return joined.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(COPY|ADD)\s/.test(line))
    .filter((line) => !/--from=/.test(line))
    .map((line) => {
      const args = line.split(/\s+/).slice(1).filter((a) => !a.startsWith('--'));
      return { line, sources: args.slice(0, -1), dest: args[args.length - 1] };
    });
}

test('every COPY source exists in the build context', () => {
  const instructions = copyInstructions(dockerfile);
  assert.ok(instructions.length > 10, 'expected the Dockerfile to COPY its files');
  const problems = [];
  for (const { line, sources } of instructions) {
    for (const src of sources) {
      if (FETCHED_AT_BUILD.has(src)) continue;
      if (path.isAbsolute(src)) { problems.push(`absolute source "${src}" in: ${line}`); continue; }
      if (!fs.existsSync(path.join(context, src))) problems.push(`missing source "${src}" in: ${line}`);
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('a COPY with several sources names a directory destination', () => {
  const problems = copyInstructions(dockerfile)
    .filter(({ sources, dest }) => sources.length > 1 && !dest.endsWith('/'))
    .map(({ line }) => line);
  assert.deepStrictEqual(problems, []);
});

test('every file the supervisor or Dockerfile executes is copied into the image', () => {
  const copied = new Set(copyInstructions(dockerfile).map(({ dest }) => dest));
  const supervisord = fs.readFileSync(path.join(context, 'supervisord.conf'), 'utf8');
  const referenced = new Set((supervisord + '\n' + dockerfile).match(/\/opt\/browsercontainer\/[A-Za-z0-9._\/-]+\.(?:sh|js|xml)(?![A-Za-z0-9])/g) || []);
  const missing = [...referenced].filter((p) => !copied.has(p));
  assert.deepStrictEqual(missing, []);
});
