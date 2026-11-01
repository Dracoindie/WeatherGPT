"""
Parser benchmark: accuracy per field and per language on tests/eval/queries.jsonl.

    backend/.venv/Scripts/python tests/eval/run_eval.py              # table + failures
    backend/.venv/Scripts/python tests/eval/run_eval.py --json out.json

Uses the deterministic parser (parse_query_fallback): the LLM path is
optional and not reproducible, so it is not what the benchmark measures.
location_name is compared case-insensitively; climate_period only on rows
that expect one.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "backend"))

from llm.query_parser import parse_query_fallback  # noqa: E402

FIELDS = ["intent", "location_name", "date_reference", "weather_parameter", "language", "climate_period"]
LANGS = ["en", "hi", "hinglish", "mr"]


def load(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def same(field: str, got, want) -> bool:
    if field == "location_name" and isinstance(got, str) and isinstance(want, str):
        return got.strip().lower() == want.strip().lower()
    return got == want


def evaluate(rows: list[dict]) -> dict:
    per_field = defaultdict(lambda: [0, 0])  # field -> [correct, total]
    per_lang = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    exact = [0, 0]
    exact_lang = defaultdict(lambda: [0, 0])
    failures = []
    for row in rows:
        got = parse_query_fallback(row["query"]).model_dump()
        ok_all = True
        wrong = {}
        for field, want in row["expected"].items():
            ok = same(field, got.get(field), want)
            for bucket in (per_field[field], per_lang[row["lang"]][field]):
                bucket[0] += ok
                bucket[1] += 1
            if not ok:
                ok_all = False
                wrong[field] = {"expected": want, "got": got.get(field)}
        exact[0] += ok_all
        exact[1] += 1
        exact_lang[row["lang"]][0] += ok_all
        exact_lang[row["lang"]][1] += 1
        if wrong:
            failures.append({"id": row["id"], "lang": row["lang"], "query": row["query"], "wrong": wrong})

    pct = lambda c, t: round(100 * c / t, 1) if t else None  # noqa: E731
    return {
        "queries": len(rows),
        "exact_match": pct(*exact),
        "fields": {f: pct(*per_field[f]) for f in FIELDS if per_field[f][1]},
        "by_language": {
            lang: {
                "queries": exact_lang[lang][1],
                "exact_match": pct(*exact_lang[lang]),
                **{f: pct(*per_lang[lang][f]) for f in FIELDS if per_lang[lang][f][1]},
            }
            for lang in LANGS
            if exact_lang[lang][1]
        },
        "failures": failures,
    }


def print_report(r: dict) -> None:
    print(f"queries: {r['queries']}   exact match (all fields): {r['exact_match']}%\n")
    cols = ["exact"] + [f for f in FIELDS]
    head = f"{'':10}" + "".join(f"{c[:12]:>14}" for c in cols)
    print(head)
    overall = {"exact": r["exact_match"], **r["fields"]}
    print(f"{'all':10}" + "".join(f"{(str(overall.get(c)) if overall.get(c) is not None else '-'):>14}" for c in cols))
    for lang, v in r["by_language"].items():
        row = {"exact": v["exact_match"], **v}
        print(f"{lang:10}" + "".join(f"{(str(row.get(c)) if row.get(c) is not None else '-'):>14}" for c in cols))
    print(f"\nfailures: {len(r['failures'])}")
    for f in r["failures"]:
        diffs = "; ".join(f"{k}: want {v['expected']!r} got {v['got']!r}" for k, v in f["wrong"].items())
        print(f"  #{f['id']:>3} [{f['lang']}] {f['query']}\n        {diffs}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--queries", default=os.path.join(HERE, "queries.jsonl"))
    ap.add_argument("--json", help="write the full report as JSON")
    ap.add_argument("--quiet", action="store_true", help="summary only")
    args = ap.parse_args()
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    report = evaluate(load(args.queries))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
    if args.quiet:
        report = {**report, "failures": report["failures"]}
        print(json.dumps({k: v for k, v in report.items() if k != "failures"}, indent=2))
    else:
        print_report(report)


if __name__ == "__main__":
    main()
