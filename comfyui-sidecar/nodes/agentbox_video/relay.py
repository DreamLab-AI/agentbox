"""Window relay preparation for object removal (staged, continuation windows).

A window is ``anchor + stride`` frames (H3 profile: 5 + 17 = 22). Window 0 has no
anchor: it is ``anchor + stride`` masked source frames. Every continuation window
is the last ``anchor`` frames of the *previous rendered* window followed by
``stride`` new masked source frames. Original subject pixels therefore never
enter a continuation's anchor region: the anchor is copied from the previous
render only, and carries an all-zero mask (keep).

The mask handed to the model is the union of the window's new-frame masks,
optionally dilated, applied to every new frame. Masked pixels in the new region
are blanked to mid-grey by default so the subject cannot leak through unmasked
conditioning.
"""
import json

import cv2
import numpy as np

DEFAULT_ANCHOR = 5
DEFAULT_STRIDE = 17


def plan_windows(total_frames, anchor=DEFAULT_ANCHOR, stride=DEFAULT_STRIDE):
    """Tile ``total_frames`` source frames into relay windows.

    Returns dicts ``{index, src_start, src_end, anchor, pad}`` where
    ``[src_start, src_end)`` is the half-open range of NEW source frames
    (``anchor + stride`` for window 0, ``stride`` after) and ``pad`` is the
    number of tail frames repeated to fill the last window (discarded at
    assembly). Delivered frames sum to ``total_frames``.
    """
    if total_frames <= 0 or anchor < 1 or stride < 1:
        raise ValueError("total_frames, anchor and stride must be positive")
    windows, pos, i = [], 0, 0
    while pos < total_frames:
        want = anchor + stride if i == 0 else stride
        end = min(total_frames, pos + want)
        windows.append({"index": i, "src_start": pos, "src_end": end,
                        "anchor": 0 if i == 0 else anchor, "pad": want - (end - pos)})
        pos, i = end, i + 1
    assert sum(w["src_end"] - w["src_start"] for w in windows) == total_frames
    return windows


def union_mask(masks, dilation=0):
    """Union (max) over ``masks`` [T,H,W] -> uint8 {0,1} [H,W], dilated by ``dilation`` px."""
    m = (np.asarray(masks) > 0.5).any(axis=0).astype(np.uint8)
    if dilation > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * dilation + 1, 2 * dilation + 1))
        m = cv2.dilate(m, k)
    return m


def build_window(source_frames, source_masks, window, previous_rendered=None, dilation=0,
                 blank_value=0.5, anchor=DEFAULT_ANCHOR, stride=DEFAULT_STRIDE):
    """Assemble one relay window.

    ``source_frames`` [N,H,W,C] float and ``source_masks`` [N,H,W] cover the whole
    clip; ``window`` is an item from :func:`plan_windows`;
    ``previous_rendered`` [R,H,W,C] is the previous rendered window (required for
    continuations, ignored for window 0). Returns ``(frames, mask, info)`` with
    ``frames`` [anchor+stride,H,W,C] (continuations: ``window['anchor']`` anchor
    frames first), ``mask`` [same,H,W] float32, and ``info`` metadata.
    """
    src = np.asarray(source_frames)
    msk = np.asarray(source_masks)
    if src.shape[0] != msk.shape[0]:
        raise ValueError(f"frames ({src.shape[0]}) and masks ({msk.shape[0]}) differ in length")
    a = window["anchor"]
    s, e, pad = window["src_start"], window["src_end"], window["pad"]
    want = (anchor + stride) if window["index"] == 0 else stride
    if a not in (0, anchor):
        raise ValueError(f"window anchor {a} inconsistent with anchor={anchor}")
    new_frames = src[s:e]
    new_masks = msk[s:e]
    if new_frames.shape[0] + pad != want:
        raise ValueError(f"window {window['index']}: {new_frames.shape[0]} new + {pad} pad != {want}")
    if pad:
        new_frames = np.concatenate([new_frames, np.repeat(new_frames[-1:], pad, axis=0)])
        new_masks = np.concatenate([new_masks, np.repeat(new_masks[-1:], pad, axis=0)])
    union = union_mask(new_masks[: want - pad], dilation)
    h, w = union.shape
    new_region = new_frames.astype(np.float32).copy()
    new_region[:, union.astype(bool)] = blank_value  # subject pixels never reach the model
    mask = np.zeros((a + want, h, w), dtype=np.float32)
    mask[a:] = union
    if a:
        if previous_rendered is None or len(previous_rendered) < a:
            raise ValueError(f"window {window['index']} needs >= {a} frames of previous render")
        anchor_frames = np.asarray(previous_rendered)[-a:].astype(np.float32)
        frames = np.concatenate([anchor_frames, new_region])
    else:
        frames = new_region
    expected = a + want
    if frames.shape[0] != expected or mask.shape[0] != expected:
        raise AssertionError(f"window length {frames.shape[0]}/{mask.shape[0]} != {expected}")
    if a and mask[:a].any():
        raise AssertionError("anchor region must carry an all-zero mask")
    info = {"index": window["index"], "anchor": a, "stride": want, "src": [s, e], "pad": pad,
            "deliver": e - s, "dilation": dilation}
    return frames, mask, info


class AgentboxRelayPrepare:
    CATEGORY = "agentbox/relay"
    FUNCTION = "run"
    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("window_frames", "window_mask", "window_info_json")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "source_frames": ("IMAGE",),
            "source_masks": ("MASK",),
            "window_index": ("INT", {"default": 0, "min": 0, "max": 100000}),
            "anchor": ("INT", {"default": DEFAULT_ANCHOR, "min": 1, "max": 64}),
            "stride": ("INT", {"default": DEFAULT_STRIDE, "min": 1, "max": 512}),
            "dilation": ("INT", {"default": 0, "min": 0, "max": 128}),
        }, "optional": {"previous_rendered": ("IMAGE",)}}

    def run(self, source_frames, source_masks, window_index, anchor, stride, dilation, previous_rendered=None):
        import torch

        src = source_frames.detach().cpu().numpy()
        wins = plan_windows(src.shape[0], anchor, stride)
        if window_index >= len(wins):
            raise ValueError(f"window_index {window_index} >= {len(wins)} windows")
        prev = None if previous_rendered is None else previous_rendered.detach().cpu().numpy()
        frames, mask, info = build_window(src, source_masks.detach().cpu().numpy(), wins[window_index],
                                          prev, dilation, anchor=anchor, stride=stride)
        return (torch.from_numpy(frames), torch.from_numpy(mask), json.dumps(info, sort_keys=True))


NODE_CLASS_MAPPINGS = {"AgentboxRelayPrepare": AgentboxRelayPrepare}
NODE_DISPLAY_NAME_MAPPINGS = {"AgentboxRelayPrepare": "Relay Window Prepare (object removal)"}
