---
id: ADR-2119
title: Remove the retired outliner ontology runtime
date: 2026-10-01
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 275e12356319a9630846656580d497d53de3d38c
verified_paths: [flake.nix, lib/ontology-tools.nix, services/ontology-tools, services/agentbox-mcp/src/web_summary, skills/ontology-core, skills/ontology-enrich, dream.config.json]
owner: jjohare
review_trigger: commit and rebuild the image; or introduce a corpus writer or output format
repo: agentbox
domain: BASELINE-container
---

# ADR-2119 — Remove the retired outliner ontology runtime

## Re-verification — 2026-10-02 at caab741c6 (factrail landing, ADR-2121)

The factrail landing (ADR-2121, `b7fc2b0e5` + `caab741c6`) touched governed paths without touching this decision: `flake.nix` gains only the factrail package, its `/opt/agentbox/bin/factrail` link and the shim copy, each under `lib.optionalString jevCompactionOn`. No hunk falls in code this record governs, so its claims and status axes stand unchanged.

## Context

The authored corpus has migrated to Obsidian-compatible YAML frontmatter.
The independent `ontology-tools` crate still parsed and emitted outliner
OntologyBlocks, remained baked unconditionally, and supplied an obsolete dream
evaluator. Web-summary also advertised an obsolete format alias. Their presence
made the supported authoring path ambiguous during planning for new domains.

## Decision

Remove `services/ontology-tools`, its Nix derivation and package registration.
Use the existing `vault` CLI for corpus authoring, validation, links and builds.
The required ontology dream evaluator exercises the current proposal/apply
boundary; upstream vault tests remain part of its Nix build.
Web-summary supports Obsidian and plain topics, plus Markdown summaries, and
rejects unsupported format names. No compatibility writer or replacement stub
is retained. Historical ADRs and archives remain evidence; unrelated private
outliner notebooks are outside this corpus retirement.

## Consequences

The source tree has one corpus authoring route. Existing container images still
contain the baked executable and require a rebuild to remove it. Neither the
Nix store nor the running container has been modified by this change.
The upstream vault source pin must be reviewed separately when deploying newer
proposal or creation capabilities; this change does not claim those are live.

The user authorised the retirement. Image `sha256:399888769570` activates the
change: `ontology-tools` is absent while the vault-backed ontology governance
and web-summary tests remain green.

## Verification

Working-tree checks on 2026-10-01: 29 web-summary Rust tests passed, including
current-format acceptance and obsolete/unknown-format rejection; 59 Node tests
passed for ontology proposal/apply governance. `git diff --check` passed.
The Nix runtime image built and loaded successfully. Live verification confirms
that `/opt/agentbox/bin/ontology-tools` is absent, all five adapters are healthy,
and readiness is green.

## Re-verification — 2026-10-02 (`f7465412de3d0d7a25fc1b6b2c8a72775490616d`)

Tripped by the `sidestr:dreamlab-txbt4` seal. `flake.nix` adds `sidechainChains`, one entry per `[sidechain.<name>]` table. For each table enabled under an enabled `[sidechain]` it bakes three supervisor programs, `sidestr-{producer,mirror,faucet}-<name>`: user devuser, the existing `config/sidechain` runners, and a producer the engine binds to 127.0.0.1:3451. `sidestr-agent` is baked when any faucet is on. The one table shipped is `enabled = false`, so the rendered supervisor text is unchanged. No port, Compose service, volume, user, MCP registration or other program moved. No outliner or ontology runtime is reintroduced. **Decision unaffected.** `verified_commit` moves to the seal commit. Gates at that commit:

- the manifest validator is valid;
- `check-manifest-catalogue` passes;
- `tests/config/sidechain-genesis.test.sh` passes 7/7 and `sidechain-producer-gates.test.sh` 7/7.

## Re-verification — 2026-10-03 (`055c06ff69b2f53bf38a67d254c048bb03599fc8`)

Tripped by custody X-1 step 1 (W0 `custody/w0-bypasses` and W1 `custody/w1-role-accounts`). `flake.nix` changed only as follows. W0 (`8070c1010`, `6a433e6b3`): `root` loses its `devuser` member, and `[program:docker-read-proxy]` is added (root start, drops to 65534). W1 (`b8c66625a`, `055c06ff6`): role passwd and group lines are appended from `config/role-accounts.json`, `supervisord.isolated.conf`, `role-secrets.tsv` and `role-accounts.json` are derived beside the unchanged `supervisord.conf`, and a root-owned `/run/secrets` tmpfs is added (ADR-2122). Nothing of the retired outliner runtime returns, and the decision holds.
Re-verified by `git diff 0919dc39a..055c06ff6 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`275e12356319a9630846656580d497d53de3d38c`)

Tripped by custody X-1 step 1, W2 (`custody/w2-env-scrub`: `0965a9c8c`, `042115499`, `275e12356`; bypass 3, ROLE secrets out of PID 1's environment). `flake.nix` changes only `[program:tailscale-up]` (a `TAILSCALE_AUTHKEY_FILE` branch that passes `--authkey=file:<path>`; the original branch is unchanged and is the one taken with the flag off) and the `[program:nostr-gateway]` comment. The decision holds.
Re-verified by `git diff 055c06ff6..275e12356 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.
