//! Segwit addresses under any prefix: bech32 (BIP 173) for witness version 0,
//! bech32m (BIP 350) for 1 and up (`siding/lib/address.mjs`).
//!
//! The chain's own prefix is the document's `addressPrefix` (`ts` for the
//! txbt4 siding, `drm` for the dreamlab chain); an address with another prefix
//! still names a script, and the script is what a coin pays, so a caller may
//! accept it with a warning rather than refuse it. The checksum arithmetic is
//! the `bech32` crate's; this module only binds it to scripts.
//!
//! ```
//! use sidestr_core::address::{script_to_address, address_to_script, decode_address};
//! use bitcoin::ScriptBuf;
//!
//! let challenge = ScriptBuf::from_hex("512098b4e74305dac5ce76d5bee8e57a71549a27618a0e51b3bada3074fcba02325b").unwrap();
//! let addr = script_to_address(&challenge, "trl").unwrap();
//! assert!(addr.starts_with("trl1p"));
//! assert_eq!(address_to_script(&addr), Some(challenge));
//! assert_eq!(decode_address(&addr).unwrap().version, 1);
//! assert_eq!(address_to_script("trl1notanaddress"), None);
//! ```

use bech32::primitives::hrp::Hrp;
use bech32::Fe32;
use bitcoin::{Script, ScriptBuf, WitnessProgram, WitnessVersion};

/// What an address names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedAddress {
    /// The human-readable prefix, lower case.
    pub hrp: String,
    /// Witness version 0..=16.
    pub version: u8,
    /// The witness program, 2 to 40 bytes (20 or 32 for version 0).
    pub program: Vec<u8>,
    /// The output script the address names.
    pub script: ScriptBuf,
}

/// Address → its parts and script, or `None` for anything that is not a
/// valid segwit address under some prefix (`siding/lib/address.mjs decodeAddress`).
pub fn decode_address(address: &str) -> Option<DecodedAddress> {
    let (hrp, version, program) = bech32::segwit::decode(address).ok()?;
    let version = version.to_u8();
    let wv = WitnessVersion::try_from(version).ok()?;
    let wp = WitnessProgram::new(wv, &program).ok()?;
    let script = ScriptBuf::new_witness_program(&wp);
    Some(DecodedAddress {
        hrp: hrp.to_lowercase(),
        version,
        program,
        script,
    })
}

/// Address → script (any prefix), or `None` (`siding/lib/address.mjs addressToScript`).
pub fn address_to_script(address: &str) -> Option<ScriptBuf> {
    decode_address(address).map(|d| d.script)
}

/// Script → address under `hrp`, or `None` if the script is not a witness
/// program or the prefix is not a valid one (`siding/lib/address.mjs scriptToAddress`).
pub fn script_to_address(script: &Script, hrp: &str) -> Option<String> {
    let version = script.witness_version()?;
    let program = &script.as_bytes()[2..];
    let hrp = Hrp::parse(hrp).ok()?;
    let fe = Fe32::try_from(version.to_num()).ok()?;
    bech32::segwit::encode(hrp, fe, program).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_refusals() {
        // the txbt4 siding's peg address from siding/chain.json (prefix tb, version 1)
        let addr = "tb1pvts4e2zcrujj9zey3kadyfgh2xs93v8va8ae9ldhukpxy2n3848qyqurhc";
        let d = decode_address(addr).unwrap();
        assert_eq!(d.hrp, "tb");
        assert_eq!(d.version, 1);
        assert_eq!(d.program.len(), 32);
        assert_eq!(script_to_address(&d.script, "tb").as_deref(), Some(addr));
        assert_eq!(script_to_address(&d.script, "ts").unwrap()[..4], *"ts1p");
        // version 0, 20 bytes, bech32 (BIP 173 vector)
        let v0 = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
        assert_eq!(
            decode_address(v0).unwrap().script.to_hex_string(),
            "0014751e76e8199196d454941c45d1b3a323f1433bd6"
        );
        assert_eq!(
            script_to_address(&decode_address(v0).unwrap().script, "bc").as_deref(),
            Some(v0)
        );
        // a v0 address with a bech32m (not bech32) checksum is refused (BIP 350 vector), and so is mixed case
        assert!(decode_address("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh").is_none());
        assert!(
            decode_address("tb1PVTS4E2ZCRUJJ9ZEY3KADYFGH2XS93V8VA8AE9LDHUKPXY2N3848QYQURHC")
                .is_none()
        );
        assert!(script_to_address(&ScriptBuf::from_hex("6a04deadbeef").unwrap(), "tb").is_none());
    }
}
