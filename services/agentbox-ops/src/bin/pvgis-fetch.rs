//! `pvgis-fetch` — PVGIS client for UK ground-solar yield and optimal tilt.
//!
//! Replaces `skills/uk-solar-planner/tools/pvgis_fetch.py`. Same flags, same
//! stdout, same exit codes (2 on any PVGIS error).
//!
//! Azimuth convention (PVGIS `aspect`): 0 = south, -90 = east, +90 = west.

use agentbox_ops::pyjson;
use agentbox_ops::solar::{fetch, summarise, PvgisQuery};
use clap::Parser;
use std::time::Duration;

#[derive(Parser)]
#[command(
    name = "pvgis-fetch",
    about = "PVGIS yield and optimal tilt for a UK site"
)]
struct Args {
    #[arg(long)]
    lat: f64,
    #[arg(long)]
    lon: f64,
    /// System DC capacity, kWp.
    #[arg(long)]
    kwp: f64,
    #[arg(long, default_value_t = 35.0)]
    tilt: f64,
    /// 0 = south, -90 = east, +90 = west.
    #[arg(long, default_value_t = 0.0)]
    azimuth: f64,
    /// System losses, percent.
    #[arg(long, default_value_t = 14.0)]
    loss: f64,
    /// Let PVGIS compute the optimal tilt and azimuth.
    #[arg(long)]
    optimal: bool,
    #[arg(long)]
    json: bool,
}

fn main() {
    let a = Args::parse();
    let query = PvgisQuery {
        lat: a.lat,
        lon: a.lon,
        kwp: a.kwp,
        tilt: a.tilt,
        azimuth: a.azimuth,
        loss: a.loss,
        optimal: a.optimal,
    };

    let raw = match fetch(&query, Duration::from_secs(30)) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("PVGIS error: {e}");
            std::process::exit(2);
        }
    };

    let s = summarise(&raw, a.kwp);
    if a.json {
        println!("{}", pyjson::dumps_indent(&s, 2));
        return;
    }

    println!(
        "PVGIS @ {:.3},{:.3} | tilt {}° az {}° | {:.0} kWh/yr | {} kWh/kWp/yr | POA {:.0} kWh/m²",
        s.location.lat.unwrap_or(a.lat),
        s.location.lon.unwrap_or(a.lon),
        s.tilt_deg
            .map(|v| v.to_string())
            .unwrap_or_else(|| "None".into()),
        s.azimuth_deg
            .map(|v| v.to_string())
            .unwrap_or_else(|| "None".into()),
        s.annual_kwh.unwrap_or(0.0),
        s.specific_yield_kwh_per_kwp
            .map(|v| v.to_string())
            .unwrap_or_else(|| "None".into()),
        s.annual_poa_kwh_m2.unwrap_or(0.0),
    );
}
