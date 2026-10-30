import importlib.util
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location("comfy_client", Path(__file__).parents[1] / "comfy_client.py")
comfy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(comfy)

NODES = {
    "Source": {"input": {"required": {"model": [["installed.safetensors"]]}}, "output": ["IMAGE"]},
    "Save": {"input": {"required": {"image": ["IMAGE"]}}, "output": [], "output_node": True},
}
GRAPH = {"1": {"class_type": "Source", "inputs": {"model": "installed.safetensors"}},
         "2": {"class_type": "Save", "inputs": {"image": ["1", 0]}}}


class HarnessTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.receipt = Path(self.tmp.name) / "receipt.json"
        self.posts = 0
        self.phase = "running"
        self.reject = False
        self.download_queries = []
        self.log = []
        self.queue_state = None  # None: derive from phase
        self.vram_free = None
        self.slow_object_info = False
        self.stats_fail = False
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def reply(self, data, status=200):
                self.send_response(status)
                self.end_headers()
                self.wfile.write(json.dumps(data).encode())
            def do_POST(self):
                length = int(self.headers["Content-Length"])
                if self.path in ("/free", "/interrupt", "/queue"):
                    owner.log.append(("POST", self.path, json.loads(self.rfile.read(length))))
                    return self.reply({})
                owner.posts += 1
                owner.submission = json.loads(self.rfile.read(length))
                journal = json.loads(owner.receipt.read_text())
                assert journal["state"] == "submitting"
                if owner.reject:
                    self.reply({"error": "bad graph", "node_errors": {"1": "bad model"}}, 400)
                else:
                    self.reply({"prompt_id": "job-123", "node_errors": {}})
            def do_GET(self):
                owner.log.append(("GET", self.path))
                if self.path == "/system_stats":
                    if owner.stats_fail:
                        return self.reply({}, 500)
                    device = {"name": "test GPU"}
                    if owner.vram_free is not None:
                        device.update(vram_free=owner.vram_free, vram_total=24 * 1024**3)
                    self.reply({"devices": [device]})
                elif self.path == "/object_info":
                    if owner.slow_object_info:
                        import time
                        time.sleep(1.0)
                    self.reply(NODES)
                elif self.path.startswith("/view?"):
                    owner.download_queries.append(self.path)
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b"render bytes")
                elif self.path.startswith("/history/"):
                    if owner.phase == "offline":
                        self.reply({"error": "restarting"}, 503)
                    elif owner.phase == "failed":
                        self.reply({"job-123": {"status": {"completed": False, "status_str": "error", "messages": [["execution_error", {"exception_message": "OOM"}]]}, "outputs": {}}})
                    elif owner.phase == "completed":
                        self.reply({"job-123": {"status": {"completed": True, "status_str": "success"}, "outputs": {}}})
                    else:
                        self.reply({})
                elif self.path == "/queue" and owner.queue_state is not None:
                    self.reply(owner.queue_state)
                elif self.path == "/queue":
                    self.reply({"queue_running": [[1, "job-123", {}, {}]] if owner.phase == "running" else [], "queue_pending": []})
                else:
                    self.reply({}, 404)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.client = comfy.Client(f"http://127.0.0.1:{self.server.server_port}")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def test_health_and_validated_submission(self):
        self.assertEqual(self.client.health()["node_count"], 2)
        result = self.client.submit(GRAPH, self.receipt)
        self.assertEqual(result["prompt_id"], "job-123")
        self.assertEqual(self.submission["prompt"], GRAPH)
        with self.assertRaisesRegex(comfy.ComfyError, "Receipt exists"):
            self.client.submit(GRAPH, self.receipt)
        self.assertEqual(self.posts, 1)

    def test_timeout_resume_never_resubmits_and_empty_outputs_complete(self):
        self.client.submit(GRAPH, self.receipt)
        with self.assertRaises(TimeoutError):
            self.client.resume(self.receipt, timeout=0)
        saved = json.loads(self.receipt.read_text())
        self.assertEqual(saved["state"], "running")
        self.assertEqual(saved["prompt_id"], "job-123")
        self.phase = "completed"
        self.assertEqual(self.client.resume(self.receipt, timeout=0)["state"], "completed")
        self.assertEqual(self.posts, 1)

    def test_failed_generation_is_terminal_with_diagnostics(self):
        self.client.submit(GRAPH, self.receipt)
        self.phase = "failed"
        result = self.client.resume(self.receipt, timeout=0)
        self.assertEqual(result["state"], "failed")
        self.assertIn("OOM", json.dumps(result))

    def test_transient_poll_failure_keeps_handle(self):
        self.client.submit(GRAPH, self.receipt)
        self.phase = "offline"
        with self.assertRaises(TimeoutError):
            self.client.resume(self.receipt, timeout=0)
        saved = json.loads(self.receipt.read_text())
        self.assertEqual(saved["prompt_id"], "job-123")
        self.assertIn("503", saved["observation_error"])
        self.phase = "completed"
        self.assertEqual(self.client.resume(self.receipt, timeout=0)["state"], "completed")
        self.assertEqual(self.posts, 1)

    def test_history_absent_and_queue_absent_is_unknown_not_failed(self):
        self.client.submit(GRAPH, self.receipt)
        self.phase = "missing"
        with self.assertRaises(TimeoutError):
            self.client.resume(self.receipt, timeout=0)
        self.assertEqual(json.loads(self.receipt.read_text())["state"], "unknown")

    def test_rejected_submission_retains_journal(self):
        self.reject = True
        with self.assertRaisesRegex(comfy.ComfyError, "node_errors"):
            self.client.submit(GRAPH, self.receipt)
        journal = json.loads(self.receipt.read_text())
        self.assertEqual(journal["state"], "submission_unknown")
        self.assertIn("client_id", journal)
        with self.assertRaisesRegex(comfy.ComfyError, "no prompt_id"):
            self.client.resume(self.receipt, timeout=0)
        self.assertEqual(self.posts, 1)

    def test_download_all_types_no_collisions_deduplicates_and_encodes(self):
        history = {"outputs": {"1": {
            "images": [{"filename": "same.png", "subfolder": "one"}],
            "gifs": [{"filename": "same.png", "subfolder": "two & three"}],
            "videos": [{"filename": "movie.mp4"}, {"filename": "movie.mp4"}]}}}
        saved = self.client.download_outputs(history, Path(self.tmp.name) / "output")
        self.assertEqual(len(saved), 3)
        self.assertEqual(len({x["path"] for x in saved}), 3)
        self.assertTrue(all(Path(x["path"]).read_bytes() == b"render bytes" for x in saved))
        import hashlib
        self.assertTrue(all(x["sha256"] == hashlib.sha256(b"render bytes").hexdigest() for x in saved))
        self.assertTrue(all(x["bytes"] == len(b"render bytes") for x in saved))
        self.assertIn("subfolder=two+%26+three", self.download_queries[1])

    def test_download_rejects_path_traversal(self):
        history = {"outputs": {"1": {"videos": [{"filename": "../escape.mp4"}]}}}
        with self.assertRaisesRegex(comfy.ComfyError, "Unsafe"):
            self.client.download_outputs(history, self.tmp.name)
        self.assertEqual(self.download_queries, [])

    def test_graph_rejects_missing_model_node_and_link(self):
        for mutation, expected in [
            (lambda g: g["1"]["inputs"].update(model="missing"), "available option"),
            (lambda g: g["1"].update(class_type="Uninstalled"), "unavailable"),
            (lambda g: g["1"].update(class_type={"malformed": True}), "unavailable"),
            (lambda g: g["2"]["inputs"].update(image=["404", 0]), "dangling"),
            (lambda g: g["2"]["inputs"].update(image=["1", 99]), "invalid output slot"),
            (lambda g: g["2"].update(inputs={}), "missing required"),
        ]:
            graph = json.loads(json.dumps(GRAPH))
            mutation(graph)
            with self.subTest(expected=expected), self.assertRaisesRegex(comfy.ComfyError, expected):
                self.client.submit(graph, self.receipt)
        self.assertEqual(self.posts, 0)
        self.assertFalse(self.receipt.exists())

    def test_reject_ui_graph_and_cycle(self):
        with self.assertRaisesRegex(comfy.ComfyError, "API-format"):
            comfy.validate_graph({"nodes": []}, NODES)
        graph = {"1": {"class_type": "Save", "inputs": {"image": ["1", 0]}}}
        with self.assertRaisesRegex(comfy.ComfyError, "cyclic"):
            comfy.validate_graph(graph, NODES)

    def test_v3_combo_and_nested_dynamic_options(self):
        nodes = {"V3": {"input": {"required": {
            "model": ["COMBO", {"options": ["installed.safetensors"]}],
            "format": ["COMFY_DYNAMICCOMBO_V3", {"options": [{"key": "mp4", "inputs": {"required": {
                "codec": ["COMFY_DYNAMICCOMBO_V3", {"options": [{"key": "h264", "inputs": {}}]}]
            }}}]}]
        }}, "output": [], "output_node": True}}
        graph = {"1": {"class_type": "V3", "inputs": {"model": "installed.safetensors", "format": "mp4", "format.codec": "h264"}}}
        comfy.validate_graph(graph, nodes)
        for name, value in [("model", "missing.safetensors"), ("format", "unknown"), ("format.codec", "unknown")]:
            bad = json.loads(json.dumps(graph))
            bad["1"]["inputs"][name] = value
            with self.subTest(name=name), self.assertRaisesRegex(comfy.ComfyError, "available option"):
                comfy.validate_graph(bad, nodes)

    def test_expandable_image_inputs_match_fibo_schema(self):
        nodes = {
            "Image": {"input": {"required": {}}, "output": ["IMAGE", "LATENT"]},
            "Edit": {"input": {"required": {
                "images": ["COMFY_AUTOGROW_V3", {"min": 0, "names": ["image_1", "image_2"],
                    "template": {"input": {"required": {"image": ["IMAGE", {}]}}}}]
            }}, "output": [], "output_node": True},
        }
        graph = {"1": {"class_type": "Image", "inputs": {}},
                 "2": {"class_type": "Edit", "inputs": {"images.image_1": ["1", 0]}}}
        comfy.validate_graph(graph, nodes)
        graph["2"]["inputs"] = {}
        comfy.validate_graph(graph, nodes)  # min=0 generation needs no dummy group.
        graph["2"]["inputs"] = {"images.image_1": ["1", 1]}
        with self.assertRaisesRegex(comfy.ComfyError, "link type"):
            comfy.validate_graph(graph, nodes)
        graph["2"]["inputs"] = {"images.image_99": ["1", 0]}
        with self.assertRaisesRegex(comfy.ComfyError, "expandable input name"):
            comfy.validate_graph(graph, nodes)
        graph["2"]["inputs"] = {}
        nodes["Edit"]["input"]["required"]["images"][1]["min"] = 1
        with self.assertRaisesRegex(comfy.ComfyError, "too few"):
            comfy.validate_graph(graph, nodes)

    # --- item E: combo forms, capability snapshot, probe, safe_free, VRAM, cancel ---

    def test_combo_choices_reads_both_wire_forms(self):
        self.assertEqual(comfy.combo_choices([["a.safetensors", "b.safetensors"], {}]), ["a.safetensors", "b.safetensors"])
        self.assertEqual(comfy.combo_choices(["COMBO", {"options": ["a.safetensors"]}]), ["a.safetensors"])
        self.assertNotIn("COMBO", comfy.combo_choices(["COMBO", {"options": ["a.safetensors"]}]))
        self.assertEqual(comfy.combo_choices(["COMBO", {}]), [])
        self.assertIsNone(comfy.combo_choices(["IMAGE", {}]))
        self.assertIsNone(comfy.combo_choices(None))

    def test_capability_snapshot_new_combo_form_does_not_mark_installed_model_missing(self):
        nodes = {"Loader": {"input": {"required": {"ckpt": ["COMBO", {"options": ["installed.safetensors"]}]},
                                      "optional": {"lora": [["legacy.safetensors"], {}]}}, "output": ["MODEL"]}}
        manifest = {"required_nodes": ["Loader", "Absent"],
                    "required_models": {"Loader.ckpt": ["installed.safetensors", "gone.safetensors"],
                                        "Loader.lora": ["legacy.safetensors"], "Loader.nope": ["x"], "Absent.ckpt": ["x"]}}
        snap = comfy.capability_snapshot(manifest, nodes)
        status = {(i["kind"], i["name"], i.get("file")): i["status"] for i in snap["items"]}
        self.assertEqual(status[("node", "Loader", None)], "PASS")
        self.assertEqual(status[("node", "Absent", None)], "BLOCKED")
        self.assertEqual(status[("model", "Loader.ckpt", "installed.safetensors")], "PASS")
        self.assertEqual(status[("model", "Loader.ckpt", "gone.safetensors")], "BLOCKED")
        self.assertEqual(status[("model", "Loader.lora", "legacy.safetensors")], "PASS")
        self.assertEqual(status[("model", "Loader.nope", "x")], "BLOCKED")
        self.assertEqual(status[("model", "Absent.ckpt", "x")], "BLOCKED")
        self.assertEqual(snap["status"], "BLOCKED")
        self.assertEqual(comfy.capability_snapshot({"required_nodes": ["Loader"]}, nodes)["status"], "PASS")

    def test_probe_hits_system_stats_before_object_info(self):
        snap = self.client.probe({"required_nodes": ["Source"], "required_models": {"Source.model": ["installed.safetensors"]}})
        self.assertEqual(snap["status"], "PASS")
        paths = [e[1] for e in self.log if e[0] == "GET"]
        self.assertEqual(paths, ["/system_stats", "/object_info"])

    def test_probe_dead_stats_never_touches_object_info(self):
        self.stats_fail = True
        snap = self.client.probe()
        self.assertEqual((snap["status"], snap["stage"]), ("BLOCKED", "system_stats"))
        self.assertNotIn("/object_info", [e[1] for e in self.log])

    def test_slow_object_info_times_out_without_wedging(self):
        self.client.object_info_timeout = 0.2
        self.slow_object_info = True
        started = __import__("time").monotonic()
        snap = self.client.probe()
        self.assertLess(__import__("time").monotonic() - started, 0.9)
        self.assertEqual((snap["status"], snap["stage"]), ("BLOCKED", "object_info"))

    def test_safe_free_skips_when_queue_busy(self):
        self.queue_state = {"queue_running": [], "queue_pending": [[1, "other", {}, {}]]}
        result = self.client.safe_free(settle_s=0)
        self.assertTrue(result["skipped"])
        self.assertIn("not idle", result["reason"])
        self.assertFalse(result["success"])
        self.assertFalse([e for e in self.log if e[0] == "POST"])

    def test_safe_free_reports_vram_and_frees_once(self):
        self.phase = "completed"
        self.queue_state = {"queue_running": [], "queue_pending": []}
        self.vram_free = 1 * 1024**3
        result = self.client.safe_free(settle_s=0)
        self.assertFalse(result["skipped"])
        self.assertTrue(result["success"])
        self.assertEqual(result["vram_before"]["free"], 1 * 1024**3)
        self.assertIn("free", result["vram_after"])
        self.assertFalse(result["job_appeared_meanwhile"])
        self.assertEqual([e for e in self.log if e[0] == "POST"], [("POST", "/free", {"unload_models": True, "free_memory": True})])

    def test_safe_free_flags_job_that_appears_after_free_and_does_not_free_again(self):
        self.queue_state = {"queue_running": [], "queue_pending": []}
        owner = self
        real = self.client.request
        def request(path, payload=None, timeout=None):
            result = real(path, payload, timeout)
            if path == "/free":
                owner.queue_state = {"queue_running": [[1, "late", {}, {}]], "queue_pending": []}
            return result
        self.client.request = request
        result = self.client.safe_free(settle_s=0)
        self.assertTrue(result["job_appeared_meanwhile"])
        self.assertFalse(result["success"])
        self.assertEqual(len([e for e in self.log if e[:2] == ("POST", "/free")]), 1)

    def test_safe_free_default_settle_is_one_and_a_half_seconds(self):
        import inspect
        self.assertEqual(inspect.signature(comfy.Client.safe_free).parameters["settle_s"].default, 1.5)

    def test_safe_free_settles_before_reading_vram_after(self):
        self.queue_state = {"queue_running": [], "queue_pending": []}
        started = __import__("time").monotonic()
        self.client.safe_free(settle_s=0.3)
        self.assertGreaterEqual(__import__("time").monotonic() - started, 0.28)

    def _run_cli(self, *argv):
        import contextlib
        import io
        out = io.StringIO()
        with mock.patch("sys.argv", ["comfy_client.py", "--url", self.client.url, *argv]), contextlib.redirect_stdout(out):
            code = comfy.main()
        return code, json.loads(out.getvalue())

    def test_cli_safe_free_exits_zero_on_a_clean_free(self):
        self.queue_state = {"queue_running": [], "queue_pending": []}
        code, result = self._run_cli("safe-free", "--settle-s", "0")
        self.assertEqual((code, result["success"]), (0, True))

    def test_cli_safe_free_exits_three_when_skipped(self):
        self.queue_state = {"queue_running": [], "queue_pending": [[1, "other", {}, {}]]}
        code, result = self._run_cli("safe-free", "--settle-s", "0")
        self.assertEqual((code, result["success"], result["skipped"]), (3, False, True))

    def test_cli_safe_free_exits_three_when_a_job_appeared(self):
        self.queue_state = {"queue_running": [], "queue_pending": []}
        owner = self
        real = comfy.Client.request
        def request(client, path, payload=None, timeout=None):
            result = real(client, path, payload, timeout)
            if path == "/free":
                owner.queue_state = {"queue_running": [[1, "late", {}, {}]], "queue_pending": []}
            return result
        with mock.patch.object(comfy.Client, "request", request):
            code, result = self._run_cli("safe-free", "--settle-s", "0")
        self.assertEqual((code, result["success"], result["job_appeared_meanwhile"]), (3, False, True))

    def test_submit_records_vram_warning_but_still_submits(self):
        self.vram_free = 1 * 1024**3
        receipt = self.client.submit(GRAPH, self.receipt)
        self.assertTrue(receipt["vram_headroom"]["warning"])
        self.assertEqual(receipt["vram_headroom"]["floor_bytes"], 2 * 1024**3)
        self.assertTrue(json.loads(self.receipt.read_text())["vram_headroom"]["warning"])
        self.assertEqual(receipt["prompt_id"], "job-123")

    def test_submit_vram_ok_and_unknown_do_not_warn(self):
        self.vram_free = 8 * 1024**3
        self.assertFalse(self.client.submit(GRAPH, self.receipt)["vram_headroom"]["warning"])
        self.receipt.unlink()
        self.vram_free = None
        headroom = self.client.submit(GRAPH, self.receipt)["vram_headroom"]
        self.assertFalse(headroom["checked"])
        self.assertFalse(headroom["warning"])

    def test_cancel_pending_deletes_only_owned_id(self):
        self.client.submit(GRAPH, self.receipt)
        self.queue_state = {"queue_running": [], "queue_pending": [[1, "other", {}, {}], [2, "job-123", {}, {}]]}
        self.assertEqual(self.client.cancel(self.receipt)["action"], "queue_delete")
        self.assertEqual([e for e in self.log if e[0] == "POST"], [("POST", "/queue", {"delete": ["job-123"]})])

    def test_cancel_running_owned_interrupts_with_prompt_id_never_bare(self):
        self.client.submit(GRAPH, self.receipt)
        self.assertEqual(self.client.cancel(self.receipt)["action"], "interrupt")
        self.assertEqual([e for e in self.log if e[0] == "POST"], [("POST", "/interrupt", {"prompt_id": "job-123"})])
        self.assertEqual(json.loads(self.receipt.read_text())["cancel_requested"], "interrupt")

    def test_cancel_refuses_when_running_job_is_foreign(self):
        self.client.submit(GRAPH, self.receipt)
        self.queue_state = {"queue_running": [[1, "someone-else", {}, {}]], "queue_pending": []}
        result = self.client.cancel(self.receipt)
        self.assertFalse(result["cancelled"])
        self.assertFalse([e for e in self.log if e[0] == "POST"])

    def test_cancel_without_prompt_id_is_refused(self):
        self.reject = True
        with self.assertRaises(comfy.ComfyError):
            self.client.submit(GRAPH, self.receipt)
        with self.assertRaisesRegex(comfy.ComfyError, "no prompt_id"):
            self.client.cancel(self.receipt)
        self.assertFalse([e for e in self.log if e[0] == "POST" and e[1] != "/prompt"])


if __name__ == "__main__":
    unittest.main()
