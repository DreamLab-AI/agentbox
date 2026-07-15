#!/usr/bin/env python3
"""PVGIS client for UK ground-solar yield + optimal tilt — stdlib only, no deps.

PVGIS (EU JRC, https://re.jrc.ec.europa.eu) is the standard free source for
location-specific PV yield across Europe incl. the UK. This wraps the PVcalc endpoint
to return annual + monthly generation and PVGIS's own optimal tilt/azimuth, which the
planner uses to sanity-check the optimiser and to compute specific yield (kWh/kWp/yr).

Usage:
  pvgis_fetch.py --lat 52.2 --lon -1.5 --kwp 1000 [--tilt 35] [--azimuth 0] \
                 [--loss 14] [--optimal] [--json]

azimuth convention (PVGIS 'aspect'): 0 = south, -90 = east, +90 = west.
--optimal asks PVGIS to compute the optimal fixed tilt+azimuth (ignores --tilt/--azimuth).
"""
import argparse, json, sys, urllib.request, urllib.parse, urllib.error

API = "https://re.jrc.ec.europa.eu/api/v5_2/PVcalc"


def fetch(lat, lon, kwp, tilt, azimuth, loss, optimal, timeout=30):
    q = {
        "lat": lat, "lon": lon, "peakpower": kwp, "loss": loss,
        "pvtechchoice": "crystSi", "mountingplace": "free",  # free-standing = ground mount
        "outputformat": "json",
    }
    if optimal:
        q["optimalangles"] = 1
    else:
        q["angle"] = tilt
        q["aspect"] = azimuth
    url = API + "?" + urllib.parse.urlencode(q)
    req = urllib.request.Request(url, headers={"User-Agent": "uk-solar-planner/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def summarise(raw, kwp):
    out = raw.get("outputs", {})
    totals = out.get("totals", {}).get("fixed", {})
    monthly = out.get("monthly", {}).get("fixed", [])
    mount = raw.get("inputs", {}).get("mounting_system", {}).get("fixed", {})
    e_y = totals.get("E_y")               # annual PV output, kWh
    return {
        "annual_kwh": e_y,
        "specific_yield_kwh_per_kwp": round(e_y / kwp, 1) if e_y and kwp else None,
        "annual_poa_kwh_m2": totals.get("H(i)_y"),   # annual in-plane irradiation
        "system_loss_pct": totals.get("l_total"),
        "tilt_deg": mount.get("slope", {}).get("value"),
        "azimuth_deg": mount.get("azimuth", {}).get("value"),
        "monthly_kwh": [round(m.get("E_m", 0), 1) for m in monthly],
        "location": {"lat": raw.get("inputs", {}).get("location", {}).get("latitude"),
                     "lon": raw.get("inputs", {}).get("location", {}).get("longitude")},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--kwp", type=float, required=True, help="system DC capacity, kWp")
    ap.add_argument("--tilt", type=float, default=35.0)
    ap.add_argument("--azimuth", type=float, default=0.0, help="0=south, -90=E, +90=W")
    ap.add_argument("--loss", type=float, default=14.0, help="system losses %%")
    ap.add_argument("--optimal", action="store_true", help="let PVGIS compute optimal tilt/azimuth")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    try:
        raw = fetch(a.lat, a.lon, a.kwp, a.tilt, a.azimuth, a.loss, a.optimal)
    except urllib.error.HTTPError as e:
        print(f"PVGIS HTTP {e.code}: {e.read().decode()[:300]}", file=sys.stderr); sys.exit(2)
    except Exception as e:
        print(f"PVGIS error: {e}", file=sys.stderr); sys.exit(2)
    s = summarise(raw, a.kwp)
    if a.json:
        print(json.dumps(s, indent=2))
    else:
        print(f"PVGIS @ {s['location']['lat']:.3f},{s['location']['lon']:.3f} | "
              f"tilt {s['tilt_deg']}° az {s['azimuth_deg']}° | "
              f"{s['annual_kwh']:.0f} kWh/yr | {s['specific_yield_kwh_per_kwp']} kWh/kWp/yr | "
              f"POA {s['annual_poa_kwh_m2']:.0f} kWh/m²")


if __name__ == "__main__":
    main()
