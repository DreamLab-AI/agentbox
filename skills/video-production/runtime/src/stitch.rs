//! Frame-exact stitching, audio preservation and retake planning.
//!
//! Segments are decoded to RGB24 through [`crate::media::for_each_frame`], cut to
//! half-open frame intervals, blended across each declared overlap and piped as
//! rawvideo into ONE `ffmpeg` encode. `xfade` is never used: it has been seen to
//! export one frame short. The delivery encode is tagged BT.709 with an explicit
//! matrix. The approved audio is muxed with `-c:a copy` and the output's copied
//! audio packet hashes must equal the source's; any gate failure deletes the
//! output.
//!
//! Overlap rule: for an overlap of `O` frames the output frame `j` (0-based
//! inside the overlap) is `(1-w)*A + w*B` with `w = (j+1)/(O+1)`, where `A` is
//! the tail of the earlier segment's keep interval and `B` the head of the next
//! one. The output holds `sum(keep) - sum(overlap)` frames.
//!
//! Plan (`stitch/1`):
//! ```json
//! {"schema":"stitch/1","rate":25,
//!  "segments":[{"id":"a","media":{"path":"a.mkv","sha256":"…"},"keep":[0,40]},
//!              {"id":"b","media":{"path":"b.mkv","sha256":"…"},"keep":[0,30]}],
//!  "overlaps":[4],
//!  "audio":{"source":{"path":"mix.mp4","sha256":"…"},"approved_packets_sha256":"…"}}
//! ```
//! `audio` is optional (silent delivery when absent). Segment audio is never
//! used: a model-generated track is discarded unless the plan names that very
//! file as `audio.source`.
use crate::{
    clock::RationalRate,
    comfy::sha256_hex,
    media::{self, Colour, PixelFormat},
    paths::{Root, take_root_option},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    error::Error,
    ffi::OsString,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
};

/// Boxed error used by this module.
pub type Result<T> = std::result::Result<T, Box<dyn Error>>;

/// Minimum pre/post roll, in frames, around a retake interval.
pub const MIN_ROLL: u64 = 4;
/// Default overlap, in frames, at each side of a retake join.
pub const DEFAULT_OVERLAP: u64 = 4;
/// Schema id of a stitch plan.
pub const STITCH_SCHEMA: &str = "stitch/1";
/// Schema id of a retake plan.
pub const RETAKE_SCHEMA: &str = "retake-plan/1";
/// Schema tag of the geometry printed by `plan-retake` and emitted by the
/// `AgentboxRetakePrep` node; a caller adds rate and assets to form a
/// [`RETAKE_SCHEMA`] plan.
pub const GEOMETRY_SCHEMA: &str = "retake-geometry/1";

/// A file bound to its SHA-256.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Asset {
    /// Path relative to the production root (or absolute inside it).
    pub path: PathBuf,
    /// Lower-case hex SHA-256 of the file bytes.
    pub sha256: String,
}

/// One decoded source clip and the half-open frame interval to keep from it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Segment {
    /// Identifier used in the receipt.
    pub id: String,
    /// Source video.
    pub media: Asset,
    /// Half-open `[start, end)` source frame interval.
    pub keep: [u64; 2],
    /// Declared YUV colour of the source, required when it carries no complete
    /// colour tags (and then never guessed); must agree with complete tags.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colour: Option<Colour>,
}

/// The approved audio track, muxed bit-exactly.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AudioSpec {
    /// File holding the approved audio stream.
    pub source: Asset,
    /// Digest of the approved packet hashes, see [`packets_digest`]. A
    /// re-encoded source no longer matches and is rejected.
    pub approved_packets_sha256: String,
}

/// A complete stitch plan.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StitchPlan {
    /// Must be [`STITCH_SCHEMA`].
    pub schema: String,
    /// Delivery (and required source) frame rate.
    pub rate: RationalRate,
    /// Segments in delivery order.
    pub segments: Vec<Segment>,
    /// Overlap, in frames, at each join: exactly `segments.len() - 1` entries.
    pub overlaps: Vec<u64>,
    /// Optional approved audio.
    #[serde(default)]
    pub audio: Option<AudioSpec>,
}

/// Digest that identifies an audio bitstream: SHA-256 over the per-packet
/// hashes from [`media::audio_packet_hashes`], newline-joined.
pub fn packets_digest(hashes: &[String]) -> String {
    sha256_hex(hashes.join("\n").as_bytes())
}

impl StitchPlan {
    /// Σkeep − Σoverlap: the exact number of delivery frames.
    pub fn expected_frames(&self) -> u64 {
        let keep: u64 = self.segments.iter().map(|s| s.keep[1] - s.keep[0]).sum();
        keep - self.overlaps.iter().sum::<u64>()
    }

    /// Structural checks that need no media.
    pub fn validate(&self) -> Result<()> {
        if self.schema != STITCH_SCHEMA || self.segments.is_empty() {
            return Err("invalid stitch plan".into());
        }
        if self.overlaps.len() + 1 != self.segments.len() {
            return Err("overlaps must hold one entry per join".into());
        }
        for (i, s) in self.segments.iter().enumerate() {
            if s.keep[0] >= s.keep[1] {
                return Err(format!("segment {} has an empty keep interval", s.id).into());
            }
            let len = s.keep[1] - s.keep[0];
            let left = if i > 0 { self.overlaps[i - 1] } else { 0 };
            let right = self.overlaps.get(i).copied().unwrap_or(0);
            if left + right > len {
                return Err(format!("segment {} is shorter than its overlaps", s.id).into());
            }
        }
        Ok(())
    }
}

/// Linear overlap blend of one frame: `(1-w)*a + w*b`, `w = (j+1)/(o+1)`,
/// rounded to nearest per byte.
pub fn blend_frame(a: &[u8], b: &[u8], j: u64, o: u64) -> Vec<u8> {
    let (num, den) = (j + 1, o + 1);
    a.iter()
        .zip(b)
        .map(|(&x, &y)| ((u64::from(x) * (den - num) + u64::from(y) * num + den / 2) / den) as u8)
        .collect()
}

/// Re-hash every source after the encode and refuse if any changed.
///
/// `verified` hashes a file and ffmpeg then reopens it by path, so a source
/// swapped in between would be encoded unhashed. Re-checking afterwards turns
/// a swap that persists into a refusal. Residual race: a file replaced after
/// ffmpeg opened it but restored before this check is not detected; closing
/// that needs a private copy or an fd shared with the child.
fn sources_unchanged(sources: &[(PathBuf, &str)]) -> Result<()> {
    for (path, expected) in sources {
        if sha256_hex(&fs::read(path)?) != *expected {
            return Err(format!(
                "source {} changed while the delivery was being encoded",
                path.display()
            )
            .into());
        }
    }
    Ok(())
}

fn verified(root: &Root, asset: &Asset) -> Result<PathBuf> {
    let path = root.resolve(&asset.path)?;
    if sha256_hex(&fs::read(&path)?) != asset.sha256 {
        return Err(format!("stale asset {}", asset.path.display()).into());
    }
    Ok(path)
}

/// Decode, cut and blend the segments, handing each delivery frame to `sink` in
/// order. Returns the number of frames emitted.
fn compose(
    plan: &StitchPlan,
    paths: &[PathBuf],
    colours: &[Option<Colour>],
    mut sink: impl FnMut(&[u8]) -> Result<()>,
) -> Result<u64> {
    let mut carry: Vec<Vec<u8>> = Vec::new();
    let mut emitted = 0u64;
    for (i, segment) in plan.segments.iter().enumerate() {
        let [a, b] = segment.keep;
        let len = b - a;
        let left = if i > 0 { plan.overlaps[i - 1] } else { 0 };
        let right = plan.overlaps.get(i).copied().unwrap_or(0);
        let mut next_carry = Vec::new();
        let mut done = false;
        let mut seen = 0u64;
        let result = media::for_each_frame_as(
            &paths[i],
            PixelFormat::Rgb24,
            None,
            colours[i].as_ref(),
            |frame| {
                if frame.index < a {
                    return Ok(());
                }
                if frame.index >= b {
                    done = true;
                    return Err("segment complete".into());
                }
                let k = frame.index - a;
                seen += 1;
                if k < left {
                    sink(&blend_frame(&carry[k as usize], &frame.data, k, left))?;
                    emitted += 1;
                } else if k >= len - right {
                    next_carry.push(frame.data);
                } else {
                    sink(&frame.data)?;
                    emitted += 1;
                }
                Ok(())
            },
        );
        match result {
            Ok(_) => {}
            Err(_) if done => {}
            Err(error) => return Err(error),
        }
        if seen != len {
            return Err(format!(
                "segment {} decodes fewer than {len} kept frames",
                segment.id
            )
            .into());
        }
        carry = next_carry;
    }
    Ok(emitted)
}

/// Delivery colour facts read back from the encoded file.
fn colour_tags(path: &Path) -> Result<Value> {
    let out = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=color_space,color_primaries,color_transfer,color_range,pix_fmt",
            "-of",
            "json",
        ])
        .args(crate::media::SAFE_INPUT)
        .arg(path)
        .output()?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned().into());
    }
    Ok(serde_json::from_slice::<Value>(&out.stdout)?["streams"][0].clone())
}

/// Post-encode gate. On any mismatch the output is deleted and an error
/// returned. Checks decoded frame count, rational rate, canvas, BT.709 tags, the
/// declared `tv` range, pixel format and
/// (when `audio` is given) copied audio packet hashes.
pub fn gate(
    output: &Path,
    frames: u64,
    rate: RationalRate,
    size: (u32, u32),
    audio: Option<&[String]>,
) -> Result<(media::Probe, Value)> {
    let checked = (|| -> Result<(media::Probe, Value)> {
        let probe = media::probe(output)?;
        if probe.frames != frames {
            return Err(format!("output has {} frames, expected {frames}", probe.frames).into());
        }
        if probe.rate != rate {
            return Err(format!("output rate {} differs from plan rate {rate}", probe.rate).into());
        }
        if (probe.width, probe.height) != size {
            return Err("output canvas differs from the sources".into());
        }
        let tags = colour_tags(output)?;
        for (key, want) in [
            ("color_space", "bt709"),
            ("color_primaries", "bt709"),
            ("color_transfer", "bt709"),
            ("color_range", "tv"),
            ("pix_fmt", "yuv420p"),
        ] {
            if tags[key] != want {
                return Err(format!("output {key} is {}, expected {want}", tags[key]).into());
            }
        }
        if let Some(expected) = audio
            && media::audio_packet_hashes(output)? != expected
        {
            return Err("output audio packets differ from the approved source".into());
        }
        Ok((probe, tags))
    })();
    checked.map_err(|error| discard(output, error))
}

/// Remove a failed output (file or directory) and return `error`, extended
/// when the removal itself fails so a rejected file is never left silently.
fn discard(path: &Path, error: Box<dyn Error>) -> Box<dyn Error> {
    let removed = if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    match removed {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => format!(
            "{error}; the rejected output {} could not be removed: {e}",
            path.display()
        )
        .into(),
        _ => error,
    }
}

fn encode(
    plan: &StitchPlan,
    paths: &[PathBuf],
    colours: &[Option<Colour>],
    size: (u32, u32),
    audio: Option<&Path>,
    dest: &Path,
) -> Result<u64> {
    let mut command = Command::new("ffmpeg");
    command
        .args(["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24"])
        .args(["-s", &format!("{}x{}", size.0, size.1)])
        .args(["-framerate", &plan.rate.ffmpeg_rate(), "-i", "pipe:0"]);
    if let Some(audio) = audio {
        command.args(crate::media::SAFE_INPUT).arg("-i").arg(audio);
    }
    command.args(["-map", "0:v:0"]);
    if audio.is_some() {
        command.args(["-map", "1:a:0", "-c:a", "copy"]);
    }
    command
        .args([
            "-vf",
            "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv",
            "-c:v",
            "libx264",
            "-crf",
            "18",
            "-preset",
            "medium",
            "-pix_fmt",
            "yuv420p",
            "-colorspace",
            "bt709",
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-color_range",
            "tv",
            "-fps_mode",
            "passthrough",
            "-movflags",
            "+faststart",
        ])
        .arg(dest)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = command.spawn()?;
    let mut stdin = child.stdin.take().ok_or("ffmpeg stdin unavailable")?;
    let composed = compose(plan, paths, colours, |frame| {
        stdin.write_all(frame).map_err(Into::into)
    });
    drop(stdin);
    let finished = child.wait_with_output()?;
    if !finished.status.success() {
        return Err(String::from_utf8_lossy(&finished.stderr)
            .into_owned()
            .into());
    }
    composed
}

/// Build the delivery described by `plan` as `out_dir/stitched.mp4` and return
/// the receipt body. `out_dir` must already exist. On any failed gate the
/// output file is deleted.
pub fn assemble(root: &Root, plan: &StitchPlan, out_dir: &Path) -> Result<Value> {
    plan.validate()?;
    let mut paths = Vec::new();
    let mut colours = Vec::new();
    let mut size = None;
    let mut segments = Vec::new();
    for (i, segment) in plan.segments.iter().enumerate() {
        let path = verified(root, &segment.media)?;
        let probe = media::probe(&path)?;
        let what = format!("segment {}", segment.id);
        probe
            .require_upright_square()
            .map_err(|e| format!("{what}: {e}"))?;
        let colour = Colour::resolve(&probe, segment.colour.as_ref(), &what)?;
        if let Some(t) = probe.color_transfer.as_deref()
            && matches!(t, "smpte2084" | "arib-std-b67")
        {
            return Err(format!(
                "{what}: HDR transfer {t} cannot be stitched into a BT.709 delivery"
            )
            .into());
        }
        if probe.color_primaries.as_deref() == Some("bt2020") {
            return Err(format!(
                "{what}: BT.2020 primaries cannot be stitched into a BT.709 delivery"
            )
            .into());
        }
        if probe.rate != plan.rate {
            return Err(format!(
                "segment {} rate {} differs from plan",
                segment.id, probe.rate
            )
            .into());
        }
        if probe.frames < segment.keep[1] {
            return Err(format!("segment {} has only {} frames", segment.id, probe.frames).into());
        }
        let this = (probe.width, probe.height);
        if size.is_some_and(|s| s != this) || this.0 % 2 != 0 || this.1 % 2 != 0 {
            return Err("segments must share one even canvas".into());
        }
        size = Some(this);
        segments.push(
            json!({"id":segment.id,"media":{"path":root.rel(&segment.media.path)?,
            "sha256":segment.media.sha256},"keep":segment.keep,
            "colour":{"declared":segment.colour.is_some(),"used":colour,
                "tags":{"color_space":probe.color_space,"color_range":probe.color_range,
                    "color_primaries":probe.color_primaries,"color_transfer":probe.color_transfer,
                    "pix_fmt":probe.pix_fmt}},
            "overlap_in":if i>0 {plan.overlaps[i-1]} else {0},
            "overlap_out":plan.overlaps.get(i).copied().unwrap_or(0)}),
        );
        paths.push(path);
        colours.push(colour);
    }
    let size = size.ok_or("no segments")?;
    let mut audio_hashes = None;
    let mut audio_path = None;
    let mut audio_record = json!({"mode":"none"});
    if let Some(audio) = &plan.audio {
        let path = verified(root, &audio.source)?;
        let hashes = media::audio_packet_hashes(&path)?;
        if hashes.is_empty() {
            return Err("audio source has no audio stream".into());
        }
        let digest = packets_digest(&hashes);
        if digest != audio.approved_packets_sha256 {
            return Err("audio source is not the approved bitstream (re-encoded?)".into());
        }
        audio_record = json!({"mode":"copy","source":{"path":root.rel(&audio.source.path)?,
            "sha256":audio.source.sha256},"packets":hashes.len(),"packets_sha256":digest});
        audio_hashes = Some(hashes);
        audio_path = Some(path);
    }
    let dest = out_dir.join("stitched.mp4");
    let expected = plan.expected_frames();
    let encoded = encode(plan, &paths, &colours, size, audio_path.as_deref(), &dest);
    if let Err(error) = encoded {
        return Err(discard(&dest, error));
    }
    let mut sources: Vec<(PathBuf, &str)> = paths
        .iter()
        .cloned()
        .zip(plan.segments.iter().map(|s| s.media.sha256.as_str()))
        .collect();
    if let (Some(path), Some(audio)) = (&audio_path, &plan.audio) {
        sources.push((path.clone(), audio.source.sha256.as_str()));
    }
    if let Err(error) = sources_unchanged(&sources) {
        return Err(discard(&dest, error));
    }
    let (probe, tags) = gate(&dest, expected, plan.rate, size, audio_hashes.as_deref())?;
    let mut receipt = json!({"schema":"stitch-result/1","rate":plan.rate,
        "resolution":{"width":size.0,"height":size.1},
        "frames":{"expected":expected,"decoded":probe.frames,
            "keep_total":plan.segments.iter().map(|s| s.keep[1]-s.keep[0]).sum::<u64>(),
            "overlap_total":plan.overlaps.iter().sum::<u64>()},
        "segments":segments,
        "colour":{"matrix":"bt709","range":"tv","probed":tags},
        "audio":audio_record,
        "output":{"path":root.rel(&dest)?,"sha256":sha256_hex(&fs::read(&dest)?),"probe":probe},
        "status":"PASS",
        "acceptance_note":"stitch gates the assembly only; acceptance is editorial and the seams are measured by seam-qa"});
    crate::acceptance::stamp(&mut receipt);
    Ok(receipt)
}

/// Result of [`plan_retake`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RetakeGeometry {
    /// Clip length in frames.
    pub frames: u64,
    /// Retake interval `[a, b)`.
    pub retake: [u64; 2],
    /// Generation range `[a-pre, b+post)` after clamping to the clip.
    pub generation: [u64; 2],
    /// Pre-roll requested.
    pub pre_requested: u64,
    /// Post-roll requested.
    pub post_requested: u64,
    /// Pre-roll actually available.
    pub pre_applied: u64,
    /// Post-roll actually available.
    pub post_applied: u64,
    /// The head was clamped at frame 0 (no head join).
    pub clamped_head: bool,
    /// The tail was clamped at the clip end (no tail join).
    pub clamped_tail: bool,
    /// Overlap at each join.
    pub overlap: u64,
}

/// Plan the generation range for retaking `[a, b)` of a `frames`-long clip.
/// `pre` and `post` must be at least [`MIN_ROLL`] and at least `overlap`;
/// ranges are clamped to the clip and the clamping is reported.
pub fn plan_retake(
    frames: u64,
    retake: [u64; 2],
    pre: u64,
    post: u64,
    overlap: u64,
) -> Result<RetakeGeometry> {
    let [a, b] = retake;
    if a >= b || b > frames {
        return Err("retake interval must satisfy 0 <= a < b <= frames".into());
    }
    if overlap == 0 || pre < MIN_ROLL.max(overlap) || post < MIN_ROLL.max(overlap) {
        return Err(
            format!("pre and post roll must be at least max({MIN_ROLL}, overlap) frames").into(),
        );
    }
    let g0 = a.saturating_sub(pre);
    let g1 = (b + post).min(frames);
    Ok(RetakeGeometry {
        frames,
        retake,
        generation: [g0, g1],
        pre_requested: pre,
        post_requested: post,
        pre_applied: a - g0,
        post_applied: g1 - b,
        clamped_head: g0 == 0 && a < pre,
        clamped_tail: g1 == frames && frames - b < post,
        overlap,
    })
}

/// Retake plan consumed by `stitch retake`. Unknown fields (masks, roll
/// bookkeeping) are ignored.
#[derive(Clone, Debug, Deserialize)]
pub struct RetakeInput {
    /// Must be [`RETAKE_SCHEMA`].
    pub schema: String,
    /// Clock shared by the original and the generated clip.
    pub rate: RationalRate,
    /// Frames in the original clip.
    pub frames: u64,
    /// Retake interval `[a, b)`.
    pub retake: [u64; 2],
    /// Generation range `[g0, g1)`; the generated clip holds `g1-g0` frames,
    /// frame `k` replacing original frame `g0+k`.
    pub generation: [u64; 2],
    /// Overlap at each join (default [`DEFAULT_OVERLAP`]).
    #[serde(default = "default_overlap")]
    pub overlap: u64,
    /// Original clip.
    pub original: Asset,
    /// Generated clip covering the generation range.
    pub generated: Asset,
    /// Optional approved audio.
    #[serde(default)]
    pub audio: Option<AudioSpec>,
    /// Declared colour of the original clip when it is not completely tagged.
    #[serde(default)]
    pub original_colour: Option<Colour>,
    /// Declared colour of the generated clip when it is not completely tagged.
    #[serde(default)]
    pub generated_colour: Option<Colour>,
    /// Optional unchanged-range PSNR gate configuration.
    #[serde(default)]
    pub thresholds: Option<RetakeThresholds>,
}

fn default_overlap() -> u64 {
    DEFAULT_OVERLAP
}

/// Threshold set for the unchanged-range check; configuration, not constant.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RetakeThresholds {
    /// Minimum PSNR (dB) between delivered and original frames outside the
    /// generation range.
    pub min_unchanged_psnr_db: f64,
    /// Where the numbers come from.
    pub provenance: String,
    /// Removed legacy field: any `true` is refused ([`crate::acceptance`]).
    #[serde(default, skip_serializing)]
    pub calibrated: bool,
    /// Removed legacy field: any value is refused ([`crate::acceptance`]).
    #[serde(
        default,
        skip_serializing,
        deserialize_with = "crate::acceptance::present"
    )]
    pub calibration: Option<serde_json::Value>,
}

impl Default for RetakeThresholds {
    fn default() -> Self {
        Self {
            min_unchanged_psnr_db: 35.0,
            provenance: "uncalibrated-default".into(),
            calibrated: false,
            calibration: None,
        }
    }
}

impl RetakeInput {
    /// Check the geometry (roll ≥ [`MIN_ROLL`] unless clamped at a clip edge).
    pub fn validate(&self) -> Result<()> {
        let ([a, b], [g0, g1], n, o) = (self.retake, self.generation, self.frames, self.overlap);
        if self.schema != RETAKE_SCHEMA || o == 0 || a >= b || b > n || g0 >= g1 || g1 > n {
            return Err("invalid retake plan".into());
        }
        let roll = MIN_ROLL.max(o);
        if g0 > a || g1 < b || (g0 > 0 && a - g0 < roll) || (g1 < n && g1 - b < roll) {
            return Err(format!("generation range needs at least {roll} frames of roll").into());
        }
        Ok(())
    }

    /// The equivalent stitch plan: original head, generated middle, original
    /// tail, with `overlap` frames blended at each join present.
    pub fn to_stitch(&self) -> Result<StitchPlan> {
        self.validate()?;
        let ([g0, g1], n, o) = (self.generation, self.frames, self.overlap);
        let part = |id: &str, media: &Asset, keep: [u64; 2], colour: &Option<Colour>| Segment {
            id: id.into(),
            media: media.clone(),
            keep,
            colour: colour.clone(),
        };
        let mut segments = Vec::new();
        let mut overlaps = Vec::new();
        if g0 > 0 {
            segments.push(part(
                "original-head",
                &self.original,
                [0, g0 + o],
                &self.original_colour,
            ));
            overlaps.push(o);
        }
        segments.push(part(
            "generated",
            &self.generated,
            [0, g1 - g0],
            &self.generated_colour,
        ));
        if g1 < n {
            segments.push(part(
                "original-tail",
                &self.original,
                [g1 - o, n],
                &self.original_colour,
            ));
            overlaps.push(o);
        }
        Ok(StitchPlan {
            schema: STITCH_SCHEMA.into(),
            rate: self.rate,
            segments,
            overlaps,
            audio: self.audio.clone(),
        })
    }

    /// Frame ranges delivered straight from the original (outside generation).
    pub fn unchanged(&self) -> Vec<[u64; 2]> {
        let ([g0, g1], n) = (self.generation, self.frames);
        [[0, g0], [g1, n]]
            .into_iter()
            .filter(|r| r[0] < r[1])
            .collect()
    }
}

fn psnr(a: &[u8], b: &[u8]) -> f64 {
    let sum: u64 = a
        .iter()
        .zip(b)
        .map(|(&x, &y)| u64::from(x.abs_diff(y)).pow(2))
        .sum();
    if sum == 0 {
        return 100.0;
    }
    let mse = sum as f64 / a.len() as f64;
    (10.0 * (255.0f64 * 255.0 / mse).log10()).min(100.0)
}

/// Minimum PSNR (dB) between the decoded `delivered` and `original` frames over
/// `ranges`. Both are decoded at full size in lockstep; the delivery is lossy,
/// so unchanged frames are compared by re-decoding, not by bit-exact hashes.
///
/// `original_colour` is the resolved colour of the original (see
/// [`Colour::resolve`]), so it is decoded exactly as the stitch decoded it.
pub fn min_psnr_over(
    delivered: &Path,
    original: &Path,
    ranges: &[[u64; 2]],
    original_colour: Option<&Colour>,
) -> Result<f64> {
    let wanted = |i: u64| ranges.iter().any(|r| i >= r[0] && i < r[1]);
    let (tx, rx) = mpsc::sync_channel::<(u64, Vec<u8>)>(2);
    let mut worst = 100.0f64;
    let mut compared = 0u64;
    let outcome = std::thread::scope(|scope| {
        let reader = scope.spawn(move || {
            media::for_each_frame_as(original, PixelFormat::Rgb24, None, original_colour, |f| {
                if wanted(f.index) {
                    tx.send((f.index, f.data))
                        .map_err(|_| "comparison stopped")?;
                }
                Ok(())
            })
            .map_err(|e| e.to_string())
        });
        let decoded = media::for_each_frame(delivered, PixelFormat::Rgb24, None, |f| {
            if wanted(f.index) {
                let (index, data) = rx.recv().map_err(|_| "original ended early")?;
                if index != f.index || data.len() != f.data.len() {
                    return Err("original and delivery frames misaligned".into());
                }
                worst = worst.min(psnr(&data, &f.data));
                compared += 1;
            }
            Ok(())
        });
        drop(rx);
        let read = reader.join().map_err(|_| "decoder thread panicked")?;
        decoded.and(read.map_err(Into::into))
    });
    outcome?;
    let total: u64 = ranges.iter().map(|r| r[1] - r[0]).sum();
    if compared != total {
        return Err(format!("compared {compared} frames, expected {total}").into());
    }
    Ok(worst)
}

fn write_json(path: &Path, value: &Value) -> Result<()> {
    fs::write(path, serde_json::to_vec_pretty(value)?)?;
    Ok(())
}

fn usage() -> &'static str {
    "usage: stitch [--root DIR] assemble PLAN NEW_DIR\n\
     \x20      stitch [--root DIR] retake RETAKE_PLAN NEW_DIR\n\
     \x20      stitch plan-retake FRAMES A..B [--pre N] [--post N] [--overlap N]\n\
     Frame-exact stitch with linear overlap blends, BT.709 tags and copied audio.\n\
     NEW_DIR gets stitched.mp4 and complete.json; any failed gate deletes the output."
}

fn run_plan(args: &[OsString]) -> Result<()> {
    let text = |i: usize| args.get(i).and_then(|a| a.to_str());
    let frames: u64 = text(0).ok_or_else(usage)?.parse()?;
    let (a, b) = text(1)
        .and_then(|r| r.split_once(".."))
        .ok_or("interval must look like A..B")?;
    let (mut pre, mut post, mut overlap) = (MIN_ROLL, MIN_ROLL, DEFAULT_OVERLAP);
    let rest = args[2..].chunks(2);
    for pair in rest {
        let value: u64 = pair
            .get(1)
            .and_then(|v| v.to_str())
            .ok_or("option needs a value")?
            .parse()?;
        match pair[0].to_str() {
            Some("--pre") => pre = value,
            Some("--post") => post = value,
            Some("--overlap") => overlap = value,
            _ => return Err(usage().into()),
        }
    }
    let geometry = plan_retake(frames, [a.parse()?, b.parse()?], pre, post, overlap)?;
    let mut value = serde_json::to_value(&geometry)?;
    value["schema"] = GEOMETRY_SCHEMA.into();
    println!("{}", serde_json::to_string_pretty(&value)?);
    Ok(())
}

/// Entry point for the `stitch` binary.
pub fn run(mut args: Vec<OsString>) -> Result<()> {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!("{}", usage());
        return Ok(());
    }
    let root = Root::new(&take_root_option(&mut args)?)?;
    let Some(command) = args.first().and_then(|a| a.to_str()).map(str::to_owned) else {
        return Err(usage().into());
    };
    if command == "plan-retake" {
        return run_plan(&args[1..]);
    }
    if args.len() != 3 || !matches!(command.as_str(), "assemble" | "retake") {
        return Err(usage().into());
    }
    let (plan_path, out_dir) = (
        root.resolve(Path::new(&args[1]))?,
        root.resolve(Path::new(&args[2]))?,
    );
    if out_dir.exists() {
        return Err("output must be new".into());
    }
    let bytes = fs::read(&plan_path)?;
    fs::create_dir(&out_dir)?;
    let outcome = deliver(&root, &command, &bytes, &plan_path, &out_dir);
    let frames = outcome.map_err(|error| discard(&out_dir, error))?;
    println!("{frames}-frame stitch assembled and gated");
    Ok(())
}

fn deliver(
    root: &Root,
    command: &str,
    bytes: &[u8],
    plan_path: &Path,
    out_dir: &Path,
) -> Result<u64> {
    let (plan, retake) = if command == "retake" {
        let input: RetakeInput = serde_json::from_slice(bytes)?;
        (input.to_stitch()?, Some(input))
    } else {
        (serde_json::from_slice::<StitchPlan>(bytes)?, None)
    };
    if let Some(input) = &retake
        && let Some(t) = &input.thresholds
    {
        // Refuse a stale calibration claim before any frame is encoded.
        crate::acceptance::refuse_calibration("stitch", t.calibrated, t.calibration.is_some())?;
    }
    let mut receipt = assemble(root, &plan, out_dir)?;
    let dest = out_dir.join("stitched.mp4");
    if let Some(input) = &retake {
        let thresholds = input.thresholds.clone().unwrap_or_default();
        let original = verified(root, &input.original)?;
        let original_colour = Colour::resolve(
            &media::probe(&original)?,
            input.original_colour.as_ref(),
            "original",
        )?;
        let ranges = input.unchanged();
        let outcome = if ranges.is_empty() {
            Ok(100.0)
        } else {
            min_psnr_over(&dest, &original, &ranges, original_colour.as_ref())
        };
        // The original was hashed, then reopened for the PSNR read: re-hash it so
        // a swap in between (e.g. for the delivery itself) cannot read as 99 dB.
        if let Err(error) = sources_unchanged(&[(original.clone(), input.original.sha256.as_str())])
        {
            return Err(discard(&dest, error));
        }
        let worst = match outcome {
            Ok(w) if w >= thresholds.min_unchanged_psnr_db => w,
            Ok(w) => {
                let error = format!("unchanged frames drifted: min PSNR {w:.2} dB").into();
                return Err(discard(&dest, error));
            }
            Err(error) => {
                return Err(discard(&dest, error));
            }
        };
        receipt["retake"] = json!({"frames":input.frames,"retake":input.retake,
            "generation":input.generation,"overlap":input.overlap,"unchanged_ranges":ranges,
            "unchanged_check":{"method":"re-decoded PSNR against the original (lossy yuv420p delivery, so not bit-exact)",
                "min_psnr_db":worst,"thresholds":thresholds}});
    }
    let frames = receipt["frames"]["decoded"].as_u64().unwrap_or(0);
    receipt["plan"] = json!({"path":root.rel(plan_path)?,"sha256":sha256_hex(bytes)});
    write_json(&out_dir.join("complete.json"), &receipt)?;
    Ok(frames)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::testutil::*;

    fn run_ffmpeg(args: &[&str]) {
        let status = Command::new("ffmpeg")
            .args(["-nostdin", "-v", "error", "-y"])
            .args(args)
            .status()
            .unwrap();
        assert!(status.success());
    }

    fn asset(root: &Path, name: &str) -> Asset {
        Asset {
            path: name.into(),
            sha256: sha256_hex(&fs::read(root.join(name)).unwrap()),
        }
    }

    fn seg(root: &Path, id: &str, name: &str, keep: [u64; 2]) -> Segment {
        Segment {
            id: id.into(),
            media: asset(root, name),
            keep,
            colour: None,
        }
    }

    fn plan(segments: Vec<Segment>, overlaps: Vec<u64>) -> StitchPlan {
        StitchPlan {
            schema: STITCH_SCHEMA.into(),
            rate: RationalRate::new(25, 1).unwrap(),
            segments,
            overlaps,
            audio: None,
        }
    }

    fn solid(dir: &Scratch, name: &str, colour: &str, frames: u32) {
        lavfi(
            &dir.path(name),
            &[&format!(
                "color=c={colour}:s=64x48:r=25:d={}",
                f64::from(frames) / 25.0
            )],
            &[
                "-vf",
                "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv",
                "-c:v",
                "ffv1",
            ],
        );
    }

    fn rgb_frames(path: &Path) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        media::for_each_frame(path, PixelFormat::Rgb24, None, |f| {
            out.push(f.data);
            Ok(())
        })
        .unwrap();
        out
    }

    #[test]
    fn exact_frame_count_across_three_segments_with_overlaps() {
        let s = Scratch::new("stitch-count");
        for (name, c) in [("a.mkv", "red"), ("b.mkv", "green"), ("c.mkv", "blue")] {
            solid(&s, name, c, 20);
        }
        let root = Root::new(&s.0).unwrap();
        let p = plan(
            vec![
                seg(&s.0, "a", "a.mkv", [2, 14]), // 12
                seg(&s.0, "b", "b.mkv", [0, 11]), // 11
                seg(&s.0, "c", "c.mkv", [5, 15]), // 10
            ],
            vec![3, 2],
        );
        assert_eq!(p.expected_frames(), 12 + 11 + 10 - 5);
        fs::create_dir(s.path("out")).unwrap();
        let receipt = assemble(&root, &p, &s.path("out")).unwrap();
        assert_eq!(receipt["frames"]["decoded"], 28);
        assert_eq!(receipt["status"], "PASS");
        assert_eq!(
            receipt["acceptance_backing"], false,
            "stitch alone has no seam QA"
        );
        assert!(
            receipt["acceptance_note"]
                .as_str()
                .unwrap()
                .contains("seam-qa")
        );
        assert_eq!(receipt["output"]["path"], "out/stitched.mp4");
        let probe = media::probe(&s.path("out/stitched.mp4")).unwrap();
        assert_eq!(probe.frames, 28);
        assert_eq!(probe.rate, RationalRate::new(25, 1).unwrap());
    }

    #[test]
    fn blend_weights_follow_j_plus_one_over_o_plus_one() {
        // O = 3: w = 1/4, 2/4, 3/4 between 255 and 0.
        let (a, b) = ([255u8; 3], [0u8; 3]);
        assert_eq!(blend_frame(&a, &b, 0, 3), [191; 3]);
        assert_eq!(blend_frame(&a, &b, 1, 3), [128; 3]);
        assert_eq!(blend_frame(&a, &b, 2, 3), [64; 3]);
    }

    #[test]
    fn blended_overlap_frames_have_the_expected_values_after_encode() {
        let s = Scratch::new("stitch-blend");
        solid(&s, "w.mkv", "white", 10);
        solid(&s, "k.mkv", "black", 10);
        let root = Root::new(&s.0).unwrap();
        let p = plan(
            vec![
                seg(&s.0, "w", "w.mkv", [0, 8]),
                seg(&s.0, "k", "k.mkv", [0, 8]),
            ],
            vec![3],
        );
        fs::create_dir(s.path("out")).unwrap();
        assemble(&root, &p, &s.path("out")).unwrap();
        let frames = rgb_frames(&s.path("out/stitched.mp4"));
        assert_eq!(frames.len(), 13);
        let level = |i: usize| i32::from(frames[i][1]);
        for (i, want) in [
            (0, 255),
            (4, 255),
            (5, 191),
            (6, 128),
            (7, 64),
            (8, 0),
            (12, 0),
        ] {
            assert!(
                (level(i) - want).abs() <= 8,
                "frame {i}: {} vs {want}",
                level(i)
            );
        }
    }

    #[test]
    fn a_count_or_rate_mismatch_deletes_the_output() {
        let s = Scratch::new("stitch-gate");
        solid(&s, "a.mkv", "gray", 10);
        let out = s.path("o.mp4");
        run_ffmpeg(&[
            "-i",
            s.path("a.mkv").to_str().unwrap(),
            "-vf",
            "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709",
            "-c:v",
            "libx264",
            out.to_str().unwrap(),
        ]);
        let rate = RationalRate::new(25, 1).unwrap();
        assert!(gate(&out, 10, rate, (64, 48), None).is_ok());
        assert!(gate(&out, 11, rate, (64, 48), None).is_err());
        assert!(!out.exists(), "frame mismatch must delete the output");
        lavfi(
            &out,
            &["color=c=gray:s=64x48:r=25:d=0.4"],
            &["-c:v", "libx264", "-pix_fmt", "yuv420p"],
        );
        let err = gate(&out, 10, rate, (64, 48), None).unwrap_err();
        assert!(err.to_string().contains("color_space"), "{err}");
        assert!(!out.exists(), "untagged output must be deleted");
        run_ffmpeg(&[
            "-i",
            s.path("a.mkv").to_str().unwrap(),
            "-c:v",
            "libx264",
            out.to_str().unwrap(),
        ]);
        assert!(gate(&out, 10, RationalRate::new(24, 1).unwrap(), (64, 48), None).is_err());
        assert!(!out.exists(), "rate mismatch must delete the output");
    }

    #[test]
    fn audio_packets_survive_the_mux_and_a_reencode_is_rejected() {
        let s = Scratch::new("stitch-audio");
        solid(&s, "a.mkv", "gray", 25);
        solid(&s, "b.mkv", "gray", 25);
        lavfi(
            &s.path("mix.mp4"),
            &[
                "color=c=black:s=16x16:r=25:d=1.5",
                "sine=f=330:r=48000:d=1.5",
            ],
            &["-c:v", "libx264", "-c:a", "aac", "-shortest"],
        );
        run_ffmpeg(&[
            "-i",
            s.path("mix.mp4").to_str().unwrap(),
            "-c:v",
            "copy",
            "-af",
            "volume=0.5",
            "-c:a",
            "aac",
            s.path("re.mp4").to_str().unwrap(),
        ]);
        let root = Root::new(&s.0).unwrap();
        let approved = packets_digest(&media::audio_packet_hashes(&s.path("mix.mp4")).unwrap());
        let mut p = plan(
            vec![
                seg(&s.0, "a", "a.mkv", [0, 25]),
                seg(&s.0, "b", "b.mkv", [0, 25]),
            ],
            vec![5],
        );
        p.audio = Some(AudioSpec {
            source: asset(&s.0, "mix.mp4"),
            approved_packets_sha256: approved.clone(),
        });
        fs::create_dir(s.path("out")).unwrap();
        let receipt = assemble(&root, &p, &s.path("out")).unwrap();
        assert_eq!(receipt["audio"]["mode"], "copy");
        assert_eq!(receipt["audio"]["packets_sha256"], approved.as_str());
        assert_eq!(
            packets_digest(&media::audio_packet_hashes(&s.path("out/stitched.mp4")).unwrap()),
            approved
        );
        p.audio = Some(AudioSpec {
            source: asset(&s.0, "re.mp4"),
            approved_packets_sha256: approved,
        });
        fs::create_dir(s.path("out2")).unwrap();
        let err = assemble(&root, &p, &s.path("out2")).unwrap_err();
        assert!(err.to_string().contains("re-encoded"), "{err}");
        assert!(!s.path("out2/stitched.mp4").exists());
    }

    #[test]
    fn a_source_changed_after_hashing_is_refused() {
        let s = Scratch::new("stitch-rehash");
        let file = s.path("seg.mkv");
        fs::write(&file, b"approved").unwrap();
        let approved = sha256_hex(b"approved");
        assert!(sources_unchanged(&[(file.clone(), approved.as_str())]).is_ok());
        fs::write(&file, b"swapped").unwrap();
        let err = sources_unchanged(&[(file, approved.as_str())])
            .unwrap_err()
            .to_string();
        assert!(err.contains("changed while"), "{err}");
    }

    #[test]
    fn discard_reports_an_output_it_could_not_remove() {
        use std::os::unix::fs::PermissionsExt;
        let s = Scratch::new("stitch-discard");
        let gone = discard(&s.path("absent.mp4"), "gate failed".into()).to_string();
        assert_eq!(gone, "gate failed");
        let file = s.path("bad.mp4");
        fs::write(&file, b"x").unwrap();
        assert_eq!(
            discard(&file, "gate failed".into()).to_string(),
            "gate failed"
        );
        assert!(!file.exists());
        let locked = s.path("locked");
        fs::create_dir(&locked).unwrap();
        let stuck = locked.join("bad.mp4");
        fs::write(&stuck, b"x").unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o555)).unwrap();
        let message = discard(&stuck, "gate failed".into()).to_string();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(
            message.starts_with("gate failed; the rejected output"),
            "{message}"
        );
    }

    #[test]
    fn delivery_is_tagged_bt709() {
        let s = Scratch::new("stitch-tags");
        solid(&s, "a.mkv", "gray", 8);
        let root = Root::new(&s.0).unwrap();
        let p = plan(vec![seg(&s.0, "a", "a.mkv", [0, 8])], vec![]);
        fs::create_dir(s.path("out")).unwrap();
        let receipt = assemble(&root, &p, &s.path("out")).unwrap();
        let tags = colour_tags(&s.path("out/stitched.mp4")).unwrap();
        assert_eq!(tags["color_space"], "bt709");
        assert_eq!(tags["color_primaries"], "bt709");
        assert_eq!(tags["color_transfer"], "bt709");
        assert_eq!(receipt["colour"]["matrix"], "bt709");
    }

    /// Two clips with byte-identical coded pixels; only the colour tags differ.
    fn tagged_and_untagged(s: &Scratch) {
        lavfi(
            &s.path("plain.mp4"),
            &["color=c=0xc02040:s=64x48:r=25:d=1.2,noise=alls=14:allf=t:all_seed=7"],
            &["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "12"],
        );
        run_ffmpeg(&[
            "-i",
            s.path("plain.mp4").to_str().unwrap(),
            "-c",
            "copy",
            "-bsf:v",
            "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0",
            s.path("tagged.mp4").to_str().unwrap(),
        ]);
    }

    fn colour_plan(s: &Scratch, declaration: Option<Value>) -> StitchPlan {
        let mut b = json!({"id":"b","media":asset(&s.0, "plain.mp4"),"keep":[0,20]});
        if let Some(d) = declaration {
            b["colour"] = d;
        }
        serde_json::from_value(json!({"schema":STITCH_SCHEMA,"rate":25,
            "segments":[{"id":"a","media":asset(&s.0, "tagged.mp4"),"keep":[0,20]}, b],
            "overlaps":[0]}))
        .unwrap()
    }

    fn mean_rgb(frame: &[u8]) -> [f64; 3] {
        let n = (frame.len() / 3) as f64;
        let mut sum = [0.0; 3];
        for px in frame.as_chunks::<3>().0 {
            for (c, v) in sum.iter_mut().zip(px) {
                *c += f64::from(*v);
            }
        }
        sum.map(|v| v / n)
    }

    #[test]
    fn untagged_colour_is_refused_unless_declared_and_the_declaration_drives_the_decode() {
        let s = Scratch::new("stitch-untagged");
        tagged_and_untagged(&s);
        let root = Root::new(&s.0).unwrap();
        fs::create_dir(s.path("o1")).unwrap();
        let err = assemble(&root, &colour_plan(&s, None), &s.path("o1"))
            .unwrap_err()
            .to_string();
        assert!(err.contains("untagged") && err.contains("colour"), "{err}");
        let join = |dir: &str, decl: Value| {
            fs::create_dir(s.path(dir)).unwrap();
            let r = assemble(&root, &colour_plan(&s, Some(decl)), &s.path(dir)).unwrap();
            assert_eq!(r["segments"][1]["colour"]["declared"], true);
            let f = rgb_frames(&s.path(&format!("{dir}/stitched.mp4")));
            let (a, b) = (mean_rgb(&f[10]), mean_rgb(&f[30]));
            (0..3).map(|i| (a[i] - b[i]).abs()).fold(0.0, f64::max)
        };
        // Declared as the tagged clip's own colour: the join is continuous.
        let step = join("o2", json!({"matrix":"bt709","range":"tv"}));
        assert!(step < 4.0, "join colour step {step}");
        // A different declared matrix is applied, not ignored.
        let wrong = join("o3", json!({"matrix":"bt601","range":"tv"}));
        assert!(
            wrong > 6.0,
            "bt601 decode should visibly differ, got {wrong}"
        );
        // A declaration that contradicts complete tags is refused.
        let mut p = colour_plan(&s, None);
        p.segments[0].colour =
            serde_json::from_value(json!({"matrix":"bt601","range":"tv"})).unwrap();
        fs::create_dir(s.path("o4")).unwrap();
        let err = assemble(&root, &p, &s.path("o4")).unwrap_err().to_string();
        assert!(err.contains("contradicts"), "{err}");
    }

    #[test]
    fn output_gate_checks_the_declared_range_and_pixel_format() {
        let s = Scratch::new("stitch-range");
        solid(&s, "a.mkv", "gray", 10);
        let out = s.path("full.mp4");
        run_ffmpeg(&[
            "-i",
            s.path("a.mkv").to_str().unwrap(),
            "-vf",
            "scale=out_range=pc,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=pc",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuvj420p",
            "-color_range",
            "pc",
            out.to_str().unwrap(),
        ]);
        let rate = RationalRate::new(25, 1).unwrap();
        let err = gate(&out, 10, rate, (64, 48), None)
            .unwrap_err()
            .to_string();
        assert!(err.contains("color_range"), "{err}");
        assert!(!out.exists());
    }

    #[test]
    fn invalid_plans_are_refused() {
        let s = Scratch::new("stitch-invalid");
        solid(&s, "a.mkv", "gray", 10);
        let one = seg(&s.0, "a", "a.mkv", [0, 6]);
        assert!(
            plan(vec![one.clone(), one.clone()], vec![])
                .validate()
                .is_err()
        );
        assert!(
            plan(vec![one.clone(), one.clone()], vec![7])
                .validate()
                .is_err()
        );
        assert!(
            plan(vec![one.clone(), one.clone(), one.clone()], vec![4, 4])
                .validate()
                .is_err()
        );
        assert!(plan(vec![one.clone(), one], vec![3]).validate().is_ok());
    }

    #[test]
    fn retake_geometry_matches_the_node_pack_cases() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../comfyui-sidecar/nodes/agentbox_video/tests/retake_geometry_cases.json");
        let cases: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        for case in cases["cases"].as_array().unwrap() {
            let n = |k: &str| case[k].as_u64().unwrap();
            let retake = [
                case["retake"][0].as_u64().unwrap(),
                case["retake"][1].as_u64().unwrap(),
            ];
            let got = plan_retake(n("frames"), retake, n("pre"), n("post"), n("overlap"));
            if case["expect"] == "error" {
                assert!(got.is_err(), "{case}");
                continue;
            }
            let got = serde_json::to_value(got.unwrap()).unwrap();
            for (key, want) in case["expect"].as_object().unwrap() {
                assert_eq!(&got[key], want, "{key} in {case}");
            }
        }
    }

    #[test]
    fn retake_geometry_clamps_at_clip_edges_and_reports_it() {
        let g = plan_retake(100, [40, 50], 6, 8, 4).unwrap();
        assert_eq!(g.generation, [34, 58]);
        assert!(!g.clamped_head && !g.clamped_tail);
        let g = plan_retake(100, [2, 50], 6, 8, 4).unwrap();
        assert_eq!(
            (g.generation, g.pre_applied, g.clamped_head),
            ([0, 58], 2, true)
        );
        let g = plan_retake(100, [40, 98], 6, 8, 4).unwrap();
        assert_eq!(
            (g.generation, g.post_applied, g.clamped_tail),
            ([34, 100], 2, true)
        );
        let g = plan_retake(30, [0, 30], 4, 4, 4).unwrap();
        assert_eq!(g.generation, [0, 30]);
        assert!(g.clamped_head && g.clamped_tail);
        assert!(plan_retake(100, [40, 50], 3, 4, 4).is_err()); // roll below 4
        assert!(plan_retake(100, [40, 50], 4, 4, 5).is_err()); // roll below overlap
        assert!(plan_retake(100, [50, 40], 4, 4, 4).is_err());
        assert!(plan_retake(100, [40, 101], 4, 4, 4).is_err());
    }

    fn retake_input(root: &Path, g: &RetakeGeometry) -> RetakeInput {
        RetakeInput {
            schema: RETAKE_SCHEMA.into(),
            rate: RationalRate::new(25, 1).unwrap(),
            frames: g.frames,
            retake: g.retake,
            generation: g.generation,
            overlap: g.overlap,
            original: asset(root, "orig.mkv"),
            generated: asset(root, "gen.mkv"),
            audio: None,
            original_colour: None,
            generated_colour: None,
            thresholds: None,
        }
    }

    #[test]
    fn retake_keeps_frame_count_and_unchanged_frames() {
        let s = Scratch::new("stitch-retake");
        lavfi(
            &s.path("orig.mkv"),
            &["gradients=s=64x48:r=25:d=1.6:speed=0.02"],
            &["-c:v", "ffv1"],
        );
        let g = plan_retake(40, [14, 24], 5, 6, 4).unwrap();
        assert_eq!(g.generation, [9, 30]);
        // The "generated" clip is the original's own generation range.
        run_ffmpeg(&[
            "-i",
            s.path("orig.mkv").to_str().unwrap(),
            "-vf",
            "select='between(n,9,29)',setpts=N/25/TB",
            "-c:v",
            "ffv1",
            s.path("gen.mkv").to_str().unwrap(),
        ]);
        let input = retake_input(&s.0, &g);
        let stitch = input.to_stitch().unwrap();
        assert_eq!(stitch.overlaps, [4, 4]);
        assert_eq!(stitch.expected_frames(), 40);
        let root = Root::new(&s.0).unwrap();
        fs::write(
            s.path("rt.json"),
            serde_json::to_vec(&json!({
            "schema":RETAKE_SCHEMA,"rate":25,"frames":40,"retake":[14,24],"generation":[9,30],
            "original":input.original,"generated":input.generated,"mask":{"ignored":true}}))
            .unwrap(),
        )
        .unwrap();
        run(vec![
            "--root".into(),
            root.dir().into(),
            "retake".into(),
            "rt.json".into(),
            "out".into(),
        ])
        .unwrap();
        // A stale `calibrated: true` or `calibration` field is refused before encoding.
        for (name, extra) in [
            ("cal-true", json!({"calibrated":true})),
            (
                "cal-field",
                json!({"calibration":{"path":"c.json","sha256":"ab"}}),
            ),
            ("cal-null", json!({"calibration":null})),
        ] {
            let mut thresholds = json!({"min_unchanged_psnr_db":35.0,"provenance":"x"});
            thresholds
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            fs::write(
                s.path(&format!("{name}.json")),
                serde_json::to_vec(&json!({
                "schema":RETAKE_SCHEMA,"rate":25,"frames":40,"retake":[14,24],"generation":[9,30],
                "original":input.original,"generated":input.generated,"mask":{"ignored":true},
                "thresholds":thresholds}))
                .unwrap(),
            )
            .unwrap();
            let err = run(vec![
                "--root".into(),
                root.dir().into(),
                "retake".into(),
                format!("{name}.json").into(),
                format!("out-{name}").into(),
            ])
            .unwrap_err()
            .to_string();
            assert!(err.contains("acceptance is editorial"), "{err}");
            assert!(!s.path(&format!("out-{name}/stitched.mp4")).exists());
        }
        let receipt: Value =
            serde_json::from_slice(&fs::read(s.path("out/complete.json")).unwrap()).unwrap();
        assert_eq!(receipt["frames"]["decoded"], 40);
        // The unchanged-range threshold is a measurement: acceptance is editorial.
        assert_eq!(receipt["status"], "PASS", "{receipt:#}");
        assert_eq!(receipt["provisional"], true);
        assert_eq!(receipt["acceptance_backing"], false);
        assert_eq!(receipt["acceptance"], "editorial");
        assert!(
            receipt["retake"]["unchanged_check"]["min_psnr_db"]
                .as_f64()
                .unwrap()
                >= 35.0
        );
        assert_eq!(receipt["plan"]["path"], "rt.json");
        assert!(crate::paths::absolute_paths(&receipt).is_empty());
    }

    #[test]
    fn retake_that_corrupts_unchanged_frames_is_deleted() {
        let s = Scratch::new("stitch-retake-bad");
        lavfi(
            &s.path("orig.mkv"),
            &["gradients=s=64x48:r=25:d=1.6:speed=0.02"],
            &["-c:v", "ffv1"],
        );
        let original = s.path("orig.mkv");
        let delivered = s.path("d.mkv");
        // Delivery that differs from the original everywhere.
        run_ffmpeg(&[
            "-i",
            original.to_str().unwrap(),
            "-vf",
            "negate",
            "-c:v",
            "ffv1",
            delivered.to_str().unwrap(),
        ]);
        let worst = min_psnr_over(&delivered, &original, &[[0, 5]], None).unwrap();
        assert!(worst < 20.0, "{worst}");
        assert!(min_psnr_over(&original, &original, &[[0, 5], [30, 40]], None).unwrap() >= 99.0);
    }

    #[test]
    fn head_only_and_tail_only_retakes_drop_the_missing_join() {
        let fake = Asset {
            path: "x.mkv".into(),
            sha256: "0".into(),
        };
        let input = |g: &RetakeGeometry| RetakeInput {
            schema: RETAKE_SCHEMA.into(),
            rate: RationalRate::new(25, 1).unwrap(),
            frames: g.frames,
            retake: g.retake,
            generation: g.generation,
            overlap: g.overlap,
            original: fake.clone(),
            generated: fake.clone(),
            audio: None,
            original_colour: None,
            generated_colour: None,
            thresholds: None,
        };
        let head = input(&plan_retake(25, [0, 10], 4, 5, 4).unwrap())
            .to_stitch()
            .unwrap();
        assert_eq!(head.segments.len(), 2);
        assert_eq!(
            (head.segments[0].keep, head.overlaps.clone()),
            ([0, 15], vec![4])
        );
        assert_eq!(head.segments[1].keep, [11, 25]);
        assert_eq!(head.expected_frames(), 25);
        let tail = input(&plan_retake(25, [20, 25], 4, 4, 4).unwrap())
            .to_stitch()
            .unwrap();
        assert_eq!(tail.segments.len(), 2);
        assert_eq!(tail.expected_frames(), 25);
        let whole = input(&plan_retake(25, [0, 25], 4, 4, 4).unwrap())
            .to_stitch()
            .unwrap();
        assert_eq!((whole.segments.len(), whole.expected_frames()), (1, 25));
        let mut bad = input(&plan_retake(25, [10, 15], 4, 4, 4).unwrap());
        bad.generation = [8, 19]; // roll of 2 < 4
        assert!(bad.to_stitch().is_err());
    }
}
