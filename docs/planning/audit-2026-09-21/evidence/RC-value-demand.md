# Where external value is waiting for this estate

## Scope and method

Sources read: VisionFlow (README, docs/PRD-website.md, docs/PRD-ecosystem-alignment.md,
docs/PRD-judgment-broker.md, website/ copy, the closeout audit that functions as the "honest
status ledger"), dreamlab-ai-website, dreamlab-cumbria (README, CLAUDE.md, docs,
infrastructure), PeteStrategyDoc (basicDoc.md, steeringConversation.md), EXECUTIVE_SUMMARY.md,
aisp.md, ukri-competition (all appendices), funding_platform (README, prd.md), campaignbuilder
(README, CLOSEOUT.md), Research/, docBox (README, docs/vision-brief.md), courses, events,
Pingle, VivBid, report-Pete, mideast-creative-report, agentbox-of-empires, the federation idea
(grepped across VisionFlow docs and agentbox docs/adr), the private portfolio at
personal-context-portfolio (read locally; summarised, not quoted verbatim), and RuVector memory
via `mcp__claude-flow__memory_search` in namespaces `personal-context` and `project-state` for
goals, pipeline, partner, funding, customer, demo, external interest and federation-project.

Four parallel research passes covered these in full; this report is the synthesis, cross-checked
against direct memory queries and one direct read (PRD-028, added mid-audit — see section 4).

**Evidence tags used throughout:**
- **(a) confirmed** — a named external party, a dated event or deliverable, and/or money changing
  hands, documented in the repository or in RuVector memory.
- **(b) in-flight** — a funding application, proposal or negotiation under way, not yet won or
  signed.
- **(c) aspiration/internal** — planning language, market rationale or a named target with no
  documented contact, contract or response from the other side.

A recurring pattern across this estate is that its own honesty apparatus is inconsistent: some
documents (the VisionFlow closeout audit, the UKRI bid's self-review, ADR-2092) are unusually
candid about gaps; the public website is markedly less so. Both are cited below, and the
distinction matters more than any single number.

---

## 1. Inventory of value channels

### 1.1 Partner channel

#### THG Ingenuity + University of Salford, via the UKRI IRIS bid — tag (b), strongest partner lead

- **Evidence of demand:** a named THG stakeholder, Steve Moyler, issued a live creative brief
  ("flowers in bloom, think Bjork") that the agentic pipeline executed
  (`ukri-competition/appendix-a-user-workflow-fit.md`, `appendix-c-mvp-integration-readiness.md`).
- Fortnightly sprint demos run with THG creative teams.
- A dated joint event is scheduled: the THG Ingenuity fashion catwalk, 25-26 February 2026, at
  the University of Salford — described in the bid as "the first agent-supported creative
  production event."
- University of Salford (School of Arts, Media and Creative Technology) is named as academic
  co-design partner, contributing evaluation methodology and student researchers.
- **What they need:** an agentic creative-production pipeline that turns an ad-hoc
  natural-language brief into usable 3D/visual assets fast enough for a live fashion-tech event,
  plus commerce-API integration and brand-safety guardrails.
- **What exists today:** a working demonstration pipeline on VisionFlow's Rust/React/Three.js
  stack — 12 glass-icon 3D objects and 48 renders, a Blender-generated golf-course scene, a
  voice-to-GLB flower model — grounded via an OWL 2 EL ontology (Whelk-rs) and a generative
  pipeline through ComfyUI/Flux2, headless Blender MCP and Microsoft Trellis 2
  (`appendix-b-technical-approach.md`).
- **Gap:** THG Commerce API integration is "architecture designed; integration scheduled Q1
  2026" — not built. Production hardening (metrics, logging, alerting), a security audit and
  Kubernetes horizontal scaling are all "not yet done." The bid's own self-review
  (`bid-improvement-suggestions.md:111-120`) flags that it contains no named THG letter of
  support, no quantified catwalk outcomes, and no IRIS-specific financial projections.
- **Time to first value:** the catwalk itself (25-26 Feb 2026) is the immediate proof point.
  Closing the commerce-API gap and securing a named THG sign-off would strengthen both the Phase
  2 UKRI submission and any direct commercial pitch to THG afterwards.
- **Verdict:** this is the only place in the whole estate with a named, dated, working
  relationship with a large external creative studio, backed by real technical demonstration
  output rather than a proposal alone.

#### Boston Limited / Littlewoods Creative Campus, Liverpool City Council — tag (b)/(c)

- DreamLab, via Pete Woodbridge (CTO, DreamLab Collective), is authoring a technology
  infrastructure advisory report for Liverpool City Council's Littlewoods Creative Campus
  redevelopment (`PeteStrategyDoc/basicDoc.md:17-75`).
- The pitch reframes the site from "rent dumb space" to "Production-as-a-Service": an on-site
  Neutral Edge Data Centre, dark-fibre backbone via LCR Connect, liquid-cooled AI/GPU compute.
- Boston Limited (a UK NVIDIA/DGX integrator) is an informal contact only — "I'll circle back to
  them" (`steeringConversation.md:20-24`).
- Anthropic-via-Azure is used explicitly as a "narrative boost" framing device to help the
  Council attract other partners, not an actual relationship (`steeringConversation.md:29-43`).
- Epic Games, Sony PlayStation, Framestore, DNEG, ARRI and disguise are named as target
  delivery-partner leads; none are secured.
- Ad-lib, a Liverpool events company (~1,000 staff), is the one plausible anchor-tenant lead
  already needing infrastructure.
- **Gap:** no signed commercial relationship for DreamLab itself — DreamLab is the report's
  author, not a beneficiary of campus funding. Grid capacity, structural loading and acoustic
  surveys are all flagged as "next steps," not completed.
- **Time to first value:** indirect and slow — depends on whether the Council acts on the
  advisory report; DreamLab's own upside is reputational and a possible future consulting fee,
  not a pipeline deal.

#### Levels VR, Barclays Eagle Labs Cumbria — tag (c), a documentation gap worth flagging

- RuVector memory (`personal-context-goals`) records these as early-stage outreach targets for
  DreamLab Cumbria's Sellafield/Barrow-adjacent training strategy.
- A full grep of the `dreamlab-cumbria` corpus (README, CLAUDE.md, docs, infrastructure) returns
  **zero hits** for either name — no contract, MOU or documented contact exists in the
  repository.
- This is a gap between what the owner has told the memory system and what the business-plan
  corpus records. Worth raising directly with the owner rather than assuming the relationship
  exists, since two independent research passes over the full corpus found nothing.

### 1.2 Customer channel — live or recently live commercial engagements

#### Resona (music-industry AI analytics client, contact "Christian") — tag (a), largest live deal

- A full RFQ-to-quotation cycle completed 2026-07-14: a client-facing 23-page LaTeX quotation,
  £112,500 ex VAT for Phase 1 (225 days at £500/day, solo-led agentic delivery)
  (`resona-rfq-mission-complete-2026-07-14`).
- By 2026-09-09 this had progressed to a formally staged Year 1 programme: four stages totalling
  399 engineering days for £199,500, with a mechanical programme range of £226,500-£295,500 once
  three provisionally Extended/Flagship streaming-insight modules (£10k-£33k each) are specified
  (`resona-year1-programme-2026-09-09-final`).
- Support tiers are already quoted: £950/month rising to £1,850/month from December 2027.
- **What they need:** social-media and streaming analytics insight modules — Hook Detector,
  Optimal Release Window Forecasting, Playlist Fit Likelihood, Geographic Market Opportunity —
  for artists and labels, built on Chartmetric data with feasibility limits already assessed
  (Spotify CSV-first, Apple deferred, TikTok Display-API baseline; IG/YT feasible with sprint-1
  review gates).
- **What exists today:** a fully quoted, milestone-scheduled delivery plan (M1-M8 at
  10/10/12.5/17.5/25/7.5/10/7.5 per cent), QE-validated at 0 critical and 0 high findings on the
  pricing and citations pass.
- **Gap:** this is a **proposal awaiting client acceptance**, not a signed contract. The corpus
  shows negotiation and repricing rounds through September 2026 but no "client signed" memory
  entry.
- **Time to first value:** near-immediate once accepted — Stage 1 was planned to complete by end
  April 2027, with a Founding Artists beta from May 2027.
- **Verdict:** the estate's clearest near-term revenue opportunity by pound value.

#### Campaignbuilder — live tenants civic-quest and ieepa, real contact "Richard" — tag (a)

- Campaignbuilder is a governed AI-agent platform letting a client's marketing team edit their
  live campaign site by conversation, with an operator "Foreman" console gating riskier changes.
- Genuinely deployed to Google Cloud (VM `cb-test`, project `campaignbuilder-503809`) with two
  registered production tenants rendering live: `civic-quest` on live Supabase, and
  `ieepa`/ReclaimIQ (`campaignbuilder-gcp-deploy-and-writepath-2026-07-31`).
- A real external contact, "Richard" (`richard@dreamlab.uk`, plus a named firewall entry for his
  IP), reported a broken demo — a strategy-brand-page flow — which was root-caused to an ingress
  misconfiguration and fixed (`campaignbuilder-followon-2026-07-29`).
- A security incident was found and fixed live in the same pass: a Supabase service-role key had
  been baked into a Docker image layer.
- Per `CLOSEOUT.md` (14 Sep 2026 live run): a real end-to-end session against the client's own
  tenant tree — a production database write, an approved headline live on the public page, 1,702
  passing tests, and six specific open pull requests filed against the client's own codebase.
- **Gap:** no Google OAuth client for real sign-in (falls back to a break-glass proxy), no team
  repo/deploy token (code-substrate `/pushlive` is fail-closed), an undersized VM, and a tenant
  content tree that predates the newer "structural-change" panel.
- **Time to first value:** short. The blockers are almost entirely client-side administrative
  items — OAuth app registration, repo/deploy credentials — not engineering.
- **Verdict:** the strongest "productise now" candidate for repeat business. The hard multi-tenant
  plumbing (per-project Supabase slot provisioning, deploy write-path authority scoping, ingress
  partitioning) is already built and was adversarially reviewed (23-25 agent reviews, all
  defects fixed) before this session.

#### The Monastery Manchester (heritage charity) — VivBid — tag (a), clearest realised value

- Real, confidential organisational source documents: Impact Reports 2023-2025, Annual Reviews,
  "Knowing Our Community" surveys.
- A completed, compiled deliverable: a 10-chapter *Strategic Funding Compendium 2026-2028*
  (funding cascade, income diversification, social-value forecast, staffing models) built from a
  LaTeX/Python pipeline.
- A live funder relationship is documented: a Garfield Weston Foundation Expression of Interest
  dated 17 July 2025, plus "The Monastery Peace Project under £100k" proposal materials.
- **What they need:** a fundable, evidence-based multi-year strategy document that translates
  their own impact data into a grant-ready narrative and financial model.
- **What exists today:** the compendium is compiled and delivered
  (`outputs/The_Monastery_Manchester_Strategic_Funding_Compendium_2026-2028.pdf`); the README
  states explicitly "Private, single-client deliverable."
- **Gap:** no visible ongoing retainer in the repository; unclear whether there is a
  repeat-engagement path for updated EOIs to other funders using the same pipeline.
- **Time to first value:** already realised — a real charity received a real deliverable built
  substantially by this tooling. The nearest *new* value is repackaging the pipeline
  (docx/PDF ingestion, quantitative modelling, chart generation, compiled bid book) as a
  repeatable service for other UK heritage/charity clients, since the underlying
  document-to-funding-bid capability is generic, not Monastery-specific.

#### NHS ACHD clinical-informatics residential engagement, Nov 2026 — tag (a), priced and dated

- A named contact, Laurence Tidbury; a scheduled residential 3-5 November 2026 at Fairfield
  House; a fixed price of £7,500 (`achd-nhs-residential-engagement-2026-11`).
- Deliberately discounted from a £20,250 list value as a "founding-cohort R&D collaboration
  credit," explicitly logged as "loss leader, not a rate precedent."
- **Deliverable:** an open-source Agentbox deployment on a Trust-owned DGX Spark, plus a
  letter-processing MVP (ICD-10 extraction, redaction, REDCap-ready export) on synthetic data
  only.
- **What they need:** hands-on, non-clinical-grade demonstration of agentic tooling for
  clinical-informatics workflows, without touching real patient data or claiming medical-device
  status.
- **Gap:** the NHS Trust's name and finance address were still unconfirmed as of 2026-09-17; a
  pro forma invoice exists (unsigned) but the final invoice cannot be issued until a PO arrives.
- **Time to first value:** weeks — this is a fully priced, dated, near-term engagement, blocked
  only on administrative confirmation from the Trust side.

#### docBox — NHS clinician demonstrator — tag (b), strong pitch artefact, no signed client

- A "distillation, not agentbox" product with a flagship clinician demonstrator: synthetic
  patient records ingested via OCR, grounded into a typed evidence-linked record, queried by a
  cited-answer agent mesh, targeting an NVIDIA DGX Spark appliance, aimed at NHS doctors "being
  taught to be wary of AI that overclaims."
- `docs/vision-brief.md` states explicitly, as of writing: status was "pre-brief scaffold (client
  brief expected ~late July 2026)... provisional until the client brief lands" — built ahead of a
  client engagement that had not been confirmed.
- **What exists:** core control-plane, audit trail and clinician surface built and tested against
  synthetic/seeded data; DTAC-compliance-style messaging aimed at an NHS-procurement audience.
- **Gap:** Foreman UI, host runtime, a live agent, DGX Spark deployment and Entra SSO are all
  explicitly marked pending. No confirmed signed client.
- **Time to first value:** this demonstrator, once host-runtime wiring is finished, is itself the
  sales artefact for exactly the kind of NHS engagement the ACHD deal above represents — the two
  should be linked rather than developed as separate tracks (see section 3, item 2).

#### Simplilearn teaching-assistant grading work — tag (a), confirmed, low value, recurring

- Real, ongoing, invoiced freelance TA work on Canvas-hosted courses (for example "Leadership
  Skills with AI," "ABA" cohorts), billed at $17.50/hour, against numbered invoices (invoice 038
  referenced in memory), with named students and a named co-facilitator (Varun Aggarwal).
- **Gap:** purely time-for-money, no scale, no product or platform leverage attached.
- **Verdict:** small but genuinely flowing external revenue, worth noting as the estate's only
  channel that is neither a proposal nor a one-off deliverable but recurring paid work.

### 1.3 Funder channel

#### UKRI Agentic AI Pioneers Prize, IRIS bid, Creative Industries track — tag (b)

- Phase 2 submission dated February 2026 (`ukri-competition/main.tex:88,99`); no specific prize
  amount or hard deadline is recorded anywhere in the corpus itself.
- This is the funding vehicle wrapped around the THG Ingenuity/University of Salford partnership
  described in section 1.1.
- The bid's own highest-scored risk: AI hallucination/brand-damaging content, scored 25/25
  (5x5), mitigated only by mandatory human sign-off — an honest, not-yet-solved risk rather than
  a marketing omission.

#### Innovate UK / KTP / Voqal collaboration mechanisms — tag (b), mapped, not yet applied

- RuVector memory (`voqal-funding-mechanisms`) records a mapped set of funding routes for a Voqal
  AI collaboration:
  - Innovate UK Smart Grants — up to £2M collaborative, rolling open.
  - KTP Round 5 — £8.5K/month, 12-36 months, £10M available.
  - Sovereign AI Proof of Concept — £50-120K.
  - UKRI Technology Missions Fund — £320M total, £25M AI strand for 2025-26.
  - Made Smarter Innovation — up to £37M for digital manufacturing including VR.
  - NDA Innovation Fund — £30M for nuclear innovation.
  - DASA — £50K-2M defence innovation.
- Recommended first move: an Innovate UK Smart Grant with Voqal as SME lead, Sheffield as
  knowledge base, DreamLab as industry partner; second: a KTP linking Sheffield ASET with Voqal,
  with the owner as industry mentor.
- **Verdict:** a live, well-researched opportunity map, not yet an application in flight — the
  next concrete step is choosing one route and starting the paperwork.

#### Garfield Weston Foundation — tag (b), via the Monastery Manchester engagement

- See section 1.2 above. DreamLab is not the applicant here (the Monastery is), but the
  relationship is real, dated (EOI 17 July 2025), and demonstrates the pipeline's value to a
  funder audience.

### 1.4 Community channel

#### Agent of Empires (AoE) — tag (a) for the tool itself, not for this estate's work on it

- AoE (`github.com/agent-of-empires/agent-of-empires`, MIT licence, author Nathan Brake) is an
  independently maintained open-source interaction-plane tool with a real outside community: a
  Trendshift trending-repo badge, a Homebrew formula, a ClawHub listing, a YouTube channel, an
  X/Twitter account, a Mozilla.ai-branded Discord, and a CHANGELOG naming 30+ distinct external
  contributor handles beyond the primary author.
- This estate is a **consumer/integrator**, not the developer — `agentbox`'s
  `[interaction_plane]` gate wraps AoE behind a NIP-98 reverse proxy (ADR-042/PRD-021).
- **Verdict:** the external pull belongs to AoE's own upstream community, not to DreamLab; the
  estate's contribution is integration engineering, which is internal work regardless of how
  external the underlying tool is. There is no external value here for DreamLab specifically
  unless something built *on top of* AoE were published for outside use.

#### Colloquy (shared-agent-learning) and did:nostr/JavaScriptSolidServer identity — partial

- Colloquy's `colloquy-core` crate is explicitly a "clean-room Rust implementation of the [cq]
  shared-agent-learning standard" published by mozilla.ai — the same organisation behind AoE's
  Discord — so it implements an external open standard.
- `colloquy-core`, `colloquy-view`, `colloquy-nostr` and `colloquy-store` are already published
  to crates.io. `colloquy-backends` is explicitly scoped as "internal: the only crate still bound
  to this estate's nostr-bbs-core signing and to that specific server."
- No evidence was found of any outside party consuming this estate's specific colloquy
  deployment.
- The did:nostr/SSO identity model similarly credits "Upstream IP: Melvin Carvalho" for
  JavaScriptSolidServer and did:nostr — adoption of a named external person's published protocol,
  not external demand for this deployment of it.
- **Nearest external value:** publishing the four colloquy crates well (they already meet the
  estate's own crate-publishing bar — full rustdoc, README, licence, clean `cargo doc --no-deps`)
  is the cheapest way to find out whether the mozilla.ai `cq` community has any interest in this
  implementation, independent of the rest of the ecosystem.

#### personal-context-portfolio — tag (c), an unexploited, already-built product

- An MIT-licensed, markdown-first template repository for building a personal "operating manual"
  that any AI agent can ingest: ten template files (identity, role, projects, team, tools,
  communication style, goals, preferences, domain knowledge, decision log) plus an
  interviewer-agent system prompt.
- Its own README describes a two-sided model: "Use the web app... a purpose-built interviewer
  agent walks you through the whole process" or "Do it yourself... fork this repo."
- No evidence in this audit that the "web app" the README references has been built, or that the
  repo has been shown to anyone outside the owner.
- **Verdict:** this is the one artefact in the whole estate that is already a generalisable,
  MIT-licensed, zero-marginal-cost product concept, adjacent to the estate's own core
  identity/context work (did:nostr, the `personal-context` memory namespace). It needs no client,
  no funder and no partner sign-off — only packaging and a public push. See section 3, item 4.

---

## 2. The estate's thesis, and the three claims the code does not fully back

### 2.1 The thesis, in the docs' own words

VisionFlow's README states its purpose directly: "Six honest systems can still assemble one
collective lie — VisionFlow is the canon that stops that. It holds the ADRs, PRDs, compatibility
matrix and honest status ledger for a seven-repo human-AI mesh built on one wager: AI collapses
the cost of routing information, so the human is promoted from router to judgment broker. This
repo ships words, not runtime — and it is graded on their accuracy" (`VisionFlow/README.md:21`).

The wager is elaborated a few lines later: "Hierarchy was an information-routing protocol
bounded by human bandwidth. AI is collapsing the cost of that routing towards zero, so the human
role is not eliminated — it is promoted from router to judgment broker" (`README.md:27,29`), with
the explicit caveat, "This repo is documentation and website — not a runtime" (`README.md:33`).

**In one paragraph:** the estate's thesis is that as AI collapses the marginal cost of routing
information and drafting work, the scarce and valuable human contribution shifts from doing and
routing to judging — deciding what is trustworthy, what to act on, and what to escalate — and the
whole seven-repo mesh (VisionFlow as canon, VisionClaw as the knowledge-graph engine, agentbox as
the agent container, solid-pod-rs for sovereign storage, nostr-rust-forum for governance,
dreamlab-ai-website for the public face, and Loom for grounded reasoning) exists to make that
judgment role legible, auditable and cryptographically anchored via a single did:nostr identity
spine.

### 2.2 Three claims that outrun the code

#### Claim 1: cross-org mesh federation is live and integrated

- Public claim: the status table and badge describe federation as `integrated`, with "6 federated
  substrates" (`VisionFlow/README.md:8,238,252-253`); the website describes federated peer
  discovery and NIP-42 challenge/response routing "across nodes" (`website/static/index.html:858`).
- Ledger status: the estate's own closeout audit reaches a formally frozen, opposite decision —
  "Closeout decision (FREEZE): declare standalone-first as the supported deployment mode. Mesh
  federation... is designed, not shipped and parked" (`docs/ecosystem-map.md:124-132`); "the
  federated-by-default tally is 1/4, not 2/4."
- A sprint-planning document independently confirms federation sits at the lowest priority tier,
  P2, with "no code consumers" for agentbox's mesh keys (`docs/roadmap.md:23-24`;
  `docs/PRD-gap-close-sprint.md:32-33,138`).
- Even the website contradicts its own hero copy a few hundred lines later, in its own "what
  ships today, plainly" table: "Cross-org mesh federation... Built, not yet
  federation-verified... standalone-first stays the supported mode until the live cross-substrate
  smoke test runs" (`website/static/index.html:1021`).
- No external party anywhere in the corpus is recorded asking for cross-org federation; it is
  entirely an internal identity-spine design ambition, not an externally demanded feature.

#### Claim 2: the Judgment Broker delivers working human-in-the-loop governance

- Public claim: the website markets a finished governance UX, "accelerates, not blocks"
  (`website/static/index.html:544-545`).
- Ledger status: the PRD for the same feature carries a self-written correction dated
  2026-09-14: "The loop this PRD closes is cryptographically complete and semantically hollow:
  the decision surface withholds the proposal and fabricates the human rationale, and the
  escalation boundary is the agent's own tier" (`PRD-judgment-broker.md:9-16`).
- An independent adversarial audit against a published academic framework (arXiv:2609.12482)
  reaches the same verdict from a different angle: "the forum decision card never renders
  `ActionEntry.fields`... human rationale is UI-fabricated ('Human {action} via governance
  UI')... agent risk tier and confidence render ABOVE Approve (anchoring); confidence hardcoded
  0.5."
- Also material: "no `ConceptElevated` event fires on merge yet (verified absent in source
  2026-09-06)" (`README.md:254`).
- **Why this one matters most:** it is the claim that underwrites the entire "judgment broker"
  thesis in section 2.1, and it is the one most clearly and repeatedly contradicted by the code,
  by two independent audits reaching the same conclusion from different directions.

#### Claim 3: named "Real-World Validation" — Salford research partnership and a THG world record

- Public claim: the website's validation strip names two external institutions explicitly —
  University of Salford ("research partnership, semantic force-directed layout") and a "THG
  World Record" of 250+ concurrent XR users (`website/static/index.html:761-764`).
- Ledger status: a full grep of every markdown file under `docs/`, the closeout audit, the
  ecosystem map and the site-verification checklist returns **zero hits** for either "Salford" or
  "THG" outside this one page.
- Precision matters here: the underlying relationships are not fabricated. University of Salford
  and THG Ingenuity are both real, current partners via the UKRI IRIS bid (section 1.1). The gap
  is not "these partners do not exist," it is that the *specific claims* made about them on the
  public site — a "world record," an unqualified "research partnership" — are asserted nowhere
  else and cannot be checked against the ledger that is supposed to grade the website's accuracy.
- One partially corroborating data point: the DreamLab Creative Hub figure on the same strip
  ("50-person team, 17,000+ graph nodes, daily production") is at least indirectly consistent
  with an independently code-verified figure elsewhere in the README ("~17k nodes live (17,147
  captured)" for VisionClaw's GPU graph physics) — so not every figure on the strip is equally
  ungrounded, which makes the pattern harder to spot at a glance.

The estate's own closeout document names this failure mode directly and at scale: "substantially
built and dangerously misdescribed... a failed immune system... CI theatre — thousands of tests
exist that no CI trigger ever runs... Truth decay — 90 doc-drift findings... asserts capabilities
(mesh federation, NIP-42, IS-Envelope routing, NIP-26) that exist nowhere... Trust-layer
overstatement — the PROV-O provenance emitter is dead code with zero production callers, and the
SHACL shapes are never loaded, while current marketing commits advertise both"
(`docs/closeout/final-design.md`, 2026-07-03, two independent code-verified audit swarms,
202/323 ADRs = 63 per cent verified implemented). That audit is itself strong evidence the estate
has the self-awareness to fix this; the open question is whether the public website has been
brought into line with it since 2026-07-03.

---

## 3. What could be demoed or shipped within one cycle (2-4 weeks), ranked by external payoff

### 1. Close campaignbuilder's five named client-side blockers and land a second tenant

- **Surfaces:** `campaignbuilder/enclosure/` (Google OAuth client registration), `control-plane`
  (repo/deploy token wiring for `/pushlive`), VM sizing on GCP project
  `campaignbuilder-503809`.
- The multi-tenant architecture — per-project Supabase slot provisioning, deploy-authority
  scoping fixed in the 2026-07-31 security pass, ingress partitioning — is already built and
  adversarially reviewed at 1,700+ passing tests.
- Highest-confidence, lowest-engineering-risk item on this list: the hard problem is solved,
  what remains is administrative unblocking plus a repeatable onboarding checklist.
- **Payoff:** a second paying or pilot tenant on infrastructure that already works.

### 2. Turn the docBox NHS demonstrator and the ACHD residential into one pitch motion

- **Surfaces:** `docBox/docs/vision-brief.md`, the Foreman UI and host-runtime wiring for a DGX
  Spark target; the ACHD engagement (`achd-nhs-residential-engagement-2026-11`) already has a
  fixed price, a named contact, and a November 2026 date.
- Finishing docBox's host-runtime wiring in time to demo it live during the ACHD residential
  lets one engagement sell the next.
- A working, non-clinical-grade agentic clinical-informatics demonstrator is exactly the
  credibility artefact an NHS-adjacent audience needs, and there is already a room booked with a
  receptive audience.
- **Payoff:** a live demonstration in front of a real NHS-adjacent audience, at near-zero
  incremental cost beyond finishing wiring that is already scoped.

### 3. Package Pingle's Biodiversity Net Gain (BNG) pipeline as a repeatable service offer

- **Surfaces:** `Pingle/src`, `Pingle/scripts/generate_figures.py`, the BM4.0 Monte Carlo
  calculator, the ~200-page LaTeX report generator.
- The pipeline is fully built and has already produced one complete, real deliverable (habitat
  classification, BM4.0 calculator output, Monte Carlo distributions, generated maps).
- Every UK development now requires a statutory BNG assessment — a live, generic regulatory
  market with a proven working pipeline and zero named client attached yet.
- **Payoff:** the shortest path to revenue here is not engineering, it is finding the first
  paying landowner, developer or ecology consultancy and pricing a report — the product itself
  needs no further build.

### 4. Publish personal-context-portfolio and point it at the estate's own identity work

- **Surfaces:** the repo itself — already MIT-licensed, README-complete, ten templates, three
  worked examples, an interview-protocol system prompt.
- Needs no client, no funder, no partner sign-off — it is a standalone product concept already
  built to the point of being forkable today.
- Wiring the "web app" the README references (or being explicit that it does not exist yet and
  repositioning around the DIY path) and pushing a public announcement is days of work, not
  weeks.
- **Payoff:** the fastest possible piece of genuinely external validation (stars, forks, issues)
  the estate could generate, and a cheap test of whether the identity-context thesis has outside
  pull independent of the rest of the ecosystem.

### 5. Close the THG Commerce API gap and get a named letter of support

- **Surfaces:** `ukri-competition/appendix-b-technical-approach.md` (the "architecture designed;
  integration scheduled Q1 2026" item) and `bid-improvement-suggestions.md` (naming the missing
  letter of support, quantified catwalk outcomes and competitor benchmarking as the weakest parts
  of the current submission).
- Higher-effort than the items above, and partly outside DreamLab's control — needs a THG
  counterpart to actually write and sign something.
- **Payoff:** the largest in this list if it lands — a strengthened funding-prize submission, and
  a documented, citable enterprise partnership usable in every future pitch.

### 6. Publish colloquy release notes and a short usage write-up

- **Surfaces:** `crates/colloquy/*` — `colloquy-core`, `colloquy-view`, `colloquy-nostr`,
  `colloquy-store`, already published to crates.io per the estate's own crate-publishing bar
  (full rustdoc, README, licence, clean `cargo doc --no-deps`).
- Marginal effort: a short "why this exists" note aimed at the mozilla.ai `cq` standard's own
  community — the same community AoE draws its external pull from.
- **Payoff:** a cheap, low-risk way to find out whether there is any outside interest in the
  shared-agent-learning model beyond this estate's own use.

Deliberately excluded from this ranked list: further AoE interaction-plane work, sovereign
settlement/sidestr, and further federation engineering. Section 4 explains why none of these
currently has an external party waiting on them within a one-cycle horizon.

---

## 4. In-flight programmes: external pull versus internal preference

| Programme | External evidence found | Verdict |
|---|---|---|
| AoE / Agent of Empires interaction plane | AoE itself is a third-party open-source project (MIT, author Nathan Brake) with a real outside community: Trendshift badge, Homebrew formula, ClawHub listing, a Mozilla.ai-branded Discord, 30+ external contributor handles in its CHANGELOG. This estate is a consumer/integrator (`agentbox`'s `[interaction_plane]` gate, ADR-042/PRD-021), not the developer. | External-pull on the underlying tool; internal-preference on the integration work. |
| Sovereign settlement / sidestr sidechains | PRD-024 frames this as closing a self-identified internal gap: "the estate has an almost complete payments loop and no settlement." The only externality cited is speculative — a federation-signer project "not yet populated on GitHub (external interest)," and "customer classes" explicitly left for counsel to define "before any triggering activity," i.e. by the document's own admission, no customer exists yet. All eight linked ADRs (2096-2103) are `proposed`, not accepted. | Internal-preference. Pure architecture ideology, researched by the estate's own internal agent mesh, with no named outside stakeholder. |
| Federation (multi-node/multi-instance) | The estate's own closeout decision: "declare standalone-first as the supported deployment mode. Mesh federation... is designed, not shipped and parked" (`ecosystem-map.md:132`, FREEZE). Every other federation mention (URN kind-map parity, `federation.mode` config, the BC20 anti-corruption bridge) is internal protocol plumbing with no external actor named anywhere across either VisionFlow or agentbox docs. | Internal-preference, explicitly frozen by the owner's own decision. Never had a live external consumer. |
| The Ontology Loom | Entirely internal infrastructure today: email-gateway reasoning and agent grounding, running a self-hosted model behind a stable façade. No external consumer of the Loom's API found anywhere. Now under its own falsifiable review — see PRD-028 below. | Internal-preference, now formally under its own evaluative scrutiny. |
| SSO / did:nostr identity | Built on a named external person's published open protocol (Melvin Carvalho's JavaScriptSolidServer / did:nostr), credited as "Upstream IP" in the README — adoption of an external standard, not external demand for this deployment of it. No evidence any outside party currently uses or requires this implementation. | Unclear/partial. External standard adopted; no external consumer of this instance found. |
| XR client | No dedicated governing document was locatable in this pass despite the routing table naming one. VisionClaw's own README frames Quest 3 desktop-to-headset rendering purely as an internal flagship-engine capability. No external customer or partner request found. | Internal-preference (absence of evidence, not an exhaustive negative — worth a follow-up read of VisionClaw directly). |
| "Dream cycle" (nightly dream machine) | The estate's own governing document is explicit: "Dream-machine programme (legacy ADR-052, ADR-055-072) — mostly paper" (`docs/GOVERNANCE-capabilities.md:183`); only the dream-engine binary itself is real and shipped, the rest is internal-only tooling for the operator's own agent sessions. No external consumer found. | Internal-preference. |
| Skills estate (127 skills, 57 always-registered) | Baked into the agentbox image, used entirely by the operator's own Claude Code sessions. No public release, no external team, no client engagement referencing the skill library. | Internal-preference. |
| Colloquy (shared-agent-learning) | Implements an external open standard (mozilla.ai's `cq`), and four of its crates are published to crates.io — external grounding at the specification and distribution level. But `colloquy-backends` is explicitly scoped as internal, and no evidence any outside party consumes this estate's deployment. | Unclear/partial, same shape as identity: external standard, no confirmed external consumer yet, but genuinely publishable (section 3, item 6). |

### Does Loom earn its complexity? (PRD-028, filed 2026-09-21)

The owner has just filed a preregistration specification asking exactly this question of the
Loom programme: whether its ontology-backed serving path beats strong flat-text retrieval on
genuinely private knowledge, at matched information access and context budget
(`loom/docs/design/PRD-028-does-loom-earn-its-complexity.md`).

- The document is explicit that "no new experiments have been run" and that "numerical
  thresholds below are proposed product decisions, not established scientific constants."
- It proposes a pilot first (400-800 source units across at least four subdomains) before a full
  study (6,000-10,000 units), with a stated cost of roughly 200 reviewer-hours for the full study
  and a proposed +5 point practical-significance threshold before Loom's added complexity is
  judged worth retaining.
- The decision owned is stated plainly: "retain and invest in the structured serving path,
  simplify it, specialise it for a demonstrated task family, or invest in corpus quality rather
  than serving complexity" — one legitimate outcome of this study is that a large fraction of the
  Loom investment gets simplified or retired.
- It motivates from, and cites, a public paper (`docs/research/gain-over-copy-paper/gain-over-copy-paper.pdf`,
  "The Copy Ceiling"), which is itself a small, real research/publication value channel.

**Assessment:** this is the single clearest case in the estate of turning "is this
internal-preference engineering actually worth its cost" into a falsifiable, published research
question rather than an assumption. It has real value of its own (a publishable methodology and
result) alongside a real, quantified cost (200 reviewer-hours plus pilot corpus preparation), and
its outcome could legitimately redirect effort away from Loom and toward whichever of the
higher-external-pull channels in section 1 turns out to actually need it.

### Federation, in full, across both repositories

Every citation found agrees on one point: `ecosystem-map.md:132` (FREEZE decision);
`roadmap.md:24` (DID/federation-identifier plumbing landed but unconsumed);
`ecosystem-map.md:89,267` (federation as an open architecture question, not a requirement);
agentbox `docs/PROTOCOL-registry.md`, `GOVERNANCE-capabilities.md:409`,
`docs/developer/identity-mesh.md`, `ecosystem.md`, `native-pod-mesh.md`, `hp-peer-node.md:56`
("has no code consumer"); `docs/proposals/sovereign-settlement-domain.md`'s reuse of
"federation" as a settlement-signer-set term. Every live/shipped item in the estate is
standalone-by-default, and every federated item is proposed, inactive, parked, or has no code
consumer. Not one citation across either corpus names an outside collaborator, customer or
funding body actually asking for cross-org federation. It is architecture built ahead of demand —
a defensible bet for an identity-spine thesis, but one that should not be marketed as delivered.

---

## 5. The cost of sprawl, in the owner's own words

The literal word "sprawl" does not appear in the agentbox or VisionFlow documentation corpus in
the estate-complexity sense (a targeted grep returns only unrelated design-system boilerplate
false positives). The owner's actual, consistently used term for the phenomenon is
**"accumulated"** — and the record of what accumulated, and what it cost, is unusually precise.

`agentbox/docs/adr/ADR-2092-govern-the-agent-and-command-registries.md` (accepted 2026-09-16,
re-verified 2026-09-21) documents a live-container audit:

> "Agent registry — 97 unique agents across 2 roots, 26,151 chars ≈ 6,540 tok/turn. Command
> registry — 244 files, 225 with no `description:`, 7,663 chars ≈ 1,915 tok/turn. Ancestor skill
> root — 26 skills, 0 of them registered, 9,510 chars ≈ 2,377 tok/turn."

Two findings from that audit describe a correctness failure, not just a token-budget one:

> "Divergent duplicates, with the wrong copy winning. 74 of the 97 agents existed in both roots;
> only 37 were byte-identical... the nested copy shadows the user copy — and the nested copies
> were the older, truncated ones. `collective-intelligence-coordinator` was served at 3,854 bytes
> while a 31,403-byte revision sat unused one directory up... This is a correctness defect, not a
> budget one: the agent that ran was not the agent that had been written."

> "The registry is inherited, not chosen. 63 of 97 agents carry V2 claude-flow hook theatre
> (`echo`, `npx claude-flow hooks pre-task`, `ruv-swarm`); 9 are `flow-nexus-*` against an account
> this estate does not have; 13 `github-*` agents duplicate the `github-*` skills... Only 9 agents
> were free of legacy markers."

The root cause is named plainly: `ruflo init` (`@claude-flow/cli`) and `aqe init --auto` "each
dump their template sets into `$HOME/.claude/agents` and `$HOME/.claude/commands`... `~/.claude`
is a host mount, so every dump survives every rebuild, and nothing refreshed, deduplicated or
removed them."

The fix reduced the always-loaded custom registry "from ≈10,832 to ≈1,273 tokens per turn,"
saving roughly 9,500 tokens on every turn, cached. The owner accepts a deliberate trade-off in
exchange:

> "Adding a subagent is now a repo change plus a rebuild, not a file dropped in
> `~/.claude/agents`. That is the intended trade: the previous cost of adding one was zero, which
> is precisely how 97 accumulated."

The same logic was applied, independently, to two adjacent registries:

- **Slash-commands:** 244 pruned to one active command, `dream.md`, via a prune-only reconciler.
  `agentbox/CLAUDE.md`: "Slash-commands get the prune-only sibling... 244 → `dream.md` alone."
- **Skills:** applied pre-emptively, for an explicitly budgetary reason: "the native skill list
  sits in context on every turn, so the always-loaded set is kept small and everything else is
  reached through the router" — 127 skills baked into the image, only 57 always-registered.

A separate, earlier estate-wide skills audit (2026-08-21, a 91-agent Fable-orchestrated Opus
swarm) found 82 findings across the skill corpus and fixed 38 skills — stale infrastructure
endpoints, retired pseudo-user references, superseded model names, and 14 monolithic `SKILL.md`
files split for progressive discovery. This is a second, independent instance of the same
accumulation-then-correction pattern, this time in documentation rather than registration.

**Reading this alongside section 2:** the VisionFlow closeout audit's verdict — "substantially
built and dangerously misdescribed... a failed immune system" — describes the same underlying
pattern from the documentation-truth side that ADR-2092 describes from the registry side.
Capability accumulates faster than the mechanisms that keep it honest, correct and discoverable
across this whole estate, and the owner's own remediation instinct, when applied, is not to
delete capability but to govern its registration (a repo change plus a rebuild, not a free file
drop) and to make the gap between claim and reality visible in a ledger rather than quietly
closing over it.

**Where the cost has been measured**, it is concrete: roughly 9,500 tokens per turn in one
registry alone, plus, more seriously, a period during which the agent that actually ran was
silently not the agent that had been written. **Where it has not yet been measured** — the public
website's overstated claims in section 2, the federation narrative in section 4 — the same
corrective instinct has not yet been applied, and that is the clearest single "close this gap
next" item this audit can offer.

---

## Summary (15 lines)

External value clusters in four places: (1) Resona, a real multi-year commercial negotiation
worth £199,500-£295,500 across staged deliverables, awaiting client sign-off; (2)
campaignbuilder, genuinely live on client production infrastructure (civic-quest, ieepa, contact
"Richard"), blocked only on five administrative items, not engineering; (3) The Monastery
Manchester, an already-delivered charity funding-strategy engagement with a real Garfield Weston
Foundation relationship; and (4) THG Ingenuity plus University of Salford via the UKRI IRIS
Phase 2 bid, the estate's strongest named enterprise-partner evidence, still short a formal
letter of support. Smaller but real: an NHS ACHD residential engagement (£7,500, dated November
2026, pending Trust confirmation), a docBox clinician demonstrator built ahead of an NHS client
brief that had not landed, and ongoing paid Simplilearn TA grading work. The estate's thesis
(VisionFlow README) is that AI collapsing routing costs promotes humans from router to judgment
broker; the three most overstated public claims are cross-org mesh federation (frozen/parked
internally, marketed as integrated), the Judgment Broker's governance UX (the PRD's own
2026-09-14 amendment calls it "cryptographically complete and semantically hollow"), and the
website's Salford/THG "World Record" validation strip (the partners are real, the specific
claims are uncorroborated anywhere in the estate's own honesty ledger). Highest one-cycle
payoff: unblock campaignbuilder's second tenant, pair docBox with the ACHD engagement as one NHS
pitch, productise Pingle's already-working Biodiversity Net Gain pipeline for the live UK
regulatory market, and publish personal-context-portfolio, which needs no external counterparty
at all. AoE has real external pull but it belongs to its upstream open-source community, not to
this estate's integration work; sovereign settlement/sidestr and federation are both internal
architecture preference with no named external stakeholder; Loom has just been put under its own
falsifiable review (PRD-028) that could legitimately simplify or retire much of it. The owner's
own ADR-2092 quantifies the cost of unchecked accumulation precisely: 97 duplicated agents, the
wrong (older, truncated) copy silently winning, roughly 9,500 tokens spent every turn before the
fix, with the deliberate remedy being to make adding capability cost a repo change again, "which
is precisely how 97 accumulated" in the first place.
