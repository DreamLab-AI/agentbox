# Changelog

All notable changes to agentbox are documented here. Format inspired by [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Dates are ISO-8601.

## [Unreleased]

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
never linked into agentbox first-party JavaScript. Agentbox stays
MPL-2.0; the viewer remains AGPL-3.0.

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
