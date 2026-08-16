# ADR-056: `/dream` decision surface — from inspect to a governed judgment-broker action

- **Status:** Accepted (Phase 1); Proposed (Phase 2)
- **Date:** 2026-08-16
- **Builds on:** [ADR-055](ADR-055-dream-cockpit-panel.md) (read-only `/dream` panel),
  [ADR-044](ADR-044-operator-console.md) (cockpit), the approvals/authority governance
  path (NIP-98 + agent-event/elevation publisher)

## Context

ADR-055 shipped `/dream` as an **inspect** surface: read the ledger, link out. But
the dream engine's whole point is a decision — *evaluation is not promotion; a human
merges the draft PR*. That merge is the judgment-broker action, and today the panel
does nothing to make it legible or frictionless: it shows every row equally, with no
sense of *what is actually waiting for a human*.

The temptation is to let the cockpit **merge the PR**. We reject that: merging is an
irreversible external action, it would require GitHub write credentials inside the
operator runtime, and it contradicts the mesh's founding rule — *the machine never
runs the merge*. Observation and authority are kept apart on purpose (VisionClaw's
"watch here, judge there"; the forum is "the one place a decision gets signed").

So the decision surface is split into two phases with a hard boundary between them.

## Decision

### Phase 1 — surface the pending judgment-broker queue (this ADR, built)

Compute, from the ledger alone, **what is awaiting a human merge**, and drive the
operator straight to it. A row is *pending* when:

- its verdict is `ACCEPT` (the engine judged the change worth landing), **and**
- it names a real PR (`#N`), **and**
- no later row's `Prior-night fates` column carries a `#N:MERGED` token (the same
  fate-token convention `parsePriorFates` reads) — i.e. the ledger has not recorded
  it as merged.

`GET /dream/status` gains a per-repo `pending[]` list and a `pendingCount` total. The
panel shows an **"Awaiting your merge"** section at the top: each pending PR with a
one-click **"Review & merge on GitHub →"** link (built from the repo slug + PR
number). The merge happens on GitHub, under the operator's own identity — the cockpit
computes and routes the decision; it does not execute it.

This adds **no new trust surface**: it is still read-only, operator-gated, no
credentials, no write endpoint. It is pure signal over data we already parse.

### Phase 2 — the signed, witnessed decision record (proposed, NOT built)

A `POST /dream/decide` that takes an operator's **NIP-98-signed** attestation
("`<npub>` approves merging PR #N from dream cycle `<witness>`") and publishes it as a
governed agent-event via the **existing** `lib/agent-event-publisher` /
`lib/elevation-publisher` path — witnessed and federated to Nostr, so the mesh holds a
signed, tamper-evident record of the judgment independent of GitHub. Bound by an
explicit manifest gate and an authority class.

**Phase 2 is deferred behind a security sign-off**, because it is a governed *write*
path in a public runtime. Its boundaries when it lands:

- Still **no GitHub credentials** in the cockpit and **no machine-run merge** — the
  record attests the decision; a human (or a separately-gated executor that verifies
  the signature) performs the mechanical merge.
- Writes require NIP-98 (a bearer alone cannot sign a decision), exactly as
  `/approvals` requires.

## Consequences

- Phase 1 turns the inspect panel into a *decision* surface without crossing the trust
  boundary: the operator sees exactly what needs their signature and reaches it in one
  click. The "Run" is the human's merge on GitHub; the cockpit makes it frictionless.
- The `#N:MERGED` fate convention becomes load-bearing for the pending signal, which
  rewards nights that record fates honestly (a virtuous pressure). **Day-one caveat,
  stated honestly:** today's ledgers record merges as *prose* ("PR #7 merged by human"),
  not tokens, so until the engine emits `#N:MERGED` the queue may list an
  already-merged PR. The panel says so inline, and the immediate follow-up is teaching
  the nightly routine to write the token form (mergedFromFates matches the engine's own
  `parsePriorFates` — last-fate-wins — so parity is exact once tokens are emitted).
- Phase 2 keeps the mesh's provenance obsession satisfiable later — a signed decision
  ledger — without smuggling merge authority into the operator surface today.
