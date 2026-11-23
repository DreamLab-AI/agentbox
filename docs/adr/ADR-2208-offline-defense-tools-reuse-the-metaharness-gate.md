---
id: ADR-2208
title: Offline defense evidence replay reuses the MetaHarness gate without a new gateway
date: 2026-11-20
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 538c223973ee1aa1fb18a7521b5ea91d3e9535ac
verified_paths: [flake.nix, agentbox.toml, schema/agentbox.toml.schema.json, management-api/lib/system-manifest.js, config/npm-locks/metaharness-artex-defense-0.1.0.package-lock.json, tests/config/offline-defense.test.cjs]
owner: operator
review_trigger: ARTEX or its harness dependency changes, a proposal to intercept live traffic or start the aidefence gateway, or a change to the single memory-store boundary
repo: agentbox
domain: BASELINE-container
evidence_class: source+test+deployment+runtime
acceptance_boundary: Standalone Nix package plus five checks covering the image gate and both packaged fixtures/modes, receipt verification, tamper rejection and no overwrite. Rebuilt Agentbox is active; isolated candidate replay and aidefence detector checks pass. No live quarantine, universal ingress screening or new gateway is claimed.
---

# ADR-2208 — Offline defense tools reuse the MetaHarness gate

## Scoped consolidation check — 2026-11-22

Compared every governed path since the previous verification. The only changes
are the description of `user_cron.enabled` in the shared schema and, where
governed here, its explicit default-off setup seed. No existing value, authority,
privacy boundary or runtime implementation governed by this decision changes.
The setup drift suite passes 8/8. This is source verification, not activation.

## Activation witness — 2026-11-20

Agentbox source `559c2c39e2f5e8087d890b6ea89d63a75be1940b`, image ID
`sha256:b51f2286bda3610de732c8e21edf4186c06583e39d2b3d1211cdba5d7dba2f72`,
was activated at 12:17:11 UTC. The network-isolated candidate passed ARTEX
replay/receipt verification, benign and synthetic-injection aidefence checks,
and Ruflo learning/retention-default assertions without production volumes.
The active container exposes the CLI; RuVector MCP memory health passes.
This is packaging and bounded detector evidence, not live traffic protection.

## Context

The operator requested ARTEX Defense and aidefence during the core-tool refresh.
Ruflo's reviewed lock already includes aidefence 3.2.1 and its scoped adapter.
ARTEX is an MIT offline evidence-replay CLI, not a live interception layer.

## Decision

- Pin `@metaharness/artex-defense` 0.1.0, its exact harness 0.2.1 dependency,
  tarball integrity and recursive dependency hash. The named root addition is
  an exception to the routine 72-hour hold; its dependency predates the cutoff.
- `[toolchains].metaharness` includes `artex-defense` with the existing CLIs.
  The catalogue remains rebuild-class. No extra supervisor or MCP server is
  needed for an offline CLI, and no service/listener/interception is enabled.
- Receipts are operator-requested files, not a sixth durable adapter or new
  memory authority. `simulate` is not a quarantine of a real session.
- Reuse Ruflo's aidefence dependency rather than start a second AIMDS gateway.
  Packaging or a detector smoke test is not proof that every ingress is screened.
  New interception requires separate policy and privacy/adapter review.
- Retain governed MCP-only memory and SONA-off. Ruflo's newly default-on local
  learning is disabled; its new snapshot/cost-ledger retention defaults off.

## Verification

The actual Nix package passes both `identity` and `findings` fixtures in monitor
and simulate modes. Every report verifies against its trusted tail, refuses
overwrite and fails after tampering. The static gate/service test also passes.
The package's own npm test discovers zero cases and is not counted. The new
lock audit reports zero findings; no live deployment is inferred from this.

See [the scoped source review](../estate-closeout/2026-11-20/core-tools-and-browser-source-review.md).

## Re-verification — 2026-11-20 at `f6a87328266381a2f2f1bf6ddf7050ebd72eda49`

Governed delta: `flake.nix` changed in one line, `:3169`: the `[program:nip98-proxy]` supervisor `environment=` gains `NIP98_PROXY_REQUIRE_CONFIG="1"` (W3-05, ADR-2210). One line replaces one line, so no `flake.nix` citation moves, and nothing else in the file changed. This record makes no claim about the proxy's supervisor environment or its config projection. The record's MetaHarness-gate claims are untouched by an environment variable on another program. The Decision is unchanged and no claim of this record is falsified by the JOURNAL-LOCK (ADR-2211), W3-05 (ADR-2210) or Podkey-policy (ADR-2212) merges. Commands run: `git diff 664161bdc..f6a873282 -- flake.nix agentbox.toml schema/agentbox.toml.schema.json management-api/lib/system-manifest.js config/npm-locks/metaharness-artex-defense-0.1.0.package-lock.json tests/config/offline-defense.test.cjs`. Re-run the diff to reproduce.

## Re-verification — 2026-11-20 at `0913d5458837d8c4d1fa4b5b3e52b70e7975cb5a` (closeout branch)

Governed delta: `flake.nix` changed only in a comment in the generated compose file's header (R-025, the optional `claude-zai` sidecar, `:4164-4169`): comment text, one line longer, so `flake.nix` lines after `:4165` move by +1. No program, port, mount, environment value or derivation changes. Citations in this record to lines after these points are as of their own commit and are not renumbered. Commands run on this commit: `git diff 6a73c5a73..0913d5458 -- <the paths above>` read in full; `node scripts/adr-index-gen.js docs/adr --check`. The Decision and status axes are unchanged and no claim of this record is falsified.

## Re-verification — 2026-11-21 at `aa6c38322068d21b39515feeecc128434612051e` (lost beema key)

Tripped by `fix/beema-key`. The governed delta is three hunks, the same in every record it trips: `agentbox.toml` and `setup/agentbox.default.toml` drop one allowlist entry, the operator's lost older beema key `cd37af94…`, and relabel `b41654017f…` as beema in two trailing comments; the manifest golden fixture drops the same entry. This record was read for any claim about those lines and makes none; its decision is untouched. Checked with `git diff origin/main..aa6c38322 -- agentbox.toml setup/agentbox.default.toml services/agentbox-manifest/tests/golden/live-agentbox.toml` and `cargo test` in `services/agentbox-manifest` (all pass).

## ADR-2214 drift check — 2026-11-22

Compared every governed path changed by `fc95b3877` (ADR-2214). Those changes
move `/home/devuser/.gemini` from a tmpfs to the named volume `agentbox-
antigravity-state`, set `[providers.gemini].auth_mode = "oauth"`, add `gemini`
to the OAuth-capable providers, export `AGENTBOX_ANTIGRAVITY_AUTH_MODE` to the
Antigravity consultant, and correct comments and docs. No value, authority,
boundary or runtime behaviour governed by this decision changes. This is source
verification, not activation.

## Comment-drift check — 2026-11-23 at `469e55367`

Governed delta: `agentbox.toml` changed only in the comment above `[sidechain.dreamlab-txbt4]` (`:2042-2043`): "Off until the lead starts it" becomes "On since 2026-10-03", which matches `enabled = true` and the baked `autostart=true` producer, mirror and faucet programs. It is line-count neutral, so no `agentbox.toml:NNNN` citation moves, and no key or value changes. No decision, status axis or claim of this record is affected. Run: `git diff 59b1aca1c..469e55367 -- <governed paths>` read in full; the agentbox-manifest crate passes `cargo test` and `cargo clippy --all-targets -- -D warnings`, and `scripts/agentbox-config-validate.sh agentbox.toml` reports the manifest valid.

## Re-verification — 2026-11-23 at `06c2f701130aa94edf24a20f9f86de2131a0bcf4`

Governed delta since `469e55367`: `schema/agentbox.toml.schema.json`. `schema/agentbox.toml.schema.json` gains the optional `adapters.connect_timeout_ms` property (ADR-2035: one integer, or a table of per-slot integers, each at least 1) at `:101-145`. It is additive, 45 lines, so lines after `:99` sit 45 lower than at `8db362bc5`; no existing property is changed or tightened. The ARTEX defence toolchain schema and gate are untouched.

Judged from `git diff 469e55367..06c2f7011 -- schema/agentbox.toml.schema.json`, read in full against this record's claims; `node scripts/adr-index-gen.js docs/adr --check`. The Decision and status axes are unchanged and no claim of this record is falsified. Citations in this record to lines after the points above are as of their own commit and are not renumbered.

## Re-verification — 2026-11-23 (2) at `538c223973ee1aa1fb18a7521b5ea91d3e9535ac`

Governed delta since `06c2f7011`: `agentbox.toml`, `flake.nix`, `schema/agentbox.toml.schema.json`. The delta is the poker house seat's optional operator alert (`e59b51980`), plus the seat binary pin (`538c22397`, `lib/poker-citizen.nix`, not a path this record governs). `agentbox.toml` gains one commented-out `# alert_pubkey = ""` line under `[poker_citizen]` (`:2098`); no key or value changes, and lines after `:2095` sit one lower (`role_isolation = false` is now `:2616`, was `:2615`); `flake.nix` gains `pokerCitizenAlert` (`:473`) and the per-seat `alertPubkey` (`:489`), each `unplaceheld (… or "")`, and appends `POKER_CITIZEN_ALERT_PUBKEY` to the `[program:poker-citizen]` and `[program:poker-citizen-<name>]` environment lines only when the value is non-empty (`:3434`, `:3449`); lines after `:468` sit three lower and lines after `:486` four lower; `schema/agentbox.toml.schema.json` declares an optional `alert_pubkey` string (pattern `^([0-9a-fA-F]{64}|npub1[0-9a-z]+)?$`) on `[poker_citizen]` (`:4281`) and on `[poker_citizen.<name>]` (`:4311`); the per-seat object keeps `additionalProperties: false`; lines after `:4277` sit five lower and after `:4302` ten lower. Every hunk is additive: one optional key under `[poker_citizen]` and `[poker_citizen.<name>]` and one environment projection; the seat opens no listener and adds no program, port, mount, volume or manifest gate. Nothing this record decides (Offline defense evidence replay reuses the MetaHarness gate without a new gateway) reads `alert_pubkey` or `POKER_CITIZEN_ALERT_PUBKEY`. Review trigger: not fired.

Judged from `git diff 06c2f7011..538c22397 -- agentbox.toml flake.nix schema/agentbox.toml.schema.json`, the hunks read in full against this record's claims; `node scripts/adr-index-gen.js docs/adr --check`. The Decision and status axes are unchanged and no claim of this record is falsified. Citations in this record to lines after the points above are as of their own commit and are not renumbered.
