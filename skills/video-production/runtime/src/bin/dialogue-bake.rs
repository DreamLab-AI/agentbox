//! Import recorded takes, derive editable Rhubarb cues, mix and describe a rebake.
//!
//! Originals remain untouched. This command never stretches a take or silently
//! changes shot timing: a recording outside its declared window is an error.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    error::Error,
    ffi::OsString,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};
use video_production_runtime::{
    clock::{RationalRate, rate_from_receipt},
    paths::{Root, take_root_option},
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
fn one() -> usize {
    1
}
#[derive(Deserialize)]
struct Session {
    schema: String,
    /// Master frame rate; a bare integer such as `25` is accepted.
    #[serde(alias = "fps")]
    rate: RationalRate,
    frames: usize,
    #[serde(default = "one")]
    mouth_hold_frames: usize,
    rhubarb_bin: PathBuf,
    cache_dir: PathBuf,
    takes: Vec<Take>,
    #[serde(default)]
    shots: Vec<Shot>,
}
#[derive(Deserialize)]
struct Take {
    id: String,
    speaker: String,
    actor: Option<String>,
    audio: PathBuf,
    transcript: String,
    start_frame: usize,
    max_end_frame: Option<usize>,
    status: String,
}
#[derive(Deserialize)]
struct Shot {
    id: String,
    frames: [usize; 2],
}
#[derive(Clone, Deserialize, Serialize)]
struct Cue {
    start: f64,
    end: f64,
    value: String,
}
#[derive(Deserialize)]
struct Alignment {
    #[serde(rename = "mouthCues")]
    cues: Vec<Cue>,
}
#[derive(Clone, Deserialize, Serialize)]
struct BakedTake {
    id: String,
    speaker: String,
    actor: Option<String>,
    status: String,
    start_frame: usize,
    end_frame: usize,
    duration_s: f64,
    original_path: String,
    original_sha256: String,
    canonical_path: String,
    transcript: String,
    cues: Vec<Cue>,
    fingerprint: String,
    cache_hit: bool,
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn hash(path: &Path) -> Result<String> {
    Ok(digest(&fs::read(path)?))
}
fn run(mut command: Command) -> Result<Output> {
    let output = command.output()?;
    if !output.status.success() {
        return Err(format!(
            "command failed ({:?}): {}",
            command.get_program(),
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    Ok(output)
}
fn duration(path: &Path) -> Result<f64> {
    let mut command = Command::new("ffprobe");
    command
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
        ])
        .arg(path);
    let value: Value = serde_json::from_slice(&run(command)?.stdout)?;
    let seconds: f64 = value["format"]["duration"]
        .as_str()
        .ok_or("missing waveform duration")?
        .parse()?;
    if !seconds.is_finite() || seconds <= 0. {
        return Err("invalid waveform duration".into());
    }
    Ok(seconds)
}
fn convert(input: &Path, output: &Path, rate: &str, channels: &str, codec: &str) -> Result<()> {
    let mut command = Command::new("ffmpeg");
    command
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"])
        .arg(input)
        .args(["-vn", "-ar", rate, "-ac", channels, "-c:a", codec])
        .arg(output);
    run(command)?;
    Ok(())
}

// Keep each take's samples independent of decoder packet sizes and other takes.
// The installed FFmpeg 9.0.2 amix failed our ten-take replacement check in both
// float and double formats. Use FFmpeg only for decoding/encoding this mix.
fn add_pcm(mix: &mut [f64], raw: &[u8], offset: usize) -> Result<()> {
    if !raw.len().is_multiple_of(4)
        || offset
            .checked_add(raw.len() / 4)
            .is_none_or(|end| end > mix.len())
    {
        return Err("decoded take exceeds fixed sample timeline".into());
    }
    for (i, bytes) in raw.as_chunks::<4>().0.iter().enumerate() {
        let sample = f32::from_le_bytes(*bytes);
        if !sample.is_finite() {
            return Err("non-finite audio sample".into());
        }
        mix[offset + i] += f64::from(sample);
    }
    Ok(())
}

/// Sample index of `frames` at 48 kHz on `rate`, rounded half up, in integers.
fn samples_at(frames: usize, rate: RationalRate) -> Result<usize> {
    let num = u128::from(rate.num());
    let value = (2 * frames as u128 * u128::from(rate.den()) * 48000 + num) / (2 * num);
    Ok(usize::try_from(value)?)
}

fn mix_takes(
    takes: &[BakedTake],
    root: &Root,
    frames: usize,
    rate: RationalRate,
    path: &Path,
) -> Result<()> {
    let samples = samples_at(frames, rate)?;
    let mut mix = vec![0_f64; samples.checked_mul(2).ok_or("audio length overflow")?];
    for take in takes {
        let mut decode = Command::new("ffmpeg");
        decode
            .args(["-v", "error", "-nostdin", "-i"])
            .arg(root.dir().join(&take.canonical_path))
            .args([
                "-vn",
                "-ar",
                "48000",
                "-ac",
                "2",
                "-c:a",
                "pcm_f32le",
                "-f",
                "f32le",
                "-",
            ]);
        let offset = samples_at(take.start_frame, rate)? * 2;
        add_pcm(&mut mix, &run(decode)?.stdout, offset)?;
    }
    let raw: Vec<u8> = mix.iter().flat_map(|s| (*s as f32).to_le_bytes()).collect();
    let mut child = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-nostdin",
            "-y",
            "-f",
            "f32le",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-i",
            "pipe:0",
            "-c:a",
            "pcm_f32le",
        ])
        .arg(path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()?;
    let written = child
        .stdin
        .take()
        .ok_or("missing encoder input")?
        .write_all(&raw);
    let output = child.wait_with_output()?;
    if !output.status.success() {
        return Err(format!(
            "audio encoding failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    written?;
    Ok(())
}
fn window(start: usize, seconds: f64, rate: RationalRate, limit: usize) -> Result<[usize; 2]> {
    if !seconds.is_finite() || seconds <= 0. {
        return Err("invalid take clock".into());
    }
    let end = start
        .checked_add((seconds * f64::from(rate.num()) / f64::from(rate.den())).ceil() as usize)
        .ok_or("take clock overflow")?;
    if end > limit {
        return Err(format!("take needs frames {start}..{end}, beyond declared end {limit}; retime the plan or supply another take").into());
    }
    Ok([start, end])
}
fn changed_ranges(
    old: &[BakedTake],
    new: &[BakedTake],
    frames: usize,
) -> (Vec<String>, Vec<[usize; 2]>) {
    let mut changed = BTreeSet::new();
    for take in old.iter().chain(new) {
        let before = old.iter().find(|t| t.id == take.id).map(|t| &t.fingerprint);
        let after = new.iter().find(|t| t.id == take.id).map(|t| &t.fingerprint);
        if before != after {
            changed.insert(take.id.clone());
        }
    }
    let mut ranges: Vec<[usize; 2]> = old
        .iter()
        .chain(new)
        .filter(|t| changed.contains(&t.id))
        .map(|t| {
            [
                t.start_frame.saturating_sub(2),
                t.end_frame.saturating_add(2).min(frames),
            ]
        })
        .collect();
    ranges.sort();
    let mut merged: Vec<[usize; 2]> = Vec::new();
    for range in ranges {
        if let Some(last) = merged.last_mut()
            && range[0] <= last[1]
        {
            last[1] = last[1].max(range[1]);
            continue;
        }
        merged.push(range);
    }
    (changed.into_iter().collect(), merged)
}

struct ClipImpact {
    affected_shots: Vec<String>,
    affected_ranges: Vec<[usize; 2]>,
    review_shots: Vec<String>,
    review_ranges: Vec<[usize; 2]>,
}
fn clip_impact(shots: &[Shot], ranges: &[[usize; 2]]) -> ClipImpact {
    let mut ordered: Vec<_> = shots.iter().collect();
    ordered.sort_by_key(|shot| shot.frames);
    let affected: BTreeSet<_> = ordered
        .iter()
        .enumerate()
        .filter(|(_, s)| {
            ranges
                .iter()
                .any(|r| s.frames[0] < r[1] && r[0] < s.frames[1])
        })
        .map(|(i, _)| i)
        .collect();
    let mut review = BTreeSet::new();
    for &i in &affected {
        review.extend(i.saturating_sub(1)..=(i + 1).min(ordered.len() - 1));
    }
    ClipImpact {
        affected_shots: affected.iter().map(|&i| ordered[i].id.clone()).collect(),
        affected_ranges: affected.iter().map(|&i| ordered[i].frames).collect(),
        review_shots: review.iter().map(|&i| ordered[i].id.clone()).collect(),
        review_ranges: review.iter().map(|&i| ordered[i].frames).collect(),
    }
}

fn main() -> Result<()> {
    let mut raw: Vec<OsString> = std::env::args_os().skip(1).collect();
    let root = Root::new(&take_root_option(&mut raw)?)?;
    let args: Vec<String> = raw
        .into_iter()
        .map(|s| s.into_string().map_err(|_| "arguments must be UTF-8"))
        .collect::<std::result::Result<_, _>>()?;
    if !(2..=3).contains(&args.len()) {
        return Err(
            "usage: dialogue-bake [--root DIR] SESSION.json OUT_DIR [PREVIOUS_BAKE.json]".into(),
        );
    }
    // Every remaining path is relative to the production root.
    std::env::set_current_dir(root.dir())?;
    let input = fs::read(&args[0])?;
    let session: Session = serde_json::from_slice(&input)?;
    if session.schema != "dialogue-session/1"
        || session.frames == 0
        || session.mouth_hold_frames == 0
        || session.takes.is_empty()
    {
        return Err("invalid dialogue session schema or clock".into());
    }
    let mut ids = BTreeSet::new();
    for take in &session.takes {
        if take.id.is_empty()
            || !take
                .id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
            || !ids.insert(&take.id)
            || take.transcript.trim().is_empty()
            || take.speaker.is_empty()
            || !["scratch", "approved"].contains(&take.status.as_str())
        {
            return Err(format!("invalid/duplicate take identity or status: {}", take.id).into());
        }
    }
    if Path::new(&args[1]).exists() {
        return Err("output directory already exists; choose a new bake version".into());
    }
    fs::create_dir_all(&args[1])?;
    fs::create_dir_all(&session.cache_dir)?;
    let output_dir = fs::canonicalize(&args[1])?;
    let cache_dir = fs::canonicalize(&session.cache_dir)?;
    let recognizer_hash = hash(&session.rhubarb_bin)?;
    let mut takes = Vec::new();
    for take in &session.takes {
        let original = fs::canonicalize(&take.audio)?;
        let audio_hash = hash(&original)?;
        let key = digest(
            serde_json::to_string(&json!([
                "dialogue-cache/1",
                audio_hash,
                take.transcript,
                recognizer_hash,
                "pocketSphinx",
                "GHX"
            ]))?
            .as_bytes(),
        );
        let cache = cache_dir.join(&key);
        fs::create_dir_all(&cache)?;
        let canonical = cache.join("canonical.wav");
        let alignment = cache.join("cues.json");
        let marker = cache.join("complete.json");
        let hit = if marker.is_file() && canonical.is_file() && alignment.is_file() {
            let value: Value = serde_json::from_slice(&fs::read(&marker)?)?;
            value["canonical_sha256"] == hash(&canonical)?
                && value["alignment_sha256"] == hash(&alignment)?
                && value["cache_key"] == key
        } else {
            false
        };
        if !hit {
            convert(&original, &canonical, "48000", "2", "pcm_f32le")?;
            convert(
                &original,
                &cache.join("recognizer.wav"),
                "16000",
                "1",
                "pcm_s16le",
            )?;
            fs::write(cache.join("transcript.txt"), &take.transcript)?;
            let mut command = Command::new(&session.rhubarb_bin);
            command
                .args([
                    "-f",
                    "json",
                    "-r",
                    "pocketSphinx",
                    "--extendedShapes",
                    "GHX",
                    "--threads",
                    "4",
                    "--machineReadable",
                    "-d",
                ])
                .arg(cache.join("transcript.txt"))
                .arg("-o")
                .arg(&alignment)
                .arg(cache.join("recognizer.wav"));
            let result = run(command)?;
            fs::write(cache.join("recognizer.log"), result.stderr)?;
            fs::write(
                &marker,
                serde_json::to_vec_pretty(
                    &json!({"cache_key":key,"original_sha256":audio_hash,"recognizer_sha256":recognizer_hash,
                "canonical_sha256":hash(&canonical)?,"alignment_sha256":hash(&alignment)?,"tempo_changed":false}),
                )?,
            )?;
        }
        let seconds = duration(&canonical)?;
        let [start, end] = window(
            take.start_frame,
            seconds,
            session.rate,
            take.max_end_frame
                .unwrap_or(session.frames)
                .min(session.frames),
        )?;
        let aligned: Alignment = serde_json::from_slice(&fs::read(&alignment)?)?;
        if aligned.cues.is_empty() {
            return Err(format!("empty Rhubarb alignment for {}", take.id).into());
        }
        let mut previous = 0.;
        for cue in &aligned.cues {
            if !cue.start.is_finite()
                || !cue.end.is_finite()
                || cue.start < previous - 1e-6
                || cue.end <= cue.start
                || cue.end > seconds + 0.02
                || !["A", "B", "C", "D", "E", "F", "G", "H", "X"].contains(&cue.value.as_str())
            {
                return Err(format!("invalid Rhubarb cue for {}", take.id).into());
            }
            previous = cue.end;
        }
        let fingerprint = digest(
            serde_json::to_vec(&json!([
                audio_hash,
                hash(&alignment)?,
                recognizer_hash,
                take.transcript,
                take.actor,
                take.speaker,
                start,
                end,
                session.rate,
                session.mouth_hold_frames
            ]))?
            .as_slice(),
        );
        takes.push(BakedTake {
            id: take.id.clone(),
            speaker: take.speaker.clone(),
            actor: take.actor.clone(),
            status: take.status.clone(),
            start_frame: start,
            end_frame: end,
            duration_s: seconds,
            original_path: root.rel(&original)?,
            original_sha256: audio_hash,
            canonical_path: root.rel(&canonical)?,
            transcript: take.transcript.clone(),
            cues: aligned.cues,
            fingerprint,
            cache_hit: hit,
        });
    }
    let mut actors: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (i, take) in takes.iter().enumerate() {
        let Some(actor) = &take.actor else { continue };
        if takes[..i].iter().any(|old| {
            old.actor.as_ref() == Some(actor)
                && take.start_frame < old.end_frame
                && old.start_frame < take.end_frame
        }) {
            return Err(format!("overlapping performances for actor {actor}").into());
        }
        let track = actors
            .entry(actor.clone())
            .or_insert_with(|| vec!["X".into(); session.frames]);
        for (frame, shape) in track.iter_mut().enumerate() {
            let held = frame / session.mouth_hold_frames * session.mouth_hold_frames;
            let local = local_frame_midpoint(held, take.start_frame, session.rate);
            if let Some(cue) = take
                .cues
                .iter()
                .find(|cue| cue.start <= local && local < cue.end)
            {
                *shape = cue.value.clone();
            }
        }
    }
    let seconds = session.rate.duration_of(session.frames as u64)?.as_f64();
    let mix = output_dir.join("mix.wav");
    mix_takes(&takes, &root, session.frames, session.rate, &mix)?;
    if (duration(&mix)? - seconds).abs() > 1. / 48000. {
        return Err("mixed waveform clock mismatch".into());
    }
    let old: Vec<BakedTake> = if let Some(path) = args.get(2) {
        let receipt: Value = serde_json::from_slice(&fs::read(path)?)?;
        if rate_from_receipt(&receipt) != Some(session.rate) || receipt["frames"] != session.frames
        {
            return Err("previous bake uses a different master clock; replan explicitly".into());
        }
        serde_json::from_value(receipt["takes"].clone())?
    } else {
        Vec::new()
    };
    let (changed, ranges) = changed_ranges(&old, &takes, session.frames);
    let impact = clip_impact(&session.shots, &ranges);
    let actor_hashes: BTreeMap<_, _> = actors
        .iter()
        .map(|(id, track)| (id.clone(), digest(track.join("").as_bytes())))
        .collect();
    let mut receipt = json!({"schema":"dialogue-bake/1","source_manifest_sha256":digest(&input),"rate":session.rate,"frames":session.frames,
        "takes":takes,"actor_tracks":actors,"actor_track_sha256":actor_hashes,"mouth_hold_frames":session.mouth_hold_frames,
        "mix_path":root.rel(&mix)?,"mix_sha256":hash(&mix)?,"mix_duration_s":seconds,
        "mix_processing":"48kHz stereo; sample-indexed f64 accumulation in Rust; one f32 rounding; FFmpeg decode/encode only",
        "invalidation":{"changed_take_ids":changed,"review_ranges":ranges,"affected_shots":impact.affected_shots,"affected_clip_ranges":impact.affected_ranges,
            "shots_including_neighbours":impact.review_shots,"clip_review_ranges":impact.review_ranges,
            "physics_retimed":false,"camera_retimed":false,"policy":"fixed master timing; invalidate complete containing generated clips, review both adjacent clips, and keep cue-local mouth edits separate. No automatic waveform stretch or action retime."},
        "alignment_status":"estimated viseme intervals; manual review required","production_accepted":false});
    // Guard: no host path may reach the receipt.
    root.relativise(&mut receipt)?;
    fs::write(
        output_dir.join("bake.json"),
        serde_json::to_vec_pretty(&receipt)?,
    )?;
    fs::write(output_dir.join("session.json"), input)?;
    println!(
        "Baked {} takes, {} actor tracks and {:.3}s mix into {}",
        takes.len(),
        actors.len(),
        seconds,
        output_dir.display()
    );
    Ok(())
}

// Subtract integer frames before converting to seconds. Subtracting two large
// floating timestamps moved cue boundaries when an unchanged take was relocated.
fn local_frame_midpoint(frame: usize, start: usize, rate: RationalRate) -> f64 {
    (frame as f64 - start as f64 + 0.5) * f64::from(rate.den()) / f64::from(rate.num())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rate25() -> RationalRate {
        RationalRate::new(25, 1).unwrap()
    }
    #[test]
    fn replacement_changes_only_its_samples_and_sums_overlap() {
        let bytes = |x: &[f32]| x.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<_>>();
        let mut original = vec![0.; 40];
        let mut replacement = original.clone();
        // Ten independently positioned takes, with two overlapping contributors.
        for i in 0..10 {
            let pcm = bytes(&[i as f32 / 16., -(i as f32) / 16.]);
            add_pcm(&mut original, &pcm, i * 3).unwrap();
            add_pcm(&mut replacement, &pcm, i * 3).unwrap();
        }
        add_pcm(&mut original, &bytes(&[0.25, -0.5]), 12).unwrap();
        add_pcm(&mut replacement, &bytes(&[-0.125]), 12).unwrap();
        assert_eq!(original[12], 0.5);
        assert_eq!(replacement[12], 0.125);
        assert!(
            original
                .iter()
                .zip(&replacement)
                .enumerate()
                .all(|(i, (a, b))| (12..14).contains(&i) || a == b)
        );
        assert!(add_pcm(&mut original, &[0, 1, 2], 0).is_err());
        assert!(add_pcm(&mut original, &bytes(&[f32::NAN]), 0).is_err());
        assert!(add_pcm(&mut original, &bytes(&[1.]), 40).is_err());
    }
    #[test]
    fn cue_inside_a_clip_invalidates_whole_clip_and_reviews_adjacent_cuts() {
        let shots = vec![
            Shot {
                id: "after".into(),
                frames: [524, 690],
            },
            Shot {
                id: "family".into(),
                frames: [469, 524],
            },
            Shot {
                id: "before".into(),
                frames: [459, 469],
            },
        ];
        let impact = clip_impact(&shots, &[[473, 517]]);
        assert_eq!(impact.affected_shots, ["family"]);
        assert_eq!(impact.affected_ranges, [[469, 524]]);
        assert_eq!(impact.review_shots, ["before", "family", "after"]);
        assert_eq!(impact.review_ranges, [[459, 469], [469, 524], [524, 690]]);
        assert!(clip_impact(&shots, &[]).review_shots.is_empty());
        assert!(clip_impact(&[], &[[473, 517]]).affected_shots.is_empty());
    }
    #[test]
    fn moving_a_take_preserves_cue_boundary_times() {
        for offset in -6_i64..49 {
            let a = local_frame_midpoint((501 + offset) as usize, 501, rate25());
            let b = local_frame_midpoint((475 + offset) as usize, 475, rate25());
            assert_eq!(a.to_bits(), b.to_bits());
        }
        assert_eq!(local_frame_midpoint(502, 501, rate25()), 0.06);
        assert_eq!(local_frame_midpoint(476, 475, rate25()), 0.06);
    }
    #[test]
    fn refuses_audio_overrun_instead_of_stretching() {
        assert!(window(700, 2.1, rate25(), 750).is_err());
        assert_eq!(window(700, 2., rate25(), 750).unwrap(), [700, 750]);
    }
    #[test]
    fn rejects_nonfinite_clock() {
        assert!(window(0, f64::NAN, rate25(), 750).is_err());
    }
    #[test]
    fn invalidates_both_old_and_new_windows() {
        let before = BakedTake {
            id: "line".into(),
            speaker: "speaker".into(),
            actor: None,
            status: "scratch".into(),
            start_frame: 10,
            end_frame: 20,
            duration_s: 0.4,
            original_path: String::new(),
            original_sha256: String::new(),
            canonical_path: String::new(),
            transcript: "x".into(),
            cues: Vec::new(),
            fingerprint: "old".into(),
            cache_hit: false,
        };
        let mut after = before.clone();
        after.start_frame = 30;
        after.end_frame = 40;
        after.fingerprint = "new".into();
        let (ids, ranges) = changed_ranges(&[before], &[after], 100);
        assert_eq!(ids, vec!["line"]);
        assert_eq!(ranges, vec![[8, 22], [28, 42]]);
    }
    #[test]
    fn ntsc_rate_maps_frames_to_samples_and_cue_times_exactly() {
        let ntsc = RationalRate::new(30000, 1001).unwrap();
        // 30000 frames last exactly 1001 s: 1001 * 48000 samples, no drift.
        assert_eq!(samples_at(30000, ntsc).unwrap(), 1001 * 48000);
        assert_eq!(samples_at(0, ntsc).unwrap(), 0);
        assert_eq!(samples_at(25, rate25()).unwrap(), 48000);
        let mid = local_frame_midpoint(1, 0, ntsc);
        assert!((mid - 1.5 * 1001. / 30000.).abs() < 1e-12);
        // 1.0 s at 30000/1001 needs ceil(29.97) = 30 frames.
        assert_eq!(window(10, 1.0, ntsc, 100).unwrap(), [10, 40]);
    }
    #[test]
    fn session_accepts_integer_fps_alias_and_rational_rate() {
        let base = |field: &str, value: serde_json::Value| {
            let mut v = json!({"schema":"dialogue-session/1","frames":10,"rhubarb_bin":"r",
                "cache_dir":"c","takes":[]});
            v[field] = value;
            serde_json::from_value::<Session>(v)
        };
        assert_eq!(base("fps", json!(25)).unwrap().rate, rate25());
        assert_eq!(
            base("rate", json!({"num":30000,"den":1001})).unwrap().rate,
            RationalRate::new(30000, 1001).unwrap()
        );
        assert!(base("rate", json!({"num":25,"den":0})).is_err());
    }
}
