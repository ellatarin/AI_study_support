"""The division each source's 18 runs would hand on (run nearest the 9-of-18 vote), live against prototype."""
import glob, json, os, sys
sys.path.insert(0, ".")
from division_support import closest_to_vote_run, cut_sites_with_runs, site_sets, survives
S = sys.argv[1]
WS = "/Users/ellatarin/Lecture Notes/Biology of Disease/Pipeline processing"
BAR, N = 9, 18
def choose(runs_pct):
    sites = cut_sites_with_runs(runs_pct)
    sets = site_sets(sites, N)
    panel = tuple(range(N)); full = (1 << N) - 1
    voted = frozenset(i for i, (_, m) in enumerate(sites) if survives(m, full, BAR))
    run = closest_to_vote_run(sets, panel, voted)
    return run, len(sets[run] ^ voted)
out = []
for n in range(1, 9):
    ws = glob.glob(os.path.join(WS, f"Lecture {n} - *"))[0]
    text = open(os.path.join(ws, "Transcript", "transcript.txt")).read().strip()
    L = len(text); tol = L / 100
    live = [json.load(open(f)) for f in sorted(glob.glob(os.path.join(ws, "Deepened subtopics", "run-*.json")))]
    live = [[{"start": s["start"], "title": s["title"], "inherited": s["titleInherited"]} for s in run] for run in live]
    proto = []
    for f in sorted(glob.glob(f"runs/deepen-d13-600-split-s6-l{n}-*.blocks.json"), key=lambda p: int(p.rsplit("-", 1)[1].split(".")[0])):
        blocks, pos, run = json.load(open(f))["blocks"], 0, []
        for b in blocks:
            run.append({"start": pos, "title": b["label"], "inherited": None}); pos += len(b["content"])
        assert pos == L, (n, pos, L)
        proto.append(run)
    assert len(live) == N and len(proto) == N
    pct = lambda runs: [[s["start"] / L * 100 for s in run[1:]] for run in runs]
    (lrun, ldist), (prun, pdist) = choose(pct(live)), choose(pct(proto))
    support = lambda runs, pos: sum(any(abs(s["start"] - pos) < tol for s in run[1:]) for run in runs)
    lcuts, pcuts = live[lrun], proto[prun]
    cuts = []
    for s in lcuts[1:]:
        match = next((p for p in pcuts[1:] if abs(p["start"] - s["start"]) < tol), None)
        cuts.append({"pos": s["start"], "in": "both" if match else "live", "liveTitle": s["title"], "inherited": s["inherited"],
                     "protoTitle": match["title"] if match else None, "live": support(live, s["start"]), "proto": support(proto, s["start"])})
    for p in pcuts[1:]:
        if not any(abs(p["start"] - s["start"]) < tol for s in lcuts[1:]):
            cuts.append({"pos": p["start"], "in": "proto", "liveTitle": None, "inherited": None, "protoTitle": p["title"],
                         "live": support(live, p["start"]), "proto": support(proto, p["start"])})
    cuts.sort(key=lambda c: c["pos"])
    # A chosen run can cut twice inside one cut site; the comparison above counts that as one cut.
    doubled = lambda run: [(round(a["start"] / L * 100, 1), round(b["start"] / L * 100, 1))
                           for a, b in zip(run[1:], run[2:]) if b["start"] - a["start"] < tol]
    close = {"live": doubled(lcuts), "proto": doubled(pcuts)}
    for c in cuts: c["pct"] = round(c["pos"] / L * 100, 1)
    out.append({"lecture": n, "name": os.path.basename(ws).rsplit(" - ", 1)[0], "text": text,
                "firstLiveTitle": lcuts[0]["title"], "firstProtoTitle": pcuts[0]["title"],
                "liveRun": lrun + 1, "liveDistance": ldist, "protoRun": prun + 1, "protoDistance": pdist,
                "liveCount": len(lcuts), "protoCount": len(pcuts), "cuts": cuts, "close": close})
    print(f"l{n}: live run {lrun+1} (dist {ldist}) {len(lcuts)} subtopics; proto run {prun+1} (dist {pdist}) {len(pcuts)}; "
          f"both {sum(c['in']=='both' for c in cuts)}, live only {[c['pct'] for c in cuts if c['in']=='live']}, proto only {[c['pct'] for c in cuts if c['in']=='proto']}")
json.dump(out, open(f"{S}/chosen.json", "w"), ensure_ascii=False)
