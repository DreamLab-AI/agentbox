// Real picker inputs, fake transport: no model call or paid accuracy claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const picker = require('../../config/hooks/lib/skill-route.cjs');
const skills = fileURLToPath(new URL('../../skills', import.meta.url));
const manifest = fileURLToPath(new URL('../../skills/registered-skills.txt', import.meta.url));
const prompt = 'Implement this multi-file feature with TDD, EDD, quality gates and evidence-bound review before release.';
const config = () => picker.config({
  AGENTBOX_SKILL_ROUTER: 'jev', TYPESAFE_API_KEY: 'fixture-only',
  AGENTBOX_SKILL_ROUTE_SKILLS_DIR: skills, AGENTBOX_SKILL_ROUTE_REGISTERED_MANIFEST: manifest,
  AGENTBOX_SKILL_ROUTE_CLAUDE_DIR: '0', AGENTBOX_SKILL_ROUTE_LOG: '0',
});

test('actual source candidates and registered BM25 select VisionCraft for quality work', () => {
  const all = picker.loadCandidates(skills);
  assert.ok(all.visioncraft);
  assert.equal(all['build-with-quality'], undefined);
  const { criteria } = picker.restrictToRegistered(all, config());
  assert.equal(picker.localRank(prompt, criteria).choice, 'visioncraft');
});

test('the real Jev request offers VisionCraft alone and consumes its returned choice', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const request = JSON.parse(init.body);
    assert.ok(request.questions.skill.criteria.visioncraft);
    assert.equal(request.questions.skill.criteria['build-with-quality'], undefined);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({
      model: 'jev-fixture', answers: { skill: { type: 'choice', choice: 'visioncraft', confidence: 0.9, probabilities: { visioncraft: 0.9 } } }, usage: { input_tokens: 0, output_tokens: 0 },
    }) };
  };
  try {
    const result = await picker.route(prompt, config(), { registeredOnly: true });
    assert.equal(calls, 1);
    assert.equal(result.choice, 'visioncraft');
    assert.match(picker.formatContext(result), /visioncraft/);
  } finally { globalThis.fetch = previous; }
});
