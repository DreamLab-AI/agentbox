//! Job storage and lifecycle for `hermes-scheduler`.
//!
//! Ported from the job-CRUD half of
//! `skills/hermes-scheduler/scripts/scheduler.py`. The on-disk layout is
//! unchanged — `~/.claude/scheduler/jobs.json`, output under
//! `~/.claude/scheduler/output/<job-id>/<timestamp>.md` — so a jobs file
//! written by the Python daemon loads here without migration.

use super::schedule::{compute_next_run, grace_seconds, iso, parse_iso, Schedule};
use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Repeat {
    /// `None` means repeat forever.
    pub times: Option<u64>,
    #[serde(default)]
    pub completed: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Job {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub schedule: Schedule,
    pub schedule_display: String,
    pub repeat: Repeat,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub state: String,
    pub workdir: Option<String>,
    pub created_at: String,
    pub next_run_at: Option<String>,
    pub last_run_at: Option<String>,
    pub last_status: Option<String>,
    pub last_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paused_at: Option<String>,
    /// Any field written by a future version is preserved on rewrite.
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct JobsFile {
    #[serde(default)]
    jobs: Vec<Job>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    updated_at: Option<String>,
}

/// The scheduler's state directory.
pub struct Store {
    pub root: PathBuf,
}

impl Store {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// `~/.claude/scheduler`, the production location.
    pub fn default_root() -> PathBuf {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/home/devuser".into());
        Path::new(&home).join(".claude").join("scheduler")
    }

    pub fn jobs_file(&self) -> PathBuf {
        self.root.join("jobs.json")
    }
    pub fn output_dir(&self) -> PathBuf {
        self.root.join("output")
    }
    pub fn pid_file(&self) -> PathBuf {
        self.root.join("scheduler.pid")
    }
    pub fn lock_file(&self) -> PathBuf {
        self.root.join(".tick.lock")
    }
    pub fn log_file(&self) -> PathBuf {
        self.root.join("scheduler.log")
    }

    /// Creates the state directories, tightening the root to 0700 as the
    /// Python original did.
    pub fn ensure_dirs(&self) -> std::io::Result<()> {
        fs::create_dir_all(&self.root)?;
        fs::create_dir_all(self.output_dir())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&self.root, fs::Permissions::from_mode(0o700));
        }
        Ok(())
    }

    /// Loads the job list. A missing or corrupt file yields an empty list,
    /// matching the Python original's deliberately forgiving behaviour.
    pub fn load(&self) -> Vec<Job> {
        let _ = self.ensure_dirs();
        let Ok(text) = fs::read_to_string(self.jobs_file()) else {
            return Vec::new();
        };
        serde_json::from_str::<JobsFile>(&text)
            .map(|f| f.jobs)
            .unwrap_or_default()
    }

    /// Writes the job list atomically: temp file in the same directory,
    /// fsync, then rename.
    pub fn save(&self, jobs: &[Job], now: DateTime<Local>) -> std::io::Result<()> {
        self.ensure_dirs()?;
        let payload = JobsFile {
            jobs: jobs.to_vec(),
            updated_at: Some(iso(&now)),
        };
        let text = serde_json::to_string_pretty(&payload)?;
        let tmp = self.root.join(format!(".jobs.{}.tmp", std::process::id()));
        {
            let mut f = fs::File::create(&tmp)?;
            f.write_all(text.as_bytes())?;
            f.flush()?;
            f.sync_all()?;
        }
        match fs::rename(&tmp, self.jobs_file()) {
            Ok(()) => Ok(()),
            Err(e) => {
                let _ = fs::remove_file(&tmp);
                Err(e)
            }
        }
    }

    /// Appends a job's run output as a timestamped markdown file.
    pub fn save_output(
        &self,
        job_id: &str,
        output: &str,
        now: DateTime<Local>,
    ) -> std::io::Result<PathBuf> {
        self.ensure_dirs()?;
        let dir = self.output_dir().join(job_id);
        fs::create_dir_all(&dir)?;
        let name = format!("{}.md", now.format("%Y-%m-%d_%H-%M-%S"));
        let path = dir.join(name);
        fs::write(&path, output)?;
        Ok(path)
    }
}

/// Builds a new job. One-shots default to a single run.
pub fn new_job(
    prompt: &str,
    schedule: Schedule,
    name: Option<&str>,
    repeat: Option<i64>,
    workdir: Option<&str>,
    now: DateTime<Local>,
) -> Job {
    let mut repeat = repeat.filter(|r| *r > 0).map(|r| r as u64);
    if schedule.kind() == "once" && repeat.is_none() {
        repeat = Some(1);
    }

    Job {
        id: uuid::Uuid::new_v4().simple().to_string()[..12].to_string(),
        name: name.map(str::to_string).unwrap_or_else(|| {
            prompt
                .chars()
                .take(50)
                .collect::<String>()
                .trim()
                .to_string()
        }),
        prompt: prompt.to_string(),
        schedule_display: schedule.display().to_string(),
        next_run_at: compute_next_run(&schedule, None, now),
        schedule,
        repeat: Repeat {
            times: repeat,
            completed: 0,
        },
        enabled: true,
        state: "scheduled".to_string(),
        workdir: workdir.map(str::to_string),
        created_at: iso(&now),
        last_run_at: None,
        last_status: None,
        last_error: None,
        paused_at: None,
        extra: BTreeMap::new(),
    }
}

/// The outcome of scanning for due jobs.
pub struct DueScan {
    /// Jobs that should run now.
    pub due: Vec<Job>,
    /// Jobs fast-forwarded past a missed window: `(id, name, missed_by, grace, new_next)`.
    pub fast_forwarded: Vec<(String, String, i64, i64, String)>,
    /// True when `jobs` was mutated and must be written back.
    pub dirty: bool,
}

/// Selects due jobs, fast-forwarding stale recurring ones past missed windows
/// so a daemon that was down for hours does not stampede on restart.
pub fn scan_due(jobs: &mut [Job], now: DateTime<Local>) -> DueScan {
    let mut due = Vec::new();
    let mut fast_forwarded = Vec::new();
    let mut dirty = false;

    for job in jobs.iter_mut() {
        if !job.enabled {
            continue;
        }
        let Some(next_run) = job.next_run_at.clone() else {
            continue;
        };
        let Some(next_dt) = parse_iso(&next_run, now) else {
            continue;
        };
        if next_dt > now {
            continue;
        }

        let missed_by = (now - next_dt).num_seconds();
        let grace = grace_seconds(&job.schedule, now);

        if job.schedule.is_recurring() && missed_by > grace {
            if let Some(new_next) = compute_next_run(&job.schedule, Some(&iso(&now)), now) {
                fast_forwarded.push((
                    job.id.clone(),
                    job.name.clone(),
                    missed_by,
                    grace,
                    new_next.clone(),
                ));
                job.next_run_at = Some(new_next);
                dirty = true;
                continue;
            }
        }

        due.push(job.clone());
    }

    DueScan {
        due,
        fast_forwarded,
        dirty,
    }
}

/// Moves a recurring job's next-run forward before it executes, so a long run
/// cannot be double-dispatched by an overlapping tick.
pub fn advance_next_run(jobs: &mut [Job], job_id: &str, now: DateTime<Local>) -> bool {
    for job in jobs.iter_mut() {
        if job.id != job_id {
            continue;
        }
        if !job.schedule.is_recurring() {
            return false;
        }
        let new_next = compute_next_run(&job.schedule, Some(&iso(&now)), now);
        if new_next.is_some() && new_next != job.next_run_at {
            job.next_run_at = new_next;
            return true;
        }
        return false;
    }
    false
}

/// Records a run's outcome, retires an exhausted repeat count, and schedules
/// the next occurrence. Returns true when the job was removed.
pub fn mark_run(
    jobs: &mut Vec<Job>,
    job_id: &str,
    success: bool,
    error: Option<&str>,
    now: DateTime<Local>,
) -> bool {
    let Some(idx) = jobs.iter().position(|j| j.id == job_id) else {
        return false;
    };
    let stamp = iso(&now);

    {
        let job = &mut jobs[idx];
        job.last_run_at = Some(stamp.clone());
        job.last_status = Some(if success { "ok".into() } else { "error".into() });
        job.last_error = if success {
            None
        } else {
            error.map(str::to_string)
        };

        job.repeat.completed += 1;
        if let Some(times) = job.repeat.times {
            if times > 0 && job.repeat.completed >= times {
                jobs.remove(idx);
                return true;
            }
        }

        job.next_run_at = compute_next_run(&job.schedule, Some(&stamp), now);
        if job.next_run_at.is_none() {
            job.enabled = false;
            job.state = "completed".into();
        } else if job.state != "paused" {
            job.state = "scheduled".into();
        }
    }
    false
}

pub fn remove(jobs: &mut Vec<Job>, job_id: &str) -> bool {
    let before = jobs.len();
    jobs.retain(|j| j.id != job_id);
    jobs.len() < before
}

pub fn pause(jobs: &mut [Job], job_id: &str, now: DateTime<Local>) -> bool {
    for job in jobs.iter_mut() {
        if job.id == job_id {
            job.enabled = false;
            job.state = "paused".into();
            job.paused_at = Some(iso(&now));
            return true;
        }
    }
    false
}

pub fn resume(jobs: &mut [Job], job_id: &str, now: DateTime<Local>) -> bool {
    for job in jobs.iter_mut() {
        if job.id == job_id {
            job.enabled = true;
            job.state = "scheduled".into();
            job.paused_at = None;
            job.next_run_at = compute_next_run(&job.schedule, None, now);
            return true;
        }
    }
    false
}

pub fn trigger(jobs: &mut [Job], job_id: &str, now: DateTime<Local>) -> bool {
    for job in jobs.iter_mut() {
        if job.id == job_id {
            job.enabled = true;
            job.state = "scheduled".into();
            job.next_run_at = Some(iso(&now));
            return true;
        }
    }
    false
}

#[cfg(test)]
#[path = "jobs_tests.rs"]
mod tests;
