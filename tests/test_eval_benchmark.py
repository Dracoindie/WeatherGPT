"""Regression guard for the parser benchmark (tests/eval). See tests/eval/run_eval.py."""

import importlib.util
import os

HERE = os.path.dirname(__file__)
_spec = importlib.util.spec_from_file_location("run_eval", os.path.join(HERE, "eval", "run_eval.py"))
run_eval = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(run_eval)


def test_benchmark_has_120_queries_across_four_languages():
    rows = run_eval.load(os.path.join(HERE, "eval", "queries.jsonl"))
    assert len(rows) == 120
    assert {r["lang"] for r in rows} == {"en", "hi", "hinglish", "mr"}
    assert {r["expected"]["intent"] for r in rows} == {"current_weather", "forecast", "climate", "nwp"}


def test_parser_accuracy_does_not_regress():
    main = run_eval.evaluate(run_eval.load(os.path.join(HERE, "eval", "queries.jsonl")))
    held = run_eval.evaluate(run_eval.load(os.path.join(HERE, "eval", "heldout.jsonl")))
    assert main["exact_match"] >= 98.0, main["failures"]
    assert held["exact_match"] >= 90.0, held["failures"]
    for lang, v in main["by_language"].items():
        assert v["exact_match"] >= 95.0, (lang, v)
