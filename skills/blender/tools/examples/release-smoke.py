"""Blender 5.3 release gate: API, native Gaussian PLY, OptiX render, save/reopen.

Run with blender-job.js submit tools/examples/release-smoke.py --name release-53.
Requires a GPU unless BLENDER_JOB_CPU=1; writes report.json, smoke.png and smoke.blend.
"""
import json
import os
from pathlib import Path

import bpy
import OpenEXR
import opentimelineio

assert bpy.app.version[:2] == (5, 3), bpy.app.version_string
out = Path(os.environ.get("BLENDER_JOB_DIR", os.getcwd()))
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
report = {"version": bpy.app.version_string, "binary": bpy.app.binary_path,
          "OpenEXR": OpenEXR.__version__, "opentimelineio": getattr(opentimelineio, "__version__", "bundled")}
image = bpy.data.images.new("data-probe", width=1, height=1)
image.colorspace_settings.interop_id = "data"
assert image.colorspace_settings.interop_id == "data"
report["colour_interop"] = True

# The importer must recognise Gaussian attributes, not merely import a mesh PLY.
ply = out / "splat.ply"
properties = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2",
              "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
ply.write_text("ply\nformat ascii 1.0\nelement vertex 1\n" +
               "".join(f"property float {p}\n" for p in properties) +
               "end_header\n0 0 1 0 0 0 1 0 0 4 -1 -1 -1 1 0 0 0\n")
bpy.ops.wm.ply_import(filepath=str(ply))
splat = bpy.context.object
assert splat.type == "POINTCLOUD", splat.type
report["splat_attributes"] = sorted(a.name for a in splat.data.attributes)
assert {"scale", "rotation", "radiance:base"}.issubset(report["splat_attributes"])
report["pointcloud_type"] = splat.data.type
report["splat_points"] = len(splat.data.points)
assert report["splat_points"] == 1

mat = bpy.data.materials.new("dispersion-probe")
principled = mat.node_tree.nodes.get("Principled BSDF")
report["dispersion_sockets"] = [s.name for s in principled.inputs if "Dispersion" in s.name]
assert report["dispersion_sockets"], [s.name for s in principled.inputs]
report["rotation_conversion"] = hasattr(splat, "convert_rotation_mode")
assert report["rotation_conversion"]

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 8
scene.cycles.use_denoising = False
prefs = bpy.context.preferences.addons["cycles"].preferences
report["backend"] = "CPU"
if os.environ.get("BLENDER_JOB_CPU") != "1":
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
            prefs.refresh_devices()
            devices = [d for d in prefs.devices if d.type == kind]
            if devices:
                for d in prefs.devices:
                    d.use = d.type == kind
                scene.cycles.device = "GPU"
                report["backend"] = kind
                report["devices"] = [d.name for d in devices]
                break
        except (TypeError, RuntimeError) as error:
            print("Device probe", kind, str(error))
    assert report["backend"] != "CPU", "No GPU found; refusing a silent CPU fallback"

bpy.ops.mesh.primitive_cube_add(size=0.5, location=(0.8, 0, 0.25))
bpy.context.object.data.materials.append(mat)
bpy.ops.mesh.primitive_plane_add(size=6)
bpy.ops.object.camera_add(location=(3, -5, 2.5))
camera = bpy.context.object
from mathutils import Vector
camera.rotation_euler = (Vector((0, 0, 0.7)) - camera.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = camera
bpy.ops.object.light_add(type="AREA", location=(1, -2, 4))
bpy.context.object.data.energy = 500
scene.render.resolution_x = 320
scene.render.resolution_y = 240
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(out / "smoke.png")
bpy.ops.render.render(write_still=True)
assert (out / "smoke.png").stat().st_size > 100
bpy.ops.wm.save_as_mainfile(filepath=str(out / "smoke.blend"))
bpy.ops.wm.open_mainfile(filepath=str(out / "smoke.blend"))
assert any(obj.type == "POINTCLOUD" for obj in bpy.data.objects)
report["save_reopen"] = True
report["render"] = "smoke.png"
(out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
print("BLENDER_RELEASE_SMOKE_OK", json.dumps(report))
