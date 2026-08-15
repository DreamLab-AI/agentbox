#!/usr/bin/env python3
"""Layer B optional rewrite hook for statistical (token-sampling) watermarks.

Backends:
  print-prompt       — emit prompt only (default; CI-safe, no model)
  ollama             — POST to Ollama /api/chat
  openai-compatible  — POST to OpenAI-style /v1/chat/completions

Env (optional):
  WATERMARKS_REWRITE_BACKEND
  WATERMARKS_REWRITE_BASE_URL
  WATERMARKS_REWRITE_MODEL
  WATERMARKS_REWRITE_API_KEY      (env-only; never pass keys on argv)
  WATERMARKS_REWRITE_ALLOW_REMOTE (set to 1 to allow non-loopback endpoints)

Security notes:
  - Only http(s) endpoints are accepted; redirects are refused outright so an
    Authorization header (API key) can never be re-sent to an unvalidated host.
  - Non-loopback endpoints are denied unless WATERMARKS_REWRITE_ALLOW_REMOTE=1
    (or --allow-remote) is set explicitly.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import cleaned_path, eprint, read_text_input, write_text_output  # noqa: E402
from text_unicode import clean_text  # noqa: E402

DEFAULT_MARKLLM_MODEL = "facebook/opt-1.3b"

PROMPTS = {
    "paraphrase": (
        "Rewrite the following text so that it uses substantially different wording at "
        "the token level. Change clause order, connectors, and transition words; vary "
        "sentence boundaries and length; and replace both content words and function "
        "words where meaning allows. Preserve all facts, numbers, names, and technical "
        "identifiers. Do not add or remove claims. Output only the rewritten text.\n\n---\n{TEXT}"
    ),
    "humanize": (
        "Rewrite the following text so it reads as if a human wrote it from scratch. "
        "Vary sentence rhythm and length, replace formulaic AI-style transitions and "
        "filler with concrete natural phrasing, and use plain, varied wording. Preserve "
        "all facts, numbers, names, and technical identifiers. Do not add or remove "
        "claims. Output only the rewritten text.\n\n---\n{TEXT}"
    ),
    "code": (
        "Rewrite the natural-language parts of this code — comments, docstrings, and "
        "string literals — using different wording. Rename local variables, function "
        "parameters, and private helper names to semantically equivalent names. Preserve "
        "program behavior, public API names, and all values that affect output. Output "
        "only the rewritten code.\n\n---\n{TEXT}"
    ),
    "backtranslate_out": (
        "Translate the following text to {LANG}. Output only the translation.\n\n---\n{TEXT}"
    ),
    "backtranslate_back": (
        "Translate the following text to {ORIGINAL_LANG}. Preserve meaning; use natural "
        "phrasing. Output only the translation.\n\n---\n{TEXT}"
    ),
    "structural_outline": (
        "Extract a bullet outline of all claims and structure from the text "
        "(no full sentences). Output only the outline.\n\n---\n{TEXT}"
    ),
    "structural_write": (
        "Write a complete document from this outline in natural, varied human prose. "
        "Avoid formulaic transitions. Do not omit any bullet. Output only the document."
        "\n\n---\n{TEXT}"
    ),
}


def _tokens(text: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9]+", text.lower())


def _bigrams(tokens: list[str]) -> set[tuple[str, str]]:
    return set(zip(tokens, tokens[1:]))


def _lexical_divergence(original: str, candidate: str) -> float:
    """Bigram Jaccard distance: 0.0 identical, 1.0 fully different."""
    a = _tokens(original)
    b = _tokens(candidate)
    if not a and not b:
        return 0.0
    if not a or not b:
        return 1.0
    ba = _bigrams(a)
    bb = _bigrams(b)
    union = ba | bb
    if not union:
        return 0.0
    return 1.0 - len(ba & bb) / len(union)


def _select_candidate(original: str, candidates: list[str]) -> tuple[str, list[float]]:
    """Pick the most lexically diverged rewrite, gently guarding extreme length drift."""
    scores: list[float] = []
    for cand in candidates:
        score = _lexical_divergence(original, cand)
        if original:
            ratio = len(cand) / len(original)
            if ratio > 2.0 or ratio < 0.5:
                score -= 0.15
        scores.append(score)
    best_idx = max(range(len(candidates)), key=lambda i: scores[i])
    return candidates[best_idx], scores


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    if v is None or v == "":
        return default
    return v


def _flag_env(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def _check_remote(base_url: str, allow_remote: bool) -> None:
    """Enforce the rewrite-endpoint allowlist.

    Default-deny: only loopback endpoints are accepted. Anything else requires
    an explicit opt-in (--allow-remote / WATERMARKS_REWRITE_ALLOW_REMOTE=1),
    and non-http(s) schemes (e.g. file://) are always refused.
    """
    u = urlparse(base_url)
    if u.scheme not in ("http", "https"):
        raise SystemExit(
            f"error: rewrite base URL must be http(s), got scheme '{u.scheme}': {base_url}"
        )
    host = u.hostname or ""
    if host in _LOOPBACK_HOSTS:
        return
    if not allow_remote:
        raise SystemExit(
            "error: rewrite base URL host is not loopback "
            f"('{host}'); refusing to send content off-machine. "
            "Set WATERMARKS_REWRITE_ALLOW_REMOTE=1 or pass --allow-remote to override."
        )
    eprint(
        f"warning: rewrite base URL host is '{host}' (not localhost); "
        "content will leave this machine"
    )


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Refuse HTTP redirects.

    urllib's default handler re-sends the request headers on 301/302/303,
    which would forward the Authorization header (API key) to an unvalidated
    host behind the localhost allowlist. Any 3xx now surfaces as HTTPError.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: N802
        raise urllib.error.HTTPError(req.full_url, code, msg, headers, fp)


SCRIPTS_DIR = Path(__file__).resolve().parent


def _venv_python(upstream: Path) -> Path | None:
    """Locate the MarkLLM checkout's venv interpreter, if it exists."""
    if os.name == "nt":
        candidate = upstream / ".venv" / "Scripts" / "python.exe"
    else:
        candidate = upstream / ".venv" / "bin" / "python"
    return candidate if candidate.is_file() else None


def _markllm_preexec() -> Callable[[], None] | None:
    """Optional RLIMIT_AS guard for the MarkLLM child; None means "no limit".

    torch/CUDA usually needs large address spaces, so unlike the
    exiftool/c2patool/SynthID children (common.subprocess_rlimits) this is
    opt-in via WATERMARKS_MARKLLM_RLIMIT_AS (byte count, hex/octal allowed).
    POSIX only; on Windows preexec_fn must stay None.
    """
    raw = os.environ.get("WATERMARKS_MARKLLM_RLIMIT_AS")
    if not raw or os.name != "posix":
        return None
    try:
        limit = int(raw, 0)
    except ValueError:
        return None

    def _apply() -> None:
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))

    return _apply


def _markllm_detect(
    text: str,
    *,
    scheme: str,
    upstream_dir: str,
    model: str,
    timeout: float,
) -> dict:
    """Run the MarkLLM adapter on *text*; never fails the rewrite.

    Returns the adapter's JSON payload, or an ``available: False`` dict with
    an ``error`` string when the backend is unconfigured or broken. The Layer B
    rewrite proceeds regardless; MarkLLM verification is best-effort.
    """
    if not upstream_dir:
        return {"available": False, "error": "no MARKLLM_DIR set"}
    upstream = Path(upstream_dir).expanduser().resolve()
    if not upstream.is_dir() or not (upstream / "watermark").is_dir():
        return {"available": False, "error": f"MarkLLM checkout missing: {upstream}"}
    venv_python = _venv_python(upstream)
    if venv_python is None:
        return {"available": False, "error": f"MarkLLM venv missing: {upstream}"}

    cmd = [
        str(venv_python),
        str(SCRIPTS_DIR / "detect_text_watermark.py"),
        "detect",
        "-",
        "--scheme",
        scheme,
        "--upstream-dir",
        str(upstream),
        "--model",
        model,
        "--json",
    ]
    try:
        r = subprocess.run(
            cmd,
            input=text,
            capture_output=True,
            text=True,
            timeout=timeout,
            preexec_fn=_markllm_preexec(),
        )
    except (OSError, subprocess.SubprocessError, TimeoutError) as e:
        return {"available": False, "error": f"MarkLLM adapter error: {e}"}

    if r.returncode != 0:
        return {
            "available": False,
            "error": (r.stderr or "").strip() or f"adapter exited {r.returncode}",
        }
    try:
        return json.loads(r.stdout)
    except ValueError as e:
        return {"available": False, "error": f"adapter JSON parse error: {e}"}


def build_prompt(strength: str, text: str, *, lang: str, original_lang: str) -> str:
    if strength == "paraphrase":
        return PROMPTS["paraphrase"].format(TEXT=text)
    if strength == "humanize":
        return PROMPTS["humanize"].format(TEXT=text)
    if strength == "code":
        return PROMPTS["code"].format(TEXT=text)
    if strength == "backtranslate":
        # single combined instruction for print-prompt / one-shot backends
        return (
            f"Translate the text to {lang}, then translate that result back to "
            f"{original_lang}. Preserve all facts, numbers, and names. "
            f"Output only the final {original_lang} text.\n\n---\n{text}"
        )
    if strength == "structural":
        return (
            "First extract a bullet outline of all claims (no full sentences). "
            "Then write a complete document from that outline in natural, varied human "
            "prose without omitting any bullet. Output only the final document.\n\n---\n"
            f"{text}"
        )
    raise ValueError(f"unknown strength: {strength}")


def _http_json(url: str, payload: dict, headers: dict[str, str], timeout: float) -> dict:
    if urlparse(url).scheme not in ("http", "https"):
        raise ValueError(f"refusing non-http(s) rewrite endpoint: {url}")
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    opener = urllib.request.build_opener(_NoRedirect())
    with opener.open(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def call_ollama(
    base_url: str, model: str, prompt: str, timeout: float, temperature: float
) -> str:
    url = base_url.rstrip("/") + "/api/chat"
    data = _http_json(
        url,
        {
            "model": model,
            "stream": False,
            "messages": [{"role": "user", "content": prompt}],
            "options": {"temperature": temperature},
        },
        {},
        timeout,
    )
    msg = data.get("message") or {}
    content = msg.get("content")
    if not content:
        raise RuntimeError(f"ollama empty response: {data!r}"[:500])
    return str(content).strip()


def call_openai_compatible(
    base_url: str,
    model: str,
    prompt: str,
    api_key: str | None,
    timeout: float,
    temperature: float,
    reasoning_effort: str | None = None,
) -> str:
    url = base_url.rstrip("/") + "/v1/chat/completions"
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload: dict = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temperature,
    }
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    data = _http_json(
        url,
        payload,
        headers,
        timeout,
    )
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError(f"openai-compatible empty choices: {data!r}"[:500])
    content = (choices[0].get("message") or {}).get("content")
    if not content:
        raise RuntimeError(f"openai-compatible empty content: {data!r}"[:500])
    return str(content).strip()


def rewrite(
    text: str,
    *,
    backend: str,
    model: str | None,
    base_url: str | None,
    api_key: str | None,
    strength: str,
    lang: str,
    original_lang: str,
    timeout: float,
    layer_a_after: bool,
    temperature: float,
    candidates: int,
    allow_remote: bool = False,
    reasoning_effort: str | None = None,
    markllm_scheme: str | None = None,
    markllm_dir: str | None = None,
    markllm_model: str | None = None,
    markllm_timeout: float = 180.0,
) -> tuple[str, dict]:
    prompt = build_prompt(strength, text, lang=lang, original_lang=original_lang)
    info: dict = {
        "backend": backend,
        "strength": strength,
        "model": model,
        "base_url": base_url,
        "temperature": temperature,
        "prompt_chars": len(prompt),
        "input_chars": len(text),
    }
    if reasoning_effort:
        info["reasoning_effort"] = reasoning_effort

    markllm: dict | None = None
    if markllm_scheme:
        markllm = {
            "scheme": markllm_scheme,
            "before": _markllm_detect(
                text,
                scheme=markllm_scheme,
                upstream_dir=markllm_dir or "",
                model=markllm_model or DEFAULT_MARKLLM_MODEL,
                timeout=markllm_timeout,
            ),
        }
        if not markllm["before"]["available"]:
            eprint(f"markllm verification unavailable: {markllm['before']['error']}")
        info["markllm"] = markllm

    if backend == "print-prompt":
        info["mode"] = "print-prompt"
        if candidates > 1:
            eprint("note: --candidates ignored in print-prompt mode")
        return prompt, info

    if not model:
        raise SystemExit("error: --model required for ollama/openai-compatible backends")
    if not base_url:
        raise SystemExit("error: --base-url required for ollama/openai-compatible backends")

    _check_remote(base_url, allow_remote)

    n = max(1, candidates)
    outs: list[str] = []
    for _ in range(n):
        if backend == "ollama":
            outs.append(call_ollama(base_url, model, prompt, timeout, temperature))
        elif backend == "openai-compatible":
            outs.append(
                call_openai_compatible(
                    base_url, model, prompt, api_key, timeout, temperature, reasoning_effort
                )
            )
        else:
            raise SystemExit(f"unknown backend: {backend}")

    if len(outs) == 1:
        out = outs[0]
    else:
        info["candidates"] = n
        out, scores = _select_candidate(text, outs)
        info["candidate_scores"] = scores

    if layer_a_after:
        out, stats = clean_text(out)
        info["layer_a_after"] = stats

    info["output_chars"] = len(out)
    info["mode"] = "rewritten"
    info["note"] = (
        "Layer B is best-effort against statistical token-sampling watermarks; "
        "cannot certify removal against a vendor detector."
    )

    if markllm:
        after = _markllm_detect(
            out,
            scheme=markllm["scheme"],
            upstream_dir=markllm_dir or "",
            model=markllm_model or DEFAULT_MARKLLM_MODEL,
            timeout=markllm_timeout,
        )
        markllm["after"] = after
        before = markllm["before"]
        if before.get("available") and after.get("available"):
            markllm["cleared"] = bool(
                before.get("is_watermarked") and not after.get("is_watermarked")
            )
        markllm["note"] = (
            "MarkLLM detection is only valid against the SAME scheme config + "
            "keys used at generation; it does not certify a vendor detector."
        )

    return out, info


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("path", nargs="?", default="-", help="Input text file, or - for stdin")
    p.add_argument("-o", "--output", help="Output path (default: stdout or *.rewritten.*)")
    p.add_argument(
        "--backend",
        choices=("print-prompt", "ollama", "openai-compatible"),
        default=_env("WATERMARKS_REWRITE_BACKEND", "print-prompt"),
    )
    p.add_argument("--model", default=_env("WATERMARKS_REWRITE_MODEL"))
    p.add_argument(
        "--base-url",
        default=_env("WATERMARKS_REWRITE_BASE_URL", "http://127.0.0.1:11434"),
    )
    p.add_argument(
        "--allow-remote",
        action="store_true",
        default=None,
        help="Allow non-loopback rewrite endpoints (default: deny; "
        "WATERMARKS_REWRITE_ALLOW_REMOTE=1 has the same effect)",
    )
    p.add_argument(
        "--reasoning-effort",
        choices=("none", "low", "medium", "high", "off"),
        default=_env("WATERMARKS_REWRITE_REASONING_EFFORT", "none"),
        help="OpenAI-compatible reasoning_effort; 'none' skips chain-of-thought "
        "(reasoning models like deepseek-v4-flash otherwise burn minutes on a "
        "rewrite). 'off' omits the parameter entirely.",
    )
    # NOTE: no --api-key flag on purpose — keys on argv are visible in `ps`
    # and shell history. Set WATERMARKS_REWRITE_API_KEY instead.
    p.add_argument(
        "--strength",
        choices=("paraphrase", "backtranslate", "structural", "humanize", "code"),
        default="paraphrase",
    )
    p.add_argument("--lang", default="French", help="Pivot language for backtranslate")
    p.add_argument("--original-lang", default="English")
    p.add_argument("--timeout", type=float, default=120.0)
    p.add_argument(
        "--temperature",
        type=float,
        default=0.9,
        help="Sampling temperature for the rewrite backend",
    )
    p.add_argument(
        "--candidates",
        type=int,
        default=1,
        help="Number of rewrite candidates to generate and score",
    )
    p.add_argument(
        "--no-layer-a-after",
        action="store_true",
        help="Skip Layer A scrub on model output",
    )
    p.add_argument("--json-stats", action="store_true", help="Stats JSON on stderr")
    p.add_argument(
        "--markllm-scheme",
        choices=("kgw", "synthid", "synthid-text"),
        default=None,
        help="Optional: run MarkLLM before/after detection around the rewrite "
        "(scheme = kgw or synthid)",
    )
    p.add_argument(
        "--markllm-dir",
        default=_env("MARKLLM_DIR"),
        help="MarkLLM checkout root (default: $MARKLLM_DIR)",
    )
    p.add_argument(
        "--markllm-model",
        default=_env("MARKLLM_MODEL", DEFAULT_MARKLLM_MODEL),
        help=f"Scoring model for MarkLLM detection (default: $MARKLLM_MODEL or {DEFAULT_MARKLLM_MODEL})",
    )
    p.add_argument(
        "--markllm-timeout",
        type=float,
        default=float(_env("WATERMARKS_MARKLLM_TIMEOUT", "180.0")),
        help="Timeout per MarkLLM detection call (default: 180.0)",
    )
    p.add_argument(
        "--force-text",
        action="store_true",
        help="Rewrite even when the input looks like a binary container",
    )
    args = p.parse_args()

    text = read_text_input(args.path, allow_binary=args.force_text)
    allow_remote = (
        args.allow_remote
        if args.allow_remote is not None
        else _flag_env("WATERMARKS_REWRITE_ALLOW_REMOTE")
    )
    try:
        result, info = rewrite(
            text,
            backend=args.backend,
            model=args.model,
            base_url=args.base_url,
            api_key=_env("WATERMARKS_REWRITE_API_KEY"),
            strength=args.strength,
            lang=args.lang,
            original_lang=args.original_lang,
            timeout=args.timeout,
            layer_a_after=not args.no_layer_a_after,
            temperature=args.temperature,
            candidates=args.candidates,
            allow_remote=allow_remote,
            reasoning_effort=(
                None if args.reasoning_effort == "off" else args.reasoning_effort
            ),
            markllm_scheme=args.markllm_scheme,
            markllm_dir=args.markllm_dir,
            markllm_model=args.markllm_model,
            markllm_timeout=args.markllm_timeout,
        )
    except (urllib.error.URLError, TimeoutError, RuntimeError) as e:
        eprint(f"rewrite failed: {e}")
        return 1

    out = args.output
    if out is None and args.path not in (None, "-") and args.backend != "print-prompt":
        out = str(cleaned_path(Path(args.path), suffix=".rewritten"))
    elif out is None and args.backend == "print-prompt":
        out = "-"

    write_text_output(result, out)
    if args.json_stats:
        eprint(json.dumps(info, indent=2, ensure_ascii=False))
    else:
        eprint(
            f"backend={info['backend']} strength={info['strength']} "
            f"mode={info.get('mode')} chars {info['input_chars']}->{info.get('output_chars', len(result))}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
