//! Headers follow the parent (SPEC 3.2): beside `tbtc4` the stock 80-byte
//! header hashed with double-SHA256 and the height read from the coinbase's
//! BIP 34 push; a malformed coinbase is refused, never read as height 0; the
//! chain produces blocks a fresh validator replays. The stock arm of
//! `siding/test/stock-header-test.mjs` (the `txbt4` arm is `sidestr-header`'s).

mod common;

use bitcoin::consensus::encode::{deserialize, serialize};
use bitcoin::hashes::{sha256d, Hash};
use bitcoin::Block;
use common::*;
use sidestr_core::block::{block_height, coinbase_height, Stock};
use sidestr_core::blockfile::read_block;
use sidestr_core::chain::Chain;
use sidestr_core::parents::Family;
use sidestr_core::Error;

#[test]
fn both_parents_open_produce_and_replay_stock_arm() {
    let key = signer("hdr-tbtc4");
    let me = challenge(&key);
    let doc = doc(
        "hdr-tbtc4",
        &key,
        vec![("b".repeat(64), 0, 1_000_000_000, me)],
    );
    assert_eq!(
        doc.family().unwrap(),
        Family::Stock,
        "tbtc4: the engine resolves the parent's family"
    );
    let dir = TempDir::new("hdr");
    let mut chain = open(&doc, &dir, &key);
    produce_to(&mut chain, &key, 3);
    let tip = chain.state().tip();
    let header = *chain.state().header_at(tip.height).unwrap();
    let bytes = serialize(&header);
    let entry = chain
        .index()
        .blocks
        .iter()
        .find(|e| e.height == tip.height)
        .unwrap();
    let block: Block = deserialize(&read_block(chain.dat_path(), entry).unwrap()).unwrap();
    assert!(
        block.header.block_hash() == tip.hash
            && block_height(&Stock, &block).unwrap() == tip.height,
        "the block file's tip decodes to the tip hash and height"
    );
    assert_eq!(bytes.len(), 80, "the header is the stock 80 bytes");
    assert_eq!(
        header.version.to_consensus() >> 31,
        0,
        "version keeps bit 31 clear"
    );
    let mut dsha = sha256d::Hash::hash(&bytes).to_byte_array();
    dsha.reverse();
    assert_eq!(
        tip.hash.to_string(),
        hex::encode(dsha),
        "the block hash is double-SHA256 of the header bytes"
    );
    assert!(
        Stock.header_height_is_none() && coinbase_height(&block.txdata[0]).unwrap() == tip.height,
        "the coinbase alone says the height"
    );
    let again = Chain::open(doc.clone(), &dir.0, Some(&key)).unwrap();
    assert!(
        again.state().tip() == tip,
        "a fresh validator replays the block file to the same tip"
    );
    let no_key = Chain::open(doc.clone(), &dir.0, None).unwrap();
    assert_eq!(no_key.state().tip(), tip, "and so does one without the key");

    // a block whose coinbase does not push its height is refused, never read as height 0
    let mut block: Block = deserialize(&hand_block(chain.state(), &key, vec![], vec![])).unwrap();
    block.txdata[0].input[0].script_sig = bitcoin::ScriptBuf::from_bytes(vec![0x4c, 0x01, 0x05]);
    assert!(matches!(
        chain.add_block(&serialize(&block), None),
        Err(Error::CoinbaseHeight(_))
    ));
    // a block at the wrong height, or on the wrong prev, is refused by name
    let mut wrong: Block = deserialize(&hand_block(chain.state(), &key, vec![], vec![])).unwrap();
    wrong.header.prev_blockhash = bitcoin::BlockHash::all_zeros();
    let e = chain
        .add_block(&serialize(&wrong), None)
        .unwrap_err()
        .to_string();
    assert!(e.contains("does not link"), "{e}");
    // a fresh validator with a document whose genesisHash is another chain's refuses the block file
    let mut other = doc.clone();
    other.genesis_hash = Some("0".repeat(64));
    assert!(matches!(
        Chain::open(other, &dir.0, None),
        Err(Error::GenesisMismatch { .. })
    ));
    // and a validator with no chain on disk and no key cannot make one
    let empty = TempDir::new("hdr-empty");
    assert!(Chain::open(doc, &empty.0, None).is_err());
}

trait HeightIsNone {
    fn header_height_is_none(&self) -> bool;
}
impl HeightIsNone for Stock {
    fn header_height_is_none(&self) -> bool {
        use sidestr_core::block::HeaderFamily;
        let h = bitcoin::block::Header {
            version: bitcoin::block::Version::from_consensus(0x2000_0000),
            prev_blockhash: bitcoin::BlockHash::all_zeros(),
            merkle_root: bitcoin::TxMerkleNode::all_zeros(),
            time: 0,
            bits: bitcoin::CompactTarget::from_consensus(0x207f_ffff),
            nonce: 0,
        };
        self.header_height(&h).is_none()
    }
}
