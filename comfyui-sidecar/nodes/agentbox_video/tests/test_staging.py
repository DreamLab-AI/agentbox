import tempfile
import unittest
from pathlib import Path

import numpy as np

from agentbox_video import staging


class StagingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def test_round_trip_latent_and_image(self):
        rng = np.random.default_rng(0)
        for kind, key, shape in (("latent", "latent_tensor", (1, 16, 4, 8, 8)), ("image", "image_tensor", (3, 8, 8, 3))):
            a = rng.random(shape, dtype=np.float32)
            rel, digest = staging.save_arrays(self.base, f"x/{kind}", {key: a}, kind)
            self.assertEqual(digest, staging.sha256_file(self.base / rel))
            got, meta = staging.load_arrays(self.base, rel, digest, kind=kind)
            np.testing.assert_array_equal(got[key], a)
            self.assertEqual(meta["kind"], kind)

    def test_same_content_same_file(self):
        a = np.ones((2, 2, 2, 3), np.float32)
        r1, d1 = staging.save_arrays(self.base, "p", {"image_tensor": a}, "image")
        r2, d2 = staging.save_arrays(self.base, "p", {"image_tensor": a}, "image")
        self.assertEqual((r1, d1), (r2, d2))

    def test_mismatch_refused(self):
        a = np.zeros((1, 4, 4, 3), np.float32)
        rel, digest = staging.save_arrays(self.base, "p", {"image_tensor": a}, "image")
        bad = ("0" if digest[0] != "0" else "1") + digest[1:]
        with self.assertRaises(staging.HashMismatch):
            staging.load_arrays(self.base, rel, bad)

    def test_tampered_file_refused(self):
        a = np.zeros((1, 4, 4, 3), np.float32)
        rel, digest = staging.save_arrays(self.base, "p", {"image_tensor": a}, "image")
        path = self.base / rel
        data = bytearray(path.read_bytes())
        data[-1] ^= 0xFF
        path.write_bytes(bytes(data))
        with self.assertRaises(staging.HashMismatch):
            staging.load_arrays(self.base, rel, digest)

    def test_missing_or_malformed_expected_hash_refused(self):
        a = np.zeros((1, 2, 2, 3), np.float32)
        rel, _ = staging.save_arrays(self.base, "p", {"image_tensor": a}, "image")
        for bad in ("", None, "abc", "z" * 64):
            with self.assertRaises(staging.HashMismatch):
                staging.load_arrays(self.base, rel, bad)

    def test_kind_mismatch_and_path_escape(self):
        a = np.zeros((1, 2, 2, 3), np.float32)
        rel, digest = staging.save_arrays(self.base, "p", {"image_tensor": a}, "image")
        with self.assertRaises(ValueError):
            staging.load_arrays(self.base, rel, digest, kind="latent")
        with self.assertRaises(ValueError):
            staging.load_arrays(self.base, "../outside.safetensors", digest)

    def test_mappings(self):
        self.assertEqual(set(staging.NODE_CLASS_MAPPINGS), set(staging.NODE_DISPLAY_NAME_MAPPINGS))
        self.assertEqual(len(staging.NODE_CLASS_MAPPINGS), 4)


if __name__ == "__main__":
    unittest.main()
