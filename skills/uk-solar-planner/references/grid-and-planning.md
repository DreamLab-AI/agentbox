# UK DNO Grid Connection + Planning — Findings for Ground-Mounted Solar Planner

*Compiled 2026-07-15 by parallel multi-agent web research (4 independent research passes, WebSearch/WebFetch, cross-checked against primary sources: Ofgem, gov.uk, NESO, ENA, DNOs). All claims carry inline citations. Where a source could not be directly verified (403s, scanned PDFs), this is flagged explicitly — re-verify before using in a statutory/legal context.*

## Contents
1. [UK DNO grid-connection process and constraints](#1-uk-dno-grid-connection-process-and-constraints)
2. [OpenDSS modelling for a connection feasibility pre-check](#2-opendss-modelling-for-a-connection-feasibility-pre-check)
3. [UK planning permission for ground-mounted solar](#3-uk-planning-permission-for-ground-mounted-solar)
4. [Smart Export Guarantee (SEG) and grid-export economics](#4-smart-export-guarantee-seg-and-grid-export-economics)
5. [Key UK data sources / APIs](#5-key-uk-data-sourcesapis)

---

## 1. UK DNO grid-connection process and constraints

### 1.1 G98 / G99 — the application process

Both are ENA (Energy Networks Association) Engineering Recommendations, standardised across all six licensed GB DNOs so the technical bar is the same regardless of territory ([Connecting generation to the electricity networks – ENA](https://www.energynetworks.org/industry/connecting-to-the-networks/connecting-generation-to-the-electricity-networks); [All G98 & G99 forms – ENA](https://www.energynetworks.org/publications/all-g98-g99-forms)).

- **G98**: small, type-tested units ≤16A/phase (≈3.68kW single-phase / ≈11kW three-phase). Simplified "connect-then-notify" — install, then notify via Form A3-2 within **28 days** of commissioning ([Homedata — G98/G99 guide](https://homedata.co.uk/guides/g99-g98-grid-applications)).
- **G99**: everything above 16A/phase — i.e. **virtually all ground-mounted solar farms**. Requires a full pre-connection application and DNO approval **before** energisation ([National Grid – Generation (G99)](https://connections.nationalgrid.co.uk/get-connected/solar-and-wind/generation-g99)).
- Current standard: **EREC G99 Issue 2** (10 March 2025, ENA). Simplifies some Type B simulation-study requirements and adds new mandatory requirements for storage-incorporating Power Generating Modules, in force from **1 March 2026** — directly relevant to any solar-plus-BESS design ([EREC G99 Issue 2 (2025), DCode mirror](https://dcode.org.uk/assets/250307ena-erec-g99-issue-2-(2025).pdf); [Regen — Changes to G99](https://www.regen.co.uk/changes-to-g99/)).

**G99 "Type" classification** (capacity + connection voltage, cumulative obligations up the scale) ([ENA — G99 Types B-D Summary](https://www.energynetworks.org/assets/images/Resource%20library/G99%20Types%20B-D%20Summary%20Guide.pdf)):

| Type | Registered capacity | Connection voltage |
|---|---|---|
| A | 0.8kW – <1MW | <110kV |
| B | 1MW – <10MW | <110kV |
| C | 10MW – <50MW | <110kV |
| D | ≥50MW | ≥110kV, or any capacity at ≥110kV |

**Application stages** ([G99 Connection Procedures Guidance — National Grid](https://connections.nationalgrid.co.uk/downloads/24747); [SSEN — G99 process post-acceptance](https://www.ssen.co.uk/globalassets/our-services/generation-connections/g99-supporting-dcos/g99-flowchart-6.pdf)):
1. **Application** — ENA-standard G99 form (Parts 1-3 mandatory upfront) + Power Generating Module Document (PGMD), updated through the project lifecycle.
2. **Technical assessment/offer** — DNO runs power-flow studies (see §2), issues a connection offer with contestable/non-contestable works and charges. Offer valid **90 days**, one 90-day extension possible.
3. **Acceptance** — signed letter of acceptance + charges paid, secures queue position.
4. **Installation/commissioning/witness testing** — typically 3 months to install once accepted; Form A3-2 within 28 days of commissioning; DNO witness test required before energisation.

**Timelines & cost**: straightforward sub-250kWp schemes 8-16 weeks; schemes needing capacity studies 16-26 weeks; **>1MW schemes commonly 18-24 months** end-to-end, with 65-90 working days for the technical study alone and a further 6-14 months if capacity-constrained (12-18 months if reinforcement required). Assessment fees £500-£8,000+ (EHV/33kV+ toward the top); connection/reinforcement costs **£50,000-£2,000,000+**, with substation reinforcement alone often £100,000-£500,000+. A **no-export/reduced-export design** can cut this to 6-8 weeks by avoiding contestable works ([SolarGridCheck — G99 costs by DNO](https://solargridcheck.co.uk/blog/g99-application-guide); [solarpanelsforfarmbuildings.co.uk — DNO connection for rural farm solar 2026](https://solarpanelsforfarmbuildings.co.uk/blog/dno-grid-connection-rural-uk-farm-solar-2026/)).

### 1.2 Connection voltage tiers by capacity

| Tier | Nominal V | Typical embedded-gen capacity band | Notes |
|---|---|---|---|
| **LV** | 400V/230V | up to roughly **50kW** on a shared feeder without significant work | Shared feeder → voltage-rise headroom binds even at modest kW. G98's 16A/phase threshold sits here. |
| **11kV (HV)** | 11kV (occ. 6.6kV) | commonly **up to a few MW**; SP Energy Networks cites **"5MW almost always available"** on certain 11kV feeders — matches the informal ~5-6MW ceiling developers cite before needing 33kV | G99 Type A/B boundary (1MW) and Type B ceiling (10MW) both sit inside this band ([SPEN — 11kV Voltage Constrained Feeders ARC report](https://www.spenergynetworks.co.uk/userfiles/file/ARC_Learning_Report_Distributed_Generation_on_11kV_Voltage_Constrained_Feeders_Sept_2014.pdf)) |
| **33kV (lower EHV)** | 33kV | realistically **tens of MW** | ENWL's own guidance is titled "33kV Connections up to 90MVA"; real example: 25.2MW Tolldish Hall Solar Farm at 33kV ([ENWL — 33kV connections up to 90MVA](https://www.enwl.co.uk/globalassets/get-connected/cic/icpsidnos/g81-policy/policy-library-documents/design-and-planning/es217---33kv-connections-up-to-90mva.pdf); [Tolldish Hall Solar Farm 33kV](https://www.powersystemsuk.co.uk/projects/tolldish-hall-solar-farm-25-2-mw-electrical-infrastructure-33-kv-grid-connection/)) |
| **132kV+ / EHV upper & transmission-adjacent** | 132kV, 66kV+ | **tens to hundreds of MW** | Dedicated national guidance exists at this level; example: 750MW solar + 350MW BESS at 400kV in Lincolnshire ([National Grid/NGED — Connections at EHV or 132kV](https://commercial.nationalgrid.co.uk/downloads-view-reciteme/231976); [Roadnight Taylor — Lincolnshire project](https://roadnighttaylor.co.uk/current-projects/solar-and-storage-lincolnshire-ng/)) |

### 1.3 "Available network capacity" / headroom — what constrains it

DNO power-flow assessment evaluates four constraints ([Energy Systems Catapult — DNO capacity guidance](https://es.catapult.org.uk/wp-content/uploads/2023/05/Local-District-Network-Operator-capacity-guidance.pdf)):
- **Thermal limits** — transformer/cable/feeder current-carrying capacity.
- **Fault level** — added generation raises short-circuit current; switchgear rating headroom can force upgrades.
- **Voltage rise** — high solar export at low local demand pushes feeder voltage above statutory limits (see §2.2 for exact ESQCR figures); dominant constraint on many rural LV/11kV feeders.
- **Reverse power flow** at primary/grid substations — networks and protection/OLTC equipment designed for one-way (grid→customer) flow; local generation exceeding local demand reverses this, requiring reinforcement or Active Network Management (ANM) to throttle generators in real time.

### 1.4 DNO capacity/heatmap portals (who publishes what)

| DNO | Tool(s) | URL |
|---|---|---|
| **UK Power Networks** | Network Infrastructure & Usage Map (NIUM) + Open Data Portal + DSO capacity-visibility (spare GSP capacity + queue position ahead of you, launched Nov 2023) | [NIUM](https://ukpowernetworks.opendatasoft.com/pages/network-infrastructure-usage-map/); [Open Data Portal](https://www.ukpowernetworks.co.uk/our-company/open-data-portal); [Capacity visibility](https://www.ukpowernetworks.co.uk/news/dso-capacity-visibility) |
| **National Grid Electricity Distribution (NGED, ex-WPD)** | Network Opportunity & Development Map, Embedded Capacity Register (ECR, ≥50kW, monthly), Network Capacity Map (LTDS-derived), ClearviewConnect | [Opportunity Map](https://commercial.nationalgrid.co.uk/network-opportunity-map); [ECR](https://commercial.nationalgrid.co.uk/our-network/embedded-capacity-register); [Capacity Map](https://commercial.nationalgrid.co.uk/our-network/network-capacity-map); [connecteddata.nationalgrid.co.uk](https://connecteddata.nationalgrid.co.uk/) |
| **SSEN Distribution** | Network Maps portal + Generation Availability & Contracted Demand map (N. Scotland / S. England regions) + Data Portal | [Network Maps](https://network-maps.ssen.co.uk/); [Capacity info](https://www.ssen.co.uk/our-services/network-capacity-information/); [Data Portal](https://data.ssen.co.uk/) |
| **SP Energy Networks** (SPD + SPM) | Distributed Generation Heat Maps (RAG per substation) + Transmission Generation Heat Map; enhanced June 2026 to cover demand + generation together | [Connection opportunities](https://www.spenergynetworks.co.uk/pages/connection_opportunities.aspx); [SPD map](https://www.spenergynetworks.co.uk/pages/sp_distribution_heat_maps.aspx); [SPM map](https://www.spenergynetworks.co.uk/pages/sp_manweb_heat_maps.aspx); [Open Data](https://spenergynetworks.opendatasoft.com/) |
| **Northern Powergrid** | Network Heat Maps (Open Data Portal) + Demand Availability Map; ECR monthly | [Heat Maps](https://northernpowergrid.opendatasoft.com/pages/network_heatmaps/); [Demand Availability Map](https://www.northernpowergrid.com/demand-availability-map) |
| **Electricity North West** | Heatmap Tool (Excel + interactive) + GSP Capacity Heatmap dataset | [Heatmap tool](https://www.enwl.co.uk/get-connected/network-information/heatmap-tool/); [User guide](https://www.enwl.co.uk/globalassets/get-connected/network-information/heat-maps/downloads/heatmaps/heatmap-tool---user-guide.pdf) |
| **ENA (cross-DNO)** | Connections data signposting + National Energy System Map (NESM, proof-of-concept w/ OS + 1Spatial) | [Connections data](https://www.energynetworks.org/industry/connecting-to-the-networks/connections-data); [NESM announcement](https://www.energynetworks.org/newsroom/new-digital-system-map-to-harness-the-power-of-data-to-deliver-net-zero) |

All trace back to the industry-wide **DG-DNO steering group** / **ENA Open Networks** push for standardised transparency; heatmaps explicitly caveat they are indicative only, not a substitute for a formal G99 study (e.g. ENWL: "cannot replicate the detailed assessment"). A commercial aggregator, **GB Grid Data**, indexes 7,000+ substations across all 6 DNOs with generation-headroom RAG status and fault levels in a single searchable map ([griddata.uk](https://griddata.uk/)).

### 1.5 Where connection gets hard

- **~1MW (G99 Type A→B boundary)**: DNO moves from templated to bespoke technical (load-flow/fault-level/protection) studies; total programme routinely stretches to 18-24 months.
- **~5MW**: coincides with the informal ceiling many 11kV feeders can absorb without reinforcement (SPEN's own figure). Beyond it, schemes typically need 33kV, a new dedicated feeder, or a bespoke substation — cost jumps to £100k-£500k+ for reinforcement, up to £2M+ overall.
- **Large Embedded Generator thresholds — when NESO gets involved even on a distribution-connected scheme** ([NESO — role in Connections](https://www.neso.energy/industry-information/connections/nesos-role-connections)):
  - **≥100MW** in National Grid Electricity Transmission's area
  - **≥30MW** in SP Transmission's (Scottish Power) area
  - **≥10MW** in Scottish Hydro Electric Transmission's (SSEN Transmission) area

  Above these, a **Bilateral Embedded Generation Agreement (BEGA)** is needed alongside the DNO agreement, granting Transmission Entry Capacity (TEC) and Grid Code/CUSC/BSC compliance obligations. An intermediate **"LEEMPS"** classification (50-99MW, England/Wales) adds DNO-imposed technical conditions without a direct NESO agreement.
- **Very large schemes** (tens-hundreds of MW) often connect directly at 132kV+/EHV rather than embedding in distribution — see the 750MW+350MW BESS Lincolnshire 400kV example above.

### 1.6 The TEC register and the grid queue backlog

NESO's **Transmission Entry Capacity (TEC) register** is the authoritative record of contracted capacity ([TEC register, NESO Data Portal](https://www.neso.energy/data-portal/transmission-entry-capacity-tec-register)), updated **twice weekly**.

- Pre-reform: ~743GW contracted across 2,217 projects vs only ~81GW actually built; 74.2% (551GW) still at earliest "Scoping" stage; **solar made up 237GW of the queue**, 94.7% co-located with storage ([SolarGridCheck — UK grid queue](https://solargridcheck.co.uk/uk-grid-connection-queue)).
- Post-reform (Dec 2025 published queue): **381.5GW** (283GW generation/storage + 99GW transmission-connected demand) — down from the pre-reform 738GW+ against a ~200-225GW 2030 requirement ([Knight Frank — connection reform update](https://www.knightfrank.co.uk/research/article/2025/12/connection-reform-update-a-new-pipeline-announced)).

### 1.7 2023-2026 grid connection reform ("first ready, first connected")

NESO + Ofgem + 60+ industry workgroups redesigned the queue from FCFS to **"first ready and needed, first connected"** — prioritising projects with secured land/progressing planning ("ready") aligned to Clean Power 2030 ("needed") ([NESO — About Connections Reform](https://www.neso.energy/industry-information/connections-reform/about-connections-reform)).

- **Gate 2** = confirmed connection date/point/queue position (meets readiness+alignment bar); **Gate 1** = non-confirmed/lower priority/potential termination.
- Ofgem approved the **TMO4+** reform design **15 April 2025**; Gate 2 application window closed 26 August 2025 (extended from 29 July).
- 2026 offer delivery (as of Feb 2026 timetable, Scotland-first sequencing): Protected projects Feb-May 2026; Gate 2 Phase 1 distribution offers early July-mid-Nov 2026; Gate 2 Phase 2 distribution offers mid-Oct 2026-mid-March 2027 ([NESO — Connections reform timeline](https://www.neso.energy/industry-information/connections-reform/connections-reform-timeline)).
- **Solar-specific effect**: ~30GW of solar PV got Gate 2 offers for pre-2030; **35.9GW of solar capacity got no offer at all** in this round — some zones now show solar undersupplied ahead of 2030 even as others are oversupplied 2030-35. Side effect: planning-refusal rates spiked (>30% among Dec-2025-submitted schemes with a decision) as developers rushed applications to qualify for Gate 2 — and **projects can be dropped from Gate 2 entirely if planning is subsequently refused** ([Solar Power Portal — 132GW renewables by 2030](https://www.solarpowerportal.co.uk/solar-planning/uk-grid-connections-reform-132gw-renewables-to-connect-by-2030)). Offer dates have slipped repeatedly through 2026 — treat as a moving target, not a fixed date.

**Practical decision tree for a developer/planner tool**: (1) check target DNO's public heatmap before committing to a site; (2) expect >1MW, and especially >5MW, to trigger bespoke studies and possibly 33kV reinforcement; (3) for tens-hundreds of MW, budget for a NESO/TEC relationship in addition to the DNO one and treat the Gate 2 offer timetable as the binding, still-slipping critical path.

---

## 2. OpenDSS modelling for a connection feasibility pre-check

### 2.1 What OpenDSS is and why it fits a pre-check (not a full DNO study)

OpenDSS = EPRI's free, open-source distribution-system simulator (1997, open-sourced 2008), scriptable from Python/MATLAB/Excel — practical for a lightweight, code-driven pre-check rather than a GUI-locked commercial tool ([EPRI — OpenDSS](https://www.epri.com/pages/sa/opendss?lang=en-US); [Introduction to OpenDSS](https://opendss.epri.com/)). Solution modes: **Snapshot** (single operating point), **Daily** (24 hourly steps), **Yearly** (8,760 hourly steps), **Duty Cycle** (sub-minute) — letting a pre-check move from a single worst-case snapshot to a full annual quasi-static time series (QSTS) of a proposed generator's export profile against demand.

Stated example applications directly match a solar interconnection pre-check: "long-range planning studies of DER, distribution system loss/efficiency studies, DER interconnection screening, and hosting capacity for PV generation impacts" — OpenDSS is the analytical engine underpinning EPRI's own DRIVE hosting-capacity tool, i.e. the open-source substrate commercial hosting-capacity products are built on ([EPRI — OpenDSS](https://www.epri.com/pages/sa/opendss?lang=en-US); [EPRI Journal — The Host with the Most](https://eprijournal.com/the-host-with-the-most/)).

**Pre-check vs full DNO study**: a pre-check gives a *screening-grade* answer using approximate/synthesised feeder data (LTDS extracts, DFES load curves, generic conductor impedance tables) — catching "obviously infeasible" or "clearly needs reinforcement" cases before spending fee/queue time on a formal application. A full DNO study uses the DNO's live calibrated model (IPSA/DIgSILENT PowerFactory/CYME + EPRI DRIVE), validated telemetry, protection grading, statutory sign-off.

### 2.2 Voltage rise at the point of connection (POC)

**Physical cause**: real power injected into a feeder flows back toward the source; because distribution conductors have non-negligible resistance R (not just reactance X), reverse active-power flow produces an I·R voltage rise along the conductor, increasing with distance from source and generator output. Rural MV/HV overhead feeders have comparatively high R/X ratio, so voltage magnitude is strongly sensitive to *active* power injection, not just reactive — the specific mechanism making rural solar connections voltage-rise-limited rather than thermally-limited ([Nature Sci. Reports — voltage rise phenomena](https://www.nature.com/articles/s41598-022-11765-w); [ScienceDirect — mitigating high-capacity DG impact](https://www.sciencedirect.com/science/article/abs/pii/S0378779622000724)). Worst case coincides with minimum demand + maximum generation simultaneously — the standard DER screening scenario (§2.3).

**UK statutory limits (ESQCR)** — Electricity Safety, Quality and Continuity Regulations 2002, Reg. 27(3) ([legislation.gov.uk](https://www.legislation.gov.uk/uksi/2002/2665/regulation/27)):
- **LV**: **+10% / −6%** of declared voltage (230V → 253.0V to 216.2V)
- **HV below 132kV** (covers the typical 11kV/33kV MV connection voltages for ground-mount solar): **±6%**
- **HV at/above 132kV (EHV)**: **±10%**

Corroborated by [ENA — Statutory Voltage Limits](https://www.energynetworks.org/industry/engineering-and-technical-programmes/statutory-voltage-limits). Note: ENA has an active 2026 proposal to tighten the LV lower limit from −6% (216V) to −4% (207V) to create headroom for LCT/DER uptake — a live regulatory variable, not fixed.

**How OpenDSS quantifies it**: Snapshot power-flow at a candidate connection bus with the generator at rated MW/chosen power factor directly reports resulting per-unit bus voltage against the ESQCR envelope. Daily/Yearly QSTS modes solve at every timestep using Loadshape/PVSystem dispatch profiles, producing a full duration curve of POC voltage — the worst-case and statistical exceedance frequency against ±6%/+10%/−6% can be read directly.

### 2.3 Thermal loading

OpenDSS models thermal limits via explicit ampacity properties on line/conductor and transformer elements:
- **LineCode**: `normamps` (Planning Limit, ~75-80% of emergency rating) and `emergamps` (emergency, usually 1-hour rating) — defaults 400A/600A, overridden per real conductor type ([LineCode — OpenDSS docs](https://opendss.epri.com/LineCode1.html)).
- **Transformer**: `NormAmps`/`EmergAmps` derived from `NormHkva`/`EmergHkva` and rated voltage; additional properties for full-load temp rise (default 65°C) and hot-spot rise (default 15°C) for thermal-ageing detail.

A power-flow solve compares solved branch/element current against these thresholds and flags overloads.

**Classic DER screening worst case — minimum load / maximum generation**: standard hosting-capacity industry practice (OpenDSS is the engine that executes it): solve with feeder demand at seasonal minimum simultaneous with candidate generator at maximum export (most extreme for reverse-flow/voltage-rise); complementary max-load/min-generation case screens conventional overload risk. EPRI's DRIVE tool explicitly requires "load models for peak and light (off-peak) load conditions," confirming this dual-scenario approach is standard ([EPRI DRIVE / DeepWiki](https://deepwiki.com/sandialabs/Python-Automation-with-CymPy/3.3-epri-drive-and-hosting-capacity-analysis)). Field evidence: overloads concentrate at the distribution transformer and first few line segments downstream of it, not spread evenly along the feeder — useful for prioritising which elements to check first.

### 2.4 Reverse power flow

**Mechanism**: local generation exceeding local demand drives net active power backward — from the DER, through the local feeder, potentially back through the substation transformer toward the upstream network — reversing the unidirectional assumption legacy protection/voltage-regulation/OLTC schemes were designed around ([MDPI — Reverse Power Flow on Distributed Transformers](https://www.mdpi.com/1996-1073/15/23/9238)).

- **OLTC transformers**: control logic (line-drop compensation, target voltage band) normally assumes MV→LV flow. With reverse flow, "OLTC settings require voltage regulation targets and tap position logic to account for power flowing from LV to MV" — reverse flow both changes the correct tap decision and increases tap-operation count roughly linearly with PV penetration. Some legacy MV/HV OLTC designs have functional issues handling reverse power outright.
- **Protection relay directionality**: conventional non-directional overcurrent protection assumes grid→load flow; DER export requires directional overcurrent relays for bidirectional fault contribution. Some legacy network protectors interpret reverse flow itself as a fault indication and trip — incorrectly disconnecting a legitimately exporting solar farm unless re-engineered.
- **Fault level**: a generator changes network fault level (short-circuit MVA) at/around the POC — an explicit G99 application requirement, run "at the fault level at the Connection Point at minimum as notified by the DNO, with a minimum short circuit power of 50 MVA as a generic minimum fault level" where undnotified ([EREC G99 Issue 2](https://dcode.org.uk/assets/250307ena-erec-g99-issue-2-(2025).pdf)).

**How OpenDSS detects it**: QSTS (Daily/Yearly) solve reports directional real-power flow (sign convention) at any monitored element, most usefully the primary substation transformer/feeder head — any timestep driving net flow negative (LV→MV/HV against normal) flags a reverse-flow event; aggregating across the year gives a duration/frequency profile informing whether OLTC/protection re-engineering would be triggered. OpenDSS's separate **Fault Study mode** (Thevenin-equivalent short-circuit per bus: SLG/LL/LLG/3-phase) is the complementary tool for quantifying fault-level contribution ([Fault Studies — OpenDSS docs](https://opendss.epri.com/FaultStudies.html)).

### 2.5 Minimal network data for a credible first-pass model

1. **Feeder nominal voltage** — 11kV or 33kV typically for UK ground-mount solar (occasionally 132kV for larger schemes).
2. **Feeder length and conductor type/impedance (R/X per km)** — DNO conductor schedules or generic UK tables, as OpenDSS `LineCode` objects; the single most consequential parameter for voltage-rise sensitivity given the R/X dependency.
3. **Existing transformer/substation ratings and tap settings** — MVA rating, impedance, OLTC tap range/step, as OpenDSS `Transformer` objects.
4. **Existing connected load** — ideally a load profile (half-hourly/hourly) for `Loadshape` objects; at minimum peak and minimum (seasonal light-load) demand estimates for the screening pair in §2.3.
5. **Proposed generator capacity, power factor, export profile** — MW capacity, inverter PF/Q-control mode, irradiance-based hourly generation shape (PVSystem/Loadshape) for QSTS; flat maximum-export suffices for a first-pass Snapshot screen.
6. **Background network fault level** at the candidate POC — needed for thermal/protection sanity checks and is an explicit G99 requirement (DNO-notified value, or 50 MVA generic minimum fallback).

**UK data sources for the above**:
- **DNO Long Term Development Statements (LTDS)** — primary statutory source: circuit/transformer specs, fault-level info, load/generation data down to primary-substation/HV-busbar level, published twice yearly (end-May/end-Nov), free after registration, increasingly delivered as CIM-format grid models "sufficient to support steady state power flow calculations" — i.e. explicitly intended to support exactly this kind of pre-check model ([ENWL — Introduction to LTDS](https://www.enwl.co.uk/get-connected/network-information/long-term-development-statement/introduction-to-ltds/)).
- **Distribution Future Energy Scenarios (DFES)** — DNO-published annual scenario forecasts: demand/generation growth, LCT uptake, load profiles by technology to secondary-substation/feeder level out to 2050 ([Northern Powergrid — DFES](https://northernpowergrid.opendatasoft.com/pages/dfes/)).
- **DNO/ENA open data + heatmaps** (§1.4) — substation-level headroom and, in some cases, fault-level data, usable as a sanity check against a from-scratch model or as a first screen before building one at all.
- **GB Grid Data** third-party aggregator ([griddata.uk](https://griddata.uk/)) — 7,000+ substations across all 6 GB DNOs with generation-headroom RAG and fault levels (kA) for rapid POC shortlisting.

### 2.6 Open UK distribution network models / test feeders for prototyping

- **UK Generic Distribution System (UKGDS)** — developed by the Centre for Sustainable Electricity and Distributed Generation (SEDG), publicly available, UK-representative topologies, now maintained unofficially on GitHub. Covers relevant voltage classes: **EHV1** (33kV rural fed from 132kV, incl. sub-sea cable, extremity voltage problems — a close analogue to rural ground-mount solar); EHV2-6 (rural/suburban/urban 33-132kV variants); **HV OHa/b** (11kV rural fed from 33kV, overhead); HV UG/OH-UGa/b (11kV urban/mixed). Distributed as Excel + diagrams, not native `.dss` — needs conversion. A commonly-cited **95-bus UKGDS test feeder** (11kV, mixed load) is an academic benchmark ([GitHub — sedg/ukgds](https://github.com/sedg/ukgds)).
- **IEEE test feeders** (13-, 34-, 8500-node) ship with OpenDSS itself; US topology/voltage class (4.16kV/12.47kV/24.9kV, not UK 11kV/33kV) — useful for validating analysis *methodology* before substituting UK data, not as UK stand-ins.

### 2.7 Summary table

| Feasibility question | OpenDSS mechanism | Key refs |
|---|---|---|
| Will POC voltage breach ESQCR limits? | Snapshot + Daily/Yearly QSTS vs ±6%/+10%/−6% | [Reg. 27 ESQCR](https://www.legislation.gov.uk/uksi/2002/2665/regulation/27) |
| Will conductors/transformers overload? | Branch current vs `normamps`/`emergamps`, min-load/max-gen + max-load/min-gen | [LineCode docs](https://opendss.epri.com/LineCode1.html) |
| Will reverse power flow occur, affecting OLTC/protection? | QSTS directional real-power flow at substation/feeder-head monitor | [MDPI reverse power flow](https://www.mdpi.com/1996-1073/15/23/9238) |
| Fault-level impact? | Fault Study mode (Thevenin per-bus short-circuit) | [OpenDSS Fault Studies](https://opendss.epri.com/FaultStudies.html); [G99 Issue 2](https://dcode.org.uk/assets/250307ena-erec-g99-issue-2-(2025).pdf) |

---

## 3. UK planning permission for ground-mounted solar

### 3.1 Permitted development vs full planning permission

**Confirmed: standalone ground-mount solar farms have essentially no permitted development (PD) right in England.** PD for ground-mounted solar under Part 14, Schedule 2, Town and Country Planning (General Permitted Development) (England) Order 2015 applies only to small stand-alone installations *within the curtilage* of a dwelling (Class B) or non-domestic building (Class K) — capped at 9m² panel area, no dimension >3m, max height 4m (2m in conservation areas), ≥5m from curtilage boundary, one per curtilage ([legislation.gov.uk — Sch. 2 Part 14](https://www.legislation.gov.uk/uksi/2015/596/schedule/2/part/14)). This is materially different from rooftop/domestic solar's broader PD rights. **Utility-scale free-standing solar farms fall entirely outside this scope** and need a full application to the LPA under the Town and Country Planning Act 1990, or above threshold a Development Consent Order (§3.2) ([House of Commons Library — Planning for solar farms](https://commonslibrary.parliament.uk/research-briefings/cbp-7434/)).

Statutory LPA determination: 8-13 weeks, though major solar applications commonly take **6-12 months** in practice. Additional consents may apply in conservation areas/World Heritage Sites/near listed buildings ([SolarGridCheck — planning permission](https://solargridcheck.co.uk/solar-planning-permission)).

**Devolved nations** (secondary-sourced, verify against primary legislation before final use):
- **Scotland**: general planning system applies; generating stations >**50MW** require Scottish Ministers' consent under **Section 36, Electricity Act 1989** (Energy Consents Unit) rather than the LPA; NPF4 designates on/offshore electricity generation a "National Development." LPAs handle up to 50MW.
- **Wales**: **10MW-350MW** = "Development of National Significance" (DNS) under Planning (Wales) Act 2015 — Planning Inspector decides 10-50MW; Welsh Minister decides >50MW on the Inspector's report. Below 10MW → LPA. **>350MW** = reserved NSIP under Planning Act 2008 (confirmed by NPS EN-3 2025).
- **Northern Ireland**: ~30MW is the informal "regionally significant" threshold for DfI rather than local Council determination — loosely sourced, verify with DfI directly.

### 3.2 Scale thresholds — NSIP/DCO regime

**Confirmed current position (as of 15 July 2026): England solar NSIP threshold is 100MW, not 50MW or 150MW.**

- Original: under s.15(2) Planning Act 2008, generating stations **>50MW** required a DCO from the Planning Inspectorate/Secretary of State rather than LPA planning permission.
- Consultation (Jul-Sep 2024) initially floated **150MW**; government response (12 Dec 2024) confirmed **100MW** for both solar and onshore wind.
- Legal instrument: **The Infrastructure Planning (Onshore Wind and Solar Generation) Order 2025**, amending s.15(2), **in force 31 December 2025** ([Mills & Reeve](https://www.mills-reeve.com/publications/solar-nsip-threshold-raised-to-100mw/); [legislation.gov.uk SI 2025/694](https://www.legislation.gov.uk/uksi/2025/694/pdfs/uksiem_20250694_en_001.pdf)).
- Confirmed independently by **NPS EN-3 (2025)**: solar covered by the NPS at **>100MW in England, >350MW in Wales** ([GOV.UK — NPS EN-3 2025](https://www.gov.uk/government/publications/national-policy-statement-for-renewable-energy-infrastructure-en-3-2025)).
- **Rationale**: Solar Energy UK data (Dec 2024) found zero English projects proposed in the 50-99.9MW band vs 174 projects at 49.9MW or just below — evidence the old 50MW threshold artificially suppressed mid-sized schemes (developers kept projects under 50MW to dodge the costlier/slower DCO route).
- **Practical effect**: 50-100MW schemes now go through ordinary LPA planning; only **>100MW** now triggers a DCO in England.
- **Live legal question**: *Drayton Manor Farms Ltd v Stratford-Upon-Avon DC* [2025] EWHC 775 (Admin) and a related line of cases address whether co-located/adjacent solar projects can be artificially split to dodge aggregating to the NSIP threshold ([TLT LLP](https://www.tlt.com/insights-and-events/insight/adjacent-solar-developments-ruled-not-to-be-a-single-nsip/)).

**Below-threshold schemes / EIA**: normal LPA procedure applies. Solar isn't explicitly named in EIA Regulations Schedule 2 but is generally treated under "energy industry" (installations for producing electricity), indicative area threshold **>0.5 hectare** — triggers an EIA *screening opinion* (not automatically a full Environmental Statement). Most utility-scale ground-mount schemes (tens-hundreds of hectares) are treated as "major development" by LPAs given scale, triggering committee-level scrutiny and statutory consultee engagement.

### 3.3 Agricultural Land Classification (ALC) and Best and Most Versatile (BMV) land

**Grading**: Grade 1 (excellent), 2 (very good), 3a (good) — together **"Best and Most Versatile" (BMV)**, per NPPF definition "land in grades 1, 2 and 3a" — through 3b (moderate), 4 (poor), 5 (very poor).

**NPPF policy steer**: agricultural land is a finite national resource; where "significant development of agricultural land is demonstrated to be necessary," LPAs/developers should prefer poorer-quality land. **Not an absolute prohibition** on BMV — a preference/hierarchy test; BMV solar can still be approved where the applicant demonstrates poorer-quality alternatives aren't available/viable.

*Note on footnote instability*: a footnote (previously #63) added to NPPF Dec 2023 making "availability of agricultural land used for food production" an explicit material consideration was subsequently proposed for removal and appears removed in the Dec 2024 NPPF revision — treat exact paragraph/footnote numbering as unstable; confirm against the live NPPF at time of use.

**2024 Written Ministerial Statement** (15 May 2024, "Solar and protecting our Food Security and Best and Most Versatile agricultural land"): BMV land should be protected for food security; large-scale solar should avoid BMV where possible, preferring lower-grade agricultural land, brownfield, contaminated land, rooftops instead (content corroborated via secondary sources; primary parliament.uk page returned 403 to automated fetch — re-verify wording before quoting).

**NPS EN-3 (2025) position**: solar is **not barred** from BMV land but developers must demonstrate poorer-quality land can't accommodate the project first — codifying the same preference hierarchy at NSIP level.

**Consultation trigger**: projects affecting >20 hectares of BMV land require formal Natural England consultation (secondary-sourced figure — cross-check against Natural England's TIN049 technical guidance, a scanned/image PDF, before treating as definitive).

**Counter-narrative**: Solar Energy UK/Lancaster University/RSPB/Cambridge research indicates well-managed solar farms (wildflower meadow/hedgerow management) can support significantly greater biodiversity than the intensive arable land replaced — up to 3x more birds, 4x more bumblebees on some sites vs surrounding farmland — cited as a mitigating factor in ALC debates.

### 3.4 Local planning considerations commonly assessed

- **Glint and glare**: assesses visual hazard risk to aviation/road/rail/residential receptors. No single nationally-mandated methodology; de facto industry standard is Pager Power's Glint and Glare Guidance (4th ed., 2022). CAA mandates LPA consultation with aviation stakeholders inside a licensed aerodrome's safeguarded zone.
- **Landscape and Visual Impact Assessment (LVIA)**: standard component, following general GLVIA3 good-practice guidance (no solar-specific statutory methodology).
- **Ecology / Biodiversity Net Gain (BNG)**: **mandatory 10% BNG** became a condition of planning grant in England from **12 February 2024** (Environment Act 2021). Requires pre-development biodiversity baseline (statutory metric) and demonstration of ≥10% net biodiversity unit increase, typically via new hedgerows/wildflower meadow/ponds/habitat mosaics.
- **Heritage/archaeology**: Heritage Statement addressing designated/non-designated assets (listed buildings, Scheduled Monuments, Registered Parks and Gardens, Conservation Areas), following Historic England's "Setting of Heritage Assets" (GPA3) methodology, plus proportionate archaeological assessment informed by the county Historic Environment Record. A sector-specific "Archaeology and Solar Farms: Good Practice Guide" (CIfA consultation draft) exists.
- **Flood risk**: Flood Risk Assessment given site scale — sequential siting of most-vulnerable infrastructure (inverters/transformers/substations) outside high flood-risk zones, surface-water runoff/drainage impacts, access/egress during flood events, no-net-increase-in-discharge-rate drainage strategy.
- **Grid connection/cable routing**: underground cabling generally preferred over overhead; "optioneering" exercise compares route corridors against technical/environmental/land-use/ownership constraints. Wayleave Agreements required where routes cross third-party land — can materially delay projects.
- **Decommissioning/restoration and permission duration**: LPAs routinely impose a time-limited condition on operational life, commonly cited **~40 years** (ranges 20-40 across sources), requiring a Decommissioning and Restoration Plan specifying full equipment removal (typically ≥1m below ground, except any network-operator-adopted grid infrastructure) and land restoration to prior agricultural use/landform, retaining biodiversity/landscape enhancements where appropriate. Solar Energy UK publishes a model decommissioning plan template.

### 3.5 Recent (2024-2026) policy developments

- **NPS EN-3 (2025)** in force **6 January 2026**, superseding the version in force since 17 January 2024. Followed a DESNZ consultation (25 Apr-29 May 2025) aligned to Clean Power 2030. Sets the solar NSIP threshold (>100MW England, >350MW Wales), states solar is "a key part of the government's strategy for low-cost decarbonisation," ambition of **70GW installed solar capacity by 2035**. Companion: overarching NPS EN-1 (2025) ([GOV.UK — NPS EN-3 2025](https://www.gov.uk/government/publications/national-policy-statement-for-renewable-energy-infrastructure-en-3-2025)).
- **NSIP threshold reform**: The Infrastructure Planning (Onshore Wind and Solar Generation) Order 2025 (in force 31 Dec 2025) — see §3.2.
- **December 2024 NPPF revision**: reintroduced onshore wind into the centralised NSIP regime (also at 100MW) and removed prior restrictive tests (local plan allocation requirement, demonstrated community backing), explicitly to level the playing field with solar and other energy infrastructure.
- **Planning and Infrastructure Bill**: vehicle for wider NSIP/DCO process reform, progressing through 2025-26 — verify current status/royal assent at time of use.
- **Market effect**: Solar Energy UK described the reform as bringing "clarity" for mid-sized projects previously stuck in the 50-100MW "dead zone," expected to accelerate projects previously artificially capped at 49.9MW.

**Sourcing caveats**: several primary gov.uk/parliament.uk pages (House of Commons Library CBP-7434, HCWS466, legislation.gov.uk SI 2025/694 explanatory memorandum) returned HTTP 403 or unparseable PDF to automated fetch — findings corroborated via ≥1 independent secondary source each, but direct re-verification recommended before final/legal use, particularly: exact current NPPF paragraph/footnote governing BMV land, precise HCWS466 wording, and EN-3's solar-chapter section number (sources disagree 2.9 vs 2.10, likely pagination/edition artefact). Natural England's TIN049 ALC guidance is a scanned/image PDF — confirm ALC grade definitions and the 20-hectare consultation trigger independently. Scotland/Wales/NI content leans more on secondary/law-firm sources than the England analysis.

---

## 4. Smart Export Guarantee (SEG) and grid-export economics

### 4.1 What SEG is

Operational from **1 January 2020**, replacing the Feed-in Tariff (FiT). Ofgem-administered: licensed suppliers with **≥150,000 customers** must offer at least one SEG export tariff (smaller suppliers can opt in voluntarily) ([Ofgem — SEG](https://www.ofgem.gov.uk/environmental-and-social-schemes/smart-export-guarantee-seg)).

- **Eligible capacity**: anaerobic digestion, hydro, onshore wind, solar PV up to **5MW** total installed capacity; micro-CHP up to 50kW ([Ofgem — SEG generators guidance](https://www.ofgem.gov.uk/guidance/smart-export-guarantee-guidance-generators)).
- **Market-based rates**: not fixed/subsidised — suppliers compete on rate (only regulatory floor: rate must always be >0). Rates can change with ~30 days' notice; mid-2026 flat rates roughly 12-16p/kWh, variable/Agile-linked export tariffs occasionally spiking 25-30p+/kWh in specific half-hours.
- **Metering**: requires smart/dedicated export meter providing **half-hourly export readings**.

### 4.2 Why SEG is largely irrelevant to utility-scale ground-mount solar

The 5MW cap is the structural reason: **installations >5MW are explicitly ineligible for SEG.** Utility-scale ground-mount (typically single-digit to hundreds of MW) uses:

- **Power Purchase Agreements (PPAs)** — direct bilateral contract with a large offtaker (corporate PPA) or supplier/trading desk (utility PPA), typically 5MWp+, priced in £/MWh. Corporate PPA terms commonly run 10-20 years, fixed or partially-indexed, around **£42-60/MWh**; most require investment-grade offtaker or parent guarantee for project finance.
- **Merchant/wholesale exposure** — direct sale into day-ahead/spot market, no revenue floor; generally too volatile to underpin project finance alone, so most projects carry only partial/temporary merchant exposure (e.g. pre-PPA ramp periods).
- **Contracts for Difference (CfD)** — competitive government allocation via the **Low Carbon Contracts Company (LCCC)**, a DESNZ-owned counterparty. Two-way price hedge: if market reference price < strike price, LCCC pays the generator the difference; if above, generator pays back. Solar competes in **Pot 1** (established technologies, alongside onshore wind >5MW).

**Current CfD status**:
- **AR6** (results 3 Sept 2024): record **93 solar PV projects**, **3,288.31MW (~3.3GW)**, strike price **£50.07/MWh (2012 prices)** — solar took >34% of AR6's total 9,648MW.
- **AR7** (main results 14 Jan 2026, onshore-tech results 10 Feb 2026, +AR7a supplementary round): record **157 solar PV projects**, **4.9GW** — highest solar capacity ever procured in a single round — strike price **£65.23/MWh**. Contracts extended from 15 to **20 years**. **Important**: AR7 is quoted in **2024 prices** vs AR6's **2012 prices** — the headline figures aren't directly comparable; on a consistent real-terms basis AR7's solar strike price is ~6.5% *lower* than AR6's.

### 4.3 Curtailment, forecasting and battery storage — the economic logic

**Curtailment mechanics**: when network constraints bind (thermal/fault-level/boundary-transfer) or during negative/very-low wholesale prices (high renewable output + low demand), NESO/DNO issue curtailment instructions; generators on firm connections get **constraint payments** funded through balancing costs. GB balancing costs hit **£2.7bn in 2024/25** (£1.7bn constraint payments); NESO projects constraint payments could rise to **£7.2bn by 2030** before reinforcement cuts them back to ~£2.9bn in 2031. NESO's Clean Power 2030 modelling anticipates discarding ~83 TWh of excess wind/solar in 2030 (22 TWh curtailed, 61 TWh exported at a loss).

**Non-firm/flexible connections**: DNOs increasingly offer non-firm agreements via Active Network Management (ANM)/DERMS — faster/cheaper than waiting for firm reinforced capacity, cutting connection costs up to 80% and halving lead times, at the cost of curtailment exposure when local limits bind. Four broad non-firm access models exist: capacity-limited, time-limited, dynamic operating envelopes, fully flexible access. 2026 examples of constrained areas: Black Country, parts of Greater Manchester, South Yorkshire, South Wales industrial clusters, Hertfordshire/Essex — increasingly zero/near-zero firm headroom, pushing developers toward non-firm terms.

**Value of forecasting**: NESO's adoption of the AI-driven **Quartz Solar** forecasting tool (with Open Climate Fix) has roughly **halved solar forecast error**, avoiding an estimated **£30m/year** in imbalance/balancing costs today, potentially scaling to **£150m/year by 2035** if capacity targets are met, plus ~300,000 tonnes CO₂/year avoided from reduced fossil-peaker reliance. At project level, accurate forecasting directly cuts a generator's own imbalance-charge exposure and improves Balancing Mechanism/ancillary-service revenue capture.

**Co-located battery storage (BESS)**: increasingly the default for new UK utility-scale projects — PV and battery profiles are complementary (solar exports midday, batteries import off-peak/export at morning-evening peaks), enabling output smoothing, time-shifting to higher-value periods, reduced curtailment losses. Co-location also economises on grid connection (single connection serves both assets — relevant given standalone renewables/storage connections can face waits beyond 2030). Example: UK's first transmission-connected co-located project, **70MWp Larks Green** near Bristol, pairs a 49.5MW/99MWh BESS with solar behind a shared 120MW connection. Academic modelling: batteries + modest PV overbuilding + proactive curtailment can reduce the effective cost of firm PV generation by ~80% vs an unfirmed plant — supports storage as a tool to convert non-firm connections into effectively firmer capacity commitments for grid connection applications. Currently only ~12% of UK renewable installations are co-located with storage — grid interconnection/permitting complexity is the biggest cited barrier (43% of surveyed conference attendees).

---

## 5. Key UK data sources/APIs

### 5.1 DNO capacity/heatmap portals

See the full table in §1.4. Cross-DNO signposting: [ENA — Connections data](https://www.energynetworks.org/industry/connecting-to-the-networks/connections-data). Emerging: **National Energy System Map (NESM)** — ENA + Ordnance Survey + 1Spatial proof-of-concept integrating asset/ownership data from all GB electricity/gas network operators into OS's Digital Asset Hub; still proof-of-concept status, no confirmed live production URL — treat as emerging, not yet a primary go-to portal ([ENA — NESM announcement](https://www.energynetworks.org/newsroom/new-digital-system-map-to-harness-the-power-of-data-to-deliver-net-zero); [OS — Mapping the UK's energy network](https://www.ordnancesurvey.co.uk/insights/mapping-the-uks-energy-network)).

### 5.2 Ordnance Survey data

- **OS Data Hub** ([osdatahub.os.uk](https://osdatahub.os.uk/)) — unified developer platform: APIs, download service, Data Package Creator. Key APIs: **Maps API** (raster basemaps), **NGD (National Geographic Database) API** / legacy Features API (vector querying of buildings/roads/rivers/land parcels, OGC-compliant GeoJSON), **Names API** (geocoding, premium-gated). Tiered access: free open-data + basic plan, Premium plan with first £1,000/month of premium calls free ([OS NGD API — Features](https://www.ordnancesurvey.co.uk/products/os-ngd-api-features); [Plans — OS Data Hub](https://osdatahub.os.uk/plans)).
- **OS MasterMap Topography Layer** — detailed vector landscape representation (buildings, roads, land use, natural features), TOID-referenced, refreshed every 6 weeks; includes a **Building Height Attribute** explicitly marketed for rooftop/ground solar siting and shading feasibility. Formats: GeoPackage/GML/Vector Tile ([OS MasterMap Topography Layer](https://www.ordnancesurvey.co.uk/products/os-mastermap-topography-layer)).
- **OS Terrain 50** — open/free height-contour dataset (contours, spot heights, breaklines, coastline) for GB, usable for slope-angle and aspect analysis — relevant for panel-tilt optimisation, drainage/runoff risk, general renewable-siting screening ([OS Terrain 50, Open Data Downloads](https://osdatahub.os.uk/downloads/open/Terrain50)).

### 5.3 Agricultural Land Classification (ALC) datasets

- **Provisional ALC map** — 5-grade national classification (climate + site factors + soil), digitised from the original 1:250,000 map (England only) ([data.gov.uk — Provisional ALC](https://www.data.gov.uk/dataset/952421ec-da63-4569-817d-4d6399df40a1/provisional-agricultural-land-classification-alc2); also on [Natural England Open Data Geoportal](https://naturalengland-defra.opendata.arcgis.com/datasets/Defra::provisional-agricultural-land-classification-alc-england/about)).
- **Post-1988 detailed ALC surveys** — finer-resolution resurvey of selected areas (main programme 1988-99), including the critical Grade 3a/3b sub-division for the BMV test. Scales 1:5,000-1:50,000 (typically 1:10,000), open data (OGL) with site survey reports ([data.gov.uk — ALC Grades Post-1988](https://www.data.gov.uk/dataset/c002ceea-d650-4408-b302-939e9b88eb0b/agricultural-land-classification-alc-grades-post-1988-survey-polygons1)).
- **Access**: both layers viewable via **MAGIC** ([magic.defra.gov.uk](https://magic.defra.gov.uk/)) — Natural England's cross-agency (Defra/EA/Historic England/Forestry Commission/MMO) aggregator of 400+ environmental datasets. Also downloadable via **data.gov.uk**/CKAN.

### 5.4 NESO data

- **NESO Data Portal** ([www.neso.energy/data-portal](https://www.neso.energy/data-portal)) — successor to data.nationalgrideso.com: TEC register, constraint volumes/costs, generation/demand forecasts, balancing services data, TNUoS charges, carbon intensity, Demand Flexibility Service data.
- **Electricity Ten Year Statement (ETYS)** — annual 10-year transmission network requirements/capability view, built from Future Energy Scenarios (FES); being folded into a new **Centralised Strategic Network Plan (CSNP)** for integrated long-term planning ([NESO — ETYS](https://www.neso.energy/publications/electricity-ten-year-statement-etys)).
- **TEC Register** — updated **twice weekly** (Tue/Fri); since 21 Nov 2025 includes a "Gate" column (Gate 1/2) reflecting Connections Reform; capacity currently in aggregate (stage/technology disaggregation planned) ([NESO — TEC register](https://www.neso.energy/data-portal/transmission-entry-capacity-tec-register)).
- **Connections queue/reform data**: TMO4+ reform approved by Ofgem 15 April 2025; reformed queue (published 8 Dec 2025) = 381.5GW. Ongoing progress at [About Connections Reform](https://www.neso.energy/industry-information/connections-reform/about-connections-reform), [Connections Reform Results](https://www.neso.energy/industry-information/connections-reform/connections-reform-results), [Queue management](https://www.neso.energy/industry-information/connections/queue-management).

**Note on link stability**: DNO portal URLs periodically migrate between opendatasoft-hosted domains and rebranded names (e.g. NGED's post-WPD rebrand) — live-link check recommended before embedding these as hardcoded endpoints in a planner tool.

---

## Consolidated source list (primary/regulatory only — see inline citations above for full secondary/trade-press sourcing)

- Ofgem — SEG: https://www.ofgem.gov.uk/environmental-and-social-schemes/smart-export-guarantee-seg
- ENA — G98/G99 forms & guides: https://www.energynetworks.org/publications/all-g98-g99-forms
- EREC G99 Issue 2 (2025): https://dcode.org.uk/assets/250307ena-erec-g99-issue-2-(2025).pdf
- legislation.gov.uk — ESQCR 2002 Reg. 27: https://www.legislation.gov.uk/uksi/2002/2665/regulation/27
- legislation.gov.uk — GPDO 2015 Sch. 2 Part 14: https://www.legislation.gov.uk/uksi/2015/596/schedule/2/part/14
- GOV.UK — NPS EN-3 (2025): https://www.gov.uk/government/publications/national-policy-statement-for-renewable-energy-infrastructure-en-3-2025
- legislation.gov.uk — SI 2025/694 (NSIP threshold): https://www.legislation.gov.uk/uksi/2025/694/pdfs/uksiem_20250694_en_001.pdf
- NESO — TEC register: https://www.neso.energy/data-portal/transmission-entry-capacity-tec-register
- NESO — Connections Reform: https://www.neso.energy/industry-information/connections-reform/about-connections-reform
- GOV.UK — CfD AR6 results: https://www.gov.uk/government/publications/contracts-for-difference-cfd-allocation-round-6-results
- GOV.UK — CfD AR7 results: https://www.gov.uk/government/publications/contracts-for-difference-cfd-allocation-round-7-results
- OS Data Hub: https://osdatahub.os.uk/
- MAGIC (Natural England ALC): https://magic.defra.gov.uk/
- EPRI — OpenDSS: https://www.epri.com/pages/sa/opendss?lang=en-US
