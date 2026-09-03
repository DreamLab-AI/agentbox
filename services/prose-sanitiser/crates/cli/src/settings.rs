//! Finding and loading the committed configuration file.
//!
//! `prose-sanitiser-core` parses the file format but never reads a file, so
//! that it stays safe to depend on from a library context. This module is the
//! other half: it walks the filesystem, reads the text, and hands it to
//! [`ConfigFile`].
//!
//! # Discovery
//!
//! Starting from the directory of the path being scanned (or the directory
//! itself), each ancestor is searched for `.prose-sanitiser.toml` then
//! `prose-sanitiser.toml`. The first file found wins and the walk stops. That is
//! the git and `.editorconfig` convention: a style is a property of the tree the
//! prose lives in, and the nearest declaration is the most specific one.
//!
//! `--config PATH` skips discovery entirely; a missing file named explicitly is
//! an error, whereas finding no file during discovery is not.
//!
//! # Precedence
//!
//! Built-in defaults, then the file, then the flags. A flag the user did not
//! pass must not overwrite the file, so callers apply flags through
//! [`Settings::apply_flags`] with `Option` values rather than resolved ones.

use std::path::{Path, PathBuf};

use prose_sanitiser_core::{
    CliError, Config, ConfigFile, LanguageFilter, Severity, CONFIG_FILE_NAMES,
};

use crate::exit;

/// A configuration, plus where it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    /// The merged configuration.
    pub config: Config,
    /// The file it was read from, if any.
    pub source: Option<PathBuf>,
}

impl Settings {
    /// Built-in defaults, from no file.
    pub fn defaults() -> Self {
        Self {
            config: Config::new(),
            source: None,
        }
    }

    /// Load `path` explicitly. A missing or malformed file is an error.
    pub fn load(path: &Path) -> Result<Self, CliError> {
        let text = std::fs::read_to_string(path).map_err(|error| {
            CliError::new(
                exit::ERROR,
                format!("cannot read {}: {error}", path.display()),
            )
        })?;
        let file = ConfigFile::from_toml_str(&text)
            .map_err(|error| CliError::new(exit::ERROR, format!("{}: {error}", path.display())))?;
        Ok(Self {
            config: file.merge_into(Config::new()),
            source: Some(path.to_path_buf()),
        })
    }

    /// Search `start` and its ancestors for a configuration file.
    ///
    /// Finding nothing is normal and yields the defaults. Finding a file that
    /// does not parse is an error: a style file that is silently ignored is
    /// worse than one that stops the run.
    pub fn discover(start: &Path) -> Result<Self, CliError> {
        let from = if start.is_dir() {
            start.to_path_buf()
        } else {
            start.parent().unwrap_or(Path::new(".")).to_path_buf()
        };
        let absolute = std::fs::canonicalize(&from).unwrap_or(from);
        for directory in absolute.ancestors() {
            for name in CONFIG_FILE_NAMES {
                let candidate = directory.join(name);
                if candidate.is_file() {
                    return Self::load(&candidate);
                }
            }
        }
        Ok(Self::defaults())
    }

    /// Resolve `--config PATH` if given, otherwise discover from `start`.
    pub fn resolve(explicit: Option<&Path>, start: &Path) -> Result<Self, CliError> {
        match explicit {
            Some(path) => Self::load(path),
            None => Self::discover(start),
        }
    }

    /// Layer command-line flags over the file.
    ///
    /// Every argument is an [`Option`]: `None` means the flag was not passed, so
    /// the file's value survives. A `bool` flag that defaults to false must be
    /// passed as `Some(true)` or `None`, never `Some(false)`, or it will
    /// overwrite a file that asked for true.
    pub fn apply_flags(
        mut self,
        write: Option<bool>,
        min_severity: Option<Severity>,
        oxford: Option<bool>,
        language_filter: Option<bool>,
        suppressions: Option<bool>,
        disabled_rules: &[String],
    ) -> Self {
        if let Some(write) = write {
            self.config.write = write;
        }
        if let Some(severity) = min_severity {
            self.config.min_severity = severity;
        }
        if let Some(oxford) = oxford {
            self.config.oxford = oxford;
        }
        if let Some(enabled) = language_filter {
            self.config.language = if enabled {
                LanguageFilter::new()
            } else {
                LanguageFilter::disabled()
            };
        }
        if let Some(suppressions) = suppressions {
            self.config.suppressions = suppressions;
        }
        for rule in disabled_rules {
            if !self.config.disabled_rules.contains(rule) {
                self.config.disabled_rules.push(rule.clone());
            }
        }
        self
    }

    /// Where the configuration came from, for a `--verbose` line.
    pub fn describe_source(&self) -> String {
        match &self.source {
            Some(path) => path.display().to_string(),
            None => "built-in defaults".to_string(),
        }
    }
}

#[cfg(test)]
mod tests;
