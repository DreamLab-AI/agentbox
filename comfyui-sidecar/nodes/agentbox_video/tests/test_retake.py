import json
import unittest

import numpy as np

from agentbox_video import retake


class RetakeTests(unittest.TestCase):
    def test_interior(self):
        p = retake.plan_retake(100, 40, 50)
        self.assertEqual(p, {"schema": "retake-plan/1", "clip_frames": 100, "retake": [40, 50], "pre_roll": 4,
                             "post_roll": 4, "generation": [36, 54], "overlap_frames": 4, "clamped": False})

    def test_clamped_start_and_end(self):
        p = retake.plan_retake(100, 2, 10)
        self.assertEqual((p["generation"], p["pre_roll"], p["clamped"]), ([0, 14], 2, True))
        p = retake.plan_retake(100, 90, 99, 6, 6)
        self.assertEqual((p["generation"], p["post_roll"], p["clamped"]), ([84, 100], 1, True))

    def test_exact_edge_not_clamped(self):
        self.assertFalse(retake.plan_retake(100, 4, 10)["clamped"])
        self.assertFalse(retake.plan_retake(100, 90, 96)["clamped"])

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
        self.assertEqual(json.loads(json.dumps(plan))["schema"], "retake-plan/1")


if __name__ == "__main__":
    unittest.main()
