'use strict';

/**
 * Reads and parses the agentbox.toml manifest.
 * Path: AGENTBOX_MANIFEST_PATH env or /etc/agentbox.toml (default).
 */

const fs = require('fs');
const path = require('path');

class ManifestNotFound extends Error {
  constructor(manifestPath) {
    super(`agentbox manifest not found at ${manifestPath}`);
    this.name = 'ManifestNotFound';
    this.path = manifestPath;
  }
}

/**
 * Minimal TOML parser (pure-JS, no native compilation).
 * Handles the subset used by agentbox.toml:
 *   - bare key = "string" | true | false | integer | float
 *   - [section] and [section.subsection]
 *   - inline comments via #
 * Does NOT handle arrays-of-tables ([[x]]), multiline strings, or dates.
 */
function parseTOML(src) {
  const result = {};
  let cursor = result;
  let sectionPath = [];

  const lines = src.split(/\r?\n/);
  for (const rawLine of lines) {
    // Strip inline comments and trim
    const line = rawLine.replace(/#[^"]*$/, '').trim();
    if (!line) continue;

    // Section header
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      sectionPath = sectionMatch[1].split('.').map(s => s.trim());
      cursor = result;
      for (const key of sectionPath) {
        if (!Object.prototype.hasOwnProperty.call(cursor, key)) {
          cursor[key] = {};
        }
        cursor = cursor[key];
      }
      continue;
    }

    // Key = value
    const kvMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const rawVal = kvMatch[2].trim();
      cursor[key] = parseValue(rawVal);
      continue;
    }
  }

  return result;
}

function parseValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^"(.*)"$/.test(raw)) return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (/^'(.*)'$/.test(raw)) return raw.slice(1, -1);
  const num = Number(raw);
  if (!isNaN(num) && raw !== '') return num;
  return raw;
}

/**
 * Returns the parsed manifest as a plain JS object.
 * @throws {ManifestNotFound}
 */
function loadManifest() {
  const manifestPath = process.env.AGENTBOX_MANIFEST_PATH || '/etc/agentbox.toml';
  const resolved = path.resolve(manifestPath);

  if (!fs.existsSync(resolved)) {
    throw new ManifestNotFound(resolved);
  }

  const src = fs.readFileSync(resolved, 'utf8');
  return parseTOML(src);
}

module.exports = { loadManifest, ManifestNotFound };
