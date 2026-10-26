//! Comment-preserving TOML editing for the agentbox setup wizard.
//!
//! The wizard must never regenerate `agentbox.toml` from a parsed object: doing
//! so drops every comment and reformats the file. Instead the browser sends a
//! list of targeted [`Edit`]s and [`apply_edits`] rewrites only the value
//! tokens concerned, keeping comments, ordering and whitespace byte-for-byte.
//!
//! Also provided: [`parse_to_json`] (what the UI displays) and [`atomic_write`]
//! (how the file is saved).

use serde::Deserialize;
use serde_json::Value as Json;
use std::{fs, io::Write, path::Path};
use toml_edit::{Array, DocumentMut, Item, Table, TableLike, Value};

/// One step of an edit path: a table key or an array-of-tables index.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum Seg {
    /// Index into an array of tables (`[[plugins.packages]]`) or an array of inline tables.
    Idx(usize),
    /// Table key.
    Key(String),
}

/// Set the value at `path` to `value`.
#[derive(Debug, Clone, Deserialize)]
pub struct Edit {
    /// Path from the document root, e.g. `["plugins","packages",3,"enabled"]`.
    pub path: Vec<Seg>,
    /// New value. Coerced to the existing value's TOML type where there is one.
    pub value: Json,
}

/// Errors from editing.
#[derive(Debug)]
pub struct EditError(pub String);

impl std::fmt::Display for EditError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for EditError {}

fn err<T>(m: impl Into<String>) -> Result<T, EditError> {
    Err(EditError(m.into()))
}

fn show(path: &[Seg]) -> String {
    path.iter()
        .map(|s| match s {
            Seg::Key(k) => k.clone(),
            Seg::Idx(i) => format!("[{i}]"),
        })
        .collect::<Vec<_>>()
        .join(".")
}

/// Apply `edits` to `text`, returning the new document text. Unedited bytes,
/// including comments, are preserved exactly; an edit that does not change a
/// value leaves the text untouched.
pub fn apply_edits(text: &str, edits: &[Edit]) -> Result<String, EditError> {
    let mut doc: DocumentMut = text
        .parse()
        .map_err(|e| EditError(format!("Invalid TOML: {e}")))?;
    for e in edits {
        if e.path.is_empty() {
            return err("empty edit path");
        }
        walk_table(doc.as_table_mut(), &e.path, &e.value)
            .map_err(|m| EditError(format!("{}: {}", show(&e.path), m.0)))?;
    }
    Ok(doc.to_string())
}

fn walk_table(t: &mut dyn TableLike, segs: &[Seg], v: &Json) -> Result<(), EditError> {
    let (key, rest) = match segs {
        [Seg::Key(k), rest @ ..] => (k.as_str(), rest),
        _ => return err("expected a key"),
    };
    if rest.is_empty() {
        return match t.get_mut(key) {
            Some(item) => set_leaf(item, v),
            None => {
                t.insert(key, Item::Value(from_json(v)?));
                Ok(())
            }
        };
    }
    if t.get(key).is_none() {
        if matches!(rest[0], Seg::Idx(_)) {
            return err(format!("`{key}` does not exist"));
        }
        let mut tbl = Table::new();
        tbl.set_implicit(true);
        t.insert(key, Item::Table(tbl));
    }
    let child = t.get_mut(key).expect("just ensured");
    match (&rest[0], child) {
        (Seg::Idx(i), Item::ArrayOfTables(a)) => {
            let len = a.len();
            let tbl = a
                .get_mut(*i)
                .ok_or_else(|| EditError(format!("index {i} out of range (len {len})")))?;
            if rest.len() < 2 {
                return err("cannot replace a whole table entry");
            }
            walk_table(tbl, &rest[1..], v)
        }
        (Seg::Idx(i), Item::Value(Value::Array(arr))) => {
            let len = arr.len();
            let el = arr
                .get_mut(*i)
                .ok_or_else(|| EditError(format!("index {i} out of range (len {len})")))?;
            if rest.len() == 1 {
                return set_value(el, v);
            }
            match el.as_inline_table_mut() {
                Some(it) => walk_table(it, &rest[1..], v),
                None => err("element is not a table"),
            }
        }
        (Seg::Idx(_), _) => err(format!("`{key}` is not an array")),
        (Seg::Key(_), child) => match child.as_table_like_mut() {
            Some(next) => walk_table(next, rest, v),
            None => err(format!("`{key}` is not a table")),
        },
    }
}

fn set_leaf(item: &mut Item, v: &Json) -> Result<(), EditError> {
    match item {
        Item::Value(old) => set_value(old, v),
        _ => err("not a scalar or array value"),
    }
}

/// Replace `old` with `v`, keeping its decor (and so any inline `# comment`).
fn set_value(old: &mut Value, v: &Json) -> Result<(), EditError> {
    if value_to_json(old) == *v {
        return Ok(());
    }
    if let Value::Array(arr) = old {
        if array_has_comments(arr) {
            return err("this list has comments inside it, which a form edit would delete; use Edit Raw TOML so they are kept");
        }
    }
    let mut nv = coerce(old, v)?;
    *nv.decor_mut() = old.decor().clone();
    *old = nv;
    Ok(())
}

/// True when a `#` comment sits inside the array brackets (between elements or
/// after the last one). Replacing such an array would silently delete it.
fn array_has_comments(arr: &Array) -> bool {
    let has = |r: Option<&toml_edit::RawString>| r.and_then(|r| r.as_str()).is_some_and(|s| s.contains('#'));
    has(arr.trailing().into()) || arr.iter().any(|v| has(v.decor().prefix()) || has(v.decor().suffix()))
}

fn coerce(old: &Value, v: &Json) -> Result<Value, EditError> {
    match (old, v) {
        (Value::Float(_), Json::Number(n)) => n
            .as_f64()
            .map(Value::from)
            .ok_or_else(|| EditError("number out of range".into())),
        (Value::Integer(_), Json::Number(n)) => match n.as_i64() {
            Some(i) => Ok(Value::from(i)),
            None => err("expected an integer"),
        },
        (Value::Boolean(_), Json::Bool(_))
        | (Value::String(_), Json::String(_))
        | (Value::Array(_), Json::Array(_)) => from_json(v),
        (o, _) => err(format!(
            "type mismatch: existing value is {}",
            o.type_name()
        )),
    }
}

fn from_json(v: &Json) -> Result<Value, EditError> {
    Ok(match v {
        Json::Bool(b) => Value::from(*b),
        Json::String(s) => Value::from(s.as_str()),
        Json::Number(n) => match (n.as_i64(), n.as_f64()) {
            (Some(i), _) => Value::from(i),
            (None, Some(f)) => Value::from(f),
            _ => return err("number out of range"),
        },
        Json::Array(a) => {
            let mut arr = Array::new();
            for x in a {
                arr.push(from_json(x)?);
            }
            Value::Array(arr)
        }
        Json::Null => return err("TOML has no null; omit the key instead"),
        Json::Object(_) => return err("objects cannot be set as a value"),
    })
}

fn value_to_json(v: &Value) -> Json {
    match v {
        Value::String(s) => Json::String(s.value().clone()),
        Value::Integer(i) => Json::from(*i.value()),
        Value::Float(f) => serde_json::Number::from_f64(*f.value())
            .map(Json::Number)
            .unwrap_or(Json::Null),
        Value::Boolean(b) => Json::Bool(*b.value()),
        Value::Datetime(d) => Json::String(d.value().to_string()),
        Value::Array(a) => Json::Array(a.iter().map(value_to_json).collect()),
        Value::InlineTable(t) => Json::Object(
            t.iter()
                .map(|(k, v)| (k.to_string(), value_to_json(v)))
                .collect(),
        ),
    }
}

/// Parse TOML text to JSON using the `toml` crate (the same grammar the
/// manifest tools use). Datetimes become strings.
pub fn parse_to_json(text: &str) -> Result<Json, String> {
    let v: toml::Value = toml::from_str(text).map_err(|e| e.to_string())?;
    Ok(toml_to_json(&v))
}

fn toml_to_json(v: &toml::Value) -> Json {
    match v {
        toml::Value::String(s) => Json::String(s.clone()),
        toml::Value::Integer(i) => Json::from(*i),
        toml::Value::Float(f) => serde_json::Number::from_f64(*f)
            .map(Json::Number)
            .unwrap_or(Json::Null),
        toml::Value::Boolean(b) => Json::Bool(*b),
        toml::Value::Datetime(d) => Json::String(d.to_string()),
        toml::Value::Array(a) => Json::Array(a.iter().map(toml_to_json).collect()),
        toml::Value::Table(t) => {
            Json::Object(t.iter().map(|(k, v)| (k.clone(), toml_to_json(v))).collect())
        }
    }
}

/// Check that `text` is valid TOML.
pub fn validate(text: &str) -> Result<(), String> {
    text.parse::<DocumentMut>().map(|_| ()).map_err(|e| e.to_string())?;
    toml::from_str::<toml::Value>(text).map(|_| ()).map_err(|e| e.to_string())
}

/// Write `content` to `path` atomically: a temp file in the same directory is
/// written and fsynced, given the original's permissions, then renamed over the
/// target. Symlinks are followed so the link itself survives. A failed write
/// never leaves a truncated target.
pub fn atomic_write(path: &Path, content: &str) -> std::io::Result<()> {
    let target = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let dir = target.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "agentbox.toml".into());
    let tmp = dir.join(format!(".{name}.setup-tmp-{}", std::process::id()));
    let result = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
        if let Ok(meta) = fs::metadata(&target) {
            fs::set_permissions(&tmp, meta.permissions())?;
        }
        fs::rename(&tmp, &target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}
