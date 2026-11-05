import hashlib
import importlib.util
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import struct
import sys
import tempfile
import threading
import unittest
import urllib.parse

SCRIPTS = Path(__file__).parents[1]
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location("splat_pipeline", SCRIPTS / "splat_pipeline.py")
splat = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(splat)


def jpeg_with_focal_35mm(value, order="<", width=6000, height=4000, orientation=1, with_size=True):
    """Smallest JPEG header carrying IFD0 Orientation, ExifIFD FocalLengthIn35mmFilm and an SOF0 size."""
    mark = b"II" if order == "<" else b"MM"
    # IFD0 at 8: two entries (Orientation, ExifIFD pointer) -> 2 + 24 + 4 = 30 bytes; Exif IFD at 38.
    ifd0 = (struct.pack(order + "H", 2)
            + struct.pack(order + "HHI", 0x0112, 3, 1) + struct.pack(order + "H", orientation) + b"\0\0"
            + struct.pack(order + "HHI", 0x8769, 4, 1) + struct.pack(order + "I", 38) + b"\0\0\0\0")
    exif = struct.pack(order + "H", 1) + struct.pack(order + "HHI", 0xA405, 3, 1) + struct.pack(order + "H", value) + b"\0\0" + b"\0\0\0\0"
    tiff = mark + struct.pack(order + "H", 42) + struct.pack(order + "I", 8) + ifd0 + exif
    app1 = b"Exif\0\0" + tiff
    sof = b"\x08" + struct.pack(">HH", height, width) + b"\x03" + b"\x01\x22\x00\x02\x11\x01\x03\x11\x01"
    return (b"\xff\xd8" + b"\xff\xe1" + struct.pack(">H", len(app1) + 2) + app1
            + (b"\xff\xc0" + struct.pack(">H", len(sof) + 2) + sof if with_size else b"")
            + b"\xff\xda\x00\x02" + b"\xff\xd9")


class GraphTests(unittest.TestCase):
    PATHS = [splat.normalise_path({"label": "push-in", "orientation": "look_forward",
                                   "anchors": [[0, 0, 0], [0.2, 0.0, 0.5], [0.1, 0.05, 1.2]]}),
             splat.normalise_path({"label": "crane", "orientation": "per_point_look",
                                   "anchors": [[0, 0, 0], [0, 0.4, 0.3]], "targets": [[1, 0, 2], [1, 0, 2]]})]

    def test_pano_image_graph_sets_photo_fov_scene_and_prefixes(self):
        graph = splat.build_pano_graph("village", image_ref="splat/v.jpg", h_fov=72.5, scene="A market square.")
        self.assertEqual(graph["photo"]["inputs"]["image"], "splat/v.jpg")
        self.assertEqual(graph["warp"]["inputs"]["h_fov_deg"], 72.5)
        self.assertTrue(graph["positive_text"]["inputs"]["prompt"].endswith(" A market square."))
        self.assertTrue(graph["positive_text"]["inputs"]["prompt"].startswith("Fill the green spaces"))
        self.assertEqual(graph["save_8k"]["inputs"]["filename_prefix"], "splat/village/pano_8k")

    def test_pano_text_graph_keeps_lora_trigger(self):
        graph = splat.build_pano_graph("cave", text="  a torchlit cavern ", seed=7)
        self.assertEqual(graph["scene_prompt"]["inputs"]["text"], splat.T2P_PREFIX + "a torchlit cavern")
        self.assertEqual(graph["sample"]["inputs"]["seed"], 7)

    def test_pano_8k_wrap_seam_is_rebuilt_from_the_rolled_2k_pano(self):
        # The tiled USDU refine breaks the 360 wrap; both modes must re-blend it before saving.
        for graph in (splat.build_pano_graph("a", image_ref="splat/v.jpg", h_fov=70, scene="A room."),
                      splat.build_pano_graph("b", text="a room")):
            self.assertEqual(graph["save_8k"]["inputs"]["images"], ["pano_8k", 0])
            self.assertEqual(graph["pano_8k"]["inputs"]["image"], ["wrap_blend", 0])
            blend = graph["wrap_blend"]["inputs"]
            self.assertEqual(blend["destination"], ["wrap_roll_usdu", 0])
            self.assertEqual(graph["wrap_roll_usdu"]["inputs"]["image"], ["usdu", 0])
            self.assertEqual(blend["source"], ["wrap_scale_8k", 0])
            self.assertEqual(graph["wrap_roll_2k"]["inputs"]["image"], ["pano_2k", 0])
            for roll in ("wrap_roll_2k", "wrap_roll_usdu", "pano_8k"):
                self.assertEqual(graph[roll]["inputs"]["fraction"], 0.5)
            mask = graph["wrap_mask"]["inputs"]
            self.assertEqual((mask["width"], mask["height"]),
                             (graph["scale_8k"]["inputs"]["width"], graph["scale_8k"]["inputs"]["height"]))

    def test_pano_mode_and_scene_are_required(self):
        with self.assertRaises(splat.PipelineError):
            splat.build_pano_graph("x")
        with self.assertRaises(splat.PipelineError):
            splat.build_pano_graph("x", image_ref="a.png", h_fov=70, scene="")

    def test_dataset_graph_prunes_unused_paths_without_dangling_links(self):
        graph = splat.build_dataset_graph("village", "splat/p.png", self.PATHS)
        self.assertFalse([n for n in graph if n.startswith(("p3_", "p4_"))])
        self.assertIn("p2_hires", graph)
        sfm = graph["sfm"]["inputs"]
        self.assertEqual(sfm["pano_frames_1"], ["p1_hires", 1])
        self.assertNotIn("pano_frames_3", sfm)
        self.assertNotIn("hires_4", sfm)
        self.assertEqual(graph["p2_control"]["inputs"]["orientation"], "per_point_look")
        self.assertEqual(graph["p2_control"]["inputs"]["anchors"].splitlines()[0], "0.000, 0.000, 0.000, 1.000, 0.000, 2.000")
        self.assertEqual(graph["project"]["inputs"]["dataset_name"], "village")
        self.assertEqual(graph["export"]["inputs"]["model_dir"], ["sfm", 0])

    def test_dataset_graph_uses_provisioned_files_only(self):
        graph = splat.build_dataset_graph("v", "splat/p.png", self.PATHS)
        names = {v for n in graph.values() for k, v in n["inputs"].items() if isinstance(v, str) and v.endswith((".safetensors", ".pth", ".pt"))}
        self.assertNotIn("4x-UltraSharp.pth", names)
        self.assertNotIn("auto (download)", {n["inputs"].get("moge_ckpt") for n in graph.values()})
        self.assertIn("RealESRGAN_x4.pth", names)

    def test_preview_graph_clones_one_block_per_path(self):
        graph = splat.build_preview_graph("v", "splat/p.png", self.PATHS)
        self.assertEqual(sorted(n for n in graph if not n.startswith(("p1_frame", "p1_save", "p2_frame", "p2_save"))),
                         ["p1_control", "p1_preview", "p2_control", "p2_preview", "pano"])
        self.assertEqual(graph["p2_frame80"]["inputs"], {"image": ["p2_control", 0], "batch_index": 80, "length": 1})
        self.assertEqual(graph["p1_save40"]["inputs"]["filename_prefix"], "splat/v/view_p1_f40")
        self.assertEqual(graph["p2_preview"]["inputs"]["images"], ["p2_control", 3])
        self.assertEqual(graph["p2_preview"]["inputs"]["filename_prefix"], "splat/v/preview_p2")

    def test_dataset_summary_keeps_full_file_list_in_record(self):
        files = [{"path": f"images/{i:03d}.jpg", "bytes": 10 + i, "sha256": "0" * 64} for i in range(7)]
        full, summary = splat.summarise_dataset({"stage": "dataset", "files": files})
        self.assertEqual(full["files"], files)
        self.assertEqual((full["file_count"], full["bytes"]), (7, sum(10 + i for i in range(7))))
        self.assertEqual(summary["files"], [f["path"] for f in files[:5]])
        self.assertEqual(summary["file_count"], 7)

    def test_path_validation(self):
        for bad in ({"anchors": [[0, 0, 0]]}, {"anchors": "1,2\n3,4"}, {"anchors": [[0, 0, 0], [1, 1, 1]], "orientation": "spin"}):
            with self.assertRaises(splat.PipelineError):
                splat.normalise_path(bad)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        five = Path(tmp.name) / "p.json"
        five.write_text(json.dumps({"paths": [{"anchors": [[0, 0, 0], [1, 0, 1]]}] * 5}))
        with self.assertRaises(splat.PipelineError):
            splat.load_paths(five)

    def test_names_are_restricted(self):
        for bad in ("../x", "", "a b", "-lead"):
            with self.assertRaises(splat.PipelineError):
                splat.workdir_for(bad, "/tmp/root")
        self.assertEqual(splat.workdir_for("ok_1", "/tmp/root"), Path("/tmp/root/ok_1"))


class FovTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def write(self, data):
        path = Path(self.tmp.name) / "photo.jpg"
        path.write_bytes(data)
        return path

    def test_exif_focal_both_byte_orders(self):
        for order in ("<", ">"):
            degrees, source = splat.horizontal_fov(self.write(jpeg_with_focal_35mm(26, order)))
            self.assertAlmostEqual(degrees, 69.39, places=2)  # 3:2 at 26 mm: same as 36 mm width
            self.assertIn("26", source)

    def test_four_by_three_uses_the_diagonal_definition(self):
        degrees, _ = splat.horizontal_fov(self.write(jpeg_with_focal_35mm(26, width=4000, height=3000)))
        self.assertAlmostEqual(degrees, 67.30, places=2)

    def test_rotated_portrait_photo_is_narrower(self):
        for orientation in (6, 8):
            degrees, source = splat.horizontal_fov(self.write(jpeg_with_focal_35mm(26, width=4000, height=3000, orientation=orientation)))
            self.assertAlmostEqual(degrees, 53.06, places=2)
            self.assertIn("upright=3000x4000", source)

    def test_override_wins_and_is_bounded(self):
        path = self.write(jpeg_with_focal_35mm(26))
        self.assertEqual(splat.horizontal_fov(path, 90), (90.0, "operator"))
        with self.assertRaises(splat.PipelineError):
            splat.horizontal_fov(path, 5)

    def test_missing_exif_refuses_to_guess(self):
        with self.assertRaisesRegex(splat.PipelineError, "--h-fov"):
            splat.horizontal_fov(self.write(b"\xff\xd8\xff\xd9"))
        with self.assertRaisesRegex(splat.PipelineError, "--h-fov"):  # focal present, size unknown
            splat.horizontal_fov(self.write(jpeg_with_focal_35mm(26, with_size=False)))


class ServerTests(unittest.TestCase):
    FILES = {"scene/images/cam0_0000.png": b"image-0", "scene/sparse/0/cameras.bin": b"cams"}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.posts = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, body, status=200):
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                owner.posts.append((self.path, body))
                if self.path == "/upload/image":
                    return self.reply({"name": "v_pano.png", "subfolder": "", "type": "input"})
                self.reply({"prompt_id": "job-1"})

            def do_GET(self):
                if self.path == "/object_info":
                    return self.reply({"SaveImage": {"input": {"required": {"filename_prefix": ["STRING", {}]}},
                                                     "output": [], "output_node": True}})
                if self.path.startswith("/view?"):
                    q = dict(urllib.parse.parse_qsl(self.path.split("?", 1)[1]))
                    data = owner.FILES[f'{q["subfolder"]}/{q["filename"]}']
                    self.send_response(200)
                    self.end_headers()
                    return self.wfile.write(data)
                if self.path.startswith("/history/"):
                    return self.reply({"job-1": {"status": {"completed": True}, "outputs": {}}})
                self.reply({"queue_running": [], "queue_pending": []})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.client = splat.comfy_client.Client(f"http://127.0.0.1:{self.server.server_port}")

    def history(self, digest_override=None):
        files = []
        for rel, data in self.FILES.items():
            folder, name = rel.rsplit("/", 1)
            files.append({"filename": name, "subfolder": folder, "type": "output", "bytes": len(data),
                          "sha256": digest_override or hashlib.sha256(data).hexdigest()})
        return {"outputs": {"export": {"files": files, "splat_dataset": ["scene"]}}}

    def test_fetch_dataset_rebuilds_tree_and_skips_verified_files(self):
        dest = Path(self.tmp.name) / "dataset"
        first = splat.fetch_dataset(self.client, self.history(), dest)
        self.assertEqual(sorted(f["path"] for f in first["files"]), ["images/cam0_0000.png", "sparse/0/cameras.bin"])
        self.assertEqual((dest / "sparse/0/cameras.bin").read_bytes(), b"cams")
        again = splat.fetch_dataset(self.client, self.history(), dest)
        self.assertTrue(all(f.get("cached") for f in again["files"]))

    def test_fetch_dataset_rejects_hash_mismatch(self):
        with self.assertRaisesRegex(splat.comfy_client.ComfyError, "SHA-256 mismatch"):
            splat.fetch_dataset(self.client, self.history("0" * 64), Path(self.tmp.name) / "bad")

    def test_upload_returns_loadimage_reference(self):
        image = Path(self.tmp.name) / "p.png"
        image.write_bytes(b"\x89PNG")
        self.assertEqual(splat.upload_image(self.client, image, "v_pano.png"), "v_pano.png")
        self.assertNotIn(b'name="subfolder"', self.posts[0][1])
        with self.assertRaises(splat.PipelineError):
            splat.upload_image(self.client, Path(self.tmp.name) / "notes.txt", "x.txt")

    def test_run_stage_resumes_existing_receipt_instead_of_resubmitting(self):
        work = Path(self.tmp.name) / "work"
        graph = {"save": {"class_type": "SaveImage", "inputs": {"filename_prefix": "x"}}}
        splat.run_stage(self.client, work, "geometry", graph, timeout=1, poll=0.01)
        splat.run_stage(self.client, work, "geometry", graph, timeout=1, poll=0.01)
        self.assertEqual([p for p, _ in self.posts if p == "/prompt"], ["/prompt"])

    def test_run_stage_refuses_a_receipt_for_a_different_graph(self):
        work = Path(self.tmp.name) / "work"
        graph = {"save": {"class_type": "SaveImage", "inputs": {"filename_prefix": "x"}}}
        splat.run_stage(self.client, work, "preview", graph, timeout=1, poll=0.01)
        edited = {"save": {"class_type": "SaveImage", "inputs": {"filename_prefix": "y"}}}
        with self.assertRaisesRegex(splat.PipelineError, "different preview graph"):
            splat.run_stage(self.client, work, "preview", edited, timeout=1, poll=0.01)
        self.assertEqual([p for p, _ in self.posts if p == "/prompt"], ["/prompt"])


if __name__ == "__main__":
    unittest.main()
