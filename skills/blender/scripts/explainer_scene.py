"""Run with blender --background --factory-startup --python this.py -- OUTPUT.
Creates an editable, deterministic three-stage architecture animation.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output')
parser.add_argument('labels', nargs='*')
parser.add_argument('--duration', type=float, default=3.0)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
if not math.isfinite(args.duration) or not 1 <= args.duration <= 60:
    parser.error('--duration must be between 1 and 60 seconds')
labels = args.labels or ['Repository', 'Agent', 'Local tools']
if len(labels) != 3:
    parser.error('Supply exactly three labels')
out = Path(args.output).resolve()
out.mkdir(parents=True, exist_ok=False)
frames = round(args.duration * 24)
scene = bpy.context.scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.render.resolution_x, scene.render.resolution_y = 960, 540
scene.render.resolution_percentage = 100
scene.render.fps = 24
scene.frame_start, scene.frame_end = 1, frames
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(out / 'frame-')
scene.world.color = (0.035, 0.035, 0.05)

# Prefer one CUDA device; avoid consuming every shared GPU.
prefs = bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type = 'CUDA'
    prefs.refresh_devices()
    devices = [d for d in prefs.devices if d.type == 'CUDA']
    for d in prefs.devices:
        d.use = bool(devices and d == devices[0])
    if devices:
        scene.cycles.device = 'GPU'
except (TypeError, RuntimeError):
    scene.cycles.device = 'CPU'


def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = 0.32
    bsdf.inputs['Metallic'].default_value = 0.3
    return mat

blue = material('teal', (0.05, 0.48, 0.65))
white = material('type', (0.9, 0.95, 1.0))
floor = material('navy', (0.018, 0.029, 0.06))
for i, label in enumerate(labels):
    x = (i - 1) * 3.5
    bpy.ops.mesh.primitive_cube_add(size=2, location=(x, 0, 0.8))
    cube = bpy.context.object
    cube.name = label
    cube.scale = (1.3, 0.7, 0.7)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    cube.data.materials.append(blue)
    bevel = cube.modifiers.new('Soft edges', 'BEVEL')
    bevel.width, bevel.segments = 0.15, 4
    for frame, z in [(1, 0.2), (1 + i * 18, 0.2), (18 + i * 18, 0.8)]:
        cube.location.z = z
        cube.keyframe_insert(data_path='location', frame=1 + round((frame - 1) * (frames - 1) / 71))
    bpy.ops.object.text_add(location=(x, -0.76, 0.78), rotation=(math.pi / 2, 0, 0))
    text = bpy.context.object
    text.data.body = label
    text.data.align_x = 'CENTER'
    text.data.align_y = 'CENTER'
    text.data.size = min(0.4, 2.3 / max(1, len(label)) * 1.5)
    text.data.extrude = 0.002
    text.data.materials.append(white)

bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.55))
bpy.context.object.data.materials.append(floor)
bpy.ops.object.light_add(type='AREA', location=(1, -3, 7))
bpy.context.object.data.energy = 1700
bpy.context.object.data.shape = 'DISK'
bpy.context.object.data.size = 8
bpy.ops.object.camera_add(location=(0, -14, 7))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 0, 0.5)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type, camera.data.ortho_scale = 'ORTHO', 12.5
scene.camera = camera
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'scene.blend'))
(out / 'shot.json').write_text(json.dumps({
    'fps': 24, 'frame_start': 1, 'frame_end': frames, 'width': 960, 'height': 540,
    'labels': labels, 'camera': list(camera.location), 'scene': 'scene.blend',
    'frames': 'frame-%04d.png', 'purpose': 'deterministic architecture animation',
}, indent=2) + '\n')
bpy.ops.render.render(animation=True)
