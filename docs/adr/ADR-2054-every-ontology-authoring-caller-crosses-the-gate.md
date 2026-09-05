---
id: ADR-2054
title: Route every ontology authoring caller through the authority gate
date: 2026-09-05
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: a new caller of ontology-local.js axiomAdd/propose, or skills.ontology.local_authoring being declared in agentbox.toml
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2022 (governed ontology writes; named this CLI as its last remaining bypass)
---

# ADR-2054 — Route every ontology authoring caller through the authority gate

## Context

ADR-2022 established `assertAuthoringAuthority()` and `createAuthoredCorpusWriter()` as
the only sanctioned route to the Markdown-writing helper, and closed the bridge's two
write tools onto it. Its own "Remaining" section named the last hole:
`mcp/servers/ontology-local.cjs` still called `onto.axiomAdd(...)` directly from its
`add` subcommand — a standalone CLI front-end that wrote the authored corpus with no
Whelk check, no human gate, no correlation id and no record. The static-guard test in
`tests/integration/ontology-authoring-authority.test.mjs` pinned that bypass in its
`EXPECTED` map so it could not grow, but did not close it.

Being a CLI is not an authority. The gate's whole point is that the *route* carries the
authority, not the caller's shape.

Exposed by diagram AB-25.5.

## Decision

Every caller that reaches the Markdown-writing helper crosses
`assertAuthoringAuthority()`. The CLI's `add` subcommand resolves
`ontology-authoring-authority.js` by the same repo-then-`/opt` candidate order it already
uses for the ontology lib, constructs the gated writer over its local backend, and calls
`writer.axiomAdd(args, { mode: AUTHORING_MODES.FORCED_LOCAL })` — `forced-local` because
driving the local backend directly is exactly that mode.

A denial is a first-class outcome: the CLI prints the typed `OntologyAuthorityError`
result (its `code`, `mode`, `target`, `operation` and `missing_authority[]`) as JSON and
exits non-zero. It never falls back to the ungated helper and never exits 0 on a refused
write.

The static-guard test is updated to pin the *closed* state: the receiver in
`ontology-local.cjs` must be the gated `writer`, so a regression back to the raw backend
fails the test rather than passing it as a known exception.

`skills.ontology.local_authoring` remains undeclared in `agentbox.toml`, which means
local authoring is denied in every mode as shipped. That default is correct, but it is
implicit — it holds because a key is absent. Declaring it explicitly as `false` with a
comment is routed to the manifest owner so the deny is reviewable rather than an
absence; `implementation_status` stays `partial` until that lands.

## Consequences

- The `direct_axiom_load = false` default now actually binds on every path. Before this
  change an operator with a shell could write axioms into the authored corpus with no
  governance at all, which is precisely what ADR-2022 forbids.
- The CLI's `add` subcommand is, as shipped, **inert**: it returns
  `ontology_direct_axiom_load_disabled` naming `manifest:skills.ontology.direct_axiom_load`.
  That is the intended posture — the governed route is `ontology_propose`. An operator
  who genuinely needs a bootstrap load uses the `bootstrap` mode's explicit, signed,
  zero-tolerance path.
- The other CLI subcommands (`health`, `search`, `get`, `list`, `neighbors`, `path`,
  `ask`, `validate`) are reads and are untouched.
- Follow-on: declaring `local_authoring` in the manifest (routed), and carrying one
  correlation id through a real Whelk validation → PR → approval → merge → served-corpus
  chain, which still needs the VisionClaw-side stages to echo it (ADR-2022 remaining).

## Verification

Verification ran on the **uncommitted working tree** above
`89301ec7c911eab270c00a0cf81596d0d4f15535` and must be re-run at the landing commit;
`verified_paths` is therefore empty.

- `node --check mcp/servers/ontology-local.cjs` → syntax OK.
- `node mcp/servers/ontology-local.cjs add TestSubject SubClassOf TestObject` → prints
  the typed denial `{"error":"ontology_direct_axiom_load_disabled", "mode":"forced-local",
  "target":"local-authored-corpus", "operation":"direct-axiom-load",
  "missing_authority":["manifest:skills.ontology.direct_axiom_load"],
  "authorised":false, "written":false}` and does not write. Before the change the same
  command wrote the axiom.
- `node --test tests/integration/ontology-authoring-authority.test.mjs` → **24 tests,
  24 pass, 0 fail**. The static-guard test failed first with the old `EXPECTED` map
  (receiver `onto`), which is the guard working as designed; it was updated to `writer`
  and passes.
- Regression: `node --test mcp/servers/lib/ontology-push.test.js` → **5 pass, 0 fail**.
- `grep -n 'onto.axiomAdd' mcp/servers/ontology-local.cjs` → no match after the change.
