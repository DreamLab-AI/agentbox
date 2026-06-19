#[macro_use]
extern crate napi_derive;

mod ccr_store;
mod content_router;
mod diff_compressor;
mod log_compressor;
mod smart_crusher;
mod types;

use napi::bindgen_prelude::Buffer;

use types::{
    CcrStoreStats, CompressResult, CompressionConfig, ContentDetection, DiffCompressOptions,
    LogCompressOptions, SmartCrushOptions,
};

/// Smart-crush a JSON array: schema-aware compression that preserves anchors
/// (first/last), error items, and samples the rest. Dropped rows are stored
/// in the CCR store and replaced with sentinels.
#[napi]
pub fn smart_crush(
    input: String,
    options: Option<SmartCrushOptions>,
) -> napi::Result<CompressResult> {
    let opts = options.unwrap_or_default();
    smart_crusher::crush(&input, &opts).map_err(|e| napi::Error::from_reason(e))
}

/// Compress log output by template-mining repeated lines, preserving errors
/// and stack traces.
#[napi]
pub fn compress_log(
    input: String,
    options: Option<LogCompressOptions>,
) -> napi::Result<CompressResult> {
    let opts = options.unwrap_or_default();
    log_compressor::compress(&input, &opts).map_err(|e| napi::Error::from_reason(e))
}

/// Compress a unified diff by sampling context lines when the context-to-changes
/// ratio exceeds the configured threshold.
#[napi]
pub fn compress_diff(
    input: String,
    options: Option<DiffCompressOptions>,
) -> napi::Result<CompressResult> {
    let opts = options.unwrap_or_default();
    diff_compressor::compress(&input, &opts).map_err(|e| napi::Error::from_reason(e))
}

/// Detect the content type of a string (JSON array, log, diff, code, prose, binary).
#[napi]
pub fn detect_content_type(input: String) -> napi::Result<ContentDetection> {
    let (ct, confidence) = content_router::detect(&input);
    Ok(content_router::to_detection(ct, confidence))
}

/// Store content in the process-global CCR store.
#[napi]
pub fn ccr_store_entry(hash: String, original: Buffer) -> napi::Result<()> {
    let store = ccr_store::global();
    store
        .store(&hash, &original)
        .map_err(|e| napi::Error::from_reason(e))
}

/// Retrieve content from the process-global CCR store by hash.
#[napi]
pub fn ccr_retrieve(hash: String) -> napi::Result<Option<Buffer>> {
    let store = ccr_store::global();
    let result = store
        .retrieve(&hash)
        .map_err(|e| napi::Error::from_reason(e))?;
    Ok(result.map(|data| Buffer::from(data)))
}

/// Get statistics for the process-global CCR store.
#[napi]
pub fn ccr_stats() -> napi::Result<CcrStoreStats> {
    let store = ccr_store::global();
    store
        .stats()
        .map_err(|e| napi::Error::from_reason(e))
}

/// Initialise the compression subsystem with the given configuration.
/// Must be called before other operations if a non-default backend is desired.
/// Subsequent calls are no-ops (the store is initialised once per process).
#[napi]
pub fn init_compression(config: CompressionConfig) -> napi::Result<()> {
    ccr_store::init_global(&config.backend, config.ttl_minutes, config.max_entries)
        .map_err(|e| napi::Error::from_reason(e))
}
