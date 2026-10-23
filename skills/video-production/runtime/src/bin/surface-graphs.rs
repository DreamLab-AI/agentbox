//! Compile Klein bounded edits from verified surface-mask receipts.
//! Usage: surface-graphs CONFIG.json NEW_DIRECTORY COMFY_URL.
//! Uploads inputs but never submits GPU work; use the durable batch runner.
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    env,
    error::Error,
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use video_production_runtime::paths::{Root, take_root_option};
type Result<T> = std::result::Result<T, Box<dyn Error>>;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Asset {
    path: PathBuf,
    sha256: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Edit {
    surface: Asset,
    region: String,
    references: Vec<Asset>,
    prompt: String,
    seed: u64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    schema: String,
    edits: BTreeMap<String, Edit>,
}
fn sha(p: &Path) -> Result<String> {
    Ok(format!("{:x}", Sha256::digest(fs::read(p)?)))
}
fn checked(a: &Asset) -> Result<()> {
    if sha(&a.path)? != a.sha256 {
        return Err(format!("changed input {}", a.path.display()).into());
    }
    Ok(())
}
fn report_asset(v: &Value) -> Result<Asset> {
    let a = serde_json::from_value::<Asset>(v.clone())?;
    checked(&a)?;
    Ok(a)
}
fn upload(a: &Asset, url: &str) -> Result<String> {
    checked(a)?;
    let filename = a
        .path
        .file_name()
        .and_then(|p| p.to_str())
        .ok_or("bad asset filename")?;
    // Hash-based names isolate concurrent preparations and make repeated uploads safe.
    let input_name = format!("surface-{}-{filename}", &a.sha256[..16]);
    let field = format!("image=@{};filename={input_name}", a.path.display());
    let r = Command::new("curl")
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--max-time",
            "120",
            "-F",
            &field,
            "-F",
            "overwrite=false",
            &format!("{}/upload/image", url.trim_end_matches('/')),
        ])
        .output()?;
    if !r.status.success() {
        return Err(String::from_utf8_lossy(&r.stderr).into_owned().into());
    }
    let v: Value = serde_json::from_slice(&r.stdout)?;
    let name = v["name"].as_str().ok_or("upload missing filename")?;
    Ok(match v["subfolder"].as_str() {
        Some(s) if !s.is_empty() => format!("{s}/{name}"),
        _ => name.into(),
    })
}
fn graph(
    source: &str,
    sampling: &str,
    final_alpha: &str,
    refs: &[String],
    edit: &Edit,
    size: [u64; 2],
    id: &str,
) -> Value {
    let (prompt, seed, width, height) = (&edit.prompt, edit.seed, size[0], size[1]);
    let mut g = json!({
        "model":{"class_type":"UNETLoader","inputs":{"unet_name":"flux-2-klein-4b.safetensors","weight_dtype":"default"}},
        "clip":{"class_type":"CLIPLoader","inputs":{"clip_name":"qwen_3_4b.safetensors","type":"flux2","device":"default"}},
        "vae":{"class_type":"VAELoader","inputs":{"vae_name":"flux2-vae.safetensors"}},
        "source":{"class_type":"LoadImage","inputs":{"image":source}},
        "sampling-mask":{"class_type":"LoadImageMask","inputs":{"image":sampling,"channel":"red"}},
        "final-mask":{"class_type":"LoadImageMask","inputs":{"image":final_alpha,"channel":"red"}},
        "source-latent":{"class_type":"VAEEncode","inputs":{"pixels":["source",0],"vae":["vae",0]}},
        "inpaint":{"class_type":"VAEEncodeForInpaint","inputs":{"pixels":["source",0],"vae":["vae",0],"mask":["sampling-mask",0],"grow_mask_by":8}},
        "text":{"class_type":"CLIPTextEncode","inputs":{"clip":["clip",0],"text":prompt}},
        "negative":{"class_type":"ConditioningZeroOut","inputs":{"conditioning":["text",0]}},
        "source-positive":{"class_type":"ReferenceLatent","inputs":{"conditioning":["text",0],"latent":["source-latent",0]}},
        "source-negative":{"class_type":"ReferenceLatent","inputs":{"conditioning":["negative",0],"latent":["source-latent",0]}},
        "guider":{"class_type":"CFGGuider","inputs":{"model":["model",0],"positive":["source-positive",0],"negative":["source-negative",0],"cfg":1.}},
        "noise":{"class_type":"RandomNoise","inputs":{"noise_seed":seed}},
        "sampler":{"class_type":"KSamplerSelect","inputs":{"sampler_name":"euler"}},
        "sigmas":{"class_type":"Flux2Scheduler","inputs":{"steps":4,"width":width,"height":height}},
        "sample":{"class_type":"SamplerCustomAdvanced","inputs":{"noise":["noise",0],"guider":["guider",0],"sampler":["sampler",0],"sigmas":["sigmas",0],"latent_image":["inpaint",0]}},
        "decode":{"class_type":"VAEDecode","inputs":{"samples":["sample",0],"vae":["vae",0]}},
        "bounded":{"class_type":"ImageCompositeMasked","inputs":{"destination":["source",0],"source":["decode",0],"x":0,"y":0,"resize_source":false,"mask":["final-mask",0]}},
        "raw-save":{"class_type":"SaveImage","inputs":{"images":["decode",0],"filename_prefix":format!("surface-edits/{id}-raw")}},
        "save":{"class_type":"SaveImage","inputs":{"images":["bounded",0],"filename_prefix":format!("surface-edits/{id}-bounded")}}
    });
    let (mut positive, mut negative) =
        ("source-positive".to_string(), "source-negative".to_string());
    for (i, name) in refs.iter().enumerate() {
        let prefix = format!("reference-{}", i + 2);
        let load = prefix.clone();
        let scale = format!("{prefix}-scale");
        let latent = format!("{prefix}-latent");
        let pos = format!("{prefix}-positive");
        let neg = format!("{prefix}-negative");
        g[&load] = json!({"class_type":"LoadImage","inputs":{"image":name}});
        g[&scale] = json!({"class_type":"ImageScaleToTotalPixels","inputs":{"image":[load,0],"upscale_method":"lanczos","megapixels":0.25,"resolution_steps":1}});
        g[&latent] =
            json!({"class_type":"VAEEncode","inputs":{"pixels":[scale,0],"vae":["vae",0]}});
        g[&pos] = json!({"class_type":"ReferenceLatent","inputs":{"conditioning":[positive,0],"latent":[latent,0]}});
        g[&neg] = json!({"class_type":"ReferenceLatent","inputs":{"conditioning":[negative,0],"latent":[latent,0]}});
        positive = pos;
        negative = neg;
    }
    g["guider"]["inputs"]["positive"] = json!([positive, 0]);
    g["guider"]["inputs"]["negative"] = json!([negative, 0]);
    g
}
fn main() -> Result<()> {
    let mut raw: Vec<std::ffi::OsString> = env::args_os().skip(1).collect();
    let root = Root::new(&take_root_option(&mut raw)?)?;
    let a = raw;
    if a.len() != 3 {
        return Err(
            "usage: surface-graphs [--root DIR] CONFIG.json NEW_DIRECTORY COMFY_URL".into(),
        );
    }
    std::env::set_current_dir(root.dir())?;
    let config = Path::new(&a[0]);
    let out = Path::new(&a[1]);
    let url = a[2].to_str().ok_or("invalid URL")?;
    let c: Config = serde_json::from_slice(&fs::read(config)?)?;
    if c.schema != "surface-graphs/1"
        || c.edits.is_empty()
        || out.exists()
        || !(url.starts_with("http://") || url.starts_with("https://"))
    {
        return Err("invalid config, URL or existing output".into());
    }
    // Validate every local input before any upload or output creation.
    let mut views = BTreeMap::new();
    for (id, e) in &c.edits {
        if id.is_empty()
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
            || e.prompt.trim().is_empty()
            || e.references.is_empty()
        {
            return Err("invalid edit ID, prompt or references".into());
        }
        checked(&e.surface)?;
        let r: Value = serde_json::from_slice(&fs::read(&e.surface.path)?)?;
        if r["schema"] != "surface-masks-result/1" || !r["edits"][&e.region].is_object() {
            return Err("invalid surface receipt or missing edit region".into());
        }
        for v in [
            &r["output_source"],
            &r["edits"][&e.region]["sampling_alpha"],
            &r["edits"][&e.region]["final_alpha"],
        ] {
            report_asset(v)?;
        }
        for asset in &e.references {
            checked(asset)?;
        }
        if r["resolution"][0].as_u64().is_none() || r["resolution"][1].as_u64().is_none() {
            return Err("missing dimensions".into());
        }
        views.insert(id.clone(), r);
    }
    fs::create_dir(out)?;
    let graphs = out.join("graphs");
    fs::create_dir(&graphs)?;
    let mut results = BTreeMap::new();
    for (id, e) in &c.edits {
        let r = &views[id];
        let region = &r["edits"][&e.region];
        let source = upload(&report_asset(&r["output_source"])?, url)?;
        let sampling = upload(&report_asset(&region["sampling_alpha"])?, url)?;
        let final_alpha = upload(&report_asset(&region["final_alpha"])?, url)?;
        let refs: Vec<_> = e
            .references
            .iter()
            .map(|a| upload(a, url))
            .collect::<Result<_>>()?;
        let g = graph(
            &source,
            &sampling,
            &final_alpha,
            &refs,
            e,
            [
                r["resolution"][0].as_u64().unwrap(),
                r["resolution"][1].as_u64().unwrap(),
            ],
            id,
        );
        let path = graphs.join(format!("{id}.api.json"));
        fs::write(&path, serde_json::to_vec_pretty(&g)?)?;
        results.insert(id,json!({"graph":path,"graph_sha256":sha(&path)?,"source_scene_sha256":r["source_scene_sha256"],"master_frame":r["master_frame"],"surface_receipt":e.surface.path,"surface_receipt_sha256":e.surface.sha256,"region":e.region,"reference_order":"image_1=actual native source; image_2 onward=references in config order","uploaded_source":source,"uploaded_sampling_alpha":sampling,"uploaded_final_alpha":final_alpha,"uploaded_references":refs,"raw_output_node":"raw-save","bounded_output_node":"save","acceptance":"Not inferred from execution. Integer-composite raw-save with final_alpha and inspect scene/identity/contacts before use."}));
    }
    let mut prepared = json!({"schema":"surface-graphs-prepared/1","config":config,"config_sha256":sha(config)?,"url":url,"edits":results,"gpu_submitted":false});
    root.relativise(&mut prepared)?;
    fs::write(
        out.join("prepared.json"),
        serde_json::to_vec_pretty(&prepared)?,
    )?;
    println!("{}", graphs.display());
    Ok(())
}
