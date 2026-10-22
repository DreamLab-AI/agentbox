"""Lifecycle tests for the Isaac Sim job runner, run with a stub interpreter (no GPU, no image).

    python3 -I -m unittest tests/isaac-sim/test_runner.py -v

They cover the runner's own contract (ADR-2149): idempotent submit, queueing under a
concurrency cap, manifest-only-after-validation, per-job cancel, honest `lost` after restart.
They do not, and cannot, show that Isaac Sim itself steps physics; that is the smoke jobs' task.
"""
import importlib.util
import json
import os
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
RUNNER = os.path.join(HERE, "..", "..", "isaac-sim-sidecar", "runner", "isaac_runner.py")


def load(root, **env):
    os.environ.update({"ISAAC_RUNNER_ROOT": root, "ISAAC_PYTHON": sys.executable,
                       "ISAAC_MIN_FREE_GIB": "0", "ISAAC_RUNNER_VERSIONS": os.path.join(root, "v.json"),
                       **{k: str(v) for k, v in env.items()}})
    spec = importlib.util.spec_from_file_location("isaac_runner_under_test", RUNNER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def wait_for(mod, jid, states, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        s, _ = mod.job_state(jid)
        if s in states:
            return s
        time.sleep(0.05)
    raise AssertionError(f"{jid} stuck in {mod.job_state(jid)[0]}, wanted {states}")


class RunnerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        os.makedirs(os.path.join(self.root, "inbox"))

    def tearDown(self):
        self.tmp.cleanup()

    def script(self, name, body):
        path = os.path.join(self.root, "inbox", name)
        with open(path, "w") as fh:
            fh.write(body)
        return f"inbox/{name}"

    def test_success_writes_manifest_only_after_validation(self):
        r = load(self.root)
        s = self.script("ok.py", "import os;open(os.path.join(os.environ['ISAAC_JOB_DIR'],'out.json'),'w').write('{}')")
        status, body = r.submit({"script": s, "required_outputs": ["out.json"], "kind": "smoke:fall"})
        self.assertEqual(status, 202)
        wait_for(r, body["id"], {"succeeded"})
        with open(os.path.join(r.job_dir(body["id"]), "manifest.json")) as fh:
            manifest = json.load(fh)
        self.assertEqual(manifest["artefacts"][0]["name"], "out.json")
        self.assertEqual(len(manifest["artefacts"][0]["sha256"]), 64)
        self.assertFalse(r.capabilities()["health"]["physics_stepping"], "a client label must not raise health")

    def test_health_rises_only_for_the_baked_fixture_with_a_passing_verification(self):
        baked = os.path.join(self.root, "baked")
        os.makedirs(baked)
        body = ("import json,os\nd=os.environ['ISAAC_JOB_DIR']\n"
                "open(d+'/verification.json','w').write(json.dumps({'pass': PASS}))\n"
                "open(d+'/motion.json','w').write('{}')\n")
        for name in ("fall_box.py",):
            with open(os.path.join(baked, name), "w") as fh:
                fh.write(body.replace("PASS", "True"))
        r = load(self.root, ISAAC_BAKED_FIXTURES=baked)
        shared = os.path.join(self.root, "fixtures", "fixtures")
        os.makedirs(shared)
        # 1. shared copy tampered with: same name and path, different bytes -> must not count
        with open(os.path.join(shared, "fall_box.py"), "w") as fh:
            fh.write(body.replace("PASS", "True") + "# tampered\n")
        _, a = r.submit({"script": "fixtures/fixtures/fall_box.py", "required_outputs": ["motion.json"]})
        wait_for(r, a["id"], {"succeeded"})
        self.assertFalse(r.capabilities()["health"]["physics_stepping"])
        # 2. the genuine bytes, but the verification says fail -> must not count
        with open(os.path.join(shared, "fall_box.py"), "w") as fh:
            fh.write(body.replace("PASS", "False"))
        with open(os.path.join(baked, "fall_box.py"), "w") as fh:
            fh.write(body.replace("PASS", "False"))
        _, b = r.submit({"script": "fixtures/fixtures/fall_box.py", "required_outputs": ["motion.json"]})
        wait_for(r, b["id"], {"succeeded"})
        self.assertFalse(r.capabilities()["health"]["physics_stepping"])
        # 3. genuine bytes and a passing verification -> counts
        for d in (shared, baked):
            with open(os.path.join(d, "fall_box.py"), "w") as fh:
                fh.write(body.replace("PASS", "True"))
        _, c = r.submit({"script": "fixtures/fixtures/fall_box.py", "required_outputs": ["motion.json"], "seed": 3})
        wait_for(r, c["id"], {"succeeded"})
        health = r.capabilities()["health"]
        self.assertTrue(health["physics_stepping"] and health["simulator_initialised"])
        self.assertFalse(health["gpu_rendering"])

    def test_missing_required_output_fails_without_manifest(self):
        r = load(self.root)
        s = self.script("noout.py", "pass")
        _, body = r.submit({"script": s, "required_outputs": ["never.json"]})
        wait_for(r, body["id"], {"failed"})
        self.assertFalse(os.path.exists(os.path.join(r.job_dir(body["id"]), "manifest.json")))
        self.assertIn("missing", r.describe(body["id"])["failure"])

    def test_verbose_job_rotates_logs_and_retains_latest_output(self):
        r = load(self.root)
        r.MAX_LOG_BYTES = 65536
        s = self.script("verbose.py", "import sys\nsys.stdout.write('x' * (5 * 65536) + '\\nFINAL-MARKER\\n')\n")
        _, body = r.submit({"script": s})
        wait_for(r, body["id"], {"succeeded"})
        d = r.job_dir(body["id"])
        for name in ("job.log", "job.log.1"):
            self.assertLessEqual(os.path.getsize(os.path.join(d, name)), r.MAX_LOG_BYTES)
        with open(os.path.join(d, "job.log"), "rb") as fh:
            self.assertTrue(fh.read().endswith(b"FINAL-MARKER\n"))

    def test_small_log_messages_are_visible_while_the_job_runs(self):
        r = load(self.root)
        s = self.script("progress.py", "import sys,time\nprint('READY', flush=True)\ntime.sleep(30)\n")
        _, body = r.submit({"script": s})
        try:
            deadline = time.time() + 3
            while time.time() < deadline:
                text = r.safe_read(os.path.join(r.job_dir(body["id"]), "job.log")) or ""
                if "READY" in text:
                    break
                time.sleep(0.05)
            self.assertIn("READY", text)
            self.assertEqual(r.job_state(body["id"])[0], "running")
        finally:
            r.cancel(body["id"])

    def test_idempotent_submit_returns_same_job(self):
        r = load(self.root)
        s = self.script("same.py", "pass")
        _, a = r.submit({"script": s, "seed": 7})
        status, b = r.submit({"script": s, "seed": 7})
        self.assertEqual((status, b["id"], b["duplicate"]), (200, a["id"], True))
        _, c = r.submit({"script": s, "seed": 8})
        self.assertNotEqual(c["id"], a["id"])

    def test_concurrency_cap_queues_second_job(self):
        r = load(self.root, ISAAC_MAX_CONCURRENT=1)
        slow = self.script("slow.py", "import time;time.sleep(30)")
        _, a = r.submit({"script": slow, "seed": 1})
        _, b = r.submit({"script": slow, "seed": 2})
        wait_for(r, a["id"], {"running"})
        self.assertEqual(r.job_state(b["id"])[0], "queued")
        r.cancel(a["id"])
        wait_for(r, b["id"], {"running"})
        r.cancel(b["id"])

    def test_cancel_touches_only_the_addressed_job(self):
        r = load(self.root, ISAAC_MAX_CONCURRENT=2)
        slow = self.script("slow2.py", "import time;time.sleep(30)")
        _, a = r.submit({"script": slow, "seed": 1})
        _, b = r.submit({"script": slow, "seed": 2})
        wait_for(r, a["id"], {"running"})
        wait_for(r, b["id"], {"running"})
        r.cancel(a["id"])
        self.assertEqual(r.job_state(a["id"])[0], "cancelled")
        self.assertEqual(r.job_state(b["id"])[0], "running")
        self.assertTrue(os.path.exists(os.path.join(r.job_dir(a["id"]), "job.json")), "receipt preserved")
        r.cancel(b["id"])

    def test_restart_reports_interrupted_job_as_lost_and_never_reruns(self):
        r = load(self.root)
        s = self.script("orphan.py", "pass")
        _, a = r.submit({"script": s})
        wait_for(r, a["id"], {"failed", "succeeded"})
        d = r.job_dir(a["id"])
        os.remove(os.path.join(d, "exit_code"))  # simulate a kill before completion was recorded
        with open(os.path.join(d, "pid"), "w") as fh:
            fh.write("999999 1")  # a pid whose start time cannot match
        r2 = load(self.root)
        r2.reconcile()
        self.assertEqual(r2.job_state(a["id"])[0], "lost")
        self.assertIn("not resubmitted", r2.describe(a["id"])["failure"])

    def test_path_escape_and_symlink_refused(self):
        r = load(self.root)
        status, _ = r.submit({"script": "../etc/passwd"})
        self.assertEqual(status, 400)
        os.symlink("/etc/hostname", os.path.join(self.root, "inbox", "link.py"))
        status, body = r.submit({"script": "inbox/link.py"})
        self.assertEqual(status, 400)
        self.assertIn("symbolic link", body["error"])

    def test_insufficient_storage_rejected(self):
        r = load(self.root, ISAAC_MIN_FREE_GIB=10**9)
        s = self.script("x.py", "pass")
        status, _ = r.submit({"script": s})
        self.assertEqual(status, 507)


if __name__ == "__main__":
    unittest.main()
