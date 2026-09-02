//! Unit tests for [`super`] — split out to keep `jobs.rs` under the
//! repository's 500-line-per-file limit.

use super::*;
use chrono::Duration;

fn now() -> DateTime<Local> {
    Local::now()
}

fn interval_job(minutes: i64) -> Job {
    new_job(
        "do the thing",
        Schedule::Interval {
            minutes,
            display: format!("every {minutes}m"),
        },
        None,
        None,
        None,
        now(),
    )
}

#[test]
fn a_new_job_is_enabled_and_scheduled() {
    let job = interval_job(30);
    assert!(job.enabled);
    assert_eq!(job.state, "scheduled");
    assert_eq!(job.id.len(), 12);
    assert!(job.next_run_at.is_some());
    assert_eq!(
        job.repeat,
        Repeat {
            times: None,
            completed: 0
        }
    );
}

#[test]
fn the_name_defaults_to_the_truncated_prompt() {
    let long = "x".repeat(80);
    let job = new_job(
        &long,
        Schedule::Interval {
            minutes: 5,
            display: String::new(),
        },
        None,
        None,
        None,
        now(),
    );
    assert_eq!(job.name.len(), 50);
}

#[test]
fn a_one_shot_defaults_to_a_single_repeat() {
    let job = new_job(
        "once please",
        Schedule::Once {
            run_at: iso(&(now() + Duration::minutes(5))),
            display: "once".into(),
        },
        None,
        None,
        None,
        now(),
    );
    assert_eq!(job.repeat.times, Some(1));
}

#[test]
fn a_non_positive_repeat_means_forever() {
    let job = new_job(
        "x",
        Schedule::Interval {
            minutes: 5,
            display: String::new(),
        },
        None,
        Some(0),
        None,
        now(),
    );
    assert_eq!(job.repeat.times, None);
}

#[test]
fn store_round_trips_through_disk() {
    let tmp = tempfile::tempdir().unwrap();
    let store = Store::new(tmp.path());
    let jobs = vec![interval_job(30)];
    store.save(&jobs, now()).unwrap();
    assert_eq!(store.load(), jobs);
}

#[test]
fn loading_a_missing_file_yields_no_jobs() {
    let tmp = tempfile::tempdir().unwrap();
    assert!(Store::new(tmp.path()).load().is_empty());
}

#[test]
fn loading_a_corrupt_file_yields_no_jobs_rather_than_failing() {
    let tmp = tempfile::tempdir().unwrap();
    let store = Store::new(tmp.path());
    store.ensure_dirs().unwrap();
    fs::write(store.jobs_file(), "{not json").unwrap();
    assert!(store.load().is_empty());
}

#[test]
fn a_python_written_jobs_file_still_loads() {
    let tmp = tempfile::tempdir().unwrap();
    let store = Store::new(tmp.path());
    store.ensure_dirs().unwrap();
    // Exactly the shape scheduler.py wrote.
    fs::write(
        store.jobs_file(),
        r#"{"jobs": [{"id": "abc123def456", "name": "nightly", "prompt": "run it",
          "schedule": {"kind": "interval", "minutes": 60, "display": "every 60m"},
          "schedule_display": "every 60m", "repeat": {"times": null, "completed": 3},
          "enabled": true, "state": "scheduled", "workdir": null,
          "created_at": "2026-07-07T09:00:00+01:00", "next_run_at": "2026-07-07T10:00:00+01:00",
          "last_run_at": null, "last_status": null, "last_error": null}],
          "updated_at": "2026-07-07T09:00:00+01:00"}"#,
    )
    .unwrap();
    let jobs = store.load();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].id, "abc123def456");
    assert_eq!(jobs[0].repeat.completed, 3);
    assert_eq!(jobs[0].schedule.kind(), "interval");
}

#[test]
fn output_files_are_timestamped_per_job() {
    let tmp = tempfile::tempdir().unwrap();
    let store = Store::new(tmp.path());
    let path = store.save_output("job1", "# result\n", now()).unwrap();
    assert!(path.starts_with(store.output_dir().join("job1")));
    assert_eq!(fs::read_to_string(&path).unwrap(), "# result\n");
}

#[test]
fn a_disabled_job_is_never_due() {
    let mut jobs = vec![interval_job(30)];
    jobs[0].enabled = false;
    jobs[0].next_run_at = Some(iso(&(now() - Duration::minutes(1))));
    assert!(scan_due(&mut jobs, now()).due.is_empty());
}

#[test]
fn a_future_job_is_not_due() {
    let mut jobs = vec![interval_job(30)];
    jobs[0].next_run_at = Some(iso(&(now() + Duration::minutes(10))));
    assert!(scan_due(&mut jobs, now()).due.is_empty());
}

#[test]
fn a_just_due_job_is_returned() {
    let mut jobs = vec![interval_job(30)];
    jobs[0].next_run_at = Some(iso(&(now() - chrono::Duration::seconds(5))));
    let scan = scan_due(&mut jobs, now());
    assert_eq!(scan.due.len(), 1);
    assert!(!scan.dirty);
}

#[test]
fn a_badly_stale_recurring_job_fast_forwards_instead_of_running() {
    let mut jobs = vec![interval_job(30)];
    // 30m interval -> 900s grace; miss it by two hours.
    jobs[0].next_run_at = Some(iso(&(now() - Duration::hours(2))));
    let scan = scan_due(&mut jobs, now());
    assert!(scan.due.is_empty(), "a stampede must not be replayed");
    assert!(scan.dirty);
    assert_eq!(scan.fast_forwarded.len(), 1);
    assert!(parse_iso(jobs[0].next_run_at.as_ref().unwrap(), now()).unwrap() > now());
}

#[test]
fn a_stale_one_shot_is_not_fast_forwarded() {
    let run_at = iso(&(now() - Duration::hours(2)));
    let mut jobs = vec![new_job(
        "x",
        Schedule::Once {
            run_at: run_at.clone(),
            display: "once".into(),
        },
        None,
        None,
        None,
        now(),
    )];
    jobs[0].next_run_at = Some(run_at);
    let scan = scan_due(&mut jobs, now());
    assert_eq!(
        scan.due.len(),
        1,
        "one-shots run late rather than being skipped"
    );
    assert!(scan.fast_forwarded.is_empty());
}

#[test]
fn advance_moves_a_recurring_job_but_not_a_one_shot() {
    let mut jobs = vec![interval_job(30)];
    let before = jobs[0].next_run_at.clone();
    let id = jobs[0].id.clone();
    assert!(advance_next_run(
        &mut jobs,
        &id,
        now() + Duration::minutes(1)
    ));
    assert_ne!(jobs[0].next_run_at, before);

    let mut once = vec![new_job(
        "x",
        Schedule::Once {
            run_at: iso(&now()),
            display: "once".into(),
        },
        None,
        None,
        None,
        now(),
    )];
    let once_id = once[0].id.clone();
    assert!(!advance_next_run(&mut once, &once_id, now()));
}

#[test]
fn a_successful_run_clears_the_last_error() {
    let mut jobs = vec![interval_job(30)];
    jobs[0].last_error = Some("boom".into());
    let id = jobs[0].id.clone();
    assert!(!mark_run(&mut jobs, &id, true, None, now()));
    assert_eq!(jobs[0].last_status.as_deref(), Some("ok"));
    assert_eq!(jobs[0].last_error, None);
    assert_eq!(jobs[0].repeat.completed, 1);
}

#[test]
fn a_failed_run_records_the_error() {
    let mut jobs = vec![interval_job(30)];
    let id = jobs[0].id.clone();
    mark_run(&mut jobs, &id, false, Some("exit 1"), now());
    assert_eq!(jobs[0].last_status.as_deref(), Some("error"));
    assert_eq!(jobs[0].last_error.as_deref(), Some("exit 1"));
}

#[test]
fn a_job_is_removed_once_its_repeat_count_is_exhausted() {
    let mut jobs = vec![new_job(
        "twice",
        Schedule::Interval {
            minutes: 5,
            display: String::new(),
        },
        None,
        Some(2),
        None,
        now(),
    )];
    let id = jobs[0].id.clone();
    assert!(!mark_run(&mut jobs, &id, true, None, now()));
    assert_eq!(jobs.len(), 1);
    assert!(mark_run(&mut jobs, &id, true, None, now()));
    assert!(jobs.is_empty(), "the second of two runs retires the job");
}

#[test]
fn a_completed_one_shot_is_disabled_when_it_is_not_removed() {
    let mut jobs = vec![new_job(
        "x",
        Schedule::Once {
            run_at: iso(&now()),
            display: "once".into(),
        },
        None,
        None,
        None,
        now(),
    )];
    // Repeat forever, so the removal branch does not fire.
    jobs[0].repeat.times = None;
    let id = jobs[0].id.clone();
    mark_run(&mut jobs, &id, true, None, now());
    assert!(!jobs[0].enabled);
    assert_eq!(jobs[0].state, "completed");
}

#[test]
fn pause_and_resume_flip_enabled_and_state() {
    let mut jobs = vec![interval_job(30)];
    let id = jobs[0].id.clone();
    assert!(pause(&mut jobs, &id, now()));
    assert!(!jobs[0].enabled);
    assert_eq!(jobs[0].state, "paused");
    assert!(jobs[0].paused_at.is_some());

    assert!(resume(&mut jobs, &id, now()));
    assert!(jobs[0].enabled);
    assert_eq!(jobs[0].state, "scheduled");
    assert_eq!(jobs[0].paused_at, None);
}

#[test]
fn trigger_makes_a_job_due_immediately() {
    let mut jobs = vec![interval_job(30)];
    let id = jobs[0].id.clone();
    assert!(trigger(&mut jobs, &id, now()));
    assert_eq!(
        scan_due(&mut jobs, now() + Duration::seconds(1)).due.len(),
        1
    );
}

#[test]
fn operations_on_an_unknown_id_report_failure() {
    let mut jobs = vec![interval_job(30)];
    assert!(!remove(&mut jobs, "nope"));
    assert!(!pause(&mut jobs, "nope", now()));
    assert!(!resume(&mut jobs, "nope", now()));
    assert!(!trigger(&mut jobs, "nope", now()));
    assert!(!mark_run(&mut jobs, "nope", true, None, now()));
}

#[test]
fn remove_deletes_the_named_job_only() {
    let mut jobs = vec![interval_job(30), interval_job(60)];
    let id = jobs[0].id.clone();
    assert!(remove(&mut jobs, &id));
    assert_eq!(jobs.len(), 1);
}

#[test]
fn unknown_fields_survive_a_load_save_cycle() {
    let tmp = tempfile::tempdir().unwrap();
    let store = Store::new(tmp.path());
    store.ensure_dirs().unwrap();
    fs::write(
        store.jobs_file(),
        r#"{"jobs": [{"id": "abc123def456", "name": "n", "prompt": "p",
          "schedule": {"kind": "interval", "minutes": 60, "display": "every 60m"},
          "schedule_display": "every 60m", "repeat": {"times": null, "completed": 0},
          "enabled": true, "state": "scheduled", "workdir": null,
          "created_at": "t", "next_run_at": null, "last_run_at": null,
          "last_status": null, "last_error": null, "future_field": 42}]}"#,
    )
    .unwrap();
    let jobs = store.load();
    assert_eq!(
        jobs[0].extra.get("future_field"),
        Some(&serde_json::json!(42))
    );
    store.save(&jobs, now()).unwrap();
    assert_eq!(
        store.load()[0].extra.get("future_field"),
        Some(&serde_json::json!(42))
    );
}
