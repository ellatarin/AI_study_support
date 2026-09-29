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

import collections
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


def load_splitting_runs_in_characters(pattern):
    """Every splitting run matching the glob, as (blocks, cut offsets in characters).

    Reads the `.blocks.json` files, whose blocks already hold the sliced text, so
    a cut is just a running character total. The opening of the transcript is not
    a cut and is excluded.
    """
    runs = []
    for path in sorted(glob.glob(os.path.join(RUNS, pattern))):
        blocks = json.load(open(path))["blocks"]
        offset, cuts = 0, []
        for block in blocks:
            if offset > 0:
                cuts.append(offset)
            offset += len(block["content"])
        runs.append((blocks, cuts))
    return runs


def load_splitting_runs(pattern):
    """Every splitting run matching the glob, as a list of cut positions in percent."""
    runs = []
    for blocks, cuts in load_splitting_runs_in_characters(pattern):
        total = sum(len(b["content"]) for b in blocks)
        runs.append([cut / total * 100 for cut in cuts])
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


def survives(site, panel, bar):
    """Whether a panel keeps a cut site: at least `bar` of the panel's runs cut there.

    Both arguments are bitmasks over the runs — `site` of the runs that cut at
    it, from `cut_sites_with_runs`, and `panel` of the runs voting.
    """
    return (site & panel).bit_count() >= bar


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


def site_sets(sites, run_count):
    """Each run's division as the set of cut sites it cuts at, indexed as `sites` lists them.

    `sites` comes from `cut_sites_with_runs`. Two runs make the same division
    when their sets are equal, which is what lets a panel be read as a whole
    division per run rather than as cut sites voted one at a time.
    """
    return [
        frozenset(index for index, (_, mask) in enumerate(sites) if mask >> run & 1)
        for run in range(run_count)
    ]


def distance_to_others(sets, panel, run):
    """Cut sites that differ between one run and each of the panel's others, summed."""
    return sum(len(sets[run] ^ sets[other]) for other in panel if other != run)


def central_run(sets, panel):
    """The panel's run whose division is closest to the others'; the earliest on a tie."""
    return min(panel, key=lambda run: (distance_to_others(sets, panel, run), run))


def most_common_run(sets, panel):
    """A run making the division most of the panel's runs made.

    When several divisions are made equally often, the one closest to the other
    runs wins, and the earliest run on a further tie — the rule the grouping
    panel was settled on, so a panel never ends on an arbitrary pick.
    """
    made = collections.Counter(sets[run] for run in panel)
    return min(
        panel,
        key=lambda run: (-made[sets[run]], distance_to_others(sets, panel, run), run),
    )


def voted_cuts(runs, length, bar):
    """Where the vote cuts the transcript, in characters.

    Every run's cuts are pooled into cut sites exactly as the reports pool them,
    and a site is kept when at least `bar` runs cut there. A kept site is cut at
    the character the most runs chose, the earliest on a tie, so the voted cut
    always falls where some run actually cut.

    `runs` holds each run's cut offsets in characters; `length` is the
    transcript's length in characters.
    """
    in_percent = [[cut / length * 100 for cut in run] for run in runs]
    groups = group_into_cut_sites(p for run in in_percent for p in run)
    sites = cut_sites_with_runs(in_percent)
    kept = []
    for group, (_, mask) in zip(groups, sites):
        if mask.bit_count() < bar:
            continue
        offsets = collections.Counter(round(p * length / 100) for p in group)
        kept.append(min(offsets, key=lambda offset: (-offsets[offset], offset)))
    return kept
