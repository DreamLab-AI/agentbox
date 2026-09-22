#![cfg(feature = "bin")]
mod support;
use std::io::{Read, Write};
use std::time::Duration;
use support::*;

fn get(port: u16, path: &str, headers: &str) -> Vec<u8> {
    let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    write!(
        s,
        "GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{headers}\r\n"
    )
    .unwrap();
    let mut bytes = vec![];
    s.read_to_end(&mut bytes).unwrap();
    bytes
}
#[test]
fn audit_http_unindexed_block() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../probes/http");
    std::fs::create_dir_all(&root).unwrap();
    let ks = keys(3);
    let (doc, g) = federated_doc("audithttp", &ks, 2, 0);
    let dir = root.join("chain");
    let chain = sidestr_core::chain::Chain::open_sealed(doc.clone(), &dir, |_| Ok(g)).unwrap();
    let (b, _, _) = chain
        .state()
        .build_next(&sidestr_core::state::NextBlock {
            time: 1_790_000_100,
            claims: vec![],
        })
        .unwrap();
    let sealed = seal_with(chain.state().federation().unwrap(), &b, &ks, &[0, 1]);
    drop(chain);
    std::fs::write(root.join("chain.json"), doc.to_json().unwrap()).unwrap();
    std::fs::write(root.join("key"), hex::encode(ks[0].secret_bytes())).unwrap();
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let log = std::fs::File::create(root.join("node.log")).unwrap();
    let child = std::process::Command::new(env!("CARGO_BIN_EXE_cosign"))
        .arg("--chain")
        .arg(root.join("chain.json"))
        .arg("--dir")
        .arg(&dir)
        .arg("--key-file")
        .arg(root.join("key"))
        .arg("--port")
        .arg(port.to_string())
        .args(["--interval", "3600"])
        .stdout(log.try_clone().unwrap())
        .stderr(log)
        .spawn()
        .unwrap();
    struct Kill(std::process::Child);
    impl Drop for Kill {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let _child = Kill(child);
    for _ in 0..100 {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let dat = dir.join("blocks.dat");
    let offset = std::fs::metadata(&dat).unwrap().len();
    let bytes = bitcoin::consensus::serialize(&sealed);
    std::fs::OpenOptions::new()
        .append(true)
        .open(&dat)
        .unwrap()
        .write_all(&bytes)
        .unwrap();
    let response = get(
        port,
        "/blocks.dat",
        &format!(
            "Range: bytes={}-{}\r\n",
            offset,
            offset + bytes.len() as u64 - 1
        ),
    );
    let split = response.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
    assert_eq!(&response[split..], bytes);
    let tip = String::from_utf8(get(port, "/tip", "")).unwrap();
    assert!(tip.contains("\"height\":0"));
    println!("AUDIT HTTP unindexed sealed h1 served byte-for-byte={} bytes; /tip height=0; local-file append required",bytes.len());
}

#[tokio::test]
async fn audit_wss_support() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { listener.accept().await.unwrap() });
    let error = tokio_tungstenite::connect_async(format!("wss://{addr}"))
        .await
        .unwrap_err();
    println!("AUDIT WSS connection error={error}");
    assert!(error.to_string().contains("TLS support not compiled in"));
    drop(task.await.unwrap());
}

#[tokio::test]
async fn audit_subscription_filter() {
    use futures_util::StreamExt;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let before = sidestr_round::relay::unix_now();
    let _rx = sidestr_round::relay::follow(
        vec![format!("ws://{addr}")],
        vec![23510, 23511, 23512, 23513, 23514],
        600,
        |_| {},
    );
    let (stream, _) = listener.accept().await.unwrap();
    let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
    for kind in [23510, 23511, 23512, 23513, 23514] {
        let msg = ws.next().await.unwrap().unwrap();
        let text = msg.to_text().unwrap();
        let v: serde_json::Value = serde_json::from_str(text).unwrap();
        assert_eq!(v[2]["kinds"], serde_json::json!([kind]));
        assert_eq!(v[2].as_object().unwrap().len(), 2);
        let since = v[2]["since"].as_u64().unwrap();
        assert!((before - 600..=sidestr_round::relay::unix_now() - 600).contains(&since));
        println!("AUDIT Rust actual subscription {text}");
    }
}
