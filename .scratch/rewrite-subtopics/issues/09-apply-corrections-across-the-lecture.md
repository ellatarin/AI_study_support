# 09 — Apply the corrections of one subtopic to the whole lecture

**What to build:** Only if the live run of ticket 08 shows the need. Term correction sends one subtopic at a time, with the slides placed in it. So a misheard term stays wrong in each subtopic that has no slide that prints it. That includes a subtopic before the slide. This ticket adds a lecture-wide call to term correction. The call applies the corrections of all subtopics to the whole lecture.

"Round" is now the glossary term for one pass of the rewrite loop (CONTEXT.md). So this ticket calls its two parts the subtopic calls and the lecture-wide call.

**Blocked by:** 08 — Live run of the rewrite loop on one lecture. The run counts the misheard terms that stay wrong.

**Status:** needs-info

## The strategy

1. The subtopic calls are term correction as ticket 05 builds it. Each subtopic with a placed slide gets one call, and the calls run in parallel. Code checks each correction.
2. The lecture-wide call is one call. It gets the full lecture text, with the id of each subtopic, and the list of corrections that the subtopic calls accepted. The reply gives each place where a correction applies: a subtopic id, a wrong form, a right form and a reason. The model does not return the text. Code applies the changes.
3. The model of the lecture-wide call decides where a correction applies. It skips a subtopic where the same words have their correct meaning. It can give another form of the same misheard term, such as the form with a capital at the start of a sentence.
4. Code checks each correction of the lecture-wide call:
   - the right form is in the list of the subtopic calls, so each right form still comes from a slide
   - the wrong form is in the text of that subtopic
   - each form has one to four words.

   Code ignores and records a correction that fails a check.

The strategy needs one call more than the subtopic calls. The alternatives were slower or dearer:

- A list that grows from subtopic to subtopic makes the calls run one after another. It cannot correct a subtopic before the slide.
- A second set of calls, one for each subtopic and each with the full list, doubles the calls.

## Open decisions (proposed, not agreed)

- [ ] A field on each correction in the term-correction file that names the call that made it. It is a name on disk, so its name is agreed before the build. It cannot be `round`, because each stage entry has a `round` with a different meaning.
- [ ] A stage that fails and starts again repeats the subtopic calls and the lecture-wide call. The file of a rewrite attempt is written only after the lecture-wide call.
- [ ] In a later round of the rewrite loop, term correction for a failed subtopic makes only its subtopic call. The call gets the subtopic's slides and the list of corrections of round 1. It is not a new call with the full lecture.
- [ ] The prompt of the lecture-wide call is shown to the user before the build.

## Comments

2026-10-08: The user proposed the strategy during ticket 05, and chose to record it and build it only if the live run shows the need.
