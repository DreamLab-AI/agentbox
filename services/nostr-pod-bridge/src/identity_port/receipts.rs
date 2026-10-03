//! Sign receipts: one JSONL line per decision, admit or refuse.
//!
//! Lines go to `<dir>/sign-<YYYY-MM-DD>.jsonl` (UTC). A line holds the time,
//! decision, operation, caller uid/gid/pid and executable, key name, kind,
//! event id and URL or relay host. It never holds request content, tags, a
//! challenge, a header, or any key material (fingerprint discipline, ADR-2027
//! :86-91).

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::{Context, Result};
use serde::Serialize;

use super::port::Peer;

/// One receipt line.
#[derive(Debug, Clone, Serialize)]
pub struct Receipt {
    /// Unix seconds.
    pub ts: u64,
    /// `admit` or `refuse`.
    pub decision: &'static str,
    /// The operation as named (sanitised).
    pub op: String,
    /// Caller uid from `SO_PEERCRED`.
    pub uid: u32,
    /// Caller gid from `SO_PEERCRED`.
    pub gid: u32,
    /// Caller pid, audit only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<i32>,
    /// Caller executable, when `/proc/<pid>/exe` is readable to the port.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exe: Option<String>,
    /// Key name used.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// Event kind signed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<u64>,
    /// Signed event id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
    /// URL or relay host.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    /// Refusal reason.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl Receipt {
    /// A receipt for `op` from `peer`, decision not yet set.
    pub fn new(ts: u64, op: &str, peer: Peer) -> Self {
        let exe = peer
            .pid
            .and_then(|p| std::fs::read_link(format!("/proc/{p}/exe")).ok())
            .map(|p| p.display().to_string());
        Self {
            ts,
            decision: "refuse",
            op: op.to_string(),
            uid: peer.uid,
            gid: peer.gid,
            pid: peer.pid,
            exe,
            key: None,
            kind: None,
            event_id: None,
            host: None,
            reason: None,
        }
    }

    /// Mark admitted.
    pub fn admit(
        &mut self,
        key: Option<String>,
        kind: Option<u64>,
        event_id: Option<String>,
        host: Option<String>,
    ) {
        self.decision = "admit";
        self.key = key;
        self.kind = kind;
        self.event_id = event_id;
        self.host = host;
    }

    /// Mark refused.
    pub fn refuse(&mut self, reason: &str) {
        self.decision = "refuse";
        self.reason = Some(reason.to_string());
    }
}

/// The receipt sink.
#[derive(Debug)]
pub struct Receipts {
    dir: PathBuf,
    lock: Mutex<()>,
}

impl Receipts {
    /// Receipts under `dir`, which is created (0750) if absent.
    pub fn new(dir: impl Into<PathBuf>) -> Result<Self> {
        let dir = dir.into();
        if !dir.is_dir() {
            std::fs::create_dir_all(&dir)
                .with_context(|| format!("creating receipt dir {}", dir.display()))?;
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o750))
                .with_context(|| format!("chmod {}", dir.display()))?;
        }
        Ok(Self {
            dir,
            lock: Mutex::new(()),
        })
    }

    /// Append one line. Lines are written whole with `O_APPEND`.
    pub fn write(&self, r: &Receipt) -> Result<()> {
        use std::os::unix::fs::OpenOptionsExt;
        let mut line = serde_json::to_string(r)?;
        line.push('\n');
        let path = self.dir.join(format!("sign-{}.jsonl", utc_date(r.ts)));
        let _g = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o640)
            .open(&path)
            .with_context(|| format!("opening {}", path.display()))?;
        f.write_all(line.as_bytes())
            .with_context(|| format!("writing {}", path.display()))
    }
}

/// `YYYY-MM-DD` for Unix seconds (proleptic Gregorian, UTC).
fn utc_date(ts: u64) -> String {
    // Howard Hinnant's civil_from_days.
    let z = (ts / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::utc_date;

    #[test]
    fn utc_dates() {
        assert_eq!(utc_date(0), "1970-01-01");
        assert_eq!(utc_date(951_782_400), "2000-02-29");
        assert_eq!(utc_date(1_790_985_600), "2026-10-03");
        assert_eq!(utc_date(1_790_985_599), "2026-10-02");
    }
}
