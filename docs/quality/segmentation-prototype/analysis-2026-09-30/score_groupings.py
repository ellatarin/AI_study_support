"""Score grouping runs on a live division against the user's topic rulings, carried by where each border falls.

Usage (from anywhere): python3 score_groupings.py <lecture> <version>...
  A version written "g23+nolabels" names the untitled variant.
  --model-tag sets the model part of the run names ("@gpt-6.1-sol-pro" by default; "" for Flash),
  --source the division stem ("chosen-live18-rt9" by default), --runs the panel size (4 by default).
"""

import argparse
import json
from pathlib import Path

RUNS = Path(__file__).resolve().parent.parent / "runs"

# The same cut site can sit a sentence or two apart between divisions: nearest ruled border within 1%.
SAME_SITE_PERCENT = 1.0


def read(name: str) -> dict:
    return json.loads((RUNS / name).read_text())


def start_positions(blocks: list[dict]) -> list[float]:
    """Where each subtopic starts, as a percentage of the transcript."""
    total = sum(len(b["content"]) for b in blocks)
    out, so_far = [], 0
    for block in blocks:
        out.append(100 * so_far / total)
        so_far += len(block["content"])
    return out


def border_rules(lecture: str) -> dict:
    """Each live border's ruling (start, not, either or unruled), and whether the lecture is ruled at all."""
    rulings = read("topic-rulings.json").get(lecture)
    live = read(f"chosen-live18-rt9-{lecture}.blocks.json")["blocks"]
    live_pos = start_positions(live)
    rules = {}
    ruled_pos = start_positions(read(f"{rulings['division']}.blocks.json")["blocks"]) if rulings else []
    for sid in range(2, len(live) + 1):
        if not rulings:
            rules[sid] = "unruled"
            continue
        gaps = [abs(p - live_pos[sid - 1]) for p in ruled_pos]
        nearest = gaps.index(min(gaps))
        ruled_id = nearest + 1 if gaps[nearest] < SAME_SITE_PERCENT else 0
        if ruled_id == 0:
            rules[sid] = "unruled"
        elif ruled_id in rulings["either"]:
            rules[sid] = "either"
        else:
            rules[sid] = "start" if ruled_id in rulings["topicStarts"] else "not"
    return {"ruled": rulings is not None, "rules": rules}


def run_starts(*, version: str, lecture: str, model_tag: str, source: str, runs: int) -> list[list[int] | None]:
    """Each run's topic starts, or None for a run that is missing."""
    base, _, variant = version.partition("+")
    out = []
    for n in range(1, runs + 1):
        path = RUNS / f"group-{base}{model_tag}{'+' + variant if variant else ''}-{source}-{lecture}-{n}.blocks.json"
        out.append([i + 1 for i, b in enumerate(json.loads(path.read_text())["blocks"]) if b.get("opensTopic")] if path.exists() else None)
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("lecture")
    parser.add_argument("versions", nargs="+")
    parser.add_argument("--model-tag", default="@gpt-6.1-sol-pro")
    parser.add_argument("--source", default="chosen-live18-rt9")
    parser.add_argument("--runs", type=int, default=4)
    parser.add_argument("--summary", action="store_true")
    args = parser.parse_args()

    ruled = border_rules(args.lecture)
    rules = ruled["rules"]
    expected = [sid for sid, rule in rules.items() if rule == "start"]
    print(f"{args.lecture}: ruled starts {','.join(map(str, expected)) if ruled['ruled'] else 'none (no rulings)'}")
    # 22 on l4 is set aside: its ruling was carried from a division that cut it in two.
    set_aside = {22} if args.lecture == "l4" else set()
    for version in args.versions:
        runs = run_starts(version=version, lecture=args.lecture, model_tag=args.model_tag, source=args.source, runs=args.runs)
        present = [r for r in runs if r is not None]
        distinct = len({tuple(r) for r in present})
        print(f"  {version}: {'all ' + str(len(present)) + ' identical' if distinct == 1 else f'{distinct} different groupings'}")
        if ruled["ruled"]:
            exact = sum(
                1 for r in present
                if all(sid in r for sid in expected) and all(sid == 1 or sid in set_aside or rules[sid] != "not" for sid in r)
            )
            print(f"    exact matches: {exact} of {len(present)}" + (" (22 set aside)" if set_aside else ""))
        if args.summary:
            continue
        for n, r in enumerate(runs, 1):
            if r is None:
                print(f"    run {n}: FAILED")
                continue
            line = f"    run {n}: {','.join(map(str, r))}"
            if ruled["ruled"]:
                missed = [sid for sid in expected if sid not in r]
                wrong = [sid for sid in r if sid > 1 and rules[sid] == "not"]
                line += f"  missed {','.join(map(str, missed)) or '-'}  against-ruling {','.join(map(str, wrong)) or '-'}"
            print(line)


if __name__ == "__main__":
    main()
