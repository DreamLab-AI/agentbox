# Plan — stablecoin-wrap-experiment

Tier: deep (5 researchers, up to 2 rounds, gate on draft and final with --strict).
Owner question (2026-09-23): how could we wrap USDT or USDC into the sidestr sidechain system as an
experiment? Deliver a cited research brief and an ADR proposal. Consider RGB and the Tether/RGB
partnership; use Loom and all search backends.

Starting point (do not re-research, cite): agentbox ADR-2102 (proposed: bridge-in via isolated
rgb-lib process, `bridge` consensus rule, burn-then-release, wrapped supply = reserve, USDT only
when live on mainnet and behind P21, no token labelled USDT until then) and its GPT-6 Astra
amendments; research pack docs/proposals/sovereign-settlement-research/ (BRIEF-fact-base.md
RGB/USDT section as of 2026-09-21; REVIEW-adversarial-gpt6-astra.md legal section).

## Key questions
1. Is USD₮ on RGB live (mainnet? date? which RGB line: v0.11.1 rgb-protocol vs v0.12 RGB-WG)?
   Is there any testnet/signet/regtest USDT-on-RGB, faucet or issuer test contract? UTEXO and
   Tether WDK modules status. rgb-lib: versions, networks supported (testnet4? signet?), licence.
2. Alternatives: USD₮ on Taproot Assets (Lightning Labs tapd), USDT on Liquid (federated
   sidechain, live), USDC on Bitcoin (any issuer-native route? Circle), and test-network
   availability of each.
3. Wrapping design and prior art: Liquid issued assets and peg federation, Rootstock, Stacks
   sBTC, wrapped-asset bridges; reserve attestation formats; how a wrapped representation
   handles issuer freeze/blacklist and redemption; burn-then-release; what a validator can
   verify about an RGB or Taproot Assets reserve.
4. Experiment feasibility on OUR stack: which route can run end to end on a test network in
   weeks, with our testnet4 node (Bitcoin Core v30.3, CLN), sidestr-rs crates, and a mock asset
   if no issuer test asset exists; what breaks with stock (non-BLAKE2b) parents.
5. Legal, terms and labelling: FCA regime timeline, UK AML/promotions, MiCA status of USDT vs
   USDC, CARF, issuer terms of service and trademark rules for wrapping or naming, what a
   testnet-only experiment may call its token.

## Researchers (Found via + Backends lines required; numbering ranges disjoint)
- A rgb-usdt            [1]-[99]     Q1
- B alt-routes          [100]-[199]  Q2
- C bridge-design       [200]-[299]  Q3
- D experiment-feasibility [300]-[399] Q4
- E legal-terms         [400]-[499]  Q5
Lead: Loom grounding (ontology classes for stablecoin, custody, wrapped asset) and estate facts.

## Acceptance criteria
- Every critical claim has ≥2 independent sources or is marked inferred/unresolved.
- Status facts (live/not live) carry a retrieval date.
- The brief ends with a recommended experiment route, its steps, what it proves and does not.
- ADR proposal amends ADR-2102 (does not contradict its gates) and passes the ledger check.

## Ledger
- Round 1: spawned A–E.
