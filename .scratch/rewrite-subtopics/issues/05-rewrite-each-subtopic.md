# 05 — Rewrite each subtopic

**What to build:** The new stage `rewrite-subtopics` turns the text of each subtopic into a rewritten subtopic. In this ticket, the stage has the rewrite step only, and the writer reads the verbatim text. Tickets 06 and 07 add the checker and term correction.

**Blocked by:** 03 — Build `structure-transcript`

**Status:** ready-for-agent

- [ ] Before the build, show the prompt to the user. Its rules use no nouns from the lectures that test it.
- [ ] Before the build, propose two models to the user, with the price of each from OpenRouter. The user's choice goes in the example config and in the user's config.
- [ ] The stage makes one call for each subtopic. The writer gets the text of that subtopic only, with no title, no slides and no other subtopic.
- [ ] The stage works on several subtopics at the same time, up to the concurrency in its config. Its sends are spaced by its `sendGapSeconds`. One gate serves all the lectures of a batch, as in the other stages.
- [ ] The prompt tells the writer to keep these kinds of detail exactly. Each kind is a numbered rule.
  - scientific nomenclature and precise terms
  - names, small molecules and protein subunits included
  - exact amino acid residues
  - the lecturer's statistics and numbers
  - each step of a mechanism in order, with each causal link that the lecturer states.
- [ ] The prompt tells the writer to keep the lecturer's order, to add nothing, and to write paragraphs with no heading. LaTeX is allowed for symbols.
- [ ] The prompt tells the writer to drop filler, jokes and course arrangements, and to keep each statement of subject matter in them.
- [ ] The prompt tells the writer to put a figure mark where the lecturer points at a slide. The mark has no number.
- [ ] The stage writes `Rewritten subtopics/rewritten-subtopics.json`, with one rewritten subtopic for each subtopic id, in lecture order.
- [ ] The stage resends an unusable reply, and fails after the third send.
- [ ] The stage fails without a model call when the structured transcript is missing, unreadable or the wrong shape. The error names the file.
