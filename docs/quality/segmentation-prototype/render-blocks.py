"""Render block-split runs as HTML pages for reading the boundaries by eye.

One page per run. The page leads with the cuts themselves — each shown with the
words either side of the join, which is what a reader needs to judge whether a
boundary belongs there — and carries the full segmented text below it.
"""

import glob
import html
import json
import os
import re

SCRATCH = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(SCRATCH, "failure-trial")
OUT_DIR = os.path.join(SCRATCH, "review")
CONTEXT_WORDS = 40

CSS = """
:root {
  --bg: #fbfaf8; --fg: #1b1a17; --muted: #6d6a63; --rule: #ddd9d1;
  --card: #ffffff; --accent: #8a5a2b; --accent-bg: #f6efe6; --warn: #9a3412;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14130f; --fg: #eceae4; --muted: #a09c92; --rule: #33302a;
    --card: #1c1b16; --accent: #d9a066; --accent-bg: #241d14; --warn: #f0a080;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Georgia, serif; }
.wrap { max-width: 60rem; margin: 0 auto; padding: 2.5rem 1.5rem 6rem; }
h1 { font-size: 1.5rem; margin: 0 0 .3rem; letter-spacing: -.01em; }
h2 { font-size: 1.05rem; text-transform: uppercase; letter-spacing: .08em;
  color: var(--muted); margin: 3rem 0 1rem; font-weight: 600; }
.meta { color: var(--muted); font-size: .9rem; margin-bottom: 2rem; }
.meta code { background: var(--accent-bg); padding: .1rem .35rem; border-radius: 3px; }
.pill { display: inline-block; padding: .15rem .5rem; border-radius: 99px;
  font-size: .78rem; background: var(--accent-bg); color: var(--accent); margin-right: .4rem; }
.pill.warn { color: var(--warn); }
table.toc { width: 100%; border-collapse: collapse; font-size: .92rem; }
table.toc td { padding: .35rem .5rem; border-bottom: 1px solid var(--rule); vertical-align: middle; }
table.toc td.n { color: var(--muted); width: 2.5rem; text-align: right; }
table.toc td.w { color: var(--muted); width: 5rem; text-align: right; font-variant-numeric: tabular-nums; }
table.toc td.bar { width: 30%; }
.bar span { display: block; height: .55rem; background: var(--accent); opacity: .55; border-radius: 2px; }
.cut { background: var(--card); border: 1px solid var(--rule); border-radius: 8px;
  padding: 1rem 1.25rem; margin: 0 0 1.1rem; }
.cut .tag { font-size: .78rem; letter-spacing: .06em; text-transform: uppercase;
  color: var(--muted); margin-bottom: .5rem; }
.cut .before { color: var(--muted); }
.cut .join { margin: .7rem 0; padding: .5rem .75rem; background: var(--accent-bg);
  border-left: 3px solid var(--accent); border-radius: 0 4px 4px 0; }
.cut .join strong { color: var(--accent); }
.block { margin: 0 0 2.5rem; }
.block h3 { font-size: 1.1rem; margin: 0 0 .2rem; }
.block .sub { color: var(--muted); font-size: .85rem; margin-bottom: .8rem; }
.block p { margin: 0; white-space: pre-wrap; }
a { color: var(--accent); }
"""


def words(text):
    return [w for w in re.split(r"\s+", text.strip()) if w]


def page(run, data):
    blocks = data["blocks"]
    counts = [len(words(b["content"])) for b in blocks]
    widest = max(counts) if counts else 1
    fidelity = data.get("fidelity") or "-"
    warn = "" if fidelity.startswith("EXACT") or fidelity.startswith("ACCEPT") else " warn"

    out = [f"<!doctype html><html><head><meta charset='utf-8'>",
           f"<meta name='viewport' content='width=device-width,initial-scale=1'>",
           f"<title>{html.escape(run)}</title><style>{CSS}</style></head><body><div class='wrap'>"]
    out.append(f"<h1>{html.escape(run)}</h1>")
    out.append(
        "<div class='meta'>"
        f"<span class='pill'>{len(blocks)} blocks</span>"
        f"<span class='pill{warn}'>{html.escape(fidelity)}</span>"
        f"<span class='pill'>{data.get('completionTokens') or '-'} output tokens</span>"
        f"<span class='pill'>{data.get('seconds')}s</span>"
        f"<br><br>mode <code>{html.escape(data.get('mode',''))}</code> &middot; "
        f"{sum(counts):,} words across {len(blocks)} blocks &middot; "
        f"shortest {min(counts) if counts else 0}w, longest {widest}w"
        "</div>"
    )

    out.append("<h2>Blocks</h2><table class='toc'>")
    for i, (b, c) in enumerate(zip(blocks, counts), 1):
        pct = int(100 * c / widest)
        out.append(
            f"<tr><td class='n'>{i}</td><td><a href='#b{i}'>{html.escape(b['label'] or '(no label)')}</a></td>"
            f"<td class='bar'><span style='width:{pct}%'></span></td><td class='w'>{c:,}w</td></tr>"
        )
    out.append("</table>")

    out.append(f"<h2>The cuts &mdash; {CONTEXT_WORDS} words either side</h2>")
    for i in range(1, len(blocks)):
        before = " ".join(words(blocks[i - 1]["content"])[-CONTEXT_WORDS:])
        after = " ".join(words(blocks[i]["content"])[:CONTEXT_WORDS])
        out.append(
            f"<div class='cut'><div class='tag'>cut {i} &nbsp;·&nbsp; block {i} &rarr; block {i+1}</div>"
            f"<div class='before'>&hellip;{html.escape(before)}</div>"
            f"<div class='join'>&#9660; new block: <strong>{html.escape(blocks[i]['label'] or '(no label)')}</strong></div>"
            f"<div class='after'>{html.escape(after)}&hellip;</div></div>"
        )

    out.append("<h2>Full text by block</h2>")
    for i, (b, c) in enumerate(zip(blocks, counts), 1):
        out.append(
            f"<div class='block' id='b{i}'><h3>{i}. {html.escape(b['label'] or '(no label)')}</h3>"
            f"<div class='sub'>{c:,} words</div><p>{html.escape(b['content'].strip())}</p></div>"
        )

    out.append("</div></body></html>")
    return "".join(out)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows = []
    for path in sorted(glob.glob(os.path.join(SRC_DIR, "*.blocks.json"))):
        run = os.path.basename(path).replace(".blocks.json", "")
        if not (run.startswith("content-j") or run.startswith("cuts-j")):
            continue
        data = json.load(open(path))
        with open(os.path.join(OUT_DIR, f"{run}.html"), "w") as fh:
            fh.write(page(run, data))
        counts = [len(words(b["content"])) for b in data["blocks"]]
        rows.append((run, data.get("mode"), len(data["blocks"]), data.get("fidelity"),
                     min(counts), max(counts)))

    index = ["<!doctype html><html><head><meta charset='utf-8'>",
             "<meta name='viewport' content='width=device-width,initial-scale=1'>",
             f"<title>Block split runs</title><style>{CSS}</style></head><body><div class='wrap'>",
             "<h1>Lecture 4 &mdash; block split runs</h1>",
             "<div class='meta'>Five full-text runs and five cut-position runs of the same "
             "transcript. Open each and read <em>The cuts</em> section.</div>",
             "<table class='toc'><tr><td class='n'></td><td><strong>run</strong></td>"
             "<td><strong>blocks</strong></td><td><strong>fidelity</strong></td>"
             "<td class='w'><strong>size range</strong></td></tr>"]
    for i, (run, mode, n, fid, lo, hi) in enumerate(rows, 1):
        index.append(
            f"<tr><td class='n'>{i}</td><td><a href='{run}.html'>{html.escape(run)}</a></td>"
            f"<td>{n}</td><td>{html.escape(fid or '-')}</td><td class='w'>{lo:,}&ndash;{hi:,}w</td></tr>"
        )
    index.append("</table></div></body></html>")
    with open(os.path.join(OUT_DIR, "index.html"), "w") as fh:
        fh.write("".join(index))
    print(f"{len(rows)} pages written to {OUT_DIR}")
    for r in rows:
        print(f"  {r[0]:12} {r[2]:3} blocks  {r[3]}")


main()
