"""Grouping closest to the vote: panels of 18 (bars 8, 9) against panels of 9 (bar 5), from 36 runs per lecture.

Stability: random splits of the runs into two disjoint panels; share where both panels choose the
same topic starts, mean starts they disagree on, and how often each contested start flips.
Right: random panels; share whose chosen grouping matches the ruling exactly.
"""
import collections, importlib.util, json, os, random, sys
sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("rtr", "report-topic-rulings.py")
rtr = importlib.util.module_from_spec(spec); spec.loader.exec_module(rtr)
from division_support import RUNS, closest_to_vote_run

SAMPLES = 4000
CONFIGS = [(9, 5), (18, 7), (18, 8), (18, 9), (18, 10)]
rulings = json.load(open(os.path.join(RUNS, "topic-rulings.json")))
LECTURES = sys.argv[1].split(",")

def runs_of(stem):
    out = []
    for i in range(1, 37):
        d = json.load(open(os.path.join(RUNS, f"group-g12-{stem}-{i}.outcome.json")))
        if d["verdict"] != "OK": raise SystemExit(f"{stem} run {i}: {d['verdict'][:60]}")
        out.append(rtr.topic_starts(d["topicSizes"]))
    return out

def choose(sets, panel, bar):
    c = collections.Counter(s for r in panel for s in sets[r])
    return sets[closest_to_vote_run(sets, panel, frozenset(s for s, n in c.items() if n >= bar))]

rng = random.Random(1)
print("| lecture | " + " | ".join(f"closest {b}/{p}" for p, b in CONFIGS) + " |")
print("|---|" + "---|" * len(CONFIGS))
flips_all = {}
for lec in LECTURES:
    stem = rtr.voted_division("closest-d13", lec)
    sets = runs_of(stem)
    entry = rulings.get(lec); ruling = None
    if entry:
        ruling, _ = rtr.carry(rtr.ruling_for(entry), source=rtr.subtopic_starts(entry["division"]), target=rtr.subtopic_starts(stem))
    cells = []
    for size, bar in CONFIGS:
        same = diff = right = 0; flips = collections.Counter()
        for _ in range(SAMPLES):
            order = rng.sample(range(36), 2 * size) if size <= 18 else None
            a, b = order[:size], order[size:2 * size]
            ga, gb = choose(sets, a, bar), choose(sets, b, bar)
            same += ga == gb; diff += len(ga ^ gb); flips.update(ga ^ gb)
            if ruling: right += rtr.matches(ga, ruling)
        flips_all[(lec, size, bar)] = flips
        r = f"{right / SAMPLES:.0%} right, " if ruling else ""
        cells.append(f"{r}{same / SAMPLES:.0%} same, {diff / SAMPLES:.2f} differ")
    print(f"| {lec} | " + " | ".join(cells) + " |")
print()
for lec in LECTURES:
    sets = runs_of(rtr.voted_division("closest-d13", lec))
    support = collections.Counter(s for g in sets for s in g)
    for s in sorted(k for k, n in support.items() if n < 36):
        print(f"{lec} subtopic {s:2} ({support[s]:2}/36 start here): " + "  ".join(
            f"{b}/{p} flips {flips_all[(lec, p, b)][s] / SAMPLES:.0%}" for p, b in CONFIGS))
