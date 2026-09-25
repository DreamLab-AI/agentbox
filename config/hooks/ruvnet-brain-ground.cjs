#!/usr/bin/env node
// RuvNet Brain grounding hook for agentbox (UserPromptSubmit).
//
// When a prompt is genuinely ABOUT the upstream RuvNet ecosystem — how one of
// its packages works, what it supports, what changed in a release — inject a
// directive to ground the answer in search_ruvnet before asserting. When a
// prompt is choosing a classical substitute (Pinecone, pgvector, LangChain…),
// point at the RuvNet equivalent to check first.
//
// Why the triggers are narrow. This estate runs ruvector, claude-flow, ruflo,
// agentdb and agentic-qe every day, so a bare mention of one ("fix the ruvector
// recall gate", "check the claude-flow memory tools") is local operations, not
// a question about upstream. Generic words (`fact`, `daa`, `sparc`, `rvm`) are
// not names at all. So:
//   • DISTINCTIVE names — repos and scopes that only mean upstream (ruvnet,
//     github.com/ruvnet, @ruvector/…, qudag, ruv-fann…) — fire on their own;
//   • ESTATE names fire only with an upstream-intent cue (upstream, internals,
//     source, npm, crate, release, "how does X work", "does X support"…) in the
//     SAME sentence, so a long pasted log does not pair words from unrelated
//     lines;
//   • substitutes fire only with selection intent in the same sentence.
// The injected context is capped at MAX_CONTEXT_CHARS: it is paid for on every
// turn it fires.
//
// Protocol: reads hook JSON from stdin; writes the honoured
// {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":…}}
// shape (lib/hook-output.cjs) or nothing. Always exit 0. Fail-open: any error →
// no injection.

'use strict';

const path = require('path');

const MAX_CONTEXT_CHARS = 1200;

/** Names that only ever mean the upstream ecosystem; any one fires on its own. */
const DISTINCTIVE = [
  'ruvnet', 'ruv-net', 'github\\.com/ruvnet', '@ruvector/[a-z0-9._-]+', '@ruflo/[a-z0-9._-]+',
  'qudag', 'ruv-fann', 'ruv-swarm', 'synthlang', 'dspy\\.ts', 'rulake', 'agenticow', 'rupixel',
  'ruview', 'safla', 'agent-harness-generator', 'cve-bench',
];

/** Names this estate operates daily; they fire only beside an upstream-intent cue. */
const ESTATE = [
  'ruvector', 'claude-flow', '@claude-flow/[a-z0-9._-]+', 'ruflo', 'agentdb', 'agentic-flow',
  'agentic-qe', 'reasoningbank', 'sona', 'rvf',
];

/** Phrases that turn an estate name into a question about upstream. */
const UPSTREAM_CUES = [
  'upstream', 'under the hood', 'internals?', 'internally', 'source code', 'implementation of',
  'how (?:does|do|is|are) [\\w@/.-]+(?: [\\w@/.-]+)?(?: work| implement| handle| compute| store| index| do)',
  '(?:does|do|can) [\\w@/.-]+ (?:support|provide|offer|expose|have)',
  'what (?:does|do) [\\w@/.-]+ (?:support|provide|offer|expose|do)',
  'npm', 'crates?\\.io', 'crate', 'release notes?', 'changelog', 'latest version', 'new version',
  'api (?:of|for)', 'docs? for', 'documentation (?:of|for)', 'in the [\\w@/.-]+ (?:repo|codebase|source)',
];

const CLASSICAL_SUBS = [
  { pattern: /\b(?:pinecone|pine\s*cone)\b/i, alt: 'ruvector/agentdb' },
  { pattern: /\bpgvector\b/i, alt: 'ruvector/agentdb' },
  { pattern: /\b(?:chromadb|chroma\s*db)\b/i, alt: 'ruvector/agentdb' },
  { pattern: /\bweaviate\b/i, alt: 'ruvector/agentdb' },
  { pattern: /\blangchain\b/i, alt: 'ruflo/agentic-flow' },
  { pattern: /\bllamaindex\b/i, alt: 'ruflo/agentic-flow' },
  { pattern: /\bhnswlib\b/i, alt: '@ruvector/rvf' },
];

/** Selection intent: the prompt is choosing a substitute, not merely naming one. */
const SELECTION = /\b(?:use|using|adopt|switch(?:ing)? (?:to|from)|migrat(?:e|ing) (?:to|from)|move (?:to|off)|replace|instead of|vs\.?|versus|compare|recommend|should (?:we|i)|pick|choose|alternative to|integrate)\b/i;

// Names may carry '@', '/', '.', '-': bound them by non-name characters, not \b. A
// leading '/' or '.' is allowed so URLs and paths (github.com/ruvnet/…) still match.
const nameRe = (alts) => new RegExp(`(?:^|[^a-z0-9@_-])(?:${alts.join('|')})(?![a-z0-9_-])`, 'i');
const DISTINCTIVE_RE = nameRe(DISTINCTIVE);
const ESTATE_RE = nameRe(ESTATE);
const CUE_RE = new RegExp(`\\b(?:${UPSTREAM_CUES.join('|')})\\b`, 'i');

const GROUNDING =
  '[GROUNDING] This prompt is about the upstream RuvNet ecosystem. Call ' +
  'mcp__ruvnet-brain__search_ruvnet before answering (fallback: memory_search, namespace ' +
  '"ruvnet-kb") and ground RuvNet-specific claims in indexed source, not training data.';

/** Sentences, so an estate name and a cue must co-occur in one thought to count. */
function sentences(text) {
  return String(text).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** Pure decision: the context to inject for this prompt, or '' for none. */
function analyse(prompt) {
  const text = String(prompt || '');
  if (!text.trim()) return '';
  const parts = [];
  const sents = sentences(text);

  const upstream = DISTINCTIVE_RE.test(text) ||
    sents.some((s) => ESTATE_RE.test(s) && CUE_RE.test(s));
  if (upstream) parts.push(GROUNDING);

  const seen = new Set();
  for (const sub of CLASSICAL_SUBS) {
    const hit = sents.find((s) => sub.pattern.test(s) && SELECTION.test(s));
    if (!hit) continue;
    const term = hit.match(sub.pattern)[0];
    if (seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    parts.push(`[REDIRECT] "${term}" — the RuvNet equivalent is ${sub.alt}; check it with search_ruvnet before choosing the substitute.`);
    if (seen.size >= 2) break;
  }

  const ctx = parts.join('\n');
  return ctx.length > MAX_CONTEXT_CHARS ? `${ctx.slice(0, MAX_CONTEXT_CHARS - 1)}…` : ctx;
}

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const c of process.stdin) input += c;
  let hook;
  try { hook = JSON.parse(input || '{}'); } catch { return; }
  const ctx = analyse(hook.userInput || hook.prompt || '');
  if (!ctx) return;
  const { emitContext } = require(path.join(__dirname, 'lib', 'hook-output.cjs'));
  await emitContext(ctx);
}

if (require.main === module) {
  main().catch(() => {}).finally(() => { process.exitCode = 0; });
}

module.exports = { analyse, MAX_CONTEXT_CHARS };
