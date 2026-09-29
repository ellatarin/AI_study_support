"""Score g12 grouping runs against the user's topic rulings, for each deepening version's voted division.

The rulings in `runs/topic-rulings.json` are subtopic ids in the division they
were made on. A ruling is carried to another version's voted division by
position in the transcript: a ruled subtopic maps to the one starting at the
same cut site there. A subtopic the other division adds sits inside a ruled
topic, so the ruling keeps it in that topic; a ruled start the other division
has no subtopic for is lost, and the runs are scored on the rest.

For each lecture and version it reports how stable grouping is — how many
distinct groupings the runs made, and how many runs made the most common one —
and, for ruled lectures, how many runs match the ruling and the share of panels
of nine whose most common grouping matches it, which is how the pipeline picks
a grouping.

Usage:
  python3 report-topic-rulings.py <version> [<version> ...]
  python3 report-topic-rulings.py d9 d13
  python3 report-topic-rulings.py d13 closest-d13
"""

import collections
import glob
import itertools
import json
import os
import sys
from typing import NamedTuple

from division_support import RUNS, load_splitting_runs_in_characters, same_cut_site

LECTURES = ("l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8")
GROUPING_PROMPT = "g12"
PANEL = 9


class Ruling(NamedTuple):
    """Where topics start: required starts, starts scored neither way, and groups of which exactly one starts."""

    starts: frozenset
    either: frozenset
    one_of: tuple


def voted_division(version, lecture):
    """The stem of a version's division for a lecture: voted, or the run closest to the vote when named `closest-<version>`."""
    if version.startswith("closest-"):
        return f"{version}-{lecture}-r1to9-k5"
    return f"voted-{version}-{lecture}-r1to9-k5"


def subtopic_starts(stem):
    """Where each subtopic of a division starts, in percent of the transcript; the first at 0."""
    [(blocks, cuts)] = load_splitting_runs_in_characters(f"{stem}.blocks.json")
    total = sum(len(block["content"]) for block in blocks)
    return [0.0] + [cut / total * 100 for cut in cuts]


def id_at(starts, position):
    """The 1-based id of the subtopic starting at this cut site, or None when none does.

    Two subtopics can start within the tolerance of one position; the nearer is the one meant.
    """
    near = [(abs(start - position), i) for i, start in enumerate(starts, start=1) if same_cut_site(start, position)]
    return min(near)[1] if near else None


def carry(ruling, source, target):
    """A ruling on the source division, restated in the target's subtopic ids, and the ruled starts it lost."""
    to_target = lambda ids: frozenset(i for i in (id_at(target, source[s - 1]) for s in ids) if i is not None)
    lost = sorted(s for s in ruling.starts if id_at(target, source[s - 1]) is None)
    carried = Ruling(
        starts=to_target(ruling.starts),
        either=to_target(ruling.either),
        one_of=tuple(to_target(group) for group in ruling.one_of),
    )
    return carried, lost


def matches(grouping, ruling):
    """Whether a grouping's topic starts are the ruled ones, 'either' set aside and each oneOf group started exactly once."""
    set_aside = ruling.either.union(*ruling.one_of)
    return grouping - set_aside == ruling.starts - set_aside and all(
        len(grouping & group) == 1 for group in ruling.one_of
    )


def topic_starts(sizes):
    """The subtopic ids a grouping starts topics at, from its topic sizes; the opening topic excluded."""
    return frozenset(itertools.accumulate(sizes[:-1], initial=1)) - {1}


def groupings(stem):
    """Every usable grouping run on a division, as its topic starts."""
    runs = []
    for path in sorted(glob.glob(os.path.join(RUNS, f"group-{GROUPING_PROMPT}-{stem}-*.outcome.json"))):
        outcome = json.load(open(path))
        if outcome.get("verdict") == "OK":
            runs.append(topic_starts(outcome["topicSizes"]))
    return runs


def panel_most_common_matches(runs, ruling):
    """Share of panels of nine whose most common grouping matches the ruling, and the share where it only ties."""
    right = tied = total = 0
    for panel in itertools.combinations(runs, PANEL):
        counts = collections.Counter(panel)
        top = max(counts.values())
        leaders = [grouping for grouping, n in counts.items() if n == top]
        total += 1
        if any(matches(grouping, ruling) for grouping in leaders):
            if len(leaders) == 1:
                right += 1
            else:
                tied += 1
    return right / total, tied / total


def ruling_for(entry):
    """A lecture's ruling as recorded, in its own division's subtopic ids."""
    return Ruling(
        starts=frozenset(entry["topicStarts"]),
        either=frozenset(entry["either"]),
        one_of=tuple(frozenset(group) for group in entry.get("oneOf", [])),
    )


def main():
    versions = sys.argv[1:]
    if not versions:
        sys.exit(__doc__)
    rulings = json.load(open(os.path.join(RUNS, "topic-rulings.json")))
    print("| lecture | version | runs | distinct groupings | most common made by | match ruling | panels of 9 matching (+ tied) |")
    print("|---|---|---|---|---|---|---|")
    notes = []
    for lecture in LECTURES:
        entry = rulings.get(lecture)
        for version in versions:
            stem = voted_division(version, lecture)
            runs = groupings(stem)
            counts = collections.Counter(runs)
            row = f"| {lecture} | {version} | {len(runs)} | {len(counts)} | {counts.most_common(1)[0][1]}/{len(runs)}"
            if entry is None:
                print(f"{row} | unruled | unruled |")
                continue
            target = subtopic_starts(stem)
            source = subtopic_starts(entry["division"])
            ruling, lost = carry(ruling_for(entry), source=source, target=target)
            right, tied = panel_most_common_matches(runs, ruling)
            print(f"{row} | {sum(matches(g, ruling) for g in runs)}/{len(runs)} | {right:.0%} (+{tied:.0%}) |")
            added = [i for i, start in enumerate(target, start=1) if id_at(source, start) is None]
            notes += [f"{lecture} {version}: subtopic {i} ({target[i - 1]:.1f}%) is not in the ruled division; "
                      f"{sum(i in g for g in runs)}/{len(runs)} runs start a topic there" for i in added]
            notes += [f"{lecture} {version}: no subtopic where ruled start {s} is; scored on the other starts" for s in lost]
    if notes:
        print()
        print("\n".join(notes))


if __name__ == "__main__":
    main()
