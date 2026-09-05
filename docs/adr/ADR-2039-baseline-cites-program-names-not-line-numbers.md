---
id: ADR-2039
title: BASELINE-container cites program names, not line numbers, and is re-verified against the tree
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: A governing-doc citation that names a line number in a generated or frequently-reordered file, or a "Known divergences" bullet older than one release with no re-verification
repo: agentbox
domain: BASELINE-container
lineage: ADR-2003 (manifest-driven composition); records the ADR-2008 and ADR-2032 closeouts against the doc; incorporates ADR-2055 (opf-router row) routed from ab-learning-capabilities
---

# ADR-2039 — BASELINE-container cites program names, not line numbers, and is re-verified against the tree

## Context
BASELINE-container carried `verified_commit: 73540faa0`. Every line citation in its supervised-services
table had drifted by a different offset — `management-api (:1766)` was at `flake.nix:2036`,
`aoe-serve (:1971)` at `:2246`, `nostr-gateway (:1567)` at `:1809`, `jupyter-lab (:1610)` at `:1852`,
`opf-router (:1873)` at `:2143` — because the table cites positions in a file whose package set
reorders on every gate change, and the "re-verify every `file:line`" instruction in §Change process
was never mechanically enforced. Four factual claims had also drifted, and two "qualification"
sections still described defects the code had since closed. The estate lead independently traced
three of their own wrong citations to the same cause: divergence-bullet line numbers propagate into
downstream work because nothing re-verifies them. Exposed by diagrams **AB-02.4**, **AB-04.6**,
**AB-05.2**, **AB-07.6**, **AB-09.1**, **AB-09.3**.

## Decision
This document identifies a supervised program by its `[program:<name>]` block name, never by a line
number. The same rule applies to any citation into a generated or frequently-reordered file: cite the
stable identifier (program name, function name, const name) and reserve `file:line` for stable
definition sites the reader will open.

A "Known divergences" bullet is not durable state. When the code closes it, the bullet is replaced in
the same change by `Resolved — ADR-20xx (2026-09-05)` plus one line of evidence, and the ADR it names
carries the re-verification. A bullet nobody has re-verified is treated as *unverified*, not as fact —
in particular, its line numbers are the least trustworthy content in the document and are not to be
copied into other work without opening the file.

## Consequences
- Corrected in this change, each re-derived against the working tree:
  - The supervised-services table drops all 20 stale line refs.
  - `opf-router` is the privacy-filter redaction sidecar (legacy ADR-008) on `127.0.0.1:9092`, gated
    by `[privacy_filter]` — not an "OpenAI-compatible façade router" on `:8084`. No agentbox program
    binds `:8084`; the only `8084` hits in `flake.nix` are outbound `LOOM_URL`/`LOOM_BASE_URL` client
    defaults. (ADR-2055, routed from ab-learning-capabilities.)
  - `ruvector` pins `0.3.0`, not `0.2.25`.
  - The `CATALOGUE` holds 60 entries — 13 surfaces + 47 modules, not "14 surfaces + ~35 modules".
  - `skills/mcp.json` holds 28 servers, not 30. Its 9 projector / 3 bespoke / 16 reference split was
    already correct and sums to 28.
- The "Configuration projection qualification — 2026-09-04" and "Process lifecycle qualification —
  2026-09-04" sections are marked resolved with evidence, and `ADR-2008` and `ADR-2032` each gain a
  `### Re-verification 2026-09-05` section. The original text of each qualification is retained inline
  so the history is not lost.
- The cost is that a reader who wants a line number must run one `grep -n 'program:' flake.nix`. That
  is the correct trade: a name that is wrong is loud, a line number that is wrong is silent.
- Not closed here: §Change process still asks a human to re-verify citations by hand. A CI check that
  fails on a bare `<generated-file>:<digits>` citation in a governing doc would enforce this
  mechanically; ab-learning-capabilities proposed one as ADR-2052 and it is the right follow-on.

## Verification
Verification ran on the **uncommitted working tree** above SHA
`89301ec7c911eab270c00a0cf81596d0d4f15535`; `verified_commit` and `verified_paths` must be re-run and
restored at the landing commit.

- `grep -n 'program:' agentbox/flake.nix` → the authoritative program list used to rebuild the table;
  confirms `nostr-relay` and `i3wm` each appear twice as mutually exclusive Nix branches.
- opf-router: `sed -n '41p' agentbox/scripts/opf-router.py` →
  `PORT = int(os.environ.get("OPF_PORT", "9092"))`; `sed -n '950,953p' agentbox/agentbox.toml` →
  `[privacy_filter]` … `port = 9092`; `sed -n '2143,2144p' agentbox/flake.nix` →
  `[program:opf-router]` running `scripts/opf-router.py`.
- ruvector: `sed -n '194,197p' agentbox/flake.nix` → `pkgName = "ruvector"; version = "0.3.0";`.
- Catalogue census: `grep -c "layer: 'surface'"` → 13, `grep -c "layer: 'module'"` → 47,
  `grep -c "{ id: '"` → 60, all against `agentbox/management-api/lib/system-manifest.js`.
- MCP census: `node -e "console.log(Object.keys(require('./skills/mcp.json').mcpServers).length)"`
  → 28.
- ADR-2008 closeout: `sed -n '30,49p' agentbox/scripts/project-mcp-servers.mjs` (D1 ledger, D3
  non-zero exit) and `sed -n '71,74p'` (exit codes 0/2/3).
- ADR-2032 closeout: `grep -n "process_identity::verify" agentbox/services/agentbox-ops/src/hermes/mod.rs`
  → `:575` and `:596`; `sed -n '434,435p'` → delivery reported separately from confirmed exit.
- `cd agentbox && node scripts/adr-index-gen.js docs/adr --check` → exit 0; results in the Phase 2 report.
