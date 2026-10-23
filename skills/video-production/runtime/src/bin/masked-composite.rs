//! Composite a bounded image repair in integer RGB and verify the saved PNG.
//!
//! Usage: masked-composite SOURCE REPAIR ALPHA NEW_OUTPUT NEW_RECEIPT.
//! ImageMagick supplies decoding/encoding; zero-alpha pixels must remain exact.
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    env,
    error::Error,
    fs,
    io::Write,
    path::Path,
    process::{Command, Stdio},
};
use video_production_runtime::paths::{Root, take_root_option};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn pixels(path: &str, format: &str) -> Result<Vec<u8>> {
    let result = Command::new("magick")
        .args([path, "-depth", "8", &format!("{format}:-")])
        .output()?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).into_owned().into());
    }
    Ok(result.stdout)
}

fn dimensions(path: &str) -> Result<String> {
    let result = Command::new("magick")
        .args(["identify", "-format", "%wx%h", path])
        .output()?;
    if !result.status.success() {
        return Err("cannot read dimensions".into());
    }
    Ok(String::from_utf8(result.stdout)?)
}

fn asset(path: &str) -> Result<serde_json::Value> {
    Ok(json!({"path": path, "sha256": format!("{:x}", Sha256::digest(fs::read(path)?))}))
}

fn main() -> Result<()> {
    let mut raw: Vec<std::ffi::OsString> = env::args_os().skip(1).collect();
    let root = Root::new(&take_root_option(&mut raw)?)?;
    let args: Vec<String> = raw
        .into_iter()
        .map(|s| s.into_string().map_err(|_| "arguments must be UTF-8"))
        .collect::<std::result::Result<_, _>>()?;
    if args.len() != 5 {
        return Err(
            "usage: masked-composite [--root DIR] SOURCE REPAIR ALPHA NEW_OUTPUT NEW_RECEIPT"
                .into(),
        );
    }
    std::env::set_current_dir(root.dir())?;
    let (source, repair, alpha, output, receipt) =
        (&args[0], &args[1], &args[2], &args[3], &args[4]);
    if Path::new(output).exists() || Path::new(receipt).exists() {
        return Err("output and receipt must be new".into());
    }
    let size = dimensions(source)?;
    if dimensions(repair)? != size || dimensions(alpha)? != size {
        return Err("image dimensions differ".into());
    }
    let original = pixels(source, "rgb")?;
    let replacement = pixels(repair, "rgb")?;
    let mask = pixels(alpha, "gray")?;
    if original.len() != replacement.len() || original.len() != mask.len() * 3 {
        return Err("unexpected decoded pixel count".into());
    }
    let mut composite = original.clone();
    for (i, &weight) in mask.iter().enumerate() {
        for channel in 0..3 {
            let j = i * 3 + channel;
            composite[j] = ((u32::from(original[j]) * (255 - u32::from(weight))
                + u32::from(replacement[j]) * u32::from(weight)
                + 127)
                / 255) as u8;
        }
    }
    let mut child = Command::new("magick")
        .args([
            "-size",
            &size,
            "-depth",
            "8",
            "rgb:-",
            "-define",
            "png:color-type=2",
            output,
        ])
        .stdin(Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .ok_or("missing encoder stdin")?
        .write_all(&composite)?;
    if !child.wait()?.success() {
        return Err("PNG encoding failed".into());
    }
    let saved = pixels(output, "rgb")?;
    if saved != composite {
        return Err("saved PNG differs from intended integer composite".into());
    }
    let outside = mask.iter().filter(|&&weight| weight == 0).count();
    let changed = mask
        .iter()
        .enumerate()
        .filter(|&(i, &weight)| {
            weight == 0 && original[i * 3..i * 3 + 3] != saved[i * 3..i * 3 + 3]
        })
        .count();
    if outside == 0 || changed != 0 {
        return Err("outside-mask preservation failed or no outside pixels".into());
    }
    let mut report = json!({"schema":"masked-composite/1", "source":asset(source)?,
        "repair":asset(repair)?, "alpha":asset(alpha)?, "output":asset(output)?,
        "dimensions":size,"outside_alpha_pixels":outside,"changed_outside_alpha_pixels":changed,
        "blend":"8-bit RGB round((source*(255-alpha)+repair*alpha)/255)",
        "scope":"Pixel preservation only; no identity, geometry or temporal acceptance."});
    root.relativise(&mut report)?;
    fs::write(
        receipt,
        format!("{}\n", serde_json::to_string_pretty(&report)?),
    )?;
    println!("verified {outside} unchanged outside-alpha pixels");
    Ok(())
}
