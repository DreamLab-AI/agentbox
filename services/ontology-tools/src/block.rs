//! `OntologyBlock` — the zero-data-loss in-memory representation of a vault
//! OntologyBlock markdown section.
//!
//! Ported from `skills/ontology-core/src/ontology_parser.py`. Preserves ALL
//! 17+ metadata fields from ontology pages, with unknown fields captured in
//! `additional_fields` for forward compatibility.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Complete OntologyBlock representation with ZERO field loss.
///
/// Preserves ALL 17+ metadata fields from ontology pages:
/// - Core identification (id, term-id, preferred-term)
/// - Classification (ontology, type, source-domain, version)
/// - Quality metrics (status, maturity, quality-score, authority-score, public-access)
/// - Content (definition, source)
/// - UI state (collapsed)
/// - OWL2 properties (owl:class, owl:physicality, owl:role)
/// - Domain relationships (belongsToDomain, bridges-to-domain)
/// - Semantic relationships (has-part, uses, enables, etc.)
/// - OWL axioms (```clojure blocks)
/// - Cross-references (WikiLinks)
///
/// Unknown fields are preserved in `additional_fields` for forward
/// compatibility.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OntologyBlock {
    // Core identification (CRITICAL)
    /// Legacy Logseq block id (read-tolerance).
    pub id: Option<String>,
    /// Ontology term ID (e.g., BC-0478).
    pub term_id: Option<String>,
    /// Canonical term name.
    pub preferred_term: Option<String>,

    // Classification (CRITICAL)
    /// Always true for ontology pages.
    pub ontology: bool,
    /// Entity type.
    pub r#type: Option<String>,
    /// Domain (blockchain/ai/metaverse/rb/dt).
    pub source_domain: Option<String>,
    /// Version number.
    pub version: Option<String>,

    // Quality metrics (CRITICAL)
    /// Lifecycle status.
    pub status: Option<String>,
    /// Maturity level.
    pub maturity: Option<String>,
    /// Quality metric (0.0-1.0).
    pub quality_score: Option<f64>,
    /// Authority metric (0.0-1.0).
    pub authority_score: Option<f64>,
    /// Publishing flag.
    pub public_access: Option<bool>,
    /// Workflow state.
    pub content_status: Option<String>,

    // Content (CRITICAL)
    /// Semantic definition.
    pub definition: Option<String>,
    /// Citation source.
    pub source: Option<String>,

    // UI state (IMPORTANT)
    /// Legacy Logseq outliner state; written back when present (top-level
    /// `collapsed::` line, alongside `id::`).
    pub collapsed: Option<bool>,

    // OWL2 properties (IMPORTANT)
    /// OWL class (e.g., bc:SmartContract).
    pub owl_class: Option<String>,
    /// Physicality classification.
    pub owl_physicality: Option<String>,
    /// Role classification.
    pub owl_role: Option<String>,

    // Domain relationships (IMPORTANT)
    /// Domain link (raw wiki-link text, e.g. "[[BlockchainDomain]]").
    pub belongs_to_domain: Option<String>,
    /// Cross-domain bridge.
    pub bridges_to_domain: Option<String>,

    /// Semantic relationships extracted from the `#### Relationships` section.
    pub relationships: BTreeMap<String, Vec<String>>,

    /// OWL axioms extracted from ```clojure blocks (one entry per block; each
    /// entry may itself contain embedded newlines).
    pub owl_axioms: Vec<String>,

    /// All WikiLinks found anywhere in the block content.
    pub cross_references: BTreeSet<String>,

    /// Unknown fields, keyed by their raw `key::` name, for forward
    /// compatibility.
    pub additional_fields: BTreeMap<String, String>,

    /// Raw content (for exact reproduction / diagnostics).
    #[serde(default)]
    pub raw_block: String,

    /// Source file location, if known.
    pub file_path: Option<PathBuf>,
}

/// Total number of fields on [`OntologyBlock`]. Mirrors the Python original's
/// `len(vars(updated_block))`, which counts dataclass fields rather than
/// non-empty ones — kept as a named constant here rather than re-derived via
/// reflection, since Rust has no dataclass introspection equivalent.
pub const FIELD_COUNT: usize = 27;

impl OntologyBlock {
    /// Compare two blocks on every MEANINGFUL field, deliberately ignoring
    /// `raw_block` and `file_path`.
    ///
    /// `raw_block` is the verbatim source text a block was parsed from; a
    /// freshly-written block's `raw_block` is the newly generated markdown,
    /// which is never byte-identical to hand-authored source (whitespace,
    /// comment placement, etc. are not reproduced) even when every actual
    /// field survived the round trip losslessly. This is exactly why the
    /// Python original's own round-trip tests compare named fields one by
    /// one rather than `block == block2` — this method is that same
    /// definition of "round-trip identity", as a single call.
    pub fn content_eq(&self, other: &Self) -> bool {
        self.id == other.id
            && self.term_id == other.term_id
            && self.preferred_term == other.preferred_term
            && self.ontology == other.ontology
            && self.r#type == other.r#type
            && self.source_domain == other.source_domain
            && self.version == other.version
            && self.status == other.status
            && self.maturity == other.maturity
            && self.quality_score == other.quality_score
            && self.authority_score == other.authority_score
            && self.public_access == other.public_access
            && self.content_status == other.content_status
            && self.definition == other.definition
            && self.source == other.source
            && self.collapsed == other.collapsed
            && self.owl_class == other.owl_class
            && self.owl_physicality == other.owl_physicality
            && self.owl_role == other.owl_role
            && self.belongs_to_domain == other.belongs_to_domain
            && self.bridges_to_domain == other.bridges_to_domain
            && self.relationships == other.relationships
            && self.owl_axioms == other.owl_axioms
            && self.cross_references == other.cross_references
            && self.additional_fields == other.additional_fields
    }
}

impl Default for OntologyBlock {
    fn default() -> Self {
        Self {
            id: None,
            term_id: None,
            preferred_term: None,
            ontology: true,
            r#type: None,
            source_domain: None,
            version: None,
            status: None,
            maturity: None,
            quality_score: None,
            authority_score: None,
            public_access: None,
            content_status: None,
            definition: None,
            source: None,
            collapsed: None,
            owl_class: None,
            owl_physicality: None,
            owl_role: None,
            belongs_to_domain: None,
            bridges_to_domain: None,
            relationships: BTreeMap::new(),
            owl_axioms: Vec::new(),
            cross_references: BTreeSet::new(),
            additional_fields: BTreeMap::new(),
            raw_block: String::new(),
            file_path: None,
        }
    }
}

/// The complete set of known field keys as they appear in `key:: value`
/// markdown lines (i.e. NOT the Rust struct field names — see
/// `parser::normalize_field_key` for the id mapping used by `merge_blocks`).
pub const KNOWN_FIELD_KEYS: &[&str] = &[
    "id",
    "term-id",
    "preferred-term",
    "ontology",
    "type",
    "source-domain",
    "version",
    "status",
    "maturity",
    "quality-score",
    "authority-score",
    "public-access",
    "content-status",
    "definition",
    "source",
    "collapsed",
    "owl:class",
    "owl:physicality",
    "owl:role",
    "belongsToDomain",
    "bridges-to-domain",
];

pub fn is_known_field_key(key: &str) -> bool {
    KNOWN_FIELD_KEYS.contains(&key)
}
