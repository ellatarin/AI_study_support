"""For bars 5-14 of 18: how often two panels of 18 hand on the same grouping, and how often it matches the rulings."""
import collections, importlib.util, json, os, random, sys
sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("rtr", "report-topic-rulings.py")
rtr = importlib.util.module_from_spec(spec); spec.loader.exec_module(rtr)
from division_support import RUNS, closest_to_vote_run
rulings = json.load(open(os.path.join(RUNS, "topic-rulings.json")))
DRAWS, BARS = 1500, range(5, 15)

def chosen(sets, panel, bar):
    counts = collections.Counter(s for r in panel for s in sets[r])
    return sets[closest_to_vote_run(sets, panel, frozenset(s for s, c in counts.items() if c >= bar))]

for prefix in ("group-g15", "group-g15+nolabels"):
    lectures = []
    for n in range(1, 9):
        stem = f"chosen-live18-l{n}"
        sets = []
        for i in range(1, 37):
            o = json.load(open(os.path.join(RUNS, f"{prefix}-{stem}-{i}.outcome.json")))
            assert o["verdict"] == "OK", (prefix, n, i)
            sets.append(rtr.topic_starts(o["topicSizes"]))
        entry = rulings.get(f"l{n}"); ruling = None
        if entry:
            ruling, _ = rtr.carry(rtr.ruling_for(entry), source=rtr.subtopic_starts(entry["division"]), target=rtr.subtopic_starts(stem))
        lectures.append((n, sets, ruling))
    print(f"\n{'WITH TITLES' if prefix == 'group-g15' else 'WITHOUT TITLES'}")
    print("| bar /18 | lectures where two panels agree (sum of shares, of 8) | topic starts two panels differ on, all lectures | ruled lectures right (sum of shares, of 5) | right per lecture l1 l3 l4 l5 l6 |")
    print("|---|---|---|---|---|")
    for bar in BARS:
        agree = diff = right = 0; per = []
        for n, sets, ruling in lectures:
            random.seed(n); s = d = r = 0
            for _ in range(DRAWS):
                order = random.sample(range(36), 36)
                a, b = chosen(sets, order[:18], bar), chosen(sets, order[18:], bar)
                s += a == b; d += len(a ^ b)
                if ruling: r += rtr.matches(a, ruling)
            agree += s / DRAWS; diff += d / DRAWS
            if ruling: right += r / DRAWS; per.append(f"{r / DRAWS:.0%}")
        print(f"| {bar} | {agree:.2f} | {diff:.2f} | {right:.2f} | {' '.join(per)} |")
