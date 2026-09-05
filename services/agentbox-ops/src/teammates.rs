//! Idle-teammate detection for `teammate-gc` (ADR-2034 §session hygiene).
//!
//! A Claude Code agent-team teammate is a `claude` process launched with a
//! separate `--agent-id <id>` argument. When its lead finishes, the pane stays
//! resident: an idle teammate holds its full per-session MCP set (≈1 GB and
//! thirteen processes before the hub, four after) indefinitely. On 2026-09-05
//! a sixteen-teammate team had been idle for seven hours.
//!
//! Idleness is measured, not inferred: a teammate is idle when its CPU time
//! (`utime + stime` from `/proc/<pid>/stat`) has not advanced for the idle
//! window. An idle Claude Code process consumes zero ticks (measured over 10 s
//! on a seven-hour-old teammate), so any advance means it is doing something.
//!
//! Identity follows ADR-2032: argv elements, never joined text; the process
//! basename must be a Claude Code launcher; `(pid, starttime)` is recorded and
//! re-verified immediately before any signal.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::process_identity::{basename, parse_argv, parse_starttime, ProcError, ProcSource};

/// Launcher basenames that are Claude Code itself.
const CLAUDE_BASENAMES: [&str; 3] = ["claude", ".claude-wrapped", "claude-code"];

/// Returns the `--agent-id` value when `args` is a Claude Code teammate.
///
/// Accepted shapes: `<claude> … --agent-id ID …` and
/// `<claude> … --agent-id=ID …`, plus `node <path>/cli.js …` where the script
/// path contains `claude-code`. Anything else — a shell whose text mentions the
/// flag, a grep for it, an agent prompt — is refused.
pub fn teammate_agent_id(args: &[&str]) -> Option<String> {
    let program = basename(args.first()?);
    let is_claude = CLAUDE_BASENAMES.contains(&program)
        || ((program == "node" || program == "nodejs")
            && args
                .get(1)
                .map(|s| basename(s) == "cli.js" && s.contains("claude-code"))
                .unwrap_or(false));
    if !is_claude {
        return None;
    }
    let mut iter = args.iter().skip(1);
    while let Some(arg) = iter.next() {
        if *arg == "--agent-id" {
            return iter
                .next()
                .filter(|v| !v.is_empty() && !v.starts_with("--"))
                .map(|v| v.to_string());
        }
        if let Some(v) = arg.strip_prefix("--agent-id=") {
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

/// `utime + stime` (clock ticks) from a `/proc/<pid>/stat` line.
pub fn parse_cpu_ticks(stat: &str) -> Result<u64, ProcError> {
    let close = stat
        .rfind(')')
        .ok_or_else(|| ProcError::Malformed("stat has no ')'".into()))?;
    let fields: Vec<&str> = stat[close + 1..].split_whitespace().collect();
    // After the comm field: index 0 is `state` (field 3), so utime (field 14)
    // is index 11 and stime (field 15) is index 12.
    let utime = fields
        .get(11)
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or_else(|| ProcError::Malformed("stat lacks utime".into()))?;
    let stime = fields
        .get(12)
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or_else(|| ProcError::Malformed("stat lacks stime".into()))?;
    Ok(utime + stime)
}

/// A teammate process seen in one scan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Seen {
    pub pid: u32,
    pub starttime: u64,
    pub agent_id: String,
    pub cpu_ticks: u64,
}

/// Scans `pids` (normally every numeric entry of `/proc`) for teammates.
pub fn scan(source: &dyn ProcSource, pids: impl IntoIterator<Item = u32>) -> Vec<Seen> {
    let mut out = Vec::new();
    for pid in pids {
        let Ok(raw) = source.cmdline(pid) else { continue };
        let argv = parse_argv(&raw);
        let args: Vec<&str> = argv.iter().map(String::as_str).collect();
        let Some(agent_id) = teammate_agent_id(&args) else { continue };
        let Ok(stat) = source.stat(pid) else { continue };
        let (Ok(starttime), Ok(cpu_ticks)) = (parse_starttime(&stat), parse_cpu_ticks(&stat)) else {
            continue;
        };
        out.push(Seen { pid, starttime, agent_id, cpu_ticks });
    }
    out.sort_by_key(|s| s.pid);
    out
}

/// Lists the numeric entries of a procfs root.
pub fn list_pids(proc_root: &Path) -> Vec<u32> {
    let mut pids: Vec<u32> = std::fs::read_dir(proc_root)
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| e.file_name().to_str().and_then(|s| s.parse().ok()))
                .collect()
        })
        .unwrap_or_default();
    pids.sort_unstable();
    pids
}

/// Persistent per-teammate observation, keyed by `pid:starttime`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Observation {
    pub pid: u32,
    pub starttime: u64,
    pub agent_id: String,
    pub first_seen: u64,
    /// Last unix time the CPU counter advanced (or the first sighting).
    pub last_active: u64,
    pub cpu_ticks: u64,
}

/// State file contents.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GcState {
    pub schema: u32,
    pub observations: BTreeMap<String, Observation>,
}

/// One teammate's standing after a scan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Assessment {
    pub pid: u32,
    pub starttime: u64,
    pub agent_id: String,
    pub idle_secs: u64,
    pub observed_secs: u64,
    pub idle: bool,
}

fn key(pid: u32, starttime: u64) -> String {
    format!("{pid}:{starttime}")
}

/// Merges a scan into `state` and reports each teammate's idleness.
///
/// A teammate is idle when its CPU counter has not advanced for at least
/// `idle_window_secs` **and** it has been observed for at least that long — a
/// process first seen this tick is never idle, however old it is, because
/// its counter has no baseline yet. Observations for processes that vanished
/// (or whose PID now belongs to a different starttime) are dropped.
pub fn assess(state: &mut GcState, seen: &[Seen], now: u64, idle_window_secs: u64) -> Vec<Assessment> {
    state.schema = 1;
    let live: std::collections::BTreeSet<String> =
        seen.iter().map(|s| key(s.pid, s.starttime)).collect();
    state.observations.retain(|k, _| live.contains(k));

    let mut out = Vec::new();
    for s in seen {
        let k = key(s.pid, s.starttime);
        let obs = state.observations.entry(k).or_insert_with(|| Observation {
            pid: s.pid,
            starttime: s.starttime,
            agent_id: s.agent_id.clone(),
            first_seen: now,
            last_active: now,
            cpu_ticks: s.cpu_ticks,
        });
        if s.cpu_ticks != obs.cpu_ticks {
            obs.cpu_ticks = s.cpu_ticks;
            obs.last_active = now;
        }
        let idle_secs = now.saturating_sub(obs.last_active);
        let observed_secs = now.saturating_sub(obs.first_seen);
        out.push(Assessment {
            pid: s.pid,
            starttime: s.starttime,
            agent_id: s.agent_id.clone(),
            idle_secs,
            observed_secs,
            idle: idle_window_secs > 0 && idle_secs >= idle_window_secs && observed_secs >= idle_window_secs,
        });
    }
    out
}

/// Loads the state file, treating absence or corruption as empty state.
pub fn load_state(path: &Path) -> GcState {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Writes the state file atomically.
pub fn save_state(path: &Path, state: &GcState) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    let text = serde_json::to_string_pretty(state).map_err(std::io::Error::other)?;
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct FakeProc {
        cmd: HashMap<u32, Vec<u8>>,
        stat: HashMap<u32, String>,
    }

    impl ProcSource for FakeProc {
        fn cmdline(&self, pid: u32) -> Result<Vec<u8>, ProcError> {
            self.cmd.get(&pid).cloned().ok_or(ProcError::NoSuchProcess)
        }
        fn stat(&self, pid: u32) -> Result<String, ProcError> {
            self.stat.get(&pid).cloned().ok_or(ProcError::NoSuchProcess)
        }
    }

    fn stat_line(pid: u32, comm: &str, utime: u64, stime: u64, starttime: u64) -> String {
        // pid (comm) state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime cutime cstime priority nice threads itrealvalue starttime ...
        format!(
            "{pid} ({comm}) S 1 1 1 0 -1 4194560 100 0 0 0 {utime} {stime} 0 0 20 0 8 0 {starttime} 1000 200 18446744073709551615"
        )
    }

    fn argv(parts: &[&str]) -> Vec<u8> {
        let mut v = Vec::new();
        for p in parts {
            v.extend_from_slice(p.as_bytes());
            v.push(0);
        }
        v
    }

    #[test]
    fn identifies_teammates_by_argv_elements_only() {
        let yes = [
            vec!["/nix/store/x/bin/.claude-wrapped", "--agent-id", "vc-core@session-1", "--agent-name", "vc-core"],
            vec!["claude", "--permission-mode", "auto", "--agent-id=ab-runtime@s"],
            vec!["/usr/bin/node", "/opt/claude-code/cli.js", "--agent-id", "x"],
        ];
        for a in &yes {
            assert!(teammate_agent_id(a).is_some(), "{a:?}");
        }
        assert_eq!(
            teammate_agent_id(&yes[0]).as_deref(),
            Some("vc-core@session-1")
        );
        let no = [
            vec!["sh", "-c", "claude --agent-id x"],
            vec!["grep", "--agent-id", "x"],
            vec!["claude", "--permission-mode", "auto"],
            vec!["claude", "--agent-id"],
            vec!["claude", "--agent-id", "--agent-name"],
            vec!["/usr/bin/node", "/opt/other/cli.js", "--agent-id", "x"],
            vec!["ruflo", "daemon", "start", "--agent-id", "x"],
        ];
        for a in &no {
            assert!(teammate_agent_id(a).is_none(), "{a:?}");
        }
    }

    #[test]
    fn cpu_ticks_parse_after_comm_with_spaces_and_parens() {
        let s = stat_line(7, "claude (x) y", 120, 30, 999);
        assert_eq!(parse_cpu_ticks(&s).unwrap(), 150);
        assert!(parse_cpu_ticks("garbage").is_err());
    }

    #[test]
    fn scan_then_assess_marks_idle_after_window_only_with_baseline() {
        let mut fake = FakeProc { cmd: HashMap::new(), stat: HashMap::new() };
        fake.cmd.insert(10, argv(&["claude", "--agent-id", "a@s"]));
        fake.stat.insert(10, stat_line(10, "claude", 50, 5, 100));
        fake.cmd.insert(11, argv(&["claude", "--agent-id", "b@s"]));
        fake.stat.insert(11, stat_line(11, "claude", 50, 5, 101));
        fake.cmd.insert(12, argv(&["bash"]));
        fake.stat.insert(12, stat_line(12, "bash", 1, 1, 102));

        let seen = scan(&fake, [10, 11, 12, 13]);
        assert_eq!(seen.len(), 2);
        assert_eq!(seen[0].agent_id, "a@s");
        assert_eq!(seen[0].cpu_ticks, 55);

        let mut state = GcState::default();
        let window = 1800;
        let a0 = assess(&mut state, &seen, 1_000, window);
        assert!(a0.iter().all(|a| !a.idle), "no baseline yet");

        // 1800 s later: a is unchanged (idle), b advanced (active).
        fake.stat.insert(11, stat_line(11, "claude", 60, 5, 101));
        let seen = scan(&fake, [10, 11]);
        let a1 = assess(&mut state, &seen, 2_800, window);
        assert!(a1[0].idle, "a: {a1:?}");
        assert_eq!(a1[0].idle_secs, 1800);
        assert!(!a1[1].idle);

        // b goes quiet for 1799 s: not yet idle; at 1800 it is.
        let a2 = assess(&mut state, &seen, 2_800 + 1_799, window);
        assert!(!a2[1].idle);
        let a3 = assess(&mut state, &seen, 2_800 + 1_800, window);
        assert!(a3[1].idle);

        // pid 10 is reused by a new claude with a different starttime: baseline resets.
        fake.stat.insert(10, stat_line(10, "claude", 0, 0, 5_000));
        let seen = scan(&fake, [10, 11]);
        let a4 = assess(&mut state, &seen, 9_000, window);
        assert!(!a4[0].idle, "fresh starttime is a fresh observation");
        assert_eq!(state.observations.len(), 2);
        assert!(state.observations.contains_key("10:5000"));
        assert!(!state.observations.contains_key("10:100"));
    }

    #[test]
    fn window_zero_disables_idleness() {
        let mut state = GcState::default();
        let seen = vec![Seen { pid: 1, starttime: 1, agent_id: "x".into(), cpu_ticks: 1 }];
        assess(&mut state, &seen, 0, 0);
        let a = assess(&mut state, &seen, 1_000_000, 0);
        assert!(!a[0].idle);
    }

    #[test]
    fn state_round_trips_and_tolerates_corruption() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("gc").join("state.json");
        let mut state = GcState::default();
        state.observations.insert(
            "1:2".into(),
            Observation { pid: 1, starttime: 2, agent_id: "a".into(), first_seen: 3, last_active: 4, cpu_ticks: 5 },
        );
        save_state(&p, &state).unwrap();
        assert_eq!(load_state(&p), state);
        std::fs::write(&p, "{not json").unwrap();
        assert_eq!(load_state(&p), GcState::default());
        assert_eq!(load_state(&dir.path().join("missing")), GcState::default());
    }
}
