//! An insertion-ordered counter with Python `collections.Counter` semantics.
//!
//! `Counter.most_common(n)` sorts by count descending and breaks ties by
//! first-insertion order. Reproducing that ordering keeps `token-audit`'s
//! report rows identical to the Python original's for equal-count entries.

use std::collections::HashMap;

#[derive(Debug, Default, Clone)]
pub struct Counter {
    order: Vec<String>,
    counts: HashMap<String, i64>,
}

impl Counter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&mut self, key: &str, amount: i64) {
        match self.counts.get_mut(key) {
            Some(slot) => *slot += amount,
            None => {
                self.order.push(key.to_string());
                self.counts.insert(key.to_string(), amount);
            }
        }
    }

    pub fn get(&self, key: &str) -> i64 {
        self.counts.get(key).copied().unwrap_or(0)
    }

    pub fn total(&self) -> i64 {
        self.counts.values().sum()
    }

    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }

    pub fn len(&self) -> usize {
        self.order.len()
    }

    /// Keys in first-insertion order.
    pub fn keys(&self) -> impl Iterator<Item = &String> {
        self.order.iter()
    }

    /// Count-descending, ties in insertion order — Python's `most_common`.
    pub fn most_common(&self, limit: usize) -> Vec<(String, i64)> {
        let mut rows: Vec<(usize, String, i64)> = self
            .order
            .iter()
            .enumerate()
            .map(|(i, k)| (i, k.clone(), self.counts[k]))
            .collect();
        rows.sort_by(|a, b| b.2.cmp(&a.2).then(a.0.cmp(&b.0)));
        rows.into_iter()
            .take(limit)
            .map(|(_, k, c)| (k, c))
            .collect()
    }
}

/// The same ordering rules for `f64` weights (cost sums).
#[derive(Debug, Default, Clone)]
pub struct FloatCounter {
    order: Vec<String>,
    counts: HashMap<String, f64>,
}

impl FloatCounter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&mut self, key: &str, amount: f64) {
        match self.counts.get_mut(key) {
            Some(slot) => *slot += amount,
            None => {
                self.order.push(key.to_string());
                self.counts.insert(key.to_string(), amount);
            }
        }
    }

    pub fn get(&self, key: &str) -> f64 {
        self.counts.get(key).copied().unwrap_or(0.0)
    }

    pub fn most_common(&self, limit: usize) -> Vec<(String, f64)> {
        let mut rows: Vec<(usize, String, f64)> = self
            .order
            .iter()
            .enumerate()
            .map(|(i, k)| (i, k.clone(), self.counts[k]))
            .collect();
        rows.sort_by(|a, b| {
            b.2.partial_cmp(&a.2)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.0.cmp(&b.0))
        });
        rows.into_iter()
            .take(limit)
            .map(|(_, k, c)| (k, c))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_accumulate_per_key() {
        let mut c = Counter::new();
        c.add("a", 1);
        c.add("b", 5);
        c.add("a", 2);
        assert_eq!(c.get("a"), 3);
        assert_eq!(c.get("b"), 5);
        assert_eq!(c.get("missing"), 0);
        assert_eq!(c.total(), 8);
        assert_eq!(c.len(), 2);
    }

    #[test]
    fn most_common_sorts_by_count_descending() {
        let mut c = Counter::new();
        c.add("low", 1);
        c.add("high", 10);
        c.add("mid", 5);
        assert_eq!(
            c.most_common(3),
            vec![("high".into(), 10), ("mid".into(), 5), ("low".into(), 1)]
        );
    }

    #[test]
    fn ties_break_on_first_insertion_like_python() {
        let mut c = Counter::new();
        c.add("first", 3);
        c.add("second", 3);
        c.add("third", 3);
        assert_eq!(
            c.most_common(3),
            vec![
                ("first".into(), 3),
                ("second".into(), 3),
                ("third".into(), 3)
            ]
        );
    }

    #[test]
    fn most_common_respects_the_limit() {
        let mut c = Counter::new();
        for (i, k) in ["a", "b", "c", "d"].iter().enumerate() {
            c.add(k, i as i64);
        }
        assert_eq!(c.most_common(2).len(), 2);
    }

    #[test]
    fn an_empty_counter_reports_empty() {
        let c = Counter::new();
        assert!(c.is_empty());
        assert_eq!(c.total(), 0);
        assert!(c.most_common(5).is_empty());
    }

    #[test]
    fn float_counter_orders_by_weight() {
        let mut c = FloatCounter::new();
        c.add("cheap", 0.5);
        c.add("dear", 12.25);
        c.add("cheap", 0.25);
        assert!((c.get("cheap") - 0.75).abs() < 1e-12);
        assert_eq!(c.most_common(1)[0].0, "dear");
    }
}
