//! Refuse to treat containers as text.
//!
//! Decoding a compressed container as text walks its compressed bytes and
//! reports whatever codepoints fall out of them: noise that tracks the
//! compression, not the content. Cleaning such a "text" writes the mangled
//! bytes back and destroys the file.

/// Container magic numbers that get mistaken for text on the command line.
pub const BINARY_MAGIC: &[(&[u8], &str)] = &[
    (
        b"PK\x03\x04",
        "a ZIP container (DOCX, ODT, XLSX, PPTX, EPUB, JAR)",
    ),
    (b"PK\x05\x06", "an empty ZIP container"),
    (b"PK\x07\x08", "a spanned ZIP container"),
    (b"%PDF-", "a PDF"),
    (b"\x89PNG\r\n\x1a\n", "a PNG image"),
    (b"\xff\xd8\xff", "a JPEG image"),
    (b"GIF87a", "a GIF image"),
    (b"GIF89a", "a GIF image"),
    (b"II*\x00", "a TIFF image"),
    (b"MM\x00*", "a TIFF image"),
    (b"RIFF", "a RIFF container (WEBP, WAV, AVI)"),
    (b"OggS", "an Ogg media file"),
    (b"\x1f\x8b", "a gzip archive"),
    (b"BZh", "a bzip2 archive"),
    (b"\xfd7zXZ\x00", "an xz archive"),
    (b"7z\xbc\xaf\x27\x1c", "a 7-Zip archive"),
    (b"Rar!\x1a\x07", "a RAR archive"),
    (b"\x7fELF", "an ELF binary"),
    (b"\xca\xfe\xba\xbe", "a Java class or Mach-O fat binary"),
    (
        b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",
        "a legacy Office document (.doc, .xls, .ppt)",
    ),
    (b"SQLite format 3\x00", "a SQLite database"),
    (b"8BPS", "a Photoshop document"),
    (b"wOFF", "a WOFF font"),
    (b"wOF2", "a WOFF2 font"),
    (b"\x00\x01\x00\x00\x00", "a TrueType font"),
    (b"OTTO", "an OpenType font"),
];

pub const BINARY_SNIFF_BYTES: usize = 8192;

/// Real text runs ~0% control bytes; compressed and executable data runs far
/// above this. Tab, LF, VT, FF, CR and ESC are legitimate in text.
const CONTROL_RATIO_LIMIT: f64 = 0.05;
const ALLOWED_CONTROLS: [u8; 6] = [0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x1B];

/// Describe why `data` is not plausibly text, or `None` when it looks like text.
///
/// Deliberately conservative: encodings other than UTF-8 must keep working, so
/// undecodable bytes alone are not proof. Every caller offers an override.
pub fn looks_binary(data: &[u8]) -> Option<&'static str> {
    if data.is_empty() {
        return None;
    }
    for (magic, label) in BINARY_MAGIC {
        if data.starts_with(magic) {
            return Some(label);
        }
    }
    let head = &data[..data.len().min(BINARY_SNIFF_BYTES)];
    if head.contains(&0) {
        return Some("binary data (contains NUL bytes)");
    }
    let controls = head
        .iter()
        .filter(|b| **b < 0x20 && !ALLOWED_CONTROLS.contains(b))
        .count();
    if controls as f64 / head.len() as f64 > CONTROL_RATIO_LIMIT {
        return Some("binary data (dense in control bytes)");
    }
    None
}

/// Advice for the text-only tools: another binary in this crate handles the file.
pub const TEXT_TOOL_ADVICE: &[&str] = &[
    "Use inspect-file / clean-file, which route by format,",
    "or pass --force-text to scan the raw bytes anyway.",
];

/// Advice for the routers themselves. They *are* inspect-file / clean-file, and
/// `classify` has already ruled out every known container, so pointing back at
/// them would be circular.
pub const ROUTER_ADVICE: &[&str] = &[
    "These bytes match no supported text, image or container format.",
    "Pass --force-text to handle them as text anyway, or --as to force a format.",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_containers_by_magic() {
        assert_eq!(looks_binary(b"PK\x03\x04rest").unwrap(), BINARY_MAGIC[0].1);
        assert!(looks_binary(b"\x89PNG\r\n\x1a\n").unwrap().contains("PNG"));
    }

    #[test]
    fn plain_text_and_empty_input_pass() {
        assert!(looks_binary(b"").is_none());
        assert!(looks_binary(b"hello\tworld\r\n").is_none());
        assert!(looks_binary("naïve — prose".as_bytes()).is_none());
    }

    #[test]
    fn nul_and_control_density_are_caught() {
        assert!(looks_binary(b"abc\x00def").unwrap().contains("NUL"));
        assert!(looks_binary(&[0x01u8; 64]).unwrap().contains("control"));
    }

    #[test]
    fn allowed_controls_do_not_trip_the_ratio() {
        let text: Vec<u8> = vec![b'\n'; 64];
        assert!(looks_binary(&text).is_none());
    }
}
