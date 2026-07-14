# Modeling Foundations — Box & Primitive Blockout via BlenderMCP

Sources distilled: `ai-box-modeling-with-blender-in-claude-code`, `primitive-modeling-fundamentals-in-claude-code`,
`introduction-to-3d-modeling-with-blender-and-claude-code`. All three courses drive Blender exclusively through
BlenderMCP's `execute_code` (raw `bpy`), `get_viewport_screenshot`, and `get_object_info` — there is no other
control surface. Evidence of staged, checkpointed builds: the primitive-fundamentals `.blend` set progresses
Cup → Low-Poly Sword → Tree → Computer Desk → Detailed Pirate Ship, each a saved file in its own right; the
box-modeling course's files run `1. Installation And Setup` → `3. Building The Foundation` → `4.1/4.2` (ground,
road) → `5.1–5.4` (garden) → `6.1–6.3` (house, detail, polish); the intro course runs `02.01 Objects and
Transforms` → `03.01 Edit Mode and Extrude` → `04.01 Loop Cuts and Sub-D` → `06.01 Treasure Chest`. None of these
projects were built in one shot — every one is a sequence of named, verifiable checkpoints.

## 1. When this applies

Any task where the target is a discrete object or small prop built from primitive volumes — furniture, props,
containers, simple architecture, game-style assets — before sculpting, procedural scattering, or rigging enter
the picture.

## 2. Workflow

### Phase 0 — Decompose before touching geometry
Do not translate a description straight into a modeling script. First produce a written, numbered plan: what
volumes exist, what order they need to be built in (structural/load-bearing pieces before trim, large forms
before small details), what each step's dependencies are, and which steps are cheap to redo if wrong. Treat this
plan as the task list you work down one `execute_code` call at a time — one prompt building an entire multi-part
prop in a single pass reliably produces a fast, roughly-right, imprecisely-proportioned result (this is
demonstrable: an ungoverned single-prompt build gets the gist of a scene right but every proportion, alignment,
and color needs correction afterward). Decomposition is what turns "roughly right" into "correct."

**Check:** the plan itself, read back before any `execute_code` call fires. If the plan has more than ~8-10
steps, that is a signal to group it into sub-phases with their own checkpoints, not to run it as one script.

### Phase 1 — Primitive blockout
For each major volume in the plan, add exactly one `bpy.ops.mesh.primitive_*_add()` call, immediately rename the
resulting object and its mesh datablock, and leave fine shaping for later. Resist the urge to also inset, bevel,
and material a piece in the same call — one concern per `execute_code` invocation makes it possible to diagnose
which call produced a wrong result.

**Check:** `get_object_info(name)` after each add to confirm location/dimensions landed where intended, then a
screenshot once a handful of pieces exist to confirm they read as the right shapes before adding detail.

### Phase 2 — Fix scale, origin, and rotation discipline early
Decide, per object, whether its origin should sit at the base-center (anything that will be snapped onto a
surface or stacked — legs, walls, props resting on a floor) or at the geometry center (anything that will be
scaled or rotated about its own middle — panels, decorative inlays, rotating parts). Set it immediately after
creation, not after the object has already been transformed several times — origin placement compounds: every
later `S`/`R` call pivots around whatever origin is currently set, so a late origin fix invalidates prior scale
edits.

**Check:** `obj.matrix_world.translation` vs. the mesh's bounding-box min/max — confirm the origin sits where you
intended relative to the geometry, not just at the object's nominal location.

### Phase 3 — Edit-mode shaping
Loop cuts, insets, extrudes, bridges. Do this by editing the mesh datablock directly with `bmesh` rather than
toggling `bpy.ops.object.mode_set(mode='EDIT')` and calling interactive mesh operators (see Pitfall 1) — it is
more reliable when driven from a socket-executed script with no guaranteed active 3D viewport.

**Check:** screenshot from a fixed orthographic angle (Phase 6 technique) after every 2-3 shaping operations —
shape errors compound fast once loop cuts start feeding off each other.

### Phase 4 — Non-destructive refinement
Layer modifiers: Subdivision Surface for organic rounding (with support loops or crease added first — see
technique notes), Solidify for wall thickness, Bevel for edge highlights, Boolean for cuts/holes, Mirror/Array
for repeated structure, Decimate for scattered low-detail props. Keep this stage non-destructive as long as
possible; only apply modifiers once the piece is finished and about to be merged/exported.

**Check:** `get_object_info` for modifier stack order and settings; screenshot in solid shading with cavity-style
contrast (or just compare wireframe overlay) to confirm the modifier stack is producing the intended silhouette,
not silently collapsing detail (classic Subsurf-without-support-loops failure).

### Phase 5 — Structure and organization
Sort finished objects into named collections that mirror the plan's logical grouping, parent movable groups to
an empty, do a naming pass so every object and mesh datablock has a descriptive, collision-free name, remove
unused material slots, and run a merge-by-distance sweep across anything that went through edit-mode extrudes.

**Check:** walk `bpy.data.objects` and `bpy.data.collections` and confirm no name ends in an unwanted `.001`
(a sign something was created twice or a rename silently failed).

### Phase 6 — Verify
Set the viewport to front/top/right ortho (script-driven, not numpad-driven — see technique notes), screenshot
each, and cross-check silhouette and proportions against the brief or reference. Only then consider the object
done.

## 3. `bpy` technique notes

### Primitive creation
```python
import bpy

bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 1))
bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.4, depth=1.6, location=(0, 0, 0.8))
bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.5, radius2=0.0, depth=1.2)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.3)
bpy.ops.mesh.primitive_torus_add(major_radius=0.4, minor_radius=0.08,
                                  major_segments=24, minor_segments=12)

obj = bpy.context.object          # the just-created object is auto-active
obj.name = "handle"
obj.data.name = "handle_mesh"     # rename the mesh datablock too — it does not follow obj.name
```
Lower `vertices`/`segments` counts (12-16) for anything meant to stay low-poly; the default 32 is almost always
too dense for a stylized prop and just adds cleanup work later.

### Editing the mesh without entering Edit Mode
`bpy.ops.mesh.*` operators are designed for an interactive 3D viewport (mouse position, active region) and are
flaky when called from a headless `execute_code` context. Operate on the mesh datablock directly with `bmesh`
instead — it works regardless of window/area state:
```python
import bmesh

def edit(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    return bm

def commit(obj, bm):
    bm.to_mesh(obj.data)
    obj.data.update()
    bm.free()

bm = edit(obj)
top_faces = [f for f in bm.faces if f.normal.z > 0.9]
ret = bmesh.ops.inset_region(bm, faces=top_faces, thickness=0.05, depth=0.0)
ext = bmesh.ops.extrude_face_region(bm, geom=ret['faces'])
verts = [v for v in ext['geom'] if isinstance(v, bmesh.types.BMVert)]
bmesh.ops.translate(bm, verts=verts, vec=(0, 0, -0.08))
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
commit(obj, bm)
```
Loop cuts have no clean numeric `bpy.ops` equivalent (the operator is interactive-slide-only); reproduce the
topological result with `bmesh.ops.subdivide_edges` on the edge ring you want to cut, then reposition the new
verts with `bmesh.ops.translate`.

### Applying transforms
```python
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
```
Apply rotation and scale before adding Solidify, Bevel, Mirror, or Boolean modifiers on that object — those
modifiers read the mesh in local space and non-uniform or unapplied scale distorts thickness/bevel width/mirror
axis in ways that are hard to diagnose after the fact.

### Origin control (avoid the interactive `origin_set` context requirement where possible)
```python
import mathutils
# base-center origin: median of the lowest face's verts, in world space
me = obj.data
low_z = min(v.co.z for v in me.vertices)
base_verts = [v.co for v in me.vertices if abs(v.co.z - low_z) < 1e-5]
local_base = sum(base_verts, mathutils.Vector()) / len(base_verts)
world_base = obj.matrix_world @ local_base

bpy.context.scene.cursor.location = world_base
bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
```
`ORIGIN_GEOMETRY` (median of all verts) is the right choice for flat panels/trim that get raised or rotated
about their own middle; `ORIGIN_CURSOR` with the cursor placed at the base is right for anything snapped onto a
surface.

### Collections and parenting
```python
coll = bpy.data.collections.new("chest_hardware")
bpy.context.scene.collection.children.link(coll)
for old in list(obj.users_collection):
    old.objects.unlink(obj)
coll.objects.link(obj)

empty = bpy.data.objects.new("chest_group_root", None)
bpy.context.scene.collection.objects.link(empty)
obj.parent = empty
obj.matrix_parent_inverse = empty.matrix_world.inverted()   # prevents a jump on parenting
```
Collection instancing (many copies of one sub-assembly, e.g. rivets or fence posts) without duplicating mesh
data:
```python
proto_coll = bpy.data.collections.new("rivet_prototype")
bpy.context.scene.collection.children.link(proto_coll)
proto_coll.objects.link(rivet_obj)
bpy.context.scene.collection.objects.unlink(rivet_obj)   # prototype stays only in its own collection

inst = bpy.data.objects.new("rivets_strip_02", None)
inst.instance_type = 'COLLECTION'
inst.instance_collection = proto_coll
bpy.context.scene.collection.objects.link(inst)
inst.location = (0.9, 0, 0)
```
Never also parent the prototype object to the same empty an instance is parented to — see Pitfall 7.

### Modifier stack
```python
sub = obj.modifiers.new("Subdivision", 'SUBSURF'); sub.levels = 2; sub.render_levels = 2
sol = obj.modifiers.new("Wall", 'SOLIDIFY'); sol.thickness = 0.03
bev = obj.modifiers.new("EdgeBreak", 'BEVEL'); bev.width = 0.015; bev.segments = 3
wn  = obj.modifiers.new("FlatNormals", 'WEIGHTED_NORMAL')
mir = obj.modifiers.new("Symmetry", 'MIRROR'); mir.use_axis = (True, False, False)
arr = obj.modifiers.new("Repeat", 'ARRAY'); arr.count = 4; arr.relative_offset_displace[0] = 1.1
boo = obj.modifiers.new("Cut", 'BOOLEAN'); boo.operation = 'DIFFERENCE'
boo.object = cutter_obj; boo.solver = 'EXACT'

# stack order matters — index 0 evaluates first; move Solidify above any Boolean
obj.modifiers.move(obj.modifiers.find("Wall"), 0)
```
`WEIGHTED_NORMAL` after `SHADE_SMOOTH` (`obj.data.polygons.foreach_set('use_smooth', [True]*len(obj.data.polygons))`
or simply loop-set `p.use_smooth = True`) keeps flat faces flat and beveled edges soft — smooth shading alone
over-rounds large flat panels.

### Support loops vs. edge crease for Subsurf
Subdivision Surface averages every polygon toward the surrounding geometry's center of mass; a transition with
no supporting geometry gets softened away. Two fixes, pick one per edge:
- **Physical support loop** — `bmesh.ops.subdivide_edges` a tight ring close to the edge you want to hold; the
  closer the loop, the sharper the held transition.
- **Edge crease** (cheaper, no extra geometry) — `edge.crease = 1.0` on a `BMEdge` before `commit()`, or
  `me.edges[i].crease = 1.0` outside edit mode. Subsurf respects crease values 0.0-1.0 natively.

### Proportional-falloff shaping without an interactive tool
The manual proportional-editing workflow (grab a vertex, nearby verts follow with distance falloff) has a
direct scripted equivalent — useful for organic touches like liquid-surface disturbance or an arched lid:
```python
import math

def proportional_push(bm, pivot_vert, radius, offset):
    for v in bm.verts:
        d = (v.co - pivot_vert.co).length
        if d <= radius:
            falloff = 0.5 * (1 + math.cos(math.pi * d / radius))   # smooth 1→0
            v.co += offset * falloff
```

### Scripted orthographic views for the verify step
```python
def set_view(axis):  # 'FRONT' | 'TOP' | 'RIGHT' | 'LEFT' | 'BACK' | 'BOTTOM'
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == 'VIEW_3D':
                with bpy.context.temp_override(window=window, area=area):
                    bpy.ops.view3d.view_axis(type=axis)
                return
```
Call this before each `get_viewport_screenshot` in the verify phase instead of relying on whatever angle the
viewport happened to be left in.

### Materials
```python
mat = bpy.data.materials.new("concrete")
mat.diffuse_color = (0.55, 0.55, 0.52, 1.0)
obj.data.materials.append(mat)

# make an object's material independent instead of shared
obj2.data.materials[0] = obj.data.materials[0].copy()

# deliberately share instead (edits to one recolor every user)
obj2.data.materials[0] = obj.data.materials[0]

bpy.ops.object.material_slot_remove_unused()   # after any face-loop material assignment pass
```

## 4. Prompt-strategy notes

The single highest-leverage move is asking for a plan before geometry exists, and the second is treating every
reply as a draft to correct rather than a final answer. Fresh prompts that teach these moves (none lifted from
course transcripts):

- *Plan-first*: "Before creating anything, list the volumes this desk lamp needs as an ordered build sequence —
  base, arm, joint, shade, cable — and tell me which of those should be one primitive vs. which need edit-mode
  shaping. Don't create geometry yet."
- *Primitive-first coarse pass*: "Block out the lamp base and arm using nothing but scaled cubes and cylinders,
  no bevels or materials yet. I want to check proportions before anything else happens."
- *Scoped correction, not a redo*: "The arm joint is good but the base is too tall relative to its width — scale
  only the base object down on Z, keep everything else as-is."
- *Explicit numeric constraint*: "Make the tabletop 1.2m x 0.7m x 0.03m thick, origin at the underside center so
  it snaps cleanly onto the legs."
- *Reference by name, not by pointing*: since the agent can only see what's in the Blender scene, not an
  external annotation, give it addressable anchors: "Using `leg_front_left` as the reference for spacing, place
  three more legs at matching height and inset from the tabletop edges."
- *End-of-build organization pass*: "Now that the model reads correctly, name every object for what it is, group
  them into collections by sub-assembly, and remove any unused material slots."
- *Recovery prompt when a modifier misbehaves*: "The subsurf result is collapsing the lid's arched edge — explain
  why, then add the minimum support geometry needed to fix it without changing the base cage." (Ask for the
  mechanism, not just the fix — the explanation transfers to the next object.)

## 5. Pitfalls

1. **`bpy.ops.mesh.*` calls silently no-op or throw `RuntimeError: incorrect context`** when run from a
   socket-driven `execute_code` call with no guaranteed active viewport/selection state. Fix: edit via `bmesh`
   directly on the mesh datablock (Phase 3 technique) instead of toggling Edit Mode and calling interactive
   operators.
2. **A cancelled extrude leaves invisible duplicate vertices** exactly on top of the originals — the mesh looks
   unchanged but pinches under Subsurf later. Fix: `bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)`
   as a standing cleanup step after any edit-mode phase, whether or not you think an extrude was cancelled.
3. **Subsurf collapses sharp transitions** (necks, lids, trim edges) with no warning — this is expected modifier
   behavior, not a bug, but it reads as a bug if you don't add support loops or crease first (see technique
   notes). Add support *before* judging a Subsurf result, not after.
4. **Unapplied scale/rotation distorts Solidify thickness, Bevel width, and Mirror axis** unpredictably, because
   those modifiers evaluate in local object space. `transform_apply` before layering modifiers, not after
   debugging a lopsided bevel.
5. **A boolean cutter that is flush with or thinner than the target surface** produces non-manifold geometry or
   a failed cut — the solver can't determine inside/outside. The cutter must fully exceed the target's thickness
   on both sides of the cut.
6. **Modifier stack order changes the result** — a Solidify below a Boolean modifier solidifies the
   already-cut mesh and leaves stray interior faces; it must sit above. Check `obj.modifiers` order explicitly
   after adding modifiers out of sequence.
7. **Double transform via collection instancing**: a collection instance already derives its position from its
   prototype through the collection reference. If the *prototype* is also parented to the same empty an
   *instance* is parented to, the instance's movement compounds — it moves twice as far as everything else when
   the empty moves. Keep the prototype unparented and hidden; only instances go into the movable hierarchy.
8. **Origin/pivot decided late invalidates every prior transform** — scale and rotate pivot around whatever
   origin is currently set, so fixing the origin after several transforms means those transforms no longer mean
   what they used to. Decide base-center vs. geometry-center at creation time (Phase 2).
9. **Editing a shared material recolors every object using it** — if two props share a material datablock and
   only one should change color, `.copy()` the material onto that object's slot first; if they should stay in
   sync, assign the same datablock reference deliberately rather than by accident.
10. **Triangles and n-gons surviving into a Subsurf or smooth-shaded object** cause visible shading artifacts on
    curved hero pieces. Audit with `[f for f in obj.data.polygons if len(f.vertices) != 4]` before finalizing
    anything that will be smoothed or subdivided.
11. **Name collisions produce silent `.001` suffixes** — `bpy.data.objects.new("leg", ...)` when `"leg"` already
    exists creates `"leg.001"` without error. Any later step that looks an object up by string name can silently
    grab the wrong one. Check `bpy.data.objects.get(name) is None` before creating, or rename deterministically
    right after creation.
12. **One giant `execute_code` call for a whole multi-part object** trades precision for speed — it's the fastest
    way to get a rough version of anything and the least reliable way to get proportions, alignment, or material
    accuracy right. Reserve single large calls for genuinely uniform, repetitive operations (placing N identical
    instances); keep anything with proportion or alignment judgment calls broken into checkpointed steps.
