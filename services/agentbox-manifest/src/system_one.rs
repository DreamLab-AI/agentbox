//! ADR-2139 boot projection: `[system_one]` → the proxy's projection file and
//! the three System One consumers.
//!
//! The judge is a vendor slot. One loopback proxy (`system-one-proxy`) is what
//! every consumer calls; this module decides what the proxy forwards to and
//! tells the consumers where the proxy is, what model answers and whether the
//! selected backend is local. Three properties carry over from [`crate::sso`]:
//!
//! * **Disabled projects NOTHING** — no output at all, so the cloud path is
//!   byte-identical to a manifest without the block (ADR-2020).
//! * **Locality is declared, never inferred** (ADR-2094 §5). `backendLocal`
//!   is the selected backend's own `local` flag, and the projection file
//!   records it as `projected_local` so a later live switch, or a proxy
//!   restart, cannot re-baseline what the consumers were told at boot.
//! * **Fail-open.** An unusable slot prints a diagnostic to stderr, projects
//!   nothing and exits 0. The ONE exception is a refused `--switch`, which is
//!   an operator command and exits 1 so the caller does not rewrite the file.
//!
//! Every backend in the map is validated, not just the active one, because
//! the file carries the whole map and a live switch may select any of them.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Map, Value};

use crate::sso::is_local_endpoint;
use crate::tomlval;

/// Output shape requested by the caller.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// `export KEY='value'` lines for `runtime-env.sh` and the hook prefix.
    Shell,
    /// `key=value` lines for `claude plugin install --config key=value`.
    PluginConfig,
    /// The proxy's projection file (`/run/agentbox/system-one.json`).
    Json,
}

impl std::str::FromStr for Format {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "shell" => Ok(Format::Shell),
            "plugin-config" => Ok(Format::PluginConfig),
            "json" => Ok(Format::Json),
            other => Err(format!(
                "unknown format {other:?} (expected shell, plugin-config or json)"
            )),
        }
    }
}

/// One declared backend.
#[derive(Clone, Debug, PartialEq)]
pub struct Backend {
    /// Its `POST /v1/systemone`.
    pub url: String,
    /// Model id the proxy writes into every forwarded request.
    pub model: String,
    /// NAME of the env var holding the key; empty = keyless.
    pub key_env: String,
    /// Declared locality.
    pub local: bool,
    /// Upstream deadline.
    pub timeout_ms: i64,
    /// Input price per million tokens.
    pub usd_per_mtok_in: f64,
}

/// The resolved, wholly valid slot.
#[derive(Clone, Debug, PartialEq)]
pub struct Projection {
    /// Proxy listen address (loopback).
    pub bind: String,
    /// JSONL request log path; empty disables.
    pub log: String,
    /// The active backend's name.
    pub active: String,
    /// Every declared backend, in manifest order.
    pub backends: Vec<(String, Backend)>,
}

impl Projection {
    /// The URL every consumer is pointed at.
    #[must_use]
    pub fn endpoint(&self) -> String {
        format!("http://{}/v1/systemone", self.bind)
    }

    fn backend(&self, name: &str) -> Option<&Backend> {
        self.backends
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, b)| b)
    }
}

/// Loopback host check for `bind`.
fn is_loopback_bind(bind: &str) -> bool {
    let host = if let Some(end) = bind.find(']') {
        bind.get(1..end).unwrap_or("")
    } else {
        bind.rsplit_once(':').map_or(bind, |(h, _)| h)
    };
    let host = host.to_ascii_lowercase();
    host == "localhost" || host == "::1" || host.starts_with("127.")
}

/// Resolve the slot, or `None` when it is off or unusable.
pub fn resolve(manifest: &Value, warn: &mut dyn FnMut(String)) -> Option<Projection> {
    let so = tomlval::get(manifest, "system_one")?;
    if !so.get("enabled").and_then(Value::as_bool).unwrap_or(false) {
        return None;
    }
    let active = so
        .get("backend")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let bind = so
        .get("bind")
        .and_then(Value::as_str)
        .unwrap_or("127.0.0.1:8094")
        .trim()
        .to_string();
    let log = so
        .get("log")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if !is_loopback_bind(&bind) {
        warn(format!(
            "[system-one] bind {bind} is not loopback — refusing to project (the proxy spends the vendor keys for whoever can reach it, E080)"
        ));
        return None;
    }
    let Some(map) = so.get("backends").and_then(Value::as_object) else {
        warn(
            "[system-one] enabled but no [system_one.backends] — leaving the cloud path in place"
                .into(),
        );
        return None;
    };
    let mut backends = Vec::with_capacity(map.len());
    for (name, raw) in map {
        let b = Backend {
            url: raw
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string(),
            model: raw
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string(),
            key_env: raw
                .get("key_env")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string(),
            local: raw.get("local").and_then(Value::as_bool).unwrap_or(false),
            timeout_ms: raw
                .get("timeout_ms")
                .and_then(Value::as_i64)
                .unwrap_or(30_000),
            usd_per_mtok_in: raw
                .get("usd_per_mtok_in")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
        };
        if b.url.is_empty() {
            warn(format!(
                "[system-one] backend {name} has no url — refusing to project (E080)"
            ));
            return None;
        }
        if b.local {
            if !b.key_env.is_empty() {
                warn(format!(
                    "[system-one] backend {name} is local=true but names key_env={} — local backends are keyless; refusing to project (E080)",
                    b.key_env
                ));
                return None;
            }
            if !is_local_endpoint(&b.url) {
                warn(format!(
                    "[system-one] backend {name} is local=true but {} is not a LAN/loopback host — refusing to project (ADR-2094 §5, E080)",
                    b.url
                ));
                return None;
            }
        } else {
            if !b.url.starts_with("https://") {
                warn(format!(
                    "[system-one] backend {name} is a cloud backend but {} is not https — refusing to project (E080)",
                    b.url
                ));
                return None;
            }
            if b.key_env.is_empty() {
                warn(format!(
                    "[system-one] backend {name} is a cloud backend with no key_env — refusing to project (E080)"
                ));
                return None;
            }
        }
        backends.push((name.clone(), b));
    }
    if !backends.iter().any(|(n, _)| *n == active) {
        warn(format!(
            "[system-one] backend {active:?} is not one of [system_one.backends] ({}) — refusing to project (E080)",
            backends.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>().join(", ")
        ));
        return None;
    }
    Some(Projection {
        bind,
        log,
        active,
        backends,
    })
}

/// What a previously written projection file said, as far as a switch needs.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Existing {
    /// `projected_local` as recorded at boot (`None` = consumers not projected).
    pub projected_local: Option<bool>,
    /// `projected_at` as recorded at boot.
    pub projected_at: Option<String>,
}

impl Existing {
    /// Read a projection file; unreadable or malformed ⇒ `None` (the caller warns).
    pub fn read(path: &Path) -> Option<Existing> {
        let text = std::fs::read_to_string(path).ok()?;
        let v: Value = serde_json::from_str(&text).ok()?;
        Some(Existing {
            projected_local: v.get("projected_local").and_then(Value::as_bool),
            projected_at: v
                .get("projected_at")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
    }
}

/// Why a switch was refused.
#[derive(Debug, PartialEq, Eq)]
pub struct SwitchRefused(pub String);

impl std::fmt::Display for SwitchRefused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Decide the `active` backend for a rendered file: the manifest's, or
/// `switch` when given — refused when the consumers were projected local at
/// boot and the target is a cloud backend (ADR-2094 §5). The reverse only
/// over-blocks and is allowed.
pub fn select_active(
    p: &Projection,
    existing: Option<&Existing>,
    switch: Option<&str>,
) -> Result<String, SwitchRefused> {
    let Some(name) = switch else {
        return Ok(p.active.clone());
    };
    let Some(target) = p.backend(name) else {
        return Err(SwitchRefused(format!(
            "[system-one] refusing switch to {name}: not one of [system_one.backends]"
        )));
    };
    if existing.and_then(|e| e.projected_local) == Some(true) && !target.local {
        return Err(SwitchRefused(format!(
            "[system-one] refusing switch to {name}: consumers were projected local=true at boot and {name} is a cloud backend — restart the container (ADR-2094 §5)"
        )));
    }
    Ok(name.to_string())
}

/// RFC 3339 UTC timestamp without a date crate (seconds precision).
fn now_rfc3339() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    // Civil-from-days (Howard Hinnant), valid for the proleptic Gregorian calendar.
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Render the projection file as JSON.
pub fn render_json(p: &Projection, active: &str, existing: Option<&Existing>) -> Value {
    let mut backends = Map::new();
    for (name, b) in &p.backends {
        backends.insert(
            name.clone(),
            json!({
                "url": b.url,
                "model": b.model,
                "key_env": b.key_env,
                "local": b.local,
                "timeout_ms": b.timeout_ms,
                "usd_per_mtok_in": b.usd_per_mtok_in,
            }),
        );
    }
    let selected_local = p.backend(active).map(|b| b.local);
    let (projected_local, projected_at) = match existing {
        Some(e) => (
            e.projected_local.map_or(Value::Null, Value::Bool),
            Value::String(e.projected_at.clone().unwrap_or_else(now_rfc3339)),
        ),
        None => (
            selected_local.map_or(Value::Null, Value::Bool),
            Value::String(now_rfc3339()),
        ),
    };
    json!({
        "version": 1,
        "enabled": true,
        "bind": p.bind,
        "log": p.log,
        "active": active,
        "projected_local": projected_local,
        "projected_at": projected_at,
        "backends": backends,
    })
}

/// Project explicit consumer opt-ins and a separately validated private-data route.
/// A cloud backend can never be relabelled local; private consumers fail closed.
fn consumer_exports(manifest: &Value, p: &Projection, warn: &mut dyn FnMut(String)) -> Vec<String> {
    let mut lines = Vec::new();
    let local = tomlval::get(manifest, "system_one.local_backend")
        .and_then(Value::as_str)
        .and_then(|name| p.backend(name));
    let local = local.filter(|b| b.local && b.key_env.is_empty() && is_local_endpoint(&b.url));
    if tomlval::get(manifest, "system_one.local_backend").is_some() && local.is_none() {
        warn("[system-one] local_backend must name a declared keyless LAN backend; private route disabled".into());
    }
    // Emit empty values too: withdrawing the route must clear an inherited export.
    lines.push(format!(
        "export AGENTBOX_SYSTEM_ONE_LOCAL_ENDPOINT={}",
        shq(local.map_or("", |b| b.url.as_str()))
    ));
    lines.push(format!(
        "export AGENTBOX_SYSTEM_ONE_LOCAL_MODEL={}",
        shq(local.map_or("", |b| b.model.as_str()))
    ));
    lines.push(format!(
        "export AGENTBOX_JEV_FAILURE_TAXONOMY={}",
        u8::from(
            tomlval::get(manifest, "system_one.consumers.failure_taxonomy")
                == Some(&Value::Bool(true))
        )
    ));
    lines.push(format!(
        "export AGENTBOX_JEV_MANIFEST_PLAN={}",
        u8::from(
            tomlval::get(manifest, "system_one.consumers.manifest_plan")
                == Some(&Value::Bool(true))
        )
    ));
    lines.push(format!(
        "export AGENTBOX_JEV_VOICE_INTENT={}",
        u8::from(
            tomlval::get(manifest, "system_one.consumers.voice_intent") == Some(&Value::Bool(true))
        )
    ));
    lines.push(format!(
        "export AGENTBOX_JEV_APPROVAL_REVIEW={}",
        u8::from(
            tomlval::get(manifest, "system_one.consumers.approval_review")
                == Some(&Value::Bool(true))
        )
    ));
    lines.push(format!(
        "export AGENTBOX_JEV_CONSULT_ADVICE={}",
        u8::from(
            tomlval::get(manifest, "system_one.consumers.consult_advice")
                == Some(&Value::Bool(true))
        )
    ));
    lines.push(format!(
        "export AGENTBOX_JEV_MEMORY_RERANK={}",
        u8::from(
            tomlval::get(manifest, "system_one.consumers.memory_rerank")
                == Some(&Value::Bool(true))
        )
    ));
    lines.push(format!(
        "export AGENTBOX_JEV_TRAJECTORY_CLASSIFY={}",
        u8::from(
            tomlval::get(manifest, "system_one.consumers.trajectory_classify")
                == Some(&Value::Bool(true))
        )
    ));
    lines.push(format!(
        "export AGENTBOX_JEV_SKILL_INTENT={}",
        u8::from(
            tomlval::get(manifest, "system_one.consumers.skill_intent") == Some(&Value::Bool(true))
        )
    ));
    lines.push(format!(
        "export AGENTBOX_JEV_SKILL_VERIFY={}",
        u8::from(
            tomlval::get(manifest, "system_one.consumers.skill_verify") == Some(&Value::Bool(true))
        )
    ));
    lines.push(format!(
        "export AGENTBOX_JEV_ONTOLOGY_RELEVANCE={}",
        u8::from(
            tomlval::get(manifest, "system_one.consumers.ontology_relevance")
                == Some(&Value::Bool(true))
        )
    ));
    lines.push(format!(
        "export AGENTBOX_JEV_ONTOLOGY_RERANK={}",
        u8::from(
            tomlval::get(manifest, "system_one.consumers.ontology_rerank")
                == Some(&Value::Bool(true))
        )
    ));
    lines.push(format!(
        "export AGENTBOX_JEV_ONTOLOGY_PROPOSALS={}",
        u8::from(
            tomlval::get(manifest, "system_one.consumers.ontology_proposals")
                == Some(&Value::Bool(true))
        )
    ));
    lines.push(format!(
        "export AGENTBOX_JEV_HEADROOM_EVIDENCE={}",
        u8::from(
            tomlval::get(manifest, "system_one.consumers.headroom_evidence")
                == Some(&Value::Bool(true))
        )
    ));
    lines.push(format!(
        "export AGENTBOX_JEV_GOVERNANCE_RUBRIC={}",
        u8::from(
            tomlval::get(manifest, "system_one.consumers.governance_rubric")
                == Some(&Value::Bool(true))
        )
    ));

    for key in [
        "CONSULT",
        "TRAJECTORY",
        "ONTOLOGY",
        "ONTOLOGY_PROPOSALS",
        "GOVERNANCE_RUBRIC",
        "DREAM_TRIAGE",
    ] {
        lines.push(format!("export AGENTBOX_JEV_{key}_LOCAL_ONLY=1"));
    }
    for (key, prefix) in [
        ("visionflow_advisories", "VISIONFLOW_JEV"),
        ("website_advisories", "DREAMLAB_JEV"),
        ("solid_pod_advisories", "SOLID_POD_JEV"),
        ("vault_rank", "VISIONCLAW_JEV_PATCH_RANK"),
        ("ontomark_suggestions", "ONTOMARK_JEV"),
    ] {
        let on = tomlval::get(manifest, &format!("system_one.consumers.{key}"))
            == Some(&Value::Bool(true));
        lines.push(format!(
            "export {prefix}={}",
            u8::from(on && local.is_some())
        ));
        lines.push(format!(
            "export {prefix}_ENDPOINT={}",
            shq(local.map_or("", |b| b.url.as_str()))
        ));
        lines.push(format!(
            "export {prefix}_MODEL={}",
            shq(local.map_or("", |b| b.model.as_str()))
        ));
        lines.push(format!(
            "export {prefix}_LOCAL={}",
            u8::from(local.is_some())
        ));
    }
    lines.push(format!(
        "export VISIONCLAW_JEV_ENDPOINT={}",
        shq(local.map_or("", |b| b.url.as_str()))
    ));
    lines.push(format!(
        "export VISIONCLAW_JEV_MODEL={}",
        shq(local.map_or("", |b| b.model.as_str()))
    ));
    lines.push(format!(
        "export VISIONCLAW_JEV_LOCAL={}",
        u8::from(local.is_some())
    ));
    lines
}

/// Render the consumer-facing projection. Disabled or unusable ⇒ empty string.
pub fn render(
    manifest: &Value,
    format: Format,
    existing: Option<&Existing>,
    switch: Option<&str>,
    warn: &mut dyn FnMut(String),
) -> Result<String, SwitchRefused> {
    let Some(p) = resolve(manifest, warn) else {
        return Ok(String::new());
    };
    let active = select_active(&p, existing, switch)?;
    let b = p
        .backend(&active)
        .expect("select_active returns a declared backend");
    let endpoint = p.endpoint();
    Ok(match format {
        Format::Shell => {
            let mut lines = vec![
                "export AGENTBOX_SYSTEM_ONE_PROXY=1".to_string(),
                format!("export AGENTBOX_SYSTEM_ONE_BACKEND={}", shq(&active)),
                format!(
                    "export AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL={}",
                    u8::from(b.local)
                ),
                format!("export AGENTBOX_SYSTEM_ONE_ENDPOINT={}", shq(&endpoint)),
                format!("export AGENTBOX_SYSTEM_ONE_MODEL={}", shq(&b.model)),
                format!("export AGENTBOX_SKILL_ROUTE_API={}", shq(&endpoint)),
                format!("export AGENTBOX_SKILL_ROUTE_MODEL={}", shq(&b.model)),
                format!(
                    "export AGENTBOX_SKILL_ROUTE_USD_PER_MTOK_IN={}",
                    b.usd_per_mtok_in
                ),
            ];
            lines.extend(consumer_exports(manifest, &p, warn));
            lines.join("\n")
        }
        Format::PluginConfig => [
            format!("baseUrl={endpoint}"),
            format!("model={}", b.model),
            format!("backendLocal={}", b.local),
        ]
        .join("\n"),
        Format::Json => serde_json::to_string_pretty(&render_json(&p, &active, existing))
            .unwrap_or_else(|_| "{}".to_string()),
    })
}

/// Boot entrypoint: print the projection; exit 0 unless a switch is refused.
pub fn run(
    manifest_path: &Path,
    format: Format,
    existing: Option<&Path>,
    switch: Option<&str>,
) -> std::process::ExitCode {
    let manifest = tomlval::parse_file_lenient(manifest_path);
    let mut warn = |m: String| eprintln!("{m}");
    let existing = existing.and_then(|path| {
        let e = Existing::read(path);
        if e.is_none() {
            warn(format!(
                "[system-one] --existing {} unreadable — treating as a first projection",
                path.display()
            ));
        }
        e
    });
    match render(&manifest, format, existing.as_ref(), switch, &mut warn) {
        Ok(out) => {
            if !out.is_empty() {
                println!("{out}");
            }
            std::process::ExitCode::SUCCESS
        }
        Err(refused) => {
            eprintln!("{refused}");
            std::process::ExitCode::from(1)
        }
    }
}

/// Single-quote a value for `sh`, closing and reopening around embedded quotes.
fn shq(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SLOT: &str = r#"
[system_one]
enabled = true
backend = "subq"
bind = "127.0.0.1:8094"
log = "/tmp/so.jsonl"

[system_one.backends.typesafe]
url = "https://api.typesafe.ai/v1/systemone"
model = "jev-latest"
key_env = "TYPESAFE_API_KEY"
local = false
timeout_ms = 30000
usd_per_mtok_in = 0.042

[system_one.backends.subq]
url = "https://api.subq.ai/v1/systemone"
model = "subq-snap-preview"
key_env = "SUBQ_API_KEY"
local = false

[system_one.backends.laya]
url = "http://systemone:8097/v1/systemone"
model = "laya-typed-decisions"
key_env = ""
local = true
timeout_ms = 20000
"#;

    fn manifest(body: &str) -> Value {
        tomlval::parse(body).expect("valid toml")
    }

    fn quiet(
        m: &Value,
        f: Format,
        existing: Option<&Existing>,
        switch: Option<&str>,
    ) -> (Result<String, SwitchRefused>, Vec<String>) {
        let mut warns = Vec::new();
        let out = render(m, f, existing, switch, &mut |w| warns.push(w));
        (out, warns)
    }

    #[test]
    fn disabled_prints_nothing() {
        let m = manifest(&SLOT.replace("enabled = true", "enabled = false"));
        for f in [Format::Shell, Format::PluginConfig, Format::Json] {
            let (out, warns) = quiet(&m, f, None, None);
            assert_eq!(out.unwrap(), "");
            assert!(warns.is_empty());
        }
    }

    #[test]
    fn unknown_backend_refuses() {
        let m = manifest(&SLOT.replace("backend = \"subq\"", "backend = \"nope\""));
        let (out, warns) = quiet(&m, Format::Shell, None, None);
        assert_eq!(out.unwrap(), "");
        assert!(warns[0].contains("not one of"));
    }

    #[test]
    fn non_loopback_bind_refuses() {
        let m = manifest(&SLOT.replace("127.0.0.1:8094", "0.0.0.0:8094"));
        let (out, warns) = quiet(&m, Format::Shell, None, None);
        assert_eq!(out.unwrap(), "");
        assert!(warns[0].contains("not loopback"));
    }

    #[test]
    fn local_backend_with_a_key_refuses() {
        let m = manifest(&SLOT.replace("key_env = \"\"", "key_env = \"LAYA_KEY\""));
        let (out, warns) = quiet(&m, Format::Shell, None, None);
        assert_eq!(out.unwrap(), "");
        assert!(warns[0].contains("keyless"));
    }

    #[test]
    fn cloud_backend_without_https_refuses() {
        let m = manifest(&SLOT.replace("https://api.subq.ai", "http://api.subq.ai"));
        let (out, warns) = quiet(&m, Format::Shell, None, None);
        assert_eq!(out.unwrap(), "");
        assert!(warns[0].contains("not https"));
    }

    #[test]
    fn shell_carries_consumer_names_and_the_proxy_flag() {
        let (out, warns) = quiet(&manifest(SLOT), Format::Shell, None, None);
        let out = out.unwrap();
        assert!(warns.is_empty(), "{warns:?}");
        assert!(out.contains("export AGENTBOX_SYSTEM_ONE_PROXY=1"));
        assert!(out.contains("export AGENTBOX_SKILL_ROUTE_USD_PER_MTOK_IN=0"));
        assert!(out.contains("export AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL=0"));
        assert!(
            out.contains("export AGENTBOX_SKILL_ROUTE_API='http://127.0.0.1:8094/v1/systemone'")
        );
        assert!(out.contains("export AGENTBOX_SKILL_ROUTE_MODEL='subq-snap-preview'"));
    }

    #[test]
    fn private_route_and_opt_ins_are_explicit_and_cloud_cannot_be_local() {
        let mut m = manifest(SLOT);
        m["system_one"]["local_backend"] = json!("local");
        m["system_one"]["backends"]["local"] = json!({"url":"http://systemone:8097/v1/systemone", "model":"laya", "local":true, "key_env":""});
        m["system_one"]["consumers"] = json!({"memory_rerank":true, "visionflow_advisories":true});
        let (out, warns) = quiet(&m, Format::Shell, None, None);
        let out = out.unwrap();
        assert!(warns.is_empty(), "{warns:?}");
        assert!(out.contains("export AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL=0"));
        assert!(out.contains(
            "export AGENTBOX_SYSTEM_ONE_LOCAL_ENDPOINT='http://systemone:8097/v1/systemone'"
        ));
        assert!(out.contains("export AGENTBOX_JEV_MEMORY_RERANK=1"));
        assert!(out.contains("export AGENTBOX_JEV_VOICE_INTENT=0"));
        assert!(out.contains("export VISIONFLOW_JEV=1"));
        m["system_one"]["local_backend"] = json!("subq");
        let (out, warns) = quiet(&m, Format::Shell, None, None);
        let out = out.unwrap();
        assert!(warns.iter().any(|w| w.contains("local_backend")));
        assert!(out.contains("export AGENTBOX_SYSTEM_ONE_LOCAL_ENDPOINT=''"));
        assert!(out.contains("export VISIONFLOW_JEV=0"));
    }

    #[test]
    fn plugin_config_lines_are_exact() {
        let (out, _) = quiet(&manifest(SLOT), Format::PluginConfig, None, None);
        assert_eq!(
            out.unwrap().lines().collect::<Vec<_>>(),
            vec![
                "baseUrl=http://127.0.0.1:8094/v1/systemone",
                "model=subq-snap-preview",
                "backendLocal=false",
            ]
        );
    }

    #[test]
    fn json_projects_locality_from_the_selected_backend() {
        let (out, _) = quiet(&manifest(SLOT), Format::Json, None, None);
        let v: Value = serde_json::from_str(&out.unwrap()).unwrap();
        assert_eq!(v["active"], "subq");
        assert_eq!(v["projected_local"], false);
        assert_eq!(v["backends"]["laya"]["local"], true);
        assert_eq!(v["backends"]["subq"]["timeout_ms"], 30000);
        assert!(v["projected_at"].as_str().unwrap().ends_with('Z'));
        let m = manifest(&SLOT.replace("backend = \"subq\"", "backend = \"laya\""));
        let (out, _) = quiet(&m, Format::Json, None, None);
        let v: Value = serde_json::from_str(&out.unwrap()).unwrap();
        assert_eq!(v["projected_local"], true);
    }

    #[test]
    fn existing_is_preserved_and_local_to_cloud_is_refused() {
        let boot = Existing {
            projected_local: Some(true),
            projected_at: Some("2026-10-12T00:00:00Z".into()),
        };
        let m = manifest(&SLOT.replace("backend = \"subq\"", "backend = \"laya\""));
        let (out, _) = quiet(&m, Format::Json, Some(&boot), Some("typesafe"));
        assert!(out.unwrap_err().0.contains("restart the container"));
        // cloud → local is allowed and keeps the boot record
        let cloud = Existing {
            projected_local: Some(false),
            projected_at: Some("2026-10-12T00:00:00Z".into()),
        };
        let (out, _) = quiet(&manifest(SLOT), Format::Json, Some(&cloud), Some("laya"));
        let v: Value = serde_json::from_str(&out.unwrap()).unwrap();
        assert_eq!(v["active"], "laya");
        assert_eq!(v["projected_local"], false);
        assert_eq!(v["projected_at"], "2026-10-12T00:00:00Z");
        // same class switch
        let (out, _) = quiet(
            &manifest(SLOT),
            Format::Json,
            Some(&cloud),
            Some("typesafe"),
        );
        assert_eq!(
            serde_json::from_str::<Value>(&out.unwrap()).unwrap()["active"],
            "typesafe"
        );
    }

    #[test]
    fn a_quote_in_a_value_cannot_break_out_of_the_export() {
        let m = manifest(&SLOT.replace("subq-snap-preview", "a'; rm -rf /"));
        let (out, _) = quiet(&m, Format::Shell, None, None);
        assert!(out
            .unwrap()
            .contains(r"export AGENTBOX_SYSTEM_ONE_MODEL='a'\''; rm -rf /'"));
    }

    #[test]
    fn rfc3339_is_well_formed() {
        let t = now_rfc3339();
        assert_eq!(t.len(), 20, "{t}");
        assert!(t.starts_with("20"));
    }
}
