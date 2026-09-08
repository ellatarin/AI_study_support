"""Score a set of division runs against the user's ruled division, and simulate voting.

Pass one and pass 1.5 both vary run to run. This answers the two questions that
variation raises: how far one run is from the division the user chose, and what a
panel of runs voting on each boundary independently would produce.

The rulings are hand judgements and live in `runs/divisions.json`, keyed by
lecture — the same discipline `report-grouping.py` follows for pass two's five
criteria. Nothing here guesses at a division; a lecture with no ruling is
reported by vote distribution alone.

Usage:
  python3 report-division.py <lecture> [<run-glob>]
  python3 report-division.py l5
  python3 report-division.py l3 'deepen-d4-600-split-s6-l3-*.blocks.json'
"""

import glob
import itertools
import json
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "runs")
DIVISIONS = os.path.join(RUNS, "divisions.json")

# Two runs naming the same boundary rarely land on the identical character, so
# positions within this many percentage points of each other are one boundary.
# Measured: real boundaries cluster inside 0.2 points, and the closest pair of
# genuinely different boundaries in any lecture seen so far is 1.8 apart.
TOLERANCE = 1.0

# Panel sizes and vote bars worth reporting. The bar that has held across every
# lecture is roughly two-thirds — lecture 3 forces it, needing above 67% and at
# or below 78%, where lectures 4 and 5 tolerate almost anything.
PANELS = ((5, (2, 3)), (7, (3, 4, 5)), (9, (5, 6, 7)), (11, (4, 5, 7, 8)))


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


def score(positions, ruling):
    """Errors against the ruled division: boundaries missed plus boundaries added."""
    wanted, dont_care = ruling["wanted"], ruling["dontCare"]
    missed = [w for w in wanted if not any(near(p, w) for p in positions)]
    extra = [
        round(p, 1)
        for p in positions
        if not any(near(p, w) for w in wanted) and not any(near(p, d) for d in dont_care)
    ]
    return missed, extra


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    lecture = sys.argv[1]
    pattern = sys.argv[2] if len(sys.argv) > 2 else f"deepen-*-{lecture}-*.blocks.json"
    ruling = json.load(open(DIVISIONS)).get(lecture)
    runs = load_runs(pattern)
    if not runs:
        print(f"no runs matched {pattern}")
        raise SystemExit(1)

    print(f"{lecture}: {len(runs)} runs matching {pattern}")
    print(f"sections per run: {sorted(len(r) + 1 for r in runs)}\n")

    seams = cluster(runs)
    ruled = ruling is not None and ruling.get("wanted") is not None
    print(f"{'at':>7} {'votes':>8}  status")
    for position, votes in seams:
        if not ruled:
            status = ""
        elif any(near(position, w) for w in ruling["wanted"]):
            status = "wanted"
        elif any(near(position, d) for d in ruling["dontCare"]):
            status = "set aside"
        else:
            status = "UNWANTED"
        print(f"{position:6.1f}% {votes:4d}/{len(runs)}  {status}")

    if not ruled:
        note = (ruling or {}).get("note", "no ruling recorded")
        print(f"\nNo ruled division for {lecture} — {note}")
        return

    # The gap between these two numbers is what any vote bar has to fit inside,
    # and it is the first thing to check on a lecture that has just been ruled.
    weakest = min(v for p, v in seams if any(near(p, w) for w in ruling["wanted"]))
    strongest = max(
        [v for p, v in seams
         if not any(near(p, w) for w in ruling["wanted"])
         and not any(near(p, d) for d in ruling["dontCare"])],
        default=0,
    )
    print(f"\nweakest WANTED {weakest}/{len(runs)} ({100 * weakest / len(runs):.0f}%)"
          f"   strongest UNWANTED {strongest}/{len(runs)} ({100 * strongest / len(runs):.0f}%)")
    if strongest < weakest:
        print(f"a vote bar works here only above {100 * strongest / len(runs):.0f}%"
              f" and at or below {100 * weakest / len(runs):.0f}%")
    else:
        print("NO vote bar separates them on these runs — the prompt has to change")

    singles = [len(m) + len(e) for m, e in (score(r, ruling) for r in runs)]
    print(f"\nsingle run: mean {statistics.mean(singles):.2f} errors, "
          f"{sum(1 for s in singles if s == 0)}/{len(runs)} exactly right")

    print(f"\n{'panel':>5} {'keep at':>8} {'as %':>6} {'mean err':>9} {'perfect':>8} {'worst':>6}")
    for size, bars in PANELS:
        if size > len(runs):
            continue
        for bar in bars:
            combos = list(itertools.combinations(range(len(runs)), size))
            errors = []
            for combo in combos:
                kept = [p for p, v in cluster(runs, combo) if v >= bar]
                missed, extra = score(kept, ruling)
                errors.append(len(missed) + len(extra))
            print(f"{size:>5} {bar:>8} {100 * bar / size:>5.0f}% {statistics.mean(errors):>9.2f} "
                  f"{100 * sum(1 for e in errors if e == 0) / len(errors):>7.0f}% {max(errors):>6}")
    if len(runs) < 9:
        print(f"\n(only {len(runs)} runs — panels of 9 need 9)")
    print("\nPanels drawn from one pool overlap, so a panel size close to the pool "
          "size is one observation dressed as many. Trust the widest pool.")


main()
