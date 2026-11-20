# Evening security rebuild — 2026-11-20

Active Agentbox source: `ba1265164ea309bd5443cfa37b3e4e8ede2ae9ab` (clean,
pushed). Image: `sha256:fb5924907d60d5f1ae3a5588eb553ade6f02313dbd98518a6de81b470f87aea4`.
Cutover: 22:01:48 UTC. This subsequent documentation-only commit does not
require another rebuild.

The rebuild deploys the NIP-98 missing-config guard, atomic/type-checked boot
projection and journal cross-process locking with displaced-holder checking.
Seven journal/adapter suites pass: 121 tests, one existing todo. Actual-image
fixtures pass all eight proxy cases, native mistyped-value rejection, real
supervisord deny/restart/allow sequencing, and six writers producing one valid
120-record chain. The deployed session endpoint rejects a freshly generated,
validly signed unlisted key with `pubkey_not_allowed`. These fixtures used no
production volumes or credentials. No production journal repair was attempted.

The browser policy image is
`sha256:ab589661b895ffce4688213890af75ea0b1e106a365c8ee897daa874f3590c83`.
Its existing profile/exchange volumes were retained. Podkey loads with its
original ID/public key; the vault remains locked for the owner to unlock.
Chrome reports both managed policies `OK`; display bounds and non-fallback
NVIDIA WebGPU compute pass. All 63 original browser tests and the additional
screenshot-guidance regression pass. A real MCP fixture uploads a file from
Agentbox, is explicitly foregrounded, saves a PNG readable there and closes.
Background captures stalled, so the baked skill now documents foregrounding
only an owned fixture and coordinating the brief VNC display change. No
operator page was captured. A live Web Store install-refusal attempt remains
unverified (ADR-2212); no real extension installation was attempted.

Core postchecks pass: persistent mount identities, supervised services,
RuVector MCP memory health, terminal truecolor, CUDA, NVENC and sidecar QGIS.
The existing main-model choice remains `fable`; no paid model calls were made.
After startup settles, the remaining readiness warning is the pre-existing
owner-parked elevation publisher (no signing stack, zero skipped/failed).

The service-changing preparation took 242.596 s build, 24.194 s push and
184.653 s pull, plus 0.822 s registry/smoke. The subsequent application-only
refresh for screenshot guidance took 119.324 s build, 14.792 s push and
69.434 s pull, plus 0.848 s registry/smoke. The platform, toolchain and agent-CLI
layers were reused throughout. No nixpkgs/toolchain pin or heavy native estate
was bumped. About 102 GiB remains free; no Nix/Docker pruning, data-volume
deletion or cache eviction was performed, and recovery images remain retained.

## Deliberate limits

- ADR-2210 still has the documented previous-config freshness and role-isolation
  readability prerequisites; role isolation remains off.
- ADR-2211 narrows, but does not eliminate, the documented stale-takeover and
  check/write races; timeout delivery can remain unpersisted.
- The unmerged `statcraft-0.4.2` branch includes a substantial computation patch.
  It was inspected and left for a separate correctness review, not silently
  swept into this security deployment. Other historical branches/worktrees
  and the parent repository's unrelated unpublished backlog were left intact.
