//! Container and payload decoding for draw.io inputs.
//!
//! Handles the four shapes draw.io writes — raw `mxfile`/`mxGraphModel` XML, a
//! base64 + raw-deflate + URL-encoded `<diagram>` payload, a PNG carrying an
//! `mxfile` text chunk, and an SVG carrying an escaped `content` attribute —
//! under hard size caps at every step. Nothing here fetches or executes.

use base64::alphabet;
use base64::engine::general_purpose::GeneralPurposeConfig;
use base64::engine::{Engine, GeneralPurpose};
use flate2::{Decompress, FlushDecompress, Status};
use regex::Regex;
use std::sync::OnceLock;

use crate::entities::unescape;
use crate::{Fail, Failable};

pub const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";
pub const MAX_INPUT_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_XML_BYTES: usize = 64 * 1024 * 1024;

/// The zlib window-bits values the Python tries, in order.
#[derive(Clone, Copy)]
pub enum Wrapper {
    /// `wbits = -15`: raw deflate, which is what draw.io actually writes.
    Raw,
    /// `wbits = 15`: a zlib header.
    Zlib,
    /// `wbits = 47`: header auto-detection, which at this point means gzip.
    Gzip,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DecodeError {
    TooLarge,
    Stream,
}

/// `_decompress_limited` — never lets a small payload expand without bound.
pub fn decompress_limited(
    data: &[u8],
    wrapper: Wrapper,
    limit: usize,
) -> Result<Vec<u8>, DecodeError> {
    let (mut decoder, data) = match wrapper {
        Wrapper::Raw => (Decompress::new(false), data),
        Wrapper::Zlib => (Decompress::new(true), data),
        // `wbits = 47` is header auto-detection; zlib has already been tried by
        // the time this runs, so the remaining case is gzip. flate2's gzip
        // window mode needs a non-default backend, so the header is stripped
        // here and the body inflated raw.
        Wrapper::Gzip => match strip_gzip_header(data) {
            Some(body) => (Decompress::new(false), body),
            None => return Err(DecodeError::Stream),
        },
    };
    let mut out: Vec<u8> = Vec::new();
    let mut scratch = vec![0u8; 64 * 1024];
    let mut consumed = 0usize;
    loop {
        let before_in = decoder.total_in();
        let before_out = decoder.total_out();
        let status = decoder
            .decompress(&data[consumed..], &mut scratch, FlushDecompress::None)
            .map_err(|_| DecodeError::Stream)?;
        let produced = (decoder.total_out() - before_out) as usize;
        let read = (decoder.total_in() - before_in) as usize;
        consumed += read;
        out.extend_from_slice(&scratch[..produced]);
        if out.len() > limit {
            return Err(DecodeError::TooLarge);
        }
        if status == Status::StreamEnd {
            return Ok(out);
        }
        if produced == 0 && read == 0 {
            return Err(DecodeError::Stream);
        }
    }
}

/// Skip an RFC 1952 gzip header, returning the raw deflate body.
fn strip_gzip_header(data: &[u8]) -> Option<&[u8]> {
    if data.len() < 10 || data[0] != 0x1f || data[1] != 0x8b || data[2] != 0x08 {
        return None;
    }
    let flags = data[3];
    let mut offset = 10usize;
    if flags & 0b0000_0100 != 0 {
        let extra = *data.get(offset)? as usize | (*data.get(offset + 1)? as usize) << 8;
        offset = offset.checked_add(2)?.checked_add(extra)?;
    }
    for mask in [0b0000_1000u8, 0b0001_0000] {
        if flags & mask != 0 {
            let end = data.get(offset..)?.iter().position(|byte| *byte == 0)?;
            offset += end + 1;
        }
    }
    if flags & 0b0000_0010 != 0 {
        offset = offset.checked_add(2)?;
    }
    data.get(offset..)
}

fn lenient_base64() -> &'static GeneralPurpose {
    static ENGINE: OnceLock<GeneralPurpose> = OnceLock::new();
    ENGINE.get_or_init(|| {
        GeneralPurpose::new(
            &alphabet::STANDARD,
            GeneralPurposeConfig::new()
                .with_decode_padding_mode(base64::engine::DecodePaddingMode::Indifferent)
                .with_decode_allow_trailing_bits(true),
        )
    })
}

/// `base64.b64decode(payload, validate=False)` — non-alphabet characters are
/// discarded before decoding, and a length that cannot be a base64 body fails.
pub fn lenient_b64_decode(payload: &str) -> Option<Vec<u8>> {
    let filtered: String = payload
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '+' || *ch == '/')
        .collect();
    if filtered.len() % 4 == 1 {
        return None;
    }
    lenient_base64().decode(filtered.as_bytes()).ok()
}

/// `urllib.parse.unquote(text, errors="replace")`.
pub fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = (bytes[index + 1] as char).to_digit(16);
            let low = (bytes[index + 2] as char).to_digit(16);
            if let (Some(high), Some(low)) = (high, low) {
                out.push((high * 16 + low) as u8);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `_inflate` — undo draw.io's base64 + raw-deflate + URL-encoding pipeline.
pub fn inflate(payload: &str) -> Failable<Option<String>> {
    let Some(raw) = lenient_b64_decode(payload) else {
        return Ok(None);
    };
    for wrapper in [Wrapper::Raw, Wrapper::Zlib, Wrapper::Gzip] {
        match decompress_limited(&raw, wrapper, MAX_XML_BYTES) {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes).into_owned();
                // draw.io URL-encodes before deflating; this is a no-op if it did not.
                return Ok(Some(percent_decode(&text)));
            }
            Err(DecodeError::TooLarge) => {
                return Err(Fail::new(format!(
                    "decoded diagram exceeds the {} MiB limit",
                    MAX_XML_BYTES / (1024 * 1024)
                )))
            }
            Err(DecodeError::Stream) => continue,
        }
    }
    Ok(None)
}

/// `_png_embedded_xml` — pull the `mxfile` tEXt/zTXt/iTXt chunk out of a PNG.
pub fn png_embedded_xml(data: &[u8]) -> Failable<Option<String>> {
    let mut position = PNG_MAGIC.len();
    while position + 8 <= data.len() {
        let length = u32::from_be_bytes([
            data[position],
            data[position + 1],
            data[position + 2],
            data[position + 3],
        ]) as usize;
        let ctype = &data[position + 4..position + 8];
        let body_end = position.saturating_add(8).saturating_add(length);
        let chunk_end = body_end.saturating_add(4);
        if chunk_end > data.len() {
            return Err(Fail::new("PNG has a truncated metadata chunk"));
        }
        let body = &data[position + 8..body_end];
        position = chunk_end;
        if !matches!(ctype, b"tEXt" | b"zTXt" | b"iTXt") {
            if ctype == b"IEND" {
                break;
            }
            continue;
        }
        let (key, rest) = match body.iter().position(|byte| *byte == 0) {
            Some(index) => (&body[..index], &body[index + 1..]),
            None => (body, &body[body.len()..]),
        };
        if !key.eq_ignore_ascii_case(b"mxfile") {
            continue;
        }
        let value: Vec<u8> = match ctype {
            b"tEXt" => rest.to_vec(),
            b"zTXt" => {
                if rest.is_empty() {
                    return Err(Fail::new("PNG has invalid compressed draw.io metadata"));
                }
                decompress_chunk(&rest[1..])?
            }
            _ => {
                // iTXt: compression flag, method, language, translated key, text.
                let flag = rest.first().copied();
                let tail: &[u8] = if rest.len() > 2 {
                    split_last_nul_field(&rest[2..], 2)
                } else {
                    &[]
                };
                if flag == Some(1) {
                    decompress_chunk(tail)?
                } else {
                    tail.to_vec()
                }
            }
        };
        let text = String::from_utf8_lossy(&value).into_owned();
        return Ok(Some(percent_decode(&text)));
    }
    Ok(None)
}

fn decompress_chunk(data: &[u8]) -> Failable<Vec<u8>> {
    match decompress_limited(data, Wrapper::Zlib, MAX_XML_BYTES) {
        Ok(bytes) => Ok(bytes),
        Err(DecodeError::TooLarge) => Err(Fail::new(format!(
            "embedded PNG diagram exceeds the {} MiB limit",
            MAX_XML_BYTES / (1024 * 1024)
        ))),
        Err(DecodeError::Stream) => Err(Fail::new("PNG has invalid compressed draw.io metadata")),
    }
}

/// `rest[2:].split(b"\x00", 2)[-1]` — the text after the language and
/// translated-keyword fields.
fn split_last_nul_field(data: &[u8], max_splits: usize) -> &[u8] {
    let mut start = 0usize;
    for _ in 0..max_splits {
        match data[start..].iter().position(|byte| *byte == 0) {
            Some(index) => start += index + 1,
            None => break,
        }
    }
    &data[start..]
}

fn content_attribute() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?is)\bcontent\s*=\s*(?:"(.*?)"|'(.*?)')"#).unwrap())
}

/// `_svg_embedded_xml`.
pub fn svg_embedded_xml(text: &str) -> Option<String> {
    for capture in content_attribute().captures_iter(text) {
        let raw = capture
            .get(1)
            .or_else(|| capture.get(2))
            .map(|group| group.as_str())
            .unwrap_or("");
        let candidate = unescape(raw);
        if candidate.contains("<mxfile") || candidate.contains("<mxGraphModel") {
            return Some(candidate);
        }
    }
    None
}
