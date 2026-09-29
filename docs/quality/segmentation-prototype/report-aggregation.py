"""Three ways a panel of nine deepened runs becomes one division, compared.

- vote: keep each cut site at least five of the nine runs cut at (the design).
- most common: take whole the division the most runs made, as grouping does.
- central: take whole the run closest to the other eight.

Two runs make the same division when they cut at the same cut sites, matched
within the tolerance `division_support.py` sets. The two whole-run methods
never build a division no run made; the vote can.

Each is scored two ways:
- stability: the 18 runs of a lecture split into two panels of nine, every
  way; how many cut sites the two panels' divisions disagree on. Running the
  pipeline twice and asking how far the answers differ.
- errors: every panel of nine; wanted cut sites missed plus unwanted ones cut,
  against the ruled division in `runs/divisions.json`.

Usage:
  python3 report-aggregation.py ['deepen-d9-600-split-s6-{lec}-*.blocks.json']
"""

import collections
import itertools
import json
import sys

from division_support import (
    DIVISIONS,
    central_run,
    cut_sites_with_runs,
    load_splitting_runs,
    most_common_run,
    same_cut_site,
    site_sets,
    survives,
)

PANEL = 9
BAR = 5
LECTURES = ("l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8")
METHODS = ("vote", "most common", "central")


def chosen_sites(method, sites, sets, panel):
    """The cut sites the panel's division keeps, under one method."""
    if method == "vote":
        mask = sum(1 << run for run in panel)
        return frozenset(i for i, (_, site) in enumerate(sites) if survives(site, mask, BAR))
    pick = most_common_run if method == "most common" else central_run
    return sets[pick(sets, panel)]


def ruled_errors(sites, ruling):
    """A function giving a division's errors, and the wanted cut sites no run ever cut."""
    wanted = {i for i, (p, _) in enumerate(sites) if any(same_cut_site(p, w) for w in ruling["wanted"])}
    unwanted = {
        i
        for i, (p, _) in enumerate(sites)
        if i not in wanted and not any(same_cut_site(p, d) for d in ruling["dontCare"])
    }
    never = sum(1 for w in ruling["wanted"] if not any(same_cut_site(p, w) for p, _ in sites))
    return lambda kept: never + len(wanted - kept) + len(unwanted & kept)


def lecture_report(pattern, key, ruling):
    """Every method's stability, errors per panel, and how often the most common division repeats."""
    runs = load_splitting_runs(pattern.format(lec=key))
    if len(runs) != 2 * PANEL:
        raise ValueError(f"{key}: {len(runs)} runs, not {2 * PANEL}")
    sites = cut_sites_with_runs(runs)
    sets = site_sets(sites, len(runs))
    errors_of = ruled_errors(sites, ruling)
    everyone = range(len(runs))

    disagreeing = collections.defaultdict(list)
    for rest in itertools.combinations(range(1, len(runs)), PANEL - 1):
        first = (0, *rest)
        second = tuple(run for run in everyone if run not in first)
        for method in METHODS:
            disagreeing[method].append(
                len(chosen_sites(method, sites, sets, first) ^ chosen_sites(method, sites, sets, second))
            )

    errors = collections.defaultdict(list)
    repeats = []
    for panel in itertools.combinations(everyone, PANEL):
        for method in METHODS:
            errors[method].append(errors_of(chosen_sites(method, sites, sets, panel)))
        repeats.append(max(collections.Counter(sets[run] for run in panel).values()))
    return disagreeing, errors, repeats


def mean(values):
    return sum(values) / len(values)


def main():
    pattern = sys.argv[1] if len(sys.argv) > 1 else "deepen-d9-600-split-s6-{lec}-*.blocks.json"
    rulings = json.load(open(DIVISIONS))
    results = {key: lecture_report(pattern, key, rulings[key]) for key in LECTURES}

    print(f"\n{pattern}\n")
    print("Stability: cut sites two panels of nine disagree on, mean over every split")
    print("Errors: wanted missed + unwanted cut, mean over every panel of nine; perfect = share with none\n")
    header = f"{'lecture':>8} " + "".join(f"{m + ' stab':>18}{m + ' err':>16}{'perfect':>9}" for m in METHODS) + f"{'modal made by':>15}"
    print(header)
    print("-" * len(header))
    for key, (disagreeing, errors, repeats) in results.items():
        cells = "".join(
            f"{mean(disagreeing[m]):>18.2f}{mean(errors[m]):>16.2f}"
            f"{mean([e == 0 for e in errors[m]]):>9.0%}"
            for m in METHODS
        )
        print(f"{key:>8} {cells}{mean(repeats):>12.1f}/{PANEL}")
    totals = "".join(
        f"{sum(mean(r[0][m]) for r in results.values()):>18.2f}"
        f"{sum(mean(r[1][m]) for r in results.values()):>16.2f}"
        f"{mean([all(r[1][m][i] == 0 for r in results.values()) for i in range(len(next(iter(results.values()))[1][m]))]):>9.0%}"
        for m in METHODS
    )
    print(f"{'all 8':>8} {totals}")
    print("\nall 8: stability and errors summed over lectures; perfect = share of panels right on every lecture at once.")
    print("modal made by: runs in a panel making its most common division, mean.")


if __name__ == "__main__":
    main()
