//! Schedule parsing and next-run computation for `hermes-scheduler`.
//!
//! Ported from the `parse_schedule` / `compute_next_run` half of
//! `skills/hermes-scheduler/scripts/scheduler.py`. The serialised shape is
//! kept byte-identical so an existing `~/.claude/scheduler/jobs.json` written
//! by the Python daemon still loads.
//!
//! The Python version needed `croniter` (an optional import that made cron
//! schedules fail at runtime when absent); `croner` is a hard dependency here,
//! so cron support is always available.

use chrono::{DateTime, Datelike, Duration, Local, NaiveDateTime, TimeZone};
use croner::Cron;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

/// A one-shot job stays runnable for this long after its due time.
pub const ONESHOT_GRACE_SECONDS: i64 = 120;
const MIN_GRACE: i64 = 120;
const MAX_GRACE: i64 = 7200;

/// The parsed `schedule` object stored on each job.
///
/// Serialises internally tagged on `kind`, which reproduces the Python dicts
/// exactly: `{"kind": "interval", "minutes": 30, "display": "every 30m"}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Schedule {
    Interval {
        minutes: i64,
        display: String,
    },
    Daily {
        hour: u32,
        minute: u32,
        display: String,
    },
    Cron {
        expr: String,
        display: String,
    },
    Once {
        run_at: String,
        display: String,
    },
}

impl Schedule {
    pub fn display(&self) -> &str {
        match self {
            Self::Interval { display, .. }
            | Self::Daily { display, .. }
            | Self::Cron { display, .. }
            | Self::Once { display, .. } => display,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Self::Interval { .. } => "interval",
            Self::Daily { .. } => "daily",
            Self::Cron { .. } => "cron",
            Self::Once { .. } => "once",
        }
    }

    /// True for the recurring kinds, which are the only ones that fast-forward
    /// when stale or advance before execution.
    pub fn is_recurring(&self) -> bool {
        matches!(self, Self::Cron { .. } | Self::Interval { .. })
    }
}

/// Compiles a cron expression.
///
/// `croner`'s `FromStr` builds the pattern lazily and never reports a syntax
/// error, so validation must go through `Cron::new(..).parse()`.
pub fn parse_cron(expr: &str) -> Result<Cron, croner::errors::CronError> {
    Cron::new(expr).parse()
}

fn duration_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$").unwrap()
    })
}

fn daily_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(?:daily\s+at|at)\s+(\d{1,2}):(\d{2})$").unwrap())
}

fn cron_field_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[\d\*\-,/]+$").unwrap())
}

/// `'30m' -> 30`, `'2h' -> 120`, `'1d' -> 1440`.
pub fn parse_duration(s: &str) -> Result<i64, String> {
    let s = s.trim().to_lowercase();
    let caps = duration_re()
        .captures(&s)
        .ok_or_else(|| format!("Invalid duration: '{s}'. Use '30m', '2h', or '1d'"))?;
    let value: i64 = caps[1]
        .parse()
        .map_err(|_| format!("Invalid duration: '{s}'"))?;
    let unit = caps[2].chars().next().unwrap();
    let scale = match unit {
        'm' => 1,
        'h' => 60,
        'd' => 1440,
        _ => unreachable!("the regex admits only m/h/d"),
    };
    Ok(value * scale)
}

/// Parses every accepted schedule form, in the Python original's order:
/// `every X`, `daily at HH:MM`, cron, ISO timestamp, bare duration.
pub fn parse_schedule(input: &str, now: DateTime<Local>) -> Result<Schedule, String> {
    let schedule = input.trim();
    let lower = schedule.to_lowercase();

    if let Some(rest) = lower.strip_prefix("every ") {
        let minutes = parse_duration(rest.trim())?;
        return Ok(Schedule::Interval {
            minutes,
            display: format!("every {minutes}m"),
        });
    }

    if let Some(caps) = daily_re().captures(&lower) {
        let hh: u32 = caps[1]
            .parse()
            .map_err(|_| "Invalid daily time".to_string())?;
        let mm: u32 = caps[2]
            .parse()
            .map_err(|_| "Invalid daily time".to_string())?;
        if hh > 23 || mm > 59 {
            return Err(format!("Invalid daily time '{schedule}'"));
        }
        return Ok(Schedule::Daily {
            hour: hh,
            minute: mm,
            display: format!("daily at {hh:02}:{mm:02}"),
        });
    }

    let parts: Vec<&str> = schedule.split_whitespace().collect();
    if parts.len() >= 5 && parts[..5].iter().all(|p| cron_field_re().is_match(p)) {
        parse_cron(schedule).map_err(|e| format!("Invalid cron expression '{schedule}': {e}"))?;
        return Ok(Schedule::Cron {
            expr: schedule.to_string(),
            display: schedule.to_string(),
        });
    }

    if schedule.contains('T') || starts_with_iso_date(schedule) {
        let dt =
            parse_iso(schedule, now).ok_or_else(|| format!("Invalid timestamp '{schedule}'"))?;
        return Ok(Schedule::Once {
            run_at: iso(&dt),
            display: format!("once at {}", dt.format("%Y-%m-%d %H:%M")),
        });
    }

    if let Ok(minutes) = parse_duration(schedule) {
        let run_at = now + Duration::minutes(minutes);
        return Ok(Schedule::Once {
            run_at: iso(&run_at),
            display: format!("once in {schedule}"),
        });
    }

    Err(format!(
        "Invalid schedule '{schedule}'. Use:\n  \
         Duration: '30m', '2h' (one-shot)\n  \
         Interval: 'every 30m' (recurring)\n  \
         Cron: '0 9 * * *'\n  \
         Timestamp: '2026-04-07T09:00'"
    ))
}

fn starts_with_iso_date(s: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\d{4}-\d{2}-\d{2}").unwrap())
        .is_match(s)
}

/// Renders a local timestamp the way Python's `datetime.isoformat()` does.
pub fn iso(dt: &DateTime<Local>) -> String {
    let base = dt.format("%Y-%m-%dT%H:%M:%S").to_string();
    let micros = dt.timestamp_subsec_micros();
    let offset = dt.format("%:z").to_string();
    if micros == 0 {
        format!("{base}{offset}")
    } else {
        format!("{base}.{micros:06}{offset}")
    }
}

/// Parses an ISO-8601 timestamp, treating a naive one as local time — which is
/// what `datetime.fromisoformat(...).astimezone()` does.
pub fn parse_iso(s: &str, now: DateTime<Local>) -> Option<DateTime<Local>> {
    let normalised = s.replace('Z', "+00:00");
    if let Ok(dt) = DateTime::parse_from_rfc3339(&normalised) {
        return Some(dt.with_timezone(&Local));
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
    ] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(&normalised, fmt) {
            return Local.from_local_datetime(&naive).single().or_else(|| {
                // Ambiguous or skipped local time (a DST boundary): keep the
                // earliest valid interpretation rather than dropping the job.
                Local.from_local_datetime(&naive).earliest()
            });
        }
    }
    if let Ok(date) = chrono::NaiveDate::parse_from_str(&normalised, "%Y-%m-%d") {
        let naive = date.and_hms_opt(0, 0, 0)?;
        return Local.from_local_datetime(&naive).single();
    }
    let _ = now;
    None
}

/// The next due instant, or `None` when the job is finished.
pub fn compute_next_run(
    schedule: &Schedule,
    last_run_at: Option<&str>,
    now: DateTime<Local>,
) -> Option<String> {
    match schedule {
        Schedule::Once { run_at, .. } => {
            if last_run_at.is_some() {
                return None;
            }
            let run_at_dt = parse_iso(run_at, now)?;
            if run_at_dt >= now - Duration::seconds(ONESHOT_GRACE_SECONDS) {
                Some(run_at.clone())
            } else {
                None
            }
        }
        Schedule::Interval { minutes, .. } => {
            let base = match last_run_at {
                Some(last) => parse_iso(last, now)?,
                None => now,
            };
            Some(iso(&(base + Duration::minutes(*minutes))))
        }
        Schedule::Cron { expr, .. } => {
            let cron = parse_cron(expr).ok()?;
            let next = cron.find_next_occurrence(&now, false).ok()?;
            Some(iso(&next))
        }
        Schedule::Daily { hour, minute, .. } => {
            let mut candidate = Local
                .with_ymd_and_hms(now.year(), now.month(), now.day(), *hour, *minute, 0)
                .single()?;
            if candidate <= now {
                candidate += Duration::days(1);
            }
            Some(iso(&candidate))
        }
    }
}

/// How long a missed run may lag before the daemon fast-forwards past it.
/// Half a period, clamped to `[120s, 7200s]`.
pub fn grace_seconds(schedule: &Schedule, now: DateTime<Local>) -> i64 {
    match schedule {
        Schedule::Interval { minutes, .. } => {
            let period = minutes * 60;
            MIN_GRACE.max((period / 2).min(MAX_GRACE))
        }
        Schedule::Daily { .. } => MAX_GRACE,
        Schedule::Cron { expr, .. } => {
            let Ok(cron) = parse_cron(expr) else {
                return MIN_GRACE;
            };
            let Ok(first) = cron.find_next_occurrence(&now, false) else {
                return MIN_GRACE;
            };
            let Ok(second) = cron.find_next_occurrence(&first, false) else {
                return MIN_GRACE;
            };
            let period = (second - first).num_seconds();
            MIN_GRACE.max((period / 2).min(MAX_GRACE))
        }
        Schedule::Once { .. } => MIN_GRACE,
    }
}

#[cfg(test)]
#[path = "schedule_tests.rs"]
mod tests;
