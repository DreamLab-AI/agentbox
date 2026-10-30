#!/usr/bin/env python3
"""Plan and provision pinned media model profiles with resumable SHA-256 verification."""
import argparse
import fcntl
import hashlib
import json
import os
import shutil
from pathlib import Path
import time
import urllib.request
import urllib.error

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
H3_CLAY_MODEL = dict(
    repo="akhaliq/MiniMax-H3-Claymation-Style-LoRA",
    revision="991e08146a349e00b1837e77f81f415586b19063",
    file="checkpoints/full_claymation_h3_v1_claymation_h3_v1.safetensors",
    directory="loras", size=155109840,
    sha256="0fac46be5b3498124f1bb596e9f9050338ae8028425650d5524ed40fce50f2f8")
PROFILES["h3-clay"] = H3_MODELS + [H3_CLAY_MODEL]
LTX25_REV = "49b093a39c19169a8a81721dcc541e07e945232f"
LTX25_MODELS = [
    dict(repo="Lightricks/LTX-2.5", revision=LTX25_REV,
         file="diffusion_models/ltx-2.5-22b-dev-transformer-comfy-int8-convrot.safetensors",
         directory="diffusion_models", size=21504034224,
         sha256="2edbdb4465cd6c3b532cd67a31ddb38a63e97dcad20be3729675e2a4e8caf92b"),
    dict(repo="Lightricks/LTX-2.5", revision=LTX25_REV,
         file="text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
         directory="text_encoders", size=15372969374,
         sha256="6ce688a0aa98a5fa36a9f1e6c3f42152a498cc2b53ee8c15674c64244f91487f"),
    dict(repo="Lightricks/LTX-2.5", revision=LTX25_REV,
         file="vae/ltx-2.5-audio-vae-bf16.safetensors", directory="vae", size=364866540,
         sha256="c52733d37f6a7fb7949c3dc0fb468c6cb2169e4d836983a73babb9f0d54837a5"),
    dict(repo="Lightricks/LTX-2.5", revision=LTX25_REV,
         file="vae/ltx-2.5-video-vae-bf16.safetensors", directory="vae", size=1472223346,
         sha256="847e14ca7f3355debca0cea4eaa24ac0fbcdf0061da054ac89ca638a869ddba3"),
    dict(repo="Lightricks/LTX-2.5", revision=LTX25_REV,
         file="latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
         directory="latent_upscale_models", size=995778752,
         sha256="eb5a71fe4068ee87ccdb1c3aa635e547ca76bd2d30ae20ae889f2c325c0677e8"),
    dict(repo="Lightricks/LTX-2.5-22b-IC-LoRA-Layout-To-Render",
         revision="349625f9bad639dc41f1c70d2c63f75a02a09c59",
         file="ltx-2.5-22b-ic-lora-layout-to-render-1.0.safetensors",
         directory="loras", size=1308787439,
         sha256="77567d81d71b4df558d622dffc0ec218ba1e22c69b2932f6fa12f34772697eae"),
]
LTX25_LAYOUT_MODELS = [dict(LTX25_MODELS[0],
    file="diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
    sha256="c4279eeff115cbeaca494bd2183e7d768c38fe85a184dc6afbb7159157c44334")] + LTX25_MODELS[1:]
PROFILES["ltx25-layout"] = LTX25_LAYOUT_MODELS

# Permissive face models for the agentbox_video identity nodes; mirrors
# comfyui-sidecar/nodes/agentbox_video/face_models.json (a test keeps them equal).
OPENCV_ZOO = "https://github.com/opencv/opencv_zoo/raw/48b10fa505aeb51fbd127fc60a5c660040e823b7/models"
PROFILES["face-identity"] = [
    dict(repo="opencv/opencv_zoo", revision="48b10fa505aeb51fbd127fc60a5c660040e823b7",
         file="face_detection_yunet_2023mar.onnx", directory="agentbox_face", size=232589,
         url=f"{OPENCV_ZOO}/face_detection_yunet/face_detection_yunet_2023mar.onnx",
         sha256="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"),
    dict(repo="opencv/opencv_zoo", revision="48b10fa505aeb51fbd127fc60a5c660040e823b7",
         file="face_recognition_sface_2021dec.onnx", directory="agentbox_face", size=38696353,
         url=f"{OPENCV_ZOO}/face_recognition_sface/face_recognition_sface_2021dec.onnx",
         sha256="0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"),
]
CAMPAIGN_PATH = Path(os.environ.get("COMFY_MODEL_MANIFEST", str(Path(__file__).resolve().parents[1] / "models" / "stopmotion-candidates.json")))
CAMPAIGN = json.loads(CAMPAIGN_PATH.read_text()) if CAMPAIGN_PATH.is_file() else {}
for profile_name, record in CAMPAIGN.get("profiles", {}).items():
    PROFILES[profile_name] = record["models"]


def selected_models(names):
    """Deduplicate shared components and reject destination/hash collisions."""
    selected = {}
    for name in names:
        for model in PROFILES[name]:
            destination = model["directory"] + "/" + Path(model["file"]).name
            if destination in selected and selected[destination]["sha256"] != model["sha256"]:
                raise ValueError(f"Conflicting weights target {destination}")
            selected[destination] = model
    return list(selected.values())


def provision_plan(names, root, url=None):
    """Inspect downloads and live schemas without loading models or submitting jobs."""
    models = selected_models(names)
    files = []
    missing = 0
    for model in models:
        target = root / model["directory"] / Path(model["file"]).name
        size_matches = target.is_file() and target.stat().st_size == model["size"]
        partial = target.with_suffix(target.suffix + ".part")
        resumable = partial.stat().st_size if partial.is_file() else 0
        if not size_matches:
            missing += max(0, model["size"] - min(resumable, model["size"]))
        files.append({"path": str(target), "bytes": model["size"],
                      "state": "size_match_unverified" if size_matches else "partial" if resumable else "missing",
                      "partial_bytes": resumable, "sha256": model["sha256"]})
    ancestor = root
    while not ancestor.exists():
        ancestor = ancestor.parent
    free = shutil.disk_usage(ancestor).free
    reserve = CAMPAIGN.get("reserve_bytes", 20 * 1024**3)
    nodes = None
    if url:
        with urllib.request.urlopen(url.rstrip("/") + "/object_info", timeout=30) as response:
            available = json.load(response)
        nodes = {name: {node: node in available for node in CAMPAIGN.get("profiles", {}).get(name, {}).get("required_nodes", [])} for name in names}
    return {"profiles": names, "unique_files": len(files), "total_bytes": sum(m["size"] for m in models),
            "download_bytes_remaining_by_size": missing, "disk_free_bytes": free, "reserve_bytes": reserve,
            "fits_with_reserve": free >= missing + reserve, "files": files, "nodes_available": nodes,
            "verification": "Size inspection only; --verify-only hashes every selected file. Node presence does not establish graph compatibility or workflow readiness."}



def verified(path, model):
    if not path.is_file() or path.stat().st_size != model["size"]:
        return False
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest() == model["sha256"]


def model_url(model):
    """Return ``(url, is_huggingface)``; only Hugging Face URLs may carry HF_TOKEN."""
    if "url" in model:
        if not model["url"].startswith("https://"):
            raise ValueError(f"model URL must be https: {model['url']}")
        return model["url"], False
    return f'https://huggingface.co/{model["repo"]}/resolve/{model["revision"]}/{model["file"]}', True


def download(model, root, retries=5, reserve_bytes=0):
    target = root / model["directory"] / Path(model["file"]).name
    target.parent.mkdir(parents=True, exist_ok=True)
    # A process lock prevents two clients appending to the same partial file.
    with target.with_suffix(".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if verified(target, model):
            print(f"Verified existing {target}", flush=True)
            return target
        partial = target.with_suffix(target.suffix + ".part")
        url, huggingface = model_url(model)
        for attempt in range(retries):
            offset = partial.stat().st_size if partial.exists() else 0
            if offset >= model["size"]:
                if verified(partial, model):
                    os.replace(partial, target)
                    return target
                partial.unlink()
                offset = 0
            if shutil.disk_usage(target.parent).free < model["size"] - offset + reserve_bytes:
                raise RuntimeError(f"Insufficient free space for {target.name} with the configured reserve")
            headers = {"User-Agent": "agentbox-video-model-downloader/1"}
            if offset:
                headers["Range"] = f"bytes={offset}-"
            try:
                request = urllib.request.Request(url, headers=headers)
                token = os.environ.get("HF_TOKEN")
                token_file = Path(os.environ.get("HF_TOKEN_PATH", str(Path.home() / ".cache/huggingface/token")))
                if not token and token_file.is_file():
                    token = token_file.read_text().strip()
                if token and huggingface:
                    # Do not forward credentials to signed CDN redirect targets.
                    request.add_unredirected_header("Authorization", "Bearer " + token)
                with urllib.request.urlopen(request, timeout=120) as response:
                    if response.status == 206:
                        content_range = response.headers.get("Content-Range", "")
                        if not content_range.startswith(f"bytes {offset}-") or not content_range.endswith(f'/{model["size"]}'):
                            raise ValueError(f"Invalid Content-Range: {content_range}")
                    elif response.status == 200:
                        offset = 0  # Server ignored Range; restart safely.
                    else:
                        raise ValueError(f"Unexpected response status {response.status}")
                    print(f"Downloading {target.name} from byte {offset}/{model['size']}", flush=True)
                    progress_at = time.monotonic()
                    with partial.open("ab" if offset else "wb") as stream:
                        for block in iter(lambda: response.read(8 * 1024 * 1024), b""):
                            stream.write(block)
                            if stream.tell() > model["size"]:
                                raise ValueError("Response exceeds pinned model size")
                            if time.monotonic() - progress_at >= 15:
                                print(f"Progress {target.name}: {stream.tell()}/{model['size']} bytes", flush=True)
                                progress_at = time.monotonic()
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
                if isinstance(error, urllib.error.HTTPError) and error.code in (401, 403):
                    raise RuntimeError(f"Access denied for {model['repo']}; configure HF_TOKEN or HF_TOKEN_PATH with accepted model access") from error
                if attempt + 1 == retries:
                    raise RuntimeError(f"Download failed for {target.name}: {error}") from error
                print(f"Retry {attempt + 1}/{retries}: {error}", flush=True)
                time.sleep(min(2 ** attempt, 16))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=tuple(PROFILES), action="append")
    parser.add_argument("--campaign", choices=("core", "all"))
    parser.add_argument("--models-dir", type=Path, default=Path("/opt/ComfyUI/models"))
    parser.add_argument("--list", action="store_true", help="Print immutable manifest without downloading")
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--plan", action="store_true", help="Report deduplicated disk and schema requirements; never download or run inference")
    parser.add_argument("--url", help="Optional ComfyUI URL for live node checks with --plan")
    args = parser.parse_args()
    names = args.profile or (CAMPAIGN.get("default_profiles", []) if args.campaign == "core" else list(CAMPAIGN.get("profiles", {})) if args.campaign == "all" else ["h3"])
    if not names:
        parser.error("Campaign manifest is missing or empty")
    if args.plan:
        print(json.dumps(provision_plan(names, args.models_dir, args.url), indent=2))
        return
    models = selected_models(names)
    if args.list:
        print(json.dumps(models, indent=2))
        return
    if not args.verify_only:
        plan = provision_plan(names, args.models_dir)
        if not plan["fits_with_reserve"]:
            parser.exit(1, "Selected models exceed available disk with the campaign reserve; provision a smaller profile set or add storage. Use --plan for details.\n")
    for model in models:
        if args.verify_only:
            path = args.models_dir / model["directory"] / Path(model["file"]).name
            if not verified(path, model):
                parser.exit(1, f"Missing or invalid model: {path}\n")
            print(f"Verified {path}")
        else:
            download(model, args.models_dir, reserve_bytes=CAMPAIGN.get("reserve_bytes", 20 * 1024**3))


if __name__ == "__main__":
    main()
