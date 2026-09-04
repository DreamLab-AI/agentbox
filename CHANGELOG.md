# Changelog

All notable changes to agentbox are documented here. Format inspired by [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Dates are ISO-8601.

## [Unreleased]

### Changed (2026-09-04 upstream upgrade assessment)

- Default general-purpose Gemini paths to `gemini-3.8-flash`; project consultant model selection from the manifest at boot and preserve operator choices through TUI saves. Align API-equivalent tariff estimates with the published introductory period.
- Tighten Rust daemon identification to argv boundaries and reject invalid registry PIDs. Make the missing-provider scheduler test hermetic.
- Register the Spark scene integration skill for Claude Code and Codex. Document Utopia/NEEDLE fit and defer TimesFM production integration pending rights and monitor-history evaluation.
- Add the [assessment and rebuild handoff](docs/reference/upgrades-2026-09.md), ledger records ADR-2031 (consultant model projection and dated tariffs) and ADR-2032 (argv-boundary daemon identification), and the matching GOVERNANCE-capabilities / BASELINE-container invariants.

### Fixed (2026-09-04 post-rebuild check round)

- **Codex Code Mode failed closed because its host executable was absent.** The
  Nix derivation downloaded the legacy single-binary release archive, but Codex
  0.153 resolves `codex-code-mode-host` beside its own executable. It now uses
  OpenAI's canonical `codex-package-<target>` archive and preserves the complete
  package layout (host, ripgrep, bubblewrap, zsh, and metadata). The updater
  validates that layout for both Linux architectures, and the CLI smoke test
  now fails if the host is missing or cannot start its help path.
- **Ontology telemetry fell back to `/tmp` in the read-only runtime image.** A
  dedicated persistent volume now backs `/var/lib/agentbox/telemetry`, and
  bootstrap applies the same root ownership contract used by event and
  consultation logs.
- **All four consultant MCP servers failed to start after the rebuild** (`Cannot
  find module '../../../management-api/lib/uris.js'`). `consultant-base.js` used
  one relative path that only held in the repo layout; the image copies the
  consultants npm closure one level deeper (`mcp/consultants/package/`). The
  base now resolves `management-api/lib/uris.js` and
  `mcp/servers/lib/ontology-retrieval.js` against the repo layout, the packaged
  layout, then `AGENTBOX_APP_ROOT` (default `/opt/agentbox`).
- **`code-interpreter` MCP died at startup** ("wheelhouse directory not found").
  The wheelhouse is a Nix store path and nothing ever placed it under
  `/var/lib/agentbox`. `AGENTBOX_KERNEL_WHEELHOUSE` now points at the store
  path directly (only when `[skills.code_interpreter]` is enabled), and
  `mcp.json` reads that variable instead of the never-set `KERNEL_WHEELHOUSE`.
- **`codebase-memory-mcp` could not run**: since 0.7 the npm package is a
  launcher whose postinstall downloads the Go binary into its own tree on first
  run, which fails inside the read-only store. The flake now prefetches the
  static `-portable` Linux release (sha256 from the upstream `checksums.txt`,
  x86_64 + aarch64) and plants it via a new `extraFiles` hook in
  `lib/npm-cli.nix`.
- **`su` and `runuser` were both absent from the image**, so three boot steps
  failed silently: the ontology PUSH cache refresh, the ADR-041 model-routing
  projection, and every registry plugin install (`@claude-flow/security`,
  `@claude-flow/neural` — hence `claude-flow doctor`'s "AIDefence not
  loadable"). `util-linux` joins `basePackages` and the entrypoint routes all
  privilege drops through one `run_as_devuser` helper (runuser → setpriv → su,
  loud error otherwise). `gnutar` is added too — `tar` was missing from the
  runtime PATH.
- CHANGELOG: the previous entry had been prepended above the file preamble,
  producing two `## [Unreleased]` headings; merged.

### Changed
- Updated the pinned `prose-sanitiser` workspace to 0.1.1 and the container's
  Rust toolchain from 1.97.0 to 1.98.1.
- The in-container Solid service now boots `solid-pod-rs` from its native JSON
  configuration and the `--mcp` CLI flag. Agentbox no longer injects `JSS_*`
  variables or builds the `jss-v04` compatibility feature. The obsolete
  `jss_v04_compat`, `rate_limit_per_sec`, and `quota_default_bytes` manifest
  keys were removed; the latter two were not consumed by the pinned server.
  The ontology publishing workflow now uses `SOLID_POD_PUBLIC_URL`, requires an
  externally reachable origin, and targets port 8484. Archived migration records
  and upstream licence attribution remain.
- `dsp` now launches Claude Code in auto mode (`--permission-mode auto`); the
  legacy blanket bypass is `dspb` and is for isolated throwaway containers only.
  Claude Code 2.1.78+ stopped honouring bypass for `.git/` and `.claude/` writes
  and its classifier-based auto mode is the supported replacement. The entrypoint
  seeds `permissions.defaultMode = "auto"` (if unset) and pre-accepts the
  auto-mode opt-in dialog, alongside the folder-trust seed, so unattended
  tmux teammate panes stop blocking on prompts. Off switch: `AGENTBOX_AUTO_MODE=0`.
- The Z.AI wrapper's `ZAI_DANGEROUS=true` escape hatch selects auto mode
  instead of the legacy bypass flag.

### Added

- **Sovereign identity leaves Python — `nostr-pod-bridge bootstrap` / `session-summary` (2026-09-03).** The last two Python programs on the identity path are gone, folded into the Rust binary that already owned the signing half. `scripts/sovereign-bootstrap.py` (571 lines) is now `nostr-pod-bridge bootstrap`, run by the entrypoint at phase `[2/8]`; `config/hooks/nostr-session-summary.py` (274 lines) is now `nostr-pod-bridge session-summary`, registered by `agentbox-manifest` as the SessionEnd hook. **The `ecdsa` dependency is retired with them** — it was a pure-Python secp256k1 implementation flagged insecure upstream for a timing side-channel class, carried in `flake.nix` under `permittedInsecurePackages` for this one caller; that exception is now deleted rather than renewed, and the keypair is derived through RustCrypto `k256` with NIP-19 bech32 from `nostr-bbs-core` (no hand-rolled bech32 either). Byte-compatibility is the contract, because `management-api` and the MCP servers read these artefacts: a differential harness runs the original Python and the port against scratch roots for a fixed key and compares everything — 27 tree entries including symlink targets, all 10 emitted files byte-identical (identity JSON, `.acl`/`.acl.json`, `profile.json`, `did-nostr.json`, `agent.did.json`, `gitmark.json`, `blocktrails.json`), `identity.env` identical at mode 0600, and **identical git commit SHAs** for all three pod-contract commits, which pins the ADR-124 `blocktrails states[]` content exactly. CPython's `json.dumps(indent=2)` shape is reproduced by the `pyjson` module already used by `agentbox-manifest` and `agentbox-ops`. Legacy identity files still migrate in place with their original key order and any operator-added fields preserved (verified against the Python's `dict.update` semantics), including the odd-y case where BIP-340 canonicalisation negates the stored scalar. 99 tests replace the 598 lines of pytest, which are deleted. **Two real bugs fixed:** the SessionEnd digest hook had been dead since SEC-003 — it gated on `AGENTBOX_BRIDGE_SK`, which the entrypoint deliberately scrubs from the environment before `exec supervisord`, so the phone mirror never fired in any real container; the port accepts the tmpfs key file (`AGENTBOX_BRIDGE_SK_FILE`) that the bridge itself already reads. And the digest no longer re-spawns a subprocess to publish: the hook *is* the bridge, so it signs and dual-writes in-process. Also corrected in `flake.nix`: the bridge package was gated solely on `sovereign_mesh.relay.pod_bridge`, so a profile with the mesh enabled and the relay external or off would have booted with no way to mint its own identity; it is now built whenever `sovereign_mesh.enabled`.

- **python3 is no longer a boot dependency — `agentbox-manifest` (2026-09-02).** The container needed a Python interpreter at boot for one reason: `config/entrypoint-unified.sh` reached for `tomllib`/`json` at **17 inline sites** (~377 lines) to upsert `.mcp.json`, project `[interaction_plane.proxy]`, parse `[[plugins.packages]]` and probe the embedding dimension, and four scripts (1,335 lines) did the same work at length. All of it is now one Rust binary, `services/agentbox-manifest`, built by `lib/agentbox-manifest.nix` and unconditionally on the entrypoint's PATH (ungated: the entrypoint cannot boot without it, so there is no meaningful "off" state). Retired: `scripts/{tui-read-manifest,tui-write-manifest,model-routing-project,provision-agent-stacks}.py` and `tests/tui/test_tui_helpers.py`. **python3 itself stays in the image** — `opf-router` (torch) and the code-interpreter MCP server (Jupyter kernels) are genuinely Python-hosted and unaffected. Correctness is pinned by 105 tests, 44 of which replay fixtures captured from the Python itself against the live `agentbox.toml` and compare **bytes**: these files have strict consumers (Claude Code reads `.mcp.json`, the nip98 proxy fails closed on malformed config, agentic-qe reads `llm-config.json`, operators diff `agentbox.toml`), so byte-parity meant reproducing CPython's `json.dump(indent=2)` shape, `ensure_ascii=True` escaping and insertion order exactly. Two security improvements fell out of the port: secrets now reach the MCP spec through a `${VAR}` placeholder the *binary* expands and JSON-escapes from its own environment — so the Perplexity API key and the VisionClaw dev token stop being interpolated onto the command line as they were, and a token containing a quote can no longer corrupt `.mcp.json`; and the gateway warm-up POST passes its bearer via `curl -K -` rather than argv. Two Python sites remain in `scripts/start-agentbox.sh` on purpose, both wizard-only and never on the boot path: the `http.server` static origin (a throwaway dev server, already guarded with a fallback) and the `[sovereign_mesh.operator]` block edit (comment-preserving *text surgery*, which a parse-and-re-emit path would strip). Found and recorded en route: `setup/server` has no deep-merge to share — it writes TOML wholesale — and `tests/tui/test_tui_helpers.py` was already red on main, indexing a `toolchains.gemini_cli` key the reader stopped emitting when the toolchain was renamed to `antigravity_cli`.

- **Claude Fable 5.1 model and harness refresh (2026-09-01).** Updated the two independently pinned Claude Code distributions (Nix runtime binary and Z.AI sidecar) to 2.1.257 with verified official x86_64/aarch64 hashes, and moved the sidecar from Node 20 to its newly required Node 22 runtime. Refreshed active Claude defaults to the current lineup: Fable 5.1 for long-horizon architecture, implementation escalation, security analysis, debugging, and skill optimization; Opus 5 for design/test escalation; Sonnet 5 for routine specification, review, release, meeting assistance, and UI-agent work; Haiku 4.5 remains the intentional dated low-cost snapshot. Added Anthropic's Fable 5.1 harness constraints to `CLAUDE.md`: append-only histories with unchanged thinking blocks, no forced tool choice, visible progress during long tool loops, batched independent calls, full-task completion, and targeted edits. The release checker now audits both Claude Code pins instead of only the sidecar.

- **Self-GC evidence governance in the dream engine (2026-08-28, ADR-070).** Adopts *Self-GC: Self-Governing Context for Long-Horizon LLM Agents* (arXiv 2607.00692) with the substrate shifted to the cross-night axis: turns=nights, tool spans=evidence receipts, active view=the compiled nightly evidence pack. New `services/dream-engine/src/context.rs`: (1) tonight's build/evaluator outputs persist **untruncated** as sidecars under `<artefact_dir>/<night_id>/receipts/` + `index.json` — unconditionally, so evidence is never again destroyed by the old 3000/6000-byte `tail()` truncation; (2) a side-channel GLM planner call (same provider chain, `max_tokens` clamped 2048–4096) assigns `restore|mask|fold|prune` over tonight's receipt objects plus the last 6 nights' (`receipt:<night_id>:<name>` IDs); (3) Rust-enforced invariants — tonight's receipts never fold/prune (last-turn protection), unknown targets dropped, unmentioned objects default tonight→mask / prior→fold, `DREAM_SELF_GC_BUDGET` (30k chars) degrades overflow to fold; every fold/mask carries a byte-exact recovery pointer a later night can `restore` when its slot rotates back. Fail-open at every stage to the legacy tail path; `DREAM_SELF_GC=0` disables governance (sidecars still written). 9 new unit tests (76 passing, clippy clean). Runtime-env-gated, no manifest entry; the Nix-built binary ships at the next image rebuild.

- **Unified operator auth — dreamlab-ai auth adoption on :8444 (2026-08-27, ADR-069).** The nip98-proxy becomes the ONE authenticator for every console surface: Caddy now routes `/approvals/*`, `/mgmt/*` (closing its previous proxy bypass), `/bridge/*`, `/feed`, and the new `/nip07/*` login handshake through :9096 alongside `/aoe/*`. Session-first UX: operators sign in once via NIP-07 (Podkey) → 12 h HttpOnly cookie covering fetch + websocket; per-request signing stays as fallback; the sessionStorage break-glass input is demoted behind `?breakglass=1`. **Credential exchange at the trust boundary**: proxy routes may declare `bearer_env` — the operator's credential is replaced upstream with the service's own bearer (`BRIDGE_TOKEN` for tab0-bridge), so the browser never holds upstream secrets. Config is boot-class: `agentbox.toml [interaction_plane.proxy]` (routes + npub allowlist seeded with the dreamlab roster operator key) projected each boot to `workspace/.agentbox/nip98-proxy-config.json`; the proxy fails closed on malformed config and unions file+env allowlists. Selftest extended-hermetic (isolated config path) — 0 failures against the baked bridge; live verification: unauthed 401, break-glass→BRIDGE_TOKEN exchange 200, `/nip07/` handshake 200 through Caddy. Interim activation this boot: repo-copy proxy with the supervised unit stopped (rollback: `supervisorctl start nip98-proxy`); the baked copy picks up the code at next rebuild.

- **MetaHarness adoption wave 1 + estate-wide npm pin refresh (2026-08-27, ADR-062..068).** A 51-agent Opus research mesh (run `wf_845cbc7e-4f2`) produced the ruflo→MetaHarness migration assessment; the ADR suite (062 posture / 063 plugin enable / 064 bake binaries / 065 dream liveness / 066 governance / 067 pin discipline / 068 kernel non-goal) scopes it. Implemented this rebuild: (1) **`ruflo-metaharness` plugin enabled** (`[[plugins.packages]]`, boot-class — 13 harness-intelligence skills from the boot cache); (2) **`toolchains.metaharness` gate** bakes `metaharness@0.3.2` + `@metaharness/darwin@0.8.3` (the plugin-pinned versions) as mkNpmCli closures, making score/genome/evolve/security-bench offline-functional; (3) **ADR-065 enforced in code** — dream-engine `config.rs` now rejects `@metaharness/darwin` evaluator entrypoints lacking `--sandbox mock|agent` (the surface-independent `real` sandbox silently no-ops the night; 3 new unit tests, 67 passing); (4) **all npm CLI pins refreshed**: ruflo 3.32.8→3.38.20 (closes the CLI↔plugin-tree skew), ruvector 0.2.35→0.3.0, agentic-qe 3.13.1→3.13.12, codebase-memory-mcp 0.9.0→0.10.8, wrangler 4.78.0→4.125.0 (the private-`@cloudflare/codemod` pin blocker is gone from upstream devDependencies; 4.126/4.127 skipped — inside the 72h publish-freshness window on rebuild day, per the supply-chain review). Two `system-manifest.js` entries added (`metaharness-binaries` rebuild-class, `metaharness-plugin` boot-class). Post-rebuild verification (same day): all binaries at pinned versions, `metaharness score` returns real data (harnessFit 70, scaffoldReady true), recall gate PASS. Entrypoint Step 2b added: symlinks the baked metaharness package into the plugin's `node_modules` so the skills' offline walk-up resolution finds it instead of degrading (verified live: degraded:true → real scorecard). Known residual: `_darwin.mjs` uses hardcoded `npx -y` (upstream issue — the baked `metaharness-darwin` bin covers direct/dream-engine use; plugin darwin skills degrade offline until upstream adopts local-resolve).

- **Dream-engine becomes a closed self-improvement loop with an operator channel (2026-08-21).** Four changes turn nightly dreaming from write-only ledger rows into praxis: (1) **Self-healing** — TCP singleton lock (`127.0.0.1:49172`; a duplicate engine exits instead of racing the HP annexe — the 2026-08-20/21 double-loop corrupted two nights via a leftover tmux launcher beside the supervised unit, now also guarded in `tmux-autostart.sh`), pre-flight annexe-checkout probe (one re-provision retry, then the new **`BLOCKED-ENV`** verdict: no LLM call, dry-streak-neutral, operator-alerted — environment faults can no longer park healthy repos or masquerade as findings), per-run `-p<pid>` remote dirs, and a `dream-last-night.json` health summary with zero-eligible/failure alerts. (2) **Value loop** — all verdicts persist to RuVector (`ACCEPT` 0.9 / `REJECT` 0.7 / `INCONCLUSIVE` 0.4; `BLOCKED-ENV` excluded), and each night's prompt carries the previous night's `Next steps`/`Biggest uncertainty`/`Main lesson` plus answered operator questions forward, so nights compound. (3) **Operator question channel** — reports' "Human action recommended" items and health alerts queue in `workspace/.agentbox/dream-inbox.json`; `config/hooks/dream-inbox-surface.cjs` (UserPromptSubmit, entrypoint-registered, fail-open, 4 h resurface / 2 per turn) surfaces open items into whatever Claude session the operator is in; `scripts/dream-inbox.mjs answer` records decisions that feed the next night. (4) **Harvest** — `scripts/dream-harvest.mjs` weekly rollup (verdict counts, streaks, env-fault rate, pending-ACCEPT review list; first run surfaced 14 unharvested ACCEPT nights). Engine state moved to `workspace/.agentbox/` (`$HOME` root is read-only rootfs — the documented `~/.agentbox/dream-paused` path could never be created). Docs: `docs/developer/dream-engine.md`, `skills/dream-machine/commands/dream.md` (new `questions`/`answer`/`harvest` verbs).

### Fixed

- **ontology-bridge search tools now hit a route that exists, and authenticate correctly (2026-08-10, commit 84bfa45c; ADR-023, PRD-011).** `ontology_search` and `kg_node_search` previously POSTed to the non-existent `/api/graph/paginated` route (404, fail-open-empty in production); they now POST to the anonymous, relevance-ranked `/api/ontology-agent/discover` endpoint — i.e. relevance-ranked semantic search, not paginated node search. The `node_type`/`offset` params have no server-side equivalent (results are relevance-ranked top-N) and are best-effort only. **Auth correction:** the bridge's power_user (SPARQL-backed) reads — `kg_neighbors`, `kg_pathfind`, `ontology_graph_query`, `ontology_validate`, `ontology_class_get/list` — require `VISIONCLAW_DEV_TOKEN` to equal the dev-session bearer `dev-session-token` on a VisionClaw dev build (paired with `AGENTBOX_PUBKEY` as `X-Nostr-Pubkey`); a bare pubkey as the bearer returns 403. Release builds authenticate via NIP-98 signing. `.env.example` corrected accordingly.

### Added

- **Prime-agent capability adoption — four disciplines bound to our IRI/beads/DID/git substrate, exposed via a `substrate-tools` MCP server (2026-08-07, ADR-046).** An Opus investigation mesh audited our substrate against [PrimeIntellect-ai/prime-agent](https://github.com/PrimeIntellect-ai/prime-agent) and [semantica-agi/semantica](https://github.com/semantica-agi/semantica) and concluded we already supersede three of prime's four load-bearing ideas — so we adopt the *disciplines*, not the ephemeral flat-file mechanisms. Shipped: (1) **continual-harness** (`mcp/servers/lib/continual-harness.js` + CLI) — evidence-anchored, DID-signed, git-rollbackable refines of a mutable harness layer over the immutable CLAUDE.md base (the durable, revertable, attributed store RuVector's upsert-by-key plane lacks); (2) **ontology working set** (`ontology-workingset.js`) — session-scoped, IRI-keyed class digests carried across turns with a corpus drift-guard; (3) **beads work-DAG** — `addDependency` + dependency-aware `getReady` resurrect the previously-dead `bead_deps` table (contract `beads` 1.0.0→1.1.0), turning the work ledger into a real dependency graph; (4) **typed-spawn** (`typed-spawn.js`) — recursive subagent spawning where each child is a DID-owned bead under the parent epic with ontology-IRI-typed I/O. All 13 tools ship via the new **`substrate-tools`** MCP server (registered in `mcp/mcp.json`). ADR-046 records the semantica decision: complement Oxigraph/Whelk with its ConflictDetector / bi-temporal / decision-node modules as a Python tenant, never replace the Whelk EL reasoner.
- **AoE OpenCode connector for DeepSeek + LAN Gemma.** Route the DeepSeek and LAN Gemma interaction sessions through AoE's native OpenCode connector (removing the unavailable CodeWhale/NanoCoder wrappers); add OpenCode to the image with OpenAI Chat Completions-compatible provider definitions for DeepSeek and Gemma (`192.168.2.48:8084/v1`); the generated provider config is readable by AoE's unprivileged session user (credentials remain environment references, never file content).

- **NIP-07 browser sessions on the sovereign ingress — the npub front door now works from a browser (2026-08-06, ADR-045 review trigger fired).** The nip98-proxy grew a proxy-owned `/nip07/*` surface (never forwarded upstream): unauthenticated browser GETs (`Accept: text/html`) 302 to a self-contained handshake page whose JS asks the operator's NIP-07 signer (`window.nostr` — podkey or any compliant extension; polled briefly, since signers inject asynchronously) to sign a kind-27235 challenge for `POST /nip07/session`. The event is verified through the **same `NostrBridge.verifyNip98` path** as every API request; only auth mode `nip98` may mint (cookies cannot self-renew, break-glass cannot launder its sentinel), and on success an HttpOnly SameSite=Lax cookie carries a stateless HMAC token `v1.<pubkey>.<expiry>.<mac>` under a per-boot secret (TTL `NIP98_PROXY_SESSION_TTL`, default 12 h). Sessions authenticate HTTP **and WebSocket upgrades** (cookies ride the WS handshake natively — closing the `?access_token=` gap) with the real verified pubkey, stamped `X-Agentbox-Auth-Mode: nip07-session`; the token is stripped from the forwarded `Cookie` header on both paths, so upstreams never see it. New `NIP98_PROXY_ALLOWED_PUBKEYS` implements the npub allowlist ADR-045 D2 envisioned (applies to NIP-98 and session minting); `safeNextPath` guards the post-login redirect against open-redirect forms. Selftest grew the F-series (handshake page, browser-401 redirect, mint-mode strictness, cookie auth + upstream stripping, forgery/expiry/MAC-tamper rejection, WS-via-cookie, open-redirect guard, full signed mint): **42 PASS / 0 fail / 0 skip** against the baked nostr bridge. The break-glass bearer is now emergency-only; ADR-045 Consequences amended in place. Interim activation this boot: repo-copy proxy running with the supervised unit stopped (rollback: `supervisorctl start nip98-proxy`); the baked copy picks it up at the next rebuild.
- **Sovereign ingress — one npub-gated LAN front door (2026-08-05, ADR-045).** The box is headless; the operator reaches it from LAN devices, but the NIP-98 proxy (`:9096`) — the sole ingress to the interaction plane — was reachable only on the docker network (no compose publish), leaving the voice cockpit (`:8444`) the only LAN door. Three changes: (a) `docker-compose.yml` publishes **`9096:9096`** as the ONE identity-gated LAN exception to the R-003 loopback posture (`:9095` stays sealed, N-05); the flake's compose generator is fixed to emit the `127.0.0.1:` prefixes it had silently been dropping (the committed artefact was hand-hardened; regeneration can no longer un-harden it) and to emit the 9096 row from the `[interaction_plane]` gate — regenerate with `nix build .#compose` at the next host rebuild. (b) `config/nip98-proxy/proxy.mjs` becomes a **multi-upstream ingress**: an ordered prefix routing table (`NIP98_PROXY_ROUTES` JSON, or the supervisord-safe `NIP98_PROXY_MGMT_UPSTREAM` convenience env) consulted after identity verification — initial table routes `/mgmt/` → management-api with the same verified-pubkey headers (surface auth retained, defence in depth); the default route to `aoe serve` is byte-identical to before; malformed route config is fatal at boot. Selftest extended (routing, prefix-strip + query preservation, auth-precedes-routing, upstream isolation; 20 PASS). (c) DreamLab-forum integration is scoped to the **identity and async seams only** (shared npub gate, kind-30840 digests; nostr transport explicitly rejected for live control — relays are store-and-forward). PRD-021 gains Appendix C; quickstart §7, README, and the proxy README updated to the two-LAN-door posture.

- **The agentic-kit adoption sweep (2026-07-24, ADR-041).** A three-agent analysis of [pacphi/agentic-kit](https://github.com/pacphi/agentic-kit) (an npm install/heal/prove layer over ruflo + agentic-qe with Claude+Codex dual-host routing), grounded against the `ruvnet-kb` corpus, concluded: the *install-healing* half is moot here (the Nix fail-loud native bridges prevent at build time what `ak` heals at runtime), but four mechanisms fill real gaps and are adopted natively — no dependency on the `ak` CLI:
  - **`[model_routing]` (ADR-041)** — one per-activity Claude/Codex policy in `agentbox.toml` (12 activities, `"host:model [-> host:model]"` grammar, defaults grounded in upstream `@claude-flow/codex` CollaborationTemplates), projected at every boot by `scripts/model-routing-project.py` into every `.agentic-qe/llm-config.json` under the workspace as `agentOverrides` + `defaultProvider` + a complete `fallbackChain` (atomic writes, non-managed keys preserved, API keys never written, fail-open), plus `AQE_LLM_PROVIDER` reconciled on the agentic-qe MCP env. Requires **agentic-qe 3.13.1** (bumped from 3.13.0; issue #568 `agentOverrides` — `nodeModulesHash` left as `lib.fakeHash`, resolve at rebuild via `./scripts/prefetch-hashes.sh --cli`). Escalation rungs prefer the cross-vendor hop (ADR-011 anti-fox / qe-court vendor-diversity principle). `dual_run` gate ships **false** (upstream pins `CLAUDE_FLOW_DB_PATH` to local SQLite, ruflo #2766 — conflicts with ADR-015). Wizard: schema-driven section in the browser SPA (`model_routing` added to `schema/agentbox.toml.schema.json`) + `section_model_routing` in the TUI (`start-agentbox.sh`, TUI read/write manifest scripts extended). `/v1/system` catalogue: `model-routing`, apply class `boot`.
  - **`token-audit` skill** (`skills/token-audit/`, engine adapted MIT from agentic-kit) — comprehensive Claude Code usage audit from `~/.claude/projects/**/*.jsonl`: tokens by day/model/project, tool + MCP usage, subagent fan-out, cache efficiency, startup context tax, hourly-activity automation tell, runaway-daemon cross-reference. Stdlib-only Python.
  - **aidefence closure probe** (`lib/npm-cli.nix`) — whenever a closure ships `@claude-flow/cli`, the build now asserts the prompt-injection defence engine is present (`@claude-flow/aidefence` package OR the built-in `builtin-aidefence.js` #2670 engine) and **fails loud** otherwise: the defence is an optional dep, lazily imported, failing OPEN per-handler (upstream ADR-165 concedes the gap) — a version bump must never silently ship a container whose injection defence no-ops. Verified against the live 3.32.8 closure (builtin present).
  - **Daemon + npx hygiene** — `scripts/ruflo-daemon-gc.py` (registry-first discovery + `ps` sweep, staleness = workspace-gone OR TTL, **pid-reuse guard**: live-cmdline re-probe before any SIGTERM, unconfirmable → refuse) and `scripts/npx-stale-scan.sh` (the npx `_npx` cache can serve a stale ruflo/aqe forever after the baked tool moved on — the one path an old version can still execute in this image). Entrypoint now pins `RUFLO_DAEMON_AI_WORKERS=0` in the runtime env (belt-and-braces over upstream #2661's opt-in default + machine-wide budget).
  - **Record corrections from the KB grounding**: the SONA 384-dim inertness is real but the *crate* dim is config (default 256), not a compile-time hardcode — the suspect is the prebuilt `@ruvector/sona@0.1.5` NAPI binary (fix path: rebuilt binary); and the sweep/distill loops are confirmed **imaged and supervised** (CLAUDE.md stale caveat removed). Full analysis: RuVector `patterns/agentic-kit-adoption-analysis-2026-07`.

### Changed

- **CLAUDE.md tiers slimmed per Anthropic's Claude-5 context-engineering rules (2026-07-30).** Companion to the 60-skill upgrade (79715e7b): the instruction *tiers* now follow the same rules ("removed over 80% of Claude Code's system prompt … with no measurable loss"; keep CLAUDE.md "lightweight", gotchas over discoverables, progressive disclosure). `CLAUDE.md` 207→~75 lines: the RuVector operative rules stay inline as a dense machine-readable block (MCP-only access, 384-dim embedding, HNSW reindex law + CONCURRENTLY prohibition, recall gate + frozen band, SONA/attention OFF, protected namespaces); the full audited memory/learning narrative and the six long subsystem sections relocated **verbatim** to `docs/reference/claude-context/{ruvector-memory-state,subsystem-notes}.md`, linked from a load-on-demand reference table. Rules-for-changes and runtime gotchas kept; duplicated ADR content compressed to pointers. The same sweep slimmed the deployed tier stack outside this repo: host/container-global `~/.claude/CLAUDE.md` 207→17 lines (doctrine deleted, RuVector mandate + working style kept), workspace-volume `CLAUDE.md` 158→71 (env facts + gotchas in machine-readable blocks; backup at `CLAUDE.md.pre-c5-slim`), host-project `CLAUDE.md` 212→39 (memory-first, codebase-memory MCP, non-obvious skill routes only).

- **claude-flow ⇒ ruflo consolidation — one closure, three bins (2026-07-19).** Upstream renamed the project ("Claude Flow is now Ruflo", github.com/ruvnet/ruflo); the `ruflo` npm package's ONLY dependency is `@claude-flow/cli`, so agentbox had been baking the identical tool twice (`claudeFlowPkg` + `rufloPkg`, two full npm closures of the same code at the same version). `claudeFlowPkg` is removed; the single `rufloPkg` closure now ships `ruflo` (canonical) plus `claude-flow` and `claude-flow-mcp` wrappers via a new `extraBins` option in `lib/npm-cli.nix` (aliases target bins inside the package's node_modules; stage-3 wrapper only — tarball/node_modules FOD hashes untouched; a missing alias target fails the build loudly). Both manifest gates (`toolchains.ruflo`, `toolchains.claude_flow`) remain honoured — either pulls the one package; `claude_flow` is documented as the legacy alias gate in `agentbox.toml`. Every `claude-flow hooks …` call site keeps working (verified: standalone build, all three bins execute, `ruflo`/`claude-flow` both report v3.32.8; the `claude-flow` MCP server entry was never this CLI — it runs the governed `ruvector-mcp.cjs`, ADR-015). `/v1/system` catalogue merges the two module entries into one dual-gate entry. Trap for the unwary, now documented at the pin: THREE npm artefacts publish this same code (`ruflo`, scoped `@claude-flow/cli` with tarball basename `cli-<ver>.tgz`, and unscoped `claude-flow`) — prefetching the wrong artefact's tarball wedges `prefetch-hashes.sh` in an unpatchable mismatch loop.

- **Component pin sweep — all third-party toolchain pins bumped, hashes resolved and validated; rebuild deliberately deferred (2026-07-19).** Bumps: `ruvector` 0.2.34→0.2.35, `@claude-flow/cli` 3.26.1→3.32.8, `ruflo` 3.26.1→3.32.8, `agentic-qe` 3.12.2→**3.13.0** (QE-Court multi-vendor adversarial review + Codex CLI provider + transformers-CVE fix; provenance note added at the pin), OpenAI Codex CLI 0.142.5→0.144.6 (both musl asset hashes verified byte-for-byte against the release), `web-researcher-mcp` 1.37.5→1.43.0 (src + vendorHash validated by a standalone `buildGoModule` run). `management-api` `npmDepsHash` recomputed for the test-dependency lockfile change. **Held**: `wrangler` stays 4.78.0 — its stated bump gate is still unmet (`@cloudflare/codemod@1.1.0` remains in 4.112.0's devDependencies and is still absent from the public registry); `codebase-memory-mcp` 0.9.0 and `@mermaid-js/mermaid-cli` 11.16.0 already latest; DreamLab-internal git-rev pins (solid-pod-rs, linkedobjects-browser, nostr-pod-bridge) are deliberate integration revs, untouched; `nagual-qe` stays disabled (upstream sqlx 0.9 compile error). Gotcha recorded at the pin: the claude-flow package is the **scoped** `@claude-flow/cli` (tarball basename `cli-<ver>.tgz`) — the unscoped `claude-flow` npm package is a different artefact; prefetching the wrong one wedges `prefetch-hashes.sh` in an unpatchable mismatch loop. Also noted: the script's FOD patcher does not handle Go `vendorHash` slots (npm-cli + cargoHash only) — Go bumps need the loop's reported hash patched by hand. Zero `lib.fakeHash` assignments remain; `./agentbox.sh rebuild` is the outstanding step.

### Fixed

- **Chronic contract-tests red root-caused; web setup now seeds from a shipped default template (2026-08-07).** `ruvector-gates.contract.spec.js` had asserted operator-flippable gate VALUES (`aggregate_sweep` / `pattern_distillation` — legitimately ENABLED 2026-07-21 after their recall-harness pass) against the LIVE `agentbox.toml`, so it could never pass — red on every push since June. Root fix is architectural: introduce **`setup/agentbox.default.toml`**, the behaviour-preserving shipped default (all learning/hygiene gates OFF), and point the default-off contract (PRD-020 metric 1) at it; the live config is now checked only for key DECLARATION (structural sync). The web setup generator (`setup/server/src/main.rs`) seeds fresh installs from this template rather than the operator's live config (`cargo check` clean). `contract-tests.yml` gains `--runInBand` — the `better-sqlite3` native addon segfaults inside jest worker processes on the CI runner (the chronic `beads.contract` SIGSEGV, distinct from the ruvector-gates assertion failure). `ontology_monitor` added to `schema/agentbox.toml.schema.json` (was missing) so the setup form exposes it; strict superset, no data loss. **19/19 contract suites pass locally.**
- **Cockpit 401 storm with a NIP-07 signer active: management-api silently rejected all NIP-98, and the console couldn't reach tab0-bridge without a pasted bearer (2026-08-07).** The operator's podkey signer signed every request correctly, yet `/approvals/*` 401'd on an 8-second loop. Root cause — the third instance of the nix-relocation require bug this week: `management-api/middleware/auth.js` loaded the NIP-98 verifier via `require('../../mcp/servers/nostr-bridge')`, which resolves inside the baked standalone derivation (`…-management-api-0.0.0/lib/node_modules/agentic-flow-management-api/`) where no bridge exists; the bare `catch` swallowed it and the middleware **failed closed to bearer-only with no log line**. Now resolved through a candidate list (`NOSTR_BRIDGE_PATH` env → relative → `/opt/agentbox/mcp/servers/nostr-bridge.js`) with a loud startup warning when none load; the same latent instance in `routes/mandate.js` (whose fallback chain also dead-ends in the derivation, silently minting mandates **unsigned**) got the same candidate chain. Alongside it: (a) **tab0-bridge accepts NIP-98** (header for fetches, `?auth=<signed event>` for the `/feed` WS upgrade where browsers cannot set headers) gated on the operator key + env allowlist + the manifest's `[sovereign_mesh.relay].allowed_pubkeys` (read from `agentbox.toml` directly — the flake only bakes that list into the pod-bridge env), sharing the NostrBridge verifier and its replay cache; the bearer path is unchanged and the startup log now reports `nip98=enabled (N keys)`. (b) **The cockpit signs for `/bridge/*` and `/feed` when no bearer is pasted** (prefix-stripped `u` tag, `/bridge` → handle_path strip; `/feed` unstripped), re-runs the first poll round when the signer injects late (extensions inject `window.nostr` after the first polls have already 401'd — the visible page-load error burst), and gained a favicon (the 404 in every console trace). Interim activation this boot: patched management-api (repo copy, `node_modules/better-sqlite3` symlinked from the nix package — the repo-root stale ABI copy shadowed `NODE_PATH` during the parent-directory walk) and patched tab0-bridge (workspace copy) run with their supervised units stopped; rollback `supervisorctl start management-api tab0-bridge`; the next rebuild bakes both. Console changes are live immediately (bind-mounted static site).
- **Post-rebuild interaction-plane audit: boot seeding silently dead, and the antigravity agent was wired to the wrong product (2026-08-05).** Three regressions found auditing the rebuilt image. (1) **Boot-time session seeding no-oped**: the baked `/opt/agentbox/scripts/aoe-seed-sessions.mjs` resolved `@iarna/toml` via `createRequire(import.meta.url)`, which walks up from the script's own path — no `node_modules` chain exists under `/opt`, so the fail-open guard exited silently and the rebuilt container came up with **zero sessions** (the AoE session store is container-local; the worktrees survive on the bind mount). The seeder now falls back through workspace require bases (`$WORKSPACE/project/agentbox` → `$WORKSPACE/project` → `$WORKSPACE`) before giving up. (2) **nixpkgs `antigravity` is the Antigravity IDE, not the CLI** — the flake baked a 194 MB VS Code fork whose `bin/antigravity` exits 0 headless, which is what AoE's spawned pane silently died on. Replaced with `lib/antigravity-cli.nix`: the real Antigravity CLI (`agy` 1.1.10) pinned by manifest sha512 per arch, mirroring the codex-binary pattern. The seeder's spawn override now maps agent name → binary name (`antigravity` → `agy`) and **falls back to an absolute `$WORKSPACE/.local/bin` path when the binary isn't on PATH yet** (pre-rebuild installs on the persistent volume). (3) **`agy` hard-codes `~/.gemini`** for logs/crash/oauth state (no env override; `GEMINI_CLI_HOME` ignored, verified) and died on the read-only home — added a `/home/devuser/.gemini` tmpfs mount (256 M) beside the existing agent homes; re-auth (`agy auth login`) is needed per boot. Also: `supervisorctl` now works as `devuser` without sudo post-rebuild, and daemon-side session records freeze their spawn command at create time — override changes need session recreate, not just an `aoe-serve` restart.

- **All worktree-backed session seeds failed at boot (`400 create_failed`) — stale gitlink + in-request 900 MB clone (2026-08-05).** Two stacked causes, found live. (1) The host project repo carried an **orphan gitlink** (`sdk/vircadia-world-sdk-ts`, mode 160000, empty dir, no `.gitmodules` entry) — AoE runs `git submodule update --init --recursive` after every `git worktree add`, and git fatals on the orphan ("No url found for submodule path"), killing the codex/antigravity/deepseek/ollama creates; fixed in the host repo (`git rm --cached` + commit). (2) With that fixed, the daemon-side submodule init **cloned the ~900 MB agentbox submodule from GitHub inside the create request** (26 min observed for codex) — blowing the seeder's 15 s timeout, whose client-side aborts had no server-side cancellation and left zombie clone process-trees + stray `-2`-suffixed worktrees/branches on every retry. `scripts/aoe-seed-sessions.mjs` reworked: the materialised AoE config sets `worktree.init_submodules = false`; the reconciler instead runs a **local `--reference --dissociate` submodule init** against the superproject's module store right after each worktree create (seconds, no network); create timeout 15 s → 180 s; a boot **preflight warns loudly on orphan gitlinks**. All 7 seeded sessions (coordinator + 6) now exist. Also: the antigravity seed retargeted from tool `gemini` to AoE's **native `antigravity` agent** — `@google/gemini-cli` is sunset (2026-06-18), the flake bakes nixpkgs `antigravity` (binary `agy`; verify binary-name parity at the next rebuild, noted in `agentbox.toml`).

- **nostr-gateway replayed historical commands as live C2 traffic (2026-07-28).** Verified live: a long-running *armed* gateway executed a burst of days-old commands from a previous session within one second (`commands.jsonl`, ts 1785246949–50 — five commands including an old `/report` instruction that got Sonnet-routed into a busy tab). Root cause: every replay defence was session-scoped. Arm-after-EOSE only guards the cold-boot batch; the 15 s keep-warm re-REQ re-serves the whole 50 h lookback window on every cycle, NIP-59's randomised outer-wrap timestamps make the relay's served set unstable across REQs, and the in-memory `seen` set FIFO-evicts at 20 k entries — so a historical command wrap the current run hadn't seen executed as if new. Two new gates in `config/nostr-gateway/gateway.cjs`, both fail-closed for stale traffic: (a) **rumor freshness** — NIP-59 randomises only the outer wrap/seal; the inner rumor's `created_at` is real time, so a command older than `CMD_FRESH_WINDOW` (10 min) never executes, only logs — whatever the relay re-serves, history is stale by construction; (b) **durable executed store** (`~/.claude/nostr-inbox/executed.json`, written atomically *before* dispatch → at-most-once across crashes/restarts; self-prunes at 7 days). Also enforced: Sonnet is now the **floor** for the C2 model — `NOSTR_GATEWAY_MODEL` may raise it but a haiku override is bumped back to `claude-sonnet-5` (operator requirement: reporting is capture-pane-only and must read noisy scrollback reliably without disturbing busy agents). Verified end-to-end post-fix: backlog commands skipped on boot, fresh `/tabs` round-trip via the relay executed and recorded. The imaged `/opt/agentbox` copy still carries the old code until the next `./agentbox.sh rebuild`; until then the repo copy runs under the SessionStart-hook regime with the supervised unit stopped.

- **`ruvector-pattern-distill.mjs` silently no-oped under supervisord after the app-root went symlink-farm (2026-07-24).** Post-rebuild, `/opt/agentbox/scripts/*` are symlinks into the Nix store; Node dereferences the main module to its realpath (no `--preserve-symlinks-main`) while the script's `isDirect` guard compared `path.resolve(process.argv[1])` (the symlink path) lexically against `fileURLToPath(import.meta.url)` (the store realpath) — never equal, so `main()` never ran, the process exited 0 after env bootstrap, and supervisord (`autorestart=true`, `startsecs=0`) restarted it at ~1 Hz forever: an invisible no-distillation outage that *looked* RUNNING in `supervisorctl status`. Guard now `realpathSync()`s both sides. `ruvector-aggregate-sweep.mjs` was never affected (no guard — runs unconditionally). The first correct tick applied 15 backlogged patterns and advanced the cursor 2026-07-21 → 2026-07-24. Until the next image bake, an interim detached `--loop` runs from the repo copy (`~/workspace/.agentbox-pattern-distill-interim.log`) with the supervised unit stopped.

- **Contract/sovereign test debt cleared — 6 failing suites → 0 (2026-07-19).** Full `npm test` (management-api) now passes: 52/52 jest suites (840 tests) + 78/78 node:test. Two real adapter bugs and four harness-drift issues:
  - `beads/local-sqlite`: bead URNs were content-addressed over `{title,type,ts}` only — two same-title beads minted in one ISO-millisecond collided on the `UNIQUE id` constraint. Payloads now carry a `crypto.randomUUID()` nonce. Second bug unmasked by the first: `opts.actor` (a free attribution label like `'alice'`) was passed as the URN scope pubkey and threw `MalformedUri`; new `scopePubkey()` guard only uses actor as scope when it is a 64-hex pubkey (ADR-013), else falls back to `AGENTBOX_PUBKEY`.
  - `lib/project-tracker`: `CONTAINER_ROOTS` hardcoded `/home/devuser/workspace`, violating the repo's own "$WORKSPACE, never a literal home path" rule — the classifier now reads `$WORKSPACE` per call (`containerRoots()`), and the URN-minting test pins a scratch workspace.
  - `memory.contract.spec.js`: the pg stub predated the ADR-015 adapter rewrite — it never answered the `information_schema` readiness probe and matched retired SQL shapes (`stored_at`, 3-param insert). Stub now mirrors the adapter's real queries (6-param upsert with `source_type`, `created_at` columns, scoring-CASE search).
  - `compression.contract.spec.js`: the `isAvailable()` test was unpassable in any environment (needs the real addon at its Nix path AND `[compression].enabled=true`; headroom has no injection seam) — moved to the suite's own native-gated tier with a manifest patch.
  - **jest/node:test runner split**: `harness-bridge.contract.spec.js`, `precedent.contract.spec.js`, and `upstream_vectors/` are node:test suites (the latter documents why: ESM-only `@noble/curves`); jest swept them up, node:test ran them inline (passing), and jest reported false "no tests" failures. Now excluded via `testPathIgnorePatterns`, run by a new `test:node` script chained into `npm test`, with runner notes in both headers.
  - **Host-side dev deps**: `better-sqlite3` was never declared by agentbox and resolved from the parent repo's `node_modules` (a stale Node-23 binding; v11 cannot compile against Node 26's V8) — added `better-sqlite3@^12` (Node-26 prebuild) plus `portfinder`/`ws` to the root `package.json` devDependencies so the contract/sovereign suites are self-contained. NOTE: `management-api/package-lock.json` changed (ws range bump) — re-run `scripts/prefetch-hashes.sh` / refresh `npmDepsHash` before the next image build.

- **Harness skill registration re-engineered — was hand-accreted and serving stale skills (2026-07-14).** The Claude Code Skill tool discovers skills from `~/.claude/skills/`, but that directory had no deterministic populator: skills were hand-copied over months (mixed root/devuser ownership, May–June dates), so (a) `blender` and `qgis` were **invisible to every session** despite existing in the baked tree, and (b) every registered skill was a **frozen stale snapshot** — e.g. `browser` served a 2.6 KB SKILL.md while current source is 12 KB; `leptos` 108 KB vs 120 KB. New mechanism: a declarative manifest `skills/registered-skills.txt` (the curated harness-visible subset of the 115 baked skills — the rest stay reference-only behind skill-router/lazy-fetch) + an idempotent, fail-open reconciler `scripts/reconcile-skills.sh` that symlinks each entry from `/opt/agentbox/skills/<name>` into `~/.claude/skills/<name>`, invoked from `config/entrypoint-unified.sh` during the privileged boot phase (so it replaces root-owned legacy dirs). `/opt/agentbox/skills` (baked from source) becomes the single source of truth; a rebuild always serves current skills. `blender` + `qgis` added to the set; on-demand MCP registration via `skills/blender/tools/register-mcp.sh`.

- **Blender skill + `blender-mcp` transport made coherent (2026-07-14).** The `blender` skill was rebuilt around the real BlenderMCP protocol and the runtime plumbing was corrected to match how it actually works:
  - `docs/user/blender.md` was wrong on three counts and is rewritten: it named a non-existent MCP server (`/opt/agentbox/skills/blender/addon/server.py` — the supervised `blender-mcp` program actually runs `blender-mcp-proxy.js`), claimed Blender 4.x (the image ships **5.1.2**), and implied local serving. It now documents the two real transports — headless batch `bpy` (works out of the box) vs the BlenderMCP socket server (needs a GPU/GL display) — the proxy topology, env config, health check, and the 5.x API drift.
  - Root cause of "port 9876 accepts then hangs": the supervised proxy bridges to an external `gui-tools-service` GUI sidecar that is not running, because the BlenderMCP addon needs an OpenGL context in Blender's GUI event loop and the in-container TigerVNC display `:1` does not advertise `GLX_ARB_create_context` (verified: software-GL forcing does not help — the limit is the Xvnc server's GLX). So Blender is intentionally served from an external GPU sidecar, not locally.
  - `skills/blender/tools/blender-mcp-proxy.js`: no longer silently half-opens when the upstream sidecar is down — it waits for the upstream `connect` before piping and logs a throttled, legible diagnostic (target host + `ECONNREFUSED`/etc.) to `/var/log/blender-mcp.error.log`.
  - `skills/blender/tools/blender-health.js` (new): round-trips `get_scene_info` and names the failure mode (`refused` / `silent-close` / `timeout` / `bad-json` / `ok`) with remediation, exit-coded for gating.
  - `flake.nix` `blenderServiceBlock`: annotated with the topology, the GL constraint, the `GUI_CONTAINER_HOST`/`GUI_BLENDER_PORT` env overrides (inherited by supervisord), and the headless-batch alternative.
  - `skills/blender/SKILL.md` rewritten (was a fictional port-2800 command API) around the real surface (`execute_code` workhorse + introspection on port 9876), with 7 technique `references/` distilled from licensed courseware (original prose, verified zero verbatim overlap) and the verified Blender 5.1.2 API corrections (`BLENDER_EEVEE` not `BLENDER_EEVEE_NEXT`; `use_nodes` deprecated; render needs a camera).

- **Native pod tunnel pre-build sweep (2026-07-09, 4-agent recon).** Corrections landed ahead of engaging the `pods-native.dreamlab-ai.com` Cloudflare Tunnel (the origin `[program:solid-pod]` on `:8484` was already live and healthy; the tunnel leg had never been provisioned):
  - `flake.nix` imageEnv: `SOLID_ADMIN_KEY` baked a literal dollar-brace default-expression string into the OCI `Env` (image env is never shell-expanded) — now an empty default, which is also what supervisord's `%(ENV_SOLID_ADMIN_KEY)s` expansion needs when no `.env` supplies a key.
  - `flake.nix`: `SOLID_POD_PUBLIC_URL` is now a real image-env default (from `[integrations.solid_pod_rs].base_url`) and `[program:solid-pod]`'s `JSS_BASE_URL` reads it via `%(ENV_…)s` — implementing the runtime override the manifest comment had promised but no code path backed. management-api (`routes/admin-users.js`) reads the same var for provisioning-response URLs, so those no longer fall back to loopback.
  - `agentbox.toml [sovereign_mesh.relay].allowed_pubkeys` comment claimed "operator pubkey auto-added at boot" — false (no such code; `nostr-pod-bridge` `authorize()` is a strict allowlist with no fallback, so empty = all inbound dropped). Comment now states the real semantics and the rebuild requirement (value is baked via `relayAllowedPubkeysCsv`).
  - Stale tunnel-origin references to the `solid-pod-server:8410` sidecar (architecture deleted in `ae7f4ec0`, 2026-05-17) corrected to `agentbox:8484` in `docker-compose.solid-pods.yml`'s header and `docs/user/solid-pod-sidecar.md` (page rewritten for the in-container + cloudflared-overlay architecture; `Dockerfile.solid-pod` and the `pod-internal` network it described no longer exist). `README.md` "Stratum 3" no longer references `AGENTBOX_PUBLIC_URL` (consumed nowhere) and now points `CLOUDFLARE_TUNNEL_TOKEN` at `.env.solid-pods`/the overlay rather than the root `.env`. `docs/README.md` index description updated to match. `config/supervisord.solid-pod.conf` (unreferenced fragment for the deleted sidecar, `[program:solid-pod-server]` on `:8410`) removed. Known residue: `.env.solid-pods.example` line 5 still names the old origin in a comment (env-file reads are deny-listed for agents — fix by hand).

### Added

- **docBox back-ports: apply-class taxonomy, `/v1/system` live manifest surface, hash-chained events log (2026-07-19, ADR-039).** Three consumer-facing patterns from [DreamLab-AI/docBox](https://github.com/DreamLab-AI/docBox) (the client-facing distillation of agentbox) evaluated and ported where genuinely additive. (1) **Apply-class taxonomy** — every catalogued manifest gate now carries a fixed `live | boot | rebuild` class answering "when does flipping this key actually apply?" (docBox ADR-002's discipline; agentbox drops docBox's `hot`/`session` classes as referent-free here). (2) **`GET /v1/system`** (`management-api/routes/system.js` + `lib/system-manifest.js`) — the live system view: core spine composed from the resolved adapter registry (slot/impl/contract version), surfaces + modules from a hand-authored catalogue whose on/off/available **state is introspected from the parsed `agentbox.toml` at request time** — an improvement over docBox, which hand-authors both catalogue and state. Multi-gate entries supported (`[memory_hygiene]`'s three op gates, any-true). Always mounted, authed, read-only. (3) **Hash-chained events JSONL** — the `local-jsonl` events adapter now writes `seq`/`prev_hash`/`hash` on every record (`hash = SHA256(prev_hash ‖ canonical_json(record − chain fields))`, deep key-sort canonicalisation, ported from docBox `server/src/audit/chain.ts`), threading across daily rotation and restarts, advancing only on successful writes; pre-existing records verify as a tolerated legacy prefix. `GET /v1/system/audit-chain[?days=N]` verifies the chain (edit/splice/reorder detection; tail-hash reported as the future off-box anchor). Adapter slot contract unchanged; covered by `tests/contract/events-audit-chain.test.js` (10 tests). Deliberately rejected: SSE replay (docBox never implemented it; agent-events WS already ships history), mock-first demo seam (no comparable UI surface), blue/green rebuild + restic rollback (deferred — needs docBox's volume-plane split; the strongest candidate for a follow-up).

- **OpenMed clinical-PHI redaction sidecar — optional, gated, default-off (2026-07-14).** Adds a clinical/PHI redactor as the `local-clinical` backend of the ADR-008 privacy filter, reusing the existing `wrapWithPrivacyFilter` middleware seam (no new adapter slot, no new MCP tool) — the fit a feasibility pass identified. New `[privacy_filter.openmed]` block in `agentbox.toml` (default `enabled = false`), `openmed-sidecar/` (node:22-slim + `onnxruntime-node` — the ONNX runtime agentbox otherwise lacks, the gap PRD-016 deferred — plus a fail-closed `prereq-check.sh`), `docker-compose.openmed.yml`, `./agentbox.sh openmed <up|down|health|logs|status|rebuild|shell>`, a `section_privacy_filter` onboarding step in `start-agentbox.sh`, and `docs/user/openmed.md`. Activation is fail-closed behind **three prerequisite gates**: `license_acknowledged` (helix is pre-release with an unresolved LICENSE — vendoring blocked until verified), `onnx_runtime_present`, and `governance_acknowledged` (a passing gate is not HIPAA compliance; OpenMed's own docs disclaim it). The HMAC key OpenMed needs is derived via the ADR-029 child-key scheme — no new secret store. The helix pipeline (`helix-openmed`/`helix-wasm`/`openmedkit-web`) and the ONNX model are NOT vendored (licence-gated); the sidecar is the runtime substrate the operator drops them into once the prerequisites resolve.

- **`gui-tools-service` GPU sidecar + Blender/QGIS deconflation (2026-07-14).** New FHS (Arch) GPU sidecar (`gui-tools-sidecar/`, `docker-compose.gui-tools.yml`, `./agentbox.sh gui-tools <up|down|health|gpu|logs|status|rebuild|shell>`) that runs Blender (BlenderMCP addon on :9876, Siddharth Ahuja MIT) and QGIS (:9877) with real GPU acceleration via VirtualGL → GPU EGL. **Root cause it solves:** agentbox-main is nix-built and nix binaries do not search `/usr/lib`, where the nvidia-container-runtime injects the driver libs — so in-container Blender/QGIS get neither CUDA (`CUEW initialization failed` → silent CPU fallback) nor a GPU GL context. The FHS sidecar puts `/usr/lib` on the default loader path (the same reason the browser sidecar works). Deconflation: `scripts/qgis_mcp_standalone.py` changed from a local stub to a TCP proxy to the sidecar (mirrors `blender-mcp-proxy.js`, which already targeted `gui-tools-service:9876`); `flake.nix` QGIS/Blender supervisor blocks annotated accordingly. Interactive BlenderMCP now lives in the sidecar; agentbox-main keeps the **headless GPU batch** path via the new `skills/blender/tools/blender-batch.sh` (prepends `/usr/lib` so nix Blender finds `libcuda` — verified: Cycles then enumerates all 3 GPUs and renders on GPU). `blender` skill rebuilt as a meta-skill: `SKILL.md` router + 8 technique references (incl. `reference-scenes.md`, verified anatomy of 52 finished pro `.blend` files) + tools; SKILL-DIRECTORY entry and description updated for progressive discovery.

- **RuvNet Brain corpus ingested into the sidecar (`[skills.ruvnet_brain]`).** The [ruvnet-brain](https://github.com/stuinfla/ruvnet-brain) knowledge base (~90k source chunks across 21+ RuvNet ecosystem repos: ruflo, ruvector, safla, agentdb, agentic-flow, sparc, …) is loaded INTO ruvector-postgres under the write-protected namespace `ruvnet-kb` — embedded client-side via Xinference `bge-small-en-v1.5` (384-dim, ADR-015), the same embedding space and `memory_entries` table as all other memory. The upstream retrieval stack (`@ruvector/rvf` file stores + `@xenova/transformers` in-process embedder) is deliberately NOT run — no second embedder, no second vector store. Pieces: `scripts/ruvnet-brain-ingest.mjs` (boot playbook, backgrounded after the Xinference readiness gate; reconciles against the latest upstream GitHub release every boot — content-addressed chunks mean only new/changed text is re-embedded, vanished chunks are pruned, and a `ruvnet/manifest` row stamps the corpus version + best-effort ADR-013 dataset URN); `mcp/ruvnet-brain` thin MCP wrapper (`makeNpmService` closure, deps: MCP SDK + `pg`; tools `search_ruvnet` with repo filter + ILIKE degradation, `ruvnet_brain_status`) — same data also reachable via `memory_search({namespace: "ruvnet-kb"})`; `config/hooks/ruvnet-brain-ground.cjs` UserPromptSubmit grounding hook (RuvNet-mention + classical-substitute anti-pattern detection); `skills/ruvnet-brain/SKILL.md`; the entrypoint appends `ruvnet-kb` to `RUVECTOR_PROTECTED_NAMESPACES` on the claude-flow env so agents cannot overwrite corpus rows via `memory_store`; operator playbook `./agentbox.sh ruvnet-brain <ingest [--force]|status|logs>`; workspace-backed transient staging. Enabled in the shipped manifest.
- `/tmp` tmpfs raised 256M → 1G (routinely maxed out).

- **RuVector-native memory + honest learning loop (PRD-018 / ADR-036 / DDD-016; amends ADR-015).** The governed memory MCP gains typed metadata (importance/tags/episodic-vs-semantic/TTL — the advertised-but-dropped `ttl` param finally honoured, `delete` finally implemented via the episodic sweep), DIY hybrid search (`ruvector_hybrid_score` + PG builtin FTS, namespace-scoped), a read-only `memory_health` diagnostic, and an OODA `memory_orient` cold-start bundle (`mcp/servers/lib/{ruvector-gates,memory-metadata,memory-hybrid,memory-health,aggregate-effectiveness}.js`). An honest learning loop records graded `(state, action, outcome, duration)` tuples into the previously-empty `trajectories`/`trajectory_steps` tables via `config/hooks/trajectory-recorder.cjs` (+ `lib/trajectory-util.cjs`; skip-on-undetermined outcomes, locally-measured durations, credential redaction hardened against URI-embedded/lowercase/concatenated secret forms) and distils Wilson-bounded, recency-decayed effectiveness aggregates that (gated) re-rank retrieval and surface as advisory routing hints. **All fifteen gates default OFF** under `[integrations.ruvector_external]` / `[memory_learning]` / `[memory_hygiene]` — the all-false manifest is verified byte-identical to prior behaviour (PRD-018 metric 1). The entrypoint injects the gate env into `.mcp.json` (reconciled every boot, connection fields included), registers the trajectory hook only when learning gates are on, and de-registers any ungoverned ruvector-mcp fork (ADR-036 D2). Validator gains advisory W066 (consumer-ahead-of-producer flag combos). ADR-015 amended: embeddings are `bge-small-en-v1.5` via Xinference (384-dim, client-side), not MiniLM/`generate_text_embedding()`.
- **Gated sidecar lifecycle for ruvector-postgres (`agentbox.sh ruvector …`).** `scripts/ruvector-sidecar-update.sh`: `status`/`check`/`test`/`update`/`rollback` — image updates are pinned by tag@digest in `agentbox.toml` and rehearsed on a `pg_basebackup` snapshot behind a six-assertion smoke suite before the production volume is touched (executed live 2026-07-04: 0.3.2 → 2.0.5 with byte-identical recall). Data-hygiene ops (`migrate-trajectories`, `repair-namespaces`, `backfill-embeddings`, `archive-legacy`, `build-metadata-gin`, `aggregate-effectiveness`) are dry-run by default and fail-closed behind `[memory_hygiene]`/`[memory_learning]` flags. `agentbox.sh backup`/`restore` now carry a crash-consistent `pg_dump` of the memory DB (previously absent from backups entirely).
- **Sovereign Project Tracking (PRD-017 / ADR-035 / DDD-015).** Helm-grade project tracking (status grid, 30-day commit activity, AI primers/synopses, GitHub + local repo sync — inspired by [github.com/dgdev25/helm](https://github.com/dgdev25/helm)) re-expressed entirely on agentbox's own substrate, deliberately rejecting helm's React/Fastify/Postgres stack, crate library, and Claude-CLI primer path:
  - `management-api/lib/project-tracker.js` — scans `[project_tracking].scan_dirs` one level deep for git repos, reads git metadata via `execFile` (no shell), mints a content-addressed `urn:agentbox:thing:<pubkey>:project-<sha>` per repo (and a `urn:agentbox:activity` scan receipt) through `lib/uris.js` — **no new URN kind** (Code-as-Harness precedent, PRD-008). Fail-open per repo; idempotent on the content-addressed id.
  - `management-api/observability/project-metrics.js` — ten `agentbox_project_*` Prometheus series on the **shared registry**, so they appear on the existing port-bound `/metrics` (9090 + 9091, `0.0.0.0`) with **no new port** (ADR-035 §D2). Labels carry the project **slug** (never the host path) and the public `owner_did` — privacy-by-default.
  - `management-api/lib/project-primer.js` — optional AI primer/synopsis via the Z.AI/GLM consultant (ADR-011), 2-slot concurrency cap; persisted through the **memory adapter** (ns `project-tracking-primers`), never a new slot.
  - `management-api/routes/projects.js` — `GET/POST /v1/projects[...]` (list, detail, 30-day activity, scan, primer, publish); self-gates `503` when `[project_tracking].enabled` is not true; emits JSON-LD when `[linked_data]` is on.
  - **kind-30841** addressable project-tracking digest in `services/nostr-pod-bridge` (`ProjectTrackingDigest`, `publish_project_tracking`, `track` subcommand) — sibling of the kind-30840 session summary, NIP-33 `d`-tag = project slug, signed by the agent key, dual-written to pod + relay; `config/hooks/project-tracking-publish.cjs` is the Node sibling of `nostr-session-summary.py`.
  - `agentbox.toml [project_tracking]` manifest block (disabled by default); `30841` added to `[sovereign_mesh.relay].allowed_kinds`.
  - Tests: `tests/sovereign/project-tracker.test.js`, `tests/sovereign/project-metrics.test.js`, and Rust unit tests for kind-30841.
- `management-api/adapters/manifest-loader.js`: the minimal TOML parser now parses inline arrays of scalars (quote-aware), fixing the silent string-not-array result for keys like `[project_tracking].scan_dirs` and `[sovereign_mesh.relay].allowed_kinds` when read from JS.
- Self-learning hook loop pre-wired into every Claude-driven profile. Provisioned profiles previously shipped a bare `settings.json` with no hooks, so a fresh container had no auto-learning unless the ambient (non-baked) `~/.claude/helpers` bundle happened to exist. The loop now ships in the image and routes through the baked `claude-flow`/`ruflo` RuVector intelligence (SONA/MoE/HNSW) — and therefore the mandated ruvector-postgres backend (ADR-015) — rather than any local-SQLite learning store.
- `config/hooks/claude-flow-hook-adapter.cjs` — thin stdin→CLI adapter (baked to `/opt/agentbox/config/hooks/`). Claude Code delivers hook payloads as stdin JSON, but `claude-flow hooks <cmd>` takes typed flags (`--task`/`--file`/`--command`) and ignores stdin; wiring hooks straight at the CLI no-ops every turn. The adapter translates the payload, forwards only high-signal lines for `route`/`session-restore` (token-lean context injection), sets a writable `TRANSFORMERS_CACHE` so the embedder does not crash against the read-only Nix store, and always exits 0 so a hook can never break the session.
- **PRD-018 / ADR-036 gate enablement — retrieval gates and the learning producer are now live (2026-07-05).** All six `[integrations.ruvector_external]` retrieval flags (`hybrid_search`, `typed_metadata`, `metadata_gin`, `health_tool`, `episodic_ttl_sweep`, `memory_orient`) and `[memory_learning].enabled` + `record_trajectories` are flipped `true` in the production manifest — hybrid search, typed metadata/TTL, `memory_health`, `memory_orient`, and the trajectory-recorder hook are all active. `feed_retrieval`/`feed_routing` stay `false` (corpus-gated) until the trajectory corpus clears the Wilson floor (`aggregate_min_samples = 20`); `sona_enabled`/`relevance_feedback` remain reserved ADOPT-LATER. Default-off equivalence (PRD-018 metric 1) was re-verified immediately before enablement. The governed `ruvector-mcp.cjs` now exposes 24 tools (the legacy 20 plus `memory_hybrid_search`, `memory_orient`, `memory_health`, `memory_sweep_episodic`).
- **Vector store remediation (2026-07-05, all completed, all reversible).** `repair-namespaces`: 178,238 swapped namespace↔value rows un-swapped; recovery archive kept under `backups/ruvector-sidecar/`. `archive-legacy`: 2,014,173 frozen legacy/dead-hooks rows (predicate namespaces `legacy/%`, `swarm/%`, `hooks:pre-bash`, `hooks:post-bash`, `performance-metrics`, `command-results`, `command-history`) exported to an 11G cold archive (`archive-legacy-20260705T101743Z.copy.gz`) plus a pre-delete snapshot volume, then deleted. `VACUUM FULL` on `memory_entries`: 34 GB → 614 MB (54 MB heap), HNSW + all indexes rebuilt. `backfill-embeddings`: the remaining 36 NULL-embedding rows embedded via Xinference `bge-small-en-v1.5` — 0 NULL embeddings remain of 46,271 total rows. `build-metadata-gin`: `idx_memory_metadata_gin` (jsonb_path_ops) built, taking tag `@>` queries from a ~344k-cost parallel seq scan to a ~7.5-cost bitmap index scan. Store now stands at 46,271 rows, fully embedded, correctly namespaced, GIN+HNSW indexed, 614 MB.
- **`aci-shell` MCP packaged as a proper npm closure (2026-07-05).** `mcp/aci-shell` now builds via `makeNpmService` in `flake.nix` with `@modelcontextprotocol/sdk` pinned to `^1.0.0` (lockfile at `mcp/aci-shell/package-lock.json`, `npmDepsHash` prefetched) and its `node_modules` overlaid into `/opt/agentbox/mcp/aci-shell`. The entrypoint's phase-6 `_probe_closure` check now passes when `skills.aci_shell.enabled` is on.
- **Z.AI/GLM `reasoning_effort` wired end-to-end (deep thinking).** New `[consultants.zai].reasoning_effort` manifest key (`low | medium | high`). Plumbing: manifest → `provision-agent-stacks.py` exports `AGENTBOX_ZAI_REASONING_EFFORT` → `skills/mcp.json` consultant-zai env passthrough (default `high`) → `zai/server.js` maps it to Claude Code `MAX_THINKING_TOKENS` (`low`=4096, `medium`=10000, `high`=31999) → the Z.AI Anthropic-compatible endpoint (`api.z.ai/api/anthropic`) translates the thinking block into GLM `reasoning_effort`; unset falls back to the endpoint default. `glm-5.2` (1M context) remains Z.AI's flagship model and ours everywhere (`consultants.zai.model`, `project_tracking.primer_model`, `mobile_bridge.summary_model`).

### Changed

- `scripts/provision-agent-stacks.py`: `build_profile()` now emits `env` (`CLAUDE_FLOW_HOOKS_ENABLED`, `CLAUDE_FLOW_V3_ENABLED`, `TRANSFORMERS_CACHE`, `HF_HOME`) and `hooks` (PreToolUse/PostToolUse/UserPromptSubmit/SessionStart/SessionEnd) blocks in every Claude-settings `settings.json`. `session-end` is bound to `SessionEnd` only (never `Stop`) so per-session consolidation does not fire every turn; every hook command carries `|| true` and a timeout for fail-open resilience. `no_claude_settings` profiles are unaffected.
- `config/artifact-probes.json`: new non-fatal `self-learning-hook-adapter` probe (`node --check` on the baked adapter).
- **Capability matrix green batch (2026-07-05) — PRD-008 Phase 2 and related surfaces flipped live.** `skills.browser.agent_browser`, `skills.browser.qe_browser`, `skills.voyager_skill_library.enabled`, `skills.aci_shell.enabled`, `skills.tree_search_coder.enabled` (dependencies `code_interpreter` and `expel_lesson_extraction` were already on — PRD-008 Phase 2 is now fully live), `skills.design.open_design`, `project_tracking.enabled` + `project_tracking.nostr_publish` (kind-30841 digests; `github_enrichment` stays off pending `GITHUB_TOKEN`, `primer_on_scan` stays off), `integrations.solid_pod_rs.sign_requests` (the pods adapter now originates signed NIP-98), and `linked_data.viewer.expose_port` are all `true` in the live manifest.
- **`skills.browser.playwright` deprecation reaffirmed.** `playwright` stays `false` — browser automation is superseded by the external browsercontainer sidecar (`browser` / `browser-automation` skills, chrome-devtools-mcp at `browsercontainer:8931`). `[security.exceptions.playwright]` is intentionally absent from the manifest.
- **Setup dashboard refreshed for the current section set (2026-07-05).** `setup/frontend/dist/app.js` `SECTION_META` now covers all 26 top-level `agentbox.toml` sections, including `memory_learning`, `memory_hygiene`, `project_tracking`, and `federation`; the services grid shows "RuVector PG :5432" and drops the retired embedded `:9700` service card. `docs/user/setup-dashboard.md`'s sections table matches.

### Fixed

- **`repair-namespaces` `::jsonb` cast now guarded by `pg_input_is_valid()` (PG17).** Prevents the repair op throwing on malformed JSON payloads mid-repair; truncated originals are preserved as `{"raw":...,"truncated":true}` instead of being dropped or crashing the run.
- **`agentbox.sh cmd_restore` now uses `COMPOSE_ARGS`.** A bare `-f docker-compose.yml` silently dropped `RUVECTOR_PG_CONNINFO`/`RUVECTOR_PG_PASSWORD`, which are only injected via `docker-compose.override.yml`. `cmd_restore` now includes the override file like every other compose invocation in `agentbox.sh`.

### Removed

- **Telegram/CTM mirror removed entirely.** The phone↔agent path is now pure Nostr: an Android Nostr client (Amethyst + Amber signer) talks to the embedded relay, holding its own key plus a NIP-26 delegation from `[sovereign_mesh.operator]` — no private key is shipped to the device. Inbound NIP-59 gift wraps (kind 1059) are unwrapped by `services/nostr-pod-bridge` (consuming `nostr-bbs-core` + `solid-pod-rs-nostr`) and persisted to the pod inbox; a kind-30840 session-summary is dual-written to relay + pod as the durable conversation record. Dropped surfaces: `[sovereign_mesh].telegram_mirror` flag, the `[sovereign_mesh.telegram]` config block, `[security.exceptions.telegram-mirror]`, the `CTM_BOT_TOKEN`/`CTM_TELEGRAM_CHAT_ID` env-var preconditions, and validator rule **E014** (now retired). Removed from manifest, schema, flake, entrypoint, management-api, the TUI manifest read/write scripts, the setup wizard, and the config/semantic test suites. Operator + Android onboarding: `docs/user/mobile-bridge.md`.

### Notes

- Builds on `b82dacba` (better-sqlite3 native bridge). That fix is load-bearing here: without it `claude-flow` falls back to the sql.js WASM backend that silently drops writes, so the hook loop's edit/command/session learning would not persist. The `native-sqlite-backend` probe verifies the bridge; the new adapter probe verifies the wiring.

## [Code-as-Harness Sprint] - 2026-05-21

Phase 1 of PRD-008 code-as-harness integration. Persistent Python kernel MCP, ExpeL post-task lesson distillation, and SWE-agent ACI MCP scaffold — all manifest-gated. Phase 2 surfaces (voyager_skill_library, aci_shell, tree_search_coder) ship as scaffolding only, `enabled = false` by default.

### Added

- PRD-008 + ADR-018 + ADR-019 + ADR-020 + DDD-005 specifying code-as-harness integration (persistent kernel, experiential learning, ACI, tree-search)
- `code-interpreter` MCP (`mcp/code-interpreter/`) — 6-tool persistent IPython kernel: `kernel.exec`, `kernel.list_vars`, `kernel.inspect`, `kernel.reset`, `kernel.interrupt`, `kernel.install_pkg`
- ExpeL lesson-extractor (`mcp/expel/distil.py`, `skills/expel-lesson-extractor/`) — post-task `DistilledLesson` distillation into RuVector namespace `code-harness-lessons`
- `aci-shell` MCP (`mcp/aci-shell/`) — 5-tool SWE-agent interface: `aci.view_file`, `aci.edit_file`, `aci.search_repo`, `aci.run_tests`, `aci.submit` (Phase 2 scaffold)
- Voyager skill library (`mcp/voyager/`, `skills/voyager-skill-library/`) — Phase 2 scaffold with three-step `VerificationGate` (BannedAPI scan → kernel assertion execution → example execution) and RuVector namespace `code-harness-skills`
- `codeact` skill (`skills/codeact/SKILL.md`) — kernel orchestration with ICL exemplars and skill-router disambiguation
- `tree-search-coder` skill stub (`skills/tree-search-coder/SKILL.md`) — Phase 2-3 scaffold, `enabled = false`
- Multi-tier memory wiring via OWL2 classes: `ex:DistilledLesson`, `ex:VerifiedSkill`, `ex:ExecutionTrace`, `ex:KernelSession`, `ex:Activity` — discriminated by `source_type` field on existing `memory_entries` schema; no new tables
- Manifest gates added to `agentbox.toml`: `[skills.code_interpreter]`, `[skills.codeact]`, `[features.expel_lesson_extraction]`, `[skills.voyager_skill_library]`, `[skills.aci_shell]`, `[skills.tree_search_coder]`
- Nix derivations for `codeInterpreterPythonEnv`, local wheelhouse, `code-interpreter` MCP binary, and `aci-shell` MCP binary — gated by manifest
- 7 test fixtures: `tests/code-harness/multi-turn-fibonacci.sh`, `tests/code-harness/kernel-interrupt.sh`, `tests/code-harness/lesson-retrieval-queries.json`, `tests/code-harness/aci-view-line-cap.sh`, `tests/code-harness/aci-edit-diff-ctx.sh`, `tests/code-harness/aci-search-truncation.sh`, `tests/fixtures/skill-router-prompts.json`
- Ecosystem-consistent identity on every record: `owner_did = did:nostr:<hex>`, `action_urn = urn:agentbox:activity:<scope>:<verb>-<id>`, PROV-O Activity alignment
- Operator and developer guide at `docs/developer/code-as-harness.md`

### Changed

- `agentbox.toml`: 6 new manifest gate blocks added under `[skills.*]` and `[features.*]`
- `flake.nix`: `codeInterpreterPythonEnv` derivation + wheelhouse path + `code-interpreter` MCP + `aci-shell` MCP packages, all gated by manifest booleans
- `config/entrypoint-unified.sh`: code-harness bootstrap (wheelhouse marker check, audit directory creation) + `did:nostr` env propagation to kernel MCP process environment
- `config/artifact-probes.json`: 3 new readiness probes (kernel MCP liveness, wheelhouse marker, ExpeL hook registration)
- `skills/SKILL-DIRECTORY.md`: 3 new active skills (codeact, expel-lesson-extractor, voyager-skill-library) + 1 Phase 2-3 scaffold (tree-search-coder); header count updated from 89 to 92; new "Code Execution and Experiential Learning" section; `[H2]` routing block with explicit disambiguation from sparc:code, pytorch-ml, deepseek-reasoning, codebase-memory, and build-with-quality
- `agentbox/CLAUDE.md`: code-as-harness URN allocation paragraph added to URI/URN Scheme section; `code-as-harness.md` and `ecosystem.md` added to "Docs To Keep In Sync"
- `docs/developer/ecosystem.md`: code-as-harness domain added as sixth participant in the `did:nostr` identity mesh

### Notes

- Wheelhouse hashes in `flake.nix` use `lib.fakeHash`; refresh with `nix build .#default` on first use — Nix will report the correct hash to substitute
- Phase 2 surfaces (`voyager_skill_library`, `aci_shell`, `tree_search_coder`) ship as scaffolding only; defaults `enabled = false`; ADR-020 status remains `Proposed` until ADR-018 Phase 1 acceptance gate passes
- Validator error codes added: E042, E043, E044, E050, E051, E052; warnings W042, W043, W044, W050, W051, W052 — see `scripts/agentbox-config-validate.js`
- Privacy filter (ADR-008) applied to all `ExecutionTrace` stdout/stderr and `DistilledLesson` evidence before RuVector write; `LessonRedactionFailed` / `TraceRedactionFailed` events emitted on filter unavailability

## [Security Audit Sprint] - 2026-05-11

DreamLab ecosystem-wide security audit. 7 fixes applied to agentbox
covering P0 critical, P1 high, P2 medium, and Round 2 P0 findings.

### Security

- **P0-10**: Binary payload buffer size corrected from 15 to 19 bytes in
  agent-event-publisher.js, fixing a 4-byte under-read that silently
  truncated agent-action event payloads and could cause downstream
  parsers to misinterpret the trailing fields
- **P0-11**: NIP-98 structural validation fallback changed from soft
  accept to hard reject in auth.js; malformed NIP-98 tokens that lack
  required fields are now rejected instead of being treated as valid
  with default values
- **R2-P0-02**: Command injection vulnerability fixed in
  system-monitor.js by replacing child_process.exec() with execFile(),
  preventing shell metacharacter injection through monitoring parameters
- **R2-P0-03**: --dangerously-skip-permissions flag removed from
  process-manager.js; child Claude Code processes now run with the
  standard permission model

### Fixed

- **P1-27**: ComfyUI simulation stub replaced with real backend
  integration in comfyui-manager.js, connecting to the actual ComfyUI
  API instead of returning synthetic responses
- **P1-28**: Payment gate enforces server-side cost table in
  payment-gate.js, preventing clients from submitting arbitrary payment
  amounts that bypass the configured tier pricing

### Added

- **P2-10**: Linked-data input schema validation in input-validator.js,
  rejecting payloads that do not conform to the expected JSON-LD
  structure before they reach adapter dispatch

### `did:nostr` carries pubkey hex, not bech32 npub (2026-04-25)

The DID grammar in ADR-013 now specifies BIP-340 x-only pubkey hex
(64 lowercase hex chars) as the canonical agent identifier:

```
identity-uri ::= "did:nostr:" pubkey-hex
                 ; was: "did:nostr:" npub
```

Why pubkey hex:

* Matches the broader DID ecosystem (`did:ethr`, `did:pkh`) where
  identifiers are raw hex / chain-prefixed hex, not bech32.
* Lets non-Nostr tooling (W3C VC verifiers, generic DID resolvers,
  monitoring stacks) interpret an agentbox DID without bundling a
  bech32 decoder.
* Aligns the URN scope grammar
  (`urn:agentbox:<kind>:<pubkey>:<local>`) with the DID grammar so a
  monitoring tool can pivot between identity URIs and named
  resources by string-prefix matching alone.

What changed:

* `management-api/lib/uris.js`:
  - `DID_NOSTR_RE` now matches 64-char lowercase hex.
  - `mint()` parameter renamed `npub` → `pubkey`. The deprecated
    `npub` alias is still accepted at the boundary (with bech32
    decoding via `nostr-tools` when available) so callers below
    the URI layer don't break during the rename.
  - `parse()` now returns `{ scheme, kind, pubkey, local }` instead
    of `{ ..., npub, ... }`.
* All eleven surface emitters (s01-pods through s11-http-meta)
  refactored to call `uris.mint({ pubkey: ... })`.
* `routes/uri-resolver.js`, `viewer/manifest.js`, and pane sources
  updated to dereference the canonical `pubkey` field.
* `server.js` `/health` diagnostic prefers `AGENTBOX_PUBKEY` and
  falls back to `AGENTBOX_NPUB` for legacy deployments.

What stays as `npub`:

* Pod filesystem paths (`pods/<npub>/`) — Nostr-internal naming
  convention from PRD-004 / DDD-003.
* `mcp/nostr-bridge/` and DDD-003 / ADR-009 / PRD-004 references —
  the bech32 npub is the Nostr-protocol-native identifier outside
  the DID layer.
* `solid-pod-rs`'s did-nostr Cargo feature accepts both pubkey hex
  and bech32 npub at the resolver, so existing operator scripts
  using either form continue to work.

Spec updates:

* [ADR-013](docs/reference/adr/ADR-013-canonical-uri-grammar.md) §1
  grammar, §3 surface refactor table, §6 extension API.
* [PRD-006 §16](docs/reference/prd/PRD-006-linked-data-interfaces.md#16-canonical-uri-grammar-adr-013-cross-reference)
  cross-reference grammar.
* [DDD-004 §URICanonicaliser](docs/reference/ddd/DDD-004-linked-data-interchange-domain.md#uricanonicaliser)
  ubiquitous language.
* [`docs/user/uris.md`](docs/user/uris.md) — every worked example
  now uses pubkey hex; the "When is the pubkey scope present?"
  section replaces the npub equivalent.
* [`docs/user/browser.md`](docs/user/browser.md) — every clickable
  per-surface URL uses the canonical hex form.
* `README.md`, `CLAUDE.md`, `docs/README.md`, `docs/user/glossary.md`,
  `docs/user/sovereign-stack.md`, `docs/user/solid-pod.md`,
  `docs/user/linked-data.md`, `docs/developer/sovereign-mesh.md`,
  `docs/reference/adr/ADR-010-rust-solid-pod-adoption.md`,
  `docs/reference/adr/ADR-012-jsonld-federation-grammar.md`,
  `schema/agentbox.toml.schema.json`, `agentbox.toml` — every
  occurrence of `did:nostr:<npub>` replaced with `did:nostr:<pubkey>`.

Tests updated to use 64-char hex pubkey fixtures across
`tests/contract/linked-data/{uris,surfaces,viewer}.contract.spec.js`,
including a new test asserting the deprecated `npub` parameter alias
in `uris.mint()` still produces an identical URI to the canonical
`pubkey` parameter.

### Viewer slot + canonical URI grammar — PRD-006 §15-§16 / ADR-013 / DDD-004 §URICanonicaliser §ViewerSurface (2026-04-25)

Two aligned additions extending the linked-data work shipped earlier today:

**S12 — Linked-Object Viewer.** A new federation surface mounting an
interactive JSON-LD-aware browser at `/lo/*` so every PRD-006 emit
surface (S1–S11) is one URL away. First implementation:
[linkedobjects/browser](https://github.com/linkedobjects/browser)
(Melvin Carvalho et al., AGPL-3.0), pinned via `lib/linkedobjects-browser.nix`
to commit `8260dc5`. The slot accepts other viewer implementations
behind the same `/lo/manifest.json` contract — operators can swap to
an external instance without rebuilding the image. Six agentbox-specific
built-in panes ship under `management-api/middleware/linked-data/viewer/panes/`:

- `vc-pane.js` — S3 VCs and S8 payment receipts/mandates
- `provenance-pane.js` — S5 PROV-O records and S11 agent-event streams
- `capability-pane.js` — S6 WoT Thing Descriptions
- `runtime-pane.js` — S11 RuntimeContract
- `dcat-pane.js` — S9 DCAT memory namespace catalogues
- `handoff-pane.js` — S2 agbx:HandoffClaim / RequestBriefing / DeliverArtefact

The pane manifest endpoint at `/lo/manifest.json` merges three pane
sources: upstream linkedobjects/browser panes, agentbox-built-in panes,
and operator-supplied panes (`[linked_data.viewer].extra_panes`).
Adding a pane is a one-line manifest operation; agentbox first-party
code never imports a pane directly.

AGPL-3.0 §13 compliance: every response from `/lo/*` carries
`Source-Code: https://github.com/linkedobjects/browser` plus
`X-Viewer-{Source,Version,License}` headers. Aggregation analysis
matches the solid-pod-rs treatment in `docs/developer/licensing.md`
— the bundle is shipped as static assets served by the management-api,
never linked into agentbox first-party JavaScript. Both agentbox and the
viewer are AGPL-3.0.

**ADR-013 — Canonical URI grammar.** Every `@id` value emitted by a
PRD-006 surface now follows the canonical URI grammar:

```
identity-uri   ::= "did:nostr:" pubkey-hex   ; BIP-340 x-only, 64 lc hex
name-uri       ::= "urn:agentbox:" kind ":" [scope ":"] local
content-hash   ::= "sha256-12-" 12HEXDIGIT
```

Two contracts: **uniqueness is unconditional** (every URI minted by
`uris.mint()` is globally unique by construction; same payload → same
URI, every time), **resolvability is best-effort** (the `/v1/uri/<urn>`
resolver returns 307/404/410). Three minting rules — content-addressed
for payload-determined resources, scope-bearing for owner-attached
resources, stable-on-identity for static labels.

The eleven surfaces (s01-s11) refactored to call `management-api/lib/uris.js`
instead of generating IDs locally. Every `urn:uuid:*` random fallback
removed. The pre-existing `urn:agentbox:mcp:*` and `urn:agentbox:memory:*`
shapes from S6/S9 generalised through the new mint library.

The viewer (S12) follows `@id` URIs through `/v1/uri/<urn>`, rendering
307 results in the matching pane and 404 results as the URN literal
with a "no representation available" badge.

**Implementation:**

- `lib/linkedobjects-browser.nix` — pinned commit + AGPL-3.0 attribution
- `management-api/lib/uris.js` — canonical URI mint+resolve library
- `management-api/middleware/linked-data/viewer/` — encoder + pane registry + manifest builder + 6 built-in panes
- `management-api/routes/linked-objects.js` — `/lo/*` static-asset surface with AGPL §13 headers and traversal guards
- `management-api/routes/uri-resolver.js` — `/v1/uri/<urn>` resolver + self-describing `/v1/uri` endpoint
- `flake.nix` — viewer derivation materialised at `/opt/agentbox/browser/` when `[linked_data.viewer].mode = "local-linkedobjects"`
- `scripts/prefetch-hashes.sh --service linkedobjects-browser` — resolves the pinned `srcHash` on first build

**Schema + validator** — new `[linked_data.viewer]` section plus rules
**E050–E054** and **W053** in `scripts/agentbox-config-validate.js`.

**Documentation:**

- [ADR-013](docs/reference/adr/ADR-013-canonical-uri-grammar.md) — the URI grammar decision
- [PRD-006 §15](docs/reference/prd/PRD-006-linked-data-interfaces.md#15-viewer-slot-s12) — viewer slot product spec
- [PRD-006 §16](docs/reference/prd/PRD-006-linked-data-interfaces.md#16-canonical-uri-grammar-adr-013-cross-reference) — URI grammar cross-reference
- [DDD-004 §URICanonicaliser](docs/reference/ddd/DDD-004-linked-data-interchange-domain.md#uricanonicaliser) and [§ViewerSurface](docs/reference/ddd/DDD-004-linked-data-interchange-domain.md#viewersurface) plus invariants L13–L18
- [`docs/user/uris.md`](docs/user/uris.md) — operator one-pager on the URI grammar with 12 worked examples
- [`docs/user/browser.md`](docs/user/browser.md) — comprehensive viewer walkthrough; surface-by-surface clickable URLs; pane-authoring guide

**Tests** — `tests/contract/linked-data/`:

- `uris.contract.spec.js` — L13–L15 (uniqueness, pure-function resolver, closed kinds)
- `viewer.contract.spec.js` — L16–L18 (no traversal, AGPL §13 header, data-driven manifest)

**Attribution** baked into every layer:

- `lib/linkedobjects-browser.nix` — module header credits Carvalho + AGPL-3.0
- `routes/linked-objects.js` — emits `Source-Code` header per AGPL §13
- `viewer/index.js` + `viewer/panes/*.js` — file-level attribution to upstream + Solid lineage
- `docs/user/browser.md` + `docs/user/uris.md` — attribution sections crediting the W3C / IETF / DCMI / Schema.org sources every surface binds to

In memoriam **Gregg Kellogg** (d. 2025-09-06), referenced in every spec
this work depends on.

### Linked-Data interchange — PRD-006 / ADR-012 / DDD-004 (2026-04-25)

Adopt W3C JSON-LD 1.1 as the canonical encoding at every external
interchange surface. Eleven federation surfaces (S1 pods, S2 Nostr
envelopes, S3 Verifiable Credentials, S4 DID Documents, S5 PROV-O
provenance, S6 WoT capability descriptors, S7 skill metadata, S8
agentic-payment mandates and receipts, S9 DCAT memory catalogues, S10
ADR/PRD/DDD frame frontmatter, S11 content-negotiated /v1/meta and
/v1/agent-events) gated under a new top-level `[linked_data]` section
in `agentbox.toml`. Default off — clone-and-build sees zero behavioural
change. Each per-surface gate accepts `on` / `emit` / `off`.

**`management-api/middleware/linked-data/`** — encoder + context
resolver + LION linter + JCS canonicaliser + round-trip helper plus
eleven surface modules. The encoder is the third cross-cutting
middleware after observability (ADR-005) and the privacy filter
(ADR-008); the order is fixed in code (DDD-004 §L08), the manifest
key is documentation only, and the validator (E048) rejects any other
value. Wires `jsonld@^8` (BSD-3-Clause; Digital Bazaar) for the JSON-LD
processor.

**`lib/linked-data-contexts.nix`** — build-time-pinned `@context`
catalogue. Same FOD-everything pattern as `lib/npm-cli.nix` and
`lib/solid-pod-rs.nix`. Materialises ActivityStreams, VC v2, DID v1,
Schema.org, WoT TD, PROV-O, DCAT-3, ODRL 2.2, SKOS, Dublin Core Terms,
and the first-party `agbx:` extension into one read-only directory at
`/opt/agentbox/contexts/`. The runtime resolver loads the index once at
boot and never performs network I/O thereafter (DDD-004 §L09).

**`scripts/prefetch-hashes.sh --linked-data`** — new flag mirroring
`--cli` + `--service`. Walks the catalogue, resolves every
`lib.fakeHash` to a real SRI hash via `nix-prefetch-url`, patches the
file in place. Up to 20 iterations.

**Schema + validator** — new `[linked_data]` section in
`schema/agentbox.toml.schema.json` plus rules **E040–E049** in
`scripts/agentbox-config-validate.js`:

- E040 master gate enforces per-surface gates
- E041 pods needs local-solid-rs/external
- E042 events needs the embedded relay
- E043 credentials/payments need JCS
- E044 did_documents need a Solid pod
- E045 context override IRIs must be non-empty
- E046 cache-mode=off blocks user-touching surfaces
- W047 fail-open + pods=on is dangerous (advisory)
- W048 linked-data on without privacy filter (advisory)
- E048 privacy_handoff.order must be "after"
- E049 did:nostr requires the did-nostr Cargo feature

**Hand-authored documents (LION subset).** Linked Object Notation
([Carvalho 2024, MIT-licensed](https://linkedobjects.github.io/)) is
the authoring subset for skill frontmatter, ADR/PRD/DDD frontmatter,
and human-reviewed mandates. Five rules — `@id` is a URL, `@type` is
optional, `@context` defaults are inherited, properties are URLs or
known terms, no `@protected` overrides. Every LION document is valid
JSON-LD 1.1 by construction.

**Documentation.** New canonical specs:

- [PRD-006](docs/reference/prd/PRD-006-linked-data-interfaces.md)
- [ADR-012](docs/reference/adr/ADR-012-jsonld-federation-grammar.md)
- [DDD-004](docs/reference/ddd/DDD-004-linked-data-interchange-domain.md)

Operator one-pager at [`docs/user/linked-data.md`](docs/user/linked-data.md);
implementer reference at [`docs/developer/linked-data.md`](docs/developer/linked-data.md);
`agbx:` term registry at [`docs/reference/_vocab/agbx.md`](docs/reference/_vocab/agbx.md);
in-tree first-party context document at
[`docs/reference/_vocab/agentbox-v1.context.jsonld`](docs/reference/_vocab/agentbox-v1.context.jsonld).

**Tests.** `tests/contract/linked-data/`:

- `invariants.spec.js` — DDD-004 §L01–L12
- `jcs.spec.js` — RFC 8785 vector subset
- `surfaces.spec.js` — per-surface smoke tests

**Attribution.** Stands on the shoulders of W3C JSON-LD 1.1 (Gregg
Kellogg in memoriam, Pierre-Antoine Champin, Dave Longley), W3C VC
Data Model 2.0, W3C DID Core, ActivityStreams 2.0, PROV-O, Schema.org,
Web of Things TD 1.1, DCAT-3, ODRL 2.2, SKOS, Solid Protocol, JCS
RFC 8785, jsonld.js (Digital Bazaar), and the LION specification.
Full bibliography in [PRD-006 §14](docs/reference/prd/PRD-006-linked-data-interfaces.md#14-acknowledgements-and-attribution).

### Sandbox-safe npm-cli builds + nagual-qe Rust source build (2026-04-25)

Building agentbox no longer requires `--option sandbox false` or live
internet access from inside regular Nix derivations.

**`lib/npm-cli.nix` — FOD `node_modules`.** The helper that packages
global npm CLIs (ruvector, claude-flow, ruflo, agentic-qe, agent-browser,
playwright, mermaid-cli, codebase-memory-mcp) used to call
`npm install --production` inside a regular derivation. Sandboxed Nix
blocks network for non-FOD builds, so the install raised
`npm error code EAI_AGAIN` against `registry.npmjs.org`. The helper now
splits the install into a separate fixed-output derivation whose
`outputHash` is the new `nodeModulesHash` parameter — FODs are
hash-verified, so the sandbox permits network access. Network never
touches the wrapper-creation step. Stage 1 (tarball FOD) + stage 2
(`node_modules` FOD) + stage 3 (regular wrapper derivation).

Each `mkNpmCli` call in `flake.nix` now carries an explicit
`nodeModulesHash`. Eight entries are seeded with `lib.fakeHash` and
must be resolved on the first build of a fresh clone — see
[`docs/user/troubleshooting.md` §"`nix build .#runtime` fails with a
hash mismatch"](docs/user/troubleshooting.md#nix-build-runtime-fails-with-a-hash-mismatch).

**`lib/nagual-qe.nix` — Rust source build.** `nagual-qe` was previously
wired through `mkNpmCli` with `lib.fakeHash` because the upstream is
not on npm. The actual project at
[`proffesor-for-testing/nagual-qe`](https://github.com/proffesor-for-testing/nagual-qe)
is a Rust crate with `Cargo.lock` at the repo root and a `nagual` binary
exposed by `src/main.rs`. The new `lib/nagual-qe.nix` builds it via
`buildRustPackage` with `useFetchCargoVendor + cargoHash` — the same
hash-verified-FOD pattern used by `lib/solid-pod-rs.nix`. Default
features `kos + onnx-embed + serve` ship by default; `tui` is excluded
(non-interactive runtime).

A `nagual-qe` symlink to the canonical `nagual` binary is installed
under `$out/bin` so existing call-sites stay untouched:
- `scripts/provision-agent-stacks.py` (`tools: ["nagual-qe", "agentic-qe", "aqe"]`)
- `config/artifact-probes.json` (`@NIX_STORE_BIN@/nagual-qe`)
- `[program:nagual-qe]` supervisor block (when added).

**`scripts/prefetch-hashes.sh` — `--cli` mode + `nagual-qe` target.**
Two new flags:
- `--cli` — runs `nix build .#runtime` in a loop, parses each
  `hash mismatch in fixed-output derivation` block, patches the
  matching `nodeModulesHash` (npm CLI) or `cargoHash` (nagual-qe)
  line, repeats until the build is clean. Up to 20 iterations.
- `--service nagual-qe` — resolves `srcHash` against the pinned
  upstream rev (parallel to `--service solid-pod-rs`).

Dispatch logic identifies which file to patch from the FOD's `.drv`
filename: `<pname>-with-deps-<version>` → npm CLI `nodeModulesHash`;
anything containing `vendor` → nagual-qe `cargoHash`.

**Build flow on a fresh clone:**
```sh
./scripts/prefetch-hashes.sh
# 1. Resolves npmDepsHash for management-api, mcp/, mcp/consultants/,
#    skills/*/mcp-server/ — uses nixpkgs#prefetch-npm-deps.
# 2. Resolves srcHash for solid-pod-rs and nagual-qe.
# 3. Iterative build loop fills in nodeModulesHash × 8 + cargoHash × 1.
nix build .#runtime
```

No more `--option sandbox false`. No more silent failures shipping
empty `node_modules` trees. The hardening cited in `lib/npm-cli.nix`
header comment is now structurally enforced rather than aspirational.

### Validator audit + cleanup; QE fleet pass over E001-E041 (2026-04-25)

A three-agent QE pass (tester, code-analyzer, researcher) audited every
E0XX/W0XX rule in `scripts/agentbox-config-validate.js` against current
repo reality. Four commits landed the consolidated findings:

**P0 — dead infrastructure removed** (commit `32b521ec`)
- `E015` retired. The rule gated a `jss-rust` flake input that was never
  declared. The JSS Rust crate work (did:nostr, NIP-98 Schnorr, webhook
  signing, rate-limit, quota, JSS v0.4 wire compat) had been absorbed
  into `solid-pod-rs` as default-on Cargo features when ADR-010 landed,
  but the placeholder field, schema entry, wizard checkbox, and
  validator rule were never cleaned up. **No capability was lost** —
  every JSS feature ships in the agentbox image today via
  `lib/solid-pod-rs.nix` `defaultFeatures`. ADR-010 §"JSS Rust crate
  lineage" documents the absorption mapping.
- `RESERVED_PORTS[8484]` label corrected from `'local JSS pods'` to
  `'solid-pod-rs'`; `RESERVED_PORTS[5901]` from `'wayvnc'` to `'x11vnc'`.
  Now matches what `supervisorctl status` and `docker ps` actually print.
- `management-api/adapters/pods/local-jss.js` renamed to
  `_solid-http-base.js`; class `LocalJssPodsAdapter` → `SolidHttpPodsAdapter`.
  The file is a generic Solid HTTP base shared by `local-solid-rs.js`
  and `external.js` — the JSS-specific name was historical baggage.
- `relay.implementation = "rnostr"` dropped from the schema enum (no
  flake supervisor branch wires it up; was never functional).
- `agentbox.toml` header comment block rewritten — no longer references
  the retired `local-jss` default or W034.

**P1 — severity recategorisations + logic fixes** (commit `ffc686a5`)
- `E012 → W012`, `W021 → E021`, `E031 → W031`, `E038 → W038`. W-codes
  exit 0 with advisory; E-codes block. The renames make the prefix
  match the actual exit-code semantic the rule has always had.
- `E018` `.env.example` heuristic dropped — was checking the manifest
  filename, never matched, was suppressing nothing.
- `E022` message distinguishes "mode is unset" from explicit `mode="off"`.
- `E017` fallback `${NAME}_API_KEY` removed (schema makes `env_var`
  required; fallback was unreachable and silently wrong for gemini and
  github).
- `W040` message rewritten to admit oauth on a non-capable provider is
  silently ignored; no graceful "fall-back to E017" exists.
- `E037` zai gate added — `consultants.zai` now requires
  `toolchains.claude` (the `claude-zai` wrapper bundles with that
  toolchain). Previously zai was silently exempt.

**P2+P3 — gap rules + retired E011** (commit `1847281c`)
- `E011` retired — duplicated by AJV `additionalProperties:false`
  (schema layer catches unknown skill keys via E016 first); the
  hardcoded `KNOWN_SKILLS` snapshot also drifted from the actual corpus.
  Replacement idea preserved in the docstring (consume `nix build .#skills`
  artefact when that pipeline lands).
- `E028` extended: `relay.port` and `privacy_filter.port` collisions
  with `integrations.solid_pod_rs.port` are now caught.
- `E030` (new, blocking): `ingress_policy="open"` combined with
  `external_fanout="bidirectional"` is an unbounded ingress hole.
- `W039` (new, advisory): `ingress_policy="allowlist"` with empty
  `allowed_pubkeys` accepts only the local npub — usually a
  copy-paste error.
- `W041` (new, advisory): `privacy_filter.policy.<slot>` declares a
  non-default value while `privacy_filter.enabled=false` — dead
  config until the master gate flips on. Fires on the shipped
  manifest because the policy slots are pre-staged.

**Wizard side-effects already pushed earlier** (commits `4a357a56`,
`fede1178`, `7f031f7a`)
- Ctrl+C aborts the configurator cleanly (signal trap + propagation
  through subshell pipelines).
- Web sign-in (`auth_mode = "oauth"`) for anthropic, openai, zai
  providers — skip API-key prompt, defer to in-container `claude
  login` / `codex login` / `claude-zai login`. New advisory `W040`
  flags oauth on non-capable providers.
- Validator advisory warnings (W-codes) now show in a non-blocking
  info box instead of looping the section forever.
- Codex consultant cascade fixed (E035/E037 chain).

**Net rule surface:** 32 active codes (28 errors + 4 warnings + 4 new
advisories). 6 retired with documented rationale. 63 jest tests pass.
The shipped `agentbox.toml` validates clean (rc=0) with one expected
W041 advisory on the pre-staged privacy policy.

See `docs/reference/adr/ADR-005-pluggable-adapter-architecture.md` for
the full validation rule index.

### local-jss removed; solid-pod-rs is the only first-party pod (2026-04-25)

Hard cut. The Python `local-jss` stub at `scripts/solid-pod-server.py` is
deleted; the schema enum no longer accepts `local-jss`; W034 is retired;
`pods = "local-solid-rs"` is the shipped default with the
`[security.exceptions.solid-pod-rs]` block uncommented. Manifests still
carrying `pods = "local-jss"` after the upgrade fail E016 schema validation.

**Build now actually works on a fresh clone with the shipped default.**
Three issues resolved to get there:

1. **Upstream rev 7f8bc89 ships no `Cargo.lock`.** Vendored a generated
   lockfile at [`lib/solid-pod-rs.cargo-lock`](lib/solid-pod-rs.cargo-lock)
   (497 packages, 5231 lines). `lib/solid-pod-rs.nix` switches from
   `cargoHash` to `cargoLock.lockFile`; `postPatch` copies the vendored
   lock into the source tree before `cargoBuildHook`. Refresh procedure
   documented inline in the derivation.
2. **Workspace member path was wrong.** `buildAndTestSubdir` corrected from
   `solid-pod-rs-server` to `crates/solid-pod-rs-server`.
3. **Cargo features live on the LIBRARY crate, not the server.** The server
   only forwards `tls`, `rate-limit`, `quota`, `did-nostr`,
   `security-primitives`. Library features (`nip98-schnorr`, `acl-origin`,
   `webhook-signing`, `config-loader`, `jss-v04`, `oidc`, `dpop-replay-cache`,
   `s3-backend`, `legacy-notifications`) now activated via cargo's
   `solid-pod-rs/<feature>` workspace-dep-path syntax in `defaultFeatures`
   and `solidPodRsExtraFeatures`.

`nix build .#runtime` succeeds end-to-end on a fresh clone:
solid-pod-rs-server compiles in ~60 s on a warm cargo cache (~15 min cold,
across 497 deps), the OCI image is assembled, `result` symlink populated,
`/nix/store/…-solid-pod-rs-server-0.4.0-alpha.1+sprint-9/bin` is on PATH.

**Files touched:**
- `agentbox.toml`: `pods = "local-solid-rs"`, `[security.exceptions.solid-pod-rs]` uncommented.
- `schema/agentbox.toml.schema.json`: `pods` enum drops `local-jss`.
- `scripts/agentbox-config-validate.js`: W034 branch removed; header docstring updated; `errors`/`warnings` audit refreshed.
- `flake.nix`: `[program:solid-pod]` legacy-Python branch removed; `solidPodRsExtraFeatures` use library-dep-path syntax.
- `lib/solid-pod-rs.nix`: `cargoLock.lockFile` + `postPatch` lockfile copy + corrected `buildAndTestSubdir` + library-dep-path features.
- `lib/solid-pod-rs.cargo-lock`: new vendored Cargo.lock.
- `scripts/solid-pod-server.py`: **deleted**.
- `scripts/tui-read-manifest.py`, `tui-write-manifest.py`: defaults flipped to `local-solid-rs`.
- `agentbox.sh`: `_solid_is_local` simplified to match only `local-solid-rs`.
- `tests/contract/pods.contract.spec.js`: `LocalJssPodsAdapter` import + IMPLS row removed; class file retained as private base for `LocalSolidRsPodsAdapter` inheritance.
- `tests/tui/fixtures/{valid-full,valid-minimal,valid-standalone,invalid-e001,invalid-e019}.toml`: `pods` flipped to `local-solid-rs`.
- ADR-005, ADR-010, PRD-001, configuration.md, solid-pod.md, glossary.md, sovereign-mesh.md, adapters.md, quickstart.md, backup-restore.md, troubleshooting.md: doc sweep removing legacy-stub references; ADR-010 Decision rewritten as "the only first-party impl".

`./scripts/agentbox-config-validate.sh` on the shipped manifest:
`agentbox manifest valid: agentbox.toml` (exit 0, no warnings).

### Consultant tier — meta-router as named-MCP dispatch (2026-04-25)

Five new MCP servers exposing external LLM providers as labelled consultants the coordinator (Claude Code / ruflo) can invoke explicitly. Specified by [PRD-005](docs/reference/prd/PRD-005-meta-router-consultants.md) and [ADR-011](docs/reference/adr/ADR-011-consultation-mcps.md); reasoned through in conversation against `musistudio/claude-code-router` (rejected as the meta-router because its API-rewriting layer does not fit agentbox's MCP-everywhere + per-user-CLI-isolation patterns).

**The five consultants:**

| Name | Backend | Why |
|---|---|---|
| `codex`      | OpenAI Codex Rust CLI subprocess | code reasoning, refactors, test gen |
| `gemini`     | `@google/gemini-cli` subprocess | 1M-token context for long documents |
| `zai`        | `claude-zai` (Z.AI / GLM-5) | Chinese-language reasoning, low cost |
| `perplexity` | Perplexity HTTPS API | live web with citations |
| `deepseek`   | DeepSeek HTTPS API | math + transparent chain-of-thought |

**Wire contract** (every consultant): `consult / health / cost_estimate`. Identical envelope across CLI-spawn and HTTPS-direct. Full schema in PRD-005 §3.

**Implementation:**
- `mcp/consultants/` — new top-level dir, single buildNpmPackage with five bin entries; shared scaffolding under `shared/` (consultant-base.js + memory-logger.js + spawn-cli.js).
- `mcp/consultants/<name>/server.js` — ~80 lines per consultant, all delegating to `BaseConsultant`.
- `agentbox.toml` — new `[consultants]` master gate + `[consultants.<name>]` per-consultant blocks.
- `schema/agentbox.toml.schema.json` — full validation shape.
- `scripts/agentbox-config-validate.js` — new rules **E035-E038** covering provider gates, master gate, toolchain gate, and intelligence-signal env requirements.
- `scripts/start-agentbox.sh` — new wizard section 3a; offered to operators after `[providers]` so credentials are in scope.
- `scripts/tui-read-manifest.py` / `tui-write-manifest.py` — round-trip preservation.
- `flake.nix` — new `consultantsPkg` derivation gated on the master gate; appRoot copies into `/opt/agentbox/mcp/consultants/`.

**Dispatch surfaces:**
- **Manual** — `skills/skill-router/SKILL.md` gains a `### Consultants` routing section. Operators write `/consult <name> "<question>"` in chat.
- **Automatic** — new `agents/auto-consultant.md` agent template. `Task({ subagent_type: "auto-consultant", prompt: "..." })` classifies the question (code → codex, math → deepseek, "current/latest" → perplexity, Chinese chars → zai, large context → gemini) and dispatches.

**Audit trail:**
- JSONL appended to `/var/lib/agentbox/consultations/<consultant>-<YYYY-MM-DD>.jsonl` per call, atomically.
- When `[consultants].intelligence_signal = true`, ADR-043 `QualitySignal` files also land under `/workspace/profiles/<stack>/intelligence/data/` so SONA learning loops absorb consultation verdicts.

**Docs:**
- New [docs/user/consultants.md](docs/user/consultants.md) — operator guide with enable/call/audit walkthroughs.
- [docs/user/glossary.md](docs/user/glossary.md) — added "Consultant" and "Meta-router" terms; new "Where to go next" row.
- [docs/README.md](docs/README.md) — sovereign-data-stack table extended with consultants row; ADR-011 + PRD-005 indexed.

**What this does NOT do:**
- Not a transparent API rewriter. We do not silently swap the model behind a Claude Code request. That layer (`claude-code-router`) stays an optional Phase-3 add-on, orthogonal to the consultant tier.
- Not a streaming surface. Phase-3 once MCP gains stable streaming.
- Not a fan-out / consensus tool. Each `/consult` call hits exactly one consultant. Consensus across consultants is a future PRD-005 §10 Phase-4 item.

### `nix build .#runtime` now succeeds end-to-end on a clean clone (2026-04-25)

Six chained defects between `nix build .#runtime` and a usable OCI image. Every one was hidden behind `|| true` in `lib/npm-cli.nix` since the helper was first written; removing that absorption (commit `133d1da4`) surfaced every defect. Each fixed in dependency order in commit `f0461f91`:

1. **`lib/npm-cli.nix` — sandbox TLS + HOME.** Cold sandbox had no CA trust store and `HOME=/homeless-shelter` (deliberately unwritable). Added `pkgs.cacert` to `nativeBuildInputs`; export `HOME=$TMPDIR`, `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS` before `npm install`.
2. **`lib/npm-cli.nix` — peer-dep conflicts.** Upstream `@claude-flow/aidefence` declares `peerOptional agentdb@">=2.0.0-alpha.1"` against the root's alpha-3.7; `@opentelemetry/api` has `>=1.0.0 <1.8.0` vs `^1.8.0` drift. Added `--legacy-peer-deps`.
3. **`lib/npm-cli.nix` — Nix `''` lexer trap.** JS empty-string literals (`''`) inside the `installPhase` heredoc terminated the Nix string; even the comments warning about it tripped it. Replaced every literal `''` with `[].join()` stored in `EMPTY` const. Same pattern applied in `lib/npm-services.nix`.
4. **`lib/npm-services.nix` — same peer-dep class on `buildNpmPackage` services.** Added `npmFlags = [ "--legacy-peer-deps" ]`.
5. **`lib/npm-services.nix` — symlink mismatch.** `postInstall` built `$out/package → $out/lib/node_modules/<nix-name>` but `buildNpmPackage` installs under the `package.json "name"` field. 5 of 6 services had names that differed (`management-api` → `agentic-flow-management-api`, `nostr-bridge` → `mcp-secure-scripts`, `lazy-fetch-mcp` → `lazy-fetch`, `playwright-mcp` → `playwright-mcp-server`, `comfyui-mcp` → `comfyui-mcp-server`). `postInstall` now reads the real name at build time via `node -e`, asserts the directory exists, and stamps the resolved store path into both the `$out/bin` wrapper and the `$out/package` symlink.
6. **`mcp/package-lock.json` — stale lockfile.** `package.json` declared `nostr-tools ^2.23.3` but the lockfile only had `ws`. `buildNpmPackage`'s `only-if-cached` install hit `ENOTCACHED`. Regenerated lockfile with `npm install --package-lock-only --legacy-peer-deps`; re-prefetched the `npmDepsHash`.
7. **`flake.nix` `appRoot` — read-only store copies.** `cp -r ${./mcp}` and friends arrived with the store's read-only bits, so subsequent overlay writes (node_modules, optional skill mcp-servers) hit `Permission denied`. One `chmod -R u+w $out/opt/agentbox` after the base copies, before any overlay.

`nix build .#runtime --no-link -L` now produces `/nix/store/…-image-agentbox.json` in <2 min on a warm store, ~25-40 min cold. All 14 workflow YAMLs still YAML-valid.

### `docker load < result` replaced with `nix run .#runtime.copyToDockerDaemon` (2026-04-25)

`nix2container` outputs an OCI manifest JSON, not a `docker save` tarball — `docker load < result` returns `archive/tar: invalid tar header`. The flake's `runtime` output exposes a `copyToDockerDaemon` helper that uses skopeo to load directly into the local daemon. Fixed in:

- `.github/workflows/build-multi-arch.yml`
- `agentbox.sh` (`cmd_up --build` and `cmd_build` final-message)
- `scripts/start-agentbox.sh` (action menu)
- `docs/user/quickstart.md` (Build the Image step)
- `docs/user/troubleshooting.md` (new "invalid tar header" entry)

### CI/CD refresh (2026-04-25)

Six new workflows + three updates + a prefetch helper. Full description in commit `0d8569f3`. Highlights:

**New PR gates** (all required via the new `ci.yml` aggregate):
- `manifest-validate.yml` — `agentbox config validate`, fixture round-trip, expected-error-code assertions, W-code advisory-vs-error audit.
- `runtime-contract.yml` — discovers and runs every `tests/runtime-contract/RC-*.sh`.
- `shellcheck.yml` — `error` severity blocks; `warning` informational.
- `ci.yml` — aggregate "CI passed" status check for branch protection.

**New post-merge / scheduled:**
- `image-scan.yml` — Trivy HIGH/CRITICAL gate + full-severity SARIF + CycloneDX + SPDX SBOMs to the Security tab and artefact store.
- `release.yml` — `v*` tag → extract CHANGELOG section + attach SBOMs + create GitHub Release; pre-release flag from `-alpha/-beta/-rc` suffix.

**Updated:**
- `build-multi-arch.yml` — Cachix TODO placeholders cleared, configurable via `CACHIX_CACHE_NAME` repo variable; closure + compressed image size captured to step summary; PRD-001 §8 5-GB compressed-size ceiling enforced; `nix run .#runtime.copyToDockerDaemon` replaces `docker load < result`.
- `flake-check.yml` — same Cachix cleanup; adds eval of `.#runtime.drvPath` and `.#compose.drvPath` to catch derivation-level regressions `--no-build` skips.
- `contract-tests.yml` — path triggers broadened to `mcp/nostr-bridge/`, `scripts/opf-router.py`, `management-api/package-lock.json`; push-to-main trigger added.

**New helper:**
- `scripts/prefetch-hashes.sh` (180 lines) — one-shot helper that walks every `lib.fakeHash` site, runs the appropriate `nix-prefetch-*` command, and patches the result into source. Idempotent; supports `--dry-run` and `--service` filters.

**Validator improvements** (commit `133d1da4`): `W030` and `W034` now route to a separate `warnings` array — printed to stderr but exit 0 — so advisory direction signals can no longer regress into fail-closed behaviour. `W021` stays in `errors` (intentional fail-closed; documented).

### solid-pod-rs Sprint 5-9 absorption (2026-04-24)

Upstream `main` moved 8 commits past the `v0.4.0-alpha.1` tag with
substantial sprint work. This change absorbs it.

**Pin:** `lib/solid-pod-rs.nix` rev bumped from `v0.4.0-alpha.1` to `main@7f8bc89` (Sprint 9 consolidation). Version label now reads `0.4.0-alpha.1+sprint-9`. Both `srcHash` and `cargoHash` remain `lib.fakeHash` until operator prefetch — same pattern as `lib/npm-services.nix`.

**New default Cargo features** (all on; each either sharpens a sovereign-stack invariant or closes a P0 hardening gap):

| Feature | Sprint | Effect |
|---------|--------|--------|
| `did-nostr` | 6 | `did:nostr:<pubkey>` resolver — Tier 1 + Tier 3, `alsoKnownAs` cross-verification. Closes the identity loop: one DID across pod WAC, relay NIP-42, and HTTP NIP-98. |
| WAC 2.0 conditions | 6 | Richer ACL grammar (time windows, origin constraints) for `sovereign-bootstrap.py`-written `.acl.json` files. |
| `webhook-signing` | 6 | RFC 9421 Ed25519 signing of outbound Solid Notification webhooks. |
| `rate-limit` | 7 | Sliding-window LRU per-connection ceiling; matches `nostr-rs-relay`'s `messages_per_sec` for coherence. |
| `quota` | 8 | Per-pod storage ceiling via atomic-write `.quota.json` sidecar; 413 on overflow. |
| `jss-v04` | 6-9 | JavaScriptSolidServer v0.4 config/behaviour compatibility. |

**New `[integrations.solid_pod_rs]` manifest keys** (all sensibly-defaulted so existing manifests keep working):

```toml
enable_did_nostr       = true
enable_webhook_signing = true
enable_rate_limit      = true
enable_quota           = true
jss_v04_compat         = true
rate_limit_per_sec     = 20
quota_default_bytes    = 10737418240   # 10 GiB
```

**New flake env surface** threaded into `[program:solid-pod]`: `JSS_ENABLE_DID_NOSTR`, `JSS_ENABLE_RATE_LIMIT`, `JSS_RATE_LIMIT_PER_SEC`, `JSS_ENABLE_QUOTA`, `JSS_QUOTA_DEFAULT_BYTES`, `JSS_ENABLE_WEBHOOK_SIGNING`, `JSS_V04_COMPAT`.

**Docs updated:**
- ADR-010 gains a new `## Upstream absorption log (Sprint 5-9)` section with the full delta table and implications analysis.
- `docs/user/solid-pod.md` capabilities table expanded; new `## did:nostr — the identity loop` subsection with a concrete curl example and WAC policy example.
- `README.md` sovereign-data-stack row updated to mention WAC 2.0, `did:nostr`, RFC 9421, quota, rate limiter.
- `docs/developer/sovereign-mesh.md` gains `### did:nostr — the identity loop (Sprint 6 absorption)` and `### Rate limiting and quota coherence` subsections.
- `docs/user/glossary.md` "Sovereign data stack" term updated; new `did:nostr` term.

**Build cost:** closure size increase <5 MB (reqwest-eventsource, moka LRU, ed25519-dalek pulled in by the new features). First build still requires prefetch for `srcHash` and `cargoHash`.

### solid-pod-rs promoted to first-class pod server (2026-04-24)

Completes the DreamLab-AI sovereign data stack. The `pods` adapter slot now
defaults to [`solid-pod-rs`](https://github.com/DreamLab-AI/solid-pod-rs) —
a first-party Rust Solid Protocol 0.11 server. Specified by
[`ADR-010`](docs/reference/adr/ADR-010-rust-solid-pod-adoption.md).

The stack is now coherent end-to-end: one secp256k1 keypair per container,
Schnorr-signed events on HTTP (NIP-98) and WebSocket (NIP-42) surfaces, WAC
policies written against the same npub, content-addressed pod mailboxes
keyed by Nostr event id. No third-party broker.

**What changed:**
- `agentbox.toml`: new top-level `[adapters]` block with `pods = "local-solid-rs"` as the default; new `[integrations.solid_pod_rs]` block for storage/backend/auth/notifications knobs; new `[security.exceptions.solid-pod-rs]` for the `/var/lib/solid` writable volume.
- `schema/agentbox.toml.schema.json`: `pods` enum extended with `local-solid-rs`; full schema for `[integrations.solid_pod_rs]` and the `solid-pod-rs` security exception.
- `scripts/agentbox-config-validate.js`: new rules **E033** (DPoP requires OIDC) and **W034** (`local-jss` deprecation warning). Total semantic rule count is now 33.
- `lib/solid-pod-rs.nix`: new Nix derivation building solid-pod-rs-server from pinned `v0.4.0-alpha.1` via `buildRustPackage`. Cargo features selected from the manifest (fs/memory/s3 backend, OIDC, DPoP cache, notifications). Preserves the upstream AGPL `LICENSE` in `$out/share/doc/solid-pod-rs/`.
- `flake.nix`: `solidPodRsPkg` + `solidPodRsActive` gate wiring; the `[program:solid-pod]` supervisor block now dispatches between the Rust binary (`local-solid-rs`) and the retained Python stub (`local-jss`) based on the manifest. Port `8484` unchanged.
- `management-api/adapters/pods/local-solid-rs.js`: new adapter implementation. Extends `local-jss.js` (wire protocol is identical), overrides `impl` tag, adds LDP Link-rel="next" pagination preference, N3-patch support when the server advertises `Accept-Patch: text/n3`, and capability probing via `OPTIONS /`.
- `management-api/adapters/index.js`: `slotConfig` threads `integrations.solid_pod_rs.base_url` (or constructed bind:port) into the new adapter.

**Docs (ecosystem framing):**
- `README.md`: new "Sovereign data stack" section front-and-centre, showing identity → pod → relay → privacy-filter as a coherent substrate.
- `docs/README.md`: dedicated "Sovereign data stack" table in the user-docs index, separate from feature guides.
- `docs/user/solid-pod.md`: new novice-facing operator guide — why the pod matters, capabilities table against the legacy stub, wizard flow, manifest reference, verify-it's-running commands, Mermaid diagram of the four-loopback-port stack, storage-backend options, licence note.
- `docs/developer/licensing.md`: new canonical AGPL-3.0 aggregation analysis. Documents the allowed/disallowed patterns, FSF citations, the binary-not-library rule, and what contributors must preserve when shipping.
- `docs/reference/adr/ADR-010-rust-solid-pod-adoption.md`: flipped from Proposed → Accepted; added "Position in the sovereign data stack" table; migration paragraph replaces the four-phase deprecation schedule.
- `docs/reference/adr/ADR-005-pluggable-adapter-architecture.md`: `pods` row + implementation layout + manifest contract updated.
- `docs/reference/prd/PRD-001-capabilities-and-adapters.md`: capability row expanded with Solid Protocol 0.11 conformance claim.
- `docs/user/configuration.md`: `[adapters]` block default + `[integrations.solid_pod_rs]` reference + E033/W034 validator entries.
- `docs/user/glossary.md`: Solid-pod definition updated; new "Sovereign data stack" entry; new common-confusion Q&A for solid-pod-rs.
- `docs/user/nostr-relay.md`: pod-is-the-inbox section explicitly cross-references the Rust pod and the atomic-rename invariants.
- `docs/developer/sovereign-mesh.md`: new "Pod server (ADR-010)" section explaining the bridge's direct-filesystem-write contract with solid-pod-rs's fs-backend.

### External agent messaging + embedded Nostr relay (2026-04-24)

Answers the open question "how do external agents reach internal ones":
the pod is the inbox, the relay is how the envelope gets there.

**Spec trio (quality-engineered):**
- [`PRD-004`](docs/reference/prd/PRD-004-external-agent-messaging.md) (323 lines) — actors, inbound/outbound flows, NIP-11/42/17 support matrix, four options axes, SLOs with p95/throughput/error ceilings per op.
- [`ADR-009`](docs/reference/adr/ADR-009-embedded-nostr-relay.md) (281 lines) — decision for `nostr-rs-relay` 0.9.0 (already in nixpkgs), alternatives weighed (rnostr, separate container, HTTP-only, custom Rust), contract-test names, failure-mode recovery.
- [`DDD-003`](docs/reference/ddd/DDD-003-sovereign-messaging-domain.md) (374 lines) — six aggregates (AgentIdentity, PodMailbox, RelayEndpoint, InboundEnvelope, OutboundEnvelope, Subscription), twelve numbered testable invariants I01-I12, anti-corruption layer, property-based test strategy.

**Implementation:**
- `[sovereign_mesh.relay]` manifest block, schema with `additionalProperties: false`, validator rules E026-E029 + W030 + E031.
- `scripts/start-agentbox.sh` gains `section_nostr_relay` — implementation / binding / ingress-policy / external-fanout / retention prompts; only offered when sovereign_mesh is enabled.
- `flake.nix`: `pkgs.nostr-rs-relay` derivation (zero packaging cost), manifest-rendered `/etc/agentbox/nostr-relay.toml`, gated `[program:nostr-relay]` supervisor block, new `[security.exceptions.nostr-relay]` for the writable SQLite volume, port publishing when `expose=true`, full `AGENTBOX_RELAY_*` env surface for the bridge consumer.
- `rnostr` path guarded with `throw` + actionable message since it is not yet in the pinned nixpkgs.

**Docs:**
- [`docs/user/nostr-relay.md`](docs/user/nostr-relay.md) novice guide, configuration.md + troubleshooting.md entries, docs/README.md ADR/PRD/DDD indices, PRD-001 capability row, developer/sovereign-mesh.md extended with embedded-relay section and bridge-consumer contract.

### Local PII redaction via openai/privacy-filter (2026-04-24)

**Spec:**
- [`ADR-008`](docs/reference/adr/ADR-008-privacy-filter-routing.md) — dispatch-path middleware with per-adapter-slot policy (strict/soft/off); fail-closed defaults on `pods` and `memory`.

**Implementation:**
- `[privacy_filter]` manifest block + schema + validator rules E022-E025.
- Wizard gates on GPU presence **or** `nproc ≥ 4 AND MemAvailable ≥ 6 GB` (the MoE keeps all 128 experts resident even though only top-4 fire per token).
- `scripts/opf-router.py`: stateless sidecar exposing `/classify`, `/redact`, `/health`, `/metrics` on loopback `:9092`.
- `flake.nix`: `privacyFilterPythonEnv` (transformers + safetensors + torch + aiohttp) + gated `[program:opf-router]` supervisor block.

**Docs:**
- [`docs/user/privacy-filter.md`](docs/user/privacy-filter.md) with entity classes, policy presets, observability.

### Novice-accessible documentation sweep (2026-04-24)

Four-agent parallel swarm landed these across every doc tier:
- `docs/user/glossary.md` — 60-second mental model, A-Z glossary (now 46 terms), common-confusions Q&A.
- 15 `docs/user/*.md` files framed with "why this exists" / "what it solves" / "when to skip".
- 6 `docs/developer/*.md` enriched with Context paragraphs, "Why not X" callouts anchored to ADRs, Minimum-useful-change examples.
- 13 `docs/reference/{adr,prd,ddd}/*.md` gained `## TL;DR for newcomers` blocks (≤120 words each) without touching canonical content.

### Validator rule inventory (30 rules)

Active: E001-E008 (8), E010-E015 (6), E016-E020 (5), W021, E022-E025 (4, privacy filter), E026-E029 (4, Nostr relay), W030, E031. E009 reserved. The validator header docstring and every downstream reference ("20 semantic rules E001-E020", "18 semantic rules E001-E018") updated to reflect the current inventory.

### Seal-bootstrap awk dedup + docstring cleanup (2026-04-24)

- **Fixed**: `config/seal-bootstrap.sh` `_required_programs()` awk emitted each qualifying program name once per line of the block after the readiness marker (verified on a test fixture: 7 dupes for ruvector, 6 for management-api). Rewrote the awk to track state in a `function emit()` invoked on block transitions and EOF. The seal loop now polls each required program exactly once per pass. Readiness behaviour was not broken — just wasteful — but the duplication would have been fragile if anything downstream consumed the list assuming uniqueness.
- **Docstring cleanup**: `lib/npm-services.nix` preamble and `makeNpmService` parameter doc still claimed `lib.fakeHash` would "throw at eval time", which was outdated after commit `6db0e061` converted the guard to realisation-time-only. Comments now describe the actual lazy behaviour: placeholder SRI substituted at eval; hash mismatch surfaces at realisation with a `preFetch` operator hint.

### Bootstrap + eval-time P0 fixes (2026-04-24)

Two regressions caught in post-merge review. Both shipped in `6db0e061`.

**`/ready` now actually fires.** The generated `supervisorText` in `flake.nix` did not include the `[program:bootstrap-seal]` block — it only lived in `config/supervisord-nix.conf`, which was not wired into the image. Without the seal program, `/run/agentbox/bootstrap.done` was never written, `/ready` returned 503 indefinitely, and the docker healthcheck (`curl -f /ready`) never turned green. Fixed by adding `[program:bootstrap-seal] priority=99` directly to the generator and tagging `management-api` and `ruvector` with `environment=AGENTBOX_REQUIRED_FOR_READINESS="true"` so `seal-bootstrap.sh` has real gates to poll. Orphan `config/supervisord-nix.conf` deleted.

**`nix flake check` / `nix build .#compose` / `nix eval` now work on a fresh clone.** `lib.fakeHash` previously triggered an eval-time throw in both `lib/npm-services.nix` and `lib/npm-cli.nix`, blocking every flake consumer — not just `nix build .#runtime`. Replaced with a lazy approach: fakeHash substitutes a placeholder SRI so eval succeeds, and a `preFetch` hook emits an operator-friendly hint only when realisation is attempted. `buildNpmPackage` / `fetchurl` surface the hash mismatch at build time with Nix's standard format plus the hint. Only `nix build .#runtime` (actual realisation) still needs operator prefetch.

### Documentation reorganisation (2026-04-24)

Audience-tiered split:
- `docs/user/` — operator-facing (quickstart, installation, configuration, running, platforms, troubleshooting, providers, backup, consuming-image, provisioning, feature guides)
- `docs/developer/` — contributor-facing (architecture, adapters, testing, sovereign-mesh, skills-upgrade, version-tracking)
- `docs/reference/{adr,prd,ddd}/` — canonical specs (7 ADRs, 3 PRDs, 2 DDDs)

Top-level `README.md` rewritten as a world-class product pitch with Mermaid architecture diagram and full link graph into the new docs tree. `docs/README.md` restructured as an audience-tiered nav hub.

### Runtime contract + container hardening (2026-04-24)

Implements [PRD-003](docs/reference/prd/PRD-003-runtime-contract-and-container-hardening.md) + [ADR-007](docs/reference/adr/ADR-007-runtime-contract-and-container-hardening.md) + [DDD-002](docs/reference/ddd/DDD-002-runtime-contract-domain.md).

**Image reference selection**:
- Generated compose now uses `image: ${AGENTBOX_IMAGE_REF:-agentbox:runtime-<system>}` so operators can switch between local builds and registry-pulled images with an env var.
- `agentbox.sh up` gains `--build` and `--registry` flags (mutually exclusive) plus `--wait-live` to wait on `/livez` rather than `/ready`.

**Three-endpoint probe semantics**:
- `/livez` — process-alive only (<100ms, no external checks).
- `/ready` — bootstrap sentinel present + every non-`off` adapter healthy + required filesystem mounts accessible + Nostr relays reachable when `[sovereign_mesh].publish_agent_events=true`. Returns 503 with `{ready, reason, missing[]}` when any requirement unmet.
- `/health` retained as aggregate for humans; Docker healthcheck now gates on `/ready`.
- `/v1/meta` gains `observability: { metrics_endpoint, otlp_endpoint }`.

**End-to-end observability**:
- Five-link chain: `agentbox.toml [observability]` → flake imageEnv → compose ports → OCI ExposedPorts → management-api metrics server. `agentbox.sh health` discovers the endpoint via `/v1/meta` and scrapes it.

**Hardened-by-default container**:
- Baseline: `user: 1000:1000`, `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`, `seccomp=default`, tmpfs for `/tmp`, `/run`, `/var/run`, `/var/log`, `/var/log/supervisor`.
- `[security.exceptions.<feature>]` manifest deltas with inherit/merge semantics. Seven mappings: `desktop`, `gpu-rocm`, `gpu-cuda`, `gaussian-splatting`, `playwright`, `code-server`, `telegram-mirror`. Baseline drops are structurally immutable — exceptions can only add.
- Validator rules E020 (orphan exception) and W021 (enabled feature missing its exception).
- `SecurityProfileApplied` structured log event at startup.

### Immutable runtime bootstrap (2026-04-24)

Implements [PRD-002](docs/reference/prd/PRD-002-immutable-runtime-bootstrap.md) + [ADR-006](docs/reference/adr/ADR-006-immutable-runtime-bootstrap.md) + [DDD-001](docs/reference/ddd/DDD-001-immutable-bootstrap-domain.md).

**Packaged closures replace runtime installers**:
- Six local npm services via `buildNpmPackage` (new `lib/npm-services.nix`): management-api, mcp/nostr-bridge, skills/openai-codex/mcp-server, skills/lazy-fetch/mcp-server, skills/playwright/mcp-server, skills/comfyui/mcp-server.
- Nine global npm CLIs via tarball fetch + `buildNpmPackage` (new `lib/npm-cli.nix`): ruvector 0.2.23, @claude-flow/cli 3.5.80, ruflo 3.5.80, agentic-qe 3.9.15, codebase-memory-mcp 0.6.0, agent-browser 0.26.0, playwright 1.59.1, @mermaid-js/mermaid-cli 11.12.0. (nagual-qe awaits public publication.)
- All Stage B `npm install` and `npm install -g` calls deleted from the entrypoint.
- TypeScript build for lazy-fetch-mcp uses `pkgs.nodePackages.typescript` (respects Nix sandbox).

**Bootstrap lifecycle**:
- `config/seal-bootstrap.sh` as `[program:bootstrap-seal]` (priority 99) writes `/run/agentbox/bootstrap.done` atomically after all required-for-readiness programs reach RUNNING.
- `config/validate-artifacts.sh` runs pre-supervisord and fails fast on any missing required artifact (no silent `|| true`).
- Ten bootstrap observability events emitted as pino JSON tagged `agentbox.stage: bootstrap`.
- `AGENTBOX_STRICT_IMMUTABLE=true` escalates the `/opt/agentbox:rw` warning to a fatal error.

### OpenAI Codex Rust CLI + upstream version tracking (2026-04-24)

- `lib/codex-binary.nix` — Nix derivation pulling OpenAI's official pre-built musl tarball (rust-v0.124.0), pinned per-arch (x86_64 + aarch64 linux sha256). `[toolchains.codex]` manifest gate.
- `renovate.json` — custom regex managers for Codex, ComfyUI, Gemini CLI, gitleaks-action, and all nine npm CLI versions.
- `.github/workflows/nix-flake-update.yml` — weekly `nix flake update` with `nix flake check` validation and auto-PR.
- `scripts/check-upstream-releases.sh` — human dashboard comparing pinned vs latest upstream.
- `docs/developer/version-tracking.md` — the three update channels, Codex bump worked example.

### Platform compatibility (2026-04-24)

- Flake `eachSystem` now includes `x86_64-darwin` and `aarch64-darwin`. Container-image outputs gated behind `lib.optionalAttrs pkgs.stdenv.isLinux`; portable `compose` output available on macOS.
- CUDA eligibility tightened to `isLinux && isx86_64` (was `isx86_64` alone).
- `.github/workflows/build-multi-arch.yml` builds on native runners (ubuntu-latest + ubuntu-24.04-arm) and publishes `ghcr.io/dreamlab-ai/agentbox:<sha>` + `:latest` as a single multi-arch manifest.
- `.github/workflows/flake-check.yml` evaluates the flake on both Linux archs per PR.
- New guides: `docs/user/platforms.md`, `docs/user/consuming-image.md`, `docs/user/running.md` (per-host cookbook).

Linux x86_64 and aarch64 are fully supported (build + run). macOS and Windows are runtime-supported via Docker Desktop pulling the published image. Apple Silicon GPU (Metal), Intel oneAPI, and Windows native are not supported.

### Test coverage completion (2026-04-24)

- 5 runtime-contract tests (RC-002-01..05) mapping PRD-002 acceptance criteria.
- 5 runtime-contract tests (RC-003-06..10) mapping PRD-003 acceptance criteria.
- 23 pytest cases for the TUI Python helpers.
- 7 Nostr-bridge integration tests with local WebSocket echo servers.
- 9 resolver-degraded-start tests.
- 4 hardening edge-case tests (key typo, multi-feature dedup, 7-parametric E020).
- 2 bootstrap edge tests (seal-timeout negative, writable-root warning).
- Validator rules E001–E020 + W021 all enforced and tested (49 active + 1 Nix-skipped).
- Contract harness at 145 passing / 33 todo. Remaining todos have per-test unblock notes citing the specific external-infra dependency (k6, WAC-capable JSS, ONNX runtime, SSD-backed CI).

### M2 — daily ergonomics + adapter implementations (2026-04-23)

**Five adapter triples implemented** (local-* / external / off per slot): beads, pods, memory, events, orchestrator. Shared `adapters/base.js` + `adapters/errors.js` (`AdapterDisabled`, `UnknownAdapterImpl`).

**Adapter resolver + boot wiring**: `adapters/manifest-loader.js` + `adapters/index.js`. `/health` reports per-adapter health; `/v1/meta` reports per-adapter impl.

**`agentbox.sh` gains local lifecycle verbs**: `up`, `down`, `build`, `rebuild`, `logs`, `shell`, `health`.

**Manifest JSON Schema + `agentbox config validate` CLI**: `schema/agentbox.toml.schema.json`, 20 semantic rules.

**Observability**: Prometheus `/metrics` on port 9091 + OpenTelemetry OTLP + pino structured logs.

**Developer ergonomics**: `.devcontainer/devcontainer.json` (Nix-flakes base + DinD), `config/zellij/layouts/agentbox.kdl` (11-tab layout), shell aliases, tmux-compat.

### M1 — safety floor + contract harness (2026-04-23)

- Nix build reproducibility test (`tests/reproducibility/nix-build-hash.sh`).
- Management-api `/health` + `/v1/meta` endpoints (public, pre-auth).
- Docker Compose healthcheck.
- Auto-generated `MANAGEMENT_API_KEY` on first boot (persisted at `/workspace/profiles/default/mgmt-key`, mode 0600).
- gitleaks CI workflow (v2.3.2) with canary test.
- `agentbox.sh backup` and `restore` verbs (alpine-helper volume I/O, secrets excluded by default).
- Jest contract test harness × 5 slots.

### Agentbox extraction (2026-04-23)

Agentbox was extracted from a larger host project during a radical-upgrade sprint. Initial commit replaced a 1,188-line Dockerfile + 2,379-line bash entrypoint monolith with a Nix flake, manifest-driven composition, and an adapter-pattern architecture. The design priorities — reproducibility, adapter pattern, manifest-gating — came directly from lessons learned in the original monolith.
