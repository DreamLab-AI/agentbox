# Reference Scenes: Verified Anatomy of 52 Finished Instructor Files

Headless `bpy` introspection of 52 finished `.blend` files across 11 purchased
Blender-in-Claude-Code courses (46 saved in Blender 5.1, 5 in 3.3, 1 in 4.0).
Every number below was pulled directly from `render`, `modifier_histogram`,
`materials[].principled`, `lights[]`, `cameras[]`, and `world` fields on each
file — no course video or written lesson text was read to produce this
document.

## 1. How To Read This

These are measured facts from 52 *finished, delivered* instructor scenes —
use them as calibration ranges for "does this look like a professional
scene," not as rules to enforce. A number appearing once (an outlier bevel,
a single textured material) is flagged as such; do not treat n=1 as a norm.
Where the introspection pass captured a modifier's *type* but not its
*parameters* (Decimate ratio, Displace strength/midlevel, Mask threshold),
that gap is stated explicitly rather than guessed.

## 2. Render Defaults By Intent

Engine/sample-count pairs observed (52 files):

| Engine | Samples | Files | Typical use |
|---|---|---|---|
| Cycles | 512 | 27 | Default "hero" quality across most Cycles courses |
| EEVEE (legacy) | 64 | 18 | Every EEVEE file in the corpus uses exactly 64 — never tuned up or down |
| Cycles | 128 | 3 | Early setup/blockout files, or low-poly hero renders (pirate ship) |
| Cycles | 256 | 2 | Mid-detail hero renders with transmission materials |
| Cycles | 4096 | 1 | Single hero sculpt (bear), 360k tris, textured skin |
| Cycles | 300 | 1 | Asset-library file (Tiny Eye addon, Blender 4.0) |

Resolution: 46/52 files render at **1920×1080**. The 6 exceptions are all
deliberate aspect choices tied to subject: 1920×1920 (square hero sculpt),
1200×1500 (portrait, 4:5), 1920×1200 (wide environment), 1280×720 ×2
(cinematic/lower-cost hero shots), 800×800 (small asset-library preview).

Grouped by intent, with representative files:

- **Hard-surface hero build → Cycles 512spp, 1920×1080.** *hard-surface-modeling*
  (turret, 9/9 files) and *ai-box-modeling* (house, 12/13 files) both hold
  Cycles 512 flat through the entire course — sample count doesn't change as
  the build gets more complex.
- **Panel/hull hard-surface with heavy instancing → Cycles 512 for blockout
  and final, EEVEE 64 for the lighting-iteration files in between.**
  *generate-asset-libraries*: files 1–3 and 4.1 are Cycles 512; files 4.2,
  5.1, 5.2 (adding a 27-light rig) drop to EEVEE 64 for fast relight
  iteration; file 5.3 ("Completing the Scene," 308k tris) returns to Cycles
  512 for the delivered render. **Pattern worth copying: iterate lighting in
  EEVEE, finalize in Cycles at the same sample count you'd use for modeling.**
- **Stylized/low-poly and teaching scenes → EEVEE 64, flat.** *low-poly-stylization*,
  *introduction-to-3d-modeling*, *master-blender* (shader demos), *primitive-modeling-fundamentals*
  (simple lectures) all sit at EEVEE 64 regardless of scene complexity —
  Farm1.blend (197 objects, 57 materials) renders at the same 64 samples as
  a single loop-cut exercise.
- **Organic/sculpt hero → Cycles high-sample, resolution matched to subject.**
  The two highest tri-count files in the corpus (360,592 and 411,604) split
  between Cycles 4096spp (sculpt, square format) and EEVEE 64 (portrait
  lighting study, 4:5 format with a tuned 4-light AREA rig — see §5). EEVEE
  is evidently considered final-quality here once light energies are hand-tuned,
  not just a preview engine.
- **Pirate ship / desk hero (primitive-modeling-fundamentals) → Cycles 128spp,
  1280×720.** The two most complex files in that course drop to half the
  sample count used elsewhere in the corpus — acceptable when the shot is
  smaller-format and geometry-heavy (45,660 tris) rather than material-heavy.

```python
# Representative "hard-surface hero" render block, values observed
# verbatim across hard-surface-modeling and ai-box-modeling
scene.render.engine = 'CYCLES'
scene.cycles.samples = 512
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080

# Representative "fast iteration / stylized final" block
scene.render.engine = 'BLENDER_EEVEE'   # or BLENDER_EEVEE_NEXT on 4.2+
scene.eevee.taa_render_samples = 64
```

## 3. Modifier-Stack Signatures By Domain

Global histogram across all 52 files: DISPLACE 572, DECIMATE 572, BEVEL 479,
geometry-NODES 369, SUBSURF 148, MASK 69, MIRROR 30, ARRAY 29,
WEIGHTED_NORMAL 22, SOLIDIFY 10, SCREW 10, plus single-digit CURVE, WIREFRAME,
PARTICLE_SYSTEM. **Read the top two with care before generalizing** — see
3.1.

### 3.1 The Displace+Decimate pair is one course's rock-scatter technique, not a general convention

All 572 DISPLACE and all 572 DECIMATE instances come from exactly one
course, *ai-box-modeling*, files 3 through 13 (11 files × 52 objects each =
572 — an exact match, confirmed per-file). The 52 objects are a `Stone_00`…
`Stone_51`-style scatter set: each stone is a ~162-vertex / 320-tri base
mesh carrying a `Displace` (organic noise bump) → `Decimate` (planar
collapse back to a faceted low-poly read) pair, sized roughly 0.3–0.7 m.
This is a real, reusable technique — **noise-displace-then-decimate for
cheap procedural rock/pebble variation without sculpting** — but it is
domain-specific to ground-scatter decoration, not a general "every hard-surface
object gets Displace+Decimate" pattern. Do not read the global histogram as
"Displace and Decimate are the most common modifiers in professional
Blender work"; they're the most common *because one course scattered 52
rocks 11 times*.

```python
# Rock/pebble scatter signature (ai-box-modeling, files 3-13)
# base mesh ~162 verts / 320 tris per stone, applied to a fixed 52-object set
mod_disp = stone.modifiers.new("Displace", 'DISPLACE')
mod_disp.strength = ...   # not captured by this introspection pass
mod_dec = stone.modifiers.new("Decimate", 'DECIMATE')
mod_dec.ratio = ...       # not captured — introspection recorded type only
```

### 3.2 Hard-surface hero prop: Bevel + Subsurf + Weighted Normal + Mirror

*hard-surface-modeling* (turret) is the cleanest hard-surface signature in
the corpus and accounts for 107 of 479 total Bevel instances and 55 of 148
Subsurf instances on its own. Progression across the course's own files:

| File | Bevel | Subsurf | Weighted Normal | Mirror | Tris |
|---|---|---|---|---|---|
| 2. Base_Blockout | 3 | 3 | — | — | 212 |
| 6. Pivot Assembly | 22 | 12 | 5 | 9 | 27,143 |
| 7.2. Polishing (final) | 27 | 14 | 6 | 9 | 28,163 |

Bevel widths in this course span **0.001–0.0131 m (median)** across
segment counts of 1 (15 uses, sharp mechanical chamfers), 2 (49 uses,
default rounded edge), and 3 (22 uses, hero read-edges meant to catch
specular highlights). One outlier bevel at 1.4064 m exists on a single large
cylinder (`Cylinder.006`) — a big-radius base-plate edge, not representative
of the part-scale bevels above it. **Weighted Normal always appears paired
with Mirror and a completed Bevel/Subsurf stack** — it shows up only once
Bevel count exceeds ~20, i.e. once the model is dense enough that shading
artifacts from mirrored/beveled normals need correcting, not from the start.

```python
bevel = obj.modifiers.new("Bevel", 'BEVEL')
bevel.width = 0.005      # generate-asset-libraries panel default
bevel.width = 0.013      # hard-surface-modeling hero median
bevel.segments = 2       # modal choice (211/248 Bevel instances corpus-wide)
bevel.limit_method = 'ANGLE'

subsurf = obj.modifiers.new("Subdivision", 'SUBSURF')
subsurf.levels = 2                 # modal viewport level (55/83)
subsurf.render_levels = 2          # modal render level (58/83)
```

### 3.3 Panel/hull hard-surface: Bevel + auto-smooth Nodes, heavily instanced

*generate-asset-libraries* (356 of 479 Bevel instances, 361 of 369 Nodes
instances) is a different hard-surface shape: bevel width is **locked at
0.004–0.005 m, always 2 segments**, applied near-uniformly to every panel
instance (159 Bevel calls captured with width/segments recorded). The
"geometry-NODES" modifier the histogram totals to 369 is **not hand-built
procedural geometry nodes** — every single instance (166 sampled directly,
361 in this course) is named `Smooth by Angle`, Blender's built-in
auto-smooth-by-angle node group added when an object uses Shade Auto Smooth
(Blender 4.1+). Read "NODES: 369" in a histogram as "369 objects use
angle-based auto-smooth shading," not as evidence of authored geometry-node
graphs — none were found in this corpus.

```python
# Panel/hull small-part bevel — locked width+segments across 159 instances
bevel = obj.modifiers.new("Bevel", 'BEVEL')
bevel.width = 0.005
bevel.segments = 2

# What "NODES" actually means in this corpus, 361/369 instances:
# bpy.ops.object.shade_auto_smooth() equivalent — adds a "Smooth by Angle"
# node-group modifier, not a hand-authored geometry-nodes tree.
```

### 3.4 Boolean/non-destructive & array repeats

Array counts observed: 10 (14 uses — tree-row/panel-row repeats), 4 (5
uses), 18 (2 uses), plus one-off counts (5, 1). `use_relative=True` /
`use_constant=False` is the modal Array configuration — offsets are driven
by object bounds, not a fixed distance, matching the "seed one instance,
array the row" convention. Mirror axis is overwhelmingly X (`axis=[0]`, 16
uses) with a minority on Y (`axis=[1]`, 2 uses) — confirms bilateral (X)
symmetry as the default assumption unless the part is asymmetric on a
different plane. Solidify thickness spans **0.003 m** (thin loop-cut panel,
*introduction-to-3d-modeling*) to **0.03 m** (house exterior wall detail,
*ai-box-modeling*), with one negative offset (-0.018) on the vehicle
course's balloon envelope — a shell built with outward-facing normals and
solidified inward.

### 3.5 Sculpt/organic

Only 2 Subsurf-bearing files exceed 100k tris via Subsurf+Mirror+Mask rather
than sculpt-specific modifiers: the bear sculpt (`SUBSURF: 3, MASK: 1,
MIRROR: 2, PARTICLE_SYSTEM: 1`, 360,592 tris) and the Tiny Eye addon library
(`SUBSURF: 68, MASK: 68` — one Subsurf+Mask pair per eye variant across 69
near-identical objects, 52,096 tris). No Multires or Remesh modifiers were
found anywhere in the 52 files — the two "sculpting" courses in this corpus
reach their tri counts through Subsurf levels (up to render_levels=3) and
Mirror, not Blender's dedicated sculpt-multires pipeline. The single-mesh
head sculpt (143,368 tris) and the portrait-lighting hero (411,604 tris,
highest in the corpus) carry only a Mirror modifier each at the introspected
level — their density is baked into the base mesh, not built by a modifier
stack, consistent with sculpted geometry that was later decimated/exported
flat.

## 4. Material Norms

534 materials introspected across 52 files, all `use_nodes=True`.

- **Metallic**: 143/534 (27%) non-zero. Where non-zero, values cluster at
  clean round numbers — 0.1, 0.5, 0.6, 0.8, 0.85, 0.9, 1.0 — not fine-tuned
  fractional values. Full metals (1.0) appear on named "Metal"/"Blade"
  materials; 0.8–0.9 appears on "hard-surface panel" metals (FP_Frame,
  FP_Grate at 0.9); soft metallic touches (0.1) appear on primary hero
  materials meant to read mostly dielectric with a hint of metal response.
- **Roughness**: spans 0.05–1.0, median 0.55. Two clear clusters: **hero/mechanical
  smooth-metal reads at 0.1–0.2** (a "Metal Shader" material at 0.1727,
  polished blade steel at 0.05–0.4), and **environment/organic/stylized
  materials sit at 0.7–1.0** (low-poly stylized set is uniformly 0.85; wood
  bark/leaf materials at 1.0; ground/gate materials at 0.9).
- **Transmission**: only 3/534 materials (0.6%) are non-zero — 0.1, 0.6, and
  0.6545. All three are on liquid/glass-adjacent surfaces (pirate ship
  "Water," vehicle course "BalloonPanelMat" fabric-with-sheen). Treat
  transmission as a rare, deliberate call, not a default to reach for.
- **Emission**: 27/534 materials (5%) have non-zero Emission Strength,
  ranging 0.4–15.0 — mostly small trim/glow accents (ExtLight_Glow-class
  materials at 2.2–6.0) rather than primary light sources; the scene's
  actual illumination almost always comes from `lights[]` objects, not
  emissive shader surfaces.
- **Image textures**: only 2/534 materials (0.4%, both in one file — the
  bear sculpt, `Painting.png`, sRGB) use a baked image texture. Every other
  material in the corpus — including all stylized, hard-surface, and
  environment work — is procedural/flat Principled BSDF with no texture
  input. **This corpus strongly favors flat-shaded or noise/ColorRamp-procedural
  materials over UV-baked textures.**
- **Node types used** (534 materials, node-type tally): `BSDF_PRINCIPLED`
  (499), `OUTPUT_MATERIAL` (534, one per material as expected),
  `BSDF_DIFFUSE` (36, mostly paired with the recurring "Dots Stroke"
  material — see note below), `GROUP` (31, reused node-group shaders),
  `TEX_NOISE` (25), `VALTORGB`/ColorRamp (20), `TEX_COORD` (26), `MAPPING`
  (11), `TEX_IMAGE` (2, matching the bear sculpt above), `BUMP` (8),
  `TEX_WAVE` (3), `EMISSION` (3). Procedural noise + ColorRamp is a far more
  common "add detail" move than image textures in this corpus.
- **"Dots Stroke" is a bundled template material, not a lesson choice**: it
  appears in 36/52 files with an identical value every time
  (metallic=0.0, roughness=0.5) — it is a starter-file default (a
  sketch/dots-style diffuse+principled mix), not evidence of a deliberate
  per-lesson material decision. 29 materials are also still literally named
  `Material`/`Material.001` (unrenamed Blender defaults) — leaving default
  names on early-stage or blockout materials is normal in this corpus, not
  a sign of an unfinished scene.

```python
# Observed Principled defaults worth using as starting points
mat.metallic = 0.0        # 73% of materials
mat.roughness = 0.5        # most common single value; 0.85-1.0 for stylized/organic
mat.transmission_weight = 0.0   # reserve non-zero for glass/liquid/thin-fabric only
```

## 5. Lighting/Scene Norms

Light objects introspected: 56 POINT, 76 AREA, 35 SUN, 0 SPOT.

- **SUN energy = 1.0 and POINT energy = 1000.0 are Blender's untouched
  factory defaults**, and they dominate their respective histograms (SUN:
  27/35 instances at exactly 1.0; POINT: 12/56 at exactly 1000.0, plus a
  further block at 50.0 from one course's fill rig). **Do not read these as
  tuned artistic choices** — they mark scenes where lighting wasn't the
  lesson's focus. The genuinely tuned rigs are the AREA-light setups below.
- **AREA lights are where energy is actually tuned.** Three distinct tuned
  rigs:
  - *generate-asset-libraries* panel scenes: a repeating 4-light key rig at
    **220.0 W, size 2.4–2.6 m**, plus a dense fill of ~7–17 small POINT
    lights at **50.0 W** marking emissive trim/detail — total light count
    reaches 27–28 objects in the final files.
  - *primitive-modeling-fundamentals* desk scene: **300/800/400 W** at
    sizes 3.0/2.5/1.5 m — a classic three-point-style rig (key/fill/rim)
    with mismatched but complementary energies rather than equal-power
    lights.
  - *unveil-the-perfect-glow* portrait study (highest-fidelity lighting in
    the corpus): **39.27, 11.78, 31.42, 47.12 W** at sizes 1.0–3.24 m — small
    fractional energies because this file's world/exposure setup is tuned
    for a close portrait subject, not a full room. This is the file to cite
    when a user wants "photographic portrait lighting," not the desk rig.
- **Stylized/outdoor SUN energies** depart from the 1.0 default in a
  band of **0.6–4.0 W** (desert 0.6/3.4, farm 3.2, Japan scene 2.4/3.0,
  pirate ship 4.0) — read this as the "outdoor day-lit stylized scene" sun
  range, distinct from the untouched-default 1.0 SUN used in un-lit-focus
  hard-surface blockouts.
- **Cameras**: 22 introspected, lens range 25–85 mm, **modal choice 50 mm
  (16/22, standard/portrait-neutral)**. **Zero of 22 cameras have DOF
  enabled** — every camera in this corpus is a pinhole/deep-focus camera;
  depth-of-field is not used anywhere in the delivered files, including the
  portrait-lighting hero shot.
- **World**: 9/52 files use an environment texture (`has_env_tex=True`,
  HDRI-style image lighting); 20/52 use a procedural `TEX_SKY` node; 17/52
  use a flat `BACKGROUND`-only world (solid color, no sky/HDRI); a handful
  add `VOLUME_SCATTER` (4 files, atmospheric haze on TEX_SKY worlds) or a
  full `LIGHT_PATH`/`MAPPING`/`MIX_SHADER` HDRI-blend graph (2 files, the
  most elaborate world setups in the corpus). **Flat or procedural-sky
  worlds outnumber HDRI environment textures roughly 2:1** — HDRI is the
  minority choice here, reserved for scenes that need reflective
  environment response (hard-surface metal panels).

## 6. Tri-Budget Guidance

Corpus-wide, excluding 3 empty/setup-only files with no geometry: **min 64
tris, median ≈10,586 tris, max 411,604 tris** (49 geometry-bearing files).
By asset class, with representative files:

| Class | Tri range | Representative files |
|---|---|---|
| Teaching primitive / single-lesson exercise | 64–976 | Objects and Transforms (64), Create Cup (92), Low-Poly Sword (272), Building a tree (976) |
| Early hard-surface blockout | 108–756 | hard-surface-modeling files 1–3.2 |
| Low-poly stylized environment (full scene) | 1,312–14,452 | Japan Scene (1,312), Desert Scene (9,658), Farm1 (14,452) |
| Polished hard-surface hero prop | 8,600–28,163 | hard-surface-modeling turret, files 4–7.2 |
| Architectural build (house, full course arc) | 7,980–15,360 | ai-box-modeling, files 3–6.3 |
| Desk/prop with area-light rig | ~1,048 | Low Poly Computer Desk Setup |
| Complex low-poly hero (many parts, no subsurf) | 45,660 | Detailed Pirate Ship |
| Panel/hull scene, heavily array/mirror-instanced | 108–308,240 | generate-asset-libraries, file 1 (108, single hull panel) through file 5.3 (308,240, full instanced scene) |
| Asset-library variant set (many near-identical objects) | 52,096 | Tiny Eye Addon Library, 69 objects |
| Sculpt/organic hero | 143,368–411,604 | Head Sculpt (143,368), bear sculpt (360,592), portrait-lighting hero (411,604) |

Two things stand out: (1) the same course arc can span four orders of
magnitude in tri count depending on whether the file is a single instanced
part or the fully-populated final scene — budget per *shot*, not per
*course*; (2) sculpt/organic hero files sit an order of magnitude above
hard-surface hero files at similar "finished, deliverable" status — don't
apply a hard-surface tri ceiling to a sculpt task.

## 7. Calibration Prompts

Fresh example prompts an agent can use to steer output toward these
measured norms (not verbatim from any course):

1. *"Model this turret mechanism as a hard-surface hero prop: bevel width
   around 0.005–0.013 m at 2 segments for standard edges, push to 3 segments
   only on read-critical highlight edges, Subsurf at viewport level 2 /
   render level 2, and finish with a Weighted Normal modifier once the
   Bevel count passes about 20. Render at Cycles, 512 samples, 1920×1080."*
2. *"Build this as an instanced hard-surface panel set: lock every Bevel
   modifier to 0.004–0.005 m width, 2 segments, and auto-smooth by angle
   rather than hand-building a geometry-nodes smoothing graph. Preview
   lighting changes in EEVEE at 64 samples, then re-render the delivered
   shot in Cycles at 512 samples once the rig is final."*
3. *"Keep this low-poly environment prop under roughly 2,000 tris — the
   corpus's low-poly stylized scenes land in the 1,300–14,500 range for
   entire environments, not single props, so a single prop should sit
   well under that. Use flat Principled BSDF materials at roughness
   0.7–1.0, no image textures, metallic 0 unless the object reads as bare
   metal."*
4. *"Light this as a tuned portrait/product shot, not a default scene: use
   3–4 AREA lights in the 12–50 W range at 1–3.5 m size rather than leaving
   SUN at the factory-default 1.0 W or POINT at 1000 W. Keep the camera at
   a standard 50 mm with DOF off unless the user explicitly asks for
   depth-of-field — none of the 52 reference files use it."*
