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

With `--by-bar`, it asks instead how consistent the VOTED division is at each
bar: the runs are split into two panels of nine, in every possible way, each
panel votes at the bar, and the two divisions are compared. That is running the
pipeline twice and asking how far the answers differ.

Usage — the pattern names the runs, with {lec} standing for the lecture key:
  python3 report-consistency.py 'split-s6-{lec}-*.blocks.json'
  python3 report-consistency.py 'deepen-d9-600-split-s6-{lec}-*.blocks.json' l3 l4 l5
  python3 report-consistency.py --by-bar 'deepen-d9-600-split-s6-{lec}-*.blocks.json'

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
from typing import NamedTuple

from division_support import RUNS, cut_sites, cut_sites_with_runs, load_splitting_runs, survives

# The panel under the chosen setting, and its bar: five of nine. A cut site
# whose support reaches this share of the runs is kept; one below it is
# dropped. Expressed as a share so a pool of any size can be read against it.
PANEL = 9
BAR = 5 / PANEL

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


class BarConsistency(NamedTuple):
    """How alike two panels' voted divisions are at one bar, averaged over every split.

    disagreeing: cut sites one panel keeps and the other drops.
    identical: share of splits where the two divisions are the same.
    kept: cut sites one panel keeps.
    """

    disagreeing: float
    identical: float
    kept: float


def halves_by_bar(runs, panel):
    """Split the runs into two panels of `panel`, every way, and compare their votes at each bar.

    The pool must be exactly two panels, so the halves share no run and each
    split stands for two independent runs of the pipeline. The first run is
    held in the first half so no split is counted twice.
    """
    if len(runs) != 2 * panel:
        raise ValueError(f"{len(runs)} runs cannot be split into two panels of {panel}")
    sites = [mask for _, mask in cut_sites_with_runs(runs)]
    everyone = (1 << len(runs)) - 1
    totals = {bar: [0, 0, 0] for bar in range(1, panel + 1)}
    splits = 0
    for rest in itertools.combinations(range(1, len(runs)), panel - 1):
        first = 1 | sum(1 << index for index in rest)
        second = everyone ^ first
        splits += 1
        for bar, total in totals.items():
            kept_first = {i for i, site in enumerate(sites) if survives(site, first, bar)}
            kept_second = {i for i, site in enumerate(sites) if survives(site, second, bar)}
            disagreeing = len(kept_first ^ kept_second)
            total[0] += disagreeing
            total[1] += disagreeing == 0
            total[2] += (len(kept_first) + len(kept_second)) / 2
    return {
        bar: BarConsistency(
            disagreeing=disagreeing / splits, identical=identical / splits, kept=kept / splits
        )
        for bar, (disagreeing, identical, kept) in totals.items()
    }


def report_by_bar(pattern, keys):
    """Print, for each bar, how far two panels' voted divisions differ on each lecture."""
    by_lecture = {}
    for key in keys:
        runs = load_splitting_runs(pattern.format(lec=key))
        if len(runs) != 2 * PANEL:
            print(f"{key}: {len(runs)} runs, not {2 * PANEL} — left out")
            continue
        by_lecture[key] = halves_by_bar(runs, PANEL)
    print(f"\n{pattern} — two panels of {PANEL} voting at each bar\n")
    header = (
        f"{'bar':>5} "
        + "".join(f"{key:>6}" for key in by_lecture)
        + f" {'kept':>6} {'disagreeing':>12} {'identical':>10}"
    )
    print(header)
    print("-" * len(header))
    for bar in range(1, PANEL + 1):
        rows = [by_lecture[key][bar] for key in by_lecture]
        print(
            f"{f'{bar}/{PANEL}':>5} "
            + "".join(f"{row.disagreeing:>6.1f}" for row in rows)
            + f" {sum(row.kept for row in rows):>6.0f}"
            f" {sum(row.disagreeing for row in rows):>12.1f}"
            f" {sum(row.identical for row in rows):>6.1f}/{len(rows)}"
        )
    print(
        "\nPer lecture: cut sites one panel keeps and the other drops, averaged over "
        f"every split of the {2 * PANEL} runs into two panels.\n"
        "kept: cut sites one panel keeps, all lectures.  disagreeing: the per-lecture "
        "columns summed.\nidentical: lectures where the two panels' divisions match, "
        "expected count."
    )


def main():
    arguments = sys.argv[1:]
    by_bar = arguments[:1] == ["--by-bar"]
    if by_bar:
        arguments = arguments[1:]
    pattern = arguments[0] if arguments else "split-s6-{lec}-*.blocks.json"
    keys = arguments[1:] or lectures_with_runs(pattern)
    (report_by_bar if by_bar else report)(pattern, keys)


if __name__ == "__main__":
    main()
