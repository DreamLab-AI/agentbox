#!/usr/bin/env python3
"""Optional MarkLLM text-watermark harness backed by an external THU-BPM/MarkLLM checkout.

This script does NOT vendor upstream code. It imports ``AutoWatermark`` from a
user-provided checkout (https://github.com/THU-BPM/MarkLLM) at runtime, using
that environment's optional dependencies (torch, transformers, datasets, ...).

MarkLLM is Apache-2.0. It is a research/verification harness: detection is only
valid against the SAME scheme config + keys used at generation. It cannot
certify that a vendor detector will fail on the given text.

Subcommands:
  detect    run detection on a text file with a known scheme/config
  watermark generate watermarked (and optionally unwatermarked) sample text
            from a prompt, for controlled before/after experiments

Exit codes:
  0  success
  1  runtime error (model load, detection/generation failure)
  2  bad input (missing/unreadable file, binary input, bad args)
  3  unavailable (not configured / missing checkout / missing deps)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

from common import eprint, emit_json, read_text_input, safe_write_text  # noqa: E402

# Scheme name as the user types it -> MarkLLM algorithm name (config/{ALG}.json).
SCHEMES = {
    "kgw": "KGW",
    "synthid": "SynthID",
    "synthid-text": "SynthID",
}

DEFAULT_MODEL = "facebook/opt-1.3b"

# Algorithm configs are ~200 B (KGW/SynthID). Cap well above that so a crafted
# or accidental huge file is refused before either this script or upstream
# reads it into memory.
MAX_CONFIG_BYTES = 1 << 20


class _Unavailable(RuntimeError):
    """Backend present but unusable (unconfigured checkout, missing deps)."""


def resolve_upstream(raw: str | None) -> Path | None:
    if not raw:
        return None
    upstream = Path(raw).expanduser().resolve()
    if not upstream.is_dir():
        return None
    return upstream


def resolve_device(raw: str | None) -> str:
    """Resolve the ``auto`` device hint to a concrete torch device."""
    if raw and raw != "auto":
        return raw
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        mps = getattr(torch.backends, "mps", None)
        if mps is not None and mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def _load_algorithm(
    upstream: Path, alg: str, config: Path, model: str, device: str, offline: bool = False
):
    """Import the checkout and build an ``AutoWatermark`` instance."""
    sys.path.insert(0, str(upstream))
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer  # noqa: E402
        from utils.transformers_config import TransformersConfig  # noqa: E402
        from watermark.auto_watermark import AutoWatermark  # noqa: E402
    except ImportError as e:
        raise _Unavailable(f"MarkLLM dependencies missing: {e}") from e

    # --offline: never contact the HF hub. local_files_only makes transformers
    # fail fast instead of hanging, and HF_HUB_OFFLINE covers the lower-level
    # hub calls. Custom-code execution is not possible either way: transformers
    # only honors auto_map/trust_remote_code when explicitly enabled, which is
    # never done here.
    if offline:
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
    load_kwargs = {"local_files_only": True} if offline else {}

    tokenizer = AutoTokenizer.from_pretrained(model, **load_kwargs)
    lm = AutoModelForCausalLM.from_pretrained(model, **load_kwargs).to(device)
    transformers_config = TransformersConfig(
        model=lm,
        tokenizer=tokenizer,
        device=device,
        max_new_tokens=200,
        min_length=0,
        do_sample=True,
        no_repeat_ngram_size=4,
    )
    return AutoWatermark.load(
        alg,
        algorithm_config=str(config),
        transformers_config=transformers_config,
    )


def _threshold_from_config(config: Path) -> float | None:
    try:
        data = json.loads(config.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    for key in ("threshold", "z_threshold"):
        value = data.get(key)
        if isinstance(value, (int, float)):
            return float(value)
    return None


def _resolve_config(upstream: Path, alg: str, config: str | None) -> Path:
    if config:
        path = Path(config).expanduser().resolve()
    else:
        path = upstream / "config" / f"{alg}.json"
    if not path.is_file():
        raise _Unavailable(f"MarkLLM config not found: {path}")
    try:
        size = path.stat().st_size
    except OSError as e:
        raise _Unavailable(f"cannot stat MarkLLM config {path}: {e}") from e
    if size > MAX_CONFIG_BYTES:
        raise _Unavailable(
            f"MarkLLM config too large ({size} bytes > {MAX_CONFIG_BYTES}): {path}"
        )
    return path


def _cmd_detect(args: argparse.Namespace, upstream: Path, alg: str) -> int:
    if args.path != "-" and not Path(args.path).is_file():
        eprint(f"not a file: {args.path}")
        return 2
    text = read_text_input(args.path, allow_binary=args.force_text)

    device = resolve_device(args.device)

    try:
        config = _resolve_config(upstream, alg, args.config)
        threshold = _threshold_from_config(config)
        wm = _load_algorithm(
            upstream, alg, config, args.model, device, offline=args.offline
        )
        result = wm.detect_watermark(text, return_dict=True)
    except _Unavailable as e:
        eprint(str(e))
        return 3
    except Exception as e:
        eprint(f"detection error: {e}")
        return 1

    is_watermarked = bool(result.get("is_watermarked", False))
    score = result.get("score")
    try:
        score = float(score)
    except (TypeError, ValueError):
        score = None

    payload = {
        "available": True,
        "upstream_dir": str(upstream),
        "scheme": alg,
        "config": str(config),
        "model": args.model,
        "device": device,
        "is_watermarked": is_watermarked,
        "score": score,
        "threshold": threshold,
    }

    if args.json:
        emit_json(payload)
    else:
        label = "watermarked" if is_watermarked else "not watermarked"
        score_txt = f"{score:.4f}" if score is not None else "n/a"
        thresh_txt = f"{threshold:.4f}" if threshold is not None else "n/a"
        print(f"{alg}: {label} (score {score_txt}, threshold {thresh_txt})")

    return 0


def _cmd_watermark(args: argparse.Namespace, upstream: Path, alg: str) -> int:
    prompt = read_text_input(args.prompt, allow_binary=args.force_text)

    device = resolve_device(args.device)

    try:
        config = _resolve_config(upstream, alg, args.config)
        wm = _load_algorithm(
            upstream, alg, config, args.model, device, offline=args.offline
        )
        if args.seed is not None:
            import torch

            torch.manual_seed(args.seed)
        wm.config.gen_kwargs["max_new_tokens"] = args.max_new_tokens
        wm.config.gen_kwargs["min_length"] = args.min_length
        watermarked = wm.generate_watermarked_text(prompt)
        unwatermarked = None
        if args.unwatermarked_output:
            unwatermarked = wm.generate_unwatermarked_text(prompt)
    except _Unavailable as e:
        eprint(str(e))
        return 3
    except Exception as e:
        eprint(f"generation error: {e}")
        return 1

    wm_out = "-" if args.watermarked_output is None else args.watermarked_output
    safe_write_text(wm_out, watermarked)
    if unwatermarked is not None:
        safe_write_text(args.unwatermarked_output, unwatermarked)

    payload = {
        "available": True,
        "upstream_dir": str(upstream),
        "scheme": alg,
        "config": str(config),
        "model": args.model,
        "device": device,
        "watermarked_output": wm_out,
        "unwatermarked_output": args.unwatermarked_output,
        "watermarked_chars": len(watermarked),
        "unwatermarked_chars": len(unwatermarked) if unwatermarked is not None else None,
    }

    if args.json:
        emit_json(payload)
    else:
        print(f"{alg}: watermarked sample ({payload['watermarked_chars']} chars) -> {wm_out}")
        if unwatermarked is not None:
            print(f"      unwatermarked sample ({payload['unwatermarked_chars']} chars) -> {args.unwatermarked_output}")

    return 0


def _add_common(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--upstream-dir",
        type=Path,
        default=None,
        help="MarkLLM checkout root (default: $MARKLLM_DIR)",
    )
    p.add_argument(
        "--scheme",
        required=True,
        choices=sorted(SCHEMES),
        help="Watermark scheme to use (kgw, synthid)",
    )
    p.add_argument(
        "--config",
        default=None,
        help="Algorithm config JSON (default: <checkout>/config/<ALG>.json)",
    )
    p.add_argument(
        "--model",
        default=os.environ.get("MARKLLM_MODEL", DEFAULT_MODEL),
        help=f"HF causal LM for scoring (default: $MARKLLM_MODEL or {DEFAULT_MODEL})",
    )
    p.add_argument(
        "--device",
        default="auto",
        help="auto|cpu|cuda|mps (default: auto)",
    )
    p.add_argument(
        "--offline",
        action="store_true",
        help="Never contact the HF hub: load the scoring model from the local "
        "cache only (fails fast if not cached)",
    )
    p.add_argument(
        "--force-text",
        action="store_true",
        help="Process input even when it looks like a binary container",
    )


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    detect = sub.add_parser("detect", help="Detect a scheme watermark in text")
    detect.add_argument("path", help="Text file to detect on, or - for stdin")
    _add_common(detect)
    detect.add_argument("--json", action="store_true", help="Emit JSON on stdout")
    detect.set_defaults(handler=_cmd_detect)

    wm = sub.add_parser("watermark", help="Generate watermarked sample text")
    wm.add_argument("prompt", help="Prompt file, or - for stdin")
    wm.add_argument("-o", "--watermarked-output", default=None,
                    help="Output path for the watermarked sample (default: stdout)")
    wm.add_argument("-o2", "--unwatermarked-output", default=None,
                    help="Also write an unwatermarked sample to this path")
    wm.add_argument("--max-new-tokens", type=int, default=200)
    wm.add_argument("--min-length", type=int, default=0)
    wm.add_argument("--seed", type=int, default=None, help="Optional RNG seed")
    _add_common(wm)
    wm.add_argument("--json", action="store_true", help="Emit JSON on stdout")
    wm.set_defaults(handler=_cmd_watermark)

    args = p.parse_args()

    if args.cmd == "detect" and args.path != "-" and not Path(args.path).is_file():
        eprint(f"not a file: {args.path}")
        return 2

    raw_upstream = args.upstream_dir or os.environ.get("MARKLLM_DIR")
    upstream = resolve_upstream(str(raw_upstream) if raw_upstream else None)
    if upstream is None:
        eprint(
            "MarkLLM not configured: set MARKLLM_DIR or pass --upstream-dir",
        )
        return 3

    if not (upstream / "watermark").is_dir():
        eprint(f"MarkLLM checkout incomplete (no watermark/ dir): {upstream}")
        return 3

    alg = SCHEMES[args.scheme]
    return args.handler(args, upstream, alg)


if __name__ == "__main__":
    raise SystemExit(main())
