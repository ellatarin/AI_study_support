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
  python3 report-division.py --ledger      writes DIVISION-RESULTS.md
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


# Lectures and deepening versions the ledger reports on, in order.
LEDGER_LECTURES = ("l3", "l4", "l5")
LEDGER_VERSIONS = ("d4", "d5", "d6", "d7", "d8", "d9", "d10")

# The version the voting table is computed for: the one chosen as the system,
# not the one added most recently.
LEDGER_BASELINE = "d9"

# Panel sizes and bars the ledger's joint table walks, as fractions that a bar
# can actually express. Written as (panel, keep) so the percentage is derived
# and can never disagree with the pair it came from.
LEDGER_BARS = (
    (5, 2), (5, 3), (7, 3), (7, 4), (7, 5), (9, 4), (9, 5), (9, 6), (11, 5), (11, 6),
)


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


def panel_result(runs, ruling, size, bar):
    """What a panel of this size, keeping boundaries this many runs agree on, scores."""
    seams = supporters(runs)
    wanted_masks, unwanted_masks = [], []
    for position, mask in seams:
        if any(near(position, w) for w in ruling["wanted"]):
            wanted_masks.append(mask)
        elif not any(near(position, d) for d in ruling["dontCare"]):
            unwanted_masks.append(mask)
    # A ruled boundary no run ever proposes is missed by every panel, always.
    never = sum(
        1 for w in ruling["wanted"] if not any(near(p, w) for p, _ in seams)
    )
    errors = []
    for panel in itertools.combinations(range(len(runs)), size):
        mask = 0
        for index in panel:
            mask |= 1 << index
        errors.append(
            never
            + sum(1 for m in wanted_masks if (m & mask).bit_count() < bar)
            + sum(1 for m in unwanted_masks if (m & mask).bit_count() >= bar)
        )
    return statistics.mean(errors), 100 * sum(1 for e in errors if e == 0) / len(errors)


def ledger():
    """Write the results file: every version against every ruled lecture, and the joint bar.

    Generated rather than written by hand for the reason the prompt registries
    are: a table typed out beside the runs it describes goes stale the first
    time anyone adds a run, and nothing says it has.
    """
    rulings = json.load(open(DIVISIONS))
    lines = [
        "# Division results",
        "",
        "Generated by `report-division.py --ledger`. Do not edit by hand.",
        "",
        "Every deepening version scored against the divisions the user has ruled, in",
        "`runs/divisions.json`. A run's error count is boundaries missed plus boundaries",
        "added; `perfect` is the share of runs, or of panels, that hit the ruled division",
        "exactly.",
        "",
        "## One run at a time",
        "",
        "| lecture | version | runs | mean errors | perfect | weakest wanted | strongest unwanted |",
        "|---|---|---|---|---|---|---|",
    ]
    loaded = {}
    for lecture in LEDGER_LECTURES:
        ruling = rulings.get(lecture) or {}
        if ruling.get("wanted") is None:
            continue
        for version in LEDGER_VERSIONS:
            runs = load_runs(f"deepen-{version}-600-split-s6-{lecture}-*.blocks.json")
            if not runs:
                continue
            loaded[(lecture, version)] = runs
            singles = [len(m) + len(e) for m, e in (score(r, ruling) for r in runs)]
            seams = cluster(runs)
            weakest = min(v for p, v in seams if any(near(p, w) for w in ruling["wanted"]))
            strongest = max(
                [v for p, v in seams
                 if not any(near(p, w) for w in ruling["wanted"])
                 and not any(near(p, d) for d in ruling["dontCare"])],
                default=0,
            )
            perfect = 100 * sum(1 for s in singles if s == 0) / len(singles)
            lines.append(
                f"| {lecture} | {version} | {len(runs)} | {statistics.mean(singles):.2f} | "
                f"{perfect:.0f}% | {weakest}/{len(runs)} | {strongest}/{len(runs)} |"
            )

    latest = LEDGER_BASELINE
    lines += [
        "",
        f"## Voting, on {latest}",
        "",
        "Run the pipeline *panel* times and keep a boundary *keep* of them propose.",
        "Every lecture has to tolerate the same bar, so the usable one is where no",
        "column is failing.",
        "",
        "| panel | keep | as % | "
        + " | ".join(f"{lecture} errors | {lecture} perfect" for lecture in LEDGER_LECTURES)
        + " |",
        "|---|---|---|" + "---|" * (2 * len(LEDGER_LECTURES)),
    ]
    for size, bar in LEDGER_BARS:
        row = f"| {size} | {bar} | {100 * bar / size:.0f}% |"
        for lecture in LEDGER_LECTURES:
            runs = loaded.get((lecture, latest))
            if not runs or size > len(runs):
                row += " — | — |"
                continue
            mean, perfect = panel_result(runs, rulings[lecture], size, bar)
            row += f" {mean:.2f} | {perfect:.0f}% |"
        lines.append(row)
    lines += [
        "",
        "Panels drawn from one pool of runs overlap, so a panel size close to the pool",
        "size is one observation dressed as many. The narrowest pool here is 11 runs, so",
        "the 11-row is a single panel and proves nothing on its own.",
        "",
    ]
    path = os.path.join(HERE, "DIVISION-RESULTS.md")
    open(path, "w").write("\n".join(lines))
    print(f"wrote {path}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    if sys.argv[1] == "--ledger":
        ledger()
        return
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
