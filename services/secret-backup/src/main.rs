//! `agentbox-secret-backup` — encrypted secret backup and restore.
//!
//! ADR-2027 (secret custody, rotation and break-glass), closeout 2026-09-05.
//!
//! ## Why this exists
//!
//! The estate review found the secret backup path producing an ordinary ZIP
//! with an `unzip -t` integrity check, and recorded the gap precisely: "archive
//! integrity does not establish restoration, off-host survival or revocation of
//! retained copies", and the script "specifies neither encryption nor explicit
//! permission hardening; environmental protections remain unverified".
//!
//! An unencrypted archive of every `.env` in a tree is a second copy of every
//! credential, sitting wherever the backup directory happens to be. So this tool
//! has one hard rule:
//!
//! > **It cannot produce a plaintext archive.** There is no flag for it. If no
//! > recipient or passphrase is available, the run fails and writes nothing.
//!
//! ## Format
//!
//! `tar` inside `age` — both established formats with maintained
//! implementations. No bespoke envelope, no hand-rolled cryptography: the `age`
//! crate is the reference Rust implementation of the age specification
//! (X25519 or scrypt key wrapping, ChaCha20-Poly1305 under the STREAM
//! construction). This tool chooses the recipients and writes the bytes; it
//! implements no primitive of its own.
//!
//! ## Recipients
//!
//! * `--recipient age1…` (repeatable) — public-key encryption. The private key
//!   lives with the recovery custodian and never enters this container, which
//!   is what makes an off-host copy meaningful.
//! * `AGENTBOX_BACKUP_PASSPHRASE` — scrypt passphrase, for the case where no
//!   key infrastructure exists yet. Weaker (it is a shared secret with its own
//!   custody problem) and reported as such in the manifest.
//!
//! ## What it does NOT claim
//!
//! Producing an encrypted archive is not a custody lifecycle. It does not
//! rotate anything, does not prove off-host survival, and does not revoke
//! retained copies. Those remain open in ADR-2027; this closes the narrower
//! claim that a backup exists in a form that does not leak on disclosure, and
//! that a RESTORE has actually been exercised.

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use age::secrecy::{ExposeSecret, SecretString};
use anyhow::{anyhow, bail, Context, Result};
use clap::{Parser, Subcommand};

/// File names treated as user-authored secret configuration. Deliberately a
/// tight allowlist rather than a `*.key` sweep: vendored crates ship public test
/// fixtures with those extensions, and sweeping them in makes the archive huge
/// and the signal worthless.
const INCLUDE_NAMES: &[&str] = &[
    ".env",
    ".env.local",
    ".env.production",
    ".env.staging",
    ".tempenv",
    "settings.local.toml",
    "credentials.json",
    "identity.env",
];

/// Never included even when the name matches — these are templates.
const EXCLUDE_NAMES: &[&str] = &[
    ".env.example",
    ".env.template",
    ".env.template.common",
    ".env.sample",
];

/// Directories never descended into.
const PRUNE_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "dist",
    "build",
    "out",
    ".cache",
    ".pnpm-store",
    "venv",
    ".venv",
    "__pycache__",
    ".cargo",
    ".claude/worktrees",
];

#[derive(Parser)]
#[command(
    name = "agentbox-secret-backup",
    about = "Encrypted (age) secret backup and restore — ADR-2027. Never writes a plaintext archive."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Collect secret-class files under ROOT into an age-encrypted tar archive.
    Backup {
        /// Tree to scan.
        #[arg(long, default_value = ".")]
        root: PathBuf,
        /// Output archive path (`.tar.age`).
        #[arg(long)]
        out: PathBuf,
        /// age recipient (`age1…`). Repeatable. Preferred over a passphrase.
        #[arg(long = "recipient")]
        recipients: Vec<String>,
        /// Write a plaintext manifest of the file NAMES alongside the archive.
        /// Names only — never contents.
        #[arg(long)]
        manifest: Option<PathBuf>,
    },
    /// Decrypt an archive and extract it into DEST.
    Restore {
        /// Archive produced by `backup`.
        #[arg(long)]
        archive: PathBuf,
        /// Directory to extract into (created if absent).
        #[arg(long)]
        dest: PathBuf,
        /// age identity file (the private key). Omit to use the passphrase.
        #[arg(long)]
        identity: Option<PathBuf>,
    },
    /// List what a backup WOULD contain, without reading any content.
    Plan {
        #[arg(long, default_value = ".")]
        root: PathBuf,
    },
    /// End-to-end round trip over SYNTHETIC data, in a temporary directory.
    /// Proves restore works without touching a real secret (ADR-2027 asks for
    /// exactly this: "test encrypted/protected backup recovery using synthetic
    /// data").
    SelfTest,
}

fn is_pruned(path: &Path) -> bool {
    path.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        PRUNE_DIRS.iter().any(|p| *p == s)
    })
}

/// Every secret-class file under `root`, as paths relative to `root`.
fn collect(root: &Path) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            // Exclusions apply inside the requested tree, not to its ancestors.
            // A checkout beneath /build must not become an empty backup.
            e.path()
                .strip_prefix(root)
                .is_ok_and(|relative| !is_pruned(relative))
        })
    {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue, // an unreadable subtree is skipped, never fatal
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if EXCLUDE_NAMES.iter().any(|e| *e == name) {
            continue;
        }
        if !INCLUDE_NAMES.iter().any(|i| *i == name) {
            continue;
        }
        if let Ok(rel) = entry.path().strip_prefix(root) {
            out.push(rel.to_path_buf());
        }
    }
    out.sort();
    Ok(out)
}

/// Resolve the encryption recipients. Returns an error when NOTHING is
/// available — the rule that makes a plaintext archive unreachable.
fn encryptor(
    recipients: &[String],
    passphrase: Option<&str>,
) -> Result<(age::Encryptor, &'static str)> {
    if !recipients.is_empty() {
        let mut parsed: Vec<age::x25519::Recipient> = Vec::new();
        for r in recipients {
            let key: age::x25519::Recipient = r
                .parse()
                .map_err(|e| anyhow!("not a valid age recipient ({r}): {e}"))?;
            parsed.push(key);
        }
        // Leaked deliberately: `Encryptor::with_recipients` borrows the
        // recipients for the encryptor's lifetime, and this process encrypts
        // exactly one archive and exits. The alternative is threading a lifetime
        // through every caller for no benefit.
        let leaked: &'static [age::x25519::Recipient] = Box::leak(parsed.into_boxed_slice());
        let enc = age::Encryptor::with_recipients(leaked.iter().map(|r| r as &dyn age::Recipient))
            .map_err(|e| anyhow!("no usable recipients: {e}"))?;
        return Ok((enc, "x25519-recipients"));
    }
    if let Some(pass) = passphrase.filter(|p| !p.is_empty()) {
        return Ok((
            age::Encryptor::with_user_passphrase(SecretString::from(pass.to_string())),
            "scrypt-passphrase",
        ));
    }
    bail!(
        "refusing to write an UNENCRYPTED backup: pass --recipient age1… (preferred) \
         or set AGENTBOX_BACKUP_PASSPHRASE. ADR-2027 has no plaintext option."
    )
}

fn backup(
    root: &Path,
    out_path: &Path,
    recipients: &[String],
    passphrase: Option<&str>,
    manifest: Option<&Path>,
) -> Result<(usize, &'static str)> {
    // Resolve recipients FIRST. Nothing is read, and no output file is created,
    // until we know the result can be encrypted.
    let (enc, mode) = encryptor(recipients, passphrase)?;

    let files = collect(root)?;
    if files.is_empty() {
        bail!("no secret-class files found under {}", root.display());
    }

    if let Some(parent) = out_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
        }
    }

    let out_file =
        File::create(out_path).with_context(|| format!("creating {}", out_path.display()))?;
    harden(out_path)?;

    let mut writer = enc
        .wrap_output(out_file)
        .context("initialising age encryption")?;
    {
        let mut tar = tar::Builder::new(&mut writer);
        for rel in &files {
            let abs = root.join(rel);
            tar.append_path_with_name(&abs, rel)
                .with_context(|| format!("adding {}", rel.display()))?;
        }
        tar.finish().context("finishing the tar stream")?;
    }
    writer.finish().context("finalising age encryption")?;

    if let Some(m) = manifest {
        // NAMES ONLY. A manifest that carried values would defeat the archive.
        let mut body = String::from("# agentbox secret backup manifest (names only)\n");
        body.push_str(&format!("# root: {}\n", root.display()));
        body.push_str(&format!("# archive: {}\n", out_path.display()));
        body.push_str(&format!("# encryption: age / {mode}\n"));
        body.push_str(&format!("# files: {}\n\n", files.len()));
        for f in &files {
            body.push_str(&format!("{}\n", f.display()));
        }
        fs::write(m, body).with_context(|| format!("writing {}", m.display()))?;
        harden(m)?;
    }

    Ok((files.len(), mode))
}

/// Owner-only permissions. The review noted the previous script left final
/// permissions to the invoking environment.
fn harden(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .with_context(|| format!("hardening permissions on {}", path.display()))?;
    }
    let _ = path;
    Ok(())
}

/// True for any archive entry path that could escape the destination
/// directory. Extracted so the guard is testable on its own: the tar crate
/// refuses to BUILD an archive containing `..`, so a hostile archive cannot be
/// synthesised through its writer, but a hand-crafted one can still arrive.
fn is_unsafe_entry_path(path: &Path) -> bool {
    use std::path::Component;
    path.is_absolute()
        || path.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
}

fn restore(
    archive: &Path,
    dest: &Path,
    identity: Option<&Path>,
    passphrase: Option<&str>,
) -> Result<usize> {
    let mut encrypted = Vec::new();
    File::open(archive)
        .with_context(|| format!("opening {}", archive.display()))?
        .read_to_end(&mut encrypted)
        .context("reading the archive")?;

    let decryptor =
        age::Decryptor::new_buffered(&encrypted[..]).context("parsing the age header")?;

    // age 0.11 unifies the decryptor and reports the key type, so the two
    // branches differ only in which identity is supplied.
    let mut plaintext = Vec::new();
    if decryptor.is_scrypt() {
        let pass = passphrase.filter(|p| !p.is_empty()).ok_or_else(|| {
            anyhow!("this archive is passphrase-encrypted; set AGENTBOX_BACKUP_PASSPHRASE")
        })?;
        let id = age::scrypt::Identity::new(SecretString::from(pass.to_string()));
        let mut reader = decryptor
            .decrypt(std::iter::once(&id as &dyn age::Identity))
            .context("decrypting with the supplied passphrase")?;
        reader
            .read_to_end(&mut plaintext)
            .context("decrypting the archive body")?;
    } else {
        let path = identity.ok_or_else(|| {
            anyhow!("this archive is recipient-encrypted; pass --identity <age key file>")
        })?;
        let ids = age::IdentityFile::from_file(path.display().to_string())
            .with_context(|| format!("reading identity file {}", path.display()))?
            .into_identities()
            .context("reading identities from the key file")?;
        let mut reader = decryptor
            .decrypt(ids.iter().map(|i| i.as_ref() as &dyn age::Identity))
            .context("decrypting with the supplied identity")?;
        reader
            .read_to_end(&mut plaintext)
            .context("decrypting the archive body")?;
    }

    fs::create_dir_all(dest).with_context(|| format!("creating {}", dest.display()))?;
    let mut tar = tar::Archive::new(&plaintext[..]);
    let mut count = 0usize;
    for entry in tar.entries().context("reading the tar stream")? {
        let mut entry = entry.context("reading a tar entry")?;
        let path = entry.path().context("entry path")?.into_owned();
        // Refuse absolute paths and traversal — a restore must not write
        // outside the destination it was given.
        if is_unsafe_entry_path(&path) {
            bail!("refusing to extract an unsafe path: {}", path.display());
        }
        let target = dest.join(&path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        entry
            .unpack(&target)
            .with_context(|| format!("extracting {}", path.display()))?;
        harden(&target)?;
        count += 1;
    }
    Ok(count)
}

/// The synthetic round trip ADR-2027 asks for: create invented secrets, back
/// them up, restore them into a different directory, and compare byte for byte.
/// No real credential is read at any point.
fn self_test() -> Result<String> {
    const SYNTHETIC_PASSPHRASE: &str = "synthetic-self-test-passphrase";
    let dir = tempfile::tempdir().context("creating a temporary directory")?;
    let root = dir.path().join("tree");
    let nested = root.join("sub/project");
    fs::create_dir_all(&nested)?;
    fs::create_dir_all(root.join("node_modules/pkg"))?;

    let synthetic = [
        (
            root.join(".env"),
            "SYNTHETIC_TOKEN=not-a-real-secret-0001\n",
        ),
        (
            nested.join(".env.local"),
            "SYNTHETIC_KEY=not-a-real-secret-0002\n",
        ),
        (
            root.join("credentials.json"),
            "{\"synthetic\":\"not-a-real-secret-0003\"}\n",
        ),
    ];
    for (p, body) in &synthetic {
        fs::write(p, body)?;
    }
    // Decoys that must NOT be collected.
    fs::write(root.join(".env.example"), "TOKEN=<placeholder>\n")?;
    fs::write(root.join("node_modules/pkg/.env"), "VENDORED=ignore-me\n")?;

    let archive = dir.path().join("secrets.tar.age");
    let (count, mode) = backup(&root, &archive, &[], Some(SYNTHETIC_PASSPHRASE), None)?;
    if count != synthetic.len() {
        bail!(
            "collected {count} files, expected {} (the exclusion rules did not hold)",
            synthetic.len()
        );
    }

    // The archive must not contain the plaintext. This is the property the ZIP
    // never had, so it is asserted rather than assumed.
    let bytes = fs::read(&archive)?;
    if !bytes.starts_with(b"age-encryption.org/") {
        bail!("the archive is not an age file — refusing to call this a pass");
    }
    for (_, body) in &synthetic {
        let needle = body.trim().as_bytes();
        if bytes.windows(needle.len()).any(|w| w == needle) {
            bail!("plaintext found inside the encrypted archive");
        }
    }

    let dest = dir.path().join("restored");
    let restored = restore(&archive, &dest, None, Some(SYNTHETIC_PASSPHRASE))?;
    if restored != synthetic.len() {
        bail!("restored {restored} files, expected {}", synthetic.len());
    }
    for (p, body) in &synthetic {
        let rel = p.strip_prefix(&root)?;
        let got = fs::read_to_string(dest.join(rel))
            .with_context(|| format!("restored file missing: {}", rel.display()))?;
        if got != *body {
            bail!("restored {} does not match the original", rel.display());
        }
    }
    Ok(format!(
        "backed up and restored {count} synthetic file(s) via age/{mode}; archive contained no plaintext"
    ))
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Backup {
            root,
            out,
            recipients,
            manifest,
        } => {
            let pass = std::env::var("AGENTBOX_BACKUP_PASSPHRASE").ok();
            let (count, mode) = backup(
                &root,
                &out,
                &recipients,
                pass.as_deref(),
                manifest.as_deref(),
            )?;
            println!(
                "encrypted backup written: {} ({count} file(s), age/{mode}, mode 0600)",
                out.display()
            );
            if mode == "scrypt-passphrase" {
                eprintln!(
                    "note: passphrase mode. The passphrase is itself a credential with its own \
                     custody problem — prefer --recipient with the private key held off-host."
                );
            }
        }
        Command::Restore {
            archive,
            dest,
            identity,
        } => {
            let pass = std::env::var("AGENTBOX_BACKUP_PASSPHRASE").ok();
            let n = restore(&archive, &dest, identity.as_deref(), pass.as_deref())?;
            println!("restored {n} file(s) into {}", dest.display());
        }
        Command::Plan { root } => {
            let files = collect(&root)?;
            println!(
                "{} secret-class file(s) under {}:",
                files.len(),
                root.display()
            );
            for f in &files {
                println!("  {}", f.display());
            }
        }
        Command::SelfTest => {
            let summary = self_test()?;
            println!("self-test PASS — {summary}");
        }
    }
    io::stdout().flush().ok();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ADR-2027: the synthetic-data recovery exercise, as a test.
    #[test]
    fn synthetic_backup_restores_byte_for_byte() {
        let summary = self_test().expect("synthetic round trip");
        assert!(summary.contains("no plaintext"));
    }

    #[test]
    fn refuses_to_write_a_plaintext_archive() {
        // No recipients and no passphrase: the run must fail before any file is
        // created. This is the invariant that makes the ZIP finding unrepeatable.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("t");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(".env"), "X=1\n").unwrap();
        let out = dir.path().join("nope.tar.age");
        let err = backup(&root, &out, &[], None, None).unwrap_err();
        assert!(err
            .to_string()
            .contains("refusing to write an UNENCRYPTED backup"));
        assert!(!out.exists(), "no output file may be created on refusal");
    }

    #[test]
    fn templates_and_vendored_trees_are_excluded() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("node_modules/x")).unwrap();
        fs::create_dir_all(root.join("target")).unwrap();
        fs::write(root.join(".env"), "A=1").unwrap();
        fs::write(root.join(".env.example"), "A=<x>").unwrap();
        fs::write(root.join("node_modules/x/.env"), "B=2").unwrap();
        fs::write(root.join("target/.env"), "C=3").unwrap();
        let files = collect(root).unwrap();
        assert_eq!(files, vec![PathBuf::from(".env")]);
    }

    #[test]
    fn excluded_ancestor_does_not_hide_the_requested_tree() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("build").join("project");
        fs::create_dir_all(root.join("build")).unwrap();
        fs::write(root.join(".env"), "SYNTHETIC=1").unwrap();
        fs::write(root.join("build/.env"), "EXCLUDED=1").unwrap();
        assert_eq!(collect(&root).unwrap(), vec![PathBuf::from(".env")]);
    }

    #[test]
    fn restore_rejects_paths_that_escape_the_destination() {
        // The extraction guard, tested directly. The tar crate refuses to BUILD
        // an archive containing `..`, so a hostile archive cannot be produced
        // through its writer — but one can still arrive from elsewhere, and the
        // guard is what stands between it and the filesystem.
        assert!(is_unsafe_entry_path(Path::new("../escaped.env")));
        assert!(is_unsafe_entry_path(Path::new("a/../../escaped.env")));
        assert!(is_unsafe_entry_path(Path::new("/etc/shadow")));
        assert!(!is_unsafe_entry_path(Path::new(".env")));
        assert!(!is_unsafe_entry_path(Path::new("sub/project/.env.local")));
    }

    #[test]
    fn a_wrong_passphrase_fails_rather_than_returning_rubbish() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("t");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(".env"), "SYNTHETIC=1\n").unwrap();
        let archive = dir.path().join("s.tar.age");
        backup(&root, &archive, &[], Some("right"), None).unwrap();
        let err = restore(&archive, &dir.path().join("out"), None, Some("wrong")).unwrap_err();
        assert!(err.to_string().contains("decrypting"));
    }

    #[test]
    fn a_recipient_encrypted_archive_needs_an_identity() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("t");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(".env"), "SYNTHETIC=1\n").unwrap();

        // A real x25519 keypair; the private half never leaves this test.
        let id = age::x25519::Identity::generate();
        let recipient = id.to_public().to_string();
        let archive = dir.path().join("r.tar.age");
        let (_, mode) = backup(&root, &archive, &[recipient], None, None).unwrap();
        assert_eq!(mode, "x25519-recipients");

        // Without an identity the restore refuses rather than guessing.
        let err = restore(&archive, &dir.path().join("out"), None, None).unwrap_err();
        assert!(err.to_string().contains("recipient-encrypted"));

        // With the identity it round-trips.
        let key_file = dir.path().join("key.txt");
        fs::write(&key_file, format!("{}\n", id.to_string().expose_secret())).unwrap();
        let n = restore(&archive, &dir.path().join("out2"), Some(&key_file), None).unwrap();
        assert_eq!(n, 1);
        assert_eq!(
            fs::read_to_string(dir.path().join("out2/.env")).unwrap(),
            "SYNTHETIC=1\n"
        );
    }

    #[test]
    fn the_archive_is_owner_only_on_disk() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().join("t");
            fs::create_dir_all(&root).unwrap();
            fs::write(root.join(".env"), "SYNTHETIC=1\n").unwrap();
            let archive = dir.path().join("p.tar.age");
            backup(&root, &archive, &[], Some("pw"), None).unwrap();
            let mode = fs::metadata(&archive).unwrap().permissions().mode() & 0o777;
            assert_eq!(
                mode, 0o600,
                "the archive must not be group or world readable"
            );
        }
    }
}
