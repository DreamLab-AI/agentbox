# Scene Building, Lighting & Rendering (BlenderMCP reference)

Distilled from: `blender-scene-building-and-rendering-with-claude-code` (prompt
transcript + one product-shot reference render), plus `bpy` first principles
for two video-only courses (`illuminating-mastery-advanced-lighting-techniques`,
`unveil-the-perfect-glow-advanced-portrait-lighting` — one still + one `.blend`
name only) and one video-only rigging/animation course. VIDEO-GAP sections are
marked explicitly below.

All work happens through BlenderMCP's `execute_code` running `bpy` — there is
no dedicated "add light" or "set render settings" command. Screenshots
(`get_viewport_screenshot`) show fast OpenGL previews, not final render quality;
only `bpy.ops.render.render()` produces the real result.

## 1. When this applies

Use this reference whenever a task involves: placing/aiming a camera, adding
or tuning lights (single-light, three-point, or portrait setups), lighting a
scene from an HDRI or a flat/studio backdrop, choosing Cycles vs EEVEE and
setting render output, or doing minimal armature + keyframe animation (camera
moves, simple object rigs).

## 2. Workflow

1. **Survey.** `get_scene_info` to see what objects/lights/cameras already
   exist. Do not assume a clean scene — most tasks start mid-scene ("read
   this, now build it", "now add X, rest stays the same").
2. **State the plan in one line before executing.** Name the light rig (key/
   fill/rim, or sun+world), the camera framing, and the render engine/output
   *before* writing the `bpy` script. This gives the user a cheap point to
   redirect you before geometry/light data churns.
3. **Camera pass.** `execute_code` to create or re-aim the camera; set
   `scene.camera`; screenshot from the camera view (or `get_viewport_screenshot`
   after switching the 3D view to camera perspective) to confirm framing
   before touching lights.
4. **Lighting pass, one light at a time.** Add the key light, screenshot,
   add fill/rim or world lighting, screenshot again. Never write the whole
   rig in one uninspected block — light interactions (GI bounce, HDRI
   rotation) are easy to get backwards and hard to debug after the fact.
5. **World/background pass.** Decide HDRI vs flat backdrop vs solid color
   *before* materials are judged — "photorealistic" material requests
   usually fail if the lighting context is flat or mismatched, so fix
   lighting first, then re-evaluate materials.
6. **Render settings pass.** Set engine, resolution, samples, denoiser,
   output path explicitly. Confirm with the user's stated numbers rather than
   silently defaulting — course transcripts show users specifying exact
   resolution/sample counts per shot (e.g. 2048x2048 @ 128 samples).
7. **Render and inspect.** `bpy.ops.render.render(write_still=True)`, then
   read back the output file or re-screenshot to sanity check exposure and
   framing. If it looks wrong, isolate: is it a light energy problem, a view
   transform problem, or a missing `scene.camera`? Check each independently
   rather than re-lighting from scratch.
8. **(If animating) keyframe pass last.** Lock geometry, materials and
   lighting before keying transforms — re-lighting after animating means
   re-checking every frame, not just one.

## 3. `bpy` technique notes

### Camera: creation, focal length, framing, look-at

```python
import bpy, math
from mathutils import Vector

cam_data = bpy.data.cameras.new("HeroCam")
cam_data.lens = 50          # mm, standard "normal" framing; 24-35 = wide/env, 85+ = portrait compression
cam_data.sensor_fit = 'AUTO'
cam_obj = bpy.data.objects.new("HeroCam", cam_data)
bpy.context.collection.objects.link(cam_obj)
bpy.context.scene.camera = cam_obj      # nothing renders without this set
cam_obj.location = (6, -8, 3)

# Depth of field
cam_data.dof.use_dof = True
cam_data.dof.focus_object = bpy.data.objects.get("Product")  # or set focus_distance directly
cam_data.dof.aperture_fstop = 2.8        # lower f-stop = shallower DOF, stronger blur

# Look-at via constraint (best when target moves / you want live re-aim)
target = bpy.data.objects["SubjectEmpty"]
tt = cam_obj.constraints.new(type='TRACK_TO')
tt.target = target
tt.track_axis = 'TRACK_NEGATIVE_Z'   # camera looks down local -Z
tt.up_axis = 'UP_Y'

# Look-at via math (one-shot orientation, no dependency on a constraint)
direction = target.location - cam_obj.location
cam_obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
```

Framing checks: after positioning, switch a viewport to camera view and
screenshot rather than guessing from world-space coordinates — human framing
intuition ("is the subject centred, how much headroom") does not transfer
well from raw XYZ numbers.

### Light types and their `bpy` data

```python
def make_light(name, kind, energy, location, **kw):
    data = bpy.data.lights.new(name, type=kind)   # 'SUN' | 'POINT' | 'SPOT' | 'AREA'
    data.energy = energy
    for k, v in kw.items():
        setattr(data, k, v)
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    bpy.context.collection.objects.link(obj)
    return obj

# SUN: energy is irradiance in W/m^2, no distance falloff (directional, like real sunlight)
sun = make_light("Sun", 'SUN', 3.0, (0,0,10), angle=math.radians(2))  # angle = apparent size -> shadow softness

# POINT: energy is radiant power in Watts, falls off with distance^2
point = make_light("Bulb", 'POINT', 1000, (2,-2,3), shadow_soft_size=0.15)  # radius -> soft shadow edges

# SPOT: point light + cone
spot = make_light("Spot", 'SPOT', 800, (0,-4,4), spot_size=math.radians(45), spot_blend=0.3)

# AREA: energy also Watts; size sets the physical softbox dimensions
area = make_light("KeyLight", 'AREA', 500, (3,-3,3), shape='RECTANGLE', size=1.0, size_y=1.6)
```

Gotcha: **light energy units are not interchangeable across types.** A `SUN`
at `energy=3` is bright (W/m²); a `POINT` needs energies in the hundreds-to-
thousands (W) at typical scene scale to read the same. Copy-pasting an energy
value between light types is the most common "why is my scene black/blown
out" bug.

### Three-point / portrait lighting as method

This is a *pattern*, not a fixed recipe — apply the roles, not the numbers:

- **Key**: the dominant light that defines form. Placed off-axis from the
  camera (roughly 30-45°) and usually slightly above the subject's eye-line.
  Its distance/size sets both brightness and shadow softness (closer + larger
  = softer edge transfer, per the inverse-square + angular-size relationship).
- **Fill**: raises the shadow side without erasing the shadow itself. Prefer
  a large, weak, soft source (or a neutral bounce plane with an emission
  material) over a second hard light — a second hard key just creates a
  double-shadow. Control contrast by ratio: fill at roughly a quarter-to-half
  the key's effective brightness reads as classic portrait contrast; fill
  near key strength reads flat/commercial.
- **Rim/kick**: placed behind or to the side of the subject, aimed back
  toward camera, used to separate the subject's silhouette from the
  background. Non-negotiable when the background is dark — without edge
  light, a dark subject on a dark background loses its outline entirely.
- **Softness** is a function of the light's *angular size as seen from the
  subject*, not raw wattage: a small point light close up can be softer than
  a large area light far away. Tune via `AREA.size`, `POINT.shadow_soft_size`,
  or `SUN.angle` — not just energy.
- **Temperature contrast** (warm key vs cool fill/rim, or vice versa) reads as
  more "cinematic" than flat white light on all sources. Simplest control is
  `light.color = (r,g,b)` per light; for a physically-labelled kelvin value,
  give the light a node tree (`light.use_nodes = True`) and drive its color
  input from a Blackbody node instead of hand-picking RGB.

**VIDEO-GAP — first-principles only:** `illuminating-mastery-advanced-lighting-
techniques` has no HTML/txt in the downloaded assets at all (empty course
folder), so the ratios, modifier choices (softbox vs bounce vs flag) and any
signature setups that course teaches are not verifiable here — the above is
generic photographic/CG lighting theory applied to `bpy`, not that course's
content.

**VIDEO-GAP — partially observed:** `unveil-the-perfect-glow-advanced-
portrait-lighting` shipped one `.blend`
(`Philospher Lighting Tutorial 1 Tami Coker.blend`) and one reference still
(`Philospher Image #2 Tami Coker.png`). Only the *image* was inspected (the
`.blend` is binary, unread) — it shows a dramatic low-key bust portrait: a
warm, amber key grazing from camera-left-and-below, a cool blue rim/kicker
from camera-right separating the far edge of the beard and shoulder from a
pure black background, and no visible fill (deep, undetailed shadow on the
near-camera-right side of the face). That single-still evidence supports a
distinct pattern worth naming — **low-key dramatic bust lighting**: one warm
key + one cool rim, no fill, near-black world background so any un-lit
surface reads as true black rather than grey. This is inferred from the
image alone, not from course narration — the actual light counts, distances
and energies used in that `.blend` are unknown. Pulling the lecture video for
this course would let the queen verify (or replace) this inference with the
instructor's real numbers.

```python
# Low-key bust pattern, generalised (not the course's actual values):
make_light("KeyWarm", 'AREA', 400, (-2, -3, 1.5), size=0.6, color=(1.0, 0.72, 0.45))
make_light("RimCool", 'SPOT', 600, (2.5, 1.5, 2.0), spot_size=math.radians(30),
           spot_blend=0.15, color=(0.55, 0.7, 1.0))
world = bpy.context.scene.world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0,0,0,1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
```

### HDRI / world lighting

```python
world = bpy.context.scene.world
world.use_nodes = True
nt = world.node_tree
nodes, links = nt.nodes, nt.links
for n in list(nodes):     # clear default Background+Output pair if rebuilding
    nodes.remove(n)

output = nodes.new("ShaderNodeOutputWorld")
bg = nodes.new("ShaderNodeBackground")
env = nodes.new("ShaderNodeTexEnvironment")
mapping = nodes.new("ShaderNodeMapping")
coord = nodes.new("ShaderNodeTexCoord")

env.image = bpy.data.images.load("/path/to/hdri.exr")
links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
links.new(mapping.outputs["Vector"], env.inputs["Vector"])
links.new(env.outputs["Color"], bg.inputs["Color"])
links.new(bg.outputs["Background"], output.inputs["Surface"])

bg.inputs["Strength"].default_value = 1.2      # exposure of the environment
mapping.inputs["Rotation"].default_value[2] = math.radians(90)  # spin the HDRI (move the "sun")
```

- **Day-to-night swap**: don't add extra lights to fake it — replace
  `env.image` with a night-sky/dusk HDRI (or drive a `Mix` between two
  Environment Texture nodes with a single `Value` node so it's one control),
  and drop `bg.inputs["Strength"]` accordingly. Matches the "change scene HDRI
  day to night" class of request.
- **PolyHaven HDRIs**: only available if the user has enabled that feature in
  the BlenderMCP addon panel — use `search_polyhaven_assets`/
  `download_polyhaven_asset` (asset type `hdris`), then load the downloaded
  file the same way as above. Don't assume it's on; check `get_scene_info`
  or ask if unsure.
- **Studio/product backdrop (no HDRI at all)**: the reference render for this
  course (`cinematic_render.png`, a cosmetics product shot) shows a plain
  seamless white sweep, soft even shading, gentle contact shadows, no
  visible environment reflections — that's a flat/low-strength world plus a
  physical curved backdrop plane, not an HDRI:

```python
bpy.ops.mesh.primitive_plane_add(size=20, location=(0,0,0))
backdrop = bpy.context.active_object
# bevel the back edge for a seamless "infinity cove" curve
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='DESELECT')
# ... select back edge loop, then:
bpy.ops.mesh.bevel(offset=2.0, segments=12)
bpy.ops.object.mode_set(mode='OBJECT')
mat = bpy.data.materials.new("Backdrop")
mat.use_nodes = True
mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.95,0.95,0.95,1)
backdrop.data.materials.append(mat)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.15  # weak fill only
```

### Cycles vs EEVEE, and key render settings

```python
scene = bpy.context.scene
scene.render.engine = 'CYCLES'         # or 'BLENDER_EEVEE_NEXT' (4.2+) / 'BLENDER_EEVEE' (older)

# Cycles
scene.cycles.samples = 128
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPTIX'        # or 'OPENIMAGEDENOISE' if no NVIDIA
scene.cycles.device = 'GPU'            # also requires enabling a device in user preferences once

# EEVEE (property names vary between legacy EEVEE and EEVEE Next — check
# `dir(scene.eevee)` on the running version before assuming a name exists)
# scene.eevee.use_raytracing = True    # EEVEE Next screen-space/ray-traced reflections+shadows

scene.render.resolution_x = 2048
scene.render.resolution_y = 2048
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = "/absolute/output/path/render_001.png"

scene.view_settings.view_transform = 'Standard'   # 'AgX' is Blender 4.x default and desaturates/
                                                   # compresses highlights - flat-looking renders
                                                   # are often a view-transform issue, not a light one
scene.view_settings.exposure = 0.0

bpy.ops.render.render(write_still=True)
```

Tradeoff to state plainly when advising a user: **Cycles** is a path tracer —
physically grounded global illumination, accurate reflections/refraction/
caustics, but slower and noise-limited (needs enough samples + denoising to
clean up, especially in near-black low-key setups where variance is worst).
**EEVEE** is rasterized — near-instant iteration, good enough for viewport
matching, low-poly/stylized work, and fast previews, but historically
approximates GI/reflections (EEVEE Next in 4.2+ closes much of that gap with
ray-traced options at a performance cost). Default to EEVEE while composing a
shot (fast screenshot loop), switch to Cycles for the final hero render.

### Rendering loop discipline

Always `execute_code` the full chain — set camera, set engine/resolution/
samples, set filepath, then render — as one script per shot, rather than
setting properties across several separate calls where an earlier one could
silently be reset by an unrelated later script (e.g. a materials pass that
also touches `scene.render.engine`). Re-`get_scene_info` after a big multi-
step build to confirm the render settings still hold before the final render.

### Armature + keyframing (light coverage — see rigging VIDEO-GAP)

```python
# Minimal armature
bpy.ops.object.armature_add(enter_editmode=False, location=(0,0,0))
arm_obj = bpy.context.active_object
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_obj.data.edit_bones
eb[0].name = "Root"
eb[0].head, eb[0].tail = Vector((0,0,0)), Vector((0,0,1))
spine = eb.new("Spine")
spine.head, spine.tail = eb[0].tail, Vector((0,0,2))
spine.parent = eb[0]
spine.use_connect = True
bpy.ops.object.mode_set(mode='OBJECT')

# Parent a mesh to the armature with automatic weights
mesh_obj = bpy.data.objects["Character"]
mesh_obj.select_set(True)
arm_obj.select_set(True)
bpy.context.view_layer.objects.active = arm_obj   # armature must be the active object
bpy.ops.object.parent_set(type='ARMATURE_AUTO')   # heat-map weight generation

# Pose + keyframe
bpy.ops.object.mode_set(mode='POSE')
bone = arm_obj.pose.bones["Spine"]
bone.rotation_mode = 'XYZ'
scene.frame_set(1)
bone.rotation_euler = (0,0,0)
bone.keyframe_insert(data_path="rotation_euler", frame=1)
scene.frame_set(24)
bone.rotation_euler = (math.radians(15), 0, 0)
bone.keyframe_insert(data_path="rotation_euler", frame=24)
scene.frame_start, scene.frame_end = 1, 24
```

Camera-tracking-a-moving-target animation (the "premium animation... camera
tracking the watch" class of request) combines the Track To constraint above
with keyframed camera *location only* — let the constraint own rotation
entirely; do not also keyframe camera rotation, or the two fight each other.

**VIDEO-GAP:** `rigging-and-animation-with-blender-in-claude-code` shipped
with an empty `lessons/` and an empty `files/Blend Files/` directory — no
lecture titles, transcripts, or `.blend` staging files were downloaded at
all. Everything above is generic `bpy` armature/animation mechanics, not this
course's content — treat any actual technique (IK setup, walk-cycle timing,
weight-paint correction workflow, NLA usage) it teaches as fully unverified
until the videos are pulled.

## 4. Prompt-strategy notes

Fresh prompts illustrating each move (not lifted from any transcript):

- **Force a naming/plan step before geometry churns lights**: *"Before you
  touch any lights, tell me in one sentence which light is the key, which is
  the rim, and where the camera sits — then build it."*
- **Force incremental, inspectable light adds**: *"Add only the key light
  first and show me a camera-view screenshot before adding anything else."*
- **Pin down render settings explicitly rather than letting a default slip
  in**: *"Render this at 3000x2000, Cycles, 256 samples, OptiX denoiser, save
  to ./out/hero_v3.png — confirm those settings back to me before you render."*
- **Ask for a lighting-only diagnosis pass when a render looks wrong**:
  *"Don't touch materials yet — check whether this looks flat because of the
  view transform, the world strength, or the key light energy, and tell me
  which one before changing anything."*
- **Single-control day/night or mood swap**: *"Rig the HDRI swap behind one
  variable I can flip, not a full re-light — I want to be able to ask for
  'night' again later without you re-deriving the lights."*
- **Post-hoc structure pass** (mirrors the "organize the scene" request
  class): *"Now that the scene works, rename every light/camera/collection
  to describe its role (Key_Warm, Rim_Cool, Cam_Hero_01) and group them into
  a Lighting collection — don't change any values, just the organisation."*

## 5. Pitfalls

- **Energy units mismatch across light types** — see technique notes above;
  always re-derive energy per type rather than reusing a number.
- **Forgetting `scene.camera = cam_obj`** — render silently uses whatever
  camera was last active (or none), producing an empty or wrong-angle image.
- **AgX view transform mistaken for a lighting bug** — Blender 4.x defaults
  `view_settings.view_transform` to `AgX`, which noticeably compresses
  highlights/desaturates versus `Standard`/legacy Filmic. Check this before
  adding more lights to "fix" a flat-looking render.
- **World background changes killing GI, not just backdrop colour** — in
  Cycles the world also lights the scene; swapping to a flat dark world for
  aesthetics can remove most of the ambient fill, requiring a compensating
  light that wasn't needed before.
- **HDRI rotated wrong** — an environment texture's implied sun can end up
  behind the camera or through a wall; fix via the `Mapping` node's Z
  rotation, don't paper over it with an extra light pointing the "right" way
  (produces inconsistent double shadows).
- **Track To + keyframed rotation fighting each other** — pick one owner of
  camera rotation (the constraint) and keyframe location only; if you need
  the animation portable/bakeable, bake the constrained rotation to keyframes
  (Object > Animation > Bake Action equivalent) before further edits.
- **Automatic-weights armature parenting failing quietly** on non-manifold
  or self-intersecting meshes — deformation looks broken (limbs dragging
  unrelated geometry) with no error; check mesh manifoldness or fall back to
  nearest-vertex parenting plus manual weight correction for the bad areas.
- **Under-sampling low-key/near-black scenes** — variance is worst where
  luminance is near zero, so a dramatic rim-lit-on-black setup needs
  noticeably more Cycles samples (or a stronger denoiser pass) than a bright,
  evenly lit scene at the same nominal sample count; the denoiser can also
  smear fine rim-light edge detail if pushed too hard.
- **Confusing viewport screenshot quality with final render quality** —
  `get_viewport_screenshot` reflects the current viewport shading mode
  (Solid/Material Preview/Rendered), not necessarily Cycles final-quality
  output; don't approve a shot based on a Solid-mode screenshot.
