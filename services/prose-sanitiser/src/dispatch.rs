//! Route a file or byte stream to the text, image or container pipeline.
//!
//! The routers (`inspect-file`, `clean-file`), the audits and the HTTP service
//! all need the same answer: given a path or bytes, which pipeline owns it?
//! That decision used to live in three copies with subtly different extension
//! tables and sniffing. This module is the single interface for it.

use std::path::Path;

use crate::container::detect_container_format;
use crate::image::detect_format as detect_image_format;

/// Which pipeline owns a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Text,
    Image,
    Container,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Text => "text",
            Kind::Image => "image",
            Kind::Container => "container",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "text" => Some(Kind::Text),
            "image" => Some(Kind::Image),
            "container" => Some(Kind::Container),
            _ => None,
        }
    }
}

pub const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp"];
pub const CONTAINER_EXTS: &[&str] =
    &["svg", "pdf", "docx", "odt", "html", "htm", "md", "markdown", "mdx"];
pub const TEXT_EXTS: &[&str] = &[
    "txt", "text", "css", "js", "py", "rs", "go", "json", "yaml", "yml", "toml", "csv",
];

/// Classify `data` by extension first, then by magic bytes.
///
/// The extension wins when it names a known format; otherwise the bytes are
/// sniffed for image/container signatures. Unrecognised bytes fall back to
/// text — callers that must not mangle unknown binaries guard themselves.
///
/// `data` must cover the whole file: zip-based containers (docx/odt) are
/// detected from their central directory, which sits at the end of the bytes.
pub fn classify_bytes(data: &[u8], suffix: Option<&str>) -> Kind {
    // The Python received `path.suffix`, which includes the leading dot.
    let extension = suffix
        .unwrap_or("")
        .trim_start_matches('.')
        .to_lowercase();
    if IMAGE_EXTS.contains(&extension.as_str()) {
        return Kind::Image;
    }
    if CONTAINER_EXTS.contains(&extension.as_str()) {
        return Kind::Container;
    }
    if TEXT_EXTS.contains(&extension.as_str()) {
        return Kind::Text;
    }
    if matches!(detect_image_format(data), "png" | "jpeg" | "webp") {
        return Kind::Image;
    }
    if !data.is_empty() {
        let sniff_name = if extension.is_empty() {
            "input".to_string()
        } else {
            format!("input.{extension}")
        };
        if detect_container_format(Path::new(&sniff_name), Some(data)) != "unknown" {
            return Kind::Container;
        }
    }
    Kind::Text
}

/// Classify a file on disk by extension, then by its bytes.
pub fn classify(path: &Path) -> std::io::Result<Kind> {
    let data = std::fs::read(path)?;
    let suffix = path.extension().map(|ext| ext.to_string_lossy().into_owned());
    Ok(classify_bytes(&data, suffix.as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_known_extension_wins_over_the_bytes() {
        // PNG magic, but a .md name: the extension is authoritative.
        assert_eq!(classify_bytes(b"\x89PNG\r\n\x1a\n", Some("md")), Kind::Container);
        assert_eq!(classify_bytes(b"plain words", Some("png")), Kind::Image);
        assert_eq!(classify_bytes(b"%PDF-1.7", Some("txt")), Kind::Text);
    }

    #[test]
    fn the_leading_dot_is_optional_and_case_is_ignored() {
        assert_eq!(classify_bytes(b"x", Some(".PNG")), Kind::Image);
        assert_eq!(classify_bytes(b"x", Some("Md")), Kind::Container);
    }

    #[test]
    fn unknown_extensions_fall_through_to_the_bytes() {
        assert_eq!(classify_bytes(b"\x89PNG\r\n\x1a\n", Some("bin")), Kind::Image);
        assert_eq!(classify_bytes(b"\xff\xd8\xff\xe0", None), Kind::Image);
        assert_eq!(classify_bytes(b"%PDF-1.7", Some("bin")), Kind::Container);
        assert_eq!(classify_bytes(b"<svg xmlns='x'>", None), Kind::Container);
    }

    #[test]
    fn unrecognised_bytes_default_to_text() {
        assert_eq!(classify_bytes(b"just some words", None), Kind::Text);
        assert_eq!(classify_bytes(b"", None), Kind::Text);
        // An unknown binary also lands here; the callers guard it separately.
        assert_eq!(classify_bytes(&[0x00, 0x01, 0x02], None), Kind::Text);
    }

    #[test]
    fn classify_reads_the_whole_file_so_zip_directories_are_seen() {
        use std::io::Write;
        use zip::write::SimpleFileOptions;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.bin");
        let mut buffer = std::io::Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            writer
                .start_file("word/document.xml", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"<w:document/>").unwrap();
            writer.finish().unwrap();
        }
        std::fs::write(&path, buffer.into_inner()).unwrap();
        assert_eq!(classify(&path).unwrap(), Kind::Container);
    }

    #[test]
    fn kind_round_trips_through_its_string_form() {
        for kind in [Kind::Text, Kind::Image, Kind::Container] {
            assert_eq!(Kind::parse(kind.as_str()), Some(kind));
        }
        assert_eq!(Kind::parse("auto"), None);
    }
}
