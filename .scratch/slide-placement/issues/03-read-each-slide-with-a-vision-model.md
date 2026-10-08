# 03 — Read each slide with a vision model

**What to build:** The new stage `read-slides` runs after `render-slides`. It sends each slide image to a vision model, one call for each slide. It writes one slide reading for each slide. The design is in TD §5, `read-slides`.

**Blocked by:** 02 — Render each slide as an image

**Status:** resolved

- [x] Before the build, propose two vision models to the user, with the price of each from OpenRouter. The user chooses one, and the choice goes in the example config and in the user's config.
- [x] The shared model-call code can send an image in a message. No second call path is made.
- [x] The model gets the slide image alone, with no slide number and no transcript.
- [x] Each reading holds the slide's title, its body, its tables, its figures, a caption and its kind. Each figure has a type and a description. The kind is subject matter, content-free or references.
- [x] The stage writes `Slide readings/slide-001.json` and so on, one file for each slide.
- [x] A stage that failed and starts again reads only the slides that have no reading.
- [x] The stage resends an unusable reply, and fails after the third send.
- [x] The stage fails without a model call when `Slide images/` is missing or empty. The error names the folder.
- [x] Before the build, show the prompt to the user. Its rules use no nouns from lecture 3, whose slides were read to write it.
- [x] Run the stage on lecture 3 and on one lecture whose slides were not read to write the prompt. Check the readings against the slide images with the user.

## Comments

**Live runs (2026-10-08):** the stage ran with `google/gemini-3.8-flash` and a concurrency of 10. The user checked the readings of both lectures against the slide images and approved them.

| Lecture | Slides | Calls | Cost (USD) |
|---|---|---|---|
| Lecture 3, 2026-03-04 (the prompt was written from its slides) | 53 | 53 | 0.31 |
| Lecture 4, 2026-03-06 (held out) | 58 | 58 | 0.27 |

Lecture 3 got 49 subject-matter readings and 4 content-free readings. The stage gave no reading the kind "references".
