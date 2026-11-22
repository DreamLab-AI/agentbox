# Consolidation checkpoint — 2026-11-22

This is a source/Git checkpoint, not a deployment receipt. The prepared image
predating these changes is stale; prepare again before any authorised activation.

## Landed and checked

- Pi's dotenv-template reconciliation and default-off user-cron setup registration
  are on main (`ce4ad917c`, `bfb4e4164`). Setup drift: 8/8 passing.
- StatCraft 0.4.2 and the full-precision numeric accessor patch are merged
  (`47a8be565`). Its standalone Nix build, including the upstream suites and
  four precision regression tests, passed. This did not rebuild the whole image.
- The October 29 stash application had replayed an already-landed session-plane
  migration. All 23 conflicted paths were restored to current main after checking
  the index versions. Its three actual unstaged triage additions already exist
  on main. The original stash and a local conflict-file backup remain available.
- Six container-resident worktrees were locked against host-side pruning. A host
  cannot see their paths and incorrectly calls them prunable. Some contain dirty
  submodules: never use a broad `git worktree prune` as cleanup here.
- Seven unattached branches already ancestral to main were removed locally across
  this checkout and its parent. Their tips remain under
  `refs/archive/2026-11-22/`. Active/attached worktrees were retained.

## Not safe to merge mechanically

| Checkout / branches | Review finding and next gate |
|---|---|
| Agentbox `held/decider-attribution-52358a1a7`, parent `held/decider-attribution-86c6227f2` | Agentbox forwards the authenticated human identity through an agent-key request body; the parent patch strips identity on that transport. Merging both would lose legitimate human attribution/writeback. Agree and test the trusted handoff first; do not trust an arbitrary caller-supplied pubkey. |
| Parent `feat/relation-weight-table` | ADR-2191 explicitly blocks merge: environment-variable physics configuration bypasses ADR-2140's settings authority. Needs the governed settings path and an owner decision about client-writable learned-table permission. No learned table is authorised. |
| Agentbox five `ontomark/*` branches; parent ten `ontomark/*` branches | Parked, intentionally red acceptance tests for migration steps, not evidence that those steps are implemented. The CLI branch also carries prospective authority documentation. Do not merge that documentation as if the migration had landed. |
| Parent `feat/tri-separation` | Substantial cross-client/GPU/XR feature (61 files), not a leftover cosmetic branch. Needs client, Rust, XR and protocol/ADR validation before integration. |
| Parent `fix/onto-sparql` | Valuable pre-query filtering fix; not yet validated in this consolidation. Review dataset semantics, including empty named-graph patterns with `FROM NAMED`, and concurrent-write behaviour before trusting the view. |
| Parent `wip/ontology-query-service` | Changes term resolution and HTTP error semantics plus activation probes. Requires service/integration tests and current API-contract review. |

## Stashes and recovery

All five Agentbox stashes and the parent's historical review stash were retained.
Their tips and each checkout's consolidation starting HEAD also have local
`refs/recovery/2026-11-22/*` refs. These are **local**, not remotely backed up merely
because main is pushed. Older large stashes include superseded dependency and
skill snapshots; applying them wholesale would roll back newer work. Unique
content still needs file-by-file disposition before deleting those stashes.

No container was restarted, no volume removed, and no Nix/Docker cache GC run.
Do not interpret removing a merged local branch name as deleting its commits.
