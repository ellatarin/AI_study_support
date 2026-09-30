"""g15 without titles (one panel of 18) against g15 with titles (36 runs) on the live chosen divisions."""
import collections, importlib.util, json, os, sys
sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("rtr", "report-topic-rulings.py")
rtr = importlib.util.module_from_spec(spec); spec.loader.exec_module(rtr)
from division_support import RUNS, closest_to_vote_run
rulings = json.load(open(os.path.join(RUNS, "topic-rulings.json")))

def load(prefix, stem, count):
    sets = []
    for i in range(1, count + 1):
        o = json.load(open(os.path.join(RUNS, f"{prefix}-{stem}-{i}.outcome.json")))
        if o.get("verdict") != "OK": raise SystemExit(f"{prefix}-{stem}-{i}: {o.get('verdict')}")
        sets.append(rtr.topic_starts(o["topicSizes"]))
    return sets

def chosen(sets):
    panel = tuple(range(len(sets))); counts = collections.Counter(s for g in sets for s in g)
    voted = frozenset(s for s, c in counts.items() if c >= len(sets) // 2)
    return sets[closest_to_vote_run(sets, panel, voted)]

print("| lecture | with titles: chosen from runs 1-18 matches ruling | without titles: matches ruling | starts where the two chosen groupings differ |")
print("|---|---|---|---|")
for n in range(1, 9):
    stem = f"chosen-live18-l{n}"
    titled, bare = load("group-g15", stem, 36), load("group-g15+nolabels", stem, 18)
    entry = rulings.get(f"l{n}"); ruling = None
    if entry:
        ruling, _ = rtr.carry(rtr.ruling_for(entry), source=rtr.subtopic_starts(entry["division"]), target=rtr.subtopic_starts(stem))
    a, b = chosen(titled[:18]), chosen(bare)
    m = lambda g: ("right" if rtr.matches(g, ruling) else "wrong") if ruling else "unruled"
    ts, bs = collections.Counter(s for g in titled for s in g), collections.Counter(s for g in bare for s in g)
    diffs = ", ".join(f"{s} (titled {ts[s]}/36, bare {bs[s]}/18)" for s in sorted(a ^ b)) or "none"
    print(f"| l{n} | {m(a)} | {m(b)} | {diffs} |")
    contested = [(s, bs[s]) for s in sorted(bs) if 4 <= bs[s] <= 14]
    if contested: print(f"|  | | contested without titles: {contested} | |")
