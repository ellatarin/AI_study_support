"""The grouping closest to the bar/panel vote of a prompt's first runs, on each lecture's closest-run division, with full text.

Usage: python3 closest_grouping_data.py <out-dir> <bar> <panel-size> <prompt>
"""
import collections, importlib.util, json, os, sys
sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("rtr", "report-topic-rulings.py")
rtr = importlib.util.module_from_spec(spec); spec.loader.exec_module(rtr)
from division_support import RUNS, closest_to_vote_run

BAR, PANEL, PROMPT = int(sys.argv[2]), range(1, int(sys.argv[3]) + 1), sys.argv[4]
rulings = json.load(open(os.path.join(RUNS, "topic-rulings.json")))
out = []
for lec in rtr.LECTURES:
    stem = rtr.voted_division("closest-d13", lec)
    division = json.load(open(os.path.join(RUNS, f"{stem}.blocks.json")))
    runs = [json.load(open(os.path.join(RUNS, f"group-{PROMPT}-{stem}-{i}.blocks.json"))) for i in PANEL]
    sets = [frozenset(n for n, b in enumerate(r["blocks"], 1) if b["opensTopic"]) - {1} for r in runs]
    counts = collections.Counter(s for g in sets for s in g)
    voted = frozenset(s for s, n in counts.items() if n >= BAR)
    chosen = closest_to_vote_run(sets, range(len(sets)), voted)
    starts = rtr.subtopic_starts(stem)
    entry = rulings.get(lec)
    verdict = None
    if entry:
        ruling, _ = rtr.carry(rtr.ruling_for(entry), source=rtr.subtopic_starts(entry["division"]), target=starts)
        verdict = {"matches": rtr.matches(sets[chosen], ruling), "ruled": sorted(ruling.starts), "either": sorted(ruling.either)}
    topics = []
    for n, b in enumerate(runs[chosen]["blocks"], 1):
        if b["opensTopic"]:
            topics.append({"title": b["topicLabel"], "why": b["topicWhy"], "subtopics": []})
        topics[-1]["subtopics"].append({"id": n, "pos": round(starts[n - 1], 1), "title": b["label"], "text": b["content"].strip()})
    name = division["transcriptPath"].split("/")[-3]
    out.append({"key": lec, "name": name.split(" - ")[1].removesuffix(" on"), "number": name.split(" - ")[0],
                "divisionRun": division["chosenRun"].split("-")[-1].split(".")[0], "groupingRun": list(PANEL)[chosen],
                "distanceFromVote": len(sets[chosen] ^ voted), "support": {str(k): v for k, v in counts.items()},
                "verdict": verdict, "topics": topics})
    print(lec, "grouping run", list(PANEL)[chosen], "distance", len(sets[chosen] ^ voted), "topics", len(topics), verdict and verdict["matches"])
json.dump(out, open(os.path.join(sys.argv[1], f"closest_grouping_{PROMPT}_{BAR}of{len(PANEL)}.json"), "w"))
