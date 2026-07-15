#!/usr/bin/env python3
"""Quartz Solar Forecast wrapper — runs inside the gui-tools sidecar venv.

Open Climate Fix's quartz-solar-forecast (MIT) gives a 0–48h generation forecast
tuned to UK conditions (trained on 25k UK sites / MetOffice NWP). The uk-solar-planner
calls this via `docker exec gui-tools-service /opt/solar-venv/bin/python
/opt/gui-tools/forecast_quartz.py <lat> <lon> <capacity_kwp> [tilt] [orientation]`.

STDOUT carries ONLY the result JSON (forecast, or {"error": ...}); all library chatter
(quartz capacity notes, the ocf_vrmapi import warning, open-meteo logging) is routed to
STDERR so callers can `json.loads(stdout)` safely. First run downloads model weights from
HuggingFace (why it lives in the sidecar, not the pure-nix main image)."""
import sys, json, contextlib
from datetime import datetime, timezone

# Reserve the real stdout for machine-readable JSON only. quartz + openmeteo print
# progress/warnings straight to stdout, which would otherwise corrupt the JSON a caller
# parses; we redirect their stdout to stderr and emit results through this saved handle.
_RESULT_OUT = sys.stdout


def emit(obj, code=0):
    print(json.dumps(obj), file=_RESULT_OUT)
    sys.exit(code)


def main():
    if len(sys.argv) < 4:
        emit({"error": "usage: forecast_quartz.py <lat> <lon> <capacity_kwp> [tilt] [orientation]"}, 1)
    lat, lon, kwp = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])
    tilt = float(sys.argv[4]) if len(sys.argv) > 4 else 35.0
    orientation = float(sys.argv[5]) if len(sys.argv) > 5 else 180.0  # 180 = south

    # Keep our stdout pure JSON: everything the libraries print lands on stderr instead.
    with contextlib.redirect_stdout(sys.stderr):
        try:
            import requests_cache
            from quartz_solar_forecast.forecast import run_forecast
            from quartz_solar_forecast.pydantic_models import PVSite
        except Exception as e:
            emit({"error": f"quartz import failed: {e}"}, 2)

        # Force quartz's internal open-meteo CachedSession onto the in-memory backend.
        # The SQLite backend serialises each response through requests-cache's cattrs
        # serialiser, which trips over a `from __future__ import annotations` forward-ref
        # ("name 'RequestsCookieJar' is not defined") on the current cattrs/attrs line.
        # The HTTP fetch itself is fine — only the disk-cache WRITE fails — and the memory
        # backend stores the response object directly (no serialisation). For a one-shot CLI
        # forecast an ephemeral in-process cache is exactly what we want anyway. Version-
        # independent: survives future cattrs/requests-cache bumps that a pin would fight.
        _orig_cs_init = requests_cache.CachedSession.__init__

        def _mem_backend_init(self, *a, **k):
            k["backend"] = "memory"
            return _orig_cs_init(self, *a, **k)

        requests_cache.CachedSession.__init__ = _mem_backend_init

        try:
            site = PVSite(latitude=lat, longitude=lon, capacity_kwp=kwp,
                          tilt=tilt, orientation=orientation)
        except TypeError:
            # older PVSite signatures don't accept tilt/orientation
            site = PVSite(latitude=lat, longitude=lon, capacity_kwp=kwp)

        # quartz works in NAIVE-UTC throughout (its own default ts is a naive pd.Timestamp,
        # and the ICON NWP frames it fetches come back tz-naive). Passing a tz-AWARE datetime
        # makes it subtract aware from naive → "can't subtract offset-naive and offset-aware
        # datetimes". So compute UTC-now, then drop tzinfo to hand quartz a naive-UTC stamp.
        ts = datetime.now(timezone.utc).replace(tzinfo=None, minute=0, second=0, microsecond=0)
        try:
            df = run_forecast(site=site, ts=ts, nwp_source="icon")
        except Exception as e:
            emit({"error": f"forecast failed: {e}"}, 3)

        # df is a DataFrame indexed by timestamp with a power column (kW). quartz returns
        # 15-minute steps (48h -> 192 rows), so energy per step = kW * step_hours, NOT kW*1h.
        col = df.columns[0]
        idx = df.index
        step_h = ((idx[1] - idx[0]).total_seconds() / 3600.0) if len(idx) > 1 else 1.0
        series = [{"ts": str(t), "kw": round(float(v), 4)} for t, v in df[col].items()]
        result = {
            "site": {"lat": lat, "lon": lon, "capacity_kwp": kwp, "tilt": tilt, "orientation": orientation},
            "steps": len(series), "step_minutes": round(step_h * 60), "horizon_hours": round(len(series) * step_h, 1),
            "column": col,
            "forecast_total_kwh": round(sum(p["kw"] for p in series) * step_h, 2),
            "peak_kw": round(max((p["kw"] for p in series), default=0), 3),
            "series": series,
        }

    emit(result)


if __name__ == "__main__":
    main()
