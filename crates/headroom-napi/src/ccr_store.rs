use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use rusqlite::{params, Connection};
use std::sync::Mutex;

use crate::types::CcrStoreStats;

/// Process-global CCR store singleton.
static GLOBAL_STORE: OnceLock<Arc<CcrStore>> = OnceLock::new();

/// Compute a 24-character hex prefix of the BLAKE3 hash of the data.
pub fn ccr_hash(data: &[u8]) -> String {
    let hash = blake3::hash(data);
    let hex = hash.to_hex();
    hex[..24].to_string()
}

/// Initialise the global CCR store. Subsequent calls are no-ops.
pub fn init_global(
    backend: &str,
    ttl_minutes: u32,
    max_entries: u32,
) -> Result<(), String> {
    let ttl = Duration::from_secs(u64::from(ttl_minutes) * 60);
    let store = match backend {
        "sqlite" => {
            let db_path = std::env::var("CCR_SQLITE_PATH")
                .unwrap_or_else(|_| "/tmp/ccr_store.db".to_string());
            let backend = SqliteBackend::new(&db_path, ttl, max_entries)
                .map_err(|e| format!("sqlite init failed: {e}"))?;
            CcrStore::new(Box::new(backend))
        }
        _ => {
            let backend = InMemoryBackend::new(ttl, max_entries);
            CcrStore::new(Box::new(backend))
        }
    };
    let _ = GLOBAL_STORE.set(Arc::new(store));
    Ok(())
}

/// Get the global CCR store, initialising with in-memory defaults if needed.
pub fn global() -> Arc<CcrStore> {
    GLOBAL_STORE
        .get_or_init(|| {
            let backend = InMemoryBackend::new(Duration::from_secs(3600), 10_000);
            Arc::new(CcrStore::new(Box::new(backend)))
        })
        .clone()
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Trait for CCR storage backends.
#[allow(dead_code)]
pub trait CcrBackend: Send + Sync {
    fn store(&self, hash: &str, data: &[u8]) -> Result<(), String>;
    fn retrieve(&self, hash: &str) -> Result<Option<Vec<u8>>, String>;
    fn evict(&self, hash: &str) -> Result<(), String>;
    fn prune(&self) -> Result<u32, String>;
    fn stats(&self) -> Result<BackendStats, String>;
}

#[derive(Debug, Clone)]
pub struct BackendStats {
    pub entries: u32,
    pub bytes_stored: u64,
}

/// The CCR store wrapping a backend with hit/miss counters.
pub struct CcrStore {
    backend: Box<dyn CcrBackend>,
    hit_count: AtomicU64,
    miss_count: AtomicU64,
}

impl CcrStore {
    pub fn new(backend: Box<dyn CcrBackend>) -> Self {
        Self {
            backend,
            hit_count: AtomicU64::new(0),
            miss_count: AtomicU64::new(0),
        }
    }

    pub fn store(&self, hash: &str, data: &[u8]) -> Result<(), String> {
        self.backend.store(hash, data)
    }

    pub fn retrieve(&self, hash: &str) -> Result<Option<Vec<u8>>, String> {
        let result = self.backend.retrieve(hash)?;
        if result.is_some() {
            self.hit_count.fetch_add(1, Ordering::Relaxed);
        } else {
            self.miss_count.fetch_add(1, Ordering::Relaxed);
        }
        Ok(result)
    }

    #[allow(dead_code)]
    pub fn evict(&self, hash: &str) -> Result<(), String> {
        self.backend.evict(hash)
    }

    #[allow(dead_code)]
    pub fn prune(&self) -> Result<u32, String> {
        self.backend.prune()
    }

    pub fn stats(&self) -> Result<CcrStoreStats, String> {
        let bs = self.backend.stats()?;
        Ok(CcrStoreStats {
            entries: bs.entries,
            bytes_stored: bs.bytes_stored as i64,
            hit_count: self.hit_count.load(Ordering::Relaxed) as i64,
            miss_count: self.miss_count.load(Ordering::Relaxed) as i64,
        })
    }
}

// ---------------------------------------------------------------------------
// In-Memory Backend
// ---------------------------------------------------------------------------

struct MemEntry {
    data: Vec<u8>,
    created_at: u64,
    last_accessed: u64,
}

pub struct InMemoryBackend {
    map: DashMap<String, MemEntry>,
    ttl: Duration,
    max_entries: u32,
}

impl InMemoryBackend {
    pub fn new(ttl: Duration, max_entries: u32) -> Self {
        Self {
            map: DashMap::new(),
            ttl,
            max_entries,
        }
    }

    fn is_expired(&self, entry: &MemEntry) -> bool {
        let now = now_secs();
        now.saturating_sub(entry.created_at) > self.ttl.as_secs()
    }

    fn evict_lru(&self) {
        if self.map.len() <= self.max_entries as usize {
            return;
        }
        let to_remove = self.map.len() - self.max_entries as usize;
        let mut entries: Vec<(String, u64)> = self
            .map
            .iter()
            .map(|r| (r.key().clone(), r.value().last_accessed))
            .collect();
        entries.sort_by_key(|(_, ts)| *ts);
        for (key, _) in entries.into_iter().take(to_remove) {
            self.map.remove(&key);
        }
    }
}

impl CcrBackend for InMemoryBackend {
    fn store(&self, hash: &str, data: &[u8]) -> Result<(), String> {
        let now = now_secs();
        self.map.insert(
            hash.to_string(),
            MemEntry {
                data: data.to_vec(),
                created_at: now,
                last_accessed: now,
            },
        );
        self.evict_lru();
        Ok(())
    }

    fn retrieve(&self, hash: &str) -> Result<Option<Vec<u8>>, String> {
        if let Some(mut entry) = self.map.get_mut(hash) {
            if self.is_expired(&entry) {
                drop(entry);
                self.map.remove(hash);
                return Ok(None);
            }
            entry.last_accessed = now_secs();
            Ok(Some(entry.data.clone()))
        } else {
            Ok(None)
        }
    }

    fn evict(&self, hash: &str) -> Result<(), String> {
        self.map.remove(hash);
        Ok(())
    }

    fn prune(&self) -> Result<u32, String> {
        let before = self.map.len();
        self.map.retain(|_, v| !self.is_expired(v));
        Ok((before - self.map.len()) as u32)
    }

    fn stats(&self) -> Result<BackendStats, String> {
        let entries = self.map.len() as u32;
        let bytes_stored: u64 = self.map.iter().map(|r| r.value().data.len() as u64).sum();
        Ok(BackendStats {
            entries,
            bytes_stored,
        })
    }
}

// ---------------------------------------------------------------------------
// SQLite Backend
// ---------------------------------------------------------------------------

pub struct SqliteBackend {
    conn: Mutex<Connection>,
    ttl: Duration,
    max_entries: u32,
}

impl SqliteBackend {
    pub fn new(path: &str, ttl: Duration, max_entries: u32) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "busy_timeout", 5000)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS ccr_entries (
                hash TEXT PRIMARY KEY,
                data BLOB NOT NULL,
                size_bytes INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                last_accessed INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ccr_last_accessed ON ccr_entries(last_accessed);
            CREATE INDEX IF NOT EXISTS idx_ccr_created_at ON ccr_entries(created_at);",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
            ttl,
            max_entries,
        })
    }

    fn evict_lru_locked(&self, conn: &Connection) -> Result<(), rusqlite::Error> {
        let count: u32 = conn.query_row("SELECT COUNT(*) FROM ccr_entries", [], |r| r.get(0))?;
        if count <= self.max_entries {
            return Ok(());
        }
        let to_remove = count - self.max_entries;
        conn.execute(
            "DELETE FROM ccr_entries WHERE hash IN (
                SELECT hash FROM ccr_entries ORDER BY last_accessed ASC LIMIT ?1
            )",
            params![to_remove],
        )?;
        Ok(())
    }
}

impl CcrBackend for SqliteBackend {
    fn store(&self, hash: &str, data: &[u8]) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_secs() as i64;
        conn.execute(
            "INSERT OR REPLACE INTO ccr_entries (hash, data, size_bytes, created_at, last_accessed)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![hash, data, data.len() as i64, now, now],
        )
        .map_err(|e| e.to_string())?;
        self.evict_lru_locked(&conn).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn retrieve(&self, hash: &str) -> Result<Option<Vec<u8>>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_secs();
        let ttl_cutoff = now.saturating_sub(self.ttl.as_secs()) as i64;

        let result: Result<(Vec<u8>, i64), _> = conn.query_row(
            "SELECT data, created_at FROM ccr_entries WHERE hash = ?1",
            params![hash],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );

        match result {
            Ok((data, created_at)) => {
                if created_at < ttl_cutoff {
                    conn.execute("DELETE FROM ccr_entries WHERE hash = ?1", params![hash])
                        .map_err(|e| e.to_string())?;
                    return Ok(None);
                }
                conn.execute(
                    "UPDATE ccr_entries SET last_accessed = ?1 WHERE hash = ?2",
                    params![now as i64, hash],
                )
                .map_err(|e| e.to_string())?;
                Ok(Some(data))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn evict(&self, hash: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ccr_entries WHERE hash = ?1", params![hash])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn prune(&self) -> Result<u32, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_secs();
        let ttl_cutoff = now.saturating_sub(self.ttl.as_secs()) as i64;
        let removed = conn
            .execute(
                "DELETE FROM ccr_entries WHERE created_at < ?1",
                params![ttl_cutoff],
            )
            .map_err(|e| e.to_string())?;
        Ok(removed as u32)
    }

    fn stats(&self) -> Result<BackendStats, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let entries: u32 = conn
            .query_row("SELECT COUNT(*) FROM ccr_entries", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let bytes_stored: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(size_bytes), 0) FROM ccr_entries",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(BackendStats {
            entries,
            bytes_stored: bytes_stored as u64,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_24_hex_chars() {
        let h = ccr_hash(b"hello world");
        assert_eq!(h.len(), 24);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn in_memory_store_retrieve() {
        let backend = InMemoryBackend::new(Duration::from_secs(3600), 100);
        let store = CcrStore::new(Box::new(backend));
        let hash = ccr_hash(b"test data");
        store.store(&hash, b"test data").unwrap();
        let retrieved = store.retrieve(&hash).unwrap();
        assert_eq!(retrieved, Some(b"test data".to_vec()));
    }

    #[test]
    fn in_memory_lru_eviction() {
        let backend = InMemoryBackend::new(Duration::from_secs(3600), 3);
        let store = CcrStore::new(Box::new(backend));
        for i in 0..5u8 {
            let data = vec![i; 10];
            let hash = ccr_hash(&data);
            store.store(&hash, &data).unwrap();
        }
        let stats = store.stats().unwrap();
        assert!(stats.entries <= 3);
    }

    #[test]
    fn sqlite_store_retrieve() {
        let dir = std::env::temp_dir().join("ccr_test_sqlite");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test.db");
        let _ = std::fs::remove_file(&path);
        let backend =
            SqliteBackend::new(path.to_str().unwrap(), Duration::from_secs(3600), 100).unwrap();
        let store = CcrStore::new(Box::new(backend));
        let hash = ccr_hash(b"sqlite test");
        store.store(&hash, b"sqlite test").unwrap();
        let retrieved = store.retrieve(&hash).unwrap();
        assert_eq!(retrieved, Some(b"sqlite test".to_vec()));
        let _ = std::fs::remove_file(&path);
    }
}
