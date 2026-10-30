"""Retake preparation: generation range, retake mask and the retake-plan JSON.

Half-open frame intervals throughout. Given a clip of ``N`` frames and a retake
interval ``[a, b)``, generation covers ``[a - pre, b + post)`` clamped to the
clip. Requested rolls must be at least ``MIN_ROLL`` (4) frames; clamping at a
clip edge is reported (``clamped``) and the *effective* rolls are recorded. At a
clamped edge there is no original footage to join to, so no overlap is needed
there. Frames outside the generation range come from the original unchanged.
"""
import json

import numpy as np

SCHEMA = "retake-plan/1"
MIN_ROLL = 4
OVERLAP_FRAMES = 4


def plan_retake(clip_frames, a, b, pre_roll=MIN_ROLL, post_roll=MIN_ROLL):
    n, a, b = int(clip_frames), int(a), int(b)
    if n <= 0:
        raise ValueError("clip_frames must be positive")
    if not (0 <= a < b <= n):
        raise ValueError(f"retake [{a}, {b}) must satisfy 0 <= a < b <= {n}")
    if pre_roll < MIN_ROLL or post_roll < MIN_ROLL:
        raise ValueError(f"pre/post roll must be >= {MIN_ROLL} frames (got {pre_roll}, {post_roll})")
    s = max(0, a - pre_roll)
    e = min(n, b + post_roll)
    return {
        "schema": SCHEMA,
        "clip_frames": n,
        "retake": [a, b],
        "pre_roll": a - s,
        "post_roll": e - b,
        "generation": [s, e],
        "overlap_frames": OVERLAP_FRAMES,
        "clamped": (s != a - pre_roll) or (e != b + post_roll),
    }


def retake_mask(plan):
    """float32 [G] vector: 1 on retake frames, 0 on the pre/post rolls."""
    s, e = plan["generation"]
    a, b = plan["retake"]
    m = np.zeros(e - s, dtype=np.float32)
    m[a - s : b - s] = 1.0
    return m


def prepare_retake(frames, a, b, pre_roll=MIN_ROLL, post_roll=MIN_ROLL):
    """Return ``(generation_frames, mask [G,H,W], plan)`` for a frame array [N,H,W,C]."""
    frames = np.asarray(frames)
    plan = plan_retake(frames.shape[0], a, b, pre_roll, post_roll)
    s, e = plan["generation"]
    gen = frames[s:e]
    h, w = frames.shape[1:3]
    mask = np.broadcast_to(retake_mask(plan)[:, None, None], (e - s, h, w)).astype(np.float32).copy()
    return gen, mask, plan


class AgentboxRetakePrep:
    CATEGORY = "agentbox/retake"
    FUNCTION = "run"
    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("generation_frames", "retake_mask", "retake_plan_json")

    @classmethod
    def INPUT_TYPES(cls):
        big = 1 << 20
        return {"required": {
            "frames": ("IMAGE",),
            "retake_start": ("INT", {"default": 0, "min": 0, "max": big}),
            "retake_end": ("INT", {"default": 8, "min": 1, "max": big}),
            "pre_roll": ("INT", {"default": MIN_ROLL, "min": MIN_ROLL, "max": big}),
            "post_roll": ("INT", {"default": MIN_ROLL, "min": MIN_ROLL, "max": big}),
        }}

    def run(self, frames, retake_start, retake_end, pre_roll, post_roll):
        import torch

        arr = frames.detach().cpu().numpy()
        gen, mask, plan = prepare_retake(arr, retake_start, retake_end, pre_roll, post_roll)
        return (torch.from_numpy(np.ascontiguousarray(gen)), torch.from_numpy(mask), json.dumps(plan, sort_keys=True))


NODE_CLASS_MAPPINGS = {"AgentboxRetakePrep": AgentboxRetakePrep}
NODE_DISPLAY_NAME_MAPPINGS = {"AgentboxRetakePrep": "Retake Prep (generation range + plan)"}
