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
- [ ] The manifest and the run log record the status `bypassed` for each bypassed stage.
- [ ] A later run keeps the `bypassed` entry in the manifest, and does not run the stage again.
- [ ] The readers of both files require `bypassed`.
- [ ] The notes page and the Notes PDF show the fact-check line of each case.
- [ ] The technical design, the requirements and `CONTEXT.md` describe the switch, the flag, the status and the markers.
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
