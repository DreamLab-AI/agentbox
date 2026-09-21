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

The [historical closeout routing note](../adr-history-closeout.md) points the 72 archived decision candidates at the estate historical map and section-level review; the archive remains historical and lineage mentions are not whole-document supersession.

The [estate status/evidence contract](../../../../VisionFlow/docs/architecture/adr-status-contract.md) defines the independent decision, implementation and activation axes and distinguishes lineage from supersession (2026-09-07).

**Re-verifying a record — read and check, never diff and bump.** The staleness gate
answers one question: *did anything move under `verified_paths` since `verified_commit`*.
It cannot answer whether the record is still **true**. Those two are much less correlated
than they look. In the 2026-09-21 backlog clearance, 19 records were tripped by estate-address
generalisation, additive manifest blocks and insertions elsewhere in a shared file, and all
19 were still true; the one record that had genuinely become false (ADR-2030) was tripped by
a harmless dependency bump, and what actually falsified it was a file its `verified_paths`
did not name at all. Signal and truth were uncorrelated in both directions. So: read what
the record claims, run the domain's own gate or tests, check the claim against the code as
it stands — and only then set `verified_commit` to the commit at which you established it.
A `verified_commit` is a claim about a commit, so the evidence must reproduce **at that
commit**: verify against committed state (`git show`, or a detached worktree), never a dirty
tree. Three outcomes are legitimate and should be recorded as such — still true (bump, and
note the command you ran); no longer true (**do not bump** — leave it stale and say why, since
a false `verified_commit` is worse than an honest stale one); and unverifiable by reading,
needing a running service or a measurement (do not bump; say what evidence would settle it,
and use `verified_paths: []` for a record that should assert nothing checkable).

**Arm the gate on the set the `review_trigger` names.** `verified_paths` entries are git
pathspecs passed straight to `git diff`, so a glob such as `services/*/Cargo.toml` works and
is preferred wherever the trigger describes a set that can *grow*. An enumeration can only
detect changes to files it already lists — it is structurally blind to **additions**, which
is exactly how a new crate landed unlicensed under ADR-2030 while the record still read as
verified and its `review_trigger` ("any new crate under `services/`") sat unactioned.
