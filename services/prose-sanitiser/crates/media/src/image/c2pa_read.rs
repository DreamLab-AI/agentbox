//! C2PA manifest reading and validation, via the official `c2pa` crate.
//!
//! **Read and validate only.** Removal is never done here. `c2pa-rs` exposes
//! removal solely as the internal `CAIWriter::remove_cai_store_from_stream` and
//! `AssetIO::remove_cai_store` trait methods, reachable only through its
//! largely private `jumbf_io` machinery — there is no top-level
//! `c2pa::remove_manifest`, and `c2patool` has no `--remove` flag. Stripping is
//! therefore done at the container level in [`super::png`], [`super::jpeg`] and
//! [`super::webp`], which delete the `caBX` chunk, the APP11 JUMBF segments and
//! the `C2PA` RIFF chunk outright.
//!
//! # What a clean container does and does not prove
//!
//! Removing the manifest store removes the *hard binding*. It does not make the
//! asset unlinkable.
//!
//! C2PA defines a **soft binding** as "a content identifier that is either not
//! statistically unique, such as a fingerprint, or embedded as an invisible
//! watermark", and a **Durable Content Credential** as one whose soft binding
//! lets a validator rediscover the manifest after the container was stripped.
//! The [Soft Binding Resolution API][sbr] specifies exactly that flow, and
//! Adobe runs a live implementation: for a TrustMark-watermarked asset it
//! returns the full manifest store from `cai-manifests.adobe.com`, from the
//! pixels alone.
//!
//! This crate performs lossless container surgery. It cannot detect, identify
//! or remove a pixel-domain watermark (SynthID-Image, Stable Signature,
//! Tree-Ring, TrustMark, StegaStamp), and a stripped container does not defeat
//! a durable Content Credential. [`C2paReport::declares_soft_binding`] reports
//! only what the manifest *said before it was removed*; absence of the
//! assertion is not evidence that no watermark is present.
//!
//! [sbr]: https://spec.c2pa.org/specifications/specifications/2.4/softbinding/Decoupled.html
//!
//! # Build configuration
//!
//! Behind the default `c2pa-read` feature. The dependency is declared with
//! `default-features = false`, which drops the OpenSSL C dependency in favour of
//! the pure-Rust crypto backend and removes every HTTP backend, so no remote
//! manifest can be fetched and nothing about the asset leaves the machine.
//! Without the feature the report is still produced, with `available` false.

use serde_json::{json, Value};

/// What the official SDK could tell us about an asset's manifest store.
#[derive(Debug, Clone, Default)]
pub struct C2paReport {
    /// False when the crate was built without the `c2pa-read` feature.
    pub available: bool,
    /// True when a manifest store was found and parsed.
    pub present: bool,
    /// How many manifests the store holds.
    pub manifests: usize,
    /// The active manifest's claim generator string, if any.
    pub claim_generator: Option<String>,
    /// The active manifest's title, if any.
    pub title: Option<String>,
    /// `Invalid`, `Valid` or `Trusted`, as the SDK judged the store.
    pub validation_state: Option<String>,
    /// True when any manifest carries a `c2pa.soft-binding` assertion, i.e. the
    /// asset declares a durable credential.
    pub declares_soft_binding: bool,
    /// The soft-binding algorithm identifiers named by those assertions.
    pub soft_binding_algorithms: Vec<String>,
    /// Why reading failed, when it failed for a reason other than "no manifest".
    pub error: Option<String>,
}

impl C2paReport {
    /// The report as JSON, including the durability caveat when it applies.
    pub fn to_json(&self) -> Value {
        let mut notes: Vec<String> = Vec::new();
        if self.present {
            notes.push(
                "removing this manifest removes the hard binding only; a soft binding \
                 (fingerprint or invisible watermark) can still resolve the original manifest \
                 from a cloud repository"
                    .to_string(),
            );
        }
        if self.declares_soft_binding {
            notes.push(
                "this asset declares a soft binding: it is a durable Content Credential and \
                 stripping the container will not unlink it"
                    .to_string(),
            );
        }
        json!({
            "available": self.available,
            "present": self.present,
            "manifests": self.manifests,
            "claim_generator": self.claim_generator,
            "title": self.title,
            "validation_state": self.validation_state,
            "declares_soft_binding": self.declares_soft_binding,
            "soft_binding_algorithms": self.soft_binding_algorithms,
            "error": self.error,
            "notes": notes,
        })
    }
}

/// Read and validate the C2PA manifest store embedded in `data`.
///
/// `format` is the container hint (`"png"`, `"jpeg"`, `"webp"`, `"pdf"`, …);
/// the SDK sniffs the leading bytes first and only falls back to the hint.
///
/// Never mutates and never writes. An asset with no manifest is not an error:
/// it reports `present: false`.
#[cfg(feature = "c2pa-read")]
pub fn read_c2pa(data: &[u8], format: &str) -> C2paReport {
    use c2pa::assertions::labels::SOFT_BINDING;
    use c2pa::{Error, Reader};
    use std::io::Cursor;

    let mut report = C2paReport {
        available: true,
        ..C2paReport::default()
    };

    let reader = match Reader::default().with_stream(format, Cursor::new(data)) {
        Ok(reader) => reader,
        // No manifest store is the common case, not a failure.
        Err(Error::JumbfNotFound) => return report,
        Err(error) => {
            report.error = Some(error.to_string());
            return report;
        }
    };

    report.present = true;
    report.manifests = reader.iter_manifests().count();
    report.validation_state = Some(format!("{:?}", reader.validation_state()));
    if let Some(active) = reader.active_manifest() {
        report.claim_generator = active.claim_generator().map(str::to_string);
        report.title = active.title().map(str::to_string);
    }

    for manifest in reader.iter_manifests() {
        for assertion in manifest.assertions() {
            if !assertion.label().starts_with(SOFT_BINDING) {
                continue;
            }
            report.declares_soft_binding = true;
            if let Some(alg) = assertion
                .value()
                .ok()
                .and_then(|value| value.get("alg"))
                .and_then(Value::as_str)
            {
                let alg = alg.to_string();
                if !report.soft_binding_algorithms.contains(&alg) {
                    report.soft_binding_algorithms.push(alg);
                }
            }
        }
    }
    report
}

/// Stub used when the crate is built without the `c2pa-read` feature.
///
/// Reports `available: false` rather than silently claiming a clean asset.
#[cfg(not(feature = "c2pa-read"))]
pub fn read_c2pa(_data: &[u8], _format: &str) -> C2paReport {
    C2paReport {
        error: Some("built without the `c2pa-read` feature".to_string()),
        ..C2paReport::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::image::png::build_chunk;
    use crate::image::PNG_SIG;

    fn minimal_png() -> Vec<u8> {
        let mut out = PNG_SIG.to_vec();
        out.extend_from_slice(&build_chunk(
            b"IHDR",
            &[0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0],
        ));
        out.extend_from_slice(&build_chunk(b"IDAT", &[0x78, 0x9C, 0x63, 0x00, 0x00]));
        out.extend_from_slice(&build_chunk(b"IEND", b""));
        out
    }

    #[test]
    fn an_asset_without_a_manifest_is_reported_as_absent_not_as_an_error() {
        let report = read_c2pa(&minimal_png(), "png");
        assert!(!report.present);
        assert!(!report.declares_soft_binding);
        assert_eq!(report.manifests, 0);
    }

    #[test]
    fn the_json_shape_is_stable_whether_or_not_the_feature_is_on() {
        let json = read_c2pa(&minimal_png(), "png").to_json();
        for key in [
            "available",
            "present",
            "manifests",
            "declares_soft_binding",
            "soft_binding_algorithms",
            "notes",
        ] {
            assert!(json.get(key).is_some(), "missing key {key}");
        }
    }

    #[cfg(feature = "c2pa-read")]
    #[test]
    fn the_reader_is_available_when_the_feature_is_on() {
        assert!(read_c2pa(&minimal_png(), "png").available);
    }

    #[test]
    fn a_present_manifest_always_carries_the_durability_caveat() {
        let report = C2paReport {
            available: true,
            present: true,
            ..C2paReport::default()
        };
        let notes = report.to_json();
        let notes = notes["notes"].as_array().unwrap();
        assert!(notes
            .iter()
            .any(|note| note.as_str().unwrap().contains("soft binding")));
    }
}
