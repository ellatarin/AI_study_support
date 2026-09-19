"""Reading a set of splitting runs, and deciding when two runs' cuts are one cut site.

Two reports ask different questions of the same splitting runs —
`report-division.py` whether a division is right, `report-consistency.py` how
consistent the runs are — and both stand on the same two decisions: where the
runs are read from, and how close two cuts have to be before they are the same
cut site. Stated twice, those two reports could disagree about what a cut site
is while appearing to describe the same lecture.

Named with an underscore because a module has to be importable, where the reports
are commands and are named as such.
"""

import glob
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "runs")
DIVISIONS = os.path.join(RUNS, "divisions.json")

# Two runs cutting at the same cut site rarely land on the identical character,
# so cuts within this many percentage points of each other are one cut site.
# Measured: real cut sites span under 0.2 points, and the closest pair of
# genuinely different cut sites in any lecture seen so far is 1.8 apart.
TOLERANCE = 1.0


def same_cut_site(a, b):
    """Whether two cut positions are the same cut site."""
    return abs(a - b) < TOLERANCE


def load_splitting_runs(pattern):
    """Every splitting run matching the glob, as a list of cut positions in percent.

    Reads the `.blocks.json` files, whose blocks already hold the sliced text, so
    a cut is just a running character total. The opening of the transcript is not
    a cut and is excluded.
    """
    runs = []
    for path in sorted(glob.glob(os.path.join(RUNS, pattern))):
        blocks = json.load(open(path))["blocks"]
        total = sum(len(b["content"]) for b in blocks)
        offset, positions = 0, []
        for block in blocks:
            if offset > 0:
                positions.append(offset / total * 100)
            offset += len(block["content"])
        runs.append(positions)
    return runs


def group_into_cut_sites(points):
    """Sort cut positions into cut sites, each no wider than the tolerance.

    A cut joins a cut site only if it is within the tolerance of the site's FIRST
    cut. Measuring from the most recent cut instead would let a site grow cut by
    cut, and could merge two genuinely different cut sites into one.
    """
    groups = []
    for point in sorted(points):
        if groups and point - groups[-1][0] <= TOLERANCE:
            groups[-1].append(point)
        else:
            groups.append([point])
    return groups


def cut_sites(runs, panel=None):
    """Every cut site the panel's runs cut at, as (position, support)."""
    members = range(len(runs)) if panel is None else panel
    groups = group_into_cut_sites(p for i in members for p in runs[i])
    out = []
    for group in groups:
        low, high = min(group), max(group)
        support = sum(
            1
            for i in members
            if any(low - TOLERANCE / 2 <= p <= high + TOLERANCE / 2 for p in runs[i])
        )
        out.append((sum(group) / len(group), support))
    return out


def cut_sites_with_runs(runs):
    """Every cut site any run cut at, as (position, bitmask of the runs that cut there).

    Finding the cut sites once and carrying their support as a bitmask is what
    makes the panel sweep finish: finding them again inside the loop is the same
    work repeated for each of the 48,620 panels of nine drawn from eighteen runs.
    """
    groups = group_into_cut_sites(p for run in runs for p in run)
    out = []
    for group in groups:
        low, high = min(group) - TOLERANCE / 2, max(group) + TOLERANCE / 2
        mask = 0
        for index, run in enumerate(runs):
            if any(low <= p <= high for p in run):
                mask |= 1 << index
        out.append((sum(group) / len(group), mask))
    return out
