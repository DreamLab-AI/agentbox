//! `comfyui-generate` — FLUX 2 one-shot image generator.
//!
//! Replaces `skills/comfyui/generate.py`. Submits the FLUX 2 workflow
//! (separate UNET/CLIP/VAE loaders + SamplerCustomAdvanced) to the external
//! ComfyUI container, polls to completion, and downloads the result. Uses the
//! `comfyui` Docker network hostname, not localhost, because this runs from
//! another container.
//!
//! Positional arguments match the Python original: `<prompt> [output.png]`.

use clap::Parser;
use serde_json::{json, Value};
use std::time::Duration;

const DEFAULT_URL: &str = "http://comfyui:8188";

#[derive(Parser)]
#[command(
    name = "comfyui-generate",
    about = "Generate an image with FLUX 2 via ComfyUI"
)]
struct Args {
    #[arg(default_value = "A beautiful sunset over mountains")]
    prompt: String,
    #[arg(default_value = "output.png")]
    output: String,
    #[arg(long, default_value_t = 1024)]
    width: u32,
    #[arg(long, default_value_t = 768)]
    height: u32,
    #[arg(long, default_value_t = 25)]
    steps: u32,
    #[arg(long, default_value_t = 4.0)]
    guidance: f64,
    /// Omit for a random seed.
    #[arg(long)]
    seed: Option<u64>,
    /// ComfyUI base URL; `COMFYUI_URL` overrides the default.
    #[arg(long)]
    url: Option<String>,
}

/// Builds the FLUX 2 graph. Node ids match the exported workflow.
fn workflow(prompt: &str, width: u32, height: u32, steps: u32, guidance: f64, seed: u64) -> Value {
    json!({
        "68": {"inputs": {"model": ["86", 0], "conditioning": ["73", 0]}, "class_type": "BasicGuider"},
        "73": {"inputs": {"guidance": guidance, "conditioning": ["85", 0]}, "class_type": "FluxGuidance"},
        "74": {"inputs": {"sampler_name": "euler"}, "class_type": "KSamplerSelect"},
        "78": {"inputs": {"vae_name": "flux2-vae.safetensors"}, "class_type": "VAELoader"},
        "79": {"inputs": {"width": width, "height": height, "batch_size": 1}, "class_type": "EmptyFlux2LatentImage"},
        "80": {"inputs": {"noise": ["87", 0], "guider": ["68", 0], "sampler": ["74", 0], "sigmas": ["94", 0], "latent_image": ["79", 0]}, "class_type": "SamplerCustomAdvanced"},
        "82": {"inputs": {"samples": ["80", 0], "vae": ["78", 0]}, "class_type": "VAEDecode"},
        "85": {"inputs": {"text": ["93", 0], "clip": ["90", 0]}, "class_type": "CLIPTextEncode"},
        "86": {"inputs": {"unet_name": "flux2_dev_fp8mixed.safetensors", "weight_dtype": "default"}, "class_type": "UNETLoader"},
        "87": {"inputs": {"noise_seed": seed}, "class_type": "RandomNoise"},
        "89": {"inputs": {"filename_prefix": "Generated", "images": ["82", 0]}, "class_type": "SaveImage"},
        "90": {"inputs": {"clip_name": "mistral_3_small_flux2_bf16.safetensors", "type": "flux2", "device": "default"}, "class_type": "CLIPLoader"},
        "93": {"inputs": {"value": prompt}, "class_type": "PrimitiveString"},
        "94": {"inputs": {"steps": steps, "width": width, "height": height}, "class_type": "Flux2Scheduler"}
    })
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let a = Args::parse();
    let base = a
        .url
        .or_else(|| std::env::var("COMFYUI_URL").ok())
        .unwrap_or_else(|| DEFAULT_URL.to_string());

    let seed = a.seed.unwrap_or_else(|| {
        // Matches Python's random.randint(0, 2**32).
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos() as u64 ^ d.as_secs())
            .unwrap_or(0);
        nanos % (1u64 << 32)
    });

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()?;

    let submitted: Value = client
        .post(format!("{base}/prompt"))
        .json(&json!({"prompt": workflow(&a.prompt, a.width, a.height, a.steps, a.guidance, seed)}))
        .send()?
        .error_for_status()?
        .json()?;

    let prompt_id = submitted
        .get("prompt_id")
        .and_then(Value::as_str)
        .ok_or("ComfyUI did not return a prompt_id")?
        .to_string();
    println!("Submitted: {prompt_id}");

    loop {
        let history: Value = client
            .get(format!("{base}/history/{prompt_id}"))
            .send()?
            .json()?;
        let entry = history
            .get(&prompt_id)
            .cloned()
            .unwrap_or_else(|| json!({}));
        let status = entry
            .pointer("/status/status_str")
            .and_then(Value::as_str)
            .unwrap_or("pending");

        match status {
            "success" => {
                let outputs = entry.get("outputs").and_then(Value::as_object);
                if let Some(outputs) = outputs {
                    for node_out in outputs.values() {
                        let Some(filename) = node_out
                            .pointer("/images/0/filename")
                            .and_then(Value::as_str)
                        else {
                            continue;
                        };
                        let url = format!(
                            "{base}/view?filename={}&type=output",
                            urlencoding::encode(filename)
                        );
                        let bytes = client.get(url).send()?.error_for_status()?.bytes()?;
                        std::fs::write(&a.output, &bytes)?;
                        println!("Saved: {}", a.output);
                        return Ok(());
                    }
                }
            }
            "error" => return Err("Generation failed".into()),
            _ => {}
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}
