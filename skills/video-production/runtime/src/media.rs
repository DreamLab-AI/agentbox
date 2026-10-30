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
    /// Audio sample rate, if an audio stream exists.
    pub audio_rate: Option<u32>,
    /// Audio channel count, if an audio stream exists.
    pub audio_channels: Option<u32>,
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
                "stream=r_frame_rate,nb_read_frames,width,height",
                "-of",
                "json",
            ])
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
            .arg(path),
    )?)?;
    let a = &audio["streams"][0];
    Ok(Probe {
        rate,
        frames,
        width: dim("width").ok_or("video width unavailable")?,
        height: dim("height").ok_or("video height unavailable")?,
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
pub fn for_each_frame(
    path: &Path,
    format: PixelFormat,
    size: Option<(u32, u32)>,
    mut visit: impl FnMut(Frame) -> Result<()>,
) -> Result<u64> {
    let (width, height) = match size {
        Some(s) => s,
        None => {
            let p = probe(path)?;
            (p.width, p.height)
        }
    };
    if width == 0 || height == 0 {
        return Err("frame size must be non-zero".into());
    }
    let mut command = Command::new("ffmpeg");
    command
        .args(["-nostdin", "-v", "error", "-i"])
        .arg(path)
        .args(["-map", "0:v:0", "-fps_mode", "passthrough"]);
    if size.is_some() {
        command.args(["-vf", &format!("scale={width}:{height}:flags=area")]);
    }
    command
        .args(["-f", "rawvideo", "-pix_fmt", format.name(), "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn()?;
    let mut stdout = child.stdout.take().ok_or("ffmpeg stdout unavailable")?;
    let frame_len = width as usize * height as usize * format.channels();
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
            .args(["-nostdin", "-v", "error", "-i"])
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
    let text = String::from_utf8(output(
        Command::new("ffmpeg")
            .args(["-nostdin", "-v", "error", "-i"])
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
            .args(["-nostdin", "-v", "error", "-i"])
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

    #[test]
    fn silent_file_has_no_audio_hashes_or_pcm() {
        let s = Scratch::new("media-silent");
        let clip = s.path("v.mkv");
        lavfi(&clip, &["testsrc2=s=16x16:r=25:d=0.2"], &["-c:v", "ffv1"]);
        assert!(audio_packet_hashes(&clip).unwrap().is_empty());
        assert!(decode_audio_s16(&clip, 8000, 1).unwrap().is_empty());
    }
}
