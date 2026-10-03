//! ROLE secret resolution: one loader for every Rust reader of a role secret
//! (custody X-1 step 1, W2, bypass 3).
//!
//! A ROLE variable (the set in `config/custody/env-classes.json`) carries a
//! signing key or join key that must not sit in every process's environment.
//! Under `[security].role_isolation` the entrypoint hands each one to a file
//! and exports `<NAME>_FILE`; this module is how a reader gets the value back.
//!
//! Precedence, identical to the JS loader (`management-api/lib/role-secret.js`):
//!
//! 1. `<NAME>_FILE`, when set and non-empty, wins. Its contents are read
//!    (bounded, trimmed). A file that cannot be read is an error naming the
//!    path, never a silent fallback.
//! 2. `$AGENTBOX_SECRETS_DIR/<NAME>`, when that file exists. W1's isolated
//!    supervisor config sets `AGENTBOX_SECRETS_DIR` for each role program to
//!    its `/run/secrets/<role>`, where the delivery plan writes env-sourced
//!    secrets under their variable's name (`config/role-accounts.json`).
//! 3. A caller-supplied default file (for example `/run/secrets/nostr.key`),
//!    when it exists.
//! 4. `<NAME>` itself, **only while the flag is off**. Under the flag a ROLE
//!    variable present at all is a leak: it is reported as
//!    `ROLE-ISOLATION-LEAK <NAME>` and ignored.
//!
//! The flag is `AGENTBOX_ROLE_ISOLATION=1`, exported by the entrypoint from the
//! manifest before anything else runs. Error and log text carry names and
//! paths, never contents.

use crate::envmap::EnvMap;
use anyhow::{bail, Context, Result};
use std::io::Read;
use std::path::{Path, PathBuf};

/// The environment variable the entrypoint exports from `[security].role_isolation`.
pub const FLAG_VAR: &str = "AGENTBOX_ROLE_ISOLATION";

/// The role program's own secrets directory (W1's isolated supervisor config).
pub const SECRETS_DIR_VAR: &str = "AGENTBOX_SECRETS_DIR";

/// Upper bound on a secret file. Keys and tokens are well under 1 KiB; a larger
/// file is a misconfiguration, and reading it whole would let a path pointed at
/// a large file allocate without bound.
pub const MAX_SECRET_FILE_BYTES: u64 = 4096;

/// True when the boot ran with `[security].role_isolation = true`.
pub fn role_isolation(env: &EnvMap) -> bool {
    env.get(FLAG_VAR) == Some("1")
}

/// Where a resolved value came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Source {
    /// Read from this file (`<NAME>_FILE` or the caller's default).
    File(PathBuf),
    /// Read from the `<NAME>` environment variable (flag off only).
    Env,
}

/// The outcome of resolving one ROLE variable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    /// The secret, trimmed; `None` when no admissible source carries one.
    pub value: Option<String>,
    /// Which source supplied `value`.
    pub source: Option<Source>,
    /// `<NAME>` was present in the environment while the flag was on.
    pub leaked: bool,
}

/// The `<NAME>_FILE` variable for a ROLE variable.
pub fn file_var(name: &str) -> String {
    format!("{name}_FILE")
}

/// Read a secret file: a regular file, at most [`MAX_SECRET_FILE_BYTES`],
/// UTF-8, surrounding whitespace trimmed. Errors name the path only.
pub fn read_secret_file(path: &Path) -> Result<String> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("opening secret file {}", path.display()))?;
    let meta = file
        .metadata()
        .with_context(|| format!("stat secret file {}", path.display()))?;
    if !meta.is_file() {
        bail!("secret file {} is not a regular file", path.display());
    }
    if meta.len() > MAX_SECRET_FILE_BYTES {
        bail!(
            "secret file {} is larger than {MAX_SECRET_FILE_BYTES} bytes",
            path.display()
        );
    }
    let mut buf = Vec::with_capacity(meta.len() as usize);
    file.take(MAX_SECRET_FILE_BYTES + 1)
        .read_to_end(&mut buf)
        .with_context(|| format!("reading secret file {}", path.display()))?;
    if buf.len() as u64 > MAX_SECRET_FILE_BYTES {
        bail!(
            "secret file {} is larger than {MAX_SECRET_FILE_BYTES} bytes",
            path.display()
        );
    }
    let text = String::from_utf8(buf)
        .map_err(|_| anyhow::anyhow!("secret file {} is not UTF-8", path.display()))?;
    Ok(text.trim().to_string())
}

/// Resolve `name` without logging. See the module docs for the precedence.
pub fn resolve(env: &EnvMap, name: &str, default_file: Option<&Path>) -> Result<Resolved> {
    let isolated = role_isolation(env);
    let leaked = isolated && env.get(name).is_some();
    let fv = file_var(name);
    let file = env
        .non_empty(&fv)
        .map(PathBuf::from)
        .or_else(|| {
            env.non_empty(SECRETS_DIR_VAR)
                .map(|d| Path::new(d).join(name))
                .filter(|p| p.is_file())
        })
        .or_else(|| default_file.filter(|p| p.is_file()).map(Path::to_path_buf));
    if let Some(path) = file {
        let value = read_secret_file(&path).with_context(|| format!("resolving {name}"))?;
        let value = (!value.is_empty()).then_some(value);
        let source = value.as_ref().map(|_| Source::File(path));
        return Ok(Resolved {
            value,
            source,
            leaked,
        });
    }
    if isolated {
        return Ok(Resolved {
            value: None,
            source: None,
            leaked,
        });
    }
    let value = env
        .non_empty(name)
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let source = value.as_ref().map(|_| Source::Env);
    Ok(Resolved {
        value,
        source,
        leaked: false,
    })
}

/// Report a leak by name on stderr (the boot log and every service log).
pub fn report_leak(name: &str) {
    eprintln!(
        "[role-secret] ROLE-ISOLATION-LEAK {name} is set in the environment under role \
         isolation; ignored (deliver it as {})",
        file_var(name)
    );
}

/// Resolve `name`, reporting a leak, and return the value.
pub fn read(env: &EnvMap, name: &str) -> Result<Option<String>> {
    read_with_default(env, name, None)
}

/// [`read`] with a default file consulted when `<NAME>_FILE` is unset.
pub fn read_with_default(
    env: &EnvMap,
    name: &str,
    default_file: Option<&Path>,
) -> Result<Option<String>> {
    let r = resolve(env, name, default_file)?;
    if r.leaked {
        report_leak(name);
    }
    Ok(r.value)
}

/// The first of `names` that resolves to a value, with the name that supplied
/// it. Every name is checked for a leak, so one present under the flag is
/// reported even when an earlier name already resolved.
pub fn read_first<'a>(env: &EnvMap, names: &[&'a str]) -> Result<Option<(String, &'a str)>> {
    let mut found = None;
    for &name in names {
        let r = resolve(env, name, None)?;
        if r.leaked {
            report_leak(name);
        }
        if found.is_none() {
            if let Some(v) = r.value {
                found = Some((v, name));
            }
        }
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn env(pairs: &[(&str, &str)]) -> EnvMap {
        pairs.iter().map(|(k, v)| (*k, *v)).collect()
    }

    fn secret_file(dir: &Path, name: &str, body: &str) -> PathBuf {
        let p = dir.join(name);
        let mut f = std::fs::File::create(&p).unwrap();
        f.write_all(body.as_bytes()).unwrap();
        p
    }

    #[test]
    fn flag_off_env_var_is_honoured() {
        let r = resolve(&env(&[("K", " v1 ")]), "K", None).unwrap();
        assert_eq!(r.value.as_deref(), Some("v1"));
        assert_eq!(r.source, Some(Source::Env));
        assert!(!r.leaked);
    }

    #[test]
    fn file_var_wins_over_env_var_with_flag_off() {
        let dir = tempfile::tempdir().unwrap();
        let p = secret_file(dir.path(), "k", "from-file\n");
        let e = env(&[("K", "from-env"), ("K_FILE", p.to_str().unwrap())]);
        let r = resolve(&e, "K", None).unwrap();
        assert_eq!(r.value.as_deref(), Some("from-file"));
        assert_eq!(r.source, Some(Source::File(p)));
        assert!(!r.leaked);
    }

    #[test]
    fn flag_on_env_var_is_ignored_and_reported() {
        let r = resolve(&env(&[(FLAG_VAR, "1"), ("K", "from-env")]), "K", None).unwrap();
        assert_eq!(r.value, None);
        assert!(r.leaked);
    }

    #[test]
    fn flag_on_empty_env_var_still_counts_as_present() {
        let r = resolve(&env(&[(FLAG_VAR, "1"), ("K", "")]), "K", None).unwrap();
        assert!(r.leaked);
        assert_eq!(r.value, None);
    }

    #[test]
    fn flag_on_file_var_is_read_and_a_present_env_var_is_still_a_leak() {
        let dir = tempfile::tempdir().unwrap();
        let p = secret_file(dir.path(), "k", "from-file");
        let e = env(&[(FLAG_VAR, "1"), ("K", "x"), ("K_FILE", p.to_str().unwrap())]);
        let r = resolve(&e, "K", None).unwrap();
        assert_eq!(r.value.as_deref(), Some("from-file"));
        assert!(r.leaked);
    }

    #[test]
    fn default_file_is_used_when_no_file_var() {
        let dir = tempfile::tempdir().unwrap();
        let p = secret_file(dir.path(), "nostr.key", "dflt");
        let r = resolve(&env(&[(FLAG_VAR, "1")]), "K", Some(&p)).unwrap();
        assert_eq!(r.value.as_deref(), Some("dflt"));
        let missing = dir.path().join("absent");
        let r = resolve(&env(&[("K", "e")]), "K", Some(&missing)).unwrap();
        assert_eq!(
            r.source,
            Some(Source::Env),
            "an absent default falls through"
        );
    }

    #[test]
    fn role_secrets_dir_is_consulted_after_the_file_var() {
        let dir = tempfile::tempdir().unwrap();
        secret_file(dir.path(), "K", "from-dir");
        let d = dir.path().to_str().unwrap();
        let r = resolve(&env(&[(FLAG_VAR, "1"), (SECRETS_DIR_VAR, d)]), "K", None).unwrap();
        assert_eq!(r.value.as_deref(), Some("from-dir"));
        let other = secret_file(dir.path(), "other", "from-file-var");
        let e = env(&[(SECRETS_DIR_VAR, d), ("K_FILE", other.to_str().unwrap())]);
        assert_eq!(
            resolve(&e, "K", None).unwrap().value.as_deref(),
            Some("from-file-var")
        );
        let r = resolve(&env(&[(SECRETS_DIR_VAR, d)]), "ABSENT", None).unwrap();
        assert_eq!(
            r.value, None,
            "a name with no file in the dir falls through"
        );
    }

    #[test]
    fn unreadable_file_var_is_an_error_naming_the_path_not_a_fallback() {
        let e = env(&[("K", "from-env"), ("K_FILE", "/nonexistent/role/k")]);
        let err = format!("{:#}", resolve(&e, "K", None).unwrap_err());
        assert!(err.contains("/nonexistent/role/k"), "{err}");
        assert!(!err.contains("from-env"), "{err}");
    }

    #[test]
    fn oversized_file_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let p = secret_file(
            dir.path(),
            "big",
            &"a".repeat(MAX_SECRET_FILE_BYTES as usize + 1),
        );
        assert!(read_secret_file(&p).is_err());
    }

    #[test]
    fn a_directory_is_not_a_secret_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_secret_file(dir.path()).is_err());
    }

    #[test]
    fn flag_must_be_exactly_one() {
        for v in ["0", "", "true", "yes"] {
            assert!(!role_isolation(&env(&[(FLAG_VAR, v)])), "{v:?}");
        }
        assert!(role_isolation(&env(&[(FLAG_VAR, "1")])));
    }

    #[test]
    fn read_first_returns_the_first_value_and_its_name() {
        let dir = tempfile::tempdir().unwrap();
        let p = secret_file(dir.path(), "b", "bee");
        let e = env(&[
            (FLAG_VAR, "1"),
            ("A", "leak"),
            ("B_FILE", p.to_str().unwrap()),
        ]);
        let got = read_first(&e, &["A", "B", "C"]).unwrap();
        assert_eq!(got, Some(("bee".to_string(), "B")));
        let e = env(&[("A", ""), ("B", "b")]);
        assert_eq!(
            read_first(&e, &["A", "B"]).unwrap(),
            Some(("b".to_string(), "B"))
        );
    }
}
