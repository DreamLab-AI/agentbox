# VisionCraft in Agentbox

VisionCraft owns the portable library, CLI and quality method. Agentbox owns its
installation, host policy projection and harness registration. The old
build-with-quality payload is removed; historical records retain that name only
as evidence of the previous implementation. See [ADR-2165](../adr/ADR-2165-visioncraft-owns-the-portable-quality-method.md).

| Surface | Owner and authoritative source |
|---|---|
| Quality plans, expectation coverage, evidence evaluation and execution receipts | Published `visioncraft` crate and its upstream repository |
| Portable skill and supporting resources | Upstream `skills/visioncraft`, copied byte-for-byte into this repo |
| Release identity | `config/visioncraft-source.json`: version, immutable commit, NAR hash, complete skill digests and released lockfile digest |
| Image package | `lib/visioncraft.nix`, using that same release identity |
| Deepsec protocol and execution | VisionCraft; supported upstream protocol recorded with its release |
| Agentbox TOML and environment policy | `services/agentbox-manifest/src/deepsec_gate.rs` |
| Host command | `scripts/visioncraft-deepsec-gate.sh` delegates through the Rust policy projector |
| AQE task tools | Separately pinned upstream Agentic QE; direct MCP registration through `agentbox-manifest` |
| Shared durable memory | Agentbox's existing governed memory MCP |
| Jev candidate source | `config/hooks/lib/skill-route.cjs` reads current skill descriptions and registrations per invocation |

## Local authority boundary

The gate is a caller-controlled local CLI, not a privilege boundary or a remote
policy service. Its caller owns the manifest selection, environment, explicit
flags, endpoint and executable PATH. Environment overrides and ordinary CLI flags
therefore remain available in local and CI invocations; a disabled gate produces
a non-success availability result, not evidence of a completed review. Credentials
must be scoped by the invoking CI job or service account. Do not expose this
command as a privileged service accepting an untrusted caller's environment.
An explicit missing or invalid manifest is refused; only an absent default
manifest uses upstream defaults. The host passes credential names, never their
resolved values, into policy JSON.

## Updating the release

Make portable changes upstream, run its quality gates and publish the release.
Use the immutable released commit to obtain the complete `skills/visioncraft`
tree and `Cargo.lock`; do not copy an uncommitted checkout or merge local edits
into the generated snapshot. Replace the whole snapshot so deleted upstream
files also disappear. Record SHA-256 digests of every relative skill file and
the released lockfile in `config/visioncraft-source.json`, together with the
release's version, commit and independently obtained Nix source hash. The local
lockfile is named `lib/lockfiles/visioncraft-<version>.Cargo.lock`.

Run `agentbox-manifest visioncraft-source-check --root .`, regenerate the routing
table with `node skills/gen-routing-table.mjs`, and run the consumer checks below.
Nix fetches the same immutable source and compares its portable skill directory
with the generated snapshot during the image build. A changed pin alone cannot
silently admit a local skill fork: both comparisons must agree with upstream.

Changes to the upstream Deepsec or AQE package are separate decisions. Review the
upstream protocol/tool contract, update the existing pinned package and run
model-free fixtures before enabling it. Do not run package initialisers, log in,
install agent templates or update a CLI automatically from a review invocation.

## Consumer checks

```sh
cargo test --manifest-path services/agentbox-manifest/Cargo.toml --locked
agentbox-manifest visioncraft-source-check --root .
node --test tests/config/visioncraft-deepsec.test.mjs
node --test tests/config/visioncraft-cutover.test.mjs tests/config/visioncraft-aqe.test.mjs
node --test tests/system-one/visioncraft-picker.test.mjs
bash skills/lint-skills.sh
node scripts/skill-count-check.js
node scripts/ci/env-secret-inventory.js --check
```

The executable integration tests require the newly built `agentbox-manifest` and
pinned `visioncraft` on PATH. Their reviewer and AQE doubles do not call models.
The Deepsec cases retain the disabled/unavailable, policy, credential-name,
threshold, malformed export and stale evidence controls. They require fresh run
and per-file analysis records; exit zero with an empty export is insufficient.

The picker check uses the actual source tree and registration manifest, exercises
BM25 selection for a quality task, and inspects the real Jev request through a
mocked transport. This verifies candidate delivery and answer handling, not live
model accuracy. The old frozen Rust/JS BM25 parity corpus remains a historical
numerical oracle; it is not the current candidate registry.

## Rebuild acceptance

Source tests do not update the running image. After the operator's rebuild,
check `visioncraft --version`, `agentbox-manifest visioncraft-source-check --root
/opt/agentbox`, and `aqe --version`. Reload harness MCP sessions and confirm the
direct `agentic-qe` server advertises tools. Claude and Codex should register
`visioncraft`, with no active `build-with-quality` directory in their skill roots.
Boot preserves any retired local copy under a hidden `.superseded` archive.

The existing routing corpus's baked/source parity check must then pass. A real
`--scan-only` run can establish Deepsec binary/protocol integration without model
spend; its result is `SCANNED`, never a completed model-review claim. Paid review
and external service behaviour require their own explicit runtime evidence.
