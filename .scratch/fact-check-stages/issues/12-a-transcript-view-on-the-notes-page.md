# 12 — Rewrite, corrections and transcript views on the notes page

**Status:** ready-for-agent

**Blocked by:** 10 — The notes page

**What to build:** the notes page gets one switch with four views.

- **Notes:** the page as it is now.
- **Rewrite:** the rewrite of each subtopic, before the fact correction, with its slides. The view has no highlight and no colour.
- **Corrections:** the notes page with its slides, and the changes that the fact correction made to the rewrite. A word that the fact correction removed is red, with a line through it. A word that the fact correction added is green.
- **Transcript:** the spoken text of the lecture. It is cut at the same points as the notes, under the same topic and subtopic headings. Each word that is not in the notes has a red highlight, with no line through it.

The user can then read the lecture as it was given, and see whether the notes dropped anything of value. The user can also see each change of the fact correction, and why the fact check asked for it.

**Decided by the user (2026-10-14):**

1. The spoken text is the text after the term correction (`Term corrections/subtopic-<id>.json`, `correctedText`). The rewrite received this text. So a term that the term correction changed does not show as dropped.
2. The text is compared with the final notes, after the fact correction. That is the text that the reader of the notes gets.
3. The comparison matches single words in order, one subtopic at a time. It ignores case and punctuation. A phrase that the notes move to another place shows red where it was spoken. The user accepts this extra red.
4. One switch has the four views: Notes, Rewrite, Corrections and Transcript.
5. The corrections view compares the rewrite of each subtopic with its fact-corrected text, with the same word comparison as the transcript view. It also shows a change that the model did not report in its reply.
6. The corrections view shows the slides at the places that `relocate-slides` gave them, after the fact correction. These are the places of the notes view.
7. The transcript view also shows the slides. Each slide sits roughly where the lecturer spoke about it, in its subtopic. Rough placement is enough.
8. When the mouse rests on a red or green word, a note shows the problem of the factual error that caused the change. The fact correction file links each change to its factual error. A change that the model did not report has no note.
9. The rewrite view shows the slides near the places that they have in the notes view. The build finds each place through the word comparison of the corrections view.

**How:** `build-notes-page` makes both comparisons when it builds the page. It makes no model call. The page then holds four texts, so it is about four times as large.

A prototype of the comparison exists: the change page of Genomics of Disease Lecture 1 (2026-10-14). It compared the term-corrected text with the rewrite, before the fact check.

- [x] The technical design describes the switch and the rewrite, corrections and transcript views before the build.
- [ ] The switch shows the notes, the rewrite, the corrections or the transcript. The page opens on the notes.
- [ ] The rewrite view shows the rewrite of each subtopic under its title, with its slides. It has no highlight and no colour.
- [ ] In the transcript view, each subtopic shows its term-corrected text under its title.
- [ ] A spoken word has a red highlight when the subtopic's notes do not have it at the same place. The highlight has no line through it.
- [ ] A subtopic whose notes have no paragraph shows its whole spoken text in red.
- [ ] In the corrections view, a word that is only in the rewrite is red, with a line through it. A word that is only in the fact-corrected text is green.
- [ ] A subtopic with no factual errors shows its text with no colour.
- [ ] Each slide in the corrections view is at the same sentence as in the notes view.
- [ ] Each slide in the transcript view is in its subtopic, near the words where the lecturer spoke about it.
- [ ] A red or green word shows the problem of its factual error when the mouse rests on it.
- [x] The page still loads nothing from the internet.
- [ ] The user checks the note box in Safari, on a page with the Corrections view and the bypass off. The note box replaced the browser's title note in f1cf75ce, because Safari showed the title note late and a touch screen never showed it.

## Comments

### Hand-off 2026-10-14

The build is on branch `ticket-12-views`, in the folder `Ella_AI_project-ticket-12-views`. The branch is not merged into `main`. No test is half done. The working tree has no change except the untracked `node_modules` link.

**Commits on the branch, newest first** (merges of `main` are left out):

1. "Change the header rule of the notes page to name the switch and the legend of each view". The technical design gives the header rule of the page views.
2. `1a9c8907` Add the Corrections view, the notes of the changes and a legend for each view. The stage reads `fact-corrected-subtopics.json`. Each unusable input stops the stage with `BuildNotesPageError`, and the error names the file.
3. `deb41a08` Add the slides of the Rewrite view and the Transcript view. The stage reads the term corrections and the slide placements.
4. `ba8b2243` Change the word comparison so that it takes paragraphs. Each compared word gets its paragraph and its character offset in each text that has it.
5. `d4bad3d3` Merge `main` at `8f040e7b` into the branch.
6. `cf047b1a` Add the switch of the page views and the Rewrite view. The stage reads the rewrites.
7. `cc06f108` Add the word comparison. The punctuation pattern moves to `utils/text.ts`. `FIGURE_MARK`, `BRACKETED_FIGURE_LABEL` and `bracketedFigureLabel` move to `slide-relocations.ts`.
8. `1ef8e11f` Add the glossary terms "Page view" and "Word comparison". Add the page views, the inputs, the word comparison, the paragraphs, the slide places and the note of a change to the technical design.

**Seam A: the word comparison** (`build-notes-page/word-comparison.ts`, `compareWords`). All tests are done.

1. Each word is unchanged when both texts have it. Done.
2. A word is removed when only the earlier text has it. A word is added when only the later text has it. Done.
3. The comparison ignores case and punctuation. Done.
4. A moved phrase is removed where it was and added where it is now. Done.
5. "(Figure N)" and "[FIGURE]" are one word, and they match. Done.
6. An empty later text makes each word removed. Done.
7. Added test: each word gets its paragraph and its character offset in each text that has it. Done.

**Seam B: the page builder** (`notesPageHtml`). All tests are done.

1. The switch has four page views, and the Notes view is chosen. Done.
2. The earlier Notes tests look inside the Notes view only. Done.
3. The Rewrite view shows the rewrite under each title, with no highlight and no colour. Done.
4. A Rewrite slide goes in front of the rewrite word that the comparison links to the slide's notes word. Done.
5. The Transcript view shows the term-corrected text under each title. Done.
6. A spoken word that is not in the notes has a red highlight with no line. Done.
7. A subtopic with no notes paragraph shows all its spoken text in red. Done.
8. A Transcript slide goes in front of the spoken word where the lecturer starts to discuss it. Done.
9. In the Corrections view, a word that is only in the rewrite is red with a line. A word that is only in the notes is green. Done.
10. A subtopic whose only change is the numbered figure mark shows no colour. Done.
11. A Corrections slide is at its notes sentence, with no highlight. Done.
12. A changed word has the problem of its factual error as a note, or no note when the model did not report the change. Done.
13. The test that the page loads nothing from the internet covers all four views. Done, and unchanged.
14. Added test for decision Q3: a spoken word goes in the paragraph of its notes word. An unwritten word goes in the paragraph of the word before it. Done.
15. Added test: the header has one legend line for each page view. Done.

**Seam C: the stage** (`buildNotesPage`). All tests are done.

1. The page holds the rewrite and the term-corrected text when the inputs are on disk. Done.
2. One `it.each` covers each unusable input: the slide relocations, the rewrite, the term correction, the slide placements and the fact-corrected subtopics. An input can be missing, not JSON or the wrong shape. The stage fails with `BuildNotesPageError`, and the error names the file. Done.

**Merge of `main`:** one merge, `d4bad3d3`, which takes `main` at `8f040e7b`. The branch uses the reader `readFactCorrections` and the seed `EARLIER_OUTPUT_SEEDS["correct-factual-errors"]` from `main`. The branch adds no seed and no reader of its own.

**The decisions of the user (2026-10-14).** Do not ask these again.

- Seams A, B and C, and the table of new names, are approved.
- Q1: "(Figure N)" and "[FIGURE]" count as one word, and they match.
- Q2: the Corrections view has no highlight on the sentence of a slide.
- Q3: the Transcript view takes its paragraph breaks from the notes. Each spoken word that the comparison links to a notes word goes in the paragraph of that notes word. A spoken word with no link goes in the paragraph of the spoken word before it.
- Q4: a run of red and green words between two unchanged words takes the note of the first reported change. That change has a `before` that holds the red words in order, and an `after` that holds the green words in order. The match ignores case and punctuation. A run that no change matches has no note.
- Q5: the parent builds the reader of `fact-corrected-subtopics.json` on `main`. The branch takes it through the merge.
- Q6: the four new inputs are in the technical design section of `build-notes-page`.
- Q7: the glossary entries "Page view" and "Word comparison" are approved and written.

**Open questions and problems:**

1. The check `isFactCorrectionFile` in `fact-corrections.ts` (from `main`) does not check each entry of `changes` or of `factualErrors`. The page reads `before`, `after`, `factualError` and `problem` from them. A malformed entry stops the page build with a `TypeError`, not with `BuildNotesPageError`. The check of the entries is a change to the parent's module, so the parent must decide.
2. The note uses `factualErrors[change.factualError - 1]`. The fact that the numbers count from 1 has its home in `FIRST_FACTUAL_ERROR_NUMBER` in `correct-factual-errors.prompt.ts`. That constant is not exported. So the page restates the fact as `- 1`.
3. No suite runs a browser. So the user must check these items by hand:
   - the switch
   - the legend line of each view
   - the topic links in each view
   - the red and green colours in light mode and in dark mode
   - the note when the mouse rests on a word.

   The switch uses the CSS `:has()` selector, which current browsers support.
4. `notes-page-html.ts` now has about 850 lines. It holds the text helpers, the four views and the page. A later change can move the text helpers (`escapeHtml`, `textHtml`, `figureHtml`) and the view texts into separate modules.
5. The suite version is not raised. The parent raises it after the merge.
6. The acceptance boxes above are not ticked. The user ticks them after the hand check.

**The exact next step:** the build of ticket 12 is complete. The parent merges the branch into `main` and raises the suite version. Then the user checks the page by hand, as item 3 of the open questions says. Then the user decides items 1 and 2 of the open questions.

**2026-10-15, box check:** The design box is done in 1ef8e11f, before the first build commit cf047b1a. Merge 5502ef5d puts both commits on `main`. The box of the page that loads nothing from the internet is done. The test of this box is from b2d997ee. The test reads the whole page, and the page holds all four views since 1a9c8907. The other boxes of the views stay open for the hand check of the user.
