"""Score a set of splitting runs against the user's ruled division, and simulate voting.

Initial subtopic splitting and deepening both vary from run to run. This answers
the two questions that variation raises: how far one splitting run is from the
division the user chose, and what a panel of runs voting on each cut site
independently would produce.

The rulings are hand judgements and live in `runs/divisions.json`, keyed by
lecture — the same discipline `report-grouping.py` follows for grouping's
rubrics. Nothing here guesses at a division; a lecture with no ruling is
reported by the support for each cut site alone.

Usage:
  python3 report-division.py <lecture> [<run-glob>]
  python3 report-division.py l5
  python3 report-division.py l3 'deepen-d4-600-split-s6-l3-*.blocks.json'
  python3 report-division.py --ledger      writes DIVISION-RESULTS.md
"""

import itertools
import json
import os
import statistics
import sys

from division_support import (
    DIVISIONS,
    HERE,
    cut_sites,
    cut_sites_with_runs,
    load_splitting_runs,
    same_cut_site,
)

# Panel sizes and bars worth reporting. The bar that has held across every
# lecture is roughly two-thirds — lecture 3 forces it, needing above 67% and at
# or below 78%, where lectures 4 and 5 tolerate almost anything.
PANELS = ((5, (2, 3)), (7, (3, 4, 5)), (9, (5, 6, 7)), (11, (4, 5, 7, 8)))


def score(positions, ruling):
    """Errors against the ruled division: wanted cut sites missed plus unwanted ones cut."""
    wanted, dont_care = ruling["wanted"], ruling["dontCare"]
    missed = [w for w in wanted if not any(same_cut_site(p, w) for p in positions)]
    extra = [
        round(p, 1)
        for p in positions
        if not any(same_cut_site(p, w) for w in wanted)
        and not any(same_cut_site(p, d) for d in dont_care)
    ]
    return missed, extra


def weakest_and_strongest(sites, ruling):
    """Support for the weakest wanted cut site and for the strongest unwanted one.

    The gap between the two is what any bar has to fit inside, and it is the
    first thing to check on a lecture that has just been ruled.
    """
    weakest = min(
        s for p, s in sites if any(same_cut_site(p, w) for w in ruling["wanted"])
    )
    strongest = max(
        [s for p, s in sites
         if not any(same_cut_site(p, w) for w in ruling["wanted"])
         and not any(same_cut_site(p, d) for d in ruling["dontCare"])],
        default=0,
    )
    return weakest, strongest


# Lectures and deepening versions the ledger reports on, in order.
LEDGER_LECTURES = ("l3", "l4", "l5")
LEDGER_VERSIONS = ("d4", "d5", "d6", "d7", "d8", "d9", "d10", "d11", "d12")

# The version the voting table is computed for: the one chosen as the system,
# not the one added most recently.
# d9: chosen 2026-09-17 for margin, not for its peak. Lectures 4 and 5 stay
# at 96% or better across four consecutive bars under it, so lecture 3 is the
# only sensitive one; d12 scores higher at one bar and its lecture-5 column
# swings 57-92-68-32-8 either side of it.
LEDGER_BASELINE = "d9"

# Panel sizes and bars the ledger's joint table walks, as fractions that a bar
# can actually express. Written as (panel, keep) so the percentage is derived
# and can never disagree with the pair it came from.
LEDGER_BARS = (
    (5, 2), (5, 3), (7, 2), (7, 3), (7, 4), (9, 2), (9, 3), (9, 4), (9, 5), (9, 6),
    (11, 3), (11, 4), (11, 5),
)


def panel_errors(runs, ruling, size, bar):
    """One error count per panel of this size, keeping cut sites with support of at least `bar`.

    The counts are returned rather than their average because the figure that
    decides a setting is the share of panels that get EVERY lecture right at
    once, and three separate averages cannot be made to yield it. Reading the
    per-lecture columns alone hid the best setting measured: d12 at three of nine
    gets all three lectures right in 92% of panels, on a row the ledger was not
    printing.
    """
    sites = cut_sites_with_runs(runs)
    wanted_masks, unwanted_masks = [], []
    for position, mask in sites:
        if any(same_cut_site(position, w) for w in ruling["wanted"]):
            wanted_masks.append(mask)
        elif not any(same_cut_site(position, d) for d in ruling["dontCare"]):
            unwanted_masks.append(mask)
    # A wanted cut site no run ever cuts at is missed by every panel, always.
    never = sum(
        1 for w in ruling["wanted"] if not any(same_cut_site(p, w) for p, _ in sites)
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
    return errors


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
        "`runs/divisions.json`. A splitting run's error count is wanted cut sites missed",
        "plus unwanted ones cut; `perfect` is the share of runs, or of panels, that hit",
        "the ruled division exactly.",
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
            runs = load_splitting_runs(f"deepen-{version}-600-split-s6-{lecture}-*.blocks.json")
            if not runs:
                continue
            loaded[(lecture, version)] = runs
            singles = [len(m) + len(e) for m, e in (score(r, ruling) for r in runs)]
            weakest, strongest = weakest_and_strongest(cut_sites(runs), ruling)
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
        "Make *panel* splitting runs and keep a cut site at least *keep* of them cut at.",
        "**`all three` is the figure that decides a setting**: the share of panels that",
        "get every lecture right at the same time. It is lower than the worst column,",
        "because a panel can fail on different lectures, and it cannot be recovered from",
        "the per-lecture columns after the fact.",
        "",
        "| panel | keep | as % | "
        + " | ".join(f"{lecture} right" for lecture in LEDGER_LECTURES)
        + " | all three | mean error |",
        "|---|---|---|" + "---|" * (len(LEDGER_LECTURES) + 2),
    ]
    for size, bar in LEDGER_BARS:
        row = f"| {size} | {bar} | {100 * bar / size:.0f}% |"
        together, total, usable = None, 0.0, True
        for lecture in LEDGER_LECTURES:
            runs = loaded.get((lecture, latest))
            if not runs or size > len(runs):
                row += " — |"
                usable = False
                continue
            errors = panel_errors(runs, rulings[lecture], size, bar)
            right = [e == 0 for e in errors]
            row += f" {100 * sum(right) / len(right):.0f}% |"
            total += statistics.mean(errors)
            together = right if together is None else [a and b for a, b in zip(together, right)]
        if usable and together is not None:
            row += f" **{100 * sum(together) / len(together):.0f}%** | {total:.2f} |"
        else:
            row += " — | — |"
        lines.append(row)
    pool = min(
        (len(runs) for (lecture, version), runs in loaded.items() if version == latest),
        default=0,
    )
    lines += [
        "",
        f"Panels are drawn from a pool of {pool} runs per lecture, and panels from one pool",
        "overlap: the closer the panel size is to the pool, the more any two panels share,",
        "and the more a row is one observation dressed as many. Trust the smaller panels.",
        f"Two panels of {pool - 1} out of {pool} share all but two runs; panels of 9 out of 18 share",
        "at most seven. A bar of 6-of-9 scored zero errors on all three lectures when the",
        "pool was 11 and 0.59 on lecture 3 once it was 18 — that is this effect.",
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
    runs = load_splitting_runs(pattern)
    if not runs:
        print(f"no runs matched {pattern}")
        raise SystemExit(1)

    print(f"{lecture}: {len(runs)} splitting runs matching {pattern}")
    print(f"subtopics per run: {sorted(len(r) + 1 for r in runs)}\n")

    sites = cut_sites(runs)
    ruled = ruling is not None and ruling.get("wanted") is not None
    print(f"{'at':>7} {'support':>8}  status")
    for position, support in sites:
        if not ruled:
            status = ""
        elif any(same_cut_site(position, w) for w in ruling["wanted"]):
            status = "wanted"
        elif any(same_cut_site(position, d) for d in ruling["dontCare"]):
            status = "set aside"
        else:
            status = "UNWANTED"
        print(f"{position:6.1f}% {support:4d}/{len(runs)}  {status}")

    if not ruled:
        note = (ruling or {}).get("note", "no ruling recorded")
        print(f"\nNo ruled division for {lecture} — {note}")
        return

    weakest, strongest = weakest_and_strongest(sites, ruling)
    print(f"\nweakest WANTED {weakest}/{len(runs)} ({100 * weakest / len(runs):.0f}%)"
          f"   strongest UNWANTED {strongest}/{len(runs)} ({100 * strongest / len(runs):.0f}%)")
    if strongest < weakest:
        print(f"a bar works here only above {100 * strongest / len(runs):.0f}%"
              f" and at or below {100 * weakest / len(runs):.0f}%")
    else:
        print("NO bar separates them on these runs — the prompt has to change")

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
                kept = [p for p, s in cut_sites(runs, combo) if s >= bar]
                missed, extra = score(kept, ruling)
                errors.append(len(missed) + len(extra))
            print(f"{size:>5} {bar:>8} {100 * bar / size:>5.0f}% {statistics.mean(errors):>9.2f} "
                  f"{100 * sum(1 for e in errors if e == 0) / len(errors):>7.0f}% {max(errors):>6}")
    if len(runs) < 9:
        print(f"\n(only {len(runs)} runs — panels of 9 need 9)")
    print("\nPanels drawn from one pool overlap, so a panel size close to the pool "
          "size is one observation dressed as many. Trust the widest pool.")


if __name__ == "__main__":
    main()
