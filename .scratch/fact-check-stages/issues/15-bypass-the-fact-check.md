# 15 — Bypass the fact check, and record each bypass

**Status:** ready-for-agent

**Blocked by:** none

**The problem:** on 2026-10-15, `check-facts` failed on Host-Pathogen Interactions lecture 2 (2026-10-09). The error was "Fact check by anthropic/claude-opus-5.5 failed after 3 sends: The model's reply was empty". Each send read about 10,500 prompt tokens and wrote about 3,100 tokens. The three sends cost $0.31. The cause can be a content filter that stops a reply part way, or reply tokens that went to the model's thinking. The pipeline does not save the finish reason of a send, so the cause is not known.

The fact check has no switch. The fact correction has one (`stages.correct-factual-errors.bypass`, `--fact-correction`), but it records the bypass only as `"bypass": true` in `configUsed`. Its status, files and cost look like those of a normal run. The user wants a way past a failed fact check now. The user also wants each bypass on record, so that no reader takes notes as checked or corrected when they are not.

## What the user agreed (2026-10-15)

**The switch and the flag**

| Config key | Flag | Values |
|---|---|---|
| `stages.check-facts.bypass` | `--fact-check` | config: `true` or `false`, required. Flag: `run` or `bypass`, on `run` and `batch` |

- The key and the flag have the same form as those of the fact correction. The flag overrides the config for one run, and the config file does not change.
- A flag with an unknown value is a usage error that names the accepted values.
- A flag changes only the stages that run. This is the same as the other three override flags (`.scratch/run-flags/issues/01`).

**A bypassed fact check**

- It makes no model call, and writes no per-model file.
- It writes `factual-errors.json` with `"bypassed": true`, `"checkedBy": []` and `"factualErrors": []`.
- A fact check that runs writes `"bypassed": false`.

**The fact correction after it**

- Each stage is bypassed by its own switch or flag only. A bypassed fact check does not bypass the correction (user, 2026-10-15).
- After a bypassed fact check, the correction runs as usual. It finds no factual errors and makes no call. Its status is `complete`, and it writes `"bypassed": false`.
- A bypassed correction makes no model call. Each subtopic keeps its rewrite.
- Each subtopic file in `Fact corrections/`, and each entry of `fact-corrected-subtopics.json`, holds `"bypassed": true`. A correction that runs writes `"bypassed": false`.

**The record in the manifest and the run log**

- A bypassed stage gets the status `bypassed`, not `complete`. This applies to the stage entry in the manifest and to the `ran` entry in the run log.
- A `bypassed` stage is a completed stage when its recorded files are on disk. A later run does not run it again.
- A later run leaves a `bypassed` entry in the manifest as it is. It does not write `skipped` over it. The run log of that later run records `skipped` for the stage, as for any completed stage.
- `--from-stage` resets a `bypassed` stage as usual.

**The fact-check line on the notes page and the Notes PDF** (user, 2026-10-15, in place of the two warning lines agreed first)

- Only when both stages ran do the notes say that they are corrected. The line names each fact-check model and the correction model, with the date of the correction, such as "Checked by: gemini-4-argon. Corrected by: gpt-6.1-sol-pro on 15-10-2026". This also holds when the check found no factual errors.
- In each other case, the line is "Uncorrected".
- A model is named by the part of its id after the provider, as it is.
- The date is the date when the correction ran, in the form DD-MM-YYYY. The fact correction saves it in its file.
- On the notes page, the line is under the lecture title, in the small grey type of the date.
- In the Notes PDF, the line is in the top margin, so the text does not move down. It is on the first page only if that is as easy as every page. Otherwise it is on every page.
- The page and the PDF read the files of the two stages. They do not read the manifest.
- The fact-check models come from `checkedBy` in `factual-errors.json`. `fact-corrected-subtopics.json` gets two top-level fields (names agreed by the user, 2026-10-15):
  - `correctedBy`: the model id of the correction, or `null` when the correction was bypassed.
  - `correctedOn`: the date when the correction ran, in ISO form, such as `"2026-10-15"`.

**The terminal**

- A bypassed stage has a line of its own in the terminal, not the line of a completed stage (user, 2026-10-15).

**The status**

- The status `bypassed` works as the other statuses do. The stage returns its result, and the result says that the stage was bypassed. The runner writes the status from the result (user, 2026-10-15).

**Old files**

- A file of `Fact checks/` or `Fact corrections/` without `bypassed` is not the documented shape. The reader fails with its usual named error. To rebuild such a page, the user reruns with `--from-stage correct-factual-errors` or earlier. Pages already built do not change.

## To agree before the code

- The seams and the test list, through `/tdd`.

## Boxes

- [x] `stages.check-facts.bypass` is a required config key. The example config has `false`.
- [x] `--fact-check run|bypass` overrides it for one run, on `run` and `batch`. The usage text lists it. A bad value is a usage error that names the accepted values.
- [x] A bypassed fact check makes no call and writes `factual-errors.json` with `"bypassed": true` and empty lists.
- [x] The fact correction is bypassed by its own switch only. Its files hold `"bypassed": true`. After a bypassed fact check, it runs as usual.
- [x] The manifest and the run log record the status `bypassed` for each bypassed stage.
- [x] A later run keeps the `bypassed` entry in the manifest, and does not run the stage again.
- [x] The readers of both files require `bypassed`.
- [x] The notes page and the Notes PDF show the fact-check line of each case.
- [x] The technical design, the requirements and `CONTEXT.md` describe the switch, the flag, the status and the markers.
- [ ] The user reruns Host-Pathogen Interactions lecture 2 with `--fact-check bypass`, and checks the page.

## Comments

**2026-10-15, glossary:** the term **Bypassed stage** is in `CONTEXT.md`. The user rejected the first entry (e87954cd). A bypassed stage does none of its work, and it does not bypass the stages after it. So the rule that a bypassed fact check also bypasses the correction is removed. The page takes the line "The facts in these notes were not checked." from the marker of the fact check.

**2026-10-15, build state (TDD paused for a context clear):**

- Done, gate passed on each: config switch ab8d8d59, flag 1c63955d, rename to `BYPASS_FLAG_WORDS` 5c6b9e29, bypassed fact check bb58a39d, fact-correction marks with `correctedBy` and `correctedOn` b2fde5ff.
- Not agreed: `correctedOn` is `null` when the correction is bypassed. The user agreed `null` for `correctedBy` only. Ask.
- The CLI test of `--fact-check bypass` never failed first. It was written after the code.
- The slices so far wrote several failing tests at once. The user asked for one test at a time. From here: one test, then its code, then the next test. The user may ask for a check of the done slices: remove each new line in turn and see that a test fails.
- Next slices, in order:
  1. The runner: the stage result says that the stage was bypassed, and the runner writes the status `bypassed` in the manifest and the run log. A later run keeps `bypassed` and records `skipped` in its run log. `--from-stage` resets it. The existing CLI test of `--fact-correction` expects `status: "complete"`. It must change to `bypassed`.
  2. The terminal: a line of its own for a bypassed stage.
  3. The readers: `factual-errors.json` and both fact-correction files require `bypassed`, `correctedBy` and `correctedOn`. The seed fixtures of `check-facts` need `bypassed: false`.
  4. The fact-check line on the notes page and in the Notes PDF.
  5. The docs: technical design, requirements, `CONTEXT.md`.

**2026-10-15, user's answers:** `correctedOn` is `null` when the correction is bypassed ("there is no need for a date if no corrections made"). The fact-check line also names the prompt version of each stage. The form is mine to choose.

**2026-10-15, check of the four done slices:** I broke each new line of code in turn and ran the suites. Each break made a test fail, so no done slice has code that its tests do not check.

| Commit | Break | Result |
|---|---|---|
| ab8d8d59 | The loader ignores the switch | 2 config tests fail |
| ab8d8d59 | The run log drops the switch | The CLI test of `--fact-check bypass` fails, and so does `tsc` |
| ab8d8d59 | The example config loses `"bypass": false` | The config suite fails |
| 1c63955d | The parser ignores `--fact-check` | 4 tests of the command line fail |
| 1c63955d | `run` and `batch` refuse the flag | 4 tests of the command line fail |
| 1c63955d | The flag does not reach the config | 2 config tests fail |
| 1c63955d | The flag always bypasses | 2 config tests fail |
| 1c63955d | The flag adds an entry that the config does not have | 1 config test fails, and 3 others too |
| bb58a39d | The stage ignores the switch | 1 test of check-facts fails |
| bb58a39d | A fact check that runs writes `bypassed: true` | 1 test of check-facts fails |
| bb58a39d | A bypassed fact check writes `bypassed: false` | 1 test of check-facts fails |
| bb58a39d | A bypassed fact check records no file | 1 test of check-facts fails |
| b2fde5ff | A correction that runs records no model | 1 test of the correction fails |
| b2fde5ff | A correction that runs records the wrong date | 1 test of the correction fails |
| b2fde5ff | A bypassed correction records a model and a date | 1 test of the correction fails |
| b2fde5ff | Each subtopic file says `bypassed: false` | 2 tests of the correction fail |
| b2fde5ff | Each subtopic file says `bypassed: true` | 2 tests of the correction fail |
| b2fde5ff | The lecture file loses `correctedBy` and `correctedOn` | 2 tests of the correction fail |

The rename 5c6b9e29 changes no behaviour, so I broke nothing in it. The CLI test of `--fact-check bypass` was written after its code. The second break in the table shows that it can fail.

**2026-10-15, the rest of the ticket, one test at a time:**

- 9774fb52: the runner records `bypassed` in the manifest and the run log. A later run does not run the stage again, keeps the `bypassed` entry, and records `skipped` in its run log. The fact check and the fact correction say in their results when they were bypassed. The CLI test of `--fact-correction` now expects `bypassed`.
- c595174f: the terminal line "↷ <stage> — bypassed, no model call".
- 17183697: the readers refuse a fact file without `bypassed`, and a correction file without `correctedBy` or `correctedOn`.
- a3b810cb: the glossary term **Fact-check line**.
- a7b66aea: the fact-check line under the title of the notes page. Its form is "Checked by: gpt-5.6-sol-pro, claude-opus-5.5 (prompt f2). Corrected by: gpt-4o (prompt k3) on 15-10-2026". A saved subtopic file can come from an earlier prompt, so the line names each correction prompt once, such as "(prompt k2, k3)". The line has the small grey type of the date, but not its capitals, so that the model names keep their case.
- c5d43a76: the fact-check line in the top margin of each page of the Notes PDF, in the 8 pt grey of the page number. Chrome's header writes on every page, and cannot write on the first page only.
- f42ba632 and 2b6e884f: the docs, and the suite version 1.99-draft. The plan has a new Phase 28 for this ticket, so the end-to-end check is now Phase 29.
- 715b92be: one type for the two statuses of a stage that returned.

Tests that did not fail first:

- `--from-stage` resets a `bypassed` stage. The reset sets every stage from the target to `pending`, whatever its status. A test could not fail, so I did not write one.
- The new suite of `factual-errors.json` takes the shared rows for a missing file and for text that is not JSON. Those 3 rows passed at once, because the reader already had that behaviour.
- The stage test with a spoiled `factual-errors.json` passed at once, because the reader's named error already existed.

**Before the user's rerun:** each lecture that ran before this ticket has fact files without `bypassed`. The page cannot be built again from them. The rerun must start at `--from-stage check-facts`, or at `--from-stage correct-factual-errors` to keep the old fact check. But the old `factual-errors.json` has no `bypassed` either, so the correction refuses it. So the rerun starts at `check-facts`.
