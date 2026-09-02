---
id: ADR-2028
title: "`[vault]` in agentbox.toml is the single path authority for the authored corpus; no consumer hard-codes a Logseq path"
date: 2026-09-02
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: [agentbox.toml, setup/agentbox.default.toml, schema/agentbox.toml.schema.json, config/entrypoint-unified.sh, mcp/servers/lib/ontology-local.js, mcp/servers/lib/ontology-index-build.js, scripts/ontology-condense-scheduler.mjs, scripts/ontology-condense-refresh.sh, skills/podcast-knowledge-ingest/SKILL.md, skills/ontology-core/SKILL.md, skills/ontology-enrich/SKILL.md, skills/ontology-augment/SKILL.md, skills/web-summary/SKILL.md]
owner: jjohare
review_trigger: any new skill, MCP server, or supervised program that reads or writes authored markdown
repo: agentbox
domain: BASELINE-container
lineage: ADR-2003 (manifest-driven composition), ADR-2008 (single source of truth + reconciling projector), legacy ADR-113 (condensation trigger on the corpus)
---

# ADR-2028 — `[vault]` is the single path authority for the authored corpus

## Context

Four agentbox surfaces hard-code `/home/devuser/workspace/logseq/...`:
the entrypoint (`config/entrypoint-unified.sh:504`), two MCP server libraries
(`mcp/servers/lib/ontology-local.js:22`, `ontology-index-build.js:15`), the
condensation scheduler, and the `podcast-knowledge-ingest` skill
(`SKILL.md:62-63`). The host project is moving the corpus to an Obsidian vault
(VisionClaw ADR-2040) whose root will be a different directory. Every
hard-coded path is a silent-degradation point: the consumer keeps "working"
against a stale tree.

## Decision

1. `agentbox.toml` gains a top-level `[vault]` section, schema-validated:

   ```toml
   [vault]
   root   = "/home/devuser/workspace/vault"   # Obsidian vault root (bind-mounted)
   pages  = "pages"                            # authored pages, relative to root
   format = "obsidian"                         # obsidian | logseq-legacy (read-tolerance only)
   tui    = "rune"                             # rune | none — see ADR-2029
   ```

2. The entrypoint exports `VAULT_ROOT`, `VAULT_PAGES` (= `root/pages`) and
   `VAULT_FORMAT` from the manifest for every supervised program and every
   tmux window, and derives `ONTOLOGY_PAGES_DIR` from `VAULT_PAGES` (the old
   variable stays as an override for one release).
3. Every consumer listed in `verified_paths` reads `VAULT_PAGES` /
   `VAULT_ROOT`; the former Logseq literals are deleted, not left as fallbacks.
   If `VAULT_ROOT` is unset **and** the manifest lacks `[vault]`, consumers
   log one clear line and disable themselves (fail-loud), mirroring the
   ADR-2004 adapter posture.
4. Skills that write pages (`podcast-knowledge-ingest`, `web-summary`'s
   note-link mode) emit the frontmatter format of the governing doc
   `project/docs/VAULT-corpus-format.md` §V2; `web-summary`'s default
   `format` becomes `obsidian`. The Logseq option remains selectable but is
   documented as legacy.
5. `system-manifest` reports the resolved vault root and format so the
   management API and the doctor can show drift.

## Consequences

- One edit in the manifest relocates the corpus for every agent surface.
- Containers booted without a vault get a visible "vault disabled" line
  instead of quietly indexing an empty or stale directory.
- The skills directory prose (`SKILL-DIRECTORY.md`, the ontology-* skills)
  changes from "Logseq" to "vault" wording; historical archive docs are left
  untouched.

## Verification

`node scripts/system-manifest.mjs` (or the doctor) prints the resolved
`vault.root`; `bash -n config/entrypoint-unified.sh`; a grep gate in
`.github/workflows/invariants.yml` fails on `workspace/logseq` outside
`docs/archive/`. `implementation_status: complete` when the grep gate is
green on the branch.
