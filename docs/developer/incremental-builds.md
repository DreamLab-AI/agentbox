# Incremental builds without interrupting Agentbox

The host lifecycle is split into preparation and activation (ADR-2132). Neither
the source repository nor runtime capabilities are split. Data volumes and
existing sidecars are outside this workflow's mutation boundary.

```sh
./agentbox.sh prepare              # build, registry push/pull, offline smoke test
./agentbox.sh activate             # DISRUPTIVE: replace only Agentbox, when ready
./agentbox.sh rebuild --prepare-only # equivalent preparation, no activation
./agentbox.sh rebuild              # prepare then activate, no stack down or GC
```

Preparation does not invoke `compose up`, `down`, `stop`, `restart`, credential
sync, or the candidate entrypoint. The offline smoke container has no network,
production volumes or credentials. The running container's ID and start time
must remain unchanged. Nix builds use two jobs and four cores per job to leave
headroom for ongoing work. An exclusive host `flock` prevents overlapping runs.

## Layer contract

`lib/image-layers.nix` constructs ordered layers, each excluding the store paths
in every preceding layer. `flake.nix` groups platform/GPU/desktop dependencies,
toolchains, agent CLIs, and remaining services; the final layer contains the
application/configuration tree. Every enabled package remains included through
the final `allPackages` group. An unclassified new package is not silently lost.
Preparation rejects a manifest with duplicate store paths across layers.

Do not put frequently edited scripts or generated configuration in a platform
layer. Do not automatically update nixpkgs/toolchains on every application
deploy. Updating a lower layer changes Docker's parent chain even when later
layer blobs are identical, so those updates are intrinsically more expensive.

## Local registry and delivery

The default transport uses the official Distribution registry pinned by digest
in `config/build-registry.json`. Its separate host-build cache container listens
on **127.0.0.1:15000 only**, with host networking so it has no bridge-facing
anonymous listener. It has no host credentials, Docker socket, or runtime data
mounts. Only the new `agentbox-build-registry-data` cache volume is attached.
It is not part of the runtime manifest, adapter spine or production Compose
stack, and it is never exposed through the interaction plane.

The helper requires a local Linux Docker socket and refuses to adopt a same-name
container whose pinned image, listen address, label, network or storage differs.
Other platforms can use `prepare --delivery daemon`; this streams the whole
image and does **not** provide incremental transfer. `--delivery none` builds
and reports layers without importing or replacing an activatable candidate.

The first registry delivery is a cold transfer and may take substantial time.
Subsequent pushes/pulls reuse content-addressed blobs. The runtime tag is not
overwritten: candidate tags derive from the Nix output, and registry candidates
are pulled and activated by immutable manifest digest.

## Receipts, activation and recovery

Host-only `.agentbox-build/candidate.json` records the Nix output, layer report,
image identity, timings, original running container and a hash of the complete
merged Compose configuration (including resolved environment). Secrets are
neither printed nor written to receipts. Generation receipts and Nix GC roots
remain in `.agentbox-build/generation-*`.

Activation refuses configuration drift, image replacement, a restarted/replaced
running container, or any change to persistent mount source, target or access
mode. Volume/mount migrations need a separately reviewed procedure. It tags the
current image for recovery, then uses the base **and override** Compose files
with `up -d --no-deps --force-recreate --pull never agentbox`. Other
services are not recreated. It waits for readiness; failure is reported, with
no automatic rollback that could restart an old chain producer unexpectedly.
Use the existing `up` workflow for first-time stack provisioning/dependencies.

## Cache retention and measurements

Successful candidate preparation keeps Nix roots for the latest and previous
candidate plus the last candidate activated by this workflow. Older successful
generation root symlinks are released; receipts remain. Failed preparations
remain rooted for diagnosis. No store GC, image prune, Cargo-cache reaper or
volume prune runs automatically. `--no-cleanup` remains a compatibility no-op.
The legacy `post-deploy-cleanup.sh` is not invoked by this workflow.

Registry blobs are retained for reuse; this is **not** an unlimited-space
guarantee. Check cache disk usage periodically. Registry deletion/GC and failed
generation cleanup are separate operator maintenance, never coupled to a live
Agentbox update. A private Nix binary cache and Rust dependency-artifact caching
remain possible follow-ups, not claimed as implemented here.

Compare candidate receipts' `report.layers`, `report.changedBytes` and `seconds`.
Measure application-only edits separately from CLI and toolchain upgrades;
never infer incremental speed from the cold first import. Gates:

```sh
node --test tests/config/runtime-delivery.test.cjs
```
