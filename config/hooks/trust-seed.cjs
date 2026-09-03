#!/usr/bin/env node
'use strict';
// trust-seed.cjs — pre-accept Claude Code's "Do you trust the files in this
// folder?" dialog for every estate checkout, so unattended sessions (tmux
// teammate panes, background agents, cron-driven `claude -p`) never block on
// a prompt nobody is watching. Observed 2026-09-02: ten Opus worker panes sat
// dead for an hour behind the trust gate.
//
// Trust is recorded per absolute path under `projects.<path>` in ~/.claude.json.
// This script marks:
//   * the workspace root (WORKSPACE, default /home/devuser/workspace)
//   * every git checkout or worktree under it, to a bounded depth
//   * any extra paths passed as arguments
// It never removes or overwrites other per-project state. Fail-open: any
// error prints one line to stderr and exits 0 so hooks and boot never stall.
//
// Runs from: the SessionStart hook in workspace .claude/settings.json and the
// agentbox entrypoint (boot). Safe to run at any time; idempotent.
//
//   node trust-seed.cjs [--depth N] [--dry-run] [extra-path ...]

const fs = require('node:fs');
const path = require('node:path');

const HOME = process.env.HOME || '/home/devuser';
const WORKSPACE = process.env.WORKSPACE || path.join(HOME, 'workspace');
const CONFIG = path.join(HOME, '.claude.json');
const SKIP = new Set(['node_modules', 'target', '.tmp', '.cache', '.venv', 'venv', '.git', 'dist', 'build']);

function parseArgs(argv) {
  const out = { depth: 5, dryRun: false, extra: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--depth') { out.depth = Number(argv[i + 1]) || 3; i += 1; }
    else if (a === '--dry-run') out.dryRun = true;
    else out.extra.push(a);
  }
  return out;
}

function isGitRoot(dir) {
  try {
    const st = fs.lstatSync(path.join(dir, '.git'));
    return st.isDirectory() || st.isFile(); // worktrees and submodules use a .git file
  } catch { return false; }
}

// A "project" for the trust dialog is the session's cwd, not the git root, so
// any directory a nested worker may start in must be trusted too: git roots
// and worktrees, plus crate / package / python-project directories under them.
const PROJECT_MARKERS = ['Cargo.toml', 'package.json', 'pyproject.toml', 'flake.nix', 'justfile'];
function isProjectDir(dir) {
  if (isGitRoot(dir)) return true;
  return PROJECT_MARKERS.some((m) => { try { return fs.statSync(path.join(dir, m)).isFile(); } catch { return false; } });
}

function findRepos(root, depth, acc) {
  if (depth < 0) return acc;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(root, e.name);
    if (isProjectDir(p)) acc.push(p);
    findRepos(p, depth - 1, acc);
  }
  return acc;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = new Set([WORKSPACE, ...findRepos(WORKSPACE, args.depth, []), ...args.extra.map((p) => path.resolve(p))]);
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch (err) {
    if (err.code !== 'ENOENT') { process.stderr.write(`[trust-seed] ${CONFIG} unreadable: ${err.message}\n`); return; }
  }
  if (typeof cfg !== 'object' || cfg === null) cfg = {};
  cfg.projects = cfg.projects && typeof cfg.projects === 'object' ? cfg.projects : {};
  let added = 0;
  for (const dir of targets) {
    const entry = cfg.projects[dir] && typeof cfg.projects[dir] === 'object' ? cfg.projects[dir] : {};
    if (entry.hasTrustDialogAccepted === true && entry.hasCompletedProjectOnboarding === true) continue;
    cfg.projects[dir] = { ...entry, hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true };
    added += 1;
  }
  if (args.dryRun || added === 0) {
    process.stdout.write(`[trust-seed] ${targets.size} path(s) checked, ${added} newly trusted${args.dryRun ? ' (dry run)' : ''}\n`);
    return;
  }
  // ~/.claude.json is a bind-mounted file inside a read-only $HOME, so a
  // sibling temp file + rename is impossible; write in place, keeping a
  // backup of the previous content under the workspace.
  try {
    const bak = path.join(WORKSPACE, '.agentbox', 'claude.json.pre-trust-seed');
    fs.mkdirSync(path.dirname(bak), { recursive: true });
    fs.copyFileSync(CONFIG, bak);
  } catch { /* best effort */ }
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');
  process.stdout.write(`[trust-seed] ${targets.size} path(s) checked, ${added} newly trusted\n`);
}

try { main(); } catch (err) { process.stderr.write(`[trust-seed] failed open: ${err.message}\n`); }
