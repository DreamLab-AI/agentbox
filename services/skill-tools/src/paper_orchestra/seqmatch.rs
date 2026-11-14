//! A faithful port of the parts of Python's `difflib.SequenceMatcher` that
//! `ratio()` needs, including the *autojunk* heuristic.
//!
//! The critique-memory similarity threshold (0.55) was tuned against
//! `SequenceMatcher(None, a, b).ratio()`; a different string-similarity
//! measure would shift which findings are judged to be repeats. Behaviour that
//! matters for parity:
//!
//! - the longest match is the earliest in `a`, then the earliest in `b`;
//! - when `b` has 200 or more elements, any element occurring more than
//!   `len(b) / 100 + 1` times is "popular" and is not used to *seed* a match
//!   (matches are still extended through popular elements).

use std::collections::HashMap;

/// `SequenceMatcher(None, a, b).ratio()` over Unicode scalar values.
///
/// ```
/// use skill_tools::paper_orchestra::seqmatch::ratio;
/// let a: Vec<char> = "abcd".chars().collect();
/// let b: Vec<char> = "bcde".chars().collect();
/// assert!((ratio(&a, &b) - 0.75).abs() < 1e-12);
/// ```
#[must_use]
pub fn ratio(a: &[char], b: &[char]) -> f64 {
    let total = a.len() + b.len();
    if total == 0 {
        return 1.0;
    }
    2.0 * matching_total(a, b) as f64 / total as f64
}

/// Case-insensitive ratio of two strings, as critique memory uses it.
#[must_use]
pub fn similarity(a: &str, b: &str) -> f64 {
    let a: Vec<char> = a.to_lowercase().chars().collect();
    let b: Vec<char> = b.to_lowercase().chars().collect();
    ratio(&a, &b)
}

fn b2j(b: &[char]) -> HashMap<char, Vec<usize>> {
    let mut map: HashMap<char, Vec<usize>> = HashMap::new();
    for (j, &c) in b.iter().enumerate() {
        map.entry(c).or_default().push(j);
    }
    let n = b.len();
    if n >= 200 {
        let ntest = n / 100 + 1;
        map.retain(|_, idxs| idxs.len() <= ntest);
    }
    map
}

fn longest_match(
    a: &[char],
    b: &[char],
    b2j: &HashMap<char, Vec<usize>>,
    alo: usize,
    ahi: usize,
    blo: usize,
    bhi: usize,
) -> (usize, usize, usize) {
    let (mut besti, mut bestj, mut bestsize) = (alo, blo, 0usize);
    let mut j2len: HashMap<usize, usize> = HashMap::new();
    for (i, ai) in a.iter().enumerate().take(ahi).skip(alo) {
        let mut newj2len: HashMap<usize, usize> = HashMap::new();
        if let Some(js) = b2j.get(ai) {
            for &j in js {
                if j < blo {
                    continue;
                }
                if j >= bhi {
                    break;
                }
                let k = j2len.get(&j.wrapping_sub(1)).copied().unwrap_or(0) + 1;
                newj2len.insert(j, k);
                if k > bestsize {
                    besti = i + 1 - k;
                    bestj = j + 1 - k;
                    bestsize = k;
                }
            }
        }
        j2len = newj2len;
    }
    // Extend through elements the index skipped (popular ones).
    while besti > alo && bestj > blo && a[besti - 1] == b[bestj - 1] {
        besti -= 1;
        bestj -= 1;
        bestsize += 1;
    }
    while besti + bestsize < ahi
        && bestj + bestsize < bhi
        && a[besti + bestsize] == b[bestj + bestsize]
    {
        bestsize += 1;
    }
    (besti, bestj, bestsize)
}

fn matching_total(a: &[char], b: &[char]) -> usize {
    let index = b2j(b);
    let mut queue = vec![(0usize, a.len(), 0usize, b.len())];
    let mut total = 0;
    while let Some((alo, ahi, blo, bhi)) = queue.pop() {
        let (i, j, k) = longest_match(a, b, &index, alo, ahi, blo, bhi);
        if k > 0 {
            total += k;
            if alo < i && blo < j {
                queue.push((alo, i, blo, j));
            }
            if i + k < ahi && j + k < bhi {
                queue.push((i + k, ahi, j + k, bhi));
            }
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(a: &str, b: &str) -> f64 {
        similarity(a, b)
    }

    #[test]
    fn matches_difflib_on_known_values() {
        // difflib: SequenceMatcher(None,"abcd","bcde").ratio() == 0.75
        assert!((r("abcd", "bcde") - 0.75).abs() < 1e-12);
        // difflib docs example: ratio("private Thread currentThread;", "private volatile Thread currentThread;")
        // = 0.8656716417910447 (a=29 chars, b=38 chars, 29 matched).
        let v = r(
            "private Thread currentThread;",
            "private volatile Thread currentThread;",
        );
        assert!((v - 2.0 * 29.0 / 67.0).abs() < 1e-12, "{v}");
        assert_eq!(r("", ""), 1.0);
        assert_eq!(r("abc", ""), 0.0);
        assert_eq!(r("Same Text", "same text"), 1.0);
    }

    #[test]
    fn autojunk_matches_python_difflib() {
        // Expected values were produced by CPython's difflib.SequenceMatcher(None, a, b).ratio().
        // With b >= 200 elements, popular elements cannot seed a match but the match is still
        // extended through them, so the all-popular case is 10 matches of 220, not zero.
        let a = "x".repeat(10);
        let b = format!("{}{}", "x".repeat(150), "y".repeat(60));
        assert!((r(&a, &b) - 0.09090909090909091).abs() < 1e-15);
        let cases: [(&str, &str, f64); 2] = [
            (
                "and attention evaluation model fails baseline when the model sweep collapse model",
                "fails omits omits fails under fails baseline omits model when under model evaluation model under model baseline attention context omits attention baseline when context baseline heads when collapse the when baseline fails model collapse temperature baseline omits and ablations ablations the context under heads under",
                0.1309823677581864,
            ),
            (
                "the temperature when when temperature ablations temperature temperature context fails attention when",
                "and long temperature heads sweep the collapse sweep the attention baseline the sweep context fails long sweep the heads the under baseline baseline sweep and under collapse under evaluation under collapse sweep temperature the the the long temperature long collapse the ablations the the fails",
                0.22900763358778625,
            ),
        ];
        for (a, b, want) in cases {
            assert!((r(a, b) - want).abs() < 1e-15, "{} vs {want}", r(a, b));
        }
    }
}
