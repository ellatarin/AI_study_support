# 06 — Rewrite each subtopic from its corrected text

**What to build:** The stage `rewrite-subtopics`. Each subtopic gets a rewritten subtopic, made from its text after term correction (TD §5, `rewrite-subtopics`). Ticket 07 adds the check, as its own stage.

**Blocked by:** 10 — Give term correction its own stage, and give each stage entry a round

**Status:** ready-for-agent

- [x] Before the build, show the prompt to the user. Its rules use no nouns from the lectures that test it. The user agreed version `w1` on 2026-10-10.
- [x] Before the build, propose two models to the user, with the price of each from OpenRouter. The user chose `google/gemini-3.8-flash` on 2026-10-11.
- [x] Before the build, propose the names of the stored fields to the user in one table. The user agreed `writerPromptVersion` and `rewrittenSubtopic` on 2026-10-11.
- [x] The model goes in the stage's own entry, in the example config and in the user's config. The user set `concurrency` 10 and `sendGapSeconds` 0.25 on 2026-10-11.
- [x] The stage makes one call for each subtopic of the round. The writer gets the corrected text of that subtopic only, from `Term corrections/`, with no title, no slides and no other subtopic. The list of subtopics comes from the structured transcript (user ruling, 2026-10-11).
- [x] The stage works on several subtopics at the same time, up to its `concurrency`, with its own `sendGapSeconds`.
- [x] The prompt tells the writer to keep these kinds of detail exactly. Each kind is a numbered rule.
  - scientific nomenclature and precise terms
  - names, small molecules and protein subunits included
  - exact amino acid residues
  - the lecturer's statistics and numbers
  - each step of a mechanism in order, with each causal link that the lecturer states.
- [x] The prompt tells the writer to keep the lecturer's order, to add nothing, and to write paragraphs with no heading. LaTeX is allowed for symbols.
- [x] The prompt tells the writer to drop filler, jokes and course arrangements, and to keep each statement of subject matter in them.
- [x] The prompt tells the writer to put a figure mark where the lecturer points at a slide. The mark has no number.
- [x] The prompt names the language of `finalOutput.language`.
- [x] The stage writes `Rewrites/subtopic-<id>-attempt-<n>.json` for each subtopic, with `subtopicId`, `attemptNumber`, `writerPromptVersion` and `rewrittenSubtopic`.
- [x] A reply with a blank paragraph is unusable. The stage resends an unusable reply, and fails after the third send.
- [x] A reply with no paragraph is usable, and the stage keeps an empty rewrite. The user ruled this on 2026-10-11, after the live run on Lecture 3 failed at subtopic 17. Subtopic 17 holds only the lecturer's closing words.
- [x] A stage that starts again makes no call for a subtopic with a saved file.
- [x] The stage fails without a model call when a term-correction file is missing or unreadable. The error names the file.
- [ ] Live run: the user runs the stage on one lecture and judges the rewritten subtopics before ticket 07 starts.
