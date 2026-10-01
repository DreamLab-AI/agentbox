# Obsidian ontology authoring contract

The selected corpus's vocabulary is authoritative. Inspect its `types`,
`identity`, `relations`, `okf` and `validation` sections before conversion;
this reference is workflow guidance, not a second schema.

A knowledge page has one YAML frontmatter block and a readable Markdown body.
Use the required `type`, immutable `resource`, lifecycle `status`, explicit
`public` boolean and truthful `generated.by` / `generated.at` fields. Follow
current validation rules for `title`; do not infer identity from display text.
Represent declared relations as lists of quoted Obsidian wikilinks. Use `sources`
as a list of objects with `id` and `resource`. Use supported aliases for alternate
names. Preserve all existing identities on amendments, including any separate
page identity.

New concepts receive their resource once according to `identity.resource_rule`
and the type's namespace, with collision checks against the complete corpus.
Keep proposed pages draft and private unless the task and governing policy
provide for another state. Do not fabricate human verification records.

For each imported seed, retain:

- Source URL, release/version, retrieval date and content checksum.
- The applicable content licence, licence URL, attribution and notices.
- Which source concept maps to which existing or new immutable resource.
- Conversion decisions, omissions and evidence for each asserted relationship.

Keep source-specific metadata in a batch manifest when the vocabulary does not
support it. Preserve required notices in the distributed content. Separate
source assertions from locally inferred mappings; an external equivalence link
requires stronger evidence than a related-topic link. Validate vocabulary
changes as schema changes before importing pages that depend on new fields.

Validate a staged overlay of the full corpus: an isolated directory containing
`vault.toml`, `ontology/vocabulary.yaml` and the proposed `knowledge/`/`working/`
trees. Run the same `vault validate`, `vault conflicts` and relevant build checks
on the unchanged baseline and overlay. Inspect individual link findings rather
than treating a successful exit as proof that every target resolves. Resolve
aliases and fragments correctly; verify attachment existence and publication
visibility when links will be published.

A new top-level domain can affect taxonomy roots, graph categories, explorer
navigation, search/scaffold indexes and rendering. Inventory those consumers
before release. Promote only a consistent generation after the required corpus
and schema decisions; retain a manifest and rollback reference for each batch.
