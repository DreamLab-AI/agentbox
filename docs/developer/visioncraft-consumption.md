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

## Published release and activation

The pin consumes published VisionCraft 0.3.0 from upstream commit
`2c6627ce01d0e68bb0f48fc55a209b2c674716f1` (tag `v0.3.0`). 0.3.0 adds Rune
guidance (`references/rust/rune.md`): when the Rune GPU UI framework
(github.com/anomalyco/rune) should be the Rust-native shell for desktop and web,
how to pin it by git revision (the crates.io `rune` is an unrelated scripting
language, as is the `rune` CLI baked into this image), its web-target limits and
its headless evidence gates. It also adds `assets/rune-web/`, a scaffold built and
tested against a pinned Rune revision. 0.2.0's browser-target guidance
(`references/rust/browser-wasm.md`, browser logic in Rust compiled to
WebAssembly) remains, now with a Rune toolchain row. The library and CLI are
unchanged. The source archive's Nix hash is
`sha256-Avi0R8gIu4ZiQBHnHQoP9ATHoXi3lHIxYd4bIyvn/iU=`, computed without Nix by
NAR-serialising the unpacked archive; the same method reproduces the 0.2.0 pin's
`sha256-W4z4jJrdpR+7E+SDQKR3jrttP5Ui2TAkCYLh5qyF4IM=`. All 40 skill files and the
released lockfile were copied from that archive and verified with
`visioncraft-source-check`. Registry publication is confirmed. Source, parser
and consumer checks pass; the operator's image rebuild and runtime acceptance
remain outstanding.

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

## Participants and skill improvement

VisionCraft's [role catalogue](../../skills/visioncraft/references/roles.md)
names engineering responsibilities. Agentbox's
[agent registry](../../agents/registered-agents.txt) and individual agent files
define the available Claude Code subagent names. Use the current harness's
actual delegation interface; these names do not create Codex workers or grant
permission to delegate.

| Responsibility | Agentbox resource |
|---|---|
| Architecture and test strategy | [system-architect](../../agents/system-architect.md) |
| Rust implementation | Lead session or [rust-engineer](../../agents/rust-engineer.md) |
| Tests, coverage, mutation and flaky-test investigation | [test-engineer](../../agents/test-engineer.md) |
| Code and security review | [code-reviewer](../../agents/code-reviewer.md), [security-reviewer](../../agents/security-reviewer.md) |
| Performance and resilience experiments | [performance-engineer](../../agents/performance-engineer.md) |
| Durable lessons and memory maintenance | [memory-curator](../../agents/memory-curator.md) |
| Browser journeys and dynamic web checks | [browser skill](../../skills/browser/SKILL.md) |

[ADR-2134](../adr/ADR-2134-model-roles-sonnet-lead-opus-advisor-haiku-explore.md)
owns host model/advisor policy. An independent evidence audit still requires a
different actual model family from the producer; choosing a different row or
model tier above does not establish independence. The
[Codex companion](../../skills/codex-companion/SKILL.md) describes one cross-family
route when the producer is a Claude agent.

For measured improvements to the method, use
[skill-tuning](../../skills/skill-tuning/SKILL.md); use
[skill-builder](../../skills/skill-builder/SKILL.md) for authoring and structural
review. Submit portable edits to the upstream VisionCraft repository and follow
the release procedure below. The pinned copy here remains generated from that
release. Keep historical Build with Quality experiments separate from
[VisionCraft's own evaluation](https://github.com/DreamLab-AI/visioncraft/blob/main/docs/EVALUATION.md).

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

Codex AQE projection edits TOML in place structurally, retaining comments and
unmanaged timeout/tool/env settings. It refuses malformed table shapes. The
snapshot checker rejects ambiguous Unix backslash names and duplicate inventory
keys instead of normalising them into a valid released path.

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
