"""Compares the pipeline's `choose-division` choice with the prototype's (ticket 07).

Reads what `replay-choose-division.mts` chose and makes the prototype's choice
from the same runs, in the same order, the way `write-voted-division.py`'s
`closest_run` does: cut sites from the panel's own runs, the vote at the bar,
then `closest_to_vote_run`.

Usage: python3 replay_choose_division.py <out.json>
"""

import itertools
import json
import sys

from division_support import (
    closest_to_vote_run,
    cut_sites_with_runs,
    load_splitting_runs,
    site_sets,
    survives,
)

PANEL = 9


def prototype_choice(runs, bar):
    """The prototype's chosen run, as an index into `runs`, and its distance from the vote."""
    sites = cut_sites_with_runs(runs)
    sets = site_sets(sites, len(runs))
    mask = (1 << len(runs)) - 1
    voted = frozenset(i for i, (_, site) in enumerate(sites) if survives(site, mask, bar))
    chosen = closest_to_vote_run(sets, range(len(runs)), voted)
    return chosen, len(sets[chosen] ^ voted)


def main():
    replay = json.load(open(sys.argv[1]))
    for lecture, entry in replay.items():
        runs = [load_splitting_runs(name)[0] for name in entry["files"]]
        full, distance = prototype_choice(runs, 9)
        full_same = full == entry["full"] and distance == entry["fullDistance"]
        differing = 0
        for panel, pipeline_choice in zip(itertools.combinations(range(len(runs)), PANEL), entry["panels"], strict=True):
            chosen, _ = prototype_choice([runs[i] for i in panel], 5)
            differing += panel[chosen] != pipeline_choice
        print(
            f"{lecture}: all 18 at bar 9 — prototype run {full + 1} at {distance}, pipeline run {entry['full'] + 1} "
            f"at {entry['fullDistance']} ({'same' if full_same else 'DIFFERENT'}); "
            f"panels of 9 at bar 5 — {differing} of {len(entry['panels'])} differ"
        )


if __name__ == "__main__":
    main()
