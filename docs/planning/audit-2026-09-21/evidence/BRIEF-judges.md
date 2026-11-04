# Judges' brief: estate audit and planning cycle, 2026-09-21

Written by the Fable queen. Read this, then the five researcher reports in this directory
(RA-ledgers.md, RB-health-debt.md, RC-value-demand.md, RD-runtime.md, RE-trajectory.md).

## The question

The owner: "let's find the next pressure point of maximum value. I am tempted by the
sidechain stuff and more integration and federation but we are getting a bit lost in side
quests across the ADRs now. Feels like a good time for an audit and planning cycle."

Deliverable of this cycle: ONE next-cycle focus (2 to 4 weeks), a short list of what to freeze
or park, and the ledger hygiene needed so the focus is not lost again. Not a new programme.

## The estate in one paragraph

Seven first-party repos on one identity spine (did:nostr as login, WAC principal, provenance
author and payment account): VisionFlow (canon, nightly estate-health), VisionClaw (the host
engine, checked out at /home/devuser/workspace/project, remote DreamLab-AI/VisionClaw), agentbox
(the sovereign agent runtime and the owner's daily tool, this container), solid-pod-rs, the
nostr-rust-forum, dreamlab-ai-website, knowledgeGraph; plus loom (ontology façade, the Copy
Ceiling paper, and today's PRD-028 asking whether Loom earns its complexity), dream-engine,
diagram-ir, prose-sanitiser, WasmVOWL/vowl-wasm, visionGraph. Nightly health 2026-09-21: 7 of
14 green, 5 red (VisionFlow diagrams gate; VisionClaw CI and doc quality; agentbox CI, security
invariants, shellcheck, TUI tests, nix-flake-update; nostr-rust-forum CI and security audit;
loom Rust contracts), 5 open PRs (4 on dream-engine).

## Programmes in flight (last 30 days), all proposed or partial unless stated

- PRD-021 AoE interaction plane (ADR-042..045, 2079, 2080): partial, live.
- PRD-022 semantic integrity and provenance (ADR-046..049): partial.
- PRD-023 Sovereign System One typed decisions (ADR-2094, 2095): proposed, façade unbuilt.
- PRD-024 sovereign settlement / sidestr (ADR-2096..2103, DDD-022, 4 sibling ADRs; written
  today; adversarial review says critical for real value, containable as valueless research;
  upstream sidestr spec 0.0.2 shipped the same day; two upstream PRs open): proposed, nothing built.
- PRD-025/026/027 Loom platform and Rust re-engineering; PRD-028 (today) the evaluation that
  could simplify or retire Loom's serving path: proposed.
- Colloquy / forum learning surface (ADR-2085..2088): published crates, partial.
- Skills estate (ADR-2083, 2089..2093) and agent registry (2092): partial, live.
- XR (host ADR-2107..2110): partial, staged.
- Dream cycle (2071), erasure (2102..2105 host), ontology pull (2106), dev profile (2108).
- Federation layer: not yet designed; a "federation project" repo does not exist; external
  interest exists; the owner intends to look into it next.

## Corrections to the researcher reports (verified by the queen)

- RB says "VisionClaw is not checked out anywhere": wrong. It is /home/devuser/workspace/project.
- RB says the host ledger has 2 stale ADRs: wrong. `node scripts/adr-index-gen.js docs/adr
  --check` in /home/devuser/workspace/project reports 15 STALE records (XR and others); the
  README cannot regenerate until they are re-verified.
- RB's MCP hub finding is CONFIRMED: `agentbox-mcp-hub` shows RUNNING with minutes of uptime
  (restart loop), /run/agentbox/mcp-hub.json does not exist, nothing is bound. RD's finding
  that six of the seven "failed" consultant/research MCP servers are simply not registered
  (consultants gate unset) is ALSO true; the two are compatible: the catalogue is off, and the
  hub that would proxy it is broken anyway. One real config bug: ~/.claude/settings.json pins
  consultant-codex to a stale /nix/store path (violates the estate's own rule).
- RD: [voice].enabled = false in agentbox.toml while four voice containers run healthy; the
  manifest cannot be trusted for voice. Skills: 57 registered, 137 baked, 23 live in
  ~/.claude/skills. BASELINE-container.md says management-api port 4000; it is 9090.
- The owner's frameworks (personal-context): fail hard not soft; re-engineer, do not patch;
  deprecate by removing; iteration over perfection; directional alignment (everything must
  benefit everything else); Wardley mapping; DDD; take on big jobs in one shot.

## What a judge must produce

Each judge scores the same candidate list through ONE lens and returns a ranked verdict with
reasons and evidence. Candidates (add any the reports justify, but argue for it):

C1 Ledger and CI hygiene sprint: re-verify the 15 stale host ADRs, fix the 5 red repos (one
   shared 2026-09-15 cause suspected), fix the MCP hub, the voice flag, the skills reconcile,
   the port doc; freeze new ADRs until green.
C2 Sovereign settlement P0 (sidestr): the research chain beside tbtc4, one signer, the Rust
   crates, upstream PR merge; the owner is "tempted".
C3 Federation layer design and the federation project repo (external interest).
C4 Loom PRD-028 pilot: does Loom earn its complexity (research/publication value; 200
   reviewer-hours for the full study; could retire a large investment).
C5 Sovereign System One (PRD-023) façade: bring routing and compaction judgement local.
C6 Governance debt named by GOVERNANCE-capabilities as its own top risk: nightly dream cycles,
   recursive spawn and code exec are live with no execution journal (ADR-057) or policy
   pipeline (ADR-059).
C7 The unwired settlement gate and the three-ledger split (payment_settlement class gates
   nothing; fixable independently of sidestr).
C8 External-value items from RC (treat each as a separate sub-candidate C8a..C8f and rank
   them): C8a unblock campaignbuilder's second tenant (live on client production, blocked on
   five administrative items, not engineering); C8b pair the docBox clinician demonstrator
   with the NHS ACHD engagement as one NHS pitch; C8c productise Pingle's working Biodiversity
   Net Gain pipeline for the live UK regulatory market; C8d publish personal-context-portfolio
   (no external counterparty needed); C8e the Resona commercial negotiation (six figures,
   awaiting client sign-off: what engineering, if any, moves it); C8f the UKRI IRIS Phase 2 bid
   with THG Ingenuity and Salford (missing a formal letter of support). RC also finds the three
   most overstated public claims: cross-org federation (parked internally, marketed as
   integrated), the Judgment Broker governance UX ("cryptographically complete and semantically
   hollow", the PRD's own words), and the website's Salford/THG "World Record" strip.
C9 Finish-what-is-partial: pick the in-flight programme closest to "complete and live" and
   close it (AoE plane, skills estate, XR).

Score each candidate 1 to 5 on: value if done (through your lens), cost, risk, what it
unblocks, and fit with the owner's frameworks. State the single best focus, the runner-up, and
what should be explicitly parked. Where the researchers disagree, say which you believe and
why. UK English, no em-dashes, cite the report and line.
