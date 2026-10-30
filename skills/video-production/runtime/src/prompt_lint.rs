//! Static lint of film and performance plans before any GPU spend.
//!
//! The linter reads the plans the other tools already consume (`film-bake/2`,
//! `performance-plan/2`, the scene plan) and reports defects that would only
//! show up after an expensive render: reference assets that are declared but
//! unused, duplicated, missing or outside the production root, a start image
//! that nothing wires in, takes longer than the model's cap, too many
//! references, and (from an optional annotations file) look text that
//! contradicts the cast card, emotion jumps and continuity carried across a
//! scene or location change.
//!
//! Rules, severities and thresholds are configuration ([`Config`]); the
//! built-in threshold set is `calibrated: false`, so a clean run is only a
//! *provisional* pass and must not back acceptance.
//!
//! Our schemas have no concept of emotion intensity, cast look cards or
//! scene/location, so those rules read a small separate
//! `prompt-lint-annotations/1` file ([`Annotations`]); film-bake's schema is
//! unchanged and the rules are skipped (and listed as skipped) without it.
//!
//! The rule shapes (reference budget, continuity across a change, emotion
//! jump, cast-look text) are adapted from Kinoloom's `tool/prompt_check.py`
//! and `tool/linter.py` (MIT); the checks themselves are written against our
//! schemas.
use crate::{clock::RationalRate, comfy::sha256_hex, paths::Root};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::PathBuf,
};

/// How a finding is treated.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    /// Blocks: the binary exits non-zero.
    Error,
    /// Reported only.
    Warning,
    /// Rule disabled.
    Off,
}

/// Every rule: id, default severity, one-line description.
pub const RULES: &[(&str, Severity, &str)] = &[
    (
        "ref-unused",
        Severity::Warning,
        "declared asset no segment uses",
    ),
    (
        "ref-duplicate",
        Severity::Error,
        "same asset listed twice in one segment",
    ),
    (
        "ref-duplicate-content",
        Severity::Warning,
        "two asset ids with identical bytes in one segment",
    ),
    (
        "ref-unknown",
        Severity::Error,
        "reference names an asset that is not declared",
    ),
    (
        "ref-file-missing",
        Severity::Error,
        "asset file missing or outside the production root",
    ),
    (
        "ref-hash-mismatch",
        Severity::Error,
        "asset bytes differ from the declared sha256",
    ),
    (
        "ref-budget",
        Severity::Warning,
        "more references than the budget",
    ),
    (
        "start-unwired",
        Severity::Error,
        "start/continuation image declared but not wired",
    ),
    (
        "look-contradiction",
        Severity::Error,
        "prompt look text contradicts the cast card",
    ),
    (
        "look-missing",
        Severity::Warning,
        "prompt omits the cast card look text",
    ),
    (
        "emotion-jump",
        Severity::Warning,
        "emotion intensity jump between consecutive appearances",
    ),
    (
        "continuity-scene-change",
        Severity::Error,
        "continuous transition across a scene/location change",
    ),
    ("take-over-cap", Severity::Error, "take longer than the cap"),
    (
        "annotation-unknown",
        Severity::Error,
        "annotation names an unknown segment, actor or emotion",
    ),
];

/// Numeric limits used by the rules.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct Thresholds {
    /// Most references per segment before `ref-budget` fires.
    pub max_references: usize,
    /// Longest take, seconds.
    pub max_take_seconds: f64,
    /// Smallest intensity difference reported by `emotion-jump`.
    pub emotion_jump_min: i64,
    /// Emotion name to intensity (0 calm .. 5 rage).
    pub emotion_intensity: BTreeMap<String, i64>,
}

impl Default for Thresholds {
    fn default() -> Self {
        // Emotion table adapted from Kinoloom (MIT), tool/linter.py.
        let table: &[(&str, i64)] = &[
            ("calm", 0),
            ("serene", 0),
            ("relaxed", 0),
            ("peaceful", 0),
            ("neutral", 1),
            ("content", 1),
            ("composed", 1),
            ("curious", 1),
            ("sad", 2),
            ("melancholy", 2),
            ("somber", 2),
            ("worried", 2),
            ("concerned", 2),
            ("nervous", 3),
            ("anxious", 3),
            ("tense", 3),
            ("suspicious", 3),
            ("angry", 4),
            ("fearful", 4),
            ("frustrated", 4),
            ("defiant", 4),
            ("furious", 5),
            ("rage", 5),
            ("terrified", 5),
            ("horrified", 5),
        ];
        Self {
            max_references: 3,
            max_take_seconds: 10.0,
            emotion_jump_min: 3,
            emotion_intensity: table.iter().map(|(k, v)| ((*k).into(), *v)).collect(),
        }
    }
}

/// Lint configuration (`prompt-lint-config/1`).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    /// Must be `prompt-lint-config/1`.
    pub schema: String,
    /// Where the thresholds come from.
    pub provenance: String,
    /// False until the thresholds are measured; a pass is then provisional.
    pub calibrated: bool,
    /// Numeric limits.
    pub thresholds: Thresholds,
    /// Per-rule severity overrides (rule id to severity).
    pub severities: BTreeMap<String, Severity>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            schema: "prompt-lint-config/1".into(),
            provenance: "kinoloom-prompt-lint-uncalibrated".into(),
            calibrated: false,
            thresholds: Thresholds::default(),
            severities: BTreeMap::new(),
        }
    }
}

impl Config {
    /// Reject a wrong schema or an unknown rule id in `severities`.
    pub fn validate(&self) -> Result<(), String> {
        if self.schema != "prompt-lint-config/1" {
            return Err(format!("Unsupported config schema {}", self.schema));
        }
        for rule in self.severities.keys() {
            if !RULES.iter().any(|(id, ..)| id == rule) {
                return Err(format!("Unknown rule {rule} in config severities"));
            }
        }
        Ok(())
    }

    /// Effective severity of `rule`.
    pub fn severity(&self, rule: &str) -> Severity {
        self.severities.get(rule).copied().unwrap_or_else(|| {
            RULES
                .iter()
                .find(|(id, ..)| *id == rule)
                .map_or(Severity::Error, |r| r.1)
        })
    }
}

/// One cast reference card.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CastCard {
    /// Actor id as used in segment `actors`.
    pub actor: String,
    /// The look text prompts must repeat.
    pub look: String,
    /// Groups of mutually exclusive phrases (`["black hair","blonde hair"]`).
    #[serde(default)]
    pub exclusive_groups: Vec<Vec<String>>,
}

/// One emotion observation for an actor in a segment.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Appearance {
    /// Segment id.
    pub segment: String,
    /// Actor id.
    pub actor: String,
    /// Emotion name looked up in the config table.
    pub emotion: Option<String>,
    /// Explicit intensity; wins over `emotion`.
    pub intensity: Option<i64>,
}

/// Scene and location of a segment.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Place {
    /// Segment id.
    pub segment: String,
    /// Scene id.
    pub scene: Option<String>,
    /// Location id.
    pub location: Option<String>,
}

/// Optional lint-only inputs (`prompt-lint-annotations/1`).
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Annotations {
    /// Must be `prompt-lint-annotations/1` (empty for the default).
    pub schema: String,
    /// Cast look cards.
    pub cast: Vec<CastCard>,
    /// Emotion observations.
    pub appearances: Vec<Appearance>,
    /// Scene/location of segments.
    pub places: Vec<Place>,
}

/// One lint result.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Finding {
    /// Rule id from [`RULES`].
    pub rule: String,
    /// `error` or `warning`.
    pub severity: Severity,
    /// Where in the input (`segments[b].references[1]`).
    pub location: String,
    /// What is wrong.
    pub message: String,
}

#[derive(Deserialize)]
struct Asset {
    path: PathBuf,
    sha256: String,
}
#[derive(Deserialize)]
struct Clock {
    rate: RationalRate,
}
#[derive(Deserialize)]
struct Keyframe {
    asset: String,
    attention_mask_asset: Option<String>,
    model_frame: u32,
}
#[derive(Deserialize)]
struct Segment {
    id: String,
    frames: [u64; 2],
    transition: String,
    #[serde(default)]
    actors: Vec<String>,
    #[serde(default)]
    references: Vec<String>,
    #[serde(default)]
    anchor_prompt: Value,
    #[serde(default)]
    video_prompt: String,
    exact_art: Option<String>,
    firstlook_asset: Option<String>,
    reference_mode: Option<String>,
    reference_attention: Option<f64>,
    #[serde(default)]
    keyframes: Vec<Keyframe>,
}
#[derive(Deserialize)]
struct Film {
    clock: Clock,
    #[serde(default)]
    assets: BTreeMap<String, Asset>,
    segments: Vec<Segment>,
    bindings: Option<Asset>,
}

struct Sink<'a> {
    config: &'a Config,
    findings: Vec<Finding>,
}

impl Sink<'_> {
    fn add(&mut self, rule: &str, location: impl Into<String>, message: impl Into<String>) {
        let severity = self.config.severity(rule);
        if severity != Severity::Off {
            self.findings.push(Finding {
                rule: rule.into(),
                severity,
                location: location.into(),
                message: message.into(),
            });
        }
    }
}

/// Lower-case, punctuation-free, single-spaced text padded with spaces so a
/// phrase match respects word boundaries.
fn flat(text: &str) -> String {
    let words: String = text
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect();
    format!(
        " {} ",
        words.split_whitespace().collect::<Vec<_>>().join(" ")
    )
}

fn contains_phrase(flat_text: &str, phrase: &str) -> bool {
    let p = flat(phrase);
    !p.trim().is_empty() && flat_text.contains(&p)
}

/// Check a declared file exists inside the root and matches its hash.
fn check_file(sink: &mut Sink, root: &Root, asset: &Asset, location: &str) {
    let resolved = match root.rel(&asset.path) {
        Ok(rel) => root.dir().join(rel),
        Err(e) => {
            sink.add(
                "ref-file-missing",
                location,
                format!("outside the production root: {e}"),
            );
            return;
        }
    };
    match fs::canonicalize(&resolved) {
        Err(_) => sink.add(
            "ref-file-missing",
            location,
            format!("{} does not exist", asset.path.display()),
        ),
        Ok(real) if !real.starts_with(root.dir()) => sink.add(
            "ref-file-missing",
            location,
            format!(
                "{} resolves outside the production root",
                asset.path.display()
            ),
        ),
        Ok(real) => match fs::read(&real) {
            Ok(bytes) if sha256_hex(&bytes) != asset.sha256 => sink.add(
                "ref-hash-mismatch",
                location,
                format!("{} differs from its declared sha256", asset.path.display()),
            ),
            Ok(_) => {}
            Err(e) => sink.add("ref-file-missing", location, format!("unreadable: {e}")),
        },
    }
}

/// Lint a `film-bake/2` plan (and optional annotations).
///
/// `film` is the plan JSON; asset paths resolve against `root`. Returns the
/// findings plus the names of rules that could not run (no annotations).
pub fn lint_film(
    film: &Value,
    root: &Root,
    annotations: Option<&Annotations>,
    config: &Config,
) -> Result<(Vec<Finding>, Vec<String>), String> {
    let film: Film = serde_json::from_value(film.clone()).map_err(|e| format!("film plan: {e}"))?;
    let mut sink = Sink {
        config,
        findings: Vec::new(),
    };
    let mut skipped = Vec::new();
    let mut used: BTreeSet<&str> = BTreeSet::new();

    for (id, asset) in &film.assets {
        check_file(&mut sink, root, asset, &format!("assets.{id}"));
    }

    // Reference-guide nodes from the bindings map, if it can be read.
    let guide_nodes = film.bindings.as_ref().and_then(|b| {
        let real = root.dir().join(root.rel(&b.path).ok()?);
        let v: Value = serde_json::from_slice(&fs::read(real).ok()?).ok()?;
        Some(v["video"]["reference_guide_nodes"].as_array()?.len())
    });

    for s in &film.segments {
        let at = format!("segments[{}]", s.id);
        // Adapted from Kinoloom (MIT), tool/prompt_check.py: reference budget.
        if s.references.len() > config.thresholds.max_references {
            sink.add(
                "ref-budget",
                &at,
                format!(
                    "{} references; more than {} compete for attention",
                    s.references.len(),
                    config.thresholds.max_references
                ),
            );
        }
        let mut seen = BTreeSet::new();
        let mut seen_sha: BTreeMap<&str, &str> = BTreeMap::new();
        for (i, r) in s.references.iter().enumerate() {
            let loc = format!("{at}.references[{i}]");
            used.insert(r);
            if !seen.insert(r.as_str()) {
                sink.add("ref-duplicate", &loc, format!("{r} is listed twice"));
            }
            match film.assets.get(r) {
                None => sink.add("ref-unknown", &loc, format!("{r} is not a declared asset")),
                Some(a) => {
                    if let Some(first) = seen_sha.insert(&a.sha256, r)
                        && first != r
                    {
                        sink.add(
                            "ref-duplicate-content",
                            &loc,
                            format!("{r} has the same bytes as {first}"),
                        );
                    }
                }
            }
        }
        let mut extra: Vec<(&str, String)> = Vec::new();
        for (name, a) in [
            ("exact_art", &s.exact_art),
            ("firstlook_asset", &s.firstlook_asset),
        ] {
            if let Some(a) = a {
                extra.push((a, format!("{at}.{name}")));
            }
        }
        for (i, k) in s.keyframes.iter().enumerate() {
            extra.push((&k.asset, format!("{at}.keyframes[{i}].asset")));
            if let Some(m) = &k.attention_mask_asset {
                extra.push((m, format!("{at}.keyframes[{i}].attention_mask_asset")));
            }
        }
        for (a, loc) in extra {
            used.insert(a);
            if !film.assets.contains_key(a) {
                sink.add("ref-unknown", loc, format!("{a} is not a declared asset"));
            }
        }

        // Start / continuation image wiring.
        let declared = s.reference_mode.is_some() || s.reference_attention.is_some();
        if s.reference_mode.as_deref() == Some("indexed_start")
            && !s.keyframes.iter().any(|k| k.model_frame == 0)
        {
            sink.add(
                "start-unwired",
                &at,
                "reference_mode indexed_start but no keyframe at model_frame 0",
            );
        }
        if declared && s.references.is_empty() && s.keyframes.is_empty() {
            sink.add(
                "start-unwired",
                &at,
                "reference mode/attention declared but the segment has no references or keyframes",
            );
        }
        if (declared || !s.keyframes.is_empty()) && guide_nodes == Some(0) {
            sink.add(
                "start-unwired",
                &at,
                "bindings list no video.reference_guide_nodes to receive the reference or keyframes",
            );
        }

        // Take length (exact-art segments generate nothing).
        if s.exact_art.is_none() {
            let frames = s.frames[1].saturating_sub(s.frames[0]);
            if let Ok(d) = film.clock.rate.duration_of(frames) {
                let seconds = d.as_f64();
                if seconds > config.thresholds.max_take_seconds {
                    sink.add(
                        "take-over-cap",
                        &at,
                        format!(
                            "{seconds:.3} s exceeds the {} s cap",
                            config.thresholds.max_take_seconds
                        ),
                    );
                }
            }
        }
    }

    for id in film.assets.keys() {
        if !used.contains(id.as_str()) {
            sink.add(
                "ref-unused",
                format!("assets.{id}"),
                format!("{id} is declared but no segment uses it"),
            );
        }
    }

    match annotations {
        None => skipped.extend(
            [
                "look-contradiction",
                "look-missing",
                "emotion-jump",
                "continuity-scene-change",
            ]
            .map(String::from),
        ),
        Some(ann) => lint_annotations(&film, ann, &mut sink),
    }
    Ok((sink.findings, skipped))
}

fn lint_annotations(film: &Film, ann: &Annotations, sink: &mut Sink) {
    let order: BTreeMap<&str, usize> = film
        .segments
        .iter()
        .enumerate()
        .map(|(i, s)| (s.id.as_str(), i))
        .collect();

    // Look cards against segment prompt text.
    for s in &film.segments {
        let text = flat(&format!("{} {}", s.video_prompt, s.anchor_prompt));
        let cards: Vec<&CastCard> = ann
            .cast
            .iter()
            .filter(|c| s.actors.contains(&c.actor))
            .collect();
        let looks: Vec<String> = cards.iter().map(|c| flat(&c.look)).collect();
        for card in &cards {
            let loc = format!("segments[{}].actors[{}]", s.id, card.actor);
            if !looks.is_empty() && !contains_phrase(&text, &card.look) {
                sink.add(
                    "look-missing",
                    &loc,
                    format!("prompt does not repeat the look \"{}\"", card.look),
                );
            }
            let mine = flat(&card.look);
            for group in &card.exclusive_groups {
                let has_card_member = group.iter().any(|m| contains_phrase(&mine, m));
                if !has_card_member {
                    continue;
                }
                for member in group {
                    // A phrase another cast member in this segment legitimately
                    // carries is not a contradiction of this card.
                    let belongs_to_other = looks.iter().any(|l| contains_phrase(l, member));
                    if contains_phrase(&text, member)
                        && !contains_phrase(&mine, member)
                        && !belongs_to_other
                    {
                        sink.add(
                            "look-contradiction",
                            &loc,
                            format!(
                                "prompt says \"{member}\" but the card look is \"{}\"",
                                card.look
                            ),
                        );
                    }
                }
            }
        }
    }

    // Emotion intensity jumps between consecutive appearances.
    // Adapted from Kinoloom (MIT), tool/linter.py `_lint_emotion_jumps`.
    let actors: BTreeSet<&str> = film
        .segments
        .iter()
        .flat_map(|s| s.actors.iter().map(String::as_str))
        .collect();
    let mut by_actor: BTreeMap<&str, Vec<(usize, &str, i64)>> = BTreeMap::new();
    for (i, a) in ann.appearances.iter().enumerate() {
        let loc = format!("appearances[{i}]");
        let Some(&pos) = order.get(a.segment.as_str()) else {
            sink.add(
                "annotation-unknown",
                &loc,
                format!("unknown segment {}", a.segment),
            );
            continue;
        };
        if !actors.contains(a.actor.as_str()) {
            sink.add(
                "annotation-unknown",
                &loc,
                format!("unknown actor {}", a.actor),
            );
            continue;
        }
        let level = a.intensity.or_else(|| {
            a.emotion.as_ref().and_then(|e| {
                sink.config
                    .thresholds
                    .emotion_intensity
                    .get(&e.to_lowercase())
                    .copied()
            })
        });
        match level {
            Some(l) => {
                by_actor
                    .entry(a.actor.as_str())
                    .or_default()
                    .push((pos, a.segment.as_str(), l))
            }
            None => sink.add(
                "annotation-unknown",
                &loc,
                format!("emotion {:?} has no intensity", a.emotion),
            ),
        }
    }
    for (actor, mut list) in by_actor {
        list.sort_by_key(|e| e.0);
        for pair in list.windows(2) {
            let jump = (pair[1].2 - pair[0].2).abs();
            if jump >= sink.config.thresholds.emotion_jump_min {
                sink.add(
                    "emotion-jump",
                    format!("segments[{}]", pair[1].1),
                    format!(
                        "{actor} intensity {} -> {} (jump {jump}) between {} and {}",
                        pair[0].2, pair[1].2, pair[0].1, pair[1].1
                    ),
                );
            }
        }
    }

    // Continuity carried across a scene or location change.
    // Adapted from Kinoloom (MIT), tool/linter.py `_lint_continuity_order`.
    let place: BTreeMap<&str, &Place> =
        ann.places.iter().map(|p| (p.segment.as_str(), p)).collect();
    for p in &ann.places {
        if !order.contains_key(p.segment.as_str()) {
            sink.add(
                "annotation-unknown",
                "places",
                format!("unknown segment {}", p.segment),
            );
        }
    }
    for pair in film.segments.windows(2) {
        if pair[1].transition != "continuous" {
            continue;
        }
        let (Some(a), Some(b)) = (
            place.get(pair[0].id.as_str()),
            place.get(pair[1].id.as_str()),
        ) else {
            continue;
        };
        for (kind, x, y) in [
            ("scene", &a.scene, &b.scene),
            ("location", &a.location, &b.location),
        ] {
            if let (Some(x), Some(y)) = (x, y)
                && x != y
            {
                sink.add(
                    "continuity-scene-change",
                    format!("segments[{}]", pair[1].id),
                    format!("continuous transition across a {kind} change ({x} -> {y})"),
                );
            }
        }
    }
}

/// Lint a `performance-plan/2` against its scene plan: source files and the
/// per-beat take length.
pub fn lint_performance(
    plan: &Value,
    scene: Option<&Value>,
    root: &Root,
    config: &Config,
) -> Result<(Vec<Finding>, Vec<String>), String> {
    let beats = plan["beats"]
        .as_array()
        .ok_or("performance plan has no beats")?;
    let mut sink = Sink {
        config,
        findings: Vec::new(),
    };
    let mut skipped = Vec::new();
    for beat in beats {
        let id = beat["beat_id"].as_str().unwrap_or("?");
        let source: Asset = serde_json::from_value(json!({
            "path": beat["source"]["path"], "sha256": beat["source"]["sha256"]
        }))
        .map_err(|e| format!("beat {id} source: {e}"))?;
        check_file(&mut sink, root, &source, &format!("beats[{id}].source"));
    }
    match scene {
        None => skipped.push("take-over-cap (performance: no --scene)".into()),
        Some(scene) => {
            let rate: RationalRate = serde_json::from_value(scene["delivery"]["fps"].clone())
                .map_err(|_| "scene has no positive frame rate")?;
            for beat in beats {
                let id = beat["beat_id"].as_str().unwrap_or("?");
                let Some(track) = scene["timeline"]
                    .as_array()
                    .and_then(|t| t.iter().find(|t| t["beat_id"].as_str() == Some(id)))
                else {
                    sink.add(
                        "annotation-unknown",
                        format!("beats[{id}]"),
                        "beat is not in the scene timeline",
                    );
                    continue;
                };
                let (Some(a), Some(b)) = (track["frames"][0].as_u64(), track["frames"][1].as_u64())
                else {
                    continue;
                };
                if let Ok(d) = rate.duration_of(b.saturating_sub(a)) {
                    let seconds = d.as_f64();
                    if seconds > config.thresholds.max_take_seconds {
                        sink.add(
                            "take-over-cap",
                            format!("beats[{id}]"),
                            format!(
                                "{seconds:.3} s exceeds the {} s cap",
                                config.thresholds.max_take_seconds
                            ),
                        );
                    }
                }
            }
        }
    }
    Ok((sink.findings, skipped))
}

/// Assemble the JSON receipt. `inputs` maps a role to `{path, sha256}`.
pub fn receipt(config: &Config, inputs: Value, findings: &[Finding], skipped: &[String]) -> Value {
    let errors = findings
        .iter()
        .filter(|f| f.severity == Severity::Error)
        .count();
    let warnings = findings.len() - errors;
    let verdict = if errors > 0 { "FAIL" } else { "PASS" };
    json!({
        "schema": "prompt-lint/1",
        "verdict": verdict,
        // An uncalibrated threshold set can never back acceptance.
        "provisional": verdict == "PASS" && !config.calibrated,
        "errors": errors,
        "warnings": warnings,
        "inputs": inputs,
        "config": config,
        "rules": RULES.iter().map(|(id, sev, what)| json!({
            "id": id, "severity": config.severity(id), "default": sev, "checks": what
        })).collect::<Vec<_>>(),
        "skipped_rules": skipped,
        "findings": findings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::testutil::Scratch;

    struct Fixture {
        dir: Scratch,
        root: Root,
    }
    fn fixture() -> Fixture {
        let dir = Scratch::new("prompt-lint");
        for f in ["a.png", "b.png", "c.png", "d.png"] {
            fs::write(dir.path(f), f).unwrap();
        }
        let root = Root::new(&dir.0).unwrap();
        Fixture { dir, root }
    }
    fn asset(name: &str) -> Value {
        json!({"path": name, "sha256": sha256_hex(name.as_bytes())})
    }
    fn seg(id: &str, frames: [u64; 2], extra: Value) -> Value {
        let mut s = json!({"id":id,"frames":frames,"transition":"start","actors":[],
            "references":[],"anchor_prompt":{},"video_prompt":"a shape moves"});
        for (k, v) in extra.as_object().unwrap() {
            s[k] = v.clone();
        }
        s
    }
    fn film(assets: Value, segments: Vec<Value>) -> Value {
        json!({"clock":{"rate":25},"assets":assets,"segments":segments})
    }
    fn run(f: &Fixture, film: &Value, ann: Option<&Annotations>, cfg: &Config) -> Vec<String> {
        let (found, _) = lint_film(film, &f.root, ann, cfg).unwrap();
        found
            .iter()
            .map(|x| format!("{}@{}", x.rule, x.location))
            .collect()
    }
    fn fires(found: &[String], rule: &str) -> bool {
        found.iter().any(|f| f.starts_with(&format!("{rule}@")))
    }
    fn four_assets() -> Value {
        json!({"a":asset("a.png"),"b":asset("b.png"),"c":asset("c.png"),"d":asset("d.png")})
    }
    fn ann(v: Value) -> Annotations {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn unused_asset_fires_and_used_does_not() {
        let f = fixture();
        let cfg = Config::default();
        let a = json!({"a":asset("a.png"),"b":asset("b.png")});
        let found = run(
            &f,
            &film(
                a.clone(),
                vec![seg("s", [0, 50], json!({"references":["a"]}))],
            ),
            None,
            &cfg,
        );
        assert!(
            found.contains(&"ref-unused@assets.b".to_string()),
            "{found:?}"
        );
        let found = run(
            &f,
            &film(a, vec![seg("s", [0, 50], json!({"references":["a","b"]}))]),
            None,
            &cfg,
        );
        assert!(!fires(&found, "ref-unused"), "{found:?}");
    }

    #[test]
    fn duplicate_and_unknown_references() {
        let f = fixture();
        let cfg = Config::default();
        let a = json!({"a":asset("a.png")});
        let found = run(
            &f,
            &film(
                a.clone(),
                vec![seg("s", [0, 50], json!({"references":["a","a","zz"]}))],
            ),
            None,
            &cfg,
        );
        assert!(found.contains(&"ref-duplicate@segments[s].references[1]".to_string()));
        assert!(found.contains(&"ref-unknown@segments[s].references[2]".to_string()));
        let found = run(
            &f,
            &film(a, vec![seg("s", [0, 50], json!({"references":["a"]}))]),
            None,
            &cfg,
        );
        assert!(!fires(&found, "ref-duplicate") && !fires(&found, "ref-unknown"));
    }

    #[test]
    fn identical_bytes_under_two_ids_warn() {
        let f = fixture();
        let a = json!({"a":asset("a.png"),"a2":asset("a.png"),"b":asset("b.png")});
        let cfg = Config::default();
        let found = run(
            &f,
            &film(
                a.clone(),
                vec![seg("s", [0, 50], json!({"references":["a","a2"]}))],
            ),
            None,
            &cfg,
        );
        assert!(fires(&found, "ref-duplicate-content"), "{found:?}");
        let found = run(
            &f,
            &film(a, vec![seg("s", [0, 50], json!({"references":["a","b"]}))]),
            None,
            &cfg,
        );
        assert!(!fires(&found, "ref-duplicate-content"));
    }

    #[test]
    fn missing_outside_and_changed_files() {
        let f = fixture();
        let cfg = Config::default();
        let bad = json!({"gone":asset("gone.png"),"up":asset("../escape.png"),
            "abs":{"path":"/etc/passwd","sha256":"x"},
            "chg":{"path":"a.png","sha256":"00"},"ok":asset("b.png")});
        let found = run(
            &f,
            &film(bad, vec![seg("s", [0, 50], json!({"references":["ok"]}))]),
            None,
            &cfg,
        );
        for id in ["gone", "up", "abs"] {
            assert!(
                found.contains(&format!("ref-file-missing@assets.{id}")),
                "{id}: {found:?}"
            );
        }
        assert!(found.contains(&"ref-hash-mismatch@assets.chg".to_string()));
        assert!(
            !found
                .iter()
                .any(|x| x.ends_with("assets.ok") && !x.starts_with("ref-unused"))
        );
        // A symlink pointing out of the root is outside too.
        let outside = Scratch::new("prompt-lint-out");
        fs::write(outside.path("x.png"), "x").unwrap();
        std::os::unix::fs::symlink(outside.path("x.png"), f.dir.path("link.png")).unwrap();
        let found = run(
            &f,
            &film(
                json!({"l":asset("link.png")}),
                vec![seg("s", [0, 50], json!({"references":["l"]}))],
            ),
            None,
            &cfg,
        );
        assert!(fires(&found, "ref-file-missing"), "{found:?}");
    }

    #[test]
    fn reference_budget_follows_config() {
        let f = fixture();
        let segs = vec![seg("s", [0, 50], json!({"references":["a","b","c","d"]}))];
        let found = run(
            &f,
            &film(four_assets(), segs.clone()),
            None,
            &Config::default(),
        );
        assert!(fires(&found, "ref-budget"));
        let mut cfg = Config::default();
        cfg.thresholds.max_references = 4;
        assert!(!fires(
            &run(&f, &film(four_assets(), segs.clone()), None, &cfg),
            "ref-budget"
        ));
        let cfg: Config =
            serde_json::from_value(json!({"severities":{"ref-budget":"off"}})).unwrap();
        assert!(!fires(
            &run(&f, &film(four_assets(), segs), None, &cfg),
            "ref-budget"
        ));
    }

    #[test]
    fn start_image_must_be_wired() {
        let f = fixture();
        let cfg = Config::default();
        let a = json!({"a":asset("a.png")});
        let kf = |frame: u32| json!([{"asset":"a","model_frame":frame}]);
        let bad = film(
            a.clone(),
            vec![seg(
                "s",
                [0, 50],
                json!({"reference_mode":"indexed_start","keyframes":kf(8)}),
            )],
        );
        assert!(fires(&run(&f, &bad, None, &cfg), "start-unwired"));
        let empty = film(
            a.clone(),
            vec![seg(
                "s",
                [0, 50],
                json!({"reference_attention":0.5,"references":[]}),
            )],
        );
        assert!(fires(&run(&f, &empty, None, &cfg), "start-unwired"));
        let ok = film(
            a.clone(),
            vec![seg(
                "s",
                [0, 50],
                json!({"reference_mode":"indexed_start","keyframes":kf(0)}),
            )],
        );
        assert!(!fires(&run(&f, &ok, None, &cfg), "start-unwired"));
        // Bindings without reference guide nodes cannot receive keyframes.
        fs::write(
            f.dir.path("bind.json"),
            r#"{"video":{"reference_guide_nodes":[]}}"#,
        )
        .unwrap();
        let mut with_bind = ok.clone();
        with_bind["bindings"] = asset_of(&f, "bind.json");
        assert!(fires(&run(&f, &with_bind, None, &cfg), "start-unwired"));
        fs::write(
            f.dir.path("bind.json"),
            r#"{"video":{"reference_guide_nodes":["n"]}}"#,
        )
        .unwrap();
        with_bind["bindings"] = asset_of(&f, "bind.json");
        assert!(!fires(&run(&f, &with_bind, None, &cfg), "start-unwired"));
    }
    fn asset_of(f: &Fixture, name: &str) -> Value {
        json!({"path":name,"sha256":sha256_hex(&fs::read(f.dir.path(name)).unwrap())})
    }

    #[test]
    fn take_over_cap_uses_exact_rate() {
        let f = fixture();
        let a = json!({});
        // 251 frames at 25 fps is 10.04 s; 250 is exactly the cap.
        let found = run(
            &f,
            &film(a.clone(), vec![seg("s", [0, 251], json!({}))]),
            None,
            &Config::default(),
        );
        assert!(fires(&found, "take-over-cap"));
        let found = run(
            &f,
            &film(a.clone(), vec![seg("s", [0, 250], json!({}))]),
            None,
            &Config::default(),
        );
        assert!(!fires(&found, "take-over-cap"));
        // Exact artwork generates nothing, so no take cap.
        let art = film(
            json!({"x":asset("a.png")}),
            vec![seg("s", [0, 900], json!({"exact_art":"x"}))],
        );
        assert!(!fires(
            &run(&f, &art, None, &Config::default()),
            "take-over-cap"
        ));
    }

    fn cast() -> Value {
        json!({"cast":[{"actor":"mara","look":"short black hair, green coat",
            "exclusive_groups":[["black hair","blonde hair","red hair"],["green coat","red coat"]]}]})
    }

    #[test]
    fn look_contradiction_and_missing() {
        let f = fixture();
        let cfg = Config::default();
        let ann1 = ann(cast());
        let run_prompt = |p: &str| {
            run(
                &f,
                &film(
                    json!({}),
                    vec![seg(
                        "s",
                        [0, 50],
                        json!({"actors":["mara"],"video_prompt":p}),
                    )],
                ),
                Some(&ann1),
                &cfg,
            )
        };
        let found = run_prompt("Mara, short black hair, green coat, walks.");
        assert!(
            !fires(&found, "look-contradiction") && !fires(&found, "look-missing"),
            "{found:?}"
        );
        let found = run_prompt("Mara with blonde hair in a green coat walks.");
        assert!(fires(&found, "look-contradiction"), "{found:?}");
        assert!(fires(&found, "look-missing"));
        // Contradiction also found in the structured anchor prompt.
        let anchor = run(
            &f,
            &film(
                json!({}),
                vec![seg(
                    "s",
                    [0, 50],
                    json!({"actors":["mara"],"anchor_prompt":{"subject":"red coat"}}),
                )],
            ),
            Some(&ann1),
            &cfg,
        );
        assert!(fires(&anchor, "look-contradiction"), "{anchor:?}");
        // Another cast member legitimately carries the other phrase.
        let two = ann(json!({"cast":[cast()["cast"][0].clone(),
            {"actor":"ivo","look":"blonde hair, grey suit"}]}));
        let found = run(
            &f,
            &film(
                json!({}),
                vec![seg(
                    "s",
                    [0, 50],
                    json!({"actors":["mara","ivo"],
            "video_prompt":"Mara, short black hair, green coat; Ivo, blonde hair, grey suit"}),
                )],
            ),
            Some(&two),
            &cfg,
        );
        assert!(!fires(&found, "look-contradiction"), "{found:?}");
    }

    #[test]
    fn emotion_jump_needs_three_steps() {
        let f = fixture();
        let cfg = Config::default();
        let segs = vec![
            seg("a", [0, 50], json!({"actors":["mara"]})),
            seg(
                "b",
                [50, 100],
                json!({"actors":["mara"],"transition":"continuous"}),
            ),
            seg(
                "c",
                [100, 150],
                json!({"actors":["mara"],"transition":"continuous"}),
            ),
        ];
        let film = film(json!({}), segs);
        let jump = ann(json!({"appearances":[
            {"segment":"a","actor":"mara","emotion":"calm"},
            {"segment":"b","actor":"mara","emotion":"nervous"}]}));
        let found = run(&f, &film, Some(&jump), &cfg);
        assert!(
            found.contains(&"emotion-jump@segments[b]".to_string()),
            "{found:?}"
        );
        let small = ann(json!({"appearances":[
            {"segment":"a","actor":"mara","emotion":"calm"},
            {"segment":"b","actor":"mara","intensity":2},
            {"segment":"c","actor":"mara","emotion":"angry"}]}));
        assert!(!fires(&run(&f, &film, Some(&small), &cfg), "emotion-jump"));
        // Typos are reported, never silently skipped.
        let bad = ann(
            json!({"appearances":[{"segment":"zz","actor":"mara","intensity":1},
            {"segment":"a","actor":"mara","emotion":"gleeful"}]}),
        );
        let found = run(&f, &film, Some(&bad), &cfg);
        assert_eq!(
            found
                .iter()
                .filter(|x| x.starts_with("annotation-unknown"))
                .count(),
            2
        );
    }

    #[test]
    fn continuity_across_scene_or_location_change() {
        let f = fixture();
        let cfg = Config::default();
        let build = |t: &str| {
            film(
                json!({}),
                vec![
                    seg("a", [0, 50], json!({})),
                    seg("b", [50, 100], json!({"transition":t})),
                ],
            )
        };
        let moved = ann(
            json!({"places":[{"segment":"a","scene":"s1","location":"kitchen"},
            {"segment":"b","scene":"s1","location":"garden"}]}),
        );
        assert!(fires(
            &run(&f, &build("continuous"), Some(&moved), &cfg),
            "continuity-scene-change"
        ));
        // A declared cut is the right way to change place.
        assert!(!fires(
            &run(&f, &build("camera_cut"), Some(&moved), &cfg),
            "continuity-scene-change"
        ));
        let same = ann(
            json!({"places":[{"segment":"a","scene":"s1","location":"kitchen"},
            {"segment":"b","scene":"s1","location":"kitchen"}]}),
        );
        assert!(!fires(
            &run(&f, &build("continuous"), Some(&same), &cfg),
            "continuity-scene-change"
        ));
    }

    #[test]
    fn annotation_rules_are_reported_skipped_without_annotations() {
        let f = fixture();
        let (_, skipped) = lint_film(
            &film(json!({}), vec![seg("s", [0, 50], json!({}))]),
            &f.root,
            None,
            &Config::default(),
        )
        .unwrap();
        assert!(skipped.contains(&"emotion-jump".to_string()));
    }

    #[test]
    fn performance_source_and_take_cap() {
        let f = fixture();
        let cfg = Config::default();
        let plan = |path: &str, frames: u64| {
            let _ = frames;
            json!({"beats":[{"beat_id":"B1","source":{"path":path,"sha256":sha256_hex(b"a.png"),"asset_id":"x"}}]})
        };
        let scene = |end: u64| json!({"delivery":{"fps":25,"frames":900},"timeline":[{"beat_id":"B1","frames":[0,end]}]});
        let (found, _) =
            lint_performance(&plan("a.png", 0), Some(&scene(100)), &f.root, &cfg).unwrap();
        assert!(found.is_empty(), "{found:?}");
        let (found, _) =
            lint_performance(&plan("a.png", 0), Some(&scene(300)), &f.root, &cfg).unwrap();
        assert_eq!(found[0].rule, "take-over-cap");
        let (found, _) =
            lint_performance(&plan("nope.png", 0), Some(&scene(100)), &f.root, &cfg).unwrap();
        assert_eq!(found[0].rule, "ref-file-missing");
        let (_, skipped) = lint_performance(&plan("a.png", 0), None, &f.root, &cfg).unwrap();
        assert_eq!(skipped.len(), 1);
    }

    #[test]
    fn verdict_is_provisional_until_calibrated_and_fails_on_errors() {
        let cfg = Config::default();
        let ok = receipt(&cfg, json!({}), &[], &[]);
        assert_eq!(
            (ok["verdict"].as_str(), ok["provisional"].as_bool()),
            (Some("PASS"), Some(true))
        );
        let mut calibrated = cfg.clone();
        calibrated.calibrated = true;
        assert_eq!(
            receipt(&calibrated, json!({}), &[], &[])["provisional"],
            json!(false)
        );
        let warn = Finding {
            rule: "ref-unused".into(),
            severity: Severity::Warning,
            location: "x".into(),
            message: "m".into(),
        };
        assert_eq!(
            receipt(&cfg, json!({}), std::slice::from_ref(&warn), &[])["verdict"],
            "PASS"
        );
        let err = Finding {
            severity: Severity::Error,
            ..warn
        };
        let r = receipt(&cfg, json!({}), &[err], &[]);
        assert_eq!(
            (r["verdict"].as_str(), r["provisional"].as_bool()),
            (Some("FAIL"), Some(false))
        );
    }

    #[test]
    fn config_rejects_unknown_rules_schema_and_fields() {
        let bad: Config =
            serde_json::from_value(json!({"severities":{"nonsense":"error"}})).unwrap();
        assert!(bad.validate().is_err());
        let bad: Config = serde_json::from_value(json!({"schema":"x"})).unwrap();
        assert!(bad.validate().is_err());
        assert!(serde_json::from_value::<Config>(json!({"thresholds":{"max_refs":1}})).is_err());
        assert!(Config::default().validate().is_ok());
    }
}
