//! Measure every join of an assembled cut and write a receipt.
//!
//! Usage: `seam-qa [--root DIR] CONFIG RECEIPT`. `CONFIG` is a `seam-qa/1` JSON
//! file (cut asset, seam frames, optional overlaps, threshold set); `RECEIPT`
//! is written inside the production root. Exit status: 0 PASS (a
//! measurement; acceptance is editorial), 1 FAIL, 2 BLOCKED or NOT_RUN, 3 error.
use std::{error::Error, ffi::OsString, fs};
use video_production_runtime::{
    paths::{Root, take_root_option},
    seam_qa::{Config, run},
};

const HELP: &str = "usage: seam-qa [--root DIR] CONFIG RECEIPT\n\
Measure each seam of an assembled cut (pop, look steps, detail, audio step and\n\
click, overlap PSNR) against a threshold set and write a receipt.\n\
CONFIG and RECEIPT are relative to the production root (--root, $BLENDER_SHARE, cwd).\n\
exit: 0 PASS (a measurement; acceptance is editorial), 1 FAIL, 2 BLOCKED/NOT_RUN, 3 error";

fn execute() -> Result<i32, Box<dyn Error>> {
    let mut args: Vec<OsString> = std::env::args_os().skip(1).collect();
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!("{HELP}");
        return Ok(0);
    }
    let root = Root::new(&take_root_option(&mut args)?)?;
    let [config_path, receipt_path] = args.as_slice() else {
        return Err(HELP.into());
    };
    let config: Config = serde_json::from_slice(&fs::read(root.resolve(config_path.as_ref())?)?)?;
    let receipt = run(&root, &config)?;
    let dest = root.resolve(receipt_path.as_ref())?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&dest, serde_json::to_vec_pretty(&receipt)?)?;
    let verdict = receipt["verdict"].as_str().unwrap_or("BLOCKED");
    println!("seam-qa {verdict} (measurement only: acceptance is editorial)");
    Ok(match verdict {
        "PASS" => 0,
        "FAIL" => 1,
        _ => 2,
    })
}

fn main() {
    match execute() {
        Ok(code) => std::process::exit(code),
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(3);
        }
    }
}
