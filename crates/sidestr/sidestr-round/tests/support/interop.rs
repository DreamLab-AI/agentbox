//! Running the reference signer and `cosign` as processes on one box, with
//! the relay stand-in between them: what `test/round-test.sh` does with
//! public relays, here self-contained.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use bitcoin::secp256k1::SecretKey;

/// The reference checkouts, from the environment; `None` skips the test.
pub struct Upstream {
    pub siding: PathBuf,
    pub schema: String,
    pub blaketestnode: String,
}

pub fn upstream() -> Option<Upstream> {
    let siding = std::env::var("SIDESTR_SIDING").ok()?;
    let schema = std::env::var("SCHEMA").ok()?;
    let blaketestnode = std::env::var("BLAKETESTNODE").ok()?;
    let siding = PathBuf::from(siding);
    if !siding.join("bin/siding.mjs").exists() {
        eprintln!("SIDESTR_SIDING={} has no bin/siding.mjs", siding.display());
        return None;
    }
    Some(Upstream {
        siding,
        schema,
        blaketestnode,
    })
}

pub fn skip_unless_upstream() -> Option<Upstream> {
    let u = upstream();
    if u.is_none() {
        eprintln!("skipped: set SIDESTR_SIDING, SCHEMA and BLAKETESTNODE to run the interop check");
    }
    u
}

pub fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

pub fn write_key(path: &Path, key: &SecretKey) {
    std::fs::write(path, format!("{}\n", hex::encode(key.secret_bytes()))).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
}

/// A process with its log file, killed on drop.
pub struct Proc {
    pub name: String,
    pub child: Child,
    pub log: PathBuf,
}

impl Proc {
    pub fn log(&self) -> String {
        std::fs::read_to_string(&self.log).unwrap_or_default()
    }
    pub fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
    pub fn tail(&self, n: usize) -> String {
        let l = self.log();
        let lines: Vec<&str> = l.lines().collect();
        lines[lines.len().saturating_sub(n)..].join("\n")
    }
}

impl Drop for Proc {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn spawn(name: &str, mut cmd: Command, log: PathBuf) -> Proc {
    let file = std::fs::File::create(&log).unwrap();
    let err = file.try_clone().unwrap();
    let child = cmd
        .stdout(Stdio::from(file))
        .stderr(Stdio::from(err))
        .stdin(Stdio::null())
        .spawn()
        .unwrap_or_else(|e| panic!("{name}: {e}"));
    Proc {
        name: name.into(),
        child,
        log,
    }
}

/// `node siding.mjs <args>` to completion, stdout as text.
pub fn js_run(u: &Upstream, args: &[&str]) -> String {
    let out = Command::new("node")
        .arg(u.siding.join("bin/siding.mjs"))
        .args(args)
        .env("SCHEMA", &u.schema)
        .env("BLAKETESTNODE", &u.blaketestnode)
        .output()
        .expect("node");
    assert!(
        out.status.success(),
        "siding {}: {}\n{}",
        args.join(" "),
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).to_string()
}

/// A reference producer (`siding produce`) as a signer of the chain.
#[allow(clippy::too_many_arguments)]
pub fn js_signer(
    u: &Upstream,
    name: &str,
    chain: &Path,
    dir: &Path,
    key: &Path,
    port: u16,
    relay: &str,
    extra: &[&str],
    log: PathBuf,
) -> Proc {
    let mut c = Command::new("node");
    c.arg(u.siding.join("bin/siding.mjs"))
        .arg("produce")
        .args([
            "--chain",
            &chain.display().to_string(),
            "--dir",
            &dir.display().to_string(),
            "--key-file",
            &key.display().to_string(),
        ])
        .args([
            "--port",
            &port.to_string(),
            "--interval",
            "5",
            "--tx-interval",
            "5",
            "--propose-after",
            "8",
            "--relay",
            relay,
        ])
        .args(extra)
        .env("SCHEMA", &u.schema)
        .env("BLAKETESTNODE", &u.blaketestnode);
    spawn(name, c, log)
}

/// `cosign` as a signer of the chain.
#[allow(clippy::too_many_arguments)]
pub fn rust_signer(
    name: &str,
    chain: &Path,
    dir: &Path,
    key: &Path,
    port: u16,
    relay: &str,
    extra: &[&str],
    log: PathBuf,
) -> Proc {
    let mut c = Command::new(env!("CARGO_BIN_EXE_cosign"));
    c.args([
        "--chain",
        &chain.display().to_string(),
        "--dir",
        &dir.display().to_string(),
        "--key-file",
        &key.display().to_string(),
    ])
    .args([
        "--port",
        &port.to_string(),
        "--interval",
        "5",
        "--tx-interval",
        "5",
        "--propose-after",
        "8",
        "--relay",
        relay,
    ])
    .args(extra);
    spawn(name, c, log)
}

pub fn http_get(url: &str) -> Option<String> {
    ureq::get(url)
        .call()
        .ok()
        .and_then(|mut r| r.body_mut().read_to_string().ok())
}

pub fn http_post(url: &str, body: &str) -> Option<String> {
    ureq::post(url)
        .content_type("text/plain")
        .send(body.as_bytes())
        .ok()
        .and_then(|mut r| r.body_mut().read_to_string().ok())
}

pub fn tip(port: u16) -> i64 {
    http_get(&format!("http://127.0.0.1:{port}/tip"))
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v["height"].as_i64())
        .unwrap_or(-1)
}

pub fn status(port: u16) -> serde_json::Value {
    http_get(&format!("http://127.0.0.1:{port}/status.json"))
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(serde_json::Value::Null)
}

/// Poll until `f` is true or `secs` pass; whether it became true.
pub async fn wait_for(secs: u64, mut f: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < deadline {
        if f() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    f()
}

pub fn copy_chain(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for f in ["blocks.dat", "blocks.json"] {
        std::fs::copy(from.join(f), to.join(f)).unwrap();
    }
}

pub struct Scratch(pub PathBuf);
impl Scratch {
    pub fn new(tag: &str) -> Self {
        let p = std::env::temp_dir().join(format!("sidestr-round-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
    pub fn path(&self, f: &str) -> PathBuf {
        self.0.join(f)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        if std::env::var("SIDESTR_KEEP_SCRATCH").is_err() {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
