---
title: "Upstream contribution to mozilla-ai/cq"
status: POSTED 2026-09-13 — mozilla-ai/cq#536, #537, #538
date: 2026-09-13
upstream: https://github.com/mozilla-ai/cq
licence_position: Apache-2.0 both sides; code contributions are Apache-2.0 by their CONTRIBUTING
---

# Upstream contribution — three issues, ready to post

cq's `CONTRIBUTING.md` requires an issue *before* work starts on "new features,
API changes, architectural changes, breaking changes". All three items below are
architectural, so the correct artefact is an issue each, not a pull request.
Branch prefixes (`feature/`, `docs/`), tests with the change, atomic commits and
no force-pushing after review are their stated conventions; PRs go against `main`.

**Licence position.** cq is Apache-2.0 and their CONTRIBUTING states code
contributions are licensed Apache-2.0. `colloquy-core` is published Apache-2.0 to
match, so a reference implementation can be pointed at or upstreamed without a
relicensing step. Note their separate **Contributor Agreement for knowledge-unit
contributions** — that covers *units*, not code, and none of this touches it.

**Posted 2026-09-13**, under the owner's GitHub account:

| Issue | Subject |
|---|---|
| [mozilla-ai/cq#536](https://github.com/mozilla-ai/cq/issues/536) | Optional `authorising_event` on graduation entries |
| [mozilla-ai/cq#537](https://github.com/mozilla-ai/cq/issues/537) | Confirmation diversity over an attested authorising principal |
| [mozilla-ai/cq#538](https://github.com/mozilla-ai/cq/issues/538) | A distinct status for flagged-but-not-retired units |

The reference implementation they point at is published:
[`colloquy-core` 0.1.0](https://crates.io/crates/colloquy-core) (Apache-2.0).
Their review window is 5 business days for a first response; issues inactive for
30+ days may be closed, so #537 in particular — the one that argues an existing
guarantee is weaker than it reads — is worth watching.

---

## Issue 1 — Make a graduation's human approval verifiable, not merely asserted

**Title:** `Proposal: optional authorising_event on graduation_history entries`

**Labels to suggest:** `enhancement`, `spec`

> ### Summary
>
> `graduation_history` records the approving human as a string:
>
> ```json
> { "from": "local", "to": "remote",
>   "approved_by": "human:alice@acme.dev",
>   "timestamp": "2025-01-20T11:00:00Z" }
> ```
>
> A consumer reading a graduated unit has to take that on trust. Since
> graduation is the boundary where a unit becomes readable by people who cannot
> ask anyone what happened, the approval is exactly the field most worth being
> able to check.
>
> ### Proposal
>
> Add an **optional** `authorising_event` to each graduation entry: an
> identifier for a signed decision record that carries the approval.
>
> ```json
> { "from": "local", "to": "remote",
>   "approved_by": "did:nostr:8f2c…",
>   "timestamp": "2025-01-20T11:00:00Z",
>   "authorising_event": "e3a1…" }
> ```
>
> The field is opaque to the schema — it means "resolvable in whatever signed
> decision log this deployment keeps". In ours it is the event id of a signed
> Nostr `31403` approval, which any reader can fetch and verify the signature of.
> A deployment with no signed-decision substrate omits the field and loses
> nothing.
>
> ### Why additive is the whole point
>
> Omitted when absent, so a unit written by an implementation that does not know
> the field round-trips byte-identically. We have this under test against the
> published `knowledge_unit.json` example: it parses, and re-serialising rewrites
> no cq-defined field.
>
> ### Suggested spec wording
>
> > `authorising_event` *(optional, string)* — identifier of a signed decision
> > record that authorises this promotion, resolvable within the deployment's
> > decision log. Where present, consumers MAY verify it and SHOULD treat a
> > promotion whose `authorising_event` fails verification as un-graduated.
> > Absence means the approval is asserted rather than attestable, which is
> > valid; it is not evidence of a problem.
>
> ### Reference implementation
>
> `colloquy-core` (Apache-2.0, Rust) implements the field and the policy that a
> promotion to the public tier is refused without it. Happy to open a PR against
> `docs/architecture.md` if the direction is welcome.

---

## Issue 2 — Diversity requirements are defeatable where accounts are cheap

**Title:** `Proposal: define confirmation diversity over an attested authorising principal, not a self-declared org`

**Labels to suggest:** `enhancement`, `spec`, `security`

> ### Summary
>
> The trust model's headline rule is right and is the reason to adopt cq at all:
>
> > Three confirmations from three different organizations outrank 800
> > confirmations from two.
>
> `contributing_orgs` is the field that carries it. The question this proposal
> raises is what binds a confirming *account* to the organisation it counts as.
> Where that binding is self-declared, the rule reduces to "three confirmations
> from three accounts that said they were different", and an adversary — or,
> more commonly, an enthusiastic deployment — can satisfy it without any
> independent verification having occurred.
>
> This is not hypothetical for agent estates. In ours, creating an agent is a
> single command. Fifty agents run by one operator will cheerfully confirm the
> same unit fifty times, and every one of them is a genuine, non-malicious
> account.
>
> ### Proposal
>
> Specify that the unit of diversity is an **authorising principal** — the party
> accountable for what a member asserts — and that confirmations collapse onto it
> before any weighting:
>
> 1. A human member's authorising principal is themselves.
> 2. An agent member's authorising principal is whoever registered it. This is
>    already the accountability model cq describes ("keeping accountability at
>    the human level rather than the agent level"); this proposal makes it the
>    *arithmetic* as well as the prose.
> 3. *N* members under one principal contribute that principal's weight **once**,
>    whatever the number of accounts or repeat confirmations.
> 4. A member whose authorising principal cannot be resolved is **dropped**, and
>    the drop is reported. The tempting default — unknown members authorise
>    themselves — hands an attacker unlimited principals for the cost of
>    generating keys.
>
> Point 4 is the one we would most want scrutiny on. It is the conservative
> direction and it has a real cost: a genuinely independent contributor who is
> not in the registry counts for nothing until an operator adds them.
>
> ### Relationship to the existing anti-poisoning layers
>
> This does not replace anomaly detection, HITL review or guardrails. It
> hardens the layer underneath them, so that "diversity requirements enforce
> varied confirmation sources" is enforced by construction rather than by
> detection after the fact.
>
> ### Reference implementation
>
> `colloquy_core::principal::collapse` plus `ConfirmationPolicy`. The properties
> above are under test, including cq's headline rule stated directly as
> `three_principals_outrank_eight_hundred_accounts_under_two`, and a case
> asserting that fifty unregistered keys buy zero principals.

---

## Issue 3 — Separate "contested" from "withdrawn" in the lifecycle

**Title:** `Proposal: a distinct status for flagged-but-not-retired units`

**Labels to suggest:** `enhancement`, `spec`

> ### Summary
>
> `flag` marks a unit wrong or stale, and `lifecycle.status` carries `active`
> among its values. What the spec does not say is what a flag *does* to a unit's
> status — which leaves each implementation to choose, and the tempting choice
> is to stop serving it.
>
> That choice is a denial-of-knowledge vector: any single member can remove a
> unit from circulation by objecting to it. It also loses information at exactly
> the wrong moment, because a contested unit is often the one a reader most needs
> to see, together with the objection.
>
> ### Proposal
>
> Add a `disputed` status, and specify the two rules around it:
>
> 1. An unresolved flag moves a unit to `disputed`. A disputed unit **is still
>    served**, ranked down, with its flag count exposed alongside its
>    confirmation count.
> 2. Only a human decision — the same gate that governs promotion — moves a unit
>    to a withdrawn state. Flagging never does it alone.
>
> Stated positively: *a flag lowers standing and opens a conversation; it does
> not close one.*
>
> ### Compatibility
>
> This one is **not** purely additive, and we would rather say so than discover
> it in review. An implementation that does not model `disputed` will fail to
> parse a unit carrying it. We think that is the correct failure — an
> implementation with no concept of dispute should not be told that a disputed
> unit is `active` — but it is a real interoperability cost and the decision is
> the maintainers'. If it is judged too sharp, an alternative is to leave
> `status` alone and add an optional `evidence.flags` count with the same two
> rules attached, which keeps parsers working.
>
> ### Reference implementation
>
> `colloquy_core::unit::UnitStatus::Disputed`, with
> `UnitStatus::is_servable()` returning `true` for it, and the retirement path
> gated on a signed decision.

---

## If the maintainers want code

Issues 1 and 3 are a `docs/architecture.md` edit plus schema validation. Issue 2
is a paragraph of spec and a change to how `contributing_orgs` is computed.
`colloquy-core` is Apache-2.0 and can be pointed at as a reference
implementation, or the relevant logic upstreamed into their Go/Python
implementations — the rules are about forty lines of arithmetic, and the tests
are worth more than the code.
