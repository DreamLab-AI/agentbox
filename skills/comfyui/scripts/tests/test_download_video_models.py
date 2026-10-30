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


SPEDE_MANIFEST = Path(__file__).parents[2] / "manifests" / "spede.json"
# Loader class.input -> models/ sub-folder the loader reads (ComfyUI folder_paths).
LOADER_FOLDERS = {
    "CheckpointLoaderSimple.ckpt_name": "checkpoints",
    "UNETLoader.unet_name": "diffusion_models",
    "VAELoader.vae_name": "vae",
    "CLIPLoader.clip_name": "text_encoders",
    "CLIPVisionLoader.clip_name": "clip_vision",
    "LoadMoGeModel.model_name": "geometry_estimation",
}
ORBIT_MARKERS = ("minimax", "h3", "qwen3vl_32b")


class SpedeProfileTests(unittest.TestCase):
    def test_profiles_exist_and_replace_is_a_superset(self):
        spede = {m["file"] for m in dvm.PROFILES["spede"]}
        replace = {m["file"] for m in dvm.PROFILES["spede-replace"]}
        self.assertEqual(len(dvm.PROFILES["spede"]), 6)
        self.assertEqual(len(dvm.PROFILES["spede-replace"]), 10)
        self.assertLess(spede, replace)
        self.assertEqual(len(dvm.selected_models(["spede", "spede-replace"])), 10)

    def test_every_record_is_complete_and_pinned(self):
        for name in ("spede", "spede-replace"):
            for m in dvm.PROFILES[name]:
                self.assertRegex(m["revision"], r"^[0-9a-f]{40}$", m["file"])
                self.assertRegex(m["sha256"], r"^[0-9a-f]{64}$", m["file"])
                self.assertIsInstance(m["size"], int)
                self.assertGreater(m["size"], 1_000_000, m["file"])
                self.assertTrue(m["repo"] and m["file"].endswith(".safetensors") and m["directory"])
                self.assertNotIn("url", m)  # Hugging Face resolve URL, token-eligible
                self.assertTrue(dvm.model_url(m)[0].startswith(f"https://huggingface.co/{m['repo']}/resolve/{m['revision']}/"))
                self.assertFalse(any(x in m["file"].lower() for x in ORBIT_MARKERS))

    def test_manifest_and_profiles_agree_both_ways_with_correct_folders(self):
        manifest = json.loads(SPEDE_MANIFEST.read_text())
        self.assertIsInstance(manifest["required_nodes"], list)
        self.assertEqual(len(manifest["required_nodes"]), len(set(manifest["required_nodes"])))
        self.assertTrue(set(manifest["required_models"]) <= set(LOADER_FOLDERS))
        named = {}
        for key, files in manifest["required_models"].items():
            for file in files:
                named[file] = LOADER_FOLDERS[key]
        provisioned = {Path(m["file"]).name: m["directory"] for m in dvm.PROFILES["spede-replace"]}
        self.assertEqual(named, provisioned)  # same files, each in the folder its loader reads
        for m in dvm.PROFILES["spede-replace"]:
            self.assertEqual(m["file"].split("/")[0], m["directory"])

    def test_manifest_is_a_probe_manifest_without_orbit_nodes(self):
        manifest = json.loads(SPEDE_MANIFEST.read_text())
        nodes = manifest["required_nodes"]
        for needed in ("SpEdE_LocalExtract", "SpEdE_LocalRemove", "SpEdE_LocalPrepareReplace", "SAM3_Detect", "TripoSplatConditioning"):
            self.assertIn(needed, nodes)
        self.assertFalse([n for n in nodes if "MiniMax" in n or "Lora" in n])
        comfy_client = importlib.util.spec_from_file_location("comfy_client", Path(__file__).parents[1] / "comfy_client.py")
        module = importlib.util.module_from_spec(comfy_client)
        comfy_client.loader.exec_module(module)
        blocked = module.capability_snapshot(manifest, {})
        self.assertEqual(blocked["status"], "BLOCKED")  # nothing installed or provisioned yet
        self.assertEqual(len(blocked["items"]), len(nodes) + sum(len(v) for v in manifest["required_models"].values()))

    def test_no_collision_with_campaign_profiles(self):
        self.assertNotIn("spede", dvm.CAMPAIGN.get("profiles", {}))
        self.assertNotIn("spede-replace", dvm.CAMPAIGN.get("profiles", {}))


if __name__ == "__main__":
    unittest.main()
