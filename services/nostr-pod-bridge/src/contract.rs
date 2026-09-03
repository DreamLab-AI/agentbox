//! did:nostr Multikey documents and the ADR-124 web-contract substrate.
//!
//! Two layers of the sovereign identity live here, both ported from
//! `scripts/sovereign-bootstrap.py`:
//!
//! * the **DID document** (ADR-033): the canonical did-nostr CG single-Multikey
//!   form, written both at the pod-git root (`agent.did.json`) and inside the
//!   pod (`did-nostr.json`, with the WebID in `alsoKnownAs`);
//! * the **web contract** (ADR-124): `gitmark.json` + `blocktrails.json`
//!   anchored on the pod's REAL git surface, so the trail's `states[]` holds
//!   actual pod commit SHAs rather than placeholders.
//!
//! Neither layer changes any key bytes (ADR-033 I1) — the `did:nostr` identity
//! string is derived from the x-only pubkey and is untouched by anything here.

use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::identity::{write_json, Identity};

/// did-nostr Multikey prefix: `f` (base16-lower multibase) ‖ `e701` (varint
/// multicodec `secp256k1-pub`) ‖ `02` (SEC1 compressed even-y prefix). The `02`
/// is load-bearing multicodec payload, not a separator — BIP-340 `lift_x`
/// always yields even y, so it is invariantly `02`. `publicKeyMultibase` is a
/// fixed 71 characters and round-trips to the identical key (ADR-033 I2).
pub const MULTIKEY_PREFIX: &str = "fe70102";

// ── DID document (ADR-033 / did:nostr CG single Multikey form) ───────────────

#[derive(Debug, Serialize)]
pub struct VerificationMethod {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub controller: String,
    #[serde(rename = "publicKeyMultibase")]
    pub public_key_multibase: String,
}

#[derive(Debug, Serialize)]
pub struct DidDocument {
    #[serde(rename = "@context")]
    pub context: [&'static str; 2],
    pub id: String,
    #[serde(rename = "type")]
    pub type_: &'static str,
    #[serde(rename = "verificationMethod")]
    pub verification_method: Vec<VerificationMethod>,
    pub authentication: [&'static str; 1],
    #[serde(rename = "assertionMethod")]
    pub assertion_method: [&'static str; 1],
    /// The did:nostr CG omit-when-empty field model: optional members are
    /// omitted when absent — never an empty array. The pod-profile WebID and
    /// any other identity link goes here, the spec's canonical location for
    /// cross-platform identity.
    #[serde(rename = "alsoKnownAs", skip_serializing_if = "Option::is_none")]
    pub also_known_as: Option<Vec<String>>,
}

/// Build the canonical did-nostr CG single-Multikey DID document.
///
/// Ground truth: `melvincarvalho/create-agent` index.js and
/// nostrcg.github.io/did-nostr. Supersedes the ADR-074 D2 2019 suite shape
/// (ADR-033); ADR-074 D1 — x-only hex is the canonical identity — still holds.
pub fn build_did_document(identity: &Identity, also_known_as: Option<Vec<String>>) -> DidDocument {
    let x_only = identity.x_only_pubkey_hex.to_lowercase();
    let did = format!("did:nostr:{x_only}");
    DidDocument {
        // @context[0] is the Controlled Identifiers v1.0 context, which is what
        // defines Multikey.
        context: [
            "https://www.w3.org/ns/cid/v1",
            "https://w3id.org/nostr/context",
        ],
        id: did.clone(),
        type_: "DIDNostr",
        verification_method: vec![VerificationMethod {
            id: format!("{did}#key1"),
            type_: "Multikey".to_string(),
            controller: did,
            public_key_multibase: format!("{MULTIKEY_PREFIX}{x_only}"),
        }],
        authentication: ["#key1"],
        assertion_method: ["#key1"],
        also_known_as: also_known_as.filter(|a| !a.is_empty()),
    }
}

// ── gitmark / blocktrails (ADR-124 web-contract substrate) ───────────────────

/// The verbatim 5-key create-agent ground-truth gitmark envelope (ADR-033
/// build-out note / ADR-124 §5). `@context`/`@type`/`commit`/`parent` are
/// deliberately *not* in the file — parent linkage lives in
/// `blocktrails.json`'s `states[]` / `txo[]`.
#[derive(Debug, Serialize)]
pub struct Gitmark {
    #[serde(rename = "@id")]
    pub id: String,
    pub genesis: String,
    pub nick: String,
    pub package: String,
    pub repository: String,
}

/// Reconstructed Blocktrail (webcontracts.org reference shape). `profile` is
/// `gitmark`, a BIP-341 single-use-seal chain. `states[]` holds REAL pod commit
/// SHAs; `txo[]` is the UTXO/seal chain, empty until an L1 single-use seal is
/// opened — honest-or-caught L0 until then, per the ADR-124 trust model.
#[derive(Debug, Serialize)]
pub struct Blocktrail {
    #[serde(rename = "@type")]
    pub type_: &'static str,
    pub profile: &'static str,
    pub genesis: String,
    pub states: Vec<String>,
    pub txo: Vec<String>,
}

/// `gitmark:<genesis-sha>:<vout=0>` envelope for a pod repository.
pub fn build_gitmark(identity: &Identity, genesis_sha: &str, package: &str) -> Gitmark {
    Gitmark {
        id: format!("gitmark:{genesis_sha}:0"),
        genesis: genesis_sha.to_string(),
        nick: identity.agent_id.clone(),
        package: package.to_string(),
        repository: identity.did(),
    }
}

/// Blocktrail over `states`, with an empty single-use-seal chain.
pub fn build_blocktrail(genesis_sha: &str, states: Vec<String>) -> Blocktrail {
    Blocktrail {
        type_: "Blocktrail",
        profile: "gitmark",
        genesis: genesis_sha.to_string(),
        states,
        txo: Vec::new(),
    }
}

// ── git plumbing ─────────────────────────────────────────────────────────────

/// Run `git` scoped to `repo_root`, returning trimmed stdout.
///
/// `-c safe.directory=*` is injected per invocation (never persisted to any
/// config) so the root bootstrap can operate on a pre-existing pod `.git` owned
/// by devuser without tripping git's dubious-ownership guard. Without it,
/// `git config nostr.privkey` and the gitmark/blocktrails commits silently fail
/// on pods whose `.git` predates the current provisioning pass.
pub fn git(repo_root: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .args(["-c", "safe.directory=*", "-C"])
        .arg(repo_root)
        .args(args)
        .stderr(Stdio::null())
        .output()
        .with_context(|| format!("spawning git {}", args.join(" ")))?;
    if !out.status.success() {
        return Err(anyhow!(
            "git {} failed with status {}",
            args.join(" "),
            out.status
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// `git …` with `check=False`: a non-zero exit yields an empty string.
fn git_lenient(repo_root: &Path, args: &[&str]) -> String {
    git(repo_root, args).unwrap_or_default()
}

/// Initialise the per-user pod as a full git repo if it is not one already
/// (create-agent layout: the pod *is* a git repo). Idempotent.
///
/// A repo-scoped committer identity is set so commit SHAs stay reproducible
/// enough for the gitmark/blocktrails trail, and so the agent commits as its own
/// `did:nostr` — no human identity leaks in. Global config is never touched.
pub fn ensure_pod_git(repo_root: &Path, identity: &Identity) -> bool {
    if std::fs::create_dir_all(repo_root).is_err() {
        return false;
    }
    if !repo_root.join(".git").exists() && git(repo_root, &["init", "-q"]).is_err() {
        return false;
    }
    let did = identity.did();
    git_lenient(repo_root, &["config", "user.name", &identity.agent_id]);
    git_lenient(
        repo_root,
        &["config", "user.email", &format!("{did}@agentbox.local")],
    );
    true
}

/// Commit `paths` under `message` when anything is actually staged, returning
/// the resulting HEAD SHA. Idempotent re-runs stage nothing and simply report
/// the existing tip.
fn stage_and_commit(repo_root: &Path, paths: &[&str], message: &str) -> Result<String> {
    let mut add = vec!["add"];
    add.extend_from_slice(paths);
    git(repo_root, &add)?;
    let staged = git_lenient(repo_root, &["diff", "--cached", "--name-only"]);
    if !staged.is_empty() {
        git(repo_root, &["commit", "-q", "-m", message])?;
    }
    git(repo_root, &["rev-parse", "HEAD"])
}

/// ADR-124 build-out: anchor the four-layer web contract (reducer / state /
/// ledger / trail) onto the REAL per-user pod git.
///
/// The deploy ritual on the live surface: write `agent.did.json` +
/// `gitmark.json` + `blocktrails.json`, commit, then record the real commit SHAs
/// in `blocktrails.states[]`. No stub — `states[]` holds actual pod commit SHAs.
///
/// Honest-or-caught (L0): the trail tip is a real git commit, not yet a
/// confirmed transaction. The single-use-seal `txo[]` upgrade seam to trustless
/// (RGB/DLC) is reserved but empty. Changes no key bytes (ADR-033 I1); the
/// `did:nostr` identity string is untouched.
pub fn wire_pod_contract_substrate(identity: &Identity, repo_root: &Path) -> Result<()> {
    // 1. edit: place the canonical Multikey DID doc + key at the pod-git root.
    write_json(
        &repo_root.join("agent.did.json"),
        &build_did_document(identity, None),
    )?;
    // Non-fatal: identity.env remains the canonical key source.
    git_lenient(
        repo_root,
        &["config", "nostr.privkey", &identity.private_key_hex],
    );

    // 2. genesis commit: stage agent.did.json so the trail has a real anchor.
    let genesis_sha = match stage_and_commit(
        repo_root,
        &["agent.did.json"],
        "chore(identity): publish did:nostr Multikey doc (ADR-033)",
    ) {
        Ok(sha) if !sha.is_empty() => sha,
        // No usable HEAD — leave identity.env as the source of truth.
        _ => return Ok(()),
    };

    // 3. git-mark: gitmark.json (5-key) + blocktrails.json whose states[] holds
    //    the genesis commit SHA, then commit both. The follow-up commit SHA is
    //    appended so the trail tip is the live HEAD.
    write_json(
        &repo_root.join("gitmark.json"),
        &build_gitmark(identity, &genesis_sha, "agentbox-pod"),
    )?;
    write_json(
        &repo_root.join("blocktrails.json"),
        &build_blocktrail(&genesis_sha, vec![genesis_sha.clone()]),
    )?;

    // Contract anchoring is best-effort: the identity write has already landed.
    let tip = match stage_and_commit(
        repo_root,
        &["gitmark.json", "blocktrails.json"],
        "chore(contract): anchor gitmark + blocktrails (ADR-124)",
    ) {
        Ok(sha) => sha,
        Err(_) => return Ok(()),
    };
    if !tip.is_empty() && tip != genesis_sha {
        // Advance the trail tip to the real contract-anchor commit SHA.
        write_json(
            &repo_root.join("blocktrails.json"),
            &build_blocktrail(&genesis_sha.clone(), vec![genesis_sha, tip]),
        )?;
        let _ = stage_and_commit(
            repo_root,
            &["blocktrails.json"],
            "chore(contract): advance blocktrails tip to anchor SHA (ADR-124)",
        );
    }
    Ok(())
}

/// DreamLab convention (inspired by create-agent's key/document separation, not
/// its layout): initialise the pod git if needed, write `agent.did.json` into
/// the repo root, set `git config nostr.privkey <hex>`, and wire the ADR-124
/// contract substrate with REAL commit SHAs. Additive to `identity.env`; changes
/// no key bytes (ADR-033 I1).
pub fn write_agent_repo_identity(identity: &Identity, repo_root: &Path) -> Result<()> {
    if !ensure_pod_git(repo_root, identity) {
        return Ok(()); // git unavailable — identity.env remains the truth.
    }
    wire_pod_contract_substrate(identity, repo_root)
}
