# Federation protocol registry

Status: proposed governing surface, 2026-09-04. Owner: agentbox maintainers with VisionClaw identifier maintainers. ADR-2025 previously referenced this absent document. This initial registry records the inspected seam; it is not a claim that every estate protocol is catalogued or accepted.

| Contract | Current implementation | Required acceptance |
|---|---|---|
| Content address | BC20 sha12 over UTF-8 strings; VisionClaw content_address over bytes | Same input bytes, twelve lowercase digest hex characters, explicit serialisation |
| URN crossing | JS supports agent/activity/thing/bead and option-dependent memory elevation; Rust has a narrower closed map. Concretely: `bc20-provenance-bridge.js:88-89,167-169` crosses `bead` structurally while `cross_from_agentbox()` (`src/uri/mod.rs:650`) has no `bead` arm and refuses it via the wildcard, so the same object crosses in one language and is refused in the other | Versioned supported-kind agreement and explicit unmapped outcomes — planned by [ADR-2061](adr/ADR-2061-federation-kind-map-parity.md) (proposed), which makes the kind list a single shared artefact both translators derive from, distinguishes "deliberately refused" from "not implemented", and gates symmetry with a paired fixture |
| Precomputed KG address | Rust constructor/parser checks prefix | Validate complete address grammar at admission |
| Durable translation | Helpers return mapping/source identity | Persistence, replay, round-trip and recovery receipts |

[ADR-2025](adr/ADR-2025-cross-repo-federation-contract.md) proposes the shared contract and CI gate. [Estate evidence](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/federation-identifiers.md) distinguishes tested helper parity from open deployment and persistence work. Changes to encoding, scope, hash length, kind mapping or retention require joint review and paired fixtures. No secret key material belongs in this registry.

## Remediation — 2026-09-05

- **ADR-2061** (proposed) — Make the cross-repo URN kind map symmetric and
  fixture-gated in both languages. Records the concrete `bead` asymmetry the
  "URN crossing" row above describes in the abstract, resolves it in favour of
  crossing (matching the JS bridge, since agentbox beads are already
  content-addressed to VisionClaw's `<pubkey>:<sha256-12>` shape), and defines a
  four-part acceptance test. The content-address row is **not** affected: the
  golden fixture `entity_urn_matches_uris_js_golden`
  (`src/services/provenance_writer.rs:623`) already pins both languages to
  `sha256-12-8c3913fd05a9` for identical canonical input, so the hash halves are
  proven equal and only the kind list diverges. Exposed by diagrams ES-03.4,
  ES-03.5 and ES-03.6. Cross-lead: the Rust arm is vc-knowledge's
  (`src/uri/mod.rs`), the JS map ab-identity-governance's
  (`management-api/lib/bc20-provenance-bridge.js`); both have the evidence.
- **ADR-2062** (proposed) — Bind container-internal services to loopback and
  extend the exposure gate beyond published ports. Resolves the
  `BASELINE-container.md` "verify this is intended" note on `code-server`:
  `flake.nix:2180` binds `0.0.0.0:8080 --auth none` inside the container while
  `docker-compose.yml:61` publishes `127.0.0.1:8080:8080`, and
  `docker-compose.yml:160-162` joins agentbox to `visionclaw_network` — so the
  loopback publish constrains the host only, and any peer container on that
  bridge reaches an unauthenticated editor. Records that ADR-2013's gate reasons
  about *published* ports and is structurally blind to container-internal binds.
  Exposed by diagram ES-10.8. Routed to ab-runtime (`flake.nix`, `scripts/ci/`).


## Bead crossing — decision and fixture, 2026-09-05

**Decision recorded (ADR-2025 closeout).** The `bead` asymmetry is **resolved in
favour of crossing**, matching the agentbox JavaScript bridge: agentbox bead
locals are already `sha256-12` content addresses, structurally identical to
VisionClaw's `<pubkey>:<sha256-12>` bead shape, so a structural pass-through
preserves content identity across the boundary. The Rust arm is owned by
[ADR-2061](adr/ADR-2061-federation-kind-map-parity.md) (proposed). **Until that
lands, the refusing side must report an explicit unmapped result — never a
fabricated identity.**

**The contract is now a fixture, not a description.**
[`tests/fixtures/federation-identity.v1.json`](../tests/fixtures/federation-identity.v1.json)
is the versioned two-language artefact, pinning input byte encoding (UTF-8, and
the recorded fact that *neither* side normalises, so composed and decomposed
Unicode yield different addresses), the serialisation distinction between hashing
a URN string and stable-serialising a payload, the exact grammar
`^sha256-12-[0-9a-f]{12}$`, the supported kinds with an `expected_rust` column,
elevation, and the explicit unmapped outcomes. The `bead` row is marked
`divergent` rather than pretending parity.

[`scripts/ci/federation-fixture-check.mjs`](../scripts/ci/federation-fixture-check.mjs)
runs the agentbox side — **35 checks, all passing** — including the
precomputed-address admission table (empty, non-hex, uppercase and overlong
suffixes are rejected, closing the prefix-only weakness), the owner-scope
grammar, and a bidirectional check that the fixture's kinds and the bridge's
declared kind map agree, so shipping a new kind without extending the fixture
fails the gate.

**This gate covers one side.** The contract is not closed until VisionClaw's
pipeline executes the same file against `src/uri/mod.rs`; the check states that
in its own machine-readable output rather than implying two-sided coverage.
Durable mapping persistence, replay and recovery remain untested — the fixture
exercises pure helper calls.


## agentbox Nostr kind bands: the allocation rule, 2026-09-21

**Every agentbox kind allocation cites the registry row it occupies (ADR-2105).**
A number is free only when this table says so, and the table is ordered by number
so a gap is visible rather than inferred.

| Range | State | Record |
|---|---|---|
| `38000`-`38099` | **reserved**, agent intent | ADR-009 §4.2, PRD-004 §4.2 |
| `38100`-`38199` | **reserved**, agent response | ADR-009 §4.2, PRD-004 §4.2, enforced live at `mcp/nostr-bridge/relay-consumer.js` (`AGENT_RESPONSE_MIN`/`MAX`) |
| `38200`-`38299` | **reserved**, agent job and payment; `38200` estimate and `38201` settlement are spent | PRD-006 §S8, `[payments]`, band convention in the VisionFlow host's `docs/protocol/event-kind-registry.md` §2.3 |
| `38300`-`38399` | **reserved**, LLM resource marketplace; `38300`-`38305` spent | ADR-021, same host §2.3 |
| `38400`-`38409` | free | — |
| `38410`-`38415` | **spent**, colloquy knowledge units | ADR-2085, moved here by ADR-2105 |
| `38416`-`38419` | free | — |
| `38420`-`38425` | **allocated (proposed)**, sidestr account binding and settlement domain events | ADR-2098, ADR-2101, moved here by ADR-2105 |
| `38426`-`38499` | free | — |

**Everything below `38400` is spoken for.** The phrase "the free `38106`-`38201`
range", which carried ADR-2085's allocation and the settlement pack's, was wrong:
`38100`-`38199` is the agent-response reservation in its entirety, and a consumer
that reads the range (the relay consumer does) cannot tell a reserved agent
response from a knowledge unit. `38200`-`38299` and `38300`-`38399` are band
reservations in the host registry, not two and six loose numbers. `38400`-`38499`
is the first hundred no record reserves, so new agentbox kinds come from there.

## Colloquy knowledge units — kinds 38410-38415, 2026-09-13, moved 2026-09-21

**Allocation (ADR-2085, proposed; kinds moved by ADR-2105).** Six kinds in the
agentbox band `38400`-`38499`. They were minted at `38100`-`38105`, inside
the ADR-009 agent-response reservation, and moved out on 2026-09-21. Nothing
outside this repo moves to accommodate them.

| Kind | Name | Shape | Author | `d` tag |
|---|---|---|---|---|
| `38410` | KnowledgeUnit | addressable (NIP-33) | agent or human member | unit id hex |
| `38411` | Confirmation | regular, append-only | agent or human member | — |
| `38412` | Flag | regular, append-only | agent or human member | — |
| `38413` | Supersession | regular | the proposer | — |
| `38414` | Graduation | regular | human principal | — |
| `38415` | ToolGapSignal | addressable (NIP-33) | agent | cluster tag |

**The replaceable/append-only split is load-bearing.** `38410` is replaceable so
a proposer can correct their own wording without forking the unit's identity.
`38411`, `38412` and `38414` are regular events so evidence accretes and the
proposer of a unit cannot rewrite what others said about it — the same
separation the governance ledger already enforces between a `31403` decision and
the append-only `31405` audit log.

**Content is authoritative; tags are an index.** Every fact a consumer acts on is
read from the event's JSON content, which the signature covers as a whole. Tags
exist so a relay can filter without parsing. A `d` tag that disagrees with the
content's own id is a decode error (`DecodeError::IdentifierMismatch`), never a
silently preferred value; a unit whose content does not hash to the id it claims
is refused (`DecodeError::NotContentAddressed`).

**Tag grammar.** Single-letter (relay-indexed) tags carry what is worth filtering
on: `d` the addressable identifier, `t` each domain tag (repeated), `e`/`a`/`p`
the standard references. Everything else is spelled out: `ladder`, `tier`, `v`,
`from`, `to`, `decision`. A supersession distinguishes its two `e` tags with the
NIP-10 markers `superseded` and `supersedes`.

**The `decision` tag is the improvement on cq.** A `38414` Graduation cites the
event id of the signed `31403` ActionResponse that authorised the promotion, so
"a human approved this" is checkable against the relay rather than asserted in a
string. `colloquy_core::graduation::GraduationPolicy` refuses promotion to the
public tier without it.

**Open acceptance.** This allocation is **not yet fixture-backed**. Extending
`tests/fixtures/federation-identity.v1.json` with these kinds under the ADR-2061
symmetric kind-map contract is a merge requirement before any `38410` event is
published to a relay outside the container, and is the `review_trigger` recorded
on ADR-2085. Owner: agentbox maintainers.


## sidestr chain plane — Nostr kinds and two URN kinds, PROPOSED 2026-09-21

**`decision_status: proposed` (ADR-2098, [PRD-024](proposals/sovereign-settlement.md)). Not
ratified, nothing implemented.** This document records no Nostr kinds at all today, so the
estate's kind list had to be assembled by grep; that is the gap this section closes. The rows
above are unchanged.

### Nostr kinds

| Kind | Owner | Direction | Notes |
|---|---|---|---|
| `23500` | **external (sidestr)** | pub + sub | transaction; throwaway key per event |
| `23501` | external (sidestr) | pub | faucet; testnet only, compiled out for mainnet variants (ADR-2103 D4) |
| `23510`-`23514` | external (sidestr) | pub + sub | level-2 signing round; only on signer instances |
| `33333` | external (sidestr) | pub + sub | chain tip; `#d` filterable |
| `33500` | external (sidestr) | pub + sub | rule document; **no upstream wire example** — our codec is conformant to SPEC prose only |
| `33501` | external (sidestr) | pub | genesis document; **no upstream wire example** — SPEC prose only |
| `33502` | external (sidestr) | sub | **dual-schema**: peg record *or* desk pledge. The decoder returns `PegRecord \| Pledge \| Ambiguous` and **never guesses** |
| `38420` | **agentbox** | pub | `sidestr-account-binding`: addressable, `d` = `<chain id>:<did hex>`, content = the derived spend pubkey, signed by the identity key `k_id` (ADR-2101 D4). Allocated from the agentbox band `38400`-`38499` (ADR-2105), the first hundred no record reserves; the earlier `38110` allocation sat inside the agent-response reservation and moved. Nothing outside this repo moves to accommodate it |
| `38421`-`38425` | **agentbox** | pub | settlement domain events: `38421` PegOutDefaulted, `38422` ChildChainOpened, `38423` ChildChainClosing, `38424` ChainTombstoned, `38425` SettlementRecorded (DDD-022). Same band, same record (ADR-2105) |

**The `external` classification is load-bearing, not a formality.** The `2xxxx` and `3xxxx` kinds
above are owned by the sidestr spec (v0.0.1, 2026-09-15), which explicitly states that field names,
kinds and document shapes are provisional. We do not control their evolution, so the registry says
so rather than implying a stability we do not have. An upstream change to any of these kind numbers
or tag shapes is the recorded `review_trigger` on ADR-2098.

**Acceptance is open.** This allocation is not fixture-backed. Extending
[`tests/fixtures/federation-identity.v1.json`](../tests/fixtures/federation-identity.v1.json) under
the ADR-2061 symmetric kind-map contract is a merge requirement before any `38420` event is
published to a relay outside the container, on the same terms as the 38410-38415 allocation above.
The mirror of this table in the VisionFlow host's `PROTOCOL-registry.md` is part of the same change.

### URN kinds (ADR-013 sole-mint discipline)

Two new kinds, minted **only** through `management-api/lib/uris.js` (`:69`). Ad-hoc `format!()` and
template-literal URNs remain prohibited.

| Kind | `ownerScope` | `scopeRequired` | `contentAddressed` | `resolvableSurface` | Local part |
|---|---|---|---|---|---|
| `chain` | `false` | `false` | `false` | `chains` | the sidestr chain name |
| `asset` | `true` (the issuer) | `true` | `true` (over the origin contract id) | `chains` | `sha256-12-<12hex>` |

- **`chain`** is a durable, long-lived, externally-referenced object with no owner: the root
  belongs to the federation and a child belongs to a session that will end. It must resolve so a
  receipt can cite which chain settled it. `ownerScope: false` mirrors `mcp` and `skill`. It is not
  content-addressed because the id *is* the chain name upstream uses, and re-minting it under a
  hash would create a second id for one thing.
- **`asset`** is a wrapped asset class: owner-scoped to the issuer and content-addressed over the
  origin RGB contract id, binding an agentbox URN to a foreign identifier scheme without a second
  parallel id. This is exactly the `knowledge`-kind precedent at `uris.js:91-94`. The wrapped asset
  id is `<origin chain id>:<origin contract id>` (ADR-2102 D1).
- **Rejected, and why it matters:** `wallet` (a `did:nostr` already identifies it uniquely; a second
  identifier for one thing is the failure mode ADR-013 and ADR-033 I1 both prevent), `pegin` and
  `pegout` (these are *events*; `receipt` and `activity` already cover events, and a peg is a
  `receipt` whose payload names the chain URN, the parent outpoint and the claim height).

Resolvability stays best-effort via `/v1/uri/<urn>` (307/404/410), as for every other kind.
