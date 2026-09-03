//! Result types shared by `search`/`search_stack`: [`OrderedRow`] (one CSV result
//! row) and [`SearchOutcome`] (the success/error shapes `core.py`'s `search`/
//! `search_stack` return as plain dicts).

use serde::ser::{Serialize, SerializeMap, Serializer};

/// One result row, preserving the exact column order of the domain/stack's
/// `output_cols` list (filtered to columns actually present in the CSV row) —
/// mirrors `{col: row.get(col, "") for col in output_cols if col in row}` in
/// `core.py`. Kept as an ordered `Vec` (not a `HashMap`) specifically so JSON/text
/// output preserves that order without needing serde_json's `preserve_order`
/// feature: we serialize the pairs directly via `serialize_map`, controlling
/// key order ourselves regardless of any map's internal iteration order.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OrderedRow(pub Vec<(String, String)>);

impl OrderedRow {
    pub fn get(&self, key: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.0.iter().map(|(k, v)| (k.as_str(), v.as_str()))
    }
}

impl Serialize for OrderedRow {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (k, v) in &self.0 {
            map.serialize_entry(k, v)?;
        }
        map.end()
    }
}

/// Outcome of `search`/`search_stack`, mirroring the shape (and exact JSON key
/// order) of the plain dicts `core.py` returns for each branch.
#[derive(Debug, Clone)]
pub enum SearchOutcome {
    Domain {
        domain: String,
        query: String,
        file: String,
        count: usize,
        results: Vec<OrderedRow>,
    },
    Stack {
        stack: String,
        query: String,
        file: String,
        count: usize,
        results: Vec<OrderedRow>,
    },
    /// `search()` when `filepath.exists()` is false: `{"error": ..., "domain": domain}`.
    DomainError { error: String, domain: String },
    /// `search_stack()` when the stack name itself is unknown: `{"error": ...}`.
    StackUnknownError { error: String },
    /// `search_stack()` when the stack is known but its file is missing:
    /// `{"error": ..., "stack": stack}`.
    StackFileError { error: String, stack: String },
}

impl SearchOutcome {
    pub fn is_error(&self) -> bool {
        matches!(
            self,
            SearchOutcome::DomainError { .. }
                | SearchOutcome::StackUnknownError { .. }
                | SearchOutcome::StackFileError { .. }
        )
    }
}

impl Serialize for SearchOutcome {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            SearchOutcome::Domain {
                domain,
                query,
                file,
                count,
                results,
            } => {
                let mut map = serializer.serialize_map(Some(5))?;
                map.serialize_entry("domain", domain)?;
                map.serialize_entry("query", query)?;
                map.serialize_entry("file", file)?;
                map.serialize_entry("count", count)?;
                map.serialize_entry("results", results)?;
                map.end()
            }
            SearchOutcome::Stack {
                stack,
                query,
                file,
                count,
                results,
            } => {
                let mut map = serializer.serialize_map(Some(6))?;
                map.serialize_entry("domain", "stack")?;
                map.serialize_entry("stack", stack)?;
                map.serialize_entry("query", query)?;
                map.serialize_entry("file", file)?;
                map.serialize_entry("count", count)?;
                map.serialize_entry("results", results)?;
                map.end()
            }
            SearchOutcome::DomainError { error, domain } => {
                let mut map = serializer.serialize_map(Some(2))?;
                map.serialize_entry("error", error)?;
                map.serialize_entry("domain", domain)?;
                map.end()
            }
            SearchOutcome::StackUnknownError { error } => {
                let mut map = serializer.serialize_map(Some(1))?;
                map.serialize_entry("error", error)?;
                map.end()
            }
            SearchOutcome::StackFileError { error, stack } => {
                let mut map = serializer.serialize_map(Some(2))?;
                map.serialize_entry("error", error)?;
                map.serialize_entry("stack", stack)?;
                map.end()
            }
        }
    }
}
