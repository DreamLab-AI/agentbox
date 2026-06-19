use napi_derive::napi;
use serde::{Deserialize, Serialize};

/// A single CCR (Context Compression Reference) entry pointing to stored content.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CcrEntry {
    /// BLAKE3 hash prefix (24 hex chars) identifying the stored content.
    pub hash: String,
    /// Size of the original content in bytes.
    pub size_bytes: u32,
}

/// Result of a compression operation.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressResult {
    /// The compressed output string.
    pub compressed: String,
    /// Size of the original input in bytes.
    pub original_bytes: u32,
    /// Size of the compressed output in bytes.
    pub compressed_bytes: u32,
    /// Compression ratio (compressed / original). Lower is better.
    pub ratio: f64,
    /// CCR entries for content that was evicted to the store.
    pub ccr_entries: Vec<CcrEntry>,
}

/// Options for the smart_crush function.
#[napi(object)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SmartCrushOptions {
    /// Target compression ratio (0.0-1.0). Default: 0.3.
    pub target_ratio: Option<f64>,
    /// Minimum number of items to keep in the output. Default: 2.
    pub min_items: Option<u32>,
}

/// Options for the compress_log function.
#[napi(object)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LogCompressOptions {
    /// Whether to always preserve lines containing errors/warnings. Default: true.
    pub preserve_errors: Option<bool>,
    /// Maximum number of unique templates to keep. Default: 50.
    pub max_templates: Option<u32>,
}

/// Options for the compress_diff function.
#[napi(object)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DiffCompressOptions {
    /// Context-to-changes ratio threshold above which context is sampled. Default: 3.0.
    pub context_ratio: Option<f64>,
}

/// Content type detection result.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentDetection {
    /// Detected content type name.
    pub content_type: String,
    /// Confidence of the detection (0.0-1.0).
    pub confidence: f64,
}

/// Statistics for the CCR store.
/// Note: N-API v2 object bindings use i64 for 64-bit integers (JS number).
/// Values are always non-negative; the signed type is a binding constraint.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CcrStoreStats {
    /// Number of entries currently stored.
    pub entries: u32,
    /// Total bytes of stored content.
    pub bytes_stored: i64,
    /// Number of cache hits since initialisation.
    pub hit_count: i64,
    /// Number of cache misses since initialisation.
    pub miss_count: i64,
}

/// Configuration for the compression system.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressionConfig {
    /// Backend type: "memory" or "sqlite".
    pub backend: String,
    /// TTL for stored entries in minutes.
    pub ttl_minutes: u32,
    /// Maximum number of entries before LRU eviction.
    pub max_entries: u32,
    /// Default target compression ratio.
    pub target_ratio: f64,
}

/// Internal content type enumeration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ContentType {
    JsonArray,
    LogOutput,
    UnifiedDiff,
    Code,
    Prose,
    Binary,
    Unknown,
}

impl ContentType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ContentType::JsonArray => "json_array",
            ContentType::LogOutput => "log_output",
            ContentType::UnifiedDiff => "unified_diff",
            ContentType::Code => "code",
            ContentType::Prose => "prose",
            ContentType::Binary => "binary",
            ContentType::Unknown => "unknown",
        }
    }
}
