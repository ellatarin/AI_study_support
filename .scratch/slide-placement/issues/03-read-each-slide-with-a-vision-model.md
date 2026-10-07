# 03 — Read each slide with a vision model

**What to build:** The new stage `read-slides` runs after `render-slides`. It sends each slide image to a vision model, one call for each slide. It writes one slide reading for each slide. The design is in TD §5, `read-slides`.

**Blocked by:** 02 — Render each slide as an image

**Status:** ready-for-agent

- [ ] Before the build, propose two vision models to the user, with the price of each from OpenRouter. The user chooses one, and the choice goes in the example config and in the user's config.
- [ ] The shared model-call code can send an image in a message. No second call path is made.
- [ ] The model gets the slide image alone, with no slide number and no transcript.
- [ ] Each reading holds the slide's title, its body, its tables, its figures, a caption and its kind. Each figure has a type and a description. The kind is subject matter, content-free or references.
- [ ] The stage writes `Slide readings/slide-001.json` and so on, one file for each slide.
- [ ] A stage that failed and starts again reads only the slides that have no reading.
- [ ] The stage resends an unusable reply, and fails after the third send.
- [ ] The stage fails without a model call when `Slide images/` is missing or empty. The error names the folder.
- [ ] Before the build, show the prompt to the user. Its rules use no nouns from lecture 3, whose slides were read to write it.
- [ ] Run the stage on lecture 3 and on one lecture whose slides were not read to write the prompt. Check the readings against the slide images with the user.
