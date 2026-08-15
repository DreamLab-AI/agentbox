# The Dream Machine as a VisionFlow-Ecosystem Capability

*Overnight, evidence-gated evolution across nominated projects, integrated via agentbox*

**Definitive investigation report — synthesis of five territory dossiers (engine-core, evidence-memory, agentbox, visionflow, container-runtime), the adversarial critique, and four load-bearing gap-fill investigations. All file-path claims are cited. UK English throughout.**

---

## 1. Executive summary

The Dream Machine (`/home/devuser/workspace/dream-machine`) is a small, honest, working TypeScript monorepo that compiles **one typed `dream.config.json` into one deterministic ~800-line nightly prompt**, tracked by a 10-column `LEDGER.md` and a hand-reproducible double-SHA256 witness stamp. It is not a running service; it is a config-compiler plus a set of pure, dependency-light libraries (`packages/{compile,schedule,ledger,witness,memory,cli}`). Today it runs against exactly one repo (itself), via either a cloud Claude Code `/schedule` routine or a research-only GitHub Actions path, and has executed exactly one real night (2026-08-13, `docs/dream-cycle/LEDGER.md`).

Turning it into "one capability across all nominated projects overnight, sharing the container's RuVector fabric" is **new orchestration work wrapping existing pure primitives**, not a rewrite. The central, verified architectural fact governing that work: **a cloud `/schedule` session runs in an Anthropic-hosted sandbox with no network path to `ruvector-postgres:5432`, Xinference (`192.168.2.132:9997`), or the Ontology Loom (`192.168.2.132:8084`)**, so the shared-memory requirement can only be met by running the orchestrator **from inside agentbox**, in the same shape as agentbox's three existing supervisord self-loops.

The adversarial critique and four gap-fill investigations materially changed three conclusions from the original synthesis, and I adopt the corrected positions here:

1. **The local-execution transport is not a downgrade — it is capability-complete and already proven in production.** The original synthesis flagged "can a headless `claude` CLI run authenticated, non-interactively, nightly?" as an unresolved, load-bearing risk that might collapse the recommendation to a Loom-only research pipeline. It is resolved **yes**: `/nix/store/…/claude-code-2.1.198/bin/claude` runs headless via `-p/--print` on a **Claude Max 20x** subscription OAuth token (`~/.claude/.credentials.json`, `~/.claude/.claude.json:3494-3512`), and is already driven unattended in this exact container by `hermes-scheduler` (38 cumulative successful runs, **zero rate-limit errors** over five days), `tab0-bridge`, and `skill-tuning`. Option B therefore delivers the full agentic pipeline locally, not just research.

2. **The nomination substrate the original synthesis recommended does not work as described.** It said "reuse `[project_tracking]`… do not invent a second project list." Verified against the live API: `GET /v1/projects` returns **only `agentbox` and `nntp-stack`** (`count:2`). The nominated sibling repos — `nostr-rust-forum`, `dreamlab-ai-website`, `knowledgeGraph`, and `dream-machine` itself — live one level under `/home/devuser/workspace/`, which is **not a scan root** (`agentbox.toml:1108` scans `/projects` and `/home/devuser/workspace/project`). The enumerator structurally cannot see them. This must be corrected by widening `scan_dirs` with a **role-based** root or a marker-file nomination convention — not by hard-coding repo names, which would violate agentbox's "reference the host by role, not name" rule (`agentbox/CLAUDE.md:56`).

3. **The recommendation does not, and cannot today, satisfy the literal brief "across ALL nominated projects."** Honest headline: what is buildable now is **a research/hypothesis + shared-memory capability, with full local evaluation for natively-testable repos and structurally shallow evaluation for VisionClaw**, whose meaningful evaluation is Docker-gated behind the host-bind trap. This is a subset rollout, not the full-mesh overnight capability, and it should be presented as such.

The memory feature is unanimously and verifiably a **stub**: `openMemory()` always returns the flat-file/keyword-overlap `FlatMemory`, even when `@ruvector/wasm` resolves (`packages/memory/src/index.ts:160-171`). "Semantic recall over prior nights" does not exist yet and must be built. The good news from gap-fill 3: the governed write path it needs (`createMemoryTools({backend:'external-pg', deps})` in `/opt/agentbox/mcp/servers/lib/memory-tools.js`) is real, is proven live under supervisord, and a new `dream-cycle` namespace is **writable headlessly today with zero governance changes**.

**Bottom line:** build a thin, container-native, supervisord-gated orchestrator that fans dream-machine's pure `compile()` output across a role-discoverable set of nominated repos, drives each with a local headless `claude` session, gates every evaluator entrypoint through `classifyEntrypointResult`, and writes a governed `dream-cycle` RuVector namespace via the proven headless writer. Scope it honestly to the subset it can actually evaluate, and treat cloud fan-out as an unverified future leg, not a one-call fallback.

---

## 2. How the Dream Machine works

### 2.1 The engine — a pure config-compiler

The unit of work is immutable and singular: **one `dream.config.json` → one deterministic prompt → one scheduled routine bound to one `git_repository` URL → one `LEDGER.md`**.

- **`compile(config)`** (`packages/compile/src/index.ts:24-55`) is 100% deterministic — no `Date.now`/`Math.random`, output built by concatenating ~20 pure section-builders joined on `\n\n` with 3+ newline collapsing. It is golden-snapshot tested (`packages/compile/src/index.test.ts:116-118`) plus structural-completeness tested that every pipeline STEP marker and load-bearing invariant string is present verbatim.
- **`DreamConfig`** (`packages/compile/src/config.ts:33-62`) is the *entire* per-repo delta: `repo` (validated `owner/name`), `cron`, `slots[]` (each a `{deep, scan}` tuple, rotated by `date % slots.length`), `bonusModuli`, `controlPlaneProbes`, `buildStep {cmd, degradeOnWasmFailure}`, `evaluatorEntrypoints {bench, flywheel, darwin, redblue}` (all optional), `adrConvention`, `competitors[]`, `extraDisciplines[]`, `ledgerPath`, `branchPrefix`, `labels[]`, `autoMerge`. Everything else — the 26-step structure, invariant wording, ledger schema, witness formula, stop conditions — is identical prompt text for every target (ADR-0001 §2.1).
- **`validateConfig`** (`config.ts:73-97`) never throws directly; `compile()` wraps its failures. Note the verified gap: `CRON_RE` (`config.ts:70,80`) only checks five whitespace-separated fields exist — the documented "minimum interval 1 hour" is **not enforced**.
- **The CLI** (`packages/cli/src/index.ts`) is a pure `run(argv, io)` dispatcher over an injectable IO (fs + exec + clock); `bin.ts` is the only place that touches the real process. This injectable seam is precisely what makes container-side, non-GitHub driving structurally easy.
- **`buildRoutine()` / `serializeRoutine()`** (`packages/schedule/src/index.ts:75-126`) emit the cloud `/schedule` `job_config.ccr` body but perform **no network call** — v1 ships as "compile then paste" (`schedule/src/index.ts:1-8`). The one hardcoded GitHub coupling is `schedule/src/index.ts:87`: `git_repository:{url: https://github.com/${config.repo}}`. There is no local-path or multi-source variant.

Crucially, everything GitHub-flavoured beyond that one line — STEP 1 ledger check, STEP 17-18 gist+issue, STEP 20-25 branch/PR — is **prompt text instructing the agent session to run `gh`**, not engine code. Running against a local tree is therefore a compile/schedule-layer templating problem, not a rewrite.

### 2.2 The evidence chain

- **Ledger** (`packages/ledger/src/index.ts:15-26`): a 10-column markdown table — `Date | Deep | Finding | Issue | PR | Evaluated? | Verdict | Effect | Witness | Prior-night fates`. `parseLedger()` tolerates malformed rows (warns, never fails); `verifyLedger()` is purely structural (header present, verdict ∈ {ACCEPT,REJECT,INCONCLUSIVE}, evaluated ∈ {yes,no,blocked}, ISO date). `learningSignals()` (`index.ts:211-247`) computes four deterministic signals over a trailing window — `zeroMergeStreak`, `duplicateDirections`, `lowScoreStreak`, `blockedEvalStreak` — as library code the prompt invokes via `dream-machine ledger signals`, not LLM prose.
- **Witness** (`packages/witness/src/index.ts:39-54`): `REPORT_HASH = sha256(raw report bytes)`; `WITNESS = sha256(REPORT_HASH_hex ‖ sessionCommit)`. `verifySteps()` emits a 5-line coreutils-only recipe so any third party can re-derive the stamp with `curl` + `sha256sum`. The 2026-08-13 report documents the self-reference discipline this forces: the stamp cannot live inside the file it stamps, so it is published in the PR/ledger referencing the frozen file by path+commit (`docs/dream-cycle/2026-08-13-security-adversarial-report.md:238-252`). That same night honestly recorded `GIST=LOCAL` because no `gh gist create` tool was available in-session.
- **Entrypoint liveness** (`packages/cli/src/entrypoint.ts:33-51`): `classifyEntrypointResult()` is a pure 3-way classifier — `blocked` (exit≠0), `suspicious-silent` (exit 0 with empty stdout+stderr — explicitly "do not record EVALUATED=yes from this alone"), `live` (exit 0 with output). Motivated by ADR-0002's empirical finding that `npx @metaharness/redblue` exits 0 with zero bytes because its ESM `import.meta.url === file://${process.argv[1]}` main-module guard breaks through npx's bin symlink. **Verified correction (see §4.4): ADR-0002's own framing that redblue is "the exact SCAN=redblue evaluator entrypoint this repo's dream.config.json declares" is inaccurate — `dream.config.json`'s `evaluatorEntrypoints` are only `{bench:'npm test', darwin:'npx @metaharness/darwin evolve'}`; `redblue`/`flywheel` appear only as SCAN-slot tokens, not on the exec path.**

Three named degradation paths produce a valid ledger row + INCONCLUSIVE verdict rather than a stop: wasm/NAPI build failure with `degradeOnWasmFailure=true` (`compile/src/index.ts:132-154`); missing model key → `LLM_EVAL=blocked` (`index.ts:149-153`, "Missing model credentials are NOT fatal"); missing `gh` auth → `FALLBACK=true` (`index.ts:165-179`). STEP 25 ledger update is the one invariant that always happens.

### 2.3 The memory layer — a stub with an honest surface

`@dream-machine/memory` is architecturally a stub. `probeRuvector()` (`packages/memory/src/index.ts:129-145`) only checks whether `@ruvector/wasm` *imports*; `openMemory({backend:'auto'})` (`153-178`) **always returns `FlatMemory`** even when the module resolves, merely tagging `_ruvectorAvailable=true`. "Recall" is `keywordScore()` (`55-61`): fraction of whitespace-split query terms found as substrings in `deep+finding+verdict+detail`.toLowerCase() — pure lexical overlap, no embedding, no HNSW, no RVF container ever built. Its own comment admits this ("until the wasm binding API is wired and tested end-to-end, we… use the deterministic backend"). `@ruvector/wasm`/`@ruvector/rvf-wasm` are declared-but-unresolved optional peers at version `*` (`packages/memory/package.json:31-40`). The `README.md:179,190` marketing of "optional semantic recall (RVF container)" **overclaims** against the shipped code.

The redeeming fact: the `DreamMemory` interface (`remember`/`recall`/`all`, `index.ts:32-37`) is small and clean, and `OpenOptions.backend` + `probeRuvector(loader)` are already an injection seam used by tests — so a new backend can satisfy the contract with zero caller changes.

---

## 3. The container and ecosystem it must inhabit

### 3.1 agentbox runtime facts (verified)

- **No OS cron.** `crontab`/`crond`/systemd-timers are absent. Every periodic job is a long-lived supervisord `[program:*]` process running its own internal sleep/`--loop`. Three are live with ~3-day uptime: `ruvector-aggregate-sweep` (priority 232), `ruvector-pattern-distill` (233), `ontology-condense-scheduler` (234) — `flake.nix:1436-1493`.
- **The house pattern** is documented explicitly in `scripts/ontology-condense-scheduler.mjs`: off-by-default env-gating baked from `agentbox.toml` via `imageEnv` (`boolGate`/`intGate`), a staleness/idempotency check before doing work, `flock`-serialised delegation to a child script, fail-open per-tick logging (never crash the loop), `--once|--loop|--dry-run` modes, and a staged `[program:X]` block in `flake.nix`.
- **Capability convention** (agentbox `CLAUDE.md` "Rules for changes", ADR-005, ADR-039): gate in `agentbox.toml`; catalogue in `management-api/lib/system-manifest.js` with an honest `apply_class` (live/boot/rebuild); ride one of the five adapter slots (beads/pods/memory/events/orchestrator) for durable state; never a standalone bolt-on.
- **Governed RuVector write path (verified in gap-fill 3).** `createMemoryTools({backend, deps})` (`/opt/agentbox/mcp/servers/lib/memory-tools.js:503-516`) — `deps` is **mandatory** (11 injected functions: `pool`, `getEmbedding`, `xinfEnsure`, `entryId`, …); `createMemoryTools({backend:'external-pg'})` alone throws. `memStore(key, value, namespace='default', options={})` embeds via Xinference and upserts into `memory_entries`. `ruvector-aggregate-sweep.mjs:249-266` constructs its own `pg.Pool`, embedding transport, and `deps` object and drives this path from a standalone Node process — the exact template a headless dream writer reuses ("no raw SQL write ever leaves this process").
- **`PROTECTED_NAMESPACES`** (`memory-tools.js:77-88`) is an **exact-string-match** Set, default `{governance-precedents}` plus `ruvnet-kb` appended at boot (`entrypoint-unified.sh:1349-1366`). A new `dream-cycle` namespace is **not protected and writable headlessly with zero config** — but exact-match means per-repo sub-namespaces would each need adding individually to gain protection later.
- **Recall gate** `./agentbox.sh ruvector recall` (`agentbox.sh:965-973` → `ruvector-recall-harness.mjs`) is read-only, non-interactive, deterministic exit code — trivially loopable. Note an **unreconciled band discrepancy**: the harness header states self ≥187/200, true ≥118/120; the container `CLAUDE.md` note says self ≥175/200, true ≥107/120; `docs/ruvector-system-reference.md:224` states the frozen no-regression band. These figures differ and were not reconciled.
- **The non-concurrent HNSW rebuild has NO existing script anywhere in the tree** (gap-fill 3, exhaustive grep). Only prose describes the manual `psql` DDL (`docs/ruvector-system-reference.md:223-230`). A dream-cycle integration must **author** `DROP INDEX` / `CREATE INDEX … USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=128)` itself, non-concurrently (`CREATE INDEX CONCURRENTLY` causes verified double-insertion on this AM).

### 3.2 Headless Claude is proven (gap-fill 1 — corrects the original synthesis)

- `claude` (Claude Code v2.1.198) is on `$PATH` with full headless surface (`-p/--print`, `--output-format stream-json`, `--allowedTools`, `--model`, `--append-system-prompt`).
- Auth is **Claude Max 20x subscription OAuth**, not an API key (`~/.claude/.credentials.json` `claudeAiOauth`, valid token; `~/.claude/.claude.json:3494-3512`: `organizationType:"claude_max"`, `organizationRateLimitTier:"default_claude_max_20x"`). **Load-bearing gotcha:** `ANTHROPIC_API_KEY` is set-but-empty in the container env, and an empty key still wins SDK/CLI credential precedence; `tab0-bridge/server.mjs:17-18,87,90` handles this by `delete CHILD_ENV.ANTHROPIC_API_KEY` before spawning `claude`. Any dream runner **must replicate that unset** or auth fails.
- Production proof: `hermes-scheduler` (`skills/hermes-scheduler/scripts/scheduler.py:439-446`) spawns `subprocess.run(["claude","--print",prompt], timeout=1800)` — live at pid 9846, two recurring daily jobs, `completed:38` each, **zero rate-limit/429/quota errors** across five days of logs; substantive multi-tool agentic reports produced. `tab0-bridge` (supervisord-managed, RUNNING) and `skill-tuning` (`claude -p`, "$0 metered") independently confirm the pattern.
- **Caveat:** `hermes-scheduler` is a manually-started Python daemon, **not** a supervisord program — it would not survive a container restart. Among always-on supervised services only `tab0-bridge` calls the LLM CLI; the three RuVector loops never invoke an LLM. A dream orchestrator that must survive restarts belongs in supervisord.
- No numeric rate-limit ceiling is documented locally; the empirical evidence bounds only ~2 agentic runs/day, not N-repo nightly concurrency. Concurrency at fleet scale is untested.

### 3.3 The ecosystem to run across (verified by `git remote -v`)

VisionFlow "Dynamic Agentic Mesh" — five running substrates plus docs canon plus corpus repo:

- **VisionClaw** = `/home/devuser/workspace/project` (DreamLab-AI/VisionClaw; Rust `cargo test` + TS `npm test`/Playwright; 117 ADRs).
- **agentbox** = `/home/devuser/workspace/project/agentbox` (submodule; `npm run validate`/`test:config`; 52 ADRs).
- **solid-pod-rs**, **nostr-rust-forum**, **dreamlab-ai-website**, **knowledgeGraph** = siblings under `/home/devuser/workspace/`.
- **VisionFlow** (`/home/devuser/workspace/VisionFlow`) is docs/website only — the wrong target for evaluator entrypoints.

**None of the six has a `dream.config.json`, `LEDGER.md`, or witness convention** — onboarding any is a from-scratch rollout.

Two structural constraints (verified via `findmnt`/`/proc/mounts` and `docker ps`):

1. **Host-bind Docker trap.** `/home/devuser/workspace/project` is a host bind mount, and this container holds the host Docker socket, so any `docker build`/compose path run in-container silently bakes stale code; `CLAUDE.md` forbids `scripts/launch.sh` here. Native `cargo test`/`npm test`/`pytest` are unaffected.
2. **The real RuVector fabric** (`ruvector-postgres`, `xinference`, `visionclaw_prod_container`) is LAN/container-internal — reachable from agentbox, **unreachable from a cloud `/schedule` sandbox**.

Name-collision warning: `mcp__agentic-qe__qe_learning_dream` (AQE spreading-activation over its own SQLite ReasoningBank, forced to `AQE_MEMORY_BACKEND=memory` in-RAM by `aqe-setup.sh:33`, with a silently-failing RuVector bridge) is an **unrelated system**. The `.agentic-qe/witness-keys/6ca7d24…` and `.agentic-qe/logs/2026-08-14.md` found inside the dream-machine repo are **fresh bootstrap artefacts of this investigation session** (timestamps match session `startedAt`, all-zero counters), not evidence of a prior AQE dream run. Do not conflate or cite them as history.

---

## 4. Recommended architecture

### 4.1 The three transports, and why Option B wins

**Option A — Cloud `/schedule` fan-out (N routines).** Compile per repo, create N routines, run in isolated cloud sandboxes with fresh GitHub checkouts. Highest raw capability, but **content leaves the LAN** and **cannot touch RuVector at all** — the shared-memory goal is structurally impossible here. Non-starter for the stated goal.

**Option B — Container-local orchestrator (RECOMMENDED).** A new supervisord loop `scripts/dream-orchestrator.mjs` modelled on the three live loops: wakes on a wall-clock nightly check, reads a `[dream_machine]` allow-list, and per nominated repo runs `dream-machine compile <cfg>`, then drives a **local headless `claude -p` session** (auth-corrected per §3.2) pointed at that repo's working tree, routes every `evaluatorEntrypoints` result through `classifyEntrypointResult`, writes the ledger row into the repo's `LEDGER.md` **and** the governed `dream-cycle` RuVector namespace, and emits a Nostr kind-30840 digest. This is the only transport that satisfies shared memory, has the strongest precedent, and — corrected by gap-fill 1 — is **capability-complete**, not a Loom-only research downgrade.

**Option C — Hybrid.** Research/hypothesis + shared-memory recall run container-local; heavy candidate-build/evaluation for a repo needing a fresh isolated checkout runs as a cloud routine. **Corrected by gap-fill 4:** this is **not one call away**. `CronCreate` is disqualified (session-scoped, in-memory, non-durable, flat-prompt — not the cloud routine mechanism at all). `RemoteTrigger` targets the right endpoint family (`/v1/code/triggers`) but is a generic pass-through that imposes **zero schema validation**, and no one has round-tripped `buildRoutine()`'s `job_config.ccr` body through it. ADR-0001's "automation waits on a confirmed API" deferral is **still genuinely open**. Scope C as "one exploratory (side-effecting) `create` call to verify the body contract, then possibly a shim, then wire-up" — future work, not a fallback in reach.

**Recommendation:** build Option B. The Ontology Loom (`http://192.168.2.132:8084/v1`, `max_tokens≥1536`) remains available as a **LAN-private research-stage backend** for privacy-sensitive repos, degrading to `LLM_EVAL=blocked` on failure exactly as `scripts/dream-nightly.mjs:46-93` does for OpenRouter — but it is not the primary engine, because local `claude` is both more capable (workspace `CLAUDE.md` notes Muse is weak at agentic tool-traversal) and proven.

### 4.2 Corrected nomination model (adopts critic + gap-fill 2)

The original synthesis's "reuse `[project_tracking]`, don't invent a second list" is **wrong as stated** and is retracted. Verified: `GET /v1/projects` returns `count:2` (agentbox, nntp-stack); `_discoverRepos` (`management-api/lib/project-tracker.js:307-326`) is one-level-deep under `scan_dirs = ["/projects", "/home/devuser/workspace/project"]` (`agentbox.toml:1108`), `/projects` is empty, and the four nominated siblings under `/home/devuser/workspace/` are never seen. An allow-list cannot reference repos the enumerator never discovers.

Corrected design, preserving the "role not name" rule (`agentbox/CLAUDE.md:56`, and the by-role idiom already practised at `project-tracker.js:51-61`):

- **Do not** hard-code `nostr-rust-forum`/`dreamlab-ai-website`/etc. in `agentbox.toml` or agentbox code — that is exactly the host-project-specifics the rule forbids (grep confirms zero such names exist in agentbox today).
- **Preferred:** a **marker-file convention** — each nominated repo drops its own `dream.config.json` (or a `.agentbox-nominate` marker) into its own directory in the host tree, discovered generically. The specific repo identities then live in the host tree (outside agentbox), and agentbox only ever discovers-by-role. This also keeps per-repo delta co-located with the repo that owns it and preserves `compile()`'s per-config golden-snapshot guarantee.
- **Enumeration fix:** add `/home/devuser/workspace` as a **third role-based `scan_dirs` root** ("the workspace root"). Caveat (gap-fill 2): that directory has ~150 entries, so discovery must then filter to repos carrying the nomination marker — over-inclusion is a scoping problem, not a rule violation.

### 4.3 Honest scope (adopts critic problems 2 & 3)

State plainly: **this build does not satisfy the literal brief "across ALL nominated projects overnight."** What it delivers:

- **Full local evaluation** for repos whose evaluation is native-testable (agentbox `npm run validate`; solid-pod-rs `scripts/test-all.sh`; nostr-rust-forum `cargo test`; dreamlab-ai-website vitest/Playwright; knowledgeGraph `pytest` + Rust) — once they are discoverable and each has authored a `dream.config.json`.
- **Structurally shallow evaluation for VisionClaw**, the flagship. Its meaningful evaluation is Docker-gated behind the host-bind trap; container-side nights can only run native `cargo`/`npm` tests, so any candidate needing a container rebuild cannot be assessed autonomously (`launch.sh` forbidden here; host-tmux dispatch is semi-interactive and unfit for an unattended night). **Consequence, followed through per the critic:** VisionClaw's ACCEPT/REJECT verdicts are systematically under-powered and most VisionClaw nights degrade toward INCONCLUSIVE — close to the GitHub-Actions research-only path this design otherwise improves on.

Recommended posture: ship with a **narrow, explicitly-scoped initial roster** (agentbox + the natively-testable siblings), treat VisionClaw as research/hypothesis + native-test-only, and defer container-rebuild-dependent evaluation as out of scope for autonomous nights. Frame this as the real deliverable, not as "phasing."

### 4.4 Corrected entrypoint-gate motivation (adopts critic problem 4)

The `classifyEntrypointResult` gate is **still non-optional** for a cross-project orchestrator — heterogeneous `cargo`/`npm`/`pytest`/custom entrypoints multiply the exit-0-and-silent surface, and the classifier is a standalone diagnostic (`verify-entrypoint`) that is **not auto-wired** into the compiled prompt's execution path (ADR-0002 §3). The orchestrator's delegate child is exactly where that wiring must be added. But the *specific* motivation must be corrected: `redblue` is **not** on this repo's exec path (`dream.config.json` declares only `bench`/`darwin`), so the silent-no-op is a general risk demonstrated in one tool, not a live hole in the repo's own configured entrypoints.

### 4.5 Sequencing and scheduling

Run **sequentially, one repo per cycle**: it bounds RuVector write churn (one post-cycle HNSW rebuild + recall-gate check rather than churn-driven degradation, which has been observed dropping 188/200 → 141/200), any host-tmux build step is inherently serial anyway, and a per-repo `flock` + date-stamped completion marker lets a crashed cycle resume at the next unfinished repo. Scheduling is the one genuine adaptation of the house pattern: the three live loops fire every N minutes with jitter, whereas Dream Machine needs once-nightly — solved by a wall-clock-hour gate + completion marker, not a new primitive. Do **not** revive `hermes-scheduler` for this (unsupervised, restart-fragile); use a supervisord program.

---

## 5. Memory unification design

**Add a new backend, `ruvector-mcp`** (deliberately not `ruvector-rvf`, to avoid conflation with the wasm stub), satisfying `DreamMemory` (`remember`/`recall`/`all`) with **zero changes to any dream-machine caller**. Inject it via the existing `OpenOptions.backend` + `probeRuvector(loader)` seam; leave the upstream `ruvector-rvf` wasm path stubbed and untouched. The backend lives in agentbox, not committed upstream.

**Write path (verified real in gap-fill 3):** import `/opt/agentbox/mcp/servers/lib/memory-tools.js`, construct the mandatory `deps` object exactly as `ruvector-aggregate-sweep.mjs:249-266` does (own `pg.Pool`, own Xinference embedding transport, `entryId`, etc.), and call `createMemoryTools({backend:'external-pg', deps}).memStore(key, value, namespace, options)`. **Never** the raw MCP stdio client and **never** raw SQL — both bypass the bge-small-en-v1.5 embedding pipeline and are invisible to HNSW (rule repeated across all three `CLAUDE.md` tiers). This yields real embeddings, HNSW visibility, and memory-cloud-visualiser exposure for free.

**Namespace design:** a single family `dream-cycle`, with per-project scoping in **metadata, not separate namespaces**:
- Store `namespace:"dream-cycle"` with typed metadata `{ repo:"<owner>/<name>", date, deep, scan, verdict, evaluated, witness, source:"local-claude"|"local-loom"|"cloud" }`.
- Cross-project recall uses plain `memory_search` within `dream-cycle`; global `namespace:"*"` remains available for mesh-wide queries.
- **`source` is load-bearing:** always-INCONCLUSIVE research rows must be distinguishable from real evaluated nights, or cross-project learning signals (`zeroMergeStreak`, `blockedEvalStreak`) are polluted. This directly guards the flagship's shallow-evaluation problem (§4.3) from silently corrupting aggregates.

**Governance (verified):** `dream-cycle` is not in `PROTECTED_NAMESPACES` and is writable headlessly today with no config change (`memory-tools.js:77-88`). Because the guard is exact-match, if per-repo sub-namespaces are later introduced, each needs adding individually to gain protection — there is no prefix/family guard.

**Index-law compliance:** bounded inserts per cycle; after each full cycle run the non-concurrent HNSW rebuild and gate on `./agentbox.sh ruvector recall`. **This rebuild must be newly authored** — gap-fill 3 confirmed no script exists; only manual `psql` DDL prose. The orchestrator owns this DDL (`DROP INDEX` / `CREATE INDEX … USING hnsw … WITH (m=16, ef_construction=128)`, non-concurrent) as a budgeted per-cycle step, plus a decision on which recall band to gate against (§3.1 discrepancy — flag to the human).

**Poisoning guard:** one repo's speculative hypothesis must be stored as *that repo's* metadata-scoped hypothesis, never an unqualified global claim another repo's night could recall as fact. ADR-051 D4's namespace-scoped, first-write-wins, sig-verify-before-clamp conventions are the design template — but ADR-051 is `status: proposed`, so use its *shapes*, not its (unbuilt) tools.

---

## 6. Evidence and governance alignment

**Ledger placement:** keep the per-repo `LEDGER.md` as the canonical, git-committed, human-readable record (the schema is per-file and dependency-free). Add a **read-only federated aggregator**, not a second source of truth: parse each nominated repo's `LEDGER.md` with the existing `parseLedger`/`learningSignals` library (zero library changes) plus the `dream-cycle` RuVector namespace for semantic cross-project recall. Two firm rules from evidence-memory: `docs/site/data/ledger.json` is an **explicitly-labelled sample** with a *different* schema and must never be treated as the ledger format; and there is **no** `LEDGER.md → ledger.json` generator in `scripts/` — a shared dashboard needs a new exporter authored.

**Three witness vocabularies — keep separate:**
1. **Dream Machine witness** (`packages/witness/src/index.ts`): `sha256(sha256(report)‖commit)` — the correct per-report stamp; keep the self-reference discipline.
2. **agentbox events-adapter hash-chain** (`management-api/lib/audit-chain.js`, ADR-039): `SHA256(prev_hash‖canonical_json)` — a *sequence* tamper-evidence primitive. Recommended **complement**: emit one events-adapter record per night so the cycle inherits agentbox's chain-of-custody, while the double-SHA256 stamp stays the intra-report proof.
3. **AQE `.agentic-qe/witness-keys`** (`dist/audit/witness-key-manager.js`): unrelated fleet crypto-signing. **Do not name the agentbox integration "witness"** without disambiguation.

**"Evaluation is not promotion"** (`dream.config.json:66` `extraDisciplines`) maps onto agentbox's model as: the nightly loop *evaluates*; *promotion* (merging a candidate) is a separate, gated action by a different actor. Verified split: this repo's `dream.config.json:75` sets `autoMerge:true` while `withDefaults()` defaults it `false`; auto-merge is a label-gated **CI job** (`.github/workflows/automerge.yml`), never the agentic session. **Firm rule for the generalisation:** the fleet capability **forces `autoMerge:false`** for every nominated repo regardless of its own config, so cross-project nights can never trigger an unattended merge. Any guarded auto-merge stays a per-repo CI decision made outside the fleet capability. For v1, GitHub's native draft-PR + human-merge suffices; do **not** over-couple to agentbox's forum-broker approval flow (kind-31402/31403), which is designed for ontology proposals, not generic draft PRs, and would need explicit mapping.

---

## 7. Concrete agentbox modification surface (no code yet)

**Add:**
- `scripts/dream-orchestrator.mjs` — supervisord self-loop on the house pattern (`boolGate`/`intGate` from `agentbox.toml` via `imageEnv`; date-stamped completion marker; `flock`; fail-open; `--once|--loop|--dry-run`), with a **wall-clock nightly gate** (the one adaptation).
- A delegate "do-the-work" child (analogous to `ontology-condense-scheduler.mjs` → `ontology-condense-refresh.sh`) that per repo: runs `dream-machine compile`, spawns a headless `claude -p` session **with `ANTHROPIC_API_KEY` deleted from the child env** (per §3.2), routes each entrypoint through `classifyEntrypointResult`, and writes ledger + RuVector.
- A **`ruvector-mcp` backend module** for `DreamMemory`, wrapping `createMemoryTools({backend:'external-pg', deps})` with the `deps` construction copied from `ruvector-aggregate-sweep.mjs`.
- A **new HNSW-rebuild script + recall-gate invocation** (neither exists today) run once per completed cycle.
- One nomination marker / `dream.config.json` authored per nominated repo, dropped into each repo's own directory.
- A thin **`dream-machine` skill** (`/opt/agentbox/skills/`) as router/status/trigger surface only — the engine lives in the supervisord layer, not the skill layer.
- Optionally a `LEDGER.md → ledger.json` exporter and a `management-api` `dream` route (list nominated repos, run status, last verdict).

**Touch:**
- `agentbox.toml` — new `[dream_machine]` section: `enabled=false` (byte-identical-when-off, the `[memory_learning]` block is the template), nightly wall-clock trigger, **role-based nomination root/marker convention**, `force_automerge_off=true`, optional Loom endpoint + `max_tokens`.
- `agentbox.toml:1108` `scan_dirs` — add `/home/devuser/workspace` as a third **role-based** root (with marker-file filtering to avoid the ~150-entry over-inclusion).
- `flake.nix` — a `[program:dream-machine-nightly]` block at priority ~235 next to the three loops (`flake.nix:1436-1493`); gate **both** the Nix package set and the supervisor block.
- `management-api/lib/system-manifest.js` — a CATALOGUE entry (`id`, gate path `[dream_machine].enabled`, `layer:'module'`, `service:'dream-machine-nightly'`, honest `apply_class` — `boot` daemon, `rebuild` if a new Nix package is needed).

**Do NOT touch:** dream-machine's `packages/*` (consumed as-is via `run(argv, io)` and the `DreamMemory`/`probeRuvector` injection seams); the `ruvector-rvf` wasm stub (leave stubbed).

---

## 8. Safety invariants and risks

### Invariants that must survive generalisation
- **Never merge from the session; draft PRs only.** Enforce `force_automerge_off` at the fleet layer so no per-repo `autoMerge:true` leaks into unattended runs.
- **Never weaken tests / never fabricate results.** Every project's entrypoint routed through `classifyEntrypointResult` before `EVALUATED=yes` (exit-0-and-silent ≠ clean pass). Wire the classifier into the delegate child — the engine does not do it.
- **Honest INCONCLUSIVE is a valid night.** The three degrade paths (wasm build failure, `LLM_EVAL=blocked`, `FALLBACK=true`) stay first-class; the loop records and advances, never crashes the cycle.
- **RuVector governance:** governed-writer path only; per-cycle non-concurrent HNSW rebuild; recall-gate pass required.

### New risks the cross-project form introduces
- **Host-bind Docker trap (load-bearing).** VisionClaw and any Docker-dependent repo default to native test entrypoints only; container-rebuild-dependent evaluation is out of scope for autonomous nights. This is the strongest argument for the narrow roster and for honest scope framing (§4.3).
- **Cross-project memory poisoning.** Metadata-scoped storage (`repo`, `source`, verdict) mandatory; INCONCLUSIVE research rows distinguished from evaluated rows in every aggregate signal.
- **FlatMemory has no per-repo namespacing** — the `ruvector-mcp` backend must enforce metadata scoping; never point multiple repos at one flat file.
- **Command-injection surface** (flagged by the repo's own security night): `evaluatorEntrypoints` strings flow into `child_process.exec` (shell:true). Safe today because commands are human-typed; an unattended orchestrator auto-feeding config strings is exactly the shape that turns this latent risk live. Treat config as trusted, git-committed, reviewed input — never pipeline-mutable — and prefer an argv-array exec path over a shell string.
- **Credential/rate ceiling unbounded at scale.** Empirical evidence bounds ~2 agentic `claude` runs/day with zero rate-limit errors; N-repo nightly concurrency on the Max 20x tier is untested and undocumented numerically. Sequential execution (§4.5) mitigates but does not eliminate this.
- **Building on unlanded ADRs.** ADR-051 D2-D7 (submit/await/fetch, RuVector rendezvous, janitor/reaper) is `status: proposed` — use its shapes as precedent, not its tools; verify implementation state in `mcp/servers/ontology-bridge.js` / `management-api/adapters/beads/local-sqlite.js` before depending on anything.
- **Stale in-repo documentation.** `ruvector-aggregate-sweep.mjs`'s own header claims it is not a supervisord program, yet `supervisord.conf:122-131` runs it `autostart=true` — code/doc comments in this tree lag the deployed image. Verify against live config, not comments.

---

## 9. Open questions for the human

1. **Scope decision (blocking).** Accept the honest narrow deliverable — research/hypothesis + shared memory + full local evaluation for natively-testable repos, with VisionClaw limited to native-test/research-only — or insist on full-mesh evaluation, which requires solving the host-bind Docker trap (a host-tmux dispatch mechanism no autonomous night can currently drive safely)?

2. **Which repos are actually nominated?** The brief names the whole mesh, but the container edits/builds only `project/` (VisionClaw) and `project/agentbox`. Confirm whether solid-pod-rs / nostr-rust-forum / dreamlab-ai-website / knowledgeGraph are in the initial roster (each needs a from-scratch `dream.config.json` + marker).

3. **Nomination convention.** Approve the role-based approach (widen `scan_dirs` to `/home/devuser/workspace` + per-repo marker file), or specify a different registry that avoids hard-coding host-project names in agentbox (which the "role not name" rule forbids)?

4. **Recall-gate band.** Which of the three differing recall bands governs the post-cycle gate — harness header (self ≥187/200, true ≥118/120), container `CLAUDE.md` note (≥175/≥107), or the reference doc's frozen band? These are unreconciled.

5. **Concurrency/rate budget.** Is sequential once-nightly execution across the roster acceptable, or is parallelism wanted? The latter needs a Max 20x rate-ceiling load test that does not exist yet.

6. **Cloud evaluation leg (Option C).** Authorise a single side-effecting exploratory `RemoteTrigger create` call to verify whether `/v1/code/triggers` accepts `buildRoutine()`'s `job_config.ccr` body? Until then, ADR-0001's "automation waits on a confirmed API" deferral stands and Option C remains unverified future work.

7. **AQE integration.** Leave `qe_learning_dream` / ReasoningBank out of scope (recommended), or invest in fixing `AQE_MEMORY_BACKEND=memory` and the silently-failing `shared-rvf-dual-writer` bridge to feed candidate heuristics into the hypothesis stage later?

8. **Ledger/verdict physical home.** Per-repo `LEDGER.md` in each nominated repo (status quo, recommended) plus the `dream-cycle` RuVector aggregate — or a centralised agentbox-owned adapter-backed surface (which risks the "no host-project specifics in agentbox" rule)?

---

*Prepared as the definitive merge of the research dossier, the original synthesis, the adversarial critique, and the four gap-fill investigations. Where the critique invalidated the original synthesis — the nomination substrate, the "full-mesh" scope claim, VisionClaw's evaluation depth, the ADR-0002 entrypoint framing, and the over-elevation of `RemoteTrigger` — the corrected positions above supersede it, and where the gap-fills resolved load-bearing unknowns — headless `claude` viability, the governed write path, `PROTECTED_NAMESPACES`, and the cloud-trigger body contract — those findings are adopted as the current ground truth.*

---

## 10. Sovereign substrate adaptation — beads, blocktrails, Solid pods

*(Operator-directed extension: "we can adapt this model to our beads, blocktrails, solid pods etc." Findings from a dedicated substrate research pass, file:line cited.)*

The dream-machine's evidence chain is GitHub-shaped today (gist + issue + draft PR + `LEDGER.md` row), but each artefact has a sovereign counterpart in the DreamLab substrate. The witness stamp is the portable part: `sha256(sha256(report)‖commit)` is a pure hash commitment that embeds unmodified into every substrate below — **adapter work, not redesign**. The publisher layer, not the engine, is where adaptation happens; a night can emit GitHub artefacts for public repos and sovereign artefacts for private ones, selected per `dream.config`.

### 10.1 Beads — two unrelated systems share the name

- **VisionClaw Nostr provenance bead (the relevant one):** `src/services/nostr_bead_publisher.rs:75` publishes NIP-33 parameterised-replaceable events, `Kind::Custom(30001)`, `d`-tag = bead_id, signed by the single bridge-bot key `VISIONCLAW_NOSTR_PRIVKEY`, fire-and-forget to `NOSTR_RELAY_URL`. The ~90-line publisher is directly copyable for a **dream verdict bead** (new event kind; tags `{witness, verdict, commit, issue_ref, pr_ref, repo}`). **Liveness caveat:** the Oxigraph persistence path is a literal `todo!()` (`nostr_bead_publisher.rs:15,125`) and ADR-034's `BeadStore`/lifecycle FSM is stale design prose (Neo4j removed per ADR-132; no `.rs` implementation exists) — beads currently land on a relay with **no queryable durable store**, so a verdict bead must be paired with a pod write or git-mark to be more than a broadcast.
- **agentbox work-ledger beads** (`management-api/routes/beads.js`, `urn:agentbox:bead:` URNs over the `local-sqlite` adapter): a task tracker, not provenance. Correct use: **an ACCEPT verdict mints a follow-up work bead** for the human's implementation queue. Runtime liveness of the `local-sqlite` flip is REBUILD-class and unconfirmed.

### 10.2 Blocktrails — mirror the ledger at the git-mark tier

The real mechanism is solid-pod-rs's two-tier provenance (ADR-059, shipped): **git-marks** (every pod LDP write becomes a git commit; `ProvenanceMark.agent_did` carries `did:nostr:<hex>`; `provenance.rs:45-62,435-548`) plus an opt-in **Bitcoin BIP-341 taproot anchor** batching commits under an epoch Merkle root. VisionClaw's ADR-128 web-contract stack (`src/web_contract/trail.rs`: `GitMark`, `Blocktrails.states[]`/`txo[]`) is a heavier financial-contract projection — scaffolding with passing envelope tests, engine wiring still to build.

**Mapping:** `states[]` = ordered commit SHAs is structurally identical to "one ledger row per night bound to a session commit". The dream-machine's ledger is append-only by convention only — no hash-chaining between rows; a git-mark chain adds exactly that missing property. **Recommendation: mirror, don't replace** — `LEDGER.md` stays the human/dashboard view; each appended row also lands as a git-mark on the dream pod, making every night hash-linked to its predecessor. Skip the Bitcoin anchor tier for research verdicts.

**Liveness — corrected by live verification on the running instance (2026-08-14):** the "git feature off in default builds" caveat (ADR-059:44-58) applies to *upstream solid-pod-rs defaults only* — **agentbox's packaging (`lib/solid-pod-rs.nix`) already includes `"git"` in `defaultFeatures`**, and the tier is compiled in and running (supervisord `solid-pod`, solid-pod-rs-server 0.5.0-alpha.3, ~3 days uptime). What was actually broken: a **pod-directory naming mismatch** — `pod_repo_path()` expects raw 64-hex pubkey directory names, but `sovereign-bootstrap.py:383` provisions pods under the bech32 npub (contradicting its own ADR-013 hex-canonical comment two lines below), so `_prov` returned 501 on every real pod. Live-fixed (reversible, no rebuild) via a hex→npub symlink for the agentbox-core pod; `GET /{hex}/_prov/{sha}` now serves real ADR-124 gitmark/blocktrails history that existed but was unreachable. Outstanding: (a) the permanent naming fix in `sovereign-bootstrap.py` needs proper review — git-http-backend routing depends on npub-keyed paths elsewhere; (b) evidence suggests the **automatic git-mark-on-write hook has likely never fired on ordinary LDP writes** on this instance (0 commits on the hex-named pods, no `.prov.ttl` sidecars; the one pod with history got it from scripted tooling) — a smoke test is required before the dream-cycle ledger mirror relies on it; (c) two legacy pods decode to malformed 128-hex (SEC1) keys, deliberately untouched. The pod-wide `_prov` enumeration endpoint remains specified-but-unbuilt (point-lookup by known SHA only). Separately, the stale JSS upstream in VisionClaw's `nginx.conf` (`upstream jss { server jss:3030; }` + 3 proxy_pass to a nonexistent container) was rewritten to the `backend` `/api/solid/*` pattern — **pending host-side `./scripts/launch.sh rebuild dev` verification**, which cannot run from inside this container.

### 10.3 Solid pods — evidence custody

The live architecture is solid-pod-rs **embedded in the agentbox container** (supervisord `[solid-pod]`, built via `lib/solid-pod-rs.nix`; nginx proxies `/solid/`+`/pods/`; `docker-compose.solid-pods.yml` is only a Cloudflare tunnel, not the server). Auth is NIP-98 (Nostr HTTP-signed requests) over `did:nostr`, WAC default-deny. The frozen-but-clean ADR-096 template (agent writes under its own `did:nostr` with a mandate-scoped WAC grant, never the operator's key) is the pattern to imitate: nightly evidence bundles at `/dream-cycle/<date>-<commit>.jsonld` (report + receipts + witness), keeping evidence for private repos entirely on-LAN instead of on a public gist.

### 10.4 Identity — the actual gap

The ecosystem's identity primitive is `did:nostr` (secp256k1 Schnorr); Solid-pod provisioning separately uses ed25519. The dream-machine's witness is an **unsigned content hash with no authorship binding**, and the `.agentic-qe/witness-keys` ed25519 pair in the repo is unused session scaffolding referenced by nothing. **The natural adapter: mint the dream-machine capability its own `did:nostr` key**; it signs verdict beads, authors git-marks, and authenticates NIP-98 pod writes — one identity across all three substrates. The double-sha256 witness remains the intra-report proof; the Schnorr signature adds "who produced it".

### 10.5 Substrate liveness ledger (what is real today)

| Substrate piece | Status |
|---|---|
| kind-30001 bead publisher | Live code, relay-only, no durable store (`todo!()`) |
| ADR-034 bead lifecycle | Stale prose, no implementation |
| git-mark provenance | **Compiled-in and RUNNING in agentbox** (nix `defaultFeatures` includes `git`); `_prov` reachable after hex/npub symlink fix; on-write hook liveness **unverified — smoke test needed** |
| Bitcoin anchor tier | Shipped, opt-in, unnecessary for verdicts |
| ADR-128 web-contract blocktrails | Envelope types + tests only; engine unbuilt |
| solid-pod-rs embedded server | Live (supervisord) |
| ADR-095/096 session-summary + pod persistence | Deferred/frozen 2026-07-03 — template, not wired path |
| `_prov` pod-wide enumeration | Specified, unbuilt |
| IS-Envelope (ADR-075) | Archived, superseded — do not build on |

---

## 11. The rewind timeline — a dream observatory

*(Operator-directed extension: the docBox / co-created browser interface for rewinding along a change timeline "wraps in too". Findings from a dedicated timeline research pass.)*

### 11.1 What exists to reuse

- **The scrubber (docBox `app/src/features/visualiser/VisualiserTab.tsx` + `layout.ts`, ported byte-identical into co-created):** canvas timeline, draggable play cursor (solid marks ≤ cursor, 16%-opacity ahead), arbitrary jump via range-slider or axis drag, group-by swimlanes, density strip, click-a-mark detail panel with agent lineage. **`layout.ts` is pure framework-agnostic TypeScript** (`computeLayout`, `buildLanes`, `timeToX`/`xToTime`, `densityBins`) — directly liftable with a new lane key and mark colour.
- **The restore-point rail (`SnapshotsSection.tsx`, DDD-002):** vertical keyframe timeline with "roll back to here", under the invariant that *audit trail and user data sit outside rollback scope by partition* — "a self-modifying overhaul cannot modify its own undo button".
- **The co-created evolution is server-side, UI-less:** the SCR **bracket** (`control-plane/src/scr/bracket.ts:46-54`) makes a restore point a *hard precondition* — a row cannot enter IMPLEMENTING without `restorePointRef` set — with append-only, never-erased `failures[]` history (`types.ts:32-45`) and control-plane-run regression fingerprinting (`verify.ts`). **The rich rewind data model has no browser UI in either donor project.**

### 11.2 The wrap-in

The dream ledger is the ideal scrubber substrate: append-only, branchless, one witnessed keyframe per night. The current dashboard (`docs/site/dashboard.html`) is a flat filterable table; `docs/site/app.js` is unrelated marketing-site animation. The lift:

- Time axis = night sequence (one discrete tick per date, per-night column index rather than ms).
- **Swimlanes = group-by repo** — many nominated projects, one time axis: the cross-project dream observatory.
- Marks coloured by verdict (the dashboard's 3-way ACCEPT/REJECT/INCONCLUSIVE colour vocabulary already exists).
- Scrub to night K = "what was known as of K" (solid ≤ K, dimmed after) — a direct lift of the `cursorTs` mechanics.
- Detail panel per night: hypothesis, finding, evidence links, witness hash + a "verify witness" affordance (the 5-step coreutils recipe).
- The vertical rail as a complementary witness-chain integrity view — each night is already a verified checkpoint; with the §10.2 git-mark mirror, every rewind point becomes independently hash-verifiable.
- The ledger's **"Prior-night fates" column is the embryonic `failures[]`** — the scrubber expands it into a first-class, never-erased attempt history per surface.

Data feed: the report's §6 exporter (`LEDGER.md → ledger.json`, currently nonexistent) becomes the observatory's data contract — extended to a federated multi-repo form.

### 11.3 The conceptual closure

"Rewind" against the dream ledger is *inspection*, not state restoration — the dream-machine keeps no per-night restorable checkpoint of target repos. If the orchestrator adopts the **bracket discipline** for any night that produces a candidate change (no write without a pre-existing restore point; rollback recorded, never erased), rewind gains operational teeth repo-side. The bracket's precondition is the operational twin of the dream-machine's own gate: **"no write without a restore point" is to state what "evaluation is not promotion" is to authority.**

---

## 12. Lineage and adjacent dream systems (ruvnet-kb corpus findings)

- **`@metaharness/darwin`** (the `evaluatorEntrypoints.darwin` backend): bounded population-based harness evolution over seven approved mutation surfaces, frozen scorer, archive-as-tree; ADR-087 wires an opt-in statistically-gated benchmark promotion (`evaluateChildAgainstParent`, hash-pinned anti-tamper suites) — "the model proposes nothing here; the harness mutates, the benchmark judges, the archive remembers."
- **`@metaharness/flywheel`** ADR-235: independent re-executing verifiers and the honest-null replay fix — a 0-promotion run is a valid, replayable outcome. Philosophically identical to "a rejected hypothesis with a clean measurement is a successful night".
- **agentic-qe's Dream Engine** (ADR-021/046/069/094) is an unrelated-but-instructive sibling *in this very container*: kernel-side dream scheduling (hooks-as-producers boundary, "hook subprocesses must not exceed ~100ms"), and ADR-069's RVCOW reversible dream branches (dream on an isolated snapshot, validate before merge, discard free on failure) — prior art for both the orchestrator's process boundary and any future speculative-night design.
- **QE→Darwin fitness adapter** (`agentic-qe/src/integrations/darwin/qe-fitness.ts`): folds objective QE metrics (mutation kill-rate, coverage, suite cost) into Darwin's ScoreCard — a ready-made bridge if nominated projects want QE-grade fitness in the evolution stage.
- Corpus note: ruvnet-kb was reconciled v3.3.1 → **v4.0.36** (62 repos) during this investigation. **dream-machine itself is not in the upstream corpus** — agents must read the local checkout, not trust an empty corpus search.

---

## 13. Session operational findings (fixed in the working tree during this investigation)

Three defects of the exact species ADR-0002 names (documented capability, dead execution path), found by *using* the container's own capabilities:

1. `agentbox.sh` argument-parser whitelist was missing `ruvnet-brain` — the command existed in the dispatcher and help text but was unreachable. Fixed (whitelist line).
2. The baked image's `ruvnet-brain-ingest.mjs` stages to read-only `/var/lib` (its repo copy documents this trap but the image lags); wrapper now pins `RUVNET_BRAIN_STAGING`.
3. The repo default staging (`~/.cache`) is a full 256 MB tmpfs in this deployment — can never hold the ~512 MB corpus. Staging re-pointed to the workspace volume (567 GB free).

These strengthen the report's §4.4 position: the orchestrator's `controlPlaneProbes` per nominated project should include agentbox's own capability commands, so liveness rot is caught by the nightly cycle rather than by a human tripping over it.

### 13.1 Substrate implementation pass (operator-directed, same session — exact change record)

A parallel session, operator-instructed, applied the minimal fixes its §10 research identified. Confirmed **not** rebuild-class — `lib/solid-pod-rs.nix` and `flake.nix` untouched (the `git` feature was already in `defaultFeatures`, `lib/solid-pod-rs.nix:105`):

1. **`project/nginx.conf`** (VisionClaw side, used by `Dockerfile.unified`/`Dockerfile.production`): removed the stale `upstream jss { server jss:3030; }` block (nonexistent container) and rewrote the `/solid/`, `/solid/.notifications`, `/pods/` `proxy_pass` targets from `http://jss/...` to `http://backend/api/solid/...`, matching `nginx.production.conf`/`nginx.dev.conf`. **Unverified in-container** (no nginx binary) — requires the host tmux `./scripts/launch.sh rebuild dev` pass.
2. **Live filesystem fix (data volume, reversible, restart-surviving):** symlink `/var/lib/solid/11ed64…663c → pods/npub1z8kkg…a88` (bech32-decoded, hex verified), unblocking `GET /{hex}/_prov/{sha}` → 200 with real provenance JSON (previously 501 on every real pod).
3. **Deliberately not patched:** `sovereign-bootstrap.py:383` npub-vs-hex pod naming (the root cause) — `[sovereign_mesh.git] http_route_prefix` and git-http-backend routing depend on npub-keyed paths elsewhere; needs a reviewed permanent fix, not a live edit. `docker-compose.solid-pods.yml` left as-is (correctly tunnel-only; misleading filename noted).
4. **Git-mark smoke test: 403 → 201** (continued session). Two issues resolved:
   - URL path must use **hex pubkey** (the top-level symlink), not npub (no top-level npub entry exists).
   - **ACL walk bug in `find_effective_acl_dyn`** (`solid-pod-rs-server/src/lib.rs:1582`): the walk probes `/{path}.acl` at each ancestor, but the Solid convention puts a container's ACL at `/{container}/.acl` (inside the directory). The walk strips trailing slashes, so it produces `/{container}.acl` (sidecar adjacent to the directory) — a different filesystem path. For the hex-symlink pod, this means the walk never finds the pod-root `.acl`, `acl_doc` is `None`, and the evaluator defaults to deny. **Workaround:** sidecar ACL copy at `/var/lib/solid/{hex}.acl` alongside the symlink. **Proper fix:** `find_effective_acl_dyn` should also probe `{path}/.acl` (container-child convention) at each walk step.
