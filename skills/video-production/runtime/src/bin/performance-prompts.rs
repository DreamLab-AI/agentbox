//! Compile source-pose observations and authored performance into timed prompts.
//!
//! This does not estimate motion from pixels or solve physics. It binds an
//! agent-authored interpretation to the actual versioned scene timeline, keeps
//! observations separate, and emits local seconds plus master frame ranges.
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, ffi::OsString, fs, io::Write, path::Path};
use video_production_runtime::{
    clock::RationalRate,
    paths::{Root, take_root_option},
};

type Result<T> = std::result::Result<T, String>;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Plan {
    schema: String,
    scene_plan_sha256: String,
    style: String,
    /// Sentence telling the video model what the supplied guide already fixes
    /// and what to preserve (it is written into every prompt).
    guide_instruction: String,
    beats: Vec<Beat>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Beat {
    beat_id: String,
    actors: Vec<String>,
    source: Source,
    observed_pose: String,
    inference: String,
    focus: String,
    phases: Vec<Phase>,
    constraints: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Source {
    path: String,
    sha256: String,
    asset_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Phase {
    end_fraction: f64,
    action: String,
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn required_text(text: &str) -> Result<()> {
    if text.trim().is_empty() {
        return Err("Empty performance description".into());
    }
    Ok(())
}

fn phase_ranges(phases: &[Phase], start: u64, end: u64) -> Result<Vec<[u64; 2]>> {
    let mut previous = 0.;
    let mut frame = start;
    let mut ranges = Vec::new();
    if end <= start || phases.is_empty() {
        return Err("Empty beat or phases".into());
    }
    for phase in phases {
        required_text(&phase.action)?;
        let fraction = phase.end_fraction;
        if !fraction.is_finite() || fraction <= previous || fraction > 1. {
            return Err("Phase fractions must increase to exactly 1".into());
        }
        let boundary = if fraction == 1. {
            end
        } else {
            start + ((end - start) as f64 * fraction).floor() as u64
        };
        if boundary <= frame {
            return Err("Phase collapses to zero delivery frames".into());
        }
        ranges.push([frame, boundary]);
        frame = boundary;
        previous = fraction;
    }
    if previous != 1. {
        return Err("Phases must cover the complete beat".into());
    }
    Ok(ranges)
}

fn compile(plan: Plan, scene: &Value) -> Result<Value> {
    if plan.schema != "performance-plan/2" || plan.beats.is_empty() {
        return Err("Unsupported/empty performance plan".into());
    }
    required_text(&plan.style)?;
    let rate: RationalRate = serde_json::from_value(scene["delivery"]["fps"].clone())
        .map_err(|_| "Scene has no positive frame rate")?;
    required_text(&plan.guide_instruction)?;
    let seconds = |frames: u64| -> Result<f64> {
        Ok(rate
            .duration_of(frames)
            .map_err(|e| e.to_string())?
            .as_f64())
    };
    let frames = scene["delivery"]["frames"]
        .as_u64()
        .ok_or("Scene has no frame count")?;
    let actors: BTreeSet<_> = scene["actors"]
        .as_array()
        .ok_or("Scene has no actors")?
        .iter()
        .filter_map(|a| a["id"].as_str())
        .collect();
    let timeline = scene["timeline"]
        .as_array()
        .ok_or("Scene has no timeline")?;
    let mut ids = BTreeSet::new();
    let mut result = Vec::new();
    for beat in plan.beats {
        if !ids.insert(beat.beat_id.clone()) {
            return Err(format!("Duplicate beat {}", beat.beat_id));
        }
        for text in [&beat.observed_pose, &beat.inference, &beat.focus] {
            required_text(text)?;
        }
        let track = timeline
            .iter()
            .find(|t| t["beat_id"].as_str() == Some(&beat.beat_id))
            .ok_or_else(|| format!("Unknown beat {}", beat.beat_id))?;
        if track["source_reference"].as_str() != Some(&beat.source.asset_id) {
            return Err(format!(
                "Source asset does not match scene beat {}",
                beat.beat_id
            ));
        }
        let start = track["frames"][0].as_u64().ok_or("Missing start frame")?;
        let end = track["frames"][1].as_u64().ok_or("Missing end frame")?;
        if end > frames || beat.actors.is_empty() || beat.constraints.is_empty() {
            return Err("Invalid beat interval or empty actors/constraints".into());
        }
        let mut unique = BTreeSet::new();
        for actor in &beat.actors {
            if !actors.contains(actor.as_str()) || !unique.insert(actor) {
                return Err(format!("Unknown or duplicate actor {actor}"));
            }
        }
        for constraint in &beat.constraints {
            required_text(constraint)?;
        }
        let ranges = phase_ranges(&beat.phases, start, end)?;
        let mut prompt = format!(
            "{}\nFocus: {}\n{}\n",
            plan.style, beat.focus, plan.guide_instruction
        );
        let mut phases = Vec::new();
        for (phase, range) in beat.phases.iter().zip(ranges) {
            let a = seconds(range[0] - start)?;
            let b = seconds(range[1] - start)?;
            prompt.push_str(&format!("{a:.3}–{b:.3} seconds: {}\n", phase.action));
            phases.push(json!({"master_frames":range,"local_seconds":[a,b],"action":phase.action}));
        }
        prompt.push_str(&format!("Preserve: {}", beat.constraints.join("; ")));
        result.push(json!({"beat_id":beat.beat_id,"actors":beat.actors,
            "source":{"asset_id":beat.source.asset_id,"path":beat.source.path,"sha256":beat.source.sha256},
            "observed_pose":beat.observed_pose,"authored_inference":beat.inference,
            "master_frames":[start,end],"duration_seconds":seconds(end-start)?,
            "phases":phases,"video_prompt":prompt,"focus":beat.focus,
            "constraints":beat.constraints,"status":"authored performance hypothesis; not measured source motion or validated dynamics"}));
    }
    Ok(
        json!({"schema":"performance-prompts/2","scene_plan_sha256":plan.scene_plan_sha256,
        "rate":rate,"delivery_frames":frames,"intervals":"start inclusive, end exclusive",
        "scope":"Selected beats only; remaining film beats are not omitted from the production target",
        "beats":result}),
    )
}

fn run() -> Result<()> {
    let mut raw: Vec<OsString> = std::env::args_os().skip(1).collect();
    let root = Root::new(&take_root_option(&mut raw).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let mut args = vec![String::new()];
    for arg in raw {
        args.push(arg.into_string().map_err(|_| "Arguments must be UTF-8")?);
    }
    if args.len() != 4 {
        return Err("Usage: performance-prompts [--root DIR] PLAN SCENE_PLAN NEW_OUTPUT".into());
    }
    // Every remaining path is relative to the production root.
    std::env::set_current_dir(root.dir()).map_err(|e| e.to_string())?;
    let plan_bytes = fs::read(&args[1]).map_err(|e| e.to_string())?;
    let scene_bytes = fs::read(&args[2]).map_err(|e| e.to_string())?;
    let plan: Plan = serde_json::from_slice(&plan_bytes).map_err(|e| e.to_string())?;
    if digest(&scene_bytes) != plan.scene_plan_sha256 {
        return Err("Stale scene plan hash".into());
    }
    // Source paths are relative to the production root (never absolute, so the
    // output carries no host path). Verify before emitting any prompt or output.
    for beat in &plan.beats {
        root.rel(Path::new(&beat.source.path))
            .map_err(|e| e.to_string())?;
        let bytes = fs::read(Path::new(&beat.source.path)).map_err(|e| e.to_string())?;
        if digest(&bytes) != beat.source.sha256 {
            return Err(format!("Changed source {}", beat.source.path));
        }
    }
    let mut result = compile(
        plan,
        &serde_json::from_slice(&scene_bytes).map_err(|e| e.to_string())?,
    )?;
    result["performance_plan_sha256"] = json!(digest(&plan_bytes));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&args[3])
        .map_err(|e| e.to_string())?;
    file.write_all(
        serde_json::to_string_pretty(&result)
            .map_err(|e| e.to_string())?
            .as_bytes(),
    )
    .map_err(|e| e.to_string())?;
    file.write_all(b"\n").map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn phases(values: &[f64]) -> Vec<Phase> {
        values
            .iter()
            .map(|v| Phase {
                end_fraction: *v,
                action: "small tilt".into(),
            })
            .collect()
    }
    #[test]
    fn fractional_phases_cover_odd_length_without_gaps() {
        assert_eq!(
            phase_ranges(&phases(&[0.2, 0.7, 1.]), 170, 235).unwrap(),
            vec![[170, 183], [183, 215], [215, 235]]
        );
    }
    #[test]
    fn bad_or_subframe_intervals_fail() {
        for p in [
            phases(&[0.5, 0.4, 1.]),
            phases(&[0.5]),
            phases(&[0.001, 1.]),
            phases(&[f64::NAN, 1.]),
        ] {
            assert!(phase_ranges(&p, 170, 235).is_err());
        }
    }
    #[test]
    fn unknown_cast_and_mismatched_source_are_rejected() {
        let source = json!({"schema":"performance-plan/2","scene_plan_sha256":"x","style":"studio style","guide_instruction":"Follow the guide; keep supports.","beats":[{
            "beat_id":"B05","actors":["actor-a"],"source":{"asset_id":"src.B05.I018","path":"unused","sha256":"x"},
            "observed_pose":"standing","inference":"authored tilt","focus":"eyes","phases":[{"end_fraction":1.,"action":"tilt"}],"constraints":["supports"]}]});
        let scene = json!({"delivery":{"fps":25,"frames":300},"actors":[{"id":"actor-a"}],"timeline":[{"beat_id":"B05","source_reference":"src.B05.I018","frames":[170,235]}]});
        assert!(compile(serde_json::from_value(source.clone()).unwrap(), &scene).is_ok());
        let mut bad = source.clone();
        bad["beats"][0]["actors"] = json!(["other"]);
        assert!(compile(serde_json::from_value(bad).unwrap(), &scene).is_err());
        let mut bad = source;
        bad["beats"][0]["source"]["asset_id"] = json!("wrong-source");
        assert!(compile(serde_json::from_value(bad).unwrap(), &scene).is_err());
    }
    #[test]
    fn prompt_uses_plan_instruction_and_exact_rate() {
        let plan = |instruction: &str| {
            json!({"schema":"performance-plan/2","scene_plan_sha256":"x","style":"studio style",
            "guide_instruction":instruction,"beats":[{"beat_id":"B05","actors":["actor-a"],
            "source":{"asset_id":"src.B05.I018","path":"unused","sha256":"x"},"observed_pose":"standing",
            "inference":"tilt","focus":"eyes","phases":[{"end_fraction":1.,"action":"tilt"}],"constraints":["supports"]}]})
        };
        let scene = json!({"delivery":{"fps":{"num":30000,"den":1001},"frames":300},"actors":[{"id":"actor-a"}],
            "timeline":[{"beat_id":"B05","source_reference":"src.B05.I018","frames":[30,60]}]});
        let out = compile(
            serde_json::from_value(plan("Camera follows the guide.")).unwrap(),
            &scene,
        )
        .unwrap();
        let beat = &out["beats"][0];
        assert!(
            beat["video_prompt"]
                .as_str()
                .unwrap()
                .contains("Camera follows the guide.")
        );
        // 30 frames at 30000/1001 last 1001/1000 s, not 1.2 s as at 25 fps.
        assert!((beat["duration_seconds"].as_f64().unwrap() - 1.001).abs() < 1e-9);
        assert_eq!(out["rate"], json!({"num":30000,"den":1001}));
        assert!(compile(serde_json::from_value(plan("  ")).unwrap(), &scene).is_err());
    }
}
