//! Decoded-media access through `ffmpeg`/`ffprobe` raw pipes.
//!
//! Every measuring tool reads pixels and samples through this module so frame
//! counts, pixel layout and sample format are decided in one place. Nothing is
//! inferred from container metadata alone: [`probe`] counts decoded frames, and
//! the hash helpers hash decoded video frames or copied (undecoded) audio
//! packets, so an audio remux with `-c copy` keeps its packet hashes.
use crate::clock::RationalRate;
use serde::Serialize;
use serde_json::Value;
use std::{
    error::Error,
    io::Read,
    path::Path,
    process::{Command, Stdio},
};

/// Boxed error used by the media helpers.
pub type Result<T> = std::result::Result<T, Box<dyn Error>>;

/// Input options for every ffmpeg/ffprobe read of a production file: local
/// files only, so a playlist or concat list disguised as media cannot make
/// ffmpeg fetch a URL. Place immediately before the input.
pub const SAFE_INPUT: [&str; 2] = ["-protocol_whitelist", "file"];

/// Largest decoded frame accepted, in pixels (64 Mpx, above 8K UHD). Frame
/// buffers are sized from file-declared dimensions, so a crafted header must
/// not drive the allocation.
pub const MAX_FRAME_PIXELS: u64 = 64 * 1024 * 1024;

/// Bytes in one decoded frame, refusing dimensions over [`MAX_FRAME_PIXELS`].
pub fn frame_len(width: u32, height: u32, channels: usize) -> Result<usize> {
    let pixels = u64::from(width) * u64::from(height);
    if pixels > MAX_FRAME_PIXELS {
        return Err(format!(
            "declared frame {width}x{height} exceeds the {MAX_FRAME_PIXELS}-pixel decode cap"
        )
        .into());
    }
    Ok(pixels as usize * channels)
}

fn output(command: &mut Command) -> Result<Vec<u8>> {
    let result = command.output()?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).into_owned().into());
    }
    Ok(result.stdout)
}

/// Decoded facts about a file's first video stream and first audio stream.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Probe {
    /// Frame rate parsed from `r_frame_rate`.
    pub rate: RationalRate,
    /// Frames actually decoded (`-count_frames`), not the container estimate.
    pub frames: u64,
    /// Coded width in pixels.
    pub width: u32,
    /// Coded height in pixels.
    pub height: u32,
    /// Pixel format of the stream (`pix_fmt`).
    pub pix_fmt: String,
    /// Tagged matrix coefficients (`color_space`); `None` when untagged or `unknown`.
    pub color_space: Option<String>,
    /// Tagged range (`tv` or `pc`); `None` when untagged or `unknown`.
    pub color_range: Option<String>,
    /// Tagged colour primaries; `None` when untagged or `unknown`.
    pub color_primaries: Option<String>,
    /// Tagged transfer characteristics; `None` when untagged or `unknown`.
    pub color_transfer: Option<String>,
    /// Sample aspect ratio when the stream declares one other than 1:1.
    pub sar: Option<(u32, u32)>,
    /// Display rotation in degrees from the display-matrix side data or the
    /// `rotate` tag; `0` when none is present.
    pub rotation: i32,
    /// Audio sample rate, if an audio stream exists.
    pub audio_rate: Option<u32>,
    /// Audio channel count, if an audio stream exists.
    pub audio_channels: Option<u32>,
}

impl Probe {
    /// Whether the stream is stored as RGB (or a family without a YUV matrix),
    /// so no matrix is needed to decode it.
    pub fn is_rgb(&self) -> bool {
        [
            "rgb", "bgr", "gbr", "argb", "abgr", "0rgb", "0bgr", "pal8", "gray",
        ]
        .iter()
        .any(|p| self.pix_fmt.starts_with(p))
    }

    /// Refuse a source whose display geometry differs from its coded geometry.
    ///
    /// The raw frame size used for piping is the coded size, but ffmpeg
    /// autorotates and ignores sample aspect ratio when decoding, so a rotated
    /// source would be re-read with its rows reinterpreted (equal byte count,
    /// scrambled picture). Refusing is the fail-closed choice.
    pub fn require_upright_square(&self) -> Result<()> {
        if self.rotation.rem_euclid(360) != 0 {
            return Err(format!(
                "source carries a {} degree display rotation; re-encode it upright before use",
                self.rotation
            )
            .into());
        }
        if let Some((n, d)) = self.sar {
            return Err(format!(
                "source has a non-square sample aspect ratio {n}:{d}; re-encode it with square pixels before use"
            )
            .into());
        }
        Ok(())
    }
}

/// YUV-to-RGB interpretation of a source, declared or taken from its tags.
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Colour {
    /// Matrix coefficients: `bt709`, `bt601`, `smpte170m`, `bt470`, `smpte240m`, `fcc` or `bt2020`.
    pub matrix: String,
    /// Quantisation range: `tv` (limited) or `pc` (full).
    pub range: String,
}

/// Map an ffprobe `color_space` tag to a [`Colour::matrix`] name.
fn tag_matrix(space: &str) -> Result<&'static str> {
    Ok(match space {
        "bt709" => "bt709",
        "bt470bg" => "bt470",
        "smpte170m" => "smpte170m",
        "smpte240m" => "smpte240m",
        "fcc" => "fcc",
        "bt2020nc" => "bt2020",
        other => return Err(format!("unsupported tagged colour space {other}").into()),
    })
}

impl Colour {
    /// Check that both fields name something the decoder understands.
    pub fn validate(&self) -> Result<()> {
        if ![
            "bt709",
            "bt601",
            "smpte170m",
            "bt470",
            "smpte240m",
            "fcc",
            "bt2020",
        ]
        .contains(&self.matrix.as_str())
        {
            return Err(format!("unsupported colour matrix {}", self.matrix).into());
        }
        if !["tv", "pc"].contains(&self.range.as_str()) {
            return Err(format!("colour range must be tv or pc, not {}", self.range).into());
        }
        Ok(())
    }

    /// The colour a probe's tags state, if they state both matrix and range.
    pub fn from_tags(probe: &Probe) -> Result<Option<Colour>> {
        let (Some(space), Some(range)) = (&probe.color_space, &probe.color_range) else {
            return Ok(None);
        };
        let matrix = tag_matrix(space)?;
        let colour = Colour {
            matrix: matrix.into(),
            range: range.clone(),
        };
        colour.validate()?;
        Ok(Some(colour))
    }

    /// Settle how `probe`'s source is decoded: a declaration must agree with
    /// any complete tags; absent a declaration the tags are used; an untagged
    /// YUV source without a declaration is refused rather than guessed.
    /// RGB-stored sources need no matrix and resolve to `None`.
    pub fn resolve(probe: &Probe, declared: Option<&Colour>, what: &str) -> Result<Option<Colour>> {
        if let Some(d) = declared {
            d.validate()?;
        }
        if probe.is_rgb() {
            return Ok(None);
        }
        let tagged = Colour::from_tags(probe).map_err(|e| format!("{what}: {e}"))?;
        // A declaration must also agree with a *partial* tag: a lone range or
        // matrix tag is still the file's own statement.
        if let Some(d) = declared {
            if let Some(range) = &probe.color_range
                && *range != d.range
            {
                return Err(format!(
                    "{what}: declared colour range {} contradicts its tagged range {range}",
                    d.range
                )
                .into());
            }
            if let Some(space) = &probe.color_space {
                let matrix = tag_matrix(space).map_err(|e| format!("{what}: {e}"))?;
                if matrix != d.matrix {
                    return Err(format!(
                        "{what}: declared colour matrix {} contradicts its tagged colour space {space}",
                        d.matrix
                    )
                    .into());
                }
            }
        }
        match (declared, tagged) {
            (Some(d), Some(t)) if *d != t => Err(format!(
                "{what}: declared colour {}/{} contradicts its tags {}/{}",
                d.matrix, d.range, t.matrix, t.range
            )
            .into()),
            (Some(d), _) => Ok(Some(d.clone())),
            (None, Some(t)) => Ok(Some(t)),
            (None, None) => Err(format!(
                "{what}: colour is untagged (color_space {:?}, color_range {:?}); declare colour {{matrix, range}} for it",
                probe.color_space, probe.color_range
            )
            .into()),
        }
    }
}

fn parse_rate(text: &str) -> Option<RationalRate> {
    let (num, den) = text.split_once('/')?;
    RationalRate::new(num.parse().ok()?, den.parse().ok()?).ok()
}

/// Probe a file, decoding every video frame to count it.
pub fn probe(path: &Path) -> Result<Probe> {
    let video: Value = serde_json::from_slice(&output(
        Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-count_frames",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=r_frame_rate,nb_read_frames,width,height,pix_fmt,sample_aspect_ratio,color_space,color_range,color_primaries,color_transfer:stream_side_data:stream_tags=rotate",
                "-of",
                "json",
            ])
            .args(SAFE_INPUT)
            .arg(path),
    )?)?;
    let v = &video["streams"][0];
    let rate = v["r_frame_rate"]
        .as_str()
        .and_then(parse_rate)
        .ok_or("no decodable video stream or frame rate")?;
    let frames = v["nb_read_frames"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .ok_or("decoded frame count unavailable")?;
    let dim = |key: &str| v[key].as_u64().and_then(|n| u32::try_from(n).ok());
    let tag = |key: &str| {
        v[key]
            .as_str()
            .filter(|t| !t.is_empty() && *t != "unknown" && *t != "unspecified")
            .map(str::to_owned)
    };
    let sar = v["sample_aspect_ratio"]
        .as_str()
        .and_then(|t| t.split_once(':'))
        .and_then(|(n, d)| Some((n.parse::<u32>().ok()?, d.parse::<u32>().ok()?)))
        .filter(|(n, d)| n != d && *n != 0 && *d != 0);
    let side = v["side_data_list"]
        .as_array()
        .into_iter()
        .flatten()
        .find_map(|d| d["rotation"].as_f64());
    let legacy = v["tags"]["rotate"]
        .as_str()
        .and_then(|t| t.parse::<f64>().ok());
    let rotation = side.or(legacy).unwrap_or(0.0).round() as i32;
    let audio: Value = serde_json::from_slice(&output(
        Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=sample_rate,channels",
                "-of",
                "json",
            ])
            .args(SAFE_INPUT)
            .arg(path),
    )?)?;
    let a = &audio["streams"][0];
    Ok(Probe {
        rate,
        frames,
        width: dim("width").ok_or("video width unavailable")?,
        height: dim("height").ok_or("video height unavailable")?,
        pix_fmt: v["pix_fmt"].as_str().unwrap_or_default().to_owned(),
        color_space: tag("color_space"),
        color_range: tag("color_range"),
        color_primaries: tag("color_primaries"),
        color_transfer: tag("color_transfer"),
        sar,
        rotation,
        audio_rate: a["sample_rate"].as_str().and_then(|s| s.parse().ok()),
        audio_channels: a["channels"].as_u64().and_then(|n| u32::try_from(n).ok()),
    })
}

/// Pixel layout requested from the decoder.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PixelFormat {
    /// One byte per pixel, BT.601 luma as produced by ffmpeg's `gray` format.
    Gray,
    /// Three bytes per pixel, interleaved R, G, B.
    Rgb24,
}

impl PixelFormat {
    fn name(self) -> &'static str {
        match self {
            PixelFormat::Gray => "gray",
            PixelFormat::Rgb24 => "rgb24",
        }
    }
    /// Bytes per pixel.
    pub fn channels(self) -> usize {
        match self {
            PixelFormat::Gray => 1,
            PixelFormat::Rgb24 => 3,
        }
    }
}

/// One decoded frame in a packed buffer.
#[derive(Clone, Debug)]
pub struct Frame {
    /// Zero-based decoded frame index.
    pub index: u64,
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// Pixel layout of `data`.
    pub format: PixelFormat,
    /// Row-major packed pixels, `width * height * channels` bytes.
    pub data: Vec<u8>,
}

/// Decode every frame of the first video stream, optionally scaled to
/// `size` (width, height) with an area filter, calling `visit` per frame.
/// Frames are streamed, never all held in memory. Returns the frame count.
///
/// Sources with a display rotation or a non-square sample aspect ratio are
/// refused (see [`Probe::require_upright_square`]). The YUV-to-RGB matrix is
/// ffmpeg's own choice from the stream tags; use [`for_each_frame_as`] to pass
/// an explicit one.
pub fn for_each_frame(
    path: &Path,
    format: PixelFormat,
    size: Option<(u32, u32)>,
    visit: impl FnMut(Frame) -> Result<()>,
) -> Result<u64> {
    for_each_frame_as(path, format, size, None, visit)
}

/// [`for_each_frame`] with an explicit source [`Colour`]: the scale filter gets
/// `in_color_matrix` and `in_range`, so the decode is never a guess.
pub fn for_each_frame_as(
    path: &Path,
    format: PixelFormat,
    size: Option<(u32, u32)>,
    colour: Option<&Colour>,
    mut visit: impl FnMut(Frame) -> Result<()>,
) -> Result<u64> {
    let source = probe(path)?;
    source.require_upright_square()?;
    let (width, height) = size.unwrap_or((source.width, source.height));
    if width == 0 || height == 0 {
        return Err("frame size must be non-zero".into());
    }
    let mut command = Command::new("ffmpeg");
    command
        .args(["-nostdin", "-v", "error"])
        .args(SAFE_INPUT)
        .arg("-i")
        .arg(path)
        .args(["-map", "0:v:0", "-fps_mode", "passthrough"]);
    let mut scale = Vec::new();
    if size.is_some() {
        scale.push(format!("{width}:{height}:flags=area"));
    }
    if let Some(c) = colour {
        c.validate()?;
        let range = if c.range == "pc" { "jpeg" } else { "mpeg" };
        scale.push(format!("in_color_matrix={}:in_range={range}", c.matrix));
    }
    if !scale.is_empty() {
        command.args(["-vf", &format!("scale={}", scale.join(":"))]);
    }
    command
        .args(["-f", "rawvideo", "-pix_fmt", format.name(), "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn()?;
    let mut stdout = child.stdout.take().ok_or("ffmpeg stdout unavailable")?;
    let frame_len = frame_len(width, height, format.channels())?;
    let mut index = 0u64;
    let mut visit_error = None;
    loop {
        let mut data = vec![0u8; frame_len];
        match read_full(&mut stdout, &mut data)? {
            0 => break,
            n if n < frame_len => {
                visit_error = Some("truncated frame from decoder".into());
                break;
            }
            _ => {}
        }
        if let Err(error) = visit(Frame {
            index,
            width,
            height,
            format,
            data,
        }) {
            visit_error = Some(error);
            break;
        }
        index += 1;
    }
    drop(stdout);
    let result = child.wait_with_output()?;
    if let Some(error) = visit_error {
        return Err(error);
    }
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).into_owned().into());
    }
    Ok(index)
}

fn read_full(reader: &mut impl Read, buffer: &mut [u8]) -> Result<usize> {
    let mut filled = 0;
    while filled < buffer.len() {
        match reader.read(&mut buffer[filled..])? {
            0 => break,
            n => filled += n,
        }
    }
    Ok(filled)
}

/// Decode the first audio stream to interleaved signed 16-bit PCM at
/// `sample_rate` with `channels` channels. Returns an empty vector when the
/// file has no audio stream.
pub fn decode_audio_s16(path: &Path, sample_rate: u32, channels: u32) -> Result<Vec<i16>> {
    if probe(path)?.audio_rate.is_none() {
        return Ok(Vec::new());
    }
    let bytes = output(
        Command::new("ffmpeg")
            .args(["-nostdin", "-v", "error"])
            .args(SAFE_INPUT)
            .arg("-i")
            .arg(path)
            .args([
                "-map",
                "0:a:0",
                "-f",
                "s16le",
                "-acodec",
                "pcm_s16le",
                "-ar",
                &sample_rate.to_string(),
                "-ac",
                &channels.to_string(),
                "-",
            ]),
    )?;
    Ok(bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|b| i16::from_le_bytes(*b))
        .collect())
}

fn framehash_lines(text: &str) -> Vec<String> {
    text.lines()
        .filter(|line| !line.starts_with('#'))
        .filter_map(|line| line.rsplit_once(',').map(|(_, h)| h.trim().to_owned()))
        .collect()
}

/// SHA-256 of every decoded video frame, in decode order.
pub fn video_frame_hashes(path: &Path) -> Result<Vec<String>> {
    probe(path)?.require_upright_square()?;
    let text = String::from_utf8(output(
        Command::new("ffmpeg")
            .args(["-nostdin", "-v", "error"])
            .args(SAFE_INPUT)
            .arg("-i")
            .arg(path)
            .args(["-map", "0:v:0", "-f", "framehash", "-hash", "sha256", "-"]),
    )?)?;
    Ok(framehash_lines(&text))
}

/// SHA-256 of every audio packet of the first audio stream, copied without
/// decoding. Equal lists mean the audio bitstream survived a remux untouched.
/// Returns an empty list when the file has no audio stream.
pub fn audio_packet_hashes(path: &Path) -> Result<Vec<String>> {
    if probe(path)?.audio_rate.is_none() {
        return Ok(Vec::new());
    }
    let text = String::from_utf8(output(
        Command::new("ffmpeg")
            .args(["-nostdin", "-v", "error"])
            .args(SAFE_INPUT)
            .arg("-i")
            .arg(path)
            .args([
                "-map",
                "0:a:0",
                "-c",
                "copy",
                "-f",
                "framehash",
                "-hash",
                "sha256",
                "-",
            ]),
    )?)?;
    Ok(framehash_lines(&text))
}

/// Test fixtures shared by every module that measures media.
#[cfg(test)]
pub mod testutil {
    use super::*;
    use std::path::PathBuf;

    /// A unique scratch directory removed on drop.
    pub struct Scratch(pub PathBuf);
    impl Scratch {
        /// Create a fresh directory under the system temp dir.
        pub fn new(tag: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!("{tag}-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }
        /// A path inside the scratch directory.
        pub fn path(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// Render a lavfi filtergraph to `out` with ffmpeg; `extra` follows the
    /// inputs (codec, frame limits). Panics on failure.
    pub fn lavfi(out: &Path, inputs: &[&str], extra: &[&str]) {
        let mut c = Command::new("ffmpeg");
        c.args(["-nostdin", "-v", "error", "-y"]);
        for input in inputs {
            c.args(["-f", "lavfi", "-i", input]);
        }
        c.args(extra).arg(out);
        output(&mut c).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::testutil::*;
    use super::*;

    #[test]
    fn a_playlist_disguised_as_media_cannot_reach_the_network() {
        let s = Scratch::new("media-ssrf");
        // A plan may name any file; a playlist must not reach the network. The
        // assertion names our narrower whitelist, so it proves SAFE_INPUT is in
        // effect rather than ffmpeg's own HLS default (`file,crypto,data`).
        let fake = s.path("clip.m3u8");
        std::fs::write(
            &fake,
            "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:9/seg.ts\n#EXT-X-ENDLIST\n",
        )
        .unwrap();
        let err = probe(&fake).unwrap_err().to_string();
        assert!(err.contains("not on whitelist 'file'!"), "{err}");
        let err = for_each_frame(&fake, PixelFormat::Rgb24, None, |_| Ok(()))
            .unwrap_err()
            .to_string();
        assert!(err.contains("not on whitelist 'file'!"), "{err}");
    }

    #[test]
    fn declared_frame_dimensions_are_capped_before_allocation() {
        assert!(frame_len(1920, 1080, 3).is_ok());
        assert!(frame_len(MAX_FRAME_PIXELS as u32, 1, 3).is_ok());
        let err = frame_len(65_535, 65_535, 3).unwrap_err().to_string();
        assert!(err.contains("exceeds"), "{err}");
    }

    #[test]
    fn a_declaration_must_agree_with_a_partial_tag() {
        let probe = |space: Option<&str>, range: Option<&str>| Probe {
            rate: RationalRate::new(25, 1).unwrap(),
            frames: 1,
            width: 2,
            height: 2,
            pix_fmt: "yuv420p".into(),
            color_space: space.map(str::to_owned),
            color_range: range.map(str::to_owned),
            color_primaries: None,
            color_transfer: None,
            sar: None,
            rotation: 0,
            audio_rate: None,
            audio_channels: None,
        };
        let decl = |matrix: &str, range: &str| Colour {
            matrix: matrix.into(),
            range: range.into(),
        };
        // Declaring pc on a tv-tagged source with no matrix tag was a silent pass.
        let err = Colour::resolve(&probe(None, Some("tv")), Some(&decl("bt709", "pc")), "seg")
            .unwrap_err()
            .to_string();
        assert!(err.contains("range"), "{err}");
        let err = Colour::resolve(
            &probe(Some("bt709"), None),
            Some(&decl("bt601", "tv")),
            "seg",
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("matrix"), "{err}");
        // Agreeing with the partial tag is accepted; no tags at all accepts any declaration.
        let ok = Colour::resolve(&probe(None, Some("tv")), Some(&decl("bt709", "tv")), "seg");
        assert_eq!(ok.unwrap(), Some(decl("bt709", "tv")));
        assert!(Colour::resolve(&probe(None, None), Some(&decl("bt709", "pc")), "seg").is_ok());
        // An undeclared partial tag is still refused (never guessed).
        assert!(Colour::resolve(&probe(None, Some("tv")), None, "seg").is_err());
    }

    #[test]
    fn probe_counts_decoded_frames_and_audio() {
        let s = Scratch::new("media-probe");
        let clip = s.path("clip.mkv");
        lavfi(
            &clip,
            &["testsrc2=s=32x16:r=25:d=0.4", "sine=f=440:r=48000:d=0.4"],
            &["-c:v", "ffv1", "-c:a", "pcm_s16le", "-shortest"],
        );
        let p = probe(&clip).unwrap();
        assert_eq!((p.width, p.height, p.frames), (32, 16, 10));
        assert_eq!(p.rate, RationalRate::new(25, 1).unwrap());
        assert_eq!((p.audio_rate, p.audio_channels), (Some(48000), Some(1)));
    }

    #[test]
    fn frames_stream_in_order_with_requested_layout() {
        let s = Scratch::new("media-frames");
        let clip = s.path("clip.mkv");
        lavfi(
            &clip,
            &[
                "color=c=white:s=8x8:r=10:d=0.2[w];color=c=black:s=8x8:r=10:d=0.2[b];[w][b]concat=n=2:v=1:a=0",
            ],
            &["-c:v", "ffv1"],
        );
        let mut luma = Vec::new();
        let n = for_each_frame(&clip, PixelFormat::Gray, Some((4, 4)), |f| {
            assert_eq!(f.data.len(), 16);
            luma.push(f.data[0]);
            Ok(())
        })
        .unwrap();
        assert_eq!(n, 4);
        assert!(luma[0] > 200 && luma[1] > 200 && luma[2] < 40 && luma[3] < 40);
        let mut rgb = 0;
        for_each_frame(&clip, PixelFormat::Rgb24, None, |f| {
            assert_eq!(f.data.len(), 8 * 8 * 3);
            rgb += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(rgb, 4);
    }

    #[test]
    fn visitor_error_stops_decoding_and_is_returned() {
        let s = Scratch::new("media-stop");
        let clip = s.path("clip.mkv");
        lavfi(&clip, &["testsrc2=s=16x16:r=25:d=1"], &["-c:v", "ffv1"]);
        let err = for_each_frame(&clip, PixelFormat::Gray, None, |f| {
            if f.index == 3 {
                Err("stop".into())
            } else {
                Ok(())
            }
        })
        .unwrap_err();
        assert_eq!(err.to_string(), "stop");
    }

    #[test]
    fn audio_packet_hashes_survive_copy_remux_but_not_reencode() {
        let s = Scratch::new("media-audio");
        let a = s.path("a.mkv");
        lavfi(
            &a,
            &["testsrc2=s=16x16:r=25:d=0.4", "sine=f=330:r=48000:d=0.4"],
            &["-c:v", "ffv1", "-c:a", "flac", "-shortest"],
        );
        let remux = s.path("remux.mkv");
        output(
            Command::new("ffmpeg")
                .args(["-nostdin", "-v", "error", "-i"])
                .arg(&a)
                .args(["-c", "copy"])
                .arg(&remux),
        )
        .unwrap();
        let reencoded = s.path("re.mkv");
        output(
            Command::new("ffmpeg")
                .args(["-nostdin", "-v", "error", "-i"])
                .arg(&a)
                .args(["-c:v", "copy", "-af", "volume=0.5", "-c:a", "flac"])
                .arg(&reencoded),
        )
        .unwrap();
        let original = audio_packet_hashes(&a).unwrap();
        assert!(!original.is_empty());
        assert_eq!(original, audio_packet_hashes(&remux).unwrap());
        assert_ne!(original, audio_packet_hashes(&reencoded).unwrap());
        assert_eq!(video_frame_hashes(&a).unwrap().len(), 10);
        let pcm = decode_audio_s16(&a, 8000, 1).unwrap();
        assert!(pcm.len() >= 3000 && pcm.iter().any(|&x| x.unsigned_abs() > 1000));
    }

    fn ffmpeg_run(args: &[&str]) {
        let mut c = Command::new("ffmpeg");
        c.args(["-nostdin", "-v", "error", "-y"]).args(args);
        output(&mut c).unwrap();
    }

    #[test]
    fn rotated_and_non_square_sources_are_refused_everywhere_frames_are_decoded() {
        let s = Scratch::new("media-geometry");
        let base = s.path("base.mp4");
        lavfi(
            &base,
            &["color=c=0x806040:s=64x48:r=25:d=0.4,noise=alls=14:allf=t:all_seed=7"],
            &["-c:v", "libx264", "-pix_fmt", "yuv420p"],
        );
        let rotated = s.path("rot.mp4");
        ffmpeg_run(&[
            "-display_rotation",
            "90",
            "-i",
            base.to_str().unwrap(),
            "-c",
            "copy",
            rotated.to_str().unwrap(),
        ]);
        let skewed = s.path("sar.mp4");
        lavfi(
            &skewed,
            &["color=c=0x806040:s=64x48:r=25:d=0.4,setsar=2/1"],
            &["-c:v", "libx264", "-pix_fmt", "yuv420p"],
        );
        assert_eq!(probe(&rotated).unwrap().rotation, 90);
        assert_eq!(probe(&skewed).unwrap().sar, Some((2, 1)));
        for clip in [&rotated, &skewed] {
            let e = for_each_frame(clip, PixelFormat::Rgb24, None, |_| Ok(()))
                .unwrap_err()
                .to_string();
            assert!(e.contains("rotation") || e.contains("sample aspect"), "{e}");
            let e = for_each_frame(clip, PixelFormat::Gray, Some((8, 8)), |_| Ok(()))
                .unwrap_err()
                .to_string();
            assert!(e.contains("rotation") || e.contains("sample aspect"), "{e}");
            assert!(video_frame_hashes(clip).is_err());
        }
        // The unrotated, square-pixel original still decodes.
        assert_eq!(
            for_each_frame(&base, PixelFormat::Rgb24, None, |_| Ok(())).unwrap(),
            10
        );
    }

    #[test]
    fn colour_tags_are_probed_and_untagged_yuv_is_reported_as_such() {
        let s = Scratch::new("media-colour");
        let plain = s.path("plain.mp4");
        lavfi(
            &plain,
            &["color=c=0x806040:s=64x48:r=25:d=0.2"],
            &["-c:v", "libx264", "-pix_fmt", "yuv420p"],
        );
        let tagged = s.path("tagged.mp4");
        ffmpeg_run(&[
            "-i",
            plain.to_str().unwrap(),
            "-c",
            "copy",
            "-bsf:v",
            "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0",
            tagged.to_str().unwrap(),
        ]);
        let (p, t) = (probe(&plain).unwrap(), probe(&tagged).unwrap());
        assert_eq!(p.color_space, None);
        assert_eq!(t.color_space.as_deref(), Some("bt709"));
        assert_eq!(t.color_range.as_deref(), Some("tv"));
        assert_eq!(t.color_primaries.as_deref(), Some("bt709"));
        assert_eq!(t.color_transfer.as_deref(), Some("bt709"));
        assert!(!p.is_rgb());
    }

    #[test]
    fn silent_file_has_no_audio_hashes_or_pcm() {
        let s = Scratch::new("media-silent");
        let clip = s.path("v.mkv");
        lavfi(&clip, &["testsrc2=s=16x16:r=25:d=0.2"], &["-c:v", "ffv1"]);
        assert!(audio_packet_hashes(&clip).unwrap().is_empty());
        assert!(decode_audio_s16(&clip, 8000, 1).unwrap().is_empty());
    }
}
