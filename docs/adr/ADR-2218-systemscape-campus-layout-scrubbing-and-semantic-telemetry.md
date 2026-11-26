---
id: ADR-2218
title: SystemScape adds campus layout, telemetry scrubbing, history warm-start, and Antigravity transcript discovery
date: 2026-11-24
decision_status: accepted
implementation_status: partial
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: 0b8d2b18827ea3198c356528398646b25ab2d379
verified_paths: [lib/systemscape.nix, lib/systemscape-Cargo.lock]
owner: operator
review_trigger: the SystemScape source pin changes, or an additional agent harness transcript root is added
repo: agentbox
evidence_class: source+test
acceptance_boundary: Upstream 7e5e842 is pushed, passes 189 tests, strict clippy and terminal smoke; the host independently checked the source hash and unchanged Cargo.lock. Image build and activation remain separate gates.
---

# ADR-2218 — SystemScape adds campus layout, telemetry scrubbing, history warm-start, and Antigravity transcript discovery

## Context
- Live operator use of SystemScape 0.5.0 in the Agentbox `System` and `Activity` tmux panes exposed scale, legibility, and diagnostic limits hidden by the synthetic `--demo` fixture:
  - The 256-file / 5,000-record collector caps omitted over 1,500 transcripts on an active workspace and truncated history to 1–2 days, while Antigravity CLI (`agy`) transcripts under `~/.gemini/antigravity-cli/brain/` were invisible.
  - Subagents whose working directory diverged from their parent produced cross-city horizontal delegation arcs, >4 projects in one linear row severely foreshortened distant districts, and a binary 5-minute idle dim turned quiet cities uniformly muted.
  - Real hardware telemetry produces flat plateaus (`PWR`, `VRAM`, `GPU°`) that occlude rear ridges, had no way to inspect a past timestamp across channels (such as correlating an activity error mark with a power/GPU drop), started blank after restart despite `--record` writing `telemetry.jsonl`, and truncated the marks bar mid-item.

## Decision
- **Bounded collector scale & harness coverage (`systemscape`):** Raise bounded discovery/retention caps to 65,536 walked entries, 2,048 tracked files, and 25,000 retained records (keeping 1 MiB/file and 8 MiB/poll read budgets intact). Discover read-only Antigravity CLI transcripts at `$HOME/.gemini/antigravity-cli/brain/*/.system_generated/logs/transcript.jsonl` alongside Claude, Codex, and the shared archive. Extract optional `model` and deduplicated per-message `tokens` fields on `Event` (`skip_serializing_if = "Option::is_none"`), surface `SendMessage` recipient/topic in tool summaries, and compact leading `cd <dir> &&` shell boilerplate in callouts and the most-recent strip.
- **Activity city legibility & navigation:** Anchor subagents to their parent's district whenever the parent is drawn, bound arc rise proportionally, dim unselected arcs, and animate travelling light pulses along live delegation arcs. Wrap >4 districts into a two-row campus with gentle aerial perspective on the back row, contact-shadow aprons, neon district rims, ambient light pads under active towers, micro-story floor subdivisions, rooftop beacon spires, and graduated recency dimming plus pulsing error/stuck roof beacons. Draw a dark translucent callout card with a left colour accent bar, 10-cell action-mix micro-bar, and model/tokens/duration; keep `?` coverage on row 3 without hiding the row-2 `b`/`c`/`g` key; and add `/` search, `x` status filter, `t` height mode, `z` UTC/local/24h scope, `n`/`N` signal jump, `C` colour themes, damped spring camera easing, HUD pill badges, and mouse picking/scroll.
- **Telemetry diagnostics & history:** Warm-start local 2h ridges from `telemetry.jsonl` on start-up, add `w` multi-window aggregation (`2h`/`6h`/`24h`/`7d`), `,`/`.` vertical time-slice crosshair scrubbing, `a` auto-range scaling, `j`/`k` ridge spotlighting, sculpted continuous sloped ridge ribbons with glowing crest rims and 3D anomaly peak heat, atmospheric horizon bloom with subtle wet-floor reflections, slim dark valley seams and shifted multi-GPU sub-hues, a right-aligned dashboard label column with 2h peaks, live host vitals in the federated host strip, `v` multi-host comparison view, `C` colour themes, damped spring camera easing, atomic mark-legend truncation, and mouse interaction.
- **Container boundary unchanged:** SystemScape remains strictly local and read-only by default (writing only `telemetry.jsonl` when `--record` is passed), with no new port, listener, mount, secret, or supervised program in Agentbox.

## Consequences
- Operators get legible multi-project cities, direct causal correlation between hardware spikes and agent errors, and persistent telemetry context across pane restarts.
- Upstream `systemscape` carries the implementation and tests; Agentbox activation requires pushing the upstream commit and updating `lib/systemscape.nix` + `lib/systemscape-Cargo.lock` (matching the ADR-2203 pin-bump flow) followed by an image rebuild.
- `scripts/capture-screenshots.py` carries SGR foreground/background state across lines (matching `tmux capture-pane -e`), removing the horizontal white-stripe artifact from README captures.

## Verification
- Upstream `systemscape` working tree verified with:
  - `cargo clippy --all-targets --locked -- -D warnings` — clean.
  - `cargo test --locked` — 189 passed, 0 failed, 1 ignored (including new regression tests for parent-district subagent anchoring, 2-row campus layout, `/` search & `n`/`N` jump, `?` coverage coexistence, Claude model/token deduplication, Antigravity transcript parsing, atomic marks-legend truncation, warm-start, multi-window aggregation, scrub crosshair, auto-range, and multi-host compare).
  - `cargo build --release --locked && python3 scripts/terminal-smoke.py` — PASS.
- Owner requested alignment on 2026-11-26. Upstream main is now committed and pushed at `7e5e842a071ca8d8058f0d652931e3ff3cb6852c`; Agentbox pins that revision, still carrying upstream's package version 0.5.0. Nix independently returned `sha256-9nVspcROJcP7Swa3DpmTo7Df+xUoMXqQ7rtadhNayc0=`. Upstream and vendored Cargo.lock SHA-256 are both `505739011d0eefb0ecc1de94fa115458e1c0c8cea3d7c8aec78b81659e54107b`.
- `implementation_status` remains `partial` and `activation_status` remains `inactive` until image preparation and live acceptance finish. The terminal smoke exercises a private fixture, not a claim about the running operator panes.
