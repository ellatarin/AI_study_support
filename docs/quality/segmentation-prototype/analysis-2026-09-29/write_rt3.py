"""Write closest-rt3-d13-lN-r1to9-k5.blocks.json: the closest-run d13 division with r3's titles swapped in."""
import json, os
RUNS = "runs"
for n in range(1, 9):
    division = json.load(open(os.path.join(RUNS, f"closest-d13-l{n}-r1to9-k5.blocks.json")))
    retitle = json.load(open(os.path.join(RUNS, f"retitle-r3-closest-d13-l{n}-r1to9-k5.json")))
    for entry in retitle["retitled"]:
        block = division["blocks"][entry["id"] - 1]
        assert block["label"] == entry["oldTitle"]
        block["label"] = entry["newTitle"]
    division["retitledWith"] = "retitle-r3-closest-d13-l%d-r1to9-k5.json" % n
    json.dump(division, open(os.path.join(RUNS, f"closest-rt3-d13-l{n}-r1to9-k5.blocks.json"), "w"), indent=2, ensure_ascii=False)
    print(n, len(retitle["retitled"]), "retitled of", len(division["blocks"]))
