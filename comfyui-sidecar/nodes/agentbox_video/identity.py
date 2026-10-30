"""Identity scoring for generated video: cast likeness, drift, opening frames.

Core logic needs only numpy and OpenCV, so it imports without ComfyUI or
torch. The ComfyUI node classes at the bottom are thin adapters.

Embedder: OpenCV Zoo YuNet (MIT) + SFace (Apache-2.0) through
``cv2.FaceDetectorYN`` / ``cv2.FaceRecognizerSF``. The :class:`Embedder`
protocol is pluggable. Weights are not baked into the image: they are listed
in ``face_models.json`` with a pinned URL and sha256 and refused on mismatch.

A face is judged only when its height is at least ``min_face_frac`` of the
frame's short side; otherwise the result is ``not_judged``, never a pass.
Thresholds are configuration with provenance and ``calibrated: false``; a PASS
on an uncalibrated set is ``provisional`` and must not back acceptance. A FAIL
routes to human review, not to an automatic retake.

Adapted from Kinoloom (MIT), tool/qa_director.py (best-of-last-N cosine, 12%
face-size floor), tool/face_drift.py (per-link drift), tool/opening_frames.py
(best-of-candidates, weak flag) and tool/face_ref.py (close-up crop cached by
content hash).

CLI: ``python -m agentbox_video.identity {score,drift,opening,closeup} ...``
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections import deque
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Iterator, Optional, Protocol, Sequence

import numpy as np

SCHEMA = "agentbox-identity/1"
MANIFEST_PATH = Path(__file__).with_name("face_models.json")
DEFAULT_MODELS_DIR = "/opt/ComfyUI/models/agentbox_face"
ROUTE_ON_FAIL = "human_review"


# --------------------------------------------------------------- thresholds
@dataclass(frozen=True)
class ThresholdSet:
    """Identity thresholds. Configuration, never constants.

    The numbers were calibrated by Kinoloom against ArcFace; SFace cosine
    values sit on a different scale, so the set stays uncalibrated here.
    """

    min_similarity: float = 0.25
    min_face_frac: float = 0.12
    last_n: int = 5
    weak_below: float = 0.25
    drift_min_sim: float = 0.15
    provenance: str = "kinoloom-ltx-uncalibrated"
    calibrated: bool = False

    @classmethod
    def from_dict(cls, d: Optional[dict]) -> "ThresholdSet":
        known = {k: v for k, v in (d or {}).items() if k in cls.__dataclass_fields__}
        return cls(**known)


# ---------------------------------------------------------------- embedders
@dataclass
class FaceHit:
    """A detected face: box ``(x, y, w, h)`` in the analysed frame, unit embedding."""

    box: tuple
    embedding: np.ndarray
    score: float = 1.0


class Embedder(Protocol):
    """Swap-in interface: find faces in a BGR uint8 frame and embed each."""

    def faces(self, bgr: np.ndarray) -> list:  # list[FaceHit]
        ...


class ModelFilesError(RuntimeError):
    """A model file is missing or its sha256 differs from the manifest."""


def load_manifest(path: Path = MANIFEST_PATH) -> dict:
    return json.loads(Path(path).read_text())


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_model_files(models_dir: Path, manifest: Optional[dict] = None) -> dict:
    """Return ``{role: Path}``; raise :class:`ModelFilesError` on absence or hash mismatch."""
    manifest = manifest or load_manifest()
    out = {}
    for role, spec in manifest["models"].items():
        p = Path(models_dir) / spec["file"]
        if not p.is_file():
            raise ModelFilesError(f"{role}: {p} missing (download {spec['url']})")
        got = sha256_file(p)
        if got != spec["sha256"]:
            raise ModelFilesError(
                f"{role}: sha256 mismatch for {p} (expected {spec['sha256']}, got {got}); refusing to load"
            )
        out[role] = p
    return out


def _unit(v: np.ndarray) -> np.ndarray:
    v = np.asarray(v, dtype=np.float32).reshape(-1)
    return v / (float(np.linalg.norm(v)) + 1e-9)


class SFaceEmbedder:
    """YuNet + SFace through OpenCV. Frames are analysed at ``max_side`` at most."""

    def __init__(self, models_dir: Optional[Path] = None, manifest: Optional[dict] = None,
                 max_side: int = 960, score_threshold: float = 0.7):
        import cv2

        self._cv2 = cv2
        paths = verify_model_files(Path(models_dir or os.environ.get("AGENTBOX_FACE_MODELS", DEFAULT_MODELS_DIR)), manifest)
        self._det = cv2.FaceDetectorYN.create(str(paths["detector"]), "", (320, 320), score_threshold, 0.3, 5000)
        self._rec = cv2.FaceRecognizerSF.create(str(paths["recogniser"]), "")
        self.max_side = max_side

    def faces(self, bgr: np.ndarray) -> list:
        cv2 = self._cv2
        img = bgr
        m = max(img.shape[:2])
        if m > self.max_side:
            k = self.max_side / m
            img = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
        h, w = img.shape[:2]
        self._det.setInputSize((w, h))
        _, rows = self._det.detect(img)
        hits = []
        for r in (rows if rows is not None else []):
            aligned = self._rec.alignCrop(img, r)
            emb = _unit(self._rec.feature(aligned))
            hits.append(FaceHit((float(r[0]), float(r[1]), float(r[2]), float(r[3])), emb, float(r[-1])))
        # report boxes relative to the analysed image; callers use ratios only
        self.last_shape = (h, w)
        return hits


# ------------------------------------------------------------------- maths
def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(_unit(a), _unit(b)))


def judged(hit: FaceHit, frame_shape: Sequence[int], min_face_frac: float) -> bool:
    """A face is judged when its height >= ``min_face_frac`` of the frame's short side."""
    short = min(frame_shape[0], frame_shape[1])
    return hit.box[3] >= min_face_frac * short


def _analysed_shape(embedder, bgr) -> tuple:
    # An embedder that rescales reports the shape its boxes live in.
    return getattr(embedder, "last_shape", None) or bgr.shape[:2]


def reference_embeddings(embedder: Embedder, portraits: dict) -> dict:
    """``{name: [unit embedding of the largest face]}`` for portraits (BGR arrays or paths).

    A portrait with no face is left out.
    """
    refs = {}
    for name, img in portraits.items():
        bgr = _read_image(img) if isinstance(img, (str, Path)) else img
        if bgr is None:
            continue
        hits = embedder.faces(bgr)
        if hits:
            big = max(hits, key=lambda f: f.box[2] * f.box[3])
            refs.setdefault(name, []).append(big.embedding)
    return refs


def frame_best(embedder: Embedder, bgr: np.ndarray, refs: dict, th: ThresholdSet) -> dict:
    """Best cosine over judged faces and every reference in one frame."""
    hits = embedder.faces(bgr)
    shape = _analysed_shape(embedder, bgr)
    ok = [h for h in hits if judged(h, shape, th.min_face_frac)]
    best, who = None, None
    for h in ok:
        for name, embs in refs.items():
            for e in embs:
                s = float(np.dot(h.embedding, e))
                if best is None or s > best:
                    best, who = s, name
    return {"faces": len(hits), "judged_faces": len(ok), "best": best, "cast": who}


def identity_score(frames: Iterable[np.ndarray], refs: dict, embedder: Embedder,
                   th: Optional[ThresholdSet] = None) -> dict:
    """Best cosine over the last ``th.last_n`` frames against all references.

    Verdict is ``not_judged`` when no judged face appears (a face under the
    size floor is never a pass), ``FAIL`` under ``min_similarity`` (routed to
    human review) and otherwise ``PASS`` with ``provisional`` true while the
    threshold set is uncalibrated.
    """
    th = th or ThresholdSet()
    tail = list(deque(frames, maxlen=max(1, th.last_n)))
    per = [frame_best(embedder, f, refs, th) for f in tail]
    scores = [p["best"] for p in per if p["best"] is not None]
    best = max(scores) if scores else None
    if not refs:
        verdict, reason = "not_judged", "no reference portrait with a face"
    elif best is None:
        verdict, reason = "not_judged", "no face at or above the size floor in the last frames"
    elif best >= th.min_similarity:
        verdict, reason = "PASS", None
    else:
        verdict, reason = "FAIL", "best similarity under threshold"
    report = {
        "schema": SCHEMA, "kind": "identity_score", "verdict": verdict,
        "provisional": (verdict == "PASS" and not th.calibrated),
        "acceptance_backing": bool(verdict == "PASS" and th.calibrated),
        "score": best, "frames_considered": len(tail), "per_frame": per,
        "thresholds": asdict(th),
    }
    if reason:
        report["reason"] = reason
    if verdict == "FAIL":
        report["route"] = ROUTE_ON_FAIL
    return report


def drift_report(frames: Iterable[np.ndarray], link_starts: Sequence[int], refs: dict,
                 embedder: Embedder, th: Optional[ThresholdSet] = None, every: int = 6) -> dict:
    """Mean similarity per cast member per link, sampled every ``every`` frames.

    ``link_starts`` are the first frame of each later link. Reported, not a
    gate: only change between links of one take means something.
    """
    th = th or ThresholdSet()
    edges = [0] + sorted(int(s) for s in link_starts)
    rows = []
    for i, f in enumerate(frames):
        if i % every:
            continue
        hits = embedder.faces(f)
        shape = _analysed_shape(embedder, f)
        link = sum(1 for s in edges if i >= s)
        for h in hits:
            if not judged(h, shape, th.min_face_frac):
                continue
            sims = {n: max(float(np.dot(h.embedding, e)) for e in es) for n, es in refs.items()}
            who = max(sims, key=lambda k: sims[k])
            if sims[who] >= th.drift_min_sim:
                rows.append((link, who, sims[who]))
    links = []
    for li in range(1, len(edges) + 1):
        entry: dict = {"link": li}
        for name in refs:
            r = [x[2] for x in rows if x[0] == li and x[1] == name]
            if r:
                entry[name] = {"n": len(r), "sim": round(float(np.mean(r)), 4)}
        links.append(entry)
    summary = {}
    for name in refs:
        seen = [lk[name] for lk in links if name in lk]
        if seen:
            summary[name] = {"sim_first": seen[0]["sim"], "sim_last": seen[-1]["sim"],
                             "change": round(seen[-1]["sim"] - seen[0]["sim"], 4)}
    return {"schema": SCHEMA, "kind": "drift_report", "every": every, "links": links,
            "summary": summary, "gate": False, "thresholds": asdict(th)}


def choose_opening_frame(candidates: Sequence[np.ndarray], refs: dict, embedder: Embedder,
                         th: Optional[ThresholdSet] = None) -> dict:
    """Score every candidate and keep the best.

    A candidate's likeness is the least-alike cast member's best cosine (the
    worst-served person counts); a cast member with no judged face scores
    ``None`` and the candidate ranks below any fully scored one. The chosen
    frame is ``weak`` below ``th.weak_below`` or when nothing could be scored.
    """
    th = th or ThresholdSet()
    scores = []
    for idx, cand in enumerate(candidates):
        hits = embedder.faces(cand)
        shape = _analysed_shape(embedder, cand)
        ok = [h for h in hits if judged(h, shape, th.min_face_frac)]
        per_cast = {}
        for name, embs in refs.items():
            sims = [float(np.dot(h.embedding, e)) for h in ok for e in embs]
            per_cast[name] = max(sims) if sims else None
        vals = list(per_cast.values())
        complete = bool(vals) and all(v is not None for v in vals)
        likeness = min(vals) if complete else None
        scored = [v for v in vals if v is not None]
        scores.append({"index": idx, "likeness": likeness, "per_cast": per_cast,
                       "judged_faces": len(ok),
                       "_rank": (1, likeness) if complete else (0, max(scored) if scored else -1.0)})
    if not scores:
        return {"schema": SCHEMA, "kind": "opening_frame", "chosen": None, "weak": True,
                "scores": [], "thresholds": asdict(th)}
    best = max(scores, key=lambda s: s["_rank"])
    weak = best["likeness"] is None or best["likeness"] < th.weak_below
    for s in scores:
        s.pop("_rank")
    return {"schema": SCHEMA, "kind": "opening_frame", "chosen": best["index"], "weak": weak,
            "likeness": best["likeness"], "scores": scores, "provisional": not th.calibrated,
            "thresholds": asdict(th)}


# ------------------------------------------------------------- close-up crop
def closeup_params(scale: float, size: int, max_face_frac: float) -> str:
    return f"scale={scale}|size={size}|max_face_frac={max_face_frac}"


def crop_cache_key(data: bytes, scale: float = 2.0, size: int = 768, max_face_frac: float = 0.4) -> str:
    """sha256 of the source bytes plus crop parameters (16 hex chars)."""
    return hashlib.sha256(data + b"|" + closeup_params(scale, size, max_face_frac).encode()).hexdigest()[:16]


def crop_box(face_box: tuple, image_hw: tuple, scale: float = 2.0,
             max_face_frac: float = 0.4) -> Optional[tuple]:
    """Square ``(x0, y0, side)`` around the face (a little below its centre), or None.

    None when the face already fills ``max_face_frac`` of the image height (a
    close-up already). Margin comes from ``scale`` x face height.
    """
    x, y, fw, fh = face_box
    h, w = image_hw
    if fh >= max_face_frac * h:
        return None
    s = int(min(fh * scale, h, w))
    cx, cy = x + fw / 2, y + fh * 0.55
    x0 = int(np.clip(cx - s / 2, 0, w - s))
    y0 = int(np.clip(cy - s / 2, 0, h - s))
    return x0, y0, s


def face_closeup(src: Path, cache_dir: Path, embedder: Embedder, scale: float = 2.0,
                 size: int = 768, max_face_frac: float = 0.4) -> Optional[Path]:
    """Cached square close-up of the largest face in ``src``; None if no face or already close."""
    import cv2

    src = Path(src)
    data = src.read_bytes()
    out = Path(cache_dir) / f"face_{crop_cache_key(data, scale, size, max_face_frac)}.png"
    if out.is_file():
        return out
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return None
    hits = embedder.faces(img)
    if not hits:
        return None
    # boxes may live in a rescaled frame; map back to the source
    ah, aw = _analysed_shape(embedder, img)
    k = img.shape[0] / ah
    big = max(hits, key=lambda f: f.box[2] * f.box[3])
    box = tuple(v * k for v in big.box)
    cb = crop_box(box, img.shape[:2], scale, max_face_frac)
    if cb is None:
        return None
    x0, y0, s = cb
    crop = cv2.resize(img[y0:y0 + s, x0:x0 + s], (size, size),
                      interpolation=cv2.INTER_LANCZOS4 if s < size else cv2.INTER_AREA)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp.png")
    if not cv2.imwrite(str(tmp), crop):
        return None
    tmp.replace(out)
    return out


# --------------------------------------------------------------------- I/O
def _read_image(p) -> Optional[np.ndarray]:
    import cv2

    return cv2.imread(str(p), cv2.IMREAD_COLOR)


def read_video_frames(path: Path) -> Iterator[np.ndarray]:
    import cv2

    cap = cv2.VideoCapture(str(path))
    try:
        while True:
            ok, f = cap.read()
            if not ok:
                return
            yield f
    finally:
        cap.release()


def tensor_to_bgr_frames(t) -> list:
    """ComfyUI IMAGE ``[B,H,W,C]`` float 0..1 (RGB) to a list of BGR uint8 frames."""
    a = t.detach().cpu().numpy() if hasattr(t, "detach") else np.asarray(t)
    if a.ndim == 3:
        a = a[None]
    a = np.clip(a[..., :3] * 255.0 + 0.5, 0, 255).astype(np.uint8)
    return [np.ascontiguousarray(f[..., ::-1]) for f in a]


# --------------------------------------------------------------------- CLI
def _parse_refs(items: Sequence[str], embedder: Embedder) -> dict:
    portraits = {}
    for it in items:
        name, _, path = it.partition("=")
        if not path:
            raise SystemExit(f"--ref expects NAME=PATH, got {it!r}")
        portraits[name] = Path(path)
    return reference_embeddings(embedder, portraits)


def _thresholds(args) -> ThresholdSet:
    d = json.loads(Path(args.thresholds).read_text()) if args.thresholds else {}
    if args.last_n is not None:
        d["last_n"] = args.last_n
    return ThresholdSet.from_dict(d)


def main(argv: Optional[Sequence[str]] = None, embedder: Optional[Embedder] = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m agentbox_video.identity", description=__doc__.split("\n")[0])
    ap.add_argument("--models-dir", default=None)
    ap.add_argument("--thresholds", help="JSON file overriding the threshold set")
    ap.add_argument("--last-n", type=int, default=None)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("score", "drift"):
        p = sub.add_parser(name)
        p.add_argument("--video", required=True)
        p.add_argument("--ref", action="append", default=[], help="NAME=portrait path (repeatable)")
        if name == "drift":
            p.add_argument("--link-start", type=int, action="append", default=[])
            p.add_argument("--every", type=int, default=6)
    p = sub.add_parser("opening")
    p.add_argument("--candidate", action="append", default=[], help="image path (repeatable)")
    p.add_argument("--ref", action="append", default=[])
    p = sub.add_parser("closeup")
    p.add_argument("--image", required=True)
    p.add_argument("--cache-dir", required=True)
    p.add_argument("--scale", type=float, default=2.0)
    p.add_argument("--size", type=int, default=768)
    args = ap.parse_args(argv)

    try:
        emb = embedder or SFaceEmbedder(args.models_dir)
    except ModelFilesError as e:
        print(json.dumps({"schema": SCHEMA, "verdict": "BLOCKED", "error": str(e)}, indent=2))
        return 2
    th = _thresholds(args)
    if args.cmd == "score":
        rep = identity_score(read_video_frames(args.video), _parse_refs(args.ref, emb), emb, th)
        rep["input"] = {"video": args.video}
    elif args.cmd == "drift":
        rep = drift_report(read_video_frames(args.video), args.link_start, _parse_refs(args.ref, emb), emb, th, args.every)
        rep["input"] = {"video": args.video}
    elif args.cmd == "opening":
        cands = [_read_image(c) for c in args.candidate]
        rep = choose_opening_frame([c for c in cands if c is not None], _parse_refs(args.ref, emb), emb, th)
        rep["input"] = {"candidates": args.candidate}
    else:
        out = face_closeup(Path(args.image), Path(args.cache_dir), emb, args.scale, args.size)
        rep = {"schema": SCHEMA, "kind": "closeup", "output": str(out) if out else None}
    print(json.dumps(rep, indent=2, default=lambda o: float(o) if isinstance(o, np.floating) else str(o)))
    return 0


# ------------------------------------------------------- ComfyUI node adapter
_EMBEDDER_CACHE: dict = {}


def _shared_embedder():
    if "e" not in _EMBEDDER_CACHE:
        _EMBEDDER_CACHE["e"] = SFaceEmbedder()
    return _EMBEDDER_CACHE["e"]


def _names(csv: str, n: int) -> list:
    names = [s.strip() for s in (csv or "").split(",") if s.strip()]
    return (names + [f"ref{i}" for i in range(len(names), n)])[:n]


class AgentboxIdentityScore:
    """Best cosine over the last N frames vs the cast portraits; JSON evidence out."""

    CATEGORY = "agentbox/video"
    FUNCTION = "run"
    RETURN_TYPES = ("STRING", "FLOAT", "STRING")
    RETURN_NAMES = ("report_json", "score", "verdict")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "frames": ("IMAGE",), "references": ("IMAGE",),
            "last_n": ("INT", {"default": 5, "min": 1, "max": 64}),
            "min_similarity": ("FLOAT", {"default": 0.25, "min": 0.0, "max": 1.0, "step": 0.01}),
            "min_face_frac": ("FLOAT", {"default": 0.12, "min": 0.0, "max": 1.0, "step": 0.01}),
        }, "optional": {"ref_names": ("STRING", {"default": ""})}}

    def run(self, frames, references, last_n, min_similarity, min_face_frac, ref_names=""):
        emb = _shared_embedder()
        th = ThresholdSet(min_similarity=min_similarity, min_face_frac=min_face_frac, last_n=last_n)
        pics = tensor_to_bgr_frames(references)
        refs = reference_embeddings(emb, dict(zip(_names(ref_names, len(pics)), pics)))
        rep = identity_score(tensor_to_bgr_frames(frames), refs, emb, th)
        return (json.dumps(rep), float(rep["score"] if rep["score"] is not None else -1.0), rep["verdict"])


class AgentboxOpeningFrameChooser:
    """Score candidate frames against the cast and return the best (no torch needed)."""

    CATEGORY = "agentbox/video"
    FUNCTION = "run"
    RETURN_TYPES = ("IMAGE", "INT", "STRING")
    RETURN_NAMES = ("best", "index", "report_json")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "candidates": ("IMAGE",), "references": ("IMAGE",),
            "weak_below": ("FLOAT", {"default": 0.25, "min": 0.0, "max": 1.0, "step": 0.01}),
            "min_face_frac": ("FLOAT", {"default": 0.12, "min": 0.0, "max": 1.0, "step": 0.01}),
        }, "optional": {"ref_names": ("STRING", {"default": ""})}}

    def run(self, candidates, references, weak_below, min_face_frac, ref_names=""):
        emb = _shared_embedder()
        th = ThresholdSet(weak_below=weak_below, min_face_frac=min_face_frac)
        pics = tensor_to_bgr_frames(references)
        refs = reference_embeddings(emb, dict(zip(_names(ref_names, len(pics)), pics)))
        rep = choose_opening_frame(tensor_to_bgr_frames(candidates), refs, emb, th)
        idx = rep["chosen"] if rep["chosen"] is not None else 0
        return (candidates[idx:idx + 1], int(idx), json.dumps(rep))


NODE_CLASS_MAPPINGS = {
    "AgentboxIdentityScore": AgentboxIdentityScore,
    "AgentboxOpeningFrameChooser": AgentboxOpeningFrameChooser,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AgentboxIdentityScore": "Agentbox Identity Score",
    "AgentboxOpeningFrameChooser": "Agentbox Opening Frame Chooser",
}

if __name__ == "__main__":
    sys.exit(main())
