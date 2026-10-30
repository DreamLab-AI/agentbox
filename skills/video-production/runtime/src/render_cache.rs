//! Assemble a complete native render cache after a verified scoped scene edit.
//!
//! The scene tool that made the edit proves *what* changed; this consumer
//! verifies the lineage and every selected PNG before copying. The expected
//! scope is an input (`--allow START..END`, half-open, repeatable), not a
//! constant: the revision may only change frames inside the allowed intervals.
//! `--allow-from-diff DIFF_JSON` adds the `invalidated_intervals` of a
//! `window-plan diff` report to the same scope. Frame count and frame rate come
//! from the parent receipt.
//!
//! A revision report must carry `schema: "render-revision/2"` and:
//! `source_unchanged`, `scope_unchanged` (both `true`), `source_world_sha256`,
//! `world_sha256`, `frames` (count), `scoped_world_hashes` (one per frame) and
//! `changed_frames` (indices that were re-rendered).
use crate::{
    clock::{FrameInterval, rate_from_receipt},
    comfy::sha256_hex,
    paths::{Root, take_root_option},
    windows::{self, Plan},
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    error::Error,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn read(path: &Path) -> Result<Value> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn sha(path: &Path) -> Result<String> {
    Ok(sha256_hex(&fs::read(path)?))
}

fn frames(value: &Value) -> Result<BTreeMap<u64, String>> {
    let mut result = BTreeMap::new();
    for row in value["frames"].as_array().ok_or("missing frames")? {
        let frame = row["frame"].as_u64().ok_or("missing frame index")?;
        let hash = row["sha256"]
            .as_str()
            .ok_or("missing frame hash")?
            .to_string();
        if result.insert(frame, hash).is_some() {
            return Err("invalid or duplicate frame".into());
        }
    }
    Ok(result)
}

/// Parse `START..END` (half-open) into a [`FrameInterval`].
///
/// ```
/// use video_production_runtime::render_cache::parse_allow;
/// assert_eq!(parse_allow("10..20").unwrap().len(), 10);
/// assert!(parse_allow("20..10").is_err());
/// ```
pub fn parse_allow(text: &str) -> Result<FrameInterval> {
    let (start, end) = text.split_once("..").ok_or("--allow expects START..END")?;
    Ok(FrameInterval::new(
        start.trim().parse()?,
        end.trim().parse()?,
    )?)
}

/// Read the allowed scope from a `window-diff/1` report (see
/// [`crate::windows::diff`]): its `invalidated_intervals`, in delivery frames.
///
/// ```
/// use video_production_runtime::render_cache::allowed_from_diff;
/// let diff = serde_json::json!({"schema":"window-diff/1","invalidated_intervals":[[90,121]]});
/// assert_eq!(allowed_from_diff(&diff).unwrap()[0].len(), 31);
/// assert!(allowed_from_diff(&serde_json::json!({"schema":"other"})).is_err());
/// ```
pub fn allowed_from_diff(diff: &Value) -> Result<Vec<FrameInterval>> {
    if diff["schema"] != "window-diff/1" {
        return Err("--allow-from-diff expects a window-diff/1 report".into());
    }
    diff["invalidated_intervals"]
        .as_array()
        .ok_or("diff has no invalidated_intervals")?
        .iter()
        .map(|pair| {
            let pair: [u64; 2] = serde_json::from_value(pair.clone())?;
            Ok(FrameInterval::try_from(pair)?)
        })
        .collect()
}

/// Refuse a window diff planned for a different delivery length than the
/// parent cache, so a stale plan cannot scope a revision of another cut.
pub fn diff_matches_parent(diff: &Value, parent_frames: u64) -> Result<()> {
    let planned = diff["delivery_frames"]
        .as_u64()
        .ok_or("window diff has no delivery_frames")?;
    if planned != parent_frames {
        return Err(format!(
            "window diff plans {planned} delivery frames but the parent cache has {parent_frames}"
        )
        .into());
    }
    Ok(())
}

fn text<'a>(value: &'a Value, key: &str, what: &str) -> Result<&'a str> {
    value[key]
        .as_str()
        .ok_or_else(|| format!("{what} has no {key}").into())
}

/// Require the diff to describe the parent cache's own plan.
///
/// Frame count alone cannot tell two cuts of the same length apart. The diff
/// must name the plan it was computed from (`old_plan_hash`, geometry, and
/// `old_final_key`, which chains the input, prompt, settings, model and seeds),
/// and the parent receipt must have recorded the same `plan_hash` and
/// `plan_final_key` (see `--plan`). A parent that recorded none is refused.
pub fn diff_binds_parent(diff: &Value, parent: &Value) -> Result<()> {
    for (diff_key, parent_key) in [
        ("old_plan_hash", "plan_hash"),
        ("old_final_key", "plan_final_key"),
    ] {
        let wanted = text(diff, diff_key, "window diff")?;
        let recorded = text(parent, parent_key, "parent cache receipt").map_err(|_| {
            format!("parent cache receipt records no {parent_key}; re-run it with --plan PLAN_JSON")
        })?;
        if wanted != recorded {
            return Err(format!(
                "window diff was computed from a different plan than the parent cache ({parent_key} {recorded} != {wanted})"
            )
            .into());
        }
    }
    Ok(())
}

/// Recompute the diff of `old` against `new` and require the supplied report to
/// agree on its identity and scope, so a hand-edited report is refused.
pub fn diff_matches_plans(diff: &Value, old: &Plan, new: &Plan, root: &Root) -> Result<()> {
    let fresh = windows::diff_in(old, new, Some(root))?;
    for key in [
        "schema",
        "old_plan_hash",
        "new_plan_hash",
        "old_final_key",
        "new_final_key",
        "delivery_frames",
        "invalidated_intervals",
    ] {
        if diff[key] != fresh[key] {
            return Err(format!("window diff {key} does not match the supplied plans").into());
        }
    }
    Ok(())
}

fn take_path(args: &mut Vec<OsString>, name: &str, root: &Root) -> Result<Option<PathBuf>> {
    let Some(i) = args.iter().position(|a| a == name) else {
        return Ok(None);
    };
    if i + 1 >= args.len() {
        return Err(format!("{name} needs a path").into());
    }
    let path = root.resolve(Path::new(&args.remove(i + 1)))?;
    args.remove(i);
    Ok(Some(path))
}

/// Load the *new* (current) plan: structure, hash, and every model file that
/// is present under `root` must match what the plan records.
fn load_new_plan(path: &Path, root: &Root) -> Result<Plan> {
    let plan: Plan = read_as(path)?;
    plan.verify_in(Some(root))?;
    Ok(plan)
}

/// Load the *old* plan: structure and hash only. Its weights are typically
/// gone or overwritten (that is what an in-place model update is), so they are
/// deliberately not compared with the disk.
fn load_old_plan(path: &Path) -> Result<Plan> {
    let plan: Plan = read_as(path)?;
    plan.verify()?;
    Ok(plan)
}

fn read_as<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

/// Check the revision against both receipts and the allowed scope, returning
/// the set of frames that must come from the patch render.
pub fn validate_revision(
    parent: &Value,
    patch: &Value,
    revision: &Value,
    world_hash: &str,
    allowed: &[FrameInterval],
) -> Result<BTreeSet<u64>> {
    if allowed.is_empty() {
        return Err("an expected scope is required: pass --allow START..END".into());
    }
    let parent_frames = frames(parent)?;
    let count = parent_frames.len() as u64;
    if count == 0 || parent_frames.keys().copied().ne(0..count) {
        return Err("parent frames must be a complete 0..N sequence".into());
    }
    if revision["schema"] != "render-revision/2"
        || revision["source_unchanged"] != true
        || revision["scope_unchanged"] != true
        || revision["frames"] != count
        || revision["scoped_world_hashes"].as_array().map(Vec::len) != Some(count as usize)
    {
        return Err("revision does not establish complete unchanged scoped world state".into());
    }
    if revision["source_world_sha256"] != parent["source_scene_sha256"]
        || revision["world_sha256"] != world_hash
        || patch["source_scene_sha256"] != world_hash
    {
        return Err("stale source world or revision lineage".into());
    }
    let parent_rate = rate_from_receipt(parent).ok_or("parent receipt has no frame rate")?;
    let patch_rate = rate_from_receipt(patch).ok_or("patch receipt has no frame rate")?;
    if parent_rate != patch_rate
        || parent["resolution"] != patch["resolution"]
        || parent["delivery_complete"] != true
    {
        return Err("render timing, canvas or parent coverage differs".into());
    }
    let changed: BTreeSet<u64> = revision["changed_frames"]
        .as_array()
        .ok_or("missing change interval")?
        .iter()
        .map(|value| value.as_u64().ok_or("bad change index"))
        .collect::<std::result::Result<_, _>>()?;
    if changed.is_empty()
        || changed
            .iter()
            .any(|&f| !allowed.iter().any(|a| a.contains(f)))
    {
        return Err("revision exceeds the allowed scope".into());
    }
    if changed.iter().any(|&f| f >= count) {
        return Err("changed frame outside the film".into());
    }
    let patch_frames = frames(patch)?;
    if changed != patch_frames.keys().copied().collect() {
        return Err("parent or changed-frame coverage differs".into());
    }
    Ok(changed)
}

/// Validate and assemble a new complete cache. Arguments are described in the
/// module documentation.
pub fn run(mut args: Vec<OsString>) -> Result<()> {
    let root = Root::new(&take_root_option(&mut args)?)?;
    // A bound diff is the whole scope; manual ranges added to it would widen it unchecked.
    if args.iter().any(|a| a == "--allow") && args.iter().any(|a| a == "--allow-from-diff") {
        return Err("use --allow or --allow-from-diff, not both".into());
    }
    let mut allowed = Vec::new();
    let mut diffs = Vec::new();
    while let Some(i) = args.iter().position(|a| a == "--allow") {
        if i + 1 >= args.len() {
            return Err("--allow needs START..END".into());
        }
        let text = args.remove(i + 1);
        args.remove(i);
        allowed.push(parse_allow(text.to_str().ok_or("--allow must be UTF-8")?)?);
    }
    while let Some(i) = args.iter().position(|a| a == "--allow-from-diff") {
        if i + 1 >= args.len() {
            return Err("--allow-from-diff needs a window-diff JSON".into());
        }
        let path = root.resolve(Path::new(&args.remove(i + 1)))?;
        args.remove(i);
        let diff = read(&path)?;
        allowed.extend(allowed_from_diff(&diff)?);
        diffs.push((path, diff));
    }
    let plan_path = take_path(&mut args, "--plan", &root)?;
    let old_plan_path = take_path(&mut args, "--old-plan", &root)?;
    let new_plan_path = take_path(&mut args, "--new-plan", &root)?;
    if old_plan_path.is_some() != new_plan_path.is_some() {
        return Err("--old-plan and --new-plan must be given together".into());
    }
    if !diffs.is_empty() && old_plan_path.is_none() {
        return Err(
            "--allow-from-diff needs --old-plan and --new-plan, so the diff is reproduced rather than trusted"
                .into(),
        );
    }
    if args.len() != 5 {
        return Err("usage: render-cache [--root DIR] (--allow START..END | --allow-from-diff DIFF_JSON --old-plan PLAN --new-plan PLAN) [--plan PLAN_JSON] PARENT_DIR REVISION_JSON PATCH_DIR WORLD NEW_DIR".into());
    }
    let at = |i: usize| root.resolve(Path::new(&args[i]));
    let (parent_dir, revision_path, patch_dir, world, output) =
        (at(0)?, at(1)?, at(2)?, at(3)?, at(4)?);
    if output.exists() {
        return Err("output must be new".into());
    }
    let parent = read(&parent_dir.join("complete.json"))?;
    let patch = read(&patch_dir.join("complete.json"))?;
    let revision = read(&revision_path)?;
    let world_hash = sha(&world)?;
    let changed = validate_revision(&parent, &patch, &revision, &world_hash, &allowed)?;
    let parent_frames = frames(&parent)?;
    let patch_frames = frames(&patch)?;
    let count = parent_frames.len() as u64;
    let mut window_diffs = Vec::new();
    let supplied = match (&old_plan_path, &new_plan_path) {
        (Some(o), Some(n)) => Some((load_old_plan(o)?, load_new_plan(n, &root)?)),
        _ => None,
    };
    let mut recorded_plan: Option<(String, String)> = None;
    for (path, diff) in &diffs {
        diff_matches_parent(diff, count)?;
        diff_binds_parent(diff, &parent)?;
        if let Some((old, new)) = &supplied {
            diff_matches_plans(diff, old, new, &root)?;
        }
        let next = (
            text(diff, "new_plan_hash", "window diff")?.to_owned(),
            text(diff, "new_final_key", "window diff")?.to_owned(),
        );
        if recorded_plan.get_or_insert_with(|| next.clone()) != &next {
            return Err("window diffs lead to different plans".into());
        }
        window_diffs.push(json!({"path":root.rel(path)?,"sha256":sha(path)?}));
    }
    let mut plan_record = Value::Null;
    if let Some(path) = &plan_path {
        let plan = load_new_plan(path, &root)?;
        if recorded_plan
            .as_ref()
            .is_some_and(|r| *r != (plan.plan_hash.clone(), plan.final_key.clone()))
        {
            return Err("--plan is not the plan the window diff leads to".into());
        }
        if plan.request.total_frames != count {
            return Err("--plan delivery length differs from the parent cache".into());
        }
        recorded_plan = Some((plan.plan_hash, plan.final_key));
        plan_record = json!({"path":root.rel(path)?,"sha256":sha(path)?});
    }
    let mut selected: Vec<(u64, PathBuf, String, &str)> = Vec::new();
    for frame in 0..count {
        let (directory, hashes, origin) = if changed.contains(&frame) {
            (&patch_dir, &patch_frames, "rerendered scoped revision")
        } else {
            (&parent_dir, &parent_frames, "reused unchanged camera/world")
        };
        let file = directory.join(format!("frame-{frame:04}.png"));
        let expected = hashes.get(&frame).ok_or("missing selected frame")?;
        if sha(&file)? != *expected {
            return Err(format!("stale PNG {}", file.display()).into());
        }
        selected.push((frame, file, expected.clone(), origin));
    }
    fs::create_dir(&output)?;
    let mut records = Vec::new();
    for (frame, source, hash, origin) in selected {
        let name = format!("frame-{frame:04}.png");
        fs::copy(source, output.join(&name))?;
        if sha(&output.join(&name))? != hash {
            return Err("copied PNG hash mismatch".into());
        }
        records.push(json!({"frame":frame,"path":name,"sha256":hash,"origin":origin}));
    }
    let receipt_of = |dir: &Path| -> Result<Value> {
        let path = dir.join("complete.json");
        Ok(json!({"path":root.rel(&path)?,"sha256":sha(&path)?}))
    };
    let mut report = json!({"source_scene":root.rel(&world)?,"source_scene_sha256":world_hash,"scene_sha256":world_hash,
        "rate":rate_from_receipt(&parent),"resolution":parent["resolution"],"frames":records,"delivery_complete":true,
        "scoped_revision":{"path":root.rel(&revision_path)?,"sha256":sha(&revision_path)?},
        "parent_receipt":receipt_of(&parent_dir)?,"patch_receipt":receipt_of(&patch_dir)?,
        "allowed_scope":allowed,"window_diffs":window_diffs,
        "plan_hash":recorded_plan.as_ref().map(|r| &r.0),"plan_final_key":recorded_plan.as_ref().map(|r| &r.1),
        "plan":plan_record,
        "reused_frames":count-changed.len() as u64,"rerendered_frames":changed.len(),"production_accepted":false,
        "scope":"Verified PNG cache lineage after a scoped revision; native scene-state proof comes from the separately hashed scene verifier. No generated-video or physical acceptance."});
    root.relativise(&mut report)?;
    fs::write(
        output.join("complete.json"),
        format!("{}\n", serde_json::to_string_pretty(&report)?),
    )?;
    println!(
        "verified {count} frames: {} reused, {} rerendered",
        count - changed.len() as u64,
        changed.len()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::absolute_paths;

    fn receipt(world: &str, hashes: &[(u64, String)]) -> Value {
        json!({"source_scene_sha256":world,"fps":{"num":24000,"den":1001},"resolution":[16,9],
            "delivery_complete":true,
            "frames":hashes.iter().map(|(f,h)| json!({"frame":f,"sha256":h})).collect::<Vec<_>>()})
    }

    fn fixture() -> (Value, Value, Value, String) {
        let parent_hashes: Vec<_> = (0..10u64).map(|f| (f, format!("p{f}"))).collect();
        let patch_hashes: Vec<_> = (3..5u64).map(|f| (f, format!("n{f}"))).collect();
        let revision = json!({"schema":"render-revision/2","source_unchanged":true,"scope_unchanged":true,
            "source_world_sha256":"old","world_sha256":"new","frames":10,
            "scoped_world_hashes":vec!["h";10],"changed_frames":[3,4]});
        (
            receipt("old", &parent_hashes),
            receipt("new", &patch_hashes),
            revision,
            "new".into(),
        )
    }

    #[test]
    fn accepts_an_in_scope_revision_at_a_fractional_rate() {
        let (parent, patch, revision, world) = fixture();
        let allowed = [FrameInterval::new(3, 5).unwrap()];
        let changed = validate_revision(&parent, &patch, &revision, &world, &allowed).unwrap();
        assert_eq!(changed, BTreeSet::from([3, 4]));
    }

    #[test]
    fn a_window_diff_must_describe_the_parent_frame_count() {
        let diff =
            json!({"schema":"window-diff/1","delivery_frames":10,"invalidated_intervals":[[3,5]]});
        assert!(diff_matches_parent(&diff, 10).is_ok());
        let err = diff_matches_parent(&diff, 12).unwrap_err().to_string();
        assert!(err.contains("10") && err.contains("12"), "{err}");
        let missing = json!({"schema":"window-diff/1","invalidated_intervals":[[3,5]]});
        assert!(diff_matches_parent(&missing, 10).is_err());
    }

    #[test]
    fn a_window_diff_report_serves_as_the_allowed_scope() {
        let (parent, patch, revision, world) = fixture();
        let diff = json!({"schema":"window-diff/1","invalidated_intervals":[[3,5]]});
        let allowed = allowed_from_diff(&diff).unwrap();
        let changed = validate_revision(&parent, &patch, &revision, &world, &allowed).unwrap();
        assert_eq!(changed, BTreeSet::from([3, 4]));
        let narrow = json!({"schema":"window-diff/1","invalidated_intervals":[[3,4]]});
        let allowed = allowed_from_diff(&narrow).unwrap();
        assert!(validate_revision(&parent, &patch, &revision, &world, &allowed).is_err());
        let empty = json!({"schema":"window-diff/1","invalidated_intervals":[]});
        assert!(allowed_from_diff(&empty).unwrap().is_empty());
        assert!(allowed_from_diff(&json!({"schema":"x","invalidated_intervals":[]})).is_err());
        assert!(
            allowed_from_diff(&json!({"schema":"window-diff/1","invalidated_intervals":[[5,3]]}))
                .is_err()
        );
    }

    #[test]
    fn rejects_out_of_scope_missing_scope_stale_and_mismatched_inputs() {
        let (parent, patch, revision, world) = fixture();
        let ok = [FrameInterval::new(3, 5).unwrap()];
        let narrow = [FrameInterval::new(3, 4).unwrap()];
        let err =
            |parent: &Value, patch: &Value, revision: &Value, world: &str, a: &[FrameInterval]| {
                validate_revision(parent, patch, revision, world, a)
                    .unwrap_err()
                    .to_string()
            };
        assert!(err(&parent, &patch, &revision, &world, &narrow).contains("allowed scope"));
        assert!(err(&parent, &patch, &revision, &world, &[]).contains("--allow"));
        assert!(err(&parent, &patch, &revision, "other", &ok).contains("stale"));
        let mut wrong_frames = revision.clone();
        wrong_frames["frames"] = json!(11);
        assert!(err(&parent, &patch, &wrong_frames, &world, &ok).contains("unchanged scoped"));
        let mut wrong_schema = revision.clone();
        wrong_schema["schema"] = json!("render-revision/1");
        assert!(err(&parent, &patch, &wrong_schema, &world, &ok).contains("unchanged scoped"));
        let mut other_rate = patch.clone();
        other_rate["fps"] = json!(25);
        assert!(err(&parent, &other_rate, &revision, &world, &ok).contains("timing"));
        let mut other_patch = patch.clone();
        other_patch["frames"] = json!([{"frame":3,"sha256":"n3"}]);
        assert!(err(&parent, &other_patch, &revision, &world, &ok).contains("coverage"));
    }

    fn plan_for(input: char, reroll: Option<(u64, u64)>) -> crate::windows::Plan {
        use crate::windows::{Hashes, ModelFile, Profile, Request, build};
        let h = |c: char| c.to_string().repeat(64);
        build(&Request {
            profile: Profile::ltx(),
            total_frames: 20,
            max_window: 9,
            history_len: 1,
            master_seed: 3,
            seed_overrides: reroll.into_iter().collect(),
            hashes: Hashes {
                input_sha256: h(input),
                prompt_sha256: h('2'),
                settings_sha256: h('3'),
                models: vec![ModelFile {
                    path: "m.safetensors".into(),
                    sha256: h('a'),
                    verified: false,
                }],
            },
        })
        .unwrap()
    }

    #[test]
    fn a_diff_binds_to_the_parent_by_plan_hash_and_final_key_not_by_length() {
        use crate::windows::diff;
        let (a, a2) = (plan_for('1', None), plan_for('1', Some((2, 77))));
        let parent = json!({"plan_hash":a.plan_hash,"plan_final_key":a.final_key});
        let good = diff(&a, &a2).unwrap();
        assert_eq!(good["delivery_frames"], 20);
        assert!(diff_binds_parent(&good, &parent).is_ok());
        // A parent that never recorded its plan cannot be bound.
        let err = diff_binds_parent(&good, &json!({}))
            .unwrap_err()
            .to_string();
        assert!(err.contains("plan_hash"), "{err}");
        // Same length, same geometry, different input cut: plan_hash alone cannot tell, the key does.
        let (b, b2) = (plan_for('9', None), plan_for('9', Some((2, 77))));
        assert_eq!(a.plan_hash, b.plan_hash);
        let other = diff(&b, &b2).unwrap();
        diff_matches_parent(&other, 20).unwrap();
        let err = diff_binds_parent(&other, &parent).unwrap_err().to_string();
        assert!(err.contains("plan_final_key"), "{err}");
        // Different geometry of the same length is refused on the hash.
        let mut geometry = plan_for('1', None).request;
        geometry.max_window = 17;
        let c = crate::windows::build(&geometry).unwrap();
        assert_ne!(c.plan_hash, a.plan_hash);
        let err = diff_binds_parent(&diff(&c, &c).unwrap(), &parent).unwrap_err();
        assert!(err.to_string().contains("plan_hash"), "{err}");
    }

    #[test]
    fn a_hand_edited_diff_is_refused_when_the_plans_are_supplied() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("vpr-cache-diff-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let root = Root::new(&dir).unwrap();
        let (a, a2) = (plan_for('1', None), plan_for('1', Some((2, 77))));
        let good = crate::windows::diff(&a, &a2).unwrap();
        assert_eq!(good["invalidated_intervals"], json!([[17, 20]]));
        assert!(diff_matches_plans(&good, &a, &a2, &root).is_ok());
        let mut widened = good.clone();
        widened["invalidated_intervals"] = json!([[0, 20]]);
        let err = diff_matches_plans(&widened, &a, &a2, &root)
            .unwrap_err()
            .to_string();
        assert!(err.contains("invalidated_intervals"), "{err}");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn manual_allow_ranges_cannot_widen_a_bound_diff() {
        let args: Vec<OsString> = [
            "--allow",
            "0..2",
            "--allow-from-diff",
            "missing.json",
            "p",
            "n",
        ]
        .iter()
        .map(OsString::from)
        .collect();
        let err = run(args).unwrap_err().to_string();
        assert!(err.contains("not both"), "{err}");
    }

    #[test]
    fn allow_from_diff_end_to_end_binds_the_parent_and_chains_the_new_cache() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("vpr-cache-e2e-{}-{nonce}", std::process::id()));
        for sub in ["parent", "patch"] {
            fs::create_dir_all(dir.join(sub)).unwrap();
        }
        let write = |sub: &str, frame: u64, text: &str| {
            let path = dir.join(sub).join(format!("frame-{frame:04}.png"));
            fs::write(&path, text).unwrap();
            sha(&path).unwrap()
        };
        fs::write(dir.join("world.json"), "world").unwrap();
        let world = sha(&dir.join("world.json")).unwrap();
        let parent_hashes: Vec<_> = (0..20)
            .map(|f| (f, write("parent", f, &format!("p{f}"))))
            .collect();
        let patch_hashes: Vec<_> = (17..20)
            .map(|f| (f, write("patch", f, &format!("n{f}"))))
            .collect();
        let save = |name: &str, value: Value| {
            fs::write(dir.join(name), serde_json::to_vec(&value).unwrap()).unwrap()
        };
        let (a, a2) = (plan_for('1', None), plan_for('1', Some((2, 77))));
        let (b, b2) = (plan_for('9', None), plan_for('9', Some((2, 77))));
        let mut parent = receipt("old", &parent_hashes);
        parent["plan_hash"] = json!(a.plan_hash);
        parent["plan_final_key"] = json!(a.final_key);
        save("parent/complete.json", parent);
        save("patch/complete.json", receipt(&world, &patch_hashes));
        save(
            "revision.json",
            json!({"schema":"render-revision/2","source_unchanged":true,"scope_unchanged":true,
                "source_world_sha256":"old","world_sha256":world,"frames":20,
                "scoped_world_hashes":vec!["h";20],"changed_frames":[17,18,19]}),
        );
        for (name, plan) in [("a", &a), ("a2", &a2), ("b", &b), ("b2", &b2)] {
            save(&format!("{name}.json"), serde_json::to_value(plan).unwrap());
        }
        save("good.json", crate::windows::diff(&a, &a2).unwrap());
        save("other-cut.json", crate::windows::diff(&b, &b2).unwrap());
        let go = |diff: &str, out: &str, extra: &[&str]| {
            let mut args: Vec<OsString> =
                ["--root", dir.to_str().unwrap(), "--allow-from-diff", diff]
                    .map(Into::into)
                    .into();
            args.extend(extra.iter().map(OsString::from));
            args.extend(
                ["parent", "revision.json", "patch", "world.json", out].map(OsString::from),
            );
            run(args)
        };
        // A bare diff, without the plans that reproduce it, is never accepted.
        let err = go("good.json", "o1", &[]).unwrap_err().to_string();
        assert!(err.contains("--old-plan"), "{err}");
        assert!(!dir.join("o1").exists());
        // A hand-widened diff without plans is refused for the same reason.
        let mut widened = read(&dir.join("good.json")).unwrap();
        widened["invalidated_intervals"] = json!([[0, 20]]);
        save("widened.json", widened);
        assert!(go("widened.json", "o1b", &[]).is_err());
        assert!(!dir.join("o1b").exists());
        // A diff from another cut of the same length is refused by the parent binding.
        let err = go(
            "other-cut.json",
            "o1c",
            &["--old-plan", "b.json", "--new-plan", "b2.json"],
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("plan_final_key"), "{err}");
        // Supplying the other cut's plans does not help: the diff is consistent, the parent is not.
        assert!(
            go(
                "other-cut.json",
                "o2",
                &["--old-plan", "b.json", "--new-plan", "b2.json"]
            )
            .is_err()
        );
        // Plans that do not reproduce the diff are refused.
        let err = go(
            "good.json",
            "o3",
            &["--old-plan", "a.json", "--new-plan", "b2.json"],
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("diff") || err.contains("plan"), "{err}");
        // The matching diff and plans succeed, and the new cache records the new plan.
        go(
            "good.json",
            "o4",
            &["--old-plan", "a.json", "--new-plan", "a2.json"],
        )
        .unwrap();
        let cache = read(&dir.join("o4/complete.json")).unwrap();
        assert_eq!(cache["plan_hash"], json!(a2.plan_hash));
        assert_eq!(cache["plan_final_key"], json!(a2.final_key));
        assert_eq!(cache["rerendered_frames"], 3);
        // A parent without a recorded plan is refused.
        let mut bare = read(&dir.join("parent/complete.json")).unwrap();
        bare.as_object_mut().unwrap().remove("plan_hash");
        save("parent/complete.json", bare);
        assert!(
            go(
                "good.json",
                "o5",
                &["--old-plan", "a.json", "--new-plan", "a2.json"]
            )
            .is_err()
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_in_place_model_update_loads_but_a_stale_new_plan_does_not() {
        use crate::windows::{Hashes, ModelFile, Profile, Request, build};
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("vpr-cache-model-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let root = Root::new(&dir).unwrap();
        let weights = dir.join("m.safetensors");
        let plan_over = |bytes: &[u8]| {
            fs::write(&weights, bytes).unwrap();
            build(&Request {
                profile: Profile::ltx(),
                total_frames: 20,
                max_window: 9,
                history_len: 1,
                master_seed: 3,
                seed_overrides: Default::default(),
                hashes: Hashes {
                    input_sha256: "1".repeat(64),
                    prompt_sha256: "2".repeat(64),
                    settings_sha256: "3".repeat(64),
                    models: vec![ModelFile {
                        path: "m.safetensors".into(),
                        sha256: sha(&weights).unwrap(),
                        verified: true,
                    }],
                },
            })
            .unwrap()
        };
        let save = |name: &str, plan: &crate::windows::Plan| {
            fs::write(dir.join(name), serde_json::to_vec(plan).unwrap()).unwrap();
            dir.join(name)
        };
        let old = save("old.json", &plan_over(b"weights-v1"));
        // The weights are overwritten in place, then re-planned.
        let new = save("new.json", &plan_over(b"weights-v2"));
        assert!(
            load_old_plan(&old).is_ok(),
            "old plan's weights are gone by design"
        );
        assert!(load_new_plan(&new, &root).is_ok());
        // A new plan whose weights differ from the disk is still refused.
        fs::write(&weights, b"weights-v3").unwrap();
        let err = load_new_plan(&new, &root).unwrap_err().to_string();
        assert!(err.contains("hashes to"), "{err}");
        // The old plan's structure is still checked.
        let mut broken: Value = read(&old).unwrap();
        broken["final_key"] = json!("0".repeat(64));
        fs::write(
            dir.join("broken.json"),
            serde_json::to_vec(&broken).unwrap(),
        )
        .unwrap();
        assert!(load_old_plan(&dir.join("broken.json")).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn assembled_cache_records_only_root_relative_paths() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("vpr-cache-{}-{nonce}", std::process::id()));
        for sub in ["parent", "patch"] {
            fs::create_dir_all(dir.join(sub)).unwrap();
        }
        let write = |sub: &str, frame: u64, text: &str| {
            let path = dir.join(sub).join(format!("frame-{frame:04}.png"));
            fs::write(&path, text).unwrap();
            sha(&path).unwrap()
        };
        fs::write(dir.join("world.json"), "world").unwrap();
        let world = sha(&dir.join("world.json")).unwrap();
        let parent_hashes: Vec<_> = (0..6)
            .map(|f| (f, write("parent", f, &format!("p{f}"))))
            .collect();
        let patch_hashes: Vec<_> = (2..4)
            .map(|f| (f, write("patch", f, &format!("n{f}"))))
            .collect();
        let save = |name: &str, value: Value| {
            fs::write(dir.join(name), serde_json::to_vec(&value).unwrap()).unwrap()
        };
        save("parent/complete.json", receipt("old", &parent_hashes));
        save("patch/complete.json", receipt(&world, &patch_hashes));
        save(
            "revision.json",
            json!({"schema":"render-revision/2","source_unchanged":true,"scope_unchanged":true,
                "source_world_sha256":"old","world_sha256":world,"frames":6,
                "scoped_world_hashes":vec!["h";6],"changed_frames":[2,3]}),
        );
        let args: Vec<OsString> = [
            "--root",
            dir.to_str().unwrap(),
            "--allow",
            "2..4",
            "parent",
            "revision.json",
            "patch",
            "world.json",
            "out",
        ]
        .map(Into::into)
        .into();
        run(args).unwrap();
        let cache: Value = read(&dir.join("out/complete.json")).unwrap();
        assert!(absolute_paths(&cache).is_empty(), "{cache}");
        assert_eq!(cache["source_scene"], "world.json");
        assert_eq!(cache["reused_frames"], 4);
        assert_eq!(cache["frames"][2]["origin"], "rerendered scoped revision");
        assert_eq!(
            fs::read_to_string(dir.join("out/frame-0002.png")).unwrap(),
            "n2"
        );
        assert_eq!(
            fs::read_to_string(dir.join("out/frame-0005.png")).unwrap(),
            "p5"
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
