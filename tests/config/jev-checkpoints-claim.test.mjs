// AB-08-S1-01 — the claim-specific done check, pure logic. The plugin's own suite
// (config/claude-plugins/jev-checkpoints/tests, tier 'user') needs the Claude Code test
// harness; the decision rule, the option reader and the Noul reader are dependency-free
// TypeScript, so they are exercised here under plain node (type stripping).
//
//   node --test tests/config/jev-checkpoints-claim.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const hooks = path.join(root, 'config/claude-plugins/jev-checkpoints/hooks')
const { doneInjects, noulQuestion, readNoul, readScore } = await import(path.join(hooks, 'jev.ts'))
const { readOptions } = await import(path.join(hooks, 'options.ts'))

const base = { score: 0.5, threshold: 0.9, claimCheck: false, claimUnverified: 0.99, claimThreshold: 0.9 }

test('off by default; only a true claimCheck is honoured; an out-of-range threshold is the default', () => {
  assert.equal(readOptions(undefined).claimCheck, false)
  assert.equal(readOptions({}).claimThreshold, 0.9)
  assert.equal(readOptions({ claimCheck: true }).claimCheck, true)
  assert.equal(readOptions({ claimCheck: 'true' }).claimCheck, true)
  assert.equal(readOptions({ claimCheck: 'yes' }).claimCheck, false)
  assert.equal(readOptions({ claimThreshold: 1.5 }).claimThreshold, 0.9)
  assert.equal(readOptions({ claimThreshold: 0.6 }).claimThreshold, 0.6)
})

test('fallback equivalence: with the check off the decision equals the original rule for every input', () => {
  const original = (score, threshold) => (score === null ? false : score >= threshold)
  for (const score of [null, 0, 0.3, 0.89, 0.9, 0.95, 1]) {
    for (const claimUnverified of [null, 0, 0.5, 0.99]) {
      for (const threshold of [0.5, 0.9]) {
        assert.equal(doneInjects({ ...base, score, claimUnverified, threshold }), original(score, threshold))
      }
    }
  }
})

test('with the check on, the claim answer missing, malformed or low is the original decision too', () => {
  const original = (score, threshold) => (score === null ? false : score >= threshold)
  for (const score of [null, 0.3, 0.95]) {
    for (const claimUnverified of [null, readNoul({ noul: 'x' }), readNoul({}), 0, 0.5, 0.89]) {
      assert.equal(doneInjects({ ...base, claimCheck: true, score, claimUnverified }), original(score, 0.9))
    }
  }
})

test('accept path: an uncovered claim at or above the claim threshold adds the line; it never removes one', () => {
  assert.equal(doneInjects({ ...base, claimCheck: true, score: 0.3, claimUnverified: 0.9 }), true)
  assert.equal(doneInjects({ ...base, claimCheck: true, score: 0.3, claimUnverified: 0.99, claimThreshold: 1 }), false)
  for (const claimUnverified of [null, 0, 1]) assert.equal(doneInjects({ ...base, claimCheck: true, score: 0.95, claimUnverified }), true)
  // an unreadable done score is never rescued by the claim answer
  assert.equal(doneInjects({ ...base, claimCheck: true, score: null, claimUnverified: 0.99 }), false)
})

test('wire shape: a Noul is {type, instructions} only; readNoul accepts a probability and nothing else', () => {
  assert.deepEqual(noulQuestion('q?'), { type: 'noul', instructions: 'q?' })
  assert.equal(readNoul({ type: 'noul', noul: 0.25 }), 0.25)
  for (const bad of [null, undefined, 'x', {}, { noul: -0.1 }, { noul: 1.1 }, { noul: 'a' }, { noul: NaN }]) assert.equal(readNoul(bad), null)
  assert.equal(readScore({ score: 0.5, legend: { 0: 'no', 1: 'yes' } }), 0.5)
})

test('the register wires the Noul into the SAME done request, behind the option, and the tables agree', () => {
  const reg = fs.readFileSync(path.join(hooks, 'register.ts'), 'utf8')
  assert.match(reg, /ctx\.opts\.claimCheck \? \{ \.\.\.DONE_QUESTIONS, \.\.\.CLAIM_QUESTIONS \} : DONE_QUESTIONS/)
  assert.match(reg, /claim_unverified: noulQuestion\(/)
  const plugin = JSON.parse(fs.readFileSync(path.join(root, 'config/claude-plugins/jev-checkpoints/.claude-plugin/plugin.json'), 'utf8'))
  assert.equal(plugin.userConfig.claimCheck.default, false)
  assert.equal(plugin.userConfig.claimThreshold.default, 0.9)
  const toml = fs.readFileSync(path.join(root, 'agentbox.toml'), 'utf8')
  assert.match(toml, /^claim_check = false\b/m)
  assert.match(fs.readFileSync(path.join(root, 'config/entrypoint-unified.sh'), 'utf8'), /"claimCheck=\$\(_ab_toml_val features\.jev_checkpoints claim_check\)"/)
})
