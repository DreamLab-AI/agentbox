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



class DeriveTests(unittest.TestCase):
    """A derived model: pinned source -> baked converter -> pinned output hash."""

    def setUp(self):
        import hashlib
        import sys
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        source_bytes = b"peft lora weights"
        self.source = {"repo": "example/src", "revision": "0" * 40, "file": "checkpoints/src.bin",
                       "directory": "loras", "size": len(source_bytes),
                       "sha256": hashlib.sha256(source_bytes).hexdigest()}
        kept = self.root / ".sources" / "loras" / "src.bin"
        kept.parent.mkdir(parents=True)
        kept.write_bytes(source_bytes)  # already verified source: no network in tests
        converted = source_bytes.upper()
        self.model = {"repo": "example/src", "revision": "0" * 40, "file": "out.bin", "directory": "loras",
                      "size": len(converted), "sha256": hashlib.sha256(converted).hexdigest(),
                      "derive": {"converter": "upper", "source": self.source}}
        upper = "import sys; open(sys.argv[2], 'wb').write(open(sys.argv[1], 'rb').read().upper())"
        self.converters = {"upper": [sys.executable, "-c", upper], "same": [sys.executable, "-c",
                           "import shutil, sys; shutil.copyfile(sys.argv[1], sys.argv[2])"]}

    def test_derives_verifies_and_publishes(self):
        target = dvm.derive(self.model, self.root, converters=self.converters)
        self.assertEqual(target.read_bytes(), b"PEFT LORA WEIGHTS")
        self.assertFalse(list(target.parent.glob("*.part*")))
        self.assertEqual(dvm.derive(self.model, self.root, converters=self.converters), target)

    def test_hash_mismatch_publishes_nothing(self):
        wrong = {**self.model, "derive": {**self.model["derive"], "converter": "same"}}
        with self.assertRaisesRegex(RuntimeError, "pinned sha256"):
            dvm.derive(wrong, self.root, converters=self.converters)
        self.assertFalse((self.root / "loras" / "out.bin").exists())
        self.assertFalse(list((self.root / "loras").glob("*.part*")))

    def test_plan_counts_the_source_download(self):
        (self.root / ".sources" / "loras" / "src.bin").unlink()
        dvm.PROFILES["_derive_test"] = [self.model]
        self.addCleanup(dvm.PROFILES.pop, "_derive_test")
        plan = dvm.provision_plan(["_derive_test"], self.root)
        self.assertEqual(plan["download_bytes_remaining_by_size"], self.model["size"] + self.source["size"])


    def test_safetensors_header_is_canonicalised(self):
        import struct
        data = b"\x00" * 8

        def write(path, header):
            raw = header.encode()
            path.write_bytes(struct.pack("<Q", len(raw)) + raw + data)
        tensor = '"w":{"dtype":"F32","shape":[2],"data_offsets":[0,8]}'
        a, b = self.root / "a.safetensors", self.root / "b.safetensors"
        write(a, '{"__metadata__":{"format":"pt","source":"x"},' + tensor + '}')
        write(b, '{' + tensor + ',"__metadata__":{"source":"x","format":"pt"}}  ')
        dvm.canonicalise_safetensors(a)
        dvm.canonicalise_safetensors(b)
        self.assertEqual(a.read_bytes(), b.read_bytes())
        self.assertEqual(a.read_bytes()[-8:], data)
        self.assertEqual(struct.unpack("<Q", a.read_bytes()[:8])[0] % 8, 0)

class SplatProfileTests(unittest.TestCase):
    """Every file the splat graphs load is provisioned by splat-pano or splat-dataset."""

    def test_graph_files_are_provisioned(self):
        manifest = json.loads((Path(__file__).parents[2] / "manifests" / "splatkit.json").read_text())
        provisioned = {Path(m["file"]).name for name in ("splat-pano", "splat-dataset") for m in dvm.PROFILES[name]}
        provisioned |= {Path(m["file"]).name for m in dvm.PROFILES.get("splat-matrix3d", [])}
        wanted = {f for files in manifest["required_models"].values() for f in files}
        self.assertEqual(wanted - provisioned, set())


if __name__ == "__main__":
    unittest.main()
