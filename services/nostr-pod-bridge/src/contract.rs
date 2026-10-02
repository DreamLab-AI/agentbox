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
//!   actual pod commit SHAs rather than placeholders. `blocktrails.json` is the
//!   blocktrails/spec git-mark profile §5.2 shape ([`crate::blocktrail`]).
//!
//! Neither layer changes any key bytes (ADR-033 I1) — the `did:nostr` identity
//! string is derived from the x-only pubkey and is untouched by anything here.

use anyhow::{anyhow, Context, Result};
use k256::elliptic_curve::sec1::ToEncodedPoint;
use serde::Serialize;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::blocktrail::{is_gitmark_commit, Blocktrail, BlocktrailTxo, GITMARK_NETWORK};
use crate::identity::{write_json, Identity};

/// did-nostr Multikey prefix: `f` (base16-lower multibase) ‖ `e701` (varint
/// multicodec `secp256k1-pub`) ‖ `02` (SEC1 compressed even-y prefix). The `02`
/// is load-bearing multicodec payload, not a separator — BIP-340 `lift_x`
/// always yields even y, so it is invariantly `02`. `publicKeyMultibase` is a
/// fixed 71 characters and round-trips to the identical key (ADR-033 I2).
pub const MULTIKEY_PREFIX: &str = "fe70102";

// ── DID document (ADR-033 / did:nostr CG single Multikey form) ───────────────

/// The single Multikey verification method of a did:nostr document.
#[derive(Debug, Serialize)]
pub struct VerificationMethod {
    /// `did:nostr:<x-only hex>#key1`.
    pub id: String,
    /// Always `Multikey`.
    #[serde(rename = "type")]
    pub type_: String,
    /// The DID that controls the key: the document's own `id`.
    pub controller: String,
    /// [`MULTIKEY_PREFIX`] followed by the x-only key (71 characters).
    #[serde(rename = "publicKeyMultibase")]
    pub public_key_multibase: String,
}

/// The canonical did-nostr CG single-Multikey DID document (ADR-033).
#[derive(Debug, Serialize)]
pub struct DidDocument {
    /// The Controlled Identifiers v1.0 context, then the nostr context.
    #[serde(rename = "@context")]
    pub context: [&'static str; 2],
    /// `did:nostr:<x-only hex>`.
    pub id: String,
    /// Always `DIDNostr`.
    #[serde(rename = "type")]
    pub type_: &'static str,
    /// The one Multikey method.
    #[serde(rename = "verificationMethod")]
    pub verification_method: Vec<VerificationMethod>,
    /// `["#key1"]`.
    pub authentication: [&'static str; 1],
    /// `["#key1"]`.
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
/// build-out note / ADR-124 §5), field for field solid-pod-rs
/// `provenance::GitMarkEnvelope`. `@context`/`@type`/`commit`/`parent` are
/// deliberately *not* in the file: parent linkage lives in `blocktrails.json`'s
/// `states[]` / `txo[]`.
#[derive(Debug, Serialize)]
pub struct Gitmark {
    /// `gitmark:<commit>:<vout>`: the mark's coordinate.
    #[serde(rename = "@id")]
    pub id: String,
    /// `gitmark:<genesis-commit>:0`: the trail's genesis mark.
    pub genesis: String,
    /// Short human name for the trail (the agent id).
    pub nick: String,
    /// The package the repository publishes.
    pub package: String,
    /// The repository's owner, as its `did:nostr` (solid-pod-rs writes the
    /// repo-relative `./` here; the pod keeps its identity).
    pub repository: String,
}

/// Where blocktrails/git-mark keeps a repository's marks: a JSON array of TXO
/// URIs, written by `git mark genesis` / `git mark advance` (git-mark b852d7d
/// `bin/git-mark.js`, `TXO_FILE`; blocktrails/spec git-mark profile §5.1).
pub const TXO_JSON_PATH: &str = ".well-known/txo/txo.json";

/// The chain a pod trail names before any mark exists: the sidestr git-mark
/// network ([`GITMARK_NETWORK`]), which blocktrails/git-mark maps to the
/// sidestr chain id `sidestr:gitmark`. Once marks exist the trail names the
/// chain their TXO URIs carry.
pub const POD_TRAIL_CHAIN: &str = GITMARK_NETWORK;

/// The pod identity's public key as a full compressed point (02/03 + x): the
/// base key a pod trail publishes as `pubkeyBase`.
///
/// Read from the identity's SEC1 `X ‖ Y` key with k256, so the prefix is the
/// point's real y parity. The bridge normalises every identity to BIP-340
/// even y, so in practice this is `02` + the x-only key; a `public_key_hex`
/// that does not parse falls back to exactly that (`lift_x`).
///
/// # Examples
///
/// ```
/// use nostr_pod_bridge::contract::pod_pubkey_base;
/// use nostr_pod_bridge::identity::keypair_from_privkey_hex;
/// # use nostr_pod_bridge::identity::Identity;
///
/// let km = keypair_from_privkey_hex(&format!("{:064x}", 3)).unwrap();
/// # let id = Identity { agent_id: "a".into(), created_at: 0,
/// #     private_key_hex: km.private_key_hex, public_key_hex: km.public_key_hex,
/// #     x_only_pubkey_hex: km.x_only_pubkey_hex.clone(), nsec: km.nsec, npub: km.npub };
/// assert_eq!(pod_pubkey_base(&id), format!("02{}", km.x_only_pubkey_hex));
/// ```
#[must_use]
pub fn pod_pubkey_base(identity: &Identity) -> String {
    let x_only = identity.x_only_pubkey_hex.to_lowercase();
    hex::decode(format!("04{}", identity.public_key_hex.trim()))
        .ok()
        .and_then(|sec1| k256::PublicKey::from_sec1_bytes(&sec1).ok())
        .map(|pk| hex::encode(pk.to_encoded_point(true).as_bytes()))
        .filter(|full| full[2..] == x_only)
        .unwrap_or_else(|| format!("02{x_only}"))
}

/// `gitmark:<genesis-sha>:<vout=0>` envelope for a pod repository; `genesis`
/// is the same coordinate (`gitmark:<genesis-sha>:0`), as solid-pod-rs
/// `GitMark::to_gitmark_envelope` writes it for the genesis mark.
pub fn build_gitmark(identity: &Identity, genesis_sha: &str, package: &str) -> Gitmark {
    let genesis = format!("gitmark:{genesis_sha}:0");
    Gitmark {
        id: genesis.clone(),
        genesis,
        nick: identity.agent_id.clone(),
        package: package.to_string(),
        repository: identity.did(),
    }
}

/// The pod's trail in the git-mark profile §5.2 shape: `version`, `profile`
/// `gitmark`, `pubkeyBase` (the pod identity as a full compressed point,
/// [`pod_pubkey_base`]), `chain`, `states` and `txo` as TXO URIs.
///
/// With marks (`txo` not empty) the trail names their chain; otherwise
/// [`POD_TRAIL_CHAIN`]. `states` is written as given: the caller passes one
/// commit per mark when there are marks, and the pod's real commit SHAs when
/// there are none (ADR-124 L0, honest-or-caught: a verifier then has nothing
/// to check on-chain and reads the trail as unanchored).
pub fn build_blocktrail(
    identity: &Identity,
    states: Vec<String>,
    txo: Vec<BlocktrailTxo>,
) -> Blocktrail {
    let chain = txo
        .first()
        .and_then(|t| t.chain.clone())
        .unwrap_or_else(|| POD_TRAIL_CHAIN.to_string());
    Blocktrail::gitmark(pod_pubkey_base(identity), chain, states, txo)
}

/// The marks recorded for the pod repository at `repo_root`
/// ([`TXO_JSON_PATH`]), or an empty list when it has none.
///
/// Read-only. Marks are used only when every entry is a TXO URI carrying its
/// commit (blocktrails/spec 282b096: `commit` is required) and all name one
/// chain; anything else is reported and treated as no marks, so a pod trail is
/// never written with a mark a verifier would have to guess at. The file
/// itself is never modified.
pub fn read_anchor_marks(repo_root: &Path) -> Vec<BlocktrailTxo> {
    let path = repo_root.join(TXO_JSON_PATH);
    let Ok(body) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    match parse_anchor_marks(&body) {
        Ok(marks) => marks,
        Err(why) => {
            tracing::warn!(path = %path.display(), "ignoring pod marks: {why}");
            Vec::new()
        }
    }
}

fn parse_anchor_marks(body: &str) -> Result<Vec<BlocktrailTxo>, String> {
    let uris: Vec<String> = serde_json::from_str(body).map_err(|e| e.to_string())?;
    let marks = uris
        .iter()
        .map(|u| BlocktrailTxo::parse_uri(u).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    if let Some(i) = marks
        .iter()
        .position(|m| !m.commit.as_deref().is_some_and(is_gitmark_commit))
    {
        return Err(format!("mark {i} has no commit hash"));
    }
    if marks.windows(2).any(|w| w[0].chain != w[1].chain) {
        return Err("the marks name more than one chain".into());
    }
    Ok(marks)
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
/// in `blocktrails.states[]`. No stub: `states[]` holds actual pod commit SHAs.
///
/// Honest-or-caught (L0): until the repository is marked on a chain, the trail
/// tip is a real git commit, not a confirmed transaction, and `txo[]` is empty.
/// Once `git mark` has recorded marks ([`TXO_JSON_PATH`]), the trail carries
/// them as TXO URIs with one state per mark, which is what a verifier walks.
/// This is the only writer of `gitmark.json` / `blocktrails.json`: a pod file
/// in an earlier shape is rewritten here, at bootstrap, and nowhere else.
/// Changes no key bytes (ADR-033 I1); the `did:nostr` identity string is
/// untouched.
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
    let marks = read_anchor_marks(repo_root);
    let anchored = !marks.is_empty();
    // One state per mark when marked (read_anchor_marks guarantees each has
    // its commit); the genesis commit while unanchored.
    let initial_states = if anchored {
        marks.iter().filter_map(|m| m.commit.clone()).collect()
    } else {
        vec![genesis_sha.clone()]
    };
    write_json(
        &repo_root.join("blocktrails.json"),
        &build_blocktrail(identity, initial_states, marks),
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
    if !anchored && !tip.is_empty() && tip != genesis_sha {
        // Unanchored: advance the trail tip to the real contract-anchor commit
        // SHA. An anchored trail's states are its marks' commits and stay so.
        write_json(
            &repo_root.join("blocktrails.json"),
            &build_blocktrail(identity, vec![genesis_sha, tip], Vec::new()),
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
