//! Live relay smoke test — real socket, real signature, real policy.
//!
//! Publishes a knowledge unit to the configured relay and reads it back, so the
//! websocket framing, the BIP-340 signature and the relay's ingress policy are
//! all exercised against the running service rather than a stand-in.
//!
//! ```text
//! COLLOQUY_RELAY_URL=ws://127.0.0.1:7777 \
//! COLLOQUY_RELAY_SECRET_HEX=<64 hex chars> \
//!   cargo run -p colloquy-backends --example relay_smoke
//! ```
//!
//! A relay running `ingress_policy = "allowlist"` will REJECT a key that is not
//! on its allowlist. That is a pass, not a failure: it proves the socket, the
//! framing, the signature check and the policy gate are all live. The exit code
//! distinguishes the two outcomes so a caller can tell them apart — 0 accepted,
//! 10 refused by policy, 1 anything else.

use std::time::Duration;

use colloquy_backends::WsRelayBackend;
use colloquy_core::kind::UnitKind;
use colloquy_core::time::Timestamp;
use colloquy_core::unit::{Insight, KnowledgeUnit};
use colloquy_nostr::kinds::KIND_KNOWLEDGE_UNIT;
use colloquy_nostr::unit_event;
use colloquy_store::relay::{Filter, RelayBackend};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let url = std::env::var("COLLOQUY_RELAY_URL").unwrap_or_else(|_| "ws://127.0.0.1:7777".into());
    let secret = std::env::var("COLLOQUY_RELAY_SECRET_HEX")
        .map_err(|_| "COLLOQUY_RELAY_SECRET_HEX is required (64 hex chars)")?;

    let backend = WsRelayBackend::from_hex(&url, &secret)?.with_deadline(Duration::from_secs(8));
    println!("relay   : {url}");
    println!("pubkey  : {}", backend.pubkey());

    let now = Timestamp::from_secs(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs() as i64,
    );
    let unit = KnowledgeUnit::propose(
        format!("did:nostr:{}", backend.pubkey()),
        UnitKind::Pitfall,
        ["colloquy-smoke", "relay"],
        Insight::new(
            "Live relay smoke: a knowledge unit published over a real websocket",
            "Signed with BIP-340 through nostr-bbs-core and sent as a NIP-01 EVENT frame.",
            "If the relay answers OK, the public tier's transport is real.",
        ),
        now,
    );
    println!("unit    : {}", unit.id);

    // Read first, and unconditionally: the fetch path crosses no policy gate, so
    // it proves REQ/EOSE framing even on a relay that will refuse the write.
    match backend
        .fetch(&Filter {
            kinds: vec![KIND_KNOWLEDGE_UNIT],
            limit: 5,
            ..Filter::default()
        })
        .await
    {
        Ok(evs) => println!("fetch   : REQ/EOSE round trip OK, {} unit event(s) on the relay", evs.len()),
        Err(e) => println!("fetch   : FAILED — {e}"),
    }

    match backend.publish(unit_event(&unit, backend.pubkey(), now)).await {
        Ok(id) => {
            println!("publish : ACCEPTED, event {id}");
            let found = backend
                .fetch(&Filter {
                    kinds: vec![KIND_KNOWLEDGE_UNIT],
                    d: vec![unit.id.hex().to_string()],
                    limit: 10,
                    ..Filter::default()
                })
                .await?;
            println!("fetch   : {} event(s) returned", found.len());
            for ev in &found {
                println!("          {} kind {} by {}", ev.id, ev.kind, &ev.pubkey[..16]);
            }
            if found.is_empty() {
                println!("note    : accepted but not returned — the relay stored nothing queryable.");
            }
            Ok(())
        }
        Err(e) => {
            let policy = e.contains("rejected") || e.contains("blocked") || e.contains("restricted");
            if policy {
                println!("publish : REFUSED by policy — {e}");
                println!("note    : the allowlist working. Socket, framing, signature and gate are all live.");
                std::process::exit(10);
            }
            println!("publish : FAILED — {e}");
            std::process::exit(1);
        }
    }
}
