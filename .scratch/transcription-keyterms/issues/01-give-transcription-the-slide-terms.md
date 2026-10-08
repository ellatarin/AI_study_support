# 01 — Correct misheard terms from the slides before the rewrite

**Status:** needs-triage

**Blocked by:** none

**Parked:** the user parked this ticket on 2026-10-08. The slide stages come first.

**The problem:** the transcriber can mishear a rare technical term. In the lecture of 2026-03-06, the transcript says "beta-naphthylene" twice and "beta-naphthyl" once. The slides say "β-naphthylamine" (slide 32) and "Beta-napthylamine" (slide 31, misspelt on the slide). The text alone does not show if the transcriber misheard the term or the lecturer said it wrongly.

**Decision (2026-10-08):** a new stage corrects misheard terms in the transcript, before the writing stages. It runs after `place-slides`, because it needs the placed slides of each subtopic.

- For each subtopic, a model gets the subtopic's text and the readings of its placed slides. It lists each term that it thinks was misheard, with the slide's form.
- Code makes a correction only when the wrong form is in the subtopic's text. The slide's form must also be in a reading of one of the subtopic's placed slides.
- The stage writes a corrected transcript and a record of each correction, for the user's review. The original transcript does not change.
- The writing stage works from the corrected transcript, so it never sees the error.
- `verify-topics` compares the prose with the corrected transcript, so it does not undo a correction.

**Why not the other places:**

- **Key terms at transcription.** ElevenLabs Scribe v2 accepts key terms, which make it hear those terms more accurately. But the slide stages would have to run before `transcription`, and every processed lecture would have to be transcribed again. That also runs the division stages and all later stages again.
- **A final step of the writing stage.** `verify-topics` compares the prose with the transcript, so its reviser could change the term back.
- **A stage after `verify-topics`.** The writer would already have worked from the wrong term, and could have written text around the error. The writer can also change the wrong term's form, so code cannot easily check a correction. And no checker would see the final text.

- [x] The user decides where the correction happens. The user chose a stage before the rewrite.
- [ ] The README, the technical design and the plan describe the stage, with its name, its files and its checks.
- [ ] The notes of the lecture of 2026-03-06 say "β-naphthylamine", not "beta-naphthylene".
