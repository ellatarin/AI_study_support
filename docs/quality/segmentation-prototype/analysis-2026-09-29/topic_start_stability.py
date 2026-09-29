"""How stable each topic start is when two panels of nine grouping runs each choose the run closest to their vote."""
import collections, importlib.util, itertools, sys
sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("rtr", "report-topic-rulings.py"); rt = importlib.util.module_from_spec(spec); spec.loader.exec_module(rt)
from division_support import closest_to_vote_run

BARS, PANEL = (3, 4, 5, 6, 7), 9
def voted(sets, panel, bar):
    c = collections.Counter(s for r in panel for s in sets[r]); return frozenset(s for s, n in c.items() if n >= bar)
print("| lecture | " + " | ".join(f"{b}/9" for b in BARS) + " |"); print("|---|" + "---|" * len(BARS))
detail = {}
for lec in rt.LECTURES:
    sets = rt.groupings(rt.voted_division("closest-d13", lec)); idx = range(len(sets))
    halves = [(h, tuple(i for i in idx if i not in h)) for h in itertools.combinations(idx, PANEL) if 0 in h]
    cells = []
    for bar in BARS:
        same = 0; flips = collections.Counter(); diffs = 0
        for a, b in halves:
            ga = sets[closest_to_vote_run(sets, a, voted(sets, a, bar))]; gb = sets[closest_to_vote_run(sets, b, voted(sets, b, bar))]
            same += ga == gb; diffs += len(ga ^ gb); flips.update(ga ^ gb)
        cells.append(f"{same/len(halves):.0%} same, {diffs/len(halves):.2f} differ")
        detail[(lec, bar)] = {s: n / len(halves) for s, n in flips.items()}
    print(f"| {lec} | " + " | ".join(cells) + " |")
print()
for lec in rt.LECTURES:
    sets = rt.groupings(rt.voted_division("closest-d13", lec)); support = collections.Counter(s for g in sets for s in g)
    contested = sorted(s for s, n in support.items() if n < len(sets))
    for s in contested:
        print(f"{lec} subtopic {s:2} ({support[s]:2}/18 runs start here): " + "  ".join(f"{b}/9 flips {detail[(lec, b)].get(s, 0):.0%}" for b in BARS))
