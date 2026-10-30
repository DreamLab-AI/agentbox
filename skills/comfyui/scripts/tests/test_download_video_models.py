import importlib.util
import json
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location(
    "download_video_models", Path(__file__).parents[1] / "download_video_models.py")
dvm = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dvm)

FACE_MANIFEST = Path(__file__).parents[4] / "comfyui-sidecar/nodes/agentbox_video/face_models.json"


class FaceProfileTests(unittest.TestCase):
    def test_face_profile_matches_the_node_pack_manifest(self):
        manifest = json.loads(FACE_MANIFEST.read_text())
        want = {(m["file"], m["sha256"], m["bytes"], m["url"]) for m in manifest["models"].values()}
        got = {(m["file"], m["sha256"], m["size"], m["url"]) for m in dvm.PROFILES["face-identity"]}
        self.assertEqual(got, want)
        target = Path(manifest["target_dir"])
        for model in dvm.PROFILES["face-identity"]:
            self.assertEqual(Path("/opt/ComfyUI/models") / model["directory"], target)

    def test_explicit_url_is_used_and_never_carries_the_hf_token(self):
        face = dvm.PROFILES["face-identity"][0]
        self.assertEqual(dvm.model_url(face), (face["url"], False))
        url, hf = dvm.model_url(dvm.PROFILES["ltx23"][0])
        self.assertTrue(url.startswith("https://huggingface.co/Lightricks/LTX-2.3-fp8/resolve/"))
        self.assertTrue(hf)

    def test_explicit_url_must_be_https(self):
        with self.assertRaises(ValueError):
            dvm.model_url({**dvm.PROFILES["face-identity"][0], "url": "http://example.invalid/x.onnx"})


if __name__ == "__main__":
    unittest.main()
