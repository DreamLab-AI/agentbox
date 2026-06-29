'use strict';

/**
 * Sovereign Project Tracking (PRD-017 / ADR-035 / DDD-015) — tracker domain.
 *
 * Proves lib/project-tracker:
 *   - gitMetadata reads a real on-disk git repo (branch, last-commit ISO,
 *     30-day commit window with a 30-entry day series, parsed remote) without
 *     a shell, using child_process execFile under the hood.
 *   - ProjectTracker.scan walks scan dirs, treats each dir containing `.git`
 *     as a TrackedProject, and mints its `id`/`urn` ONLY through lib/uris.js as
 *     an owner-scoped `thing` URN (urn:agentbox:thing:<64hex>:project-…) when
 *     AGENTBOX_PUBKEY is a 64-char x-only hex pubkey — never an ad-hoc literal.
 *   - scan emits the ADR-035 telemetry via the injected metrics module (the
 *     shared-registry project-metrics surface) — captured here by a fake.
 *   - scan is idempotent: the same repo yields the same content-addressed id on
 *     re-scan (content-addressed on remote URL / absolute path).
 *   - scan is fail-open per repo: a non-git directory is skipped, and a git repo
 *     with zero commits is tolerated rather than throwing.
 *
 * The primer + adapters are stubbed: this domain test isolates the tracker's
 * git+URN+metrics behaviour from RuVector memory, the agent-event publisher, and
 * the ZAI primer egress (all exercised in their own suites).
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ProjectTracker, gitMetadata } = require('../../management-api/lib/project-tracker');
const uris = require('../../management-api/lib/uris');

const PUBKEY = 'a'.repeat(64);

// --- temp-dir + git helpers -------------------------------------------------

const TEMP_ROOTS = [];

function mkTempRoot(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `agentbox-projtrack-${label}-`));
  TEMP_ROOTS.push(dir);
  return dir;
}

// Deterministic, host-independent git identity so commits never depend on the
// operator's global ~/.gitconfig (which may be absent in CI).
const GIT_ENV = Object.freeze({
  ...process.env,
  GIT_AUTHOR_NAME: 'Agentbox Test',
  GIT_AUTHOR_EMAIL: 'test@agentbox.invalid',
  GIT_COMMITTER_NAME: 'Agentbox Test',
  GIT_COMMITTER_EMAIL: 'test@agentbox.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

function git(cwd, args) {
  return execFileSync('git', args, { cwd, env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();
}

function initRepo(parent, name, { commits = 0, remote = null } = {}) {
  const repo = path.join(parent, name);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  if (remote) git(repo, ['remote', 'add', 'origin', remote]);
  for (let i = 0; i < commits; i += 1) {
    fs.writeFileSync(path.join(repo, `file-${i}.txt`), `content ${i}\n`);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', `commit ${i}`]);
  }
  return repo;
}

// --- fakes ------------------------------------------------------------------

// Mirrors observability/project-metrics.js export surface; every call is
// captured so the suite can assert the tracker drives the ADR-035 series.
function makeMetrics() {
  const calls = [];
  const rec = (name) => (...args) => { calls.push({ name, args }); };
  return {
    calls,
    setTrackedTotal: rec('setTrackedTotal'),
    setProjectInfo: rec('setProjectInfo'),
    setProjectCommits30d: rec('setProjectCommits30d'),
    setProjectOpenIssues: rec('setProjectOpenIssues'),
    setProjectStars: rec('setProjectStars'),
    setProjectLastCommitAge: rec('setProjectLastCommitAge'),
    setProjectPrimerStatus: rec('setProjectPrimerStatus'),
    observeScanDuration: rec('observeScanDuration'),
    recordScan: rec('recordScan'),
    recordNostrPublish: rec('recordNostrPublish'),
    clearProject: rec('clearProject'),
  };
}

// A primer that reports itself unconfigured: in standalone the tracker must
// still scan, mint, and emit, recording primer status 'none'.
function makePrimer() {
  return {
    configured: () => false,
    primer: async () => ({ primer: null, synopsis: null, model: null, urn: null }),
  };
}

// Permissive adapter doubles: any property is an async no-op that records the
// call, so the tracker's durable-state dispatch (events/memory slots) neither
// throws nor needs a live backend in this domain test.
function makeAdapters() {
  const calls = [];
  const slot = () =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') return undefined; // not a thenable
          return async (...args) => { calls.push({ prop: String(prop), args }); return { ok: true }; };
        },
      },
    );
  return { calls, memory: slot(), events: slot(), beads: slot(), pods: slot() };
}

const LOGGER = { info() {}, warn() {}, error() {}, debug() {}, child() { return LOGGER; } };

function makeTracker(scanDirs, overrides = {}) {
  return new ProjectTracker({
    logger: LOGGER,
    manifest: {
      project_tracking: {
        enabled: true,
        scan_dirs: scanDirs,
        github_enrichment: false,
        metrics: true,
        nostr_publish: false,
        primer_on_scan: false,
      },
    },
    adapters: makeAdapters(),
    primer: makePrimer(),
    metrics: makeMetrics(),
    ...overrides,
  });
}

// --- env guard --------------------------------------------------------------

let PREV_PUBKEY;
beforeAll(() => {
  PREV_PUBKEY = process.env.AGENTBOX_PUBKEY;
  process.env.AGENTBOX_PUBKEY = PUBKEY;
});

afterAll(() => {
  if (PREV_PUBKEY === undefined) delete process.env.AGENTBOX_PUBKEY;
  else process.env.AGENTBOX_PUBKEY = PREV_PUBKEY;
  for (const dir of TEMP_ROOTS) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
});

// ---------------------------------------------------------------------------

describe('gitMetadata — reads a real git repo without a shell', () => {
  let repo;
  beforeAll(() => {
    const root = mkTempRoot('gitmeta');
    repo = initRepo(root, 'repo', { commits: 2, remote: 'https://github.com/example/widget.git' });
  });

  it('reports the current branch', () => {
    expect(gitMetadata(repo).branch).toBe('main');
  });

  it('reports a non-empty ISO last-commit timestamp', () => {
    const { lastCommitIso } = gitMetadata(repo);
    expect(typeof lastCommitIso).toBe('string');
    expect(lastCommitIso.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(lastCommitIso))).toBe(false);
  });

  it('counts at least the two commits made in the last 30 days', () => {
    expect(gitMetadata(repo).commits30d).toBeGreaterThanOrEqual(2);
  });

  it('returns a dense 30-entry day series with {date,count} buckets', () => {
    const { commitDays } = gitMetadata(repo);
    expect(Array.isArray(commitDays)).toBe(true);
    expect(commitDays).toHaveLength(30);
    for (const d of commitDays) {
      expect(d).toHaveProperty('date');
      expect(d).toHaveProperty('count');
      expect(typeof d.count).toBe('number');
    }
    const total = commitDays.reduce((s, d) => s + d.count, 0);
    expect(total).toBeGreaterThanOrEqual(2);
  });

  it('parses the configured origin remote', () => {
    expect(gitMetadata(repo).remote).toContain('example/widget');
  });

  it('a non-positive last-commit age in seconds is impossible (recent commit)', () => {
    expect(gitMetadata(repo).lastCommitAgeSec).toBeGreaterThanOrEqual(0);
  });
});

describe('ProjectTracker.scan — URN minting via uris.js', () => {
  let root;
  beforeAll(() => {
    root = mkTempRoot('scan-urn');
    initRepo(root, 'alpha', { commits: 2, remote: 'https://github.com/example/alpha.git' });
  });

  it('mints an owner-scoped thing URN matching the ADR-035 project shape', async () => {
    const tracker = makeTracker([root]);
    const { projects, scanUrn, durationMs } = await tracker.scan({ dirs: [root], githubEnrichment: false });

    expect(projects).toHaveLength(1);
    const p = projects[0];

    expect(p.urn).toMatch(/^urn:agentbox:thing:[0-9a-f]{64}:project-/);
    // `id` is the clean slug (the URL :id param AND the kind-30841 d-tag);
    // `urn` is the full owner-scoped URN whose local part is that slug.
    expect(p.id).toMatch(/^project-[0-9a-f]{12}$/);
    expect(p.urn.endsWith(`:${p.id}`)).toBe(true);

    // The URN must be a genuine uris.js product, not a hand-rolled literal.
    expect(uris.isCanonical(p.urn)).toBe(true);
    const parsed = uris.parse(p.urn);
    expect(parsed.kind).toBe('thing');
    expect(parsed.pubkey).toBe(PUBKEY);
    expect(parsed.local.startsWith('project-')).toBe(true);

    expect(p.ownerDid).toBe(`did:nostr:${PUBKEY}`);
    expect(p.name).toBe('alpha');
    expect(p.source).toBe('local');

    // The scan activity receipt is itself a canonical URN.
    expect(uris.isCanonical(scanUrn)).toBe(true);
    expect(typeof durationMs).toBe('number');
  });
});

describe('ProjectTracker.scan — drives the ADR-035 telemetry series', () => {
  it('emits per-project gauges plus scan duration and outcome', async () => {
    const root = mkTempRoot('scan-metrics');
    initRepo(root, 'beta', { commits: 2 });

    const metrics = makeMetrics();
    const tracker = makeTracker([root], { metrics });
    await tracker.scan({ dirs: [root], githubEnrichment: false });

    const names = metrics.calls.map((c) => c.name);
    expect(names).toContain('setTrackedTotal');
    expect(names).toContain('setProjectInfo');
    expect(names).toContain('setProjectCommits30d');
    expect(names).toContain('setProjectLastCommitAge');
    expect(names).toContain('observeScanDuration');
    expect(names).toContain('recordScan');

    // The scan outcome is recorded as a success for a clean walk.
    const scanOutcomes = metrics.calls.filter((c) => c.name === 'recordScan').map((c) => c.args[0]);
    expect(scanOutcomes).toContain('success');

    // setProjectInfo carries the privacy-safe slug label and the minted URN.
    const info = metrics.calls.find((c) => c.name === 'setProjectInfo');
    const arg = info.args[0];
    expect(arg.slug).toBe('beta');
    expect(arg.urn).toMatch(/^urn:agentbox:thing:[0-9a-f]{64}:project-/);
    expect(arg.ownerDid).toBe(`did:nostr:${PUBKEY}`);
  });
});

describe('ProjectTracker.scan — idempotent on content-addressed id', () => {
  it('returns the same id and a coherent list/get on re-scan', async () => {
    const root = mkTempRoot('scan-idem');
    initRepo(root, 'gamma', { commits: 2, remote: 'https://github.com/example/gamma.git' });

    const tracker = makeTracker([root]);
    const first = await tracker.scan({ dirs: [root], githubEnrichment: false });
    const second = await tracker.scan({ dirs: [root], githubEnrichment: false });

    expect(second.projects).toHaveLength(1);
    expect(second.projects[0].id).toBe(first.projects[0].id);

    const id = first.projects[0].id;
    expect(tracker.list().map((p) => p.id)).toContain(id);
    expect(tracker.get(id).id).toBe(id);

    // activity() exposes the 30-day window for the tracked project.
    const act = tracker.activity(id);
    expect(act.window).toBe('30d');
    expect(act.days).toHaveLength(30);
  });
});

describe('ProjectTracker.scan — fail-open per repository', () => {
  it('skips non-git directories and tolerates a repo with zero commits', async () => {
    const root = mkTempRoot('scan-failopen');

    // A valid repo, a plain (non-git) directory, and an empty repo.
    initRepo(root, 'valid', { commits: 2 });
    fs.mkdirSync(path.join(root, 'plain-dir'), { recursive: true });
    fs.writeFileSync(path.join(root, 'plain-dir', 'note.txt'), 'not a repo\n');
    initRepo(root, 'empty', { commits: 0 });

    const metrics = makeMetrics();
    const tracker = makeTracker([root], { metrics });

    let result;
    await expect((async () => { result = await tracker.scan({ dirs: [root], githubEnrichment: false }); })())
      .resolves.toBeUndefined();

    // The non-git directory never becomes a TrackedProject.
    const names = result.projects.map((p) => p.name);
    expect(names).toContain('valid');
    expect(names).not.toContain('plain-dir');

    // The empty repo, if surfaced, carries a zero 30-day window and never throws.
    const empty = result.projects.find((p) => p.name === 'empty');
    if (empty) {
      expect(empty.commits30d).toBe(0);
      expect(empty.commitDays).toHaveLength(30);
    }

    // A clean fail-open walk still records a scan outcome.
    expect(metrics.calls.some((c) => c.name === 'recordScan')).toBe(true);
  });

  it('a missing scan directory does not throw', async () => {
    const tracker = makeTracker(['/nonexistent/agentbox/scan/root']);
    await expect(tracker.scan({ dirs: ['/nonexistent/agentbox/scan/root'], githubEnrichment: false }))
      .resolves.toMatchObject({ projects: [] });
  });
});
