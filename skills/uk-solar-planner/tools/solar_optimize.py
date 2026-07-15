#!/usr/bin/env python3
"""UK ground-mount solar optimiser — tilt, inter-row spacing (GCR), capacity, yield.

Stdlib only. Implements the standard UK design chain (see references/siting.md):
  - winter-solstice no-shade row pitch:  α = 90 − lat − 23.44 ;
    pitch = L·cos β + L·sin β / tan α ;  GCR = L / pitch
  - two tilt regimes: per-module optimum (max kWh/kWp, ~38–43° UK via PVGIS) vs
    land-optimised (max kWh/ha, ~25–35°) — GCR is the coupling variable
  - usable area → GCR-packed module count → DC capacity → PVGIS annual yield →
    land-use ratio (ha/MW), sense-checked against the DESNZ 2024 fleet band 1.88–2.7

Yield comes from PVGIS (via pvgis_fetch.py in the same dir); if unreachable it falls
back to the UK regional band with a clear flag.

Usage:
  solar_optimize.py --lat 52.2 --lon -1.5 --area-ha 20 [--exclusion-pct 8] \
      [--tilt land|pvgis|<deg>] [--module-wp 590] [--module-area 2.58] \
      [--module-slant 2.278] [--modules-high 2] [--gcr-cap 0.5] [--losses 14]
"""
import argparse, json, math, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def winter_noon_altitude(lat):
    return 90.0 - lat - 23.44  # solar noon altitude on 21 Dec (N hemisphere)


def row_pitch(slant, tilt_deg, sun_alt_deg):
    b = math.radians(tilt_deg); a = math.radians(sun_alt_deg)
    return slant * math.cos(b) + slant * math.sin(b) / math.tan(a)


def pvgis(lat, lon, kwp, tilt, azimuth, losses, optimal=False):
    cmd = [sys.executable, os.path.join(HERE, "pvgis_fetch.py"),
           "--lat", str(lat), "--lon", str(lon), "--kwp", str(kwp),
           "--loss", str(losses), "--json"]
    if optimal:
        cmd.append("--optimal")
    else:
        cmd += ["--tilt", str(tilt), "--azimuth", str(azimuth)]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=45)
    if out.returncode != 0:
        return None
    return json.loads(out.stdout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--area-ha", type=float, required=True, help="gross site area, hectares")
    ap.add_argument("--exclusion-pct", type=float, default=8.0, help="tracks/buffers/substation etc.")
    ap.add_argument("--tilt", default="land", help="'land' (~UK GCR-optimal), 'pvgis' (per-module optimum), or a number")
    ap.add_argument("--module-wp", type=float, default=590.0)
    ap.add_argument("--module-area", type=float, default=2.58, help="module area m² (e.g. 2.278×1.134)")
    ap.add_argument("--module-slant", type=float, default=2.278, help="module dim along tilt, m")
    ap.add_argument("--modules-high", type=int, default=2, help="modules stacked up the rack")
    ap.add_argument("--gcr-cap", type=float, default=0.5, help="max allowed GCR (shading tolerance)")
    ap.add_argument("--losses", type=float, default=14.0)
    a = ap.parse_args()

    lat, lon = a.lat, a.lon
    gross_m2 = a.area_ha * 10000.0
    usable_m2 = gross_m2 * (1 - a.exclusion_pct / 100.0)
    slant = a.module_slant * a.modules_high  # table slant length
    alpha = winter_noon_altitude(lat)

    warnings = []

    # Resolve tilt.
    pvgis_opt = pvgis(lat, lon, 1, None, None, a.losses, optimal=True)
    opt_tilt = pvgis_opt["tilt_deg"] if pvgis_opt else None
    opt_az = pvgis_opt["azimuth_deg"] if pvgis_opt else 0.0
    if a.tilt == "pvgis":
        tilt = opt_tilt or 40.0
    elif a.tilt == "land":
        # land-optimised: clamp the per-module optimum down into the UK 25–35° band
        tilt = min(35.0, max(25.0, (opt_tilt or 35.0) - 8.0))
    else:
        tilt = float(a.tilt)

    # Row pitch + GCR from the winter no-shade rule, capped for shading tolerance.
    pitch = row_pitch(slant, tilt, alpha)
    gcr = slant / pitch
    if gcr > a.gcr_cap:
        gcr = a.gcr_cap
        pitch = slant / gcr
        warnings.append(f"GCR capped at {a.gcr_cap}; winter no-shade GCR would be higher (denser).")
    if gcr < 0.30:
        warnings.append(f"GCR {gcr:.2f} < 0.30 — unusually sparse; check tilt/latitude.")

    # Module count (area-based GCR packing) → capacity.
    packed_area = usable_m2 * gcr
    module_count = math.floor(packed_area / a.module_area)
    dc_kwp = module_count * a.module_wp / 1000.0
    dc_mw = dc_kwp / 1000.0

    # Annual yield from PVGIS at the chosen tilt.
    y = pvgis(lat, lon, max(dc_kwp, 1.0), tilt, opt_az, a.losses)
    if y and y.get("specific_yield_kwh_per_kwp"):
        specific = y["specific_yield_kwh_per_kwp"]; src = "PVGIS"
    else:
        specific = 975.0; src = "fallback UK band (900–1050)"; warnings.append("PVGIS unreachable — used fallback specific yield.")
    annual_kwh = dc_kwp * specific

    # Land-use ratio vs DESNZ 2024 fleet band.
    ha_per_mw = a.area_ha / dc_mw if dc_mw else None
    if ha_per_mw and ha_per_mw < 1.88:
        warnings.append(f"Land use {ha_per_mw:.2f} ha/MW < 1.88 (denser than the DESNZ fleet band — recheck exclusions/GCR).")
    if ha_per_mw and ha_per_mw > 2.7:
        warnings.append(f"Land use {ha_per_mw:.2f} ha/MW > 2.7 (looser than the DESNZ fleet band — capacity may be conservative).")

    result = {
        "site": {"lat": lat, "lon": lon, "gross_area_ha": a.area_ha,
                 "exclusion_pct": a.exclusion_pct, "usable_area_ha": round(usable_m2 / 10000, 2)},
        "tilt": {"chosen_deg": round(tilt, 1), "mode": a.tilt,
                 "pvgis_per_module_optimum_deg": opt_tilt, "optimal_azimuth_deg": opt_az},
        "spacing": {"winter_noon_sun_altitude_deg": round(alpha, 2),
                    "table_slant_length_m": round(slant, 2),
                    "row_pitch_m": round(pitch, 2), "gcr": round(gcr, 3)},
        "capacity": {"module_count": module_count, "module_wp": a.module_wp,
                     "dc_capacity_mwp": round(dc_mw, 3)},
        "yield": {"specific_yield_kwh_per_kwp": specific, "source": src,
                  "annual_generation_mwh": round(annual_kwh / 1000, 1),
                  "annual_generation_gwh": round(annual_kwh / 1e6, 3)},
        "land_use": {"ha_per_mw": round(ha_per_mw, 2) if ha_per_mw else None,
                     "desnz_2024_band_ha_per_mw": [1.88, 2.7]},
        "warnings": warnings,
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
