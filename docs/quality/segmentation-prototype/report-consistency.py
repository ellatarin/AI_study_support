"""How consistent a lecture's splitting runs are about where the lecture divides.

Separate from `report-division.py`, which asks whether a division is RIGHT and
needs the user's ruled division to answer. This asks only how CONSISTENT the runs
are, so it can be run on a lecture nobody has ruled — which is every lecture but
three.

Consistency is what the vote spends: a cut site every run cuts at survives any
bar, and one that half the runs cut at is decided by where the bar sits. So the
figure that matters per lecture is not the mean number of subtopics but how the
cut sites distribute across the vote.

What counts as the same cut site comes from `division_support.py`, shared with
`report-division.py`: two runs cutting at one cut site rarely land on the same
character, and that has to be one decision.

Usage — the pattern names the runs, with {lec} standing for the lecture key:
  python3 report-consistency.py 'split-s6-{lec}-*.blocks.json'
  python3 report-consistency.py 'deepen-d9-600-split-s6-{lec}-*.blocks.json' l3 l4 l5

Taking a pattern rather than a version is what lets one report serve both
initial subtopic splitting and deepening: their runs sit in the same directory
under different names, and consistency means the same thing for either.
"""

import glob
import itertools
import re
import os
import statistics
import sys

from division_support import RUNS, cut_sites, cut_sites_with_runs, load_splitting_runs

# The bar under the chosen setting: five of nine. A cut site whose support
# reaches this share of the runs is kept; one below it is dropped. Expressed as
# a share so a pool of any size can be read against it.
BAR = 5 / 9

# A cut site within this share of the runs of the bar, either side, is one the
# bar decides rather than the model: these are where a division is at risk.
CONTESTED_MARGIN = 0.15


def lectures_with_runs(pattern):
    """Every lecture key the pattern matches runs for, in lecture order."""
    keys = set()
    for path in glob.glob(os.path.join(RUNS, pattern.format(lec="l*"))):
        found = re.search(r"-(l\d+)-\d+\.blocks\.json$", os.path.basename(path))
        if found:
            keys.add(found.group(1))
    return sorted(keys, key=lambda key: int(key[1:]))


def consistency(runs):
    """Mean pairwise consistency between runs, as a share of the cut sites either cut at.

    Two runs cutting at the same eleven cut sites score 1.0; two sharing none
    score 0. Taken over every pair, this says how alike two runs picked at random
    would be — which is what a panel of nine is drawing from.
    """
    sites = cut_sites_with_runs(runs)
    members = [{index for index, _ in enumerate(runs) if mask >> index & 1} for _, mask in sites]
    scores = []
    for first, second in itertools.combinations(range(len(runs)), 2):
        shared = sum(1 for m in members if first in m and second in m)
        either = sum(1 for m in members if first in m or second in m)
        scores.append(shared / either if either else 1.0)
    return statistics.mean(scores) if scores else 1.0


def report(pattern, keys):
    """Print the consistency table, one row per lecture."""
    header = (
        f"{'lecture':>8} {'runs':>5} {'subtopics':>16} {'cut sites':>11} "
        f"{'unanimous':>10} {'kept':>6} {'contested':>10} {'rare':>6} {'consistency':>12}"
    )
    print(f"\n{pattern} — how consistent the splitting runs are\n")
    print(header)
    print("-" * len(header))
    for key in keys:
        runs = load_splitting_runs(pattern.format(lec=key))
        if not runs:
            continue
        counts = sorted(len(run) + 1 for run in runs)
        support = [s for _, s in cut_sites(runs)]
        total = len(runs)
        bar = BAR * total
        margin = CONTESTED_MARGIN * total
        unanimous = sum(1 for s in support if s == total)
        kept = sum(1 for s in support if s >= bar)
        contested = sum(1 for s in support if bar - margin <= s <= bar + margin)
        rare = sum(1 for s in support if s <= 0.25 * total)
        print(
            f"{key:>8} {total:>5} "
            f"{f'{counts[0]}-{statistics.median(counts):.0f}-{counts[-1]}':>16} "
            f"{len(support):>11} {unanimous:>10} {kept:>6} {contested:>10} {rare:>6} "
            f"{consistency(runs):>11.2f}"
        )
    print(
        "\nsubtopics: fewest-median-most in one run.  cut sites: distinct places any "
        f"run cut at.\nkept: support of at least {BAR:.0%} of runs, the bar in use.  "
        f"contested: within {CONTESTED_MARGIN:.0%} of that bar either side.\n"
        "rare: a quarter of the runs or fewer.  consistency: mean share of cut sites "
        "two runs share."
    )


def main():
    pattern = sys.argv[1] if len(sys.argv) > 1 else "split-s6-{lec}-*.blocks.json"
    keys = sys.argv[2:] or lectures_with_runs(pattern)
    report(pattern, keys)


if __name__ == "__main__":
    main()
