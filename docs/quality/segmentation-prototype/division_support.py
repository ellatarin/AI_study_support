"""Reading a set of division runs, and deciding when two runs name one boundary.

Two reports ask different questions of the same runs — `report-division.py`
whether a division is right, `report-consistency.py` whether the runs agree — and
both stand on the same two decisions: where the runs are read from, and how close
two positions have to be before they are the same boundary. Stated twice, those
two reports could disagree about what a boundary is while appearing to describe
the same lecture.

Named with an underscore because a module has to be importable, where the reports
are commands and are named as such.
"""

import glob
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "runs")
DIVISIONS = os.path.join(RUNS, "divisions.json")

# Two runs naming the same boundary rarely land on the identical character, so
# positions within this many percentage points of each other are one boundary.
# Measured: real boundaries cluster inside 0.2 points, and the closest pair of
# genuinely different boundaries in any lecture seen so far is 1.8 apart.
TOLERANCE = 1.0


def near(a, b):
    """Whether two positions name the same boundary."""
    return abs(a - b) < TOLERANCE


def load_runs(pattern):
    """Every run matching the glob, as a list of boundary positions in percent.

    Reads the `.blocks.json` files, whose blocks already hold the sliced text, so
    a boundary is just a running character total. The opening of the transcript
    is not a boundary and is excluded.
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


def cluster(runs, panel=None):
    """Every distinct boundary the panel proposes, with how many runs proposed it."""
    members = range(len(runs)) if panel is None else panel
    points = sorted(p for i in members for p in runs[i])
    groups = []
    for point in points:
        if groups and point - groups[-1][0] <= TOLERANCE:
            groups[-1].append(point)
        else:
            groups.append([point])
    out = []
    for group in groups:
        low, high = min(group), max(group)
        votes = sum(
            1
            for i in members
            if any(low - TOLERANCE / 2 <= p <= high + TOLERANCE / 2 for p in runs[i])
        )
        out.append((sum(group) / len(group), votes))
    return out


def supporters(runs):
    """Every boundary anyone proposed, as (position, bitmask of the runs that made it).

    Clustering once and carrying the supporters as a bitmask is what makes the
    panel sweep finish: re-clustering inside the loop is the same work repeated
    for each of the 48,620 panels of nine drawn from eighteen runs.
    """
    points = sorted(p for run in runs for p in run)
    groups = []
    for point in points:
        if groups and point - groups[-1][-1] <= TOLERANCE:
            groups[-1].append(point)
        else:
            groups.append([point])
    out = []
    for group in groups:
        low, high = min(group) - TOLERANCE / 2, max(group) + TOLERANCE / 2
        mask = 0
        for index, run in enumerate(runs):
            if any(low <= p <= high for p in run):
                mask |= 1 << index
        out.append((sum(group) / len(group), mask))
    return out
