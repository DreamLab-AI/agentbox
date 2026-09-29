//! Keep Claude Code's OAuth credentials in step between host and container
//! (ADR-2118).
//!
//! `~/.claude` is a container-owned volume; the host's `~/.claude` is bound
//! elsewhere solely so the credential file can be shared. OAuth refresh tokens
//! rotate: whichever side refreshes invalidates the other's refresh token, so
//! both copies must converge quickly. Claude Code is a closed binary whose
//! write strategy (in place vs temp + rename) is unknown, so a symlink is not
//! trusted to survive a refresh. Instead this loop polls both files and merges
//! them.
//!
//! Merge rule, applied recursively: an object carrying a numeric `expiresAt`
//! is a token record and the one with the later expiry wins whole; any other
//! object is merged key by key (so an MCP login made on one side is never lost
//! to a Claude refresh on the other); any other value comes from the file
//! modified most recently. A side that fails to parse (caught mid-write) is
//! skipped until the next tick.

use std::path::Path;
use std::time::{Duration, SystemTime};

use serde_json::{Map, Value};

fn expiry(v: &Value) -> Option<i64> {
    v.as_object()?.get("expiresAt")?.as_i64()
}

/// Pure merge. `a_newer` breaks ties and decides plain values.
pub fn merge(a: &Value, b: &Value, a_newer: bool) -> Value {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            if let (Some(ea), Some(eb)) = (expiry(a), expiry(b)) {
                return if ea > eb || (ea == eb && a_newer) { a.clone() } else { b.clone() };
            }
            let mut out = Map::new();
            for (k, va) in x {
                let v = match y.get(k) {
                    Some(vb) => merge(va, vb, a_newer),
                    None => va.clone(),
                };
                out.insert(k.clone(), v);
            }
            for (k, vb) in y {
                if !x.contains_key(k) {
                    out.insert(k.clone(), vb.clone());
                }
            }
            Value::Object(out)
        }
        _ => {
            if a_newer {
                a.clone()
            } else {
                b.clone()
            }
        }
    }
}

struct Side {
    value: Option<Value>,
    mtime: SystemTime,
    exists: bool,
}

fn load(p: &Path) -> Side {
    let mtime = std::fs::metadata(p).and_then(|m| m.modified()).ok();
    let value = std::fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok());
    Side { exists: mtime.is_some(), mtime: mtime.unwrap_or(SystemTime::UNIX_EPOCH), value }
}

fn write(p: &Path, v: &Value) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let body = serde_json::to_vec(v).map_err(|e| e.to_string())?;
    let nonce = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| e.to_string())?.as_nanos();
    let tmp = p.with_extension(format!("json.cred-sync-{}-{nonce}.tmp", std::process::id()));
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600)
        .open(&tmp).map_err(|e| format!("{}: {e}", tmp.display()))?;
    let result = (|| {
        file.write_all(&body)?;
        file.sync_all()?;
        std::fs::rename(&tmp, p)
    })();
    if result.is_err() { let _ = std::fs::remove_file(&tmp); }
    result.map_err(|e| format!("{}: {e}", p.display()))
}

/// One reconciliation pass. Returns the number of files rewritten.
pub fn sync_once(a: &Path, b: &Path) -> Result<usize, String> {
    let (sa, sb) = (load(a), load(b));
    // A file that exists but does not parse is mid-write or damaged: wait.
    if (sa.exists && sa.value.is_none()) || (sb.exists && sb.value.is_none()) {
        return Ok(0);
    }
    let merged = match (&sa.value, &sb.value) {
        (Some(x), Some(y)) => merge(x, y, sa.mtime >= sb.mtime),
        (Some(x), None) => x.clone(),
        (None, Some(y)) => y.clone(),
        (None, None) => return Ok(0),
    };
    let mut n = 0;
    for (side, path) in [(&sa, a), (&sb, b)] {
        if side.value.as_ref() != Some(&merged) {
            write(path, &merged)?;
            n += 1;
        }
    }
    Ok(n)
}

/// CLI entry: reconcile once, then (unless `once`) poll every `interval`.
/// Polling rather than inotify: a stat every couple of seconds is negligible
/// against token lifetimes of hours, and it needs no extra dependency.
/// Without the host bind (`b`'s directory absent) there is nothing to share:
/// exit 0 so the supervisor leaves the program stopped.
pub fn run(a: &Path, b: &Path, interval: Duration, once: bool) -> Result<(), String> {
    if !b.parent().is_some_and(Path::is_dir) {
        println!("  [cred-sync] no host credential bind at {} — nothing to sync", b.display());
        return Ok(());
    }
    let report = |r: Result<usize, String>| match r {
        Ok(0) => {}
        Ok(n) => println!("  [cred-sync] reconciled ({n} file(s) rewritten)"),
        Err(e) => eprintln!("  [cred-sync] {e}"),
    };
    if once {
        return sync_once(a, b).map(|_| ());
    }
    loop {
        // Retry failed writes and torn reads even if metadata did not change.
        report(sync_once(a, b));
        std::thread::sleep(interval.max(Duration::from_secs(1)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("credsync-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn creds(claude_exp: i64, mcp: Value) -> Value {
        json!({"claudeAiOauth": {"accessToken": format!("tok-{claude_exp}"), "expiresAt": claude_exp}, "mcpOAuth": mcp})
    }

    #[test]
    fn once_reports_write_failure_and_a_later_pass_recovers() {
        let d = scratch("retry");
        let (a, b) = (d.join("missing/a.json"), d.join("b.json"));
        std::fs::write(&b, creds(50, json!({})).to_string()).unwrap();
        assert!(run(&a, &b, Duration::from_secs(1), true).is_err());
        std::fs::create_dir(d.join("missing")).unwrap();
        run(&a, &b, Duration::from_secs(1), true).unwrap();
        assert_eq!(load(&a).value, load(&b).value);
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn later_expiry_wins_regardless_of_mtime() {
        let a = creds(100, json!({}));
        let b = creds(200, json!({}));
        assert_eq!(merge(&a, &b, true)["claudeAiOauth"]["expiresAt"], 200);
        assert_eq!(merge(&b, &a, false)["claudeAiOauth"]["expiresAt"], 200);
    }

    #[test]
    fn mcp_logins_from_both_sides_survive() {
        let a = creds(300, json!({"srv-a": {"accessToken": "a", "expiresAt": 5}}));
        let b = creds(100, json!({"srv-b": {"accessToken": "b", "expiresAt": 7}}));
        let m = merge(&a, &b, false);
        assert_eq!(m["claudeAiOauth"]["expiresAt"], 300);
        assert_eq!(m["mcpOAuth"]["srv-a"]["accessToken"], "a");
        assert_eq!(m["mcpOAuth"]["srv-b"]["accessToken"], "b");
    }

    #[test]
    fn a_refresh_that_replaced_the_file_propagates_to_the_other_side() {
        let d = scratch("prop");
        let (a, b) = (d.join("container.json"), d.join("host.json"));
        std::fs::write(&a, creds(100, json!({})).to_string()).unwrap();
        std::fs::write(&b, creds(100, json!({})).to_string()).unwrap();
        assert_eq!(sync_once(&a, &b).unwrap(), 0);
        // Container refreshes by temp + rename (new inode).
        let t = d.join("x.tmp");
        std::fs::write(&t, creds(900, json!({})).to_string()).unwrap();
        std::fs::rename(&t, &a).unwrap();
        assert_eq!(sync_once(&a, &b).unwrap(), 1);
        let host: Value = serde_json::from_slice(&std::fs::read(&b).unwrap()).unwrap();
        assert_eq!(host["claudeAiOauth"]["expiresAt"], 900);
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&b).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(sync_once(&a, &b).unwrap(), 0);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn missing_side_is_seeded_and_a_torn_write_is_left_alone() {
        let d = scratch("seed");
        let (a, b) = (d.join("a.json"), d.join("b.json"));
        std::fs::write(&b, creds(50, json!({})).to_string()).unwrap();
        assert_eq!(sync_once(&a, &b).unwrap(), 1);
        assert!(a.exists());
        std::fs::write(&a, "{\"claudeAiOauth\": {").unwrap();
        assert_eq!(sync_once(&a, &b).unwrap(), 0);
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "{\"claudeAiOauth\": {");
        std::fs::remove_dir_all(&d).ok();
    }
}
