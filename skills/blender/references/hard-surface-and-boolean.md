# Hard-Surface, Boolean/Non-Destructive, and Mechanical Assembly Reference

Distilled from three purchased courses (technique and workflow shape only, no source
prose reused): *Hard Surface Modeling with Blender in Claude Code* (octagonal turret
build), *Boolean & Non-Destructive Modeling with Blender in Claude Code* (steampunk
clock escapement), and *Vehicle Modeling Principles* (hot-air balloon — despite the
title this course is really about silhouette-driven organic-hard-surface hybrid
assembly and AI-modeling discipline, not wheeled/powered vehicles). All three drive
Blender exclusively through BlenderMCP's `execute_code` (raw `bpy`), with
`get_viewport_screenshot` / `get_object_info` as the only feedback channels.

## 1. When This Applies

Use this reference for: primitive-first hard-surface blockouts, any task that needs
Boolean cuts (holes, slots, panel lines, cutouts) kept live and re-editable, modifier
stacks that must stay non-destructive through a long build, multi-part mechanical
assemblies that need shared pivots, and any silhouette-critical organic-mechanical
hybrid (vehicle envelopes, fuselages, hulls) built by matching a reference profile.

## 2. Workflow

### Phase A — Reference and scene setup
1. `execute_code`: import the reference image as an Image Empty (drag-and-drop is a
   human-only action; via script use `bpy.data.objects.new` with an image datablock,
   or `bpy.ops.object.load_reference_image` equivalents), reset its rotation/location,
   and orient it facing the working axis. Set scene unit scale deliberately —
   mechanical/small props read best at millimetre scale (`unit_scale_length = 0.001`);
   scale the whole scene up 5–10x only at render time (see §5, "small-scale rendering").
2. `execute_code`: create named collections up front (e.g. `Mechanism`, `Frame`,
   `Reference`, or per hard-surface part group like `Base`, `Legs`, `Barrel_Mount`).
   Never let objects pile up uncollected — a flat outliner becomes unreadable past
   ~15 objects and costs real time later when Claude has to search for a target.
3. Screenshot check: confirm the reference is scaled/oriented correctly and visible
   from the working viewport angle before creating any geometry.

### Phase B — Blockout (primitive-first)
1. Build the rough silhouette from primitives only: cubes for panels/brackets,
   N-gon cylinders for radial parts (`vertices=8` for octagonal/low-poly hard
   surface, `vertices=18–24` for a "smooth enough" round part, `vertices=32+` only
   for hero cylindrical surfaces that will catch specular highlights).
2. For any part that has wall thickness, do **not** model it as solid geometry.
   Model a single flat face capturing the *shape*, and give it depth with a
   Solidify modifier. This is the single most load-bearing convention in the
   non-destructive workflow: keep the surface as a single face and let the
   modifier own its depth, so wall thickness stays a one-slider adjustment for
   the rest of the project.
3. Screenshot + `get_object_info` check after each new primitive: confirm
   dimensions and origin before building the next dependent piece — blockout
   errors compound fast if the next piece is snapped/parented to a wrong origin.

### Phase C — Structural detail (Booleans, mirrors, arrays)
1. Add Boolean cutters as separate objects (never destructively delete-and-fill).
   Keep cutters visually distinct (a dedicated "Cutters" sub-collection, hidden
   from render) so the scene stays legible.
2. For bilateral symmetry, build one half as a flat profile face and add a Mirror
   modifier *before* Solidify (see §3 for why order matters). For radial repeats
   (teeth, bolts, ribs, rivets), build one instance and drive the repeat with an
   Array modifier referencing a pivot Empty — never hand-duplicate more than the
   one seed copy.
3. Apply any cutter to the pre-mirror half-mesh when the cut must be symmetric —
   one cutter, mirrored automatically, instead of two cutters kept in sync by hand.
4. Screenshot after every Boolean/Array add: verify the operation ran (empty
   result / all-black shading are both signs of a failed or inverted cut) before
   layering the next modifier on top.

### Phase D — Edge control and shading polish
1. Decide per-edge whether the chamfer comes from a Bevel modifier's Angle limit
   (automatic, global) or Weight limit (manual, selective) — see §3.
2. Add support/helper loops near any edge where a Bevel or Subdivision result
   looks pinched, stretched, or sagging.
3. Add a Weighted Normal modifier after Bevel/Subdivision to clean up residual
   shading artefacts at flat/curved transitions — this is a late-stack, near-final
   step, not something to add early.
4. `get_object_info` + screenshot check specifically from an orthographic side
   view — perspective view introduces a lens offset that makes precise placement
   judgement unreliable.

### Phase E — Assembly, pivots, and cleanup
1. Read actual mesh/world coordinates for anything that needs a precise pivot
   (a joint, an axle, a rig anchor) rather than eyeballing a number. Query the
   object's `matrix_world` translation or the relevant vertex coordinates and use
   that value directly in the next operation.
2. Create pivot Empties at those coordinates; parent the dependent parts to the
   Empty with `Keep Transform` so the whole assembly can move/rotate as a unit
   without re-deriving offsets.
3. Merge coincident verts (`Merge by Distance`), apply scale before any modifier
   that is scale-sensitive (Bevel, Solidify, Array offsets), and decide per-object
   whether it stays a live modifier stack or gets converted to a static mesh for
   delivery.

## 3. `bpy` Technique Notes

### The non-destructive modifier stack order (the load-bearing rule)
```python
import bpy

def add_boolean_cut(target_obj, cutter_obj, operation='DIFFERENCE'):
    """Boolean always goes at stack index 0 — cut the base geometry first,
    everything else (bevel, smoothing) operates on the already-cut result."""
    mod = target_obj.modifiers.new(name=f"Bool_{cutter_obj.name}", type='BOOLEAN')
    mod.object = cutter_obj
    mod.operation = operation          # 'UNION' | 'DIFFERENCE' | 'INTERSECT'
    mod.solver = 'EXACT'               # EXACT is far more robust than FAST for hard-surface
    cutter_obj.display_type = 'WIRE'   # keep cutters visible-but-unobtrusive in viewport
    cutter_obj.hide_render = True
    # move it to index 0 if other modifiers already exist
    while target_obj.modifiers.find(mod.name) != 0:
        bpy.ops.object.modifier_move_up({'object': target_obj}, modifier=mod.name)
    return mod
```
Stack order convention for a finished hard-surface part: **Boolean → Bevel →
(Weighted Normal / Smooth by Angle)**. Reversing bevel and boolean bevels the
uncut geometry and the cut edges come out sharp/wrong.

### Cutter sizing — the overshoot rule
Coincident faces (cutter face exactly flush with target face) leave the Boolean
solver unable to decide which side is "inside", producing missing faces or
z-fighting. Always oversize the cutter through the target:
```python
cutter.dimensions.z = target_thickness + 0.002  # +2mm overshoot in a mm-scale scene
```
Scale the constant to scene units — the invariant is "cutter passes fully through
the surface being cut", not a specific millimetre figure.

### Flat-face-plus-Solidify (make thickness a parameter, not geometry)
```python
def add_thickness(obj, thickness=0.002, offset=-1.0):
    mod = obj.modifiers.new(name="Solidify", type='SOLIDIFY')
    mod.thickness = thickness
    mod.offset = offset   # -1 grows inward, 0 grows both ways, 1 grows outward
    return mod
```
Any part with a wall — panels, rings, collars, brackets, dial faces — should be a
single-face mesh plus this modifier, never solid geometry hand-extruded to depth.
Changing wall thickness later is then one float, not an edit-mode pass.

### Mirror before Solidify — order dependency
```python
mirror = obj.modifiers.new(name="Mirror", type='MIRROR')
mirror.use_axis[0] = True
mirror.mirror_object = pivot_obj      # mirror plane = pivot object's local origin
mirror.use_clip = True                # lock verts at the seam instead of overlapping
solidify = obj.modifiers.new(name="Solidify", type='SOLIDIFY')
solidify.thickness = 0.002
```
If Solidify runs before Mirror, Mirror doubles an already-thick slab and the
seam ends up at 2x the intended thickness. Mirror must solidify a *thin* face,
then Solidify adds depth to the whole two-sided result. `use_clip = True`
prevents the two mirrored halves from interpenetrating at the seam; if geometry
still pokes through after enabling clip, select the offending faces in edit mode
and delete them rather than fighting the modifier.

### Array modifier — radial repeats, and the spiral/helical trap
```python
array = obj.modifiers.new(name="Array", type='ARRAY')
array.use_relative_offset = False
array.use_object_offset = True
array.offset_object = pivot_empty     # empty rotated by (360 / count) degrees
array.count = tooth_count
```
The Array modifier composes the *seed object's origin* against the offset each
step. If the seed's origin sits away from the pivot (e.g. a default cube's own
center instead of the ring's center), every step both rotates **and** translates,
producing a spiral/helix instead of a flat radial ring. This is not a bug — it's
the correct fix for helical gear teeth, coil springs, or expanding filigree — but
for a flat radial repeat, set the seed object's origin to the pivot location
*before* adding the Array:
```python
bpy.context.scene.cursor.location = pivot_empty.matrix_world.translation
bpy.context.view_layer.objects.active = seed_obj
bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
# now add the Array — pure rotation, no drift
```
Setting the origin *after* the Array is already present forces every offset to
recompute from the new pivot — cheaper to get origin-then-array right the first
time.

### Bevel: Angle limit vs Weight limit
```python
bevel = obj.modifiers.new(name="Bevel", type='BEVEL')
bevel.width = 0.0005
bevel.limit_method = 'ANGLE'     # or 'WEIGHT'
bevel.angle_limit = 0.523599     # ~30 deg in radians, tune per geometry
```
`ANGLE` auto-bevels every edge whose dihedral angle exceeds the threshold — fast,
but it will catch edges you didn't intend and miss shallow-angle edges you did.
`WEIGHT` bevels only edges with `Mean Bevel Weight` explicitly set to 1 in edit
mode (`bmesh` edge `bevel_weight` attribute, or the N-panel Item tab):
```python
import bmesh
bm = bmesh.from_edit_mesh(obj.data)
layer = bm.edges.layers.bevel_weight.verify()
for e in bm.edges:
    if e.select:
        e[layer] = 1.0
bmesh.update_edit_mesh(obj.data)
```
Use `WEIGHT` for anything where the chamfer is a deliberate design choice on
specific edges (panel lines, chosen mechanical edges); use `ANGLE` as a fast
first pass on a blockout, then switch to `WEIGHT` once specific edges need to
diverge from the automatic result. Always apply object scale
(`bpy.ops.object.transform_apply(scale=True)`) before adding a Bevel — bevel
width is multiplied by object scale, so an un-applied non-uniform scale produces
an inconsistent chamfer.

### Weighted Normal — the late-stack shading fix
```python
wn = obj.modifiers.new(name="WeightedNormal", type='WEIGHTED_NORMAL')
wn.keep_sharp = True
```
Add after Bevel (and after Subdivision if present). It re-weights the normal
calculation toward the larger flat faces, cleaning up shading pinch at
flat-to-curved transitions that Bevel + Shade Smooth alone leave visible.

### Boolean cleanup — n-gons, coplanar faces, when to remesh
- After any Boolean, run `bpy.ops.mesh.select_all(action='SELECT')` +
  `bpy.ops.mesh.remove_doubles()` (Merge by Distance) in edit mode to clear
  coincident verts left at cut seams.
- Coplanar/degenerate faces from a Boolean intersection typically show up as
  n-gons with near-zero area — triangulate suspect regions
  (`bpy.ops.mesh.quads_convert_to_tris()` on the selection) and inspect, rather
  than leaving n-gons for a Subdivision modifier to choke on.
- Reach for `bpy.ops.object.voxel_remesh()` (or the Remesh modifier) only when
  repeated overlapping Booleans have produced a genuinely tangled non-manifold
  mesh that targeted cleanup can't fix economically — it's a last resort because
  it destroys the clean quad topology hard-surface shading depends on.

### Breaking and re-linking instances
`Alt+D`-style linked-instance data (`obj.data` shared between objects) cannot
have modifiers applied to just one copy. To finalize one instance:
```python
obj.data = obj.data.copy()     # makes mesh data single-user for this object
# ... apply modifiers on obj ...
# to re-link other instances to the now-finalized mesh:
for other in other_instances:
    other.data = obj.data
```

### Parenting with Keep Transform
```python
child.parent = parent_obj
child.matrix_parent_inverse = parent_obj.matrix_world.inverted()
```
This is the scripted equivalent of "select children, shift-click parent last,
Ctrl+P → Keep Transform" — the child keeps its current world position while
becoming subordinate to the parent's future transforms.

### hide_viewport vs hide_set() — not the same flag
```python
obj.hide_set(False)        # the eye icon — scene-level, animatable, MCP-friendly
obj.hide_viewport = False  # the monitor icon — persistent override, NOT the same flag
```
These two are independent and don't observe each other. If an object was hidden
with `hide_viewport = True`, calling `hide_set(False)` will silently do nothing —
the monitor flag still wins. Standardize on `hide_set()` for all script-driven
visibility during a session; reserve `hide_viewport` for objects you intend to
hard-disable regardless of what any later script does.

## 4. Prompt-Strategy Notes

The two courses converge on the same meta-lesson from opposite directions: the
Boolean course shows a *well-structured* domain (numeric, mechanical, precise)
where Claude is close to autonomous; the balloon/vehicle course shows a
*visually-estimated* domain (silhouette matching by eye) where Claude fails
without help — and the fix in both cases is the same: replace judgement calls
with numbers.

- **Front-load constraints in the first prompt.** State units, collection
  structure, and any known reference dimensions before asking for geometry, so
  the first pass builds at the right scale instead of needing a rescale later.
  Fresh example: *"Set up a millimetre-scale scene, four collections
  (Mechanism/Frame/Reference/User), and place ref.png as an Image Empty at
  ~120mm tall before we start blocking anything out."*
- **State the stack-order rule explicitly if it matters for this build.** Don't
  assume Claude will infer Boolean-before-Bevel or Mirror-before-Solidify from
  context alone — say it once per session if the build involves either.
  Fresh example: *"Any new part needs Boolean at the bottom of the stack, Bevel
  above it, Weighted Normal on top — check the stack order after you add each
  modifier."*
- **Ask for a plan before multi-step or multi-decision builds; let single,
  well-defined steps run.** A gear, a bolt array, a bracket — describe once and
  let it run. An assembly with several judgement calls (proportions, HDRI
  balance, a decorative motif) — ask for the plan first, review it, then approve
  execution. Fresh example: *"Before writing any geometry: tell me your plan for
  the mounting bracket — dimensions, modifier stack, how it parents to the
  hull — and wait for me to confirm."*
- **Replace "make it look right" with a number.** Any prompt that asks Claude to
  judge scale/position/proportion visually will drift or stall. Convert it: not
  *"the cutter looks too big"* but *"scale the cutter to 14mm on Z, keep X/Y."*
  If you genuinely can't supply a number yet, ask Claude to *read* the number
  from the geometry first (`get_object_info`) rather than guess it.
- **When the task is inherently visual (matching a silhouette to a reference
  image), don't ask Claude to eyeball a screenshot repeatedly — convert the
  reference into data first.** A script that scans the reference image
  pixel-by-pixel and maps silhouette edges to world coordinates via the image
  empty's transform turns a slow screenshot-guess-correct loop into one
  batch of exact values applied in a single pass. This generalizes to any
  profile-matching task (fuselages, hulls, bottles) — build the extraction
  script once, reuse it per silhouette.
- **One operation, then a check, when a step depends on the last one being
  correct.** Bundling a scale-and-move-and-rotate into a single instruction on
  an estimation-heavy step compounds error silently. Fresh example: *"Move the
  turret head +4mm on Z only. Stop there — I'll confirm before you touch
  rotation."*
- **State counts and groupings explicitly — Claude interprets literally.** "Rig
  lines at each corner" is ambiguous between one line per corner and a fan of
  lines per corner; say *"4 ropes per corner, 16 total, fanning from each basket
  corner to the ring"* rather than leaving the multiplier implicit.
- **Know when to do it yourself.** A 10-second manual nudge (small prop
  position, a burner scale tweak) often costs less than the round-trip of
  specifying it precisely enough for a script to get it right first time. Use
  the AI for structure, repetition, and modifier/node math; keep small
  by-eye judgement calls for yourself.

## 5. Pitfalls

- **Coincident-face Boolean failure.** Cutter exactly flush with the target
  surface → solver can't resolve inside/outside → missing faces, flicker, or a
  no-op cut. Fix: always overshoot the cutter through the surface (see §3).
- **Boolean modifier order after Bevel.** If Bevel sits below Boolean in the
  stack, the bevel runs on uncut geometry and the cut edges come out sharp/ugly
  regardless of the Bevel settings. Fix: Boolean at index 0, move it up if a
  Bevel was added first.
- **Array spiral when it shouldn't spiral.** Radial array corkscrews outward
  instead of staying flat → seed object's origin is offset from the pivot.
  Fix: set origin to the pivot before adding Array, not after.
- **Mirror-then-Solidify order swap.** Seam ends up at double intended
  thickness. Fix: Mirror first, Solidify second, always.
- **Non-uniform scale breaking Bevel/Solidify results.** Bevel width and
  Solidify thickness are both scaled by the object's transform scale. Fix:
  `transform_apply(scale=True)` before adding either modifier, and again after
  any subsequent non-uniform scale.
- **Applying a modifier to a linked-instance object.** Silently fails or
  applies to all instances at once, unexpectedly. Fix: make the mesh data
  single-user (`obj.data = obj.data.copy()`) before applying, re-link
  afterward if the other instances should share the finalized result.
- **hide_viewport / hide_set() cross-talk.** An object hidden with one flag
  will not respond to the other being toggled — looks like a bug, isn't. Fix:
  standardize on `hide_set()` for script-driven visibility.
- **GN (Geometry Nodes) profile fill on non-convex outlines.** A `Fill Curve`
  node on a profile with re-entrant corners (e.g. a gear tooth/rib silhouette)
  triangulates across the interior with long diagonal faces; a following Bevel
  node then distorts those diagonals into mangled geometry. Fix: build
  non-convex GN parts in stages — base disc, then teeth, then cutouts, then
  bevels — confirming each stage in the viewport before adding the next, rather
  than authoring the whole node tree in one pass.
- **GN objects rendering white regardless of material slot.** A Geometry Nodes
  modifier's output does not inherit the object's material slot automatically;
  it needs an explicit `Set Material` node inside the tree. Fix: add
  `GeometryNodeSetMaterial` pointing at the intended material before assuming
  a material assignment bug elsewhere.
- **Fully metallic materials reading as flat white.** A Principled BSDF at
  Metallic = 1.0 has no diffuse term — all colour comes from environment
  reflection. A bright/white world background will make every metal object
  render white regardless of Base Color. Check the world background strength
  first before debugging node trees.
- **Small-scale (mm) rendering artefacts.** Area lights need to be physically
  close to a surface to contribute meaningful light — at millimetre scale that
  distance becomes impractical, and camera near-clip / shadow-distance defaults
  assume metre-scale scenes. Fix: model and rig at correct internal mm scale,
  but scale the whole scene up (5–10x) for lighting/camera/render, and use Sun
  lamps (distance-independent) instead of Area lamps for small hero objects.
- **Camera pointing straight down -Y with Z as up axis in `to_track_quat`.**
  Look direction and up axis end up parallel, the rotation solve is degenerate,
  and Blender resolves it by flipping the camera 180°. Fix: use a non-parallel
  up axis for that specific look direction, or set rotation manually via
  `matrix_world` instead of `to_track_quat` when the target is directly below.
- **Merge-by-distance skipped after vertex sliding/Boolean cleanup.** Leaves
  coincident stacked verts that later show up as shading cracks or Subdivision
  artefacts. Fix: run it as a standard last step before calling any part
  "done," not just when something visibly looks wrong.
