#!/usr/bin/env python3
"""Download pinned MiniMax H3 or LTX-2.3 weights with resumable transfer and SHA-256 verification."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.request

LTX23_MODELS = [
    dict(repo="Lightricks/LTX-2.3-fp8", revision="1d756cd27fa11c0896c4dfee093cd1bf36c7f7a1",
         file="ltx-2.3-22b-distilled-fp8.safetensors", directory="checkpoints",
         size=29531884062, sha256="d9646b6f2d5c42d337b23671634c43bfeece6989644f51b4a3aa088465ccd3b2"),
    dict(repo="Comfy-Org/ltx-2", revision="101c239b4b64dd1b45d645365339c56e0e7df4c3",
         file="split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors", directory="text_encoders",
         size=9447702218, sha256="aaca463d11e6d8d2a4bdb0d6299214c15ef78a3f73e0ef8113d5a9d0219b3f6d"),
]

H3_MODELS = [{'repo': 'Comfy-Org/MiniMax-H3',
  'revision': 'a98869194787969724c7425d95d0ed73ce9202af',
  'file': 'diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors',
  'directory': 'diffusion_models',
  'size': 20970379616,
  'sha256': 'e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a'},
 {'repo': 'Comfy-Org/MiniMax-H3',
  'revision': 'a98869194787969724c7425d95d0ed73ce9202af',
  'file': 'text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  'directory': 'text_encoders',
  'size': 15687142551,
  'sha256': '35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6'},
 {'repo': 'Comfy-Org/MiniMax-H3',
  'revision': 'a98869194787969724c7425d95d0ed73ce9202af',
  'file': 'vae/minimax_h3_audio_vae_fp32.safetensors',
  'directory': 'vae',
  'size': 605254808,
  'sha256': '8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48'},
 {'repo': 'Comfy-Org/MiniMax-H3',
  'revision': 'a98869194787969724c7425d95d0ed73ce9202af',
  'file': 'vae/minimax_h3_video_vae_fp16.safetensors',
  'directory': 'vae',
  'size': 5207808496,
  'sha256': '7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522'}]
H3_REFERENCE_MODEL = {'repo': 'Comfy-Org/MiniMax-H3',
 'revision': 'a98869194787969724c7425d95d0ed73ce9202af',
 'file': 'diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors',
 'directory': 'diffusion_models',
 'size': 20970379616,
 'sha256': '9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779'}
MODELS = H3_MODELS
PROFILES = {"h3": H3_MODELS, "h3-reference": H3_MODELS + [H3_REFERENCE_MODEL], "ltx23": LTX23_MODELS}



def verified(path, model):
    if not path.is_file() or path.stat().st_size != model["size"]:
        return False
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest() == model["sha256"]


def download(model, root, retries=5):
    target = root / model["directory"] / Path(model["file"]).name
    target.parent.mkdir(parents=True, exist_ok=True)
    # A process lock prevents two clients appending to the same partial file.
    with target.with_suffix(".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if verified(target, model):
            print(f"Verified existing {target}", flush=True)
            return target
        partial = target.with_suffix(target.suffix + ".part")
        url = f'https://huggingface.co/{model["repo"]}/resolve/{model["revision"]}/{model["file"]}'
        for attempt in range(retries):
            offset = partial.stat().st_size if partial.exists() else 0
            if offset >= model["size"]:
                if verified(partial, model):
                    os.replace(partial, target)
                    return target
                partial.unlink()
                offset = 0
            headers = {"User-Agent": "agentbox-video-model-downloader/1"}
            if offset:
                headers["Range"] = f"bytes={offset}-"
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as response:
                    if response.status == 206:
                        content_range = response.headers.get("Content-Range", "")
                        if not content_range.startswith(f"bytes {offset}-") or not content_range.endswith(f'/{model["size"]}'):
                            raise ValueError(f"Invalid Content-Range: {content_range}")
                    elif response.status == 200:
                        offset = 0  # Server ignored Range; restart safely.
                    else:
                        raise ValueError(f"Unexpected response status {response.status}")
                    print(f"Downloading {target.name} from byte {offset}/{model['size']}", flush=True)
                    with partial.open("ab" if offset else "wb") as stream:
                        for block in iter(lambda: response.read(8 * 1024 * 1024), b""):
                            stream.write(block)
                            if stream.tell() > model["size"]:
                                raise ValueError("Response exceeds pinned model size")
                        stream.flush()
                        os.fsync(stream.fileno())
                if not verified(partial, model):
                    if partial.stat().st_size == model["size"]:
                        partial.unlink()  # Corrupt complete transfers cannot be resumed.
                    raise ValueError(f"Size or SHA-256 mismatch for {target.name}")
                os.replace(partial, target)
                print(f"Verified {target}", flush=True)
                return target
            except (OSError, ValueError) as error:
                if attempt + 1 == retries:
                    raise RuntimeError(f"Download failed for {target.name}: {error}") from error
                print(f"Retry {attempt + 1}/{retries}: {error}", flush=True)
                time.sleep(min(2 ** attempt, 16))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=tuple(PROFILES), default="h3")
    parser.add_argument("--models-dir", type=Path, default=Path("/opt/ComfyUI/models"))
    parser.add_argument("--list", action="store_true", help="Print immutable manifest without downloading")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    if args.list:
        print(json.dumps(PROFILES[args.profile], indent=2))
        return
    for model in PROFILES[args.profile]:
        if args.verify_only:
            path = args.models_dir / model["directory"] / Path(model["file"]).name
            if not verified(path, model):
                parser.exit(1, f"Missing or invalid model: {path}\n")
            print(f"Verified {path}")
        else:
            download(model, args.models_dir)


if __name__ == "__main__":
    main()
