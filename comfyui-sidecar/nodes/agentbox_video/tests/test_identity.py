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

# Real-model tests run where the face models are provisioned (the sidecar default) or
# where AGENTBOX_FACE_MODELS points; elsewhere they skip.
MODELS = Path(os.environ.get("AGENTBOX_FACE_MODELS", idn.DEFAULT_MODELS_DIR))


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
        self.assertEqual(idn.identity_score([frame(1), frame(1)], {"a": [REF]}, e2)["verdict"], "PASS")

    def test_pass_is_provisional_and_editorial(self):
        e = FakeEmbedder({1: [(50, REF)]})
        r = idn.identity_score([frame(1), frame(1)], {"a": [REF]}, e)
        self.assertEqual(r["verdict"], "PASS")
        self.assertTrue(r["provisional"])
        self.assertFalse(r["acceptance_backing"])
        self.assertEqual(r["thresholds"]["provenance"], "kinoloom-ltx-uncalibrated")
        self.assertFalse(r["thresholds"]["calibrated"])
        self.assertEqual(r["acceptance"], "editorial")

    def test_fail_routes_to_human_review(self):
        e = FakeEmbedder({1: [(50, unit(0, 1, 0))]})
        r = idn.identity_score([frame(1), frame(1)], {"a": [REF]}, e)
        self.assertEqual(r["verdict"], "FAIL")
        self.assertEqual(r["route"], "human_review")
        self.assertTrue(r["provisional"])

    def test_no_references_not_judged(self):
        r = idn.identity_score([frame(1)], {}, FakeEmbedder({1: [(50, REF)]}))
        self.assertEqual(r["verdict"], "not_judged")


ALICE, BOB = unit(1, 0, 0), unit(0, 1, 0)
CAST = {"alice": [ALICE], "bob": [BOB]}


class CastAwareTests(unittest.TestCase):
    def test_bob_in_an_alice_shot_is_an_identity_swap(self):
        e = FakeEmbedder({1: [(50, BOB)]})
        r = idn.identity_score([frame(1)] * 3, CAST, e, expected_cast="alice")
        self.assertEqual(r["verdict"], "FAIL")
        self.assertEqual(r["reason"], "identity_swap")
        self.assertEqual(r["route"], "human_review")
        self.assertEqual((r["expected_cast"], r["matched_cast"]), ("alice", "bob"))
        self.assertIn("alice", r["detail"])
        self.assertIn("bob", r["detail"])
        self.assertFalse(r["acceptance_backing"])
        self.assertAlmostEqual(r["score"], 0.0, places=5)  # best cosine against alice only

    def test_without_expected_cast_the_same_shot_still_passes(self):
        # the cast-agnostic behaviour the review found, kept for callers that do not say who is meant
        r = idn.identity_score([frame(1)] * 3, CAST, FakeEmbedder({1: [(50, BOB)]}))
        self.assertEqual(r["verdict"], "PASS")

    def test_expected_actor_present_passes_and_scores_only_that_actor(self):
        e = FakeEmbedder({1: [(50, unit(1, 0.2, 0))]})
        r = idn.identity_score([frame(1)] * 3, CAST, e, expected_cast="alice")
        self.assertEqual(r["verdict"], "PASS")
        self.assertAlmostEqual(r["score"], float(np.dot(unit(1, 0.2, 0), ALICE)), places=5)
        self.assertEqual(r["expected_cast"], "alice")
        self.assertIsNone(r.get("matched_cast"))

    def test_swap_needs_the_margin(self):
        mix = unit(1, 1.02, 0)  # marginally closer to bob than to alice
        e = FakeEmbedder({1: [(50, mix)]})
        r = idn.identity_score([frame(1)] * 3, CAST, e, expected_cast="alice")
        self.assertEqual(r["verdict"], "PASS")
        r = idn.identity_score([frame(1)] * 3, CAST, e, ThresholdSet(swap_margin=0.0), expected_cast="alice")
        self.assertEqual((r["verdict"], r["reason"]), ("FAIL", "identity_swap"))

    def test_swap_margin_is_a_threshold_with_provenance(self):
        th = ThresholdSet()
        self.assertEqual((th.swap_margin, th.min_judged_frames), (0.05, 2))
        r = idn.identity_score([frame(1)] * 2, CAST, FakeEmbedder({1: [(50, ALICE)]}), expected_cast="alice")
        self.assertEqual(r["thresholds"]["swap_margin"], 0.05)
        self.assertEqual(r["thresholds"]["min_judged_frames"], 2)
        self.assertTrue(r["thresholds"]["provenance"])

    def test_unknown_expected_cast_is_not_judged(self):
        r = idn.identity_score([frame(1)] * 3, CAST, FakeEmbedder({1: [(50, ALICE)]}), expected_cast="carol")
        self.assertEqual(r["verdict"], "not_judged")
        self.assertIn("carol", r["reason"])

    def test_one_good_frame_is_not_enough(self):
        e = FakeEmbedder({1: [(50, ALICE)], 2: []})
        r = idn.identity_score([frame(2), frame(2), frame(2), frame(1)], CAST, e)
        self.assertEqual(r["verdict"], "not_judged")
        self.assertEqual(r["judged_frames"], 1)
        self.assertFalse(r["acceptance_backing"])
        self.assertIn("1", r["reason"])
        # Faces in a strict majority of the frames considered, all matching: PASS.
        ok = idn.identity_score([frame(2), frame(1), frame(1), frame(1)], CAST, e)
        self.assertEqual((ok["verdict"], ok["judged_frames"]), ("PASS", 3))

    def test_min_judged_frames_is_configurable_upwards(self):
        e = FakeEmbedder({1: [(50, ALICE)], 2: []})
        clip = [frame(2), frame(1), frame(1), frame(1), frame(1)]
        self.assertEqual(idn.identity_score(clip, CAST, e, ThresholdSet(min_judged_frames=4))["verdict"], "PASS")
        self.assertEqual(idn.identity_score(clip, CAST, e, ThresholdSet(min_judged_frames=5))["verdict"], "not_judged")

    def test_cli_expect_flag_reports_the_swap(self):
        import contextlib
        import io
        import cv2
        with tempfile.TemporaryDirectory() as d:
            for name, fid in (("a.png", 7), ("b.png", 8)):
                cv2.imwrite(str(Path(d) / name), frame(fid))
            cap = cv2.VideoWriter(str(Path(d) / "v.avi"), cv2.VideoWriter_fourcc(*"FFV1"), 5, (200, 100))
            self.assertTrue(cap.isOpened())
            for _ in range(3):
                cap.write(frame(8))
            cap.release()
            emb = FakeEmbedder({7: [(50, ALICE)], 8: [(50, BOB)]})
            argv = ["score", "--video", str(Path(d) / "v.avi"),
                    "--ref", f"alice={Path(d) / 'a.png'}", "--ref", f"bob={Path(d) / 'b.png'}"]
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                idn.main(argv + ["--expect", "alice"], embedder=emb)
            rep = json.loads(buf.getvalue())
            self.assertEqual((rep["verdict"], rep["reason"]), ("FAIL", "identity_swap"))

    def test_one_good_frame_among_strangers_is_not_a_pass(self):
        stranger = unit(0, 0, 1)
        e = FakeEmbedder({1: [(50, stranger)], 2: [(50, ALICE)]})
        r = idn.identity_score([frame(1)] * 4 + [frame(2)], CAST, e, expected_cast="alice")
        self.assertEqual(r["verdict"], "FAIL")
        self.assertEqual(r["route"], "human_review")
        self.assertEqual((r["judged_frames"], r["face_frames"]), (1, 5))
        self.assertIn("1 of 5", r["reason"])
        self.assertFalse(r["acceptance_backing"])
        # and without a cast, the same shot against a single reference
        r2 = idn.identity_score([frame(1)] * 4 + [frame(2)], {"alice": [ALICE]}, e)
        self.assertEqual(r2["verdict"], "FAIL")

    def test_matching_majority_passes_and_half_does_not(self):
        e = FakeEmbedder({1: [(50, unit(0, 0, 1))], 2: [(50, ALICE)]})
        ok = idn.identity_score([frame(1)] * 2 + [frame(2)] * 3, CAST, e, expected_cast="alice")
        self.assertEqual((ok["verdict"], ok["judged_frames"], ok["face_frames"]), ("PASS", 3, 5))
        half = idn.identity_score([frame(1)] * 2 + [frame(2)] * 2, CAST, e, expected_cast="alice")
        self.assertEqual(half["verdict"], "FAIL")

    def test_no_expected_cast_pass_carries_a_note_and_never_backs_acceptance(self):
        e = FakeEmbedder({1: [(50, ALICE)]})
        r = idn.identity_score([frame(1)] * 3, CAST, e)
        self.assertEqual((r["verdict"], r["reason"]), ("PASS", "no expected_cast"))
        r = idn.identity_score([frame(1)] * 3, CAST, e, expected_cast="alice")
        self.assertEqual(r["verdict"], "PASS")
        for rep in (r, idn.identity_score([frame(1)] * 3, CAST, e)):
            self.assertFalse(rep["acceptance_backing"])
            self.assertTrue(rep["provisional"])
            self.assertEqual(rep["acceptance"], "editorial")

    def test_the_frame_floor_is_at_least_two_and_never_capped_by_last_n(self):
        # One frame can never carry an identity verdict: the floor is >= 2 and last_n must cover it.
        for bad in ({"min_judged_frames": 1}, {"min_judged_frames": 0}, {"min_judged_frames": -3},
                    {"last_n": 1}, {"last_n": 3, "min_judged_frames": 4}):
            with self.assertRaises(ValueError, msg=bad):
                ThresholdSet(**bad)
        e = FakeEmbedder({1: [(50, ALICE)]})
        r = idn.identity_score([frame(1)] * 3, CAST, e, ThresholdSet(last_n=2), expected_cast="alice")
        self.assertEqual(r["verdict"], "PASS")
        self.assertEqual(r["effective_min_judged_frames"], 2)
        # a clip shorter than the floor is not_judged
        short = idn.identity_score([frame(1)], CAST, e, ThresholdSet(last_n=5), expected_cast="alice")
        self.assertEqual(short["verdict"], "not_judged")

    def test_faces_must_be_visible_in_a_majority_of_the_frames_considered(self):
        # [faceless x3, good, good]: two matches in five frames is not a verdict.
        e = FakeEmbedder({1: [], 2: [(50, ALICE)]})
        clip = [frame(1)] * 3 + [frame(2)] * 2
        r = idn.identity_score(clip, CAST, e, expected_cast="alice")
        self.assertEqual(r["verdict"], "not_judged")
        # [faceless x2, good x3] is a majority with faces, all matching: PASS
        ok = idn.identity_score([frame(1)] * 2 + [frame(2)] * 3, CAST, e, expected_cast="alice")
        self.assertEqual(ok["verdict"], "PASS")

    def test_the_node_cannot_ask_for_a_one_frame_verdict(self):
        req = idn.AgentboxIdentityScore.INPUT_TYPES()["required"]
        opt = idn.AgentboxIdentityScore.INPUT_TYPES()["optional"]
        self.assertGreaterEqual(req["last_n"][1]["min"], 2)
        self.assertGreaterEqual(opt["min_judged_frames"][1]["min"], 2)

    def test_node_exposes_expected_cast_as_optional_string(self):
        opt = idn.AgentboxIdentityScore.INPUT_TYPES()["optional"]
        self.assertEqual(opt["expected_cast"][0], "STRING")


class CalibrationRemovedTests(unittest.TestCase):
    def test_calibrated_true_is_refused(self):
        with self.assertRaisesRegex(idn.CalibrationError, "editorial"):
            ThresholdSet(calibrated=True)
        with self.assertRaisesRegex(idn.CalibrationError, "ADR-2163"):
            ThresholdSet.from_dict({"calibrated": True, "provenance": "x"})

    def test_calibration_field_is_refused(self):
        with self.assertRaises(idn.CalibrationError):
            ThresholdSet.from_dict({"calibration": {"path": "c.json", "sha256": "0" * 64}})
        with self.assertRaises(idn.CalibrationError):
            ThresholdSet(calibration={"path": "c.json"})

    def test_cli_prints_blocked_not_a_traceback(self):
        import contextlib, io
        for body in ({"calibrated": True}, {"calibration": {"path": "c.json", "sha256": "0"}}, [1, 2],
                     {"min_judged_frames": 1}, {"last_n": 1}):
            with tempfile.TemporaryDirectory() as d:
                Path(d, "th.json").write_text(json.dumps(body))
                buf = io.StringIO()
                with contextlib.redirect_stdout(buf):
                    rc = idn.main(["--thresholds", str(Path(d, "th.json")), "opening"], embedder=FakeEmbedder({}))
                self.assertEqual(rc, 2)
                out = json.loads(buf.getvalue())
                self.assertEqual(out["verdict"], "BLOCKED")
                self.assertTrue(out["error"])

    def test_an_explicit_null_calibration_field_is_still_refused(self):
        with self.assertRaises(idn.CalibrationError):
            ThresholdSet.from_dict({"calibration": None})

    def test_cli_last_n_override_below_the_floor_is_blocked(self):
        import contextlib, io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = idn.main(["--last-n", "1", "opening"], embedder=FakeEmbedder({}))
        self.assertEqual((rc, json.loads(buf.getvalue())["verdict"]), (2, "BLOCKED"))

    def test_every_report_is_editorial(self):
        e = FakeEmbedder({1: [(50, ALICE)]})
        for rep in (idn.identity_score([frame(1)] * 3, CAST, e, expected_cast="alice"),
                    idn.choose_opening_frame([frame(1)], CAST, e)):
            self.assertFalse(rep["acceptance_backing"])
            self.assertTrue(rep["provisional"])
            self.assertEqual(rep["acceptance"], "editorial")


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


class FakeCv2:
    """Stands in for the cv2 module: records how the two models were created."""

    class error(Exception):
        pass

    def __init__(self, buffer_ok=True):
        self.calls = []
        outer = self
        self_error = self.error  # what the real bindings raise for a missing overload

        class Det:
            @staticmethod
            def create(*a, **k):
                if isinstance(a[0], str) and a[0] != "onnx":
                    outer.calls.append(("det-path", a[0], Path(a[0]).read_bytes(), oct(Path(a[0]).stat().st_mode & 0o777)))
                    return object()
                if not buffer_ok:
                    raise self_error("Overload resolution failed")
                outer.calls.append(("det-buffer", a[0], bytes(a[1].tobytes())))
                return object()

        class Rec:
            @staticmethod
            def create(*a, **k):
                if isinstance(a[0], str) and a[0] != "onnx":
                    outer.calls.append(("rec-path", a[0], Path(a[0]).read_bytes(), oct(Path(a[0]).stat().st_mode & 0o777)))
                    return object()
                if not buffer_ok:
                    raise self_error("Overload resolution failed")
                outer.calls.append(("rec-buffer", a[0], bytes(a[1].tobytes())))
                return object()

        self.FaceDetectorYN, self.FaceRecognizerSF = Det, Rec


class VerifiedBytesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.det, self.rec = b"detector-weights", b"recogniser-weights"
        (self.dir / "d.onnx").write_bytes(self.det)
        (self.dir / "r.onnx").write_bytes(self.rec)
        self.manifest = {"models": {
            "detector": {"file": "d.onnx", "url": "u", "sha256": hashlib.sha256(self.det).hexdigest()},
            "recogniser": {"file": "r.onnx", "url": "u", "sha256": hashlib.sha256(self.rec).hexdigest()}}}

    def build(self, fake):
        from unittest import mock
        with mock.patch.dict("sys.modules", {"cv2": fake}):
            return idn.SFaceEmbedder(self.dir, self.manifest)

    def test_models_load_from_the_verified_bytes(self):
        fake = FakeCv2()
        self.build(fake)
        self.assertEqual([(c[0], c[2]) for c in fake.calls],
                         [("det-buffer", self.det), ("rec-buffer", self.rec)])

    def test_file_swapped_after_hashing_is_never_loaded(self):
        # The path is rewritten the instant verification has read it; the loader must
        # still receive the bytes that were hashed.
        real = idn.read_verified_models

        def swap(models_dir, manifest=None):
            out = real(models_dir, manifest)
            (self.dir / "d.onnx").write_bytes(b"EVIL")
            (self.dir / "r.onnx").write_bytes(b"EVIL")
            return out

        fake = FakeCv2()
        from unittest import mock
        with mock.patch.object(idn, "read_verified_models", swap):
            self.build(fake)
        self.assertEqual([c[2] for c in fake.calls], [self.det, self.rec])

    def test_without_buffer_support_a_private_copy_of_the_verified_bytes_is_loaded_then_removed(self):
        fake = FakeCv2(buffer_ok=False)
        real = idn.read_verified_models

        def swap(models_dir, manifest=None):
            out = real(models_dir, manifest)
            (self.dir / "d.onnx").write_bytes(b"EVIL")
            return out

        from unittest import mock
        with mock.patch.object(idn, "read_verified_models", swap):
            self.build(fake)
        kinds = [(c[0], c[2], c[3]) for c in fake.calls]
        self.assertEqual(kinds, [("det-path", self.det, "0o600"), ("rec-path", self.rec, "0o600")])
        for c in fake.calls:
            self.assertNotEqual(Path(c[1]).parent, self.dir)  # a private copy, not the original path
            self.assertFalse(Path(c[1]).exists())             # removed after loading
            self.assertFalse(Path(c[1]).parent.exists())

    @unittest.skipUnless((MODELS / "face_detection_yunet_2023mar.onnx").is_file()
                         and (MODELS / "face_recognition_sface_2021dec.onnx").is_file(), "face model ONNX files absent")
    def test_real_opencv_loads_through_the_buffer_branch(self):
        import cv2
        del idn._LOAD_TRACE[:]
        idn.SFaceEmbedder(MODELS)
        self.assertEqual([m for _, m in idn._LOAD_TRACE], ["buffer", "buffer"], cv2.__version__)

    def test_real_cv2_signals_a_missing_overload_with_cv2_error(self):
        import cv2
        with self.assertRaises(cv2.error):
            cv2.FaceRecognizerSF.create(1, 2, 3, 4, 5, 6, 7)

    def test_tampered_file_is_refused_before_any_load(self):
        (self.dir / "d.onnx").write_bytes(b"tampered")
        fake = FakeCv2()
        with self.assertRaises(idn.ModelFilesError):
            self.build(fake)
        self.assertEqual(fake.calls, [])


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
