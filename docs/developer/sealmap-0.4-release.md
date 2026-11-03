# Sealmap 0.4 release and integration receipt

Date: 3 November 2026. This closes the Sealmap modernisation; the operator
requested a handoff for the subsequent build-with-quality revamp and a stop.

## Delivered

[Sealmap 0.4.0](https://github.com/DreamLab-AI/sealmap/releases/tag/v0.4.0)
is merged on upstream `main`, at
`ad2e960f1f36eb2b8b63eb66ac508dae4ad30762`, and tagged `v0.4.0`.
All seven crates (`sealmap`, `sealmap-model`, `sealmap-extract`, `sealmap-rust`,
`sealmap-mermaid`, `sealmap-dense`, `sealmap-corpus`) were published at 0.4.0.
Each package passed Cargo's packaged-source verification before upload.

The release provides immutable-review evidence receipts, conservative per-file
pack selection and input provenance, portable route/tier APIs with explicit
Agentbox adapters, filesystem/fingerprint/family-boundary repairs, and a
standalone README with executed examples and an expandable ecosystem section.
The [upstream changelog](https://github.com/DreamLab-AI/sealmap/blob/v0.4.0/CHANGELOG.md)
records breaking API/output changes. Symbol seals remain experimental.

Agentbox consumes the actual published GitHub archive in `lib/sealmap.nix`.
Its NAR hash is `sha256-uThGCztA6RVxz97uLiNkHgg6APK6EN6w9T/HbkZ5npk=`.
The vendored lockfile is byte-identical to the tag, SHA-256
`d83ab75985ad8e0fead43c3eb91d3ab8bac684618ca1810a332418d77ed8a7a4`.
The archive hashing tool reproduced the old 0.3.0 pin before computing this pin.

`sealmap-review` delegates receipt commands to the CLI. Findings intake now
retains incomplete responses and uncertainty, compares matching source packs
and distinct model families, and keeps source-bearing triage prompts private.
The monthly audit cap includes configured, discovered, explicit and previously
witnessed repositories. Successful shards settle immediately. The private
monthly integrity witness must survive rebuilds under
`${XDG_STATE_HOME:-~/.local/state}/sealmap-review/`; it detects Git ledger rewinds,
not an operator who deliberately changes both ledger and witness.

Build-with-quality consumes the evidence workflow. Its Deepsec wrapper now
rejects input errors, missing/malformed exports, unknown severity and stale
report files; CI uses the inspected Deepsec 2.3.10 protocol. The new lessons are
in `references/review-evidence.md`; no VisionCraft implementation was started.

## Verification

[Release CI](https://github.com/DreamLab-AI/sealmap/actions/runs/41616442401)
passed on `3b51a4a`, whose tree is the release merge tree: stable formatting,
Clippy, default/no-default tests and rustdoc; Rust 1.85 build/tests; generated
output determinism; diagram citation/render checks. Local workspace gates and
the README's real failing-test/control/receipt journey also passed.

Independent Claude review of Codex-authored changes retained the original
findings and then revalidated repairs:

| Scope | Original result | Revalidation |
|---|---|---|
| Sealmap filesystem/fingerprint boundaries | Five findings, original BLOCK retained; pre-existing at 0.3 baseline | Fixed 5, TP 0, FP 0, uncertain 0; run `20261103094749-a71a5923c099dbf5` |
| Model-family prefix inference | One BUG; prefix defect also existed at 0.3 | Fixed 1; run `20261103100511-3b360a0d2cb12fb3` |
| Agentbox budget/settlement accounting | Two BUG findings below the HIGH gate threshold | Fixed 2; run `20261103100221-b97a94ebc977d1dd` |

Agentbox checks: 89 offline adapter tests, 21 cron checks, 16 security-wrapper
fixture tests, skill lint (131 skills, 29 existing warnings, 33 suppressions).
A real invalid Git-ref probe now returns runtime error 70 instead of false PASS.
Same-family peer review additionally exposed malformed export rows and unknown
severity; regression controls now reject both. These wrapper checks are distinct
from an independent model audit of the entire wrapper implementation.

The registry-installed `sealmap 0.4.0`, with no local path patch, was exercised
through Agentbox's receipt adapter against the executed README fixture:
valid receipt, one confirmed finding, zero unresolved, zero deployment claims.

## Runtime boundary and retained evidence

At final verification the image's ordinary PATH still returned `sealmap 0.3.0`
and the baked build-with-quality entry was 1.5.0. The source skill is 1.5.3.
The 0.4 registry smoke binary used an explicit temporary PATH. No activation,
host build, running-image replacement or measured model-tier descent is claimed.
The operator's rebuild may have taken its source snapshot before these changes;
check the installed version and baked skill after the next authorised rebuild.

Raw task evidence is archived outside disposable worktrees at
`~/workspace/evidence/sealmap-20261103/`; `archives.json` records archive hashes
and sources. Archives were byte-compared with their original files. They retain
red/green regressions, exact model runs, the invalid false-PASS attempt, the
interrupted pre-merge revalidation, setup failures and successful controls.
Copied binaries and build caches are disposable and are not proof artefacts.
Shared memory checkpoint: `sealmap-modernisation-20261103-active`.

Remaining activity-routing/measurement boundaries are in ADR-2130. The next task
is described in [the VisionCraft handoff](visioncraft-handoff.md); it has not
been implemented. Preserve the operator's unrelated planning files and worktrees.
