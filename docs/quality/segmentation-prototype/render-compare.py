"""Render two block-split runs of the same transcript side by side.

Both runs segment identical text, so the pages can be aligned: the text is split
at the union of both runs' boundaries, and each segment is laid out as one row.
The same words therefore sit at the same height in both columns, and a cut only
one run made appears as a bar with nothing opposite it.
"""

import html
import json
import os
import re
import sys

SCRATCH = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(SCRATCH, "failure-trial")
OUT = os.path.join(SCRATCH, "review", "compare.html")

CSS = """
:root {
  --bg:#fbfaf8; --fg:#1b1a17; --muted:#6d6a63; --rule:#e3ded5;
  --shared:#6b7f5a; --shared-bg:#eef2e8; --unique:#a8541f; --unique-bg:#fbeee3;
  --head:#ffffff;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg:#14130f; --fg:#eceae4; --muted:#a09c92; --rule:#32302a;
    --shared:#9fb98a; --shared-bg:#1e2419; --unique:#e0975c; --unique-bg:#2a1d12;
    --head:#1b1a15;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
  font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Georgia,serif}
header{position:sticky;top:0;z-index:5;background:var(--head);
  border-bottom:1px solid var(--rule);padding:.9rem 1.25rem}
header h1{margin:0 0 .5rem;font-size:1.15rem}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;max-width:78rem;margin:0 auto}
.colname{font-size:.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}
.legend{max-width:78rem;margin:.5rem auto 0;font-size:.83rem;color:var(--muted)}
.key{display:inline-block;width:.8rem;height:.8rem;border-radius:2px;vertical-align:-1px;margin-right:.3rem}
main{max-width:78rem;margin:0 auto;padding:1.5rem 1.25rem 6rem}
.row{display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;align-items:start}
.cell{min-width:0}
p.seg{margin:0 0 .55rem;white-space:pre-wrap;hyphens:auto}
.bar{margin:1.4rem 0 .7rem;padding:.4rem .7rem;border-radius:4px;font-size:.85rem;
  font-weight:600;letter-spacing:.01em;line-height:1.35}
.bar.shared{background:var(--shared-bg);color:var(--shared);border-left:4px solid var(--shared)}
.bar.unique{background:var(--unique-bg);color:var(--unique);border-left:4px solid var(--unique)}
.bar .n{opacity:.7;font-weight:400}
.gap{margin:1.4rem 0 .7rem;height:1px}
"""


def load(run):
    with open(os.path.join(SRC_DIR, f"{run}.blocks.json")) as fh:
        return json.load(fh)


def offsets(blocks):
    """Character offset at which each block starts, and the joined text."""
    text, starts, at = [], [], 0
    for b in blocks:
        starts.append(at)
        text.append(b["content"])
        at += len(b["content"])
    return starts, "".join(text)


def main():
    left_run, right_run = sys.argv[1], sys.argv[2]
    left, right = load(left_run), load(right_run)
    lstarts, ltext = offsets(left["blocks"])
    rstarts, rtext = offsets(right["blocks"])
    if ltext != rtext:
        print("WARNING: the two runs do not reproduce identical text; alignment is approximate")

    lmap = {o: (i, b["label"]) for i, (o, b) in enumerate(zip(lstarts, left["blocks"]), 0)}
    rmap = {o: (i, b["label"]) for i, (o, b) in enumerate(zip(rstarts, right["blocks"]), 0)}
    cuts = sorted(set(lstarts) | set(rstarts) | {len(ltext)})

    shared = len(set(lstarts) & set(rstarts))
    rows = []
    for i in range(len(cuts) - 1):
        start, end = cuts[i], cuts[i + 1]
        segment = ltext[start:end].strip()
        cells = []
        for mp, other in ((lmap, rmap), (rmap, lmap)):
            hit = mp.get(start)
            if hit is None:
                bar = "<div class='gap'></div>" if start in other else ""
            else:
                n, label = hit
                kind = "shared" if start in other else "unique"
                bar = (f"<div class='bar {kind}'><span class='n'>block {n + 1}</span><br>"
                       f"{html.escape(label or '(no label)')}</div>")
            cells.append(f"<div class='cell'>{bar}<p class='seg'>{html.escape(segment)}</p></div>")
        rows.append(f"<div class='row'>{cells[0]}{cells[1]}</div>")

    page = f"""<!doctype html><html><head><meta charset='utf-8'>
<meta name='viewport' content='width=device-width,initial-scale=1'>
<title>{html.escape(left_run)} vs {html.escape(right_run)}</title><style>{CSS}</style></head><body>
<header>
<h1>Block boundaries side by side &mdash; same transcript, two runs</h1>
<div class='cols'>
<div class='colname'>{html.escape(left_run)} &middot; {len(left['blocks'])} blocks</div>
<div class='colname'>{html.escape(right_run)} &middot; {len(right['blocks'])} blocks</div>
</div>
<div class='legend'>
<span class='key' style='background:var(--shared)'></span>boundary both runs made ({shared})
&nbsp;&nbsp;
<span class='key' style='background:var(--unique)'></span>boundary only this run made
&nbsp;&nbsp; Text is identical in both columns and aligned, so a lone orange bar is a cut the other run did not make.
</div>
</header>
<main>{"".join(rows)}</main>
</body></html>"""

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        fh.write(page)
    print(f"{OUT}")
    print(f"  {left_run}: {len(left['blocks'])} blocks, {right_run}: {len(right['blocks'])} blocks")
    print(f"  boundaries shared: {shared}   only in {left_run}: {len(set(lstarts)-set(rstarts))}"
          f"   only in {right_run}: {len(set(rstarts)-set(lstarts))}")


main()
