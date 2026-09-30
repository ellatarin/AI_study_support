"""Build the lecture 4 contentious-borders page from the live division and the g15 runs.

Run from the prototype folder: `python3 analysis-2026-09-30/build_l4_borders.py <out.html>`.
The quoted cases for and against each border are copied by hand from the g21 and
j2 run files named beside them. Published 2026-09-30 as
https://claude.ai/artifact/85Be8sJrZELUieUZRzHySS.
"""
import collections, html, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "..", "runs")
subs = [
    {"id": i, "label": b["label"], "text": b["content"].strip()}
    for i, b in enumerate(json.load(open(os.path.join(RUNS, "chosen-live18-l4.blocks.json")))["blocks"], 1)
]
N = len(subs)
e = html.escape


def runs(prefix):
    out = []
    for i in range(1, 37):
        r = json.load(open(os.path.join(RUNS, f"{prefix}-chosen-live18-l4-{i}.raw.json")))
        ts = r["topics"]
        spans = []
        for k, t in enumerate(ts):
            a = t["firstSubtopicId"]
            b = ts[k + 1]["firstSubtopicId"] - 1 if k + 1 < len(ts) else N
            spans.append((a, b, t["label"]))
        out.append(spans)
    return out


titled, bare = runs("group-g15"), runs("group-g15+nolabels")
every = titled + bare
title_for = collections.defaultdict(collections.Counter)
for spans in every:
    for a, b, label in spans:
        title_for[(a, b)][label] += 1


def starts(spans):
    return {a for a, _, _ in spans}


def started(group, site):
    return sum(site in starts(s) for s in group)


def title(a, b):
    c = title_for.get((a, b))
    return c.most_common(1)[0][0] if c else ""


def span_count(a, b):
    return sum(title_for.get((a, b), {}).values())


def reading_counts(lo, hi):
    """How the 72 runs arrange the stretch lo..hi: starts inside it, counted."""
    c = collections.Counter()
    for s in every:
        c[tuple(sorted(x for x in starts(s) if lo < x <= hi))] += 1
    return c


SEAMS = {
    4: dict(
        name="Environmental exposures begin",
        ruling="Either", ruling_kind="either",
        ruling_note="You set 4 to either: a topic start or not, scored neither way.",
        case_for="Subtopic 4 moves away from the biological definitions of cancer and endogenous mutations to focus on real-world environmental hazards, public misconceptions, and epidemiological studies.",
        case_against="Subtopics 2 to 6 work together as an overarching introductory overview of cancer etiology and risk before detailed molecular mechanisms are addressed.",
        source="g21, resolving the mark at 4 (it decided no start)",
        stretch=(2, 6),
    ),
    9: dict(
        name="From infectious agents to diet and chemicals",
        ruling="Topic starts", ruling_kind="start",
        ruling_note="You ruled that a topic starts here.",
        case_for="Subtopic 9 turns away from viral and microbial pathogens to discuss foodstuffs, natural toxins, and chemical DNA adducts.",
        case_against="Dietary carcinogens are simply another category in the lecture's systematic survey of environmental causes of DNA damage and cancer.",
        source="g21, resolving the mark at 9 (it decided no start, as every judging design has)",
        stretch=(7, 17),
    ),
    14: dict(
        name="From mutagens to promoters",
        ruling="Topic starts", ruling_kind="start",
        ruling_note="You ruled that a topic starts here.",
        case_for="Subtopic 14 marks a key conceptual pivot from classical direct-acting mutagens and metabolically activated DNA-damaging agents to non-mutagenic mechanisms (promoters, chronic inflammation, and cellular context), which the lecturer explicitly highlighted as a separate learning outcome in the introduction (initiators vs. promoters).",
        case_against="Subtopics 7 through 17 form a continuous, cohesive survey exploring the different biological mechanisms by which environmental agents cause or facilitate cancer. … Subtopic 17 directly synthesizes this entire arc into a single summary slide.",
        source="j2, comparing 7–17 whole with a split at 14 (it chose whole in 5 of 6 calls)",
        stretch=(7, 17),
    ),
    16: dict(
        name="Host developmental stage",
        ruling="Same topic", ruling_kind="same",
        ruling_note="You ruled that 16 stays in the topic before it.",
        case_for="Subtopic 16 shifts attention to host biology, developmental windows, and life-stage susceptibility.",
        case_against="Host developmental factors and the concluding summary in subtopic 17 synthesize the entire mechanistic segment on how mutagens and promoters operate.",
        source="g21, resolving the mark at 16 (it decided no start)",
        stretch=(14, 17),
    ),
}

# The ruled grouping on the live division: topic starts, with 4 set to either.
RULED_STARTS = [1, 2, 7, 9, 14, 18, 22]


def ruled_topics():
    out = []
    for k, a in enumerate(RULED_STARTS):
        b = RULED_STARTS[k + 1] - 1 if k + 1 < len(RULED_STARTS) else N
        out.append((a, b))
    return out


def arrangement_strip(lo, hi, inner):
    """One reading of lo..hi: the topics it makes, each with the runs' most common title."""
    cuts = [lo] + list(inner)
    parts = []
    for k, a in enumerate(cuts):
        b = cuts[k + 1] - 1 if k + 1 < len(cuts) else hi
        t = title(a, b) or "(no run made this topic)"
        width = b - a + 1
        parts.append(
            f'<div class="piece" style="flex:{width}"><span class="range">{a}–{b}</span>'
            if a != b else f'<div class="piece" style="flex:{width}"><span class="range">{a}</span>'
        )
        parts[-1] += f'<span class="ptitle">{e(t)}</span><span class="pcount">{span_count(a, b)} of 72 runs made this topic</span></div>'
    return '<div class="strip">' + "".join(parts) + "</div>"


def readings_block(lo, hi, ruled_inners, heading):
    c = reading_counts(lo, hi)
    rows = []
    for inner, n in c.most_common():
        is_ruled = inner in ruled_inners
        tag = '<span class="chip ruled">your ruling</span>' if is_ruled else ""
        label = "one topic" if not inner else "topics start at " + ", ".join(str(x) for x in (lo,) + inner)
        rows.append(
            f'<div class="reading{" is-ruled" if is_ruled else ""}"><div class="rhead"><span class="rcount">{n} of 72</span>'
            f'<span class="rlabel">{e(label)}</span>{tag}</div>{arrangement_strip(lo, hi, inner)}</div>'
        )
    return f'<section class="readings"><h3>{e(heading)}</h3>{"".join(rows)}</section>'


def seam_block(site):
    s = SEAMS[site]
    return f"""
<aside class="seam" id="seam-{site}">
  <div class="seam-head">
    <span class="seam-site">Border before {site}</span>
    <h3>{e(s['name'])}</h3>
    <span class="chip {s['ruling_kind']}">{e(s['ruling'])}</span>
  </div>
  <div class="counts">
    <div><span class="big">{started(bare, site)}<small>/36</small></span><span class="cap">g15 runs without titles start a topic here</span></div>
    <div><span class="big">{started(titled, site)}<small>/36</small></span><span class="cap">g15 runs with titles start a topic here</span></div>
  </div>
  <div class="cases">
    <div class="case for"><span class="clab">Case for a start</span><p>{e(s['case_for'])}</p></div>
    <div class="case against"><span class="clab">Case against</span><p>{e(s['case_against'])}</p></div>
  </div>
  <p class="source">{e(s['source'])}. {e(s['ruling_note'])}</p>
</aside>"""


def border_marker(i):
    """An undisputed border: how many of the 72 runs start a topic there."""
    n = started(every, i)
    if n == len(every):
        text = "every run starts a topic here"
        kind = "agreed"
    elif n == 0:
        text = "no run starts a topic here"
        kind = "none"
    else:
        text = f"{n} of 72 runs start a topic here"
        kind = "none"
    return f'<div class="marker {kind}"><span class="mid">Border before {i}</span><span class="mtext">{text}</span></div>'


def spine():
    rows = []
    for i in range(1, N + 1):
        if i > 1:
            rows.append(seam_block(i) if i in SEAMS else border_marker(i))
        sub = subs[i - 1]
        note = ""
        if i == 17:
            note = '<span class="chip note">the summary the model cites for keeping 7–17 together</span>'
        rows.append(
            f'<article class="sub" id="s{i}"><div class="shead"><span class="sid">{i}</span>'
            f'<span class="slabel">{e(sub["label"])}</span>{note}<span class="swords">{len(sub["text"].split())} words</span></div>'
            f'<div class="stext">{"".join(f"<p>{e(p)}</p>" for p in sub["text"].split(chr(10)) if p.strip())}</div></article>'
        )
    return '<div class="flow">' + "".join(rows) + "</div>"


summary_rows = "".join(
    f'<tr><td><a href="#seam-{site}">{site}</a></td><td>{e(SEAMS[site]["name"])}</td>'
    f'<td class="num">{started(bare, site)}/36</td><td class="num">{started(titled, site)}/36</td>'
    f'<td><span class="chip {SEAMS[site]["ruling_kind"]}">{e(SEAMS[site]["ruling"])}</span></td></tr>'
    for site in SEAMS
)

page = open(os.path.join(HERE, "l4-borders.template.html")).read()
page = page.replace("{{SUMMARY_ROWS}}", summary_rows)
page = page.replace("{{READINGS_7_17}}", readings_block(7, 17, [(9, 14)], "How the runs arrange 7–17"))
page = page.replace("{{READINGS_2_6}}", readings_block(2, 6, [(), (4,)], "How the runs arrange 2–6"))
page = page.replace("{{SPINE}}", spine())
open(sys.argv[1], "w").write(page)
print("written", len(page))
