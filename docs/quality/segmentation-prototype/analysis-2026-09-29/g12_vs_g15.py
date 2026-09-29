"""g12 runs 1-18 against g15's 18, on each lecture's closest-run d13 division."""
import collections, importlib.util, json, os, sys
sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("rtr", "report-topic-rulings.py")
rtr = importlib.util.module_from_spec(spec); spec.loader.exec_module(rtr)
from division_support import RUNS, closest_to_vote_run
rulings = json.load(open(os.path.join(RUNS, "topic-rulings.json")))

def runs(prompt, stem):
    return [rtr.topic_starts(json.load(open(os.path.join(RUNS, f"group-{prompt}-{stem}-{i}.outcome.json")))["topicSizes"]) for i in range(1, 19)]

def closest(sets, bar):
    c = collections.Counter(s for g in sets for s in g)
    return sets[closest_to_vote_run(sets, range(len(sets)), frozenset(s for s, n in c.items() if n >= bar))]

for lec in rtr.LECTURES:
    stem = rtr.voted_division("closest-d13", lec)
    titles = [b["label"] for b in json.load(open(os.path.join(RUNS, f"{stem}.blocks.json")))["blocks"]]
    entry = rulings.get(lec); ruling = None
    if entry:
        ruling, _ = rtr.carry(rtr.ruling_for(entry), source=rtr.subtopic_starts(entry["division"]), target=rtr.subtopic_starts(stem))
    a, b = runs("g12", stem), runs("g15", stem)
    ca, cb = collections.Counter(s for g in a for s in g), collections.Counter(s for g in b for s in g)
    changed = sorted(s for s in set(ca) | set(cb) if abs(ca[s] - cb[s]) >= 3)
    ga, gb = closest(a, 9), closest(b, 9)
    m = lambda sets: f"{sum(rtr.matches(g, ruling) for g in sets)}/18" if ruling else "unruled"
    mc = lambda g: ("right" if rtr.matches(g, ruling) else "wrong") if ruling else "-"
    print(f"== {lec}: match ruling g12 {m(a)} -> g15 {m(b)}; closest-to-9/18 grouping g12 {mc(ga)} -> g15 {mc(gb)}; same grouping chosen: {ga == gb}")
    for s in changed:
        print(f"   subtopic {s} '{titles[s-1][:70]}': g12 {ca[s]}/18 -> g15 {cb[s]}/18")
