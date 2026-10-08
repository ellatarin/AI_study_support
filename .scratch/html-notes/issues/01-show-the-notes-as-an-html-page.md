# 01 — Show the notes as an HTML page with the slides beside the text

**Status:** needs-triage

**Blocked by:** none

**Parked:** the user parked this ticket on 2026-10-08. The slide stages come first.

**The idea:** the user wants the notes as an HTML page, not as a PDF. The page shows the topics, the subtopics and their text in one reading column. Each slide sits in the text at its point, small, and the text flows round it. Its figure number and caption hang in the right margin, outside the text column. A click on a slide shows the slide larger, with its caption under it.

**Decision (2026-10-08):** the HTML page replaces the PDF. The final output is no longer a PDF. The test page of slide-placement ticket 05 is the prototype of the page: `.scratch/slide-placement/test-page/build-test-page.mts`.

**What changes:** the last stage, `pdf-generation`, makes a PDF from the Markdown notes (technical-design.md §5, `pdf-generation`). The requirements do not name a final format. FR-3.5 asks only for Markdown notes that refer to each slide image through a relative path. So this ticket changes the design of the last stage, and it adds a requirement for the page. The documents do not change until the user takes this ticket out of the parked state.

**What exists:** `place-slides` stores the subtopic of each placed slide and its point in the transcript. The test page uses the point. The final page must use a point in the rewritten prose, and the design of the writing stages decides how a point survives the rewrite.

- [x] The user decides if the HTML page replaces the PDF or comes in addition to it. The page replaces the PDF.
- [ ] The requirements and the technical design describe the page.
- [ ] The page renders LaTeX in the text and in the captions as symbols, for example `$\beta$` as β (slide-placement ticket 07).
