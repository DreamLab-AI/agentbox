'use strict';

/**
 * Contract test for observability/project-metrics — the agentbox_project_*
 * telemetry families that the Sovereign Project Tracking feature exports
 * (ADR-035 §D2; SPEC §Telemetry). Guards the invariants the /metrics surface
 * and the Grafana dashboards depend on:
 *
 *   - the module registers on the SHARED registry imported from ./metrics, so
 *     the series appear on the existing port-bound /metrics (9090 + 9091);
 *   - setProjectInfo() emits exactly the five-label info series (cardinality);
 *   - setProjectPrimerStatus() keeps exactly one status label at 1, the rest 0;
 *   - clearProject() removes every per-slug series so a dropped repo leaves no
 *     stale time-series;
 *   - recordScan()/recordNostrPublish() increment their outcome counters.
 *
 * Jest isolates the module registry per test file, so the shared Prometheus
 * registry required here is private to this file. register.resetMetrics()
 * zeroes values between tests; clearProject() is exercised explicitly because
 * it removes label series (which resetMetrics does not).
 */

const { register } = require('../../management-api/observability/metrics');
const metrics = require('../../management-api/observability/project-metrics');

// prom-client v15 returns a Promise from register.metrics(); awaiting a string
// is a no-op, so this is correct regardless of version.
const dump = () => register.metrics();

describe('observability/project-metrics', () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  test('registers agentbox_project_* families on the shared registry', async () => {
    metrics.setTrackedTotal(3);
    const text = await dump();
    expect(text).toContain('agentbox_project_tracked_total');
    expect(text).toContain('agentbox_project_tracked_total 3');
  });

  test('setTrackedTotal coerces non-numeric input to 0', async () => {
    metrics.setTrackedTotal('not-a-number');
    const text = await dump();
    expect(text).toContain('agentbox_project_tracked_total 0');
  });

  test('setProjectInfo emits the labelled info series at 1', async () => {
    metrics.setProjectInfo({
      slug: 'agentbox',
      language: 'JavaScript',
      source: 'local',
      ownerDid: 'did:nostr:' + 'a'.repeat(64),
      urn: 'urn:agentbox:thing:' + 'a'.repeat(64) + ':project-0123456789ab'
    });
    const text = await dump();
    expect(text).toContain('agentbox_project_info{');
    expect(text).toContain('project="agentbox"');
    expect(text).toContain('language="JavaScript"');
    expect(text).toContain('source="local"');
    expect(text).toContain('owner_did="did:nostr:' + 'a'.repeat(64) + '"');
    expect(text).toMatch(/agentbox_project_info\{[^}]*\}\s1\b/);
  });

  test('setProjectInfo carries exactly the five canonical labels (cardinality)', async () => {
    metrics.setProjectInfo({ slug: 'demo', language: 'Rust', source: 'github-mount', ownerDid: 'did:nostr:x', urn: 'urn:x' });
    const { values } = await metrics._gauges.projectInfo.get();
    const series = values.find((v) => v.labels.project === 'demo');
    expect(series).toBeDefined();
    expect(Object.keys(series.labels).sort()).toEqual(
      ['language', 'owner_did', 'project', 'source', 'urn']
    );
  });

  test('setProjectInfo defaults missing optional labels rather than emitting empty cardinality', async () => {
    metrics.setProjectInfo({ slug: 'bare' });
    const { values } = await metrics._gauges.projectInfo.get();
    const series = values.find((v) => v.labels.project === 'bare');
    expect(series.labels.language).toBe('unknown');
    expect(series.labels.source).toBe('unknown');
    expect(series.labels.owner_did).toBe('unknown');
    expect(series.labels.urn).toBe('unknown');
  });

  test('setProjectPrimerStatus(slug,"ready") leaves only status="ready" at 1, others at 0', async () => {
    metrics.setProjectPrimerStatus('agentbox', 'ready');
    const text = await dump();
    expect(text).toContain('agentbox_project_primer_status{project="agentbox",status="ready"} 1');
    expect(text).toContain('agentbox_project_primer_status{project="agentbox",status="none"} 0');
    expect(text).toContain('agentbox_project_primer_status{project="agentbox",status="pending"} 0');
    expect(text).toContain('agentbox_project_primer_status{project="agentbox",status="stale"} 0');
    expect(text).toContain('agentbox_project_primer_status{project="agentbox",status="error"} 0');
    // No status label other than "ready" reads 1 for this slug.
    const ps = await metrics._gauges.primerStatus.get();
    const ones = ps.values
      .filter((v) => v.labels.project === 'agentbox' && v.value === 1)
      .map((v) => v.labels.status);
    expect(ones).toEqual(['ready']);
  });

  test('setProjectPrimerStatus enumerates exactly the known statuses (cardinality)', async () => {
    metrics.setProjectPrimerStatus('agentbox', 'pending');
    const ps = await metrics._gauges.primerStatus.get();
    const statuses = ps.values
      .filter((v) => v.labels.project === 'agentbox')
      .map((v) => v.labels.status)
      .sort();
    expect(statuses).toEqual([...metrics._gauges.PRIMER_STATUSES].sort());
    expect(statuses).toHaveLength(metrics._gauges.PRIMER_STATUSES.length);
  });

  test('per-project gauges record their values under the slug label', async () => {
    metrics.setProjectCommits30d('agentbox', 42);
    metrics.setProjectOpenIssues('agentbox', 7);
    metrics.setProjectStars('agentbox', 99);
    metrics.setProjectLastCommitAge('agentbox', 3600);
    const text = await dump();
    expect(text).toContain('agentbox_project_commits_30d{project="agentbox"} 42');
    expect(text).toContain('agentbox_project_open_issues{project="agentbox"} 7');
    expect(text).toContain('agentbox_project_stars{project="agentbox"} 99');
    expect(text).toContain('agentbox_project_last_commit_age_seconds{project="agentbox"} 3600');
  });

  test('clearProject(slug) removes every per-slug series', async () => {
    metrics.setProjectInfo({ slug: 'doomed', language: 'Go', source: 'local', ownerDid: 'did:nostr:y', urn: 'urn:y' });
    metrics.setProjectCommits30d('doomed', 5);
    metrics.setProjectOpenIssues('doomed', 1);
    metrics.setProjectStars('doomed', 2);
    metrics.setProjectLastCommitAge('doomed', 60);
    metrics.setProjectPrimerStatus('doomed', 'ready');

    // Survivor slug to prove clearProject is scoped to the target only.
    metrics.setProjectCommits30d('keeper', 3);

    let text = await dump();
    expect(text).toContain('project="doomed"');

    metrics.clearProject('doomed');

    text = await dump();
    expect(text).not.toContain('project="doomed"');
    // The unrelated slug is untouched.
    expect(text).toContain('agentbox_project_commits_30d{project="keeper"} 3');

    // Backing collectors hold no residual series for the cleared slug.
    const [info, commits, primers] = await Promise.all([
      metrics._gauges.projectInfo.get(),
      metrics._gauges.commits30d.get(),
      metrics._gauges.primerStatus.get()
    ]);
    expect(info.values.some((v) => v.labels.project === 'doomed')).toBe(false);
    expect(commits.values.some((v) => v.labels.project === 'doomed')).toBe(false);
    expect(primers.values.some((v) => v.labels.project === 'doomed')).toBe(false);
  });

  test('recordScan increments the outcome counter', async () => {
    metrics.recordScan('success');
    metrics.recordScan('success');
    metrics.recordScan('error');
    const text = await dump();
    expect(text).toContain('agentbox_project_scans_total{outcome="success"} 2');
    expect(text).toContain('agentbox_project_scans_total{outcome="error"} 1');
  });

  test('recordNostrPublish increments the outcome counter (success|error|skipped)', async () => {
    metrics.recordNostrPublish('success');
    metrics.recordNostrPublish('skipped');
    metrics.recordNostrPublish('skipped');
    metrics.recordNostrPublish('error');
    const text = await dump();
    expect(text).toContain('agentbox_project_nostr_publish_total{outcome="success"} 1');
    expect(text).toContain('agentbox_project_nostr_publish_total{outcome="skipped"} 2');
    expect(text).toContain('agentbox_project_nostr_publish_total{outcome="error"} 1');
  });

  test('observeScanDuration populates the histogram on the shared registry', async () => {
    metrics.observeScanDuration(0.3);
    metrics.observeScanDuration(2.0);
    const text = await dump();
    expect(text).toContain('agentbox_project_scan_duration_seconds_bucket');
    expect(text).toContain('agentbox_project_scan_duration_seconds_count 2');
  });
});
