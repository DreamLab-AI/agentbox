//! Seam QA: measure every join of an assembled cut.
//!
//! Each seam is the frame where segment N+1 starts. For every seam this module
//! measures a frame-difference *pop* against its local median, look steps
//! (HSV saturation, CIELAB L\*, L\* contrast) over [`WINDOW`]-frame windows
//! either side, a Laplacian detail ratio, an audio RMS step with a
//! silence/onset exemption, an audio click ratio and, where an overlap is
//! declared, the PSNR of the carried frames against the previous segment.
//!
//! A look or pop step fails only when it exceeds its absolute gate **and**
//! `baseline_multiplier` times the same step measured at nearby offsets
//! ([`LOCAL_OFFSETS`]), so a slow lighting ramp that changes the look on every
//! frame does not read as a defect at the join.
//!
//! Thresholds are configuration ([`Thresholds`]), carry a provenance string and
//! a `calibrated` flag; while uncalibrated, a pass is reported only as
//! `provisional` and never backs acceptance.
//!
//! Pixels and samples come from [`crate::media`]; the picture statistics are
//! computed on a downscaled (at most 480 px wide) RGB decode.
//!
//! The metric definitions and default gates are adapted from Kinoloom (MIT),
//! `tool/seam_qa.py`.
use crate::{
    clock::RationalRate,
    comfy::sha256_hex,
    media::{self, PixelFormat},
    paths::{Root, absolute_paths},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{error::Error, path::PathBuf};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

/// Schema identifier of a seam-QA configuration.
pub const CONFIG_SCHEMA: &str = "seam-qa/1";
/// Schema identifier of a seam-QA receipt.
pub const RECEIPT_SCHEMA: &str = "seam-qa-receipt/1";
/// Frames averaged either side of a seam for the look steps.
pub const WINDOW: usize = 6;
/// Frame offsets from the seam at which the local baseline is measured.
pub const LOCAL_OFFSETS: [i64; 6] = [-24, -18, -12, 12, 18, 24];
/// Widest picture the statistics are computed at.
pub const ANALYSIS_WIDTH: u32 = 480;

/// A file bound to its SHA-256, path relative to the production root.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Asset {
    /// Path relative to the production root.
    pub path: PathBuf,
    /// Hex SHA-256 of the file.
    pub sha256: String,
}

/// Threshold set with its provenance and calibration state.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Thresholds {
    /// Where these numbers came from.
    pub provenance: String,
    /// Whether the numbers were calibrated on this estate's own footage.
    pub calibrated: bool,
    /// Largest allowed pop ratio (seam frame difference / local median).
    pub pop_ratio: f64,
    /// Largest allowed absolute saturation step (HSV S, 0-255).
    pub d_sat: f64,
    /// Largest allowed absolute lightness step (L\*, 0-100).
    pub d_l: f64,
    /// Largest allowed absolute contrast step (L\* standard deviation).
    pub d_contrast: f64,
    /// Smallest allowed detail (Laplacian variance) ratio, after / before.
    pub detail_lo: f64,
    /// Largest allowed detail ratio, after / before.
    pub detail_hi: f64,
    /// Largest allowed audio RMS step in dB.
    pub audio_step_db: f64,
    /// Largest allowed click ratio (seam sample jump / take 99.9th percentile).
    pub audio_click: f64,
    /// Smallest allowed PSNR in dB of carried overlap frames.
    pub overlap_psnr: f64,
    /// Look and pop steps must exceed this multiple of the local baseline to fail.
    #[serde(default = "default_multiplier")]
    pub baseline_multiplier: f64,
    /// Below this level a 100 ms audio window counts as silence.
    #[serde(default = "default_silence")]
    pub silence_dbfs: f64,
    /// Audio steps are only judged when the louder side is above this level.
    #[serde(default = "default_floor")]
    pub audio_floor_dbfs: f64,
}

fn default_multiplier() -> f64 {
    2.5
}
fn default_silence() -> f64 {
    -60.0
}
fn default_floor() -> f64 {
    -45.0
}

impl Thresholds {
    /// The Kinoloom gates, uncalibrated for this estate.
    pub fn kinoloom_uncalibrated() -> Self {
        Self {
            provenance: "kinoloom-seam-qa-uncalibrated".into(),
            calibrated: false,
            pop_ratio: 1.30,
            d_sat: 2.0,
            d_l: 1.5,
            d_contrast: 1.5,
            detail_lo: 0.85,
            detail_hi: 1.15,
            audio_step_db: 1.5,
            audio_click: 3.0,
            overlap_psnr: 32.0,
            baseline_multiplier: default_multiplier(),
            silence_dbfs: default_silence(),
            audio_floor_dbfs: default_floor(),
        }
    }
}

/// A declared overlap: the first `frames` frames of the segment starting at
/// the seam are carried over from the end of `reference` (the previous segment).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Overlap {
    /// Number of carried frames.
    pub frames: u64,
    /// The previous segment's media, whose last `frames` frames are carried.
    pub reference: Asset,
}

/// One join to measure.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SeamSpec {
    /// Frame index where segment N+1 starts.
    pub frame: u64,
    /// Declared overlap, if any.
    #[serde(default)]
    pub overlap: Option<Overlap>,
}

/// Seam-QA configuration (`seam-qa/1`).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// Must be [`CONFIG_SCHEMA`].
    pub schema: String,
    /// The assembled cut under test.
    pub cut: Asset,
    /// The joins to measure.
    pub seams: Vec<SeamSpec>,
    /// Threshold set.
    pub thresholds: Thresholds,
}

/// Per-frame picture statistics.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FrameStats {
    /// Mean CIELAB L\* (0-100).
    pub l: f64,
    /// Standard deviation of L\*.
    pub contrast: f64,
    /// Mean HSV saturation (0-255).
    pub sat: f64,
    /// Variance of the 4-neighbour Laplacian of BT.601 luma.
    pub lap: f64,
}

/// Statistics of every frame plus the mean absolute difference to the
/// previous frame (`0.0` for the first).
#[derive(Clone, Debug, Default)]
pub struct Analysis {
    /// One entry per decoded frame.
    pub stats: Vec<FrameStats>,
    /// Mean absolute RGB difference to the previous frame.
    pub diffs: Vec<f64>,
}

fn srgb_to_linear(byte: u8) -> f64 {
    let c = f64::from(byte) / 255.0;
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn lab_l(y: f64) -> f64 {
    let f = if y > 0.008856 {
        y.cbrt()
    } else {
        7.787 * y + 16.0 / 116.0
    };
    116.0 * f - 16.0
}

/// Statistics of one packed RGB24 frame.
pub fn frame_stats(rgb: &[u8], width: usize, height: usize) -> FrameStats {
    let lut: Vec<f64> = (0..=255u8).map(srgb_to_linear).collect();
    let n = (width * height) as f64;
    let (mut sum_l, mut sum_l2, mut sum_s) = (0.0, 0.0, 0.0);
    let mut gray = vec![0f32; width * height];
    for (i, px) in rgb.as_chunks::<3>().0.iter().enumerate() {
        let y = 0.2126 * lut[px[0] as usize]
            + 0.7152 * lut[px[1] as usize]
            + 0.0722 * lut[px[2] as usize];
        let l = lab_l(y);
        sum_l += l;
        sum_l2 += l * l;
        let (max, min) = (
            px.iter().max().copied().unwrap_or(0),
            px.iter().min().copied().unwrap_or(0),
        );
        if max > 0 {
            sum_s += f64::from(max - min) / f64::from(max) * 255.0;
        }
        gray[i] = 0.299 * f32::from(px[0]) + 0.587 * f32::from(px[1]) + 0.114 * f32::from(px[2]);
    }
    let mean_l = sum_l / n;
    let contrast = (sum_l2 / n - mean_l * mean_l).max(0.0).sqrt();
    let lap = if width >= 3 && height >= 3 {
        let (mut s, mut s2, mut count) = (0.0f64, 0.0f64, 0.0f64);
        for y in 1..height - 1 {
            for x in 1..width - 1 {
                let c = y * width + x;
                let v = f64::from(
                    gray[c - 1] + gray[c + 1] + gray[c - width] + gray[c + width] - 4.0 * gray[c],
                );
                s += v;
                s2 += v * v;
                count += 1.0;
            }
        }
        (s2 / count - (s / count) * (s / count)).max(0.0)
    } else {
        0.0
    };
    FrameStats {
        l: mean_l,
        contrast,
        sat: sum_s / n,
        lap,
    }
}

/// Decode `path` at the analysis size and compute every frame's statistics.
pub fn analyze_video(path: &std::path::Path) -> Result<Analysis> {
    let p = media::probe(path)?;
    let (w, h) = if p.width > ANALYSIS_WIDTH {
        let h = (u64::from(p.height) * u64::from(ANALYSIS_WIDTH)).div_ceil(u64::from(p.width));
        (ANALYSIS_WIDTH, (h as u32).max(3))
    } else {
        (p.width, p.height)
    };
    let mut out = Analysis::default();
    let mut prev: Option<Vec<u8>> = None;
    media::for_each_frame(path, PixelFormat::Rgb24, Some((w, h)), |f| {
        out.stats.push(frame_stats(&f.data, w as usize, h as usize));
        out.diffs.push(match &prev {
            None => 0.0,
            Some(p) => {
                p.iter()
                    .zip(&f.data)
                    .map(|(a, b)| u64::from(a.abs_diff(*b)))
                    .sum::<u64>() as f64
                    / f.data.len() as f64
            }
        });
        prev = Some(f.data);
        Ok(())
    })?;
    Ok(out)
}

fn median(values: &mut [f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(f64::total_cmp);
    let n = values.len();
    Some(if n % 2 == 1 {
        values[n / 2]
    } else {
        (values[n / 2 - 1] + values[n / 2]) / 2.0
    })
}

fn percentile(sorted: &[f32], q: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let pos = (sorted.len() - 1) as f64 * q;
    let lo = pos.floor() as usize;
    let hi = (lo + 1).min(sorted.len() - 1);
    f64::from(sorted[lo]) + (f64::from(sorted[hi]) - f64::from(sorted[lo])) * (pos - lo as f64)
}

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

type Pick = fn(&FrameStats) -> f64;

fn window_mean(rows: &[FrameStats], a: i64, b: i64, pick: Pick) -> f64 {
    let (a, b) = (a.max(0) as usize, (b.max(0) as usize).min(rows.len()));
    if a >= b {
        return f64::NAN;
    }
    rows[a..b].iter().map(pick).sum::<f64>() / (b - a) as f64
}

fn step(rows: &[FrameStats], at: i64, pick: Pick) -> f64 {
    let w = WINDOW as i64;
    window_mean(rows, at, at + w, pick) - window_mean(rows, at - w, at, pick)
}

fn detail(rows: &[FrameStats], at: i64) -> Option<f64> {
    let after = window_mean(rows, at, at + 4, |s| s.lap);
    let before = window_mean(rows, at - 4, at, |s| s.lap);
    (before > 1e-6 && after.is_finite()).then(|| after / before)
}

/// A look step at the seam and the typical step nearby.
#[derive(Clone, Copy, Debug, Serialize)]
pub struct Step {
    /// Mean of the window after the seam minus the window before it.
    pub value: f64,
    /// Median absolute step at the baseline offsets, if any were measurable.
    pub local: Option<f64>,
}

/// Picture metrics of one seam.
#[derive(Clone, Debug, Serialize)]
pub struct VideoMetrics {
    /// Seam frame.
    pub frame: u64,
    /// Mean absolute difference between the seam frame and its predecessor.
    pub diff: f64,
    /// Median frame difference in the 12 frames either side.
    pub local_median_diff: f64,
    /// `diff / local_median_diff`, or `None` when the local picture is static.
    pub pop_ratio: Option<f64>,
    /// Saturation step.
    pub d_sat: Step,
    /// Lightness step.
    pub d_l: Step,
    /// Contrast step.
    pub d_contrast: Step,
    /// Detail ratio after / before.
    pub detail_ratio: Option<f64>,
    /// Typical detail ratio nearby, expressed as ≥ 1.
    pub detail_local: Option<f64>,
}

/// Measure the picture around `frame` (which must satisfy `2 <= frame < len - 2`).
pub fn video_metrics(a: &Analysis, frame: u64) -> VideoMetrics {
    let rows = &a.stats;
    let b = frame as i64;
    let at = |i: i64| a.diffs.get(i.max(0) as usize).copied();
    let local: Vec<f64> = ((b - 12).max(1)..b - 1)
        .chain(b + 2..b + 13)
        .filter_map(at)
        .collect();
    let med = median(&mut local.clone()).unwrap_or(0.0);
    let diff = a.diffs[frame as usize];
    let near: Vec<i64> = LOCAL_OFFSETS
        .iter()
        .map(|k| b + k)
        .filter(|&p| p >= 6 && p <= rows.len() as i64 - 6)
        .collect();
    let mk = |pick: Pick| {
        let value = step(rows, b, pick);
        let mut locals: Vec<f64> = near.iter().map(|&p| step(rows, p, pick).abs()).collect();
        Step {
            value,
            local: median(&mut locals),
        }
    };
    let mut ratios: Vec<f64> = near
        .iter()
        .filter_map(|&p| detail(rows, p))
        .filter(|d| *d > 0.0)
        .map(|d| d.ln().abs())
        .collect();
    VideoMetrics {
        frame,
        diff,
        local_median_diff: med,
        pop_ratio: (med > 1e-6).then(|| diff / med),
        d_sat: mk(|s| s.sat),
        d_l: mk(|s| s.l),
        d_contrast: mk(|s| s.contrast),
        detail_ratio: detail(rows, b),
        detail_local: median(&mut ratios).map(f64::exp),
    }
}

/// Names of the picture checks that fail for `m` under `t`.
pub fn judge_video(m: &VideoMetrics, t: &Thresholds) -> Vec<&'static str> {
    let mut fails = Vec::new();
    // Pop: above the gate and above the multiplier times a typical frame step is
    // already what the ratio expresses, so the gate alone applies.
    if m.pop_ratio.is_some_and(|p| p > t.pop_ratio) {
        fails.push("pop");
    }
    for (step, gate, name) in [
        (&m.d_sat, t.d_sat, "saturation"),
        (&m.d_l, t.d_l, "lightness"),
        (&m.d_contrast, t.d_contrast, "contrast"),
    ] {
        if step.value.abs() > gate.max(t.baseline_multiplier * step.local.unwrap_or(0.0)) {
            fails.push(name);
        }
    }
    if let Some(dr) = m.detail_ratio {
        let (mut lo, mut hi) = (t.detail_lo, t.detail_hi);
        if let Some(loc) = m.detail_local.filter(|l| *l > 0.0) {
            lo = lo.min(loc.powf(-t.baseline_multiplier));
            hi = hi.max(loc.powf(t.baseline_multiplier));
        }
        if !(lo..=hi).contains(&dr) {
            fails.push("detail");
        }
    }
    fails
}

/// Audio measurements at a seam.
#[derive(Clone, Debug, Serialize)]
pub struct AudioMetrics {
    /// Louder of the two 100 ms windows around the seam, dBFS.
    pub level_dbfs: f64,
    /// Absolute RMS step across the seam, dB.
    pub step_db: f64,
    /// Median absolute step between neighbouring windows away from the seam.
    pub local_step_db: f64,
    /// A sound starts or ends here (one side below the silence level).
    pub onset: bool,
    /// Largest sample jump within ±5 ms of the seam / take 99.9th percentile jump.
    pub click: f64,
}

fn rms_db(x: &[f32]) -> f64 {
    if x.is_empty() {
        return -120.0;
    }
    let ms = x.iter().map(|v| f64::from(*v) * f64::from(*v)).sum::<f64>() / x.len() as f64;
    20.0 * ms.sqrt().max(1e-6).log10()
}

/// Level step and click at `seam` (a sample index) of mono `audio` at `rate` Hz.
pub fn audio_metrics(audio: &[f32], rate: u32, seam: usize, silence_dbfs: f64) -> AudioMetrics {
    let w = (rate as usize / 10).max(1);
    let n = audio.len();
    let slice = |a: i64, b: i64| &audio[(a.max(0) as usize).min(n)..(b.max(0) as usize).min(n)];
    let i = seam as i64;
    let (before, after) = (slice(i - w as i64, i), slice(i, i + w as i64));
    let (db_b, db_a) = (rms_db(before), rms_db(after));
    let mut refs = Vec::new();
    for k in [-4i64, -3, -2, 2, 3, 4] {
        let j = i + k * w as i64;
        let (a, b) = (slice(j - w as i64, j), slice(j, j + w as i64));
        if a.len() == w && b.len() == w {
            refs.push((rms_db(b) - rms_db(a)).abs());
        }
    }
    let mut d: Vec<f32> = audio.windows(2).map(|p| (p[1] - p[0]).abs()).collect();
    let jump = {
        let m = (rate as usize / 200).max(1);
        let (lo, hi) = (seam.saturating_sub(m).min(d.len()), (seam + m).min(d.len()));
        d[lo..hi].iter().copied().fold(0.0f32, f32::max)
    };
    d.sort_by(f32::total_cmp);
    let p999 = percentile(&d, 0.999);
    let level = db_b.max(db_a);
    AudioMetrics {
        level_dbfs: round3(level),
        step_db: round3((db_a - db_b).abs()),
        local_step_db: round3(median(&mut refs).unwrap_or(0.0)),
        onset: db_b.min(db_a) < silence_dbfs && silence_dbfs <= level,
        click: if p999 > 0.0 {
            round3(f64::from(jump) / p999)
        } else {
            0.0
        },
    }
}

/// Names of the audio checks that fail for `m` under `t`.
pub fn judge_audio(m: &AudioMetrics, t: &Thresholds) -> Vec<&'static str> {
    let mut fails = Vec::new();
    if m.level_dbfs > t.audio_floor_dbfs
        && !m.onset
        && m.step_db > t.audio_step_db.max(2.0 * m.local_step_db)
    {
        fails.push("audio_level");
    }
    if m.click > t.audio_click {
        fails.push("audio_click");
    }
    fails
}

/// PSNR in dB between two equal-sized byte buffers; identical buffers report 99.
pub fn psnr(a: &[u8], b: &[u8]) -> f64 {
    let se: f64 = a
        .iter()
        .zip(b)
        .map(|(x, y)| (f64::from(*x) - f64::from(*y)).powi(2))
        .sum();
    let mse = se / a.len().max(1) as f64;
    if mse == 0.0 {
        99.0
    } else {
        10.0 * (255.0f64 * 255.0 / mse).log10()
    }
}

/// Per-frame PSNR of the last `frames` frames of `reference` against the
/// `frames` frames of `cut` starting at `seam`, both at native size.
pub fn overlap_psnr(
    cut: &std::path::Path,
    reference: &std::path::Path,
    seam: u64,
    frames: u64,
) -> Result<Vec<f64>> {
    let ref_count = media::probe(reference)?.frames;
    if frames == 0 || frames > ref_count {
        return Err("overlap exceeds the reference clip".into());
    }
    let first_ref = ref_count - frames;
    let mut carried = Vec::new();
    media::for_each_frame(reference, PixelFormat::Rgb24, None, |f| {
        if f.index >= first_ref {
            carried.push(f.data);
        }
        Ok(())
    })?;
    let mut values = Vec::new();
    media::for_each_frame(cut, PixelFormat::Rgb24, None, |f| {
        if f.index >= seam && f.index < seam + frames {
            let other = &carried[(f.index - seam) as usize];
            if other.len() != f.data.len() {
                return Err("overlap reference and cut differ in size".into());
            }
            values.push(round3(psnr(other, &f.data)));
        }
        Ok(())
    })?;
    Ok(values)
}

fn seam_sample(seam: u64, rate: RationalRate, audio_rate: u32) -> usize {
    let num = u128::from(rate.num());
    ((u128::from(seam) * u128::from(rate.den()) * u128::from(audio_rate) + num / 2) / num) as usize
}

fn verdict_of(fails: &[String], blocked: Option<&str>) -> &'static str {
    match (blocked, fails.is_empty()) {
        (Some(_), _) => "BLOCKED",
        (None, false) => "FAIL",
        (None, true) => "PASS",
    }
}

fn checked(root: &Root, asset: &Asset) -> Result<PathBuf> {
    let path = root.resolve(&asset.path)?;
    if sha256_hex(&std::fs::read(&path)?) != asset.sha256 {
        return Err(format!("stale asset {}", asset.path.display()).into());
    }
    Ok(path)
}

/// Run every configured seam measurement and build the receipt.
///
/// Fails (rather than reporting) when the configuration is malformed or an
/// asset's hash is stale. A seam that cannot be measured reports `BLOCKED`.
/// All paths in the receipt are root-relative.
pub fn run(root: &Root, config: &Config) -> Result<Value> {
    if config.schema != CONFIG_SCHEMA {
        return Err(format!("config schema must be {CONFIG_SCHEMA}").into());
    }
    let t = &config.thresholds;
    let cut = checked(root, &config.cut)?;
    let probe = media::probe(&cut)?;
    let analysis = analyze_video(&cut)?;
    let n = analysis.stats.len() as u64;
    if n != probe.frames {
        return Err("decoded frame count differs between probe and analysis".into());
    }
    let audio = match probe.audio_rate {
        Some(rate) => Some((media::decode_audio_s16(&cut, rate, 1)?, rate)),
        None => None,
    }
    .map(|(pcm, rate)| {
        (
            pcm.iter()
                .map(|s| f32::from(*s) / 32768.0)
                .collect::<Vec<f32>>(),
            rate,
        )
    });
    let mut seams = Vec::new();
    for spec in &config.seams {
        let mut fails: Vec<String> = Vec::new();
        let mut blocked: Option<String> = None;
        let mut record = json!({"frame": spec.frame});
        if spec.frame < 2 || spec.frame + 2 > n {
            blocked = Some(format!(
                "seam frame {} is outside the measurable range 2..{}",
                spec.frame,
                n.saturating_sub(2)
            ));
        } else {
            let vm = video_metrics(&analysis, spec.frame);
            fails.extend(judge_video(&vm, t).into_iter().map(String::from));
            record["video"] = serde_json::to_value(&vm)?;
            match &audio {
                Some((pcm, rate)) => {
                    let am = audio_metrics(
                        pcm,
                        *rate,
                        seam_sample(spec.frame, probe.rate, *rate),
                        t.silence_dbfs,
                    );
                    fails.extend(judge_audio(&am, t).into_iter().map(String::from));
                    record["audio"] = serde_json::to_value(&am)?;
                }
                None => {
                    record["audio"] =
                        json!({"verdict": "NOT_APPLICABLE", "reason": "no audio stream"})
                }
            }
        }
        match (&spec.overlap, &blocked) {
            (Some(ov), None) => {
                let result = checked(root, &ov.reference).and_then(|reference| {
                    if spec.frame + ov.frames > n {
                        return Err("overlap runs past the end of the cut".into());
                    }
                    overlap_psnr(&cut, &reference, spec.frame, ov.frames)
                });
                match result {
                    Ok(values) => {
                        let min = values.iter().copied().fold(f64::INFINITY, f64::min);
                        let pass = !values.is_empty() && min >= t.overlap_psnr;
                        if !pass {
                            fails.push("overlap_psnr".into());
                        }
                        record["overlap"] = json!({"frames": ov.frames,
                            "reference": {"path": root.rel(&ov.reference.path)?, "sha256": ov.reference.sha256},
                            "psnr_db": values, "min_db": min, "verdict": if pass { "PASS" } else { "FAIL" }});
                    }
                    Err(e) => blocked = Some(format!("overlap not measurable: {e}")),
                }
            }
            (None, _) => {
                record["overlap"] =
                    json!({"verdict": "NOT_APPLICABLE", "reason": "no overlap declared"})
            }
            _ => {}
        }
        let verdict = verdict_of(&fails, blocked.as_deref());
        record["fails"] = json!(fails);
        record["blocked_reason"] = json!(blocked);
        record["verdict"] = json!(verdict);
        record["provisional"] = json!(verdict == "PASS" && !t.calibrated);
        seams.push(record);
    }
    let overall = if seams.is_empty() {
        "NOT_RUN"
    } else if seams.iter().any(|s| s["verdict"] == "FAIL") {
        "FAIL"
    } else if seams.iter().any(|s| s["verdict"] == "BLOCKED") {
        "BLOCKED"
    } else {
        "PASS"
    };
    let mut receipt = json!({
        "schema": RECEIPT_SCHEMA,
        "cut": {"path": root.rel(&config.cut.path)?, "sha256": config.cut.sha256,
                "frames": n, "rate": probe.rate, "width": probe.width, "height": probe.height,
                "has_audio": audio.is_some()},
        "thresholds": t,
        "seams": seams,
        "verdict": overall,
        "provisional": overall == "PASS" && !t.calibrated,
        "acceptance_backing": overall == "PASS" && t.calibrated,
    });
    root.relativise(&mut receipt)?;
    if !absolute_paths(&receipt).is_empty() {
        return Err("receipt would contain a host path".into());
    }
    Ok(receipt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::testutil::{Scratch, lavfi};
    use std::process::Command;

    /// Flat colour plus noise: deterministic, with constant frame difference and texture.
    /// Per-frame noise gives every frame the same texture energy and the same frame difference.
    const NOISE: &str = "noise=alls=14:allf=t:all_seed=7";
    const SIZE: &str = "c=0x806040:s=96x64:r=25";

    fn asset(root: &Root, name: &str) -> Asset {
        let bytes = std::fs::read(root.dir().join(name)).unwrap();
        Asset {
            path: name.into(),
            sha256: sha256_hex(&bytes),
        }
    }

    fn config(root: &Root, cut: &str, seams: Vec<SeamSpec>) -> Config {
        Config {
            schema: CONFIG_SCHEMA.into(),
            cut: asset(root, cut),
            seams,
            thresholds: Thresholds::kinoloom_uncalibrated(),
        }
    }

    fn seam(frame: u64) -> SeamSpec {
        SeamSpec {
            frame,
            overlap: None,
        }
    }

    fn fails(receipt: &Value, i: usize) -> Vec<String> {
        receipt["seams"][i]["fails"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_owned())
            .collect()
    }

    #[test]
    fn hard_colour_step_fails() {
        let s = Scratch::new("seam-hard");
        let cut = s.path("cut.mkv");
        let a = format!(
            "color={SIZE}:d=1,{NOISE}[a];color={SIZE}:d=1,eq=brightness=0.3:saturation=0.1,{NOISE}[b];[a][b]concat=n=2:v=1:a=0"
        );
        lavfi(&cut, &[&a], &["-c:v", "ffv1"]);
        let root = Root::new(&s.0).unwrap();
        let r = run(&root, &config(&root, "cut.mkv", vec![seam(25)])).unwrap();
        assert_eq!(r["verdict"], "FAIL", "{r:#}");
        let f = fails(&r, 0);
        assert!(
            f.contains(&"pop".into())
                && f.contains(&"saturation".into())
                && f.contains(&"lightness".into()),
            "{f:?}"
        );
        assert_eq!(r["provisional"], false);
        assert_eq!(r["acceptance_backing"], false);
    }

    #[test]
    fn slow_global_lighting_ramp_passes_provisionally() {
        let s = Scratch::new("seam-ramp");
        let cut = s.path("cut.mkv");
        let a = format!("color={SIZE}:d=2,eq=brightness='-0.1+0.3*t':eval=frame,{NOISE}");
        lavfi(&cut, &[&a], &["-c:v", "ffv1"]);
        let root = Root::new(&s.0).unwrap();
        let r = run(&root, &config(&root, "cut.mkv", vec![seam(25)])).unwrap();
        // The absolute lightness step exceeds its gate everywhere; only the local
        // baseline rule keeps the ramp from failing.
        let step = r["seams"][0]["video"]["d_l"]["value"].as_f64().unwrap();
        assert!(
            step.abs() > 1.5,
            "ramp too gentle to exercise the baseline: {step}"
        );
        assert_eq!(r["verdict"], "PASS", "{r:#}");
        assert_eq!(r["provisional"], true);
        assert_eq!(r["acceptance_backing"], false);
        let mut calibrated = config(&root, "cut.mkv", vec![seam(25)]);
        calibrated.thresholds.calibrated = true;
        let r = run(&root, &calibrated).unwrap();
        assert_eq!(
            (r["provisional"].clone(), r["acceptance_backing"].clone()),
            (json!(false), json!(true))
        );
    }

    #[test]
    fn identical_overlap_meets_psnr_gate_and_a_different_one_fails() {
        let s = Scratch::new("seam-overlap");
        lavfi(
            &s.path("ref.mkv"),
            &[&format!("color={SIZE}:d=1.6,{NOISE}")],
            &["-c:v", "ffv1"],
        );
        lavfi(
            &s.path("head.mkv"),
            &[&format!("color={SIZE}:d=1,{NOISE}")],
            &["-c:v", "ffv1"],
        );
        let status = Command::new("ffmpeg")
            .args(["-nostdin", "-v", "error", "-y", "-i"])
            .arg(s.path("head.mkv"))
            .arg("-i")
            .arg(s.path("ref.mkv"))
            .args([
                "-filter_complex",
                "[1:v]trim=start_frame=35,setpts=PTS-STARTPTS[t];[0:v][t]concat=n=2:v=1:a=0",
                "-c:v",
                "ffv1",
            ])
            .arg(s.path("cut.mkv"))
            .status()
            .unwrap();
        assert!(status.success());
        lavfi(
            &s.path("other.mkv"),
            &[&format!("color=c=0x4080c0:s=96x64:r=25:d=1.6,{NOISE}")],
            &["-c:v", "ffv1"],
        );
        let root = Root::new(&s.0).unwrap();
        let with = |reference: &str| {
            let ov = Overlap {
                frames: 5,
                reference: asset(&root, reference),
            };
            config(
                &root,
                "cut.mkv",
                vec![SeamSpec {
                    frame: 25,
                    overlap: Some(ov),
                }],
            )
        };
        let good = run(&root, &with("ref.mkv")).unwrap();
        let o = &good["seams"][0]["overlap"];
        assert_eq!(o["verdict"], "PASS", "{good:#}");
        assert!(
            o["min_db"].as_f64().unwrap() >= 32.0 && o["psnr_db"].as_array().unwrap().len() == 5
        );
        let bad = run(&root, &with("other.mkv")).unwrap();
        assert!(fails(&bad, 0).contains(&"overlap_psnr".into()), "{bad:#}");
        assert_eq!(bad["verdict"], "FAIL");
        let mut too_long = with("ref.mkv");
        too_long.seams[0].overlap.as_mut().unwrap().frames = 999;
        assert_eq!(run(&root, &too_long).unwrap()["verdict"], "BLOCKED");
    }

    fn tone_clip(path: &std::path::Path, expr: &str) {
        let audio = format!("aevalsrc=exprs='{expr}':s=48000:d=2");
        lavfi(
            path,
            &[&format!("color={SIZE}:d=2,{NOISE}"), &audio],
            &["-c:v", "ffv1", "-c:a", "pcm_s16le", "-shortest"],
        );
    }

    #[test]
    fn injected_audio_click_fails_and_clean_tone_passes() {
        let s = Scratch::new("seam-click");
        tone_clip(&s.path("clean.mkv"), "0.1*sin(2*PI*440*t)");
        tone_clip(
            &s.path("click.mkv"),
            "0.1*sin(2*PI*440*t)+0.6*between(t,1.0,1.002)",
        );
        let root = Root::new(&s.0).unwrap();
        let clean = run(&root, &config(&root, "clean.mkv", vec![seam(25)])).unwrap();
        assert_eq!(clean["verdict"], "PASS", "{clean:#}");
        let click = run(&root, &config(&root, "click.mkv", vec![seam(25)])).unwrap();
        assert!(
            fails(&click, 0).contains(&"audio_click".into()),
            "{click:#}"
        );
        assert_eq!(click["verdict"], "FAIL");
    }

    #[test]
    fn audio_step_is_exempt_at_an_onset_but_not_between_two_sounds() {
        let t = Thresholds::kinoloom_uncalibrated();
        let tone = |amp: f32, n: usize| {
            (0..n)
                .map(|i| amp * (i as f32 * 0.1).sin())
                .collect::<Vec<_>>()
        };
        let rate = 8000;
        let onset: Vec<f32> = [vec![0.0; 3200], tone(0.3, 3200)].concat();
        let m = audio_metrics(&onset, rate, 3200, t.silence_dbfs);
        assert!(m.onset && judge_audio(&m, &t).is_empty(), "{m:?}");
        let louder: Vec<f32> = [tone(0.1, 3200), tone(0.4, 3200)].concat();
        let m = audio_metrics(&louder, rate, 3200, t.silence_dbfs);
        assert!(
            !m.onset && judge_audio(&m, &t).contains(&"audio_level"),
            "{m:?}"
        );
    }

    #[test]
    fn unmeasurable_seam_is_blocked_stale_cut_is_refused_and_silent_cut_is_not_applicable() {
        let s = Scratch::new("seam-edge");
        lavfi(
            &s.path("cut.mkv"),
            &[&format!("color={SIZE}:d=1,{NOISE}")],
            &["-c:v", "ffv1"],
        );
        let root = Root::new(&s.0).unwrap();
        let r = run(&root, &config(&root, "cut.mkv", vec![seam(1), seam(12)])).unwrap();
        assert_eq!(r["seams"][0]["verdict"], "BLOCKED");
        assert_eq!(r["seams"][1]["audio"]["verdict"], "NOT_APPLICABLE");
        assert_eq!(r["verdict"], "BLOCKED");
        assert_eq!(
            run(&root, &config(&root, "cut.mkv", vec![])).unwrap()["verdict"],
            "NOT_RUN"
        );
        let mut stale = config(&root, "cut.mkv", vec![seam(12)]);
        stale.cut.sha256 = "0".repeat(64);
        assert!(run(&root, &stale).is_err());
        assert!(absolute_paths(&r).is_empty());
    }

    #[test]
    fn percentile_and_median_follow_numpy_conventions() {
        assert_eq!(median(&mut [3.0, 1.0, 2.0, 4.0]), Some(2.5));
        assert!((percentile(&[0.0, 1.0, 2.0, 3.0], 0.5) - 1.5).abs() < 1e-9);
        assert_eq!(psnr(&[1, 2, 3], &[1, 2, 3]), 99.0);
        assert!(psnr(&[0; 4], &[255; 4]).abs() < 1e-9);
    }
}
