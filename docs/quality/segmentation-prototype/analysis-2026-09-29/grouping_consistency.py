"""g15 on the live chosen divisions: how steady the grouping nearest a 9-of-18 vote is, and how it compares with the rulings."""
import collections, importlib.util, json, os, random, sys
sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("rtr", "report-topic-rulings.py")
rtr = importlib.util.module_from_spec(spec); spec.loader.exec_module(rtr)
from division_support import RUNS, closest_to_vote_run
S = sys.argv[1]
PREFIX = sys.argv[2] if len(sys.argv) > 2 else "group-g15"
rulings = json.load(open(os.path.join(RUNS, "topic-rulings.json")))
DRAWS, BAR = 4000, 9

def chosen(sets, panel):
    counts = collections.Counter(s for r in panel for s in sets[r])
    voted = frozenset(s for s, c in counts.items() if c >= BAR)
    return sets[closest_to_vote_run(sets, panel, voted)]

page = []
print("| lecture | runs | two panels hand on the same grouping | topic starts they differ on | chosen grouping matches ruling |")
print("|---|---|---|---|---|")
for n in [int(x) for x in (sys.argv[3] if len(sys.argv) > 3 else "12345678")]:
    stem = f"chosen-live18-l{n}"
    outcomes = []
    for i in range(1, 37):
        o = json.load(open(os.path.join(RUNS, f"{PREFIX}-{stem}-{i}.outcome.json")))
        assert o.get("verdict") == "OK", (n, i, o.get("verdict"))
        outcomes.append(o)
    sets = [rtr.topic_starts(o["topicSizes"]) for o in outcomes]
    entry = rulings.get(f"l{n}"); ruling = None
    if entry:
        ruling, lost = rtr.carry(rtr.ruling_for(entry), source=rtr.subtopic_starts(entry["division"]), target=rtr.subtopic_starts(stem))
    random.seed(n); same = diff = right = 0
    for _ in range(DRAWS):
        order = random.sample(range(36), 36)
        a, b = chosen(sets, order[:18]), chosen(sets, order[18:])
        same += a == b; diff += len(a ^ b)
        if ruling: right += rtr.matches(a, ruling)
    support = collections.Counter(s for g in sets for s in g)
    first = chosen(sets, tuple(range(18)))
    run = next(i for i in range(18) if sets[i] == first)
    blocks = json.load(open(os.path.join(RUNS, f"{stem}.blocks.json")))["blocks"]
    grouped = json.load(open(os.path.join(RUNS, f"{PREFIX}-{stem}-{run + 1}.blocks.json")))["blocks"]
    print(f"| l{n} | 36 | {same / DRAWS:.0%} | {diff / DRAWS:.2f} | {f'{right / DRAWS:.0%}' if ruling else 'unruled'} |")
    page.append({"lecture": n, "blocks": blocks, "chosenRun": run + 1, "starts": sorted(first),
                 "support": {str(s): c for s, c in support.items()},
                 "topicTitles": [b["topicLabel"] for b in grouped if b["opensTopic"]],
                 "ruledStarts": sorted(ruling.starts) if ruling else None,
                 "ruledEither": sorted(ruling.either.union(*ruling.one_of)) if ruling else None,
                 "same": same / DRAWS, "diff": diff / DRAWS, "right": right / DRAWS if ruling else None})
json.dump(page, open(f"{S}/{PREFIX}.json", "w"), ensure_ascii=False)
