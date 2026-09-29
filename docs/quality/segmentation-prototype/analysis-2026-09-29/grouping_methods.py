"""Choosing one grouping from a panel of grouping runs: most common, vote, closest to vote."""
import collections, importlib.util, itertools, json, os, sys
sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("rtr", "report-topic-rulings.py")
rtr = importlib.util.module_from_spec(spec); spec.loader.exec_module(rtr)
from division_support import RUNS, closest_to_vote_run, most_common_run

PANEL = 9
BARS = (3, 4, 5, 6, 7)
DIVISION = sys.argv[1] if len(sys.argv) > 1 else "closest-d13"
rulings = json.load(open(os.path.join(RUNS, "topic-rulings.json")))

def voted(sets, panel, bar):
    counts = collections.Counter(s for r in panel for s in sets[r])
    return frozenset(s for s, n in counts.items() if n >= bar)

def choose(method, sets, panel, bar):
    if method == "most common":
        return sets[most_common_run(sets, panel)]
    v = voted(sets, panel, bar)
    if method == "vote":
        return v
    return sets[closest_to_vote_run(sets, panel, v)]

def errors(grouping, ruling):
    aside = ruling.either.union(*ruling.one_of)
    return len((grouping - aside) ^ (ruling.starts - aside)) + sum(abs(len(grouping & g) - 1) for g in ruling.one_of)

methods = [("most common", None)] + [(m, b) for m in ("vote", "closest to vote") for b in BARS]
rows = {}
for lec in rtr.LECTURES:
    stem = rtr.voted_division(DIVISION, lec)
    sets = rtr.groupings(stem)
    entry = rulings.get(lec)
    ruling = None
    if entry:
        ruling, _ = rtr.carry(rtr.ruling_for(entry), source=rtr.subtopic_starts(entry["division"]), target=rtr.subtopic_starts(stem))
    idx = range(len(sets))
    halves = [(h, tuple(i for i in idx if i not in h)) for h in itertools.combinations(idx, PANEL) if 0 in h]
    panels = list(itertools.combinations(idx, PANEL))
    for method, bar in methods:
        key = (method, bar)
        stab_same = stab_diff = 0
        for a, b in halves:
            ga, gb = choose(method, sets, a, bar), choose(method, sets, b, bar)
            stab_same += ga == gb; stab_diff += len(ga ^ gb)
        r = {"same": stab_same / len(halves), "diff": stab_diff / len(halves)}
        if ruling:
            errs = [errors(choose(method, sets, p, bar), ruling) for p in panels]
            r["right"] = sum(e == 0 for e in errs) / len(errs); r["errors"] = sum(errs) / len(errs)
        rows.setdefault(lec, {})[f"{method}|{bar}"] = r
json.dump(rows, open(os.path.join(os.environ.get("OUT", "."), f"grouping_methods_{DIVISION}.json"), "w"), indent=1)

def label(m, b): return m if b is None else f"{m} {b}/9"
print(f"division: {DIVISION}")
print("| method | " + " | ".join(rtr.LECTURES) + " |")
print("|---|" + "---|" * len(rtr.LECTURES))
for m, b in methods:
    cells = []
    for lec in rtr.LECTURES:
        r = rows[lec][f"{m}|{b}"]
        cells.append(f"{r['right']:.0%} right, {r['errors']:.2f} err / {r['same']:.0%} same" if "right" in r else f"— / {r['same']:.0%} same")
    print(f"| {label(m, b)} | " + " | ".join(cells) + " |")
