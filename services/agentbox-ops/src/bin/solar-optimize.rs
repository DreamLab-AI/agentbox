//! `solar-optimize` — UK ground-mount tilt, inter-row spacing, capacity, yield.
//!
//! Replaces `skills/uk-solar-planner/tools/solar_optimize.py`. The Python
//! version shelled out to `pvgis_fetch.py`; this calls the shared client
//! directly, which removes a subprocess per run without changing the output.

use agentbox_ops::pyjson;
use agentbox_ops::solar::{
    fetch, pack, summarise, winter_noon_altitude, PvgisQuery, TiltMode, DESNZ_BAND,
};
use clap::Parser;
use serde_json::json;
use std::time::Duration;

/// UK regional fallback when PVGIS is unreachable (band 900-1050).
const FALLBACK_SPECIFIC_YIELD: f64 = 975.0;

#[derive(Parser)]
#[command(
    name = "solar-optimize",
    about = "UK ground-mount solar array optimiser"
)]
struct Args {
    #[arg(long)]
    lat: f64,
    #[arg(long)]
    lon: f64,
    /// Gross site area, hectares.
    #[arg(long = "area-ha")]
    area_ha: f64,
    /// Tracks, buffers, substation and so on.
    #[arg(long = "exclusion-pct", default_value_t = 8.0)]
    exclusion_pct: f64,
    /// 'land' (UK GCR-optimal), 'pvgis' (per-module optimum), or a number.
    #[arg(long, default_value = "land")]
    tilt: String,
    #[arg(long = "module-wp", default_value_t = 590.0)]
    module_wp: f64,
    /// Module area, m².
    #[arg(long = "module-area", default_value_t = 2.58)]
    module_area: f64,
    /// Module dimension along the tilt, m.
    #[arg(long = "module-slant", default_value_t = 2.278)]
    module_slant: f64,
    /// Modules stacked up the rack.
    #[arg(long = "modules-high", default_value_t = 2)]
    modules_high: i64,
    /// Maximum allowed GCR (shading tolerance).
    #[arg(long = "gcr-cap", default_value_t = 0.5)]
    gcr_cap: f64,
    #[arg(long, default_value_t = 14.0)]
    losses: f64,
}

fn round_to(v: f64, places: i32) -> f64 {
    let f = 10f64.powi(places);
    (v * f).round() / f
}

fn main() {
    let a = Args::parse();
    let mode = match TiltMode::parse(&a.tilt) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };

    let gross_m2 = a.area_ha * 10_000.0;
    let usable_m2 = gross_m2 * (1.0 - a.exclusion_pct / 100.0);
    let slant = a.module_slant * a.modules_high as f64;
    let alpha = winter_noon_altitude(a.lat);
    let mut warnings: Vec<String> = Vec::new();

    // Ask PVGIS for the per-module optimum, which anchors both tilt regimes.
    let optimum = fetch(
        &PvgisQuery {
            lat: a.lat,
            lon: a.lon,
            kwp: 1.0,
            tilt: 0.0,
            azimuth: 0.0,
            loss: a.losses,
            optimal: true,
        },
        Duration::from_secs(45),
    )
    .ok()
    .map(|raw| summarise(&raw, 1.0));

    let opt_tilt = optimum.as_ref().and_then(|s| s.tilt_deg);
    let opt_az = optimum.as_ref().and_then(|s| s.azimuth_deg).unwrap_or(0.0);
    let tilt = mode.resolve(opt_tilt);

    let p = pack(slant, tilt, alpha, a.gcr_cap);
    if p.capped {
        warnings.push(format!(
            "GCR capped at {}; winter no-shade GCR would be higher (denser).",
            a.gcr_cap
        ));
    }
    if p.sparse {
        warnings.push(format!(
            "GCR {:.2} < 0.30 — unusually sparse; check tilt/latitude.",
            p.gcr
        ));
    }

    let module_count = (usable_m2 * p.gcr / a.module_area).floor() as i64;
    let dc_kwp = module_count as f64 * a.module_wp / 1000.0;
    let dc_mw = dc_kwp / 1000.0;

    // Annual yield at the chosen tilt.
    let yielded = fetch(
        &PvgisQuery {
            lat: a.lat,
            lon: a.lon,
            kwp: dc_kwp.max(1.0),
            tilt,
            azimuth: opt_az,
            loss: a.losses,
            optimal: false,
        },
        Duration::from_secs(45),
    )
    .ok()
    .map(|raw| summarise(&raw, dc_kwp.max(1.0)));

    let (specific, source) = match yielded.as_ref().and_then(|s| s.specific_yield_kwh_per_kwp) {
        Some(v) => (v, "PVGIS".to_string()),
        None => {
            warnings.push("PVGIS unreachable — used fallback specific yield.".into());
            (
                FALLBACK_SPECIFIC_YIELD,
                "fallback UK band (900–1050)".to_string(),
            )
        }
    };
    let annual_kwh = dc_kwp * specific;

    let ha_per_mw = if dc_mw != 0.0 {
        Some(a.area_ha / dc_mw)
    } else {
        None
    };
    if let Some(h) = ha_per_mw {
        if h < DESNZ_BAND[0] {
            warnings.push(format!(
                "Land use {h:.2} ha/MW < 1.88 (denser than the DESNZ fleet band — recheck exclusions/GCR)."
            ));
        }
        if h > DESNZ_BAND[1] {
            warnings.push(format!(
                "Land use {h:.2} ha/MW > 2.7 (looser than the DESNZ fleet band — capacity may be conservative)."
            ));
        }
    }

    let result = json!({
        "site": {
            "lat": a.lat, "lon": a.lon, "gross_area_ha": a.area_ha,
            "exclusion_pct": a.exclusion_pct, "usable_area_ha": round_to(usable_m2 / 10_000.0, 2)
        },
        "tilt": {
            "chosen_deg": round_to(tilt, 1), "mode": a.tilt,
            "pvgis_per_module_optimum_deg": opt_tilt, "optimal_azimuth_deg": opt_az
        },
        "spacing": {
            "winter_noon_sun_altitude_deg": round_to(alpha, 2),
            "table_slant_length_m": round_to(slant, 2),
            "row_pitch_m": round_to(p.pitch, 2), "gcr": round_to(p.gcr, 3)
        },
        "capacity": {
            "module_count": module_count, "module_wp": a.module_wp,
            "dc_capacity_mwp": round_to(dc_mw, 3)
        },
        "yield": {
            "specific_yield_kwh_per_kwp": specific, "source": source,
            "annual_generation_mwh": round_to(annual_kwh / 1000.0, 1),
            "annual_generation_gwh": round_to(annual_kwh / 1e6, 3)
        },
        "land_use": {
            "ha_per_mw": ha_per_mw.map(|h| round_to(h, 2)),
            "desnz_2024_band_ha_per_mw": DESNZ_BAND
        },
        "warnings": warnings,
    });

    println!("{}", pyjson::dumps_indent(&result, 2));
}
