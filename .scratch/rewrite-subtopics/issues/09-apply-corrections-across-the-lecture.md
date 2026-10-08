# 09 — Apply the corrections of one subtopic to the whole lecture

**What to build:** Only if the live run of ticket 08 shows the need. Term correction sends one subtopic at a time, with the slides placed in it. So a misheard term stays wrong in each subtopic that has no slide that prints it. That includes a subtopic before the slide. This ticket adds a second round of term correction that applies the corrections of all subtopics to the whole lecture.

**Blocked by:** 08 — Live run of `rewrite-subtopics` on one lecture. The run counts the misheard terms that stay wrong.

**Status:** needs-info

## The strategy

1. Round 1 is term correction as ticket 05 builds it. Each subtopic with a placed slide gets one call, and the calls run in parallel. Code checks each correction.
2. Round 2 is one call. It gets the full lecture text, with the id of each subtopic, and the list of corrections that round 1 accepted. The reply gives each place where a correction applies: a subtopic id, a wrong form, a right form and a reason. The model does not return the text. Code applies the changes.
3. The model of round 2 decides where a correction applies. It skips a subtopic where the same words have their correct meaning. It can give another form of the same misheard term, such as the form with a capital at the start of a sentence.
4. Code checks each correction of round 2:
   - the right form is in the list of round 1, so each right form still comes from a slide
   - the wrong form is in the text of that subtopic
   - each form has one to four words.

   Code ignores and records a correction that fails a check.

The strategy needs one call more than round 1. The alternatives were slower or dearer:

- A list that grows from subtopic to subtopic makes the calls run one after another. It cannot correct a subtopic before the slide.
- A second round of one call for each subtopic, each with the full list, doubles the calls.

## Open decisions (proposed, not agreed)

- [ ] A field `round`, with the value `1` or `2`, on each correction in the rewrite attempt file. It is a name on disk.
- [ ] A stage that fails and starts again repeats both rounds. A rewrite attempt is written only after round 2.
- [ ] A new rewrite attempt after a fault from the checker (ticket 07) repeats term correction for that subtopic alone. The call gets the subtopic's slides and the list of round 1. It is not a new call with the full lecture.
- [ ] The prompt of round 2 is shown to the user before the build.

## Comments

2026-10-08: The user proposed the strategy during ticket 05, and chose to record it and build it only if the live run shows the need.
