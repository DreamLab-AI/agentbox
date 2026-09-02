//! Unit tests for [`super`] — split out to keep `schedule.rs` under the
//! repository's 500-line-per-file limit.

use super::*;
use chrono::Timelike;

fn at(s: &str) -> DateTime<Local> {
    parse_iso(s, Local::now()).expect("test timestamp must parse")
}

#[test]
fn durations_cover_every_documented_unit() {
    assert_eq!(parse_duration("30m").unwrap(), 30);
    assert_eq!(parse_duration("2h").unwrap(), 120);
    assert_eq!(parse_duration("1d").unwrap(), 1440);
    assert_eq!(parse_duration("15 minutes").unwrap(), 15);
    assert_eq!(parse_duration("3 hrs").unwrap(), 180);
    assert_eq!(parse_duration(" 2 DAYS ").unwrap(), 2880);
}

#[test]
fn invalid_durations_are_rejected() {
    assert!(parse_duration("soon").is_err());
    assert!(parse_duration("30").is_err());
    assert!(parse_duration("-5m").is_err());
}

#[test]
fn every_prefix_makes_a_recurring_interval() {
    let s = parse_schedule("every 30m", Local::now()).unwrap();
    assert_eq!(
        s,
        Schedule::Interval {
            minutes: 30,
            display: "every 30m".into()
        }
    );
    assert!(s.is_recurring());
}

#[test]
fn daily_accepts_both_documented_spellings() {
    let now = Local::now();
    let a = parse_schedule("daily at 09:30", now).unwrap();
    let b = parse_schedule("at 9:30", now).unwrap();
    assert_eq!(
        a,
        Schedule::Daily {
            hour: 9,
            minute: 30,
            display: "daily at 09:30".into()
        }
    );
    assert_eq!(a, b, "'at HH:MM' is a synonym for 'daily at HH:MM'");
}

#[test]
fn out_of_range_daily_times_are_rejected() {
    assert!(parse_schedule("daily at 25:00", Local::now()).is_err());
    assert!(parse_schedule("daily at 12:75", Local::now()).is_err());
}

#[test]
fn five_field_cron_is_recognised() {
    let s = parse_schedule("0 9 * * *", Local::now()).unwrap();
    assert_eq!(s.kind(), "cron");
    assert_eq!(s.display(), "0 9 * * *");
}

#[test]
fn malformed_cron_is_rejected_not_silently_accepted() {
    assert!(parse_schedule("99 99 99 99 99", Local::now()).is_err());
}

#[test]
fn iso_timestamps_become_one_shots() {
    let s = parse_schedule("2030-04-07T09:00", Local::now()).unwrap();
    assert_eq!(s.kind(), "once");
    assert_eq!(s.display(), "once at 2030-04-07 09:00");
}

#[test]
fn bare_duration_becomes_a_one_shot_from_now() {
    let now = at("2026-01-01T12:00:00+00:00");
    let s = parse_schedule("30m", now).unwrap();
    assert_eq!(s.display(), "once in 30m");
    let Schedule::Once { run_at, .. } = &s else {
        panic!("expected a one-shot")
    };
    let due = parse_iso(run_at, now).unwrap();
    assert_eq!((due - now).num_minutes(), 30);
}

#[test]
fn nonsense_schedules_produce_the_help_text() {
    let err = parse_schedule("whenever", Local::now()).unwrap_err();
    assert!(err.contains("Invalid schedule 'whenever'"));
    assert!(err.contains("Cron: '0 9 * * *'"));
}

#[test]
fn interval_next_run_chains_off_the_last_run() {
    let now = at("2026-01-01T12:00:00+00:00");
    let s = Schedule::Interval {
        minutes: 30,
        display: "every 30m".into(),
    };
    let last = iso(&at("2026-01-01T11:00:00+00:00"));
    let next = compute_next_run(&s, Some(&last), now).unwrap();
    assert_eq!(
        parse_iso(&next, now).unwrap(),
        at("2026-01-01T11:30:00+00:00")
    );
}

#[test]
fn interval_without_a_last_run_starts_one_period_from_now() {
    let now = at("2026-01-01T12:00:00+00:00");
    let s = Schedule::Interval {
        minutes: 45,
        display: "every 45m".into(),
    };
    let next = compute_next_run(&s, None, now).unwrap();
    assert_eq!(
        parse_iso(&next, now).unwrap(),
        at("2026-01-01T12:45:00+00:00")
    );
}

#[test]
fn a_one_shot_that_already_ran_never_runs_again() {
    let now = at("2026-01-01T12:00:00+00:00");
    let s = Schedule::Once {
        run_at: iso(&now),
        display: "once".into(),
    };
    assert!(compute_next_run(&s, Some("2026-01-01T12:00:00+00:00"), now).is_none());
}

#[test]
fn a_one_shot_inside_the_grace_window_still_runs() {
    let now = at("2026-01-01T12:00:00+00:00");
    let just_missed = iso(&(now - Duration::seconds(ONESHOT_GRACE_SECONDS - 10)));
    let s = Schedule::Once {
        run_at: just_missed.clone(),
        display: "once".into(),
    };
    assert_eq!(compute_next_run(&s, None, now), Some(just_missed));
}

#[test]
fn a_one_shot_past_the_grace_window_is_dropped() {
    let now = at("2026-01-01T12:00:00+00:00");
    let long_gone = iso(&(now - Duration::seconds(ONESHOT_GRACE_SECONDS + 10)));
    let s = Schedule::Once {
        run_at: long_gone,
        display: "once".into(),
    };
    assert!(compute_next_run(&s, None, now).is_none());
}

#[test]
fn daily_rolls_to_tomorrow_once_the_hour_has_passed() {
    let now = at("2026-01-01T12:00:00+00:00");
    let s = Schedule::Daily {
        hour: 9,
        minute: 0,
        display: "daily at 09:00".into(),
    };
    let next = parse_iso(&compute_next_run(&s, None, now).unwrap(), now).unwrap();
    assert_eq!(
        next.day(),
        2,
        "09:00 has passed, so the next run is tomorrow"
    );
    assert_eq!(next.hour(), 9);
}

#[test]
fn daily_stays_today_when_the_hour_is_still_ahead() {
    let now = at("2026-01-01T06:00:00+00:00");
    let s = Schedule::Daily {
        hour: 9,
        minute: 0,
        display: "daily at 09:00".into(),
    };
    let next = parse_iso(&compute_next_run(&s, None, now).unwrap(), now).unwrap();
    assert_eq!(next.day(), 1);
    assert_eq!(next.hour(), 9);
}

#[test]
fn cron_next_run_is_in_the_future() {
    let now = Local::now();
    let s = Schedule::Cron {
        expr: "0 9 * * *".into(),
        display: "0 9 * * *".into(),
    };
    let next = parse_iso(&compute_next_run(&s, None, now).unwrap(), now).unwrap();
    assert!(next > now);
    assert_eq!(next.hour(), 9);
}

#[test]
fn grace_is_half_a_period_within_the_clamp() {
    let now = Local::now();
    // 60m period -> 1800s, inside [120, 7200].
    assert_eq!(
        grace_seconds(
            &Schedule::Interval {
                minutes: 60,
                display: String::new()
            },
            now
        ),
        1800
    );
    // 1m period -> 30s, clamped up to the 120s floor.
    assert_eq!(
        grace_seconds(
            &Schedule::Interval {
                minutes: 1,
                display: String::new()
            },
            now
        ),
        MIN_GRACE
    );
    // 24h period -> 43200s, clamped down to the 7200s ceiling.
    assert_eq!(
        grace_seconds(
            &Schedule::Interval {
                minutes: 1440,
                display: String::new()
            },
            now
        ),
        MAX_GRACE
    );
    assert_eq!(
        grace_seconds(
            &Schedule::Daily {
                hour: 9,
                minute: 0,
                display: String::new()
            },
            now
        ),
        MAX_GRACE
    );
}

#[test]
fn schedule_json_matches_the_python_shape() {
    let s = Schedule::Interval {
        minutes: 30,
        display: "every 30m".into(),
    };
    let json = serde_json::to_string(&s).unwrap();
    assert_eq!(
        json,
        r#"{"kind":"interval","minutes":30,"display":"every 30m"}"#
    );
}

#[test]
fn schedule_json_round_trips_every_kind() {
    for s in [
        Schedule::Interval {
            minutes: 30,
            display: "every 30m".into(),
        },
        Schedule::Daily {
            hour: 9,
            minute: 5,
            display: "daily at 09:05".into(),
        },
        Schedule::Cron {
            expr: "0 9 * * *".into(),
            display: "0 9 * * *".into(),
        },
        Schedule::Once {
            run_at: "2030-01-01T00:00:00+00:00".into(),
            display: "once".into(),
        },
    ] {
        let text = serde_json::to_string(&s).unwrap();
        let back: Schedule = serde_json::from_str(&text).unwrap();
        assert_eq!(s, back);
    }
}

#[test]
fn iso_round_trips_through_the_parser() {
    let now = Local::now();
    let text = iso(&now);
    let back = parse_iso(&text, now).unwrap();
    assert_eq!(back.timestamp_micros(), now.timestamp_micros());
}
