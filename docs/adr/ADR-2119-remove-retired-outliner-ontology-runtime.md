---
id: ADR-2119
title: Remove the retired outliner ontology runtime
date: 2026-10-01
decision_status: proposed
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: commit and rebuild the image; or introduce a corpus writer or output format
repo: agentbox
domain: BASELINE-container
---

# ADR-2119 — Remove the retired outliner ontology runtime

## Context

The authored corpus has migrated to Obsidian-compatible YAML frontmatter.
The independent `ontology-tools` crate still parsed and emitted outliner
OntologyBlocks, remained baked unconditionally, and supplied an obsolete dream
evaluator. Web-summary also advertised an obsolete format alias. Their presence
made the supported authoring path ambiguous during planning for new domains.

## Decision

Remove `services/ontology-tools`, its Nix derivation and package registration.
Use the existing `vault` CLI for corpus authoring, validation, links and builds.
The required ontology dream evaluator exercises the current proposal/apply
boundary; upstream vault tests remain part of its Nix build.
Web-summary supports Obsidian and plain topics, plus Markdown summaries, and
rejects unsupported format names. No compatibility writer or replacement stub
is retained. Historical ADRs and archives remain evidence; unrelated private
outliner notebooks are outside this corpus retirement.

## Consequences

The source tree has one corpus authoring route. Existing container images still
contain the baked executable and require a rebuild to remove it. Neither the
Nix store nor the running container has been modified by this change.
The upstream vault source pin must be reviewed separately when deploying newer
proposal or creation capabilities; this change does not claim those are live.

The user authorised the retirement. The ledger remains proposed pending a
committed verification anchor: its schema requires an accepted record to name
a verified commit, and these verified working-tree edits are not yet committed.

## Verification

Working-tree checks on 2026-10-01: 29 web-summary Rust tests passed, including
current-format acceptance and obsolete/unknown-format rejection; 59 Node tests
passed for ontology proposal/apply governance. `git diff --check` passed.
No Nix evaluator is installed here, so image evaluation and deployment are
unverified. The installed `ontology-tools` resolves into the immutable Nix
store; it is not evidence of a failed source removal.
