"""Choose a grouping from a panel by the user's rule (2026-09-30).

  1. the grouping the most runs give, whole grouping against whole grouping;
  2. tied on runs: the one with the most topics;
  3. still tied: the one closest to the site vote (a border starts a topic when most runs start one there);
  4. still tied: the lowest-numbered run.

Usage: python3 choose_panel.py <model-tag> <runs> <lecture>...   ("" for the default model)
"""

import json
import sys

from score_groupings import run_starts


def choose(runs: list[tuple[int, list[int]]]) -> dict:
    """The panel's choice and why, by the rule above. `runs` is (run number, topic starts) for each run present."""
    groups: dict[tuple[int, ...], list[int]] = {}
    for n, starts in runs:
        groups.setdefault(tuple(starts), []).append(n)
    most = max(len(ns) for ns in groups.values())
    tied = [(k, ns) for k, ns in groups.items() if len(ns) == most]
    if len(tied) == 1:
        return {"chosen": list(tied[0][0]), "from": tied[0][1], "by": f"most runs ({most} of {len(runs)})"}
    topics = max(len(k) for k, _ in tied)
    tied = [(k, ns) for k, ns in tied if len(k) == topics]
    if len(tied) == 1:
        return {"chosen": list(tied[0][0]), "from": tied[0][1], "by": f"tie on {most} runs; most topics ({topics})"}
    last = max(max(s) for _, s in runs)
    voted = {sid for sid in range(2, last + 1) if 2 * sum(sid in s for _, s in runs) > len(runs)}

    def distance(key: tuple[int, ...]) -> int:
        return len({sid for sid in set(key) | voted if sid > 1 and (sid in key) != (sid in voted)})

    nearest = min(distance(k) for k, _ in tied)
    tied = sorted([(k, ns) for k, ns in tied if distance(k) == nearest], key=lambda kn: min(kn[1]))
    by = f"tie on {most} runs and {topics} topics; closest to the site vote ({nearest} off)" + ("; lowest run" if len(tied) > 1 else "")
    return {"chosen": list(tied[0][0]), "from": tied[0][1], "by": by}


def main() -> None:
    model_tag, count, *lectures = sys.argv[1:]
    for lecture in lectures:
        starts = run_starts(version="g23", lecture=lecture, model_tag=model_tag, source="chosen-live18-rt9", runs=int(count))
        runs = [(n, s) for n, s in enumerate(starts, 1) if s is not None]
        print(json.dumps({"lecture": lecture, "runs": len(runs), **choose(runs), "groupings": len({tuple(s) for _, s in runs})}))


if __name__ == "__main__":
    main()
