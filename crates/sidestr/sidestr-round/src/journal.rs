//! The vote journal: what this signer has authorised, written down before
//! the custody key is asked and before anything is published.
//!
//! `round.mjs` keeps `signed` (height → the proposal it signed, and when) in
//! memory, so a signer that restarts has forgotten what it signed and will
//! sign whatever entitled proposal arrives next — which is how two
//! authorisations for one height come to exist (ADR-2101, review §7:
//! "replace the in-memory `signed` map with durable safety state").
//!
//! # What is guaranteed, exactly
//!
//! Every authorisation is two records. The **intent** (the height or the
//! burn, the proposal id, the template id or the unsigned txid, the time) is
//! written and synced **before** the custody signer
//! ([`crate::signer::BlockSigner`]) is invoked; if that write fails the
//! signer is not called, so no signature exists. After the signer answers,
//! the **signature** is recorded, and only then is the `Publish` action
//! returned; if that second write fails nothing is published. On restart
//! the journal is loaded and the rule of one signature per height (or per
//! burn) is applied against every entry — an intent whose signature was
//! never recorded counts, since a signature that may exist is one that may
//! have left.
//!
//! The wire does not change: nothing in a journal entry is published.
//!
//! A journal is not anti-rollback (review §7): a host restored from a
//! snapshot has an old journal. It stops the ordinary case — a crash or a
//! restart — from turning into a double signature, and that is all it claims.

use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
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

/// Which of the two records of an authorisation this is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoteStage {
    /// Written before the custody signer is asked. Counts as an
    /// authorisation on reload: the signature may exist.
    Intent,
    /// Written after the custody signer answered, with the signature.
    #[default]
    Signed,
}

/// One record. An authorisation is an [`VoteStage::Intent`] followed by a
/// [`VoteStage::Signed`] with the same `subject`; either alone is an
/// authorisation for the one-signature rule.
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
    /// When, unix **milliseconds**, by the signer's clock — the round's
    /// clock is milliseconds so the reference's timing holds to the
    /// millisecond across a restart.
    pub at: u64,
    /// Intent or signed. Absent in a file written before this field
    /// existed: read as signed.
    #[serde(default)]
    pub stage: VoteStage,
    /// The signature the custody signer produced, hex, on a
    /// [`VoteStage::Signed`] record: one 64-byte BIP-340 signature for a
    /// block; one per input, comma-separated, for a peg-out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

/// The port. [`MemoryJournal`] for tests and throwaway runs; [`FileJournal`]
/// for a signer that must survive a restart.
pub trait VoteJournal {
    /// Write an entry durably. Returning an error means the signer does not
    /// sign (for an intent) or does not publish (for a signature).
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
/// every write.
///
/// # Durability, exactly
///
/// - **On open the file is validated.** Every `\n`-terminated line must be
///   an entry; a malformed terminated line is an error (a journal that
///   cannot be read is not a journal, and a signer without one does not
///   sign). An unterminated suffix is a torn write from a crash: if it
///   parses as a whole entry only its newline was lost, and it is
///   terminated; otherwise it is cut back to the last record boundary. The
///   repair is synced, as is the directory after the file is created.
/// - **`record` appends after that boundary** and syncs. If the append
///   fails part-way the file is cut back to the boundary; if even that
///   fails the journal refuses every later write, so a torn line can never
///   have another record appended to it.
/// - A torn record was never acknowledged, so nothing was signed on its
///   strength: the intent is written before the custody signer is asked.
#[derive(Debug)]
pub struct FileJournal {
    path: PathBuf,
    file: File,
    /// Bytes up to the last record boundary; every byte before it is a
    /// terminated, well-formed entry.
    durable_len: u64,
    /// Set when a failed append could not be rolled back.
    poisoned: Option<String>,
}

/// The parse of a file's bytes: the entries, and the unterminated suffix if
/// there is one (its start offset and whether it parses as an entry).
struct Parsed {
    entries: Vec<VoteEntry>,
    durable_len: u64,
    torn: Option<(u64, Option<VoteEntry>)>,
}

fn parse(bytes: &[u8], path: &Path) -> Result<Parsed> {
    let mut entries = Vec::new();
    let mut pos = 0usize;
    let mut line_no = 0usize;
    let mut durable_len = 0u64;
    let mut torn = None;
    while pos < bytes.len() {
        line_no += 1;
        let rest = &bytes[pos..];
        match rest.iter().position(|b| *b == b'\n') {
            Some(nl) => {
                let line = &rest[..nl];
                let text = std::str::from_utf8(line).map_err(|e| {
                    Error::Journal(format!("{} line {line_no}: {e}", path.display()))
                })?;
                if !text.trim().is_empty() {
                    let e = serde_json::from_str::<VoteEntry>(text).map_err(|e| {
                        Error::Journal(format!("{} line {line_no}: {e}", path.display()))
                    })?;
                    entries.push(e);
                }
                pos += nl + 1;
                durable_len = pos as u64;
            }
            None => {
                let whole = std::str::from_utf8(rest)
                    .ok()
                    .and_then(|t| serde_json::from_str::<VoteEntry>(t).ok());
                torn = Some((pos as u64, whole));
                break;
            }
        }
    }
    Ok(Parsed {
        entries,
        durable_len,
        torn,
    })
}

fn journal_err(path: &Path, what: &str, e: impl std::fmt::Display) -> Error {
    Error::Journal(format!("{}: {what}: {e}", path.display()))
}

fn sync_dir(path: &Path) -> Result<()> {
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        File::open(dir)
            .and_then(|d| d.sync_all())
            .map_err(|e| journal_err(dir, "fsync directory", e))?;
    }
    Ok(())
}

impl FileJournal {
    /// Open or create `path`, creating its directory, validating the file
    /// and repairing a torn tail (see the type's documentation).
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(dir)?;
        }
        let existed = path.exists();
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .read(true)
            .open(&path)
            .map_err(|e| journal_err(&path, "open", e))?;
        if !existed {
            file.sync_all()
                .map_err(|e| journal_err(&path, "fsync", e))?;
            sync_dir(&path)?;
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|e| journal_err(&path, "read", e))?;
        let parsed = parse(&bytes, &path)?;
        let mut durable_len = parsed.durable_len;
        if let Some((start, whole)) = parsed.torn {
            match whole {
                Some(_) => {
                    // a whole entry that lost only its newline: terminate it
                    file.write_all(b"\n")
                        .map_err(|e| journal_err(&path, "repair", e))?;
                    durable_len = bytes.len() as u64 + 1;
                }
                None => {
                    file.set_len(start)
                        .map_err(|e| journal_err(&path, "truncate torn tail", e))?;
                    durable_len = start;
                }
            }
            file.sync_all()
                .map_err(|e| journal_err(&path, "fsync repair", e))?;
            sync_dir(&path)?;
        }
        Ok(Self {
            path,
            file,
            durable_len,
            poisoned: None,
        })
    }
    /// Where it lives.
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl VoteJournal for FileJournal {
    fn record(&mut self, entry: &VoteEntry) -> Result<()> {
        if let Some(why) = &self.poisoned {
            return Err(Error::Journal(format!(
                "{}: refusing every write after a failed append: {why}",
                self.path.display()
            )));
        }
        let mut line = serde_json::to_string(entry).map_err(|e| Error::Journal(e.to_string()))?;
        line.push('\n');
        let written = self
            .file
            .write_all(line.as_bytes())
            .and_then(|()| self.file.sync_data());
        match written {
            Ok(()) => {
                self.durable_len += line.len() as u64;
                Ok(())
            }
            Err(e) => {
                // cut back to the last record boundary so a torn line is never appended to
                let rolled = self
                    .file
                    .set_len(self.durable_len)
                    .and_then(|()| self.file.sync_data());
                if let Err(r) = rolled {
                    self.poisoned = Some(format!("{e}; rollback failed: {r}"));
                }
                Err(journal_err(&self.path, "append", e))
            }
        }
    }

    fn entries(&self) -> Result<Vec<VoteEntry>> {
        if let Some(why) = &self.poisoned {
            return Err(Error::Journal(format!(
                "{}: unreadable after a failed append: {why}",
                self.path.display()
            )));
        }
        let bytes = std::fs::read(&self.path).map_err(|e| journal_err(&self.path, "read", e))?;
        let parsed = parse(&bytes, &self.path)?;
        if let Some((start, _)) = parsed.torn {
            return Err(Error::Journal(format!(
                "{}: unterminated record at byte {start}; reopen the journal to repair it",
                self.path.display()
            )));
        }
        Ok(parsed.entries)
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
            at: 1_790_000_000_000 + u64::from(h),
            stage: VoteStage::Signed,
            signature: None,
        }
    }

    fn scratch(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "sidestr-round-journal-{name}-{}",
            std::process::id()
        ))
    }

    #[test]
    fn the_file_journal_round_trips_and_repairs_a_torn_tail_before_appending() {
        let dir = scratch("torn");
        let _ = std::fs::remove_dir_all(&dir);
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
        let clean_len = std::fs::metadata(&path).unwrap().len();
        // a torn last line is cut back on open, and the next record lands on the boundary
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"{\"scope\":{\"hei")
            .unwrap();
        let mut j = FileJournal::open(&path).unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().len(), clean_len);
        let e = j.entries().unwrap();
        assert_eq!(e.len(), 2);
        assert_eq!(e[0], entry(1));
        assert!(matches!(e[1].scope, VoteScope::Burn(_)));
        j.record(&entry(3)).unwrap();
        drop(j);
        let e = FileJournal::open(&path).unwrap().entries().unwrap();
        assert_eq!(e.len(), 3, "append after recovery survives a reload");
        assert_eq!(e[2], entry(3));
        // a second crash after recovery: the same repair, the same append
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"{\"sco")
            .unwrap();
        let mut j = FileJournal::open(&path).unwrap();
        j.record(&entry(4)).unwrap();
        drop(j);
        let e = FileJournal::open(&path).unwrap().entries().unwrap();
        assert_eq!(e.iter().map(|e| &e.scope).collect::<Vec<_>>().len(), 4);
        assert_eq!(e[3], entry(4));
        // a whole entry that lost only its newline is kept and terminated
        let mut whole = serde_json::to_vec(&entry(5)).unwrap();
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(&whole)
            .unwrap();
        let j = FileJournal::open(&path).unwrap();
        assert_eq!(j.entries().unwrap().len(), 5);
        whole.push(b'\n');
        assert!(std::fs::read(&path).unwrap().ends_with(&whole));
        // a malformed terminated line is an error: fail closed
        let mut text = std::fs::read_to_string(&path).unwrap();
        text.push_str("{\"scope\":{\"height\":3}}\n");
        std::fs::write(&path, text).unwrap();
        let e = FileJournal::open(&path).unwrap_err().to_string();
        assert!(e.contains("line 6"), "{e}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_fresh_file_and_a_reload_read_older_records_without_a_stage() {
        let dir = scratch("stage");
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("deep").join("votes.jsonl");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            format!(
                "{{\"scope\":{{\"height\":9}},\"role\":\"signed\",\"subject\":\"{}\",\"digest\":\"{}\",\"at\":5}}\n",
                "ab".repeat(32),
                "cd".repeat(32)
            ),
        )
        .unwrap();
        let j = FileJournal::open(&path).unwrap();
        let e = j.entries().unwrap();
        assert_eq!(e[0].stage, VoteStage::Signed);
        assert_eq!(e[0].signature, None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_wire_shape_of_an_entry_is_stable() {
        let s = serde_json::to_string(&entry(5)).unwrap();
        assert!(
            s.starts_with(r#"{"scope":{"height":5},"role":"signed","subject":""#),
            "{s}"
        );
        assert!(s.ends_with(r#","stage":"signed"}"#), "{s}");
        let s = serde_json::to_string(&VoteEntry {
            stage: VoteStage::Intent,
            ..entry(5)
        })
        .unwrap();
        assert!(s.ends_with(r#","stage":"intent"}"#), "{s}");
    }
}
