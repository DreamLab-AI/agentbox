//! Project supplied artwork onto native mesh faces through an entire clip.
//! Usage: planar-art CONFIG.json NEW_DIRECTORY. Native ownership gates every
//! layer; integer PNG composites verify pixels outside the combined alpha.
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
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
struct Print {
    texture: Option<Asset>,
    base_rgb: [u8; 3],
    status: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    /// Delivery frame rate every upstream receipt must share.
    rate: RationalRate,
    schema: String,
    native_world_sha256: String,
    surfaces: Asset,
    ownership_receipt: Asset,
    ownership_directory: PathBuf,
    plate: Asset,
    plate_provenance: Asset,
    plate_output_node: Option<String>,
    plate_start_frame: u32,
    master_start_frame: u32,
    delivery_frames: u32,
    prints: BTreeMap<String, Print>,
    native_layers: Option<NativeLayers>,
    status: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeLayers {
    receipt: Asset,
    directory: PathBuf,
    shadow_min_ratio: f64,
    shadow_noise_threshold_8bit: u8,
    shadow_radius_px: u32,
}
fn decode_srgb(v: u8) -> f64 {
    let n = f64::from(v) / 255.;
    if n <= 0.04045 {
        n / 12.92
    } else {
        ((n + 0.055) / 1.055).powf(2.4)
    }
}
fn encode_srgb(n: f64) -> u8 {
    let v = if n <= 0.0031308 {
        12.92 * n
    } else {
        1.055 * n.powf(1. / 2.4) - 0.055
    };
    (v * 255.).round().clamp(0., 255.) as u8
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
fn probe(p: &Path) -> Result<Value> {
    Ok(serde_json::from_slice::<Value>(&call(
        Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-count_frames",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,r_frame_rate,nb_read_frames",
                "-of",
                "json",
            ])
            .arg(p),
    )?)?["streams"][0]
        .clone())
}
fn encode_rgb(bytes: &[u8], size: &str, p: &Path) -> Result<()> {
    let mut c = Command::new("magick")
        .args([
            "-size",
            size,
            "-depth",
            "8",
            "rgb:-",
            "-define",
            "png:color-type=2",
        ])
        .arg(p)
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    c.stdin.take().ok_or("missing stdin")?.write_all(bytes)?;
    let r = c.wait_with_output()?;
    if !r.status.success() {
        return Err(String::from_utf8_lossy(&r.stderr).into_owned().into());
    }
    Ok(())
}
fn filename(v: &Value) -> Result<&str> {
    let s = v.as_str().ok_or("missing ownership filename")?;
    if Path::new(s).file_name().and_then(|v| v.to_str()) != Some(s) {
        return Err("ownership filename must be a basename".into());
    }
    Ok(s)
}
fn run(root: &Root, config_path: &Path, out: &Path) -> Result<()> {
    let c: Config = serde_json::from_slice(&fs::read(config_path)?)?;
    if c.schema != "planar-art/1"
        || c.delivery_frames == 0
        || c.master_start_frame
            .checked_add(c.delivery_frames)
            .is_none_or(|n| n > 675)
        || c.plate_start_frame.checked_add(c.delivery_frames).is_none()
        || c.status.trim().is_empty()
        || c.prints.is_empty()
        || out.exists()
    {
        return Err("invalid config or existing output".into());
    }
    for a in [
        &c.surfaces,
        &c.ownership_receipt,
        &c.plate,
        &c.plate_provenance,
    ] {
        check(a)?;
    }
    for print in c.prints.values() {
        if print.status.trim().is_empty() {
            return Err("missing artwork status".into());
        }
        if let Some(a) = &print.texture {
            check(a)?;
        }
    }
    let surfaces = read(&c.surfaces.path)?;
    let ids = read(&c.ownership_receipt.path)?;
    let provenance = read(&c.plate_provenance.path)?;
    if surfaces["schema"] != "planar-surfaces-export/1"
        || surfaces["source_scene_sha256"] != c.native_world_sha256
        || surfaces["source_unchanged"] != true
        || rate_from_json(&surfaces["fps"]) != Some(c.rate)
        || ids["source_scene_sha256"] != c.native_world_sha256
        || rate_from_json(&ids["fps"]) != Some(c.rate)
        || surfaces["ownership_receipt_sha256"] != c.ownership_receipt.sha256
        || surfaces["resolution"] != ids["resolution"]
    {
        return Err("surface/ownership world, receipt or clock differs".into());
    }
    let matching_plate = if let Some(node) = &c.plate_output_node {
        provenance["state"] == "completed"
            && provenance["downloads"].as_array().is_some_and(|all| {
                all.iter()
                    .filter(|v| {
                        v["node_id"] == *node
                            && v["type"] == "output"
                            && v["path"] == c.plate.path.to_string_lossy().as_ref()
                            && v["sha256"] == c.plate.sha256
                    })
                    .count()
                    == 1
            })
    } else {
        provenance["path"] == c.plate.path.to_string_lossy().as_ref()
            && provenance["sha256"] == c.plate.sha256
            && provenance["source_world_sha256"] == c.native_world_sha256
    };
    if !matching_plate {
        return Err("plate does not match its selected producer output".into());
    }
    let clock = probe(&c.plate.path)?;
    let available = clock["nb_read_frames"]
        .as_str()
        .and_then(|s| s.parse::<u32>().ok())
        .ok_or("missing plate frame count")?;
    if !clock["r_frame_rate"]
        .as_str()
        .is_some_and(|r| c.rate.matches_probe(r))
        || available < c.plate_start_frame + c.delivery_frames
    {
        return Err("plate clock/coverage differs".into());
    }
    let w = surfaces["resolution"][0].as_u64().ok_or("missing width")?;
    let h = surfaces["resolution"][1].as_u64().ok_or("missing height")?;
    if w == 0 || h == 0 || w > 4096 || h > 4096 {
        return Err("unsupported output canvas".into());
    }
    let size = format!("{w}x{h}");
    let frames = surfaces["frames"]
        .as_array()
        .ok_or("missing surface frames")?;
    if frames.len() != c.delivery_frames as usize {
        return Err("surface coverage differs".into());
    }
    let native = if let Some(layers) = &c.native_layers {
        check(&layers.receipt)?;
        let r = read(&layers.receipt.path)?;
        if r["schema"] != "native-product-layers/1"
            || r["source_scene_sha256"] != c.native_world_sha256
            || r["source_unchanged"] != true
            || rate_from_json(&r["fps"]) != Some(c.rate)
            || r["resolution"] != surfaces["resolution"]
            || r["card_motion_unchanged_between_passes"] != true
            || r["frames"].as_array().map(Vec::len) != Some(c.delivery_frames as usize)
            || !layers.shadow_min_ratio.is_finite()
            || !(0.1..=1.).contains(&layers.shadow_min_ratio)
            || layers.shadow_noise_threshold_8bit > 32
            || layers.shadow_radius_px > 128
        {
            return Err("invalid paired native layer provenance/policy".into());
        }
        for (i, row) in r["frames"].as_array().unwrap().iter().enumerate() {
            if row["master_frame"] != c.master_start_frame + i as u32 {
                return Err("native layer clock differs".into());
            }
            for pass in ["beauty", "clean"] {
                let p = layers.directory.join(filename(&row[pass]["file"])?);
                if sha(&p)?
                    != row[pass]["sha256"]
                        .as_str()
                        .ok_or("missing native layer hash")?
                {
                    return Err("changed native layer PNG".into());
                }
            }
        }
        Some(r)
    } else {
        None
    };
    for (i, frame) in frames.iter().enumerate() {
        if frame["master_frame"] != c.master_start_frame + i as u32 {
            return Err("surface frames are not the declared contiguous master interval".into());
        }
        let id_path = c
            .ownership_directory
            .join(filename(&frame["ownership_file"])?);
        if sha(&id_path)?
            != frame["ownership_sha256"]
                .as_str()
                .ok_or("missing ID hash")?
        {
            return Err("changed ownership PNG".into());
        }
        let source_frame = ids["frames"]
            .as_array()
            .ok_or("missing ID inventory")?
            .iter()
            .filter(|v| {
                v["master_frame"] == frame["master_frame"]
                    && v["file"] == frame["ownership_file"]
                    && v["sha256"] == frame["ownership_sha256"]
            })
            .count();
        if source_frame != 1 {
            return Err("surface ID does not match producer inventory".into());
        }
        let mut names = BTreeSet::new();
        for surface in frame["surfaces"].as_array().ok_or("missing surfaces")? {
            let object = surface["object"].as_str().ok_or("missing object name")?;
            if !names.insert(object)
                || !c.prints.contains_key(object)
                || surface["front_facing_cosine"]
                    .as_f64()
                    .is_none_or(|n| n <= 0.)
            {
                return Err("duplicate, unprinted or back-facing surface".into());
            }
            let label = surface["ownership_label"]
                .as_str()
                .ok_or("missing ownership label")?;
            if ids["extra_scene_labels"][label]["root"] != object
                || ids["palette_rgb_unit"][label] != surface["rgb_unit"]
            {
                return Err("surface ownership label differs".into());
            }
            let _: [[f64; 2]; 4] = serde_json::from_value(surface["quad_px_tl_tr_br_bl"].clone())?;
            let colour: [u8; 3] = serde_json::from_value(surface["rgb_unit"].clone())?;
            if colour.iter().any(|&v| v > 1) || colour == [0; 3] {
                return Err("invalid ID palette".into());
            }
        }
        if names.len() != c.prints.len() {
            return Err("artwork object set differs from projected surfaces".into());
        }
    }
    fs::create_dir(out)?;
    let plates = out.join("plates");
    let layers = out.join("layers");
    let composites = out.join("frames");
    let canonical = out.join("canonical");
    for p in [&plates, &layers, &composites, &canonical] {
        fs::create_dir(p)?;
    }
    let mut texture_sizes = BTreeMap::new();
    let mut canonical_paths = BTreeMap::new();
    for (index, (object, print)) in c.prints.iter().enumerate() {
        let target = canonical.join(format!("print-{index}.png"));
        let dimensions = if let Some(a) = &print.texture {
            let s = String::from_utf8(call(
                Command::new("magick")
                    .args(["identify", "-format", "%w %h"])
                    .arg(&a.path),
            )?)?;
            let n: Vec<u32> = s
                .split_whitespace()
                .map(str::parse)
                .collect::<std::result::Result<_, _>>()?;
            if n.len() != 2 || n.iter().any(|&n| !(2..=4096).contains(&n)) {
                return Err("invalid texture dimensions".into());
            }
            [n[0], n[1]]
        } else {
            [880, 560]
        };
        let colour = format!(
            "xc:rgb({},{},{})",
            print.base_rgb[0], print.base_rgb[1], print.base_rgb[2]
        );
        let mut cmd = Command::new("magick");
        cmd.args([
            "-size",
            &format!("{}x{}", dimensions[0], dimensions[1]),
            &colour,
        ]);
        if let Some(a) = &print.texture {
            cmd.arg(&a.path).args(["-compose", "Over", "-composite"]);
        }
        call(cmd.arg(&target))?;
        texture_sizes.insert(object.clone(), dimensions);
        canonical_paths.insert(object.clone(), target);
    }
    call(Command::new("ffmpeg").args(["-nostdin","-v","error","-i"]).arg(&c.plate.path).args(["-vf",&format!("trim=start_frame={}:end_frame={},setpts=PTS-STARTPTS,scale={w}:{h}:flags=lanczos",c.plate_start_frame,c.plate_start_frame+c.delivery_frames),"-frames:v",&c.delivery_frames.to_string(),"-start_number","0"]).arg(plates.join("plate-%04d.png")))?;
    let mut receipts = Vec::new();
    for (index, frame) in frames.iter().enumerate() {
        let plate = plates.join(format!("plate-{index:04}.png"));
        let original = pixels(&plate, "rgb")?;
        let id_path = c
            .ownership_directory
            .join(filename(&frame["ownership_file"])?);
        let ownership = pixels(&id_path, "rgb")?;
        if original.len() != w as usize * h as usize * 3 || ownership.len() != original.len() {
            return Err("decoded plate/ID canvas differs".into());
        }
        let mut composite = original.clone();
        let mut touched = vec![false; original.len() / 3];
        let mut body_pixels = 0;
        let mut shadow_pixels = 0;
        if let (Some(policy), Some(native)) = (&c.native_layers, &native) {
            let row = &native["frames"][index];
            let beauty = pixels(
                &policy.directory.join(filename(&row["beauty"]["file"])?),
                "rgb",
            )?;
            let clean = pixels(
                &policy.directory.join(filename(&row["clean"]["file"])?),
                "rgb",
            )?;
            if beauty.len() != original.len() || clean.len() != original.len() {
                return Err("native layer canvas differs".into());
            }
            let colours: Vec<[u8; 3]> = frame["surfaces"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| serde_json::from_value(s["rgb_unit"].clone()))
                .collect::<std::result::Result<_, _>>()?;
            let quads: Vec<[[f64; 2]; 4]> = frame["surfaces"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| serde_json::from_value(s["quad_px_tl_tr_br_bl"].clone()))
                .collect::<std::result::Result<_, _>>()?;
            let radius = f64::from(policy.shadow_radius_px);
            let x0 = quads
                .iter()
                .flatten()
                .map(|p| p[0])
                .fold(f64::INFINITY, f64::min)
                - radius;
            let x1 = quads
                .iter()
                .flatten()
                .map(|p| p[0])
                .fold(f64::NEG_INFINITY, f64::max)
                + radius;
            let y0 = quads
                .iter()
                .flatten()
                .map(|p| p[1])
                .fold(f64::INFINITY, f64::min)
                - radius;
            let y1 = quads
                .iter()
                .flatten()
                .map(|p| p[1])
                .fold(f64::NEG_INFINITY, f64::max)
                + radius;
            for (i, touched_pixel) in touched.iter_mut().enumerate() {
                let j = i * 3;
                if colours.iter().any(|rgb| {
                    ownership[j..j + 3]
                        .iter()
                        .zip(rgb)
                        .all(|(&v, &c)| v.abs_diff(c * 255) < 64)
                }) {
                    composite[j..j + 3].copy_from_slice(&beauty[j..j + 3]);
                    *touched_pixel = true;
                    body_pixels += 1;
                    continue;
                }
                let x = (i % w as usize) as f64;
                let y = (i / w as usize) as f64;
                if x < x0 || x > x1 || y < y0 || y > y1 {
                    continue;
                }
                let weights = [0.2126, 0.7152, 0.0722];
                let luma8 = |p: &[u8]| {
                    p.iter()
                        .zip(weights)
                        .map(|(&v, a)| f64::from(v) * a)
                        .sum::<f64>()
                };
                if luma8(&clean[j..j + 3]) - luma8(&beauty[j..j + 3])
                    <= f64::from(policy.shadow_noise_threshold_8bit)
                {
                    continue;
                }
                let luma = |p: &[u8]| {
                    p.iter()
                        .zip(weights)
                        .map(|(&v, a)| decode_srgb(v) * a)
                        .sum::<f64>()
                };
                let denominator = luma(&clean[j..j + 3]);
                if denominator < 1e-5 {
                    continue;
                }
                let ratio =
                    (luma(&beauty[j..j + 3]) / denominator).clamp(policy.shadow_min_ratio, 1.);
                if ratio >= 1. {
                    continue;
                }
                for channel in 0..3 {
                    composite[j + channel] =
                        encode_srgb(decode_srgb(composite[j + channel]) * ratio);
                }
                *touched_pixel = true;
                shadow_pixels += 1;
            }
        }
        let mut printed = vec![false; touched.len()];
        let mut painted = BTreeMap::new();
        for (layer_index, surface) in frame["surfaces"].as_array().unwrap().iter().enumerate() {
            let object = surface["object"].as_str().unwrap();
            let quad: [[f64; 2]; 4] =
                serde_json::from_value(surface["quad_px_tl_tr_br_bl"].clone())?;
            if quad.iter().flatten().any(|v| !v.is_finite()) {
                return Err("nonfinite projection".into());
            }
            let [tw, th] = texture_sizes[object];
            let source = [
                [0., 0.],
                [f64::from(tw - 1), 0.],
                [f64::from(tw - 1), f64::from(th - 1)],
                [0., f64::from(th - 1)],
            ];
            let map = source
                .iter()
                .zip(quad)
                .map(|(a, b)| format!("{},{} {},{}", a[0], a[1], b[0], b[1]))
                .collect::<Vec<_>>()
                .join(" ");
            let warped = layers.join(format!("layer-{index:04}-{layer_index}.png"));
            call(
                Command::new("magick")
                    .arg(&canonical_paths[object])
                    .args([
                        "-alpha",
                        "set",
                        "-virtual-pixel",
                        "transparent",
                        "-define",
                        &format!("distort:viewport={w}x{h}+0+0"),
                        "-distort",
                        "Perspective",
                        &map,
                    ])
                    .arg(&warped),
            )?;
            let rgba = pixels(&warped, "rgba")?;
            if rgba.len() != touched.len() * 4 {
                return Err("warped layer canvas differs".into());
            }
            let rgb: [u8; 3] = serde_json::from_value(surface["rgb_unit"].clone())?;
            let mut count = 0;
            for i in 0..touched.len() {
                if !ownership[i * 3..i * 3 + 3]
                    .iter()
                    .zip(rgb)
                    .all(|(&v, c)| v.abs_diff(c * 255) < 64)
                {
                    continue;
                }
                let a = u32::from(rgba[i * 4 + 3]);
                if a == 0 {
                    continue;
                }
                if printed[i] {
                    return Err("ownership masks overlap in final composite".into());
                }
                touched[i] = true;
                printed[i] = true;
                count += 1;
                for channel in 0..3 {
                    let j = i * 3 + channel;
                    composite[j] = ((u32::from(composite[j]) * (255 - a)
                        + u32::from(rgba[i * 4 + channel]) * a
                        + 127)
                        / 255) as u8;
                }
            }
            painted.insert(object, count);
        }
        let output = composites.join(format!("frame-{index:04}.png"));
        encode_rgb(&composite, &size, &output)?;
        let saved = pixels(&output, "rgb")?;
        if saved != composite {
            return Err("saved integer composite differs".into());
        }
        let outside = touched.iter().filter(|&&v| !v).count();
        let changed_outside = touched
            .iter()
            .enumerate()
            .filter(|&(i, v)| !*v && original[i * 3..i * 3 + 3] != saved[i * 3..i * 3 + 3])
            .count();
        if outside == 0 || changed_outside != 0 {
            return Err("outside-art pixel preservation failed".into());
        }
        receipts.push(json!({"master_frame":frame["master_frame"],"plate":asset(&plate)?,"output":asset(&output)?,"painted_pixels_by_object":painted,"native_body_pixels":body_pixels,"approximate_shadow_pixels":shadow_pixels,"outside_alpha_pixels":outside,"changed_outside_alpha_pixels":changed_outside}));
    }
    let movie = out.join("composite.mp4");
    call(
        Command::new("ffmpeg")
            .args([
                "-nostdin",
                "-v",
                "error",
                "-framerate",
                &c.rate.ffmpeg_rate(),
                "-i",
            ])
            .arg(composites.join("frame-%04d.png"))
            .args([
                "-frames:v",
                &c.delivery_frames.to_string(),
                "-c:v",
                "libx264",
                "-crf",
                "16",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
            ])
            .arg(&movie),
    )?;
    let clock = probe(&movie)?;
    if clock["nb_read_frames"]
        .as_str()
        .and_then(|s| s.parse::<u32>().ok())
        != Some(c.delivery_frames)
        || !clock["r_frame_rate"]
            .as_str()
            .is_some_and(|r| c.rate.matches_probe(r))
    {
        return Err("encoded composite clock differs".into());
    }
    let mut report = json!({"schema":"planar-art-result/1","config":asset(config_path)?,"native_world_sha256":c.native_world_sha256,"master_start_frame":c.master_start_frame,"delivery_frames":c.delivery_frames,"fps":c.rate,"resolution":[w,h],"source_plate":asset(&c.plate.path)?,"plate_provenance":asset(&c.plate_provenance.path)?,"surfaces":asset(&c.surfaces.path)?,"ownership_receipt":asset(&c.ownership_receipt.path)?,"native_layer_receipt":c.native_layers.as_ref().map(|p|asset(&p.receipt.path)).transpose()?,"shadow_transfer":"Optional local ratio from paired AgX LDR images, applied to linearised display RGB outside native cards; threshold/floor/radius declared in config. Appearance approximation, not a linear-radiance or contact-solve proof.","frames":receipts,"movie":asset(&movie)?,"probe":clock,"status":c.status,"production_accepted":false,"limits":"Artwork planes follow native geometry and visibility, not an inferred generated track. Unknown print uses declared neutral base. H264 movie is lossy; outside-alpha byte evidence applies to saved PNGs only. Review generated plane alignment, supplied art completeness and lighting."});
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
        return Err("usage: planar-art [--root DIR] CONFIG.json NEW_DIRECTORY".into());
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
    fn real_clip_respects_foreground_occlusion_and_rejects_changed_ids() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!("planar-art-{}-{nonce}", std::process::id()));
        fs::create_dir(&root).unwrap();
        let plate = root.join("plate.mkv");
        call(
            Command::new("ffmpeg")
                .args([
                    "-nostdin",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=blue:s=32x16:r=25",
                    "-frames:v",
                    "3",
                    "-c:v",
                    "ffv1",
                ])
                .arg(&plate),
        )
        .unwrap();
        let id_image = root.join("ids.png");
        call(
            Command::new("magick")
                .args([
                    "-size",
                    "32x16",
                    "xc:black",
                    "-fill",
                    "red",
                    "-draw",
                    "rectangle 0,0 15,15",
                ])
                .arg(&id_image),
        )
        .unwrap();
        let world = "a".repeat(64);
        let ids = root.join("ids-receipt.json");
        let rows: Vec<_> = (0..3)
            .map(
                |i| json!({"master_frame":100+i,"file":"ids.png","sha256":sha(&id_image).unwrap()}),
            )
            .collect();
        fs::write(&ids,serde_json::to_vec(&json!({"source_scene_sha256":world,"fps":25,"resolution":[32,16],"extra_scene_labels":{"card":{"root":"card"}},"palette_rgb_unit":{"card":[1,0,0]},"frames":rows})).unwrap()).unwrap();
        let surfaces = root.join("surfaces.json");
        let rows:Vec<_>=(0..3).map(|i|json!({"master_frame":100+i,"ownership_file":"ids.png","ownership_sha256":sha(&id_image).unwrap(),"surfaces":[{"object":"card","ownership_label":"card","rgb_unit":[1,0,0],"front_facing_cosine":1.,"quad_px_tl_tr_br_bl":[[0,0],[31,0],[31,15],[0,15]]}]})).collect();
        fs::write(&surfaces,serde_json::to_vec(&json!({"schema":"planar-surfaces-export/1","source_scene_sha256":world,"source_unchanged":true,"fps":25,"resolution":[32,16],"ownership_receipt_sha256":sha(&ids).unwrap(),"frames":rows})).unwrap()).unwrap();
        let provenance = root.join("plate-receipt.json");
        fs::write(
            &provenance,
            serde_json::to_vec(
                &json!({"path":plate,"sha256":sha(&plate).unwrap(),"source_world_sha256":world}),
            )
            .unwrap(),
        )
        .unwrap();
        let config = root.join("config.json");
        let mut value = json!({"schema":"planar-art/1","rate":25,"native_world_sha256":world,"surfaces":asset(&surfaces).unwrap(),"ownership_receipt":asset(&ids).unwrap(),"ownership_directory":root,"plate":asset(&plate).unwrap(),"plate_provenance":asset(&provenance).unwrap(),"plate_output_node":null,"plate_start_frame":0,"master_start_frame":100,"delivery_frames":3,"prints":{"card":{"texture":null,"base_rgb":[255,255,0],"status":"fixture"}},"status":"test"});
        fs::write(&config, serde_json::to_vec(&value).unwrap()).unwrap();
        let out = root.join("out");
        run(&test_root(), &config, &out).unwrap();
        assert_no_host_paths(&out);
        for i in 0..3 {
            let original = pixels(&out.join(format!("plates/plate-{i:04}.png")), "rgb").unwrap();
            let output = pixels(&out.join(format!("frames/frame-{i:04}.png")), "rgb").unwrap();
            assert_eq!(
                &output[(8 * 32 + 8) * 3..(8 * 32 + 8) * 3 + 3],
                &[255, 255, 0]
            );
            for y in 0..16 {
                for x in 16..32 {
                    let j = (y * 32 + x) * 3;
                    assert_eq!(output[j..j + 3], original[j..j + 3]);
                }
            }
        }
        let beauty = root.join("beauty.png");
        let clean = root.join("clean.png");
        call(
            Command::new("magick")
                .args([
                    "-size",
                    "32x16",
                    "xc:rgb(100,100,100)",
                    "-fill",
                    "rgb(50,50,50)",
                    "-draw",
                    "rectangle 20,4 24,12",
                ])
                .arg(&beauty),
        )
        .unwrap();
        call(
            Command::new("magick")
                .args(["-size", "32x16", "xc:rgb(100,100,100)"])
                .arg(&clean),
        )
        .unwrap();
        let native = root.join("layers.json");
        let rows:Vec<_>=(0..3).map(|i|json!({"master_frame":100+i,"beauty":{"file":"beauty.png","sha256":sha(&beauty).unwrap()},"clean":{"file":"clean.png","sha256":sha(&clean).unwrap()}})).collect();
        fs::write(&native,serde_json::to_vec(&json!({"schema":"native-product-layers/1","source_scene_sha256":world,"source_unchanged":true,"fps":25,"resolution":[32,16],"card_motion_unchanged_between_passes":true,"frames":rows})).unwrap()).unwrap();
        value["native_layers"] = json!({"receipt":asset(&native).unwrap(),"directory":root,"shadow_min_ratio":0.2,"shadow_noise_threshold_8bit":4,"shadow_radius_px":0});
        fs::write(&config, serde_json::to_vec(&value).unwrap()).unwrap();
        let with_shadows = root.join("with-shadows");
        run(&test_root(), &config, &with_shadows).unwrap();
        let shaded = pixels(&with_shadows.join("frames/frame-0000.png"), "rgb").unwrap();
        let plate = pixels(&with_shadows.join("plates/plate-0000.png"), "rgb").unwrap();
        assert!(shaded[(8 * 32 + 22) * 3 + 2] < 200);
        assert_eq!(
            shaded[(14 * 32 + 30) * 3..(14 * 32 + 30) * 3 + 3],
            plate[(14 * 32 + 30) * 3..(14 * 32 + 30) * 3 + 3]
        );
        fs::write(&id_image, b"changed native mask").unwrap();
        let bad = root.join("bad");
        assert!(run(&test_root(), &config, &bad).is_err());
        assert!(!bad.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
