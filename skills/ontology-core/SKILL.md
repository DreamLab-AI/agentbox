---
name: ontology-core
description: "Author and export the vault knowledge-graph ontology to OWL2 DL Turtle for WebVOWL/VisionClaw. Use when writing or fixing OntologyBlock entries, generating or debugging output/ontology.ttl, sanitizing IRI local names or literals, resolving Turtle prefix-not-bound errors, or validating the 6 narrativegoldmine source-domain prefixes (ai/bc/mv/rb/tc/ngm). This is the data/build layer — not ontology-enrich (validate existing data) or ontology-augment (query the live OWL graph)."
version: 2.0.0
author: Claude Code
tags: [ontology, owl2, vault, obsidian, ttl, webvowl, validation]
---

# Ontology Core Library

Foundation for vault ontology manipulation with OWL2 DL TTL export — parsing,
validation, and Turtle generation for the authored corpus under `$VAULT_PAGES`
(the `[vault]` path authority, ADR-2028), targeting VisionClaw/WebVOWL
compatibility. The parser still accepts legacy Logseq property blocks on read
during the bounded transition window (VAULT-corpus-format Invariant 6).

## When to use

- Writing or fixing `OntologyBlock` entries in the vault corpus.
- Generating `output/ontology.ttl` or debugging a Turtle parse error.
- Sanitizing IRI local names / literals, or resolving a `Prefix … not bound` error.
- Validating that `source-domain` uses one of the 6 valid prefixes.

## When not to use

- Enriching or validating existing ontology data → use `ontology-enrich`.
- Grounding reasoning in / querying the live DreamLab OWL graph → use `ontology-augment`.
- General knowledge-graph work unrelated to the vault ontology/OWL2 → use standard RDF tools.
- VisionClaw graph rendering → this is the data layer, not the display layer.

## Quick path

1. Parse / edit blocks with the `ontology-tools` Rust binary
   (`services/ontology-tools`, built from `agentbox.toml`'s Rust toolchain):
   - `ontology-tools parse <file>` — read OntologyBlock structures, print as JSON
   - `ontology-tools modify <file> --set field=value` — field-preserving
     edits with automatic backup and OWL2-validated rollback
   - `ontology-tools validate <file>` — OWL2 functional-syntax axiom validation
   - `ontology-tools roundtrip <file>` — verify the zero-data-loss
     parse/write/parse contract for a specific file
2. Author blocks to the gold-standard shape and export to a single
   `output/ontology.ttl` (git handles versioning — no `-v14` filenames).
3. Keep `@prefix` declarations at line 1 and `source-domain` to one of the 6
   valid prefixes below.

Note: `ontology-tools` parses vault markdown `OntologyBlock` property blocks
and validates OWL2 *functional-syntax* axioms embedded in ```clojure fences —
it is not an OWL/DL parser or reasoner. TTL export/conversion is a separate
concern, handled by the `Ontology-Tools/tools/converters/convert-to-turtle.py`
converter referenced below.

## Valid source-domain prefixes

Only these 6 values are valid; anything else must be fixed in source (e.g.
`blockchain` → `bc`, `metaverse` → `mv`, `telecollaboration` → `tc`):

`ai` · `bc` · `mv` · `rb` · `tc` · `ngm` — all under `http://narrativegoldmine.com/…#`.

Full namespace table, OntologyBlock gold-standard format, TTL sanitization code,
the error→fix catalog, and cross-cutting-domain rules live in
[references/ttl-authoring.md](references/ttl-authoring.md).

## References

- Detailed authoring & TTL rules: [references/ttl-authoring.md](references/ttl-authoring.md)
- OntologyBlock parser/validator/modifier binary: `services/ontology-tools` (standalone Rust crate; `cd services/ontology-tools && cargo run -- --help`)
- Converter: `Ontology-Tools/tools/converters/convert-to-turtle.py`
- Parser: `Ontology-Tools/tools/lib/ontology_block_parser.py`
- Loader: `Ontology-Tools/tools/lib/ontology_loader.py`
