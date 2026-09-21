"""Live concurrency probe: N simultaneous `/predict` calls must all succeed.

This is the test that 35 passing unit tests could not be. The bug it guards
against — HuggingFace's fast tokeniser raising `RuntimeError: Already borrowed`
when two threads call it at once — is unreachable sequentially by construction,
so no amount of single-request verification finds it. It cost an eval run: 1 of
86 routes answered, 43 `engine_error` and 42 `engine_unavailable`, while
`/health` stayed green throughout, because the container was genuinely healthy
and only the requests were dying.

Stdlib only (`urllib`, `threading`, `unittest`) and SKIPPED when no engine
answers, so `python -m unittest discover` stays green on a laptop:

    # inside the engine container, where it is a real test
    docker exec openjev python -m unittest discover -s /opt/openjev/tests

    # or point it anywhere
    OPENJEV_ENGINE_URL=http://127.0.0.1:8099 python -m unittest \\
        discover -s services/openjev-engine/tests
"""

from __future__ import annotations

import json
import os
import threading
import unittest
import urllib.error
import urllib.request

ENGINE_URL = os.environ.get("OPENJEV_ENGINE_URL", "http://127.0.0.1:8099").rstrip("/")

#: Enough threads to guarantee overlap inside one forward pass. The eval that
#: found the bug ran far more; four is sufficient to lose the race reliably and
#: keeps the test to a few seconds.
CONCURRENCY = int(os.environ.get("OPENJEV_TEST_CONCURRENCY", "6"))

REQUEST_TIMEOUT_S = float(os.environ.get("OPENJEV_TEST_TIMEOUT", "180"))


def _post(path: str, payload: dict, timeout: float = REQUEST_TIMEOUT_S) -> dict:
    request = urllib.request.Request(
        f"{ENGINE_URL}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read())


def _engine_available() -> bool:
    try:
        with urllib.request.urlopen(f"{ENGINE_URL}/health", timeout=5) as response:
            return json.loads(response.read()).get("status") in ("ok", "degraded")
    except Exception:  # noqa: BLE001 — absence is a skip, not a failure
        return False


AVAILABLE = _engine_available()


def _request(index: int) -> dict:
    """A request shaped like a real route: a choice, a score and a noul.

    Deliberately varied per thread — different option counts and a different
    `max_len` — because the shared state at risk is not only the tokeniser's
    truncation settings but `encoder.max_len`, which this engine sets per
    request. Identical requests could mask a mutation race by writing the same
    value.
    """
    options = {f"opt-{i}": f"Rubric number {i} for a plausible routing target." for i in range(3 + index)}
    options["none"] = "Nothing here applies."
    return {
        "state": {"user_request": f"concurrent request {index}: diagnose a hanging gateway"},
        "max_len": 1024 + 256 * index,
        "questions": {
            "route": {
                "type": "choice",
                "instructions": "Which option should handle this request?",
                "criteria": options,
            },
            "urgency": {"type": "score", "instructions": "How urgent?", "criteria": ["low", "high"]},
            "live": {"type": "noul", "instructions": "A running system is being diagnosed."},
        },
    }


@unittest.skipUnless(AVAILABLE, f"no openjev engine answering at {ENGINE_URL}")
class Concurrency(unittest.TestCase):
    def test_simultaneous_predicts_all_succeed(self):
        """Threads, not a loop. A loop cannot reach this bug."""
        results: dict = {}
        errors: dict = {}
        start = threading.Barrier(CONCURRENCY)

        def worker(index: int) -> None:
            try:
                # Every thread waits here and is released together, so the
                # overlap is guaranteed rather than hoped for.
                start.wait(timeout=30)
                results[index] = _post("/predict", _request(index))
            except urllib.error.HTTPError as exc:
                errors[index] = f"HTTP {exc.code}: {exc.read().decode(errors='replace')[:300]}"
            except Exception as exc:  # noqa: BLE001
                errors[index] = f"{type(exc).__name__}: {exc}"

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(CONCURRENCY)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=REQUEST_TIMEOUT_S + 30)

        self.assertEqual(errors, {}, f"{len(errors)}/{CONCURRENCY} concurrent requests failed")
        self.assertEqual(len(results), CONCURRENCY)

    def test_every_concurrent_answer_is_complete_and_its_own(self):
        """Serialising must not let one request's state leak into another's.

        `encoder.max_len` is shared and set per request; if the critical section
        were too narrow, a request could be scored under a neighbour's budget.
        Each thread asks for a distinct option count and budget and must get its
        own back.
        """
        results: dict = {}
        errors: dict = {}
        start = threading.Barrier(CONCURRENCY)

        def worker(index: int) -> None:
            try:
                start.wait(timeout=30)
                results[index] = _post("/predict", _request(index))
            except Exception as exc:  # noqa: BLE001
                errors[index] = f"{type(exc).__name__}: {exc}"

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(CONCURRENCY)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=REQUEST_TIMEOUT_S + 30)
        self.assertEqual(errors, {}, "concurrent requests failed")

        for index, payload in results.items():
            expected_options = 4 + index  # 3 + index generated, plus `none`
            route = payload["answers"]["route"]
            self.assertEqual(len(route["probabilities"]), expected_options, index)
            self.assertEqual(len(route["scores"]), expected_options, index)
            self.assertIn(route["choice"], route["probabilities"], index)
            self.assertEqual(payload["engine"]["max_len"], 1024 + 256 * index, index)
            self.assertIn("queue_ms", payload["engine"])
            self.assertEqual(set(payload["answers"]), {"route", "urgency", "live"}, index)


if __name__ == "__main__":
    unittest.main()
