# 04 — Place each subject-matter slide with a subtopic

**What to build:** The new stage `place-slides` runs after `read-slides`. It makes one model call for the whole lecture, and it puts each subject-matter slide with the subtopic where the lecturer discusses it. The design is in TD §5, `place-slides`.

**Blocked by:** 03 — Read each slide with a vision model

**Status:** ready-for-agent

- [ ] The model gets every subtopic's id, title and trimmed text, with no topics. It also gets the reading of each subject-matter slide in deck order, whole, as `read-slides` wrote it. Content-free slides and references slides are not in the list.
- [ ] The prompt is in Markdown sections, with numbered rules and a check before the reply. Its method places each slide on its own first. Then it moves each slide whose place breaks deck order, until no place breaks it. The prompt has the version `p1`.
- [ ] The model returns one subtopic for each subject-matter slide, with `placedBecause`, one sentence that says why. The stage ignores an entry for a content-free slide or a references slide, and makes no check on it.
- [ ] A reply is unusable in each of these cases:
  - the reply is not the documented shape
  - the `placedBecause` of a subject-matter slide is blank
  - a subject-matter slide has no place, or more than one place
  - an entry names a slide or a subtopic that does not exist
  - a slide's subtopic is earlier than the subtopic of the subject-matter slide before it in the deck.
- [ ] The stage resends an unusable reply with no repair, and fails after the third send.
- [ ] The code puts each references slide with the lecture's last subtopic. The deck-order check does not apply to references slides.
- [ ] Content-free slides get no place.
- [ ] The stage writes `Slide placements/placements.json`, with the prompt version and one entry for each placed slide in deck order. Each entry holds `slideNumber`, `subtopicId` and `placedBecause`.
- [ ] The stage fails without a model call when an input file is missing, unreadable or the wrong shape. The input files are the transcript, the retitled subtopics and the reading of each slide image. The error names the file.
- [ ] The model is `google/gemini-3.8-flash` with no temperature and no token cap, in the example config and in the user's config.
