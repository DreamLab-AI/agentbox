import unittest

import numpy as np

from agentbox_video import relay

H = W = 24


def source(n):
    f = np.zeros((n, H, W, 3), np.float32)
    for i in range(n):
        f[i] = (i + 1) / 1000.0  # frame i has unique value
    m = np.zeros((n, H, W), np.float32)
    m[:, 8:12, 8:12] = 1.0  # subject region
    f[:, 8:12, 8:12] = 0.9   # subject pixels
    return f, m


class RelayTests(unittest.TestCase):
    def test_plan_tiles_exactly(self):
        for total in (1, 21, 22, 23, 39, 40, 100):
            ws = relay.plan_windows(total)
            self.assertEqual(sum(w["src_end"] - w["src_start"] for w in ws), total)
            self.assertEqual(ws[0]["anchor"], 0)
            self.assertTrue(all(w["anchor"] == 5 for w in ws[1:]))
            for a, b in zip(ws, ws[1:]):
                self.assertEqual(a["src_end"], b["src_start"])

    def test_window_lengths(self):
        f, m = source(60)
        ws = relay.plan_windows(60)
        rendered = np.full((22, H, W, 3), 0.5, np.float32)
        fr, mk, info = relay.build_window(f, m, ws[0])
        self.assertEqual((fr.shape[0], mk.shape[0]), (22, 22))
        fr, mk, info = relay.build_window(f, m, ws[1], rendered)
        self.assertEqual((fr.shape[0], mk.shape[0]), (22, 22))

    def test_anchor_comes_only_from_previous_render(self):
        f, m = source(60)
        ws = relay.plan_windows(60)
        rendered = np.random.default_rng(1).random((22, H, W, 3)).astype(np.float32)
        fr, mk, _ = relay.build_window(f, m, ws[1], rendered)
        np.testing.assert_array_equal(fr[:5], rendered[-5:])
        self.assertFalse(mk[:5].any())
        # subject pixels (0.9) are absent from the anchor unless the render had them
        self.assertFalse(np.any(fr[:5, 8:12, 8:12] == 0.9))
        # new region: subject area blanked, background is source
        self.assertTrue(np.all(fr[5:, 8:12, 8:12] == 0.5))
        self.assertAlmostEqual(float(fr[5, 0, 0, 0]), (ws[1]["src_start"] + 1) / 1000.0, places=6)

    def test_continuation_requires_previous_render(self):
        f, m = source(60)
        ws = relay.plan_windows(60)
        with self.assertRaises(ValueError):
            relay.build_window(f, m, ws[1], None)
        with self.assertRaises(ValueError):
            relay.build_window(f, m, ws[1], np.zeros((3, H, W, 3), np.float32))

    def test_union_mask_over_window(self):
        m = np.zeros((6, H, W), np.float32)
        m[0, 2:4, 2:4] = 1
        m[5, 20:22, 20:22] = 1
        u = relay.union_mask(m)
        self.assertEqual(int(u.sum()), 8)
        self.assertEqual((u[2, 2], u[20, 20], u[10, 10]), (1, 1, 0))

    def test_dilation_grows_union(self):
        m = np.zeros((2, H, W), np.float32)
        m[0, 10, 10] = 1
        self.assertEqual(int(relay.union_mask(m, 0).sum()), 1)
        d = relay.union_mask(m, 2)
        self.assertGreater(int(d.sum()), 9)
        self.assertEqual(d[10, 12], 1)
        self.assertEqual(d[10, 14], 0)

    def test_tail_padding_and_delivery(self):
        f, m = source(30)
        ws = relay.plan_windows(30)
        self.assertEqual([w["pad"] for w in ws], [0, 9])
        rendered = np.zeros((22, H, W, 3), np.float32)
        fr, mk, info = relay.build_window(f, m, ws[1], rendered)
        self.assertEqual(fr.shape[0], 22)
        self.assertEqual(info["deliver"], 8)

    def test_mismatched_inputs_rejected(self):
        f, m = source(30)
        with self.assertRaises(ValueError):
            relay.build_window(f, m[:-1], relay.plan_windows(30)[0])


if __name__ == "__main__":
    unittest.main()
