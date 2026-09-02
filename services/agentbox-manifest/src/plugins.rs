//! Claude Code plugin registration and the `[[plugins.packages]]` reader.
//!
//! Covers three entrypoint sites: the two `installed_plugins.json` heredocs
//! (skill-creator, codex) and the Q27 `tomllib` plugin-list parser whose whole
//! purpose is to keep an attacker-controlled plugin name out of a `su -c`
//! string. The validation regex is reproduced verbatim so that property holds.

use std::path::Path;

use regex::Regex;
use serde_json::{Map, Value};

use crate::jsonio;
use crate::tomlval;

/// `datetime.datetime.utcnow().isoformat() + "Z"`.
///
/// CPython renders microseconds as exactly six digits and **omits the
/// fractional part entirely when it is zero**; both branches are reproduced so
/// the field is indistinguishable from what the Python wrote.
pub fn utc_now_isoformat_z() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs() as i64;
    let micros = now.subsec_micros();
    let (y, mo, d, h, mi, s) = civil_from_unix(secs);
    if micros == 0 {
        format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
    } else {
        format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{micros:06}Z")
    }
}

/// Howard Hinnant's `civil_from_days`, proleptic Gregorian, era-based.
fn civil_from_unix(unix_secs: i64) -> (i64, u32, u32, u32, u32, u32) {
    let days = unix_secs.div_euclid(86_400);
    let rem = unix_secs.rem_euclid(86_400);

    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };

    (
        y,
        m,
        d,
        (rem / 3_600) as u32,
        ((rem % 3_600) / 60) as u32,
        (rem % 60) as u32,
    )
}

/// Register a marketplace plugin, printing `message` only when it was added.
///
/// Unreadable or corrupt input exits 0 without writing, matching the Python's
/// `try: json.load(...) except: sys.exit(0)`.
pub fn register(
    file: &Path,
    key: &str,
    install_path: &str,
    message: &str,
    now: &str,
) -> Result<(), String> {
    let Some(mut data) = jsonio::read_opt(file) else {
        return Ok(());
    };
    if !data.is_object() {
        return Ok(());
    }
    let root = data.as_object_mut().expect("object");
    root.entry("plugins".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let Some(plugins) = root.get_mut("plugins").and_then(Value::as_object_mut) else {
        return Ok(());
    };
    if plugins.contains_key(key) {
        return Ok(());
    }
    plugins.insert(
        key.to_string(),
        serde_json::json!([{
            "scope": "user",
            "installPath": install_path,
            "version": "marketplace",
            "installedAt": now,
            "lastUpdated": now,
        }]),
    );
    jsonio::write(file, &data, false).map_err(|e| format!("{}: {e}", file.display()))?;
    println!("{message}");
    Ok(())
}

/// One validated `[[plugins.packages]]` row.
pub struct PluginRow {
    pub name: String,
    pub source: String,
}

/// Parse enabled, validated plugin rows out of the manifest.
///
/// Returns the accepted rows plus the stderr diagnostics for the rejected ones.
/// The name regex is Q27's: it rejects anything that could break out of the
/// shell quoting in the `su -c` install command downstream.
pub fn read_packages(manifest: &Value) -> (Vec<PluginRow>, Vec<String>) {
    let name_re = Regex::new(r"^[a-zA-Z0-9@/_.+\-]+$").expect("static regex");
    let mut rows = Vec::new();
    let mut warnings = Vec::new();

    let packages = tomlval::get(manifest, "plugins.packages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for entry in packages {
        if !entry
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            continue;
        }
        let name = entry.get("name").and_then(Value::as_str).unwrap_or("");
        let source = entry
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or("ruflo-git");
        if !name_re.is_match(name) {
            warnings.push(format!(
                "[plugin] skipping suspicious name: {}",
                py_repr(name)
            ));
            continue;
        }
        if source != "ruflo-git" && source != "registry" {
            warnings.push(format!(
                "[plugin] skipping unknown source: {} for {name}",
                py_repr(source)
            ));
            continue;
        }
        rows.push(PluginRow {
            name: name.to_string(),
            source: source.to_string(),
        });
    }
    (rows, warnings)
}

/// `repr()` for a Python `str`: single quotes unless the value contains one.
/// Diagnostic surface only — nothing greps these lines.
fn py_repr(s: &str) -> String {
    if s.contains('\'') && !s.contains('"') {
        format!("\"{s}\"")
    } else {
        format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unix_epoch_renders_as_the_epoch() {
        assert_eq!(civil_from_unix(0), (1970, 1, 1, 0, 0, 0));
    }

    #[test]
    fn a_known_instant_round_trips() {
        // 2026-09-02T12:34:56Z
        assert_eq!(civil_from_unix(1_788_352_496), (2026, 9, 2, 12, 34, 56));
    }

    #[test]
    fn leap_day_is_handled() {
        // 2024-02-29T00:00:00Z
        assert_eq!(civil_from_unix(1_709_164_800), (2024, 2, 29, 0, 0, 0));
    }

    #[test]
    fn disabled_and_malformed_rows_are_dropped() {
        let manifest = tomlval::parse(
            r#"
[[plugins.packages]]
name = "good-one"
enabled = true

[[plugins.packages]]
name = "disabled"
enabled = false

[[plugins.packages]]
name = "bad name; rm -rf /"
enabled = true

[[plugins.packages]]
name = "wrong-source"
source = "http"
enabled = true
"#,
        )
        .unwrap();
        let (rows, warnings) = read_packages(&manifest);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "good-one");
        assert_eq!(rows[0].source, "ruflo-git");
        assert_eq!(warnings.len(), 2);
        assert!(warnings[0].contains("suspicious name"));
        assert!(warnings[1].contains("unknown source"));
    }

    #[test]
    fn a_quote_in_a_name_is_rejected_not_escaped() {
        let manifest =
            tomlval::parse("[[plugins.packages]]\nname = \"a'; su root #\"\nenabled = true\n")
                .unwrap();
        let (rows, warnings) = read_packages(&manifest);
        assert!(rows.is_empty());
        assert_eq!(warnings.len(), 1);
    }

    #[test]
    fn missing_packages_table_yields_nothing() {
        let manifest = tomlval::parse("[core]\nx = 1\n").unwrap();
        let (rows, warnings) = read_packages(&manifest);
        assert!(rows.is_empty() && warnings.is_empty());
    }
}
