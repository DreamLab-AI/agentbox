//! Shared fixtures and assertions for the golden suites.
//!
//! `golden.rs` covers the four ported scripts; `golden_entrypoint.rs` covers
//! the seventeen inline sites lifted out of `config/entrypoint-unified.sh`.
//! Both replay captured Python output, so the loaders and the byte-diff
//! reporter live here rather than being duplicated.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

pub const BIN: &str = env!("CARGO_BIN_EXE_agentbox-manifest");

pub fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden")
}

pub fn golden(name: &str) -> Vec<u8> {
    let p = golden_dir().join(name);
    std::fs::read(&p).unwrap_or_else(|e| panic!("missing golden {}: {e}", p.display()))
}

pub fn golden_str(name: &str) -> String {
    String::from_utf8(golden(name)).expect("golden is UTF-8")
}

/// A scratch directory that cleans itself up.
pub struct Scratch(pub PathBuf);

impl Scratch {
    pub fn new(tag: &str) -> Self {
        let p = std::env::temp_dir().join(format!(
            "abm-golden-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
    pub fn join(&self, n: &str) -> PathBuf {
        self.0.join(n)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub fn run(args: &[&str]) -> Output {
    Command::new(BIN).args(args).output().expect("binary runs")
}

pub fn run_ok(args: &[&str]) -> Output {
    let out = run(args);
    assert!(
        out.status.success(),
        "{args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    out
}

/// Compare bytes, reporting the first divergence rather than dumping both files.
pub fn assert_same_bytes(label: &str, actual: &[u8], expected: &[u8]) {
    if actual == expected {
        return;
    }
    let at = actual
        .iter()
        .zip(expected)
        .position(|(a, b)| a != b)
        .unwrap_or_else(|| actual.len().min(expected.len()));
    let window = |b: &[u8]| {
        let s = at.saturating_sub(60);
        String::from_utf8_lossy(&b[s..(at + 60).min(b.len())]).into_owned()
    };
    panic!(
        "{label}: diverges at byte {at} (rust {} bytes, python {} bytes)\n\
         --- rust   ---\n{}\n--- python ---\n{}",
        actual.len(),
        expected.len(),
        window(actual),
        window(expected)
    );
}

pub fn manifest() -> PathBuf {
    golden_dir().join("live-agentbox.toml")
}

/// Compare a produced file against its golden by name.
pub fn check(f: &Path, name: &str) {
    assert_same_bytes(name, &std::fs::read(f).unwrap(), &golden(name));
}
