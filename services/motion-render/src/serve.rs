//! Read-only HTTP server that lends the page's directory to the browser sidecar.
//!
//! The sidecar's Chrome cannot read this container's files, so the page is served to it for
//! the life of one render: bound to one address, under a random path token, `GET` and `HEAD`
//! only, and never anything that resolves outside the served root.

use anyhow::{Context, Result};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// A running server. Stops when dropped.
pub struct FileServer {
    addr: SocketAddr,
    token: String,
    stop: Arc<AtomicBool>,
}

/// 128 random bits from the kernel, as 32 hex characters.
pub fn random_token() -> Result<String> {
    let mut b = [0u8; 16];
    File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut b)).context("cannot read /dev/urandom")?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

/// Decode `%XX` escapes. `None` on a malformed escape or bytes that are not UTF-8.
pub fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Encode one path segment for a URL.
pub fn percent_encode_segment(s: &str) -> String {
    s.bytes()
        .map(|c| match c {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (c as char).to_string(),
            _ => format!("%{c:02X}"),
        })
        .collect()
}

/// Map a request target to a file under `root`, or `None` for anything that must be refused:
/// a wrong or missing token, a path that leaves the root by `..` or through a symlink, a
/// directory, or a file that does not exist. `root` must already be canonical.
pub fn resolve(root: &Path, token: &str, target: &str) -> Option<PathBuf> {
    let path = target.split(['?', '#']).next()?;
    let decoded = percent_decode(path)?;
    if decoded.contains('\0') {
        return None;
    }
    let rest = decoded.strip_prefix('/')?.strip_prefix(token)?.strip_prefix('/')?;
    let real = fs::canonicalize(root.join(rest)).ok()?;
    if !real.starts_with(root) || real == root || !real.is_file() {
        return None;
    }
    Some(real)
}

fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("avif") => "image/avif",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("wasm") => "application/wasm",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn status(stream: &mut TcpStream, code: u16, reason: &str) {
    let _ = write!(stream, "HTTP/1.1 {code} {reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
}

fn handle(mut stream: TcpStream, root: &Path, token: &str) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });
    let mut line = String::new();
    if reader.by_ref().take(8192).read_line(&mut line).unwrap_or(0) == 0 {
        return;
    }
    // Drain the headers; nothing in them changes the answer.
    let mut header = String::new();
    for _ in 0..200 {
        header.clear();
        match reader.by_ref().take(8192).read_line(&mut header) {
            Ok(n) if n > 0 && header != "\r\n" && header != "\n" => continue,
            _ => break,
        }
    }
    let mut parts = line.split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    if method != "GET" && method != "HEAD" {
        return status(&mut stream, 405, "Method Not Allowed");
    }
    let Some(file) = resolve(root, token, target) else {
        return status(&mut stream, 404, "Not Found");
    };
    let Ok(mut f) = File::open(&file) else {
        return status(&mut stream, 404, "Not Found");
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    // One request per connection: an idle keep-alive would otherwise pin a thread.
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {len}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        mime(&file)
    );
    if stream.write_all(head.as_bytes()).is_err() || method == "HEAD" {
        return;
    }
    let _ = std::io::copy(&mut f, &mut stream);
}

impl FileServer {
    /// Serve `root` (canonicalised here) on an ephemeral port of `bind`.
    pub fn start(root: &Path, bind: IpAddr) -> Result<FileServer> {
        let root = fs::canonicalize(root).with_context(|| format!("no such directory: {}", root.display()))?;
        let listener = TcpListener::bind(SocketAddr::new(bind, 0)).with_context(|| format!("cannot listen on {bind}"))?;
        let addr = listener.local_addr()?;
        let token = random_token()?;
        let stop = Arc::new(AtomicBool::new(false));
        let (stop_t, token_t) = (stop.clone(), token.clone());
        std::thread::spawn(move || {
            for conn in listener.incoming() {
                if stop_t.load(Ordering::SeqCst) {
                    break;
                }
                if let Ok(stream) = conn {
                    let (root, token) = (root.clone(), token_t.clone());
                    std::thread::spawn(move || handle(stream, &root, &token));
                }
            }
        });
        Ok(FileServer { addr, token, stop })
    }

    /// URL of a file given by its path relative to the served root.
    pub fn url_for(&self, relative: &Path) -> String {
        let segs: Vec<String> = relative.components().map(|c| percent_encode_segment(&c.as_os_str().to_string_lossy())).collect();
        format!("http://{}/{}/{}", self.addr, self.token, segs.join("/"))
    }

    /// The address the server is listening on.
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// The path token.
    pub fn token(&self) -> &str {
        &self.token
    }
}

impl Drop for FileServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Wake the accept loop so it sees the flag and releases the port.
        let _ = TcpStream::connect_timeout(&self.addr, Duration::from_millis(200));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn tree() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("root");
        fs::create_dir_all(root.join("sub dir")).unwrap();
        fs::write(root.join("index.html"), "<p>hi</p>").unwrap();
        fs::write(root.join("sub dir/a b.js"), "1").unwrap();
        fs::write(dir.path().join("secret.txt"), "no").unwrap();
        std::os::unix::fs::symlink(dir.path().join("secret.txt"), root.join("link.txt")).unwrap();
        std::os::unix::fs::symlink(root.join("index.html"), root.join("inside.html")).unwrap();
        let root = fs::canonicalize(root).unwrap();
        (dir, root)
    }

    #[test]
    fn resolves_only_files_inside_the_root_under_the_token() {
        let (_d, root) = tree();
        let ok = |t: &str| resolve(&root, "tok", t);
        assert_eq!(ok("/tok/index.html"), Some(root.join("index.html")));
        assert_eq!(ok("/tok/index.html?render=1&w=1920"), Some(root.join("index.html")));
        assert_eq!(ok("/tok/sub%20dir/a%20b.js"), Some(root.join("sub dir/a b.js")));
        assert_eq!(ok("/tok/inside.html"), Some(root.join("index.html")));
        for bad in [
            "/index.html", "/wrong/index.html", "/tokindex.html", "/tok", "/tok/", "/tok/sub%20dir",
            "/tok/../secret.txt", "/tok/%2e%2e/secret.txt", "/tok/sub%20dir/../../secret.txt",
            "/tok/link.txt", "/tok/missing.html", "/tok/index.html%00", "/tok/%zz", "tok/index.html",
        ] {
            assert_eq!(ok(bad), None, "{bad} must be refused");
        }
    }

    #[test]
    fn percent_codec_round_trips() {
        assert_eq!(percent_encode_segment("a b#é.js"), "a%20b%23%C3%A9.js");
        assert_eq!(percent_decode("a%20b%23%C3%A9.js").as_deref(), Some("a b#é.js"));
        assert_eq!(percent_decode("%"), None);
        assert_eq!(percent_decode("%ff"), None);
    }

    fn get(addr: SocketAddr, request: &str) -> String {
        let mut s = TcpStream::connect(addr).unwrap();
        s.write_all(request.as_bytes()).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn serves_over_loopback_and_stops_on_drop() {
        let (_d, root) = tree();
        let srv = FileServer::start(&root, IpAddr::V4(Ipv4Addr::LOCALHOST)).unwrap();
        let (addr, tok) = (srv.addr(), srv.token().to_string());
        assert_eq!(tok.len(), 32);
        assert!(srv.url_for(Path::new("sub dir/a b.js")).ends_with(&format!("/{tok}/sub%20dir/a%20b.js")));

        let r = get(addr, &format!("GET /{tok}/index.html HTTP/1.1\r\nHost: x\r\n\r\n"));
        assert!(r.starts_with("HTTP/1.1 200 OK"), "{r}");
        assert!(r.contains("Content-Type: text/html") && r.ends_with("<p>hi</p>"), "{r}");
        let r = get(addr, &format!("HEAD /{tok}/index.html HTTP/1.1\r\n\r\n"));
        assert!(r.starts_with("HTTP/1.1 200 OK") && r.ends_with("\r\n\r\n"), "{r}");
        assert!(get(addr, &format!("GET /{tok}/link.txt HTTP/1.1\r\n\r\n")).starts_with("HTTP/1.1 404"));
        assert!(get(addr, "GET /index.html HTTP/1.1\r\n\r\n").starts_with("HTTP/1.1 404"));
        assert!(get(addr, &format!("POST /{tok}/index.html HTTP/1.1\r\n\r\n")).starts_with("HTTP/1.1 405"));

        drop(srv);
        std::thread::sleep(Duration::from_millis(300));
        assert!(TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_err(), "port still open after drop");
    }
}
