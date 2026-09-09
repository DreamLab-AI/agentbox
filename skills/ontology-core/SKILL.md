---
name: ontology-core
description: "Author the vault knowledge-graph ontology (OntologyBlock entries) for OWL2 DL / VisionClaw. Use when writing or fixing OntologyBlock entries, sanitizing IRI local names or literals, resolving Turtle prefix-not-bound errors, or validating the 6 narrativegoldmine source-domain prefixes (ai/bc/mv/rb/tc/ngm). This is the data/build layer — not ontology-enrich (validate existing data) or ontology-augment (query the live OWL graph). Note: TTL/output/ontology.ttl export is not yet ported to the Rust ontology-tools crate (see below) — do not promise a working export from this skill until that lands."
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
2. Author blocks to the gold-standard shape. Target output remains a single
   `output/ontology.ttl` (git handles versioning — no `-v14` filenames) once
   an exporter exists (see below).
3. Keep `@prefix` declarations at line 1 and `source-domain` to one of the 6
   valid prefixes below.

Note: `ontology-tools` parses vault markdown `OntologyBlock` property blocks
and validates OWL2 *functional-syntax* axioms embedded in ```clojure fences —
it is not an OWL/DL parser or reasoner.

**TTL export is currently blocked.** The Python `Ontology-Tools/tools/converters/convert-to-turtle.py`
converter this workflow used to reference does not exist anywhere in this
checkout (verified 2026-09-09). The Rust `ontology-tools` crate that replaced
the retired Python tooling has no TTL/turtle export subcommand either — its
full command surface is `parse | validate | roundtrip | modify | links |
enrich | batch-enrich` (verified against `ontology-tools --help`, 2026-09-09).
No other TTL/Turtle exporter was found under `services/` or `scripts/`. Until
one is built, treat `output/ontology.ttl` generation as unavailable rather
than following a workflow step that shells to a nonexistent path — the
natural home for a future `ontology-tools export-ttl` subcommand is this
same Rust crate (`services/ontology-tools`), given it already owns parsing
and validation of the same OntologyBlock data.

## Valid source-domain prefixes

Only these 6 values are valid; anything else must be fixed in source (e.g.
`blockchain` → `bc`, `metaverse` → `mv`, `telecollaboration` → `tc`):

`ai` · `bc` · `mv` · `rb` · `tc` · `ngm` — all under `http://narrativegoldmine.com/…#`.

Full namespace table, OntologyBlock gold-standard format, TTL sanitization code,
the error→fix catalog, and cross-cutting-domain rules live in
[references/ttl-authoring.md](references/ttl-authoring.md).

## References

- Detailed authoring & TTL rules: [references/ttl-authoring.md](references/ttl-authoring.md)
- OntologyBlock parser/validator/modifier binary: `services/ontology-tools` (standalone Rust crate; `ontology-tools --help`, or `cd services/ontology-tools && cargo run -- --help`)
- TTL/Turtle export: not yet ported (no Python converter exists in this checkout; the Rust crate above has no export subcommand) — see the note above
