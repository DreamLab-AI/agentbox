---
id: ADR-2062
title: Extend the exposure gate from published ports to container-internal listeners
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 08e817f394a908264c378745193bf7a0bbf6ec0e
verified_paths: []
owner: jjohare
review_trigger: adding a supervised program that listens on a socket, joining agentbox to another shared docker network, or any change to a supervised program's bind address or auth mode
repo: agentbox
domain: INGRESS-identity
lineage: ADR-2013 (loopback-only compose publishes except the sanctioned list), ADR-2009 (nip98-proxy identity boundary), ADR-2040 (authentication remedy for the listeners this gate detects)
---

# ADR-2062 — Extend the exposure gate from published ports to container-internal listeners

## Context

`docs/BASELINE-container.md` flags that *"`code-server` binds `0.0.0.0:8080`
while every other surface binds `127.0.0.1`, verify this is intended before
ratification"*. Phase 1 diagram ES-10.8 carried it forward; this ADR resolves it,
and the answer is worse than the note implies.

Verified facts composing into **two** unauthenticated reachable surfaces:

1. `flake.nix:2180` runs `code-server --bind-addr 0.0.0.0:8080 --auth none`.
2. `flake.nix:1853` runs
   `jupyter-lab --ip=0.0.0.0 --port=8888 --no-browser --IdentityProvider.token=`
   — an **empty** `--IdentityProvider.token=` disables token auth entirely.
3. Both gates are ON in the running manifest: `agentbox.toml:1309`
   `code_server = true`, `agentbox.toml:509` `jupyter = true`. This is live
   configuration, not a hypothetical.
4. `docker-compose.yml:61` and `:59` publish them as `127.0.0.1:8080:8080` and
   `127.0.0.1:8888:8888` — loopback-only from the **host**.
5. `docker-compose.yml:160-162` joins agentbox to both `default` and
   `visionclaw`, and `docker-compose.override.yml:180-183` resolves `visionclaw`
   to the external `visionclaw_network`.

A loopback *publish* constrains host→container only. It does nothing to
container→container traffic on a shared bridge. Because code-server listens on
`0.0.0.0` inside the container, every other container on `visionclaw_network` —
the VisionClaw backend, the Loom sidecar, browsercontainer, gui-tools, the email
gateway — can reach `http://agentbox:8080` with `--auth none`, i.e. a full
editor and terminal on the workspace with no credential. `http://agentbox:8888`
is the same story: a Jupyter kernel is arbitrary code execution, and its token
auth is disabled by the empty `--IdentityProvider.token=`.

ADR-2013's gate cannot see this. Its scanner reads `ports:` declarations, so it
reasons about *published* ports; a container-internal `0.0.0.0` bind on a shared
network is invisible to it. That is a gap in the invariant's coverage, not a bug
in the scanner — which was itself hardened on 2026-09-05 from a line-walker into
a YAML parser precisely to close a different structural bypass
(`scripts/ci/check-ports-loopback.mjs:8-24`).

## Decision

**This ADR now owns only the gate half.** The listener-side remedy moved to
agentbox **ADR-2040** (ab-runtime) after that lead corrected a mistake in this
record's first draft — see "Corrected remedy" below. ADR-2040 states the
authentication invariant and makes the `flake.nix` changes; this ADR states the
detection invariant. The gate work landed on 2026-09-05 — see
**Verification — 2026-09-05**.

The exposure invariant is stated in terms of **listeners**, not publishes: for
every supervised program, the bind address is declared alongside its supervisor
block, and a program that binds a non-loopback address either authenticates
(ADR-2040) or is on the sanctioned list. The CI check is extended to read the
generated supervisor commands in `flake.nix` for `--bind-addr` / `--host` /
`--listen` / `--ip` style arguments and apply a listener rule alongside the
`ports:` rule it applies today.

This is deliberately a change of purpose for `check-ports-loopback.mjs`, from a
publish gate to a listener gate, which is why it is split from ADR-2040 rather
than bundled: the two decisions have different owners and different blast radii.

### Corrected remedy — binding loopback is NOT available here

This record's first draft proposed that `code-server` bind `127.0.0.1:8080`,
keeping the existing publish. **That is wrong and would have traded an exposure
for an outage.** Docker forwards a published port to the container's *bridge*
address, not to container-loopback, so a process bound to `127.0.0.1` inside the
container stops being reachable through `127.0.0.1:8080:8080` at
`docker-compose.yml:61` and the operator's access path breaks.

`:9095` is not a counter-example. `flake.nix:2247` can bind
`--host 127.0.0.1` precisely *because* it is never published and is reached only
by the co-resident nip98-proxy. `code-server` and `jupyter` must stay reachable
**through** their publishes, so loopback binding is not an available option for
them and authentication is the only remedy that preserves the workflow.

ADR-2040 therefore states the rule as: every supervised program that binds a
network interface either (1) binds container-loopback and is reached only by a
co-resident process — the aoe-serve shape — or (2) authenticates, with the
credential minted at boot into a `0600` file under a `0700` directory, honouring
an operator-supplied value. `--auth none` and empty auth tokens are forbidden on
anything not bound to loopback.

## Consequences

- Makes the defect class **detectable**. Closing the two live surfaces is
  ADR-2040's job; without this gate a third one arrives unnoticed the next time a
  supervised program is added.
- ADR-2013's invariant becomes honest about what it covers. Today "every compose
  publish binds `127.0.0.1` unless sanctioned" reads as a complete exposure
  statement and is not one — it is complete only for host-facing exposure.
- Adding a supervised listener gains one obligation: declare its bind address and
  auth posture. That is the cost of making the gate mean what it appears to mean.
- `check-ports-loopback.mjs` changes purpose, from a publish gate to a listener
  gate. That is a real scope change for a file other work depends on, which is
  why it is a separate record from ADR-2040 rather than a line in it.
- Cross-lead: `flake.nix` and `scripts/ci/` are **ab-runtime**'s files; the
  workflow that invokes the gate (`.github/workflows/invariants.yml`) is
  estate's. `docker-compose.yml` needs **no** change — the loopback publishes are
  correct and must stay, because a published port forwards to the container's
  bridge address and the publish is the operator's access path.
- Landed as `proposed` and moved to `accepted` when the gate was built
  (2026-09-05). The cross-lead split held: the gate and its wiring are this
  record's; `flake.nix` was not touched, so the one live listener the gate now
  detects is recorded as a finding for ADR-2040 rather than silently fixed or
  silently sanctioned.

## Acceptance test

This ADR's own acceptance is the **gate**, not the auth fix (ADR-2040 owns that
and carries the runtime probes):

1. The gate fails a fixture in which a supervisor command binds `0.0.0.0` on a
   port whose program neither authenticates nor is on the sanctioned list, in
   every argument spelling it must understand — `--bind-addr host:port`,
   `--host`, `--listen`, and `--ip` with a separate `--port` (the jupyter shape).
2. The gate passes the real `flake.nix` once ADR-2040's authentication lands, and
   would have **failed** it before — demonstrated by running the gate against the
   pre-ADR-2040 revision.
3. A program that binds container-loopback and is never published passes without
   needing a sanctioned entry — the aoe-serve shape (`flake.nix:2247`,
   `--allowed-host 127.0.0.1 --host 127.0.0.1`) must not be flagged.
4. Every supervised listener is enumerated with its bind address and its auth
   posture, so the estate has one list rather than a per-program search. `:9096`
   remains the one identity-gated LAN door (ADR-2009).

## Verification (pre-implementation evidence pass)

Superseded by **Verification — 2026-09-05** at the foot of this record, which
covers the implemented gate. The pass below establishes only that the exposure
is real. It ran on the **uncommitted working
tree** above SHA `89301ec7c911eab270c00a0cf81596d0d4f15535`; `verified_paths` is
empty because the tree is uncommitted, and this must be re-run at the landing
commit. No live container was probed — the acceptance test above is the runtime
proof and has not been executed.

- `grep -n 'bind-addr' flake.nix` → `:2180`
  `command=${pkgs.code-server}/bin/code-server --bind-addr 0.0.0.0:8080
  --auth none --user-data-dir … /home/devuser/workspace`.
- `grep -n '8080' docker-compose.yml` → `:61` `- "127.0.0.1:8080:8080"` (the sole
  match).
- `sed -n '150,165p' docker-compose.yml` → the service's `networks:` block lists
  `default` and `visionclaw` at `:160-162`.
- `grep -n -A4 '^networks:' docker-compose.override.yml` → `:180-183`,
  `visionclaw: {external: true, name: visionclaw_network}`.
- `sed -n '1,41p' scripts/ci/check-ports-loopback.mjs` → the gate's own header
  describes it as parsing `docker-compose*.yml` `ports:` declarations and lists
  its rejection cases (`:39-41`: non-loopback `host_ip` not on SANCTIONED, IPv6
  binds including `[::]`/`[::1]`, a non-sequence `ports` value). No supervisor
  command or bind-address inspection exists in it.
- Confirms in passing that ADR-2013's previously-recorded scanner gap is
  **closed**: `:8-24` records the 2026-09-05 closeout replacing the awk
  line-walker with a strict YAML parser, explicitly to reject the flow-mapping
  and JSON-flow bypasses the estate review reproduced.

### What this ADR is *not* claiming

Two adjacent gaps are deliberately excluded, on evidence from the ab-runtime
lead who owns the gate:

- **Publish-form coverage is not open.** ADR-2013's own closeout (`:160-165`)
  supersedes the earlier "does not cover all equivalent publish forms" sentence
  (`:41-42`): the structural-bypass half is closed because the gate parses the
  document rather than matching lines, so `{target: 80, published: 8080,
  host_ip: 0.0.0.0}` normalises to the same tuple as `"0.0.0.0:8080:80"` and is
  judged identically, and anchors/merge keys resolve so `ports: *public_ports`
  is audited on its resolved value (`check-ports-loopback.mjs:30-33`). It
  additionally rejects as unauditable, in every syntax, env interpolation in a
  port value, port ranges, bare container-only ports, unsanctioned non-loopback
  `host_ip`, IPv6 including `[::]`/`[::1]`, and a non-sequence `ports` value
  (`:35-41`). Nothing here needs hardening.
- **The deployment half is open but is not a scanner change.** The gate declares
  its own limit (`:43-47`): a passing run means the checked-in files declare no
  unsanctioned door, not that no unsanctioned door is open. Overlay order,
  interpolation and external files are outside what static parsing can see.
  Closing that needs a running-container port probe, which is a separate
  decision from this one.

This ADR's gap is orthogonal to both: a container-internal `0.0.0.0` bind is
invisible to a *ports*-based gate in any syntax and at any level of parsing
rigour, because it is never declared as a port at all. That is why the remedy is
to state the invariant over listeners rather than to improve the parser.

## Verification — 2026-09-05

`implementation_status: partial`, not `complete`: the gate is fully implemented,
wired and green on its own fixtures, but it **fails the live tree** on one
genuine unauthenticated non-loopback listener that belongs to ADR-2040, not to
this record. Per the cross-lead rule `flake.nix` was not touched and the gate's
exit code was left honest. `activation_status: live` — CI runs it.

Ran on the **uncommitted working tree** above SHA
`08e817f394a908264c378745193bf7a0bbf6ec0e`; `verified_paths` is empty because
the tree is uncommitted, and this must be re-run at the landing commit. No
container was built or probed: every fixture feeds synthetic supervisor text to
the checker, and the live run reads `flake.nix` as text.

### What was implemented

- `scripts/ci/check-ports-loopback.mjs` gains an ADR-2062 section. It splits the
  generated supervisord text in `flake.nix` into `[program:NAME]` blocks —
  bounded by the next header **or** the enclosing Nix string's `''`, so trailing
  Nix code far below the last block is not attributed to it — and extracts every
  stated bind address from `command=` and `environment=` lines:
  `--bind` / `--bind-addr` / `--bind-address` / `--host` / `--hostname` /
  `--listen` / `--listen-addr` / `--ip` / `--address` / `--addr` /
  `--http-address` in both `--flag value` and `--flag=value` form; `--port` with
  a host-carrying value; a bare IPv4 literal (the `wayvnc … 0.0.0.0 5901`
  shape); and env assignments named `BIND` / `HOST` or suffixed `_BIND` /
  `_BIND_ADDR` / `_LISTEN` / `_LISTEN_ADDR` / `_HOST`.
- Nix `${…}` bind values resolve three ways, never silently optimistically:
  **RESOLVED** (a string literal, or a single-line `let` binding that is one),
  **DEFAULTED** (`cfg.attr or "127.0.0.1:9720"`, directly or through a `let`
  such as `mcpHubBind` — the literal default is audited and the listener marked
  manifest-overridable), **UNRESOLVED** (anything else — reported by program,
  flag and line, exit 2, never passed over).
- A separate `LISTENER_SANCTIONED` list keyed by program name with a required
  reason string, seeded with the two programs ADR-2040 names as authenticated
  non-loopback listeners, each confirmed in `flake.nix` before seeding:
  `code-server` (`--bind-addr 0.0.0.0:8080 --auth password`) and `jupyter-lab`
  (`--ip=0.0.0.0` with the empty `--IdentityProvider.token=` removed, so the
  boot-minted `JUPYTER_TOKEN` applies).
- The publish rule and **its output format are unchanged** — other tooling
  parses it. Verified by capturing the gate's output before and after the
  change: the `PASS (check-ports-loopback): 10 compose file(s), 7 ports block(s)
  — all publishes loopback-only or explicitly sanctioned` line is byte-identical
  (`python3` string comparison of the two captures), and the listener rule emits
  only its own clearly-prefixed lines after it.
- `tests/security/check-listeners.test.mjs` (15 `node:test` cases) plus the CI
  step `check-listeners unit tests (ADR-2062 — supervisor bind-address listener
  rule)` in `.github/workflows/invariants.yml`, placed immediately after the
  `check-ports-loopback` step it exercises. Nothing was removed.

### Commands and results

- `bash scripts/ci/check-ports-loopback.sh` → **exit 1**. stdout carries the
  unchanged publish PASS line; stderr carries `FAIL (check-listeners,
  ADR-2062)` with the single finding below, then the listener enumeration
  (8 declared bind addresses).
- `node --test tests/security/check-listeners.test.mjs` → `# pass 15 # fail 0`.
- `node tests/security/ports-gate.test.mjs` (the ADR-2013 sibling suite, which
  is **not** wired into CI) → `38 passed, 1 failed`. The single failure is its
  own final assertion *"the checked-in compose files pass the gate"*, which
  asserts exit 0 on the real tree and now trips on the honest listener finding.
  That file is not owned by this record and was not edited; it goes green when
  the finding is resolved.
- `node --check scripts/ci/check-ports-loopback.mjs` and
  `sh -n scripts/ci/check-ports-loopback.sh` → clean.

### Finding — one genuine unauthenticated non-loopback listener

    flake.nix:2014: [program:wayvnc] (positional) 0.0.0.0 binds 0.0.0.0
      — non-loopback, not sanctioned

`command=${pkgs.wayvnc}/bin/wayvnc --output=HEADLESS-1 0.0.0.0 5901` — a VNC
server on every interface with no credential stated, reachable by every peer on
`visionclaw_network`. It is a third instance of exactly the class this ADR
exists to make detectable, and it is **not** one of the two ADR-2040 enumerated,
which is the argument for the gate made concrete on its first run. `flake.nix`
is ADR-2040's file, so it was left untouched and the exit code left honest.
Resolution belongs to that record: authenticate it, bind it loopback (5901 is
not published from this container, so the aoe-serve shape is available), or
sanction it with a reason. This record moves to `complete` when the live tree
passes.

Line numbers move: this tree carries other agents' uncommitted edits, and the
`:1853` / `:2180` cited in the Context above now read `:1926` / `:2260`.
Programs are cited by block **name** per ADR-2039; the numbers here are the
gate's own output at the time of the run.

### Against the acceptance test

1. **Every argument spelling fails a fixture.** Met — `--bind-addr host:port`,
   `--bind`, `--host` with a separate `--port`, `--listen`, `--ip=`,
   `--address`, `--port host:port` and the bare-positional shape each produce
   exactly one violation naming program, flag, address and line.
2. **Passes the real `flake.nix` post-ADR-2040, would have failed before.** The
   two ADR-2040 surfaces are recognised and would violate without their sanction
   entries — the negative control is the `openBind` fixture, a `let` binding
   defaulting `0.0.0.0` which fails. Not fully met on the live tree because of
   the `wayvnc` finding above, which is why this record is `partial`.
3. **A loopback, never-published program passes with no sanction.** Met —
   `[program:aoe-serve]` (`--allowed-host 127.0.0.1 --host 127.0.0.1`) is
   enumerated as loopback and is not flagged; a dedicated fixture asserts it.
4. **Every supervised listener enumerated with bind address and posture.** Met —
   the `LISTENERS (check-listeners, ADR-2062)` block prints all 8 with the
   resolved address, a `loopback` / `NON-LOOPBACK` / `UNRESOLVED` verdict, a
   `manifest-overridable` mark where the value came from a manifest default, and
   the sanction reason where one applies. `:9096` remains the one identity-gated
   LAN door and is untouched — it is a publish, governed by the other rule.

### Limits this gate does not overclaim past

Stated in the gate's own header so a reader of the code sees them:

- A program that binds every interface **by default while stating no address**
  is undetectable statically. `[program:x11vnc]` (`-rfbport 5901 -nopw`) and
  `[program:Xvnc]` (`-rfbport 5901 -SecurityTypes None`) are in that class: both
  are VNC servers with authentication disabled, both sit in desktop-stack
  branches mutually exclusive with `wayvnc`, and neither is visible to this
  rule. Closing that class needs a running-container listener probe
  (`ss -ltnp`) — the same shape as the deployment half ADR-2013 leaves open, and
  a separate decision from this one.
- A DEFAULTED loopback value can be moved non-loopback in `agentbox.toml`
  (`[resources.mcp_hub].bind`, `[sovereign.relay].bind`). The enumeration marks
  these `manifest-overridable` so the override is visible rather than implied.
- Every conditional Nix branch is audited, since any of them may be the text
  generated. That is fail-closed and deliberate.
- Auth posture is **not** inferred from a command line; a sanction records it by
  citation. This gate proves reachability; ADR-2040 owns the credential.

## Queen decision on finding 1 — 2026-09-05

`[program:wayvnc]` is one of three desktop-stack VNC servers (wayvnc, x11vnc `-nopw`,
Xvnc `-SecurityTypes None`; one runs per `desktop.stack` branch), all unauthenticated
by construction and all bound to every interface so that the compose publish
`127.0.0.1:5901:5901` (host loopback only, ADR-2013) can reach them; binding loopback
inside the container would break that publish. They are sanctioned in
`LISTENER_SANCTIONED` with the reason recorded, as a known exception of the ADR-2040
class scoped to the docker network, and VNC authentication minted at boot is
recorded in ADR-2040 as its open follow-on. Only wayvnc declares a bind flag; x11vnc
and Xvnc bind implicitly and are outside this rule's reach, which the limits above
already state. After the sanction `bash scripts/ci/check-ports-loopback.sh` exits 0
(publish rule PASS, listener rule PASS with three sanctioned binds) and
`node tests/security/ports-gate.test.mjs` passes again. `implementation_status`
moves to `complete`: the gate half this ADR owns is implemented and green.
