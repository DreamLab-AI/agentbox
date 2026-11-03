# VisionCraft extraction: inventory and implementation status

Updated 3 November 2026. The operator resumed the extraction after the original
handoff and authorised publication, a hard cutover and Jev integration. The
handoff-only stop instruction and proposed compatibility alias are superseded.

The standalone [VisionCraft repository](https://github.com/DreamLab-AI/visioncraft)
now contains a Rust library and CLI, bounded execution and evidence gates, the
Deepsec adapter, the canonical 34-file skill, worked examples, ADRs and a
Sealmap-generated diagram corpus. It consumes `sealmap-corpus` 0.4.0. The
[Sealmap release receipt](sealmap-0.4-release.md) records that completed release.

Publication and Agentbox adoption are being verified before the operator's
rebuild. This document does not establish live image activation.

## Retained inventory

The [surface inventory](visioncraft-handoff/inventory-handoff.md) and
[design review](visioncraft-handoff/design-review.md) are historical snapshots,
with original source hashes, caller rosters and a file-by-file migration matrix.
Do not repeat that inventory or interpret its former proposals as current APIs.
The canonical implementation and migration mapping now live in VisionCraft.

The implementation preserves EDD, debugging, static-oracle work, diagram-driven
diagnosis, DDD/ADR/TDD/BHIL, Rust guidance, examples and accumulated review lessons.
The new code is MIT/Apache-2.0; separately attributed BeautifulRust material keeps
its original MIT notice. Unsupported API and learning-performance claims were
removed. No parallel findings database, execution engine or ontology store was
introduced.

## Consumer boundary

Agentbox owns configuration, credentials, installation and activation. Its Rust
adapter projects policy into `visioncraft deepsec`; VisionCraft owns the generic
review protocol and evidence checks. A locked upstream snapshot supplies the
skill payload, with byte-parity checks. Active callers and Jev routing move to
`visioncraft`; there is no second active `build-with-quality` implementation.

Agentic QE 3.15.10 is a separate upstream, directly registered as MCP for both
harnesses. Ruflo remains the host's coordination service. AQE's optional embedding
backend is not silently pointed at Agentbox's incompatible model; ephemeral
memory and task-driven workers are configured. Deepsec 2.3.10 remains an optional
external reviewer with explicit source, package and protocol maintenance docs.

## Evidence and limits

The retained skill comparison used four held-out cases over three paired runs.
Both versions scored 100%; the result demonstrates no measured regression on
that small set and does not establish an improvement. Raw evidence is retained
outside task worktrees under `~/workspace/evidence/visioncraft-20261103/`.

Independent model review findings are being reproduced and corrected before
release. Source tests, publication, host adoption and live deployment must retain
separate receipts. Do not reopen the unrelated VisionClaw/Codescape audit or
modify the operator's planning files as part of this extraction.
