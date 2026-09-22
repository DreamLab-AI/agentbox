//! `cosign`: one signer of a federated sidestr chain. Loads the chain
//! document, a key file and a block directory; follows relays for the
//! round; drives the round every second; serves what a mirror needs;
//! announces the tip after every block; with a parent node, claims peg-ins
//! and pays peg-outs through the PSBT round.

use std::path::PathBuf;

use clap::Parser;
use sidestr_round::node::{run, ParentSettings, Settings};
use sidestr_round::pegout::PegoutConfig;
use sidestr_round::round::RoundConfig;

/// One signer of a federated sidestr chain (level 2), interoperating with
/// siding's round on the wire.
#[derive(Debug, Parser)]
#[command(name = "cosign", version, about)]
struct Args {
    /// The chain document (chain.json).
    #[arg(long)]
    chain: PathBuf,
    /// The block directory: blocks.dat, blocks.json, pegins.json, pegouts.json, votes.jsonl.
    #[arg(long)]
    dir: PathBuf,
    /// The signer's key file (32-byte hex). Never the key itself.
    #[arg(long)]
    key_file: PathBuf,
    /// HTTP port on 127.0.0.1 for /status.json, /chain.json, /tip, /blocks.json, /blocks.dat, /coins/SCRIPT, POST /tx.
    #[arg(long, default_value_t = 3450)]
    port: u16,
    /// Seconds between blocks with an empty mempool.
    #[arg(long, default_value_t = 600)]
    interval: u64,
    /// Seconds between blocks with transactions waiting.
    #[arg(long, default_value_t = 30)]
    tx_interval: u64,
    /// Seconds without a block before the next signer in the ring may propose.
    #[arg(long, default_value_t = 30)]
    propose_after: u64,
    /// When a signed height may be signed again for another proposal: "upstream" (after
    /// --propose-after seconds, the reference's rule), "never" (ADR-2101), or a number of seconds.
    #[arg(long, default_value = "upstream")]
    resign_after: String,
    /// Relays to follow and publish to, comma-separated.
    #[arg(long, value_delimiter = ',')]
    relay: Vec<String>,
    /// Mirror URLs to name in the kind-33333 tip announcement, comma-separated.
    #[arg(long, value_delimiter = ',')]
    announce_mirror: Vec<String>,
    /// The parent node's JSON-RPC URL (peg-ins are claimed; with --parent-wallet, peg-outs paid).
    #[arg(long)]
    parent_rpc: Option<String>,
    /// The parent node's cookie file.
    #[arg(long)]
    parent_cookie: Option<PathBuf>,
    /// The peg wallet's name on the parent node (the federation descriptor imported, this key private).
    #[arg(long)]
    parent_wallet: Option<String>,
    /// Seconds between parent polls.
    #[arg(long, default_value_t = 60)]
    parent_poll: u64,
    /// The first parent height to scan for peg-ins.
    #[arg(long, default_value_t = 0)]
    parent_from: u32,
    /// The vote journal; default DIR/votes.jsonl.
    #[arg(long)]
    journal: Option<PathBuf>,
    /// Sat/vB for a peg-out payment this signer proposes.
    #[arg(long, default_value_t = 2)]
    fee_rate: u64,
    /// The most a proposed peg-out payment may spend in fees before this signer refuses to co-sign.
    #[arg(long, default_value_t = 100_000)]
    max_fee: u64,
}

fn main() {
    let a = Args::parse();
    let resign_after = match a.resign_after.as_str() {
        "upstream" => Some(a.propose_after),
        "never" => None,
        s => match s.parse::<u64>() {
            Ok(n) => Some(n),
            Err(_) => {
                eprintln!("--resign-after: \"upstream\", \"never\" or a number of seconds");
                std::process::exit(2);
            }
        },
    };
    let parent = a.parent_rpc.map(|url| ParentSettings {
        url,
        cookie: a.parent_cookie.unwrap_or_else(|| {
            let home = std::env::var("HOME").unwrap_or_default();
            PathBuf::from(home).join(".bitcoin/.cookie")
        }),
        wallet: a.parent_wallet,
        poll: a.parent_poll,
        from: a.parent_from,
    });
    let settings = Settings {
        chain: a.chain,
        dir: a.dir,
        key_file: a.key_file,
        port: a.port,
        interval: a.interval,
        tx_interval: a.tx_interval,
        round: RoundConfig {
            propose_after: a.propose_after,
            resign_after,
        },
        pegout: PegoutConfig {
            propose_after: a.propose_after,
            resign_after,
            fee_rate: a.fee_rate,
            max_fee: a.max_fee,
            network: None,
        },
        relays: a
            .relay
            .into_iter()
            .map(|r| r.trim().to_string())
            .filter(|r| !r.is_empty())
            .collect(),
        mirrors: a
            .announce_mirror
            .into_iter()
            .map(|m| m.trim().trim_end_matches('/').to_string())
            .filter(|m| !m.is_empty())
            .collect(),
        parent,
        journal: a.journal,
    };
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a tokio runtime");
    if let Err(e) = rt.block_on(run(settings)) {
        eprintln!("cosign: {e}");
        std::process::exit(1);
    }
}
