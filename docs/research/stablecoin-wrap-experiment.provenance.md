# Provenance: a private USD unit for the owner's agents, wrapped through RGB into sidestr

- **Date:** 2026-09-23
- **Rounds:** one researcher round (five researchers, A to E) plus Loom grounding and a lead verification pass
- **Tier:** deep
- **Sources consulted:** the seven evidence files `stablecoin-wrap-experiment-research-*.md` (rgb-usdt, alt-routes, bridge-design, feasibility, legal-terms, loom, lead-verification)
- **Sources accepted:** 106 listed in the brief, every one cited
- **Sources rejected or held as leads:** snippet-only pages not opened by researchers (SideSwap testnet news, cirBTC, a Spark Circle page, tech-insider.org); CoinDesk and The Hacker News reports of the Liquid incident (named by the lead verification, not re-read by the writer)
- **Independent origins:** R030/R031 clean under `--strict` after compound same-domain citations were split one fact per sentence
- **Verification:** PASS WITH NOTES (Tether terms quote confirmed by direct grep because the verifier's extraction was partial)
- **Gate receipt:** docs/research/stablecoin-wrap-experiment-gates.json: 0 fail, 0 warn, strict yes
- **Retraction check:** not run; no load-bearing journal citation
- **Plan:** docs/research/.plans/stablecoin-wrap-experiment.md
- **Decision record:** docs/adr/ADR-2117-private-owner-usd-unit-bridged-through-rgb-into-sidestr.md (proposed; renumbered from 2113, which the host ledger holds)
- **Revision:** 2026-09-23, owner addendum applied: the asset is the owner's private USD unit of account, issued and held only inside his estate; legal section re-read for the closed, single-owner case; source [606] added (public relays and mirror of today's producer)
