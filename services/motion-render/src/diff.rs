//! Decides whether two captures of the same instant are the same picture.

use anyhow::{bail, Context, Result};

/// How two frames differ.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Diff {
    /// Pixels where any channel differs.
    pub pixels: u64,
    /// Largest per-channel difference, 0..=255.
    pub max: u8,
    /// Pixels in the frame.
    pub total: u64,
}

/// Verdict on a [`Diff`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// Bit-exact.
    Same,
    /// A handful of anti-aliasing pixels from the glyph cache: fewer than 0.005% of the
    /// frame and no channel off by more than 32.
    Noise,
    /// Anything more: the page leaks state between frames.
    Mismatch,
}

impl Diff {
    /// Classify the difference.
    pub fn verdict(&self) -> Verdict {
        if self.pixels == 0 {
            Verdict::Same
        } else if (self.pixels as f64) / (self.total as f64) < 5e-5 && self.max <= 32 {
            Verdict::Noise
        } else {
            Verdict::Mismatch
        }
    }
}

fn decode_rgba(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>)> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().context("not a PNG")?;
    let size = reader.output_buffer_size().context("PNG too large")?;
    let mut buf = vec![0u8; size];
    let info = reader.next_frame(&mut buf).context("truncated PNG")?;
    buf.truncate(info.buffer_size());
    let px = (info.width as usize) * (info.height as usize);
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => buf.chunks_exact(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect(),
        png::ColorType::GrayscaleAlpha => buf.chunks_exact(2).flat_map(|c| [c[0], c[0], c[0], c[1]]).collect(),
        png::ColorType::Grayscale => buf.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        other => bail!("unexpected PNG colour type {other:?}"),
    };
    if rgba.len() != px * 4 {
        bail!("PNG decoded to {} bytes, expected {}", rgba.len(), px * 4);
    }
    Ok((info.width, info.height, rgba))
}

/// Compare two PNG files held in memory, pixel by pixel.
pub fn compare_png(a: &[u8], b: &[u8]) -> Result<Diff> {
    let (wa, ha, pa) = decode_rgba(a)?;
    let (wb, hb, pb) = decode_rgba(b)?;
    if (wa, ha) != (wb, hb) {
        bail!("frames differ in size: {wa}x{ha} against {wb}x{hb}");
    }
    let (mut pixels, mut max) = (0u64, 0u8);
    for (x, y) in pa.chunks_exact(4).zip(pb.chunks_exact(4)) {
        let d = (0..4).map(|i| x[i].abs_diff(y[i])).max().unwrap_or(0);
        if d > 0 {
            pixels += 1;
            max = max.max(d);
        }
    }
    Ok(Diff { pixels, max, total: wa as u64 * ha as u64 })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_of(w: u32, h: u32, rgba: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, w, h);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            enc.write_header().unwrap().write_image_data(rgba).unwrap();
        }
        out
    }

    #[test]
    fn identical_frames_are_same() {
        let a = png_of(4, 4, &[10; 64]);
        let d = compare_png(&a, &a).unwrap();
        assert_eq!(d, Diff { pixels: 0, max: 0, total: 16 });
        assert_eq!(d.verdict(), Verdict::Same);
    }

    #[test]
    fn a_few_faint_pixels_are_noise_and_more_is_a_mismatch() {
        let (w, h) = (400u32, 300u32);
        let base = vec![100u8; (w * h * 4) as usize];
        let mut faint = base.clone();
        for p in 0..5 { faint[p * 4] = 120; }
        let d = compare_png(&png_of(w, h, &base), &png_of(w, h, &faint)).unwrap();
        assert_eq!((d.pixels, d.max, d.total), (5, 20, 120_000));
        assert_eq!(d.verdict(), Verdict::Noise);

        let mut strong = base.clone();
        strong[0] = 200;
        assert_eq!(compare_png(&png_of(w, h, &base), &png_of(w, h, &strong)).unwrap().verdict(), Verdict::Mismatch);

        let mut many = base.clone();
        for p in 0..7 { many[p * 4 + 1] = 101; }
        assert_eq!(compare_png(&png_of(w, h, &base), &png_of(w, h, &many)).unwrap().verdict(), Verdict::Mismatch);
    }

    #[test]
    fn alpha_differences_count() {
        let a = png_of(1, 1, &[0, 0, 0, 255]);
        let b = png_of(1, 1, &[0, 0, 0, 0]);
        assert_eq!(compare_png(&a, &b).unwrap().max, 255);
    }

    #[test]
    fn size_mismatch_and_garbage_are_errors() {
        assert!(compare_png(&png_of(1, 1, &[0; 4]), &png_of(2, 1, &[0; 8])).is_err());
        assert!(compare_png(b"not a png", b"not a png").is_err());
    }
}
