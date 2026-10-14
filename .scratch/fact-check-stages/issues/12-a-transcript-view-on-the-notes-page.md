# 12 — A transcript view on the notes page

**Status:** needs-triage

**Blocked by:** 10 — The notes page

**What to build:** the notes page gets a switch with two views.

- **Notes:** the page as it is now.
- **Transcript:** the spoken text of the lecture. It is cut at the same points as the notes, under the same topic and subtopic headings. Each word that is not in the notes has a red highlight, with no line through it.

The user can then read the lecture as it was given, and see whether the notes dropped anything of value.

**Decided by the user (2026-10-14):**

1. The spoken text is the text after the term correction (`Term corrections/subtopic-<id>.json`, `correctedText`). The rewrite received this text. So a term that the term correction changed does not show as dropped.
2. The text is compared with the final notes, after the fact correction. That is the text that the reader of the notes gets.
3. The comparison matches single words in order, one subtopic at a time. It ignores case and punctuation. A phrase that the notes move to another place shows red where it was spoken. The user accepts this extra red.

**How:** `build-notes-page` makes the comparison when it builds the page. It makes no model call. The page then holds both texts, so it is about twice as large.

A prototype of the comparison exists: the change page of Genomics of Disease Lecture 1 (2026-10-14). It compared the term-corrected text with the rewrite, before the fact check.

- [ ] The technical design describes the switch and the transcript view before the build.
- [ ] The switch shows the notes or the transcript. The page opens on the notes.
- [ ] In the transcript view, each subtopic shows its term-corrected text under its title.
- [ ] Each spoken word that the subtopic's notes do not have at the same place has a red highlight, with no line through it.
- [ ] A subtopic whose notes have no paragraph shows its whole spoken text in red.
- [ ] The page still loads nothing from the internet.

## Comments
