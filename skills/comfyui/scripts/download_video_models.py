#!/usr/bin/env python3
"""Plan and provision pinned media model profiles with resumable SHA-256 verification."""
import argparse
import fcntl
import hashlib
import json
import os
import shutil
import struct
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
# ComfyUI-SpEdE (Gaussian-splat remove/extract/replace) weights. Revision, size and sha256 come from
# the Hugging Face API (revision/main for the commit, tree/<sha> for the LFS oid and size), not from
# the SpEdE README. `directory` is the ComfyUI models/ sub-folder the loader node reads; the file
# names are the ones SpEdE's workflows/*.json put in UNETLoader/VAELoader/CLIPLoader/etc. The
# experimental orbit (MiniMax H3 ref2va) is deliberately excluded. See manifests/spede.json.
SAM31_REV = "7bb8374780a725b4353ed31f3a9395c9742b5621"
QWEN21_REV = "aacf31a6d48e707f352ecba714cee0680da3479b"
MOGE_REV = "1484985258ba7ef45c314144fcf0e90924ffbf44"
TRIPOSPLAT_REV = "56a96e603204ec410c4da60c13ea4fa09a2169a9"
SPEDE_MODELS = [
    # Licence: SAM License (Meta).
    dict(repo="Comfy-Org/sam3.1", revision=SAM31_REV,
         file="checkpoints/sam3.1_multiplex_fp16.safetensors", directory="checkpoints",
         size=1745546848, sha256="9ba99c92703c2e8b4f47de2d34a539bb8e18923049e238b780d70dbe6368eb03"),
    # Licence for the four Qwen-Image 2.1 files below: Qwen-Image 2.1 Research License
    # (NON-COMMERCIAL). The Qwen3-VL 8B encoder ships with Qwen-Image 2.1 and is treated the same.
    dict(repo="Comfy-Org/Qwen-Image-2.1", revision=QWEN21_REV,
         file="diffusion_models/qwen_image_2.1_int8_convrot.safetensors", directory="diffusion_models",
         size=7256783064, sha256="cb74113cb03faecd79611b01fd7fd642f0aa60d6f0b95086abee214d75eaa57d"),
    dict(repo="Comfy-Org/Qwen-Image-2.1", revision=QWEN21_REV,
         file="diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors", directory="diffusion_models",
         size=7256787829, sha256="8144a0182964aa8403ad6dbc011db837304167d235161b9aabaa8532e967314c"),
    dict(repo="Comfy-Org/Qwen-Image-2.1", revision=QWEN21_REV,
         file="text_encoders/qwen3vl_8b_int8_convrot.safetensors", directory="text_encoders",
         size=9350798360, sha256="8bfd0f6e12abf2d2d697ecc888e5e90b0d6741d6708f05799f53afa560452e8f"),
    dict(repo="Comfy-Org/Qwen-Image-2.1", revision=QWEN21_REV,
         file="vae/qwen_image_2.1_vae_bf16.safetensors", directory="vae",
         size=675509688, sha256="bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9"),
    # Licence: MIT (Microsoft MoGe-3). Read by LoadMoGeModel from the geometry_estimation folder.
    dict(repo="Comfy-Org/MoGe", revision=MOGE_REV,
         file="geometry_estimation/moge_3_vitl_fp16.safetensors", directory="geometry_estimation",
         size=740652334, sha256="52ad9a13037a28fd65003cae7df056c8f903f5aed2c3a5c802be0f5c74a6a7b8"),
]
SPEDE_REPLACE_MODELS = [
    # Licence: MIT (TripoSplat, VAST-AI; code and weights).
    dict(repo="VAST-AI/TripoSplat", revision=TRIPOSPLAT_REV,
         file="diffusion_models/triposplat_fp16.safetensors", directory="diffusion_models",
         size=741106994, sha256="c870b97ac1d6bc9177608a5ec625e19ef9f3c5019aa68f64b0fb7803abcd6d20"),
    dict(repo="VAST-AI/TripoSplat", revision=TRIPOSPLAT_REV,
         file="vae/triposplat_vae_decoder_fp16.safetensors", directory="vae",
         size=576148442, sha256="ed0d0c3d43b599e326845d0ec70f3cf77be9a55e2d97627ac3b34d2830763cc8"),
    # Licence: DINOv3 License (Meta; use restrictions apply, review before commercial use).
    dict(repo="VAST-AI/TripoSplat", revision=TRIPOSPLAT_REV,
         file="clip_vision/dino_v3_vit_h.safetensors", directory="clip_vision",
         size=1681247696, sha256="a29ef35101a16966972a0d50732a6f3a608ff7cfffb2afa9bbe9007cb842cc53"),
    # Licence: Apache-2.0 (FLUX.2 VAE only; FLUX.2 [dev] itself is non-commercial).
    dict(repo="VAST-AI/TripoSplat", revision=TRIPOSPLAT_REV,
         file="vae/flux2-vae.safetensors", directory="vae",
         size=336213556, sha256="d64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5"),
]
PROFILES["spede"] = SPEDE_MODELS
# Self-sufficient superset (like h3-reference): Replace also runs SAM, Qwen and the text encoder.
PROFILES["spede-replace"] = SPEDE_MODELS + SPEDE_REPLACE_MODELS
# Image-to-splat (ADR-2175): SplatKit panorama and dataset stages. Revision, size and sha256 come
# from the Hugging Face paths-info API at the pinned revision; file names are the ones the
# skills/comfyui/workflows/splat-*.api.json graphs load. See manifests/splatkit.json.
WAN21_REV = "123acf1cc74bccbb9bfff8ac1ee72edc08c2341d"
REALESRGAN_REV = "8110204ebf8d25c031b66c26c2d1098aa831157e"
WAN21_VAE = dict(repo="Comfy-Org/Wan-2.1", revision=WAN21_REV,
                 file="split_files/vae/wan_2.1_vae.safetensors", directory="vae",
                 size=253815318, sha256="2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b")
SPLAT_PANO_MODELS = [
    # Licence: Krea 2 Community License v1 (commercial use only below USD 1M trailing annual
    # revenue; content-filter duty §4.2; AI-disclosure duty §4.3). Applies to the two ERP LoRAs too.
    dict(repo="Comfy-Org/Krea-2", revision="588feaf955b08b9ac4723eeb751752ab045dba71",
         file="diffusion_models/krea2_turbo_fp8_scaled.safetensors", directory="diffusion_models",
         size=13141730784, sha256="eb4dd8c612cfd10f64f25b057e6e6bbcb5737c94a7372177e456dbf7579502f1"),
    dict(repo="Comfy-Org/Krea-2", revision="588feaf955b08b9ac4723eeb751752ab045dba71",
         file="text_encoders/qwen3vl_4b_fp8_scaled.safetensors", directory="text_encoders",
         size=5242467968, sha256="54bd5144df0bbc25dd6ccadfcb826b521445a1b06ae5a42570bdd2974ca87094"),
    dict(repo="mickmumpitz/Krea2-360-ERP-LoRAs", revision="45b20236e1a2b98342f7db9f3a55f46b989425b2",
         file="krea2_t2i_360_erp_lora_v1.safetensors", directory="loras",
         size=228587744, sha256="46587da116a8cdd9ab8fa8850b06effd49970929d071294018d33cdfaa2a6bda"),
    dict(repo="mickmumpitz/Krea2-360-ERP-LoRAs", revision="45b20236e1a2b98342f7db9f3a55f46b989425b2",
         file="krea2_oedit_360_erp_outpaint_lora_v1.safetensors", directory="loras",
         size=228587600, sha256="8e0cb98ffbfb8c363050ad0216a951009e8df07fb651e2a8932e24974ddc98e7"),
    # Licence: Apache-2.0 (Wan 2.1 VAE; Krea 2 uses it as-is).
    WAN21_VAE,
    # Licence: BSD-3-Clause (Real-ESRGAN).
    dict(repo="ai-forever/Real-ESRGAN", revision=REALESRGAN_REV,
         file="RealESRGAN_x2.pth", directory="upscale_models",
         size=67061725, sha256="c830d067d54fc767b9543a8432f36d91bc2de313584e8bbfe4ac26a47339e899"),
]
SPLAT_DATASET_MODELS = [
    # Licence: Apache-2.0 (Wan 2.1 I2V 14B 720P, umt5-xxl, clip_vision_h, VAE).
    dict(repo="Comfy-Org/Wan-2.1", revision=WAN21_REV,
         file="split_files/diffusion_models/wan2.1_i2v_720p_14B_fp8_e4m3fn.safetensors",
         directory="diffusion_models", size=16397245448,
         sha256="b2051cd29d6b2f0c924fa7a3e78a4772f0134d7b059f21590dcce416f4f6cbe8"),
    dict(repo="Comfy-Org/Wan-2.1", revision=WAN21_REV,
         file="split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors", directory="text_encoders",
         size=6735906897, sha256="c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68"),
    dict(repo="Comfy-Org/Wan-2.1", revision=WAN21_REV,
         file="split_files/clip_vision/clip_vision_h.safetensors", directory="clip_vision",
         size=1264219396, sha256="64a7ef761bfccbadbaa3da77366aac4185a6c58fa5de5f589b42a65bcc21f161"),
    WAN21_VAE,
    # Licence: Apache-2.0 (LightX2V step/CFG distill LoRA, Kijai repackage).
    dict(repo="Kijai/WanVideo_comfy", revision="8260d429d19fd7a72304cad059160b95d843913f",
         file="Lightx2v/lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors", directory="loras",
         size=630697104, sha256="37d49218544b9e0bfb8e831d1399f451fbc5068aff6474f42a90c928363c3573"),
    # Licence: BSD-3-Clause. Replaces SplatKit's default 4x-UltraSharp (CC BY-NC-SA 4.0) for the
    # HiRes Composite hole-fill upscale.
    dict(repo="ai-forever/Real-ESRGAN", revision=REALESRGAN_REV,
         file="RealESRGAN_x4.pth", directory="upscale_models",
         size=67040989, sha256="aa00f09ad753d88576b21ed977e97d634976377031b178acc3b5b238df463400"),
    # Licence: MIT (MoGe ViT-L). SplatKit reads models/MoGe/<name>; the graphs name model.pt so its
    # first-use hf_hub_download never runs.
    dict(repo="Ruicheng/moge-vitl", revision="ad326bfb61facd6c52b5a825bc1e34d7c97d9672",
         file="model.pt", directory="MoGe",
         size=1256823446, sha256="da96b09a0485a3c45a5aa455e67743c8b4efc4dd8437c1f2aa93c2b4303d957f"),
    # Licence: BSD-3-Clause (torchvision RAFT-Large). HiRes Composite loads Raft_Large_Weights.DEFAULT
    # through torch.hub; the image sets TORCH_HOME=/opt/ComfyUI/models/torch_hub so this is the cache hit.
    dict(repo="pytorch/vision", revision="Raft_Large_Weights.C_T_SKHT_V2",
         file="raft_large_C_T_SKHT_V2-ff5fadd5.pth", directory="torch_hub/hub/checkpoints",
         url="https://download.pytorch.org/models/raft_large_C_T_SKHT_V2-ff5fadd5.pth",
         size=21106607, sha256="ff5fadd56d26b40647388883af1547351ea17868b765c05b27231e72dd16a322"),
]
# Licence: MIT (Skywork Matrix-3D). Gated on Hugging Face: the HF_TOKEN account must accept the
# repository terms. Derived with SplatKit's tools/convert_pano_lora.py (a pure key rename to
# ComfyUI's Wan LoRA convention, bf16); the output hash is of the canonicalised safetensors and
# was reproduced by two independent conversions.
SPLAT_MATRIX3D_LORA = dict(
    repo="Skywork/Matrix-3D", revision="9f23eda5300f2a44d1256ecaf54a7808e69d7daa",
    file="pano_video_gen_720p_comfy.safetensors", directory="loras",
    size=306809616, sha256="e50beda5e29eb15c655e9738da238c0ebc84d8ef2dd0041fc95c36d359fe7d15",
    derive=dict(converter="splatkit-pano-lora", source=dict(
        repo="Skywork/Matrix-3D", revision="9f23eda5300f2a44d1256ecaf54a7808e69d7daa",
        file="checkpoints/pano_video_gen_720p.bin", directory="loras",
        size=613679690, sha256="a511537e2607c0184f5000fe5e435e7d78cacf341b0ef9c75de6dba2afe81dd7")))
PROFILES["splat-pano"] = SPLAT_PANO_MODELS
PROFILES["splat-matrix3d"] = [SPLAT_MATRIX3D_LORA]
PROFILES["splat-dataset"] = SPLAT_DATASET_MODELS + [SPLAT_MATRIX3D_LORA]
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
            if "derive" in model:
                source = model["derive"]["source"]
                kept = root / ".sources" / source["directory"] / Path(source["file"]).name
                if not (kept.is_file() and kept.stat().st_size == source["size"]):
                    missing += source["size"]
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


# Converters a derived model may name. Each is a command baked into the sidecar image, called as
# ``<argv...> <source> <output>``; the output must then match the profile's pinned sha256.
CONVERTERS = {
    "splatkit-pano-lora": ["python", "/opt/ComfyUI/custom_nodes/ComfyUI-SplatKit/tools/convert_pano_lora.py"],
}


def canonicalise_safetensors(path):
    """Rewrite a safetensors header with sorted keys and 8-byte space padding, in place.

    safetensors serialises a multi-key ``__metadata__`` map in nondeterministic order, so two
    conversions of the same input differ only in header bytes. Tensor offsets are relative to
    the data section, so re-serialising the header leaves the data untouched.
    """
    with open(path, "rb") as stream:
        length = struct.unpack("<Q", stream.read(8))[0]
        header = json.loads(stream.read(length))
        data = stream.read()
    encoded = json.dumps(header, sort_keys=True, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 8)
    with open(path, "wb") as stream:
        stream.write(struct.pack("<Q", len(encoded)) + encoded + data)


def derive(model, root, reserve_bytes=0, converters=None):
    """Provision a derived file: download its pinned source, convert, verify, publish atomically.

    The source lands in ``<root>/.sources/`` (verified like any download) and is kept so a
    re-derivation never re-downloads. The converter writes ``<target>.part``; a safetensors
    output has its header canonicalised; only an output with the pinned size and sha256
    replaces the target.
    """
    import subprocess

    target = root / model["directory"] / Path(model["file"]).name
    if verified(target, model):
        print(f"Verified existing {target}", flush=True)
        return target
    recipe = model["derive"]
    command = (converters or CONVERTERS).get(recipe["converter"])
    if command is None:
        raise RuntimeError(f"Unknown converter {recipe['converter']!r} for {target.name}")
    source = download(recipe["source"], root / ".sources", reserve_bytes=reserve_bytes)
    partial = target.with_suffix(target.suffix + ".part")
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.with_suffix(".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if partial.exists():
            partial.unlink()
        # The converter infers the output format from the suffix, so give it a real one.
        staging = partial.with_name(partial.name + Path(model["file"]).suffix)
        try:
            subprocess.run([*command, str(source), str(staging), *recipe.get("args", [])], check=True)
            if staging.suffix == ".safetensors":
                canonicalise_safetensors(staging)
            os.replace(staging, partial)
        finally:
            if staging.exists():
                staging.unlink()
        if not verified(partial, model):
            got = hashlib.sha256(partial.read_bytes()).hexdigest() if partial.is_file() else None
            partial.unlink(missing_ok=True)
            raise RuntimeError(f"Derived {target.name} does not match the pinned sha256 (got {got})")
        os.replace(partial, target)
    print(f"Derived and verified {target}", flush=True)
    return target


def provision(model, root, reserve_bytes=0):
    return derive(model, root, reserve_bytes) if "derive" in model else download(model, root, reserve_bytes=reserve_bytes)


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
            provision(model, args.models_dir, reserve_bytes=CAMPAIGN.get("reserve_bytes", 20 * 1024**3))


if __name__ == "__main__":
    main()
