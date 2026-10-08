# 06 — Remove complete duplicate slides before placement

**Status:** needs-triage

**Blocked by:** none

**Parked:** the user parked this ticket on 2026-10-08. Ticket 05 runs `place-slides` as it is, with each copy of a repeated slide placed.

**The idea:** the user wants each complete duplicate removed at a stage before `place-slides`. A complete duplicate is a slide whose image is the same, byte for byte, as the image of an earlier slide in the deck. Then the model gets each slide once, and the notes show each slide once.

**What exists:**

- `place-slides` places each copy of a repeated slide (technical-design.md §5, `place-slides`, "A duplicate slide"). Rule R5 of its prompt tells the model to place each copy on its own.
- In lectures 3 and 4, each complete duplicate is content-free, so it never goes to the model. Lecture 3 repeats a learning-outcomes slide (slides 2 and 53). Lecture 4 repeats untitled slides (slides 6, 12, 18, 21, 23, 30, 33 and 41).
- A slide number is the page number of the slide in the PDF of the deck. If `render-slides` drops a duplicate image, each later slide number changes. So the removal must keep the slide numbers.

- [ ] The user decides at which stage the removal happens.
- [ ] The user decides which copy stays.
- [ ] The technical design and the plan describe the removal. Rule R5 of the `place-slides` prompt changes or goes.
- [ ] A run of slides in which each slide repeats the one before with a small change is not a complete duplicate. Ticket 05 records the user's judgement of such runs.
