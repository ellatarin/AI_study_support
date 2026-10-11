# 08 — Live run of the rewrite loop on one lecture

**What to build:** The user runs the rewrite loop and `assemble-rewrites` on one lecture, and judges the rewritten subtopics. Then the placement after the rewrite gets its design.

**Blocked by:** 12 — Repeat the rewrite loop in the runner

**Status:** ready-for-agent

- [ ] The user runs the pipeline on one lecture to `assemble-rewrites`. The ticket quotes the measured cost of each stage from the manifest.
- [ ] The ticket records the number of rounds, and the subtopics that failed in each round.
- [ ] The ticket records each correction and each ignored correction. The lecture of 2026-03-06 shows if "beta-naphthylene" becomes "β-naphthylamine".
- [ ] The ticket records each misheard term that stays wrong in a subtopic because no slide placed in that subtopic prints it. The count decides if ticket 09 is built.
- [ ] The user judges the rewritten subtopics against the five kinds of detail to keep. The ticket records the judgement.
- [ ] The user judges where the writer starts each paragraph. If the paragraphs are badly split, change the writer prompt's rule "Paragraphs with no heading". Replace its sentence "Start a new paragraph where the lecturer moves to a new point" with the text below.
  > Start a new paragraph where the lecturer moves to a new part. A new part starts at a move from a thing to its mechanism, a cause to its effect or a claim to its evidence. A new example also starts a new part. Do not write one paragraph for the whole text when it holds more than one part.
- [ ] The ticket records the figure marks of each subtopic, beside the slides placed in that subtopic.
- [ ] After the judgement, the user and the agent design the rest of the placement after the rewrite:
  - its stage id
  - what happens when a subtopic has more figure marks than slides, or fewer
  - whether it uses a hint from the first placement.
- [ ] The design of the HTML stage says how the final output of one lecture is kept. The final output is a page and its images, so it is more than one file. The design says how `rename`, `delete` and `change-date` move or delete these files, and what a reset of the HTML stage deletes. Today these commands move or delete one file in `Final output/`, found by the lecture date in its name.
