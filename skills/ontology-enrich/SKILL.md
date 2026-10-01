---
name: ontology-enrich
description: "Validate and enrich existing Obsidian ontology pages using the vault CLI. Use for frontmatter conformance, provenance, broken links, semantic conflicts and cross-domain bridges; use ontology-core for new schemas, seed conversion and domain scaffolding."
metadata:
  version: "3.0.0"
---

# Ontology enrichment

Maintain the existing Obsidian corpus through `vault`. Read the repository's
`AGENTS.md`, `vault.toml` and `ontology/vocabulary.yaml`; these govern paths,
frontmatter keys, relation semantics, lifecycle and publication. Check installed
`vault --help` and subcommand help rather than assuming source-code capabilities
are deployed.

## Workflow

1. Establish a baseline with `vault validate` and `vault conflicts`. Capture
   findings by page and target, not just aggregate counts. Existing warnings
   remain outstanding defects; avoid introducing new ones in the batch.
2. Find the existing concept with `vault find`; use `vault retrieve` and
   `vault tree` to inspect related pages. Preserve immutable `resource` IRIs,
   source attribution, publication settings and unrelated content.
3. Research missing claims against attributable sources. Record source links
   in vocabulary-conforming `sources` entries and retain relevant licence and
   attribution details in the body or source manifest. Model-generated prose
   is not verification. Use UK English and distinguish observed facts from
   proposed ontology assertions.
4. Stage complete proposed pages for grouped content or relationship changes.
   Use `vault propose --help` to confirm directory support and creation rules.
   Review `--dry-run` output before any authorised forum publication. For a
   narrow correction, inspect `vault edit <id> --set key=value --expect docs=1
   --dry-run`, then apply the guarded edit within the authorised scope.
5. Validate the complete proposed corpus in an isolated repository overlay;
   check links, semantic conflicts and baseline deltas. Build a fresh generation
   with `vault build --out <directory>` when projection or reasoning changes
   matter, and inspect the affected generated pages and graph edges.

## Link and modelling checks

Resolve a wikilink's target, not its display alias: `[[Radar|SAR]]` points to
`Radar`. Check filename/title/alias resolution through the corpus tools and
inspect ambiguous matches. Do not automatically replace a broken target with
its nearest spelling match or generate a placeholder page to silence a warning.
Check both YAML relation lists and body links, including attachments and links
between pages in the same proposal.

Use only declared relation keys. `is-a` means subclass, `instance-of` types an
individual, and `bridges-to` expresses a cross-domain connection according to
the vocabulary. A useful connection is not evidence of subclassing. Verify
that each bridge has a defensible meaning and that the chosen relation is
actually emitted into the intended consumer; provisional keys may be valid
without appearing in Turtle.

Read [../ontology-core/references/obsidian-authoring.md](../ontology-core/references/obsidian-authoring.md)
for the authoring contract and licensed seed conversion. Use `ontology-core`
for new domains or schema work and `ontology-augment` for live graph queries.

Report pages changed, source evidence, diagnostics fixed or introduced and
unresolved targets. Local validation, a successful build, proposal publication
and consumer deployment are separate outcomes; claim only those verified.
