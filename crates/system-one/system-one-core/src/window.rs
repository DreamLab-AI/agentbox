//! Splitting a state that is larger than the engine's context into overlapping
//! windows.
//!
//! # Why overlap, and why 25%
//!
//! The engine re-encodes the state for every question (`laya 0.3.4,
//! laya/common.py:build_sequence` builds one sequence per question), so a state
//! that does not fit cannot be fixed by asking fewer questions — it has to be
//! cut. A hard cut at a fixed stride will eventually land in the middle of the
//! one sentence that decides the answer, and neither neighbouring window will
//! contain it whole. An overlap of a quarter of the window guarantees that any
//! span shorter than the overlap appears intact in at least one window, which is
//! the property the aggregation rules in [`crate::aggregate`] rely on — most
//! obviously `noul`, whose rule is "present in any window means present".
//!
//! # Recency
//!
//! The engine can truncate state from the left, keeping the tail
//! (`laya 0.3.4, laya/common.py:build_sequence`, `truncate_left=True`). For
//! compaction the tail *is* the answer: the most recent turns decide what may be
//! dropped. [`WindowAlign::End`] reproduces that preference without losing
//! coverage — windows are laid out backwards from the end, so the final window
//! is always full and aligned to the last character, and any ragged remainder
//! falls in the *first* window instead of the last.
//!
//! ```
//! use system_one_core::window::{window_state, WindowOptions};
//!
//! let state = "sentence. ".repeat(500);
//! let windows = window_state(&state, 128, &WindowOptions::default());
//!
//! assert!(windows.len() > 1);
//! assert_eq!(windows.first().unwrap().start_char, 0);
//! assert_eq!(windows.last().unwrap().end_char, state.chars().count());
//! ```

use crate::tokens::{chars_for_tokens, estimate_tokens};

/// The default fraction of each window shared with its neighbour.
pub const DEFAULT_OVERLAP: f64 = 0.25;

/// The default number of windows a façade evaluates per question.
///
/// State is re-encoded per question, so each extra window is a whole extra
/// forward pass. Two is the contract's default and the number the evaluator
/// measures.
pub const DEFAULT_WINDOW_K: usize = 2;

/// Which end of the state the window grid is anchored to.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WindowAlign {
    /// Anchor at the beginning. The first window is full; the last may be short.
    #[default]
    Start,
    /// Anchor at the end, mirroring the engine's left-truncation. The last
    /// window is full and ends exactly at the final character; the first may be
    /// short. Use this when recency decides the answer.
    End,
}

/// How to window a state.
///
/// ```
/// use system_one_core::window::{WindowAlign, WindowOptions};
///
/// let recency = WindowOptions::default()
///     .with_align(WindowAlign::End)
///     .with_max_windows(Some(2));
/// assert_eq!(recency.align, WindowAlign::End);
/// ```
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WindowOptions {
    /// Fraction of a window shared with the previous one, clamped to
    /// `0.0..=0.9`. Defaults to [`DEFAULT_OVERLAP`].
    pub overlap: f64,
    /// Anchor end. Defaults to [`WindowAlign::Start`].
    pub align: WindowAlign,
    /// Cap on how many windows to return. `None` keeps them all, which is the
    /// only setting under which the windows are guaranteed to cover the whole
    /// input; with a cap, [`WindowAlign::Start`] keeps the head and
    /// [`WindowAlign::End`] keeps the tail.
    pub max_windows: Option<usize>,
}

impl Default for WindowOptions {
    fn default() -> Self {
        Self {
            overlap: DEFAULT_OVERLAP,
            align: WindowAlign::Start,
            max_windows: None,
        }
    }
}

impl WindowOptions {
    /// Set the overlap fraction, builder style.
    #[must_use]
    pub fn with_overlap(mut self, overlap: f64) -> Self {
        self.overlap = overlap;
        self
    }

    /// Set the anchor end, builder style.
    #[must_use]
    pub fn with_align(mut self, align: WindowAlign) -> Self {
        self.align = align;
        self
    }

    /// Set the window cap, builder style.
    #[must_use]
    pub fn with_max_windows(mut self, max_windows: Option<usize>) -> Self {
        self.max_windows = max_windows;
        self
    }
}

/// One window of a state, with the character range it came from.
///
/// Positions are in characters, not bytes, because that is the unit the token
/// estimate uses and the unit a human reading a log can check. The text itself
/// is always a valid `str` — windows are cut on character boundaries by
/// construction, so a multibyte state cannot produce a broken window.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Window {
    /// Position in the returned sequence, from zero.
    pub index: usize,
    /// The window's text.
    pub text: String,
    /// First character of the window in the original state, inclusive.
    pub start_char: usize,
    /// One past the last character of the window in the original state.
    pub end_char: usize,
}

impl Window {
    /// Estimated tokens of this window's text.
    #[must_use]
    pub fn tokens(&self) -> usize {
        estimate_tokens(&self.text)
    }

    /// Characters in this window.
    #[must_use]
    pub fn len_chars(&self) -> usize {
        self.end_char - self.start_char
    }
}

/// Split `state` into overlapping windows of at most `window_tokens` estimated
/// tokens each.
///
/// A state that already fits returns exactly one window covering all of it, so
/// a caller never needs a special case for the common path. With
/// [`WindowOptions::max_windows`] left at `None`, the returned windows always
/// cover `0..state.chars().count()` with no gap.
///
/// ```
/// use system_one_core::window::{window_state, WindowAlign, WindowOptions};
///
/// // Short state: one window, no copying of the whole corpus to discover it.
/// let windows = window_state("short", 128, &WindowOptions::default());
/// assert_eq!(windows.len(), 1);
/// assert_eq!(windows[0].text, "short");
///
/// // Recency: anchor at the end and keep the last two windows.
/// let state: String = (0..400).map(|i| format!("line {i}\n")).collect();
/// let tail = window_state(
///     &state,
///     64,
///     &WindowOptions::default().with_align(WindowAlign::End).with_max_windows(Some(2)),
/// );
/// assert_eq!(tail.len(), 2);
/// assert_eq!(tail[1].end_char, state.chars().count());
/// assert!(tail[1].text.ends_with("line 399\n"));
/// ```
#[must_use]
pub fn window_state(state: &str, window_tokens: usize, options: &WindowOptions) -> Vec<Window> {
    // Byte offset of every character, plus a sentinel for the end. One pass,
    // and every slice below is then a boundary by construction.
    let mut offsets: Vec<usize> = state.char_indices().map(|(byte, _)| byte).collect();
    offsets.push(state.len());
    let total = offsets.len() - 1;

    if total == 0 {
        return vec![Window {
            index: 0,
            text: String::new(),
            start_char: 0,
            end_char: 0,
        }];
    }

    let width = chars_for_tokens(window_tokens.max(1)).max(1);
    if total <= width {
        return vec![Window {
            index: 0,
            text: state.to_owned(),
            start_char: 0,
            end_char: total,
        }];
    }

    let overlap = options.overlap.clamp(0.0, 0.9);
    #[allow(
        clippy::cast_precision_loss,
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss
    )]
    let overlap_chars = ((width as f64) * overlap).round() as usize;
    let stride = width.saturating_sub(overlap_chars).max(1);

    let mut starts: Vec<usize> = Vec::new();
    match options.align {
        WindowAlign::Start => {
            let mut start = 0usize;
            loop {
                starts.push(start);
                if start + width >= total {
                    break;
                }
                start += stride;
            }
        }
        WindowAlign::End => {
            let mut start = total - width;
            loop {
                starts.push(start);
                if start == 0 {
                    break;
                }
                start = start.saturating_sub(stride);
            }
            starts.reverse();
        }
    }

    if let Some(max) = options.max_windows {
        let max = max.max(1);
        if starts.len() > max {
            match options.align {
                WindowAlign::Start => starts.truncate(max),
                WindowAlign::End => {
                    starts.drain(..starts.len() - max);
                }
            }
        }
    }

    starts
        .into_iter()
        .enumerate()
        .map(|(index, start)| {
            let end = (start + width).min(total);
            Window {
                index,
                text: state[offsets[start]..offsets[end]].to_owned(),
                start_char: start,
                end_char: end,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn covers(windows: &[Window], total: usize) -> bool {
        if windows.is_empty() {
            return total == 0;
        }
        if windows[0].start_char != 0 || windows.last().unwrap().end_char != total {
            return false;
        }
        windows
            .windows(2)
            .all(|pair| pair[1].start_char <= pair[0].end_char)
    }

    #[test]
    fn windows_cover_the_whole_input_at_every_alignment() {
        for len in [1usize, 7, 64, 513, 5000] {
            let state: String = (0..len)
                .map(|i| char::from(b'a' + (i % 26) as u8))
                .collect();
            for tokens in [1usize, 4, 32, 128] {
                for align in [WindowAlign::Start, WindowAlign::End] {
                    let options = WindowOptions::default().with_align(align);
                    let windows = window_state(&state, tokens, &options);
                    assert!(
                        covers(&windows, len),
                        "len={len} tokens={tokens} align={align:?} windows={}",
                        windows.len()
                    );
                    for window in &windows {
                        assert!(window.len_chars() <= chars_for_tokens(tokens).max(1));
                        assert_eq!(window.text.chars().count(), window.len_chars());
                    }
                }
            }
        }
    }

    #[test]
    fn a_state_that_fits_is_one_window() {
        let windows = window_state("small state", 128, &WindowOptions::default());
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].start_char, 0);
        assert_eq!(windows[0].text, "small state");
    }

    #[test]
    fn empty_state_is_one_empty_window() {
        let windows = window_state("", 128, &WindowOptions::default());
        assert_eq!(windows.len(), 1);
        assert!(windows[0].text.is_empty());
    }

    #[test]
    fn multibyte_states_are_never_cut_mid_character() {
        let state = "日本語のテキスト、".repeat(400);
        let total = state.chars().count();
        for tokens in [1usize, 3, 16, 100] {
            let windows = window_state(&state, tokens, &WindowOptions::default());
            assert!(covers(&windows, total));
            let rebuilt: String = windows.iter().map(|w| w.text.clone()).collect();
            assert!(rebuilt.contains("日本語"));
            for window in &windows {
                assert!(window.text.chars().next().is_some());
            }
        }
    }

    #[test]
    fn overlap_is_a_quarter_by_default() {
        let state = "x".repeat(1000);
        let windows = window_state(&state, 25, &WindowOptions::default()); // width 100
        assert_eq!(windows[0].end_char, 100);
        assert_eq!(windows[1].start_char, 75); // 25% shared
    }

    #[test]
    fn zero_overlap_produces_disjoint_windows() {
        let state = "x".repeat(1000);
        let windows = window_state(&state, 25, &WindowOptions::default().with_overlap(0.0));
        assert_eq!(windows[1].start_char, 100);
        assert_eq!(windows.len(), 10);
    }

    #[test]
    fn end_alignment_keeps_the_tail_whole() {
        let state: String = (0..300).map(|i| format!("{i} ")).collect();
        let total = state.chars().count();
        let windows = window_state(
            &state,
            16,
            &WindowOptions::default().with_align(WindowAlign::End),
        );
        let last = windows.last().unwrap();
        assert_eq!(last.end_char, total);
        assert_eq!(last.len_chars(), 64); // full width, not a ragged remainder
    }

    #[test]
    fn capping_keeps_the_head_at_start_and_the_tail_at_end() {
        let state = "x".repeat(1000);
        let head = window_state(
            &state,
            25,
            &WindowOptions::default().with_max_windows(Some(2)),
        );
        assert_eq!(head.len(), 2);
        assert_eq!(head[0].start_char, 0);

        let tail = window_state(
            &state,
            25,
            &WindowOptions::default()
                .with_align(WindowAlign::End)
                .with_max_windows(Some(2)),
        );
        assert_eq!(tail.len(), 2);
        assert_eq!(tail[1].end_char, 1000);
        assert_eq!(tail[0].index, 0); // indices are renumbered over what is returned
    }
}
