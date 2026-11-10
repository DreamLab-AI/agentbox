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
use crate::ruvector::{PgTarget, RuVectorConfig};

/// The global `/dream off` kill-switch file. `DREAM_PAUSE_FLAG` overrides it
/// (hermetic runs).
pub fn pause_flag_path() -> PathBuf {
    std::env::var("DREAM_PAUSE_FLAG")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/home/devuser/workspace/.agentbox/dream-paused"))
}

/// Default location of the durable roster (control-plane state, next to the
/// dream inbox and the pause flag).
pub fn default_roster_path() -> PathBuf {
    PathBuf::from("/home/devuser/workspace/.agentbox/dream-roster.json")
}

/// Default night artefact directory: one `<date>-<repo>/` folder per night
/// (report, receipts, gate decision, review record). Durable control-plane
/// state, never pruned: a ledger row's witness can only be checked, and a human
/// review only recorded, while its folder exists.
pub fn default_artefact_dir() -> PathBuf {
    PathBuf::from("/home/devuser/workspace/.agentbox/dream-artefacts")
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

/// Withhold credential-bearing content and redact annexe-side filesystem paths.
pub fn redact(s: &str) -> String {
    if dream_core::source::has_secret_content(s) {
        return "[withheld: credential material]".into();
    }
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

/// The first non-empty value of `key` in `env`, else `default`.
fn env_or(env: &dyn Fn(&str) -> Option<String>, key: &str, default: &str) -> String {
    env(key)
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| default.to_string())
}

/// The RuVector sidecar address from `RUVECTOR_PG_HOST/PORT/DATABASE/USER` and
/// the path in `RUVECTOR_PG_PASSWORD_FILE`. No password and no conninfo or URL
/// string is read from the environment; the same file the Node clients read
/// (`management-api/lib/pg-config.js`) is the only credential source.
pub fn pg_target_from(env: &dyn Fn(&str) -> Option<String>) -> PgTarget {
    PgTarget {
        host: env_or(env, "RUVECTOR_PG_HOST", "ruvector-postgres"),
        port: env_or(env, "RUVECTOR_PG_PORT", "5432")
            .parse()
            .unwrap_or(5432),
        database: env_or(env, "RUVECTOR_PG_DATABASE", "ruvector"),
        user: env_or(env, "RUVECTOR_PG_USER", "ruvector"),
        password_file: env_or(
            env,
            "RUVECTOR_PG_PASSWORD_FILE",
            "/run/secrets/ruvector-pg/password",
        ),
    }
}

/// Build the RuVector config from the environment (public parts + password file).
pub fn ruvector_config(rt: &RuntimeConfig) -> RuVectorConfig {
    RuVectorConfig {
        pg: pg_target_from(&|k| std::env::var(k).ok()),
        xinference_url: xinference_url_from_env(),
        namespace: rt.memory_namespace.clone(),
    }
}

/// The embeddings endpoint: `XINFERENCE_URL` if set, else the estate-wide
/// `XINFERENCE_ENDPOINT` (what the image exports to every service), else the
/// `xinference` container on the shared network. The old `embeddings` default
/// named no host, so every night's RuVector store failed open.
fn xinference_url_from_env() -> String {
    ["XINFERENCE_URL", "XINFERENCE_ENDPOINT"]
        .iter()
        .filter_map(|k| std::env::var(k).ok())
        .map(|v| v.trim().to_string())
        .find(|v| !v.is_empty())
        .unwrap_or_else(|| "http://xinference:9997".into())
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
    fn pg_target_reads_the_parts_and_the_password_file_path() {
        let env = |k: &str| match k {
            "RUVECTOR_PG_HOST" => Some("db".to_string()),
            "RUVECTOR_PG_PORT" => Some("5433".to_string()),
            "RUVECTOR_PG_DATABASE" => Some("mydb".to_string()),
            "RUVECTOR_PG_USER" => Some("me".to_string()),
            "RUVECTOR_PG_PASSWORD_FILE" => Some("/x/pw".to_string()),
            // Retired inputs are never consulted.
            "RUVECTOR_PG_CONNINFO" | "RUVECTOR_PG_URL" | "RUVECTOR_PG_PASSWORD" => {
                Some("host=evil password=nope".to_string())
            }
            _ => None,
        };
        let t = pg_target_from(&env);
        assert_eq!(
            (
                t.host.as_str(),
                t.port,
                t.database.as_str(),
                t.user.as_str(),
                t.password_file.as_str()
            ),
            ("db", 5433, "mydb", "me", "/x/pw")
        );
    }

    #[test]
    fn pg_target_defaults_name_the_service_and_the_one_file_never_a_password() {
        let t = pg_target_from(&|_| None);
        assert_eq!(t.host, "ruvector-postgres");
        assert_eq!(t.port, 5432);
        assert_eq!(t.password_file, "/run/secrets/ruvector-pg/password");
    }

    #[test]
    fn a_missing_password_file_fails_closed_naming_the_path() {
        let t = PgTarget {
            password_file: "/nonexistent/ruvector-pg/password".into(),
            ..pg_target_from(&|_| None)
        };
        let err = t.connect_options().unwrap_err().to_string();
        assert!(err.contains("/nonexistent/ruvector-pg/password"), "{err}");
    }

    #[test]
    fn xinference_url_prefers_the_override_then_the_estate_endpoint() {
        let both = [
            ("XINFERENCE_URL", Some("http://override:1")),
            ("XINFERENCE_ENDPOINT", Some("http://estate:2")),
        ];
        with_env(&both, || {
            assert_eq!(xinference_url_from_env(), "http://override:1")
        });
        let estate = [
            ("XINFERENCE_URL", Some("  ")),
            ("XINFERENCE_ENDPOINT", Some("http://estate:2")),
        ];
        with_env(&estate, || {
            assert_eq!(xinference_url_from_env(), "http://estate:2")
        });
        let none = [("XINFERENCE_URL", None), ("XINFERENCE_ENDPOINT", None)];
        with_env(&none, || {
            assert_eq!(xinference_url_from_env(), "http://xinference:9997")
        });
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

    #[test]
    fn provider_credentials_are_withheld_before_prompt_supply() {
        let token = format!("ghp_{}", "a1B2".repeat(9));
        let redacted = redact(&format!("curl -H 'Authorization: Bearer {token}'"));
        assert!(!redacted.contains(&token));
        assert_eq!(redacted, "[withheld: credential material]");
    }
}
