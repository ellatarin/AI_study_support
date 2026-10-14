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

- [ ] The technical design describes the switch and the rewrite, corrections and transcript views before the build.
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
- [ ] The page still loads nothing from the internet.

## Comments
