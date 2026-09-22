//! Acceptance 4: the two engines accept each other's blocks. Needs the
//! reference checkouts, named by `SIDESTR_SIDING`, `SCHEMA` and
//! `BLAKETESTNODE`; without them the test reports itself skipped and passes.
//! Both directions use the trial fixture (document and disposable key) so the
//! genesis is the same sealed block on both sides.

use std::path::PathBuf;
use std::process::Command;

use sidestr_core::block::key_from_hex;
use sidestr_core::chain::Chain;
use sidestr_core::document::ChainDocument;

fn fixture(f: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures/trial")
        .join(f)
}

fn js(cmd: &str, dir: &std::path::Path, with_key: bool) -> serde_json::Value {
    let mut c = Command::new("node");
    c.arg(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/xcheck.mjs"))
        .arg(cmd)
        .arg(fixture("chain.json"))
        .arg(dir);
    if with_key {
        c.arg(fixture("trial.key"));
    }
    let out = c.output().expect("node");
    assert!(
        out.status.success(),
        "reference engine failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).expect("json from the reference engine")
}

#[test]
fn rust_and_js_accept_each_others_blocks() {
    if ["SIDESTR_SIDING", "SCHEMA", "BLAKETESTNODE"]
        .iter()
        .any(|v| std::env::var(v).is_err())
    {
        eprintln!("skipped: set SIDESTR_SIDING, SCHEMA and BLAKETESTNODE to run the interop check");
        return;
    }
    let doc =
        ChainDocument::from_json(&std::fs::read_to_string(fixture("chain.json")).unwrap()).unwrap();
    let key = key_from_hex(&std::fs::read_to_string(fixture("trial.key")).unwrap()).unwrap();
    let base = std::env::temp_dir().join(format!("sidestr-interop-{}", std::process::id()));

    // Rust produces, JS validates
    let a = base.join("rust-produces");
    let mut chain = Chain::open(doc.clone(), &a, Some(&key)).unwrap();
    let r = chain.produce(&key, vec![]).unwrap();
    assert_eq!(r.height, 1);
    let v = js("replay", &a, false);
    assert_eq!(v["height"], 1, "{v}");
    assert_eq!(v["tip"], r.hash.to_string(), "{v}");
    assert_eq!(v["genesisHash"], doc.genesis_hash.clone().unwrap());

    // JS produces, Rust validates
    let b = base.join("js-produces");
    let v = js("produce", &b, true);
    assert_eq!(v["height"], 1, "{v}");
    let chain = Chain::open(doc.clone(), &b, None).unwrap();
    assert_eq!(chain.state().height(), 1);
    assert_eq!(
        chain.state().tip().hash.to_string(),
        v["hash"].as_str().unwrap()
    );
    // and the same block, fed by hand, is a duplicate height: refused by name, not silently
    let bytes =
        sidestr_core::blockfile::read_block(chain.dat_path(), &chain.index().blocks[1]).unwrap();
    let mut chain = chain;
    assert!(chain
        .add_block(&bytes, None)
        .unwrap_err()
        .to_string()
        .contains("apply 1 at height 1"));
    std::fs::remove_dir_all(&base).unwrap();
}
