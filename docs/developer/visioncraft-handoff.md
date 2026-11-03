# VisionCraft extraction: inventory and implementation status

Updated 3 November 2026. The operator resumed the extraction after the original
handoff and authorised publication, a hard cutover and Jev integration. The
handoff-only stop instruction and proposed compatibility alias are superseded.

The standalone [VisionCraft repository](https://github.com/DreamLab-AI/visioncraft)
now contains a Rust library and CLI, bounded execution and evidence gates, the
Deepsec adapter, the canonical 34-file skill, worked examples, ADRs and a
Sealmap-generated diagram corpus. It consumes `sealmap-corpus` 0.4.0. The
[Sealmap release receipt](sealmap-0.4-release.md) records that completed release.

VisionCraft 0.1.0 is published to crates.io, and source commit
`9cf450c5fb82033139527ace29d5731a77d96fc7` is published on the upstream main branch.
The upstream CI run `41633405043` passed. Agentbox source pins that immutable
release and its complete payload. Image activation remains pending the operator's
rebuild; neither publication nor source checks establish live activation.

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

Independent model reviews produced useful findings; confirmed host faults were
reproduced and repaired. Their encompassing strict review receipts remain ERROR
because of process or disclosed context-coverage limits. They are not relabelled
as successful production audits. See the [host review dispositions](visioncraft-host-review.md)
for the retained findings and baseline hub limitations.

A separate real-provider smoke reviewed one isolated fixture and returned PASS
(run `20261103120613-531b8465941bbf17`, 695 output tokens, 71,215 ms). Its receipt
SHA-256 is `dfbc3a43ad70ed18bc2f36d68e779f06a78366597401f776b08772ebf3852474`.
That establishes the completed adapter path on that fixture, not a clean audit
of the production code.

The host source gate records 235 Rust tests, Clippy, 18 protocol fixtures against
the actual crates.io-installed binary,
eight cutover/AQE/Jev cases, 71 existing router tests and the skill/configuration
checks. The installed binary remained SHA-256
`ae5d7568af0a56e46cb134d93391d2ede856544bbead6a0d68a43d5f510dce17`
before and after the 84.6-second protocol run. The source snapshot and released lockfile pass the native integrity
checker; the official Nix NAR hash matches and changed Nix files parse. No full
Nix image evaluation or build was performed inside the container. See
[consumer and rebuild checks](visioncraft-consumption.md).

Existing whole-estate failures remain separate: main already fails the old
terminal-tab contract and three user_cron setup drift checks; historical ADR
verification stamps remain stale. Main's baked routing parity passes, while the
new VisionCraft source cannot match the old running image until rebuild. That
parity check remains an activation requirement.

Do not reopen the unrelated VisionClaw/Codescape audit or modify the operator's
planning files as part of this extraction.
