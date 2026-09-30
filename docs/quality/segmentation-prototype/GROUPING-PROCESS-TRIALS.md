# Grouping process trials, 2026-09-30

Whether giving the grouping model a process, a second pass, or more thinking fixes
the grouping errors left after `DIVISION-AND-GROUPING-RESULTS.md`. Every trial ran on
the live 18-run chosen divisions (`runs/chosen-live18-l*`), without subtopic titles,
with Gemini 3.7 Flash. Almost all of it is on lecture 4, whose ruling is carried to
the live division as topic starts 2, 7, 9, 14, 18, 22, with 4 set to either and 16
to same topic. Written by hand from the run files named in each section.

**In short.** g15 stays the grouping prompt. No process prompt (g16–g19), second pass
(g20, g21) or blind judge (j2) beat it on lecture 4. The one part that worked is g18's
step 1 as a finder of candidate borders. Every design that decides between leaving a
grouping as it is and changing it chose to leave it, 95 times out of 95 in g18 to g20.
On lecture 4 the model reads subtopics 7–17 as one announced survey, citing the summary
at 17 and the list the lecturer sets out at 7, and no design moved that.

## Where single g15 runs go wrong

Single runs, g15 at default effort, 36 per lecture: runs matching the rulings.

| lecture | with titles | without titles |
|---|---|---|
| l1 | 20/36 | 32/36 |
| l3 | 6/36 | 13/36 |
| l4 | 8/36 | 16/36 |
| l5 | 36/36 | 34/36 |
| l6 | 30/36 | 21/36 |

Which way the wrong runs fail, without titles (positions on the live divisions):

| lecture | wrong | how |
|---|---|---|
| l1 | 4 | all add a start at 5 |
| l3 | 23 | 6 only merge, 7 only add a start, 10 both: a topic started at 8 or 9 instead of 10, and the one-subtopic topics at 10 and 11 merged |
| l4 | 20 | 16 merge (miss 9 or 14); 4 add a start at 16 |
| l6 | 15 | all start the topic at 11 instead of 12, one early, at the passage that sums up and announces what comes next |

With titles, l3 is 25 runs starting at 9 and merging 10–11, l4 is all merges, l6 is
6 runs missing 8. So the errors go every way (merge, split, border one or two early),
and every one is local. l3's ruling asks for two single-subtopic topics, which g11's
limit on single-subtopic topics discourages.

## Thinking level

`TRIAL_EFFORT` sets OpenRouter's `reasoning.effort` (Gemini thinking level: minimal,
low, medium, high; medium is the default). Runs made with it carry `%<level>` in their
stem.

g15 on l4, single runs matching the ruling:

| effort | right | output tokens | seconds |
|---|---|---|---|
| low | 0/3 (all add a start at 6, which no default run made) | 410–540 | 5 |
| default | 16/36 | median 3,070 | ~20 |
| high | 2/3 | 8,350–9,200 | ~55 |

For g20 (below) the level changed nothing: low, default and high made identical
decisions on all six inputs, with visible replies of 876, 986 and 1,046 words on
average. The extra tokens are hidden thinking. Effort matters when the model builds a
grouping, not when it judges one.

## One call with a process: g16 to g19

All at high effort, 3 runs each on l4.

| version | change | right |
|---|---|---|
| g15 | control | 2/3 |
| g16 | step 1 rates every boundary start, continues or unsure with a reason; step 2 decides the unsure ones between the stretches either side; step 3 revisits; step 4 writes topics | 1/3 |
| g17 | g16 with step 1's forward look stopped at the next turn | 0/3 |
| g18 | g17 with `continues` tied to what the stretch before is about, named narrowly, and a wider sequence ruled out as a reason | 0/3 |
| g19 | g18 with step 2's stretch after stopped at the next boundary not rated continues, and both stretches named first | 1/3 |

- g16: two runs set a frame at boundary 7 (a forward stretch to 17, "systematic
  examination of specific carcinogenic agents") and rated 9 and 14 continues inside it.
- g17: the frame came from how the start at 7 was described, not how far the model looked.
- g18: step 1 now rated 9 and 14 unsure every time. Step 2 then chose "before" at
  every one.
- Step 2 across g18 and g19: 42 decisions, all "before". 31 were extra candidates
  (never starts) and 1 was 4, so those were right; the 10 at 9 and 14 were wrong.
  Step 3 never changed a decision; step 4's list check never fired.

**Step 1 of g18 as a finder.** In the six g18 and g19 runs it never rated a ruled start,
or 16, "continues". It dropped 4 (either) in 4 of 6 and rejected 6 and 17 (started only
by the low-effort runs) every time. The cost is extra candidates: 10, 11, 13 and
sometimes 19–21, 5 to 9 flagged sites per run. Not yet tried on any other lecture.

## A second call: g20 and g21

**g20** gets the full text and a g15 run's grouping as another reader's draft, and may
keep, move, remove or add borders, arguing each both ways. Fed three wrong and three
right default g15 runs (instances 2, 5, 23 and 1, 6, 7), at low, default and high
effort: 18 calls, every border kept and every topic kept whole. It found the ruled
division point inside the merged topics (14, and 9) and argued for it correctly, then
kept the topic whole: "7 through 17 constitute a continuous catalog … unified and
summarized together in Subtopic 17". It kept the right groupings just as firmly, so it
approves whatever draft it is shown.

**g21** gets the full text and one g18/g19 run's step 1 marks as a skim: marks rated
start are settled and not revisited, marks rated unsure are open, stated to be neither
evidence for nor against a start. Every mark is a provisional cut, so each unsure mark
is judged between its neighbouring marks. Pass 2 sees only the mark ids, never the
skim's reasoning (the user's call). Six calls at default effort, one per skim: none
right. 9 was decided no start in all 5 skims where it was open, 14 start in 1 of 5;
32 of 33 extra marks were rejected, and the one accepted (3) is wrong. The case against
9 is the argument the rules forbid: "Dietary carcinogens are simply another category in
the lecture's systematic survey".

## A blind choice: j2

j2 (in `judge-prompts.mts`, run by `stretch-judge-trial.mts`) gets one stretch and two
arrangements of it as topic starts only, no labels or reasons, neither called a draft,
with g20's border rules. Each comparison run 3 times in each order, default effort.

| comparison | right answer | right |
|---|---|---|
| start at 9 (7–13) | split | 4/6 |
| start at 14 (7–17) | split | 1/6 |
| control at 16 (14–17) | whole | 4/6 |
| control at 11 (9–13) | whole | 6/6 |

15 of 24 right. Without a draft it does change things, but the arrangement listed first
won 15 of 24, and 5 of 6 on 9. It still merges at 14 on the summary at 17, against a
case for splitting that cites the lecture's own learning outcome ("discuss the relative
roles of cancer initiators and promoters"). The copied rule that a summary belongs with
what it sums up may be feeding that argument; a sentence that a summary drawing several
topics together does not make them one topic is untested.

## The reading of lecture 4 the model keeps

How the 72 default g15 runs (36 with titles, 36 without) arrange 7–17:

| arrangement | runs |
|---|---|
| one topic | 30 |
| starts at 7, 9, 14 (the ruling) | 24 |
| starts at 7, 9 | 13 |
| starts at 7, 9, 14, 16 | 4 |
| starts at 7, 14 | 1 |

2–6: one topic in 52, split at 4 in 20. The ruling is the runs' second most common
reading of 7–17. Every judging design above ends at the same place on 9: it sees the
turn from pathogens to diet and chemicals, names it, and keeps 7–13 as one survey the
lecturer announced at 7. The review page
<https://claude.ai/artifact/85Be8sJrZELUieUZRzHySS> shows the full lecture with every
border marked, the run counts, the ruling and the model's cases at 4, 9, 14 and 16;
`analysis-2026-09-30/build_l4_borders.py` rebuilds it.

## Not yet tried

- g21, or g18's step 1 alone, on l3 and l6, where the errors are borders placed one
  subtopic off rather than merges.
- j2 with the summary sentence (a j3), and with both cases made before the arrangements
  are numbered, to cut the position effect.

## Files

- Prompts: g16–g19 in `GROUP_PROMPTS`, g20 and g21 in `EDIT_PROMPTS` (`group-prompts.mts`);
  j2 in `judge-prompts.mts`. The reply-format examples of g16–g19 carry small concrete
  ids (2, 5, stretches like 3–5); g20 onwards use placeholders.
- `group-trial.mts` runs an edit version against a first-pass run: by default the
  first pass's run of the same instance at default effort, or the run `FIRST_PASS_RUN`
  names. g21 instances are named for their skim, e.g. `g18.1`.
- Runs: `group-g15%high+nolabels-…`, `group-g15%low+nolabels-…`,
  `group-g1[6-9]%high+nolabels-…`, `group-g20{,%low,%high}+nolabels-chosen-live18-l4-<g15 instance>`,
  `group-g21+nolabels-chosen-live18-l4-g1[89].<n>`,
  `judge-j2-chosen-live18-l4-<first>to<last>-<starts>-vs-<starts>-<n>.json`.
