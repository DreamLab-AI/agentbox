//! A small `siding`-shaped CLI over `sidestr-core`, for the acceptance checks:
//!
//! ```text
//! siding genesis --chain chain.json --dir DIR --key-file F   write block 0 (or replay), print {genesisHash, height, coins}
//! siding produce --chain chain.json --dir DIR --key-file F   one empty block on the tip
//! siding replay  --chain chain.json --dir DIR                validate the block file, print the tip
//! ```
//!
//! Keys are files, never arguments, and nothing prints them.

use std::collections::HashMap;

use sidestr_core::block::key_from_hex;
use sidestr_core::chain::Chain;
use sidestr_core::document::ChainDocument;

fn main() {
    let argv: Vec<String> = std::env::args().collect();
    let cmd = argv.get(1).map(String::as_str).unwrap_or("");
    let mut args: HashMap<String, String> = HashMap::new();
    let mut i = 2;
    while i + 1 < argv.len() {
        if let Some(k) = argv[i].strip_prefix("--") {
            args.insert(k.to_string(), argv[i + 1].clone());
        }
        i += 2;
    }
    let need = |k: &str| {
        args.get(k).cloned().unwrap_or_else(|| {
            eprintln!("--{k} is required");
            std::process::exit(2)
        })
    };
    let run = || -> sidestr_core::Result<String> {
        let doc = ChainDocument::from_json(&std::fs::read_to_string(need("chain"))?)?;
        let dir = need("dir");
        let key = args
            .get("key-file")
            .map(|f| {
                std::fs::read_to_string(f)
                    .map_err(sidestr_core::Error::from)
                    .and_then(|t| key_from_hex(&t))
            })
            .transpose()?;
        let mut chain = Chain::open(doc, &dir, key.as_ref())?;
        let s = chain.state();
        Ok(match cmd {
            "genesis" | "replay" => format!(
                "{{\"genesisHash\":\"{}\",\"height\":{},\"tip\":\"{}\",\"coins\":{}}}",
                s.genesis_hash(),
                s.height(),
                s.tip().hash,
                s.utxo().len()
            ),
            "produce" => {
                let key = key
                    .ok_or_else(|| sidestr_core::Error::Chain("produce needs --key-file".into()))?;
                let r = chain.produce(&key, vec![])?;
                format!(
                    "{{\"height\":{},\"hash\":\"{}\",\"txs\":{}}}",
                    r.height, r.hash, r.txs
                )
            }
            _ => {
                eprintln!("siding genesis|produce|replay --chain C --dir D [--key-file F]");
                std::process::exit(2)
            }
        })
    };
    match run() {
        Ok(out) => println!("{out}"),
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(1)
        }
    }
}
