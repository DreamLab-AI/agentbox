//! Check the generated upstream snapshot without a second editable skill source.

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Component, Path};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Pin {
    schema: u32,
    version: String,
    revision: String,
    source_hash: String,
    repository: String,
    files: BTreeMap<String, String>,
    cargo_lock_sha256: String,
}

fn hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn digest_valid(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn inventory(
    root: &Path,
    directory: &Path,
    files: &mut BTreeMap<String, String>,
) -> Result<(), String> {
    for entry in std::fs::read_dir(directory).map_err(|e| format!("VisionCraft inventory: {e}"))? {
        let entry = entry.map_err(|e| format!("VisionCraft inventory entry: {e}"))?;
        let kind = entry
            .file_type()
            .map_err(|e| format!("VisionCraft file type: {e}"))?;
        if kind.is_dir() {
            inventory(root, &entry.path(), files)?;
        } else if kind.is_file() {
            let path = entry.path();
            let name = path
                .strip_prefix(root)
                .map_err(|_| "VisionCraft path escaped root")?
                .to_str()
                .ok_or("VisionCraft path is not UTF-8")?
                .replace('\\', "/");
            let data = std::fs::read(&path).map_err(|e| format!("VisionCraft file read: {e}"))?;
            files.insert(name, hex(&data));
        } else {
            return Err("VisionCraft snapshot contains a symlink or special file".into());
        }
    }
    Ok(())
}

pub(crate) fn check(root: &Path) -> Result<(), String> {
    let data = std::fs::read(root.join("config/visioncraft-source.json"))
        .map_err(|e| format!("VisionCraft source pin unavailable: {e}"))?;
    let pin: Pin =
        serde_json::from_slice(&data).map_err(|_| "VisionCraft source pin is malformed")?;
    if pin.schema != 1
        || pin.repository != "https://github.com/DreamLab-AI/visioncraft"
        || pin.version.split('.').count() != 3
        || !pin
            .version
            .split('.')
            .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
        || pin.revision.len() != 40
        || !pin.revision.bytes().all(|b| b.is_ascii_hexdigit())
        || !pin.source_hash.starts_with("sha256-")
        || pin.source_hash.len() != 51
        || !digest_valid(&pin.cargo_lock_sha256)
        || pin.files.is_empty()
    {
        return Err("VisionCraft source pin has invalid release metadata".into());
    }
    for (path, digest) in &pin.files {
        if !Path::new(path)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
            || path.contains('\\')
            || !digest_valid(digest)
        {
            return Err("VisionCraft source pin has an invalid path or digest".into());
        }
    }
    let skill = root.join("skills/visioncraft");
    if !std::fs::symlink_metadata(&skill)
        .map_err(|_| "VisionCraft skill snapshot missing")?
        .file_type()
        .is_dir()
    {
        return Err("VisionCraft skill snapshot must be a real directory".into());
    }
    let mut actual = BTreeMap::new();
    inventory(&skill, &skill, &mut actual)?;
    if actual != pin.files {
        return Err("VisionCraft snapshot differs from its release pin; update upstream, then re-vendor the complete released payload".into());
    }
    if root
        .join("skills/build-with-quality")
        .symlink_metadata()
        .is_ok()
    {
        return Err("retired build-with-quality skill still exists; hard cutover requires one canonical payload".into());
    }
    let lock = root.join(format!(
        "lib/lockfiles/visioncraft-{}.Cargo.lock",
        pin.version
    ));
    if !std::fs::symlink_metadata(&lock)
        .map_err(|_| "VisionCraft lockfile missing")?
        .file_type()
        .is_file()
    {
        return Err("VisionCraft lockfile must be a regular file".into());
    }
    if hex(&std::fs::read(&lock).map_err(|_| "VisionCraft lockfile unreadable")?)
        != pin.cargo_lock_sha256
    {
        return Err("VisionCraft lockfile differs from the pinned release".into());
    }
    println!(
        "VisionCraft {} source snapshot verified ({} files, {})",
        pin.version,
        actual.len(),
        pin.revision
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn edits_omissions_extras_aliases_and_symlinks_refuse() {
        let root = std::env::temp_dir().join(format!(
            "visioncraft-vendor-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(root.join("skills/visioncraft")).unwrap();
        std::fs::create_dir_all(root.join("lib/lockfiles")).unwrap();
        std::fs::create_dir_all(root.join("config")).unwrap();
        let skill = root.join("skills/visioncraft/SKILL.md");
        std::fs::write(&skill, "canonical").unwrap();
        std::fs::write(
            root.join("lib/lockfiles/visioncraft-0.1.0.Cargo.lock"),
            "lock",
        )
        .unwrap();
        let pin = json!({"schema":1,"version":"0.1.0","revision":"a".repeat(40),"source_hash":format!("sha256-{}=", "A".repeat(43)),"repository":"https://github.com/DreamLab-AI/visioncraft","files":{"SKILL.md":hex(b"canonical")},"cargo_lock_sha256":hex(b"lock")});
        std::fs::write(root.join("config/visioncraft-source.json"), pin.to_string()).unwrap();
        assert!(check(&root).is_ok());
        std::fs::write(&skill, "local fork").unwrap();
        assert!(check(&root).is_err());
        std::fs::remove_file(&skill).unwrap();
        assert!(check(&root).is_err());
        std::fs::write(&skill, "canonical").unwrap();
        std::fs::write(root.join("skills/visioncraft/extra"), "extra").unwrap();
        assert!(check(&root).is_err());
        std::fs::remove_file(root.join("skills/visioncraft/extra")).unwrap();
        std::fs::create_dir(root.join("skills/build-with-quality")).unwrap();
        assert!(check(&root).is_err());
        std::fs::remove_dir(root.join("skills/build-with-quality")).unwrap();
        #[cfg(unix)]
        {
            std::fs::remove_file(&skill).unwrap();
            std::os::unix::fs::symlink("../../config/visioncraft-source.json", &skill).unwrap();
            assert!(check(&root).is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
