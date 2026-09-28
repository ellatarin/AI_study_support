# 05 — `initial-subtopic-splitting`

**What to build:** running the pipeline on a lecture now produces, right after transcription, `panelSize` initial splitting runs, each dividing the whole transcript into subtopics. The stage is built to the technical design's "Dividing the transcript" section, then compared against the prototype.

**Blocked by:** 04

**Status:** resolved

- [x] The stage runs after transcription and before the existing structuring stage; every existing stage still runs unchanged.
- [x] Each run sends the whole transcript with the prototype's `s6` prompt, byte-identical, and gets back each subtopic's opening words, label and `groupedBecause` — never text.
- [x] Opening words are found with case and whitespace ignored, forward from the previous cut; a quote starting one or two words into its sentence moves the cut back to the sentence start; a quote that cannot be found is never guessed and counts as a failed send.
- [x] Each saved run holds each subtopic's start and end position in the transcript, its label and its `groupedBecause`.
- [x] Before a run is saved, its subtopics joined in order equal the transcript character for character; a mismatch fails the stage as a bug.
- [x] Panel size, retries, saving and relaunch use ticket 04's shared behaviour.
- [x] A required `division` section with `panelSize` (9) is added to the settings, the example settings file and the user's own settings file; the stage's model is set per stage, `google/gemini-3.7-flash` in the example.
- [x] **Replay against the prototype:** a one-off script in the prototype folder feeds every saved prototype `s6` reply, across all 8 lectures, through the new cut-finding and slicing code, and the positions match the prototype's own run files exactly. Any difference is explained or fixed.
- [x] **Live run:** the stage runs for real on one lecture (cost stated to the user first). Its subtopic counts and cut sites fall within the range the prototype's `s6` runs showed on that lecture.
- [x] The replay script and comparison results stay in the prototype folder, not in the pipeline's tests.

## Comments

**2026-09-28, progress.** Done and committed:
- `6f7ed45`: cutting, `division.ts`
- `183bd46`: the required `division` settings section

The ported `s6` prompt is verified byte-identical to the prototype.

Then, in `ff91446`:
- the stage itself, its prompt and its tests, all passing
- the shared transcript reader (`stage-input.ts`), for the division stages only
- the stage's id, folder, label, place in the run order and settings entry
- the plan's test names; suite version 1.52-draft

The example settings file names the stage's model as a placeholder, `<FAST_LONG_CONTEXT_MODEL>`, as the technical design does and as every other model stage there does; `google/gemini-3.7-flash` is in the user's own settings.

The old structuring and verification stages repeat three passages of the new code. They are going away, so those passages are exempt from the duplicate check until the stages are deleted.

**Replay.** `replay-initial-splitting.mts` in the prototype folder, results in `REPLAY-INITIAL-SPLITTING.md`. Of 144 saved `s6` runs (18 per lecture), 136 match the prototype's blocks exactly and no quote goes unfound. The other 8 (two in lecture 3, six in lecture 4) differ only where a subtopic opens with the lecturer's "So": the pipeline takes it into the new subtopic, the saved blocks left it at the end of the one before. Those runs were saved before the prototype's cutter gained that same rule, and cutting them with the cutter as it stands today matches the pipeline exactly.

**Live run, lecture 6 (2026-03-11).** Lecture 6 rather than 3: the transcripts of lectures 3, 4 and 5 still hold the transcriber's `[chuckles]`-style notes, and the prototype cut those tagged versions, so re-transcribing any of them would compare against runs made on a different text. Lecture 6's transcript has no tags and is exactly what the prototype cut.

- Subtopic counts: live 9 runs of 9 and one of 10; prototype 17 runs of 9 and one of 10.
- Every live cut but one falls at a character position some prototype run also cut at. The one exception, in the run of 10, opens "So I just want to say that senescent signalling…"; no prototype run cut within 1% of it.
- Every run joins back into the transcript exactly.
- 9 calls, 108,900 tokens in and 26,310 out, about $0.18. The run summary shows the cost as n/a: every cost lookup returned "404 Generation … not found", the existing lookup-timing defect (issue #10), not this stage.

Found along the way, not fixed here: when a stage fails partway, the panel's calls already in flight run on, cost money and save their files. Nothing is lost, since a relaunch reuses those files, but the spend continues after the failure.

Rulings made along the way:
- A missing quote resends the whole run.
- The transcript is trimmed once, when it is read.
- The old structuring and verification stages are left untouched.
