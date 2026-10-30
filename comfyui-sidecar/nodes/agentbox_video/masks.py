"""Fail-closed pixel mask tracking.

From a seed mask, each step estimates the subject's motion:

1. Lucas-Kanade optical flow on corners inside the mask, then a RANSAC
   partial-affine fit (``cv2.estimateAffinePartial2D``)  -> ``lk_affine``;
2. else the median flow vector of the tracked corners        -> ``median``;
3. else template matching of the mask's bounding box with a correlation floor
   (default 0.52)                                             -> ``template``.

It raises :class:`TrackingError` rather than guess: when template correlation is
below the floor, when the per-step scale leaves ``[scale_min, scale_max]``, or
when the warped mask's area leaves ``[area_min, area_max]`` of the frame. The
returned list always has exactly one mask per frame (asserted).
"""
from dataclasses import dataclass

import cv2
import numpy as np


class TrackingError(RuntimeError):
    """Tracking could not continue safely; the caller must reseed or fail the shot."""


@dataclass
class TrackerConfig:
    area_min: float = 0.00005   # 0.005 % of the frame
    area_max: float = 0.82
    scale_min: float = 0.92
    scale_max: float = 1.08
    template_floor: float = 0.52
    max_corners: int = 200
    min_points: int = 4          # tracked corners needed for any flow-based step
    min_affine_points: int = 4   # corners needed to attempt the affine fit
    min_inliers: int = 4
    ransac_thresh: float = 3.0
    lk_window: int = 11          # LK window; corners near the mask edge see background
    corner_erode: int = 6        # erode the mask by this many px before picking corners


def _gray(frame):
    f = np.asarray(frame)
    if f.dtype != np.uint8:
        f = np.clip(f * 255.0 if f.max() <= 1.0 + 1e-6 else f, 0, 255).astype(np.uint8)
    return cv2.cvtColor(f, cv2.COLOR_RGB2GRAY) if f.ndim == 3 and f.shape[2] == 3 else f.reshape(f.shape[:2])


def _check_area(mask, cfg, step):
    frac = float(mask.sum()) / mask.size
    if not (cfg.area_min <= frac <= cfg.area_max):
        raise TrackingError(f"step {step}: mask area {frac:.6f} outside [{cfg.area_min}, {cfg.area_max}]")
    return frac


def _step(prev, cur, mask, cfg, step):
    """Return ``(M 2x3, method, scale)`` mapping the mask from ``prev`` to ``cur``."""
    pts = None
    # Prefer corners well inside the mask (their LK window sees only the subject);
    # relax the erosion for small masks rather than lose flow altogether.
    for r in sorted({cfg.corner_erode, cfg.corner_erode // 2, 1}, reverse=True):
        pts = cv2.goodFeaturesToTrack(prev, cfg.max_corners, 0.01, 3,
                                      mask=cv2.erode(mask, np.ones((2 * r + 1, 2 * r + 1), np.uint8)))
        if pts is not None and len(pts) >= cfg.min_points:
            break
    good_old = good_new = None
    if pts is not None and len(pts) >= cfg.min_points:
        nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev, cur, pts, None, winSize=(cfg.lk_window, cfg.lk_window), maxLevel=3)
        ok = st.reshape(-1) == 1
        if ok.sum() >= cfg.min_points:
            good_old, good_new = pts[ok].reshape(-1, 2), nxt[ok].reshape(-1, 2)
    if good_old is not None:
        if len(good_old) >= cfg.min_affine_points:
            m, inl = cv2.estimateAffinePartial2D(good_old, good_new, method=cv2.RANSAC,
                                                 ransacReprojThreshold=cfg.ransac_thresh)
            if m is not None and inl is not None and int(inl.sum()) >= cfg.min_inliers:
                return m, "lk_affine", float(np.sqrt(abs(np.linalg.det(m[:, :2]))))
        d = np.median(good_new - good_old, axis=0)
        return np.array([[1, 0, d[0]], [0, 1, d[1]]], dtype=np.float64), "median", 1.0
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    tpl = prev[y0:y1, x0:x1]
    if tpl.shape[0] > cur.shape[0] or tpl.shape[1] > cur.shape[1]:
        raise TrackingError(f"step {step}: template larger than frame")
    res = cv2.matchTemplate(cur, tpl, cv2.TM_CCOEFF_NORMED)
    _, score, _, loc = cv2.minMaxLoc(res)
    if not np.isfinite(score) or score < cfg.template_floor:
        raise TrackingError(f"step {step}: template correlation {score:.3f} below floor {cfg.template_floor}")
    return np.array([[1, 0, loc[0] - x0], [0, 1, loc[1] - y0]], dtype=np.float64), "template", 1.0


def track_mask(frames, seed_mask, config=None, return_log=False):
    """Track ``seed_mask`` (H,W; frame 0) through ``frames`` [N,H,W,C].

    Returns uint8 {0,1} masks [N,H,W]; with ``return_log`` also a per-step list of
    ``{"step", "method", "scale", "area"}``. Raises :class:`TrackingError`.
    """
    cfg = config or TrackerConfig()
    n = len(frames)
    if n == 0:
        raise ValueError("no frames")
    h, w = np.asarray(frames[0]).shape[:2]
    mask = (np.asarray(seed_mask) > 0.5).astype(np.uint8)
    if mask.shape != (h, w):
        raise ValueError(f"seed mask {mask.shape} != frame {(h, w)}")
    seed = mask
    cum = np.eye(3)
    out = [mask]
    log = [{"step": 0, "method": "seed", "scale": 1.0, "area": _check_area(mask, cfg, 0)}]
    prev = _gray(frames[0])
    for i in range(1, n):
        cur = _gray(frames[i])
        m, method, scale = _step(prev, cur, mask, cfg, i)
        if not (cfg.scale_min <= scale <= cfg.scale_max):
            raise TrackingError(f"step {i}: scale {scale:.3f} outside [{cfg.scale_min}, {cfg.scale_max}] ({method})")
        # Compose onto the seed instead of re-warping the previous mask, so
        # nearest-neighbour rounding does not accumulate step after step.
        cum = np.vstack([m, [0, 0, 1]]) @ cum
        mask = cv2.warpAffine(seed, cum[:2], (w, h), flags=cv2.INTER_NEAREST, borderValue=0)
        log.append({"step": i, "method": method, "scale": scale, "area": _check_area(mask, cfg, i)})
        out.append(mask)
        prev = cur
    arr = np.stack(out)
    if arr.shape[0] != n:
        raise AssertionError(f"mask count {arr.shape[0]} != frame count {n}")
    return (arr, log) if return_log else arr


class AgentboxTrackMask:
    CATEGORY = "agentbox/masks"
    FUNCTION = "run"
    RETURN_TYPES = ("MASK", "STRING")
    RETURN_NAMES = ("masks", "tracking_log_json")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "frames": ("IMAGE",),
            "seed_mask": ("MASK",),
            "template_floor": ("FLOAT", {"default": 0.52, "min": 0.0, "max": 1.0, "step": 0.01}),
            "scale_min": ("FLOAT", {"default": 0.92, "min": 0.5, "max": 1.0, "step": 0.01}),
            "scale_max": ("FLOAT", {"default": 1.08, "min": 1.0, "max": 2.0, "step": 0.01}),
            "area_min": ("FLOAT", {"default": 0.00005, "min": 0.0, "max": 1.0, "step": 0.00001}),
            "area_max": ("FLOAT", {"default": 0.82, "min": 0.0, "max": 1.0, "step": 0.01}),
        }}

    def run(self, frames, seed_mask, template_floor, scale_min, scale_max, area_min, area_max):
        import json

        import torch

        seed = seed_mask.detach().cpu().numpy()
        seed = seed[0] if seed.ndim == 3 else seed
        cfg = TrackerConfig(area_min=area_min, area_max=area_max, scale_min=scale_min,
                            scale_max=scale_max, template_floor=template_floor)
        masks, log = track_mask(frames.detach().cpu().numpy(), seed, cfg, return_log=True)
        return (torch.from_numpy(masks.astype(np.float32)), json.dumps(log))


NODE_CLASS_MAPPINGS = {"AgentboxTrackMask": AgentboxTrackMask}
NODE_DISPLAY_NAME_MAPPINGS = {"AgentboxTrackMask": "Track Mask (fail-closed)"}
