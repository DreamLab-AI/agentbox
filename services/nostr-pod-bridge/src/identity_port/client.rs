//! `nostr-pod-bridge sign-request <op>`: the one-shot client.
//!
//! Reads the operation's params as JSON on stdin, sends one request line,
//! prints the port's one-line answer on stdout. Exit codes:
//!
//! | code | meaning |
//! |------|---------|
//! | 0 | admitted; stdout is the result |
//! | 1 | refused; stdout is `{"refused": {"op", "reason"}}` |
//! | 2 | no port: the socket is absent, unreachable, or did not answer; stdout is `{"unavailable": {...}}` |
//!
//! The client decides nothing. Even stdin that is not JSON is forwarded (as a
//! JSON string) so the port refuses it and the refusal is receipted.

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};

/// Exit code: admitted.
pub const EXIT_OK: i32 = 0;
/// Exit code: refused by the port.
pub const EXIT_REFUSED: i32 = 1;
/// Exit code: no port to ask.
pub const EXIT_UNAVAILABLE: i32 = 2;

/// Run one request against the socket at `sock`. Returns the exit code and the
/// JSON to print.
pub fn request(sock: &Path, op: &str, stdin: &str) -> (i32, Value) {
    let params = if stdin.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str::<Value>(stdin).unwrap_or_else(|_| Value::String(stdin.to_string()))
    };
    let unavailable = |reason: String| {
        (
            EXIT_UNAVAILABLE,
            json!({ "unavailable": { "op": op, "socket": sock.display().to_string(), "reason": reason } }),
        )
    };
    let mut stream = match UnixStream::connect(sock) {
        Ok(s) => s,
        Err(e) => return unavailable(format!("cannot connect: {}", e.kind())),
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let mut line = match serde_json::to_vec(&json!({ "op": op, "params": params })) {
        Ok(v) => v,
        Err(e) => return unavailable(format!("cannot encode request: {e}")),
    };
    line.push(b'\n');
    if let Err(e) = stream.write_all(&line) {
        return unavailable(format!("cannot send: {}", e.kind()));
    }
    let mut answer = String::new();
    if let Err(e) = BufReader::new(stream).read_line(&mut answer) {
        return unavailable(format!("no answer: {}", e.kind()));
    }
    match serde_json::from_str::<Value>(&answer) {
        Ok(v) if v.get("refused").is_some() => (EXIT_REFUSED, v),
        Ok(v) => (EXIT_OK, v),
        Err(_) => unavailable("the port's answer was not JSON".into()),
    }
}

/// CLI entry: read stdin, call [`request`], print, return the exit code.
pub fn run(sock: &Path, op: Option<&str>) -> i32 {
    let Some(op) = op else {
        eprintln!("usage: nostr-pod-bridge sign-request <op>   (params as JSON on stdin)");
        let v = json!({ "refused": { "op": "?", "reason": "no operation named" } });
        println!("{v}");
        return EXIT_REFUSED;
    };
    let mut stdin = String::new();
    if std::io::stdin()
        .take(super::port::MAX_REQUEST_BYTES as u64 + 1)
        .read_to_string(&mut stdin)
        .is_err()
    {
        stdin = "\u{0}".into();
    }
    let (code, v) = request(sock, op, &stdin);
    println!("{v}");
    let _ = std::io::stdout().flush();
    code
}
