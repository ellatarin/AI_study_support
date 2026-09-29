"""Write the division a panel of splitting runs votes for, as a subtopics file.

Grouping in the pipeline only ever sees the voted division, never one run's.
This writes that division in the shape `group-trial.mts` reads, so grouping can
be run on it many times and its own consistency measured apart from splitting's.

Each voted subtopic takes its label and reason from the first run in the panel
that starts a subtopic at the same character.

With `closest` it instead writes, whole and with its own labels, the panel's run
nearest the voted division — what the `choose-division` stage keeps.

Usage:
  python3 write-voted-division.py <run-glob> <bar> <out-stem> [closest]
  python3 write-voted-division.py 'deepen-d9-600-split-s6-l4-[1-9].blocks.json' 5 voted-d9-l4-r1to9-k5
  python3 write-voted-division.py 'deepen-d13-600-split-s6-l4-[1-9].blocks.json' 5 closest-d13-l4-r1to9-k5 closest
"""

import glob
import json
import os
import sys

from division_support import (
    RUNS,
    closest_to_vote_run,
    cut_sites_with_runs,
    load_splitting_runs,
    load_splitting_runs_in_characters,
    site_sets,
    survives,
    voted_cuts,
)


def run_metadata(pattern):
    """The lecture key and transcript path of the panel, read from its first run's source."""
    first = sorted(glob.glob(os.path.join(RUNS, pattern)))[0]
    source = json.load(open(first))["source"]
    split = json.load(open(os.path.join(RUNS, f"{source}.blocks.json")))
    return split["lecture"], split["transcriptPath"]


def voted_blocks(runs, cuts):
    """The transcript sliced at the voted cuts, each slice labelled from a run that starts there."""
    text = "".join(block["content"] for block in runs[0][0])
    starts_by_offset = {}
    for blocks, _ in runs:
        offset = 0
        for block in blocks:
            starts_by_offset.setdefault(offset, block)
            offset += len(block["content"])
    edges = [0, *cuts, len(text)]
    return [
        {
            "label": starts_by_offset[start]["label"],
            "why": starts_by_offset[start].get("why", ""),
            "content": text[start:end],
        }
        for start, end in zip(edges, edges[1:])
    ]


def closest_run(pattern, bar):
    """The index of the panel's run nearest the voted division, and how many cut sites it differs by."""
    runs = load_splitting_runs(pattern)
    sites = cut_sites_with_runs(runs)
    sets = site_sets(sites, len(runs))
    panel = range(len(runs))
    mask = (1 << len(runs)) - 1
    voted = frozenset(i for i, (_, site) in enumerate(sites) if survives(site, mask, bar))
    chosen = closest_to_vote_run(sets, panel, voted)
    return chosen, len(sets[chosen] ^ voted)


def main():
    pattern, bar, out_stem = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    closest = sys.argv[4:] == ["closest"]
    runs = load_splitting_runs_in_characters(pattern)
    length = sum(len(block["content"]) for block in runs[0][0])
    lecture, transcript_path = run_metadata(pattern)
    out = {
        "lecture": lecture,
        "transcriptPath": transcript_path,
        "panel": pattern,
        "panelSize": len(runs),
        "bar": bar,
    }
    if closest:
        chosen, distance = closest_run(pattern, bar)
        blocks = runs[chosen][0]
        cuts = runs[chosen][1]
        out |= {"chosenRun": sorted(glob.glob(os.path.join(RUNS, pattern)))[chosen].split("/")[-1],
                "distanceFromVote": distance}
    else:
        cuts = voted_cuts([run_cuts for _, run_cuts in runs], length, bar)
        blocks = voted_blocks(runs, cuts)
    out["blocks"] = blocks
    with open(os.path.join(RUNS, f"{out_stem}.blocks.json"), "w") as handle:
        json.dump(out, handle, indent=2)
    print(f"{out_stem}: {len(runs)} runs, keep {bar}, {len(blocks)} subtopics")
    for cut in cuts:
        print(f"  {cut / length * 100:5.1f}%")


if __name__ == "__main__":
    main()
