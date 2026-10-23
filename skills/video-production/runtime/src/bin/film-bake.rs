//! Prepare, compile and assemble a whole-film generative rehearsal.
//!
//! GPU execution stays in an external durable ComfyUI batch runner. This tool
//! verifies one native world and every source frame, exports padded guides,
//! builds reference-aware anchor/video graphs, and assembles only completed,
//! hash-verified outputs.
//!
//! Usage: `film-bake [--root DIR] prepare|videos|assemble PLAN WORKDIR [COMFY_URL]`.
//! The production root is `--root`, else `$BLENDER_SHARE`, else the current
//! directory; every other path is relative to it and every receipt records
//! root-relative paths only. The plan declares the clock, resolution and a
//! hashed workflow-binding map; see the README for the schemas.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    error::Error,
    ffi::OsString,
    fs, io,
    path::{Path, PathBuf},
    process::Command,
};
use video_production_runtime::{
    clock::{
        DurationPolicy, FrameInterval, Priority, RationalRate, RationalSeconds, Rounding,
        rate_from_receipt,
    },
    comfy::{self, sha256_hex},
    paths::{Root, take_root_option},
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Asset {
    path: PathBuf,
    sha256: String,
}
/// Delivery clock: a rate plus enough to derive an integral frame count.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClockSpec {
    rate: RationalRate,
    duration_s: Option<RationalSeconds>,
    frames: Option<u64>,
    /// Defaults to exact rounding, no tolerated error, and duration priority
    /// when a duration is given (frame-count priority otherwise).
    policy: Option<DurationPolicy>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Resolution {
    width: u32,
    height: u32,
    /// Optional `W:H` declaration, checked against the resolution.
    aspect: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Film {
    schema: String,
    id: String,
    clock: ClockSpec,
    resolution: Resolution,
    negative_prompt: String,
    /// Hashed workflow-binding map, so the plan hash covers it.
    bindings: Asset,
    native_scene: Asset,
    /// Optional delivery-index to native-world-frame mapping. Never rewrites
    /// the original render receipt or implies a new physical simulation.
    native_frame_map: Option<Asset>,
    scene_plan: Asset,
    render_directory: PathBuf,
    anchor_template: Asset,
    video_template: Asset,
    assets: BTreeMap<String, Asset>,
    segments: Vec<Segment>,
    status: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Segment {
    id: String,
    frames: [u32; 2],
    source_frames: [u32; 2],
    beat_ids: Vec<String>,
    actors: Vec<String>,
    transition: String,
    transition_reason: String,
    references: Vec<String>,
    anchor_prompt: Value,
    video_prompt: String,
    exact_art: Option<String>,
    firstlook_asset: Option<String>,
    reference_mode: Option<ReferenceMode>,
    reference_attention: Option<f64>,
    layout_attention: Option<f64>,
    #[serde(default)]
    keyframes: Vec<Keyframe>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Keyframe {
    asset: String,
    attention_mask_asset: Option<String>,
    model_frame: u32,
    source_master_frame: u32,
    attention: f64,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ReferenceMode {
    AppearancePreclip,
    IndexedStart,
}
/// Workflow-binding map: which template node plays which role.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Bindings {
    schema: String,
    anchor: AnchorBindings,
    video: VideoBindings,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AnchorBindings {
    /// Template nodes deleted before compilation (unused branches).
    #[serde(default)]
    remove_nodes: Vec<String>,
    /// `LoadImage` node receiving the first guide frame.
    guide_image_node: String,
    /// Node whose `pixels` input is rewired to the scaled guide.
    guide_scale_target: String,
    /// Text node receiving the anchor prompt.
    prompt_node: String,
    /// First conditioning nodes that reference latents chain from.
    positive_start: String,
    negative_start: String,
    /// VAE loader used to encode reference images.
    vae_node: String,
    /// Node whose `positive`/`negative` take the end of the chains.
    conditioning_node: String,
    /// `SaveImage`-style node: its `filename_prefix` is set and it is the
    /// output node read back from the batch runner's receipt.
    output_node: String,
    #[serde(default = "default_reference_megapixels")]
    reference_megapixels: f64,
}
fn default_reference_megapixels() -> f64 {
    0.25
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct VideoBindings {
    /// Node whose `file` input is the uploaded guide video.
    guide_video_node: String,
    /// Node whose `image` input is the uploaded anchor.
    anchor_image_node: String,
    positive_prompt_node: String,
    negative_prompt_node: String,
    /// Node whose `filename_prefix` is set; its output is the video.
    output_node: String,
    /// IC-LoRA layout-guide nodes, one per sampling stage.
    #[serde(default)]
    layout_guide_nodes: Vec<String>,
    /// IC-LoRA reference-guide nodes, one per sampling stage; keyframes chain
    /// from the tail of each.
    #[serde(default)]
    reference_guide_nodes: Vec<String>,
    /// Model clips must have `multiple * k + 1` frames; delivery is padded.
    #[serde(default = "default_frame_multiple")]
    frame_multiple: u32,
}
fn default_frame_multiple() -> u32 {
    8
}
#[derive(Serialize, Deserialize)]
struct Prepared {
    plan_sha256: String,
    url: String,
    assets: BTreeMap<String, Value>,
    guides: BTreeMap<String, Value>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeFrameMap {
    schema: String,
    source_scene_sha256: String,
    rate: RationalRate,
    source_frames: Vec<u32>,
    reason: String,
    physics_timing_status: String,
}
/// A verified completed output: its location and the digest already checked.
struct Media {
    path: PathBuf,
    sha256: String,
}
fn validate_native_map(
    map: &NativeFrameMap,
    frames: u32,
    world: &str,
    rate: RationalRate,
) -> Result<()> {
    if map.schema != "native-frame-map/2"
        || map.source_scene_sha256 != world
        || map.rate != rate
        || frames == 0
        || map.source_frames.len() != frames as usize
        || map.source_frames.first() != Some(&0)
        || map.source_frames.last() != Some(&(frames - 1))
        || map.source_frames.iter().any(|&n| n >= frames)
        || map.source_frames.windows(2).any(|pair| pair[1] < pair[0])
        || map.reason.trim().is_empty()
        || map.physics_timing_status != "editorial_retime_requires_physics_revalidation"
    {
        return Err(fail(
            "Invalid native frame map: require matching world, complete monotonic clock and explicit physics revalidation status",
        ));
    }
    Ok(())
}
/// Resolve the integral delivery frame count from the declared clock.
fn film_frames(film: &Film) -> Result<u32> {
    let spec = &film.clock;
    let policy = spec.policy.unwrap_or(DurationPolicy {
        priority: if spec.duration_s.is_some() {
            Priority::Duration
        } else {
            Priority::FrameCount
        },
        rounding: Rounding::Exact,
        allowed_error: RationalSeconds::whole(0),
    });
    let resolved = policy.resolve(spec.rate, spec.duration_s, spec.frames)?;
    if resolved.frames == 0 {
        return Err(fail("Film has no frames"));
    }
    Ok(u32::try_from(resolved.frames)?)
}
fn native_indices(film: &Film, frames: u32) -> Result<Vec<u32>> {
    match &film.native_frame_map {
        None => Ok((0..frames).collect()),
        Some(asset) => {
            checked_asset(asset)?;
            let map: NativeFrameMap = serde_json::from_slice(&fs::read(&asset.path)?)?;
            validate_native_map(&map, frames, &film.native_scene.sha256, film.clock.rate)?;
            Ok(map.source_frames)
        }
    }
}
fn fail(s: impl Into<String>) -> Box<dyn Error> {
    io::Error::other(s.into()).into()
}
fn read(path: &Path) -> Result<Value> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}
fn sha(path: &Path) -> Result<String> {
    Ok(sha256_hex(&fs::read(path)?))
}
fn checked_asset(a: &Asset) -> Result<()> {
    if sha(&a.path)? != a.sha256 {
        return Err(fail(format!("Changed input {}", a.path.display())));
    }
    Ok(())
}
fn save(path: &Path, value: &impl Serialize) -> Result<()> {
    use std::io::Write;
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    serde_json::to_writer_pretty(&mut f, value)?;
    f.write_all(b"\n")?;
    f.sync_all()?;
    Ok(())
}
fn call(c: &mut Command) -> Result<Vec<u8>> {
    let out = c.output()?;
    if !out.status.success() {
        return Err(fail(String::from_utf8_lossy(&out.stderr).into_owned()));
    }
    Ok(out.stdout)
}
fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
}
/// Smallest `multiple * k + 1` at or above `n` (models want that clip shape).
fn padded(n: u32, multiple: u32) -> u32 {
    n + (multiple - (n - 1) % multiple) % multiple
}
fn check_bindings_shape(b: &Bindings) -> Result<()> {
    if b.schema != "workflow-bindings/1" || b.video.frame_multiple == 0 {
        return Err(fail("Unsupported workflow-binding map"));
    }
    if b.video.layout_guide_nodes.len() != b.video.reference_guide_nodes.len() {
        return Err(fail(
            "Layout and reference guide nodes must be listed once per stage",
        ));
    }
    Ok(())
}
fn parse_aspect(text: &str) -> Option<(u32, u32)> {
    let (w, h) = text.split_once(':')?;
    Some((w.trim().parse().ok()?, h.trim().parse().ok()?))
}
/// Validate the plan and return its integral delivery frame count.
/// `multiple` is the model's clip-length quantum from the binding map.
fn validate(film: &Film, multiple: u32) -> Result<u32> {
    if film.schema != "film-bake/2" || !safe_id(&film.id) || film.status.trim().is_empty() {
        return Err(fail("Expected a named film-bake/2 plan with a status"));
    }
    let frames = film_frames(film)?;
    let res = &film.resolution;
    if res.width == 0
        || res.height == 0
        || !res.width.is_multiple_of(2)
        || !res.height.is_multiple_of(2)
    {
        return Err(fail("Resolution must be positive and even (yuv420p)"));
    }
    if let Some(text) = &res.aspect {
        let (w, h) = parse_aspect(text).ok_or("Aspect must be W:H")?;
        if u64::from(w) * u64::from(res.height) != u64::from(h) * u64::from(res.width) {
            return Err(fail(format!(
                "Declared aspect {text} does not match {}x{}",
                res.width, res.height
            )));
        }
    }
    let native_frames = native_indices(film, frames)?;
    let mut end = 0;
    let mut ids = BTreeSet::new();
    for s in &film.segments {
        if !safe_id(&s.id)
            || !ids.insert(&s.id)
            || s.frames[0] != end
            || s.frames[1] <= end
            || s.frames[1] > frames
        {
            return Err(fail(
                "Duplicate segment or non-contiguous delivery coverage",
            ));
        }
        if s.source_frames[1] <= s.source_frames[0]
            || s.source_frames[1] > frames
            || s.source_frames[1] - s.source_frames[0] != s.frames[1] - s.frames[0]
        {
            return Err(fail("Source interval length/range mismatch"));
        }
        if s.transition_reason.trim().is_empty()
            || ![
                "start",
                "continuous",
                "camera_cut",
                "montage",
                "magic",
                "graphic",
            ]
            .contains(&s.transition.as_str())
        {
            return Err(fail("Every transition needs an explicit kind and reason"));
        }
        if end > 0
            && s.source_frames[0] != end
            && !["montage", "magic", "graphic"].contains(&s.transition.as_str())
        {
            return Err(fail("Unrecorded story-time jump"));
        }
        if s.beat_ids.is_empty()
            || (s.exact_art.is_none()
                && (s.video_prompt.trim().is_empty() || !s.anchor_prompt.is_object()))
        {
            return Err(fail("Missing beat/prompt data"));
        }
        if s.exact_art.is_some() && s.firstlook_asset.is_some() {
            return Err(fail(
                "Exact artwork and generated first-look selection are exclusive",
            ));
        }
        if [s.reference_attention, s.layout_attention]
            .into_iter()
            .flatten()
            .any(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
        {
            return Err(fail(
                "IC-LoRA attention must be within the live API range 0..1",
            ));
        }
        let mut keyframe_positions = BTreeSet::new();
        for keyframe in &s.keyframes {
            let count = s.source_frames[1] - s.source_frames[0];
            if s.exact_art.is_some()
                || keyframe.model_frame >= padded(count, multiple)
                || keyframe.source_master_frame
                    != native_frames
                        [(s.source_frames[0] + keyframe.model_frame.min(count - 1)) as usize]
                || !keyframe_positions.insert(keyframe.model_frame)
                || !keyframe.attention.is_finite()
                || !(0.0..=1.0).contains(&keyframe.attention)
            {
                return Err(fail(
                    "Indexed keyframe has an invalid clock, duplicate position, attention or exact-art segment",
                ));
            }
        }
        for a in s
            .references
            .iter()
            .chain(s.exact_art.iter())
            .chain(s.firstlook_asset.iter())
            .chain(s.keyframes.iter().map(|keyframe| &keyframe.asset))
            .chain(
                s.keyframes
                    .iter()
                    .filter_map(|keyframe| keyframe.attention_mask_asset.as_ref()),
            )
        {
            if !film.assets.contains_key(a) {
                return Err(fail(format!("Unknown asset {a}")));
            }
        }
        end = s.frames[1];
    }
    let tiles: Vec<_> = film
        .segments
        .iter()
        .map(|s| FrameInterval::new(s.frames[0].into(), s.frames[1].into()))
        .collect::<std::result::Result<_, _>>()?;
    if !FrameInterval::tiles(&tiles, frames.into()) {
        return Err(fail("Film does not cover all delivery frames"));
    }
    Ok(frames)
}
fn validate_with_bindings(film: &Film, b: &Bindings) -> Result<u32> {
    check_bindings_shape(b)?;
    validate(film, b.video.frame_multiple)
}
fn load_bindings(film: &Film) -> Result<Bindings> {
    checked_asset(&film.bindings)?;
    Ok(serde_json::from_slice(&fs::read(&film.bindings.path)?)?)
}
fn probe(path: &Path) -> Result<Value> {
    let bytes = call(
        Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-count_frames",
                "-show_entries",
                "stream=width,height,r_frame_rate,nb_read_frames,duration",
                "-of",
                "json",
            ])
            .arg(path),
    )?;
    Ok(serde_json::from_slice::<Value>(&bytes)?["streams"][0].clone())
}
fn probe_matches(p: &Value, rate: RationalRate, count: u32) -> bool {
    p["r_frame_rate"]
        .as_str()
        .is_some_and(|r| rate.matches_probe(r))
        && p["nb_read_frames"]
            .as_str()
            .and_then(|v| v.parse::<u32>().ok())
            == Some(count)
}
fn check_clock(path: &Path, rate: RationalRate, count: u32) -> Result<Value> {
    let p = probe(path)?;
    if !probe_matches(&p, rate, count) {
        return Err(fail(format!("Wrong decoded clock for {}", path.display())));
    }
    Ok(p)
}
fn upload(root: &Root, url: &str, path: &Path, declared: Option<&str>) -> Result<Value> {
    comfy::upload_file(url, path, &root.rel(path)?, declared)
}
fn upload_name(r: &Value) -> Result<String> {
    let n = r["name"].as_str().ok_or("Missing uploaded name")?;
    let sub = r["subfolder"].as_str().unwrap_or("");
    Ok(if sub.is_empty() {
        n.to_owned()
    } else {
        format!("{sub}/{n}")
    })
}
fn frame_path(root: &Path, n: u32) -> PathBuf {
    root.join(format!("frame-{n:04}.png"))
}
/// Assign an existing input of an existing node. Never creates either, so a
/// mistyped binding fails instead of silently adding a junk node.
fn set_input(g: &mut Value, node: &str, input: &str, value: Value) -> Result<()> {
    let slot = g
        .get_mut(node)
        .ok_or_else(|| {
            fail(format!(
                "Binding names node {node}, which the template lacks"
            ))
        })?
        .get_mut("inputs")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| fail(format!("Template node {node} has no inputs")))?;
    if !slot.contains_key(input) {
        return Err(fail(format!(
            "Template node {node} has no input named {input}"
        )));
    }
    slot.insert(input.to_owned(), value);
    Ok(())
}
fn anchor_graph(
    film: &Film,
    b: &AnchorBindings,
    s: &Segment,
    p: &Prepared,
    template: Value,
) -> Result<Value> {
    let mut g = template;
    let object = g.as_object_mut().ok_or("Template not object")?;
    for k in &b.remove_nodes {
        object.remove(k);
    }
    set_input(
        &mut g,
        &b.guide_image_node,
        "image",
        json!(upload_name(&p.guides[&s.id]["first"])?),
    )?;
    g["guide-scale"] = json!({"class_type":"ImageScale","inputs":{"image":[b.guide_image_node,0],"upscale_method":"lanczos","width":film.resolution.width,"height":film.resolution.height,"crop":"disabled"}});
    set_input(
        &mut g,
        &b.guide_scale_target,
        "pixels",
        json!(["guide-scale", 0]),
    )?;
    set_input(
        &mut g,
        &b.prompt_node,
        "text",
        json!(serde_json::to_string(&s.anchor_prompt)?),
    )?;
    let mut positive = b.positive_start.clone();
    let mut negative = b.negative_start.clone();
    for (i, id) in s.references.iter().enumerate() {
        let load = format!("ref-{i}");
        let scale = format!("ref-{i}-scale");
        let latent = format!("ref-{i}-latent");
        let pos = format!("ref-{i}-positive");
        let neg = format!("ref-{i}-negative");
        g[&load] = json!({"class_type":"LoadImage","inputs":{"image":upload_name(&p.assets[id])?}});
        g[&scale] = json!({"class_type":"ImageScaleToTotalPixels","inputs":{"image":[load,0],"upscale_method":"lanczos","megapixels":b.reference_megapixels,"resolution_steps":1}});
        g[&latent] =
            json!({"class_type":"VAEEncode","inputs":{"pixels":[scale,0],"vae":[b.vae_node,0]}});
        g[&pos] = json!({"class_type":"ReferenceLatent","inputs":{"conditioning":[positive,0],"latent":[latent,0]}});
        g[&neg] = json!({"class_type":"ReferenceLatent","inputs":{"conditioning":[negative,0],"latent":[latent,0]}});
        positive = pos;
        negative = neg;
    }
    set_input(
        &mut g,
        &b.conditioning_node,
        "positive",
        json!([positive, 0]),
    )?;
    set_input(
        &mut g,
        &b.conditioning_node,
        "negative",
        json!([negative, 0]),
    )?;
    set_input(
        &mut g,
        &b.output_node,
        "filename_prefix",
        json!(format!("{}/anchors/{}", film.id, s.id)),
    )?;
    Ok(g)
}
fn prepare(
    root: &Root,
    film: &Film,
    bind: &Bindings,
    plan: &Path,
    out: &Path,
    url: &str,
) -> Result<()> {
    let frames = validate_with_bindings(film, bind)?;
    let rate = film.clock.rate;
    let multiple = bind.video.frame_multiple;
    let native_frames = native_indices(film, frames)?;
    checked_asset(&film.native_scene)?;
    checked_asset(&film.scene_plan)?;
    checked_asset(&film.anchor_template)?;
    checked_asset(&film.video_template)?;
    let scene_plan = read(&film.scene_plan.path)?;
    let actors: BTreeSet<_> = scene_plan["actors"]
        .as_array()
        .ok_or("Scene plan has no actors")?
        .iter()
        .filter_map(|a| a["id"].as_str())
        .collect();
    for s in &film.segments {
        for actor in &s.actors {
            if !actors.contains(actor.as_str()) {
                return Err(fail(format!("Unknown scene actor {actor}")));
            }
        }
    }
    for a in film.assets.values() {
        checked_asset(a)?;
    }
    let receipt = read(&film.render_directory.join("complete.json"))?;
    if receipt["source_scene_sha256"] != film.native_scene.sha256
        || receipt["delivery_complete"] != true
    {
        return Err(fail(
            "Native render is not a complete rehearsal of the selected world",
        ));
    }
    check_render_rate(&receipt, rate)?;
    let mut frame_hashes = BTreeMap::new();
    for f in receipt["frames"]
        .as_array()
        .ok_or("Missing native frames")?
    {
        frame_hashes.insert(
            f["frame"].as_u64().ok_or("Missing frame index")? as u32,
            f["sha256"].as_str().ok_or("Missing frame hash")?.to_owned(),
        );
    }
    for n in 0..frames {
        if frame_hashes.get(&n) != Some(&sha(&frame_path(&film.render_directory, n))?) {
            return Err(fail(format!("Native frame {n} changed or missing")));
        }
    }
    if out.exists() {
        return Err(fail(
            "Preparation output must be new; resume existing batch receipts rather than reprepare",
        ));
    }
    fs::create_dir_all(out.join("anchor-graphs"))?;
    fs::create_dir_all(out.join("guides"))?;
    let mut p = Prepared {
        plan_sha256: sha(plan)?,
        url: url.to_owned(),
        assets: BTreeMap::new(),
        guides: BTreeMap::new(),
    };
    for (id, a) in &film.assets {
        p.assets
            .insert(id.clone(), upload(root, url, &a.path, Some(&a.sha256))?);
    }
    let anchor_template = read(&film.anchor_template.path)?;
    for s in &film.segments {
        let dir = out.join("guides").join(&s.id);
        fs::create_dir_all(&dir)?;
        for (i, n) in (s.source_frames[0]..s.source_frames[1]).enumerate() {
            fs::copy(
                frame_path(&film.render_directory, native_frames[n as usize]),
                dir.join(format!("frame-{i:04}.png")),
            )?;
        }
        let first = dir.join(format!("{}-{}-first.png", film.id, s.id));
        fs::copy(dir.join("frame-0000.png"), &first)?;
        let count = s.frames[1] - s.frames[0];
        let padded_count = if s.exact_art.is_some() {
            count
        } else {
            padded(count, multiple)
        };
        let guide = dir.join(format!("{}-{}-guide.mkv", film.id, s.id));
        call(
            Command::new("ffmpeg")
                .args(["-v", "error", "-y", "-framerate", &rate.ffmpeg_rate(), "-i"])
                .arg(dir.join("frame-%04d.png"))
                .arg("-vf")
                .arg(format!(
                    "trim=end_frame={count},tpad=stop_mode=clone:stop={}",
                    padded_count - count
                ))
                .args([
                    "-frames:v",
                    &padded_count.to_string(),
                    "-c:v",
                    "ffv1",
                    "-pix_fmt",
                    "bgr0",
                ])
                .arg(&guide),
        )?;
        let padding_check = video_production_runtime::guide::check_video_padding(
            &guide,
            count,
            padded_count,
            rate,
        )?;
        let clock = padding_check["probe"].clone();
        let mut record = json!({"delivery_frames":count,"model_frames":padded_count,"padding":padded_count-count,"first":upload(root, url,&first, None)?,"guide":upload(root, url,&guide, None)?,"probe":clock,"padding_check":padding_check});
        record["source_frames"] = json!(s.source_frames);
        record["native_source_frames"] =
            json!(&native_frames[s.source_frames[0] as usize..s.source_frames[1] as usize]);
        p.guides.insert(s.id.clone(), record);
        if s.exact_art.is_none() && s.firstlook_asset.is_none() {
            save(
                &out.join("anchor-graphs").join(format!("{}.api.json", s.id)),
                &anchor_graph(film, &bind.anchor, s, &p, anchor_template.clone())?,
            )?;
        }
    }
    save(&out.join("prepared.json"), &p)?;
    save(&out.join("film-plan.json"), &read(plan)?)?;
    println!(
        "Prepared {} segments, all {frames} native frame hashes checked",
        film.segments.len(),
    );
    Ok(())
}
/// The native render must have been made at the plan's rate (`rate`, or the
/// legacy `fps` key that existing render producers write).
fn check_render_rate(receipt: &Value, rate: RationalRate) -> Result<()> {
    if rate_from_receipt(receipt) != Some(rate) {
        return Err(fail(format!(
            "Native render rate differs from the plan's {rate}"
        )));
    }
    Ok(())
}
fn completed_media(receipt: &Path, node: &str, graph: &Path) -> Result<Media> {
    let r = read(receipt)?;
    if r["state"] != "completed" {
        return Err(fail(format!("Not completed: {}", receipt.display())));
    }
    if r["workflow"] != read(graph)? {
        return Err(fail("Completed receipt does not match the compiled graph"));
    }
    let matches: Vec<_> = r["downloads"]
        .as_array()
        .ok_or("No downloads")?
        .iter()
        .filter(|d| d["node_id"] == node && d["type"] == "output")
        .collect();
    if matches.len() != 1 {
        return Err(fail("Expected exactly one selected output node"));
    }
    let path = PathBuf::from(
        matches[0]["path"]
            .as_str()
            .ok_or("Missing downloaded path")?,
    );
    let declared = matches[0]["sha256"]
        .as_str()
        .ok_or("Missing download hash")?;
    if sha(&path)? != declared {
        return Err(fail("Downloaded media changed"));
    }
    Ok(Media {
        path,
        sha256: declared.to_owned(),
    })
}
fn image_controls(g: &mut Value, v: &VideoBindings, s: &Segment) -> Result<()> {
    for key in &v.layout_guide_nodes {
        if let Some(attention) = s.layout_attention {
            if g[key]["class_type"] != "LTXAddVideoICLoRAGuideAdvanced" {
                return Err(fail(
                    "Expected the versioned Advanced layout-guide template",
                ));
            }
            g[key]["inputs"]["attention_strength"] = json!(attention);
        }
    }
    for key in &v.reference_guide_nodes {
        if s.reference_mode.is_none() && s.reference_attention.is_none() {
            continue;
        }
        if !matches!(
            g[key]["class_type"].as_str(),
            Some("LTXAddVideoICLoRAGuide" | "LTXAddVideoICLoRAGuideAdvanced")
        ) {
            return Err(fail(
                "Reference index semantics require the custom IC-LoRA guide, not a native or unrelated guide node",
            ));
        }
        if let Some(mode) = s.reference_mode {
            g[key]["inputs"]["frame_idx"] = json!(match mode {
                ReferenceMode::AppearancePreclip => -1,
                ReferenceMode::IndexedStart => 0,
            });
        }
        if let Some(attention) = s.reference_attention {
            g[key]["class_type"] = json!("LTXAddVideoICLoRAGuideAdvanced");
            g[key]["inputs"]["attention_strength"] = json!(attention);
        }
    }
    Ok(())
}
fn indexed_keyframes(g: &mut Value, v: &VideoBindings, s: &Segment, p: &Prepared) -> Result<()> {
    let mut tails = v.reference_guide_nodes.clone();
    if !s.keyframes.is_empty() && tails.is_empty() {
        return Err(fail(
            "Indexed keyframes need reference_guide_nodes in the binding map",
        ));
    }
    for (index, keyframe) in s.keyframes.iter().enumerate() {
        let image_id = format!("indexed-image-{index}");
        let uploaded = p
            .assets
            .get(&keyframe.asset)
            .ok_or("Indexed asset was not prepared")?;
        g[&image_id] = json!({"class_type":"LoadImage","inputs":{"image":upload_name(uploaded)?}});
        let mask_id = if let Some(asset) = &keyframe.attention_mask_asset {
            let id = format!("indexed-mask-{index}");
            let uploaded = p.assets.get(asset).ok_or("Indexed mask was not prepared")?;
            g[&id] = json!({"class_type":"LoadImageMask","inputs":{"image":upload_name(uploaded)?,"channel":"red"}});
            Some(id)
        } else {
            None
        };
        for (stage, tail) in tails.iter_mut().enumerate() {
            if !matches!(
                g[&*tail]["class_type"].as_str(),
                Some("LTXAddVideoICLoRAGuide" | "LTXAddVideoICLoRAGuideAdvanced")
            ) {
                return Err(fail(
                    "Indexed keyframes require the versioned custom IC-LoRA graph",
                ));
            }
            let mut node = g[&*tail].clone();
            node["class_type"] = json!("LTXAddVideoICLoRAGuideAdvanced");
            node["inputs"]["positive"] = json!([tail, 0]);
            node["inputs"]["negative"] = json!([tail, 1]);
            node["inputs"]["latent"] = json!([tail, 2]);
            node["inputs"]["image"] = json!([image_id, 0]);
            node["inputs"]["frame_idx"] = json!(keyframe.model_frame);
            node["inputs"]["attention_strength"] = json!(keyframe.attention);
            // A guide's mask belongs to its own image coordinates. Never
            // inherit a previous keyframe's mask when chaining new anchors.
            node["inputs"]
                .as_object_mut()
                .ok_or("Missing guide inputs")?
                .remove("attention_mask");
            if let Some(mask_id) = &mask_id {
                node["inputs"]["attention_mask"] = json!([mask_id, 0]);
            }
            let id = format!("indexed-stage{}-{index}", stage + 1);
            // Rewire every consumer, including CropGuides metadata, before
            // adding the new node so its input cannot become a self-cycle.
            for existing in g
                .as_object_mut()
                .ok_or("Graph must be an object")?
                .values_mut()
            {
                for input in existing["inputs"]
                    .as_object_mut()
                    .ok_or("Missing inputs")?
                    .values_mut()
                {
                    if let Some(link) = input.as_array_mut()
                        && link.first().and_then(Value::as_str) == Some(tail.as_str())
                    {
                        link[0] = json!(id);
                    }
                }
            }
            g[&id] = node;
            *tail = id;
        }
    }
    Ok(())
}
/// Compile one segment's video graph from the template and the binding map.
fn video_graph(
    film: &Film,
    v: &VideoBindings,
    s: &Segment,
    p: &Prepared,
    template: Value,
    anchor_upload: &Value,
) -> Result<Value> {
    let mut g = template;
    set_input(
        &mut g,
        &v.guide_video_node,
        "file",
        json!(upload_name(&p.guides[&s.id]["guide"])?),
    )?;
    set_input(
        &mut g,
        &v.anchor_image_node,
        "image",
        json!(upload_name(anchor_upload)?),
    )?;
    set_input(
        &mut g,
        &v.positive_prompt_node,
        "text",
        json!(s.video_prompt),
    )?;
    set_input(
        &mut g,
        &v.negative_prompt_node,
        "text",
        json!(film.negative_prompt),
    )?;
    set_input(
        &mut g,
        &v.output_node,
        "filename_prefix",
        json!(format!("{}/videos/{}", film.id, s.id)),
    )?;
    image_controls(&mut g, v, s)?;
    indexed_keyframes(&mut g, v, s, p)?;
    Ok(g)
}
fn videos(root: &Root, film: &Film, bind: &Bindings, out: &Path, p: &Prepared) -> Result<()> {
    let graphs = out.join("video-graphs");
    if graphs.exists() {
        return Err(fail("Video graph output must be new"));
    }
    // Verify every anchor before emitting any GPU graph.
    let mut anchors = BTreeMap::new();
    for s in &film.segments {
        for keyframe in &s.keyframes {
            checked_asset(
                film.assets
                    .get(&keyframe.asset)
                    .ok_or("Unknown indexed asset")?,
            )?;
            if let Some(asset) = &keyframe.attention_mask_asset {
                checked_asset(film.assets.get(asset).ok_or("Unknown indexed mask")?)?;
            }
        }
        if s.exact_art.is_none() {
            anchors.insert(
                &s.id,
                if let Some(id) = &s.firstlook_asset {
                    let asset = film
                        .assets
                        .get(id)
                        .ok_or("Unknown selected first-look asset")?;
                    checked_asset(asset)?;
                    Media {
                        path: asset.path.clone(),
                        sha256: asset.sha256.clone(),
                    }
                } else {
                    completed_media(
                        &out.join("anchors").join(&s.id).join("receipt.json"),
                        &bind.anchor.output_node,
                        &out.join("anchor-graphs").join(format!("{}.api.json", s.id)),
                    )?
                },
            );
        }
    }
    fs::create_dir(&graphs)?;
    let template = read(&film.video_template.path)?;
    for s in &film.segments {
        if s.exact_art.is_some() {
            continue;
        }
        let anchor = &anchors[&s.id];
        let uploaded = upload(root, &p.url, &anchor.path, Some(&anchor.sha256))?;
        let g = video_graph(film, &bind.video, s, p, template.clone(), &uploaded)?;
        save(&graphs.join(format!("{}.api.json", s.id)), &g)?;
    }
    println!("Video graphs compiled from verified anchors; use existing durable batch runner");
    Ok(())
}
/// FFmpeg filter that conforms one clip to the delivery clock and canvas.
fn segment_filter(index: usize, trim: &str, rate: RationalRate, width: u32, height: u32) -> String {
    format!(
        "[{index}:v]{trim},settb=AVTB,setpts={},scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v{index}]",
        rate.setpts_expr()
    )
}
fn clip_record(root: &Root, s: &Segment, media: &Media) -> Result<Value> {
    Ok(
        json!({"segment":s.id,"delivery":s.frames,"source_frames":s.source_frames,"path":root.rel(&media.path)?,"sha256":media.sha256,"native_actors":s.actors,"beat_ids":s.beat_ids,"transition":s.transition,"transition_reason":s.transition_reason}),
    )
}
fn master_receipt(
    root: &Root,
    film: &Film,
    p: &Prepared,
    clips: Vec<Value>,
    dest: &Path,
    clock: Value,
) -> Result<Value> {
    let mut receipt = json!({"plan_sha256":p.plan_sha256,"native_scene_sha256":film.native_scene.sha256,"rate":film.clock.rate,"resolution":[film.resolution.width,film.resolution.height],"clips":clips,"output":{"path":root.rel(dest)?,"sha256":sha(dest)?,"probe":clock},"status":film.status,"audio":"silent picture rehearsal; supplied narration and generated lip-sync not accepted","production_accepted":false});
    root.relativise(&mut receipt)?;
    Ok(receipt)
}
fn assemble(root: &Root, film: &Film, out: &Path, p: &Prepared, bind: &Bindings) -> Result<()> {
    let frames = film_frames(film)?;
    let rate = film.clock.rate;
    let (w, h) = (film.resolution.width, film.resolution.height);
    let dest = out.join("provisional-master.mp4");
    if dest.exists() {
        return Err(fail("Master output must be new"));
    }
    let mut cmd = Command::new("ffmpeg");
    cmd.args(["-v", "error", "-filter_complex_threads", "2"]);
    let mut filters = Vec::new();
    let mut clips = Vec::new();
    for (i, s) in film.segments.iter().enumerate() {
        let n = s.frames[1] - s.frames[0];
        let media = if let Some(id) = &s.exact_art {
            let asset = &film.assets[id];
            checked_asset(asset)?;
            cmd.args(["-loop", "1", "-framerate", &rate.ffmpeg_rate()]);
            Media {
                path: asset.path.clone(),
                sha256: asset.sha256.clone(),
            }
        } else {
            let media = completed_media(
                &out.join("videos").join(&s.id).join("receipt.json"),
                &bind.video.output_node,
                &out.join("video-graphs").join(format!("{}.api.json", s.id)),
            )?;
            check_clock(
                &media.path,
                rate,
                p.guides[&s.id]["model_frames"]
                    .as_u64()
                    .ok_or("Missing model frame count")? as u32,
            )?;
            media
        };
        cmd.arg("-i").arg(&media.path);
        filters.push(segment_filter(
            i,
            &format!("trim=end_frame={n}"),
            rate,
            w,
            h,
        ));
        clips.push(clip_record(root, s, &media)?);
    }
    filters.push(format!(
        "{}concat=n={}:v=1:a=0[out]",
        (0..film.segments.len())
            .map(|i| format!("[v{i}]"))
            .collect::<String>(),
        film.segments.len()
    ));
    cmd.args([
        "-filter_complex",
        &filters.join(";"),
        "-map",
        "[out]",
        "-an",
        "-frames:v",
        &frames.to_string(),
        "-r",
        &rate.ffmpeg_rate(),
        "-c:v",
        "libx264",
        "-threads",
        "4",
        "-crf",
        "18",
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
    ])
    .arg(&dest);
    call(&mut cmd)?;
    let clock = check_clock(&dest, rate, frames)?;
    if clock["width"] != w || clock["height"] != h {
        return Err(fail("Master canvas differs from the declared resolution"));
    }
    save(
        &out.join("master-receipt.json"),
        &master_receipt(root, film, p, clips, &dest, clock)?,
    )?;
    println!(
        "{frames}-frame provisional picture master assembled; quality and sound remain unaccepted"
    );
    Ok(())
}
fn run() -> Result<()> {
    let mut args: Vec<OsString> = std::env::args_os().skip(1).collect();
    let root = Root::new(&take_root_option(&mut args)?)?;
    let a: Vec<String> = args
        .into_iter()
        .map(|s| s.into_string().map_err(|_| fail("Arguments must be UTF-8")))
        .collect::<Result<_>>()?;
    if a.len() < 3 {
        return Err(fail(
            "Usage: film-bake [--root DIR] prepare|videos|assemble PLAN WORKDIR [COMFY_URL]",
        ));
    }
    // Every remaining path is relative to the production root.
    std::env::set_current_dir(root.dir())?;
    let plan = Path::new(&a[1]);
    let out = Path::new(&a[2]);
    let film: Film = serde_json::from_slice(&fs::read(plan)?)?;
    let bind = load_bindings(&film)?;
    validate_with_bindings(&film, &bind)?;
    match a[0].as_str() {
        "prepare" => prepare(
            &root,
            &film,
            &bind,
            plan,
            out,
            a.get(3).ok_or("Explicit Comfy URL required")?,
        ),
        "videos" | "assemble" => {
            let p: Prepared = serde_json::from_slice(&fs::read(out.join("prepared.json"))?)?;
            if p.plan_sha256 != sha(plan)? {
                return Err(fail("Plan changed; create a new versioned bake"));
            }
            checked_asset(&film.video_template)?;
            if a[0] == "videos" {
                videos(&root, &film, &bind, out, &p)
            } else {
                assemble(&root, &film, out, &p, &bind)
            }
        }
        _ => Err(fail("Unknown command")),
    }
}
fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use video_production_runtime::paths::absolute_paths;

    // A structural adapter fixture, not a runnable inference workflow. Keep
    // only guide nodes and their consumers so tests need no production files.
    fn guide_template() -> Value {
        serde_json::from_str(include_str!(
            "../../tests/fixtures/dual-stage-guide-links.json"
        ))
        .unwrap()
    }

    fn bindings() -> Bindings {
        serde_json::from_value(json!({"schema":"workflow-bindings/1",
            "anchor":{"remove_nodes":["gone"],"guide_image_node":"a-load","guide_scale_target":"a-vae",
                "prompt_node":"a-text","positive_start":"a-pos","negative_start":"a-neg","vae_node":"a-vaeload",
                "conditioning_node":"a-cond","output_node":"a-save"},
            "video":{"guide_video_node":"v-guide","anchor_image_node":"v-anchor",
                "positive_prompt_node":"v-pos","negative_prompt_node":"v-neg","output_node":"v-save",
                "layout_guide_nodes":["9002:5012","9034:9039"],
                "reference_guide_nodes":["9002:9042","9034:9043"]}}))
        .unwrap()
    }

    fn video_template() -> Value {
        let mut g = guide_template();
        for (id, input) in [
            ("v-guide", "file"),
            ("v-anchor", "image"),
            ("v-pos", "text"),
            ("v-neg", "text"),
            ("v-save", "filename_prefix"),
        ] {
            g[id] = json!({"class_type":"Node","inputs":{input:"unset"}});
        }
        g
    }

    fn film_value(clock: Value, segments: Value) -> Value {
        let asset = json!({"path":"unused","sha256":"unused"});
        json!({"schema":"film-bake/2","id":"fixture","clock":clock,
            "resolution":{"width":640,"height":360,"aspect":"16:9"},
            "negative_prompt":"blur","bindings":asset,"native_scene":asset,"scene_plan":asset,
            "render_directory":"unused","anchor_template":asset,"video_template":asset,
            "assets":{"end-pose":asset},"segments":segments,"status":"synthetic validator fixture"})
    }

    fn two_segments(total: u32, split: u32, source_shift: i32, transition: &str) -> Value {
        let seg = |id: &str, frames: [u32; 2], source: [u32; 2], transition: &str| {
            json!({"id":id,"frames":frames,"source_frames":source,
                "beat_ids":[id],"actors":[],"transition":transition,
                "transition_reason":"synthetic action","references":[],
                "anchor_prompt":{},"video_prompt":"moving shape"})
        };
        json!([
            seg("a", [0, split], [0, split], "start"),
            seg(
                "b",
                [split, total],
                [
                    (split as i32 + source_shift) as u32,
                    (total as i32 + source_shift) as u32
                ],
                transition
            )
        ])
    }

    fn padding_film() -> Film {
        serde_json::from_value(film_value(
            json!({"rate":25,"frames":100}),
            two_segments(100, 55, 0, "continuous"),
        ))
        .unwrap()
    }

    fn prepared() -> Prepared {
        Prepared {
            plan_sha256: String::new(),
            url: String::new(),
            assets: BTreeMap::from([
                ("middle".into(), json!({"name":"middle.png"})),
                ("mask".into(), json!({"name":"mask.png"})),
                ("end".into(), json!({"name":"end.png"})),
            ]),
            guides: BTreeMap::from([(
                "a".into(),
                json!({"guide":{"name":"guide.mkv","subfolder":"in"}}),
            )]),
        }
    }

    fn keyed_segment() -> Segment {
        serde_json::from_value(json!({
            "id":"a","frames":[0,55],"source_frames":[0,55],
            "beat_ids":["a"],"actors":[],"transition":"start",
            "transition_reason":"synthetic action","references":[],"anchor_prompt":{},
            "video_prompt":"moving shape","keyframes":[
                {"asset":"middle","attention_mask_asset":"mask","model_frame":16,"source_master_frame":16,"attention":0.5},
                {"asset":"end","model_frame":56,"source_master_frame":54,"attention":0.85}
            ]
        }))
        .unwrap()
    }

    #[test]
    fn indexed_images_chain_through_both_samplers_and_crop_metadata() {
        let mut graph = guide_template();
        let segment = keyed_segment();
        indexed_keyframes(&mut graph, &bindings().video, &segment, &prepared()).unwrap();
        for (stage, base, guider, sampler, crop) in [
            (1, "9002:9042", "5516:4828", "5516:4829", "5516:5000"),
            (2, "9034:9043", "9034:9030", "9034:9033", "9034:9041"),
        ] {
            let first = format!("indexed-stage{stage}-0");
            let last = format!("indexed-stage{stage}-1");
            assert_eq!(graph[&first]["inputs"]["positive"], json!([base, 0]));
            assert_eq!(graph[&last]["inputs"]["positive"], json!([first, 0]));
            assert_eq!(graph[&last]["inputs"]["frame_idx"], 56);
            assert_eq!(
                graph[&first]["inputs"]["attention_mask"],
                json!(["indexed-mask-0", 0])
            );
            assert!(graph[&last]["inputs"].get("attention_mask").is_none());
            assert_eq!(graph[guider]["inputs"]["positive"], json!([last, 0]));
            assert_eq!(graph[sampler]["inputs"]["latent_image"], json!([last, 2]));
            assert_eq!(graph[crop]["inputs"]["negative"], json!([last, 1]));
        }
        let mut unsupported = guide_template();
        unsupported["9002:9042"]["class_type"] = json!("LTXVAddGuide");
        assert!(
            indexed_keyframes(&mut unsupported, &bindings().video, &segment, &prepared()).is_err()
        );
    }

    #[test]
    fn video_graph_uses_bindings_and_rejects_missing_nodes_and_inputs() {
        let film = padding_film();
        let b = bindings();
        let seg = &film.segments[0];
        let anchor = json!({"name":"anchor.png","subfolder":""});
        let g = video_graph(&film, &b.video, seg, &prepared(), video_template(), &anchor).unwrap();
        assert_eq!(g["v-guide"]["inputs"]["file"], "in/guide.mkv");
        assert_eq!(g["v-anchor"]["inputs"]["image"], "anchor.png");
        assert_eq!(g["v-pos"]["inputs"]["text"], "moving shape");
        assert_eq!(g["v-neg"]["inputs"]["text"], "blur");
        assert_eq!(g["v-save"]["inputs"]["filename_prefix"], "fixture/videos/a");
        // A binding naming an absent node must fail, not invent a junk node.
        let mut missing = video_template();
        missing.as_object_mut().unwrap().remove("v-anchor");
        let error = video_graph(&film, &b.video, seg, &prepared(), missing, &anchor).unwrap_err();
        assert!(error.to_string().contains("v-anchor"), "{error}");
        // A node lacking the bound input is equally an error.
        let mut wrong = video_template();
        wrong["v-pos"]["inputs"] = json!({"other":1});
        assert!(video_graph(&film, &b.video, seg, &prepared(), wrong, &anchor).is_err());
        // A mis-typed guide node class fails the guide checks.
        let mut retyped = video_template();
        retyped["9002:9042"]["class_type"] = json!("LTXVAddGuide");
        let mut with_reference = keyed_segment();
        with_reference.reference_mode = Some(ReferenceMode::IndexedStart);
        assert!(
            video_graph(
                &film,
                &b.video,
                &with_reference,
                &prepared(),
                retyped,
                &anchor
            )
            .is_err()
        );
    }

    #[test]
    fn anchor_graph_follows_bindings_and_cannot_add_junk_nodes() {
        let film = padding_film();
        let b = bindings();
        let template = json!({
            "gone":{"class_type":"X","inputs":{}},
            "a-load":{"class_type":"LoadImage","inputs":{"image":"x"}},
            "a-vae":{"class_type":"VAEEncode","inputs":{"pixels":null}},
            "a-text":{"class_type":"T","inputs":{"text":""}},
            "a-cond":{"class_type":"C","inputs":{"positive":null,"negative":null}},
            "a-save":{"class_type":"S","inputs":{"filename_prefix":""}}});
        let mut p = prepared();
        p.guides
            .insert("a".into(), json!({"first":{"name":"first.png"}}));
        let g = anchor_graph(&film, &b.anchor, &film.segments[0], &p, template.clone()).unwrap();
        assert!(g.get("gone").is_none());
        assert_eq!(g["guide-scale"]["inputs"]["width"], 640);
        assert_eq!(g["guide-scale"]["inputs"]["height"], 360);
        assert_eq!(
            g["a-save"]["inputs"]["filename_prefix"],
            "fixture/anchors/a"
        );
        assert_eq!(g["a-cond"]["inputs"]["positive"], json!(["a-pos", 0]));
        let mut broken = template;
        broken.as_object_mut().unwrap().remove("a-text");
        assert!(anchor_graph(&film, &b.anchor, &film.segments[0], &p, broken).is_err());
    }

    #[test]
    fn clock_comes_from_the_plan_not_a_constant() {
        // 18 s at 30000/1001 is 539.46 frames: refuse unless a policy says how.
        let ntsc = |policy: Value| {
            let mut clock = json!({"rate":{"num":30000,"den":1001},"duration_s":18});
            if !policy.is_null() {
                clock["policy"] = policy;
            }
            serde_json::from_value::<Film>(film_value(clock, json!([]))).unwrap()
        };
        assert!(film_frames(&ntsc(Value::Null)).is_err());
        let allowed = json!({"num":1001,"den":30000});
        let ceil = json!({"priority":"duration","rounding":"ceil","allowed_error":allowed});
        let floor = json!({"priority":"duration","rounding":"floor","allowed_error":allowed});
        assert_eq!(film_frames(&ntsc(ceil)).unwrap(), 540);
        assert_eq!(film_frames(&ntsc(floor)).unwrap(), 539);
        let integral: Film =
            serde_json::from_value(film_value(json!({"rate":30,"duration_s":18}), json!([])))
                .unwrap();
        assert_eq!(film_frames(&integral).unwrap(), 540);
        assert_eq!(film_frames(&padding_film()).unwrap(), 100);
    }

    #[test]
    fn resolution_and_aspect_are_validated() {
        let mut value = film_value(
            json!({"rate":25,"frames":100}),
            two_segments(100, 50, 0, "continuous"),
        );
        assert_eq!(
            validate(&serde_json::from_value(value.clone()).unwrap(), 8).unwrap(),
            100
        );
        value["resolution"]["aspect"] = json!("4:3");
        assert!(validate(&serde_json::from_value(value.clone()).unwrap(), 8).is_err());
        value["resolution"] = json!({"width":641,"height":360});
        assert!(validate(&serde_json::from_value(value).unwrap(), 8).is_err());
    }

    #[test]
    fn native_render_rate_must_match_the_plan() {
        let ntsc = RationalRate::new(30000, 1001).unwrap();
        let film25 = RationalRate::new(25, 1).unwrap();
        // Existing render producers write the legacy `fps` key.
        assert!(check_render_rate(&json!({"fps":25}), film25).is_ok());
        assert!(check_render_rate(&json!({"rate":{"num":25,"den":1}}), film25).is_ok());
        assert!(check_render_rate(&json!({"fps":25}), ntsc).is_err());
        assert!(check_render_rate(&json!({}), film25).is_err());
    }

    #[test]
    fn filter_uses_declared_rate_and_canvas() {
        let rate = RationalRate::new(30000, 1001).unwrap();
        let filter = segment_filter(2, "trim=end_frame=9", rate, 1280, 720);
        assert!(filter.contains("setpts=N*1001/(30000*TB)"));
        assert!(filter.contains("scale=1280:720") && filter.contains("pad=1280:720"));
        assert!(filter.starts_with("[2:v]trim=end_frame=9,"));
    }

    #[test]
    fn indexed_padding_requires_the_last_actual_world_state() {
        let mut film = padding_film();
        let i = 0;
        film.segments[i].keyframes = vec![Keyframe {
            asset: "end-pose".into(),
            attention_mask_asset: None,
            model_frame: 56,
            source_master_frame: 54,
            attention: 0.85,
        }];
        validate(&film, 8).unwrap();
        film.segments[i].keyframes[0].source_master_frame = 53;
        assert!(
            validate(&film, 8).is_err(),
            "Padding cannot refer to a different world pose"
        );
        film.segments[i].keyframes[0].source_master_frame = 54;
        film.segments[i].keyframes[0].model_frame = 57;
        assert!(
            validate(&film, 8).is_err(),
            "Model-frame index must lie within the actual padded clip"
        );
        film.segments[i].keyframes[0].model_frame = 56;
        film.segments[i].keyframes[0].attention_mask_asset = Some("unknown-mask".into());
        assert!(validate(&film, 8).is_err());
        film.segments[i].keyframes[0].attention_mask_asset = None;
        film.segments[i].keyframes[0].asset = "unknown".into();
        assert!(validate(&film, 8).is_err());
    }

    #[test]
    fn frame_multiple_in_bindings_bounds_keyframes() {
        let mut film = padding_film();
        film.segments[0].keyframes = vec![Keyframe {
            asset: "end-pose".into(),
            attention_mask_asset: None,
            model_frame: 56,
            source_master_frame: 54,
            attention: 0.5,
        }];
        let mut b = bindings();
        validate_with_bindings(&film, &b).unwrap(); // padded(55, 8) == 57
        b.video.frame_multiple = 4; // padded(55, 4) == 57
        validate_with_bindings(&film, &b).unwrap();
        b.video.frame_multiple = 1; // no padding: only frames below 55 exist
        assert!(validate_with_bindings(&film, &b).is_err());
        b.video.frame_multiple = 0;
        assert!(validate_with_bindings(&film, &b).is_err());
    }

    #[test]
    fn explicit_reference_role_does_not_overwrite_layout_attention() {
        let original = guide_template();
        let mut graph = original.clone();
        let v = bindings().video;
        let mut segment: Segment = serde_json::from_value(json!({
            "id":"opening", "frames":[0,25], "source_frames":[0,25],
            "beat_ids":["opening"], "actors":[], "transition":"start",
            "transition_reason":"test", "references":[], "anchor_prompt":{},
            "video_prompt":"test", "exact_art":null
        }))
        .unwrap();
        image_controls(&mut graph, &v, &segment).unwrap();
        assert_eq!(
            graph, original,
            "Legacy manifests must retain their recorded template semantics"
        );
        segment.reference_mode = Some(ReferenceMode::IndexedStart);
        segment.reference_attention = Some(0.35);
        segment.layout_attention = Some(0.65);
        image_controls(&mut graph, &v, &segment).unwrap();
        for key in ["9002:5012", "9034:9039"] {
            assert_eq!(graph[key]["inputs"]["attention_strength"], 0.65);
            assert_eq!(graph[key]["inputs"]["frame_idx"], 0);
        }
        for key in ["9002:9042", "9034:9043"] {
            assert_eq!(graph[key]["inputs"]["attention_strength"], 0.35);
            assert_eq!(graph[key]["inputs"]["frame_idx"], 0);
        }
        segment.reference_mode = Some(ReferenceMode::AppearancePreclip);
        segment.reference_attention = None;
        segment.layout_attention = Some(1.0);
        image_controls(&mut graph, &v, &segment).unwrap();
        assert_eq!(graph["9002:9042"]["inputs"]["frame_idx"], -1);
        assert_eq!(graph["9002:9042"]["inputs"]["attention_strength"], 0.35);
        assert_eq!(graph["9002:5012"]["inputs"]["attention_strength"], 1.0);
        graph["9002:9042"]["class_type"] = json!("LTXVAddGuide");
        assert!(
            image_controls(&mut graph, &v, &segment).is_err(),
            "Do not reinterpret native-guide negative indices as IC-LoRA positions"
        );
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("film-bake-{tag}-{}-{unique}", std::process::id()));
        fs::create_dir(&dir).unwrap();
        dir
    }

    #[test]
    fn completed_media_rejects_swapped_graph_and_changed_bytes() {
        let dir = temp_dir("media");
        let media = dir.join("selected.png");
        let graph = dir.join("graph.json");
        let receipt = dir.join("receipt.json");
        fs::write(&media, b"verified media bytes").unwrap();
        let workflow =
            json!({"17":{"class_type":"SaveImage","inputs":{"filename_prefix":"original"}}});
        save(&graph, &workflow).unwrap();
        save(
            &receipt,
            &json!({"state":"completed","workflow":workflow,"downloads":[
                {"node_id":"input-preview","type":"temp","path":"never-selected"},
                {"node_id":"17","type":"output","path":media,"sha256":sha(&media).unwrap()}
            ]}),
        )
        .unwrap();
        assert_eq!(completed_media(&receipt, "17", &graph).unwrap().path, media);
        fs::write(
            &graph,
            serde_json::to_vec(&json!({"17":{"class_type":"SaveImage","inputs":{"filename_prefix":"replacement"}}})).unwrap(),
        )
        .unwrap();
        assert!(
            completed_media(&receipt, "17", &graph)
                .err()
                .unwrap()
                .to_string()
                .contains("compiled graph")
        );
        fs::write(&graph, serde_json::to_vec(&workflow).unwrap()).unwrap();
        fs::write(&media, b"corrupted media bytes").unwrap();
        assert!(
            completed_media(&receipt, "17", &graph)
                .err()
                .unwrap()
                .to_string()
                .contains("media changed")
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn receipts_contain_only_root_relative_paths() {
        let dir = temp_dir("receipt");
        fs::create_dir_all(dir.join("work/videos")).unwrap();
        let clip = dir.join("work/videos/a.mp4");
        let master = dir.join("work/provisional-master.mp4");
        fs::write(&clip, b"clip").unwrap();
        fs::write(&master, b"master").unwrap();
        let root = Root::new(&dir).unwrap();
        let film = padding_film();
        let media = Media {
            path: root.dir().join("work/videos/a.mp4"), // absolute on purpose
            sha256: sha(&clip).unwrap(),
        };
        let clips = vec![clip_record(&root, &film.segments[0], &media).unwrap()];
        let receipt = master_receipt(
            &root,
            &film,
            &prepared(),
            clips,
            &root.dir().join("work/provisional-master.mp4"),
            json!({}),
        )
        .unwrap();
        assert_eq!(receipt["clips"][0]["path"], "work/videos/a.mp4");
        assert_eq!(receipt["output"]["path"], "work/provisional-master.mp4");
        let text = serde_json::to_string(&receipt).unwrap();
        assert!(!text.contains("\"/"), "leading slash in {text}");
        assert!(absolute_paths(&receipt).is_empty());
        // A path outside the root is an error, not an absolute receipt entry.
        let outside = Media {
            path: std::env::temp_dir().join("elsewhere.mp4"),
            sha256: String::new(),
        };
        assert!(clip_record(&root, &film.segments[0], &outside).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn padding_keeps_all_delivery_frames() {
        for multiple in [1, 4, 8] {
            for n in 1..=2000 {
                let p = padded(n, multiple);
                assert!(p >= n && p - n < multiple);
                assert_eq!((p - 1) % multiple, 0);
            }
        }
        assert_eq!(padded(110, 8), 113);
    }

    #[test]
    fn unsafe_graph_names_rejected() {
        for s in ["", "../a", "a/b", "a.b", "a b"] {
            assert!(!safe_id(s));
        }
        assert!(safe_id("S03-shot"));
    }

    #[test]
    fn gaps_and_unrecorded_time_jumps_are_rejected() {
        let clock = json!({"rate":25,"frames":100});
        let make = |split_end: u32, shift: i32, transition: &str| {
            let mut segments = two_segments(100, 50, shift, transition);
            segments[1]["frames"] = json!([split_end, 100]);
            serde_json::from_value::<Film>(film_value(clock.clone(), segments)).unwrap()
        };
        assert!(validate(&make(50, 0, "continuous"), 8).is_ok());
        assert!(validate(&make(51, 0, "continuous"), 8).is_err());
        assert!(validate(&make(50, -3, "continuous"), 8).is_err());
        assert!(validate(&make(50, -3, "montage"), 8).is_ok());
    }

    #[test]
    fn editorial_map_cannot_claim_another_world_or_reset_action() {
        let rate = RationalRate::new(25, 1).unwrap();
        let mut map = NativeFrameMap {
            schema: "native-frame-map/2".into(),
            source_scene_sha256: "world".into(),
            rate,
            source_frames: vec![0, 0, 2, 3],
            reason: "Explicit delivery timing around scratch narration".into(),
            physics_timing_status: "editorial_retime_requires_physics_revalidation".into(),
        };
        assert!(validate_native_map(&map, 4, "world", rate).is_ok());
        assert!(validate_native_map(&map, 4, "other-world", rate).is_err());
        assert!(validate_native_map(&map, 5, "world", rate).is_err());
        assert!(
            validate_native_map(&map, 4, "world", RationalRate::new(30000, 1001).unwrap()).is_err()
        );
        map.source_frames = vec![0, 2, 1, 3];
        assert!(validate_native_map(&map, 4, "world", rate).is_err());
        map.source_frames = vec![0, 0, 4, 3];
        assert!(validate_native_map(&map, 4, "world", rate).is_err());
        map.source_frames = vec![0, 0, 2, 3];
        map.physics_timing_status = "validated".into();
        assert!(validate_native_map(&map, 4, "world", rate).is_err());
    }
}
