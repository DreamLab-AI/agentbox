//! `colloquy-mcp` — the six verbs over stdio, against a configured tier.
//!
//! # Tiers
//!
//! | `COLLOQUY_TIER` | Store | Transport |
//! |---|---|---|
//! | `local` (default) | append-only JSON-lines file, or memory | none |
//! | `shared` | RuVector | the governed `ruvector-mcp.cjs`, spawned as a child |
//! | `public` | the sovereign Nostr relay | websocket, events signed with this container's key |
//!
//! Nothing here is a stand-in: `shared` talks to the same governed memory server
//! the rest of the estate uses, so the embedding pipeline and the
//! protected-namespace gates apply unchanged, and `public` opens a real socket
//! and signs with a real key.
//!
//! # Configuration
//!
//! | Variable | Meaning | Default |
//! |---|---|---|
//! | `COLLOQUY_TIER` | `local`, `shared`, or `public`. | `local` |
//! | `COLLOQUY_MEMBER` | This agent's member identity (`did:nostr:…`). | required |
//! | `COLLOQUY_PRINCIPAL` | The authorising principal. Must differ from the member. | required |
//! | `COLLOQUY_CLASS` | `agent` or `human`. | `agent` |
//! | `COLLOQUY_WOT` | Web-of-trust score for a human principal, `0.0..=1.0`. | `0.0` |
//! | `COLLOQUY_STORE_PATH` | *local:* append-log file. Unset means in-memory. | in-memory |
//! | `COLLOQUY_NAMESPACE` | *shared:* RuVector namespace. | `colloquy` |
//! | `COLLOQUY_RUVECTOR_SERVER` | *shared:* path to the governed memory server. | `/opt/agentbox/mcp/servers/ruvector-mcp.cjs` |
//! | `COLLOQUY_RELAY_URL` | *public:* relay websocket. | `ws://127.0.0.1:7777` |
//! | `COLLOQUY_RELAY_SECRET_HEX` | *public:* 32-byte signing key, hex. Falls back to `AGENTBOX_SECRET_KEY`. | required for `public` |
//! | `COLLOQUY_REGISTRY_JSON` | *public:* agent-disclosure JSON, as `/api/agents/disclosure` serves it. | required for `public` |

use std::time::{SystemTime, UNIX_EPOCH};

use colloquy_backends::{RuvectorBackend, WsRelayBackend};
use colloquy_core::principal::MemberClass;
use colloquy_core::Timestamp;
use colloquy_mcp::server::Server;
use colloquy_mcp::verbs::Identity;
use colloquy_nostr::ledger::StaticRegistry;
use colloquy_store::{KnowledgeStore, LocalStore, RelayStore, SharedStore};

/// Read the wall clock. The libraries take `now` as an argument precisely so
/// this is the only place in the system that calls it.
fn now() -> Timestamp {
    Timestamp::from_secs(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
    )
}

fn required(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| {
        format!(
            "{name} is required. This server attests on behalf of a member, and a member that \
             cannot be identified cannot attest — set {name} to the identity this agent runs as."
        )
    })
}

fn identity() -> Result<Identity, String> {
    let member = required("COLLOQUY_MEMBER")?;
    let principal = required("COLLOQUY_PRINCIPAL")?;
    let class = match std::env::var("COLLOQUY_CLASS").as_deref() {
        Ok("human") => MemberClass::Human,
        Ok("agent") | Err(_) => MemberClass::Agent,
        Ok(other) => {
            return Err(format!(
                "COLLOQUY_CLASS must be `agent` or `human`, not `{other}`"
            ))
        }
    };
    let wot = std::env::var("COLLOQUY_WOT")
        .ok()
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(0.0)
        .clamp(0.0, 1.0);

    if class == MemberClass::Agent && principal == member {
        // An agent that authorises itself defeats principal collapse: the whole
        // trust model rests on an agent's principal being someone else.
        return Err(
            "COLLOQUY_PRINCIPAL must differ from COLLOQUY_MEMBER for an agent — an agent's \
             authorising principal is whoever registered it, never itself."
                .into(),
        );
    }

    Ok(Identity {
        member,
        principal,
        class,
        wot,
    })
}

/// Load the membership registry from a disclosure document.
///
/// The shape is the relay's `GET /api/agents/disclosure` response: a list of
/// `{pubkey, name, registered_by}`. Anyone absent from it is **not** counted as
/// their own principal — see ADR-2086; the registry is the only thing that turns
/// a pubkey into evidence.
fn registry_from_json(text: &str) -> Result<StaticRegistry, String> {
    #[derive(serde::Deserialize)]
    struct Row {
        pubkey: String,
        #[serde(default)]
        registered_by: String,
    }
    let rows: Vec<Row> = serde_json::from_str(text)
        .or_else(|_| {
            serde_json::from_str::<serde_json::Value>(text)
                .ok()
                .and_then(|v| v.get("agents").cloned())
                .ok_or(())
                .and_then(|a| serde_json::from_value::<Vec<Row>>(a).map_err(|_| ()))
                .map_err(|_| "not a disclosure document".to_string())
        })
        .map_err(|e| format!("COLLOQUY_REGISTRY_JSON: {e}"))?;

    let mut reg = StaticRegistry::default();
    for r in rows {
        if r.registered_by.is_empty() {
            reg.register_human(r.pubkey, 0.0);
        } else {
            reg.register_agent(r.pubkey, r.registered_by);
        }
    }
    Ok(reg)
}

async fn build_store() -> Result<(Box<dyn KnowledgeStore>, String), String> {
    let tier = std::env::var("COLLOQUY_TIER").unwrap_or_else(|_| "local".into());
    match tier.as_str() {
        "local" => {
            let store = match std::env::var("COLLOQUY_STORE_PATH") {
                Ok(path) => LocalStore::open(&path).await.map_err(|e| e.to_string())?,
                Err(_) => LocalStore::in_memory(),
            };
            Ok((Box::new(store), "local".into()))
        }
        "shared" => {
            let server = std::env::var("COLLOQUY_RUVECTOR_SERVER")
                .unwrap_or_else(|_| colloquy_backends::ruvector::DEFAULT_SERVER.to_string());
            let namespace =
                std::env::var("COLLOQUY_NAMESPACE").unwrap_or_else(|_| "colloquy".into());
            let backend = RuvectorBackend::spawn(&server, &RuvectorBackend::env_from_process())
                .await
                .map_err(|e| {
                    format!("could not start the governed memory server `{server}`: {e}")
                })?;
            Ok((
                Box::new(SharedStore::new(backend, namespace.clone())),
                format!("shared (RuVector namespace `{namespace}`)"),
            ))
        }
        "public" => {
            let url = std::env::var("COLLOQUY_RELAY_URL")
                .unwrap_or_else(|_| "ws://127.0.0.1:7777".into());
            let secret = std::env::var("COLLOQUY_RELAY_SECRET_HEX")
                .or_else(|_| std::env::var("AGENTBOX_SECRET_KEY"))
                .map_err(|_| {
                    "COLLOQUY_RELAY_SECRET_HEX (or AGENTBOX_SECRET_KEY) is required for the public \
                     tier — events must be signed, and this process holds no key otherwise."
                        .to_string()
                })?;
            let registry = registry_from_json(&required("COLLOQUY_REGISTRY_JSON")?)?;
            let backend = WsRelayBackend::from_hex(&url, &secret).map_err(|e| e.to_string())?;
            Ok((
                Box::new(RelayStore::new(backend, registry)),
                format!("public (relay {url})"),
            ))
        }
        other => Err(format!(
            "COLLOQUY_TIER must be `local`, `shared` or `public`, not `{other}`"
        )),
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let identity = match identity() {
        Ok(i) => i,
        Err(e) => {
            eprintln!("colloquy-mcp: {e}");
            std::process::exit(2);
        }
    };

    let (store, description) = match build_store().await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("colloquy-mcp: {e}");
            std::process::exit(3);
        }
    };

    eprintln!(
        "colloquy-mcp {}: {description}, acting as {} under {}",
        env!("CARGO_PKG_VERSION"),
        identity.member,
        identity.principal
    );

    Server::new(store, identity).serve_stdio(now).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_disclosure_document_maps_agents_to_their_authorising_principal() {
        let reg = registry_from_json(
            r#"[{"pubkey":"aa","name":"scribe","registered_by":"op-1"},
                {"pubkey":"bb","name":"auditor","registered_by":"op-2"}]"#,
        )
        .unwrap();
        use colloquy_nostr::ledger::PrincipalResolver;
        assert_eq!(reg.resolve("aa").unwrap().principal.as_str(), "op-1");
        assert_eq!(reg.resolve("bb").unwrap().principal.as_str(), "op-2");
        assert!(
            reg.resolve("cc").is_none(),
            "an absent pubkey must not resolve"
        );
    }

    #[test]
    fn a_wrapped_disclosure_document_is_accepted_too() {
        let reg =
            registry_from_json(r#"{"agents":[{"pubkey":"aa","name":"s","registered_by":"op"}]}"#)
                .unwrap();
        use colloquy_nostr::ledger::PrincipalResolver;
        assert!(reg.resolve("aa").is_some());
    }

    #[test]
    fn a_row_with_no_registrar_is_a_person_and_their_own_principal() {
        let reg = registry_from_json(r#"[{"pubkey":"alice","name":"alice","registered_by":""}]"#)
            .unwrap();
        use colloquy_nostr::ledger::PrincipalResolver;
        let m = reg.resolve("alice").unwrap();
        assert_eq!(m.principal.as_str(), "alice");
        assert_eq!(m.class, MemberClass::Human);
    }

    #[test]
    fn a_malformed_disclosure_document_is_refused() {
        assert!(registry_from_json("not json").is_err());
    }
}
