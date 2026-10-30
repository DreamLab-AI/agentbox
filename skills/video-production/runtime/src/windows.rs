//! Generation-window planner with chained checkpoint keys.
//!
//! A long delivery is rendered as a chain of fixed-grid *windows*. The planner
//! tiles `[0, F)` exactly, records one deterministic seed per window and derives
//! a checkpoint key per window that chains onto the previous one, so rerolling
//! window `N` invalidates window `N` and everything after it, never anything
//! before. [`diff`] reports the invalidated delivery intervals, which
//! `render-cache --allow-from-diff` accepts as its allowed frame scope.
//!
//! Window geometry:
//!
//! * window 0 has no history and delivers its whole length;
//! * window `i > 0` starts at the previous delivery boundary: its first
//!   generated frame repeats the previous delivered frame and is discarded at
//!   assembly (`discard_head = 1`); its conditioning history is the
//!   `history_len` delivered frames before the boundary;
//! * the final window uses the smallest grid length that covers the remainder
//!   and pads the tail only (`tail_padding`, discarded at assembly).
//!
//! Profiles fix the grids: `h3` has `L = 17n+5` (`n >= 1`) and `H = 17k+1`
//! (`k >= 0`); `ltx` has `L = 8n+1` and `H = 8k+1`; `generic` takes
//! `{modulus, offset}` for both.
//!
//! The *plan hash* covers geometry only (schema, profile, policy, windows
//! without seeds, seed scheme). Seeds enter through the keys, which is what lets
//! a per-window reroll leave earlier keys untouched.
//!
//! Only the arithmetic is exercised here: model qualification for any profile is
//! `NOT_RUN` until its weights are available to the sidecar.
use crate::{
    clock::{DurationPolicy, FrameInterval, RationalRate, RationalSeconds},
    comfy::sha256_hex,
    paths::{Root, take_root_option},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, error::Error, ffi::OsString, fs, path::Path};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

/// Schema id of a plan document.
pub const PLAN_SCHEMA: &str = "window-plan/2";
/// Schema id of a diff document.
pub const DIFF_SCHEMA: &str = "window-diff/1";
/// Schema id mixed into every checkpoint key.
pub const KEY_SCHEMA: &str = "window-key/2";
/// Seed derivation scheme recorded in every plan.
pub const SEED_SCHEME: &str = "window-seed-increment/1";
/// Upper bound on windows in one plan; larger requests are refused.
pub const MAX_WINDOWS: usize = 100_000;

/// Serialise `value` as compact JSON with every object's keys sorted.
///
/// ```
/// use video_production_runtime::windows::canonical_json;
/// let v = serde_json::json!({"b": 1, "a": {"d": [2, 1], "c": null}});
/// assert_eq!(canonical_json(&v), r#"{"a":{"c":null,"d":[2,1]},"b":1}"#);
/// ```
pub fn canonical_json(value: &Value) -> String {
    let mut out = String::new();
    write_canonical(value, &mut out);
    out
}

fn write_canonical(value: &Value, out: &mut String) {
    match value {
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (i, key) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String((*key).clone()).to_string());
                out.push(':');
                write_canonical(&map[*key], out);
            }
            out.push('}');
        }
        other => out.push_str(&other.to_string()),
    }
}

fn digest(value: &Value) -> String {
    sha256_hex(canonical_json(value).as_bytes())
}

/// An arithmetic progression of valid lengths: `modulus * n + offset`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Grid {
    /// Step between valid lengths (at least 1).
    pub modulus: u64,
    /// Length at `n = 0`.
    pub offset: u64,
}

impl Grid {
    /// Whether `len` is `modulus * n + offset` for some `n >= 0`.
    pub fn contains(self, len: u64) -> bool {
        len >= self.offset && (len - self.offset).is_multiple_of(self.modulus)
    }

    /// Smallest window length (`n >= 1`).
    pub fn min_window(self) -> u64 {
        self.modulus + self.offset
    }

    /// Largest window length not above `max`, if any exists with `n >= 1`.
    pub fn floor_window(self, max: u64) -> Option<u64> {
        let min = self.min_window();
        (max >= min).then(|| (max - self.offset) / self.modulus * self.modulus + self.offset)
    }

    /// Smallest window length (`n >= 1`) of at least `need` frames.
    pub fn ceil_window(self, need: u64) -> u64 {
        let n = need
            .saturating_sub(self.offset)
            .div_ceil(self.modulus)
            .max(1);
        n * self.modulus + self.offset
    }
}

/// Window and history grids of a model family.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Profile {
    /// Profile name: `h3`, `ltx` or `generic`.
    pub name: String,
    /// Valid window lengths.
    pub window: Grid,
    /// Valid history lengths.
    pub history: Grid,
}

impl Profile {
    /// The `h3` profile: `L = 17n+5`, `H = 17k+1`.
    pub fn h3() -> Self {
        Self {
            name: "h3".into(),
            window: Grid {
                modulus: 17,
                offset: 5,
            },
            history: Grid {
                modulus: 17,
                offset: 1,
            },
        }
    }

    /// The `ltx` profile: `L = 8n+1`, `H = 8k+1`.
    pub fn ltx() -> Self {
        Self {
            name: "ltx".into(),
            window: Grid {
                modulus: 8,
                offset: 1,
            },
            history: Grid {
                modulus: 8,
                offset: 1,
            },
        }
    }

    /// A caller-defined profile; moduli must be non-zero.
    pub fn generic(window: Grid, history: Grid) -> Result<Self> {
        if window.modulus == 0 || history.modulus == 0 {
            return Err("profile moduli must be at least 1".into());
        }
        Ok(Self {
            name: "generic".into(),
            window,
            history,
        })
    }
}

/// A model file identified by root-relative path and SHA-256.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelFile {
    /// Root-relative path.
    pub path: String,
    /// Lower-case hex SHA-256 of the file.
    pub sha256: String,
    /// Whether the hash was computed from the file under the production root
    /// when the plan was made. `false` marks a caller-asserted hash (weights not
    /// on this box); it is part of the checkpoint keys, so an unverified plan
    /// can never share keys with a verified one.
    #[serde(default)]
    pub verified: bool,
}

/// Streaming SHA-256 of a (possibly multi-gigabyte) file.
pub fn sha256_file(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// Hashes that every window key binds to.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hashes {
    /// SHA-256 of the input media / guide set.
    pub input_sha256: String,
    /// SHA-256 of the prompt set.
    pub prompt_sha256: String,
    /// SHA-256 of the sampler / workflow settings.
    pub settings_sha256: String,
    /// Model files, kept sorted by path.
    pub models: Vec<ModelFile>,
}

fn check_hex(label: &str, text: &str) -> Result<()> {
    if text.len() == 64 && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        Ok(())
    } else {
        Err(format!("{label} must be a 64-character lower-case hex SHA-256").into())
    }
}

impl Hashes {
    fn validate(&self) -> Result<()> {
        check_hex("input_sha256", &self.input_sha256)?;
        check_hex("prompt_sha256", &self.prompt_sha256)?;
        check_hex("settings_sha256", &self.settings_sha256)?;
        if self.models.is_empty() {
            return Err("at least one model file is required".into());
        }
        let mut seen = std::collections::BTreeSet::new();
        for model in &self.models {
            check_hex(&format!("model {}", model.path), &model.sha256)?;
            if model.path.is_empty() || !seen.insert(&model.path) {
                return Err("model paths must be non-empty and unique".into());
            }
        }
        if self.models.windows(2).any(|w| w[0].path > w[1].path) {
            return Err("models must be sorted by path".into());
        }
        Ok(())
    }
}

/// What the planner needs to build a [`Plan`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Request {
    /// Window / history grids.
    pub profile: Profile,
    /// Total delivery frames `F` (at least 1).
    pub total_frames: u64,
    /// Largest permitted window length.
    pub max_window: u64,
    /// History length for windows after the first.
    pub history_len: u64,
    /// Master seed.
    pub master_seed: u64,
    /// Per-window seed overrides (rerolls), keyed by window index.
    pub seed_overrides: BTreeMap<u64, u64>,
    /// Hashes bound into every key.
    pub hashes: Hashes,
}

/// One planned generation window.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Window {
    /// Position in the chain.
    pub index: u64,
    /// Generated length `L`, on the profile grid.
    pub length: u64,
    /// Leading generated frames discarded at assembly (0 for window 0, else 1).
    pub discard_head: u64,
    /// Trailing generated frames discarded at assembly (last window only).
    pub tail_padding: u64,
    /// Delivery frames this window contributes.
    pub delivery: FrameInterval,
    /// Delivery frames used as conditioning history (`None` for window 0).
    pub history: Option<FrameInterval>,
    /// Seed used for this window.
    pub seed: u64,
    /// Chained checkpoint key.
    pub key: String,
}

/// A complete window plan.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Plan {
    /// Always [`PLAN_SCHEMA`].
    pub schema: String,
    /// The request this plan was built from.
    pub request: Request,
    /// Seed scheme id, always [`SEED_SCHEME`].
    pub seed_scheme: String,
    /// Windows in order.
    pub windows: Vec<Window>,
    /// Hash of the geometry; see the module documentation.
    pub plan_hash: String,
    /// Key of the last window.
    pub final_key: String,
}

fn geometry(profile: &Profile, request: &Request, windows: &[Window]) -> Value {
    json!({
        "schema": PLAN_SCHEMA,
        "profile": profile,
        "policy": {"total_frames": request.total_frames, "max_window": request.max_window,
            "history_len": request.history_len},
        "windows": windows.iter().map(|w| json!({
            "index": w.index, "length": w.length, "discard_head": w.discard_head,
            "tail_padding": w.tail_padding, "delivery": w.delivery, "history": w.history,
        })).collect::<Vec<_>>(),
        "seed_scheme": SEED_SCHEME,
    })
}

fn chain_key(plan_hash: &str, window: &Window, hashes: &Hashes, prev: Option<&str>) -> String {
    digest(&json!({
        "schema": KEY_SCHEMA, "plan_hash": plan_hash, "index": window.index,
        "seed": window.seed, "input_sha256": hashes.input_sha256,
        "prompt_sha256": hashes.prompt_sha256, "settings_sha256": hashes.settings_sha256,
        "models": hashes.models, "prev_key": prev,
    }))
}

/// Build a plan, refusing inconsistent requests.
///
/// ```
/// use video_production_runtime::windows::{build, Hashes, ModelFile, Profile, Request};
/// let h = "0".repeat(64);
/// let request = Request {
///     profile: Profile::h3(), total_frames: 121, max_window: 90, history_len: 18,
///     master_seed: 7, seed_overrides: Default::default(),
///     hashes: Hashes { input_sha256: h.clone(), prompt_sha256: h.clone(),
///         settings_sha256: h.clone(), models: vec![ModelFile { path: "m.safetensors".into(), sha256: h, verified: false }] },
/// };
/// let plan = build(&request).unwrap();
/// let lengths: Vec<_> = plan.windows.iter().map(|w| w.length).collect();
/// assert_eq!(lengths, [90, 39]);
/// ```
pub fn build(request: &Request) -> Result<Plan> {
    let profile = &request.profile;
    if profile.window.modulus == 0 || profile.history.modulus == 0 {
        return Err("profile moduli must be at least 1".into());
    }
    if request.total_frames == 0 {
        return Err("total frames must be at least 1".into());
    }
    request.hashes.validate()?;
    let max_len = profile
        .window
        .floor_window(request.max_window)
        .ok_or_else(|| {
            format!(
                "max window {} is below the smallest {} window length {}",
                request.max_window,
                profile.name,
                profile.window.min_window()
            )
        })?;
    if !profile.history.contains(request.history_len) {
        return Err(format!(
            "history length {} is not on the {} history grid ({}k+{})",
            request.history_len, profile.name, profile.history.modulus, profile.history.offset
        )
        .into());
    }
    let mut windows: Vec<Window> = Vec::new();
    let mut start = 0u64;
    while start < request.total_frames {
        if windows.len() >= MAX_WINDOWS {
            return Err(format!("plan would exceed {MAX_WINDOWS} windows").into());
        }
        let index = windows.len() as u64;
        let discard_head = u64::from(index > 0);
        let remainder = request.total_frames - start;
        let capacity = max_len - discard_head;
        let (length, delivered, tail_padding) = if remainder <= capacity {
            let length = profile.window.ceil_window(remainder + discard_head);
            (length, remainder, length - discard_head - remainder)
        } else {
            (max_len, capacity, 0)
        };
        let history = if index == 0 {
            None
        } else {
            let from = start.checked_sub(request.history_len).ok_or_else(|| {
                format!(
                    "history length {} exceeds the {start} frames delivered before window {index}",
                    request.history_len
                )
            })?;
            Some(FrameInterval::new(from, start)?)
        };
        let seed = request
            .seed_overrides
            .get(&index)
            .copied()
            .unwrap_or_else(|| request.master_seed.wrapping_add(index));
        windows.push(Window {
            index,
            length,
            discard_head,
            tail_padding,
            delivery: FrameInterval::new(start, start + delivered)?,
            history,
            seed,
            key: String::new(),
        });
        start += delivered;
    }
    if let Some(bad) = request
        .seed_overrides
        .keys()
        .find(|&&i| i >= windows.len() as u64)
    {
        return Err(format!(
            "seed override for window {bad} but the plan has {} windows",
            windows.len()
        )
        .into());
    }
    let delivery: Vec<FrameInterval> = windows.iter().map(|w| w.delivery).collect();
    let delivered: u64 = windows.iter().map(|w| w.delivery.len()).sum();
    if !FrameInterval::tiles(&delivery, request.total_frames) || delivered != request.total_frames {
        return Err("internal error: windows do not tile the delivery".into());
    }
    let plan_hash = digest(&geometry(profile, request, &windows));
    let mut prev: Option<String> = None;
    for window in &mut windows {
        window.key = chain_key(&plan_hash, window, &request.hashes, prev.as_deref());
        prev = Some(window.key.clone());
    }
    Ok(Plan {
        schema: PLAN_SCHEMA.into(),
        request: request.clone(),
        seed_scheme: SEED_SCHEME.into(),
        final_key: prev.unwrap_or_default(),
        windows,
        plan_hash,
    })
}

impl Plan {
    /// Rebuild the plan from its own request and require byte-identical content.
    ///
    /// Refuses edited windows, keys, hashes or schema ids. Model files are not
    /// consulted; see [`Plan::verify_in`].
    pub fn verify(&self) -> Result<()> {
        if self.schema != PLAN_SCHEMA {
            return Err(if self.schema.starts_with("window-plan/") {
                format!(
                    "plan schema {} is superseded by {PLAN_SCHEMA} (the model-hash `verified` flag now \
                     changes checkpoint keys), re-plan",
                    self.schema
                )
            } else {
                format!("unsupported plan schema {}", self.schema)
            }
            .into());
        }
        let rebuilt = build(&self.request)?;
        if rebuilt != *self {
            return Err(
                "plan does not match a fresh build from its request (edited or stale)".into(),
            );
        }
        Ok(())
    }

    /// [`Plan::verify`], and additionally re-hash every model file that is
    /// present under `root` and refuse a mismatch with the plan's hash.
    ///
    /// Returns the model paths that could not be checked (no root given, or the
    /// file is not on this box), so a caller can report them rather than assume.
    pub fn verify_in(&self, root: Option<&Root>) -> Result<Vec<String>> {
        self.verify()?;
        let mut unchecked = Vec::new();
        for model in &self.request.hashes.models {
            let present = match root {
                Some(root) => Some(root.resolve(Path::new(&model.path))?).filter(|p| p.is_file()),
                None => None,
            };
            let Some(path) = present else {
                unchecked.push(model.path.clone());
                continue;
            };
            let actual = sha256_file(&path)?;
            if actual != model.sha256 {
                return Err(format!(
                    "model {} hashes to {actual}, but the plan records {}",
                    model.path, model.sha256
                )
                .into());
            }
        }
        Ok(unchecked)
    }
}

fn merge(intervals: &[FrameInterval]) -> Vec<FrameInterval> {
    let mut out: Vec<FrameInterval> = Vec::new();
    for &interval in intervals {
        match out.last().and_then(|last| last.join(interval)) {
            Some(joined) => *out.last_mut().expect("non-empty") = joined,
            None => out.push(interval),
        }
    }
    out
}

/// Compare two plans and report the windows of `new` whose checkpoints are
/// invalid relative to `old`. Both plans are verified first.
///
/// The report's `invalidated_intervals` are in `new`'s delivery frames.
pub fn diff(old: &Plan, new: &Plan) -> Result<Value> {
    diff_in(old, new, None)
}

/// [`diff`], additionally re-hashing `new`'s model files under `root`.
///
/// Only `new` is checked against the files: the old plan's weights are
/// typically gone (that is what a model revision is). The report lists the
/// models that could not be checked as `unchecked_models`.
pub fn diff_in(old: &Plan, new: &Plan, root: Option<&Root>) -> Result<Value> {
    old.verify()?;
    let unchecked = new.verify_in(root)?;
    let mut invalidated = Vec::new();
    let mut intervals = Vec::new();
    let mut first: Option<u64> = None;
    for window in &new.windows {
        let before = old.windows.get(window.index as usize);
        if before.is_some_and(|b| b.key == window.key) {
            continue;
        }
        let reason = match (first, before) {
            (Some(n), _) => format!("chained to window {n}"),
            (None, None) => "window added".to_string(),
            (None, Some(b)) if old.plan_hash != new.plan_hash => {
                let _ = b;
                "plan geometry changed".to_string()
            }
            (None, Some(b)) if b.seed != window.seed => "seed changed".to_string(),
            (None, Some(_)) => "input, prompt, settings or model hash changed".to_string(),
        };
        first.get_or_insert(window.index);
        invalidated
            .push(json!({"index": window.index, "delivery": window.delivery, "reason": reason}));
        intervals.push(window.delivery);
    }
    let merged = merge(&intervals);
    let removed: Vec<u64> = (new.windows.len()..old.windows.len())
        .map(|i| i as u64)
        .collect();
    Ok(json!({
        "schema": DIFF_SCHEMA,
        "old_plan_hash": old.plan_hash, "new_plan_hash": new.plan_hash,
        "old_final_key": old.final_key, "new_final_key": new.final_key,
        "delivery_frames": new.request.total_frames,
        "first_invalid_window": first,
        "valid_windows": new.windows.len() - invalidated.len(),
        "invalidated_windows": invalidated,
        "removed_windows": removed,
        "invalidated_intervals": merged,
        "allow": merged.iter().map(|i| format!("{}..{}", i.start(), i.end())).collect::<Vec<_>>(),
        "unchecked_models": unchecked,
    }))
}

fn take_value(args: &mut Vec<OsString>, name: &str) -> Result<Option<String>> {
    let Some(i) = args.iter().position(|a| a == name) else {
        return Ok(None);
    };
    if i + 1 >= args.len() {
        return Err(format!("{name} needs a value").into());
    }
    let value = args.remove(i + 1);
    args.remove(i);
    Ok(Some(
        value
            .into_string()
            .map_err(|_| format!("{name} must be UTF-8"))?,
    ))
}

fn take_all(args: &mut Vec<OsString>, name: &str) -> Result<Vec<String>> {
    let mut all = Vec::new();
    while let Some(value) = take_value(args, name)? {
        all.push(value);
    }
    Ok(all)
}

fn number(name: &str, text: &str) -> Result<u64> {
    text.parse()
        .map_err(|_| format!("{name} expects an unsigned integer, got {text:?}").into())
}

fn fraction(name: &str, text: &str) -> Result<(u64, u64)> {
    let (n, d) = text.split_once('/').unwrap_or((text, "1"));
    Ok((number(name, n)?, number(name, d)?))
}

const USAGE: &str = "usage:
  window-plan [--root DIR] plan --profile h3|ltx|generic (--frames F | --rate N/D --seconds N[/D])
      --max-window L --history H [--seed S] [--reroll INDEX=SEED]...
      --input-sha256 HEX --prompt-sha256 HEX --settings-sha256 HEX --model PATH=HEX... [--model-hash-unverified PATH=HEX]... [--out FILE]
      generic profile also needs --window-modulus M --window-offset O --history-modulus M --history-offset O
  window-plan [--root DIR] diff OLD_PLAN NEW_PLAN [--out FILE]
--model hashes PATH under the root and refuses a different HEX or a missing file;
--model-hash-unverified records a caller-asserted hash for weights not on this box
(`verified: false`, part of every key). `diff` re-hashes NEW_PLAN's model files that are present.
Writes JSON to stdout (or --out FILE, which must not exist). The diff's `allow` intervals feed
`render-cache --allow-from-diff`.";

fn emit(root: &Root, out: Option<String>, value: &Value) -> Result<()> {
    let text = format!("{}\n", serde_json::to_string_pretty(value)?);
    match out {
        None => print!("{text}"),
        Some(path) => {
            let path = root.resolve(Path::new(&path))?;
            if path.exists() {
                return Err("output must be new".into());
            }
            fs::write(path, text)?;
        }
    }
    Ok(())
}

fn request_from(root: &Root, args: &mut Vec<OsString>) -> Result<Request> {
    let required = |args: &mut Vec<OsString>, name: &str| -> Result<String> {
        take_value(args, name)?.ok_or_else(|| format!("{name} is required").into())
    };
    let profile = match required(args, "--profile")?.as_str() {
        "h3" => Profile::h3(),
        "ltx" => Profile::ltx(),
        "generic" => {
            let mut grid = |m: &str, o: &str| -> Result<Grid> {
                Ok(Grid {
                    modulus: number(m, &required(args, m)?)?,
                    offset: number(o, &required(args, o)?)?,
                })
            };
            let window = grid("--window-modulus", "--window-offset")?;
            let history = grid("--history-modulus", "--history-offset")?;
            Profile::generic(window, history)?
        }
        other => return Err(format!("unknown profile {other:?}").into()),
    };
    let frames = take_value(args, "--frames")?;
    let rate = take_value(args, "--rate")?;
    let seconds = take_value(args, "--seconds")?;
    let total_frames = match (frames, rate, seconds) {
        (Some(f), None, None) => number("--frames", &f)?,
        (None, Some(r), Some(s)) => {
            let rate: RationalRate = r.parse()?;
            let (num, den) = fraction("--seconds", &s)?;
            DurationPolicy::strict()
                .resolve(rate, Some(RationalSeconds::new(num, den)?), None)?
                .frames
        }
        _ => return Err("give either --frames F or both --rate N/D and --seconds N[/D]".into()),
    };
    let max_window = number("--max-window", &required(args, "--max-window")?)?;
    let history_len = number("--history", &required(args, "--history")?)?;
    let master_seed = take_value(args, "--seed")?.map_or(Ok(0), |s| number("--seed", &s))?;
    let mut seed_overrides = BTreeMap::new();
    for item in take_all(args, "--reroll")? {
        let (index, seed) = item.split_once('=').ok_or("--reroll expects INDEX=SEED")?;
        if seed_overrides
            .insert(number("--reroll", index)?, number("--reroll", seed)?)
            .is_some()
        {
            return Err("duplicate --reroll index".into());
        }
    }
    let mut models = Vec::new();
    for item in take_all(args, "--model")? {
        let (path, sha) = item.rsplit_once('=').ok_or("--model expects PATH=SHA256")?;
        check_hex(&format!("model {path}"), sha)?;
        let file = root.resolve(Path::new(path))?;
        if !file.is_file() {
            return Err(format!(
                "model file {path} is not under the production root (use --model-hash-unverified for weights not on this box)"
            )
            .into());
        }
        let actual = sha256_file(&file)?;
        if actual != sha {
            return Err(format!("model {path} hashes to {actual}, not the given {sha}").into());
        }
        models.push(ModelFile {
            path: root.rel(Path::new(path))?,
            sha256: actual,
            verified: true,
        });
    }
    for item in take_all(args, "--model-hash-unverified")? {
        let (path, sha) = item
            .rsplit_once('=')
            .ok_or("--model-hash-unverified expects PATH=SHA256")?;
        check_hex(&format!("model {path}"), sha)?;
        let file = root.resolve(Path::new(path))?;
        if file.is_file() {
            return Err(format!(
                "model file {path} is on this box: use --model so its hash is checked, not asserted"
            )
            .into());
        }
        models.push(ModelFile {
            path: root.rel(Path::new(path))?,
            sha256: sha.into(),
            verified: false,
        });
    }
    models.sort_by(|a, b| a.path.cmp(&b.path));
    let hashes = Hashes {
        input_sha256: required(args, "--input-sha256")?,
        prompt_sha256: required(args, "--prompt-sha256")?,
        settings_sha256: required(args, "--settings-sha256")?,
        models,
    };
    Ok(Request {
        profile,
        total_frames,
        max_window,
        history_len,
        master_seed,
        seed_overrides,
        hashes,
    })
}

fn read_plan(root: &Root, path: &OsString) -> Result<Plan> {
    Ok(serde_json::from_slice(&fs::read(
        root.resolve(Path::new(path))?,
    )?)?)
}

/// Entry point of the `window-plan` binary; see the usage text (`--help`).
pub fn run(mut args: Vec<OsString>) -> Result<()> {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!("{USAGE}");
        return Ok(());
    }
    let root = Root::new(&take_root_option(&mut args)?)?;
    if args.is_empty() {
        return Err(USAGE.into());
    }
    let command = args.remove(0);
    let out = take_value(&mut args, "--out")?;
    match command.to_str() {
        Some("plan") => {
            let request = request_from(&root, &mut args)?;
            if let Some(extra) = args.first() {
                return Err(format!("unexpected argument {extra:?}").into());
            }
            emit(&root, out, &serde_json::to_value(build(&request)?)?)
        }
        Some("diff") => {
            if args.len() != 2 {
                return Err(USAGE.into());
            }
            let report = diff_in(
                &read_plan(&root, &args[0])?,
                &read_plan(&root, &args[1])?,
                Some(&root),
            )?;
            emit(&root, out, &report)
        }
        _ => Err(USAGE.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(c: char) -> String {
        c.to_string().repeat(64)
    }

    fn hashes() -> Hashes {
        Hashes {
            input_sha256: hex('1'),
            prompt_sha256: hex('2'),
            settings_sha256: hex('3'),
            models: vec![
                ModelFile {
                    path: "a.safetensors".into(),
                    sha256: hex('a'),
                    verified: false,
                },
                ModelFile {
                    path: "b.safetensors".into(),
                    sha256: hex('b'),
                    verified: false,
                },
            ],
        }
    }

    fn request(profile: Profile, frames: u64, max: u64, history: u64) -> Request {
        Request {
            profile,
            total_frames: frames,
            max_window: max,
            history_len: history,
            master_seed: 1000,
            seed_overrides: BTreeMap::new(),
            hashes: hashes(),
        }
    }

    fn sweeps() -> Vec<(Profile, u64, u64)> {
        // (profile, max window, history)
        vec![
            (Profile::h3(), 22, 1),
            (Profile::h3(), 22, 18),
            (Profile::h3(), 39, 18),
            (Profile::h3(), 90, 18),
            (Profile::h3(), 100, 35),
            (Profile::h3(), 241, 69),
            (Profile::ltx(), 9, 1),
            (Profile::ltx(), 17, 9),
            (Profile::ltx(), 65, 17),
            (Profile::ltx(), 121, 25),
            (
                Profile::generic(
                    Grid {
                        modulus: 4,
                        offset: 0,
                    },
                    Grid {
                        modulus: 4,
                        offset: 0,
                    },
                )
                .unwrap(),
                16,
                0,
            ),
            (
                Profile::generic(
                    Grid {
                        modulus: 4,
                        offset: 0,
                    },
                    Grid {
                        modulus: 4,
                        offset: 0,
                    },
                )
                .unwrap(),
                40,
                8,
            ),
            (
                Profile::generic(
                    Grid {
                        modulus: 6,
                        offset: 3,
                    },
                    Grid {
                        modulus: 5,
                        offset: 2,
                    },
                )
                .unwrap(),
                33,
                7,
            ),
        ]
    }

    #[test]
    fn windows_tile_and_obey_the_profile_grids_over_many_sizes() {
        let mut plans = 0;
        for (profile, max, history) in sweeps() {
            for frames in 1..=400u64 {
                let req = request(profile.clone(), frames, max, history);
                let plan = match build(&req) {
                    Ok(p) => p,
                    // a history longer than window 0 delivers is a legitimate refusal
                    Err(e) => {
                        assert!(e.to_string().contains("exceeds"), "{e}");
                        continue;
                    }
                };
                plans += 1;
                let delivery: Vec<_> = plan.windows.iter().map(|w| w.delivery).collect();
                assert!(
                    FrameInterval::tiles(&delivery, frames),
                    "{profile:?} F={frames}"
                );
                assert_eq!(
                    plan.windows.iter().map(|w| w.delivery.len()).sum::<u64>(),
                    frames
                );
                let last = plan.windows.len() - 1;
                for w in &plan.windows {
                    assert!(
                        profile.window.contains(w.length)
                            && w.length >= profile.window.min_window()
                    );
                    assert!(w.length <= profile.window.floor_window(max).unwrap());
                    assert_eq!(w.discard_head, u64::from(w.index > 0));
                    assert_eq!(w.length, w.discard_head + w.delivery.len() + w.tail_padding);
                    if (w.index as usize) != last {
                        assert_eq!(w.tail_padding, 0, "padding outside the last window");
                    }
                    match w.history {
                        None => assert_eq!(w.index, 0),
                        Some(h) => {
                            assert!(profile.history.contains(h.len()), "history off grid");
                            assert_eq!(h.end(), w.delivery.start());
                        }
                    }
                }
                // the final window is the smallest valid cover of the remainder
                let w = &plan.windows[last];
                let need = w.discard_head + w.delivery.len();
                assert_eq!(w.length, profile.window.ceil_window(need));
                assert!(
                    w.tail_padding < profile.window.modulus
                        || w.length == profile.window.min_window()
                );
                if frames % 25 == 0 {
                    plan.verify().unwrap();
                }
            }
        }
        assert!(plans > 3000, "sweep too small: {plans}");
    }

    #[test]
    fn example_h3_plan_for_121_frames() {
        let plan = build(&request(Profile::h3(), 121, 90, 18)).unwrap();
        let shape: Vec<_> = plan
            .windows
            .iter()
            .map(|w| {
                (
                    w.length,
                    w.discard_head,
                    w.tail_padding,
                    w.delivery.start(),
                    w.delivery.end(),
                )
            })
            .collect();
        assert_eq!(shape, [(90, 0, 0, 0, 90), (39, 1, 7, 90, 121)]);
        assert_eq!(
            plan.windows[1].history,
            Some(FrameInterval::new(72, 90).unwrap())
        );
    }

    #[test]
    fn seeds_increment_and_wrap_at_u64_max() {
        let mut req = request(Profile::ltx(), 200, 17, 9);
        req.master_seed = u64::MAX - 2;
        let plan = build(&req).unwrap();
        let seeds: Vec<_> = plan.windows.iter().take(5).map(|w| w.seed).collect();
        assert_eq!(seeds, [u64::MAX - 2, u64::MAX - 1, u64::MAX, 0, 1]);
        assert_eq!(plan.seed_scheme, "window-seed-increment/1");
    }

    #[test]
    fn rerolling_n_changes_keys_from_n_and_none_before() {
        let base = build(&request(Profile::h3(), 400, 90, 18)).unwrap();
        let count = base.windows.len();
        assert!(count >= 5);
        for n in 0..count {
            let mut req = base.request.clone();
            req.seed_overrides.insert(n as u64, 424242);
            let rerolled = build(&req).unwrap();
            assert_eq!(
                rerolled.plan_hash, base.plan_hash,
                "reroll must not change geometry"
            );
            for i in 0..count {
                let same = rerolled.windows[i].key == base.windows[i].key;
                assert_eq!(same, i < n, "window {i} after rerolling {n}");
            }
            let report = diff(&base, &rerolled).unwrap();
            assert_eq!(report["first_invalid_window"], n);
            assert_eq!(
                report["invalidated_windows"].as_array().unwrap().len(),
                count - n
            );
            let start = base.windows[n].delivery.start();
            assert_eq!(report["allow"], json!([format!("{start}..400")]));
            assert_eq!(report["invalidated_windows"][0]["reason"], "seed changed");
        }
    }

    #[test]
    fn changing_any_bound_hash_changes_every_key() {
        let base = build(&request(Profile::h3(), 300, 90, 18)).unwrap();
        type Change = Box<dyn Fn(&mut Hashes)>;
        let variants: Vec<Change> = vec![
            Box::new(|h| h.models[1].sha256 = hex('c')),
            Box::new(|h| h.models[0].sha256 = hex('c')),
            Box::new(|h| h.input_sha256 = hex('c')),
            Box::new(|h| h.prompt_sha256 = hex('c')),
            Box::new(|h| h.settings_sha256 = hex('c')),
        ];
        for change in variants {
            let mut req = base.request.clone();
            change(&mut req.hashes);
            let other = build(&req).unwrap();
            assert_eq!(other.plan_hash, base.plan_hash);
            for (a, b) in base.windows.iter().zip(&other.windows) {
                assert_ne!(a.key, b.key);
            }
            let report = diff(&base, &other).unwrap();
            assert_eq!(report["first_invalid_window"], 0);
            assert_eq!(report["allow"], json!(["0..300"]));
        }
    }

    #[test]
    fn plan_hash_is_stable_across_key_order_and_serialisation() {
        let plan = build(&request(Profile::h3(), 121, 90, 18)).unwrap();
        let value = serde_json::to_value(&plan).unwrap();
        let shuffled: Value = serde_json::from_str(&reverse_keys(&value)).unwrap();
        assert_ne!(serde_json::to_string(&value).unwrap().len(), 0);
        assert_eq!(canonical_json(&value), canonical_json(&shuffled));
        let back: Plan = serde_json::from_value(shuffled).unwrap();
        assert_eq!(back, plan);
        back.verify().unwrap();
        assert_eq!(
            digest(&geometry(
                &plan.request.profile,
                &plan.request,
                &plan.windows
            )),
            plan.plan_hash
        );
        // canonical form is deterministic regardless of insertion order
        let a: Value = serde_json::from_str(r#"{"b":1,"a":[{"y":1,"x":2}]}"#).unwrap();
        let b: Value = serde_json::from_str(r#"{"a":[{"x":2,"y":1}],"b":1}"#).unwrap();
        assert_eq!(canonical_json(&a), canonical_json(&b));
    }

    fn reverse_keys(value: &Value) -> String {
        match value {
            Value::Object(map) => {
                let mut items: Vec<_> = map.iter().collect();
                items.reverse();
                let body: Vec<_> = items
                    .iter()
                    .map(|(k, v)| format!("{}:{}", Value::String((*k).clone()), reverse_keys(v)))
                    .collect();
                format!("{{{}}}", body.join(","))
            }
            Value::Array(items) => format!(
                "[{}]",
                items.iter().map(reverse_keys).collect::<Vec<_>>().join(",")
            ),
            other => other.to_string(),
        }
    }

    #[test]
    fn invalid_inputs_are_refused() {
        let err = |req: Request| build(&req).unwrap_err().to_string();
        assert!(err(request(Profile::h3(), 0, 90, 17)).contains("at least 1"));
        assert!(err(request(Profile::h3(), 50, 21, 17)).contains("below the smallest"));
        assert!(err(request(Profile::ltx(), 50, 8, 9)).contains("below the smallest"));
        assert!(err(request(Profile::h3(), 50, 90, 16)).contains("history grid"));
        assert!(err(request(Profile::h3(), 50, 90, 17)).contains("history grid"));
        assert!(err(request(Profile::h3(), 50, 90, 0)).contains("history grid"));
        assert!(err(request(Profile::h3(), 200, 22, 35)).contains("exceeds"));
        let mut req = request(Profile::h3(), 50, 90, 18);
        req.seed_overrides.insert(5, 1);
        assert!(err(req).contains("seed override"));
        let mut req = request(Profile::h3(), 50, 90, 18);
        req.hashes.prompt_sha256 = "XYZ".into();
        assert!(err(req).contains("SHA-256"));
        let mut req = request(Profile::h3(), 50, 90, 18);
        req.hashes.models.clear();
        assert!(err(req).contains("model"));
        assert!(
            Profile::generic(
                Grid {
                    modulus: 0,
                    offset: 1
                },
                Grid {
                    modulus: 1,
                    offset: 0
                }
            )
            .is_err()
        );
    }

    #[test]
    fn tampered_plans_are_refused_by_verify_and_diff() {
        let plan = build(&request(Profile::h3(), 121, 90, 18)).unwrap();
        let mut edited = plan.clone();
        edited.windows[1].key = hex('f');
        assert!(edited.verify().is_err());
        assert!(diff(&plan, &edited).is_err());
        let mut edited = plan.clone();
        edited.windows[0].tail_padding = 3;
        assert!(edited.verify().is_err());
    }

    #[test]
    fn diff_reports_geometry_changes_and_removed_windows() {
        let old = build(&request(Profile::h3(), 300, 90, 18)).unwrap();
        let new = build(&request(Profile::h3(), 150, 90, 18)).unwrap();
        let report = diff(&old, &new).unwrap();
        assert_eq!(report["first_invalid_window"], 0);
        assert_eq!(
            report["invalidated_windows"][0]["reason"],
            "plan geometry changed"
        );
        assert_eq!(
            report["invalidated_windows"][1]["reason"],
            "chained to window 0"
        );
        assert_eq!(
            report["removed_windows"].as_array().unwrap().len(),
            old.windows.len() - new.windows.len()
        );
        let same = diff(&old, &old).unwrap();
        assert_eq!(same["first_invalid_window"], Value::Null);
        assert_eq!(same["allow"], json!([]));
    }

    fn plan_cli(dir: &Path, models: &[(&str, String)], out: &str) -> Result<()> {
        let mut v: Vec<OsString> = vec!["--root".into(), dir.into(), "plan".into()];
        for (flag, value) in [
            ("--profile", "ltx"),
            ("--frames", "40"),
            ("--max-window", "25"),
            ("--history", "9"),
            ("--input-sha256", &hex('1')),
            ("--prompt-sha256", &hex('2')),
            ("--settings-sha256", &hex('3')),
            ("--out", out),
        ] {
            v.push(flag.into());
            v.push(value.into());
        }
        for (flag, value) in models {
            v.push((*flag).into());
            v.push(value.into());
        }
        run(v)
    }

    fn read_plan_file(dir: &Path, name: &str) -> Plan {
        serde_json::from_slice(&fs::read(dir.join(name)).unwrap()).unwrap()
    }

    #[test]
    fn a_plan_from_the_superseded_schema_is_refused_with_a_replan_message() {
        let mut plan = build(&Request {
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
                    sha256: "a".repeat(64),
                    verified: false,
                }],
            },
        })
        .unwrap();
        plan.verify().unwrap();
        plan.schema = "window-plan/1".into();
        let err = plan.verify().unwrap_err().to_string();
        assert!(
            err.contains("superseded") && err.contains("re-plan"),
            "{err}"
        );
        assert!(!err.contains("edited or stale"), "{err}");
        plan.schema = "other/9".into();
        assert!(
            plan.verify()
                .unwrap_err()
                .to_string()
                .contains("unsupported")
        );
    }

    #[test]
    fn model_hashes_are_checked_against_the_files_and_a_changed_file_changes_the_keys() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("vpr-win-model-{}-{nonce}", std::process::id()));
        fs::create_dir_all(dir.join("models")).unwrap();
        let weights = dir.join("models/m.safetensors");
        fs::write(&weights, b"weights-v1").unwrap();
        let v1 = sha256_file(&weights).unwrap();
        let model = |sha: &str| ("--model", format!("models/m.safetensors={sha}"));
        // A wrong HEX and a missing file are both refused.
        let err = plan_cli(&dir, &[model(&hex('f'))], "bad.json")
            .unwrap_err()
            .to_string();
        assert!(err.contains("hashes to"), "{err}");
        let missing = ("--model", format!("models/nope.safetensors={v1}"));
        assert!(plan_cli(&dir, &[missing], "missing.json").is_err());
        // The right HEX is accepted and recorded as verified.
        plan_cli(&dir, &[model(&v1)], "p1.json").unwrap();
        let p1 = read_plan_file(&dir, "p1.json");
        assert!(p1.request.hashes.models[0].verified);
        let root = Root::new(&dir).unwrap();
        assert!(p1.verify_in(Some(&root)).unwrap().is_empty());
        // The file changes: the old plan no longer verifies, and re-planning with the new
        // hash changes the final key.
        fs::write(&weights, b"weights-v2").unwrap();
        let err = p1.verify_in(Some(&root)).unwrap_err().to_string();
        assert!(err.contains("model models/m.safetensors"), "{err}");
        let v2 = sha256_file(&weights).unwrap();
        plan_cli(&dir, &[model(&v2)], "p2.json").unwrap();
        let p2 = read_plan_file(&dir, "p2.json");
        assert_ne!(p1.final_key, p2.final_key);
        // The old HEX no longer matches the file on disk.
        assert!(plan_cli(&dir, &[model(&v1)], "stale.json").is_err());
        // diff re-checks the new plan's files under the root.
        let report = diff_in(&p1, &p2, Some(&root)).unwrap();
        assert_eq!(report["unchecked_models"], json!([]));
        assert!(diff_in(&p2, &p1, Some(&root)).is_err());
        // Weights that are not on this box: explicit escape, marked unverified in the keys.
        let remote = (
            "--model-hash-unverified",
            format!("models/h3.safetensors={}", hex('c')),
        );
        plan_cli(&dir, std::slice::from_ref(&remote), "u.json").unwrap();
        let unverified = read_plan_file(&dir, "u.json");
        assert!(!unverified.request.hashes.models[0].verified);
        assert_eq!(
            unverified.verify_in(Some(&root)).unwrap(),
            ["models/h3.safetensors"]
        );
        let mut as_verified = unverified.request.clone();
        as_verified.hashes.models[0].verified = true;
        assert_ne!(build(&as_verified).unwrap().final_key, unverified.final_key);
        // Once the file does appear, the asserted hash is checked, and the escape is closed.
        fs::write(dir.join("models/h3.safetensors"), b"h3").unwrap();
        assert!(unverified.verify_in(Some(&root)).is_err());
        assert!(plan_cli(&dir, std::slice::from_ref(&remote), "u2.json").is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn frames_resolve_from_a_fractional_rate_and_cli_round_trips() {
        let dir = std::env::temp_dir().join(format!("vpr-win-{}", std::process::id()));
        fs::create_dir_all(dir.join("models")).unwrap();
        fs::write(dir.join("models/m.safetensors"), b"weights").unwrap();
        let model_hash = sha256_file(&dir.join("models/m.safetensors")).unwrap();
        let common = |extra: &[&str]| -> Vec<OsString> {
            let mut v: Vec<String> = ["--root", dir.to_str().unwrap()].map(String::from).into();
            v.push("plan".into());
            v.extend(extra.iter().map(|s| s.to_string()));
            for (flag, value) in [
                ("--input-sha256", hex('1')),
                ("--prompt-sha256", hex('2')),
                ("--settings-sha256", hex('3')),
            ] {
                v.push(flag.into());
                v.push(value);
            }
            v.extend([
                "--model".into(),
                format!("models/m.safetensors={model_hash}"),
            ]);
            v.into_iter().map(Into::into).collect()
        };
        let mut a = common(&[
            "--profile",
            "h3",
            "--rate",
            "24000/1001",
            "--seconds",
            "5005/1000",
            "--max-window",
            "90",
            "--history",
            "18",
            "--out",
            "p1.json",
        ]);
        run(std::mem::take(&mut a)).unwrap();
        let p1: Plan = serde_json::from_slice(&fs::read(dir.join("p1.json")).unwrap()).unwrap();
        assert_eq!(p1.request.total_frames, 120);
        p1.verify().unwrap();
        run(common(&[
            "--profile",
            "h3",
            "--frames",
            "120",
            "--max-window",
            "90",
            "--history",
            "18",
            "--reroll",
            "1=9",
            "--out",
            "p2.json",
        ]))
        .unwrap();
        let args: Vec<OsString> = [
            "--root",
            dir.to_str().unwrap(),
            "diff",
            "p1.json",
            "p2.json",
            "--out",
            "d.json",
        ]
        .map(Into::into)
        .into();
        run(args).unwrap();
        let d: Value = serde_json::from_slice(&fs::read(dir.join("d.json")).unwrap()).unwrap();
        assert_eq!(d["schema"], DIFF_SCHEMA);
        assert_eq!(d["allow"], json!(["90..120"]));
        assert!(
            run(common(&[
                "--profile",
                "h3",
                "--frames",
                "10",
                "--max-window",
                "21",
                "--history",
                "17"
            ]))
            .is_err()
        );
        assert!(run(vec!["--help".into()]).is_ok());
        fs::remove_dir_all(dir).unwrap();
    }
}
