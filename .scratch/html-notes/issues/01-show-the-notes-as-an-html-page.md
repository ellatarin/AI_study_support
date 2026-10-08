# 01 — Show the notes as an HTML page with the slides beside the text

**Status:** needs-triage

**Blocked by:** none

**Parked:** the user parked this ticket on 2026-10-08. The slide stages come first.

**The idea:** the user wants the notes as an HTML page, not as a PDF. The left column shows the topics, the subtopics and their text. The right column shows the slides of each subtopic, beside the subtopic's text. A click on a slide shows the slide larger.

**What changes:** the last stage, `pdf-generation`, makes a PDF from the Markdown notes (technical-design.md §5, `pdf-generation`). The requirements do not name a final format. FR-3.5 asks only for Markdown notes that refer to each slide image through a relative path. So this ticket changes the design of the last stage, and it adds a requirement for the page. The documents do not change until the user takes this ticket out of the parked state.

**What exists:** `place-slides` stores the subtopic of each placed slide. That is sufficient for this layout, because the slides of a subtopic go beside its text. The test page of slide-placement ticket 05 is a first look at the layout.

- [ ] The user decides if the HTML page replaces the PDF or comes in addition to it.
- [ ] The requirements and the technical design describe the page.
