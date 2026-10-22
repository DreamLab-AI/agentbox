"""Contract tests for isaac-motion-export/1 (stdlib only; no Isaac needed)."""
import importlib.util
import json
import math
import os
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("me", os.path.join(HERE, "..", "..", "isaac-sim-sidecar", "lib", "motion_export.py"))
me = importlib.util.module_from_spec(spec)
spec.loader.exec_module(me)


def rotate_y(q, v):
    w, x, y, z = q
    # q is a pure Y rotation here, so the general formula reduces to the 2D rotation.
    th = 2 * math.atan2(y, w)
    return [v[0] * math.cos(th) + v[2] * math.sin(th), v[1], -v[0] * math.sin(th) + v[2] * math.cos(th)]


class ContractTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_free_fall_reference_validates_and_matches_closed_form(self):
        me.reference_free_fall(self.d)
        header, states, _ = me.validate(self.d)
        for s in states:
            self.assertAlmostEqual(s["bodies"]["box"]["p"][2], 2.0 - 0.5 * 9.81 * s["t"] ** 2, places=9)
        self.assertEqual(header["scene"]["quaternion_order"], "wxyz")
        self.assertIsNone(header["time"]["delivery_fps"])

    def test_pendulum_pose_is_consistent_with_its_own_quaternion_and_conserves_energy(self):
        me.reference_pendulum(self.d, duration=2.0)
        header, states, _ = me.validate(self.d)
        L, g = 1.0, 9.81
        e0 = None
        for s in states:
            b = s["bodies"]["bob"]
            off = rotate_y(b["q"], [0.0, 0.0, -L])
            for got, want in zip(b["p"], [off[0], off[1], 2.0 + off[2]]):
                self.assertAlmostEqual(got, want, places=9)
            e = 0.5 * L * L * s["joints"]["hinge"]["vel"] ** 2 + g * b["p"][2]
            e0 = e if e0 is None else e0
            self.assertAlmostEqual(e, e0, delta=1e-6)
        theta = [s["joints"]["hinge"]["pos"] for s in states]
        lo, hi = header["joints"][0]["limits"]
        self.assertTrue(all(lo <= t <= hi for t in theta))

    def test_discrete_forms_bracket_the_continuous_curve_and_differ_by_g_dt_t_over_2(self):
        z0, dt, n = 2.0, 1 / 240.0, 150
        t = n * dt
        semi = me.discrete_fall_z(z0, n, dt)
        expl = me.discrete_fall_z(z0, n, dt, variant="explicit")
        cont = me.free_fall_z(z0, t)
        self.assertLess(semi, cont)
        self.assertGreater(expl, cont)
        self.assertAlmostEqual(cont - semi, 9.81 * dt * t / 2, delta=9.81 * dt * dt)
        self.assertGreater(cont - semi, 5e-3, "the continuous curve is NOT within 2 mm of the integrator")

    def test_compare_runs_flags_deviation(self):
        import subprocess, sys, shutil
        a, b = os.path.join(self.d, "a"), os.path.join(self.d, "b")
        me.reference_pendulum(a); shutil.copytree(a, b)
        tool = os.path.join(HERE, "..", "..", "skills", "isaac-sim", "tools", "compare_runs.py")
        ok = subprocess.run([sys.executable, "-I", tool, a, b], capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0, ok.stdout)
        self.assertTrue(json.loads(ok.stdout)["bitwise_identical"])
        rows = [json.loads(l) for l in open(os.path.join(b, "states.jsonl"))]
        rows[10]["bodies"]["bob"]["p"][0] += 1e-3
        with open(os.path.join(b, "states.jsonl"), "w") as fh:
            fh.write("\n".join(json.dumps(r) for r in rows) + "\n")
        bad = subprocess.run([sys.executable, "-I", tool, a, b], capture_output=True, text=True)
        self.assertEqual(bad.returncode, 3, bad.stdout)

    def test_non_unit_quaternion_rejected(self):
        me.reference_free_fall(self.d)
        path = os.path.join(self.d, "states.jsonl")
        rows = [json.loads(l) for l in open(path)]
        rows[1]["bodies"]["box"]["q"] = [2, 0, 0, 0]
        open(path, "w").write("\n".join(json.dumps(r) for r in rows) + "\n")
        with self.assertRaises(me.ContractError):
            me.validate(self.d)

    def test_wrong_convention_and_missing_limits_rejected(self):
        me.reference_pendulum(self.d)
        path = os.path.join(self.d, "motion.json")
        h = json.load(open(path))
        h["scene"]["up_axis"] = "Y"
        json.dump(h, open(path, "w"))
        with self.assertRaises(me.ContractError):
            me.validate(self.d)
        h["scene"]["up_axis"] = "Z"
        h["joints"][0]["limits"] = None
        json.dump(h, open(path, "w"))
        with self.assertRaises(me.ContractError):
            me.validate(self.d)


if __name__ == "__main__":
    unittest.main()
