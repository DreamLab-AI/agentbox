//! `nostr-pod-bridge bootstrap` — the sovereign mesh identity bootstrap that
//! runs as root at container boot phase `[2/8]`.
//!
//! Port of `scripts/sovereign-bootstrap.py`. It resolves (or mints) the agent
//! keypair, provisions the per-user Solid pod with its WAC authorisations and
//! DID documents, anchors the ADR-124 gitmark/blocktrails contract substrate on
//! the pod's real git surface, and writes `/run/agentbox/identity.env` for the
//! entrypoint to source before `exec supervisord`.
//!
//! Every emitted file is byte-identical to the Python original: same key sets,
//! same key *order*, and `json.dumps(…, indent=2)` shape via [`crate::pyjson`].
//!
//! ## Directory naming (ADR-053)
//!
//! The canonical pod directory is `pods/<x-only hex>`, which matches every
//! server-side API boundary, the WAC agent URI (`did:nostr:<hex>`), and the
//! ADR-013 URI grammar. `pods/<npub> → <hex>` is kept as a compatibility
//! symlink for any remaining npub-keyed consumer, and `<data root>/<hex> →
//! pods/<hex>` makes URL-addressed access resolve.

use anyhow::{Context, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::contract::{build_did_document, write_agent_repo_identity};
use crate::envmap::EnvMap;
use crate::identity::{ensure_identity, write_json, Identity};

/// Pod subdirectories provisioned on first boot.
pub const POD_SUBDIRS: [&str; 6] = [
    "memory/episodic",
    "memory/semantic",
    "system/adrs",
    "system/prds",
    "events/inbox",
    "events/outbox",
];

// ── Pod provisioning: WAC, ACL, profile, DID ─────────────────────────────────

/// Render an owner-only WAC authorisation as Turtle.
///
/// solid-pod-rs-server's WAC resolver only recognises Turtle `.acl` files (any
/// path ending in the literal `.acl`) at two fixed locations for a pod
/// container: the SIBLING file `data_root/pods/{pk}.acl`, which the server
/// derives from the resource path, and — as a courtesy fallback — the inner
/// `data_root/pods/{pk}/.acl` written by its own `/_admin/provision/{pubkey}`
/// handler. It reads neither JSON-LD nor a file named `.acl.json`.
pub fn build_wac_turtle(hex_pubkey: &str) -> String {
    format!(
        "@prefix acl: <http://www.w3.org/ns/auth/acl#> .\n\n\
         <#owner> a acl:Authorization ;\n\
         \x20 acl:agent <did:nostr:{hex_pubkey}> ;\n\
         \x20 acl:accessTo <./> ; acl:default <./> ;\n\
         \x20 acl:mode acl:Read, acl:Write, acl:Append, acl:Control .\n"
    )
}

#[derive(Debug, Serialize)]
struct AclRule {
    #[serde(rename = "@type")]
    type_: &'static str,
    agent: String,
    mode: [&'static str; 4],
    #[serde(rename = "accessTo")]
    access_to: &'static str,
    default: &'static str,
}

#[derive(Debug, Serialize)]
struct AclDocument {
    #[serde(rename = "@context")]
    context: &'static str,
    owner: String,
    rules: [AclRule; 1],
}

#[derive(Debug, Serialize)]
struct PodProfile {
    #[serde(rename = "@context")]
    context: &'static str,
    id: String,
    #[serde(rename = "webId")]
    web_id: String,
    #[serde(rename = "alsoKnownAs")]
    also_known_as: [String; 1],
}

/// Point `link` at `target` as a directory symlink, replacing a symlink that
/// points elsewhere. Best-effort and idempotent: a real (non-symlink) entry at
/// `link` is left untouched, and any failure is swallowed — a missing symlink
/// only degrades an alternative resolution path.
fn ensure_symlink(link: &Path, target: &Path) {
    if link.is_symlink() {
        match std::fs::read_link(link) {
            Ok(current) if current == target => return,
            Ok(_) => {
                if std::fs::remove_file(link).is_err() {
                    return;
                }
            }
            Err(_) => return,
        }
    } else if link.exists() {
        return;
    }
    let _ = std::os::unix::fs::symlink(target, link);
}

/// Provision the per-user pod: directory tree, WAC authorisations in both the
/// JSON-LD and Turtle forms, the Solid profile, and the DID document.
pub fn ensure_acl(pod_root: &Path, identity: &Identity, env: &EnvMap) -> Result<()> {
    // ADR-053: hex is the canonical pod directory name.
    let hex_key = &identity.x_only_pubkey_hex;
    let pod_dir = pod_root.join(hex_key);
    for relative in POD_SUBDIRS {
        std::fs::create_dir_all(pod_dir.join(relative))
            .with_context(|| format!("creating {}/{relative}", pod_dir.display()))?;
    }

    // Backward-compat: pods/<npub> → pods/<hex>, so any remaining npub-keyed
    // consumer (git route prefix, external link) still resolves the pod.
    ensure_symlink(&pod_root.join(&identity.npub), Path::new(hex_key));

    let did = identity.did();
    write_json(
        &pod_dir.join(".acl.json"),
        &AclDocument {
            context: "http://www.w3.org/ns/auth/acl#",
            owner: did.clone(),
            rules: [AclRule {
                type_: "Authorization",
                agent: did.clone(),
                mode: ["Read", "Write", "Append", "Control"],
                access_to: "./",
                default: "./",
            }],
        },
    )?;

    // Write BOTH the container-child (pods/<hex>/.acl — canonical) and the
    // sidecar (pods/<hex>.acl — what find_effective_acl_dyn actually probes
    // until the upstream ACL-walk bug is fixed).
    let wac = build_wac_turtle(hex_key);
    std::fs::write(pod_root.join(format!("{hex_key}.acl")), &wac)
        .with_context(|| format!("writing {}/{hex_key}.acl", pod_root.display()))?;
    std::fs::write(pod_dir.join(".acl"), &wac)
        .with_context(|| format!("writing {}/.acl", pod_dir.display()))?;

    let port = env.or("SOLID_POD_PORT", "8484");
    let web_id = format!("http://localhost:{port}/{hex_key}/profile.json");
    write_json(
        &pod_dir.join("profile.json"),
        &PodProfile {
            context: "https://www.w3.org/ns/solid/terms#",
            id: did.clone(),
            web_id: web_id.clone(),
            also_known_as: [did],
        },
    )?;
    write_json(
        &pod_dir.join("did-nostr.json"),
        &build_did_document(identity, Some(vec![web_id])),
    )
}

/// Create a data-root hex alias so URL paths `/<hex>/…` resolve.
///
/// ADR-053: the canonical pod directory is `pods/<hex>`. The server's URL
/// routing strips the leading slash and joins to the data root, so a request for
/// `/<hex>/resource` resolves to `data_root/<hex>/resource`. This symlink
/// (`data_root/<hex> → pods/<hex>`) makes that work without the pod directory
/// having to live at the data root. Idempotent and best-effort — a missing alias
/// only affects URL-addressed access.
pub fn ensure_git_provenance_alias(pod_root: &Path, identity: &Identity) {
    let hex = &identity.x_only_pubkey_hex;
    if hex.len() != 64
        || !hex
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return;
    }
    let Some(data_root) = pod_root.parent() else {
        return;
    };
    ensure_symlink(&data_root.join(hex), &PathBuf::from("pods").join(hex));
}

// ── identity.env ─────────────────────────────────────────────────────────────

/// Render `/run/agentbox/identity.env`, the shell fragment the entrypoint
/// sources as root before `exec supervisord`.
///
/// `AGENTBOX_BRIDGE_RECIPIENT_PUBKEY` / `AGENTBOX_BRIDGE_SK` feed the bridge's
/// own ingress (see `main.rs`): the recipient is the agent's BIP-340 x-only key
/// and the SK its 64-char hex secret. Sourcing this pre-supervisord means PID 1
/// — and so the bridge child — inherit them, keeping the secret out of the
/// generated supervisor text. SEC-003: the entrypoint then moves the secret to
/// a tmpfs file and scrubs it from the environment.
pub fn render_runtime_env(identity: &Identity) -> String {
    let hex = &identity.x_only_pubkey_hex;
    [
        format!("export AGENTBOX_AGENT_ID={}", identity.agent_id),
        format!("export AGENTBOX_NPUB={}", identity.npub),
        format!("export AGENTBOX_NSEC={}", identity.nsec),
        format!("export AGENTBOX_PUBKEY_HEX={}", identity.public_key_hex),
        format!("export AGENTBOX_X_ONLY_PUBKEY_HEX={hex}"),
        format!("export AGENTBOX_DID=did:nostr:{hex}"),
        format!(
            "export AGENTBOX_URN=urn:agentbox:agent:{}",
            identity.agent_id
        ),
        format!("export AGENTBOX_BRIDGE_RECIPIENT_PUBKEY={hex}"),
        format!("export AGENTBOX_BRIDGE_SK={}", identity.private_key_hex),
        String::new(),
    ]
    .join("\n")
}

/// Write `identity.env` at mode 0600 — it carries the agent secret (nsec + SK
/// hex). Root sources it pre-supervisord; devuser never reads it directly.
pub fn write_runtime_env(identity: &Identity, run_root: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::create_dir_all(run_root)
        .with_context(|| format!("creating {}", run_root.display()))?;
    let path = run_root.join("identity.env");
    std::fs::write(&path, render_runtime_env(identity))
        .with_context(|| format!("writing {}", path.display()))?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
        .with_context(|| format!("chmod 0600 {}", path.display()))
}

// ── Entry point ──────────────────────────────────────────────────────────────

/// Resolved filesystem roots for one bootstrap run. Every root is overridable so
/// the whole flow can be exercised against a scratch directory.
#[derive(Debug, Clone)]
pub struct Roots {
    pub identity_root: PathBuf,
    pub pod_root: PathBuf,
    pub run_root: PathBuf,
    /// Explicit override for non-pod deployments; otherwise the pod directory.
    pub repo_root: Option<PathBuf>,
}

impl Roots {
    /// Read the roots from the environment, with the production defaults the
    /// Python original hard-coded. `AGENTBOX_IDENTITY_ROOT` and
    /// `AGENTBOX_RUN_ROOT` are new: they make a dry run possible without
    /// writing to `/var/lib` or `/run`.
    pub fn from_env(env: &EnvMap) -> Self {
        Self {
            identity_root: env
                .or("AGENTBOX_IDENTITY_ROOT", "/var/lib/agentbox/identities")
                .into(),
            pod_root: PathBuf::from(env.or("SOLID_POD_ROOT", "/var/lib/solid")).join("pods"),
            run_root: env.or("AGENTBOX_RUN_ROOT", "/run/agentbox").into(),
            repo_root: env.non_empty("AGENTBOX_AGENT_REPO_ROOT").map(PathBuf::from),
        }
    }
}

/// True when `[sovereign_mesh] enabled = true` in the manifest at `path`.
fn sovereign_mesh_enabled(path: &Path) -> Result<bool> {
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("reading manifest {}", path.display()))?;
    let config: toml::Value =
        toml::from_str(&text).with_context(|| format!("parsing manifest {}", path.display()))?;
    Ok(config
        .get("sovereign_mesh")
        .and_then(|s| s.get("enabled"))
        .and_then(toml::Value::as_bool)
        .unwrap_or(false))
}

/// Provision everything for one agent identity against the given roots.
pub fn provision(agent_id: &str, roots: &Roots, env: &EnvMap) -> Result<Identity> {
    let identity = ensure_identity(agent_id, &roots.identity_root, env)?;
    ensure_acl(&roots.pod_root, &identity, env)?;
    write_runtime_env(&identity, &roots.run_root)?;

    // ADR-053: the git repo root co-locates with the canonical pod directory
    // unless an explicit override is set for a non-pod deployment.
    let repo_root = roots
        .repo_root
        .clone()
        .unwrap_or_else(|| roots.pod_root.join(&identity.x_only_pubkey_hex));
    write_agent_repo_identity(&identity, &repo_root)?;
    ensure_git_provenance_alias(&roots.pod_root, &identity);
    Ok(identity)
}

/// `nostr-pod-bridge bootstrap` — the subcommand the entrypoint invokes.
///
/// Silent on success, exactly like the Python original: the entrypoint owns the
/// `[2/8] Bootstrapping sovereign mesh identity...` line.
pub fn run(env: &EnvMap) -> Result<()> {
    let config_path = PathBuf::from(env.or("AGENTBOX_CONFIG", "/etc/agentbox.toml"));
    if !sovereign_mesh_enabled(&config_path)? {
        return Ok(()); // mesh disabled for this profile — nothing to provision.
    }
    let agent_id = env.or("AGENTBOX_AGENT_ID", "agentbox-core");
    provision(&agent_id, &Roots::from_env(env), env)?;
    Ok(())
}
