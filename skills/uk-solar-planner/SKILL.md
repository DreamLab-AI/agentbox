---
name: uk-solar-planner
description: "Plan UK ground-mounted (utility-scale) solar farms end-to-end: site suitability, optimal tilt and inter-row spacing (GCR), array capacity and annual yield, 3D layout with inter-row shadow review, generation forecasting, and DNO grid-connection feasibility. Composes the qgis (site/terrain/ALC/flood) and blender (3D array + shading) skills with PVGIS yield data, Open Climate Fix's quartz-solar-forecast, and OpenDSS grid modelling. Use whenever the task involves a UK solar farm / solar site / ground-mount PV array — assessing a field or parcel for solar, sizing capacity, choosing panel tilt/row spacing, estimating kWh/yield or land use, visualising an array layout, checking shading, forecasting generation, or DNO/grid-connection pre-checks (e.g. 'is this 30-acre field good for solar', 'what tilt and spacing for a solar farm near Peterborough', 'how many MW fit on 20 hectares', 'model the array layout and winter shadows'). UK-specific (latitude, diffuse light, ALC land grades, DNO). Not for rooftop domestic PV or non-UK sites without adjustment."
---

# UK Ground-Mounted Solar Planner

An end-to-end planner for UK utility-scale ground-mount solar, composing our **qgis** and
**blender** skills with public solar data (PVGIS), UK-tuned forecasting (Open Climate Fix
quartz), and OpenDSS grid modelling. It turns a site (coordinates + area) into a defensible
capacity, yield, layout, and grid-feasibility picture.

## The pipeline (run in order; each stage feeds the next)

| # | Stage | Tool / skill | Status here |
|---|-------|--------------|-------------|
| 1 | **Site suitability** — slope/aspect, ALC land grade, flood zone, grid proximity | **qgis** skill + `references/grid-and-planning.md` | works (qgis sidecar) |
| 2 | **Tilt + spacing + capacity + yield** — the engineering core | `tools/solar_optimize.py` (+ `pvgis_fetch.py`) | **works now** (stdlib + live PVGIS) |
| 3 | **3D layout + shadow review** — array on terrain, inter-row winter shadows | `tools/blender_solar_array.py` (**blender** skill) | works (blender / gui-tools sidecar) |
| 4 | **Generation forecast** — 0–48h UK-tuned generation curve | `tools/sidecar_run.sh forecast …` (quartz) | needs sidecar rebuild¹ |
| 5 | **DNO grid feasibility** — voltage rise, thermal, hosting capacity | OpenDSS MCP (register on demand) | needs sidecar rebuild¹ |

¹ Stages 4–5 use Python deps nix can't cleanly package (quartz pulls ML weights at runtime;
opendssdirect vendors a compiled engine), so they're baked into the FHS **gui-tools** sidecar.
Bring them online with `./agentbox.sh gui-tools rebuild` then `./agentbox.sh gui-tools up`.
Stages 1–3 need no rebuild.

## Stage 2 — the engineering core (start here for any sizing question)

```bash
python3 tools/solar_optimize.py --lat 52.2 --lon -1.5 --area-ha 20 --tilt land
```
Computes, from first principles (see `references/siting-engineering.md` for the cited
formulas): the winter-solstice no-shade **row pitch** and **GCR**, the **tilt** (either the
PVGIS per-module optimum ~38–43°, or the land-optimised ~25–35° that maximises kWh/hectare),
the **module count** and **DC capacity**, the **annual yield** (live PVGIS `PVcalc`), and the
**land-use ratio** sense-checked against the DESNZ 2024 fleet band (1.88–2.7 ha/MW). It emits
warnings when a result falls outside real-world bounds (e.g. GCR too dense) rather than
silently returning an optimistic number.

`tools/pvgis_fetch.py` is the standalone PVGIS client (annual/monthly yield + PVGIS's own
optimal tilt/azimuth) — stdlib, no deps.

## Stage 3 — 3D layout + shadow review (leverages the blender skill)

```bash
# headless GPU-capable, or run in the gui-tools sidecar:
blender --background --factory-startup --python tools/blender_solar_array.py -- \
  '{"rows":8,"modules_per_row":24,"tilt_deg":30,"row_pitch":9.9,"sun_altitude_deg":15,"render":true}'
```
Builds the racked array on a ground plane, reports GCR/footprint, and (with a sun at the
winter-solstice noon altitude, `90 − lat − 23.44`) casts the **inter-row shadows** that set
the row pitch. Feed `row_pitch`/`tilt` from Stage 2. See the **blender** skill for GPU/sidecar
execution and rendering.

## Stages 4–5 — forecast + grid (sidecar)

```bash
tools/sidecar_run.sh forecast 52.2 -1.5 14420 30 180   # lat lon kWp tilt orientation → 0–48h curve
```
Grid feasibility uses the OpenDSS MCP server (baked in the sidecar); register it on demand for
native tools, or script it via `tools/sidecar_run.sh python …`. `references/grid-and-planning.md`
covers UK DNO connection (G99, LV/11kV/33kV by capacity), what a first-pass OpenDSS model needs,
planning (ALC "Best & Most Versatile" avoidance, NSIP/DCO >50 MW), and SEG export economics.

## References

- `references/siting-engineering.md` — tilt/GCR/PVGIS formulas, UK yield bands, GIS inputs (all cited).
- `references/grid-and-planning.md` — DNO connection, OpenDSS pre-check, UK planning + ALC, SEG.

## Attribution

PVGIS (EU JRC, free public API). quartz-solar-forecast (Open Climate Fix, MIT). opendss-mcp-server
(MIT) wrapping EPRI OpenDSS. All engineering figures are cited to primary sources in the references;
the optimiser and layout tools are original implementations of standard, non-proprietary methods.
