# 04 — Better titles for the Genomics of Disease lectures

**Status:** needs-triage

**Blocked by:** none

**When:** soon, but not yet. The user wants it after the current commits (2026-10-14).

**The problem:** the user judged both lecture titles of the Genomics of Disease batch of 2026-10-14 as bad.

- **Lecture 2 — "Genomics of Disease".** The video file was `GD_Genomics of Disease on 12.10.2026 Mon.mp4`. The provisional title from the file name is the module name, not the lecture's subject. `judge-lecture-title` judged it meaningful: "The title accurately describes the lecture's use of genomic sequencing and variant interpretation to diagnose rare diseases…". So it kept the title, and `aiDerivedTitle` is null. The stage is not told the module name, so it cannot see that the title only repeats it. The slide deck was named "Variant Interpretation".
- **Lecture 1 — "Genomic Diagnosis of Neurodevelopmental Conditions".** The video file name gave no title, so the stage made this one. The lecture has these parts:
  - a long module introduction, 2,976 of 10,494 words
  - the neurodevelopmental conditions
  - the clinical value of a genetic diagnosis
  - the history of genetic testing, told through one patient, 3,061 words

  Why the user judges this title bad is not yet recorded. Ask first.

**What to decide first:**

1. What makes a good lecture title, in the user's words, with both lectures as examples.
2. Whether the stage gets the module name, with a rule that a title which only repeats the module name is not meaningful.
3. Whether the stage gets the slide deck's file name or its title slide as a second source.
4. Whether a lecture whose first part is course administration needs a rule, so that the admin does not shape the title.

Follow the project's prompt rules:

- Test a new prompt on one lecture first.
- Keep a numbered registry of prompt versions.
- Use no examples from the test lectures in the prompt.

- [ ] The user states what a good title is, and why each of the two titles is bad.
- [ ] The design of the change is agreed, then written into the technical design.
- [ ] A new prompt version is tried on these two lectures, and the user judges the titles.
- [ ] The stage gives a title that is not only the module name when the file name gives only the module name.

## Comments

**2026-10-14, the user's answers to the four questions:**

1. **Lecture 1.** The title covers only part of the lecture. It does not cover all the topics and subtopics.
2. **The module name.** No. The stage does not get the module name.
3. **The slide deck.** No. The stage does not get the slide deck's name or its title slide.
4. **Course administration.** Yes. A lecture whose first part is course administration needs a rule, so that the administration does not shape the title.

**A new design direction from the user:** the stage always derives an AI title. Then it decides whether that title is better than the title from the lecturer's file name. Today the stage derives a title only when it judges the lecturer's title not meaningful. This changes the stage's flow and the judgement record, so the technical design changes first.
