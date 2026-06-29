# PRD-017: Sovereign Project Tracking

**Status:** Draft v1
**Date:** 2026-06-28
**Repo:** [github.com/DreamLab-AI/agentbox](https://github.com/DreamLab-AI/agentbox)
**Related:** PRD-001 (Capabilities and adapters), PRD-004 (External agent messaging), PRD-006 (Linked-data interfaces), PRD-008 (Code-as-Harness integration — URN-reuse precedent), ADR-005 (Pluggable adapter architecture), ADR-008 (Privacy filter routing), ADR-009 (Embedded Nostr relay), ADR-012 (JSON-LD 1.1 adoption), ADR-013 (Canonical URI grammar), ADR-015 (MCP RuVector mandate), ADR-029 (Nostr custom-kind allocation), ADR-030 (Sovereign-mesh mobile bridge), ADR-035 (Project-tracking telemetry and Nostr kind — this PRD's decision record), DDD-003 (Sovereign messaging domain), DDD-004 (Linked-data interchange domain), DDD-015 (Project-tracking domain)

## TL;DR for newcomers

*Skip if you already know why agentbox needs project tracking and why it must not import the helm stack.*

An agentbox container is a workspace host. It mounts `/projects` and `/home/devuser/workspace/project`, and over a normal working week those mounts accumulate a dozen-plus git repositories — host-project clones, vendored dependencies, the operator's own scratch work. Agentbox can run agents against any of them, but it has no idea what any of them *are*. There is no status grid, no "this repo last moved three weeks ago", no thirty-day commit chart, no one-paragraph primer an arriving agent can read before it starts. An operator who wants that picture today reads `git log` by hand, one repo at a time.

[helm](https://github.com/dgdev25/helm) solves exactly this picture for a developer's machine: it is a Fastify/React dashboard that aggregates GitHub repositories and local git checkouts, draws thirty-day commit-activity charts, generates AI primers and synopses through the Claude CLI, and maintains repository and crate libraries. It is the right capability model. It is the wrong substrate for agentbox. helm has no telemetry, no federation, no sovereign identity — it is a single-user web app, not a node in a mesh.

This PRD adopts helm's tracking model and rejects its stack. It re-expresses project tracking through the three substrates agentbox already owns: the canonical URN grammar (every tracked project becomes a first-class `urn:agentbox:thing:…`), the port-bound Prometheus telemetry plane (a new `agentbox_project_*` series on the *existing* `/metrics` endpoint — no new port), and the custom-kind Nostr mesh (a new addressable `kind-30841` digest, sibling of the `kind-30840` session summary, addressed to the operator's `did:nostr`). No new adapter slot. No new URN kind. No React. No Rust crate library. No new port.

**If you remember only one thing:** project tracking is read-mostly observability over repositories agentbox already mounts, expressed entirely in primitives agentbox already ships — eighteen URN kinds, one telemetry port, one Nostr relay. We took helm's idea, not helm's machinery.

For the deep version, keep reading.

---

## 1. Problem

### 1.1 Agentbox hosts many repos and tracks none of them

An agentbox container is a multi-repository host by construction. The shared runtime model (see `CLAUDE.md` §"Shared Runtime Model") bind-mounts `/projects` from the compose stack and exposes the operator workspace at `/home/devuser/workspace/project`. Both fill with git checkouts: the host project, its dependencies, sibling DreamLab repositories, the operator's experiments. Agents spawn against these repos through the Task tool, the ruflo swarm, and the code-as-harness MCP (PRD-008). Every one of those repositories is a working tree with a branch, a commit history, a remote, and a language profile — and agentbox tracks exactly none of it.

The consequences compound:

- **No situational picture.** An operator returning to a container after a week cannot answer "which of these eighteen repos moved, and which are stale" without running `git log` in each by hand. There is no status grid.
- **No agent priming.** An agent dispatched to work in a repository it has never seen starts cold. There is no one-paragraph synopsis, no "this repo is the Rust substrate, last touched on the elevation branch, here is what it does" primer to inject into its opening context.
- **No activity signal.** Agentbox's `/metrics` endpoint reports adapter dispatch, HTTP latency, and build info (see `management-api/observability/metrics.js`). It reports nothing about the repositories the container exists to work on. A Prometheus scrape cannot tell you that the host project has had forty commits this month and the vendored dependency has had zero.
- **No federated awareness.** Agentbox publishes per-session digests to the Nostr mesh (the `kind-30840` session summary, ADR-030). It publishes nothing about project state. An operator reading the mesh in Amethyst on their phone sees what their agents *did* this session but not the standing state of the projects those agents touched.

### 1.2 helm has the tracking model but none of the sovereign plumbing

helm ([github.com/dgdev25/helm](https://github.com/dgdev25/helm)) is the reference capability. It is a project dashboard built on Fastify and React. It aggregates GitHub repositories (via the GitHub API) and local git checkouts (via direct git inspection), renders a status grid, draws a thirty-day commit-activity chart per project, generates AI primers and synopses by shelling out to the Claude CLI, and maintains a repository library and a Rust-crate library. It is a clean, focused tool and its data model is exactly what §1.1 is missing.

What helm does not have, and what agentbox cannot do without:

- **No telemetry.** helm has no Prometheus surface, no metrics, no scrape endpoint. Its state lives in its own database and its own UI. Agentbox's operational picture is built on port-bound Prometheus (ADR-005 §Observability); a tracking feature that produced no metrics would be invisible to it.
- **No federation.** helm is single-user and single-host. It has no Nostr, no relay, no mesh. Agentbox's defining property is that it is a sovereign node — its session digests, its identity, its provenance receipts all federate over the `did:nostr` mesh.
- **No sovereign identity.** helm has no concept of an owner DID, no content-addressed names, no canonical URN grammar. Every durable thing in agentbox is named through `urn:agentbox:…` and owned by a BIP-340 pubkey (ADR-013). helm's projects are rows in a table.
- **A stack we will not import.** helm is Fastify + React. Agentbox's management-api is Fastify already, but agentbox does not ship a React front-end, does not want a second project database, and does not maintain a Rust-crate library. Importing helm wholesale would mean importing a UI framework, a build pipeline, and two library subsystems agentbox has no use for.

The shape of the answer, then, is not "run helm inside agentbox". It is "take helm's tracking model and re-express it natively on agentbox's three existing substrates". §2 states the principles that govern that re-expression; §8 states precisely what we reject from helm and why.

---

## 2. Principles

1. **Reuse the eighteen URN kinds; mint no new ones.** Every tracked project, scan, commit window, primer, synopsis, and digest is named through one of the existing eighteen `urn:agentbox:<kind>` kinds (ADR-013), minted through `management-api/lib/uris.js`. This follows the precedent set by PRD-008 (Code-as-Harness), which expressed five new domain concepts — kernels, traces, lessons, skills, ACI sessions — entirely within the existing kinds. Project tracking adds six mappings (§5) and zero kinds.

2. **Extend the port-bound telemetry; open no new port.** Project metrics register on the *shared* Prometheus registry imported from `management-api/observability/metrics.js`. They appear on the existing `/metrics` endpoint (9090 in-process, 9091 standalone, bound `0.0.0.0`). No new scrape target, no new exporter, no second registry. This mirrors how R-011 collapsed HTTP instrumentation onto the single registry rather than spawning a parallel one.

3. **Custom-kind Nostr addressed to `did:nostr`.** The per-project digest is a new addressable Nostr event, `kind-30841` (NIP-33 parameterised-replaceable), a structural sibling of the `kind-30840` session summary (ADR-030). It is addressed to the operator's `did:nostr` identity. Re-publishing a project's digest replaces the prior one through the NIP-33 `d`-tag — the mesh always carries the current state, never an append-only log.

4. **Adapter-contract adherence — no new slot.** Project tracking is read-mostly observability, not a new durable-state integration. It opens no sixth adapter slot. Its durable state routes through *existing* slots: primers and synopses through the **memory** adapter (RuVector, namespace `project-tracking-primers`); scan activity through the **events** adapter. The three middleware layers (observability, privacy filter, JSON-LD encoder) wrap those dispatches in the usual order (ADR-005, ADR-008, ADR-012).

5. **Manifest-gated.** Every capability sits behind `[project_tracking]` in `agentbox.toml` (§4). The master gate defaults `enabled = false`. With it off, the routes return `503`, the scheduler never starts, no metrics are registered for projects, and nothing is published to the mesh. Standalone-default operators see no behavioural change.

6. **Privacy by default.** Telemetry labels carry the project *slug* (the repository basename), never an absolute host path. The owner identifier on `agentbox_project_info` is the public `did:nostr` pubkey, which is already public by design. No host filesystem layout, no operator home-directory structure, and no absolute path ever reaches a metric label or a Nostr tag. GitHub enrichment is off by default; it requires both a manifest opt-in and a `GITHUB_TOKEN`.

7. **Fail-open egress.** The Nostr publish path and the GitHub enrichment path are optional egress. Any failure on either — relay unreachable, bridge secret absent, `gh` not authenticated, GitHub rate-limited — is logged, recorded as a `skipped` or `error` telemetry outcome, and the scan or digest completes regardless. Optional egress never fails a scan. The publish hook exits 0 on every error path, matching the session-summary precedent.

---

## 3. Capabilities

### 3.1 Repository discovery — local and github-mount

A scan walks the configured `scan_dirs` (default `["/projects", "/home/devuser/workspace/project"]`) and identifies each directory containing a `.git` entry as a tracked repository. Each repository is classified by `source`:

- **`local`** — a working tree with no GitHub remote, or a remote that is not a GitHub URL.
- **`github-mount`** — a working tree whose `origin` (or first) remote resolves to a GitHub repository. This is the class eligible for GitHub enrichment (§3.5).

git metadata is read through `child_process.execFile` with an argument vector and **no shell** (the R2-P0-02 command-injection fix forbids `exec()` with interpolated paths). The scan is idempotent on project `id`: re-scanning a repository updates its record in place rather than appending a duplicate. Each repository is processed independently and fails open — a corrupt or unreadable repository is logged, recorded as a scan error for that repository, and skipped, leaving the rest of the scan intact.

### 3.2 Status grid fields

Each tracked project carries the field set helm's grid renders, expressed as a `TrackedProject` record:

| Field | Source | Notes |
|---|---|---|
| `id` | derived | content-addressed identity (remote URL or absolute path) |
| `urn` | `uris.mint` | `urn:agentbox:thing:<scope>:project-<sha256-12>` |
| `ownerDid` | `AGENTBOX_PUBKEY` | `did:nostr:<hex>` |
| `name` | basename | the slug used in all labels and tags |
| `path` | scan | absolute path — held in the record, never exported to a label |
| `source` | classification | `local` \| `github-mount` |
| `remote` | git | remote URL, if any |
| `branch` | git | current branch |
| `language` | heuristic | dominant language by file extension |
| `lastCommitIso` | git | ISO-8601 timestamp of HEAD |
| `lastCommitAgeSec` | derived | seconds since `lastCommitIso` |
| `commits30d` | git | commit count in the trailing thirty days |
| `commitDays` | git | thirty `{date,count}` buckets (§3.3) |
| `openIssues` | GitHub | enrichment only; `null` without it |
| `stars` | GitHub | enrichment only; `null` without it |
| `primerStatus` | primer | `none` \| `pending` \| `active` \| `error` |
| `primerUrn` | `uris.mint` | memory URN of the stored primer, if any |
| `scannedAt` | scan | ISO-8601 timestamp of the scan that produced this record |

### 3.3 Thirty-day commit activity

For each project the tracker computes a trailing thirty-day commit histogram: thirty `{date, count}` buckets, one per calendar day, from `git log --since` parsed without a shell. The buckets are exposed three ways — as the `commitDays` array on the project record, through the `GET /v1/projects/:id/activity` route (`{project, window:'30d', days:[…]}`), and as the `agentbox_project_commits_30d` gauge (the scalar sum). This is the data behind helm's commit-activity chart, re-expressed as both an API surface and a metric. The `CommitWindow` is itself a first-class dataset URN (§5).

### 3.4 AI primers and synopses via the Z.AI/GLM consultant

For each project the tracker can generate a **primer** (a multi-paragraph orientation document for an arriving agent) and a **synopsis** (a one-paragraph summary for the status grid and the Nostr digest). Generation runs through the existing Z.AI/GLM consultant path: an Anthropic-shaped `POST` to `ZAI_URL/v1/messages` with `x-api-key` and `anthropic-version` headers, mirroring `config/hooks/nostr-session-summary.py`. The default model is `glm-5.2`.

Concurrency is bounded to two slots, matching helm's `withAISlot` gate — primer generation is the expensive path and must not stampede the consultant. Primers and synopses persist through the **memory** adapter under the `project-tracking-primers` namespace (RuVector), each minted a memory URN (§5). When the consultant is not configured (`PrimerGenerator.configured()` is false), generation returns nulls and a `none` status rather than failing — primers are an enrichment, not a precondition for tracking.

### 3.5 GitHub enrichment

When `github_enrichment = true` *and* a `GITHUB_TOKEN` is present, `github-mount` projects are enriched with `openIssues` and `stars` via the `gh` CLI (argument-vector invocation, no shell). Enrichment is strictly optional and strictly fail-open: a missing token, an unauthenticated `gh`, a rate-limit, or a network failure leaves `openIssues` and `stars` at `null` and the project otherwise fully tracked. Enrichment never touches `local` projects — there is no remote to enrich against.

### 3.6 Per-project Nostr digest

Each tracked project can be published to the Nostr mesh as a `kind-30841` digest (§7), addressed to the operator and keyed by the project slug so re-publishing replaces the prior digest. The digest is human-readable — name, synopsis, language, last-commit, thirty-day commit count, open issues, stars, primer status, and the project URN — and is the federated, phone-readable counterpart of the status grid. Publishing routes through the durable bridge's `track` subcommand, mirroring `publish_session_summary` for `kind-30840`.

### 3.7 Prometheus series

Every scan emits the `agentbox_project_*` series (§6) onto the shared registry, so the container's existing Prometheus scrape gains a complete project-state picture with no new scrape configuration. The series cover the tracked count, per-project info and activity, scan timing and outcomes, and Nostr publish outcomes.

---

## 4. Manifest gates

A new top-level `[project_tracking]` section in `agentbox.toml` controls every capability. The master gate defaults off; with it off every capability below is forced off.

```toml
[project_tracking]
enabled            = false                                              # master gate; false ⇒ routes 503, no scheduler, no metrics, no publish
scan_dirs          = ["/projects", "/home/devuser/workspace/project"]   # directories walked for .git working trees
scan_interval_hours = 6                                                 # background scheduler cadence; 0 disables the scheduler (scan-on-request only)
github_enrichment  = false                                             # enrich github-mount projects (requires GITHUB_TOKEN); fail-open
primer_model       = "glm-5.2"                                         # Z.AI/GLM model id for primers and synopses
primer_on_scan     = false                                             # generate/refresh primers automatically as part of each scan
nostr_publish      = false                                             # publish a kind-30841 digest per project after each scan; fail-open
metrics            = true                                              # register agentbox_project_* on the shared registry
```

| Key | Type | Default | Controls |
|---|---|---|---|
| `enabled` | bool | `false` | master gate; off ⇒ routes return `503`, scheduler never starts, no project metrics registered, nothing published |
| `scan_dirs` | array | `["/projects", "/home/devuser/workspace/project"]` | directories walked for `.git` working trees |
| `scan_interval_hours` | int | `6` | background scheduler cadence in hours; `0` disables the scheduler and leaves scanning request-driven only |
| `github_enrichment` | bool | `false` | enable `gh`-based issue/star enrichment of `github-mount` projects; requires `GITHUB_TOKEN`; fail-open |
| `primer_model` | string | `"glm-5.2"` | model id passed to the Z.AI/GLM consultant for primers and synopses |
| `primer_on_scan` | bool | `false` | generate or refresh primers automatically as part of each scan rather than only on explicit request |
| `nostr_publish` | bool | `false` | publish a `kind-30841` digest per project after each scan; requires bridge secrets; fail-open |
| `metrics` | bool | `true` | register the `agentbox_project_*` series on the shared registry when the master gate is on |

A second one-line manifest change is required outside this section: `30841` is added to `[sovereign_mesh.relay].allowed_kinds` so the embedded relay will accept the new event (ADR-009 / ADR-029). This is an integrator change recorded here for completeness.

---

## 5. URN allocation

Six domain concepts map onto the existing eighteen kinds. No kind is added. Every URN below is minted through `management-api/lib/uris.js` `mint()`; ad-hoc `format!()` or template-literal construction is prohibited (ADR-013, `CLAUDE.md` §"URI/URN Scheme"). The `<scope>` is always the 64-character BIP-340 x-only hex pubkey from `AGENTBOX_PUBKEY`; the owner identity is `owner_did = did:nostr:<hex>`.

| Concept | Kind | Shape | Addressing |
|---|---|---|---|
| **TrackedProject** | `thing` | `urn:agentbox:thing:<scope>:project-<sha256-12>` | content-addressed on the remote URL (or absolute path for `local`) |
| **ProjectScan** | `activity` | `urn:agentbox:activity:<scope>:projscan-<sha256-12>` | PROV-O action receipt for one scan run |
| **CommitWindow** | `dataset` | `urn:agentbox:dataset:<scope>:commits-<projsha>-30d` | the thirty-day activity dataset for a project |
| **ProjectPrimer** | `memory` | `urn:agentbox:memory:<scope>:primer-<sha256-12>` | the stored primer document |
| **ProjectSynopsis** | `memory` | `urn:agentbox:memory:<scope>:synopsis-<sha256-12>` | the stored one-paragraph synopsis |
| **TrackingDigest** | `event` | `urn:agentbox:event:<scope>:projtrack-<sha256-12>` | the published `kind-30841` digest event |

These follow the PRD-008 precedent exactly: `thing` for the durable entity (as kernels and ACI sessions are `thing`), `activity` for the action receipt (as execution traces are `activity`), `memory` for the RuVector-resident primer and synopsis (as distilled lessons are `memory`), `dataset` for the commit window, and `event` for the federated digest. `thing`, `memory`, and `dataset` carry optional or required owner scope per their `KINDS` entry in `uris.js`; `activity` and `event` are content-addressed and owner-scoped. The `TrackedProject` `id` used for idempotency is the content-address component (`sha256-12-…`) of its URN.

---

## 6. Telemetry

A new module, `management-api/observability/project-metrics.js`, imports `register` from `./metrics` and registers every series below on that **shared** registry. The series therefore appear on the existing port-bound `/metrics` endpoint (9090 in-process, 9091 standalone, bound `0.0.0.0`) with no new port and no new exporter. Registration is gated: when `[project_tracking].enabled` or `[project_tracking].metrics` is off, no project series is registered.

| Metric | Type | Labels | Description |
|---|---|---|---|
| `agentbox_project_tracked_total` | Gauge | — | number of projects currently tracked |
| `agentbox_project_info` | Gauge (=1) | `project`, `language`, `source`, `owner_did`, `urn` | one info series per project; value always 1 |
| `agentbox_project_commits_30d` | Gauge | `project` | commits in the trailing thirty days |
| `agentbox_project_open_issues` | Gauge | `project` | open GitHub issues (enrichment only) |
| `agentbox_project_stars` | Gauge | `project` | GitHub stars (enrichment only) |
| `agentbox_project_last_commit_age_seconds` | Gauge | `project` | seconds since the most recent commit |
| `agentbox_project_primer_status` | Gauge (=1) | `project`, `status` | one series per project carrying value 1 for its current `status` |
| `agentbox_project_scan_duration_seconds` | Histogram | — | wall time per scan run |
| `agentbox_project_scans_total` | Counter | `outcome` | scan outcomes; `outcome` ∈ {`success`, `error`} |
| `agentbox_project_nostr_publish_total` | Counter | `outcome` | digest publish outcomes; `outcome` ∈ {`success`, `error`, `skipped`} |

### 6.1 Privacy on labels

The `project` label is the repository **slug** (its basename) and never an absolute host path. The `owner_did` label on `agentbox_project_info` is the public `did:nostr` pubkey, which is public by design (ADR-013). No absolute path, no operator home-directory layout, and no host filesystem structure ever reaches a label. The `urn` label carries the content-addressed `urn:agentbox:thing:…` identity, which encodes the pubkey scope and a hash — not a path. This satisfies the ADR-008 privacy posture at the metrics surface: the absolute `path` lives only on the in-memory `TrackedProject` record and is exported through neither telemetry nor the Nostr digest.

The module exports the setter surface the tracker drives: `setTrackedTotal(n)`, `setProjectInfo({slug,language,source,ownerDid,urn})`, `setProjectCommits30d(slug,n)`, `setProjectOpenIssues(slug,n)`, `setProjectStars(slug,n)`, `setProjectLastCommitAge(slug,sec)`, `setProjectPrimerStatus(slug,status)`, `observeScanDuration(sec)`, `recordScan(outcome)`, `recordNostrPublish(outcome)`, `clearProject(slug)`, and `_gauges` (for tests).

---

## 7. Nostr kind-30841

`KIND_PROJECT_TRACKING = 30841` is a NIP-33 parameterised-replaceable (addressable) event and a structural sibling of the `kind-30840` session summary (ADR-030). Being addressable, an event is uniquely keyed by `(kind, pubkey, d-tag)`; re-publishing a project's digest with the same `d`-tag replaces the prior digest on the relay, so the mesh always carries the current project state rather than an append-only history.

**Tags:**

| Tag | Value | Notes |
|---|---|---|
| `d` | project slug | NIP-33 addressability key; re-publish replaces |
| `p` | recipient hex pubkey | the operator identity the digest is addressed to |
| `t` | `agentbox-project` | topic tag for mesh-side filtering |
| `r` | remote URL | included only when the project has a remote |
| `l` | language | included only when a language was detected |
| `alt` | `Project status: <name>` | NIP-31 human-readable fallback |

**Content:** a human-readable digest — project name, synopsis, language, last commit, thirty-day commit count, open issues, stars, primer status, and the project URN — readable directly in Amethyst or any Nostr client without a bespoke parser.

**Publish path:** the durable bridge's `track` subcommand signs the `kind-30841` event, dual-writes the operator's pod inbox and `projects/<id>.jsonld`, and publishes to the relay — mirroring `publish_session_summary` for `kind-30840`. The Node side reaches it through `config/hooks/project-tracking-publish.cjs`, which reads tracked projects (or a single digest on stdin) and shells `nostr-pod-bridge track` per project, gated like the session-summary hook (bridge secrets present) and fail-open (exit 0 on every error). When `[linked_data].events` is on, the digest is emitted as JSON-LD per ADR-012; otherwise it is the plain content form. The `kind-30841` digest is the standing-state egress; the `kind-30840` session summary remains the per-session-activity egress — the two are complementary, not redundant.

---

## 8. Out of scope / rejected

Project tracking is helm's *model* re-expressed on agentbox's substrate. The following are deliberately rejected — not deferred for reconsideration, but closed decisions unless a new ADR reverses them. helm ([github.com/dgdev25/helm](https://github.com/dgdev25/helm)) is gratefully credited as the capability inspiration for the status grid, the thirty-day commit activity, the AI primer/synopsis pattern, and the local + GitHub aggregation model. What we reject is its machinery, not its idea.

- **The React + Fastify helm dashboard stack.** Agentbox ships no React front-end and will not add one for this feature. The management-api is Fastify already; project tracking adds routes to it, not a second web application. The status grid is an API surface (`GET /v1/projects`), a metrics surface (`agentbox_project_*`), and a federated digest (`kind-30841`) — three things agentbox already knows how to render — not a bundled single-page app. Visualisation, if an operator wants it, is the existing Prometheus/Grafana plane or the linked-data viewer (PRD-006 §15), neither of which agentbox has to build.

- **The Rust crate library.** helm maintains a curated crate library alongside its repository library. Agentbox tracks repositories it mounts; it does not curate a package index. A crate library is a different product with a different data model and no place in a workspace-observability feature.

- **A new adapter slot.** Project tracking is read-mostly observability, not a durable-state backend. It opens no sixth adapter slot (`CLAUDE.md` §"Important Rules For Changes" forbids it). Its two durable outputs route through existing slots — primers/synopses through **memory**, scan activity through **events** — wrapped by the standard three middleware layers.

- **New URN kinds.** All six domain concepts map onto the existing eighteen kinds (§5), following the PRD-008 precedent. Introducing a `project` kind, or any other, is rejected: the eighteen-kind grammar is converged across the DreamLab substrate (`CLAUDE.md` §"URI/URN Scheme") and adding a kind would fork it.

- **A new telemetry port or registry.** Project metrics register on the shared registry and appear on the existing `/metrics` endpoint (§6). A dedicated project-tracking port or a second `prom-client` registry is rejected — it would duplicate `collectDefaultMetrics()`, complicate the scrape configuration, and break the single-registry invariant R-011 established.

- **A standalone project database.** helm persists to its own database. Agentbox does not add one. Project records are scan-derived and held in memory between scans; the only durable writes are primers/synopses (RuVector via the memory adapter) and digests (the pod inbox + `projects/<id>.jsonld` via the bridge). State is reconstructable from a fresh scan, so no separate database is warranted.

- **The Claude-CLI primer path.** helm shells out to the Claude CLI for primers. Agentbox routes primers through its existing Z.AI/GLM consultant (`ZAI_URL/v1/messages`, §3.4), the same path the session-summary hook uses. A second LLM invocation path is rejected; primers reuse the one agentbox already has.

---

## 9. Acceptance criteria

Acceptance criteria are measurable and binary unless stated otherwise.

1. **Master gate forces silence.** With `[project_tracking].enabled = false`, every `/v1/projects*` route returns `503 {error:'project_tracking disabled'}`, the background scheduler does not start, no `agentbox_project_*` series is present on `/metrics`, and no `kind-30841` event is published. A container with the default manifest exhibits zero behavioural change from this PRD.

2. **Local discovery.** With the gate on, a scan of a `scan_dirs` directory containing N git working trees produces exactly N `TrackedProject` records, each classified `local` or `github-mount`, each with a `urn:agentbox:thing:<scope>:project-<sha256-12>` minted through `uris.js`. A non-repository directory produces no record.

3. **Idempotency.** Re-scanning the same directory set produces the same project `id`s and updates records in place; the tracked count does not grow on repeated scans of an unchanged tree.

4. **git metadata correctness.** For a repository with a known commit history, `gitMetadata(repoPath)` returns the correct `branch`, `lastCommitIso`, a `lastCommitAgeSec` consistent with it, a `commits30d` count matching `git log --since="30 days ago"`, and a `commitDays` array of thirty `{date,count}` buckets summing to `commits30d`. All git invocations use `execFile` with an argument vector and no shell.

5. **Thirty-day activity surface.** `GET /v1/projects/:id/activity` returns `{project, window:'30d', days:[{date,count}×30]}` consistent with the project's `commitDays`.

6. **Telemetry shape and privacy.** After a scan, `/metrics` exposes `agentbox_project_tracked_total`, one `agentbox_project_info{project,language,source,owner_did,urn}=1` per project, and the per-project gauges. No metric label contains an absolute host path; `project` labels are slugs and `owner_did` is the public pubkey. `agentbox_project_scans_total{outcome="success"}` increments once per successful scan and `agentbox_project_scan_duration_seconds` records its wall time.

7. **Primer fail-open.** With the consultant unconfigured, `generatePrimer` returns nulls with `primerStatus = "none"` and the scan completes; the project is fully tracked minus the primer. With the consultant configured, a primer and synopsis are generated, persisted to the `project-tracking-primers` memory namespace with minted memory URNs, and `agentbox_project_primer_status{project,status="active"}=1` is set. Primer concurrency never exceeds two slots.

8. **GitHub enrichment fail-open.** With `github_enrichment = true` and no `GITHUB_TOKEN`, `github-mount` projects retain `openIssues = null` and `stars = null`, `agentbox_project_scans_total{outcome="error"}` is not incremented for the missing token, and the scan otherwise completes. With a valid token, `openIssues` and `stars` populate and the corresponding gauges are set.

9. **Nostr digest.** With `nostr_publish = true` and bridge secrets present, each project publishes a `kind-30841` event with `["d", slug]`, `["p", recipient_hex]`, `["t","agentbox-project"]`, `["alt","Project status: <name>"]`, and `["r", remote]` / `["l", language]` when present; re-publishing the same project replaces the prior event via the `d`-tag; `agentbox_project_nostr_publish_total{outcome="success"}` increments. With bridge secrets absent, the publish hook exits 0, increments `…{outcome="skipped"}`, and the scan completes. `30841` is present in `[sovereign_mesh.relay].allowed_kinds`.

10. **Linked-data emission.** With `[linked_data].enabled = true` and the relevant surface on, `GET /v1/projects` with `Accept: application/ld+json` returns JSON-LD through the encoder middleware, and the published digest is emitted in JSON-LD form; with linked-data off, both return the plain JSON/content forms. Privacy redaction (ADR-008) completes before the encoder runs in both paths.

11. **No new substrate.** A diff of this feature introduces no new adapter slot, no new URN kind, no new Prometheus port, and no new registry. All durable writes route through the `memory` and `events` adapters; all URNs are minted through `uris.js`; all metrics register on the shared registry.

### Cross-references

- [ADR-035 — Project-tracking telemetry and Nostr kind](../adr/ADR-035-project-tracking-telemetry-and-nostr-kind.md)
- [DDD-015 — Project-tracking domain](../ddd/DDD-015-project-tracking-domain.md)
- [PRD-008 — Code-as-Harness integration](PRD-008-code-as-harness-integration.md) — URN-reuse precedent
- [PRD-006 — Linked-data interfaces](PRD-006-linked-data-interfaces.md) — emit surfaces and viewer slot
- [PRD-001 — Capabilities and adapters](PRD-001-capabilities-and-adapters.md)
- [ADR-005 — Pluggable adapter architecture](../adr/ADR-005-pluggable-adapter-architecture.md)
- [ADR-009 — Embedded Nostr relay](../adr/ADR-009-embedded-nostr-relay.md)
- [ADR-013 — Canonical URI grammar](../adr/ADR-013-canonical-uri-grammar.md)
- [ADR-030 — Sovereign-mesh mobile bridge](../adr/ADR-030-sovereign-mesh-mobile-bridge.md)
- [DDD-003 — Sovereign messaging domain](../ddd/DDD-003-sovereign-messaging-domain.md)
- [DDD-004 — Linked-data interchange domain](../ddd/DDD-004-linked-data-interchange-domain.md)
- [`management-api/lib/uris.js`](../../../management-api/lib/uris.js) — URN minting
- [`management-api/observability/metrics.js`](../../../management-api/observability/metrics.js) — shared registry
- [helm](https://github.com/dgdev25/helm) — capability inspiration (model adopted, stack rejected; §8)
