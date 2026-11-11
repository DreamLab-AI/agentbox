//! Frame arithmetic. Every time handed to the page is computed from an integer frame index,
//! never accumulated, so a frame rendered alone equals the same frame rendered in a run.

/// Number of frames in a film: frames `0..n`.
pub fn frame_count(dur: f64, fps: f64) -> u64 {
    (dur * fps).round().max(0.0) as u64
}

/// Time in seconds of frame `i`.
pub fn frame_time(i: u64, fps: f64) -> f64 {
    i as f64 / fps
}

/// Time of sub-frame `k` of `sub` within frame `i`: a 180 degree shutter, so the sub-frames
/// span the first half of the frame interval.
pub fn sub_time(i: u64, k: u32, sub: u32, fps: f64) -> f64 {
    (i as f64 + k as f64 * 0.5 / sub as f64) / fps
}

/// Index of a sub-frame file within one render range, so one ffmpeg pass can average them.
pub fn sub_index(i: u64, from: u64, k: u32, sub: u32) -> u64 {
    (i - from) * sub as u64 + k as u64
}

/// Output size. A draft is half size, rounded to even dimensions for the encoder.
pub fn output_size(w: u32, h: u32, draft: bool) -> (u32, u32) {
    if draft {
        (((w as f64 / 4.0).round() as u32) * 2, ((h as f64 / 4.0).round() as u32) * 2)
    } else {
        (w, h)
    }
}

/// The frame range `[from, to)` selected by optional `--from` / `--to` seconds.
pub fn frame_range(from_s: Option<f64>, to_s: Option<f64>, fps: f64, n: u64) -> (u64, u64) {
    let from = from_s.map(|s| (s * fps).round().max(0.0) as u64).unwrap_or(0).min(n);
    let to = to_s.map(|s| ((s * fps).round().max(0.0) as u64).min(n)).unwrap_or(n);
    (from, to.max(from))
}

/// Eight sample times spread through the film for the determinism check.
pub fn verify_times(n: u64, fps: f64) -> Vec<f64> {
    (0..8u64).map(|k| ((k as f64 + 0.5) * n as f64 / 8.0).floor() / fps).collect()
}

/// The order in which the determinism check revisits its samples: fixed, and not ascending,
/// so a page that carries state from one frame to the next is caught.
pub fn verify_order() -> [usize; 8] {
    let mut o: Vec<usize> = (0..8).rev().collect();
    o.sort_by_key(|x| (x * 7) % 5);
    [o[0], o[1], o[2], o[3], o[4], o[5], o[6], o[7]]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_and_times() {
        assert_eq!(frame_count(15.0, 60.0), 900);
        assert_eq!(frame_time(90, 60.0), 1.5);
        assert_eq!(sub_time(90, 0, 3, 60.0), 1.5);
        assert!(sub_time(90, 2, 3, 60.0) < frame_time(91, 60.0));
        assert!((sub_time(90, 2, 3, 60.0) - (90.0 + 1.0 / 3.0) / 60.0).abs() < 1e-12);
    }

    #[test]
    fn sub_indices_are_dense_from_zero_for_any_range() {
        let (from, sub) = (720, 3);
        let v: Vec<u64> = (from..from + 2).flat_map(|i| (0..sub).map(move |k| sub_index(i, from, k, sub))).collect();
        assert_eq!(v, vec![0, 1, 2, 3, 4, 5]);
    }

    #[test]
    fn ranges_clamp_to_the_film() {
        assert_eq!(frame_range(None, None, 60.0, 900), (0, 900));
        assert_eq!(frame_range(Some(12.0), Some(12.5), 60.0, 900), (720, 750));
        assert_eq!(frame_range(Some(14.0), Some(99.0), 60.0, 900), (840, 900));
        assert_eq!(frame_range(Some(5.0), Some(1.0), 60.0, 900), (300, 300));
    }

    #[test]
    fn draft_is_half_size_and_even() {
        assert_eq!(output_size(1920, 1080, true), (960, 540));
        assert_eq!(output_size(1080, 1350, true), (540, 676));
        assert_eq!(output_size(1920, 1080, false), (1920, 1080));
    }

    #[test]
    fn verify_samples_sit_on_frames_and_are_revisited_out_of_order() {
        let t = verify_times(900, 60.0);
        assert_eq!(t.len(), 8);
        assert!(t.iter().all(|x| ((x * 60.0).round() - x * 60.0).abs() < 1e-9));
        let mut o = verify_order().to_vec();
        assert_ne!(o, (0..8).collect::<Vec<_>>());
        o.sort();
        assert_eq!(o, (0..8).collect::<Vec<_>>());
    }
}
