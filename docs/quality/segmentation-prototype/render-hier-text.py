"""Render hierarchical runs as full readable documents.

One page per run: the whole transcript laid out under its topic and subtopic
headings, which is roughly what the structured document would look like if these
cuts drove it. An index links them.
"""

import glob
import html
import json
import os
import re
import sys

SCRATCH = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(SCRATCH, "runs")
OUT_DIR = os.path.join(SCRATCH, "review")
PATTERN = sys.argv[1] if len(sys.argv) > 1 else "hier-h*.blocks.json"
PREFIX = sys.argv[2] if len(sys.argv) > 2 else "text-flash"

CSS = """
:root{--bg:#fbfaf8;--fg:#1b1a17;--muted:#6d6a63;--rule:#e3ded5;--card:#fff;
  --topic:#8a4b1f;--topic-bg:#f8ece1;--sub:#3f5f70}
@media (prefers-color-scheme:dark){:root{--bg:#14130f;--fg:#eceae4;--muted:#a09c92;
  --rule:#33302a;--card:#1c1b16;--topic:#e0975c;--topic-bg:#2b1d12;--sub:#8fb4c7}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
  font:17px/1.72 Georgia,"Iowan Old Style",serif}
.wrap{max-width:44rem;margin:0 auto;padding:2.5rem 1.5rem 8rem}
h1{font-size:1.4rem;margin:0 0 .3rem;font-family:-apple-system,BlinkMacSystemFont,sans-serif}
.meta{color:var(--muted);font-size:.88rem;margin-bottom:2rem;
  font-family:-apple-system,BlinkMacSystemFont,sans-serif}
.pill{display:inline-block;padding:.15rem .5rem;border-radius:99px;font-size:.78rem;
  background:var(--topic-bg);color:var(--topic);margin-right:.4rem}
nav{background:var(--card);border:1px solid var(--rule);border-radius:8px;
  padding:1rem 1.25rem;margin-bottom:2.5rem;font-size:.9rem;
  font-family:-apple-system,BlinkMacSystemFont,sans-serif}
nav .t{color:var(--topic);font-weight:600;margin:.6rem 0 .15rem}
nav .t:first-child{margin-top:0}
nav .s{margin-left:1.2rem;color:var(--sub);font-weight:600;margin-top:.35rem}
nav .l{margin-left:2.4rem;color:var(--muted)}
nav a{color:inherit;text-decoration:none}
nav a:hover{text-decoration:underline}
h2.topic{font-family:-apple-system,BlinkMacSystemFont,sans-serif;
  font-size:1.3rem;color:var(--topic);margin:3.5rem 0 .2rem;
  padding-top:1.2rem;border-top:2px solid var(--topic)}
h3.sub{font-family:-apple-system,BlinkMacSystemFont,sans-serif;
  font-size:1rem;color:var(--sub);margin:2rem 0 .4rem;font-weight:600}
h3.sub .w{color:var(--muted);font-weight:400;font-size:.85rem}
h3.leaf{font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:.92rem;
  color:var(--muted);margin:1.5rem 0 .35rem;font-weight:600;letter-spacing:.01em}
h3.leaf .w{font-weight:400;font-size:.8rem;opacity:.75}
h3.sub{border-bottom:1px solid var(--rule);padding-bottom:.25rem}
p.body{margin:0 0 1rem;white-space:pre-wrap}
a.top{font-size:.8rem;color:var(--muted);font-family:-apple-system,sans-serif}
"""


def words(text):
    return [w for w in re.split(r"\s+", text) if w]


def page(run, data):
    blocks = data["blocks"]
    topics = sum(1 for b in blocks if b.get("opensTopic"))
    total = sum(len(words(b["content"])) for b in blocks)

    has_mid = any("subtopicLabel" in b for b in blocks)
    nav, body = [], []
    for i, b in enumerate(blocks):
        n = len(words(b["content"]))
        opened = False
        if b.get("opensTopic"):
            nav.append(f"<div class='t'><a href='#b{i}'>{html.escape(b.get('topicLabel') or '')}</a></div>")
            body.append(f"<h2 class='topic' id='b{i}'>{html.escape(b.get('topicLabel') or '(no topic label)')}</h2>")
            opened = True
        if has_mid and b.get("opensSubtopic"):
            anchor = "" if opened else f" id='b{i}'"
            nav.append(f"<div class='s'><a href='#b{i}'>{html.escape(b.get('subtopicLabel') or '')}</a></div>")
            body.append(f"<h3 class='sub'{anchor}>{html.escape(b.get('subtopicLabel') or '(no label)')}</h3>")
            opened = True
        leaf_class = "leaf" if has_mid else "sub"
        nav.append(f"<div class='{'l' if has_mid else 's'}'><a href='#b{i}'>{html.escape(b['label'] or '')}</a></div>")
        anchor = "" if opened else f" id='b{i}'"
        body.append(
            f"<h3 class='{leaf_class}'{anchor}>{html.escape(b['label'] or '(no label)')} "
            f"<span class='w'>&middot; {n:,}w</span></h3>"
            f"<p class='body'>{html.escape(b['content'].strip())}</p>"
        )

    return (f"<!doctype html><html><head><meta charset='utf-8'>"
            f"<meta name='viewport' content='width=device-width,initial-scale=1'>"
            f"<title>{html.escape(run)}</title><style>{CSS}</style></head><body><div class='wrap'>"
            f"<h1>{html.escape(run)}</h1>"
            f"<div class='meta'><span class='pill'>{topics} topics</span>"
            f"<span class='pill'>{len(blocks)} subtopics</span>"
            f"<span class='pill'>{html.escape(data.get('fidelity') or '-')}</span>"
            f"<span class='pill'>{data.get('seconds')}s</span><br><br>"
            f"{total:,} words</div>"
            f"<nav>{''.join(nav)}</nav>{''.join(body)}</div></body></html>")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows = []
    for path in sorted(glob.glob(os.path.join(SRC_DIR, PATTERN))):
        run = os.path.basename(path).replace(".blocks.json", "")
        data = json.load(open(path))
        name = f"{PREFIX}-{run}.html"
        with open(os.path.join(OUT_DIR, name), "w") as fh:
            fh.write(page(run, data))
        rows.append((name, run, sum(1 for b in data["blocks"] if b.get("opensTopic")),
                     len(data["blocks"]), data.get("fidelity")))

    index = ["<!doctype html><html><head><meta charset='utf-8'>",
             "<meta name='viewport' content='width=device-width,initial-scale=1'>",
             f"<title>{PREFIX}</title><style>{CSS}</style></head><body><div class='wrap'>",
             f"<h1>Full text by run &mdash; {html.escape(PREFIX)}</h1>",
             "<div class='meta'>The whole transcript under each run's own headings.</div><nav>"]
    for name, run, t, s, fid in rows:
        index.append(f"<div class='t'><a href='{name}'>{html.escape(run)}</a></div>"
                     f"<div class='s'>{t} topics &middot; {s} subtopics &middot; {html.escape(fid or '-')}</div>")
    index.append("</nav></div></body></html>")
    with open(os.path.join(OUT_DIR, f"{PREFIX}-index.html"), "w") as fh:
        fh.write("".join(index))
    print(f"{len(rows)} pages + index: {OUT_DIR}/{PREFIX}-index.html")
    for r in rows:
        print(f"   {r[1]:12} {r[2]:2} topics {r[3]:3} subtopics")


main()
