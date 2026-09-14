'use strict';

/**
 * dream-ledger — read-only aggregation of the dream engine's per-repo ledgers
 * for the cockpit `/dream` panel (ADR-055).
 *
 * The dream engine (services/dream-engine, ADR-052) appends a row to each
 * nominated repo's `docs/dream-cycle/LEDGER.md`. This module discovers the
 * nominated repos, parses their ledgers, and computes the small summaries the
 * panel renders. It never writes and never shells out — pure parsing plus
 * read-only fs, path-guarded against traversal.
 *
 * ── FR6.6 / EXP-AC-006: the human columns ────────────────────────────────────
 * The row was ten columns, every one of them about the AGENT's night: what it
 * found, what the evaluator said, what the effect was. Nothing measured the
 * human who reviewed the PR it opened. Augmentation conditions C4 (deepening
 * learning) and C6 (job purpose) are longitudinal — they need a human
 * measurement, repeated — so the schema gains two columns, `Reviewer` and
 * `Review-minutes`, populated from the PR merge event (`merged_by`, and
 * `merged_at − pr_opened_at`).
 *
 * TWO RULES GOVERN THEM.
 *
 *   1. LEGACY ROWS STILL PARSE. Every ledger in the estate is ten columns wide
 *      and those rows are the baseline any longitudinal reading is measured
 *      against. A ten-column row parses exactly as before, with both new fields
 *      `null`. The new columns are APPENDED so no existing cell changes key.
 *   2. ABSENCE RENDERS AS ABSENCE. An unmerged PR, an unparseable timestamp or
 *      an empty cell yields `null` — never `0` minutes and never an empty-string
 *      reviewer. A fabricated zero would read as "reviewed instantly", which is
 *      the same class of lie as a fabricated rationale (the PRD's opening NFR).
 */

const fs = require('fs');
const path = require('path');

/** The original 10-column order. Preserved as the compatibility floor. */
const LEGACY_LEDGER_KEYS = [
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

/** Canonical 12-column ledger order → stable object keys (FR6.6). */
const LEDGER_KEYS = [
  ...LEGACY_LEDGER_KEYS,
  'reviewer',        // merged_by: a GitHub login or a did:nostr
  'reviewMinutes',   // merged_at − pr_opened_at, whole minutes
];

/**
 * Cell values that MEAN "nothing was recorded". A ledger is written by hand and
 * by agents, so the empty cell arrives in several dialects; every one of them
 * must read back as null rather than as a reviewer called "NONE".
 */
const EMPTY_CELLS = new Set(['', '-', '--', '—', '–', 'none', 'n/a', 'na', 'null', 'nil']);

/** A cell's value, or null when it is any spelling of empty. */
function cellOrNull(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (EMPTY_CELLS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/** Whole non-negative minutes, or null. Never NaN, never a negative duration. */
function minutesOrNull(value) {
  const raw = cellOrNull(value);
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

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
    // The COMPATIBILITY FLOOR is the legacy width: a ten-column row is a valid
    // row and always will be. Anything narrower is malformed.
    if (cells.length < LEGACY_LEDGER_KEYS.length) continue;
    const row = {};
    LEGACY_LEDGER_KEYS.forEach((k, i) => {
      row[k] = cells[i] ?? '';
    });
    // The human columns, when the row is wide enough to carry them.
    row.reviewer = cells.length > 10 ? cellOrNull(cells[10]) : null;
    row.reviewMinutes = cells.length > 11 ? minutesOrNull(cells[11]) : null;
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
 * Derive the two human columns from a PR merge event.
 *
 * Nothing here guesses. An unmerged PR has no reviewer and no duration; a merge
 * event missing either timestamp yields a null duration even though the
 * reviewer is known; a `merged_at` before `pr_opened_at` (a clock skew, or a
 * back-dated import) is refused rather than recorded as a negative review.
 *
 * @param {object} event
 * @param {string|{login?: string, did?: string}} [event.merged_by]
 * @param {string|number|Date} [event.merged_at]
 * @param {string|number|Date} [event.pr_opened_at]
 * @returns {{reviewer: string|null, reviewMinutes: number|null}}
 */
function reviewFromMergeEvent(event) {
  const e = (event && typeof event === 'object') ? event : {};

  let reviewer = null;
  const by = e.merged_by;
  if (typeof by === 'string') reviewer = cellOrNull(by);
  else if (by && typeof by === 'object') reviewer = cellOrNull(by.did || by.login || by.name || '');

  const opened = Date.parse(e.pr_opened_at ?? '');
  const merged = Date.parse(e.merged_at ?? '');
  let reviewMinutes = null;
  if (Number.isFinite(opened) && Number.isFinite(merged) && merged >= opened) {
    reviewMinutes = Math.round((merged - opened) / 60000);
  }
  return { reviewer, reviewMinutes };
}

/** Median of a numeric array (mean of the middle two when even). */
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The human side of the ledger: who reviewed, how many nights, how long they
 * took. This is the C4/C6 measurement — a BASELINE on first reading, since a
 * longitudinal condition needs a second measurement before it means anything
 * (DDD §6 invariant 9).
 *
 * `unreviewed` is reported alongside, so the denominator is never hidden: a
 * high median over two measured nights out of ninety is not a reviewer metric.
 *
 * @param {Array<object>} rows - parsed ledger rows
 * @returns {{reviewers: Record<string, {reviews: number, medianReviewMinutes: number|null,
 *            measuredMinutes: number}>, reviewed: number, unreviewed: number}}
 */
function reviewerStats(rows) {
  const out = { reviewers: {}, reviewed: 0, unreviewed: 0 };
  if (!Array.isArray(rows)) return out;
  const minutesBy = new Map();
  for (const r of rows) {
    const reviewer = r && r.reviewer ? r.reviewer : null;
    if (!reviewer) { out.unreviewed += 1; continue; }
    out.reviewed += 1;
    if (!out.reviewers[reviewer]) {
      out.reviewers[reviewer] = { reviews: 0, medianReviewMinutes: null, measuredMinutes: 0 };
      minutesBy.set(reviewer, []);
    }
    out.reviewers[reviewer].reviews += 1;
    if (Number.isFinite(r.reviewMinutes)) {
      out.reviewers[reviewer].measuredMinutes += 1;
      minutesBy.get(reviewer).push(r.reviewMinutes);
    }
  }
  for (const [reviewer, values] of minutesBy) {
    out.reviewers[reviewer].medianReviewMinutes = median(values);
  }
  return out;
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

/** PR number from a ledger PR cell (`#8` / `8` / `PR #8`) → `"8"`, else null. */
function prNumberOf(pr) {
  const m = /#?(\d+)/.exec(pr || '');
  return m ? m[1] : null;
}

/**
 * PR numbers whose latest recorded fate is MERGED. Mirrors the engine's
 * `parsePriorFates` exactly: parse every `#N:FATE` token across all rows,
 * last-token-wins per PR, then keep those whose final fate is MERGED (so a
 * `#8:MERGED … #8:CLOSED` sequence is *not* treated as merged).
 */
function mergedFromFates(rows) {
  const fate = new Map();
  const re = /#(\d+)\s*:\s*(MERGED|CLOSED|OPEN|STALE)\b/gi;
  for (const r of rows) {
    let m;
    while ((m = re.exec(r.priorFates || '')) !== null) fate.set(m[1], m[2].toUpperCase());
  }
  const merged = new Set();
  for (const [pr, f] of fate) if (f === 'MERGED') merged.add(pr);
  return merged;
}

/**
 * PR numbers whose latest recorded fate is terminal — MERGED or CLOSED. A
 * candidate can be resolved without merging (consolidated into another PR,
 * superseded, rejected by the human gate); either way it has left the queue.
 * Same last-token-wins parse as `mergedFromFates`.
 */
function resolvedFromFates(rows) {
  const fate = new Map();
  const re = /#(\d+)\s*:\s*(MERGED|CLOSED|OPEN|STALE)\b/gi;
  for (const r of rows) {
    let m;
    while ((m = re.exec(r.priorFates || '')) !== null) fate.set(m[1], m[2].toUpperCase());
  }
  const resolved = new Set();
  for (const [pr, f] of fate) if (f === 'MERGED' || f === 'CLOSED') resolved.add(pr);
  return resolved;
}

/**
 * The judgment-broker queue (ADR-056): rows awaiting a human decision — verdict
 * ACCEPT, a real PR, and no terminal `#N:MERGED` / `#N:CLOSED` fate recorded by
 * any row's fate tokens (CLOSED counts: a consolidated-elsewhere candidate is
 * decided, not awaiting review). Deduped by PR (latest row's context wins).
 * `repo` is the slug for the GitHub link the panel builds. Pure signal over
 * the ledger — no network, no merge.
 */
function pendingMerges(rows, repo) {
  const merged = resolvedFromFates(rows);
  const byPr = new Map();
  for (const r of rows) {
    if ((r.verdict || '').toUpperCase() !== 'ACCEPT') continue;
    const n = prNumberOf(r.pr);
    if (!n || merged.has(n)) continue;
    byPr.set(n, { repo, prNumber: n, date: r.date, deep: r.deep, finding: r.finding });
  }
  return [...byPr.values()];
}

/** Read + summarise one nominated repo's ledger. Never throws on missing files. */
function readRepoDreamStatus(entry, { limit = 5 } = {}) {
  const base = { repo: entry.repo, dir: entry.name, ledgerExists: false, rowCount: 0, stats: verdictStats([]), latest: [], lastNight: null, pending: [], pendingCount: 0, reviewers: reviewerStats([]) };
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
  const pending = pendingMerges(rows, entry.repo);
  return {
    repo: entry.repo,
    dir: entry.name,
    ledgerExists: true,
    rowCount: rows.length,
    stats: verdictStats(rows),
    latest: latestNights(rows, limit),
    lastNight: rows.length ? rows[rows.length - 1].date : null,
    pending,
    pendingCount: pending.length,
    // FR6.6 — the human measurement, alongside the agent's.
    reviewers: reviewerStats(rows),
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
      acc.pending += r.pendingCount || 0;
      return acc;
    },
    { ACCEPT: 0, REJECT: 0, INCONCLUSIVE: 0, other: 0, rows: 0, pending: 0 },
  );
  return { repoCount: repos.length, totals, repos };
}

module.exports = {
  LEDGER_KEYS,
  LEGACY_LEDGER_KEYS,
  parseLedger,
  reviewFromMergeEvent,
  reviewerStats,
  verdictStats,
  latestNights,
  mergedFromFates,
  resolvedFromFates,
  pendingMerges,
  resolveLedgerPath,
  discoverNominatedRepos,
  readRepoDreamStatus,
  aggregateDreamStatus,
};
