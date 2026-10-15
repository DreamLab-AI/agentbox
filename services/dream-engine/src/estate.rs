//! Estate defaults and environment reads.
//!
//! `dream-core` and `dream-gate` read no environment variables and carry no
//! addresses, paths or key-file names; every one the engine needs is supplied
//! from here as an explicit parameter: the LLM and RuVector endpoints, the
//! `DREAM_SOURCE_*` tree-read knobs, the `DREAM_SELF_GC*` context-governor
//! switches, the source denylist entry for the session-mirror key file, the
//! default roster path, and the redaction of annexe-side paths.

use std::path::PathBuf;

use dream_core::context::DEFAULT_BUDGET;
use dream_core::source::{Denylist, SourceConfig};

use crate::config::{self, RuntimeConfig};
use crate::llm::{LlmConfig, Provider};
use crate::ruvector::RuVectorConfig;

/// Default location of the durable roster (control-plane state, next to the
/// dream inbox and the pause flag).
pub fn default_roster_path() -> PathBuf {
    PathBuf::from("/home/devuser/workspace/.agentbox/dream-roster.json")
}

/// Paths the source reader must never send to a provider, on top of
/// `dream-core`'s built-in secret-file list: the session-mirror key file
/// (`~/.claude/nostr-mirror/mirror-key.txt`).
pub fn source_denylist() -> Denylist {
    Denylist::new(["mirror-key.txt"])
}

/// Tree-read knobs from the environment, falling back to `dream-core`'s
/// defaults: `DREAM_SOURCE_READ=0` disables the stage;
/// `DREAM_SOURCE_MAX_FILES`, `DREAM_SOURCE_BUDGET` (total bytes),
/// `DREAM_SOURCE_FILE_CAP` (bytes per file) and `DREAM_SOURCE_INDEX_CAP`
/// (chars of path index) override the sizes. A non-numeric or zero override is
/// ignored.
pub fn source_config_from_env() -> SourceConfig {
    fn num(key: &str, default: usize) -> usize {
        std::env::var(key)
            .ok()
            .and_then(|v| v.trim().parse().ok())
            .filter(|n: &usize| *n > 0)
            .unwrap_or(default)
    }
    let d = SourceConfig::default();
    SourceConfig {
        enabled: std::env::var("DREAM_SOURCE_READ").as_deref() != Ok("0"),
        max_files: num("DREAM_SOURCE_MAX_FILES", d.max_files),
        budget_bytes: num("DREAM_SOURCE_BUDGET", d.budget_bytes),
        file_cap_bytes: num("DREAM_SOURCE_FILE_CAP", d.file_cap_bytes),
        index_cap_chars: num("DREAM_SOURCE_INDEX_CAP", d.index_cap_chars),
    }
}

/// Whether the Self-GC context governor runs (`DREAM_SELF_GC=0` disables it).
pub fn self_gc_enabled() -> bool {
    std::env::var("DREAM_SELF_GC").as_deref() != Ok("0")
}

/// The governor's whole-pack budget in chars (`DREAM_SELF_GC_BUDGET`, else
/// `dream-core`'s default).
pub fn self_gc_budget() -> usize {
    std::env::var("DREAM_SELF_GC_BUDGET")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_BUDGET)
}

/// Redact annexe-side filesystem paths before receipts leave the LAN.
pub fn redact(s: &str) -> String {
    s.replace("/home/john", "~")
}

/// Build the LLM config from runtime settings + environment.
pub fn llm_config(rt: &RuntimeConfig) -> LlmConfig {
    let provider = Provider::parse(
        &std::env::var("DREAM_LLM_PROVIDER").unwrap_or_else(|_| rt.llm_provider.clone()),
    );
    match provider {
        Provider::Zai => LlmConfig {
            provider,
            url: std::env::var("ZAI_URL").unwrap_or_else(|_| rt.zai_url.clone()),
            model: std::env::var("ZAI_MODEL").unwrap_or_else(|_| rt.zai_model.clone()),
            max_tokens: env_u32("ZAI_MAX_TOKENS", rt.zai_max_tokens),
            api_key: std::env::var("ZAI_ANTHROPIC_API_KEY")
                .ok()
                .or_else(|| std::env::var("ZAI_API_KEY").ok()),
        },
        Provider::Loom => LlmConfig {
            provider,
            url: std::env::var("LOOM_URL")
                .ok()
                // An image built before the placeholder fix bakes the
                // literal `${LOOM_BASE_URL}` into this variable.
                .and_then(|v| config::resolve_env_placeholder(&v))
                .unwrap_or_else(|| rt.loom_url.clone()),
            model: std::env::var("LOOM_MODEL").unwrap_or_else(|_| rt.loom_model.clone()),
            max_tokens: env_u32("LOOM_MAX_TOKENS", rt.loom_max_tokens),
            api_key: None,
        },
    }
}

/// Parse a u32 env override, falling back to the toml value on absence or
/// garbage (a mis-set override must not silently zero the token budget).
fn env_u32(name: &str, default: u32) -> u32 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(default)
}

/// Build the fallback LLM config: the *other* provider, when usable.
/// zai primary → Loom (always usable, LAN, no key). loom primary → Z.AI only
/// when a key is present. `DREAM_LLM_FALLBACK=off` disables.
pub fn fallback_llm_config(rt: &RuntimeConfig, primary: &LlmConfig) -> Option<LlmConfig> {
    if std::env::var("DREAM_LLM_FALLBACK").is_ok_and(|v| v == "off") {
        return None;
    }
    match primary.provider {
        Provider::Zai => Some(LlmConfig {
            provider: Provider::Loom,
            url: std::env::var("LOOM_URL")
                .ok()
                // An image built before the placeholder fix bakes the
                // literal `${LOOM_BASE_URL}` into this variable.
                .and_then(|v| config::resolve_env_placeholder(&v))
                .unwrap_or_else(|| rt.loom_url.clone()),
            model: std::env::var("LOOM_MODEL").unwrap_or_else(|_| rt.loom_model.clone()),
            max_tokens: env_u32("LOOM_MAX_TOKENS", rt.loom_max_tokens),
            api_key: None,
        }),
        Provider::Loom => {
            let key = std::env::var("ZAI_ANTHROPIC_API_KEY")
                .ok()
                .or_else(|| std::env::var("ZAI_API_KEY").ok())
                .filter(|k| !k.is_empty())?;
            Some(LlmConfig {
                provider: Provider::Zai,
                url: std::env::var("ZAI_URL").unwrap_or_else(|_| rt.zai_url.clone()),
                model: std::env::var("ZAI_MODEL").unwrap_or_else(|_| rt.zai_model.clone()),
                max_tokens: env_u32("ZAI_MAX_TOKENS", rt.zai_max_tokens),
                api_key: Some(key),
            })
        }
    }
}

/// Build the RuVector config from environment (conninfo or URL form).
pub fn ruvector_config(rt: &RuntimeConfig) -> RuVectorConfig {
    let pg_url = std::env::var("RUVECTOR_PG_URL").unwrap_or_else(|_| {
        match std::env::var("RUVECTOR_PG_CONNINFO") {
            Ok(ci) => conninfo_to_url(&ci),
            Err(_) => "postgres://ruvector:ruvector@ruvector-postgres:5432/ruvector".into(),
        }
    });
    RuVectorConfig {
        pg_url,
        xinference_url: std::env::var("XINFERENCE_URL")
            .unwrap_or_else(|_| "http://embeddings:9997".into()),
        namespace: rt.memory_namespace.clone(),
    }
}

/// Convert libpq-style "host=h port=p dbname=d user=u password=w" into a URL.
fn conninfo_to_url(conninfo: &str) -> String {
    let mut host = "ruvector-postgres";
    let mut port = "5432";
    let mut db = "ruvector";
    let mut user = "ruvector";
    let mut pass = "ruvector";
    for part in conninfo.split_whitespace() {
        if let Some((k, v)) = part.split_once('=') {
            match k {
                "host" => host = v,
                "port" => port = v,
                "dbname" => db = v,
                "user" => user = v,
                "password" => pass = v,
                _ => {}
            }
        }
    }
    format!("postgres://{}:{}@{}:{}/{}", user, pass, host, port, db)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// The env-reading helpers share process-global state.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_env<T>(vars: &[(&str, Option<&str>)], f: impl FnOnce() -> T) -> T {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        for (k, v) in vars {
            match v {
                Some(v) => std::env::set_var(k, v),
                None => std::env::remove_var(k),
            }
        }
        let out = f();
        for (k, _) in vars {
            std::env::remove_var(k);
        }
        out
    }

    #[test]
    fn conninfo_conversion() {
        let url = conninfo_to_url("host=db port=5433 dbname=mydb user=me password=secret");
        assert_eq!(url, "postgres://me:secret@db:5433/mydb");
    }

    #[test]
    fn conninfo_defaults() {
        let url = conninfo_to_url("");
        assert_eq!(
            url,
            "postgres://ruvector:ruvector@ruvector-postgres:5432/ruvector"
        );
    }

    #[test]
    fn env_u32_falls_back_on_absence_and_garbage() {
        assert_eq!(env_u32("DREAM_TEST_UNSET_VAR", 16384), 16384);
        with_env(&[("DREAM_TEST_GARBAGE_VAR", Some("not-a-number"))], || {
            assert_eq!(env_u32("DREAM_TEST_GARBAGE_VAR", 16384), 16384)
        });
        with_env(&[("DREAM_TEST_OK_VAR", Some(" 32768 "))], || {
            assert_eq!(env_u32("DREAM_TEST_OK_VAR", 16384), 32768)
        });
    }

    #[test]
    fn source_knobs_default_to_dream_cores_and_read_the_dream_source_vars() {
        let d = SourceConfig::default();
        let none = [
            ("DREAM_SOURCE_READ", None),
            ("DREAM_SOURCE_MAX_FILES", None),
            ("DREAM_SOURCE_BUDGET", None),
            ("DREAM_SOURCE_FILE_CAP", None),
            ("DREAM_SOURCE_INDEX_CAP", None),
        ];
        assert_eq!(with_env(&none, source_config_from_env), d);
        let got = with_env(
            &[
                ("DREAM_SOURCE_READ", Some("0")),
                ("DREAM_SOURCE_MAX_FILES", Some(" 3 ")),
                ("DREAM_SOURCE_BUDGET", Some("1000")),
                ("DREAM_SOURCE_FILE_CAP", Some("0")),
                ("DREAM_SOURCE_INDEX_CAP", Some("junk")),
            ],
            source_config_from_env,
        );
        assert!(!got.enabled);
        assert_eq!(got.max_files, 3);
        assert_eq!(got.budget_bytes, 1000);
        assert_eq!(got.file_cap_bytes, d.file_cap_bytes, "zero is ignored");
        assert_eq!(got.index_cap_chars, d.index_cap_chars, "junk is ignored");
    }

    #[test]
    fn self_gc_switches_read_the_dream_self_gc_vars() {
        assert!(with_env(
            &[("DREAM_SELF_GC", None), ("DREAM_SELF_GC_BUDGET", None)],
            self_gc_enabled
        ));
        assert_eq!(
            with_env(&[("DREAM_SELF_GC_BUDGET", None)], self_gc_budget),
            DEFAULT_BUDGET
        );
        assert!(!with_env(&[("DREAM_SELF_GC", Some("0"))], self_gc_enabled));
        assert_eq!(
            with_env(&[("DREAM_SELF_GC_BUDGET", Some("12345"))], self_gc_budget),
            12345
        );
    }

    /// The mirror key file never reaches a provider, wherever it sits.
    #[test]
    fn the_session_mirror_key_file_is_denied() {
        let d = source_denylist();
        assert!(d.denies("nostr-mirror/mirror-key.txt"));
        assert!(d.denies("mirror-key.txt"));
        assert!(!d.denies("src/lib.rs"));
    }

    #[test]
    fn estate_defaults_are_the_documented_ones() {
        assert_eq!(
            default_roster_path(),
            PathBuf::from("/home/devuser/workspace/.agentbox/dream-roster.json")
        );
        assert_eq!(redact("/home/john/x"), "~/x");
    }
}
