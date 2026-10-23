//! Rectify supplied planar artwork while retaining occluded areas as unknown.
//! Usage: art-extract CONFIG.json NEW_DIRECTORY. No generative reconstruction.
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    env,
    error::Error,
    fs,
    path::{Path, PathBuf},
    process::Command,
};
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
struct Item {
    source: Asset,
    source_quad_tl_tr_br_bl: [[f64; 2]; 4],
    occluding_polygons: Vec<Vec<[f64; 2]>>,
    texture_size: [u32; 2],
    source_design: String,
    status: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    schema: String,
    items: BTreeMap<String, Item>,
}
fn sha(p: &Path) -> Result<String> {
    Ok(format!("{:x}", Sha256::digest(fs::read(p)?)))
}
fn asset(p: &Path) -> Result<Value> {
    Ok(json!({"path":p,"sha256":sha(p)?}))
}
fn call(c: &mut Command) -> Result<Vec<u8>> {
    let r = c.output()?;
    if !r.status.success() {
        return Err(String::from_utf8_lossy(&r.stderr).into_owned().into());
    }
    Ok(r.stdout)
}
fn size(p: &Path) -> Result<[u32; 2]> {
    let s = String::from_utf8(call(
        Command::new("magick")
            .args(["identify", "-format", "%w %h"])
            .arg(p),
    )?)?;
    let v: Vec<u32> = s
        .split_whitespace()
        .map(str::parse)
        .collect::<std::result::Result<_, _>>()?;
    if v.len() != 2 {
        return Err("invalid image dimensions".into());
    }
    Ok([v[0], v[1]])
}
fn polygon(points: &[[f64; 2]]) -> String {
    format!(
        "polygon {}",
        points
            .iter()
            .map(|p| format!("{},{}", p[0], p[1]))
            .collect::<Vec<_>>()
            .join(" ")
    )
}
fn valid_quad(q: &[[f64; 2]; 4]) -> bool {
    let crosses: Vec<_> = (0..4)
        .map(|i| {
            let a = q[i];
            let b = q[(i + 1) % 4];
            let c = q[(i + 2) % 4];
            (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        })
        .collect();
    crosses.iter().all(|&v| v > 1e-6) || crosses.iter().all(|&v| v < -1e-6)
}
fn run(root: &Root, config_path: &Path, out: &Path) -> Result<()> {
    let c: Config = serde_json::from_slice(&fs::read(config_path)?)?;
    if c.schema != "art-extract/1" || c.items.is_empty() || out.exists() {
        return Err("invalid config or existing output".into());
    }
    let mut dimensions = BTreeMap::new();
    for (id, item) in &c.items {
        if id.is_empty()
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
            || item.status.trim().is_empty()
            || item.source_design.trim().is_empty()
            || item.texture_size.iter().any(|&n| !(2..=4096).contains(&n))
            || !valid_quad(&item.source_quad_tl_tr_br_bl)
        {
            return Err("invalid item, quad or texture size".into());
        }
        if sha(&item.source.path)? != item.source.sha256 {
            return Err("changed source artwork".into());
        }
        let [w, h] = size(&item.source.path)?;
        for p in item
            .source_quad_tl_tr_br_bl
            .iter()
            .chain(item.occluding_polygons.iter().flatten())
        {
            if !p[0].is_finite()
                || !p[1].is_finite()
                || p[0] < 0.
                || p[1] < 0.
                || p[0] >= f64::from(w)
                || p[1] >= f64::from(h)
            {
                return Err("artwork point outside source".into());
            }
        }
        if item.occluding_polygons.iter().any(|p| p.len() < 3) {
            return Err("invalid occlusion polygon".into());
        }
        dimensions.insert(id, [w, h]);
    }
    fs::create_dir(out)?;
    let mut results = BTreeMap::new();
    for (id, item) in &c.items {
        let [sw, sh] = dimensions[id];
        let [w, h] = item.texture_size;
        let mask = out.join(format!("{id}-source-known.png"));
        let mut cmd = Command::new("magick");
        cmd.args([
            "-size",
            &format!("{sw}x{sh}"),
            "xc:black",
            "-fill",
            "white",
            "-draw",
            &polygon(&item.source_quad_tl_tr_br_bl),
        ]);
        for p in &item.occluding_polygons {
            cmd.args(["-fill", "black", "-draw", &polygon(p)]);
        }
        call(cmd.arg(&mask))?;
        let target = [
            [0., 0.],
            [f64::from(w - 1), 0.],
            [f64::from(w - 1), f64::from(h - 1)],
            [0., f64::from(h - 1)],
        ];
        let mapping = item
            .source_quad_tl_tr_br_bl
            .iter()
            .zip(target)
            .map(|(a, b)| format!("{},{} {},{}", a[0], a[1], b[0], b[1]))
            .collect::<Vec<_>>()
            .join(" ");
        let texture = out.join(format!("{id}.png"));
        call(
            Command::new("magick")
                .arg(&item.source.path)
                .arg(&mask)
                .args([
                    "-alpha",
                    "off",
                    "-compose",
                    "CopyOpacity",
                    "-composite",
                    "-virtual-pixel",
                    "transparent",
                    "-define",
                    &format!("distort:viewport={w}x{h}+0+0"),
                    "-distort",
                    "Perspective",
                    &mapping,
                ])
                .arg(&texture),
        )?;
        if size(&texture)? != [w, h] {
            return Err("rectified canvas differs".into());
        }
        let alpha = call(
            Command::new("magick")
                .arg(&texture)
                .args(["-alpha", "extract", "-depth", "8", "gray:-"]),
        )?;
        if alpha.len() != w as usize * h as usize || !alpha.iter().any(|&v| v > 0) {
            return Err("empty or invalid known artwork alpha".into());
        }
        let opaque = alpha.iter().filter(|&&v| v == 255).count();
        let unknown = alpha.iter().filter(|&&v| v == 0).count();
        results.insert(id,json!({"source":asset(&item.source.path)?,"source_design":item.source_design,"source_quad_tl_tr_br_bl":item.source_quad_tl_tr_br_bl,"occluding_polygons":item.occluding_polygons,"source_known_mask":asset(&mask)?,"texture":asset(&texture)?,"texture_size":[w,h],"known_opaque_pixels":opaque,"unknown_transparent_pixels":unknown,"status":item.status,"extraction":"Perspective rectification of supplied pixels. Occluders masked before resampling; no hidden artwork invented. Source-photo lighting remains baked."}));
    }
    let mut report = json!({"schema":"art-extract-result/1","config":asset(config_path)?,"items":results,"production_accepted":false});
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
        return Err("usage: art-extract [--root DIR] CONFIG.json NEW_DIRECTORY".into());
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
    fn supplied_pixels_survive_and_occluded_pixels_stay_unknown() {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!("art-extract-{}-{n}", std::process::id()));
        fs::create_dir(&root).unwrap();
        let source = root.join("source.png");
        call(
            Command::new("magick")
                .args([
                    "-size",
                    "32x16",
                    "xc:red",
                    "-fill",
                    "lime",
                    "-draw",
                    "rectangle 12,4 20,12",
                ])
                .arg(&source),
        )
        .unwrap();
        let mut value = json!({"schema":"art-extract/1","items":{"card":{"source":asset(&source).unwrap(),"source_quad_tl_tr_br_bl":[[0,0],[31,0],[31,15],[0,15]],"occluding_polygons":[[[11,3],[21,3],[21,13],[11,13]]],"texture_size":[32,16],"source_design":"fixture","status":"known source with occlusion"}}});
        let config = root.join("config.json");
        fs::write(&config, serde_json::to_vec(&value).unwrap()).unwrap();
        let out = root.join("out");
        run(&test_root(), &config, &out).unwrap();
        assert_no_host_paths(&out);
        let rgba = call(
            Command::new("magick")
                .arg(out.join("card.png"))
                .args(["-depth", "8", "rgba:-"]),
        )
        .unwrap();
        assert_eq!(
            &rgba[(2 * 32 + 2) * 4..(2 * 32 + 2) * 4 + 4],
            &[255, 0, 0, 255]
        );
        assert_eq!(rgba[(8 * 32 + 16) * 4 + 3], 0);
        value["items"]["card"]["source"]["sha256"] = json!("changed");
        fs::write(&config, serde_json::to_vec(&value).unwrap()).unwrap();
        let bad = root.join("bad");
        assert!(run(&test_root(), &config, &bad).is_err());
        assert!(!bad.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
