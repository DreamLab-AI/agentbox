//! `OntologyParser` — parsing half of the zero-data-loss OntologyBlock
//! round trip. Writing lives in [`crate::writer`].
//!
//! Ported from `skills/ontology-core/src/ontology_parser.py`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;

use crate::block::{is_known_field_key, OntologyBlock};
use crate::markdown::{
    extract_block_section, extract_cross_references, extract_owl_axioms, find_wiki_links,
};

/// `^\s*-?\s*([\w:-]+)::\s*(.+)$` — a single `key:: value` property line, with
/// an optional leading `-` bullet.
static PROPERTY_LINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*-?\s*([\w:-]+)::\s*(.+)$").unwrap());

/// `####\s*Relationships\s*\n` — the Relationships section header.
static RELATIONSHIPS_HEADER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"####\s*Relationships\s*\n").unwrap());

/// `\n\s*-\s*####` — terminator for the Relationships section: the next
/// `- ####` sub-heading (e.g. `- #### OWL Axioms`).
static RELATIONSHIPS_TERMINATOR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\n\s*-\s*####").unwrap());

/// `^\s*-\s*([\w-]+)::\s*(.+)$` — a single relationship line. Unlike the
/// generic property line pattern, the leading `-` bullet is REQUIRED here.
static RELATIONSHIP_LINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*-\s*([\w-]+)::\s*(.+)$").unwrap());

/// Parser for OntologyBlock structures with complete field preservation.
///
/// Guarantees:
/// - ALL 17+ fields extracted and preserved
/// - Unknown fields stored in `additional_fields`
/// - Exact field ordering maintained during write (see [`crate::writer`])
/// - Round-trip identity: `parse(write(parse(x))) == parse(x)`
#[derive(Debug, Default, Clone, Copy)]
pub struct OntologyParser;

impl OntologyParser {
    pub fn new() -> Self {
        Self
    }

    /// Parse OntologyBlock with COMPLETE field extraction.
    ///
    /// `content` may be the full markdown file or just the OntologyBlock
    /// section; `file_path` is recorded on the resulting block if given.
    pub fn parse_ontology_block(&self, content: &str, file_path: Option<&Path>) -> OntologyBlock {
        let block_content = extract_block_section(content);
        let properties = Self::extract_properties(&block_content);

        let mut block = OntologyBlock {
            id: properties.get("id").cloned(),
            term_id: properties.get("term-id").cloned(),
            preferred_term: properties.get("preferred-term").cloned(),

            ontology: parse_bool(properties.get("ontology").map(String::as_str)).unwrap_or(true),
            r#type: properties.get("type").cloned(),
            source_domain: properties.get("source-domain").cloned(),
            version: properties.get("version").cloned(),

            status: properties.get("status").cloned(),
            maturity: properties.get("maturity").cloned(),
            quality_score: parse_float(properties.get("quality-score").map(String::as_str)),
            authority_score: parse_float(properties.get("authority-score").map(String::as_str)),
            public_access: parse_bool(properties.get("public-access").map(String::as_str)),
            content_status: properties.get("content-status").cloned(),

            definition: properties.get("definition").cloned(),
            source: properties.get("source").cloned(),

            collapsed: parse_bool(properties.get("collapsed").map(String::as_str)),

            owl_class: properties.get("owl:class").cloned(),
            owl_physicality: properties.get("owl:physicality").cloned(),
            owl_role: properties.get("owl:role").cloned(),

            belongs_to_domain: properties.get("belongsToDomain").cloned(),
            bridges_to_domain: properties.get("bridges-to-domain").cloned(),

            raw_block: block_content.clone(),
            file_path: file_path.map(PathBuf::from),

            ..OntologyBlock::default()
        };

        block.relationships = Self::extract_relationships(&block_content);
        block.owl_axioms = extract_owl_axioms(&block_content);
        block.cross_references = extract_cross_references(&block_content);

        block.additional_fields = properties
            .into_iter()
            .filter(|(k, _)| !is_known_field_key(k))
            .collect::<BTreeMap<_, _>>();

        block
    }

    /// Extract all property lines from an OntologyBlock section.
    ///
    /// Ported from `_extract_properties`. Later lines with the same key
    /// overwrite earlier ones, matching Python dict assignment semantics.
    fn extract_properties(content: &str) -> BTreeMap<String, String> {
        let mut properties = BTreeMap::new();
        for line in content.lines() {
            if let Some(caps) = PROPERTY_LINE_RE.captures(line) {
                let key = caps[1].trim().to_string();
                let value = caps[2].trim().to_string();
                properties.insert(key, value);
            }
        }
        properties
    }

    /// Extract relationships from the `#### Relationships` section.
    ///
    /// Ported from `_extract_relationships`. A relationship line is only
    /// kept if it contains at least one `[[WikiLink]]` target.
    fn extract_relationships(content: &str) -> BTreeMap<String, Vec<String>> {
        let mut relationships = BTreeMap::new();

        let Some(header_m) = RELATIONSHIPS_HEADER_RE.find(content) else {
            return relationships;
        };
        let rest = &content[header_m.end()..];
        let rel_section = match RELATIONSHIPS_TERMINATOR_RE.find(rest) {
            Some(term_m) => &rest[..term_m.start()],
            None => rest,
        };

        for line in rel_section.lines() {
            if let Some(caps) = RELATIONSHIP_LINE_RE.captures(line) {
                let rel_type = caps[1].trim().to_string();
                let targets_str = caps[2].trim();
                let targets = find_wiki_links(targets_str);
                if !targets.is_empty() {
                    relationships.insert(rel_type, targets);
                }
            }
        }

        relationships
    }

    /// Immutable field update: returns a NEW block with `field_name` set to
    /// `value`, leaving `block` untouched.
    ///
    /// Ported from `update_field` (`dataclasses.replace`). Only the known
    /// string-valued fields are settable this way — matching every real
    /// call site in the Python original and its test suite, which never
    /// updates a bool/float/composite field through this path.
    pub fn update_field(
        &self,
        block: &OntologyBlock,
        field_name: &str,
        value: &str,
    ) -> crate::Result<OntologyBlock> {
        let mut updated = block.clone();
        set_str_field(&mut updated, field_name, value)?;
        Ok(updated)
    }

    /// Safely merge updates into an existing block.
    ///
    /// Ported from `merge_blocks`. Guarantees:
    /// - All fields not in `updates` are preserved
    /// - Unknown fields in `updates` go to `additional_fields` (under their
    ///   ORIGINAL, un-normalised key)
    /// - Known fields are matched by normalising `-`/`:` to `_` in the
    ///   update key, exactly as the Python `hasattr` check does — which
    ///   means `belongsToDomain` (no hyphen/colon to normalise) never
    ///   matches the `belongs_to_domain` struct field and always lands in
    ///   `additional_fields`. This is a faithful port of that quirk, not a
    ///   bug introduced here.
    pub fn merge_blocks(
        &self,
        existing: &OntologyBlock,
        updates: &BTreeMap<String, String>,
    ) -> OntologyBlock {
        let mut merged = existing.clone();

        for (key, value) in updates {
            let normalized = normalize_field_key(key);
            if set_typed_field(&mut merged, &normalized, value).is_err() {
                merged.additional_fields.insert(key.clone(), value.clone());
            }
        }

        merged
    }
}

/// `key.replace('-', '_').replace(':', '_')` — the normalisation Python's
/// `merge_blocks` applies before checking `hasattr`.
fn normalize_field_key(key: &str) -> String {
    key.replace(['-', ':'], "_")
}

/// Parse a boolean from string, matching `_parse_bool`: `true`/`yes`/`1` ->
/// `Some(true)`; `false`/`no`/`0` -> `Some(false)`; anything else (including
/// `None`) -> `None`.
pub fn parse_bool(value: Option<&str>) -> Option<bool> {
    let value = value?.to_lowercase();
    let value = value.trim();
    match value {
        "true" | "yes" | "1" => Some(true),
        "false" | "no" | "0" => Some(false),
        _ => None,
    }
}

/// Parse a float from string, matching `_parse_float`: returns `None` on any
/// parse failure or missing input, rather than erroring.
pub fn parse_float(value: Option<&str>) -> Option<f64> {
    value?.trim().parse::<f64>().ok()
}

/// Set one of the known STRING fields on a block from a raw CLI-style value,
/// coercing to the field's real type. Returns `Err` for unknown field names.
///
/// Shared by [`OntologyParser::update_field`] (direct struct-field name) and
/// [`set_typed_field`] (already-normalised merge key).
fn set_str_field(block: &mut OntologyBlock, field_name: &str, value: &str) -> crate::Result<()> {
    set_typed_field(block, field_name, value)
}

/// Assign `value` (always a raw string, e.g. from a CLI `--set key=value`
/// flag) into the struct field named by the already-normalised
/// `field_name`, coercing to bool/float where the field demands it.
///
/// Supports exactly the primitive fields that Python's `merge_blocks` /
/// `update_field` are ever exercised against (see module docs on
/// `merge_blocks` for the deliberately-unsupported `belongsToDomain` case,
/// and on why composite fields — relationships/owl_axioms/additional_fields/
/// raw_block/file_path/cross_references — are out of scope: no caller in
/// the Python original or its test suite ever updates them this way).
fn set_typed_field(block: &mut OntologyBlock, field_name: &str, value: &str) -> crate::Result<()> {
    match field_name {
        "id" => block.id = Some(value.to_string()),
        "term_id" => block.term_id = Some(value.to_string()),
        "preferred_term" => block.preferred_term = Some(value.to_string()),
        "ontology" => block.ontology = parse_bool(Some(value)).unwrap_or(block.ontology),
        "type" => block.r#type = Some(value.to_string()),
        "source_domain" => block.source_domain = Some(value.to_string()),
        "version" => block.version = Some(value.to_string()),
        "status" => block.status = Some(value.to_string()),
        "maturity" => block.maturity = Some(value.to_string()),
        "quality_score" => block.quality_score = parse_float(Some(value)),
        "authority_score" => block.authority_score = parse_float(Some(value)),
        "public_access" => block.public_access = parse_bool(Some(value)),
        "content_status" => block.content_status = Some(value.to_string()),
        "definition" => block.definition = Some(value.to_string()),
        "source" => block.source = Some(value.to_string()),
        "collapsed" => block.collapsed = parse_bool(Some(value)),
        "owl_class" => block.owl_class = Some(value.to_string()),
        "owl_physicality" => block.owl_physicality = Some(value.to_string()),
        "owl_role" => block.owl_role = Some(value.to_string()),
        "bridges_to_domain" => block.bridges_to_domain = Some(value.to_string()),
        other => return Err(crate::OntologyToolsError::UnknownField(other.to_string())),
    }
    Ok(())
}

/// Read a string-typed field's current value by (already snake_case) field
/// name, for callers that need generic field access (the enrichment
/// workflow's `enrich_field`, and `OntologyModifier::validate_modification`).
pub fn get_str_field(block: &OntologyBlock, field_name: &str) -> Option<String> {
    match field_name {
        "id" => block.id.clone(),
        "term_id" => block.term_id.clone(),
        "preferred_term" => block.preferred_term.clone(),
        "type" => block.r#type.clone(),
        "source_domain" => block.source_domain.clone(),
        "version" => block.version.clone(),
        "status" => block.status.clone(),
        "maturity" => block.maturity.clone(),
        "content_status" => block.content_status.clone(),
        "definition" => block.definition.clone(),
        "source" => block.source.clone(),
        "owl_class" => block.owl_class.clone(),
        "owl_physicality" => block.owl_physicality.clone(),
        "owl_role" => block.owl_role.clone(),
        "bridges_to_domain" => block.bridges_to_domain.clone(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_bool_variants() {
        assert_eq!(parse_bool(Some("true")), Some(true));
        assert_eq!(parse_bool(Some("Yes")), Some(true));
        assert_eq!(parse_bool(Some("1")), Some(true));
        assert_eq!(parse_bool(Some("false")), Some(false));
        assert_eq!(parse_bool(Some("No")), Some(false));
        assert_eq!(parse_bool(Some("0")), Some(false));
        assert_eq!(parse_bool(Some("maybe")), None);
        assert_eq!(parse_bool(None), None);
    }

    #[test]
    fn parse_float_variants() {
        assert_eq!(parse_float(Some("0.96")), Some(0.96));
        assert_eq!(parse_float(Some("1.0")), Some(1.0));
        assert_eq!(parse_float(Some("nope")), None);
        assert_eq!(parse_float(None), None);
    }

    #[test]
    fn merge_blocks_normalizes_hyphen_and_colon_keys() {
        let parser = OntologyParser::new();
        let existing = OntologyBlock::default();
        let mut updates = BTreeMap::new();
        updates.insert("preferred-term".to_string(), "X".to_string());
        updates.insert("owl:class".to_string(), "bc:X".to_string());
        let merged = parser.merge_blocks(&existing, &updates);
        assert_eq!(merged.preferred_term.as_deref(), Some("X"));
        assert_eq!(merged.owl_class.as_deref(), Some("bc:X"));
    }

    #[test]
    fn merge_blocks_belongs_to_domain_lands_in_additional_fields() {
        // Faithful port of the Python quirk: "belongsToDomain" has no
        // hyphen/colon to normalise, so it never matches the
        // `belongs_to_domain` struct field via merge_blocks.
        let parser = OntologyParser::new();
        let existing = OntologyBlock::default();
        let mut updates = BTreeMap::new();
        updates.insert("belongsToDomain".to_string(), "[[AIDomain]]".to_string());
        let merged = parser.merge_blocks(&existing, &updates);
        assert_eq!(merged.belongs_to_domain, None);
        assert_eq!(
            merged.additional_fields.get("belongsToDomain"),
            Some(&"[[AIDomain]]".to_string())
        );
    }
}
