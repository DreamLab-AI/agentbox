//! Test vectors for both families.
//!
//! Provenance:
//! - Knots' own `block_header_v2.json` (four ASIC profiles, every pipeline
//!   stage), carried by bitcoin-desktop/schema at
//!   `test/vectors/knots/block_header_v2.json` (commit b8cbf63).
//! - Real fork headers from a Knots 29.4.1 node, 2026-09-05, carried by the
//!   same kernel at `test/vectors/knots/{testnet4,mainnet}-anchors.json`.
//! - Stock: Bitcoin's genesis, testnet4's genesis (kernel
//!   `test/vectors/testnet4.json`), and `sidestr:dreamlab` block 0 (agentbox
//!   `config/sidechain/dreamlab/chain.json`, ADR-2103).
//! - BIP-325 block data: oracle = siding's `blockData` run with the
//!   bitcoin-desktop/schema codec at commit b8cbf63 and sidestr/spec at
//!   commit 2de40bd, over dreamlab block 0 and over two v2 headers that
//!   siding's `buildBlock` shaped beside `txbt4`.

use sidestr_header::{
    fork, Blake2bV2Header, BlockHash, Error, Header, HeaderFamily, StockHeader, Target,
};

fn bytes(h: &str) -> Vec<u8> {
    hex::decode(h).unwrap()
}
fn arr16(h: &str) -> [u8; 16] {
    bytes(h).try_into().unwrap()
}
/// A 128-bit field as bitcoind's RPC prints it (reversed) -> wire order.
fn rev16(h: &str) -> [u8; 16] {
    let mut b = arr16(h);
    b.reverse();
    b
}
/// A hash256 field as an explorer prints it (display) -> wire order.
fn wire32(display: &str) -> [u8; 32] {
    BlockHash::from_hex(display).unwrap().to_wire()
}

const DREAMLAB_POW_LIMIT: &str = "7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const DREAMLAB_BLOCK0: &str = "0000002000000000000000000000000000000000000000000000000000000000000000003a87d59ecf60ab58ee75948cc39d1bb44ac4285747e64b5a1e7a960d37764cb40e67b26affff7f2002000000";
const BTC_GENESIS: &str = "0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c";
const TBTC4_GENESIS: &str = "0100000000000000000000000000000000000000000000000000000000000000000000004e7b2b9128fe0291db0693af2ae418b767e657cd407e80cb1434221eaea7a07a046f3566ffff001dbb0c7817";

// ---- stock family ----

#[test]
fn stock_vectors_hash_to_their_known_ids() {
    for (name, hex, id) in [
        ("btc genesis", BTC_GENESIS, fork::BTC_GENESIS_HASH),
        ("tbtc4 genesis", TBTC4_GENESIS, fork::TBTC4_GENESIS_HASH),
        (
            "dreamlab block 0",
            DREAMLAB_BLOCK0,
            BlockHash::from_hex("4db37517728bd509c0cb96ee5a2e3e2a77f9e965a092e9f67948b413d453dbc0")
                .unwrap(),
        ),
    ] {
        let raw = bytes(hex);
        let h = StockHeader::decode(&raw).unwrap();
        assert_eq!(h.hash(), id, "{name}");
        assert_eq!(h.encode().as_slice(), raw.as_slice(), "{name} round trip");
        assert!(h.meets_target(), "{name} meets its own bits");
        let via_family = HeaderFamily::Stock.decode(&raw).unwrap();
        assert_eq!(via_family, Header::Stock(h));
        assert_eq!(via_family.hash(), id);
        assert_eq!(via_family.encode().as_ref(), raw.as_slice());
        assert_eq!(via_family.height(), None);
    }
}

#[test]
fn stock_fields_decode_as_expected() {
    let h = StockHeader::decode(&bytes(BTC_GENESIS)).unwrap();
    assert_eq!(h.version, 1);
    assert_eq!(h.prev_block_hash, BlockHash::ZERO);
    assert_eq!(
        h.merkle_root,
        wire32("4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b")
    );
    assert_eq!(h.time, 1_231_006_505);
    assert_eq!(h.bits, 0x1d00_ffff);
    assert_eq!(h.nonce, 2_083_236_893);

    let d = StockHeader::decode(&bytes(DREAMLAB_BLOCK0)).unwrap();
    assert_eq!(
        d.version, 0x2000_0000,
        "siding's stock version, bit 31 clear"
    );
    assert_eq!(d.bits, 0x207f_ffff);
    assert_eq!(
        d.bits,
        Target::from_hex(DREAMLAB_POW_LIMIT).unwrap().to_compact()
    );
}

#[test]
fn stock_check_pow_against_pow_limit() {
    let lim = Target::from_hex(DREAMLAB_POW_LIMIT).unwrap();
    let d = StockHeader::decode(&bytes(DREAMLAB_BLOCK0)).unwrap();
    assert_eq!(d.check_pow(&lim), Ok(()));

    // The same block against a chain whose powLimit is Bitcoin's: bits differ.
    let btc_lim = Target::from_compact(0x1d00_ffff).unwrap();
    assert_eq!(
        d.check_pow(&btc_lim),
        Err(Error::BitsNotPowLimit {
            bits: 0x207f_ffff,
            expected: 0x1d00_ffff
        })
    );

    // Right bits, hash not under the target: Bitcoin's genesis passes against
    // Bitcoin's powLimit, and the same header with its nonce moved does not.
    let btc_pow_limit =
        Target::from_hex("00000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
            .unwrap();
    let genesis = StockHeader::decode(&bytes(BTC_GENESIS)).unwrap();
    assert_eq!(genesis.check_pow(&btc_pow_limit), Ok(()));
    let mut tampered = genesis;
    tampered.nonce += 1;
    assert!(!tampered.meets_target());
    assert_eq!(tampered.check_pow(&btc_pow_limit), Err(Error::TargetNotMet));
    assert_eq!(
        Header::Stock(tampered).check_pow(&btc_pow_limit),
        Err(Error::TargetNotMet)
    );
}

#[test]
fn stock_rejects_wrong_length_and_bit_31() {
    let raw = bytes(DREAMLAB_BLOCK0);
    assert_eq!(
        StockHeader::decode(&raw[..79]),
        Err(Error::WrongLength {
            family: HeaderFamily::Stock,
            expected: 80,
            actual: 79
        })
    );
    let mut long = raw.clone();
    long.push(0);
    assert_eq!(
        StockHeader::decode(&long),
        Err(Error::WrongLength {
            family: HeaderFamily::Stock,
            expected: 80,
            actual: 81
        })
    );
    let mut v2bit = raw.clone();
    v2bit[3] |= 0x80;
    assert_eq!(StockHeader::decode(&v2bit), Err(Error::VersionBit31Set));
    assert_eq!(
        HeaderFamily::Stock.decode(&v2bit),
        Err(Error::VersionBit31Set)
    );
    // and the 164-byte v2 fork block is not a stock header
    assert!(matches!(
        StockHeader::decode(&bytes(TXBT4_FORK_HEADER)),
        Err(Error::WrongLength { actual: 164, .. })
    ));
}

#[test]
fn stock_block_data_matches_siding_oracle() {
    // oracle: siding `blockData` with the bitcoin-desktop/schema codec at b8cbf63
    // over sidestr:dreamlab block 0 (stripped root and data printed by the engine).
    let d = StockHeader::decode(&bytes(DREAMLAB_BLOCK0)).unwrap();
    let stripped = wire32("4ab1fc19cfbf90124ca45b6e849b779fb62ef6b58f0ccaf1eb4d595891554175");
    assert_ne!(
        stripped, d.merkle_root,
        "the sealed root differs from the stripped one"
    );
    assert_eq!(
        hex::encode(d.block_data(stripped)),
        "91c7e7089472097c141a3fd5ae5c2d57a4436402b19a884c393217bbb1624c00"
    );
    let pre = d.signet_preimage(stripped);
    assert_eq!(&pre[..36], &bytes(DREAMLAB_BLOCK0)[..36]);
    assert_eq!(&pre[36..68], &stripped);
    assert_eq!(&pre[68..], &bytes(DREAMLAB_BLOCK0)[68..72]);
    assert_eq!(
        Header::Stock(d).block_data(stripped),
        d.block_data(stripped)
    );
}

// ---- BLAKE2b v2 family: Knots' own vectors ----

struct KnotsVector {
    name: &'static str,
    n_version: u32,
    prev: &'static str,
    merkle: &'static str,
    n_time: u32,
    n_bits: u32,
    n_nonce: u32,
    nonce2: u32,
    nonce3: u32,
    extranonce_rpc: &'static str,
    time_offset: u32,
    txcount: u16,
    flags: u8,
    clear_bits: u8,
    xor_key_rpc: &'static str,
    height: u32,
    mm_rhs: &'static str,
    serialized: &'static str,
    xor_key_hash: &'static str,
    h1: &'static str,
    h2: &'static str,
    blake2b_1: &'static str,
    blake2b_2: &'static str,
    mask: &'static str,
    block_hash: &'static str,
    asic_profile: u8,
}

const KNOTS: &[KnotsVector] = &[
    KnotsVector {
        name: "profile_0_time_offset",
        n_version: 536870912, prev: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        merkle: "f0e0d0c0b0a090807060504030201000ffeeddccbbaa99887766554433221100",
        n_time: 2000000000, n_bits: 486604799, n_nonce: 195948557, nonce2: 287454020, nonce3: 2309737967,
        extranonce_rpc: "00112233445566778899aabbccddeeff", time_offset: 600, txcount: 3, flags: 28, clear_bits: 0,
        xor_key_rpc: "00000000000000000000000000000000", height: 840000,
        mm_rhs: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        serialized: "000000a01f1e1d1c1b1a191817161514131211100f0e0d0c0b0a0908070605040302010000112233445566778899aabbccddeeff00102030405060708090a0b0c0d0e0f0a8913577ffff001d0df0ad0b44332211efcdab89ffeeddccbbaa998877665544332211005802000003001c000000000000000000000000000000000040d10c008967452301efcdab8967452301efcdab8967452301efcdab8967452301efcdab",
        xor_key_hash: "86e4855b51daf0932719011a6565a5908aef105fc6f8b85a23601de43865f4db",
        h1: "4ff7ec7f24f6935064cb962ec8cc0c947d60621cc22c5ba8516b0b995cd0c01b",
        h2: "ab5becb2336a3701557b0f6e33de39bd333072b8494c7c60952a8e8a636565e3",
        blake2b_1: "7e6326906eaa52fe59e03a14f1dfb8dd5d6e78497e56a8a6e4f4fb4d385e43db",
        blake2b_2: "4b495dcf05d70a49785b799b22284fbcd9dd1209237c53c87e4674b15587d704",
        mask: "0000000000000000000000000000000000000000000000000000000000000000",
        block_hash: "4b495dcf05d70a49785b799b22284fbcd9dd1209237c53c87e4674b15587d704",
        asic_profile: 0,
    },
    KnotsVector {
        name: "profile_1_time_offset_nonzero_key",
        n_version: 536870912, prev: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        merkle: "f0e0d0c0b0a090807060504030201000ffeeddccbbaa99887766554433221100",
        n_time: 2000000000, n_bits: 486604799, n_nonce: 195948557, nonce2: 287454020, nonce3: 2309737967,
        extranonce_rpc: "00112233445566778899aabbccddeeff", time_offset: 600, txcount: 1, flags: 29, clear_bits: 0,
        xor_key_rpc: "0123456789abcdef0123456789abcdef", height: 840001,
        mm_rhs: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        serialized: "000000a01f1e1d1c1b1a191817161514131211100f0e0d0c0b0a0908070605040302010000112233445566778899aabbccddeeff00102030405060708090a0b0c0d0e0f0a8913577ffff001d0df0ad0b44332211efcdab89ffeeddccbbaa998877665544332211005802000001001d00efcdab8967452301efcdab896745230141d10c008967452301efcdab8967452301efcdab8967452301efcdab8967452301efcdab",
        xor_key_hash: "985071be3e4adf9e7983f4d5480ff4f77d14f6dcb6d2d9623226d3f0ff7687c6",
        h1: "b1fd91c55ba79811b18bb0b0d84d30c670c65243624cdddc510a74e0dd5a0123",
        h2: "be70c7fd6151172efb761561f3087bd61d97ccf070a1b05ae4c5d458686523d7",
        blake2b_1: "43cfb1efb395515321be80f8ff1961bcec5cb5b9780d552ccc46e878e27250a1",
        blake2b_2: "1c0a823c4f532ed5d25d2c5369cf151143f2479d5109e51209a960ad5fe0e958",
        mask: "58b901be52b9b42d058537f41dd321bdcff5ec1cfa01f899625937f7279af7b7",
        block_hash: "44b383821dea9af8d7d81ba7741c34ac8c07ab81ab081d8b6bf0575a787a1eef",
        asic_profile: 1,
    },
    KnotsVector {
        name: "profile_2_time_offset_selector_7",
        n_version: 536870912, prev: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        merkle: "f0e0d0c0b0a090807060504030201000ffeeddccbbaa99887766554433221100",
        n_time: 2000000000, n_bits: 486604799, n_nonce: 195948557, nonce2: 2864434397, nonce3: 2309737967,
        extranonce_rpc: "00112233445566778899aabbccddeeff", time_offset: 600, txcount: 3, flags: 30, clear_bits: 7,
        xor_key_rpc: "fedcba9876543210fedcba9876543210", height: 840000,
        mm_rhs: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        serialized: "000000a01f1e1d1c1b1a191817161514131211100f0e0d0c0b0a0908070605040302010000112233445566778899aabbccddeeff00102030405060708090a0b0c0d0e0f0a8913577ffff001d0df0ad0bddccbbaaefcdab89ffeeddccbbaa998877665544332211005802000003001e071032547698badcfe1032547698badcfe40d10c008967452301efcdab8967452301efcdab8967452301efcdab8967452301efcdab",
        xor_key_hash: "4ead68aa92ceffdb2bc4a97b01c1ad61bcd4db55a8ce5520358024180c71f2f9",
        h1: "c66fb3a62935bf95f948da68c7a6fc7f898ce507c15e493eaafa6d141ba787dd",
        h2: "dbe5fcacfe44b437da5612f21eb86c75e33868b40bfd7f458a9c3ee10a2be540",
        blake2b_1: "21e015cef9a6a323f1a5c1cdf791562447a78d2c7693ee0af9b553b80a574d19",
        blake2b_2: "0657ae2302c06ff0d557d62fa048791441a1057bf85baeb8ec1bba8c4a3476e3",
        mask: "00aa74c7e80a7f4889d075e84d39086b99989dd8d7ba91ff6c69919317bc5895",
        block_hash: "06fddae4eaca10b85c87a3c7ed71717fd83998a32fe13f4780722b1f5d882e76",
        asic_profile: 2,
    },
    KnotsVector {
        name: "profile_3_time_offset_selector_8",
        n_version: 536870912, prev: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        merkle: "f0e0d0c0b0a090807060504030201000ffeeddccbbaa99887766554433221100",
        n_time: 2000000000, n_bits: 486604799, n_nonce: 195948557, nonce2: 287454020, nonce3: 16909060,
        extranonce_rpc: "ffffffffffffffff0000000000000000", time_offset: 600, txcount: 3, flags: 31, clear_bits: 8,
        xor_key_rpc: "fedcba9876543210fedcba9876543210", height: 840000,
        mm_rhs: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        serialized: "000000a01f1e1d1c1b1a191817161514131211100f0e0d0c0b0a0908070605040302010000112233445566778899aabbccddeeff00102030405060708090a0b0c0d0e0f0a8913577ffff001d0df0ad0b44332211040302010000000000000000ffffffffffffffff5802000003001f081032547698badcfe1032547698badcfe40d10c008967452301efcdab8967452301efcdab8967452301efcdab8967452301efcdab",
        xor_key_hash: "4ead68aa92ceffdb2bc4a97b01c1ad61bcd4db55a8ce5520358024180c71f2f9",
        h1: "151989e9cec8011a56257e54ca73f3b11e904b024597c3fb214c51ab8f9cf5bf",
        h2: "9b10300a354d18ccf225314cae9a628c404edf068656236ecd0978875f9afa2e",
        blake2b_1: "b7b7fa4483321ad668a2e9a98489d6d82c3aca5ce5a78db4d824b7cf06e5e217",
        blake2b_2: "e69a31e0bb651ed5b3076ef46c9b27b5609e19407b7ff04b7c6292d0641428cd",
        mask: "00aa74c7e80a7f4889d075e84d39086b99989dd8d7ba91ff6c69919317bc5895",
        block_hash: "e6304527536f619d3ad71b1c21a22fdef9068498acc561b4100b034373a87058",
        asic_profile: 3,
    },
    KnotsVector {
        name: "profile_0_time_offset_disabled_selector_255",
        n_version: 536870912, prev: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        merkle: "f0e0d0c0b0a090807060504030201000ffeeddccbbaa99887766554433221100",
        n_time: 2000000000, n_bits: 486604799, n_nonce: 4294967295, nonce2: 287454020, nonce3: 2309737967,
        extranonce_rpc: "00112233445566778899aabbccddeeff", time_offset: 1432778632, txcount: 3, flags: 24, clear_bits: 255,
        xor_key_rpc: "11111111111111112222222222222222", height: 840000,
        mm_rhs: "0000000000000000000000000000000000000000000000000000000000000000",
        serialized: "000000a01f1e1d1c1b1a191817161514131211100f0e0d0c0b0a0908070605040302010000112233445566778899aabbccddeeff00102030405060708090a0b0c0d0e0f000943577ffff001dffffffff44332211efcdab89ffeeddccbbaa9988776655443322110088776655030018ff2222222222222222111111111111111140d10c000000000000000000000000000000000000000000000000000000000000000000",
        xor_key_hash: "7bd0c09b8fe9cf1513cc141524b5bf46a4851ce06fe5bce05e04f9434f0a88a2",
        h1: "f06e36d21af2982442bff107cf6546b4440421f841a49ed027d4fa11e3e504e6",
        h2: "eae5d77dab38f5094ad95e848237614bd734f7fbc66f306422eccd2f009dc91e",
        blake2b_1: "544a71e01a4c041c727e86ec7cb2c68c62d9dcab0ee9b07cdaf1a59bf2e5d40b",
        blake2b_2: "c31b24420d67f86e524f980a24a18e88f36c821046d5288251b5d88998c69f87",
        mask: "0000000000000000000000000000000000000000000000000000000000000001",
        block_hash: "c31b24420d67f86e524f980a24a18e88f36c821046d5288251b5d88998c69f86",
        asic_profile: 0,
    },
];

/// Knots' vector fields (C++ names; the 128-bit ones in GetHex / RPC order) ->
/// this crate's struct, as the kernel's `fromVector` does.
fn from_knots(v: &KnotsVector) -> Blake2bV2Header {
    let uses_offset = v.flags & 4 != 0;
    Blake2bV2Header {
        version: v.n_version | 0x8000_0000,
        prev_block_hash: BlockHash::from_hex(v.prev).unwrap(),
        merkle_root: wire32(v.merkle),
        time_on_wire: if uses_offset {
            v.n_time.wrapping_sub(v.time_offset)
        } else {
            v.n_time
        },
        bits: v.n_bits,
        nonce: v.n_nonce,
        nonce2: v.nonce2,
        nonce3: v.nonce3,
        extranonce: rev16(v.extranonce_rpc),
        time_offset: v.time_offset,
        tx_count: v.txcount,
        flags: v.flags,
        xor_key_mask_clear_bits: v.clear_bits,
        xor_key: rev16(v.xor_key_rpc),
        height: v.height,
        mm_rhs: wire32(v.mm_rhs),
    }
}

#[test]
fn knots_vectors_encode_decode_and_hash_stage_for_stage() {
    for v in KNOTS {
        let h = from_knots(v);
        assert_eq!(hex::encode(h.encode()), v.serialized, "{}: encode", v.name);
        let decoded = Blake2bV2Header::decode(&bytes(v.serialized)).unwrap();
        assert_eq!(decoded, h, "{}: decode", v.name);
        assert_eq!(decoded.time(), v.n_time, "{}: consensus time", v.name);
        let s = h.hash_stages();
        assert_eq!(
            hex::encode(s.xor_key_hash),
            v.xor_key_hash,
            "{}: xor_key_hash",
            v.name
        );
        assert_eq!(hex::encode(s.h1), v.h1, "{}: h1", v.name);
        assert_eq!(hex::encode(s.h2), v.h2, "{}: h2", v.name);
        assert_eq!(
            hex::encode(s.blake2b_1),
            v.blake2b_1,
            "{}: blake2b_1",
            v.name
        );
        assert_eq!(
            hex::encode(s.blake2b_2),
            v.blake2b_2,
            "{}: blake2b_2",
            v.name
        );
        assert_eq!(hex::encode(s.mask), v.mask, "{}: mask", v.name);
        assert_eq!(s.asic_profile, v.asic_profile, "{}: profile", v.name);
        assert_eq!(s.hash.to_string(), v.block_hash, "{}: block hash", v.name);
        assert_eq!(h.hash().to_string(), v.block_hash);
        assert_eq!(Header::Blake2bV2(h).hash().to_string(), v.block_hash);
        assert_eq!(Header::Blake2bV2(h).height(), Some(v.height));
        assert_eq!(h.check_flags(), Ok(()), "{}: reserved flags clear", v.name);
    }
}

// ---- BLAKE2b v2 family: real fork headers ----

const TXBT4_FORK_HEADER: &str = "000000a0ccb157caa788400a667f6c19858ee913c701a42c8d1cd85122ec17000000000043d2e57990429ae581621ce01aa5fbf5e4c2723996be18660a4930b91e96d6c871b4946affff001dce0ac801d123881f71b4946a00000000b10cf00d0100000000000000000000008e00000000000000000000000000000000000000244b02000000000000000000000000000000000000000000000000000000000000000000";

#[test]
fn live_fork_headers_hash_as_the_node_says() {
    // Real Bitcoin Knots headers from a Knots 29.4.1 node, 2026-09-05 (kernel anchors).
    let live: &[(&str, u32, &str, &str)] = &[
        ("txbt4 fork block", 150_308, TXBT4_FORK_HEADER, "000000000000b9d1b7e1bb0e77215ee92c6ef7ec8f4473e23908380649e779b6"),
        ("txbt4 ordinary post-fork block", 150_462,
         "000000a01c72546d3143d8d5c5b538a5c99eaade668674027cf91497c199a3bf00000000e888021ac3906d60dc1612629d5bcb6785c175679ea582e62885366d66d96928a4899b6affff001d6f6d2f00000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000be4b02000000000000000000000000000000000000000000000000000000000000000000",
         "000000003394e00ec758f80611c5950914b44c7feabfe03493645780c2319f91"),
        ("xbt fork block", 961_640,
         "000000a0657e02138733654183a2c7320d85ca9d743fe139c4bb01000000000000000000c137a8515a0f6b3aaf6049cc7611787c022ad523d51094be0a0363d0dc0bc7684dca936a4f8d001a5671798c84daeb494dca936a00000000b1ccf00d0300000000000000000000001e0300000000000000000000000000000000000068ac0e000000000000000000000000000000000000000000000000000000000000000000",
         "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb"),
        ("xbt second BLAKE2b block", 961_641,
         "000000a0eb8ef1961354c8a8e794a4e5464fe13b2959f47296f6e5c150000000000000006639b797171dbe9c48f7d32714d7a3c7d850bfee30772864e4214ed9d80282fea5ce936a4f8d001a7c31a7570cb5e64aa5ce936a00000000b1ccf00d020000000000000000000000120200000000000000000000000000000000000069ac0e000000000000000000000000000000000000000000000000000000000000000000",
         "0000000000000010ef13157db08c138ea82aa1ac0ec360bdb9f101ce3ed7f7b6"),
    ];
    let mut prev_xbt = None;
    for (name, height, hex, id) in live {
        let raw = bytes(hex);
        let h = Blake2bV2Header::decode(&raw).unwrap();
        assert_eq!(h.height, *height, "{name}: committed height");
        assert_eq!(h.hash().to_string(), *id, "{name}: hash");
        assert_eq!(h.encode().as_slice(), raw.as_slice(), "{name}: round trip");
        assert!(h.meets_target(), "{name}: meets its own bits");
        assert_eq!(h.check_flags(), Ok(()));
        assert_eq!(
            HeaderFamily::from_version(h.version),
            HeaderFamily::Blake2bV2
        );
        let via = HeaderFamily::Blake2bV2.decode(&raw).unwrap();
        assert_eq!(via.hash().to_string(), *id);
        assert_eq!(via.encode().as_ref(), raw.as_slice());
        if *height == 961_640 {
            prev_xbt = Some(h.hash());
        }
        if *height == 961_641 {
            assert_eq!(
                Some(h.prev_block_hash),
                prev_xbt,
                "961641 links to the fork block"
            );
        }
    }
    let fork_block = Blake2bV2Header::decode(&bytes(TXBT4_FORK_HEADER)).unwrap();
    assert_eq!(fork_block.hash(), fork::TXBT4_FORK_HASH);
    assert_eq!(fork_block.height, fork::TXBT4_FORK_HEIGHT);
    assert_eq!(
        fork_block.prev_block_hash.to_string(),
        "000000000017ec2251d81c8d2ca401c713e98e85196c7f660a4088a7ca57b1cc",
        "the fork block's parent is the last shared SHA-256d block"
    );
    assert_eq!(fork_block.tx_count, 142);
    assert_eq!(
        fork_block.flags, 0,
        "the fork block uses ASIC profile 0 and no time offset"
    );
    assert!(!fork_block.uses_time_offset());
    assert_eq!(fork_block.time(), fork_block.time_on_wire);
}

#[test]
fn stock_headers_before_the_fork_are_still_sha256d() {
    // txbt4 150307 and xbt 961639, the last SHA-256d blocks of each fork chain.
    for (hex, id) in [
        ("00e0572cb60133b39f77761d271c389f3de1cd9079db9fd46df7eb6b8d8a230000000000b78b78c0f2dacc8b911d5c3b439de9a03148729bb0a482205f2a5493f05817f94378936affff001d2200f068",
         "000000000017ec2251d81c8d2ca401c713e98e85196c7f660a4088a7ca57b1cc"),
        ("10000a205fca17a6566978303e989d163e1aa9dc6715eef5542e0000000000000000000080fe52c98f1c1f8484213dff5a88315f7c334d0705f7d79579b289781868c0dff5c1916a3d350217510c87ed",
         "00000000000000000001bbc439e13f749dca850d32c7a2834165338713027e65"),
    ] {
        let h = StockHeader::decode(&bytes(hex)).unwrap();
        assert_eq!(h.hash().to_string(), id);
        assert!(h.meets_target());
    }
}

// ---- BLAKE2b v2 family: sidestr-shaped headers from the JS oracle ----

#[test]
fn sidestr_shaped_v2_headers_match_the_js_oracle() {
    // oracle: siding `buildBlock` beside txbt4 + bitcoin-desktop/schema codec at
    // b8cbf63 (`hashHeaderV2Detailed`, `blockData`); sidestr/spec at 2de40bd.
    let lim = Target::from_hex(DREAMLAB_POW_LIMIT).unwrap();
    struct V {
        header: &'static str,
        height: u32,
        prev: &'static str,
        merkle: &'static str,
        time: u32,
        nonce: u32,
        h1: &'static str,
        h2: &'static str,
        b1: &'static str,
        b2: &'static str,
        hash: &'static str,
        block_data: &'static str,
    }
    let vs = [
        V { header: "000000a000000000000000000000000000000000000000000000000000000000000000009488dc7dc8b10b9ec686f1b920e5722ecd70e6f13315b4e83d35da36174e19ad0e67b26affff7f2000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
            height: 0, prev: "0000000000000000000000000000000000000000000000000000000000000000",
            merkle: "ad194e1736da353de8b41533f1e670cd2e72e520b9f186c69e0bb1c87ddc8894", time: 1790076686, nonce: 0,
            h1: "db473d2040791335b8e272c06d25a9e71107e29b4f469fcc82504c1cdd325fe9", h2: "efdb16f145f2295034b1838e8a09c2b8ad32202436812030604897d3abbb49d4",
            b1: "cc264147dfe61dd23153fb8dd17e047360c561ac1a08a0d0909a7b61c259ab3f", b2: "f97cc8615454cdc5aed9329c94843c6b36de8f232383a96a7a09f2f91806a58b",
            hash: "f97cc8615454cdc5aed9329c94843c6b36de8f232383a96a7a09f2f91806a58b", block_data: "e89c80c04ae78dd7bec60ebfc4a58784020ee5648af52371272ebae44a1700a3" },
        V { header: "000000a0919f31c28057649334e0bfea7f4cb4140995c51106f858c70ee09433000000002e6eba639a897512e7e36290d55cf6c66fea570ba1e5fc7345a031ebbb0379900074b26affff7f2039300000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000070000000000000000000000000000000000000000000000000000000000000000000000",
            height: 7, prev: "000000003394e00ec758f80611c5950914b44c7feabfe03493645780c2319f91",
            merkle: "907903bbeb31a04573fce5a10b57ea6fc6f65cd59062e3e71275899a63ba6e2e", time: 1790080000, nonce: 12345,
            h1: "aab7563d812375da00c45071e309adcd00f13bd581e6ab0dae7c96cdbd3d098f", h2: "4c42390af3909048acacaa599a1cf4030f7f3efe09cd8bb71a9a5f20c8382855",
            b1: "f77adf1fe9c651a7abef1b83a86fc455f5e187a9be42df4ed524c9210ecb343d", b2: "b63643e6a2d9bb5a4d5398e4c1bfdd65cab9cf04f0502abe82068f24ecd69e79",
            hash: "b63643e6a2d9bb5a4d5398e4c1bfdd65cab9cf04f0502abe82068f24ecd69e79", block_data: "16452c33b33112bbcdd1e7446ebfc3898c6cda823ec49ec4e08c8d398f9467a1" },
    ];
    for v in vs {
        let raw = bytes(v.header);
        assert_eq!(raw.len(), 164);
        let h = Blake2bV2Header::decode(&raw).unwrap();
        assert_eq!(h.version, 0xa000_0000, "siding's v2 version");
        assert_eq!(h.height, v.height);
        assert_eq!(h.prev_block_hash.to_string(), v.prev);
        assert_eq!(h.merkle_root, wire32(v.merkle));
        assert_eq!(h.time_on_wire, v.time);
        assert_eq!(h.nonce, v.nonce);
        assert_eq!(h.tx_count, 1);
        assert_eq!(h.bits, lim.to_compact());
        assert_eq!(
            (
                h.nonce2,
                h.nonce3,
                h.time_offset,
                h.flags,
                h.xor_key_mask_clear_bits
            ),
            (0, 0, 0, 0, 0)
        );
        assert_eq!(h.extranonce, [0u8; 16]);
        assert_eq!(h.xor_key, [0u8; 16]);
        assert_eq!(h.mm_rhs, [0u8; 32]);
        let s = h.hash_stages();
        assert_eq!(hex::encode(s.h1), v.h1);
        assert_eq!(hex::encode(s.h2), v.h2);
        assert_eq!(hex::encode(s.blake2b_1), v.b1);
        assert_eq!(hex::encode(s.blake2b_2), v.b2);
        assert_eq!(s.mask, [0u8; 32]);
        assert_eq!(s.hash.to_string(), v.hash);
        // These oracle headers are unsealed: the kernel reported pow: false.
        assert!(!h.meets_target());
        assert_eq!(h.check_pow(&lim), Err(Error::TargetNotMet));
        // No solution in the coinbase, so the stripped root is the header's own.
        assert_eq!(hex::encode(h.block_data(h.merkle_root)), v.block_data);
        assert_eq!(
            Header::Blake2bV2(h).block_data(h.merkle_root),
            h.block_data(h.merkle_root)
        );
        assert_eq!(hex::encode(h.encode()), v.header);
    }
}

#[test]
fn v2_rejects_wrong_length_bit_31_clear_and_reserved_flags() {
    let raw = bytes(TXBT4_FORK_HEADER);
    assert_eq!(
        Blake2bV2Header::decode(&raw[..163]),
        Err(Error::WrongLength {
            family: HeaderFamily::Blake2bV2,
            expected: 164,
            actual: 163
        })
    );
    assert!(matches!(
        Blake2bV2Header::decode(&bytes(DREAMLAB_BLOCK0)),
        Err(Error::WrongLength { actual: 80, .. })
    ));
    let mut stock_bit = raw.clone();
    stock_bit[3] &= 0x7f;
    assert_eq!(
        Blake2bV2Header::decode(&stock_bit),
        Err(Error::VersionBit31Clear)
    );
    assert_eq!(
        HeaderFamily::Blake2bV2.decode(&stock_bit),
        Err(Error::VersionBit31Clear)
    );

    let mut h = Blake2bV2Header::decode(&raw).unwrap();
    h.flags |= 0x40;
    assert_eq!(h.check_flags(), Err(Error::ReservedFlags(h.flags)));
}

// ---- targets ----

#[test]
fn compact_targets_round_trip_and_reject_core_edge_cases() {
    let lim = Target::from_hex(DREAMLAB_POW_LIMIT).unwrap();
    assert_eq!(lim.to_compact(), 0x207f_ffff);
    // Compact encoding keeps three bytes: the effective target a sidestr block
    // is checked against is the truncated powLimit, as in the kernel.
    let effective = Target::from_compact(0x207f_ffff).unwrap();
    assert_eq!(
        effective.to_string(),
        "7fffff0000000000000000000000000000000000000000000000000000000000"
    );
    assert!(effective < lim);
    assert_eq!(effective.to_compact(), 0x207f_ffff);
    // Bitcoin's powLimit and genesis bits.
    let btc = Target::from_hex("00000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
        .unwrap();
    assert_eq!(btc.to_compact(), 0x1d00_ffff);
    // a real retargeted bits value survives a round trip
    for bits in [
        0x1d00_ffff,
        0x1b04_04cb,
        0x1a05_db8b,
        0x1703_a30c,
        0x0101_0000,
        0x0201_0000,
        0x0301_0000,
    ] {
        assert_eq!(
            Target::from_compact(bits).unwrap().to_compact(),
            bits,
            "{bits:#x}"
        );
    }
    // Core's SetCompact edge cases (arith_uint256_tests): zero, small exponents, sign, overflow.
    assert_eq!(Target::from_compact(0).unwrap().to_compact(), 0);
    assert_eq!(
        Target::from_compact(0x0112_3456).unwrap().to_compact(),
        0x0112_0000
    );
    assert_eq!(
        Target::from_compact(0x0212_3456).unwrap().to_compact(),
        0x0212_3400
    );
    assert_eq!(
        Target::from_compact(0x0312_3456).unwrap().to_compact(),
        0x0312_3456
    );
    assert_eq!(
        Target::from_compact(0x0412_3456).unwrap().to_compact(),
        0x0412_3456
    );
    assert_eq!(
        Target::from_compact(0x0492_3456),
        Err(Error::CompactNegative(0x0492_3456))
    );
    assert_eq!(Target::from_compact(0x0480_0000).unwrap().to_compact(), 0);
    assert_eq!(
        Target::from_compact(0x2012_3456).unwrap().to_compact(),
        0x2012_3456
    );
    assert_eq!(
        Target::from_compact(0xff12_3456),
        Err(Error::CompactOverflow(0xff12_3456))
    );
    assert_eq!(
        Target::from_compact(0x2312_3456),
        Err(Error::CompactOverflow(0x2312_3456))
    );
    assert!(
        Target::from_compact(0x2200_0034).is_ok(),
        "one byte fits at exponent 34"
    );
    assert_eq!(Target::MAX.to_compact(), 0x2100_ffff);
    assert!(BlockHash::ZERO.meets(&Target::from_compact(0).unwrap()));
    assert!(Target::from_compact(0).unwrap().is_zero());
}

#[test]
fn hashes_compare_against_targets_numerically() {
    let t = Target::from_compact(0x1d00_ffff).unwrap();
    assert!(fork::BTC_GENESIS_HASH.meets(&t));
    assert!(!BlockHash::from_hex(
        "00000001000000000000000000000000000000000000000000000000000000000"
    )
    .is_ok());
    let just_over =
        BlockHash::from_hex("00000000ffff0000000000000000000000000000000000000000000000000001")
            .unwrap();
    assert!(!just_over.meets(&t));
    let exact =
        BlockHash::from_hex("00000000ffff0000000000000000000000000000000000000000000000000000")
            .unwrap();
    assert!(exact.meets(&t));
}

#[test]
fn family_metadata() {
    assert_eq!(HeaderFamily::Stock.wire_size(), 80);
    assert_eq!(HeaderFamily::Blake2bV2.wire_size(), 164);
    assert_eq!(HeaderFamily::Stock.pow_hash_name(), "sha256d");
    assert_eq!(HeaderFamily::Blake2bV2.pow_hash_name(), "knots:blake2b-v2");
    assert_eq!(HeaderFamily::from_version(0x2000_0000), HeaderFamily::Stock);
    assert_eq!(
        HeaderFamily::from_version(0xa000_0000),
        HeaderFamily::Blake2bV2
    );
    assert_eq!(fork::XBT_FORK_HEIGHT, 961_640);
    assert_eq!(fork::TXBT4_FORK_HEIGHT, 150_308);
    assert_eq!(
        fork::XBT_FORK_HASH.to_string(),
        "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb"
    );
    assert_eq!(
        format!("{}", Error::TargetNotMet),
        "block hash does not meet the target"
    );
}
