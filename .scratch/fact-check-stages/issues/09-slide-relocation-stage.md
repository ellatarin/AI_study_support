# 09 — The slide relocation stage

**What to build:** The stage `relocate-slides` after `correct-factual-errors`. It does what the prototype of ticket 08 does, with the prompt and the model that the user approved there. It writes the fact-corrected text with each slide at its point and each figure number in the text.

**Blocked by:** 06 — Fact correction, and 08 — Prototype slide relocation on lecture 4

**Status:** ready-for-agent

- [x] The technical design, the plan and the requirements describe the stage before the build.
- [x] The prompt is copied word for word from the prototype, and the stage records its version.
- [ ] The model goes in the stage's own entry, in the example config and in the user's config.
- [ ] The names of the folder, the files and the fields go to the user in one table before the build.
- [x] The stage writes one file for each subtopic and one file for the whole lecture.
- [x] A subtopic with no slides gets no call.
- [x] A stage that starts again makes no call for a subtopic with a saved file.
- [x] Each rule of the prototype holds: unusable replies, figure marks, figure numbers, the references slide.
- [ ] A live run on lecture 4 by the user.

## Comments

2026-10-14: the user chose prompt r4 of the prototype (`.scratch/slide-relocation/prompts.mts`). r4 makes one call for each subtopic, with the subtopic from `place-slides`. Each slide is sent as its whole slide reading, with no transcript words and no reason from `place-slides`. A mark that points at a slide in another subtopic cannot work with this call shape. Ticket 11 covers it.

2026-10-14: the user approved the names: folder `Slide relocations/`, files `subtopic-<id>.json` and `slide-relocations.json` (field `slideRelocations`), and the fields `subtopicId`, `slideRelocationPromptVersion`, `paragraphs`, `slides` (`slideNumber`, `paragraphIndex`, `characterOffset`, `figureNumber`) and `figureMarksWithNoSlide`. Config entry `relocate-slides`: `google/gemini-3.8-flash`, `concurrency` 10, `sendGapSeconds` 0.25. TD §5 "After the fact correction" holds them, with the r4 call.

**2026-10-15, box check:** The design box is done in 812af23e and 1536425d, before the build in f197dff0. The requirements describe the slides of the page in FR-3.5. The prompt box is done in f197dff0. The stage text is the same as r4 of the prototype. The box of the subtopic files and the lecture file is done in f197dff0 and 8f040e7b. The box of the subtopic with no slides is done in f197dff0. The box of the stage that starts again is done in f197dff0 and 8f040e7b. The box of the prototype rules is done in f197dff0.
