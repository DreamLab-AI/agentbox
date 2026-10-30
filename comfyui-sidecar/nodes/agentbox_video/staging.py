"""Hash-verified disk hand-off between ComfyUI stages (LATENT and IMAGE tensors).

The planner emits one ComfyUI prompt per stage; stages exchange tensors through
disk. ComfyUI core already has ``SaveLatent``/``LoadLatent`` and
``SaveImage``/``LoadImage`` at the pinned rev, but none of them records or
checks a content hash, and core has no tensor-IMAGE file format. These nodes add
only that: a safetensors writer that reports the sha256, and a loader that takes
the expected sha256 and refuses a mismatch *before* parsing anything.

Core functions are numpy only (``safetensors.numpy``); torch is touched only
inside the node adapters.
"""
import hashlib
import json
import os
from pathlib import Path

import numpy as np

SCHEMA = "agentbox-staging/1"


class HashMismatch(ValueError):
    """The file's sha256 differs from the expected value (or none was given)."""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def staging_dir() -> Path:
    """Root for staged files: ``$AGENTBOX_STAGING_DIR`` or ``<ComfyUI output>/staging``."""
    env = os.environ.get("AGENTBOX_STAGING_DIR")
    if env:
        return Path(env)
    try:
        import folder_paths  # ComfyUI only

        return Path(folder_paths.get_output_directory()) / "staging"
    except ImportError:
        return Path("staging")


def resolve_under(base, rel) -> Path:
    """Resolve ``rel`` beneath ``base``; refuse anything that escapes it."""
    base = Path(base).resolve()
    p = (base / rel).resolve()
    if base != p and base not in p.parents:
        raise ValueError(f"path escapes staging directory: {rel}")
    return p


def save_arrays(base, prefix, arrays, kind, extra_meta=None):
    """Write ``arrays`` as a content-addressed safetensors file under ``base``.

    Float arrays are stored as float32. Returns ``(relative_path, sha256)``. The
    file name embeds the first 16 hex of the hash, so identical content maps to
    the same file and a changed tensor can never overwrite an earlier hand-off.
    """
    from safetensors.numpy import save as st_save

    prepared = {}
    for k, v in arrays.items():
        a = np.ascontiguousarray(v)
        if a.dtype.kind == "f" and a.dtype != np.float32:
            a = a.astype(np.float32)
        prepared[k] = a
    meta = {"schema": SCHEMA, "kind": kind}
    for k, v in (extra_meta or {}).items():
        meta[str(k)] = str(v)
    # One canonical-JSON metadata entry: safetensors serialises a multi-key
    # metadata map in nondeterministic order, which would break content addressing.
    data = st_save(prepared, metadata={"agentbox": json.dumps(meta, sort_keys=True, separators=(",", ":"))})
    digest = sha256_bytes(data)
    safe_prefix = Path(prefix).name or "stage"
    rel_dir = Path(prefix).parent
    rel = rel_dir / f"{safe_prefix}_{digest[:16]}.safetensors"
    out = resolve_under(base, rel)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, out)
    return str(rel), digest


def load_arrays(base, rel, expected_sha256, kind=None):
    """Read a staged file, verifying its sha256 first. Returns ``(arrays, metadata)``.

    The bytes are read once, hashed, and parsed from that same buffer, so the
    verified content is exactly the parsed content. An empty or malformed
    expected hash is refused outright rather than skipped.
    """
    from safetensors.numpy import load as st_load

    exp = (expected_sha256 or "").strip().lower()
    if len(exp) != 64 or any(c not in "0123456789abcdef" for c in exp):
        raise HashMismatch("expected_sha256 must be 64 hex characters; refusing unverified load")
    data = resolve_under(base, rel).read_bytes()
    got = sha256_bytes(data)
    if got != exp:
        raise HashMismatch(f"sha256 mismatch for {rel}: expected {exp}, file is {got}")
    arrays = st_load(data)
    meta = _read_metadata(data)
    if kind is not None and meta.get("kind") != kind:
        raise ValueError(f"{rel}: expected kind {kind!r}, file holds {meta.get('kind')!r}")
    return arrays, meta


def _read_metadata(data: bytes) -> dict:
    n = int.from_bytes(data[:8], "little")
    header = json.loads(data[8 : 8 + n])
    return json.loads(header.get("__metadata__", {}).get("agentbox", "{}"))


# ---------------------------------------------------------------- ComfyUI nodes
def _to_np(t):
    return t.detach().cpu().float().numpy()


def _from_np(a):
    import torch

    return torch.from_numpy(np.array(a))


class AgentboxSaveLatentVerified:
    CATEGORY = "agentbox/staging"
    FUNCTION = "save"
    OUTPUT_NODE = True
    RETURN_TYPES = ("LATENT", "STRING", "STRING")
    RETURN_NAMES = ("samples", "path", "sha256")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"samples": ("LATENT",), "filename_prefix": ("STRING", {"default": "latents/stage"})}}

    def save(self, samples, filename_prefix):
        rel, digest = save_arrays(staging_dir(), filename_prefix, {"latent_tensor": _to_np(samples["samples"])}, "latent")
        return {"ui": {"agentbox_staging": [{"path": rel, "sha256": digest, "kind": "latent"}]}, "result": (samples, rel, digest)}


class AgentboxLoadLatentVerified:
    CATEGORY = "agentbox/staging"
    FUNCTION = "load"
    RETURN_TYPES = ("LATENT",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"path": ("STRING", {"default": ""}), "expected_sha256": ("STRING", {"default": ""})}}

    @classmethod
    def IS_CHANGED(cls, path, expected_sha256):
        return expected_sha256

    def load(self, path, expected_sha256):
        arrays, _ = load_arrays(staging_dir(), path, expected_sha256, kind="latent")
        return ({"samples": _from_np(arrays["latent_tensor"])},)


class AgentboxSaveImageVerified:
    CATEGORY = "agentbox/staging"
    FUNCTION = "save"
    OUTPUT_NODE = True
    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("images", "path", "sha256")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",), "filename_prefix": ("STRING", {"default": "images/stage"})}}

    def save(self, images, filename_prefix):
        rel, digest = save_arrays(staging_dir(), filename_prefix, {"image_tensor": _to_np(images)}, "image")
        return {"ui": {"agentbox_staging": [{"path": rel, "sha256": digest, "kind": "image"}]}, "result": (images, rel, digest)}


class AgentboxLoadImageVerified:
    CATEGORY = "agentbox/staging"
    FUNCTION = "load"
    RETURN_TYPES = ("IMAGE",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"path": ("STRING", {"default": ""}), "expected_sha256": ("STRING", {"default": ""})}}

    @classmethod
    def IS_CHANGED(cls, path, expected_sha256):
        return expected_sha256

    def load(self, path, expected_sha256):
        arrays, _ = load_arrays(staging_dir(), path, expected_sha256, kind="image")
        return (_from_np(arrays["image_tensor"]),)


NODE_CLASS_MAPPINGS = {
    "AgentboxSaveLatentVerified": AgentboxSaveLatentVerified,
    "AgentboxLoadLatentVerified": AgentboxLoadLatentVerified,
    "AgentboxSaveImageVerified": AgentboxSaveImageVerified,
    "AgentboxLoadImageVerified": AgentboxLoadImageVerified,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AgentboxSaveLatentVerified": "Save Latent (hash-verified)",
    "AgentboxLoadLatentVerified": "Load Latent (hash-verified)",
    "AgentboxSaveImageVerified": "Save Image Tensor (hash-verified)",
    "AgentboxLoadImageVerified": "Load Image Tensor (hash-verified)",
}
