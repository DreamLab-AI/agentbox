//! `ontology-tools` — vault OntologyBlock markdown parsing, OWL2
//! functional-syntax axiom validation, field-preserving edits, wiki-link
//! validation and Perplexity-backed enrichment for agentbox.
//!
//! This is a Rust port of the `skills/ontology-core` and
//! `skills/ontology-enrich` Python skills. It is deliberately **not** an OWL
//! ontology parser: [`parser`] parses vault markdown `OntologyBlock`
//! property blocks (`- field:: value` lines), and [`validator`] is a
//! regex/structural validator over OWL2 functional-syntax axioms embedded
//! in ```clojure fences — it does not build a DL model or reason over one.
//!
//! The headline contract, carried over verbatim from the Python originals,
//! is **zero data loss**: every known field plus every unknown field
//! (`additional_fields`) survives a parse/write round trip with exact field
//! ordering, i.e. `parse(write(parse(x))) == parse(x)`.

pub mod block;
pub mod enrichment;
pub mod error;
pub mod link_validator;
pub mod markdown;
pub mod modifier;
pub mod parser;
pub mod perplexity;
pub mod validator;
pub mod writer;

pub use block::OntologyBlock;
pub use enrichment::{EnrichmentConfig, EnrichmentResult, EnrichmentWorkflow};
pub use error::{OntologyToolsError, Result};
pub use link_validator::{LinkReport, LinkValidator};
pub use modifier::{ModificationResult, OntologyModifier};
pub use parser::OntologyParser;
pub use perplexity::{Citation, EnrichedContent, PerplexityClient};
pub use validator::{OWL2Validator, ValidationResult};
pub use writer::write_ontology_block;
