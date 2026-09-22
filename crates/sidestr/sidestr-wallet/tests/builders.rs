//! Accept and reject for every builder, against coins as a producer would
//! list them (no chain needed): what the wallet refuses before it signs,
//! and that what it signs verifies under `sidestr-core`'s rule.

use bitcoin::hashes::{sha256, Hash};
use bitcoin::secp256k1::SecretKey;
use bitcoin::{Amount, OutPoint, TxOut, Txid};
use sidestr_core::block::verify_key_path_input;
use sidestr_core::document::ChainDocument;
use sidestr_core::marker::{parse_peg_marker, parse_pegout};
use sidestr_wallet::burn::{build_burn, BurnRequest};
use sidestr_wallet::coins::{from_json, Coin};
use sidestr_wallet::key::address_for;
use sidestr_wallet::pegin::build_pegin;
use sidestr_wallet::policy::{Intent, IntentKind, SpendPolicy};
use sidestr_wallet::spend::{build_spend, SpendRequest};
use sidestr_wallet::{Error, Permissive, PlainKey, SpendSigner};

const TB_P2TR: &str = "tb1pvts4e2zcrujj9zey3kadyfgh2xs93v8va8ae9ldhukpxy2n3848qyqurhc";
const BC_P2TR: &str = "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0";
const TB_P2WPKH: &str = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";

fn key(seed: &str) -> PlainKey {
    PlainKey::new(
        SecretKey::from_slice(
            &sha256::Hash::hash(format!("sidestr-wallet test key {seed}").as_bytes())
                .to_byte_array(),
        )
        .unwrap(),
    )
}

fn doc(min_fee_rate: u64, pegout_min: u64) -> ChainDocument {
    ChainDocument::from_json(&format!(
        r#"{{"id":"sidestr:trial","name":"trial","parent":"tbtc4",
        "challenge":"512098b4e74305dac5ce76d5bee8e57a71549a27618a0e51b3bada3074fcba02325b",
        "powLimit":"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        "addressPrefix":"trl","genesisTime":1790076612,"pegs":[],
        "minFeeRate":{min_fee_rate},"pegoutMin":{pegout_min}}}"#
    ))
    .unwrap()
}

fn coin(n: u8, value: u64, height: u32, coinbase: bool) -> Coin {
    Coin {
        outpoint: OutPoint {
            txid: Txid::from_byte_array([n; 32]),
            vout: u32::from(n),
        },
        value,
        height,
        coinbase,
    }
}

fn prevouts(me: &dyn SpendSigner, coins: &[Coin], tx: &bitcoin::Transaction) -> Vec<TxOut> {
    tx.input
        .iter()
        .map(|i| TxOut {
            value: Amount::from_sat(
                coins
                    .iter()
                    .find(|c| c.outpoint == i.previous_output)
                    .unwrap()
                    .value,
            ),
            script_pubkey: me.script(),
        })
        .collect()
}

#[test]
fn spend_accepts_and_sizes_the_fee() {
    let chain = doc(3, 10_000);
    let me = key("alice");
    let you = address_for(&key("bob").pubkey(), "trl").unwrap();
    let coins = vec![coin(1, 60_000, 1, false), coin(2, 30_000, 2, false)];
    let req = SpendRequest {
        chain: &chain,
        coins: &coins,
        tip_height: 10,
        to: &you,
        amount: 70_000,
        fee: None,
    };
    let s = build_spend(&req, &me, &Permissive).unwrap();
    // two inputs, amount + change, fee exactly the rate times the signed size
    assert_eq!(s.inputs, 2);
    assert_eq!(s.vsize, s.tx.weight().to_wu().div_ceil(4));
    assert_eq!(s.fee, 3 * s.vsize);
    assert_eq!(s.change, 90_000 - 70_000 - s.fee);
    assert_eq!(s.tx.output.len(), 2);
    assert_eq!(s.tx.output[1].script_pubkey, me.script());
    assert!(s.note.is_none());
    let p = prevouts(&me, &coins, &s.tx);
    for i in 0..2 {
        verify_key_path_input(&s.tx, i, &p).unwrap();
        assert_eq!(s.tx.input[i].witness.len(), 1);
        assert_eq!(s.tx.input[i].witness[0].len(), 64);
    }
    // deterministic: the same request signs the same bytes
    assert_eq!(build_spend(&req, &me, &Permissive).unwrap().hex, s.hex);

    // an explicit fee above the floor is honoured
    let fixed = build_spend(
        &SpendRequest {
            fee: Some(2_000),
            ..req
        },
        &me,
        &Permissive,
    )
    .unwrap();
    assert_eq!((fixed.fee, fixed.change), (2_000, 18_000));

    // paying a script hex directly; a foreign prefix is paid with a note
    let by_script = build_spend(
        &SpendRequest {
            to: &key("bob").script().to_hex_string(),
            ..req
        },
        &me,
        &Permissive,
    )
    .unwrap();
    assert_eq!(by_script.tx.output[0], s.tx.output[0]);
    let foreign = build_spend(&SpendRequest { to: TB_P2TR, ..req }, &me, &Permissive).unwrap();
    assert!(foreign.note.unwrap().contains("carries prefix 'tb'"));
}

#[test]
fn spend_change_under_dust_goes_to_the_fee() {
    let chain = doc(1, 10_000);
    let me = key("alice");
    let coins = vec![coin(1, 10_400, 1, false)];
    // 10_400 - 10_000 - 111 (one-in-one-out) = 289 < 330 dust: no change output
    let s = build_spend(
        &SpendRequest {
            chain: &chain,
            coins: &coins,
            tip_height: 5,
            to: &key("bob").script().to_hex_string(),
            amount: 10_000,
            fee: None,
        },
        &me,
        &Permissive,
    )
    .unwrap();
    assert_eq!(s.tx.output.len(), 1);
    assert_eq!((s.change, s.fee, s.vsize), (0, 400, 111));
}

#[test]
fn spend_rejects() {
    let chain = doc(2, 10_000);
    let me = key("alice");
    let to = key("bob").script().to_hex_string();
    let coins = vec![
        coin(1, 50_000, 1, false),
        coin(2, 40_000, 900, true), // immature at tip 950
    ];
    let req = SpendRequest {
        chain: &chain,
        coins: &coins,
        tip_height: 950,
        to: &to,
        amount: 49_700,
        fee: None,
    };
    // insufficient: the coinbase is immature, 50_000 < 49_700 + 400
    let e = build_spend(&req, &me, &Permissive).unwrap_err();
    assert!(
        matches!(
            e,
            Error::Insufficient {
                have: 50_000,
                need: 50_100
            }
        ),
        "{e}"
    );
    assert_eq!(
        e.to_string(),
        "insufficient: 50000 sats mature, 50100 needed"
    );
    // mature at tip 999: enough
    assert!(build_spend(
        &SpendRequest {
            tip_height: 999,
            ..req
        },
        &me,
        &Permissive
    )
    .is_ok());
    // covers the bound but not the sized fee: three inputs come to 269 vB (538 sats at 2 sat/vB),
    // more than the 400-sat bound selection covered, and the change would be negative
    let three = vec![
        coin(3, 20_000, 1, false),
        coin(4, 20_000, 1, false),
        coin(5, 20_000, 1, false),
    ];
    let e = build_spend(
        &SpendRequest {
            coins: &three,
            amount: 59_500,
            ..req
        },
        &me,
        &Permissive,
    )
    .unwrap_err();
    assert!(
        matches!(
            e,
            Error::InsufficientForFee {
                amount: 59_500,
                fee: 538
            }
        ),
        "{e}"
    );
    // dust
    let e = build_spend(&SpendRequest { amount: 329, ..req }, &me, &Permissive).unwrap_err();
    assert!(
        matches!(
            e,
            Error::Dust {
                value: 329,
                min: 330,
                ..
            }
        ),
        "{e}"
    );
    assert!(matches!(
        build_spend(&SpendRequest { amount: 0, ..req }, &me, &Permissive),
        Err(Error::BadAmount)
    ));
    // an explicit fee under minFeeRate × vsize
    let e = build_spend(
        &SpendRequest {
            amount: 20_000,
            fee: Some(100),
            ..req
        },
        &me,
        &Permissive,
    )
    .unwrap_err();
    assert!(
        matches!(
            e,
            Error::FeeBelowMinimum {
                fee: 100,
                min: 308,
                vsize: 154,
                rate: 2
            }
        ),
        "{e}"
    );
    // bad destinations
    assert!(matches!(
        build_spend(
            &SpendRequest {
                to: "trl1nope",
                ..req
            },
            &me,
            &Permissive
        ),
        Err(Error::BadDestination(_))
    ));
    assert!(matches!(
        build_spend(&SpendRequest { to: "", ..req }, &me, &Permissive),
        Err(Error::BadDestination(_))
    ));
}

#[test]
fn policy_is_consulted_before_signing() {
    struct Cap(u64);
    impl SpendPolicy for Cap {
        fn permit(&self, i: &Intent<'_>) -> Result<(), String> {
            assert_eq!(i.chain_id, "sidestr:trial");
            assert!(i.fee > 0 && i.inputs == 1);
            if i.amount > self.0 {
                Err(format!("{} over {}", i.amount, self.0))
            } else {
                Ok(())
            }
        }
    }
    let chain = doc(1, 10_000);
    let me = key("alice");
    let coins = vec![coin(1, 100_000, 1, false)];
    let req = SpendRequest {
        chain: &chain,
        coins: &coins,
        tip_height: 5,
        to: TB_P2TR,
        amount: 20_000,
        fee: None,
    };
    assert!(build_spend(&req, &me, &Cap(20_000)).is_ok());
    let e = build_spend(&req, &me, &Cap(19_999)).unwrap_err();
    assert!(
        matches!(e, Error::Policy(ref m) if m == "20000 over 19999"),
        "{e}"
    );
    // a burn tells the policy it is a burn, with the parent script
    struct NoBurns;
    impl SpendPolicy for NoBurns {
        fn permit(&self, i: &Intent<'_>) -> Result<(), String> {
            match i.kind {
                IntentKind::Burn => Err(format!("no burns to {}", i.script.to_hex_string())),
                IntentKind::Spend => Ok(()),
            }
        }
    }
    let b = BurnRequest {
        chain: &chain,
        coins: &coins,
        tip_height: 5,
        to: TB_P2TR,
        amount: 20_000,
        fee: None,
    };
    let e = build_burn(&b, &me, &NoBurns).unwrap_err();
    assert!(
        e.to_string()
            .starts_with("policy refused: no burns to 5120"),
        "{e}"
    );
    assert!(build_spend(&req, &me, &NoBurns).is_ok());
}

#[test]
fn burn_accepts_and_rejects() {
    let chain = doc(1, 10_000);
    let me = key("alice");
    let coins = vec![coin(1, 100_000, 1, false)];
    let req = BurnRequest {
        chain: &chain,
        coins: &coins,
        tip_height: 5,
        to: TB_P2TR,
        amount: 10_000,
        fee: None,
    };
    let b = build_burn(&req, &me, &Permissive).unwrap();
    let named = parse_pegout(&b.tx.output[0].script_pubkey).unwrap();
    assert_eq!(
        named,
        sidestr_core::address::address_to_script(TB_P2TR)
            .unwrap()
            .to_hex_string()
    );
    assert_eq!(b.tx.output[0].value.to_sat(), 10_000);
    assert_eq!(b.tx.output[1].script_pubkey, me.script());
    verify_key_path_input(&b.tx, 0, &prevouts(&me, &coins, &b.tx)).unwrap();
    assert!(b.note.unwrap().contains("owed to tb1pvts4e2z"));
    // a v0 parent address names a 22-byte script; a script hex directly
    assert!(build_burn(
        &BurnRequest {
            to: TB_P2WPKH,
            ..req
        },
        &me,
        &Permissive
    )
    .is_ok());
    let by_script = build_burn(
        &BurnRequest {
            to: "0014751e76e8199196d454941c45d1b3a323f1433bd6",
            ..req
        },
        &me,
        &Permissive,
    )
    .unwrap();
    assert_eq!(
        parse_pegout(&by_script.tx.output[0].script_pubkey).unwrap(),
        "0014751e76e8199196d454941c45d1b3a323f1433bd6"
    );

    // below pegoutMin, refused before any coin is looked at
    let e = build_burn(
        &BurnRequest {
            amount: 9_999,
            coins: &[],
            ..req
        },
        &me,
        &Permissive,
    )
    .unwrap_err();
    assert!(
        matches!(
            e,
            Error::BelowPegoutMin {
                value: 9_999,
                min: 10_000
            }
        ),
        "{e}"
    );
    assert_eq!(
        e.to_string(),
        "a peg-out burns at least 10000 sats, not 9999"
    );
    // a script the chain would refuse: over 40 bytes, or 1 byte
    let e = build_burn(
        &BurnRequest {
            to: &"ab".repeat(41),
            ..req
        },
        &me,
        &Permissive,
    )
    .unwrap_err();
    assert!(matches!(e, Error::BadDestination(_)), "{e}");
    assert!(matches!(
        build_burn(&BurnRequest { to: "51", ..req }, &me, &Permissive),
        Err(Error::BadDestination(_))
    ));
    // the spend checks still apply
    assert!(matches!(
        build_burn(
            &BurnRequest {
                amount: 200_000,
                ..req
            },
            &me,
            &Permissive
        ),
        Err(Error::Insufficient { .. })
    ));
    assert!(matches!(
        build_burn(
            &BurnRequest {
                fee: Some(1),
                ..req
            },
            &me,
            &Permissive
        ),
        Err(Error::FeeBelowMinimum { .. })
    ));
}

#[test]
fn pegin_accepts_and_rejects() {
    let chain = doc(1, 10_000);
    let mine = address_for(&key("alice").pubkey(), "trl").unwrap();
    let p = build_pegin(&chain, TB_P2TR, 250_000, &mine).unwrap();
    assert_eq!(p.peg.value.to_sat(), 250_000);
    assert!(p.peg.script_pubkey.is_p2tr());
    assert_eq!(
        parse_peg_marker(&p.marker.script_pubkey, "sidestr:trial").unwrap(),
        key("alice").script()
    );
    assert_eq!(p.outputs().len(), 2);
    let send = p.core_send_outputs();
    assert_eq!(send[0][TB_P2TR], "0.00250000");
    assert!(send[1]["data"]
        .as_str()
        .unwrap()
        .starts_with(&hex::encode("pegin:sidestr:trial:")));
    // the same by script hex
    assert_eq!(
        build_pegin(
            &chain,
            TB_P2TR,
            250_000,
            &key("alice").script().to_hex_string()
        )
        .unwrap(),
        p
    );

    // wrong network: a mainnet address beside tbtc4
    let e = build_pegin(&chain, BC_P2TR, 250_000, &mine).unwrap_err();
    assert!(
        matches!(e, Error::WrongNetwork { ref network, ref parent, .. } if network == "testnet4" && parent == "tbtc4"),
        "{e}"
    );
    // and the reverse, beside btc
    let mut mainnet = doc(1, 10_000);
    mainnet.parent = "btc".into();
    let e = build_pegin(&mainnet, TB_P2TR, 250_000, &mine).unwrap_err();
    assert!(
        matches!(e, Error::WrongNetwork { ref network, .. } if network == "bitcoin"),
        "{e}"
    );
    // not taproot, not an address, dust, zero
    assert!(matches!(
        build_pegin(&chain, TB_P2WPKH, 250_000, &mine),
        Err(Error::BadDestination(_))
    ));
    assert!(matches!(
        build_pegin(&chain, "tb1qnope", 250_000, &mine),
        Err(Error::BadDestination(_))
    ));
    assert!(matches!(
        build_pegin(&chain, TB_P2TR, 100, &mine),
        Err(Error::Dust { min: 330, .. })
    ));
    assert!(matches!(
        build_pegin(&chain, TB_P2TR, 0, &mine),
        Err(Error::BadAmount)
    ));
    // a chain id so long the marker cannot fit the parent's data limit
    let mut long = doc(1, 10_000);
    long.id = format!("sidestr:{}", "x".repeat(60));
    assert!(matches!(
        build_pegin(&long, TB_P2TR, 250_000, &mine),
        Err(Error::MarkerTooLong(_))
    ));
}

#[test]
fn coins_from_the_producers_json_spend_the_same() {
    let chain = doc(1, 10_000);
    let me = key("alice");
    let listed = from_json(&format!(
        r#"[{{"outpoint":"{}:1","value":50000,"height":3,"coinbase":false}}]"#,
        "01".repeat(32)
    ))
    .unwrap();
    assert_eq!(listed, vec![coin(1, 50_000, 3, false)]);
    let s = build_spend(
        &SpendRequest {
            chain: &chain,
            coins: &listed,
            tip_height: 3,
            to: TB_P2TR,
            amount: 20_000,
            fee: None,
        },
        &me,
        &Permissive,
    )
    .unwrap();
    assert_eq!(s.tx.input[0].previous_output, listed[0].outpoint);
}
