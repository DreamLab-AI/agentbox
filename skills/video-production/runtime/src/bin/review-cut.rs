//! Assemble a fixed-clock diagnostic edit from hashed media and producer receipts.
//!
//! Usage: `review-cut [--root DIR] PLAN NEW_DIR`. The plan declares the clock
//! and canvas; clips must partition every delivery frame. This accepts inherited
//! footage explicitly; it never claims that it was rebaked. Paths are relative
//! to the production root and receipts record root-relative paths only.
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    error::Error,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use video_production_runtime::{
    clock::{FrameInterval, RationalRate},
    comfy::sha256_hex,
    paths::{Root, take_root_option},
};
type Result<T> = std::result::Result<T, Box<dyn Error>>;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Asset {
    path: PathBuf,
    sha256: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Clip {
    id: String,
    delivery: [u32; 2],
    source_start: u32,
    media: Asset,
    producer: Asset,
    status: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Clock {
    rate: RationalRate,
    frames: u32,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Resolution {
    width: u32,
    height: u32,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Plan {
    schema: String,
    clock: Clock,
    resolution: Resolution,
    clips: Vec<Clip>,
    status: String,
}
fn sha(path: &Path) -> Result<String> {
    Ok(sha256_hex(&fs::read(path)?))
}
fn checked(a: &Asset) -> Result<()> {
    if sha(&a.path)? != a.sha256 {
        return Err(format!("stale asset {}", a.path.display()).into());
    }
    Ok(())
}
fn call(c: &mut Command) -> Result<Vec<u8>> {
    let o = c.output()?;
    if !o.status.success() {
        return Err(String::from_utf8_lossy(&o.stderr).into_owned().into());
    }
    Ok(o.stdout)
}
fn probe(path: &Path) -> Result<Value> {
    Ok(serde_json::from_slice::<Value>(&call(
        Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-count_frames",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=r_frame_rate,nb_read_frames,width,height",
                "-of",
                "json",
            ])
            .arg(path),
    )?)?["streams"][0]
        .clone())
}
// A producer must contain a single record binding this exact path and hash.
// Comfy receipts additionally require a completed output download, not an input.
fn binds(v: &Value, a: &Asset) -> bool {
    match v {
        Value::Object(o) => {
            (o.get("path").and_then(Value::as_str) == a.path.to_str()
                && o.get("sha256").and_then(Value::as_str) == Some(&a.sha256))
                || o.values().any(|v| binds(v, a))
        }
        Value::Array(v) => v.iter().any(|v| binds(v, a)),
        _ => false,
    }
}
/// The clips, in order, must tile `[0, frames)` exactly.
fn check_partition(plan: &Plan) -> Result<()> {
    if plan.schema != "review-cut/2" || plan.clips.is_empty() || plan.clock.frames == 0 {
        return Err("invalid review plan".into());
    }
    let (w, h) = (plan.resolution.width, plan.resolution.height);
    if w == 0 || h == 0 || !w.is_multiple_of(2) || !h.is_multiple_of(2) {
        return Err("resolution must be positive and even".into());
    }
    let tiles: Vec<_> = plan
        .clips
        .iter()
        .map(|c| FrameInterval::new(c.delivery[0].into(), c.delivery[1].into()))
        .collect::<std::result::Result<_, _>>()?;
    if !FrameInterval::tiles(&tiles, plan.clock.frames.into()) {
        return Err(format!(
            "clips must partition all {} delivery frames",
            plan.clock.frames
        )
        .into());
    }
    Ok(())
}
fn clip_evidence(root: &Root, clip: &Clip, probe: &Value) -> Result<Value> {
    Ok(
        json!({"id":clip.id,"delivery":clip.delivery,"source_start":clip.source_start,
        "media":{"path":root.rel(&clip.media.path)?,"sha256":clip.media.sha256},
        "producer":{"path":root.rel(&clip.producer.path)?,"sha256":clip.producer.sha256},
        "probe":probe,"status":clip.status}),
    )
}
fn validate(root: &Root, plan: &Plan) -> Result<Vec<Value>> {
    check_partition(plan)?;
    let mut evidence = Vec::new();
    for clip in &plan.clips {
        checked(&clip.media)?;
        checked(&clip.producer)?;
        let producer: Value = serde_json::from_slice(&fs::read(&clip.producer.path)?)?;
        let bound = if producer.get("state").is_some() {
            producer["state"] == "completed"
                && producer["downloads"].as_array().is_some_and(|rows| {
                    rows.iter()
                        .any(|row| row["type"] == "output" && binds(row, &clip.media))
                })
        } else {
            binds(&producer, &clip.media)
        };
        if !bound {
            return Err(format!("producer does not bind media: {}", clip.id).into());
        }
        let p = probe(&clip.media.path)?;
        let n: u32 = p["nb_read_frames"]
            .as_str()
            .ok_or("missing decoded count")?
            .parse()?;
        if !p["r_frame_rate"]
            .as_str()
            .is_some_and(|r| plan.clock.rate.matches_probe(r))
            || n < clip
                .source_start
                .checked_add(clip.delivery[1] - clip.delivery[0])
                .ok_or("frame overflow")?
        {
            return Err("source timing or decoded coverage differs".into());
        }
        evidence.push(clip_evidence(root, clip, &p)?);
    }
    Ok(evidence)
}
fn clip_filter(i: usize, clip: &Clip, plan: &Plan) -> String {
    let (w, h) = (plan.resolution.width, plan.resolution.height);
    format!(
        "[{i}:v]trim=start_frame={}:end_frame={},settb=AVTB,setpts={},scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v{i}]",
        clip.source_start,
        clip.source_start + clip.delivery[1] - clip.delivery[0],
        plan.clock.rate.setpts_expr()
    )
}
fn run() -> Result<()> {
    let mut args: Vec<OsString> = std::env::args_os().skip(1).collect();
    let root = Root::new(&take_root_option(&mut args)?)?;
    if args.len() != 2 {
        return Err("usage: review-cut [--root DIR] PLAN NEW_DIR".into());
    }
    std::env::set_current_dir(root.dir())?;
    let path = Path::new(&args[0]);
    let out = Path::new(&args[1]);
    if out.exists() {
        return Err("output must be new".into());
    }
    let p: Plan = serde_json::from_slice(&fs::read(path)?)?;
    let evidence = validate(&root, &p)?;
    let (frames, rate) = (p.clock.frames, p.clock.rate);
    fs::create_dir(out)?;
    let dest = out.join("provisional-master.mp4");
    let mut c = Command::new("ffmpeg");
    c.args(["-v", "error", "-filter_complex_threads", "2"]);
    let mut filters = Vec::new();
    for (i, clip) in p.clips.iter().enumerate() {
        c.arg("-i").arg(&clip.media.path);
        filters.push(clip_filter(i, clip, &p));
    }
    filters.push(format!(
        "{}concat=n={}:v=1:a=0[out]",
        (0..p.clips.len())
            .map(|i| format!("[v{i}]"))
            .collect::<String>(),
        p.clips.len()
    ));
    let graph = filters.join(";");
    fs::write(out.join("cut.ffgraph"), &graph)?;
    call(
        c.args([
            "-filter_complex",
            &graph,
            "-map",
            "[out]",
            "-an",
            "-frames:v",
            &frames.to_string(),
            "-r",
            &rate.ffmpeg_rate(),
            "-c:v",
            "libx264",
            "-threads",
            "4",
            "-crf",
            "18",
            "-preset",
            "medium",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
        ])
        .arg(&dest),
    )?;
    let result = probe(&dest)?;
    if result["nb_read_frames"]
        .as_str()
        .and_then(|n| n.parse::<u32>().ok())
        != Some(frames)
        || !result["r_frame_rate"]
            .as_str()
            .is_some_and(|r| rate.matches_probe(r))
        || result["width"] != p.resolution.width
        || result["height"] != p.resolution.height
    {
        let _ = fs::remove_file(&dest);
        return Err("output clock or canvas differs".into());
    }
    fs::write(
        out.join("complete.json"),
        serde_json::to_vec_pretty(&json!({"schema":"review-cut-result/2",
        "plan":{"path":root.rel(path)?,"sha256":sha(path)?},"rate":rate,"frames":frames,"clips":evidence,
        "output":{"path":root.rel(&dest)?,"sha256":sha(&dest)?,"probe":result},"status":p.status,
        "production_accepted":false,"audio":"silent diagnostic picture; no final dialogue or audio acceptance"}))?,
    )?;
    println!("{frames}-frame diagnostic edit assembled with explicit source lineage");
    Ok(())
}
fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use video_production_runtime::paths::absolute_paths;

    fn plan(frames: u32, rate: Value, clips: Value) -> Plan {
        serde_json::from_value(
            json!({"schema":"review-cut/2","clock":{"rate":rate,"frames":frames},
            "resolution":{"width":640,"height":360},"clips":clips,"status":"diagnostic"}),
        )
        .unwrap()
    }
    fn clip(id: &str, delivery: [u32; 2]) -> Value {
        let asset = json!({"path":"m.mp4","sha256":"x"});
        json!({"id":id,"delivery":delivery,"source_start":5,"media":asset,"producer":asset,"status":"inherited"})
    }

    #[test]
    fn clips_must_partition_the_declared_frame_count() {
        let good = plan(
            90,
            json!(25),
            json!([clip("a", [0, 40]), clip("b", [40, 90])]),
        );
        assert!(check_partition(&good).is_ok());
        for clips in [
            json!([clip("a", [0, 40]), clip("b", [41, 90])]),
            json!([clip("a", [0, 40]), clip("b", [40, 91])]),
            json!([clip("a", [0, 40]), clip("b", [40, 80])]),
            json!([clip("b", [40, 90]), clip("a", [0, 40])]),
            json!([]),
        ] {
            assert!(check_partition(&plan(90, json!(25), clips)).is_err());
        }
        let mut odd = plan(90, json!(25), json!([clip("a", [0, 90])]));
        odd.resolution.width = 641;
        assert!(check_partition(&odd).is_err());
    }

    #[test]
    fn filter_follows_declared_clock_and_canvas() {
        let p = plan(
            90,
            json!({"num":30000,"den":1001}),
            json!([clip("a", [0, 40]), clip("b", [40, 90])]),
        );
        let filter = clip_filter(1, &p.clips[1], &p);
        assert!(
            filter.contains("trim=start_frame=5:end_frame=55"),
            "{filter}"
        );
        assert!(filter.contains("setpts=N*1001/(30000*TB)"));
        assert!(filter.contains("scale=640:360") && filter.contains("pad=640:360"));
    }

    #[test]
    fn evidence_paths_are_root_relative() {
        let dir = std::env::temp_dir().join(format!("review-cut-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let root = Root::new(&dir).unwrap();
        let mut p = plan(90, json!(25), json!([clip("a", [0, 90])]));
        p.clips[0].media.path = root.dir().join("m.mp4"); // absolute on purpose
        p.clips[0].producer.path = PathBuf::from("producer.json");
        let record = clip_evidence(&root, &p.clips[0], &json!({})).unwrap();
        assert_eq!(record["media"]["path"], "m.mp4");
        assert!(absolute_paths(&record).is_empty());
        p.clips[0].media.path = std::env::temp_dir().join("elsewhere.mp4");
        assert!(clip_evidence(&root, &p.clips[0], &json!({})).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
