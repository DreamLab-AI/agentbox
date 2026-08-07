#!/usr/bin/env node
'use strict';

/**
 * continual-harness CLI — evidence-anchored, signed, git-rollbackable refines of
 * the mutable harness layer (prime-agent Continual Harness, bound to our substrate).
 *
 * Resolves the repo lib first, then the baked /opt copy, so it works both in the
 * dev tree and inside the provisioned image (same pattern as ontology-local.cjs).
 *
 *   continual-harness refine <layer> <key> --value <text> --evidence <span> [--reason r]
 *   continual-harness validate [ref]           # guard: touches only the mutable layer?
 *   continual-harness rollback <commit>        # git revert a refine
 *   continual-harness history [layer] [key]
 *   continual-harness list
 *
 *   layer ∈ supplemental-prompt | memory | skill-spec | subagent-spec
 *
 * Env: AGENTBOX_HARNESS_DIR, AGENTBOX_IMMUTABLE_BASE (colon-list),
 *      AGENTBOX_REFINE_OPERATOR (default did:nostr:jjohare).
 */

let createHarness;
try {
  ({ createHarness } = require('./lib/continual-harness.js'));
} catch (_) {
  ({ createHarness } = require('/opt/agentbox/mcp/servers/lib/continual-harness.js'));
}

// minimal --flag parser
function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      flags[k] = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function out(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }
function fail(msg) { process.stderr.write(`error: ${msg}\n`); process.exit(1); }

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseFlags(rest);
  const h = createHarness();

  switch (cmd) {
    case 'refine': {
      const [layer, key] = positional;
      if (!layer || !key) fail('usage: refine <layer> <key> --value <text> --evidence <span> [--reason r]');
      try {
        const res = await h.refine({
          layer,
          key,
          value: typeof flags.value === 'string' ? flags.value : '',
          evidence: typeof flags.evidence === 'string' ? flags.evidence : '',
          reason: typeof flags.reason === 'string' ? flags.reason : undefined,
          actor: typeof flags.actor === 'string' ? flags.actor : undefined,
        });
        out(res);
      } catch (e) { fail(e.message); }
      break;
    }
    case 'validate': {
      out(h.validate(positional[0] || 'HEAD'));
      break;
    }
    case 'rollback': {
      if (!positional[0]) fail('usage: rollback <commit>');
      try { out(h.rollback(positional[0])); } catch (e) { fail(e.message); }
      break;
    }
    case 'history': {
      out(h.history({ layer: positional[0], key: positional[1], limit: flags.limit ? Number(flags.limit) : 20 }));
      break;
    }
    case 'list': {
      out({ harnessDir: h.harnessDir, operator: h.operator, layers: h.list() });
      break;
    }
    default:
      fail(`unknown command: ${cmd || '(none)'} — expected refine|validate|rollback|history|list`);
  }
}

main().catch((e) => fail(e && e.message ? e.message : String(e)));
