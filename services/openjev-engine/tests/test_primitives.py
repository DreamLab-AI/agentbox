"""Unit tests for the primitive mapping and the configuration surface.

Stdlib only — `unittest`, no pytest, no numpy, no torch — so they run in the
agentbox container as readily as in the CUDA image:

    python -m unittest discover -s services/openjev-engine/tests -v

That is a deliberate constraint, not an accident: the module under test is the
part where a wrong answer would come from (which class index is entailment, what
`none` needs in order to be decidable, whether a rubric survives whole), and a
test that needs a GPU to run is a test that does not run.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from openjev_engine.config import (  # noqa: E402
    DEFAULT_MODELS,
    PINNED_REVISION,
    VENDORED_MODELING_SHA256,
    ModelSpec,
    Settings,
    parse_models,
)
from openjev_engine.primitives import (  # noqa: E402
    CON,
    ENT,
    NEU,
    RequestError,
    confidence_from_probs,
    decode,
    decode_choice,
    decode_noul,
    decode_score,
    normalise,
    premise_budget,
    render_choice_options,
    resolve_noul_mode,
    serialize_state,
    shared_prefix,
    validate_questions,
)


class VendorPin(unittest.TestCase):
    """The supply-chain control, tested rather than asserted in prose."""

    def test_vendored_helper_matches_the_pinned_digest(self):
        path = ROOT / "vendor" / "modeling_openjev.py"
        self.assertTrue(path.is_file(), f"vendored helper missing at {path}")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        self.assertEqual(
            digest,
            VENDORED_MODELING_SHA256,
            "vendored modeling_openjev.py changed without updating "
            "VENDORED_MODELING_SHA256 — see vendor/PROVENANCE.md",
        )

    def test_label_order_is_the_checkpoints_own(self):
        # config.json id2label: 0 contradiction, 1 entailment, 2 neutral.
        # Getting this wrong inverts every answer silently.
        self.assertEqual((CON, ENT, NEU), (0, 1, 2))

    def test_the_default_model_spec_is_pinned_to_a_commit(self):
        (spec,) = parse_models(DEFAULT_MODELS)
        self.assertEqual(spec.repo, "AlexWortega/openjev")
        self.assertEqual(spec.subfolder, "qwen3.5-4b-nli-v2")
        self.assertEqual(spec.revision, PINNED_REVISION)
        self.assertEqual(len(spec.revision), 40, "a revision must be a full commit SHA")


class ModelSpecParsing(unittest.TestCase):
    def test_named_pairs_with_subfolder_and_revision(self):
        specs = parse_models("a=org/repo:sub@abc123,b=org/other")
        self.assertEqual(
            specs,
            [ModelSpec("a", "org/repo", "sub", "abc123"), ModelSpec("b", "org/other", None, None)],
        )
        self.assertEqual(specs[0].source, "org/repo:sub@abc123")

    def test_a_bare_source_names_itself_after_the_subfolder(self):
        self.assertEqual(
            parse_models("AlexWortega/openjev:qwen3.5-4b-nli-v2@deadbeef"),
            [ModelSpec("qwen3.5-4b-nli-v2", "AlexWortega/openjev", "qwen3.5-4b-nli-v2", "deadbeef")],
        )

    def test_local_paths_survive_and_report_themselves_as_local(self):
        (spec,) = parse_models("/models/openjev")
        self.assertEqual(spec, ModelSpec("openjev", "/models/openjev", None, None))
        self.assertTrue(spec.is_local)

    def test_blank_entries_are_dropped(self):
        self.assertEqual(parse_models(" , ,"), [])


class SettingsDefaults(unittest.TestCase):
    def setUp(self):
        self._saved = {k: v for k, v in os.environ.items() if k.startswith("OPENJEV_")}
        for key in self._saved:
            del os.environ[key]

    def tearDown(self):
        for key in [k for k in os.environ if k.startswith("OPENJEV_")]:
            del os.environ[key]
        os.environ.update(self._saved)

    def test_the_bind_is_loopback_and_the_port_is_not_layas(self):
        s = Settings.from_env()
        # The contract's one non-negotiable default: the engine is not an
        # ingress. 8099, because 8098 is laya and both may run at once in a
        # shared network namespace.
        self.assertEqual((s.bind_host, s.bind_port), ("127.0.0.1", 8099))

    def test_unpinned_models_are_refused_by_default(self):
        self.assertFalse(Settings.from_env().allow_unpinned)

    def test_noul_mode_defaults_to_plain_entailment_and_rejects_nonsense(self):
        self.assertEqual(Settings.from_env().noul_mode, "entailment")
        os.environ["OPENJEV_NOUL_MODE"] = "ent_vs_contra"
        self.assertEqual(Settings.from_env().noul_mode, "ent_vs_contra")
        os.environ["OPENJEV_NOUL_MODE"] = "vibes"
        self.assertEqual(Settings.from_env().noul_mode, "entailment")

    def test_invalid_or_zero_numeric_overrides_are_ignored(self):
        os.environ["OPENJEV_MAX_LEN"] = "0"
        os.environ["OPENJEV_HYP_CHUNK"] = "not-a-number"
        s = Settings.from_env()
        self.assertIsNone(s.max_len_override)
        self.assertEqual(s.hypothesis_chunk, 32)


class OptionRendering(unittest.TestCase):
    def test_rubrics_are_passed_through_whole(self):
        rubric = "x" * 4000
        keys, rendered = render_choice_options({"skill": rubric}, "{key}: {rubric}")
        self.assertEqual(keys, ["skill"])
        # §11.2: NOT compressed, NOT capped. laya would have amputated this at
        # 48 tokens; the whole point of this engine is that nothing here does.
        self.assertEqual(rendered[0], f"skill: {rubric}")
        self.assertIn(rubric, rendered[0])

    def test_a_rubricless_option_renders_as_the_bare_key(self):
        _, rendered = render_choice_options({"none": ""}, "{key}: {rubric}")
        self.assertEqual(rendered, ["none"])
        _, from_list = render_choice_options(["a", "b"], "{key}: {rubric}")
        self.assertEqual(from_list, ["a", "b"])

    def test_key_order_is_preserved(self):
        keys, _ = render_choice_options({"z": "1", "a": "2", "m": "3"}, "{key}: {rubric}")
        self.assertEqual(keys, ["z", "a", "m"])


class StateRendering(unittest.TestCase):
    def test_objects_render_as_stable_key_value_lines(self):
        self.assertEqual(
            serialize_state({"user_request": "hello", "cwd": "/tmp"}),
            "user_request: hello\ncwd: /tmp",
        )

    def test_strings_pass_through_and_lists_join(self):
        self.assertEqual(serialize_state("plain"), "plain")
        self.assertEqual(serialize_state(["a", {"b": 1}]), "a\nb: 1")


class Numbers(unittest.TestCase):
    def test_confidence_is_one_at_one_hot_and_zero_at_uniform(self):
        self.assertAlmostEqual(confidence_from_probs([1.0, 0.0]), 1.0, places=6)
        self.assertAlmostEqual(confidence_from_probs([0.5, 0.5]), 0.0, places=6)
        self.assertAlmostEqual(confidence_from_probs([0.25] * 4), 0.0, places=6)
        self.assertEqual(confidence_from_probs([0.7]), 1.0)

    def test_normalise_handles_an_all_zero_vector(self):
        self.assertEqual(normalise([0.0, 0.0, 0.0]), [1 / 3, 1 / 3, 1 / 3])
        self.assertEqual(normalise([1.0, 3.0]), [0.25, 0.75])

    def test_shared_prefix_follows_the_vendored_rule(self):
        # Fewer than three hypotheses take the pairwise path: no sharing.
        self.assertEqual(shared_prefix([[1, 2, 3], [1, 2, 4]]), 0)
        # Three or more: the common prefix, clipped one short of the shortest.
        self.assertEqual(shared_prefix([[1, 2, 3, 9], [1, 2, 3, 8], [1, 2, 3, 7]]), 3)
        self.assertEqual(shared_prefix([[1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 5]]), 2)
        self.assertEqual(shared_prefix([[1, 2], [9, 2], [8, 2]]), 0)

    def test_premise_budget_pays_for_everything_that_must_survive(self):
        self.assertEqual(premise_budget(4096, 10, 100, 20, 0, 8), 3958)
        # A hypothesis longer than the whole sequence yields a negative budget,
        # which the caller turns into a 422 rather than a truncated hypothesis.
        self.assertLess(premise_budget(512, 10, 600, 0, 0, 8), 0)


class Decoding(unittest.TestCase):
    """The §11.2 mapping. Rows are [contradiction, entailment, neutral]."""

    def test_choice_ranks_by_entailment_and_normalises_across_options(self):
        answer = decode_choice(
            ["alpha", "beta", "gamma"],
            [[0.10, 0.60, 0.30], [0.50, 0.20, 0.30], [0.80, 0.10, 0.10]],
        )
        self.assertEqual(answer["choice"], "alpha")
        self.assertAlmostEqual(sum(answer["probabilities"].values()), 1.0, places=6)
        self.assertEqual(set(answer["probabilities"]), {"alpha", "beta", "gamma"})
        self.assertAlmostEqual(answer["probabilities"]["alpha"], 0.6 / 0.9, places=6)

    def test_choice_reports_an_absolute_scale_so_the_facade_can_threshold_none(self):
        # Every option is a bad fit. Normalised probabilities cannot say so —
        # they sum to one regardless — so §11.3's threshold needs the RAW
        # per-option entailment, and `scores` is the field that carries it.
        answer = decode_choice(
            ["a", "b"], [[0.60, 0.05, 0.35], [0.70, 0.04, 0.26]]
        )
        self.assertAlmostEqual(answer["probabilities"]["a"], 0.05 / 0.09, places=6)
        self.assertAlmostEqual(answer["scores"]["a"], 0.05, places=6)
        self.assertAlmostEqual(answer["entailment_max"], 0.05, places=6)
        self.assertLess(answer["entailment_max"], 0.5)  # a façade default would decline
        self.assertAlmostEqual(answer["contradiction"]["b"], 0.70, places=6)

    def test_the_absolute_scale_is_independent_of_how_many_rivals_an_option_had(self):
        # The architectural claim, as a test: adding rivals must not move an
        # option's own score. `probabilities` moves (it is a share);
        # `scores` must not (it is the judgement).
        two = decode_choice(["a", "b"], [[0.1, 0.62, 0.28], [0.5, 0.20, 0.30]])
        many = decode_choice(
            ["a", "b", "c", "d"],
            [[0.1, 0.62, 0.28], [0.5, 0.20, 0.30], [0.4, 0.30, 0.30], [0.3, 0.40, 0.30]],
        )
        self.assertEqual(two["scores"]["a"], many["scores"]["a"])
        self.assertNotEqual(two["probabilities"]["a"], many["probabilities"]["a"])

    def test_the_absolute_scale_is_emitted_under_exactly_one_name(self):
        """The wire-shape assertion, not a value assertion.

        The façade declares `scores` canonical and accepts `entailment` /
        `raw_scores` as serde ALIASES. An alias means "accept this spelling
        INSTEAD of the canonical one"; it does not license a writer to emit
        both. Emitting `scores` and `entailment` together made serde see one
        logical field twice and reject the entire document — `duplicate field
        'scores'` — failing every request, with identical values offering no
        protection at all, because the ambiguity is structural.

        The earlier test asserted `scores == entailment`, which is exactly what
        made shipping both feel safe. THIS is the missing assertion: it is about
        the document, not the numbers.
        """
        aliases = ("entailment", "raw_scores")
        answers = [
            decode_choice(["a", "b"], [[0.1, 0.7, 0.2], [0.5, 0.3, 0.2]]),
            decode_score(["low", "high"], [[0.1, 0.7, 0.2], [0.5, 0.3, 0.2]]),
            decode_noul([0.2, 0.6, 0.2], "entailment"),
        ]
        for answer in answers:
            kind = answer["type"]
            if kind == "noul":
                # A noul has no per-option map at all; it must not grow one.
                self.assertNotIn("scores", answer, kind)
            else:
                self.assertIn("scores", answer, kind)
                self.assertEqual(list(answer["scores"]), ["a", "b"] if kind == "choice" else ["low", "high"])
            for alias in aliases:
                self.assertNotIn(
                    alias,
                    answer,
                    f"{kind} answer emits both `scores` and the alias `{alias}`; "
                    "serde rejects the document as a duplicate field",
                )

    def test_a_serialised_answer_survives_a_strict_duplicate_rejecting_parser(self):
        """Round-trip the real JSON through a parser that refuses duplicates.

        `json.loads` silently keeps the last of two identical keys, which is
        precisely why a Python-side check on the dict could not have caught the
        façade's serde failure. `object_pairs_hook` sees the raw pair list, so
        this fails the way the Rust reader does.
        """

        def no_duplicates(pairs):
            seen = [k for k, _ in pairs]
            duplicates = {k for k in seen if seen.count(k) > 1}
            if duplicates:
                raise ValueError(f"duplicate field(s) {sorted(duplicates)}")
            return dict(pairs)

        payload = {
            "answers": {
                "route": decode_choice(["a", "b"], [[0.1, 0.7, 0.2], [0.5, 0.3, 0.2]]),
                "urgency": decode_score(["low", "high"], [[0.1, 0.7, 0.2], [0.5, 0.3, 0.2]]),
                "tools": decode_noul([0.2, 0.6, 0.2], "entailment"),
            }
        }
        parsed = json.loads(json.dumps(payload), object_pairs_hook=no_duplicates)
        self.assertEqual(parsed["answers"]["route"]["choice"], "a")

    def test_choice_probabilities_cover_every_key_it_was_given(self):
        keys = [f"skill-{i}" for i in range(116)]
        rows = [[0.3, 0.01 * (i % 7), 0.3] for i in range(116)]
        answer = decode_choice(keys, rows)
        self.assertEqual(list(answer["probabilities"]), keys)
        self.assertEqual(list(answer["scores"]), keys)
        self.assertIn(answer["choice"], keys)

    def test_score_is_the_expected_value_over_normalised_entailment(self):
        answer = decode_score(
            ["low", "mid", "high"],
            [[0.4, 0.10, 0.5], [0.2, 0.30, 0.5], [0.1, 0.60, 0.3]],
        )
        # 0*0.1 + 1*0.3 + 2*0.6 = 1.5
        self.assertAlmostEqual(answer["score"], 1.5, places=4)
        self.assertEqual(answer["legend"], {"0": "low", "1": "mid", "2": "high"})
        self.assertEqual(len(answer["distribution"]), 3)
        self.assertAlmostEqual(sum(answer["distribution"]), 1.0, places=6)
        # One dialect across the primitives: a score carries the same absolute
        # scale as a choice, even though nothing thresholds it today.
        self.assertAlmostEqual(answer["scores"]["high"], 0.60, places=6)

    def test_noul_reports_both_readings_whichever_is_selected(self):
        row = [0.20, 0.60, 0.20]  # con, ent, neu
        plain = decode_noul(row, "entailment")
        contrast = decode_noul(row, "ent_vs_contra")
        self.assertAlmostEqual(plain["noul"], 0.60, places=4)
        self.assertAlmostEqual(contrast["noul"], 0.75, places=4)  # 0.6 / (0.6 + 0.2)
        for answer in (plain, contrast):
            self.assertAlmostEqual(answer["noul_entailment"], 0.60, places=4)
            self.assertAlmostEqual(answer["noul_ent_vs_contra"], 0.75, places=4)

    def test_noul_with_no_mass_on_either_pole_is_an_honest_half(self):
        answer = decode_noul([0.0, 0.0, 1.0], "ent_vs_contra")
        self.assertEqual(answer["noul"], 0.5)

    def test_dispatch_matches_the_direct_decoders(self):
        rows = [[0.1, 0.7, 0.2], [0.5, 0.3, 0.2]]
        self.assertEqual(decode("choice", ["a", "b"], rows, "entailment"), decode_choice(["a", "b"], rows))
        self.assertEqual(decode("score", ["a", "b"], rows, "entailment"), decode_score(["a", "b"], rows))
        self.assertEqual(decode("noul", [], rows, "entailment"), decode_noul(rows[0], "entailment"))

    def test_resolve_noul_mode_rejects_an_unknown_mode_loudly(self):
        self.assertEqual(resolve_noul_mode(None, "ent_vs_contra"), "ent_vs_contra")
        self.assertEqual(resolve_noul_mode("ENTAILMENT", "ent_vs_contra"), "entailment")
        with self.assertRaises(RequestError) as caught:
            resolve_noul_mode("vibes", "entailment")
        self.assertEqual(caught.exception.code, "bad_noul_mode")


class Validation(unittest.TestCase):
    def _err(self, questions, max_questions=64, max_options=512):
        with self.assertRaises(RequestError) as caught:
            validate_questions(questions, max_questions, max_options)
        return caught.exception

    def test_a_well_formed_set_passes(self):
        validate_questions(
            {
                "route": {"type": "choice", "instructions": "pick", "criteria": {"a": "1", "b": "2"}},
                "urgency": {"type": "score", "instructions": "rate", "criteria": ["low", "high"]},
                "tools": {"type": "noul", "instructions": "tools were used"},
            },
            64,
            512,
        )

    def test_empty_bad_type_and_missing_instructions_are_named(self):
        self.assertEqual(self._err({}).code, "no_questions")
        self.assertEqual(self._err({"q": {"type": "vibe", "instructions": "x"}}).code, "bad_question_type")
        self.assertEqual(self._err({"q": {"type": "noul"}}).code, "missing_instructions")

    def test_a_one_option_choice_is_not_a_choice(self):
        err = self._err({"q": {"type": "choice", "instructions": "x", "criteria": {"a": "1"}}})
        self.assertEqual(err.code, "bad_criteria")

    def test_limits_return_413_with_the_real_numbers(self):
        many = {f"q{i}": {"type": "noul", "instructions": "x"} for i in range(5)}
        err = self._err(many, max_questions=4)
        self.assertEqual((err.code, err.status), ("too_many_questions", 413))
        wide = {"q": {"type": "choice", "instructions": "x", "criteria": {str(i): "r" for i in range(20)}}}
        err = self._err(wide, max_options=8)
        self.assertEqual((err.code, err.status), ("too_many_options", 413))
        self.assertEqual(err.detail["question"], "q")


if __name__ == "__main__":
    unittest.main()
