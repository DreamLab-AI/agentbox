//! The vote journal: what this signer has authorised, written down before
//! it is published.
//!
//! `round.mjs` keeps `signed` (height → the proposal it signed, and when) in
//! memory, so a signer that restarts has forgotten what it signed and will
//! sign whatever entitled proposal arrives next — which is how two
//! authorisations for one height come to exist (ADR-2101, review §7:
//! "replace the in-memory `signed` map with durable safety state"). Here the
//! entry is written and synced **before** the partial signature is handed
//! back for publishing; if the write fails the signer does not sign. On
//! restart the journal is loaded and the rule of one signature per height
//! (or per burn) is applied against it.
//!
//! The wire does not change: nothing in a journal entry is published.
//!
//! A journal is not anti-rollback (review §7): a host restored from a
//! snapshot has an old journal. It stops the ordinary case — a crash or a
//! restart — from turning into a double signature, and that is all it claims.

use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Seek, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// What a vote is for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoteScope {
    /// A block template at this height.
    Height(u32),
    /// A peg-out PSBT paying this burn, `<txid>:<vout>`.
    Burn(String),
}

/// Whether this signer proposed the thing or co-signed another's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoteRole {
    /// My own proposal, which carries my signature.
    Proposed,
    /// Another signer's proposal that I signed.
    Signed,
}

/// One authorisation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoteEntry {
    /// The height or the burn.
    pub scope: VoteScope,
    /// Proposed or signed.
    pub role: VoteRole,
    /// The proposal event's id (kind 23510 or 23512).
    pub subject: String,
    /// What was authorised, as hex: the template id for a block
    /// ([`sidestr_core::block::template_id`]), the unsigned txid for a
    /// peg-out.
    pub digest: String,
    /// When, unix seconds, by the signer's clock.
    pub at: u64,
}

/// The port. [`MemoryJournal`] for tests and throwaway runs; [`FileJournal`]
/// for a signer that must survive a restart.
pub trait VoteJournal {
    /// Write an entry durably. Returning an error means the signer does not
    /// sign.
    fn record(&mut self, entry: &VoteEntry) -> Result<()>;
    /// Every entry, oldest first.
    fn entries(&self) -> Result<Vec<VoteEntry>>;
}

/// A journal that forgets on drop.
#[derive(Debug, Default)]
pub struct MemoryJournal {
    entries: Vec<VoteEntry>,
}

impl MemoryJournal {
    /// Empty.
    pub fn new() -> Self {
        Self::default()
    }
    /// Seeded, as if loaded from disk.
    pub fn with_entries(entries: Vec<VoteEntry>) -> Self {
        Self { entries }
    }
}

impl VoteJournal for MemoryJournal {
    fn record(&mut self, entry: &VoteEntry) -> Result<()> {
        self.entries.push(entry.clone());
        Ok(())
    }
    fn entries(&self) -> Result<Vec<VoteEntry>> {
        Ok(self.entries.clone())
    }
}

/// An append-only file of JSON lines, one entry per line, `fsync`ed after
/// every write. A torn final line (a crash mid-write) is ignored on load;
/// any other malformed line is an error, since a journal that cannot be
/// read is not a journal.
#[derive(Debug)]
pub struct FileJournal {
    path: PathBuf,
    file: File,
}

impl FileJournal {
    /// Open or create `path`, creating its directory.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .read(true)
            .open(&path)?;
        Ok(Self { path, file })
    }
    /// Where it lives.
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl VoteJournal for FileJournal {
    fn record(&mut self, entry: &VoteEntry) -> Result<()> {
        let mut line = serde_json::to_string(entry).map_err(|e| Error::Journal(e.to_string()))?;
        line.push('\n');
        self.file
            .write_all(line.as_bytes())
            .map_err(|e| Error::Journal(format!("{}: {e}", self.path.display())))?;
        self.file
            .sync_data()
            .map_err(|e| Error::Journal(format!("{}: fsync: {e}", self.path.display())))?;
        Ok(())
    }

    fn entries(&self) -> Result<Vec<VoteEntry>> {
        let mut f = self
            .file
            .try_clone()
            .map_err(|e| Error::Journal(e.to_string()))?;
        f.rewind().map_err(|e| Error::Journal(e.to_string()))?;
        let lines: Vec<String> = BufReader::new(f)
            .lines()
            .collect::<std::io::Result<_>>()
            .map_err(|e| Error::Journal(e.to_string()))?;
        let mut out = Vec::with_capacity(lines.len());
        for (i, line) in lines.iter().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<VoteEntry>(line) {
                Ok(e) => out.push(e),
                Err(e) if i + 1 == lines.len() => {
                    // a torn last line: the crash happened mid-write, nothing was published
                    let _ = e;
                }
                Err(e) => {
                    return Err(Error::Journal(format!(
                        "{} line {}: {e}",
                        self.path.display(),
                        i + 1
                    )))
                }
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(h: u32) -> VoteEntry {
        VoteEntry {
            scope: VoteScope::Height(h),
            role: VoteRole::Signed,
            subject: "ab".repeat(32),
            digest: "cd".repeat(32),
            at: 1_790_000_000 + u64::from(h),
        }
    }

    #[test]
    fn the_file_journal_round_trips_and_tolerates_a_torn_tail() {
        let dir =
            std::env::temp_dir().join(format!("sidestr-round-journal-{}", std::process::id()));
        let path = dir.join("votes.jsonl");
        {
            let mut j = FileJournal::open(&path).unwrap();
            j.record(&entry(1)).unwrap();
            j.record(&VoteEntry {
                scope: VoteScope::Burn(format!("{}:0", "ef".repeat(32))),
                role: VoteRole::Proposed,
                ..entry(2)
            })
            .unwrap();
            assert_eq!(j.entries().unwrap().len(), 2);
        }
        // a torn last line is ignored; a torn middle line is an error
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"{\"scope\":{\"hei")
            .unwrap();
        let j = FileJournal::open(&path).unwrap();
        let e = j.entries().unwrap();
        assert_eq!(e.len(), 2);
        assert_eq!(e[0], entry(1));
        assert!(matches!(e[1].scope, VoteScope::Burn(_)));
        let mut text = std::fs::read_to_string(&path).unwrap();
        text.push_str("\n{\"scope\":{\"height\":3}}\n");
        std::fs::write(&path, text).unwrap();
        assert!(FileJournal::open(&path).unwrap().entries().is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_wire_shape_of_an_entry_is_stable() {
        let s = serde_json::to_string(&entry(5)).unwrap();
        assert!(
            s.starts_with(r#"{"scope":{"height":5},"role":"signed","subject":""#),
            "{s}"
        );
    }
}
