# Core tools and browser: scoped source verification, 2026-11-20

Source reviewed at `664161bdcfee1c4d7a5c820c6ddb0a0b0c085af6`.
This is not a blanket renewal of the linked ADRs' historical runtime claims.
Decision, implementation and activation axes stay unchanged by the bulk source
verification. Deployment evidence is recorded separately.

## Reviewed deltas

- Core pins: Codex 0.171.0 (complete musl packages, both architectures), Claude
  Code 2.1.329 and Antigravity 1.5.13. Release manifests/checksums were compared;
  ARM Claude and Antigravity downloads independently matched their manifests.
  Nix fetches enforce the configured hashes. No Rust, nixpkgs, CUDA, model or
  embedding pin was changed. Codex's new catalog does not change the owner's
  configured model, and the Claude main/advisor policy was not decided here.
- Cooled npm roots: RuVector 0.3.27, Ruflo 3.77.1, MetaHarness 0.4.23, Darwin
  0.14.0, Agentic QE 3.15.20, Wrangler 4.163.0 and DeepSec 2.3.13. Root tarballs
  matched npm integrity; new locks contain only registry.npmjs.org URLs with
  integrity hashes. Recursive dependency hashes were materialised separately.
  Roots/transitives retain the 72-hour cutoff. The host's npm 12 URL restriction
  needed a command-scoped exception for Ruflo's npm-registry tarball resolution;
  install scripts stayed disabled and the resulting lock has no external URLs.
- Ruflo plugins are aligned to release commit
  `3a1479883b55b7f786ef0bf3141478e4dfb9444f`: console 0.50.1, mods 0.17.0,
  swarm 0.3.8. The real-tree bake passes 19 tests. CLI selection, no-auto-mod
  initialisation, governed-memory wrappers and the MCP allow-list remain.
  The new learning loop is hard-disabled to retain SONA-off/MCP-only memory;
  new transcript snapshots and the cost ledger default off. They were unset
  in the existing settings. Automatic model delegation remains default-off;
  no new paid completion is enabled by this upgrade.
- The manifest's only text change is its MetaHarness comment; its parsed
  values are unchanged. Schema/catalogue amendments describe the offline
  ARTEX CLI under the existing rebuild-class MetaHarness gate (ADR-2208).
  No supervisor, new listener, interception hook or persistent adapter is added.
- The only tmux change waits at most 30 seconds for the Systemscape hosts
  projection, and only when the private source exists. Four cases cover no
  source, an existing operator file, delayed projection and timeout. Three
  recorder-launch cases and the existing hosts-layer/boot-link checks pass.
  Notes, session ownership, seed commands and the dream-engine fallback stay.
- Custody inventory records the existing host WebSocket bearer as a secret
  under management-api's existing devuser-class exception. Sidecar bind and
  the two Systemscape path locals are non-secret. No token value was inspected,
  minted, copied or reclassified as public. Role delivery and the ROLE set do
  not change; role isolation remains off pending its separate rehearsal.
- The hash helper no longer compares a two-line `0\n0` after successful
  resolution. A regression exercises the no-unresolved-hashes case.

## Evidence and limits

Passing source gates: 737-name inventory and 14 custody tests; 25 role-supervisor
checks; 13 boot projection checks; 45 agent registry checks; 25 delivery and
persistence tests; 19 real-tree Ruflo bake/projection tests; seven Systemscape
launch/wait tests, eight hosts-layer checks and one boot-link fixture. Skills
lint passes for 125 skills. The four earlier core CLI update/provision tests
pass; the hash-count regression also passes.

ARTEX 0.1.0 is a named operator addition while its root is about 54 hours old,
an explicit exception to routine root freshness. Its exact sole dependency,
`@metaharness/harness` 0.2.1, predates the cutoff. Nix packaging and five local
tests pass: gate/service constraints plus both input fixtures in monitor and
simulate modes, receipt verification, tamper rejection and no overwrite.
Its npm tarball contains no tests (`npm test` discovers zero); that is not
counted as test evidence. No live quarantine or interception is configured.

Npm audit comparisons show no criticals. Ruflo improves from 13 findings
(8 high, 5 moderate) to 2 high; AQE from 6 moderate to zero. RuVector,
MetaHarness, Darwin and Wrangler report zero. DeepSec retains 4 high and 1
moderate finding. These are dependency-audit results, not a clean-image claim
or an assessment of kernels, volumes or other containers. No automatic audit
fix or out-of-policy transitive update was applied.

The browser source was already reviewed in ADR-2207. Its first rebuilt image
now runs Chrome Beta 159.0.8154.13, Chromium 158.0.8127.36, MCP 1.13.0, ws
8.23.0 and FFmpeg 9.1. Live diagnostics verify the exact 1920x1080 window and
non-fallback NVIDIA WebGPU with 1,024 correct compute results. The actual MCP
bridge advertises 49 tools and answers a read-only page-list call. The recorder
finalised a real H.264 file at the display size on an isolated X display,
never capturing the operator's VNC screen. Browser profile/exchange volumes
were retained. Podkey unlock is the owner's action. Agentbox's added exchange
mount still needs its separately checked activation migration.

No new live identity/role-isolation rehearsal, retrieval-geometry benchmark,
cloud-model round trip, paid evaluation or whole-record acceptance is claimed.
Image preparation, offline hook-engine checks and final runtime checks are
deployment gates, not implied by a source verification stamp.
