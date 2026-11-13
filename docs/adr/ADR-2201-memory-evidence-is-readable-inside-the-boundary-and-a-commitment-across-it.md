---
id: ADR-2201
title: Memory evidence is readable inside the trust boundary and a commitment across it
date: 2026-11-13
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: the first registered run of the end-to-end memory fixture (clause 5); any change that lets a memory entry, trajectory id or evidence reference leave the container (vault propose, pod sync, relay, federation); ADR-2060 being reopened; the commitment form in crates/nostr-receipt changing; evidence_refs being switched on
repo: agentbox
domain: LEARNING-memory
relates: [ADR-2014, ADR-2015, ADR-2022, ADR-2060, ADR-2107, ADR-2109, ADR-2111, ADR-2133]
lineage: LEARNING-memory D5 and D8; "Can LLM Agents Organize Their Own Memory?" (arXiv 2611.11929); "Owned Edits to a Shared Decision Rule" (arXiv 2611.15917)
---

# ADR-2201 — Memory evidence is readable inside the trust boundary and a commitment across it

## Context

- arXiv 2611.11929 measures an agent-organised memory on LoCoMo. Removing the links from summaries to raw
  source records costs 8.64 points and removing the organised documents costs 2.92; the derived
  views are within noise. One-shot retrieval trails iterative reading by 30 to 42 points.
- arXiv 2611.15917 sets the opposite discipline for anything shared between parties: records stay
  private, what crosses is typed and re-derived, a salted commitment stands in for the records, and
  withdrawal is exact while erasure of a disclosure is not available.
- Measured on the live store, 2026-11-13. Agent-written memory is not an index over the vault: 1.0%
  of 500 sampled `project-state` entries have a vault page at cosine 0.80 or above, against 83.4%
  for vault pages among themselves. It is a dated log: 79% of keys carry a date, 9.3% of entries
  were ever revised, 5% name another entry, and no entry cites what it was written from.
- The recall gate (invariant 6) measures retrieval geometry only. `access_count` is not maintained,
  so the store cannot say which entries are read.
- The vault corpus is distributed, D5 (no reverse tombstone) is open, and agent context already
  leaves the container through hosted model calls and session hooks.

## Decision

The two papers apply to different sides of one line. Inside one operator's container and its
RuVector store, memory stays free-form and evidence is readable. On any surface that leaves it,
evidence appears only as a commitment.

1. **Evidence references on `memory_store`, inside the boundary** (gate
   `[integrations.ruvector_external].evidence_refs`, env `RUVECTOR_EVIDENCE_REFS`, default off). A
   write may carry up to 32 references, each `{kind: "memory", namespace, key}` or
   `{kind: "step", id}` with an optional `event_time`. They are structured because namespaces and
   keys contain the characters a string form would split on. The store validates them before it
   embeds, resolves every one immediately before the write, and rejects the whole write if one is
   malformed or does not resolve, leaving the previous row untouched. References are stored in
   `metadata.evidence` with `metadata.evidence_state`, and `memory_retrieve` returns both. Every
   rewrite drops the previous references, with the gate on or off, so references never outlive the
   version of the value they belong to; other metadata keys are kept as before. With the gate off
   a supplied reference is not stored and the response says so. The gate controls only whether new
   references are accepted: reading, stripping and withdrawal do not depend on it. Metadata is not embedded, so none of
   this is a retrieval-geometry change.
2. **No new Source store.** The trajectory tables are the Source layer. Operator dialogue is not
   added to them by this record; widening what the recorder captures is a separate decision under
   ADR-2015's privacy invariant.
3. **Across the boundary, a commitment and never a reference.** No reference, trajectory id or
   memory key may appear in a vault page, a `vault propose` payload, a pod document, a relay event
   or a federation message. Where an outward artefact needs to show that evidence exists, it carries
   a salted commitment over the evidence set, issued through `crates/nostr-receipt`, with the salt
   kept inside the container and opened only to settle a dispute. No new commitment construction is
   written for this. Carrying that commitment in vault page provenance is a change to the governed
   write path and needs its own record in the ADR-2107 and ADR-2109 line.
4. **Evidence references are an aid to reading, not an attestation.** The trajectory recorder is a
   hook the agent can reach, so a reference shows what an entry says it was written from and
   nothing stronger. No document may describe it as tamper-evident provenance.
5. **An end-to-end fixture, registered before it runs** (`scripts/memory-qa-harness.mjs`). Frozen
   questions with gold answers over the live store are answered by four arms: no memory (the
   control), one `memory_search`, iterative reading (search, retrieve, answer), and iterative
   reading with consolidated topic entries that cite their dated notes. The topic entries are an
   overlay held in the fixture; the harness connects read-only and writes nothing to the store. The
   judge is deterministic: the normalised gold string must occur in the answer. Parameters, prompts,
   judge, statistics and floors live in one module, `scripts/lib/memory-qa-protocol.mjs`. The
   registration record commits to that module's digest and the fixture's digest, and a run is
   refused unless the record is committed and both digests match. A floor is never moved: a change
   is a new protocol version. A comparison clears only when it reaches its point floor and the exact
   McNemar test gives p at most 0.05; reaching the point floor without that is inconclusive, which
   is not a pass. The fixture holds private memory content, so it stays under the gitignored data
   directory and every prompt goes to a local model. This adds a measure and does not replace
   invariant 6.
6. **Read guidance follows the measurement.** The memory-curator agent and the instruction tier
   gain iterative-read guidance only if iterative reading clears its registered floor over one-shot
   search.
7. **Withdrawal is exact; erasure of a disclosure is not claimed.** Deleting a cited entry and
   replacing every reference to it are one statement, in the memory server and in the management
   API's adapter, whatever the gate says. The replacement is a marker holding the
   withdrawal time and nothing else, because the key of a deleted entry is part of what was deleted;
   the citing entry is flagged `evidence_state: partial`. Every TTL sweep then withdraws each
   reference whose source no longer exists. That is what covers a pruned trajectory step, an entry
   removed by a bulk ingest's own delete, and an entry deleted in the one round trip between
   resolution and write. What a summary already
   says, and what already left through a hosted model call or the session mirror, is not recalled.
   The gate may not be switched on in a deployment that takes erasure requests until ADR-2060's
   tombstone reaches citing entries.
8. **No stays-on-premises claim.** Citable sources do not change what leaves the container, and
   nothing here supports a statement that records remain on premises.
9. **Reads are counted in a side table, never on the row** (gate
   `[integrations.ruvector_external].read_counts`, env `RUVECTOR_READ_COUNTS`). 94% of updates to
   `memory_entries` are not HOT (56,609 HOT of 1,011,614, measured 2026-11-13), so a counter on the
   row would insert into the HNSW index on almost every read. `memory_reads (namespace, key,
   action, n, first_at, last_at)` counts `retrieve` and `search_hit` apart. The recorder is not
   awaited and never throws. Counters are removed with the entry they describe. The table is not
   granted to `ruvector_reader`; a grant is a new record under invariant 13.
10. **Consolidation is decided by the fixture.** The measurements in Context close the question of
    RuVector as an index over the vault. Whether a job that maintains topic entries over the dated
    log is built depends on the consolidated arm clearing its floor over iterative reading on
    latest-state questions without costing more than five points on single-note questions.

Considered and rejected: readable evidence links in vault provenance (they publish pointers into
private sessions); a typed schema for memory entries (the measured loss is in evidence and access,
not in structure); a second store for raw interactions (the trajectory tables already exist);
maintaining `access_count` (clause 9); a model judge for the fixture (a hosted one sends private
memory out, a local one is the same model that answers).

Deferred: evidence edges in the host project's memory explorer.

## Consequences

- An entry can be checked against what it was written from, which today needs a manual search.
- `memory_store` gains two rejection paths. A writer citing a pruned trajectory step gets a refused
  write, so the retention of trajectory steps becomes something memory depends on.
- Deleting a source now has dependants. Until ADR-2060 lands this widens D5 instead of narrowing
  it, which is why clause 7 blocks activation where erasure requests apply.
- Every delete now also probes the metadata index for citing entries, and every sweep runs the
  reconcile.
- A reference resolves across namespaces, so a writer can learn whether a key exists in a
  namespace by citing it. Namespaces are not an access boundary in this store, so this discloses
  nothing a `memory_retrieve` would not.
- Read counting is best-effort: at most 64 counter writes wait behind the one in flight and the
  rest are dropped, and a role that cannot create the table pauses counting for five minutes.
- The fixture occupies the local model for the length of a run. Its questions and topic entries are
  written by the model that answers, and topic entries exist only for the clusters the latest-state
  questions come from, so the consolidated comparison is an upper bound.
- `memory_hybrid_search` and `memory_orient` hits are not counted by clause 9.
- Vault pages gain no provenance from this record. That stays open until the outward record in
  clause 3 is written.

## Open before activation

- **`.env.example` lacks both variables.** Add `RUVECTOR_EVIDENCE_REFS=false` and
  `RUVECTOR_READ_COUNTS=true` beside `RUVECTOR_TYPED_METADATA`. They were not added with this
  change because agent sessions are denied access to that file. Every other projection point is
  wired (manifest, default manifest, schema, custody classes, catalogue check, boot projection).
- **Neither gate has run in a container.** Both take effect at the next image build.
- **The ADR index does not list this record.** `adr-index-gen` fails on 50 validation errors that
  predate it.

## Verification

Clauses 1, 5, 7 and 9 are implemented and gated; clauses 3 and 6 are not built. The live
`agentbox.toml` sets `read_counts = true` and `evidence_refs = false`; both take effect at the next
image build, because the memory server runs from the baked tree.

- `node mcp/servers/lib/memory-evidence.test.js` (20) and `node mcp/servers/lib/memory-reads.test.js`
  (14): validation, rejection, gate-off behaviour, withdrawal and the fail-open recorder, against a
  scripted pool. `node mcp/servers/lib/memory-tools.test.js` (35) is unchanged.
- `node tests/integration/memory-evidence-sql.check.cjs`: the same paths on the live Postgres
  engine against temporary tables that shadow the real ones inside a rolled-back transaction,
  including the gate-off and typed-metadata-off cases from the review. It establishes that the
  statements are valid and behave as specified; it does not exercise the
  `ruvector` vector type or the live tables.
- `node --test tests/memory-qa-protocol.spec.mjs` (22): the judge, fixture validation, digest,
  reply parsing, the exact McNemar values, the three-valued verdict and the binding of a resumed
  run to its fixture, code and model.
- An independent review (same model family, so not the cross-vendor audit) reported seven defects
  and five suspicions on 2026-11-13. Fixed with a failing test first: a resumed run trusted a
  foreign results file; the registration did not cover the harness, the store read path or the
  answering model; a rewrite with typed metadata off dropped an earlier TTL and tags; resolution
  ran before the embedding call; with the gate off a delete left references in place and a rewrite
  left stale ones; the reconcile failed without `trajectory_steps` and could overwrite a concurrent
  rewrite; the read recorder could queue without bound and retried a failing `CREATE TABLE` on
  every read. Accepted and stated above: the cross-namespace existence check, the single-commit
  registration rule not detecting an amended unshared commit, the live corpus under the fixture,
  and no multiplicity correction across the two floors.
- Not established: behaviour of either gate in a running container, and anything about clause 3.
  The registered fixture run is recorded in `docs/LEARNING-memory.md` when it completes.
