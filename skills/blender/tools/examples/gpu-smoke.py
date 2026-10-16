"""Smoke test for blender-job.js: build a cube, render it with Cycles on the GPU, write a PNG.

Run:  node tools/blender-job.js submit tools/examples/gpu-smoke.py --name gpu-smoke
Pass /home/devuser/... paths only inside the shared volume. Output: $BLENDER_JOB_DIR/smoke.png
and a device report in the job log. Set BLENDER_JOB_CPU=1 (submit --cpu) to force the CPU.
"""
import os, sys, time
import bpy

t0 = time.time()
job_dir = os.environ.get("BLENDER_JOB_DIR", os.getcwd())
want_cpu = os.environ.get("BLENDER_JOB_CPU") == "1"
print("blender", bpy.app.version_string, "binary", bpy.app.binary_path)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"          # set directly: the enum listing is unreliable on 5.x
cy = sc.cycles
cy.samples = 32
cy.use_denoising = True
prefs = bpy.context.preferences.addons["cycles"].preferences
used = "CPU"
if not want_cpu:
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
            prefs.refresh_devices() if hasattr(prefs, "refresh_devices") else prefs.get_devices()
            devs = [d for d in prefs.devices if d.type == kind]
            if devs:
                for d in prefs.devices: d.use = d.type == kind
                cy.device = "GPU"; used = f"{kind} x{len(devs)} ({devs[0].name})"
                break
        except Exception as e:
            print("device kind", kind, "unavailable:", type(e).__name__)
print("render device:", used)

bpy.ops.mesh.primitive_cube_add(size=1.2, location=(0, 0, 0.6))
cube = bpy.context.active_object
bpy.ops.mesh.primitive_plane_add(size=6)
mat = bpy.data.materials.new("terracotta")
if not mat.use_nodes: mat.use_nodes = True          # deprecated on 5.x; guarded
mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.8, 0.3, 0.2, 1)
cube.data.materials.append(mat)
cam_d = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cam_d); sc.collection.objects.link(cam)
cam.location = (3.2, -3.2, 2.2); cam.rotation_euler = (1.15, 0, 0.785); sc.camera = cam
sun_d = bpy.data.lights.new("s", "SUN"); sun_d.energy = 4; sun = bpy.data.objects.new("s", sun_d)
sun.rotation_euler = (0.9, 0.2, 0.6); sc.collection.objects.link(sun)
sc.render.resolution_x, sc.render.resolution_y = 480, 320
sc.render.filepath = os.path.join(job_dir, "smoke.png")
bpy.ops.render.render(write_still=True)
print("rendered", sc.render.filepath, "in %.1fs" % (time.time() - t0))
