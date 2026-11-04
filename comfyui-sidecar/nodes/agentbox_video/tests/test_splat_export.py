import hashlib
import os
import tempfile
import unittest
from pathlib import Path

from agentbox_video import splat_export


class SplatExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "output"
        self.dataset = self.root / "village"
        (self.dataset / "images").mkdir(parents=True)
        (self.dataset / "sparse" / "0").mkdir(parents=True)
        (self.dataset / "cache").mkdir()
        (self.dataset / "images" / "cam0_0000.png").write_bytes(b"png-bytes")
        (self.dataset / "sparse" / "0" / "cameras.bin").write_bytes(b"\x00\x01")
        (self.dataset / "cache" / "big.npy").write_bytes(b"not exported")

    def test_lists_included_folders_with_hashes(self):
        rel, entries = splat_export.dataset_files(self.root, str(self.dataset))
        self.assertEqual(rel, "village")
        by_path = {e["path"]: e for e in entries}
        self.assertEqual(set(by_path), {"images/cam0_0000.png", "sparse/0/cameras.bin"})
        image = by_path["images/cam0_0000.png"]
        self.assertEqual(image["subfolder"], "village/images")
        self.assertEqual(image["filename"], "cam0_0000.png")
        self.assertEqual(image["type"], "output")
        self.assertEqual(image["sha256"], hashlib.sha256(b"png-bytes").hexdigest())
        self.assertEqual(image["bytes"], 9)

    def test_relative_model_dir_and_manifest(self):
        rel, entries = splat_export.dataset_files(self.root, "village", "sparse")
        doc = splat_export.manifest(rel, entries)
        self.assertEqual(doc["schema"], splat_export.SCHEMA)
        self.assertEqual(doc["files"], 1)
        self.assertEqual(doc["entries"][0]["path"], "sparse/0/cameras.bin")

    def test_refuses_escape_and_root(self):
        outside = Path(self.tmp.name) / "elsewhere"
        outside.mkdir()
        for bad in (str(outside), "../elsewhere", str(self.root), "."):
            with self.assertRaises(ValueError):
                splat_export.dataset_files(self.root, bad)

    def test_refuses_bad_include_and_empty_dataset(self):
        for include in ("../x", "images/sub", "", " , "):
            with self.assertRaises(ValueError):
                splat_export.dataset_files(self.root, "village", include)
        with self.assertRaises(ValueError):
            splat_export.dataset_files(self.root, "village", "missing")

    def test_refuses_symlink_out_of_root(self):
        secret = Path(self.tmp.name) / "secret.txt"
        secret.write_text("x")
        os.symlink(secret, self.dataset / "images" / "leak.png")
        with self.assertRaises(ValueError):
            splat_export.dataset_files(self.root, "village")


if __name__ == "__main__":
    unittest.main()
