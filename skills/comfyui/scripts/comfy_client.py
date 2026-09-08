#!/usr/bin/env python3
"""ComfyUI HTTP client with durable submissions; Python standard library only.

Timeout means observation stopped, never permission to resubmit a GPU job.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


class ComfyError(RuntimeError):
    pass


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".receipt-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def validate_graph(graph, nodes):
    """Check API shape and available node schemas; server remains final validator."""
    errors = []
    if not isinstance(graph, dict) or not graph or "nodes" in graph:
        raise ComfyError("Expected nonempty API-format node dictionary, not a UI workflow")
    dependencies = {}
    for node_id, node in graph.items():
        if not isinstance(node_id, str) or not isinstance(node, dict):
            errors.append(f"{node_id}: malformed node")
            continue
        kind = node.get("class_type")
        if not isinstance(kind, str) or kind not in nodes:
            errors.append(f"{node_id}: unavailable class_type {kind}")
            continue
        schema = nodes[kind]
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            errors.append(f"{node_id}: inputs must be an object")
            continue
        definitions = schema.get("input", {})
        fields = {**definitions.get("required", {}), **definitions.get("optional", {})}
        # V3 menus put choices in metadata. Dynamic menu children use flattened
        # names (for example format.codec). Missing children may be defaulted by
        # the server; validate supplied selections without inventing requirements.
        pending = list(fields.items())
        while pending:
            name, definition = pending.pop()
            if definition[0] != "COMFY_DYNAMICCOMBO_V3" or name not in inputs:
                continue
            value = inputs[name]
            options = definition[1].get("options", [])
            if not isinstance(value, str):
                continue  # Linked values are checked below and by the server.
            selected = next((option for option in options if option["key"] == value), None)
            if selected is None:
                errors.append(f"{node_id}.{name}: value is not an available option: {value}")
                continue
            nested = selected.get("inputs", {})
            for child, child_definition in {**nested.get("required", {}), **nested.get("optional", {})}.items():
                full_name = name + "." + child
                fields[full_name] = child_definition
                pending.append((full_name, child_definition))
        for name in definitions.get("required", {}):
            if name not in inputs:
                errors.append(f"{node_id}: missing required input {name}")
        dependencies[node_id] = []
        for name, value in inputs.items():
            # Some custom nodes expand dynamic inputs; allow unknown names and let
            # ComfyUI validate them. Known inputs receive structural validation.
            expected = fields.get(name, [None])[0]
            if expected == "COMBO":
                expected = fields[name][1].get("options", [])
            if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and isinstance(value[1], int) and not isinstance(value[1], bool):
                source, slot = value
                origin = graph.get(source)
                if not isinstance(origin, dict):
                    errors.append(f"{node_id}.{name}: dangling link to {source}")
                    continue
                dependencies[node_id].append(source)
                origin_kind = origin.get("class_type")
                outputs = nodes.get(origin_kind, {}).get("output", []) if isinstance(origin_kind, str) else []
                if slot < 0 or slot >= len(outputs):
                    errors.append(f"{node_id}.{name}: invalid output slot {slot}")
                elif isinstance(expected, str) and expected != "*" and outputs[slot] != "*" and outputs[slot] not in expected.split(","):
                    errors.append(f"{node_id}.{name}: link type {outputs[slot]} != {expected}")
            elif isinstance(expected, list) and value not in expected:
                errors.append(f"{node_id}.{name}: value is not an available option: {value}")
            elif expected in ("INT", "FLOAT", "STRING", "BOOLEAN"):
                valid = {"INT": isinstance(value, int) and not isinstance(value, bool),
                         "FLOAT": isinstance(value, (int, float)) and not isinstance(value, bool),
                         "STRING": isinstance(value, str), "BOOLEAN": isinstance(value, bool)}[expected]
                if not valid:
                    errors.append(f"{node_id}.{name}: expected {expected}")
    visiting, visited = set(), set()
    def visit(node_id):
        if node_id in visiting:
            errors.append(f"{node_id}: cyclic dependency")
            return
        if node_id in visited:
            return
        visiting.add(node_id)
        for source in dependencies.get(node_id, []):
            visit(source)
        visiting.remove(node_id)
        visited.add(node_id)
    for node_id in dependencies:
        visit(node_id)
    if not any(nodes.get(n.get("class_type"), {}).get("output_node") for n in graph.values() if isinstance(n, dict) and isinstance(n.get("class_type"), str)):
        errors.append("Workflow has no available output node")
    if errors:
        raise ComfyError("Workflow validation failed:\n" + "\n".join(errors))
    return {"valid": True, "nodes": len(graph)}


class Client:
    def __init__(self, url=None, request_timeout=30):
        self.url = (url or os.environ.get("COMFYUI_URL", "http://comfyui:8188")).rstrip("/")
        parsed = urllib.parse.urlsplit(self.url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.query or parsed.fragment:
            raise ComfyError("ComfyUI URL must be an HTTP(S) base URL")
        self.request_timeout = request_timeout

    def request(self, path, payload=None):
        request = urllib.request.Request(self.url + path,
            data=None if payload is None else json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=self.request_timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read(8192).decode(errors="replace")
            raise ComfyError(f"HTTP {error.code} {path}: {detail}") from error
        except (OSError, ValueError) as error:
            raise ComfyError(f"Request failed {path}: {error}") from error

    def health(self):
        return {"url": self.url, "system_stats": self.request("/system_stats"),
                "node_count": len(self.request("/object_info"))}

    def validate(self, graph):
        return validate_graph(graph, self.request("/object_info"))

    def submit(self, graph, receipt_path):
        self.validate(graph)
        receipt_path = Path(receipt_path)
        receipt_path.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive reservation prevents concurrent callers from overwriting a job.
        try:
            with receipt_path.open("x") as stream:
                stream.write('{}\n')
        except FileExistsError as error:
            raise ComfyError(f"Receipt exists; inspect/resume it: {receipt_path}") from error
        receipt = {"version": 1, "url": self.url, "client_id": str(uuid.uuid4()),
                   "workflow_sha256": hashlib.sha256(json.dumps(graph, sort_keys=True).encode()).hexdigest(),
                   "state": "submitting", "created_at": time.time(), "workflow": graph}
        atomic_json(receipt_path, receipt)
        try:
            result = self.request("/prompt", {"prompt": graph, "client_id": receipt["client_id"]})
            if not result.get("prompt_id"):
                raise ComfyError(f"Submission returned no prompt_id: {result}")
            receipt.update(prompt_id=result["prompt_id"], state="submitted", response=result)
            atomic_json(receipt_path, receipt)
        except Exception as error:
            receipt.update(state="submission_unknown", error=str(error))
            atomic_json(receipt_path, receipt)
            raise ComfyError(f"Submission outcome uncertain; do not resubmit. Inspect receipt {receipt_path}: {error}") from error
        return receipt

    def observe(self, prompt_id):
        history = self.request("/history/" + urllib.parse.quote(prompt_id, safe=""))
        record = history.get(prompt_id)
        if record:
            status = record.get("status", {})
            messages = status.get("messages", [])
            if status.get("status_str") == "error" or any(m[0] in ("execution_error", "execution_interrupted") for m in messages if isinstance(m, list) and m):
                return {"state": "failed", "history": record}
            if status.get("completed") is True:
                return {"state": "completed", "history": record}
        queue = self.request("/queue")
        for key, state in (("queue_running", "running"), ("queue_pending", "queued")):
            if any(isinstance(row, list) and len(row) > 1 and row[1] == prompt_id for row in queue.get(key, [])):
                return {"state": state}
        # Absence can be a history race, eviction or restart. Never infer success
        # or create a replacement job from absence alone.
        return {"state": "unknown", "history": record}

    def resume(self, receipt_path, timeout=600, poll=2):
        receipt = json.loads(Path(receipt_path).read_text())
        if receipt.get("url") != self.url:
            raise ComfyError("Receipt belongs to a different ComfyUI URL")
        if not receipt.get("prompt_id"):
            raise ComfyError("Receipt has no prompt_id; inspect server queue/history using client_id before any resubmission")
        deadline = time.monotonic() + max(timeout, 0)
        while True:
            try:
                observation = self.observe(receipt["prompt_id"])
                receipt.update(observation, observed_at=time.time())
                receipt.pop("observation_error", None)
            except ComfyError as error:
                receipt.update(observation_error=str(error), observed_at=time.time())
            atomic_json(receipt_path, receipt)
            if receipt["state"] in ("completed", "failed"):
                return receipt
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Observation timed out; job {receipt['prompt_id']} preserved in {receipt_path}; resume that receipt")
            time.sleep(min(max(poll, 0.01), max(0, deadline - time.monotonic())))

    def download_outputs(self, history, outdir):
        root = Path(outdir)
        root.mkdir(parents=True, exist_ok=True)
        saved, seen = [], set()
        for node_id, output in history.get("outputs", {}).items():
            for kind in ("images", "gifs", "videos"):
                for item in output.get(kind, []):
                    filename = item.get("filename", "")
                    if not filename or Path(filename).name != filename or "\\" in filename or filename in (".", ".."):
                        raise ComfyError(f"Unsafe output filename: {filename!r}")
                    query = {"filename": filename, "subfolder": item.get("subfolder", ""), "type": item.get("type", "output")}
                    identity = json.dumps(query, sort_keys=True)
                    if identity in seen:
                        continue
                    seen.add(identity)
                    # Different nodes/subfolders can share a basename.
                    destination = root / (hashlib.sha256(identity.encode()).hexdigest()[:12] + "-" + filename)
                    fd, temporary = tempfile.mkstemp(prefix=".download-", dir=root)
                    digest, size = hashlib.sha256(), 0
                    try:
                        with os.fdopen(fd, "wb") as stream, urllib.request.urlopen(self.url + "/view?" + urllib.parse.urlencode(query), timeout=max(120, self.request_timeout)) as response:
                            while chunk := response.read(1024 * 1024):
                                stream.write(chunk)
                                digest.update(chunk)
                                size += len(chunk)
                            stream.flush()
                            os.fsync(stream.fileno())
                        if os.path.getsize(temporary) == 0:
                            raise ComfyError(f"Empty output: {filename}")
                        os.replace(temporary, destination)
                    finally:
                        if os.path.exists(temporary):
                            os.unlink(temporary)
                    saved.append({"node_id": node_id, "kind": kind, "path": str(destination.resolve()), "sha256": digest.hexdigest(), "bytes": size, **query})
        return saved


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=None)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("health")
    commands.add_parser("object-info")
    validate = commands.add_parser("validate")
    validate.add_argument("workflow")
    submit = commands.add_parser("submit")
    submit.add_argument("workflow")
    submit.add_argument("--receipt", required=True)
    resume = commands.add_parser("resume")
    resume.add_argument("receipt")
    resume.add_argument("--timeout", type=float, default=600)
    resume.add_argument("--poll", type=float, default=2)
    download = commands.add_parser("download")
    download.add_argument("receipt")
    download.add_argument("--outdir", required=True)
    args = parser.parse_args()
    try:
        receipt = json.loads(Path(args.receipt).read_text()) if args.command in ("resume", "download") else None
        client = Client(args.url or (receipt or {}).get("url"))
        if receipt and client.url != receipt.get("url"):
            raise ComfyError("Receipt belongs to a different ComfyUI URL")
        if args.command == "health":
            result = client.health()
        elif args.command == "object-info":
            result = client.request("/object_info")
        elif args.command in ("validate", "submit"):
            graph = json.loads(Path(args.workflow).read_text())
            result = client.validate(graph) if args.command == "validate" else client.submit(graph, args.receipt)
        elif args.command == "resume":
            result = client.resume(args.receipt, args.timeout, args.poll)
            if result["state"] == "failed":
                print(json.dumps(result, indent=2))
                return 1
        else:
            if receipt.get("state") != "completed":
                raise ComfyError("Only completed receipts can be downloaded")
            result = client.download_outputs(receipt["history"], args.outdir)
            receipt["downloads"] = result
            atomic_json(args.receipt, receipt)
        print(json.dumps(result, indent=2))
        return 0
    except TimeoutError as error:
        print(json.dumps({"error": str(error), "resumable": True}))
        return 2
    except (ComfyError, OSError, ValueError) as error:
        print(json.dumps({"error": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
