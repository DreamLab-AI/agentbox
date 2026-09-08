import importlib.util
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest

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
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def reply(self, data, status=200):
                self.send_response(status)
                self.end_headers()
                self.wfile.write(json.dumps(data).encode())
            def do_POST(self):
                owner.posts += 1
                owner.submission = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                journal = json.loads(owner.receipt.read_text())
                assert journal["state"] == "submitting"
                if owner.reject:
                    self.reply({"error": "bad graph", "node_errors": {"1": "bad model"}}, 400)
                else:
                    self.reply({"prompt_id": "job-123", "node_errors": {}})
            def do_GET(self):
                if self.path == "/system_stats":
                    self.reply({"devices": [{"name": "test GPU"}]})
                elif self.path == "/object_info":
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


if __name__ == "__main__":
    unittest.main()
