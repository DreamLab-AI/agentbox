//! The block file: blocks appended as `[u32le height][u32le size][block
//! bytes]`, with a JSON index `{network, from, to, blocks: [{height, hash,
//! offset, size}]}` beside it, so a client can Range-fetch exactly the tail
//! it lacks and verify every block's hash (SPEC 11). A port of
//! `bitcoin-blake/blaketestnode` `lib/blockfile.mjs` (AGPL-3.0). Feature `std`.
//!
//! The index is written compact, keys in this order, exactly as the reference
//! writes it, so a mirror serving files from either engine looks the same.
//!
//! ```no_run
//! use sidestr_core::blockfile::{read_index, read_block};
//!
//! let index = read_index("blocks.json").unwrap().expect("a chain on disk");
//! for entry in &index.blocks {
//!     let bytes = read_block("blocks.dat", entry).unwrap();
//!     assert_eq!(bytes.len() as u32, entry.size);
//! }
//! ```

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::Result;

/// The per-block header in the file: height and size, both `u32le`.
pub const HEADER: u64 = 8;

/// One index entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    /// The block's height.
    pub height: u32,
    /// Its hash, display-order hex.
    pub hash: String,
    /// Byte offset of its 8-byte header in the block file.
    pub offset: u64,
    /// Size of the block bytes (the header excluded).
    pub size: u32,
}

/// The index beside the block file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Index {
    /// The chain id.
    pub network: String,
    /// The first height in the file (0 for a sidestr chain).
    pub from: i64,
    /// The last height in the file; `from - 1` when empty.
    pub to: i64,
    /// Every block, in file order.
    pub blocks: Vec<Entry>,
}

impl Index {
    /// An empty index for a chain.
    pub fn new(network: &str) -> Self {
        Self {
            network: network.to_string(),
            from: 0,
            to: -1,
            blocks: Vec::new(),
        }
    }
}

/// The index, or `None` when the file does not exist.
pub fn read_index(path: impl AsRef<Path>) -> Result<Option<Index>> {
    let path = path.as_ref();
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_str(&fs::read_to_string(path)?)?))
}

/// Write the index, compact.
pub fn write_index(path: impl AsRef<Path>, index: &Index) -> Result<()> {
    fs::write(path, serde_json::to_string(index)?)?;
    Ok(())
}

/// Append a block to the file and record it in the index.
pub fn append_block(
    dat: impl AsRef<Path>,
    index: &mut Index,
    height: u32,
    hash: &str,
    bytes: &[u8],
) -> Result<()> {
    let dat = dat.as_ref();
    let offset = if dat.exists() {
        fs::metadata(dat)?.len()
    } else {
        0
    };
    let mut f = OpenOptions::new().create(true).append(true).open(dat)?;
    f.write_all(&height.to_le_bytes())?;
    f.write_all(&(bytes.len() as u32).to_le_bytes())?;
    f.write_all(bytes)?;
    index.blocks.push(Entry {
        height,
        hash: hash.to_string(),
        offset,
        size: bytes.len() as u32,
    });
    index.to = i64::from(height);
    Ok(())
}

/// Drop every block from `height` on (a reorg): truncate the file and the index.
pub fn truncate_from(dat: impl AsRef<Path>, index: &mut Index, height: u32) -> Result<()> {
    let Some(i) = index.blocks.iter().position(|b| b.height == height) else {
        return Ok(());
    };
    let f = OpenOptions::new().write(true).open(dat)?;
    f.set_len(index.blocks[i].offset)?;
    index.blocks.truncate(i);
    index.to = if i > 0 {
        i64::from(index.blocks[i - 1].height)
    } else {
        index.from - 1
    };
    Ok(())
}

/// The block bytes an entry points at.
pub fn read_block(dat: impl AsRef<Path>, entry: &Entry) -> Result<Vec<u8>> {
    let mut f = File::open(dat)?;
    f.seek(SeekFrom::Start(entry.offset + HEADER))?;
    let mut buf = vec![0u8; entry.size as usize];
    f.read_exact(&mut buf)?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_read_truncate() {
        let dir = std::env::temp_dir().join(format!("sidestr-blockfile-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let dat = dir.join("blocks.dat");
        let idx = dir.join("blocks.json");
        assert_eq!(read_index(&idx).unwrap(), None);
        let mut index = Index::new("sidestr:test");
        append_block(&dat, &mut index, 0, "aa", b"genesis").unwrap();
        append_block(&dat, &mut index, 1, "bb", b"one").unwrap();
        write_index(&idx, &index).unwrap();
        let text = fs::read_to_string(&idx).unwrap();
        assert_eq!(
            text,
            r#"{"network":"sidestr:test","from":0,"to":1,"blocks":[{"height":0,"hash":"aa","offset":0,"size":7},{"height":1,"hash":"bb","offset":15,"size":3}]}"#
        );
        let again = read_index(&idx).unwrap().unwrap();
        assert_eq!(again, index);
        assert_eq!(read_block(&dat, &again.blocks[1]).unwrap(), b"one");
        truncate_from(&dat, &mut index, 1).unwrap();
        assert_eq!(
            (
                index.to,
                index.blocks.len(),
                fs::metadata(&dat).unwrap().len()
            ),
            (0, 1, 15)
        );
        truncate_from(&dat, &mut index, 0).unwrap();
        assert_eq!((index.to, fs::metadata(&dat).unwrap().len()), (-1, 0));
        fs::remove_dir_all(&dir).unwrap();
    }
}
