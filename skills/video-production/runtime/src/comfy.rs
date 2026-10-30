//! Hash-verified upload to a ComfyUI-compatible `/upload/image` endpoint.
//!
//! The bytes sent are the bytes that were hashed, and when a digest was
//! declared they must equal it: the file is read once, verified, then the same
//! buffer becomes the request body. The multipart body is built here and piped
//! to `curl --data-binary @-`, so no filename ever passes through curl's
//! `--form` syntax (where `;` and `,` are separators).
//!
//! It also reads `/object_info` combo inputs ([`combo_choices`]) and checks a
//! workflow requirement manifest against them ([`capability_snapshot`]).
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    error::Error,
    io::Write,
    path::Path,
    process::{Command, Stdio},
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

/// Lower-case hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Read `path` once and return its bytes and digest.
///
/// When `declared` is given the digest must match it, otherwise this fails
/// before anything is sent anywhere.
pub fn read_verified(path: &Path, declared: Option<&str>) -> Result<(Vec<u8>, String)> {
    let bytes = std::fs::read(path)?;
    let digest = sha256_hex(&bytes);
    if let Some(expected) = declared
        && expected != digest
    {
        return Err(format!(
            "upload bytes of {} hash to {digest}, not the declared {expected}",
            path.display()
        )
        .into());
    }
    Ok((bytes, digest))
}

fn escape_filename(name: &str) -> String {
    name.replace('"', "%22")
        .replace('\r', "%0D")
        .replace('\n', "%0A")
}

fn content_type(name: &str) -> &'static str {
    match name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("mkv") => "video/x-matroska",
        Some("mp4") => "video/mp4",
        Some("wav") => "audio/wav",
        _ => "application/octet-stream",
    }
}

/// Choose a multipart boundary that does not occur in `bytes`.
pub fn boundary_for(bytes: &[u8]) -> String {
    let seed = sha256_hex(bytes);
    for counter in 0u32.. {
        let candidate = format!("vpr-{}-{counter}", &seed[..24]);
        let needle = candidate.as_bytes();
        if !bytes.windows(needle.len()).any(|w| w == needle) {
            return candidate;
        }
    }
    unreachable!("a boundary is always found")
}

/// A `multipart/form-data` body with a single file part named `field`.
///
/// The filename is quoted with `"` percent-encoded and CR/LF removed (the
/// WHATWG form-data rule), so `a;b,c.png` is carried verbatim.
pub fn multipart_body(boundary: &str, field: &str, filename: &str, bytes: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(bytes.len() + 256);
    write!(
        body,
        "--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{}\"\r\nContent-Type: {}\r\n\r\n",
        escape_filename(filename),
        content_type(filename)
    )
    .expect("writing to a Vec cannot fail");
    body.extend_from_slice(bytes);
    write!(body, "\r\n--{boundary}--\r\n").expect("writing to a Vec cannot fail");
    body
}

/// POST `bytes` as `filename` to `{url}/upload/image` and return the JSON reply.
pub fn upload_bytes(url: &str, filename: &str, bytes: &[u8]) -> Result<Value> {
    let boundary = boundary_for(bytes);
    let body = multipart_body(&boundary, "image", filename, bytes);
    let mut child = Command::new("curl")
        .args(["--fail", "--silent", "--show-error", "--header"])
        .arg(format!(
            "Content-Type: multipart/form-data; boundary={boundary}"
        ))
        .args(["--data-binary", "@-"])
        .arg(format!("{url}/upload/image"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut stdin = child.stdin.take().ok_or("curl stdin unavailable")?;
    let writer = std::thread::spawn(move || stdin.write_all(&body));
    let out = child.wait_with_output()?;
    // A failed curl is reported first; a short write is an error even if curl succeeded.
    let written = writer.join().map_err(|_| "upload writer thread panicked")?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned().into());
    }
    written?;
    let reply: Value = serde_json::from_slice(&out.stdout)?;
    if reply["name"].as_str().is_none() {
        return Err("Upload has no filename".into());
    }
    Ok(reply)
}

/// Verify and upload a file, returning the service reply plus `local_path`
/// (the caller-supplied root-relative `receipt_path`) and the uploaded digest.
pub fn upload_file(
    url: &str,
    path: &Path,
    receipt_path: &str,
    declared: Option<&str>,
) -> Result<Value> {
    let (bytes, digest) = read_verified(path, declared)?;
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("upload path has no UTF-8 file name")?;
    let mut reply = upload_bytes(url, filename, &bytes)?;
    reply["local_path"] = json!(receipt_path);
    reply["sha256"] = json!(digest);
    Ok(reply)
}

/// Choices of an `/object_info` input definition, or `None` when it is not a combo.
///
/// Legacy form `[[choice, ...], {...}]` and current form
/// `["COMBO", {"options": [...]}]` are both read; the string `"COMBO"` is a
/// type tag and never a choice.
pub fn combo_choices(definition: &Value) -> Option<Vec<String>> {
    let head = definition.get(0)?;
    let strings = |list: &[Value]| {
        list.iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect()
    };
    if let Some(list) = head.as_array() {
        return Some(strings(list));
    }
    if head.as_str() == Some("COMBO") {
        let options = definition
            .get(1)
            .and_then(|m| m.get("options"))
            .and_then(Value::as_array);
        return Some(options.map(|o| strings(o)).unwrap_or_default());
    }
    None
}

/// Check `{required_nodes, required_models: {"Class.input": [file, ...]}}`
/// against an `/object_info` document. Each item is `PASS` or `BLOCKED`; the
/// overall status is `BLOCKED` if any item is.
pub fn capability_snapshot(manifest: &Value, nodes: &Value) -> Value {
    let mut items = Vec::new();
    let mut item = |kind: &str, name: &str, file: Option<&str>, reason: Option<String>| {
        let mut v = json!({"kind": kind, "name": name,
            "status": if reason.is_some() { "BLOCKED" } else { "PASS" }});
        if let Some(f) = file {
            v["file"] = json!(f);
        }
        if let Some(r) = reason {
            v["reason"] = json!(r);
        }
        items.push(v);
    };
    for name in manifest["required_nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        let reason = nodes
            .get(name)
            .is_none()
            .then(|| "node not installed".to_string());
        item("node", name, None, reason);
    }
    for (key, files) in manifest["required_models"]
        .as_object()
        .into_iter()
        .flatten()
    {
        let (class, field) = key.split_once('.').unwrap_or((key, ""));
        let shared: std::result::Result<Vec<String>, String> = match nodes.get(class) {
            None => Err(format!("node {class} not installed")),
            Some(schema) => {
                let input = &schema["input"];
                match input["required"]
                    .get(field)
                    .or_else(|| input["optional"].get(field))
                {
                    None => Err(format!("input {field} not found on {class}")),
                    Some(def) => combo_choices(def)
                        .ok_or_else(|| format!("input {field} on {class} is not a combo")),
                }
            }
        };
        for file in files
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            let reason = match &shared {
                Err(r) => Some(r.clone()),
                Ok(choices) => (!choices.iter().any(|c| c == file))
                    .then(|| "file not offered by server".to_string()),
            };
            item("model", key, Some(file), reason);
        }
    }
    let blocked = items.iter().any(|i| i["status"] == "BLOCKED");
    json!({"status": if blocked { "BLOCKED" } else { "PASS" }, "items": items})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::Read,
        net::{TcpListener, TcpStream},
    };

    fn temp(name: &str, bytes: &[u8]) -> (std::path::PathBuf, std::path::PathBuf) {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("vpr-comfy-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join(name);
        std::fs::write(&file, bytes).unwrap();
        (dir, file)
    }

    fn read_request(mut stream: TcpStream) -> (String, Vec<u8>, TcpStream) {
        let mut data = Vec::new();
        let mut buf = [0u8; 4096];
        let (head_end, length) = loop {
            let n = stream.read(&mut buf).unwrap();
            assert!(n > 0, "client closed early");
            data.extend_from_slice(&buf[..n]);
            if let Some(i) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&data[..i]).to_lowercase();
                let length = head
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length:"))
                    .map(|v| v.trim().parse::<usize>().unwrap())
                    .unwrap();
                break (i + 4, length);
            }
        };
        while data.len() < head_end + length {
            let n = stream.read(&mut buf).unwrap();
            data.extend_from_slice(&buf[..n]);
        }
        (
            String::from_utf8_lossy(&data[..head_end]).into_owned(),
            data[head_end..head_end + length].to_vec(),
            stream,
        )
    }

    #[test]
    fn filename_with_form_syntax_characters_round_trips_with_exact_bytes() {
        let payload: Vec<u8> = (0..=255u8).cycle().take(5000).collect();
        let name = "a;b,c\"d.png";
        let (dir, file) = temp(name, &payload);
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let (head, body, mut stream) = read_request(stream);
            let reply = br#"{"name":"stored.png","subfolder":"","type":"input"}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                reply.len()
            )
            .unwrap();
            stream.write_all(reply).unwrap();
            (head, body)
        });
        let digest = sha256_hex(&payload);
        let reply = upload_file(&url, &file, "frames/x.png", Some(&digest)).unwrap();
        let (head, body) = server.join().unwrap();
        assert!(head.starts_with("POST /upload/image "));
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("filename=\"a;b,c%22d.png\""), "{text}");
        let start = body.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
        let boundary = head
            .split("boundary=")
            .nth(1)
            .unwrap()
            .lines()
            .next()
            .unwrap()
            .trim();
        let tail = format!("\r\n--{boundary}--\r\n").len();
        assert_eq!(&body[start..body.len() - tail], payload.as_slice());
        assert_eq!(reply["sha256"], digest);
        assert_eq!(reply["local_path"], "frames/x.png");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn declared_hash_mismatch_aborts_before_any_connection() {
        let (dir, file) = temp("a.png", b"actual bytes");
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let wrong = sha256_hex(b"declared bytes");
        let error = upload_file(&url, &file, "a.png", Some(&wrong)).unwrap_err();
        assert!(error.to_string().contains("not the declared"), "{error}");
        assert!(listener.accept().is_err(), "a connection was attempted");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn hashed_bytes_are_the_uploaded_bytes() {
        let (dir, file) = temp("a.png", b"first");
        let (bytes, digest) = read_verified(&file, None).unwrap();
        // Replacing the file after hashing cannot change what would be sent.
        std::fs::write(&file, b"second").unwrap();
        assert_eq!(sha256_hex(&bytes), digest);
        assert!(read_verified(&file, Some(&digest)).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn boundary_never_occurs_in_payload() {
        let seed = boundary_for(b"x");
        let nasty = format!("..{seed}..");
        let chosen = boundary_for(nasty.as_bytes());
        assert!(!nasty.contains(&chosen));
    }

    #[test]
    fn combo_choices_reads_both_forms_and_never_the_tag() {
        let legacy = json!([["a.safetensors", "b.safetensors"], {}]);
        let current = json!(["COMBO", {"options": ["a.safetensors"]}]);
        assert_eq!(
            combo_choices(&legacy).unwrap(),
            ["a.safetensors", "b.safetensors"]
        );
        assert_eq!(combo_choices(&current).unwrap(), ["a.safetensors"]);
        assert_eq!(
            combo_choices(&json!(["COMBO", {}])).unwrap(),
            Vec::<String>::new()
        );
        assert!(combo_choices(&json!(["IMAGE", {}])).is_none());
        assert!(combo_choices(&json!(null)).is_none());
    }

    #[test]
    fn snapshot_passes_installed_model_in_new_combo_form() {
        let nodes = json!({"Loader": {"input": {
            "required": {"ckpt": ["COMBO", {"options": ["installed.safetensors"]}]},
            "optional": {"lora": [["legacy.safetensors"], {}]}}}});
        let manifest = json!({"required_nodes": ["Loader", "Absent"],
            "required_models": {"Loader.ckpt": ["installed.safetensors", "gone.safetensors"],
                                "Loader.lora": ["legacy.safetensors"], "Loader.nope": ["x"]}});
        let snap = capability_snapshot(&manifest, &nodes);
        let find = |name: &str, file: Option<&str>| {
            snap["items"]
                .as_array()
                .unwrap()
                .iter()
                .find(|i| i["name"] == name && i.get("file").and_then(Value::as_str) == file)
                .unwrap()["status"]
                .clone()
        };
        assert_eq!(find("Loader", None), "PASS");
        assert_eq!(find("Absent", None), "BLOCKED");
        assert_eq!(find("Loader.ckpt", Some("installed.safetensors")), "PASS");
        assert_eq!(find("Loader.ckpt", Some("gone.safetensors")), "BLOCKED");
        assert_eq!(find("Loader.lora", Some("legacy.safetensors")), "PASS");
        assert_eq!(find("Loader.nope", Some("x")), "BLOCKED");
        assert_eq!(snap["status"], "BLOCKED");
        let ok = capability_snapshot(&json!({"required_nodes": ["Loader"]}), &nodes);
        assert_eq!(ok["status"], "PASS");
    }
}
