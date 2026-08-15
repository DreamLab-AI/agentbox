use std::path::{Path, PathBuf};
use std::process::Command;
use thiserror::Error;
use tracing::{info, warn};

use crate::compile;
use crate::config::{self, DreamConfig, RuntimeConfig};
use crate::dispatch;
use crate::ledger::{self, LedgerRow};
use crate::llm::{self, LlmConfig, Provider};
use crate::ruvector::{self, DreamFinding, RuVectorConfig};
use crate::verdict::{self, Verdict};
use crate::witness;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("no nominated repos found under {0}")]
    NoRepos(PathBuf),
    #[error("target {0} is not a nominated repo")]
    UnknownTarget(String),
    #[error("config: {0}")]
    Config(#[from] config::ConfigError),
    #[error("dispatch: {0}")]
    Dispatch(#[from] dispatch::DispatchError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("ledger: {0}")]
    Ledger(#[from] ledger::LedgerError),
}

#[derive(Debug)]
pub struct CycleResult {
    pub repo: String,
    pub verdict: Verdict,
    pub finding: String,
    pub witness_short: String,
    pub report_path: PathBuf,
    pub ledger_path: PathBuf,
    pub stored_to_ruvector: bool,
}

pub struct Engine {
    pub runtime: RuntimeConfig,
    pub workspace: PathBuf,
    pub artefact_dir: PathBuf,
    pub llm: LlmConfig,
    pub ruvector: RuVectorConfig,
}

impl Engine {
    /// Run one full nightly cycle: discover → compile → dispatch → evaluate →
    /// LLM → verdict → persist (report, ledger, witness, RuVector).
    pub async fn run_cycle(
        &self,
        target: Option<&str>,
        day_int: u32,
        date: &str,
        dry_run: bool,
    ) -> Result<CycleResult, EngineError> {
        info!("cycle start");

        // 1. Discover nominated repos (marker file: dream.config.json).
        let repos = config::discover_repos(&self.workspace);
        if repos.is_empty() {
            return Err(EngineError::NoRepos(self.workspace.clone()));
        }
        info!(
            count = repos.len(),
            repos = %repos.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>().join(", "),
            "discovered nominated repos"
        );

        // 2. Select tonight's repo: forced target or day rotation.
        let (repo_name, repo_path) = match target {
            Some(t) => repos
                .iter()
                .find(|(n, _)| n == t)
                .cloned()
                .ok_or_else(|| EngineError::UnknownTarget(t.into()))?,
            None => repos[(day_int as usize) % repos.len()].clone(),
        };
        info!(repo = %repo_name, "target selected");

        // 3. Load config, pick slot, compile the prompt.
        let cfg = DreamConfig::load(&repo_path.join("dream.config.json"))?;
        let slot = config::tonight_slot(&cfg, day_int).clone();
        let bonuses = config::bonus_dives(&cfg, day_int);
        let mut prompt = compile::compile(&cfg, &slot, day_int, &bonuses);
        info!(chars = prompt.len(), deep = %slot.deep, "prompt compiled");

        if dry_run {
            info!("[dry-run] would dispatch — stopping");
            return Ok(CycleResult {
                repo: repo_name,
                verdict: Verdict::Inconclusive,
                finding: "(dry run)".into(),
                witness_short: String::new(),
                report_path: PathBuf::new(),
                ledger_path: PathBuf::new(),
                stored_to_ruvector: false,
            });
        }

        // 4. Dispatch to the HP annexe: clone, build, run evaluators.
        let night_id = format!("{}-{}", date, repo_name);
        let remote_dir = format!("{}/{}", self.runtime.hp_annexe_dir, night_id);
        info!(remote = %remote_dir, "dispatching to HP");
        dispatch::clone_to_hp(&repo_path, &self.runtime.hp_host, &remote_dir, &repo_name)?;

        let evaluators: Vec<(&str, &str)> = cfg
            .evaluator_entrypoints
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        let (build_out, eval_outs) = dispatch::run_on_hp(
            &self.runtime.hp_host,
            &remote_dir,
            &repo_name,
            cfg.build_step.as_ref().map(|b| b.cmd.as_str()),
            &evaluators,
        )?;
        info!("build + evaluators complete");

        // 5. Append evidence receipts to the prompt so the LLM reasons over
        //    real evaluator output, not imagination.
        prompt.push_str("\n\n---\n\n# TONIGHT'S EVIDENCE (receipts from the HP annexe)\n\n");
        prompt.push_str(&format!(
            "## Build output (tail)\n```\n{}\n```\n\n",
            tail(&build_out, 3000)
        ));
        for (name, out) in &eval_outs {
            prompt.push_str(&format!(
                "## Evaluator `{}` output (tail)\n```\n{}\n```\n\n",
                name,
                tail(out, 6000)
            ));
        }

        // 6. LLM call.
        info!(provider = ?self.llm.provider, model = %self.llm.model, "calling LLM");
        let report = match llm::call(&self.llm, &prompt).await {
            Ok(r) => r,
            Err(e) => {
                warn!(error = %e, "LLM call failed — recording degraded night");
                format!(
                    "# Degraded night\n\nLLM call failed: {}\n\nVERDICT: INCONCLUSIVE",
                    e
                )
            }
        };

        // 7. Verdict + finding.
        let v = verdict::parse_verdict(&report);
        let finding = verdict::sanitise_finding(&report, v);
        info!(verdict = v.as_str(), finding = %finding, "verdict parsed");

        // 8. Witness: bind report to the repo's current commit.
        let commit = git_head(&repo_path).unwrap_or_default();
        let (wit_full, wit_short) = match witness::witness(&report, &commit) {
            Ok(w) => {
                let s = witness::short(&w).to_string();
                (w, s)
            }
            Err(e) => {
                warn!(error = %e, "witness blocked (bad/missing commit)");
                (String::new(), "BLOCKED".into())
            }
        };

        // 9. Persist the report locally.
        let night_dir = self.artefact_dir.join(&night_id);
        std::fs::create_dir_all(&night_dir)?;
        let report_path = night_dir.join("report.md");
        std::fs::write(&report_path, &report)?;

        // 10. Ledger row.
        let ledger_path = repo_path.join(&cfg.ledger_path);
        let row = LedgerRow {
            date: date.into(),
            deep: slot.deep.clone(),
            finding: finding.clone(),
            issue: "NONE".into(),
            pr: "NONE".into(),
            evaluated: "yes".into(),
            verdict: v.as_str().into(),
            effect: String::new(),
            witness: wit_short.clone(),
            prior_fates: String::new(),
        };
        ledger::append_row(&ledger_path, &row)?;
        info!(path = %ledger_path.display(), "ledger row appended");

        // 11. RuVector store — fail-open: a memory failure never fails the night.
        let df = DreamFinding {
            night_id: night_id.clone(),
            repo: repo_name.clone(),
            date: date.into(),
            deep: slot.deep.clone(),
            finding: finding.clone(),
            verdict: v.as_str().into(),
            witness: if wit_full.is_empty() { wit_short.clone() } else { wit_full },
            source: format!("hp-annexe-{}", self.llm.model),
        };
        let stored = match ruvector::store_finding(&self.ruvector, &df).await {
            Ok(s) => s,
            Err(e) => {
                warn!(error = %e, "RuVector store failed (fail-open)");
                false
            }
        };

        info!(
            repo = %repo_name,
            verdict = v.as_str(),
            witness = %wit_short,
            stored,
            "cycle complete"
        );

        Ok(CycleResult {
            repo: repo_name,
            verdict: v,
            finding,
            witness_short: wit_short,
            report_path,
            ledger_path,
            stored_to_ruvector: stored,
        })
    }
}

/// Build the LLM config from runtime settings + environment.
pub fn llm_config(rt: &RuntimeConfig) -> LlmConfig {
    let provider = Provider::from_str(
        &std::env::var("DREAM_LLM_PROVIDER").unwrap_or_else(|_| rt.llm_provider.clone()),
    );
    match provider {
        Provider::Zai => LlmConfig {
            provider,
            url: std::env::var("ZAI_URL").unwrap_or_else(|_| rt.zai_url.clone()),
            model: std::env::var("ZAI_MODEL").unwrap_or_else(|_| rt.zai_model.clone()),
            max_tokens: rt.zai_max_tokens,
            api_key: std::env::var("ZAI_ANTHROPIC_API_KEY")
                .ok()
                .or_else(|| std::env::var("ZAI_API_KEY").ok()),
        },
        Provider::Loom => LlmConfig {
            provider,
            url: std::env::var("LOOM_URL").unwrap_or_else(|_| rt.loom_url.clone()),
            model: std::env::var("LOOM_MODEL").unwrap_or_else(|_| rt.loom_model.clone()),
            max_tokens: rt.loom_max_tokens,
            api_key: None,
        },
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
            .unwrap_or_else(|_| "http://192.168.2.132:9997".into()),
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

fn git_head(repo: &Path) -> Option<String> {
    let out = Command::new("git")
        .args(["-C", repo.to_str()?, "rev-parse", "HEAD"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Last `max` bytes of a string, on a char boundary.
fn tail(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut start = s.len() - max;
    while !s.is_char_boundary(start) {
        start += 1;
    }
    &s[start..]
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn tail_respects_char_boundaries() {
        let s = "héllo wörld";
        let t = tail(s, 4);
        assert!(t.len() <= 5);
        assert!(s.ends_with(t));
    }
}
