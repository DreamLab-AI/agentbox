---
name: ontology-core
description: "Author Obsidian ontology pages with governed YAML frontmatter, immutable resource IRIs and vault CLI validation/builds. Use for schema planning, licensed seed conversion, new domains and grouped corpus upgrades; use ontology-enrich for existing-page enrichment and ontology-augment for live graph queries."
metadata:
  version: "3.0.0"
---

# Ontology authoring

The corpus uses Obsidian Markdown with one YAML frontmatter block. Read the
selected repository's `AGENTS.md`, `vault.toml` and `ontology/vocabulary.yaml`
before choosing types, lifecycle values, relation keys or identities. Resolve
configured corpus paths through `agentbox.toml` `[vault]`; do not assume that
the current directory is the corpus.

## Capability check

Run `vault --version`, `vault --help` and the relevant subcommand's `--help`.
Installed binaries can lag checked-out source. Confirm creation and directory
proposal support before relying on them. If unavailable, prepare reviewable
Markdown in an isolated staging directory and report the required CLI update;
do not write around the corpus mutation guard.

The supported data/build interface is `vault`. `vault build --out <directory>`
produces a generation including `data/ontology.ttl`, graph/index artefacts and
metadata. Build into a fresh staging destination and inspect diagnostics; a
successful build is not authorisation to publish it.

## Authoring and conversion

1. Search with `vault find`, then inspect neighbourhoods with `vault retrieve`
   and `vault tree`. Reuse existing concepts and their identities. A renamed
   title, new domain or corrected spelling never remints an existing `resource`.
2. For external seeds, record the source URL, release or retrieval date, exact
   licence and attribution requirements before copying content. Keep a source
   manifest with checksums, conversion decisions and source-to-page mappings.
   A repository's code licence does not automatically cover its data or images.
3. Convert seeds into plain Markdown and vocabulary-conforming YAML in a fresh
   directory outside the live corpus. Use `sources` entries (`id`, `resource`)
   for origin links and truthful `generated` metadata. Preserve licence notices
   and attribution in the body or accompanying source manifest; do not invent
   unsupported frontmatter keys. See
   [references/obsidian-authoring.md](references/obsidian-authoring.md).
4. Treat domain membership, subclassing and cross-domain bridges separately.
   Read the vocabulary's semantics and export status for every chosen relation.
   New domain roots may require exporter and explorer changes as well as pages;
   inspect consumers for fixed domain lists. Record significant modelling and
   schema decisions in ADRs alongside the staging plan.
5. Validate the staged corpus overlay, including links between new pages and
   links into existing pages. Run `vault validate` and `vault conflicts` against
   the isolated repository containing the current vocabulary, configuration and
   complete proposed corpus. Compare diagnostics with the unchanged baseline;
   zero errors alone does not establish link integrity or reasoning correctness.
6. Use the installed `vault propose` interface for grouped changes. Start with
   `--dry-run`; inspect the diff and gate outcome. Publishing a proposal sends a
   forum event and is distinct from locally scaffolding a proposal. Follow the
   repository's governance and the user's authorised scope. Schema changes need
   their prescribed governance decision; a page proposal does not itself update
   the vocabulary or deploy consumers.

For a narrow authorised correction use `vault edit <id> --set key=value
--expect docs=1 --dry-run`, review the result, then apply the guarded edit.
Creation uses `vault create` only where the installed CLI exposes it. Preserve
unrelated page content and metadata, and validate the actual resulting files.

## Verification

Exercise a representative slice before bulk conversion: identity collision,
existing-page amendment, new-page links, cross-domain bridge and publication
visibility. Check the generated page API and graph as well as Markdown. Keep
source evidence, baseline deltas and outstanding limitations with the batch;
never mark a generated page verified or stable without the required review.
