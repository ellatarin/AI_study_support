"""Render the hierarchical runs for comparison.

Two views. The matrix puts every distinct cut position the runs used down the
page, one column per run, marking whether that run treated the position as a
topic boundary, a subtopic boundary, or nothing — so disagreement about RANK
shows up separately from disagreement about POSITION. Below it, each run's
outline, for reading how the labels were worded.
"""

import glob
import html
import json
import os
import re
import sys

SCRATCH = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(SCRATCH, "failure-trial")
PATTERN = sys.argv[1] if len(sys.argv) > 1 else "hier-h*.blocks.json"
OUT = os.path.join(SCRATCH, "review", sys.argv[2] if len(sys.argv) > 2 else "hierarchy.html")
NEAR = 120  # cut positions within this many characters are the same seam

CSS = """
:root{--bg:#fbfaf8;--fg:#1b1a17;--muted:#6d6a63;--rule:#e3ded5;--card:#fff;
  --topic:#8a4b1f;--topic-bg:#f8ece1;--sub:#4a6b7c;--sub-bg:#e9f0f4;--accent:#8a5a2b}
@media (prefers-color-scheme:dark){:root{--bg:#14130f;--fg:#eceae4;--muted:#a09c92;
  --rule:#33302a;--card:#1c1b16;--topic:#e0975c;--topic-bg:#2b1d12;--sub:#8fb4c7;
  --sub-bg:#16232b;--accent:#d9a066}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
  font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Georgia,serif}
.wrap{max-width:72rem;margin:0 auto;padding:2.5rem 1.5rem 6rem}
h1{font-size:1.4rem;margin:0 0 .3rem}
h2{font-size:1rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);
  margin:3rem 0 1rem;font-weight:600}
.meta{color:var(--muted);font-size:.9rem;margin-bottom:1.5rem}
table{width:100%;border-collapse:collapse;font-size:.88rem}
th{text-align:center;font-weight:600;color:var(--muted);font-size:.8rem;
  padding:.4rem .2rem;border-bottom:2px solid var(--rule)}
th.q{text-align:left;width:auto}
td{padding:.3rem .2rem;border-bottom:1px solid var(--rule);text-align:center;
  font-variant-numeric:tabular-nums}
td.q{text-align:left;color:var(--muted);font-size:.85rem;padding-right:1rem}
td.q b{color:var(--fg);font-weight:600}
.mark{display:inline-block;width:1.1rem;height:1.1rem;line-height:1.1rem;border-radius:3px;
  font-size:.7rem;font-weight:700}
.mark.t{background:var(--topic-bg);color:var(--topic);border:1px solid var(--topic)}
.mark.s{background:var(--sub-bg);color:var(--sub)}
.legend{font-size:.85rem;color:var(--muted);margin:.8rem 0 0}
.outline{background:var(--card);border:1px solid var(--rule);border-radius:8px;
  padding:1rem 1.25rem;margin:0 0 1rem}
.outline h3{margin:0 0 .7rem;font-size:1rem}
.t-row{margin:.7rem 0 .2rem;color:var(--topic);font-weight:600}
.s-row{margin:.1rem 0 .1rem 1.6rem;color:var(--fg);font-size:.9rem}
.s-row .w{color:var(--muted);font-size:.82rem}
"""


def load():
    runs = {}
    for path in sorted(glob.glob(os.path.join(SRC_DIR, PATTERN))):
        name = os.path.basename(path).replace(".blocks.json", "").replace("hier-", "")
        data = json.load(open(path))
        at, rows = 0, []
        for b in data["blocks"]:
            rows.append({"offset": at, "label": b["label"], "topic": b.get("topicLabel", ""),
                         "opens": bool(b.get("opensTopic")), "content": b["content"]})
            at += len(b["content"])
        runs[name] = rows
    return runs


def main():
    runs = load()
    names = list(runs)
    text = "".join(b["content"] for b in next(iter(runs.values())))

    # Cluster near-identical offsets: a seam one short sentence apart is the same seam.
    every = sorted({r["offset"] for rows in runs.values() for r in rows if r["offset"] > 0})
    seams, current = [], []
    for off in every:
        if current and off - current[-1] > NEAR:
            seams.append(current)
            current = []
        current.append(off)
    if current:
        seams.append(current)

    out = ["<!doctype html><html><head><meta charset='utf-8'>",
           "<meta name='viewport' content='width=device-width,initial-scale=1'>",
           f"<title>Hierarchical runs</title><style>{CSS}</style></head><body><div class='wrap'>",
           "<h1>Hierarchical block splits &mdash; six runs of one transcript</h1>",
           f"<div class='meta'>{len(names)} runs, "
           f"topics {min(sum(r['opens'] for r in v) for v in runs.values())}&ndash;"
           f"{max(sum(r['opens'] for r in v) for v in runs.values())}, "
           f"subtopics {min(len(v) for v in runs.values())}&ndash;{max(len(v) for v in runs.values())}."
           "</div>",
           "<h2>Where each run cut, and at what rank</h2>",
           "<table><tr><th class='q'>seam &mdash; the words it falls before</th>"
           + "".join(f"<th>{html.escape(n)}</th>" for n in names) + "</tr>"]

    for group in seams:
        lo = group[0]
        snippet = " ".join(re.split(r"\s+", text[lo:lo + 90].strip())[:11])
        cells = []
        for n in names:
            rank = ""
            for r in runs[n]:
                if any(abs(r["offset"] - g) <= NEAR for g in group) and r["offset"] > 0:
                    rank = "t" if r["opens"] else "s"
                    break
            cells.append(
                f"<td>{f'<span class=mark {rank}>{rank.upper()}</span>' if rank else ''}</td>")
        out.append(f"<tr><td class='q'>{html.escape(snippet)}&hellip;</td>{''.join(cells)}</tr>")
    out.append("</table>")
    out.append("<div class='legend'><span class='mark t'>T</span> topic boundary "
               "&nbsp;&nbsp;<span class='mark s'>S</span> subtopic boundary &nbsp;&nbsp; "
               f"blank means that run made no cut there. Offsets within {NEAR} characters "
               "are treated as the same seam.</div>")

    out.append("<h2>Outlines</h2>")
    for n in names:
        rows = runs[n]
        out.append(f"<div class='outline'><h3>{html.escape(n)} &mdash; "
                   f"{sum(r['opens'] for r in rows)} topics, {len(rows)} subtopics</h3>")
        for r in rows:
            if r["opens"]:
                out.append(f"<div class='t-row'>{html.escape(r['topic'] or '(no label)')}</div>")
            words = len([w for w in re.split(r"\s+", r["content"]) if w])
            out.append(f"<div class='s-row'>{html.escape(r['label'] or '(no label)')} "
                       f"<span class='w'>&middot; {words:,}w</span></div>")
        out.append("</div>")

    out.append("</div></body></html>")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        fh.write("".join(out))
    print(OUT)


main()
