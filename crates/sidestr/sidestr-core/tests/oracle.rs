//! The reference engine as oracle: the sealed fixtures under `fixtures/` were
//! written by siding (`siding genesis`), and this crate must reproduce them.
//!
//! - `trial`: a throwaway chain with its (disposable) signer key, so the
//!   genesis can be rebuilt and compared byte for byte — which proves the
//!   BIP-325 preimage, the coinbase layout and the zero-aux Schnorr path.
//! - `dreamlab`: the estate's sealed `sidestr:dreamlab` genesis (ADR-2103),
//!   key withheld: replayed and checked against the document's `genesisHash`.

use bitcoin::consensus::encode::{deserialize, serialize};
use bitcoin::hashes::Hash;
use bitcoin::{Block, BlockHash, CompactTarget};
use sidestr_core::block::{
    block_height, build_block, coinbase_height, key_from_hex, sign_block, solution_of,
    verify_block_signature, BlockTemplate, Stock,
};
use sidestr_core::document::ChainDocument;

fn fixture(name: &str, file: &str) -> Vec<u8> {
    std::fs::read(format!(
        "{}/fixtures/{name}/{file}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

fn block0(dat: &[u8]) -> (u32, Vec<u8>) {
    let height = u32::from_le_bytes(dat[0..4].try_into().unwrap());
    let size = u32::from_le_bytes(dat[4..8].try_into().unwrap()) as usize;
    (height, dat[8..8 + size].to_vec())
}

#[test]
fn trial_genesis_is_byte_identical_to_the_reference() {
    let doc = ChainDocument::from_json(&String::from_utf8(fixture("trial", "chain.json")).unwrap())
        .unwrap();
    let key = key_from_hex(&String::from_utf8(fixture("trial", "trial.key")).unwrap()).unwrap();
    let (height, expected) = block0(&fixture("trial", "blocks.dat"));
    assert_eq!(height, 0);
    assert_eq!(expected.len(), 317);
    let unsigned = build_block(
        &Stock,
        &BlockTemplate {
            height: 0,
            prev: BlockHash::all_zeros(),
            time: doc.genesis_time,
            transactions: vec![],
            outputs: vec![],
            bits: doc.bits().unwrap(),
            marker: format!("sidestr genesis {}", doc.id),
        },
    );
    let signed = sign_block(
        &Stock,
        &unsigned,
        &doc.challenge_script().unwrap(),
        &key,
        &[0u8; 32],
    )
    .unwrap();
    assert_eq!(hex::encode(serialize(&signed)), hex::encode(&expected));
    assert_eq!(
        signed.header.block_hash().to_string(),
        doc.genesis_hash.clone().unwrap()
    );
    assert!(verify_block_signature(
        &Stock,
        &signed,
        &doc.challenge_script().unwrap()
    ));
}

#[test]
fn dreamlab_genesis_hashes_to_the_document_and_verifies() {
    let doc =
        ChainDocument::from_json(&String::from_utf8(fixture("dreamlab", "chain.json")).unwrap())
            .unwrap();
    let (height, bytes) = block0(&fixture("dreamlab", "blocks.dat"));
    assert_eq!((height, bytes.len()), (0, 320));
    let block: Block = deserialize(&bytes).unwrap();
    assert_eq!(
        block.header.block_hash().to_string(),
        "4db37517728bd509c0cb96ee5a2e3e2a77f9e965a092e9f67948b413d453dbc0"
    );
    assert_eq!(
        Some(block.header.block_hash().to_string()),
        doc.genesis_hash
    );
    assert_eq!(serialize(&block.header).len(), 80);
    assert_eq!(
        block.header.bits,
        CompactTarget::from_consensus(0x207f_ffff)
    );
    assert_eq!(block.header.nonce, 2);
    assert_eq!(block_height(&Stock, &block).unwrap(), 0);
    assert_eq!(coinbase_height(&block.txdata[0]).unwrap(), 0);
    assert_eq!(solution_of(&block).unwrap().witness[0].len(), 64);
    assert!(verify_block_signature(
        &Stock,
        &block,
        &doc.challenge_script().unwrap()
    ));
    // and a wrong challenge, or a tampered byte, does not verify
    let other = bitcoin::ScriptBuf::from_hex(&format!("5120{}", "11".repeat(32))).unwrap();
    assert!(!verify_block_signature(&Stock, &block, &other));
    let mut tampered = block.clone();
    tampered.header.time += 1;
    assert!(!verify_block_signature(
        &Stock,
        &tampered,
        &doc.challenge_script().unwrap()
    ));
}

/// Acceptance 2: replay the sealed estate genesis through the chain, as a
/// validator without the key does.
#[test]
fn dreamlab_replays_through_the_chain() {
    let src = format!("{}/fixtures/dreamlab", env!("CARGO_MANIFEST_DIR"));
    let dir = std::env::temp_dir().join(format!("sidestr-dreamlab-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    for f in ["blocks.dat", "blocks.json"] {
        std::fs::copy(format!("{src}/{f}"), dir.join(f)).unwrap();
    }
    let doc =
        ChainDocument::from_json(&std::fs::read_to_string(format!("{src}/chain.json")).unwrap())
            .unwrap();
    let chain = sidestr_core::chain::Chain::open(doc, &dir, None).unwrap();
    assert_eq!(
        chain.state().genesis_hash().to_string(),
        "4db37517728bd509c0cb96ee5a2e3e2a77f9e965a092e9f67948b413d453dbc0"
    );
    assert_eq!(chain.state().height(), 0);
    assert_eq!(chain.state().utxo().len(), 0, "pegs: [] mints no coins");
    assert_eq!(chain.index().blocks.len(), 1);
    std::fs::remove_dir_all(&dir).unwrap();
}
