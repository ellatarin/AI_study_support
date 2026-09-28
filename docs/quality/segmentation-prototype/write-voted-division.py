"""Write the division a panel of splitting runs votes for, as a subtopics file.

Grouping in the pipeline only ever sees the voted division, never one run's.
This writes that division in the shape `group-trial.mts` reads, so grouping can
be run on it many times and its own consistency measured apart from splitting's.

Each voted subtopic takes its label and reason from the first run in the panel
that starts a subtopic at the same character.

Usage:
  python3 write-voted-division.py <run-glob> <bar> <out-stem>
  python3 write-voted-division.py 'deepen-d9-600-split-s6-l4-[1-9].blocks.json' 5 voted-d9-l4-r1to9-k5
"""

import glob
import json
import os
import sys

from division_support import RUNS, load_splitting_runs_in_characters, voted_cuts


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


def main():
    pattern, bar, out_stem = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    runs = load_splitting_runs_in_characters(pattern)
    length = sum(len(block["content"]) for block in runs[0][0])
    cuts = voted_cuts([run_cuts for _, run_cuts in runs], length, bar)
    lecture, transcript_path = run_metadata(pattern)
    blocks = voted_blocks(runs, cuts)
    out = {
        "lecture": lecture,
        "transcriptPath": transcript_path,
        "panel": pattern,
        "panelSize": len(runs),
        "bar": bar,
        "blocks": blocks,
    }
    with open(os.path.join(RUNS, f"{out_stem}.blocks.json"), "w") as handle:
        json.dump(out, handle, indent=2)
    print(f"{out_stem}: {len(runs)} runs, keep {bar}, {len(blocks)} subtopics")
    for cut in cuts:
        print(f"  {cut / length * 100:5.1f}%")


if __name__ == "__main__":
    main()
