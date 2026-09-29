"""Build a full-text grouping review page from closest_grouping_data.py's output.

Optionally swaps in a retitle version's titles, keeping the old title (and an
earlier retitle version's) for comparison, and hides the subtopic title of a
topic that has only one subtopic.

Run from the prototype folder:
  python3 analysis-2026-09-29/closest_grouping_data.py <out-dir> 9 18 g15
  python3 analysis-2026-09-29/build_page.py <out-dir>/closest_grouping_g15_9of18.json <page.html> \
      --bar 9 --panel 18 --prompt g15 [--retitle r3 [--prior r2]] [--hide-lone]
"""

import argparse
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "..", "runs")


def retitles(version, lecture):
    """A retitle version's new titles for one lecture's chosen division, by subtopic id."""
    path = os.path.join(RUNS, f"retitle-{version}-closest-d13-{lecture}-r1to9-k5.json")
    return {entry["id"]: entry["newTitle"] for entry in json.load(open(path))["retitled"]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("data")
    parser.add_argument("page")
    parser.add_argument("--bar", required=True)
    parser.add_argument("--panel", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--retitle")
    parser.add_argument("--prior")
    parser.add_argument("--hide-lone", action="store_true")
    args = parser.parse_args()

    lectures = json.load(open(args.data))
    if args.retitle:
        for lecture in lectures:
            new = retitles(args.retitle, lecture["key"])
            prior = retitles(args.prior, lecture["key"]) if args.prior else {}
            for topic in lecture["topics"]:
                for sub in topic["subtopics"]:
                    if sub["id"] in new:
                        sub["oldTitle"], sub["title"] = sub["title"], new[sub["id"]]
                        if sub["id"] in prior:
                            sub["priorRetitle"] = {"version": args.prior, "title": prior[sub["id"]]}

    template = open(os.path.join(HERE, "closest-groupings.template.html")).read()
    title = f"{args.prompt} Groupings {args.bar}/{args.panel}" + (" Retitled" if args.retitle else "")
    page = (
        template.replace("__DATA__", json.dumps(lectures).replace("</", "<\\/"))
        .replace("__BAR__", args.bar)
        .replace("__PANEL__", args.panel)
        .replace("__PROMPT__", args.prompt)
        .replace("__HIDE_LONE__", "true" if args.hide_lone else "false")
        .replace("__TITLE__", title)
    )
    open(args.page, "w").write(page)


if __name__ == "__main__":
    main()
