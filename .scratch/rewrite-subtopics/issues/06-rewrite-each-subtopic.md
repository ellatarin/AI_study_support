# 06 — Rewrite each subtopic from its corrected text

**What to build:** `rewrite-subtopics` gets its second step, the rewrite. Each subtopic gets a rewritten subtopic, made from its text after term correction. Ticket 07 adds the checker.

**Blocked by:** 05 — Correct misheard terms in each subtopic

**Status:** ready-for-agent

- [ ] Before the build, show the prompt to the user. Its rules use no nouns from the lectures that test it.
- [ ] Before the build, propose two models to the user, with the price of each from OpenRouter. The user's choice goes in the example config and in the user's config.
- [ ] The rewrite makes one call for each subtopic, after term correction. The writer gets the corrected text of that subtopic only, with no title, no slides and no other subtopic.
- [ ] The rewrite uses the same concurrency and the same gate as term correction.
- [ ] The prompt tells the writer to keep these kinds of detail exactly. Each kind is a numbered rule.
  - scientific nomenclature and precise terms
  - names, small molecules and protein subunits included
  - exact amino acid residues
  - the lecturer's statistics and numbers
  - each step of a mechanism in order, with each causal link that the lecturer states.
- [ ] The prompt tells the writer to keep the lecturer's order, to add nothing, and to write paragraphs with no heading. LaTeX is allowed for symbols.
- [ ] The prompt tells the writer to drop filler, jokes and course arrangements, and to keep each statement of subject matter in them.
- [ ] The prompt tells the writer to put a figure mark where the lecturer points at a slide. The mark has no number.
- [ ] Each rewrite attempt file also holds the rewritten subtopic.
- [ ] The stage writes `Rewritten subtopics/rewritten-subtopics.json`, with one rewritten subtopic for each subtopic id, in lecture order. Each entry holds the corrections that its rewritten subtopic uses.
- [ ] The stage resends an unusable reply, and fails after the third send.
