# Adversarial review — Sovereign Settlement pack (PRD-024, ADR-2096–2103, DDD-022)

Reviewer: independent model family, read-only. Scope: docs/proposals/sovereign-settlement.md,
docs/proposals/sovereign-settlement-domain.md, docs/adr/ADR-2096..2103. Owner decisions D0–D6
are out of scope by instruction; findings below are about the pack's execution of those
decisions, not the decisions themselves.

## Method

Opened every cited file at the cited line for ≥15 file:line pairs across code (contract.rs,
sessions-boundary.js, keys.rs, uris.js, payments.js/authority.js, cost-gate.js,
spend-policy.js, agentbox.toml, pay_handler.rs, bitcoin_tx.rs) and the upstream sidestr
SPEC.md clone; ran `node scripts/adr-index-gen.js docs/adr --check`; grepped the eight ADRs
and both proposals for em-dashes in prose, `/nix/store`, "sixth" adapter-slot language,
non-UK spelling, and "single-use seal". Cross-checked ADR/PRD/DDD numbers (k-of-n, kind
allocations, URN kinds, apply classes) against each other.

## Findings

| # | Severity | file:line | Claim | Evidence | Proposed fix |
|---|---|---|---|---|---|
| 1 | **Blocking** | `docs/proposals/sovereign-settlement-domain.md:445` vs `docs/adr/ADR-2098-chain-and-asset-urn-kinds-and-the-chain-nostr-plane.md:42` and `docs/proposals/sovereign-settlement.md:155,171,307` | Kind **38110** is assigned twice inside the pack: ADR-2098 and the PRD mint it as `sidestr-account-binding`; the DDD's Domain Events table assigns the same number to `PegOutDefaulted` ("new kind (38110)"), then the DDD's own summary sentence ("Our own events take 38110-38115") silently absorbs the collision by treating 38110 as free for the event range when ADR-2098 has already spent it on account-binding. | Direct read of all four passages (line numbers above); confirmed no other kind covers account-binding in the event table, so this is not a typo for a different number — the two documents in the same pack, written for the same ratification, disagree on what 38110 *is*. | Shift the DDD's new event kinds to 38111-38115 (`PegOutDefaulted`=38111, `ChildChainOpened`=38112, `ChildChainClosing`=38113, `ChainTombstoned`=38114, `SettlementRecorded`=38115) and fix the summary sentence to "38111-38115" (5 kinds, not 6 — there is no kind explicitly named for the 6th number in the current range statement either). Re-run the kind table into `docs/PROTOCOL-registry.md` from a single source of truant to prevent drift. |
| 2 | **Major** | `docs/proposals/sovereign-settlement.md:59`, `docs/adr/ADR-2099-the-chain-is-the-ledger-of-record.md:27`, `docs/proposals/sovereign-settlement-domain.md:843`, and `S/BRIEF-fact-base.md:89` | "`txo[]` constructed empty ... `services/nostr-pod-bridge/src/contract.rs:128`" | Opened the file: line 128 is `repository: identity.did(),` inside `build_gitmark`. The actual `txo: Vec::new()` construction is at **line 139**, inside `build_blocktrail`. The citation is wrong by 11 lines and points at unrelated code, and the error is repeated verbatim in four separate documents across the pack (fact base → PRD → ADR-2099 → DDD), despite the PRD's front-matter claim that "file:line citations in this PRD were re-verified by the coordinator." | Correct every occurrence to `contract.rs:139`; since the error propagated through re-verification once already, add a `grep -n "txo: Vec::new()"` sanity check to the P0 exit evidence rather than trusting eyeball line numbers again. |
| 3 | **Minor** | `docs/proposals/sovereign-settlement-domain.md:462` | "Our own events take 38110-38115 from the free part of agentbox's owned 38000-38201 block" | The event table three lines above lists exactly 5 new kinds (38110, 38111, 38112, 38113, 38114); no row uses 38115. Subsumed by finding #1's fix, but flagged separately because the off-by-one survives even if #1 is fixed differently (e.g. keeping account-binding at 38110 and shifting only the DDD events would still leave 5 kinds spanning 38111-38115, not 6). | State the exact kind list, not a range, or correct the range to match the table exactly after #1 is resolved. |
| 4 | **Note (unassigned gap)** | `docs/proposals/sovereign-settlement.md:365-399` §10 | Open question 9 already flags that D6's default (Knots BLAKE2b testnet4) and D1's earlier target (SHA-256d testnet4) "imply different first seals" and asks "which parent family does `sidestr:dreamlab` seal with?" — this is self-aware, not a defect, but it is left **assumed** to the D6 default rather than resolved, and ADR-2103's own Decision §1 states the default without cross-referencing that the fact-base's D1 (SHA-256d) is the thing being silently overridden by that default. | Read `docs/proposals/sovereign-settlement.md:391-393` and `docs/adr/ADR-2103-...md:34-44`; ADR-2103 never cites D1 by name even though its default decision is exactly what supersedes it, only the later fact-base owner-amendment does. | Add a one-line cross-reference in ADR-2103's Context to the D1→D6 amendment, so a reader of the ADR alone (not the fact base) sees that the default was deliberately changed from the owner's first answer, not merely "configuration." |
| 5 | **Note** | `docs/adr/ADR-2096-sidestr-sidechains-are-the-sole-value-instrument.md:69-75` (Verification) | Ratification evidence for ADR-2096 includes "`sidestr-core` validates the live upstream `sidestr:txbt4-fed` and `sidestr:gitmark` chains to the JS explorer's tip hash" — reasonably falsifiable — but also "`grep -rn rgb-lib crates/sidestr/sidestr-core` empty," which only proves absence of a string match, not absence of a transitive dependency (a crate could pull `rgb-lib` indirectly via a re-exported type without the literal string appearing in that one crate's source). ADR-2102's own verification is stronger here (`cargo tree ... | grep -c rgb`), which is the correct test. | Compare the two ADRs' verification sections directly. | Replace ADR-2096's `grep -rn rgb-lib` check with (or add) the `cargo tree` dependency-graph check ADR-2102 already specifies, so both ADRs are falsified the same, correct way. |
| 6 | **Note** | `docs/proposals/sovereign-settlement.md` (prose-wide) | House style ("no em-dashes in prose") — checked. All em-dash characters found are confined to ADR H1 titles, which is the pack-wide, TEMPLATE.md-mandated convention (`# ADR-NNNN — Short imperative title`), not a violation. No em-dashes appear in body prose of the PRD, DDD, or any ADR. Flagging as checked-and-clear rather than omitting, since the instruction asked to grep specifically. | `grep` of all 8 ADR + 2 proposal files; only line-18 title lines matched; confirmed against `docs/adr/TEMPLATE.md:17` and five other recent ADRs (2090–2095) using the identical convention. | None needed. |
| 7 | **Note** | Non-UK spelling, `/nix/store`, sixth-adapter-slot, "single-use seal" | All clear. No `-ize`/`-or`/`-er` American spellings found; no `/nix/store` path in the pack; "sixth" appears only in negation ("no sixth slot", 3 occurrences, all correctly asserting the five-slot discipline holds); "single-use seal" appears only in ADR-2099's Context (quoting the host prohibition) and DDD I11 (stating the gate), never as an active construction — I11 and ADR-2099 §6 are consistent with each other and with host ADR-124 §2.3. | Direct greps, see Method. | None needed. |
| 8 | **Note** | `node scripts/adr-index-gen.js docs/adr --check` | Ledger reciprocity check | Output: `ok: 96 ADR(s) valid (--check, README neither written nor compared — use --check-index to compare)`. All eight new records pass frontmatter validation; `supersedes`/`superseded_by` are empty arrays on all eight (correctly — they supersede *other repos'* records referenced only in prose/frontmatter `supersedes_in_part`, not agentbox ADRs, so no reciprocity edge is expected here). No breakage. | — | Consider also running `--check-index` before ratification to compare against the generated README, since this run explicitly skipped that comparison. |
| 9 | **Note** | Decision-status hygiene | All 8 ADRs carry `decision_status: proposed`, `implementation_status: none`, `activation_status: inactive`, empty `verified_commit`/`verified_paths` — correctly reflects nothing is ratified or built yet. No record was minted `accepted`. | Frontmatter grep, all 8 files. | None needed. |
| 10 | **Spot-checked, correct (for the record)** | `nostr-bbs-core/src/keys.rs:251-265,477-485`; `management-api/routes/payments.js` (no `authority.js` require, only `broker-bridge.js`/`llm-marketplace.js`); `src/handlers/pay_handler.rs` (`.deposit` returns 501, confirmed at the handler and the module doc comment); `crates/solid-pod-rs/src/bitcoin_tx.rs:22-24` ("No rust-bitcoin / secp256k1-sys is introduced"); `management-api/lib/uris.js` (`knowledge` kind precedent, `ownerScope`/`contentAddressed` shape matches ADR-2098's claimed precedent for `asset`); upstream `SPEC.md` §9/§12/§14 (level 3 = rotation, assets reserved/draft, "coins with no value" quote) — all verified accurate, several with exact line-number matches. | 10+ direct reads, listed above and in transcript. | None — noted so the ratifier knows these were checked, not merely trusted. |

## Priority coverage notes

- **Priority 1 (factual errors):** one confirmed (#2), otherwise the pack's citation discipline
  is unusually good — of 15+ spot-checked file:line pairs, only the repeated `contract.rs:128`
  error failed verification.
- **Priority 2 (internal contradictions):** one confirmed and blocking (#1, kind 38110). No
  other numeric contradiction found across k-of-n figures, apply classes, URN kinds, or phase
  ordering — these are consistent PRD↔ADR↔DDD throughout (spot-checked: C2's "3 of 3 hosts,
  threshold 2 ... 3 of 5 before value" matches ADR-2101 §1 exactly; apply classes for
  `parent`/`header_profile` are `rebuild` in both M3a and ADR-2103 §3).
- **Priority 3 (house-rule violations):** none found (findings #6–#9 are checked-and-clear).
- **Priority 4 (unassigned R2/R3 gaps):** not independently re-audited against R2/R3 line by
  line under this effort budget beyond what's cited above; the `VisionClaw FsPaymentStore`/
  version-skew gap and the `AnchorConfirmer` test-doubles-only gap are both explicitly picked
  up by ADR-2099/ADR-2101 and DDD Phase 0/4, so the two headline gaps from the fact base are
  closed in the pack.
- **Priority 5 (unfalsifiable Verification sections):** #5 is the one weak spot found; every
  other ADR's Verification section names a concrete grep, test, or mutation check.
- **Priority 6 (owner-decision drift):** none found against D0–D6 or the standing exclusions;
  `evm`/`pool`/`desk`/custodial routers/in-chain-RGB are excluded consistently in ADR-2096 §5,
  ADR-2102 §2, DDD I10, and the DDD's "does not model" section.
- **Priority 7 (unsupported sidestr claims):** none found. Level-3/rotation, the "assets between
  chains: draft" reservation, and the ephemeral-chains-as-a-note characterisation all check out
  against SPEC.md directly.

## Verdict

**Must fix before ratification:** finding #1 (kind 38110 double-booked between ADR-2098/PRD and
the DDD event table) and finding #2 (the repeated `contract.rs:128` → should be `:139`
citation, wrong in four documents). Both are mechanical, cheap fixes that do not touch any
decision the owner already made. Finding #3 is subsumed by #1's fix. Findings #4, #5 are
worth a one-line tighten each but do not block ratification. Findings #6–#10 are clean; no
change needed.

No evidence of hand-rolled crypto being introduced, a sixth adapter slot, a decision minted as
accepted, ledger reciprocity breakage, or drift from the owner's D0–D6 decisions was found
anywhere in the eight-record pack.
