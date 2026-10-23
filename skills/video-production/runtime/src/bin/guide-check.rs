//! Check conditioning-video clock and held padding before GPU submission.
//!
//! Usage: `guide-check [--root DIR] VIDEO DELIVERY_COUNT MODEL_COUNT RATE NEW_RECEIPT`
//! where `RATE` is `25` or `30000/1001`. The receipt records a root-relative path.
use sha2::{Digest, Sha256};
use std::{error::Error, ffi::OsString, fs, io::Write, path::Path};
use video_production_runtime::{
    clock::RationalRate,
    guide::check_video_padding,
    paths::{Root, take_root_option},
};

fn main() -> Result<(), Box<dyn Error>> {
    let mut raw: Vec<OsString> = std::env::args_os().skip(1).collect();
    let root = Root::new(&take_root_option(&mut raw)?)?;
    let args: Vec<String> = raw
        .into_iter()
        .map(|s| s.into_string().map_err(|_| "arguments must be UTF-8"))
        .collect::<Result<_, _>>()?;
    if args.len() != 5 {
        return Err(
            "usage: guide-check [--root DIR] VIDEO DELIVERY_COUNT MODEL_COUNT RATE NEW_RECEIPT"
                .into(),
        );
    }
    let path = root.resolve(Path::new(&args[0]))?;
    let mut report = check_video_padding(
        &path,
        args[1].parse()?,
        args[2].parse()?,
        args[3].parse::<RationalRate>()?,
    )?;
    report["path"] = serde_json::json!(root.rel(&path)?);
    report["sha256"] = serde_json::json!(format!("{:x}", Sha256::digest(fs::read(&path)?)));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(root.resolve(Path::new(&args[4]))?)?;
    writeln!(file, "{}", serde_json::to_string_pretty(&report)?)?;
    println!(
        "verified guide clock and {} held padding frames",
        report["padding_frames"]
    );
    Ok(())
}
