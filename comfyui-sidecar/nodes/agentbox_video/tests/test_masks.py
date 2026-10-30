import unittest

import cv2
import numpy as np

from agentbox_video import masks

H, W = 96, 128


def scene(n, step=(3, 2), size=24, start=(20, 20), seed=0):
    rng = np.random.default_rng(seed)
    bg = rng.integers(0, 256, (H, W), dtype=np.uint8)
    bg = cv2.GaussianBlur(bg, (0, 0), 1.0)
    patch = cv2.GaussianBlur(rng.integers(0, 256, (size, size), dtype=np.uint8), (0, 0), 1.0)
    frames, truth = [], []
    for i in range(n):
        f = bg.copy()
        x, y = start[0] + step[0] * i, start[1] + step[1] * i
        f[y:y + size, x:x + size] = patch
        t = np.zeros((H, W), np.uint8)
        t[y:y + size, x:x + size] = 1
        frames.append(np.dstack([f] * 3))
        truth.append(t)
    return frames, truth


def iou(a, b):
    return (a & b).sum() / max(1, (a | b).sum())


class MaskTests(unittest.TestCase):
    def test_tracks_translation(self):
        frames, truth = scene(10)
        out, log = masks.track_mask(frames, truth[0], return_log=True)
        self.assertEqual(out.shape[0], len(frames))
        for i in range(len(frames)):
            self.assertGreater(iou(out[i], truth[i]), 0.9, f"frame {i}")
        self.assertTrue(all(e["method"] == "lk_affine" for e in log[1:]))

    def test_mask_count_equals_frame_count(self):
        for n in (1, 2, 7):
            frames, truth = scene(n)
            self.assertEqual(len(masks.track_mask(frames, truth[0])), n)

    def test_float_frames_accepted(self):
        frames, truth = scene(5)
        out = masks.track_mask([f.astype(np.float32) / 255 for f in frames], truth[0])
        self.assertGreater(iou(out[4], truth[4]), 0.9)

    def test_median_fallback(self):
        frames, truth = scene(6)
        cfg = masks.TrackerConfig(min_affine_points=10**6)
        out, log = masks.track_mask(frames, truth[0], cfg, return_log=True)
        self.assertTrue(all(e["method"] == "median" for e in log[1:]))
        self.assertGreater(iou(out[5], truth[5]), 0.9)

    def test_template_fallback_tracks(self):
        frames, truth = scene(6)
        cfg = masks.TrackerConfig(min_points=10**6)
        out, log = masks.track_mask(frames, truth[0], cfg, return_log=True)
        self.assertTrue(all(e["method"] == "template" for e in log[1:]))
        self.assertGreater(iou(out[5], truth[5]), 0.9)

    def test_template_floor_fail_closed(self):
        frames, truth = scene(3)
        noise = np.random.default_rng(99).integers(0, 256, frames[1].shape, dtype=np.uint8)
        frames[1] = noise
        cfg = masks.TrackerConfig(min_points=10**6)
        with self.assertRaises(masks.TrackingError):
            masks.track_mask(frames, truth[0], cfg)
        # floor is configuration: the same pair passes with a floor of -1
        masks.track_mask(frames, truth[0], masks.TrackerConfig(min_points=10**6, template_floor=-1.0, area_min=0))

    def test_scale_jump_fail_closed(self):
        frames, truth = scene(2, step=(0, 0))
        big = cv2.warpAffine(frames[0], cv2.getRotationMatrix2D((W / 2, H / 2), 0, 1.15), (W, H))
        with self.assertRaisesRegex(masks.TrackingError, "scale"):
            masks.track_mask([frames[0], big], truth[0])

    def test_large_scale_jump_fail_closed_whatever_the_path(self):
        # 1.3x is beyond what LK measures, so the step falls to median motion, which
        # cannot see scale; the correlation check must still stop it.
        frames, truth = scene(2, step=(0, 0))
        big = cv2.warpAffine(frames[0], cv2.getRotationMatrix2D((W / 2, H / 2), 0, 1.3), (W, H))
        with self.assertRaises(masks.TrackingError):
            masks.track_mask([frames[0], big], truth[0])

    def test_threshold_report_carries_provenance(self):
        rep = masks.threshold_report(masks.TrackerConfig())
        self.assertEqual((rep["calibrated"], rep["provisional"]), (False, True))
        self.assertTrue(rep["provenance"])

    def test_area_blowup_fail_closed(self):
        frames, truth = scene(1, step=(0, 0), size=40, start=(44, 28))
        seq = [frames[0]]
        for k in range(1, 12):
            seq.append(cv2.warpAffine(seq[-1], cv2.getRotationMatrix2D((64, 48), 0, 1.07), (W, H)))
        cfg = masks.TrackerConfig(area_max=0.3)
        with self.assertRaisesRegex(masks.TrackingError, "area"):
            masks.track_mask(seq, truth[0], cfg)

    def test_area_floor_fail_closed(self):
        frames, truth = scene(2)
        with self.assertRaisesRegex(masks.TrackingError, "area"):
            masks.track_mask(frames, truth[0], masks.TrackerConfig(area_min=0.9))

    def test_bad_seed_shape(self):
        frames, _ = scene(2)
        with self.assertRaises(ValueError):
            masks.track_mask(frames, np.zeros((5, 5)))


if __name__ == "__main__":
    unittest.main()
