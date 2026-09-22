//! Delivery (SPEC 11): a transaction reaches a producer by `POST /tx`, body
//! the hex, or as a kind 23500 event on a relay, content the hex, tagged
//! `chain` = chain id; a wallet with nothing publishes a kind 23501 event,
//! content an address, and a faucet may answer. A port of
//! `siding/lib/spend.mjs deliver` and the producer's routes in
//! `siding/bin/siding.mjs` (`/coins/<script>`, `/tip`, `/chain.json`,
//! `POST /tx`).
//!
//! Everything here is data: the URL and body to post, the event template
//! to sign. Signing the event is `sidestr-nostr`'s (the event's key is
//! anyone's: the transaction authorises itself), and the HTTP round trip is
//! behind feature `client` (the `client` module) so the default build does no I/O.
//!
//! ```
//! use sidestr_wallet::deliver::{coins_url, parse_tx_response, tx_event, tx_post, TX_KIND};
//!
//! let post = tx_post("http://127.0.0.1:3450/", "0200000001…");
//! assert_eq!((post.url.as_str(), post.body.as_str()), ("http://127.0.0.1:3450/tx", "0200000001…"));
//! assert_eq!(coins_url("http://127.0.0.1:3450", "5120AB"), "http://127.0.0.1:3450/coins/5120ab");
//!
//! let ev = tx_event("sidestr:trial", "0200000001…", 1790000000);
//! assert_eq!((ev.kind, ev.tags[0].as_slice()), (TX_KIND, &["chain".to_string(), "sidestr:trial".to_string()][..]));
//!
//! let ok = parse_tx_response(r#"{"txid":"ab","fee":111,"vsize":111}"#).unwrap();
//! assert_eq!((ok.txid.as_str(), ok.fee), ("ab", Some(111)));
//! assert!(parse_tx_response(r#"{"error":"input 0: invalid key-path schnorr signature"}"#).is_err());
//! ```

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// A transaction as an event: kind 23500, content the hex, tag `chain`
/// (SPEC 11, Appendix A).
pub const TX_KIND: u32 = 23500;
/// A faucet request: kind 23501, content an address, tag `chain`.
pub const FAUCET_KIND: u32 = 23501;

/// `POST /tx`: where and what.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TxPost {
    /// `<base>/tx`.
    pub url: String,
    /// The transaction hex, the whole body.
    pub body: String,
}

fn base(url: &str) -> &str {
    url.trim().trim_end_matches('/')
}

/// The `POST /tx` request for a producer at `base_url`.
pub fn tx_post(base_url: &str, hex: &str) -> TxPost {
    TxPost {
        url: format!("{}/tx", base(base_url)),
        body: hex.trim().to_string(),
    }
}

/// `<base>/coins/<script hex, lower case>`.
pub fn coins_url(base_url: &str, script_hex: &str) -> String {
    format!(
        "{}/coins/{}",
        base(base_url),
        script_hex.trim().to_ascii_lowercase()
    )
}

/// `<base>/tip`.
pub fn tip_url(base_url: &str) -> String {
    format!("{}/tip", base(base_url))
}

/// `<base>/chain.json`.
pub fn chain_url(base_url: &str) -> String {
    format!("{}/chain.json", base(base_url))
}

/// An unsigned Nostr event, the fields a signer fills the rest around
/// (`siding/lib/relay.mjs makeEvents`). Relays index single-letter tags
/// only, so a producer subscribes by kind and checks `chain` on receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventTemplate {
    /// 23500 or 23501.
    pub kind: u32,
    /// Seconds since the epoch.
    pub created_at: u64,
    /// `[["chain", <chain id>]]`.
    pub tags: Vec<Vec<String>>,
    /// The transaction hex, or the address for a faucet request.
    pub content: String,
}

/// The kind-23500 template carrying a transaction for `chain_id`.
pub fn tx_event(chain_id: &str, hex: &str, created_at: u64) -> EventTemplate {
    EventTemplate {
        kind: TX_KIND,
        created_at,
        tags: vec![vec!["chain".to_string(), chain_id.to_string()]],
        content: hex.trim().to_string(),
    }
}

/// The kind-23501 template asking a faucet for coins at `address`.
pub fn faucet_request(chain_id: &str, address: &str, created_at: u64) -> EventTemplate {
    EventTemplate {
        kind: FAUCET_KIND,
        created_at,
        tags: vec![vec!["chain".to_string(), chain_id.to_string()]],
        content: address.trim().to_string(),
    }
}

/// What a producer answers a `POST /tx` with when it accepts
/// ([`sidestr_core::state::Submitted`] as JSON; `dup` when it was already
/// in the mempool).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Accepted {
    /// The transaction id.
    pub txid: String,
    /// The fee it pays (absent for a duplicate).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fee: Option<u64>,
    /// Its virtual size.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vsize: Option<u64>,
    /// It was already known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dup: Option<bool>,
}

/// The producer's tip (`/tip`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tip {
    /// Height.
    pub height: u32,
    /// Block hash, display order.
    pub hash: String,
    /// Header time.
    pub time: u32,
}

/// A `POST /tx` body: [`Accepted`], or [`Error::Refused`] with the
/// producer's reason (`{"error": …}`).
pub fn parse_tx_response(text: &str) -> Result<Accepted> {
    #[derive(Deserialize)]
    struct Reply {
        error: Option<String>,
        #[serde(flatten)]
        ok: Option<Accepted>,
    }
    let r: Reply = serde_json::from_str(text)?;
    if let Some(e) = r.error {
        return Err(Error::Refused(e));
    }
    r.ok.ok_or_else(|| Error::Encoding(format!("not a producer reply: {text}")))
}

/// The HTTP round trips, plain and blocking, over `ureq` (feature
/// `client`). Never a relay publish: that is `sidestr-nostr`'s.
#[cfg(feature = "client")]
pub mod client {
    use super::{chain_url, coins_url, parse_tx_response, tip_url, tx_post, Accepted, Tip};
    use crate::coins::{from_json, Coin};
    use crate::error::{Error, Result};
    use sidestr_core::document::ChainDocument;

    fn agent() -> ureq::Agent {
        // a 4xx carries the producer's JSON reason: read it rather than fail on the status
        ureq::Agent::new_with_config(
            ureq::Agent::config_builder()
                .http_status_as_error(false)
                .build(),
        )
    }

    fn get(url: &str) -> Result<String> {
        agent()
            .get(url)
            .call()
            .map_err(|e| Error::Http(e.to_string()))?
            .body_mut()
            .read_to_string()
            .map_err(|e| Error::Http(e.to_string()))
    }

    /// `GET /coins/<script hex>`.
    pub fn coins(base_url: &str, script_hex: &str) -> Result<Vec<Coin>> {
        from_json(&get(&coins_url(base_url, script_hex))?)
    }

    /// `GET /tip`.
    pub fn tip(base_url: &str) -> Result<Tip> {
        Ok(serde_json::from_str(&get(&tip_url(base_url))?)?)
    }

    /// `GET /chain.json`.
    pub fn chain(base_url: &str) -> Result<ChainDocument> {
        Ok(ChainDocument::from_json(&get(&chain_url(base_url))?)?)
    }

    /// `POST /tx` with the hex; the producer's verdict.
    pub fn post_tx(base_url: &str, hex: &str) -> Result<Accepted> {
        let p = tx_post(base_url, hex);
        let text = agent()
            .post(&p.url)
            .content_type("text/plain")
            .send(p.body.as_bytes())
            .map_err(|e| Error::Http(e.to_string()))?
            .body_mut()
            .read_to_string()
            .map_err(|e| Error::Http(e.to_string()))?;
        parse_tx_response(&text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_and_replies() {
        assert_eq!(tip_url("http://h:1/"), "http://h:1/tip");
        assert_eq!(chain_url("http://h:1"), "http://h:1/chain.json");
        let dup = parse_tx_response(r#"{"txid":"ab","dup":true}"#).unwrap();
        assert_eq!(dup.dup, Some(true));
        assert!(
            matches!(parse_tx_response(r#"{"error":"no"}"#), Err(Error::Refused(e)) if e == "no")
        );
        assert!(parse_tx_response("{}").is_err());
        let f = faucet_request("sidestr:trial", "trl1p…", 1);
        assert_eq!(f.kind, FAUCET_KIND);
        assert!(serde_json::to_string(&f)
            .unwrap()
            .contains("\"kind\":23501"));
    }
}
