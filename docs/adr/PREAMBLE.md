**How to work against this pack** (engineering/build-with-quality agents start here):

The ADR pack for any domain is **its living governing document in `docs/` plus the
ledger records below that amend it**. The living docs are normative — their
*Invariants* sections are the compliance surface and their *Change process*
sections say how to amend them:

| Domain | Governing document |
|---|---|
| Nix image, services, adapters, GPU, sidecars | [`../BASELINE-container.md`](../BASELINE-container.md) |
| Doors, tokens, DID/npub identity, break-glass | [`../INGRESS-identity.md`](../INGRESS-identity.md) |
| RuVector, learning loop, trajectories, gates | [`../LEARNING-memory.md`](../LEARNING-memory.md) |
| Journal, action policy, skills, dream machine, Loom | [`../GOVERNANCE-capabilities.md`](../GOVERNANCE-capabilities.md) |

**Lookup order:** governing doc → its `file:line` citations into code → the ledger
records below → `docs/archive/` **only for rationale and history — never as
authority** (the archive is the pre-2026-08-31 corpus, frozen precisely because it
drifted from the code; the host project's `docs/MIGRATION-plan.md` holds the
legacy-number redirect table).

**Making a decision:** copy [`TEMPLATE.md`](TEMPLATE.md) to `ADR-NNNN-slug.md`
(next free number), fill the three-axis status honestly, update the affected
governing document **in the same change**, and regenerate this index
(`node scripts/adr-index-gen.js docs/adr` — CI-enforced via
`.github/workflows/invariants.yml`: invalid frontmatter, asymmetric
supersession edges, and stale `verified_commit`+`verified_paths` claims all
fail the build).
