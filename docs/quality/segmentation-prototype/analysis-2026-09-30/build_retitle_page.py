"""Build the l4 retitle comparison page: r3 and r4 with full text under each title, then every version's runs side by side.

The page is written to the folder OUT_DIR names, or the system temporary folder, never into the repository.
"""

import html
import json
import os
import tempfile
from pathlib import Path

RUNS = Path(__file__).resolve().parent.parent / "runs"
OUT = Path(os.environ.get("OUT_DIR", tempfile.gettempdir())) / "l4-retitle-r3-r4.html"

division = json.loads((RUNS / "chosen-live18-l4.blocks.json").read_text())["blocks"]

TABS = [
    ("r3", "One call per subtopic", "retitle-r3%high-all-chosen-live18-l4.json",
     "22 calls. Each call gets one subtopic's full text and the original titles of the subtopics either side."),
    ("r4", "Whole lecture in one call, run 1", "retitle-r4%high-all-chosen-live18-l4-1.json",
     "1 call. Gets every subtopic's id and full text, no titles, and titles them one at a time in order."),
]


def tokens(retitled: list) -> tuple[int, int]:
    return (sum(e["promptTokens"] or 0 for e in retitled), sum(e["completionTokens"] or 0 for e in retitled))


from page_text import paragraphs


def panel(key: str, name: str, file: str, how: str, selected: bool) -> tuple[str, str]:
    retitled = json.loads((RUNS / file).read_text())["retitled"]
    tin, tout = tokens(retitled)
    nav = "".join(
        f'<li><a href="#{key}-{e["id"]}"><span class="n">{e["id"]}</span>{html.escape(e["newTitle"])}</a></li>'
        for e in retitled
    )
    subs = "".join(
        f'<section class="sub" id="{key}-{e["id"]}">'
        f'<h3><span class="n">{e["id"]}</span>{html.escape(e["newTitle"])}</h3>'
        f'<div class="old">was: <s>{html.escape(e["oldTitle"])}</s></div>'
        f"{paragraphs(division[e['id'] - 1]['content'])}</section>"
        for e in retitled
    )
    hidden = "" if selected else " hidden"
    button = (
        f'<button class="tab" type="button" role="tab" id="tab-{key}" aria-controls="panel-{key}" '
        f'aria-selected="{"true" if selected else "false"}" data-key="{key}">'
        f'<b>{key}</b> {html.escape(name)}</button>'
    )
    body = (
        f'<div class="panel" role="tabpanel" id="panel-{key}" aria-labelledby="tab-{key}"{hidden}>'
        f'<p class="how">{html.escape(how)} Gemini 3.7 Flash, high effort. '
        f'<span class="tok">{tin:,} tokens in · {tout:,} out</span></p>'
        f'<div class="grid"><nav class="contents" aria-label="Titles"><h2>Titles</h2><ol>{nav}</ol></nav>'
        f"<article>{subs}</article></div></div>"
    )
    return button, body


pieces = [panel(*tab, selected=(i == 0)) for i, tab in enumerate(TABS)]
def side_by_side(
    version: str,
    about: str,
    model: str = "",
    model_name: str = "Gemini 3.7 Flash",
    numbers: tuple[int, ...] = (1, 2, 3, 4),
    effort: str = "high",
) -> tuple[str, str]:
    """A tab setting a version's runs' titles next to each other, one row per subtopic."""
    tag = f"@{model}" if model else ""
    effort_tag = f"%{effort}" if effort else ""
    effort_name = f"{effort} effort" if effort else "default effort"
    runs = [json.loads((RUNS / f"retitle-{version}{tag}{effort_tag}-all-chosen-live18-l4-{n}.json").read_text())["retitled"] for n in numbers]
    key = f"{version}{model.replace('.', '')}{effort}x{len(numbers)}"
    label = f"{version} × {len(numbers)}" + (f" · {model_name}" if model else "") + ("" if effort == "high" else f" · {effort_name}")
    head = "<tr><th>#</th><th>original</th>" + "".join(f"<th>run {n}</th>" for n in numbers) + "</tr>"
    rows = "".join(
        f'<tr><td class="n">{i + 1}</td><td class="orig">{html.escape(division[i]["label"])}</td>'
        + "".join(f"<td>{html.escape(run[i]['newTitle'])}</td>" for run in runs)
        + "</tr>"
        for i in range(len(division))
    )
    words = sum(len(e["newTitle"].split()) for run in runs for e in run) / sum(len(run) for run in runs)
    out = " · ".join(f"run {n}: {run[0]['completionTokens']:,}" for n, run in zip(numbers, runs))
    button = f'<button class="tab" type="button" role="tab" id="tab-{key}" aria-controls="panel-{key}" aria-selected="false" data-key="{key}"><b>{html.escape(label)}</b></button>'
    body = (
        f'<div class="panel" role="tabpanel" id="panel-{key}" aria-labelledby="tab-{key}" hidden>'
        f'<p class="how">{len(numbers)} runs of {version} on the same division, {model_name}, {effort_name}. {html.escape(about)} '
        f'Mean title length {words:.1f} words. <span class="tok">tokens out · {out}</span></p>'
        f'<div class="scroll"><table><thead>{head}</thead><tbody>{rows}</tbody></table></div></div>'
    )
    return button, body


pieces.append(side_by_side("r4", "Whole lecture in one call."))
pieces.append(side_by_side("r5", "r4 plus R5: lead with the main point, then name only the subjects a student must learn, as far as the title stays short."))
pieces.append(side_by_side("r6", "r4 plus R5 as only \"lead with the main point or points\", and R4 allowing more than one point."))
R7_ABOUT = "r4 plus R5: the best short description of the subtopic's subject matter for a science undergraduate."
pieces.append(side_by_side("r7", R7_ABOUT))
pieces.append(side_by_side("r7", R7_ABOUT, "claude-sonnet-5.5", "Claude Sonnet 5.5"))
pieces.append(side_by_side("r7", R7_ABOUT, "gpt-6.1-sol-pro", "GPT-6.1 Sol Pro"))
pieces.append(side_by_side("r7", R7_ABOUT, "gpt-6.1-sol-pro", "GPT-6.1 Sol Pro", effort=""))
pieces.append(side_by_side("r8", "r7 plus R6: a recap is titled \"Summary of…\", and the lecture's closing part \"Lecture summary:\" or \"Lecture close:\".", "gpt-6.1-sol-pro", "GPT-6.1 Sol Pro", effort=""))
pieces.append(side_by_side("r9", "r8 with R5 asking for the most precise words.", "gpt-6.1-sol-pro", "GPT-6.1 Sol Pro", effort=""))
buttons = "".join(p[0] for p in pieces)
panels = "".join(p[1] for p in pieces)

page = f"""<title>Lecture 4 Retitles</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<style>
:root{{
  --ground:#f6f7f8; --surface:#ffffff; --ink:#14181c; --muted:#5c646c;
  --rule:#dee3e8; --topic:#17606d; --sub:#6d4a76;
  --ui:"IBM Plex Sans",system-ui,-apple-system,sans-serif;
  --serif:"Source Serif 4",Georgia,"Times New Roman",serif;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{
  color-scheme:dark;
  --ground:#0e1216; --surface:#151a1f; --ink:#e4e8ec; --muted:#939ba3;
  --rule:#242b32; --topic:#6bc2d0; --sub:#c3a2cb;
}}}}
:root[data-theme="dark"]{{
  color-scheme:dark;
  --ground:#0e1216; --surface:#151a1f; --ink:#e4e8ec; --muted:#939ba3;
  --rule:#242b32; --topic:#6bc2d0; --sub:#c3a2cb;
}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--ground);color:var(--ink);font-family:var(--serif);
  font-size:17px;line-height:1.68;-webkit-font-smoothing:antialiased}}
header{{position:sticky;top:env(safe-area-inset-top,0px);z-index:10;background:var(--surface);border-bottom:1px solid var(--rule)}}
.bar{{max-width:78rem;margin:0 auto;padding:.9rem 16px;display:flex;flex-wrap:wrap;align-items:center;gap:.6rem 1.4rem}}
.wordmark{{font-family:var(--ui);font-weight:600;font-size:.95rem}}
.wordmark span{{color:var(--muted);font-weight:400}}
.tabs{{display:flex;gap:.35rem;margin-left:auto;flex-wrap:wrap}}
.tab{{font-family:var(--ui);font-size:.85rem;padding:.35rem .7rem;border-radius:3px;
  border:1px solid var(--rule);background:transparent;color:var(--muted);cursor:pointer}}
.tab b{{font-family:var(--mono);font-weight:500;margin-right:.3rem}}
.tab:hover{{color:var(--ink);border-color:var(--muted)}}
.tab[aria-selected="true"]{{background:var(--topic);border-color:var(--topic);color:var(--surface)}}
.tab:focus-visible{{outline:2px solid var(--topic);outline-offset:2px}}
.panel{{max-width:78rem;margin:0 auto;padding:1.5rem 16px 6rem}}
.how{{font-family:var(--ui);font-size:.88rem;color:var(--muted);margin:0 0 2rem;max-width:60rem}}
.tok{{font-family:var(--mono);font-size:.8rem;white-space:nowrap;margin-left:.4rem}}
.grid{{display:grid;grid-template-columns:18rem minmax(0,1fr);gap:3.5rem;align-items:start}}
@media (max-width:60rem){{.grid{{grid-template-columns:1fr;gap:2rem}} nav.contents{{position:static;max-height:none}}}}
nav.contents{{position:sticky;top:5rem;font-family:var(--ui);font-size:.82rem;max-height:calc(100vh - 6.5rem);overflow-y:auto}}
nav.contents h2{{font-size:.72rem;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:0 0 .8rem;font-weight:500}}
nav.contents ol{{list-style:none;margin:0;padding:0;display:grid;gap:.5rem}}
nav.contents li{{line-height:1.4}}
nav.contents a{{color:var(--topic);text-decoration:none;display:flex;gap:.5rem}}
nav.contents a:hover{{text-decoration:underline}}
.n{{font-family:var(--mono);color:var(--muted);font-size:.75rem;min-width:1.4rem;font-variant-numeric:tabular-nums;font-weight:400}}
article{{max-width:38rem}}
.sub{{margin:0 0 2.4rem;scroll-margin-top:5rem;border-top:1px solid var(--rule);padding-top:1rem}}
.sub h3{{font-family:var(--ui);font-size:1.05rem;font-weight:600;color:var(--sub);margin:0;text-wrap:balance;line-height:1.35;display:flex;gap:.5rem;align-items:baseline}}
.old{{font-family:var(--ui);font-size:.8rem;color:var(--muted);margin:.25rem 0 .9rem 1.9rem}}
.sub p{{margin:0 0 .8rem}}
.scroll{{overflow-x:auto}}
table{{border-collapse:collapse;font-family:var(--ui);font-size:.86rem;line-height:1.4;min-width:56rem;width:100%}}
th,td{{text-align:left;vertical-align:top;padding:.55rem .7rem;border-bottom:1px solid var(--rule)}}
th{{font-weight:500;font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);position:sticky;top:0;background:var(--ground)}}
td.orig{{color:var(--muted)}}
tbody tr:hover td{{background:var(--surface)}}
@media (prefers-reduced-motion:reduce){{*{{transition:none!important}}}}
</style>
<header><div class="bar">
  <div class="wordmark">Lecture 4 retitles <span>· 22 subtopics, live chosen division</span></div>
  <div class="tabs" role="tablist">{buttons}</div>
</div></header>
{panels}
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
  var h = location.hash.replace('#','').split('-')[0];
  if (document.getElementById('panel-' + h)) show(h);
}})();
</script>
"""
OUT.write_text(page)
print(OUT, len(page))
