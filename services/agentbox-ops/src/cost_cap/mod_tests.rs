//! Unit tests for the ADR-2020 execution-gated cost cap.

use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tempfile::TempDir;

const MANIFEST: &str = r#"
[skills.code_interpreter]
enabled = true

[skills.tree_search_coder]
enabled = true
max_candidates = 5
per_branch_timeout_s = 60
spend_cap_usd = 0.50
"#;

fn limiter(dir: &TempDir, cfg: CapConfig) -> Limiter {
    Limiter::new(cfg, dir.path().join("cap.json"))
}

fn cfg(cap: f64, max_candidates: u32, timeout_s: u64) -> CapConfig {
    CapConfig {
        enabled: true,
        spend_cap_usd: cap,
        max_candidates,
        per_branch_timeout_s: timeout_s,
        defaulted: vec![],
    }
}

#[test]
fn manifest_block_is_parsed_verbatim() {
    let c = CapConfig::from_manifest_toml(MANIFEST);
    assert!(c.enabled);
    assert_eq!(c.spend_cap_usd, 0.50);
    assert_eq!(c.max_candidates, 5);
    assert_eq!(c.per_branch_timeout_s, 60);
    assert!(c.defaulted.is_empty(), "every field was declared");
}

#[test]
fn absent_cap_falls_back_to_the_documented_default_not_infinity() {
    // No `[skills.tree_search_coder]` block at all.
    let c = CapConfig::from_manifest_toml("[skills.codeact]\nenabled = true\n");
    assert_eq!(c.spend_cap_usd, DEFAULT_SPEND_CAP_USD);
    assert_eq!(c.max_candidates, DEFAULT_MAX_CANDIDATES);
    assert_eq!(c.per_branch_timeout_s, DEFAULT_PER_BRANCH_TIMEOUT_S);
    assert!(c.defaulted.contains(&"spend_cap_usd".to_string()));

    // Block present, cap key missing.
    let c = CapConfig::from_manifest_toml("[skills.tree_search_coder]\nenabled = true\n");
    assert_eq!(c.spend_cap_usd, DEFAULT_SPEND_CAP_USD);
    assert_eq!(
        c.defaulted,
        vec!["spend_cap_usd", "max_candidates", "per_branch_timeout_s"]
    );

    // A garbage manifest must not disable the cap either.
    let c = CapConfig::from_manifest_toml("this is not toml =[");
    assert_eq!(c.spend_cap_usd, DEFAULT_SPEND_CAP_USD);

    // A nonsensical cap value is refused in favour of the default.
    let c = CapConfig::from_manifest_toml(
        "[skills.tree_search_coder]\nenabled = true\nspend_cap_usd = 0.0\n",
    );
    assert_eq!(c.spend_cap_usd, DEFAULT_SPEND_CAP_USD);
}

#[test]
fn under_cap_invocation_succeeds_and_settles() {
    let dir = TempDir::new().unwrap();
    let l = limiter(&dir, cfg(0.50, 5, 60));

    let r = l.reserve_at("run-a", 0.10, 1_000).expect("reserve");
    assert_eq!(r.candidate_index, 0);
    assert!((r.remaining_usd - 0.40).abs() < 1e-9);

    let s = l.settle_at(&r, 0.08, Outcome::Completed, 2_000).unwrap();
    assert!((s.committed_usd - 0.08).abs() < 1e-9);
    assert!((s.remaining_usd - 0.42).abs() < 1e-9);
    assert!(!s.timed_out);
    assert!(!s.overran_estimate);

    let st = l.status_at("run-a", 2_000).unwrap();
    assert_eq!(st.admitted, 1);
    assert_eq!(st.settled, 1);
    assert!(st.reservations.is_empty(), "hold released on success");
}

#[test]
fn a_single_over_cap_invocation_is_refused() {
    let dir = TempDir::new().unwrap();
    let l = limiter(&dir, cfg(0.50, 5, 60));

    let err = l.reserve_at("run-b", 0.51, 1_000).unwrap_err();
    match err {
        CapError::SpendCapExceeded {
            cap_usd,
            requested_usd,
            committed_usd,
            outstanding_usd,
        } => {
            assert_eq!(cap_usd, 0.50);
            assert_eq!(requested_usd, 0.51);
            assert_eq!(committed_usd, 0.0);
            assert_eq!(outstanding_usd, 0.0);
        }
        other => panic!("wrong error: {other:?}"),
    }
    // A refusal must not consume a candidate slot or mutate the ledger.
    let st = l.status_at("run-b", 1_000).unwrap();
    assert_eq!(st.admitted, 0);
    assert_eq!(st.committed_usd, 0.0);
}

#[test]
fn spend_exactly_at_the_cap_is_admitted_and_the_next_dollar_is_not() {
    let dir = TempDir::new().unwrap();
    let l = limiter(&dir, cfg(0.50, 5, 60));

    let r = l
        .reserve_at("run-c", 0.50, 1_000)
        .expect("exactly the cap fits");
    assert!(r.remaining_usd.abs() < 1e-9);
    assert!(matches!(
        l.reserve_at("run-c", 0.01, 1_000),
        Err(CapError::SpendCapExceeded { .. })
    ));
    l.settle_at(&r, 0.50, Outcome::Completed, 1_500).unwrap();
    assert!(matches!(
        l.reserve_at("run-c", 0.01, 1_600),
        Err(CapError::SpendCapExceeded { .. })
    ));
}

#[test]
fn in_flight_reservations_are_held_against_the_cap() {
    let dir = TempDir::new().unwrap();
    let l = limiter(&dir, cfg(0.50, 5, 60));

    let a = l.reserve_at("run-d", 0.30, 1_000).unwrap();
    // 0.30 in flight, nothing settled: only 0.20 is still available.
    assert!(matches!(
        l.reserve_at("run-d", 0.25, 1_000),
        Err(CapError::SpendCapExceeded { .. })
    ));
    let b = l.reserve_at("run-d", 0.20, 1_000).unwrap();

    // Releasing on the SUCCESS path frees the difference between estimate and actual.
    l.settle_at(&a, 0.10, Outcome::Completed, 1_100).unwrap();
    let st = l.status_at("run-d", 1_100).unwrap();
    assert!((st.committed_usd - 0.10).abs() < 1e-9);
    assert!((st.outstanding_usd() - 0.20).abs() < 1e-9);

    // Releasing on the FAILURE path frees the whole hold when nothing was spent.
    l.settle_at(&b, 0.0, Outcome::Failed, 1_200).unwrap();
    let st = l.status_at("run-d", 1_200).unwrap();
    assert!(st.reservations.is_empty(), "hold released on failure too");
    assert!((st.committed_usd - 0.10).abs() < 1e-9);
    // 0.40 of headroom is back.
    let c = l.reserve_at("run-d", 0.40, 1_300).unwrap();
    // Only granted reservations consume a candidate slot; the refusal above
    // (0.25 against 0.20 of headroom) did not.
    assert_eq!(c.candidate_index, 2);
}

#[test]
fn double_settle_is_refused_so_a_hold_cannot_be_released_twice() {
    let dir = TempDir::new().unwrap();
    let l = limiter(&dir, cfg(0.50, 5, 60));
    let r = l.reserve_at("run-e", 0.10, 1_000).unwrap();
    l.settle_at(&r, 0.10, Outcome::Completed, 1_100).unwrap();
    assert!(matches!(
        l.settle_at(&r, 0.10, Outcome::Completed, 1_200),
        Err(CapError::UnknownReservation { .. })
    ));
}

#[test]
fn concurrent_reservations_admit_exactly_the_ones_that_fit() {
    // Cap 0.50, eight threads each asking for 0.20 → exactly two can be admitted.
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("cap.json");
    let admitted = Arc::new(AtomicUsize::new(0));
    let refused = Arc::new(AtomicUsize::new(0));

    let handles: Vec<_> = (0..8)
        .map(|_| {
            let path = path.clone();
            let admitted = Arc::clone(&admitted);
            let refused = Arc::clone(&refused);
            std::thread::spawn(move || {
                let l = Limiter::new(cfg(0.50, 8, 60), path);
                match l.reserve_at("race", 0.20, 1_000) {
                    Ok(_) => admitted.fetch_add(1, Ordering::SeqCst),
                    Err(CapError::SpendCapExceeded { .. }) => {
                        refused.fetch_add(1, Ordering::SeqCst)
                    }
                    Err(e) => panic!("unexpected error: {e}"),
                };
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }

    assert_eq!(admitted.load(Ordering::SeqCst), 2, "0.20 + 0.20 <= 0.50");
    assert_eq!(refused.load(Ordering::SeqCst), 6);

    let l = Limiter::new(cfg(0.50, 8, 60), path);
    let st = l.status_at("race", 1_000).unwrap();
    assert_eq!(st.admitted, 2);
    assert!(
        st.outstanding_usd() <= 0.50 + 1e-9,
        "in-flight holds never jointly exceed the cap: {}",
        st.outstanding_usd()
    );
}

#[test]
fn concurrent_reservations_never_overshoot_a_ragged_cap() {
    // 1.00 cap, twelve threads at 0.15 → floor(1.00 / 0.15) = 6 admitted.
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("cap.json");
    let handles: Vec<_> = (0..12)
        .map(|_| {
            let path = path.clone();
            std::thread::spawn(move || {
                Limiter::new(cfg(1.00, 12, 60), path)
                    .reserve_at("ragged", 0.15, 5_000)
                    .is_ok()
            })
        })
        .collect();
    let ok = handles
        .into_iter()
        .map(|h| h.join().unwrap())
        .filter(|granted| *granted)
        .count();
    assert_eq!(ok, 6);

    let st = Limiter::new(cfg(1.00, 12, 60), path)
        .status_at("ragged", 5_000)
        .unwrap();
    assert!(st.outstanding_usd() <= 1.00 + 1e-9);
}

#[test]
fn candidate_limit_is_enforced_independently_of_spend() {
    let dir = TempDir::new().unwrap();
    let l = limiter(&dir, cfg(100.0, 3, 60)); // spend is not the binding constraint

    for i in 0..3 {
        let r = l.reserve_at("run-f", 0.01, 1_000).unwrap();
        assert_eq!(r.candidate_index, i);
        l.settle_at(&r, 0.01, Outcome::Completed, 1_100).unwrap();
    }
    match l.reserve_at("run-f", 0.01, 1_200).unwrap_err() {
        CapError::CandidateLimitExceeded {
            max_candidates,
            admitted,
        } => {
            assert_eq!(max_candidates, 3);
            assert_eq!(admitted, 3);
        }
        other => panic!("wrong error: {other:?}"),
    }
}

#[test]
fn per_branch_wall_clock_is_enforced() {
    let dir = TempDir::new().unwrap();
    let l = limiter(&dir, cfg(0.50, 5, 60));
    let r = l.reserve_at("run-g", 0.10, 0).unwrap();
    assert_eq!(r.deadline_ms, 60_000);

    l.guard_branch(&r, 59_000).expect("inside the window");
    match l.guard_branch(&r, 61_000).unwrap_err() {
        CapError::BranchTimeout {
            per_branch_timeout_s,
            elapsed_s,
            ..
        } => {
            assert_eq!(per_branch_timeout_s, 60);
            assert_eq!(elapsed_s, 61);
        }
        other => panic!("wrong error: {other:?}"),
    }
    // Settling an overrun still releases the hold, and says so.
    let s = l.settle_at(&r, 0.10, Outcome::Failed, 61_000).unwrap();
    assert!(s.timed_out);
    assert!(l
        .status_at("run-g", 61_000)
        .unwrap()
        .reservations
        .is_empty());
}

#[test]
fn an_abandoned_reservation_expires_and_is_charged_at_estimate() {
    let dir = TempDir::new().unwrap();
    let l = limiter(&dir, cfg(0.50, 5, 10));
    let _abandoned = l.reserve_at("run-h", 0.30, 0).unwrap(); // never settled

    // Before the deadline the hold still blocks the budget.
    assert!(matches!(
        l.reserve_at("run-h", 0.30, 5_000),
        Err(CapError::SpendCapExceeded { .. })
    ));

    // After it, the hold is charged (not refunded) and dropped.
    let st = l.status_at("run-h", 20_000).unwrap();
    assert_eq!(st.expired, 1);
    assert!((st.committed_usd - 0.30).abs() < 1e-9);
    assert!(st.reservations.is_empty());
    assert!(matches!(
        l.reserve_at("run-h", 0.30, 20_001),
        Err(CapError::SpendCapExceeded { .. })
    ));
    assert!(l.reserve_at("run-h", 0.20, 20_002).is_ok());
}

#[test]
fn an_overrun_actual_cost_tightens_the_remaining_budget() {
    let dir = TempDir::new().unwrap();
    let l = limiter(&dir, cfg(0.50, 5, 60));
    let r = l.reserve_at("run-i", 0.10, 1_000).unwrap();
    let s = l.settle_at(&r, 0.45, Outcome::Completed, 1_100).unwrap();
    assert!(s.overran_estimate);
    assert!((s.remaining_usd - 0.05).abs() < 1e-9);
    assert!(matches!(
        l.reserve_at("run-i", 0.10, 1_200),
        Err(CapError::SpendCapExceeded { .. })
    ));
}

#[test]
fn a_disabled_capability_refuses_every_reservation() {
    let dir = TempDir::new().unwrap();
    let mut c = cfg(0.50, 5, 60);
    c.enabled = false;
    let l = limiter(&dir, c);
    match l.reserve_at("run-j", 0.01, 1_000).unwrap_err() {
        CapError::CapabilityDisabled { skill } => assert_eq!(skill, "tree_search_coder"),
        other => panic!("wrong error: {other:?}"),
    }
}

#[test]
fn negative_and_non_finite_amounts_are_refused() {
    let dir = TempDir::new().unwrap();
    let l = limiter(&dir, cfg(0.50, 5, 60));
    assert!(matches!(
        l.reserve_at("run-k", -1.0, 1_000),
        Err(CapError::InvalidAmount { .. })
    ));
    assert!(matches!(
        l.reserve_at("run-k", f64::NAN, 1_000),
        Err(CapError::InvalidAmount { .. })
    ));
    let r = l.reserve_at("run-k", 0.10, 1_000).unwrap();
    assert!(matches!(
        l.settle_at(&r, f64::INFINITY, Outcome::Completed, 1_100),
        Err(CapError::InvalidAmount { .. })
    ));
}

#[test]
fn runs_are_accounted_independently_and_reset_clears_one() {
    let dir = TempDir::new().unwrap();
    let l = limiter(&dir, cfg(0.50, 5, 60));
    let a = l.reserve_at("run-x", 0.40, 1_000).unwrap();
    let b = l.reserve_at("run-y", 0.40, 1_000).unwrap();
    l.settle_at(&a, 0.40, Outcome::Completed, 1_100).unwrap();
    l.settle_at(&b, 0.40, Outcome::Completed, 1_100).unwrap();

    assert!(matches!(
        l.reserve_at("run-x", 0.20, 1_200),
        Err(CapError::SpendCapExceeded { .. })
    ));
    l.reset("run-x").unwrap();
    assert!(l.reserve_at("run-x", 0.20, 1_300).is_ok());
    // The other run's accounting is untouched.
    assert!(matches!(
        l.reserve_at("run-y", 0.20, 1_300),
        Err(CapError::SpendCapExceeded { .. })
    ));
}

#[test]
fn the_real_manifest_declares_an_enforceable_cap() {
    // Guards against the manifest drifting away from the fields the limiter
    // reads. The Nix package for this crate (lib/agentbox-ops.nix) builds
    // from services/agentbox-ops/ alone — no sibling reassembly — so the
    // repo-root agentbox.toml is not reachable by relative path inside that
    // sandbox. The derivation instead exports AGENTBOX_TOML_PATH pointing at
    // the real file's store path; a plain `cargo test` from a full checkout
    // (no such env var) falls back to the relative path it always used.
    let manifest = match std::env::var_os("AGENTBOX_TOML_PATH") {
        Some(p) => std::path::PathBuf::from(p),
        None => std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../agentbox.toml"),
    };
    let text = std::fs::read_to_string(&manifest)
        .unwrap_or_else(|e| panic!("reading {}: {e}", manifest.display()));
    let c = CapConfig::from_manifest_toml(&text);
    assert!(
        c.spend_cap_usd > 0.0 && c.spend_cap_usd.is_finite(),
        "spend_cap_usd must be a positive, finite number"
    );
    assert!(c.max_candidates > 0);
    assert!(c.per_branch_timeout_s > 0);
    assert!(
        !c.defaulted.contains(&"spend_cap_usd".to_string()),
        "ADR-020 W052: the cap must be declared, not inferred"
    );
}
