"""isaac-motion-export/1: writer, validator and analytic references (stdlib only).

One directory per export:

  motion.json     header: scene conventions, time model, bodies, joints, provenance
  states.jsonl    one line per sample: {"step","t","bodies":{id:{p,q,v,w}},"joints":{id:{pos,vel,effort}}}
  contacts.jsonl  one line per contact event: {"step","t","a","b","impulse","force"}

Conventions are fixed by the contract, not inferred: right-handed, Z up, SI metres,
quaternions w-x-y-z. A producer that converts from anything else lists each conversion
in provenance.conversions. Simulation time is never the delivery clock; `delivery_fps`
is advisory metadata for a downstream retimer.
"""
import json
import math
import os

SCHEMA = "isaac-motion-export/1"
GRAVITY = 9.81
UNAVAILABLE_DEFAULT = ["contacts.force", "joints.effort"]


class ContractError(ValueError):
    pass


def write(out_dir, header, states, contacts=()):
    """Write an export. `states` and `contacts` are iterables of dicts. Returns the header."""
    os.makedirs(out_dir, exist_ok=True)
    header = dict(header, schema=SCHEMA)
    header.setdefault("scene", {})
    header["scene"].update(up_axis="Z", handedness="right", quaternion_order="wxyz", meters_per_unit=1.0)
    with open(os.path.join(out_dir, "states.jsonl"), "w") as fh:
        n = 0
        for s in states:
            fh.write(json.dumps(s, separators=(",", ":")) + "\n")
            n += 1
    with open(os.path.join(out_dir, "contacts.jsonl"), "w") as fh:
        for c in contacts:
            fh.write(json.dumps(c, separators=(",", ":")) + "\n")
    header["sample_count"] = n
    with open(os.path.join(out_dir, "motion.json"), "w") as fh:
        json.dump(header, fh, indent=2)
    return header


def _lines(path):
    with open(path) as fh:
        return [json.loads(line) for line in fh if line.strip()]


def load(out_dir):
    with open(os.path.join(out_dir, "motion.json")) as fh:
        header = json.load(fh)
    return header, _lines(os.path.join(out_dir, "states.jsonl")), _lines(os.path.join(out_dir, "contacts.jsonl"))


def validate(out_dir):
    """Raise ContractError on the first violation; return (header, states, contacts)."""
    header, states, contacts = load(out_dir)
    if header.get("schema") != SCHEMA:
        raise ContractError(f"schema must be {SCHEMA}")
    scene = header.get("scene", {})
    for key, want in (("up_axis", "Z"), ("handedness", "right"), ("quaternion_order", "wxyz"), ("meters_per_unit", 1.0)):
        if scene.get(key) != want:
            raise ContractError(f"scene.{key} must be {want!r}, got {scene.get(key)!r}")
    t = header.get("time", {})
    for key in ("solver_dt", "substeps", "sample_dt"):
        if not isinstance(t.get(key), (int, float)) or t[key] <= 0:
            raise ContractError(f"time.{key} must be a positive number")
    ids = {b["id"] for b in header.get("bodies", [])}
    if not ids:
        raise ContractError("no bodies declared")
    for j in header.get("joints", []):
        if j["parent"] not in ids or j["child"] not in ids:
            raise ContractError(f"joint {j['id']} references an undeclared body")
        if j.get("limits") is None:
            raise ContractError(f"joint {j['id']} must declare limits (use null bounds explicitly via [null,null])")
    for b in header["bodies"]:
        if "mass" not in b or "mass_estimated" not in b:
            raise ContractError(f"body {b['id']} must declare mass and mass_estimated")
    if not states or len(states) != header.get("sample_count"):
        raise ContractError("sample_count does not match states.jsonl")
    last_t = -math.inf
    for s in states:
        if s["t"] <= last_t:
            raise ContractError("state timestamps must strictly increase")
        last_t = s["t"]
        for bid, st in s["bodies"].items():
            if bid not in ids:
                raise ContractError(f"state references undeclared body {bid}")
            if abs(math.sqrt(sum(c * c for c in st["q"])) - 1.0) > 1e-4:
                raise ContractError(f"non-unit quaternion for {bid} at t={s['t']}")
    return header, states, contacts


# ── analytic references (used by smoke checks and by the Blender bridge test) ──
def free_fall_z(z0, t, g=GRAVITY, v0=0.0):
    return z0 + v0 * t - 0.5 * g * t * t


def discrete_fall_z(z0, n, dt, g=GRAVITY, variant="semi_implicit"):
    """Free fall after n fixed steps of a symplectic Euler integrator.

    semi_implicit (v then x): z0 - g dt^2 n(n+1)/2;  explicit (x then v): z0 - g dt^2 n(n-1)/2.
    Both differ from the continuous z0 - g t^2/2 by about g dt t / 2 (about 12 mm at 0.62 s, 240 Hz),
    so a solver must be judged against the discrete form it actually implements.
    """
    k = n * (n + 1) if variant == "semi_implicit" else n * (n - 1)
    return z0 - g * dt * dt * k / 2.0


def reference_free_fall(out_dir, z0=2.0, duration=0.5, solver_dt=1 / 240.0, sample_dt=1 / 60.0):
    """Analytic free fall in the contract format. Labelled so it is never mistaken for a simulation."""
    n = int(round(duration / sample_dt))
    states = [{"step": i, "t": i * sample_dt,
               "bodies": {"box": {"p": [0.0, 0.0, free_fall_z(z0, i * sample_dt)], "q": [1.0, 0.0, 0.0, 0.0],
                                  "v": [0.0, 0.0, -GRAVITY * i * sample_dt], "w": [0.0, 0.0, 0.0]}},
               "joints": {}} for i in range(n + 1)]
    header = {"time": {"solver_dt": solver_dt, "substeps": 1, "sample_dt": sample_dt, "delivery_fps": None},
              "bodies": [{"id": "box", "parent": None, "rest": {"p": [0, 0, z0], "q": [1, 0, 0, 0]},
                          "mass": 1.0, "mass_estimated": True, "collision": "box 0.2m"}],
              "joints": [], "fields_unavailable": UNAVAILABLE_DEFAULT,
              "provenance": {"source": "analytic-reference", "simulated": False, "seed": 0, "conversions": []}}
    return write(out_dir, header, states)


def reference_pendulum(out_dir, length=1.0, theta0=0.5, duration=1.0, sample_dt=1 / 60.0, steps_per_sample=50):
    """Undamped planar pendulum about the world Y axis, integrated with RK4 at a fine step."""
    g, th, om = GRAVITY, theta0, 0.0
    h = sample_dt / steps_per_sample
    f = lambda th_, om_: (om_, -(g / length) * math.sin(th_))
    states = []
    for i in range(int(round(duration / sample_dt)) + 1):
        # Rotation about +Y by th takes the rest offset (0,0,-L) to (-L sin th, 0, -L cos th); pivot at z=2.
        q = [math.cos(th / 2), 0.0, math.sin(th / 2), 0.0]
        states.append({"step": i, "t": i * sample_dt,
                       "bodies": {"bob": {"p": [-length * math.sin(th), 0.0, 2.0 - length * math.cos(th)], "q": q,
                                          "v": [-length * om * math.cos(th), 0.0, length * om * math.sin(th)],
                                          "w": [0.0, om, 0.0]}},
                       "joints": {"hinge": {"pos": th, "vel": om, "effort": None}}})
        for _ in range(steps_per_sample):
            k1 = f(th, om)
            k2 = f(th + h / 2 * k1[0], om + h / 2 * k1[1])
            k3 = f(th + h / 2 * k2[0], om + h / 2 * k2[1])
            k4 = f(th + h * k3[0], om + h * k3[1])
            th += h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])
            om += h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])
    header = {"time": {"solver_dt": h, "substeps": steps_per_sample, "sample_dt": sample_dt, "delivery_fps": None},
              "bodies": [{"id": "anchor", "parent": None, "rest": {"p": [0, 0, 2.0], "q": [1, 0, 0, 0]},
                          "mass": 0.0, "mass_estimated": True, "collision": "none"},
                         {"id": "bob", "parent": "anchor", "rest": {"p": [0, 0, 2.0 - length], "q": [1, 0, 0, 0]},
                          "mass": 1.0, "mass_estimated": True, "collision": "sphere r=0.05m"}],
              "joints": [{"id": "hinge", "type": "revolute", "parent": "anchor", "child": "bob",
                          "axis": [0, 1, 0], "limits": [-1.2, 1.2], "drive": None}],
              "fields_unavailable": UNAVAILABLE_DEFAULT,
              "provenance": {"source": "analytic-reference", "simulated": False, "seed": 0, "conversions": []}}
    return write(out_dir, header, states)
