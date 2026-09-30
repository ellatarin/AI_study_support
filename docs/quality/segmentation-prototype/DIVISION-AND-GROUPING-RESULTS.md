# Division and grouping results, 2026-09-29

Where division and grouping stood after the live pipeline was moved to 18 splitting runs,
and every trial that got it there. Written by hand from the measurements named in each
section; the scripts are in `analysis-2026-09-29/`.

"Right" is the share of panels whose result matches the user's rulings
(`runs/divisions.json` for cuts, `runs/topic-rulings.json` for topics, carried to other
divisions by position). "Steady" is how often two panels drawn from the same runs hand on the
same result.

## Dividing the transcript

**Settled approach.** 18 splitting runs per lecture (`s6` initial splitting, then `d13`
deepening of every subtopic over 600 words, up to two rounds). The run nearest the vote is
kept whole, where a cut site counts when at least 9 of the 18 runs cut there.

**Where it stands**, estimated from how often each cut site was cut in the prototype's 18
`d13` runs per lecture, leaving out sites ruled "don't care":

| setting | cut sites two panels disagree on, 8 lectures | errors against the rulings per panel, 8 lectures |
|---|---|---|
| 9 runs, bar 5 (before) | 3.8 | 3.9 |
| 18 runs, bar 10 | 2.5 | 3.2 |
| **18 runs, bar 9 (adopted)** | **2.2** | **3.1** |

Two panels disagree on about 2 of roughly 140 cut sites. Most remaining errors are at cut
sites the model splits close to half and half; more runs barely move those.

**Live check.** The division chosen from the live pipeline's 18 runs matched the one chosen
from the prototype's 18 `d13` runs at every cut site on six of the eight lectures. The three
differing cuts are below; the user judged all three acceptable.

| cut | live runs cutting | prototype runs cutting | cut by |
|---|---|---|---|
| l6 at 89.8% (circulating tumour cells) | 9/18 | 11/18 | prototype's choice only |
| l8 at 13.9% (drug-efflux resistance) | 4/18 | 11/18 | prototype's choice only |
| l8 at 56.7% (kinase inhibitors as chronic therapy) | 12/18 | 6/18 | live choice only |

On l4 the prototype's chosen run cuts twice inside one cut site (98.3% and 99.3%); the live
choice does not.

**Trials, in order:**

| trial | result | decision |
|---|---|---|
| Keep the run nearest the vote, or the vote itself (panels of 9) | as steady and accurate: 3.34 against 3.26 disagreements, 3.09 against 3.03 errors (`AGGREGATION.md`) | keep the nearest run, whole |
| Size gate 150 words instead of 600 (l6) | added unwanted cuts (76.2%, 78.9% to 4 of 9) and not the wanted one | gate stays 600 |
| Live remake of 9 runs against the prototype | 133 cut sites kept by both; 2 of 168 sites differ beyond chance, about 8.4 expected (`LIVE-DEEPENED-SPLITTING.md`) | live pipeline cuts as the prototype did |
| Two live panels of 9 | 3 cut sites flipped kept/dropped; 4.7 expected by chance | panel variance, not a defect |
| l8 13.9% traced | only reachable when the initial split leaves a 973-word subtopic for deepening; a cut at 11.0% leaves 450 words, under the gate | gated sites vary more between panels |
| Vote on the initial splits, deepen that one division 18 times (l8 only) | steadier (0.6 → 0.3 disagreements) but kept 56.7%, ruled unwanted, in 93% of panels; the initial split chosen differs between panels on l1 (2% same), l4 (21%), l8 (0%) | dropped |
| 9 → 18 runs | see the table above; about $0.85 more per lecture | adopted, bar 9 |

## Grouping into topics

**Prompt.** `g15`: `g12` plus R7, "a subtopic that only looks back belongs to what it looks
back on". Both its forms, with and without subtopic titles, carry R7. The panel is 18 runs;
the run nearest the vote is kept whole.

**Earlier, on the prototype's closest-run divisions (with titles):** `g15` at 9 of 18 matched
the rulings on all five ruled lectures. Replacing inherited titles with `r3` retitles before
grouping broke l4 (matching runs 15/18 → 6/18; tumour promotion start 15/18 → 7/18), so
retitling was placed after grouping.

**On the live 18-run chosen divisions**, 36 `g15` runs per lecture with titles and 36
without (`runs/group-g15-chosen-live18-*`, `runs/group-g15+nolabels-chosen-live18-*`):

| lecture | right, with titles (bar 9) | right, without titles (bar 8) | steady, with titles (bar 9) | steady, without titles (bar 8) |
|---|---|---|---|---|
| l1 | 62% | 100% | 25% | 100% |
| l2 | unruled | unruled | 100% | 100% |
| l3 | 0% | 92% | 100% | 83% |
| l4 | 0% | 98% | 60% | 96% |
| l5 | 100% | 100% | 100% | 100% |
| l6 | 100% | 81% | 100% | 62% |
| l7 | unruled | unruled | 100% | 28% |
| l8 | unruled | unruled | 100% | 100% |

With titles, l3 and l4 are wrong at every bar from 5 to 14. On l4 the live chosen run titles
subtopics 9 and 14 narrowly ("Dietary Carcinogens and Aflatoxin Activation", "Asbestos and
Chronic Inflammation as a Promoter"); the prototype's chosen run had inherited, heading-like
titles there ("Chemical and physical mutagens: …", "Tumour promotion and the Berenbaum
two-stage model"), which cued the topic starts. Grouping with titles follows whichever run's
titles happen to be chosen.

**Without titles, right against the rulings at each bar:**

| bar /18 | l1 | l3 | l4 | l5 | l6 | total of 5 |
|---|---|---|---|---|---|---|
| 5 | 100% | 24% | 100% | 100% | 81% | 4.05 |
| 6 | 100% | 51% | 100% | 100% | 81% | 4.32 |
| 7 | 100% | 79% | 100% | 100% | 81% | 4.60 |
| 8 | 100% | 92% | 98% | 100% | 81% | 4.71 |
| 9 | 100% | 89% | 90% | 100% | 81% | 4.61 |
| 10 | 100% | 74% | 74% | 100% | 81% | 4.30 |
| 11 | 100% | 50% | 50% | 100% | 81% | 3.80 |
| 12 | 100% | 27% | 27% | 100% | 81% | 3.35 |
| 13 | 100% | 11% | 9% | 100% | 81% | 3.01 |
| 14 | 100% | 5% | 2% | 100% | 81% | 2.88 |

With titles the best total is 2.99 of 5 (bar 12). Steadiness summed over the eight lectures,
without titles: 6.84 at bar 7, 6.68 at bar 8, 6.51 at bar 9; with titles, 7.64 at bar 11.

**Without titles, steady at each bar:**

| bar /18 | l1 | l2 | l3 | l4 | l5 | l6 | l7 | l8 |
|---|---|---|---|---|---|---|---|---|
| 5 | 100% | 100% | 27% | 59% | 100% | 62% | 98% | 100% |
| 6 | 100% | 100% | 0% | 92% | 100% | 62% | 91% | 100% |
| 7 | 100% | 100% | 56% | 99% | 100% | 62% | 66% | 100% |
| 8 | 100% | 100% | 83% | 96% | 100% | 62% | 28% | 100% |
| 9 | 100% | 100% | 82% | 82% | 100% | 62% | 28% | 100% |
| 10 | 100% | 100% | 49% | 48% | 100% | 62% | 64% | 100% |
| 11 | 100% | 100% | 2% | 0% | 100% | 62% | 68% | 100% |
| 12 | 100% | 100% | 45% | 45% | 100% | 62% | 26% | 100% |
| 13 | 100% | 100% | 76% | 51% | 100% | 62% | 26% | 100% |
| 14 | 100% | 100% | 86% | 0% | 100% | 62% | 72% | 100% |

**With titles, steady at each bar:**

| bar /18 | l1 | l2 | l3 | l4 | l5 | l6 | l7 | l8 |
|---|---|---|---|---|---|---|---|---|
| 5 | 98% | 100% | 53% | 0% | 100% | 100% | 100% | 100% |
| 6 | 92% | 100% | 87% | 1% | 100% | 100% | 100% | 100% |
| 7 | 70% | 100% | 99% | 4% | 100% | 100% | 100% | 100% |
| 8 | 25% | 100% | 100% | 14% | 100% | 100% | 100% | 100% |
| 9 | 25% | 100% | 100% | 60% | 100% | 100% | 100% | 100% |
| 10 | 70% | 100% | 97% | 90% | 100% | 100% | 98% | 100% |
| 11 | 92% | 100% | 88% | 98% | 100% | 100% | 86% | 100% |
| 12 | 98% | 100% | 70% | 100% | 100% | 100% | 55% | 100% |
| 13 | 100% | 100% | 40% | 100% | 100% | 98% | 0% | 100% |
| 14 | 100% | 100% | 17% | 100% | 100% | 83% | 55% | 100% |

**Where grouping without titles is unsettled:**

- l6: runs split between a topic starting at subtopic 11 (15 of 36) and at 12 (21 of 36), so
  it is right 81% of the time at every bar.
- l7 (unruled): 36 runs made three groupings, all sharing topic starts at 2, 4, 7 and 12:
  10 and 11 both start topics (16 runs), neither does (12), 10 only (8). With titles: 9
  starts one (22), neither (11), 9 and 11 (3).

**Open:** whether grouping drops titles (the earlier ruling was that it sees them), the bar,
and a ruling on l7.
