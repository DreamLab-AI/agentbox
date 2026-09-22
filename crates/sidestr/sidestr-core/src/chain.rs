//! A sidestr chain on disk (feature `std`): the [`StateOf`] replayed from the
//! block file in a directory, created with the genesis when absent, and
//! every accepted block written down (`siding/lib/chain.mjs open`, `addBlock`,
//! `produce`). The clock is the system's.
//!
//! [`Chain`] is the stock instantiation; a BLAKE2b chain is
//! `ChainOf<Blake2bV2>` with the family from `sidestr-header`, and replays a
//! mirror's `blocks.dat` the same way.
//!
//! ```no_run
//! use sidestr_core::{chain::Chain, document::ChainDocument, block::key_from_hex};
//!
//! let doc = ChainDocument::from_json(&std::fs::read_to_string("chain.json").unwrap()).unwrap();
//! // a validator: replays what is on disk, refuses a genesis that is not the document's
//! let chain = Chain::open(doc.clone(), "state", None).unwrap();
//! println!("{} at {} with {} coins", chain.state().genesis_hash(), chain.state().height(), chain.state().utxo().len());
//! // a producer: the key is a file, never an argument
//! let key = key_from_hex(&std::fs::read_to_string("signer.key").unwrap()).unwrap();
//! let mut chain = Chain::open(doc, "state", Some(&key)).unwrap();
//! let added = chain.produce(&key, vec![]).unwrap();
//! println!("block {} {}", added.height, added.hash);
//! ```

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use bitcoin::consensus::encode::deserialize;
use bitcoin::secp256k1::SecretKey;
use bitcoin::BlockHash;

use crate::block::{HeaderFamily, SidestrBlock, Stock};
use crate::blockfile::{append_block, read_block, read_index, write_index, Index};
use crate::document::ChainDocument;
use crate::error::{Error, Result};
use crate::state::{Applied, ClaimRequest, NextBlock, StateOf, Submitted};

/// The chain with its block file, for header family `F`.
#[derive(Debug)]
pub struct ChainOf<F: HeaderFamily> {
    state: StateOf<F>,
    dir: PathBuf,
    index: Index,
}

/// The chain on disk beside a stock parent: [`ChainOf`] over [`Stock`].
pub type Chain = ChainOf<Stock>;

/// Seconds since the epoch, as a header time.
pub fn now() -> u32 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as u32)
        .unwrap_or(0)
}

impl<F: HeaderFamily> ChainOf<F> {
    /// Replay `dir/blocks.dat`, creating it with the genesis when absent —
    /// which needs the signer's key. `open()` refuses a block file whose
    /// block 0 does not hash to the document's `genesisHash`, and any later
    /// block the rules refuse.
    pub fn open(
        doc: ChainDocument,
        dir: impl AsRef<Path>,
        key: Option<&SecretKey>,
    ) -> Result<Self> {
        doc.validate()?;
        let federated = doc.signers.is_some();
        Self::open_with(doc, dir, |doc| {
            let key = key.ok_or_else(|| {
                Error::Chain("no chain on disk and no key to make the genesis".into())
            })?;
            if federated {
                return Err(Error::Federation(
                    "a federated chain's genesis needs k signatures: open_sealed(doc, dir, seal)"
                        .into(),
                ));
            }
            StateOf::<F>::genesis_block_for(doc, key)
        })
    }

    /// [`ChainOf::open`] for a federated chain (`siding/lib/chain.mjs open(null,
    /// { seal })`): when no chain is on disk, `seal` receives the unsigned
    /// genesis ([`StateOf::build_genesis_for`]) and returns it sealed by `k`
    /// signatures — [`crate::federation::seal_federated`] with the partials
    /// the signers made. With a chain on disk, `seal` is not called.
    pub fn open_sealed(
        doc: ChainDocument,
        dir: impl AsRef<Path>,
        seal: impl FnOnce(&F::Block) -> Result<F::Block>,
    ) -> Result<Self> {
        doc.validate()?;
        Self::open_with(doc, dir, |doc| seal(&StateOf::<F>::build_genesis_for(doc)?))
    }

    fn open_with(
        doc: ChainDocument,
        dir: impl AsRef<Path>,
        genesis: impl FnOnce(&ChainDocument) -> Result<F::Block>,
    ) -> Result<Self> {
        StateOf::<F>::family_of(&doc)?;
        let dir = dir.as_ref().to_path_buf();
        std::fs::create_dir_all(&dir)?;
        let dat = dir.join("blocks.dat");
        let idx = dir.join("blocks.json");
        let (state, index) = match read_index(&idx)? {
            None => {
                let genesis = genesis(&doc)?;
                let state = StateOf::<F>::from_genesis(doc, &genesis, None)?;
                let mut index = Index::new(&state.document().id);
                append_block(
                    &dat,
                    &mut index,
                    0,
                    &state.genesis_hash().to_string(),
                    &genesis.encode(),
                )?;
                write_index(&idx, &index)?;
                (state, index)
            }
            Some(index) => {
                let first = index
                    .blocks
                    .first()
                    .ok_or_else(|| Error::Chain("the block file has no genesis".into()))?;
                if first.height != 0 {
                    return Err(Error::Chain(format!(
                        "the block file starts at {}, not the genesis",
                        first.height
                    )));
                }
                let genesis = F::Block::decode(&read_block(&dat, first)?)?;
                let mut state = StateOf::<F>::from_genesis(
                    doc,
                    &genesis,
                    Some(
                        first
                            .hash
                            .parse()
                            .map_err(|_| Error::Encoding("bad hash in the index".into()))?,
                    ),
                )?;
                for e in &index.blocks[1..] {
                    let expect: BlockHash = e
                        .hash
                        .parse()
                        .map_err(|_| Error::Encoding("bad hash in the index".into()))?;
                    let block = F::Block::decode(&read_block(&dat, e)?)?;
                    state.apply(e.height, &block, Some(expect), Some(now()))?;
                }
                (state, index)
            }
        };
        Ok(Self { state, dir, index })
    }

    /// The chain in memory.
    pub fn state(&self) -> &StateOf<F> {
        &self.state
    }
    /// The block file's index.
    pub fn index(&self) -> &Index {
        &self.index
    }
    /// `dir/blocks.dat`.
    pub fn dat_path(&self) -> PathBuf {
        self.dir.join("blocks.dat")
    }
    /// `dir/blocks.json`.
    pub fn index_path(&self) -> PathBuf {
        self.dir.join("blocks.json")
    }

    fn write(&mut self, height: u32, hash: BlockHash, bytes: &[u8]) -> Result<()> {
        append_block(
            self.dat_path(),
            &mut self.index,
            height,
            &hash.to_string(),
            bytes,
        )?;
        write_index(self.index_path(), &self.index)
    }

    /// Accept a block from elsewhere (a mirror): validated, applied, written.
    pub fn add_block(&mut self, bytes: &[u8], expect: Option<BlockHash>) -> Result<Applied> {
        let r = self.state.add_block_bytes(bytes, expect, Some(now()))?;
        self.write(r.height, r.hash, bytes)?;
        Ok(r)
    }

    /// A transaction for the mempool (SPEC 11), consensus bytes.
    pub fn submit(&mut self, tx_bytes: &[u8]) -> Result<Submitted> {
        let tx = deserialize(tx_bytes).map_err(|e| Error::Encoding(e.to_string()))?;
        self.state.submit(tx)
    }

    /// One signer: build the next block from the mempool and these claims,
    /// sign, apply, write.
    pub fn produce(&mut self, key: &SecretKey, claims: Vec<ClaimRequest>) -> Result<Applied> {
        let t = now();
        let (r, block) = self
            .state
            .produce(key, &NextBlock { time: t, claims }, Some(t))?;
        self.write(r.height, r.hash, &block.encode())?;
        Ok(r)
    }
}
