# PBR Material Authoring & Shader Nodes

## When this applies

The agent needs to give a mesh a physically-plausible surface: wiring texture
sets to a Principled BSDF, layering multiple materials (metal-under-paint,
rust, dirt) with mask-driven blends, or building a procedural shader with no
image textures at all. Everything below goes through BlenderMCP
`execute_code` running `bpy` — there is no material-authoring command in the
MCP surface itself beyond the PolyHaven trio (`search_polyhaven_assets`,
`download_polyhaven_asset`, `set_texture`), so node graphs are built or edited
one `bpy` call at a time.

## Workflow

### Phase 0 — Sanity-check the mesh before touching shading

1. `execute_code`: confirm scale is applied (`obj.scale == (1,1,1)`) and check
   for **linked duplicates** — multiple objects sharing one `mesh` datablock
   (`obj.data.users > 1`). Applying scale to one user of a shared mesh warps
   every sibling; make each single-user first:
   ```python
   import bpy
   for obj in bpy.data.objects:
       if obj.type == 'MESH' and obj.data.users > 1:
           obj.select_set(True)
   bpy.ops.object.make_single_user(object=True, obdata=True)
   ```
2. Watch for the **shear trap**: an object with non-uniform scale
   (e.g. `[0.13, 0.17, 0.17]`) that has rotated children. A blind
   `bpy.ops.object.transform_apply()` across that hierarchy can distort the
   children. Snapshot world-space vertex positions before and after, and
   diff them, rather than trusting the apply blindly:
   ```python
   def world_bbox_snapshot():
       return {o.name: [o.matrix_world @ v.co for v in o.data.vertices]
               for o in bpy.data.objects if o.type == 'MESH'}
   ```
3. Collapse the material count before authoring: strip every slot and assign
   one shared material so the first texture layer only has to be wired once.
   ```python
   mat = bpy.data.materials.new("Mech")
   mat.use_nodes = True
   for obj in target_objects:
       obj.data.materials.clear()
       obj.data.materials.append(mat)
   ```
   One material == one shared node tree == one wiring pass, at the cost of
   having to re-instance (`material.copy()`) it later for any object that
   needs to diverge.

### Phase 1 — UV unwrap prerequisites

- Scale must already be applied — non-unit scale distorts island proportions
  and texel density unevenly across the mesh.
- If modifiers (Bevel, Boolean, Subsurf) shape the final surface, convert
  them to real geometry first (`bpy.ops.object.convert(target='MESH')`);
  unwrapping before that bakes UVs onto a shape that is about to change.
- `smart_project` and the overlap check are UV-editor operators — they need
  an `IMAGE_EDITOR` (or `VIEW_3D` in UV sync mode) area in the context
  override when called from `execute_code`, since BlenderMCP does not run
  inside a UV editor area by default:
  ```python
  import bpy

  for area in bpy.context.window.screen.areas:
      if area.type == 'VIEW_3D':
          override_area = area
          break

  with bpy.context.temp_override(area=override_area):
      bpy.ops.object.mode_set(mode='EDIT')
      bpy.ops.mesh.select_all(action='SELECT')
      bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.002)
      bpy.ops.object.mode_set(mode='OBJECT')
  ```
  (`angle_limit` is radians in the Python API even though the UI shows
  degrees — 1.15 rad ≈ 66°.)
- After unwrapping, check for overlapping islands — overlap causes texture
  bleed between unrelated areas and is far cheaper to fix here than after
  texturing:
  ```python
  with bpy.context.temp_override(area=override_area):
      bpy.ops.uv.select_overlap()
  # then inspect me.uv_layers.active for selected overlapping loops
  ```

### Phase 2 — Primary (base) PBR layer

1. Load the texture set (albedo/base-color, roughness, metallic, normal —
   optionally AO) as image nodes, sharing **one** Texture Coordinate +
   Mapping node so the whole set scales/offsets together.
2. Set colour space per map: base color/albedo stays `sRGB`; every other
   map (roughness, metallic, normal, AO, curvature, ID) is data and must be
   `Non-Color`. Getting this wrong is the single most common PBR mistake —
   see Pitfalls.
3. Wire albedo → Base Color, metallic → Metallic, roughness → Roughness.
   Normal maps never connect directly — always insert a Normal Map node
   between the texture and the BSDF's Normal input.
4. Screenshot in Material Preview. If the result reads too dark, diagnose
   before editing the shader: check the scene's colour-management **view
   transform** and world/light strength first. A view transform set to a
   high-contrast filmic-style transform (e.g. ACES) versus the default AgX
   can look like a broken material when the shader is actually correct.
   Only add a Hue/Saturation/Value lift node if the darkness is confirmed to
   be in the texture data itself.

### Phase 3 — Secondary layer via a mask-driven blend

1. Load a second texture set (a coating: paint, a second metal, rust) the
   same way, framed separately from the primary set for legibility.
2. Load the pre-baked mesh masks (ambient occlusion, curvature, object ID —
   these ship as image files with the source mesh; they are not computed
   in-shader) as `Non-Color` textures.
3. Build (or reuse) a small reusable node group that mixes base and coat
   per channel through a single mask input — see the `bpy` snippet below.
   Curvature masks tend to reveal the base layer at edges/raised geometry
   (a worn-paint look); ambient occlusion masks tend to reveal it in
   recessed/enclosed areas (a grime/wear-in-crevices look). Both are valid;
   pick by the surface story you want.
4. Route the mask signal through a Map Range node before the group's Mask
   input so the effect's threshold and falloff are tunable without
   rewiring, and optionally multiply two masks together (e.g. AO ×
   roughness-as-noise) to break up an otherwise too-uniform blend edge.

### Phase 4 — Stacking further layers (rust, dirt, wear)

Each additional layer is the same group, chained: the previous blend
group's output becomes the new group's Base input, the new texture set
feeds Coat, and a new (or reused) mask feeds Mask. A vertical dirt/leak
gradient is a good example of a mask that isn't a baked mesh map at all:
build it from the `Geometry` node's Position output through a `Mapping`
node rotated 90° on X, so the gradient runs bottom-to-top in world space
and applies uniformly across every object sharing the material.

### Phase 5 — Preview and hand-off

- Material Preview (`space.shading.type = 'MATERIAL'`) uses a fixed studio
  HDRI by default, not scene lights — good for judging the shader in
  isolation, misleading for judging exposure in the final scene.
- Switch to `'RENDERED'` with Cycles (`scene.render.engine = 'CYCLES'`) to
  judge the material under actual scene lighting before calling a material
  finished.
- Screenshot both, and check `get_object_info` on a couple of instances to
  confirm the material assignment actually landed where intended — material
  instancing bugs (see Pitfalls) are invisible in a single-object screenshot.

## `bpy` technique notes

### Fresh material + shared UV mapping

```python
import bpy

def new_pbr_material(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    out.location = (600, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.location = (300, 0)
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    coord = nt.nodes.new('ShaderNodeTexCoord')
    coord.location = (-900, 0)
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.location = (-700, 0)
    nt.links.new(coord.outputs['UV'], mapping.inputs['Vector'])
    return mat, nt, bsdf, mapping
```

### Loading one texture set with correct colour spaces

```python
def load_image_node(nt, filepath, non_color, location):
    img = bpy.data.images.load(filepath, check_existing=True)
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    node = nt.nodes.new('ShaderNodeTexImage')
    node.image = img
    node.location = location
    return node

def wire_texture_set(nt, mapping, maps, x=-400, y0=400, step=280):
    """maps: {'Base Color': path, 'Metallic': path, 'Roughness': path,
              'Normal': path, 'AO': path}"""
    nodes = {}
    for i, (channel, path) in enumerate(maps.items()):
        n = load_image_node(nt, path, channel != 'Base Color', (x, y0 - i * step))
        nt.links.new(mapping.outputs['Vector'], n.inputs['Vector'])
        nodes[channel] = n
    return nodes

def connect_to_bsdf(nt, bsdf, nodes, x_offset=350):
    for channel in ('Base Color', 'Metallic', 'Roughness'):
        if channel in nodes:
            nt.links.new(nodes[channel].outputs['Color'], bsdf.inputs[channel])
    if 'Normal' in nodes:
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        nmap.location = (nodes['Normal'].location.x + x_offset,
                          nodes['Normal'].location.y)
        nt.links.new(nodes['Normal'].outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
```

### A reusable base/coat layer-blend node group

Blender's unified `ShaderNodeMix` node carries Float/Vector/Color sockets
simultaneously, all named `A`/`B`/`Result` — only distinguishable by socket
**index**, not name, once `data_type` is set. This is worth hard-coding
rather than guessing at runtime:

```python
MIX_AB_INDEX = {'FLOAT': (2, 3), 'VECTOR': (4, 5), 'RGBA': (6, 7)}
MIX_OUT_INDEX = {'FLOAT': 0, 'VECTOR': 1, 'RGBA': 2}

def build_layer_blend_group(name='PBR Layer Blend'):
    if name in bpy.data.node_groups:
        return bpy.data.node_groups[name]

    group = bpy.data.node_groups.new(name, 'ShaderNodeTree')
    iface = group.interface
    for prefix in ('Base ', 'Coat '):
        iface.new_socket(prefix + 'Color', in_out='INPUT', socket_type='NodeSocketColor')
        iface.new_socket(prefix + 'Metallic', in_out='INPUT', socket_type='NodeSocketFloat')
        iface.new_socket(prefix + 'Roughness', in_out='INPUT', socket_type='NodeSocketFloat')
        iface.new_socket(prefix + 'Normal', in_out='INPUT', socket_type='NodeSocketVector')
    iface.new_socket('Mask', in_out='INPUT', socket_type='NodeSocketFloat')
    for out_name, out_type in (('Color', 'NodeSocketColor'), ('Metallic', 'NodeSocketFloat'),
                                 ('Roughness', 'NodeSocketFloat'), ('Normal', 'NodeSocketVector')):
        iface.new_socket(out_name, in_out='OUTPUT', socket_type=out_type)

    nodes, links = group.nodes, group.links
    gin = nodes.new('NodeGroupInput'); gin.location = (-700, 0)
    gout = nodes.new('NodeGroupOutput'); gout.location = (500, 0)

    def mix(data_type, base_socket, coat_socket, y):
        m = nodes.new('ShaderNodeMix')
        m.data_type = data_type
        m.clamp_factor = True
        m.location = (0, y)
        a_idx, b_idx = MIX_AB_INDEX[data_type]
        links.new(gin.outputs['Mask'], m.inputs[0])       # shared float factor
        links.new(gin.outputs[base_socket], m.inputs[a_idx])
        links.new(gin.outputs[coat_socket], m.inputs[b_idx])
        return m, MIX_OUT_INDEX[data_type]

    color_mix, ci = mix('RGBA', 'Base Color', 'Coat Color', 300)
    metal_mix, mi = mix('FLOAT', 'Base Metallic', 'Coat Metallic', 100)
    rough_mix, ri = mix('FLOAT', 'Base Roughness', 'Coat Roughness', -100)
    normal_mix, ni = mix('VECTOR', 'Base Normal', 'Coat Normal', -300)

    links.new(color_mix.outputs[ci], gout.inputs['Color'])
    links.new(metal_mix.outputs[mi], gout.inputs['Metallic'])
    links.new(rough_mix.outputs[ri], gout.inputs['Roughness'])
    links.new(normal_mix.outputs[ni], gout.inputs['Normal'])
    return group
```

Instantiating it between two texture sets, masked by curvature run through
a Map Range ("mask levels"):

```python
group = build_layer_blend_group()
blend = nt.nodes.new('ShaderNodeGroup')
blend.node_tree = group
blend.location = (0, 0)

mask_range = nt.nodes.new('ShaderNodeMapRange')
mask_range.location = (-300, -500)
nt.links.new(curvature_node.outputs['Color'], mask_range.inputs['Value'])
nt.links.new(mask_range.outputs['Result'], blend.inputs['Mask'])

for ch in ('Color', 'Metallic', 'Roughness', 'Normal'):
    nt.links.new(primary_nodes_out[ch], blend.inputs['Base ' + ch])
    nt.links.new(secondary_nodes_out[ch], blend.inputs['Coat ' + ch])

nt.links.new(blend.outputs['Color'], bsdf.inputs['Base Color'])
nt.links.new(blend.outputs['Metallic'], bsdf.inputs['Metallic'])
nt.links.new(blend.outputs['Roughness'], bsdf.inputs['Roughness'])
nt.links.new(blend.outputs['Normal'], bsdf.inputs['Normal'])
```

Chaining a third layer is the same group again, with the previous `blend`
node's outputs plugged into the new group's `Base *` inputs.

### Object-ID maps are not masks — isolate a colour first

An object-ID texture is a flat-colour region map (one solid RGB per part),
not a 0–1 greyscale mask, so wiring it straight into a Mask input does
nothing useful. Isolate the target colour with a distance compare, then
threshold it:

```python
target_id = nt.nodes.new('ShaderNodeVectorMath')
target_id.operation = 'DISTANCE'
target_id.inputs[1].default_value = (0.812, 0.334, 0.114)  # the part's ID colour
nt.links.new(id_node.outputs['Color'], target_id.inputs[0])

ramp = nt.nodes.new('ShaderNodeValToRGB')  # ColorRamp, used as a threshold
nt.links.new(target_id.outputs['Value'], ramp.inputs['Fac'])
# tighten the ramp's black/white stops until only the target part is white
```

### Procedural materials (no image textures at all)

Node-only shaders (metal, wood grain, banded colour) are built from
generator + colour-mapping nodes instead of image textures — `ShaderNodeTexNoise` /
`ShaderNodeTexWave` / `ShaderNodeTexVoronoi` feeding a `ShaderNodeValToRGB`
(ColorRamp) for colour banding, and typically a `ShaderNodeBump` off the same
noise for surface micro-detail. This is a legitimate alternative path to the
image-based workflow above whenever a texel budget or tileable-seam problem
makes photographic maps unattractive; the two approaches compose (a
procedural noise mask can drive the same layer-blend group used for image
sets).

### PolyHaven textures via BlenderMCP (feature-gated)

Only available if the user has enabled it in the Blender-side addon panel.
This is the one path that doesn't go through hand-written node wiring:

```python
# these are BlenderMCP tool calls, not execute_code / bpy
search_polyhaven_assets(asset_type="textures", categories="metal")
download_polyhaven_asset(asset_id="scuffed_metal_01", asset_type="textures", resolution="2k")
set_texture(object_name="Mech_Barrel", texture_id="scuffed_metal_01")
```

`set_texture` builds and wires the node graph automatically. Still inspect
the result via `execute_code` afterwards — confirm colour spaces landed
correctly and a Normal Map node was inserted — before trusting it as final;
automated wiring is exactly as fallible as a first manual pass.

## Prompt-strategy notes

- Ask for an inventory before any edit: *"Read the current shader node tree
  on this material and tell me exactly what's wired to the Principled BSDF
  right now — don't assume, don't add anything yet."* Agents that skip this
  step reconnect sockets that were already correct, or silently duplicate a
  Normal Map node.
- Decompose "make it look right" into a diagnosis step and a fix step:
  *"The viewport reads too dark. Before changing any node, check the
  scene's view transform and world/light strength — only touch the shader
  if you can show the texture data itself is at fault."* This prevents the
  common failure of adding brightness-lift nodes to fix what was actually a
  colour-management setting.
- When asking for a reusable structure, say so explicitly: *"Build this
  base/coat blend as a node group with named Base/Coat/Mask sockets, not
  inline nodes, so I can duplicate it for the next layer without
  rebuilding."*
- Name the intended mask source up front rather than letting the agent
  guess: *"Use the curvature map as the mask, routed through a Map Range
  node so I can retune the threshold afterwards without rewiring."*
- After any node-graph edit made via `execute_code`, ask for a save:
  *"Once you confirm this looks right in a screenshot, save the file — I
  don't want to rely on undo to recover this state."* (see Pitfalls below).
- For hand-off, ask for an inventory of the final material list rather than
  trusting memory: *"List every material in the scene, how many objects use
  each, and flag any that look like duplicate/orphaned copies of the same
  name."*

## Pitfalls

- **Non-Color left unset.** Any map that isn't the base-color/albedo
  (roughness, metallic, normal, AO, curvature, ID) must be `Non-Color`. Left
  on `sRGB`, roughness/metallic read too dark or too bright and normal maps
  produce visibly wrong shading. This is the single highest-frequency bug
  in the whole workflow.
- **Dark viewport misdiagnosed as a bad material.** A high-contrast view
  transform or a world with no actual lights (HDRI-only at strength 1) looks
  identical, at a glance, to a broken shader. Check colour management and
  world strength before editing nodes.
- **Applying scale on a shared mesh datablock.** If two or more objects
  point at the same `mesh` data, applying transforms to one distorts every
  other user. Make single-user (object + data) before any bulk transform
  apply, and specifically re-check any parent with non-uniform scale that
  has rotated children — that combination shears silently.
- **Object-ID maps fed directly into a mask input.** They're colour regions,
  not greyscale factors; isolate the target colour (distance/compare +
  threshold) before using one as a `Mask` input.
- **Independent Texture Coordinate/Mapping nodes per import.** Dragging in
  each texture set separately can leave every image with its own UV/Mapping
  node; they then drift out of sync (different scale/offset) as the graph
  grows. Consolidate to one shared Mapping node per material and rescale
  there.
- **Undo/redo is unreliable after script-driven node edits.** Operations
  performed via `execute_code` don't always sit cleanly on Blender's normal
  undo stack; a stray Ctrl+Z can silently revert a whole node-group build.
  Save the file once a state is confirmed good rather than relying on undo
  as a safety net.
- **Material-instance name drift.** Clicking "make single user" on a shared
  material slot produces a `.001`-suffixed copy; if work continues on the
  original by mistake, the visible result and the "current" material
  silently diverge. After instancing, confirm which name holds the live
  work, retire the other, and purge orphan data-blocks
  (`bpy.data.orphans_purge(do_recursive=True)`) once consolidated.
- **UV overlap left unchecked.** Overlapping islands cause texture bleed
  that is expensive to trace back to its source once several material
  layers are stacked on top. Check immediately after `smart_project`, not
  after the material is built.
