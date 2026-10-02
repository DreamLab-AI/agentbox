// Emitter for the fixtures beside this file. Not built by this crate: it runs
// against solid-pod-rs itself, so the fixtures are that code's output, not a
// copy of the bridge's. Build it as its own crate, at solid-pod-rs
// up/blocktrails-verify 97582a8 (or the release that carries it):
//
//   [dependencies]
//   solid-pod-rs = { path = "<solid-pod-rs>/crates/solid-pod-rs",
//                    default-features = false, features = ["std", "mrc20"] }
//   serde = "1"
//   serde_json = "1"
//   async-trait = "0.1"
//   hex = "0.4"
//   tokio = { version = "1", features = ["rt", "macros"] }
//
// then `cargo run -- tests/fixtures/blocktrail-s3`.

//! Emits the golden blocktrails.json / gitmark.json / walker reports that
//! nostr-pod-bridge's `tests/contract.rs` pins its mirror against, using
//! solid-pod-rs up/blocktrails-verify 97582a8 itself.
//!
//! Run: `cargo run -- <out-dir>` with solid-pod-rs (features `std`, `mrc20`)
//! path-depended on at that commit.

use std::collections::HashMap;
use std::path::PathBuf;

use solid_pod_rs::blocktrail::{
    verify_blocktrail, walk_blocktrail, Blocktrail, BlocktrailTxo, GITMARK_NETWORK,
};
use solid_pod_rs::mrc20::{MempoolLookup, TxIn, TxInfo, TxOut, Utxo};
use solid_pod_rs::payments::PaymentError;
use solid_pod_rs::provenance::GitMarkEnvelope;

/// x-only key of secret 3 (BIP-340 test vector), the bridge tests' identity.
const XONLY: &str = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
const AGENT: &str = "test-agent";
const GENESIS: &str = "9adc596cfd1100333393a12f2f41b2d820f16d0b";
const TIP: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const TXID0: &str = "51d87101b7cbb01cc5a68785bf3141ec6fd00894d71ab1168d4daa20420eeacf";
const TXID1: &str = "a3f0c2b1d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f";

struct Chain(HashMap<String, TxInfo>);

#[async_trait::async_trait(?Send)]
impl MempoolLookup for Chain {
    async fn address_utxos(&self, _: &str) -> Result<Vec<Utxo>, PaymentError> {
        Ok(Vec::new())
    }
    async fn tx(&self, txid: &str) -> Result<TxInfo, PaymentError> {
        self.0
            .get(txid)
            .cloned()
            .ok_or_else(|| PaymentError::InvalidState(format!("no tx {txid}")))
    }
}

fn pretty<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_string_pretty(v).unwrap() + "\n"
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let out = PathBuf::from(std::env::args().nth(1).expect("out dir"));
    std::fs::create_dir_all(&out).unwrap();
    let base = format!("02{XONLY}");

    // gitmark.json: the genesis mark's envelope, every field as the bridge sets it.
    let gm = GitMarkEnvelope {
        id: format!("gitmark:{GENESIS}:0"),
        genesis: format!("gitmark:{GENESIS}:0"),
        nick: AGENT.into(),
        package: "agentbox-pod".into(),
        repository: format!("did:nostr:{XONLY}"),
    };
    std::fs::write(out.join("gitmark.json"), pretty(&gm)).unwrap();

    // blocktrails.json, unanchored: the pod's real commits, no marks.
    let bare = Blocktrail::gitmark(
        &base,
        GITMARK_NETWORK,
        vec![GENESIS.into(), TIP.into()],
        Vec::new(),
    );
    std::fs::write(
        out.join("blocktrails-unanchored.json"),
        bare.to_blocktrails_json().unwrap() + "\n",
    )
    .unwrap();
    let report = verify_blocktrail(&bare, &Chain(HashMap::new())).await;
    std::fs::write(out.join("walk-unanchored.json"), pretty(&report)).unwrap();

    // blocktrails.json, anchored: two marks on the git-mark chain.
    let marks = vec![
        BlocktrailTxo::new(GITMARK_NETWORK, TXID0, 0)
            .with_amount(1_000_000)
            .with_commit(GENESIS),
        BlocktrailTxo::new(GITMARK_NETWORK, TXID1, 0)
            .with_amount(999_000)
            .with_commit(TIP),
    ];
    let anchored = Blocktrail::gitmark(
        &base,
        GITMARK_NETWORK,
        vec![GENESIS.into(), TIP.into()],
        marks,
    );
    std::fs::write(
        out.join("blocktrails-anchored.json"),
        anchored.to_blocktrails_json().unwrap() + "\n",
    )
    .unwrap();
    // A chain carrying exactly the keys the walk recomputes, each mark
    // spending the one before it, both confirmed.
    let walk = walk_blocktrail(&anchored).unwrap();
    let tx = |txid: &str, vin: Vec<TxIn>, key: &[u8; 32], value: u64, h: u64| TxInfo {
        txid: txid.into(),
        vin,
        vout: vec![TxOut {
            value,
            scriptpubkey: Some(format!("5120{}", hex::encode(key))),
            scriptpubkey_address: None,
        }],
        confirmed: true,
        block_height: Some(h),
    };
    let chain = Chain(HashMap::from([
        (TXID0.to_string(), tx(TXID0, vec![], &walk.expected[0], 1_000_000, 100)),
        (
            TXID1.to_string(),
            tx(
                TXID1,
                vec![TxIn { txid: TXID0.into(), vout: 0 }],
                &walk.expected[1],
                999_000,
                101,
            ),
        ),
    ]));
    let report = verify_blocktrail(&anchored, &chain).await;
    std::fs::write(out.join("walk-anchored.json"), pretty(&report)).unwrap();
}
