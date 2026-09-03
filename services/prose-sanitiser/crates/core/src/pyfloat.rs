//! Python's `str(float)` rendering, for message-level parity with the ported CLIs.
//!
//! The Python scanners interpolate parsed floats straight into finding messages
//! (`f"line-height {v} is tight"`). CPython's `str(float)` always shows a decimal
//! point, so an integral `1.0` renders as `"1.0"`; Rust's `{}` renders it `"1"`.
//! Formatting the raw regex capture is preferred where the Python does that too —
//! this helper exists only for the sites where the Python formats the *parsed*
//! value, and dropping the `.0` would change user-visible output.
//!
//! Scope: the finite, human-scale magnitudes these rules parse (CSS lengths,
//! ratios, strengths). CPython switches to exponent form outside roughly
//! `1e-4 ..= 1e16`; this helper does not reproduce that, because no caller can
//! reach it — the regexes admit only plain decimal literals.

/// Render `value` the way CPython's `str(float)` would for a plain decimal.
///
/// ```
/// use prose_sanitiser_core::py_str_float;
/// assert_eq!(py_str_float(1.0), "1.0");
/// assert_eq!(py_str_float(0.5), "0.5");
/// assert_eq!(py_str_float(1.25), "1.25");
/// ```
pub fn py_str_float(value: f64) -> String {
    if value.is_finite() && value == value.trunc() && value.abs() < 1e15 {
        format!("{value:.1}")
    } else {
        format!("{value}")
    }
}

#[cfg(test)]
mod tests {
    use super::py_str_float;

    #[test]
    fn integral_values_keep_pythons_trailing_point_zero() {
        assert_eq!(py_str_float(1.0), "1.0");
        assert_eq!(py_str_float(0.0), "0.0");
        assert_eq!(py_str_float(12.0), "12.0");
    }

    #[test]
    fn fractional_values_render_shortest_round_trip() {
        assert_eq!(py_str_float(0.25), "0.25");
        assert_eq!(py_str_float(0.3), "0.3");
        assert_eq!(py_str_float(1.25), "1.25");
        assert_eq!(py_str_float(1.15), "1.15");
    }
}
