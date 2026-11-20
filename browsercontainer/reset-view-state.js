#!/usr/bin/env node
/**
 * ADR-2207 D1: remove saved view state from Chrome's Preferences before launch,
 * so every start is at 100 % zoom and the launch flags decide the window.
 *
 * Deletes exactly partition.per_host_zoom_levels, partition.default_zoom_level and
 * browser.window_placement. Any other key is left as it is (Podkey's vault is in
 * chrome.storage.local, not here). The file is left untouched when it is absent,
 * is not valid JSON, or holds none of those keys. A rewrite goes through a temp
 * file in the same directory and a rename, so Chrome never sees a half-written file.
 *
 * Usage: node reset-view-state.js <path/to/Default/Preferences>
 * Exit 0 in every expected case (including "nothing to do"); 1 only on an I/O
 * error while rewriting, which launch-chromium.sh logs and ignores.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const VIEW_STATE_KEYS = [
  ['partition', 'per_host_zoom_levels'],
  ['partition', 'default_zoom_level'],
  ['browser', 'window_placement'],
];

/** Removes the view-state keys from a parsed Preferences object in place. Returns the removed key paths. */
function stripViewState(prefs) {
  const removed = [];
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return removed;
  for (const [section, key] of VIEW_STATE_KEYS) {
    const parent = prefs[section];
    if (parent && typeof parent === 'object' && !Array.isArray(parent)
        && Object.prototype.hasOwnProperty.call(parent, key)) {
      delete parent[key];
      removed.push(`${section}.${key}`);
    }
  }
  return removed;
}

/** Applies stripViewState to a Preferences file. Returns { status, removed }. */
function resetFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { status: 'absent', removed: [] };
    throw err;
  }
  let prefs;
  try {
    prefs = JSON.parse(text);
  } catch {
    return { status: 'invalid-json', removed: [] };
  }
  const removed = stripViewState(prefs);
  if (removed.length === 0) return { status: 'unchanged', removed };
  const mode = fs.statSync(file).mode & 0o777;
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.reset-${process.pid}`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(prefs), { mode });
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
  return { status: 'reset', removed };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('usage: reset-view-state.js <Preferences>\n');
    process.exit(2);
  }
  try {
    const { status, removed } = resetFile(file);
    process.stderr.write(`[reset-view-state] ${status}${removed.length ? `: ${removed.join(', ')}` : ''}\n`);
  } catch (err) {
    process.stderr.write(`[reset-view-state] WARN: ${err.code || err.message}\n`);
    process.exit(1);
  }
}

module.exports = { VIEW_STATE_KEYS, stripViewState, resetFile };
