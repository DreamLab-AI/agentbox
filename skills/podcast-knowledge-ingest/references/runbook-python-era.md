# Supervised Live Ingest Run — Runbook

> **Rust port note (post-2026-09-02):** `ingest.py` and `promote.py` were
> ported to the `podcast-ingest` and `podcast-promote` binaries in
> [`services/podcast-ingest`](../../services/podcast-ingest) — same CLI
> flags, same byte-compatible ledger/dossier formats, same thresholds and
> algorithms, only the implementation language changed (see that crate's
> module docs for the Python-function → Rust-module mapping). Everything
> below this line is the **historical record** of the live supervised
> Python-era ingest run that shaped the current extraction prompt, ledger
> format, and quality gates (PC-1 through PC-11 etc.) — it correctly
> describes `ingest.py`/`promote.py` because that is what actually ran at
> the time. Read it for the *why* behind the pipeline's current behaviour;
> for how to run the pipeline today, use `podcast-ingest`/`podcast-promote`
> per `SKILL.md`.

Started 2026-08-24 ~05:00 UTC, supervised by Fable (team lead) with Opus reviewers.
Cron `podcast-cron` PAUSED for the duration (restart with `supervisorctl start podcast-cron`).

Pipeline: ingest.py per-episode (`--file`), live graph (`mainKnowledgeGraph/pages`),
assertion-ledger integration (option 4, curated pages never edited).
Loom extraction (qwen3.8-27b, scaffold on, verbatim off) → Perplexity verify → ledger page.

## Objective
Process the backlog episode by episode, reviewing each ledger page with an Opus agent,
adjusting inputs (extraction prompt, thresholds, ledger format) as evidence accumulates.
Maximise durable, high-value, well-linked wisdom entering the graph. No cap.

## Refinement log
(append: episode → observations → input adjustment, if any)

## Batch quality gates
- Every ledger page: wikilinks resolve, no curated page modified, dedup markers present.
- pipeline.validate clean after each batch of ~10.
- Periodic promote.py --dry-run to watch candidacy accumulate across episodes.

### 2026-08-24 ~05:15 — Refinement #1 APPLIED (team lead)
claim-date:: now carries the episode air date (was: ingest run date). Change in
_build_ledger_bullet(+episode_date param) and its write_assertion_ledger call site.
Pages ingested before this fix (episode 1) carry ingest-date in claim-date; the
review mesh flags them; batch re-date deferred until backlog drains.

### 2026-08-24 — Review wave (synthesiser)
Pages reviewed (1): `podcast-evidence___autoresearch-agent-loops-and-the-future-of-work.md`
verdict acceptable.

Defects by kind:
- claim-date-defect (medium): all 11 assertions carry ingest-date 2026-08-24 — a
  pre-Refinement#1 page. Corroborates the standing item and confirms the fix targets
  the right function. episode-date:: 2026-03-10 present → mechanically re-datable.
- internal-date-inconsistency (medium): two tier-1 release claims (L11, L35) say
  "March 7, 2025" in prose while episode-date:: is 2026-03-10 (a daily brief can't
  report a release ~12mo prior). Year conflict must be reconciled BEFORE re-dating,
  else re-dated claim-date 2026-03-10 still contradicts the "2025" in the body.
- weak-source-attribution (low): handle/first-name-only sources — "Heron / Kathy F"
  (L70), "Eric" (L86), "Dan Romero" (L78). Correctly discounted by tier 2-3 /
  conf 0.65-0.82, but source:: implies parity with Karpathy/Cherny primaries.
- transcript-verbatim-hype-in-evidence (low): promo/speculative hype preserved in
  evidence blocks (L64/L88/L96); confined to tier 3 and quoted-as-evidence → acceptable.

Top wisdom:
- Human role in agentic loops shifts to "arena design" — author program.md + build
  the objective evaluator the agent optimises against (L51). Durable, transferable.
- Agentic loops as a "work primitive" beyond software where 3 conditions hold:
  objective score, fast/cheap iteration, low cost of failed attempts (L59). Go/no-go heuristic.
- Binding constraint on multi-agent research = no shared semantic memory for negative
  results → agents redundantly re-explore dead branches (L67). Maps onto our RuVector thesis.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED again this wave. Fix already applied in
   Refinement#1 (episode_date threaded into _build_ledger_bullet). No further code
   change; this page is pre-fix backlog → include in the deferred batch re-date.
2. Re-dating needs a year-reconciliation GUARD, not just a mechanical episode-date
   copy. When an assertion body contains an explicit year that differs from
   episode-date's year, flag for human reconcile (ASR year-error vs wrong episode-date)
   before writing claim-date — otherwise re-dating produces a page whose claim-date
   contradicts its own prose. Applies to the deferred batch re-date tooling.
3. source:: should not imply authority parity. Propose an authority/tier marker on
   the source field (or a `source-authority:: primary|secondary|social`) so
   handle-only commenters are visibly distinct from named primary quotes. Extraction
   prompt could ask the model to classify source authority alongside tier/confidence.

No HIGH-severity systemic defect in 2+ pages this wave → no PROPOSED CHANGES block.

### 2026-08-24 — Review wave #2 (synthesiser)
Pages reviewed (1): `podcast-evidence___beating-the-ai-doom-cycle.md` verdict acceptable.

Defects by kind:
- claim-date-defect (medium): all 13 assertions carry ingest-date 2026-08-24 — another
  pre-Refinement#1 page. episode-date:: 2026-05-26 present → mechanically re-datable.
  ~3-month May→Aug gap makes the mis-dating material for recency/time-series queries.
  No embedded-year conflict this page (unlike wave #1) → clean episode-date copy is safe.
- wikilink-quality (medium): all 29 links resolve (zero dangling) but a large fraction
  are generic single-token pages from naive entity extraction and are semantically wrong
  — [[Model]] [[Base]] (Anthropic pricing), [[REST]] (Meta layoffs), [[Curve]] (doom-cycle),
  [[Logic]] (doom-desperation), [[Value]] [[UMA]] [[API]] (relational-sector). These add
  FALSE edges: resolvable ≠ correct. First occurrence of this kind; watch for a 2nd page.
- factual-error-in-source (low): Eric Schmidt labelled "Google co-founder" (fp 7abf16664efb7c08);
  he was CEO/exec chairman (co-founders: Page, Brin). Error carried uncorrected from transcript.
- possible-asr-entity-names (low): "Alex Emos (Economist)" and "Gloria Cordfield" look
  ASR-mangled, uncorroborated; correctly NOT wikilinked. Verify before entity resolution.
- tier-confidence (low): sane — hard facts tier 1 @0.85-0.95, analysis tier 2 @0.8-0.9,
  speculative tier 3 @0.7-0.75; confidence falls with tier as expected. No issue.
- dedup-markers (low): all 13 assertions carry unique assertion-fp comments. No issue.

Top wisdom:
- "Structural compute shortage" (electricity/memory/chips) is the causal mechanism forcing
  subsidised flat-rate → market-based token pricing; generalises beyond the news items.
- Alex Emos "What Will Be Scarce": the "relational sector" — where provenance of human
  creation is itself the value — rises in proportion to savings from automating origin-agnostic work.
- The "AI doom cycle" 5-stage sentiment frame (skepticism → AI psychosis → doom desperation →
  real-world recalibration → enlightened excitement): reusable lens for AI discourse.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED a 2nd time. Fix is Refinement#1
   (episode_date threaded into _build_ledger_bullet); this page is pre-fix backlog →
   add to the deferred batch re-date. No year-reconcile guard needed here (no embedded year).
2. NEW — generic-token wikilink filter. Naive entity extraction is minting links to
   single-token concept pages ([[Model]]/[[Base]]/[[REST]]/[[Curve]]/[[Logic]]/[[Value]]/
   [[UMA]]/[[API]]) that resolve but are wrong-sense → false graph edges. Propose a
   stop-list / min-specificity gate at link-emission (drop single generic-noun tokens and
   bare acronyms unless multi-token or ontology-matched) AND an extraction-prompt line:
   "prefer NO wikilink over a wrong-sense link; only link named entities/specific concepts,
   never generic single words." Under watch: if a 2nd page shows this it graduates to a
   PROPOSED CHANGES block (systemic).
3. NEW — carry-through of source factual errors ("Google co-founder Eric Schmidt") and
   suspected-ASR names ("Alex Emos", "Gloria Cordfield"). Low severity / correctly unlinked,
   but the Perplexity verify pass should be asked to flag role/title and person-name claims
   for corroboration rather than pass them through verbatim from the transcript.

No HIGH-severity systemic defect in 2+ pages this wave → no PROPOSED CHANGES block.
(wikilink-quality now on watch: recurrence in a 2nd page promotes it to a proposed code change.)

### 2026-08-24 — Review wave #3 (synthesiser)
Pages reviewed (1): `podcast-evidence___bezos-is-back-to-build-ai.md` verdict acceptable.

Defects by kind:
- asr-artefact-entity-names (HIGH): named entities ASR-mangled, and — new this wave —
  TWO land in STRUCTURED fields, so they mint wrong graph identities (not just cosmetic
  quote noise): 'Vic Bajage'->'Vik Bajaj' in the assertion body (L35); 'Professor Ethan
  Malik'->'Ethan Mollick' (Wharton) in BOTH assertion body (L75) AND source:: (L78).
  Quote-embedded too: 'Mirror Morati'->'Mira Murati' (L72), 'Ilia Sutskaver'->'Ilya
  Sutskever' (L72), probable 'Rohit Mita' (L86/88, verify). First page where ASR mangling
  hits a structured/source field rather than verbatim-quote — escalates wave #2's low
  possible-asr-entity-names to a graph-identity risk.
- false-positive-wikilinks (medium): all 22 links resolve (check #1 passes) but many are
  concept-matcher false positives injecting wrong edges — L19 tags an AI-for-manufacturing
  claim with [[URI]] [[Privacy Engineering]] [[Raft]]; L83 [[URI]]; L91 (Bezos mgmt
  philosophy) [[GAN]] [[AI Upscaling and Super-Resolution]] [[GAN]] (irrelevant AND
  [[GAN]] duplicated); L67 generic [[Safe]] where 'Safe Superintelligence' (the company)
  is meant. SECOND consecutive page of resolvable-but-wrong-sense links → the wave #2 watch
  trips: this graduates to a PROPOSED CHANGES block (systemic).
- transcript-verbatim-hype (low): jokey/hype verbatim as evidence — L112 Mary G's "Bezos
  couldn't even make it 3 years... Hold my 6 billion" (tier 3); "shiny chatbots" /
  "boring trillion dollar layer" (L83/88). Contained by tier-3/2 + confidence tags.
- dating-defect — NON-DEFECT / POSITIVE: the claim-date==ingest-date defect did NOT manifest.
  episode-date:: 2025-11-20 present, ingest-date:: 2026-08-24 distinct, and every
  claim-date:: is 2025-11-20 (episode date, not ingest date). FIRST post-Refinement#1 page
  seen by the mesh → confirms the _build_ledger_bullet fix works end-to-end. Dedup markers
  on all 13 blocks; tier (1/2/3) + confidence (0.95→0.55) well-graduated.

Top wisdom:
- Durable thesis (L99, tier 3): "First wave was models; next wave is whoever wires them into
  the real economy" — structural claim about AI moving from digital capability to physical/
  industrial integration; outlives any single funding round. Highest-value assertion.
- Org insight (L91, tier 2): Bezos's 2010s "scale without losing agility" playbook may be
  obsolete for AI-native orgs that stay deliberately small to capture AI productivity gains.
- Alignment tradeoff (L75, tier 2): Grok 4.1 cuts harmful responses while raising sycophancy
  and deception — harm-reduction and honesty are not co-monotonic (attributed to Ethan
  Mollick, name mangled → see HIGH defect).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement#1 now VERIFIED in production on a post-fix page
   (correctly episode-dated). Standing item can be considered closed for post-fix pages;
   the deferred batch re-date still owes the pre-fix backlog (waves #1/#2).
2. ASR entity names now reach STRUCTURED fields (assertion body + source::), not just quotes
   → graph-identity risk. Propose the Perplexity verify pass gain an entity-name normalisation
   step that corrects person/org names in structured fields (assertion body, source::) against
   episode facts BEFORE ledger write, and leaves verbatim quotes untouched (or [sic]-flags
   them). This is stronger than wave #2's "flag for corroboration" — structured-field names
   must be corrected, not just flagged, or they mint durable wrong identities.
3. Add a proper [[Project Prometheus]] page (only [[Prometheus]] resolves) and entity pages
   for corrected people (Vik Bajaj, Ethan Mollick, Mira Murati, Ilya Sutskever) so claims
   attach to stable identities rather than generic tags.

### 2026-08-24 — Review wave #4 (synthesiser)
Pages reviewed (1): `podcast-evidence___black-friday-gpt.md` verdict acceptable.

Defects by kind:
- wikilink-homonym-collision (HIGH): THIRD consecutive page of resolvable-but-wrong-sense
  links — this variant is the acronym/homonym subclass. Three bare-acronym links resolve to
  a real but semantically unrelated page: [[Rsa]] (OpenAI shopping-UX claim) → Rsa.md = the
  RSA public-key cryptosystem; [[Tor]] (Alphabet/Nvidia market-cap claim) → Tor.md = the Tor
  onion-routing network; [[REST]] (HP-layoffs claim) → REST.md = the REST API style. None
  relate to their host claim → false edges onto unrelated ontology nodes. Note [[REST]] is a
  REPEAT of the same wrong link seen in wave #2. This is exactly the class PC-1's min-specificity
  gate targets (bare acronym, single token, not the entity meant) → reinforces PC-1, does not
  open a new PC.
- weak-generic-wikilinks (low): near-noise generic links add little graph value — [[performance]]
  (lowercase), [[Dynamics]], [[Process]], [[Metrics]]; the Nvidia stock-drop claim is tagged
  [[Semiconductor Industry]] [[Dynamics]] [[performance]] where the last two are ~noise. Same
  generic-token class PC-1 already covers (drop or replace with specific concepts, e.g. [[Nvidia]]
  / [[Stock Market]]).
- thin-source-as-assertion (low): tier-3 UBI/AI-regulation claim (assertion-fp d2f08b6c…) sourced
  solely to an anonymous tweet ('Elections Joe on Twitter'), promoted to a first-class assertion.
  Confidence 0.6 is appropriately low, but single-tweet provenance reads as durable signal.
- dating-defect — NON-DEFECT / POSITIVE: claim-date==ingest-date defect did NOT manifest.
  episode-date:: 2025-11-27 present, ingest-date:: 2026-08-24 distinct, every claim-date:: is
  2025-11-27 (= episode date). SECOND post-fix page correctly dated → Refinement #1 continues to
  hold in production. Use as a clean reference example when re-dating pre-fix backlog pages.

Top wisdom:
- Durable ML insight (tier 1): OpenAI used RL to train a specialised GPT-5 Mini for product
  research that beat the full-size GPT-5 Thinking on internal accuracy benchmarks — a concrete
  data point for task-specific RL distillation outperforming a larger general model.
- Structural signal (tier 2): Google TPUs emerging as a credible Nvidia-GPU alternative (Gemini 3
  reportedly TPU-trained; Meta reportedly evaluating purchases) — semi-durable industry-structure
  shift, outlasts the 6% intraday stock move it sits beside.
- Operating principle (tier 3, HP CEO Enrique Lores): agentic-AI productivity comes from redesigning
  business processes ground-up, not bolting AI onto existing workflows.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 VERIFIED on a 2nd post-fix page (correctly episode-dated);
   remains closed for post-fix pages. Deferred re-date still owes the pre-fix backlog (waves #1/#2).
2. PC-1 reinforced by a 3rd page (acronym/homonym subclass: [[Rsa]]/[[Tor]]/[[REST]], with [[REST]]
   a wave-#2 repeat). Strengthen the PC-1 extraction-prompt line and gate to name short crypto/network/
   protocol acronyms explicitly, and add an entity-resolution guard that suppresses auto-linking to
   short-acronym target pages (≤4 chars, single token) unless ontology-matched — this would have
   caught all three collisions at emission.
3. Add a provenance-quality signal: mark single-tweet / anonymous-social sources on the assertion so
   they are not mistaken for analyst/institutional signal (e.g. a `provenance:: social-single` field,
   or demote such tier-3 claims below the promotion threshold). Evidence is one page so far → watch,
   not yet a PC.

No NEW HIGH-severity systemic defect opening a fresh PC this wave; the HIGH finding is an
existing-PC-1 recurrence (now 3 pages) → PC-1 updated below.

### 2026-08-24 — Review wave #5 (synthesiser)
Pages reviewed (1): `podcast-evidence___can-open-models-solve-corporate-ai-washing.md` verdict good.

Defects by kind:
- NONE HIGH. No wrong-sense/homonym links this page → PC-1 collision streak (waves #2/#3/#4) breaks
  at 3. Clean page.
- asr-model-name-artefact (low, NEW observation): L99 asserts "Kimmy K3" — an ASR mishearing of
  "Kimi K2" (Moonshot's open model). Model/version names are the highest-risk ASR tokens (proper
  noun + digit) and silently enter assertions as fact. Fix on the page: "Kimmy K3" → "Kimi K2".
  One page so far → watch, not yet a PC.
- wikilink-casing-fragmentation (low, PC-1 adjacent): [[Enterprise Ai]] uses sentence-case "Ai"
  and fragments the concept away from sibling [[Enterprise AI Adoption]] and the correct "AI"
  casing used elsewhere. Not a wrong-sense edge (PC-1's HIGH class) but the same entity-resolution
  weakness — a canonical-casing normaliser at link emission would fold [[Enterprise Ai]] →
  [[Enterprise AI]] and could consolidate with [[Enterprise AI Adoption]]. Reinforces PC-1's
  entity-resolution arm as a casing subclass; one page → watch.
- dating-defect — NON-DEFECT / POSITIVE: claim-date already == episode-date on this page; reviewer
  confirms no re-date needed. THIRD post-fix page correctly dated → Refinement #1 continues to hold.
  If the batch re-dating pass keys off episode-date::, this page is already compliant → skip it.

Top wisdom:
- Durable strategic framing (tier 1, Alex Karp): "AI sovereignty" — organisations increasingly
  demand maximal control over their data, prompts, and business intelligence ("their alpha") rather
  than hand model labs the keys to their institutions. Outlives any single Palantir earnings print.
- Named risk pattern (tier 1, Julie Averill): "AI washing" — a company under results pressure
  claiming to do more with AI than it actually does, often masking layoffs that really free cash to
  spend on AI. The page's titular, durable, named concept.
- Directional signal (tier 2, KPMG symposium): enterprise-AI conversation has shifted from counting
  use cases to governance, cost provisioning, and model routing — a durable read on where enterprise
  AI capability is heading, distinct from the ephemeral earnings/pricing facts around it.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 VERIFIED on a 3rd post-fix page; remains closed for
   post-fix pages. Deferred re-date still owes only the pre-fix backlog (waves #1/#2).
2. Extend PC-1's entity-resolution arm with a canonical-casing normaliser: before emitting a
   wikilink, fold the target to its canonical page casing (e.g. "Enterprise Ai" → "Enterprise AI")
   and prefer an existing sibling page ("Enterprise AI Adoption") over minting a near-duplicate.
   Casing subclass of the PC-1 entity-resolution guard; one page → watch, folds into PC-1 if it
   recurs, no separate PC yet.
3. ASR proper-noun/model-name guard (NEW watch): flag or low-confidence-tag assertions whose subject
   is a model/product version string (proper noun + digit, e.g. "Kimmy K3") that fails a known-model
   lookup, and add an extraction-prompt line noting model version names are host-transcribed and
   should be verified where possible. One page → watch, not yet a PC.

No NEW HIGH-severity systemic defect this wave (a clean page) → no new PROPOSED CHANGE block; the two
low findings both reinforce PC-1's entity-resolution arm (casing subclass) and are logged as watches.

### 2026-08-24 — Review wave #6 (synthesiser)
Pages reviewed (1): `podcast-evidence___can-todays-ai-replace-12-of-work.md` verdict acceptable.
All 23 wikilinks resolve; 11 assertions carry source::/evidence::/assertion-fp; tiers monotonic
(t1 0.92-0.98, t2 0.85-0.90, t3 0.60-0.65).

Defects by kind:
- wikilink-mislink (MEDIUM, PC-1 wrong-sense arm, 2 edges): [[Ansi]] (L35) on the "27% would not
  have been done otherwise" claim — source is the Anthropic Economic Index, so target should be
  [[Anthropic]] or [[AI Adoption]]; "Ansi" is an ASR/entity artefact. [[Solid]] (L91) on the
  employment-displacement claim points at the web-decentralisation protocol page — should be
  [[Economics]] or [[AI-Driven Workforce Displacement Registry]]. Both pass ls-existence but inject
  false edges → straight PC-1. NB severity is MEDIUM here, not HIGH: both are multi-token-context /
  proper-noun collisions rather than the bare-acronym crypto/network homonyms that drove wave #4's
  HIGH findings.
- asr-into-wikilink (NEW cross-link, PC-1 × wave-#5 ASR watch): [[Ansi]] is not a generic-noun or
  casing miss — it is ASR corruption of "Anthropic" that has leaked past prose into a *wikilink*
  (same page carries "cloud code"→"Claude Code" L48 and garbled "snip check on correctness" L64 in
  evidence:: quotes). This is the wave-#5 ASR proper-noun watch (Kimmy K3→Kimi K2) reappearing, now
  as a graph edge rather than an in-prose fact → the two watches merge: ASR-corrupted proper nouns
  are the same failure whether they land in an assertion or a link target. Second page of ASR
  proper-noun corruption → watch strengthens but still short of its own PC; folds into PC-1's
  entity-resolution arm for the link-target half.
- asr-artefact-in-evidence (low, tolerable): L48 "cloud code"→"Claude Code", L64 "snip check on
  correctness" garbled — inside evidence:: transcript quotes, correctly flagged as verbatim ASR, so
  acceptable-but-noisy. Only actionable where it leaks into an entity/link (the [[Ansi]] case above).
- dating-defect — NON-DEFECT / POSITIVE: claim-date == episode-date (2025-12-05, ≠ ingest-date
  2026-08-24) on every assertion; episode-date:: present. FOURTH post-fix page correctly dated →
  Refinement #1 holds. Skip in any batch re-date pass.

Top wisdom:
- Durable conceptual guardrail (t1, 0.98): the MIT "Project Iceberg" index measures technical-skill
  OVERLAP with AI capability and explicitly does NOT estimate job loss, workforce reductions,
  adoption timelines, or net employment — the framing that survives the 11.7% / $1.2T headline.
- Durable economic reasoning (t2): skill automation ≠ job loss because a job is a bundle of skills;
  adaptation reallocates time to non-automatable skills — with the t3 counter that aggregate role
  counts can still fall as freed workers absorb the freed tasks themselves.
- Durable behavioural pattern (t2): engineers build "AI-delegation intuitions" via a trust
  progression — delegate easily-verifiable tasks first, escalate as correctness-checking confidence
  grows — more lasting than the ephemeral 60%-usage / 50%-productivity survey figures.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 VERIFIED on a 4th post-fix page; remains closed for
   post-fix pages. If confirming the one-line ingest fix: in ingest.py `_build_ledger_bullet`, set
   `claim-date::` from the episode date, i.e. `claim_date = episode_date` (fall back to ingest_date
   only when episode_date is absent) rather than defaulting to the ingest timestamp. Deferred re-date
   still owes only the pre-fix backlog (waves #1/#2).
2. Merge the wave-#5 ASR proper-noun/model-name watch with this wave's asr-into-wikilink finding into
   a single watch: "ASR-corrupted proper nouns" (Kimmy K3→Kimi K2, Ansi→Anthropic). Extraction-prompt
   line: verify proper nouns and model/product version strings against a known-entity lookup before
   using them as an assertion subject OR a wikilink target; never mint a link to an unverified
   short/proper-noun token. The link-target half folds into PC-1's entity-resolution arm; two pages
   now → still a watch, not yet its own PC.

No NEW HIGH-severity systemic defect this wave (the two mislinks are MEDIUM PC-1 recurrences, not a
new class) → no new PROPOSED CHANGE block; findings reinforce PC-1 (now wave #2/#3/#4/#6) and merge
the ASR proper-noun watch across waves #5/#6.

### 2026-08-24 — Review wave #7 (synthesiser)
Pages reviewed (1): `podcast-evidence___ceo-led-ai-gets-3x-the-roi.md` verdict acceptable.
All 34 wikilinks resolve (literal-space filenames verified); 12 assertions carry dedup markers;
tiers monotonic (t1 0.95-0.98, t2 0.75-0.90, t3 0.60-0.65).

Defects by kind:
- wikilink-mislink (MEDIUM, PC-1 wrong-sense arm, ~5 edges): [[Tor]] on a Micron memory/
  supply-chain claim (Tor = anonymity net; REPEAT of wave #4's [[Tor]] homonym); [[URI]] on a
  KPMG survey claim (REPEAT of wave #3's [[URI]]); [[GAN]] on the CEO-accountability/ROI claim
  (REPEAT of wave #3's [[GAN]]); and [[Neuroimaging]] on TWO KPMG business-survey claims (L43,
  L51 — keyword/ASR collision, nonsensical on a survey stat). All resolve structurally but inject
  false edges → straight PC-1. Three of the four wrong targets ([[Tor]]/[[URI]]/[[GAN]]) are
  bare-acronym/short-token collisions already named in PC-1's short-acronym guard — this wave is
  further evidence that guard would have caught them at emission.
- garbled-entity-name in source:: (MEDIUM, ASR proper-noun watch, structured field): source::
  L78 reads 'Ashwin Goel / Mark Andreessen Horowitz' — 'Mark Andreessen Horowitz' is an
  entity-merge of 'Marc Andreessen' with the firm 'Andreessen Horowitz' (a16z). Third page where
  ASR/merge corruption reaches a STRUCTURED field (wave #3: Vik Bajaj/Ethan Mollick in body+source;
  wave #6: Ansi→Anthropic in a link target) → the ASR-proper-noun watch continues to land in
  fields that mint durable wrong identities, not just quotes. Fix on page: 'Marc Andreessen /
  Andreessen Horowitz (a16z)'.
- implausible-figures (MEDIUM, NEW observation): Micron assertion (L19) carries '445% YoY revenue
  growth', 74% QoQ, and gross margin '56%→86%' at confidence 0.98. 445% YoY and an 86% memory-maker
  gross margin are wildly implausible → look like garbled extraction (44.5%? margin transposition?),
  yet ride tier-1 0.98 confidence unverified. First page of quantitative-implausibility → watch:
  numeric outliers should be down-confidenced or flagged, not carried at 0.98. One page → not yet a PC.
- verbatim-quote-hype (low, tolerable): evidence:: leans on transcript hype ('insatiable',
  'largest distillation attack ever detected', 'shadow data pipeline') — all attributed to named
  speakers and quoted-as-evidence → acceptable-but-promotional. Same tolerable class as prior waves.
- dating-defect — NON-DEFECT / POSITIVE: reviewer confirms claim-date:: == episode-date:: 2026-06-25
  (≠ ingest-date 2026-08-24) on every assertion. FIFTH post-fix page correctly dated → Refinement #1
  holds. Skip in any batch re-date pass.

Top wisdom:
- Durable org-design insight (t1, titular): CEO accountability triples AI ROI — orgs with clear CEO
  accountability for AI strategy are 3x more likely to report established ROI (14% vs 4% where the CEO
  is less/not accountable, KPMG Pulse). Highest-value assertion on the page.
- Durable strategic principle (t2): agentic AI creates structural vendor lock-in — once an agentic
  system holds extensive org permissions/context, switching cost becomes prohibitive ('convenience
  until you try to cancel'). A lasting data/context-portability warning, not ephemeral news.
- Durable change-management signal (t2): executive optimism is outrunning workforce readiness — US
  employee resistance to AI agents rose 5% to 20% while 71% of executives report good progress toward
  an integrated AI-human workforce.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 VERIFIED on a 5th post-fix page; remains closed for
   post-fix pages. Confirmed one-line ingest fix (restate for the record): in ingest.py
   `_build_ledger_bullet`, set `claim_date = episode_date` (fall back to ingest_date only when
   episode_date is absent) rather than defaulting to the ingest timestamp. Deferred re-date still owes
   only the pre-fix backlog (waves #1/#2).
2. PC-1 reinforced a 4th HIGH/MEDIUM-recurrence time (now waves #2/#3/#4/#6/#7): [[Tor]] (repeat of
   #4), [[URI]] and [[GAN]] (repeats of #3), plus [[Neuroimaging]]×2. The short-acronym guard +
   min-specificity gate already specified would have suppressed [[Tor]]/[[URI]]/[[GAN]] at emission;
   [[Neuroimaging]] is a multi-token wrong-sense collision the ontology-match arm should reject
   against the host claim's sense. No new PC — folds into PC-1 (header updated).
3. ASR-proper-noun watch merges this wave's source:: merge-artefact ('Mark Andreessen Horowitz') with
   the wave-#3/#6 structured-field cases. Now 3 pages of ASR corruption in STRUCTURED fields →
   escalating toward its own PC: propose the Perplexity verify pass gain an entity-name normalisation
   step that corrects/`[sic]`-flags person/org names in assertion body + source:: (not verbatim quotes)
   against episode facts before ledger write. Three pages now — recommend graduating to a PROPOSED
   CHANGE next recurrence.
4. NEW watch — numeric-implausibility guard. Assertions with extreme numeric outliers (e.g. >200%
   YoY growth, >80% gross margin for hardware) should be auto-down-confidenced and flagged for verify,
   not carried at 0.98. One page → watch, not yet a PC.

No NEW HIGH-severity systemic defect opening a fresh PC this wave (the mislinks are MEDIUM PC-1
recurrences, not a new class) → no new PROPOSED CHANGE block; findings reinforce PC-1 (now
waves #2/#3/#4/#6/#7) and advance the ASR-structured-field watch to 3 pages.

### 2026-08-24 — Review wave #8 (synthesiser)

Pages reviewed: 1 — `podcast-evidence___chatgpt-55-rumors-start-to-bubble.md` (verdict: acceptable).

Defects by kind:
- wikilink-spurious (MEDIUM, PC-1 recurrence): L27 (Anthropic Labs incubator claim) tagged [[GAN]] —
  page resolves but is a hallucinated wrong-sense edge (nothing concerns generative adversarial nets),
  mis-connecting the Anthropic org node to an unrelated ML-technique node. [[GAN]] now a THREE-wave
  repeat (#3/#7/#8) → the highest-frequency single wrong-sense target in the run. Fix on page: drop
  [[GAN]], repoint to [[Organizational Change]]/[[Innovation]] (already used elsewhere).
- wikilink-duplicate (low, PC-1 dedup recurrence): L67 (DeepSeek V4) carries [[Model]] twice
  ('[[Model]] [[Context Window]] [[Model]]'). Repeat of the wave-#3 double-emit class ([[GAN]]×2);
  the in-block de-dup step already specified under PC-1 covers it.
- wikilink-imprecise (MEDIUM, NEW flavour of PC-1 — resolves-correctly-but-imprecise): [[OpenAI API]]
  used as a proxy for OpenAI-the-organisation across L11/19/59/83/91 (memo, code red, hardware device,
  model rumours, social-media silence). These are org-level facts, not API facts, and an 'OpenAI
  Research Organisation' page EXISTS as the correct target. Distinct from the usual PC-1 case (generic/
  homonym token): here the surface form is a real multi-token entity but the WRONG granularity —
  API-vs-org. Degrades precision rather than injecting a nonsense edge. Repoint the five tags to the
  org page; reserve [[OpenAI API]] for genuine API claims.
- asr-artefact-in-assertion (low, ASR-proper-noun watch): hardware codename 'Sweet Pee' (L59) is an
  ASR mangling carried verbatim INTO the assertion prose as authoritative. Notably this page shows the
  GOOD pattern elsewhere — 'Sam Alman'/'sessation'/'chatbt'/'Vio'/'DeepSseek'/'GBT 53'/'Daario' are
  correctly confined to verbatim evidence quotes and normalised in the assertion body — the codename
  is the one leak. Unlike waves #3/#6/#7 this is the assertion BODY, not a structured field, so it does
  not mint a durable wrong identity in a link/source target; lower blast radius. Fix on page: 'codenamed
  (reported as) Sweet Pee' / [sic]-flag rather than stating as fact.
- tier-inflation (MEDIUM, NEW observation): L59 (Sweet Pee hardware leak, sourced to an anonymous
  Chinese electronics blogger) and L67 (DeepSeek V4 mid-Feb release, an unshipped future date) are both
  marked tier:: 1 at confidence 0.85. A single-sourced supply-chain leak and a future release rumour are
  speculative — tier 2/3 grade, not tier-1 fact, and 0.85 is high for rumour provenance. Pairs with
  wave #7's numeric-implausibility finding (445% YoY at 0.98) as the SAME underlying gap: provenance
  strength not propagating into tier/confidence. Now 2 pages → see watch #3 below.
- claim-date — NON-DEFECT / POSITIVE: every claim-date:: == episode-date:: 2026-01-15 (≠ ingest-date
  2026-08-24); episode-date:: present and internally consistent with content ('this new 2026 year',
  'most important model release of 2025', October memo). SIXTH post-fix page correctly dated →
  Refinement #1 holds; skip in any re-date pass.

Top wisdom:
- Durable org-design thesis (t1, Daniela Amodei, L75/80): 'The speed of advancement in AI demands a
  different approach in how we build, how we organize, and where we focus' — a lasting framing of why
  frontier labs restructure into experimental incubators, outlives the news cycle.
- Durable strategic-behaviour signal (t?, OpenAI 'code red', L19): an incumbent pausing ancillary
  product work to concentrate resources on core models under credible-rival pressure — durable pattern
  of how leaders respond to competition, well beyond this week.
- Durable structural fact (DeepSeek quant fund, L43): the associated hedge fund returning 57% explains
  the self-funding compute model behind DeepSeek — more explanatory and durable than the ephemeral V4
  release-date rumour on the same page.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 VERIFIED on a 6th post-fix page; remains closed for
   post-fix pages. One-line ingest fix unchanged (restate for the record): in ingest.py
   `_build_ledger_bullet`, set `claim_date = episode_date` (fall back to ingest_date only when
   episode_date is absent). Deferred re-date still owes only the pre-fix backlog (waves #1/#2).
2. PC-1 reinforced (now waves #2/#3/#4/#6/#7/#8): [[GAN]] (third occurrence, #3/#7/#8), [[Model]]×2
   duplicate (#2/#8). Adds a NEW sub-case: resolves-correctly-but-wrong-granularity ([[OpenAI API]]
   proxying the org when an 'OpenAI Research Organisation' page exists). The min-specificity/short-
   acronym guards catch [[GAN]]; the in-block de-dup catches [[Model]]×2; the org-vs-API case needs the
   ontology-match arm to prefer the more specific existing entity page over a related-but-broader one.
   Folds into PC-1 (header + granularity note updated). No new PC — MEDIUM recurrence, not a new class.
3. provenance-confidence calibration watch — ADVANCED to 2 pages (#7 numeric-implausibility 445% YoY @
   0.98; #8 tier-inflation on single-source rumour @ tier1/0.85). Common gap: source strength (anonymous/
   single-source/unshipped-future) is not down-weighting tier or confidence. Proposal when it recurs to a
   3rd page (graduate to a PROPOSED CHANGE): in the verify/scoring pass, cap tier and confidence by a
   provenance grade — single-source/anonymous/leak/future-date → tier ≤2 and confidence ≤~0.6, and flag
   for corroboration. Two pages now → watch, not yet a PC.
4. ASR-proper-noun watch — this wave's 'Sweet Pee' is an assertion-BODY leak (lower blast radius than the
   structured-field cases in #3/#6/#7), and the page otherwise demonstrates the desired normalise-in-body/
   verbatim-in-quotes pattern. Does not add to the 3-page structured-field count that would graduate the
   entity-name-normalisation PROPOSED CHANGE; reinforces that the normalisation step should also sweep
   product/hardware CODENAMES in the assertion body, not only person/org names.

No NEW HIGH-severity systemic defect this wave (all findings MEDIUM/low: PC-1 recurrences + a 2nd
provenance-confidence page) → no new PROPOSED CHANGE block. Findings reinforce PC-1 (now
#2/#3/#4/#6/#7/#8, +org-vs-API granularity sub-case) and advance the provenance-confidence watch to 2 pages.

### 2026-08-24 — Review wave #9 (synthesiser)
Page: podcast-evidence___claude-code-is-now-writing-claude-code.md — verdict acceptable.

Defects by kind:
- wikilink-semantic-mislink (HIGH, PC-1 recurrence — now 7 pages): SIX resolves-but-wrong-sense
  links on one page. Two flavours: (b) wrong-sense homonym — 'new abstraction layer of stochastic AI
  agents' → [[Hardware Abstraction Layer]] (OS/hardware sense), 'agents operate autonomously for days'
  → [[Robot Autonomy]] (robotics domain); and a NEW sub-case (d) ASR/entity-COLLISION mislink — a valid
  target page reached via a garbled/collided surface form: 'Digital Bridge' (SoftBank PE deal) → [[Git]],
  Nvidia $5B EQUITY stake in Intel → [[NVIDIA H200]] (a GPU-product page), OpenAI off-Luxshare
  contract-manufacturing → [[Additive Manufacturing]] (3D printing), '90% of code' pundit forecast →
  [[Conformal Prediction]] (ML calibration). Sub-case (d) is distinct from (a)/(b): the surface token is
  itself an entity but resolves to an unrelated real page (finance/GPU/3D-print/stats homonym), so the
  min-specificity + short-acronym guards do NOT catch it — only the ontology-match-against-host-claim-
  sense arm rejects it. Retag map: [[Git]]→[[Private Equity]]; [[Conformal Prediction]]→drop (link
  [[Software Development]] only); [[Additive Manufacturing]]→[[Supply Chain]]; [[Hardware Abstraction
  Layer]]→[[AI Agents]]/[[Abstraction]]; [[Robot Autonomy]]→[[Agentic Workflow]]; [[NVIDIA H200]]→
  [[NVIDIA]]/[[Intel]]. Folds into PC-1 (header + sub-case (d) added).
- asr-garbled-source-attribution (MEDIUM → GRADUATES entity-name-normalisation to PC-2): source:: field
  reads 'Ethan Malik' = Ethan Mollick (Wharton), ASR-garbled in a STRUCTURED metadata field. This is the
  4th structured-field ASR page (after #3/#6/#7) and the recurrence wave #7 said would graduate the
  watch → now written up as PC-2 below. (Body garbles 'Daario Amade'=Amodei, 'Lux share'=Luxshare sit
  inside verbatim quotes → tolerable, note as ASR artefacts so re-ingest does not mint new entities.)
- hype-overreach-from-hedged-quote (MEDIUM, NEW watch): tier-3 assertion states as fact 'Developers who
  fail to adopt... [have] a skill issue that limits their potential productivity by a factor of 10' —
  the evidence shows Karpathy's explicitly hedged first-person musing ('I have a sense that I could be
  10x more powerful'). The assertion converts a first-person 'I have a sense' into a hard general claim.
  Distinct from the prior low-severity verbatim-hype-in-EVIDENCE findings: here the hardening is in the
  ASSERTION text itself. Fix on page: 'Karpathy speculates he could be ~10x more productive...'. One
  page → watch (see proposal #3).
- weak-assertion-quality (low): tier-2 '90%-of-code prediction was only off by a couple months, as
  evidenced by Claude Code's current capabilities' — the 'as evidenced by' clause is editorial inference,
  not sourced fact; low-durability news-commentary.
- claim-date — NON-DEFECT / POSITIVE: every claim-date:: == episode-date:: 2026-01-03 (≠ ingest-date
  2026-08-24); episode-date:: present. SEVENTH post-fix page correctly dated → Refinement #1 holds; skip
  in any re-date pass.

Top wisdom:
- Karpathy (t2): the software-engineering profession is being refactored around a new programmable
  abstraction layer of stochastic, failable AI agents that must be mastered alongside classical
  engineering — the single most durable, portable insight on the page (rest is dated financial/infra news).
- Boris Cherny (t1): 100% of the Claude Code creator's own 30-day contributions (259 PRs, 497 commits,
  ~78k lines) were written by Claude Code in Opus 4.5 — a concrete, well-sourced milestone of the
  self-authoring inflection, durable as a datapoint even as the raw numbers age.
- Cherny (t3): coding agents now run coherently for 'minutes, hours, and days at a time' — a crisp
  autonomy-duration inflection signal, more durable than the surrounding compute/funding headlines.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 VERIFIED on a 7th post-fix page; remains closed for post-fix
   pages. One-line ingest fix unchanged (for the record): in ingest.py `_build_ledger_bullet`, set
   `claim_date = episode_date` (fall back to ingest_date only when episode_date is absent). Deferred
   re-date still owes only the pre-fix backlog (waves #1/#2).
2. PC-1 reinforced a 7th page + gains sub-case (d) ASR/entity-COLLISION mislink (surface token is a real
   entity but collides onto an unrelated real page — Digital Bridge→Git, Intel-stake→NVIDIA H200). Unlike
   (a)/(b), the specificity/acronym guards miss (d); only the ontology-match-against-host-sense arm rejects
   it. Header + sub-case updated; no new PC — folds into PC-1.
3. ASR-structured-field watch GRADUATES to PC-2 (entity-name normalisation in the verify pass): 4th
   structured-field page (source:: 'Ethan Malik'→'Ethan Mollick'), which is the recurrence wave #7
   flagged as the graduation trigger. Written up below.
4. NEW watch — assertion-hardening-of-hedged-speech: converting a first-person hedge ('I have a sense
   I could be 10x') into a general factual claim about all developers. Distinct from verbatim-hype-in-
   evidence (that stays in quotes; this leaks into the assertion). One page → watch; if a 2nd page shows
   an assertion asserting-as-fact what the evidence hedges, propose an extraction-prompt line: "Preserve
   the speaker's epistemic stance — render first-person/hedged musings ('I have a sense', 'I could') as
   speculation attributed to the speaker, never as general fact."

This wave DID surface a graduation trigger → PC-2 opened below (entity-name normalisation). PC-1 header
extended to waves #2/#3/#4/#6/#7/#8/#9 with new sub-case (d).

### 2026-08-24 — Review wave #10 (synthesiser)
Pages reviewed (2): `podcast-evidence___claude-code-turns-one.md` (acceptable),
`podcast-evidence___context-graphs-ais-next-big-idea.md` (acceptable).

Defects by kind (both pages reinforce standing PC-1 + PC-2; no new PC class):
- wikilink-semantic-mislink (HIGH on page 1, MEDIUM on page 2 — PC-1 recurrence, now 9 pages): all links
  resolve on disk but attach the wrong sense. Page 1 (4): [[ReAct]] on a market "reaction" (ReAct = the
  Yao-2022 reasoning/acting paradigm), [[Tor]] on a Cloudflare sell-off, [[ROS]] on OpenAI margin
  ("return on sales" ≠ Robot Operating System), [[SEC]] on hardware secrecy (matched "secretive" ≠
  Securities & Exchange Commission). Page 2 (4): [[Tor]] (knowledge-graph "informed walkers"), [[GAN]]
  (context-engineering), [[UMA]] ("uniquely human" → crypto oracle), [[Robot Autonomy]] (software-agent
  autonomy → robotics drift). NEW MECHANISM NOTE for PC-1: page 1's misses are driven by acronym-
  EXPANSION / substring matching, not whole-token homonymy — 'return on sales'→[[ROS]], 'secretive'→
  [[SEC]], 'reaction'→[[ReAct]]. The acronym string is NOT present verbatim in the source; the linker
  synthesised it. This is a tighter, catchable signal than (b): reject an acronym-titled target whenever
  the acronym does not appear as a literal token in the block. Cross-wave repeats reinforced: [[Tor]]
  (#4,#7,#10), [[GAN]] (#3,#7,#8,#10 — most frequent), [[UMA]] (#2,#10). Retag: [[ReAct]]/[[Tor]]/
  [[ROS]]/[[SEC]] → drop or → OpenAI-org / market pages; [[GAN]]→drop; [[UMA]]→drop; [[Robot Autonomy]]→
  [[Agent]]/[[Human Agency and Oversight]]. Also sub-case (c) again: [[OpenAI API]] proxying the OpenAI
  ORGANISATION on company-level claims (ARR, 910M WAU, hardware) — repeat of #8/#9; prefer an OpenAI-org page.
- asr-garbled-source-attribution (MEDIUM, PC-2 recurrence — 5th & 6th structured-field pages): source::
  fields carry ASR-corrupted proper nouns. Page 1: 'Boris Churnney'→Boris Cherny, 'Kenton Varta'→Kenton
  Varda, 'Johnny Ives'→Jony Ive, 'Lovefront'→LoveFrom, 'Buco Capital'/'Buo'→Buccocapital. Page 2: 'Jamine
  Ball'→Jamin Ball (Altimeter), 'Aaron Levy'→Aaron Levie (Box CEO). These are load-bearing provenance
  fields → exactly PC-2's target. Body/evidence garbles ('chat GBT'=ChatGPT, 'octa'=Okta, 'shephering',
  'Cloud Code Security'=Claude Code Security) stay inside verbatim quotes → tolerable, flag as ASR so
  re-ingest mints no new entities. Reinforces PC-2's known-people normalisation dictionary.
- claim-date — NON-DEFECT / POSITIVE (8th & 9th post-fix pages): page 1 claim-date:: == episode-date::
  2026-02-26; page 2 == 2026-01-06; both ≠ ingest-date 2026-08-24, both episode-date:: present.
  Refinement #1 holds; skip both in any re-date pass.
- ephemeral-news-dominates (low, recurring on daily-brief episodes): page 1 is mostly time-stamped news
  (Claude Code $2.5B ARR, OpenAI $282.5B-by-2030, 910M WAU, 'Garlic'/GPT-5.3 rumor) — correctly tiered
  (rumor tier-3, conf 0.5-0.55) but low durable-wisdom density. Standing property of news-format shows,
  not a defect; no action.
- transcript-verbatim-in-evidence (low): raw ASR retained inside evidence:: quotes ('fungeable',
  'broaderbased', 'shephering', run-on casing) — acceptable as verbatim; optionally [sic]-tag so they
  are not mistaken for ledger errors. Do not let them leak into assertion bodies or entity names.

Top wisdom:
- Anthropic API analysis (t1, conf 0.95): ~50% of all tool calls are software-engineering — AI coding is
  the dominant LLM use case "and it's not close". Most durable structural insight of the wave.
- Context-graph primitive (page 2, t-durable): a "context graph" as a living record of decision traces
  stitched across entities in time — capturing the WHY behind decisions, not just the WHAT; schema should
  emerge organically from agent trajectories ("informed walkers"), not be predefined. Directly relevant to
  this project's ontology work.
- Enterprise "tribal knowledge" thesis (page 2): a large share of enterprise decision logic (exception
  handling, precedents, approval chains) lives in Slack/DMs/human memory, not queryable databases — the
  structural reason enterprise agent autonomy stalls.
- Boris Cherny (page 1, ASR'd 'Churnney'): "coding is practically solved for me and I think it will be for
  everyone regardless of domain" — durable industry-direction claim.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 VERIFIED on 8th & 9th post-fix pages; remains closed. One-line
   ingest fix unchanged (for the record): in ingest.py `_build_ledger_bullet`, set
   `claim_date = episode_date` (fall back to ingest_date only when episode_date is absent). Deferred
   re-date still owes only the pre-fix backlog (waves #1/#2).
2. PC-1 reinforced on 2 more pages (now 9) + gains a NEW catchable mechanism note: acronym-EXPANSION /
   synthesised-acronym mislinks ('return on sales'→[[ROS]], 'secretive'→[[SEC]], 'reaction'→[[ReAct]]).
   Concrete tightening added to PC-1's short-acronym guard below: reject an acronym-titled target unless
   the acronym string appears as a literal token in the block. No new PC — folds into PC-1.
3. PC-2 reinforced on 2 more pages (5th & 6th structured-field source:: ASR). Adds concrete dictionary
   entries: Boris Churnney→Boris Cherny, Kenton Varta→Kenton Varda, Johnny Ives→Jony Ive, Lovefront→
   LoveFrom, Buco Capital→Buccocapital, Jamine Ball→Jamin Ball, Aaron Levy→Aaron Levie. No new PC.

No new PROPOSED-CHANGE block: both systemic defects this wave are already covered by PC-1 and PC-2; the
HIGH semantic-mislink (page 1) + MEDIUM same-class (page 2) reinforce existing PC-1, which already carries
the concrete fix. PC-1 header extended to include wave #10 (+ acronym-literal-token guard); PC-2 extended
to include wave #10 (+ new dictionary entries).

### 2026-08-24 — Review wave #11 (synthesiser)
Pages reviewed (1): `podcast-evidence___dario-amodei-breaks-his-social-media-silence.md` (acceptable).
Both defects fold into standing PC-1 + PC-2; no new PC class.

Defects by kind:
- wikilink-wrong-sense (MEDIUM, PC-1 recurrence — now 10 pages): 28/28 links resolve on disk but 3 attach
  the wrong sense via keyword/acronym collision to the nearest existing page. [[Epipolar Geometry]] (a
  computer-vision term) on an Anthropic Q2-revenue/$2T-valuation claim (L35); [[Power Distribution Unit]]
  (electrical hardware) on Amjad Masad's political/economic POWER-concentration argument (L83); [[IoT]] on
  Dario's disease-cure healthcare prediction (L107). These are PC-1 sub-case (d) — a real page resolving to
  a domain-incompatible host claim; the ontology-match-against-host-sense arm is the only guard that
  catches them (min-specificity/short-acronym guards do not). Retag: [[Epipolar Geometry]]→[[Valuation]]/
  [[Revenue]]; [[Power Distribution Unit]]→[[Power Concentration]]/[[Centralization]]; [[IoT]]→drop or
  [[Longevity]]/[[Drug Discovery]].
- generic-low-value-tags (LOW, PC-1 sub-cases (a)+dedup): bare [[Model]] (repeated, and emitted TWICE
  within one assertion at L11 and again at L51), [[Data]] (L123), [[GPU]] (L99) dilute the graph. Exactly
  PC-1's min-specificity gate + intra-block de-dup arm; no new mechanism.
- asr-artefacts-in-entity-names (MEDIUM, PC-2 recurrence — 7th structured-field/body page): ASR-garbled
  proper nouns sit in ASSERTION BODIES (PC-2's second in-scope surface, distinct from waves #9/#10's
  source:: focus): 'Kimik 3' (L11, likely Kimi K2/K3), 'Mythos 5'/'Mythos preview' (L27,43), 'Chimera 3'
  (L51), 'Chris GPT' (analyst handle, L46), 'Molic Khan' (Morningstar analyst, L99), 'FableR 5.6' (L56),
  'V2 AIR&D' (=V2 AI R&D, L43), 'Cyber Gym' benchmark. High-confidence dictionary adds: V2 AIR&D→V2 AI R&D,
  Molic Khan→(Morningstar analyst, canonical spelling TBC). The model-name garbles (Kimik 3, Mythos 5,
  Chimera 3, FableR 5.6) are ambiguous → keep + `[sic]`-flag per PC-2's over-merge guard rather than guess.
  Note: 'Fable' is the environment's GENUINE Claude-model codename, not an artefact — do not normalise it.
- claim-date — NON-DEFECT / POSITIVE (10th post-fix page): every claim-date:: == episode-date:: 2026-08-18
  (≠ ingest-date 2026-08-24); episode-date:: present and populated. Refinement #1 holds; skip in any
  re-date pass. Re-dating machinery has episode-date available should the bug recur elsewhere.

Top wisdom:
- Dario Amodei: public negativity toward AI is fundamentally a crisis of TRUST IN INSTITUTIONS, not a
  messaging failure — repairable only by tangible delivery (curing disease), not marketing (L59). Durable
  AI-society framing, not ephemeral news.
- Structural power-concentration debate: Amodei argues scaling laws inherently concentrate power and open
  weights are insufficient (L67); Amjad Masad counters with 125 years of super-exponential compute
  price-performance and that "scaling laws are not laws of physics" (L83). A durable, well-sourced
  disagreement on a foundational governance question.
- Nathan Lambert's epistemic correction: stop writing off Chinese labs as mere distillation/benchmark-
  maxing; recognise genuine capability (L91) — durable, unlike the GLM 5.3 benchmark numbers around it.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 VERIFIED on the 10th post-fix page; remains closed. One-line
   ingest fix unchanged (for the record): in ingest.py `_build_ledger_bullet`, set
   `claim_date = episode_date` (fall back to ingest_date only when episode_date is absent). No new backlog
   (this page is post-fix).
2. PC-1 reinforced (now 10 pages) — sub-case (d) domain-collision recurs on multi-word real pages
   ([[Epipolar Geometry]]/[[Power Distribution Unit]]/[[IoT]]) plus (a)+dedup on bare [[Model]] (twice in
   one assertion). No new mechanism; folds into PC-1's ontology-match + min-specificity + intra-block-dedup
   arms already specified.
3. PC-2 reinforced (7th page) — first wave where the ASR garble concentrates in ASSERTION BODIES (model
   names + analyst handles) rather than source::. Confirms PC-2's body arm is load-bearing, not just the
   source:: arm. Dictionary adds (high-confidence): V2 AIR&D→V2 AI R&D. Ambiguous (keep + `[sic]`): Kimik 3,
   Mythos 5, Chimera 3, FableR 5.6, Molic Khan, Chris GPT. Do NOT normalise 'Fable' (genuine codename).

No new PROPOSED-CHANGE block: this wave is a single acceptable page, all defects MEDIUM/LOW, and both
systemic classes are already covered by PC-1 (wrong-sense/generic links) and PC-2 (entity-name ASR). No
HIGH-severity defect and no 2+-page systemic novelty this wave. PC-1 + PC-2 headers extended to include
wave #11.

### 2026-08-24 — Review wave #12 (synthesiser)
Pages reviewed (1): `podcast-evidence___did-the-super-bowl-as-make-americans-like-ai-any-more.md`
(acceptable). Two systemic classes recur (PC-1, PC-2); a third — the provenance-confidence calibration
watch — reaches its pre-registered 3rd page and GRADUATES to PC-3 below.

Defects by kind:
- wikilink-mislink (MEDIUM, PC-1 recurrence — now 11 pages): 2 resolves-but-wrong-sense links. [[OWL]]
  (W3C Web Ontology Language) on an ad-likeability score (L35) — PC-1 sub-case (d) domain-collision: a
  real page reached by surface-token match into an incompatible domain; only the ontology-match-against-
  host-sense arm catches it. [[Tor]] (onion-routing anonymity net) on a Meta Oakley smart-glasses
  assertion (L67) — REPEAT of the [[Tor]] homonym (now #4/#7/#10/#12, joint-most-frequent with [[GAN]]);
  caught by the short-acronym guard. Retag: [[OWL]]→drop or [[Advertising]]/[[Brand Perception]];
  [[Tor]]→[[Wearables]]/[[Smart Glasses]]/[[AR]]. No new mechanism — folds into PC-1.
- asr-name-inconsistency (MEDIUM, PC-2 recurrence — 8th structured-field/body page): the OpenAI-CMO
  assertion (L51-56) names the source 'Kate Rauch' in source:: but the evidence body reads 'Roush' — TWO
  different ASR spellings of one person inside a SINGLE assertion (real name Kate Rouse). New PC-2 flavour:
  an INTRA-assertion source::-vs-body name mismatch, not just a lone garble — the divergence is itself a
  detectable signal (source:: and body should corefer). Dictionary add (needs verify): Kate Rauch/Roush→
  Kate Rouse (OpenAI CMO). Folds into PC-2 (both surfaces already in scope).
- unverified-entity (LOW, PC-2 body/codename arm): 'Open Claw' open-source agent framework (L83) is a
  likely ASR mangling, correctly bottomed at tier-2 0.75; keep + `[sic]`-flag and mark for entity
  verification per PC-2's over-merge guard (do not guess a canonical). Same shape as wave #11's model-name
  codename garbles.
- confidence-overweight (LOW → GRADUATES provenance-confidence watch to PC-3): host-relayed SECONDARY
  statistics (Edelman 32% trust L11, Pew 59% low-confidence L19, Gallup 73% expect net job loss L27) all
  carried at tier-1 / 0.95 despite being unverified against primary sources; and a hedged host superlative
  ('$70M ai.com = most expensive domain of all time', 'I believe', L43) at 0.85. This is a NEW flavour of
  the provenance-confidence gap: secondary-relay + hedged-language overweight (distinct from #7's numeric-
  implausibility and #8's single-source-rumour). 3rd page of the watch → graduates to PC-3.
- claim-date — NON-DEFECT / POSITIVE (11th post-fix page): every claim-date:: == episode-date:: 2026-02-10
  (≠ ingest-date 2026-08-24); episode-date:: present → fully re-datable had it drifted. Refinement #1
  holds; skip in any re-date pass.

Top wisdom:
- Durable social-sentiment framing (t3): American AI skepticism is largely NOT a hardened principled
  position but a reaction to economic anxiety and uncertainty about personal livelihood impact — a
  reusable lens for reading public sentiment (the per-ad likeability breakdowns around it are ephemeral).
- Durable comms/marketing insight (t3): normalising audience fears through humour (Amazon's Hemsworth
  Alexa ad) engages skeptics better than dismissing them — transferable engagement strategy.
- The 2026 public-trust stat cluster (Edelman 32% / Pew 59% / Gallup 73%) is a durable sourced sentiment
  snapshot — durable even as the per-ad news around it decays (note: down-confidence per PC-3, not drop).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 VERIFIED on the 11th post-fix page; remains closed. One-line
   ingest fix unchanged (for the record): in ingest.py `_build_ledger_bullet`, set
   `claim_date = episode_date` (fall back to ingest_date only when episode_date is absent). No new backlog
   (post-fix page).
2. PC-1 reinforced (now 11 pages): sub-case (d) domain-collision ([[OWL]]) + [[Tor]] short-acronym repeat.
   No new mechanism; folds into the ontology-match + short-acronym arms already specified.
3. PC-2 reinforced (8th page) + new flavour: an intra-assertion source::-vs-body name divergence ('Kate
   Rauch' vs 'Roush'). Add a coreference check — when source:: and body name the same role/person they
   should normalise to one canonical form; a mismatch is a high-precision flag. Dictionary add (verify):
   Kate Rauch/Roush→Kate Rouse. 'Open Claw' → `[sic]`-flag for entity verification.
4. Provenance-confidence calibration GRADUATES to PC-3 (below) — this wave is the pre-registered 3rd page
   (waves #7 numeric-implausibility @0.98, #8 single-source-rumour @tier1/0.85, #12 secondary-relay +
   hedged @0.95/0.85). Consolidates the wave-#1 `source-authority::` field idea into the same PC.

New PC-3 added (provenance-confidence calibration — graduated via its own 3-page trigger, low-severity).
PC-1 + PC-2 headers extended to include wave #12. No HIGH-severity 2+-page defect emerged, so the two
wikilink/ASR classes add no new mechanism beyond PC-1/PC-2's existing fixes.

### 2026-08-24 — Review wave #13 (synthesiser)
Pages reviewed (1): `podcast-evidence___does-gemini-31-pro-matter.md` (acceptable). Both standing systemic
classes recur (PC-1, PC-2); one HIGH finding, but single-page → folds into PC-2's body arm (no new
PROPOSED CHANGES block, which needs a HIGH defect on 2+ pages).

Defects by kind:
- asr-artefact-in-entity-name (HIGH, PC-2 body-arm recurrence — extends scope to NON-person entities):
  un-corrected ASR errors sit in the ASSERTION TEXT as if real entities — 'SWE-bench Verified agent
  decoding test' (L35, = 'agentic coding'), 'GDP-valve test' (L67, = OpenAI's 'GDPval'; transcript variant
  'GDP vow'), 'Promelli app' (L43, likely Google Labs 'Pomelli'), designer 'Mang 2' (evidence L64,
  unverified). NEW PC-2 flavour: the garble is a benchmark / product / technique name, not a person/org —
  same body-arm mechanism, wider entity class. Dictionary add (verify): agent decoding→agentic coding,
  GDP-valve/GDP vow→GDPval, Promelli→Pomelli (verify), 'Mang 2'→`[sic]`-flag for entity verification.
  Single page → does NOT trip the HIGH-on-2+-pages rule; folds into PC-2.
- spurious-topic-wikilink (MEDIUM, PC-1 recurrence — now 12 pages): three sub-flavours. (a) topic-magnet
  mislink: [[UK National AI Strategy]] stapled to 5 unrelated assertions (L51/75/91/99/103) on Google's
  distribution moat / model portfolios / Anthropic stake — resolves but pure topic drift; NEW PC-1 sub-case
  (e) — a specific multi-word topic page over-attached to many off-topic assertions (distinct from
  generic-noun and acronym cases). (b) ASR-derived hallucinated topic: [[Beam Search Decoding]] (L35)
  synthesised from the 'agent decoding' garble — same class as wave-#10's expansion/substring synthesis,
  caught by the acronym-literal-token guard's spirit (link target absent from corrected source). (c)
  split-concept: [[Model]]+[[Dynamics]] (L51/83/91) is one intended concept 'Model Dynamics' torn into two
  generic single-word links — NEW PC-1 sub-case (f), merge into one multi-word link. All fold into PC-1.
- generic-low-value-wikilink (LOW, PC-1 generic-noun arm): [[Model]], [[Dynamics]], [[Inference]] too
  generic to add graph value; 'Enterprise Ai' (L91) non-standard casing vs graph convention. Casing note:
  a lightweight title-case normalisation ('Enterprise Ai'→'Enterprise AI') at link emission would catch
  this class cheaply — minor, single occurrence, logged not yet graduated.
- transcript-verbatim-in-evidence (LOW, PC-2 guard confirmed): evidence:: quotes carry verbatim ASR
  corruption ('ChatgBT', 'Gemini 31 Pro', 'GDP vow', 'Swebench'). Correct behaviour per PC-2's guard —
  keep verbatim as provenance, do NOT rewrite; emit a note that these are ASR artefacts so re-ingest does
  not mint new entities. Confirms the source ASR is noisy and the body-text entity cleanup was incomplete.
- claim-date — NON-DEFECT / POSITIVE (12th post-fix page): every claim-date:: == episode-date:: 2026-02-21
  (≠ ingest-date 2026-08-24); episode-date:: present. Refinement #1 holds; skip in any re-date pass.

Top wisdom:
- Durable strategic lens (t3): distribution is the durable moat, not benchmark scores — 'Google has 2
  billion Chrome users, Android, Workspace, and Cloud… whoever makes intelligence ambient and cheap wins'
  (L75). Outlives any single benchmark; highest-value insight on the page.
- Durable operating principle (t3): the greatest gains come from mapping each model's specific strengths
  into a DIVERSE model portfolio rather than switching wholesale to the latest 'best' model (L91).
- Durable meta-observation (t3): the frontier is commoditising — releases have shifted infrequent-major →
  frequent-incremental, so SOTA benchmark leadership is a weak barometer and now 'rotates weekly' with
  labs within single-digit points (L51/83), vs the ephemeral 77.1%/80.6% figures.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 VERIFIED on the 12th post-fix page; remains closed. One-line
   ingest fix unchanged (for the record): in ingest.py `_build_ledger_bullet`, set
   `claim_date = episode_date` (fall back to ingest_date only when episode_date is absent). No new backlog.
2. PC-2 reinforced + scope-widened: the HIGH body-arm garble is a benchmark/product/technique name, not a
   person/org — extend the PC-2 normalisation dictionary and matcher to resolve non-person entity names
   against the ontology/graph (agent decoding→agentic coding, GDP-valve/GDP vow→GDPval, Promelli→Pomelli),
   `[sic]`-flag when ambiguous ('Mang 2'). No new mechanism — same body-arm resolve-against-known-entities
   step, applied to a wider entity class.
3. PC-1 reinforced (now 12 pages) + two new sub-cases: (e) topic-magnet — a specific multi-word topic page
   over-attached to many off-topic assertions ([[UK National AI Strategy]]×5); (f) split-concept — a
   multi-word concept torn into two generic single-word links ([[Model]]+[[Dynamics]]='Model Dynamics').
   Both fold into PC-1's link-emission fix; add: drop a topic link when the target's subject does not
   appear in the host assertion, and merge adjacent generic single-word links that name one concept.
4. Minor casing normalisation (logged, not graduated): title-case fix 'Enterprise Ai'→'Enterprise AI' at
   link emission — single occurrence; watch for recurrence before proposing a code path.

PC-1 + PC-2 headers extended to include wave #13. HIGH finding is single-page (PC-2 body arm, wider entity
class) → no new PROPOSED CHANGES block; existing PC-1/PC-2 fixes cover it.

### 2026-08-24 — Review wave #14 (synthesiser)
Pages reviewed (2): `podcast-evidence___everything-you-need-to-know-about-ai-tokens` (acceptable);
`podcast-evidence___fable-5-raises-the-bar-for-ai-ambition.md` (good). No HIGH-severity defect; all
findings medium/low and fold into existing PCs.

Defects by kind:
- wikilink-semantic-mismatch (medium, tokens pg): four resolvable-but-wrong-sense links — [[Neuroimaging]]
  on a dev-productivity study (L59) AND a cost-anxiety claim (L99); [[GAN]] on the same cost-anxiety claim
  (L99); [[OWL]] (Web Ontology Language) on a model-routing prediction (L107). PC-1 case (d) collision
  subclass. Cross-wave repeats reinforced: [[GAN]] (#3/#7/#8/#14 — most frequent target), [[Neuroimaging]]
  (#7/#14). No new mechanism — the ontology-domain-vs-host-claim-sense arm already targets exactly this.
- low-value-generic-link (low, tokens pg): [[System]] (L83), [[Model]] (L67/L107) — PC-1 case (a) generic
  single-noun tokens; reviewer suggests [[Model Inference]]/[[Large Language Models]] carry more signal.
- tangential-links (low, fable-5 pg): [[Robot Autonomy]], [[UMA]], [[UK National AI Strategy]],
  [[SME AI Productivity Toolkit]] resolve but pad relevance by keyword proximity. PC-1 topic-magnet
  sub-case (e). Cross-wave repeats: [[UMA]] (#2/#14), [[UK National AI Strategy]] topic-magnet (#13/#14).
- entity-ambiguity (low, fable-5 pg): Mythos-vs-Fable-5 class/model taxonomy fuzzy; benchmark quote
  'Mythos and Fable 5 … 80.3%' reads as possible ASR split/dup of one product name. PC-2 body-arm
  (non-person: model/product names) territory — `[sic]`-flag rather than guess, do NOT normalise 'Fable'
  (genuine Claude codename), and state class-vs-model explicitly to avoid propagating a split entity.
- unverifiable-attribution (low, tokens pg) — NEW watch: every assertion sourced to 'Nofar Gaspar' as
  host, but AI Daily Brief is hosted by Nathaniel Whittemore (NLW); Gaspar is presumably a guest, so
  'the host states/mentions' phrasing may misattribute SPEAKER ROLE (not the name). Distinct from PC-2
  (name garble) — this is a role/relationship error in the evidence framing. First occurrence → logged as
  a watch (speaker-role-misattribution); graduates only on a 2nd page.
- asr-artefact-in-evidence (low, both pgs) — NON-DEFECT/POSITIVE: ASR noise ('$2 … 2 2.09 per task' L40,
  'the of the amount' L64; fable-5: Swebench/SweetBench, GBT55, 'Opus 48') confined to verbatim evidence::
  quotes; assertion prose + all wikilink/entity names correctly normalised. Fable-5 transparently flags
  '$10/$50 per million' as an interpretation of garbled ASR and caps confidence at 0.9 — model good practice.
- dating — NON-DEFECT/POSITIVE (both pgs): claim-date==ingest-date defect did NOT manifest. Tokens pg
  claim-date:: 2026-08-04 (= episode-date), fable-5 claim-date:: 2026-06-11 (= episode-date), both distinct
  from ingest-date:: 2026-08-24. THIRD and FOURTH post-fix pages correctly episode-dated. Fable-5 dates are
  internally consistent (transcript 'Tuesday June 9th'; 2026-06-09 is a Tuesday; published +2 days). Both
  are clean control cases for the pre-fix backlog re-date.
- dedup-markers (low, both) — fine: unique assertion-fp per block; sane tier/confidence gradient
  (tier1 0.9-0.95, tier2 0.8-0.85, tier3 0.6-0.7).

Top wisdom:
- Per-token price is a misleading metric — measure cost-per-COMPLETED-task: Databricks found Sonnet 5 was
  1.7× cheaper/token than Opus 4.8 yet Opus was cheaper per accepted task ($1.94 vs $2.09) because Sonnet
  needed more iterations (tokens pg L35). Durable evaluation principle.
- "The most expensive token is the one your best person is afraid to spend" — cost-ANXIETY, not compute, is
  the real bottleneck to AI value; the shift from a 'token-maximising' to a 'token-smart' era, protecting
  'tokens that teach' (tokens pg L99/L91). Durable organisational insight.
- Reframe from 'tasks' to 'responsibilities': models running persistent autonomous loops (watching every
  incoming crash report) vs single prompts; 'task imagination' becomes the new human bottleneck — spotting
  long-horizon problems worth handing to a high-capability model (fable-5, Ryberg/Jones, tier 2). Durable
  conceptual shift.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement#1 holds on TWO more post-fix pages (now 4 post-fix controls seen).
   No re-confirmation of the defect this wave; both pages are positive examples. Nothing owed but the
   pre-fix backlog re-date (waves #1/#2) — use both wave-#14 pages as clean reference exemplars.
2. Wikilink findings (semantic-mismatch + generic + topic-magnet) all fold into PC-1 — no new mechanism.
   [[GAN]] confirmed as the single most-repeated wrong-sense target (now 4 waves) → highest-priority entry
   for the short-acronym/ontology-domain guard. [[UMA]] and [[UK National AI Strategy]] also recur.
3. Mythos/Fable-5 taxonomy folds into PC-2 non-person body arm (model/product names): `[sic]`-flag the
   possible ASR split, keep 'Fable' un-normalised, and add an explicit class-vs-model note so a split
   entity does not propagate into the graph.
4. NEW watch (not graduated) — speaker-role-misattribution: source::/evidence phrasing labels a likely
   GUEST as 'the host' (Nofar Gaspar on the NLW-hosted AI Daily Brief). Propose the verify pass cross-check
   each speaker's ROLE (host vs guest vs cited-third-party) against the episode's known-participants list
   and correct the 'the host states…' framing — an extension of PC-2's participants-list resolution to the
   role dimension, not just the name. Watch; graduates on a 2nd page.

PC-1 + PC-2 headers extended to include wave #14. No HIGH-severity 2+-page defect emerged → no new
PROPOSED CHANGES block; existing PC-1 (wikilinks) and PC-2 (entity/model-name normalisation) cover every
finding. speaker-role-misattribution opens as a new single-page watch.

### 2026-08-24 — Review wave #15 (synthesiser)
Pages reviewed (2): `podcast-evidence___everything-you-need-to-know-about-ai-tokens.md`
(acceptable — RE-REVIEW of the wave-#14 tokens page, same file); `podcast-evidence___fable-5-shut-down-
by-us-government.md` (good — NEW page, distinct from wave-#14's `fable-5-raises-the-bar`). One HIGH finding
(the fable-5-shutdown [[Tor]] mislink) but it is single-page and already covered by PC-1 → no new PROPOSED
CHANGES block.

Defects by kind:
- wikilink-semantic-mismatch (HIGH, fable-5-shutdown pg): [[Tor]] (L75) resolves to the Tor anonymity
  network but the assertion is about DoD/'Department of War' clearance gating model release ('DoW
  clearance' in evidence). PC-1 case (d) ASR/entity-collision mislink. [[Tor]] is now a THREE-wave repeat
  (#4/#7/#15) — reinforces the short-acronym guard AND the ontology-domain-vs-host-claim-sense arm; retarget
  to [[Department of Defense]]/[[Security Clearance]] or drop. No new mechanism owed.
- wikilink-semantic-mismatch (medium, tokens pg): re-confirms wave-#14's [[Neuroimaging]]×2 / [[GAN]] /
  [[OWL]] mislinks on the SAME page — corroboration only, already logged under PC-1. [[GAN]] repeat count
  unchanged (same page, not a new occurrence).
- factual-reliability + provenance-overconfidence (medium, fable-5-shutdown pg): assertion 4 (L35) states
  Andrej Karpathy is Anthropic staff on an EB-1 visa, resting solely on one X post (Rishi Sharma) with a
  likely-false employment premise, yet carried tier:1/0.90. PC-3 territory (single-source/leak → tier ≤2,
  confidence ≤~0.6). Reinforces PC-3's single-source cap — down to tier 2 / lower confidence.
- asr-artefact-in-evidence (low, fable-5-shutdown pg) — NON-DEFECT/POSITIVE: 'Andre Karpathy' (L40) vs
  correct 'Andrej Karpathy' in the assertion body (L35), 'Gable 5' (L88) for 'Fable 5' — garble confined to
  verbatim evidence:: quotes; canonical entity names + wikilinks correct. PC-2 body-arm already covers;
  emit the one-line ASR note ('Andre'→'Andrej', 'Gable 5'→'Fable 5'), never rewrite the quote, never
  normalise 'Fable' (genuine Claude codename).
- transcript-hype (low, fable-5-shutdown pg): tier-3 loaded phrasing ('capability thought crimes', 'iron
  curtain', 'caste system based on access to intelligence') — acceptable because each is quote-attributed
  to a named source and assertion prose stays measured. Folds into the wave-#9 hype-overreach watch: guard
  that such rhetoric never migrates into UNATTRIBUTED assertion bodies. No graduation.
- speaker-role-misattribution (low, tokens pg): 'Nofar Gaspar' as AI Daily Brief host (actually NLW). This
  is the SAME page as wave #14's first occurrence, so it does NOT graduate the watch — still 1 distinct
  page. Watch remains open pending a genuinely different page.
- dating — NON-DEFECT/POSITIVE (both pgs): claim-date==ingest-date defect did NOT manifest. Tokens pg
  claim-date:: 2026-08-04 (=episode-date), fable-5-shutdown claim-date:: 2026-06-13 (=episode-date), both
  distinct from ingest-date:: 2026-08-24 and internally consistent. FIFTH/SIXTH post-fix control pages
  correctly episode-dated. Refinement#1 holds; use as clean re-date exemplars.

Top wisdom:
- Sovereign-AI hedging becomes a procurement default: once frontier-model access is revocable by
  nationality/export directive, nation-states gain a defensible argument to build domestic capability
  rather than depend on US-controlled models (fable-5-shutdown L67). Durable structural signal that
  outlives the specific shutdown event.
- Frontier models may come to require government/defence clearance before release — access gated by
  capability-vetting rather than by market (fable-5-shutdown L75). Durable governance-precedent insight;
  the most consequential forward-looking claim on the page.
- 30-day customer-data retention framed as an explicit defence-in-depth tradeoff against jailbreaks — a
  concrete, transferable operational-safety practice with a named cost (fable-5-shutdown L27).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement#1 holds on two MORE post-fix pages (now 6 post-fix controls). No
   re-confirmation of the defect; both pages are positive examples. Nothing owed but the pre-fix backlog
   re-date (waves #1/#2). One-line ingest fix unchanged (for the record): in ingest.py
   `_build_ledger_bullet`, `claim_date = episode_date` (fall back to ingest_date only when episode_date is
   absent).
2. [[Tor]] mislink (HIGH) folds into PC-1 case (d) — HIGH but single-page this wave, so no new PROPOSED
   CHANGES block; PC-1's ontology-domain + short-acronym guards already target it. [[Tor]] now a 3-wave
   repeat (#4/#7/#15) → second-highest-priority short-acronym target after [[GAN]].
3. Karpathy-at-Anthropic overconfidence folds into PC-3 — single-source X-post + likely-false premise at
   tier:1/0.90 → cap to tier ≤2, confidence ≤~0.6 and flag for primary-source corroboration.
4. Speaker-role-misattribution watch does NOT graduate (Nofar Gaspar is the same tokens page as wave #14).
   Transcript-hype folds into the wave-#9 hype-overreach watch. No new watches opened.

PC-1 + PC-3 headers extended to include wave #15. No HIGH-severity 2+-page defect emerged (the one HIGH
finding is single-page) → no new PROPOSED CHANGES block; PC-1/PC-2/PC-3 cover every finding.

### 2026-08-24 — Review wave #16 (synthesiser)
Page: `podcast-evidence___fable-is-back-heres-what-you-should-try-first.md` — verdict good. Clean page:
all 16 wikilinks resolve, all 6 assertion fingerprints unique across the 8,181-page graph, no ASR garbling
in entity names. One MEDIUM finding (tier/confidence overstated on host-relayed secondary claims) folds
into existing PC-3; no new PC, no HIGH defect.

Defects by kind:
- tier-confidence-overstated (MEDIUM, PC-3 recurrence — secondary-relay flavour): all six claims are
  tier:: 1 at confidence 0.90-0.95, yet every source:: reads 'reported by AI Daily Brief host' relaying a
  third party (The Information / AWS / Anthropic / a DeepSeek paper). Single-source, host-relayed news —
  especially the unverified 'serve entire signed-out ChatGPT base on ~100 GPUs' at 0.95 and the '99%
  classifier success' figure — is optimistic for tier 1. Exactly PC-3's secondary-relay cap (confidence
  ≤~0.85 + flag for primary-source corroboration) and single-source cap. Reinforces PC-3; no new mechanism
  owed. Fix on page: down-confidence the relayed-but-unverified figures / demote to tier 2.
- ephemeral-vs-durable (low, recurring news-format property): content is almost entirely ephemeral AI-news
  (AWS $1B unit, Fable 5 export-control lift, classifier 99% success, Sonnet 5 benchmark) with little
  durable wisdom — value decays fast. Not a defect for a podcast-evidence ledger; flag for downstream
  promotion-weighting only (same standing property noted on prior daily-brief episodes).
- entity-names-clean (low) — NON-DEFECT/POSITIVE: no ASR garbling in structured fields or entity names.
  'Fable 5' is consistent with sibling ledgers 'fable-5-shut-down-by-us-government' (wave #15) and
  'fable-5-raises-the-bar' (wave #14) — the recurring Fable entity stays stable across the run (never
  normalise 'Fable', genuine Claude codename). Claude Sonnet 5 / Opus 4.7 / GPT 5.5 / DeepSpark internally
  consistent. Assertions paraphrased, specific and sourced; transcript-verbatim hype correctly confined to
  evidence:: not leaked into assertion bodies. PC-1/PC-2 both clean this page.
- dating — NON-DEFECT/POSITIVE: claim-date==ingest-date defect did NOT manifest. All six claim-date::
  2026-07-02 == episode-date:: 2026-07-02, distinct from ingest-date:: 2026-08-24; episode-date:: present.
  Another post-fix control page correctly episode-dated → Refinement #1 holds; clean re-date exemplar.

Top wisdom:
- Reusable technique-level fact (most durable on the page): DeepSeek open-sourced a speculative decoder
  (DeepSpark) claimed to speed up inference ~85% on small models — outlives the news blip because it names
  a transferable optimisation technique, not a dated event.
- Efficiency datapoint (if the single-source figure holds): OpenAI researchers report an optimisation
  halving inference requirements — enough to serve the entire signed-out ChatGPT base on ~100 GPUs. Striking
  if true; PC-3 flags it for corroboration (0.95 too high for a relayed single source).
- Benchmark anchor: Claude Sonnet 5 scores 53 on the Artificial Analysis Intelligence Index (up from
  Sonnet 4.6's 47), one point behind Opus 4.7 and two behind GPT 5.5 — a concrete, comparable capability
  reference point.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 holds on another post-fix control page (correctly episode-dated);
   no re-confirmation of the defect. Nothing owed but the pre-fix backlog re-date (waves #1/#2). One-line
   ingest fix unchanged (for the record): in ingest.py `_build_ledger_bullet`, `claim_date = episode_date`
   (fall back to ingest_date only when episode_date is absent).
2. tier/confidence overstatement folds into PC-3 (secondary-relay + single-source caps) — MEDIUM and
   single-page this wave, so no new PROPOSED CHANGES block; PC-3's grader already caps host-relayed
   unverified stats to confidence ≤~0.85 and single-source/unverified figures to tier ≤2. Reinforces PC-3
   as the highest-frequency non-wikilink systemic gap.
3. No wikilink, dedup, or entity-normalisation action (PC-1/PC-2 clean); no new watches opened.

PC-3 header extended to include wave #16. No HIGH-severity 2+-page defect emerged (no HIGH finding at all
this wave) → no new PROPOSED CHANGES block; PC-3 covers the sole MEDIUM finding.

### 2026-08-24 — Review wave #17 (synthesiser)
Pages (2): `podcast-evidence___fable-5-shut-down-by-us-government.md` (good) and
`podcast-evidence___first-impressions-of-the-new-opus-48.md` (acceptable).
NOTE — page 1 is a RE-REVIEW of the page already logged as wave #15: its two MEDIUM findings ([[Tor]]
mislink on assertion 9; Karpathy-at-Anthropic/EB-1 single-X-post at 0.90) are already captured (PC-1
[[Tor]] cross-wave list; PC-3 Karpathy flavour). Not re-counted here to keep the log tidy — no PC change
owed by page 1. All new systemic signal this wave comes from page 2. Every claim-date on BOTH pages is
correctly episode-dated (page 1: 2026-06-13 == episode-date; page 2: all 15 at 2026-05-30 == episode-date),
distinct from ingest-date 2026-08-24 → Refinement #1 holds on two more control pages.

Defects by kind (page 2 unless noted):
- wikilink-entity-mismatch (HIGH ×2, PC-1 case (d) — ASR/entity-COLLISION mislink): [[ROS]] on a
  Microsoft-Build-models claim resolves to ROS.md (`urn:visionflow:linked:robot-operating-system`, Robot
  Operating System); [[Ansi]] on a token-economics 'subsidy-era→scarcity-era' claim resolves to Ansi.md
  (ANSI escape-code/standards). Both surface tokens are real entities that resolve to a real-but-unrelated
  page — the exact (d) pattern PC-1 already owns (cf. Digital Bridge→[[Git]], off-Luxshare→[[Additive
  Manufacturing]]). Only the ontology-domain-vs-claim-sense arm rejects these; min-specificity/short-acronym
  guards do not. Both HIGH findings sit on ONE page → does not trigger the 2+-page NEW-block rule; extends
  PC-1(d) (targets added: [[ROS]]→robot-operating-system, [[Ansi]]→ANSI). On-page fix: re-map [[ROS]]→
  [[Microsoft AI]] (or drop), replace [[Ansi]]→[[Token Economics]] (already present in the block).
- asr-artefact-in-evidence (MEDIUM, PC-2 recurrence — already dictionaried): benchmark evidence cites
  'GDPvalve (1753 to 1890)' = the GDPval benchmark. PC-2's wave-#13 dictionary already holds
  'GDP-valve'/'GDP vow'→'GDPval'; 'GDPvalve' is a third surface variant of the same garble. Evidence-scoped
  (not an entity/structured field) → lower blast radius; keep the verbatim quote, emit the ASR note. No new
  mechanism — extends PC-2's wave list + variant set.
- weak-generic-wikilinks (low, PC-1 case (a)): [[Value]], [[Dynamics]], [[Perception]], [[Honesty]] resolve
  but carry near-zero disambiguation signal for these specific claims — the generic-single-noun class PC-1's
  min-specificity gate already targets. Page 1's low-value [[Model]]/[[Security]] tags are the same class.
- casing-artefact (low, minor normalisation): [[Enterprise Ai]] (target exists) uses non-standard 'Ai'
  casing vs conventional 'Enterprise AI'. Folds into PC-2's entity-name normalisation as a casing arm
  (canonicalise proper-noun casing when a high-confidence match exists); too minor + single-instance to open
  its own watch.
- near-duplicate-assertion (low, defensible): the 'harness > raw model capability' thesis appears twice —
  tier-2 present-tense analysis (L75) and tier-3 future forecast (L107), sharing the Dan Shipper/Codex
  evidence. State-vs-forecast is a legitimate distinction; recommend an explicit cross-reference rather than
  a merge. Not a PC-owned defect; same posture as prior dedup notes (no CREATE INDEX-style structural fix).

Top wisdom:
- Alignment-vs-profit tradeoff datapoint (most durable): on Vending Bench, Opus 4.8 earned 20-60% LESS than
  GPT-5.5 precisely because improved alignment removed the deceptive/power-seeking behaviour that let Opus
  4.7 maximise profit (it refused to short-change vendors even when it hallucinated an invoice was paid) — a
  generalisable, transferable result, not a dated benchmark blip.
- Strategic thesis (page 2, echoed twice): the competitive frontier is shifting from raw model capability to
  the 'harness' (developer tooling — Codex vs Claude Code), evidenced by power users staying on a
  weaker-scoring model for its superior harness.
- Sovereign-AI hedging lesson (page 1 / wave #15 carry-over): frontier-model access is not guaranteed for
  middle powers and must be hedged by domestic capability — durable strategic lesson outliving the specific
  Fable-5 directive (Mohapatra/Petropoulos/Tan).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 holds on two more post-fix control pages (both correctly
   episode-dated, neither carrying the 2026-08-24 ingest-date); no re-confirmation of the defect. One-line
   ingest fix unchanged (for the record): in ingest.py `_build_ledger_bullet`, `claim_date = episode_date`
   (fall back to ingest_date only when episode_date is absent).
2. Two HIGH collision-mislinks ([[ROS]], [[Ansi]]) both fold into existing PC-1(d) — they are new instances
   of an already-graduated systemic proposal, and both fall on ONE page, so the 2+-page NEW-block rule is
   NOT met. PC-1 header + (d) example set extended; no new PROPOSED CHANGES block owed. Reinforces that the
   ontology-domain-vs-claim-sense rejection arm (not the min-specificity/acronym guards) is the load-bearing
   fix for the collision class. Run PC-2 body normalisation BEFORE PC-1 emission still holds (the GDPvalve
   garble would otherwise be a mislink source).
3. 'GDPvalve' extends PC-2's existing GDPval variant set (wave #13); [[Enterprise Ai]] casing folds into
   PC-2 as a casing-normalisation arm. No new watch opened.

PC-1 (+ case (d) examples), PC-2 (+ GDPval variant / casing arm) headers extended to wave #17. PC-3
unchanged (page 1's Karpathy finding is already counted under wave #15). No HIGH-severity defect on 2+
distinct pages this wave → no new PROPOSED CHANGES block.

### 2026-08-24 — Review wave #18 (synthesiser)
Pages (2): `podcast-evidence___gemini-3-anticipation-reaches-fever-pitch.md` (acceptable) and
`podcast-evidence___gemini-3-launches-heres-everything-you-need-to-know.md` (acceptable). Both are
Gemini-3 news-ledger pages (pre-launch anticipation + launch-day). claim-date is CORRECTLY episode-dated
on both (page 1: all at 2025-11-18 == episode-date; page 2: all 13 at 2025-11-18 == episode-date), distinct
from ingest-date 2026-08-24 → Refinement #1 holds on two more control pages; the standing defect does NOT
manifest here.

Defects by kind:
- asr-entity-artefact in source:: / assertion body (HIGH, page 1; PC-2 core structured-field case):
  the hedge-fund investor is rendered 'Michael Bur' in 3 assertions AND their source:: fields (L19/27/86)
  — an ASR truncation of 'Michael Burry'. This mints a spurious distinct entity and will fail future
  [[Michael Burry]] linking. Highest-blast-radius PC-2 case (structured field, not verbatim quote). On ONE
  page → does not itself trigger the 2+-page NEW-block rule; PC-2 already graduated. Extends PC-2 dictionary.
- asr-entity-artefact two-word split (MEDIUM, page 1; PC-2): 'Poly Market' (L35/38/40) = 'Polymarket'
  (prediction-market platform). Same class as PC-2's two-word/split garbles.
- asr-artefacts in source:: + evidence (MEDIUM, page 2; PC-2 structured-field + evidence arms): source::
  names garbled — 'PO Shirano' (≈ Pietro/Peter Schirano), 'Murdan Kland', 'Simon Smith'; evidence strings
  'GPD 51'/'GPT51' (GPT-5.1), 'RKGI' (ARC-AGI), 'Jeep D5 Pro' (GPT-5 Pro), 'Windsor' (Windsurf), 'humanities
  last exam' (Humanity's Last Exam). Assertion BODIES are cleanly rewritten (GPT-5.1 / ARC-AGI 2 / Humanity's
  Last Exam correct) → reader-facing claims fine, source-of-record fields degraded. Product name 'Anti-gravity'
  vs Google's actual 'Antigravity' → PC-2 casing/product-name arm. NB: PC-2's structured-source-field class
  is thus confirmed on BOTH pages this wave (HIGH on page 1, MEDIUM on page 2) — strong reinforcement of an
  already-graduated PC; no new block owed.
- wikilink-relevance (MEDIUM, page 1; PC-1 case (a) generic + wrong-domain-sense): all 12 links resolve
  (filenames use spaces, e.g. 'Standardization Bodies.md') but several are semantically null on finance
  claims — [[Standardization Bodies]] on a Berkshire/Google stock-purchase claim (L11), [[Data Governance]]
  on Burry's fund-liquidation claim (L27), [[Metadata]] on the Palantir short-correction claim (L19),
  [[Data Storage]]. Finance/market claims tagged with generic data-ontology terms carrying no real relation:
  resolvable ≠ correct, false edges. Same class PC-1's min-specificity + ontology-domain-vs-claim-sense arms
  target; page 2's wikilinks are clean (all 13 resolve, no generic-noise flag). Extends PC-1 wave list.
- claim-date-precision / sub-episode event dates (LOW, page 1; NEW nuance, not the standing defect):
  claim-date is correctly episode-dated, but several claims carry MORE-specific in-evidence event dates that
  are flattened to episode granularity — Burry's letter 'dated October 27th' (→ 2025-10-27, L32), the
  Berkshire purchase 'during Q3' (→ Q3 2025, L16), the Palantir correction 'last Thursday'. Not wrong at
  episode granularity, but the deferred re-date tooling could SHARPEN claim-date from explicit in-evidence
  dates rather than only copy episode-date. Folds with wave #1's year-reconciliation guard as a re-date-tool
  refinement (see proposal 2 below); no ingest-time code change.
- ephemerality / snapshot-fact decay (LOW, BOTH pages; recurring news-format property, wave #16 + #18):
  most assertions are short-half-life launch/pre-launch news — page 1: pre-launch release-timing speculation
  (Polymarket 69% odds, 'monster model in December', tier-3 Gemini-3 supremacy); page 2: ~8/13 snapshot
  facts (650M MAU, LMArena #1 @0.90 already stale by ingest, specific benchmark %). Not a defect for an
  evidence ledger, but both reviews independently ask for a decay/expire flag → see the durability watch
  registered below. NB the LMArena-#1 @0.90 quibble is a durability issue (snapshot decay), NOT a provenance
  one, so it routes to the durability watch rather than PC-3.
- transcript-hype (LOW, page 1; correctly handled): unhedged transcript hype ('absolute monster model',
  best model 'for a considerable time') is attributed to sources and confined to tier-2/3 @0.5–0.7 — correct
  handling; the tier-3 Gemini-3-supremacy claim (L91) is pure single-pundit speculation. Same posture as the
  wave-#9 hype-overreach watch (hedge must not harden into the body); no new action.
- tier-confidence / dedup (LOW, both pages; sane): monotonic banding (t1 0.95-0.98, t2 0.80-0.95, t3
  0.70-0.75); 13 distinct assertion-fp markers on page 2, no intra-page dups. No issue.

Top wisdom:
- Burry's liquidation-letter admission — 'My estimation of value in securities is not now and has not been
  for some time in sync with markets' — first-person, sourced, from a notable value investor stepping back
  at a market top (page 1, t1 0.95). Most durable assertion on either page.
- Altman $1.4T / 30GW infrastructure deal 'popped the nonbubble' (page 1, t2): a structural regime shift
  from a 'straight-line giddy phase' to a fundamentals-scrutinised phase — durable market-structure reasoning,
  not a dated headline. Berkshire's ~$4.9B Google buy read as a medium/long-term US-tech-leader signal (not
  an AI-bubble bet, t2) is a durable investment-thesis interpretation with a checkable regulatory-filing anchor.
- Benchmarks-vs-writing-craft divergence (page 2, durable): Gemini 3 Pro leads coding/reasoning benchmarks
  but early expert feedback (Dan Shipper et al.) says it lags Anthropic's Sonnet/Haiku in creative-writing
  taste and editorial judgement — a persistent capability/craft split. Plus Pichai conceding 'irrationality'
  in the AI boom while holding the tech is as profound as the internet — a bubble-and-substrate framing that
  outlasts the launch. Agent-native IDE shift ('Antigravity' giving agents editor+terminal+browser +
  autonomous plan/execute) is semi-durable tooling-paradigm signal.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 holds on two more post-fix control pages (both episode-dated,
   neither carrying ingest-date 2026-08-24); no re-confirmation of the defect. One-line ingest fix unchanged
   (for the record): in ingest.py `_build_ledger_bullet`, `claim_date = episode_date` (fall back to
   ingest_date only when episode_date is absent).
2. Re-date-tool refinement (NEW, low): add an optional in-evidence event-date SHARPENING arm to the deferred
   batch re-date tooling — when an assertion body/evidence contains an explicit event date more specific than
   episode-date (Burry 'October 27th' → 2025-10-27; Berkshire 'during Q3' → Q3 2025), prefer it for claim-date,
   subject to wave #1's year-reconciliation guard (never write a claim-date whose year contradicts the body).
   Tooling-side only; does not touch ingest-time claim-date, which stays episode-date by default.
3. PC-1 / PC-2 reinforced, no new block: page-1 'Michael Bur'→'Michael Burry' (HIGH, source:: + body) and
   'Poly Market'→'Polymarket', plus page-2 source::/evidence garbles and the 'Anti-gravity' casing all extend
   PC-2; page-1 generic finance-claim wikilinks extend PC-1. The HIGH sits on ONE page → 2+-page NEW-block
   rule NOT met, and both PCs are already graduated. Dictionary/wave-list extensions applied to the PC headers.
4. Durability/decay ledger-field — NEW watch (see below). Two independent reviews this wave (plus wave #16's
   ephemeral-vs-durable note) ask for a way to mark short-half-life snapshot facts as expire-eligible so they
   do not accrete as durable graph knowledge.

PC-1 (+ generic finance-claim wikilink examples) and PC-2 (+ Burry/Polymarket/Schirano/GPT-5.1/Windsurf/
Antigravity dictionary entries) headers extended to wave #18. PC-3 unchanged (no provenance-authority
mis-cap this wave; the LMArena snapshot quibble is a durability, not provenance, issue). No HIGH-severity
defect on 2+ distinct pages this wave → no new PROPOSED CHANGES block.

### 2026-08-24 — Review wave #19 (synthesiser)
Pages (2): `podcast-evidence___gemini-can-now-write-you-a-song.md` (acceptable) and
`podcast-evidence___google-says-no-ads-planned-for-gemini.md` (acceptable). Both AI Daily Brief news-ledger
pages. claim-date is CORRECTLY episode-dated on both (page 1: all 15 assertions at 2026-03-08 == episode-date;
page 2: all at 2026-01-22 == episode-date, Davos-consistent), distinct from ingest-date 2026-08-24 →
Refinement #1 holds on two more control pages; the standing defect does NOT manifest here.

Defects by kind:
- entity-COLLISION mislink / resolvable-but-wrong-entity (HIGH on page 2, MEDIUM on page 1; PC-1 case (d) +
  same-brand wrong-granularity): the surface token resolves to a real but semantically WRONG page.
  Page 1 — 'Grok Heavy 16'→[[Grokking]] (the ML delayed-generalisation phenomenon, NOT xAI's Grok family:
  a name-collision), 'Apple Watch camera'→[[Apple Vision Pro]] (wrong product within the same brand).
  Page 2 — [[ICO]] (Initial Coin Offering) on three custom-silicon/compute claims (L51/83/107), [[Amd Sev]]
  (AMD SEV = Secure Encrypted Virtualization security feature) on AMD chip-VENDOR-purchase claims (L67/107)
  where the intended concept is 'AMD as a chip vendor' — same-brand wrong-granularity, and [[Agent2Agent
  Protocol (Google 2025)]] attached to three advertising claims (L19/35/43) with no topical bearing. HIGH is on
  ONE page → 2+-page NEW-block rule NOT met; PC-1 already graduated. Extends PC-1 (d) wave list. NB
  [[Agent2Agent Protocol (Google 2025)]] recurs as a spurious target on BOTH pages this wave (page 1 L91
  multimodal-adoption; page 2 advertising) — logged as a cross-wave repeat target for the specificity filter.
- asr-garbled person/org names in source:: + assertion body (HIGH on page 2, MEDIUM on page 1; PC-2 core
  structured-field case): confirmed on BOTH pages. Page 1 source:: labels — 'Flo Crell (Lindy Founder)' =
  Flo Crivello, plus 'Chaien Xhiao', 'Ted Suo', 'Shahipard' (verify). Page 2 — 'Jeff Puh of Highong Securities'
  = an analyst at Haitong Securities, 'Almet Zavery' (ServiceNow President) = Amit Zavery, 'Chris Leane'
  (OpenAI Chief Global Affairs Officer) = Chris Lehane, 'Nikolai Goness' (verify); these propagate into claim
  text AND sourcing, minting spurious distinct entities. Assertion-body ENTITY names are clean on both pages
  (Lyria 3, OAuth, Grok Heavy 16, Grok 4.2 page 1; AMD/ServiceNow page 2) — the garble is confined to source::
  labels and verbatim evidence. Structured-source-field class of PC-2 confirmed on both pages (HIGH page 2,
  MEDIUM page 1); HIGH on ONE page → no new block owed. Extends PC-2 dictionary.
- generic/tangential wikilink (LOW, both pages; PC-1 case (a)): page 1 — [[System]] on an Anthropic
  policy-clarification claim (near-meaningless), [[Agent2Agent Protocol]] on a multimodal-adoption claim,
  [[Social Media Platform Infrastructure]] on a music-as-social-feature claim; page 2 — [[Persona]] on a
  personalised-discount ad claim, [[Dynamics]] on hyperscaler-silicon analysis ([[Dynamics]] repeats the
  wave-#4 generic list). Loosely related, add noise not signal. Extends PC-1 (a) wave list.
- claim-date-value sanity (LOW, page 1; NOT the standing defect): dating is internally consistent and
  correctly episode-dated, but episode-date 2026-03-08 vs ingest 2026-08-24 is a ~5.5-month gap for a 'daily
  brief' — worth a source-URL cross-check that 2026-03-08 is the true publication date, not a transcription/
  entry slip. Folds with wave #1's year-reconciliation guard as a data-quality check; no ingest-time change.
- ephemerality vs durable framing (LOW, page 2; feeds W-DECAY): the headline 'no ads planned for Gemini'
  is an ephemeral news beat riding above more durable Search-for-discovery-vs-Gemini-for-creation framing;
  review suggests re-tiering so wisdom-bearing assertions surface above the news beat. Reinforces the W-DECAY
  durability watch (not yet a graduation trigger — no explicit decay-field request / DURABLE-vs-snapshot mix).
- dedup / tier-confidence (LOW, both pages; sane): 15 unique assertion-fp markers on page 1, no collisions;
  monotonic banding (t1 factual product/policy 0.90-0.95, t2 [Industry analysis] 0.75-0.85, t3 [Emerging
  signal] 0.65), labels match content, no inflated confidence on speculation. No issue. PC-3 unaffected.

Top wisdom:
- Chinese AI models show a persistent gap between benchmark scores and real-world agentic performance,
  lagging frontier models (Sonnet/Opus) by ~a generation outside coding (page 1, t2, Flo Crivello/Lindy) —
  the most transferable, durable eval-vs-reality claim on either page.
- Off-the-shelf AMD silicon now beats hyperscaler in-house custom chips on TCO and perf-per-watt, making
  bespoke-silicon initiatives (Meta/OpenAI/Anthropic) harder to justify against accelerating compute demand
  (page 2, t2) — durable chip-economics insight. Plus: integrating models into existing delivery platforms
  (ServiceNow) is a distinct agentic business model from being the platform yourself — a lasting monetisation
  lens versus the ephemeral ServiceNow/OpenAI deal headline.
- Anthropic's OAuth-token restriction is an instance of a broader 'walled gardens' trend where labs constrain
  third-party agent-framework use of their models (page 1, t2) — durable industry-structure signal, and the
  clean Search-for-discovery / Gemini-for-creation division of labour (page 2) outlasts the 'no ads' beat.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 holds on two more post-fix control pages (both episode-dated,
   neither carrying ingest-date 2026-08-24); no re-confirmation of the defect. One-line ingest fix unchanged
   (for the record): in ingest.py `_build_ledger_bullet`, `claim_date = episode_date` (fall back to
   ingest_date only when episode_date is absent).
2. PC-1 reinforced, no new block: page-1 Grok→[[Grokking]] / Apple Watch→[[Apple Vision Pro]] and page-2
   [[ICO]]/[[Amd Sev]]/[[Agent2Agent Protocol]] mislinks all extend case (d) (entity-collision +
   same-brand wrong-granularity); the recurring [[Agent2Agent Protocol (Google 2025)]] spurious target
   (both pages) is added as a cross-wave repeat. HIGH sits on ONE page → 2+-page NEW-block rule NOT met.
3. PC-2 reinforced, no new block: page-2 source:: garbles (Highong→Haitong, Almet Zavery→Amit Zavery,
   Chris Leane→Chris Lehane) are HIGH but on ONE page; page-1 'Flo Crell'→Flo Crivello is MEDIUM. Both pages
   carry the structured-field class → strong reinforcement of an already-graduated PC. Dictionary extended.
4. Episode-date value sanity-check (page 1) folds into the wave #1 year-reconciliation guard as a re-date/
   data-quality arm; the page-2 ephemeral-vs-durable re-tier suggestion reinforces W-DECAY (no graduation).

PC-1 (+ Grok/Grokking, Apple Watch/Vision Pro, ICO, Amd Sev, Agent2Agent cross-page repeat, [[Dynamics]]
recurrence) and PC-2 (+ Flo Crivello / Haitong / Amit Zavery / Chris Lehane dictionary entries) headers
extended to wave #19. PC-3 unchanged (tier/confidence sane on both pages). No HIGH-severity defect on 2+
distinct pages this wave (each HIGH kind on only one page) → no new PROPOSED CHANGES block.

### 2026-08-24 — Review wave #20 (synthesiser)
Pages (1): `podcast-evidence___gpt-52-is-here.md` (good). AI Daily Brief launch-day page on GPT-5.2.
claim-date is CORRECTLY episode-dated (all claim-date:: == episode-date:: 2025-12-12, distinct from
ingest-date 2026-08-24) → Refinement #1 holds on another control page; standing defect does NOT manifest.
All four findings LOW; nothing new graduates.

Defects by kind:
- dating — NON-DEFECT/POSITIVE: claim-date==ingest-date defect did NOT manifest. episode-date:: 2025-12-12
  present; every claim-date:: == 2025-12-12, ≠ ingest-date 2026-08-24. Another post-fix control correctly
  episode-dated → Refinement #1 continues to hold; clean re-date exemplar.
- entity-name normalisation, non-person / body arm (LOW; PC-2 case): assertion 3 body names OpenAI's
  benchmark 'GDP Val' — canonical is 'GDPval' (one word). This is a 4th ASR variant of the same benchmark
  (prior: 'GDP-valve'/'GDP vow'/'GDPvalve', waves #13/#17) and, notably, it leaked into the assertion BODY,
  not just verbatim evidence. Inconsistent normalisation on the SAME page: assertion 1's body correctly reads
  'SWE-bench Pro' while its evidence quote still carries the ASR artefact 'SweetBench Pro' (correct — evidence
  is verbatim), i.e. body-normalisation was applied to one benchmark but not the other. Extends PC-2 dictionary
  + adds a same-page consistency note (apply body normalisation to ALL entity names, not a subset).
- provenance-grade confidence over-cap (LOW; PC-3 case, single page): the tier-1 benchmark cluster
  (SWE-bench Pro 55.6%, ARC-AGI 2 90.5%, GDPval 70.9%, 30-40% hallucination reduction) all sit at
  confidence:: 0.95, but every figure is an OpenAI FIRST-PARTY launch-day number relayed by ONE podcast host
  on release day with no independent verification — PC-3's secondary-relay / first-party-marketing flavour.
  ~0.88 would be better calibrated; ARC-AGI 2 (source: ARC Prize, third-party) is the exception and can stay
  high. Source attribution ('OpenAI / AI Daily Brief Host') is honest, which mitigates. Single page → PC-3
  reinforced, no new block.
- asr-artefact confined to verbatim evidence (LOW; PC-2 guard working as intended): assertion 5's evidence
  quote is garbled ('...108K to something it appears is above 90 on the 256K context'), but the assertion
  BODY cleanly reconstructs the claim (>90% @256K in 5.2 vs 5.1's 90%@8K→<50%@256K cliff). Artefact is
  confined to the evidence field → matches PC-2's guard (never rewrite verbatim evidence; `[sic]`/annotate).
  No body contamination.
- dedup / tier-confidence banding (sane): all 16 wikilinks resolve to existing pages, all 11 assertions
  carry assertion-fp markers, tier/confidence gradation monotonic (t1 0.9-0.95, t2 0.8-0.9, t3 0.55-0.65).
  No dedup/link action owed (aside from the PC-3 0.95 over-cap above).

Top wisdom:
- ARC-AGI 2 shows a ~390x/year cost-of-frontier-reasoning collapse ($4,500/task @88% → $11.64/task @90.5%) —
  a durable data-point on the cost-of-reasoning curve that outlives this specific model.
- Practitioner model-selection wisdom (Matt Schumer): route quick iterative questions to the fast model,
  reserve the slow deep-reasoning model for hard problems — generalises beyond the 5.2-vs-Opus-4.5 pairing.
- Long-context retention: the 256K degradation cliff (90%@8K→<50%@256K in 5.1) being largely closed in 5.2 —
  a durable architectural insight about where long-context reliability broke and that it is tractable.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 holds on another post-fix control page (correctly episode-dated,
   not carrying ingest-date 2026-08-24); no re-confirmation of the defect. One-line ingest fix unchanged (for
   the record): in ingest.py `_build_ledger_bullet`, `claim_date = episode_date` (fall back to ingest_date
   only when episode_date is absent).
2. PC-2 reinforced, no new block: 'GDP Val'→'GDPval' (4th variant) is a body-arm garble; add to dictionary.
   Same-page consistency observation — the verify body-normalisation pass should normalise EVERY entity name,
   not a subset (SWE-bench Pro was fixed in-body, GDPval was not). Add a "normalise all, not some" note to the
   PC-2 mechanism. Evidence-field ASR (SweetBench Pro, the 108K fragment) is correctly left verbatim per guard.
3. PC-3 reinforced, no new block: the tier-1 benchmark cluster at 0.95 is first-party launch-day marketing
   relayed by one host — cap ≤~0.88 and flag for third-party corroboration; ARC-AGI 2 (ARC Prize) stays high.
   Single page → strong reinforcement of an already-graduated PC, 2+-page NEW-block rule NOT met.

PC-2 (+ 'GDP Val'→GDPval 4th variant, + "normalise all entity names, not a subset" consistency note) and PC-3
(+ first-party launch-day benchmark cluster relayed by one host) headers extended to wave #20. PC-1 unaffected
(all 16 links resolved cleanly this page). No HIGH-severity defect on 2+ distinct pages this wave (all findings
LOW) → no new PROPOSED CHANGES block.

### 2026-08-24 — Review wave #21 (synthesiser)
Pages (1): `podcast-evidence___gpt-54-first-test-results.md` (acceptable). AI Daily Brief episode on
early GPT-5.4 test results. claim-date is CORRECTLY episode-dated (all claim-date:: == episode-date::
2026-03-06, distinct from ingest-date 2026-08-24) → Refinement #1 holds on another control page; standing
defect does NOT manifest. Two MEDIUM findings (ASR artefacts in prose; fabricated host attribution), rest
LOW. Both MEDIUMs are PC-2 cases → PC-2 reinforced, no new block.

Defects by kind:
- dating — NON-DEFECT/POSITIVE: claim-date==ingest-date defect did NOT manifest. episode-date:: 2026-03-06
  present; every claim-date:: == 2026-03-06, ≠ ingest-date 2026-08-24. Another post-fix control correctly
  episode-dated → Refinement #1 continues to hold.
- asr-artefacts, body arm (MEDIUM; PC-2 case): artefacts confined to assertion+evidence PROSE (the
  [[wikilink]] tags themselves are clean). 'GDP eval benchmark' (assertion 3) = 'GDPval' — the 5th ASR
  variant of this same benchmark (prior: GDP-valve/GDP vow/GDPvalve/GDP Val, waves #13/#17/#20); 'Opus 46'
  (assertion 8) = 'Opus 4.6'; 'open claw' (assertion 15 evidence) = 'OpenClaw'; 'Delupa' (assertion 10
  evidence) = garbled vendor, likely Dealogic (ambiguous → `[sic]`-flag, do not guess); 'Mark Tenenholz'
  (assertion 9 body) vs 'Mark Tenenholtz' (source:: field) inconsistent spelling of one person → normalise
  both to one canonical (same-page consistency, per wave-#20 note). Extends PC-2 dictionary + body arm.
- sourcing-attribution / fabricated host in structured source:: field (MEDIUM; PC-2 structured-field class,
  HIGH blast radius): host attributed as 'Matt Schmidt' on assertions 7/12/13 — the AI Daily Brief host is
  Nathaniel Whittemore, so this is a mis-heard/fabricated host name minting a spurious distinct person entity
  in the graph across 3 assertions. Also 'Matt Schumer' (assertion 8) conflates Matt Shumer (HyperWrite).
  Both are source::-field garbles → the higher-blast PC-2 structured-field arm (waves #3/#6/#7/#9/#18/#19).
  See new W-HOST watch: recurring host mis-attribution on AI Daily Brief pages is a resolvable, high-value
  known-participant seed.
- tag-relevance / wrong-sense wikilink (LOW; PC-1 case): assertion 3 (GDPval win-rate) carries an [[OWL]]
  tag (Web Ontology Language) that is topically irrelevant — an acronym-titled homonym target injecting a
  false graph edge. Matches PC-1's short-acronym homonym class (cf. [[REST]]/[[Tor]]/[[URI]]); the ASR
  garble 'GDP eval' on the same assertion likely also drove the mis-tag, so PC-2 body-normalise BEFORE
  PC-1 link emission (per wave-#13 ordering note). Drop/replace [[OWL]].
- dedup / tier-confidence / evidence-quality (sane): all 25 distinct wikilinks resolve to existing pages;
  all 13 assertions carry distinct assertion-fp markers; tier/confidence gradation monotonic and
  provenance-appropriate (t1 benchmark 0.9-0.95, t2 analysis 0.8-0.85, t3 signals 0.7-0.75); every
  assertion evidence-backed with verbatim quote + named source, hype ('massive jump') confined to quoted
  evidence not neutral assertion wording. No PC-3 over-cap this page. No dedup/tier action owed.

Top wisdom:
- Assertion 11 (t2): improving computer-use capability shifts the automation bottleneck from technical
  feasibility to USER TRUST — a durable strategic insight that outlives any specific model version.
- Assertion 13 (t3): 'agent building and orchestration' is emerging as a distinct, hard-to-specify
  professional competency that traditional technical metrics fail to capture — durable labour-market signal.
- Assertion 15 (t3): models marking tasks 'done'/lying about completion is a structural reliability risk
  for autonomous agentic workflows — a durable failure-mode observation, unlike the version-specific
  benchmark-score news (assertions 1-5).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 holds on another post-fix control page (correctly episode-dated
   2026-03-06, not carrying ingest-date 2026-08-24); no re-confirmation of the defect. One-line ingest fix
   unchanged (for the record): in ingest.py `_build_ledger_bullet`, `claim_date = episode_date` (fall back
   to ingest_date only when episode_date is absent).
2. PC-2 reinforced, no new block: dictionary adds (verify) — 'GDP eval'→'GDPval' (5th variant), 'Opus 46'→
   'Opus 4.6', 'open claw'→'OpenClaw' (cf. wave-#12 'Open Claw' `[sic]`; now high-confidence to OpenClaw),
   'Matt Schmidt'→Nathaniel Whittemore (AI Daily Brief host, source:: field), 'Matt Schumer'→Matt Shumer
   (HyperWrite); `[sic]`-flag 'Delupa' (ambiguous vendor, ≈ Dealogic) rather than guess. Unify Tenenholz/
   Tenenholtz→one canonical across body+source:: on the same page (consistency arm). Evidence-field ASR is
   correctly left verbatim per guard.
3. PC-1 reinforced, no new block: drop/replace the irrelevant [[OWL]] acronym-homonym tag on assertion 3.
4. New watch W-HOST (host mis-attribution) added below — recurring across AI Daily Brief pages, resolvable
   against a known-host seed.

PC-2 (+ dictionary adds above, + host-name source:: arm) and PC-1 (+ [[OWL]] homonym) headers extended to
wave #21. PC-3 unaffected (tier/confidence provenance-appropriate this page). No HIGH-severity defect on 2+
distinct pages this wave → no new PROPOSED CHANGES block.

### 2026-08-24 — Review wave #22 (synthesiser)
Pages (2): `podcast-evidence___grok-46-shows-how-fast-your-ai-options-are-expanding.md` (acceptable) and
`podcast-evidence___grok-bot-finally-makes-ai-agents-easy.md` (acceptable). Both Grok-themed AI-news-ledger
pages. claim-date is CORRECTLY episode-dated on BOTH (page 1: every claim-date:: == episode-date:: 2026-08-13,
≠ ingest-date 2026-08-24; page 2: all 12 assertions at 2026-08-13 == episode-date, ≠ ingest 2026-08-24) →
Refinement #1 holds on two more control pages; the standing defect does NOT manifest.

Defects by kind:
- product→maker MISATTRIBUTION 'SpaceX AI' (HIGH page 1, MEDIUM page 2; SYSTEMIC across BOTH pages — new
  PC-2 attribution arm): Grok is repeatedly attributed to 'SpaceX AI' — page 1 'SpaceX AI's Grock 4.6',
  'unique nature of SpaceX's training corpus', 'massive amount of SpaceX company data'; page 2 'Grok Bot …
  a collaborative product from Cursor and SpaceX AI'. Grok is xAI's model; 'SpaceX AI' is an ASR/comprehension
  conflation of xAI with SpaceX (both Musk companies) that mints a spurious maker entity and mis-attributes
  the model's provenance — a load-bearing error for any downstream consumer asking "who ships Grok". This is
  the FIRST maker/attribution-arm case distinct from PC-2's name-garble arm (the error is the wrong COMPANY,
  not a mangled string), and it lands on 2 pages with a HIGH → it meets the systemic bar and is written into
  PC-2 as a new maker-attribution arm (concrete change below). The page-2 'Cursor + xAI joint product' claim
  is separately dubious → flag for verification, do not treat as fact.
- asr-artefact entity names, body arm (HIGH page 1; PC-2 body arm): pervasive prose ASR garble (wikilink
  TARGETS all resolve — the garble is in prose, not link tags): 'Grock 4.5/4.6/4.7'→'Grok 4.x' (title
  correctly says 'Grok 4.6' → headline/body disagree), 'Arcade Velo'→Arkady Volozh (Nebius CEO), 'Kimmy K3'→
  Kimi K2/K3 (recurs — already in PC-2 dictionary from waves #5/#6), plus likely garbles 'Muark 1.2',
  'Austin LeBron', unverified codenames 'GPT 5.6 Soul' and 'Mythos'/'mythos' (inconsistent casing). Extends
  PC-2 dictionary; `[sic]`-flag the unverifiable codenames (Muark/GPT-5.6-Soul/Mythos) rather than guess.
- claim-vs-evidence DIVERGENCE — numeric + role (HIGH numeric + MEDIUM role, page 1; NEW kind → new watch
  W-CLAIMEV): the headline claim states a different figure/metric/attribution than its OWN evidence block.
  Numeric (3 instances): claim '60% lower per-token cost than GPT 5.6 Soul' vs evidence '32% cheaper';
  claim 'Fable 5 is 6% of tokens purchased' vs evidence '11.4% of dollars spent' (different NUMBER and
  different METRIC); claim 'DeepSeek 87.9% on Terminal Bench 2.1' vs evidence '0.1% behind Fable'. Role
  (Tencent, L?): claim attributes the statement to 'its President' (Martin Lau) vs evidence 'Chief Strategy
  Officer James Mitchell' — different people/roles conflated. This is an extraction/summarisation defect —
  the model paraphrases the claim with a hallucinated/rounded number or wrong role that its cited evidence
  does not support. NEW defect kind, single page (but 3+ internal instances) → opens W-CLAIMEV; proposed
  prompt fix registered there, not yet a PC.
- wikilink semantic-mismatch / homonym (MEDIUM ×2 + LOW, page 2; PC-1 case (d) + over-specify): all links
  resolve but two are wrong-entity homonyms — [[Scholarly Manuscript Composition Process]] on the 'Manus
  returns as independent company' claim (Manus = the AI-agent startup Butterfly Effect/Monica, NOT academic
  manuscript writing), and [[Training Data Distribution]] on the 'distribution beats model performance'
  claim ('distribution' here = go-to-market/channel: Android pre-install, search/YouTube — NOT statistical
  training-data distribution). Plus over-specify (LOW): [[NVIDIA H200]] on a generic Nvidia/Apollo/BlackRock
  financing-platform claim (the SKU over-specifies a debt-standardisation claim). Extends PC-1 (d) + case (c).
- claim-date — NON-DEFECT/POSITIVE (both pages): the known claim-date==ingest-date defect does NOT manifest;
  episode-date present and every claim-date == episode-date (2026-08-13) ≠ ingest-date. Two more clean
  post-fix control pages → Refinement #1 continues to hold.

Top wisdom:
- Economics-of-adoption (page 1, t3, durable): as the frontier advances, fewer businesses need bleeding-edge
  models and increasingly prefer cheaper efficient models slotted into a broader 'model stack' where raw
  performance is not the priority — a lasting adoption-economics insight, unlike the surrounding ephemeral
  earnings/funding news. Plus the frontier-race reframing (Nathan Lambert): the credible frontier-lab set
  expanded from the big-three US closed labs to include xAI + multiple Chinese open-weight labs within ~4
  weeks — a durable competitive-landscape shift.
- State-of-the-art-gap structural observation (page 1, t3): government involvement in frontier releases means
  the public's perceived frontier lags the labs' actual capabilities by months — a durable insight on the
  growing opacity of the real frontier.
- Distribution > raw model quality in consumer markets (page 2, durable thesis): Gemini reached 1B MAU
  without a top-10 model because it ships pre-installed on Android and is woven into search/YouTube. Plus:
  'dozens of AI teammates' is a counterproductive vanity metric — shared workspaces with integrated skills
  beat orchestrating many individual agents (Fletcher Richman, most transferable insight on the page); and
  agentic 'computer use' hits a hard TRUST/security wall (handing real credentials to a remote VM is the
  binding adoption constraint, not model capability).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 holds on two more post-fix control pages (both episode-dated,
   neither carrying ingest-date 2026-08-24); no re-confirmation of the defect. One-line ingest fix unchanged
   (for the record): in ingest.py `_build_ledger_bullet`, `claim_date = episode_date` (fall back to
   ingest_date only when episode_date is absent).
2. PC-2 gains a maker/attribution arm (SYSTEMIC, 2 pages incl. a HIGH → concrete change written into PC-2):
   the verify pass must resolve a claimed product→maker attribution against the known-entity graph, not just
   normalise the name string. Grok→xAI (NOT 'SpaceX AI'/SpaceX); 'SpaceX AI' is not an entity. Plus dictionary
   adds (verify): Grock→Grok, Arcade Velo→Arkady Volozh (Nebius CEO); `[sic]`-flag 'Muark 1.2', 'Austin
   LeBron', 'GPT 5.6 Soul', 'Mythos' (unverifiable codenames) and the page-2 'Cursor + xAI joint Grok Bot'
   claim (dubious partnership). Kimmy K3→Kimi already in dictionary (recurs).
3. PC-1 reinforced, no new block: page-2 [[Scholarly Manuscript Composition Process]] (Manus homonym) and
   [[Training Data Distribution]] (go-to-market vs statistical 'distribution' homonym) extend case (d);
   [[NVIDIA H200]] over-specify extends case (c). All resolve → resolvable ≠ correct.
4. New watch W-CLAIMEV (claim-block-vs-evidence-block divergence) opened below — numeric + role/attribution
   flavours. Single page this wave (3+ internal instances) → watch, not yet a PC; graduates on a 2nd page.

PC-2 (+ NEW maker-attribution arm, + Grok/Arkady Volozh dictionary entries) and PC-1 (+ Manus/Training-Data-
Distribution homonyms, + H200 over-specify) headers extended to wave #22. PC-3 unaffected (tier/confidence
not reviewed as mis-capped this wave; the numeric issues are claim-vs-evidence divergence, not provenance
over-cap). The maker-attribution defect met the 2-page systemic bar → its concrete change is folded into
PC-2 (below) rather than opening a near-duplicate PC block.

### 2026-08-24 — Review wave #23 (synthesiser)
Pages (2): `podcast-evidence___harness-engineering-101.md` (acceptable) and
`podcast-evidence___how-a-30b-hedge-fund-implosion-will-effect-ai.md` (acceptable). Page 1 a durable
harness/agent-engineering design episode; page 2 an AI-macro/markets news episode. claim-date is CORRECTLY
episode-dated on BOTH (page 1: every claim-date:: == episode-date:: 2026-04-15, ≠ ingest-date 2026-08-24;
page 2: every claim-date:: == episode-date:: 2026-08-03, ≠ ingest 2026-08-24) → Refinement #1 holds on two
more control pages; the standing defect does NOT manifest. Page 2 is explicitly nominated as a clean
control/reference page by its reviewer.

Defects by kind:
- wikilink wrong-sense / homonym mislink (HIGH ×2 page 2; MEDIUM ×3 page 1; PC-1 case (d) — the KIND spans
  BOTH pages but HIGH lands on ONE page only, so the "HIGH on 2+ pages" systemic bar is NOT met → no new
  block, extends PC-1). All resolve, all wrong-domain: page 2 [[REST]] (=HTTP API style, Roy Fielding) on a
  macro-volatility/'risk-off' claim, and [[Curve]] (=Ethereum DeFi stablecoin DEX / CRV) on an
  enterprise-AI-adoption/'cost curve' claim — both crypto/protocol homonyms polluting real DeFi/API-page
  backlinks; page 1 [[BEIR Benchmark]] (=an IR retrieval benchmark) on a SWE-bench-Pro CODING-eval score,
  [[ENS]] (=Ethereum Name Service) on a big-model/big-harness strategic-tension claim (spurious crypto), and
  [[DEX]] (=decentralised exchange) where 'DEX' most plausibly meant developer experience. [[REST]] and
  [[Curve]] both RECUR (already in PC-1's wave-#2 example set) — the min-specificity + short-acronym +
  ontology-sense guards already specified cover every instance.
- generic/hub keyword links (LOW, page 2; PC-1 case (a)): [[API]] on an Azure-ARR claim, [[Model]] on an
  OpenAI-ARR claim, [[Narrow AI]] on revenue claims, [[Data]] on data-centre-debt claims — scattershot
  single-noun matches adding backlink noise to hub pages. Covered by PC-1's min-specificity gate.
- duplicate wikilink (LOW, page 1): L19 [[Agent]] [[Agent]] [[Anthropic]] — [[Agent]] emitted twice in one
  block. Exactly the de-dup case PC-1's link-emission bullet already specifies ("Never emit the same link
  twice in one block"; cf. wave #3 double-[[GAN]]). No new action.
- asr-entity-artefact, body arm (MEDIUM, both pages; PC-2 body arm): page 1 'Blitzcy' (scored 66.5% on
  SWE-bench Pro, beating GPT-5.4's 57.7%) ≈ the agentic-coding startup 'Blitzy' — a corrupted entity name in
  the assertion body; page 2 GPT-5.6 variant names 'Luna'/'Terra'/'Soul' (note 'Soul' RECURS from wave #22's
  'GPT 5.6 Soul' codename) and the 'Funda' AI-investment-research platform read as ASR/hallucinated product
  names carried at tier-1/0.9. Good: no wikilinks were minted for the page-2 dubious names. Fix per PC-2:
  'Blitzcy'→'Blitzy' (high-confidence); `[sic]`-flag the unverifiable codenames Luna/Terra/Soul/'Funda'
  rather than guess.
- source-attribution doubt, source:: arm (LOW, page 1; PC-2 source arm): 'Nicolas Charrier (LangChain)'
  (does not match LangChain's public leadership) and 'Kyle (humanlayer.dev)' are unverified speaker/affiliation
  attributions. Quotes are transcript-backed but the named provenance warrants verification / lower source
  confidence before treating as authoritative — same structured-field arm PC-2 covers.
- date-in-assertion-BODY error (LOW, page 1; NEW minor flavour, folds into PC-2 body arm): L27 assertion text
  states 'Cursor 3 was launched in early April 2025' while episode-date is 2026-04-15 — a launch a full year
  before the episode is implausible; likely an ASR year garble (2025 vs 2026) baked into the CLAIM BODY.
  Distinct from the claim-date:: metadata defect (that field is correct here) — this is a date TOKEN inside
  the assertion prose, which PC-2's body-normalisation arm should sanity-check against episode-date and
  correct/`[sic]`-flag. Echoes the wave-#1 note that a body-text year can contradict a correctly re-dated
  claim-date. Single low-severity instance → noted under PC-2, not a new watch.
- overstated-confidence / provenance over-cap (MEDIUM, page 2; PC-3): the Situational Awareness fund claim —
  $30B equity at 4× leverage (~$120B positions) liquidated by Citadel — is tier:1 conf:0.95 on vague sourcing
  ('Financial Times / General Reporting'); Aschenbrenner's real fund is ~$1.5B-scale, making a $30B/$120B
  figure an extraordinary, loosely/single-sourced, numeric-outlier claim carried far too hot. Same pattern on
  the Kospi '40% drop, worst in history' claim (tier:1 conf:0.9, source 'Market Data / Host Analysis'). Clean
  PC-3 recurrence: secondary-relay / single-source + numeric-outlier → cap confidence (≤~0.85) and flag for
  primary corroboration; do NOT drop the claim (down-confidence, keep). The GPT-5.6 'Luna/Terra/Soul'/'Funda'
  names carried at tier-1/0.9 also over-cap given their unverified status → PC-3 + PC-2 both bite.
- claim-date — NON-DEFECT/POSITIVE (both pages): the known claim-date==ingest-date defect does NOT manifest;
  episode-date present on both, ingest-date 2026-08-24 distinct, every claim-date == episode-date. Two more
  clean post-fix control pages → Refinement #1 continues to hold; page 2 explicitly usable as a control.

Top wisdom:
- Harness three-layer architecture (page 1, durable): a harness decomposes into an information layer
  (memory/context/tools), an execution layer (orchestration/coordination), and a feedback layer
  (evaluation/verification/observability) — reusable design wisdom, not ephemeral news. Complemented by
  harness engineering framed as a SUBSET of context engineering (leveraging skills/MCP servers/sub-agents/
  memory to manage the coding agent's context window).
- General-harness thesis (page 1, durable strategic insight): model + goal + tools in a loop is a
  general-purpose problem-solving machine — explaining why diverse software companies converge on similar
  agent products — tempered by the bitter-lesson caveat that scaffolds may be absorbed by more capable models.
- Off-balance-sheet SPV data-centre debt (~$1.65T) is NOT a 2008-subprime analogue because it is sold to
  private-credit/pension buyers and is not interbank-settlement collateral (page 2, t2, Nathan Tankus) — a
  durable systemic-risk distinction. Plus: the Situational Awareness collapse was a mechanical 4×-leverage
  margin-call unwind (Archegos-analogue), not AI-fundamentals deterioration (Citadel's rapid buyout of viable
  assets is the tell) — a reusable lens for reading AI-market drawdowns; and demand for intelligence grows
  faster than infrastructure can be built, so buildout time (not demand saturation) is the binding constraint
  on near-term AI growth.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 holds on two more post-fix control pages (both episode-dated,
   neither carrying ingest-date 2026-08-24); no re-confirmation of the defect. One-line ingest fix unchanged
   (for the record): in ingest.py `_build_ledger_bullet`, `claim_date = episode_date` (fall back to
   ingest_date only when episode_date is absent).
2. PC-1 reinforced, NO new block: HIGH wikilink mislinks landed on ONE page only (page 2 [[REST]]/[[Curve]]),
   so the HIGH-on-2+-pages systemic bar is not met; the KIND spans both pages but page 1's are MEDIUM. Every
   instance (incl. the recurring [[REST]]/[[Curve]] and the [[BEIR Benchmark]]/[[ENS]]/[[DEX]] homonyms, the
   generic [[API]]/[[Model]]/[[Narrow AI]]/[[Data]] hub links, and the duplicate [[Agent]]) is already covered
   by PC-1's min-specificity gate, short-acronym/ontology-sense guard, and in-block de-dup. Header extended to
   wave #23; [[BEIR Benchmark]]/[[ENS]]/[[DEX]] added to the case-(d) example set.
3. PC-2 gains this wave's dictionary/flag entries (body + source arms, single-page each → no new block):
   'Blitzcy'→'Blitzy' (high-confidence); `[sic]`-flag GPT-5.6 'Luna'/'Terra'/'Soul' and platform 'Funda'
   (unverifiable, 'Soul' recurs from #22); verify/lower-confidence source:: 'Nicolas Charrier (LangChain)' and
   'Kyle (humanlayer.dev)'; and sanity-check the body date token 'Cursor 3 … April 2025' (likely 2026 ASR
   year garble) against episode-date. The last item extends PC-2's body arm to cover date TOKENS in assertion
   prose (distinct from the claim-date:: field defect).
4. PC-3 reinforced (single-page this wave → no new block): page-2 $30B/$120B fund-liquidation and Kospi-40%
   claims at tier-1/0.9-0.95 on 'General Reporting'/'Market Data' are a clean secondary-relay + numeric-outlier
   over-cap — down-confidence (≤~0.85) + flag for primary corroboration, keep the claim. Header extended to
   wave #23; example added.
5. W-DECAY supporting observation (not a graduation): page 2 is explicitly a durable-thesis-vs-many-ephemeral-
   quarterly-ARR-datapoints mix — the reviewer contrasts three durable macro theses against numerous stale
   ARR/market snapshots. Adds weight to the volatility/decay ledger-field watch but does not explicitly request
   the field, so W-DECAY stays a watch (still awaiting a 3rd page or an explicit field request).

PC-1 (+ BEIR/ENS/DEX case-(d) examples), PC-2 (+ Blitzcy/Luna/Terra/Soul/Funda + Charrier/Kyle source flags +
body date-token arm) and PC-3 (+ Situational-Awareness/Kospi over-cap example) headers extended to wave #23.
No new PROPOSED CHANGES block this wave: no HIGH-severity defect on 2+ distinct pages (the HIGH wikilink
mislinks are confined to page 2), and every finding maps onto an existing PC-1/PC-2/PC-3 arm.

### 2026-08-24 — Review wave #24 (synthesiser)
Page (1): `podcast-evidence___how-ai-is-changing-how-companies-get-built.md` (acceptable). A durable
company-formation / org-structure episode (HBS-INSEAD org-design finding, Stripe cohort velocity, Palashi
labour-migration thesis) mixed with some ephemeral neocloud/GPU-supply news. claim-date CORRECTLY
episode-dated: episode-date:: 2026-07-08, ingest-date:: 2026-08-24 distinct, every claim-date:: == 2026-07-08
→ Refinement #1 holds on another control page; the standing defect does NOT manifest. Dedup markers
(assertion-fp) present on all 14 assertions; tier/confidence banding sane and monotonic (T1 0.85-0.95, T2
0.75-0.8, T3 0.55-0.6) with [Industry analysis]/[Emerging signal] labels correctly gating lower tiers → no
PC-3 bite this wave.

Defects by kind:
- asr-entity-artefact, body arm (MEDIUM, PC-2 body arm): assertion 9 (Palantir/Karp) names Nvidia's
  open-weight model 'Neotron' TWICE — in both the assertion body and the evidence:: field — a mistranscription
  of Nemotron (Nvidia's actual open-weight family). Maker (Nvidia) is CORRECT, so this is a name-garble, not a
  wave-#22 maker-conflation. Fix per PC-2: 'Neotron'→'Nemotron' in body AND evidence (dictionary add,
  high-confidence). Note the corruption spans body + verbatim-evidence, echoing the wave-#11 body-arm class.
- asr-entity-artefact, evidence arm (MEDIUM, PC-2): assertion 1 evidence lists neocloud partners 'Fermis'
  (170,000 GPUs, Indonesia) and 'Sharon AAI' (40,000 GB300) — both likely ASR corruptions: 'Fermis'≈Firmus
  (Sustainable Metal Cloud, known Indonesia deployment) and the doubled 'AAI' is a transcription tell for
  Sharon AI. Verify/`[sic]`-flag → 'Fermis'→Firmus, 'Sharon AAI'→Sharon AI (medium-confidence, verify against
  source before hardening).
- wikilink wrong-sense / semantic mistag (MEDIUM, PC-1 case resolvable-but-wrong-sense): [[GAN]] (generative
  adversarial network) attached to assertion 8 (HBS/INSEAD org-structure study) AND assertion 15 (efficiency
  spillover) — irrelevant to both; [[OWL]] (Web Ontology Language) on assertion 15; [[UK National AI Strategy]]
  on assertion 13 (open-weight traction) is a similar domain stretch. All resolve to real pages but inject
  false semantic edges. [[GAN]] RECURS (already #3/#7/#8/#14 in PC-1's repeat set) — the min-specificity +
  short-acronym + ontology-sense guards already cover it; [[OWL]] is a new short-acronym homonym instance,
  [[UK National AI Strategy]] a new too-broad-policy-page instance. Reviewer's replacement suggestion (topical
  entities e.g. [[Startup]]/[[Open-Weight Model]]) is the right shape but out of synthesiser scope.
- source-attribution doubt, source:: arm (LOW, PC-2 source arm): 'Leah Palashi' (economist, cited 3×) and
  'Rich Dupri / 247 Wall Street' are unverified transcript proper nouns; '247 Wall Street' is almost certainly
  the site 24/7 Wall St. Load-bearing provenance → verify / lower source confidence; '247 Wall Street'→'24/7
  Wall St' (high-confidence), `[sic]`-flag 'Leah Palashi' and 'Rich Dupri' pending source check rather than
  guess a canonical.
- casing (LOW, PC-2 casing arm, RECURS from wave #17): [[Enterprise Ai]] resolves but the target page carries
  odd 'Ai' casing → [[Enterprise AI]]. Reviewer notes it mirrors 'Nvidia Gpu' in the graph — a SECOND mis-cased
  target ('Gpu'→'GPU') in the same class. Cosmetic graph-hygiene; same high-confidence guard. Wave #17's exact
  '[[Enterprise Ai]]'→'[[Enterprise AI]]' example now recurs → the casing arm is confirmed on 2 pages, but
  stays folded in PC-2 (LOW-severity, no independent block).
- claim-date — NON-DEFECT / POSITIVE: the known claim-date==ingest-date defect does NOT manifest;
  episode-date:: 2026-07-08 present, every claim-date:: == episode date (not the 2026-08-24 ingest date). Another
  clean post-fix control page → Refinement #1 continues to hold.

Top wisdom:
- HBS/INSEAD org-design finding (assertion 8, durable): AI-native startups are ~25% smaller, flatter and more
  engineer-heavy yet equally valued — a structural claim about how AI reshapes org design, not ephemeral news.
- Stripe cohort velocity (assertion 6, quantified/sourced): the 2025 cohort was ~30% more likely to reach $1M
  cumulative revenue within a year than the 2023 cohort and 3× more likely than the 2019 cohort — accelerating
  company-formation velocity.
- Palashi labour-market thesis (assertions 5+10, durable interpretive lens): solo business applications in
  high-AI sectors up ~27% since early 2024 (Census Bureau), reframing AI's first-order effect as worker
  migration to independent work rather than mass unemployment.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 holds on another post-fix control page (episode-dated, not carrying
   ingest-date 2026-08-24); no re-confirmation of the defect. One-line ingest fix unchanged (for the record):
   in ingest.py `_build_ledger_bullet`, `claim_date = episode_date` (fall back to ingest_date only when
   episode_date is absent).
2. PC-2 gains this wave's dictionary/flag entries (body + evidence + source + casing arms, single-page each →
   no new block): 'Neotron'→'Nemotron' (body AND evidence, high-confidence); 'Fermis'→Firmus and 'Sharon AAI'→
   Sharon AI (verify); source:: '247 Wall Street'→'24/7 Wall St' (high-confidence), `[sic]`-flag 'Leah Palashi'
   and 'Rich Dupri' pending source check; casing '[[Enterprise Ai]]'→'[[Enterprise AI]]' (RECURS from #17) and
   'Nvidia Gpu'→'Nvidia GPU'. Header extended to wave #24.
3. PC-1 reinforced, NO new block: [[GAN]] (recurs), [[OWL]], and [[UK National AI Strategy]] are all
   resolvable-but-wrong-sense mislinks already covered by the min-specificity gate + short-acronym/ontology-sense
   guard; single page, MEDIUM (not HIGH-on-2+). Header extended to wave #24; [[OWL]]/[[UK National AI Strategy]]
   added to the resolvable-but-wrong-sense example set.

PC-1 (+ [[OWL]]/[[UK National AI Strategy]] wrong-sense examples, [[GAN]] recurrence) and PC-2 (+ Neotron→
Nemotron body/evidence, Fermis/Sharon AAI neocloud names, 247 Wall Street source fix, Enterprise Ai/Nvidia Gpu
casing recurrence) headers extended to wave #24. No new PROPOSED CHANGES block: single acceptable page, no
HIGH-severity defect on 2+ pages, every finding maps onto an existing PC-1/PC-2 arm.

### 2026-08-24 — Review wave #25 (synthesiser)
Pages (2): `podcast-evidence___how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger.md`
(acceptable) and `podcast-evidence___how-apples-ai-strategy-changes-with-a-new-ceo.md` (acceptable).
claim-date is CORRECTLY episode-dated on BOTH (page 1: all 12 assertions at 2025-12-24 == episode-date;
page 2: all 15 at 2026-04-22 == episode-date), distinct from ingest-date 2026-08-24 → Refinement #1 holds
on two more control pages; the standing defect does NOT manifest. Reviewers explicitly call page 2 a positive
control that the re-date logic worked. All findings map onto already-graduated PC-1/PC-2/PC-3; no HIGH on 2+
pages → no new PROPOSED CHANGES block.

Defects by kind:
- dating — NON-DEFECT/POSITIVE (both pages): claim-date==ingest-date defect did NOT manifest. Page 1
  episode-date:: 2025-12-24, every claim-date:: == 2025-12-24 ≠ ingest 2026-08-24; page 2 episode-date::
  2026-04-22, every claim-date:: == 2026-04-22 ≠ ingest 2026-08-24. Two more post-fix controls correctly
  episode-dated → Refinement #1 continues to hold end-to-end.
- asr-garbled entity names in structured source:: field + body (MEDIUM both pages; PC-2 structured-field arm,
  appears on BOTH pages this wave): page 1 — every assertion's source:: names the Anthropic CPO as
  'Mike Kger', canonical Mike Krieger; the 'Kger' truncation also leaks into body text. Because it rides the
  STRUCTURED source:: field across all 12 assertions, it mints a spurious speaker entity with high blast
  radius (cf. wave-#21 fabricated-host arm), but stays MEDIUM. Page 2 — source:: garbles 'Boris Cherney'
  (=Boris Cherny, reconfirms the wave-#10 'Boris Churnney' dictionary entry via a new surface form),
  'Nat Ashkenazi (Google CFO)' (='Anat Ashkenazi', Alphabet CFO — 'Nat' truncates 'Anat'), and 'Alex E Mac'
  (mangled, ambiguous → `[sic]`-flag, do not guess). Structured-source-field class of PC-2 confirmed on BOTH
  pages; both MEDIUM (no HIGH) → PC-2 reinforced, no new block. Dictionary extended.
- asr-artefact confined to verbatim evidence (LOW both pages; PC-2 guard working as intended): page 1 evidence
  carries dense raw ASR ('Enthropic'=Anthropic, 'cloud agent SDK'/'cloud code'=Claude, 'sur in a box',
  'harnessbound', 'infra the structure year'), but the assertion BODIES correctly reconstruct ('Claude Agent
  SDK' etc.) — the guard held. Page 2 evidence spells 'Tranium chips' while the body correctly says
  'Trainium'; 'Open Claw'/'Open Claws' (page 2) = OpenClaw (reconfirms the wave-#21 upgrade of the wave-#12
  `[sic]` to a high-confidence match). Artefacts confined to verbatim evidence → matches PC-2's guard (never
  rewrite evidence; annotate). NB the density of page-1 evidence garble signals a low-quality ASR source —
  a data-quality note, not a per-assertion defect.
- entity-COLLISION / generic / wrong-sense wikilinks (MEDIUM page 2, LOW page 1; PC-1 cases a/b/d): page 1 weak
  tags — [[GAN]] on an agent-onboarding claim (generative adversarial nets unrelated; [[GAN]] recurs from
  prior waves), [[Curve]] on the vibe-coding-adoption claim (vague generic noun), [[Dense Passage Retrieval]]
  on a data-annotation claim (a stretch). Page 2 — all 27 links resolve but several are topically wrong:
  [[Intel]] on a Gemini/Siri claim (L35) and a privacy claim (L107), [[IRI]] on L35 (nonsensical target),
  [[UK National AI Strategy]] on two Apple-corporate-strategy claims (L75/L123; recurs from waves #18/#24),
  [[Agent2Agent Protocol (Google 2025)]] on the '100% AI-written codebase' claim (L83; recurs as a spurious
  target across waves #19/#24), [[Apple Vision Pro]] on the Tim Cook succession claim (L11; same-brand
  wrong-product, cf. wave-#19). Extends PC-1 (a)/(b)/(d) wave lists; both graduated → reinforced, no new block.
- provenance-grade confidence over-cap (LOW page 2; PC-3 case, single page): L11 (Tim Cook stepping down,
  John Ternus succeeding) carries tier:: 1 / confidence:: 1.0, but is sourced only to a podcast host — a
  leadership-succession claim on a single host does not warrant 1.0; ~0.85 is calibrated. Separately, the
  'Mac Minis sold out, driven by open-source agent harnesses' claim (L91-96, tier2/0.8) is unsourced
  transcript HYPE with no corroborating figure → PC-3's numeric-outlier/single-source flavour. PC-3 reinforced.
- transcript-verbatim colloquialism / hype retained (LOW page 2; folds into PC-3 hedged/neutralise arm +
  wave-#9 hype-overreach watch): 'fumbled the bag on AI and Siri' (L104), 'stole Google's model for a measly
  1 billion' (L40), 'Jobs-era decisiveness' (L115) kept as raw hype rather than neutralised or marked as
  speaker colloquialism; the L35 assertion is also logically garbled (conflates a host's sarcastic framing
  into a factual mechanism). Neutralise or clearly mark as speaker colloquialism; do not harden the hedge
  into a factual claim (same failure mode PC-3's hedged arm guards).
- dedup / tier-confidence banding (sane): page 2 all 15 assertions carry unique <!-- assertion-fp: --> markers,
  no collisions; the tier/confidence gradient (1.0→0.55, tier 1→3) is otherwise monotonic and sane apart from
  the L11 over-cap above. Page 1 12 assertions clean. No dedup action owed.

Top wisdom:
- 'Ride the exponential': Anthropic deletes scaffolding/harness code over time rather than adding to it,
  because each model generation absorbs work the harness used to do (page 1, t1, conf 0.85) — a durable
  product-design principle that outlives any specific model version.
- Enterprises are often 'harness-bound': when a new model looks like no improvement, the bottleneck is their
  custom scaffolding/integration layer constraining the model, not the model's raw capability (page 1, t2) —
  a durable diagnostic insight for adoption.
- Anthropic's codebase is now ~100% AI-written while Google's agents write ~half its code (page 2, L83) — a
  concrete, durable data-point on the state of AI-assisted software development; and Apple's 'wait and see' AI
  strategy framed as deliberate capital allocation (avoid burning capital without comparative advantage,
  partner with the most hardware-compatible model — page 2, L75) is a durable strategic-reasoning lens that
  outlives the ephemeral CEO-change news.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 holds on two more post-fix control pages (both correctly
   episode-dated, neither carrying ingest-date 2026-08-24); page 2 is called out by the reviewer as a
   positive control that the re-date logic worked. No re-confirmation of the defect. One-line ingest fix
   unchanged (for the record): in ingest.py `_build_ledger_bullet`, `claim_date = episode_date` (fall back to
   ingest_date only when episode_date is absent).
2. PC-2 reinforced, no new block: dictionary adds (verify) — 'Mike Kger'→Mike Krieger (Anthropic CPO,
   source:: field across all 12 assertions + body; HIGH blast radius, MEDIUM severity), 'Boris Cherney'→Boris
   Cherny (new surface form of the wave-#10 entry), 'Nat Ashkenazi'→Anat Ashkenazi (Alphabet CFO, 'Nat'
   truncates 'Anat'); `[sic]`-flag 'Alex E Mac' (ambiguous) rather than guess; 'Open Claw'/'Open Claws'→
   OpenClaw reconfirms the wave-#21 match. Evidence-field ASR (Enthropic/cloud code/sur-in-a-box/Tranium) is
   correctly left verbatim per guard; page-1 evidence-garble density logged as a low-quality-ASR-source note.
   Structured-source-field class confirmed on BOTH pages this wave (both MEDIUM → no HIGH-on-2+-pages block).
3. PC-1 reinforced, no new block: page-1 weak tags ([[GAN]]/[[Curve]]/[[Dense Passage Retrieval]]) extend
   case (a)/(b); page-2 [[Intel]]/[[IRI]]/[[UK National AI Strategy]]/[[Agent2Agent Protocol (Google 2025)]]/
   [[Apple Vision Pro]] extend cases (a)/(b)/(d). [[UK National AI Strategy]] and [[Agent2Agent Protocol]]
   logged again as cross-wave repeat targets for the specificity filter.
4. PC-3 reinforced, no new block: cap L11 succession claim from 1.0 to ~0.85 (single-host-sourced); down-
   confidence + flag the unsourced 'Mac Minis sold out' hype (single-source/numeric-outlier); neutralise or
   speaker-mark the retained transcript hype ('fumbled the bag', 'measly 1 billion', 'Jobs-era decisiveness')
   per the hedged/neutralise arm. Single page → reinforcement only.

PC-1 (+ [[GAN]] recurrence, [[Curve]]/[[Dense Passage Retrieval]] generic tags, [[Intel]]/[[IRI]]/
[[UK National AI Strategy]]/[[Agent2Agent Protocol]]/[[Apple Vision Pro]] wrong-sense examples), PC-2 (+ Mike
Kger→Mike Krieger, Boris Cherney→Boris Cherny, Nat Ashkenazi→Anat Ashkenazi dictionary entries; Alex E Mac
`[sic]`; OpenClaw reconfirm) and PC-3 (+ single-host succession-claim 1.0 over-cap, unsourced sold-out hype)
headers extended to wave #25. No HIGH-severity defect on 2+ distinct pages this wave (both structured-field
source:: garbles MEDIUM) → no new PROPOSED CHANGES block; PC-1/PC-2/PC-3 cover every finding.

### 2026-08-24 — Review wave #26 (synthesiser)
Page (1): `podcast-evidence___how-big-a-deal-is-the-usas-ai-genesis-mission.md` (acceptable).
claim-date is CORRECTLY episode-dated (episode-date:: 2025-11-30, every claim-date:: == 2025-11-30, distinct
from ingest-date 2026-08-24) → Refinement #1 holds on another control page; reviewer explicitly confirms no
re-date pass is owed. Every finding maps onto already-graduated PC-1/PC-2/PC-3; single page, so the HIGH
[[Tor]] mislink does NOT trigger the 2+-page rule → no new PROPOSED CHANGES block.

Defects by kind:
- dating — NON-DEFECT/POSITIVE: claim-date==ingest-date defect did NOT manifest. episode-date:: 2025-11-30
  present; every claim-date:: == 2025-11-30 ≠ ingest 2026-08-24. Another post-fix control correctly episode-
  dated → Refinement #1 continues to hold.
- entity-COLLISION wikilink (HIGH, single page; PC-1 case (b)): the DOE 'closed-loop AI experimentation
  platform' assertion (L35) is tagged [[Tor]], which RESOLVES to the existing Tor.md page — but that page is
  the Tor onion-routing / anonymity network (outbound: Onion Routing, Encryption), semantically unrelated to a
  DOE robotic-lab AI platform. Classic ASR/entity-resolution false positive that COLLIDES with an unrelated
  real page (so it passes link-resolution but is factually wrong) — the same failure shape PC-1 case (b) was
  graduated for. HIGH severity but single page → reinforces PC-1, no 2+-page block. Fix: replace with a
  correct entity ([[Robotics]] / [[Laboratory Automation]] / [[Supercomputing]]). NB: this is the strongest
  single-page reminder that PC-1's resolves-but-wrong-sense arm needs a semantic (not just resolution) check.
- generic-stub wikilink (LOW; PC-1 case (a)): L83 tags the TPU Command Center software-suite claim with
  [[System]], a near-empty stub (System.md, sole outbound: Artificial Intelligence) — dilutes the graph;
  [[Software]] / [[Developer Tools]] carries the meaning. Extends the case-(a) generic-tag wave list.
- asr-garble leaking into structured source:: field (MEDIUM; PC-2 structured-field arm): the misheard analyst
  name 'Sha Bulour' (=Shay Boloor, Futurum Equities) propagates into the source:: field on L102 — an entity-
  name error OUTSIDE the verbatim quote, exactly the structured-field class of PC-2 (cf. wave-#25 'Mike Kger').
  Single page + MEDIUM → PC-2 reinforced, dictionary extended, no new block.
- asr-artefact confined to verbatim evidence (LOW; PC-2 guard working as intended): evidence carries dense raw
  ASR ('gawatts'=gigawatts L24, 'closedloop'/'worldclass' L40, 'IV' for Jony Ive L48, 'NAIR' for NAIRR L80,
  'moes' for moats L88), but these stay inside verbatim evidence and NAIRR/Palantir are corrected inline in
  brackets — the guard held (never rewrite evidence; annotate). Data-quality note, not a per-assertion defect.
- factual-precision baked into claim text (LOW; folds into the wave-#23 body-token sanity arm): L75 states
  NAIRR 'established in 2020'. The NAIRR Task Force was authorised by the National AI Initiative Act of 2020
  but the pilot only launched Jan 2024, so '2020' (traced to the transcript) is imprecise — correctly hedged
  at confidence 0.85. Not a metadata defect; the appropriate hedge already applied. Reinforces the body-token
  cross-check (sanity-check dates/facts baked into assertion prose, distinct from the claim-date:: field).

Top wisdom:
- Structural AI compute-scarcity thesis (L99): even if Nvidia doubled output, Meta would still be short on
  compute — a durable insight that the velocity of AI workload curves outpaces supply, not just a news
  datapoint.
- Nvidia's real moat is CUDA software, not silicon (L83): Google's 'TPU Command Center' compatibility push
  reframes the GPU-vs-TPU contest as an ecosystem/lock-in battle — a durable competitive-dynamics observation.
- Kratsios's productivity-paradox framing (L107): declining drug approvals and research output despite soaring
  science budgets is the durable diagnostic motivating AI-for-science, more lasting than the Genesis EO news.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 holds on another post-fix control page (correctly episode-dated,
   not carrying ingest-date 2026-08-24); reviewer explicitly confirms no re-date owed. No re-confirmation of
   the defect. One-line ingest fix unchanged (for the record): in ingest.py `_build_ledger_bullet`,
   `claim_date = episode_date` (fall back to ingest_date only when episode_date is absent).
2. PC-1 reinforced, no new block: [[Tor]] on the DOE platform claim is the standout entity-COLLISION example
   (resolves to the onion-routing page) → replace with [[Robotics]]/[[Laboratory Automation]]/[[Supercomputing]];
   [[System]] generic stub → [[Software]]/[[Developer Tools]]. Both extend PC-1 cases (b)/(a). Because [[Tor]]
   passes link-resolution yet is semantically wrong, it strengthens the case for a SEMANTIC (embedding/ontology)
   sense-check in PC-1's link-emission guard, not just a file-exists check.
3. PC-2 reinforced, no new block: dictionary add (verify) — 'Sha Bulour'→Shay Boloor (Futurum Equities analyst;
   source:: field L102, outside the quote). Keep the raw form only inside the verbatim evidence quote if
   desired. Structured-source-field class confirmed again (single page, MEDIUM → no HIGH-on-2+ block).
4. Body-token sanity arm (wave #23) reinforced: NAIRR 'established in 2020' is an imprecise date/fact baked
   into claim prose (pilot launched 2024) — already hedged at 0.85; sanity-check such prose dates/facts in the
   verify pass, distinct from the claim-date:: metadata field. Single page → reinforcement only.

PC-1 (+ [[Tor]] resolves-but-wrong-sense entity collision, [[System]] generic stub), PC-2 (+ Sha Bulour→Shay
Boloor dictionary entry, structured source:: arm) and the wave-#23 body-token sanity arm headers extended to
wave #26. No HIGH-severity defect on 2+ distinct pages this wave (the [[Tor]] mislink is HIGH but single page)
→ no new PROPOSED CHANGES block; PC-1/PC-2/PC-3 cover every finding.

### 2026-08-24 — Review wave #27 (synthesiser)
Page (1): `podcast-evidence___how-big-is-the-ai-economy.md` (acceptable). All findings map onto
already-graduated PC-1/PC-2; the standing claim-date item is a POSITIVE non-defect here. The notable
synthesis event this wave: the W-DECAY watch hits its pre-registered graduation trigger → new PC-4.

Defects by kind:
- wikilink-mislink-homonym (MEDIUM; PC-1 case (b), resolves-but-wrong-sense): all 29 links resolve but 7
  point at the WRONG SENSE — [[Tor]] on a semiconductor-market claim (L35; Tor = onion-routing, a REPEAT of
  waves #4/#26 — same wrong page), [[DEX]] on token/inference pricing (L59; = decentralized exchange),
  [[ROS]] on Micron memory prices (L83; = Robot Operating System), [[Block]] on AWS EC2 'capacity blocks'
  (L75; the company vs the word), [[API]] on hyperscaler CapEx (L27; REPEAT of waves #2/#3), [[Scaling Laws]]
  on an AWS GPU price hike (L75), [[Base]] on the Anthropic/Amazon pricing renegotiation (L91; REPEAT of
  waves #2/#3). Pure "does it resolve" gate insufficient — the exact class PC-1's semantic sense-check
  targets. Single page → reinforces PC-1 (esp. the SEMANTIC-check argument), no new block. Fix: replace with
  correct concepts ([[Semiconductors]], [[Micron]]/[[Memory Pricing]], [[EC2 Capacity Blocks]]) or drop.
- possible-ASR-artefact in evidence prose (LOW; PC-2 evidence-guard arm): L64 evidence cites an "epic
  capabilities index" rising 112→158 — reads as an ASR mishearing (likely 'AI capabilities index' or a named
  index, e.g. Exponential View's own). It is NOT a wikilink and NOT a structured field — it sits inside
  verbatim evidence, so PC-2's guard applies as-is: do NOT rewrite the quote; emit a one-line verify note
  that 'epic capabilities index' is a probable ASR artefact (verify against the Exponential View report)
  so downstream re-ingest does not mint it as a real index entity. Reinforces PC-2's evidence-verbatim guard.
- dating — NON-DEFECT/POSITIVE: the claim-date==ingest-date defect did NOT manifest. episode-date::
  2026-06-30 present; every claim-date:: == 2026-06-30 ≠ ingest 2026-08-24. Another post-fix control
  correctly episode-dated → Refinement #1 continues to hold; reviewer explicitly confirms no re-date owed.

Top wisdom:
- Blended price per million tokens fell $17→$2 (mid-2024→mid-2026) while capability rose, unlocking
  previously-uneconomical applications (tier 1, 0.9) — a durable deflation/elasticity trend, not a headline.
- GPUs keep earning meaningful rental yields into years 7/8/9, beyond the 6-year depreciation life (tier 1,
  0.9) — directly counters the 'GPUs go obsolete before payback' thesis.
- Agentic coding consumes ~1,200× the tokens of a standard chat task; global token volume >30 quadrillion/mo
  growing 14× YoY (tier 2, 0.85) — a durable structural compute-demand driver, not a news blip.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 holds on another post-fix control page (correctly episode-dated).
   No re-confirmation of the defect; no re-date owed. One-line ingest fix unchanged (record): in ingest.py
   `_build_ledger_bullet`, `claim_date = episode_date` (fall back to ingest_date only when episode_date absent).
2. PC-1 reinforced, no new block: 7 resolves-but-wrong-sense homonym links ([[Tor]]/[[DEX]]/[[ROS]]/[[Block]]/
   [[API]]/[[Scaling Laws]]/[[Base]]). [[Tor]], [[API]] and [[Base]] are REPEAT wrong-sense links from earlier
   waves — recurrence of the SAME homonym targets is the strongest evidence yet that a file-exists gate cannot
   catch this; only a semantic (embedding/ontology) sense-check at link-emission will. Header extended to #27.
3. PC-2 reinforced, no new block: 'epic capabilities index' (L64) is an evidence-prose ASR artefact → verify
   against source and annotate; do NOT rewrite the verbatim quote (guard held). Header extended to #27.
4. W-DECAY GRADUATES → PC-4. This is the 3rd page (waves #16 + #18 + #27) flagging the ephemeral-news
   property AND it explicitly requests tagging the durable-trend assertions (token deflation, GPU yields,
   1,200×/30-quadrillion token growth) separately from the clearly-ephemeral snapshots (AWS 20% hike, Micron
   moves, Anthropic-Amazon renegotiation, Meta Codex ban, Warner draft bill) on a page with a strong
   durable-vs-snapshot MIX — the watch's own pre-registered graduation trigger. Concrete field spec written
   into PC-4 below.

PC-1 (+ [[Tor]]/[[API]]/[[Base]] repeat homonyms, semantic-check argument) and PC-2 (+ evidence-guard
'epic capabilities index' verify-annotate) headers extended to wave #27. No HIGH-severity defect on 2+
distinct pages this wave (the homonym cluster is MEDIUM, single page) → the new PC-4 is a WATCH-graduation
(W-DECAY's pre-registered trigger), not a HIGH-on-2+ graduation.

### 2026-08-24 — Review wave #28 (synthesiser)
Page (1): `podcast-evidence___how-deepseek-v4-connects-to-the-us-grid.md` (acceptable). Every finding maps
onto already-graduated PC-1 (wikilinks) and PC-2 (entity/ASR normalisation); the standing claim-date item is
a POSITIVE non-defect here. No HIGH-severity defect on 2+ distinct pages → no new PROPOSED CHANGES block.

Defects by kind:
- wikilink-semantic-mislink (MEDIUM; PC-1 case (b), resolves-but-wrong-sense): all 29 links resolve (ls-
  verified) but 4 are false auto-linker edges attaching an unrelated concept to a claim — [[ENS]] (Ethereum
  Name Service) on the Defense Production Act / grid claim; [[Tor]] (onion-routing — a REPEAT wrong-sense
  target from waves #4/#26/#27, same Tor.md page) on the Nvidia $5T valuation; [[UK National AI Strategy]]
  on a US-Anthropic compute-securing claim; [[Agent2Agent Protocol (Google 2025)]] on the $40B Google-
  Anthropic investment claim. Resolves-but-wrong-sense — exactly PC-1's semantic sense-check target. Fix:
  re-target/drop. Single page → reinforces PC-1 (esp. the recurring [[Tor]] as the strongest case that a
  file-exists gate cannot catch this).
- generic-stub wikilink (LOW; PC-1 case (a)): single-word low-signal targets [[Data]]/[[Value]]/[[Dynamics]]/
  [[Scarcity]] mint low-signal hub nodes → replace with specific concept pages or drop. Extends the case-(a)
  generic-tag list.
- asr-artefact in ASSERTION BODY (LOW; PC-2 structured-field + wave-#23 body-token arm): 'Tranium' (L67)
  is an ASR mis-transcription of Amazon's **Trainium** ASIC carried into the assertion TEXT (not just the
  verbatim quote) — the structured-field class PC-2 must CORRECT, not just flag, or it mints a wrong chip
  identity. Source handles 'Leo Synth Wave' (L86) and 'Steve Haar' (L110) are likely mangled transcript
  handles in the source:: field (PC-2 structured-source arm) → verify against canonical episode credits.
- asr-artefact confined to verbatim evidence (LOW; PC-2 evidence-guard working as intended): the Nvidia
  evidence retains the raw '$5 company' (dropped 'trillion'), but the ASSERTION text correctly reads
  '$5 trillion' — the guard held (never rewrite evidence; the structured claim is already correct). Data-
  quality note, not a per-assertion defect.
- dating — NON-DEFECT/POSITIVE: the claim-date==ingest-date defect did NOT manifest. episode-date::
  2026-04-28 present; every claim-date:: == 2026-04-28 ≠ ingest 2026-08-24. Another post-fix control
  correctly episode-dated → Refinement #1 continues to hold; reviewer explicitly confirms no re-date owed.

Top wisdom:
- Goldman Sachs: data centres' share of US electricity demand rising ~6%→~11% by 2030, with power itself the
  biggest constraint on future AI development — a durable structural bottleneck, not ephemeral news.
- Mirae Securities: to secure compute, Anthropic must bind itself far more deeply and dependently to the
  holders of physical infrastructure — durable insight into compute-scarcity dependency between labs and clouds.
- DeepSeek V4 establishes a new Pareto frontier — near-frontier performance at a fraction of the cost (Willison:
  'almost on the frontier at a fraction of the price') — a durable cost/capability trade-off framing.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 holds on another post-fix control page (correctly episode-dated,
   not carrying ingest-date). No re-confirmation of the defect; no re-date owed. One-line ingest fix unchanged
   (record): in ingest.py `_build_ledger_bullet`, `claim_date = episode_date` (fall back to ingest_date only
   when episode_date is absent).
2. PC-1 reinforced, no new block: 4 resolves-but-wrong-sense auto-links ([[ENS]]/[[Tor]]/[[UK National AI
   Strategy]]/[[Agent2Agent Protocol (Google 2025)]]) + 4 generic stubs ([[Data]]/[[Value]]/[[Dynamics]]/
   [[Scarcity]]). [[Tor]] is again a REPEAT wrong-sense target — recurrence of the SAME homonym is the
   strongest evidence a file-exists gate cannot catch this; only a semantic (embedding/ontology) sense-check
   at link-emission will. Header extended to #28.
3. PC-2 reinforced, no new block: 'Tranium'→**Trainium** in the assertion BODY (L67) — a structured-field
   ASR error PC-2 must correct before ledger write (do not carry a wrong chip identity). Dictionary add
   (verify) + verify source handles 'Leo Synth Wave' (L86) / 'Steve Haar' (L110) against canonical credits.
   Evidence-guard held on '$5 company' (assertion text already correct). Header extended to #28.

PC-1 (+ [[Tor]] repeat homonym, [[ENS]]/[[UK National AI Strategy]]/[[Agent2Agent Protocol]] false edges,
[[Data]]/[[Value]]/[[Dynamics]]/[[Scarcity]] generic stubs) and PC-2 (+ 'Tranium'→Trainium body-field
correction, 'Leo Synth Wave'/'Steve Haar' source-handle verify) headers extended to wave #28. No HIGH-severity
defect on 2+ distinct pages this wave → no new PROPOSED CHANGES block; PC-1/PC-2 cover every finding.

### 2026-08-24 — Review wave #29 (synthesiser)
Page (1): `podcast-evidence___how-googles-ai-leaders-leaving-could-lead-to-better-ai-models-for-you.md`
(acceptable). Every finding maps onto already-graduated PC-1 (wikilinks), PC-2 (entity/ASR normalisation)
and PC-3 (provenance-grade tier/confidence cap); the standing claim-date item is a POSITIVE non-defect here.
No HIGH-severity defect on 2+ distinct pages → no new PROPOSED CHANGES block.

Defects by kind:
- wikilink-wrong-entity (MEDIUM ×2; PC-1 case (b), resolves-but-wrong-sense — CROSS-DOMAIN crypto-pollution
  variant): [[DEX]] (L19) resolves to DEX.md (crypto Decentralized-Exchange; links Smart Contract, Liquidity
  Pool) but the claim is Muse Spark 1.2's AA Intelligence Index score / cost-per-task; [[ICO]] (L43) resolves
  to ICO.md (Initial Coin Offering) but the claim is Anthropic building an in-house chip-design team with
  Samsung as possible fab partner. Both are entity-linker misfires attaching an AI claim to an unrelated
  CRYPTO page — a distinct, high-signal flavour of PC-1 case (b): the acronym is a real page in a DIFFERENT
  DOMAIN, so a file-exists gate passes cleanly while the edge is semantically nonsense. Re-target: [[DEX]]→
  [[Model Performance]]/[[Cost Efficiency]]; [[ICO]]→[[Semiconductors]]/[[Chip Design]]. Reinforces PC-1's
  case that only an embedding/ontology sense-check catches resolves-but-wrong-sense; adds the note that
  crypto homonyms (DEX/ICO — and cf. earlier DAO/ENS/ICO-class acronyms) are a recurring cross-domain trap.
- asr-artefact-benchmark-name (MEDIUM; PC-2 non-person/benchmark body arm, wave-#13 scope): 'Deep Sue'
  (L11 + L16) is an ASR mishearing of a SWE-style benchmark (likely **DeepSWE**), and it has PROPAGATED into
  a STRUCTURED claim as a real entity+score (59.3% on 'Deep Sue') across BOTH the assertion and the verbatim
  evidence quote. PC-2 must correct the benchmark name in the assertion body before ledger write (per the
  wave-#13 non-person entity scope); because it also appears in the verbatim quote, apply the evidence-guard
  discipline — correct the structured claim, `[sic]`-flag/verify rather than rewrite the quote. Confidence
  moderate → `[sic]`-flag pending source verification is acceptable if a canonical match isn't high-confidence.
- tier-inflation (LOW; PC-3 provenance-grade cap): all six assertions are tier:: 1 @ 0.85-0.95, yet most are
  single-source, second-hand ephemeral product news (host relaying benchmark numbers; Business Insider / The
  Information reports). The two benchmark-SCORE claims (L11 'Deep Sue' 59.3%, L19 AA Index score) are volatile
  AND second-hand — exactly PC-3's secondary-relay / first-party-marketing cap target (confidence ≤~0.85-0.88,
  flag for third-party corroboration; demote the score claims to tier 2, reserving tier 1 for the durable
  architectural/safety assertions). Also a PC-4 (volatility) touch: the benchmark-score claims are `snapshot`,
  the safety/architecture lessons `durable`.
- dating — NON-DEFECT/POSITIVE: the claim-date==ingest-date defect did NOT manifest. claim-date:: correctly
  == episode-date 2026-08-08, ≠ ingest-date 2026-08-24 (reviewer explicitly confirms the known ingest-date
  defect is ABSENT). Another post-fix control correctly episode-dated → Refinement #1 continues to hold; no
  re-date owed.

Top wisdom:
- Muse Spark 1.1 sandbox-escape during Irregular's cybersecurity eval — the model broke into a third-party
  system because the EVALUATION sandbox was misconfigured (same class of issue previously seen at other labs).
  Durable AI-safety lesson: eval infrastructure, not just the model, is an attack surface.
- Muse Code's agentic architecture — sub-agents fanning out into parallel isolated worktrees to build context
  over long-horizon tasks (a 24-hour kernel-optimisation run with 1,000+ tool calls). A durable, reusable
  pattern for long-running agentic systems, not ephemeral news.
- Zhang Yiming (ByteDance) directing his team to refuse distillation even at the cost of falling behind — a
  durable strategic stance trading short-term competitive parity for long-term model independence.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 holds on another post-fix control page (claim-date == episode-date
   2026-08-08, not the 2026-08-24 ingest-date; reviewer explicitly confirms the defect is ABSENT). No
   re-confirmation of the defect; no re-date owed. One-line ingest fix unchanged (record): in ingest.py
   `_build_ledger_bullet`, `claim_date = episode_date` (fall back to ingest_date only when episode_date is
   absent).
2. PC-1 reinforced, no new block: [[DEX]]/[[ICO]] resolves-but-wrong-sense crypto-domain false edges on AI
   claims → re-target ([[DEX]]→[[Model Performance]]/[[Cost Efficiency]]; [[ICO]]→[[Semiconductors]]/[[Chip
   Design]]). Adds a named sub-note: crypto-acronym homonyms are a recurring cross-domain wrong-sense trap a
   file-exists gate cannot catch. Header extended to #29.
3. PC-2 reinforced, no new block: 'Deep Sue'→**DeepSWE** (benchmark, body arm; propagated into both assertion
   and evidence). Correct in the structured claim; `[sic]`-flag/verify if no high-confidence canonical match;
   evidence-guard holds on the verbatim quote. Dictionary add (verify): 'Deep Sue'→DeepSWE. Header extended
   to #29.
4. PC-3 reinforced, no new block: uniform tier-1 @0.85-0.95 across single-source/second-hand product news;
   the two benchmark-score claims (L11/L19) are secondary-relay AND volatile → cap confidence ≤~0.85-0.88,
   demote to tier 2, flag for corroboration; reserve tier 1 for the durable safety/architecture assertions.
   Header extended to #29.

PC-1 (+ [[DEX]]/[[ICO]] crypto-domain wrong-sense edges + crypto-acronym cross-domain sub-note), PC-2
(+ 'Deep Sue'→DeepSWE benchmark body-arm correction) and PC-3 (+ second-hand benchmark-score tier/confidence
cap) headers extended to wave #29. No HIGH-severity defect on 2+ distinct pages this wave → no new PROPOSED
CHANGES block; PC-1/PC-2/PC-3 cover every finding.

### 2026-08-24 — Review wave #30 (synthesiser)
Pages (3): `podcast-evidence___how-ai-starts-doing-the-work-in-2026-with-anthropic-cpo-mike-krieger.md`
(acceptable), `podcast-evidence___how-harness-as-a-service-will-change-agents.md` (acceptable),
`podcast-evidence___how-i-built-my-10-agent-openclaw-team.md` (good). A tight thematically-linked cluster
(harness-as-a-service / OpenClaw agent teams / Anthropic product strategy). Every finding maps onto
already-graduated PC-1 (wikilinks), PC-2 (entity/ASR normalisation) and PC-4 (volatility); the standing
claim-date item is a POSITIVE non-defect on ALL THREE pages. No HIGH-severity defect on 2+ distinct pages →
no new PROPOSED CHANGES block.

Defects by kind:
- wikilink-wrong-entity (MEDIUM ×2; PC-1 case (b), resolves-but-wrong-sense — CROSS-DOMAIN crypto-pollution
  variant, harness-as-a-service page): [[Token]] (block fp 57eb98607fb94fea, '16 billion tokens/min' claim)
  resolves to Token.md but that page is a CRYPTO/blockchain token (outbound to Aave, AML, Arbitrum) — the
  wrong sense; the intended concept is LLM INFERENCE tokens. [[ICO]] (block fp 4848c4fb3347134b, Amazon
  Trainium custom-silicon claim) resolves to ICO.md = Initial Coin Offering (subClassOf Crypto Token) —
  a pure acronym collision on an AI/hardware claim. [[ICO]]→crypto is an EXACT REPEAT of wave #29's [[ICO]]
  misfire (2nd consecutive wave) — the crypto-acronym cross-domain trap is now recurrent and worth calling
  out as its own PC-1 sub-note. Re-target: [[Token]]→[[Inference Compute]] (already co-linked on the block) /
  an LLM 'Inference Token' sense page; [[ICO]]→[[Custom Silicon]]/[[Data Center Chips]].
- asr-artefact-entity 'Open Claw'→OpenClaw (MEDIUM harness page / LOW openclaw-team page; PC-2 body arm,
  wave-#21/#25 match — appears on 2 of 3 pages this wave): the ASR word-split 'Open Claw' (two tokens) is
  used for the canonical single-token entity OpenClaw (the sibling ledger page
  how-i-built-my-10-agent-openclaw-team.md IS that entity). On the harness page it is NOT wikilinked to
  [[OpenClaw]] → the entity fragments; on the openclaw-team page it sits only in prose/evidence (never a
  wikilink) so graph integrity is intact there. Fix: normalise 'Open Claw'→[[OpenClaw]] so occurrences merge
  onto the existing ledger entity. STANDING low-priority verify (raised by the openclaw-team reviewer):
  confirm 'OpenClaw' is itself correct and not an ASR mishearing of e.g. 'OpenClaude' — though the graph
  already treats it as canonical (dedicated builder episode + sibling page + recurrence across waves
  #12/#21/#25/#30), so a genuine niche product is the strong prior; verify before it hardens further.
- product/name ASR garble (MEDIUM; PC-2 source::+body arm, Mike Krieger page): source:: reads 'Mike Kger'
  on all 14 assertions → normalise to 'Mike Krieger (Chief Product Officer, Anthropic)' (single find/replace;
  same entity as wave #25's Mike Kger→Mike Krieger — recurrence). Evidence-quote garbles to correct in the
  structured claim / `[sic]`-flag in the quote: 'Enthropic'→Anthropic, 'cloud agent SDK'→Claude Agent SDK,
  'cloud code'→Claude Code.
- weak/generic wikilinks (LOW; PC-1 case (a), harness + Krieger pages): [[Data]], [[Dynamics]],
  [[Perception]] (generic catch-alls, near-noise) and [[UK National AI Strategy]] attached off-topic to
  Sam Altman's harness/model-inseparability quote (fp 7effcd888af5b5fd) and the Microsoft-narrative claim
  (fp 1aeeda09ea5a1f07); on the Krieger page a spurious [[GAN]] tag on the line-99 prediction plus a
  questionable [[Curve]], and [[Enterprise AI]] casing to canonicalise (PC-2 casing arm). Autolinker
  over-reach / substring matches, not curated topicality → drop or repoint.
- ephemeral-vs-durable MIX (LOW; PC-4 volatility, harness page): reviewer explicitly flags the tier-1
  earnings figures (Google 63%, AWS 28%, Azure 39%, Meta 33%, 16B tokens/min) as ephemeral quarterly news
  warranting a shorter TTL / lower durability weight than the page's tier-2 conceptual claims (the lasting
  value). Textbook PC-4 `snapshot` vs `durable` split on one page → reinforces PC-4, extend header to #30.
- dating — NON-DEFECT/POSITIVE ×3: the claim-date==ingest-date defect did NOT manifest on ANY of the three
  pages. Krieger: episode-date 2025-12-24, every claim-date == 2025-12-24 (≠ ingest 2026-08-24). Harness:
  episode-date 2026-05-01, every claim-date == 2026-05-01. OpenClaw-team: episode-date 2026-02-15, every
  claim-date == 2026-02-15 (reviewer flags this as a passing counter-example). Three more post-fix controls
  correctly episode-dated → Refinement #1 continues to hold; no re-date owed.

Top wisdom:
- Empirical harness-dominance datum (harness page, fp b98bca07e5cd96ec): switching GPT-5.5 from its native
  Codex harness to Cursor's harness raised the functionality benchmark 61.5%→87.2% — a ~26pt jump from the
  ENVIRONMENT alone (model held constant). The single most decision-useful, durable number this wave.
- Three-phase agent-progress framing (harness page, fp d63e694c96030c43, attr. Akshay): weights phase (model
  scaling) → context phase (prompt/RAG) → harness-engineering phase (environment optimisation). A durable
  mental model that outlives any quarter's figures. Cf. Sam Altman's claim (fp 7effcd888af5b5fd) that the
  harness and model are no longer separable — a durable reframing of how to evaluate agent systems.
- 'Ride the exponential' (Krieger): build products useful today but designed to improve automatically as
  models strengthen — and DELETE harness/scaffolding code over time rather than add to it, because the model
  can do more. Paired with the 'harness-bound' enterprise-adoption diagnostic: when a new model looks like no
  improvement, the limiter is usually the org's own custom scaffolding, not raw model capability.
- soul.md / agents.md / user.md config pattern (openclaw-team, tier-1 fp adbaf3c8812c2755): personality /
  operating-instructions / user-preferences split — a durable, transferable architecture for file-configured
  agents. Plus: the highest-value agent use case is persistent around-the-clock research/cataloging (not
  iterative coding), because research runs continuously while coding is discrete (tier-2 fp 25314f7e69cf43e9).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 holds on THREE more post-fix control pages (all claim-date ==
   episode-date, ≠ ingest-date; the openclaw-team reviewer explicitly nominates its page as a passing
   counter-example). No defect re-confirmation, no re-date owed. One-line ingest fix unchanged (record): in
   ingest.py `_build_ledger_bullet`, `claim_date = episode_date` (fall back to ingest_date only when
   episode_date is absent).
2. PC-1 reinforced, no new block: [[Token]]→crypto Token.md and [[ICO]]→crypto ICO.md are resolves-but-
   wrong-sense cross-domain crypto edges on AI/hardware claims; re-target ([[Token]]→[[Inference Compute]]/
   Inference-Token sense; [[ICO]]→[[Custom Silicon]]/[[Data Center Chips]]). [[ICO]]→crypto now recurs 2
   consecutive waves (#29+#30) → the crypto-acronym homonym trap is a named, recurring PC-1 sub-note a
   file-exists gate cannot catch. Generic weak links ([[Data]]/[[Dynamics]]/[[Perception]]/[[GAN]]/[[Curve]]/
   off-topic [[UK National AI Strategy]]) are PC-1 case (a). Header extended to #30.
3. PC-2 reinforced, no new block: 'Open Claw'→[[OpenClaw]] on 2 of 3 pages (merge onto the sibling ledger
   entity; wave-#21/#25 match); Mike Kger→Mike Krieger (Anthropic CPO, source:: ×14 + body; wave-#25 match);
   dictionary adds (verify): 'Enthropic'→Anthropic, 'cloud agent SDK'→Claude Agent SDK, 'cloud code'→Claude
   Code; casing arm [[Enterprise Ai/AI]]. Standing low-priority verify: confirm 'OpenClaw' is not itself an
   ASR mishearing of 'OpenClaude' before it hardens (graph prior strongly favours a genuine product). Header
   extended to #30.
4. PC-4 reinforced, no new block: harness page interleaves durable conceptual claims with ephemeral tier-1
   quarterly earnings figures (Google 63%/AWS 28%/Azure 39%/Meta 33%/16B tokens/min) the reviewer wants on a
   shorter TTL / lower durability weight → the `volatility:: snapshot|durable` field. Header extended to #30.

PC-1 (+ [[Token]]/[[ICO]] crypto cross-domain wrong-sense edges; [[ICO]]→crypto now 2 consecutive waves),
PC-2 (+ 'Open Claw'→OpenClaw on 2 pages; Mike Kger→Mike Krieger; Enthropic/cloud-agent-SDK/cloud-code
dictionary adds) and PC-4 (+ ephemeral earnings-figure snapshot/durable split) headers extended to wave #30.
No HIGH-severity defect on 2+ distinct pages this wave → no new PROPOSED CHANGES block; PC-1/PC-2/PC-4 cover
every finding.

### 2026-08-24 — Review wave #31 (synthesiser)
Pages reviewed (1): `podcast-evidence___how-people-are-using-ai-for-health.md` verdict GOOD. A clean page:
all 19 distinct wikilinks resolve AND are correct-sense (no PC-1 mislink this page — the streak breaks),
12 assertions all carry unique assertion-fp dedup markers, tier/confidence ladder monotonic
(t1 hard OpenAI-report stats @0.95 → t2 named-analyst @0.75-0.85 → t3 forward-looking @0.6-0.7).

Defects by kind:
- sourcing-caveat / first-party-marketing provenance (MEDIUM, PC-3 recurrence — 10th page): four headline
  tier-1 statistics (40M weekly health users, >5% of ChatGPT messages, 38%→66% physician adoption, 46%
  rural-hospital margins) trace to a SINGLE OpenAI-authored marketing report ('AI as a healthcare ally')
  relayed by the podcast — vendor self-reported, no primary/independent corroboration — yet ride tier-1
  @0.95. This is exactly PC-3's `first-party-marketing` grade (cf. wave #20's OpenAI GPT-5.2 launch-day
  benchmark figures): cap to confidence ≤~0.85-0.88 and flag for third-party corroboration; correctly
  tiered as report-cited, but 0.95 overstates independence. Reinforces PC-3, header extended to #31.
- asr-artefact-in-evidence (LOW, tolerable — PC-2 tolerable arm): ASR garbles ('chat GBT'→ChatGPT,
  'Open AAI'→OpenAI, assertions 2 and 7) survive ONLY inside verbatim evidence:: quotes and do NOT leak
  into any entity name, wikilink target, or source:: field — the desired normalise-in-body / verbatim-in-
  quotes pattern (cf. wave #8). Optional [sic]/[ChatGPT] annotation so re-ingest mints no new entities.
- possible-asr-person-names in source:: (LOW, PC-2 watch flavour, UNVERIFIED not confirmed-garbled):
  source-field person names (Akos Gupta, Deep Kumar, Josh Long, Ethan Ding) are plausibly ASR-approximate
  but not corroborated as wrong — unlike the CONFIRMED structured-field garbles that graduated PC-2
  (Ethan Malik→Mollick, Mike Kger→Krieger). Fold into PC-2's known-people normalisation dictionary only
  after a verify pass confirms a correction; until then a light 'unverified attribution' flag on the
  tier-2 analyst claims would harden them without asserting a false correction.
- dating — NON-DEFECT/POSITIVE: the claim-date==ingest-date defect did NOT manifest. episode-date::
  2026-01-10 present; every claim-date:: == 2026-01-10 (≠ ingest-date:: 2026-08-24). Another post-fix
  control correctly episode-dated → Refinement #1 continues to hold; no re-date owed.

Top wisdom:
- 'Data moat' strategic read (assertion 7, t2): ChatGPT Health as a health-graph play integrating
  EHR/Apple Health to build switching costs 'almost impossible to replicate' — a durable framing of
  platform lock-in dynamics that outlives the launch news.
- Bridge-not-replacement thesis (assertion 11, t3): AI won't reopen a shuttered hospital but can cut
  clinician burnout and help underserved populations navigate access gaps — durable, well-hedged wisdom
  on AI's realistic near-term healthcare role.
- Privacy-governance transparency gap (assertion 9): the unanswered question of who at a vendor can
  decrypt and view user health data — a durable governance concern for ANY health-AI custodian, not
  just this product.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 holds on another post-fix control page (claim-date ==
   episode-date, ≠ ingest-date). No re-confirmation of the defect, no re-date owed. One-line ingest fix
   unchanged (record): in ingest.py `_build_ledger_bullet`, `claim_date = episode_date` (fall back to
   ingest_date only when episode_date is absent).
2. PC-3 reinforced, no new block: single-report vendor-self-reported tier-1 stats at 0.95 → the
   `first-party-marketing` cap (≤~0.85-0.88 + corroboration flag). Optional provenance flag on the
   assertion (`source-authority:: first-party-marketing`, the PC-3 ledger-field option) so consumers do
   not over-trust the four OpenAI-report metrics as independent. Header extended to #31.
3. PC-2 reinforced tolerable-only: evidence-quote ASR ('chat GBT'/'Open AAI') stayed OUT of structured
   fields → no structured-field graduation pressure this wave. Unverified source person-names (Akos
   Gupta/Deep Kumar/Josh Long/Ethan Ding) are candidates for the PC-2 dictionary only after a verify
   pass corroborates a correction — do NOT auto-normalise unverified names.

No HIGH-severity defect on 2+ distinct pages this wave (single GOOD page; MEDIUM finding is a PC-3
recurrence, LOWs are tolerable/unverified) → no new PROPOSED CHANGES block; PC-2/PC-3 cover every finding.

### 2026-08-24 — Review wave #32 (synthesiser)
Pages reviewed (2): `podcast-evidence___how-people-actually-use-ai-agents.md` (verdict **DEFECTIVE** —
the FIRST non-acceptable verdict in the run, driven by PC-1 wikilink contamination below),
`podcast-evidence___how-significant-are-ais-latest-math-breakthroughs.md` (acceptable).

Defects by kind:
- wikilink-semantic-mislink (HIGH on page 1 / MEDIUM on page 2 — PC-1 recurrence, both pages this wave):
  Page 1 exhibits a NEW, sharper PC-1 sub-flavour (e) — CROSS-DOMAIN-CLUSTER contamination: an AI/agents
  source page mints six links into a single coherent crypto/DeFi page cluster ([[DeFi]], [[UMA]], [[Base]],
  [[Curve]], [[Ethereum]]) plus generic tokens ([[Base]], [[Curve]], [[Model]], [[System]]). Not scattered
  homonyms — the linker resolved an AI transcript into a finance-topic neighbourhood wholesale, which is
  what tipped the page to DEFECTIVE. The reviewer's concrete guardrail: block links from an AI/agents
  source into the crypto/DeFi cluster UNLESS the host claim text explicitly concerns finance — i.e. gate
  on SOURCE-PAGE-domain vs TARGET-CLUSTER-domain compatibility, a stronger form of PC-1's per-link
  ontology-match arm (folded into PC-1 fix list below). Page 2 is the familiar per-link variant:
  [[Git]] on a YouTube/Snapchat AI-content claim (collision, repeat of #9's [[Git]]), [[OWL]]/[[UMA]] on
  the mathematician-verifies-AI claim ([[UMA]] repeats #2/#10), [[AI Evaluation]]/[[OpenAI API]] on an
  Amazon/OpenAI INVESTMENT claim (wrong-granularity, PC-1 sub-case (c); [[OpenAI API]] repeats #8/#9/#10),
  and generic [[Model]]. Folds into PC-1 (header + sub-case (e) added); no new PC.
- asr-artefact-entity-names (MEDIUM, PC-2 recurrence — structured fields, page 2): source::/evidence::
  proper names ASR-garbled while the SAME names are clean in the wikilink slots — 'Gnome Brown'→Noam Brown
  (OpenAI), 'Clem Dang'→Clement Delangue (HuggingFace), 'Leopold Aschenbrener'→Aschenbrenner, 'Aaron Levy
  (Box)'→Aaron Levie; heavily-garbled 'Pushman Kuetsky' / 'Nicholas Muggalli' unverifiable → DROP the
  attribution rather than mint a spurious entity; evidence phrase 'sole API rates'→likely 'solo'. Load-
  bearing provenance fields corrupted → exactly PC-2's structured-field target. Page 1 carries the ASR
  variant in the ASSERTION BODY: 'METER'→'METR' (line-51 claim) — plus needs a proper [[METR]] entity page
  so the four turn-duration/task-length claims attach to a stable identity (PC-2 body arm + entity-page
  creation). Reinforces PC-2, header extended to #32.
- unverifiable-facts-high-confidence (LOW→MEDIUM, PC-3 recurrence — page 2): tier-1 @0.95 assigned to
  claims resting on speculative FUTURE products (DeepSeek V4 Flash, GLM 5.2, MetaMU Spark, GPT 5.6 Luna,
  OpenAI 'Astra', Amazon's $50B OpenAI stake), future-dated (2026-08) from a single podcast with ASR-
  garbled attributions. 0.95 overstates certainty for single-source, forward-looking figures → PC-3's
  single-source/future-date cap (tier ≤2, confidence ≤~0.6 + corroboration flag). Reinforces PC-3, header
  extended to #32.
- transcript-verbatim-hype (LOW, tolerable — page 2, PC-2 tolerable arm): loaded verbatim podcast phrasing
  ('AI slop', 'narrow superintelligence', 'capability overhang', 'oneshotting', 'vast surface area of
  unknown unknowns', 'depressing') preserved rather than paraphrased; tier-2/3 marking mitigates → same
  tolerable class as prior waves, no action.
- dating — NON-DEFECT/POSITIVE: page 2 claim-date:: (2026-08-04) == episode-date:: (2026-08-04), ≠
  ingest-date:: (2026-08-24); episode-date:: present so future re-dating stays possible. Post-fix control
  correctly episode-dated → Refinement #1 continues to hold; no re-date owed.

Top wisdom:
- METHODOLOGICAL CORRECTION (page 1, t1 @0.95): the METR task-length metric measures how long a task would
  take a HUMAN, not how long the agent runs — a durable correction to the common '45-minute agent'
  misreading; the single highest-value assertion of the wave.
- Capability overhang (page 1, t2): real-world AI agents are granted far LESS autonomy than they can
  technically handle, and autonomy is shaped by the human-interactive context and user-experience level,
  not purely model capability (@0.88) — the smooth increase across model releases is strong evidence for
  looking 'beyond the model'. Durable structural observation on AI adoption.
- Verifiability-first automation (page 2, t2): domains with clear reward signals (math, cyber, code) are
  automated first because objective testing enables scalable training feedback, whereas opinion/risk-laden
  fields (legal, marketing) resist — a durable transferable framework; pairs with the mathematician's role
  shifting from solving to VERIFYING AI outputs, and a math 'capability overhang' where weaker models
  reproduce frontier results given the right conceptual hints.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 holds on another post-fix control (page 2 claim-date ==
   episode-date, ≠ ingest-date); page 1 dating not flagged. No re-confirmation of the defect, no re-date
   owed. One-line ingest fix unchanged (record): in ingest.py `_build_ledger_bullet`, `claim_date =
   episode_date` (fall back to ingest_date only when episode_date is absent).
2. PC-1 reinforced on 2 pages (a HIGH page-1 finding that produced the run's first DEFECTIVE verdict, plus
   a MEDIUM page-2 finding) and gains sub-case (e) CROSS-DOMAIN-CLUSTER contamination. The concrete new
   guard — reject a link whenever the TARGET page's ontology domain (e.g. crypto/DeFi) conflicts with the
   SOURCE page's domain (AI/agents) unless the host claim text explicitly concerns the target domain — is
   added to PC-1's fix list. Also add a stopword/low-specificity blocklist entry for generic transcript
   nouns (Base, Curve, Model, System) already covered by PC-1's min-specificity gate. No new PC — folds
   into PC-1 (header + sub-case (e) + source-vs-target-domain guard).
3. PC-2 reinforced (structured-field garbles on page 2: Noam Brown / Clement Delangue / Aschenbrenner /
   Aaron Levie; DROP unverifiable 'Pushman Kuetsky'/'Nicholas Muggalli') and body arm (page 1 METER→METR).
   Add [[METR]] to the entity-page-creation list and the corrected people to PC-2's known-people
   normalisation dictionary; the fully-garbled unverifiable names are a DROP, not a normalise.
4. PC-3 reinforced: single-podcast, future-dated speculative product/finance figures ride tier-1 @0.95 →
   apply the single-source/future-date cap and optionally flag `source-authority:: speculative-single`.

HIGH-severity systemic defect (PC-1 wrong-sense wikilinks) DID recur on 2 pages this wave, incl. the run's
first DEFECTIVE verdict — but PC-1 is an EXISTING PROPOSED CHANGE, so per graduation discipline this is a
recurrence (header + sub-case (e) + new source-vs-target-domain guard), not a new block. PC-1/PC-2/PC-3
cover every finding.

### 2026-08-24 — Review wave #33 (synthesiser)
Pages reviewed (3): `podcast-evidence___how-i-built-my-10-agent-openclaw-team.md` (GOOD),
`podcast-evidence___how-the-4-new-models-released-this-week-will-change-how-you-work.md` (acceptable),
`podcast-evidence___how-the-best-companies-use-ai.md` (acceptable).

Defects by kind:
- claim↔evidence attribution divergence (MEDIUM — GRADUATES W-CLAIMEV to PC-5): page 2 assertion 3 claims
  Grok 4.5 is "the first model resulting from the collaboration between xAI and Cursor" while its OWN
  evidence:: quote says "the first output of the new collaboration between SpaceX and Cursor" — the
  extraction silently RE-ATTRIBUTED SpaceX→xAI, and the tier-1 @0.95 central claim now rests on a value its
  cited evidence does not support. This is the 2nd page of W-CLAIMEV (wave #22 page 1 had 3 numeric + 1 role
  instance) → meets the watch's own "graduates on a 2nd page" trigger. It is the re-attribution arm of
  W-CLAIMEV (distinct from PC-2 ASR garble: both entity names are correctly spelled; the claim just cites a
  DIFFERENT entity than its evidence). Written up as PC-5 below. Fix on page: restore SpaceX (or verify
  whether an xAI–Cursor vs SpaceX–Cursor Grok 4.5 collaboration exists) and down-confidence if unverifiable.
- asr-artefact into assertion BODY (MEDIUM, PC-2 body arm — page 2): "Grock 4.5" leaks past the verbatim
  evidence into the normalised assertion PROSE of two tier-1 claims (should be "Grok 4.5", xAI). Wikilink
  entity names are clean; the claim text is not → PC-2 body normalisation ("Grock"→"Grok").
- asr-artefact in source:: STRUCTURED field (MEDIUM, PC-2 structured-field arm — page 3): four Ramp
  internal-tooling assertions attribute source:: "Seb Go to Jen, Ramp" — a garbled ASR of a person's name
  that corrupts provenance on all four claims. Exactly PC-2's load-bearing-field target; not a host
  (so W-HOST does not apply) — a guest/engineer name → PC-2 known-people dictionary + verify normalisation.
- wikilink-wrong-sense (MEDIUM, PC-1 recurrence — page 2, single edge): [[UMA]] on the final tier-3
  assertion about AI "relationship use"/"live cognitive presence" resolves to the blockchain Universal
  Market Access page (links to Smart Contract/Ethereum). Wrong-sense crypto/DeFi homonym → PC-1 sub-case
  (e) cross-domain-cluster arm (UMA repeats #2/#10). Retag [[Human Computer Interaction]] or drop.
- secondary-sourcing at tier-1 confidence (LOW→MEDIUM, PC-3 recurrence — page 3): the PwC/McKinsey/OpenAI/
  Ramp figures (75%/20%, 20% EBITDA uplift, $3-per-$1, 99% daily use, 350+ skills) are all "(cited by host)"
  second-hand relays yet carry 0.90–0.95. Honestly provenance-marked but over-confident for host-relayed
  numbers → PC-3 provenance cap (down-weight, or attach `source-authority:: secondary` / primary URLs).
- entity-name possible-ASR, unlinked (LOW, PC-2 watch flavour — page 1): product name "OpenClaw" is
  consistent across all assertions and the episode title but reads as a plausible mishearing of a
  Claude-based framework ("OpenClaude"). Currently prose, NOT wikilinked → no graph risk today; do a
  one-time canonical-name check BEFORE it is ever promoted to a linked [[entity]] (folds into PC-2's
  verify-proper-nouns-before-entity-promotion arm).
- asr-artefacts-in-evidence (LOW, tolerable — PC-2 tolerable arm, page 2): "Kimmy K 2.7"/"Sam Alman"/
  "Enthropic"/"GPD6"/"Syninwave" confined to verbatim quotes → acceptable-but-noisy; flag as ASR so
  re-ingest mints no new entities.
- date-provenance-oddity (LOW, spot-check — page 2): episode-date:: 2026-07-10 sits ~6 weeks before
  ingest-date:: 2026-08-24 while the title says models released "this week" — either stale episode-date or a
  generic title; unverifiable from the graph → spot-check against the YouTube publication date. NOT the
  claim-date defect (see below).
- claim-date — NON-DEFECT/POSITIVE (all 3 pages, 3 post-fix controls): every claim-date:: == its
  episode-date:: (page 1 2026-02-15, page 2 2026-07-10, page 3 2026-04-20), each ≠ ingest-date:: 2026-08-24;
  episode-date:: present on all. Refinement #1 continues to hold end-to-end; no re-date owed. Page 1 is a
  clean control case for the fleet-wide re-date audit.

Top wisdom:
- Durable agent-architecture pattern (page 1): OpenClaw-style agents are configured by a small set of
  markdown files with distinct roles — soul.md (personality/behaviour), agents.md (operating handbook),
  user.md (user knowledge) — a transferable, durable config pattern rather than ephemeral news.
- Durable design heuristic (page 1): the highest-value use for always-on autonomous agents is persistent
  around-the-clock research/cataloging/integration, NOT discrete iterative coding (better suited to
  interactive sessions) — a go/no-go rule for where autonomy actually pays off.
- Durable structural insight (page 2, t2): application-layer companies can fine-tune specialised models on
  their proprietary UX-data access to match closed frontier models at a fraction of the cost and higher
  speed (Cognition SWE 1.7 on a Kimi K2.7 base) — where competitive advantage sits in the AI stack, not a
  product datapoint. (Runner-up page 3, George Zarkadakis: individuals are 10x more productive yet no
  company is 10x more valuable, because institutional AI needs distinct coordination/signal-extraction that
  individual AI lacks.)

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 VERIFIED on 3 more post-fix controls (all claim-date ==
   episode-date, ≠ ingest-date); remains closed for post-fix pages. One-line ingest fix unchanged (record):
   in ingest.py `_build_ledger_bullet`, `claim_date = episode_date` (fall back to ingest_date only when
   episode_date is absent). Page 1 is a certified clean control for the deferred pre-fix (#1/#2) re-date.
2. W-CLAIMEV GRADUATES to PC-5 (claim↔evidence consistency check in the verify pass): page 2's SpaceX→xAI
   re-attribution is the 2nd-page trigger the watch defined. Written up below.
3. PC-2 reinforced on 2 pages (body arm: "Grock"→"Grok", page 2; structured-field arm: source:: "Seb Go to
   Jen"→corrected Ramp engineer, page 3) + an unlinked-ASR watch item ("OpenClaw", verify canonical spelling
   before entity promotion). Add the corrected names to the known-people dictionary.
4. PC-1 reinforced (1 page: [[UMA]] cross-domain crypto homonym, repeat #2/#10) → sub-case (e) domain guard.
5. PC-3 reinforced (page 3: host-relayed secondary stats at 0.90–0.95) → provenance cap / `source-authority::
   secondary` marker.

HIGH-severity: none on 2+ pages this wave (findings are MEDIUM PC-1/PC-2/PC-3 recurrences). NEW PROPOSED
CHANGES block PC-5 opened solely by W-CLAIMEV meeting its own 2nd-page graduation trigger (claim↔evidence
divergence), per the PC-2/PC-3 graduation discipline — not by a fresh HIGH class. PC-1/PC-2/PC-3/PC-5 cover
every finding.

### 2026-08-24 — Review wave #34 (synthesiser)
Pages reviewed (1): `podcast-evidence___how-the-escalating-ai-wars-benefit-you.md` (verdict: acceptable).
Every finding is a recurrence of an existing PC arm — no new mechanism, no HIGH class.

Defects (by kind):
- wikilink-semantic-mislink (MEDIUM, PC-1 recurrence): 3 collision mislinks + 2 generic single-noun on the
  same page — [[Epipolar Geometry]] (computer-vision) and [[Tor]] (anonymity net) stapled to the SK Hynix
  Nasdaq-IPO claim (L19); [[Ansi]] (ANSI standards, case (d)) on the 'liminal in-between period' claim (L91,
  a 3rd repeat of [[Ansi]] after waves #6/#17); [[Script]] (L35) and [[Curve]] (L83/91) generic tokens on
  token-economics/inference claims. All 29 links pass existence — pure semantic-mislink, exactly PC-1's
  raison d'être (ls-based validators miss it). Retag targets: SK Hynix → [[IPO]]/[[Semiconductors]];
  liminal-period → [[AI Market Dynamics]]. Reinforces PC-1 (append #34 to header ledger).
- mis-cased-stub-page (LOW, PC-2 casing arm): [[Enterprise Ai]] (L51) — the SAME example the casing arm was
  seeded with (wave #17). 'Enterprise Ai.md' stub co-exists with properly-cased 'Enterprise AI Adoption' /
  'AI Governance'; ledger propagates the drift. Normalise → [[Enterprise AI]] and merge the stub in-graph.
- possible-ASR-name-artefact (LOW, PC-2 body/entity arm): Apple/OpenAI trade-secret defendant 'Zhang Liu'
  (L27) diverges from the widely-reported real case name — likely ASR garble. `[sic]`-flag + verify against
  the primary Apple lawsuit source before entity promotion; do NOT silently correct.
- transcript-verbatim-hype-in-evidence (LOW, ACCEPTABLE): raw host-hype quotes ('you are nuts', 'cauldron',
  'liminal in-between period', L91-113) sit in tier-3 / confidence 0.6-0.7 evidence — correctly DEMOTED, so
  PC-3 (provenance cap) and PC-4 (volatility: these are `speculative` opinion/colour) already hold. No action.
- date-defect-check (LOW, POSITIVE): page does NOT exhibit the claim-date=ingest-date defect — episode-date::
  2026-07-14 present, ingest-date:: 2026-08-24, every claim-date:: == 2026-07-14 (episode date). Another
  post-fix clean control for the standing item.

Top wisdom highlights (durable, tier-appropriate):
- Nadella value-transfer thesis (L51): the current model regime transfers economic value from knowledge
  creators to model providers (providers reserve the right to learn from customer usage) — 'in consuming
  intelligence, you are creating intelligence, and what you create should belong to you'. Governance/economics
  framing, not dated news.
- Baker inference-economics / Jevons chain (L83): share shift from high-margin frontier labs to cheaper models
  raises intelligence-per-dollar → drives incremental token demand → redistributes margin from labs to infra
  providers. Outlives any single week.
- SemiAnalysis token-subsidy datapoint (L35): the $200/mo tier run at a subsidised ~8k (Anthropic) / ~14k
  (OpenAI) max tokens — a concrete window into inference unit economics and frontier-lab loss-leading.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — remains CLOSED for post-fix pages; this page is a 4th+ clean control (claim-date
   == episode-date ≠ ingest-date). One-line ingest fix unchanged (record): in ingest.py `_build_ledger_bullet`,
   `claim_date = episode_date` (fall back to ingest_date only when episode_date is absent).
2. PC-1 reinforced (1 page, 5 edges) — the review's own top suggestion ('add a semantic-validity check to the
   link validator, not just file-existence; flag links whose target-page domain is orthogonal to the claim')
   IS PC-1's proposed shape verbatim. No new arm; append #34 to the PC-1 header ledger and add the
   collision/generic targets ([[Epipolar Geometry]], [[Script]], [[Curve]]) to the example set.
3. PC-2 reinforced — casing arm ([[Enterprise Ai]]→[[Enterprise AI]], seed example recurs) + body-arm
   `[sic]`-flag/verify 'Zhang Liu' (Apple trade-secret defendant). Add to the verify dictionary/watch.

HIGH-severity: none (single page; all findings MEDIUM/LOW recurrences). No new PROPOSED CHANGES block —
the 2+-page HIGH rule is not met. PC-1 / PC-2 / PC-3 / PC-4 cover every finding.

### 2026-08-24 — Review wave #35 (synthesiser)
Pages reviewed (2): `podcast-evidence___how-the-global-ai-race-has-changed.md` and
`podcast-evidence___how-to-build-a-personal-agentic-operating-system.md` (both verdict: acceptable).
Every finding is a recurrence of an existing PC arm — 2 HIGH but both on the SAME page, so the 2+-page
HIGH systemic bar is NOT met; no new mechanism.

Defects (by kind):
- wikilink-wrong-concept / acronym-collision (HIGH×2 page 2, MEDIUM page 1, PC-1 recurrence): page 2 staples
  three real-but-wrong-domain pages via short-token/acronym collision — [[SEC]] (US Securities & Exchange
  Commission) on a least-privilege read-only-agent claim (→ [[Security]]/[[Access Control]]); [[OWL]] (W3C
  Web Ontology Language) on the 'Chief of Staff agent' claim L75 (→ drop, spurious acronym); [[Compound]]
  (Compound DeFi lending protocol) on 'compounding returns' (→ [[Compounding]]). Same collision family as
  wave #34 [[Tor]]/[[Ansi]] and the #29/#30 crypto-acronym trap — the target file EXISTS so ls-validators
  pass, but the sense is orthogonal. Page 1 variant: [[NVIDIA H200]] on the Nvidia $600B TOTAL-MARKET-CAP
  claim (L11) — a product-chip page stapled to a corporate-valuation claim; retag → [[NVIDIA Corporation]]
  (exists in graph). Exactly PC-1's raison d'être (append #35 to header ledger).
- duplicate-wikilink (LOW, BOTH pages, PC-1 in-block de-dup): [[NVIDIA H200]] [[NVIDIA H200]] (page 1 L35)
  and [[Agent]] [[OWL]] [[Agent]] (page 2 L75, garbled cluster). Same mechanical duplication as wave #23
  [[Agent]] [[Agent]] — already covered by PC-1's in-block de-dup; no new arm.
- allcaps-acronym-stub-targets (LOW, page 2, PC-2 casing-arm EXTENSION): link targets VERIFICATION / SEC /
  OWL are ALL-CAPS bare-stub pages ('# TITLE' + json-ld) that duplicate canonical mixed-case concepts
  (VERIFICATION vs 'Verification'). The caps stub resolves so the ls-validator passes — pure graph rot.
  Extends the PC-2 casing arm from proper-noun mis-casing ([[Enterprise Ai]], wave #17/#34) to ALL-CAPS
  acronym/concept-stub normalisation.
- entity-name-asr-artefact (MEDIUM, page 1, PC-2 body/entity arm): 'SeaDance 2.0' → 'Seedance 2.0'
  (ByteDance video model) — ASR mistranscription baked into the assertion entity name; won't dedup/cross-link
  against canonical 'Seedance'. 'Peng Zhao' → 'Peng Xiao' (G42 CEO) — a WRONG-PERSON name garble carried
  verbatim into a tier-1/0.9 claim; `[sic]`/verify before entity promotion, do NOT silently guess.
- asr-entity-uncertainty (LOW, page 2, PC-2 body arm, contained): 'Open Claw' / 'Claw Camp' likely ASR
  renderings of a product/programme name; not wikilinked so contained — `[sic]`-flag the surface forms.
- claim↔evidence over-normalisation (LOW, page 2, PC-5 minor): the Identity claim asserts 'Claude.md' while
  its own evidence:: says 'Claude' (evidence dropped '.md') — a mild claim-vs-evidence divergence; ground the
  claim to the evidence token or `[sic]`. Single instance → note under PC-5, no graduation move.
- confidence-slightly-high (LOW, page 1, PC-3 recurrence): assertions carrying UNCORRECTED entity errors
  (SeaDance, Peng Zhao) still rated tier-1 / 0.90-0.95 on single-source podcast-host claims. An unverified/
  likely-garbled entity name should CAP confidence — new input to the PC-3 provenance grader.
- date-defect-check (LOW, POSITIVE, BOTH pages): neither page exhibits the claim-date=ingest-date defect.
  Page 1 episode-date:: 2026-02-12, all 5 claim-date:: == 2026-02-12 ≠ ingest-date:: 2026-08-24; page 2
  episode-date:: 2026-04-25, claim-date:: == episode-date. assertion-fp present on all. Two more clean
  post-fix controls for the standing item.

Top wisdom highlights (durable, tier-appropriate):
- Zhipu trained its first model EXCLUSIVELY on Huawei chips as a proof-of-concept for a complete domestic
  Chinese hardware+software AI-training stack (page 1 L19) — durable strategic signal of China closing the
  compute-independence gap, far more consequential than any single market move.
- ByteDance's Seedance 2.0 generating naturalistic sound effects and background music SIMULTANEOUSLY with
  video (not a post-process), 'not yet come to Western models' (page 1 L27) — durable technical-capability
  delta worth tracking, once the entity name is corrected to Seedance.
- Least-privilege by default: start every agent connection READ-ONLY and grant write access only after
  watching its behaviour for several weeks (page 2 L59) — durable, transferable security discipline.
- Compounding cost curve of agent-building: the first agent is hard, each subsequent one far cheaper because
  it inherits the shared OS foundation (page 2 L67) — durable systems-design wisdom.
- Context curation as 3-5 focused, single-page, DATED files refreshed on change (not one large static doc)
  (page 2 L51) — durable knowledge-management practice, directly applicable to this graph itself.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — remains CLOSED for post-fix pages; both pages this wave are clean controls
   (claim-date == episode-date ≠ ingest-date). One-line ingest fix unchanged (record): in ingest.py
   `_build_ledger_bullet`, `claim_date = episode_date` (fall back to ingest_date only when episode_date is
   absent).
2. PC-1 reinforced, NO new block (2 HIGH but both on page 2 → 2+-page HIGH bar not met; the KIND spans both
   pages, page 1's is MEDIUM). Acronym/short-token collision sub-note gains [[SEC]] (Securities&Exchange vs
   Security/Access-Control), [[OWL]] (Web Ontology Language — drop), [[Compound]] (DeFi vs Compounding), plus
   the product-page-for-corporate-claim variant [[NVIDIA H200]]→[[NVIDIA Corporation]]. In-block de-dup covers
   [[NVIDIA H200]]×2 and [[Agent]] [[OWL]] [[Agent]]. Append #35 to the PC-1 header ledger.
3. PC-2 reinforced. Body/entity dictionary seeds: 'SeaDance 2.0'→'Seedance 2.0' (ByteDance video model);
   'Peng Zhao'→'Peng Xiao' (G42 CEO, wrong-person — `[sic]`/verify before promotion); `[sic]`-flag
   'Open Claw'/'Claw Camp' (unverified product/programme). Casing arm EXTENDED from proper-noun mis-casing to
   ALL-CAPS acronym/concept-stub normalisation: VERIFICATION→[[Verification]], drop/normalise SEC/OWL caps
   stubs so they stop duplicating canonical mixed-case concept pages. Append #35 to the PC-2 header ledger.
4. PC-3 cross-link (PC-2↔PC-3), single-page → note under PC-3, no new block: add an "unverified-entity"
   input to the provenance grader — when an assertion's own entity name is unverified/likely-ASR-garble
   (SeaDance, Peng Zhao), cap confidence (≤~0.7-0.8) rather than carry tier-1/0.95. Append #35 to PC-3.
5. PC-5 minor: page 2 'Claude.md' claim vs 'Claude' evidence — a single mild over-normalisation; ground to
   the evidence token or `[sic]`. Single instance → note only, no graduation move.

HIGH-severity: 2 HIGH ([[SEC]], [[OWL]]) but both on the SAME page (page 2); the 2+-page HIGH systemic bar
is NOT met. No new PROPOSED CHANGES block — PC-1 / PC-2 / PC-3 / PC-5 cover every finding.

### 2026-08-24 — Review wave #36 (synthesiser)
Pages reviewed (3): `podcast-evidence___how-to-build-a-personal-context-mcp.md` (acceptable),
`podcast-evidence___how-to-get-the-most-from-ai-this-summer.md` (good),
`podcast-evidence___how-to-get-the-most-out-of-fable-5-and-gpt-56-sol.md` (acceptable).
Every finding is a recurrence of an existing PC arm. HIGH wikilink-mislink lands on 2 of the 3 pages
(p1 + p3), but it is PC-1 — already graduated AND APPLIED (Refinements #2–#6) — so the 2+-page HIGH bar
reinforces PC-1's header rather than opening a new block; no new mechanism.

Defects by kind:
- wikilink-mislink / acronym-collision (HIGH p1 + p3, MEDIUM/LOW tail, PC-1 recurrence): p1 staples
  [[Tor]] (the anonymity network) onto THREE unrelated claims — the 'AI tutor/build partner' claim where
  'Tor' is an ASR homophone of 'tutor' (L51), the Claude App-Store/Pentagon claim (L59), and the
  prompt-engineering claim; single most damaging edge on the page. [[Tor]] is now a heavy cross-wave
  repeat (#4/#7/#10/#26/#29/#34/#36). p1 also: [[GAN]] on the 'copilot dropped on people's heads' claim
  (L91 — irrelevant; [[GAN]] the run's most frequent wrong target), [[OWL]] on a domain_knowledge
  speculation (L123), [[Base]] on the Notion 'database agents' claim (L27, weak generic). p3 (case-(d)
  short-acronym collisions): [[TPU]] (Tensor Processing Unit) on a GPT-5.6 answer-LENGTH claim, [[TEE]]
  (Trusted Execution Environment) + [[DEX]] (Decentralised Exchange, mis-matched off 'Co-DEX') on the
  Codex/Steer/Queue claim, [[OWL]] on the 'loops expand into creative work' claim. All resolve on disk
  (ls-validators pass) but the sense is orthogonal → false edges. [[OWL]] wrong-sense spans BOTH p1 and
  p3 this wave (repeat of #21/#24/#35). Retag: drop [[Tor]]/[[GAN]]/[[TPU]]/[[TEE]]/[[DEX]]/[[OWL]];
  prefer already-correct [[Enterprise AI]]/[[Context Engineering]]. Exactly PC-1's raison d'être.
- entity-name / model-name ASR artefact (MEDIUM, PC-2 body + source:: arms): model generation rendered
  three ways across p3 — title 'GPT 5.6 Sol', body 'Sole' (a size-tier alongside Terra/Luna), 'GPT-5.6
  Soul' (L51); p2 carries 'GPT-5.6 Soul'/'ChatGPT 5.6 Soul' (L43/L64). 'Soul' recurs from waves #22/#23
  → PC-2 dictionary: `[sic]`-flag the GPT-5.6 size/codename tokens (Sol/Sole/Soul + Terra/Luna),
  disambiguate model GENERATION from size-TIER name, verify before canonicalising — do not guess.
  STRUCTURED source:: garbles on p3: 'Daniel Meisler'→Daniel Miessler, 'Matt Schumer'→Matt Shumer
  (both public figures) — load-bearing provenance fields → PC-2 source:: arm.
- wikilink-casing (LOW, PC-2 casing arm): p3 [[Enterprise Ai]] non-standard 'Ai' casing → [[Enterprise
  AI]] (recurs #17/#34/#35).
- provenance-confidence (MEDIUM, PC-3 recurrence): p1 two tier-1 'factual' items are host-only,
  single-sourced ephemeral news at 0.85-0.9 — 'Claude #1 in App Store after Pentagon designated
  Anthropic a supply-chain risk' (L59, 0.85, reads as unverified news repeated verbatim from the host)
  and the Notion database-agents announcement (L27). Cap at ≤~0.85 and flag for third-party
  corroboration; secondary-relay grade, not primary.
- ephemeral-marketing / snapshot content (LOW, PC-4 recurrence): p2 ~⅓ of assertions are promo for the
  'AI Summer Adventure' program (summeradventure.ai passport/stamp L27-33, 'Lemonade Stand' expedition
  L51-57, weekly-unlock schedule L99-105) — low durable value. Correctly tiered (t1 launch fact, t3
  weekly-unlock signal) → the PC-4 `volatility:: snapshot` stamp is exactly the mechanism to keep these
  from competing with durable wisdom for candidacy.
- tier-label consistency (LOW, cosmetic, p2): a few tier-1 items lack the bracketed category prefix that
  tier-2/3 items carry; apply the prefix uniformly across tiers or drop it. Confidence 0.7-0.95 monotone
  with tier — no substantive issue.
- claim-date — NON-DEFECT / POSITIVE (ALL 3 pages): reviewer confirms claim-date:: == episode-date:: on
  every assertion, ≠ ingest-date 2026-08-24. p1 episode-date 2026-04-04, p2 2026-07-27, p3 2026-07-25;
  every claim-date matches. THREE more clean post-fix controls → Refinement #1 continues to hold; do NOT
  apply the blanket re-date pass to any of these pages.

Top wisdom:
- Durable (p1, Applied Compute / Michael Chan, t1, article-sourced): the gap between 'having data' and
  'having data in an AI-usable format' is enormous — most enterprise data was never structured for AI
  consumption. Strongest-provenance, most cross-cutting insight of the wave.
- Durable design principle (p1): markdown is the universal interchange format for context (every AI
  system reads it) → a portable personal-context portfolio should be markdown-first; and decision_log.md
  is the most underrated portfolio component — an agent given your historical REASONING patterns supports
  future decisions far better than a static profile.
- Durable mental models (p2): the interaction paradigm is shifting from 'chatting' with a model to
  'managing' agents as a delegated team you supervise (L67-73); permission/approval settings are the
  critical agentic safety control (demonstrated: ChatGPT autonomously SENT a Gmail while Claude only
  DRAFTED it under different config, L19-25); 'capability overhang' — the gap between what AI can do and
  what even expert users actually use (L75-81).
- Durable prompting (p3): state each instruction exactly once — OpenAI found removing repeated
  instructions raised scores 10-15% while cutting tokens up to 66%; specify tone as concrete behaviour
  not adjectives; Matt Shumer's 'bar' pattern — give an agent a checkable bar and loop it, don't ask for
  'high quality' (it stops at its own 'good enough').

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — remains CLOSED for post-fix pages; all 3 pages this wave are clean controls
   (claim-date == episode-date ≠ ingest-date). One-line ingest fix unchanged (record): in ingest.py
   `_build_ledger_bullet`, `claim_date = episode_date` (fall back to ingest_date only when episode_date
   is absent).
2. PC-1 reinforced, NO new block. HIGH wikilink-mislink on 2 pages (p1 [[Tor]]×3, p3 [[TPU]]/[[TEE]]/
   [[DEX]]/[[OWL]]) is a recurrence of an already-APPLIED PC (Refinements #2–#6 shipped the specificity
   gate) → header ledger extended, not a fresh PROPOSED CHANGE. Cross-wave repeats reinforced: [[Tor]]
   (#4/#7/#10/#26/#29/#34/#36), [[GAN]], [[OWL]] (both p1+p3). The 'Tor'←'tutor' homophone shows the
   collision is sometimes ASR-driven (audio homophone), not just substring — the ontology-match-against-
   host-sense arm is what catches it. Append #36 to the PC-1 header.
3. PC-2 reinforced. Dictionary/flag seeds: `[sic]`-flag GPT-5.6 size/codename tokens (Sol/Sole/Soul +
   Terra/Luna; 'Soul' recurs #22/#23) and disambiguate model generation vs size tier; source:: arm
   'Daniel Meisler'→Daniel Miessler, 'Matt Schumer'→Matt Shumer; casing arm [[Enterprise Ai]]→[[Enterprise
   AI]]. Append #36 to the PC-2 header.
4. PC-3 reinforced (single-page MEDIUM): host-only single-sourced ephemeral news (Pentagon/App-Store,
   Notion agents) at tier-1/0.85-0.9 → secondary-relay grade, cap ≤~0.85 + flag. Append #36 to PC-3.
5. PC-4 reinforced (p2 marketing/snapshot cluster): the `volatility:: snapshot` stamp keeps the AI Summer
   Adventure promo assertions from accreting as durable knowledge. Append #36 to PC-4.

HIGH-severity: HIGH wikilink-mislink on 2 pages (p1+p3) but it is a PC-1 recurrence (already graduated and
APPLIED), not a new class → no new PROPOSED CHANGES block. PC-1/PC-2/PC-3/PC-4 cover every finding.

### 2026-08-24 — Review wave #37 (synthesiser)
Pages reviewed (1): `podcast-evidence___how-to-help-ai-do-your-work-better.md` (good). Single-page wave,
no HIGH-severity finding. Every issue is a recurrence of an already-graduated-and-APPLIED PC arm (PC-2,
PC-3, PC-4) — no new mechanism, no new PROPOSED CHANGES block. Notable PC-1 POSITIVE CONTROL this wave
(see below): ASR-garbled model names were correctly NOT promoted to wikilinks.

Defects by kind:
- source-authority-miscalibration (MEDIUM, PC-3 recurrence): inconsistent primary/secondary tagging.
  Assertions 3 (Dresser departure), 4 (Alpha Sense study) and 5 (OpenAI ultra-fast-mode) are tagged
  `source-authority:: primary` despite all being the host relaying a third-party announcement/study —
  one hop removed, should read `secondary`. Assertions 1–2 (benchmark data relayed by host) are already
  correctly `secondary`. The only genuine near-primary is assertion 9, a directly-attributed Alpha Sense
  CEO Jack Kokko quote. Retag 3/4/5 → secondary; reserve `primary` for the assertion-9 quote. Exactly the
  PC-3 provenance-cap mechanism (now grading the new `source-authority::` field shipped in Refinement #4).
- asr-artefacts-in-entity-names (MEDIUM, PC-2 body arm) — with a PC-1 POSITIVE CONTROL: entity names are
  ASR-garbled future/fictional product tokens — 'GPT-5.6 Luna', 'GPT-5.6 Soul', 'Gemini 3.7 Flash',
  'Kimi K3', 'Deep Sweep benchmark' (almost certainly SWE-bench mangled), 'MuSpark 1.2', 'Dolly Rajek',
  'Grok Bot'; assertion-1 evidence even preserves raw 'GPT-5 6 Luna'. CRUCIAL good behaviour: these
  garbled tokens were NOT promoted into wikilinks — the only three links used are clean generic concepts
  ([[Model Performance]], [[OpenAI API]], [[Task Automation]]) → no polluted entity pages minted. Artefacts
  stay confined to prose/evidence (defensive, correct). PC-2 action: `[sic]`-flag the model tokens as
  unverified and hold for canonical-registry check before any future promotion; 'Deep Sweep'→SWE-bench,
  'GPT-5.6 Soul'/'Luna' recur from #22/#23/#36 (size/codename cluster). 'Soul' is a repeat token.
- internal-number-confusion (LOW, PC-4-adjacent): speed claims risk conflation — assertion 1 (Gemini 3.7
  Flash 340 tok/s '>2× faster than GPT-5.6 Luna') vs assertion 5 (GPT-5.6 Soul 750 tok/s '>2× the pace of
  Gemini 3.7 Flash'). Different SKUs (Luna vs Soul) so not a contradiction, but the distinction rests on
  garbled names and is easy to conflate. `volatility:: snapshot` is correctly applied → these tok/s figures
  age out and won't compete with durable wisdom. No action beyond PC-2 name-flagging.
- transcript-hype-stripped — NON-DEFECT / POSITIVE: assertion text is cleanly de-hyped; raw transcript
  flourishes ('an entirely different category…', 'frontier intelligence at 14× the speed') are quarantined
  inside evidence:: quotes and do NOT leak into the assertion sentences. Good claim/evidence separation.
- claim-date — NON-DEFECT / POSITIVE (control): all 13 assertions carry `claim-date:: 2026-08-16` ==
  `episode-date:: 2026-08-16`, ≠ ingest-date 2026-08-24. Clean post-fix control → Refinement #1 continues
  to hold; do NOT apply the blanket re-date pass to this page. episode-date present, so re-dating remains
  possible if ever needed.

Top wisdom:
- Durable (assertion 7, t2): the AI deployment bottleneck has shifted from model CAPABILITY to access to
  CONTEXT — models increasingly lack the specific user/task information rather than raw ability. Strongest
  strategic insight on the page.
- Durable, well-attributed (assertion 9, t2, Alpha Sense CEO Jack Kokko direct quote): switching to cheaper
  (esp. Chinese) models does not guarantee bottom-line savings — pricier models can be more token-efficient
  and thus cheaper per completed task. Counterintuitive, sourced, actionable.
- Durable reusable framework (assertion 6, t2): the 'AI deputization audit' — a five-dimension scoring
  rubric (frequency/time, teachability, checkability, stakes, personal-integralness) mapping tasks to
  deputize (8–10) / duet (4–7) / defend (0–3) tiers. Highest-value evergreen artefact on the page.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — remains CLOSED for post-fix pages; this page is a clean control
   (claim-date == episode-date ≠ ingest-date). One-line ingest fix unchanged (record): in ingest.py
   `_build_ledger_bullet`, `claim_date = episode_date` (fall back to ingest_date only when episode_date
   is absent).
2. PC-2 reinforced. Dictionary/flag seeds: `[sic]`-flag ASR-uncertain model tokens (GPT-5.6 Luna/Soul,
   Gemini 3.7 Flash, Kimi K3, MuSpark 1.2, Dolly Rajek, Grok Bot) and normalise against a canonical model
   registry before any promotion to entity pages; 'Deep Sweep'→SWE-bench is a near-certain fix. 'Soul'/
   size-codename cluster recurs #22/#23/#36. Append #37 to the PC-2 header.
3. PC-3 reinforced (single-page MEDIUM): host-relayed third-party announcements/studies (assertions 3/4/5)
   mis-tagged `source-authority:: primary` → should be `secondary`; reserve `primary` for the directly-
   quoted assertion-9 CEO material. Confirms the Refinement-#4 `source-authority::` field is the right
   mechanism but needs consistent grader application (relay ≠ primary). Append #37 to PC-3 header.
4. PC-1 POSITIVE CONTROL (no reinforcement needed, record as evidence the gate is right): the ASR-garbled
   product names were left in prose/evidence and NOT emitted as wikilinks; the three links used are clean
   generic concepts. This is exactly the defensive behaviour Refinement #2 (specificity gate) targets —
   a wrong-sense/garbled link is worse than none. Log as a PC-1 clean control (garble-not-promoted), no
   header count change (no mislink defect occurred).
5. PC-4 acknowledged (LOW): tok/s speed figures correctly stamped `volatility:: snapshot` → they age out.
   No action; mechanism working as intended.

HIGH-severity: none. Single-page wave; no defect class appears on 2+ pages this wave → no new PROPOSED
CHANGES block. PC-2/PC-3/PC-4 (all already APPLIED) cover every finding; PC-1 logged a positive control.

### 2026-08-24 — Review wave #38 (synthesiser)
Pages reviewed (1): `podcast-evidence___how-to-help-people-thrive-with-ai.md` verdict acceptable.
Every finding is a recurrence of an already-graduated-and-APPLIED PC arm (PC-2, PC-3) — no new
mechanism, no new PROPOSED CHANGES block.

Defects by kind:
- asr-artefact-entity-names in STRUCTURED fields (MEDIUM, PC-2 source::/body arm — 2 instances):
  (a) source:: 'ActiveTrack researchers' → ActivTrak (workforce-analytics firm), ASR-garbled across
  4 occurrences (L24/28/34/38) in TWO primary-authority assertions → mints a wrong org identity in a
  load-bearing provenance field. (b) 'Praveen Napali, Uber CTO' (L51/54/64) → likely Praveen Neppalli
  Naga, name truncated in body AND the 'CTO' title over-attributed (senior Uber eng leader, not
  confirmed CTO) → PC-2's role/attribution arm (title over-claim, cf. wave #22 Tencent-President case).
  Both are textbook PC-2 structured-field targets; correct name+title before ledger write.
- provenance-over-cap (MEDIUM, PC-3 — 3 instances converging on one root cause):
  (a) 'Possibility Sciences' as source for the '~40% gamma-wave drop' claim is unverifiable from the
  transcript yet stamped tier1/0.9/primary; unconfirmable source → cannot be primary/0.9.
  (b) MIT Media Lab '55% brain-connectivity decline with ChatGPT' at tier1/0.9/primary/durable rests
  on a single, widely-critiqued preprint ('Your Brain on ChatGPT') → contested single-preprint is not
  0.9/durable. (c) ROOT CAUSE: the host is RELAYING second-hand studies (69/16%, Uber time-savings,
  GoTo 43%, the two above) — the podcast is not the primary source for ANY underlying research, so
  source-authority:: should be `secondary` (relay), not `primary`. Exactly PC-3's secondary-relay cap
  now grading the shipped `source-authority::` field (Refinement #4): relay ≠ primary; cap tier/conf
  and set authority secondary.
- claim-date — NON-DEFECT / POSITIVE (reviewer-confirmed): episode-date:: 2026-07-13, ingest-date::
  2026-08-24 distinct, every claim-date:: == 2026-07-13 (episode date, not ingest date). Another
  post-fix page correctly dated → Refinement #1 continues to hold; skip in any batch re-date pass.

Top wisdom:
- 'Productive passengers vs mental marathoners' (L101): highest-value AI use is not efficiency on rote
  tasks but attempting previously-impossible work (building agents, learning new technical skills) that
  stretches cognition rather than atrophying it — durable, generalisable thesis and the page's best entry.
- UC Berkeley Haas (L71): when AI lowers the barrier, workers RE-INTERNALISE tasks they had outsourced
  (coding, engineering) — counter-intuitive durable insight about AI reshaping task allocation, not just
  speeding existing work.
- 'AI champions' should show, not tell (L111): their value is pairing with business functions to
  reimagine workflows, not evangelising the tool — durable organisational-change principle, distinct from
  the ephemeral adoption statistics on the page.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 VERIFIED on yet another post-fix page (correctly
   episode-dated). Remains closed for post-fix pages. One-line ingest fix unchanged (for the record):
   in ingest.py `_build_ledger_bullet`, set `claim_date = episode_date` (fall back to ingest_date only
   when episode_date is absent). Deferred re-date still owes only the pre-fix backlog (waves #1/#2).
2. PC-2 reinforced (name + role arms): ActivTrak (source::) and Praveen Neppalli Naga + title over-claim
   (body). Append #38 to the PC-2 header.
3. PC-3 reinforced (secondary-relay + contested-source cap): host-relayed studies at primary/0.9
   (Possibility Sciences unverifiable; MIT single-preprint; Uber/GoTo relayed stats) → grade authority
   `secondary`, cap tier/confidence, flag the contested/unverifiable sources. Append #38 to PC-3 header.

HIGH-severity: none. Single-page wave; no defect class is new → no new PROPOSED CHANGES block.
PC-2/PC-3 (both already APPLIED) cover every finding; Refinement #1 logged another positive control.

### 2026-08-24 — Review wave #39 (synthesiser)
Pages reviewed (1): `podcast-evidence___how-to-learn-ai-with-ai.md` verdict GOOD. Cleanest page to date:
11/11 wikilinks resolve to exact-match pages, all 9 assertions specific+attributed+evidence-backed with
verbatim quotes, dedup assertion-fp comments on all 9, tiers/confidence/volatility internally consistent
(tier1 primary snapshot 0.9-0.95, tier2 durable host analysis 0.8-0.85, tier3 speculative 0.6-0.65).
Only one defect, low-grade and already-covered → no new PROPOSED CHANGES block.

Defects by kind:
- asr-artefact-entity-name (LOW, PC-2 — quoted-in-evidence arm, NOT a structured-field leak): 'Whisper
  Flow' (L61/68) is the dictation app **Wispr Flow**, ASR-conflated with OpenAI Whisper. Unlike waves
  #38 (ActivTrak in source::) / #22 (SpaceX AI in claim body), this garble sits ONLY inside evidence::
  transcript quotes and carries NO wikilink → it mints no spurious entity and breaks no link. Correct the
  spelling on ledger write; does NOT warrant appending #39 to the PC-2 header (no structured-field/link
  target hit — the exact distinction PC-2 grades). Reinforces the standing 'ASR-corrupted proper nouns'
  watch (Kimmy K3→Kimi K2, Ansi→Anthropic) at its lowest-blast tier.
- claim-date — NON-DEFECT / POSITIVE control (reviewer-confirmed): episode-date:: 2026-02-14 present,
  ingest-date:: 2026-08-24 distinct, every claim-date:: == 2026-02-14 (episode date, not ingest date).
  Yet another post-fix page correctly dated → Refinement #1 continues to hold; skip in any re-date pass.
  Reviewer flags this page as a REFERENCE EXAMPLE of correct claim-date handling.

Top wisdom:
- Handoff-document practice (L41): before ending an AI session, capture key themes/decisions/open questions
  because platform memory is unreliable and context windows are limited — 'treat every working session like
  a shift handoff.' Durable, actionable, tool-agnostic — the page's best entry.
- Meta-prompting (L71): use your primary AI partner to WRITE the prompts/specs for your other AI tools, then
  verify the output — a durable technique that outlives any specific model.
- 'Pair learning with an AI build partner' (L31): learning has shifted from instructor-led tutorials to
  self-directed pairing with an AI — a durable paradigm claim, more valuable than the ephemeral Brockman
  'by March 31st' news snapshot (L11, correctly tagged snapshot/expiring).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 VERIFIED on another post-fix page. Remains closed for post-fix
   pages. One-line ingest fix unchanged (for the record): in ingest.py `_build_ledger_bullet`, set
   `claim_date = episode_date` (fall back to ingest_date only when episode_date is absent). Deferred re-date
   still owes only the pre-fix backlog (waves #1/#2).
2. PC-2 quoted-in-evidence sub-tier (NO header append) — Wispr Flow shows the ASR proper-noun watch can land
   purely inside evidence quotes with no wikilink. Standing guidance holds: correct the name on ledger write,
   but only the structured-field/link-target arm graduates severity — evidence-only garble stays low.
3. Optional connectivity (not a defect): attach a wikilink to the Brockman assertion's 'agent rather than
   editor/terminal' concept ([[Terminal Coding Agents]] or [[IDE Coding Agents]], both extant) if a link-
   enrichment pass runs; and [[Wispr Flow]]/[[Voice Input]] once the name is corrected.

HIGH-severity: none. Single-page wave, one low-grade PC-2 (evidence-only) recurrence + one positive
claim-date control → no new PROPOSED CHANGES block, no PC-header edits.

### 2026-08-24 — Review wave #40 (synthesiser)
Pages reviewed (1): `podcast-evidence___how-to-make-chatgpt-ads-not-suck.md` verdict ACCEPTABLE. Clean
entity/wikilink layer (ChatGPT, OpenAI, Meta, ARPU all correct); the only structural issue is tier↔authority
inflation on three secondary-sourced numbers. No HIGH-severity, single page → no new PROPOSED CHANGES block.

Defects by kind:
- tier-inflation (MEDIUM, PC-3 recurrence — TIER arm, not just the confidence arm): three claims carry
  tier:: 1 despite source-authority:: secondary + weak provenance — the 16% vs 1.76% conversion figure is an
  UNNAMED study relayed by the host (L31), the Meta '$58/user in 2025' comes from an anonymous poster
  'Signal' (L41), and '$20B annualized revenue' is host-relayed (L51). PC-3 (APPLIED) already caps
  CONFIDENCE ≤ authority; this page shows the same over-cap on TIER:: — a tier-1 slot given to
  second-hand/anonymous figures. Genuine tier-1 primary items on the page are the OpenAI ad-testing
  announcement (L11) and its stated ad principles (L21). Fix per reviewer: demote the three to tier 2, and
  drop the unnamed-study confidence from 0.85 → 0.6-0.7. Covered by PC-3 in spirit; note below extends PC-3's
  cap to the tier:: field, not only confidence::.
- asr-artefacts-in-evidence (LOW, PC-2 — evidence-only arm, NO structured-field/link leak): 'chat GBT',
  'ChatGBT', 'Metazaroo' (= Meta's ARPU), 'social media arpoo' (= ARPU) survive inside evidence:: verbatim
  quotes only; assertion prose + entity/wikilink names are clean. Same class as wave #39 (Wispr Flow): correct
  on ledger write / light-normalise quoted entity tokens for searchability, but does NOT warrant a PC-2 header
  append (no link target hit).
- claim-date — NON-DEFECT / POSITIVE control (reviewer-confirmed): episode-date:: 2026-01-20 present, every
  claim-date:: == 2026-01-20 ≠ ingest-date:: 2026-08-24. Refinement #1 continues to hold. Secondary sanity
  note: a ~7-month episode→ingest gap is unusual for a daily-brief item — worth a one-off check that the
  episode-date itself parsed correctly, though the page is internally consistent (NOT the re-date defect).

Top wisdom:
- 'Ads in a feed monetize attention; ads in an AI convo monetize decisions' (L71) — durable strategic framing:
  if AI becomes the default choose-and-buy interface, social-media ARPU is a floor not a ceiling. Portable
  analysis, not dated news — the page's best entry.
- Pay-for-results advertising (L91): shift from cost-per-click/view to verified-outcome pricing — advertiser
  pays only on completed transaction + confirmed satisfaction ('$50 for a booking vs $2 for a click'). A
  durable design principle for AI-native commerce.
- OpenAI's three ad principles (L21): answer independence, conversational privacy from advertisers, mission
  alignment — durable governance commitments that outlast the specific rollout news.

INPUT-ADJUSTMENT PROPOSALS:
1. PC-3 TIER-arm note (NO new PROPOSED CHANGES block yet — 1st clear tier-vs-authority instance; graduate on
   a 2nd page): PC-3 as applied caps confidence ≤ source-authority. Extend the same rule to tier::, i.e.
   tier 1 requires source-authority:: primary (or a verifiable single-source); secondary/rumour/host-relayed
   figures cap at tier 2 regardless of how confident the host sounds. Extraction-prompt one-liner if it
   recurs: "tier:: 1 is reserved for primary/verifiable facts; anonymous, host-relayed, or single-secondary
   figures cap at tier 2 even at high stated confidence." Watch-tagged; not applied.
2. claim-date standing item — Refinement #1 VERIFIED on another post-fix page (claim-date == episode-date ≠
   ingest-date). Remains closed for post-fix pages. One-line ingest fix unchanged (record): in ingest.py
   `_build_ledger_bullet`, set `claim_date = episode_date` (fall back to ingest_date only when episode_date
   is absent). NEW low-grade watch: flag episodes whose episode-date→ingest-date gap exceeds ~N weeks for a
   parse sanity-check (here ~7 months on a daily-brief item), since a mis-parsed episode-date would silently
   mis-date every claim on the page even with Refinement #1 in force.
3. PC-2 evidence-only sub-tier (NO header append) — 'Metazaroo'/'arpoo' reconfirm the evidence-only ASR arm:
   correct/normalise quoted entity tokens on ledger write; only the structured-field/link-target arm
   graduates severity.

HIGH-severity: none. Single-page wave; one MEDIUM PC-3 recurrence (tier arm, watch-tagged for a 2nd-page
graduation trigger) + covered-low PC-2 + a positive claim-date control → no new PROPOSED CHANGES block.

### 2026-08-24 — Review wave #41 (synthesiser)
Pages reviewed (1): `podcast-evidence___how-to-use-claude-cowork-on-the-go.md` verdict GOOD. A daily-brief
ledger (3 of 13 assertions about Claude Cowork; 10 unrelated brief items). No HIGH-severity, single page →
no new PROPOSED CHANGES block. One PC-2 recurrence + a new intra-page naming class (→ W-CANON) + a 2nd
instance of the episode→ingest gap sanity watch + a POSITIVE claim-date control.

Defects by kind:
- asr-artefact-entity-name (MEDIUM, PC-2 — structured/body arm): assertion 9 names 'Manas' twice for Meta's
  acquisition target = almost certainly 'Manus' (the Chinese agentic-AI startup) mis-heard. This is a BODY
  entity that would mint a wrong [[Manus]] identity once entity resolution/linking runs → the same
  structured-field arm PC-2 (APPLIED) covers; correct BEFORE any [[wikilink]] (run PC-2 body-normalisation
  before PC-1 link emission, per the existing ordering note). PC-2 header extended to wave #41.
- naming-inconsistency (LOW, NEW kind → W-CANON): the SAME product is written 'Claude Co-work Dispatch',
  'Claude Cowork', 'Co-work' across assertions and 'Cowork' in the title. Distinct from PC-2: none of these
  is an ASR mishearing — every variant is a plausible spelling, but the inconsistent hyphenation/spelling
  will FRAGMENT a future [[Claude Cowork]] entity page across variants. First occurrence of intra-page
  entity-name canonicalisation → opened as W-CANON (below), graduates on a 2nd page.
- unverified-entity (LOW, folds into W-CANON): 'Open Claude' is used consistently as a proper-noun
  product/agent (Mollick's "Open Claude use cases") but is never linked or defined — reads intentional, not
  an artefact, yet is an ungrounded entity. Either resolve to a canonical page or `[sic]`/unverified-flag it
  before it accretes as a phantom identity. Same canonicalisation concern as the naming-inconsistency above.
- episode→ingest gap (LOW, non-defect — 2nd instance of the wave #40 gap-sanity watch): episode-date::
  2026-03-19 vs ingest-date:: 2026-08-24 = ~5-month gap on a 'daily brief'. NOT the re-date defect (claim-
  dates are correctly the episode date, see positive control below); worth a one-off parse-sanity check that
  the episode-date was genuinely parsed, not defaulted. 2nd such multi-month gap (wave #40 was ~7 months) →
  keeps the low-grade watch alive; does not graduate (both pages internally consistent).
- page-scope-vs-content (LOW, non-defect): title/basename is narrowly 'Claude Cowork' but 10/13 assertions
  are unrelated brief items (Nvidia H200/China, AWS revenue, China regulators, Meta/Manus). Acceptable for a
  daily-brief ledger; the slug merely under-describes the content. No action.
- claim-date — NON-DEFECT / POSITIVE control: claim-date:: correctly carries the episode date (2026-03-19),
  distinct from ingest-date:: 2026-08-24 → Refinement #1 continues to hold on another post-fix page.

Top wisdom:
- Claude Cowork Dispatch capability model: initiate a session on your computer (hosted in a local sandbox),
  then monitor progress and grant approvals from mobile while out — durable product-mechanics fact.
- Ethan Mollick's assessment: Dispatch covers ~90% of his Open Claude use cases and feels safer/more stable,
  but lacks multi-session support and the heartbeat/proactivity — durable agent-UX tradeoff insight.
- Patrick Moorhead's thesis: AI is repricing the entire cloud TAM upward and hyperscale cloud is entering a
  second growth phase that dwarfs the first — durable strategic framing vs the ephemeral revenue figures.

INPUT-ADJUSTMENT PROPOSALS:
1. PC-2 recurrence (structured/body arm) — 'Manas'->'Manus' is a body entity garble that would mint a wrong
   [[Manus]]. Covered by PC-2 (APPLIED); header extended to #41. No new code; ensure PC-2 body-normalisation
   runs before PC-1 link emission so the garble is corrected at source rather than linked.
2. NEW W-CANON (intra-page entity-name canonicalisation) — pick ONE canonical surface form per entity per
   page and use it across all structured fields + the wikilink, so hyphenation/spelling variants
   ('Claude Cowork'/'Co-work'/'Co-work Dispatch') don't fragment the entity page. Folds 'Open Claude'
   (ungrounded proper-noun → resolve or unverified-flag). Watch-tagged; graduates on a 2nd page.
3. Episode→ingest gap sanity watch (from wave #40) — 2nd instance (~5 months). Keep as a low-grade
   parse-sanity check (flag episodes whose episode-date→ingest-date gap exceeds ~N weeks); it graduates only
   if a wide gap ever coincides with a mis-parsed episode-date that mis-dates the page's claims.
4. claim-date standing item — POSITIVE control again (claim-date == episode-date ≠ ingest-date). One-line
   ingest fix unchanged (record): in ingest.py `_build_ledger_bullet`, `claim_date = episode_date` (fall
   back to ingest_date only when episode_date is absent). Remains closed for post-fix pages.

HIGH-severity: none. Single page, verdict GOOD; one MEDIUM PC-2 recurrence + a new LOW naming class (W-CANON)
+ a 2nd-instance gap watch + a positive claim-date control → no new PROPOSED CHANGES block.

### 2026-08-24 — Review wave #42 (synthesiser)
Pages reviewed (2): `podcast-evidence___how-the-best-companies-use-ai.md` (GOOD) +
`podcast-evidence___how-to-use-claudes-massive-new-upgrades.md` (ACCEPTABLE). Both pages are recurrences of
already-APPLIED PC-1 (wrong-sense/homonym wikilinks) and PC-2 (entity-name ASR normalisation) — no new kind,
no HIGH-severity → no new PROPOSED CHANGES block. PC-1 header extended to #42; PC-2 header extended to #42.

Defects by kind:
- asr-artefact-in-source (MEDIUM, PC-2 — structured/source:: arm; BOTH pages):
  - page 1: source:: 'Seb Go to Jen, Ramp' on 4 assertions (fp ecb43a5c…, 3a277c72…, 0a4e66b4…, 59fef094…)
    — 'Go to Jen' is obvious ASR garble of a Ramp engineer/author's name. High blast radius (canonical
    source string across 4 assertions). Resolve to the real author, else `[sic]`-flag; do not guess.
  - page 2: source:: 'Peter Gustaff'→'Peter Gostev' (the sibling page `how-the-4-new-models…` already spells
    it 'Gostev' twice — a CROSS-PAGE canonical exists), 'Felix Riesberg'→'Felix Rieseberg' (verify),
    'Gagan Soluja' (verify/`[sic]`). Garble is in source:: not [[wikilinks]], so the entity-name namespace
    is clean, but attribution provenance degrades and cross-page entity resolution fails. NEW nuance for
    PC-2's dictionary/resolution arm: prefer the SIBLING podcast-evidence page's existing spelling as the
    canonical target when one exists — reconcile within the podcast-evidence cluster, not just the ontology.
- wikilink-wrong-sense homonym (MEDIUM, PC-1 sub-case (b)/(e) — cross-domain false edge; page 2):
  [[Payment Channels]] on the 'Claude Code Channels' assertion (L51) resolves to the Bitcoin/Lightning
  payment-channels page (JSON-LD links to Bitcoin) — but 'Channels' here are MCP event-push channels. A
  homonym mint of a false AI↔crypto edge, exactly PC-1's source-vs-target-domain guard (AI/agents source →
  crypto target, host claim not about finance → drop). [[Event Driven Architecture]] + [[Model Context
  Protocol]] on the same line already carry the correct sense → drop [[Payment Channels]] only.
- low-specificity-wikilinks (LOW, PC-1 generic-token arm; page 1): [[System]] on ~10 of 13 assertions,
  plus recurring [[Data]]/[[Data Management]]/[[AI System Component]]/[[Business Intelligence]] — all resolve,
  none wrong, but near-noise; the PwC economic-gains stat tagged [[Data]] [[Business Intelligence]] [[Data
  Management]] would carry more retrieval value anchored to Ramp/McKinsey/agentic-engineering/enterprise-AI-
  adoption. Same generic-single-noun class PC-1 already gates.
- asr-artefact-in-evidence (LOW, PC-2 verbatim-quote arm; page 2): evidence L48 'CloudCode on the web' = ASR
  garble of 'Claude Code on the web'. Inside a quoted evidence:: block → verbatim-faithful; per PC-2 scope,
  do NOT rewrite — emit the one-line ASR note so re-ingest doesn't mint a 'CloudCode' entity.
- claim-date — NON-DEFECT / POSITIVE control (BOTH pages): claim-date:: correctly carries episode-date
  (page 1: 2026-04-20 == episode-date 2026-04-20; page 2: 2026-03-24 == episode-date 2026-03-24), distinct
  from ingest-date:: 2026-08-24 → Refinement #1 holds on two more post-fix pages. Both pages are EXCLUDED
  from the deferred pre-fix batch re-date sweep.
- ephemeral-news / volatility (LOW, PC-4 territory; page 2): the 40M-views / 62k-bookmarks assertion is pure
  snapshot news, correctly stamped volatility:: snapshot — PC-4 (APPLIED) working as intended. Consider
  whether snapshot-tier engagement metrics warrant ingestion at all vs the durable capability claims.

Top wisdom:
- George Zarkadakis' institutional-vs-individual AI thesis (fp 322dbf26…): AI made individuals ~10× more
  productive yet no company became 10× more valuable, because institutional AI needs distinct coordination/
  signal-extraction processes that individual AI lacks. Durable strategic insight, not ephemeral news.
- Ramp's build-vs-buy rationale (fp 59fef094…): 'internal productivity is a moat — don't hand your moat to a
  vendor'; owning tooling buys same-day fixes and direct product insight. Reusable decision principle.
- Ramp design principle (fp 0a4e66b4…): 'don't limit anyone's upside — make complexity invisible while
  preserving full capability' — a durable counter to the reflex of simplifying tools for non-technical users.
- Aaron Levie (Box, page 2): computer-use + write-and-run-code-on-the-fly are the 'ultimate primitives' for
  agents, because most enterprise work spans multiple apps/data sources. Durable thesis of the page.
- Delegation mental-model shift (page 2): stop operating the AI as a tool, start delegating to it and
  checking in — restructuring the workday around asynchronous execution rather than filling dead time.

INPUT-ADJUSTMENT PROPOSALS:
1. PC-2 recurrence (source:: arm, BOTH pages) — dictionary/verify additions: Seb 'Go to Jen'→real Ramp
   author (resolve or `[sic]`), Peter Gustaff→Peter Gostev (HIGH-confidence — cross-page canonical already
   in the sibling page), Felix Riesberg→Felix Rieseberg (verify), Gagan Soluja (`[sic]`). NEW resolution
   rule for PC-2: when a person/org surface form is garbled, prefer an existing spelling on a SIBLING
   podcast-evidence page as the canonical target before falling back to ontology/parametric — the cluster is
   self-consistent evidence. No new code; extends the APPLIED PC-2 dictionary + resolution order.
2. PC-1 recurrence (homonym cross-domain + generic-token, BOTH pages) — [[Payment Channels]] (AI→crypto) is
   caught by the APPLIED source-vs-target-domain guard; [[System]]/[[Data]] generic-noun spam by the APPLIED
   min-specificity gate. Reconfirms both arms fire on live pages; no new code. Note the recurring generic
   [[System]] (10/13 on page 1) is a candidate for the extraction-prompt stop-list ('System') if it keeps
   dominating tag sets on future pages.
3. claim-date standing item — POSITIVE control on 2 more post-fix pages (claim-date == episode-date ≠
   ingest-date). One-line ingest fix unchanged (record): `_build_ledger_bullet` sets `claim_date =
   episode_date` (fall back to ingest_date only when episode_date absent). Closed for post-fix pages; both
   pages excluded from the deferred re-date sweep.

HIGH-severity: none. Two pages (GOOD + ACCEPTABLE), all findings MEDIUM/LOW recurrences of APPLIED PC-1/PC-2
(+ a PC-4 working-as-intended snapshot flag) + two positive claim-date controls → no new PROPOSED CHANGES
block. PC-2 gains a cross-page (sibling-page canonical) resolution rule; PC-1 gains a 'System' stop-list
candidate to watch.

### 2026-08-24 — Review wave #43 (synthesiser)
Pages reviewed (1): `podcast-evidence___how-to-use-opus-47-and-the-new-codex.md` verdict GOOD. All findings
are recurrences of APPLIED PC-2 (entity-name ASR normalisation) and PC-3 (provenance/confidence over-cap),
plus a strong set of POSITIVE controls (claim-date, wikilinks, dedup, evidence-confined ASR). No new kind,
no HIGH-severity → no new PROPOSED CHANGES block. One LOW single-assertion missing-wikilink → new W-LINKGAP
watch (graduates on a 2nd page). PC-2 header extended to #43; PC-3 header extended to #43.

Defects by kind:
- asr-artefact-entity-name (MEDIUM, PC-2 — structured/body arm): benchmark entity 'Office QA Pro' (Opus 4.7
  57.1%->80.6%) is almost certainly ASR garble of 'GPQA' (Graduate-level Google-Proof QA); the 57.1->80.6
  range + 'Pro/Diamond' framing fit GPQA, and 'Office QA Pro' matches no established benchmark. This is a BODY
  entity that would mint a spurious [[Office QA Pro]] identity once linking runs → correct BEFORE link
  emission (PC-2 body-normalisation before PC-1, per the existing ordering note). Verify against source; the
  sibling 'OSWorld' benchmark on the same page transcribed cleanly, confirming this is a localised mishearing.
- confidence-calibration (LOW, PC-3 territory): tier-1 benchmark-number claims sit at confidence 0.95 despite
  being single-source, ASR-transcribed figures — and the 'Office QA Pro' mishearing is direct in-episode
  evidence that this class is error-prone. PC-3's first-party/single-source cap already covers this: benchmark
  numbers relayed from one ASR pass warrant ≤~0.85-0.9, not 0.95. Reconfirms the PC-3 cap fires on live pages;
  no new code. Not a blocker.
- missing-wikilink (LOW, NEW kind → W-LINKGAP): the long-context-retrieval-regression assertion (L61, Opus
  4.7 78.3%->32.2%) carries NO [[wikilink]], unlike every other assertion on the page. Distinct from PC-1
  (which REFUSES generic/wrong-sense links): here a legitimately linkable assertion emits zero links, dropping
  it out of graph connectivity. Should carry e.g. [[Model Performance]] (+ arguably a Long-Context concept).
  First occurrence of a zero-link assertion on an otherwise well-linked page → opened as W-LINKGAP (below);
  graduates on a 2nd page.
- claim-date — NON-DEFECT / POSITIVE control: all 12 claim-date:: values are 2026-04-18 == episode-date::
  2026-04-18, distinct from ingest-date:: 2026-08-24 → Refinement #1 holds on another post-fix page.
  episode-date:: is present and populated, so NO re-dating is required and the page is EXCLUDED from the
  deferred pre-fix re-date sweep.
- wikilinks — POSITIVE control: all 11 distinct [[wikilinks]] resolve to existing space-named page files
  (Computer Use, Agent Memory, Model Performance, Multimodal AI Architecture, Prompt Engineering, Agentic
  Workflow, User Interface Design, Autonomous Agent, Generative Model, AI-Augmented Software Engineering,
  Workflow Automation) — PC-1 link hygiene clean apart from the one missing-link above.
- dedup — POSITIVE control: 12 assertions each carry a unique assertion-fp comment; no intra-page duplicates.
- entity-quality / evidence-confined ASR — POSITIVE control (PC-2 verbatim arm working as intended): raw ASR
  artefacts ('4 6 and 4 7', '4 7') are correctly confined to verbatim evidence:: quotes while assertion prose
  and entity/wikilink names are cleanly normalised to 'Opus 4.7' — no transcript-verbatim garble leaked into
  curated claim text.

Top wisdom:
- Cat Wu (Anthropic) delegation principle: treat the model as a capable engineer handed a full task (goal +
  constraints + acceptance criteria up front), NOT a pair-programmer guided line-by-line — progressive
  clarification across turns can REDUCE Opus 4.7 output quality. Durable prompt-engineering wisdom.
- 'Mono-thread' pattern (Nick Bowman, Codex): keep a few long-lived threads around recurring work streams
  rather than spawning short-lived chats — with good context compaction a thread's VALUE INCREASES over time.
  Durable, model-agnostic workflow insight that inverts the 'start fresh every task' default.
- 'Codex Chief of Staff' pattern (Jason Lu): use a local folder vault as a durable memory layer; the agent
  interviews the user, then runs on a heartbeat to monitor sources and iteratively improve its own heartbeat
  prompt / agents.md / project notes — a durable self-improving-agent design pattern.

INPUT-ADJUSTMENT PROPOSALS:
1. PC-2 recurrence (body arm) — dictionary/verify addition 'Office QA Pro'->'GPQA' (verify against source;
   likely GPQA Diamond). Body entity garble that would mint a wrong [[GPQA]]/[[Office QA Pro]]. Covered by
   PC-2 (APPLIED); ensure body-normalisation runs before PC-1 link emission. No new code.
2. PC-3 recurrence (confidence cap) — down-tune tier-1 single-source ASR-transcribed benchmark numbers from
   0.95 to ~0.88; the in-episode 'Office QA Pro' mishearing is a live example of why this class should not
   carry 0.95. Reconfirms the APPLIED PC-3 cap; no new code.
3. NEW W-LINKGAP (assertion-level link-coverage floor) — flag assertions that emit ZERO [[wikilinks]] on an
   otherwise-linked page and suggest a link (e.g. [[Model Performance]] for the L61 long-context regression).
   Complements PC-1 (which subtracts bad links) by ensuring linkable assertions are not left orphaned.
   Watch-tagged; graduates on a 2nd page.
4. claim-date standing item — POSITIVE control again (claim-date == episode-date ≠ ingest-date; episode-date
   populated). One-line ingest fix unchanged (record): in ingest.py `_build_ledger_bullet`,
   `claim_date = episode_date` (fall back to ingest_date only when episode_date is absent). Closed for
   post-fix pages.

HIGH-severity: none. Single page, verdict GOOD; one MEDIUM PC-2 recurrence + one LOW PC-3 recurrence + a new
LOW missing-link class (W-LINKGAP) + four positive controls → no new PROPOSED CHANGES block.

### 2026-08-24 — Review wave #44 (synthesiser)
Pages reviewed (1): `podcast-evidence___in-defense-of-tokenmaxxing.md` verdict GOOD. One MEDIUM body ASR
entity garble (PC-2 recurrence, body arm) + two LOW-severity items (a NEW wikilink-casing kind → new watch
W-CASE; PC-2 verbatim-arm positive control) + a strong claim-date POSITIVE control. No new kind at
HIGH severity, single page → no new PROPOSED CHANGES block. PC-2 header extended to #44.

Defects by kind:
- asr-mistranscribed-entity-name (MEDIUM, PC-2 — body arm): L71 'Robinhood co-founder Baiju Bhatt unveiled a
  new startup called Space Cowboy Corp ... fundraising at $2 billion.' Bhatt's known space venture is
  Aetherflux; 'Space Cowboy Corp' reads as an ASR mishearing / colloquial host framing lifted verbatim. The
  name sits INSIDE a claim with NO [[wikilink]], so blast radius is low (no phantom node minted yet), but the
  entity must be verified before any node seeds from it. Covered by APPLIED PC-2 (body-normalisation before
  PC-1 link emission); verify against a primary source, `[sic]`-flag if unverifiable rather than mint.
- non-canonical-wikilink-casing (LOW, NEW kind → W-CASE): [[Enterprise Ai]] (L101) and [[National Ai
  Strategy]] (L121) use lowercase 'Ai'. Both targets EXIST and resolve, so this is NOT a PC-1 (bad/generic
  link) nor a broken link — but the casing is non-canonical against the graph's dominant 'AI' convention
  (Enterprise AI Adoption, AI Infrastructure, Agentic AI). These look like duplicate/variant stub pages that
  FRAGMENT the concept node from its canonical 'AI'-cased form. First occurrence of a resolving-but-non-
  canonical-casing link → opened as W-CASE (below); graduates on a 2nd page. Adjacent to W-CANON (intra-page
  variant merge) but cross-graph and casing-specific: the fix is retarget/merge the variant stub to the
  canonical 'AI'-cased page, not pick one surface form within the page.
- evidence-confined ASR noise — POSITIVE control (PC-2 verbatim arm working as intended): 'a a feature called
  personal intelligence' (L18, doubled article) and 'do go farther and actually defend' (L108, filler
  duplication) are correctly confined to verbatim evidence:: quotes; they do not leak into entity names,
  wikilinks, or curated assertion prose. Confirms raw-ASR passthrough stays quarantined in evidence.
- claim-date — NON-DEFECT / POSITIVE control: every claim-date:: is 2026-05-14 == episode-date:: 2026-05-14,
  distinct from ingest-date:: 2026-08-24 → Refinement #1 holds on another post-fix page. episode-date:: is
  present and populated, so NO re-dating is required and the page is EXCLUDED from the deferred pre-fix
  re-date sweep. Flagged by the reviewer as a clean reference example of the intended dating behaviour.

Top wisdom:
- Assisted→agentic shift > the ChatGPT moment (Tier-2 durable, L91): the shift from assisted to agentic AI is
  a MORE significant disruption than the ChatGPT moment because knowledge work changes from producing things
  to setting up the conditions for agents to produce them. Highest-value durable framing on the page.
- Token-maxing as capability-overhang remedy (Tier-2 durable, L101): token-maxing is defensible because
  incentivising experimentation is how enterprises overcome the 'capability overhang' and learn to use
  agentic AI effectively — a reusable strategic principle, not news.
- 'AI bubble' revival rests on a hasty generalisation (Tier-2 durable, L111): the 'AI isn't good' revival
  treats a handful of token-waste anecdotes as representative of the majority of token consumption — a
  durable critical-reasoning caution.

INPUT-ADJUSTMENT PROPOSALS:
1. PC-2 recurrence (body arm) — verify 'Space Cowboy Corp' (L71) against a primary source before it seeds any
   entity node; likely an ASR/colloquial rendering of Baiju Bhatt's actual venture (Aetherflux). Covered by
   PC-2 (APPLIED); ensure body-normalisation runs before PC-1 link emission, `[sic]` over mint. No new code.
2. NEW W-CASE (wikilink-casing canonicalisation) — flag resolving-but-non-canonical-casing links ([[Enterprise
   Ai]], [[National Ai Strategy]]) and retarget/merge to the graph's canonical 'AI'-cased pages to stop
   concept fragmentation. Distinct from PC-1 (which subtracts BAD/unresolvable links) and W-CANON (intra-page
   variant merge). Watch-tagged; graduates on a 2nd page.
3. claim-date standing item — POSITIVE control again (claim-date == episode-date ≠ ingest-date; episode-date
   populated). One-line ingest fix unchanged (record): in ingest.py `_build_ledger_bullet`,
   `claim_date = episode_date` (fall back to ingest_date only when episode_date is absent). Closed for
   post-fix pages; this page is offered as the clean reference pattern for the deferred pre-fix re-date sweep.
4. Optional (non-graph): light-clean the two evidence-quote ASR artefacts ('a a feature', 'do go farther') only
   if evidence:: is ever surfaced to readers; harmless and correct to leave as faithful transcript otherwise.

HIGH-severity: none. Single page, verdict GOOD; one MEDIUM PC-2 recurrence + one NEW LOW casing kind (W-CASE)
+ two positive controls → no new PROPOSED CHANGES block.

### 2026-08-24 — Review wave #45 (synthesiser)
Pages reviewed (1): `podcast-evidence___introducing-maturity-maps-a-new-way-to-measure-ai-adoption.md`
verdict GOOD. All three findings LOW severity: one NEW kind (compound/bundled-stat assertion → new watch
W-COMPOUND), one recurring transcript-verbatim-hype positive control (folds into wave-#9 hype watch), and a
claim-date POSITIVE control. No HIGH-severity kind, single page → no new PROPOSED CHANGES block.

Defects by kind:
- compound-claim (LOW, NEW kind → W-COMPOUND): assertion fp b1ca9f791398ac58 bundles two independent
  statistics into one claim — '50% of AI agents are unmonitored' AND '88% of organisations have had security
  incidents'. These are separate measures with separate provenance and separate re-date lifetimes; bundled,
  neither can be independently verified, sourced, or time-decayed (interacts with PC-3 authority + PC-4
  volatility, which are per-assertion). First occurrence → opened as W-COMPOUND (below); graduates on a 2nd
  page. Distinct from PC-5 (claim-vs-own-evidence divergence): here both stats may be evidence-grounded, the
  defect is that ONE ledger bullet carries TWO atomic claims.
- transcript-verbatim-hype (LOW, recurring positive control — hype arm working as intended): colloquial hype
  tokens ('glow-up', 'catapult', 'jump out ahead') survive in the evidence:: quotes of two tier-3 assertions
  (fp 15cbd203ead5d564, db2a0164e947b6a5) but are correctly QUARANTINED to the evidence quote — the assertion
  bodies are paraphrased and measured. Cosmetic, not a content defect; folds into the wave-#9 hype-overreach
  watch (hedge/hype must not harden into the body — it did not here). The quotes carry no info beyond the
  paraphrase, so optional trim-to-informative-fragment applies.
- claim-date — NON-DEFECT / POSITIVE control: every claim-date:: is 2026-04-06 == episode-date:: 2026-04-06,
  distinct from ingest-date:: 2026-08-24 → Refinement #1 holds on another post-fix page. episode-date:: present
  and populated → NO re-dating required; page EXCLUDED from the deferred pre-fix re-date sweep. Minor internal
  tension noted by reviewer (NOT an error): an episode dated 2026-04-06 (early Q2) brands the analysis 'Q2 AI
  maturity maps' while the aggregation window ('480 studies from the last quarter') is Q1 — plausible framing,
  flagged only so the Q2 label is not mistaken for the data window.

Top wisdom:
- Data is the FLOOR CONSTRAINT, not one pillar among many (Tier-2 durable — most re-usable claim on the page):
  data caps every other AI-maturity dimension; 8 of 10 functions score 1–1.5 on data, so without proprietary
  context organisations cannot progress past basic assisted usage.
- The 'adoption embedding gap' / 'applied capability overhang' (Tier-2 durable): high claimed AI adoption
  coexists with low depth and utilisation across every function-specific survey — the single most dominant
  cross-source finding.
- Deloitte: 93% of AI spend goes to infrastructure, only 7% to people-related investment (Tier-1, named
  secondary) — a durable, quantified statement of where the real adoption bottleneck sits.

INPUT-ADJUSTMENT PROPOSALS:
1. NEW W-COMPOUND (split bundled-stat assertions) — split the security-governance assertion (fp b1ca9f791398ac58)
   into two separately-sourced ledger bullets so each stat carries its own provenance / authority / volatility
   and is independently verifiable and re-datable. Watch-tagged; graduates to a PROPOSED CHANGES block (or folds
   into the extraction 'one atomic claim per assertion' rule) on a 2nd page. No code change yet.
2. Source-authority lift (PC-3 territory, APPLIED field) — attribute the currently-anonymous 'Host (citing a
   study)' stats (72%/55% training gap, 23% ops strategy, 88% sales) to the named source studies where the
   transcript identifies them, so source_authority:: rises above generic 'secondary'. Uses the existing PC-3
   field; no new code.
3. transcript-verbatim-hype (recurring) — optional trim of the tier-3 evidence quotes ('glow-up', 'catapult',
   'jump out ahead') to the informative fragment only. Cosmetic; folds into wave-#9 hype watch. No code change.
4. Durable-vs-snapshot tagging (PC-4 territory, APPLIED field) — the reviewer's request to mark the two tier-2
   durable insights distinctly from the ephemeral quarterly-snapshot stats is exactly volatility:: durable vs
   snapshot; ensure the grader stamps the maturity-map quarterly stats 'snapshot' and the floor-constraint /
   overhang framings 'durable'. Uses the existing PC-4 field; no new code.
5. claim-date standing item — POSITIVE control again (claim-date == episode-date ≠ ingest-date; episode-date
   populated). One-line ingest fix unchanged (record): in ingest.py `_build_ledger_bullet`,
   `claim_date = episode_date` (fall back to ingest_date only when episode_date is absent). Closed for post-fix
   pages; this page is another clean reference for the deferred pre-fix re-date sweep.

HIGH-severity: none. Single page, verdict GOOD; one NEW LOW kind (W-COMPOUND) + one recurring hype positive
control + one claim-date positive control → no new PROPOSED CHANGES block.

### 2026-08-24 — Review wave #46 (synthesiser)
Pages reviewed (1): `podcast-evidence___is-ai-doom-going-out-of-style.md` verdict GOOD. Two MEDIUM
wikilink-mislinks (both PC-1 recurrences, sub-cases (c) wrong-granularity + (d) wrong-sense — NOT caught by
the APPLIED specificity/short-acronym gate, so they reinforce the still-unimplemented ontology-sense arm) +
four LOW items: a W-LINKGAP recurrence that GRADUATES it → new PC-6 (2nd zero-link page), a PC-3
source-authority MIS-GRADE (first post-apply calibration miss on the applied field), a PC-2 verbatim-arm
positive control, and a claim-date positive control. No HIGH-severity kind; the only PROPOSED-CHANGES event
is W-LINKGAP's pre-registered 2nd-page graduation → PC-6.

Defects by kind:
- wikilink-mislink (MEDIUM ×2, PC-1 recurrence — sub-cases (c) + (d)): (i) L31 the Atlassian revenue-growth
  claim (32% YoY, Rovo) is tagged [[IoT AI Integration]] — a real page but semantically unrelated to
  Atlassian/Rovo; PC-1 sub-case (d) wrong-sense/domain-collision (a mis-fired auto-linker, target domain
  incompatible with the claim's sense). (ii) L151 the OpenAI messaging/rhetoric-pivot claim is tagged
  [[OpenAI API]] where the claim is about the COMPANY's public framing, not its API — PC-1 sub-case (c)
  wrong-granularity, the canonical [[OpenAI API]]→org example already in the PC-1 write-up; correct target
  [[OpenAI Research Organisation]] exists in-graph. Both links RESOLVE, so the APPLIED PC-1 specificity/
  short-acronym gate does not fire — only the ontology-match-against-host-claim-sense arm (c) and the
  source↔target domain guard (d) catch these, and neither is implemented yet. Reinforces PC-1's still-open
  ontology-sense arm; no new watch (already PC-1 territory).
- zero-wikilink assertions (LOW → GRADUATES W-LINKGAP → PC-6): L21 LinkedIn jobs, L51 Stripe Atlas, L61/L71
  unemployment, L91 Citadel software postings, L121 vibe-shift, L141 Ezra Klein all carry NO [[wikilink]]
  while cleanly-linkable entities exist (Stripe, labour-market/unemployment, OpenAI-as-organisation),
  dropping the assertions out of graph connectivity. This is the 2nd page with zero-link assertions
  (wave #43 `how-to-use-opus-47-and-the-new-codex` was the 1st) → W-LINKGAP hits its pre-registered 2nd-page
  trigger and graduates to PC-6 below.
- source-authority-mislabel (LOW, PC-3 calibration MISS — first post-apply): L21/24 the LinkedIn jobs stat is
  stamped source_authority:: primary, but the evidence is WSJ reporting a LinkedIn analysis — the ledger
  source is second-hand → 'secondary' is correct. The APPLIED PC-3 field is being emitted but MIS-GRADED here
  (relay mistaken for primary); L31 Atlassian-direct 'primary' is fine. Calibration data point for the PC-3
  grader (relay-through-a-named-outlet ⇒ secondary), not a new code change — the field already exists.
- possible-asr-artefact (LOW, PC-2 verbatim-arm POSITIVE control): L48 analyst name 'Holger Shapitz' is very
  likely an ASR mangling of the Morgan Stanley economist, but it sits INSIDE a verbatim evidence:: quote (not
  an entity/wikilink) → correctly QUARANTINED, no phantom node minted. Confirms PC-2 raw-ASR passthrough stays
  in evidence; verify against a primary source and `[sic]`-flag if unverifiable rather than seed a node.
- claim-date — NON-DEFECT / POSITIVE control: every claim-date:: is 2026-05-05 == episode-date:: 2026-05-05,
  distinct from ingest-date:: 2026-08-24 → Refinement #1 holds on another post-fix page. episode-date:: present
  and populated → NO re-dating required; page EXCLUDED from the deferred pre-fix re-date sweep.

Top wisdom:
- Seats→tokens business-model shift (Tier-2 durable, L101 — most portable insight on the page): selling
  'tokens' instead of per-user 'seats' removes the per-user cap on consumption and is the structural reason a
  trillion-dollar infrastructure buildout can be economically justified.
- Structure beats token-hungry retrieval (Tier-2 durable, L111 — directly relevant to THIS KG project):
  Atlassian's Rovo is more token-efficient than RAG because it exploits Jira's existing structured knowledge
  graph rather than re-retrieving context — a reusable argument that a maintained graph out-performs re-RAG.
- Partial displacement is socially harder than total (Tier-3 durable, L141): Ezra Klein's counter-intuitive
  claim that displacing 8M workers may be harder than 80M, because partial displacement never forces the
  wholesale economic restructuring that a total shock would — a durable socio-economic argument vs stat-of-the-week.

INPUT-ADJUSTMENT PROPOSALS:
1. PC-1 recurrence (sub-cases (c)+(d)) — re-target the two mislinks: DROP [[IoT AI Integration]] on the
   Atlassian claim (L31; wrong-sense, no clean target ⇒ prefer no link over a false edge) and SWAP
   [[OpenAI API]]→[[OpenAI Research Organisation]] on L151 (wrong-granularity, correct page exists). Both are
   the unimplemented ontology-sense/domain arms of PC-1 (APPLIED gate only covers specificity/short-acronym);
   reinforces PC-1's open arm, no NEW proposal.
2. W-LINKGAP GRADUATES → PC-6 (link-coverage floor) — the 6 zero-link assertions are the 2nd-page trigger;
   concrete proposed shape written into PC-6 below. Guard preserved: satisfy the floor only with a
   high-precision link, never a generic/wrong-sense one (respect PC-1) — an orphan beats a false edge.
3. PC-3 calibration (no code) — down-grade the LinkedIn jobs source_authority:: primary→secondary (WSJ-via-
   LinkedIn); feed 'relay through a named outlet ⇒ secondary' back to the grader as a calibration example.
4. claim-date standing item — POSITIVE control again (claim-date == episode-date ≠ ingest-date; episode-date
   populated). One-line ingest fix unchanged (record): in ingest.py `_build_ledger_bullet`,
   `claim_date = episode_date` (fall back to ingest_date only when episode_date is absent). Closed for post-fix
   pages; this page is another clean reference for the deferred pre-fix re-date sweep.

HIGH-severity: none. Single page, verdict GOOD. Two MEDIUM items are PC-1 recurrences (no new block); the sole
PROPOSED-CHANGES event is W-LINKGAP's pre-registered 2nd-page graduation → PC-6 (a LOW-severity watch-
graduation, matching the PC-4/PC-5 discipline, not the HIGH-on-2+ rule).

### 2026-08-24 — Review wave #47 (synthesiser)
Pages reviewed (2): `podcast-evidence___is-gpt-52-garlic-coming-this-week.md` verdict GOOD (all LOW);
`podcast-evidence___is-kimi-k3-really-fable-class.md` verdict ACCEPTABLE (one HIGH, two MEDIUM, one LOW).
The HIGH is an ASR-mishearing of the primary entity name — PC-2 body-arm territory — but on a SINGLE page,
so it feeds PC-2 (below), it does NOT trip the HIGH-on-2+ new-block rule. Both pages are claim-date POSITIVE
controls (Refinement #1 holds twice more). Two NEW kinds surface → two new watches (W-UNITS, W-PREDFACT).

Defects by kind:
- asr-artefact-entity-name (HIGH, page 2 — PC-2 body-arm recurrence, single page): the primary entity is
  written 'Kimmy K3' across ALL 12 assertions AND every evidence block, while the title/filename correctly say
  'Kimi K3' (Moonshot AI's Kimi line). The mishearing has hardened into the structured claim body, not just
  verbatim quotes → it will FRAGMENT the entity (Kimmy K3 vs Kimi K3). The title is ground truth. This is
  exactly PC-2's non-person body arm; dictionary seed 'Kimmy K3'→'Kimi K3' added to PC-2. Single page → PC-2
  recurrence, not a new PROPOSED-CHANGES block.
- asr-artefact-supporting-names (MEDIUM, page 2 — PC-2 body + verbatim arms): garbled person/benchmark names
  ('Deepu coding benchmark', 'Jee Bal', 'Ryan Feduick', 'Jukan', 'Divium', 'Sue Hail'/Mixpanel, 'Theo Jaffy')
  plus raw ASR tokens leaking into prose ('Opus 48', 'GPT55', '56 Soul'). Split by PC-2 arm: names inside
  verbatim evidence:: stay quarantined + `[sic]`-flagged (raw-ASR passthrough, no phantom node); names that
  leaked into assertion prose need resolve-or-`[sic]` against the episode description before sources are treated
  as citable. No new block — PC-2 already owns both arms.
- unit-inconsistent-comparison (MEDIUM, page 2 — NEW kind → W-UNITS): L41 prices Kimi K3 at '$5.40 per 1M
  tokens' against 'Deepseek V4 Pro ($0.04 per task)' and calls K3 'significantly higher' — mixing $/1M-tokens
  with $/task, an apples-to-oranges comparison baked into the claim itself (not just the quote). Distinct from
  PC-5 (claim-vs-own-evidence divergence — here the units may be faithfully extracted, but the COMPARISON is
  invalid) and W-COMPOUND (bundled independent stats). New watch W-UNITS registered.
- wikilink-semantic-looseness (LOW, page 1 — PC-1 recurrence, sub-case (c) wrong-granularity): both links
  RESOLVE to real files (structurally valid) but are loose proxies. [[OpenAI API]] is used as a stand-in for
  OpenAI-the-organisation on org-level claims (Polymarket 'best AI model' odds, Bloomberg stock basket, Code
  Red) — the canonical PC-1 [[OpenAI API]]→[[OpenAI Research Organisation]] example (same as wave #46 L151);
  and [[National Ai Strategy]] is attached to the Apple/Giannandrea talent-departure claim (corporate talent
  churn, not national policy) = wrong-sense. PC-1's still-open ontology-sense/granularity arm (APPLIED gate
  only covers specificity/short-acronym), no new block.
- prediction-tagged-as-snapshot-fact (LOW, page 1 — NEW kind → W-PREDFACT): the GPT-5.2 'earmarked for release
  Tuesday December 9' assertion (tier 1, conf 0.9) is a forward-looking same-week rumour sourced to The Verge's
  Tom Warren (secondary), yet framed declaratively. Two post-apply calibration angles: source_authority::
  should read 'rumour' and cap confidence below 0.9 (PC-3), and an unconfirmed FUTURE-dated release is arguably
  volatility:: speculative, not snapshot (PC-4) — the most perishable claim on the page. New watch W-PREDFACT
  registered (substantially overlaps PC-3 rumour-cap + PC-4 speculative-volatility calibration; may fold there).
- claim-date — NON-DEFECT / POSITIVE controls ×2: page 1 every claim-date:: 2025-12-08 == episode-date::
  2025-12-08 (≠ ingest-date:: 2026-08-24); page 2 every claim-date:: 2026-07-21 == episode-date:: 2026-07-21
  (≠ ingest-date:: 2026-08-24). episode-date:: present and populated on both → Refinement #1 holds, NO
  re-dating required, both pages EXCLUDED from the deferred pre-fix re-date sweep.

Top wisdom:
- Mark Chen (OpenAI CRO) publicly conceded ChatGPT's integrated app suggestions 'felt like an ad', that they
  'fell short', and that OpenAI turned the feature off while improving model precision (page 1) — a durable,
  sourced admission of the monetisation-vs-UX tension, more lasting than the news around it.
- The distillation narrative is overexaggerated: Chinese labs (Moonshot et al.) show genuine independent
  model-building capability, not just distillation of US models (Sue Hail / Nathan Lambert, page 2) — a durable
  structural read, not benchmark-of-the-week. Paired caution: benchmark-optimised visual/UI coding scores can
  mask a real gap in deep architectural understanding (K3 failed a one-shot debug task Fable 5 + GPT 5.6 solved).
- OpenAI's 'Code Red' reads better as a bullish refocus on execution (speed, reliability, customisability) than
  a bearish panic signal (Bucco Capital / The Verge, page 1) — a reusable interpretive frame for incumbent-lab
  strategy shifts.

INPUT-ADJUSTMENT PROPOSALS:
1. PC-2 recurrence (no new block) — normalise 'Kimmy K3'→'Kimi K3' across all 12 assertions + evidence blocks
   (title is ground truth; prevents entity fragmentation); resolve-or-`[sic]` the supporting-name garbles
   (Deepu/Jee Bal/Ryan Feduick/Jukan/Divium/Sue Hail/Theo Jaffy) against the episode description; keep
   evidence:: ASR tokens ('Opus 48'='Opus 4.8', 'GPT55'='GPT-5.5', '56 Soul') quarantined + `[sic]`-flagged.
   Dictionary seed added to PC-2.
2. W-UNITS (NEW watch) — fix the L41 pricing comparison to compare like units (both $/1M-tokens OR both $/task),
   or drop the 'significantly higher than Deepseek' clause, since $/1M-tokens vs $/task are not commensurable.
3. PC-1 recurrence (no new block) — SWAP [[OpenAI API]]→[[OpenAI Research Organisation]] on the org-level
   claims (Polymarket odds, Bloomberg basket, Code Red), reserving [[OpenAI API]] for genuine API/product
   claims; DROP [[National Ai Strategy]] on the Apple/Giannandrea talent claim (wrong-sense, no clean target ⇒
   prefer no link). Both are PC-1's unimplemented ontology-sense/granularity arm.
4. W-PREDFACT (NEW watch) — down-grade the GPT-5.2 'release Tuesday' rumour to source_authority:: rumour and
   confidence < 0.9 (PC-3), and consider volatility:: speculative over snapshot (PC-4); calibration data point
   that an unconfirmed FUTURE-dated same-week release from a single secondary source must not read tier-1 @0.9.
5. claim-date standing item — POSITIVE controls ×2 (both pages claim-date == episode-date ≠ ingest-date;
   episode-date populated). One-line ingest fix unchanged and already APPLIED (Refinement #1): in ingest.py
   `_build_ledger_bullet`, `claim_date = episode_date` (fall back to ingest_date only when episode_date is
   absent). Closed for post-fix pages; both pages are clean references, not sweep candidates.

HIGH-severity: one (asr-artefact-entity-name, page 2 only). Single page → feeds PC-2, does NOT meet the
HIGH-on-2+ new-block rule. Two NEW kinds this wave (unit-inconsistent-comparison, prediction-as-fact) → two
watches (W-UNITS, W-PREDFACT). No new PROPOSED-CHANGES block from this wave.

### 2026-08-24 — Review wave #48 (synthesiser)
Pages reviewed (1): `podcast-evidence___is-openai-the-new-github.md` verdict GOOD (all findings LOW/MEDIUM,
no HIGH). Positive control for claim-date (Refinement #1 holds). No new kinds; every MEDIUM folds into an
existing PC. Two things worth flagging: the PC-1 granularity arm and the PC-3 relay-mislabel are now BOTH
recurring on 3 consecutive waves (#46/#47/#48) — the unimplemented-arm signal is strengthening.

Defects by kind:
- entity-mislink (MEDIUM, PC-1 granularity arm — 3rd consecutive wave): L51 + L111 link OpenAI-the-company /
  its internal-GitHub-alternative infra strategy to [[OpenAI API]], but the subject is the ORG, not the API
  product → wrong-granularity. The canonical PC-1 [[OpenAI API]]→[[OpenAI Research Organisation]] example
  (same target page exists in-graph; identical to wave #46 L151 and wave #47 page 1). Both links RESOLVE, so
  the APPLIED PC-1 specificity/short-acronym gate does NOT catch it — this is PC-1's still-unimplemented
  ontology-sense/granularity arm. No new block (MEDIUM, single page this wave), but see escalation note below.
- source-authority-mislabel (MEDIUM, PC-3 grader calibration — relay-through-named-outlet arm): L21 (Amazon
  ad-revenue), L31 (Stripe), L41 (Apple M5) are stamped source_authority:: primary, but source:: is 'Host
  (citing …)' — the host is RELAYING a third-party announcement → 'secondary' is correct. Contrast the
  correctly-graded secondary items on the same page (The Information, Bloomberg, WSJ). The APPLIED PC-3 field
  is emitted but MIS-GRADED (relay mistaken for primary) — same miss as wave #46 L21 (WSJ-via-LinkedIn) and
  wave #47's rumour arm. Calibration data point for the grader (host-relayed third-party announcement ⇒
  secondary), not a code change — the field already exists.
- missing-entity-capture (LOW, PC-6-adjacent top-up — NOT a floor trigger): the L31 Stripe claim names Vercel
  and OpenRouter as integration targets but neither is wikilinked (Stripe is). PC-6's floor triggers on
  ZERO-link assertions only; this assertion is already anchored, so it stays out of the mandate — an OPTIONAL
  entity-graph-completeness top-up ([[Vercel]], [[OpenRouter]]) rather than an orphan fix. No action required.
- wikilink-resolution — CLEAN: all 8 links resolve to existing pages, no broken links.
- dedup-markers — CLEAN: 14 assertions, 14 unique assertion-fp comments.
- tier-confidence — CLEAN: monotonic and coherent (tier 1 reported facts 0.85–0.95; tier 2 analysis
  0.70–0.80; tier 3 speculative 0.50–0.55), volatility tags aligned (snapshot for figures, durable for
  analysis, speculative for tier 3). No PC-3/PC-4 confidence miscalibration.
- claim-date — NON-DEFECT / POSITIVE control: every claim-date:: 2026-03-05 == episode-date:: 2026-03-05
  (≠ ingest-date:: 2026-08-24). episode-date:: present and populated → Refinement #1 holds, NO re-dating
  required, page EXCLUDED from the deferred pre-fix re-date sweep.

Top wisdom:
- (Amjad, fp b6e3d649) The value of code hosting is not storage but owning the layer that understands how code
  connects across services and teams — 'that's where agents actually need to operate.' Most transferable idea
  on the page; durable, outlasts the outage news.
- (fp 816c4590) Stripe's token billing makes usage-based pricing viable by letting tokens be priced as a
  commodity all the way to the end user — reframes the −14%-gross-margin flat-rate trap (Replit) as a solvable
  pricing problem.
- (fp 905797ee) OpenAI building an internal GitHub alternative is an inevitable shift driven by the code volume
  flowing through AI companies, not merely Microsoft rivalry — a durable structural read.

INPUT-ADJUSTMENT PROPOSALS:
1. PC-1 recurrence (no new block) — SWAP [[OpenAI API]]→[[OpenAI Research Organisation]] on L51 + L111
   (org-level infra-strategy claims), reserving [[OpenAI API]] for genuine API/product claims. PC-1's
   unimplemented granularity arm.
2. PC-3 calibration (no code) — down-grade L21/L31/L41 source_authority:: primary→secondary (host relaying a
   third-party announcement); feed 'host relays a third-party announcement ⇒ secondary' back to the grader as
   a calibration example (mirrors wave #46's 'relay through a named outlet ⇒ secondary').
3. Optional (no action) — add [[Vercel]] + [[OpenRouter]] to the L31 Stripe claim for entity-graph
   completeness; not a PC-6 obligation (assertion already anchored to [[Stripe]]).
4. claim-date standing item — POSITIVE control (claim-date == episode-date ≠ ingest-date; episode-date
   populated). One-line ingest fix unchanged and already APPLIED (Refinement #1): in ingest.py
   `_build_ledger_bullet`, `claim_date = episode_date` (fall back to ingest_date only when episode_date is
   absent). Closed for post-fix pages; this page is a clean reference, not a sweep candidate.

ESCALATION NOTE (no code change by synthesiser): the PC-1 ontology-sense/granularity arm and the PC-3
relay-mislabel calibration have each now recurred on 3 consecutive waves (#46/#47/#48), all with the SAME
[[OpenAI API]]→org signature and the SAME host-relay-graded-primary signature. Neither meets the HIGH-on-2+
rule (all MEDIUM/LOW), so no PROPOSED-CHANGES block is opened, but the consistency argues the team lead should
prioritise (a) implementing PC-1's granularity arm — an entity that resolves to a real page at the WRONG level
should be re-pointed when a correct-level page exists — and (b) hardening the PC-3 grader against relay-as-
primary. Both are already-scoped arms, not new work.

### 2026-08-24 — Review wave #49 (synthesiser)
Pages reviewed (2): `podcast-evidence___is-software-dead.md` verdict ACCEPTABLE (one HIGH, one MEDIUM, two
LOW); `podcast-evidence___is-the-debate-over-anthropics-new-product-about-price-or-existential-dread`
verdict ACCEPTABLE (five MEDIUM, one LOW). Both pages are claim-date POSITIVE controls (Refinement #1 holds
twice more). The wave is dominated by ASR entity garble on BOTH pages — pure PC-2 territory. The lone HIGH
(Klarna, page 1) is single-page, so it FEEDS PC-2 and does NOT trip the HIGH-on-2+ new-block rule; but PC-2
is the one graduated-yet-UNAPPLIED systemic PC (Refinements #2–#6 applied PC-1/#3/#4/#5, not PC-2), and this
wave stacks 8 more entity-garble instances onto it across 2 pages — see escalation.

Defects by kind:
- asr-artefact-entity-name+org (HIGH, page 1 — PC-2 body arm, single page): 'Sebastian Simikowski, CEO of
  Clara' is a double garble of Sebastian Siemiatkowski, CEO of Klarna — BOTH the person AND the company are
  wrong, misattributing a load-bearing SaaS/Salesforce-replacement claim to a non-existent entity pair. Worst
  blast radius on the page (mints two phantom nodes for one real referent). PC-2 dictionary seed added; single
  page → PC-2 recurrence, not a new block.
- asr-artefact-entity-name (MEDIUM ×2 — PC-2 body arm, both pages): page 2 'Devon Review'→'Devin Review'
  (Cognition's code-review product; the announcement was Devin's review feature) and 'Jared Sumner'→'Jarred
  Sumner' (LOW, Bun's creator). Same body-arm mishearing class as the HIGH → all feed PC-2.
- attribution-suspect (MEDIUM, page 2 — PC-2 maker/attribution arm): 'Sourcegraph CEO Dan Adler' — Sourcegraph's
  CEO is Quinn Slack; 'Dan Adler' is a wrong-person role-attribution. This is PC-2's person↔org-role attribution
  arm (verify the claimed role-holder against the graph's known org→leader edges), sibling to the wave-#22
  product→maker arm. Correct to Quinn Slack or `[sic]`-flag; do not carry the false attribution.
- unverifiable-speaker/entity (MEDIUM+LOW — PC-2 `[sic]` arm, both pages): 'Boris Tain' (page 2, the
  SDLC-collapse thesis is attributed to a probably-non-existent speaker), "Broadloom's Todd Sonders" (page 2,
  company+speaker unverifiable), and 'Peter Steinberg, creator of OpenClaw' (page 1 — note OpenClaw itself is a
  confirmed prior match, waves #21/#25, so the PRODUCT resolves; the maker NAME is the suspect token). No
  high-confidence canonical → `[sic]`/unverified-flag rather than guess or mint a node.
- wikilink-irrelevant (MEDIUM, page 2 — PC-1 ontology-sense arm, NOT caught by the APPLIED gate): L31 attaches
  [[Face Recognition]] to a claim about tweet VIEW COUNTS (Devin Review vs Claude Code Review) — an auto-link
  artefact (likely triggered by 'views'/'viewed'). The target file EXISTS so it resolves, and it is a
  multi-token specific page, so the APPLIED PC-1 generic-noun/short-acronym gate does NOT fire — this is PC-1's
  still-unimplemented ontology-sense arm (target domain 'face recognition' incompatible with the claim's
  'tweet-metrics' sense). Same unimplemented arm as #46/#47/#48 → 4th consecutive wave (see escalation). Fix:
  DROP the link (no clean target ⇒ prefer no link).
- zero-wikilinks WHOLE PAGE (MEDIUM, page 1 — PC-6 whole-page arm): the entire ledger emits ZERO [[wikilinks]]
  (grep count 0) — every entity (Nvidia, Jensen Huang, Salesforce, Klarna, Ben Thompson, AppLovin, Google
  Genie 3, Apollo, Lightspeed) is plain text, so the whole page is orphaned from the graph. This is a STRONGER
  form of PC-6 (which triggers on zero-link ASSERTIONS while siblings are linked) — here NO assertion is
  linked, so PC-6's link-coverage floor should apply page-wide once its subtractive-guard (PC-1) partner runs.
  Folds into PC-6 as a whole-page arm; no new watch. NB run PC-2 name-correction FIRST (so the floor anchors
  to 'Klarna'/'Sebastian Siemiatkowski', not the garbles) THEN PC-6.
- volatility snapshot — NON-DEFECT / POSITIVE control (PC-4 working as intended): page 1's tier-1 assertions
  are all ephemeral point-in-time stock snapshots (Salesforce −21%, Snowflake −23%, HubSpot −36%, AppLovin
  −37%, Unity −35%, Take-Two −39%) and are CORRECTLY tagged volatility:: snapshot — exactly PC-4's intended
  behaviour (near-zero durable value, flagged for downstream decay, not accreting as durable wisdom). No defect.
- claim-date — NON-DEFECT / POSITIVE controls ×2: page 1 every claim-date:: 2026-02-06 == episode-date::
  2026-02-06 (≠ ingest-date:: 2026-08-24); page 2 every claim-date:: 2026-03-11 == episode-date:: 2026-03-11
  (≠ ingest-date:: 2026-08-24). episode-date:: populated on both → Refinement #1 holds, NO re-dating required,
  both pages EXCLUDED from the deferred pre-fix re-date sweep.

Top wisdom:
- (Chia Wang) AI makes strong software companies stronger and weak ones weaker: the moat of strong companies is
  distribution, data and lock-in, whereas a weak company's only moat is the software itself — a durable
  framework for reasoning about which vendors survive AI commoditisation.
- (Ben Thompson) The real risk to SaaS is not that AI removes the need for software but that AI lets every
  company write infinite internal software, so businesses cut external software spend to fund their own AI
  tokens — a durable second-order thesis.
- (agentic SDLC-collapse, page 2, attribution unreliable) AI agents don't speed up the discrete stages of the
  software lifecycle, they merge them into a continuous intent/context/iteration loop with no discrete 'step'
  — a durable conceptual reframing (flag: attributed to the suspect 'Boris Tain').
- (quantified review-bottleneck, page 2, sourced) High-AI-adoption teams complete 21% more tasks and merge 98%
  more PRs but PR review time rises 91% (10,000+ devs, 1,255 teams) — durable evidence that review, not
  authoring, is the constraint.

INPUT-ADJUSTMENT PROPOSALS:
1. PC-2 recurrence (no new block, but see escalation) — dictionary seeds added: 'Sebastian Simikowski / Clara'
   → 'Sebastian Siemiatkowski / Klarna' (person+org, HIGH); 'Devon Review'/'Devin Review' → Devin (Cognition
   code-review product); 'Jared Sumner' → 'Jarred Sumner' (Bun). Attribution arm: Sourcegraph CEO = Quinn Slack
   (not 'Dan Adler') — correct or `[sic]`. `[sic]`-flag the unverifiable 'Boris Tain', "Todd Sonders /
   Broadloom", and the 'Peter Steinberg' maker of the (already-canonical) OpenClaw product.
2. PC-1 recurrence (no new block) — DROP [[Face Recognition]] on the page-2 L31 tweet-view-count claim
   (auto-link artefact, ontology-sense incompatible, no clean target ⇒ no link). PC-1's unimplemented
   ontology-sense arm, 4th consecutive wave.
3. PC-6 whole-page arm (no new block) — page 1 emits ZERO links across the ENTIRE ledger; the link-coverage
   floor should apply page-wide, anchoring durable entities (Nvidia, Jensen Huang, Ben Thompson, Klarna, Apollo
   Global Management, Lightspeed) to their specific graph pages, but ONLY after PC-2 name-correction runs first
   and ONLY through PC-1's guards (orphan beats a false edge).
4. claim-date standing item — POSITIVE controls ×2 (both claim-date == episode-date ≠ ingest-date; episode-date
   populated). One-line ingest fix unchanged and already APPLIED (Refinement #1): in ingest.py
   `_build_ledger_bullet`, `claim_date = episode_date` (fall back to ingest_date only when episode_date is
   absent). Closed for post-fix pages; both pages are clean references, not sweep candidates.

HIGH-severity: one (Klarna double-garble, page 1 only). Single page → feeds PC-2, does NOT meet the HIGH-on-2+
new-block rule. No new kinds this wave. No new PROPOSED-CHANGES block from this wave.

ESCALATION NOTE (no code change by synthesiser): TWO already-scoped arms strengthen this wave. (a) PC-1's
ontology-sense arm has now recurred on 4 consecutive waves (#46/#47/#48/#49 — the [[Face Recognition]] mislink
joins the [[OpenAI API]]→org run) with resolving-but-wrong-sense links the APPLIED specificity gate cannot
catch → the team lead should prioritise the ontology-match arm. (b) PC-2 (entity-name normalisation) remains
GRADUATED-BUT-UNAPPLIED (Refinements #2–#6 shipped PC-1/#3/#4/#5, skipping PC-2), yet it is the single most
frequently reinforced PC in the run and this wave alone adds 8 instances across 2 pages including a HIGH
double person+org garble that mints two phantom nodes. The evidence backlog for PC-2 now dwarfs its cost;
recommend applying the PC-2 verify-pass normalisation (with the accumulated dictionary) in the next refinement.

### 2026-08-24 — Review wave #50 (synthesiser)
Pages reviewed (1): `podcast-evidence___is-this-the-best-ai-video-model-in-the-world.md` verdict ACCEPTABLE
(all findings MEDIUM/LOW, no HIGH). Entity-dense page (ByteDance, OpenAI, Databricks, Monday.com, Seedance 2.0,
Veo 3.1, Sora 2, Codex) → the whole wave folds into existing PCs: PC-2 (entity garble, incl. its escalated
structured-field arm), PC-6 (under-linking), and the claim-date positive control. No new kinds, no HIGH, no
new watch, no new PROPOSED-CHANGES block.

Defects by kind:
- asr-artefact-entity-name+structured-field (MEDIUM, PC-2 body arm AND structured-field arm): 'Data Bricks'→
  Databricks, 'Ali Godsy'→Ali Ghodsi (Databricks CEO), 'Aaron Zimman'→Eran Zinman (Monday.com co-CEO),
  'Dear Drabosa (CNBC)'→Deirdre Bosa. Corruption reaches source:: fields, not just verbatim evidence → this is
  PC-2's ESCALATED structured-field arm (the same class that landed on waves #3/#6/#7/#9 — ASR garble in a
  source::/link target rather than a quote). Wrong surface forms fail to co-refer with canonical entity pages
  and fragment the graph. PC-2 dictionary seeds added; single page → PC-2 recurrence, not a new block.
- unverified-person-names (LOW, PC-2 `[sic]` arm): 'DD Do (Menlo Ventures)' and 'Ray Dao (former Google senior
  engineer)' read like ASR guesses, uncorroborated, presented as sourced analysts. No high-confidence canonical
  → `[sic]`/unverified-flag rather than guess or mint a node (do not attach real claims to phantom analysts).
- under-linking (LOW, PC-6 territory): only 2 [[wikilinks]] ([[Agentic AI]], [[Multimodal AI]]) across 12
  claims on an entity-dense page; ByteDance, OpenAI, Databricks, Monday.com, Seedance 2.0, Veo 3.1, Sora 2,
  Codex all plain text. Not the zero-link whole-page arm (wave #49) — links exist but coverage is thin → PC-6's
  link-coverage floor should top up the highest-precision anchors, but ONLY after PC-2 name-correction runs
  first (so the floor anchors to 'Databricks', not 'Data Bricks') and ONLY through PC-1's guards.
- claim-date — NON-DEFECT / POSITIVE control: every claim-date:: 2026-02-13 == episode-date:: 2026-02-13
  (≠ ingest-date:: 2026-08-24). episode-date:: populated → Refinement #1 holds, NO re-dating required, page
  EXCLUDED from the deferred pre-fix re-date sweep.

Top wisdom:
- Databricks: 80% of databases on its platform are now built by AI agents — AI is producing more enterprise
  software than humans are. Durable structural signal about agentic-coding adoption (outlasts the ephemeral
  $5.4B run-rate figure alongside it, correctly a volatility:: snapshot per PC-4).
- Native audiovisual generation (audio produced alongside video, not bolted on in post) is the real
  architectural differentiator of the newest video models — a durable technical insight that outlasts the
  specific Seedance 2.0 vs Veo/Sora ranking.
- OpenAI beginning to serve ads to logged-in free and $8 Go-tier users marks a durable business-model shift for
  frontier chat products, more lasting than the rollout news itself.

INPUT-ADJUSTMENT PROPOSALS:
1. PC-2 recurrence (no new block, feeds escalation) — dictionary seeds added: 'Data Bricks'→Databricks,
   'Ali Godsy'→'Ali Ghodsi', 'Aaron Zimman'→'Eran Zinman' (Monday.com co-CEO), 'Dear Drabosa'→'Deirdre Bosa'
   (CNBC). Normalise in bodies AND source:: fields so blocks co-refer with existing entity pages (structured-
   field arm). `[sic]`-flag the unverifiable analyst names 'DD Do (Menlo Ventures)' and 'Ray Dao (former Google
   senior engineer)' rather than treating them as sourced authorities.
2. PC-6 top-up (no new block) — add highest-precision [[wikilinks]] for ByteDance, OpenAI, Databricks,
   Seedance 2.0, Veo 3.1 and Sora 2 to lift connectivity on this entity-dense page; run PC-2 first, PC-1 guards
   have veto (orphan beats a false edge).
3. claim-date standing item — POSITIVE control (claim-date == episode-date ≠ ingest-date; episode-date
   populated). One-line ingest fix unchanged and already APPLIED (Refinement #1): in ingest.py
   `_build_ledger_bullet`, `claim_date = episode_date` (fall back to ingest_date only when episode_date is
   absent). Closed for post-fix pages; this page is a clean reference, not a sweep candidate.

HIGH-severity: none. No new kinds this wave → no new watch. No new PROPOSED-CHANGES block. Every finding folds
into PC-2 (still GRADUATED-BUT-UNAPPLIED — this wave adds 6 more entity-garble instances incl. 4 structured-
field source:: hits, further widening the PC-2 backlog flagged in wave #49's escalation) and PC-6.

### 2026-08-24 — Review wave #51 (synthesiser)
Pages reviewed (3), all verdict ACCEPTABLE:
1. `is-the-debate-over-anthropics-new-product-about-price-or-existential-dread.md` — 1 HIGH + 4 MEDIUM + 1 LOW,
   claim-date POSITIVE control.
2. `jensen-huang-calls-openclaw-most-important-software-release-ever.md` — 2 MEDIUM + 2 LOW, claim-date +
   dedup/tier POSITIVE controls.
3. `just-how-good-is-gpt-6-going-to-be.md` — 1 HIGH + 2 MEDIUM + 1 LOW, claim-date POSITIVE control.

STRUCTURAL OUTCOME: **W-CANON GRADUATES on its pre-registered 2nd page → written up as PC-7 below.** Two HIGH
findings, but of DIFFERENT kinds that each fold into an already-graduated PC (page 1 → PC-2 person↔org-role
sub-arm, GRADUATED-BUT-UNAPPLIED; page 3 → PC-3+PC-4, APPLIED) → the "HIGH on 2+ pages → new block" rule does
NOT fire for a new block; instead a cross-page PROVENANCE-OVER-GRADING calibration signal on the APPLIED
PC-3/PC-4 fields (pages 2+3) plus one genuinely-new register-mismatch kind registered as watch W-SATIRE.

Defects by kind:
- entity-name-canonicalisation (MEDIUM, page 2 → PC-7, W-CANON GRADUATION): the headline product is written
  split-token 'Open Claw' (assertions 1, 3, evidence quotes) vs closed-compound 'OpenClaw' (assertion 8 +
  title). Both are plausible spellings of the SAME entity, inconsistent within the page → W-CANON's exact remit
  (NOT PC-2 mishearing; the tokens are correct, just split/joined). This is the 2nd page of the kind (wave #41
  = page 1, 'Claude Co-work Dispatch'/'Cowork') → W-CANON graduates to PC-7. NB 'Open Claw'→OpenClaw already
  seen wave #12 (PC-2 codename garble) → same referent, precedent confirmed. Compounded: OpenClaw is the page's
  headline subject yet carries NO [[wikilink]] anywhere → also a PC-6 zero-link/under-link case for the
  canonical form (link AFTER canonicalisation, so the anchor is [[OpenClaw]] not [[Open Claw]]).
- person↔org-role misattribution (HIGH, page 1 → PC-2 role-holder arm, wave #49 extension): assertion 8 names
  'Sourcegraph CEO Dan Adler'; Sourcegraph's CEO is Quinn Slack. This is NOT an ASR garble OF the real holder —
  it is a wholesale wrong/hallucinated person handed a real authority role, and source-authority:: is marked
  'primary', compounding the false-authority blast. PC-2's wave-#49 role-holder sub-arm ("verify a claimed
  ROLE-HOLDER against the graph's known holder") is the exact home; PC-3 authority cap is the secondary guard.
  Widens the PC-2 GRADUATED-BUT-UNAPPLIED backlog with its highest-severity instance to date.
- provenance-over-grading of non-serious / relayed content (HIGH page 3 + LOW page 2 → PC-3/PC-4, APPLIED,
  under-applied by graders): page 3's Jacobian-conjecture block (fp 98f43e03924234b1) ingests a jokey tweet
  from 'Levante' (references the World Cup final) asserting a 1939 open conjecture is 'false', graded tier:1
  conf:0.9 source-authority:primary volatility:durable — should be tier-3 speculative, volatility speculative.
  Same page: host-relay marked source-authority:primary on 3 blocks (Bessent sanctions 898036985148250e,
  Substack/Pangram 5171a64031361824, the GPT-6/HF breach 8d8ef94476d91f32) where the AI Daily Brief is a
  SECONDARY relay (PC-3's wave-#20 host-relay-as-primary case); and the lead breach claim @0.98 is single-
  sourced to a podcast with no primary OpenAI/HF disclosure. Page 2 assertion 1 restates Huang's promotional
  superlative ('surpassed Linux in GitHub stars in 3 weeks... single most downloaded OSS in history') at
  conf:0.95 — confidence reflecting 'Huang said it', not verification. The APPLIED PC-3 (authority-caps-
  confidence) and PC-4 (volatility) fields SHOULD already catch all of these → this is a calibration/under-
  application signal on applied fields, same framing as W-PREDFACT (wave #47), NOT a new block.
- wrong-node / wrong-sense wikilinks (MEDIUM, PC-1): page 1 assertion 3 (Cognition Devin/tweet view-counts)
  carries [[Face Recognition]] — a real entity but wholly irrelevant (PC-1 sub-case (d) ASR/entity-collision
  mislink); remove, PC-6 floor then anchors [[Cognition]]. Page 2 links two Nvidia corporate-INVESTMENT claims
  ($30bn→OpenAI a3-node, $10bn→Anthropic) to [[NVIDIA H200]] — resolves but wrong conceptual node (a GPU SKU
  for a company-finance fact); PC-1's wave-#32 source↔target-domain guard fires (corporate-finance vs GPU-
  hardware) → retarget to company [[Nvidia]].
- entity/ASR body garbles (MEDIUM/LOW, PC-2 body arm + `[sic]` arm, page 1): 'Cognition's Devon Review'→Devin
  (Cognition's agent); 'Boris Tain' (adjacent to assertion 2's correctly-spelled 'Boris Cherny', already a PC-2
  seed wave #10) reads as a garbled/duplicated first-name or mis-split speaker → `[sic]`, do not guess a
  surname; 'Broadloom's Todd Sonders' (company='Broadloom' is a carpet term; person unverifiable) → `[sic]`
  both, do not mint phantom nodes; 'Jared Sumner'→'Jarred Sumner' (Bun creator, two r's) dictionary seed. The
  parenthetical 'Bun (a company that recently joined Anthropic)' is an unsourced corporate claim embedded in
  the assertion → flag as unsourced rather than assert.
- claim-date — NON-DEFECT / POSITIVE control on ALL 3 pages: every claim-date:: equals its episode-date::
  (page 1 = 2026-03-11, page 2 = 2026-03-07, page 3 = 2026-07-23), NOT ingest-date:: 2026-08-24; episode-date::
  populated → Refinement #1 holds. NO re-dating; all 3 EXCLUDED from the deferred pre-fix re-date sweep.
- dedup/tier — POSITIVE control (page 2): all 10 assertions carry an assertion-fp dedup marker; tiers descend
  sanely (T1 0.85-0.95, T2 0.75-0.85, T3 0.6); ephemeral ARR/investment/GitHub-star figures correctly
  volatility:snapshot, conceptual claims durable — the applied PC-4 field working as intended.
- ASR-in-evidence-only (LOW, page 3, ACCEPTABLE not a defect): pricing block a187624261bddf7d needed transcript
  '750'→$0.75 interpretation (flagged transparently; conf 0.9 marginally high given the ASR ambiguity + the
  extraordinary 12x $9→$0.75 drop); 'GBT6', '35/36 flash' artefacts confined to evidence quotes and normalised
  in the assertion text → PC-2 no-defect (garble did not reach the claim/structured fields).

Top wisdom:
- Empirical review-bottleneck data (page 1): across 10,000+ developers / 1,255 teams, high AI adoption yields
  21% more tasks and 98% more merged PRs but 91% longer PR review time — a durable, sourced quantification of
  where agentic coding shifts the constraint (from writing to reviewing).
- Huang's 'token economy' thesis — AI tokens as the new fundamental unit of work and GDP (page 2, assertion 9,
  volatility:durable) — the one genuinely durable conceptual frame on an otherwise snapshot-heavy news page.
- Guardrails on hosted Western models could not distinguish a legitimate cyber-defender from a bad actor when
  analysing real exploit payloads, forcing an unguarded local GLM 5.2 for forensics (page 3, fp
  9e95006c92382aef) — a durable, non-obvious safety-tooling trade-off; pairs with the generalizable claim that
  advanced models can exploit novel attack paths without source-code access (fp 6d57130605d6e243).
- Also durable: AI inference costs 'start to look closer to labor cost than software cost' (page 1) and the
  SDLC-collapse thesis (agents merge SDLC stages into a continuous intent-context-iteration loop, page 1 — the
  attribution name 'Boris Tain' needs `[sic]`-fixing but the architectural claim stands).

INPUT-ADJUSTMENT PROPOSALS:
1. W-CANON GRADUATES → PC-7 (new block below). Intra-page entity-name canonicalisation: pick ONE canonical
   surface form per entity per page, rewrite all structured fields + the wikilink to it, `[sic]` ungrounded
   proper-nouns. Trigger instance: 'Open Claw'/'OpenClaw' on page 2.
2. PC-2 (GRADUATED-BUT-UNAPPLIED, backlog widened): dictionary/role seeds — 'Dan Adler (Sourcegraph CEO)'→Quinn
   Slack (role-holder arm, HIGH); 'Devon' (Cognition)→'Devin'; 'Jared Sumner'→'Jarred Sumner'. `[sic]`-flag
   'Boris Tain', 'Broadloom'/'Todd Sonders' rather than guess. Normalise in bodies AND source:: fields.
3. PC-1 (APPLIED): remove [[Face Recognition]] from the Cognition claim; retarget the two Nvidia-investment
   claims from [[NVIDIA H200]] to company [[Nvidia]] (source↔target-domain guard). PC-6 floor then anchors
   [[Cognition]] and [[OpenClaw]] (post-canonicalisation) — PC-1 guards retain veto.
4. PC-3/PC-4 (APPLIED) calibration — NOT a new block: graders are UNDER-applying the live source_authority::
   and volatility:: caps to (a) satirical/joke content (page-3 Jacobian tweet at tier-1/primary/durable),
   (b) host-relayed third-party reports marked 'primary' (should be secondary), and (c) first-party
   promotional superlatives at 0.95. Same under-application pattern W-PREDFACT flagged; reinforces that the
   fields exist and the fix is consistent APPLICATION, not new schema.
5. claim-date standing item — POSITIVE control on all 3 pages (claim-date == episode-date ≠ ingest-date;
   episode-date populated). One-line ingest fix unchanged and already APPLIED (Refinement #1): in ingest.py
   `_build_ledger_bullet`, `claim_date = episode_date` (fall back to ingest_date only when episode_date absent).
   Closed for post-fix pages; all 3 are clean references, not sweep candidates.

HIGH-severity: 2, but each folds into an already-graduated PC (page 1 → PC-2 role-holder arm; page 3 →
APPLIED PC-3/PC-4 under-application) → no new PROPOSED-CHANGES block from the HIGH rule. New this wave: PC-7
(W-CANON graduation) and watch W-SATIRE (register-mismatch).

### 2026-08-24 — Review wave #52 (synthesiser)
Pages reviewed (2):
- `podcast-evidence___is-the-debate-over-anthropics-new-product-about-price-or-existential-dread.md` — acceptable
- `podcast-evidence___meet-your-ad-hoc-ai-licensing-regime.md` — good

Defects by kind (merged across both pages):
- asr-entity-names (HIGH page 1 / MEDIUM page 2 — PC-2 recurrence, systemic across BOTH pages): page 1
  garbles land in LOAD-BEARING attribution/structured fields (graph-identity risk, the wave-#3 escalation):
  'Devon Review'->Devin (Cognition's agent, L31), 'Jared Sumner'->Jarred Sumner (Bun's creator, L51),
  'Boris Tain' (SDLC-collapse attribution, L71 — a near-collision distinct from the correctly-spelled Boris
  Cherny; do NOT auto-merge), 'Broadloom's Todd Sonders' (L101, uncorroborable phonetic mangle). Page 2 a
  single clean known-person garble: 'Neil Chilton'->Neil Chilson (R Street / Abundance Institute, L64/68),
  standing out against correctly-named Zvi Mowshowitz / Andrew Curran / Justin Murphy / Will Brown / Sen.
  Mark Warner. ASR spans 2 pages -> reinforces already-APPLIED PC-2; no new block, add names to the dictionary.
- wrong-sense-wikilink (HIGH, page 1 — PC-1 recurrence, sub-case (d) real-page collision): [[Face Recognition]]
  autotagged onto a tweet-metrics claim about Devin-Review vs Claude-Code-Review social view counts — resolves
  (Face Recognition.md exists) but is domain-incompatible with the claim, a spurious autotag. Exactly PC-1's
  domain-incompatibility guard; PC-1 APPLIED -> covered. Compounded: the page's central subject (Claude Code /
  Code Review) carries NO dedicated link while this nonsensical one was added -> also a PC-6 signal (subtract
  the wrong link AND add the precise one).
- unverifiable-novel-proper-nouns (LOW, page 2 — NEW watch W-COINED): near-future model/product names
  unverifiable vs a Jan-2026 KB — GPT-5.6 / 'Terra', 'Mythos', 'GLM 5.2', 'Gemma 4', 'Fable 5'. Properly
  attributed with verbatim evidence (acceptable as SOURCED claims, not defects) but any could itself be an ASR
  mangle and none is corroborable. NB 'Mythos' RECURS (also an earlier wave, ~L1362) — a repeat token.
- transcript-verbatim-hype (MEDIUM page 1 / LOW page 2 — PC-3/PC-4 calibration signal): page 1 vendor
  testimony (Jarred Sumner, whose company 'recently joined Anthropic') carries promo superlatives ('best
  product in the code review category', 'catches extremely subtle bugs and rarely makes mistakes') yet is
  stamped volatility:: durable — overstates a COI-disclosed vendor opinion. Page 2 tier-3 Justin Murphy hype
  confined to the evidence field, correctly tier-3/0.5/speculative -> acceptable. Under-application of applied
  PC-3/PC-4, same bucket as W-PREDFACT; no new class.
- link-coverage-gap (LOW, page 2 — PC-6 recurrence): only 2 of ~15 assertions carry wikilinks; durable
  recurring entities ([[Open Source AI]], compute/data-sovereignty concepts) sit unlinked. PC-6 APPLIED -> covered.
- dating-defect — NON-DEFECT / POSITIVE (BOTH pages): the claim-date==ingest-date defect did NOT manifest on
  either page. Page 1 every claim-date:: is 2026-03-11 (= episode-date); page 2 every claim-date:: is
  2026-06-27 (= episode-date); both distinct from ingest-date 2026-08-24. THIRD and FOURTH post-Refinement#1
  pages seen by the mesh -> the _build_ledger_bullet(episode_date) fix continues to hold end-to-end. No re-dating.
- tier/confidence — NON-DEFECT (page 1): tier 1->3, confidence 0.98->0.65 descend monotonically; all 10
  assertions carry unique assertion-fp dedup markers (no collisions). Structurally sound.

Top wisdom:
- SDLC-collapse thesis (page 1, L71, durable): AI agents didn't SPEED UP the software-development lifecycle,
  they COLLAPSED its discrete stages into a continuous intent-context-iteration loop (verify attributed name).
- Inference-cost-as-labour-cost (page 1, L91, durable): as agentic engineering scales, AI inference cost
  starts to resemble LABOUR cost rather than SOFTWARE cost, making previously ignorable cost profiles material.
- Harness/UX/integration — not raw model capability — increasingly sets AI value (page 2, durable), reinforced
  by Anthropic's claim that 65% of its code now originates from Slack-described requirements (tier 2, L111).
- Ad-hoc licensing slows model RELEASE but not model TRAINING, so the public-vs-internal-lab capability gap
  widens steadily (page 2, Andrew Curran, tier 2, L91). Durable structural consequence.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — VERIFIED again on 2 more post-fix pages (3rd + 4th correctly episode-dated).
   The fix is already live (Refinement #1: episode_date threaded into _build_ledger_bullet) and this wave's
   evidence CONFIRMS it works, so no code change is owed — no `_build_ledger_bullet` edit needed. Standing item
   stays closed for post-fix pages; the deferred batch re-date still owes only the pre-fix backlog (waves #1/#2).
2. PC-2 reinforced on 2 pages — page 1 (HIGH) puts ASR names in load-bearing attribution/structured fields.
   Add to the PC-2 known-people/product normalisation dictionary: Devin (Cognition), Jarred Sumner (Bun),
   Neil Chilson (R Street / Abundance Institute); `[sic]`-flag the uncorroborable ones (Boris Tain, Broadloom /
   Todd Sonders) per PC-2's over-merge guard rather than guess — and do NOT collapse 'Boris Tain' into 'Boris
   Cherny' (a near-collision, not a confirmed variant).
3. NEW watch W-COINED (below) — an explicit verification-pending marker for single-source, novel/coined proper
   nouns that resolve to no known entity and cannot be corroborated (page 2's Terra / Mythos / GLM 5.2 / Fable 5).
4. PC-3/PC-4 calibration — route COI-disclosed vendor/promotional testimony to source_authority:: single-source
   (or a `vendor` grade) and stop stamping marketing opinion volatility:: durable. Same under-application bucket
   as W-PREDFACT; no new block, a grader-calibration nudge on the applied PC-3/PC-4 fields.

Both HIGH defects this wave (page 1 structured-field ASR; page 1 wrong-sense link) fold into already-APPLIED
classes (PC-2, PC-1) -> no new PROPOSED-CHANGES block from the HIGH-on-2+ rule. New this wave: watch W-COINED.

### 2026-08-24 — Review wave #53 (synthesiser)
Pages reviewed (2):
- `podcast-evidence___meta-delays-new-ai-model.md` — acceptable
- `podcast-evidence___microsoft-changing-ai-targets.md` — good

Defects by kind (merged across both pages):
- asr-entity-names (MEDIUM both pages — PC-2 recurrence, systemic across BOTH pages): page 1
  'Michael Truelove'->Michael Truell (Cursor CEO, L71-74) — lands in a LOAD-BEARING attribution slot
  (the assertion text AND its `source::` field), the graph-identity risk class, though NOT wikilinked
  so no phantom entity page yet. Page 2 'NADN'->n8n (workflow-automation tool, L111/118) — worse
  placement than a quote garble: it contaminates the ASSERTION BODY itself (L111), not just the
  verbatim evidence, degrading a durable workflow-builder-UX claim; plus 'ChatGBT'->ChatGPT (L78)
  confined to the evidence quote (assertion text L71 already correct -> cosmetic-only). ASR spans 2
  pages -> reinforces already-APPLIED PC-2; no new block, add names to the dictionary.
- evidence-support-gap (MEDIUM, page 1 — PC-5 recurrence): the xAI-hires assertion (L21) claims Milich
  and Ginsburg are 'former heads of product for engineering at Cursor', but the cited evidence quote
  (L28) only establishes they joined xAI reporting to Musk — the Cursor-role provenance is asserted
  beyond what the quote backs. Exactly PC-5's claim-asserts-more-than-evidence case; PC-5 APPLIED ->
  covered (soften the claim to match the quote, or extend the quote to include the Cursor-role segment).
- unverified-acquisition-target (LOW, page 2 — light W-COINED touch, but likelier a PC-2 shortening):
  the OpenAI acquisition target named bare 'Neptune' (AI-training monitoring/debugging tools, L91) is
  ambiguous — probably Neptune.ai, but the token could be an ASR shortening of a real product rather
  than a novel coinage. Confidence appropriately lowered to 0.9. Borderline W-COINED (single-source,
  uncorroborated) yet it resolves toward a KNOWN entity, so it sits closer to PC-2/verification than to
  W-COINED's genuinely-novel-name bucket -> NOT counted as W-COINED's graduating 2nd page; source-check
  before promoting, [[Neptune.ai]] once confirmed.
- link-coverage-gap (LOW, page 2 — PC-6 recurrence): only [[AI Infrastructure]] is linked across an
  otherwise rich ledger; durable resolvable entities (n8n, Rufus, Azure AI Foundry) sit unlinked.
  PC-6 APPLIED -> covered (anchor the CANONICAL form once PC-2 fixes 'NADN'->n8n first).
- dating-defect — NON-DEFECT / POSITIVE (page 1): the claim-date==ingest-date defect did NOT manifest.
  episode-date:: 2026-03-16 present and every claim-date:: equals it, distinct from ingest-date
  2026-08-24. FIFTH post-Refinement#1 page seen by the mesh -> the _build_ledger_bullet(episode_date)
  fix continues to hold end-to-end. The reviewer explicitly nominates this page as a POSITIVE-CONTROL
  FIXTURE for the standing item (expected-output when validating the re-date on pre-fix backlog).
- evidence-verbatim (NON-DEFECT, page 1): every evidence:: is a raw 'The transcript states, ...' quote,
  but the assertion bodies are cleanly paraphrased and specific -> appropriate grounding, not verbatim
  hype leaking into claims. Noted for completeness.

Top wisdom:
- Adoption breadth-vs-depth gap (page 1, durable, data-backed): an AMA survey shows 81% of doctors now
  use AI (>2x since 2023) yet only 17% use it for assistive diagnosis — the one use case near actual
  medical practice. The page's most valuable non-ephemeral, sourced insight.
- Jensen Huang (page 2, tier 2, primary via Rogan, fp 306baded, durable): the AI race has no definitive
  finish line — the end state is AI fading into the background as infrastructure, not a superpower
  claiming dominance. The most re-usable framing on either page.
- Market-psychology heuristic (page 2, host, fp 4939d, durable): company-specific execution problems are
  not a macro demand slowdown; jittery investors over-weight small narrative shifts as signals.
- Altman structural argument (page 1, tier 3 speculative, durable): AI is disrupting the labour/capital
  balance that keeps society functioning, requiring rapid adjustment to a new abundance paradigm.
- Workflow-builder adoption (page 2, host, fp dc6a417, durable — tarnished by the 'NADN' garble):
  n8n-class automations deliver real value to power users but UX hurdles block the average enterprise buyer.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — VERIFIED again on 1 more post-fix page (5th correctly episode-dated; page 1
   is a clean positive control, every claim-date:: == episode-date 2026-03-16 != ingest 2026-08-24). The
   fix is already live (Refinement #1: episode_date threaded into `_build_ledger_bullet`) and this wave
   CONFIRMS it, so no code change is owed — no `_build_ledger_bullet` edit needed. For reference the live
   one-liner is the bullet's `claim-date:: {episode_date}` (was `{ingest_date}`). ADOPT the reviewer's
   suggestion: register `meta-delays-new-ai-model` as the expected-output FIXTURE when validating the
   deferred pre-fix backlog re-date (waves #1/#2).
2. PC-2 reinforced on 2 pages — both carry ASR name/entity garbles, page 1's in a load-bearing
   assertion+`source::` attribution slot, page 2's inside the ASSERTION BODY (not just a quote). Add to
   the PC-2 known-people/product normalisation dictionary: Michael Truell (Cursor CEO), n8n (was 'NADN'),
   ChatGPT (evidence-quote form 'ChatGBT'). Consider an ASR-name-normalisation pass keyed to known
   AI-industry figures/products run BEFORE ingest — page 1's 'Truelove' and page 2's 'NADN' would both be
   caught by a canonical-entity lexicon lookup on the assertion+source fields.
3. PC-5 reinforced on 1 page — page 1 xAI-hires claim over-asserts a Cursor role its evidence quote does
   not carry. Under-application of applied PC-5; no new block, a grader nudge to enforce claim<=evidence
   scope on attributed-role tokens (soften the claim OR extend the quote to cover the provenance).
4. W-COINED NOT graduated this wave — page 2's 'Neptune' is a single-source uncorroborated proper noun
   (a W-COINED-adjacent signal) but resolves toward a KNOWN entity (Neptune.ai), so it reads as a PC-2
   shortening pending source-check rather than a novel coinage. Left as a verification-pending marker, not
   counted as W-COINED's 2nd graduating page.

No HIGH-severity defect on either page this wave (all MEDIUM/LOW) -> the HIGH-on-2+ rule does not fire;
no new PROPOSED-CHANGES block. Every defect folds into already-APPLIED classes (PC-2, PC-5, PC-6). No new
watch registered.

### 2026-08-24 — Review wave #54 (synthesiser)
Pages reviewed (2):
- `podcast-evidence___how-the-best-companies-use-ai.md` — good
- `podcast-evidence___microsofts-plan-to-make-people-less-angry-about-ai-and-electricity.md` — acceptable

Defects by kind (merged across both pages):
- asr-entity-names (page 2 HIGH; page 1 present-but-ungraded — PC-2 recurrence, systemic): page 2
  carries mangled proper nouns in LOAD-BEARING assertion text AND `source::` fields (graph-identity
  class): 'Chimath Palahapatia'->Chamath Palihapitiya (blocks 6/9), 'Cerebrus'->Cerebras (the
  chipmaker, block 5), 'Ray Gojan'->garbled analyst name (block 7, verify/`[sic]`). Page 1 has the
  same failure mode in a refinement note only: 'Seb Go to Jen'->an unidentified Ramp employee across
  4 assertions (page verdict still 'good', so NOT severity-graded). PC-2 APPLIED -> covered; no new
  block. NB the HIGH-on-2+ rule does NOT fire: HIGH severity lands on ONE page (page 2); page 1's ASR
  is ungraded. Dictionary seeds below.
- semantic-wikilink-mismatch (MEDIUM, page 2 — PC-1 recurrence, resolvable-but-wrong-sense arm): block 4
  (OpenAI acquiring health-tech startup 'Torch' for ~$100M) links [[PyTorch]] — Meta's ML framework,
  entirely unrelated to a health startup named Torch: a cross-domain ASR/entity-COLLISION mislink,
  exactly PC-1 sub-case (d). Same block links [[OpenAI API]] (the PRODUCT page) for a corporate M&A
  event that should point at the OpenAI ORGANISATION node — a product-vs-organisation sense error, a
  facet of PC-1's wrong-sense filter (the source↔target-domain guard should catch an M&A event edging
  to an API product). File-existence passes but both edges are misinformation. PC-1 APPLIED -> covered
  (drop [[PyTorch]]; retarget [[OpenAI API]]->OpenAI org; add [[Torch]] entity once corroborated).
- missing-entity-links (LOW, page 2 — PC-6 recurrence): Cerebras (block 5, links only [[Venture
  Capital]]) and the two named analysts (Chamath, Ray Gojan) carry no entity wikilinks; newsworthy
  resolvable entities left orphaned, weakening connectivity. PC-6 APPLIED -> covered (anchor the
  CANONICAL forms once PC-2 fixes the garbles first — PC-2 before PC-6/PC-1 per the ordering).
- link-enrichment (LOW, page 1 — PC-6-adjacent, non-defect nudge): a 'good' page relying on generic
  umbrella tags; reviewer suggests one specific concept wikilink per assertion (e.g. [[EBITDA]],
  [[Agentic Engineering]], [[Build vs Buy]]) to lift retrieval precision. Folds into PC-6's
  highest-precision-anchor discipline; no new item.
- dating-defect — NON-DEFECT / POSITIVE (BOTH pages): the claim-date==ingest-date defect did NOT
  manifest on either page. Page 2 every claim-date:: == episode-date:: 2026-01-16 != ingest-date
  2026-08-24; page 1 explicitly cited by the reviewer as a REFERENCE EXAMPLE of the desired end state
  (claim-date correctly at episode-date, no re-dating owed). SIXTH/SEVENTH post-Refinement#1 pages seen
  by the mesh -> the _build_ledger_bullet(episode_date) fix continues to hold end-to-end.
- ledger-hygiene (NON-DEFECT, page 1): tier/confidence gradient sane and monotonic (T1 0.90-0.95,
  T2 0.85, T3 0.60-0.65); assertion-fp dedup markers present on all 14 assertions. Noted for completeness.

Top wisdom:
- George Zarkadakis (page 1, fp 322dbf26, durable — highest-value assertion on the page): AI has made
  individuals ~10x more productive yet no company has become 10x more valuable, because institutional AI
  requires distinct coordination/signal-extraction processes that individual AI lacks. Durable structural
  insight on why productivity gains don't compound to firm value.
- Ramp design principle (page 1, fp 0a4e66b4, durable): do not simplify tools to cap anyone's upside —
  'make complexity invisible while preserving full capability' rather than dumbing down for non-technical
  users. Transferable design heuristic.
- McKinsey org-strategy (page 1, fp 83e3df82, durable): >70% of AI-transformation talent should be
  in-house because every tech/AI transformation is ultimately a people transformation that can't be
  outsourced to consultants.
- Microsoft five-pillar 'community-first AI infrastructure' model (page 2, durable, named framework):
  utility rates that don't raise local prices, water replenishment, local jobs, tax base, local AI
  training/nonprofits — a durable model for data-centre social licence, not an ephemeral news beat.
- Chamath + host strategic insight (page 2, durable — most transferable on the page): the political fight
  over AI's electricity-cost contribution is a losing argument; community pushback is really the
  perception that big tech isn't paying its way, so hyperscalers should zero out local residents'
  electricity cost to buy goodwill (a negligible fraction of data-centre capex).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — VERIFIED again on 2 more post-fix pages (page 2 a clean positive control,
   every claim-date:: == episode-date 2026-01-16 != ingest 2026-08-24; page 1 nominated by the reviewer as
   a reference example of the desired end state). The fix is already live (Refinement #1: episode_date
   threaded into `_build_ledger_bullet`, one-liner `claim-date:: {episode_date}` was `{ingest_date}`) and
   this wave CONFIRMS it — no `_build_ledger_bullet` edit owed.
2. PC-2 reinforced on 2 pages. Add to the known-people/product normalisation dictionary: Chamath
   Palihapitiya (was 'Chimath Palahapatia'), Cerebras (was 'Cerebrus'), and — pending source-check —
   Ray Gojan (garbled analyst, `[sic]`-flag until identified) and the Ramp employee behind page 1's
   'Seb Go to Jen'. A canonical-entity lexicon lookup on assertion+source fields BEFORE ingest would catch
   all four. Consider a light `[sic]`/normalised-name note where an evidence QUOTE preserves the ASR error
   (e.g. 'Bijing') so the transcript spelling doesn't leak into search.
3. PC-1 reinforced on 1 page (page 2 block 4). Two facets to fold into the applied wrong-sense filter:
   (a) the cross-domain ASR collision [[PyTorch]]<-'Torch' (health startup) — the source↔target-domain
   guard should reject an ML-framework target on a health-M&A source; (b) product-vs-organisation sense —
   a corporate M&A event linking [[OpenAI API]] (product) where the OpenAI organisation node is intended.
   Both are covered by PC-1's wrong-sense/domain guards; a grader nudge to prefer the ORGANISATION node
   over a same-brand PRODUCT page for corporate/M&A events is the only new calibration, not a new block.
4. PC-6 reinforced on both pages (page 2 orphaned Cerebras/analysts; page 1 generic-tag reliance). Under-
   application of the applied link-coverage floor; a grader nudge to emit one highest-precision anchor per
   assertion where a resolvable entity is named, run AFTER PC-2 canonicalises the garbles.

No HIGH-severity defect on 2+ pages this wave (HIGH lands on page 2 only; page 1's ASR is ungraded) -> the
HIGH-on-2+ rule does not fire; no new PROPOSED-CHANGES block. Every defect folds into already-APPLIED classes
(PC-1, PC-2, PC-6). No new watch registered.

### 2026-08-24 — Review wave #55 (synthesiser)
Pages reviewed (8):
- `podcast-evidence___autoresearch-agent-loops-and-the-future-of-work.md` — good
- `podcast-evidence___beating-the-ai-doom-cycle.md` — acceptable
- `podcast-evidence___bezos-is-back-to-build-ai.md` — acceptable
- `podcast-evidence___black-friday-gpt.md` — acceptable
- `podcast-evidence___can-open-models-solve-corporate-ai-washing.md` — good
- `podcast-evidence___can-todays-ai-replace-12-of-work.md` — acceptable
- `podcast-evidence___ceo-led-ai-gets-3x-the-roi.md` — acceptable
- `podcast-evidence___chatgpt-55-rumors-start-to-bubble.md` — acceptable

STRUCTURAL OUTCOME: **W-CASE GRADUATES on its pre-registered 2nd page → written up as PC-8 below** (LOW-severity
watch-graduation, matching the PC-4/PC-5/PC-6/PC-7 discipline — NOT the HIGH-on-2+ rule). Two HIGH findings this
wave (PC-2 on page 3, PC-1 on page 7) are DIFFERENT kinds on DIFFERENT single pages, so the HIGH-on-2+ rule does
not fire; both fold into already-APPLIED classes.

Defects by kind (merged across the 8 pages):
- claim-date == ingest-date — DEFECT PRESENT on 2 pages (pages 1 + 2, MEDIUM): the ONLY 2 pages this wave that
  show the standing defect. Page 1 all 11 claims claim-date:: 2026-08-24 == ingest, episode-date:: 2026-03-10
  present; page 2 all 13 claims 2026-08-24 == ingest, episode-date:: 2026-05-26 present. Both fully re-datable
  (episode-date recorded, no per-claim dates). Pages 3-8 are all clean POSITIVE CONTROLS (claim-date == their
  episode-date 2025-11-20 / 2025-11-27 / 2026-08-05 / 2025-12-05 / 2026-06-25 / 2026-01-15, != ingest). This is
  the pre-fix BACKLOG surfacing, not a regression of Refinement #1: pages 1-2 are pre-Refinement#1 ingests
  (episodes Mar+May 2026 dated at ingest); pages 3-8 date correctly. → these 2 pages join the DEFERRED re-date
  batch (target = their episode-date). No `_build_ledger_bullet` edit owed — the live fix holds on all 6 post-fix
  pages.
- notable stratification (mesh observation): pages 3-8 date CORRECTLY yet ALL carry PC-1 generic/wrong-sense
  mislinks (see below). Consistent with these pages being post-dating-fix but pre-PC-1-gate ingests (Refinement
  #1 landed ~05:15, the PC-1 gate ~09:45). Confirms both cut-overs and that the DEFERRED backlog job must
  re-LINK (not just re-date) pages 3-8. The applied PC-1 gate covers future episodes.
- semantic wikilink mislinks (PC-1, recurrence on 6 of 8 pages — HIGH on page 7, MEDIUM elsewhere): the
  resolvable-but-wrong-sense / generic-noun / bare-acronym arm the applied PC-1 gate targets. Page 7 (HIGH):
  [[Tor]] on a Micron memory claim, [[Neuroimaging]] on BOTH the KPMG-survey and CEO-ROI claims, [[URI]], [[GAN]]
  — 4 false cross-domain edges. Page 2: [[Base]] [[Model]] [[REST]] [[Curve]] [[Logic]] [[UMA]] [[API]] (capitalised-
  noun/acronym stubs). Page 3: [[URI]] [[Privacy Engineering]] [[Raft]] [[GAN]] (dup within one block) [[AI Upscaling
  and Super-Resolution]]; plus two sense-collisions — generic [[Prometheus]] where 'Project Prometheus' (Bezos
  startup) is meant, generic [[Safe]] where Safe Superintelligence is meant. Page 4: [[Rsa]] [[Tor]] [[REST]]
  [[performance]] [[Dynamics]] [[Process]]. Page 6: [[Ansi]] [[Solid]] [[Model]] [[Metrics]]. Page 8: [[GAN]] on
  Anthropic Labs, [[OpenAI API]] reused ~5x for company/model/hardware claims where the OpenAI ORGANISATION node
  is meant (product-vs-org sense error, same facet as wave #54), duplicate [[Model]] on one line. PC-1 covers all;
  the bare-acronym stop-list (Tor/URI/GAN/REST/RSA/UMA/ANSI/Neuroimaging) + the generic-noun refusal +
  source↔target-domain guard already catch these. No new block — this is the pre-gate backlog PC-1 exists to fix.
- ASR entity garbles in LOAD-BEARING assertion/source text (PC-2 — HIGH on page 3, MEDIUM on pages 7+8): page 3
  (HIGH, graph-identity class) 'Vic Bajage'->Vik Bajaj and 'Ethan Malik'->Ethan Mollick BOTH in assertion text AND
  source:: fields, plus 'Mirror Morati'->Mira Murati and 'Ilia Sutskaver'->Ilya Sutskever in evidence. Page 7
  (MEDIUM) source:: 'Mark Andreessen Horowitz' conflates the person Marc Andreessen with the firm Andreessen
  Horowitz (a16z); 'Claude Tag' suspected product mangling. Page 8 (MEDIUM) the hardware codename 'Sweet Pee' has
  LEAKED UP from evidence into the assertion text itself (a mangled token now at the claim layer). PC-2 covers all;
  dictionary seeds below. HIGH lands on ONE page (3) only → HIGH-on-2+ does not fire.
- claim-body temporal mis-inference (page 1, MEDIUM — NEW kind → watch W-YEARINFER): two tier-1 claims assert the
  Karpathy 'auto research' repo and Boris Cherny's /loop shipped 'March 7, 2025', but episode-date is 2026-03-10
  and the evidence quotes contain NO year — '2025' was hallucinated during extraction (one year off, contradicting
  episode-date + reality). Distinct from PC-5 (claim-vs-own-evidence divergence): here the evidence has no figure
  to match, so the fix is anchor-to-episode-date, not match-the-quote. First occurrence → opened as W-YEARINFER
  (below); graduates on a 2nd page.
- claim states figure absent from its evidence (page 6, LOW — PC-5 recurrence): assertion 3 asserts "Anthropic's
  internal survey of 132 engineers" but the attached evidence quote never mentions 132; the 60%/50% figures ARE
  quoted correctly. PC-5 covers (ground the sample size or drop the specificity).
- unwarranted confidence on single-source numeric (page 7, MEDIUM — PC-3 calibration): Micron '445% YoY revenue',
  '86% gross margin' carried at tier-1 / conf 0.98 off a single-source earnings paraphrase; figures read as
  transcript hype. source_authority:: (PC-3) must cap confidence below the tier-1 floor for lone-source figures —
  same under-application pattern as W-PREDFACT (wave #47). Covered by applied PC-3; grader-calibration nudge.
- weak tier-1 sourcing (page 3, LOW — PC-3): headcount/poaching facts sourced only to 'Podcast Host / Industry
  Sources' yet carried at 0.85. Covered by PC-3's provenance cap.
- ephemeral-verbatim colour elevated to evidence (page 3, LOW — PC-4/W-DECAY): a comment-section quip ('Mary G
  comments, Bezos couldnt even make it 3 years...') used as evidence for a tier-3 signal. Correctly quarantined at
  tier-3; PC-4 volatility:: speculative covers it. No new item.
- non-canonical-casing wikilinks (2 pages → GRADUATES W-CASE → PC-8): page 5 [[Enterprise Ai]] (the IDENTICAL
  variant wave #44 opened W-CASE on) vs canonical [[Enterprise AI]]; page 6 [[VERIFICATION]] (all-caps) vs canonical
  [[Verification]]. Both RESOLVE (PC-1 does not fire) but fragment the concept from its canonical node. Page 5 is
  W-CASE's pre-registered 2nd page; page 6 reinforces (all-caps-word sub-case). → PC-8 below.
- entity-fragmentation adjunct (page 5, LOW — PC-7/W-CASE-adjacent): reviewer flags whether [[Enterprise AI]] should
  merge with [[Enterprise AI Adoption]]. Folds into PC-7 (canonical-form selection) once casing is normalised; no
  new item.
- ASR typos inside verbatim EVIDENCE quotes (NON-DEFECT, pages 1/2/4/6/8): 'Andre'(->Andrej) on page 1, 'enlightened
  excitment'/'doomed desperation' page 2, 'GPT5'/'Poly Market'/'Google Tpus' page 4, 'cloud code'(->Claude Code)/
  'snip check' page 6, 'Sam Alman'/'DeepSseek' page 8 — all confined to verbatim quotes, assertion/entity names
  clean. Faithful transcription; acceptable. (Page 8's 'Sweet Pee' is the exception — it escaped INTO the claim,
  graded under PC-2 above.)
- unverified/possibly-ASR proper names (page 2, LOW — W-COINED-adjacent): 'Gloria Cordfield', 'Alex Emos' —
  uncorroborated, plausibly ASR-mangled; flag for verification before any promotion to standalone entity pages
  (do not enshrine a mangled spelling). Single page; W-COINED/PC-2 territory, no graduation.
- ledger hygiene (NON-DEFECT, multiple pages): assertion-fp dedup markers present + unique (pages 3, 8 verified);
  tier/confidence gradients sane and monotonic (page 8 T1 0.85-0.95 / T2 0.75-0.85 / T3 0.55-0.60; page 3 T1
  0.8-0.95 / T2 0.7-0.8 / T3 0.55-0.6). Noted for completeness.

Top wisdom:
- Agent-loop 'work-primitive' framework (page 1, durable — highest-value, generalises far beyond the news): an
  agentic loop becomes a viable work primitive only when THREE conditions hold — an objective score, fast/cheap
  iterations, and low cost for failed attempts. Paired role-shift insight: the human's job moves from writing code
  to 'arena design' — writing the strategy memo (program.md) and building the objective evaluator.
- Ralph Wiggum engineering pattern (page 1, durable): deliberately kill the agent before context exhaustion and
  externalise memory into files + Git history rather than the context window.
- Alex Emos 'What Will Be Scarce' thesis (page 2, durable — most non-ephemeral on the page): as automation drives
  cost down in commoditised sectors, the 'relational sector' — where human provenance is itself part of economic
  value — rises proportionally. Companion structural model: compute/electricity/memory scarcity is the real driver
  forcing the industry off subsidised flat-rate pricing onto market-based token pricing.
- Physical-wiring value thesis (page 3, durable — gives the Bezos episode its lasting relevance beyond the funding
  headline): the next wave of AI value accrues to whoever wires models into physical systems and the real economy,
  not to further digital-model capability gains. Plus Ethan Mollick's alignment datapoint: Grok 4.1 reduces harmful
  responses while simultaneously INCREASING sycophancy and deception — a concrete safety/agreeableness RLHF trade-off.
- Narrow-RL-beats-general framing (page 4, durable): OpenAI RL-trained a specialised GPT-5 Mini for shopping
  research that beat full-size GPT-5 Thinking on internal product-accuracy benchmarks — transferable insight about
  scoped RL-tuned small models outperforming larger general ones. Plus HP CEO Enrique Lores: ground-up agentic
  process REDESIGN yields far larger gains than bolting AI onto existing workflows.
- Karp AI-sovereignty + AI-washing diagnostics (page 5, durable): enterprises increasingly demand maximal control
  over data/prompts/BI to avoid handing labs 'the keys to their institutions'; and 'AI washing' = claiming to do
  more with AI than you are, with layoffs often really freeing cash to spend on AI.
- Skill-overlap ≠ job-loss (page 6, durable guard against the standard misread): the MIT Project Iceberg index
  measures technical-skill overlap with AI and explicitly does NOT estimate job loss / adoption timelines; an 11.7%
  skill-automation figure is not 11.7% job loss because roles are bundles of skills that reallocate.
- CEO-accountability ROI datapoint (page 7, durable governance insight + namesake): CEO accountability for AI
  strategy correlates with ~3x higher odds of established AI ROI (14% vs 4%); plus the exec-optimism-vs-workforce-
  readiness gap (US employee resistance to AI agents rose 5%->20%).
- Frontier-lab reprioritisation signal (page 8, durable): OpenAI declared a 'code red' pausing ancillary
  feature/product work to concentrate on core ChatGPT models — how a lab reallocates under competitive pressure.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — the live fix (Refinement #1: `claim-date:: {episode_date}` threaded into
   `_build_ledger_bullet`, was `{ingest_date}`) HOLDS on all 6 post-fix pages (3-8, clean positive controls). No
   `_build_ledger_bullet` edit owed. ACTION: add pages 1 (`autoresearch-agent-loops...`, target 2026-03-10) and 2
   (`beating-the-ai-doom-cycle`, target 2026-05-26) to the DEFERRED re-date backlog — they are pre-fix ingests, not
   a regression. Both re-datable (episode-date present).
2. DEFERRED backlog must re-LINK as well as re-date pages 3-8: they date correctly but predate the PC-1 gate and
   carry the full spread of generic/acronym/wrong-sense mislinks the applied gate now blocks. Run the applied PC-1
   resolver over the backlog, not just future episodes.
3. PC-2 reinforced on 3 pages (load-bearing text). Dictionary seeds: Vik Bajaj (was 'Vic Bajage'), Ethan Mollick
   (was 'Ethan Malik' — fix assertion AND source::), Mira Murati (was 'Mirror Morati'), Ilya Sutskever (was 'Ilia
   Sutskaver'); Marc Andreessen / Andreessen Horowitz (a16z) (was the conflated 'Mark Andreessen Horowitz' in
   source::); and — pending source-check — 'Claude Tag' (page 7 product) and the 'Sweet Pee' hardware codename
   (page 8, `[sic]`/uncertain-flag so a mangled token does not become a canonical codename). A canonical-entity
   lexicon lookup on assertion + source:: fields BEFORE ingest catches these.
4. PC-1 reinforced on 6 pages — extend the applied stop-list with the acronyms/generic nouns seen this wave
   (Tor, URI, GAN, REST, RSA, UMA, ANSI, Neuroimaging, Base, Curve, Logic, Solid, Process, Dynamics) and reinforce
   two facets already inside the gate: (a) retarget same-brand PRODUCT pages to the ORGANISATION node for corporate
   events ([[OpenAI API]]->OpenAI org, page 8); (b) prefer a specific project/entity page over a generic same-name
   stub ([[Prometheus]]->Project Prometheus, [[Safe]]->Safe Superintelligence, page 3 — create the entity if absent
   rather than link the generic stub).
5. PC-3 calibration nudge (page 7 Micron 0.98, page 3 host-relayed 0.85): source_authority:: must cap confidence
   for single-source/host-relayed figures below the tier-1 floor — same under-application W-PREDFACT flagged. No
   new block; grader nudge on the applied field.

No new PROPOSED-CHANGES block from the HIGH-on-2+ rule (the two HIGH findings are different kinds on different
single pages). One block DOES open this wave via watch-graduation: **W-CASE → PC-8**. One new watch registered:
**W-YEARINFER**. All other defects fold into already-APPLIED classes (PC-1, PC-2, PC-3, PC-4, PC-5).

### 2026-08-24 — Review wave #56 (synthesiser)
Pages reviewed (3):
- `podcast-evidence___moltbook-the-agent-social-nework-is-the-craziest-ai-phenomena-yet.md` — acceptable
- `podcast-evidence___more-ai-datacenter-community-commitments.md` — acceptable
- `podcast-evidence___more-new-ai-models-openai-drops-51-pro-and-codex-pro.md` — acceptable

STRUCTURAL OUTCOME: No HIGH-on-2+ systemic defect (all findings MEDIUM/LOW). One NEW kind on page 3 →
registered as watch **W-DISAMBIG** (annotator-inserted bracketed disambiguation guess). All other defects fold
into already-tracked classes (PC-2 applied; PC-3/PC-4 applied; PC-6 awaiting team-lead). claim-date standing
item: **defect NOT present on any of the 3 pages — all three are clean positive controls**, so no
`_build_ledger_bullet` edit owed and none join the re-date backlog.

Defects by kind (merged across the 3 pages):
- claim-date == ingest-date — DEFECT ABSENT on all 3 (positive controls, MEDIUM class not triggered): page 1
  episode-date:: 2026-01-31 present, all 12 claim-date:: == 2026-01-31 (!= ingest 2026-08-24); page 2 claim-date
  == episode-date 2026-01-24; page 3 claim-date == episode-date 2025-11-21. The live Refinement #1 fix holds on
  all three. No re-dating needed on this wave.
- ASR garble in LOAD-BEARING assertion/entity text (PC-2, recurrence on 2 pages, MEDIUM both → HIGH-on-2+ does
  NOT fire): page 1 (graph-identity class) 'Rocco'/'Rocco's Basilisk' in the L111 CLEANED assertion body AND the
  derived entity name → Roko / 'Roko's Basilisk' (the well-known thought experiment); the garble sits in a
  graph-linked entity, not just the verbatim quote, so it will pollute the entity graph. Page 3 (structured +
  body fields) 'Ethan Malik'->Ethan Mollick (source:: field), 'Meters'/'Meters Benchmark'->METR (Model
  Evaluation & Threat Research), 'SweetBench Verified'->SWE-bench Verified (assertion 4 body), 'Matt Schumer'->
  Matt Shumer (HyperWrite). Applied PC-2 covers all; dictionary seeds below. Both MEDIUM → folds into PC-2, no
  new block.
- zero-wikilink orphaned ledger (page 2, MEDIUM — PC-6, awaiting team-lead): page contains ZERO [[wikilinks]]
  though its 3 assertions name entities with existing canonical pages (PJM Interconnection, OpenAI Research
  Organisation, Data Centers, plus a Stargate/White House node). Fully orphaned/unreachable from entity nodes —
  the textbook PC-6 link-coverage-floor case (assertions emit zero links while naming resolvable entities).
  Reinforces PC-6 (still in PROPOSED CHANGES, not yet applied). Page 1's substrate-independence claim (L111,
  tier-3 speculative) is a milder PC-6 instance — a linkable philosophy-of-mind concept carrying no wikilink;
  PC-6's floor is best-effort so a hedged tier-3 claim may legitimately stay orphaned, but it clears the resolver.
- unverified / possibly-misattributed entities (page 1, MEDIUM — W-COINED/PC-2 verification arm): 'Matt Schlitz'
  as Moltbook creator (uncorroborated beyond transcript, ASR-shaped) and Dario Amodei's essay titled 'The
  Adolescence of Technology' — Amodei's known public essay is 'Machines of Loving Grace', so this is likely a
  mishearing/misattribution. Flag for verification (do NOT canonise as source-authority:: primary) before either
  becomes a standalone entity/attribution. Same discipline as wave #55's 'Gloria Cordfield'/'Alex Emos'.
- annotator-inserted contradictory disambiguation (page 3, MEDIUM — NEW kind → watch W-DISAMBIG): the annotator
  added bracketed guesses '[GPT-4o]' for the transcript tokens '03' (assertion 5) and '01' (assertion 8), mapping
  BOTH to GPT-4o — but 'o1'/'o3' are OpenAI REASONING models, not GPT-4o, so the disambiguation is internally
  contradictory and likely wrong. Assertion 8's own evidence note candidly flags '01 is likely a transcription
  error' yet still asserts [GPT-4o], risking a factual error being canonised. Distinct from PC-2 (ASR mishearing
  of a token — here the annotator INVENTS an expansion) and PC-5 (claim-vs-own-evidence — here the evidence note
  actively CONTRADICTS the inserted guess). First occurrence → W-DISAMBIG below; graduates on a 2nd page.
- generous source-authority / flat confidence (page 2, LOW — PC-3/PC-4, applied): assertion #1 tags a corporate
  PR/blog pledge ('we commit to paying our own way on energy') as source-authority:: primary / volatility::
  durable at conf 0.95 — defensible as OpenAI's own statement but it is a forward-looking PROMISE, not a verified
  fact; 0.95 overstates a pledge. All three assertions sit at identical tier-1/0.95 across a forecast (PJM), a
  political intent (White House emergency auction), and a PR pledge — flat calibration. Covered by applied
  PC-3 (authority cap) + PC-4 (the auction-intent is correctly volatility:: snapshot); grader-calibration nudge.
- verbatim ASR in EVIDENCE quotes (NON-DEFECT, pages 1 + 3): page 1 'Maltbook' (L38,128) / 'malt token' (L98)
  for Moltbook / Molt Token; page 3 'Codeex weekly', 'sweet bench', 'Claw 3 sonnet', 'bodess well'. All confined
  to verbatim transcript quotes with assertion bodies cleaned — faithful transcription, acceptable. Noted only
  that the source ASR was noisy.
- retained transcript hype (page 3, LOW — PC-4, contained): assertions 6 + 11 carry reviewer hype ('an absolute
  monster', 'better reasoner than most humans', problems 'people thought were out of bounds'). Correctly tiered
  (tier 2/3, single-source, snapshot/speculative) and attributed to named reviewers → risk contained; ephemeral
  opinion, not durable knowledge. No new item.
- title/filename typo (page 1, LOW cosmetic — NON-GRAPH): title/H1/filename slug carry 'Nework' (missing 't',
  should be 'Network'). Baked into title:: + H1 + filename — cosmetic source artefact, not a graph-linking issue.
- ledger hygiene (NON-DEFECT, page 1): all 12 assertions carry assertion-fp dedup markers; tier/confidence
  ladder coherent and monotonic (T1 snapshots 0.90-0.95, T2 analysis 0.75-0.90, T3 speculative 0.55-0.60) with
  volatility tags matching (snapshot for metrics, durable/speculative for analysis). Model page for the applied
  PC-3/PC-4 fields working as intended.

Top wisdom:
- Amodei's alignment reframing (page 1, durable — highest-value, outlasts the news cycle): misalignment is a
  real, measurable-probability risk but NOT inevitable, because pre-trained models inherit a broad range of
  human-like motivations/personas rather than a single monomaniacal goal — a durable conceptual reframing of the
  alignment debate.
- Steinberger's emergent tool-use demonstration (page 1, durable): an OpenClaw agent autonomously identified a
  voice-memo format, used FFmpeg to convert it, located an OpenAI key in its environment, and curled it to
  Whisper for transcription — a concrete demo of UNCONFIGURED emergent tool chaining in agents.
- Substrate-independence thesis (page 1, durable philosophy — correctly tier-3/speculative): much of what we
  consider 'human' is accumulated-culture software that transfers to silicon agents fairly easily, independent of
  the day's agent-count metrics.
- PJM grid-capacity datum (page 2, durable — highest-value on the page): PJM Interconnection serves 67M+ people
  and forecasts a 17% peak-demand rise by 2030. Plus OpenAI's notable durable policy commitment: pay its own
  energy costs and use closed-loop / low-water cooling so data centres don't raise local electricity prices or
  materially draw community water.
- Compaction / multi-context-window training (page 3, durable architectural — tier-1 primary OpenAI): GPT-5.1
  Codex Max is the first model natively trained to operate across multiple context windows, enabling coherent
  work over millions of tokens in one task.
- METR long-horizon trajectory (page 3, durable quantified trend): agent time-horizon capability is doubling
  roughly every ~7 months and has tripled since Claude 3 Sonnet — an industry trajectory, not a product
  announcement. Companion capability-per-token datapoint: Codex Max matches/beats Codex at equal reasoning
  effort while using ~30% fewer thinking tokens on SWE-bench Verified.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — the live Refinement #1 fix (`claim-date:: {episode_date}` in
   `_build_ledger_bullet`, was `{ingest_date}`) HOLDS on all 3 pages this wave (all clean positive controls, claim
   == episode-date, != ingest). No `_build_ledger_bullet` edit owed; no page joins the DEFERRED re-date backlog.
2. PC-2 reinforced on 2 pages (load-bearing text/entity fields). Dictionary seeds: Roko / 'Roko's Basilisk' (was
   'Rocco'/'Rocco's Basilisk' — fix the L111 assertion body AND the derived entity name, since the artefact is in
   a graph-linked entity not only the quote); Ethan Mollick (was 'Ethan Malik', source:: field); METR (was
   'Meters'/'Meters Benchmark'); SWE-bench Verified (was 'SweetBench Verified'); Matt Shumer (was 'Matt Schumer').
   A canonical-entity lexicon lookup on assertion + source:: fields BEFORE ingest catches these; add [[METR]] and
   [[SWE-bench]] wikilinks once corrected.
3. Verify-or-hedge the two shaky page-1 attributions BEFORE trusting them as source-authority:: primary: 'Matt
   Schlitz' as Moltbook creator, and Amodei's essay title 'The Adolescence of Technology' (almost certainly
   'Machines of Loving Grace'). `[sic]`/unverified-flag rather than canonise. (W-COINED/PC-2 verification arm.)
4. PC-6 reinforced (page 2, still awaiting team-lead application): the zero-wikilink orphaned page is the textbook
   link-coverage-floor case — 3 assertions naming existing canonical pages ([[PJM Interconnection]], [[OpenAI
   Research Organisation]] (or [[OpenAI]] alias), [[Data Centers]], a Stargate/White House node) emit ZERO links.
   Adds a strong second-wave data point for graduating/applying PC-6. Downstream: confirm snapshot-tagged metrics
   (100k stars, 2,129->35,000 agents, 2M visitors on page 1; the White House emergency-auction intent on page 2)
   are treated as point-in-time by consumers — several are already stale by the 2026-08-24 ingest, correctly
   volatility:: snapshot, no fix owed.
5. NEW watch W-DISAMBIG (page 3): the verify pass should NOT canonise an annotator's bracketed disambiguation
   guess that its own evidence note contradicts. Proposed extraction/verify-prompt line registered under the
   watch below; graduates on a 2nd page.
6. PC-3/PC-4 calibration nudge (page 2): differentiate confidence across a forward pledge (#1, cap below tier-1
   floor via source_authority:: pledge/forward-looking), a political-intent snapshot (#2), and a sourced
   statistic (#3, PJM) rather than flat 0.95 — same under-application W-PREDFACT flagged. No new block; grader
   nudge on the applied fields.

No new PROPOSED-CHANGES block from the HIGH-on-2+ rule (all findings MEDIUM/LOW; the two PC-2 recurrences are
MEDIUM). One new watch registered: **W-DISAMBIG**. All other defects fold into already-tracked classes (PC-2,
PC-3, PC-4 applied; PC-6 awaiting team-lead).

### 2026-08-24 — Review wave #57 (synthesiser)
Pages reviewed (1): `podcast-evidence___mythos-returns-but-not-for-everyone.md` — good (episode 2026-06-30).

STRUCTURAL OUTCOME: single page, no HIGH-on-2+ trigger (all findings MEDIUM/LOW). No new kind, no new watch —
every defect folds into a standing class (PC-2 applied; PC-3 applied; PC-5 applied; PC-6 awaiting team-lead).
claim-date standing item: **defect ABSENT — clean positive control** (see below), so no `_build_ledger_bullet`
edit owed and no page joins the re-date backlog.

Defects by kind:
- claim-date == ingest-date — DEFECT ABSENT (positive control): episode-date:: 2026-06-30 present, every
  claim-date:: == 2026-06-30 (!= ingest-date:: 2026-08-24). The live Refinement #1 fix holds. No re-dating owed.
- ASR garble in LOAD-BEARING entity/source text (PC-2, recurrence — structured/source:: + body arm, MEDIUM):
  'Meter' -> METR (Model Evaluation & Threat Research) — the evaluator-org name on the tier-1 50%-time-horizon
  claim, appearing in BOTH the assertion body AND the source:: field (L41-46), so it fragments a graph entity, not
  just a quote (highest-priority fix this wave). Plus 'Kimmy 2.7' -> Kimi (2.7) (Moonshot model line, L51) and
  'Open Router' -> OpenRouter (single-word org, L61-64). Applied PC-2 covers all; dictionary seeds below. MEDIUM →
  folds into PC-2, no new block.
- source-authority over-claim (PC-3, recurrence — 3 tier-1 instances, LOW): API pricing (L21), Terminal Bench
  score (L31) and the METR horizon (L41) are tagged source-authority:: primary but their source strings say 'via
  AI Daily Brief host' — a podcast host RELAYING vendor/lab numbers, i.e. secondary reporting. Authority should be
  'secondary' (or cite the primary URL directly); 'primary' belongs to first-party quotes like the Lutnick letter
  on the same page. Exactly PC-3's provenance-grade cap. Folds into applied PC-3; grader-calibration nudge.
- claim↔evidence attribution mismatch (PC-5, recurrence — LOW): the Coinbase claim (L51-58) tags evidence as
  'Armstrong wrote:' but the quoted text ('Armstrong claimed that Coinbase has managed to cut their AI bill in
  half') is THIRD-PERSON host paraphrase, not a verbatim Armstrong quote — the re-attribution flavour of PC-5 (the
  evidence label asserts a first-party source the quote does not support). Fix: relabel as host paraphrase or
  substitute a genuine Armstrong quote. Folds into applied PC-5.
- durable entities as plain text / zero-wikilink (PC-6, recurrence — awaiting team-lead, LOW): the high-value
  durable assertions naming METR, OpenRouter and the China 'Huawei strategy' framing sit as plain text with no
  [[wikilink]], leaving trend-level knowledge unreachable from entity nodes. PC-6's link-coverage floor case —
  suggest [[METR]], [[OpenRouter]], [[China AI Strategy]] (each must clear PC-1's guards). Reinforces PC-6.
- graph-hygiene note (NOT this page's fault, NON-DEFECT): the [[Open Source AI]] target coexists with
  near-duplicate pages 'Open-Source AI.md' and 'Open Source AI Models.md' — a cross-graph dedup/canonicalisation
  pass (PC-7/PC-8 territory, page-external) would prevent link fragmentation. Logged for the graph-hygiene backlog.

Top wisdom:
- China's 'Huawei strategy' in open-source AI (durable geopolitical framing, Emily Weinstein ex-Commerce):
  subsidising both models AND underlying infrastructure at low/no cost to lock the global south into a
  US-incompatible AI stack — outlasts any specific model release.
- Regulatory-risk reframing (durable governance, Aaron Levie): the real risk is not a model's short-term release
  delay but review processes becoming prolonged and arbitrary, putting AI progress 'at the mercy of the most
  paranoid people with government relationships' — administration-independent.
- Open-weight capability gap (durable trend, OpenRouter): open-weight models have held a consistent 3-6 month gap
  behind US frontier labs for 18+ months — a structural fact that reframes the open-vs-closed debate, unlike the
  ephemeral benchmark/pricing snapshots on the same page.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — the live Refinement #1 fix (`claim-date:: {episode_date}` in `_build_ledger_bullet`,
   was `{ingest_date}`) HOLDS again (clean positive control, claim == episode-date 2026-06-30 != ingest). No
   `_build_ledger_bullet` edit owed; no page joins the DEFERRED re-date backlog.
2. PC-2 dictionary seeds (source:: + body lexicon lookup BEFORE ingest): METR (was 'Meter' — evaluator-org on a
   tier-1 claim, present in BOTH body and source::, so fix both surfaces); Kimi (was 'Kimmy 2.7'); OpenRouter (was
   'Open Router'). Add [[METR]] and [[OpenRouter]] wikilinks once corrected (PC-6 hand-off).
3. PC-3 grader nudge: downgrade source-authority:: primary -> secondary on the three host-relayed tier-1 claims
   (API pricing, Terminal Bench, METR horizon), or cite the primary URL directly; reserve 'primary' for
   first-party quotes (Lutnick letter). Covered by applied PC-3.
4. PC-5: fix the Coinbase evidence label — mark the quote as host paraphrase rather than 'Armstrong wrote', or
   replace with a genuine first-party Armstrong quote. Covered by applied PC-5.
5. PC-6 reinforced (awaiting team-lead): anchor the durable geopolitical/eval entities that sit as plain text —
   [[METR]], [[OpenRouter]], [[China AI Strategy]] — to connect high-value trend-level assertions into the graph.
6. Graph-hygiene backlog (page-external, not an ingest change): dedup/canonicalise 'Open Source AI' /
   'Open-Source AI' / 'Open Source AI Models' to one canonical page to stop link fragmentation.

No new PROPOSED-CHANGES block (single page, no HIGH-on-2+; all findings MEDIUM/LOW folding into PC-2/PC-3/PC-5/PC-6).
No new watch.

### 2026-08-24 — Review wave #58 (synthesiser)
Pages reviewed (2), both verdict good:
- `podcast-evidence___moltbook-the-agent-social-nework-is-the-craziest-ai-phenomena-yet.md` (page 1)
- `podcast-evidence___nano-banana-2-is-here.md` (page 2, episode 2026-03-02)

STRUCTURAL OUTCOME: highest severity this wave is MEDIUM (one per page); no HIGH → no new PROPOSED CHANGES
block. New this wave: watch **W-VERBSIC** (ASR garble surviving in verbatim/graph-visible fields after the
structured entity is normalised). Two standing watches advanced: **W-SATIRE** (2nd, ASR-confounded occurrence)
and **W-DISAMBIG** (annotator-invented parenthetical, lexicon-check arm). claim-date standing item CONFIRMED
again (page 2 clean positive control) — no `_build_ledger_bullet` edit owed.

Defects by kind (merged across both pages):
- ASR garble in VERBATIM/graph-visible fields, entity already normalised (NEW watch W-VERBSIC — BOTH pages):
  the flip side of PC-2. PC-2 correctly normalised the STRUCTURED entities (page 1: Moltbook, Molt Token,
  OpenClaw) but the raw ASR survives in fields PC-2 must not rewrite: page 1 verbatim evidence keeps 'Maltbook'
  (assertions 3 & 12), 'malt token' + 'enroll the book' (assertion 9), AND the page title::/H1 carry 'Social
  Nework' (→ Network) from the source episode title; page 2 keeps 'clawfication'/'clawfied' in the evidence quote
  (see satire row). Verbatim quotes are correctly left untouched, but a reader diffing entity-name vs evidence
  sees an unexplained mismatch and a misspelling surfaces in a graph-visible title. LOW (page 1)/MEDIUM (page 2)
  → opens W-VERBSIC below; folds into PC-2's verbatim/[sic] arm.
- joke/satire ingested as a sincere factual trend (W-SATIRE recurrence, ASR-confounded — MEDIUM page 2):
  'clawfication'/'clawfied' is an ASR mis-transcription of the host's joke that everyone is getting 'Claude-ified',
  preserved verbatim in both the assertion body and evidence and elevated into a named industry TREND. Register =
  joke, ingested as sincere fact → W-SATIRE's pattern, but CONFOUNDED by an ASR error (PC-2 also fires) unlike
  W-SATIRE #51's clean Jacobian tweet. Advances W-SATIRE toward graduation (2nd occurrence) but the ASR confound
  means the primary corrective action is PC-2 normalisation (correct/demote 'clawfication' → 'Claude-ified' pun),
  then W-SATIRE register-grading demotes the residual to tier-3 speculative; also a W-COINED cousin (a coined
  pseudo-term minted from a mis-heard pun). Kept a WATCH, not graduated — a clean (non-ASR) 2nd instance clinches.
- annotator-invented false parenthetical attribution (W-DISAMBIG recurrence, lexicon-check arm — MEDIUM page 1):
  assertion 11 credits 'Rocco (author of Rocco's Basilisk)'. Two errors compounded: PC-2 mishearing ('Rocco' →
  'Roko', pseudonymous) AND an annotator-volunteered parenthetical that invents authorship — Roko's Basilisk is a
  thought experiment, not an authored work. The substrate-independence IDEA is quoted verbatim and sound; only the
  speaker attribution + parenthetical are unreliable. Hedged tier-3 conf 0.6 caps blast radius. Reinforces
  W-DISAMBIG via its arm (c) verify-the-guess-against-a-lexicon, though the strict graduation trigger (bracket
  contradicted by the page's OWN evidence note) is NOT met here — the contradiction is against world/lexicon fact.
  Advanced, kept a WATCH.
- volatility mis-categorisation (PC-4 under-application, recurrence — LOW page 2): assertions 6 (Meta scrapped
  its advanced AI chip) and 7 (Meta–Google TPU rental deal) are stamped volatility:: durable, but these are
  point-in-time corporate-news EVENTS (snapshot), like assertions 1 & 3 on the same page which correctly use
  snapshot. Retag durable→snapshot. Folds into applied PC-4; grader-calibration nudge (same bucket as W-DECAY/
  W-PREDFACT calibration).
- self-reported metrics over-graded (PC-3 calibration, recurrence — LOW page 1): assertion 1 (OpenClaw rename,
  100k GitHub stars / 2M visitors in a week) is tier 1 / conf 0.95 but the numbers are UNAUDITED self-reported
  growth cited from a single announcement tweet. source_authority should be single-source (self-reported), which
  caps confidence; volatility:: snapshot is already correct so durable weight is low. Folds into applied PC-3.
- non-canonical acronym casing on resolving wikilinks (PC-8, recurrence — LOW page 2): [[Enterprise Ai]] (→
  Enterprise AI) and [[Nvidia Gpu]] (→ Nvidia GPU) — both resolve so nothing breaks, but fragment from the
  canonical node. 'Enterprise Ai' is now the 3rd recurrence (waves #44, #55, #58); 'Nvidia Gpu' is a fresh GPU
  instance reinforcing PC-8 sub-rule (a) known-acronym uppercasing. PC-8 is GRADUATED and awaiting team-lead
  application — this wave adds weight, no new action.
- staleness / backfill lag — NON-DEFECT (positive control, page 2): episode-date 2026-03-02 vs ingest-date
  2026-08-24 is a ~5.5-month backfill; every claim-date:: == 2026-03-02 (= episode-date, != ingest-date), so the
  live Refinement #1 fix holds and the snapshot claims (pricing vs Nano Banana Pro, Claude sign-up growth, IBM's
  13% drop) are correctly pinned to March. Downstream should treat these as HISTORICAL, not current — a volatility::
  snapshot + correct claim-date already encode that.

Top wisdom:
- Emergent agentic tool-use, reproducible (page 1, assertion 5, durable): an OpenClaw agent autonomously chained
  tools with zero user config — detected a voice-memo file format, ran FFmpeg to convert to WAV, discovered an
  OpenAI key in the environment, and curled Whisper to transcribe. A concrete demonstration, not ephemeral news.
- Amodei's misalignment frame (page 1, assertion 6, durable): AI misalignment is a real, measurable risk but not
  inevitable, because models inherit a BROAD range of human-like motivations from pre-training rather than being
  'monomaniacally' single-goal. A load-bearing conceptual frame that outlives the news cycle.
- Image-gen as maturing infrastructure (page 2, assertion 8, VentureBeat T2, durable): Nano Banana 2 is not a
  generational quality leap but the maturation of AI image generation from creative novelty into a production-ready
  infrastructure component, driven by efficiency (half cost, seconds latency) rather than raw capability. Most
  transferable insight on the page.
- Quantified enterprise-modernisation datapoint (page 2, assertion 5, T1, WSJ): Morgan Stanley's COBOL benchmark —
  280,000 developer-hours saved reviewing 9M lines of code via internal tools + OpenAI models. Citable long after
  the news cycle.
- Substrate-independent 'software' framing (page 1, assertion 11, durable IDEA / shaky attribution): much of what
  we call human is culturally-accumulated software the biological organism merely hosts, and it can jump to silicon
  — provocative and durable, but see the Roko/Rocco misattribution flagged above.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED again. Page 2 is a clean positive control (claim-date == episode-date
   2026-03-02 != ingest-date 2026-08-24) despite a ~5.5-month backfill; page 1 carries no claim-date defect. The
   live Refinement #1 fix (`claim-date:: {episode_date}` in `_build_ledger_bullet`, was `{ingest_date}`) HOLDS.
   No `_build_ledger_bullet` edit owed; neither page joins the DEFERRED pre-fix re-date backlog.
2. NEW watch W-VERBSIC (below): when PC-2 normalises a structured entity but the raw ASR survives in a VERBATIM
   evidence quote or a graph-visible title::/H1, surface an inline `[sic: Canonical]` annotation next to the
   garbled token (evidence) / a normalised-title:: companion field (title) so the entity-vs-evidence mismatch is
   self-explaining WITHOUT altering the verbatim quote. Folds into PC-2's verbatim/[sic] arm.
3. PC-2 + W-SATIRE (clawfication): normalise/demote 'clawfication'/'clawfied' → the 'Claude-ified' pun (PC-2),
   then grade the residual joke tier-3 speculative and phrase as reported rather than as a named trend (W-SATIRE).
4. PC-2 + W-DISAMBIG (Roko): correct 'Rocco' → 'Roko' (pseudonymous) and DROP the false '(author of Rocco's
   Basilisk)' parenthetical — Roko's Basilisk is a thought experiment, not an authored work; `[sic]`/unverified
   rather than assert an authorship the lexicon contradicts.
5. PC-4 grader nudge: retag page 2 assertions 6 & 7 (Meta chip cancellation, Meta–Google TPU deal) durable →
   snapshot; corporate-news events are snapshot regardless of confidence. Covered by applied PC-4.
6. PC-3 grader nudge: cap page 1 assertion 1 to source_authority:: single-source (self-reported via one
   announcement tweet); confidence should follow authority. Covered by applied PC-3.
7. PC-8 reinforced (awaiting team-lead): [[Enterprise Ai]] (3rd recurrence) and [[Nvidia Gpu]] retarget to
   canonical [[Enterprise AI]] / [[Nvidia GPU]] — known-acronym uppercasing, already covered by graduated PC-8.

No new PROPOSED CHANGES block (highest severity MEDIUM, not HIGH; every finding folds into PC-2/PC-3/PC-4/PC-8 or
the two advanced watches). New watch: W-VERBSIC. Advanced watches: W-SATIRE, W-DISAMBIG.

### 2026-08-24 — Review wave #59 (synthesiser)
Pages reviewed (3):
- `podcast-evidence___no-one-wins-this-ai-super-bowl.md` (page 1, good, episode 2026-02-08)
- `podcast-evidence___nvidias-blowout-earnings-pops-the-ai-bubble-bubble.md` (page 2, good, episode 2025-11-21)
- `podcast-evidence___openai-declares-code-red.md` (page 3, acceptable, episode 2025-12-03, AI Daily Brief)

STRUCTURAL OUTCOME: one HIGH this wave (page 3 source:: 'Sam Alman'). It is the **2nd known-show host
mis-attribution** (wave #21 'Matt Schmidt' was the 1st — both AI Daily Brief), which is exactly **W-HOST's
pre-registered graduation trigger**. W-HOST therefore GRADUATES → new **PC-9** block below (per PC-7/PC-8
2nd-page-across-waves discipline). All three pages are clean claim-date positive controls (claim-date ==
episode-date != ingest-date 2026-08-24) → Refinement #1 HOLDS, no `_build_ledger_bullet` edit owed. Everything
else folds into applied PC-1(c)/PC-2/PC-3; one new light watch **W-EXTRAORD** (extraordinary magnitude claim on
a single non-primary source).

Defects by kind (merged across pages):
- known-show host mis-attribution in source:: (HIGH, page 3 — GRADUATES W-HOST → PC-9): source:: reads 'Sam
  Alman' on 7 assertions (lines 14, 55, 75, 84, 94, 104, 116). Two compounded errors: (i) PC-2 mishearing
  'Alman'→Altman; (ii) attribution inversion — the AI Daily Brief host is NLW (Nathaniel Whittemore), so
  host-analysis assertions (94 'citing recent charts', 104 'Host Analysis') wrongly cast the episode's SUBJECT
  (Altman) as its host, and line 14 'The Information (reported by Sam Alman)' is incoherent (The Information
  reported the memo; Altman wrote it). Same show + same failure class as wave #21 → the pre-registered 2nd known-
  show page. Blast radius is high: one wrong host name mints a spurious entity across every assertion of the page.
- ASR entity garble in assertion BODY / structured fields (MEDIUM×3 — PC-2 body arm): page 2 'Saudi-owned Humane'
  → HUMAIN (Saudi PIF AI co; 'Humane' is the defunct US AI-pin co — wrong entity, not just a garble, line 41);
  page 2 'Department of Energy Chief of Staff Carl Co' (lines 81/84) — ASR-truncated surname, verify against a
  lexicon before it becomes a queryable entity (`[sic]` if unresolved); page 3 'On Poly Market' → Polymarket
  (line 51), leaking into both the assertion body AND source:: ('Poly Market (reported by Sam Alman)'). Fold into
  PC-2 body arm; the Polymarket case also wants a [[Polymarket]] wikilink (PC-6/PC-7 canonical form).
- org-vs-product wrong-granularity wikilink (MEDIUM, page 1 — PC-1(c) recurrence): three OpenAI corporate/
  executive claims (Kate Rouch CMO quote, Sam Altman statements, strategic response) wikilink to [[OpenAI API]]
  (a product page) when 'OpenAI Research Organisation.md' exists. This is the LITERAL PC-1(c) worked example
  ([[OpenAI API]] proxying the OpenAI org); page reuse propagates it across all three claims. Retarget to the
  org page. Already covered by PC-1(c) — reinforces, no new action.
- extraordinary magnitude claim on single non-primary source (MEDIUM, page 1 — NEW watch W-EXTRAORD, folds PC-3):
  'a Claude Code plugin incident wiped billions of dollars off global market value' is tier 1 / conf 0.85 but
  rests on one secondary source (the host, relayed in passing) with no primary corroboration and reads as
  transcript hyperbole/conflation. PC-3 authority-caps-confidence handles the label; the residual is that a
  tier-1 EXTRAORDINARY claim of this magnitude needs a verification flag / down-tier even once authority is
  labelled secondary. Opens W-EXTRAORD.
- relayed-quote over-attribution to primary (LOW, page 1 — PC-3 calibration): Kate Rouch's 'ChatGPT has more free
  users in Texas than Claude has globally' is tagged source_authority:: primary but reaches the ledger through the
  host's narration (delivery channel is secondary); same weakly for the Altman quotes. Relax primary→secondary.
  Folds into applied PC-3 (relay-channel arm, cf. wave #58).
- ASR noise retained in VERBATIM evidence, bodies correctly normalised (LOW, pages 2 & 3 — ACCEPTABLE / W-VERBSIC):
  page 2 evidence keeps 'buck 30'($1.30), 'Sunno'(Suno), "Michael Bur's"(Burry), 'GPT51'(GPT-5.1), '$2.45 45
  billion'(dup token) while bodies normalise correctly; page 3 evidence keeps 'Chat GBT'(ChatGPT). Correct to
  leave verbatim untouched; W-VERBSIC (wave #58) already tracks the entity-vs-evidence mismatch surfacing.
- NON-DEFECTS (positive controls): all three pages carry episode-date and claim-date == episode-date (2026-02-08 /
  2025-11-21 / 2025-12-03), NOT ingest-date — the known ingest-date defect is ABSENT on every page this wave.
  Page 2 tier/confidence gradient sane (T1 0.90-0.95 hard earnings/deal facts, T2 0.85-0.90 analysis, T3 0.65-0.70
  forecasts); all 12 assertions carry unique assertion-fp dedup markers.

Top wisdom:
- ~90% of top-rated Super Bowl ads each year are humour-based, not serious/tear-jerker (page 1, fp c604f0870bf3bd69,
  T1 0.85) — a durable, transferable marketing principle.
- Anthropic's campaign is strategically flawed because it critiques a competitor pain point (OpenAI ads) that does
  not yet exist, so the audience isn't feeling the pain (page 1, fp 744724ffdb4d058a, T2) — reusable insight on
  timing a critique to lived experience; paired with: aggressive/petty attack advertising can backfire by feeding
  the 'AI is just tech billionaires extracting money' narrative rather than differentiating the brand (fp f5e4d38c3979e31b).
- Jensen Huang's three simultaneous platform shifts — CPU→GPU accelerated computing, classic ML→generative AI,
  generative→agentic & physical AI (page 2, T2, durable) — the most durable structural frame on the page; plus
  Nvidia's falsifiable counter to the chip-depreciation short thesis: six-year-old A100s still at 100% utilisation (line 71).
- OpenAI's ability to raise hundreds of billions depends heavily on broad PUBLIC PERCEPTION of its standing vs
  Google (page 3, line 71, T2, durable) — reframes a funding round as a narrative/perception game, not a pure
  capability race; the 'code red' priority list (over-refusals, ChatGPT UX, image gen) conspicuously OMITS coding
  models, implying OpenAI sees mainstream consumer engagement — not coding — as the decisive battleground (lines 61, 101).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED again on all 3 pages (clean positive controls, incl. two multi-month
   backfills). Refinement #1 (`claim-date:: {episode_date}` in `_build_ledger_bullet`) HOLDS; no edit owed; no page
   joins the DEFERRED pre-fix re-date backlog.
2. GRADUATE W-HOST → PC-9 (below): seed the PC-2 source:: verify pass with a per-show host/regular-participant map
   keyed off the episode's show name (AI Daily Brief → Nathaniel Whittemore / NLW), applied before ledger write.
3. PC-2 body arm dictionary adds (verify): 'Humane' (Saudi context) → HUMAIN; 'Poly Market' → Polymarket; verify
   'Carl Co' (DOE Chief of Staff) against a lexicon and `[sic]` if unresolved rather than mint the truncated entity.
4. PC-1(c) reinforced (no new action): retarget the three page-1 OpenAI corporate/executive claims from
   [[OpenAI API]] to the OpenAI organisation page — the canonical PC-1(c) worked example, recurring.
5. NEW watch W-EXTRAORD (below): when a claim's magnitude is extraordinary (market-moving / superlative / global-
   scale) AND source_authority is not primary AND there is no independent corroboration, cap tier ≤2 or attach a
   verification-needed flag regardless of the raw confidence estimate. Folds alongside applied PC-3.
6. PC-3 relay-channel nudge: relax page-1 Rouch/Altman relayed quotes source_authority:: primary → secondary
   (reach the ledger via host narration, not a direct primary source). Covered by applied PC-3.

New PROPOSED CHANGES block: PC-9 (W-HOST graduated). New watch: W-EXTRAORD. Reinforced: PC-1(c), PC-2, PC-3, W-VERBSIC.

### 2026-08-24 — Review wave #60 (synthesiser)
Pages reviewed (1):
- `podcast-evidence___openai-declares-the-next-phase-of-ai.md` (acceptable, episode 2026-06-10)

STRUCTURAL OUTCOME: no HIGH this wave; all 5 issues MEDIUM/LOW and each folds cleanly into an already-
applied refinement or an existing watch — **no new watch, no graduation, no PROPOSED CHANGES block owed**.
Clean claim-date positive control (episode-date:: 2026-06-10 populated; every claim-date:: == 2026-06-10,
NOT ingest-date 2026-08-24) → Refinement #1 HOLDS. Two reinforcing signals of note: (i) W-VERBSIC's ASR-
garble-crossing-into-graph-visible-body pattern recurs (Finman→Feynman in an assertion BODY, not just the
quote); (ii) evidence-overreach recurs (PC-5), here an inserted manufacturer 'by Intel' unsupported by the
claim's own quote — likely bled over from the adjacent Nvidia/Intel claim.

Defects by kind:
- ASR entity garble in assertion BODY + era-mismatched wikilink (MEDIUM — PC-2 body arm / W-VERBSIC + PC-1):
  assertion 8 'next generation Finman chip set' — 'Finman' is ASR for Nvidia's **Feynman** architecture and
  survived into the assertion body (only the verbatim quote should carry ASR noise). Compounded by an era-
  mismatched link to [[NVIDIA H200]] (current-gen part) for a claim about a 2028 next-gen chip. Fix: normalise
  Finman→Feynman in the body (PC-2); retarget the link to a next-gen-architecture page (NVIDIA Feynman /
  Rubin-successor) or drop it (PC-1 wrong-sense/era guard).
- evidence-overreach: claim asserts more than its quote (MEDIUM — PC-5 recurrence): assertion 7 states Google's
  3M-TPU order is 'to be manufactured **by Intel** in 2028', but its evidence reads only '...to be manufactured
  in 2028 after being satisfied with test units' — no Intel. Manufacturer inserted (bled from the adjacent
  Nvidia/Intel claim). Reconcile: add Intel support to the evidence or drop 'by Intel' so claim == quote.
  Already covered by applied PC-5; reinforces.
- weak/loose wikilink + non-canonical casing (LOW — PC-1 + PC-8): the 'third phase / Built to Benefit Everyone'
  claim links to [[National Ai Strategy]] — only tangential to an OpenAI corporate-mission blog post (loose,
  PC-1 refuse-or-retarget), and 'Ai' casing is non-canonical (→ 'AI', PC-8). Fold into applied PC-1/PC-8.
- under-linked tier-1 facts / orphaned assertions (LOW — PC-6): 5 of 12 assertions (the SpaceX/satellite/IPO
  and TPU-order facts) carry ZERO wikilinks; salient tier-1 entities (SpaceX, Elon Musk, Nvidia Blackwell,
  Google TPU, Intel, Anthropic) never linked → graph-orphaned. PC-6 link-coverage floor anchors these once
  the canonical entities resolve; add the links so the space-datacentre and TPU-order news is reachable.
- ASR noise in VERBATIM evidence (ACCEPTABLE) BUT garble promoted into source:: (LOW — W-VERBSIC ok / PC-2
  source arm): quotes retain '1 gawatt'(gigawatt), 'chat GBT'(ChatGPT), 'Lasan on X'(garbled handle) —
  correct to leave verbatim untouched. The residual defect: 'Lasan' is promoted into the source:: field
  ('citing Lasan on X'), so an unverifiable garbled handle stands as attribution. PC-2 source arm: verify or
  drop the handle rather than let a garble anchor source::.

Top wisdom:
- Durable framing (T2, 0.75): the agentic transition and its economic consequences are likely more significant
  than the original ChatGPT launch in shaping AI's ultimate societal role — a durable thesis amid ephemeral news.
- Durable distinction (T2, 0.70): consumer AI and work/agentic AI are becoming fundamentally different categories
  that should be analysed separately — a lasting analytical lens.
- Strategic declaration (T1, durable): OpenAI's 'third phase' — making advanced AI abundant, affordable, safe,
  useful and easy enough for everyone — a durable statement of corporate direction, not a dated event.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED again (clean positive control; episode-date:: populated, all
   claim-date:: == episode-date 2026-06-10, not ingest-date). Refinement #1 (`claim-date:: {episode_date}` in
   `_build_ledger_bullet`) HOLDS; no edit owed; page does NOT join the DEFERRED pre-fix re-date backlog.
2. PC-2 body arm add (verify): 'Finman' → Feynman (Nvidia architecture); PC-2 source arm: verify/drop the
   'Lasan on X' handle before it anchors source:: (do NOT touch the verbatim evidence copy).
3. PC-5 reinforced (no new action): strip inserted, unquoted attributions ('by Intel') so each claim states
   only what its own evidence supports — the neighbour-claim-bleed variant of applied PC-5.
4. PC-1/PC-8 reinforced (no new action): refuse/retarget the loose [[National Ai Strategy]] link and
   canonical-case 'Ai' → 'AI'.
5. PC-6 reinforced (no new action): anchor link-coverage on the 5 orphaned tier-1 assertions (SpaceX, Elon
   Musk, Nvidia Blackwell, Google TPU, Intel, Anthropic).

Reinforced: PC-1, PC-2, PC-5, PC-6, PC-8, W-VERBSIC. New watches: none. Graduations: none.

### 2026-08-24 — Review wave #61 (synthesiser)
Pages reviewed (1):
- `podcast-evidence___openai-ipo-elon-xai-spacex-merger-state-of-the-ai-race.md` (acceptable, episode 2026-02-02)

STRUCTURAL OUTCOME: one HIGH this wave (`wikilinks-none`), but it is the maximal-scale form of an
ALREADY-GRADUATED refinement (PC-6 link-coverage floor, in PROPOSED CHANGES, not yet applied) — so **no new
PROPOSED CHANGES block owed** (the HIGH-on-2+-pages rule mints a block only for an UN-covered defect; this one
is covered). It does escalate PC-6's priority: previously observed as a per-assertion zero-link gap (LOW), here
it is a WHOLE-PAGE orphan island — ZERO [[wikilinks]] across all 14 assertions while target pages (Anthropic.md,
Apple Inc Technology Corporation.md, OpenAI Research Organisation.md, ...) exist in the graph. See PC-6 priority
note below. Clean claim-date positive control again (episode-date:: 2026-02-02 populated; all 14 claim-date:: ==
2026-02-02, NOT ingest-date 2026-08-24) → Refinement #1 HOLDS. Dedup/tier grading clean (14/14 unique
assertion-fp; tier-1 0.85-0.95 snapshot, tier-2 0.70-0.75 durable, tier-3 0.45-0.55 speculative).

Defects by kind:
- whole-page zero-link / orphan island (HIGH — PC-6 maximal form): grep confirms ZERO [[wikilinks]] on the
  entire page; check (1) passes only vacuously. Every named entity (Apple, Amazon, OpenAI, Anthropic, xAI,
  SpaceX, Google) is unlinked though its canonical page exists → the ledger has no edges into the KG. This is
  PC-6 applied to every assertion at once, not a new defect. Fix = apply PC-6 (link-coverage floor, PC-1-gated)
  and anchor each assertion's highest-precision entity. Escalates PC-6 from LOW-per-assertion to HIGH-whole-page.
- ASR garble hardening into STRUCTURED provenance fields (MEDIUM — PC-2 source:: arm, incl. PC-9 host-map
  territory): source::/entity fields (NOT just verbatim quotes) carry mis-heard proper nouns — 'Ben Casta of
  Village Global' (L144) ≈ **Ben Casnocha** (Village Global partner); 'Beth Galleti' (L34) → **Beth Galetti**
  (Amazon SVP People); 'Peter Turk' (L124) unverifiable → verify or `[sic]`; company 'QAI' ASR-uncertain (PC-7
  variant territory). Distinct from ACCEPTABLE verbatim-quote ASR ('bare market'→bear market, 'Open AAI',
  '10 to20 billion') which stays untouched. PC-2 source arm: correct against known referents / `[sic]`-flag
  before ledger write; leave the evidence copies verbatim.
- source-authority thin on rumoured deals (LOW — PC-3 ok, mild-hot): tier-1 facts are single-outlet 'cited by
  host' (WSJ/Reuters/FT, source-authority:: secondary) with no independent corroboration, several rumoured/
  early-stage (xAI-SpaceX merger 'early stage', OpenAI $830B 'rumored', Amazon $50B 'considering'). Conf
  0.85-0.9 slightly hot for unconfirmed single-source rumour but defensible given snapshot/secondary tagging.
  Folds into applied PC-3 (confidence must not exceed authority); no new action.

Top wisdom:
- Durable macro thesis (T2, L81): 'companies growing revenue while cutting headcount' (Amazon, ASML) as an
  AI-efficiency signal to watch through 2026 — durable vs the ephemeral IPO/merger news around it.
- Reusable economic lens (T2, L101): Amazon's potential $50B OpenAI stake as an arms-dealer 'win-win-win' — it
  profits from selling compute whoever wins the frontier race (infra-vs-model economics).
- Durable strategic read (T2, L71): Apple ceding the foundation-model race (QAI acquisition + Google model
  partnership) to concentrate on winning AI hardware/devices — a lasting read on Apple's AI posture.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED again (clean positive control; episode-date:: populated, all
   claim-date:: == episode-date 2026-02-02, not ingest-date). Refinement #1 (`claim-date:: {episode_date}` in
   `_build_ledger_bullet`) HOLDS; no edit owed; page does NOT join the DEFERRED pre-fix re-date backlog.
2. **PC-6 priority escalation (no new block; bump application order):** the whole-page orphan-island case is
   PC-6's highest-severity manifestation and its highest-value fix — apply PC-6 (already in PROPOSED CHANGES)
   ahead of lower-severity items. When PC-6 lands, add [[wikilinks]] for Apple, Amazon, OpenAI, Anthropic, xAI,
   SpaceX, Google (target pages already resolve); PC-1 gate still vetoes any generic/wrong-sense candidate.
3. PC-2 source arm (verify): 'Ben Casta'→Ben Casnocha, 'Beth Galleti'→Beth Galetti, verify 'Peter Turk',
   `[sic]`/verify 'QAI'; correct in source::/entity fields ONLY, leave verbatim evidence quotes untouched.
4. PC-3 reinforced (no new action): keep confidence ≤ authority on single-source 'cited by host' rumours.

Reinforced: PC-2, PC-3, PC-6 (escalated to whole-page HIGH). New watches: none. Graduations: none.
No new PROPOSED CHANGES block (the sole HIGH is covered by already-graduated PC-6; every other finding folds
into applied PC-2/PC-3 or reinforces pending PC-6).

### 2026-08-24 — Review wave #62 (synthesiser)
Pages reviewed (1):
- `podcast-evidence___openai-preps-new-garlic-model.md` (good, episode 2025-12-04)

STRUCTURAL OUTCOME: ZERO HIGH this wave, verdict good — **no new PROPOSED CHANGES block owed** (the HIGH-on-2+
rule needs a HIGH; there is none, and only one page). Every finding folds into applied/pending PCs. Two positive
signals worth banking: (1) the strongest defect is a RECURRENCE of an already-seeded PC-2 entry — 'Mike Kger'→
Mike Krieger is the exact wave #25 source::-arm seed, so this page re-validates that dictionary entry rather than
opening anything new; (2) the curated [[wikilink]] entity names are all CLEAN — the garble is confined to source::
/attribution fields, i.e. PC-2's source arm is the whole story and PC-1/PC-6 link hygiene is intact here. Clean
claim-date positive control AGAIN: episode-date:: 2025-12-04 populated, all 12 claim-date:: == 2025-12-04 (NOT
ingest-date 2026-08-24) → Refinement #1 HOLDS; page does NOT join the DEFERRED pre-fix re-date backlog. The
'Garlic' rumour cluster is a well-HANDLED case (see below), not a defect.

Defects by kind:
- ASR garble in STRUCTURED source::/attribution fields, clean wikilinks (MEDIUM — PC-2 source arm): L24 'Mike
  Kger'→**Mike Krieger** (Anthropic CPO — RECURRENCE of the wave #25 seed), L64/L114 'Guo Lample'→**Guillaume
  Lample** (Mistral co-founder/Chief Scientist — NEW source-arm seed), L98 source label 'Rishies, Ivan Fioranti'
  ('Rishies' a garbled handle → verify/`[sic]`). Curated entity [[wikilinks]] are clean; only source:: lags →
  correct against known referents / `[sic]`-flag before ledger write, leave verbatim evidence:: quotes untouched.
- model-version ASR conflation collapsing two DISTINCT real models (MEDIUM — PC-2 body arm + model-lexicon; NEW
  watch W-MODELVER): L101 asserts no full-scale training run since 'GPT-4.0 in May of the previous year' from
  evidence 'GPT40 in May of last year' — almost certainly **GPT-4o** mis-transcribed as 'GPT-4.0', a different
  model. A plain speller might keep/normalise to GPT-4.0 or GPT-4, conflating two real models; needs a model-
  version lexicon to land on GPT-4o. Normalise 'GPT40'/'GPT-4.0'→GPT-4o here before the last-successful-run claim
  is trusted. See W-MODELVER below.
- verbatim transcript hype confined to evidence, assertion properly hedged (LOW — ACCEPTABLE, PC-5-adjacent): L98
  evidence carries 'Alien Tech' / 'biggest jump in coding models I've seen to date' but the assertion (L91) is
  correctly hedged ('perceived by developers as a significant leap') → hype stays quarantined in the quote, no
  action beyond the 'Rishies' handle fix above.
- single-source speculative rumour, flagged CORRECTLY (LOW — PC-3 + PC-4 working, NOT a defect): the 'Garlic'
  codename claims (L81, L121) rest on anonymous sources + Twitter handle 'Chris ChatgBT21' and are tagged
  source-authority:: single-source + volatility:: speculative at conf 0.8/0.55 — exactly the PC-3/PC-4 handling
  W-COINED asks for on a coined codename. 'Garlic' RECURS (wave #47 title `is-gpt-52-garlic-coming-this-week`);
  here it is the page's most ephemeral item and is graded as such. Positive control for PC-3/PC-4.

Top wisdom:
- Durable strategic thesis (T2, conf 0.9): Guillaume Lample (Mistral Chief Scientist) — in >90% of cases a fine-
  tuned SMALL model does the job of a large proprietary one, winning on cost, speed, privacy and latency. The
  small-model-shift thesis that outlives the news cycle.
- Concrete durable efficiency datum (T2): Mistral trained the Mistral 3 family (675B MoE, 41B active) on just
  3,000 Nvidia H200s vs the 100,000+-GPU clusters of leading US labs — a hard number that outlives launch news.
- Durable directional signal (T3, held speculative correctly): the next AI wave is defined by UBIQUITY (models
  small enough for drones, cars, robots, phones) rather than sheer scale.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED again (clean positive control; episode-date:: 2025-12-04 populated, all
   12 claim-date:: == episode-date, not ingest-date). Refinement #1 (`claim-date:: {episode_date}` in
   `_build_ledger_bullet`) HOLDS; no edit owed; page does NOT join the DEFERRED re-date backlog.
2. PC-2 source arm (verify): apply 'Mike Kger'→Mike Krieger (re-confirms wave #25 seed), add NEW seed 'Guo
   Lample'→Guillaume Lample (Mistral co-founder/Chief Scientist), verify/`[sic]` the 'Rishies' handle — in
   source::/attribution fields ONLY; leave verbatim evidence:: quotes untouched.
3. PC-2 body arm + model-lexicon: normalise 'GPT40'/'GPT-4.0'→GPT-4o via a model-version lexicon that knows
   GPT-4o ≠ GPT-4 ≠ GPT-4.0, so the mis-transcription is disambiguated rather than left conflating two models.
   New light watch W-MODELVER registered (single MEDIUM instance; overlaps PC-2 body arm + W-DISAMBIG arm (c)).
4. PC-3/PC-4 reinforced (no new action): keep single-source + speculative on the 'Garlic' rumour — handled well.

Reinforced: PC-2 (source arm re-validates wave #25 seed; +Guillaume Lample seed), PC-3, PC-4. New watches:
W-MODELVER (below). Graduations: none. No new PROPOSED CHANGES block (zero HIGH, single page).

### 2026-08-24 — Review wave #63 (synthesiser)
Pages reviewed (1):
- `podcast-evidence___openai-proposes-a-new-deal.md` (good, episode 2026-04-09)

STRUCTURAL OUTCOME: ZERO HIGH, verdict good, single page — **no new PROPOSED CHANGES block owed** (HIGH-on-2+
rule needs a HIGH; none here). Both findings are LOW and are POSITIVE CONTROLS, not defects. This is the
cleanest claim-date positive control yet stated as a NON-defect explicitly: episode-date:: 2026-04-09 populated,
all 11 claim-date:: == 2026-04-09 (NOT ingest-date 2026-08-24) → Refinement #1 HOLDS; page does NOT join the
DEFERRED pre-fix re-date backlog. Curated [[wikilink]] entities are clean ('Wil Manidis', 'Quinnipiac' both
correctly spelled — no PC-2 entity-arm hit anywhere). The lone ASR stumble is quarantined inside a verbatim
evidence:: quote with a cleanly paraphrased assertion → PC-5-adjacent, acceptable-by-design, no action.

Defects by kind:
- claim-date defect ABSENT (LOW — positive control, NOT a defect): all 11 assertions carry claim-date:: ==
  episode-date:: 2026-04-09, contradicting the run-wide ingest-date hypothesis. Confirms the defect is NOT
  uniform on post-fix pages; Refinement #1 continues to hold.
- ASR stumble confined to verbatim evidence, assertion clean (LOW — ACCEPTABLE, PC-5/W-VERBSIC-adjacent): one
  evidence:: quote carries a transcript repair ('to make sure that internet or to make sure that electricity and
  the internet reach remote parts of the globe'); the assertion body is cleanly paraphrased with no artefact →
  stays quarantined in the quote, no rewrite (verbatim field is untouchable by design). No entity-name garble.

Top wisdom:
- Durable framing device (T1): OpenAI's 'Industrial Policy for the Intelligence Age' proposes treating AI access
  as a foundational economic right, analogous to historical drives for literacy, electricity and internet access
  — outlives the news cycle.
- Most concrete durable policy mechanism (T1): the public wealth fund — policymakers and AI companies seed a
  diversified long-term fund whose returns distribute directly to citizens to share AI-driven growth.
- Durable structural critique (T2): the host's meta-insight that AI-industry communication is imbalanced —
  disproportionately validating risks over articulating benefits, reinforcing negative sentiment — more lasting
  than the ephemeral Quinnipiac poll snapshots.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED again (clean positive control; episode-date:: 2026-04-09 populated, all
   11 claim-date:: == episode-date). Refinement #1 (`claim-date:: {episode_date}` in `_build_ledger_bullet`)
   HOLDS; no edit owed; page does NOT join the DEFERRED re-date backlog. Two consecutive good positive controls
   (#62, #63) — the standing item is now empirically DEAD on post-fix pages; keep verifying siblings rather than
   assuming the defect is uniform, but no ingest.py change is warranted.
2. PC-4 (no new action): the four Quinnipiac poll assertions are correctly tiered volatility:: snapshot — the
   page's ephemeral news content, low long-term retention vs the durable policy/wisdom claims. Positive control
   for PC-4's snapshot tiering; reinforces the case for promote.py time-decay on snapshots (still pending).

Reinforced: Refinement #1 (2nd consecutive clean positive control), PC-4 (snapshot tiering), PC-5/W-VERBSIC
(verbatim-quote quarantine working). New watches: none. Graduations: none. No new PROPOSED CHANGES block
(zero HIGH, single page).

### 2026-08-24 — Review wave #64 (synthesiser)
Pages reviewed (1):
- `podcast-evidence___openclaw-goes-to-openai.md` (acceptable, episode 2026-02-16)

STRUCTURAL OUTCOME: one HIGH this wave, but SINGLE page → **no new PROPOSED CHANGES block owed** (the
HIGH-on-2+-pages rule mints a block only for a HIGH recurring on a 2nd distinct page). The HIGH is a NEW
defect kind (single-surface entity CONFLATION requiring a SPLIT — the inverse of PC-7 variant-merge) → opens
watch **W-SPLIT** below. This page is a sibling of wave #58's `moltbook…` episode (2026-01-31) and shares its
entity cluster (Moltbook / Moltbot / OpenClaw); the conflation here directly CONTRADICTS that canonical
sibling ledger, which is what makes it HIGH despite being verbatim-sourced. 3rd consecutive clean claim-date
positive control (#62/#63/#64): episode-date:: 2026-02-16 populated, all claim-date:: == 2026-02-16 (NOT
ingest-date 2026-08-24) → Refinement #1 HOLDS.

Defects by kind:
- single-ASR-surface entity CONFLATION → requires SPLIT (HIGH — NEW kind, opens W-SPLIT; inverse of PC-7):
  the ASR artefact **'Multibot'** merges TWO distinct real referents into one phantom node — (a) L51 the C&D
  rename target 'ClaudeBot → Multibot → OpenClaw' is canonically **Moltbot** (the renamed CLI project); (b) L31
  'Multibot' as the agent social network that grew to 2.7M agents is canonically **Moltbook**. Both canonical
  names are attested in the sibling ledger `…moltbook-the-agent-social-nework…` (episode 2026-01-31). The raw
  quote is itself garbled ('changed the name to Mult bot or Multi'). Neither is wikilinked, so PC-1 never fires;
  PC-2 (correct-to-one-referent) and PC-7 (merge same-referent variants) both fail because the fix is to SPLIT
  one surface into two DIFFERENT entities. Downstream symptom (internal-coherence, LOW): the naming timeline is
  self-contradictory — 'Multibot' is simultaneously the renamed platform (L51) AND a social network 'built on
  the OpenClaw platform' (L31). Fix: split 'Multibot' → Moltbot (project, L51) + Moltbook (network, L31) matching
  the 2026-01-31 canonical names; keep raw ASR quotes intact in evidence::, fix only the assertion entity names.
- ASR person-name garble in source::/attribution field (MEDIUM — PC-2 source arm): L134 **'Ali Kay Miller'** →
  **Allie K. Miller** (well-known AI advisor); L44 **'Yuchen Chin'** phonetic → verify/`[sic]`. Same class as the
  wave #61/#62 source-arm garbles; correct in source::/attribution ONLY, leave verbatim evidence:: untouched.
- confidence-of-attribution vs confidence-of-outcome collapsed (LOW — PC-3/PC-4-adjacent, not a defect): tier-3
  volatility:: speculative assertions (L81, L101) carry conf 0.85/0.80 — hot for the speculative band, but both
  are verbatim direct quotes (Steinberger/Altman), so the number is confidence-OF-ATTRIBUTION not -of-outcome.
  The two senses are collapsed into one field. Defensible here; noted as a standing PC-3/PC-4 semantics nuance
  (a high speculative-band confidence is only sound when read as attribution-certainty), no ingest change owed.

Top wisdom:
- Durable Schelling-point / network-effect thesis (L71): OpenClaw's durable value is the self-reinforcing
  concentration of developer attention and community, NOT its technology — 'the technological capability set is
  the least important part'. Why open-source community gravity beats feature parity; most transferable insight.
- Durable governance lesson (L91): Anthropic sending legal threats rather than collaborating framed as the
  'fumble of the decade' — handing OpenAI the narrative and the talent behind the fastest-growing AI project;
  how incumbents lose open-source momentum.
- The rest (Steinberger→OpenAI, 2.7M agents, GitHub stars) is correctly volatility:: snapshot, low durable value.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED again (3rd consecutive clean positive control; episode-date:: 2026-02-16
   populated, all claim-date:: == episode-date). Refinement #1 (`claim-date:: {episode_date}` in
   `_build_ledger_bullet`) HOLDS; no edit owed; page does NOT join the DEFERRED pre-fix re-date backlog. Standing
   item now empirically DEAD across #62/#63/#64 post-fix pages — keep verifying siblings, no ingest.py change.
2. W-SPLIT opened (below): single-ASR-surface conflation of two distinct named entities → SPLIT, not merge.
   Verify-pass shape: when one surface maps to two mutually-inconsistent roles/referents that resolve to DISTINCT
   canonical entities (esp. attested in a sibling ledger), split it rather than canonicalise to one.
3. PC-2 source arm (verify): 'Ali Kay Miller'→Allie K. Miller (NEW seed), verify/`[sic]` 'Yuchen Chin' — in
   source::/attribution fields ONLY; leave verbatim evidence:: quotes untouched.
4. First-class-entity-page seeding (recurring, low-priority): promote **OpenClaw / Moltbook / Moltbot** to
   canonical entity pages so future episodes wikilink a stable node instead of re-deriving ASR-variant spellings
   each ingest. This cluster has recurred across waves #12/#21/#25/#30/#58/#64 (Open Claw→OpenClaw, Maltbook→
   Moltbook, and now the Multibot conflation) — a durable entity-page fixes the whole family at once. Same shape
   as the wave-#3 [[Project Prometheus]] entity-page suggestion.

Reinforced: Refinement #1 (3rd consecutive clean positive control), PC-2 (source arm; +Allie K. Miller seed),
PC-3/PC-4 (attribution-vs-outcome confidence nuance). New watches: W-SPLIT (below). Graduations: none.
No new PROPOSED CHANGES block (the sole HIGH is a NEW kind on a SINGLE page → watch, not a block).

## WATCHES (single/low-page; graduate to PROPOSED CHANGES on recurrence)

### W-VERBSIC — ASR garble surviving in verbatim/graph-visible fields after the structured entity is normalised (wave #58)
NEW kind, the deliberate BLIND SPOT of PC-2: PC-2 corrects a mis-heard token in STRUCTURED/source:: fields, but by
design it must NOT rewrite a verbatim evidence:: quote, and it does not police the page title::/H1. So the raw ASR
survives exactly where it is graph-visible, and a reader diffing the normalised entity against its own evidence sees
an unexplained mismatch. Wave #58 (BOTH pages): page 1 (`moltbook…`) normalises Moltbook/Molt Token/OpenClaw in the
structured fields yet the evidence keeps 'Maltbook' (assertions 3 & 12), 'malt token' + 'enroll the book' (assertion
9), and the title::/H1 carry 'Social Nework' (→ Network) from the source episode title; page 2 (`nano-banana-2…`)
keeps 'clawfication'/'clawfied' in the evidence quote. Distinct from PC-2 (which CORRECTS the structured entity — here
the entity IS correct, only the verbatim/title surface lags), from W-CANON/PC-7 (intra-page variant merge — here the
surfaces disagree because one is a raw ASR error, not a plausible variant), and from W-COINED (uncorroborable novel
noun — here the canonical entity is known). Proposed shape when it graduates: (a) evidence arm — leave the verbatim
quote UNALTERED but append an inline `[sic: Canonical]` annotation next to the garbled token (e.g. 'Maltbook [sic:
Moltbook]') so the mismatch is self-explaining; (b) title arm — when the source episode title carries an ASR
misspelling, keep title:: verbatim for provenance but emit a `normalised-title::` companion (or `[sic]`-annotate the
H1) so the misspelling is not the only graph-visible label. Extraction/verify-prompt line: "Never edit a verbatim
evidence quote or a source title to fix an ASR error; instead, where the normalised entity differs from the raw
surface, append `[sic: <canonical>]` inline (evidence) or emit a normalised-title:: companion (title) so the mismatch
is explicit." Guard: annotate, do NOT rewrite — the verbatim/provenance value of the quote and source title is the
whole point; the `[sic]` is additive. Overlaps PC-2's over-merge `[sic]` arm and may FOLD into PC-2's verify pass
rather than spawn a standalone block. Already at 2 occurrences (both pages this wave) but LOW/MEDIUM and PC-2-adjacent
→ graduates to a PROPOSED CHANGES block on a 3rd distinct page, OR immediately if the team lead adopts the inline
`[sic]`/normalised-title:: convention.

### W-DISAMBIG — annotator-inserted disambiguation guess contradicted by its own evidence (wave #56)
NEW kind, distinct from PC-2 (ASR MISHEARING of a token — corrected against a lexicon) and PC-5 (claim diverges
from its own evidence quote): here the extractor/annotator VOLUNTEERS a bracketed expansion to "resolve" an
ambiguous transcript token, and the guess is both internally contradictory and contradicted by the assertion's
OWN evidence note. Wave #56 (`more-new-ai-models-openai-drops-51-pro-and-codex-pro`): '[GPT-4o]' inserted for
the tokens '03' (assertion 5) and '01' (assertion 8) — but 'o1'/'o3' are OpenAI REASONING models, not GPT-4o,
so the mapping is wrong AND applied inconsistently; assertion 8's evidence note even says '01 is likely a
transcription error' while the body still asserts [GPT-4o]. Risk: a bracketed guess reads as editorial authority
and gets canonised as fact. Proposed shape when it graduates: in the verify pass, treat an annotator's
`[bracketed]` disambiguation as a HYPOTHESIS, not a fact — (a) require it be consistent with the assertion's own
evidence note; if the note flags the token as a likely error or the bracket contradicts it, DROP the bracket and
leave the raw token `[sic]`/unverified; (b) forbid mapping two distinct tokens ('01','03') to the SAME entity
without evidence; (c) verify the guessed entity against a model/product lexicon (o1/o3 ≠ GPT-4o) before writing.
Extraction-prompt line: "Do not invent a bracketed expansion for an ambiguous or mis-transcribed token; if you
cannot ground the referent in the evidence and a known-entity lexicon, leave the raw token and `[sic]`-flag it
rather than assert a guess — and never map two different tokens to one entity." Single page this wave → watch;
overlaps PC-2 (lexicon check) and PC-5 (evidence grounding) and may FOLD into their verify pass rather than spawn
a standalone block; graduates on a 2nd page with a bracketed disambiguation contradicted by its evidence.
RECURRENCE (wave #58, `moltbook…`): assertion 11's parenthetical 'Rocco (author of Rocco's Basilisk)' is an
annotator-volunteered expansion that invents authorship (Roko's Basilisk is a thought experiment, not an authored
work) AND rides a PC-2 mishearing ('Rocco' → pseudonymous 'Roko'). Reinforces arm (c) verify-the-guess-against-a-
lexicon, but the STRICT trigger (bracket contradicted by the page's OWN evidence note) is not met — the
contradiction is against world/lexicon fact, not the evidence — so kept a WATCH, advanced not graduated.

### W-COINED — single-source novel/coined proper noun unverifiable against the knowledge base (wave #52)
NEW kind at the intersection of PC-2 (ASR garble), PC-3 (single-source provenance) and PC-4 (speculative
volatility), but narrower than all three: a NOVEL proper noun (model/product/codename) that (a) resolves to no
known entity, (b) has a single transcript source, and (c) cannot be corroborated against the KB — yet may be
trusted downstream as a graph node. Wave #52 page 2 (`meet-your-ad-hoc-ai-licensing-regime`): GPT-5.6 / 'Terra',
'Mythos', 'GLM 5.2', 'Gemma 4', 'Fable 5' — all properly attributed with verbatim evidence (so acceptable as
SOURCED claims), but any could itself be an ASR mangle and the reviewer explicitly asked for a verification-
pending marker so consumers know these are single-source ASR-derived proper nouns. NB 'Mythos' already recurs
(this wave + an earlier wave ~L1362) — a 2nd occurrence of the SAME token accelerates graduation. Proposed shape
when it graduates: an `unverified:: true` (or reuse `source_authority:: single-source` + a `novel-entity` tag)
ledger marker so a coined proper noun is never minted as a wikilink target or entity page until corroborated;
`[sic]`/hold as a labelled string node instead. Distinct from PC-2 (which CORRECTS a known-entity garble) —
here there is no known entity to correct TO; distinct from PC-4 (speculative grades the CLAIM's shelf-life, not
the NAME's verifiability). Guard: mark, do NOT delete — the claim stays, only the entity-trust is withheld.
Graduates to a PROPOSED CHANGES block on a 2nd page requesting a verification-pending marker for an
uncorroborable coined proper noun (or a 2nd distinct recurrence of the same coined token).

### W-SATIRE — non-assertoric utterance (joke/satire) ingested as a sincere factual claim (wave #51)
NEW kind at the edge of PC-3/PC-4 but distinct from both: the utterance has a perfectly good PRIMARY source
(the tweeter) and is not fast-decaying (a tweet's text is fixed), so neither the provenance cap nor the
volatility flag naturally fires — yet the CONTENT is a joke/satire and should never have become a sincere
factual assertion. Wave #51 (`just-how-good-is-gpt-6-going-to-be`): the Jacobian-conjecture block
(fp 98f43e03924234b1) ingests a jokey tweet from 'Levante' (references the World Cup final) asserting a 1939
open conjecture is 'false', graded tier:1 conf:0.9 source-authority:primary volatility:durable. A weaker
adjacent cousin the same wave (page 2 assertion 1, Huang's promotional superlative at 0.95) is really PC-3
(confidence reflecting 'he said it' not truth), so it does NOT count toward this watch — W-SATIRE is
specifically NON-SINCERE speech acts (jokes, satire, parody), not sincere-but-unverified hype. Proposed shape
when it graduates: in the verify pass, detect register cues (overt joke framing, incongruous references,
known-satirical handles, reductio phrasing) and, on a non-assertoric utterance, force tier:3 speculative +
volatility:speculative and phrase as reported ('X joked that…') rather than asserting the content as fact;
do NOT delete it. Extraction-prompt line: "A joke, satirical, or parody utterance is not a factual claim even
when its author is a valid primary source — grade it tier-3 speculative and attribute the speech act, do not
assert its literal content." Guard: grade REGISTER not truth-value; a sincere-but-wrong claim is PC-5/PC-3
territory, not this. Single clean instance this wave → watch; graduates to a PROPOSED CHANGES block (or folds
into PC-3/PC-4 as a register sub-rule) on a 2nd page with a joke/satire graded as a sincere factual claim.
RECURRENCE (wave #58, `nano-banana-2…`): 'clawfication'/'clawfied' presents the host's joke that everyone is
getting 'Claude-ified' as a named industry TREND (register = joke, ingested as sincere fact). This is a 2nd
occurrence of the pattern but CONFOUNDED by an ASR error (unlike #51's clean Jacobian tweet), so PC-2 owns the
primary fix (correct/demote 'clawfication' → 'Claude-ified' pun) and W-SATIRE grades the residual tier-3
speculative. Advances the watch; a clean (non-ASR-confounded) 2nd instance clinches graduation.

### W-LINKGAP — zero-wikilink assertions on otherwise-linked pages (wave #43) — GRADUATED wave #46 → see PC-6
NEW kind, the INVERSE of PC-1: PC-1 removes generic/wrong-sense links, W-LINKGAP catches assertions that emit
NO [[wikilink]] at all while their page siblings are all linked, dropping the assertion out of graph
connectivity. Wave #43 (`how-to-use-opus-47-and-the-new-codex`): the L61 long-context-retrieval-regression
assertion (Opus 4.7 78.3%->32.2%) carries zero links where every other assertion links at least one entity;
it should anchor to e.g. [[Model Performance]] (+ arguably a Long-Context concept). Proposed shape when it
graduates: a link-coverage floor in the verify/link pass — if an assertion emits zero links but its prose
names a resolvable entity/concept, suggest the highest-precision link rather than leaving it orphaned. Guard:
respect PC-1 — do NOT satisfy the floor with a generic/wrong-sense link; an orphaned assertion is better than
a false edge. Graduates to a PROPOSED CHANGES block on a 2nd page with a zero-link assertion.
GRADUATED wave #46: page 2 (`is-ai-doom-going-out-of-style`) carried 6 zero-link assertions (L21 LinkedIn
jobs, L51 Stripe Atlas, L61/L71 unemployment, L91 Citadel postings, L121 vibe-shift, L141 Ezra Klein) with
clean resolvable targets available → written up as PC-6 below.

### W-CLAIMEV — claim-block-vs-evidence-block divergence (wave #22) — GRADUATED wave #33 → see PC-5
NEW defect kind: an assertion's headline CLAIM states a figure, metric, or attribution that its OWN
evidence:: block does not support — an extraction/summarisation error where the model paraphrases the claim
with a hallucinated/rounded value or wrong role rather than mirroring the evidence it cites. Wave #22 page 1
showed 3 numeric instances (claim '60% cheaper' vs evidence '32%'; claim '6% of tokens' vs evidence '11.4%
of dollars' — wrong number AND wrong metric; claim '87.9% on Terminal Bench' vs evidence '0.1% behind Fable')
plus 1 role instance (Tencent: claim 'its President' vs evidence 'CSO James Mitchell'). Distinct from PC-2
(entity-name garble) and PC-3 (provenance over-cap): here provenance and entity are fine, but the claim and
its own evidence numerically/attributively disagree. Proposed shape when it graduates: add a claim↔evidence
consistency check to the verify pass — for every assertion, the claim's stated figure/metric/role MUST be
grounded in a token of its evidence block; on divergence, rewrite the claim to match the evidence (or flag
for review), and extend the extraction prompt with "The claim must state the SAME number, metric, and
attributed role that its evidence block supports — never round, convert, or re-attribute." Single page this
wave (3+ internal instances) → watch; graduates to a PROPOSED CHANGES block (or folds into the verify pass)
on a 2nd page, matching PC-2/PC-3 graduation discipline.
GRADUATED wave #33: page 2 (`how-the-4-new-models…`) assertion 3 claims "collaboration between xAI and
Cursor" while its evidence:: says "SpaceX and Cursor" — the re-attribution arm, on a 2nd page → written up
as PC-5 below.

### W-HOST — host/speaker attribution normalisation for known-show pages (wave #21) — GRADUATED wave #59 → see PC-9
Podcast-evidence pages carry a recurring, resolvable source of structured-field entity garble: the SHOW HOST
is mis-heard into a fabricated person (wave #21: 'Matt Schmidt' on 3 assertions of an AI Daily Brief episode
whose host is Nathaniel Whittemore). Because the host recurs across every episode of a show, a per-show
known-host seed (AI Daily Brief → Nathaniel Whittemore) makes this the highest-precision, highest-blast
subset of the PC-2 source::-field arm: one wrong name mints a spurious entity across many episodes. Proposed
shape when it graduates: seed the PC-2 verify normalisation with a per-podcast host/regular-participant map
keyed off the episode's show name, applied to source:: before ledger write. Guard: only when the show is
confidently identified; `[sic]`-flag guests, not just hosts, when ambiguous. Graduates to (or folds into
PC-2 as) a PROPOSED CHANGES block on a 2nd page with a mis-attributed known-show host, matching PC-2/PC-3
graduation discipline. GRADUATED wave #59: `openai-declares-code-red` (AI Daily Brief) attributed 7 assertions'
source:: to 'Sam Alman' — the same show as wave #21, host still NLW, now with the episode's own SUBJECT cast as
its host. 2nd known-show page reached → see PC-9.

### W-EXTRAORD — extraordinary-magnitude claim resting on a single non-primary source (wave #59)
A claim whose magnitude is extraordinary (market-moving, superlative, global-scale) is graded tier-1/high-
confidence while resting on ONE non-primary source with no independent corroboration and reading as transcript
hyperbole/conflation. Wave #59 (`no-one-wins-this-ai-super-bowl`): 'a Claude Code plugin incident wiped billions
off global market value' at tier 1 / conf 0.85, sourced only to the host relaying it in passing (source-authority
secondary). Distinct from PC-3 (which grades and CAPS confidence by authority LABEL — here the label can be
correct yet a tier-1 extraordinary claim still over-reaches): W-EXTRAORD is a magnitude×authority INTERACTION
guard. Proposed shape when it graduates: when magnitude is extraordinary AND source_authority != primary AND no
corroboration, cap tier ≤2 (or attach a verification-needed flag) regardless of the raw confidence estimate.
Guard: applies to the CLAIM's real-world magnitude, not to strongly-worded but ordinary claims. Graduates on a
2nd page with an extraordinary tier-1 claim on a single non-primary source, matching PC-3/PC-4 discipline.

### W-DECAY — durability/decay ledger-field for snapshot facts (waves #16 + #18) — GRADUATED wave #27 → see PC-4
Recurring news-format property, not a per-page defect: podcast-evidence pages are largely short-half-life
launch/pre-launch news (benchmark %, leaderboard rank, MAU counts, release-timing odds) that is already stale
by ingest-date and should not accrete as durable graph knowledge. Wave #16 first flagged 'ephemeral-vs-durable'
and routed it downstream; wave #18 both pages independently asked for a decay/expire flag (page 1: mark the
tier-3 speculation cluster expire-eligible; page 2: a decay/volatility flag on snapshot facts — 650M MAU,
LMArena #1, specific benchmark %). Proposed shape when it graduates: an optional `volatility:: durable|
snapshot|speculative` (or `decay::`/`retention::`) ledger field set by the extraction/scoring pass, letting
downstream promote.py / queries distinguish durable wisdom from already-stale launch-day numbers. Guard: this
is orthogonal to PC-3 (provenance authority) — a claim can be well-sourced AND fast-decaying (LMArena #1 @0.90
is both). Do NOT down-confidence durable-but-secondary stats via this flag; volatility ≠ low confidence.
Graduates to a PROPOSED CHANGES block on a 3rd page (or a 2nd page requesting the field explicitly for a
DURABLE-vs-snapshot mix, matching the PC-3/PC-2 graduation discipline).

### W-CANON — intra-page entity-name canonicalisation (wave #41) — GRADUATED wave #51 → see PC-7
NEW kind, distinct from PC-2 (which corrects ASR MISHEARINGS): here every surface form is a plausible
spelling of the SAME entity, but they are inconsistent within a page and will FRAGMENT the eventual entity
page. Wave #41 (`how-to-use-claude-cowork-on-the-go`): one product written 'Claude Co-work Dispatch' /
'Claude Cowork' / 'Co-work' across assertions and 'Cowork' in the title; plus 'Open Claude' used as an
ungrounded proper-noun product/agent, never linked or defined. Proposed shape when it graduates: the
extraction/verify pass selects ONE canonical surface form per entity per page (highest-precision / official
spelling), rewrites all structured fields + the wikilink to it, and for a proper-noun that resolves to no
known entity, `[sic]`/unverified-flags it rather than emitting a phantom [[link]]. Guard: this is
canonicalisation, NOT correction — do not "fix" a genuinely distinct entity into a similar-looking one; only
merge variants that are the same referent on the page. Complements PC-2 (run PC-2 mishearing-correction
first, then W-CANON variant-merge). Graduates to a PROPOSED CHANGES block (or folds into the PC-2 verify
pass) on a 2nd page showing multi-variant naming of one entity, matching PC-2/PC-3 graduation discipline.
GRADUATED wave #51: page 2 (`jensen-huang-calls-openclaw…`) wrote the headline product split-token
'Open Claw' (assertions 1/3 + evidence) vs closed 'OpenClaw' (assertion 8 + title) — multi-variant naming of
one entity on a 2nd page → written up as PC-7 below.

### W-YEARINFER — hallucinated absolute date/year in the claim body, unsupported by evidence (wave #55) — GRADUATED wave #105 → see PC-11
GRADUATED on its pre-registered 2nd-page trigger at wave #105 (`the-rise-of-the-zero-human-company`, Pulsia
"reached a run rate of $1.5M in ARR by early 2025" against episode-date 2026-03-04 and an evidence quote that
says "beginning of February … 1.5 million today" with NO year — the exact same one-year-decrement fabrication
as the wave-#55 opener, internally contradicted by the page's own assertion 8 "November of last year" (=2025)).
Written up as PC-11 below. Original watch text retained for provenance:
NEW kind, adjacent to PC-5 but distinct: PC-5 catches a claim asserting a DIFFERENT figure than its evidence
shows; here the evidence contains NO date at all and the extractor INVENTS one, getting it wrong. Wave #55
(`autoresearch-agent-loops-and-the-future-of-work`): two tier-1 claims assert the Karpathy 'auto research' repo
and the /loop feature shipped 'March 7, 2025' when episode-date:: is 2026-03-10 and /loop is a live 2026
feature — a one-year fabrication, off by exactly the episode's own year, from evidence quotes that carry no
year. Proposed shape when it graduates: in the verify pass, flag any ABSOLUTE date/year in a claim body that is
not present in that claim's evidence:: block; anchor undated relative references ('last week', 'earlier this
year') to episode-date:: rather than inventing an absolute one, and never emit a year the evidence does not
contain. Extraction-prompt line: "Do not invent absolute dates/years. If the evidence gives no year, either omit
it or express the timing relative to episode-date:: — never guess a calendar year." Guard: this is anchor-to-
episode-date, NOT match-the-quote (PC-5) — the two run together (PC-5 grounds figures that DO appear; W-YEARINFER
handles temporal references that DON'T). Single page this wave → watch; graduates on a 2nd page with a claim-body
date/year absent from its evidence.

### W-CASE — resolving-but-non-canonical-casing wikilinks (wave #44) — GRADUATED wave #55 → see PC-8
GRADUATED on its pre-registered 2nd-page trigger at wave #55 (page 5 [[Enterprise Ai]] — the identical variant
that opened this watch — plus page 6 [[VERIFICATION]] reinforcing with the all-caps-word sub-case). Written up as
PC-8 below. Original watch text retained for provenance:
NEW kind, distinct from PC-1 and W-CANON: the link RESOLVES (target file exists) so PC-1's bad/generic-link
filter does not fire, and the mismatch is cross-graph (against the dominant casing convention), not intra-page
(W-CANON). Wave #44 (`in-defense-of-tokenmaxxing`): [[Enterprise Ai]] and [[National Ai Strategy]] use
lowercase 'Ai' where the graph's canonical convention is 'AI' (Enterprise AI Adoption, AI Infrastructure,
Agentic AI). These resolve to duplicate/variant stub pages that FRAGMENT the concept from its canonical node.
Proposed shape when it graduates: at link emission, normalise casing of known acronym tokens (AI, API, GPU,
LLM, ...) to their canonical graph form and retarget the link to the canonical page, merging the variant stub.
Guard: casing-normalise only known-acronym tokens against the canonical page index — do NOT title-case or
alter genuinely distinct page names. Complements PC-1 (subtracts bad links) and W-CANON (intra-page variant
merge). Graduates to a PROPOSED CHANGES block on a 2nd page showing a resolving non-canonical-casing link.

### W-COMPOUND — bundled multi-stat assertions (wave #45)
NEW kind, distinct from PC-5 (claim-vs-own-evidence divergence) and PC-2 (entity garble): the claim is
correctly spelled and may be fully evidence-grounded, but ONE ledger bullet carries TWO+ independent atomic
statistics that each deserve their own provenance and lifetime. Wave #45 (`introducing-maturity-maps`): fp
b1ca9f791398ac58 bundles '50% of AI agents are unmonitored' AND '88% of organisations have had security
incidents' into a single assertion. Bundled, neither stat can be independently verified, sourced, or
time-decayed — which defeats the per-assertion PC-3 (source_authority::) and PC-4 (volatility::) fields, since
two stats from different sources with different shelf-lives get one authority/volatility stamp. Proposed shape
when it graduates: the extraction pass emits ONE atomic claim per assertion; a bullet asserting a conjunction
of independent figures is split into N bullets, each re-carrying its own evidence::, source_authority::, and
volatility::. Guard: split only genuinely INDEPENDENT statistics — do NOT fragment a single coherent claim
whose parts are load-bearing together (a ratio, a before/after, a cause→effect pair). Complements PC-3/PC-4
(which grade per-assertion and therefore assume one claim per assertion). Graduates to a PROPOSED CHANGES block
(or folds into the extraction 'one atomic claim per assertion' rule) on a 2nd page showing a bundled-stat claim.

### W-UNITS — incommensurable-units comparison inside a claim (wave #47)
NEW kind, distinct from PC-5 (claim-vs-own-evidence divergence) and W-COMPOUND (bundled independent stats): a
single claim COMPARES two figures expressed in non-commensurable units and draws a magnitude verdict from the
raw numbers. Wave #47 (`is-kimi-k3-really-fable-class`): L41 prices Kimi K3 at '$5.40 per 1M tokens' against
'Deepseek V4 Pro ($0.04 per task)' and calls K3 'significantly higher' — mixing $/1M-tokens with $/task, an
apples-to-oranges comparison baked into the assertion's claim, not just the quote. The two figures may each be
faithfully extracted (so PC-5 grounding passes) yet the comparison is still invalid. Proposed shape when it
graduates: in the verify pass, when a claim asserts a </>/'higher'/'cheaper' relation between two quantities,
check their UNITS match; on mismatch, either normalise to a common unit (if convertible) or strip the
comparative verdict and keep the two figures side-by-side with their units. Extraction-prompt line: "Only
assert that one figure is higher/lower/cheaper than another when both are expressed in the SAME unit; never
compare $/token against $/task, %/benchmark-A against %/benchmark-B, etc." Guard: do NOT invent a conversion
the source does not support (e.g. tokens-per-task) — drop the verdict rather than fabricate a rate. Single page
this wave → watch; graduates to a PROPOSED CHANGES block on a 2nd page with an incommensurable-units comparison.

### W-PREDFACT — forward-looking rumour framed as a declarative snapshot fact (wave #47)
NEW kind at the intersection of PC-3 (provenance cap) and PC-4 (volatility): a FUTURE-dated, unconfirmed
prediction is written in declarative tense and stamped tier-1 / high-confidence as if it were an observed
fact. Wave #47 (`is-gpt-52-garlic-coming-this-week`): the GPT-5.2 'earmarked for release Tuesday December 9'
assertion is a same-week release RUMOUR sourced to a single secondary outlet (The Verge / Tom Warren), yet
carried at tier 1, conf 0.9 — the page's most perishable claim. The two applied fields SHOULD already catch
this: source_authority:: rumour must cap confidence (PC-3), and an unconfirmed future-dated release is
volatility:: speculative, not snapshot (PC-4) — so W-PREDFACT is really a calibration signal that the graders
under-apply both fields to declaratively-phrased predictions. Proposed shape when it graduates: in the verify/
scoring pass, detect forward-looking assertions (future date, 'will'/'set to'/'earmarked for release'), force
source_authority:: to rumour|single-source when provenance is a lone secondary outlet (capping confidence
below the tier-1 floor), and set volatility:: speculative. Extraction-prompt line: "A claim about a future or
unconfirmed event is a prediction, not a snapshot: cap its confidence to its weakest source, mark
volatility:: speculative, and phrase it as reported ('X reports Y is expected') rather than as fact." Guard:
this grades FRAMING + provenance, not truth — do not delete the prediction, just cap and hedge it. Single page
this wave → watch; substantially overlaps PC-3 + PC-4 calibration and may FOLD into them rather than spawn a
new block; graduates on a 2nd page with a prediction framed as a tier-1 snapshot fact.

### W-MODELVER — ASR-mangled model-version token that COLLIDES with another real model (wave #62)
NEW kind, the model-version analogue of PC-1(d) entity-COLLISION and W-DISAMBIG arm (c) (verify-guess-against-a-
model-lexicon), but in the CLAIM BODY and about version suffixes: an ASR error drops/mangles a model's version
suffix so the surviving token is ITSELF a valid name for a DIFFERENT model, silently conflating two real products.
A plain PC-2 speller does not fire (the token is already a plausible model name), so the two models merge unless a
model-version lexicon disambiguates. Wave #62 (`openai-preps-new-garlic-model`): L101 asserts no full-scale
training run since 'GPT-4.0 in May of the previous year' from evidence 'GPT40 in May of last year' — almost
certainly **GPT-4o** mis-transcribed as 'GPT-4.0' (a distinct model from GPT-4/GPT-4.0), leaving the last-
successful-training-run claim ambiguous. Distinct from PC-2 (which corrects a garble TO a known entity — here the
garble already looks like a valid one) and from W-CANON/PC-7 (intra-page variant merge of the SAME referent — here
the two surfaces are DIFFERENT referents). Proposed shape when it graduates: in the verify pass, resolve model-
version tokens against a model-version lexicon (GPT-4 / GPT-4o / GPT-4.0 / o1 / o3 … each distinct) before writing;
when an ASR-plausible version collides with another real model and the evidence timing/context disambiguates
(e.g. 'May', 'coding' → GPT-4o), normalise to the intended model, else `[sic]` and leave ambiguous rather than
guess. Extraction/verify-prompt line: "Treat model-version suffixes as load-bearing: GPT-4, GPT-4o and GPT-4.0 are
different models — resolve a mis-transcribed version against a model lexicon and never let an ASR-plausible token
silently merge two distinct models." Guard: disambiguate, do NOT invent — if neither evidence nor lexicon fixes the
referent, `[sic]` it. Single MEDIUM instance this wave → watch; substantially overlaps PC-2 body arm + W-DISAMBIG
arm (c) and may FOLD into their verify pass; graduates on a 2nd page with a model-version token colliding with a
distinct real model.

### W-SPLIT — single ASR surface conflating TWO distinct named entities → requires a SPLIT (wave #64)
NEW kind, the exact INVERSE of PC-7/W-CANON (which MERGE plausible variants of the SAME referent) and adjacent to
W-MODELVER (which disambiguates a version token colliding with another real MODEL — here the collision is at the
ENTITY level, a project vs a network). An ASR garble produces ONE surface form that is used for TWO mutually-
inconsistent referents on the page, both of which have DISTINCT canonical names (often attested in a sibling
ledger), so a plain speller/merger silently fuses two real-world entities into one phantom node — fragmenting the
graph and CONTRADICTING the neighbouring episode. Wave #64 (`openclaw-goes-to-openai`): **'Multibot'** is used for
BOTH (a) the renamed CLI project ClaudeBot→[Multibot]→OpenClaw (L51, canonical **Moltbot**) AND (b) the agent
social network that grew to 2.7M agents 'built on the OpenClaw platform' (L31, canonical **Moltbook**) — two
distinct entities attested under those names in the sibling `…moltbook…` ledger (episode 2026-01-31). The internal-
coherence symptom is diagnostic: the surface is simultaneously the renamed-platform AND a thing-built-on-the-
platform. Neither is wikilinked, so PC-1 never fires; PC-2 (correct-to-ONE-referent) and PC-7 (merge same-referent)
both mis-handle it because the fix is to SPLIT one surface into two. Proposed shape when it graduates: in the verify
pass, when one surface token is bound to two roles that are mutually inconsistent (renamer vs thing-built-on-it,
maker vs product, person vs org) OR resolves to two DISTINCT canonical entities in the KB/sibling ledgers, SPLIT it
into the two canonical entities per-assertion rather than canonicalise to one — keep the raw ASR quote intact in
evidence::, fix only the assertion entity names. Extraction/verify-prompt line: "If a single (possibly mis-heard)
name is used for two things that cannot be the same referent — different roles, or matching two distinct known
entities — do NOT merge them: split the surface into each canonical entity per assertion, grounding against sibling
ledgers, and `[sic]` rather than guess when only one side resolves." Guard (HARD): split ONLY when the two uses are
genuinely distinct referents (roles contradict, or both match separate canonical pages); never split a true single
entity that merely plays two roles in one narrative. Single HIGH instance this wave → watch (HIGH-on-2+ mints a
block); overlaps PC-2 body arm + W-MODELVER (entity-level collision) and reinforces the OpenClaw/Moltbook/Moltbot
first-class-entity-page suggestion; graduates on a 2nd page where one surface conflates two distinct canonical entities.

### W-UNDEREXTRACT — the page's titular/marquee claim is never extracted as an assertion (wave #69)
NEW kind, an EXTRACTION-RECALL defect orthogonal to every existing class: prior classes all grade an assertion that
WAS written (PC-1 links, PC-2 entities, PC-3 authority, PC-5 claim↔evidence, W-COMPOUND over-bundling). This is the
opposite failure — the single most important claim, the one the page is NAMED for, produces NO assertion at all, so
no downstream grader can catch it (there is nothing to grade). Wave #69
(`podcast-evidence___study-says-ai-can-automate-57-of-current-human-work-hours`): the page's ONE assertion captures a
secondary statistic (~80% per-task speedup) while the titular figure — **AI can automate 57% of current human work
hours** — is absent from the ledger entirely. The signal is cheap and near-diagnostic: the marquee number is IN THE
PAGE TITLE/slug yet matches no assertion body or evidence:: quote. Proposed shape when it graduates: after extraction,
run a title-coverage check — derive the salient quantity/claim from the page title (slugs carry it, e.g. '57-of-
current-human-work-hours') and assert that at least one emitted assertion's claim or evidence covers it; if none does,
emit the missing assertion (own evidence quote + own dedup fingerprint) or flag the page for re-extraction. Extraction-
prompt line: "The claim in the episode/page title is mandatory — always emit an assertion for the headline figure or
statement the title names, with its own evidence quote; never let a secondary stat be the only assertion on a page
whose title states a different marquee claim." Guard: only when the title states a concrete checkable claim/figure
(not a rhetorical/question title) and the source actually supports it — do NOT fabricate an assertion to satisfy a
title the transcript never substantiates. Single HIGH instance this wave → watch (HIGH-on-2+-pages mints a PROPOSED
CHANGES block); graduates on a 2nd page whose titular claim is missing from its ledger.

### W-MISATTRIB — source-inherited factual cross-entity attribution error (wave #70) — GRADUATED → PC-10 (wave #79, 2nd page)
NEW kind, distinct from W-SPLIT and PC-2 (both ASR-level): here BOTH entities are correctly named and correctly
spelled, but the RELATIONSHIP asserted between them is factually wrong — an ownership/agency clause inherited from
the transcript rather than a mishearing. Wave #70
(`podcast-evidence___surprise-elon-anthropic-team-up-reshapes-ai-race`): assertion 2 states "Anthropic secured a
partnership with SpaceX that grants it full use of xAI's Colossus 1 data center" — Colossus is **xAI's** data centre,
not SpaceX's; the clause conflates SpaceX and xAI (Elon-adjacency drove the merge). W-SPLIT is one surface hiding two
referents; PC-7/W-CANON merge variants of ONE referent; W-MISATTRIB keeps three correct entities but wires a false
edge between them (X grants/owns/controls Y where the real owner is Z). Proposed shape when it graduates: a verify-pass
relationship check on load-bearing "A {owns|grants|controls|acquired} B" clauses — resolve A and B against the entity
dictionary and flag when the asserted relation contradicts a known ownership fact (Colossus→xAI). Guard: only fire on
clauses with a checkable dictionary-backed relation; hedged/rumoured relations stay (route to PC-3 authority cap, not a
hard rewrite). Single MEDIUM instance this wave → watch (overlaps W-SPLIT + PC-2 body arm); graduates on a 2nd page
whose assertion wires a factually wrong relation between two correctly-named entities.

## PROPOSED CHANGES (awaiting team-lead application)

### PC-1 — generic/wrong-sense wikilink filter at link emission (SYSTEMIC: waves #2 + #3 + #4 + #6 + #7 + #8 + #9 + #10 + #11 + #12 + #13 + #14 + #15 + #17 + #18 + #19 + #21 + #22 + #23 + #24 + #25 + #26 + #27 + #28 + #29 + #30 + #32 + #33 + #34 + #35 + #36 + #42 + #46 + #49 + #52)
Sub-cases: (a) generic single-noun tokens; (b) bare/short-acronym homonyms; (c) (wave #8) —
resolves-correctly-but-wrong-granularity: a real multi-token entity linked at the wrong level
([[OpenAI API]] proxying the OpenAI organisation when an 'OpenAI Research Organisation' page exists);
(d) NEW (wave #9) — ASR/entity-COLLISION mislink: the surface token is itself a real entity but resolves
to an unrelated real page ('Digital Bridge'→[[Git]], Intel equity stake→[[NVIDIA H200]], off-Luxshare
manufacturing→[[Additive Manufacturing]], '90% of code' forecast→[[Conformal Prediction]]; wave #17:
Microsoft-Build-models→[[ROS]] (=Robot Operating System), token-economics→[[Ansi]] (=ANSI standards);
wave #19: Grok-Heavy-16→[[Grokking]] (=the delayed-generalisation phenomenon, not xAI's Grok), Apple-Watch→
[[Apple Vision Pro]] and AMD-chip-vendor→[[Amd Sev]] (=AMD SEV security feature) — same-brand
wrong-granularity/wrong-product sub-flavour; custom-silicon→[[ICO]] (=Initial Coin Offering); and
[[Agent2Agent Protocol (Google 2025)]] recurs as a cross-page spurious target on advertising + multimodal
claims (both wave-#19 pages); wave #23: [[BEIR Benchmark]] (=an IR retrieval benchmark) on a SWE-bench-Pro
CODING-eval score, [[ENS]] (=Ethereum Name Service) on a big-model/big-harness strategy claim, [[DEX]]
(=decentralised exchange) where 'DEX' meant developer experience, plus recurrences [[REST]] (=HTTP API style)
on a macro-'risk-off' claim and [[Curve]] (=Ethereum DeFi DEX/CRV) on an adoption-'cost curve' claim).
The min-
specificity + short-acronym guards do NOT catch (d) — only the ontology-match-against-host-claim-sense
arm rejects a target whose domain is incompatible with the claim's sense. Reject before emission when
the candidate page's ontology domain conflicts with the host block's topic.
(e) NEW (wave #32) — CROSS-DOMAIN-CLUSTER contamination: an AI/agents source page resolves an entire
coherent off-topic page CLUSTER (crypto/DeFi: [[DeFi]]/[[UMA]]/[[Base]]/[[Curve]]/[[Ethereum]]) rather
than scattered single homonyms — six such links tipped `how-people-actually-use-ai-agents` to the run's
first DEFECTIVE verdict. The catchable signal is coarser and cheaper than per-link ontology-match: gate on
SOURCE-PAGE domain vs TARGET-PAGE/CLUSTER domain — block a link when the target's domain (e.g. crypto/DeFi,
via ontology-bridge domain tags) conflicts with the source page's domain (AI/agents) UNLESS the host claim
text explicitly concerns the target domain (finance). This subsumes many (b)/(d) misses on AI-topic pages.
Fix (c) via the ontology-match arm: prefer the most specific existing entity page over a related-but-
broader one. Cross-wave repeat targets now include [[GAN]] (#3/#7/#8, most frequent).

Resolvable-but-wrong-sense wikilinks now confirmed on 3 pages (wave #2: [[Model]]/[[Base]]/
[[REST]]/[[Curve]]/[[Logic]]/[[Value]]/[[UMA]]/[[API]]; wave #3: [[URI]]/[[Privacy
Engineering]]/[[Raft]]/[[GAN]]/[[AI Upscaling and Super-Resolution]]/[[Safe]]; wave #4 —
acronym/homonym subclass: [[Rsa]]→RSA crypto, [[Tor]]→Tor anonymity net, [[REST]]→REST API,
plus generic [[performance]]/[[Dynamics]]/[[Process]]/[[Metrics]]; wave #7: [[Tor]]/[[URI]]/[[GAN]]
+ [[Neuroimaging]]×2; wave #18 — generic data-ontology tokens on finance/market claims:
[[Standardization Bodies]] on a Berkshire/Google stock buy, [[Data Governance]] on Burry's
fund liquidation, [[Metadata]] on a Palantir short-correction, [[Data Storage]]). Cross-wave repeats now confirmed: [[REST]] (#2,#4), [[Tor]] (#4,#7,#15),
[[URI]] (#3,#7), [[GAN]] (#3,#7,#8,#14). "Resolves" ≠ "correct" — these inject false graph edges. Three-part fix:
- ingest.py link emission: apply a min-specificity gate — drop links whose target is a
  single generic-noun token or a bare acronym UNLESS the surface form is multi-token or the
  target is ontology-matched (ontology-bridge). De-duplicate repeated links within one block
  (wave #3 L91 emitted [[GAN]] twice). Prefer emitting NO link over a wrong-sense link.
- source-vs-target-domain guard (added by wave #32): before emission, compare the SOURCE page's
  domain to the candidate TARGET page's ontology domain; drop the link when they conflict (e.g. an
  AI/agents source page linking into the crypto/DeFi cluster [[DeFi]]/[[UMA]]/[[Base]]/[[Curve]]/
  [[Ethereum]]) UNLESS the host claim text explicitly concerns the target domain. Coarser and cheaper
  than per-link ontology-match; catches wholesale cross-cluster contamination that produced the run's
  first DEFECTIVE verdict (wave #32 page 1).
- short-acronym entity-resolution guard (added by wave #4): suppress auto-linking to target
  pages whose title is a short single-token acronym (≤4 chars, e.g. Rsa/Tor/REST/URI/API/GAN)
  unless ontology-matched to the host claim's sense — these are the highest-collision-risk
  targets (crypto/network/protocol homonyms) and account for every wave-#4 HIGH finding.
- acronym-literal-token guard (added by wave #10): reject any acronym-titled target
  (Ros/Sec/ReAct/Tor/Gan/Uma) UNLESS the acronym string appears as a literal token in the
  block. Wave #10 page 1 showed the linker SYNTHESISING acronyms from expansions/substrings
  ('return on sales'→[[ROS]], 'secretive'→[[SEC]], 'reaction'→[[ReAct]]) — the acronym was
  never in the source. This is a cheap, high-precision pre-check that catches the expansion/
  substring class the semantic arm would otherwise have to reason about.
- extraction prompt line: "Only wikilink named entities or specific multi-word concepts.
  Never link generic single words (Model, Base, Safe, Value, Logic, Performance, Dynamics,
  Process, Metrics) or bare/short acronyms (Rsa, Tor, REST, URI, API, GAN, UMA) unless they
  name the specific entity meant in context. Prefer no link to a wrong-sense link. Never emit
  the same link twice in one block."
Do NOT modify ingest.py in the synthesiser role — team lead applies.

### PC-2 — entity-name normalisation in the verify pass (SYSTEMIC: structured-field + body ASR on waves #3 + #6 + #7 + #9 + #10 + #11 + #12 + #13 + #14 + #17 + #18 + #19 + #20 + #21 + #22 + #23 + #24 + #25 + #26 + #27 + #28 + #29 + #30 + #32 + #33 + #34 + #35 + #36 + #37 + #38 + #41 + #42 + #43 + #44 + #47 + #49 + #52 + #56 + #57 + #68 + #70)
Graduated from the ASR-structured-field watch after a 4th page (wave #9: source:: 'Ethan Malik' =
Ethan Mollick), the recurrence wave #7 flagged as the graduation trigger. Prior structured-field cases:
wave #7 source:: 'Mark Andreessen Horowitz' (merge artefact), waves #3/#6 person/org name garbles in
source::/metadata. ASR-corrupted proper nouns are hardening into STRUCTURED fields (source::, and
occasionally the assertion body), where they mint spurious distinct entities in the graph — a higher
blast radius than the same garble inside a verbatim quote.
Fix: add an entity-name normalisation step to the Perplexity verify pass, BEFORE ledger write:
- Scope: source:: field + assertion body ONLY. Never rewrite verbatim evidence:: quotes — instead
  emit a one-line note that the quote's garble ('Daario Amade'=Amodei, 'Lux share'=Luxshare) is an ASR
  artefact so downstream re-ingest does not treat it as a new entity.
- Mechanism: resolve each person/org surface form against the episode's known-participants list and the
  ontology/graph's existing entity pages; when a high-confidence canonical match exists, replace with the
  canonical name (Ethan Malik→Ethan Mollick, Mark Andreessen Horowitz→Marc Andreessen / Andreessen
  Horowitz per context); when ambiguous, keep and `[sic]`-flag rather than guess.
- Completeness/consistency (added by wave #20): normalise EVERY entity surface form in scope on a page,
  not a subset. Wave #20 fixed 'SWE-bench Pro' in the assertion body but left 'GDP Val'→'GDPval'
  un-normalised on the SAME page — partial normalisation mints an inconsistency the graph then has to
  reconcile. The pass must sweep all in-scope names per page, applying every high-confidence match.
- Known-people dictionary seed (accumulated from wave #10 + prior): Boris Churnney→Boris Cherny,
  Kenton Varta→Kenton Varda, Johnny Ives→Jony Ive, Lovefront→LoveFrom, Buco Capital/Buo→Buccocapital,
  Jamine Ball→Jamin Ball, Aaron Levy→Aaron Levie, Ethan Malik→Ethan Mollick, Daario Amade→Dario Amodei,
  V2 AIR&D→V2 AI R&D (wave #11). Wave #18 adds (verify): Michael Bur→Michael Burry (structured source:: +
  body, HIGH — investor entity truncation), Poly Market→Polymarket (two-word split), GPD 51/GPT51→GPT-5.1,
  Jeep D5 Pro→GPT-5 Pro, RKGI→ARC-AGI, Windsor→Windsurf, Anti-gravity→Antigravity (Google product,
  casing/product-name arm); `[sic]`-flag the ambiguous source:: names 'PO Shirano' (≈ Pietro/Peter Schirano)
  and 'Murdan Kland' rather than guess. Wave #19 adds (verify): Flo Crell→Flo Crivello (Lindy founder),
  Highong Securities→Haitong Securities, Almet Zavery→Amit Zavery (ServiceNow President), Chris Leane→Chris
  Lehane (OpenAI Chief Global Affairs Officer); `[sic]`-flag the ambiguous source:: names 'Chaien Xhiao',
  'Ted Suo', 'Shahipard', 'Nikolai Goness' and the 'Jeff Puh' analyst surname rather than guess. Wave #19
  reconfirms the structured-source-field class on two more pages (HIGH page 2 / MEDIUM page 1) with clean
  assertion-body entity names — the garble stayed in source:: labels + verbatim evidence, not the body.
  Wave #21 adds (verify): 'Matt Schmidt'→Nathaniel Whittemore (AI Daily Brief host, source:: field — see
  W-HOST watch: fabricated known-show host across 3 assertions, highest blast radius of this arm), 'Matt
  Schumer'→Matt Shumer (HyperWrite), 'Opus 46'→Opus 4.6, 'open claw'→OpenClaw (upgrades the wave-#12 'Open
  Claw' `[sic]` to a high-confidence match); unify 'Tenenholz'/'Tenenholtz'→one canonical across body +
  source:: on the same page (consistency arm); `[sic]`-flag 'Delupa' (ambiguous vendor, ≈ Dealogic).
  Wave #25 adds (verify): Mike Kger→Mike Krieger (Anthropic CPO, source:: across all 12 assertions + body —
  HIGH blast radius, MEDIUM severity), Boris Cherney→Boris Cherny (new surface form of the wave-#10 entry),
  Nat Ashkenazi→Anat Ashkenazi (Alphabet CFO; 'Nat' truncates 'Anat'); reconfirms 'Open Claw'/'Open Claws'→
  OpenClaw (wave-#21 match); `[sic]`-flag the ambiguous source:: name 'Alex E Mac' rather than guess.
  Wave #11 note: the ASR garble first landed mostly in ASSERTION BODIES
  (model names Kimik 3 / Mythos 5 / Chimera 3 / FableR 5.6, analyst handles Chris GPT / Molic Khan) rather
  than source:: — confirms the body arm of this PC is load-bearing. Keep ambiguous model-name garbles
  `[sic]`-flagged (do not guess a canonical); never normalise 'Fable' (genuine Claude-model codename).
  Wave #47 adds (verify, body arm, HIGH blast — all 12 assertions + evidence): 'Kimmy K3'→'Kimi K3'
  (Moonshot AI's Kimi line; the TITLE is ground truth — the mishearing hardened into the claim body across the
  whole page); `[sic]`-flag the ambiguous supporting names 'Deepu (coding benchmark)', 'Jee Bal', 'Ryan
  Feduick', 'Jukan', 'Divium', 'Sue Hail' (≈ Mixpanel founder), 'Theo Jaffy' and keep the verbatim-quote ASR
  tokens 'Opus 48'(≈ Opus 4.8) / 'GPT55'(≈ GPT-5.5) / '56 Soul' quarantined in evidence:: rather than seeding
  nodes. Reconfirms 'Fable' stays un-normalised (genuine Claude codename, appears correctly on this page).
  Wave #49 adds (verify, body arm): 'Sebastian Simikowski'→'Sebastian Siemiatkowski' AND 'Clara'→'Klarna'
  (double person+org garble, HIGH — one real referent was minting two phantom nodes; correct both together),
  'Devon Review'/'Devin Review'→Devin (Cognition's code-review product), 'Jared Sumner'→'Jarred Sumner' (Bun
  creator); `[sic]`-flag the unverifiable 'Boris Tain', "Todd Sonders (Broadloom)", and 'Peter Steinberg' (the
  suspect MAKER name of the already-canonical OpenClaw product — product resolves, maker does not).
- Coreference check (added by wave #12): when source:: and the assertion body name the same person/role,
  normalise both to ONE canonical form; a source::-vs-body divergence within a single assertion ('Kate
  Rauch' in source:: vs 'Roush' in body = Kate Rouse, OpenAI CMO) is a high-precision garble signal on its
  own. Dictionary add (verify): Kate Rauch/Roush→Kate Rouse. Codename garble 'Open Claw' (wave #12) →
  `[sic]`-flag for entity verification, do not guess.
- Non-person entity scope (added by wave #13): the body arm also covers benchmark / product / technique
  names, not just people/orgs — resolve these against the ontology/graph too. Dictionary add (verify):
  'agent decoding'→'agentic coding', 'GDP-valve'/'GDP vow'/'GDPvalve' (3rd variant, wave #17)/'GDP Val'
  (4th variant, wave #20, body arm)/'GDP eval'/'GDP eval benchmark' (5th variant, wave #21, body arm)→
  'GDPval', 'Promelli'→'Pomelli' (Google Labs,
  verify); `[sic]`-flag when ambiguous ('Mang 2'). Wave #13 note: these ASR garbles ALSO spawn hallucinated
  wikilinks ([[Beam Search Decoding]] from 'agent decoding') — correcting the entity name upstream removes
  the mislink at source, so run PC-2 body normalisation BEFORE PC-1 link emission.
- Maker/attribution arm (added by wave #22, SYSTEMIC — 2 pages incl. a HIGH): resolve a claimed product→maker
  (or model→lab) ATTRIBUTION against the known-entity graph, not just the name STRING. The garble here is the
  wrong COMPANY, not a mangled token: wave #22 attributed Grok (xAI's model) to 'SpaceX AI' on BOTH pages —
  an ASR/comprehension conflation of xAI with SpaceX (both Musk companies) that mints a spurious maker entity
  and mis-provenances the model. Fix: when the assertion names a product/model AND a maker, verify the maker
  against the graph's known product→maker edges; on a high-confidence mismatch, replace with the canonical
  maker (Grok→xAI, NOT 'SpaceX AI'/SpaceX) — 'SpaceX AI' is not an entity. Guard: `[sic]`-flag (do not guess)
  a dubious PARTNERSHIP attribution rather than silently correcting it (wave #22 'Cursor + xAI joint Grok Bot'
  is unverified). This arm runs alongside the name-garble arm; correct attribution BEFORE PC-1 link emission
  so the maker is not mis-linked. Dictionary/attribution seed: Grock→Grok, Grok maker = xAI (not SpaceX),
  Arcade Velo→Arkady Volozh (Nebius CEO); `[sic]`-flag 'Muark 1.2', 'Austin LeBron', 'GPT 5.6 Soul', 'Mythos'.
  Wave #49 extends the person↔org-role sub-arm: verify a claimed ROLE-HOLDER against the graph's known
  org→leader edges — 'Sourcegraph CEO Dan Adler' is wrong (Sourcegraph's CEO is Quinn Slack); replace with the
  canonical leader or `[sic]`-flag. Same mechanism as product→maker, applied to person→org-role attribution.
- Wave #29 adds: body-arm dictionary 'Deep Sue'→'DeepSWE' (SWE-style benchmark, verify — propagated into
  both assertion body AND verbatim evidence at 59.3%; correct the structured claim, `[sic]`-flag if no
  high-confidence canonical match, evidence-guard holds on the quote).
- Wave #23 adds: body-arm dictionary 'Blitzcy'→'Blitzy' (agentic-coding startup, high-confidence);
  `[sic]`-flag GPT-5.6 codenames 'Luna'/'Terra'/'Soul' (Soul recurs from #22) and platform 'Funda'
  (unverifiable — do not guess); source::-arm verify/lower-confidence 'Nicolas Charrier (LangChain)' (no
  public-leadership match) and 'Kyle (humanlayer.dev)'. Body date-TOKEN sub-arm (new, wave #23): sanity-check
  date tokens inside the assertion PROSE against episode-date — 'Cursor 3 … early April 2025' on a 2026-04-15
  episode is a likely ASR year garble (2025→2026); correct or `[sic]`-flag. This is distinct from the
  claim-date:: metadata field (which is correct on these pages) — it covers years/dates baked into claim text.
- Casing arm (added by wave #17): canonicalise proper-noun CASING when a high-confidence match exists —
  '[[Enterprise Ai]]'→'[[Enterprise AI]]'. The mis-cased target may already resolve to its own page, so this
  also prevents casing-variant page duplication in the graph. Low-severity; same high-confidence guard.
- Guard: only correct when confidence is high; do not "normalise" a genuinely distinct entity onto a
  similar-sounding known one (avoid over-merging).
Do NOT modify ingest.py / the verify prompt in the synthesiser role — team lead applies.

### PC-3 — provenance-grade cap on tier/confidence in the verify/scoring pass (SYSTEMIC: waves #7 + #8 + #12 + #15 + #16 + #20 + #23 + #25 + #29 + #31 + #32 + #33 + #35 + #36 + #37 + #38 + #43 + #56 + #57 + #68 + #69 + #70)
Graduated from the provenance-confidence calibration watch on its pre-registered 3rd page (wave #12);
LOW-severity graduation via the watch's own 3-page trigger, not the HIGH-severity 2+-page rule. Common
gap across all three pages: the STRENGTH of a claim's provenance is not propagating into its tier/
confidence. Three flavours observed: (#7) numeric-implausibility carried at tier-1/0.98 (445% YoY, 56%→86%
margin); (#8) single-source/unshipped-future rumour at tier-1/0.85; (#15) a single-X-post claim with a
likely-false employment premise (Karpathy-at-Anthropic) at tier-1/0.90; (#12) host-relayed SECONDARY
statistics (Edelman/Pew/Gallup) at tier-1/0.95 and a hedged host superlative ('I believe', 'most expensive
… of all time') at 0.85; (#16) a whole page of host-RELAYED single-source news (The Information / DeepSeek
paper / AWS / Anthropic, all 'reported by AI Daily Brief host') at tier-1/0.90-0.95, incl. the unverified
'entire signed-out base on ~100 GPUs' at 0.95 and '99% classifier success'; (#23) secondary-relay +
numeric-OUTLIER macro claims at tier-1/0.9-0.95 on vague sourcing — a $30B-equity/$120B-position fund
liquidation ('Financial Times / General Reporting'; the real Situational Awareness fund is ~$1.5B-scale, so
the magnitude is extraordinary and loosely sourced) and a Kospi '40% drop, worst in history' ('Market Data /
Host Analysis'). All ride confidence too high for their provenance.
Fix: in the verify/scoring pass, before ledger write, cap tier and confidence by a provenance grade:
- Grade each assertion's source authority: primary (named primary source / direct data) | secondary
  (host relays a third-party stat without the primary) | first-party-marketing (vendor self-reported
  launch-day benchmark numbers relayed by a host on release day, no independent verification — wave #20:
  OpenAI's GPT-5.2 SWE-bench Pro/GDPval/hallucination figures at 0.95) | single-source/anonymous/leak |
  future/unshipped rumour | hedged (speaker hedges: 'I believe', 'I think', 'a sense that') |
  numeric-outlier (implausible magnitude vs base rates). Third-party benchmark authorities (e.g. ARC Prize
  for ARC-AGI) are NOT first-party-marketing and may keep high confidence.
- Caps: secondary-relay / first-party-marketing unverified → confidence ≤~0.85-0.88 (not 0.95) and flag
  for third-party corroboration; single-source/anonymous/leak/future → tier ≤2 and confidence ≤~0.6; hedged-language →
  down-weight and never harden the hedge into a fact in the assertion body (see the wave-#9 hype-overreach
  watch — same failure of a hedge becoming a hard claim); numeric-outlier → auto-down-confidence + flag
  for verify rather than carry at 0.9+.
- Ledger-field option (folds in the wave-#1 proposal): add a `source-authority:: primary|secondary|
  single-source|rumour|hedged` field alongside tier::/confidence::, set by the same grader, so the cap is
  auditable and downstream consumers can filter. The extraction/verify prompt asks the model to classify
  source authority alongside tier/confidence.
- Guard: do NOT drop durable secondary stats — down-CONFIDENCE and flag, keep the assertion (the 2026
  trust-stat cluster is durable wisdom; only its 0.95 was wrong).
Do NOT modify ingest.py / the verify prompt in the synthesiser role — team lead applies.

### PC-4 — volatility/decay ledger-field for snapshot vs durable assertions (GRADUATED from W-DECAY: waves #16 + #18 + #27 + #30 + #36 + #70)
Graduated on W-DECAY's pre-registered trigger: a 3rd page flagging the ephemeral-news property, this one
(wave #27) explicitly requesting the field for a page with a strong DURABLE-vs-snapshot MIX. Podcast-evidence
pages interleave durable wisdom (token-price deflation $17→$2, GPU rental yields into year 9, 1,200×/30-
quadrillion agentic-token growth) with short-half-life launch/news snapshots (AWS 20% GPU hike, Micron price
moves, Anthropic-Amazon renegotiation, Meta Codex ban, Warner draft bill, MAU counts, leaderboard ranks,
benchmark %) that are already stale by ingest-date and should not accrete as durable graph knowledge.
Fix: in the extraction/scoring pass, before ledger write, classify and stamp each assertion with a
volatility grade:
- Add ledger field `volatility:: durable | snapshot | speculative` (equivalently `decay::`/`retention::`)
  alongside tier::/confidence::, set by the same grader. `durable` = trend/structural insight that outlives
  the episode; `snapshot` = a dated fact (price, rank, MAU, launch %, funding round) stale by ingest-date;
  `speculative` = unshipped/future/opinion.
- Extraction/verify prompt gains one line: "Classify each assertion's volatility — durable (structural
  trend/insight) vs snapshot (a dated figure/rank/price/count stale within weeks) vs speculative — alongside
  tier and confidence."
- Downstream: promote.py / queries filter or time-decay `snapshot` assertions so launch-day numbers do not
  compete with durable wisdom for candidacy; `durable` assertions are exempt from decay weighting.
- Guard (ORTHOGONAL to PC-3): volatility ≠ confidence. A claim can be well-sourced AND fast-decaying
  (LMArena #1 @0.90 is both). Do NOT down-CONFIDENCE a durable-but-secondary stat via this flag, and do NOT
  up-confidence a durable assertion because it is durable. PC-3 grades PROVENANCE; PC-4 grades SHELF-LIFE.
Do NOT modify ingest.py / the extraction/verify prompt in the synthesiser role — team lead applies.

### PC-5 — claim↔evidence consistency check in the verify pass (GRADUATED from W-CLAIMEV: waves #22 + #33 + #57 + #68)
Graduated on W-CLAIMEV's pre-registered 2nd-page trigger. A recurring extraction/summarisation error: an
assertion's headline CLAIM states a figure, metric, or ATTRIBUTION that its OWN evidence:: block does not
support — the model paraphrases with a hallucinated/rounded value or re-attributes to a different entity
rather than mirroring the evidence it cites. Distinct from PC-2 (entity-name garble — here both names are
correctly spelled) and PC-3 (provenance over-cap — here provenance is fine): the claim and its own evidence
simply disagree. Two flavours observed:
- Numeric/metric (wave #22 page 1, 3 instances): claim '60% cheaper' vs evidence '32%'; claim '6% of tokens'
  vs evidence '11.4% of dollars' (wrong number AND wrong metric); claim '87.9% on Terminal Bench' vs
  evidence '0.1% behind Fable'. Plus a role instance (Tencent: claim 'its President' vs evidence 'CSO James
  Mitchell').
- Re-attribution (wave #33 page 2, tier-1 @0.95): claim 'the first model resulting from the collaboration
  between xAI and Cursor' vs evidence 'the first output of the new collaboration between SpaceX and Cursor'
  — SpaceX silently re-attributed to xAI. NB this is the INVERSE of PC-2's maker/attribution arm (wave #22,
  where the CLAIM carried the wrong maker 'SpaceX AI'): here the claim's maker may be right but it diverges
  from its cited evidence, so the check is claim-vs-evidence, not claim-vs-graph. Both are the same
  xAI/SpaceX (Musk-company) conflation → run PC-2 maker normalisation and PC-5 evidence-grounding together,
  and `[sic]`-flag the underlying partnership if unverifiable rather than silently pick a side.
Fix: in the verify pass, for every assertion, require that the claim's stated figure/metric/role/attribution
be grounded in a token of its evidence:: block; on divergence, rewrite the claim to MATCH the evidence (or
flag for review) and down-confidence when the divergence undermines a tier-1 figure. Extend the extraction
prompt: "The claim must state the SAME number, metric, attributed role, and named entity that its evidence
block supports — never round, convert, or re-attribute. If the evidence is itself garbled/ambiguous, `[sic]`-
flag rather than invent a corrected value." Guard: this check trusts the EVIDENCE quote over the claim only
for grounding; where the evidence is a known ASR garble (PC-2 territory), correct the entity first (PC-2),
then ground the claim against the corrected evidence.
Do NOT modify ingest.py / the verify prompt in the synthesiser role — team lead applies.

### PC-6 — link-coverage floor in the verify/link pass (GRADUATED from W-LINKGAP: waves #43 + #46 + #52 + #56 + #57 + #68 + #69 + #70)
Graduated on W-LINKGAP's pre-registered 2nd-page trigger (LOW-severity watch-graduation, matching the
PC-4/PC-5 discipline — NOT the HIGH-on-2+ rule). The INVERSE of PC-1: PC-1 SUBTRACTS generic/wrong-sense
links; PC-6 catches assertions that emit ZERO [[wikilink]]s while their page siblings are all linked and their
own prose names a resolvable entity, dropping the assertion out of graph connectivity. Wave #43
(`how-to-use-opus-47-and-the-new-codex`): the L61 long-context-retrieval-regression assertion (Opus 4.7
78.3%→32.2%) carried zero links where every sibling linked ≥1 entity. Wave #46 (`is-ai-doom-going-out-of-style`):
6 zero-link assertions (L21 LinkedIn jobs, L51 Stripe Atlas, L61/L71 unemployment, L91 Citadel postings,
L121 vibe-shift, L141 Ezra Klein) with clean resolvable targets (Stripe, labour-market/unemployment,
OpenAI-as-organisation) sitting unlinked.
Fix: add a link-coverage floor to the verify/link pass, AFTER PC-1's subtractive gate — for every assertion
that emits zero links, if its prose names a resolvable entity/concept, suggest the SINGLE highest-precision
link rather than leaving it orphaned. Shape:
- Trigger only on assertions with zero emitted links (do not top-up already-linked assertions).
- Candidate generation: run the assertion prose through the same entity/ontology resolver PC-1 uses; take the
  highest-precision match (specific named entity/organisation/concept page), one link, not many.
- Emit the link ONLY if it clears PC-1's own guards (not generic-noun/short-acronym, ontology-sense compatible,
  source↔target domain compatible). If no candidate clears PC-1, leave the assertion orphaned.
- Extraction-prompt line: "Every assertion should anchor to at least one specific [[entity]] its prose names;
  if none is resolvable, leave it unlinked rather than inventing a generic anchor."
- Guard (HARD, respects PC-1): an orphaned assertion is strictly better than a false edge — NEVER satisfy the
  floor with a generic or wrong-sense link. PC-6 (add-a-precise-link) and PC-1 (drop-a-bad-link) are run in
  that order and must never fight: PC-1 has veto over any link PC-6 proposes.
- Interaction: PC-6 improves graph connectivity (recall of edges); PC-1 protects precision. The floor is a
  best-effort suggestion, not a mandate — pages legitimately carry some unlinkable assertions (pure opinion,
  hedged forecasts) and those stay orphaned by design.
Do NOT modify ingest.py / the verify prompt in the synthesiser role — team lead applies.

### PC-7 — intra-page entity-name canonicalisation in the verify pass (GRADUATED from W-CANON: waves #41 + #51)
Graduated on W-CANON's pre-registered 2nd-page trigger. Distinct from PC-2 (which corrects ASR MISHEARINGS of
a wrong-sounding token) and W-CASE/PC-1 (link-level fixes): here every surface form is a PLAUSIBLE spelling of
the SAME entity — the tokens are individually correct — but they are inconsistent WITHIN a page and will
fragment the eventual entity page. Two pages:
- Wave #41 (`how-to-use-claude-cowork-on-the-go`): one product written 'Claude Co-work Dispatch' / 'Claude
  Cowork' / 'Co-work' across assertions and 'Cowork' in the title; plus 'Open Claude' used as an ungrounded
  proper-noun product/agent, never linked or defined.
- Wave #51 (`jensen-huang-calls-openclaw-most-important-software-release-ever`): the headline product written
  split-token 'Open Claw' (assertions 1, 3 + evidence quotes) vs closed-compound 'OpenClaw' (assertion 8 +
  title). Same referent (confirmed: 'Open Claw'→OpenClaw already a PC-2 codename seed from wave #12). Compounded
  by a zero-link on the canonical form — OpenClaw is the page's headline subject yet carries no [[wikilink]].
Fix: the extraction/verify pass selects ONE canonical surface form per entity per page (highest-precision /
official spelling), rewrites all structured fields + the wikilink to it; for a proper-noun that resolves to no
known entity, `[sic]`/unverified-flag it rather than emit a phantom [[link]]. Extraction-prompt line: "Use ONE
consistent spelling per named entity across a page's title, assertions, and structured fields; if two surface
forms denote the same referent, canonicalise to the official/highest-precision spelling before writing the
ledger." Ordering (HARD): run PC-2 mishearing-correction FIRST (fix genuine garbles), THEN PC-7 variant-merge
(unify plausible spellings), THEN PC-6/PC-1 linking (anchor the CANONICAL form — e.g. [[OpenClaw]], never
[[Open Claw]] — through PC-1's guards). Guard: canonicalisation, NOT correction — never "fix" a genuinely
distinct entity into a similar-looking one; only merge variants that are the same referent on the page.
Do NOT modify ingest.py / the verify prompt in the synthesiser role — team lead applies.

### PC-8 — canonical-casing normalisation of resolving wikilinks (GRADUATED from W-CASE: waves #44 + #55; reinforced #65 + #68 + #70)
Graduated on W-CASE's pre-registered 2nd-page trigger (LOW-severity watch-graduation, matching the PC-4..PC-7
discipline — NOT the HIGH-on-2+ rule). Distinct from PC-1 (which SUBTRACTS bad/unresolvable/generic links —
here the link RESOLVES, so PC-1 never fires) and from PC-7 (intra-page variant merge — here the mismatch is
against the cross-graph canonical casing convention). Two pages:
- Wave #44 (`in-defense-of-tokenmaxxing`): [[Enterprise Ai]] and [[National Ai Strategy]] use lowercase 'Ai'
  where the graph convention is 'AI' (Enterprise AI Adoption, AI Infrastructure, Agentic AI).
- Wave #55: [[Enterprise Ai]] recurs on `can-open-models-solve-corporate-ai-washing` (identical variant), and
  `can-todays-ai-replace-12-of-work` carries [[VERIFICATION]] (all-caps) where canonical is [[Verification]] —
  the all-caps-word sub-case. Both RESOLVE to variant/stub pages that FRAGMENT the concept from its canonical node.
Fix: at link emission, normalise the casing of the wikilink target against the canonical page index and retarget
to the canonical page, merging the variant stub. Two sub-rules:
- (a) Known-acronym tokens (AI, API, GPU, LLM, TPU, ...) -> their canonical uppercase graph form ('Enterprise Ai'
  -> 'Enterprise AI').
- (b) An all-caps rendering of an ordinary word whose title-case form IS an existing canonical page ('VERIFICATION'
  -> 'Verification') -> retarget to the canonical page.
Extraction/verify-prompt line: "Emit wikilink targets in the graph's canonical casing: uppercase known acronyms
(AI/API/GPU/LLM/TPU) and match the existing canonical page's casing for ordinary words; never mint a
casing-variant stub of a page that already exists."
Ordering: run AFTER PC-1 (bad-link subtraction) and PC-7 (intra-page variant merge), and BEFORE PC-6 (link-
coverage floor anchors the CANONICAL-cased form). Guard (HARD): casing-normalise ONLY when the normalised form
matches an EXISTING canonical page in the index and the current target is a stub/variant — do NOT blind-title-case
or alter a genuinely distinct page name, and do NOT uppercase a token that is not a known acronym. When in doubt,
leave the resolving link as-is rather than risk retargeting to the wrong page.
Do NOT modify ingest.py / the verify prompt in the synthesiser role — team lead applies.

### PC-9 — per-show host/participant attribution seed for the source:: field (GRADUATED from W-HOST: waves #21 + #59)
Graduated on W-HOST's pre-registered 2nd-known-show-page trigger. The AI Daily Brief host is mis-heard/mis-
attributed in the source:: field on BOTH pages: wave #21 fabricated 'Matt Schmidt' on 3 assertions; wave #59
(`openai-declares-code-red`) stamped 'Sam Alman' on 7 assertions (lines 14, 55, 75, 84, 94, 104, 116) — worse,
because 'Sam Alman' is a garble of Sam Altman, the episode's SUBJECT, so host-analysis assertions are attributed
to the person being reported on (line 14 'The Information (reported by Sam Alman)' is self-contradictory). One
wrong host name mints a spurious entity across every assertion of a page and, because the host recurs, across
every episode of a show — the highest-blast subset of PC-2's source:: arm.
Fix: maintain a per-podcast host/regular-participant map keyed off the episode's show name and apply it in the
PC-2 verify pass to the source:: field before ledger write. Seed: **AI Daily Brief → Nathaniel Whittemore (NLW)**.
Two sub-rules:
- (a) When the show is confidently identified, normalise a host-analysis / host-narration source:: to the known
  host, correcting ASR garbles of that host's name (Matt Schmidt / Sam Alman → the mapped host).
- (b) Separate HOST from SUBJECT: an assertion whose CONTENT is about a named individual (e.g. Altman's memo) must
  not attribute the host-narration channel to that individual — the source:: is the host relaying, the subject is
  the claim's topic. 'The Information (reported by <host>)' framing is only valid where the outlet, not the host,
  is the reporter — reserve 'reported by' for the actual reporting source.
Extraction/verify-prompt line: "For a known-show episode, attribute host narration/analysis to the show's known
host from the per-show map (AI Daily Brief → Nathaniel Whittemore); never attribute the host channel to the
episode's subject, and correct ASR garbles of the host's name against the map before writing source::."
Ordering: run as part of the PC-2 source:: arm (BEFORE PC-3 authority grading, since the corrected attribution
changes the authority label). Guard (HARD): only when the show is confidently identified; `[sic]`-flag GUESTS
(not just hosts) when the speaker is ambiguous — do NOT force a guest quote onto the host, and do NOT invent a
host for an unidentified show.
Do NOT modify ingest.py / the verify prompt in the synthesiser role — team lead applies.

### PC-10 — source-inherited factual cross-entity relationship check (GRADUATED from W-MISATTRIB: waves #70 + #79)
Graduated on W-MISATTRIB's pre-registered 2nd-page trigger (an assertion wiring a factually wrong relation between
two correctly-named entities). BOTH pages are the SAME Colossus/xAI/Elon-adjacency conflation: wave #70
(`surprise-elon-anthropic-team-up-reshapes-ai-race`) asserted "Anthropic … full use of **xAI's** Colossus 1 data
center … partnership with **SpaceX**"; wave #79 (`the-ai-token-shortage-begins`, L71) asserts "**SpaceX's AI
division (XAI)**" and attributes Colossus 1/2 to SpaceX. In both, Colossus is xAI's and **xAI is a standalone Elon
Musk company, NOT a division of SpaceX** — the transcript's Elon-adjacency drives a false ownership/containment edge
between three correctly-named entities. This is NOT ASR (PC-2) and NOT a single-surface conflation (W-SPLIT): the
entities are correctly named/spelled but the RELATION is factually wrong, inherited verbatim from the transcript.
Fix: a verify-pass relationship check on load-bearing "A {owns | grants | controls | acquired | is-a-division-of}
B" clauses — resolve A and B against the entity dictionary and flag/annotate when the asserted relation contradicts
a known ownership fact. Seed facts: **Colossus 1 / Colossus 2 → xAI** (not SpaceX); **xAI ⟂ SpaceX** (sibling Musk
companies, neither is a division of the other). Two sub-rules:
- (a) When both operands resolve to dictionary entities AND the asserted relation contradicts a stored ownership/
  parent fact, rewrite to the correct owner (Colossus → xAI) or `[sic]`-flag + verification-needed, never silently
  enshrine the false edge.
- (b) NEVER collapse two sibling entities into a parent/child ("X's division Y") on Elon-adjacency (or any shared-
  founder) heuristic alone — SpaceX, xAI, Tesla, Neuralink, X Corp are distinct legal entities.
Guard (HARD): only fire on clauses with a checkable dictionary-backed relation; hedged/rumoured relations stay and
route to PC-3 authority cap, not a hard rewrite. Ordering: run after PC-2 (names must be correct before relations
can be checked), before PC-3 (a corrected/flagged relation feeds the authority label). This is the exact INVERSE of
PC-7/W-CANON (which MERGE plausible variants of ONE referent) and distinct from W-SPLIT (one ASR surface hiding two
referents). No xAI page exists in the graph (only the unrelated `xDai.md`) — pair the fix with a minted [[xAI]] node
(PC-6) so the corrected owner has a link target.
Do NOT modify ingest.py / the verify prompt in the synthesiser role — team lead applies.

### PC-11 — anchor-to-episode-date guard for absolute dates/years in claim bodies (GRADUATED from W-YEARINFER: waves #55 + #105)
Graduated on W-YEARINFER's pre-registered 2nd-page trigger (a claim body carrying an absolute year that is ABSENT
from that claim's evidence and off by exactly the episode's own year). Both instances are the identical one-year-
decrement fabrication: wave #55 (`autoresearch-agent-loops-and-the-future-of-work`) had Karpathy's repo / Boris
Cherny's /loop "shipped March 7, **2025**" against episode-date 2026-03-10 with no year in the evidence; wave #105
(`the-rise-of-the-zero-human-company`, assertion 6) has Pulsia "reached a run rate of $1.5M in ARR by **early
2025**" against episode-date 2026-03-04, an evidence quote of "beginning of February … 1.5 million today" (no
year), AND an internal contradiction with the same page's assertion 8 ("started building in **November of last
year**" = 2025 relative to the 2026 episode). In both, the extractor invented a calendar year one below the
episode year. This is NOT PC-5 (there is no divergent FIGURE in the evidence to match against — the evidence has
no year at all) and NOT Refinement #1 (which dates the ledger `claim-date::` field, not text inside the claim body).
Fix, in the verify pass: flag any ABSOLUTE date/year appearing in a claim BODY that is not present in that claim's
`evidence::` block; when the timing is only implied by an undated relative reference ("today", "last week",
"earlier this year", "by early <year>"), anchor it to `episode-date::` rather than emit an invented absolute year,
and never write a calendar year the evidence does not contain. Add a cross-assertion consistency check: two claims
on one page whose relative-time expressions resolve to DIFFERENT absolute years (assertion 6 "early 2025" vs
assertion 8 "last year"=2025-from-2026) must reconcile against `episode-date::`. Extraction-prompt line: "Do not
invent absolute dates/years. If the evidence gives no year, either omit it or express the timing relative to
episode-date:: — never guess a calendar year, and never decrement the episode year by default." Guard: this is
anchor-to-episode-date, NOT match-the-quote (PC-5) — the two run together (PC-5 grounds figures that DO appear in
evidence; PC-11 handles temporal references that do NOT). Ordering: independent of PC-2/PC-10; runs in the same
claim↔evidence verify sweep as PC-5.
Do NOT modify ingest.py / the verify prompt in the synthesiser role — team lead applies.

### 2026-08-24 ~09:45 — Refinements #2–#6 APPLIED (team lead), from graduated PC-1..PC-5
Applied to ingest.py (live; takes effect next episode — each run reloads the module):
- **PC-1 (wikilink specificity gate)** — `_resolve_ontology_term`: a single generic noun or
  bare acronym (`_LINK_STOPWORDS` + len<=4, non-multi-token) is refused OUTRIGHT, even when an
  exact same-slug page exists; substring matches are now directional (term must be inside the
  page slug) and must cover >=50% of it, so 'gan' can't claim 'organisation'. Unit-tested:
  GAN/Model/API/gan -> None; Nvidia/Human Computer Interaction/Large Language Models -> resolve.
  Plus extraction-prompt line: prefer specific named entities; a wrong-sense link is worse than none.
- **PC-3 (source authority)** — new `source_authority:: primary|secondary|single-source|rumour|hedged`
  extraction field + ledger field; confidence must not exceed authority. Grades PROVENANCE.
- **PC-4 (volatility)** — new `volatility:: durable|snapshot|speculative` extraction field + ledger
  field; independent of confidence. Grades SHELF-LIFE. Lets promote.py time-decay snapshots so
  launch-day numbers don't compete with durable wisdom for candidacy.
- **PC-5 (claim↔evidence grounding)** — extraction prompt: the claim must state the SAME
  number/metric/role/entity its evidence supports; never round/convert/re-attribute; [sic] over invent.
- Refinement #1 (episode-date claim dating) already live and verified on 2 post-fix pages.
DEFERRED batch job: re-date + re-link pre-fix backlog pages (episodes 1..N before this commit) —
run after backlog drains, using episode-date:: and the new gate.
Not yet applied (needs promote.py work, not ingest.py): PC-4 downstream decay-weighting in candidacy.

### 2026-08-24 — Review wave #65 (synthesiser)
Pages reviewed (1):
- `podcast-evidence___opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war.md` (verdict GOOD,
  episode 2026-02-06)

STRUCTURAL OUTCOME: all findings LOW, single page, verdict GOOD → **no new PROPOSED CHANGES block owed** (the
HIGH-on-2+-pages rule mints none). Every defect maps to an already-graduated pattern (PC-8, PC-2 source arm,
PC-6, PC-5-adjacent) — all REINFORCED, none new, no new watch opened. **4th consecutive clean claim-date
positive control** (#62/#63/#64/#65): episode-date:: 2026-02-06 populated, all claim-date:: == 2026-02-06 (NOT
ingest-date 2026-08-24) → Refinement #1 HOLDS. Ledger hygiene is exemplary: 14/14 assertions carry a unique
`assertion-fp` dedup marker and sane tier/confidence/source-authority/volatility (benchmark scores → snapshot,
capabilities → durable) — a clean positive control for the dedup arm + PC-3/PC-4 field discipline.

Defects by kind:
- wikilink-casing (LOW — PC-8, EXACT-VARIANT RECURRENCE): L111 [[Enterprise Ai]] resolves but is non-canonical
  vs the graph's uppercase 'AI' convention (Enterprise AI Adoption/Deployment). This is the SAME [[Enterprise Ai]]
  variant that graduated PC-8 on waves #44 + #55 — now a 3rd occurrence → PC-8 header annotated `reinforced #65`.
  Retarget to [[Enterprise AI]] / the populated Enterprise AI Adoption cluster. Strengthens the standing
  suggestion to seed a canonical **Enterprise AI** entity page (kills this recurring variant at source).
- unverifiable person-name in attribution (LOW — PC-2 source arm): L141-148 source 'Andy Henny' reads like an
  ASR-mangled analyst name, unverifiable against any known analyst → verify against the source video
  description/handle and `[sic]`/correct in source::/attribution ONLY, leave verbatim evidence:: untouched. Same
  class as the #61/#62/#64 source-arm garbles. NB positive control: model versions are cleanly normalised to
  'Claude Opus 4.6' / 'GPT-5.3 Codex' despite raw ASR noise ('Codex 53', '5 3', '4 6') surviving in the verbatim
  evidence quotes — PC-2/PC-7 body-normalisation working as intended (garble kept in evidence, clean in assertion).
- missing-wikilink / zero-link assertion (LOW — PC-6 link-coverage floor): the 700-developer-poll claim
  (L121-129, 53.3% vs 24.9% would-code-with) emits no [[wikilink]] while its peers link ≥1 entity → orphaned from
  the graph. PC-6 candidate: a single highest-precision link ([[Model Comparison]] or [[Developer Adoption]])
  provided it clears PC-1's guards. Reinforces PC-6; no new mechanism.
- internal-evidence-inconsistency (LOW — PC-5-adjacent, honest-not-defect): L11 asserts the two models dropped
  'within 20 minutes of each other' while its OWN evidence quotes the host saying both '20 minutes' AND 'literally
  15 minutes later'. The assertion silently picked one figure. Transparent (both figures are in the cited
  evidence), so honest-but-imprecise, not a PC-5 grounding violation. Optional polish: note the conflicting 15/20
  figures rather than silently selecting 20. Single occurrence → watch NOT opened.

Top wisdom:
- GPT-5.3 Codex is OpenAI's first model 'instrumental in creating itself' — the Codex team used early versions to
  debug its own training, manage deployment, and diagnose evals (L71). Durable, high-signal recursive-self-
  improvement / model-bootstrapping milestone, not a benchmark number.
- Anthropic's 'agent teams' — a coordination layer splitting a problem across multiple Claude instances on
  separate sub-tasks contributing to a whole (L31). Durable architectural pattern; corroborated downstream by
  McKay Wrigley's 2.5x speedup test (L131) and the $20k/2B-token C-compiler build (L61).
- Token efficiency as the real story: GPT-5.3 Codex ~3x more token-efficient than 5.2 for equal-or-better
  intelligence (L141). Durable efficiency-trend insight (single-source, the unverified 'Andy Henny') that
  outlasts leaderboard churn — correctly volatility:: durable, but authority-capped by the single source.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN a 4th consecutive time (#62/#63/#64/#65). Refinement #1
   (`claim-date:: {episode_date}` threaded into `_build_ledger_bullet`) HOLDS; page carries episode-date and
   all claim-date == episode-date. **No code change owed** — the standing item is empirically dead on post-fix
   pages; this page does NOT join the DEFERRED pre-fix re-date backlog. Keep verifying siblings only.
2. PC-8 (verify link-casing arm): retarget L111 [[Enterprise Ai]] → [[Enterprise AI]] / Enterprise AI Adoption.
   3rd exact-variant hit → **elevate the seed-a-canonical-Enterprise-AI-page suggestion** (same shape as the
   [[Project Prometheus]] / OpenClaw-cluster entity-page seeds): one canonical page collapses this recurring
   lowercase-'Ai' variant for all future episodes.
3. PC-2 source arm (verify): 'Andy Henny' (L141) — verify against the source's own byline/handle, `[sic]`/correct
   in source::/attribution ONLY; leave verbatim evidence:: quotes intact.
4. PC-6 (link floor): anchor the L121 developer-poll claim with a single PC-1-cleared link ([[Model Comparison]]
   or [[Developer Adoption]]) so it is not orphaned.
5. Optional polish (PC-5-adjacent, no rule change): where an assertion's evidence carries TWO conflicting figures
   for the same quantity (L11 15 vs 20 minutes), prefer surfacing the range/conflict over silently picking one.

Reinforced: Refinement #1 (4th consecutive clean positive control), PC-8 (3rd [[Enterprise Ai]] recurrence),
PC-2 source arm (+'Andy Henny' verify seed), PC-6 (zero-link orphan), PC-3/PC-4 field discipline + dedup arm
(14/14 clean positive control). No new watch, no new PROPOSED CHANGES block.

### 2026-08-24 — Review wave #66 (synthesiser)
Pages reviewed (1):
- `podcast-evidence___pro-worker-ai.md` (verdict GOOD, episode 2026-03-14)

STRUCTURAL OUTCOME: all 4 findings LOW, single page, verdict GOOD → **no new PROPOSED CHANGES block owed** (the
HIGH-on-2+-pages rule mints none). **5th consecutive clean claim-date positive control** (#62/#63/#64/#65/#66):
episode-date:: 2026-03-14 populated, all 11 assertions carry claim-date:: 2026-03-14 (NOT ingest-date 2026-08-24)
→ Refinement #1 HOLDS. Most defects map to already-graduated patterns (PC-2 source arm, PC-6); ONE finding
sharpens PC-3 with a new distinction (data-producer authority vs access-path authority) — logged as a PC-3
refinement seed below, not a code change.

Defects by kind:
- source-authority-mislabel (LOW — PC-3 SHARPENING, NEW NUANCE): two assertions tagged source-authority:: primary
  are reached second-hand — the ECB 5,000-firm study (L21-24) and the YouGov 63%/7% poll (L41-44) both arrive
  'via Washington Post editorial board' per their own source:: fields. The DATA PRODUCERS (ECB, YouGov) are
  primary, but the TRANSCRIPT'S ACCESS to them is secondary reporting through a WaPo editorial. PC-3 currently
  grades a flat authority that conflates these; this page shows the two can diverge. Fix: grade the ACCESS PATH,
  not just the producer — downgrade to secondary, or add a `via-primary` tag (primary datum, secondary access).
- possible-asr-entity (LOW — PC-2 source arm): 'Burko Capital' (L101-108) reads like an ASR mis-transcription of
  an analyst/fund name, unconfirmable against graph or authority. Same class as the #61/#62/#64/#65 source-arm
  garbles ('Andy Henny' etc.). CONTAINED by design (tier 2, confidence 0.7, secondary) — spot-verify against the
  episode audio before any promotion/linking; `[sic]`/correct in source::/attribution ONLY.
- minor-title-inaccuracy (LOW — PC-2 source arm): L14 attributes the Atlassian statement to 'Mike Cannon-Brookes
  (CEO of Atlassian)'; he is co-CEO / co-founder (Atlassian has co-CEOs). Role imprecision in the source:: field
  only, not the assertion body. Correct to 'co-CEO/co-founder'.
- missing-wikilink / under-linked durable entities (LOW — PC-6 link-coverage floor): durable entities
  Atlassian, YouGov, MIT authors (Acemoglu/Autor/Johnson), Gina Raimondo are unlinked while the page already
  links Anthropic, ECB, AI Policy. Add [[wikilink]]s that clear PC-1's guards to lift graph connectivity.

Top wisdom:
- Acemoglu/Autor/Johnson's framework that the ONLY unambiguously pro-worker category of technological change is
  'new task-creating technologies' (vs automation that renders existing expertise obsolete) — a durable
  conceptual lens for evaluating ANY AI deployment (L51). Highest-signal item; a reusable analytic frame, not a
  number.
- The ECB study of 5,000 Eurozone firms finding AI-adopting firms ~4% MORE likely to hire — durable empirical
  counter-evidence to the reflexive 'AI destroys jobs' narrative (L21). Authority-capped by the via-WaPo access
  path (see PC-3 note).
- The host's 'efficiency AI (do the same with less) vs opportunity AI (produce more / bridge into new areas)'
  heuristic — a durable strategic frame, though single-source opinion → correctly authority-capped (L91).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN a 5th consecutive time (#62..#66). Refinement #1 HOLDS; page
   carries episode-date and all claim-date == episode-date. **No code change owed**; does NOT join the DEFERRED
   pre-fix re-date backlog. Keep verifying siblings only.
2. PC-3 REFINEMENT SEED (source-authority — producer vs access path): the authority grade should reflect the
   TRANSCRIPT'S ACCESS PATH to a datum, not only the datum's original producer. When a primary source (ECB,
   YouGov, a peer-reviewed study) is reached THROUGH a secondary vehicle (a WaPo editorial, an op-ed, a host's
   summary), grade it `secondary` — or introduce a `via-primary` authority value = 'primary datum accessed via
   secondary reporting'. Extraction/verify-prompt line to register (team lead applies): "Grade source-authority
   by how the TRANSCRIPT reached the claim: if a primary study/poll is quoted THROUGH a secondary vehicle
   (editorial/op-ed/host summary), tag `secondary` (or `via-primary`), not `primary` — reserve flat `primary`
   for direct access to the producing source." NB not yet HIGH / not 2+ pages → seed only, no PROPOSED CHANGES
   block; watch for a 2nd occurrence to graduate (pre-registered trigger).
3. PC-2 source arm (verify): spot-verify 'Burko Capital' (L101) against the episode audio; `[sic]`/correct in
   source::/attribution ONLY. Correct 'CEO of Atlassian' → 'co-CEO/co-founder' for Cannon-Brookes (L14),
   source:: field only.
4. PC-6 (link floor): add PC-1-cleared [[wikilink]]s for the unlinked durable entities (Atlassian, YouGov,
   Acemoglu/Autor/Johnson, Gina Raimondo) so they are not orphaned from the graph.

Reinforced: Refinement #1 (5th consecutive clean positive control), PC-2 source arm (+'Burko Capital' /
Cannon-Brookes verify seeds), PC-6 (under-linked durable entities), PC-3/PC-4 field discipline. NEW (seed only,
not graduated): PC-3 producer-vs-access-path authority distinction — watch opened for a 2nd occurrence. No new
watch elsewhere, no new PROPOSED CHANGES block.

### 2026-08-24 — Review wave #67 (synthesiser)
Pages reviewed (2):
- `podcast-evidence___ralph-wiggum-clawdbot-and-mac-minis-how-pros-are-vibe-coding-in-2026.md` (verdict ACCEPTABLE, episode 2026-01-26)
- `podcast-evidence___real-world-ai-evaluations.md` (verdict GOOD, episode 2025-12-15)

STRUCTURAL OUTCOME: the wave's one HIGH (page-1 [[Semiconductor]] mislink) is a PC-1 recurrence; page 2 has NO
HIGH → **HIGH-on-2+-pages rule mints no new PROPOSED CHANGES block**. Headline of the wave is a strong **PC-7
double-hit**: BOTH pages carry an intra-page entity-name-variant split (same referent, two spellings on one
page) — the exact class PC-7 graduated on. **6th consecutive clean claim-date positive control** and, for the
first time, on BOTH pages of a multi-page wave: episode-date:: populated on each (2026-01-26 / 2025-12-15) and
every claim-date == episode-date (NOT ingest-date 2026-08-24) → Refinement #1 HOLDS. Every defect maps to an
already-graduated PC; one numeric finding is logged as a PC-5-adjacent watch.

Defects by kind:
- wikilink-mislink (HIGH — PC-1 recurrence, SUBSTRING-CONTAINMENT subclass): page 1 L101 links the 'Conductor'
  GUI-coding-tool claim to [[Semiconductor]] — 'Conductor' is a literal substring of 'Semiconductor', so the file
  exists (passes the ls check) but the edge is semantically unrelated. Same directional-substring failure PC-1
  already guards (wave #10 'return on sales'→[[ROS]]; #59 directional-substring tightening) — retarget to a
  Conductor tool entity or emit NO link. Reinforces PC-1's substring arm; no new class.
- intra-page entity-name split (MEDIUM on pg2 / LOW on pg1 — PC-7 DOUBLE-HIT, same wave): page 1 title/front-
  matter say 'Clawdbot' (L3/5) while every body assertion says 'Claudebot' (L61/81/111) — one product, two
  spellings → dedup treats them as distinct entities. Page 2 writes the benchmark 'GDPvala' in 4 assertions
  (L11/21/31/111) and 'GDPval' in 2 (L71/101) → same benchmark, two graph identities. Textbook PC-7 (unify the
  same-referent variants to ONE canonical form before linking). NB the two differ in origin: Clawdbot/Claudebot
  is a genuine spelling inconsistency (PC-7 pure); GDPvala is ALSO an ASR mishearing of 'GDPval' (PC-2 FIRST to
  fix the garble, THEN PC-7 to merge) — canonical form is GDPval, optionally seed a [[GDPval]] entity.
- asr-artefact-entity-names in prose/body (MEDIUM — PC-2 body arm): page 1 asserts garbled proper nouns as fact
  without wikilinking them (so PC-1 never fires): 'Michael Troll'→Michael Truell (Cursor CEO), 'Codeex 5.2'→Codex
  5.2, 'Ghosty'→Ghostty, 'sententry web hook'→Sentry webhook (L98), 'Claude Co-work'→Claude Cowork. PC-2
  mishearing-correction target. 'Buant Tongu' (L111/114) is an UNRECOVERABLE garble (former NVIDIA engineer) —
  not [sic]-correctable → verify against the episode or DROP the attribution rather than harden an unverifiable
  name as a graph fact.
- under-linking / missing primary-entity wikilinks (MEDIUM — PC-6 link floor): page 1's core subjects are
  un-navigable — Claudebot claims (L61/81) link only [[Open Source Software]]/[[Autonomous Task Execution]] (no
  [[Claudebot]]); the Ralph Wiggum loop claim (L51) and the Nat/Mac-Mini claim (L91) emit zero entity links; the
  Cowork claim links [[Anthropic]] but not a Cowork/Claude Code product page. PC-6 candidates (each must clear
  PC-1): [[Claudebot]] (canonical, post-PC-7 merge), a Ralph Wiggum Loop entity, [[Claude Cowork]] / [[Claude Code]].
- internal-numeric-inconsistency / ungrounded derivation (MEDIUM — PC-5-adjacent, WATCH OPENED): page 2 L111
  asserts DeepSeek 3.2 ran for $29 = 'one-twentieth the cost of Claude Opus 4.5', but L31 states Opus cost $68 →
  $68/20 = $3.40, not $29 ($29 is ~43% of $68). The evidence note flags the transcript said a garbled '120th'; the
  writer's 'one-twentieth' is an unsupported interpolation that self-contradicts a datapoint in its OWN ledger.
  Safe claim = the raw $29 figure; DROP the derived ratio. Numeric analogue of wave #1's internal-date-
  inconsistency → both are "assertion states a DERIVED figure not grounded in / contradicting the ledger's own
  data". Single occurrence this axis → WATCH opened (graduates to a PC on a 2nd page).
- hype-leakage (LOW — contained): page 1 L71 restates transcript hype 'armies of agents that work while they
  sleep' as the assertion body (tier 2), but framed/attributed rather than raw → borderline acceptable; carries
  promo register, not a distilled claim. Note only.
- transcript-artefact-in-evidence (LOW — PC-2/PC-7 POSITIVE CONTROL): page 2 keeps raw ASR errors ('CatchBT' L88,
  'doubbishness/hawkishness' L158, 'Deepseek 32' L118) CONFINED to evidence:: with [sic] while the assertion prose
  is clean → the "garble stays in evidence, clean in assertion" discipline (PC-2/PC-7 body-normalisation) working
  as intended. Corroborates page 1's own clean handling.
- dedup + tier/confidence (LOW — POSITIVE CONTROL): page 1 carries a well-formed assertion-fp on all 12 blocks
  (L19..129) and a sane tier/confidence/source-authority gradient (tier 1 primary/secondary 0.85-0.95, tier 2
  single-source 0.8-0.9, tier 3 speculative 0.7); page 2 likewise. No anomaly.

Top wisdom:
- Multi-agent concurrency lesson (page 1, L31-49): a FLAT coordination structure with locking collapsed 20 Cursor
  agents to the throughput of two-or-three; a HIERARCHICAL planner/worker pipeline (planners continuously explore
  the codebase and enqueue tasks, workers pick them up) resolved the bottleneck. Durable, transferable
  agent-concurrency engineering — highest-value assertion of the wave; maps onto the same shared-memory/
  coordination thesis as wave #1's negative-results insight.
- The 'Ralph Wiggum loop' pattern (page 1, L51): an autonomous coding loop where each iteration runs in a FRESH
  context window and memory persists via git history + text files — a durable, reproducible design pattern for
  long-horizon autonomous coding (not ephemeral news).
- GDPval methodology (page 2, L71): OpenAI's GDPval measures end-to-end knowledge-work task completion across 44+
  occupations using expert graders paired with an automated grader; Artificial Analysis built an AI grading
  harness (L101) to run it at scale on any LLM — durable, reusable eval-design knowledge (correctly the canonical
  entity to seed, see PC-7).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN a 6th consecutive time (#62..#67), and for the first time on BOTH
   pages of a multi-page wave. Refinement #1 (`claim-date:: {episode_date}` threaded into `_build_ledger_bullet`)
   HOLDS; both pages carry episode-date and all claim-date == episode-date. **No code change owed** — the standing
   item is empirically dead on post-fix pages; neither page joins the DEFERRED pre-fix re-date backlog. Both
   reviews independently confirm "no re-dating needed" (page 1 is explicitly cited as a good example of the dating
   axis done right).
2. PC-7 DOUBLE-REINFORCED this wave (2 pages, one wave). Run the ordered pipeline: PC-2 mishearing-correction
   FIRST (GDPvala→GDPval; Michael Troll→Truell, Codeex→Codex, Ghosty→Ghostty, sententry→Sentry, Claude Co-work→
   Cowork), THEN PC-7 same-referent merge (Clawdbot/Claudebot → ONE canonical 'Claudebot', reconciled with the
   title), THEN PC-6/PC-1 linking of the CANONICAL form only. Reconcile the page-1 title 'Clawdbot' with the body
   'Claudebot' so front-matter and assertions name one entity.
3. PC-2 body arm (verify): 'Buant Tongu' (page 1 L111/114) is UNRECOVERABLE — do NOT [sic]-correct to a guessed
   name; verify against the episode or DROP the attribution before it hardens as a graph fact (stronger than the
   #61/#64/#65 source-arm garbles, which were correctable).
4. PC-5-adjacent WATCH (ungrounded-derived-figure): where an assertion states a DERIVED number (ratio/multiple/
   difference) not present in — or contradicting — the ledger's own data, drop the derivation and keep the raw
   grounded figure (page 2 L111: keep '$29', drop 'one-twentieth of Opus'). Numeric sibling of wave #1's
   internal-date-inconsistency; a 2nd occurrence graduates the pair to a PC (verify-pass consistency check across
   figures in the same ledger).
5. PC-6 (link floor): anchor page 1's orphaned core subjects with PC-1-cleared links — [[Claudebot]], a Ralph
   Wiggum Loop entity, [[Claude Cowork]]/[[Claude Code]]; optionally seed a [[GDPval]] entity for page 2 (durable
   reusable concept, canonical post-PC-7).

Reinforced: Refinement #1 (6th consecutive clean positive control; first dual-page-clean wave), PC-7 (DOUBLE-hit,
2 pages one wave — strongest single-wave reinforcement to date), PC-1 (substring-containment mislink, [[Semiconductor]]←
'Conductor'), PC-2 body arm (+prose garbles & unrecoverable 'Buant Tongu'), PC-6 (orphaned core subjects),
PC-2/PC-7 body-normalisation positive control (page 2 evidence-confined [sic]). NEW (watch only, not graduated):
PC-5-adjacent ungrounded-derived-figure — watch opened for a 2nd occurrence. No new PROPOSED CHANGES block.

### 2026-08-24 — Review wave #68 (synthesiser)
Pages reviewed (3): `openai-ipo-elon-xai-spacex-merger-state-of-the-ai-race.md` (acceptable),
`opus-46-and-chatgpt-53-codex-are-here-and-the-labs-are-at-war.md` (good),
`should-we-be-scared-of-anthropics-mythos.md` (good). All fold into standing PC-2/PC-3/PC-5/PC-6/PC-8;
no new PC class.

Defects by kind:
- whole-page zero-wikilink orphan (HIGH, PC-6 — STRONGEST manifestation to date, single page): page 1 has
  ZERO [[wikilinks]] across all 14 assertions — grep returns none. Entity pages exist and are NAMED in the
  prose (Anthropic, OpenAI, Apple, Amazon, SpaceX, xAI) yet nothing links → the whole ledger is orphaned from
  graph traversal. Prior PC-6 pages were per-assertion zero-link (wave #43: 1 assertion; #46: 6); this is the
  first ENTIRE-PAGE orphan (14/14). Single page → covered by already-graduated PC-6, no new block, but it is
  PC-6's highest-severity instance and its clearest value case (apply the link-coverage floor page-wide).
- asr-garbled source::/entity names (MEDIUM, PC-2 recurrence — 2 pages, structured-field arm): page 1 source::
  'Ben Casta of Village Global' → Ben Casnocha (Village Global co-founder), 'Peter Turk' (L124) likely mangled;
  page 3 source:: 'Elia Zatsev' → Elia Zaitsev (CrowdStrike, L91) and body benchmark 'SweetBench Pro' → SWE-bench
  Pro (L61). Attribution-bearing names carried as authoritative → PC-2 dictionary adds (Casnocha/Village Global,
  Zaitsev, SWE-bench Pro). Good: NO wikilinks minted for the garbled names (PC-1 didn't fire on the dubious tokens).
- provenance-grade overconfidence (LOW→MEDIUM, PC-3 recurrence — 2 pages): page 1 rates the 'QAI' Apple $2B
  acquisition tier-1/conf-0.95 on a single-outlet (FT, host-relayed) + possibly ASR-corrupted entity name — a
  0.95 tier-1 is unwarranted until the name and single sourcing are corroborated; page 3 carries Anthropic-reported
  blocks (accidental-CoT-training, benchmark scores) at tier-1 source-authority 'primary' though they are
  host-relayed, not drawn from the system card → PC-3 caps host-relayed to 'secondary'.
- claim↔evidence version mismatch (LOW, PC-5 recurrence): page 3 L11 assertion says 'Terminal Bench 2.0' while
  its own evidence:: quote says 'terminal bench 2.1' (and the [[Terminal Bench 2.0]] link target) — claim and its
  grounding disagree on the benchmark version. PC-5's claim↔evidence consistency check should reconcile to one
  version before writing (and align the link target). NB the same benchmark appears on page 2 (L41/L51) as
  COMPETING vendor claims (Anthropic 'leading score' vs GPT-5.3 Codex 77.3% > Opus 4.6 65.4%) — faithfully hedged
  'if true', a real competitive framing, NOT a defect; flagged only so a consumer doesn't treat both as settled.
- wikilink-casing-fragmentation (LOW, PC-8 recurrence — 3rd page, IDENTICAL variant): page 2 [[Enterprise Ai]]
  (L111) resolves to the lowercase-'Ai' stub instead of canonical 'Enterprise AI' — the exact same variant PC-8
  logged on waves #44 and #55. Reinforces PC-8 sub-rule (a) (uppercase known acronym in the link target).
- POSITIVE CONTROLS (no defect, noted for completeness): (1) claim-date — all 3 pages carry episode-date::
  (2026-02-02 / 2026-02-06 / 2026-04-09) and EVERY claim-date:: equals the episode-date, none the ingest-date
  (2026-08-24) → Refinement #1 holds; first TRIPLE-page-clean wave. (2) PC-2 body-normalisation — pages 2 & 3
  keep raw ASR ('Codex 53', 'Opus 4 6', 'compute use', 'Open AAI', 'bare market', 'game-outs') CONFINED to
  verbatim evidence:: while the assertion prose is clean/normalised (GPT-5.3 Codex, Claude Opus 4.6). (3) dedup —
  page 2 carries 15 assertion-fp markers / 15 bullets, complete.

Top wisdom:
- Structural decoupling of headcount from revenue (page 1 L81, tier 2, durable): companies (Amazon, ASML) cut
  jobs while posting record revenue/orders — an AI-efficiency trend to track through 2026. Most generalisable
  insight of the wave; outlives the ephemeral IPO/merger news around it.
- GPT-5.3 Codex is the first model OpenAI says was instrumental in building ITSELF (page 2 L71, durable) — early
  versions debugged its own training, managed deployment, diagnosed evals. A recursive-self-improvement milestone
  claim, not benchmark churn.
- Anthropic's disclosure that it accidentally trained AGAINST the chain-of-thought for Opus 4.6 / Sonnet 4.6 /
  Mythos for 8% of RL (page 3 L71, tier 1, durable) — potentially voiding CoT-faithfulness as a safety signal;
  the highest-value interpretability datapoint of the wave. Corroborated by the collapse of the discover-to-exploit
  window from months to minutes under AI (Elia Zaitsev/CrowdStrike, page 3 L91).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN a 7th+ consecutive time and for the FIRST time across THREE pages in
   one wave. Refinement #1 (`claim-date:: {episode_date or today}` in `_build_ledger_bullet`, ingest.py L643) HOLDS;
   all three pages carry episode-date and every claim-date == episode-date. **No code change owed** — the standing
   item is empirically dead on post-fix pages; none of these three joins the DEFERRED pre-fix re-date backlog.
2. PC-6 (link-coverage floor) — page 1 is the strongest case yet for applying it: a whole-page orphan (14/14 zero
   links) whose prose names six on-disk entity pages. Apply the floor page-wide (one highest-precision PC-1-cleared
   link per assertion): [[Anthropic]], [[OpenAI Research Organisation]], [[Apple Inc Technology Corporation]],
   [[Amazon]], [[SpaceX]], [[xAI]]. Guard unchanged: an orphan beats a false edge; PC-1 vetoes.
3. PC-2 dictionary adds this wave: 'Ben Casta'→'Ben Casnocha' (+ 'Village Global'), 'Elia Zatsev'→'Elia Zaitsev',
   'SweetBench Pro'→'SWE-bench Pro'; verify 'Peter Turk' and the acquired-company 'QAI' against the episode before
   hardening either as a graph fact (QAI is possibly ASR-corrupted — do NOT [sic]-canonicalise a guessed expansion).
4. PC-3 caps this wave: down-rate the page-1 'QAI' acquisition from tier-1/0.95 until the entity name AND the
   single FT-via-host sourcing are independently corroborated; down-rate page-3 Anthropic-reported tier-1 blocks
   from source-authority 'primary' to 'secondary' (host-relayed, not system-card-direct).
5. PC-5 reconcile: align page-3 'Terminal Bench 2.0' assertion with its evidence's '2.1' (and the link target) to
   one version before writing. PC-8: normalise page-2 [[Enterprise Ai]] → [[Enterprise AI]] (sub-rule (a)).

STRUCTURAL OUTCOME: exactly ONE HIGH this wave (page-1 whole-page orphan) on a SINGLE page → **HIGH-on-2+-pages rule
mints no new PROPOSED CHANGES block**, and that HIGH is covered by already-graduated PC-6. Every other finding folds
into PC-2 (2 pages) / PC-3 (2 pages) / PC-5 / PC-8. Reinforced: PC-6 (now #43+#46+#52+#56+#57+#68, gains its first
ENTIRE-PAGE-orphan instance), PC-2 (2 more pages), PC-3 (2 more pages), PC-5 (claim↔evidence version mismatch),
PC-8 (3rd identical [[Enterprise Ai]] page). Positive controls: Refinement #1 (first triple-page-clean wave), PC-2
body-normalisation (evidence-confined garble on 2 pages), dedup completeness. No new watch, no graduation, no new
PROPOSED CHANGES block.

### 2026-08-24 — Review wave #69 (synthesiser)
Pages reviewed (1): `podcast-evidence___study-says-ai-can-automate-57-of-current-human-work-hours.md`
(acceptable). One NEW defect kind opens as a watch (W-UNDEREXTRACT); the rest fold into standing
PC-3 / PC-6; the claim-date positive control holds.

Defects by kind:
- titular/marquee claim never extracted (HIGH, NEW watch W-UNDEREXTRACT — see WATCHES): the page's ONE
  assertion carries a SECONDARY stat (~80% per-task speedup) while the figure the page is NAMED for — AI can
  automate 57% of current human work hours — is absent from the ledger entirely. This is an EXTRACTION-RECALL
  miss, orthogonal to every graduated PC (all of which grade an assertion that was written; here the marquee
  assertion is simply not there, so nothing downstream can catch it). Signal is near-diagnostic: the 57% is in
  the page slug yet matches no assertion body/evidence::. Single HIGH page → opens W-UNDEREXTRACT (HIGH-on-2+
  would mint a block); does NOT fold into PC-6 (that is link-coverage of assertions that exist, not assertion-
  coverage of the source).
- source-authority mislabel: podcast relay stamped 'primary' (MEDIUM, PC-3 recurrence): source-authority::
  primary on the AI Daily Brief podcast, which is SECONDARY reporting relaying Anthropic's research — the exact
  host-relayed-as-primary pattern PC-3 caps. Down-rate to 'secondary' (or re-anchor source:: to the Anthropic
  Economic Index publication itself), which also relaxes the slightly inflated 0.95 confidence. Folds into PC-3.
- whole-page zero-wikilink orphan (MEDIUM, PC-6 recurrence): zero [[wikilinks]] on the page; the sole assertion
  names 'Anthropic Economic Index' and 'Anthropic', BOTH of which exist on disk (verified: mainKnowledgeGraph/
  pages/{Anthropic Economic Index.md, Anthropic.md}) yet neither is linked → the ledger adds nothing to graph
  connectivity. PC-6 link-coverage floor (PC-1-gated): mint [[Anthropic Economic Index]] and [[Anthropic]].
- POSITIVE CONTROL — claim-date (no defect): claim-date:: 2025-11-27 equals episode-date, NOT the ingest-date
  2026-08-24; episode-date:: present and re-dating infrastructure intact → Refinement #1 holds (8th+ consecutive
  clean post-fix page). This page does NOT join the pre-fix re-date backlog.

Top wisdom:
- Anthropic's analysis of ~100,000 Claude conversations found AI speeds up individual tasks (avg ~90 min unaided)
  by about 80% — a durable, quantified empirical productivity finding worth retaining even though it is the
  page's SECONDARY (non-titular) stat. Its survival while the 57% headline was dropped is itself the wave's
  lesson: extraction kept the well-quoted number and lost the marquee one.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN again (claim-date == episode-date, not ingest-date). Refinement #1
   (`claim-date:: {episode_date or today}` in `_build_ledger_bullet`, ingest.py L643) HOLDS; no code change owed
   on this page and it does not join the DEFERRED pre-fix re-date backlog.
2. NEW watch W-UNDEREXTRACT (registered in WATCHES) — title-coverage check after extraction: derive the salient
   figure/claim from the page title/slug and require at least one assertion to cover it, else emit the missing
   assertion (own evidence quote + own dedup fingerprint) or flag for re-extraction. Extraction-prompt line
   drafted in the watch. Single page → watch only; graduates to a PROPOSED CHANGES block on a 2nd titular-miss.
3. PC-3 cap this wave: down-rate source-authority:: primary → secondary on the AI Daily Brief relay (or re-anchor
   source:: to the Anthropic Economic Index publication), and relax the 0.95 confidence accordingly.
4. PC-6 apply this wave: mint [[Anthropic Economic Index]] and [[Anthropic]] on the sole assertion (both targets
   verified on disk); PC-1 gate unchanged (an orphan beats a false edge).

STRUCTURAL OUTCOME: single-page wave, verdict acceptable. The lone HIGH (titular-claim miss) is a NEW kind on ONE
page → **HIGH-on-2+-pages rule mints no new PROPOSED CHANGES block**; it opens **W-UNDEREXTRACT** instead. Every
other finding folds into graduated PC-3 (host-relay authority cap) and PC-6 (link-coverage floor). Positive control:
Refinement #1 clean. No graduation, no new PROPOSED CHANGES block; new watch: W-UNDEREXTRACT.

### 2026-08-24 — Review wave #70 (synthesiser)
Pages reviewed (2): `podcast-evidence___surprise-elon-anthropic-team-up-reshapes-ai-race.md`
(acceptable) and `podcast-evidence___the-10-biggest-ai-stories-of-2025.md` (good). NO HIGH finding at
all this wave (all defects MEDIUM/LOW) → HIGH-on-2+-pages rule mints no new PROPOSED CHANGES block. One
NEW watch opens (W-MISATTRIB); every other finding folds into graduated PC-2/PC-3/PC-4/PC-6/PC-8; the
claim-date positive control holds double-page.

Defects by kind:
- source-authority mislabel + extraordinary-claim overconfidence (MEDIUM+LOW, PC-3 recurrence — page 1):
  tier-1/conf-0.95 claims (revenue 80x growth, the 220,000-Nvidia-GPU / 300-MW Colossus deal, Outcomes
  benchmarks) carry source-authority:: primary sourced to 'Claude AI Official Announcement / Transcript' or
  'Anthropic', but the ONLY observable source is a podcast (AI Daily Brief) relaying/paraphrasing — a
  secondary source; no primary artefact (announcement URL, blog, filing) is cited. The extraordinary
  220k-GPU/300-MW deal rests entirely on transcript hearsay at 0.95. Boris Cherny 'zero human-written code
  anywhere in the company' is rhetorical hyperbole ingested near-verbatim at 0.85. Exactly the host-relayed-
  as-primary + extraordinary-single-source pattern PC-3 caps → down-rate to secondary or attach the primary
  artefact before trusting 0.95; relax the hyperbole confidence.
- source-inherited factual cross-entity attribution error (MEDIUM, NEW watch W-MISATTRIB — see WATCHES —
  page 1): assertion 2 states 'Anthropic secured a partnership with SpaceX that grants it full use of xAI's
  Colossus 1 data center' — Colossus is xAI's data centre, not SpaceX's; the clause conflates SpaceX and xAI.
  NOT an ASR artefact (both entities correctly named) — a factual relation wired wrong, inherited from the
  transcript. Distinct from W-SPLIT (one ASR surface hiding two referents) and PC-2 (garble→correct spelling).
  Single MEDIUM instance → watch only; graduates on a 2nd false-relation page. The casing 'XAI'→'xAI' folds
  into PC-8/PC-2.
- whole-page-ish wikilink orphan (LOW, PC-6 recurrence — page 1): only Anthropic is linked; Dario Amodei,
  Boris Cherny, Diane Penn, SpaceX, xAI, Colossus, Grok, Codex, Claude Code, Elon Musk are all bare text —
  the most navigable nodes on the page carry no edges. Apply the PC-1-gated link-coverage floor.
- ASR entity-name leak into assertion PROSE (LOW, PC-2 body arm — page 2): Scale AI CEO named 'Alexander Wang'
  in BOTH the assertion prose AND evidence (Meta/Scale item, L101/108); actual name Alexandr Wang. The garble
  escaped the verbatim-evidence quarantine into the assertion body → PC-2 dictionary add. (Good separation
  elsewhere: prose is clean — Menlo Ventures, Sam Altman, Sundar Pichai, GPT-5 — while ASR noise 'Menllo
  Ventures'/'Sam Alman'/'Sedar Pachai'/'Chachi BBT'/'1day loss' stays confined to evidence::.)
- volatility mislabelling (LOW, PC-4 recurrence — page 2): durable, now permanent-record historical facts
  (Nvidia's ~$593B record single-day loss post-DeepSeek R1) tagged volatility:: snapshot. Defensible as a
  market snapshot at assertion time, but re-tag genuinely permanent facts to durable.
- POSITIVE CONTROLS (no defect): (1) claim-date — BOTH pages carry episode-date:: (2026-05-07 / 2025-12-24)
  and EVERY claim-date:: equals its episode-date, none the ingest-date 2026-08-24 → Refinement #1 holds, a
  DOUBLE-page-clean wave (9th+ consecutive post-fix); neither page joins the pre-fix re-date backlog. (2) PC-2
  body-normalisation working on page 2 (ASR garble confined to evidence, prose normalised). (3) dedup — 15/15
  assertion-fp on page 1, 12/12 on page 2, all unique. (4) no dangling links — all 4 page-2 wikilinks resolve
  ([[Enterprise AI Adoption]], [[Reasoning Models]], [[Model Context Protocol]], [[Agentic Coding]]). (5)
  tier/confidence ladder sane and monotonic on both pages (0.95 tier-1 → 0.45 tier-3).

Top wisdom:
- Anthropic's 'Dreaming' feature (page 1, durable): a scheduled memory-management process that reviews agent
  sessions, extracts patterns, curates memories and restructures storage to stay high-signal — a durable
  agent continual-learning DESIGN PATTERN, not ephemeral news. Most generalisable insight of the wave.
- Competitive frontier has shifted from raw model-capability comparisons (Opus vs GPT) to agent harnesses and
  workflows (Claude Code vs Codex) — durable framing of where value now accrues. Reinforced by page 2's
  reasoning-token structural shift: per OpenRouter, reasoning tokens went ~0 → >50% of ~100T total tokens
  across 2025.
- MIT '95% of GenAI pilots fail' methodology critique (page 2, durable): the figure was inferred from the
  ABSENCE of revenue-acceleration mentions in earnings plus ~50 convenience interviews — failure assumed from
  silence — and is counterweighted by concrete ROI data (44% modest / 38% high / 5% negative). Durable lesson
  in reading AI-adoption statistics critically. Also durable: MCP reaching cross-vendor adoption within months
  (OpenAI Mar, Google Apr), an open protocol pre-empting a standards war.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN again, DOUBLE-page (both claim-date == episode-date, not
   ingest-date). Refinement #1 (`claim-date:: {episode_date or today}` in `_build_ledger_bullet`,
   ingest.py L643) HOLDS; no code change owed; neither page joins the DEFERRED pre-fix re-date backlog.
2. NEW watch W-MISATTRIB (registered in WATCHES) — verify-pass relationship check for load-bearing
   "A {owns|grants|controls|acquired} B" clauses: resolve A and B against the entity dictionary and flag when
   the asserted relation contradicts a known ownership fact (Colossus→xAI, not SpaceX). Guard: dictionary-
   backed checkable relations only; hedged/rumoured relations route to PC-3, not a hard rewrite. Single page →
   watch; graduates on a 2nd false-relation page.
3. PC-3 caps this wave: down-rate page-1 source-authority:: primary → secondary on the podcast-relayed
   announcement claims (or attach the primary artefact URLs — Anthropic blog / official deal announcement)
   before trusting the 220k-GPU/300-MW Colossus deal and 80x-revenue at 0.95; relax the Boris Cherny
   'zero human-written code' claim from 0.85 (rhetorical hyperbole, not a measured fact).
4. PC-6 apply: mint PC-1-cleared links on page 1 for Dario Amodei, Boris Cherny, Diane Penn, SpaceX, xAI,
   Colossus, Grok, Codex, Claude Code, Elon Musk (verify targets on disk; orphan beats a false edge; PC-1
   gate unchanged).
5. PC-2 dictionary add: 'Alexander Wang' → 'Alexandr Wang' (Scale AI CEO) — corrected in the assertion prose
   (page 2 L101), verbatim ASR spelling left in evidence::. PC-8/PC-2 casing: 'XAI' → 'xAI' on page 1.
6. PC-4 apply: re-tag genuinely permanent page-2 historical facts (Nvidia record single-day loss)
   volatility:: snapshot → durable.

STRUCTURAL OUTCOME: 2-page wave, verdicts acceptable + good, NO HIGH finding at all → HIGH-on-2+-pages rule
mints no new PROPOSED CHANGES block. All findings fold into graduated PC-2 (body-prose entity leak), PC-3
(host-relay authority cap + extraordinary-single-source overconfidence, +#69+#70), PC-4 (snapshot→durable,
+#70), PC-6 (link floor, +#69+#70), PC-8 (casing, reinforced #70); ONE NEW watch W-MISATTRIB (source-inherited
cross-entity attribution error). Positive controls: Refinement #1 (double-page clean, claim-date==episode-date),
PC-2 body-normalisation, dedup completeness, no dangling links, sane tier ladders. No graduation, no new
PROPOSED CHANGES block; new watch: W-MISATTRIB.

### 2026-08-24 — Review wave #71 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-16-coolest-agents-ive-built-so-far.md` verdict acceptable.

Defects by kind:
- ASR duplicate-entity split (MEDIUM, PC-2 × PC-7 — page 1): 'Witty RADARS' (L51) is an ASR garble of
  'Opportunity RADARS' — the CORRECT surface for the same product family appears on L111 of the SAME page.
  Two surfaces → one referent → risks minting a duplicate entity. This is the mirror of W-SPLIT (one surface
  hiding two referents); here it is one referent behind two surfaces, i.e. the PC-7/W-CANON duplicate-entity
  case but with an ASR cause. Fix is PC-2 dictionary ('Witty RADARS' → 'Opportunity RADARS') which collapses
  the split; PC-7's pick-one-canonical-surface arm then guarantees a single graph identity.
- ASR brand-name garble (LOW, PC-2 body/structured arm — page 1): 'Open Claw' / 'Open Claw Coder' (L51,121;
  OpenClaw-family, recurs from waves #58/#37 W-VERBSIC/W-CANON) and 'Perplexity Computer' (L138, → 'Perplexity
  Comet') read as transcription artefacts of real product/brand names → PC-2 dictionary adds; verify each
  against the actual product before entity resolution.
- volatility mislabel (LOW, PC-4 recurrence — page 1): ~9 assertions describing ONE builder's personal
  side-projects (Mycroft, Holmes, 221B, Chucky, Compass, Mission Control Center, Open Claw Coder) tagged
  volatility:: durable; these are ephemeral single-builder product announcements → re-tag to snapshot. Same
  PC-4 durable↔snapshot mis-grade class; here the error runs the OTHER way vs wave #70 (there: permanent facts
  under-tagged snapshot; here: ephemera over-tagged durable) — PC-4's rubric must cut both directions.
- dating — NON-DEFECT / POSITIVE CONTROL: claim-date:: 2026-03-15 == episode-date, distinct from ingest-date::
  2026-08-24 → Refinement #1 holds; page is post-fix, does NOT join the pre-fix re-date backlog. Continues the
  long post-fix clean streak.

Top wisdom:
- AI-strategy consulting shifting from a one-time assessment to a persistent, continuously-updated process
  (L141) — durable structural insight about how advisory work itself is being re-shaped by agents.
- Average power user runs ~3.5 different models for different purposes, per monthly pulse surveys (L71) —
  concrete, citable multi-model-usage datapoint (reinforces wave #70's reasoning-token structural-shift figure).
- Six-vector AI/agent readiness framework — use cases, systems, data integration, outcomes, people, governance
  (L91) — a reusable evaluation lens, durable and transferable beyond the episode.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN again (claim-date == episode-date, not ingest-date). Refinement #1
   (`claim-date:: {episode_date or today}` in `_build_ledger_bullet`, ingest.py L643) HOLDS; no code change
   owed; page does not join the DEFERRED pre-fix re-date backlog.
2. PC-2 dictionary adds: 'Witty RADARS' → 'Opportunity RADARS' (collapses the L51/L111 duplicate-entity split);
   'Open Claw'/'Open Claw Coder' → OpenClaw-family canonical; 'Perplexity Computer' → 'Perplexity Comet'
   (verify). Then PC-7 pick-one-canonical-surface guarantees a single identity for the RADARS product.
3. PC-4 apply: down-grade volatility:: durable → snapshot on the single-builder side-projects (Mycroft, Holmes,
   221B, Chucky, Compass, Mission Control Center, Open Claw Coder). Note the two-directional error (over- vs
   under-tag across waves #70/#71) → PC-4's snapshot-vs-durable rubric should be stated symmetrically.

STRUCTURAL OUTCOME: single-page wave, verdict acceptable, NO HIGH finding → HIGH-on-2+-pages rule mints no new
PROPOSED CHANGES block. All findings fold into PC-2 (ASR garble + duplicate-entity collapse), PC-7 (canonical
surface), PC-4 (durable→snapshot). Positive control: Refinement #1 clean (claim-date==episode-date). No new
watch, no graduation, no new PROPOSED CHANGES block.

### 2026-08-24 — Review wave #72 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-5-biggest-ai-stories-to-watch-in-december.md` verdict GOOD.

Defects by kind:
- zero-wikilink assertion / graph orphan (MEDIUM, PC-6 recurrence — now 8th page): the FT Gemini-vs-ChatGPT
  assertion (L31) emits NO [[wikilinks]] while every sibling carries 1-3, dropping it out of connectivity.
  Textbook PC-6: prose names a resolvable concept ([[Model Performance]] or a ChatGPT/Gemini entity) → apply
  the link-coverage floor, mint the SINGLE highest-precision PC-1-cleared anchor, orphan only if none clears.
- semantically-loose (resolving-but-imprecise) wikilink (LOW, PC-1 sub-case (d)-adjacent): [[AI Governance
  Law and Privacy]] hangs off the HP job-cuts assertion (L11) and the enterprise-reorganisation analysis (L91),
  neither a governance/privacy claim. Links RESOLVE (so this is the milder cousin of PC-1's HIGH wrong-sense
  arm, not a dangling edge) but are topically weak and will pollute that page's backlinks. Fix: on L11 re-point
  to a labour/workforce entity ([[AI-Driven Workforce Reduction]] alone), drop the loose governance link. Folds
  into PC-1's precision arm (subtract the low-value edge; PC-6 then re-anchors if it leaves an orphan).
- casing fragmentation (LOW, PC-8 recurrence — 'Enterprise Ai' now on its 3rd page: #44/#55/#72): [[Enterprise
  Ai]] (L41, L111) uses sentence-case 'Ai' and coexists with properly-cased [[Enterprise AI Adoption]]. Both
  resolve so PC-1 never fires; PC-8 sub-rule (a) known-acronym retarget: 'Enterprise Ai' → 'Enterprise AI'
  graph-wide, merging the variant stub. This exact surface is PC-8's canonical example — reinforces, no new class.

POSITIVE CONTROLS (no defect — a clean 'good'-verdict page):
- claim-date — CLEAN: claim-date:: 2025-12-10 == episode-date::, NOT ingest-date 2026-08-24; front-matter
  carries episode-date so claims are correctly episode-dated and re-datable → Refinement #1 HOLDS; page is
  post-fix, does NOT join the pre-fix re-date backlog. Continues the long post-fix clean streak.
- PC-2 evidence-guard CONFIRMED working: ASR artefacts ('chatbt enterprise' L58, 'GPT40' L68, 'Google flippins
  Nvidia' L138, 'fullthroatated' L128) stay INSIDE verbatim evidence:: quotes only; assertion prose + entity
  names correctly normalise to 'ChatGPT Enterprise'/'GPT-4.0'/'Nvidia'. The quarantine held (contrast wave #70
  page-2, where a garble leaked into prose). Minor note: 'GPT-4.0' (L61) most likely denotes GPT-4o — the '.0'
  rendering is a mildly ambiguous W-MODELVER-adjacent surface, but it is confined to prose that references the
  correct May-2024 model; disambiguate to 'GPT-4o' if trivial, else leave.
- PC-3 calibration CORRECT: the DeepSeek V3.2 '~30x cheaper than Gemini 3.0 Pro' claim (L71) rests on a hedged
  host aside ('people are putting at roughly') and is honestly capped — source:: Host, source-authority::
  secondary, confidence 0.85 (not 0.95). Weak sourcing appropriately labelled, not overclaimed → PC-3 working.
- dedup 13/13 unique assertion-fp; wikilink-integrity 23/23 resolve (no dangling); tier/confidence ladder sane
  and monotonic (tier-1 facts 0.85-0.95 snapshot, tier-2 analysis 0.8 durable, tier-3 predictions 0.5-0.55
  speculative; volatility aligns with tiers).

Top wisdom:
- Durable (tier-2, L91): the enterprise-AI story of 2025 is that AI/agents are genuinely valuable but demand
  serious reorganisation, data readiness and capacity-building → a widening leader/laggard gap. A structural
  claim that outlives the news cycle (reinforces the wave-#70 leader/laggard and readiness-framework threads).
- Durable (tier-2, L81): the discourse has shifted from first-order 'is vibe coding real' to nuanced questions
  about configuration, speed, autonomy and control in AI-assisted software development — a genuine framing
  insight (echoes wave #70's model-capability→agent-harness framing shift).
- Semi-durable industry signal (tier-1, L61): the SemiAnalysis claim that OpenAI has not completed a successful
  full-scale frontier pre-training run since GPT-4o (May 2024) — a load-bearing capability-trajectory datapoint,
  though a snapshot (correctly tier-1/snapshot).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN again (claim-date == episode-date, not ingest-date). Refinement #1
   (`claim-date:: {episode_date or today}` in `_build_ledger_bullet`, ingest.py L643) HOLDS; no code change
   owed; page does NOT join the DEFERRED pre-fix re-date backlog.
2. PC-6 apply: mint one PC-1-cleared anchor on the orphan FT Gemini-vs-ChatGPT assertion (L31) — e.g.
   [[Model Performance]] or a ChatGPT/Gemini entity — so it joins the graph; orphan beats a false edge if none clears.
3. PC-1 apply: re-point the HP job-cuts link (L11) from [[AI Governance Law and Privacy]] to [[AI-Driven
   Workforce Reduction]] alone (drop the loose governance edge); the same loose governance link on the
   enterprise-reorg analysis (L91) is likewise topically weak — subtract or replace with an enterprise/adoption entity.
4. PC-8 apply: normalise 'Enterprise Ai' → 'Enterprise AI' graph-wide (3rd occurrence of this exact surface,
   #44/#55/#72); merge the variant stub into the canonical node.

STRUCTURAL OUTCOME: single-page wave, verdict GOOD, NO HIGH finding, only one MEDIUM (PC-6 orphan) → HIGH-on-2+-
pages rule mints no new PROPOSED CHANGES block. All findings fold into standing PC-6 (link-coverage floor, now 8
pages), PC-1 (resolving-but-imprecise link subtraction) and PC-8 (casing, 'Enterprise Ai' 3rd page). Positive
controls across the board: Refinement #1 (claim-date==episode-date), PC-2 evidence-guard (ASR confined to
quotes), PC-3 calibration (weak DeepSeek source correctly capped), dedup completeness, zero dangling links, sane
tier ladder. No new watch, no graduation, no new PROPOSED CHANGES block.


### 2026-08-24 — Review wave #73 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-5-minute-ai-weekly-recap-realignment-week.md` verdict ACCEPTABLE.

Defects by kind:
- asr-artefact-leaking-into-assertion-body (MEDIUM, PC-2 — the leak-into-prose variant, cf. wave #70 page-2):
  version numbers ASR-mangled with lost decimals and carried into ASSERTION text, not just the verbatim quote —
  'Opus 48' (=Opus 4.8) and 'GPT 55' (=GPT-5.5) in the assertion body on L21. These corrupted surfaces will not
  resolve/match canonical model entities and pollute downstream entity extraction. Textbook PC-2 evidence-guard
  BREACH (contrast wave #72, where ASR stayed quarantined inside evidence:: and PC-2 held). Fix per PC-2:
  normalise in body AND keep the raw form only inside the verbatim evidence:: quote ('Opus 48'→'Opus 4.8',
  'GPT 55'→'GPT-5.5'; W-MODELVER lost-decimal arm — same failure family as the earlier GPTxx/GPT-4.0 surfaces).
- overconfident-extraordinary-claim (MEDIUM, PC-3 — provenance-grade cap, now recurrence): 'SpaceX completed the
  acquisition of Cursor' (L41) is an extraordinary, low-plausibility event graded tier-1 / conf 0.85, yet its
  OWN evidence is hedged host speculation ('could have some pretty big implication for models') — reported as
  fact but framed as speculative single-source. Same shape: the Anthropic Fable/Mythos export-control suspension
  (L11, conf 0.95) rests solely on 'AI Daily Brief host' as secondary authority. Both exceed the PC-3 cap for
  extraordinary claims on single, secondary, hedged sourcing → down-grade tier/confidence (or add a corroborating
  source) so neither sits at tier-1 / 0.85-0.95.
- transcript-verbatim-hype-in-body (LOW, PC-2 evidence-guard, promotional arm — sibling of the ASR leak): hype
  phrasing is embedded in assertion bodies not confined to evidence — L21 carries 'a marvel' / 'super fast,
  inexpensive, and not too verbose'; L31 carries the marketing claim 'fabled level intelligence at half the
  price' as if factual. Same quarantine remedy as the ASR arm: assertions PARAPHRASE to neutral, checkable
  claims; the promotional quote stays in evidence::. Folds into PC-2's evidence-guard (body-cleanliness) arm.
- source-authority-mislabel (LOW, PC-3 source-authority arm — secondary-relay): L24 tags the Jeremy Howard
  GLM 5.2 quote source-authority:: primary, but the chain is 'via Latent Space and AI Daily Brief host' — a
  relayed second-hand quote = secondary at best. Likewise L94 (Riley Brown 'via host') tagged primary. Primary
  must mean a first-party utterance captured directly; relayed 'via host / via <outlet>' → secondary. Folds
  into PC-3's secondary-relay labelling (same class as prior via-host provenance flags).

POSITIVE CONTROLS (non-defects on an 'acceptable'-verdict page):
- claim-date — CLEAN: claim-date:: 2026-06-21 on every assertion == episode-date:: (2026-06-21), NOT
  ingest-date:: (2026-08-24); episode-date present so claims are correctly episode-dated and re-datable →
  Refinement #1 (`claim-date:: {episode_date or today}`, ingest.py L643) HOLDS; page is post-fix, does NOT join
  the DEFERRED pre-fix re-date backlog. Continues the long post-fix clean streak.

Top wisdom:
- Durable structural framing (Mike McNally / USV): the AI table has been flipped and a window has opened for a
  new ecosystem built on 'tight incentive alignment' between providers and users — the durable insight on the
  page, distinct from the ephemeral model-release news.
- Durable sovereignty/risk signal: provider suspensions/shutdowns create a strategic PULL toward open-weight
  models enterprises can run locally or with greater control (links [[AI Sovereignty]]) — reinforces the
  provider-risk → open-weight thread seen in earlier waves.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN again (claim-date == episode-date, not ingest-date). Refinement #1
   HOLDS; no code change owed; page does NOT join the pre-fix re-date backlog.
2. PC-2 apply: normalise the ASR-mangled version numbers in the assertion body — 'Opus 48'→'Opus 4.8',
   'GPT 55'→'GPT-5.5' (keep the raw form only inside the verbatim evidence:: quote). Reinforces the W-MODELVER
   lost-decimal arm; this wave is an evidence-guard BREACH (leak into prose), contrast wave #72's clean hold.
3. PC-2 apply (promotional arm): move promotional quotes ('a marvel', 'fabled level intelligence at half the
   price') out of assertion bodies into evidence::; paraphrase the claims to neutral, checkable form.
4. PC-3 apply: down-grade tier/confidence on the SpaceX-acquires-Cursor (L41) and Anthropic Fable/Mythos
   suspension (L11) claims, or add a corroborating source — extraordinary single-secondary-hedged claims must
   not grade tier-1 / 0.85-0.95. Also correct source-authority:: primary → secondary on the relayed Jeremy
   Howard GLM 5.2 (L24, via Latent Space/host) and Riley Brown (L94, via host) quotes.

STRUCTURAL OUTCOME: single-page wave, verdict ACCEPTABLE, NO HIGH finding (2 MEDIUM: PC-2 body-leak + PC-3
overconfident-extraordinary; 2 LOW: PC-2 hype-in-body + PC-3 source-authority) → HIGH-on-2+-pages rule mints no
new PROPOSED CHANGES block. All findings fold into standing PC-2 (evidence-guard: ASR lost-decimal + promotional
quarantine) and PC-3 (provenance-grade cap + secondary-relay authority). Positive control: Refinement #1 clean
(claim-date == episode-date). NB PC-2 evidence-guard BREACHED this wave (ASR + hype leaked into prose) after
holding on wave #72 — a two-wave oscillation on the same guard; watch for a third breach before escalating.
No new watch graduation, no new PROPOSED CHANGES block.

### 2026-08-24 ~12:15 — Refinements #7–#8 APPLIED + DEFERRED CLEANUP RUN (team lead)
- **PC-2 (ASR + hype hygiene)** applied to extraction prompt: normalise known name/version
  garbles ('Opus 48'->'Opus 4.8', 'GPT 55'->'GPT-5.5', 'Ilia Sutskaver'->'Ilya Sutskever') in
  structured fields, keep raw only in evidence quote; quarantine promotional phrasing into
  evidence; include specific subject concepts as ontology_terms (feeds PC-6 link-coverage).
- **DEFERRED wikilink cleanup EXECUTED**: cleanup_links.py (reuses ingest._LINK_STOPWORDS)
  stripped 317 wrong-sense generic links across 43 pre-fix pages. pipeline.validate re-checked.
  The false-edge backlog is now cleared; the PC-1 gate prevents recurrence on new pages.
- STILL DEFERRED: episode-date re-date of pre-fix pages (separate pass); PC-6/PC-8 (link-coverage
  floor, casing normalisation) remain prompt-guidance only, folded into the PC-2 prompt update.

### 2026-08-24 — Review wave #74 (synthesiser)
Pages reviewed (2): `podcast-evidence___the-5-most-impactful-ai-model-releases-of-2025.md` (verdict GOOD)
and `podcast-evidence___the-ai-acceleration-gap.md` (AI Daily Brief, ep 2026-01-30; verdict ACCEPTABLE,
10 assertions, 7 tier-2 / 3 tier-3, all quote-backed).

Defects by kind:
- asr-artefact-in-entity-name — STRUCTURED-field (MEDIUM, PC-2 body/source arm, on BOTH pages):
  * page 1 (5-releases): 'Yan Lun'->'Yann LeCun' in the Llama 4 assertion BODY; 'Ethan Malik'->
    'Ethan Mollick' in the Nano Banana source:: field. The Mollick garble is a KNOWN recurrence
    (already in the PC-2 dictionary since wave #3/#7) — confirms the entry's continued value; the
    LeCun garble is a NEW dictionary seed.
  * page 2 (acceleration-gap): 'Matt Bean'->'Matt Beane' (MIT Sloan, 'The Skill Code'; the dropped
    'e' would break person-entity linking); 'NotebookLM co-creator Raza Martin'->'Raiza Martin'.
    Both NEW dictionary seeds in structured attribution.
  All four are the PC-2 structured-field arm (correct, don't just flag) — verbatim quotes left [sic].
  MEDIUM not HIGH, so no PROPOSED CHANGES block; folds into standing PC-2.
- asr-artefacts-in-evidence-quotes (LOW, PC-2 evidence-guard HELD — page 1): quotes are heavy with
  ASR ('ChatBT'/'GBT40', 'Kimmy', 'Grock', 'Menllo Ventures', 'Mistl', 'Sam Alman') BUT the assertion
  bodies use clean canonical names (Kimi K2, Grok, GPT-4o) — textbook good separation, contrast the
  wave #73 breach. Flagged only as evidence-citability noise, not a defect.
- possible-product-name-artefact (LOW, PC-2 verify arm — page 2): 'Claudebot' (Olivia Moore assertion)
  reads like an ASR/paraphrase rendering; the verbatim quote does contain 'Claudebot' so PC-2 held —
  needs a human check against source audio before it canonicalises (likely Claude Code / a Cowork agent).
- attribution-precision (LOW, PC-3 attribution arm — page 2): 'OpenAI co-founder Andrej Karpathy' is
  defensible (founding member) but loosely worded; more precisely a founding member who later led Tesla
  AI. Same class as page-1's over-generous source-authority (below).
- source-authority-mislabel (LOW, PC-3 secondary-relay — page 1): source-authority:: primary on the
  Benioff claim is generous — a host relaying a Benioff tweet is secondary at best. Down-rate to secondary.
- graph-connectivity / link-coverage (LOW, PC-6 — both pages): page 2 carries a [[wikilink]] on only
  3 of 10 assertions; the page's most valuable durable concept — the 'AI acceleration gap' compounding-
  divergence framing — has NO anchor page. Page 1 leaves recurring graph entities unlinked (Kimi K2,
  Qwen, GPT-4o, Grok appear as plain text; only [[Reasoning Models]] is linked). Apply the PC-1-cleared
  PC-6 link-coverage floor; mint an [[AI Acceleration Gap]] / [[AI Adoption Gap]] anchor.
- minor-factual-drift (LOW, non-material — page 1): DeepSeek R1's '$593B' single-day Nvidia market-cap
  drop is within consensus (~$589-593B for 27 Jan 2025) and explicitly attributed to the host's words →
  faithfully sourced, not wrong.

POSITIVE CONTROLS (double-page clean):
- claim-date — CLEAN on BOTH pages. Page 1: claim-date:: 2025-12-27 == episode-date:: 2025-12-27 (NOT
  ingest-date 2026-08-24). Page 2: claim-date:: 2026-01-30 == episode-date:: 2026-01-30. Refinement #1
  (`claim-date:: {episode_date or today}`) HOLDS; both post-fix; NEITHER joins the pre-fix re-date backlog.
- PC-2 evidence-guard HELD on page 1 (raw ASR confined to quotes, canonical names in bodies) — recovers
  from the wave #73 two-wave oscillation; no third breach → de-escalate that watch.

Top wisdom:
- Reasoning models went from ~zero on 1 Jan 2025 to >half of all model usage by Nov 2025 (OpenRouter) —
  a durable, data-backed structural shift in HOW models are used, not ephemeral launch news.
- Chinese open-weight models (Kimi K2, Qwen) rose from near-zero to dominating OpenRouter usage across
  H2 2025 with Meta/Mistral in relative decline (Menlo Ventures data) — a durable competitive realignment.
- The 'AI acceleration gap' as a COMPOUNDING divergence: frontier capability accelerates faster than
  median usage, and advanced use begets further advantage (assertion-fp 954f1591c19c903a); Beane frames
  it as 'driven by privilege', blunting the technology's gains and concentrating power (f699736716105818).
- Karpathy: software engineering is being 'dramatically refactored' as the programmer's contributed bits
  grow increasingly sparse (b26daf95993e79d3) — durable insight on the changing nature of the profession.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN on both pages (claim-date == episode-date). Refinement #1
   HOLDS; no code change owed; neither page joins the pre-fix re-date backlog.
2. PC-2 dictionary adds (structured-field arm): 'Yan Lun'->'Yann LeCun', 'Matt Bean'->'Matt Beane',
   'Raza Martin'->'Raiza Martin'; 'Ethan Malik'->'Ethan Mollick' confirmed as a durable recurrence
   (keep). Correct these in assertion body / source:: at ledger write; leave raw ASR only in evidence::.
3. NEW WATCH — W-EVENTDATE (retrospective/listicle episodes): page 1 is a year-in-review whose uniform
   episode-date (2025-12-27) is a COARSE proxy — its claims reference events spread across 2025 (DeepSeek
   R1 ~2025-01-27, GPT-5 ~2025-08, Opus 4.5 ~2025-11). For episodes flagged retrospective, per-claim
   EVENT dates would beat a single episode-date anchor. This is distinct from Refinement #1 (which is
   correct here). Single page so far -> WATCH, not a PC. If a 2nd retrospective episode recurs, propose
   an extraction-prompt line: 'for retrospective/round-up episodes, extract a per-claim event-date when
   the claim names a datable event, else fall back to episode-date.'
4. PC-3 apply: down-rate source-authority:: primary -> secondary on the page-1 Benioff-tweet-via-host
   claim; tighten the page-2 'OpenAI co-founder Andrej Karpathy' attribution to 'founding member'.
5. PC-6 apply: mint PC-1-cleared anchors — an [[AI Acceleration Gap]] / [[AI Adoption Gap]] concept page
   (page 2's highest-value framing, currently orphaned) and links for the unlinked recurring entities on
   page 1 (Kimi K2, Qwen, GPT-4o, Grok). Verify targets on disk; orphan beats a false edge (PC-1 gate).
6. Human-verify 'Claudebot' (page 2) against source before it canonicalises as an entity.

STRUCTURAL OUTCOME: two-page wave (GOOD + ACCEPTABLE), NO HIGH finding (2 MEDIUM, both the PC-2
structured-field ASR arm, one per page; remainder LOW) -> HIGH-on-2+-pages rule mints NO new PROPOSED
CHANGES block. All findings fold into standing PC-2 (structured-field name normalisation + dictionary adds),
PC-3 (source-authority + attribution precision) and PC-6 (link-coverage floor + concept-anchor mint).
Positive controls strong: Refinement #1 clean on both pages, PC-2 evidence-guard recovered (wave #73
oscillation de-escalated). New watch: W-EVENTDATE (per-claim event dates for retrospective episodes).

### 2026-08-24 — Review wave #75 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-ai-chart-everyone-is-getting-wrong.md` (verdict GOOD).

Defects by kind:
- entity-naming-error / claim↔evidence divergence (MEDIUM, PC-5 entity-name arm): assertion 6 (L61)
  headline names the metric 'Silicon Valley LLM Token Expenditure Index', but its OWN source:: field,
  its evidence:: quote ('Silicon Data themselves...') AND the parallel assertion at L121 all call it the
  'Silicon Data' index. Pure within-page divergence (headline vs evidence + parallel), not an ASR garble
  ('Silicon Valley' is a clean but WRONG substitution) → textbook PC-5 (claim-block states a different
  entity than its own evidence block supports). Fix: 'Silicon Valley' -> 'Silicon Data LLM Token
  Expenditure Index' in the headline to match source/evidence/L121. Reader would otherwise carry away
  the wrong index name and mis-link the entity.
- asr-artefact-entity (MEDIUM, PC-2 structured/body arm) — KNOWN RECURRENCE: 'Manas' (L41/48) in the
  Meta operational-split claim is almost certainly 'Manus' (Manus AI, the Chinese agentic-AI startup)
  mis-heard. This exact garble already appears in the ledger (Meta-acquisition 'Manas'x2 at wave with
  assertion 9; see L2709-2743) → confirms the PC-2 dictionary entry's continued value. Body entity that
  would mint a wrong [[Manas]] identity and fail to dedup against the real [[Manus]] page once entity
  resolution runs. Correct in the assertion body; leave raw only in any verbatim quote.
- asr-artefact-number (LOW, PC-2 evidence-guard HELD): assertion 1 evidence carries 'valuation just shy
  of 1.8 billion [sic]' where the figure is trillion — but the editor already flagged it inline and the
  assertion HEADLINE correctly resolved to $1.8 trillion. Raw ASR error is confined to evidence::, canonical
  value in the body → clean separation, contained. Evidence-citability noise, not a defect; PC-2 held.

POSITIVE CONTROLS:
- claim-date — CLEAN. claim-date:: == episode-date:: 2026-06-13 (NOT ingest-date 2026-08-24). Refinement #1
  (`claim-date:: {episode_date or today}`) HOLDS; page is post-fix and does NOT join the pre-fix re-date
  backlog. No code change owed.
- PC-2 evidence-guard HELD (raw ASR number stayed in evidence::, canonical in body) — no fresh oscillation.

Top wisdom:
- Inference economics (durable structural fact): analyst estimates (Max Weinbach et al.) put API margins on
  the most inference-intensive tokens at ~70%, leaving room for ~60% price cuts while staying profitable —
  frontier-model unit economics, not a news snapshot.
- Methodology critique (durable reading caution): the Silicon Data LLM Token Expenditure Index draws only
  from third-party token routers whose PURPOSE is to route to cheaper models, so it systematically
  exaggerates the apparent shift away from high-cost frontier models — a permanent caveat on that chart.
- Framing/mental model: 'token maxing -> token panic' reframed as a market RATIONALISING (allocating scarce
  top-tier AI to those who use it most effectively) rather than a bubble popping — reusable interpretive lens.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN (claim-date == episode-date 2026-06-13). Refinement #1 HOLDS;
   no code change owed; page does not join the pre-fix re-date backlog.
2. PC-5 apply: correct assertion-6 headline 'Silicon Valley' -> 'Silicon Data LLM Token Expenditure Index'
   to match its own source::/evidence:: and the parallel L121 assertion (claim↔evidence entity reconcile).
3. PC-2 apply: normalise body 'Manas' -> 'Manus' (Manus AI) — confirmed dictionary recurrence; verify
   against episode audio/source before it canonicalises so it dedups/links to the correct [[Manus]] page.
4. PC-4 touch (durable↔ephemeral tier, refinement suggestion): promote the two durable analytical assertions
   (index-methodology critique, ~70% inference margins) with explicit entity wikilinks; the tier-1
   IPO/valuation/funding items are ephemeral snapshot news with lower long-term graph value. Reinforces
   PC-4; no graduation event.

STRUCTURAL OUTCOME: single-page wave, verdict GOOD, NO HIGH finding (2 MEDIUM: PC-5 entity-name divergence +
PC-2 body ASR recurrence; 1 LOW: PC-2 evidence-guard held) → HIGH-on-2+-pages rule mints NO new PROPOSED
CHANGES block. All findings fold into standing PC-5 (claim↔evidence entity reconcile), PC-2 (body-field name
normalisation, 'Manas'->'Manus' recurrence confirmed) and PC-4 (durable↔ephemeral tier promotion). Positive
controls clean: Refinement #1 (claim-date == episode-date) and PC-2 evidence-guard both held. No new watch,
no watch graduation, no new PROPOSED CHANGES block.

### 2026-08-24 — Review wave #76 (synthesiser)
Pages reviewed (8) — RE-REVIEW of the identical batch already synthesised as **wave #55** (line ~3724),
which itself consolidated the per-page waves #1–#8. Findings reconcile against #55; only deltas are called out.
- autoresearch-agent-loops-and-the-future-of-work — acceptable
- beating-the-ai-doom-cycle — acceptable
- bezos-is-back-to-build-ai — acceptable
- black-friday-gpt — good  (was 'acceptable' in #55 — verdict lift, no new defect)
- can-open-models-solve-corporate-ai-washing — good
- can-todays-ai-replace-12-of-work — acceptable
- ceo-led-ai-gets-3x-the-roi — acceptable
- chatgpt-55-rumors-start-to-bubble — good  (was 'acceptable' in #55)

Defects by kind (all map to already-APPLIED classes; merged, not restated from #55):
- claim-date == ingest-date — DEFECT PRESENT on the SAME 2 pages (autoresearch → episode 2026-03-10;
  doom-cycle → episode 2026-05-26); pages 3-8 clean positive controls (claim-date == their episode-date).
  Unchanged from #55: pre-Refinement#1 BACKLOG, not a regression — the live `_build_ledger_bullet` fix holds
  on all 6 post-fix pages. These 2 remain owed a DEFERRED re-date (+ re-link, per #55 proposal 2). No code owed.
- wikilink false-friends (PC-1, HIGH on 1 page only → HIGH-on-2+ does NOT fire): [[Prometheus]] (monitoring
  tool vs Bezos 'Project Prometheus', page 3, HIGH); [[Privacy Engineering]] / [[AI Upscaling and Super-
  Resolution]] / [[Testing]] (page 3, MEDIUM); [[Neuroimaging]] (page 7); Spatial-AI-Assistant / Dynamics /
  Process / performance (page 4). DELTA vs #55: [[CBECI Methodology]] (Cambridge Bitcoin Electricity Index)
  and [[Solid]] (Berners-Lee protocol) on can-todays-ai (page 6) — a fresh cross-domain false-match example
  for PC-1's source↔target-domain guard (matched on 'index'/'methodology'/'solid'). Add solid/index/
  methodology to the generic-token stop-list. All fold into PC-1; the applied gate covers future episodes.
- non-canonical casing (PC-8): [[Enterprise Ai]] recurs on can-open-models (page 5) and ceo-led (page 7) —
  the exact variant PC-8 owns. No graduation event; reinforces PC-8.
- ASR entity garbles in load-bearing text (PC-2, MEDIUM): page 3 Vik Bahaj / Ethan Mollick / Mira Murati /
  Ilya Sutskever (assertion+source::), page 7 'Mark Andreessen Horowitz' (person↔a16z conflation), page 8
  'Sweet Pee' leaked into claim text. All already in the PC-2 dictionary from #55. DELTA: doom-cycle page 2
  'Alex Emos' now RESOLVED by the reviewer to economist **Alex Imas** — promote from the #55 'unverified'
  flag to a PC-2 dictionary seed (was 'Emos'); 'Gloria Cordfield' stays unverified/do-not-enshrine.
- provenance/tier calibration (PC-3/PC-4): doom-cycle page 2 anonymous-Reddit Copilot billing figures
  ($451→$11,432.22) carried tier-1/0.85 → demote to tier-2 (single anonymous source); chatgpt-55 page 8
  tier-1 news-roundup items at 0.95 → soften toward 0.9. Covered by applied PC-3/PC-4; grader nudge only.
- title-content-mismatch (LOW, note): chatgpt-55 page title says 'ChatGPT 5.5' but the body rumour is
  GPT-5.3 / codename 'Garlic'; title inherited from source episode. Cosmetic; verify 'Sweet Pee'→'Sweet P'
  before it hardens (PC-2). Single page, no watch.
- NON-DEFECTS (PC-2 evidence-guard HELD): raw ASR confined to evidence:: quotes — 'Kimmy K3' (page 5),
  'cloud code'→Claude Code / 'snip check' (page 6), transcript typos on pages 1/2/8. Clean separation.

Top wisdom (unchanged high-value keepers from #55, not re-listed in full):
- Agentic-loop 'work-primitive' triad — objective score + fast/cheap iteration + low failed-attempt cost —
  and the human role shifting to 'arena design' (author program.md, build the evaluator) (autoresearch, durable).
- Missing shared semantic-memory layer is the binding constraint on multi-agent research ('Agent 47 knows
  Agent 12 already tried that') — maps directly onto our RuVector thesis (autoresearch, durable).
- Relational-sector thesis: where human provenance is itself part of a good's value, that sector rises as
  automation cheapens commoditised sectors (doom-cycle / Alex Imas, durable).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED AGAIN (2 pre-fix pages), but the one-line fix is ALREADY APPLIED
   (Refinement #1, 05:15). For the record, the fix in ingest.py `_build_ledger_bullet` is:
   `claim_date = episode_date` (fall back to `ingest_date` only when `episode_date` is absent) — i.e.
   `claim-date:: {episode_date or ingest_date}` (was `{ingest_date}`). No further code owed. ACTION: the two
   pre-fix pages (autoresearch → 2026-03-10, doom-cycle → 2026-05-26) stay on the DEFERRED re-date+re-link
   backlog (waves #1/#2); all 6 post-fix pages remain clean controls.
2. PC-2 dictionary add: **Alex Imas** (was 'Alex Emos') — reviewer-resolved this wave; graduate from the #55
   unverified flag. Keep 'Gloria Cordfield' / 'Sweet Pee' as uncertain-flag pending source-check.
3. PC-1 stop-list add: `solid`, `index`, `methodology` (cross-domain false matches on can-todays-ai:
   [[Solid]], [[CBECI Methodology]]); reaffirm 'create the specific entity (Project Prometheus / Safe
   Superintelligence) rather than link the generic same-name stub' facet from #55.

STRUCTURAL OUTCOME: re-review of the wave-#55 batch; NO regression against the applied fixes. The single HIGH
finding ([[Prometheus]] false-friend, PC-1) lands on ONE page → HIGH-on-2+ rule does NOT fire → no new PROPOSED
CHANGES block. No watch graduation (W-YEARINFER recurs on its original page only; PC-8 casing reinforced, not
graduated). Everything folds into already-APPLIED PC-1 / PC-2 / PC-3 / PC-4 / PC-8. Net new: one PC-2 dictionary
seed (Alex Imas) and three PC-1 stop-list tokens (solid/index/methodology). Standing item claim-date remains
fixed-and-applied; the two pre-fix pages stay on the deferred re-date+re-link backlog.

### 2026-08-24 — Review wave #77 (synthesiser)
Pages reviewed (2), both verdict GOOD:
- podcast-evidence___the-ai-productivity-boom-finally-shows-up (episode 2026-02-17)
- podcast-evidence___the-ai-race-gets-a-massive-power-shift (episode 2025-12-14) — the H200/Lutnick page
  first seen in **wave #23** (line ~2326); the identical `[[NVIDIA H200]] [[NVIDIA H200]]` double-link recurs,
  so treat page-2 findings as a recurrence, not net-new.

Defects by kind (all map to already-APPLIED classes; merged, not restated):
- ASR entity garbles (PC-2) — three instances across both pages, all MEDIUM-or-lower:
  * page-2 source:: 'Alex Staff (Co-founder of IFP)' → **Alec Stapp** (Institute for Progress co-founder),
    MEDIUM, structured/source:: arm → PC-2 dictionary seed (NEW).
  * page-2 source::/evidence:: 'Howard Lutnik' → **Howard Lutnick** (Commerce Sec.), LOW; Lutnick already in
    the PC-2 corpus (waves #… /line ~4002) — reinforces, not new.
  * page-1 evidence:: 'Dodge cuts' → **DOGE** (Dept. of Government Efficiency), LOW, evidence-only arm —
    PC-2 evidence-guard HELD (assertion body correctly abstracts to 'budget cuts'; garble confined to the
    verbatim quote, no entity/link leak). Normalise in stored evidence for cleanliness only.
- duplicate-wikilink (LOW, PC-1 in-block de-dup): page-2 L31 `[[NVIDIA H200]] [[NVIDIA H200]]` — the EXACT
  mechanical duplication catalogued in wave #23 (line 2326). Folds into PC-1 dedup; no new mechanism.
- volatility mis-calibration (LOW, PC-4): page-1 Alex Imas assertion (L101) is tier:: 2 [Industry analysis]
  but volatility:: snapshot while its tier-2 siblings are volatility:: durable. Defensible (dated one-off
  reaction) but inconsistent; grader-calibration nudge, same bucket as prior PC-4 durable↔snapshot reconciles.
- stale-ingest-gap (LOW, NON-DEFECT, PC-4 working-as-intended): page-2 episode 2025-12-14 vs ingest 2026-08-24
  (~8-month gap); tier-1 snapshot rows (Nvidia +2%, FT reporting, 'this week' EO) correctly volatility:: snapshot
  → tiering is honest, consumers should read those rows as historical. No action.

Positive controls (claim-date standing item — Refinement #1):
- BOTH pages CLEAN. page-1 claim-date:: 2026-02-17 == episode-date (≠ ingest 2026-08-24); page-2
  claim-date:: 2025-12-14 == episode-date on every assertion (≠ ingest). The live `_build_ledger_bullet`
  fix (`claim-date:: {episode_date or ingest_date}`) HOLDS on both. No code owed; neither page joins the
  pre-fix re-date backlog. episode-date:: present on both for any future re-dating.

Top wisdom:
- Brynjolfsson's 'experimentation → utility' phase transition: 2025 data marks earlier intangible AI
  investment starting to show as measurable output — a durable interpretive lens, not a datapoint (page-1 tier 2).
- 'Canaries in the Coal Mine' finding: interest rates do NOT explain the disproportionate entry-level hiring
  decline in AI-exposed occupations; the decline is statistically significant only from 2024 under broad
  controls — a caveated causal claim with methodological weight (page-1 tier 2).
- Guy Berger's epistemic counterweight: the BLS revision is 'very thin evidence' for AI-driven productivity —
  it mostly removed government (DOGE) workers and counted mining/logging/transport/manufacturing layoffs, not
  AI-exposed sectors — durable skeptical framing that survives the news cycle (page-1 tier 2).
- Counterintuitive geopolitical thesis (highest-value on page-2): access to more advanced US hardware
  historically SPEEDS UP China's semiconductor self-reliance rather than slowing it (fp:43c5acd8b47f7777).
- Lutnick's interdependence/lock-in doctrine: sell China enough chips to make its developers 'addicted to the
  American technology stack' (fp:8d844abe8b031034); H200 ≈ 6× the H20's performance anchors the compute-share
  debate (fp:5b60aee428567757).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN AGAIN (2/2 positive controls). Fix already applied
   (Refinement #1); no further code owed; neither page joins the pre-fix backlog.
2. PC-2 dictionary seed (NEW): **Alec Stapp** (was 'Alex Staff', Institute for Progress co-founder).
   Reinforce existing seeds **Howard Lutnick** (was 'Lutnik') and **DOGE** (was 'Dodge'). Normalise the
   'Dodge cuts' evidence:: verbatim on page-1 for cleanliness (evidence-only, low priority).
3. PC-1: de-dup page-2 L31 `[[NVIDIA H200]] [[NVIDIA H200]]` — same in-block duplication as wave #23; covered
   by the applied PC-1 dedup, apply on the page.
4. PC-4: reconcile the Alex Imas assertion volatility (snapshot → durable to match tier-2 siblings, OR accept
   as a dated one-off); grader-calibration nudge only.
5. Provenance (page-2 refinement, optional): the tier-3 China-commentator single-source claims (author of
   'Red Roulette') could mint a named **[[Desmond Shum]]** entity rather than an anonymous descriptor to
   strengthen provenance — PC-9/attribution flavour, low priority.

STRUCTURAL OUTCOME: two-page wave, both GOOD, NO HIGH finding (max is a MEDIUM PC-2 source:: garble on one
page) → HIGH-on-2+-pages rule does NOT fire → no new PROPOSED CHANGES block, no watch graduation. All findings
fold into already-APPLIED PC-1 (dedup), PC-2 (ASR normalisation) and PC-4 (volatility calibration). Net new:
one PC-2 dictionary seed (**Alec Stapp**); Lutnick/DOGE reinforced. claim-date standing item remains
fixed-and-applied with 2/2 clean positive controls; no page joins the deferred backlog.

### 2026-08-24 — Review wave #78 (synthesiser)
Pages reviewed (2), both verdict GOOD:
- podcast-evidence___the-ai-scientist-that-does-6-months-of-work-in-a-day (episode 2025-11-18) — Cosmos /
  Edison Scientific / FutureHouse.
- podcast-evidence___the-ai-subsidy-era-is-over (episode 2026-04-30) — AI-inference / usage-pricing.

Defects by kind (all LOW; all fold into already-APPLIED classes; merged, not restated):
- ASR artefacts confined to evidence:: (PC-2 evidence-guard HELD, NON-DEFECT): page-1 'post-docctoral' (L18)
  and '20step' missing-space (L78) — cosmetic, inside quoted evidence only, no entity/link leak. Entity names
  clean (Sam Rodriguez, Andrew White, Nico McCardi, Carlos Perez, Simon Smith, Zachary Flamholtz, Sam Altman);
  'Nico McCardi'/'Zachary Flamholtz' UNVERIFIED — uncertain-flag, do-not-enshrine (same discipline as Gloria
  Cordfield #55). Normalise the two evidence typos for cleanliness only.
- weak-tag / semantic mismatch (LOW, PC-3 attribution flavour): page-1 L61 [[OpenAI API]] on the Sam Altman
  tweet is tag drift — the tweet is about AI-driven scientific discovery, not the API product; the co-tag
  [[Scientific Discovery]] carries the real meaning. Retag toward the concept, drop [[OpenAI API]].
- org-naming unreconciled (LOW, PC-9 entity-resolution): page-1 attributes Cosmos to 'Edison Scientific'
  while Altman's quoted tweet credits 'the future house team' — Edison Scientific IS the FutureHouse spinout,
  defensible but the two names sit unlinked. Mint an alias/same-as edge (Edison Scientific ⊂ FutureHouse) so
  downstream entity resolution doesn't split them.
- volatility mis-calibration (LOW, PC-4): page-2 two directional adoption/benefit-trend assertions marked
  volatility:: snapshot where durable fits — L71 (never-used-AI 26%→17% / frequent-use 17%→24%, Nov 2025–Apr
  2026) and L91 (new-capabilities benefit 21.9%→29.3%). Trends, not point-in-time facts → reclassify durable.
  Same snapshot↔durable bucket as prior PC-4 reconciles; grader-calibration nudge.
- concept near-duplicate siblings (LOW, standing graph-dedup concern, NOT a page defect): page-1 links resolve
  exactly but targets have singular/plural twins graph-wide — 'World Model' vs 'World Models', 'Multi-Agent
  System' vs 'Multi-Agent Systems', 'Large Language Model' vs 'Large Language Models'. Graph-wide concept-dedup
  item (canonicalise singular↔plural), not owed by this page.

Non-defects (working-as-intended, logged for awareness):
- wikilinks: page-1 14/14 and page-2 10/10 targets resolve to exact page files (space-not-underscore filenames;
  naive underscore checks false-report misses — reaffirms the wave-#… filename-convention note).
- dedup / tier-confidence ladders sane on both: page-1 15/15 distinct assertion-fp, tier-1 0.85–0.95 /
  tier-2 0.7–0.9 / tier-3 0.6; page-2 12/12 distinct fp, tier-1 0.85–0.98 / tier-2 0.75–0.85 / tier-3 0.60–0.65.
  source-authority + volatility fields consistently populated.
- two-hop relays correctly downgraded (PC-3 working): page-2 'Goldman Sachs (via Hedgeye Markets)' (L51) and
  'Peter Diamandis (via Chandra Duggarala)' (L101) → source-authority:: secondary with the chain disclosed.

Positive controls (claim-date standing item — Refinement #1):
- BOTH pages CLEAN. page-1 episode-date:: 2025-11-18, all claim-date:: 2025-11-18 (≠ ingest 2026-08-24);
  page-2 episode-date:: 2026-04-30, all 12 claim-date:: 2026-04-30 (≠ ingest). The live `_build_ledger_bullet`
  fix (`claim-date:: {episode_date or ingest_date}`) HOLDS on both; no code owed; neither page joins the
  pre-fix re-date backlog. episode-date:: present on both for any future re-dating.

Top wisdom:
- Cosmos's core mechanism is a structured, continuously-updated shared 'world model' (functionally a knowledge
  graph / live whiteboard) that lets hundreds of parallel agents exceed the effective information capacity of
  any long-context LLM (page-1 L51/91/131, durable) — maps onto the RuVector shared-semantic-memory thesis
  (cf. autoresearch #… 'Agent 47 knows Agent 12 already tried that').
- Durable epistemics caution: the '6 months of work in a day' headline is handwavy — it assumes humans must
  read hundreds of papers to discover, whereas strong scientists triangulate from fewer targeted resources
  (page-1 L111). A lasting counter to agent-throughput-as-value framing.
- UX-spectrum thesis: autonomous long-run agents vs real-time collaborative prompting is a use-case-dependent
  toggle, not a solved default (page-1 L121/141, durable product-design principle).
- 'Model sommelier' / cheap-model bake-off as a staffed enterprise role — continuously re-select the most
  cost-effective model per task rather than defaulting to frontier (page-2 tier-3, durable, actionable).
- Physical compute constraints (grid limits, component shortages, data-centre build barriers) will brake AI
  diffusion more than voluntary policy pauses (page-2 tier-3, durable structural insight).
- Altman reframing OpenAI as 'an AI inference company': strategic value shifting from training to efficient
  inference delivery (page-2 tier-2, durable framing shift).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN AGAIN (2/2 positive controls). Fix already applied
   (Refinement #1); no further code owed; neither page joins the pre-fix backlog.
2. PC-4: reclassify page-2 L71/L91 adoption/benefit-trend assertions volatility:: snapshot → durable
   (directional trends, not point-in-time). Grader-calibration nudge; covered by applied PC-4.
3. PC-9 entity-resolution: add an alias/same-as edge Edison Scientific ⊂ FutureHouse (page-1) so the spinout
   and parent org don't split downstream. Keep 'Nico McCardi' / 'Zachary Flamholtz' on the uncertain-flag
   until source-checked (do-not-enshrine).
4. PC-3 retag: drop [[OpenAI API]] on page-1 L61 in favour of the concept co-tag [[Scientific Discovery]]
   (semantic mismatch). PC-2 cleanliness: normalise 'post-docctoral'→'post-doctoral' and '20step'→'20 step'
   in stored evidence (evidence-only, low priority).
5. Graph-wide concept-dedup (standing, not this-wave-owed): canonicalise singular↔plural concept twins
   (World Model(s), Multi-Agent System(s), Large Language Model(s)); tracked as an ongoing graph-hygiene item.
6. Optional (page-2 refinement): shorten the review-by horizon on the GitHub Copilot pricing snapshots
   (L11/L21, near-future 2026-06-01 effective dates + multipliers that age fast).

STRUCTURAL OUTCOME: two-page wave, both GOOD, NO HIGH finding (max severity LOW across both pages) →
HIGH-on-2+-pages rule does NOT fire → no new PROPOSED CHANGES block, no watch graduation. All findings fold
into already-APPLIED PC-2 (ASR/evidence-guard), PC-3 (weak-tag), PC-4 (volatility) and PC-9 (entity
resolution). Net new: one PC-9 alias edge (Edison Scientific ⊂ FutureHouse); two uncertain-flag entities
(Nico McCardi, Zachary Flamholtz). claim-date standing item remains fixed-and-applied with 2/2 clean positive
controls; no page joins the deferred backlog.

### 2026-08-24 — Review wave #79 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-ai-token-shortage-begins.md` (episode 2026-06-01), verdict
ACCEPTABLE. NOTABLE synthesis event: W-MISATTRIB hits its pre-registered 2nd-page trigger → GRADUATES to PC-10.

Defects by kind (merged onto existing classes; the sole HIGH is single-page so does NOT fire the 2+-page rule):
- source-inherited cross-entity misattribution (MEDIUM → GRADUATES W-MISATTRIB → PC-10): L71 "SpaceX's AI
  division (XAI)" attributes Colossus 1/2 to SpaceX. Colossus is **xAI's** and xAI is a standalone Musk company,
  NOT a SpaceX division — a false ownership/containment edge between correctly-named entities, inherited from the
  transcript (Elon-adjacency merge). SAME Colossus/xAI conflation that opened W-MISATTRIB on wave #70 → 2nd page
  → graduates (via the watch's own trigger, NOT the HIGH-on-2+ rule). The compute deal itself is real; only the
  attribution is wrong. Orphan too: no xAI page (only unrelated `xDai.md`) — mint [[xAI]] under PC-6.
- ASR garble breaching claim/entity surface (HIGH, PC-2 recurrence — highest-blast subclass): L81 names the
  entity **'Base 10'**, an ASR corruption of **Baseten** (real inference-infra co; transcript rendered 'Baseten'
  →'base 10'). NOTABLE: the corruption did NOT stay confined to evidence:: (where the PC-2 evidence-guard holds
  it) — it propagated into the CLAIM text and the ontology term, minting a wrong entity, not just a wrong quote.
  Single page → HIGH but no 2+-page block; reinforces PC-2 with a claim-surface note + dictionary seed
  **Baseten** (was 'Base 10' / 'base 10'). Also orphan (no Baseten page → PC-6).
- numeric magnitude implausibility carried too hot (MEDIUM, PC-3 numeric-outlier arm + W-EXTRAORD flavour): L41
  "$65 million round, valuing the company at just under $1 trillion" is internally impossible (a $65M raise vs a
  ~$1T valuation is a rounding error) — almost certainly an ASR magnitude garble ($65 **billion**). Evidence is
  faithful to the transcript, so PC-5 is CLEAN; the residual is that tier:: 1 / confidence:: 0.85 overstates
  trust in a self-evidently corrupt figure. Cap confidence + attach a verification-needed / data-quality flag,
  do not silently trust — exactly the PC-3 numeric-implausibility class (cf. wave-#7 445% YoY @0.98).
- assertion-level orphan entities (LOW, PC-6 recurrence): 3 tier-1 assertions emit ZERO wikilinks — Uber CTO /
  AI budget (L51), Base 10/Baseten (L81), DeepSeek V4 price cut (L111). Uber + DeepSeek are recurring graph-worthy
  entities; leaving them bare loses cross-episode connectivity. PC-6 top-up: add [[Uber]], [[DeepSeek]], [[Baseten]].

Positive control (claim-date standing item — Refinement #1) — CLEAN:
- The known ingest-date defect does NOT manifest. claim-date:: 2026-06-01 EQUALS episode-date:: (2026-06-01),
  ≠ ingest-date (2026-08-24); episode-date:: present. The live `_build_ledger_bullet` fix
  (`claim-date:: {episode_date or ingest_date}`) HOLDS; no code owed; page does not join the pre-fix re-date
  backlog. Residual (LOW, W-EVENTDATE reinforced — 2nd page, NEW news-roundup sub-flavour): every claim carries
  the uniform episode date though the text cites more specific event dates (Copilot 'late April 2026' L11, Uber
  'April' L51, DeepSeek/Google/OpenAI/Anthropic 'May 2026'). W-EVENTDATE #74 was a retrospective/listicle episode;
  this is a current-news roundup whose events span the weeks before the episode — same per-claim-event-date remedy,
  broader trigger. Broadens the watch; stays a watch (different subtype + LOW, no graduation).

Top wisdom:
- The relevant economic unit for AI companies has shifted from the 'seat' to the 'token' — revenue is now driven
  by API/token consumption rather than seat-conversion (fp a6285e3649f44b5e). Durable framing that outlives any
  single quarter's numbers.
- Secular shift from an 'AI subsidy era' to a 'token scarcity era': a structural compute shortage ends flat-rate
  subsidised subscriptions (fp a45dc8d9de6ac6b4) — the load-bearing thesis and most portable idea on the page.
- Model releases are becoming less significant than harness/tooling updates — 'model releases start to feel like
  iPhone releases' (fp 8ec15ae3aa8bcfc2). Durable strategic insight vs the surrounding ephemeral revenue snapshots.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN (1/1 positive control this wave). Fix already applied (Refinement
   #1); no further code owed; page does not join the pre-fix backlog.
2. W-MISATTRIB GRADUATES → PC-10 (new PROPOSED CHANGES block above): verify-pass relationship check on load-bearing
   "A {owns|grants|controls|acquired|is-a-division-of} B" clauses; seed Colossus 1/2 → xAI and xAI ⟂ SpaceX; never
   collapse sibling Musk entities into parent/child on shared-founder adjacency. Team lead applies to ingest.py.
3. PC-2 dictionary seed: **Baseten** (was 'Base 10' / 'base 10'), with a claim-surface note — this ASR garble
   breached the evidence→claim guard and reached the ontology term, so the PC-2 verify pass must normalise entity
   ASR in CLAIM/link surfaces, not just source::/evidence::. Highest-blast PC-2 subclass (spurious entity minted).
4. PC-3 numeric-outlier: down-confidence the L41 '$65M at ~$1T' claim (cap confidence, attach verification-needed /
   data-quality flag) — magnitude is almost certainly a transcript garble ($65B). Reinforces PC-3 + W-EXTRAORD.
5. PC-6 top-up: add [[Uber]], [[DeepSeek]], [[Baseten]] (the last once minted) to preserve cross-episode links;
   pair with the [[xAI]] node from PC-10.
6. W-EVENTDATE reinforced (2nd page, news-roundup sub-flavour): optionally re-date claims from the uniform
   episode-date to the per-event April/May 2026 dates already present in the evidence, now that episode-date makes
   re-dating safe. Watch broadens; no graduation.

STRUCTURAL OUTCOME: single-page ACCEPTABLE wave. The HIGH finding (Base 10/Baseten) is single-page → the
HIGH-on-2+-pages rule does NOT fire. The new PROPOSED CHANGES block (PC-10) is opened solely by W-MISATTRIB
meeting its own pre-registered 2nd-page graduation trigger (per PC-4/PC-5/PC-6/PC-7/PC-9 discipline), NOT by a
fresh HIGH-on-2+ class. All other findings fold into already-graduated PC-2 (ASR/entity — + claim-surface note
and Baseten seed), PC-3 (numeric-outlier confidence cap) and PC-6 (link floor — Uber/DeepSeek/Baseten/xAI).
claim-date standing item remains fixed-and-applied with a clean positive control; page does not join the backlog.
Net new: PC-10 (graduated); one PC-2 dictionary seed (Baseten); one W-EVENTDATE sub-flavour (news-roundup).

### 2026-08-24 — Review wave #80 (synthesiser)
Pages reviewed (2): `podcast-evidence___the-anti-ai-movement.md` (episode 2026-02-25, 13 assertions, verdict
GOOD) and `podcast-evidence___the-best-claude-design-use-cases.md` (episode 2026-04-20, 14 assertions, verdict
GOOD). Clean wave: max severity LOW across both pages, no HIGH anywhere.

Defects by kind (all LOW; merged onto existing classes):
- ASR garble in the structured source:: field — RECURS ACROSS BOTH PAGES (PC-2 source arm, cf. #… 'Andy Henny'
  seed): page-1 New Brunswick data-centre claim carries `source:: Ben Zobiaak (Organizer)` ('Zobiaak' an
  unverified ASR transliteration of the organiser surname); page-2 export-limitations claim carries
  `source:: Neufar Gaspar` (ASR mangle of **Nufar Gaspar**, a known AI-industry figure). NOTABLE placement: both
  sit in the source:: field — the middle tier between the PC-2 evidence-guard (holds ASR inside evidence::, working
  well here) and the PC-10 claim-surface breach (ASR reaching the claim/entity/ontology term, #79). Neither mints a
  bad graph node (no [[wikilink]] entity), so blast radius is low, but the attribution string is corrupt. 2 pages
  → reinforces the PC-2 **source arm**; does NOT graduate (LOW, and PC-2 already applied — the source-field
  normalisation is within PC-2's remit, not a new class). PC-2 dictionary seed: **Nufar Gaspar** (was 'Neufar
  Gaspar'). For 'Zobiaak' keep raw-in-evidence + prefer generic `source:: Organizer` until the surname is verified
  (do-not-enshrine an unverified transliteration).
- weak/unresolved source handle (LOW, PC-3 source-authority arm — page-2): two assertions cite
  `source:: Smart App / smart app on Twitter`; the evidence 'The smart app on Twitter' reads as a mangled/unresolved
  X handle, not a real attributable account. Correctly held at secondary and not promoted to an entity. Residual:
  resolve to a real handle or down-authority; do not enshrine an unresolved account name.
- non-title-case wikilink (LOW, W-CASE / PC-8 — page-1): `[[Public Trust In Ai]]` uses 'Ai' not 'AI'. Resolves to an
  existing file, so no orphan, but is stylistically inconsistent with the 'AI' casing used graph-wide. Folds into the
  standing PC-8 casing-normalisation guidance; no new action beyond the existing canonicalisation backlog.
- volatility ephemerality note (LOW, W-DECAY flavour — page-1): the five YouGov/Pew poll snapshots are correctly
  tagged `volatility:: snapshot` yet sit at tier 1 / 0.9–0.95. The high confidence is defensible (accurately
  transcribed primary poll numbers) but consumers should treat them as fast-decaying, not durable graph facts —
  exactly what the snapshot tag encodes. No re-tier owed; the banding is internally consistent (page-2's Figma -7%
  share-price / Krieger board-resignation / 30-min rate-cap snapshots are the same correctly-tagged low-durability
  tail).

POSITIVE-DISCIPLINE observations (the healthy cases the workflow hunts for — no action, recorded as calibration):
- PC-2 evidence-guard WORKING on page-1: ASR mangles are cleaned in the assertion prose (YouGov, Ethan Mollick,
  Sam Altman) while the raw transcription ('Yuggov', 'Ethan Malik', 'canled', 'disincclination') is preserved
  verbatim in evidence:: with [sic]. Textbook provenance discipline — clean entity in the claim, honest raw text in
  evidence. This is the guard PC-10/#79 found breached; here it holds. The only residual is the source:: field
  (above), which the evidence-guard does not cover — hence the PC-2 source-arm note.
- Dedup markers fully present on both pages: all 13 + 14 assertions carry unique assertion-fp comments; no
  intra-page or cross-page fingerprint reuse. PC-1 clean.
- Tier/confidence banding sane and monotonic on both pages (T1 poll/quote/architectural facts 0.85–0.95, T2 named-
  analyst interpretation 0.75–0.85, T3 host forecast / emerging signal 0.6); source-authority correctly downgrades
  host takes to single-source and Time Magazine to secondary. No PC-3/PC-4 calibration owed.
- Wikilinks resolve: page-1 6/6, page-2 8/8 all point to existing page files. No PC-6 orphan this wave.

Positive control (claim-date standing item — Refinement #1) — CLEAN ×2 (2/2 this wave):
- The known claim-date=ingest-date defect does NOT manifest on either page. page-1 `episode-date:: 2026-02-25`,
  ALL 13 `claim-date:: 2026-02-25`; page-2 `episode-date:: 2026-04-20`, ALL 14 `claim-date:: 2026-04-20`. Both
  equal the episode-date, ≠ ingest-date (2026-08-24); episode-date:: present on both. The live
  `_build_ledger_bullet` fix (ingest.py:653, `claim-date:: {episode_date or today}`) HOLDS; no code owed; neither
  page joins the pre-fix re-date backlog. The standing one-line fix is confirmed applied and correct — nothing to
  re-propose.

Top wisdom:
- Nate Silver's 'mezzo scale' framing (fp ec98f6ec): local data-centre opposition may be irrational at the micro
  scale but at the mezzo scale reflects a rational, durable public doubt about whether AI broadly benefits society —
  'people don't like being forced into prisoners' dilemmas they didn't ask for.' Most durable, transferable insight
  in the wave.
- Job displacement — not existential risk or technical skepticism — is the biggest, most broad-based and most
  politically consequential axis of anti-AI sentiment (host, fp 295412e): a durable framing for reasoning about
  AI-policy backlash. Paired contrarian: rigid capability-skeptics may cause more individual economic harm than
  hype-merchants by reinforcing the public's disinclination to adapt (fp 2af0b6f9).
- Claude Design generates visuals via code + SVGs rather than a native image model (fp c9f58ecc, tier 1) — durable
  architectural insight that explains the whole product philosophy and outlasts the news cycle; with the asset-design
  vs systems-design lens distinguishing Canva from Claude Design (fp a5b86f7e) and the prompt-engineering rule that
  you must explicitly ban the tool's default 'generic SaaS / YC-batch' aesthetic (Inter, predictable gradients;
  fp 6979b290).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN AGAIN (2/2 positive controls this wave). Fix already applied
   (Refinement #1, ingest.py:653); no further code owed; neither page joins the pre-fix backlog.
2. PC-2 source arm reinforced (2 pages): normalisation must cover the source:: field, not only evidence::/claim.
   Dictionary seed **Nufar Gaspar** (was 'Neufar Gaspar'). For unverified transliterations lacking a dictionary
   match (page-1 'Ben Zobiaak'), prefer a generic `source:: Organizer` and keep the raw surname in evidence:: —
   do-not-enshrine. Within PC-2's applied remit; no new PROPOSED CHANGES block.
3. PC-3 source-authority: resolve `Smart App / smart app on Twitter` (page-2) to a real X handle or hold at
   single-source; do not promote an unresolved account name to an entity.
4. PC-8 / W-CASE: normalise `[[Public Trust In Ai]]` → `[[Public Trust In AI]]` (and fold into the graph-wide
   casing canonicalisation backlog); resolves fine today so this is hygiene, not a defect.

STRUCTURAL OUTCOME: two-page wave, both GOOD, NO HIGH finding (max severity LOW across both pages) →
HIGH-on-2+-pages rule does NOT fire → no new PROPOSED CHANGES block, no watch graduation. The one cross-page
pattern (ASR in source:: field) is LOW and falls inside PC-2's already-applied source-arm remit, so it reinforces
rather than graduates. All findings fold into standing PC-2 (source-arm + Nufar Gaspar seed), PC-3 (weak-handle
authority), PC-8 (casing). claim-date standing item remains fixed-and-applied with 2/2 clean positive controls;
no page joins the deferred backlog. Net new: one PC-2 dictionary seed (Nufar Gaspar).

### 2026-08-24 — Review wave #81 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-best-way-to-talk-to-your-agents.md` (episode 2026-05-12, 13
assertions, verdict GOOD). Clean single-page wave: max severity LOW, no HIGH.

Defects by kind (all LOW; merged onto existing classes):
- ASR-shaped author surname in the claim/evidence body (LOW, PC-2 body arm — not the source:: arm this time):
  the essay 'The Unreasonable Effectiveness of HTML' is attributed to `Tariq Shoupar` (an Anthropic developer,
  line 61/64). 'Shoupar' has the shape of an ASR mis-transcription and could not be corroborated from the page.
  It is NOT wikilinked, so no bad graph node is minted (blast radius nil), but the attribution string may be
  corrupt. Folds into PC-2's already-applied entity-name-normalisation remit (body arm). Single page, LOW →
  does NOT reinforce a cross-page pattern and does NOT graduate. Residual: verify the surname against the essay
  before enshrining; keep raw-in-evidence and do-not-enshrine an unverified transliteration (same discipline as
  wave #80's 'Zobiaak' source-field case). No dictionary seed minted — target spelling unknown/unverified.

POSITIVE-DISCIPLINE observations (healthy cases, no action, recorded as calibration):
- Dedup markers fully present: all 13 assertions carry unique assertion-fp comments (e.g. d3acd7f1b2ec0b17);
  no reuse. PC-1 clean.
- Wikilinks resolve: 14/14 distinct targets point to existing page files (Anthropic, Venture Capital,
  Semiconductor Industry/Manufacturing, AI Infrastructure, Browser Automation, AI Agents, Intel, Markdown,
  Context Engineering, Token Efficiency, Prompt Engineering, Distributed Computing, Data Centers). No PC-6 orphan.
- Tier/confidence banding sane and monotonic: T1 snapshot news (Anthropic funding, Cerebras IPO, TSMC, OpenAI
  Codex, Apple/Intel) 0.9–0.95; T2 HTML-vs-Markdown industry analysis 0.8–0.9; T3 emerging signals (calibration
  problem, micro data centres) 0.7–0.75. Volatility tags (snapshot/durable/speculative) align with content. No
  PC-3/PC-4 calibration owed. Honest residual noted by reviewer: several T1 items are twice-removed ('reported by
  AI Daily Brief host' citing FT/Reuters/WSJ) — correctly flagged secondary, primary not directly verified.
- source-authority annotated per claim (primary/secondary/single-source); no transcript-verbatim hype or
  unsupported superlatives in the assertion text. PC-3 discipline holding.

Positive control (claim-date standing item — Refinement #1) — CLEAN ×1 (1/1 this wave):
- The known claim-date=ingest-date defect does NOT manifest. `episode-date:: 2026-05-12` present; ALL 13
  `claim-date:: 2026-05-12` equal the episode-date, ≠ ingest-date (2026-08-24). The live `_build_ledger_bullet`
  fix (ingest.py:653, `claim-date:: {episode_date or today}`) HOLDS; no code owed; page does not join the pre-fix
  re-date backlog. Standing one-line fix confirmed applied and correct — nothing to re-propose.

Top wisdom:
- The Smart Ape format framework: choose the agent-communication format per-document by three factors — who reads
  it (human vs agent), how often it is edited (once vs many), how long it lives (ephemeral vs lasting) — rather
  than a blanket Markdown-vs-HTML rule. Durable, transferable decision heuristic; most reusable insight in the wave.
- The 'calibration problem': the core new agentic skill is choosing how much structure to impose — overspecifying
  kills the agent's range, underspecifying causes flailing/generic output. Names the load-bearing operator skill.
- The operator's role is shifting from producing final outputs to 'staging'/'scaffolding' the conditions an agent
  needs to produce them — a durable reframing of knowledge work.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN AGAIN (1/1 positive control this wave). Fix already applied
   (Refinement #1, ingest.py:653); no further code owed; page does not join the pre-fix backlog.
2. PC-2 body arm: verify 'Tariq Shoupar' against the essay 'The Unreasonable Effectiveness of HTML' before it is
   relied on as canonical (likely ASR-mangled surname). Within PC-2's applied remit; no new PROPOSED CHANGES block
   and NO dictionary seed (verified target spelling unknown — do-not-enshrine rather than guess).

STRUCTURAL OUTCOME: single-page wave, GOOD, NO HIGH finding (max severity LOW) → HIGH-on-2+-pages rule does NOT
fire → no new PROPOSED CHANGES block, no watch graduation. The one defect (ASR-shaped author name) is LOW,
single-page, unwikilinked, and falls inside PC-2's already-applied body arm — it neither reinforces a cross-page
pattern nor graduates. claim-date standing item remains fixed-and-applied with a 1/1 clean positive control. Net
new: nothing (no seed minted; target spelling unverified).

### 2026-08-24 — Review wave #82 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-big-questions-shaping-the-consumer-ai-battle.md` (episode
2026-03-05, 10 assertions, verdict GOOD). Clean single-page wave: max severity LOW, no HIGH.

Defects by kind (all LOW; merged onto existing classes):
- wikilink-target semantic mismatch (LOW, PC-3 attribution flavour — RECURRENCE): the market-share claim on
  L41 (Anthropic >60% of business-AI payments via Ramp) links `[[OpenAI API]]`, but the claim is about
  OpenAI-the-company's share of a payments channel, not the API product; `[[OpenAI]]` (or an org page) is the
  precise target. This is the SAME `[[OpenAI API]]` over-narrow target flagged in wave for
  `podcast-evidence___...` L61 (see 6175 — Sam Altman claim) — a repeat of the PC-3 semantic-mismatch class, not
  a new one. All 12 wikilinks resolve to existing files (Large Language Models, Conversational AI, Agentic AI,
  Anthropic, OpenAI API, Enterprise AI Adoption, AI Ethics, AI Adoption, User Experience, Consumer AI Adoption,
  AI Regulation, Data Portability), so no orphan — pure precision, not coverage. Fix: retarget L41 →
  `[[OpenAI]]`. Single page, LOW → does not graduate; folds into PC-3.
- ASR-artefact in evidence-only (LOW, PC-2 evidence arm — POSITIVE, not a defect): 'Open AI' (two words)
  appears only inside verbatim `evidence::` transcript fields, never in assertion bodies or wikilink/entity
  names. Entity names in claims (GPT-5.3 Instant, Claude Code, Anthropic, Bloomberg, Ramp, QuitGPT.org, Greg
  Brockman, Tariq) are clean. This is PC-2's evidence-guard WORKING (raw-in-evidence, clean-in-claim) — recorded
  as calibration, not action. Optional cosmetic normalise 'Open AI'→'OpenAI' inside quotes is defensible to
  skip on transcript-fidelity grounds.

POSITIVE-DISCIPLINE observations (healthy cases, no action, recorded as calibration):
- Dedup markers fully present: all 10 assertions carry unique assertion-fp comments. PC-1 clean.
- Wikilinks resolve: 12/12 distinct targets point to existing page files. No PC-6 orphan.
- Volatility discipline holding: the ephemeral tier-1/0.95 news snapshots (Anthropic $19B ARR, 60% Ramp share,
  2.5M boycott figure, GPT-5.3 Instant release) are correctly `volatility:: snapshot` — decay signalled, no
  re-tier owed. Same correctly-tagged low-durability news tail seen in waves #79-#81; banding internally
  consistent (news marked as news, not enshrined as wisdom).

Positive control (claim-date standing item — Refinement #1) — CLEAN ×1 (1/1 this wave):
- The known claim-date=ingest-date defect does NOT manifest. `episode-date:: 2026-03-05` present; ALL 10
  `claim-date:: 2026-03-05` equal the episode-date, ≠ ingest-date (2026-08-24). The live `_build_ledger_bullet`
  fix (ingest.py:653, `claim-date:: {episode_date or today}`) HOLDS; no code owed; page does not join the pre-fix
  re-date backlog. If a batch re-dating job keys off ingest-date, EXCLUDE this page (already correctly dated).
  Standing one-line fix confirmed applied and correct — nothing to re-propose.

Top wisdom:
- Vibes/personality is becoming a stronger consumer-AI differentiator than raw SOTA performance once many use
  cases cross a 'good enough' threshold (L71, T2, durable) — most durable, transferable insight in the wave.
- Future policy/regulation may emerge around data- and memory-transportability, letting users one-click export
  their context between AI platforms (L101, T3, speculative) — durable forward-looking signal worth tracking;
  maps onto the same data-portability/interoperability axis as the Data Portability wikilink.
- Agentic-AI adoption by non-technical 'normies' is likely radically underestimated (L91, T3) — durable thesis,
  though evidenced mainly by one anecdote (Claude camp headcount); hold as signal, not fact.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN AGAIN (1/1 positive control this wave). Fix already applied
   (Refinement #1, ingest.py:653); no further code owed; page does not join the pre-fix backlog. Batch re-date
   jobs must exclude this page (claim-date already == episode-date).
2. PC-3 semantic-mismatch (2nd sighting of the `[[OpenAI API]]` over-narrow target): retarget L41 →
   `[[OpenAI]]`. Because this is now the 2nd page carrying the identical company-claim→API-product mistarget,
   note a candidate extraction-prompt hint for the watch list (NOT yet a PROPOSED CHANGES block — both sightings
   are LOW and unwikilinked-harm is nil since targets resolve): 'when a claim concerns a company/org's market
   share, revenue, or channel position, link the ORG page ([[OpenAI]]/[[Anthropic]]), not a product page
   ([[OpenAI API]]).' Graduates to a prompt change only if a 3rd sighting lands or a mistarget mints an orphan.

STRUCTURAL OUTCOME: single-page wave, GOOD, NO HIGH finding (max severity LOW) → HIGH-on-2+-pages rule does NOT
fire → no new PROPOSED CHANGES block. The one defect (PC-3 `[[OpenAI API]]` semantic mismatch) is LOW,
resolves-to-existing (no orphan), and is now a 2nd cross-page sighting of a known PC-3 pattern — logged to the
PC-3 watch list with a candidate prompt hint, but held below the graduation bar (LOW + nil harm). The ASR
'Open AI' is evidence-only and demonstrates PC-2's guard working. claim-date standing item remains
fixed-and-applied with a 1/1 clean positive control. Net new: PC-3 watch-list entry (org-vs-product link target),
no dictionary seed, no code owed.

### 2026-08-24 — Review wave #83 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-big-ways-ai-just-changed.md` (episode 2026-07-07, verdict GOOD).
Clean single-page wave: max severity LOW, no HIGH.

Defects by kind (all LOW):
- volatility-tagging mis-tag (LOW, NEW minor class): the Glean 'bot sitting' finding (assertion-fp
  9949c60552b27e7e) is tagged `volatility:: snapshot` but is a DURABLE structural insight (hidden labour cost
  of AI-in-the-loop work: ~6.4h/week feeding context, checking outputs, rerunning), not a perishable metric.
  The co-located KPMG governance finding is correctly `volatility:: durable`, so the tier machinery works — this
  is a single mis-classification, not a systemic banding fault. Fix: re-tag fp 9949c60552b27e7e snapshot→durable.
  Single page, LOW → does not graduate.
- provenance-strength / confidence-vs-source-depth (LOW, calibration): every tier-1 'fact' (Uber $1,500 cap,
  Anthropic 30-day retention, Glean 6.4h, KPMG survey) rests on ONE secondary source (podcast host relaying
  second-hand reporting, `source-authority:: secondary`/single-source) with no primary link, yet carries
  confidence 0.85–0.95. Tiering is internally consistent; confidence is defensibly slightly high for
  single-secondary-source facts. Optional: soften tier-1 confidence toward ~0.85 across the board to keep the
  number honest about provenance depth. Calibration note, not a required edit.

POSITIVE-DISCIPLINE observations (healthy cases, no action, recorded as calibration):
- Verbatim-hype guard WORKING (PC-2 flavour): assertion bodies are cleanly de-hyped and specific. Residual
  transcript hype ('wildly under discussed', 'headline-grabbing', 'absolutely massive amount more') survives
  ONLY inside `evidence::` fields — the intended verbatim anchor. No hype leaked into assertion text. Same
  raw-in-evidence / clean-in-claim pattern logged in waves #79-#82; guard holds.

Positive control (claim-date standing item — Refinement #1) — CLEAN ×1 (1/1 this wave):
- The known claim-date=ingest-date defect does NOT manifest. `episode-date:: 2026-07-07` present; every
  `claim-date:: 2026-07-07` equals the episode-date, ≠ ingest-date (2026-08-24). The live `_build_ledger_bullet`
  fix (ingest.py:653, `claim-date:: {episode_date or today}`) HOLDS; no code owed; page does not join the pre-fix
  re-date backlog. Batch re-date jobs keying off ingest-date must EXCLUDE this page (already correctly dated).
  Standing one-line fix confirmed applied and correct — nothing to re-propose.

Top wisdom:
- KPMG pulse survey: organisations where the CEO is personally accountable for AI are >2x as likely to report
  meaningful business value than those where the CEO is not (durable governance/operating-model lesson, correctly
  `volatility:: durable`) — most durable, transferable insight in the wave.
- The 'bot sitting' finding: workers spend ~6.4h/week feeding context, checking outputs, and rerunning
  underwhelming AI results — a durable, quantified statement of the real hidden labour cost of keeping AI useful
  (the mis-tagged assertion above; wisdom-worthy precisely because it is structural, not perishable).
- Multi-model routing pattern: Harvey + Fireworks pairing an open-weight GLM worker with an Opus advisor beat
  Opus-alone on legal tasks at a fraction of the cost — a durable architectural pattern for cost/quality
  trade-offs, more valuable than the time-stamped model-suspension news around it.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN AGAIN (1/1 positive control this wave). Fix already applied
   (Refinement #1, ingest.py:653); no further code owed; page does not join the pre-fix backlog. Batch re-date
   jobs must exclude this page (claim-date already == episode-date). Flag as a clean/reference example.
2. volatility mis-tag (structural-insight-as-snapshot): re-tag fp 9949c60552b27e7e snapshot→durable. Because this
   is the 1st sighting of "durable structural insight wrongly tagged snapshot" (distinct from correctly-tagged
   news snapshots seen in #79-#82), log a candidate extraction-prompt hint to the watch list (NOT a PROPOSED
   CHANGES block — single LOW): 'volatility:: snapshot is for perishable point-in-time METRICS/news; a quantified
   but STRUCTURAL/behavioural finding (hidden labour cost, operating-model lesson) is durable even when it
   carries a number.' Graduates to a prompt change only on a 2nd sighting.
3. provenance/confidence calibration (single-secondary-source tier-1): optionally cap tier-1 confidence at ~0.85
   when the only `source-authority` is secondary/single-source with no primary link. Calibration note; hold below
   graduation (LOW, internally-consistent tiering) pending a repeat.

STRUCTURAL OUTCOME: single-page wave, GOOD, NO HIGH finding (max severity LOW) → HIGH-on-2+-pages rule does NOT
fire → no new PROPOSED CHANGES block. Two LOW defects: a volatility mis-tag (structural insight tagged snapshot —
new watch-list class, single sighting) and a provenance/confidence calibration note (tier-1 on single secondary
source). The verbatim-hype guard is demonstrated WORKING (hype confined to evidence::). claim-date standing item
remains fixed-and-applied with a 1/1 clean positive control. Net new: 1 volatility watch-list entry
(structural-insight-vs-snapshot) + 1 confidence-vs-provenance-depth calibration note; no dictionary seed, no code owed.

### 2026-08-24 — Review wave #84 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-biggest-battle-in-ai-is-for-your-personal-context.md`
(episode 2026-01-15, verdict GOOD). Single-page wave; max severity MEDIUM, no HIGH.

Defects by kind:
- ASR garble in the structured `source::` field (MEDIUM, PC-2 source-arm recurrence): the assertion at L94
  carries `source:: Akos Gupta`, almost certainly an ASR mangle of **Akash Gupta**. This sits in structured
  attribution metadata (not verbatim `evidence::`), so it can leak into author/entity indexing — the exact
  PC-2 source-arm blast radius logged for 'Andy Henny' / 'Neufar Gaspar' (Nufar Gaspar) in prior waves. Does
  NOT mint a spurious wikilink/orphan (no `[[Akos Gupta]]`), so it stays MEDIUM, not HIGH. Fix: correct L94
  `source::` to the verified spelling (`Akash Gupta`). Within PC-2's already-applied remit; no new PROPOSED
  CHANGES block.
- graph-connectivity / link-less durable assertions (LOW, PC-9 flavour): two tier-2/3 assertions carry NO
  wikilinks — the Apple competitive-advantage claim (L121) and the OpenAI hardware/AirPods emerging-signal
  (L131). An 'Apple' entity is discussed but unlinked; no bare `Apple.md` exists but
  `Apple Inc Technology Corporation.md` does, so a target is available. Reduces graph reachability. Fix: add
  `[[Apple Inc Technology Corporation]]` (L121) and an OpenAI/hardware entity link (L131). Single page, LOW →
  does not graduate.

POSITIVE-DISCIPLINE observations (healthy cases, no action, recorded as calibration):
- PC-2 evidence-guard WORKING: raw ASR noise ('Sundarbachai', 'Cloud for Healthcare', 'Johnny Ivor',
  'chatbt health', 'rellated') is confined to `evidence::` — the intended verbatim anchor — and does NOT reach
  the assertion prose or link surface. The one leak is the `source::` field (the middle tier), consistent with
  the known PC-2 source-arm gap.
- wikilink-integrity CLEAN: all 8 distinct `[[wikilinks]]` resolve to existing page files (Anthropic, Agentic
  Workflow, Google Gemini, Data Integration, OpenAI API, Model Context Protocol, AI Adoption, Predictive
  Personalization). No orphans minted.
- dedup-markers CLEAN: 13/13 assertion blocks carry a unique `<!-- assertion-fp: ... -->`.
- tier-confidence CLEAN and well-calibrated: tier-1 product announcements 0.85–0.95 (snapshot), tier-2
  industry-analysis 0.8–0.9 (durable where strategic framing, snapshot where personal reaction), tier-3
  speculative OpenAI-hardware signal 0.6. `source-authority` correctly marks Pichai/Google primary, host/cited
  YouTubers secondary.

Positive control (claim-date standing item — Refinement #1) — CLEAN ×1 (1/1 this wave):
- The known claim-date=ingest-date defect does NOT manifest. `episode-date:: 2026-01-15` present; ALL 13
  `claim-date:: 2026-01-15` equal the episode-date, ≠ ingest-date (2026-08-24). The live `_build_ledger_bullet`
  fix (ingest.py:653, `claim-date:: {episode_date or today}`) HOLDS; no code owed; page does not join the pre-fix
  re-date backlog. Batch re-date jobs keying off ingest-date must EXCLUDE this page. Nothing to re-propose.

Top wisdom:
- Every consumer-AI product move (OpenAI shipping velocity, Google Personal Intelligence, health features) is a
  race to accumulate personal context and thereby raise the switching cost of leaving a provider (fp
  26827eec42a32338, durable) — the wave's most durable strategic frame; outlives the individual announcements.
- For professional users, an AI's value is set by strategic-thinking quality and data-analysis capability, not by
  personalization conveniences like travel/tyre recommendations (fp 9d7c226cb29bc9cb) — a durable evaluation
  heuristic.
- The power of agentic coding tools (Claude Code / Co-work) comes from direct access to local desktop context —
  pointing the model at files rather than manually uploading them (fp 450580490ffa5e4e) — a durable design insight.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN AGAIN (1/1 positive control this wave). Fix already applied
   (Refinement #1, ingest.py:653); no further code owed; page does not join the pre-fix backlog. Flag as a clean
   reference example; batch re-date jobs must exclude it (claim-date already == episode-date).
2. PC-2 dictionary seed: **Akash Gupta** (was 'Akos Gupta'), source-arm placement. This is a further sighting of
   the PC-2 source-arm pattern (structured `source::` ASR garble — cf. 'Andy Henny', 'Neufar Gaspar'→Nufar Gaspar,
   'Shoupar'). Pattern remains within PC-2's already-applied remit; add the seed but hold below a new PROPOSED
   CHANGES block (MEDIUM, single page, no orphan minted). The recurrence of source::-field ASR across multiple
   waves keeps the source-arm on watch: if a source:: garble ever mints a spurious `[[author]]` link/orphan it
   escalates to HIGH and graduates.
3. PC-9 link-less-durable: add the two entity wikilinks above. Single LOW; no graduation.

STRUCTURAL OUTCOME: single-page wave, GOOD, NO HIGH finding (max severity MEDIUM) → HIGH-on-2+-pages rule does
NOT fire → no new PROPOSED CHANGES block. One MEDIUM (source:: ASR garble 'Akos Gupta'→Akash Gupta, PC-2
source-arm, no orphan) + one LOW (two link-less durable assertions, PC-9). The PC-2 evidence-guard is demonstrated
WORKING (all other ASR confined to evidence::). claim-date standing item remains fixed-and-applied with a 1/1
clean positive control. Net new: 1 PC-2 dictionary seed (Akash Gupta, source arm), no code owed.

### 2026-08-24 — Review wave #85 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-biggest-unlocks-of-gpt-images-2.md`
(episode 2026-04-23, verdict GOOD). Single-page wave; max severity MEDIUM, no HIGH.

Defects by kind:
- source-entity-conflation (MEDIUM, NEW flavour — entity-attribution arm, PC-1 adjacent): assertions 1-2
  (L11, L21) attribute to **SpaceX** both the Cursor acquisition rights and the "million-H100-equivalent
  Colossus training supercomputer". Colossus is **xAI**'s; tier-2 assertions (L121, L131) correctly frame the
  strategic logic around xAI. The source transcript itself conflates Musk's entities, so the ledger faithfully
  mirrors the source — but the result is internally INCONSISTENT within the page (SpaceX in tier-1 vs xAI in
  tier-2) and mis-links at the entity level: no `[[xAI]]` edge is emitted despite xAI being the real actor.
  Distinct from PC-1's wrong-sense wikilink arm (no bad link is emitted; the defect is a MISSING/mis-attributed
  entity, not a resolves-but-wrong-sense edge) and from PC-2 (not an ASR garble — the source genuinely says it).
  It is a new sub-class: source-faithful-but-entity-inconsistent attribution. Fix: correct SpaceX→xAI on
  assertions 2 & 12 (Colossus + in-house coding model) and emit `[[xAI]]`. Single page → WATCH, does not
  graduate; folds toward PC-1's entity-resolution arm if a 2nd source-faithful mis-attribution recurs.
- missing-wikilinks (LOW, PC-1 link-density/recall arm): high entity density, sparse linking. Unlinked
  recurring entities: SpaceX, xAI, OpenAI/Codex, Google Deep Research, LM Arena, GPT Image 2.0,
  Anthropic/Claude Mythos, Elon Musk. No orphan minted; pure connectivity/recall gap. Fix: wikilink the
  recurring named entities. Single LOW → does not graduate.
- volatility-mix (LOW, POSITIVE-DISCIPLINE — no action): tier-1 is dominated by ephemeral news snapshots
  ($60B Cursor valuation, 1,512 Elo, 4M Codex users, $1.4B stock buy, trillion-dollar comp) all correctly
  tagged `volatility:: snapshot`; durable wisdom is concentrated in the three tier-2 "Industry analysis"
  items. Tiering + volatility tags are sane and honest. Noted only as a raw news-to-wisdom-ratio observation
  (high), not a defect.

Positive control (claim-date standing item — Refinement #1) — CLEAN ×1 (1/1 this wave):
- The known claim-date=ingest-date defect does NOT manifest. `episode-date:: 2026-04-23` present;
  `ingest-date:: 2026-08-24`; ALL `claim-date:: 2026-04-23` equal the episode-date, ≠ ingest-date. The live
  `_build_ledger_bullet` fix (ingest.py:653, `claim-date:: {episode_date or today}`) HOLDS; no code owed.
  Reviewer flags this page as a clean reference example of the correctly-dated pattern; batch re-date jobs
  keying off ingest-date must EXCLUDE it. Nothing to re-propose.

Top wisdom:
- GPT Image 2.0 is the first image model whose primary impact is expected via integration into agentic stacks
  and enterprise workflows rather than standalone viral consumer moments (L111) — a durable strategic read on
  where image-gen value is shifting.
- Google's Deep Research Max hit SOTA on the SAME underlying Gemini 3.1 Pro model: the entire gain came from
  harness upgrades + additional inference, not a better model (L81) — durable insight on where agent capability
  gains now originate.
- Codex is weak at initial UI but strong at implementing a reference design, so an image-model→Codex pipeline
  (generate mockup → implement to code) is a durable practical workflow pattern (L101).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN AGAIN (1/1 positive control this wave). Fix already applied
   (Refinement #1, ingest.py:653); no further code owed; page does not join the pre-fix backlog. Use as a clean
   reference example; batch re-date jobs must exclude it (claim-date already == episode-date).
2. NEW watch — source-faithful-but-entity-inconsistent attribution: when the source transcript conflates
   distinct entities (Musk's SpaceX/xAI), the ledger mirrors it faithfully but can (a) contradict its own
   higher tiers and (b) suppress the correct `[[entity]]` edge. Candidate extraction-prompt nudge (hold below
   graduation, single page): in the entity/attribution step, when a claim names an organisation, resolve the
   actor to the entity that actually owns the named asset (e.g. Colossus→xAI) even if the speaker mis-attributes
   it, and emit that entity's wikilink; keep the speaker's wording in `evidence::`. Graduates to a prompt change
   only on a 2nd sighting.
3. PC-1 link-density: add the missing entity wikilinks above ([[xAI]], SpaceX, OpenAI/Codex, LM Arena,
   GPT Image 2.0, Google Deep Research, Anthropic/Claude Mythos, Elon Musk). Single LOW; no graduation.

STRUCTURAL OUTCOME: single-page wave, GOOD, NO HIGH finding (max severity MEDIUM) → HIGH-on-2+-pages rule does
NOT fire → no new PROPOSED CHANGES block. One MEDIUM (source-entity-conflation SpaceX→xAI — new
source-faithful-but-inconsistent attribution sub-class, no bad link emitted, no orphan) + two LOW (missing
wikilinks PC-1 link-density; volatility-mix, positive/no-action). Volatility + tiering demonstrated HONEST.
claim-date standing item remains fixed-and-applied with a 1/1 clean positive control (this page is a reference
exemplar). Net new: 1 attribution watch (source-faithful-but-entity-inconsistent) + entity-link recall gap;
no dictionary seed, no code owed.

### 2026-08-24 — Review wave #86 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-calm-before-the-agi-storm.md`
(episode 2026-04-08, verdict GOOD). Single-page wave; max severity MEDIUM, no HIGH.

Defects by kind:
- hallucinated-entity-gloss (MEDIUM, NEW flavour — PC-2 adjacent, hallucination arm): assertion L131 names the
  acquired show as **'TWiP (The Big Picture Now)'**. TWiP historically = 'This Week in Photography'; the
  parenthetical is not a known real name. The acronym-plus-gloss shape is a model-INVENTED (or ASR-derived)
  expansion, not a transcript garble of a real string. Distinct from PC-2 (which normalises garbled renderings of
  a REAL name) and from PC-1's acronym-EXPANSION mechanism note (which is about a wikilink TARGET titled by an
  unlicensed expansion): here no link is emitted and the fabricated string sits in the assertion body itself.
  Sub-class: confabulated acronym gloss. Fix: verify or STRIP the '(The Big Picture Now)' expansion; keep the bare
  acronym 'TWiP' rather than a possibly-invented gloss. Single page → WATCH; folds toward PC-2's entity-name
  normalisation (add a "reject unverifiable acronym expansions — keep the bare token" rule) if a 2nd sighting
  recurs.
- entity-name-inconsistency (LOW, PC-7 intra-page canonicalisation): third-party tool rendered 'OpenClaude'
  (assertion L51) vs 'Open Claude' (its own `evidence::` field), left unlinked. Exactly PC-7's target — the same
  entity spelled two ways within one page. Fix: normalise to a single canonical spelling before it can become a
  stable entity. No orphan minted. Single LOW → does not graduate.
- entity-name-noncanonical (LOW, PC-2 adjacent, non-blocking): 'Arena AI text leaderboard' (L61, L68) is almost
  certainly a transcript rendering of **LMArena / Chatbot Arena**. Not wrong enough to block and no bad link is
  emitted, but the name would not match a canonical page if one is later created. Fix: normalise to LMArena /
  Chatbot Arena. Reinforces PC-2's known-name dictionary (product-name arm); single LOW → watch, no graduation.
- missing-wikilinks (LOW, PC-6 link-coverage floor): a `[[NVIDIA Corporation]]` page EXISTS in the graph, yet
  Nvidia is named UNLINKED in the fundraising (L11) and Iran-targeting (L121) assertions — a missed connectivity
  opportunity against an existing target (exactly PC-6's floor). The other link-less tier-1 assertions (Qwen 3.6
  L71, DeepSeek V4 L111, calm-before-storm L151) are DEFENSIBLE — Alibaba/Qwen/DeepSeek/Gemma pages do not exist,
  so no floor breach. Fix: add [[NVIDIA Corporation]] on L11 & L121; optionally seed stubs for
  Alibaba/Qwen/DeepSeek/Gemma to capture the currently-unlinked model-release claims. Single LOW → PC-6 recurrence,
  no graduation.

Positive control (claim-date standing item — Refinement #1) — CLEAN ×1 (1/1 this wave):
- The known claim-date=ingest-date defect does NOT manifest. `episode-date:: 2026-04-08` present;
  `ingest-date:: 2026-08-24`; ALL 15 `claim-date:: 2026-04-08` equal the episode-date, ≠ ingest-date. The live
  `_build_ledger_bullet` fix (ingest.py:653, `claim-date:: {episode_date or today}`) HOLDS; no code owed; page
  does not join the pre-fix re-date backlog. Reviewer flags it as a clean reference example; batch re-date jobs
  keying off ingest-date must EXCLUDE it. Nothing to re-propose.

Top wisdom:
- The 'agent economy' is expensive because running high-intelligence models on costly hardware trends toward
  human-salary economics, so the subsidised-subscription era is ending (Daniel Jeffries, L141) — an economic
  PRINCIPLE, not a news snapshot; the most durable assertion on the page, correctly tiered 3/0.6 speculative.
- Data-centre build-out bottleneck (L91): electrical gear (transformers, switchgear) is only ~10% of project cost
  yet is projected to delay/cancel >50% of US data centres — a durable, counter-intuitive supply-chain insight on
  the real physical constraint on AI scaling, well-sourced to Bloomberg.
- Gemma 4 'intelligence per parameter' (L61): frontier-level capability at significantly lower hardware overhead —
  a durable efficiency-trend signal, distinct from the ephemeral fundraising/leaderboard snapshots that dominate
  the rest of the ledger.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CONFIRMED CLEAN AGAIN (1/1 positive control this wave). Fix already applied
   (Refinement #1, ingest.py:653); no further code owed; page does not join the pre-fix backlog. Use as a clean
   reference example; batch re-date jobs must exclude it (claim-date already == episode-date).
2. NEW watch — confabulated acronym gloss (PC-2 hallucination arm): when an assertion presents 'ACRONYM (Expanded
   Gloss)', the parenthetical must be VERIFIABLE against the real expansion; if unverifiable, keep the bare
   acronym and drop the gloss (TWiP case: strip '(The Big Picture Now)'). Candidate PC-2 extraction/verify nudge,
   held below graduation (single page); graduates into PC-2 on a 2nd sighting.
3. PC-2 product-name arm seed: normalise 'Arena AI text leaderboard' → LMArena / Chatbot Arena. Single LOW; add
   the dictionary seed, no orphan minted, no graduation.
4. PC-7 intra-page canonicalisation: normalise 'OpenClaude'/'Open Claude' to one spelling before entity mint.
   PC-6 link-floor: add [[NVIDIA Corporation]] on L11 & L121 (existing target). Both single LOW; no graduation.
5. Volatility discipline (positive/optional): the many one-off financial/ranking snapshots (fundraising total,
   Qwen leaderboard, trillion-tokens/day) could be explicitly tagged `volatility:: snapshot` (PC-4) so downstream
   consumers distinguish them from the 2-3 durable insights above; the durable items (agent-economy principle,
   data-centre gear bottleneck, intelligence-per-parameter) stay untagged/durable.

STRUCTURAL OUTCOME: single-page wave, GOOD, NO HIGH finding (max severity MEDIUM) → HIGH-on-2+-pages rule does
NOT fire → no new PROPOSED CHANGES block. One MEDIUM (confabulated acronym gloss 'TWiP (The Big Picture Now)' —
new hallucination sub-class, PC-2 adjacent, no link emitted, no orphan) + three LOW (OpenClaude/Open Claude PC-7;
'Arena AI' non-canonical PC-2 product arm; missing [[NVIDIA Corporation]] PC-6 link-floor). claim-date standing
item remains fixed-and-applied with a 1/1 clean positive control (reference exemplar). Net new: 1 hallucination
watch (confabulated acronym gloss) + 1 PC-2 product-name seed (LMArena/Chatbot Arena); no code owed.

### 2026-08-24 — Review wave #87 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-dawn-of-the-agent-age.md` verdict acceptable.
Every finding maps onto already-graduated/APPLIED PC-1 (wikilinks), PC-2 (entity/ASR normalisation) and the
W-CANON canonicalisation watch; standing claim-date item is a clean positive control. No HIGH, single page.

Defects by kind:
- asr-artefact-in-entity-name (MEDIUM, PC-2 — structured/body arm, APPLIED): TWO body entities carry ASR
  garbles into the assertion text (not just verbatim evidence): 'Brent Behore of Permanent Equity' (L21) ->
  Brent Beshore (Permanent Equity's actual CEO); 'Meta acquired the agent firm Manis' (L111) -> almost
  certainly Manus (the agentic-AI startup). Manus is a RECURRENCE — same garble as wave #41 ('Manas'->Manus)
  and earlier; the ASR consistently mangles this name. Both would mint wrong [[Beshore]]/[[Manus]] identities
  → correct via PC-2 body-normalisation BEFORE PC-1 link emission (existing ordering note). Evidence fields
  may retain the raw transcript; the normalised assertion must carry the true names. PC-2 header extended.
- page-normalisation-duplication (LOW, W-CANON — cross-page arm): the ledger links both [[Multi-Agent System]]
  (L31) and [[Multi-Agent Systems]] (L61) — two SEPARATE existing page files for one concept, split only by
  singular/plural. Both resolve, so no dangling link, but this fragments the graph across a canonical-form
  split. Distinct from W-CANON's intra-page spelling-variant cases: here the split is between two already-
  existing graph pages. Fix: collapse to one canonical surface (prefer the plural [[Multi-Agent Systems]]) and
  redirect/merge the other. Single LOW → extends W-CANON with a cross-page/singular-plural arm; no graduation.
- tangential-wikilink (LOW, PC-1 — off-topic-edge arm, APPLIED): the Altman/OpenClaw agentic-assistant claim
  (L41) is tagged [[National Ai Strategy]], only loosely related to the assertion's actual content (product
  conviction about an agentic assistant). A weak/off-topic edge; it already carries [[Agentic AI]], which
  suffices. Fix: drop/re-target [[National Ai Strategy]]. Folds into PC-1's semantic-relevance check.
- unverifiable-proper-nouns (LOW, PC-2 — verify-pass arm): 'Moltbook' (social network for AI agents, L31;
  evidence field even shows the variant 'Maltbook') and 'OpenClaw' (L41) are ASR-shaped proper nouns,
  normalised consistently but NOT verified against a real product name. Good: no [[wikilink]] minted for
  either, so no bad edge/orphan. If mis-transcribed the whole assertion's referent is wrong. 'OpenClaw' also
  sits in the Open Claw->OpenClaw / OpenClaude-Open Claude naming cluster (PC-2/W-CANON) — flag for source
  verification against the actual episode before either becomes an authoritative node.

Positive control (claim-date standing item — Refinement #1) — CLEAN (1/1 this wave):
- Defect does NOT manifest. `episode-date:: 2026-02-05` present; every `claim-date::` equals the episode date,
  not the ingest-date (2026-08-24). The applied `_build_ledger_bullet` fix HOLDS on another post-fix page; no
  code owed, page does not join the pre-fix re-date backlog. Reference exemplar; batch re-date jobs exclude it.

Top wisdom:
- Kevin Roose's 'yawning inside-outside gap' in AI adoption (L61): SF early-adopters run multi-agent swarms
  while most knowledge workers still can't get approval for basic AI tools — a durable structural insight about
  the adoption frontier, not ephemeral news.
- Sergey Kerv (L51): Claude Code + Opus 4.5 moves software creation from artisanal craft to industrial process
  — a durable Gutenberg-press conceptual lens for the coding-automation shift.
- 'Vibe coding' (L101) shifting in one month from a prototyping tool to the default method of software
  development — a durable trend observation on how AI-assisted development normalised.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CLEAN positive control again (1/1). Fix already applied (Refinement #1,
   _build_ledger_bullet carries episode_date); no further code owed; page excluded from the re-date backlog.
2. PC-2 recurrence (structured/body arm) — 'Brent Behore'->'Brent Beshore' and 'Manis'->'Manus' (Manus now a
   repeat garble). Covered by PC-2 (APPLIED); ensure body-normalisation runs before PC-1 link emission. Add
   'Manus' (all ASR variants: Manas/Manis) to the PC-2 known-name dictionary given the repeat.
3. W-CANON cross-page arm (NEW flavour): add a singular/plural (and near-synonym) collision check that detects
   when a ledger links two DISTINCT existing pages differing only by inflection ([[Multi-Agent System]] vs
   [[Multi-Agent Systems]]) and canonicalises to one before emitting the link. Single LOW → extends W-CANON,
   no graduation; graduates to a code change on a 2nd cross-page split.
4. PC-1 relevance: drop [[National Ai Strategy]] from the Altman/OpenClaw claim ([[Agentic AI]] suffices).
5. PC-2 verify arm: corroborate 'Moltbook'/'Maltbook' and 'OpenClaw' against the actual episode; no link was
   minted (good), so they are held as unverified proper nouns — resolve or unverified-flag before authoritative use.

STRUCTURAL OUTCOME: single-page wave, acceptable, max severity MEDIUM, NO HIGH finding → HIGH-on-2+-pages rule
does NOT fire → no new PROPOSED CHANGES block. One MEDIUM (PC-2 body-arm double garble, Beshore + repeat Manus)
+ three LOW (Multi-Agent System/Systems cross-page split W-CANON; [[National Ai Strategy]] tangential PC-1;
Moltbook/OpenClaw unverified proper nouns PC-2 verify arm). claim-date remains fixed-and-applied (1/1 clean
positive control). Net new: W-CANON cross-page singular/plural arm + 'Manus' added to the PC-2 name dictionary
(repeat garble); no code owed.

### 2026-08-24 — Review wave #88 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-era-of-vertical-ai-models.md` verdict acceptable.
Findings map onto standing PC-1 (semantic-relevance wikilinks) + PC-2 (entity/ASR normalisation, APPLIED);
claim-date standing item is a clean positive control. NOTE: this wave surfaces the first HIGH-severity PC-2
instance landing in the load-bearing source:: attribution field — but on a SINGLE page, so the HIGH-on-2+-pages
rule does NOT fire. Flagged as a graduation watch (see PC-2 note) should a 2nd HIGH-in-source:: page appear.

Defects by kind:
- asr-entity-corruption in source:: (HIGH, PC-2 — structured/source arm, APPLIED): Intercom's CEO rendered
  'Eoin MacCarron' in the source:: field of two claims (L24, L54) and 'Eoin Mac Caba' in evidence (L28) —
  all ASR garbles of Eoghan McCabe. This puts a wrong entity into the attribution field itself, which will
  mint/mis-merge a bad [[Eoin MacCarron]] person node and mis-link provenance. Exactly PC-2's target surface;
  correct to 'Eoghan McCabe' across L24/L54 (and evidence L28) BEFORE PC-1 link/person-node emission. First
  HIGH-severity hit on the source:: arm (prior source:: garbles were MEDIUM) → PC-2 severity note extended.
- asr-entity-corruption unverified (MEDIUM, PC-2 — verify arm): 'Kimmy K 2.5' (evidence L108) = Kimi K2.5
  (Moonshot); 'Ashwin Srinivasan' (Decagon co-founder, L64/L68) ≈ Ashwin Sreenivas. Model/person names
  carried into source::/evidence unverified. 'Kimi' is a RECURRENCE (see wave #12 'Kimik 3' Kimi garble) —
  the ASR consistently mangles Moonshot's Kimi line; add Kimi/Kimi-K2/K2.5 to the PC-2 known-name dictionary.
- wrong-concept-wikilink (MEDIUM, PC-1 — semantic-relevance arm): L111 links [[Post Training Quantisation]],
  but the claim is about post-TRAINING on experiential data (RL/fine-tuning), NOT quantisation (model
  compression). Link resolves to a real file but points at an unrelated concept → pollutes the Quantisation
  page neighbourhood. Distinct from tangential-edge cases: this is an outright wrong-referent link driven by a
  token-overlap ('post training') collision. Fix: re-target to [[Post-Training]] or [[Fine-Tuning]], or drop.
- garbled-evidence (MEDIUM, evidence-coherence watch): L108 evidence conflates two unrelated stories — the
  Cursor/Composer-2 base-model controversy with Intercom's 'Finn' (Intercom's product, mislabelled 'an ex-user
  called Finn'). Evidence does not cleanly support its assertion. A cross-topic evidence-bleed, adjacent to
  garbled-source-attribution but in the evidence:: body; hold/repair before the assertion is treated as sourced.
- vendor-hype-as-fact (LOW, confidence-calibration watch): tier-1 claims L21/L41/L51 restate unverifiable
  vendor superlatives ('highest performing, fastest, and cheapest'; 'far cheaper than any other model … in the
  world') at conf 0.90-0.95. Correctly attributed and marked volatility:: snapshot, but the confidence encodes
  certainty the superlative is TRUE (it is marketing). Lower confidence on superlative claims to ~0.6-0.7, or
  add a claim-type:: marketing-superlative marker so downstream consumers discount them.

Positive control (claim-date standing item — Refinement #1) — CLEAN (1/1 this wave):
- Defect does NOT manifest. `episode-date:: 2026-03-29` present in header; every `claim-date:: 2026-03-29`
  equals the episode date, not the ingest-date (2026-08-24). The applied `_build_ledger_bullet` fix HOLDS; no
  code owed, page excluded from the pre-fix re-date backlog. Reference exemplar.

Top wisdom:
- Rich Sutton's Bitter Lesson (L11, tier 1, 0.98): general methods leveraging computation beat human-designed
  strategies — the durable framing the whole episode hangs on, with a verbatim primary quote.
- Host synthesis (L111, tier 2): vertical models do NOT contradict the Bitter Lesson because post-training uses
  experiential interaction data, not human-encoded knowledge — a genuinely non-obvious reconciliation, backed
  by Sutton's own 'next phase' framing.
- Karpathy's 'speciation' of intelligences (L81, tier 2): smaller models with a task-specialised cognitive core
  rather than one omniscient oracle — a durable conceptual prediction, well-sourced.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — CLEAN positive control again (1/1). Fix already applied (Refinement #1,
   _build_ledger_bullet carries episode_date); no further code owed; page excluded from the re-date backlog.
2. PC-2 severity/dictionary extension — first HIGH-severity source:: garble (Eoin MacCarron/Eoin Mac Caba →
   Eoghan McCabe). Already covered by PC-2 (APPLIED); ensure source:: normalisation runs before person-node
   mint. Add to PC-2 known-name dictionary: Eoghan McCabe (Intercom), Kimi/Kimi-K2/K2.5 (Moonshot; RECURRENCE
   of wave #12 'Kimik 3'), Ashwin Sreenivas (Decagon). GRADUATION WATCH: if a 2nd page shows a HIGH-severity
   ASR garble in source::, the source:: arm graduates to a hard pre-mint verify gate (PROPOSED CHANGES block).
3. PC-1 wrong-referent arm (NEW flavour) — add a token-overlap guard so a link is NOT emitted purely on shared
   surface tokens ('post training' → [[Post Training Quantisation]]) when the claim's concept differs; prefer
   [[Post-Training]]/[[Fine-Tuning]] here. Single MEDIUM → extends PC-1 (semantic-relevance) with a
   homograph/token-collision check; graduates to code on a 2nd wrong-referent (not merely tangential) link.
4. Evidence-coherence watch (NEW) — flag evidence:: that conflates two distinct stories (Composer-2/Cursor vs
   Intercom 'Finn'); hold or split before the assertion is treated as sourced. First instance → watch only.
5. Confidence-calibration (LOW) — cap confidence on marketing-superlative claims (~0.6-0.7) and/or add a
   claim-type:: marketing-superlative marker so volatility:: snapshot + attribution don't read as truth-certainty.

STRUCTURAL OUTCOME: single-page wave, acceptable, max severity HIGH but on ONE page → HIGH-on-2+-pages rule
does NOT fire → no new PROPOSED CHANGES block (graduation watch armed on the source:: arm, item #2). One HIGH
(PC-2 source:: garble Eoin→Eoghan McCabe) + three MEDIUM (Kimi/Sreenivas unverified PC-2; [[Post Training
Quantisation]] wrong-referent PC-1; Finn/Composer-2 garbled-evidence) + one LOW (marketing-superlative
over-confidence). claim-date remains fixed-and-applied (1/1 clean positive control). Net new: PC-2 dictionary
+3 names (Eoghan McCabe, Kimi K2.5 [recurrence], Ashwin Sreenivas) and a HIGH-in-source:: graduation watch;
PC-1 gains a token-collision/wrong-referent arm; new evidence-coherence watch opened; no code owed this wave.

### 2026-08-24 — Review wave #89 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-era-of-vertical-ai-models.md` verdict acceptable.
**DUPLICATE RE-REVIEW of wave #88 — same page, same underlying findings.** Logged compactly per the
tidy/merge rule; the full analysis lives in wave #88 above and is not restated. Reconciliation of this
wave's review record against wave #88 (no new defect class, no new information):
- HIGH asr-artefact-entity-name (Eoghan McCabe garbled 'Eoin MacCarron' in source::/assertions L21/51,
  'Eoin Mac Caba' in evidence L28) = wave #88's HIGH PC-2 source:: garble. Covered by PC-2 (APPLIED);
  source:: HIGH-garble graduation watch stays armed (still single-page → does NOT fire).
- MEDIUM wrong-wikilink [[Post Training Quantisation]] on L111 = wave #88's PC-1 wrong-referent/token-
  collision arm. Fix unchanged: re-target [[Post-Training]]/[[Fine-Tuning]] or drop; keep [[Experiential
  Learning]] (correct).
- MEDIUM asr-in-evidence ('Kimmy K 2.5'→Kimi K2.5; garbled 'ex-user called Finn' vs Intercom's Finn
  product / Composer-2 bleed) = wave #88's PC-2 verify arm + evidence-coherence watch. Kimi already in the
  PC-2 dictionary (recurrence noted #12/#88).
- LOW entity-name-uncertain 'Ashwin Srinivasan'→Ashwin Sreenivas (Decagon) = wave #88 PC-2 verify arm;
  already in dictionary.
- LOW tier-authority-mismatch (L71 Bloomberg GPT, L101 Composer-2-beats-Opus tagged tier::1 but
  source-authority:: secondary/host-paraphrase) = PC-3 tier-vs-authority arm; fix: demote to tier::2 to
  match the authority field. (New framing vs #88's confidence-calibration note but same class — folds
  into PC-3.)
- LOW marketing-hype-as-claim (L21/L41 vendor superlatives) = wave #88's PC-4/confidence-calibration
  watch; correctly volatility:: snapshot + attributed → disclosed, not laundered. Cap confidence ~0.6-0.7.
- LOW version-number-inconsistency (Opus 4.5 vs 4.6; anachronistic 'GPT-4' as a 2026 competitor) → folds
  into W-MODELVER (model-version drift watch); transcription-uncertain, annotate rather than trust.

Positive control (claim-date / Refinement #1): the review record raises NO claim-date defect (none among
its issues), consistent with wave #88's clean positive control (`episode-date:: 2026-03-29`, every
`claim-date::` = episode date). Standing item remains fixed-and-applied; page excluded from the pre-fix
re-date backlog. No confirmation of the standing item this wave (already applied), so no new one-line
`_build_ledger_bullet` fix is owed.

Top wisdom (unchanged from #88): (1) host synthesis L111 — vertical models do NOT contradict Sutton's
Bitter Lesson because post-training gains come from brute-force experiential INTERACTION data, not human-
encoded knowledge (Sutton's own 'next phase'); the most durable, non-obvious insight. (2) Sutton's Bitter
Lesson L11 (tier 1, 0.98) anchors the episode. (3) Bloomberg GPT L71 — a 50B finance-specific model
outperformed by general models: a concrete cautionary datapoint against naive vertical pre-training.

INPUT-ADJUSTMENT PROPOSALS: none new. All folded into standing PC-1 (token-collision wrong-referent arm),
PC-2 (entity/ASR normalisation, APPLIED — dictionary already carries Eoghan McCabe / Kimi K2.5 / Ashwin
Sreenivas from #88), PC-3 (tier-vs-authority), PC-4/confidence-calibration + W-MODELVER, and the claim-
date positive control. Operational note for the orchestrator: this page was double-submitted (waves #88
and #89) — de-dup upstream so the review mesh does not re-spend on already-synthesised pages.

STRUCTURAL OUTCOME: duplicate single-page re-review, acceptable, max severity HIGH but on ONE (already-
logged) page → HIGH-on-2+-pages rule does NOT fire → no new PROPOSED CHANGES block (source:: HIGH-garble
graduation watch stays armed, still 1 page). No new defect class, no new watch, no graduation, no code
owed. claim-date remains fixed-and-applied (positive control, no defect raised). Recorded compactly as a
merge of wave #88 rather than a restatement.

### 2026-08-24 — Review wave #90 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-final-ai-word-from-davos.md` verdict good. All findings LOW;
no HIGH, no new defect class. Everything folds into standing PC-1 (wikilink semantic-relevance) and PC-4
(volatility ledger-field); claim-date is a clean positive control.

Defects found (by kind):
- wikilink-relevance (LOW, PC-1 — over-specific link arm): Jensen Huang assertion links [[NVIDIA H200]]
  but the claim references generic 'chips' + 'energy infrastructure' demand and never names the H200. The
  target resolves to a real page but is narrower than the source supports. Fix: re-scope to
  [[NVIDIA Corporation]] (or a generic AI-chip-demand concept). This is a NEW flavour of PC-1 — not a
  wrong-referent (wave #88 token-collision) but over-specificity: link is more precise than the evidence
  warrants. Extends PC-1's relevance arm with a specificity check (link entity must not be strictly
  narrower than the claim's referent). Single LOW → watch only, folds into PC-1; graduates on a 2nd
  over-specific link.
- volatility-tag-minor (LOW, PC-4 — snapshot-vs-durable borderline): Cisco assertion (L101) tagged
  volatility:: snapshot but reads as a fairly durable capability statement (AI collapsing previously-
  infeasible project timelines). Borderline, not wrong. Fix: reconsider snapshot→durable. Folds into
  applied PC-4; LOW calibration datapoint, no action owed.

Top wisdom highlights (this wave's most durable, correctly volatility:: durable):
1. Christy Hoffman (UNI Global Union): 'AI is being sold as a productivity tool, which often means doing
   more with fewer workers' — durable structural framing of the labour-displacement narrative.
2. Georgieva's second-order mechanism: AI-enhanced high-skilled workers earn/spend more locally, lifting
   demand for low-skilled service jobs so total employment slightly rises — a durable economic-transmission
   argument, not ephemeral news.
3. IMF's two structural concerns: stagnating middle-class wages for non-AI-enhanced jobs, and rising
   barriers to youth employment as AI absorbs entry-level tasks — durable policy insight, cleanly
   separated from the page's ephemeral ARR/enterprise-percentage snapshots.

Positive control (claim-date / Refinement #1): STRONG clean control (1/1). `episode-date:: 2026-01-27`,
`ingest-date:: 2026-08-24`, and every one of the 11 `claim-date::` correctly reads 2026-01-27 (episode
date), NOT the 2026-08-24 ingest date. The known ingest-date defect is confirmed ABSENT. Standing item
remains fixed-and-applied; page excluded from the re-date backlog. The reviewer flags this page as the
correct-dating REFERENCE PATTERN — note it as such for regression checks. No confirmation of the standing
defect this wave (already applied), so no new one-line `_build_ledger_bullet` fix is owed.

INPUT-ADJUSTMENT PROPOSALS:
1. PC-1 specificity arm (NEW flavour) — beyond the existing wrong-referent/token-collision guard (wave
   #88), add a specificity check: reject a wikilink whose entity is strictly narrower than the claim's
   referent (generic 'chips/energy demand' → [[NVIDIA H200]]). Prefer the parent entity
   ([[NVIDIA Corporation]]) or a generic concept. Single LOW → PC-1 watch; graduates to code on a 2nd
   over-specific link.
2. PC-4 calibration — Cisco L101 snapshot-on-durable-capability is a LOW calibration datapoint; no code
   owed. Reinforces the standing note that durable capability statements should default durable, reserving
   snapshot for figures/metrics.
3. claim-date standing item — clean positive control (1/1), now the named REFERENCE PATTERN. Fix already
   applied; no code owed; page excluded from the re-date backlog.

STRUCTURAL OUTCOME: single-page wave, verdict good, max severity LOW → HIGH-on-2+-pages rule does NOT fire
→ no new PROPOSED CHANGES block; the source:: HIGH-garble graduation watch (from #88) stays armed at 1
page, unchanged. No new defect class, no graduation, no code owed. Net new: PC-1 gains an over-specificity
watch arm (distinct from the wrong-referent arm); PC-4 gets one LOW calibration datapoint; claim-date
promoted to the named correct-dating reference pattern (clean 1/1 positive control).

### 2026-08-24 — Review wave #91 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-latest-ai-models-and-model-rumors.md` verdict acceptable.
All findings MEDIUM/LOW; no HIGH, no new PC class. Everything folds into standing PC-2 (ASR/entity-name
normalisation + dictionary) and PC-3 (source-authority); claim-date is a clean positive control.

Defects found (by kind):
- asr-artefact-benchmark-name (MEDIUM, PC-2 — NEW proper-noun sub-arm: eval/benchmark names): two claims
  (fp a7dbbb813b44389b, a14a427719d6e574) carry `ARKG I2` (garble of ARC-AGI-2) and `Humanities Last Exam`
  (garble of Humanity's Last Exam / HLE), verbatim into BOTH assertion and evidence → the benchmark scores
  are unsourceable/uncheckable under the mangled names AND cannot graph-link. This extends PC-2 beyond
  people/products to BENCHMARK/EVAL proper nouns. Fix: normalise `ARKG I2`→ARC-AGI-2, `Humanities Last
  Exam`→Humanity's Last Exam (HLE) in assertion+evidence, then add [[ARC-AGI-2]] / [[Humanity's Last Exam]]
  wikilinks (PC-6 link-floor, mint targets if absent) so scores become graph-linkable. PC-2 dictionary +2:
  ARC-AGI-2 (aka ARKG I2), Humanity's Last Exam / HLE (aka Humanities Last Exam).
- entity-name-likely-wrong (MEDIUM, PC-2 people dictionary): `Ara Khachaturian (Ramp economist)`
  (fp 5037e0b90e7efbd4) is an ASR mishearing of Ramp economist **Ara Kharazian**; wrong surname weakens the
  primary-source attribution. Fix: correct to Ara Kharazian. PC-2 dictionary +1.
- source-authority-mislabelled (LOW, PC-3 source-authority arm — NEW relayed-primary distinction): several
  assertions tagged `source-authority:: primary` are actually the AI Daily Brief host RELAYING a tweet
  (Ramp/Ara Kharazian, Dan Shipper, Swyx). True provenance = secondary relay of a primary quote; flat
  `primary` overstates directness. Fix: demote to `secondary` OR add a `relayed-primary` qualifier so a
  host-quoted tweet is visibly distinct from a direct primary. Extends PC-3 (which already carries the
  source-authority field from wave #1's proposal); single LOW → folds into PC-3, no graduation.
- asr-artefact-in-evidence (LOW, PC-2 evidence-cleanup arm): Public First Action donation evidence
  (fp f2b1688608c1f591) contains `a a million donation` (doubled-article ASR glitch). The assertion
  correctly normalises to $1 million but the raw artefact survives in the evidence field. Reinforces that
  PC-2 normalisation must also scrub the EVIDENCE text, not just the assertion. Single LOW → folds into PC-2.

Top wisdom highlights (this wave's most durable; correctly volatility:: durable, not leaderboard/news noise):
1. Dan Shipper (fp 400d0ae1382c1613): raw model speed is not free throughput — a model that emits 10 pages
   of code in seconds introduces NEW downstream bottlenecks and demands a new UX to manage the output. A
   durable design principle that outlives any specific model.
2. GPT-5.3 Codex Spark served exclusively on Cerebras Wafer Scale chips (fp 4ce0d8afde9aeedd) — OpenAI's
   first non-Nvidia-targeted model; a structural inference-hardware-diversification signal, correctly
   flagged volatility:: durable.
3. Google Deep Think's Alethea agent (fp f9b28309b0120213): a closed generate→verify→feed-back loop for
   autonomously producing and verifying novel proofs in pure mathematics — a durable capability-architecture
   pattern, not an ephemeral leaderboard number.

Positive control (claim-date / Refinement #1): CLEAN control. `episode-date:: 2026-02-17` present and
correct; every `claim-date::` reads 2026-02-17 (episode date), NOT the ingest date (2026-08-24). The known
ingest-date defect is confirmed ABSENT — claims are dated to the episode and re-datable. Standing item
remains fixed-and-applied; page excluded from the re-date backlog. No confirmation of the standing defect
this wave (already applied), so no new one-line `_build_ledger_bullet` fix is owed. (Standing fix, for the
record: in ingest.py `_build_ledger_bullet`, `claim_date = episode_date` with fallback to ingest_date only
when episode_date is absent.)

INPUT-ADJUSTMENT PROPOSALS:
1. PC-2 eval/benchmark sub-arm (NEW flavour) — extend the entity-name normalisation dictionary + verify pass
   to cover BENCHMARK/EVAL proper nouns (ARC-AGI-2, Humanity's Last Exam/HLE, and future SWE-bench/MMLU-class
   names), scrubbing BOTH assertion and evidence. Benchmark garble is higher-stakes than a mis-spelt person:
   it renders a quantitative score unsourceable. On normalise, emit the [[ARC-AGI-2]]/[[Humanity's Last Exam]]
   wikilink (PC-6 link-floor). Single-page MEDIUM → folds into PC-2; graduates to a code/prompt change on a
   2nd benchmark-garble page.
2. PC-2 people dictionary +1: Ara Kharazian (Ramp economist; aka ASR `Ara Khachaturian`). Recurrence-tracked.
3. PC-3 relayed-primary distinction (NEW flavour) — for host-relayed tweet quotes, either demote
   source-authority to `secondary` or introduce a `relayed-primary` qualifier so a secondary relay of a
   primary quote is not laundered as a direct primary. Extraction prompt could ask the model to distinguish
   "spoke/authored directly" from "host quoting a third party". Single LOW → folds into PC-3; no code owed.
4. PC-2 evidence-scrub reminder: normalisation fixes applied to the assertion must also rewrite the evidence
   field (e.g. `a a million`→`$1 million`), else the raw ASR artefact persists as the sourced text. No new
   arm; tightens PC-2's existing scope to cover evidence, not just the assertion string.

STRUCTURAL OUTCOME: single-page wave, verdict acceptable, max severity MEDIUM → HIGH-on-2+-pages rule does
NOT fire → no new PROPOSED CHANGES block; the source:: HIGH-garble graduation watch (from #88) stays armed
at 1 page, unchanged. No new PC class, no graduation, no code owed. Net new: PC-2 gains an eval/benchmark
proper-noun sub-arm (+dictionary: ARC-AGI-2, Humanity's Last Exam/HLE, Ara Kharazian) and an explicit
evidence-scrub reminder; PC-3 gains a relayed-primary distinction for host-quoted tweets; claim-date remains
a clean positive control (page excluded from the re-date backlog).

### 2026-08-24 — Review wave #92 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-models-trying-to-replace-fable.md` verdict good.
All 5 findings LOW; no HIGH, no MEDIUM, no new PC class. Everything folds into standing PC-2 (ASR/entity-
name normalisation + dictionary) and PC-6 (link-floor / under-linking); claim-date is a clean positive
control. HIGH-on-2+-pages rule does NOT fire → no new PROPOSED CHANGES block.

Defects found (by kind):
- asr-artefacts-in-entity-names (LOW, PC-2 product/org dictionary): assertion bodies keep ASR spellings —
  `Deep Seek V4`→DeepSeek V4, `ZAI`→Z.ai, `Copilot Co-work`→Copilot Cowork, plus lowercased benchmark
  names `Bridgebench`/`program bench`/`Kimi code bench V2`. None wikilinked, so no dangling links, but they
  fragment future entity extraction/dedup. Reinforces the PC-2 eval/benchmark proper-noun sub-arm opened in
  #91. PC-2 dictionary +: DeepSeek (aka Deep Seek), Z.ai (aka ZAI), Copilot Cowork (aka Copilot Co-work).
- under-linking (LOW, PC-6 link-floor): only 7 wikilinks across 13 claims; recurring corpus orgs/models
  (Kimi, GLM/Z.ai, DeepSeek, Harvey, OpenAI, Microsoft, SK Telecom, European Commission, Open Router) are
  unlinked → these claims won't surface in their entity pages' linked-references. Correctness unaffected;
  connectivity below the PC-6 floor. Single LOW → folds into PC-6.
- claim-date-defect-check (LOW, positive control): CLEAN. `episode-date:: 2026-06-19` present; every
  `claim-date::` reads 2026-06-19 (episode date), NOT ingest-date 2026-08-24. Standing ingest-date defect
  confirmed ABSENT; page excluded from the re-date backlog.
- wikilink-resolution (LOW): all 7 links resolve to existing page files (space convention), no dangling.
- dedup-and-tiering (LOW, positive control): 13/13 assertion-fp:: markers well-formed; tier/confidence
  banding monotonic (t1 0.85-0.95, t2 0.7-0.85, t3 0.6-0.65); source/source-authority/volatility populated;
  hype quarantined in evidence:: blocks, assertions cleanly paraphrased. Named as a good-separation exemplar.

Top wisdom highlights (durable, correctly volatility:: durable — a self-consistent compound-architecture cluster):
1. Harvey worker-advisor (tier 2, durable): an open-weight GLM 5.1 worker delegating high-stakes tasks to a
   closed Opus 4.7 advisor beat Opus-4.7-alone on BOTH cost AND performance. Compound open+closed routing is
   Pareto-superior, not merely cheaper — the most transferable design pattern on the page.
2. Open Router Fusion (tier 2, durable): panels of budget models + judge/synthesizer surpass frontier models
   at lower cost; beyond-frontier comes from frontier panels. Independent second data-point corroborating #1.
3. Chat→agents token-cost explosion (tier 3, durable): one user triggers hundreds of recursively-spawning,
   longer-running agents → super-linear cost that forces application-layer firms into routing/management.
   Names the structural economic driver underneath findings #1-2.

INPUT-ADJUSTMENT PROPOSALS:
1. PC-2 dictionary + (recurrence-tracked): DeepSeek (aka Deep Seek), Z.ai (aka ZAI), Copilot Cowork (aka
   Copilot Co-work). Benchmark garbles `Bridgebench`/`program bench`/`Kimi code bench V2` are too speculative
   to canonicalise this wave (no confident target) → flag for human confirmation, don't auto-normalise.
2. claim-date standing item — no code owed. Positive control clean (claim-date == episode-date), so the
   #91 note stands: exclude pages where claim-date already equals episode-date from any batch re-dating job
   to avoid churn. (Standing fix, for the record: ingest.py `_build_ledger_bullet`,
   `claim_date = episode_date` with fallback to ingest_date only when episode_date is absent.)
3. PC-6 corpus-thesis clustering (NEW low-priority suggestion, no code): the three durable compound-
   architecture claims (Harvey, Open Router Fusion, chat→agents cost driver) recur as a cross-page thesis —
   consider a shared concept page (e.g. [[Compound Model Architecture]]) so the corpus-wide pattern is
   navigable as one linked cluster. Track for recurrence; graduate to an extraction-prompt hint (emit a
   thesis-tag on compound-routing claims) if a 2nd page carries the same cluster.

STRUCTURAL OUTCOME: single-page wave, verdict good, max severity LOW → HIGH-on-2+-pages rule does NOT fire
→ no new PROPOSED CHANGES block; the source:: HIGH-garble graduation watch (from #88) stays armed at 1 page,
unchanged. No new PC class, no graduation, no code owed. Net new: PC-2 dictionary +3 (DeepSeek, Z.ai, Copilot
Cowork) with benchmark garbles held for human confirmation; PC-6 gains a corpus-thesis clustering suggestion
(compound-architecture cluster); claim-date and dedup/tiering both clean positive controls (page excluded
from the re-date backlog, cited as a good hype/assertion separation exemplar).

### 2026-08-24 — Review wave #93 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-month-ai-woke-up.md` verdict good.
Max severity MEDIUM (ASR entity names); no HIGH, no new PC class. Everything folds into standing PC-2
(ASR/entity-name normalisation + dictionary), PC-3 (source-authority hedging — working as intended here),
and PC-6 (link-floor). claim-date is a clean positive control. HIGH-on-2+-pages rule does NOT fire → no
new PROPOSED CHANGES block.

Defects found (by kind):
- asr-artefact-in-entity-name (MEDIUM, PC-2 people/product dictionary): four load-bearing proper nouns
  look mistranscribed and must be verified before promotion to canonical pages — `Ben Sarah` (solopreneur,
  likely wrong), `Pulsia` (company), `Seed Dance 2.0` (almost certainly ByteDance **Seedance 2.0**), and
  `Cobalt tool` (unverified Anthropic tool). None wikilinked → blast radius limited, but they anchor the
  assertions. `Seed Dance 2.0`→Seedance 2.0 is confident enough to normalise + mint [[Seedance 2.0]];
  the other three flag for human confirmation (no confident target). PC-2 dictionary +1 confident
  (Seedance, aka Seed Dance); 3 held-for-confirmation.
- under-linking (LOW, PC-6 link-floor): 9 wikilinks all resolve (no dangling), but recurring durable
  entities in the free text stay unlinked — [[Andrej Karpathy]], [[OpenClaw]] (ClaudeBot→MultBot→OpenClaw)
  — so the page's highest-value durable-wisdom assertions don't connect into the graph. Correctness
  unaffected; connectivity below the PC-6 floor. Single LOW → folds into PC-6.
- claim-date-defect-check (LOW, positive control): CLEAN. `episode-date:: 2026-03-03` present; every
  `claim-date::` reads 2026-03-03 (episode date), NOT ingest-date 2026-08-24. Standing ingest-date defect
  confirmed ABSENT; page excluded from the re-date backlog. Minor semantic note: inline per-event dates
  (WSJ Feb 10, Block layoffs mid-Feb) are not separately captured — acceptable as episode-level "date
  asserted"; see proposal #3.
- source-authority-hedging (LOW, PC-3, working-as-intended exemplar): three unverified host claims (Pulsia
  $1.25M run-rate, IBM 25-yr stock drop, Block 4,000 layoffs) correctly tagged source-authority::
  single-source at confidence 0.85. Appropriate hedging — cited as a good PC-3 example, no action.
- dedup-and-tiering (LOW, positive control): 12/12 assertion-fp:: markers unique/well-formed; tier &
  confidence sane (t1 0.85-0.9 factual snapshots, t2 0.8-0.95 durable analysis); snapshot/durable
  volatility flags align; residual hype ('off the charts', 'hot new trade') quarantined inside attributed
  quotes, not in the reviewer voice. Good separation.

Top wisdom highlights (durable, correctly volatility:: durable — a threshold/saturation cluster):
1. Karpathy threshold claim (durable, confidence 0.95): coding agents "basically didn't work before
   December [2025] and basically do now" — a structural marker of when agentic coding crossed the
   usefulness threshold. Single most durable/high-value assertion on the page.
2. Benchmark-saturation (Meta long-horizon study, durable): Opus 4.6 scoring "off the charts" such that the
   field's most-watched capability metric "can't keep up any longer" — a durable meta-observation that
   current AI-progress measurement is breaking down.
3. Autonomy-ambition shift (OpenClaw: ClaudeBot→MultBot→OpenClaw, durable): non-developers granting models
   system access to do meaningful autonomous work — a durable behavioural/adoption shift, not a news event.

INPUT-ADJUSTMENT PROPOSALS:
1. PC-2 dictionary +1 confident (recurrence-tracked): Seedance / Seedance 2.0 (aka ASR `Seed Dance 2.0`,
   ByteDance video model). Hold for human confirmation (no confident target, do NOT auto-normalise):
   `Ben Sarah`, `Pulsia`, `Cobalt tool` — extraction should surface these as low-confidence entity names
   rather than silently canonicalising. Reinforces the PC-2 verify-before-promote arm.
2. claim-date standing item — no code owed. Positive control clean (claim-date == episode-date), so the
   #91/#92 note stands: exclude pages where claim-date already equals episode-date from any batch re-dating
   job to avoid churn. (Standing fix, for the record: ingest.py `_build_ledger_bullet`,
   `claim_date = episode_date` with fallback to ingest_date only when episode_date is absent.)
3. per-event-date capture (NEW low-priority suggestion, no code): where an assertion cites a specific inline
   event date distinct from the episode date (WSJ Feb 10, Block mid-Feb), the episode-level claim-date
   conflates "date asserted" with "date of event". Consider an optional `event-date::` field (episode-date
   already present to disambiguate) so per-event granularity is capturable without disturbing claim-date.
   Track for recurrence; graduate to an extraction-prompt hint if a 2nd page shows the same conflation.
4. PC-6 durable-entity link-floor reminder: extraction should wikilink recurring durable entities named in
   free text (people like Andrej Karpathy, products/agents like OpenClaw) so durable-wisdom assertions
   connect into the graph rather than stranding as text. Tightens PC-6's existing scope; no new arm.

STRUCTURAL OUTCOME: single-page wave, verdict good, max severity MEDIUM → HIGH-on-2+-pages rule does NOT
fire → no new PROPOSED CHANGES block; the source:: HIGH-garble graduation watch (from #88) stays armed at
1 page, unchanged. No new PC class, no graduation, no code owed. Net new: PC-2 dictionary +1 confident
(Seedance) with three names held for human confirmation (Ben Sarah, Pulsia, Cobalt tool); a new low-priority
`event-date::` per-event-granularity suggestion; PC-3 cited as a working-as-intended single-source hedging
exemplar; claim-date and dedup/tiering both clean positive controls (page excluded from the re-date backlog).

### 2026-08-24 — Review wave #94 (synthesiser)
Pages reviewed (2): `podcast-evidence___the-era-of-vertical-ai-models.md` (acceptable) and
`podcast-evidence___the-latest-ai-models-and-model-rumors.md` (acceptable).
**BOTH pages are DUPLICATE re-reviews — no new information, no new defect class.** Page 1 = waves #88 + #89
(this is its 3rd submission); page 2 = wave #91 (its 2nd submission). Logged compactly per the tidy/merge
rule; full analysis lives in #88/#89 (page 1) and #91 (page 2) and is not restated. Every finding folds
into standing PC-1/PC-2/PC-3/PC-4/PC-6, all already covered/APPLIED. Operational note for the orchestrator:
BOTH pages were re-submitted after already being synthesised — de-dup upstream so the review mesh stops
re-spending on settled pages (same request as #89's note, now recurring).

Defects by kind (all recurrences — reconciled against prior waves, nothing new):
- Page 1 HIGH asr-entity-corruption in source:: (PC-2, APPLIED): `Eoin MacCarron` (source:: L24/L54) /
  `Eoin Mac Caba` (evidence L28) → Eoghan McCabe (Intercom). = wave #88's HIGH PC-2 source:: garble,
  already in the dictionary. Fix unchanged: normalise across source::+evidence BEFORE person-node/link mint.
  CRITICAL for the graduation rule: this is the SAME page as #88/#89, NOT a 2nd distinct page → the source::
  HIGH-garble graduation watch does NOT advance; stays armed at 1 distinct page.
- Page 1 MEDIUM asr-in-evidence + garbled-evidence (PC-2 verify arm + PC-5 claim↔evidence): `Kimmy K 2.5`→
  Kimi K2.5 (already in dictionary, recurrence #12/#88); `ex-user called Finn` = Composer-2/Cursor ↔
  Intercom-Finn cross-topic bleed (evidence-coherence watch, #88). Evidence does not cleanly support the
  Composer-2 assertion → PC-5. Fix unchanged.
- Page 1 MEDIUM wrong-referent wikilink (PC-1 token-collision arm): L111 `[[Post Training Quantisation]]` is
  a 'post training' surface-token collision; the claim is post-training/fine-tuning on experiential data, not
  quantisation. = wave #88 finding. Fix: re-target `[[Post-Training]]`/`[[Fine-Tuning]]` or drop; keep the
  already-present correct `[[Experiential Learning]]`.
- Page 1 LOW tier-authority-mismatch (PC-3): L71 Bloomberg GPT + L101 Composer-2-beats-Opus tagged tier::1
  but source-authority:: secondary (host commentary) while sibling tier-1s are primary quotes. = #89's PC-3
  tier-vs-authority finding. Fix: demote to tier::2 to match the authority field.
- Page 2 MEDIUM asr-benchmark-name ×2 (PC-2 eval/benchmark sub-arm): `ARKG I2`→ARC-AGI-2,
  `Humanities Last Exam`→Humanity's Last Exam (HLE), in assertion+evidence. = wave #91; both already in the
  PC-2 dictionary. Fix: normalise + mint `[[ARC-AGI-2]]`/`[[Humanity's Last Exam]]` (PC-6 link-floor).
- Page 2 LOW possible-name-corruption (PC-2 people dict): `Ara Khachaturian`→Ara Kharazian (Ramp economist).
  = wave #91; already in dictionary. Correct on confirmation.
- Page 2 LOW source-authority-inflation (PC-3 relayed-primary): Ramp/Kharazian, Dan Shipper, Swyx tagged
  source-authority:: primary but are host-relayed third-party quotes. = wave #91. Fix: demote to `secondary`
  or add `relayed-primary` qualifier.
- Page 2 LOW minor-evidence-artefact (PC-2 evidence-scrub): `a a million donation` vs clean `$1 million`.
  = wave #91; reinforces that PC-2 normalisation must scrub the evidence field, not just the assertion.
- Page 2 LOW low-durable-wisdom-density (PC-4 working-as-intended): news-heavy page, ~3 durable insights,
  rest correctly volatility:: snapshot. Not a defect — PC-4 tagging behaving as intended.

Top wisdom highlights (durable; unchanged from #88/#91):
1. Host synthesis (page 1, L111): vertical/specialised models do NOT contradict Sutton's Bitter Lesson —
   their post-training leverages experiential INTERACTION data, not human-encoded knowledge (Sutton's own
   'next phase'). The most durable, non-obvious reconciliation in the corpus; anchored by the Bitter Lesson
   (Rich Sutton, tier 1, 0.98) and Karpathy's 'speciation' framing.
2. Dan Shipper (page 2): extreme model speed (GPT-5.3 Codex Spark ~1,000 tok/s) shifts the bottleneck to the
   human review loop and demands a new UX — a durable workflow principle, not a spec.
3. GPT-5.3 Codex Spark served exclusively on Cerebras Wafer Scale (page 2): OpenAI's first non-Nvidia-
   targeted model — a durable inference-hardware-diversification signal.

Positive control (claim-date / Refinement #1) — CLEAN on BOTH pages (2/2): page 1 `episode-date:: 2026-03-29`,
page 2 `episode-date:: 2026-02-17`; every `claim-date::` equals its episode date, not ingest-date 2026-08-24.
Standing ingest-date defect confirmed ABSENT on both; both excluded from the pre-fix re-date backlog. Fix
already applied (Refinement #1); no new one-line `_build_ledger_bullet` fix owed. (Standing fix, for the
record: ingest.py `_build_ledger_bullet`, `claim_date = episode_date` with fallback to ingest_date only when
episode_date is absent.)

INPUT-ADJUSTMENT PROPOSALS: none new — all folded into standing PC-1 (token-collision wrong-referent arm),
PC-2 (entity/ASR/benchmark normalisation + evidence-scrub, APPLIED; dictionary already carries Eoghan McCabe,
Kimi K2.5, ARC-AGI-2, Humanity's Last Exam/HLE, Ara Kharazian), PC-3 (tier-vs-authority + relayed-primary),
PC-4 (volatility, working as intended), PC-5 (claim↔evidence), PC-6 (link-floor). One de-dup request stands:
the orchestrator is re-submitting already-synthesised pages — filter settled pages upstream.

STRUCTURAL OUTCOME: 2-page wave but BOTH duplicate re-reviews of already-synthesised pages (page 1 = #88/#89,
page 2 = #91); max severity HIGH but the HIGH source:: garble is on ONE distinct page only (page 1 = #88's
page) → the HIGH-on-2+-DISTINCT-pages rule does NOT fire → no new PROPOSED CHANGES block. The source::
HIGH-garble graduation watch (from #88) stays armed at 1 distinct page, UNCHANGED — a 3rd submission of the
same page does not advance it; it needs a 2nd DISTINCT page with a HIGH-in-source:: garble. No new PC class,
no graduation, no code owed. claim-date is a clean positive control on both pages (2/2, both excluded from
the re-date backlog).

### 2026-08-24 — Review wave #95 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-most-important-ai-lesson-for-businesses-from-2025.md` (good).
Single-page wave, verdict good, max severity LOW → no new defect class, nothing graduates, no code owed.
Every finding folds into standing PC-1/PC-2/PC-6; full mechanism lives in those blocks, not restated.

Defects by kind (all LOW, all recurrences):
- wikilink-semantic-mismatch (PC-1, national-vs-org wrong-sense arm): `[[National Ai Strategy]]` linked from two
  org-level claims (L61 agentic-strategy-roadmap stat, L141 data searchability/reusability stat). Target
  resolves and exists, so a relevance nit not a broken edge — same class as the recurring `[[UK National AI
  Strategy]]` wrong-sense edge (waves #29/#36). Fix: re-point to an org-level target (`[[Enterprise AI
  Adoption]]` / `[[AI Strategy]]`).
- under-linking (PC-6 link-floor, cosmetic): KPMG deployment claim (L21) links only `[[AI Agents]]`; would
  co-locate better also under `[[Enterprise AI Adoption]]` beside the parallel Deloitte adoption stat (L11).
- evidence-asr-noise (PC-2 evidence-scrub arm, working-as-intended positive signal): evidence:: retains raw ASR
  ('Gardner'→Gartner, '280fold', 'by 27'→2027, 'Genai', 'CIOS', 'Q3 poll survey'→Pulse Survey) BUT assertion
  text and ALL entity/wikilink names are clean — no ASR leaked into the graph. Reinforces that PC-2 evidence
  normalisation is the remaining scrub target; the mint-path guard is holding.
- source-conflation-risk (no PC / no action): two distinct '11%' figures (Deloitte 11% agents-in-production L11
  vs KPMG 11% Q1 baseline→42% Q3 L21) sourced separately/correctly; downstream-reader conflation hazard only.

Top wisdom highlights (durable):
1. Tier-2 headline thesis (L151): durable value from agentic AI comes from redesigning operations end-to-end,
   not layering agents onto existing workflows — the episode's most generalizable lesson.
2. L31: inference cost fell ~280-fold in two years yet enterprise AI spend grows explosively (usage outpaces
   cost reduction) — a durable Jevons-paradox economic insight, not ephemeral news.
3. L41/L51: structural SEO→GEO shift (AI answers cut click-through to conventional sites by >1/3) is the durable
   signal; the specific 6.5%→14.5% figures are the ephemeral (volatility::) part.

Positive control (claim-date / Refinement #1) — CLEAN: all 15 assertions carry `claim-date:: 2025-12-28` =
`episode-date:: 2025-12-28`, NOT ingest-date 2026-08-24. Standing ingest-date defect confirmed ABSENT; page
excluded from the pre-fix re-date backlog. Fix already applied (Refinement #1); no new one-line
`_build_ledger_bullet` fix owed. (Standing fix, for the record: ingest.py `_build_ledger_bullet`,
`claim_date = episode_date` with fallback to ingest_date only when episode_date is absent.)

INPUT-ADJUSTMENT PROPOSALS: none new — all fold into standing PC-1 (national-vs-org wrong-sense arm), PC-2
(evidence-field scrub, the assertion/entity path already clean here), PC-6 (link-floor co-location).

STRUCTURAL OUTCOME: single-page wave, verdict good, max severity LOW → HIGH-on-2+-distinct-pages rule does NOT
fire → no new PROPOSED CHANGES block. The source:: HIGH-garble graduation watch (from #88) stays armed at 1
distinct page, unchanged. No new PC class, no graduation, no code owed. claim-date is a clean positive control
(page excluded from the re-date backlog); the clean assertion/entity path with dirty evidence:: is a useful
positive control that PC-2's mint-path guard holds and only the evidence-scrub arm remains outstanding.

### 2026-08-24 — Review wave #96 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-most-important-ai-news-from-google-io.md` (good).
Single-page wave, verdict good, max severity LOW → no new defect class, nothing graduates, no code owed.
Every finding folds into standing PC-1/PC-2/PC-6; full mechanism lives in those blocks, not restated.

Defects by kind (all LOW, all recurrences):
- link-precision, wrong-referent (PC-1 wrong-sense arm): assertion 2 (Karpathy/OpenAI corporate-personnel
  claim) links `[[OpenAI API]]` — a product page — where the org-level `[[OpenAI Research Organisation]]`
  (no bare `[[OpenAI]]` exists) is the correct anchor. Resolves, so relevance nit not a broken edge. Fix:
  re-point to `[[OpenAI Research Organisation]]` (or mint `[[OpenAI]]`).
- link-precision, under-representing subject (PC-1 wrong-sense arm + PC-6 link-floor): assertion 5 (Gemini
  consumer app 900M MAU) tagged only `[[Google Cloud]]` (infra), not the consumer-app subject. Fix: add a
  Gemini-app entity link; `[[Google Cloud]]` under-represents the assertion.
- evidence-asr-noise ×2 (PC-2 evidence-scrub arm, mint-path guard holding): assertion 15 evidence `a writer
  named Prin` (mis-transcribed author name; weakest-sourced claim, single-source/speculative conf 0.55) and
  assertion 12 evidence `Claude Coder CodeXing` (→ Claude Code / Codex). Both confined to verbatim
  evidence:: strings — assertion text and ALL entity/wikilink names clean, no ASR leaked into the graph.
  Reinforces PC-2 evidence normalisation is the remaining scrub target; mint-path guard holds. `Prin`
  attribution is unverifiable as written — if uncorrectable, consider lowering conf / flagging attribution.

Top wisdom highlights (durable):
1. Token-normalised benchmarking as an evaluation principle: Gemini 3.5 Flash burns ~3.5× more tokens than
   GPT-5.5 Medium, so headline speed/cost gains are an 'indictment of the value proposition' once tokens are
   priced in — a transferable lens for reading any model benchmark.
2. Distribution beats product coherence in consumer AI: Google's overlapping tool sprawl (Spark, Antigravity,
   AI Studio, Flow) may still win by default because existing reach puts 'the right version in the right
   place' — a durable strategic thesis, not ephemeral news.
3. Strategic fault-line inside a frontier lab: long-horizon world-models/robotics (Hassabis) vs fast
   coding-agent path to recursive self-improvement (Brin faction) — durable signal on how AGI strategy
   fractures internally, though single-source and speculative here.

Positive control (claim-date / Refinement #1) — CLEAN: `episode-date:: 2026-05-20`; every `claim-date::`
equals 2026-05-20 (the episode date), NOT ingest-date 2026-08-24. Standing ingest-date defect confirmed
ABSENT; page excluded from the pre-fix re-date backlog. Fix already applied (Refinement #1); no new one-line
`_build_ledger_bullet` fix owed. (Standing fix, for the record: ingest.py `_build_ledger_bullet`,
`claim_date = episode_date` with fallback to ingest_date only when episode_date is absent.)

INPUT-ADJUSTMENT PROPOSALS: none new — all fold into standing PC-1 (wrong-referent/wrong-sense: product page
for a corporate claim, infra page for a consumer-app claim), PC-2 (evidence-field scrub, assertion/entity
path already clean here), PC-6 (link-floor: add the more-apt Gemini-app / OpenAI-org anchor).

STRUCTURAL OUTCOME: single-page wave, verdict good, max severity LOW → HIGH-on-2+-distinct-pages rule does
NOT fire → no new PROPOSED CHANGES block. The source:: HIGH-garble graduation watch (from #88) stays armed at
1 distinct page, unchanged. No new PC class, no graduation, no code owed. claim-date is a clean positive
control (page excluded from the re-date backlog); dirty evidence:: with a fully clean assertion/entity path
again confirms PC-2's mint-path guard holds and only the evidence-scrub arm remains outstanding.

### 2026-08-24 — Review wave #97 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-most-important-ai-stories-this-week.md` (acceptable).
Single-page wave, max severity MEDIUM → HIGH-on-2+-distinct-pages rule does NOT fire → no new PROPOSED
CHANGES block, no new PC class. Every finding folds into standing PC-2 / PC-3.

Defects by kind:
- asr-artefact LEAKED INTO ASSERTION+ENTITY path (MEDIUM, PC-2 BODY arm — mint-path guard FAILED this
  wave): 'Selen Township, Michigan' (assertion L91 + evidence L98) is an ASR mistranscription of
  'Saline Township' (Oracle's ~$10bn Michigan data centre near Ann Arbor). Unlike #95/#96 where dirty
  evidence:: sat behind a clean assertion/entity path (guard held), here the garble reached the ASSERTED
  place-name and would mint a spurious 'Selen Township' geo-entity into the graph. This is the PC-2 body
  arm firing (cf. GDPval-into-body #13/#17, 'CloudCode' #29) — a direct counter-instance to the #95/#96
  positive controls, confirming the mint-path guard is NOT universally holding and the body arm is still
  the higher-severity failure mode (vs the evidence-scrub arm). Fix: 'Selen Township' → 'Saline Township,
  Michigan' in BOTH assertion (L91) and evidence (L98); dictionary add (verify pass): Selen→Saline.
- asr-artefact, evidence-only (LOW, PC-2 evidence-scrub arm — guard held): Rohit Prasad departure evidence
  (L38) 'head scientist of AIG' → 'AGI'; assertion body (L31) already correct ('AI/AGI'), so confined to
  the verbatim evidence:: string, no leak into the graph. Fix: 'AIG'→'AGI' in evidence (L38).
- vendor-marketing-as-fact (LOW, PC-3 recurrence — vendor-primary-source flavour): Gemini 3 Flash lead
  (L11) asserts as fact 'outperforms Gemini 2.5 Pro, 3× faster, fraction of the cost' at tier:1 /
  conf:0.95, sole source a Sundar Pichai promo tweet. Vendor marketing carried at primary-authority /
  near-certain confidence overstates epistemic standing (no independent benchmark). Fix per PC-3:
  downgrade confidence and/or set source-authority:: social|vendor (not primary); optionally cross-link
  the page's OWN L141 counterweight (Gemini 3 Flash 91% hallucination rate on Artificial Analysis's
  omniscience test) — a benchmarked check on the marketing line, already on-page.

Top wisdom highlights (durable):
1. Consolidation of AI initiatives under single leadership across Amazon/Google/Meta (L151, tier-2) is a
   structural strategic-focus trend — the one generalisable pattern on the page vs the dated news items.
2. Gemini 3 Flash scores 91% on Artificial Analysis's omniscience test (answering when it should refuse,
   L141) — a durable benchmarked signal that fast/cheap frontier models trade off refusal calibration, and
   a direct empirical check on the vendor 'outperforms 2.5 Pro' marketing claim (see PC-3 finding above).

Positive control (claim-date / Refinement #1) — CLEAN: every `claim-date:: 2025-12-21` = `episode-date::
2025-12-21`, NOT ingest-date 2026-08-24. Standing ingest-date defect confirmed ABSENT; page excluded from
the pre-fix re-date backlog. Reviewer flagged worth confirming the pipeline used episode-date deliberately,
not by coincidence — it does: Refinement #1 is APPLIED, `_build_ledger_bullet` sets claim_date=episode_date
(the 2025-12-21 match is the applied fix working, not luck). (Standing fix, for the record: ingest.py
`_build_ledger_bullet`, `claim_date = episode_date` with fallback to ingest_date only when episode_date is
absent. Deferred re-date owes only the pre-fix backlog, waves #1/#2.)

INPUT-ADJUSTMENT PROPOSALS: none new — all fold into standing PC-2 (body-arm entity-name scrub, dictionary
add Selen→Saline; evidence-arm AIG→AGI) and PC-3 (source-authority:: / confidence cap on vendor-primary
marketing claims). NB the wave's one notable data-point is negative: the mint-path guard FAILED here (garble
in the asserted place-name), breaking the two-wave #95/#96 'guard holds' streak — logged as a PC-2 body-arm
recurrence, not a new class. Not yet a 2+-page HIGH cluster, so no code owed; if a 2nd page this cycle shows
ASR reaching the assertion/entity path, the PC-2 body arm is the graduation candidate for a hard verify-pass
gate (reject minting an entity whose name is not corroborated outside the raw transcript).

STRUCTURAL OUTCOME: single-page wave, verdict acceptable, max severity MEDIUM → 2+-page NEW-block rule does
NOT fire → no new PROPOSED CHANGES block. source:: HIGH-garble graduation watch (from #88) stays armed at 1
distinct page, unchanged. No new PC class, no graduation, no code owed. claim-date is a clean positive
control (applied-fix verified, page excluded from re-date backlog); the Selen→Saline leak is a useful
NEGATIVE control showing PC-2's mint-path guard does not universally hold — the body arm remains the
outstanding higher-severity scrub target alongside the evidence arm.

### 2026-08-24 — Review wave #98 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-new-ai-org-chart.md` (acceptable). Single-page wave, max
severity MEDIUM → HIGH-on-2+-distinct-pages rule does NOT fire → no new PROPOSED CHANGES block. One
genuinely NEW observation flavour opens a watch (W-EPDATE, below); everything else folds into standing PC-3.

Defects by kind:
- episode-date field mis-parse / freshness-implausibility (MEDIUM, NEW kind → opens watch **W-EPDATE**):
  `episode-date:: 2026-04-14` is contradicted by the ledger's own internal evidence — Claim 1's evidence
  says the Block/Dorsey essay "was released about a week ago" and `ingest-date:: 2026-08-24`, placing the
  true air date in mid-August 2026, ~4 months later. For a DAILY show (AI Daily Brief) a 4-month
  episode→ingest gap is implausible; the episode-date is likely mis-parsed/hallucinated at extraction.
  This is DISTINCT from W-YEARINFER (hallucinated year in the CLAIM BODY) — here the metadata
  `episode-date::` FIELD itself is wrong, and because Refinement #1 anchors every `claim-date::` to it,
  the upstream error silently propagates to all 12 claims. Single-field fix once verified: correct
  `episode-date::` and re-propagate `claim-date::`. First occurrence → W-EPDATE armed at 1 page.
- sourcing-granularity / tier-vs-authority (LOW, PC-3 recurrence): Claim 2 (Block "40% workforce
  reduction") rides tier:1 / conf:0.9 but is a secondary host aside ("recently made news with the 40%
  layoffs") with volatility:: snapshot — a drift-prone corporate-action figure carried at primary
  authority, over-confident vs the tier-2 primary-essay claims around it. Exactly PC-3's numeric/
  authority-inflation remit (× PC-4 volatility snapshot). Fix: demote Claim 2 tier:1 → tier:2.
- claim-date (Refinement #1) — POSITIVE CONTROL, with W-EPDATE caveat: all 12 `claim-date:: 2026-04-14`
  == `episode-date:: 2026-04-14`, NOT ingest-date 2026-08-24 → the re-dating machinery worked and the
  page is EXCLUDED from the pre-fix re-date backlog. Caveat: the anchor itself is suspect (W-EPDATE), so
  a correct claim-date depends on first fixing episode-date — a single-field upstream correction.

Top wisdom highlights (durable):
1. The "ant death spiral" failure mode: agents in a shared group channel trigger each other in an
   infinite loop, burning millions of tokens until a human intervenes — a durable, mechanistic,
   transferable design warning for multi-agent systems (assertion-fp 892df7c40f5d1b6d).
2. Middle-management's core function — aggregating information upward, relaying decisions downward — is
   the first org role AI replaces; top-down (Block) and bottom-up (Every) models converge on this
   (assertion-fp 059aeaab28a0fc33). Durable structural insight, not ephemeral news.
3. Block's post-hierarchy org framework — four components (capabilities, world model, intelligence layer,
   interfaces) normalising humans to three roles (ICs, DRIs, Player Coaches) — a concrete, reusable
   org-design pattern (assertion-fp a4969ad7a1f6e905 / 58a00df60f379fe2).

INPUT-ADJUSTMENT PROPOSALS:
1. NEW watch **W-EPDATE — episode-date field freshness/plausibility guard.** For daily/weekly shows, an
   `episode-date::` far from `ingest-date::` (heuristic: daily show > ~14 days, or contradicting an
   in-transcript recency cue like "released about a week ago") is a likely extraction mis-parse. Because
   Refinement #1 anchors `claim-date::` to `episode-date::`, this is an upstream single-field defect that
   poisons every claim-date. Proposed low-cost guard at ingest: after parsing episode-date, if
   `abs(ingest_date − episode_date) > freshness_window[cadence]`, emit a WARN and (optionally) fall back
   to a transcript-derived recency cue before writing claim-date. First occurrence → watch, not yet code.
2. claim-date standing item (Refinement #1) — VERIFIED again as an applied fix (12/12 claim-date ==
   episode-date, page excluded from re-date backlog). No further code owed for the ingest-date defect.
   For the record, the applied one-line fix in ingest.py `_build_ledger_bullet` sets
   `claim_date = episode_date` (fall back to `ingest_date` only when `episode_date` is absent) — W-EPDATE
   now flags that the *fallback anchor* (episode_date) can itself be wrong, which #98 is the first case of.
3. Optional link-precision (PC-1 adjacent, not a defect): Claim 5 discusses Block's "customer world
   model"; a `Customer World Model.md` page exists and may be the more precise target than the generic
   `[[World Model]]` — worth a targeted retarget check, not a graph-wide action.

STRUCTURAL OUTCOME: single-page wave, verdict acceptable, max severity MEDIUM → 2+-page NEW-block rule
does NOT fire → no new PROPOSED CHANGES block, no new PC class. Net new this wave: ONE new watch
(W-EPDATE, episode-date freshness guard, armed at 1 page) — the first case where Refinement #1's anchor
(episode_date) is itself suspect, distinct from W-YEARINFER's claim-body year defect. sourcing-granularity
folds into PC-3 (× PC-4). claim-date is a clean applied-fix positive control (page excluded from the
re-date backlog), caveated only by the W-EPDATE anchor question above.

### 2026-08-24 — Review wave #99 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-new-jobs-ai-will-create.md` (GOOD). Single-page wave, all
findings LOW → HIGH-on-2+-distinct-pages rule does NOT fire → no new PROPOSED CHANGES block. Every finding
folds into an existing standing item; one small, non-defect sourcing proposal noted (host naming) that
adjacent standing PC-3 sourcing remit already covers. No new watch, no new PC class.

Defects by kind:
- claim-date (Refinement #1) — POSITIVE CONTROL, CLEAN: all 10 assertions carry `claim-date:: 2026-05-11`
  == `episode-date:: 2026-05-11`, NOT ingest-date 2026-08-24 → re-dating machinery worked; page EXCLUDED
  from the pre-fix re-date backlog. No W-EPDATE flag: daily-show episode→ingest gap is ~3.5 months but
  there is no contradicting in-transcript recency cue, and the anchor is internally consistent, so this is
  a normal backlog-ingest gap, not a mis-parse. No `_build_ledger_bullet` fix owed.
- source-attribution (LOW, PC-3-adjacent sourcing remit): `source::` is uniformly generic "AI Daily Brief
  Host" — the host is not named (Nathaniel Whittemore / NLW). Single-source, no ASR artefacts in entity
  names. Naming the individual would strengthen dedup/entity resolution. Folds into PC-3's sourcing remit;
  not a defect. See input proposal #2 below.
- confidence-uniformity (LOW, PC-3 recurrence): mechanically flat conf — seven tier-2 assertions all at
  0.95, three tier-3 all at 0.85. Defensible (high conf host *said* X, lower for speculative job-count
  projections) but not per-claim calibrated. Exactly PC-3's uniform-confidence remit; no new action.
- evidence-quality (LOW, POSITIVE): every assertion verbatim-quote-backed, paraphrases specific/analytical
  not hype; tier/volatility mapping sane (durable industry-analysis = tier 2; speculative job-count
  projections = tier 3/speculative); all 10 unique assertion-fp, no dedup collisions. Clean exemplar.
- wikilinks (LOW, POSITIVE): all six `[[wikilinks]]` resolve to existing pages (Service Design, Embodied
  Presence, Accountability, Future Of Work, Data Governance, Healthcare Technology). PC-1 clean.

Top wisdom highlights (durable):
1. The "lump of labour fallacy" reframing: treating AI as purely a labour-supply story presumes constant
   demand and ignores demand elasticity and the expansionary nature of economies — a durable analytical
   frame for the whole AI-jobs debate.
2. Capability-vs-service-design reframing of the AGI objection: labour demand is not only "can AI perform
   the task?" but "does AI-only delivery satisfy the demand?", with trust and accountability as design
   constraints — a durable lens that outlasts any specific model capability.
3. The seven-category "human premium" taxonomy (relationship, embodied presence, trust, accountability,
   translation, behaviour change, provenance/status) — a reusable, durable framework for where human
   economic value persists; far more durable than the ephemeral 276k–1.2M navigator job-count
   projections (tier 3, speculative, correctly demoted).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item (Refinement #1) — VERIFIED again as an applied fix (10/10 claim-date ==
   episode-date, page excluded from re-date backlog). No further code owed for the ingest-date defect.
   For the record, the applied one-line fix in ingest.py `_build_ledger_bullet` sets
   `claim_date = episode_date` (fall back to `ingest_date` only when `episode_date` is absent). W-EPDATE
   (episode-date freshness/plausibility guard) did NOT fire here: gap is large but internally consistent
   with no contradicting recency cue → normal backlog ingest, distinct from #98's mis-parse. W-EPDATE
   stays armed at 1 page.
2. Optional source-naming precision (PC-3 sourcing remit, not a defect): where a show's `source::` is a
   generic role string ("AI Daily Brief Host") and the host is stably known (NLW / Nathaniel Whittemore),
   the extraction prompt could map known-show → named host to strengthen dedup/entity resolution. Low
   value / low urgency, per-show lookup table; folds into PC-3, not a graduation. Noted, not yet code.

STRUCTURAL OUTCOME: single-page wave, verdict GOOD, all findings LOW → 2+-page NEW-block rule does NOT
fire → no new PROPOSED CHANGES block, no new PC class, no new watch. claim-date is a clean applied-fix
positive control (10/10, page excluded from the re-date backlog); confidence-uniformity + source-attribution
fold into PC-3; wikilinks/evidence-quality are clean positive controls (PC-1). Net new: one optional
source-naming input proposal (folds into PC-3). W-EPDATE unchanged (still 1 page).

### 2026-08-24 — Review wave #100 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-next-wave-of-enterprise-ai.md` (verdict GOOD). Single-page
wave; one MEDIUM finding, rest LOW → HIGH-on-2+-distinct-pages rule does NOT fire → no new PROPOSED
CHANGES block. The MEDIUM folds into already-graduated PC-5; every other finding folds into an existing
standing item or is a clean positive control. No new watch, no new PC class.

Defects by kind:
- evidence-claim-mismatch (MEDIUM, PC-5 recurrence on a PRE-FIX BACKLOG page): tier-3 emerging-signal
  assertion (fp 140844c5d6f21d30) headlines a 'subsidy era → scarcity era of token usage' framing + an
  H2-2026 characterisation that its own evidence quote ('both OpenAI and Microsoft showed off big
  plays... the race for the next wave of enterprise AI adoption is fully on') does not substantiate —
  synthesised extrapolation, not sourced. This is exactly PC-5's claim↔evidence grounding failure (claim
  must state what its evidence supports; no invention). PC-5 is already graduated + applied to the
  extraction prompt (2026-08-24 ~09:45), BUT this page ingested from `episode-date:: 2026-06-04` and is a
  pre-fix backlog episode, so extraction ran WITHOUT the PC-5 grounding line. No new code owed; this is
  backlog residue the DEFERRED re-date+re-link+re-extract pass should catch. conf 0.7/volatility
  speculative partly mitigate. Single occurrence → does not re-open PC-5 or spawn a watch.
- claim-date (Refinement #1) — POSITIVE CONTROL, CLEAN: all 15 assertions carry
  `claim-date:: 2026-06-04` == `episode-date:: 2026-06-04`, NOT ingest-date 2026-08-24 → re-dating machinery
  worked; page EXCLUDED from the pre-fix re-date backlog. episode-date present in frontmatter = anchor
  intact. No W-EPDATE flag: ~2.7-month episode→ingest gap but internally consistent, no contradicting
  in-transcript recency cue → normal backlog ingest, not a mis-parse. No `_build_ledger_bullet` fix owed.
- tier-confidence-calibration (LOW, POSITIVE, PC-3×PC-4 working): tier-1 factual metrics 0.85–0.95
  (snapshot/durable), tier-2 industry-analysis 0.8–0.85 (durable), tier-3 emerging signal 0.7
  (speculative). Snapshot volatility correctly applied to ephemeral metrics (Codex 5M WAU, 50%
  parallel-task share, 150 partners, HBM cost doubling, SK Hynix capacity). source_authority correctly
  downgraded secondary→single-source on the host's own tier-2/3 arguments. Clean PC-3/PC-4 exemplar.
- sourcing-quality (LOW, POSITIVE): tier-1 claims quote transcript verbatim in evidence:: with specific
  figures + named-speaker attribution (Suleyman on MAI vs GPT-5.5 cost/quality; Anthropic on Mythos
  safeguards); no verbatim hype leaks into assertion prose; single-source flagged where host editorialises.
- entity-names (LOW, POSITIVE, PC-2 clean): no ASR artefacts; product/model names (MAI Thinking 1, Mythos,
  Project Glasswing, Codex Sites, Sonnet 4.6, Opus 4.6, GPT-5.5, SK Hynix, MoE) internally consistent,
  cleanly spelled. Near-future synthetic-dated 2026 names (unverifiable vs public record) = source-inherent,
  not a transcription defect.
- wikilinks (LOW, POSITIVE, PC-1 clean): all 12 distinct `[[wikilinks]]` resolve to existing pages
  (AI Governance Law and Privacy, Frontier Model Evaluation, AI Regulation, AI Safety Institute, Anthropic,
  Enterprise AI Adoption, Agentic Workflow, High Bandwidth Memory, Token Economics,
  Mixture-of-Experts Architecture, Large Language Models, Model Performance). No broken links.
- dedup-markers (LOW, POSITIVE): all 15 assertions carry a distinct 16-hex `assertion-fp`; no collisions.

Top wisdom highlights (durable):
1. Shift from sequential to parallel task execution lets one knowledge worker operate at small-team scale
   by orchestrating concurrent work streams (fp 0cef50a0c11d7c47) — durable structural insight about
   agentic-workflow economics, outlives any single tool's metrics.
2. Disposable, shareable web apps are becoming a core knowledge-work primitive alongside decks/docs/
   spreadsheets, not software engineering (Codex Sites framing, fp 4ea9c3f756523f07) — durable reframing
   of what knowledge work is, correctly tiered as host argument / single-source.
3. The Trump AI executive order explicitly disclaims any mandatory government licensing / pre-clearance /
   permitting for new AI model development (fp 9ec7401b736b2386) — durable, directly-quoted governance
   fact with reference value beyond the news cycle.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item (Refinement #1) — VERIFIED again as an applied fix (15/15 claim-date ==
   episode-date, page excluded from re-date backlog). No further code owed. For the record, the applied
   one-line fix in ingest.py `_build_ledger_bullet` sets `claim_date = episode_date` (fall back to
   `ingest_date` only when `episode_date` is absent). Use this page as a POSITIVE CONTROL when auditing
   the fleet-wide ingest-date defect: if the DEFERRED re-date pass runs blindly, guard it against
   clobbering these already-correct 2026-06-04 dates (only re-date pages whose claim-date == ingest-date).
2. PC-5 backlog reminder (no new code): the tier-3 fp-140844c5 mismatch is a pre-fix-backlog artefact,
   not a regression of the live PC-5 prompt line. The DEFERRED re-date+re-link pass should be EXTENDED to
   re-extract (or at least re-ground) pre-fix backlog pages under the graduated PC-5 grounding rule, else
   ungrounded synthesised headlines like this survive in the graph. Local hand-fix if touched: replace the
   evidence quote with transcript text that actually supports the 'subsidy→scarcity token era' framing, or
   soften the assertion to the quote present. Folds into the existing DEFERRED backlog job — not a new block.
3. Optional as-of markers on fast-ageing snapshot metrics (Codex 5M WAU, HBM cost 'doubled so far this
   year') — `volatility:: snapshot` already flags them for promote.py decay handling, so this is cosmetic;
   noted, not code.

STRUCTURAL OUTCOME: single-page wave, verdict GOOD; one MEDIUM (PC-5 recurrence, pre-fix backlog residue)
+ all-else LOW → 2+-distinct-page NEW-block rule does NOT fire → no new PROPOSED CHANGES block, no new PC
class, no new watch. claim-date is a clean applied-fix positive control (15/15, excluded from re-date
backlog). The MEDIUM folds into graduated+applied PC-5 (its survival is a backlog-scope gap, addressed by
extending the DEFERRED re-extract pass, not new code). tier-calibration/sourcing/entity/wikilink/dedup are
clean positive controls (PC-1/PC-2/PC-3/PC-4). W-EPDATE unchanged (still 1 page).

### 2026-08-24 — Review wave #101 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-openclaw-ification-of-ai.md` (verdict GOOD, YouTube
v=GR-j31Nrl0Y). Single-page wave; one MEDIUM (date-plausibility) + rest LOW → HIGH-on-2+-distinct-pages
rule does NOT fire → no new PROPOSED CHANGES block, no new PC class. The one structurally notable item is
that this is the **second W-EPDATE observation** and the widest episode→ingest gap seen so far (~6 months
on a *daily* brief), which advances the W-EPDATE watch (see below).

Defects by kind:
- date-plausibility (MEDIUM, W-EPDATE recurrence — 2nd page): `episode-date:: 2026-02-27` sits ~6 months
  before ingest-date 2026-08-24. For a DAILY brief that gap is the largest yet and atypical → candidate
  episode-date mis-parse worth a spot-verify against the source video. Distinct from #99/#100, where the
  gaps (~3.5 / ~2.7 months) were internally consistent with no atypicality flag and did NOT trip W-EPDATE.
  Internal date consistency here is intact (claims all dated to the episode), so this is a plausibility
  concern about the ANCHOR, not a claim-date defect. This is the same failure class as #98's mis-parse,
  so W-EPDATE now stands at **2 pages** (see INPUT-ADJUSTMENT #1).
- claim-date (Refinement #1) — POSITIVE CONTROL, CLEAN (with W-EPDATE caveat): all 14 assertions carry
  `claim-date:: 2026-02-27` == `episode-date:: 2026-02-27`, NOT ingest-date 2026-08-24 → re-dating
  machinery worked; page EXCLUDED from the pre-fix re-date backlog. Caveat: the anchor itself is the
  W-EPDATE suspect above, so "correctly dated to the episode" is only as trustworthy as the episode-date.
  No `_build_ledger_bullet` fix owed; applied fix stands (`claim_date = episode_date`, fall back to
  `ingest_date` only when `episode_date` absent).
- asr-attribution (LOW, PC-2-adjacent / PC-3 sourcing remit): two `source::`/evidence handles look like
  ASR-mangled socials — 'Claude Code PM (Weebin)' (line 54) and commentator 'Sitebringer' (line 118).
  These live in source/evidence fields, not entity wikilinks, so graph impact is minimal, but the handles
  cannot be trusted verbatim. Folds into PC-3's sourcing remit (clean the derived handle before the
  `source::` value is trusted downstream); single occurrence, no new watch.
- tier-confidence-calibration (LOW, POSITIVE, PC-3×PC-4): well-graded ladder — tier-1 product
  announcements 0.9–0.95 (snapshot), tier-2 industry analysis 0.75–0.8 (durable), tier-3 predictions
  0.5–0.55 (speculative). Minor: host-relayed Peter Steinberger→OpenAI hiring (line 81) is tier-1 conf
  0.85 but single-source host commentary → arguably tier-2; soft calibration nudge, not a hard error.
  Folds into PC-4 (source-authority downgrade on host-relayed items); no new action.
- entity-names / asr-artefacts (LOW, POSITIVE, PC-2 clean): assertion PROSE entities clean and normalised
  (Claude Code, Anthropic, Perplexity, Notion, Aravind Srinivas, Simon Willison, Peter Steinberger). ASR
  spellings ('Clawd Code', 'Open Claw') survive only inside verbatim `evidence::` quotes = acceptable.
  'OpenClaw' retained as a canonical cross-graph entity (dedicated page
  podcast-evidence___openclaw-goes-to-openai.md exists), not an artefact.
- wikilinks (LOW, POSITIVE, PC-1 clean): all 9 distinct `[[wikilinks]]` resolve to existing pages
  (Agentic Workflow, Autonomous Task Execution, Multi-Model Orchestration, Multimodal AI,
  Workflow Automation, Model Routing Architecture, OpenAI API, Agentic AI, Context Awareness). No danglers.
- assertion-quality / dedup (LOW, POSITIVE): each of 14 assertions pairs a specific claim with a named
  source + verbatim `evidence::`; promotional phrasing ('AI team that never sleeps', 'labor primitive')
  is quoted/attributed, not asserted as fact — no unmarked hype leak. All 14 carry a distinct
  `assertion-fp`; no collisions.

Top wisdom highlights (durable):
1. Scheduled tasks mark a CATEGORY change, not a feature update: AI shifts from reactive software you
   prompt to proactive software that works while you sleep — a 'labor primitive' (Akash Gupta / 'Sitebringer',
   line 111). The single most durable framing on the page; outlives any specific product launch.
2. The 'OpenClaw-ification' thesis (line 91): major products aren't copying one competitor's features but
   adopting shared agentic primitives — remote interaction, persistent memory, scheduled autonomous work —
   that define the agentic era. Durable conceptual lens vs the ephemeral product-launch items.
3. Practitioner heuristic (line 121): manually wiring the raw agentic tooling teaches the underlying
   primitives better than using the abstracted, productised versions — a durable learning principle.

INPUT-ADJUSTMENT PROPOSALS:
1. W-EPDATE now at **2 pages** (#98 mis-parse + this ~6-month daily-brief gap) — the watch is recurring,
   not a one-off. It has NOT yet graduated (still no code), but a second, wider-gap occurrence strengthens
   the case. Proposed guard, unchanged from its #98 arming and offered again for team-lead consideration:
   in ingest.py, after resolving `episode_date`, emit a soft `W-EPDATE` warning (do NOT block ingest) when
   `abs(ingest_date - episode_date) > cadence_tolerance` for a show whose cadence is daily/weekly — e.g.
   `> 30 days` for a daily/weekly brief — so atypical anchors are surfaced for spot-verify instead of
   silently trusted. One 6-month-gap daily brief is exactly the mis-parse this would catch. Still a watch,
   not a PROPOSED CHANGE (needs a 3rd occurrence or a team-lead call to graduate); re-verify this page's
   2026-02-27 anchor against v=GR-j31Nrl0Y as the concrete trigger.
2. claim-date standing item (Refinement #1) — VERIFIED again as an applied fix (14/14 claim-date ==
   episode-date, page excluded from re-date backlog). No further code owed for the ingest-date defect.
   NOTE the W-EPDATE interaction: the re-date fix faithfully propagated a *possibly mis-parsed* anchor to
   every claim — i.e. Refinement #1 and W-EPDATE are complementary, the former guarantees claims track the
   episode-date, the latter guards that the episode-date itself is trustworthy. Guard any DEFERRED
   re-date pass against clobbering these already-correct dates (only re-date pages where claim-date ==
   ingest-date).
3. ASR handle-cleaning (PC-3 sourcing remit, not a defect): 'Weebin' / 'Sitebringer' are ASR-derived social
   handles in `source::`/evidence. The extraction prompt could flag ASR-uncertain handles (low-confidence
   proper nouns in source fields) for human confirmation before the `source::` value is trusted for dedup/
   entity resolution. Low urgency; folds into PC-3, not a graduation.

STRUCTURAL OUTCOME: single-page wave, verdict GOOD; one MEDIUM (date-plausibility, W-EPDATE recurrence)
+ all-else LOW → 2+-distinct-page NEW-block rule does NOT fire → no new PROPOSED CHANGES block, no new PC
class. Net new: **W-EPDATE advances 1→2 pages** (widest episode→ingest gap yet, on a daily brief) — the
one structurally material movement this wave; still a watch, not yet graduated. claim-date is a clean
applied-fix positive control (14/14, excluded from re-date backlog) caveated by the W-EPDATE anchor
question. asr-attribution + tier-nudge fold into PC-3/PC-4; wikilinks/entity/assertion-quality/dedup are
clean positive controls (PC-1/PC-2).

### 2026-08-24 — Review wave #102 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-perils-of-the-ai-exponential.md` (verdict GOOD, episode-date
2026-02-24). Single-page wave, ALL findings LOW → HIGH-on-2+-distinct-pages rule does NOT fire → no new
PROPOSED CHANGES block, no new PC class. Two items of structural interest: (a) a NEW low-grade kind —
entity surface-form vs wikilink-target divergence (prose 'GPT-5.3 Codex' vs link [[GPT-5.3 Codex Spark]]);
(b) this page REFINES the W-EPDATE mis-parse hypothesis (see INPUT-ADJUSTMENT #1) — same ~6-month gap as
#101, but here judged coherent, weakening the mis-parse read.

Defects by kind:
- claim-date (Refinement #1) — POSITIVE CONTROL, CLEAN: all 6 assertions carry `claim-date:: 2026-02-24`
  == `episode-date:: 2026-02-24`, NOT ingest-date 2026-08-24 → applied re-date fix works; page EXCLUDED
  from the pre-fix re-date backlog. Reviewer explicitly flags this page as a GOOD TEMPLATE for the
  ingest-date fix (claim-date pinned to episode-date). No `_build_ledger_bullet` fix owed; applied fix
  stands (`claim_date = episode_date`, fall back to `ingest_date` only when `episode_date` absent).
- entity-surface-vs-link divergence (LOW, NEW low-grade kind — W-MODELVER/PC-7-adjacent): assertion prose
  says 'GPT-5.3 Codex' but the wikilink targets [[GPT-5.3 Codex Spark]] (resolves to an existing page).
  The link is not broken; the concern is that the sentence surface form and the linked entity name differ
  by a 'Spark' suffix — either a legitimate short-vs-full product name, or an entity-merge/ASR artefact.
  This is the intra-page-canonicalisation family (PC-7/W-CANON) crossed with model-version disambiguation
  (W-MODELVER): prose and link disagree on the exact model identifier. Single occurrence, graph-resolving
  → LOW; folds into PC-7 (pick ONE canonical surface form, and make prose agree with the link) / W-MODELVER
  watch rather than opening a fresh watch. Spot-confirm 'GPT-5.3 Codex' == 'GPT-5.3 Codex Spark'.
- asr-in-evidence (LOW, W-VERBSIC — textbook case): entity names in the ASSERTIONS are clean (METR spelled
  correctly throughout), but `evidence::` verbatim fields carry raw ASR errors — 'Meter' for METR (lines
  28, 38, 68) and a garbled fragment 'features on the viral chart requires an AI agent…' (line 28). This is
  exactly W-VERBSIC: structured entity normalised (METR), raw ASR survives in the graph-visible verbatim
  quote. Confined to evidence, not the canonical assertions → LOW impact; no new watch, reinforces
  W-VERBSIC's standing remit (leave verbatim faithful, but the transcript is noisy).
- date-plausibility (LOW, W-EPDATE COHORT — REFINES the mis-parse hypothesis): `episode-date:: 2026-02-24`
  sits ~6 months before ingest-date 2026-08-24 — the SAME wide gap that tripped W-EPDATE on #101. BUT here
  the reviewer judged it COHERENT, not atypical: the episode references Opus 4.6 and GPT-5.3 Codex, which
  are consistent with sibling ledger pages in the same ingest cohort (opus-46-and-chatgpt-53-codex-are-here,
  and #101's openclaw-ification page). Marked LOW / provenance-note, NOT a defect. This is materially
  informative for W-EPDATE (see INPUT-ADJUSTMENT #1): a real Feb-2026 backlog-ingest cohort, not a
  per-page mis-parse.
- tier/confidence/volatility (LOW, POSITIVE, PC-3×PC-4): tiers (all 1), confidence (0.9–0.95),
  source-authority (primary) and volatility flags internally consistent and well-discriminated — snapshot
  model-performance numbers (Opus 4.6=14.5h, GPT-5.3 Codex=6.5h, 98h saturation bound) tagged
  `volatility:: snapshot`; methodological/trend claims tagged durable. Clean PC-3/PC-4 positive control.
- wikilinks (LOW, POSITIVE, PC-1 clean): both distinct `[[wikilinks]]` resolve — [[Scaling Laws]],
  [[GPT-5.3 Codex Spark]]. No danglers (surface-form caveat above notwithstanding).
- dedup (LOW, POSITIVE): all 6 assertions carry a distinct `assertion-fp` marker — complete coverage, no
  collisions.

Top wisdom highlights (durable):
1. METR researcher David Rein's caveat that the agentic time-horizon metric is 'extremely noisy' — a tiny
   change in task distribution swings the same model between 8 and 20 hours. Durable methodological
   inoculation against over-reading the viral doubling chart; the single most durable item on the page.
2. METR's benchmark DEFINITION: a task's time horizon = the duration a human engineer takes to solve it,
   with model success scored at a 50% correct-answer rate (secondary 80%). Durable, transferable grounding
   for interpreting ANY agentic-capability claim.
3. The ~7-month doubling of agentic task time-horizon (accelerating to ~3 months for late-2024/early-2025
   models), traced back to GPT-2 — the durable trend line, held distinct from the ephemeral per-model hour
   figures.

INPUT-ADJUSTMENT PROPOSALS:
1. W-EPDATE — this page REFINES, does NOT advance, the watch. #101 read a ~6-month daily-brief gap as a
   candidate mis-parse; this page shows the SAME ~6-month gap on a page whose referenced products
   (Opus 4.6, GPT-5.3 Codex) genuinely date to Feb 2026 and match a coherent sibling cohort → the gap is
   most likely a REAL backlog-ingest cohort (episodes recorded Feb 2026, ingested Aug 2026), NOT a
   per-page date mis-parse. Revised guidance for the proposed W-EPDATE guard: gate on INTERNAL
   INCONSISTENCY (episode-date contradicting the era of entities the episode references / sibling-page
   anchors), NOT on the raw `abs(ingest_date - episode_date)` magnitude — a large gap alone is a
   false-positive generator for backlog cohorts. Still a watch, not a PROPOSED CHANGE; count unchanged
   at 2 pages (#98 genuine mis-parse + #101 flagged), with #102 as the coherent counter-example that
   sharpens the trigger condition.
2. claim-date standing item (Refinement #1) — VERIFIED again as an applied fix (6/6 claim-date ==
   episode-date; page excluded from re-date backlog and named as the reference template). No further code
   owed for the ingest-date defect. DEFERRED re-date passes must still only touch pages where
   claim-date == ingest-date, to avoid clobbering these already-correct dates.
3. entity surface-vs-link divergence (PC-7/W-MODELVER remit, not a defect): the verify pass could add a
   soft check that a wikilink's target name and the surrounding prose surface form agree (or that any
   divergence is a known short-form alias), flagging 'GPT-5.3 Codex' vs [[GPT-5.3 Codex Spark]] for
   confirmation before treating them as the same referent. Low urgency; folds into PC-7, not a graduation.

STRUCTURAL OUTCOME: single-page wave, verdict GOOD; ALL findings LOW → 2+-distinct-page NEW-block rule
does NOT fire → no new PROPOSED CHANGES block, no new PC/watch class. Net material movement: W-EPDATE's
mis-parse hypothesis is REFINED (trigger should be internal-inconsistency, not raw gap magnitude — this
page is the coherent-cohort counter-example). claim-date is a clean applied-fix positive control (6/6,
named reference template). asr-in-evidence = textbook W-VERBSIC; entity surface-vs-link = new low-grade
PC-7/W-MODELVER-adjacent observation; wikilinks/tier/volatility/dedup are clean positive controls
(PC-1/PC-3/PC-4).

### 2026-08-24 — Review wave #103 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-race-to-put-ai-agents-everywhere.md` (verdict ACCEPTABLE,
episode-date 2026-03-18, 14 assertion blocks). Single-page wave carrying ONE HIGH (a factual parent-company
misattribution) → HIGH-on-2+-distinct-pages rule does NOT fire → no new PROPOSED CHANGES block, no new
PC/watch class. The HIGH is precisely the load-bearing relationship error that the already-pending PC-10
verify-pass relationship check targets → it REINFORCES PC-10 (and PC-2's maker/attribution arm) with a new
data point rather than opening anything.

Defects by kind:
- factual maker-misattribution (HIGH — PC-2 maker/attribution arm ∩ PC-10): L41 attributes Manus to Meta
  ('Meta's Manus', `source:: Manus (Meta)`) at tier-1 / confidence-0.9. Manus AI is a product of the startup
  **Monica** (Chinese-origin), NOT Meta — a downstream consumer would ingest a false corporate-parent
  relationship. Same failure family as wave #22's Grok→'SpaceX AI' (PC-2 maker-arm) and the Colossus/xAI
  conflation that graduated W-MISATTRIB→PC-10: a load-bearing entity-relationship asserted wrong. Single
  page → does not fire the 2+ rule, but it is a textbook positive instance that PC-10's proposed verify-pass
  relationship check would have caught pre-publish. Dictionary fix: Manus AI = Monica (not Meta).
- asr-obfuscation in entity/source strings (MEDIUM — W-VERBSIC ∩ PC-2 source arm): product/name references
  in claim text and `source::` carry ASR/obfuscation artefacts no reader can map to real entities —
  'Open Claw', 'Nemo Claw', 'Enterprise Claw', and especially 'Cloud Code' (near-certainly Claude Code).
  Person names mangled too: 'Fijisimo'/'Cimo' → Fidji Simo (L71/78), 'Arvind Srinivas' → Aravind Srinivas
  (L91). NOTE the discriminator: the `[[wikilink]]` ENTITIES themselves are clean and resolve — the
  degradation is confined to the surrounding source/claim SURFACE strings. This is W-VERBSIC's structured-
  entity-normalised / raw-surface-survives signature, here landing in `source::` (PC-2 source arm) rather
  than only in `evidence::`.
- weak-link-relevance (LOW — W-LINKGAP / PC-1 relevance arm): the Jensen Huang 'Open Claw strategy' quote
  (L11) and the Nemo Claw software-toolkit claim (L51) both link [[NVIDIA H200]] — a specific GPU SKU
  irrelevant to a corporate-strategy quote / an agent-toolkit claim. Links resolve, so no danglers; the
  concern is precision — claims attach to a hardware hub page rather than a strategy / agent-platform
  concept. Re-target suggestion below.
- transcript-verbatim-noise (LOW — W-VERBSIC): `evidence::` retains raw ASR filler/hype — 'steer individual
  individual agents' and the garbled handle 'LLM Junky and Well' (L68). Transcript-verbatim residue in an
  evidence field; leave faithful but noisy — reinforces W-VERBSIC standing remit.
- claim-date (Refinement #1) — POSITIVE CONTROL, CLEAN: `episode-date:: 2026-03-18` present and ALL 14
  `claim-date::` == 2026-03-18 (the episode date), NOT ingest-date 2026-08-24 → applied re-date fix
  (`claim-date:: {episode_date or today}`, ingest.py L653) works; page EXCLUDED from the pre-fix re-date
  backlog. No `_build_ledger_bullet` fix owed.
- dedup / tier / wikilinks (LOW, POSITIVE): all 14 blocks carry a distinct `assertion-fp` (complete
  coverage, no collisions); tier/confidence monotonic and sane (T1 0.85–0.95, T2 0.70–0.85, T3 0.55–0.60);
  all 8 distinct wikilinks resolve to existing page files. Clean PC-1/PC-3/dedup positive controls.

Top wisdom highlights (durable):
1. Aravind Srinivas (Perplexity): the chat UI is good for answers and agents are good for individual tasks,
   but the UI for entire WORKFLOWS has always been the computer — a durable framing thesis for why agentic
   products converge on a full-computer surface rather than chat.
2. Kevin Simback (Delphi Labs): OpenClaw-style agents proved people don't want AI chat, they want to get
   work done; giving an LLM broad access to your machine and personal info is both insanely useful and
   mildly terrifying — durable product + security insight.
3. Adaptive's 'encoded memory' pattern: an agent that encodes how specific software and user preferences
   work in order to automate future requests — a durable interaction/architecture pattern that outlives
   the specific product launch.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item (Refinement #1) — VERIFIED again as an applied fix (14/14 claim-date ==
   episode-date; page excluded from re-date backlog). No further code owed for the ingest-date defect;
   applied fix stands (ingest.py L653 `claim-date:: {episode_date or today}`). DEFERRED re-date passes
   must still only touch pages where claim-date == ingest-date, to avoid clobbering already-correct dates.
2. PC-2 maker-arm / PC-10 (the HIGH) — reinforces, does NOT advance to a new block (single page). The
   Manus→Meta error is a NEW sub-flavour for the family: a wrong-PARENT-COMPANY factual attribution in a
   structured `source::` field, distinct from PC-10's graph-adjacency merges (Colossus/xAI) and PC-2's
   Grok→'SpaceX AI' maker-garble. Confirms PC-10's verify-pass relationship check should assert against a
   known maker/parent dictionary; add entry 'Manus AI → Monica (not Meta)'. No new PC/watch class.
3. asr-obfuscation in source/claim strings (W-VERBSIC / PC-2 source-arm remit, not a graduation): the
   extraction/verify pass could apply a known-alias normalisation map to `source::` and claim SURFACE text
   before publish — 'Cloud Code'→'Claude Code', 'Fijisimo'/'Cimo'→Fidji Simo, 'Arvind Srinivas'→Aravind
   Srinivas, and flag/annotate 'Open Claw'/'Nemo Claw'/'Enterprise Claw' to their real referents — so
   sources stay traceable even where the wikilink entity is already clean. Low urgency; folds into the
   existing W-VERBSIC/PC-2 source-arm remit.
4. weak-link re-targeting (W-LINKGAP / PC-1 relevance arm, not a defect): the verify pass could down-weight
   links to broad hardware-hub pages (e.g. [[NVIDIA H200]]) when the claim is a corporate-strategy or
   agent-toolkit assertion, preferring an agent-platform / strategy concept page. Low urgency; folds into
   PC-1's relevance arm.

STRUCTURAL OUTCOME: single-page wave, verdict ACCEPTABLE; ONE HIGH (factual parent-company misattribution,
Manus→Meta) but single page → 2+-distinct-page NEW-block rule does NOT fire → no new PROPOSED CHANGES
block, no new PC/watch class. Net material movement: the HIGH is a clean positive instance for the
already-pending PC-10 verify-pass relationship check (and PC-2 maker-arm), adding a wrong-parent-company
sub-flavour and a dictionary entry (Manus AI = Monica). asr-obfuscation = W-VERBSIC landing in `source::`
(PC-2 source arm); weak-links = W-LINKGAP/PC-1 relevance; verbatim-noise = textbook W-VERBSIC. claim-date
is a clean applied-fix positive control (14/14, excluded from re-date backlog); dedup/tier/wikilinks are
clean positive controls (PC-1/PC-3).

### 2026-08-24 — Review wave #104 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-right-way-to-worry-about-ai.md` (verdict ACCEPTABLE,
episode-date 2026-08-13, ingest-date 2026-08-24). NOTE this is a genuinely RECENT episode (ingest 11 days
after air) — unlike the 2026-03-18 back-catalogue of waves #100–103 — which makes its claim-date a strong
positive control (episode ≠ ingest by 11 days, so a stale ingest-date would be unmistakable). No HIGH this
wave; one MEDIUM (asr-mangled source names) + three LOW → single page, HIGH-on-2+-pages rule does NOT fire
→ no new PROPOSED CHANGES block, no new PC/watch class. Every finding folds into a standing class.

Defects by kind:
- asr-artefact-entity-name in `source::` strings (MEDIUM — W-VERBSIC ∩ PC-2 source arm): three source-
  attribution PERSON names are ASR-mangled to near-homophones of real, well-known figures — 'Christian
  Zegedy' → Christian Szegedy (L134), 'Rune (OpenAI)' → Roon (the OpenAI figure/handle, L144), 'Steven
  Bushbom' (Trepp) → Stephen Buschbom (L114). They sit in UNLINKED `source::` fields → no broken wikilink,
  but the attributions are factually wrong as written and would seed wrong/duplicate person entities if ever
  promoted to links. Exact same signature as wave #103's 'Fijisimo'→Fidji Simo / 'Arvind Srinivas'→Aravind
  Srinivas: person-name mangles confined to the source/claim SURFACE while structured entities stay clean.
  Dictionary additions below.
- unsupported-characterisation (LOW — wave-#9 hype-overreach watch): L41 asserts OpenAI called the agent
  message-board incident 'a watershed moment for AI security', but the assertion's OWN evidence block quotes
  only 'Agent orchestrated fully automated offensive attacks are real now' — the 'watershed' phrasing is not
  evidenced within its own claim. Same shape as the wave-#9 hedge-hardens-into-body pattern: editorial
  characterisation outrunning the attached quote. Fix below (soften or add the corroborating quote).
- editorialising-tone (LOW — wave-#9 hype-overreach watch ∩ PC-3, CORRECTLY HANDLED): L121 phrases OpenAI's
  disclosure as 'inoculating the industry and fostering a global discourse' — transcript-hype/editorial
  rhetoric carried into the assertion. It is correctly tagged tier-2 / secondary and attributed to the host,
  so PC-3's tier cap already contains it — acceptable, logged as a positive control that the tier machinery
  quarantines rhetorical host analysis from the flat tier-1 facts. No action.
- claim-date (Refinement #1) — POSITIVE CONTROL, CLEAN (STRONG): `episode-date:: 2026-08-13` present and
  EVERY `claim-date::` == 2026-08-13 (episode date), NOT ingest-date 2026-08-24 — an 11-day gap, so the
  applied re-date fix (`claim-date:: {episode_date or today}`, ingest.py L653) is unambiguously working on a
  recent episode. Page EXCLUDED from the pre-fix re-date backlog; no `_build_ledger_bullet` fix owed.

Top wisdom highlights (durable):
1. Specialised AI models (Evo, Stanford/Arc Institute) can generate viable NOVEL viruses (16,000 from
   700,000 sequences) — and crucially this is NOT a general-purpose LLM capability; it needs purpose-trained
   models on specialised datasets (L31/101). Durable AI-biosecurity framing that separates the real threat
   from ChatGPT/Claude scaremongering.
2. AI agents in internal evaluations spontaneously created a shared internal message board to exchange
   exploits, discoveries and work assignments (L41) — emergent multi-agent coordination as a security
   phenomenon; durable insight into agentic emergence.
3. A two-axis future-risk taxonomy: inadvertently-evolved ('subversive') behaviour vs deliberately-trained
   malicious ('adversarial') AI, each demanding a different policy response (L131) — a durable conceptual
   frame distinct from the episode's ephemeral funding/product news.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item (Refinement #1) — VERIFIED again, and on a RECENT episode (11-day episode↔ingest
   gap) which is the strongest positive control yet for the applied fix. No further code owed; applied fix
   stands (ingest.py L653 `claim-date:: {episode_date or today}`). Deferred re-date passes must still only
   touch pages where claim-date == ingest-date, to avoid clobbering already-correct dates — flag THIS page
   clean to the batch fixer to spare a redundant edit.
2. asr person-name normalisation (W-VERBSIC / PC-2 source-arm remit, not a graduation): extend the known-
   alias normalisation map applied to `source::`/claim SURFACE text with the three person-name pairs from
   this page — 'Christian Zegedy'→Christian Szegedy, 'Rune (OpenAI)'→Roon, 'Steven Bushbom'→Stephen
   Buschbom — so attributions are corrected BEFORE any promotion to linked person entities (the failure mode
   the reviewer flags: wrong/duplicate entity seeding). Low urgency; folds into the existing PC-2 source arm.
3. unsupported-characterisation guard (wave-#9 hype-overreach watch, not a graduation): the verify pass
   could assert that a quoted characterisation phrase in the assertion (e.g. 'watershed moment for AI
   security') actually appears in — or is paraphrase-consistent with — its OWN `evidence::` block, and
   otherwise soften the assertion or surface the mismatch. Single-page and LOW → reinforces the wave-#9
   watch, does not advance it; no new block.

STRUCTURAL OUTCOME: single-page wave, verdict ACCEPTABLE; no HIGH → 2+-distinct-page NEW-block rule does
not fire → no new PROPOSED CHANGES block, no new PC/watch class. Net movement: asr person-name mangles add
three dictionary entries to the PC-2 source-arm normalisation map (Szegedy/Roon/Buschbom); unsupported-
characterisation + editorialising both reinforce the wave-#9 hype-overreach watch (the latter already
contained by PC-3's tier-2 cap). claim-date is the strongest applied-fix positive control to date (episode
2026-08-13 ≠ ingest 2026-08-24, 11-day gap, all claims == episode) and is excluded from the re-date backlog.

### 2026-08-24 ~14:10 — Refinements #9–#10 APPLIED (team lead), from PC-9 + PC-10
- **PC-9 (host/recurring-name normalisation)** + **PC-10 (no unsupported relationship edges)**
  applied as extraction-prompt lines (lightweight; verify-pass surgery deferred as lower-frequency).
  PC-2 ASR fix VERIFIED working: newest 15 pages show correct GPT-5.4/Opus 4.6 formatting, zero
  un-dotted version garbles.
- Decision: remaining long-tail defect classes (PC-9 full host-map, PC-10 verify-pass semantic
  check) are edge cases; prioritising backlog throughput of durable wisdom over exhaustive
  long-tail coverage. 128/190 episodes ingested, graph cleaned (317 false edges removed),
  provenance+volatility fields live on all post-fix pages.

### 2026-08-24 — Review wave #105 (synthesiser)
Pages reviewed (2): `podcast-evidence___the-rise-of-the-zero-human-company.md` (verdict ACCEPTABLE, episode-date
2026-03-04, ingest-date 2026-08-24) and `podcast-evidence___the-saaspocalypse-continues.md` (verdict ACCEPTABLE).
Highest severity this wave is MEDIUM on BOTH pages; no HIGH → the HIGH-on-2+-distinct-pages rule does NOT fire.
The single PROPOSED-CHANGES event is a watch graduation: **W-YEARINFER GRADUATES on its pre-registered 2nd page →
new PC-11** (Pulsia "early 2025"), minted by the watch's own trigger, NOT by the HIGH rule. ASR entity/name garble
recurs on both pages but MEDIUM/LOW → folds into standing PC-2; no independent block from that recurrence.

Defects by kind:
- garbled-assertion (page 1, MEDIUM — PC-2 body/ASR arm ∩ W-VERBSIC): Swyx's "tiny teams" definition is mangled
  to "teams with more than $1 million in ARR than employees" (nonsensical), and the evidence quote is equally
  broken ("more million in ARR than employees"). Intended sense: more units of $1M-ARR than headcount (more
  millions of ARR than employees). ASR/paraphrase artefact corrupting BOTH the claim and its verbatim quote —
  W-VERBSIC's exact shape (garble survives in the graph-visible evidence field). PC-2 covers; fix restores the
  "more $1M-ARR units than employees" sense and, if the transcript allows, the evidence quote.
- unsourced-specifics (page 1, MEDIUM — PC-5 ∩ PC-10 relation arm ∩ W-MISATTRIB): assertion 4 asserts Henry Shih
  is a "former Super.com founder and current Anthropic employee", but the attached evidence supports NEITHER
  Super.com NOR Anthropic (it only says "repeat founder who's built a $100M ARR startup … now building an AI"),
  and the evidence is a spliced jumble that folds in a Sam Altman quote. Two failures at once: fabricated
  employer/company affiliation edges (person→company relations unsupported by evidence — PC-10 remit) + a
  claim-vs-own-evidence divergence with a spliced foreign quote (PC-5). Fix: strip the unsupported Super.com /
  Anthropic specifics (or attach real evidence), and separate the mis-spliced Altman quote into its own assertion.
- date-error-in-claim (page 1, MEDIUM → GRADUATES W-YEARINFER → PC-11): assertion 6 says Pulsia "reached a run
  rate of $1.5M in ARR by early 2025", but the evidence dates the run-up to "the beginning of February … 1.5
  million today" against episode-date 2026-03-04 — i.e. early 2026, off by exactly one year. Internally
  inconsistent with assertion 8's "started building in November of last year" (=2025 from a 2026 episode). The
  evidence carries no absolute year → the extractor invented one, decrementing the episode year. This is
  W-YEARINFER's pre-registered 2nd page (1st = wave #55) → graduates to PC-11 (above).
- possible-asr-entity (page 1, LOW — PC-2 ASR-entity arm / W-VERBSIC): 'Clawmark' (assertion 11) and model name
  'Codex 5.2' (assertion 8) are unverified product/model names that may be ASR mis-transcriptions; 'Clawmark' in
  particular reads garbled, no wikilink, no corroboration. Low risk (both tier-3/transcript-scoped). NO dictionary
  seed minted — target spellings unknown/unverified; flag `[sic]`/verify against the source transcript, do not guess.
- source-field-vs-evidence-mismatch (page 1, LOW — PC-2 source arm ∩ PC-3 provenance cap): assertions 2 & 5 set
  `source:: 'Felix Craft Dashboard (felixcraft.ai)'` but the evidence field is a transcript quote, not a dashboard
  reading — the provenance label overstates directness. Actual source is the host reading figures aloud →
  single-source host-relay, PC-3's authority cap, not a primary dashboard read. Reinforces PC-3; no graduation.
- asr-entity-artefact (page 2, MEDIUM — PC-2 ASR arm ∩ PC-7/PC-8 canonicalisation): 'Open Claw' / 'Claw Hub' (the
  skills-marketplace malware story) read as ASR mishearings and are un-wikilinked → the security narrative can't
  resolve to a real platform entity; 'Agent Force' should be the single-token product **Agentforce**; the linked
  page title 'Claude Co-work' should normalise to **Claude Cowork**. PC-2 covers the ASR normalisation; the
  'Claude Co-work'→'Claude Cowork' casing/hyphenation fix is PC-8/W-CANON remit. Dictionary seeds below for the
  two VERIFIABLE targets (Agentforce, Claude Cowork); 'Open Claw'/'Claw Hub' flagged `[sic]`/verify (marketplace
  name unverified — no blind seed).
- under-linking (page 2, LOW — PC-6 link-coverage floor): strong named entities left as plain text with no
  wikilink — Salesforce, Thomson Reuters, OpenAI, Box, VirusTotal, Agentforce, and execs Benioff, Levie, Gerstner,
  Goldfarb, Althoff. None of these pages exist yet, so the linker defensibly linked only already-existing pages
  (Microsoft, AI Agents, Malware, Market Capitalization, Claude Co-work). Defensible, but the graph misses durable
  connective tissue for recurring industry actors. Folds into PC-6; also argues for seeding recurring-actor pages.
- link-target-quality (page 2, LOW — PC-8/W-CANON, GRAPH-LEAK REINFORCEMENT): the one arguably-ASR-derived
  wikilink, [[Claude Co-work]], RESOLVES to an existing page — meaning the malformed hyphenated form has ALREADY
  propagated as a canonical page title elsewhere in the graph rather than being caught at emission. Concrete
  evidence that PC-8's target class (non-canonical casing/hyphenation) has leaked into the graph as a real node →
  warrants a graph-wide alias/merge pass 'Claude Co-work' → 'Claude Cowork'. Notable, but LOW and single-page →
  reinforces PC-8, does not open a new class.
- claim-date (Refinement #1) — POSITIVE CONTROL, CLEAN on BOTH pages (page 1 STRONG): page 1 has
  `episode-date:: 2026-03-04`, `ingest-date:: 2026-08-24`, and EVERY `claim-date:: == 2026-03-04` (episode date),
  NOT the ingest date — a 172-day gap, the largest positive-control margin logged, so a stale ingest-date would be
  unmistakable. Page 2 likewise has claim-date == episode-date (reviewer flags it as a reference example of the
  correct pattern). Both pages EXCLUDED from the pre-fix re-date backlog; no `_build_ledger_bullet` fix owed.

Top wisdom highlights (durable):
1. The "Work Slot problem" (host): human ATTENTION, not AI output volume, is the binding constraint on
   'zero-human' companies — business success is set by outcomes and scarce customer attention, not by the number
   of slides/videos/memos an agent can generate. The most durable, transferable insight on either page.
2. Swyx's counter to the one-person-billion-dollar-company narrative: the hero-founder focus is "an ego trip" and
   "it takes a village to do anything consequential and reliable" — durable industry wisdom that reframes the hype.
3. Ben Broca's build methodology: "skip to the end state" where AI does everything and wait to see what breaks in
   practice, rather than iteratively testing limitations — a reusable approach to building on frontier models.
4. (page 2) Brad Gerstner (Altimeter): AI disruption compresses software valuation multiples by shortening the
   cash-flow-predictability horizon — the 30-35x multiple implied a long horizon; contracting it structurally
   re-rates the sector. The durable mechanism, not the week's price move.
5. (page 2) Eric Goldfarb: seat-based SaaS pricing becomes "a tax on productivity" once buyers purchase agents to
   do work rather than software for humans to use — a durable structural critique of per-user pricing. Paired with
   Aaron Levie's counter-thesis (SaaS-as-substrate: incumbents survive by having customers build agents on top of
   retained subscriptions).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item (Refinement #1) — VERIFIED clean on BOTH pages; page 1 is the strongest positive
   control logged (172-day episode↔ingest gap, all claims == episode 2026-03-04, not ingest 2026-08-24). No
   further code owed; applied fix stands (ingest.py L653 `claim-date:: {episode_date or today}`). Flag BOTH pages
   clean to the batch re-date fixer so already-correct dates are not clobbered.
2. W-YEARINFER GRADUATION → PC-11 (concrete, above): verify-pass guard that flags any absolute date/year in a
   claim BODY absent from that claim's `evidence::`, anchors undated relative timing ("today", "by early <year>")
   to `episode-date::` instead of inventing a calendar year, never decrements the episode year by default, and
   adds a cross-assertion year-consistency check (assertion 6 "early 2025" vs assertion 8 "last year"). Minted by
   the watch's 2nd-page trigger, independent of the HIGH-on-2+ rule.
3. ASR entity/name normalisation (PC-2 + PC-8/W-CANON remit, not a new graduation): extend the normalisation map
   with the two VERIFIABLE page-2 targets — 'Agent Force' → **Agentforce**, 'Claude Co-work' → **Claude Cowork** —
   applied before promotion to linked entities; flag 'Open Claw'/'Claw Hub' (page 2) and 'Clawmark'/'Codex 5.2'
   (page 1) `[sic]`/verify against the transcript (targets unverified — no blind seed). PLUS a one-off graph-wide
   alias/merge on the EXISTING malformed [[Claude Co-work]] page → 'Claude Cowork' (the malformed form has already
   become a canonical node — PC-8's leak is now observable in the graph, not just at emission).
4. provenance-confidence (PC-3, reinforcement): cap `source:: 'Felix Craft Dashboard (felixcraft.ai)'` on
   assertions 2 & 5 to single-source host-relay authority (the host reading figures aloud from a transcript), not a
   primary dashboard reading — the source label must not overstate directness beyond what the evidence field shows.
5. link-coverage (PC-6, reinforcement): tier-1 revenue claims are under-linked (Felix Craft, Pulsia carry no
   entity links while lighter tier-2 claims do) — reinforces PC-6's assertion-level floor; and seed recurring
   industry-actor pages (Salesforce, Thomson Reuters, OpenAI, Box, VirusTotal, Agentforce, plus the named execs)
   so multi-episode signals accumulate on stable entities rather than fragmenting as plain text.

STRUCTURAL OUTCOME: two-page wave, both ACCEPTABLE; highest severity MEDIUM on each → HIGH-on-2+-distinct-pages
rule does NOT fire → no block from that rule. Net material movement: **W-YEARINFER GRADUATES → PC-11** (Pulsia
"early 2025" is its 2nd page, identical one-year-decrement fabrication to the wave-#55 opener). ASR entity/name
garble recurs across both pages (Clawmark/Codex 5.2/Open Claw/Claw Hub/Agent Force/Claude Co-work) but MEDIUM/LOW
→ folds into PC-2, two dictionary seeds minted (Agentforce, Claude Cowork), the rest `[sic]`/verify. The
unsupported Henry-Shih affiliation folds into PC-10 (unsupported cross-entity relation) + PC-5 (spliced-evidence).
[[Claude Co-work]] resolving to an existing malformed node is a concrete PC-8 graph-leak reinforcement → note a
graph-wide alias/merge to 'Claude Cowork'. claim-date is a clean positive control on both pages (page 1 a
172-day-gap high-water margin) and both are excluded from the re-date backlog.

### 2026-08-24 — Review wave #106 (synthesiser)
Pages reviewed (2): `podcast-evidence___the-self-driving-company.md` (verdict GOOD, episode-date
2026-07-23, ingest-date 2026-08-24) and `podcast-evidence___the-social-network-for-agents-just-got-acquired.md`
(verdict ACCEPTABLE, episode-date 2026-03-14). Highest severity this wave is MEDIUM on BOTH pages; no HIGH →
the HIGH-on-2+-distinct-pages rule does NOT fire → no new PROPOSED CHANGES block. Net movement: **PC-11
(W-YEARINFER, minted last wave #105) RECURS immediately on wave #106's page 1** — a fresh, independent
one-year discrepancy on the very next wave → strengthens the case for team-lead application AND extends PC-11's
guard scope to episode-date-vs-evidence-window (a whole-page off-by-one, upstream of the claim-body case).
claim-date is a clean positive control on BOTH pages.

Defects by kind:
- date-accuracy / whole-page year off-by-one (page 1, MEDIUM — REINFORCES + EXTENDS PC-11/W-YEARINFER):
  episode-date:: and all derived claim-date:: are 2026-07-23, but assertion #1's evidence cites the Replit
  data window as "early January to late June 2025" — a ~13-month lag. This is the mid-2025 AI Daily Brief
  episode; episode-date is almost certainly 2025-07-23, not 2026-07-23. DISTINCT root cause from the
  wave-#55/#105 PC-11 opener (which INVENTED a year in the claim BODY by decrementing the episode year): here
  the error is UPSTREAM — the episode-date itself was mis-extracted a year forward, then propagated into every
  claim-date. Same one-year family, opposite direction. → PC-11's proposed verify-pass guard must ALSO compare
  the episode-date year against absolute years present in evidence windows and flag a whole-page off-by-one,
  not only claim-body year invention. Immediate 2nd-wave recurrence = strong application signal.
- wikilink-semantic-mismatch / false edge (page 2, MEDIUM — PC-1 relevance / W-LINKGAP, wrong-target arm):
  the Thinking Machines Lab / Nvidia assertion (L41) explicitly concerns "next-generation Vera Rubin chips" but
  is wikilinked to [[NVIDIA H200]] — a previous-generation part. The link RESOLVES but points to the wrong
  entity → a false graph edge (resolvable ≠ correct, the PC-1 signature). Retarget to a Vera Rubin / next-gen
  Nvidia compute page, or to [[AI Compute Infrastructure]] which is ALREADY present on the page. New sub-flavour
  under PC-1: wrong-GENERATION product link (resolves to a real sibling entity of the wrong vintage). Single
  page this wave → reinforces PC-1, no graduation.
- asr-artefact-entity-names in PROSE (both pages, MEDIUM pg2 / LOW pg1 — PC-2 ASR-entity arm ∩ W-VERBSIC):
  page 1 verbatim evidence carries 'Replet agent', '7 figureure SAS solution', 'Replet' — but the graph-facing
  assertion bodies are CLEAN ('Replit'), so no artefact leaked into linked/queryable text (textbook W-VERBSIC:
  structured entity normalised, raw ASR survives only in verbatim). Page 2 is worse: 'Maltbook' (the acquired
  agent network), co-founder 'Matchlet' (alongside Ben Parr — almost certainly a mangled name), and
  'Open Claw'/'Claude Cloderburg' (from L108 garbage 'Schlitz Open Claw, Claude Cloderburg', normalised in the
  assertion to 'OpenClaw (Claude Code)'). MITIGATING on both pages: NONE of these suspect names are wikilinked —
  all actual links point to clean existing pages — so pollution is confined to prose. 'Open Claw' now recurs
  (wave #105 'Open Claw'/'Claw Hub' → wave #106 'Open Claw'/'Claude Cloderburg'→'Claude Code') → a candidate
  dictionary seed IS emerging, but the target is still an uncertain reconstruction → flag `[sic]`/verify against
  transcript, no blind seed (same discipline as wave #105). Folds into PC-2; no graduation.
- raw-transcript-garbage-in-evidence (page 2, LOW — W-VERBSIC): L108 retains 'Maltbook itself was built largely
  by Schlitz Open Claw, Claude Cloderburg'; the assertion sensibly normalises to 'OpenClaw (Claude Code)' but
  the normalised term is itself uncertain. Leave the evidence faithful-but-noisy — W-VERBSIC standing remit.
- claim-date (Refinement #1) — POSITIVE CONTROL, CLEAN on BOTH pages: page 1 has episode-date:: 2026-07-23,
  ingest-date:: 2026-08-24, and every claim-date:: == 2026-07-23 (episode date, NOT the 2026-08-24 ingest date)
  — correctly episode-dated, NOT the known ingest-date defect. Page 2 likewise: every claim-date:: == episode-
  date:: 2026-03-14, ≠ ingest-date. Both EXCLUDED from the pre-fix re-date backlog; no `_build_ledger_bullet`
  fix owed. NB: page 1's claim-dates are correctly-COPIED-but-WRONG (they faithfully mirror a mis-extracted
  2026 episode-date) — the defect there is the upstream episode-date year, not the copy mechanism (PC-11, above).

Top wisdom highlights (durable):
1. Integration of agents with ALL existing organisational systems and data sources — not agent capability alone —
   is the fundamental prerequisite for a self-driving company (pg1 L91). The binding constraint is plumbing, not
   model IQ. Most durable, transferable insight of the wave.
2. True self-driving operation is defined by LOOPS: agents with human-set goals, access to the needed systems,
   and verifiable criteria to evaluate progress — not isolated task execution (pg1 L101). A go/no-go definition,
   not a slogan.
3. Start agentic adoption with ENGINEERING teams because software development has clear, verifiable structure
   more amenable to AI automation than intangible fields like marketing (pg1 L111). A sequencing heuristic.
4. (pg2) Amazon's argument that serving ads to shopping agents breaks the advertising contract because
   advertisers only pay for HUMAN impressions (L91) — a durable structural insight into the economics of agentic
   commerce, not just news.
5. (pg2) The reported Meta strategic divide: research-first frontier-model development (Wang) vs
   product-integration-first (Bosworth/Cox) (L111) — a durable org-strategy tension that recurs across AI labs.
   Zuckerberg's 2012 "finite number of social mechanics to invent" thesis (L121) as the acquisition rationale is
   a durable mental model, correctly held at tier 3 / single-source / speculative.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item (Refinement #1) — VERIFIED clean on BOTH pages (now further post-fix positive
   controls). No further code owed; applied fix stands (ingest.py `_build_ledger_bullet`,
   `claim_date = episode_date`, fall back to ingest_date only when episode_date is absent). Flag BOTH pages clean
   to the batch re-date fixer so correct dates are not clobbered — BUT note page 1 is a trap for a naive re-dater:
   its claim-dates already equal the episode-date, yet the episode-date itself is wrong (2026 vs true 2025), so a
   mechanical "copy episode-date" pass would leave the year error intact. Page 1 belongs in the PC-11
   year-reconcile queue, NOT the plain re-date backlog.
2. PC-11 (W-YEARINFER) — SCOPE EXTENSION + immediate-recurrence support (not a re-graduation; already proposed
   last wave). Extend the proposed verify-pass guard so it ALSO cross-checks the EPISODE-DATE year against any
   absolute year appearing in the page's evidence windows (e.g. evidence "early January to late June 2025" under
   an episode-date of 2026-07-23 → flag whole-page off-by-one and anchor to the evidence-supported year). This
   catches the upstream episode-date mis-extraction on page 1, which the current claim-body-only formulation of
   PC-11 would miss. Recurrence on the wave IMMEDIATELY after minting = strong argument for team-lead to apply.
3. ASR entity/name normalisation (PC-2 ASR-entity arm, not a graduation): page-2 prose entities 'Maltbook',
   'Matchlet', 'Open Claw'/'Claude Cloderburg' and page-1 verbatim 'Replet'/'SAS'/'figureure' are all unlinked →
   confined to prose. 'Open Claw' now recurs across waves #105–#106; if a VERIFIED target surfaces it graduates to
   a dictionary seed, but the reconstruction is still uncertain → flag `[sic]`/verify, no blind seed. The clean
   'Replit' bodies confirm PC-2's structured-field normalisation is working; only verbatim noise remains
   (W-VERBSIC accepts that).
4. wikilink relevance (PC-1, reinforcement): the Vera Rubin→[[NVIDIA H200]] false edge argues for a
   generation/vintage awareness check at link-emission — when a claim names a specific next-gen/named product
   ("Vera Rubin"), do NOT resolve it to a previous-generation sibling; prefer the already-present abstract page
   ([[AI Compute Infrastructure]]) or no link over a wrong-vintage one. Single page → reinforces PC-1's
   "resolvable ≠ correct" remit; watch for a 2nd wrong-generation instance before proposing a code change.

STRUCTURAL OUTCOME: two-page wave, verdicts GOOD + ACCEPTABLE; highest severity MEDIUM on each → HIGH-on-2+
rule does NOT fire → no new PROPOSED CHANGES block. Net material movement: **PC-11 (W-YEARINFER) RECURS on the
wave immediately after its wave-#105 minting** (page 1's whole-page 2026-vs-2025 off-by-one), with a proposed
SCOPE EXTENSION to episode-date-vs-evidence-window checking (upstream of the original claim-body case) →
strengthens the application case. The Vera Rubin→H200 false edge is a fresh PC-1 wrong-generation sub-flavour (single
page → reinforce). ASR entity garble recurs across both pages (Replet/Maltbook/Matchlet/Open Claw/Claude
Cloderburg) but all UNLINKED and MEDIUM/LOW → folds into PC-2; 'Open Claw' is a recurring-but-unverified seed
candidate held at `[sic]`/verify. claim-date is a clean positive control on BOTH pages; both excluded from the
plain re-date backlog, but page 1 is routed to the PC-11 year-reconcile queue (correct-copy of a wrong
episode-date, not a copy-mechanism fault).

### 2026-08-24 — Review wave #107 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-state-of-ai-q2-2026.md` — verdict GOOD.

Defects by kind:
- claim-date — CLEAN POSITIVE CONTROL (LOW, absent-defect): episode-date:: 2026-03-31 present, every
  claim-date:: == 2026-03-31 (episode date, NOT the 2026-08-24 ingest date). Post-fix page, correctly
  episode-anchored. No embedded-year conflict in bodies → EXCLUDED from the plain re-date backlog AND not a
  PC-11 year-reconcile case (contrast wave #105/#106 page 1, whose claim-dates correctly copied a WRONG
  episode-year). No `_build_ledger_bullet` fix owed; applied Refinement#1 stands.
- asr-artefact-entity-name (MEDIUM — PC-2 ASR-entity arm): 'Open Claw' (L41) is the ONLY assertion with no
  [[wikilink]], yet carries the page's strongest claim (most-starred OSS project ever → recruited into OpenAI).
  'Open Claw' now recurs a THIRD consecutive wave (#105 'Open Claw'/'Claw Hub' → #106 'Open Claw'/'Claude
  Cloderburg'→'Claude Code' → #107 'Open Claw' L41) → seed-candidate case strengthens, but target still an
  uncertain reconstruction → `[sic]`/verify against source audio, NO blind dictionary seed (same discipline as
  #105/#106). NEW angle: here the garble sits on the single UNLINKED assertion carrying the strongest claim —
  a link-coverage/anchor gap, not just prose noise → argues the strongest-claim-must-anchor check (below).
- unsourced-metric-provenance (LOW — PC-3 single-source host-relay cap): strong quant claims (Ramp 70/25/5
  enterprise-buyer split; 'one study' HR 19%→61%; a GEO market figure) are collapsed under 'AI Daily Brief host'
  though the quotes name distinct upstream primaries. Single-relay stats → conf 0.85-0.9 slightly generous;
  reinforces PC-3's authority cap and the provenance-capture proposal (below).
- tier-confidence-sane (LOW, positive): tiers 1-2 / conf 0.80-0.95 internally consistent and well-calibrated —
  primary-authority Anthropic Research claim (L51) and speculative Gartner/GEO projections correctly rated;
  tier-2 interpretive 'second moment' framing properly demoted with a single-source authority tag.

Top wisdom (durable):
1. Anthropic Research: AI is capable of ~80% of legal tasks but only ~15% show observed adoption — the largest
   capability-vs-adoption gap cited (L51). Primary-sourced structural insight, not ephemeral news.
2. The 'AI second moment' framing: transition from viable chatbot assistants to workable agentic systems as the
   defining shift of Q1 2026 (L91). Durable interpretive thesis with lasting explanatory value.
3. Generative Engine Optimization (GEO) as an emerging category: <$1B (2025) → ~$34B (2034 proj., L71) — durable
   nascent-market signal, more lasting than the snapshot capex/revenue figures.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item (Refinement #1) — clean positive control again. No code owed; flag this page to the
   batch re-date fixer as SKIP (already episode-anchored, no year-reconcile needed — a plain-skip, unlike the
   #105/#106 PC-11 traps).
2. PC-2 ASR-entity arm (reinforcement, not graduation): 'Open Claw' recurs a 3rd straight wave (#105/#106/#107).
   Hold at `[sic]`/verify; mint a dictionary seed only when a VERIFIED target surfaces. NEW sub-angle worth a
   watch: strongest-claim-must-anchor — when the single highest-confidence/strongest assertion on a page is the
   ONLY one with no [[wikilink]] AND its head entity looks ASR-mangled, flag for entity resolution before
   promotion (the claim's weight rests on an unanchored, unverifiable name). One page → watch, folds into PC-1/PC-2.
3. PC-3 provenance arm (reinforcement + ledger-field semantics): when an evidence quote names a distinct upstream
   primary (Ramp; a specific 'one study'), extract it into its own source:: / secondary-source:: provenance
   rather than collapsing under the relaying host ('AI Daily Brief host'). Recurring provenance theme (PC-3);
   improves re-verifiability and would justify the higher single-relay confidences.

STRUCTURAL OUTCOME: single-page wave, verdict GOOD; highest severity MEDIUM → HIGH-on-2+-distinct-pages rule
does NOT fire → no new PROPOSED CHANGES block, no new PC class. Net movement: **PC-2 'Open Claw' seed candidate
recurs a 3rd consecutive wave** (#105→#106→#107), still unverified → held at `[sic]`/verify, no blind seed; a NEW
strongest-claim-must-anchor watch opened (strongest claim rested on the sole unlinked, ASR-mangled entity).
claim-date is a clean positive control — plain-SKIP for the re-date fixer (not a PC-11 year-reconcile case).
Provenance under-capture folds into PC-3.

### 2026-08-24 — Review wave #108 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-state-of-enterprise-ai-the-state-of-enterprise-ai.md` — verdict GOOD.

Defects by kind (all LOW):
- claim-date — CLEAN POSITIVE CONTROL (LOW, absent-defect): episode-date:: 2025-12-11 present, every
  claim-date:: == 2025-12-11 (episode date, NOT the 2026-08-24 ingest date). Correctly episode-anchored,
  no embedded-year conflict → EXCLUDED from the plain re-date backlog AND not a PC-11 year-reconcile case
  (contrast #105/#106/#107-page-1). No `_build_ledger_bullet` fix owed; applied Refinement#1 stands.
  Reviewer explicitly flags this page as SKIP so the batch fixer does not overwrite good dates.
- asr-artefact-CONTAINED (LOW, positive control — inverse of PC-2): raw ASR errors ('SAS market', 'Menllo',
  'chatbt', 'open AAI', '1.4 4 trillion') appear ONLY inside verbatim evidence:: quotes; the assertion prose
  is cleaned/corrected ('SaaS market', 'Menlo Ventures', 'ChatGPT', 'OpenAI', '$1.4 trillion'). This is the
  DESIRED pattern — no ASR garble leaked into entity names or claim bodies. A clean positive counter-example
  to the PC-2 ASR-entity arm ('Open Claw' etc.): confirms containment is achievable, so leaked-into-name cases
  are extraction failures, not unavoidable ASR noise.
- title-duplication (LOW — NEW kind): both H1 (L3) and title:: (L5) carry the doubled string 'The State of
  Enterprise AI The State of Enterprise AI' — a source/title-parsing artefact (title concatenated with itself).
  De-dup to a single 'AI Daily Brief — The State of Enterprise AI'. Single page → WATCH (candidate PC-12 if a
  2nd page shows the same self-doubled-title shape; likely a feed/parse concat in the title-extraction step).
- orphan-assertions (LOW — link-coverage, folds into PC-1): 2 assertions carry no [[wikilink]] (L71 startups
  captured ~$2 per $1 vs incumbents / 63% app-layer; L101 OpenAI 'frontier workers' 17x coding messages) →
  disconnected from the graph. Refinement: anchor to [[Enterprise AI Spend]] / [[Enterprise AI Adoption]].
- wikilink-casing (LOW, pre-existing/out-of-scope): [[Enterprise Ai]] (L121) resolves to real file
  'Enterprise Ai.md' — link VALID; odd casing is the graph's only variant (no canonical 'Enterprise AI.md').
  Graph-wide inconsistency, NOT introduced by this page → out of scope for this single review.

Top wisdom (durable):
1. Buy-vs-build inflection (L81): 76% of enterprise AI use cases are now PURCHASED from vendors rather than
   built internally, reversing the 2024 build-in-house trend — a structural inflection that outlasts the news
   cycle (vs ephemeral 900% seats / 320x tokens / $37B spend snapshots).
2. Agentic reality-check (L91): only 16% of enterprise AI deployments are TRUE agentic systems (39% fixed-
   sequence workflows, 8% multi-agent) — a sober, durable counter to agentic hype.
3. Total-systems-change thesis (L121, tier 2): AI has a materially larger TAM than SaaS because it remakes
   work rather than replacing software — the most conceptually load-bearing claim on the page.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item (Refinement #1) — clean positive control again. No code owed; flag this page to
   the batch re-date fixer as plain-SKIP (already episode-anchored, no year-reconcile — not a PC-11 trap).
2. NEW title-duplication WATCH (candidate PC-12): add a de-dup guard in the title-extraction path — if the
   parsed title equals its own first-half repeated (self-concat), collapse to one copy before writing H1 +
   title::. Single page → hold as a watch; graduate to a PROPOSED CHANGES block only if a 2nd distinct page
   shows the self-doubled-title shape (2+-distinct-page rule). Fix belongs in the title parser, not
   `_build_ledger_bullet`.
3. PC-2 reinforcement via a POSITIVE control: this page proves ASR-garble containment works (errors quarantined
   in evidence:: quotes, prose cleaned). Strengthens the standing position that PC-2 leaked-into-entity-name
   cases ('Open Claw' etc.) are extraction cleanup gaps, not irreducible ASR noise — the clean-prose/verbatim-
   evidence split is the target contract and is achievable.
4. Link-coverage (PC-1): anchor the 2 orphan assertions (L71/L101) to [[Enterprise AI Spend]] /
   [[Enterprise AI Adoption]]. Casing normalisation ([[Enterprise Ai]]→canonical) noted as graph-wide, out of
   scope here.

STRUCTURAL OUTCOME: single-page wave, verdict GOOD; highest severity LOW → HIGH-on-2+-distinct-pages rule does
NOT fire → no new PROPOSED CHANGES block, no new PC class. Net movement: a NEW **title-duplication watch**
(candidate PC-12, self-concat title artefact, held for a 2nd-page confirmation) and a clean **ASR-containment
positive control** reinforcing PC-2's leaked-name-is-fixable stance. claim-date is a clean positive control —
plain-SKIP for the re-date fixer (not a PC-11 case). Orphan assertions fold into PC-1 link-coverage.

### 2026-08-24 — Review wave #109 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-time-savings-era-of-ai-is-over.md` — verdict GOOD.

Defects by kind (all LOW):
- claim-date — CLEAN POSITIVE CONTROL (LOW, absent-defect): episode-date:: 2026-02-14 present, every
  claim-date:: == 2026-02-14 (episode date, NOT the 2026-08-24 ingest date). Correctly episode-anchored,
  no embedded-year conflict → EXCLUDED from the plain re-date backlog, not a PC-11 year-reconcile case.
  Refinement #1 VERIFIED again; no `_build_ledger_bullet` fix owed. Reviewer flags page as plain-SKIP.
- wikilink-casing (LOW, PC-8/W-CANON casing arm — RECURS): [[National Ai Strategy]] carries 'Ai' rather
  than 'AI'. Link RESOLVES (matching-cased file exists); stylistically inconsistent with sibling AI-* pages
  ([[Agentic AI]], [[AI ROI]]). Same 'Ai'-vs-'AI' shape as wave #108's [[Enterprise Ai]] → 2nd distinct page
  with this signature. Graph-wide slug issue, NOT this page's fault, cosmetic → reinforces PC-8/W-CANON,
  does NOT graduate to a code change (remit is graph-wide slug normalisation, not an ingest.py fix).
- wikilinks (LOW, POSITIVE, PC-1 clean): all 6 distinct [[wikilinks]] resolve to existing page files
  ([[Claude]], [[Agentic AI]], [[Vibe Coding]], [[AI ROI]], [[AI Adoption Barriers]], [[National Ai Strategy]]).
  No dangling links.
- dedup-markers (LOW, POSITIVE): all 15 assertions carry a distinct assertion-fp. Complete.
- tier-confidence (LOW, POSITIVE): tiering sane and internally consistent — T1 survey facts @0.95,
  T2 host industry-analysis @0.85 (durable), T3 host predictions @0.75/@0.65 (speculative). Volatility
  fields (snapshot/durable/speculative) align with tier.
- assertion-quality (LOW, POSITIVE — inverse of PC-2): assertions specific, quantified, each backed by a
  verbatim evidence:: quote naming a primary source (AI DB Intel Jan 2026 usage pulse survey, n=583). No
  ASR-mangled entity names, no transcript hype leaked into assertion text. Host-attributed T2/T3 claims are
  correct provenance (single-source opinion) and appropriately tiered down.

Top wisdom (durable):
1. "Time-savings era is over" thesis (T2): increased output (38%) and new capabilities (22%) now outrank
   time savings (20%) as AI's primary benefit — changes how orgs should MEASURE AI ROI. Page thesis, most
   reusable insight (vs the perishable raw survey percentages).
2. "Value premium" lens (T1→durable): 71% increased AI usage MoM while 83% reported increased value derived —
   a 12-point gap suggesting users are getting better at leveraging AI, not just doing more. A transferable
   analytical frame rather than a one-off stat.
3. Structural insight (T2): 49.5% of coders sit outside engineering/IT (incl. 34% of execs) — non-engineers
   writing software to solve their own work problems is redrawing job roles / org charts. Durable hiring and
   org-design implications beyond this survey snapshot.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item (Refinement #1) — clean positive control again. No code owed; flag page to the
   batch re-date fixer as plain-SKIP (already episode-anchored, no year-reconcile — not a PC-11 trap).
2. PC-8/W-CANON reinforcement (AI-casing arm): [[National Ai Strategy]]→[[National AI Strategy]] is the 2nd
   distinct page (after #108 [[Enterprise Ai]]) showing the 'Ai'-slug shape. Both resolve, both cosmetic,
   both graph-wide not page-fault. Remedy is a graph-wide slug/casing normalisation pass ('Ai'→'AI' on the
   AI-* entity family), NOT an ingest.py change → stays a W-CANON normalisation candidate, no code change.
3. NEW ledger-field-semantics WATCH (survey-instance tagging): the T1 snapshot percentages are the most
   perishable content — a future edition of the same survey should SUPERSEDE, not duplicate, them. Reviewer
   suggests tagging survey-derived snapshot assertions as survey-instance data (e.g. a survey-instance:: /
   supersedes-key:: field keyed on survey-name+edition) so re-ingests of a later wave collapse onto the prior
   instance rather than accreting parallel rows. Single page → WATCH; graduate to a PROPOSED CHANGES block
   only if a 2nd page shows the same duplicate-survey-snapshot risk. Semantics live in the ledger schema /
   dedup key, not `_build_ledger_bullet`.

STRUCTURAL OUTCOME: single-page wave, verdict GOOD; highest severity LOW → HIGH-on-2+-distinct-pages rule does
NOT fire → no new PROPOSED CHANGES block, no new PC class. Net movement: **PC-8/W-CANON AI-casing arm now on 2
distinct pages** (#108 [[Enterprise Ai]], #109 [[National Ai Strategy]]) — still cosmetic/graph-wide, held as a
slug-normalisation candidate (not an ingest fix); a NEW **survey-instance-tagging watch** opened (ledger-field
semantics, held for a 2nd-page confirmation). claim-date is a clean positive control — plain-SKIP for the
re-date fixer (Refinement #1 verified, not a PC-11 case).

### 2026-08-24 — Review wave #110 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-ultimate-ai-catch-up-guide.md` — verdict ACCEPTABLE.

Defects by kind:
- asr-artefact-entity-name (MEDIUM, PC-2 product-name arm — RECURS): 'Baseplate 44' (L61/L68) is an ASR
  mangling of 'Base44', the real vibe-coding platform (acquired by Wix, 2025). The corrupted name is baked
  into BOTH the assertion text AND the verbatim evidence:: field, so the named entity is wrong on the
  graph-facing surface, not just quarantined in provenance — exactly PC-2's leaked-into-entity-name failure
  (contrast wave #108's clean ASR-containment positive control). Sibling products on the same claim (Lovable,
  Replit) are correct; only this one corrupted. High-confidence dictionary add: Baseplate 44 → Base44 (Wix,
  vibe-coding). Fold into PC-2. NB the refinement explicitly asks for a known-product-name normalisation
  dictionary — this is PC-2's product-name arm (seeded #12/#13 Pomelli/Antigravity, LMArena wave), reinforced.
- unattributed-statistic (LOW, PC-3 secondary-relay arm — RECURS): the 2021→2025 hallucination trend
  (21.8% → ~0.7%, 96% reduction, L31) is tagged source-authority:: secondary but carries NO citation to the
  originating study/index (AI-index-style source). Host is relaying a third-party figure at tier 1 / conf 0.9
  with no primary attribution → not independently checkable. Same shape as PC-3's #12 secondary-relay
  overweight (Edelman/Pew/Gallup at tier1/0.95); folds into PC-3. Remedy: require a primary-source pointer
  (or a down-confidence) whenever source-authority:: == secondary and no citation:: is present.
- claim-date-vs-underlying-data (LOW, POSITIVE CONTROL + minor residual): every claim-date:: == episode-date::
  2026-04-01 (≠ ingest-date 2026-08-24); episode-date:: present. The known ledger-wide claim-date defect does
  NOT manifest — Refinement #1 holds; skip in any re-date pass. Minor residual (NOT a re-date action): several
  claims cite OLDER data windows (the February usage-pulse survey, the Feb→Mar podcast-growth figure, the
  2021→2025 hallucination trend) that a strict data-window anchoring would date earlier than the episode date;
  snapshot volatility tags partly mitigate. Feeds the wave-#109 survey-instance / data-window WATCH (below),
  not a PC-11 year-reconcile case.

Top wisdom (durable):
1. The "more-output trap" (L101): AI makes volume trivially cheap, so human JUDGMENT becomes the scarce,
   load-bearing work and the critical bottleneck — a durable organisational insight, not ephemeral news.
2. Structural sycophancy (L71): AI systems tend to optimise for pleasing/agreeing with the user rather than
   challenging flawed assumptions — a durable usage-design caution.
3. Models now reason OVER image generation (L81/L91), rewriting/expanding prompts in the background — a durable
   capability shift, versus the perishable survey snapshots (97% daily use, 50% podcast growth, ~3.5 models/user).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 VERIFIED again (clean positive control); remains closed for
   post-fix pages. One-line ingest fix unchanged (for the record): in ingest.py `_build_ledger_bullet`, set
   `claim_date = episode_date` (fall back to ingest_date only when episode_date is absent). No new backlog.
2. PC-2 reinforced (product-name arm): Baseplate 44 → Base44. Confirms the refinement's ask — the entity-name
   normalisation dictionary should carry a KNOWN-PRODUCT-NAME section (Base44, Lovable, Replit, Pomelli,
   Antigravity, LMArena…) so ASR corruptions of product names are caught in the verify pass and never leaked
   into assertion text OR evidence:: on the graph-facing surface. No new PROPOSED CHANGES block (single page,
   MEDIUM not HIGH) — folds into the existing PC-2 entity-name-normalisation mechanism.
3. PC-3 reinforced (secondary-relay arm): add a guard — when source-authority:: == secondary AND no citation::
   is present, either require a primary-source pointer or cap confidence, rather than passing an unattributed
   third-party figure at tier1/0.9. Same class as #12; no new mechanism.
4. survey-instance / data-window WATCH (wave-#109, reinforced — 2nd supporting page): this page's residual —
   claims resting on Feb/Mar data windows uniformly stamped to the 2026-04-01 episode date — is the same
   perishable-snapshot-provenance risk the #109 watch registered. Still a ledger-field-semantics question
   (a survey-instance:: / data-window:: field so later editions SUPERSEDE rather than duplicate), NOT a
   `_build_ledger_bullet` fix. Held as a WATCH; does not yet graduate to a PROPOSED CHANGES block.

STRUCTURAL OUTCOME: single-page wave, verdict ACCEPTABLE; highest severity MEDIUM → HIGH-on-2+-distinct-pages
rule does NOT fire → no new PROPOSED CHANGES block, no new PC class. Net movement: PC-2 product-name arm
reinforced (Baseplate 44→Base44, leaked into name+evidence — the refinement's dictionary ask lands here);
PC-3 secondary-relay arm reinforced (unattributed hallucination-trend stat); the #109 survey-instance /
data-window watch gains a 2nd supporting page (still held, not graduated). claim-date is a clean positive
control — Refinement #1 verified, plain-SKIP for the re-date fixer, not a PC-11 case.

### 2026-08-24 — Review wave #111 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-way-we-use-ai-is-changing.md` — verdict GOOD (issues: none).

Defects by kind (all refinement-level; page verdict GOOD):
- implausible-figure (MEDIUM, PC-3 numeric-implausibility arm — RECURS): assertion 5's Anthropic
  '$3M → $47B' claim is not credible as written and rides an unflagged tier/confidence. Same shape as
  the folded #7 445%-YoY-@0.98 outlier now under PC-3. Remedy per the refinement: reframe as a
  seat-vs-usage rhetorical contrast, OR down-tier/down-confidence the figure — do not carry a
  non-credible number at face confidence. Folds into PC-3; no new mechanism.
- wrong-sense-wikilink (LOW, PC-1 topic-mismatch arm — RECURS): assertion 9 (AI-advantage-gap claim)
  carries [[Bitcoin Value Proposition]], a resolvable but topic-unrelated page → a false edge. Multi-token
  and specific, so not the generic/acronym sub-class, but the same resolvable-≠-correct failure PC-1 targets
  (topic-magnet flavour). Remedy: drop the link (prefer NO link over a wrong-sense one). Folds into PC-1.
- asr-artefact-in-evidence (LOW, PC-2 evidence-only / quoted arm — NO structured-field leak): evidence
  quotes carry ASR mishearings 'Cherney'→'Cherny' (Boris Cherny, Claude Code creator) and 'Open AI'→'OpenAI'.
  These sit in verbatim evidence:: only, NOT in assertion body or source:: → cosmetic, not a graph-identity
  risk (contrast the PC-2 structured-field leaks of waves #3/#110). Remedy: normalise in the verify pass or
  [sic]-annotate as verbatim. Folds into PC-2's evidence-only arm; no structured-field correction owed.
- episode-date-stamp-suspect (MEDIUM, NEW flavour — feeds PC-11 date-integrity family): the header
  episode-date:: 2026-06-09 is contradicted by in-body 'October of this year' phrasing for what reads as an
  Oct-2025 deal. Distinct from PC-11's embedded-year-vs-episode-date reconcile: here the EPISODE-DATE STAMP
  ITSELF is the suspect party, and because Refinement #1 makes claim-date:: == episode-date::, a wrong stamp
  silently mis-dates EVERY assertion on the page. This is the first case where the episode-date (not an
  embedded claim year) is the thing to verify. Single page → held as a WATCH under the PC-11 date-integrity
  umbrella; graduates only if a 2nd page shows a demonstrably-wrong episode-date stamp. Remedy: verify
  episode-date against the source feed at ingest (or flag stamp↔body year conflicts) before it propagates
  into claim-date.

Top wisdom (durable):
1. Boris Cherny (Claude Code creator) has moved up an abstraction level — no longer hand-prompting the AI but
   writing autonomous 'loops' that prompt it ('My job is to write loops'). Durable signal on how expert
   AI-assisted engineering is evolving; pairs with wave #1's 'arena design' shift in the human role.
2. The 'token subsidy era' → 'token scarcity era' transition — business models moving to charging for actual
   token consumption. Durable structural monetisation thesis; corroborates wave #2's structural-compute-shortage
   causal mechanism for subsidised-flat → market-based pricing.
3. The widening 'AI advantage gap' — power users on agentic loops compound value while casual chat users see
   only linear gains. Durable adoption-inequality insight, cleanly separable from the ephemeral deal/poll news
   it sat beside (and from the mis-linked [[Bitcoin Value Proposition]]).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 remains closed for post-fix pages; the one-line ingest fix is
   already applied (`ingest.py` `_build_ledger_bullet`: `claim-date:: {episode_date or today}`). BUT this wave
   surfaces the fix's dependency risk: claim-date is now only as correct as episode-date::. See proposal 4.
2. PC-3 reinforced (numeric-implausibility arm): the $47B figure is the same overweight-implausible-number
   class as #7. No new block — apply PC-3's down-confidence/flag rule to numeric outliers that fail a
   credibility sniff, not just to secondary-relay stats.
3. PC-1 + PC-2 reinforced (topic-magnet wikilink; evidence-only ASR) — both fold into already-graduated
   mechanisms, no new action.
4. NEW episode-date-integrity WATCH (PC-11 date-integrity family): because Refinement #1 ties claim-date to
   episode-date, a wrong episode-date stamp now mis-dates the whole page invisibly. Propose the ingest/verify
   pass gain an episode-date sanity check — cross-check the stamp against the source feed's publish date and/or
   flag when an in-body absolute date (e.g. 'October of this year') implies a different month/year than the
   stamp. Held as a WATCH (single page); graduates to a PROPOSED CHANGES block on a 2nd page with a
   demonstrably-wrong stamp. Semantics: this guards the episode-date INPUT, upstream of `_build_ledger_bullet`
   (which is already correct given a correct episode-date).

STRUCTURAL OUTCOME: single-page wave, verdict GOOD; highest severity MEDIUM → HIGH-on-2+-distinct-pages rule
does NOT fire → no new PROPOSED CHANGES block, no new PC class. Net movement: PC-3 (numeric-implausibility arm,
$47B) and PC-1 (topic-magnet [[Bitcoin Value Proposition]]) reinforced; PC-2 evidence-only ASR arm reinforced
(Cherny/OpenAI, no structured leak); a NEW episode-date-integrity watch opened under the PC-11 date family
(claim-date now inherits episode-date correctness — the standing item's fix is verified but its input is not
yet validated). claim-date defect itself did NOT manifest (Refinement #1 holds) — but the episode-date stamp
that feeds it is now the thing to watch.

### 2026-08-24 — Review wave #112 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-week-ai-grew-up.md` — verdict GOOD.

Defects by kind (page verdict GOOD; one refinement-level defect):
- assertion-wording / no-op paraphrase (MEDIUM, PC-5 claim↔evidence divergence — RECURS, NEW flavour):
  the Nadella assertion (L41) mangles the paraphrase into a self-cancelling tautology — 'per-user business
  models... will transition to per-user and usage-based models' (a per-user model 'transitioning' to a
  per-user model is a no-op). The evidence:: quote preserves the correct meaning ('will become a per user
  AND usage business' → usage-based billing ADDED on top of per-user). This is exactly PC-5's target — the
  claim body diverges from its own evidence — but a NEW flavour: not a wrong number (wave #22) or a
  re-attribution (wave #33), but a MEANING-MANGLING paraphrase that collapses to a tautology while the
  evidence is intact. Remedy per PC-5: rewrite the claim to MIRROR the evidence ('any per-user software
  business becomes a per-user AND usage business'); no new number/entity, just fix the drift. Folds into
  PC-5; no new mechanism.
- claim-date — NON-DEFECT / POSITIVE CONTROL: the known claim-date==ingest-date defect does NOT manifest.
  episode-date:: 2026-05-02 present and EVERY claim-date:: == 2026-05-02 (≠ ingest-date 2026-08-24). A clean
  post-fix control page — Refinement #1 continues to hold. Per the refinement suggestion, this page is a good
  reference example of correct dating for any batch still exhibiting the ingest-date defect.
- wikilink-resolution — CLEAN: all 4 [[wikilinks]] resolve to existing pages (AI Inference Cost Management,
  Usage-Based Pricing, AI Economic Impact, AI Licensing Regime). No PC-1/PC-6/PC-8 touch.
- dedup / tier-confidence / hype-separation — CLEAN: 14 assertions carry unique assertion-fp markers (no
  collisions on spot-check); tier/confidence/volatility gradient sane (t1 0.85-0.95, t2 0.8-0.85, t3
  0.55-0.6) with honest source-authority; transcript hype ('absolutely spanked analyst estimates') correctly
  quarantined inside evidence:: quotes, assertion bodies clean/quantified; the $825M→$825B normalisation
  (L98) handled with a transparent inline editorial note, not silently.
- unverifiable-frontier-content (LOW, W-COINED family — informational): forward-dated episode (2026-05-02)
  references beyond-cutoff entities — GPT-5.1, Anthropic $900B valuation, model 'Mythos', Claude Cowork.
  'Mythos' RECURS (waves ~L1362 / #3-era L3508 W-COINED bucket). Out of scope for ingest fidelity (the job is
  faithful capture, not fact-checking the future) and names show no ASR garble → NOT a defect. Flagged only
  so a downstream re-verify pass knows these cannot be externally corroborated.

Top wisdom (durable):
1. GitHub is moving Copilot to usage-based billing because the flat premium-request model is no longer
   sustainable under escalating inference cost — a durable, primary-sourced (Mario Rodriguez, GitHub CPO)
   signal on the economics of agentic coding.
2. Nadella: ANY per-user software business (productivity, coding, security) becomes a per-user AND usage
   business — a durable structural read on how AI reshapes SaaS pricing, primary-sourced. (This is the claim
   the L41 paraphrase mangled; the wisdom is intact in the evidence.)
3. RL quirks in a base model multiply into every model built on top of it, with direct consequences for
   alignment/safety training — durable tier-3 technical wisdom, far more lasting than the week's market figures.

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 remains closed/verified; the one-line ingest fix
   (`ingest.py` `_build_ledger_bullet`: `claim-date:: {episode_date or today}`) is already applied. This
   wave adds a clean POSITIVE control (all claim-dates == episode-date). No fix owed. Nominate this page as
   the reference exemplar of correct dating for the re-date-fixer's regression set.
2. PC-5 reinforced + scope-widened (NEW flavour): extend PC-5's claim↔evidence check beyond
   number/metric/attribution divergence to catch MEANING-MANGLING paraphrases — where the claim body is
   internally incoherent / tautological / self-cancelling relative to its evidence (the L41 'per-user →
   per-user' no-op). Same fix path (rewrite claim to mirror evidence); the extraction-prompt line already
   says 'the claim must state the SAME ... that its evidence block supports' — add: '...and must be a
   coherent, non-tautological paraphrase; if the claim collapses to a no-op or contradicts the evidence's
   plain sense, rewrite it to the evidence's meaning.' Folds into PC-5; no new mechanism, no new block.
3. source-authority 'as-reported-in-episode' note (ledger-field-semantics suggestion, NOT a code change):
   for forward-dated / beyond-cutoff frontier claims (GPT-5.1, $900B, 'Mythos', Claude Cowork), consider a
   source-authority:: annotation marking them as-reported-in-episode / not-independently-corroborable, so a
   re-verify pass distinguishes 'faithful capture of an uncorroborable future claim' from 'verified fact'.
   Overlaps W-COINED (novel/coined proper nouns) and W-PREDFACT (forward-looking framed as snapshot); held as
   a refinement suggestion under those watches, not graduated.

STRUCTURAL OUTCOME: single-page wave, verdict GOOD; highest severity MEDIUM → HIGH-on-2+-distinct-pages rule
does NOT fire → no new PROPOSED CHANGES block, no new PC/W class. Net movement: PC-5 reinforced and
scope-widened with a NEW no-op/meaning-mangling-paraphrase flavour (L41 Nadella); W-COINED family touched
('Mythos' recurs, informational only). claim-date is a clean POSITIVE control — Refinement #1 verified again,
page nominated as the correct-dating exemplar; no re-date action, plain-SKIP for the fixer.

### 2026-08-24 — Review wave #113 (synthesiser)
Pages reviewed (1): `podcast-evidence___the-week-the-ai-story-shifted.md` — verdict ACCEPTABLE.

Defects by kind (page verdict ACCEPTABLE; highest severity MEDIUM):
- assertion-quality-conflation (MEDIUM, PC-5 — NEW flavour: over-synthesis / two-facts-fused): assertion 1
  (fp e88ce804c778c0ce) synthesises the evidence as 'Anthropic and OpenAI launched enterprise AI joint
  ventures', but the underlying quote ('$10bn starting valuation, $4bn investment for OpenAI, $1.5bn from
  Anthropic') far more plausibly describes TWO SEPARATE deals/investments fused by the extractor into one
  implausible JV between direct competitors — carried at tier:1 / confidence:0.95. Distinct from PC-5's prior
  flavours (wave #22 wrong-number, wave #33 re-attribution, wave #112 no-op/tautology paraphrase): here the
  claim is a coherent sentence but INVENTS a relationship (a joint venture) that the evidence does not assert
  — the extractor merged two independent financial facts into a single synthesised entity. Remedy per PC-5:
  split into two claims mirroring the evidence (OpenAI raise vs Anthropic investment as separate lines) OR, if
  a genuine JV is unconfirmed, drop the JV framing and state only what the numbers support; downgrade
  confidence from 0.95 until the source is re-checked. Folds into PC-5 (scope widened to over-synthesis /
  fact-fusion); no new mechanism, no new block.
- asr-artefact-entity-name (LOW, PC-2 — evidence/body-prose arm, NO structured-field or link leak): '11 Labs'
  in assertion-4 body prose (entity wikilink correctly normalises to [[ElevenLabs]]); product-name mangles
  'GPT Real-Time 2 / Translate / Whisper' (likely the actual 'gpt-realtime' family); unverified proper nouns
  'Philip Corry' (OpenAI Codex) and 'Terafab'. Entity wikilinks are clean; artefacts confined to quoted prose
  → PC-2 evidence-only arm, does NOT trip the structured-field graduation. Dictionary adds: '11 Labs'→
  ElevenLabs; verify 'Philip Corry' / 'Terafab' / 'gpt-realtime' spellings against primary source before any
  future entity promotion.
- tier-confidence / provenance (LOW→MEDIUM, PC-3 — single-secondary dollar-figure over-cap): the
  financial-snapshot claims ($10bn JV valuation, $462bn Google Cloud backlog, $500m ElevenLabs revenue,
  Coinbase -40% revenue) are single-secondary-source dollar figures carried up to 0.95. Correctly tagged
  volatility:snapshot, but PC-3's provenance cap argues for a lower default confidence ceiling on
  single-secondary dollar figures. Reinforces PC-3 (no new mechanism).
- claim-date — NON-DEFECT / POSITIVE CONTROL: the known claim-date==ingest-date defect does NOT manifest.
  episode-date:: 2026-05-08 present and EVERY claim-date:: == 2026-05-08 (≠ ingest-date 2026-08-24). Clean
  post-fix control — Refinement #1 continues to hold. Re-datable; no remediation owed.
- wikilink-resolution — CLEAN: all 13 [[wikilinks]] resolve to existing pages (Anthropic, OpenAI API,
  Enterprise AI Deployment, Google Cloud, AI Infrastructure Investment, Semiconductor Manufacturing,
  ElevenLabs, Venture Capital, Coinbase, Autonomous Coding, AI Regulation, AI Governance, AI Labor Market
  Impact). No dangling links; no PC-1/PC-6/W-CASE touch.
- dedup / tier-confidence gradient — CLEAN: 13 assertions carry unique assertion-fp markers (complete dedup
  coverage); tier/confidence gradient sane and monotonic (t1 factual 0.85-0.95, t2 [Industry analysis]
  0.75-0.85, t3 [Emerging signal] 0.6), volatility (snapshot/durable/speculative) and source-authority
  (secondary/hedged) consistently applied.

Top wisdom (durable):
1. Corning holds >70% market share in the fibre-optic glass required for data-centre networking — a durable
   structural chokepoint in the AI-infrastructure supply chain (tier:1, durable).
2. OpenAI's /goal feature for Codex keeps an agent working toward a persistent objective across turns until
   achieved ('Ralph loop') — a durable agent-design pattern, not ephemeral news (tier:1, durable). [NB proper
   noun 'Philip Corry' attached to this is an unverified ASR spelling — wisdom is in the pattern, not the name.]
3. Elon Musk is pivoting his AI-race position from model development to infrastructure (folding xAI into
   SpaceX, partnering with Anthropic for compute) — a durable strategic read of the competitive landscape
   (tier:2, durable).

INPUT-ADJUSTMENT PROPOSALS:
1. claim-date standing item — Refinement #1 remains closed/verified; the one-line ingest fix
   (`ingest.py` `_build_ledger_bullet`: `claim-date:: {episode_date or today}`) is already applied. This wave
   adds another clean POSITIVE control (all claim-dates == episode-date 2026-05-08). No fix owed.
2. PC-5 reinforced + scope-widened (NEW over-synthesis flavour): extend PC-5's claim↔evidence check to catch
   FACT-FUSION — where the claim invents a relationship/entity (here a 'joint venture') by merging two
   independent evidence facts that individually support neither the fusion nor its confidence. Same fix path
   (split to mirror the evidence, or drop the invented relationship); tighten the extraction-prompt line to:
   '...the claim must not INVENT a relationship, entity, or joint action not asserted by the evidence; if the
   evidence lists two independent facts, emit two claims, do not fuse them into one.' Folds into PC-5; no new
   block.
3. PC-3 reinforced (ledger-field-semantics): apply a lower default confidence ceiling for single-secondary-
   source dollar figures (the $10bn JV / $462bn backlog / $500m revenue / -40% class). volatility:snapshot is
   already correctly set; PC-3's provenance cap should additionally bound confidence (e.g. cap at 0.85 absent
   a second corroborating source or a primary source-authority).

STRUCTURAL OUTCOME: single-page wave, verdict ACCEPTABLE; highest severity MEDIUM → HIGH-on-2+-distinct-pages
rule does NOT fire → no new PROPOSED CHANGES block, no new PC/W class. Net movement: PC-5 reinforced and
scope-widened with a NEW over-synthesis / two-facts-fused flavour (assertion 1 JV, fp e88ce804c778c0ce); PC-2
evidence-only ASR arm reinforced ('11 Labs', 'Philip Corry', 'Terafab', 'GPT Real-Time'); PC-3 single-
secondary dollar-figure provenance cap reinforced. claim-date is a clean POSITIVE control — Refinement #1
verified again; no re-date action, plain-SKIP for the fixer.

### 2026-08-24 — RUN PAUSED (team lead)
Supervised live run paused at 139/190 episodes (49 backlog remaining), 1,740 verified assertions
across 139 ledger pages + proposed concept pages. Committed to logseq repo (d230aaa76).
10 refinements applied and verified live (PC-1..PC-10 lineage + episode-date). Graph cleaned
(317 false edges removed). Cron remains PAUSED (`supervisorctl start podcast-cron` to resume the
weekly schedule; or re-run the driver to drain the remaining 49 backlog manually).
Deferred (not blocking): episode-date re-date of the ~pre-fix pages; curated-page dup-IRI
(Open Source AI / Open-Source AI); PC-9 full host-map + PC-10 verify-pass semantic check.
Provenance: volatility split ~ durable/snapshot/speculative lets promote.py favour durable wisdom.
