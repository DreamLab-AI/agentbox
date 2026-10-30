"""Retake preparation: generation range, retake mask and the retake geometry.

Half-open frame intervals throughout. Given a clip of ``N`` frames and a retake
interval ``[a, b)``, generation covers ``[a - pre, b + post)`` clamped to the
clip. Requested rolls must be at least ``max(MIN_ROLL, overlap)`` frames;
clamping at a clip edge is reported per edge and the *applied* rolls are
recorded. At a clamped edge there is no original footage to join to, so no
overlap is needed there. Frames outside the generation range come from the
original unchanged.

The geometry is the same contract as the runtime's ``stitch plan-retake``
(``retake-geometry/1``); ``tests/retake_geometry_cases.json`` pins both. The
caller adds rate and assets to it to form the ``retake-plan/1`` that
``stitch retake`` consumes.
"""
import json

import numpy as np

SCHEMA = "retake-geometry/1"
MIN_ROLL = 4
DEFAULT_OVERLAP = 4


def plan_retake(frames, a, b, pre_roll=MIN_ROLL, post_roll=MIN_ROLL, overlap=DEFAULT_OVERLAP):
    n, a, b = int(frames), int(a), int(b)
    pre, post, overlap = int(pre_roll), int(post_roll), int(overlap)
    if n <= 0:
        raise ValueError("frames must be positive")
    if not (0 <= a < b <= n):
        raise ValueError(f"retake [{a}, {b}) must satisfy 0 <= a < b <= {n}")
    floor = max(MIN_ROLL, overlap)
    if overlap < 1 or pre < floor or post < floor:
        raise ValueError(f"pre/post roll must be >= max({MIN_ROLL}, overlap) frames and overlap >= 1 "
                         f"(got pre={pre}, post={post}, overlap={overlap})")
    s = max(0, a - pre)
    e = min(n, b + post)
    return {
        "schema": SCHEMA,
        "frames": n,
        "retake": [a, b],
        "generation": [s, e],
        "pre_requested": pre,
        "post_requested": post,
        "pre_applied": a - s,
        "post_applied": e - b,
        "clamped_head": a < pre,
        "clamped_tail": b + post > n,
        "overlap": overlap,
    }


def retake_mask(plan):
    """float32 [G] vector: 1 on retake frames, 0 on the pre/post rolls."""
    s, e = plan["generation"]
    a, b = plan["retake"]
    m = np.zeros(e - s, dtype=np.float32)
    m[a - s : b - s] = 1.0
    return m


def prepare_retake(frames, a, b, pre_roll=MIN_ROLL, post_roll=MIN_ROLL, overlap=DEFAULT_OVERLAP):
    """Return ``(generation_frames, mask [G,H,W], geometry)`` for a frame array [N,H,W,C]."""
    frames = np.asarray(frames)
    plan = plan_retake(frames.shape[0], a, b, pre_roll, post_roll, overlap)
    s, e = plan["generation"]
    gen = frames[s:e]
    h, w = frames.shape[1:3]
    mask = np.broadcast_to(retake_mask(plan)[:, None, None], (e - s, h, w)).astype(np.float32).copy()
    return gen, mask, plan


class AgentboxRetakePrep:
    CATEGORY = "agentbox/retake"
    FUNCTION = "run"
    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("generation_frames", "retake_mask", "retake_geometry_json")

    @classmethod
    def INPUT_TYPES(cls):
        big = 1 << 20
        return {"required": {
            "frames": ("IMAGE",),
            "retake_start": ("INT", {"default": 0, "min": 0, "max": big}),
            "retake_end": ("INT", {"default": 8, "min": 1, "max": big}),
            "pre_roll": ("INT", {"default": MIN_ROLL, "min": MIN_ROLL, "max": big}),
            "post_roll": ("INT", {"default": MIN_ROLL, "min": MIN_ROLL, "max": big}),
            "overlap": ("INT", {"default": DEFAULT_OVERLAP, "min": 1, "max": big}),
        }}

    def run(self, frames, retake_start, retake_end, pre_roll, post_roll, overlap=DEFAULT_OVERLAP):
        import torch

        arr = frames.detach().cpu().numpy()
        gen, mask, plan = prepare_retake(arr, retake_start, retake_end, pre_roll, post_roll, overlap)
        return (torch.from_numpy(np.ascontiguousarray(gen)), torch.from_numpy(mask), json.dumps(plan, sort_keys=True))


NODE_CLASS_MAPPINGS = {"AgentboxRetakePrep": AgentboxRetakePrep}
NODE_DISPLAY_NAME_MAPPINGS = {"AgentboxRetakePrep": "Retake Prep (generation range + plan)"}
