//! `nostr-receipt`: issue and verify signed did:nostr receipts.
//!
//! ```text
//! nostr-receipt keygen --out KEYFILE
//! nostr-receipt disclose --key KEYFILE --memory HEX --salt HEX --query TEXT --answer TEXT
//!                        --sigma S --clip C --epsilon E --delta D [--requester DID] [--prev ID]
//! nostr-receipt revoke   --key KEYFILE --memory HEX --document TEXT
//!                        --sigma S --clip C --epsilon E --delta D [--prev ID]
//! nostr-receipt verify   [--file RECEIPT.json] [--salt HEX --query TEXT --answer TEXT] [--human]
//! nostr-receipt bench    [--n N]
//! ```
//!
//! `verify` prints a JSON verdict for agents (or plain sentences with `--human`) and exits 0 only
//! when the receipt is valid and, if a question and answer were given, they match it.

use nostr_bbs_core::event::NostrEvent;
use nostr_receipt::{did_nostr, issue, matches, salted_hash, sha256_hex, verify, Body, KeySigner, Mechanism, Receipt, Signer};
use std::collections::HashMap;
use std::process::ExitCode;

fn flags(args: &[String]) -> Result<HashMap<String, String>, String> {
    let mut out = HashMap::new();
    let mut i = 0;
    while i < args.len() {
        let k = args[i].strip_prefix("--").ok_or_else(|| format!("unexpected argument {:?}", args[i]))?;
        if k == "human" {
            out.insert(k.to_string(), String::new());
            i += 1;
            continue;
        }
        let v = args.get(i + 1).ok_or_else(|| format!("--{k} needs a value"))?;
        out.insert(k.to_string(), v.clone());
        i += 2;
    }
    Ok(out)
}

fn need<'a>(f: &'a HashMap<String, String>, k: &str) -> Result<&'a str, String> {
    f.get(k).map(String::as_str).ok_or_else(|| format!("--{k} is required"))
}

fn number(f: &HashMap<String, String>, k: &str) -> Result<f64, String> {
    need(f, k)?.parse().map_err(|_| format!("--{k} must be a number"))
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn signer(f: &HashMap<String, String>) -> Result<KeySigner, String> {
    let secret = std::fs::read_to_string(need(f, "key")?).map_err(|e| e.to_string())?;
    KeySigner::from_secret_hex(&secret).map_err(|e| e.to_string())
}

fn mechanism(f: &HashMap<String, String>) -> Result<Mechanism, String> {
    Ok(Mechanism {
        name: f.get("mechanism").cloned().unwrap_or_else(|| "gaussian".into()),
        sigma: number(f, "sigma")?,
        clip: number(f, "clip")?,
        epsilon: number(f, "epsilon")?,
        delta: number(f, "delta")?,
    })
}

fn run(args: &[String]) -> Result<bool, String> {
    let (cmd, rest) = args.split_first().ok_or("usage: nostr-receipt keygen|disclose|revoke|verify|bench")?;
    let f = flags(rest)?;
    match cmd.as_str() {
        "keygen" => {
            let path = need(&f, "out")?;
            let (s, secret) = KeySigner::generate().map_err(|e| e.to_string())?;
            write_secret(path, &secret)?;
            println!("{}", serde_json::json!({"did": did_nostr(&s.pubkey_hex()), "key_file": path}));
            Ok(true)
        }
        "disclose" | "revoke" => {
            let s = signer(&f)?;
            let body = if cmd == "disclose" {
                let salt = hex::decode(need(&f, "salt")?).map_err(|e| format!("--salt: {e}"))?;
                Body::Disclosure {
                    query_hash: salted_hash(&salt, need(&f, "query")?),
                    answer_hash: sha256_hex(need(&f, "answer")?.as_bytes()),
                    requester: f.get("requester").cloned(),
                }
            } else {
                Body::Revocation { document_hash: sha256_hex(need(&f, "document")?.as_bytes()) }
            };
            let r = Receipt { memory: need(&f, "memory")?.to_string(), mechanism: mechanism(&f)?, body, prev: f.get("prev").cloned(), created_at: now() };
            let event = issue(&r, &s).map_err(|e| e.to_string())?;
            println!("{}", serde_json::to_string(&event).map_err(|e| e.to_string())?);
            Ok(true)
        }
        "verify" => {
            let text = match f.get("file") {
                Some(p) => std::fs::read_to_string(p).map_err(|e| e.to_string())?,
                None => std::io::read_to_string(std::io::stdin()).map_err(|e| e.to_string())?,
            };
            let human = f.contains_key("human");
            let event: NostrEvent = match serde_json::from_str(&text) {
                Ok(e) => e,
                Err(e) => return Ok(report(human, Err(format!("not a Nostr event: {e}")), None)),
            };
            let verdict = verify(&event).map_err(|e| e.to_string());
            let answer_check = match (&verdict, f.get("query"), f.get("answer")) {
                (Ok(v), Some(q), Some(a)) => {
                    let salt = hex::decode(f.get("salt").map(String::as_str).unwrap_or("")).map_err(|e| format!("--salt: {e}"))?;
                    Some(matches(v, &salt, q, a))
                }
                _ => None,
            };
            Ok(report(human, verdict, answer_check))
        }
        "bench" => {
            let n: usize = f.get("n").map(|s| s.parse()).transpose().map_err(|_| "--n must be a number")?.unwrap_or(10_000);
            let (s, _) = KeySigner::generate().map_err(|e| e.to_string())?;
            let r = Receipt {
                memory: "ab".repeat(32),
                mechanism: Mechanism { name: "gaussian".into(), sigma: 1.5, clip: 1.0, epsilon: 6.13, delta: 1e-5 },
                body: Body::Disclosure { query_hash: "cd".repeat(32), answer_hash: "ef".repeat(32), requester: None },
                prev: None,
                created_at: now(),
            };
            let t0 = std::time::Instant::now();
            let event = issue(&r, &s).map_err(|e| e.to_string())?;
            let issue_us = t0.elapsed().as_secs_f64() * 1e6;
            let t1 = std::time::Instant::now();
            for _ in 0..n {
                verify(&event).map_err(|e| e.to_string())?;
            }
            let per = t1.elapsed().as_secs_f64() * 1e6 / n as f64;
            let bytes = serde_json::to_string(&event).map_err(|e| e.to_string())?.len();
            println!("{}", serde_json::json!({"verifications": n, "verify_us_mean": per, "issue_us": issue_us, "receipt_bytes": bytes}));
            Ok(true)
        }
        other => Err(format!("unknown command {other}")),
    }
}

fn write_secret(path: &str, secret: &str) -> Result<(), String> {
    use std::io::Write;
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut o, 0o600);
    o.open(path).and_then(|mut f| f.write_all(secret.as_bytes())).map_err(|e| format!("{path}: {e}"))
}

fn report(human: bool, verdict: Result<nostr_receipt::Verified, String>, answer: Option<bool>) -> bool {
    let ok = verdict.is_ok() && answer != Some(false);
    if human {
        match &verdict {
            Err(e) => println!("INVALID receipt: {e}"),
            Ok(v) => {
                let m = &v.receipt.mechanism;
                let what = match &v.receipt.body {
                    Body::Disclosure { .. } => "an answer was released",
                    Body::Revocation { .. } => "a document was revoked",
                };
                println!("Valid receipt {} from {}.", &v.id[..12], v.issuer);
                println!("It states that {what} from memory {}, under a {} mechanism (sigma {}, clip {}),", &v.receipt.memory[..12], m.name, m.sigma, m.clip);
                println!("with a per-document guarantee of epsilon {} at delta {}.", m.epsilon, m.delta);
                if let Some(a) = answer {
                    println!("The question and answer you supplied {} this receipt.", if a { "match" } else { "do NOT match" });
                }
                println!("The signature proves who issued this and that it is unaltered; it does not prove the mechanism was applied.");
            }
        }
    } else {
        let j = match &verdict {
            Ok(v) => serde_json::json!({"valid": ok, "receipt": v, "answer_matches": answer}),
            Err(e) => serde_json::json!({"valid": false, "error": e}),
        };
        println!("{j}");
    }
    ok
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(1),
        Err(e) => {
            eprintln!("nostr-receipt: {e}");
            ExitCode::from(2)
        }
    }
}
