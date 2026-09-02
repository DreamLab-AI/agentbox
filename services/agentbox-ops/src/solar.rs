//! UK ground-mount solar planning: the PVGIS client and the tilt/spacing
//! arithmetic behind `pvgis-fetch` and `solar-optimize`.
//!
//! Ported from `skills/uk-solar-planner/tools/{pvgis_fetch,solar_optimize}.py`
//! (both explicitly "stdlib only, no deps"). The design chain is documented in
//! that skill's `references/siting.md`.

use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

pub const API: &str = "https://re.jrc.ec.europa.eu/api/v5_2/PVcalc";

/// The DESNZ 2024 fleet land-use band, hectares per MW.
pub const DESNZ_BAND: [f64; 2] = [1.88, 2.7];

#[derive(Debug, Serialize)]
pub struct Location {
    pub lat: Option<f64>,
    pub lon: Option<f64>,
}

/// The `summarise()` projection over a PVGIS PVcalc response.
#[derive(Debug, Serialize)]
pub struct PvgisSummary {
    pub annual_kwh: Option<f64>,
    pub specific_yield_kwh_per_kwp: Option<f64>,
    #[serde(rename = "annual_poa_kwh_m2")]
    pub annual_poa_kwh_m2: Option<f64>,
    pub system_loss_pct: Option<f64>,
    pub tilt_deg: Option<f64>,
    pub azimuth_deg: Option<f64>,
    pub monthly_kwh: Vec<f64>,
    pub location: Location,
}

fn num(v: &Value) -> Option<f64> {
    v.as_f64()
}

/// Rounds half away from zero, as Python's `round()` does for the values here.
fn round_to(value: f64, places: i32) -> f64 {
    let factor = 10f64.powi(places);
    (value * factor).round() / factor
}

/// Projects the raw PVGIS payload onto the summary the planner consumes.
pub fn summarise(raw: &Value, kwp: f64) -> PvgisSummary {
    let totals = raw.pointer("/outputs/totals/fixed");
    let monthly = raw
        .pointer("/outputs/monthly/fixed")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mount = raw.pointer("/inputs/mounting_system/fixed");

    let e_y = totals.and_then(|t| t.get("E_y")).and_then(num);

    PvgisSummary {
        annual_kwh: e_y,
        specific_yield_kwh_per_kwp: match (e_y, kwp) {
            (Some(e), k) if e != 0.0 && k != 0.0 => Some(round_to(e / k, 1)),
            _ => None,
        },
        annual_poa_kwh_m2: totals.and_then(|t| t.get("H(i)_y")).and_then(num),
        system_loss_pct: totals.and_then(|t| t.get("l_total")).and_then(num),
        tilt_deg: mount.and_then(|m| m.pointer("/slope/value")).and_then(num),
        azimuth_deg: mount
            .and_then(|m| m.pointer("/azimuth/value"))
            .and_then(num),
        monthly_kwh: monthly
            .iter()
            .map(|m| round_to(m.get("E_m").and_then(num).unwrap_or(0.0), 1))
            .collect(),
        location: Location {
            lat: raw.pointer("/inputs/location/latitude").and_then(num),
            lon: raw.pointer("/inputs/location/longitude").and_then(num),
        },
    }
}

/// Query parameters for one PVcalc call.
#[derive(Debug, Clone, Copy)]
pub struct PvgisQuery {
    pub lat: f64,
    pub lon: f64,
    pub kwp: f64,
    pub tilt: f64,
    pub azimuth: f64,
    pub loss: f64,
    pub optimal: bool,
}

/// Builds the PVcalc URL. Split out from the request so it can be tested
/// without network access.
pub fn build_url(q: &PvgisQuery) -> String {
    let mut params: Vec<(String, String)> = vec![
        ("lat".into(), fmt_num(q.lat)),
        ("lon".into(), fmt_num(q.lon)),
        ("peakpower".into(), fmt_num(q.kwp)),
        ("loss".into(), fmt_num(q.loss)),
        ("pvtechchoice".into(), "crystSi".into()),
        // free-standing = ground mount
        ("mountingplace".into(), "free".into()),
        ("outputformat".into(), "json".into()),
    ];
    if q.optimal {
        params.push(("optimalangles".into(), "1".into()));
    } else {
        params.push(("angle".into(), fmt_num(q.tilt)));
        params.push(("aspect".into(), fmt_num(q.azimuth)));
    }
    let qs = params
        .iter()
        .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    format!("{API}?{qs}")
}

/// Renders a float the way Python's `str()` does for these values, so the
/// query string stays identical (`35.0`, not `35`).
fn fmt_num(v: f64) -> String {
    if v.fract() == 0.0 && v.abs() < 1e15 {
        format!("{:.1}", v)
    } else {
        format!("{}", v)
    }
}

/// Calls PVGIS and returns the parsed payload.
pub fn fetch(q: &PvgisQuery, timeout: Duration) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(build_url(q))
        .header("User-Agent", "uk-solar-planner/1.0")
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let body = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let snippet: String = body.chars().take(300).collect();
        return Err(format!("PVGIS HTTP {}: {}", status.as_u16(), snippet));
    }
    serde_json::from_str(&body).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// solar_optimize arithmetic
// ---------------------------------------------------------------------------

/// Solar-noon altitude on 21 December in the northern hemisphere.
pub fn winter_noon_altitude(lat: f64) -> f64 {
    90.0 - lat - 23.44
}

/// Inter-row pitch for a no-shade winter solstice: `L·cos β + L·sin β / tan α`.
pub fn row_pitch(slant: f64, tilt_deg: f64, sun_alt_deg: f64) -> f64 {
    let b = tilt_deg.to_radians();
    let a = sun_alt_deg.to_radians();
    slant * b.cos() + slant * b.sin() / a.tan()
}

/// The three tilt regimes accepted by `--tilt`.
#[derive(Debug, Clone, PartialEq)]
pub enum TiltMode {
    /// Land-optimised: clamp the per-module optimum into the UK 25-35 degree band.
    Land,
    /// PVGIS's own per-module optimum.
    Pvgis,
    /// An explicit angle in degrees.
    Fixed(f64),
}

impl TiltMode {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "land" => Ok(Self::Land),
            "pvgis" => Ok(Self::Pvgis),
            other => other
                .parse::<f64>()
                .map(Self::Fixed)
                .map_err(|_| format!("Invalid --tilt '{other}': use 'land', 'pvgis', or a number")),
        }
    }

    /// Resolves the mode against PVGIS's optimum (`None` when unreachable).
    pub fn resolve(&self, pvgis_optimum: Option<f64>) -> f64 {
        match self {
            Self::Pvgis => pvgis_optimum.unwrap_or(40.0),
            Self::Land => 35.0f64.min(25.0f64.max(pvgis_optimum.unwrap_or(35.0) - 8.0)),
            Self::Fixed(v) => *v,
        }
    }
}

/// Ground-coverage ratio and pitch after the shading-tolerance cap.
pub struct Packing {
    pub pitch: f64,
    pub gcr: f64,
    pub capped: bool,
    pub sparse: bool,
}

/// Applies the winter no-shade rule, then the GCR cap.
pub fn pack(slant: f64, tilt: f64, alpha: f64, gcr_cap: f64) -> Packing {
    let mut pitch = row_pitch(slant, tilt, alpha);
    let mut gcr = slant / pitch;
    let mut capped = false;
    if gcr > gcr_cap {
        gcr = gcr_cap;
        pitch = slant / gcr;
        capped = true;
    }
    Packing {
        pitch,
        gcr,
        capped,
        sparse: gcr < 0.30,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn winter_altitude_matches_the_documented_formula() {
        // 90 - 52.2 - 23.44
        assert!((winter_noon_altitude(52.2) - 14.36).abs() < 1e-9);
    }

    #[test]
    fn row_pitch_grows_as_the_sun_drops() {
        let high = row_pitch(4.556, 30.0, 25.0);
        let low = row_pitch(4.556, 30.0, 14.36);
        assert!(low > high, "a lower winter sun must force a wider pitch");
    }

    #[test]
    fn row_pitch_at_zero_tilt_is_the_slant_length() {
        assert!((row_pitch(4.0, 0.0, 15.0) - 4.0).abs() < 1e-9);
    }

    #[test]
    fn land_mode_clamps_into_the_uk_band() {
        assert_eq!(TiltMode::Land.resolve(Some(41.0)), 33.0);
        // Clamped up: 20 - 8 = 12 -> 25.
        assert_eq!(TiltMode::Land.resolve(Some(20.0)), 25.0);
        // Clamped down: 50 - 8 = 42 -> 35.
        assert_eq!(TiltMode::Land.resolve(Some(50.0)), 35.0);
        // PVGIS unreachable: 35 - 8 = 27.
        assert_eq!(TiltMode::Land.resolve(None), 27.0);
    }

    #[test]
    fn pvgis_mode_falls_back_to_forty_degrees() {
        assert_eq!(TiltMode::Pvgis.resolve(None), 40.0);
        assert_eq!(TiltMode::Pvgis.resolve(Some(38.5)), 38.5);
    }

    #[test]
    fn tilt_mode_parses_all_three_forms() {
        assert_eq!(TiltMode::parse("land").unwrap(), TiltMode::Land);
        assert_eq!(TiltMode::parse("pvgis").unwrap(), TiltMode::Pvgis);
        assert_eq!(TiltMode::parse("32.5").unwrap(), TiltMode::Fixed(32.5));
        assert!(TiltMode::parse("sideways").is_err());
    }

    #[test]
    fn gcr_cap_widens_the_pitch() {
        // A 5-degree tilt packs to GCR 0.748 by the no-shade rule alone.
        let p = pack(4.556, 5.0, 14.36, 0.5);
        assert!(
            p.capped,
            "a shallow tilt at this latitude exceeds a 0.5 cap"
        );
        assert!((p.gcr - 0.5).abs() < 1e-12);
        assert!((p.pitch - 4.556 / 0.5).abs() < 1e-9);
    }

    #[test]
    fn uncapped_packing_keeps_the_no_shade_geometry() {
        let p = pack(4.556, 35.0, 14.36, 0.9);
        assert!(!p.capped);
        assert!((p.gcr - 4.556 / row_pitch(4.556, 35.0, 14.36)).abs() < 1e-12);
    }

    #[test]
    fn summarise_projects_the_pvgis_payload() {
        let raw = json!({
            "inputs": {
                "location": {"latitude": 52.2, "longitude": -1.5},
                "mounting_system": {"fixed": {"slope": {"value": 35}, "azimuth": {"value": 0}}}
            },
            "outputs": {
                "totals": {"fixed": {"E_y": 9500.0, "H(i)_y": 1180.0, "l_total": -14.2}},
                "monthly": {"fixed": [{"E_m": 300.44}, {"E_m": 480.55}]}
            }
        });
        let s = summarise(&raw, 10.0);
        assert_eq!(s.annual_kwh, Some(9500.0));
        assert_eq!(s.specific_yield_kwh_per_kwp, Some(950.0));
        assert_eq!(s.tilt_deg, Some(35.0));
        assert_eq!(s.monthly_kwh, vec![300.4, 480.6]);
        assert_eq!(s.location.lat, Some(52.2));
    }

    #[test]
    fn summarise_tolerates_a_missing_payload() {
        let s = summarise(&json!({}), 10.0);
        assert_eq!(s.annual_kwh, None);
        assert_eq!(s.specific_yield_kwh_per_kwp, None);
        assert!(s.monthly_kwh.is_empty());
    }

    #[test]
    fn optimal_url_omits_the_explicit_angles() {
        let url = build_url(&PvgisQuery {
            lat: 52.2,
            lon: -1.5,
            kwp: 1000.0,
            tilt: 35.0,
            azimuth: 0.0,
            loss: 14.0,
            optimal: true,
        });
        assert!(url.contains("optimalangles=1"));
        assert!(!url.contains("angle="));
        assert!(!url.contains("aspect="));
    }

    #[test]
    fn fixed_url_carries_angle_and_aspect() {
        let url = build_url(&PvgisQuery {
            lat: 52.2,
            lon: -1.5,
            kwp: 1000.0,
            tilt: 35.0,
            azimuth: -90.0,
            loss: 14.0,
            optimal: false,
        });
        assert!(url.contains("angle=35.0"));
        assert!(url.contains("aspect=-90.0"));
        assert!(!url.contains("optimalangles"));
    }
}
