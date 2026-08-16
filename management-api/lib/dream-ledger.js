'use strict';

/**
 * dream-ledger — read-only aggregation of the dream engine's per-repo ledgers
 * for the cockpit `/dream` panel (ADR-055).
 *
 * The dream engine (services/dream-engine, ADR-052) appends a 10-column row to
 * each nominated repo's `docs/dream-cycle/LEDGER.md`. This module discovers the
 * nominated repos, parses their ledgers, and computes the small summaries the
 * panel renders. It never writes and never shells out — pure parsing plus
 * read-only fs, path-guarded against traversal.
 */

const fs = require('fs');
const path = require('path');

/** Canonical 10-column ledger order → stable object keys. */
const LEDGER_KEYS = [
  'date',
  'deep',
  'finding',
  'issue',
  'pr',
  'evaluated',
  'verdict',
  'effect',
  'witness',
  'priorFates',
];

const VERDICTS = ['ACCEPT', 'REJECT', 'INCONCLUSIVE'];

/** Split one markdown table line into trimmed cells, honouring `\|` escapes. */
function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  // Split on pipes that are not backslash-escaped, then unescape.
  return trimmed
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());
}

/** A line is the header/separator scaffolding (` | --- | --- | `), not data. */
function isSeparator(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');
}

/**
 * Parse a LEDGER.md string into row objects. Tolerant: ignores prose, the header
 * row, and the `---` separator; only lines that look like a data row (leading `|`
 * and the right column count once the header is seen) are kept.
 */
function parseLedger(md) {
  if (!md || typeof md !== 'string') return { rows: [] };
  const rows = [];
  let sawHeader = false;
  for (const line of md.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    if (isSeparator(line)) {
      sawHeader = true;
      continue;
    }
    const cells = splitRow(line);
    // The header row names the columns; skip it (first pipe-row before separator).
    if (!sawHeader) {
      if (/^\s*date\s*$/i.test(cells[0] || '')) continue;
      // A pipe-row before any separator that is not the header is unusual; skip.
      continue;
    }
    if (cells.length < LEDGER_KEYS.length) continue; // malformed / short row
    const row = {};
    LEDGER_KEYS.forEach((k, i) => {
      row[k] = cells[i] ?? '';
    });
    rows.push(row);
  }
  return { rows };
}

/** Verdict distribution over parsed rows. Unknown verdicts fall into `other`. */
function verdictStats(rows) {
  const stats = { ACCEPT: 0, REJECT: 0, INCONCLUSIVE: 0, other: 0 };
  for (const r of rows) {
    const v = (r.verdict || '').toUpperCase();
    if (VERDICTS.includes(v)) stats[v] += 1;
    else stats.other += 1;
  }
  return stats;
}

/** The last `n` rows (most-recent last in the file → returned newest first). */
function latestNights(rows, n = 5) {
  const take = Math.max(0, n);
  return rows.slice(-take).reverse();
}

/**
 * Resolve a repo-relative ledgerPath to an absolute path, rejecting anything that
 * escapes the repo directory (absolute paths, `..` traversal). Estate configs are
 * trusted, but this is cheap defence in depth.
 */
function resolveLedgerPath(repoDir, ledgerPath) {
  const rel = ledgerPath || 'docs/dream-cycle/LEDGER.md';
  const resolved = path.resolve(repoDir, rel);
  const back = path.relative(repoDir, resolved);
  if (back === '' || back.startsWith('..') || path.isAbsolute(back)) {
    throw new Error(`ledgerPath escapes repo directory: ${ledgerPath}`);
  }
  return resolved;
}

/**
 * Discover nominated repos: a single-level scan of `workspaceRoot` for
 * subdirectories carrying a `dream.config.json` marker (the same discovery the
 * engine uses). Returns entries with the parsed repo name and ledger path;
 * malformed configs are skipped, not fatal.
 */
function discoverNominatedRepos(workspaceRoot) {
  let entries;
  try {
    entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const repos = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(workspaceRoot, ent.name);
    const configPath = path.join(dir, 'dream.config.json');
    let raw;
    try {
      raw = fs.readFileSync(configPath, 'utf8');
    } catch {
      continue; // no marker → not nominated
    }
    let cfg;
    try {
      cfg = JSON.parse(raw);
    } catch {
      repos.push({ dir, name: ent.name, repo: ent.name, ledgerPath: null, error: 'invalid dream.config.json' });
      continue;
    }
    repos.push({
      dir,
      name: ent.name,
      repo: typeof cfg.repo === 'string' ? cfg.repo : ent.name,
      ledgerPath: typeof cfg.ledgerPath === 'string' ? cfg.ledgerPath : 'docs/dream-cycle/LEDGER.md',
    });
  }
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read + summarise one nominated repo's ledger. Never throws on missing files. */
function readRepoDreamStatus(entry, { limit = 5 } = {}) {
  const base = { repo: entry.repo, dir: entry.name, ledgerExists: false, rowCount: 0, stats: verdictStats([]), latest: [], lastNight: null };
  if (entry.error) return { ...base, error: entry.error };
  let ledgerAbs;
  try {
    ledgerAbs = resolveLedgerPath(entry.dir, entry.ledgerPath);
  } catch (e) {
    return { ...base, error: e.message };
  }
  let md;
  try {
    // Lexical checks above stop `..`/absolute paths, but a symlink at (or along)
    // the ledger path can still point outside the repo, and readFileSync follows
    // it. Re-assert containment on the *real* paths, and cap the read so a runaway
    // file cannot stall the event loop.
    const realRepo = fs.realpathSync(entry.dir);
    const realLedger = fs.realpathSync(ledgerAbs); // throws ENOENT if not written yet
    const back = path.relative(realRepo, realLedger);
    if (back === '' || back.startsWith('..') || path.isAbsolute(back)) {
      return { ...base, error: 'ledger path escapes repo directory (symlink)' };
    }
    const MAX_LEDGER_BYTES = 5 * 1024 * 1024; // real ledgers are a few KB
    if (fs.statSync(realLedger).size > MAX_LEDGER_BYTES) {
      return { ...base, error: 'ledger too large' };
    }
    md = fs.readFileSync(realLedger, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return base; // ledger not written yet — an honest empty
    return { ...base, error: 'ledger unreadable' };
  }
  const { rows } = parseLedger(md);
  return {
    repo: entry.repo,
    dir: entry.name,
    ledgerExists: true,
    rowCount: rows.length,
    stats: verdictStats(rows),
    latest: latestNights(rows, limit),
    lastNight: rows.length ? rows[rows.length - 1].date : null,
  };
}

/**
 * Aggregate dream status across every nominated repo under `workspaceRoot`.
 * Returns a well-formed payload even when nothing is nominated (empty repos).
 */
function aggregateDreamStatus(workspaceRoot, { limit = 5 } = {}) {
  const nominated = discoverNominatedRepos(workspaceRoot);
  const repos = nominated.map((e) => readRepoDreamStatus(e, { limit }));
  const totals = repos.reduce(
    (acc, r) => {
      acc.ACCEPT += r.stats.ACCEPT;
      acc.REJECT += r.stats.REJECT;
      acc.INCONCLUSIVE += r.stats.INCONCLUSIVE;
      acc.other += r.stats.other;
      acc.rows += r.rowCount;
      return acc;
    },
    { ACCEPT: 0, REJECT: 0, INCONCLUSIVE: 0, other: 0, rows: 0 },
  );
  return { repoCount: repos.length, totals, repos };
}

module.exports = {
  LEDGER_KEYS,
  parseLedger,
  verdictStats,
  latestNights,
  resolveLedgerPath,
  discoverNominatedRepos,
  readRepoDreamStatus,
  aggregateDreamStatus,
};
