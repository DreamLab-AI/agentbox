//! Production-root resolution and root-relative receipt paths.
//!
//! Every tool runs against one *production root*. It is chosen, in order, by the
//! `--root DIR` option, the `BLENDER_SHARE` environment variable (the Blender
//! skill's exchange directory), then the current directory. Receipts never
//! record an absolute path: they record paths relative to that root, so a
//! production can be moved or mounted elsewhere without invalidating them.
use serde_json::Value;
use std::{
    error::Error,
    ffi::OsString,
    path::{Component, Path, PathBuf},
};

/// Environment variable naming the exchange root shared with the Blender skill.
pub const ROOT_ENV: &str = "BLENDER_SHARE";

/// Choose the production root: explicit option, then environment, then `.`.
///
/// Pure so it can be tested without touching the process environment.
///
/// ```
/// use std::{ffi::OsString, path::PathBuf};
/// use video_production_runtime::paths::resolve_root;
/// let env = Some(OsString::from("share"));
/// assert_eq!(resolve_root(Some(PathBuf::from("cli")), env.clone()), PathBuf::from("cli"));
/// assert_eq!(resolve_root(None, env), PathBuf::from("share"));
/// assert_eq!(resolve_root(None, Some(OsString::new())), PathBuf::from("."));
/// ```
pub fn resolve_root(cli: Option<PathBuf>, env: Option<OsString>) -> PathBuf {
    cli.or_else(|| env.filter(|value| !value.is_empty()).map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Remove a `--root DIR` pair from `args` and resolve the production root.
///
/// Reads [`ROOT_ENV`] from the process environment as the fallback.
pub fn take_root_option(args: &mut Vec<OsString>) -> Result<PathBuf, Box<dyn Error>> {
    let mut cli = None;
    if let Some(i) = args.iter().position(|a| a == "--root") {
        if i + 1 >= args.len() {
            return Err("--root needs a directory".into());
        }
        cli = Some(PathBuf::from(args.remove(i + 1)));
        args.remove(i);
    }
    Ok(resolve_root(cli, std::env::var_os(ROOT_ENV)))
}

/// A canonical production root that converts paths to and from receipt form.
#[derive(Clone, Debug)]
pub struct Root {
    dir: PathBuf,
}

impl Root {
    /// Canonicalise `dir`, which must exist and be a directory.
    pub fn new(dir: &Path) -> Result<Self, Box<dyn Error>> {
        let dir = std::fs::canonicalize(dir)
            .map_err(|e| format!("production root {}: {e}", dir.display()))?;
        if !dir.is_dir() {
            return Err("production root must be a directory".into());
        }
        Ok(Self { dir })
    }

    /// The canonical root directory.
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Resolve a path from a plan: relative paths are joined to the root and
    /// must have normal components only; absolute paths must lie inside it.
    pub fn resolve(&self, path: &Path) -> Result<PathBuf, Box<dyn Error>> {
        Ok(self.dir.join(self.rel(path)?))
    }

    /// The root-relative, `/`-separated form of `path` for a receipt.
    ///
    /// Rejects `..`, empty paths and absolute paths outside the root.
    ///
    /// ```
    /// # use std::path::Path;
    /// # use video_production_runtime::paths::Root;
    /// let root = Root::new(Path::new(".")).unwrap();
    /// assert_eq!(root.rel(Path::new("a/b.png")).unwrap(), "a/b.png");
    /// assert!(root.rel(Path::new("../x")).is_err());
    /// ```
    pub fn rel(&self, path: &Path) -> Result<String, Box<dyn Error>> {
        let relative = if path.is_absolute() {
            path.strip_prefix(&self.dir)
                .map(Path::to_path_buf)
                .or_else(|_| {
                    std::fs::canonicalize(path)
                        .ok()
                        .and_then(|p| p.strip_prefix(&self.dir).ok().map(Path::to_path_buf))
                        .ok_or_else(|| {
                            format!("{} lies outside the production root", path.display())
                        })
                })?
        } else {
            path.to_path_buf()
        };
        let mut parts = Vec::new();
        for component in relative.components() {
            match component {
                Component::Normal(part) => parts.push(
                    part.to_str()
                        .ok_or("receipt paths must be valid UTF-8")?
                        .to_owned(),
                ),
                Component::CurDir => {}
                _ => return Err(format!("unsafe receipt path: {}", path.display()).into()),
            }
        }
        if parts.is_empty() {
            return Err("empty receipt path".into());
        }
        Ok(parts.join("/"))
    }
}

impl Root {
    /// Rewrite every absolute path string inside this root to its relative
    /// form, in place; fail if an absolute path outside the root remains.
    ///
    /// Run over a finished receipt so that no host path is ever written.
    ///
    /// ```
    /// # use std::path::Path;
    /// # use video_production_runtime::paths::Root;
    /// let root = Root::new(Path::new(".")).unwrap();
    /// let inside = root.dir().join("a/b.png").display().to_string();
    /// let mut receipt = serde_json::json!({"path": inside});
    /// root.relativise(&mut receipt).unwrap();
    /// assert_eq!(receipt["path"], "a/b.png");
    /// assert!(root.relativise(&mut serde_json::json!(["/elsewhere/x"])).is_err());
    /// ```
    pub fn relativise(&self, value: &mut Value) -> Result<(), Box<dyn Error>> {
        match value {
            Value::String(text) if text.starts_with('/') => {
                *text = match Path::new(text.as_str()).strip_prefix(&self.dir) {
                    Ok(rest) if rest.as_os_str().is_empty() => ".".to_owned(),
                    Ok(_) => self.rel(Path::new(text.as_str()))?,
                    Err(_) => {
                        return Err(format!("absolute path outside the root: {text}").into());
                    }
                };
            }
            Value::Array(items) => {
                for item in items {
                    self.relativise(item)?;
                }
            }
            Value::Object(map) => {
                for item in map.values_mut() {
                    self.relativise(item)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
}

/// Every string in `value` that looks like an absolute or escaping path.
///
/// Receipts should return an empty list. Used by tests and by tools that want
/// to refuse writing a receipt that leaks a host path.
///
/// ```
/// # use video_production_runtime::paths::absolute_paths;
/// assert!(absolute_paths(&serde_json::json!({"a":["ok/x", "/etc/x"]})).len() == 1);
/// ```
pub fn absolute_paths(value: &Value) -> Vec<String> {
    let mut found = Vec::new();
    collect(value, &mut found);
    found
}

fn collect(value: &Value, found: &mut Vec<String>) {
    match value {
        Value::String(s) => {
            let drive = s.as_bytes().get(1) == Some(&b':') && s.as_bytes()[0].is_ascii_alphabetic();
            if s.starts_with('/') || s.starts_with('\\') || drive || s.split('/').any(|p| p == "..")
            {
                found.push(s.clone());
            }
        }
        Value::Array(items) => items.iter().for_each(|v| collect(v, found)),
        Value::Object(map) => map.values().for_each(|v| collect(v, found)),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("vpr-paths-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn root_precedence_is_cli_then_env_then_cwd() {
        let env = || Some(OsString::from("from-env"));
        assert_eq!(
            resolve_root(Some("cli".into()), env()),
            PathBuf::from("cli")
        );
        assert_eq!(resolve_root(None, env()), PathBuf::from("from-env"));
        assert_eq!(resolve_root(None, None), PathBuf::from("."));
        assert_eq!(
            resolve_root(None, Some(OsString::new())),
            PathBuf::from(".")
        );
    }

    #[test]
    fn root_option_is_removed_from_arguments() {
        let mut args: Vec<OsString> = ["a", "--root", "r", "b"].map(Into::into).into();
        assert_eq!(take_root_option(&mut args).unwrap(), PathBuf::from("r"));
        assert_eq!(args, ["a", "b"].map(OsString::from));
        let mut dangling: Vec<OsString> = vec!["--root".into()];
        assert!(take_root_option(&mut dangling).is_err());
    }

    #[test]
    fn absolute_inside_root_becomes_relative_and_outside_is_rejected() {
        let dir = temp();
        std::fs::create_dir_all(dir.join("a")).unwrap();
        std::fs::write(dir.join("a/f.png"), b"x").unwrap();
        let root = Root::new(&dir).unwrap();
        assert_eq!(root.rel(&root.dir().join("a/f.png")).unwrap(), "a/f.png");
        assert_eq!(root.rel(Path::new("./a//f.png")).unwrap(), "a/f.png");
        assert!(root.rel(Path::new("/definitely/elsewhere")).is_err());
        assert!(root.rel(Path::new("a/../../escape")).is_err());
        assert!(root.rel(Path::new("")).is_err());
        assert_eq!(
            root.resolve(Path::new("a/f.png")).unwrap(),
            root.dir().join("a/f.png")
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn relativise_rewrites_inside_paths_and_rejects_outside_ones() {
        let dir = temp();
        let root = Root::new(&dir).unwrap();
        let mut receipt = serde_json::json!({
            "a": root.dir().join("x/y.png").display().to_string(),
            "b": [root.dir().display().to_string(), "already/relative.png", "http://host/p"]});
        root.relativise(&mut receipt).unwrap();
        assert_eq!(receipt["a"], "x/y.png");
        assert_eq!(
            receipt["b"],
            serde_json::json!([".", "already/relative.png", "http://host/p"])
        );
        assert!(absolute_paths(&receipt).is_empty());
        assert!(
            root.relativise(&mut serde_json::json!({"p": "/etc/passwd"}))
                .is_err()
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn absolute_path_detector_finds_nested_leaks() {
        let leaky = serde_json::json!({"a":{"b":["fine/x.png","/abs/y.png","../up","C:\\win"]}});
        assert_eq!(absolute_paths(&leaky).len(), 3);
        assert!(absolute_paths(&serde_json::json!({"path":"x/y","url":"http://h/p"})).is_empty());
    }
}
