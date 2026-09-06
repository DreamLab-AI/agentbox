---
id: ADR-2013
title: Every compose publish binds 127.0.0.1 unless on the sanctioned-exposure list, CI-enforced across all overlays
date: 2026-08-31
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 796d85fcffb2153c7507d5bb2934f569b3994582
verified_paths: [scripts/ci/check-ports-loopback.sh, .github/workflows/invariants.yml, flake.nix, docker-compose.yml]
owner: jjohare
review_trigger: Any new entry on the SANCTIONED list, or a new compose overlay file
repo: agentbox
domain: INGRESS-identity
lineage: legacy ADR-045 (sovereign ingress front door), R-003 (loopback publish rule); scope extended to all overlays 2026-08-31 (external review closure 3)
---

# ADR-2013 — Loopback-only compose publishes except the sanctioned-exposure list

## Context
The identity boundary (ADR-2009) is only as strong as the exposure surface
around it. If any container service publishes on a routable interface, it
becomes a second door around the nip98-proxy. The gate originally parsed only
`docker-compose.yml`, which left the voice cockpit (`:8443`/`:8444`) and three
sidecar overlays (browsercontainer, gui-tools, xr-runtime) publishing `0.0.0.0`
uninspected — an admitted invariant breach while the record claimed
complete/live. The invariant must cover every compose file, with every
intentional exposure modelled rather than hidden. Governing doc:
`docs/INGRESS-identity.md`.

## Decision
The CI gate (`scripts/ci/check-ports-loopback.sh`) sweeps **every**
`docker-compose*.yml`. A publish must bind `127.0.0.1:` or appear on the
in-script `SANCTIONED` list — an explicit `(file, mapping)` inventory of the
LAN doors, each citing its governing rationale: `9096` (ADR-045 sovereign
ingress), voice `8443`/`8444` (cockpit TLS door — the former "second LAN
ingress" is now modelled, not silent), browsercontainer `5903`/`8931`/`9222`
(sidecar VNC / MCP SSE / raw CDP), gui-tools `5905`/`9876`/`9877`, xr-runtime
`5904`. Anything else fails CI. Long-syntax `published:`/`host_ip:` mappings
are forbidden in every file as part of the intended syntax restriction; the dated closeout evidence shows
that the scanner does not cover all equivalent forms. Adding a
SANCTIONED line is a security decision requiring a citation. This forecloses
silent new LAN doors in any overlay, present or future.

## Consequences
- The list records sanctioned mappings in the scanned root compose files;
  effective deployment inputs and active listeners need separate inventory.
- The voice cockpit and sidecar exposures are now *decided* exposures; closing
  or narrowing any of them is a one-line delete that CI then enforces.
- Cost: the sanctioned list must be maintained alongside overlay changes; a
  legitimate new exposure fails CI until explicitly sanctioned (that friction
  is the point).

## Verification
Re-checked 2026-08-31 (gate-extension commit): `scripts/ci/check-ports-loopback.sh`
iterates `"$ROOT"/docker-compose*.yml`; run locally passes with the ten
sanctioned mappings and fails on any unsanctioned `0.0.0.0` publish (negative
test: three deliberately-wrong container ports were rejected before the list
was corrected). Wired in `.github/workflows/invariants.yml`. The `9096:9096`
LAN publish remains declared at `flake.nix:1997` (D2 exposure policy).

**2026-09-05 re-verified at 08e817f39.** Governed paths changed by `11804ba4b` (the parser rewrite this record's acceptance section describes) and by `7e7b2d586` (`.github/workflows/invariants.yml` gained the deepsec, ADR-index and crate-licensing jobs alongside this one). The decision still holds. Re-checked at HEAD: `scripts/ci/check-ports-loopback.sh` is now a thin wrapper that hard-fails (exit 3) when the `.mjs` gate or `node` is absent — a missing interpreter is a failure, never a skip — and `exec`s `scripts/ci/check-ports-loopback.mjs`, which carries the ten-entry `SANCTIONED` inventory at `:76-87` with a per-entry citation block at `:57-75` and matches on the normalised `(host_ip, published, target, protocol)` tuple at `:611`. Wired at `.github/workflows/invariants.yml:52-53`. The `9096` LAN publish is declared at `flake.nix:2645-2651` (`agentboxPorts`; the previously cited `flake.nix:1997` has drifted), with every other entry `127.0.0.1:`-bound. Live run: `sh scripts/ci/check-ports-loopback.sh` → exit 0, `PASS … 10 compose file(s), 7 ports block(s) — all publishes loopback-only or explicitly sanctioned`. `implementation_status` stays `partial`: the sanctioned list still records mappings in the scanned compose files, not deployed listeners, and the CP-08 deployment receipts remain outstanding. Commands: `git diff --name-only 89301ec7..HEAD -- scripts/ci/check-ports-loopback.sh .github/workflows/invariants.yml flake.nix docker-compose.yml`, `sh scripts/ci/check-ports-loopback.sh`.

**2026-09-05 — the checker gained a listener rule (ADR-2062).** `scripts/ci/check-ports-loopback.sh` now applies two rules in one run: this record's publish rule over `docker-compose*.yml` `ports:`, unchanged in behaviour and byte-identical in output, and a new listener rule that reads the generated supervisord `command=` / `environment=` lines in `flake.nix` for `--bind` / `--bind-addr` / `--host` / `--listen` / `--ip` / `--address` / host-carrying `--port` arguments and `*_BIND` / `*_HOST` env assignments, resolving Nix `${…}` interpolation to a literal or reporting it UNRESOLVED. This closes the coverage gap ADR-2062 names: a loopback publish constrains host→container only, so a container-internal `0.0.0.0` bind on the shared `visionclaw_network` was invisible to a ports-based gate in every syntax. This record's own invariant, sanctioned list and exit codes for the publish plane are unchanged; `verified_commit` is not bumped here. Fixtures: `tests/security/check-listeners.test.mjs` (15 cases), wired in `.github/workflows/invariants.yml` next to the gate step.

## Closeout extension — 2026-09-04

CP-01/04/08. Owner remains jjohare with ingress/release maintainers. Current compose files pass the actual gate. Four isolated fixtures show that a block public port is rejected while equivalent nested service-flow and JSON-flow short mappings pass. The line walker misses `ports` keys that do not begin a line. Implementation is partial against the structural-bypass guarantee; sanctioned exposure decisions and historical live status are preserved without current deployment certification.

**Acceptance condition:** Parse or reliably reject all supported configuration forms, then audit the resolved deployment input set, including overlay order, interpolation and external files. Cover block/flow, aliases/merges, long syntax and filename scope with negative controls. Bind each exposure exception to service identity, authentication, intended audience and active listener evidence. The root filename glob and a ten-entry mapping list do not establish every network door. Reopen on parser, workflow, deployment invocation or sanctioned mapping changes; dependencies are CP-01 release identity and CP-08 deployment receipts.

See the [ingress review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/runtime-ingress.md#port-gate-syntax-and-exposure-coverage), [actual-gate reproducer](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/ports-gate-probe.py) and [receipt](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/ports-gate-probe.json). No compose deployment or port binding ran; fixtures do not assert a current exposed service.

## Acceptance progress — 2026-09-05

**Implemented.** The gate no longer pattern-matches lines; it parses the
document.

- `scripts/ci/check-ports-loopback.mjs` (new) carries a strict, dependency-free
  YAML reader for the subset compose files use: block mappings and sequences,
  flow mappings and sequences — so JSON parses for free, including a multi-line
  whole-document JSON file — single/double-quoted scalars, block scalars,
  multiple documents, anchors, aliases and merge keys. Anything outside that
  subset (YAML tags, tabs in indentation, unterminated flow collections,
  undefined aliases) is **rejected with a file and line**, never skipped. "Parse,
  or reliably reject" is the guarantee; there is no third outcome in which a
  construct is silently ignored, which is what the previous walker did.
- Because the document is parsed, long syntax is no longer banned by spelling:
  `{target, published, host_ip, protocol}` is normalised to the same tuple as
  `"0.0.0.0:8080:80"` and judged identically. Anchors and merge keys are
  resolved, so `ports: *public_ports` is audited on what it resolves to.
- The sanctioned list is now explicit tuples matched **semantically**. A sanction
  therefore cannot be smuggled in by re-spelling, does not transfer between
  compose files, and a sanctioned published port with a different target is a
  different door.
- Still rejected as unauditable in every syntax: environment interpolation, port
  ranges, bare container-only ports, IPv6 binds (including `[::1]`), a `ports`
  value that is not a sequence, and unknown long-syntax keys.
- `scripts/ci/check-ports-loopback.sh` remains the CI entry point and execs the
  gate; a copy of the wrapper without its implementation exits 3 with an explicit
  message rather than looking like a pass. `.github/workflows/invariants.yml` is
  unchanged.

**Tests and results.** `node tests/security/ports-gate.test.mjs` — **39 passed,
0 failed**. The reproduced bypass is covered in all six spellings of the same
door (block, nested service-flow, JSON-flow, flow-on-key, long syntax block and
inline, and long syntax with no `host_ip`), plus alias and merge-key sources,
filename scope (`.yaml`, a non-root-named overlay, a second YAML document, a
top-level `x-` extension), the unauditable shapes, the accepted loopback shapes,
semantic sanction matching, an empty root, and the lone-wrapper failure mode.
`sh scripts/ci/check-ports-loopback.sh` on the current tree — exit 0, 10 compose
files, 7 ports blocks.

**Receipts.** `docs/estate-closeout/2026-09-05/adr-2013-ports-gate.json`.

**Remaining.** The gate audits the compose **source** files matched by the root
glob. It does not resolve overlay order, `--env-file` interpolation, `extends`,
`include:` or files outside the repository root, and it certifies nothing about a
running deployment: a pass means the checked-in files declare no unsanctioned
door, not that no unsanctioned door is open. Binding each exposure exception to
service identity, authentication, intended audience and active-listener evidence
is not done, and no compose deployment or port binding ran.

**Governed paths changed.** `scripts/ci/check-ports-loopback.sh`,
`scripts/ci/check-ports-loopback.mjs` (new), `tests/security/ports-gate.test.mjs`
(new).

### Re-verification 2026-09-05

Re-verified at `verified_commit` 89301ec7c911eab270c00a0cf81596d0d4f15535, on the
uncommitted working tree above that SHA; re-run at the landing commit.
`verified_paths` is emptied because the previous list named
`scripts/ci/check-ports-loopback.sh` as the gate, and the gate has since moved to
the sibling `.mjs`; the landing commit sets the correct list.

Each claim re-checked against current lines:

- **Entry point.** `scripts/ci/check-ports-loopback.sh:2-18` is now a wrapper that
  resolves and execs `check-ports-loopback.mjs` relative to itself, and exits 3
  with an explicit message if the gate is missing — a stray copy of the wrapper
  cannot look like a pass. The `sh scripts/ci/check-ports-loopback.sh` invocation
  in `.github/workflows/invariants.yml` is unchanged, so the workflow needed no edit.
- **Parser.** `check-ports-loopback.mjs:2-47` states the subset and the
  "parse, or reliably reject" guarantee; `:162-202` is the flow-collection reader
  that makes JSON parse for free and raises `ParseError` with a line for
  unterminated flow collections and comments inside them.
- **Sanctioned list — ten entries, not two.** `check-ports-loopback.mjs:75-86`
  is matched on the normalised `(host_ip, published, target, protocol)` tuple, not
  on source spelling: `docker-compose.yml` 9096 (ADR-045 sovereign ingress);
  `docker-compose.voice.yml` 8443 and 8444 (voice cockpit TLS door, "second LAN
  ingress, modelled not hidden"); `docker-compose.browsercontainer.yml` 5903, 8931
  and 9222→9223; `docker-compose.gui-tools.yml` 5905, 9876 and 9877;
  `docker-compose.xr-runtime.yml` 5904. The comment block at `:55-73` carries the
  governing citation for each.
- **`host_ip: null`.** `:71-73` records that a mapping stating no host address is
  read by Docker as every interface, that 9096 is written that way today, and that
  it is sanctioned in that exact form.
- **Current result.** `sh scripts/ci/check-ports-loopback.sh` →
  `PASS (check-ports-loopback): 10 compose file(s), 7 ports block(s) — all
  publishes loopback-only or explicitly sanctioned`, per the receipt at
  `docs/estate-closeout/2026-09-05/adr-2013-ports-gate.json`.

`implementation_status` stays `partial`, but the partial half has moved. The
structural-bypass half of the 2026-09-04 acceptance condition is **closed** — all
supported configuration forms now parse or are rejected with a location. What
remains open is the deployment half: overlay order, interpolation, external files,
and binding each exposure exception to service identity, authentication, intended
audience and active-listener evidence. No compose deployment or port binding ran.

**Correction to a downstream reading.** `docs/INGRESS-identity.md` "Compose
exposure qualification — 2026-09-04" still describes the line-oriented walker as
the current gate; that text is stale and is corrected under ADR-2047. Diagram
AB-10.1 carries the same correction.

## Landing re-verification — 2026-09-05 (ddd1f1ec8)

Governed paths changed in the landing commit: .github/workflows/invariants.yml: the check-listeners unit-test step added beside the check-ports-loopback step; docker-compose.yml: tmpfs sizes synced to [resources.tmpfs] and the aoe-profiles volume, no `ports:` change; scripts/ci/check-ports-loopback.{mjs,sh}: the ADR-2062 listener rule, publish output byte-identical; flake.nix: the aoe-profiles volume entry and baseline volume name (ADR-2063) and the `lib.optionalString podcastIngestEnabled` wrapper around [program:podcast-cron] (ADR-2057); the aoe-serve, nip98-proxy, relay and proxy blocks are byte-identical. `bash scripts/ci/check-ports-loopback.sh` exits 0 at this commit (10 compose files, 7 ports blocks, three sanctioned VNC binds). Decision unaffected; `verified_commit` moved to the landing commit.

## Landing re-verification — 2026-09-06 (796d85fcf)

Governed paths changed in the Wave 3 landing commit: flake.nix. The changes are the ones recorded by the Wave 3 records landed in that commit (ADR-2061, 2064, 2065, 2066, 2068, 2069, 2070, 2072, the proposed 2071/2073–2078) and the ADR-2018 recall diagnosis; none alters this record's decision. Gates at the landing commit: management-api 81 suites / 1290 tests, exposure gate PASS, catalogue 60 paths, config validation clean. `verified_commit` moved to the landing commit.
