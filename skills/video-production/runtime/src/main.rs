//! Validate a software-independent scene and compile observed views into prompt data.
//! Native geometry remains in referenced assets; labels and edit intent live in JSON.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    path::Path,
};
use video_production_runtime::clock::RationalRate;

type Result<T> = std::result::Result<T, String>;
#[derive(Deserialize, Serialize, Clone)]
struct Transform {
    translation: [f64; 3],
    rotation_xyz: [f64; 3],
    scale: [f64; 3],
}
#[derive(Deserialize, Serialize, Clone)]
struct Object {
    id: String,
    label: String,
    kind: String,
    parent: Option<String>,
    transform: Transform,
    dimensions: Option<[f64; 3]>,
    asset: Option<String>,
    appearance: String,
    constraints: Vec<String>,
    prompt_enabled: bool,
    #[serde(default)]
    parameters: BTreeMap<String, Value>,
}
#[derive(Deserialize, Serialize, Clone)]
struct Asset {
    id: String,
    path: String,
    sha256: String,
    role: String,
}
#[derive(Deserialize, Serialize, Clone)]
struct Relation {
    subject: String,
    predicate: String,
    object: String,
}
#[derive(Deserialize, Serialize, Clone)]
struct View {
    id: String,
    camera: String,
    frame: u32,
    purpose: String,
}
#[derive(Deserialize, Serialize, Clone)]
struct Scene {
    schema: String,
    id: String,
    revision: String,
    units: String,
    up_axis: String,
    /// Frame rate: an integer, `"num/den"` string or `{num,den}` object.
    fps: RationalRate,
    delivery_frames: u32,
    style: String,
    constraints: Vec<String>,
    assets: Vec<Asset>,
    objects: Vec<Object>,
    relationships: Vec<Relation>,
    views: Vec<View>,
}
#[derive(Deserialize)]
struct ObservedObject {
    id: String,
    world_matrix: [[f64; 4]; 4],
    bounds: Option<[f64; 4]>,
    projection_status: String,
}
#[derive(Deserialize)]
struct ObservedView {
    id: String,
    camera: String,
    frame: u32,
    objects: Vec<ObservedObject>,
}
#[derive(Deserialize)]
struct Observation {
    schema: String,
    scene_sha256: String,
    views: Vec<ObservedView>,
}

fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}
fn unique<'a>(xs: impl Iterator<Item = &'a str>, what: &str) -> Result<BTreeSet<&'a str>> {
    let mut ids = BTreeSet::new();
    for id in xs {
        if !valid_id(id) || !ids.insert(id) {
            return Err(format!("invalid or duplicate {what} ID: {id}"));
        }
    }
    Ok(ids)
}
fn validate(s: &Scene) -> Result<()> {
    if s.schema != "video-scene/1"
        || s.units != "metres"
        || s.up_axis != "Z"
        || s.delivery_frames == 0
    {
        return Err("unsupported schema, coordinates or clock".into());
    }
    let ids = unique(s.objects.iter().map(|o| o.id.as_str()), "object")?;
    let assets = unique(s.assets.iter().map(|a| a.id.as_str()), "asset")?;
    unique(s.views.iter().map(|v| v.id.as_str()), "view")?;
    for a in &s.assets {
        if a.sha256.len() != 64
            || !a.sha256.bytes().all(|c| c.is_ascii_hexdigit())
            || a.path.is_empty()
        {
            return Err(format!("invalid asset provenance: {}", a.id));
        }
    }
    let objects: BTreeMap<_, _> = s.objects.iter().map(|o| (o.id.as_str(), o)).collect();
    for o in &s.objects {
        if o.label.trim().is_empty()
            || !["box", "empty", "asset", "camera"].contains(&o.kind.as_str())
        {
            return Err(format!("invalid object type/label: {}", o.id));
        }
        if o.transform
            .translation
            .iter()
            .chain(&o.transform.rotation_xyz)
            .chain(&o.transform.scale)
            .any(|v| !v.is_finite())
            || o.transform.scale.iter().any(|v| *v <= 0.0)
        {
            return Err(format!("invalid transform: {}", o.id));
        }
        if o.kind == "box" && o.dimensions.is_none() {
            return Err(format!("box missing dimensions: {}", o.id));
        }
        if o.dimensions
            .is_some_and(|d| d.iter().any(|v| !v.is_finite() || *v <= 0.0))
        {
            return Err(format!("invalid dimensions: {}", o.id));
        }
        if o.kind == "asset" && o.asset.is_none() {
            return Err(format!("asset object missing asset reference: {}", o.id));
        }
        if o.asset.as_deref().is_some_and(|a| !assets.contains(a)) {
            return Err(format!("unknown asset on {}", o.id));
        }
        let mut chain = BTreeSet::new();
        let mut current = Some(o.id.as_str());
        while let Some(id) = current {
            if !chain.insert(id) {
                return Err(format!("parent cycle at {id}"));
            }
            current = objects
                .get(id)
                .ok_or_else(|| format!("unknown parent {id}"))?
                .parent
                .as_deref();
        }
    }
    for r in &s.relationships {
        if !ids.contains(r.subject.as_str())
            || !ids.contains(r.object.as_str())
            || r.predicate.trim().is_empty()
        {
            return Err("broken relationship".into());
        }
    }
    for v in &s.views {
        if v.frame >= s.delivery_frames
            || objects
                .get(v.camera.as_str())
                .is_none_or(|o| o.kind != "camera")
        {
            return Err(format!("invalid view: {}", v.id));
        }
    }
    Ok(())
}
fn compile(s: &Scene, obs: &Observation, hash: &str) -> Result<Value> {
    validate(s)?;
    if obs.schema != "scene-observation/1" || obs.scene_sha256 != hash {
        return Err("stale or incompatible observation".into());
    }
    let objects: BTreeMap<_, _> = s.objects.iter().map(|o| (o.id.as_str(), o)).collect();
    let mut views = Vec::new();
    let mut seen = BTreeSet::new();
    for v in &obs.views {
        if !seen.insert(v.id.as_str()) {
            return Err(format!("duplicate observed view: {}", v.id));
        }
        let spec = s
            .views
            .iter()
            .find(|x| x.id == v.id)
            .ok_or("unknown observed view")?;
        if v.camera != spec.camera || v.frame != spec.frame {
            return Err(format!("camera/time mismatch: {}", v.id));
        }
        let mut regions = Vec::new();
        let mut descriptions = Vec::new();
        let mut seen_objects = BTreeSet::new();
        for ob in &v.objects {
            if !seen_objects.insert(ob.id.as_str()) {
                return Err("duplicate observed object".into());
            }
            let o = objects
                .get(ob.id.as_str())
                .ok_or("unknown observed object")?;
            if ob.world_matrix.iter().flatten().any(|x| !x.is_finite()) {
                return Err("non-finite world matrix".into());
            }
            if ![
                "in_frustum",
                "outside",
                "crosses_near_plane",
                "non_renderable",
            ]
            .contains(&ob.projection_status.as_str())
            {
                return Err("unknown projection status".into());
            }
            if ob.projection_status == "in_frustum" {
                let b = ob.bounds.ok_or("missing projected bounds")?;
                if b.iter().any(|x| !x.is_finite() || *x < 0.0 || *x > 1.0)
                    || b[0] >= b[2]
                    || b[1] >= b[3]
                {
                    return Err("invalid normalised bounds".into());
                }
                if o.prompt_enabled {
                    descriptions.push(format!("{} [{}]: {}", o.label, o.id, o.appearance));
                    regions.push(json!({"object_id":o.id,"label":o.label,"appearance":o.appearance,"constraints":o.constraints,"bounds_xyxy_top_left_normalised":b,"region_kind":"projected_bounds_not_visibility_mask","occlusion_verified":false,"world_matrix":ob.world_matrix,"reference_asset":o.asset}));
                }
            }
        }
        if seen_objects.len() != objects.len() {
            return Err(format!("incomplete object observation: {}", v.id));
        }
        views.push(json!({"id":v.id,"camera_id":v.camera,"frame":v.frame,"purpose":spec.purpose,"global_style":s.style,"positive_prompt":format!("{}\n{}",s.style,descriptions.join("\n")),"scene_constraints":s.constraints,"regions":regions,"relationships":s.relationships,"limitations":["Projected bounds are candidates only; occlusion masks required before regional influence is production-accepted.","This packet is model-neutral; no ComfyUI node compatibility or generation is implied."]}));
    }
    if seen.len() != s.views.len() {
        return Err("missing observed views".into());
    }
    Ok(
        json!({"schema":"prompt-exchange/2","scene_id":s.id,"scene_revision":s.revision,"scene_sha256":hash,"fps":s.fps,"delivery_frames":s.delivery_frames,"views":views}),
    )
}
fn read<T: serde::de::DeserializeOwned>(p: &str) -> Result<T> {
    serde_json::from_slice(&fs::read(p).map_err(|e| format!("{p}: {e}"))?)
        .map_err(|e| format!("{p}: {e}"))
}
fn run() -> Result<()> {
    let args: Vec<_> = env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("validate") if args.len() == 3 => {
            let s: Scene = read(&args[2])?;
            validate(&s)?;
            println!(
                "valid {}: {} objects, {} views",
                s.id,
                s.objects.len(),
                s.views.len()
            );
            Ok(())
        }
        Some("compile") if args.len() == 5 => {
            let s: Scene = read(&args[2])?;
            let obs: Observation = read(&args[3])?;
            let hash = format!(
                "{:x}",
                Sha256::digest(fs::read(&args[2]).map_err(|e| e.to_string())?)
            );
            let packet = compile(&s, &obs, &hash)?;
            let path = Path::new(&args[4]);
            if path.exists() {
                return Err("output exists; use a new revision path".into());
            }
            fs::write(
                path,
                serde_json::to_vec_pretty(&packet).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            println!("wrote {}", path.display());
            Ok(())
        }
        _ => Err("usage: scene-exchange validate SCENE | compile SCENE OBSERVATION OUTPUT".into()),
    }
}
fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Scene {
        serde_json::from_value(json!({"schema":"video-scene/1","id":"test","revision":"1","units":"metres","up_axis":"Z","fps":25,"delivery_frames":100,"style":"test","constraints":[],"assets":[],"relationships":[],"views":[{"id":"v","camera":"camera","frame":0,"purpose":"test"}],"objects":[{"id":"camera","label":"Camera","kind":"camera","parent":null,"transform":{"translation":[0,0,0],"rotation_xyz":[0,0,0],"scale":[1,1,1]},"dimensions":null,"asset":null,"appearance":"","constraints":[],"prompt_enabled":false}]})).unwrap()
    }
    #[test]
    fn rejects_ambiguous_identity_and_cycles() {
        let mut s = fixture();
        s.objects.push(s.objects[0].clone());
        assert!(validate(&s).unwrap_err().contains("duplicate"));
        s.objects.pop();
        s.objects[0].parent = Some("camera".into());
        assert!(validate(&s).unwrap_err().contains("cycle"));
    }
    #[test]
    fn rejects_dangling_references() {
        let mut s = fixture();
        s.objects[0].asset = Some("missing".into());
        assert!(validate(&s).is_err());
    }
    #[test]
    fn refuses_stale_or_partial_observation() {
        let s = fixture();
        let o = Observation {
            schema: "scene-observation/1".into(),
            scene_sha256: "old".into(),
            views: vec![],
        };
        assert!(compile(&s, &o, "new").unwrap_err().contains("stale"));
        assert!(compile(&s, &o, "old").unwrap_err().contains("missing"));
    }
    #[test]
    fn accepts_current_complete_observation() {
        let s = fixture();
        let o = Observation {
            schema: "scene-observation/1".into(),
            scene_sha256: "hash".into(),
            views: vec![ObservedView {
                id: "v".into(),
                camera: "camera".into(),
                frame: 0,
                objects: vec![ObservedObject {
                    id: "camera".into(),
                    world_matrix: [[0.0; 4]; 4],
                    bounds: None,
                    projection_status: "non_renderable".into(),
                }],
            }],
        };
        let packet = compile(&s, &o, "hash").unwrap();
        assert_eq!(packet["views"][0]["regions"], json!([]));
    }
}
