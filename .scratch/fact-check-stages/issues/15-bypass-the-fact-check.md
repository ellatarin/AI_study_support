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

- The correction is bypassed when its own switch is on, or when `factual-errors.json` holds `"bypassed": true`. Each stage keeps its own switch.
- A bypassed correction makes no model call. Each subtopic keeps its rewrite.
- Each subtopic file in `Fact corrections/`, and each entry of `fact-corrected-subtopics.json`, holds `"bypassed": true`. A correction that runs writes `"bypassed": false`.
- A correction that runs, on a lecture with no factual errors, makes no call. Its status is `complete`, and it writes `"bypassed": false`. This is not a bypass.

**The record in the manifest and the run log**

- A bypassed stage gets the status `bypassed`, not `complete`. This applies to the stage entry in the manifest and to the `ran` entry in the run log.
- A `bypassed` stage is a completed stage when its recorded files are on disk. A later run does not run it again.
- A later run leaves a `bypassed` entry in the manifest as it is. It does not write `skipped` over it. The run log of that later run records `skipped` for the stage, as for any completed stage.
- `--from-stage` resets a `bypassed` stage as usual.

**The notes page**

- A bypassed fact check puts this line at the top of the page: "The facts in these notes were not checked."
- A fact check can run while the correction after it is bypassed. The Corrections view then lists the errors found, with no changes. The line at the top of the page is "The facts were checked, but the errors found were not corrected."
- The page reads the `bypassed` markers of the files. It does not read the manifest.

**Old files**

- A file of `Fact checks/` or `Fact corrections/` without `bypassed` is not the documented shape. The reader fails with its usual named error. To rebuild such a page, the user reruns with `--from-stage correct-factual-errors` or earlier. Pages already built do not change.

## To agree before the code

- The glossary entry, through the domain-modeling skill. The proposal: **Bypassed stage**: a stage that its config or a flag turned off. A stage is also bypassed when the stage before it was bypassed, so that it has no input. It makes no model call. It writes its output files, which say that they are bypassed. It is a completed stage. _Avoid_: skipped (a skipped stage is one that a later run did not run again). Change **Completed stage** to name `bypassed` with `complete` and `skipped`.
- The seams and the test list, through `/tdd`.

## Boxes

- [ ] `stages.check-facts.bypass` is a required config key. The example config has `false`.
- [ ] `--fact-check run|bypass` overrides it for one run, on `run` and `batch`. The usage text lists it. A bad value is a usage error that names the accepted values.
- [ ] A bypassed fact check makes no call and writes `factual-errors.json` with `"bypassed": true` and empty lists.
- [ ] The fact correction is bypassed by its own switch, or by a bypassed fact check. Its files hold `"bypassed": true`.
- [ ] The manifest and the run log record the status `bypassed` for each bypassed stage.
- [ ] A later run keeps the `bypassed` entry in the manifest, and does not run the stage again.
- [ ] The readers of both files require `bypassed`.
- [ ] The notes page shows the line of each case.
- [ ] The technical design, the requirements and `CONTEXT.md` describe the switch, the flag, the status and the markers.
- [ ] The user reruns Host-Pathogen Interactions lecture 2 with `--fact-check bypass`, and checks the page.
