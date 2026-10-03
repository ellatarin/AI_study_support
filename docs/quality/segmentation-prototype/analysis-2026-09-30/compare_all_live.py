"""Compare every lecture's live retitle-subtopics + define-topics output with the prototype's r9 titles and g23 groupings.

Usage: python3 compare_all_live.py <module's Pipeline processing folder>
Writes LIVE-ALL-LECTURES.md in the prototype folder: a summary table, then each lecture's comparison.
"""

import re
import sys
from pathlib import Path

from compare_live_grouping import compare
from score_groupings import RUNS


def workspaces(processing: Path) -> dict[str, Path]:
    """Each lecture's workspace, keyed `l<number>` as the prototype's run files are."""
    found = {}
    for folder in processing.iterdir():
        matched = re.match(r"Lecture (\d+)\b", folder.name)
        if matched:
            found[f"l{matched[1]}"] = folder
    return dict(sorted(found.items(), key=lambda item: int(item[0][1:])))


def main() -> None:
    lectures = workspaces(Path(sys.argv[1]))
    summary_rows, sections = [], []
    for lecture, workspace in lectures.items():
        lines, s = compare(lecture, workspace)
        summary_rows.append(
            f"| {lecture} | {s['subtopics']} | {s['exactTitles']} | {s['titleOverlap']:.2f} | {','.join(map(str, s['liveStarts']))} | "
            f"{','.join(map(str, s['protoStarts']))} | {s['apart']} | {s['support']} | {s['liveGroupings']} | "
            f"{s['liveAgainstRulings'].replace(' | ', ' / ')} | {s['protoAgainstRulings'].replace(' | ', ' / ')} |"
        )
        sections += ["", *[("#" + line if line.startswith("#") else line) for line in lines]]
    report = [
        "# Live retitling and grouping, every lecture, against the prototype",
        "",
        "Live: `retitle-subtopics` then `define-topics` (panel of 9, bar 5), 3 October 2026. Prototype: the `r9` titles and the grouping"
        " `choose_panel.py` chooses from `g23` Sol Pro runs 1–4 (30 September), on the same divisions.",
        "\"Apart\" counts topic starts one chosen grouping has and the other does not. Rulings columns read matches / missed / against; — where the lecture has no rulings.",
        "",
        "| Lecture | Subtopics | Titles identical | Title word overlap | Live topic starts | Prototype topic starts | Apart | Live support | Live groupings | Live vs rulings | Prototype vs rulings |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
        *summary_rows,
        *sections,
        "",
    ]
    (RUNS.parent / "LIVE-ALL-LECTURES.md").write_text("\n".join(report))
    print("\n".join(report[:len(summary_rows) + 7]))


if __name__ == "__main__":
    main()
