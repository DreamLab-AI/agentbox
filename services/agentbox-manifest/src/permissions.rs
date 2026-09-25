//! Claude Code permission posture — `permissions-project` (ADR-2116).
//!
//! `[claude_code]` in `agentbox.toml` is the single authority for how
//! permissive every Claude Code session in the container is:
//!
//! ```toml
//! [claude_code]
//! permission_mode = "bypassPermissions"   # auto | bypassPermissions | acceptEdits | default | plan | dontAsk
//! permission_deny = []                    # rules enforced in every mode, e.g. "Bash(docker run:*)"
//! ```
//!
//! Boot projects it into the root `~/.claude/settings.json` **and** every
//! stack profile's `.claude/settings.json` (profile sessions run with
//! `CLAUDE_CONFIG_DIR` pointed there and never read the root file). Unlike the
//! seed-if-unset defaults, this is reconciled every boot: the manifest is the
//! running configuration, and Claude Code rewrites `settings.json` from memory,
//! so a hand edit does not survive a session anyway.
//!
//! * `permissions.defaultMode` ← `permission_mode`.
//! * `bypassPermissions` also sets `skipDangerousModePermissionPrompt` (the
//!   one-time warning dialog would block unattended panes); `auto` sets
//!   `skipAutoPermissionPrompt` for the same reason.
//! * `permissions.deny` gains every `permission_deny` rule. Rules this
//!   projector added earlier and the manifest no longer lists are removed —
//!   tracked in `agentboxManagedDeny` — while hand-added deny rules are never
//!   touched.
//!
//! Fail-open: a missing or unparsable settings file, or an unknown mode, is
//! reported and skipped; boot never breaks over it.

use std::path::Path;

use serde_json::{json, Value};

use crate::{jsonio, tomlval};

/// Modes Claude Code accepts for `permissions.defaultMode`.
pub const MODES: &[&str] = &["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"];

/// Settings key recording which deny rules this projector owns.
pub const MANAGED_KEY: &str = "agentboxManagedDeny";

/// The posture read from the manifest.
#[derive(Debug, Clone, PartialEq)]
pub struct Posture {
    /// `permissions.defaultMode`.
    pub mode: String,
    /// Deny rules enforced in every mode.
    pub deny: Vec<String>,
}

/// Read `[claude_code]`. `None` when the section or the mode is absent (the
/// projector then leaves every settings file alone); `Err` for an unknown mode.
pub fn posture(manifest: &Value) -> Result<Option<Posture>, String> {
    let Some(mode) = tomlval::get(manifest, "claude_code.permission_mode").and_then(Value::as_str) else {
        return Ok(None);
    };
    if !MODES.contains(&mode) {
        return Err(format!("[claude_code].permission_mode = {mode:?} is not one of {MODES:?}"));
    }
    let deny = tomlval::get(manifest, "claude_code.permission_deny")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_owned).collect())
        .unwrap_or_default();
    Ok(Some(Posture { mode: mode.to_owned(), deny }))
}

/// Pure: apply `p` to a settings document. Returns whether anything changed.
pub fn apply(settings: &mut Value, p: &Posture) -> bool {
    if !settings.is_object() {
        *settings = json!({});
    }
    let before = settings.clone();
    let root = settings.as_object_mut().expect("object");

    let previously_managed: Vec<String> = root
        .get(MANAGED_KEY)
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_owned).collect())
        .unwrap_or_default();

    match p.mode.as_str() {
        "bypassPermissions" => {
            root.insert("skipDangerousModePermissionPrompt".into(), Value::Bool(true));
        }
        "auto" => {
            root.insert("skipAutoPermissionPrompt".into(), Value::Bool(true));
        }
        _ => {}
    }

    let perms = root.entry("permissions").or_insert_with(|| json!({}));
    if !perms.is_object() {
        *perms = json!({});
    }
    let perms = perms.as_object_mut().expect("object");
    perms.insert("defaultMode".into(), Value::String(p.mode.clone()));

    let mut deny: Vec<String> = perms
        .get("deny")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_owned).collect())
        .unwrap_or_default();
    // Retract rules we added before that the manifest has since dropped;
    // anything the operator added by hand is not ours to remove.
    deny.retain(|r| !previously_managed.contains(r) || p.deny.contains(r));
    for r in &p.deny {
        if !deny.contains(r) {
            deny.push(r.clone());
        }
    }
    if deny.is_empty() {
        perms.remove("deny");
    } else {
        perms.insert("deny".into(), json!(deny));
    }

    if p.deny.is_empty() {
        root.remove(MANAGED_KEY);
    } else {
        root.insert(MANAGED_KEY.into(), json!(p.deny));
    }
    *settings != before
}

/// Project the manifest's posture into each settings file.
pub fn run(manifest: &Path, settings: &[std::path::PathBuf], dry_run: bool) -> Result<(), String> {
    let doc = tomlval::parse_file_lenient(manifest);
    let p = match posture(&doc) {
        Ok(Some(p)) => p,
        Ok(None) => {
            println!("  [permissions] [claude_code].permission_mode unset — settings left alone");
            return Ok(());
        }
        Err(e) => {
            eprintln!("  [permissions] {e} — settings left alone");
            return Ok(());
        }
    };
    for file in settings {
        let Some(mut s) = jsonio::read_opt(file) else {
            continue;
        };
        if !apply(&mut s, &p) {
            continue;
        }
        if dry_run {
            println!("  [permissions] would set {} → {} (deny {:?})", file.display(), p.mode, p.deny);
            continue;
        }
        match jsonio::write_atomic(file, &s, true) {
            Ok(()) => println!("  [permissions] {} → defaultMode={} deny={:?}", file.display(), p.mode, p.deny),
            Err(e) => eprintln!("  [permissions] {}: {e}", file.display()),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(t: &str) -> Value {
        tomlval::parse(t).unwrap()
    }

    #[test]
    fn reads_mode_and_deny_and_rejects_unknown_modes() {
        let p = posture(&manifest("[claude_code]\npermission_mode = \"bypassPermissions\"\npermission_deny = [\"Bash(ssh:*)\"]\n"))
            .unwrap()
            .unwrap();
        assert_eq!(p.mode, "bypassPermissions");
        assert_eq!(p.deny, vec!["Bash(ssh:*)"]);
        assert!(posture(&manifest("[claude_code]\npermission_mode = \"yolo\"\n")).is_err());
        assert_eq!(posture(&manifest("[other]\nx = 1\n")).unwrap(), None);
    }

    #[test]
    fn bypass_sets_mode_and_pre_accepts_the_dialog() {
        let mut s = json!({"permissions": {"defaultMode": "auto", "allow": ["Read"]}, "model": "x"});
        let p = Posture { mode: "bypassPermissions".into(), deny: vec![] };
        assert!(apply(&mut s, &p));
        assert_eq!(s["permissions"]["defaultMode"], "bypassPermissions");
        assert_eq!(s["skipDangerousModePermissionPrompt"], true);
        assert_eq!(s["permissions"]["allow"], json!(["Read"]));
        assert_eq!(s["model"], "x");
        assert!(!apply(&mut s, &p), "idempotent");
    }

    #[test]
    fn manages_only_its_own_deny_rules() {
        let mut s = json!({"permissions": {"deny": ["Bash(rm -rf /:*)"]}});
        let with = Posture { mode: "bypassPermissions".into(), deny: vec!["Bash(ssh:*)".into()] };
        apply(&mut s, &with);
        assert_eq!(s["permissions"]["deny"], json!(["Bash(rm -rf /:*)", "Bash(ssh:*)"]));
        assert_eq!(s[MANAGED_KEY], json!(["Bash(ssh:*)"]));
        let without = Posture { mode: "bypassPermissions".into(), deny: vec![] };
        apply(&mut s, &without);
        assert_eq!(s["permissions"]["deny"], json!(["Bash(rm -rf /:*)"]), "hand-added rule survives");
        assert!(s.get(MANAGED_KEY).is_none());
    }

    #[test]
    fn missing_settings_and_unset_section_are_no_ops() {
        let dir = std::env::temp_dir().join(format!("perm-proj-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let m = dir.join("agentbox.toml");
        std::fs::write(&m, "[other]\nx = 1\n").unwrap();
        let f = dir.join("settings.json");
        std::fs::write(&f, "{\"permissions\":{\"defaultMode\":\"auto\"}}").unwrap();
        run(&m, &[f.clone(), dir.join("absent.json")], false).unwrap();
        assert!(std::fs::read_to_string(&f).unwrap().contains("\"auto\""));
        std::fs::write(&m, "[claude_code]\npermission_mode = \"bypassPermissions\"\n").unwrap();
        run(&m, std::slice::from_ref(&f), false).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert_eq!(v["permissions"]["defaultMode"], "bypassPermissions");
        std::fs::remove_dir_all(&dir).ok();
    }
}
