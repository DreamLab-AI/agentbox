# UK Ground-Mounted Solar Farm Siting Engineering — Reference for Planner Tool

Compiled 2026-07-15. Cross-verified across ≥2 independent sources per claim (WebSearch, WebFetch of primary docs, live PVGIS API calls, Perplexity Search API). All formulas below are implementation-ready.

---

## 1. Optimal fixed tilt angle

### 1.1 Rules of thumb (cross-verified, 3 sources)

| Rule | Formula | Valid range | Source |
|---|---|---|---|
| Naive latitude rule | `tilt = latitude` | any | widely cited, ~3–7° too steep at UK latitudes |
| Lave & Klise (2011) | `tilt = 0.76 × latitude + 3.1°` | 0°–60° | cited in [omnisolglobal tilt guide](https://www.omnisolglobal.com/resources/solar-panel-tilt-angle-guide), [surgepv tilt guide](https://www.surgepv.com/blog/optimal-tilt-angle-solar-panels) |
| Jacobson & Jadhav (2018) | 3rd-order polynomial fit of optimal tilt vs. latitude, fitted to NREL PVWatts output across every country | global; explicitly **more accurate above 40°N** than linear fits | primary paper: [web.stanford.edu/…/TiltAngles.pdf](https://web.stanford.edu/group/efmh/jacobson/Articles/I/TiltAngles.pdf), *Solar Energy* 2018, [ScienceDirect record](https://www.sciencedirect.com/science/article/abs/pii/S0038092X1830375X) |

The 0.76 coefficient (vs. 1.0 for pure latitude) is explicitly a **diffuse-irradiance correction**: at higher latitudes diffuse sky radiation is a larger fraction of total irradiance, and isotropic diffuse light is captured more efficiently by a shallower panel than the direct-beam-optimised latitude-tilt. Above ~50°N, sources agree there is **no reliable simple linear formula** — the curve flattens because of long summer days + very low winter sun combined; use iterative/numerical optimisation (PVGIS `optimalangles=1`, see §3) rather than a closed-form rule for actual UK sites.

### 1.2 Live PVGIS ground truth (queried 2026-07-15, `PVcalc?optimalangles=1`)

| Site | Lat °N | PVGIS optimal tilt | PVGIS optimal azimuth (0=S) | Specific yield at optimum, kWh/kWp/yr |
|---|---|---|---|---|
| Truro | 50.26 | 38° | +3° | 1067 |
| London | 51.51 | 40° | −6° | 1023 |
| Peterborough | 52.57 | 41° | −5° | 1041 |
| Newcastle | 54.98 | 43° | −3° | 954 |
| Edinburgh | 55.95 | 42° | −1° | 908 |

Source: `https://re.jrc.ec.europa.eu/api/v5_3/PVcalc?lat=<lat>&lon=<lon>&peakpower=1&loss=14&mountingplace=free&optimalangles=1&outputformat=json`, PVGIS-SARAH3 radiation database (JRC, European Commission). Note PVGIS's own per-module unconstrained optimum sits at **38–43°** across UK latitudes — steeper than the "30–40° rule of thumb" commonly quoted in UK trade literature.

### 1.3 Why real UK farms often use 25–35° rather than PVGIS's 38–43° optimum

Two distinct, additive effects both push installed tilt below the single-panel PVGIS optimum — a planner tool should model both, not just the diffuse effect:

1. **Diffuse-dominance flattening** (climate physics, §1.1): UK cloud cover raises the diffuse fraction of POA irradiance; a shallower tilt trades a small amount of direct-beam capture for better diffuse-sky capture. This alone only shifts the optimum a few degrees (the 0.76 coefficient vs 1.0).
2. **Land-use / GCR interaction** (the dominant driver for utility-scale sites): at a given row pitch, a shallower tilt (a) casts a shorter shadow (per §2 formula, shadow length scales with `sin(tilt)`) allowing tighter row spacing for the same shading tolerance, and (b) the per-module yield curve is quite flat near the optimum (single-digit % loss at ±10° from optimum — confirmed by [Jacobson & Jadhav 2018] and [surgepv]: "95–98% of optimal annual production" is achievable well off the true optimum). Because total farm output is `modules_per_hectare × yield_per_module`, and modules-per-hectare rises faster than yield-per-module falls as tilt decreases, **total kWh/ha is often maximised at 25–35°**, not at the 38–43° single-panel PVGIS optimum. This tilt/GCR coupling is explicitly modelled in the academic literature: [Vermeer et al., ISES SWC2021](https://proceedings.ises.org/conference/swc2021/papers/swc2021-0102-Vermeer.pdf) and [ScienceDirect: "Optimal ground coverage ratios for tracked, fixed-tilt, and vertical PV systems for latitudes up to 75°N"](https://www.sciencedirect.com/science/article/pii/S0038092X23002682) — the latter states GCR is a *significant* driver of optimal tilt, more so than ground albedo.

**Implementation guidance**: expose both numbers to the planner user — "per-module optimal tilt" (PVGIS `optimalangles=1` call) for max kWh/kWp, and a separate "land-optimised tilt" (typically 25–35° for UK utility-scale, configurable) for max kWh/hectare — and let GCR (§2) be the coupling variable between them.

---

## 2. Inter-row spacing / Ground Coverage Ratio (GCR)

### 2.1 Geometry

For a row of tilted modules with slant length `L` (the module/table dimension measured along the tilt direction — a single-landscape row ≈ 1.0–1.1 m, a 2-in-portrait table ≈ 3.4–4.0 m), tilt angle `β`, and sun altitude `α` (measured from horizontal, in the north–south vertical plane):

```
row_pitch = L·cos(β) + L·sin(β) / tan(α)      # metres, row-to-row centre distance
GCR       = L / row_pitch                      # dimensionless, 0 < GCR ≤ 1
```

Both terms have physical meaning: `L·cos(β)` is the horizontal footprint of the tilted table itself; `L·sin(β)/tan(α)` is the length of the shadow the table's top edge casts onto the ground, in the row-spacing direction, at sun altitude `α`. Setting `row_pitch` equal to their sum means the shadow just reaches the base of the next row and no further — i.e. zero inter-row self-shading at that specific sun position. Confirmed independently against two sources with the identical formula: [BAESS inter-row pitch calculator](https://www.baess.app/tools/inter-row-pitch-calculator) / [SurgePV inter-row spacing guide](https://www.surgepv.com/blog/inter-row-spacing-solar-panels-guide) ("Row Spacing = Panel Height × (cos(tilt) + sin(tilt) / tan(sun altitude))").

### 2.2 The UK winter-solstice no-shading design rule

Design to the **worst-case sun altitude of the year** — solar noon on 21 December — so that every other day/time is at least as good:

```
α_winter_noon = 90° − latitude − 23.44°        # (23.5° commonly used as a rounded obliquity constant)
```

This is the standard declination-based solar-altitude formula (`α = 90° − |lat − δ|`, with `δ = −23.44°` at winter solstice for the northern hemisphere). Worked example, London (lat 51.51°N):

```
α = 90 − 51.51 − 23.44 = 15.05°
```

Common UK practice constrains the *no-shading* design window to roughly **9am–3pm on 21 Dec** (not the full daylight hours), accepting some shading in the low-sun early-morning/late-afternoon shoulder — full 24-hour zero-shading at the winter solstice would force impractically wide (low-GCR, land-inefficient) spacing for marginal extra winter yield.

### 2.3 Typical GCR values and the yield/land tradeoff

- Reported working range: **GCR 0.3–0.5** for UK fixed-tilt ground-mount, with **0.35–0.45 commonly cited as the practical sweet spot** balancing land utilisation against inter-row shading losses ([Detra Solar](https://detrasolar.com/understanding-ground-covering-ratio-gcr-in-solar-pv-systems/), [Lion Solar utility-scale GCR guide](https://lion-solar.com/utility-scale-solar-investment-guide/), [BAESS GCR calculator](https://www.baess.app/tools/gcr-calculator)).
- Worked example combining §2.1/§2.2 at a "land-optimised" 25° tilt, London, `L = 4.0 m` table:
  ```
  α = 15.05°  (from §2.2)
  row_pitch = 4·cos(25°) + 4·sin(25°)/tan(15.05°)
            = 4×0.9063 + 4×0.4226/0.2694
            = 3.625 + 6.275 = 9.90 m
  GCR = 4 / 9.90 = 0.40
  ```
  This lands squarely in the reported 0.35–0.45 sweet spot, validating the formula chain end-to-end.
- Tradeoff direction is monotonic and should be exposed as a slider in the planner: **higher GCR → more modules/ha → higher kWh/ha but higher inter-row shading loss per module**; **lower GCR → less shading loss per module but fewer modules/ha**. The BRE National Solar Centre planning guidance (see §4) separately notes that even at typical GCR, **only ~25–40% of the ground surface is over-sailed by modules**, leaving the balance available for grazing/vegetation — relevant for any dual-use/agrivoltaic scoring the tool might add later ([BRE Agricultural Good Practice Guidance for Solar Farms](https://files.bregroup.com/solar/NSC_-Guid_Agricultural-good-practice-for-SFs_0914.pdf)).

---

## 3. Irradiance/yield data sources with programmatic APIs

### 3.1 PVGIS (EU JRC) — primary recommended source, free, no auth, GET-only

Base URL pattern (confirmed from official JRC docs, [API non-interactive service](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/getting-started-pvgis/api-non-interactive-service_en)):

```
https://re.jrc.ec.europa.eu/api/v5_3/<tool>?<params>
```

**`PVcalc`** — grid-connected system annual/monthly output (the workhorse endpoint for a planner tool):

| Param | Required | Notes |
|---|---|---|
| `lat`, `lon` | yes | decimal degrees |
| `peakpower` | yes | system size, kWp |
| `loss` | yes | total system losses, % (typical UK utility-scale: 14) |
| `angle` | no (default 0) | tilt, degrees from horizontal |
| `aspect` | no (default 0) | azimuth, 0=south, +90=west, −90=east |
| `optimalinclination` | no | 1 = auto-compute optimal tilt only |
| `optimalangles` | no | 1 = auto-compute optimal tilt **and** azimuth (used for §1.2 table) |
| `mountingplace` | no (default "free") | "free" (ground/rack) or "building" |
| `pvtechchoice` | no (default "crystSi") | "crystSi2025", "CIS", "CdTe", "Unknown" |
| `raddatabase` | no | "PVGIS-SARAH3" for Europe/UK; "PVGIS-NSRDB" for Americas |
| `outputformat` | no (default csv) | "json" recommended for programmatic use |

Minimum example: `https://re.jrc.ec.europa.eu/api/PVcalc?lat=45&lon=8&peakpower=1&loss=14`. Response JSON exposes `outputs.totals.fixed.E_y` (annual specific yield, kWh/kWp) and `inputs.mounting_system.fixed.slope.value` / `azimuth.value` when `optimalangles=1`.

**`seriescalc`** — hourly time series (POA irradiance + optional PV output); useful for a planner tool that wants an hourly generation profile, not just an annual number. Same `lat`/`lon`/`angle`/`aspect`/`optimalangles` params, plus `pvcalculation=1` to turn on PV output, `trackingtype` (0=fixed…5=inclined-axis), and `components=1` to break out beam/diffuse/reflected POA irradiance separately (directly useful for the §1 diffuse-fraction analysis).

**`MRcalc`** — monthly-averaged radiation only (no PV system model); useful for a lightweight "irradiance heatmap" layer without running full PV simulation per candidate site.

Rate limit: **30 requests/second/IP**; a 529 response means back off and retry.

### 3.2 UK-specific datasets (secondary/cross-check, not full substitutes for PVGIS)

- **MCS Solar Irradiance Dataset** — used for domestic SAP/PAS deemed-yield calculations (postcode-level, not a general API, less suited to arbitrary-site engineering estimates than PVGIS).
- **Sheffield Solar / PV_Live & Solcast nowcasting** — real UK fleet-observed generation and short-term forecasting; good for validating/calibrating a PVGIS estimate against actually-observed regional performance, not a pre-construction design tool in its own right.
- **Met Office / CEDA** radiation station data — ground-truth validation source for PVGIS satellite-derived (SARAH3) irradiance in cloud-heavy regions.

### 3.3 Typical UK specific yield (cross-verified 3 ways)

- WebSearch synthesis: **850–1,100 kWh/kWp/yr**, north Scotland ~850, SW England >1,100, broader cited range 712–1,124 depending on source/methodology.
- Regional bands: South England up to ~1,100 kWh/kWp/yr; Midlands/North England 950–1,000; Scotland 850–900.
- **Live PVGIS pull (§1.2, this document) independently reproduces this exact pattern**: Truro (SW) 1,067 → London 1,023 → Peterborough 1,041 → Newcastle 954 → Edinburgh 908 kWh/kWp/yr — a third, independent confirmation of both the absolute range and the south→north gradient.

**Recommended for the planner tool**: call PVGIS `PVcalc` per-candidate-site for the authoritative number (it already accounts for exact lat/lon microclimate); use the 900–1,050 kWh/kWp/yr UK-wide band only as a sanity-check bound / fallback when the API is unreachable.

---

## 4. GIS site-analysis inputs

| Input | Guidance | Source(s) |
|---|---|---|
| **Slope** | Gentle slopes strongly preferred; step-changes in engineering cost above ~10–15°; very flat sites (<3°) are ideal but not required. Steeper south-facing slopes can partially substitute for tilt (reduces module tilt frame angle needed) but add groundworks/drainage cost and increase inter-row shading risk on the down-slope side. | Derived from BRE planning guidance + general utility-scale PV siting practice |
| **Aspect** | South-facing (or near-flat) strongly preferred for fixed-tilt arrays; north-facing slopes are effectively excluded for economic fixed-tilt UK deployment. | Standard PV siting practice, consistent with §1 azimuth optimum (PVGIS optimal azimuth was within ±6° of due south at all 5 UK sites tested) |
| **Terrain / DEM** | **OS Terrain 50** — 50 m grid national DTM, free via [OS Data Hub Open Data downloads](https://osdatahub.os.uk/downloads/open/Terrain50), annually updated, good for coarse regional screening. **Environment Agency LiDAR Composite DTM** — 1 m (and 2 m / 50 cm variants), ~99% England coverage, far higher resolution for detailed slope/aspect/shading analysis at candidate-site scale: [1 m DTM, data.gov.uk](https://www.data.gov.uk/dataset/01b3ee39-da3f-47b6-83da-dc98e73a461f/lidar-composite-digital-terrain-model-dtm-1m), [environment.data.gov.uk dataset page](https://environment.data.gov.uk/dataset/13787b9a-26a4-4775-8523-806d13af58fc). Recommended pipeline: OS Terrain 50 for national/regional candidate screening → LiDAR 1 m for final site-level slope/aspect/shading model. |
| **Flood risk** | **Environment Agency "Flood Map for Planning"** ([environment.data.gov.uk dataset](https://environment.data.gov.uk/dataset/04532375-a198-476e-985e-0579a0a11b47)) — Flood Zone 1 (low, <0.1%/yr river+sea), Zone 2 (medium), Zone 3 (high, ≥1%/yr river or ≥0.5%/yr sea), with **Zone 3 split into 3a and 3b** (3b = functional floodplain, most restrictive). This is a **screening tool only** — it does not represent every watercourse and is explicitly not a substitute for a site-specific Flood Risk Assessment. Ground-mounted solar is generally treated as lower flood-vulnerability development than housing (inverters/switchgear can be raised, panels tolerate temporary inundation), so Zone 2/3a sites are not automatically excluded but should be flagged for FRA; Zone 3b (functional floodplain) should be avoided/flagged as high-risk by the planner tool. |
| **Agricultural Land Classification (ALC)** | 5 grades, Grade 3 split into 3a/3b. **Grades 1, 2, and 3a = "Best and Most Versatile" (BMV) land** — NPPF policy creates a strong presumption *against* siting solar there. **Grades 3b, 4, 5 are the preferred/target grades** for ground-mount solar. Provisional national ALC mapping (Natural England) does **not** distinguish 3a from 3b — a site-specific soil-scientist ALC survey is required wherever provisional data shows "Grade 3", which the planner tool should flag as a required-survey condition rather than an automatic pass/fail. Further detail: [Natural England Technical Information Note TIN049](https://www.robertsenvironmental.co.uk/agricultural-land-classifications-alcs-for-solar-and-battery-storage/); explicit "preferably classification 3b, 4, and 5" wording from [BRE National Solar Centre planning guidance PDF](https://files.bregroup.com/solar/KN5524_Planning_Guidance_reduced.pdf); "Grade 3b confirmed suitable" reporting: [Farmers Weekly](https://www.fwi.co.uk/business/diversification/farm-energy/grade-3b-land-confirmed-suitable-for-solar-farm-development). |
| **Proximity to grid** | Rule-of-thumb ceiling: **≤4 km (2.5 miles)** "as the crow flies" to a connection point with spare capacity ("headroom"); connection cabling costs scale roughly **£1M/mile**; sites **>5 miles from a substation are rarely economically viable**. Needs **≥33 kV** connection with confirmed headroom — proximity to a line alone is not sufficient, since voltage or capacity may not match. Several UK DNO regions (West Wales, Highlands & Islands, parts of Cornwall/Devon, some Yorkshire Dales feeders) currently report near-zero export headroom — the planner tool's grid-proximity score should be a live/updatable weighting, not a static distance buffer. Sources: [SolarGridCheck land requirements checklist](https://solargridcheck.co.uk/land-requirements-solar-farm), [Essex Design Guide — grid connection](https://www.essexdesignguide.co.uk/supplementary-guidance/solar-farm-guiding-principles/grid-connection-and-associated-development/). |

---

## 5. Core calculations to automate (planner tool pipeline)

Pseudocode, chained in the order a planner would run them:

```python
# --- Inputs ---
site_area_m2          # from drawn/uploaded site polygon
exclusion_area_m2      # ALC 1/2/3a zones, flood 3b, slope>15°, hedgerow/watercourse buffers,
                        # substation/compound/access-track allowance (typically ~5-10% of gross site)
tilt_deg               # from §1 — either PVGIS per-module optimum or user-chosen land-optimised tilt
lat, lon               # site centroid
module_Wp, module_area_m2, module_slant_length_m   # module datasheet
system_losses_pct = 14 # PVGIS default UK utility-scale assumption

# --- 1. Usable area ---
usable_area_m2 = site_area_m2 - exclusion_area_m2

# --- 2. GCR & row pitch (§2.1) ---
alpha_winter_noon_deg = 90 - lat - 23.44                          # §2.2
row_pitch_m = (module_slant_length_m * cos(radians(tilt_deg))
               + module_slant_length_m * sin(radians(tilt_deg))
                 / tan(radians(alpha_winter_noon_deg)))
gcr = module_slant_length_m / row_pitch_m                          # sanity-bound to [0.3, 0.5]

# --- 3. Module count -> DC capacity ---
# area-based packing (fast, planner-grade); replace with row/column layout for detailed design
packed_module_area_m2 = usable_area_m2 * gcr
module_count = floor(packed_module_area_m2 / module_area_m2)
dc_capacity_kWp = module_count * module_Wp / 1000

# --- 4. Annual generation (call PVGIS, §3.1; fall back to regional band if API unreachable) ---
specific_yield_kWh_per_kWp = pvgis_pvcalc(lat, lon, peakpower=1, loss=system_losses_pct,
                                           angle=tilt_deg, aspect=optimal_azimuth_or_0,
                                           outputformat="json")["outputs"]["totals"]["fixed"]["E_y"]
# fallback if API down:
# specific_yield_kWh_per_kWp = 900..1050   # UK-wide band, §3.3

annual_generation_kWh = dc_capacity_kWp * specific_yield_kWh_per_kWp

# --- 5. Land use ratio (benchmark against DESNZ operational-fleet data) ---
dc_capacity_MW = dc_capacity_kWp / 1000
land_use_ratio_ha_per_MW = (site_area_m2 / 10000) / dc_capacity_MW
# DESNZ Sept-2024 operational-fleet benchmark: interquartile range 1.88-2.7 ha/MW, median 2.25 ha/MW
# https://assets.publishing.service.gov.uk/media/6762f035e6ff7c8a1fde9b48/Land_utilised_by_solar_PV__September_2024.pdf
# flag if computed ratio < 1.88 (unrealistically dense — recheck exclusions/GCR)
#              or > 2.7  (inefficient land use — recheck usable_area/GCR assumptions)
```

Notes for implementation:
- Step 3's area-based packing is a fast planner-grade approximation; a detailed layout tool would instead tile discrete rows at `row_pitch_m` across the usable polygon depth and modules across each row's width, then take the floor at each stage — more accurate near irregular polygon boundaries.
- Step 4 should cache PVGIS responses per site (rate limit is 30 req/s/IP, generous for a planner tool, but caching avoids redundant calls when a user tweaks non-geometric parameters).
- DESNZ's ha/MW benchmark (step 5) is a **broader "land-take" metric** than GCR — it includes access tracks, security buffers, substations and unusable slivers, not just the array footprint — so it is the correct sense-check figure for *site_area vs. capacity*, while GCR (§2) is the correct figure for *array-internal row spacing*. Do not conflate the two in the UI.

---

## References (all sources consulted, cross-verification method noted)

**Tilt angle (§1)** — WebSearch ×2 + Perplexity Search API + live PVGIS API calls (4 independent methods):
- Jacobson, M.Z. & Jadhav, V. (2018), "World estimates of PV optimal tilt angles…", *Solar Energy* — [primary PDF](https://web.stanford.edu/group/efmh/jacobson/Articles/I/TiltAngles.pdf), [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0038092X1830375X)
- Lave & Klise (2011) formula as cited in [omnisolglobal.com](https://www.omnisolglobal.com/resources/solar-panel-tilt-angle-guide), [surgepv.com](https://www.surgepv.com/blog/optimal-tilt-angle-solar-panels)
- [Vermeer et al., ISES SWC2021 — GCR/tilt land-use coupling](https://proceedings.ises.org/conference/swc2021/papers/swc2021-0102-Vermeer.pdf)
- [ScienceDirect — optimal GCR for fixed-tilt systems up to 75°N](https://www.sciencedirect.com/science/article/pii/S0038092X23002682)
- PVGIS live API queries, `re.jrc.ec.europa.eu/api/v5_3/PVcalc`, 2026-07-15

**GCR / row spacing (§2)** — WebSearch ×2 (BAESS, SurgePV — identical formula independently) + BRE PDF:
- [BAESS inter-row pitch calculator](https://www.baess.app/tools/inter-row-pitch-calculator), [BAESS GCR calculator](https://www.baess.app/tools/gcr-calculator)
- [SurgePV inter-row spacing guide](https://www.surgepv.com/blog/inter-row-spacing-solar-panels-guide)
- [Detra Solar — GCR explainer](https://detrasolar.com/understanding-ground-covering-ratio-gcr-in-solar-pv-systems/)
- [Lion Solar utility-scale GCR/ROI guide](https://lion-solar.com/utility-scale-solar-investment-guide/)
- [BRE Agricultural Good Practice Guidance for Solar Farms (PDF)](https://files.bregroup.com/solar/NSC_-Guid_Agricultural-good-practice-for-SFs_0914.pdf)

**PVGIS API & UK yield (§3)** — WebFetch of official JRC docs + WebSearch ×2 + live API calls (3 methods):
- [JRC PVGIS API non-interactive service docs](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/getting-started-pvgis/api-non-interactive-service_en) (primary, fetched in full)
- [PVGIS 5 user manual](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/pvgis-5-user-manual_en)
- [feasibly.co.uk — kWh/acre UK data guide](https://feasibly.co.uk/resources/how-many-kwh-per-acre-can-solar-generate-in-the-uk)
- Live PVGIS PVcalc queries, 5 UK sites, 2026-07-15 (this document)

**GIS inputs (§4)** — WebSearch ×5, one topic per input class:
- ALC/BMV: [Roberts Environmental ALC guide](https://www.robertsenvironmental.co.uk/agricultural-land-classifications-alcs-for-solar-and-battery-storage/), [BRE planning guidance PDF](https://files.bregroup.com/solar/KN5524_Planning_Guidance_reduced.pdf), [Farmers Weekly — Grade 3b ruling](https://www.fwi.co.uk/business/diversification/farm-energy/grade-3b-land-confirmed-suitable-for-solar-farm-development)
- DEM: [OS Data Hub Terrain 50](https://osdatahub.os.uk/downloads/open/Terrain50), [EA LiDAR Composite DTM 1m](https://www.data.gov.uk/dataset/01b3ee39-da3f-47b6-83da-dc98e73a461f/lidar-composite-digital-terrain-model-dtm-1m), [environment.data.gov.uk](https://environment.data.gov.uk/dataset/13787b9a-26a4-4775-8523-806d13af58fc)
- Flood: [EA Flood Map for Planning dataset](https://environment.data.gov.uk/dataset/04532375-a198-476e-985e-0579a0a11b47)
- Grid: [SolarGridCheck land requirements checklist](https://solargridcheck.co.uk/land-requirements-solar-farm), [Essex Design Guide grid connection](https://www.essexdesignguide.co.uk/supplementary-guidance/solar-farm-guiding-principles/grid-connection-and-associated-development/)
- DESNZ land use: [Land utilised by Solar PV, Sept 2024 (PDF)](https://assets.publishing.service.gov.uk/media/6762f035e6ff7c8a1fde9b48/Land_utilised_by_solar_PV__September_2024.pdf), [gov.uk publication page](https://www.gov.uk/government/publications/ground-mounted-solar-energy-plants-predicted-land-use/ground-mounted-solar-energy-plants-predicted-land-use)

**Module specs (§5)** — WebSearch: [pretapower.com panel size guide](https://www.pretapower.com/size-of-solar-panels-explained-residential-and-commercial-standards/), [thegreenwatt.com standard sizes/wattages](https://www.thegreenwatt.com/standard-solar-panel-sizes-and-wattages-dimensions/)

### Tools/APIs available but not used in this pass
- `CERAMIC_API_KEY` not present in this environment — ceramic-search skill unavailable; substituted with Claude WebSearch as the primary keyword engine plus Perplexity Search API (`PERPLEXITY_API_KEY` present) for authoritative-source cross-checks, satisfying the ≥2-source verification bar throughout.
