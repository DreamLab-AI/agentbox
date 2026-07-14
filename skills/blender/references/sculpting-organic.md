# Digital Sculpting & Organic / Portrait Work

## 1. When this applies

Any task that asks for an organic character, creature, or head/face — anything
whose final surface reads as continuous, muscular, or fleshy rather than
flat-faced/hard-edged. This is the one domain in the BlenderMCP workflow where
"decompose → execute_code → screenshot → correct" only covers the scaffolding.
The actual brushwork that makes a sculpt read as alive is a human-in-the-loop,
stroke-by-stroke activity that cannot be fully scripted. Treat everything
below as: what the agent *can* reliably automate, and where it must hand
control back and just watch.

## 2. Workflow

### Phase 0 — Base mesh (do this by hand-equivalent box modeling, not sculpt)

Sculpting needs a starting volume with roughly correct proportions and a
closed, manifold surface. Build it the same way as any other box-modeling
task: primitive → subdivision surface for a quick rounded preview → edit-mode
loop cuts, insets, and extrudes to block silhouette pieces (torso, head,
limbs, ears, nose) as **separate objects**, each roughly egg-shaped, mirrored
across the character's centerline with a Mirror modifier so only one side
needs building.

Why separate objects and not one mesh from the start: it is far easier to
scale/rotate/reposition a whole limb as an object than to wrangle loose
vertex selections mid-blockout. Fusion into one continuous sculptable surface
happens later, deliberately, via remesh.

Agent role here: mostly execute_code for primitive creation and transform
math when the user directs it verbally ("make the head 20% bigger", "space
the legs further apart"); screenshot after every structural change since
proportion judgment is visual, not numeric.

### Phase 1 — Unify the blockout into one sculptable mesh

Before entering Sculpt Mode for real:

1. Apply every modifier and transform on every blockout piece (mirror,
   subdivision surface, scale/rotation) so what you sculpt is real geometry,
   not a modifier preview.
2. Join all pieces that belong to the same sculptable surface into a single
   object. Keep parts that need independent transforms later (nose, if it
   was built with a stray origin; teeth; tongue; eyes) as separate objects —
   don't join blindly, then check with `get_scene_info` whether anything
   unwanted got swept in and separate it back out (select-linked + separate).
3. Run a **voxel remesh** on the joined mesh. This is the step that actually
   fuses previously-separate cube-based pieces (where seams touch) into one
   continuous manifold surface with even topology — dyntopo alone won't do
   this because it only adds detail under the brush, it doesn't re-topologize
   the whole object.
4. Voxel size is a search problem, not a fixed number: start coarse (fast to
   test), then binary-search downward wherever thin parts (fingers, ear rims)
   are fusing into blobs. Screenshot after each remesh — this is a visual
   call, not something to guess numerically.
5. Smooth away the blocky seam artifacts the remesh leaves behind with the
   Smooth brush (or hold the smooth-modifier key while using any brush) —
   broad strokes on large masses, small/light strokes on features you don't
   want to round off (ear rims, finger separation).

### Phase 2 — Enter Sculpt Mode and configure dyntopo + symmetry

Do this via `execute_code`, then screenshot to confirm the mode switch and
brush panel actually changed:

- Switch to Sculpt Mode.
- Turn symmetry on for whichever axis the blockout was actually mirrored
  across — do not assume X; confirm via `get_object_info` on the mesh's
  bounding box/mirror-modifier axis, or by eye on the screenshot. Getting
  this backwards means every stroke mirrors to the wrong side silently.
- Enable Dynamic Topology (dyntopo) and set an initial constant-detail
  resolution in the low-to-mid single digits/teens — start low. Dyntopo only
  fires while using a topology-adding brush (Clay Strips, Crease, Draw); it
  does nothing under Grab, which only relocates existing vertices. That's by
  design, not a bug to work around.
- Run a **Detail Flood Fill** once symmetry/dyntopo are set, so the whole
  mesh starts from uniform polygon density before any brushwork begins.
  Re-run it any time you notice visible density-seam lines after a pass of
  heavy local detailing — those lines are a density mismatch between
  worked and unworked regions, not a shading bug.

### Phase 3 — Silhouette pass (Grab-dominant)

Shape masses before any surface detail: widen/narrow, push/pull cheek and
brow volumes, carve the space where eye sockets and a nose channel will sit
(you're not sculpting eye sockets directly — you're removing the material
around where an eye object will later sit, and the socket reads correctly
once the eye is dropped in). Use a large brush radius. This phase is where
proportion mistakes are cheapest to fix, so iterate here before moving to
Phase 4. Grab is non-destructive to topology, so it's safe to overuse while
proportions are still being negotiated.

Drop in cheap placeholder geometry (a UV sphere per eye, mirrored) as soon as
rough eye position is decided — surrounding features (nose, cheeks, brow) are
placed relative to the eyes, so you need that anchor early even though the
placeholder gets swapped for a real eye rig later.

### Phase 4 — Feature refinement (Clay Strips / Crease / Pinch / Draw)

Once masses are right, switch tools by intent, not by habit:
- **Clay Strips** to add volume where a feature needs more mass (lip, brow
  ridge, cheek, nose bridge).
- **Crease** to define a sharp transition line (where a lip meets the
  surrounding skin, a nostril's inner edge).
- **Pinch** to tighten geometry toward a sharp edge once Crease has roughed
  the line in.
- **Draw** for small additive detail, and to add raw polygon density to a
  region (e.g. fingers) before sculpting fine shapes into it.
- **Smooth** between every few strokes of any of the above — sculpting reads
  as a comb of (add detail → smooth → judge → adjust), not one continuous
  pass.

Bump the dyntopo detail size up specifically while working a small, detail-
dense region (mouth, nostrils), and back down again afterward — high detail
uniformly across a whole character sculpt is nearly always wasted density
that just slows the viewport. This is a per-region dial, not a global
setting-once affair.

Iterate proportions against object-mode placeholders throughout: leave
Sculpt Mode, nudge/scale a placeholder object (eye, nose), re-enter Sculpt
Mode, adjust the socket/surrounding flesh to match. This back-and-forth
between Object Mode and Sculpt Mode is the normal rhythm of the whole middle
phase, not a sign something went wrong.

### Phase 5 — Secondary hard-surface elements (teeth, tongue)

These are built with ordinary box-modeling (cube → loop cuts → taper →
extrude), not sculpted — a tooth or tongue doesn't need dyntopo's adaptive
density, it needs a handful of controlled edge loops. Model as separate
objects, mirror where symmetric, position in side view (front view gives the
wrong depth read for anything going into a mouth cavity).

### Phase 6 — Multiresolution as the alternative to dyntopo

The course material in this domain leans entirely on dyntopo (destructive,
adaptive, no clean level-of-detail history). For work that needs to go back
to a lower-poly cage later — retopology for rigging/animation, baking detail
down to normal maps, exporting to a game engine — add a **Multiresolution**
modifier to a clean, even base mesh instead of (or in addition to) dyntopo,
and subdivide it to add detail levels. Multires preserves a navigable stack
of resolution levels; dyntopo does not preserve any lower-resolution version
of what you started from once you've sculpted over it. Pick multires when
the sculpt has to survive being retopologized or baked; pick dyntopo when the
sculpt itself is the deliverable (illustration, prop turntable) and there's
no downstream rig.

### Phase 7 — Eyes and fur as add-on-assisted steps

Stylized eyes and fur are the two places this domain leans on third-party
add-ons rather than raw `bpy` because both are genuinely hard to get right
from primitives (procedural iris/pupil shading; per-strand hair grooming).
Treat add-on invocation as a distinct technique from either hand-modeling or
direct `bpy` scripting — see §3 for the concrete mechanism.

Texture/paint the base skin material before adding fur (fur inherits/masks
over the existing material, and repainting after fur is grown means working
half-blind through hair geometry). UV-unwrap with whatever quick projection
gets a usable, non-overlapping layout — this is a paint-in-Blender surface,
not a deliverable UV set for an external texturing app, so precision here
matters less than coverage.

### Phase 8 — Fur via scripted particle hair + manual grooming

Claude/the agent can set up the initial hair particle system end-to-end via
`execute_code` (see §3), including per-region density and length control
through vertex groups painted or scripted. It cannot comb or groom
convincingly — the direction fur flows across a body (spine outward to
belly, ears combed toward their tip, away from the mouth) is a per-stroke
Particle-Edit-mode activity. The honest split: agent sets up the system,
tunes global counts/length from iterated screenshots, and paints/asks the
user to paint the density/length vertex groups; grooming direction and final
"puff" (re-fluffing after combing flattens strands) stays manual.

### Phase 9 — Rendering a sculpt

Once fur/texture are in: reposition the character above a ground plane,
build a simple curved backdrop (a plane extruded up at the back edge, with
the seam beveled smooth) if no full scene exists yet, place camera via
snap-to-cursor + zeroed rotation rather than free-flying, light with a
handful of large emissive planes rather than point lights (softer, easier to
reason about via screenshots), and render with the path-traced engine at
GPU + denoise. Nothing about this phase is sculpting-specific — it's the
same scene-building loop used elsewhere in the skill — except: fur render
density is usually much higher than the viewport display count, so always
confirm final density in a render or Rendered-shading preview, not the
default Solid viewport.

## 3. `bpy` technique notes

### Entering Sculpt Mode and reading state

```python
import bpy

obj = bpy.data.objects["Character"]
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.mode_set(mode='SCULPT')
```

Always confirm the active object before switching modes — `mode_set` acts on
`view_layer.objects.active`, and a stale selection from a prior Object Mode
step is a common silent failure (you sculpt on the wrong object, or nothing
happens because nothing is active).

### Symmetry

```python
ts = bpy.context.scene.tool_settings.sculpt
ts.use_symmetry_x = False
ts.use_symmetry_y = True   # match whichever axis the blockout mirrors across
ts.use_symmetry_z = False
```

Don't hardcode X — confirm the mirror axis against the actual mesh (check an
existing Mirror modifier's axis, or the bounding box symmetry) before
setting this.

### Dyntopo

```python
ts = bpy.context.scene.tool_settings.sculpt

# Configure BEFORE toggling on — these are read when dyntopo activates.
ts.detail_type_method = 'CONSTANT'          # or 'BRUSH', 'MANUAL'
ts.constant_detail_resolution = 8.0         # coarse blockout; raise for finer work
ts.detail_refine_method = 'SUBDIVIDE_COLLAPSE'  # adds where pushed, removes where smoothed
ts.use_smooth_shading = True

bpy.ops.sculpt.dynamic_topology_toggle()    # must be run with the object in Sculpt Mode

# Even out density after big proportion changes or before a fine-detail pass:
bpy.ops.sculpt.detail_flood_fill()
```

Guideline for `constant_detail_resolution`: start under 10 for blockout work.
Values in the 40s are already "fine detail on a simple character" territory;
60+ is the point where brush response visibly lags on a modest mesh — treat
lag as the signal to back the number down, not push through it. Bump the
value up temporarily, sculpt the fine region, then either drop it back down
or leave it — but always re-run `detail_flood_fill` after a big change so the
new density is uniform rather than patched.

### Selecting a brush

```python
bpy.context.tool_settings.sculpt.brush = bpy.data.brushes["Clay Strips"]
# or, to match the active-tool UI directly:
bpy.ops.wm.tool_set_by_id(name="builtin_brush.Clay Strips")
```

Core brush set and what each is *for* (method, not a copied description):
draw/clay-family brushes add mass; crease and pinch define and tighten sharp
transitions; grab relocates existing mass without adding topology (safe
under heavy symmetry iteration); smooth is the universal "blend and judge"
step between any two of the above.

### Voxel remesh (unify blockout, or re-densify a sculpt)

```python
obj = bpy.context.active_object
obj.data.remesh_voxel_size = 0.02     # tune per mesh scale; smaller = denser
bpy.ops.object.voxel_remesh()
```

This is a one-shot destructive operator on the object's mesh, distinct from
the non-destructive **Remesh modifier** (`obj.modifiers.new(name="Remesh",
type='REMESH')`, with `.mode` in `{'BLOCKS', 'SMOOTH', 'SHARP', 'VOXEL'}`) —
use the modifier form when the user might want to dial the setting later
without committing, use the operator form when you deliberately want the
result baked into real geometry before sculpting on it.

Gotcha: remeshing an object that still has an un-applied Subdivision Surface
or Mirror modifier only remeshes the *cage*, not the visually subdivided
result. Apply modifiers first:

```python
bpy.context.view_layer.objects.active = obj
bpy.ops.object.convert(target='MESH')   # or apply each modifier explicitly
```

### Multiresolution modifier (alternative to dyntopo for production sculpts)

```python
mod = obj.modifiers.new(name="Multires", type='MULTIRES')
bpy.ops.object.multires_subdivide(modifier="Multires", mode='CATMULL_CLARK')
# repeat multires_subdivide to add further levels; sculpt at the top level,
# and lower levels remain available for retopo/rig binding/normal-map baking.
```

### Hair particle system (fur)

```python
obj = bpy.data.objects["Character"]
bpy.context.view_layer.objects.active = obj

psys_mod = obj.modifiers.new(name="Fur", type='PARTICLE_SYSTEM')
psys = obj.particle_systems[-1]
settings = psys.settings
settings.type = 'HAIR'
settings.count = 20000                 # parent strand count
settings.hair_length = 0.12
settings.child_type = 'INTERPOLATED'
settings.child_percent = 100           # NOTE: named child_nbr on older Blender
                                        # builds — check hasattr() before setting
                                        # if targeting an unknown version.
settings.material_slot = 1             # reuse the existing skin material index

# Density/length masks — paint these by hand afterward in Weight Paint mode,
# or seed them programmatically if a rough starting mask is known:
density_vg = obj.vertex_groups.new(name="FurDensity")
length_vg = obj.vertex_groups.new(name="FurLength")
psys.vertex_group_density = "FurDensity"
psys.vertex_group_length = "FurLength"
```

Version drift is real in the particle settings API across Blender releases —
if a property assignment raises `AttributeError`, check
`type(settings).bl_rna.properties.keys()` for the current name rather than
guessing; renamed properties (like the `child_nbr` → `child_percent` example
above) are exactly the kind of thing that silently breaks a script written
against slightly-wrong-version documentation.

Viewport fur count is cosmetic and independent of the render count:

```python
psys.settings.display_percentage = 10   # sparse while grooming/editing masks
# render density comes from settings.count / settings.child_percent above,
# and is typically far denser than what's drawn in the 3D viewport.
```

### Add-on-assisted eyes (tinyeye-style library-append add-ons)

Stylized-eye add-ons of this shape ship as an "Add Mesh" category add-on
whose menu entries are thin operator wrappers around
`bpy.ops.wm.append()`, pulling a named Object out of a bundled library
`.blend` file. The wrapper operators themselves have opaque, hash-suffixed
`bl_idname`s (e.g. `sna.operator_stylisedblue_46c7b`) that are not worth
memorizing or guessing — they vary per add-on build and color variant. The
more robust, scriptable path is to call the append directly against the
library file the add-on ships, once you know (from `get_scene_info` after
one manual add via the UI, or from inspecting the add-on's own asset folder)
the target Object name:

```python
import os

lib_path = os.path.join(addon_dir, "assets", "Eye Library.blend")
before = set(bpy.data.objects)
bpy.ops.wm.append(
    directory=lib_path + "\\Object",   # NOTE: literal "\Object" separator —
    filename="Blue Stylised",          # this is how .blend library append
    link=False,                        # addressing works, not a real path sep
)
new_obj = next(iter(set(bpy.data.objects) - before))
```

This sidesteps needing to know the add-on's generated operator IDs at all,
and is the same mechanism PolyHaven/Sketchfab asset import uses under the
hood in BlenderMCP's own `execute_code` handlers.

## 4. Prompt-strategy notes

Sculpting prompts fail when they ask the agent to do something inherently
interactive (comb this fur convincingly, make this face expressive) instead
of asking it to prepare the conditions for a human (or a long iterated
loop) to do that well. Decompose accordingly:

- **Ask for scaffolding, not artistry.** *"I have Blender open. My blockout
  is one joined object called Body, mirrored on Y. Get it ready for
  sculpting: voxel remesh fine enough to keep the fingers separable, smooth
  the seams, turn on dyntopo with a low starting detail, and confirm Y
  symmetry is on. Show me a screenshot when it's done."* — this asks for
  exactly the mechanical setup the agent is good at, and ends on a visual
  checkpoint rather than assuming success.

- **State the "don't touch" list explicitly.** Any pass that runs after
  paint or grooming work needs an explicit boundary or it will get silently
  overwritten. *"Add a hair particle system to the body using the existing
  SkinPaint material — do not create or modify any textures, and don't touch
  the eye or tooth objects."*

- **Hand over reference, ask for a first pass plus its own suggestions.**
  *"Here's a reference image of the creature's fur pattern. Set up an
  initial hair system that roughly matches — density, rough length, and
  which regions should be bare (muzzle, inside ears). Tell me what you'd
  adjust next rather than trying to perfect it in one pass."* Treating the
  agent's first pass as a draft to react to (screenshot → correct →
  re-prompt) produces much better results than asking for a finished look
  in one shot.

- **Route judgment calls back to the user.** *"The voxel remesh at 0.02 is
  fusing the fingers together. Try progressively smaller sizes and screenshot
  each one so I can pick — don't guess a final value and commit to it."*
  Numeric sculpting settings (voxel size, detail resolution, brush strength)
  are visual-outcome parameters; treat them as a search loop with the human
  as the fitness function, not a value to compute once.

- **Separate "set up the mask" from "paint the mask."** *"Create the
  FurDensity and FurLength vertex groups on Body if they don't exist yet, and
  wire the particle system to use them, but leave them at full weight — I'll
  paint the actual falloff by hand in Weight Paint mode."* This keeps the
  agent's contribution to what it can verify (groups exist, are wired
  correctly) and leaves the judgment call (where should fur be short/absent)
  to the human, where it belongs.

## 5. Pitfalls

- **Wrong symmetry axis.** Every stroke silently mirrors to the wrong side
  of the mesh. Confirm the mirror axis against the actual blockout (mirror
  modifier setting or bounding-box symmetry) before enabling sculpt symmetry
  — don't default to X.

- **Remeshing before applying modifiers.** A voxel remesh run on an object
  that still has an un-applied Subdivision Surface or Mirror modifier
  remeshes the low-poly cage, not the visible shape. Apply/convert first.

- **Detail resolution too high, globally.** Lag isn't a hardware problem
  first — it's usually a detail-size problem. Drop the constant-detail value
  and re-flood before assuming the machine is the bottleneck; reserve high
  detail for the specific small region that needs it, temporarily.

- **Density-seam "lines" after a heavy local pass.** These are a polygon-
  density mismatch between worked and unworked regions, not a shading
  artifact — the fix is Detail Flood Fill, not more smoothing.

- **Sculpting the final surface when fur will cover it.** If the deliverable
  is furred, the sculpt only needs to be right at the *silhouette and
  underlying-form* level; chasing surface perfection under fur is wasted
  effort the render will hide anyway. Confirm with the user whether the
  sculpt is the final surface or a fur substrate before over-investing in
  fine detail.

- **Assuming a hair-particle property name is stable across Blender
  versions.** The particle settings API has had renames (see `child_nbr` →
  `child_percent`). Wrap unfamiliar-version property sets in a
  `hasattr()`/introspection check rather than assuming the script will run
  unmodified on whatever Blender build is actually open.

- **Guessing an add-on's generated operator ID.** Library-append-style
  add-ons (stylized eyes, and similar asset-pack add-ons) often expose
  hash-suffixed operator names that aren't meant to be hand-typed. Prefer
  calling `bpy.ops.wm.append()` directly against the add-on's bundled
  library file and a known Object name.

- **Treating dyntopo as if it preserves level-of-detail history.** It
  doesn't — once you've sculpted over a region, the lower-density version is
  gone. If the character needs to survive retopology, rigging, or baking
  later, use Multiresolution (or plan a separate retopology pass) instead of
  relying on dyntopo alone.

- **Batching multiple sculpt operations blind, without a screenshot between
  them.** Every operation in this domain is a visual-outcome operation.
  Chaining several `execute_code` sculpt calls without checking the viewport
  in between compounds small misjudgments (wrong brush strength, wrong
  region) into a mess that's harder to diagnose than if each step had been
  screenshotted.

## Coverage gap: `mastering-realistic-portraits-advanced-human-head-sculpting`

This course shipped **video-only** — no lesson HTML, no prompt-conversation
transcripts, only a staged project file (`Tami Coker - Head Sculpt.blend` /
`.obj`). Nothing below is distilled from its actual lesson content, because
there is none to read; it is inferred from general realistic-portrait
sculpting practice and should be treated as lower-confidence than the rest
of this document:

- Realistic human heads lean far more heavily on **edge-loop discipline**
  than a stylized creature does — loops that flow around the eyes, mouth,
  and nasolabial fold aren't optional the way they are on a furred
  stylization, because they're what makes later rigging/expression work
  possible and what keeps skin-shader results from looking waxy at oblique
  angles. Multiresolution (Phase 6 above) is the more likely fit for this
  kind of work than pure dyntopo, precisely because portrait sculpts are
  more likely to need a clean retopology and rig downstream.
- Reference-matching for a realistic likeness is a fundamentally tighter
  iteration loop (measure against photo reference constantly) than a
  stylized character, where "reads as the right vibe" is the bar. Expect a
  much higher screenshot-to-stroke ratio if an agent is assisting here at
  all.
- If this course is revisited with actual lesson material later, re-distill
  it properly rather than extending this section — it is currently a
  placeholder built on domain knowledge, not verified course content.
