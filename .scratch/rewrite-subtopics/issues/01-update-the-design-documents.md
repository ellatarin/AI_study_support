# 01 — Update the design documents to the new design

**What to build:** The README, the technical design and the implementation plan describe the design that the user agreed on 2026-10-08. A reader of the documents finds no stage that the new design removes.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] The documents describe the stage `structure-transcript`. It runs after `judge-lecture-title`, with code only. It writes the structured transcript, as `CONTEXT.md` defines it, to `Structured transcript/structured-transcript.json`.
- [ ] The documents describe `place-slides` as it reads the structured transcript. Each placement stores `positionInSubtopic`, the number of characters from the start of the subtopic text to the placement point.
- [ ] The documents describe `rewrite-subtopics` as one stage with three steps for each subtopic: term correction, the rewrite and the checker.
- [ ] The documents say that `rewrite-subtopics` works on several subtopics at the same time, up to the concurrency in its config. Its sends are spaced by its `sendGapSeconds`, with one gate for all the lectures of a batch, as in the other stages.
- [ ] The documents give the rules of term correction. The stage makes one call for each subtopic that has a placed slide. Each form of a correction has one to four words, and the prompt states that limit. Code ignores and records a correction when its right form is not on a slide placed in the subtopic. Code also ignores and records a correction when its wrong form is not in the subtopic text. Code changes each occurrence of the wrong form in the subtopic.
- [ ] The documents give the rules of the rewrite. The writer gets the corrected text of one subtopic only, with no title, no slides and no other subtopic. The rewritten subtopic is paragraphs with no heading, in the lecturer's order. The writer drops filler, jokes and course arrangements. The writer puts a figure mark where the lecturer points at a slide.
- [ ] The documents list what the rewrite must keep exactly:
  - scientific nomenclature and precise terms
  - names, small molecules and protein subunits included
  - exact amino acid residues
  - the lecturer's statistics and numbers
  - each step of a mechanism in order, with each causal link that the lecturer states.
- [ ] The documents give the rules of the checker. It gets the verbatim text, the corrections with their reasons and the rewritten subtopic. It gets no slide text. It looks for omissions, distortions and unsourced additions, and it judges each correction from its own knowledge. One fault fails the rewrite attempt.
- [ ] The documents describe the rewrite attempts. After a fault, the subtopic gets a new rewrite attempt, and the corrector and the writer each get the faults that concern them. A subtopic gets at most three. After the third failure, the stage fails and names the subtopic and its faults. The other subtopics keep their saved results.
- [ ] The documents give the stored names `Rewritten subtopics/rewritten-subtopics.json` and `Rewrite attempts/subtopic-<id>-attempt-<n>.json`.
- [ ] The documents describe the placement after the rewrite in outline only. It works on one subtopic at a time. It puts a slide at each figure mark, and code gives the figure numbers. It places a slide with no figure mark by its subject matter. Its stage id and its other rules are decided after ticket 08.
- [ ] The final output is an HTML page, not a PDF. The HTML stage joins the rewritten subtopics under their topic and subtopic titles.
- [ ] The documents do not name `transcript-structuring`, `transcript-verification`, `synthesis`, `qa-loop`, `pdf-generation`, `assemble-chapter`, `verify-chapter` or `verify-subtopics` as stages. The README no longer says that the writer has the placed slides of each topic.
- [ ] The suite version of each changed document is raised last.
