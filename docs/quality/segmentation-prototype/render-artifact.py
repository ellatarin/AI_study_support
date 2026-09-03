"""Build a reviewable page from a set of grouping runs.

One page holding every run in the set: tabs to switch reading, a topic-size strip
so the shape is visible before reading, a contents rail, and the whole transcript
under its topic and subtopic headings. The verdict on each run is read from
runs/criteria.json rather than restated here, so the page cannot disagree with
the ledger.

Usage:
  python3 render-artifact.py "<glob>" "<title>" "<subtitle>" <out.html>
e.g.
  python3 render-artifact.py "group-g4-*.blocks.json" "g4 Grouping Trials" \\
      "Causes of Cancer and Environmental Carcinogenesis" /tmp/g4.html
"""

import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "runs")
TEMPLATE = os.path.join(HERE, "artifact-template.html")

CRITERIA = [
    ("pathogensSeparate", "pathogens a separate topic"),
    ("promotionOwnTopic", "promotion its own topic"),
    ("uvOwnSubtopic", "UV its own subtopic"),
    ("animalVsAmes", "in vivo vs Ames separate"),
    ("preambleSeparate", "preamble separated"),
]

FOOTER = (
    "Pass 1 cut the transcript into subtopics with the v3 prompt on Gemini 3.7 Flash. "
    "Pass 2 grouped those subtopics into topics in a separate call, with the subtopic "
    "labels withheld. Every word below is the transcript, sliced and not rewritten; "
    "the labels are pass 1's, restored after the grouping came back."
)


def verdict_for(scores):
    """The run's standing against the five criteria, and what failed."""
    if scores is None:
        return "unscored", "Not yet judged against the five criteria."
    failed = [label for key, label in CRITERIA if not scores[key]]
    if not failed:
        return "all five", "Meets every criterion."
    return f"{5 - len(failed)} of five", "Misses " + ", ".join(failed) + "."


def main():
    pattern, title, subtitle, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    scores = json.load(open(os.path.join(RUNS, "criteria.json")))
    runs = []
    # Comma-separated so a set that is not one glob — two specific runs, say —
    # can still be published as one page.
    paths = sorted({q for one in pattern.split(",")
                    for q in glob.glob(os.path.join(RUNS, one.strip()))})
    for path in paths:
        blocks = json.load(open(path))
        stem = os.path.basename(path).rsplit(".blocks.json", 1)[0]
        parts = stem.split("-")
        key = f"{parts[-2]}·{parts[-1]}"
        verdict, note = verdict_for(scores.get(stem))
        topics, seen = [], None
        for block in blocks["blocks"]:
            if block["topicLabel"] != seen:
                seen = block["topicLabel"]
                topics.append({"label": seen, "why": block.get("topicWhy", ""), "subtopics": []})
            topics[-1]["subtopics"].append({"label": block["label"], "text": block["content"].strip()})
        runs.append({
            "key": key, "source": blocks["sourceRun"], "seconds": blocks["seconds"],
            "sizes": blocks["topicSizes"], "subtopics": blocks["subtopics"],
            "verdict": verdict, "note": note, "topics": topics,
        })

    page = open(TEMPLATE).read()
    page = page.replace("__TITLE__", title).replace("__SUBTITLE__", subtitle)
    # JSON-encoded: the footer is injected into a JavaScript string literal and
    # contains an apostrophe, which would otherwise terminate it.
    page = page.replace("'__FOOTER__'", json.dumps(FOOTER))
    page = page.replace("__RUNS__", json.dumps(runs, ensure_ascii=False).replace("</", "<\\/"))
    open(out, "w").write(page)
    print(f"{out}  {len(runs)} runs  {len(page)//1024}KB")


if __name__ == "__main__":
    main()
