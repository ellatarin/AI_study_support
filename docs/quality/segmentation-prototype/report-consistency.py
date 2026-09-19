"""How far a set of runs agree with each other about where the lecture divides.

Separate from `report-division.py`, which asks whether a division is RIGHT and
needs the user's ruling to answer. This asks only whether the runs AGREE, so it
can be run on a lecture nobody has ruled — which is every lecture but three.

Agreement is what the vote spends: a boundary every run proposes survives any
bar, and one that half the runs propose is decided by where the bar sits. So the
figure that matters per lecture is not the mean number of sections but how the
boundaries distribute across the vote.

The clustering is `report-division.py`'s, imported rather than restated: two runs
naming one boundary rarely land on the same character, and what counts as "the
same boundary" has to be one decision.

Usage — the pattern names the runs, with {lec} standing for the lecture key:
  python3 report-consistency.py 'split-s6-{lec}-*.blocks.json'
  python3 report-consistency.py 'deepen-d9-600-split-s6-{lec}-*.blocks.json' l3 l4 l5

Taking a pattern rather than a version is what lets one report serve both passes:
pass one's runs and the deepened runs sit in the same directory under different
names, and agreement means the same thing for either.
"""

import glob
import itertools
import re
import os
import statistics
import sys

from division_support import RUNS, cluster, load_runs, supporters

# Where the vote bar sits under the chosen setting: five of nine. A boundary at
# or above this share of the runs is kept; one below it is dropped. Expressed as
# a share so a pool of any size can be read against it.
KEPT_SHARE = 5 / 9

# A boundary within this many runs of the bar, either side, is one the bar
# decides rather than the model: these are where a division is actually at risk.
CONTESTED_MARGIN = 0.15


def lectures_with_runs(pattern):
    """Every lecture key the pattern matches runs for, in lecture order."""
    keys = set()
    for path in glob.glob(os.path.join(RUNS, pattern.format(lec="l*"))):
        found = re.search(r"-(l\d+)-\d+\.blocks\.json$", os.path.basename(path))
        if found:
            keys.add(found.group(1))
    return sorted(keys, key=lambda key: int(key[1:]))


def agreement(runs):
    """Mean pairwise agreement between runs, as a share of the boundaries either named.

    Two runs proposing the same eleven boundaries score 1.0; two sharing none
    score 0. Taken over every pair, this says how alike two runs picked at random
    would be — which is what a panel of nine is drawing from.
    """
    seams = supporters(runs)
    members = [{index for index, _ in enumerate(runs) if mask >> index & 1} for _, mask in seams]
    scores = []
    for first, second in itertools.combinations(range(len(runs)), 2):
        shared = sum(1 for m in members if first in m and second in m)
        either = sum(1 for m in members if first in m or second in m)
        scores.append(shared / either if either else 1.0)
    return statistics.mean(scores) if scores else 1.0


def report(pattern, keys):
    """Print the agreement table, one row per lecture."""
    header = (
        f"{'lecture':>8} {'runs':>5} {'sections':>16} {'boundaries':>11} "
        f"{'unanimous':>10} {'kept':>6} {'contested':>10} {'rare':>6} {'agreement':>10}"
    )
    print(f"\n{pattern} — how far the runs agree with each other\n")
    print(header)
    print("-" * len(header))
    for key in keys:
        runs = load_runs(pattern.format(lec=key))
        if not runs:
            continue
        counts = sorted(len(run) + 1 for run in runs)
        votes = [v for _, v in cluster(runs)]
        total = len(runs)
        bar = KEPT_SHARE * total
        margin = CONTESTED_MARGIN * total
        unanimous = sum(1 for v in votes if v == total)
        kept = sum(1 for v in votes if v >= bar)
        contested = sum(1 for v in votes if bar - margin <= v <= bar + margin)
        rare = sum(1 for v in votes if v <= 0.25 * total)
        print(
            f"{key:>8} {total:>5} "
            f"{f'{counts[0]}-{statistics.median(counts):.0f}-{counts[-1]}':>16} "
            f"{len(votes):>11} {unanimous:>10} {kept:>6} {contested:>10} {rare:>6} "
            f"{agreement(runs):>9.2f}"
        )
    print(
        "\nsections: fewest-median-most in one run.  boundaries: distinct positions any "
        f"run proposed.\nkept: proposed by at least {KEPT_SHARE:.0%} of runs, the bar in use.  "
        f"contested: within {CONTESTED_MARGIN:.0%} of that bar either side.\n"
        "rare: a quarter of the runs or fewer.  agreement: mean share of boundaries "
        "two runs share."
    )


def main():
    pattern = sys.argv[1] if len(sys.argv) > 1 else "split-s6-{lec}-*.blocks.json"
    keys = sys.argv[2:] or lectures_with_runs(pattern)
    report(pattern, keys)


if __name__ == "__main__":
    main()
