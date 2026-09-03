//! Configuration as a file, layered under the command-line flags.
//!
//! A house style is a property of a repository, not of one invocation, so it
//! belongs in a file that is committed next to the prose. This module owns the
//! file *format* and the merge order; it deliberately does not read the file,
//! because this crate touches no filesystem. The CLI finds the file and hands
//! the text here.
//!
//! # Precedence
//!
//! Later wins: **built-in defaults → configuration file → command-line flags**.
//! Every field in the file is optional, so a file that sets one key changes one
//! thing and inherits the rest.
//!
//! # Format
//!
//! ```toml
//! # .prose-sanitiser.toml
//! write = false             # permit high-confidence-stylistic fixes
//! min_severity = "medium"   # drop low-severity findings from the report
//! oxford = false            # -ise rather than Oxford -ize
//! language_filter = true    # skip non-English paragraphs
//! suppressions = true       # honour the HTML-comment directives
//! disabled_rules = ["us-spelling", "hedge-words"]
//! ```
//!
//! # Examples
//!
//! ```
//! use prose_sanitiser_core::{ConfigFile, Config, Severity};
//!
//! let file = ConfigFile::from_toml_str(r#"
//!     min_severity = "high"
//!     disabled_rules = ["us-spelling"]
//! "#).unwrap();
//!
//! let config = file.merge_into(Config::new());
//! assert_eq!(config.min_severity, Severity::High);
//! assert!(!config.rule_enabled("us-spelling"));
//! // Unset keys keep their defaults.
//! assert!(!config.write);
//! ```

use serde::Deserialize;

use crate::finding::{Config, Severity};
use crate::language::LanguageFilter;

/// The file names the CLI looks for, in order.
pub const CONFIG_FILE_NAMES: [&str; 2] = [".prose-sanitiser.toml", "prose-sanitiser.toml"];

/// A parsed configuration file. Every field is optional.
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ConfigFile {
    /// Permit fixes for high-confidence-stylistic findings.
    pub write: Option<bool>,
    /// Drop findings below this severity: `high`, `medium` or `low`.
    pub min_severity: Option<String>,
    /// Use Oxford `-ize` spelling.
    pub oxford: Option<bool>,
    /// Skip paragraphs the language filter does not read as English.
    pub language_filter: Option<bool>,
    /// Honour the HTML-comment suppression directives.
    pub suppressions: Option<bool>,
    /// Rules to skip entirely.
    pub disabled_rules: Option<Vec<String>>,
}

/// Why a configuration file could not be used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigError {
    /// The TOML did not parse, or carried a key this tool does not know.
    Parse(String),
    /// A key parsed but its value is not one this tool accepts.
    Value(String),
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::Parse(detail) => write!(f, "cannot parse configuration: {detail}"),
            ConfigError::Value(detail) => write!(f, "invalid configuration value: {detail}"),
        }
    }
}

impl std::error::Error for ConfigError {}

impl ConfigFile {
    /// Parse TOML text.
    ///
    /// Unknown keys are an error rather than a silent no-op: a typo in a style
    /// file that quietly does nothing is worse than one that says so.
    pub fn from_toml_str(text: &str) -> Result<Self, ConfigError> {
        let parsed: Self =
            toml::from_str(text).map_err(|error| ConfigError::Parse(error.to_string()))?;
        // Validate now rather than at merge time, so a bad value is reported
        // against the file rather than surfacing later as a silent default.
        if let Some(severity) = &parsed.min_severity {
            if Severity::parse(severity).is_none() {
                return Err(ConfigError::Value(format!(
                    "min_severity must be high, medium or low, not {severity:?}"
                )));
            }
        }
        Ok(parsed)
    }

    /// Layer this file over `base`, returning the merged configuration.
    ///
    /// Unset fields leave `base` untouched. `disabled_rules` replaces rather
    /// than extends: a file that lists the rules it wants off should be the
    /// whole answer, not half of one.
    pub fn merge_into(&self, base: Config) -> Config {
        let mut config = base;
        if let Some(write) = self.write {
            config.write = write;
        }
        if let Some(severity) = self.min_severity.as_deref().and_then(Severity::parse) {
            config.min_severity = severity;
        }
        if let Some(oxford) = self.oxford {
            config.oxford = oxford;
        }
        if let Some(enabled) = self.language_filter {
            config.language = if enabled {
                LanguageFilter::new()
            } else {
                LanguageFilter::disabled()
            };
        }
        if let Some(suppressions) = self.suppressions {
            config.suppressions = suppressions;
        }
        if let Some(rules) = &self.disabled_rules {
            config.disabled_rules = rules.clone();
        }
        config
    }
}

#[cfg(test)]
mod tests;
