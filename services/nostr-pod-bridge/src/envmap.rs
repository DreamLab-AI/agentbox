//! A snapshot of the process environment, taken once and passed explicitly.
//!
//! The `bootstrap` and `session-summary` subcommands are ports of Python
//! scripts that read `os.environ` ad hoc from deep inside their call graphs.
//! Reproducing that with `std::env::var` would make the behaviour untestable:
//! Rust runs unit tests as threads of one process, so a test that sets an env
//! var races every other test in the binary (and `std::env::set_var` is unsafe
//! from Rust 2024 for exactly that reason).
//!
//! Taking the environment as an explicit value instead keeps every gate,
//! precedence rule, and default directly exercisable from a literal map, with
//! no global state and no test-ordering constraints.

use std::collections::HashMap;

/// An owned snapshot of environment variables.
#[derive(Debug, Clone, Default)]
pub struct EnvMap(HashMap<String, String>);

impl EnvMap {
    /// Snapshot the real process environment.
    pub fn from_process() -> Self {
        Self(std::env::vars().collect())
    }

    /// Look up a variable, returning `None` when unset.
    ///
    /// Note this does *not* collapse the empty string to `None`: the Python
    /// originals distinguish "unset" from "set but empty" in some places and
    /// not others, so each call site opts in via [`EnvMap::non_empty`].
    pub fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).map(String::as_str)
    }

    /// Look up a variable, treating the empty string as unset — CPython's
    /// `os.environ.get(k)` truthiness test, which every gate in the originals
    /// uses (`if v:` / `all(os.environ.get(k) for k in …)`).
    pub fn non_empty(&self, key: &str) -> Option<&str> {
        self.get(key).filter(|v| !v.is_empty())
    }

    /// First non-empty value among `keys` — the ported `env_first` helper.
    /// Returns `""` when none is set, matching the Python contract.
    pub fn first(&self, keys: &[&str]) -> &str {
        keys.iter()
            .find_map(|k| self.non_empty(k))
            .unwrap_or_default()
    }

    /// Value of `key`, or `fallback` when unset or empty.
    pub fn or(&self, key: &str, fallback: &str) -> String {
        self.non_empty(key).unwrap_or(fallback).to_string()
    }
}

impl<K: Into<String>, V: Into<String>> FromIterator<(K, V)> for EnvMap {
    fn from_iter<I: IntoIterator<Item = (K, V)>>(iter: I) -> Self {
        Self(
            iter.into_iter()
                .map(|(k, v)| (k.into(), v.into()))
                .collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> EnvMap {
        EnvMap::from_iter([("SET", "value"), ("EMPTY", "")])
    }

    #[test]
    fn get_distinguishes_unset_from_empty() {
        let env = sample();
        assert_eq!(env.get("SET"), Some("value"));
        assert_eq!(env.get("EMPTY"), Some(""));
        assert_eq!(env.get("MISSING"), None);
    }

    #[test]
    fn non_empty_collapses_the_empty_string() {
        let env = sample();
        assert_eq!(env.non_empty("SET"), Some("value"));
        assert_eq!(env.non_empty("EMPTY"), None);
        assert_eq!(env.non_empty("MISSING"), None);
    }

    #[test]
    fn first_skips_empty_and_missing() {
        let env = sample();
        assert_eq!(env.first(&["EMPTY", "SET"]), "value");
        assert_eq!(env.first(&["MISSING", "EMPTY"]), "");
    }

    #[test]
    fn or_falls_back_for_empty_and_missing() {
        let env = sample();
        assert_eq!(env.or("SET", "fb"), "value");
        assert_eq!(env.or("EMPTY", "fb"), "fb");
        assert_eq!(env.or("MISSING", "fb"), "fb");
    }
}
