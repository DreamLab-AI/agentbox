//! The parents a chain can sit beside (SPEC 3.2): a short alias per chain,
//! the long kernel id it resolves to, and the header family the chain inherits.
//!
//! A port of `siding/lib/parents.mjs`. Old spellings (the kernel's long ids
//! such as `btc:testnet4-blake2b`) stay accepted, so no running chain's
//! document changes. `mainnet` picks the key and address encodings a node
//! expects (WIF `0x80` vs `0xef`).
//!
//! The alias resolves to the block that fixes which chain is meant: the
//! genesis, and for a fork, the first block on the fork's side, since a fork
//! shares its origin's genesis. A validator that does not know an alias
//! refuses the chain by name.
//!
//! ```
//! use sidestr_core::parents::{resolve_parent, parent_alias, Family};
//!
//! let p = resolve_parent("btc:testnet4").unwrap();
//! assert_eq!(p.alias, "tbtc4");
//! assert_eq!(p.family, Family::Stock);
//! assert_eq!(parent_alias("doge"), None);
//! assert!(resolve_parent("ltc").is_err()); // reserved until a validator carries it
//! ```

use crate::error::{Error, Result};

/// The header family a chain inherits from its parent (SPEC 3): nothing in
/// the document names a header format or a hash; the parent decides both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Family {
    /// The stock 80-byte Bitcoin header, hashed with SHA256d.
    Stock,
    /// Knots' 164-byte v2 header with BLAKE2b proof of work (`sidestr-header`).
    Blake2b,
}

/// The proof-of-work hash the parent uses; informational for the reserved
/// parents, load-bearing for the two families this table carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Pow {
    /// Double SHA-256 (Bitcoin).
    Sha256d,
    /// BLAKE2b over the v2 header (Knots).
    Blake2b,
    /// scrypt (Litecoin; reserved).
    Scrypt,
    /// verthash (Vertcoin; reserved).
    Verthash,
}

/// The block that fixes a fork's identity: the first block on the fork's side.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Fork {
    /// Height of the fork block.
    pub height: u32,
    /// Display-order hash of the fork block.
    pub hash: &'static str,
}

/// One row of the SPEC 3.2 table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Parent {
    /// The short alias new documents use.
    pub alias: &'static str,
    /// The kernel's long network id, accepted as an old spelling; `None` when reserved.
    pub network: Option<&'static str>,
    /// Human label.
    pub label: &'static str,
    /// Header family the chain inherits.
    pub family: Family,
    /// The parent's proof-of-work hash.
    pub pow: Pow,
    /// Whether keys and addresses use mainnet encodings.
    pub mainnet: bool,
    /// The parent's genesis hash, display order; `None` when reserved.
    pub genesis: Option<&'static str>,
    /// The fork block, for a fork of another chain in the table.
    pub fork: Option<Fork>,
    /// Reserved: in the table so the name is taken, refused until a validator carries its rules.
    pub reserved: bool,
}

/// The table itself (SPEC 3.2), in the order the spec lists it.
pub const PARENTS: [Parent; 6] = [
    Parent {
        alias: "btc",
        network: Some("btc:mainnet"),
        label: "Bitcoin mainnet",
        family: Family::Stock,
        pow: Pow::Sha256d,
        mainnet: true,
        genesis: Some("000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f"),
        fork: None,
        reserved: false,
    },
    Parent {
        alias: "tbtc4",
        network: Some("btc:testnet4"),
        label: "Bitcoin testnet4",
        family: Family::Stock,
        pow: Pow::Sha256d,
        mainnet: false,
        genesis: Some("00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043"),
        fork: None,
        reserved: false,
    },
    Parent {
        alias: "xbt",
        network: Some("btc:mainnet-blake2b"),
        label: "BLAKE2b mainnet (Knots)",
        family: Family::Blake2b,
        pow: Pow::Blake2b,
        mainnet: true,
        genesis: Some("000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f"),
        fork: Some(Fork {
            height: 961_640,
            hash: "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb",
        }),
        reserved: false,
    },
    Parent {
        alias: "txbt4",
        network: Some("btc:testnet4-blake2b"),
        label: "BLAKE2b testnet4 (Knots)",
        family: Family::Blake2b,
        pow: Pow::Blake2b,
        mainnet: false,
        genesis: Some("00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043"),
        fork: Some(Fork {
            height: 150_308,
            hash: "000000000000b9d1b7e1bb0e77215ee92c6ef7ec8f4473e23908380649e779b6",
        }),
        reserved: false,
    },
    Parent {
        alias: "ltc",
        network: None,
        label: "Litecoin mainnet",
        family: Family::Stock,
        pow: Pow::Scrypt,
        mainnet: true,
        genesis: None,
        fork: None,
        reserved: true,
    },
    Parent {
        alias: "vtc",
        network: None,
        label: "Vertcoin mainnet",
        family: Family::Stock,
        pow: Pow::Verthash,
        mainnet: true,
        genesis: None,
        fork: None,
        reserved: true,
    },
];

/// Alias or long id → the alias; `None` when neither (`siding/lib/parents.mjs parentAlias`).
pub fn parent_alias(id: &str) -> Option<&'static str> {
    PARENTS
        .iter()
        .find(|p| p.alias == id || p.network == Some(id))
        .map(|p| p.alias)
}

/// Alias or long id → the table row; an error for a reserved or unknown parent
/// (`siding/lib/parents.mjs resolveParent`).
pub fn resolve_parent(id: &str) -> Result<&'static Parent> {
    let alias = parent_alias(id).ok_or_else(|| Error::UnknownParent(id.to_string()))?;
    let p = PARENTS
        .iter()
        .find(|p| p.alias == alias)
        .expect("alias came from the table");
    if p.reserved {
        return Err(Error::ReservedParent {
            alias: p.alias,
            label: p.label,
        });
    }
    Ok(p)
}

/// Whether the parent hands down the BLAKE2b header family.
pub fn is_blake2b(id: &str) -> Result<bool> {
    Ok(resolve_parent(id)?.family == Family::Blake2b)
}

#[cfg(test)]
mod tests {
    use super::*;

    // siding/test/parents-test.mjs
    #[test]
    fn table() {
        assert_eq!(
            resolve_parent("txbt4").unwrap().network,
            Some("btc:testnet4-blake2b")
        );
        assert_eq!(
            resolve_parent("btc:testnet4-blake2b").unwrap().alias,
            "txbt4"
        );
        assert_eq!(
            resolve_parent("xbt").unwrap().network,
            Some("btc:mainnet-blake2b")
        );
        assert_eq!(resolve_parent("btc:mainnet-blake2b").unwrap().alias, "xbt");
        let by = |a: &str| PARENTS.iter().find(|p| p.alias == a).unwrap();
        assert_eq!(by("xbt").genesis, by("btc").genesis);
        assert_eq!(by("txbt4").genesis, by("tbtc4").genesis);
        assert_eq!(by("txbt4").fork.unwrap().height, 150_308);
        assert_eq!(by("xbt").fork.unwrap().height, 961_640);
        assert!(is_blake2b("txbt4").unwrap() && is_blake2b("xbt").unwrap());
        assert!(!is_blake2b("btc").unwrap() && !is_blake2b("tbtc4").unwrap());
        assert_eq!(parent_alias("xbt4"), None);
        assert!(matches!(
            resolve_parent("ltc"),
            Err(Error::ReservedParent { alias: "ltc", .. })
        ));
        let e = resolve_parent("doge").unwrap_err().to_string();
        assert!(e.contains("unknown parent \"doge\"") && e.contains("txbt4"));
        assert!(resolve_parent("xbt").unwrap().mainnet && resolve_parent("btc").unwrap().mainnet);
        assert!(
            !resolve_parent("txbt4").unwrap().mainnet
                && !resolve_parent("btc:testnet4-blake2b").unwrap().mainnet
        );
        for name in ["__proto__", "constructor", "toString", ""] {
            assert_eq!(parent_alias(name), None);
        }
    }
}
