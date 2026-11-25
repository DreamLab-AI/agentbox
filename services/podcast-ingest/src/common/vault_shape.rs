//! Which page-header shape the target vault expects.
//!
//! The vault says so itself: `ontology/vocabulary.yaml` carries a `version`.
//! At 3 or higher the writers emit the vocabulary-3 shape (ADR-VG-010 to -013,
//! visionGraph); below that, or when the vault has no vocabulary file at all,
//! they emit the vocabulary-2 shape they always did. There is no flag or
//! environment variable: the one source of truth is the file the vault's own
//! validator reads, so the writer cannot disagree with it.
//!
//! A vocabulary file that exists but cannot be read, has no integer `version`,
//! or (at 3 or higher) has no single human principal in
//! `ontology/attribution.yaml`, is an error, not a guess: a wrong header fails
//! the vault's gate, and a silent fallback to the old shape would do so too.
//!
//! # Stamps
//!
//! In vocabulary 3 a stamp's `by` is the **principal answerable for the
//! write** and `via` is the instrument (ADR-VG-011 §1). ADR-VG-012 §1 and §6
//! settle that for machine-written pages the operator is the principal and the
//! process is the instrument. The principal is read from the roster's
//! `principals:` entry of `kind: human`, never from a generator key (a process
//! key is not a human, whatever principal it is filed under), and never from
//! an `also:` key. Nothing here ever writes `verified`, an approval or a
//! confirmation.

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// The header shape a vault wants.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultShape {
    /// Vocabulary 2 (or a directory with no vocabulary file): `generated:
    /// {by: <process>, at}`, free-form `sources`, `public: false`.
    V2,
    /// Vocabulary 3 or higher.
    V3(V3),
}

/// What a vocabulary-3 write needs from the vault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct V3 {
    /// The vault root (the directory holding `ontology/`).
    pub root: PathBuf,
    /// The operator's canonical principal, `did:nostr:<64 hex>`.
    pub principal: String,
    /// The closed `promotion-status` enum, when the vocabulary states one.
    pub promotion_statuses: Option<Vec<String>>,
}

const WORKING_NAMESPACE: &str = "visionflow:page:working:";

/// `page_resource` of a working page, derived from its id (the path under
/// `working/` without `.md`): `urn:visionflow:page:` plus the SHA-256 of
/// `visionflow:page:working:<id>`. This is the rule ontomark's migration
/// `m0002` mints with and `ontomark memory resource` prints, so a page this
/// writer creates and one the migration would have created get the same
/// identity, and a re-run for the same item mints nothing new. It is derived
/// from the page's stable source identity (the episode slug for a ledger, the
/// topic's file name for a topic page), never from content.
pub fn page_resource(id: &str) -> String {
    let digest = Sha256::digest(format!("{WORKING_NAMESPACE}{id}").as_bytes());
    format!("urn:visionflow:page:{}", hex::encode(digest))
}

impl VaultShape {
    /// Decide the shape for the vault that holds `working_dir`.
    ///
    /// Looks for `ontology/vocabulary.yaml` in the parents of `working_dir`
    /// (the working vault sits directly under the repository root). No file
    /// found means [`VaultShape::V2`].
    pub fn detect(working_dir: &Path) -> Result<VaultShape, String> {
        let abs = std::path::absolute(working_dir).map_err(|e| e.to_string())?;
        for root in abs.ancestors().skip(1).take(3) {
            let vocab = root.join("ontology").join("vocabulary.yaml");
            if vocab.is_file() {
                let text = std::fs::read_to_string(&vocab)
                    .map_err(|e| format!("cannot read {}: {e}", vocab.display()))?;
                let attribution = root.join("ontology").join("attribution.yaml");
                return Self::from_files(root, &text, || {
                    std::fs::read_to_string(&attribution)
                        .map_err(|e| format!("cannot read {}: {e}", attribution.display()))
                });
            }
        }
        Ok(VaultShape::V2)
    }

    /// The decision, from the text of the two files.
    pub fn from_files(
        root: &Path,
        vocabulary: &str,
        attribution: impl FnOnce() -> Result<String, String>,
    ) -> Result<VaultShape, String> {
        let vocab: serde_yaml::Value = serde_yaml::from_str(vocabulary)
            .map_err(|e| format!("ontology/vocabulary.yaml is not valid YAML: {e}"))?;
        let version = vocab
            .get("version")
            .and_then(|v| v.as_u64())
            .ok_or("ontology/vocabulary.yaml has no integer `version`")?;
        if version < 3 {
            return Ok(VaultShape::V2);
        }
        let roster: serde_yaml::Value = serde_yaml::from_str(&attribution()?)
            .map_err(|e| format!("ontology/attribution.yaml is not valid YAML: {e}"))?;
        let principal = single_human_principal(&roster)?;
        let promotion_statuses = vocab
            .get("working_extensions")
            .and_then(|w| w.get("promotion-status"))
            .and_then(|p| p.get("enum"))
            .and_then(|e| e.as_sequence())
            .map(|s| {
                s.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            });
        Ok(VaultShape::V3(V3 {
            root: root.to_path_buf(),
            principal,
            promotion_statuses,
        }))
    }
}

fn is_did_nostr(s: &str) -> bool {
    s.strip_prefix("did:nostr:")
        .is_some_and(|h| h.len() == 64 && h.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
}

/// The roster's one `kind: human` principal. Zero or several is an error: the
/// writer will not choose between people.
fn single_human_principal(roster: &serde_yaml::Value) -> Result<String, String> {
    let humans: Vec<&str> = roster
        .get("principals")
        .and_then(|p| p.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter(|p| p.get("kind").and_then(|k| k.as_str()) == Some("human"))
                .filter_map(|p| p.get("did").and_then(|d| d.as_str()))
                .collect()
        })
        .unwrap_or_default();
    match humans.as_slice() {
        [one] if is_did_nostr(one) => Ok((*one).to_string()),
        [one] => Err(format!(
            "the roster's human principal `{one}` is not a did:nostr with a 64-hex body"
        )),
        [] => Err("ontology/attribution.yaml lists no `principals:` entry of kind: human".into()),
        _ => Err("ontology/attribution.yaml lists more than one human principal".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRINCIPAL: &str =
        "did:nostr:b41654017f6850b13857d19d8ae0e3f88f1365600cab0321e8101c9e92682f7a";
    const SWARM: &str =
        "did:nostr:94773a699927da1ef879b90843890b1fe0e671ae898163f4337dcbe5f96992c0";

    fn roster() -> String {
        format!(
            "generators:\n  - did: {SWARM}\n    kind: process\n    principal: {PRINCIPAL}\nprincipals:\n  - did: {PRINCIPAL}\n    kind: human\n    also:\n      - did:nostr:d598abc6edefc37e10523aec4c00f8d9674a93791aa34a1db03bfa9b60b9f246\n"
        )
    }

    /// Pinned against a real migrated page: `podcast-evidence/bezos-is-back-to-build-ai`
    /// carries this `page_resource` in the visionGraph migration branch.
    #[test]
    fn page_resource_matches_the_migration_rule() {
        assert_eq!(
            page_resource("podcast-evidence/bezos-is-back-to-build-ai"),
            "urn:visionflow:page:9be4317ef383394f78cdfc54bb84acc009e470ade15770f5a50b6469477f4702"
        );
        assert_eq!(
            page_resource("AI Agents"),
            "urn:visionflow:page:157e71683daf3a55debf526439e2ea7c15a029107d32aee633c42153ff890c8a"
        );
    }

    #[test]
    fn page_resource_is_stable_and_not_a_slug() {
        assert_eq!(page_resource("x"), page_resource("x"));
        assert_ne!(page_resource("x"), page_resource("y"));
        assert!(!page_resource("Some Topic").contains("some-topic"));
    }

    #[test]
    fn version_two_is_the_old_shape() {
        let s = VaultShape::from_files(Path::new("/r"), "version: 2\n", || {
            panic!("the roster is not read under version 2")
        });
        assert_eq!(s, Ok(VaultShape::V2));
    }

    #[test]
    fn version_three_and_above_read_the_principal_not_a_swarm_key() {
        for v in [3, 4] {
            let s =
                VaultShape::from_files(
                    Path::new("/r"),
                    &format!("version: {v}\n"),
                    || Ok(roster()),
                )
                .unwrap();
            match s {
                VaultShape::V3(v3) => {
                    assert_eq!(v3.principal, PRINCIPAL);
                    assert_ne!(v3.principal, SWARM);
                }
                other => panic!("{other:?}"),
            }
        }
    }

    #[test]
    fn the_promotion_status_enum_comes_from_the_vocabulary() {
        let vocab = "version: 3\nworking_extensions:\n  promotion-status: { type: text, enum: [candidate, elevated] }\n";
        match VaultShape::from_files(Path::new("/r"), vocab, || Ok(roster())).unwrap() {
            VaultShape::V3(v3) => assert_eq!(
                v3.promotion_statuses,
                Some(vec!["candidate".to_string(), "elevated".to_string()])
            ),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_vault_without_exactly_one_human_principal_is_refused() {
        for roster in [
            "generators: []\n".to_string(),
            format!("principals:\n  - {{did: {SWARM}, kind: process}}\n"),
            format!(
                "principals:\n  - {{did: {PRINCIPAL}, kind: human}}\n  - {{did: {SWARM}, kind: human}}\n"
            ),
            "principals:\n  - {did: did:nostr:not-hex, kind: human}\n".to_string(),
        ] {
            assert!(
                VaultShape::from_files(Path::new("/r"), "version: 3\n", || Ok(roster.clone()))
                    .is_err(),
                "{roster}"
            );
        }
    }

    #[test]
    fn a_vocabulary_that_cannot_be_read_is_an_error_not_version_two() {
        for text in ["version: three\n", "{}\n", ": : :\n  - [", "version: 3.5\n"] {
            assert!(
                VaultShape::from_files(Path::new("/r"), text, || Ok(roster())).is_err(),
                "{text}"
            );
        }
    }

    #[test]
    fn detect_walks_up_from_the_working_directory() {
        let dir = tempfile::tempdir().unwrap();
        let w = dir.path().join("working");
        std::fs::create_dir_all(&w).unwrap();
        assert_eq!(VaultShape::detect(&w), Ok(VaultShape::V2), "no file: v2");
        std::fs::create_dir_all(dir.path().join("ontology")).unwrap();
        std::fs::write(dir.path().join("ontology/vocabulary.yaml"), "version: 3\n").unwrap();
        assert!(
            VaultShape::detect(&w).is_err(),
            "v3 vocabulary with no roster"
        );
        std::fs::write(dir.path().join("ontology/attribution.yaml"), roster()).unwrap();
        assert!(matches!(VaultShape::detect(&w), Ok(VaultShape::V3(_))));
        std::fs::write(dir.path().join("ontology/vocabulary.yaml"), "version: 2\n").unwrap();
        assert_eq!(VaultShape::detect(&w), Ok(VaultShape::V2));
    }
}
