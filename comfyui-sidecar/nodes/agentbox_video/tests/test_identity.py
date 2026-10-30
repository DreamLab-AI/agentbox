"""Identity scoring tests. Run: cd comfyui-sidecar/nodes && python -m unittest discover -s agentbox_video/tests -t ."""
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path

import numpy as np

from agentbox_video import identity as idn
from agentbox_video.identity import FaceHit, ThresholdSet

MODELS = Path(os.environ.get(
    "AGENTBOX_FACE_MODELS",
    "/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/"
    "8e5ee8e6-393a-4975-8c1f-fd9eb14ce188/scratchpad/face-models"))


def unit(*v):
    a = np.array(v, dtype=np.float32)
    return a / np.linalg.norm(a)


def frame(fid, h=100, w=200):
    f = np.zeros((h, w, 3), np.uint8)
    f[0, 0, 0] = fid
    return f


class FakeEmbedder:
    """Frame id (pixel [0,0,0]) -> list of (box_h, embedding)."""

    def __init__(self, table):
        self.table = table

    def faces(self, bgr):
        return [FaceHit((0.0, 0.0, 10.0, bh), emb) for bh, emb in self.table.get(int(bgr[0, 0, 0]), [])]


REF = unit(1, 0, 0)


class ScoreTests(unittest.TestCase):
    def test_best_of_last_n_ignores_earlier_frames(self):
        e = FakeEmbedder({1: [(50, REF)], 2: [(50, unit(0, 1, 0))], 3: [(50, unit(1, 1, 0))]})
        refs = {"a": [REF]}
        # frame 1 is a perfect match but outside the last 2
        r = idn.identity_score([frame(1), frame(2), frame(3)], refs, e, ThresholdSet(last_n=2))
        self.assertAlmostEqual(r["score"], 0.7071, places=3)
        r3 = idn.identity_score([frame(1), frame(2), frame(3)], refs, e, ThresholdSet(last_n=3))
        self.assertAlmostEqual(r3["score"], 1.0, places=5)

    def test_best_over_all_references(self):
        e = FakeEmbedder({1: [(50, unit(0, 1, 0))]})
        r = idn.identity_score([frame(1)], {"a": [REF], "b": [unit(0, 1, 0)]}, e)
        self.assertEqual(r["per_frame"][0]["cast"], "b")
        self.assertAlmostEqual(r["score"], 1.0, places=5)

    def test_face_below_floor_is_not_judged_never_pass(self):
        # short side 100; floor 12 px; a 11 px face with a perfect match
        e = FakeEmbedder({1: [(11, REF)]})
        r = idn.identity_score([frame(1)], {"a": [REF]}, e)
        self.assertEqual(r["verdict"], "not_judged")
        self.assertIsNone(r["score"])
        self.assertFalse(r["acceptance_backing"])
        e2 = FakeEmbedder({1: [(12, REF)]})
        self.assertEqual(idn.identity_score([frame(1)], {"a": [REF]}, e2)["verdict"], "PASS")

    def test_uncalibrated_pass_is_provisional(self):
        e = FakeEmbedder({1: [(50, REF)]})
        r = idn.identity_score([frame(1)], {"a": [REF]}, e)
        self.assertEqual(r["verdict"], "PASS")
        self.assertTrue(r["provisional"])
        self.assertFalse(r["acceptance_backing"])
        self.assertEqual(r["thresholds"]["provenance"], "kinoloom-ltx-uncalibrated")
        self.assertFalse(r["thresholds"]["calibrated"])
        # A bare calibrated claim is a config assertion, not evidence: refused.
        with self.assertRaises(idn.CalibrationError):
            ThresholdSet(calibrated=True, provenance="x")
        with self.assertRaises(idn.CalibrationError):
            ThresholdSet.from_dict({"calibrated": True, "provenance": "x"})
        import hashlib, tempfile
        with tempfile.TemporaryDirectory() as d:
            record = json.dumps({"schema": "threshold-calibration/1", "tool": "identity",
                                 "provenance": "x"}).encode()
            Path(d, "cal.json").write_bytes(record)
            good = {"path": "cal.json", "sha256": hashlib.sha256(record).hexdigest()}
            th = ThresholdSet.from_dict({"calibrated": True, "provenance": "x", "calibration": good}, base_dir=d)
            cal = idn.identity_score([frame(1)], {"a": [REF]}, e, th)
            self.assertFalse(cal["provisional"])
            self.assertTrue(cal["acceptance_backing"])
            self.assertEqual(cal["thresholds"]["calibration"]["sha256"], good["sha256"])
            for bad in ({**good, "sha256": "0" * 64}, {**good, "path": "../cal.json"}):
                with self.assertRaises(idn.CalibrationError):
                    ThresholdSet.from_dict({"calibrated": True, "provenance": "x", "calibration": bad}, base_dir=d)
            with self.assertRaises(idn.CalibrationError):
                ThresholdSet.from_dict({"calibrated": True, "provenance": "other", "calibration": good}, base_dir=d)
            # A forged "verified" marker in the input is discarded, then re-checked.
            with self.assertRaises(idn.CalibrationError):
                ThresholdSet.from_dict({"calibrated": True, "provenance": "x",
                                        "calibration": {**good, "sha256": "0" * 64, "verified": True}}, base_dir=d)

    def test_fail_routes_to_human_review(self):
        e = FakeEmbedder({1: [(50, unit(0, 1, 0))]})
        r = idn.identity_score([frame(1)], {"a": [REF]}, e)
        self.assertEqual(r["verdict"], "FAIL")
        self.assertEqual(r["route"], "human_review")
        self.assertFalse(r["provisional"])

    def test_no_references_not_judged(self):
        r = idn.identity_score([frame(1)], {}, FakeEmbedder({1: [(50, REF)]}))
        self.assertEqual(r["verdict"], "not_judged")


class DriftTests(unittest.TestCase):
    def test_per_link_mean_and_change(self):
        # frames 0..5; links start at 0 and 3; sampled every frame
        good, poor = REF, unit(1, 1.2, 0)
        table = {i: [(50, good)] for i in range(3)}
        table.update({i: [(50, poor)] for i in range(3, 6)})
        for k in table:
            pass
        frames = [frame(i) for i in range(6)]
        rep = idn.drift_report(frames, [3], {"a": [REF]}, FakeEmbedder(table), every=1)
        l1, l2 = rep["links"]
        self.assertAlmostEqual(l1["a"]["sim"], 1.0, places=3)
        self.assertLess(l2["a"]["sim"], l1["a"]["sim"])
        self.assertEqual(l1["a"]["n"], 3)
        self.assertLess(rep["summary"]["a"]["change"], 0)
        self.assertFalse(rep["gate"])

    def test_small_faces_excluded(self):
        rep = idn.drift_report([frame(0)], [], {"a": [REF]}, FakeEmbedder({0: [(5, REF)]}), every=1)
        self.assertNotIn("a", rep["links"][0])


class OpeningTests(unittest.TestCase):
    def test_keeps_best_and_returns_all_scores(self):
        refs = {"a": [REF], "b": [unit(0, 1, 0)]}
        e = FakeEmbedder({
            0: [(5, REF)],                                   # face under the floor: unscored
            1: [(50, unit(1, 0.2, 0)), (50, unit(0.2, 1, 0))],  # both, good
            2: [(50, unit(1, 1, 0)), (50, unit(1, 1, 0))],      # both, mediocre
        })
        r = idn.choose_opening_frame([frame(0), frame(1), frame(2)], refs, e)
        self.assertEqual(r["chosen"], 1)
        self.assertEqual(len(r["scores"]), 3)
        self.assertFalse(r["weak"])
        self.assertIsNone(r["scores"][0]["likeness"])
        self.assertIsNone(r["scores"][0]["per_cast"]["b"])

    def test_least_alike_person_counts_and_weak_flag(self):
        refs = {"a": [REF], "b": [unit(0, 1, 0)]}
        e = FakeEmbedder({0: [(50, REF), (50, unit(0, 0, 1))]})  # b not alike -> 0
        r = idn.choose_opening_frame([frame(0)], refs, e)
        self.assertAlmostEqual(r["likeness"], 0.0, places=5)
        self.assertTrue(r["weak"])

    def test_nothing_scorable_is_weak(self):
        r = idn.choose_opening_frame([frame(9)], {"a": [REF]}, FakeEmbedder({}))
        self.assertTrue(r["weak"])
        self.assertEqual(r["chosen"], 0)


class CropTests(unittest.TestCase):
    def test_cache_key_depends_on_bytes_and_params(self):
        k = idn.crop_cache_key(b"img")
        self.assertEqual(k, hashlib.sha256(b"img|scale=2.0|size=768|max_face_frac=0.4").hexdigest()[:16])
        self.assertEqual(k, idn.crop_cache_key(b"img"))
        self.assertNotEqual(k, idn.crop_cache_key(b"img2"))
        self.assertNotEqual(k, idn.crop_cache_key(b"img", scale=3.0))
        self.assertNotEqual(k, idn.crop_cache_key(b"img", size=512))

    def test_crop_box_square_in_bounds_and_skips_closeups(self):
        x0, y0, s = idn.crop_box((10, 10, 40, 50), (400, 300))
        self.assertEqual(s, 100)
        self.assertTrue(0 <= x0 <= 300 - s and 0 <= y0 <= 400 - s)
        self.assertIsNone(idn.crop_box((0, 0, 100, 170), (400, 300)))

    def test_closeup_cached_and_reused(self):
        import cv2
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "p.png"
            cv2.imwrite(str(src), np.full((400, 300, 3), 128, np.uint8))

            class One:
                calls = 0

                def faces(self, bgr):
                    One.calls += 1
                    return [FaceHit((100.0, 80.0, 40.0, 50.0), REF)]

            a = idn.face_closeup(src, Path(d) / "c", One(), size=64)
            b = idn.face_closeup(src, Path(d) / "c", One(), size=64)
            self.assertEqual(a, b)
            self.assertEqual(One.calls, 1)  # second call hit the cache
            self.assertEqual(cv2.imread(str(a)).shape[:2], (64, 64))


class ModelFileTests(unittest.TestCase):
    def manifest(self, data):
        return {"models": {"detector": {"file": "m.onnx", "url": "u", "sha256": hashlib.sha256(data).hexdigest()}}}

    def test_hash_match_loads_and_mismatch_refused(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "m.onnx").write_bytes(b"weights")
            self.assertIn("detector", idn.verify_model_files(Path(d), self.manifest(b"weights")))
            with self.assertRaisesRegex(idn.ModelFilesError, "sha256 mismatch"):
                idn.verify_model_files(Path(d), self.manifest(b"other"))
            with self.assertRaisesRegex(idn.ModelFilesError, "missing"):
                idn.verify_model_files(Path(d) / "nope", self.manifest(b"weights"))

    def test_embedder_refuses_tampered_real_manifest(self):
        with tempfile.TemporaryDirectory() as d:
            for spec in idn.load_manifest()["models"].values():
                (Path(d) / spec["file"]).write_bytes(b"tampered")
            with self.assertRaises(idn.ModelFilesError):
                idn.SFaceEmbedder(Path(d))

    def test_manifest_shape(self):
        m = idn.load_manifest()
        self.assertEqual(m["source_commit"], "48b10fa505aeb51fbd127fc60a5c660040e823b7")
        for spec in m["models"].values():
            self.assertIn(spec["source_commit"] if "source_commit" in spec else m["source_commit"], spec["url"])
            self.assertRegex(spec["sha256"], r"^[0-9a-f]{64}$")


class AdapterTests(unittest.TestCase):
    def test_tensor_conversion_rgb_to_bgr(self):
        t = np.zeros((2, 4, 4, 3), np.float32)
        t[..., 0] = 1.0  # red in RGB
        frames = idn.tensor_to_bgr_frames(t)
        self.assertEqual(len(frames), 2)
        self.assertEqual(tuple(frames[0][0, 0]), (0, 0, 255))

    def test_mappings_exported(self):
        self.assertEqual(set(idn.NODE_CLASS_MAPPINGS), set(idn.NODE_DISPLAY_NAME_MAPPINGS))

    def test_cli_blocked_on_hash_mismatch(self):
        import contextlib
        import io
        with tempfile.TemporaryDirectory() as d:
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = idn.main(["--models-dir", d, "opening"])
            self.assertEqual(rc, 2)
            self.assertEqual(json.loads(buf.getvalue())["verdict"], "BLOCKED")

    def test_cli_with_injected_embedder(self):
        import contextlib
        import io
        import cv2
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.png"
            cv2.imwrite(str(p), frame(1))
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = idn.main(["opening", "--candidate", str(p)], embedder=FakeEmbedder({}))
            self.assertEqual(rc, 0)
            self.assertEqual(json.loads(buf.getvalue())["kind"], "opening_frame")


@unittest.skipUnless((MODELS / "face_detection_yunet_2023mar.onnx").is_file()
                     and (MODELS / "face_recognition_sface_2021dec.onnx").is_file(),
                     "face model ONNX files absent")
class RealModelTests(unittest.TestCase):
    def test_loads_and_blank_frame_has_no_face(self):
        emb = idn.SFaceEmbedder(MODELS)
        blank = np.full((480, 640, 3), 127, np.uint8)
        self.assertEqual(emb.faces(blank), [])
        r = idn.identity_score([blank] * 3, {"a": [REF]}, emb)
        self.assertEqual(r["verdict"], "not_judged")


if __name__ == "__main__":
    unittest.main()
