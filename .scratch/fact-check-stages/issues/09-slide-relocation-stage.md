# 09 — The slide relocation stage

**What to build:** The stage `relocate-slides` after `correct-factual-errors`. It does what the prototype of ticket 08 does, with the prompt and the model that the user approved there. It writes the fact-corrected text with each slide at its point and each figure number in the text.

**Blocked by:** 06 — Fact correction, and 08 — Prototype slide relocation on lecture 4

**Status:** ready-for-agent

- [ ] The technical design, the plan and the requirements describe the stage before the build.
- [ ] The prompt is copied word for word from the prototype, and the stage records its version.
- [ ] The model goes in the stage's own entry, in the example config and in the user's config.
- [ ] The names of the folder, the files and the fields go to the user in one table before the build.
- [ ] The stage writes one file for each subtopic and one file for the whole lecture.
- [ ] A subtopic with no slides gets no call.
- [ ] A stage that starts again makes no call for a subtopic with a saved file.
- [ ] Each rule of the prototype holds: unusable replies, figure marks, figure numbers, the references slide.
- [ ] A live run on lecture 4 by the user.

## Comments
