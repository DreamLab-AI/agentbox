"""Rebuildable endpoint/cadence fixture; run via blender-job.js in the sidecar."""
import json
import os
import argparse
import sys
import math
from pathlib import Path

import bpy
from mathutils import Vector

root = Path(os.environ["BLENDER_JOB_DIR"])
parser = argparse.ArgumentParser()
parser.add_argument("--width", type=int, default=608)
parser.add_argument("--height", type=int, default=352)
parser.add_argument("--frames", type=int, default=125)
parser.add_argument("--cues", type=Path)
parser.add_argument("--sequence", action="store_true")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
if min(args.width, args.height, args.frames) <= 0:
    parser.error("dimensions and frame count must be positive")
cues = json.loads(args.cues.read_text()) if args.cues else None
frames = max(args.frames, math.ceil(cues["metadata"]["duration"] * 25)) if cues else args.frames
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 16
scene.cycles.use_denoising = True
if os.environ.get("BLENDER_JOB_CPU") != "1":
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
            prefs.refresh_devices()
            devices = [d for d in prefs.devices if d.type == kind]
            if devices:
                for device in prefs.devices:
                    device.use = device.type == kind
                scene.cycles.device = "GPU"
                print("STOPMOTION_GPU", kind, [d.name for d in devices])
                break
        except Exception as error:
            print("STOPMOTION_DEVICE_UNAVAILABLE", kind, str(error))
scene.render.resolution_x = args.width
scene.render.resolution_y = args.height
scene.render.resolution_percentage = 100
scene.render.fps = 25
scene.render.use_motion_blur = False
scene.frame_start, scene.frame_end = 1, frames
scene.world.color = (0.25, 0.25, 0.25)

def ball(name, location, scale, colour):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, location=location)
    obj = bpy.context.object
    obj.name, obj.scale = name, scale
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*colour, 1)
    mat.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (*colour, 1)
    mat.node_tree.nodes.get("Principled BSDF").inputs["Roughness"].default_value = 0.85
    obj.data.materials.append(mat)
    return obj

ball("Body", (0, 0, 1), (0.48, 0.35, 0.65), (0.1, 0.45, 0.65))
ball("Head", (0, 0, 1.85), (0.42, 0.35, 0.4), (0.8, 0.4, 0.15))
for x in (-0.14, 0.14):
    ball("Eye", (x, -0.32, 1.94), (0.055, 0.035, 0.055), (0.02, 0.02, 0.02))
mouth = ball("Mouth", (0, -0.345, 1.7), (0.13, 0.025, 0.025), (0.05, 0.01, 0.01))
arm = ball("WavingHand", (0.65, 0, 1.25), (0.15, 0.15, 0.3), (0.8, 0.4, 0.15))
schedule = []
for frame in range(1, frames + 1, 2):
    phase = ((frame - 1) // 16) % 2
    arm.location.z = 1.25 + 0.65 * phase
    arm.keyframe_insert(data_path="location", frame=frame)
    if not cues:
        mouth.scale.z = 0.025 if phase == 0 else 0.09
        mouth.keyframe_insert(data_path="scale", frame=frame)
    schedule.append({"frame": frame, "hold_frames": min(2, frames + 1-frame), "phase": phase})
if cues:
    # Rhubarb's timed mouth shapes drive a minimal replacement-shape proxy.
    # Keep speech cues on ones; body animation remains held on twos.
    shapes = {"A": (0.13, 0.018), "B": (0.14, 0.035), "C": (0.15, 0.065),
              "D": (0.14, 0.11), "E": (0.075, 0.08), "F": (0.055, 0.06),
              "G": (0.13, 0.025), "H": (0.11, 0.055), "X": (0.11, 0.012)}
    for cue in cues["mouthCues"]:
        mouth.scale.x, mouth.scale.z = shapes[cue["value"]]
        mouth.keyframe_insert(data_path="scale", frame=1 + math.floor(cue["start"] * 25))
for obj in (arm, mouth):
    action = obj.animation_data.action
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    for key in curve.keyframe_points:
                        key.interpolation = "CONSTANT"
bpy.ops.mesh.primitive_plane_add(size=200)
bpy.ops.object.camera_add(location=(3, -7, 3))
scene.camera = bpy.context.object
scene.camera.rotation_euler = (Vector((0, 0, 1.2)) - scene.camera.location).to_track_quat("-Z", "Y").to_euler()
scene.camera.data.type = "ORTHO"
scene.camera.data.ortho_scale = 4.4
bpy.ops.object.light_add(type="AREA", location=(1, -4, 6))
bpy.context.object.data.energy = 700
bpy.context.object.data.shape = "DISK"
bpy.context.object.data.size = 5
bpy.ops.wm.save_as_mainfile(filepath=str(root / "puppet.blend"))
for frame, name in ((1, "first"), (frames, "last")):
    scene.frame_set(frame)
    scene.render.filepath = str(root / (name + ".png"))
    bpy.ops.render.render(write_still=True)
if args.sequence:
    scene.render.filepath = str(root / "frames" / "frame-")
    (root / "frames").mkdir(exist_ok=True)
    bpy.ops.render.render(animation=True)
(root / "shot.json").write_text(json.dumps({"fps": 25, "frames": frames, "motion_blur": False,
    "width": args.width, "height": args.height, "schedule": schedule,
    "mouth_cues": cues["mouthCues"] if cues else None}, indent=2))
