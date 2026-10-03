"""Compare a live retitle-subtopics + define-topics run with the prototype's r9 titles and g23 groupings.

Usage: python3 compare_live_grouping.py <lecture> <workspace folder>
Writes LIVE-GROUPING-<lecture>.md in the prototype folder.
"""

import json
import re
import sys
from pathlib import Path

from choose_panel import choose
from score_groupings import RUNS, border_rules, read, run_starts

PROTOTYPE_PANEL = 4
PROTOTYPE_RUNS_SAVED = 5


def words(title: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", title.lower()))


def word_overlap(one: str, other: str) -> float:
    """Shared words over all words used by either title (Jaccard), ignoring case."""
    a, b = words(one), words(other)
    return len(a & b) / len(a | b) if a | b else 1.0


def starts_of(topics: list[dict]) -> list[int]:
    return [t["firstSubtopicId"] for t in topics]


def apart(one: list[int], other: list[int]) -> int:
    """Topic starts one grouping has and the other does not."""
    return len(set(one) ^ set(other))


def against_rulings(starts: list[int], rules: dict, expected: list[int], set_aside: set[int]) -> str:
    if all(r == "unruled" for r in rules.values()):
        return "— | — | —"
    missed = [s for s in expected if s not in starts]
    wrong = [s for s in starts if s > 1 and s not in set_aside and rules[s] == "not"]
    exact = "yes" if not missed and not wrong else "no"
    return f"{exact} | {','.join(map(str, missed)) or '-'} | {','.join(map(str, wrong)) or '-'}"


def compare(lecture: str, workspace: Path) -> tuple[list[str], dict]:
    """The report's lines for one lecture, and the figures a summary across lectures needs."""
    live_titles = [s["title"] for s in json.loads((workspace / "Retitled subtopics" / "subtopics.json").read_text())]
    proto_titles = [b["label"] for b in read(f"chosen-live18-rt9-{lecture}.blocks.json")["blocks"]]
    old_titles = [b["label"] for b in read(f"chosen-live18-{lecture}.blocks.json")["blocks"]]

    live_runs = [json.loads(p.read_text())["topics"] for p in sorted((workspace / "Grouping runs").glob("run-*.json"))]
    choice = json.loads((workspace / "Topics" / "choice.json").read_text())
    live_topics = json.loads((workspace / "Topics" / "topics.json").read_text())
    live_chosen = starts_of(live_topics["topics"] if isinstance(live_topics, dict) else live_topics)

    proto_all = run_starts(version="g23", lecture=lecture, model_tag="@gpt-6.1-sol-pro", source="chosen-live18-rt9", runs=PROTOTYPE_RUNS_SAVED)
    proto_panel = [(n, s) for n, s in enumerate(proto_all[:PROTOTYPE_PANEL], 1) if s is not None]
    proto_choice = choose(proto_panel)
    proto_chosen = proto_choice["chosen"]
    proto_chosen_topics = json.loads((RUNS / f"group-g23@gpt-6.1-sol-pro-chosen-live18-rt9-{lecture}-{proto_choice['from'][0]}.raw.json").read_text())["topics"]

    ruled = border_rules(lecture)
    rules = ruled["rules"]
    expected = [s for s, r in rules.items() if r == "start"]
    set_aside = {22} if lecture == "l4" else set()

    exact_titles = sum(a == b for a, b in zip(live_titles, proto_titles))
    overlaps = [word_overlap(a, b) for a, b in zip(live_titles, proto_titles)]
    old_overlaps = [word_overlap(a, b) for a, b in zip(old_titles, proto_titles)]
    shared_starts = sorted(set(live_chosen) & set(proto_chosen))
    out = [
        f"# Live run against the prototype: {lecture}",
        "",
        "## Subtopic titles",
        "",
        f"{len(live_titles)} subtopics. The live run gave {exact_titles} the same title as the prototype's `r9` run.",
        f"Word overlap (shared words ÷ all words used by either title): mean {sum(overlaps) / len(overlaps):.2f}. "
        f"For scale, the titles before retitling overlap the prototype's by {sum(old_overlaps) / len(old_overlaps):.2f}.",
        "",
        "| # | Before retitling | Live | Prototype `r9` | Overlap |",
        "|---|---|---|---|---|",
        *[f"| {i} | {o} | {a} | {b} | {v:.2f} |" for i, (o, a, b, v) in enumerate(zip(old_titles, live_titles, proto_titles, overlaps), 1)],
        "",
        "## Grouping",
        "",
        f"Live choice: run {choice['chosenRun']}, made by {choice['support']} of {choice['panelSize']} runs, decided by {choice['decidedBy']}.",
        f"Prototype choice (runs 1–{PROTOTYPE_PANEL}): run {proto_choice['from'][0]}, {proto_choice['by']}.",
        "",
        f"- Live chosen starts: {','.join(map(str, live_chosen))} ({len(live_chosen)} topics)",
        f"- Prototype chosen starts: {','.join(map(str, proto_chosen))} ({len(proto_chosen)} topics)",
        f"- Shared starts: {len(shared_starts)}; starts one has and the other does not: {apart(live_chosen, proto_chosen)}",
        f"- Ruled topic starts: {','.join(map(str, expected))}" + (" (22 set aside, as in score_groupings.py)" if set_aside else ""),
        "",
        "Every run, live and prototype. \"Apart\" counts topic starts the run has and the prototype's choice does not, or the reverse.",
        "",
        "| Run | Topic starts | Topics | Apart from prototype choice | Matches rulings | Missed | Against ruling |",
        "|---|---|---|---|---|---|---|",
        *[
            f"| live {n} | {','.join(map(str, starts_of(t)))} | {len(t)} | {apart(starts_of(t), proto_chosen)} | {against_rulings(starts_of(t), rules, expected, set_aside)} |"
            for n, t in enumerate(live_runs, 1)
        ],
        *[
            f"| prototype {n} | {','.join(map(str, s))} | {len(s)} | {apart(s, proto_chosen)} | {against_rulings(s, rules, expected, set_aside)} |"
            for n, s in enumerate(proto_all, 1)
            if s is not None
        ],
        "",
        "## Topic titles where both choices start a topic",
        "",
        "| Starts at | Live | Prototype | Overlap |",
        "|---|---|---|---|",
    ]
    proto_by_start = {t["firstSubtopicId"]: t["label"] for t in proto_chosen_topics}
    live_list = live_topics["topics"] if isinstance(live_topics, dict) else live_topics
    for t in live_list:
        start = t["firstSubtopicId"]
        if start in proto_by_start:
            out.append(f"| {start} | {t['title']} | {proto_by_start[start]} | {word_overlap(t['title'], proto_by_start[start]):.2f} |")
    summary = {
        "subtopics": len(live_titles),
        "exactTitles": exact_titles,
        "titleOverlap": sum(overlaps) / len(overlaps),
        "liveStarts": live_chosen,
        "protoStarts": proto_chosen,
        "apart": apart(live_chosen, proto_chosen),
        "support": f"{choice['support']} of {choice['panelSize']}",
        "liveGroupings": len({tuple(starts_of(t)) for t in live_runs}),
        "liveAgainstRulings": against_rulings(live_chosen, rules, expected, set_aside),
        "protoAgainstRulings": against_rulings(proto_chosen, rules, expected, set_aside),
    }
    return out, summary


def main() -> None:
    lecture, workspace = sys.argv[1], Path(sys.argv[2])
    out, _ = compare(lecture, workspace)
    report = "\n".join(out) + "\n"
    (RUNS.parent / f"LIVE-GROUPING-{lecture.upper()}.md").write_text(report)
    print(report)


if __name__ == "__main__":
    main()
