# J3: Vision coherence and directional alignment

**Judge:** Opus lead value judge, vision-coherence lens
**Date:** 2026-09-21
**Sources read:** BRIEF-judges.md; RA-ledgers.md; RB-health-debt.md; RC-value-demand.md;
RD-runtime.md; RE-trajectory.md; VisionFlow/README.md; VisionFlow/docs/PRD-judgment-broker.md;
VisionFlow/docs/PRD-augmentation-conditions.md; agentbox/docs/proposals/sovereign-settlement.md
(PRD-024 sections 1-2); VisionFlow/docs/adr/ADR-2012-sidestr-settlement-is-ecosystem-canon.md;
RuVector `personal-context` (research themes, frameworks, preferences, team).
**Verified independently of the reports:** branch state of `feat/augmentation-conditions` in
`project`, `VisionFlow`, `nostr-rust-forum` and `agentbox`.

---

## 0. The lens, stated as a test

The estate's thesis is one sentence: *AI collapses the cost of routing information, so the human
is promoted from router to judgment broker* (`VisionFlow/README.md:21,27`), carried on one
`did:nostr` spine that is simultaneously login, WAC principal, provenance author, DID subject and
payment account (`README.md:134`), with the exit right in the floor rather than granted at the
door (`README.md:53,80`).

I score every candidate against one question, not against value in the abstract:

> **Does doing this make every other part of the estate truer to that sentence, or does it add a
> second thing that is also true?**

That is the owner's own framework, "directional alignment: everything must benefit everything
else", applied at programme level rather than at commit level. A candidate that creates a new,
internally coherent subsystem which nothing else needs scores low here no matter how good it is.
A candidate that converts an existing public claim from false to true scores high even when it
ships no new capability, because every other surface in the estate cites that claim.

The owner's four research themes give the second axis: equity of access to AI, convergence and
disruption, Bitcoin and decentralised infrastructure (seven-plus years), telecollaboration. I read
these as constraints on *what shape the truth must take*, not as a to-do list. Bitcoin,
specifically, is a seven-year study, which means it is the theme least in need of a sprint and
most in need of patience.

---

## 1. The single sharpest finding

**The estate has already built the fix for the one claim that underwrites its entire thesis,
tested it, and switched it off.**

The Judgment Broker is the thesis. It is the name of the promotion from router to judge. Its own
PRD carries a self-written amendment dated 2026-09-14: *"The loop this PRD closes is
cryptographically complete and semantically hollow: the decision surface withholds the proposal
and fabricates the human rationale, and the escalation boundary is the agent's own tier"*
(`VisionFlow/docs/PRD-judgment-broker.md:9-16`). An independent adversarial audit against
arXiv 2609.12482 reached the same verdict from a different direction (RC-value-demand.md:361-364).
The website markets the same feature as a finished governance UX that "accelerates, not blocks"
(RC:355-357).

So the thesis's flagship capability records a human click and invents the human's reasoning. That
is not a partially built feature. It is the opposite of the thesis: the human is still a router,
and the cryptography is what makes it look otherwise.

Now the part the five reports under-weight. PRD-augmentation-conditions
(`VisionFlow/docs/PRD-augmentation-conditions.md`) specifies the remedy in seven FRs across four
repositories, and **milestone M2 is done**:

- **agentbox: merged.** Commit `93456a8f3`, "merge: augmentation conditions (task-property triple,
  receipt publisher, deny journal, manual continuation, dream-ledger reviewer columns; ADR-2087)".
  ADR-2087 is recorded `accepted / complete / inactive` (RA-ledgers.md:87).
- **VisionClaw host: built** on `feat/augmentation-conditions` (`f2b9f803e`), ADR-2110
  `accepted / partial / inactive`. Per TODO-unified it passed 1,408 lib tests and 23 client tests,
  deepsec clean, and was *deliberately not deployed* (RA:152, RA:306-313).
- **nostr-rust-forum: built** on `feat/augmentation-conditions-client`, currently the checked-out
  HEAD, unmerged. Forum ADR-2011 `accepted / partial / inactive` (RA:170, RE-trajectory.md:153).
- **VisionFlow canon:** ADR-2010 and ADR-2011 `accepted / complete / staged`; the
  `feat/augmentation-conditions` branch is stranded because the content shipped via a
  `docs(canon)` commit straight to main (RE:151).

What remains is M3 (republish `nostr-bbs-core` and `nostr-bbs-mesh`, update docs in four repos),
M4 (run the probe suite against the live edge forum), and one named unfinished implementation
item: forum-client rendering of `effective_tier` and probe-tag hiding, "Not started on this
branch" (`PRD-judgment-broker.md:69`).

In the same window, the estate wrote twelve `proposed / none / inactive` settlement records in a
single day across five repositories (RA:274-287).

That is the whole audit in one comparison. **The estate is writing new decisions faster than it is
switching on the ones it has already proved.**

RE names "fail hard not soft" as violated by five agent-contamination rescue stashes
(RE:284-288). I disagree about the location. The stashes are a tooling nuisance. The real
failing-soft is a programme that passes 1,431 tests, closes the thesis's central honesty gap, and
is held at `inactive` with no dated activation plan, while twelve new proposals land beside it.

---

## 2. Ranked table

Scores 1 to 5. **Thesis** = does it make every other part truer (5) or add a parallel truth (1).
**Cost** = 5 is cheapest. **Risk** = 5 is lowest risk. **Unblocks** = what it frees downstream.
**Fit** = the owner's frameworks (fail hard not soft, re-engineer don't patch, deprecate by
removing, iteration over perfection, directional alignment, Wardley, DDD, big jobs in one shot).

| # | Candidate | Thesis | Cost | Risk | Unblocks | Fit | Total |
|---|---|---|---|---|---|---|---|
| 1 | **C9-AC** Land augmentation conditions M3+M4 (four repos) | 5 | 4 | 4 | 4 | 5 | **22** |
| 2 | **C1** Ledger and CI hygiene sprint | 4 | 4 | 5 | 4 | 4 | **21** |
| 2= | **C7** Wire the `payment_settlement` gate, split the three ledgers | 4 | 5 | 5 | 2 | 5 | **21** |
| 4 | **C8d** Publish personal-context-portfolio | 4 | 5 | 5 | 2 | 4 | **20** |
| 5 | **C4** Loom PRD-028 **pilot only** (not the 200-hour study) | 4 | 3 | 4 | 3 | 5 | **19** |
| 6 | **C6** Governance debt: execution journal ADR-057, policy pipeline ADR-059 | 5 | 2 | 3 | 4 | 4 | **18** |
| 7 | **C5** PRD-023: run the first ADR-2095 measurement, nothing more | 3 | 4 | 4 | 2 | 4 | **17** |
| 7= | **C8a** Campaignbuilder second tenant | 2 | 5 | 4 | 3 | 3 | **17** |
| 7= | **C8b** docBox demonstrator paired with the NHS ACHD residential | 4 | 3 | 3 | 3 | 4 | **17** |
| 10 | **C9-AoE** Close the AoE interaction plane (ADR-2079/2080) | 3 | 3 | 3 | 3 | 4 | **16** |
| 11 | **C8f** UKRI IRIS Phase 2: letter of support, commerce-API gap | 2 | 4 | 2 | 3 | 3 | **14** |
| 12 | **C8c** Productise Pingle BNG | 1 | 4 | 4 | 2 | 2 | **13** |
| 12= | **C8e** Resona negotiation | 1 | 5 | 3 | 2 | 2 | **13** |
| 14 | **C2** Sovereign settlement P0 (sidestr) | 3 | 1 | 2 | 2 | 3 | **11** |
| 15 | **C3** Federation layer design and repo | 2 | 1 | 2 | 1 | 2 | **8** |

### Notes on the scores that will surprise

**C9-AC scores 5 on thesis** because it is the only candidate where doing it changes what *every
other surface* is allowed to say. The README's Judgment Broker row, the website's governance copy,
the compatibility matrix, the dream cycle's "agents propose, a human signs" claim
(`README.md:128`), VisionClaw's "watch here, judge there", the forum's "the one place a decision
gets signed" and agentbox's authority classes all cite the same loop. Fix the loop and eleven
claims become true at once. That is directional alignment in its literal sense.

**C1 scores 4 on thesis, not 3.** The canon repo's own opening line is "Six honest systems can
still assemble one collective lie, VisionFlow is the canon that stops that", followed by "it is
graded on their accuracy" (`README.md:21`). A canon repo with a red diagram gate for six days, a
host ledger carrying 15 stale records that blocks README regeneration, and an estate-health
dashboard plateaued at 10/14 for weeks (RE:224) is a canon failing at its own stated job. Hygiene
here is not maintenance, it is the thesis.

**C7 scores 5 on cost and 5 on fit**, and I want it noticed.
`agentbox.toml [skills.authority.classes] payment_settlement` declares a zero-tolerance action
class, and `routes/payments.js` never calls `lib/authority.js`, so the class gates nothing
(PRD-024 section 2, verified by the coordinator grep, 2026-09-21). This is the *same defect class*
as the fabricated rationale: a declared control that controls nothing. It is a day's work, it is
fixable entirely independently of sidestr, and it removes the most dangerous instance of
"documented as live, safety mechanism is not" in the payments surface.

**C2 scores 3 on thesis, not 1.** I disagree with RC here and set it out at length in section 7.
The sidechain is not a side quest in kind: the identity spine claims "payment account" and, in
VisionFlow's own words, names "no instrument behind the payment account"
(`ADR-2012-sidestr-settlement-is-ecosystem-canon.md:26-27`). That is a real hole in the floor of a
real claim, and Bitcoin is a seven-year research theme, not a whim. It ranks 14th on cost, risk
and sequencing, not because the direction is wrong.

**C3 scores 8 and is the clearest park.** Federation was *already frozen by the owner's own
closeout decision*: "declare standalone-first as the supported deployment mode. Mesh federation is
designed, not shipped and parked" (`ecosystem-map.md:124-132`, cited RC:339). Re-opening a
decision the estate formally froze, with no external consumer anywhere across either corpus
(RC:522-534), is the definition of adding a parallel truth. "Deprecate by removing" applies to
programmes, not only to code.

---

## 3. The single best next-cycle focus (2 to 4 weeks)

### Make the declared controls control something. Start with human judgement.

**Primary: C9-AC.** Land PRD-augmentation-conditions M3 and M4 across all four repositories and
flip the three `inactive` activation flags to live.

**Bolt-on, same defect class, one day: C7.** Wire `routes/payments.js` to `lib/authority.js` so
the `payment_settlement` zero-tolerance class actually gates.

### Exit evidence, as the cycle's acceptance test, not as a report

1. `grep -rn "Human {action} via governance UI"` returns **zero hits** across agentbox, VisionClaw,
   nostr-rust-forum and VisionFlow. The fabricated-rationale string is deleted, not deprecated.
2. VisionClaw's hardcoded `confidence: 0.5` is `None`; grep proves it. Absence renders as absence
   (PRD FR2.4).
3. `nostr-bbs-core` and `nostr-bbs-mesh` republished with `TaskProperties` and `effective_tier`
   public; crates.io versions resolvable (PRD M3).
4. **One real, live, high-tier 31403** on the edge relay whose `reasoning` field is the owner's own
   typed text, decided with the proposal rendered above the controls and the agent's risk tier and
   confidence rendered below them. Record the event id. This single event is the cycle's proof: it
   is the first decision in the estate's history where a human was actually brokering judgement
   rather than clicking.
5. The M4 probe suite runs against the live edge forum, with a receipt per probe and the deploy
   status recorded honestly (PRD M4).
6. `GET /api/governance/reviewers` returns a non-synthetic row with a real median
   time-to-decision.
7. agentbox ADR-2087, host ADR-2110 and forum ADR-2011 each move `activation_status: inactive` to
   `live`, each with a `verified_commit` and an execution receipt. `AC-FORUM-1` leaves `blocked` in
   TODO-unified.
8. `node scripts/adr-index-gen.js docs/adr --check` is clean **in the host repo**. This falls out
   for free: six of the 15 stale records amend `src/main.rs` and three amend the XR `.gd` files
   (RA:196-212), all of which this work touches anyway. Do not run a separate ledger sprint; make
   the ledger clean as a by-product of the work that was going to edit those files.
9. `routes/payments.js` calls `lib/authority.js`; a test proves an unauthorised settlement call is
   denied **and journalled**.
10. The README's Judgment Broker row (`README.md:254`) and the website's governance copy are
    rewritten to whatever is then true. If `ConceptElevated` still does not fire on merge, the row
    says so.

**Abort criterion, declared in advance (fail hard not soft):** if M4's live probe cannot run
because the edge forum deploy is blocked, stop, ship M3 plus items 1, 2, 7 and 9, and record M4 as
`not run, blocked on deploy` with a named date. Do **not** ship a green claim on a run that did not
happen. The estate's recurring failure mode is exactly this substitution, and this is the cycle
where it must not happen.

### Why this, and not something with a customer attached

Three reasons, in order of weight.

**One: it is the only candidate that makes the estate's public claims true rather than louder.**
RC's section 2 names three overstated claims. This cycle retires the most important of them (the
Judgment Broker) by construction, not by editing copy. The other two get cheaper: cross-org
federation becomes honest the moment it is parked in public as it is already parked in private,
and the Salford/THG validation strip is a five-minute copy fix once someone decides to make it
match the ledger.

**Two: the work is already paid for.** M2 is done, tested and audited. The remaining spend is
publication, activation and one unfinished client rendering task. This is the highest ratio of
thesis-truth per hour available anywhere in the estate, by a wide margin. Every other candidate
starts from zero or from a proposal.

**Three: it is the owner's frameworks applied to the owner's estate.** "Fail hard not soft" says a
capability that passes 1,431 tests and sits `inactive` is failing soft. "Iteration over
perfection" says the loom paper's v7-to-v9.2 convergence is what closing looks like (RE:211-217)
and nothing else in the estate is doing it. "Take on big jobs in one shot" says four repos in
lockstep is the right shape, which is precisely the shape the settlement pack chose and the
augmentation pack already achieved. "Directional alignment" says finish the one that makes the
others true first.

There is also a research-theme argument. **Equity of access to AI** is not only about who can run
models. It is about whether the human in the loop has the information, the time and the authority
to actually judge. The six augmentation conditions from arXiv 2609.12482 are, read plainly, an
equity-of-access instrument aimed at the *reviewer*: C2 meaningful human control, C5 career
pathways for junior reviewers, C6 is the human's judgement captured or only their click. The owner
has already adopted that paper as the canon's audit lens. Landing it is the estate's clearest
contribution to its own first research theme, and it is publishable: an implemented, measured
grading of a working human-AI governance loop against a named 2026 framework is a genuine research
artefact, adjacent to the Copy Ceiling paper and stronger for being about deployed code.

---

## 4. Runner-up

**C4: the Loom PRD-028 pilot only, 400 to 800 source units, not the 6,000-to-10,000-unit study.**

It scores 19 and earns the runner-up slot on one property no other candidate has: **it is the
estate's only falsifiable question about its own complexity.** PRD-028 asks whether Loom's
ontology-backed serving path beats strong flat-text retrieval at matched information access and
context budget, and states plainly that one legitimate outcome is that "a large fraction of the
Loom investment gets simplified or retired" (RC:495-520).

**Does PRD-028 deserve to run before more Loom investment? Yes, unambiguously, and the question
almost answers itself.** The estate holds PRD-025, PRD-026 and PRD-027 proposing Loom platform
work and Rust re-engineering. Spending on a serving path whose value is untested, while holding a
preregistered specification that would test it, is not a sequencing preference, it is a category
error. The owner's own frameworks say so twice: "re-engineer don't patch" presumes you know which
thing is worth re-engineering, and "deprecate by removing" needs evidence about what to remove.

**But run the pilot, not the study.** The full study costs roughly 200 reviewer-hours, more than
this entire cycle. The pilot is the decision-relevant part: if the pilot shows no separation at 400
to 800 units across four subdomains, the +5 point practical-significance threshold is not going to
appear at 10,000, and the Loom platform PRDs can be cut on the pilot alone. If the pilot shows
separation, the study becomes a funded research artefact rather than a hope.

**Sequencing: run the pilot in parallel with C9-AC, not after it.** The pilot is corpus
preparation and evaluation, almost entirely disjoint from four-repo Rust and Leptos work. They
contend for owner attention, not for the same hands. Freeze PRD-025/026/027 until the pilot
reports.

One caution against my own recommendation: PRD-028 is the most disciplined document in this audit
and also the most seductive. It is a beautifully framed question about internal machinery. If the
pilot slips into the full study inside this cycle, the cycle becomes a research project and the
augmentation landing does not happen. Cap it: the pilot reports, or the pilot is declared not-run,
by the cycle's end date.

---

## 5. What to park, and for how long

Parking means a dated line in the plan saying "not this cycle, revisit on date X or trigger Y",
not silence. Silence is how the estate accumulated 25 proposed-but-unbuilt decisions, 17 of them
inside two programmes (RA:424-436).

| Park | Until | Trigger to revisit |
|---|---|---|
| **C2 sovereign settlement / sidestr, all twelve records** | **8 weeks, two full cycles** | Three conditions, all of them: (a) `payment_settlement` actually gates, per C7; (b) the README's "payment account" claim is either deleted or footnoted as aspirational; (c) solid-pod-rs's hand-rolled BIP-341 on raw k256 is replaced with `rust-bitcoin`, per the house rule that hand-rolled cryptography is the highest-priority port. Until then the eight ADRs stay `proposed` and no sibling repo writes another settlement record. |
| **C3 federation layer and the federation project repo** | **6 months** | An external counterparty asks for it *in writing*, with a name and a date. It was already formally frozen (`ecosystem-map.md:132`); the correct action is to stop re-opening a frozen decision, publish the freeze on the website, and delete the "6 federated substrates" badge and the `integrated` row that contradict it. |
| **PRD-025 / 026 / 027 Loom platform and Rust re-engineering** | **Until the PRD-028 pilot reports** | Pilot result. Hard gate, no partial exceptions. |
| **C5 PRD-023, beyond one measurement run** | **This cycle** | Run the first ADR-2095 measurement against the ADR-2094 façade, because PRD-023's own `review_trigger` names exactly that run and it has not happened (RA:466-474). It costs a few hours. Then stop: write no further typed-decision ADRs until that number exists. |
| **C6 governance debt (ADR-057 journal, ADR-059 policy pipeline)** | **Next cycle, named now** | This is the highest-thesis-score item I am *not* choosing, which deserves an explanation. GOVERNANCE-capabilities names it as its own top open risk: recursive spawn, code execution and nightly unattended dream cycles are live with no execution journal and no policy decision point (RB:72). It is an L-sized build. It also becomes materially cheaper after C9-AC, because the augmentation work already lands `authority.deny` journal records readable at `/v1/agent-events` (PRD FR4.4), a real first vertebra of ADR-057. Doing C6 first would be building the spine before the vertebra. Doing it second is sequencing, not deferral: put it in the plan with a date. |
| **C8c Pingle, C8e Resona** | **No engineering allocation at all** | Both are correctly identified by RC as needing a buyer and a signature, not code. Give them calendar time, not sprint time. |
| **C8a campaignbuilder, C8f UKRI letter** | **Inside this cycle as owner errands** | Neither is engineering. C8a is five administrative unblocks (OAuth client, repo/deploy token, VM size); C8f is asking a named THG counterpart for a letter. Both are hours of owner time with disproportionate external payoff. They belong in the cycle as errands, not as the cycle. |
| **C8d publish personal-context-portfolio** | **Inside this cycle, one day** | Scores 20 and costs a day. MIT-licensed, README-complete, no counterparty needed, and the estate's cleanest expression of the equity-of-access theme: an operating manual any agent can ingest, forkable by anyone. Ship it with the DIY path honest about the unbuilt web app. Do not let it grow into a product programme. |
| **C8b docBox plus NHS ACHD** | **Next cycle, scoped to the November date** | Real, dated, priced, and thesis-aligned: a clinician judging AI output with the proposal in view is literally the augmentation conditions in a clinical setting. It needs the November residential to anchor it, which is after this cycle. Name it now so it is not rediscovered in October. |
| **C9-AoE close-out** | **Next cycle** | ADR-2079 is `proposed / none` and asks whether AoE becomes a fleet model router. That is a new question, not a close-out. The actual close-out is activating ADR-2087 task properties, which C9-AC does. |

---

## 6. One sentence for the top of the next cycle's plan

> **This cycle ships no new capability: we make the controls we have already declared actually
> control something, starting with the human judgement the whole thesis rests on, and we write no
> new decision record until the ones we have proved are switched on.**

---

## 7. Where I disagree with a researcher, and why

### 7.1 With RC: sidestr is not "pure architecture ideology", but it is still wrong to build now

RC classifies sovereign settlement as "Internal-preference. Pure architecture ideology, researched
by the estate's own internal agent mesh, with no named outside stakeholder" (RC:486).

The test RC applies is "is there a named external stakeholder". That test is wrong for floor-level
infrastructure, and RC's own table proves it: by the same test the `did:nostr` identity spine is
also internal preference (RC:489, "no external consumer of this instance found"), and the identity
spine is the most load-bearing thing in the estate. Floors do not have customers. They have claims
resting on them.

The right test is: **does a public claim depend on this, and is that claim currently false?** For
settlement the answer is yes and yes, and VisionFlow has already written it down: the identity
spine claims the same keypair is a "payment account" "while naming no instrument behind the
payment account" (`ADR-2012-sidestr-settlement-is-ecosystem-canon.md:26-27`). The estate diagnosed
its own false claim correctly. Bitcoin and decentralised infrastructure is also a seven-plus-year
research theme, deeply threaded through the owner's technical work, not a passing enthusiasm. So:
**the sidechain is a candidate floor under a real hole, not a side quest in kind.**

I still rank it 14th of 15, for three reasons RC does not make.

**First, a false claim can be made true by deletion**, and deletion is two orders of magnitude
cheaper. Removing "payment account" from `README.md:134` and `:248`, or footnoting it as
aspirational, makes the identity spine claim true today. PRD-024 makes it true in perhaps six
months. "Deprecate by removing" is the owner's own framework and it applies to claims as much as
to code.

**Second, there is a live house-rule violation sitting in the same surface** which must be fixed
regardless of which settlement path wins. PRD-024's own problem table records solid-pod-rs
`bitcoin_tx.rs` as "Hand-rolled BIP-341 on raw k256 (house rule violation)", and RB independently
records solid-pod-rs as green CI with a failing security audit, an unresolved `RUSTSEC-2026-0258`,
and a first-party README admission of critical payment-integrity findings (RB:73, RB:115). The
owner's global rule is explicit: replacing a hand-rolled primitive is the highest-priority port.
Building a sidechain on a hand-rolled taproot implementation would be building the floor on a beam
already known to be cracked. Whatever else happens, `bitcoin_tx.rs` goes to `rust-bitcoin` before
any settlement work. That is a park condition, not an optional extra.

**Third, PRD-024 supersedes four previously ratified positions in one document** (PRD-015 C10,
ADR-032 D5, ADR-124 P3, the 2026-09-02 anchoring note, per its own frontmatter). Re-opening four
settled decisions is precisely the shape the owner described as getting lost in side quests. The
content may well be right. The *rate* is the problem, and RA names that correctly (RA:414-418).

So I agree with RC's conclusion and reject its reasoning. The reasoning matters because "no
external stakeholder" would also park the identity spine, the privacy filter and the audit trail,
which would be a catastrophic misapplication of the same rule.

### 7.2 With RC: campaignbuilder is the best commercial item and the wrong focus

RC ranks "close campaignbuilder's five named client-side blockers and land a second tenant" as the
number one one-cycle payoff (RC:404-414). I agree with the finding completely: the hard
multi-tenant plumbing is built, adversarially reviewed, 1,702 tests passing, and the blockers are
"almost entirely client-side administrative items, not engineering".

That is exactly why it should not be the cycle. A focus made of five administrative unblocks is
not a focus, it is a Tuesday. Put it in the plan as owner errands with a named date and get the
second tenant, but do not let a two-hour task define a four-week cycle: when the errands finish in
week one the cycle has no spine and the estate reverts to writing ADRs.

### 7.3 With RE: the "fail hard not soft" violation is in the wrong place

RE concludes that the five agent-contamination rescue stashes in `project` are "the one finding in
the whole audit that reads as a tooling gap rather than a scope gap, and it is the most
actionable" (RE:284-288).

The stashes are real and worktree isolation should be re-engineered. But calling them *the*
fail-hard violation understates the problem by a level. Failing soft at programme scale looks like
this: a capability passes 1,408 lib tests and 23 client tests, is deepsec clean, closes the
estate's most-cited honesty gap, and is recorded `activation_status: inactive` with no dated plan
to activate (RA:152, RA:306-313), while twelve new proposals land beside it in a day. A stash is a
mess. An `inactive` flag on tested, thesis-critical code is a decision not to decide, and it is
invisible because it looks like discipline.

The same shape appears in the runtime: `supervisorctl status` reports the MCP hub RUNNING while
nothing is bound and the config file was never written (RB:41-50). A system that reports healthy
while doing nothing is the estate's signature failure mode, and it shows up in the runtime, in the
ledger and on the website. One cycle spent on that *pattern* is worth more than one cycle spent on
any single instance of it.

### 7.4 With RA: "unblocks the most" is not "advances the most"

RA's top recommendation is to ratify and implement ADR-2078, provisioning the pods signer from
sovereign identity, because it is the only node with edges into two separately active programmes
(RA:444-453).

The graph argument is correct and I do not dispute the topology. I dispute the objective.
ADR-2078's two consumers are AoE session identity binding, already live and functioning with
`sign_requests = false`, and the settlement pack's federation, which I am parking for eight weeks.
Unblocking a node whose downstream is one working system and one parked programme buys
optionality, not truth. Under a vision-coherence lens, optionality is what the estate already has
too much of.

ADR-2078 becomes the right first move the moment settlement un-parks. Note it as such in the park
row.

I do strongly endorse RA's third recommendation (run the first ADR-2095 measurement before writing
any more typed-decision or settlement ADRs, RA:466-474), folded into the park list as a few hours
inside this cycle. RA's framing of it is the best single sentence in the five reports: "a decision,
then a decision about how to measure the decision, before the first decision is switched on".

### 7.5 With RB and RA on the stale-ADR count: both are right, and the disagreement is instructive

RB reports 2 stale ADRs and corrects the brief (RB:5, RB:98-107). RA reports 15 stale in the host
repo and 2 in agentbox (RA:187-213). The queen has confirmed RA. RB ran the gate in agentbox and
believed VisionClaw was not checked out; it is, at `/home/devuser/workspace/project`.

I record this not to score a point but because it is a live demonstration of the thesis. Two
disciplined auditors, each running the estate's own gate correctly, produced contradictory
estate-level numbers because neither could see the whole. That is the exact failure the canon repo
exists to prevent, and it happened *inside the audit of the canon*. It is the strongest argument in
this document that C1's ledger hygiene is thesis work rather than housekeeping, and it is why I
made "host ledger clean" an exit criterion of the primary focus rather than a separate sprint:
separate hygiene sprints get deprioritised, by-products do not.

### 7.6 With RD and RB on the MCP failures: compatible, and the config bug is the one that matters

RD finds six of the seven failed servers are simply not registered because the consultants gate is
unset (RD:109-135). RB finds the hub crash-looping with nothing bound (RB:41-50). Both are true and
the queen's reconciliation is right.

The item I would raise above both: `~/.claude/settings.json` pins `consultant-codex` to a stale
`/nix/store` path with a wrong path segment (RD:84-93). That is a direct violation of agentbox's
own written rule, in the exact file the rule warns about, and the rule exists because this class of
bug already bit once. A rule the estate wrote, published, and then broke in a persistent
host-mounted config is the same defect class as everything else in this verdict: a declared control
that controls nothing. Fix it in the same pass.

---

## 8. Closing judgement

The owner asked where the next pressure point of maximum value is, and said they were tempted by
sidechains, integration and federation while feeling lost in side quests.

The honest answer is that the pressure point is not ahead of the estate, it is behind it. The
estate's central claim, the one its name and its thesis and its website and five of its seven
repositories rest on, is that the human has been promoted from router to judgment broker. That
claim is currently false, the estate knows it is false, it wrote down exactly why on 2026-09-14, it
built the fix across four repositories, it tested the fix, and it left the fix switched off.

Everything else on the candidate list is a choice about what to build next. This one is a choice
about whether the thing already built is allowed to be true.

Take it, take it in one shot across all four repositories the way the owner's own framework
prescribes, and let the exit be a single signed Nostr event carrying a human's own words about a
proposal they could actually see.

That event is the smallest possible artefact that makes the entire estate truer.

---

### Critical files for implementation

- `VisionFlow/docs/PRD-augmentation-conditions.md` (FR1 to FR7; M3 and M4 are the cycle's scope)
- `nostr-rust-forum/crates/nostr-bbs-forum-client/src/pages/governance.rs` (FR2 decision surface;
  the last "Not started" item)
- `project/client/src/features/control-center/governance/AcspCaseQueue.tsx` (FR2.3 and FR2.4:
  proposal rendering, and the `confidence: 0.5` hardcode)
- `project/agentbox/management-api/routes/payments.js` with
  `project/agentbox/management-api/lib/authority.js` (C7: the `payment_settlement` class that gates
  nothing)
- `VisionFlow/README.md:248-256` and `VisionFlow/website/static/index.html` (the claims that become
  true, or get deleted, as the exit)
