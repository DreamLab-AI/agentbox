"""Generate a ground-mounted solar array in Blender for layout + inter-row shading review.

Runs headless (blender --background --python this.py -- <json-params>) or in the
gui-tools GPU sidecar. Builds a rack-mounted PV array: rows of tilted modules on a
ground plane, spaced by row pitch, optionally lit by the sun at a given altitude/azimuth
so inter-row shadows are visible (the load-bearing check for UK ground layouts, where
winter-solstice shading sets the row pitch).

Params (JSON after `--`), all optional with UK-sensible defaults:
{
  "rows": 6, "modules_per_row": 20,
  "module_w": 1.134, "module_h": 2.278,   # metres — a common 550-600W bifacial module (portrait)
  "modules_high": 2,                        # modules stacked up the rack (2-high portrait table)
  "tilt_deg": 35, "row_pitch": 6.0,         # metres, centre-to-centre between row fronts
  "gap": 0.02,                              # inter-module gap
  "clearance": 0.8,                         # front-edge ground clearance (m)
  "sun_altitude_deg": 15.0,                 # e.g. UK winter-solstice solar noon ~ 15° at 52N
  "sun_azimuth_deg": 180.0,                 # solar noon = due south
  "terrain_z": null,                        # null=flat; or a slope angle handled by caller
  "out_blend": "/tmp/solar_array.blend",
  "out_render": "/tmp/solar_array.png",
  "render": true
}
"""
import bpy, sys, json, math

def p():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    cfg = json.loads(argv[0]) if argv else {}
    d = dict(rows=6, modules_per_row=20, module_w=1.134, module_h=2.278, modules_high=2,
             tilt_deg=35.0, row_pitch=6.0, gap=0.02, clearance=0.8,
             sun_altitude_deg=15.0, sun_azimuth_deg=180.0, terrain_z=None,
             out_blend="/tmp/solar_array.blend", out_render="/tmp/solar_array.png", render=True)
    d.update(cfg)
    return d

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def make_material(name, rgba, metallic=0.0, rough=0.5):
    m = bpy.data.materials.new(name)
    if not m.use_nodes:
        m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = rgba
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    return m

def main():
    c = p()
    reset()
    tilt = math.radians(c["tilt_deg"])

    panel_mat = make_material("PV_Glass", (0.02, 0.03, 0.08, 1.0), metallic=0.1, rough=0.15)
    frame_mat = make_material("Rack_Steel", (0.35, 0.35, 0.38, 1.0), metallic=0.9, rough=0.4)
    ground_mat = make_material("Ground", (0.18, 0.28, 0.12, 1.0), rough=0.9)

    # Table dimensions: modules_per_row across (X), modules_high up the slope (rack length).
    tbl_w = c["modules_per_row"] * (c["module_w"] + c["gap"]) - c["gap"]
    rack_len = c["modules_high"] * (c["module_h"] + c["gap"]) - c["gap"]   # along-slope length
    depth = rack_len * math.cos(tilt)      # horizontal footprint of a table
    height = rack_len * math.sin(tilt)     # vertical rise of a table

    total_depth = (c["rows"] - 1) * c["row_pitch"] + depth
    gcr = (c["rows"] * rack_len) / total_depth if total_depth else 0.0

    # Ground plane sized to the array + margin.
    margin = 8.0
    gx = tbl_w + 2 * margin
    gy = total_depth + 2 * margin
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, total_depth / 2 - depth / 2, 0))
    g = bpy.context.active_object; g.scale = (gx, gy, 1); g.name = "Ground"
    g.data.materials.append(ground_mat)

    for r in range(c["rows"]):
        y0 = r * c["row_pitch"]
        # Panel table as a thin box, tilted about its front (south) edge, facing south (-Y down-tilt).
        bpy.ops.mesh.primitive_cube_add(size=1)
        panel = bpy.context.active_object
        panel.scale = (tbl_w / 2, rack_len / 2, 0.02)
        # rotate about X so the table tilts up toward the back (north); front edge low.
        panel.rotation_euler = (tilt, 0, 0)
        panel.location = (0, y0 + depth / 2, c["clearance"] + height / 2)
        panel.name = f"PV_Table_{r:02d}"
        panel.data.materials.append(panel_mat)
        bpy.ops.object.shade_flat()
        # Simple rack legs (front + back posts).
        for (ly, lz) in ((y0, c["clearance"]), (y0 + depth, c["clearance"] + height)):
            bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=max(0.1, lz), location=(0, ly, lz / 2))
            leg = bpy.context.active_object; leg.name = f"Leg_{r:02d}"
            leg.data.materials.append(frame_mat)

    # Sun for inter-row shadow inspection.
    alt = math.radians(c["sun_altitude_deg"]); az = math.radians(c["sun_azimuth_deg"])
    sd = bpy.data.lights.new("Sun", type="SUN"); sd.energy = 3.0; sd.angle = math.radians(0.53)
    sun = bpy.data.objects.new("Sun", sd); bpy.context.collection.objects.link(sun)
    # Point the sun FROM the given altitude/azimuth (azimuth 180=south). Rotation aims -Z along the ray.
    sun.rotation_euler = (math.radians(90) - alt, 0, math.radians(180) - az)

    # Camera: oblique view of the array.
    cam_d = bpy.data.cameras.new("Cam"); cam = bpy.data.objects.new("Cam", cam_d)
    bpy.context.collection.objects.link(cam)
    cam.location = (tbl_w * 0.9, -total_depth * 0.4, max(6.0, total_depth * 0.5))
    con = cam.constraints.new(type="TRACK_TO");
    tgt = bpy.data.objects.new("Aim", None); bpy.context.collection.objects.link(tgt)
    tgt.location = (0, total_depth / 2, 1.0); con.target = tgt
    bpy.context.scene.camera = cam

    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items} else "CYCLES"
    sc.render.resolution_x, sc.render.resolution_y = 1600, 900
    sc.render.filepath = c["out_render"]

    bpy.ops.wm.save_as_mainfile(filepath=c["out_blend"])
    report = {"rows": c["rows"], "modules_total": c["rows"] * c["modules_per_row"] * c["modules_high"],
              "table_width_m": round(tbl_w, 2), "table_depth_m": round(depth, 2),
              "row_pitch_m": c["row_pitch"], "total_depth_m": round(total_depth, 2),
              "gcr": round(gcr, 3), "array_footprint_m2": round(gx * gy, 1),
              "blend": c["out_blend"]}
    if c.get("render"):
        try:
            bpy.ops.render.render(write_still=True); report["render"] = c["out_render"]
        except Exception as e:
            report["render_error"] = str(e)
    print("SOLAR_ARRAY_REPORT " + json.dumps(report))

main()
