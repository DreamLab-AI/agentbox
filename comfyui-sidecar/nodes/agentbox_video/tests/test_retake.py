import json
import pathlib
import unittest

import numpy as np

from agentbox_video import retake

CASES = pathlib.Path(__file__).with_name("retake_geometry_cases.json")


class RetakeTests(unittest.TestCase):
    def test_interior(self):
        p = retake.plan_retake(100, 40, 50)
        self.assertEqual(p, {"schema": "retake-geometry/1", "frames": 100, "retake": [40, 50],
                             "generation": [36, 54], "pre_requested": 4, "post_requested": 4,
                             "pre_applied": 4, "post_applied": 4, "clamped_head": False,
                             "clamped_tail": False, "overlap": 4})

    def test_shared_cases_match_the_stitch_planner(self):
        for case in json.loads(CASES.read_text())["cases"]:
            args = (case["frames"], *case["retake"], case["pre"], case["post"], case["overlap"])
            with self.subTest(case=case):
                if case["expect"] == "error":
                    with self.assertRaises(ValueError):
                        retake.plan_retake(*args)
                    continue
                p = retake.plan_retake(*args)
                self.assertEqual({k: p[k] for k in case["expect"]}, case["expect"])

    def test_roll_below_four_rejected(self):
        for pre, post in ((3, 4), (4, 3), (0, 0)):
            with self.assertRaises(ValueError):
                retake.plan_retake(100, 40, 50, pre, post)

    def test_bad_interval_rejected(self):
        for a, b in ((10, 10), (11, 10), (-1, 5), (5, 101)):
            with self.assertRaises(ValueError):
                retake.plan_retake(100, a, b)

    def test_prepare_frames_mask_and_json(self):
        frames = np.arange(50, dtype=np.float32).reshape(50, 1, 1, 1) * np.ones((50, 6, 6, 3), np.float32)
        gen, mask, plan = retake.prepare_retake(frames, 20, 30)
        s, e = plan["generation"]
        self.assertEqual(gen.shape[0], e - s)
        np.testing.assert_array_equal(gen, frames[s:e])
        self.assertEqual(mask.shape, (e - s, 6, 6))
        self.assertEqual(mask[:, 0, 0].tolist(), [0.0] * 4 + [1.0] * 10 + [0.0] * 4)
        self.assertEqual(json.loads(json.dumps(plan))["schema"], "retake-geometry/1")


if __name__ == "__main__":
    unittest.main()
