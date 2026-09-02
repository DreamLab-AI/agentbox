//! Lossless byte<->character bridging, matching Python's `surrogateescape`.
//!
//! The Python pipeline decodes with `errors="surrogateescape"` so that arbitrary
//! bytes survive a decode/clean/encode round trip untouched. A Rust `String`
//! cannot hold lone surrogates, so undecodable bytes are kept as [`Unit::Raw`]
//! instead. One `Unit` is one Python character: offsets and `len()` therefore
//! agree with the Python for every input, valid UTF-8 or not.

/// One decoded position: either a real character or an undecodable raw byte.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    Char(char),
    Raw(u8),
}

impl Unit {
    /// The character this unit carries, if it decoded cleanly.
    pub fn as_char(self) -> Option<char> {
        match self {
            Unit::Char(c) => Some(c),
            Unit::Raw(_) => None,
        }
    }

    /// Append this unit's original bytes to `out`.
    pub fn encode_into(self, out: &mut Vec<u8>) {
        match self {
            Unit::Char(c) => {
                let mut buf = [0u8; 4];
                out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
            }
            Unit::Raw(b) => out.push(b),
        }
    }
}

/// Decode `data` into units, escaping undecodable bytes rather than losing them.
pub fn decode(data: &[u8]) -> Vec<Unit> {
    let mut units = Vec::with_capacity(data.len());
    let mut rest = data;
    loop {
        match std::str::from_utf8(rest) {
            Ok(text) => {
                units.extend(text.chars().map(Unit::Char));
                return units;
            }
            Err(err) => {
                let good = &rest[..err.valid_up_to()];
                // SAFETY-free: `valid_up_to` guarantees this prefix is UTF-8.
                units.extend(
                    std::str::from_utf8(good)
                        .expect("valid_up_to prefix is UTF-8")
                        .chars()
                        .map(Unit::Char),
                );
                let bad_len = err.error_len().unwrap_or(rest.len() - err.valid_up_to());
                let bad_start = err.valid_up_to();
                for &byte in &rest[bad_start..bad_start + bad_len] {
                    units.push(Unit::Raw(byte));
                }
                rest = &rest[bad_start + bad_len..];
            }
        }
    }
}

/// Re-encode units to the exact bytes they were decoded from.
pub fn encode(units: &[Unit]) -> Vec<u8> {
    let mut out = Vec::with_capacity(units.len());
    for unit in units {
        unit.encode_into(&mut out);
    }
    out
}

/// Render units as a `String`, substituting U+FFFD for raw bytes.
///
/// For display and reporting only — never for writing a cleaned file back.
pub fn to_lossy_string(units: &[Unit]) -> String {
    units
        .iter()
        .map(|unit| match unit {
            Unit::Char(c) => *c,
            Unit::Raw(_) => '\u{FFFD}',
        })
        .collect()
}

/// Decode dropping undecodable bytes, matching Python's `errors="ignore"`.
pub fn decode_ignore(data: &[u8]) -> String {
    decode(data)
        .into_iter()
        .filter_map(Unit::as_char)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_arbitrary_bytes() {
        for case in [
            b"plain ascii".to_vec(),
            "naïve — text\u{200b}".as_bytes().to_vec(),
            vec![0xff, 0xfe, b'a', 0x80],
            vec![0xe2, 0x80], // truncated UTF-8 sequence
        ] {
            assert_eq!(encode(&decode(&case)), case);
        }
    }

    #[test]
    fn one_unit_per_python_character() {
        // "a" + two undecodable bytes + "é" == 4 Python characters.
        let units = decode(&[b'a', 0xff, 0xfe, 0xc3, 0xa9]);
        assert_eq!(units.len(), 4);
        assert_eq!(units[0], Unit::Char('a'));
        assert_eq!(units[1], Unit::Raw(0xff));
        assert_eq!(units[3], Unit::Char('é'));
    }

    #[test]
    fn ignore_drops_undecodable_bytes() {
        assert_eq!(decode_ignore(&[b'a', 0xff, b'b']), "ab");
    }
}
