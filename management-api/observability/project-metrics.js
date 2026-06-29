/**
 * Sovereign Project Tracking telemetry (ADR-035 §D2; ADR-005 Observability)
 *
 * Registers the agentbox_project_* metric families on the SHARED Prometheus
 * registry imported from ./metrics, so they appear on the existing port-bound
 * /metrics surface (9090 in-process + 9091 standalone, bound 0.0.0.0) without a
 * second registry or a second collectDefaultMetrics() call.
 *
 * Privacy (ADR-008): the `project` label is always a slug (basename), never an
 * absolute host path. `owner_did` is the public BIP-340 pubkey DID and is safe
 * to expose. Per-project series are removable via clearProject(slug) so a
 * dropped repo leaves no stale time-series.
 */

const promClient = require('prom-client');
const { register } = require('./metrics');

// Ordered set of primer statuses; setProjectPrimerStatus() asserts exactly one
// reads 1 for a given slug by zeroing the others.
const PRIMER_STATUSES = ['none', 'pending', 'ready', 'stale', 'error'];

// Slug -> last info label tuple. projectInfo carries five identifying labels and
// prom-client's Gauge.get() is async (v15), so clearProject() cannot enumerate
// the live series synchronously. We track the tuple at set time instead, which
// keeps clearProject() synchronous and reliable.
const projectInfoLabels = new Map();

// Gauge: count of tracked projects
const trackedTotal = new promClient.Gauge({
  name: 'agentbox_project_tracked_total',
  help: 'Total number of tracked projects',
  registers: [register]
});

// Gauge: per-project static info (always 1; carries descriptive labels)
const projectInfo = new promClient.Gauge({
  name: 'agentbox_project_info',
  help: 'Static project information (always 1)',
  labelNames: ['project', 'language', 'source', 'owner_did', 'urn'],
  registers: [register]
});

// Gauge: commits in the trailing 30-day window
const commits30d = new promClient.Gauge({
  name: 'agentbox_project_commits_30d',
  help: 'Commits in the trailing 30-day window per project',
  labelNames: ['project'],
  registers: [register]
});

// Gauge: open issues (GitHub enrichment)
const openIssues = new promClient.Gauge({
  name: 'agentbox_project_open_issues',
  help: 'Open issues per project (GitHub enrichment)',
  labelNames: ['project'],
  registers: [register]
});

// Gauge: stars (GitHub enrichment)
const stars = new promClient.Gauge({
  name: 'agentbox_project_stars',
  help: 'Stars per project (GitHub enrichment)',
  labelNames: ['project'],
  registers: [register]
});

// Gauge: age of the last commit in seconds
const lastCommitAgeSeconds = new promClient.Gauge({
  name: 'agentbox_project_last_commit_age_seconds',
  help: 'Age of the last commit in seconds per project',
  labelNames: ['project'],
  registers: [register]
});

// Gauge: primer status (1 for the active status, 0 for the others)
const primerStatus = new promClient.Gauge({
  name: 'agentbox_project_primer_status',
  help: 'AI primer status per project (1 for the active status label)',
  labelNames: ['project', 'status'],
  registers: [register]
});

// Histogram: scan duration (seconds)
const scanDurationSeconds = new promClient.Histogram({
  name: 'agentbox_project_scan_duration_seconds',
  help: 'Project scan duration in seconds',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register]
});

// Counter: scan outcomes
const scansTotal = new promClient.Counter({
  name: 'agentbox_project_scans_total',
  help: 'Total project scans by outcome',
  labelNames: ['outcome'],
  registers: [register]
});

// Counter: nostr kind-30841 publish outcomes
const nostrPublishTotal = new promClient.Counter({
  name: 'agentbox_project_nostr_publish_total',
  help: 'Total project-tracking nostr publishes by outcome',
  labelNames: ['outcome'],
  registers: [register]
});

/**
 * Set the count of tracked projects.
 */
function setTrackedTotal(n) {
  trackedTotal.set(Number(n) || 0);
}

/**
 * Set the static info gauge for a project (always 1).
 */
function setProjectInfo({ slug, language, source, ownerDid, urn }) {
  const tuple = [slug, language || 'unknown', source || 'unknown', ownerDid || 'unknown', urn || 'unknown'];
  // A prior scan may have recorded the slug with different descriptive labels
  // (e.g. a language change); drop the stale series before setting the new one.
  const prior = projectInfoLabels.get(slug);
  if (prior && (prior[1] !== tuple[1] || prior[2] !== tuple[2] || prior[3] !== tuple[3] || prior[4] !== tuple[4])) {
    projectInfo.remove(...prior);
  }
  projectInfoLabels.set(slug, tuple);
  projectInfo.labels(...tuple).set(1);
}

/**
 * Set the 30-day commit count for a project.
 */
function setProjectCommits30d(slug, n) {
  commits30d.labels(slug).set(Number(n) || 0);
}

/**
 * Set the open-issue count for a project.
 */
function setProjectOpenIssues(slug, n) {
  openIssues.labels(slug).set(Number(n) || 0);
}

/**
 * Set the star count for a project.
 */
function setProjectStars(slug, n) {
  stars.labels(slug).set(Number(n) || 0);
}

/**
 * Set the last-commit age (seconds) for a project.
 */
function setProjectLastCommitAge(slug, sec) {
  lastCommitAgeSeconds.labels(slug).set(Number(sec) || 0);
}

/**
 * Set the active primer status for a project. Zeroes the other status labels
 * for the same slug so only the active status reads 1.
 */
function setProjectPrimerStatus(slug, status) {
  for (const s of PRIMER_STATUSES) {
    primerStatus.labels(slug, s).set(s === status ? 1 : 0);
  }
}

/**
 * Observe a scan duration (seconds).
 */
function observeScanDuration(sec) {
  scanDurationSeconds.observe(Number(sec) || 0);
}

/**
 * Record a scan outcome (success|error).
 */
function recordScan(outcome) {
  scansTotal.labels(outcome).inc();
}

/**
 * Record a nostr publish outcome (success|error|skipped).
 */
function recordNostrPublish(outcome) {
  nostrPublishTotal.labels(outcome).inc();
}

/**
 * Remove a project slug from every labelled series so a dropped repo leaves no
 * stale time-series. trackedTotal is unlabelled and is corrected via
 * setTrackedTotal() by the caller after a scan.
 */
function clearProject(slug) {
  commits30d.remove(slug);
  openIssues.remove(slug);
  stars.remove(slug);
  lastCommitAgeSeconds.remove(slug);
  for (const s of PRIMER_STATUSES) {
    primerStatus.remove(slug, s);
  }
  // projectInfo carries five identifying labels; remove the series via the
  // tuple recorded at set time (Gauge.get() is async in prom-client v15 and so
  // cannot be enumerated here synchronously).
  const tuple = projectInfoLabels.get(slug);
  if (tuple) {
    projectInfo.remove(...tuple);
    projectInfoLabels.delete(slug);
  }
}

module.exports = {
  setTrackedTotal,
  setProjectInfo,
  setProjectCommits30d,
  setProjectOpenIssues,
  setProjectStars,
  setProjectLastCommitAge,
  setProjectPrimerStatus,
  observeScanDuration,
  recordScan,
  recordNostrPublish,
  clearProject,
  // Exposed for tests: gauge/counter/histogram handles
  _gauges: {
    trackedTotal,
    projectInfo,
    commits30d,
    openIssues,
    stars,
    lastCommitAgeSeconds,
    primerStatus,
    scanDurationSeconds,
    scansTotal,
    nostrPublishTotal,
    PRIMER_STATUSES
  }
};
