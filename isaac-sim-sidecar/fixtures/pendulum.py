"""smoke:articulation — a jointed body that is dynamically simulated, not posed (gate "Articulation").

A revolute pendulum released from rest with explicit mass and joint limits. Passes only if the hinge
angle evolves under gravity (period within tolerance of the small-angle-corrected analytic value),
the limits are never exceeded, and velocities vary continuously (a teleported pose list would not).
Required outputs: motion.json states.jsonl contacts.jsonl verification.json
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import motion_export as me  # noqa: E402
import sim_backend as sb  # noqa: E402

L, THETA0, DT, DURATION = 1.0, 0.5, 1.0 / 240.0, 3.0
LIMITS = (-1.2, 1.2)
PERIOD_TOL = 0.02  # 2 %
out = os.environ["ISAAC_JOB_DIR"]

app = sb.start()
world = sb.make_world(DT)
art, bob_path = sb.build_pendulum(world, L, limits=LIMITS)
bob = sb.rigid_view(world, bob_path, "bob")
world.reset()
import numpy as np
art.set_joint_positions(np.array([THETA0]))   # release from rest at THETA0
art.set_joint_velocities(np.array([0.0]))
states = []
for i in range(int(DURATION / DT) + 1):
    pos = float(art.get_joint_positions()[0])
    vel = float(art.get_joint_velocities()[0])
    try:
        eff = float(art.get_measured_joint_efforts()[0])
    except Exception:
        eff = None
    p, q, lin, ang = sb.pose_and_velocity(bob)   # the bob itself, not the articulation root
    states.append({"step": i, "t": i * DT, "bodies": {"bob": {"p": p, "q": q, "v": lin, "w": ang}},
                   "joints": {"hinge": {"pos": pos, "vel": vel, "effort": eff}}})
    world.step(render=False)

header = {"time": {"solver_dt": DT, "substeps": 1, "sample_dt": DT, "delivery_fps": None},
          "bodies": [{"id": "anchor", "parent": None, "rest": {"p": [0, 0, 2.0], "q": [1, 0, 0, 0]}, "mass": 0.0,
                      "mass_estimated": True, "collision": "none"},
                     {"id": "bob", "parent": "anchor", "rest": {"p": [0, 0, 2.0 - L], "q": [1, 0, 0, 0]}, "mass": 1.0,
                      "mass_estimated": True, "collision": "sphere r=0.05 m"}],
          "joints": [{"id": "hinge", "type": "revolute", "parent": "anchor", "child": "bob", "axis": [0, 1, 0],
                      "limits": list(LIMITS), "drive": None}],
          "fields_unavailable": ["contacts.force"],
          "provenance": {"source": "isaac-sim", "simulated": True, "seed": sb.env_seed(), "conversions": []}}
me.write(out, header, states, [])
me.validate(out)

angles = [s["joints"]["hinge"]["pos"] for s in states]
crossings = [states[i]["t"] for i in range(1, len(angles)) if angles[i - 1] > 0 >= angles[i]]
period = (crossings[1] - crossings[0]) if len(crossings) >= 2 else None
# Exact period of a simple pendulum: T = 4 sqrt(L/g) K(sin(theta0/2)), via the AGM series.
a, b = 1.0, math.cos(THETA0 / 2)
for _ in range(20):
    a, b = (a + b) / 2, math.sqrt(a * b)
expected = 2 * math.pi * math.sqrt(L / 9.81) / a
verification = {
    "dynamics": {"measured_period_s": period, "expected_period_s": expected, "tolerance": PERIOD_TOL,
                 "pass": period is not None and abs(period - expected) / expected <= PERIOD_TOL},
    "limits": {"min_rad": min(angles), "max_rad": max(angles), "limits_rad": list(LIMITS),
               "pass": min(angles) >= LIMITS[0] - 1e-3 and max(angles) <= LIMITS[1] + 1e-3},
    "initial_condition": {"angle_at_step0_rad": angles[0], "expected_rad": THETA0, "tolerance_rad": 1e-3,
                          "pass": abs(angles[0] - THETA0) <= 1e-3},
    "pose_consistency": {  # exported bob position must follow the hinge: x = -L sin(theta), z = pivot - L cos(theta)
        "max_abs_error_m": max(max(abs(s["bodies"]["bob"]["p"][0] + L * math.sin(s["joints"]["hinge"]["pos"])),
                                   abs(s["bodies"]["bob"]["p"][2] - (2.0 - L * math.cos(s["joints"]["hinge"]["pos"]))))
                               for s in states), "tolerance_m": 5e-3, "pass": None},
    "continuity": {"max_abs_dvel": max(abs(states[i]["joints"]["hinge"]["vel"] - states[i - 1]["joints"]["hinge"]["vel"])
                                       for i in range(1, len(states))), "bound": 0.5,
                   "pass": None},
}
verification["pose_consistency"]["pass"] = verification["pose_consistency"]["max_abs_error_m"] <= 5e-3
verification["continuity"]["pass"] = verification["continuity"]["max_abs_dvel"] <= verification["continuity"]["bound"]
verification["pass"] = all(verification[k]["pass"] for k in ("initial_condition", "dynamics", "limits", "pose_consistency", "continuity"))
with open(os.path.join(out, "verification.json"), "w") as fh:
    json.dump(verification, fh, indent=2)
print(json.dumps(verification))
app.close()
sys.exit(0 if verification["pass"] else 3)
