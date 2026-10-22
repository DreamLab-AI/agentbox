"""smoke:fall — asset-independent rigid-body free fall and contact (acceptance gate "Basic dynamics").

Drops a 1 kg cube from z0 onto a ground plane. Records every physics step to isaac-motion-export/1,
then checks free flight against z0 - g t^2 / 2 within a stated tolerance and separately that the
body came to rest on the ground (contact), never fusing the two into one pass/fail.
Required outputs: motion.json states.jsonl contacts.jsonl verification.json
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import motion_export as me  # noqa: E402
import sim_backend as sb  # noqa: E402

Z0, SIZE, DT = 2.0, 0.2, 1.0 / 240.0
# Judged against the DISCRETE closed form of the integrator, not the continuous curve: a symplectic
# Euler step at 240 Hz sits ~12 mm from z0 - g t^2/2 by t = 0.62 s, so the continuous error is
# reported for information only. 1e-3 m covers float32 accumulation over ~150 steps.
FREE_FLIGHT_TOL_M = 1e-3
SETTLE_TOL_M = 5e-3
out = os.environ["ISAAC_JOB_DIR"]

app = sb.start()
world = sb.make_world(DT)
sb.add_ground(world)
box = sb.add_box(world, "/World/box", [0, 0, Z0], SIZE)
world.reset()
# Reset advances the solver during initialisation. Establish the release state
# explicitly after those warm-up steps, before assigning sample time zero.
import numpy as np
box.set_world_pose(position=np.array([0, 0, Z0], dtype=float), orientation=np.array([1, 0, 0, 0], dtype=float))
box.set_linear_velocity(np.zeros(3))
box.set_angular_velocity(np.zeros(3))
states, contacts, was_airborne = [], [], True
previous_vz = None
steps = int(2.0 / DT)
for i in range(steps + 1):
    t = i * DT
    p, q, v, w = sb.pose_and_velocity(box)
    states.append({"step": i, "t": t, "bodies": {"box": {"p": p, "q": q, "v": v, "w": w}}, "joints": {}})
    # Detect the first impact from the measured normal-velocity discontinuity
    # near the floor. A position-only threshold misses bouncing contacts and
    # incorrectly includes later bounces in the free-flight comparison.
    touching = (previous_vz is not None and p[2] <= SIZE / 2 + 0.02
                and abs(v[2] - previous_vz + 9.81 * DT) > 1e-3)
    if touching and was_airborne:
        contacts.append({"step": i, "t": t, "a": "box", "b": "ground", "impulse": None, "force": None,
                         "detection": "normal_velocity_change_near_floor"})
        was_airborne = False
    previous_vz = v[2]
    world.step(render=False)

header = {"time": {"solver_dt": DT, "substeps": 1, "sample_dt": DT, "delivery_fps": None},
          "bodies": [{"id": "box", "parent": None, "rest": {"p": [0, 0, Z0], "q": [1, 0, 0, 0]}, "mass": 1.0,
                      "mass_estimated": True, "collision": f"cube {SIZE} m"}],
          "joints": [], "fields_unavailable": ["contacts.impulse", "contacts.force", "joints.effort"],
          "provenance": {"source": "isaac-sim", "simulated": True, "seed": sb.env_seed(), "conversions": []}}
me.write(out, header, states, contacts)
me.validate(out)

first_contact_t = contacts[0]["t"] if contacts else None
flight = [s for s in states if first_contact_t is None or s["t"] < first_contact_t - 2 * DT]
errs = {v: max(abs(s["bodies"]["box"]["p"][2] - me.discrete_fall_z(Z0, s["step"], DT, variant=v)) for s in flight)
        for v in ("semi_implicit", "explicit")}
variant = min(errs, key=errs.get)
max_err = errs[variant]
continuous_err = max(abs(s["bodies"]["box"]["p"][2] - me.free_fall_z(Z0, s["t"])) for s in flight)
final_z = states[-1]["bodies"]["box"]["p"][2]
verification = {
    "initial_condition": {"position_error_m": abs(states[0]["bodies"]["box"]["p"][2] - Z0),
                          "speed_m_s": float(np.linalg.norm(states[0]["bodies"]["box"]["v"])),
                          "pass": abs(states[0]["bodies"]["box"]["p"][2] - Z0) <= 1e-6
                                  and float(np.linalg.norm(states[0]["bodies"]["box"]["v"])) <= 1e-5},
    "free_flight": {"samples": len(flight), "matched_integrator": variant, "max_abs_error_m": max_err,
                    "error_by_variant_m": errs, "continuous_curve_error_m_informational": continuous_err,
                    "tolerance_m": FREE_FLIGHT_TOL_M,
                    "pass": bool(flight) and max_err <= FREE_FLIGHT_TOL_M},
    "contact": {"first_contact_t": first_contact_t, "final_height_m": final_z, "expected_rest_m": SIZE / 2,
                "tolerance_m": SETTLE_TOL_M, "pass": first_contact_t is not None and abs(final_z - SIZE / 2) <= SETTLE_TOL_M},
}
verification["pass"] = bool(verification["initial_condition"]["pass"] and verification["free_flight"]["pass"] and verification["contact"]["pass"])
with open(os.path.join(out, "verification.json"), "w") as fh:
    json.dump(verification, fh, indent=2)
print(json.dumps(verification))
app.close(exit_code=0 if verification["pass"] else 3)
sys.exit(0 if verification["pass"] else 3)
