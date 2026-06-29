'use strict';

/**
 * lib/project-tracker — Sovereign Project Tracking domain service.
 *
 * Brings helm-grade project tracking (status grid, 30-day commit activity,
 * AI primers/synopses, GitHub + local repo sync) into agentbox, re-expressed
 * natively on the three existing sovereign substrates rather than helm's
 * Fastify/React stack:
 *
 *   1. Canonical URN grammar (ADR-013) — every tracked repo is a first-class
 *      `urn:agentbox:thing:<scope>:project-<sha>` minted through lib/uris,
 *      its commit window a `urn:agentbox:dataset:…`, each scan a PROV-O
 *      `urn:agentbox:activity:…` receipt. No ad-hoc template-literal URNs.
 *   2. Port-bound Prometheus telemetry (ADR-005) — every scan fans its
 *      findings out through the injected observability/project-metrics module
 *      so they surface on the existing port-bound /metrics endpoints.
 *   3. Custom-kind nostr mesh (ADR-009/029/030) — the durable bridge `track`
 *      subcommand signs kind-30841 digests; this service produces the digest
 *      payload (name, synopsis, language, last commit, commits30d, issues,
 *      stars, primer status, project URN) that the publish hook ships.
 *
 * This module is read-mostly observability — NOT a new adapter slot. Durable
 * state routes through the EXISTING slots: primers/synopses through the memory
 * adapter (delegated to the injected PrimerGenerator), scan activity through
 * the events adapter. The tracker itself owns no backend; it walks git repos
 * with `child_process.execFile` (never a shell string — no command injection),
 * mints identity through lib/uris, and emits telemetry through the injected
 * metrics module. Every per-repo step fails open: one bad repo is logged and
 * the scan continues.
 *
 * @see ADR-035 — project-tracking telemetry and nostr kind (kind-30841)
 * @see PRD-017 — sovereign project tracking
 * @see DDD-015 — project-tracking domain
 * @see ADR-013 — canonical URI grammar (lib/uris)
 * @see ADR-005 — pluggable adapter architecture + observability
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const uris = require('./uris');

// JSON-LD vocabulary for agentbox-specific terms, matching the surface
// emitters (middleware/linked-data/surfaces/*). schema.org carries the
// SoftwareSourceCode / Project core; agbx: carries the tracking extensions.
const AGBX_CONTEXT = 'https://agentbox.dreamlab-ai.systems/ns/v1#';

// Default scan roots when the manifest does not pin them. `/projects` is the
// shared bind mount; the workspace project tree is the agent's own checkout.
const DEFAULT_SCAN_DIRS = Object.freeze(['/projects', '/home/devuser/workspace/project']);

// Container workspace boundary. A repo whose realpath stays inside one of
// these is `local`; one whose realpath escapes (a symlink into the host's
// /mnt/** github mount) is `github-mount`. Privacy: we never leak the host
// path — only the slug (basename) and this coarse source classification.
const CONTAINER_ROOTS = Object.freeze(['/home/devuser/workspace', '/projects']);

const COMMIT_WINDOW_DAYS = 30;

// Filtered environment for child git/gh processes — prevents leaking secrets
// (API keys, bridge keys) from the management-api process into subprocesses,
// and disables any interactive credential prompt that could hang a scan.
const SAFE_ENV = Object.freeze({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '/bin/true',
  GIT_CONFIG_NOSYSTEM: '1',
});

// Extension → language heuristic. Highest tracked-file count wins.
const LANGUAGE_BY_EXT = Object.freeze({
  '.rs': 'Rust',
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.nix': 'Nix',
  '.sh': 'Shell', '.bash': 'Shell', '.fish': 'Shell',
  '.rb': 'Ruby',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.c': 'C', '.h': 'C',
  '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++', '.hpp': 'C++',
  '.cs': 'C#',
  '.swift': 'Swift',
  '.php': 'PHP',
  '.scala': 'Scala',
  '.lua': 'Lua',
  '.ex': 'Elixir', '.exs': 'Elixir',
  '.toml': 'TOML',
  '.md': 'Markdown',
});

/**
 * First 12 hex chars of the SHA-256 of `input`. Mirrors the content-address
 * convention in lib/uris (`sha256-12-<12 hex>`); we use the bare 12-hex form
 * as the stable, deterministic local-id segment so the same remote/path always
 * yields the same project id across scans (idempotency) and so the commit
 * window dataset can reuse it (`commits-<projsha>-30d`).
 */
function _contentHash12(input) {
  return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex').slice(0, 12);
}

/**
 * Run a read-only git command synchronously in `repoPath`. Returns trimmed
 * stdout, or '' on any failure (empty repo, not a repo, git absent). Uses
 * execFileSync with an argv array — never a shell string — so repo paths and
 * remotes can never be interpreted as shell.
 */
function _git(args, repoPath) {
  try {
    return execFileSync('git', args, {
      cwd: repoPath,
      env: SAFE_ENV,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Tally tracked-file extensions into a dominant language label. Returns null
 * when the repo has no recognised source files.
 */
function _languageHeuristic(repoPath) {
  const listing = _git(['ls-files'], repoPath);
  if (!listing) return null;
  const counts = new Map();
  for (const file of listing.split('\n')) {
    const ext = path.extname(file).toLowerCase();
    const lang = LANGUAGE_BY_EXT[ext];
    if (!lang) continue;
    counts.set(lang, (counts.get(lang) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [lang, count] of counts.entries()) {
    if (count > bestCount) { best = lang; bestCount = count; }
  }
  return best;
}

/**
 * Build the 30-day commit window: a [{date,count}] array covering every day in
 * the last 30 (including today, including zero-commit days), ascending by date.
 */
function _commitWindow(repoPath) {
  const raw = _git(
    ['log', `--since=${COMMIT_WINDOW_DAYS} days ago`, '--format=%cd', '--date=short'],
    repoPath,
  );
  const tally = new Map();
  if (raw) {
    for (const day of raw.split('\n')) {
      const d = day.trim();
      if (d) tally.set(d, (tally.get(d) || 0) + 1);
    }
  }
  const days = [];
  const now = new Date();
  for (let i = COMMIT_WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    days.push({ date: iso, count: tally.get(iso) || 0 });
  }
  return days;
}

/**
 * Read git metadata for a repository using execFile (no shell).
 *
 * @param {string} repoPath — absolute path to a git working tree
 * @returns {{branch:string, lastCommitIso:string|null, lastCommitAgeSec:number,
 *   commits30d:number, commitDays:Array<{date:string,count:number}>,
 *   remote:string|null, language:string|null}}
 */
function gitMetadata(repoPath) {
  const branch = _git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath) || 'HEAD';

  const lastCommitIsoRaw = _git(['log', '-1', '--format=%cI'], repoPath);
  const lastCommitIso = lastCommitIsoRaw || null;
  let lastCommitAgeSec = 0;
  if (lastCommitIso) {
    const parsed = Date.parse(lastCommitIso);
    if (!Number.isNaN(parsed)) {
      lastCommitAgeSec = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
    }
  }

  const countRaw = _git(['rev-list', '--count', `--since=${COMMIT_WINDOW_DAYS} days ago`, 'HEAD'], repoPath);
  const commits30d = Number.parseInt(countRaw, 10) || 0;

  const commitDays = _commitWindow(repoPath);

  const remoteRaw = _git(['config', '--get', 'remote.origin.url'], repoPath);
  const remote = remoteRaw || null;

  const language = _languageHeuristic(repoPath);

  return { branch, lastCommitIso, lastCommitAgeSec, commits30d, commitDays, remote, language };
}

/**
 * Parse `owner/repo` from a github remote URL (https or scp-like ssh form).
 * Returns null for non-github or unparseable remotes.
 */
function _githubOwnerRepo(remote) {
  if (!remote || !/github\.com/i.test(remote)) return null;
  const m = remote.match(/github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

class ProjectTracker {
  /**
   * @param {object} opts
   * @param {object} [opts.logger]   — fastify/pino-style logger (info/warn/error/debug)
   * @param {object} [opts.manifest] — parsed agentbox.toml
   * @param {object} [opts.adapters] — adapter registry (events for scan activity)
   * @param {object} [opts.primer]   — PrimerGenerator (lib/project-primer)
   * @param {object} [opts.metrics]  — observability/project-metrics module
   */
  constructor({ logger, manifest, adapters, primer, metrics } = {}) {
    this.logger = logger || null;
    this.manifest = manifest || {};
    this.adapters = adapters || null;
    this.primer = primer || null;
    this.metrics = metrics || null;

    this._config = (this.manifest && this.manifest.project_tracking) || {};
    this._projects = new Map(); // id -> TrackedProject (idempotent on id)
    this._schedulerHandle = null;
  }

  _log(level, obj, msg) {
    try {
      if (this.logger && typeof this.logger[level] === 'function') {
        this.logger[level](obj, msg);
        return;
      }
    } catch { /* logger threw — fall through to console, never block a scan */ }
    const line = `[project-tracker] ${msg}`;
    if (level === 'error') console.error(line, obj);
    else if (level === 'warn') console.warn(line, obj);
  }

  /** Emit a metric through the injected module, fail-open if absent or throwing. */
  _metric(name, ...args) {
    try {
      if (this.metrics && typeof this.metrics[name] === 'function') {
        this.metrics[name](...args);
      }
    } catch (err) {
      this._log('warn', { metric: name, err: err.message }, 'metric emit failed (non-fatal)');
    }
  }

  _pubkey() {
    const pk = process.env.AGENTBOX_PUBKEY;
    return (pk && /^[0-9a-f]{64}$/.test(pk)) ? pk : null;
  }

  _ownerDid() {
    const pk = this._pubkey();
    return pk ? `did:nostr:${pk}` : null;
  }

  /**
   * Classify a repo as `local` or `github-mount` by whether its realpath stays
   * inside the container workspace. A symlink into the host /mnt/** github
   * mount escapes → github-mount.
   */
  _classifySource(repoPath) {
    let real = repoPath;
    try { real = fs.realpathSync(repoPath); } catch { /* use the literal path */ }
    const inside = CONTAINER_ROOTS.some(
      (root) => real === root || real.startsWith(root + path.sep),
    );
    return inside ? 'local' : 'github-mount';
  }

  /** Resolve scan roots: explicit dirs → manifest → defaults. */
  _scanDirs(dirs) {
    if (Array.isArray(dirs) && dirs.length) return dirs;
    if (Array.isArray(this._config.scan_dirs) && this._config.scan_dirs.length) {
      return this._config.scan_dirs;
    }
    return [...DEFAULT_SCAN_DIRS];
  }

  /** Enumerate one-level-deep entries under `scanDir` that contain a `.git`. */
  _discoverRepos(scanDir) {
    let entries;
    try {
      entries = fs.readdirSync(scanDir, { withFileTypes: true });
    } catch (err) {
      this._log('warn', { scanDir, err: err.message }, 'scan dir unreadable (skipping)');
      return [];
    }
    const repos = [];
    for (const entry of entries) {
      // Accept directories and symlinks-to-directories (host github mounts).
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const repoPath = path.join(scanDir, entry.name);
      try {
        if (fs.existsSync(path.join(repoPath, '.git'))) repos.push(repoPath);
      } catch { /* stat raced/denied — skip this entry, continue scan */ }
    }
    return repos;
  }

  /** GitHub enrichment via the `gh` CLI. Returns {openIssues,stars}; defaults 0. */
  _enrichFromGithub(remote) {
    const out = { openIssues: 0, stars: 0 };
    const ownerRepo = _githubOwnerRepo(remote);
    if (!ownerRepo) return out;
    try {
      const raw = execFileSync('gh', ['api', `repos/${ownerRepo.owner}/${ownerRepo.repo}`], {
        env: { ...SAFE_ENV, GITHUB_TOKEN: process.env.GITHUB_TOKEN },
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        timeout: 20_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const data = JSON.parse(raw);
      out.openIssues = Number.parseInt(data.open_issues_count, 10) || 0;
      out.stars = Number.parseInt(data.stargazers_count, 10) || 0;
    } catch (err) {
      this._log('warn', { remote, err: err.message }, 'github enrichment failed (non-fatal)');
    }
    return out;
  }

  /** Mint the content-addressed thing URN for a repo, fail-open to unscoped. */
  _mintProjectUrn(addressInput) {
    const sha = _contentHash12(addressInput);
    const pubkey = this._pubkey();
    const urn = uris.mint({ kind: 'thing', pubkey: pubkey || undefined, localId: `project-${sha}`, payload: { addr: addressInput } });
    return { urn, sha };
  }

  /** Mint the commit-window dataset URN. Requires a pubkey scope; null if absent. */
  _mintCommitWindowUrn(projSha) {
    const pubkey = this._pubkey();
    if (!pubkey) return null;
    try {
      return uris.mint({ kind: 'dataset', pubkey, localId: `commits-${projSha}-30d` });
    } catch (err) {
      this._log('warn', { projSha, err: err.message }, 'commit-window URN mint failed (non-fatal)');
      return null;
    }
  }

  /**
   * Walk the scan roots, read git metadata, mint URNs, emit telemetry, and
   * record a single PROV-O scan activity. Idempotent on project id.
   *
   * @param {object} [opts]
   * @param {string[]} [opts.dirs] — override scan roots
   * @param {boolean}  [opts.githubEnrichment] — force github enrichment on/off
   * @returns {Promise<{projects:Array, scanUrn:string|null, durationMs:number}>}
   */
  async scan({ dirs, githubEnrichment } = {}) {
    const startedAt = Date.now();
    const ownerDid = this._ownerDid();
    const enrich = (githubEnrichment === undefined)
      ? (this._config.github_enrichment === true)
      : Boolean(githubEnrichment);

    const scanDirs = this._scanDirs(dirs);
    const scanned = [];
    let outcome = 'success';

    try {
      const repoPaths = [];
      for (const scanDir of scanDirs) {
        for (const repoPath of this._discoverRepos(scanDir)) repoPaths.push(repoPath);
      }

      for (const repoPath of repoPaths) {
        // Fail-open per repo: a single bad repo is logged; the scan continues.
        try {
          const project = this._trackRepo(repoPath, { ownerDid, enrich });
          this._projects.set(project.id, project);
          scanned.push(project);
        } catch (err) {
          this._log('warn', { repoPath, err: err.message }, 'repo scan failed (skipping)');
        }
      }

      // Fleet-wide gauges + per-project telemetry already emitted in _trackRepo.
      this._metric('setTrackedTotal', this._projects.size);
    } catch (err) {
      outcome = 'error';
      this._log('error', { err: err.message }, 'scan failed');
    }

    const durationMs = Date.now() - startedAt;
    this._metric('observeScanDuration', durationMs / 1000);
    this._metric('recordScan', outcome);

    // Mint a single PROV-O activity receipt for the scan (content-addressed).
    let scanUrn = null;
    try {
      const pubkey = this._pubkey();
      scanUrn = uris.mint({
        kind: 'activity',
        pubkey: pubkey || undefined,
        payload: {
          type: 'projscan',
          dirs: scanDirs,
          count: scanned.length,
          outcome,
          finishedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      this._log('warn', { err: err.message }, 'scan activity URN mint failed (non-fatal)');
    }

    this._log('info', { count: scanned.length, durationMs, scanUrn }, 'project scan complete');
    return { projects: scanned, scanUrn, durationMs };
  }

  /** Build (or refresh) a single TrackedProject and emit its telemetry. */
  _trackRepo(repoPath, { ownerDid, enrich }) {
    const meta = gitMetadata(repoPath);
    const name = path.basename(repoPath);
    const source = this._classifySource(repoPath);

    // Content-address on the remote URL when present, else the absolute path.
    const addressInput = meta.remote || repoPath;
    const { urn, sha } = this._mintProjectUrn(addressInput);
    const parsed = uris.parse(urn);
    const id = parsed ? parsed.local : `project-${sha}`;
    const commitWindowUrn = this._mintCommitWindowUrn(sha);

    let openIssues = 0;
    let stars = 0;
    if (enrich && process.env.GITHUB_TOKEN && _githubOwnerRepo(meta.remote)) {
      const gh = this._enrichFromGithub(meta.remote);
      openIssues = gh.openIssues;
      stars = gh.stars;
    }

    // Carry the prior primer status across re-scans (scan does not regenerate).
    const prior = this._projects.get(id);
    const primerStatus = (prior && prior.primerStatus) || 'none';
    const primerUrn = (prior && prior.primerUrn) || null;

    const project = {
      id,
      urn,
      ownerDid,
      name,
      path: repoPath,
      source,
      remote: meta.remote,
      branch: meta.branch,
      language: meta.language,
      lastCommitIso: meta.lastCommitIso,
      lastCommitAgeSec: meta.lastCommitAgeSec,
      commits30d: meta.commits30d,
      commitDays: meta.commitDays,
      commitWindowUrn,
      openIssues,
      stars,
      primerStatus,
      primerUrn,
      scannedAt: new Date().toISOString(),
    };

    // Telemetry — privacy: the project label is the slug, never the host path.
    this._metric('setProjectInfo', {
      slug: name,
      language: project.language || 'unknown',
      source,
      ownerDid: ownerDid || '',
      urn,
    });
    this._metric('setProjectCommits30d', name, project.commits30d);
    this._metric('setProjectOpenIssues', name, openIssues);
    this._metric('setProjectStars', name, stars);
    this._metric('setProjectLastCommitAge', name, project.lastCommitAgeSec);
    this._metric('setProjectPrimerStatus', name, primerStatus);

    return project;
  }

  /** All tracked projects from the most recent and prior scans. */
  list() {
    return Array.from(this._projects.values());
  }

  /** A single tracked project by id (urn local part), or null. */
  get(id) {
    return this._projects.get(id) || null;
  }

  /**
   * 30-day commit activity for a tracked project.
   * @returns {{project:string, window:'30d', days:Array<{date,count}>}}
   */
  activity(id) {
    const project = this.get(id);
    if (!project) {
      const err = new Error(`unknown project: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    return { project: project.name, window: '30d', days: project.commitDays || [] };
  }

  /**
   * Generate (or regenerate) the AI primer/synopsis for a project. Delegates
   * to the injected PrimerGenerator, which owns the memory-adapter persistence
   * and memory-URN minting. Updates the project's primer status + telemetry.
   *
   * @returns {Promise<{primer:string|null, synopsis:string|null, urn:string|null}>}
   */
  async generatePrimer(id, { force } = {}) {
    const project = this.get(id);
    if (!project) {
      const err = new Error(`unknown project: ${id}`);
      err.statusCode = 404;
      throw err;
    }

    if (!this.primer || typeof this.primer.primer !== 'function') {
      project.primerStatus = 'none';
      project.primerUrn = null;
      this._metric('setProjectPrimerStatus', project.name, 'none');
      return { primer: null, synopsis: null, urn: null };
    }

    try {
      const result = await this.primer.primer({ ...project, force: Boolean(force) });
      const ready = Boolean(result && result.primer);
      project.primerStatus = ready ? 'ready' : 'none';
      project.primerUrn = (result && result.urn) || null;
      this._metric('setProjectPrimerStatus', project.name, project.primerStatus);
      return {
        primer: (result && result.primer) || null,
        synopsis: (result && result.synopsis) || null,
        urn: project.primerUrn,
      };
    } catch (err) {
      project.primerStatus = 'error';
      this._metric('setProjectPrimerStatus', project.name, 'error');
      this._log('warn', { id, err: err.message }, 'primer generation failed (non-fatal)');
      return { primer: null, synopsis: null, urn: null };
    }
  }

  /**
   * Render a tracked project as a JSON-LD SoftwareSourceCode/Project node.
   * `@id` is the canonical thing URN; agbx: terms carry the tracking extras.
   */
  toJsonLd(project) {
    const p = (typeof project === 'string') ? this.get(project) : project;
    if (!p) return null;
    const doc = {
      '@context': ['https://schema.org', { agbx: AGBX_CONTEXT }],
      '@id': p.urn,
      '@type': ['SoftwareSourceCode', 'Project'],
      name: p.name,
      'agbx:source': p.source,
      'agbx:branch': p.branch,
      'agbx:commits30d': p.commits30d,
      'agbx:openIssues': p.openIssues,
      'agbx:stars': p.stars,
      'agbx:primerStatus': p.primerStatus,
    };
    if (p.language) doc.programmingLanguage = p.language;
    if (p.remote) doc.codeRepository = p.remote;
    if (p.lastCommitIso) doc.dateModified = p.lastCommitIso;
    if (p.ownerDid) doc['agbx:owner'] = { '@id': p.ownerDid };
    if (p.commitWindowUrn) doc['agbx:commitWindow'] = { '@id': p.commitWindowUrn };
    if (p.primerUrn) doc['agbx:primer'] = { '@id': p.primerUrn };
    return doc;
  }

  /**
   * Start the periodic background scan. Interval comes from the manifest
   * (`project_tracking.scan_interval_hours`); 0 (or absent/non-positive)
   * disables scheduling. Idempotent: an existing handle is left in place.
   */
  startScheduler() {
    if (this._schedulerHandle) return this._schedulerHandle;
    const hours = Number(this._config.scan_interval_hours);
    if (!Number.isFinite(hours) || hours <= 0) {
      this._log('info', { hours: this._config.scan_interval_hours }, 'scheduler disabled');
      return null;
    }
    const intervalMs = hours * 60 * 60 * 1000;
    this._schedulerHandle = setInterval(() => {
      this.scan().catch((err) => {
        this._log('error', { err: err.message }, 'scheduled scan failed (non-fatal)');
      });
    }, intervalMs);
    // Do not keep the event loop alive solely for the scheduler.
    if (typeof this._schedulerHandle.unref === 'function') this._schedulerHandle.unref();
    this._log('info', { intervalHours: hours }, 'project scan scheduler started');
    return this._schedulerHandle;
  }

  /** Stop the periodic background scan. */
  stopScheduler() {
    if (this._schedulerHandle) {
      clearInterval(this._schedulerHandle);
      this._schedulerHandle = null;
      this._log('info', {}, 'project scan scheduler stopped');
    }
  }
}

module.exports = {
  ProjectTracker,
  gitMetadata,
  AGBX_CONTEXT,
  DEFAULT_SCAN_DIRS,
};
