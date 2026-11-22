#!/usr/bin/env node
'use strict';

/**
 * Consultant: antigravity (Google Antigravity CLI).
 *
 * Spawns `agy` (installed via toolchains.antigravity_cli; lives on PATH
 * in the agentbox image). Antigravity replaces @google/gemini-cli
 * (sunset 2026-06-18) with a Go-native binary and Pro tier web login.
 *
 * Auth follows [providers.gemini].auth_mode, projected at boot as
 * AGENTBOX_ANTIGRAVITY_AUTH_MODE:
 *   - "oauth": the Google sign-in token from the primary agy state dir
 *     (/home/devuser/.gemini, a named volume) is copied into this consultant's
 *     own home before each call; no key and no provider override are passed,
 *     so agy uses the subscription session.
 *   - otherwise: GEMINI_API_KEY with session-only modelProvider=gemini, or the
 *     cached OAuth session when no key is supplied. GOOGLE_* aliases remain
 *     backwards-compatible.
 * HOME points at the antigravity home dir so cached session tokens are honoured.
 */

const fs = require('node:fs');
const path = require('node:path');
const { BaseConsultant } = require('../shared/consultant-base');
const { spawnCli } = require('../shared/spawn-cli');

const AGY_BIN = process.env.AGENTBOX_ANTIGRAVITY_BIN || 'agy';
const AGY_HOME = process.env.AGENTBOX_ANTIGRAVITY_HOME || '/home/devuser/.antigravity';
const PRIMARY_HOME = process.env.AGENTBOX_ANTIGRAVITY_PRIMARY_HOME || '/home/devuser';
const MODEL = process.env.AGENTBOX_ANTIGRAVITY_MODEL || 'gemini-4-hydrogen';
const TOKEN_REL = path.join('.gemini', 'antigravity-cli', 'antigravity-oauth-token');

function authMode(env = process.env) {
  return env.AGENTBOX_ANTIGRAVITY_AUTH_MODE === 'oauth' ? 'oauth' : 'api_key';
}

// Copy, never link: the consultant must not write the only persisted token.
// A refresh agy performs here stays in this home's tmpfs; the refresh token in
// the primary file stays authoritative. Re-copies when the primary is newer
// (a fresh sign-in) or the local copy is missing. Returns true when copied.
function syncOAuthToken(primaryHome = PRIMARY_HOME, home = AGY_HOME) {
  if (path.resolve(primaryHome) === path.resolve(home)) return false;
  const source = path.join(primaryHome, TOKEN_REL);
  const target = path.join(home, TOKEN_REL);
  let src;
  try { src = fs.statSync(source); } catch { return false; }
  try {
    const dst = fs.lstatSync(target);
    if (dst.isFile() && dst.mtimeMs >= src.mtimeMs) return false;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.agentbox-${process.pid}`;
  fs.copyFileSync(source, temporary);
  try { JSON.parse(fs.readFileSync(temporary, 'utf8')); }
  catch (error) { fs.rmSync(temporary, { force: true }); throw error; } // torn read: retry next call
  fs.chmodSync(temporary, 0o600);
  fs.utimesSync(temporary, src.atime, src.mtime);
  fs.renameSync(temporary, target);
  return true;
}

function cliAuth(env = process.env) {
  if (authMode(env) === 'oauth') {
    try { syncOAuthToken(); } catch { /* health reports the missing session */ }
    return { mode: 'oauth', args: [], env: { HOME: AGY_HOME } };
  }
  const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GEMINI_API_KEY || '';
  const settings = {
    modelProvider: 'gemini',
    customModelsConfig: { customModels: { 'gemini-4-hydrogen': {
      // CLI 1.5.7 forwards this remainder as the SDK model, not a base URL.
      modelName: 'gemini-api://models/gemini-4-hydrogen',
      label: 'Gemini 4 Hydrogen',
      toolFormatterType: 'TOOL_FORMATTER_TYPE_NONE',
    } } },
  };
  return {
    mode: 'api_key',
    args: key ? ['--settings', JSON.stringify(settings)] : [],
    env: { HOME: AGY_HOME, GEMINI_API_KEY: key },
  };
}

// API-equivalent estimate, not an Antigravity subscription invoice. Published
// introductory rates double on 2027-01-01; select by call time for long-lived MCPs.
function rates(now = new Date()) {
  // Hydrogen launch pricing is flat across the 1M context; no dated increase.
  if (MODEL === 'gemini-4-hydrogen') return { prompt: 0.0015, completion: 0.0075 };
  if (MODEL !== 'gemini-3.8-flash') return null;
  const multiplier = now >= new Date('2027-01-01T00:00:00Z') ? 2 : 1;
  return { prompt: 0.00075 * multiplier, completion: 0.00375 * multiplier };
}

function combinedPrompt(question, context) {
  return context
    ? `<context>\n${context}\n</context>\n\n<question>\n${question}\n</question>`
    : question;
}

async function callConsult({ question, context_excerpt }) {
  const prompt = combinedPrompt(question, context_excerpt);
  const auth = cliAuth();
  const result = await spawnCli({
    cmd: AGY_BIN,
    // agy >= 1.1 : --prompt is an alias for --print (single non-interactive
    // turn). The old --no-input flag no longer exists and made every consult
    // exit 2 ("flag provided but not defined").
    args: ['--model', MODEL, ...auth.args, '--print', prompt, '--output-format', 'text', '--print-timeout', '170s'],
    env: {
      ...auth.env,
      AGENTBOX_AGENT_ID:  'consultant-antigravity',
    },
    timeout_ms: 180_000,
  });
  if (result.code !== 0) {
    throw new Error(
      `agy exited ${result.code}` +
      (result.killed ? ' (killed by timeout)' : '') +
      (result.stderr ? `: ${result.stderr.slice(0, 400)}` : '')
    );
  }
  const response = result.stdout;
  const tokens = {
    prompt:     Math.ceil(prompt.length     / 4),
    completion: Math.ceil(response.length   / 4),
  };
  tokens.total = tokens.prompt + tokens.completion;
  const price = rates();
  const cost_usd = price ?
    (tokens.prompt     / 1000) * price.prompt +
    (tokens.completion / 1000) * price.completion : null;

  return { response, model: MODEL, tokens, cost_usd, citations: [] };
}

async function healthCheck() {
  // --version alone does not establish readiness. Discover models with the
  // same provider settings used for inference. This is a non-billable CLI
  // readiness check, not proof of key validity/quota; deployment smoke runs an
  // actual inference. Without a key, discovery checks the cached OAuth session.
  const auth = cliAuth();
  const v = await spawnCli({
    cmd: AGY_BIN,
    args: ['--version'],
    env: auth.env,
    timeout_ms: 10_000,
  });
  if (v.code !== 0) {
    return { ok: false, model: MODEL, last_error: `agy --version exit ${v.code}: ${v.stderr.slice(0, 200)}` };
  }
  const m = await spawnCli({
    cmd: AGY_BIN,
    args: [...auth.args, 'models'],
    env: auth.env,
    timeout_ms: 25_000,
  });
  if (m.code !== 0) {
    const why = (m.stderr || m.stdout).replace(/\s+/g, ' ').trim().slice(0, 200);
    return {
      ok: false, model: MODEL, version: v.stdout.trim(),
      last_error: auth.env.GEMINI_API_KEY
        ? `agy API-key model discovery failed: ${why}`
        : `agy not authenticated (${auth.mode}): ${why} — sign in once as devuser with plain \`agy\` (HOME=${PRIMARY_HOME}, token persists in ${path.join(PRIMARY_HOME, TOKEN_REL)})`,
    };
  }
  return { ok: true, model: MODEL, last_error: null, version: v.stdout.trim() };
}

async function estimateCost({ question_size, expected_response_size }) {
  const price = rates();
  if (!price) throw new Error(`No published tariff configured for ${MODEL}; consult remains available`);
  return {
    estimated_tokens: { prompt: question_size, completion: expected_response_size },
    estimated_usd:
      (question_size           / 1000) * price.prompt +
      (expected_response_size  / 1000) * price.completion,
  };
}

const consultant = new BaseConsultant({
  name:        'antigravity',
  description: 'Google Antigravity (agy CLI) — 1M-token context window for long-document analysis and codebase-wide reasoning',
  model:       MODEL,
  callConsult,
  healthCheck,
  estimateCost,
});

module.exports = { authMode, cliAuth, syncOAuthToken };

if (require.main === module) {
  consultant.start().catch((err) => {
    process.stderr.write(`[consultant-antigravity] failed to start: ${err.message}\n`);
    process.exit(1);
  });
}
