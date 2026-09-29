"""g15 x18 on the closest-run d13 division (splitter titles) against g15 x18 on the same division with r3 titles."""
import collections, importlib.util, json, os, sys
sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("rtr", "report-topic-rulings.py")
rtr = importlib.util.module_from_spec(spec); spec.loader.exec_module(rtr)
from division_support import RUNS, closest_to_vote_run
rulings = json.load(open(os.path.join(RUNS, "topic-rulings.json")))

def runs(stem):
    out = []
    for i in range(1, 19):
        o = json.load(open(os.path.join(RUNS, f"group-g15-{stem}-{i}.outcome.json")))
        assert o.get("verdict") == "OK", (stem, i, o.get("verdict"))
        out.append(rtr.topic_starts(o["topicSizes"]))
    return out

def closest(sets, bar):
    c = collections.Counter(s for g in sets for s in g)
    return sets[closest_to_vote_run(sets, range(len(sets)), frozenset(s for s, n in c.items() if n >= bar))]

for lec in rtr.LECTURES:
    old, new = f"closest-d13-{lec}-r1to9-k5", f"closest-rt3-d13-{lec}-r1to9-k5"
    titles = [b["label"] for b in json.load(open(os.path.join(RUNS, f"{new}.blocks.json")))["blocks"]]
    entry = rulings.get(lec); ruling = None
    if entry:
        ruling, _ = rtr.carry(rtr.ruling_for(entry), source=rtr.subtopic_starts(entry["division"]), target=rtr.subtopic_starts(old))
    a, b = runs(old), runs(new)
    ca, cb = collections.Counter(s for g in a for s in g), collections.Counter(s for g in b for s in g)
    changed = sorted(s for s in set(ca) | set(cb) if abs(ca[s] - cb[s]) >= 3)
    ga, gb = closest(a, 9), closest(b, 9)
    m = lambda sets: f"{sum(rtr.matches(g, ruling) for g in sets)}/18" if ruling else "unruled"
    mc = lambda g: ("right" if rtr.matches(g, ruling) else "WRONG") if ruling else "-"
    print(f"== {lec}: runs matching ruling {m(a)} -> {m(b)}; chosen grouping {mc(ga)} -> {mc(gb)}; same chosen grouping: {ga == gb}")
    if ga != gb:
        print(f"   starts old {sorted(ga)}\n   starts new {sorted(gb)}")
    for s in changed:
        print(f"   subtopic {s} '{titles[s-1][:70]}': {ca[s]}/18 -> {cb[s]}/18")
