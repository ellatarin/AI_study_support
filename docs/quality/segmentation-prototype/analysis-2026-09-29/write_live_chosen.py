"""Write each lecture's live chosen division (run nearest the 9-of-18 vote) in the shape group-trial.mts reads."""
import glob, json, os, sys
S = sys.argv[1]
WS = "/Users/ellatarin/Lecture Notes/Biology of Disease/Pipeline processing"
for lec in json.load(open(f"{S}/chosen.json")):
    n = lec["lecture"]
    ws = glob.glob(os.path.join(WS, f"Lecture {n} - *"))[0]
    path = os.path.join(ws, "Transcript", "transcript.txt")
    text = open(path).read().strip()
    run = json.load(open(os.path.join(ws, "Deepened subtopics", f"run-{lec['liveRun']:02d}.json")))
    blocks = [{"label": s["title"], "why": s["why"], "content": text[s["start"]:s["end"]]} for s in run]
    assert "".join(b["content"] for b in blocks) == text
    json.dump({"lecture": f"l{n}", "transcriptPath": path, "chosenRun": f"live Deepened subtopics/run-{lec['liveRun']:02d}.json",
               "panelSize": 18, "bar": 9, "blocks": blocks},
              open(f"runs/chosen-live18-l{n}.blocks.json", "w"), ensure_ascii=False, indent=2)
    print(n, len(blocks))
