#!/usr/bin/env node
// Provider profile reconciliation for the session plane (ADR-2153).
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const WORKSPACE = process.env.WORKSPACE || '/home/devuser/workspace';
const log = (...a) => console.log('[session-provision]', ...a);
const warn = (...a) => console.warn('[session-provision]', ...a);
function writeJsonIfContent(file, obj, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', { mode });
  fs.chmodSync(file, mode);
}

function provisionOpenRouter() {
  const key = process.env.OPENROUTER_API_KEY;
  const profile = path.join(WORKSPACE, 'profiles', 'openrouter');
  const settings = path.join(profile, '.claude', 'settings.local.json');
  if (!key) {
    warn('OPENROUTER_API_KEY not set — leaving profiles/openrouter/.claude/settings.local.json as-is (wrapper will hard-fail if empty).');
    return;
  }
  const model = process.env.OR_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free';
  writeJsonIfContent(settings, {
    env: {
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
      ANTHROPIC_AUTH_TOKEN: key,
      ANTHROPIC_API_KEY: '',
    },
    model,
  });
  log(`provisioned openrouter settings.local.json (model: ${model}).`);
}

function provisionZai() {
  const key = process.env.ZAI_ANTHROPIC_API_KEY || process.env.ZAI_API_KEY;
  const profile = path.join(WORKSPACE, 'profiles', 'zai');
  const settings = path.join(profile, '.claude', 'settings.local.json');
  if (!key) {
    warn('ZAI_API_KEY / ZAI_ANTHROPIC_API_KEY not set — leaving profiles/zai/.claude/settings.local.json as-is (wrapper will hard-fail if empty).');
    return;
  }
  const endpoint = process.env.ZAI_URL || 'https://api.z.ai/api/paas/v4';
  writeJsonIfContent(settings, {
    env: {
      ANTHROPIC_BASE_URL: endpoint,
      ANTHROPIC_AUTH_TOKEN: key,
      ANTHROPIC_API_KEY: '',
    },
  });
  log(`provisioned zai settings.local.json (endpoint: ${endpoint}).`);
}

function normalizedV1Url(value, fallback) {
  return (value || fallback).replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1';
}

// Never inflate a smaller served context to the previous model's budget. Missing
// or malformed metadata gets a conservative fallback; output reserves input room.
function agentContext(value) {
  return Number.isSafeInteger(value) && value >= 4 ? Math.min(value, 131072) : 8192;
}

// Model listing is discovery metadata, not evidence of tool/vision qualification.
export function selectLoomModel(listing, env = {}) {
  const data = Array.isArray(listing?.data) ? listing.data : [];
  const ids = [...new Set(data.map(m => m.id).filter(id => typeof id === 'string' && id.trim()))];
  // GEMMA_MODEL is legacy ontology-profile state and may survive model swaps.
  // Only the agent's explicit LOOM_MODEL override constrains live discovery.
  const explicit = env.LOOM_MODEL;
  if (!ids.length) throw new Error('Loom /models advertised no model IDs; existing providers retained');
  if (explicit && !ids.includes(explicit)) throw new Error(`Requested Loom model ${explicit} is not advertised`);
  if (!explicit && ids.length !== 1) throw new Error('Loom advertises multiple models; set LOOM_MODEL explicitly');
  const id = explicit || ids[0];
  const row = data.find(m => m.id === id);
  // llama.cpp exposes capabilities in a parallel models array, keyed by model/name.
  const companion = (Array.isArray(listing.models) ? listing.models : [])
    .find(m => [m.id, m.model, m.name].includes(id));
  const capabilities = [...(Array.isArray(row.capabilities) ? row.capabilities : []),
    ...(Array.isArray(companion?.capabilities) ? companion.capabilities : [])];
  // llama.cpp's companion listing uses "multimodal" for its image projector.
  // A generic audio-capable provider may use the same word: require explicit
  // image metadata there rather than advertising image input by accident.
  let image = (row.owned_by === 'llamacpp' && capabilities.includes('multimodal')) || capabilities.includes('vision')
    || row.modalities?.input?.includes('image') === true;
  // Explicit operator override for servers without capability metadata. This
  // advertises input support only; vision qualification is a separate live gate.
  if (env.LOOM_IMAGE_INPUT !== undefined) {
    if (!['true', 'false'].includes(env.LOOM_IMAGE_INPUT)) throw new Error('LOOM_IMAGE_INPUT must be true or false');
    image = env.LOOM_IMAGE_INPUT === 'true';
  }
  const contextMetadata = [row.meta?.n_ctx, row.context_window, row.context_length,
    row.max_model_len, row.limit?.context, companion?.meta?.n_ctx,
    companion?.context_window, companion?.context_length]
    .find(value => Number.isSafeInteger(value) && value >= 4);
  return { id, image, context: agentContext(contextMetadata) };
}

// OpenCode is a first-class AoE agent, so provider selection stays in its
// supported configuration surface instead of inventing custom wrapper agents.
export function openCodeConfig(env = process.env, home = os.homedir(), existing = {}, selected) {
  if (!selected?.id) throw new Error("A discovered Loom model is required");
  const loomBase = normalizedV1Url(env.LOOM_BASE_URL || env.GEMMA_BASE_URL, 'http://loom:8080/v1');
  const deepseekBase = normalizedV1Url(env.DEEPSEEK_BASE_URL, 'https://api.deepseek.com/v1');
  const loomModel = env.LOOM_MODEL || env.GEMMA_MODEL || 'qwen3.8-27B';
  // New agents use a stable logical ID; legacy sessions retain their alias.
  // Both use the facade with the same discovered wire model.
  const context = agentContext(selected.context);
  const agentModel = {
    id: selected.id,
    name: `${selected.id} (Loom passthrough)`,
    tool_call: true,
    attachment: selected.image === true,
    modalities: { input: selected.image ? ['text', 'image'] : ['text'], output: ['text'] },
    limit: { context, output: Math.min(16384, Math.floor(context / 4)) },
    options: {
      loom_options: { scaffold: false },
      ...(/qwen/i.test(selected.id) ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    },
  };
  return {
    ...existing,
    $schema: 'https://opencode.ai/config.json',
    skills: {
      ...existing.skills,
      paths: [...new Set([...(existing.skills?.paths || []), path.join(home, '.codex', 'skills')])],
    },
    provider: {
      ...existing.provider,
      'loom-lan': existing.provider?.['loom-lan'] || {
        npm: '@ai-sdk/openai-compatible', name: 'Loom LAN',
        options: { baseURL: loomBase, apiKey: 'not-needed' },
        models: { [loomModel]: { name: 'Qwen (ontology scaffold)', limit: { context: 131072, output: 16384 } } },
      },
      'loom-agent': {
        ...existing.provider?.['loom-agent'],
        npm: '@ai-sdk/openai-compatible', name: 'Loom agent',
        options: { ...existing.provider?.['loom-agent']?.options, baseURL: loomBase, apiKey: 'not-needed', timeout: 900000, headerTimeout: 900000 },
        models: { ...existing.provider?.['loom-agent']?.models, current: agentModel },
      },
      'loom-raw': {
        ...existing.provider?.['loom-raw'],
        npm: '@ai-sdk/openai-compatible', name: 'Loom agent (legacy alias)',
        options: { ...existing.provider?.['loom-raw']?.options, baseURL: loomBase, apiKey: 'not-needed', timeout: 900000, headerTimeout: 900000 },
        models: { ...existing.provider?.['loom-raw']?.models, 'qwen3.8-27B': agentModel },
      },
      // Keep OpenCode's native provider so its free-tier client handling applies.
      // This is an optional selection; direct DeepSeek remains the seed default.
      opencode: {
        ...existing.provider?.opencode,
        models: {
          ...existing.provider?.opencode?.models,
          'deepseek-v4.1-flash-free': {
            ...existing.provider?.opencode?.models?.['deepseek-v4.1-flash-free'],
            name: 'DeepSeek V4.1 Flash Free',
            limit: { context: 200000, output: 32000 },
          },
        },
      },
      'deepseek-agent': {
        npm: '@ai-sdk/openai-compatible', name: 'DeepSeek Agent',
        options: { baseURL: deepseekBase, apiKey: '{env:DEEPSEEK_API_KEY}' },
        models: {
          'deepseek-flash': { name: 'DeepSeek V4.1 Flash' },
          // Existing AoE sessions retain extraArgs at boot. Route their old
          // selector to the current wire model without killing sessions.
          'deepseek-chat': { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' },
        },
      },
    },
  };
}

export async function provisionOpenCode({ env = process.env, home = os.homedir(), fetchImpl = globalThis.fetch } = {}) {
  const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config');
  const configPath = path.join(configHome, 'opencode', 'opencode.json');
  // Refuse unreadable settings and failed/ambiguous discovery before any write.
  const existing = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  const base = normalizedV1Url(env.LOOM_BASE_URL || env.GEMMA_BASE_URL, 'http://loom:8080/v1');
  const response = await fetchImpl(`${base}/models`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Loom model discovery HTTP ${response.status}`);
  const selected = selectLoomModel(await response.json(), env);
  const config = openCodeConfig(env, home, existing, selected);
  writeJsonIfContent(configPath, config, 0o644);
  // Boot reconciliation runs as root with the user's home. Leave this user
  // configuration refreshable by its owner after a backend model swap.
  if (process.getuid?.() === 0) {
    // Nix can own the home directory as root while its account remains devuser.
    const account = fs.readFileSync('/etc/passwd', 'utf8').split('\n')
      .map(line => line.split(':')).find(fields => fields[5] === home);
    const owner = fs.statSync(configHome);
    const uid = account ? Number(account[2]) : owner.uid;
    const gid = account ? Number(account[3]) : owner.gid;
    fs.chownSync(path.dirname(configPath), uid, gid);
    fs.chownSync(configPath, uid, gid);
  }
  log(`provisioned Loom agent ${selected.id} via ${base} (image advertised: ${selected.image}; qualification required).`);
  return config;
}


async function main() {
  let failed = false;
  for (const provision of [provisionOpenRouter, provisionZai, provisionOpenCode]) {
    try { await provision(); } catch (e) { warn(e.message); failed = true; }
  }
  if (failed) process.exitCode = 1;
}
const real = p => { try { return fs.realpathSync(p); } catch { return p; } };
if (process.argv[1] && real(path.resolve(process.argv[1])) === real(fileURLToPath(import.meta.url))) main();
