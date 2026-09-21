"""The primitive mapping — pure Python, no torch, no numpy, no I/O.

Everything in this module is the *semantics* of SSO contract §11.2: how three
NLI probabilities per hypothesis become a `choice`, a `score` or a `noul`. It is
deliberately separated from :mod:`openjev_engine.runtime` (which owns the model,
CUDA and Hugging Face) so that the part a wrong answer would come from can be
tested on any machine, with `python -m unittest`, in milliseconds and with no
GPU. `runtime` re-exports these, so importers may use either name.

The decode functions take *rows* of three probabilities in the checkpoint's own
label order — `[contradiction, entailment, neutral]` — and accept plain lists as
readily as numpy arrays.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

#: Label order, fixed by the checkpoint's `id2label` and by
#: `modeling_openjev.CON/ENT/NEU`. A refresh that reordered these would silently
#: invert every answer, which is why the vendored file's digest is pinned.
CON, ENT, NEU = 0, 1, 2
LABELS = ("contradiction", "entailment", "neutral")

VALID_TYPES = ("choice", "score", "noul")

#: How a `noul` probability is read off the three classes. Both are always
#: reported; this only picks which lands in the `noul` field.
NOUL_MODES = ("entailment", "ent_vs_contra")


class RequestError(Exception):
    """A caller error: HTTP 4xx with a machine-readable code."""

    def __init__(self, code: str, message: str, status: int = 400, **detail: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.detail = detail


# ── validation ───────────────────────────────────────────────────────────────


def validate_questions(questions: Dict[str, Any], max_questions: int, max_options: int) -> None:
    """Reject malformed question sets before any tokenisation happens."""
    if not isinstance(questions, dict) or not questions:
        raise RequestError("no_questions", "`questions` must be a non-empty object")
    if len(questions) > max_questions:
        raise RequestError(
            "too_many_questions",
            f"{len(questions)} questions exceeds the engine limit of {max_questions}",
            status=413,
        )
    for qid, qdef in questions.items():
        if not isinstance(qdef, dict):
            raise RequestError("bad_question", f"question {qid!r} must be an object", question=qid)
        qtype = qdef.get("type")
        if qtype not in VALID_TYPES:
            raise RequestError(
                "bad_question_type",
                f"question {qid!r} has type {qtype!r}; expected one of {VALID_TYPES}",
                question=qid,
            )
        if not qdef.get("instructions"):
            raise RequestError(
                "missing_instructions", f"question {qid!r} has no instructions", question=qid
            )
        crit = qdef.get("criteria")
        if qtype == "choice":
            if not isinstance(crit, (dict, list)) or len(crit) < 2:
                raise RequestError(
                    "bad_criteria",
                    f"choice question {qid!r} needs at least two options",
                    question=qid,
                )
            if len(crit) > max_options:
                raise RequestError(
                    "too_many_options",
                    f"choice question {qid!r} has {len(crit)} options, above the engine "
                    f"limit of {max_options}",
                    status=413,
                    question=qid,
                )
        elif qtype == "score":
            if not isinstance(crit, list) or len(crit) < 2:
                raise RequestError(
                    "bad_criteria",
                    f"score question {qid!r} needs a list of at least two levels",
                    question=qid,
                )


# ── rendering ────────────────────────────────────────────────────────────────


def serialize_state(state: Union[str, dict, list]) -> str:
    """Render a state to text: `key: value` per line, insertion order kept.

    Mirrors what the façade already does before it sends a string, so an
    operator poking the engine by hand gets the rendering the façade would have
    produced rather than a second dialect.
    """
    if isinstance(state, str):
        return state
    if isinstance(state, dict):
        return "\n".join(
            f"{key}: {serialize_state(value) if isinstance(value, (dict, list)) else value}"
            for key, value in state.items()
        )
    if isinstance(state, list):
        return "\n".join(
            serialize_state(item) if isinstance(item, (dict, list)) else str(item) for item in state
        )
    return str(state)


def render_choice_options(
    criteria: Union[dict, list], option_format: str
) -> Tuple[List[str], List[str]]:
    """`(keys, rendered)` for a choice question. Rubrics pass through WHOLE.

    No compression and no cap (§11.2): every option is scored in its own
    sequence, so there is no shared head budget for rubrics to compete over.
    Compressing here would throw away the only reason to run this engine.

    A `dict` is `key -> rubric`; a `list` is bare keys, and then the rendered
    option is the key alone rather than `"key: "` with an empty tail, which an
    NLI head would read as a truncated sentence.
    """
    keys: List[str] = []
    rendered: List[str] = []
    if isinstance(criteria, dict):
        for key, rubric in criteria.items():
            keys.append(str(key))
            text = "" if rubric is None else str(rubric).strip()
            rendered.append(option_format.format(key=key, rubric=text) if text else str(key))
    else:
        for key in criteria:
            keys.append(str(key))
            rendered.append(str(key))
    return keys, rendered


# ── numbers ──────────────────────────────────────────────────────────────────


def confidence_from_probs(probabilities: Sequence[float]) -> float:
    """Normalised-entropy confidence: 1 at one-hot, 0 at uniform.

    Deliberately the same *shape* of number laya reports, so a consumer
    comparing the two engines compares like with like. It is NOT calibrated and
    the façade must not gate on it (ADR-2090).

    >>> round(confidence_from_probs([0.5, 0.5]), 6)
    0.0
    >>> round(confidence_from_probs([1.0, 0.0]), 6)
    1.0
    """
    k = len(probabilities)
    if k < 2:
        return 1.0
    entropy = 0.0
    for value in probabilities:
        p = min(1.0, max(1e-12, float(value)))
        entropy -= p * math.log(p)
    return max(0.0, min(1.0, 1.0 - entropy / math.log(k)))


def normalise(values: Sequence[float]) -> List[float]:
    """Normalise non-negative values to sum 1; a zero vector becomes uniform."""
    floats = [max(0.0, float(v)) for v in values]
    total = sum(floats)
    if total <= 0.0:
        return [1.0 / len(floats)] * len(floats) if floats else []
    return [v / total for v in floats]


def shared_prefix(sequences: Sequence[Sequence[int]]) -> int:
    """Length of the common token prefix, by the vendored helper's own rule.

    Reproduces `modeling_openjev._pooled_hypotheses`: fewer than three
    hypotheses take the plain pairwise path with no sharing, and the prefix is
    clipped one token short of the shortest sequence so every branch keeps at
    least one suffix token. This exists only so `usage.input_tokens` is what the
    engine really consumed rather than the naive sum of whole sequences.
    """
    if len(sequences) < 3:
        return 0
    common = 0
    for column in zip(*sequences):
        if len(set(column)) != 1:
            break
        common += 1
    common = min(common, min(len(s) for s in sequences) - 1)
    return max(0, common)


def premise_budget(
    max_len: int, wrapper_tokens: int, longest_hypothesis: int, head_tokens: int, tail_tokens: int, margin: int
) -> int:
    """Tokens left for the state once everything that must survive is paid for.

    The hypothesis is never truncated and the instructions are never truncated;
    only the state is. The vendored encoder truncates from the RIGHT at
    `max_len`, which on a long premise deletes the hypothesis and leaves the
    head judging a fragment — a confident wrong answer, and the failure this
    arithmetic exists to prevent.
    """
    return max_len - (wrapper_tokens + longest_hypothesis + head_tokens + tail_tokens + margin)


# ── decoding: the §11.2 primitive mapping ────────────────────────────────────


def decode_choice(keys: Sequence[str], rows: Sequence[Sequence[float]]) -> Dict[str, Any]:
    """Choice: probabilities are entailment scores normalised across options.

    `probabilities` is the ranked distribution the consumers read. **`scores` is
    the absolute scale**: the raw, un-normalised `P(entailment)` per option,
    straight out of the NLI head, one entry per option key. The façade's decline
    threshold compares against THAT, because an option's score must not depend
    on how many rivals it had — which is the entire architectural claim of this
    engine. A normalised distribution cannot express "nothing here fits": it
    sums to one however bad every option is.

    **`scores` is the ONLY name it is emitted under.** The façade declares
    `scores` canonical and accepts `entailment` / `raw_scores` as serde
    *aliases* — and an alias means "accept this spelling INSTEAD of the
    canonical one", not "both may appear". Emitting both made serde see one
    logical field twice and reject the whole document
    (`duplicate field 'scores'`), failing every request. Identical values do not
    help: the ambiguity is structural, and a strict reader is right to refuse
    it. Aliases exist so a READER can accept several writers, not so a writer
    can emit every spelling at once.

    Deciding the threshold here would in any case use the wrong denominator —
    the façade, not the engine, holds the caller's original option set.
    """
    ent = [float(row[ENT]) for row in rows]
    con = [float(row[CON]) for row in rows]
    probabilities = normalise(ent)
    best = max(range(len(ent)), key=ent.__getitem__)
    return {
        "type": "choice",
        "choice": keys[best],
        "probabilities": {k: round(v, 6) for k, v in zip(keys, probabilities)},
        "confidence": round(confidence_from_probs(probabilities), 4),
        # The absolute scale. One key, one spelling.
        "scores": {k: round(v, 6) for k, v in zip(keys, ent)},
        "entailment_max": round(ent[best], 6),
        "contradiction": {k: round(v, 6) for k, v in zip(keys, con)},
    }


def decode_score(levels: Sequence[str], rows: Sequence[Sequence[float]]) -> Dict[str, Any]:
    """Score: expected value over the normalised entailment distribution.

    The scale is the level INDEX, low to high, exactly as laya reports it, so a
    consumer that already reads `score` against `legend` needs no change.
    """
    ent = [float(row[ENT]) for row in rows]
    probabilities = normalise(ent)
    best = max(range(len(ent)), key=ent.__getitem__)
    return {
        "type": "score",
        "score": round(sum(i * p for i, p in enumerate(probabilities)), 4),
        "legend": {str(i): level for i, level in enumerate(levels)},
        "probabilities": {str(i): round(p, 6) for i, p in enumerate(probabilities)},
        "distribution": [round(p, 6) for p in probabilities],
        "confidence": round(confidence_from_probs(probabilities), 4),
        # Same absolute scale as a choice, same single key — one dialect across
        # the primitives, even though nothing thresholds a score today.
        "scores": {k: round(v, 6) for k, v in zip(levels, ent)},
        "entailment_max": round(ent[best], 6),
    }


def decode_noul(row: Sequence[float], mode: str) -> Dict[str, Any]:
    """Noul: `P(ent)`, or `P(ent) / (P(ent) + P(con))` when neutral mass is excluded.

    Neutral mass is a real confound — a state that simply does not mention the
    statement lands in `neutral`, dragging `P(ent)` down in a way that looks
    like disagreement. Which reading is better is a MEASUREMENT (§11.2), so both
    are always reported and `mode` only decides which one is called `noul`.
    """
    e, c, n = float(row[ENT]), float(row[CON]), float(row[NEU])
    denom = e + c
    by_contrast = (e / denom) if denom > 0 else 0.5
    value = e if mode == "entailment" else by_contrast
    return {
        "type": "noul",
        "noul": round(value, 4),
        "confidence": round(max(value, 1.0 - value), 4),
        "noul_entailment": round(e, 4),
        "noul_ent_vs_contra": round(by_contrast, 4),
        "noul_mode": mode,
        "contradiction": round(c, 4),
        "neutral": round(n, 4),
    }


def decode(
    qtype: str, keys: Sequence[str], rows: Sequence[Sequence[float]], mode: str
) -> Dict[str, Any]:
    """Dispatch to the right decoder for a question type."""
    if qtype == "choice":
        return decode_choice(keys, rows)
    if qtype == "score":
        return decode_score(keys, rows)
    return decode_noul(rows[0], mode)


def resolve_noul_mode(requested: Optional[str], default: str) -> str:
    """Validate a per-request noul mode, falling back to the deployment default."""
    mode = (requested or default or NOUL_MODES[0]).strip().lower()
    if mode not in NOUL_MODES:
        raise RequestError("bad_noul_mode", f"noul_mode {mode!r} is not one of {NOUL_MODES}")
    return mode
