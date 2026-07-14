# Stylized / Low-Poly Modeling, Modular Asset Libraries & Environment Building

Source courses: *low-poly-stylization-with-blender-in-claude-code*, *generate-asset-libraries-with-blender-in-claude-code*, *environment-modeling-with-blender-ai*. All three drive Blender exclusively through BlenderMCP's `execute_code` (raw `bpy`), `get_scene_info`/`get_object_info`, and `get_viewport_screenshot` — there is no other command surface in use here.

## 1. When this applies

Use this reference when the task is: a stylized/low-poly scene (creatures, farms, props), a **modular kit-bash asset library** meant to tile into a larger structure (sci-fi corridors, dungeons, building interiors), or an **outdoor/set-dressed environment** (beach, farmyard, forest) built from many repeated or scattered small assets rather than one hero model. The throughline across all three courses is the same: get Claude to lay down rough geometry fast via `execute_code`, then spend the majority of the session on manual `bpy`-scripted or Blender-native refinement — variation, instancing, and placement — because that is where a stylized scene actually earns its look.

## 2. Workflow

### Phase A — Style contract before geometry
Before any mesh exists, pin down four things with the user/reference image: art style (low-poly vs realistic), camera/POV, build strategy (one-shot vs staged), and sky/lighting source (HDRI available, or fake it with an image plane). Locking these first prevents Claude from re-litigating proportions and palette on every subsequent asset. If building a kit, also pin the **grid unit** now (courses standardize on 1 m tiles) — every asset generated afterward should be sized as an exact multiple of that unit.

### Phase B — Shell / hull first (environments and kits)
For a bounded space (corridor, room, shack), generate the containing shell before any dressing: `execute_code` a base cube or extruded path, screenshot, then hand-edit it into the actual footprint (spin-extrude for curves, extrude+delete for open ends so light and camera can pass through). The shell is deliberately non-manifold where the camera will never see the back side — this is normal and saves geometry. For open outdoor scenes, the "hull" is the ground plane (sand/grass) plus a backdrop plane.

### Phase C — One asset at a time, review after each
Never batch-request the whole scene. Ask for a single asset (one tree, one wall panel, one chair leg), let it complete, `get_viewport_screenshot`, then decide: keep / fix-by-prompt / fix-by-hand / reject-and-redo. This loop is the entire content of these courses — geometry generation is the cheap part, judgment is the expensive part. For organic shapes (creatures, shells, crabs) expect the first Claude attempt to be poor; the reliable recovery is to paste a **reference image with visible topology** and explicitly tell it to remove the failed attempt, then treat the result as a rough base you subdivide and reshape by hand rather than as a finished asset.

### Phase D — Variant generation for tiling assets
Once one asset in a family exists (a wall panel, a floor tile), produce 2-3 variants by duplicating and lightly modifying (raise a face, remove a detail, add a manually-built accent piece) rather than re-prompting from scratch each time. Store each family in its own Blender **collection** (`Wall Panel`, `Floor Panel`, `Vents and Details`, ...) — the collection *is* your asset library, and whichever collection is active when `execute_code` runs is where Claude's new objects land, so switch the active collection deliberately before each generation call.

### Phase E — Assembly: parent, place, propagate
Parent each family's variants to one "primary" member (`Ctrl+P` / `object.parent_set(keep_transform=True)`) so the whole family moves as a unit during placement. Place the first instance by hand against the hull, then propagate: duplicate + rotate about a re-centred 3D cursor for radial/cornering symmetry, or duplicate + axis-constrained move with snapping for linear tiling. This is scripted in `bpy` as duplicate → transform, not as a Blender "Array" object necessarily — see §3.

### Phase F — Linking for bulk edits
Before final materials/lighting, `Ctrl+L → Link Object Data` (`obj.data = source.data`) across every object that should be visually identical. Any subsequent edit-mode change to the shared mesh — a new material slot assignment, a re-cut detail — propagates to every linked instance instantly. Do this *before* the lighting pass; fixing a floating light or a bad UV once and having it apply everywhere is the whole point.

### Phase G — Environment dressing / scatter pass
For outdoor scenes: request a batch of like objects (trees, rocks) from Claude once, confirm the base look, then scatter with scripted randomised duplication (§3) rather than manual placement of dozens of copies. Group each scatter batch under an Empty for later bulk selection/move.

### Phase H — Lighting, materials, render settings
Ask for lighting only after geometry is substantially locked — Claude tends to over-light on first pass (comprehensive rigs, wrong-color lights, lights embedded inside geometry instead of outside it). Expect to manually reposition, recolor, and re-power every light it adds. Compare Eevee vs Cycles empirically per-scene; Cycles surfaces volumetrics and true displacement but costs denoise/sample tuning.

### Phase I — Camera, DOF, final polish
Frame the camera, extend clip-end so background planes aren't culled, add depth-of-field to hide any remaining low-detail geometry at the edges of focus, do a last color-management pass (View Transform + Look), then `F12`.

## 3. `bpy` technique notes

### Flat/faceted shading (the low-poly "look")
```python
import bpy
obj = bpy.context.object
for poly in obj.data.polygons:
    poly.use_smooth = False
# or, simplest form on a selected mesh object:
bpy.ops.object.shade_flat()
```
Reserve `shade_smooth()`/`shade_auto_smooth()` (angle-threshold smoothing that preserves hard edges at steep angles) for structural hulls and organic assets (creature bodies, coconuts, shells) where you want rounded volume but still-sharp architectural corners. Never blanket `shade_smooth()` a whole selection that includes both a hull and its flat-faceted dressing — it will round corners you need crisp.

### Linked duplicates vs full copies (the low-poly economy trick)
```python
# Linked duplicate: shares mesh data, near-zero extra memory/poly cost.
bpy.ops.object.duplicate_move_linked(OBJECT_OT_duplicate={"linked": True})
# Equivalent low-level form for scripted scatter:
new_obj = obj.copy()
new_obj.data = obj.data          # same datablock -> linked
bpy.context.collection.objects.link(new_obj)
```
Use linked duplicates for anything that repeats without unique per-instance sculpting: trees scattered across a field, fence posts, tiled wall panels before you diverge a variant. A field of 20 scattered trees sharing 2 source meshes costs barely more than 2 trees. Editing the source mesh in Edit Mode updates every linked copy — this is the mechanism behind the "fix once, fixes everywhere" workflow in Phase F. Once an instance needs individual sculpting (a bent branch, a unique dent), separate it from the link first (`Object > Relations > Make Single User > Object & Data`), otherwise the edit bleeds into siblings unintentionally.

### Collection instances for whole-asset reuse
```python
inst = bpy.data.objects.new("VentGrilleA_Instance", None)
inst.instance_type = 'COLLECTION'
inst.instance_collection = bpy.data.collections["Vent Grille A"]
bpy.context.collection.objects.link(inst)
inst.location = (3.0, 0.0, 1.2)
```
Prefer a **collection instance** over object-linking when the reusable unit is itself a multi-object assembly (a whole vent grille rig, a full parented wall-panel family) rather than a single mesh — one empty-like instance object stands in for the entire assembly and can be duplicated/rotated as one unit without re-parenting each time.

### Scripted scatter with jitter (procedural placement)
```python
import random, mathutils
scatter_parent = bpy.data.objects.new("Scatter_Trees", None)
bpy.context.collection.objects.link(scatter_parent)
sources = [bpy.data.objects["Pine_01"], bpy.data.objects["Oak_01"]]
placed = []
for i in range(20):
    src = random.choice(sources)
    new = src.copy(); new.data = src.data
    bpy.context.collection.objects.link(new)
    new.parent = scatter_parent
    new.rotation_euler.z = random.uniform(0, 6.2832)
    s = random.uniform(0.8, 1.35)
    new.scale = (s, s, s)
    # reject placements that overlap reserved footprints (barn, pens, paths)
    candidate = mathutils.Vector((random.uniform(-16, 16), random.uniform(-13, 13), 0))
    if any((candidate - mathutils.Vector(fp)).length < r for fp, r in RESERVED_ZONES):
        continue
    new.location = candidate
    placed.append(new)
```
This is the scripted generalisation of "scatter trees, avoiding the barn/silo/pens" — keep a `RESERVED_ZONES` list of (center, radius) pairs for anything the scatter must not intersect, and reject-and-resample rather than trying to solve placement analytically. Random rotation + a modest scale range (roughly ±25-35%) is what prevents a scatter from reading as copy-pasted; uniform scale/rotation is the single most common tell of a lazy scatter.

### Array modifier vs scripted duplication
The `ARRAY` modifier (`obj.modifiers.new("Tile", 'ARRAY')`, `count`, `relative_offset_displace`) is correct for a perfectly regular run (a straight fence, a repeating pipe) where you want live, non-destructive control over count. For kit-bashing an irregular corridor with corner turns and per-tile variants, scripted duplicate-and-transform (or manual Shift+D chains) is more practical because you need each tile to independently be *variant A, B, or the junction piece* — Array can't vary its children by content, only repeat one object.

### Mirror modifier with a dedicated mirror object
```python
mirror_anchor = bpy.data.objects.new("MirrorAnchor", bpy.data.meshes.new("empty_mesh"))
mirror_anchor.location = (0, 0, -5)   # tucked out of view
bpy.context.collection.objects.link(mirror_anchor)
mod = leg_obj.modifiers.new("Mirror", 'MIRROR')
mod.use_axis = (True, True, False)     # X and Y, e.g. 4-fold leg symmetry
mod.mirror_object = mirror_anchor
```
When the default mirror plane (through the object's own origin) picks the wrong side, an explicit anchor object removes the ambiguity — the mirror plane is defined by *that* object's transform, not guesswork about local axes. This is the standard pattern for symmetric props (chair/table legs, symmetric creature halves, symmetric wall sections): model one unit, mirror the rest, and every edit to the source propagates through the modifier live until you apply it.

### Radial duplication around a pivot (corners, ring props, four-fold symmetry)
```python
bpy.context.scene.cursor.location = (0, 0, 0)
bpy.context.scene.tool_settings.transform_pivot_point = 'CURSOR'
for i in range(3):
    bpy.ops.object.duplicate_move(
        TRANSFORM_OT_translate={"value": (0, 0, 0)})
    bpy.ops.transform.rotate(value=1.5708, orient_axis='Z')  # 90 degrees
```
This is the "3D cursor to world origin, pivot to cursor, duplicate + rotate 90°, repeat" pattern used throughout the corridor-kit course for filling all four corners of a symmetric layout (I-beams, corner grilles) from a single correctly-placed source.

### Displacement + Voronoi for organic ground (sand, snow, dirt, gravel)
```python
tex = bpy.data.textures.new("GroundVoronoi", type='VORONOI')
tex.noise_scale = 1.4          # bump = tighter clumps, higher = broader dunes
mod = ground_obj.modifiers.new("Displace", 'DISPLACE')
mod.texture = tex
mod.strength = 0.7
# Apply BEFORE sculpting -- sculpt mode only sees baked geometry, not live modifiers.
bpy.ops.object.modifier_apply(modifier="Displace")
```
`strength` around 0.6-0.8 with `noise_scale` around 1.0-1.5 is a reasonable starting point for "clumpy but not spiky" organic ground; tune per-scene. Always apply the Subdivision Surface modifier (if present) and the Displace modifier before entering Sculpt Mode to hand-shape dunes/mounds/drifts — sculpt brushes operate on real geometry only.

### PNG-alpha cards for anything flat-and-complex (the highest-leverage technique in this bundle)
```python
mat = bpy.data.materials.new("LeafCard")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = bpy.data.images.load("/path/to/leaf_alpha.png")
nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
mat.blend_method = 'CLIP'          # or 'HASHED' for softer edges
plane.data.materials.append(mat)
# Simple Deform (Bend) needs interior geometry to bend against -- a bare 4-vert
# plane is rigid. Add loop cuts before adding the modifier:
bend = plane.modifiers.new("Bend", 'SIMPLE_DEFORM')
bend.deform_method = 'BEND'
bend.angle = 0.6
```
A single plane with an alpha-cutout image (leaf, grass blade, fern, fence wire, hair clump, smoke wisp) and a `SIMPLE_DEFORM` bend costs a few verts versus hundreds for the modeled equivalent, and reads better in a stylized render than hand-modeled fine detail usually does. Weakness: cards go invisible edge-on, so cross a few cards at different rotations per cluster (classic "grass card" cross) if the camera will ever see a shallow angle. This generalizes directly to instanced ground-cover scatter (§ scripted scatter above, but instancing card planes instead of meshes) for grass/foliage fields at negligible poly cost.

### PolyHaven vs hand-built backgrounds
The environment course deliberately skipped HDRIs in favor of a manual image-plane-plus-Emission-shader backdrop (`Emission.Color` fed by an Image Texture, UV-cropped to frame exactly the desired slice of sky, `Emission.Strength` doubling as the scene's key light). That trade-off is worth knowing: an HDRI (via `search_polyhaven_assets`/`download_polyhaven_asset`, gated on the addon panel) gives you fast, physically coherent all-around lighting with near-zero setup, but you get *no* control over exactly what's visible through a doorway or window — you take the whole sphere. A cropped image-plane backdrop gives full compositional control (exact framing, easy palette swaps, doubles as bounce-light source) at the cost of only lighting from one direction and needing manual `Clip End` extension so it isn't near-clipped. Default to PolyHaven when you need fast, all-around physically plausible lighting/props and style fidelity isn't critical (e.g. a ground texture, a quick studio HDRI for material previews); default to a hand-built image plane when the shot is a single fixed composition and you need exact control over what's in frame — which is the common case for a stylized single-render environment piece.

### Performance discipline for stylized scenes
- Keep individual hero-adjacent assets in the tens-to-low-hundreds of polys (course examples: ~43-90 verts per tree, ~72-164 polys per farm animal). This is a deliberate style constraint, not just an optimization — faceted low counts *are* the look.
- Use `shade_flat()` instead of adding geometry to fake facets.
- Prefer linked duplicates / collection instances over independent mesh copies for anything repeated more than twice.
- Reserve Subdivision Surface and Displace for hero assets and ground; apply-then-discard the modifier once you're past the phase that needs it live, rather than leaving dozens of live subsurf modifiers in a scattered field.
- Let camera depth-of-field cover for low detail on background/scattered objects (birds, distant scatter) instead of spending modeling budget there — this is a legitimate, deliberate technique, not corner-cutting.

## 4. Prompt-strategy notes

- **Front-load constraints, not aesthetics.** State the hard numeric/structural constraint in the first sentence of an asset request ("exactly one by one metre," "must stay low poly," "topology must be a single connected mesh") — Claude respects explicit dimensional/topological constraints far more reliably than adjectives like "clean" or "nice." A prompt built around one vague adjective is the most common cause of a misread generation.
  - Fresh example: *"Model a wall-tile prop exactly 1×1m in local space, origin at the bottom-left corner so it tiles on the grid with no gaps. Keep it under 150 tris."*
- **Ask it to ask you questions before big multi-part builds.** For a full scene rather than a single asset, open with a request to decompose the brief and interrogate you on style/scope/camera/lighting-source before generating anything. This front-loads the decisions that are expensive to unwind later (wrong POV, wrong complexity level) into a cheap Q&A instead of a rebuild.
  - Fresh example: *"I want to build [scene]. Before creating anything, break this into build stages and ask me whatever you need to lock down style, scale, and camera framing first."*
- **One asset, then explicit continuation.** Resist bundling "add the barn, the fence, and the animals" into one prompt — batched requests are where Claude both silently drops items and produces the least reviewable diffs. Close out each stage explicitly ("that's good, let's move to X") so the next prompt doesn't get re-litigated against stale context.
- **Name what must survive.** Whenever you're extending an existing scene, state explicitly what must not be touched — Claude will otherwise sometimes regenerate or "improve" prior work you already accepted.
  - Fresh example: *"Add three market stalls to the plaza. Do not modify the fountain or the paving we already built — build only in the empty north quadrant."*
- **Recover from a bad organic asset with a reference, not a re-explanation.** If a from-imagination generation fails (this is near-guaranteed for creatures/shells/fine organic detail), don't iterate on wording — paste a reference image with visible topology and ask for a *low-poly base* explicitly, plus an instruction to delete the failed attempt. Then take over manually for the fine shaping; this is a division-of-labor pattern, not a prompting failure.
  - Fresh example: *"That doesn't read as a crab. Delete it and rebuild a low-poly base crab as one connected mesh, matching the silhouette in this reference — I'll refine the legs and claws by hand."*
- **State the mirror/symmetry setup as a build instruction.** When you know an asset is symmetric, say so up front so Claude models a half and you finish with a mirror, rather than getting an already-doubled, harder-to-edit mesh.
- **Ask for lighting last, and expect to fix placement.** Don't treat Claude's first lighting pass as final — ask for it once geometry is stable, then manually correct color temperature, move any light that ended up floating off a surface or embedded inside a mesh, and re-balance power per light rather than one global exposure slider.

## 5. Pitfalls

- **Vague adjectives get misread.** "Clean" was interpreted as "single extrusion" instead of "smooth multi-loop curve" in one course transcript — swap subjective adjectives for the concrete constraint you actually mean (loop count, tri budget, exact dimension).
- **Duplicate/coincident vertices from generation.** Claude-generated meshes frequently ship with stacked verts along edges, which breaks edge-slide and other topology-dependent operations. Always run `bpy.ops.mesh.remove_doubles()` (Merge by Distance) after import/generation before doing any edge-slide or precision editing.
- **Flipped normals on generated organic meshes.** If a mesh renders pitch-black or a face refuses to show in face-select, normals are inverted — `select_all(action='SELECT')` then `bpy.ops.mesh.normals_make_consistent(inside=False)` (Shift+N) fixes the overwhelming majority of cases in two operations.
- **Parenting/mirror double-positioning bugs.** Objects generated with both a parent transform and an explicit world-space position can end up doubled-up and drift far off-scene (a windmill fan floating tens of metres away, a dome cap detached from its silo). Check `get_object_info` world coordinates against expectation whenever a "completed" sub-part is visually missing — it's very often just displaced, not actually absent.
- **Un-applied transforms silently break modifier-dependent operations.** `Alt+S` (shrink/fatten along normals) and several other operators misbehave on objects with un-applied rotation/scale. If a normals-relative operation "does nothing," `Ctrl+A → All Transforms` first, then retry.
- **Blanket shade-smooth ruins hulls.** Right-click Shade Smooth rounds every edge including ones you need sharp (structural corners). Use `shade_auto_smooth` (angle-threshold) or restrict smoothing to the specific organic sub-object instead of the whole selection.
- **A light left inside a room, not outside it, blows out the interior.** For the "sunlight through gaps/cracks" look, place the light source *outside* the structure aimed in; a light placed inside a small enclosed space over-exposes uniformly and loses the directional cracks-of-light effect entirely.
- **Scattering with zero rotation/scale jitter reads as copy-paste.** Even when poly-budget and placement are otherwise fine, uniform rotation and uniform scale across a scattered batch is the fastest way to make a "natural" field look mechanical — always randomize both, and bias placement away from a perfect grid or triangle.
- **Session/MCP drops mid-generation are routine, not exceptional.** The connection between the client and the Blender-side socket server can flake mid-command. The correct response is "please continue" or "please retry," not restarting the chat — restarting loses the accumulated style/scope context that took several turns to establish. If a follow-up claims work is already done but the viewport shows nothing, state plainly that the asset is missing and ask for a rebuild rather than assuming your own inspection is wrong.
- **Alpha cards go invisible edge-on.** Any camera path that pans past roughly parallel-to-plane will make a single alpha-card leaf/blade disappear. Cross multiple cards at different rotations for anything the camera might see from a shallow angle, not just from the front.
