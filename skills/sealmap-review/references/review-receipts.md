# Evidence receipts beside the original review

The review export is the reviewer's original claim. Preserve it, the exact pack,
raw reply and run manifest. Assessments go in an adjacent receipt checked by
Sealmap's Rust `review` module; there is no second JavaScript evidence validator
and no new database.

```sh
sealmap review init docs/review/2026-11-03-glm.json \
  --out docs/review/2026-11-03-glm.receipts.json
sealmap review check docs/review/2026-11-03-glm.receipts.json --json
sealmap review summary docs/review/2026-11-03-glm.receipts.json --json
```

The cadence wrapper delegates verbatim:

```sh
node skills/sealmap-review/scripts/review-cadence.cjs receipts check \
  docs/review/2026-11-03-glm.receipts.json --json --require-resolved
```

A missing/old Sealmap binary is an unavailable check, never a pass. The wrapper
preserves the CLI's exit status. Generation of scheduled review hypotheses does
not require a receipt to exist.

`init` records the original JSON SHA-256 and creates unverified entries. Fill in
only evidence you have. Paths are relative to the receipt's evidence root (its
parent by default); absolute paths, parent traversal and symlink escape are
refused. Store relevant raw evidence within that root and record its exact hash.
The checker does not run commands listed in a receipt.

Each disposition names the original finding ID, a status, reason, evidence and
independently evidenced delivery stages:

- `unverified`: no completed assessment.
- `confirmed`: a scoped product failure, with a successful control for an
  executable reproduction.
- `rejected`: counterevidence contradicts the claim.
- `known`: accepted risk with an explicit authority and decision record.
- `inconclusive`: prerequisites failed, the observation was wrong, runtime access
  is unavailable, or evidence otherwise cannot resolve the claim.

Evidence distinguishes execution, source trace, counterexample and acceptance.
Record the exact repository revision, configuration/features, timestamp, raw
artefact hash and observed effect. Executions name the command; relevant consumer
boundaries also name the consumed version/source and lockfile evidence. A dirty
checkout needs its captured working-tree artefact. Source review does not claim
runtime reproduction.

Delivery entries independently record `source`, `tested`, `merged`, `published`,
`adopted` or `deployed`, with a target and evidence. No stage implies another.
A matching hash or valid receipt establishes evidence integrity and consistency,
not truth of every claim. `--require-resolved` additionally refuses unresolved
findings; it does not force acceptance or rejection.

Legacy reviews need no fabricated origin metadata. Initialise a receipt beside
the existing raw file and enter only independently established dispositions.
Legacy findings remain uncorroborated during multi-family merge when comparable
pack/model provenance is absent. Do not overwrite original findings with a new
run ID or change all statuses because a cumulative export has a fresh timestamp.

For the actual investigation method and cross-repository lessons, use
[visioncraft: review evidence](../../visioncraft/references/review-evidence.md).
