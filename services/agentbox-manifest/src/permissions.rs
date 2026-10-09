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
//! # Model roles (ADR-2134)
//!
//! The same section also owns the session's model roles — main model, default
//! effort and the server-side advisor tool:
//!
//! ```toml
//! [claude_code]
//! model         = "sonnet"   # alias (fable|best|opus|sonnet|haiku|opusplan, optional "[1m]") or a claude-* id
//! effort        = "high"     # low | medium | high | xhigh
//! advisor_model = "opus"     # fable | opus | sonnet | haiku | claude-* id | "off"
//! ```
//!
//! Each key maps to `model`, `effortLevel` and `advisorModel`, reconciled
//! every boot like the permission mode. A key the manifest drops is retracted
//! only if the settings file still holds the value this projector wrote
//! (tracked in `agentboxManagedRoles`); an unset key is otherwise left alone.
//! `advisor_model = "off"` removes `advisorModel`.
//!
//! Gateway profiles are skipped for roles: a settings file whose `env`, or a
//! sibling `settings.local.json` `env`, sets `ANTHROPIC_BASE_URL` routes
//! through a non-Anthropic endpoint (openrouter, zai). The advisor is an
//! Anthropic-API server tool, and those wrappers pin their own model.
//!
//! Fail-open: a missing or unparsable settings file, an unknown mode or an
//! invalid role value is reported and skipped; boot never breaks over it.

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

/// Settings key recording the role values this projector wrote.
pub const MANAGED_ROLES_KEY: &str = "agentboxManagedRoles";

/// Levels the persisted `effortLevel` setting accepts (`max` is not one).
pub const EFFORTS: &[&str] = &["low", "medium", "high", "xhigh"];

/// Model aliases Claude Code resolves, in advisor rank order where it applies.
const MODEL_ALIASES: &[&str] = &["haiku", "sonnet", "opus", "fable", "best", "opusplan"];

/// Model roles read from the manifest. `None` leaves the setting alone.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Roles {
    /// `model` — the main session model.
    pub model: Option<String>,
    /// `effortLevel` — default effort for models without one.
    pub effort: Option<String>,
    /// `advisorModel`; `Some("off")` removes it.
    pub advisor: Option<String>,
}

fn valid_model(m: &str) -> bool {
    let base = m.strip_suffix("[1m]").unwrap_or(m);
    MODEL_ALIASES.contains(&base) || (base.starts_with("claude-") && base.len() > 7)
}

/// Coarse family rank for the advisor pairing check: an advisor must rank at
/// or above the main model. `None` for full ids and composite aliases, which
/// Claude Code checks itself.
fn family_rank(m: &str) -> Option<u8> {
    match m.strip_suffix("[1m]").unwrap_or(m) {
        "haiku" => Some(1),
        "sonnet" => Some(2),
        "opus" => Some(3),
        "fable" => Some(4),
        _ => None,
    }
}

/// Read the role keys of `[claude_code]`. `Err` names the first invalid value.
pub fn roles(manifest: &Value) -> Result<Roles, String> {
    let s = |k: &str| tomlval::get(manifest, &format!("claude_code.{k}")).and_then(Value::as_str).map(str::to_owned);
    let r = Roles { model: s("model"), effort: s("effort"), advisor: s("advisor_model") };
    if let Some(m) = &r.model {
        if !valid_model(m) {
            return Err(format!("[claude_code].model = {m:?} is not an alias {MODEL_ALIASES:?} or a claude-* id"));
        }
    }
    if let Some(e) = &r.effort {
        if !EFFORTS.contains(&e.as_str()) {
            return Err(format!("[claude_code].effort = {e:?} is not one of {EFFORTS:?}"));
        }
    }
    if let Some(a) = &r.advisor {
        let base = a.as_str();
        if base != "off" && (!valid_model(base) || matches!(base, "best" | "opusplan") || base.ends_with("[1m]")) {
            return Err(format!("[claude_code].advisor_model = {a:?} is not fable|opus|sonnet|haiku, a claude-* id or \"off\""));
        }
    }
    Ok(r)
}

/// A warning when the advisor ranks below the main model: Claude Code then
/// never attaches it to the main session's requests.
pub fn pairing_warning(r: &Roles) -> Option<String> {
    let (m, a) = (r.model.as_deref()?, r.advisor.as_deref()?);
    let (rm, ra) = (family_rank(m)?, family_rank(a)?);
    (ra < rm).then(|| format!("advisor_model {a:?} ranks below model {m:?}; Claude Code will not attach it to the main session"))
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

/// Pure: apply model roles to a settings document. Returns whether anything changed.
pub fn apply_roles(settings: &mut Value, r: &Roles) -> bool {
    if !settings.is_object() {
        *settings = json!({});
    }
    let before = settings.clone();
    let root = settings.as_object_mut().expect("object");
    let managed = root.get(MANAGED_ROLES_KEY).cloned().unwrap_or_else(|| json!({}));
    let mut now_managed = serde_json::Map::new();

    for (key, want) in [("model", &r.model), ("effortLevel", &r.effort), ("advisorModel", &r.advisor)] {
        match want.as_deref() {
            Some("off") => {
                root.remove(key);
            }
            Some(v) => {
                root.insert(key.into(), Value::String(v.to_owned()));
                now_managed.insert(key.into(), Value::String(v.to_owned()));
            }
            // Retract only a value we wrote and nobody has changed since.
            None => {
                if managed.get(key).is_some() && root.get(key) == managed.get(key) {
                    root.remove(key);
                }
            }
        }
    }
    if now_managed.is_empty() {
        root.remove(MANAGED_ROLES_KEY);
    } else {
        root.insert(MANAGED_ROLES_KEY.into(), Value::Object(now_managed));
    }
    *settings != before
}

/// True when the settings file, or its sibling `settings.local.json`, routes
/// Claude Code through a non-Anthropic endpoint.
fn is_gateway(file: &Path, s: &Value) -> bool {
    let has_base = |v: &Value| {
        v.pointer("/env/ANTHROPIC_BASE_URL").and_then(Value::as_str).is_some_and(|u| !u.trim().is_empty())
    };
    has_base(s) || file.parent().and_then(|d| jsonio::read_opt(&d.join("settings.local.json"))).is_some_and(|l| has_base(&l))
}

/// Project the manifest's posture into each settings file.
pub fn run(manifest: &Path, settings: &[std::path::PathBuf], dry_run: bool) -> Result<(), String> {
    let doc = tomlval::parse_file_lenient(manifest);
    let p = match posture(&doc) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("  [permissions] {e} — permission posture left alone");
            None
        }
    };
    let r = match roles(&doc) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("  [roles] {e} — model roles left alone");
            Roles::default()
        }
    };
    if p.is_none() {
        println!("  [permissions] [claude_code].permission_mode unset or invalid — permission posture left alone");
    }
    if let Some(w) = pairing_warning(&r) {
        eprintln!("  [roles] warning: {w}");
    }
    for file in settings {
        let Some(mut s) = jsonio::read_opt(file) else {
            continue;
        };
        let mut changed = false;
        if let Some(p) = &p {
            changed |= apply(&mut s, p);
        }
        let gateway = is_gateway(file, &s);
        // Roles still run with an empty manifest so earlier values are retracted.
        if !gateway {
            changed |= apply_roles(&mut s, &r);
        }
        if !changed {
            continue;
        }
        let summary = format!(
            "defaultMode={} model={} effort={} advisor={}{}",
            p.as_ref().map_or("-", |p| p.mode.as_str()),
            s.get("model").and_then(Value::as_str).unwrap_or("-"),
            s.get("effortLevel").and_then(Value::as_str).unwrap_or("-"),
            s.get("advisorModel").and_then(Value::as_str).unwrap_or("-"),
            if gateway { " (gateway: roles skipped)" } else { "" },
        );
        if dry_run {
            println!("  [permissions] would set {} → {summary}", file.display());
            continue;
        }
        match jsonio::write_atomic(file, &s, true) {
            Ok(()) => println!("  [permissions] {} → {summary}", file.display()),
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

    #[test]
    fn roles_validate_and_warn_on_a_weaker_advisor() {
        let r = roles(&manifest("[claude_code]\nmodel = \"sonnet\"\neffort = \"high\"\nadvisor_model = \"opus\"\n")).unwrap();
        assert_eq!(r.model.as_deref(), Some("sonnet"));
        assert_eq!(pairing_warning(&r), None);
        assert!(roles(&manifest("[claude_code]\neffort = \"max\"\n")).is_err(), "effortLevel rejects max");
        assert!(roles(&manifest("[claude_code]\nmodel = \"gpt-6\"\n")).is_err());
        assert!(roles(&manifest("[claude_code]\nadvisor_model = \"opusplan\"\n")).is_err());
        assert!(roles(&manifest("[claude_code]\nmodel = \"opus[1m]\"\nadvisor_model = \"claude-opus-5-5\"\n")).is_ok());
        let weak = roles(&manifest("[claude_code]\nmodel = \"opus[1m]\"\nadvisor_model = \"sonnet\"\n")).unwrap();
        assert!(pairing_warning(&weak).is_some());
    }

    #[test]
    fn roles_set_retract_only_their_own_values_and_honour_off() {
        let mut s = json!({"model": "opus[1m]", "effortLevel": "medium", "theme": "dark"});
        let r = Roles { model: Some("sonnet".into()), effort: Some("high".into()), advisor: Some("opus".into()) };
        assert!(apply_roles(&mut s, &r));
        assert_eq!((s["model"].as_str(), s["effortLevel"].as_str(), s["advisorModel"].as_str()), (Some("sonnet"), Some("high"), Some("opus")));
        assert_eq!(s["theme"], "dark");
        assert!(!apply_roles(&mut s, &r), "idempotent");
        // Operator switches model by hand, then the manifest drops every role key.
        s["model"] = json!("fable");
        assert!(apply_roles(&mut s, &Roles::default()));
        assert_eq!(s["model"], "fable", "a hand-changed value is not ours to retract");
        assert!(s.get("effortLevel").is_none() && s.get("advisorModel").is_none());
        assert!(s.get(MANAGED_ROLES_KEY).is_none());
        // "off" removes a hand-set advisor too.
        s["advisorModel"] = json!("opus");
        apply_roles(&mut s, &Roles { advisor: Some("off".into()), ..Roles::default() });
        assert!(s.get("advisorModel").is_none());
    }

    #[test]
    fn gateway_profiles_get_permissions_but_not_roles() {
        let dir = std::env::temp_dir().join(format!("roles-proj-{}", std::process::id()));
        let prof = dir.join("openrouter");
        std::fs::create_dir_all(&prof).unwrap();
        let m = dir.join("agentbox.toml");
        std::fs::write(&m, "[claude_code]\npermission_mode = \"bypassPermissions\"\nmodel = \"sonnet\"\nadvisor_model = \"opus\"\n").unwrap();
        let root = dir.join("settings.json");
        std::fs::write(&root, "{}").unwrap();
        let gw = prof.join("settings.json");
        std::fs::write(&gw, "{}").unwrap();
        std::fs::write(prof.join("settings.local.json"), "{\"env\":{\"ANTHROPIC_BASE_URL\":\"https://openrouter.ai/api\"}}").unwrap();
        run(&m, &[root.clone(), gw.clone()], false).unwrap();
        let read = |f: &Path| -> Value { serde_json::from_str(&std::fs::read_to_string(f).unwrap()).unwrap() };
        let (r, g) = (read(&root), read(&gw));
        assert_eq!((r["model"].as_str(), r["advisorModel"].as_str()), (Some("sonnet"), Some("opus")));
        assert_eq!(g["permissions"]["defaultMode"], "bypassPermissions");
        assert!(g.get("model").is_none() && g.get("advisorModel").is_none());
        std::fs::remove_dir_all(&dir).ok();
    }
}
