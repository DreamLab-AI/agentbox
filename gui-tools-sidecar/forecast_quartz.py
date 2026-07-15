#!/usr/bin/env python3
"""Quartz Solar Forecast wrapper — runs inside the gui-tools sidecar venv.

Open Climate Fix's quartz-solar-forecast (MIT) gives a 0–48h generation forecast
tuned to UK conditions (trained on 25k UK sites / MetOffice NWP). The uk-solar-planner
calls this via `docker exec gui-tools-service /opt/solar-venv/bin/python
/opt/gui-tools/forecast_quartz.py <lat> <lon> <capacity_kwp> [tilt] [orientation]`.

Prints a JSON forecast (timestamps + predicted kW). First run downloads model weights
from HuggingFace (why it lives in the sidecar, not the pure-nix main image)."""
import sys, json


def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "usage: forecast_quartz.py <lat> <lon> <capacity_kwp> [tilt] [orientation]"}))
        sys.exit(1)
    lat, lon, kwp = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])
    tilt = float(sys.argv[4]) if len(sys.argv) > 4 else 35.0
    orientation = float(sys.argv[5]) if len(sys.argv) > 5 else 180.0  # 180 = south

    try:
        from quartz_solar_forecast.forecast import run_forecast
        from quartz_solar_forecast.pydantic_models import PVSite
        from datetime import datetime, timezone
    except Exception as e:
        print(json.dumps({"error": f"quartz import failed: {e}"})); sys.exit(2)

    try:
        site = PVSite(latitude=lat, longitude=lon, capacity_kwp=kwp,
                      tilt=tilt, orientation=orientation)
    except TypeError:
        # older PVSite signatures don't accept tilt/orientation
        site = PVSite(latitude=lat, longitude=lon, capacity_kwp=kwp)

    ts = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    try:
        df = run_forecast(site=site, ts=ts, nwp_source="icon")
    except Exception as e:
        print(json.dumps({"error": f"forecast failed: {e}"})); sys.exit(3)

    # df is a DataFrame indexed by timestamp with a power column (kW).
    col = df.columns[0]
    series = [{"ts": str(idx), "kw": round(float(v), 4)} for idx, v in df[col].items()]
    total_kwh = round(sum(p["kw"] for p in series), 2)  # hourly steps → kW≈kWh
    print(json.dumps({
        "site": {"lat": lat, "lon": lon, "capacity_kwp": kwp, "tilt": tilt, "orientation": orientation},
        "horizon_hours": len(series), "column": col,
        "forecast_total_kwh_48h": total_kwh,
        "peak_kw": round(max((p["kw"] for p in series), default=0), 3),
        "series": series,
    }))


if __name__ == "__main__":
    main()
