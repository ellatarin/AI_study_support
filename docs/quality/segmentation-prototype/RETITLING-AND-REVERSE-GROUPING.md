# Retitling and reverse-read grouping, 2026-09-30

Two results from one session. Subtopic titles are now written by one call per lecture on
GPT-6.1 Sol Pro (`r9`), and the user judged them good enough to build into the pipeline as they
stand. Grouping those retitled subtopics into topics with `g23` (`g15` reading the subtopics in
reverse) on the same model gave results the user judged acceptable on all eight lectures.

This reverses the 2026-09-29 ruling that retitling comes after grouping: grouping now sees the
new titles. The technical design, plan and tickets still describe the old order.

All runs are on the live 18-run chosen divisions (`runs/chosen-live18-lN.blocks.json`). The
scripts behind every table are in `analysis-2026-09-30/`; the model runs are in `runs/`.

## Retitling

### What the stage does

One call per lecture, not one per subtopic. The model is given every subtopic's id and full
text, in order and without titles, works through them one at a time, and replies with one
title per subtopic. Every subtopic is retitled, not only the ones whose title deepening
inherited.

### Settled choice

`r9` on `openai/gpt-6.1-sol-pro`, default effort, one run per lecture. The user: the titles are
"really good and also stable enough to actually rely on one run… this should be built into the
pipeline as is."

`r9`'s rules, each version adding to the last as recorded in `retitle-prompts.mts`:

| rule | says |
|---|---|
| R1 | title it from what the transcript says in it |
| R2 | name nothing covered in the subtopics before or after |
| R3 | sentence case |
| R4 | say what the whole subtopic develops, specific enough to tell it from its neighbours |
| R5 | the best short description of its subject matter for a science undergraduate, using the most precise words |
| R6 | a recap begins "Summary of"; the lecture's closing part begins "Lecture summary:" or "Lecture close:" |

### How it got there (lecture 4, 22 subtopics, 4 runs each unless said)

| version | model, effort | change | mean words | titles identical in all 4 runs | finding |
|---|---|---|---|---|---|
| r3 | Flash, high | one call per subtopic (1 run) | — | — | short; recaps at 17 and 22 not marked |
| r4 | Flash, high | whole lecture in one call | 7.6 | — | more specific; the user preferred it to r3 |
| r5 | Flash, high | lead with the main point, then the subjects a student must learn | 9.1 | — | steadiest on Flash, most specific, longest |
| r6 | Flash, high | main point or points, subjects sentence dropped | 8.5 | — | drift returned: the subjects sentence was doing the work |
| r7 | Flash, high | best short description for a science undergraduate | 7.4 | — | shortest; less specific than r5 |
| r7 | Claude Sonnet 5.5, high | — | 8.3 | — | steady; recaps marked 4 of 4 |
| r7 | GPT-6.1 Sol Pro, high | — | 7.1 | 2 | steady and concise; lecture close never marked |
| r7 | GPT-6.1 Sol Pro, default | — | 7.3 | 2 | as good as high at about a third of the thinking |
| r8 | GPT-6.1 Sol Pro, default | R6 name summaries | 7.6 | 2 | 17 and 22 marked in 4 of 4, nothing else marked |
| **r9** | **GPT-6.1 Sol Pro, default** | R5 asks for the most precise words | **7.5** | **7** | adopted |

`r9` then retitled all eight lectures, one run each (`runs/retitle-r9@gpt-6.1-sol-pro-all-chosen-live18-lN-1.json`,
applied in `runs/chosen-live18-rt9-lN.blocks.json`). R6 marked summaries or closings on every lecture.

Retitling one lecture cost $0.025–0.093, $0.064 on average (11 calls).

## Grouping

### Versions added

| version | from | change |
|---|---|---|
| g22 | g15 | each subtopic's label (its title) only, no text |
| g23 | g15 | Method step 1 reads the subtopics in reverse order, last to first, noting each place where there is a change |
| g24 | g22 | the same reverse reading, labels only |

### Lecture 4 first (4 runs each, GPT-6.1 Sol Pro, default effort)

Rulings: starts at 2, 7, 9, 14, 18; 4 either way; 16 and 22 stay with the topic before. On this
division 22 holds what the ruled division cut as 22 (risks and benefits) and 23 (the closing
summary), so every model making 22 its own topic is a judgement call, not a clear error.

| version | topic starts | runs alike |
|---|---|---|
| g22, titles only | 1, 2, 4, 7, 9, 14, 18, 20, 22 | 3 of 4 (the fourth starts at 3, not 4) |
| g24, titles only, reverse | 1, 2, 4, 7, 9, 14, 18, 20, 22 | 3 of 4 (the fourth starts at 3, not 4) |
| g15, titles and text | 1, 2, 4, 7, 9, 14, 16, 18, (19), 22 | two pairs |
| g23, titles and text, reverse | 1, 2, 4, 7, 9, 14, 16, 18, 22 | 4 of 4 |

Every version found every ruled start. The user: whether 16 or 20 starts a topic "really all
depends on the titling".

### Every lecture, g23 on Sol Pro (5 runs each)

"Split" is how the five runs divide into identical groupings; 4–1 is four alike and one other.
A site is any subtopic after the first, where a topic could start.

| lecture | subtopics | split | sites where all 5 agree | topics per run |
|---|---|---|---|---|
| 1 | 16 | 5 | 15 of 15 | 10 |
| 2 | 15 | 4–1 | 11 of 14 | 8–9 |
| 3 | 17 | 4–1 | 15 of 16 | 9–10 |
| 4 | 22 | 5 | 21 of 21 | 9 |
| 5 | 17 | 3–1–1 | 14 of 16 | 8–10 |
| 6 | 19 | 5 | 18 of 18 | 10 |
| 7 | 12 | 3–2 | 10 of 11 | 8–9 |
| 8 | 23 | 3–1–1 | 20 of 22 | 14–15 |
| all | 141 | — | 124 of 133 (93%) | — |

The user reviewed every run and judged them all acceptable, lecture 1 included.

### Sol Pro splits finer than the rulings

On the four ruled lectures Sol Pro finds every ruled start and adds others: lecture 1 has 10
topics against 5 ruled (extra starts at 5, 7, 11, 12, 14); lecture 3 adds 3 and 8; lecture 4
adds 16; lecture 6 makes the two "Summary of…" subtopics, 10 and 11, a topic of their own.

It is the model, not the titles: withholding the titles on lecture 1 gave 10 or 11 topics.
Asked which of g23's rules require dividing each ruled topic of lecture 1
(`rule-probe.mts`, 2 runs), Sol Pro cited only R5 both times: it reads "better reasons" as
"narrower reasons", and reads R5's single-subtopic exception ("a question neither neighbouring
topic is asking") as met by 11, 12 and 13 in turn. Shown the ruled 2–8, it kept it whole. The
user accepted the finer grain; a rewording of R5 was proposed and not taken up.

### Against other models (g23)

| model and input | sites where all runs agree, 5 lectures (4 runs) | on the rulings |
|---|---|---|
| Sol Pro, titles and text | 97.5% (79 of 81) | finds every ruled start; splits finer |
| Sol Pro, titles and text, forwards (g15) | 93.8% (76 of 81) | as above |
| Flash, titles and text | 92.6% (75 of 81) | too coarse: lecture 4 merges 7–17 in all 4 runs |
| Flash, text only | 87.7% (71 of 81) | 10 of 16 runs match every ruling |
| Flash, text only, forwards (g15), the design as it stood | 87.8% (average of nine sets of 4) | 82 of 144 runs match every ruling |

The five lectures are 1, 3, 4, 6 and 7. Across all eight lectures with five runs each:

| model | sites where all 5 agree | lectures unanimous | lectures where no two runs agree |
|---|---|---|---|
| GPT-6.1 Sol Pro, default | 124 of 133 (93%) | 1, 4, 6 | none |
| GPT-6 Luna Pro, default | 108 of 133 (81%) | 1 | 4, 8 |
| GPT-6 Luna Pro, high (lectures 4 and 8 only) | 28 of 43 | none | 4, 8 |

Luna Pro costs about a twentieth as much per call and matches Sol Pro's choice on lecture 1,
but high effort did not steady it.

### Choosing from a panel

The user's rule for a panel of five: take the grouping the most runs give, whole grouping
against whole grouping; on a tie, the one with the most topics; if still tied, the one closest
to the site vote (a border starts a topic when most runs start one there).
`analysis-2026-09-30/choose_panel.py` applies it; `score_groupings.py` scores runs against the
rulings. Applied to Luna Pro, where all five runs differed on lectures 4 and 8, "most topics"
chose the most fragmented run (12 topics on lecture 4, 3 more than any other run); with Sol
Pro no lecture reached that tie-break.

### Cost

| per lecture | average | range |
|---|---|---|
| grouping call, Sol Pro | $0.089 | $0.029–0.123 (32 calls) |
| retitle once, group 5 times | $0.51 | $0.17–0.71 |
| the design as it stood: 18 Flash grouping runs | $0.37 | — |

## Traps

- **Sol Pro is rate-limited upstream when several calls run at once.** OpenRouter returns this
  as an `error` inside a normal reply with empty content, not as a failed request. The trials
  retried; the pipeline stage must too. `callTrialModel` now records the error.
- **Sol Pro's reported input tokens vary** from about 11,000 to 44,000 for the same input.
  The lower figures match what is sent; the costs above use the reported figures.
- **Rulings are carried by where a border falls**, within 1% of the transcript, because the
  live divisions cut a sentence or two away from the ruled ones (lecture 4's 16 is at 75.3%
  here and 76.0% on the ruled division).
- **Lecture 8's transcript ends mid-sentence** ("But your child will have a life that-"); the
  division carries it whole.

## Review pages

- Retitles, every version and model on lecture 4: https://claude.ai/artifact/XRXqRbLDCSubvgNvoAZQWr
- g23 on Sol Pro, all eight lectures, full text with rulings marked: https://claude.ai/artifact/3GmB8q5ToYLAJ8w9S11KoL
- g22 on lecture 4: https://claude.ai/artifact/KjnTRJ2kJ95xZVMeVaruwk
