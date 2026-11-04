#!/usr/bin/env python3
"""Image-to-splat through the ComfyUI sidecar: pano -> geometry -> preview -> dataset (ADR-2175).

Each stage is one ComfyUI job built from a pinned graph in ``skills/comfyui/workflows``
and submitted through ``comfy_client.Client`` with a durable receipt under
``<workdir>/receipts/``. Re-running a stage whose receipt exists resumes that job; it
never resubmits. Training is not done here: hand ``<workdir>/dataset`` to LichtFeld.

    splat_pipeline.py pano --name village --image photo.jpg --scene "an alpine village square"
    splat_pipeline.py pano --name cave --text "a vast ritual cavern lit by torches"
    splat_pipeline.py geometry --name village            # suggested paths -> paths.json
    splat_pipeline.py preview  --name village            # camera_preview per path; inspect them
    splat_pipeline.py dataset  --name village            # Wan fill + HiRes composite + SfM + fetch

Standard library only.
"""
import argparse
import copy
import hashlib
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import struct
import sys
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
import comfy_client  # noqa: E402

WORKFLOWS = Path(__file__).resolve().parents[1] / "workflows"
T2P_PREFIX = "img-txt-2-360 A full 360 degree equirectangular panorama in 2:1 spherical projection, "
OUTPAINT_INSTRUCTION = ("Fill the green spaces according to the image. Outpaint as a seamless 360 "
                        "equirectangular panorama (2:1). Keep the horizon level. Match left and right edges.")
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
ORIENTATIONS = ("look_forward", "look_at_target", "per_point_look")
MAX_PATHS = 4
PREVIEW_FRAMES = (0, 40, 80)  # of the 81-frame fly-through
# Long GPU stages: observation timeouts only stop watching; rerunning the stage resumes.
STAGE_TIMEOUT = {"pano": 3600, "geometry": 900, "preview": 1800, "dataset": 6 * 3600}


class PipelineError(RuntimeError):
    pass


def load_graph(name):
    return json.loads((WORKFLOWS / f"{name}.api.json").read_text())


def workdir_for(name, root=None):
    if not NAME.match(name):
        raise PipelineError("name must be 1-64 of [A-Za-z0-9_-], starting alphanumeric")
    base = Path(root or os.environ.get("SPLAT_WORKDIR") or Path(os.environ.get("WORKSPACE", Path.home() / "workspace")) / "splats")
    return base / name


# --------------------------------------------------------------------------- field of view

SOF_MARKERS = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
FULL_FRAME_HALF_DIAGONAL_MM = 21.635  # 35 mm-equivalent focal lengths are defined on the 43.27 mm diagonal


def _exif_tags(tiff):
    """Return ``{tag: (type, raw4)}`` for IFD0 and the Exif sub-IFD of a TIFF blob."""
    if len(tiff) < 8 or tiff[:2] not in (b"II", b"MM"):
        return {}
    order = "<" if tiff[:2] == b"II" else ">"
    tags = {}

    def walk(start):
        if start + 2 > len(tiff):
            return
        count = struct.unpack(order + "H", tiff[start:start + 2])[0]
        for i in range(count):
            entry = start + 2 + 12 * i
            if entry + 12 > len(tiff):
                return
            tag, kind = struct.unpack(order + "HH", tiff[entry:entry + 4])
            tags.setdefault(tag, (kind, tiff[entry + 8:entry + 12]))

    walk(struct.unpack(order + "I", tiff[4:8])[0])
    if 0x8769 in tags:  # ExifIFD pointer
        walk(struct.unpack(order + "I", tags[0x8769][1])[0])
    return {tag: struct.unpack(order + "H", raw[:2])[0] for tag, (kind, raw) in tags.items() if kind == 3}


def jpeg_facts(data):
    """``(focal_35mm, orientation, width, height)`` from a JPEG; unknown values are None."""
    if data[:2] != b"\xff\xd8":
        return None, None, None, None
    focal = orientation = width = height = None
    offset = 2
    while offset + 4 <= len(data) and data[offset] == 0xFF:
        marker = data[offset + 1]
        if marker == 0xDA:  # start of scan: no more headers
            break
        length = struct.unpack(">H", data[offset + 2:offset + 4])[0]
        segment = data[offset + 4:offset + 2 + length]
        offset += 2 + length
        if marker == 0xE1 and segment.startswith(b"Exif\x00\x00") and focal is None:
            tags = _exif_tags(segment[6:])
            focal, orientation = tags.get(0xA405) or None, tags.get(0x0112)
        elif marker in SOF_MARKERS and len(segment) >= 5:
            height, width = struct.unpack(">HH", segment[1:5])
    return focal, orientation, width, height


def horizontal_fov(image_path, override=None):
    """Return ``(degrees, source)``. Explicit override, else EXIF 35 mm-equivalent focal length.

    The equivalent focal length is defined on the full-frame diagonal, so the horizontal
    half-width is the diagonal share of the image's width. ComfyUI's LoadImage applies the
    EXIF orientation, so orientations 5-8 (rotated 90 degrees) swap width and height.
    """
    if override is not None:
        if not 20.0 <= override <= 170.0:
            raise PipelineError("--h-fov must be between 20 and 170 degrees")
        return float(override), "operator"
    focal, orientation, width, height = jpeg_facts(Path(image_path).read_bytes())
    if focal and width and height:
        if orientation in (5, 6, 7, 8):
            width, height = height, width
        half_width = FULL_FRAME_HALF_DIAGONAL_MM * width / math.hypot(width, height)
        degrees = round(math.degrees(2 * math.atan(half_width / focal)), 2)
        return degrees, f"exif:FocalLengthIn35mmFilm={focal},upright={width}x{height}"
    raise PipelineError("no 35 mm-equivalent focal length and image size in the JPEG; pass --h-fov "
                        "(phone main camera ~70, wide ~90)")


# --------------------------------------------------------------------------- camera paths

def format_anchors(anchors, targets=None):
    """Anchor list (+ optional per-anchor look targets) -> SplatKit's ``x,y,z[,tx,ty,tz]`` lines."""
    if not isinstance(anchors, list) or len(anchors) < 2:
        raise PipelineError("a path needs at least two anchors")
    lines = []
    for i, point in enumerate(anchors):
        values = [float(v) for v in point]
        if len(values) != 3:
            raise PipelineError(f"anchor {i} must be [x, y, z]")
        target = (targets or [None] * len(anchors))[i]
        if target is not None:
            values += [float(v) for v in target]
        lines.append(", ".join(f"{v:.3f}" for v in values))
    return "\n".join(lines)


def normalise_path(path):
    """Accept a suggest_paths record or an operator edit; return the stored path form."""
    orientation = path.get("orientation", "look_forward")
    if orientation not in ORIENTATIONS:
        raise PipelineError(f"orientation must be one of {ORIENTATIONS}")
    anchors = path.get("anchors")
    text = anchors if isinstance(anchors, str) else format_anchors(anchors, path.get("targets"))
    rows = [r for r in text.splitlines() if r.strip()]
    if len(rows) < 2 or any(len(r.split(",")) not in (3, 6) for r in rows):
        raise PipelineError("anchors must be at least two lines of x,y,z or x,y,z,tx,ty,tz")
    return {"label": path.get("label", "path"), "orientation": orientation, "anchors": "\n".join(rows),
            "look_at_target": path.get("look_at_target", "0, 0, 3")}


def load_paths(path_file):
    data = json.loads(Path(path_file).read_text())
    paths = [normalise_path(p) for p in (data["paths"] if isinstance(data, dict) else data)]
    if not 1 <= len(paths) <= MAX_PATHS:
        raise PipelineError(f"use 1-{MAX_PATHS} camera paths")
    return paths


# --------------------------------------------------------------------------- graph builders

def build_pano_graph(name, *, image_ref=None, h_fov=None, scene=None, text=None, seed=None):
    if (image_ref is None) == (text is None):
        raise PipelineError("give either an input image (image->pano) or --text (text->pano)")
    if text is not None:
        graph = load_graph("splat-pano-text")
        graph["scene_prompt"]["inputs"]["text"] = T2P_PREFIX + text.strip()
    else:
        if not scene:
            raise PipelineError("image->pano needs --scene: one sentence describing the surroundings")
        graph = load_graph("splat-pano-image")
        graph["photo"]["inputs"]["image"] = image_ref
        graph["warp"]["inputs"]["h_fov_deg"] = float(h_fov)
        graph["positive_text"]["inputs"]["prompt"] = OUTPAINT_INSTRUCTION + " " + scene.strip()
    if seed is not None:
        graph["sample"]["inputs"]["seed"] = int(seed)
    graph["save_2k"]["inputs"]["filename_prefix"] = f"splat/{name}/pano_2k"
    graph["save_8k"]["inputs"]["filename_prefix"] = f"splat/{name}/pano_8k"
    return graph


def build_geometry_graph(name, pano_ref):
    graph = load_graph("splat-geometry")
    graph["pano"]["inputs"]["image"] = pano_ref
    graph["scene_reference"]["inputs"]["ref_name"] = name
    return graph


def _apply_path(node, path):
    node["inputs"].update(anchors=path["anchors"], orientation=path["orientation"],
                          look_at_target=path["look_at_target"])


def build_preview_graph(name, pano_ref, paths):
    template = load_graph("splat-path-preview")
    graph = {"pano": template["pano"]}
    graph["pano"]["inputs"]["image"] = pano_ref
    for k, path in enumerate(paths, start=1):
        control, preview = copy.deepcopy(template["p1_control"]), copy.deepcopy(template["p1_preview"])
        _apply_path(control, path)
        control["_meta"]["title"] = f"Plot Camera (path {k}: {path['label']})"
        preview["inputs"].update(images=[f"p{k}_control", 3], filename_prefix=f"splat/{name}/preview_p{k}")
        graph[f"p{k}_control"], graph[f"p{k}_preview"] = control, preview
        # camera_preview plots only the path. What the camera sees is the rendered depth-mesh
        # fly-through (control_video): a wall crossing or a huge hole shows up in these frames.
        for frame in PREVIEW_FRAMES:
            graph[f"p{k}_frame{frame}"] = {"class_type": "ImageFromBatch", "_meta": {"title": f"Path {k} frame {frame}"},
                                           "inputs": {"image": [f"p{k}_control", 0], "batch_index": frame, "length": 1}}
            graph[f"p{k}_save{frame}"] = {"class_type": "SaveImage", "_meta": {"title": f"Path {k} view at frame {frame}"},
                                          "inputs": {"images": [f"p{k}_frame{frame}", 0],
                                                     "filename_prefix": f"splat/{name}/view_p{k}_f{frame:02d}"}}
    return graph


def build_dataset_graph(name, pano_ref, paths):
    graph = load_graph("splat-dataset")
    graph["pano"]["inputs"]["image"] = pano_ref
    graph["project"]["inputs"]["dataset_name"] = name
    for k in range(len(paths) + 1, MAX_PATHS + 1):
        for node_id in [n for n in graph if n.startswith(f"p{k}_")]:
            del graph[node_id]
        graph["sfm"]["inputs"].pop(f"pano_frames_{k}", None)
        graph["sfm"]["inputs"].pop(f"hires_{k}", None)
    for k, path in enumerate(paths, start=1):
        _apply_path(graph[f"p{k}_control"], path)
    dangling = [(n, i) for n, node in graph.items() for i, v in node["inputs"].items()
                if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str) and v[0] not in graph]
    if dangling:
        raise PipelineError(f"pruned graph has dangling links: {dangling}")
    return graph


# --------------------------------------------------------------------------- server I/O

def upload_image(client, path, filename):
    """POST /upload/image into input/; returns the LoadImage name.

    Top level, not a subfolder: LoadImage's combo lists only top-level input files, and
    ``comfy_client.validate`` checks combos strictly. Callers namespace the file name."""
    path = Path(path)
    boundary = uuid.uuid4().hex
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if not content_type.startswith("image/"):
        raise PipelineError(f"not an image: {path}")
    parts = []
    for field, value in (("type", "input"), ("overwrite", "true")):
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"\r\n\r\n{value}\r\n'.encode())
    parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{filename}"\r\n'
                  f"Content-Type: {content_type}\r\n\r\n").encode() + path.read_bytes() + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    request = urllib.request.Request(client.url + "/upload/image", data=b"".join(parts),
                                     headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            result = json.loads(response.read())
    except OSError as error:
        raise PipelineError(f"upload failed for {path}: {error}") from error
    subfolder = result.get("subfolder") or ""
    return f"{subfolder}/{result['name']}" if subfolder else result["name"]


def graph_sha256(graph):
    """The hash comfy_client records as a receipt's ``workflow_sha256``."""
    return hashlib.sha256(json.dumps(graph, sort_keys=True).encode()).hexdigest()


def run_stage(client, workdir, stage, graph, timeout=None, poll=5):
    """Submit once (or resume the existing receipt for this exact graph) and wait for a terminal state."""
    receipt = workdir / "receipts" / f"{stage}.json"
    if receipt.exists():
        recorded = json.loads(receipt.read_text()).get("workflow_sha256")
        if recorded and recorded != graph_sha256(graph):
            raise PipelineError(f"{receipt} is for a different {stage} graph (inputs or paths changed); "
                                "read it, then delete it to submit the new graph")
    else:
        client.submit(graph, receipt)
    result = client.resume(receipt, timeout=timeout or STAGE_TIMEOUT[stage], poll=poll)
    if result["state"] != "completed":
        raise PipelineError(f"{stage} job failed; diagnostics in {receipt}. Remove the receipt only after reading it.")
    return receipt, result


def download_stage(client, receipt, outdir):
    record = json.loads(receipt.read_text())
    saved = client.download_outputs(record["history"], outdir)
    record["downloads"] = saved
    comfy_client.atomic_json(receipt, record)
    return saved


def fetch_dataset(client, history, destination):
    """Recreate the exported COLMAP tree (images/, sparse/0/) under ``destination``, hash-checked."""
    for output in history.get("outputs", {}).values():
        datasets = output.get("splat_dataset")
        if not datasets:
            continue
        prefix = datasets[0].rstrip("/") + "/"
        fetched = []
        for item in output.get("files", []):
            subfolder = item.get("subfolder", "") + "/"
            if not subfolder.startswith(prefix):
                raise PipelineError(f"export entry outside dataset: {item}")
            relative = Path(subfolder[len(prefix):]) / item["filename"]
            if relative.is_absolute() or ".." in relative.parts:
                raise PipelineError(f"unsafe dataset path: {relative}")
            target = Path(destination) / relative
            if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == item["sha256"]:
                fetched.append({"path": relative.as_posix(), "sha256": item["sha256"], "bytes": item["bytes"], "cached": True})
                continue
            _, digest, size = client.fetch_view(item, target, item["sha256"])
            fetched.append({"path": relative.as_posix(), "sha256": digest, "bytes": size})
        return {"dataset": datasets[0], "files": fetched}
    raise PipelineError("history has no AgentboxSplatDatasetExport output")


def free_vram(client):
    try:
        return client.safe_free()
    except comfy_client.ComfyError as error:
        return {"success": False, "reason": str(error)}


def pano_from_downloads(saved):
    eight_k = [s for s in saved if "pano_8k" in s["filename"]]
    if not eight_k:
        raise PipelineError("pano job produced no pano_8k output")
    return Path(eight_k[-1]["path"])


# --------------------------------------------------------------------------- stages

def stage_pano(client, args, workdir):
    record = {"stage": "pano", "mode": "text" if args.text else "image"}
    if args.text:
        graph = build_pano_graph(args.name, text=args.text, seed=args.seed)
    else:
        h_fov, source = horizontal_fov(args.image, args.h_fov)
        record.update(h_fov_deg=h_fov, h_fov_source=source)
        digest = hashlib.sha256(Path(args.image).read_bytes()).hexdigest()
        # Content hash in the name: a changed photo is a changed graph, so a stale receipt is refused.
        image_ref = upload_image(client, args.image, f"{args.name}_input_{digest[:12]}{Path(args.image).suffix.lower()}")
        graph = build_pano_graph(args.name, image_ref=image_ref, h_fov=h_fov, scene=args.scene, seed=args.seed)
    record["free"] = free_vram(client)
    receipt, _ = run_stage(client, workdir, "pano", graph, args.timeout)
    saved = download_stage(client, receipt, workdir / "pano")
    record["pano_8k"] = str(pano_from_downloads(saved))
    record["licence"] = "Krea 2 Community License v1 (commercial use only below USD 1M trailing annual revenue)"
    return record


def resolve_pano(client, args, workdir):
    """Upload the 8K pano (``--pano`` or the pano stage's download) once; cache the reference."""
    state = workdir / "pano_ref.json"
    source = Path(args.pano) if args.pano else None
    if source is None:
        receipt = workdir / "receipts" / "pano.json"
        if not receipt.is_file():
            raise PipelineError("no --pano given and no pano stage receipt; run the pano stage or pass a 360 image")
        source = pano_from_downloads(json.loads(receipt.read_text()).get("downloads", []))
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if state.is_file():
        cached = json.loads(state.read_text())
        if cached.get("sha256") == digest and cached.get("url") == client.url:
            return cached["ref"]
    # The content hash in the name makes a changed pano a changed graph, so stale receipts are caught.
    ref = upload_image(client, source, f"{args.name}_pano_{digest[:12]}{source.suffix.lower()}")
    comfy_client.atomic_json(state, {"ref": ref, "sha256": digest, "source": str(source), "url": client.url})
    return ref


def stage_geometry(client, args, workdir):
    pano_ref = resolve_pano(client, args, workdir)
    run_stage(client, workdir, "geometry", build_geometry_graph(args.name, pano_ref), args.timeout)
    query = urllib.parse.urlencode({"name": args.name, "count": args.count})
    suggested = client.request("/splatkit/suggest_paths?" + query)
    if suggested.get("error") or not suggested.get("paths"):
        raise PipelineError(f"suggest_paths: {suggested.get('error') or 'no paths'}")
    paths = [normalise_path(p) for p in suggested["paths"]][:MAX_PATHS]
    comfy_client.atomic_json(workdir / "paths.json", {"paths": paths, "source": "splatkit/suggest_paths"})
    return {"stage": "geometry", "paths_file": str(workdir / "paths.json"), "paths": paths}


def stage_preview(client, args, workdir):
    pano_ref = resolve_pano(client, args, workdir)
    paths = load_paths(args.paths or workdir / "paths.json")
    receipt, _ = run_stage(client, workdir, "preview", build_preview_graph(args.name, pano_ref, paths), args.timeout)
    saved = download_stage(client, receipt, workdir / "preview")
    return {"stage": "preview", "previews": [s["path"] for s in saved],
            "next": "inspect each path's view_pN_f00/f40/f80 frames (what the camera sees) and its preview_pN plot; "
                    "edit paths.json for any path that enters a wall or stares into a large black hole, "
                    "remove receipts/preview.json, and preview again before the dataset stage"}


def stage_dataset(client, args, workdir):
    pano_ref = resolve_pano(client, args, workdir)
    paths = load_paths(args.paths or workdir / "paths.json")
    graph = build_dataset_graph(args.name, pano_ref, paths)
    record = {"stage": "dataset", "paths": len(paths), "free": free_vram(client)}
    receipt, result = run_stage(client, workdir, "dataset", graph, args.timeout)
    record.update(fetch_dataset(client, result["history"], workdir / "dataset"))
    record.update(dataset_dir=str(workdir / "dataset"), files=len(record["files"]),
                  bytes=sum(f["bytes"] for f in record["files"]))
    comfy_client.atomic_json(workdir / "dataset.json", record)
    record["files"] = [f["path"] for f in record["files"][:5]]  # full list: <workdir>/dataset.json
    return record


STAGES = {"pano": stage_pano, "geometry": stage_geometry, "preview": stage_preview, "dataset": stage_dataset}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--url", default=None, help="ComfyUI base URL (default $COMFYUI_URL or http://comfyui:8188)")
    parser.add_argument("--workdir-root", default=None, help="default $SPLAT_WORKDIR or $WORKSPACE/splats")
    commands = parser.add_subparsers(dest="command", required=True)
    for stage in STAGES:
        sub = commands.add_parser(stage)
        sub.add_argument("--name", required=True)
        sub.add_argument("--timeout", type=float, default=None, help="observation timeout; rerun to keep watching")
        if stage == "pano":
            source = sub.add_mutually_exclusive_group(required=True)
            source.add_argument("--image", help="perspective photo for image->pano")
            source.add_argument("--text", help="scene description for text->pano")
            sub.add_argument("--scene", help="image->pano: one sentence about the surroundings")
            sub.add_argument("--h-fov", type=float, default=None, help="horizontal FOV in degrees (else EXIF)")
            sub.add_argument("--seed", type=int, default=None)
        else:
            sub.add_argument("--pano", help="a 2:1 equirectangular 360 image (skips the pano stage)")
        if stage == "geometry":
            sub.add_argument("--count", type=int, default=4, choices=range(1, MAX_PATHS + 1))
        if stage in ("preview", "dataset"):
            sub.add_argument("--paths", help="paths JSON (default <workdir>/paths.json)")
    args = parser.parse_args(argv)
    try:
        workdir = workdir_for(args.name, args.workdir_root)
        workdir.mkdir(parents=True, exist_ok=True)
        client = comfy_client.Client(args.url)
        result = STAGES[args.command](client, args, workdir)
        print(json.dumps({"workdir": str(workdir), **result}, indent=2))
        return 0
    except TimeoutError as error:
        print(json.dumps({"error": str(error), "resumable": True}))
        return 2
    except (PipelineError, comfy_client.ComfyError, OSError, ValueError) as error:
        print(json.dumps({"error": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
