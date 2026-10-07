# 01 — Update the design documents to the three slide stages

**What to build:** The design documents describe the slide design that the user agreed on 2026-10-07. There are three slide stages: `render-slides`, `read-slides` and `place-slides`. The notes show each slide as one whole image. No figure is cut out of a slide. The glossary terms are already in `CONTEXT.md`: slide deck, slide, slide reading, caption, content-free slide and slide placement.

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] The README stage list has `render-slides`, `read-slides` and `place-slides`. It has no `extract-figures`, `verify-figures`, `assign-slides`, `merge-slides` or `verify-merge`. The status table agrees with the list.
- [x] The requirements (FR-2) say that each slide is one whole image with a caption. The requirements for cropped images and for the removal of logos and decoration are removed.
- [x] The technical design has one section in §5 for each slide stage. Each section gives the inputs, the outputs, the stored names and the failure modes.
- [x] The technical design's stage table and workspace tree have the three stages and their folders: `Slide images/slide-001.png`, `Slide readings/slide-001.json` and `Slide placements/placements.json`. The `Slide content` folder and the old stages `slide-conversion` and `image-extraction` are removed.
- [x] The `read-slides` section says that the model reads each slide alone. The reading holds the title, the text, a description of each diagram, a caption and the kind. The kind is subject matter, content-free or references.
- [x] The `place-slides` section says that the stage makes one call for the whole lecture. The model sees every subtopic's title and text, and every reading in deck order. It returns one subtopic for each subject-matter slide. The code checks that each slide has one place, that deck order is kept and that each subtopic exists. A reply that fails a check is unusable and is sent again, with no repair. The code puts each references slide with the last subtopic. Content-free slides get no place.
- [x] The technical design records three gaps: no checker for readings or placements, no panel for placement, and no notes document yet.
- [x] The implementation plan has one phase for each slide stage, with its test names.

**Decisions made during the work:**

- The user agreed the stored field names. A slide reading holds `slideNumber`, `title`, `text`, `diagrams`, `caption` and `kind`. The values of `kind` are `subject-matter`, `content-free` and `references`. `placements.json` holds a list `placements`, and each entry holds `slideNumber` and `subtopicId`.
- The slide stages run directly after `judge-lecture-title`. In §5 of the technical design, their sections follow the `judge-lecture-title` section.
- `verify-slides` stays in the README as a planned stage. It is the reading checker that the first version does not have.
- The README's `write-topics` rewrites each topic with its placed slides in hand. Whether the rewrite adds slide facts that the lecturer did not say is open. It belongs to the design of the rewording.
