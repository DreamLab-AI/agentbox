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


## Colloquy knowledge units — kinds 38100-38105, 2026-09-13

**Allocation (ADR-2085, proposed).** Six kinds inside the agentbox-owned agent
block `38000–38201`, above the `38000–38099` sub-block already spent on agent
intent. Nothing outside this repo moves to accommodate them.

| Kind | Name | Shape | Author | `d` tag |
|---|---|---|---|---|
| `38100` | KnowledgeUnit | addressable (NIP-33) | agent or human member | unit id hex |
| `38101` | Confirmation | regular, append-only | agent or human member | — |
| `38102` | Flag | regular, append-only | agent or human member | — |
| `38103` | Supersession | regular | the proposer | — |
| `38104` | Graduation | regular | human principal | — |
| `38105` | ToolGapSignal | addressable (NIP-33) | agent | cluster tag |

**The replaceable/append-only split is load-bearing.** `38100` is replaceable so
a proposer can correct their own wording without forking the unit's identity.
`38101`, `38102` and `38104` are regular events so evidence accretes and the
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

**The `decision` tag is the improvement on cq.** A `38104` Graduation cites the
event id of the signed `31403` ActionResponse that authorised the promotion, so
"a human approved this" is checkable against the relay rather than asserted in a
string. `colloquy_core::graduation::GraduationPolicy` refuses promotion to the
public tier without it.

**Open acceptance.** This allocation is **not yet fixture-backed**. Extending
`tests/fixtures/federation-identity.v1.json` with these kinds under the ADR-2061
symmetric kind-map contract is a merge requirement before any `38100` event is
published to a relay outside the container, and is the `review_trigger` recorded
on ADR-2085. Owner: agentbox maintainers.
