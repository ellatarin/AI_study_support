# 01 — Give transcription the terms from the slides

**Status:** needs-triage

**Blocked by:** none

**Parked:** the user parked this ticket on 2026-10-08. The slide stages come first.

**The problem:** the transcriber can mishear a rare technical term. In the lecture of 2026-03-06, the transcript says "beta-naphthylene" twice and "beta-naphthyl" once. The slides say "β-naphthylamine" (slide 32) and "Beta-napthylamine" (slide 31, misspelt on the slide). The text alone does not show if the transcriber misheard the term or the lecturer said it wrongly.

**The idea:** ElevenLabs Scribe v2 accepts a list of key terms, which makes it hear those terms more accurately. The slides hold the lecture's technical terms. So the stage order changes: `render-slides` and `read-slides` run before `transcription`, and `transcription` sends terms from the slide readings as key terms. The slides do not depend on the transcript, so they can run first.

**What exists:**

- `transcription` uses `elevenlabs/scribe_v2`, which supports key terms.
- The API takes up to 1,000 key terms. Each term is shorter than 50 characters and has at most 5 words. The characters `< > { } [ ] \` are not allowed.
- Key terms add 20% to the transcription cost: $0.05 for each hour of audio, on top of $0.22.
- A new transcript changes the input of every later stage. For a lecture that is already processed, the division stages and all later stages must run again.

**The other way:** a stage after `place-slides` compares each subtopic's text with the readings of its placed slides. A model lists each term that it thinks was misheard, with the slide's form. Code makes a correction only when the slide's form is in a reading of that subtopic and the wrong form is in the text. The stage records each correction. This way can also catch errors that key terms do not prevent.

- [ ] The user decides between key terms at transcription, a correction stage, or both.
- [ ] For key terms: the user decides how the terms are taken from the readings, by code or by a model call. The user also decides what counts as a term.
- [ ] For key terms: the README, the technical design and the plan show the new stage order.
- [ ] The lecture of 2026-03-06 is transcribed again, and its transcript says "naphthylamine".
