---
id: ESTATE-AUDIT-2026-09-21
title: "Estate audit and planning cycle, 21 September 2026: the next pressure point of maximum value"
status: ADOPTED by the owner 2026-09-21 with the section 9 reframing; the yardstick for all future candidates is "more convincing in the room, more repeatable on someone else's kit, more multiplying for the owner", and nothing else
date: 2026-09-21
method: Fable queen; five Sonnet researchers (ledgers, health and debt, value and demand, runtime, trajectory); three Opus lead value judges (external value, foundations and risk, vision coherence); every claim the plan leans on was re-verified by the queen or a judge against the file or the running system
evidence: ./evidence/ (BRIEF-judges, RA to RE, J1 to J3). Kept in this PRIVATE repo because the pack names clients, deal values and an NHS engagement; the public canon (VisionFlow) gets no copy
owner: jjohare
---

# Estate audit and planning cycle, 21 September 2026

## 0. The answer in one paragraph

The next pressure point of maximum value is not a new capability. It is **making the controls the
estate has already declared actually control something, on a machine that is not this
container, against the one deadline someone else owns**: the NHS ACHD residential on 3 to 5
November, whose priced deliverable is "open-source agentbox deployed on Trust-owned hardware"
plus a letter-processing MVP, a runbook and an architecture transfer. That deadline turns the
audit's runtime findings into delivery risk, the estate's flagship thesis claim (the Judgment
Broker) into something a clinician will actually exercise, and the federation question into
one with a real second node. The sidechain, federation and the Loom study are parked with dates
and reopening conditions, not abandoned. No new decision record is written this cycle except
one that switches on a proved one.

## 1. What the audit found (verified)

**The sprawl is real but concentrated.** Twenty-five proposed-but-unbuilt decisions exist across
five ledgers; seventeen sit in two programmes (sovereign settlement, twelve records in one day
across five repos with zero code; erasure, frozen since 5 September). The typed-decisions
programme is chasing itself (a façade, then a gate to measure the façade, neither activated).
Skills governance is the working contrast: proposal to five live records in two weeks (RA).

**The instruments are lying.** `agentbox-mcp-hub` shows RUNNING under supervisord while it has
never bound its port: it waits ten minutes for `/run/agentbox/mcp-hub.json`, which the boot
never wrote, crashes and restarts, for three days, while `bootstrap.done` declared success. The
manifest says voice is off while four voice containers run. solid-pod-rs is green while its own
`cargo audit` fails. The host ledger has fifteen stale records and cannot render its index. A
zero-tolerance `payment_settlement` class is declared and no production path passes it. The
public site markets frozen federation as integrated, a "World Record" strip nobody can
corroborate, and a Judgment Broker whose own PRD says it "withholds the proposal and fabricates
the human rationale" (RB, RD, J2, J3, verified).

**The money is elsewhere.** Every external pull found is in client work, not the platform: a
six-figure commercial negotiation send-ready since 9 September; a client system live on client
production infrastructure; a delivered charity engagement; a UKRI bid with two named enterprise
partners missing a letter of support; and the NHS residential, contracted, priced and dated. None
of the platform programmes the owner is tempted by has a named outside stakeholder (RC, J1).

**The mechanism behind the sprawl.** Disciplined, evidenced work applied to goals with no
finish line, run by four unattended schedulers (nightly dream cycle, nightly estate health,
estate-review passes, explainer sessions) that propose indefinitely and leave unmerged
branches, with no execution journal (RE, J2). The estate's own frameworks are honoured at the
code level (eight `remove-dead-*` decisions in sixty days) and violated one level up.

**The fix for the thesis already exists and is switched off.** The augmentation-conditions
work that makes the Judgment Broker's human decision real is merged in agentbox (ADR-2087,
`activation_status: inactive`) and built, tested (1,408 plus 23 tests, deepsec clean) and
unmerged in VisionClaw, the forum and the canon (J3, verified on the branches).

## 2. The decision: one focus, three tracks, four weeks

**Cycle: 22 September to 20 October 2026. External stopping rule: the residential, 3 to 5
November.** Everything below serves that deployment; anything that does not is out.

### Track A: signal floor, with ratchets (week 1)

Each item ships with a mechanism that stops it recurring, or it is not done.

1. The MCP hub fails hard: `FATAL` after three supervisor cycles without its handshake file,
   and `bootstrap.done` is written only when every projection it claims exists. Exit: a
   deliberate `rm` of the handshake file drives the hub to FATAL; a fresh session reports zero
   MCP connection failures; `ss -tlnp` shows the listener.
2. Manifest truth as a gate: a `scripts/ci/` check diffs declared sidecars and gates against
   running reality and fails on mismatch (voice is the first case). The three uncatalogued TOML
   gate keys that fail `check-manifest-catalogue` are catalogued (fifteen minutes). The
   BASELINE-container port line (4000, really 9090) and the stale `/nix/store` consultant path
   in the owner's settings are fixed.
3. The five red repositories are five independent small fixes (the "shared 15 September
   cause" was falsified by J2). Exit: estate health at twelve of fourteen or better for three
   consecutive nights, no `unknown` row (visionGraph readable or declared out of scope;
   WasmVOWL declared frozen).
4. Ledger ratchet in all five ledger repos: a new decision record may not merge into a repo
   whose own `adr-index-gen --check` (and `--check-index`) fails. The host's fifteen stale
   records are re-verified as a by-product of Track B, which edits nine of the files they cite.
5. Execution journal over the four schedulers, with the stopping rule: journal or do not run;
   three sterile runs disables the scheduler and files one issue; `dream/*` branches merged or
   deleted at seven days; every unbounded goal gets a closeable acceptance test or stops being a
   goal. ADR-2071 moves to accepted, complete, live.

### Track B: truth floor (weeks 1 to 3)

6. Wire `payment_settlement` to `lib/authority.js` on every production settlement path (half
   a day) with a test proving an unauthorised call is denied and journalled. This is the
   cheapest falsification of the sidechain temptation: if the "almost complete payments loop"
   is not almost complete, better to learn it here than under eight more records.
7. Activate augmentation conditions M3 and M4 across the four repos and flip the three
   `inactive` flags (agentbox ADR-2087, host ADR-2110, forum ADR-2011). Exit: zero grep hits
   for the fabricated rationale string; the hardcoded `confidence: 0.5` is `None`;
   `nostr-bbs-core` and `nostr-bbs-mesh` republished with `TaskProperties` public; the M4 probe
   suite runs against the live edge forum with a receipt per probe; **one real, live,
   high-tier kind-31403 whose `reasoning` is the owner's own typed words on a proposal they
   could see, event id recorded.** Abort criterion: if the edge deploy blocks M4, ship M3 and the
   greps, record M4 as not run with a date, and do not ship a green claim on a run that did not
   happen.
8. Run the one ADR-2095 measurement against the ADR-2094 façade (one day). It converts the
   self-chasing programme into a closed leaf or a falsified hypothesis.
9. Public claims gated on ledger citations the way ADRs already are: remove the "World Record"
   and uncorroborated "research partnership" strip; reconcile the federation pill with the
   owner's own FREEZE; rewrite the Judgment Broker row to whatever is then true.

### Track C: deployable by a stranger (weeks 2 to 4)

10. A fresh-host bring-up on a machine that is not this container, by following the written
    runbook literally, with a timestamped receipt and listeners verified by `ss -tlnp`. No
    reliance on the host Docker socket or a pre-seeded home directory.
11. The letter-processing MVP on synthetic data: extraction, redaction, REDCap-ready export,
    with the redaction step evidenced on a sample nobody chose in advance; the runbook and the
    architecture transfer the engagement names.
12. docBox's clinician surface answering a cited question on the same deployment, so the
    contracted delivery and the next NHS sales artefact are one build.
13. A minimum execution journal scoped to the deployed instance (Track A item 5 reused), because
    a Trust will ask what the agent did and why.
14. The engagement paperwork as a gate: Trust name, address and PO recorded; the contradiction
    in the Trust's approval document (clinical data on Trust hardware versus synthetic-only)
    corrected before it is read in review; invoice issued.

### Rules for the cycle

- No new decision record merges anywhere unless it closes an existing proposed record or
  documents the work above. Countable, and enforced by Track A item 4.
- No wide agent fan-out in the host repo's main worktree: thirteen stashes, five of them
  contamination rescues. Isolated worktrees or serial work.
- Day-five abort test (J2): if the journal has not started and only red gates have been
  closed, the cycle has become a mop; stop and take Track B item 6 as the focus.
- Every exit criterion above is checkable by a third party. Nothing is done because a
  session says so.

## 3. Parked, with dates and reopening conditions

| Programme | Parked for | Reopens when |
|---|---|---|
| Sovereign settlement / sidestr (PRD-024, ADR-2096 to 2103, four sibling records) | 8 weeks | Track B item 6 has landed; ADR-2078 (pods signer) exists; solid-pod-rs `bitcoin_tx.rs` is on rust-bitcoin. The two upstream sidestr PRs may merge meanwhile; that costs nothing. The research chain beside `tbtc4` is the first thing the next cycle considers. |
| Federation layer and the federation project repo | 12 weeks | A second operator exists. The Trust's hardware is the first credible one; design after it runs, not before. Delete the "integrated" badge now (Track B item 9). |
| Loom PRD-028 full study (200 reviewer-hours) | 12 weeks | The pilot (400 to 800 units) may start after this cycle exits; the zero-engineering corpus inventory (its Phase 0) may proceed now. PRD-025 to 027 investment is gated on the pilot's answer. |
| Sovereign System One (PRD-023) | Programme parked | Track B item 8 is the one run its own review trigger asked for. |
| Erasure pair (agentbox ADR-2060, host ADR-2102) | Next cycle | The longest-frozen pair; first candidate after this cycle alongside ADR-2078. |
| Policy pipeline (ADR-059) | Until the journal has four weeks of records | You cannot write policy over side effects never recorded. |
| AoE plane, XR embodiment | Next cycle | Leaves that block nothing; XR is finished and deliberately held inactive. |

## 4. Owner errands this week (zero engineering, highest return per hour)

- Send the Resona proposal (send-ready since 9 September).
- Ask THG Ingenuity for the UKRI letter of support.
- Fix the Trust approval document contradiction and chase the PO.
- Take the campaignbuilder client blockers to the client, noting that the closeout also
  records engineering gaps (the generative flow on the shipped configuration, the chat round
  trip), so a second tenant is a cycle after this one, not a paperwork item.
- Do **not** publish `personal-context-portfolio`: it holds the owner's real filled-in context
  and a personal vector database and is marked private; the researcher's "forkable today"
  claim was wrong.
- Do not sell Pingle's BNG outputs: the pipeline is hard-coded to one parcel and statutory BNG
  reports need a competent-ecologist sign-off; without one that is liability, not revenue.

## 5. Corrections ledger (researcher claims overturned during the audit)

| Claim | Source | Correction | Verified by |
|---|---|---|---|
| "VisionClaw is not checked out anywhere" | RB | It is the host repo at `workspace/project`, remote DreamLab-AI/VisionClaw | queen |
| "Two stale ADRs estate-wide" | RB | Host has 15 stale; agentbox had 2 (re-verified today, now 0) | queen, J2 |
| "Shared 2026-09-15 cause for three red repos" | RB | Falsified: sibling workflows passed in the same batch; agentbox's reds are today's uncatalogued gate keys, loom's are a stale sibling SHA pin | J2 |
| "57 registered, 137 baked, 23 live skills" | RD | The registry has 57 lines and 20 entries, all 20 live; no gap | J2 |
| "campaignbuilder blocked only on administrative items" | RC | Its closeout records engineering gaps too | J1 |
| "personal-context-portfolio is MIT and forkable" | RC | No licence file; private personal data; marked PRIVATE | J1 |
| "Pingle BNG is productisable now" | RC | Single hard-coded parcel; statutory outputs need sign-off | J1 |
| "Levels VR and Barclays Eagle Labs are DreamLab Cumbria targets" | memory | Not found anywhere in the dreamlab-cumbria corpus | RC, open question |

## 6. Where the judges disagreed, and how the queen decided

J1 chose the external deadline, J2 chose the instruments, J3 chose the thesis. They are the
same cycle seen from three sides: the deployment forces the instruments to be true, and the
Judgment Broker is what the deployment demonstrates. The queen's only adjudications: the
public-claims fix is Track B (a mechanism gated on citations), not a copy edit; ADR-2078 is
architecturally right but is the first item of the next cycle, because a real signer wired
into a runtime whose hub is dark adds one more unverifiable claim; the sidechain is the missing
floor under the "payment account" claim (J3) and still parks (J1, J2), because a floor poured
on lying instruments is the sprawl pattern one more time.

## 7. Outstanding questions for the owner

1. Confirm the residential's scope and dates as the cycle's stopping rule, and who at the Trust
   signs off the runbook.
2. Who reviews the public-claim edits before they ship (the CTO?), given the site is the
   commercial face.
3. Do the Levels VR and Barclays Eagle Labs relationships exist outside this file tree?
4. Accept the parking durations above, or name different ones.
5. May the Loom PRD-028 Phase 0 inventory (which corpus, which permissions) proceed in
   parallel as a zero-engineering task?
6. Is the day-five abort test acceptable, and who calls it?

## 8. What was changed during the audit itself

Two ledger records the earlier settlement commit had made stale were re-verified and pushed
(agentbox `b7b1ab81a`). PRD-028 was filed in the Loom repo (`07a0e67`). Nothing else was
changed; this document and its evidence pack are the audit's only artefacts.

## 9. Revision after the owner's reframing (same day)

The owner corrected the value lens: the estate builds capability that proves capability into
the consulting, comms and training he delivers; it is a forever project, a personal tool
factory, an agentic force multiplier and a teaching instrument (teams develop against their own
problems during a residential; the Levels project paid for three days, is deployed at their
premises and is out of his hands). It is not a product he wants to support. The aim is maximum
software capability, tightening the VisionFlow ecosystem as a development foil and as a
demonstrator and confidence foil ("Tony Stark in front of the Jarvis projection").

What that changes:

- **"Internal preference" is not a discount.** The demonstrator path (voice plane, AoE operator
  console, VisionClaw immersive graph, RuVector memory, agents acting live in a room) and
  residential-ready deployment on a client's hardware in a day are first-class capabilities.
  Track C is reframed from "an NHS deliverable" to "the repeatable residential capability",
  which the November engagement merely exercises.
- **Track A matters more, not less.** A demo that fails in front of a room is the failure mode
  that matters most; the instruments must be true before capability is added. Voice is the
  Jarvis interface, so its manifest lie is a demo risk, not a hygiene item.
- **Track B stands.** Activating the Judgment Broker is both the thesis and a teaching
  instrument: teams learn to be judgment brokers on a live governance surface.
- **The sidechain moves from "parked" to "the next headline demo, after the instruments are
  true".** Agents holding value, opening a session chain and paying each other live, rendered in
  VisionClaw, is exactly a Jarvis moment and sits on the owner's seven-year Bitcoin theme. Its
  scope stays the research chain beside `tbtc4` with valueless coins and one signer; the
  reopening conditions stay (settlement gate wired, ADR-2078, rust-bitcoin port), because a
  demo built on lying instruments is the sprawl pattern one more time.
- **Federation becomes "instances I leave behind can talk to mine"**: the residential
  deployments are federation nodes in embryo, and they are unmaintained by design, so the
  design must be zero-maintenance for the left-behind node. Still after a second node exists.
- **Loom PRD-028** is teaching content as much as research; the pilot is a good residential
  exercise. The full study remains a deliberate research investment, the owner's call.
- **Commercial errands drop out of the plan's core** (they are the owner's calendar) and the
  public-claims work is kept for the confidence foil: a claim a room can check and find false
  destroys the foil.
- **Stopping rules are demo-ready gates, not "done".** A forever project still needs cycles
  that exit, or the schedulers propose forever; the execution journal is also the self-learning
  record the teaching depends on.
- Open question 3 is answered: Levels VR is a completed engagement, absent from the file tree
  because the deployment left with the client.

## 10. Day-five abort call (recorded 30 September, day 9)

**Called by the owner: honoured.** The condition was met on day five (26 September) and not
recorded until the 30 September reconciliation of the estate master TODO
(`project/docs/TODO-unified.md`, section "Reconciliation 2026-09-30"). This answers open
question 6: the owner calls it.

Evidence at the call:

- Execution journal (Track A item 5) not started: ADR-2071 still proposed / none / inactive; no
  journal code in any scheduler; four `dream/*` branches past the seven-day rule.
- Only gate work shipped: Track A item 1 partly (MCP hub hardening) and item 4 partly
  (`adr-index-gen --check` passes in the four ledger repos that carry it; not yet wired as a
  merge ratchet in forum or solid-pod-rs CI).
- Track B item 6 not started: `payment_settlement` is not referenced from
  `management-api/lib/authority.js`.
- Effort drifted into the parked sidechain (producer, mirror, faucet, Liquid reserve ADR-2117),
  and 25 decision records landed after 22 September against the cycle rule.

A further finding at the call: `middleware/spend-policy.js` (per-call cap, daily budget,
approval threshold) is registered on no route, and the `requiresApproval` flag it sets is read by
nothing, so the `agentbox.toml` comment "above this, spend parks pending ACSP approval" describes
behaviour that does not exist.

**Track B item 6 is parked by the owner, not taken as the focus.** Nothing of real value moves
through the estate yet (no fiat, no mainnet), so payments stay automatic for now. Reopening
condition: before any real-value spend (mainnet, fiat, or a sidestr chain with a non-zero declared
value; the ADR-2103 P21 gate), with PLAN-security S-1 as the exit test and spend-policy wired at
the same time. The sidechain stays parked behind the same condition.

The abort still stands: the cycle stops mopping red gates and takes a single focus. **Owner's
choice: Track A item 5, the execution journal (ADR-2071 Phase 1).** Correction at the call: the
nightly dream cycle is not sterile. Its ledger rows for 27 to 30 September were written to the
VisionFlow working tree and never committed (27 and 29 INCONCLUSIVE, 28 BLOCKED-ENV, 30 ACCEPT with
VisionFlow PR #4 open), which is why git showed nothing after 10 September. It therefore keeps
running while the journal is built. The four `dream/*` branches past seven days had all landed
(merged, squashed or integrated by hand) and were deleted on 30 September. Phase 1 scope: `POST
/v1/exec/record` plus the dream engine's `journal.rs`, fail-open; the engine commits its own ledger
row; and a branch sweep (a `dream/*` branch whose PR is merged or closed, or older than seven days,
is deleted and noted in the ledger). Done when ADR-2071's three-part acceptance test passes: audit
chain intact after a run, a started/completed pair per side effect under the night's
`session_urn`, and the cycle completing with the management API stopped.

**Correction to Track B item 9 (owner, 30 September).** The THG world record is real, not
uncorroborated: THG Studios' "Runway to the Future" (26 February 2026) is WRCA-certified as the
World's First AI-Driven, Immersive, Shoppable Catwalk (THG Ingenuity press release), and DreamLab's
contribution, IRIS on VisionFlow generating the campaign assets agentically from a 185-node fashion
ontology, is documented in the public `DreamLab-AI/THG-world-record-attempt` repository and its
formal report. Item 9 becomes "cite and reword", not "remove": the claim names the certified title
and DreamLab's role, with both links. The site's "250+ concurrent XR users" figure and the Salford
"research partnership" line still need their own sources.
