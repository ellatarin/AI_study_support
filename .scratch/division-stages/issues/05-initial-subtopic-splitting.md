# 05 — `initial-subtopic-splitting`

**What to build:** running the pipeline on a lecture now produces, right after transcription, `panelSize` initial splitting runs, each dividing the whole transcript into subtopics. The stage is built to the technical design's "Dividing the transcript" section, then compared against the prototype.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] The stage runs after transcription and before the existing structuring stage; every existing stage still runs unchanged.
- [ ] Each run sends the whole transcript with the prototype's `s6` prompt, byte-identical, and gets back each subtopic's opening words, label and `groupedBecause` — never text.
- [ ] Opening words are found with case and whitespace ignored, forward from the previous cut; a quote starting one or two words into its sentence moves the cut back to the sentence start; a quote that cannot be found is never guessed and counts as a failed send.
- [ ] Each saved run holds each subtopic's start and end position in the transcript, its label and its `groupedBecause`.
- [ ] Before a run is saved, its subtopics joined in order equal the transcript character for character; a mismatch fails the stage as a bug.
- [ ] Panel size, retries, saving and relaunch use ticket 04's shared behaviour.
- [ ] A required `division` section with `panelSize` (9) is added to the settings, the example settings file and the user's own settings file; the stage's model is set per stage, `google/gemini-3.7-flash` in the example.
- [ ] **Replay against the prototype:** a one-off script in the prototype folder feeds every saved prototype `s6` reply, across all 8 lectures, through the new cut-finding and slicing code, and the positions match the prototype's own run files exactly. Any difference is explained or fixed.
- [ ] **Live run:** the stage runs for real on one lecture (cost stated to the user first). Its subtopic counts and cut sites fall within the range the prototype's `s6` runs showed on that lecture.
- [ ] The replay script and comparison results stay in the prototype folder, not in the pipeline's tests.
