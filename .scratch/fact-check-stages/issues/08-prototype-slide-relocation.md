# 08 — Prototype slide relocation on lecture 4

**What to build:** A prototype script moves each placed slide of lecture 4 into the f2k2 notes. It makes one model call for each subtopic that has slides. A page shows each slide at its new point, so the user can judge each move before the stage is built.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The prototype lives in `.scratch/slide-replacement/`. The script is `place-slides-in-notes.mts`, and the page is `Lecture 4 - slides in notes.html`. These names were agreed before the term "slide relocation". Offer the user new names to match the term before the first file is written.
- [ ] The user sees the prompt and agrees, before the paid run.
- [ ] The model is Gemini 3.8 Flash. The run costs a few cents.
- [ ] The model gets the subtopic's paragraphs as a JSON list. Each figure mark has a number in the input. For each slide, the model gets its title, its body, the reason from `place-slides`, and about 60 words of transcript from the old start words. It gets no figure description and no caption.
- [ ] The model returns the start words of a sentence for each slide. It also returns the slide that each figure mark points at, or no slide.
- [ ] The reply is unusable, and the call is sent again, in each of these cases:
  - start words that are not in the text
  - a slide with no point, or with two points
  - an unknown slide
  - slides out of deck order.
- [ ] A slide that a figure mark points at goes at that mark.
- [ ] Code gives each slide its figure number and writes "(Figure N)" in place of each mark that points at a slide. A mark that points at no slide stays as `[FIGURE]`, and the script records it.
- [ ] A references slide goes after the last sentence of the last subtopic, with no call and no figure number.
- [ ] The page is built from the test page script. It shows each slide at its new point, with the lecturer's words at the old point beside it. A mark with no slide shows as a red note.
- [ ] Each call's usage is saved, refused tries included.
- [ ] The user judges the moves.

## Comments
