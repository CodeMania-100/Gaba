from __future__ import annotations

import argparse
import json
from pathlib import Path

from pricing_core import run_sold_qa


def main() -> None:
    parser = argparse.ArgumentParser(description="Run deterministic QA on sold-transaction JSON.")
    parser.add_argument("input", type=Path)
    parser.add_argument("--out-dir", type=Path, default=Path("qa_output"))
    args = parser.parse_args()

    raw = json.loads(args.input.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise SystemExit("Expected a JSON array of sold transactions")

    output = run_sold_qa(raw)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    primary = [r.as_dict() for r in output.records if r.status.value == "usable"]
    review = [
        r.as_dict()
        for r in output.records
        if r.status.value in {"low_confidence", "ambiguous"}
    ]
    rejected = [r.as_dict() for r in output.records if r.status.value == "rejected"]

    _write(args.out_dir / "sold_primary_usable.json", primary)
    _write(args.out_dir / "sold_review.json", review)
    _write(args.out_dir / "sold_rejected.json", rejected)
    _write(args.out_dir / "sold_qa_summary.json", output.summary)

    print(json.dumps(output.summary, ensure_ascii=False, indent=2))


def _write(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
