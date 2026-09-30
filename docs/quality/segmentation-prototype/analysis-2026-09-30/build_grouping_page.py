"""Build a grouping page: a tab per lecture, a switch per run, topics and subtopics over the full text, ruled borders marked inline.

Usage: build_grouping_page.py <version> "<page title>" "<what the runs were sent>" <lecture>...
The rulings at each border come from score_groupings.py, which carries them to the live division.
The page is written to the folder OUT_DIR names, or the system temporary folder, never into the repository.
"""

import html
import json
import os
import sys
import tempfile
from pathlib import Path

from page_text import FONTS, TOKENS, paragraphs
from score_groupings import border_rules

VERSION, PAGE_TITLE, SENT = sys.argv[1], sys.argv[2], sys.argv[3]
LECTURES = sys.argv[4:] or ["l4"]
RUNS = Path(__file__).resolve().parent.parent / "runs"
OUT = Path(os.environ.get("OUT_DIR", tempfile.gettempdir())) / f"{'-'.join(LECTURES)}-{VERSION}-groupings.html"
STEM = f"group-{VERSION}@gpt-6.1-sol-pro-chosen-live18-rt9-{{}}-{{}}.blocks.json"


def rulings(lecture: str) -> dict:
    """Each border's ruling on this lecture's live division, keyed by subtopic id as text."""
    ruled = border_rules(lecture)
    return {"ruled": ruled["ruled"], "rules": {str(sid): rule for sid, rule in ruled["rules"].items()}}


def border_note(rule: str | None, opens: bool) -> tuple[str, str] | None:
    """The ruling at a border, as (css class, words), when it is worth showing."""
    if rule is None or rule == "unruled":
        return ("extra", "unruled border") if opens and rule == "unruled" else None
    if rule == "either":
        return ("either", "ruled either way")
    if opens and rule == "start":
        return ("agree", "ruled a start")
    if opens:
        return ("extra", "not a ruled start")
    if rule == "start":
        return ("missed", "ruled a start — missed here")
    return None


def chip(note: tuple[str, str] | None) -> str:
    return "" if note is None else f'<span class="chip {note[0]}">{html.escape(note[1])}</span>'


def run_panel(lecture: str, n: int, rules: dict, selected: bool) -> str:
    run = json.loads((RUNS / STEM.format(lecture, n)).read_text())
    starts = [i + 1 for i, b in enumerate(run["blocks"]) if b.get("opensTopic")]
    nav, body, open_section = [], [], False
    for i, block in enumerate(run["blocks"]):
        sid = i + 1
        opens = bool(block.get("opensTopic"))
        note = border_note(rules["rules"].get(str(sid)), opens) if sid > 1 and rules["ruled"] else None
        if opens:
            if open_section:
                body.append("</section>")
            anchor = f"{lecture}-r{n}-t{sid}"
            nav.append(f'<li><a href="#{anchor}"><span class="n">{sid}</span>{html.escape(block["topicLabel"])}</a></li>')
            body.append(
                f'<section class="topic" id="{anchor}"><h2>{html.escape(block["topicLabel"])}{chip(note)}</h2>'
                f'<p class="why">{html.escape(block["topicWhy"])}</p>'
            )
            open_section = True
            note = None
        body.append(
            f'<div class="sub"><h3><span class="n">{sid}</span>{html.escape(block["label"])}{chip(note)}</h3>'
            f"{paragraphs(block['content'])}</div>"
        )
    body.append("</section>")
    hidden = "" if selected else " hidden"
    return (
        f'<div class="run" data-lecture="{lecture}" data-run="{n}"{hidden}>'
        f'<p class="how">Topic starts: <span class="mono">{", ".join(map(str, starts))}</span> · '
        f'{run["topics"]} topics · {run["seconds"]:.0f}s</p>'
        f'<div class="grid"><nav class="contents" aria-label="Topics"><h2>Topics</h2><ol>{"".join(nav)}</ol></nav>'
        f'<article>{"".join(body)}</article></div></div>'
    )


def lecture_panel(lecture: str, selected: bool) -> tuple[str, str]:
    """A lecture's tab and its panel: a run switch, each run's starts, and the runs themselves."""
    rules = rulings(lecture)
    runs = [json.loads((RUNS / STEM.format(lecture, n)).read_text()) for n in (1, 2, 3, 4)]
    starts = [",".join(str(i + 1) for i, b in enumerate(r["blocks"]) if b.get("opensTopic")) for r in runs]
    distinct = len(set(starts))
    ruled = "" if rules["ruled"] else " · no rulings for this lecture"
    switches = "".join(
        f'<button class="runbtn" type="button" data-lecture="{lecture}" data-run="{n}" aria-pressed="{"true" if n == 1 else "false"}">Run {n}</button>'
        for n in (1, 2, 3, 4)
    )
    button = (
        f'<button class="tab" type="button" role="tab" id="tab-{lecture}" aria-controls="panel-{lecture}" '
        f'aria-selected="{"true" if selected else "false"}" data-key="{lecture}">Lecture {lecture[1:]}</button>'
    )
    panel = (
        f'<div class="panel" role="tabpanel" id="panel-{lecture}" aria-labelledby="tab-{lecture}"{"" if selected else " hidden"}>'
        f'<div class="runs"><span class="agreement">{"All 4 runs identical" if distinct == 1 else f"{distinct} different groupings in 4 runs"}{ruled}</span>{switches}</div>'
        + "".join(run_panel(lecture, n, rules, n == 1) for n in (1, 2, 3, 4))
        + "</div>"
    )
    return button, panel


pieces = [lecture_panel(lecture, i == 0) for i, lecture in enumerate(LECTURES)]

page = f"""<title>{html.escape(PAGE_TITLE)}</title>
{FONTS}
<style>
{TOKENS}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--ground);color:var(--ink);font-family:var(--serif);font-size:17px;line-height:1.68;-webkit-font-smoothing:antialiased}}
header{{position:sticky;top:env(safe-area-inset-top,0px);z-index:10;background:var(--surface);border-bottom:1px solid var(--rule)}}
.bar{{max-width:78rem;margin:0 auto;padding:.9rem 16px;display:flex;flex-wrap:wrap;align-items:center;gap:.6rem 1.4rem}}
.wordmark{{font-family:var(--ui);font-weight:600;font-size:.95rem}}
.wordmark span{{color:var(--muted);font-weight:400}}
.tabs{{display:flex;gap:.35rem;margin-left:auto;flex-wrap:wrap}}
.tab{{font-family:var(--mono);font-size:.82rem;padding:.35rem .7rem;border-radius:3px;border:1px solid var(--rule);background:transparent;color:var(--muted);cursor:pointer}}
.tab:hover{{color:var(--ink);border-color:var(--muted)}}
.tab[aria-selected="true"]{{background:var(--topic);border-color:var(--topic);color:var(--surface)}}
.tab:focus-visible{{outline:2px solid var(--topic);outline-offset:2px}}
.panel{{max-width:78rem;margin:0 auto;padding:1.5rem 16px 6rem}}
.how{{font-family:var(--ui);font-size:.88rem;color:var(--muted);margin:0 0 .6rem;max-width:62rem}}
.key{{font-family:var(--ui);font-size:.8rem;color:var(--muted);margin:0 0 2rem;display:flex;flex-wrap:wrap;gap:.4rem .8rem;align-items:center;max-width:78rem;padding:0 16px;margin-inline:auto}}
.mono{{font-family:var(--mono);font-size:.84rem;color:var(--ink)}}
.grid{{display:grid;grid-template-columns:17rem minmax(0,1fr);gap:3.5rem;align-items:start}}
@media (max-width:60rem){{.grid{{grid-template-columns:1fr;gap:2rem}} nav.contents{{position:static;max-height:none}}}}
nav.contents{{position:sticky;top:5rem;font-family:var(--ui);font-size:.84rem;max-height:calc(100vh - 6.5rem);overflow-y:auto}}
nav.contents h2{{font-size:.72rem;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:0 0 .8rem;font-weight:500}}
nav.contents ol{{list-style:none;margin:0;padding:0;display:grid;gap:.55rem}}
nav.contents a{{color:var(--topic);text-decoration:none;display:flex;gap:.5rem;line-height:1.4;font-weight:500}}
nav.contents a:hover{{text-decoration:underline}}
.n{{font-family:var(--mono);color:var(--muted);font-size:.75rem;min-width:1.4rem;font-variant-numeric:tabular-nums;font-weight:400}}
article{{max-width:40rem}}
.topic{{margin:0 0 3rem;scroll-margin-top:5rem}}
.topic > h2{{font-family:var(--ui);font-size:1.3rem;font-weight:600;line-height:1.3;margin:0 0 .45rem;color:var(--topic);text-wrap:balance;border-top:2px solid var(--topic);padding-top:.9rem}}
.why{{font-family:var(--ui);font-size:.88rem;color:var(--muted);margin:0 0 1.6rem;font-style:italic;line-height:1.55}}
.sub{{margin:0 0 2rem}}
.sub h3{{font-family:var(--ui);font-size:.98rem;font-weight:600;color:var(--sub);margin:0 0 .7rem;text-wrap:balance;line-height:1.35;display:flex;gap:.5rem;align-items:baseline;flex-wrap:wrap}}
.sub p{{margin:0 0 .8rem}}
.chip{{font-family:var(--ui);font-size:.7rem;font-weight:500;letter-spacing:.03em;padding:.12rem .45rem;border-radius:2px;margin-left:.6rem;vertical-align:.2em;white-space:nowrap}}
.chip.agree{{background:var(--topic-soft);color:var(--topic)}}
.chip.either{{background:var(--rule);color:var(--muted)}}
.chip.extra,.chip.missed{{background:var(--flag-soft);color:var(--flag)}}
.runs{{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;margin:0 0 1rem;font-family:var(--ui)}}
.agreement{{font-size:.85rem;color:var(--ink);font-weight:500;margin-right:.8rem}}
.runbtn{{font-family:var(--mono);font-size:.78rem;padding:.25rem .55rem;border-radius:3px;border:1px solid var(--rule);background:var(--surface);color:var(--muted);cursor:pointer}}
.runbtn[aria-pressed="true"]{{border-color:var(--sub);color:var(--sub);font-weight:500}}
.runbtn:focus-visible{{outline:2px solid var(--sub);outline-offset:2px}}
@media (prefers-reduced-motion:reduce){{*{{transition:none!important}}}}
</style>
<header><div class="bar">
  <div class="wordmark">Grouped on {html.escape(SENT)} <span>· {VERSION}, GPT-6.1 Sol Pro, default effort</span></div>
  <div class="tabs" role="tablist">{"".join(p[0] for p in pieces)}</div>
</div></header>
<p class="key" style="padding-top:1rem">Each topic heading and subtopic title sits above the full transcript. At each border: <span class="chip agree">ruled a start</span><span class="chip either">ruled either way</span><span class="chip extra">not a ruled start</span><span class="chip missed">ruled a start — missed here</span>. Rulings are carried from the division they were made on by where each border falls; on lecture 4 its 22 and 23 are one subtopic here, 22.</p>
{"".join(p[1] for p in pieces)}
<script>
(function(){{
  var tabs = document.querySelectorAll('.tab');
  function show(key){{
    tabs.forEach(function(t){{
      var on = t.dataset.key === key;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      document.getElementById('panel-' + t.dataset.key).hidden = !on;
    }});
  }}
  tabs.forEach(function(t){{ t.addEventListener('click', function(){{ show(t.dataset.key); window.scrollTo(0,0); }}); }});
  document.querySelectorAll('.runbtn').forEach(function(b){{
    b.addEventListener('click', function(){{
      var lecture = b.dataset.lecture, run = b.dataset.run;
      document.querySelectorAll('.runbtn[data-lecture="' + lecture + '"]').forEach(function(o){{ o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); }});
      document.querySelectorAll('.run[data-lecture="' + lecture + '"]').forEach(function(r){{ r.hidden = r.dataset.run !== run; }});
    }});
  }});
  var h = location.hash.replace('#','').split('-')[0];
  if (document.getElementById('panel-' + h)) show(h);
}})();
</script>
"""
OUT.write_text(page)
print(OUT, len(page))
