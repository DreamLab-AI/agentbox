# J1: the external-value verdict

Judge: Opus lead, lens EXTERNAL VALUE. Read-only pass over BRIEF-judges.md and all five
researcher reports, with every claim I lean on re-opened at source. UK English.

**The lens, stated so it can be argued with.** A thing has value here only if a named party
outside DreamLab gets something they want, pay for, fund, partner on, or publish, within two
cycles. Internal elegance scores zero unless it sits on the critical path to one of those. A
cryptographic invariant nobody outside has asked for is worth less, on this lens, than a
runbook a stranger can follow. That is a deliberate distortion; the other judges correct it.

---

## 1. What I verified, and what moved

I re-opened source for every load-bearing claim rather than trusting the syntheses. Four
things moved materially:

1. **The ACHD engagement is not a side item; it is a contract to deploy agentbox on someone
   else's hardware in six weeks.** RuVector `achd-nhs-residential-engagement-2026-11`
   (retrieved live) specifies the deliverable as "open-source Agentbox deployed on Trust-owned
   DGX Spark, letter-processing MVP (ICD-10 extraction, redaction, REDCap-ready export) on
   SYNTHETIC data only, runbook, architecture transfer", 3 to 5 November 2026, GBP 7,500 fixed,
   pro forma invoice 048 already cut. RC files this under "smaller but real" (RC §1.2). It is
   the single most important external fact in the whole audit, because it is the only line
   where the internal runtime work and an external paying counterparty are the *same object*.
2. **Campaignbuilder is not "blocked only on administrative items".** RC's §3.1 and its summary
   both say so. `campaignbuilder/CLOSEOUT.md` §2 and §3 say otherwise: findings X, Y and Z
   together mean "the generative flow cannot complete on the configuration the client ships"
   (strict schemas the shipped model rejects; section schemas borrowed by array index; a
   campaign that cannot be saved before its page exists), and X7 records that the embeddable
   chat bubble, "the product's primary user surface, therefore never completed a round trip
   during the run". Two of the five blockers (B3, B4) are client-codebase engineering, not
   paperwork. This changes campaignbuilder from "free win" to "good win with a fortnight in it".
3. **personal-context-portfolio is not a publishable MIT template today.** On disk at
   `~/workspace/personal-context-portfolio` there is no LICENSE file (the README asserts MIT at
   line 64), the `logseq/` directory holds the owner's filled-in real context (identity,
   team-and-relationships, decision-log, publications), there is a 4.1MB `ruvector.db` of
   personal embeddings, and `~/workspace/CLAUDE.md` marks the repo PRIVATE, "never push or
   expose". RC §1.4 calls it "already built to the point of being forkable today". It is two
   repos wearing one coat, and separating them is a privacy review, not a push.
4. **The settlement gate really does gate nothing, and it is an hours-scale fix.**
   `agentbox.toml:980` declares `payment_settlement = "zero-tolerance"`;
   `management-api/routes/payments.js` contains no reference to `authority` at all, while
   `management-api/lib/authority.js` exists. C7 is real and cheap.

Two checks that confirmed the researchers. PRD-024's own frontmatter and §9 confirm RC's read
of the sidechain (below). And RC's "zero hits for Salford or THG outside the website" survives:
the two non-website hits I found are substring noise ("Au**thG**ated") plus build logs, so the
substance holds even though the grep was sloppier than stated.

---

## 2. Ranked table

Scores are 1 to 5, and **5 is always good for the candidate**: value 5 = large external payoff,
cost 5 = very cheap, risk 5 = very low risk, unblocks 5 = opens many other doors, fit 5 = strong
fit with fail-hard, re-engineer-don't-patch, deprecate-by-removing, iteration-over-perfection,
directional alignment, one-shot-big-jobs. Composite weights value and unblocks double.

| # | Candidate | Value | Cost | Risk | Unblocks | Fit | Comp | Verdict |
|---|---|---|---|---|---|---|---|---|
| **C1'** | **Deployable agentbox, forced by the ACHD November delivery** (the useful half of C1 + C8b + the minimum of C6) | 5 | 3 | 3 | 5 | 5 | **31** | **THE FOCUS** |
| C8e | Resona signature chase (GBP 199,500 to 295,500, send-ready since 09-09) | 5 | 5 | 4 | 3 | 4 | 29 | Not a focus: a calendar item, week 1 |
| C8a | Campaignbuilder second tenant | 5 | 3 | 3 | 4 | 4 | 28 | **RUNNER-UP** |
| C8f | UKRI IRIS letter of support from THG | 4 | 5 | 3 | 3 | 4 | 26 | Calendar item, week 1, owner's time only |
| C8b | docBox demonstrator paired with ACHD | 5 | 3 | 3 | 5 | 5 | 31 | Folded into C1'; not separable |
| C9 | Finish-what-is-partial | 3 | 3 | 3 | 3 | 5 | 23 | Endorsed in *form*; C1' is its best instance |
| C7 | Wire the settlement gate, split the three ledgers | 2 | 5 | 5 | 2 | 5 | 21 | Do it inside C1' as a half-day honesty fix |
| C4 | Loom PRD-028 **pilot only** (400 to 800 units) | 3 | 3 | 4 | 3 | 4 | 20 | Yes, if the pilot corpus is the clinical one |
| C6 | Governance debt: execution journal (ADR-057) | 3 | 2 | 3 | 3 | 4 | 19 | Minimum viable journal inside C1'; full pipeline parked |
| C1 | Ledger and CI hygiene sprint **as briefed** (all 5 repos, 15 host ADRs) | 2 | 2 | 3 | 3 | 2 | 16 | Rejected at this scope. See §6 |
| C8c | Productise Pingle BNG | 2 | 3 | 2 | 2 | 3 | 14 | Park. Liability, not revenue. See §7 |
| C8d | Publish personal-context-portfolio | 2 | 4 | 2 | 1 | 3 | 13 | Park one cycle. Buys stars, not money |
| C5 | Sovereign System One façade (PRD-023) | 1 | 3 | 3 | 2 | 3 | 12 | Park, except RA's free measurement |
| C3 | Federation layer and repo | 1 | 2 | 2 | 2 | 2 | 10 | Park until a second node exists |
| C2 | Sovereign settlement P0 (sidestr) | 1 | 1 | 1 | 1 | 2 | 7 | **Park two cycles.** See §7 |

Note the shape of that table: the four highest-value rows split cleanly into one engineering
programme and three items that cost the owner an afternoon of correspondence each. That split
is itself the finding. The estate has been spending engineering weeks on candidates that score
1 for value while three five-scorers wait on emails.

---

## 3. The focus: make agentbox deployable by a stranger, against the November contract

**Statement.** For the next two to four weeks the estate builds exactly one thing: an agentbox
that a person who is not the owner can stand up on hardware that is not this container, plus
the letter-processing MVP the Trust is paying for, with docBox's clinician surface riding the
same deployment. Everything in C1, C6 and C8b that serves that is in scope. Everything in them
that does not is out.

**Why this and not the others, on this lens.**

- It is the only candidate where the internal runtime work *is* the external deliverable. RC
  correctly classifies the skills estate, AoE integration, the dream cycle and the Loom as
  internal preference (RC §4). The ACHD contract is the one line where the same code becomes a
  priced artefact with a named contact and a date. Two cycles is exactly the horizon: the
  residential is 3 to 5 November, six weeks out.
- It manufactures the second node that every parked programme is waiting for. Federation
  cannot be designed honestly with one operator; the Trust's DGX Spark is the estate's first
  credible second operator. Directional alignment, in the owner's own terms: doing this
  benefits the federation question, the docBox pitch, the Loom evaluation and the NHS channel
  simultaneously, which is more than any other candidate can say.
- The runtime findings in RD are not hygiene here, they are delivery risk. A supervised program
  that reports RUNNING while never binding its port (RB §2.1, RD §3: `agentbox-mcp-hub`
  crash-looping, `/run/agentbox/mcp-hub.json` absent, nothing on 9720) is precisely the failure
  that will happen on a Trust's machine, in a room, in front of the customer, and it will look
  like the product does not work. A manifest that says `[voice].enabled = false` while four
  voice containers run healthy on `:8444` (RD §2.1) is an attack-surface statement that is
  false, which is a procurement problem the moment an NHS information-governance person reads
  it. 57 skills registered and 23 live (RD §2.6) means the demonstrated system is not the
  documented system.
- It is a big job taken in one shot, which is the owner's stated preference, and it has a hard
  external deadline, which is the only thing this estate has been missing. RE §5 diagnoses the
  real disease precisely: "open-ended verification work does not have a stopping rule, and the
  estate has built infrastructure that runs it anyway." A contract with a date is a stopping
  rule you cannot argue with.

**Scope, explicitly bounded.**

1. Fresh-host install proven off this container. No reliance on the host Docker socket, on a
   pre-seeded `~/.claude` mount, or on anything already warm in this box.
2. Fail hard, not soft, on the boot path. The hub's bounded wait with no retry ceiling is the
   named example: make it FATAL after three cycles rather than immortally RUNNING. RB §3.2 is
   right that the invariant in `BASELINE-container.md` reads as resilience and behaves as a
   black hole. This is the one place I would re-engineer rather than patch.
3. Manifest truth as an enforced gate, not a doc edit. `agentbox.toml` must be checkable against
   live reality, and the check must fail when a gate says off and the thing is running. Fix
   voice, the skills reconcile, the `BASELINE-container.md:54` port 4000 that is really 9090,
   and delete the stale `/nix/store` `consultant-codex` entry in `~/.claude/settings.json` that
   breaks the estate's own written rule.
4. The letter-processing MVP: ICD-10 extraction, redaction, REDCap-ready export, on synthetic
   data, plus the runbook and the architecture transfer the engagement names.
5. docBox's clinician surface on the same host runtime, so the contracted delivery and the next
   NHS sales artefact are one build, not two tracks (RC §3.2 gets this pairing right).
6. A minimum execution journal: append-only, replayable, scoped to the deployed instance. Not
   ADR-059's policy pipeline. An NHS audience will ask what the agent did and why; "there is no
   canonical replayable record" (GOVERNANCE-capabilities #1, quoted in RB §3.5) is not an answer
   you give a Trust.
7. The half-day honesty fixes that touch money: wire `payment_settlement` to `lib/authority.js`
   (C7), because a declared zero-tolerance class that gates nothing is the exact failure mode
   this estate keeps writing ADRs about.

**Exit evidence. The cycle is done when, and only when:**

- A recorded fresh-host bring-up on a machine that is not this container, performed by
  following the written runbook literally, with a timestamped receipt, and with listeners
  verified by `ss -tlnp` rather than by `supervisorctl status`. Port bound or it did not happen.
- A manifest-truth check that fails loudly on a gate/reality mismatch, demonstrated failing on
  a deliberately introduced mismatch and then passing.
- Synthetic letters in, ICD-10 codes and a REDCap-ready export out, on the Trust-shaped host,
  with the redaction step evidenced on a sample nobody involved chose in advance.
- The docBox clinician surface answering a cited question on that same deployment.
- The Trust's name, address and PO recorded, and invoice 049 issued. This one is the owner's
  correspondence, not engineering, and it is a gate on the whole thing: the open items in the
  memory record still list "Trust name/address, PO" and a contradiction in the Trust's own
  approval document ("clinical data transported on Trust hardware" against synthetic-only).
  Fix that document now; it is the kind of sentence that kills an NHS engagement in review.

---

## 4. Runner-up: campaignbuilder's second tenant (C8a)

The strongest productise-now candidate in the estate, and the only one with live production
tenants, a real external contact, and hard multi-tenant plumbing already adversarially reviewed.
It is the runner-up rather than the focus for three reasons, all evidenced.

- The decisive blockers are not ours to clear. B1 (Google OAuth client), B2 (team repo and
  deploy token) and B6 (VM sizing, "e2-standard-4 is the honest minimum") are all owned by
  Richard or by the client's cost decision, per CLOSEOUT §1. An engineering cycle spent waiting
  on someone else's admin is the worst possible use of a fixed window.
- Our own remaining work is larger than RC implies: X7's bubble origin defect, the in-memory
  request ledger that loses in-flight work on restart (D/L), and the nested-workspace relocation
  (R). Call it a fortnight, not an afternoon.
- One item I would treat as urgent regardless of sequencing: X8, "captions were written from the
  run narrative rather than from the pixels", with three captions in the 15 September batch
  describing screens the images do not contain, the worst claiming "a complete generated page"
  over a screenshot of an empty form. That is a client-facing document asserting something false
  about a product. On this lens it is more dangerous than any red CI gate in the estate, because
  it is the artefact the customer actually reads. Fix the three captions and add the mechanical
  build check this week, inside an hour, whatever else happens.

**The week-one calendar items, which are not a focus and must not be allowed to become one.**
Resona (C8e) is the largest number in the estate, GBP 199,500 rising to a mechanical range of
GBP 226,500 to 295,500, and the package has been send-ready since 9 September with zero
engineering between it and a signature. The UKRI letter of support (C8f) is one email to a named
THG stakeholder who has already issued a live creative brief to the pipeline. Neither needs a
developer. Both should be done before the first commit of the cycle lands, and neither should be
allowed to consume more than an afternoon.

---

## 5. Park list, with durations and revisit triggers

| Parked | For how long | Revisit trigger |
|---|---|---|
| C2 sidestr / sovereign settlement | **Two cycles, to end November** | A named external counterparty, or a funded research line that pays for it. Keep the two upstream PRs open; they are cheap goodwill |
| C3 federation layer and repo | Until a second operator exists in fact | The ACHD Trust node standing up. Design it then, with one real peer, not zero |
| C4 Loom **full** study (200 reviewer-hours) | Two cycles | The pilot's result. Run only the pilot now, and only if its corpus is the clinical one |
| C5 PRD-023 façade | One cycle | Run RA's free item first: the single ADR-2095 measurement against the existing partial façade. If it is genuinely a half-day, do it; if it grows, stop |
| C8c Pingle BNG | Indefinite | A named ecology consultancy partner willing to sign the assessments |
| C8d publish the portfolio | One cycle | After the template/private split and a privacy review, not before |
| XR | One cycle | An external asker. There is none in either corpus |
| New ADRs | Frozen until the November delivery | Records the delivery itself forces are exempt. Nothing else |

On the ADR freeze I am with the queen's framing of C1 and against the estate's current rate.
RA §5 is decisive: twelve ledger entries in a day with "a combined code footprint of zero",
against a typed-decision programme still not activated and an erasure programme untouched for
sixteen days. RA §6 puts 17 of 25 proposed-but-unbuilt decisions inside just two programmes.
Writing more records is not the constraint.

---

## 6. The one ledger-hygiene action I insist on

**Bring the public website into line with the closeout ledger, and gate it so it cannot drift
again.**

Not the fifteen stale host ADRs. On this lens those are invisible: no outsider reads
`docs/adr/README.md`. The website is the only ledger an outsider reads, and it currently
contradicts the estate's own frozen decisions on the same page.

Three specific claims, all verified in source this session:

- `website/static/index.html:761-764` asserts "University of Salford: Research partnership" and
  "THG World Record: 250+ concurrent XR users". Neither claim is corroborated anywhere in the
  estate's own honesty ledger. The partners are real, via the UKRI bid; the claims about them
  are not checkable. A "world record" is a specific, falsifiable, reputation-bearing assertion.
- The same file at line 1021 already tells the truth in its own status table ("Built, not yet
  federation-verified... standalone-first stays the supported mode"), while the hero copy and
  badge market federation as `integrated`, against the estate's own FREEZE decision at
  `docs/ecosystem-map.md:132`. The page argues with itself, and the marketing half wins above
  the fold.
- The Judgment Broker governance UX, which underwrites the whole thesis, is marketed as working
  while its own PRD carries a 2026-09-14 self-correction calling it "cryptographically complete
  and semantically hollow" (RC §2.2).

**The action, in the owner's own idiom.** Do not patch the sentences. Apply the mechanism the
estate already built for ADRs: every public claim carries a ledger citation or it is deleted,
enforced by a `--check` gate in the same shape as `adr-index-gen.js --check`, red build on an
uncited claim. Deprecate by removing: delete the World Record strip and the unqualified research
partnership rather than softening them. This is a day of work and it is the cheapest possible
insurance on three live relationships (an NHS Trust, a UKRI panel, THG Ingenuity) that are all
about to look at this estate properly for the first time.

Second-order, same rule, different surface: the campaignbuilder caption defect (X8) is the same
disease in a client deliverable. One rule, two enforcement points.

---

## 7. Blunt, as asked: sidechain, federation, Loom

**The sidechain programme has no external value on any horizon I can see, and its own documents
say so.** PRD-024 §10 records that the research stage is 1-of-1 signer on the agentbox host;
the only externality in the entire document is a parenthetical, "the federation project (not yet
populated on GitHub; external interest)", with no party named. §9 D5 defers the legal operating
model, including "customer classes", to counsel "before any triggering activity", which is an
explicit statement that no customer exists. §9's own adopted rating is "critical for real-value
activation; high but containable for a genuinely valueless research deployment". The plan is to
build a custody system, on a six-day-old single-author pre-0.0.1 specification, whose only safe
configuration is the one where it is worth nothing, while the estate holds a GBP 199,500 proposal
unsigned and a GBP 7,500 contract undelivered. It also reopens four previously ratified positions
in a single document (PRD-015 C10, ADR-032 D5, ADR-124 P3, the 2026-09-02 anchoring note), which
is the opposite of converging. The temptation is real and the engineering is interesting; the
market is empty. Park it two cycles and let the upstream spec mature on someone else's time.

**Federation is a road to a town that has not announced itself.** The estate's own closeout froze
it ("declare standalone-first as the supported deployment mode", `ecosystem-map.md:132`); RC's
exhaustive sweep found no external actor requesting it anywhere in either corpus; agentbox's own
docs record the mesh keys as having "no code consumer". Designing the layer now would be the
fourth consecutive programme designed ahead of a consumer. The honest move is the one the focus
delivers as a by-product: put a real second node on a Trust's hardware in November, then design
federation against a peer that exists. That inverts the order the estate has been using, which is
the whole point.

**The Loom is the one internal programme that has already earned external standing, and PRD-028
is the right instinct applied at the wrong size.** RE §4 names loom the best
finished-per-effort repo in the estate: 162 commits converging on a tagged `paper-v9.2`, two
external reviews, each rewrite *shrinking* the claim. That is "iteration over perfection" working
as designed, and a paper is genuine external value: a published result with reviewers attached.
PRD-028's falsifiable framing is the most intellectually honest document produced in the window.
But 200 reviewer-hours for the full study, in the same four weeks as a paid November delivery, is
not a trade this estate can make. Run the pilot only, 400 to 800 units, and choose the corpus to
be the clinical one, so a single piece of work answers the publication question and the docBox
retrieval question at once. If the pilot says the structured serving path does not beat flat-text
retrieval, that is a large, cheap win: it retires a substantial investment on evidence, which is
exactly "deprecate by removing" applied to something the owner likes.

---

## 8. Where I disagree with the researchers

1. **RC, on campaignbuilder** (§3.1 and summary): "blocked only on five administrative items, not
   engineering" is wrong, per `CLOSEOUT.md` §2 findings X, Y, Z ("the generative flow cannot
   complete on the configuration the client ships") and X7 (the primary user surface never
   completed a round trip). I believe the CLOSEOUT, which is first-party and dated. The
   conclusion survives, the effort estimate does not.
2. **RC, on personal-context-portfolio** (§1.4, §3.4): not forkable today. No LICENSE file on
   disk, the owner's real filled-in context and a 4.1MB personal embedding database in the tree,
   and an explicit PRIVATE marking in `~/workspace/CLAUDE.md`. Publishing it as described would
   be a personal-data exposure, not a product launch. And on value: GitHub stars are not external
   value on this lens. No money, no partner, no publication.
3. **RC, on Pingle** (§3.3): the weakest of its five. The pipeline is hard-coded to one Derbyshire
   parcel (`src/config.py` centroid), and statutory biodiversity assessment in England is signed
   by a competent ecologist against the current statutory metric, not by a Monte Carlo script
   against BM4.0. Selling that as a regulatory deliverable buys professional liability, not
   revenue. White-label the compute to an ecology consultancy or leave it alone.
4. **RB, on stale ADRs** (§5, and its opening correction): RB says 2 estate-wide; RA §2 says 2 in
   agentbox and 15 in the host, and the queen verified the 15. I believe RA. RB read one repo and
   generalised, and separately claimed VisionClaw is not checked out when it is the working
   directory's parent. Both errors point the same way, at a report that trusted its own first
   command.
5. **RB and RD, on the seven dead MCP servers**: both are right and the queen's reconciliation is
   correct. I add only the ranking: RD's read (six are simply not registered, the gate is unset,
   the keys are already paid for) is the one that matters for the owner's daily use, and RB's
   (the hub is broken anyway) is the one that matters for November, because it is the archetype
   of the failure that will occur on the Trust's machine.
6. **RE, on the single "fail hard not soft" violation** (§5): RE names the five agent-contamination
   rescue stashes. I would name the MCP hub first. The stashes cost the owner an untangling; the
   hub costs a customer their impression of the product, silently, with `supervisorctl` smiling.
7. **RA's top unblocker, ADR-2078 (the pods signer)** (§7): correct on the dependency graph and
   wrong on priority, through this lens. It has two outgoing edges into in-flight programmes, and
   both of those programmes (AoE session identity, settlement federation) are ones I am parking or
   deprioritising. Unblocking two parked things is not unblocking. If it falls out of the November
   deployment work, take it; do not schedule it for its own sake.

---

## 9. What I would say to the owner in one paragraph

The estate has spent the last thirty days writing decisions and the last two months building
things nobody outside has asked for, while three external items sat waiting on an afternoon of
correspondence each and one signed engagement quietly approached its date. The sidechain is the
most interesting work available and the least valuable; it is a custody system with no customer,
by its own document's admission, built on a specification six days old. The way out of the
side-quest loop is not another audit or another ledger; it is a deadline owned by someone else.
There is exactly one of those in the estate: 3 to 5 November, a named contact, a Trust's own
hardware, GBP 7,500, and the deliverable is agentbox itself. Build for that, send the Resona
package, ask THG for the letter, delete the World Record claim, and let the parked programmes
come back in December with a second node to be federated and a pilot result to argue from.

---

## 12-line verdict

1. Focus: make agentbox deployable by a stranger on foreign hardware, forced by the ACHD
   November contract; fold docBox's clinician surface into the same build.
2. It is the only candidate where the internal runtime work *is* a priced external deliverable,
   with a named contact and a fixed date six weeks out.
3. Exit evidence: fresh-host bring-up from the written runbook off this container, listeners
   proven with `ss -tlnp`, a manifest-truth gate that fails on mismatch, synthetic letters to
   REDCap export, docBox answering on that deployment, and invoice 049 issued.
4. Runner-up: campaignbuilder's second tenant, downgraded from RC's "administrative only" by
   CLOSEOUT findings X, Y, Z and X7; a fortnight of ours plus blockers Richard must clear.
5. Week-one calendar items, not a focus: send Resona (GBP 199,500 to 295,500, ready since 9
   September) and ask THG for the UKRI letter. Zero engineering, highest return per hour.
6. Park the sidechain two cycles: no customer exists by PRD-024 §9 D5's own words, the only
   externality is an unpopulated repo, and it reopens four ratified positions at once.
7. Park federation until a second node exists; the November deployment manufactures the first
   credible one, which inverts the design-ahead-of-consumer order the estate keeps repeating.
8. Loom: run the PRD-028 pilot only, on the clinical corpus, not the 200-hour study. It is the
   estate's best finished-per-effort programme and its result could retire a large investment.
9. Do C7 inside the focus: a `payment_settlement = "zero-tolerance"` class that `routes/payments.js`
   never calls is a documented lie costing half a day to end.
10. Insisted ledger hygiene: delete the uncorroborated "THG World Record" and Salford
    "research partnership" strip, reconcile the federation pill with the FREEZE, and gate public
    claims on ledger citations the way ADRs are already gated. Not the fifteen stale host ADRs;
    no outsider reads those.
11. Reject C1 at its briefed scope: fixing five repos and fifteen records is an unbounded
    verification loop of exactly the shape RE §5 diagnoses. Take only the subset the November
    delivery forces, and freeze new ADRs until it lands.
12. The disease is not sprawl of capability, it is absence of externally owned deadlines. Adopt
    the one the estate already signed, and let it do the pruning the audits cannot.
