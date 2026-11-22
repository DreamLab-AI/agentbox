'use strict';

// Non-secret boot projection. Antigravity ignores GOOGLE_API_KEY and dotenv;
// Compose supplies GEMINI_API_KEY, while this selects its documented provider.
// In "oauth" mode it removes that projection instead: ~/.gemini is a named
// volume (ADR-2214), so an API-key provider written by an earlier boot would
// otherwise persist and override the Google sign-in. Never touches the token.
const fs = require('node:fs');
const path = require('node:path');

const API_MODEL_URI = 'gemini-api://models/gemini-4-hydrogen';

function readSettings(file) {
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!settings || Array.isArray(settings) || typeof settings !== 'object') {
    throw new Error('Antigravity settings must be a JSON object');
  }
  return settings;
}

function writeSettings(directory, file, settings) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.agentbox-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}

// Remove only what api_key mode wrote; operator settings (theme, other custom
// models, an explicit non-gemini provider) are kept.
function clearApiProjection(directory, file) {
  if (!fs.existsSync(file)) return false;
  const settings = readSettings(file);
  const before = JSON.stringify(settings);
  if (settings.modelProvider === 'gemini') delete settings.modelProvider;
  const custom = settings.customModelsConfig?.customModels;
  if (custom?.['gemini-4-hydrogen']?.modelName === API_MODEL_URI) {
    delete custom['gemini-4-hydrogen'];
    if (Object.keys(custom).length === 0) delete settings.customModelsConfig.customModels;
    if (Object.keys(settings.customModelsConfig).length === 0) delete settings.customModelsConfig;
  }
  if (JSON.stringify(settings) === before) return false;
  writeSettings(directory, file, settings);
  return true;
}

function provision(home, mode, env = process.env) {
  const directory = path.join(home, '.gemini', 'antigravity-cli');
  const file = path.join(directory, 'settings.json');
  if (mode === 'oauth') return clearApiProjection(directory, file);
  if (mode !== 'api_key') return false; // Unknown mode: leave settings alone.
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required for Antigravity API-key mode');
  const settings = readSettings(file);
  const before = JSON.stringify(settings);
  settings.modelProvider = 'gemini';
  // 1.5.7 predates Hydrogen in its built-in picker. Its API-key path strips
  // gemini-api:// then passes the remainder as the SDK model name, unlike the
  // full base-URL form in the docs (which produces a 404). Local HTTP probes
  // and an authenticated Hydrogen turn verify this version-specific URI.
  settings.customModelsConfig ||= {};
  settings.customModelsConfig.customModels ||= {};
  settings.customModelsConfig.customModels['gemini-4-hydrogen'] = {
    modelName: API_MODEL_URI,
    label: 'Gemini 4 Hydrogen',
    toolFormatterType: 'TOOL_FORMATTER_TYPE_NONE',
  };
  if (JSON.stringify(settings) === before) return false;
  writeSettings(directory, file, settings);
  return true;
}

module.exports = { provision };
if (require.main === module) {
  try { for (const home of process.argv.slice(3)) provision(home, process.argv[2]); }
  catch { console.error('Antigravity provider projection failed; check key presence and settings JSON (credentials not logged)'); process.exitCode = 1; }
}
