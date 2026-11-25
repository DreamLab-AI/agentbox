---
id: ADR-2055
title: Describe opf-router as the privacy-filter sidecar on its own port, never as a facade on the Loom's
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: baad4cdc100777f84f09edce22698fb9573858b9
verified_paths: [docs/BASELINE-container.md]
owner: jjohare
review_trigger: a change to [privacy_filter].port, to the [program:opf-router] supervisor block, or to the BASELINE-container supervised-program table
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: legacy ADR-008 (privacy-filter routing, defines opf-router at :9092), ADR-2023 (the Loom facade at :8084)
---

# ADR-2055 — Describe opf-router as the privacy-filter sidecar on its own port, never as a facade on the Loom's


## Scoped source verification — 2026-11-20

Reviewed the governed-path delta through `2ebc3859c77fce7996eb584d78a2b89c286d72c2` against the
[core-tool and browser source review](../estate-closeout/2026-11-20/core-tools-and-browser-source-review.md).
The change is limited to pinned tool packaging, the existing MetaHarness gate's
offline CLI, descriptive schema/catalogue text, bounded System-pane startup,
and honest classification of existing credentials. It changes no adapter,
listener, role authority, model policy or retrieval geometry. Existing decision,
implementation and activation axes and unrelated acceptance limits remain;
this is not a new whole-record runtime or role-isolation rehearsal.


## Scoped source check — 2026-11-14

Reviewed at `18315de55b9be6f8fdaed6e9f33b6ad26da1cf4f`. The BASELINE-container diff since 237178730 adds Blender packaging and QGIS/CAD guidance, and qualifies the ComfyUI cancellation observation by source revision. The opf-router row still names the privacy-filter redaction sidecar on 127.0.0.1:9092 (docs/BASELINE-container.md:129). The obsolete wording that treated this row correction as pending is updated to match the landed row and the record's complete status. No service restart or new live-port measurement is claimed.


## Context

`docs/BASELINE-container.md` lists, in its supervised-program table:

> `| opf-router (:1873) | OpenAI-compatible façade router | :8084 |`

Both the description and the port are wrong, and they are wrong in the same direction —
they describe the Loom:

- `opf-router` is the **privacy-filter redaction sidecar** (legacy ADR-008): a stateless
  local service running `openai/privacy-filter` that the adapter-dispatch middleware
  consults to redact prompts and durable writes. ADR-008 itself labels it
  `opf-router (:9092)`. It is not an LLM router and routes no completions.
- Its port is **9092**: `agentbox.toml [privacy_filter].port = 9092`,
  `scripts/opf-router.py` `PORT = int(os.environ.get("OPF_PORT", "9092"))`, and the
  generated `[program:opf-router]` supervisor block sets `OPF_PORT` from the same
  manifest key with a 9092 fallback.
- `:8084` is the **Ontology Loom facade** on the gateway host (ADR-2023), a different service
  on a different host reached by DNAT. **No agentbox program serves `:8084`.**

The conflation is load-bearing, not cosmetic: it caused a downstream reader of this
document to brief an entire diagram lane that the Loom was an agentbox-supervised
program. Exposed by diagram AB-24.1.

## Decision

Documentation names `opf-router` as the privacy-filter sidecar and cites its port from
`agentbox.toml [privacy_filter].port` (ADR-2052's key-anchored form). The BASELINE
supervised-program row reads, in substance: *privacy-filter redaction sidecar
(ADR-008)*, port *`127.0.0.1:9092`*.

No document describes any agentbox-supervised program as serving `:8084`. Where a doc
needs to mention `:8084` it says explicitly that it is the Ontology Loom facade on
the gateway host, reached over the LAN, and cross-references ADR-2023.

The runtime-owned `docs/BASELINE-container.md` row now carries this correction.
`implementation_status: complete` records the landed documentation change; it
does not assert a new service deployment.

## Consequences

- A reader can no longer conclude that agentbox hosts the Loom, or that the privacy
  filter is an LLM router. Those are the two errors this row produced.
- The privacy filter's real role — a fail-open redaction hop in the adapter middleware
  chain (observability → privacy → JSON-LD) — becomes findable from the baseline doc.
- Follow-on, routed to the runtime lane: correct the `opf-router` row's description and
  port, and re-check every supervisor line reference in that table. They are stale by
  **differing** amounts (+242 for `nostr-gateway` and `jupyter-lab`, +270 for
  `opf-router`), so this needs a per-row sweep, not a bulk shift — and it is a standing
  argument for citing supervisor blocks by `[program:<name>]` rather than by line, in
  the spirit of ADR-2052.

## Verification

Verification ran on the **uncommitted working tree** above
`89301ec7c911eab270c00a0cf81596d0d4f15535` and must be re-run at the landing commit;
`verified_paths` is therefore empty.

- `grep -n 'opf-router' docs/BASELINE-container.md` → the row asserting
  "OpenAI-compatible façade router" and `:8084`.
- `grep -n 'OPF_PORT' scripts/opf-router.py` → `PORT = int(os.environ.get("OPF_PORT", "9092"))`.
- `grep -n -A3 '^\[privacy_filter\]' agentbox.toml` → `enabled = true`, `mode = "local-cpu"`,
  `port = 9092`.
- `grep -n 'OPF_PORT' flake.nix` → the `[program:opf-router]` environment line and the
  image-env line, both defaulting to `9092`.
- `grep -rn 'opf-router' docs/archive/adr/ADR-008-privacy-filter-routing.md` → the ADR's
  own sequence diagram participant `OPF as opf-router (:9092)`, confirming 9092 is the
  designed port and the BASELINE row is the outlier.
- `grep -n '8084' flake.nix` → two matches, **both outbound client URLs and neither a
  bind**: the `[program:dream-engine]` environment line's
  `LOOM_URL=…${LOOM_HOST}/v1` default, and a compose `LOOM_BASE_URL` default.
  No supervisor block listens on `:8084`.
- Table-drift sample, showing the stale line references are **not** a uniform offset and
  need a per-row sweep rather than a bulk shift:
  `nostr-gateway` cited `:1567`, actual `[program:nostr-gateway]` at `:1809` (+242);
  `jupyter-lab` cited `:1610`, actual at `:1852` (+242);
  `opf-router` cited `:1873`, actual at `:2143` (+270).

## Close-out 2026-10-30 — partial → complete

The routed BASELINE edit has landed (`f8e61efac`, 2026-09-05, re-checked at `e786197ccb9f56c638d4b0181e77f33ab38b7db9`):
- `docs/BASELINE-container.md:94` → ``| `opf-router` | privacy-filter redaction sidecar (legacy ADR-008), gate `[privacy_filter]` | `127.0.0.1:9092` |``.
- `grep -n 8084 docs/BASELINE-container.md` → only the changelog lines 28 and 327, which record this correction. No row describes a supervised program serving `:8084`.
- The supervised-services table cites `[program:<name>]`, not line numbers (changelog 0.3.0, line 28). `grep -n 'flake.nix:[0-9]'` → two citations outside the table (lines 127 and 141).
- Live: `ss -ltnp` → `127.0.0.1:9092` held by `python3.12` pid 922 (`opf-router`), and nothing listening on `:8084`.

Re-verified 2026-10-31 at `b65c3d4ed`. Governed paths changed: `docs/BASELINE-container.md`: vault section wording: `pages` defaults to `.`, corpus verbs use `ontomark`, the `ONTOLOGY_PAGES_DIR` override is recorded as removed (`f4beec643`, `7aa9365d4`); the supervised-program table is unchanged. No section this record governs changed; the decision holds. Re-verified by `git diff e786197cc..b65c3d4ed -- <verified_paths>`; no re-implementation was needed. The image carries it at the next rebuild.

Re-verified 2026-11-05 at `3beca506c` for ADR-2177: the BASELINE gains an ADR-2177 paragraph, a services-table row and a changelog entry; the privacy-filter and Loom distinction this record guards is untouched.

Re-verified 2026-11-10 at `571c0ad43` (PR #45, ADR-2191, the Bend toolchain). Governed-path delta since `3beca506c`: `docs/BASELINE-container.md` gains a Bend paragraph above the supervised-services heading, a changelog line and version 0.5.16, and its supervised-program table is unchanged. Every hunk is an addition apart from the baseline version number. The change adds a gated language toolchain and no listener, published port, mount, volume, supervisor program, secret, identity, model route, vault path, registry entry or Nostr kind, and it alters no existing gate, so what this record decides is not touched. CI on that commit passed the flake evaluation on both architectures, config validation with the TUI round trip, the contract and adapter suites and the custody rehearsal. Re-run: `git diff 3beca506c..571c0ad43 -- <verified_paths>`.

Re-verified 2026-11-11 at `237178730` (ADR-2192, ADR-2193, ADR-2194 at `04638a618`; ADR-2195 at this commit). Governed-path delta since `571c0ad43`: `docs/BASELINE-container.md` goes to 0.5.17 with a changelog line and one new invariant (the first `python3` on a supervised process's `PATH` is `pythonRuntimeEnv`); its supervised-program table is not edited. The supervised-program table is not edited and nothing about `opf-router` or `[privacy_filter].port` changes. `[program:cad-engine]` is gated off and is not yet listed in that table. Run on this commit in the container: the configuration jest suites (294 passed), `skill-lint`, `skill-count-check`, the manifest validator, the egress register check, the secret inventory, the crate licensing check, the role-isolation and runtime-contract shell tests, `python-runtime-path` and `cad-launcher`. The flake was NOT evaluated (no Nix in the container) and no image has been built from it. The decision and status axes are unchanged. Re-run: `git diff 571c0ad43..237178730 -- <verified_paths>`.

## Scoped SystemScape mount review — 2026-11-18

Reviewed at `de01d60a408b9eb057a3b6257aabd9f764671c94`; governed deltas: docs/BASELINE-container.md.
The reviewed source delta is limited to the read-only SystemScape settings mount
and its boot-time link, plus the 0.4.0 package pin and exact upstream lock.
No published port, credential, identity, role or adapter authority changes.
Package tests (49), hosts-layer checks (8), actual boot-block fixture and
persistent-volume checks passed. Production mount acceptance remains separate;
this scoped review does not re-audit unrelated history or promote status axes.

## Re-verification — 2026-11-20 at `9263a39761c0c69e651e77ec1c91be33f015a1b5`

Governed delta: `docs/BASELINE-container.md` bumps to 0.5.19 with one changelog entry and a longer browsercontainer row (ADR-2207). The `opf-router` row is unchanged, now at `docs/BASELINE-container.md:131` (was :130; the added changelog line shifts it). Claim still true. The Decision is unchanged and no claim of this record is falsified by the ADR-2207 sidecar refresh. Commands run: `git diff de01d60a4..9263a3976 -- docs/BASELINE-container.md`. Re-run the diff to reproduce.

## ADR-2214 drift check — 2026-11-22

Compared every governed path changed by `fc95b3877` (ADR-2214). Those changes
move `/home/devuser/.gemini` from a tmpfs to the named volume `agentbox-
antigravity-state`, set `[providers.gemini].auth_mode = "oauth"`, add `gemini`
to the OAuth-capable providers, export `AGENTBOX_ANTIGRAVITY_AUTH_MODE` to the
Antigravity consultant, and correct comments and docs. No value, authority,
boundary or runtime behaviour governed by this decision changes. This is source
verification, not activation.

## Re-verification — 2026-11-25 at `baad4cdc100777f84f09edce22698fb9573858b9`

Governed delta since `fc95b3877`: `docs/BASELINE-container.md` goes to 0.5.21 with one changelog entry for ADR-2216's SystemScape upstream changes (`474ea5d47`), which adds no port, mount, adapter, secret or supervised program. The supervised-program table is not edited.

This record requires the baseline to describe `opf-router` as the privacy-filter sidecar on its own port, never as a façade on the Loom's `:8084`. The row is unchanged and now sits at `docs/BASELINE-container.md:133` (was `:132` at `fc95b3877`; the changelog line shifts it): privacy-filter redaction sidecar, gate `[privacy_filter]`, `127.0.0.1:9092`. `:8084` appears only in the changelog lines that record the 0.3.0 correction (`:36`, `:381`). In source, `[privacy_filter].port = 9092` (`agentbox.toml:1878`), and `[program:opf-router]` is at `flake.nix:3005`. Claim still true.

Checked with `git diff fc95b3877..baad4cdc1 -- docs/BASELINE-container.md` read in full and `grep -n 'opf-router\|8084' docs/BASELINE-container.md`. No live listener was checked. Citations in earlier sections are as of their own commit and are not renumbered. `node scripts/adr-index-gen.js docs/adr --check`. Decision and status axes unchanged.
