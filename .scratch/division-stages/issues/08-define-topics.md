# 08 — `define-topics` (grouping)

**What to build:** the retitled subtopics are grouped into topics by a panel of five grouping runs, and the grouping most of them made becomes the lecture's topics, taken whole from one run (CONTEXT.md, "Chosen grouping"). Built to TD §5, `define-topics`, and plan Phase 14, then compared against the prototype and run live together with retitling. Judging the lecture title is not part of this ticket.

**Blocked by:** 11, 12

**Status:** resolved

- [x] Each grouping run sends every retitled subtopic's id, title (as `label`, the prompt's word) and trimmed text, with the prototype's `g23` prompt in its titled form, byte-identical.
- [x] A reply is valid when it is a JSON object with a non-empty list of topics; every topic has a non-blank title, a non-blank `groupedBecause` and a first subtopic; the first topic starts at subtopic 1; each later start comes after the one before; no start is past the last subtopic. Anything else is a failed send (ticket 04's retries, then the stage fails). The reported finish reason is not checked: a valid reply reporting `error` is accepted.
- [x] The five runs are released together, and every send the stage makes — first sends, resent bad replies, resent refusals (ticket 12) — waits until at least `sendGapSeconds` after the stage's previous send. `sendGapSeconds` is accepted on this stage only and is a config error on any other; unset, sends are not spaced.
- [x] `panelSize` (5) and `bar` (3) come from a new required `grouping` settings section, added to the settings, the example file and the user's own; the bar may not exceed the panel size. The stage's entry sets `openai/gpt-6.1-sol-pro`, `concurrency` 5 and `sendGapSeconds` 0.5 in the user's file; no reasoning-effort setting is sent.
- [x] The grouping is chosen by: the grouping the most runs made (runs with the same topic starts are the same grouping, whatever they named their topics); when two or more groupings share the most runs and each was made by more than one run, the one with more topics; when no grouping was made by more than one run, or the tied ones have as many topics, the one closest to the vote (ticket 07's vote and distance, at `bar`); then the earliest run. The topics handed on are the earliest run's among those that made the chosen grouping.
- [x] Each run is saved in `Grouping runs/run-NN.json` with the model's full reply; `Topics/topics.json` holds each topic's title, `groupedBecause` and first subtopic from the chosen run.
- [x] `Topics/choice.json`, beside the topics, records the chosen run, how many runs made its grouping, the panel size, and which rule decided (most runs, more topics, closest to the vote, earliest run).
- [x] **Replay against the prototype:** a one-off script feeds the prototype's saved `g23` runs on each lecture's `r9`-retitled division (4 per lecture) through the new choice at bar 3 and compares it with what `analysis-2026-09-30/choose_panel.py` chooses from the same runs. That script asks "more topics" even when every run differs, which this rule does not; each difference is explained, any other fixed.
- [x] **Live run:** `retitle-subtopics` and `define-topics` together on one lecture (about $0.51; the cost is stated and agreed first); the new titles and chosen topics are shown beside the prototype's for the user to read, with any refusal warnings from the log reported.
- [x] The replay script and results stay in the prototype folder.

## Comments

2026-09-29, redesigned before any build (grill rounds 1–2, TD 9eb37fb): `g12` → `g15` (adds a rule that a subtopic only looking back ends the topic before); the modal grouping → the run nearest a 9-of-18 vote, chosen with `choose-division`'s chooser; panel 9 → 18; the manifest records chosen run and distance instead of "modal, 5 of 9"; `label` → title. On each lecture's chosen division, `g15`'s chosen grouping matched the user's rulings on all five ruled lectures.

2026-09-30, redesigned before any build (grill, TD 374a543): grouping now reads the `r9` titles from `retitle-subtopics`, which comes first. `g15` → `g23` (reads the subtopics last to first, noting changes); `google/gemini-3.7-flash` → `openai/gpt-6.1-sol-pro`; panel 18 → 5, bar 9 → 3; the chooser is the user's most-identical-runs rule, with the vote only breaking ties; `groupedBecause` is kept in the topics file; the manifest records support and the deciding rule instead of distance. The user judged all 32 prototype `g23` groupings (4 runs × 8 lectures) acceptable. Now blocked by 11 and 12.

2026-10-03, seams agreed: `sendGapSeconds` 2 → 0.5 (the user's call: 2 is too long). A complete answer arriving with the provider's error is now kept rather than resent (ticket 16), so the finish-reason checkbox above holds at the completion call, not in this stage.

2026-09-30: the record of how the result was reached moved from the manifest to a small file beside the output (the user's choice; TD §4.5, "How a result was reached is kept beside the result").

2026-10-03, replay: `replay-grouping-choice.mts` fed runs 1–4 of each lecture's saved `g23` panel through the stage's choice at bar 3. All 8 lectures chose the same topic starts from the same run as `choose_panel.py` (`REPLAY-GROUPING-CHOICE.md`). The known difference did not arise: no lecture's four runs all differed. l7 was the one tie, settled by more topics in both.

2026-10-03, panel 5 → 9 (the user's call), bar 3 → 5 (more than half the panel), `concurrency` 5 → 9 so the panel is still released together (TD 1.68-draft). Live runs on lecture 4 (`LIVE-GROUPING-L4.md`) found 18–21 a close call whose lean shifted with title wording and from batch to batch; drawn from the saved runs, a panel of 5 chose the grouping the user rejects (a topic starting at 19) in up to about 1 panel in 15, a panel of 9 in about 1 in 70 or fewer (`PANEL-RISK.md`).

2026-10-04, live run done: lecture 4 first (`LIVE-GROUPING-L4.md`), then all eight lectures with the panel of 9 (`LIVE-ALL-LECTURES.md`, output in `live-runs/all-2026-10-03/`), read by the user. No refusal warnings and no answers kept beside a provider error. Retitling stays on `r9` (the user's call after trying `r10` and `r11` on lecture 6).
