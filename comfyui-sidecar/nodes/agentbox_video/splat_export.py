"""List a SplatKit COLMAP dataset as fetchable ComfyUI outputs, with sha256 (ADR-2175).

``SplatKit_SphereSfMDataset*`` writes ``images/`` and ``sparse/0/`` under
``<ComfyUI output>/<dataset>`` and returns only the folder path, so ``/history``
names no files and a remote client has nothing to fetch. This node walks the
dataset and returns one ``ui.files`` entry per file (``filename``, ``subfolder``
relative to the output root, ``type: output``, ``sha256``, ``bytes``); the client
fetches each through ``/view`` and checks the hash. No volume is shared.

Standard library only; nothing here imports torch.
"""
import hashlib
import json
import os
from pathlib import Path

SCHEMA = "agentbox-splat-dataset/1"
DEFAULT_INCLUDE = "images,sparse"


def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def output_root() -> Path:
    import folder_paths  # ComfyUI only

    return Path(folder_paths.get_output_directory())


def dataset_files(root, model_dir, include=DEFAULT_INCLUDE):
    """Return ``(dataset_rel, entries)`` for every file under the included top-level folders.

    ``model_dir`` may be absolute or relative to ``root``; anything resolving outside
    ``root`` is refused, as is a dataset with no files in the included folders.
    Symlinks are followed only when their target stays inside ``root``.
    """
    root = Path(root).resolve()
    dataset = (root / model_dir).resolve()
    if dataset == root or root not in dataset.parents:
        raise ValueError(f"dataset is not inside the output directory: {model_dir}")
    if not dataset.is_dir():
        raise ValueError(f"dataset directory does not exist: {model_dir}")
    folders = [part.strip().strip("/") for part in include.split(",") if part.strip()]
    if not folders or any(part in ("", ".", "..") or "/" in part for part in folders):
        raise ValueError(f"include must name top-level dataset folders: {include!r}")
    entries = []
    for folder in folders:
        base = dataset / folder
        if not base.is_dir():
            continue
        for directory, _, names in sorted(os.walk(base, followlinks=False)):
            for name in sorted(names):
                path = Path(directory) / name
                real = path.resolve()
                if root not in real.parents or not real.is_file():
                    raise ValueError(f"dataset file escapes the output directory: {path}")
                rel = path.parent.relative_to(root).as_posix()
                entries.append({"filename": name, "subfolder": rel, "type": "output",
                                "sha256": sha256_file(real), "bytes": real.stat().st_size,
                                "path": path.relative_to(dataset).as_posix()})
    if not entries:
        raise ValueError(f"no files under {folders} in {model_dir}")
    return dataset.relative_to(root).as_posix(), entries


def manifest(dataset_rel, entries):
    return {"schema": SCHEMA, "dataset": dataset_rel, "files": len(entries),
            "bytes": sum(e["bytes"] for e in entries),
            "entries": [{k: e[k] for k in ("path", "sha256", "bytes")} for e in entries]}


class AgentboxSplatDatasetExport:
    """Expose a COLMAP dataset's files as ``ui.files`` outputs for /view download."""

    CATEGORY = "agentbox/splat"
    FUNCTION = "export"
    OUTPUT_NODE = True
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("manifest_json",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model_dir": ("STRING", {"forceInput": True,
                                     "tooltip": "model_dir from SplatKit_SphereSfMDataset*"}),
            "include": ("STRING", {"default": DEFAULT_INCLUDE,
                                   "tooltip": "comma-separated top-level folders to list"}),
        }}

    def export(self, model_dir, include=DEFAULT_INCLUDE):
        dataset_rel, entries = dataset_files(output_root(), model_dir, include)
        files = [{k: e[k] for k in ("filename", "subfolder", "type", "sha256", "bytes")} for e in entries]
        text = json.dumps(manifest(dataset_rel, entries), sort_keys=True)
        return {"ui": {"files": files, "splat_dataset": [dataset_rel]}, "result": (text,)}


NODE_CLASS_MAPPINGS = {"AgentboxSplatDatasetExport": AgentboxSplatDatasetExport}
NODE_DISPLAY_NAME_MAPPINGS = {"AgentboxSplatDatasetExport": "Splat dataset export (sha256)"}
