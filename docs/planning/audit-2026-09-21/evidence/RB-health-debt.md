# Estate health and technical debt — what is actually broken, right now

Sources: `VisionFlow/website/static/data/estate-health.json` (generated 2026-09-21T08:04:01.932Z, revision `1357a56`); `project/docs/KNOWN_ISSUES.md`; `project/docs/TODO-unified.md`; `VisionFlow/docs/estate-review/*.md`; `agentbox/docs/BASELINE-container.md`, `INGRESS-identity.md`, `GOVERNANCE-capabilities.md`; `solid-pod-rs/README.md`; live shell commands run inside this container on 2026-09-21 (supervisorctl, curl, git log, `node scripts/adr-index-gen.js --check`). All timestamps UTC. All costs are S (hours), M (1–3 days), L (a sprint or more, or blocked on external/owner action).

Two corrections to the task brief up front, because they change the read: only **2** ADRs are actually stale under `adr-index-gen.js --check` (ADR-2009, ADR-2010), not 15 — see §5. And `VisionClaw` is not checked out anywhere in this workspace, so its red CI causes are taken from the estate-health JSON and `KNOWN_ISSUES.md` alone, not from source inspection.

---

## 1. Red/amber table — CI, per repo

| Repo | State | Failing workflow(s) | Cause (from source/logs) | Age | Blast radius | Cost |
|---|---|---|---|---|---|---|
| **VisionFlow** | 🔴 red | `Diagrams-as-code index gate` | `docs/diagrams` index/citation gate (`scripts/diagram-index-gen.cjs --check`) failing since run `35030434546` (2026-09-15T22:20Z). The gate validates frontmatter, unique ids, prose limits and that `COVERAGE.md` is in sync with the tree; commits since then are all doc/estate-closeout commits (`ec7f353`, `450b61b`, `f2bac70`…) that plausibly touch diagrams without regenerating the index. | 6 days | Low functionally (docs-only gate); high for trust — the estate's own canon repo has had a red badge for a week and every commit since has been "docs" commits that never fixed it | S — regenerate `COVERAGE.md` with `node scripts/diagram-index-gen.cjs docs/diagrams` and commit |
| **VisionClaw** | 🔴 red | `CI`, `Documentation Quality CI` | Not locally checked out in this container (see correction above); `docs/KNOWN_ISSUES.md` P2 items (AUTH-001, AGENT-001, below) are the closest first-party evidence of what's actually unfinished in this repo, but they are not necessarily the CI failure cause. `Ontology Federation CI/CD` and `XR Godot CI` are green. | ≥5 days (since 2026-09-16T15:58Z) | Medium — VisionClaw is the GPU engine / OWL reasoner; a red main CI blocks confident merges | M — needs a VisionClaw checkout to diagnose properly; flagged as a gap in this audit, not resolved |
| **agentbox** (this repo) | 🔴 red | `CI`, `nix-flake-update`, `Security Invariants`, `ShellCheck`, `TUI helper tests` | `nix-flake-update` red since 2026-09-14 (weekly Monday-cron Nix input bump, likely a genuine upstream/lockfile conflict, not touched since). The other four all failed on **today's** run (2026-09-21T07:4xZ), triggered by commit `c446783` — a pure `docs(research)/*.md` addition (11 new markdown files, 0 code). A docs-only commit failing `ShellCheck`/`Security Invariants`/`TUI helper tests` means these gates were **already red on `main` before this commit** and the docs push just re-surfaced it; nothing in this session's diff touches shell scripts, TUI code or security-relevant paths. | `nix-flake-update`: 7 days. Others: pre-existing, exact onset not established in this session (needs a bisect) | High — this is the project's own governing/runtime repo; five simultaneous red gates on `main`, one of them weekly-scheduled and untouched for a week, is a "nobody is watching CI" signal | M — bisect the four same-day failures against the last known-green SHA; S for the Nix lockfile bump once the actual conflict is visible |
| **solid-pod-rs** | 🟢 green (CI) | — | CI green, but the README carries a live, first-party disclaimer (see §2) that the security posture is *not* production-safe regardless of green CI — green CI here means "compiles and passes its own suite," not "audited". | ongoing | Medium — every consumer (agentbox pods adapter, nostr-pod-bridge) inherits this | L — tracked findings below |
| **nostr-rust-forum** | 🔴 red | `CI`, `Security Audit` | Both red since 2026-09-15T22:2xZ, same nightly batch as VisionFlow's diagram gate and VisionClaw's Doc Quality CI — consistent with a shared upstream trigger (a common action pin, a shared lint rule, or a shared CI runner image bump) rather than five independent regressions. Worth checking `renovate.json`/pinned action SHAs across repos for a common denominator. `Security Audit` red on a repo whose whole job is Nostr-signed BBS security-critical crates (crypto, ACL, NIP-98 replay, SSRF) is the most consequential entry in this row. | 6 days | High — this is the security-audit gate for a crypto/ACL-bearing crate, red for six days with no follow-up commit | M — needs the actual `cargo-deny`/advisory diff, not available without a checkout run in this session |
| **loom** | 🔴 red | `Rust contracts` | Last red run 2026-09-13T17:37Z. `check-ruvector-source.sh` pins the sibling `ruvector` checkout to an exact SHA (`677b2475…`) and hard-fails if it drifts — every commit since 2026-09-13 is a `docs(paper)`/`research:` commit on an unrelated LLM-suppression research paper living in the same repo; none touches `Cargo.toml`, `Cargo.lock` or the workflow. The CI red is very likely just the sibling-repo pin going stale (ruvector moved past `677b247` on its own default branch) rather than anything loom itself broke. | 8 days | Low-medium — loom is "production-critical" per `GOVERNANCE-capabilities.md` #2, but this specific gate (hermetic Rust contract tests against a pinned ruvector sibling) failing doesn't necessarily mean the deployed façade is broken, just that CI can't build the hermetic check | S — re-pin `expected` SHA in `scripts/check-ruvector-source.sh` to ruvector's current HEAD once someone confirms it's still API-compatible |
| **dreamlab-ai-website** | 🟢 green | — | — | — | — |
| **knowledgeGraph** | 🟢 green | — | — | — | — |
| **vowl-wasm** | 🟢 green | — | — | — | — |
| **prose-sanitiser** | 🟢 green | — | — | — | — |
| **diagram-ir** | 🟢 green | — | — | — | — |
| **dream-engine** | 🟢 green, but **4 open PRs** | — | Green CI, but the only repo in the estate carrying an open-PR backlog (4, vs 0–1 everywhere else) — worth a look even though it's not red | ongoing | Low | S — triage |
| **WasmVOWL** | ⚪ none (no CI configured/run) | — | `docs/TODO-unified.md` §"Frozen and historical scope": deliberately held pending a `WebVowl` positions accessor; not a regression | ongoing (frozen by design) | Low | — |
| **visionGraph** | ⚫ unreadable | — | Estate-health collector could not read this repo's CI state at all (`ci.state: "unknown"`, `open_prs`/`open_issues`: `null`) — this is itself a monitoring gap, not just a red build | unknown | Medium — visionGraph is the active Obsidian/Logseq publish target (per TODO-unified C-14/C-13); flying blind on its CI | S — find out why the collector can't read it (private repo? missing token? See G-23 below, `ESTATE_READ_TOKEN` is explicitly noted absent) |

**Estate summary as measured**: 14 repos, 7 green, 5 red, 1 none, 1 unreadable, 5 open PRs total (4 of them on dream-engine alone), 6/6 surfaces OK.

---

## 2. The daily-driver health of agentbox itself

This is the tool the owner opens every session. Two things are actively broken right now, independent of anything documented as "proposed" or "blocked":

### 2.1 Seven MCP servers down — one root cause, not seven

`consultant-antigravity`, `consultant-codex`, `consultant-deepseek`, `consultant-perplexity`, `perplexity`, `ruvnet-brain`, `web-researcher` all fail `ConnectionRefused` in this session. The apparent breadth (seven distinct server names) is misleading: **all seven route through one shared proxy**, `http://127.0.0.1:9720/<name>/mcp` (confirmed by reading `/home/devuser/workspace/.mcp.json`, the config that actually applies to this session — note this differs from `project/.mcp.json`, which still lists the old direct-stdio spawns for the four `consultant-*` servers and doesn't mention `ruvnet-brain` at all, itself a small drift worth fixing separately). That proxy is `agentbox-mcp hub`, bound to `127.0.0.1:9720` per its own process cmdline.

Live diagnosis:
- `supervisorctl status agentbox-mcp-hub` reports **RUNNING**, pid 3498493, uptime ~2 minutes at time of check.
- `ss -tlnp` shows **no listener on 9720 at all** — the process is alive per supervisord but has never successfully bound its port.
- `/var/log/agentbox-mcp-hub.error.log` shows the actual failure: the hub waits for `/run/agentbox/mcp-hub.json` in 15-second increments, times out after 600s, prints `Error: /run/agentbox/mcp-hub.json: not written within 600s (is the bootstrap program projecting the hub config?)`, exits, and supervisord respawns it — which immediately starts the same 600-second wait again. This has been looping since at least 18:03Z today and is still looping at time of writing.
- `/run/agentbox/mcp-hub.json` does not exist on disk.
- Per `agentbox/docs/BASELINE-container.md`'s own Invariants section, this is meant to be graceful: *"A supervised program that depends on a file the bootstrap program writes later waits for it with a bounded timeout rather than failing into FATAL (ADR-2063, `services/agentbox-mcp/src/hub/mod.rs` `wait_for_config`)"*. In practice the bounded wait is real, but nothing ever re-runs the write step that produces the config (that's `agentbox-manifest`, invoked once from `config/entrypoint-unified.sh` at boot, per `services/agentbox-manifest/src/mcp_hub.rs:312`). If that boot-time write silently fails or races once, the hub is stuck in a crash-restart-timeout loop for the **entire container lifetime** — not a graceful degrade, a permanent black hole that looks alive in `supervisorctl status`.
- Other services on the same box that this session's other tool calls proved healthy: `nip98-proxy` (:9096), `management-api` (:9090/:9091), `solid-pod` (:8484), `nostr-relay`/`nostr-pod-bridge` (:7777), Loom façade (`curl http://192.168.2.132:8084/health` → 200), embeddings (`curl 192.168.2.132:9997` → 307, i.e. reachable). This is specifically an MCP-hub problem, not a network or GPU-estate problem.

**Fake-green angle**: `supervisorctl status` says RUNNING. An operator scanning `supervisorctl status` for red would see nothing wrong. The actual signal is only in the error log and in `ss -tlnp` showing an absent listener — a genuinely silent failure mode.

**Cost to fix**: S to remediate this session (restart the process that projects `/run/agentbox/mcp-hub.json`, or just rebuild/restart the container so boot order re-runs cleanly). M to fix properly — the underlying gap is that nothing detects "hub has been crash-looping for N minutes with the config never appearing" and alerts; add a supervisord `startretries`/backoff ceiling that goes FATAL after, say, 3 cycles, or a boot-order fix in `entrypoint-unified.sh` so the manifest projection step is guaranteed to complete or fail loudly before the hub program starts.

**Blast radius**: every research/consultant workflow this session (and, per the log timestamps, every session since at least 18:03Z today) has silently lost `/ceramic-search`, `/perplexity-research`'s native-tool path, the `auto-consultant` agent, and `ruvnet-brain` grounding. Agents fall back to WebSearch/WebFetch or nothing, without necessarily noticing the fallback happened.

### 2.2 ADR staleness — real but small

`node scripts/adr-index-gen.js docs/adr --check` in `project/agentbox` returns exactly **2** stale records: `ADR-2009-nip98-proxy-identity-boundary.md` and `ADR-2010-bearer-gated-behind-nip98.md`, both stale because `docs/INGRESS-identity.md` changed after their `verified_commit`. Both are in the same subsystem (ingress identity), so this is a single re-verification pass, not 15 scattered ones. Cost: S — re-read both ADRs against current `INGRESS-identity.md` and bump `verified_commit`.

### 2.3 Recall gate — could not get a live number

`./agentbox.sh ruvector recall` was invoked and is a genuine (not cheap) brute-force-vs-HNSW comparison over 120 true-recall queries; it did not complete inside a reasonable check window in this session. The last first-party recorded measurement, per `TODO-unified.md`'s "Earlier resolved records" table, is 2026-09-06: PASS, exit 0, self 189/200, true 115/120, receipt `sha256-12-cbccf57f8d35` — 15 days old relative to today (2026-09-21) and explicitly noted there as measured *after* a serial HNSW rebuild, since the pre-rebuild number (self 164/200, true 96/120) was a real FAIL. Given the recall-gate note in `agentbox/CLAUDE.md` that HNSW "degrades silently under bulk churn," a 15-day-old PASS is not a live guarantee — it is stale evidence, not a current green light. Cost to get a real number: S (just wait out the ~2 minutes the harness needs; not done here to respect the read-only/no-long-blocking-command constraint of this audit).

---

## 3. The "fake green" list — documented live, code says otherwise

These are the highest-value findings: places where a governing doc, a status field, or a tool's own reporting says one thing and the code or live state says another.

1. **`agentbox-mcp hub` — `supervisorctl status` = RUNNING; actual state = permanently crash-looping, never bound its port, never served a single MCP request.** See §2.1. This is the single most consequential fake-green in the estate right now because it silently degrades every session, not just this one.
2. **`docs/BASELINE-container.md`'s own invariant** — "waits with a bounded timeout rather than failing into FATAL" — is written as a resilience feature. Live behaviour shows the bounded-timeout design has no upper retry ceiling, so "graceful" degrades into "permanently broken but never reported as broken."
3. **VisionClaw `KNOWN_ISSUES.md` AUTH-001** — the file's own layered corrections show the fake-green pattern happening *in the doc itself over time*: an original entry claimed `enterprise_auth.rs`'s four-tier RBAC was live on `main`; a 2026-07-22 correction said it was branch-only; a 2026-08-31 resolution says a *different*, Nostr-native RBAC (not the originally-described one) is now actually on `main`, while the originally-described OIDC/SAML design was "never adopted." Three successive claims about the same feature, each one revising what "live" meant. Net current truth: native RBAC is real; enterprise IdP federation (OIDC/SAML/SCIM) is not, and per the doc "Enterprise users cannot log in via Entra ID, Okta, or Google Workspace" today.
4. **AGENT-001 (VisionClaw)** — `rvf-integration-prd.md` describes a portable `.rvf` file store replacing the Postgres dependency for agent memory. Not implemented. Production is exclusively `ruvector-postgres:5432`; if that container is down, `memory_store` fails closed with connection-refused and **there is no fallback**, despite the PRD reading as if the file-store option already exists as an alternative path.
5. **`agentbox/docs/GOVERNANCE-capabilities.md` #1, "TOP OPEN RISK"** — stated plainly in the doc's own words: *"Autonomy (recursive spawn, code execution, nightly unattended dream cycles, background jobs) is live while the two governors that would make it safe (execution journal ADR-057, monotonic policy pipeline ADR-059) are unbuilt proposals. There is no single policy decision point and no canonical replayable record."* This is a first-party admission, not an inferred gap — flagged here because it is exactly the shape of "documented as live, safety mechanism is not" that this audit was asked to surface, and because unlike the MCP hub it is a design gap rather than a runtime bug: the nightly dream cycles run today, unaudited, by design-as-currently-shipped.
6. **`solid-pod-rs` README** — the security-controls paragraph reads as a competent list (path rejection, SSRF filtering, ACL caps, NIP-98 size limits, WAC-gated git) immediately followed, in the same document, by: *"These controls do not make the current checkout production-safe: the dated audit records critical IdP, MCP, and payment-integrity findings."* And further down: *"Security audit is not green… `cargo audit --deny warnings` fails on `RUSTSEC-2026-0258`…"* — CI for this repo is green (per estate-health), but green CI here explicitly excludes the audit gate that is failing. Anyone reading only the estate-health dashboard sees 🟢; anyone reading the README two clicks deeper sees a live RUSTSEC finding.
7. **VisionFlow `src/app_state.rs:936,943`** — two settings, `system.network.enableRateLimiting` and `system.security.enableRequestValidation`, can be set `true` in config and the server logs a warning that the middleware they're meant to gate **is not wired to anything**. An operator flipping these flags reasonably believes they did something; they did not.
8. **VisionFlow `src/handlers/pay_handler.rs:487` and `src/handlers/graph_export_handler.rs:272,309`** — live `HttpResponse::NotImplemented()` handlers wired into routing (i.e., reachable endpoints that return 501 by design today, not TODOs in comments).
9. **VisionFlow `src/adapters/oxigraph_graph_repository.rs:832`** — `GraphRepositoryError::NotImplemented` returned from a production adapter path, and `src/ports/graph_repository.rs:43` declares `NotImplemented` as a first-class variant of the port's own error enum — i.e. the port contract itself documents that some repository operations are allowed to not exist yet, which is honest but means any caller assuming the port is fully implemented is wrong.
10. **`docs/TODO-unified.md` closure semantics generally** — the document is explicit and self-aware about this exact failure mode: *"A source closure fulfils the named implementation task; it does not assert a running deployment or complete system journey."* 21 of 61 original items are "blocked" specifically because their code closed but their live/deployed acceptance didn't (EA-04 through V-1, listed in full in §4). This is disciplined bookkeeping, not itself a fake-green — but it means every closed ID elsewhere in the estate needs the same "closed in source, live in deployment?" question asked before being trusted.

---

## 4. Subsystem TODO/FIXME/fail-open/NotImplemented census

Grepped across `project/agentbox/{management-api,services,config}` and `project/src`, excluding `node_modules`, `target`, `archive`:

| Subsystem | `not yet wired` | `TODO` | `FIXME` | `fail-open`/`fail_open` | `NotImplemented`/`unimplemented!` | Notes |
|---|---|---|---|---|---|---|
| agentbox `services/nostr-pod-bridge` | 1 | 0 | 0 | — | 0 | `lib.rs:18` — ADR-099 registry model "not yet wired into this bridge" |
| agentbox `services/skill-tools` (docs-alignment) | 0 | 5 refs | 2 refs | — | 0 | These are the **tool's own report-template strings** ("### TODOs\n", "_No stubs or TODOs found._"), not actual debt — a grep false-positive worth noting so it isn't miscounted |
| agentbox `management-api`/`services`/`config` (all) | 1 | 7 | 3 | 115 / 6 | 0 | `fail-open` at 115 hits is overwhelmingly the estate's *documented, deliberate* pattern (ADR-005/008/2035/2036 middleware ordering, orchestrator-fatal-others-quarantine design) rather than undocumented risk — see the Invariants block in `BASELINE-container.md` §"Orchestrator connect failure is FATAL... other slots are quarantined". Flagging the count for visibility, not as 115 separate bugs |
| VisionFlow `src` (project root) | 3 | 5 | 0 | 24 / 1 | 5 | The concrete ones: rate-limiting middleware unwired, request-validation middleware unwired, `pay_handler` 501, `graph_export_handler` 501 ×2, `oxigraph_graph_repository` `NotImplemented`, GPU block-size FFI TODO (`execution.rs:115`), DAG orientation TODO ×2 (`physics.rs:90-91`), zone-forwarding TODO (`layout_handler.rs:262`) |

**Reading this table honestly**: the raw grep counts (115+24 "fail-open" hits) look alarming out of context but are mostly the estate's named architectural pattern, cited by ADR. The genuinely actionable items are the ~20 rows in the last column of the VisionFlow breakdown — concrete unwired middleware and 501 handlers reachable from production routes.

---

## 5. ADR staleness — corrected count

The task brief said "15 stale host ADRs." A live run of the actual gate found:

```
node scripts/adr-index-gen.js docs/adr --check
error: ADR-2009-nip98-proxy-identity-boundary.md: STALE — governed paths changed since verified_commit b680a7ae..., docs/INGRESS-identity.md
error: ADR-2010-bearer-gated-behind-nip98.md: STALE — governed paths changed since verified_commit b680a7ae..., docs/INGRESS-identity.md
error: 2 validation error(s); README not generated
```

**2 stale, not 15**, both pinned to the same upstream doc edit (`INGRESS-identity.md` moved after both ADRs were last verified). If "15" is a number from a different or older audit pass, it has since been substantially worked down — worth reconciling with whoever produced that figure rather than treating it as current. Cost: S, one PR touching two `verified_commit` stamps once someone actually re-reads both ADRs against the current ingress-identity doc (not just bumping the hash blind).

---

## 6. Top 5 debts by blast radius

1. **`agentbox-mcp hub` permanently crash-looping, seven MCP servers dark, `supervisorctl` reports it healthy.** Every session since at least this morning has silently lost consultant/research tooling. Highest blast radius because it is (a) live right now, (b) invisible to the standard health check, and (c) affects every agent in the mesh, not one repo. Cost: S to unstick this session, M to make the failure mode loud instead of silent. See §2.1.
2. **The governance gap named in `GOVERNANCE-capabilities.md` #1** — autonomous, unattended, code-executing nightly cycles run today with no execution journal (ADR-057) and no monotonic policy pipeline (ADR-059), both still unbuilt proposals, and the doc names this as its own top risk. Blast radius is "anything an autonomous agent does with no replayable record of why." Cost: L — this is a real build, not a config fix.
3. **`solid-pod-rs` — green CI, failing security audit, first-party README admission of critical IdP/MCP/payment-integrity findings, `RUSTSEC-2026-0258` unresolved.** Blast radius: every consumer of the pods adapter slot and nostr-pod-bridge inherits an unaudited-by-its-own-admission crypto/identity surface. Cost: L.
4. **Five repos red simultaneously, three of them (VisionFlow, VisionClaw, nostr-rust-forum) all going red in the same ~2-hour window on 2026-09-15T22:2xZ**, suggesting a shared upstream cause (pinned action, shared lint config, runner image) nobody has traced yet. If true, fixing the common cause is one fix, not three. Cost to investigate: S; cost to fix depends what's found.
5. **VisionFlow's reachable-but-fake endpoints**: rate-limiting and request-validation config flags that silently no-op, plus three live 501 handlers (`pay_handler`, `graph_export_handler` ×2) and an `Oxigraph` repository method returning `NotImplemented`. Blast radius: anyone operating VisionFlow in production who enabled those two security-relevant flags believing they were protected is not. Cost: M — wiring the two middlewares is the highest-value single fix in this list relative to effort.

---

## Gaps in this audit (honesty about what wasn't checked)

- **VisionClaw is not checked out anywhere in `/home/devuser/workspace`.** Its red-CI root cause is inferred from `estate-health.json` and `KNOWN_ISSUES.md` only, not from reading its workflow files or recent commits. This is the single biggest hole in this report — flagging it rather than guessing.
- The recall gate did not return a fresh number in this session (see §2.3); the 2026-09-06 PASS cited is 15 days stale.
- `nostr-rust-forum`'s `Security Audit` red state was not traced to a specific advisory ID — worth a follow-up specifically because it's a crypto-crate security gate, the highest-stakes single red item in the whole table.
- The "shared upstream cause" hypothesis in top-debt #4 is a pattern observation (three repos, same night, same estate-health nightly cron window) — not confirmed by diffing the actual failing job logs, which would need `gh run view --log` access this session didn't use.
