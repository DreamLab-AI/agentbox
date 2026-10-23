//! Prepare bounded image-edit masks from verified native actor ownership.
//!
//! Usage: surface-masks CONFIG.json NEW_DIRECTORY. Both render receipts must
//! identify the same hashed world and master frame. ImageMagick performs only
//! decoding, resizing and mask morphology; inference remains in ComfyUI.
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    env,
    error::Error,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use video_production_runtime::clock::{RationalRate, rate_from_json};
use video_production_runtime::paths::{Root, take_root_option};
type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Asset {
    path: PathBuf,
    sha256: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct View {
    image: Asset,
    receipt: Asset,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Edit {
    owners: Vec<String>,
    #[serde(default)]
    envelope: Envelope,
    dilate_px: u32,
    blur_sigma: f64,
    other_actor_guard_px: u32,
}
#[derive(Default, Deserialize, serde::Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum Envelope {
    #[default]
    VisiblePixels,
    BoundingBox,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    /// Delivery frame rate every upstream receipt must share.
    rate: RationalRate,
    schema: String,
    native_scene: Asset,
    master_frame: u32,
    source: View,
    ownership: View,
    edits: BTreeMap<String, Edit>,
}
fn sha(p: &Path) -> Result<String> {
    Ok(format!("{:x}", Sha256::digest(fs::read(p)?)))
}
fn asset(p: &Path) -> Result<Value> {
    Ok(json!({"path":p,"sha256":sha(p)?}))
}
fn check(a: &Asset) -> Result<()> {
    if sha(&a.path)? != a.sha256 {
        return Err(format!("changed input {}", a.path.display()).into());
    }
    Ok(())
}
fn read(p: &Path) -> Result<Value> {
    Ok(serde_json::from_slice(&fs::read(p)?)?)
}
fn call(c: &mut Command) -> Result<Vec<u8>> {
    let r = c.output()?;
    if !r.status.success() {
        return Err(String::from_utf8_lossy(&r.stderr).into_owned().into());
    }
    Ok(r.stdout)
}
fn pixels(p: &Path, fmt: &str) -> Result<Vec<u8>> {
    call(
        Command::new("magick")
            .arg(p)
            .args(["-depth", "8", &format!("{fmt}:-")]),
    )
}
fn dimensions(p: &Path) -> Result<(u32, u32)> {
    let s = String::from_utf8(call(
        Command::new("magick")
            .args(["identify", "-format", "%w %h"])
            .arg(p),
    )?)?;
    let n: Vec<u32> = s
        .split_whitespace()
        .map(str::parse)
        .collect::<std::result::Result<_, _>>()?;
    if n.len() != 2 || n[0] == 0 || n[1] == 0 {
        return Err("invalid dimensions".into());
    }
    Ok((n[0], n[1]))
}
fn encode(mask: &[u8], size: &str, effects: &[String], p: &Path) -> Result<()> {
    let mut c = Command::new("magick")
        .args(["-size", size, "-depth", "8", "gray:-"])
        .args(effects)
        .arg(p)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()?;
    c.stdin.take().ok_or("missing stdin")?.write_all(mask)?;
    let r = c.wait_with_output()?;
    if !r.status.success() {
        return Err(String::from_utf8_lossy(&r.stderr).into_owned().into());
    }
    Ok(())
}
fn verify_view(v: &View, frame: u32, world: &str, rate: RationalRate) -> Result<Value> {
    check(&v.image)?;
    check(&v.receipt)?;
    let r = read(&v.receipt.path)?;
    if r["source_scene_sha256"] != world
        || rate_from_json(&r["fps"]) != Some(rate)
        || !(r["source_unchanged"] == true || r["source_unchanged_after_export"] == true)
    {
        return Err("render receipt has wrong world/clock or no unchanged-source witness".into());
    }
    let matched = r["frames"]
        .as_array()
        .ok_or("missing frame inventory")?
        .iter()
        .filter(|f| {
            f["master_frame"] == frame
                && f["sha256"] == v.image.sha256
                && f["file"].as_str() == v.image.path.file_name().and_then(|p| p.to_str())
        })
        .count();
    if matched != 1 {
        return Err("image does not uniquely match its master-frame receipt".into());
    }
    Ok(r)
}
fn safe(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
}
fn classify(rgb: &[u8], palette: &BTreeMap<String, [u8; 3]>) -> Option<String> {
    palette
        .iter()
        .find(|(_, colour)| {
            rgb.iter()
                .zip(colour.iter())
                .all(|(a, b)| a.abs_diff(*b) < 64)
        })
        .map(|(name, _)| name.clone())
}
fn run(root: &Root, config_path: &Path, out: &Path) -> Result<()> {
    let c: Config = serde_json::from_slice(&fs::read(config_path)?)?;
    if c.schema != "surface-masks/1" || c.edits.is_empty() || out.exists() {
        return Err("invalid config or output directory already exists".into());
    }
    check(&c.native_scene)?;
    verify_view(&c.source, c.master_frame, &c.native_scene.sha256, c.rate)?;
    let ids = verify_view(&c.ownership, c.master_frame, &c.native_scene.sha256, c.rate)?;
    if ids["scope"] != "assembly" {
        return Err("actor assembly IDs required".into());
    }
    let colours = ids["palette_rgb_unit"]
        .as_object()
        .ok_or("missing palette")?;
    let mut palette = BTreeMap::new();
    for (name, colour) in colours {
        let a = colour.as_array().ok_or("bad palette")?;
        if a.len() != 3 {
            return Err("bad palette dimensions".into());
        }
        let mut rgb = [0; 3];
        for i in 0..3 {
            rgb[i] = match a[i].as_f64() {
                Some(0.) => 0,
                Some(1.) => 255,
                _ => return Err("expected binary emission palette".into()),
            };
        }
        if rgb == [0; 3] || palette.values().any(|p| p == &rgb) {
            return Err("black/duplicate actor palette".into());
        }
        palette.insert(name.clone(), rgb);
    }
    for (id, e) in &c.edits {
        let unique: std::collections::BTreeSet<_> = e.owners.iter().collect();
        if !safe(id)
            || unique.len() != e.owners.len()
            || unique.is_empty()
            || e.owners.iter().any(|o| !palette.contains_key(o))
            || e.dilate_px > 64
            || e.other_actor_guard_px > 64
            || !e.blur_sigma.is_finite()
            || !(0.0..=16.).contains(&e.blur_sigma)
        {
            return Err("invalid edit name, owners or morphology".into());
        }
    }
    let (w, h) = dimensions(&c.ownership.image.path)?;
    let (sw, sh) = dimensions(&c.source.image.path)?;
    if u64::from(w) * u64::from(sh) != u64::from(h) * u64::from(sw) {
        return Err("source/ownership aspect ratios differ".into());
    }
    let raw = pixels(&c.ownership.image.path, "rgb")?;
    if raw.len() != w as usize * h as usize * 3 {
        return Err("unexpected ID pixel count".into());
    }
    let labels: Vec<_> = raw
        .as_chunks::<3>()
        .0
        .iter()
        .map(|p| classify(p, &palette))
        .collect();
    for e in c.edits.values() {
        if !labels
            .iter()
            .any(|l| l.as_ref().is_some_and(|o| e.owners.contains(o)))
        {
            return Err("edit has no visible native-owned pixels".into());
        }
    }
    fs::create_dir(out)?;
    let size = format!("{w}x{h}");
    let source = out.join("source.png");
    call(
        Command::new("magick")
            .arg(&c.source.image.path)
            .args([
                "-resize",
                &format!("{size}!"),
                "-define",
                "png:color-type=2",
            ])
            .arg(&source),
    )?;
    let mut reports = BTreeMap::new();
    for (id, e) in &c.edits {
        let owned: Vec<u8> = labels
            .iter()
            .map(|l| {
                if l.as_ref().is_some_and(|o| e.owners.contains(o)) {
                    255
                } else {
                    0
                }
            })
            .collect();
        let other: Vec<u8> = labels
            .iter()
            .map(|l| {
                if l.as_ref().is_some_and(|o| !e.owners.contains(o)) {
                    255
                } else {
                    0
                }
            })
            .collect();
        let seed = out.join(format!("{id}-native.png"));
        encode(&owned, &size, &[], &seed)?;
        let mut editable = owned.clone();
        if matches!(e.envelope, Envelope::BoundingBox) {
            let occupied: Vec<usize> = owned
                .iter()
                .enumerate()
                .filter_map(|(i, &v)| (v > 0).then_some(i))
                .collect();
            let width = w as usize;
            let x0 = occupied
                .iter()
                .map(|i| i % width)
                .min()
                .ok_or("empty edit")?;
            let x1 = occupied.iter().map(|i| i % width).max().unwrap();
            let y0 = occupied.iter().map(|i| i / width).min().unwrap();
            let y1 = occupied.iter().map(|i| i / width).max().unwrap();
            for y in y0..=y1 {
                for x in x0..=x1 {
                    editable[y * width + x] = 255;
                }
            }
        }
        let mut effects = Vec::new();
        if e.dilate_px > 0 {
            effects.extend([
                "-morphology".into(),
                "Dilate".into(),
                format!("Disk:{}", e.dilate_px),
            ]);
        }
        if e.blur_sigma > 0. {
            effects.extend(["-blur".into(), format!("0x{}", e.blur_sigma)]);
        }
        let sample = out.join(format!("{id}-sampling.png"));
        encode(&editable, &size, &effects, &sample)?;
        let mut guard_effects = Vec::new();
        if e.other_actor_guard_px > 0 {
            guard_effects.extend([
                "-morphology".into(),
                "Dilate".into(),
                format!("Disk:{}", e.other_actor_guard_px),
            ]);
        }
        let guard = out.join(format!("{id}-other-actor-guard.png"));
        encode(&other, &size, &guard_effects, &guard)?;
        let sampling = pixels(&sample, "gray")?;
        let protection = pixels(&guard, "gray")?;
        if sampling.len() != owned.len() || protection.len() != owned.len() {
            return Err("mask size mismatch".into());
        }
        let final_alpha: Vec<u8> = sampling
            .iter()
            .zip(&protection)
            .map(|(&a, &p)| if p > 0 { 0 } else { a })
            .collect();
        let final_path = out.join(format!("{id}-final.png"));
        encode(&final_alpha, &size, &[], &final_path)?;
        if pixels(&final_path, "gray")? != final_alpha {
            return Err("saved final alpha differs".into());
        }
        reports.insert(id,json!({"owners":e.owners,"envelope":e.envelope,"native_pixels":owned.iter().filter(|&&v|v>0).count(),"dilate_px":e.dilate_px,"blur_sigma":e.blur_sigma,"other_actor_guard_px":e.other_actor_guard_px,"native_seed":asset(&seed)?,"sampling_alpha":asset(&sample)?,"other_actor_guard":asset(&guard)?,"final_alpha":asset(&final_path)?,"protected_pixels":protection.iter().filter(|&&v|v>0).count()}));
    }
    let mut report = json!({"schema":"surface-masks-result/1","config":asset(config_path)?,"source_scene_sha256":c.native_scene.sha256,"master_frame":c.master_frame,"fps":c.rate,"source_render":asset(&c.source.image.path)?,"source_render_receipt":asset(&c.source.receipt.path)?,"native_ownership":asset(&c.ownership.image.path)?,"native_ownership_receipt":asset(&c.ownership.receipt.path)?,"include_strings":ids["include_strings"],"output_source":asset(&source)?,"resolution":[w,h],"edits":reports,"policy":"Native visible actor palette; channels within63of binary emission colour. Sampling alpha dilated/blurred; separate final alpha zeroes other actor pixels and guard. Sampling mask is not final alpha.","limitations":["Surface silhouettes may evolve within edit regions; mask bounds do not prove identity, grip or image conformance.","Source resizing is Lanczos appearance preparation, not new native geometry."]});
    root.relativise(&mut report)?;
    fs::write(
        out.join("complete.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    println!("{}", out.join("complete.json").display());
    Ok(())
}
fn main() -> Result<()> {
    let mut raw: Vec<std::ffi::OsString> = env::args_os().skip(1).collect();
    let root = Root::new(&take_root_option(&mut raw)?)?;
    let a = raw;
    if a.len() != 2 {
        return Err("usage: surface-masks [--root DIR] CONFIG.json NEW_DIRECTORY".into());
    }
    std::env::set_current_dir(root.dir())?;
    run(&root, Path::new(&a[0]), Path::new(&a[1]))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn test_root() -> Root {
        Root::new(&std::env::temp_dir()).unwrap()
    }
    /// The saved receipt must contain no absolute or escaping path.
    fn assert_no_host_paths(out: &Path) {
        let receipt: Value =
            serde_json::from_slice(&fs::read(out.join("complete.json")).unwrap()).unwrap();
        let leaks = video_production_runtime::paths::absolute_paths(&receipt);
        assert!(leaks.is_empty(), "host paths in receipt: {leaks:?}");
    }
    #[test]
    fn neighbouring_actor_is_protected_and_stale_provenance_rejects() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!("surface-masks-{}-{nonce}", std::process::id()));
        fs::create_dir(&root).unwrap();
        let world = root.join("scene.blend");
        fs::write(&world, b"fixture world").unwrap();
        let source = root.join("source-render.png");
        call(
            Command::new("magick")
                .args(["-size", "32x16", "xc:blue"])
                .arg(&source),
        )
        .unwrap();
        let ids = root.join("actor-ids.png");
        call(
            Command::new("magick")
                .args([
                    "-size",
                    "32x16",
                    "xc:black",
                    "-fill",
                    "red",
                    "-draw",
                    "rectangle 5,4 10,11",
                    "-fill",
                    "lime",
                    "-draw",
                    "rectangle 13,4 18,11",
                    "-fill",
                    "black",
                    "-draw",
                    "rectangle 7,6 8,9",
                ])
                .arg(&ids),
        )
        .unwrap();
        let mut receipts = Vec::new();
        for (i, image) in [&source, &ids].iter().enumerate() {
            let receipt = root.join(format!("receipt-{i}.json"));
            let value = json!({"source_scene_sha256":sha(&world).unwrap(),"fps":25,"source_unchanged":true,"scope":"assembly","include_strings":false,"palette_rgb_unit":{"actor-a":[1,0,0],"actor-b":[0,1,0]},"frames":[{"master_frame":60,"file":image.file_name().unwrap().to_str().unwrap(),"sha256":sha(image).unwrap()}]});
            fs::write(&receipt, serde_json::to_vec(&value).unwrap()).unwrap();
            receipts.push(receipt);
        }
        let config = root.join("config.json");
        let mut value = json!({"schema":"surface-masks/1","rate":25,"native_scene":asset(&world).unwrap(),"master_frame":60,"source":{"image":asset(&source).unwrap(),"receipt":asset(&receipts[0]).unwrap()},"ownership":{"image":asset(&ids).unwrap(),"receipt":asset(&receipts[1]).unwrap()},"edits":{"actor-a":{"owners":["actor-a"],"dilate_px":8,"blur_sigma":1.,"other_actor_guard_px":2}}});
        fs::write(&config, serde_json::to_vec(&value).unwrap()).unwrap();
        let out = root.join("good");
        run(&test_root(), &config, &out).unwrap();
        assert_no_host_paths(&out);
        let sample = pixels(&out.join("actor-a-sampling.png"), "gray").unwrap();
        let final_alpha = pixels(&out.join("actor-a-final.png"), "gray").unwrap();
        for y in 4..12 {
            for x in 13..19 {
                assert!(sample[y * 32 + x] > 0);
                assert_eq!(final_alpha[y * 32 + x], 0);
            }
        }
        assert!(final_alpha.iter().any(|&p| p > 0));
        value["edits"]["actor-a"]["envelope"] = json!("bounding_box");
        value["edits"]["actor-a"]["dilate_px"] = json!(0);
        value["edits"]["actor-a"]["blur_sigma"] = json!(0.);
        fs::write(&config, serde_json::to_vec(&value).unwrap()).unwrap();
        let envelope = root.join("envelope");
        run(&test_root(), &config, &envelope).unwrap();
        let original = pixels(&envelope.join("actor-a-native.png"), "gray").unwrap();
        let editable = pixels(&envelope.join("actor-a-final.png"), "gray").unwrap();
        assert_eq!(original[7 * 32 + 7], 0);
        assert_eq!(editable[7 * 32 + 7], 255);
        assert_eq!(editable[7 * 32 + 13], 0);
        value["master_frame"] = json!(61);
        fs::write(&config, serde_json::to_vec(&value).unwrap()).unwrap();
        let stale = root.join("stale-frame");
        assert!(run(&test_root(), &config, &stale).is_err());
        assert!(!stale.exists());
        value["master_frame"] = json!(60);
        value["native_scene"]["sha256"] = json!("wrong");
        fs::write(&config, serde_json::to_vec(&value).unwrap()).unwrap();
        let changed = root.join("stale-world");
        assert!(run(&test_root(), &config, &changed).is_err());
        assert!(!changed.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
