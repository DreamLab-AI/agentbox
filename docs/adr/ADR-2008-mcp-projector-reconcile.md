---
id: ADR-2008
title: skills/mcp.json is the MCP source of truth; the projector reconciles (removes stale) rather than appends
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: A managed MCP server appearing in .mcp.json with a failing gate, or an append-only registry edit reappearing
repo: agentbox
domain: BASELINE-container
lineage: legacy ADR-039 (docbox-backported / system-manifest), ADR-011 (consultation MCPs); closes audits MCP-1/MCP-2/MCP-6
---

# ADR-2008 — skills/mcp.json is the MCP source of truth; the projector reconciles rather than appends

## Context
The MCP server registry drifted append-only: servers whose gate later turned off, or whose required
binary/file was absent, lingered in `.mcp.json` (audit MCP-6, add-only rot). A single source of truth
was needed, plus a boot-time step that removes servers that no longer qualify — without clobbering
hand-authored (`bespoke`) or GPU-sidecar (`reference`) entries the projector does not own. Prior
state: ADR-039 (system-manifest / docbox back-port) and ADR-011 (consultation MCPs).

## Decision
The MCP server registry lives in `skills/mcp.json`. At boot a projector upserts only
`projector`-class servers into `.mcp.json`: for each it evaluates the server's `x-agentbox-gate` and
`x-agentbox-requires` (binary on PATH / file present) against the boot env, and REMOVES any managed
server whose gate/requires now fail — this is reconcile, not append. Servers marked `bespoke` or
`reference` are never touched. Net effect on next boot: the projector adds only gated-on, present,
currently-orphaned servers, and no server survives whose gate is off. This forecloses append-only
registry edits and any managed server persisting past its gate.

## Consequences
- The registry self-heals each boot; a gate flipped off removes its server without manual cleanup.
- Hand-authored and sidecar-wrapper servers are safe from the reconciler.
- Cost: a managed server must carry an accurate gate + requires, or it will be removed at boot; the
  projector is the only sanctioned writer of managed entries in `.mcp.json`.

## Verification
implementation_status = complete, established at verified_commit cbe7335b9.
`scripts/project-mcp-servers.mjs:13-20` documents the managed-by-projector contract: evaluate gate
(:14), check requires (:16-17), upsert as reconcile-not-append with failing gate/requires REMOVED
(:19-20). The reconcile loop keys on `def['x-agentbox-managed-by']` (:122); `gateOpen` (:87) and
`requiresMet` (:96) implement the gate/requires evaluation, and non-`projector` classes are left
untouched.
