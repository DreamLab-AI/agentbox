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
median and template paths are additionally probed at several scales and refused when a
different scale correlates better (:func:`_scale_probe`). The returned list always has exactly one mask per frame (asserted).
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
    provenance: str = "h3-spec-uncalibrated"  # thresholds are configuration, not calibrated constants
    calibrated: bool = False
    lk_window: int = 11          # LK window; corners near the mask edge see background
    corner_erode: int = 6        # erode the mask by this many px before picking corners
    # Paths that cannot measure scale (median, template) probe the bbox correlation at
    # these scales; a better-correlating scale outside [scale_min, scale_max] is refused.
    scale_probes: tuple = (0.8, 0.9, 0.95, 1.0, 1.05, 1.1, 1.2, 1.3)
    probe_shift: int = 3              # px of translation slack searched at each probe scale
    scale_probe_margin: float = 0.05  # correlation gain over scale 1.0 that counts as "better"

    def __post_init__(self):
        # Calibrated acceptance was removed (ADR-2163): these bounds are measurement configuration only.
        if self.calibrated:
            raise ValueError("calibrated acceptance was removed (ADR-2163); acceptance is editorial")


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


def _bbox_correlation(prev, cur, mask, d):
    """Normalised correlation of the mask bbox in ``prev`` with the same box shifted by ``d`` in ``cur``."""
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    dx, dy = int(round(d[0])), int(round(d[1]))
    nx0, ny0 = x0 + dx, y0 + dy
    if nx0 < 0 or ny0 < 0 or nx0 + (x1 - x0) > cur.shape[1] or ny0 + (y1 - y0) > cur.shape[0]:
        return -1.0
    r = cv2.matchTemplate(cur[ny0:ny0 + y1 - y0, nx0:nx0 + x1 - x0], prev[y0:y1, x0:x1], cv2.TM_CCOEFF_NORMED)
    v = float(r[0, 0])
    return v if np.isfinite(v) else -1.0


def _scale_probe(prev, cur, mask, d, cfg, step, base_scale=1.0):
    """Refuse a translation-only step when another scale explains the subject better.

    The median and template paths assume scale 1.0 without measuring it. Resample the
    translated neighbourhood in ``cur`` at each probe scale (about the translated bbox
    centre) and correlate it with the previous bbox. If a scale outside the allowed
    ``[scale_min, scale_max]`` beats scale 1.0 by ``scale_probe_margin``, the subject
    has grown or shrunk and a 1.0 mask would under- or over-cover it.

    ``base_scale`` is the scale already measured (the cumulative transform's); probes are
    taken relative to it, so a zoom tracked correctly earlier is not mistaken for unmeasured growth.
    """
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    bw, bh = x1 - x0, y1 - y0
    tpl = prev[y0:y1, x0:x1]
    cx, cy = (x0 + x1) / 2.0 + d[0], (y0 + y1) / 2.0 + d[1]

    r = cfg.probe_shift

    def corr(s):
        # Padded window (r px in resized space) so a template-match offset of a few pixels, which a
        # growing subject induces, does not hide the better scale. Best over the shifts.
        w, h = max(2, int(round((bw + 2 * r) * s))), max(2, int(round((bh + 2 * r) * s)))
        px0, py0 = int(round(cx - w / 2.0)), int(round(cy - h / 2.0))
        if px0 < 0 or py0 < 0 or px0 + w > cur.shape[1] or py0 + h > cur.shape[0]:
            return -1.0
        patch = cv2.resize(cur[py0:py0 + h, px0:px0 + w], (bw + 2 * r, bh + 2 * r), interpolation=cv2.INTER_AREA)
        v = float(cv2.matchTemplate(patch, tpl, cv2.TM_CCOEFF_NORMED).max())
        return v if np.isfinite(v) else -1.0

    base = corr(base_scale)
    best_s, best = 1.0, base
    for s in cfg.scale_probes:
        c = corr(base_scale * s)
        if c > best:
            best_s, best = s, c
    if best_s != 1.0 and best > base + cfg.scale_probe_margin and not (cfg.scale_min <= best_s <= cfg.scale_max):
        raise TrackingError(f"step {step}: scale {best_s:.2f} outside [{cfg.scale_min}, {cfg.scale_max}] "
                            f"(unmeasured, relative to measured {base_scale:.3f}; bbox correlation {best:.3f} "
                            f"vs {base:.3f} at 1.0)")


def _step(prev, cur, mask, cfg, step):
    """Return ``(M 2x3, method, scale)`` mapping the mask from ``prev`` to ``cur``.

    ``scale`` is ``None`` on the median and template paths: they cannot measure it.
    """
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
        mm = np.array([[1, 0, d[0]], [0, 1, d[1]]], dtype=np.float64)
        # A pure translation cannot measure scale, so it must not vouch for it:
        # verify the translated bbox still correlates with the previous one.
        score = _bbox_correlation(prev, cur, mask, d)
        if score < cfg.template_floor:
            raise TrackingError(f"step {step}: median-motion correlation {score:.3f} below floor "
                                f"{cfg.template_floor} (unmeasured scale/shape change)")
        _scale_probe(prev, cur, mask, d, cfg, step)
        return mm, "median", None
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    tpl = prev[y0:y1, x0:x1]
    if tpl.shape[0] > cur.shape[0] or tpl.shape[1] > cur.shape[1]:
        raise TrackingError(f"step {step}: template larger than frame")
    res = cv2.matchTemplate(cur, tpl, cv2.TM_CCOEFF_NORMED)
    _, score, _, loc = cv2.minMaxLoc(res)
    if not np.isfinite(score) or score < cfg.template_floor:
        raise TrackingError(f"step {step}: template correlation {score:.3f} below floor {cfg.template_floor}")
    _scale_probe(prev, cur, mask, (loc[0] - x0, loc[1] - y0), cfg, step)
    return np.array([[1, 0, loc[0] - x0], [0, 1, loc[1] - y0]], dtype=np.float64), "template", None


def track_mask(frames, seed_mask, config=None, return_log=False):
    """Track ``seed_mask`` (H,W; frame 0) through ``frames`` [N,H,W,C].

    Returns uint8 {0,1} masks [N,H,W]; with ``return_log`` also a per-step list of
    ``{"step", "method", "scale", "scale_measured", "area"}``; ``scale`` is ``None``
    (``scale_measured`` false) on the median and template paths, which cannot measure it. Raises :class:`TrackingError`.
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
    log = [{"step": 0, "method": "seed", "scale": 1.0, "scale_measured": True, "area": _check_area(mask, cfg, 0)}]
    prev = _gray(frames[0])
    seed_gray = prev
    sys_, sxs = np.nonzero(seed)
    seed_centre = np.array([(sxs.min() + sxs.max() + 1) / 2.0, (sys_.min() + sys_.max() + 1) / 2.0, 1.0])
    for i in range(1, n):
        cur = _gray(frames[i])
        m, method, scale = _step(prev, cur, mask, cfg, i)
        if scale is not None and not (cfg.scale_min <= scale <= cfg.scale_max):
            raise TrackingError(f"step {i}: scale {scale:.3f} outside [{cfg.scale_min}, {cfg.scale_max}] ({method})")
        # Compose onto the seed instead of re-warping the previous mask, so
        # nearest-neighbour rounding does not accumulate step after step.
        cum = np.vstack([m, [0, 0, 1]]) @ cum
        if scale is None:
            # Unmeasured step: also probe against the seed at the cumulative translation, so growth
            # spread over several in-bound steps cannot add up unseen.
            # Relative to the cumulative scale already measured by earlier LK steps.
            measured = float(np.sqrt(abs(np.linalg.det(cum[:2, :2]))))
            _scale_probe(seed_gray, cur, seed, (cum @ seed_centre - seed_centre)[:2], cfg, i, measured)
        mask = cv2.warpAffine(seed, cum[:2], (w, h), flags=cv2.INTER_NEAREST, borderValue=0)
        log.append({"step": i, "method": method, "scale": scale, "scale_measured": scale is not None, "area": _check_area(mask, cfg, i)})
        out.append(mask)
        prev = cur
    arr = np.stack(out)
    if arr.shape[0] != n:
        raise AssertionError(f"mask count {arr.shape[0]} != frame count {n}")
    return (arr, log) if return_log else arr


def threshold_report(cfg):
    """The threshold set with its provenance, for receipts and the node's log output."""
    d = dict(vars(cfg))
    d["provisional"] = True
    d["acceptance"] = "editorial"
    return d


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
        return (torch.from_numpy(masks.astype(np.float32)), json.dumps({"thresholds": threshold_report(cfg), "steps": log}))


NODE_CLASS_MAPPINGS = {"AgentboxTrackMask": AgentboxTrackMask}
NODE_DISPLAY_NAME_MAPPINGS = {"AgentboxTrackMask": "Track Mask (fail-closed)"}
