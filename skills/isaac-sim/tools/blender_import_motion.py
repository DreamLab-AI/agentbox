"""Import an isaac-motion-export/1 directory into Blender, bake it, and verify the bake. Run via blender-job.js.

    blender-job.js submit blender_import_motion.py -- <export_dir_as_seen_by_blender> [--fps 25] [--tol-pos 1e-5] [--tol-rot 1e-4]

Mapping (documented, fixed): each body becomes an Empty named by its stable id in collection
"SimMotion", world-space, flat (the sim parent is kept as custom property `sim_parent`). Sample
time t seconds maps to Blender frame t * fps as a FLOAT frame, so a sample off the frame grid is
keyed at its exact subframe and nothing is rounded. fps only labels the scene clock; the physics
timeline is not resampled. Rotation is keyed as quaternion w,x,y,z, identical to the contract.

Verification (units: metres, radians; tolerances declared before the check and written to the report):
  1. every sample, including intermediate ones, evaluated through the depsgraph at its own frame;
  2. position error  = Euclid distance vs the float64 sample, tolerance --tol-pos;
  3. rotation error  = angle of q_blender * q_sample^-1 (sign-invariant, atan2 form), tolerance --tol-rot;
  4. two cameras at identical sample times produce identical body world matrices.
Writes BLENDER_JOB_DIR/motion_bridge_report.json and exits non-zero on any violation.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

def main():
    global argv, export_dir
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    export_dir = argv[0]
    opt = dict(zip(argv[1::2], argv[2::2]))
    FPS = float(opt.get("--fps", 25))
    TOL_POS = float(opt.get("--tol-pos", 1e-5))
    TOL_ROT = float(opt.get("--tol-rot", 1e-4))
    out_dir = os.environ.get("BLENDER_JOB_DIR", ".")

    with open(os.path.join(export_dir, "motion.json")) as fh:
        header = json.load(fh)
    with open(os.path.join(export_dir, "states.jsonl")) as fh:
        states = [json.loads(line) for line in fh if line.strip()]

    scene = bpy.context.scene
    scene.render.fps = int(FPS)
    scene.render.fps_base = 1.0
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    col = bpy.data.collections.new("SimMotion")
    scene.collection.children.link(col)

    objs = {}
    for b in header["bodies"]:
        o = bpy.data.objects.new(b["id"], None)
        o.empty_display_type = "SPHERE"
        o.empty_display_size = 0.05
        o.rotation_mode = "QUATERNION"
        o["sim_parent"] = b.get("parent") or ""
        o["mass_estimated"] = bool(b["mass_estimated"])
        col.objects.link(o)
        objs[b["id"]] = o

    for s in states:
        frame = s["t"] * FPS
        for bid, st in s["bodies"].items():
            o = objs[bid]
            o.location = Vector(st["p"])
            o.rotation_quaternion = Quaternion(st["q"])  # w, x, y, z
            o.keyframe_insert("location", frame=frame)
            o.keyframe_insert("rotation_quaternion", frame=frame)


    def fcurves(action):
        """F-curves across Blender versions: layered actions (4.4+/5.x) or the legacy flat list."""
        if hasattr(action, "layers"):
            return [fc for ly in action.layers for st in ly.strips for cb in st.channelbags for fc in cb.fcurves]
        return list(action.fcurves)


    keyed = {bid for s in states for bid in s["bodies"]}
    for b in header["bodies"]:
        o = objs[b["id"]]
        if b["id"] not in keyed:  # never sampled (e.g. a fixed anchor): hold its declared rest pose
            o.location = Vector(b["rest"]["p"])
            o.rotation_quaternion = Quaternion(b["rest"]["q"])
            continue
        for fc in fcurves(o.animation_data.action):  # linear between samples: no easing is invented
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"

    cams = []
    for i, x in enumerate((-4.0, 4.0)):
        cam = bpy.data.objects.new(f"cam{i}", bpy.data.cameras.new(f"cam{i}"))
        cam.location = (x, -6.0, 3.0)
        col.objects.link(cam)
        cams.append(cam)


    def world_state(frame):
        f = math.floor(frame)
        scene.frame_set(f, subframe=frame - f)
        dg = bpy.context.evaluated_depsgraph_get()
        return {k: o.evaluated_get(dg).matrix_world.copy() for k, o in objs.items()}


    worst_pos = worst_rot = 0.0
    camera_mismatch = 0.0
    for n, s in enumerate(states):
        frame = s["t"] * FPS
        scene.camera = cams[0]
        a = world_state(frame)
        if n % max(1, len(states) // 10) == 0:  # camera independence on a spread of times
            scene.camera = cams[1]
            b = world_state(frame)
            for k in a:
                camera_mismatch = max(camera_mismatch, max(abs(a[k][r][c] - b[k][r][c]) for r in range(4) for c in range(4)))
        for bid, st in s["bodies"].items():
            m = a[bid]
            t3 = m.to_translation()  # compare against the raw float64 sample, not a float32 copy of it
            worst_pos = max(worst_pos, math.sqrt(sum((t3[i] - st["p"][i]) ** 2 for i in range(3))))
            dq = m.to_quaternion() @ Quaternion(st["q"]).inverted()
            # atan2 form: acos(w) quantises to ~1e-3 rad near identity in float32.
            worst_rot = max(worst_rot, 2.0 * math.atan2(math.sqrt(dq.x ** 2 + dq.y ** 2 + dq.z ** 2), abs(dq.w)))

    report = {
        "export": export_dir, "samples": len(states), "scene_fps": FPS, "frame_mapping": "frame = t * fps (float, no rounding)",
        "tolerances": {"position_m": TOL_POS, "rotation_rad": TOL_ROT},
        "worst": {"position_m": worst_pos, "rotation_rad": worst_rot, "camera_world_matrix_delta": camera_mismatch},
        "time": header["time"], "conventions": header["scene"], "blender": bpy.app.version_string,
    }
    report["pass"] = worst_pos <= TOL_POS and worst_rot <= TOL_ROT and camera_mismatch == 0.0
    with open(os.path.join(out_dir, "motion_bridge_report.json"), "w") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, "motion_bridge.blend"))
    raise SystemExit(0 if report["pass"] else 3)


try:
    main()
except SystemExit:
    raise
except BaseException:
    import traceback
    traceback.print_exc()
    os._exit(2)  # background Blender exits 0 after a Python exception; make the failure visible
