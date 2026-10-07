# 04 — Place each subject-matter slide with a subtopic

**What to build:** The new stage `place-slides` runs after `read-slides`. It makes one model call for the whole lecture, and it puts each subject-matter slide with the subtopic where the lecturer discusses it. The design is in TD §5, `place-slides`.

**Blocked by:** 03 — Read each slide with a vision model

**Status:** ready-for-agent

- [ ] The model gets every subtopic's title and text, and every slide reading in deck order. Content-free slides are in the list and marked as content-free.
- [ ] The model returns one subtopic for each subject-matter slide.
- [ ] A reply is unusable in each of these cases:
  - a subject-matter slide has no place or two places
  - a slide is placed earlier than the slide before it in the deck
  - a subtopic does not exist.
- [ ] The stage resends an unusable reply with no repair, and fails after the third send.
- [ ] The code puts each references slide with the lecture's last subtopic. The deck-order check does not apply to references slides.
- [ ] Content-free slides get no place.
- [ ] The stage writes `Slide placements/placements.json`.
- [ ] The stage fails without a model call when an input is unusable: the retitled subtopics, the transcript, or a slide reading. The error names the file.
