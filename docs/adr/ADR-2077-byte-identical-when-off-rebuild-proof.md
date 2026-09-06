---
id: ADR-2077
title: Prove byte-identical-when-off with an actual image rebuild — the procedure, the commands and the receipts
date: 2026-09-05
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: e070514d808b218574403377fb75e0e1a0a256b3
verified_paths: []
owner: jjohare
review_trigger: the next full image rebuild, any new optional gate added to agentbox.toml, or ADR-2020 being asked to move off partial
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2020 (manifest-gated, byte-identical-when-off) — its "Remaining" names this gap and is its ORIGIN, referenced with `see`, superseded by nothing here; ADR-2057 (closed the gate gaps and narrowed the claim to runtime trace, not image closure); ADR-2033 (nodeModulesHash resolved; the image-digest/--diff receipt still outstanding); ADR-039 (apply-class catalogue)
---

# ADR-2077 — Prove byte-identical-when-off with an actual image rebuild

## Context

Diagram **AB-15.1** (`agentbox/15-capability-gating-spend-consultants.md:84`) records that
ADR-2020's byte-identical-when-off half still needs an image rebuild to prove; only the
spend-cap half is verified. ADR-2020 is honest about this — its Remaining section says the
zero-footprint build evidence "still needs an image rebuild to establish" — but an ADR that
names a gap does not close it, and ADR-2020 has been `partial` since 2026-08-31 for exactly
this reason. ADR-2057 narrowed the claim usefully (byte-identical-when-off "holds for
runtime trace but not image closure", since the podcast gate removes the schedule, not the
shared binary) and ADR-2033 removed the last blocker by resolving `nodeModulesHash` to a
real sha256. What is missing is not analysis: it is a rebuild that nobody has run, and a
receipt nobody has written. This record is the procedure, so the next person to run one
produces evidence instead of an anecdote.

## Decision

**Proposed — a procedure ADR.** The byte-identical-when-off guarantee is established by
the run below, or it is not claimed. When executed:

1. **The claim is stated in two parts, separately proved.** *Closure identity*: with a gate
   off, the built image's store closure is byte-identical to the closure built at a commit
   where that gate never existed. *Runtime trace*: with a gate off, no supervised program,
   no `.mcp.json` entry and no process exist for it. ADR-2057 already establishes the
   second for its three gates; only the first is outstanding, and the two must never again
   be reported as one.
2. **The run is done from the host, not from inside the container** (the container's Docker
   socket resolves bind paths against the host, so an in-container build silently bakes
   stale source). The build target is `.#runtime`.
3. **The procedure is exactly this, recorded verbatim in the receipt:**

   ```bash
   # 0. clean tree, note the commit
   git rev-parse HEAD

   # 1. BASELINE — gate off (as shipped)
   nix build .#runtime --print-out-paths        # -> $BASE
   nix path-info --json "$BASE" | jq -r '.[].narHash'

   # 2. DETERMINISM — rebuild from the same source, no cache reuse of the output
   nix build .#runtime --rebuild --print-out-paths   # -> $BASE2
   test "$BASE" = "$BASE2"                      # must hold

   # 3. GATE ON — flip exactly one gate to true in agentbox.toml
   nix build .#runtime --print-out-paths        # -> $ON
   nix store diff-closures "$BASE" "$ON"        # the receipt's core artefact

   # 4. GATE BACK OFF — revert the single edit
   nix build .#runtime --print-out-paths        # -> $OFF
   test "$BASE" = "$OFF"                        # the byte-identical-when-off proof

   # 5. IMAGE DIGEST — nix2container spec digests for the same three builds
   jq -r '.manifest // .config' "$BASE" | sha256sum
   ```
4. **The pass condition is precise.** Step 2 and step 4 must produce the *same store path
   and the same NAR hash* as the baseline. Step 3's `diff-closures` must show **only**
   additions attributable to the flipped gate — any unrelated delta is a failure of the
   guarantee, not noise to be narrated around.
5. **Every optional gate is covered, or the claim is scoped to those that were.** The run
   iterates the gates in the `system-manifest.js` catalogue. A gate that cannot pass
   step 4 — such as the podcast gate, which removes a schedule but leaves a shared binary
   in the closure (ADR-2057) — is recorded as a **named exception** in ADR-2020's decision
   text. A partial pass narrows the claim; it never rounds up to a full one.
6. **The receipt is a file, not a commit message.** It lands in
   `docs/estate-closeout/` alongside the 2026-09-05 receipts (the July `P*-REC-*.md`
   receipts are frozen under `docs/archive/gap-close-evidence/`),
   carrying the commit, the store paths, the NAR hashes, the full `diff-closures` output,
   the per-gate pass/fail table and the exceptions. ADR-2020 then moves to `complete` (or
   stays `partial` with the exception list) with `verified_commit` and `verified_paths` set
   from that run — the ADR's status is changed by the receipt, never ahead of it.
7. **Until the receipt exists, no document claims the guarantee.** ADR-2020,
   `GOVERNANCE-capabilities.md` and the skills tree say the claim is unproven for image
   closure. This prohibition is in force now, before any rebuild.

## Consequences

- A guarantee that has been asserted since 2026-08-31 becomes either evidenced or honestly
  narrowed. Both outcomes are improvements on an unverifiable claim.
- Cost: a full image rebuild (~15 min each, five builds), which must be run from the host
  shell, plus a receipt. It is bounded work that has stalled purely because nobody owned
  the procedure.
- Step 3 will likely find unrelated closure deltas on the first attempt — timestamps,
  incidentally-referenced paths, a gate that pulls a shared dependency. Each one is a real
  finding about the gate mechanism, and the procedure's value is mostly in surfacing them.
- Recording named exceptions (item 5) makes ADR-2020 weaker on paper and stronger in fact.
  The podcast gate is already known to be one.
- This is a verification procedure, not a mechanism change: it adds no gate, no code and no
  runtime behaviour, and it supersedes nothing.

## Verification

`implementation_status: none` — the run has not happened. Verified at
`e070514d808b218574403377fb75e0e1a0a256b3` that it is still outstanding and now unblocked:
ADR-2020's Remaining section states the byte-identical-when-off evidence "still needs an
image rebuild to establish"; ADR-2057's remediation text records that the guarantee "now
holds for runtime trace but not image closure"; `flake.nix:3656` `mkImage` and `:3686`
`runtime = mkImage { tag = "runtime-${system}"; }` are the build target; `flake.nix:440-448`
shows `nodeModulesHash` resolved to a real hash with the comment that the first
`nix build .#runtime` prints it — the blocker ADR-2033 removed.

**Acceptance test.** This ADR is satisfied when a receipt file exists in
`docs/estate-closeout/` that:

1. Names the commit and contains the verbatim command sequence from Decision item 3.
2. Shows `$BASE == $BASE2` and `$BASE == $OFF` by store path **and** NAR hash.
3. Contains the full `nix store diff-closures "$BASE" "$ON"` output for each gate tested,
   with every delta attributed to the flipped gate or listed as an exception.
4. Carries a per-gate table over the `system-manifest.js` catalogue with pass, fail or
   exception for each.
5. Is cited from ADR-2020's `verified_commit`/`verified_paths`, whose
   `implementation_status` then reflects what the receipt actually shows.
6. Leaves no document claiming byte-identical-when-off for a gate the receipt lists as an
   exception.
